// Test — section 315 (audit du 2026-10-19, lot 8) : moteur de cubes.
//  26. La sortie publique du CEO ne fait que diviser les rouges par deux : elle n'en AJOUTE jamais.
//  66. GARP à équité négative : le sac type passe à 20 rouges (avant : mise à jour sautée, sac resté vert).
//  41. Profil Croissance : le percentile de marge ne compte plus l'entreprise elle-même (cas pair, 2 entreprises).
//  68. Tranche du sac type : proportions exactes, aucune part négative (probabilités de tirage justes).
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section315-cubes.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
// Contre-épreuve : le scénario doit échouer avec l'ancien code.
async function contre(title, transform, fn){
  console.log(title);
  let failed = false;
  try{ await fn(loadEngine({ transform })); }catch(e){ failed = true; console.log('  (échec attendu) ' + String(e.message).slice(0, 160)); }
  try{ check(failed, 'contre-épreuve : l’ancien code fait échouer ce scénario'); n++; }
  catch(e){ failures.push(title.slice(0, 4) + ' — ' + e.message); }
}
const ANCIEN_26 = s => s.replace('r.red = Math.min(r.red, Math.max(Math.ceil(r.red*STOCK_CEO_STATEMENT_RED_CUT), r.green));', 'r.red = Math.max(Math.ceil(r.red*STOCK_CEO_STATEMENT_RED_CUT), r.green);');
const ANCIEN_66 = s => s.replace("} else if(co.type==='garp' && bookPerShare0!==null){", "} else if(false){");
const ANCIEN_41 = s => s.replace('return (beaten/others.length)*100;', 'return (ids.filter(id=>netMarginById[id]<=val).length/ids.length)*100;');
const ANCIEN_68 = s => s.replace('pWhite = toBorrowType * tp.white/typeTotalAvailable;', 'pGreen = Math.round(pGreen); pRed = Math.round(pRed); pWhite = toBorrowType - pGreen - pRed;');

async function partie(eng, types = ['garp', 'garp']){
  const names = ['Alice', 'Bob', 'Carl', 'Dana', 'Eve', 'Fred'].slice(0, types.length);
  await eng.newGame(names, types);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];`);
  return eng;
}

// ---------------------------------------------------------------- 26
async function s26(eng){
  await partie(eng);
  eng.run(`A.stockReserve = {green:25, red:10, white:8}; A.tradingReserve = {green:0, red:40}; A.publicStatementUsed = false;`);
  const res = eng.json(`pressPublicCeoStatement(A)`);
  const r = eng.json(`({f:A.stockReserve, t:A.tradingReserve})`);
  ok(res.success, 'sortie réussie (50 rouges contre 25 verts au total)');
  ok(r.f.red === 10, `réserve fondamentale 25V/10R : rouges inchangés à 10 — obtenu ${r.f.red} (avant : 25)`);
  ok(r.t.red === 20, `réserve de trading 0V/40R : rouges divisés par deux, 20 — obtenu ${r.t.red}`);
  ok(res.redAfter === 30 && res.redAfter < res.redBefore, `total des rouges 50 → 30 (avant : 50 → 45)`);
  // Cas classique : rouges > verts dans la réserve → moitié, sans descendre sous les verts.
  eng.run(`A.stockReserve = {green:6, red:20, white:8}; A.tradingReserve = {green:2, red:3}; A.publicStatementUsed = false;`);
  eng.run(`pressPublicCeoStatement(A)`);
  const r2 = eng.json(`({f:A.stockReserve, t:A.tradingReserve})`);
  ok(r2.f.red === 10 && r2.t.red === 2, `6V/20R → 10 rouges ; trading 2V/3R → 2 rouges (moitié arrondie au-dessus, jamais sous les verts) — obtenu ${r2.f.red} et ${r2.t.red}`);
}

// ---------------------------------------------------------------- 66
async function s66(eng){
  await partie(eng);
  eng.run(`state.gameClock.rollCount = 2; drawStockCubes = function(){ return []; }; injectStockCube = function(){ return 0; };
    B.typeReserve = {green:20, red:0, white:0}; B.stockPrice = 60;
    const __bs = balanceSheetFor; balanceSheetFor = function(id, s){ if(id===B.id && s===0) return {equity:-6.5, cash:1}; return __bs(id, s); };`);
  eng.run(`advanceGameClock()`);
  const tp = eng.json(`B.typeReserve`);
  ok(tp.green === 0 && tp.red === 20 && tp.white === 0, `GARP à équité −6,5 M$ : sac type 20 verts → 0V/20R/0B — obtenu ${JSON.stringify(tp)} (avant : 20 verts conservés)`);
  // Contrôle : équité positive, cours sous la valeur comptable → toujours vert (inchangé).
  eng.run(`state.gameClock.rollCount = 5; B.typeReserve = {green:0, red:0, white:20}; B.stockPrice = 60;
    balanceSheetFor = (function(prev){ return function(id, s){ if(id===B.id && s===1) return {equity:B.totalShares*100, cash:1}; return prev(id, s); }; })(balanceSheetFor);`);
  eng.run(`advanceGameClock()`);
  const tp2 = eng.json(`B.typeReserve`);
  ok(tp2.green === 20 && tp2.red === 0, `contrôle : valeur comptable 100 $/part, cours 60 $ → 20 verts — obtenu ${JSON.stringify(tp2)}`);
}

// ---------------------------------------------------------------- 41
async function s41(eng){
  await partie(eng);
  const pct = (id, m) => eng.run(`croissanceMarginPercentile(${JSON.stringify(id)}, ${JSON.stringify(m)})`);
  const axis = (p, t) => eng.run(`croissanceMarginAxis(${p}, '${t}')`);
  const two = { c: -0.5, g: 0.3 };
  ok(pct('c', two) === 0 && axis(pct('c', two), 'eleve') === 'mauvais', `2 entreprises, Croissance −50 % contre GARP +30 % : percentile ${pct('c', two)} → « mauvais » (avant : 50 → « bon »)`);
  ok(pct('g', two) === 100 && axis(pct('g', two), 'eleve') === 'bon', 'la meilleure des 2 : percentile 100 → « bon »');
  ok(axis(pct('c', two), 'tres_eleve') === 'mauvais', 'Très élevé, la pire des 2 : « mauvais » (avant : « neutre »)');
  const four = { a: 0.4, b: 0.3, c: -0.1, d: -0.3 };
  ok(near(pct('c', four), 100/3) && axis(pct('c', four), 'eleve') === 'mauvais', `4 entreprises (+40, +30, −10, −30 %) : la 3e (−10 %) obtient ${pct('c', four).toFixed(1)} → « mauvais » (avant : 50 → « bon »)`);
  ok(axis(pct('b', four), 'eleve') === 'bon' && axis(pct('d', four), 'eleve') === 'mauvais', '4 entreprises : les 2 premières « bonnes », les 2 dernières « mauvaises »');
  const six = { a: 0.5, b: 0.4, c: 0.3, d: 0.1, e: -0.1, f: -0.2 };
  const sixAxes = Object.keys(six).map(k => axis(pct(k, six), 'eleve'));
  ok(sixAxes.join(',') === 'bon,bon,bon,mauvais,mauvais,mauvais', `6 entreprises : 3 « bonnes », 3 « mauvaises » — obtenu ${sixAxes.join(', ')} (avant : la 4e « bonne »)`);
  const tie = { a: 0.1, b: 0.1 };
  ok(pct('a', tie) === 50, 'égalité parfaite à 2 : percentile 50 (une égalité compte pour moitié)');
  // Intégration : 2 entreprises, la Croissance (−50 %) bat l'attente des analystes → avant 20 verts (bon/bon).
  const eng2 = loadEngine({ transform: eng.__transform });
  await partie(eng2, ['croissance', 'garp']);
  eng2.run(`state.gameClock.rollCount = 2; drawStockCubes = function(){ return []; }; injectStockCube = function(){ return 0; };
    A.croissanceTier = 'eleve'; A.typeReserve = {green:0, red:0, white:20};
    const __is = incomeStatementFor;
    incomeStatementFor = function(id, s){ const m = id===A.id ? {r:2, e:3} : {r:10, e:7}; return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:m.r, totalExpense:m.e, netIncome:m.r-m.e}; };
    companyExpectedNetIncome = function(co){ return {expected: co.id===A.id ? -2 : 3, semestersUsed:3}; };`);
  eng2.run(`advanceGameClock()`);
  const tp = eng2.json(`A.typeReserve`);
  ok(tp.green === 5 && tp.red === 10 && tp.white === 5, `intégration : Croissance à −50 % de marge battant l'attente → matrice mauvais/bon = 5V/10R/5B — obtenu ${JSON.stringify(tp)} (avant : 20 verts)`);
}

// ---------------------------------------------------------------- 68
// Probabilité exacte de chaque couleur au 1er tirage : balayage déterministe de Math.random sur K points.
function probas(eng, setup, K = 3700){
  return eng.json(`(function(){
    const real = Math.random; const out = {green:0, red:0, white:0};
    try{
      for(let k=0;k<${K};k++){
        ${setup}
        const u = (k+0.5)/${K}; Math.random = function(){ return u; };
        const c = drawStockCubes(A, 1)[0]; out[c]++;
      }
    } finally { Math.random = real; }
    return {green:out.green/${K}, red:out.red/${K}, white:out.white/${K}};
  })()`);
}
async function s68(eng){
  await partie(eng, ['dividende', 'garp']);
  // Audit : fondamental 11V/11R/8B, sac type 10V/10R → tranche de 7 cubes (22 × 0,20/0,65 ≈ 6,8).
  const setup = `A.stockReserve = {green:11, red:11, white:8}; A.tradingReserve = {green:0, red:0}; A.typeReserve = {green:10, red:10, white:0}; A.whiteBonusRemaining = 0;`;
  const p = probas(eng, setup);
  ok(near(p.white, 8/37, 1e-3), `blanc : ${(p.white*100).toFixed(1)} % (exact 8/37 = 21,6 % ; avant : 18,9 %)`);
  ok(near(p.green, 14.5/37, 1e-3) && near(p.red, 14.5/37, 1e-3), `vert et rouge : ${(p.green*100).toFixed(1)} % chacun (exact 14,5/37 = 39,2 %)`);
  // Sac type 3V/3R/14B, tranche de 7 : 1,05V/1,05R/4,9B — avant : 1V/1R/5B.
  const setup2 = `A.stockReserve = {green:11, red:11, white:8}; A.tradingReserve = {green:0, red:0}; A.typeReserve = {green:3, red:3, white:14}; A.whiteBonusRemaining = 0;`;
  const p2 = probas(eng, setup2);
  ok(near(p2.white, (8 + 4.9)/37, 1e-3) && near(p2.green, (11 + 1.05)/37, 1e-3), `sac type 3V/3R/14B : vert ${(p2.green*100).toFixed(2)} % (exact 32,57 %), blanc ${(p2.white*100).toFixed(2)} % (exact 34,86 %)`);
  // Un tirage du sac type d'une Dividendes le blanchit toujours d'un cube entier (inchangé).
  eng.run(`A.stockReserve = {green:11, red:11, white:8}; A.tradingReserve = {green:0, red:0}; A.typeReserve = {green:10, red:10, white:0}; globalThis.__r = Math.random; Math.random = function(){ return 23/37; };`);
  const c = eng.run(`(function(){ try{ return drawStockCubes(A, 1)[0]; } finally { Math.random = __r; } })()`);
  const tp = eng.json(`A.typeReserve`);
  ok(c === 'green' && tp.green === 9 && tp.white === 1, `tirage d'un vert du sac type : 10V/10R/0B → 9V/10R/1B — obtenu ${c}, ${JSON.stringify(tp)}`);
}

(async () => {
  await scenario('26 — sortie publique du CEO : 25V/10R et 0V/40R → 10 et 20 rouges', async () => s26(loadEngine()));
  await contre('26c — contre-épreuve (rouges remontés au niveau des verts)', ANCIEN_26, s26);
  await scenario('66 — GARP à équité négative : sac type à 20 rouges', async () => s66(loadEngine()));
  await contre('66c — contre-épreuve (mise à jour sautée)', ANCIEN_66, s66);
  await scenario('41 — percentile de marge Croissance sans l’entreprise elle-même', async () => s41(loadEngine()));
  await contre('41c — contre-épreuve (elle-même incluse)', ANCIEN_41, async (eng) => { eng.__transform = ANCIEN_41; await s41(eng); });
  await scenario('68 — tranche du sac type : probabilités exactes', async () => s68(loadEngine()));
  await contre('68c — contre-épreuve (arrondis séparés, blancs = reste)', ANCIEN_68, s68);

  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (moteur de cubes) — ${n} vérifications`);
})();
