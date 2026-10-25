// Test — Section 317 (seconde moitié), bogues 93 et 94 : journal de la subvention d'avance et du prêt de dernier recours.
//   93 : le journal de la subvention d'avance affichait un taux recalculé APRÈS la vente (dette alourdie) au lieu du
//        taux confirmé qui a fixé le prix.
//   94 : le prêt de dernier recours : libellé « Offre de prêt acceptée » (il n'y a pas d'offre) et classement parmi les
//        plus anciennes opérations des « Exécutions récentes ».
// Lancer depuis la racine du dépôt :  node tests/section317b-journal.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts = {}){
  const eng = loadEngine(opts);
  eng.sandbox.alert = () => {};
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
  eng.run(`injectStockCube = function(){ return 0; };`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push({msg: String(msg), entries: entries ? JSON.parse(JSON.stringify(entries)) : []}); return __realLog.apply(this, arguments); };`);
  return { eng, ids };
}

(async () => {
  console.log('Bogue 93 — taux affiché au journal de la subvention d\'avance');
  {
    const { eng } = await setup();
    eng.run(`state.settings.goAdvanceRate = 0.10; state.settings.debtSpreadFactor = 0.10; globalThis.C = state.companies[0];`);
    const before = eng.json(`(function(){ const c = goAdvanceConditions(C.id); return {amount: c.amount, rate: c.rate}; })()`);
    const total0 = eng.cashTotal();
    const res = await eng.run(`takeGoAdvance(C.id, {expectedOwed: C.goAdvancesOwed||0, expectedConditions: goAdvanceConditions(C.id), fromConfirm: true})`);
    ok(res.ok, 'subvention vendue après confirmation');
    const msg = eng.json(`__logs.find(l=>/subvention d'avance/.test(l.msg)).msg`);
    const rateAfter = eng.run(`riskAdjustedRate(state.settings.goAdvanceRate, C)`);
    console.log('  taux confirmé', (before.rate * 100).toFixed(1) + '%', '; taux recalculé après la vente', (rateAfter * 100).toFixed(1) + '%');
    ok(Math.abs(rateAfter - before.rate) > 0.0005, 'le scénario est discriminant : la vente alourdit la dette, le taux recalculé diffère du taux confirmé');
    ok(msg.includes(`(taux ${(before.rate * 100).toFixed(1)}%)`), `le journal affiche le taux confirmé ${(before.rate * 100).toFixed(1)}% (« ${msg} »)`);
    ok(near(eng.cashTotal(), total0), 'monnaie conservée');
    ok(msg.includes(`pour ${before.amount.toFixed(2)}`), `le montant du journal (${before.amount.toFixed(2)}) est celui de la fenêtre`);
  }

  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
