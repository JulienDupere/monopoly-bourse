// Test — section 315 (audit du 2026-10-19, lot 8), décisions de Julien :
//  D. Dette « productive » : ne compter que les investissements faits APRÈS l'emprunt (part de dette « non investie »
//     qui déclenche la spirale de détresse à pleine force : 3 à 5 cubes rouges au lieu de 1 à 2).
//  C. Annonce de vente du CEO au-delà du plafond de 15 % (par ex. après une baisse du cours) : ramenée au plafond au lieu
//     d'être annulée.
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section315-decisions.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
async function contre(title, transform, fn){
  console.log(title);
  let failed = false;
  try{ await fn(transform); }catch(e){ failed = true; console.log('  (échec attendu) ' + String(e.message).slice(0, 160)); }
  try{ check(failed, 'contre-épreuve : l’ancien code fait échouer ce scénario'); n++; }
  catch(e){ failures.push(title.slice(0, 4) + ' — ' + e.message); }
}
const ANCIEN_D = s => s.replace('      investmentBacked += backed; notYetInvested -= backed;\n    }\n  });', '    }\n  });\n  investmentBacked = Math.min(financingProceeds, investmentSpend);');
const ANCIEN_C = s => s.replace('if(sellQty > allowedQty + 1e-9 && allowedQty > 1e-9 && price>0){', 'if(false){');

async function partie(transform){
  const eng = loadEngine({ transform });
  await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  return eng;
}
// Écritures du grand livre, dans l'ordre chronologique.
const ecrire = (eng, rows) => eng.run(`state.finLedger = state.finLedger.filter(e=>e.companyId!==A.id); ${rows.map(([roll, cat, amt]) => `logFin(A.id, '${cat}', ${amt}, ${roll});`).join(' ')}`);

(async () => {
  // ---------------------------------------------------------------- D
  const sD = async (transform) => {
    const eng = await partie(transform);
    // Terrain de 5 acheté au lancer 0 avec l'argent de l'IPO, puis emprunt de 5 au lancer 1 pour combler un déficit.
    ecrire(eng, [[0, 'land_purchase', -5], [1, 'loan_proceeds', 5]]);
    let u = eng.json('companyDebtProceedsUse(A.id, 0)');
    ok(near(u.investmentBacked, 0) && near(u.badFraction, 1), `terrain AVANT l'emprunt : dette non investie à 100 % — obtenu ${f4(u.badFraction * 100)} % (avant : 0 %, dette « productive »)`);
    // Intégration : spirale de détresse (ratio d'endettement au-dessus du seuil, marge négative) → pleine force.
    eng.run(`globalThis.__inj = []; injectStockCube = function(co, color, a, b){ if(co.id===A.id) __inj.push([color, a, b]); return 0; };
      companyDebtRatio = function(){ return 0.99; };
      const __is = incomeStatementFor; incomeStatementFor = function(id, s){ const r = __is(id, s); if(id===A.id){ r.totalRevenue = 1; r.totalExpense = 2; r.netIncome = -1; } return r; };
      state.gameClock.rollCount = 2;`);
    eng.run('advanceGameClock()');
    const full = eng.json(`__inj.some(x=>x[0]==='red' && x[1]===STOCK_DISTRESS_INJECT_MIN && x[2]===STOCK_DISTRESS_INJECT_MAX)`);
    ok(full && eng.run('A.distressActive') === true, 'clôture du semestre : spirale de détresse à pleine force (3 à 5 rouges, distressActive)');
  };
  await scenario('D1 — terrain acheté avant l’emprunt : la dette ne compte pas comme investie', () => sD());
  await contre('D1c — contre-épreuve (investissements de toute la partie)', ANCIEN_D, sD);

  await scenario('D2 — investissements APRÈS l’emprunt : comptés, dans l’ordre', async () => {
    const eng = await partie();
    ecrire(eng, [[0, 'loan_proceeds', 5], [1, 'land_purchase', -5]]);
    let u = eng.json('companyDebtProceedsUse(A.id, 0)');
    ok(near(u.investmentBacked, 5) && near(u.badFraction, 0), `emprunt de 5 puis terrain de 5 : dette investie à 100 % (non investie ${f4(u.badFraction * 100)} %)`);
    ecrire(eng, [[0, 'land_purchase', -2], [0, 'loan_proceeds', 4], [1, 'house_construction', -1], [3, 'mortgage_proceeds', 4], [4, 'land_purchase', -2], [5, 'etf_purchase', -3]]);
    u = eng.json('companyDebtProceedsUse(A.id, 1)');
    ok(near(u.investmentBacked, 6) && near(u.badFraction, 0.25), `terrain 2 (avant), emprunt 4, maison 1, hypothèque 4, terrain 2, REIT 3 : 6 investis sur 8 empruntés → non investi 25 % — obtenu ${f4(u.investmentBacked)} / ${f4(u.badFraction * 100)} % (avant : 8 / 0 %)`);
    u = eng.json('companyDebtProceedsUse(A.id, 0)');
    ok(near(u.investmentBacked, 1) && near(u.badFraction, 0.75), `limité au semestre 0 : 1 investi sur 4 → 75 % non investi — obtenu ${f4(u.badFraction * 100)} %`);
  });

  // ---------------------------------------------------------------- C
  // Alpha : 200 000 parts, plafond 15 % = 30 000 parts par an. Alice (CEO) en détient 60 000. Vente annoncée de 3 M$,
  // pile au plafond au cours de 0,0001 (100 $/part) ; à l'échéance, le cours a baissé de 1 % (0,000099).
  const sC = async (transform) => {
    const eng = await partie(transform);
    eng.run(`A.stockPrice = 0.000099; state.gameClock.rollCount = 6;
      globalThis.__ann = {id:'ann1', companyId:A.id, ceoId:A.ceoId, direction:'sell', amount:3, announcedAtRoll:0, executeAtRoll:6};
      state.ceoAnnouncements.push(__ann);`);
    const ceo = () => eng.json(`({cash: state.players[0].cash, shares: A.shareholders.find(s=>s.playerId===A.ceoId).shares})`);
    const c0 = ceo(), m0 = eng.cashTotal();
    eng.run(`executeCeoAnnouncement(__ann)`);
    const c1 = ceo();
    ok(near(c0.shares - c1.shares, 30000, 1e-6), `vente ramenée au plafond : 30 000 parts vendues — obtenu ${f4(c0.shares - c1.shares)} (avant : vente annulée, 0)`);
    ok(near(c1.cash - c0.cash, 2.97), `Alice encaisse 30 000 × 0,000099 = 2,97 — obtenu ${f4(c1.cash - c0.cash)}`);
    ok(near(eng.run('ceoSharesSoldInYear(A.id, currentGameYear())'), 30000), 'registre des ventes CEO de l’année : 30 000 parts (plafond atteint)');
    const ex = eng.json('state.ceoAnnouncementExecutions[state.ceoAnnouncementExecutions.length-1]');
    ok(ex.ok === true && near(ex.amount, 2.97) && near(ex.announcedAmount, 3), 'exécution enregistrée : 2,97 exécuté pour 3 annoncé');
    ok(/RAMENÉE au plafond/.test(JSON.stringify(eng.json('state.log.slice(0, 5)'))), 'journal : « RAMENÉE au plafond légal de vente CEO »');
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
    // Plafond déjà atteint cette année : une 2e vente est annulée (rien à vendre), comme avant.
    eng.run(`globalThis.__ann2 = {id:'ann2', companyId:A.id, ceoId:A.ceoId, direction:'sell', amount:0.5, announcedAtRoll:1, executeAtRoll:7}; state.ceoAnnouncements.push(__ann2); executeCeoAnnouncement(__ann2);`);
    const c2 = ceo();
    ok(near(c2.shares, c1.shares) && eng.json('state.ceoAnnouncementExecutions[state.ceoAnnouncementExecutions.length-1]').ok === false, '2e vente la même année, plafond atteint : annulée, aucune part vendue');
  };
  await scenario('C1 — vente CEO pile au plafond, cours −1 % à l’échéance : ramenée au plafond', () => sC());
  await contre('C1c — contre-épreuve (vente annulée en entier)', ANCIEN_C, sC);

  await scenario('C2 — vente CEO sous le plafond : exécutée telle quelle (inchangé)', async () => {
    const eng = await partie();
    eng.run(`A.stockPrice = 0.0001; state.gameClock.rollCount = 6;
      globalThis.__ann = {id:'ann3', companyId:A.id, ceoId:A.ceoId, direction:'sell', amount:1, announcedAtRoll:0, executeAtRoll:6};
      state.ceoAnnouncements.push(__ann); executeCeoAnnouncement(__ann);`);
    const ex = eng.json('state.ceoAnnouncementExecutions[state.ceoAnnouncementExecutions.length-1]');
    ok(ex.ok === true && near(ex.amount, 1) && near(ex.qty, 10000), 'vente de 1 (10 000 parts) exécutée en entier');
  });

  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (décisions de Julien) — ${n} vérifications`);
})();
