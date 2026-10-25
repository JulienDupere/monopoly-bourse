// Section 314 — bogue 67 de l'audit du 2026-10-19 : fractionner un gros ordre multipliait les cubes de trading.
//   Le plafond d'impact (STOCK_TRADE_IMPACT_MAX_UNITS = 12 unités de 0,5 % des parts) s'appliquait à CHAQUE ordre :
//   3 M$ en un ordre = 12 unités (plafonné), 3 ordres de 1 M$ = 30 unités. Le Cahier 4 promet que fractionner ne
//   change rien. Désormais le plafond s'applique au CUMUL, par joueur, par entreprise, par couleur et par fenêtre de
//   marché (le lancer où le marché est ouvert : state.gameClock.rollCount) — budget company.tradeImpactBudget.
// Contre-épreuve : ancien tradeCubeRange (plafond par appel) réintroduit par loadEngine({transform}) : le test échoue.
// Lancer depuis la racine du dépôt :  node tests/section314-cubes.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

const ANCIEN_CUBES = src => src.replace(/function tradeCubeRange\(company, qty, color, accumField, actorId\)\{[\s\S]*?\n\}\n/,
  `function tradeCubeRange(company, qty, color, accumField){
  accumField = accumField || 'tradeImpactAccum';
  if(!company || !(company.totalShares>0) || !(qty>0)) return null;
  if(!company[accumField]) company[accumField] = {green:0, red:0};
  const unitSize = STOCK_TRADE_IMPACT_UNIT_PCT * company.totalShares;
  const before = company[accumField][color] || 0;
  const after = before + qty;
  company[accumField][color] = after;
  const unitsCrossed = Math.floor(after/unitSize) - Math.floor(before/unitSize);
  if(unitsCrossed<=0) return null;
  const units = Math.min(unitsCrossed, STOCK_TRADE_IMPACT_MAX_UNITS);
  return {qtyMin: units, qtyMax: units*2};
}
`);

// Partie à trois. Co Bob : 200 000 parts à 100 $ (0,0001 M$) ; unité d'impact = 0,5 % = 1 000 parts = 0,1 M$ ;
// 1 M$ = 10 unités ; plafond 12 unités. Exemption du flottant d'IPO retirée pour isoler le plafond.
async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`globalThis.ALICE = state.players[0]; globalThis.B = state.companies[1]; globalThis.C = state.players[2];
    state.gameClock.rollCount = 0; B.originalFloatRemaining = 0; C.cash = 100; ALICE.cash = 100;
    globalThis.cubes = []; injectTradingCube = function(co, color, mn, mx){ cubes.push({color, units: mn, max: mx}); return mn; };`);
  return eng;
}
const units = (eng, color) => eng.json(`cubes`).filter(c => !color || c.color === color).reduce((s, c) => s + c.units, 0);
const reset = (eng) => eng.run('cubes.length = 0');

async function bug67(eng){
  // Témoin : un seul ordre de 3 M$ (dans une autre partie, même état de départ).
  const solo = await setup();
  ok(solo.json(`tradeCompanyShares(B, C, 'buy', 3)`).ok, '67 : témoin — Carl achète 3 M$ de Co Bob en un ordre');
  const soloUnits = units(solo);
  ok(soloUnits === 12, `67 : témoin — 30 unités franchies, plafonnées à 12 (12 à 24 cubes verts) — obtenu ${soloUnits}`);

  const t0 = eng.cashTotal();
  for(let i = 0; i < 3; i++) ok(eng.json(`tradeCompanyShares(B, C, 'buy', 1)`).ok, `67 : Carl achète 1 M$ (ordre ${i + 1}/3)`);
  const split = eng.json('cubes').map(c => c.units);
  ok(units(eng) === soloUnits, `67 : 3 ordres de 1 M$ → ${units(eng)} unités (${split.join(' + ')}), comme l’ordre unique (avant : 10 + 10 + 10 = 30)`);
  ok(near(eng.cashTotal(), t0), '67 : monnaie conservée');

  // Canaux partagés : la vente à découvert (rouge) partage le budget rouge de Carl avec ses ventes.
  reset(eng);
  ok(eng.json(`tradeCompanyShares(B, C, 'sell', 1)`).ok && units(eng, 'red') === 10, '67 : vente de 1 M$ dans la même fenêtre → 10 unités rouges (budget rouge distinct du vert)');
  ok(eng.json(`openShortPosition(B, C, 1)`).ok && units(eng, 'red') === 12, '67 : découvert de 1 M$ ensuite → 2 unités rouges seulement (cumul plafonné à 12)');
  // Par joueur : Alice, dans la même fenêtre, a son propre budget.
  reset(eng);
  ok(eng.json(`tradeCompanyShares(B, ALICE, 'buy', 1)`).ok && units(eng, 'green') === 10, '67 : Alice achète 1 M$ dans la même fenêtre → 10 unités (budget par joueur)');
  // Fenêtre suivante (lancer 3) : budget renouvelé.
  reset(eng);
  eng.run('state.gameClock.rollCount = 3');
  ok(eng.json(`tradeCompanyShares(B, C, 'buy', 1)`).ok && units(eng, 'green') === 10, '67 : fenêtre de marché suivante (lancer 3) → budget renouvelé, 10 unités');
  const budget = eng.json('B.tradeImpactBudget');
  ok(budget && budget.window === 3, `67 : budget de la fenêtre en cours enregistré dans l’état (fenêtre ${budget && budget.window})`);
  // Petits ordres : l'accumulateur fractionnaire continue de compter (rien n'échappe au radar).
  reset(eng);
  const acc0 = eng.run('B.tradeImpactAccum.green');
  for(let i = 0; i < 15; i++) eng.json(`tradeCompanyShares(B, C, 'buy', 0.01)`);
  const acc1 = eng.run('B.tradeImpactAccum.green'), attendu = Math.floor(acc1 / 1000) - Math.floor(acc0 / 1000);
  ok(attendu >= 1 && units(eng, 'green') === attendu, `67 : 15 achats de 0,01 M$ (100 parts chacun, 1 500 parts) → ${units(eng, 'green')} unité(s) au total (accumulateur fractionnaire, rien n’échappe au radar)`);
  // Migration : une partie en cours reçoit le budget par défaut.
  const mig = eng.json(`(function(){ const s = JSON.parse(JSON.stringify(state)); delete s.companies[1].tradeImpactBudget; migrateState(s); return s.companies[1].tradeImpactBudget; })()`);
  ok(mig && mig.window === null && mig.used && Object.keys(mig.used).length === 0, '67 : migrateState ajoute tradeImpactBudget = {window:null, used:{}} aux parties en cours');
}

(async () => {
  await scenario('A. Bogue 67 — plafond d’impact appliqué au cumul (joueur, entreprise, couleur, fenêtre de marché)', async () => { await bug67(await setup()); });
  await scenario('B. Bogue 67 — contre-épreuve (plafond par ordre)', async () => {
    let failed = null;
    try{ await bug67(await setup(ANCIEN_CUBES)); }catch(e){ failed = e.message; }
    ok(failed && /67 :/.test(failed), `contre-épreuve : l’ancien plafond par ordre échoue (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 314 (cubes de trading, bogue 67) — ${n} vérifications, 0 scénario(s) en échec`);
})();
