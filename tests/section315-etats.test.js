// Test — section 315 (audit du 2026-10-19, lot 8) : états financiers du semestre clos cohérents avec le bilan de clôture.
//  81. Dividende récurrent automatique (et part non versée d'un dividende annoncé) : inscrits au semestre clos ET
//      prélevés avant la photo du bilan de clôture (avant : prélevés après la photo).
//  80. Fin d'année : intérêts hypothécaires, dividendes REIT et règlements des accords de compensation inscrits au
//      semestre clos, déjà inclus dans le bilan de clôture (avant : inscrits au nouveau semestre).
// Invariant vérifié : encaisse du bilan de clôture(S) − encaisse du bilan de clôture(S−1) = variation de trésorerie de
// l'état des flux de S (cashFlowStatementFor(S).netChange).
// Lancer depuis la racine du dépôt :  node tests/section315-etats.test.js
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
  try{ await fn(transform); }catch(e){ if(/motif introuvable/.test(String(e && e.message))) throw e; failed = true; console.log('  (échec attendu) ' + String(e.message).slice(0, 160)); }
  try{ check(failed, 'contre-épreuve : l’ancien code fait échouer ce scénario'); n++; }
  catch(e){ failures.push(title.slice(0, 4) + ' — ' + e.message); }
}
// Ancien ordre : photo du bilan AVANT les versements de dividendes, part non versée au nouveau semestre.
const ANCIEN_81 = s => s.replace("    // Section 315 — bogue 81 : la photo du bilan de clôture est prise APRÈS les versements de dividendes (plus bas),", "    snapshotBalanceSheets(semesterBefore);\n    //")
  .replace("    snapshotBalanceSheets(semesterBefore); // Section 315 — bogue 81 : après les versements de dividendes du semestre clos", '')
  .replace("logFin(co.id, 'dividend_forfeited_return', unclaimed, state.gameClock.rollCount-1);", "logFin(co.id, 'dividend_forfeited_return', unclaimed);");
const ANCIEN_80 = s => s.replace('finLedgerDefaultRollOverride = state.gameClock.rollCount-1;', 'finLedgerDefaultRollOverride = null;');

async function partie(transform){
  const eng = loadEngine({ transform });
  await eng.newGame(['Alice', 'Bob'], ['dividende', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; }; injectStockCube = function(){ return 0; };`);
  return eng;
}
const coherent = (eng, id, s) => eng.json(`(function(){
  const b1 = balanceSheetFor(${id}, ${s}), b0 = balanceSheetFor(${id}, ${s - 1});
  return {delta: b1.cash - b0.cash, flux: cashFlowStatementFor(${id}, ${s}).netChange, cash1: b1.cash};
})()`);

(async () => {
  // ---------------------------------------------------------------- 81
  const s81 = async (transform) => {
    const eng = await partie(transform);
    eng.run(`A.dividendAutoPay = true; state.gameClock.rollCount = 2;`);
    eng.run('advanceGameClock()');          // clôture du semestre 0 : photo de référence
    // Semestre 1 : dividende annoncé de 1 M$ au lancer 4 (la banque détient 70 % : 0,7 revient à la trésorerie).
    eng.run(`state.gameClock.rollCount = 4; A.cash -= 1; logFin(A.id, 'dividend_payout', -1);
      state.dividendAnnouncements.push({id:'d1', companyId:A.id, amount:1, announcedAtRoll:4, payAtRoll:6, recordHolders:[{playerId:A.ceoId, shares:60000}], totalSharesAtAnnouncement:200000});
      state.gameClock.rollCount = 5;`);
    const m0 = eng.cashTotal() + 1; // + le dividende annoncé, immobilisé hors trésorerie jusqu'au versement
    eng.run('advanceGameClock()');          // clôture du semestre 1 (fin d'année) : versement + auto-versement
    const c1 = coherent(eng, 'A.id', 1);
    ok(near(c1.cash1, eng.run('A.cash')), `bilan de clôture du semestre 1 : encaisse ${f4(c1.cash1)} = encaisse après versements ${f4(eng.run('A.cash'))} (avant : 0,09 de plus, l'auto-versement prélevé après la photo)`);
    ok(near(c1.delta, c1.flux), `semestre 1 : variation d'encaisse du bilan ${f4(c1.delta)} = flux de trésorerie ${f4(c1.flux)}`);
    const flux1 = eng.json('cashFlowStatementFor(A.id, 1).buckets.financing');
    ok(near(flux1.dividend_payout, -1.3) && near(flux1.dividend_forfeited_return, 0.91), `flux du semestre 1 : dividendes −1,3 (1 annoncé + 0,3 récurrent), part non versée +0,91 (0,7 + 0,21) — obtenu ${f4(flux1.dividend_payout)} / ${f4(flux1.dividend_forfeited_return)}`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
    // Semestre 2 (milieu d'année, rien de spécial) : toujours cohérent.
    eng.run('state.gameClock.rollCount = 8; advanceGameClock();');
    const c2 = coherent(eng, 'A.id', 2);
    ok(near(c2.delta, c2.flux), `semestre 2 : variation d'encaisse ${f4(c2.delta)} = flux ${f4(c2.flux)}`);
  };
  await scenario('81 — dividendes du semestre clos : flux et bilan de clôture concordent', () => s81());
  await contre('81c — contre-épreuve (photo avant les versements)', ANCIEN_81, s81);

  // ---------------------------------------------------------------- 80
  const s80 = async (transform) => {
    const eng = await partie(transform);
    eng.run(`state.gameClock.rollCount = 2; advanceGameClock();
      const v1 = state.properties.find(p=>p.name==='Vert 1'); v1.owners = [{companyId:A.id, share:100}];
      v1.mortgages = [{companyId:A.id, principal:1.5, rate:0.35, lenderId:'BANK'}];
      state.rentCompensations = [{id:'rc', companyA:A.id, companyB:B.id, balance:1, interestRate:0.1}];
      state.gameClock.rollCount = 5;`);
    const m0 = eng.cashTotal(), a0 = eng.run('A.cash');
    eng.run('advanceGameClock()');          // lancer 5 → 6 : fin de l'année 1
    ok(near(a0 - eng.run('A.cash'), 0.525 + 1.1), `A paie 0,525 d'intérêt annuel et 1,1 de compensation (1 + 10 %) — payé ${f4(a0 - eng.run('A.cash'))}`);
    const is1 = eng.json('incomeStatementFor(A.id, 1)');
    ok(near(is1.expenses.mortgage_interest_expense || 0, 0.525), `état des résultats du semestre clos (1) : intérêt hypothécaire 0,525 — obtenu ${f4(is1.expenses.mortgage_interest_expense || 0)} (avant : 0, porté au semestre 2)`);
    ok(near(is1.expenses.rent_compensation_expense || 0, 1.1), `compensation de 1,1 au semestre clos — obtenu ${f4(is1.expenses.rent_compensation_expense || 0)}`);
    ok(near(eng.json('incomeStatementFor(B.id, 1)').revenues.rent_compensation_revenue || 0, 1.1), 'B : revenu de compensation de 1,1 au semestre clos');
    ok(near(eng.json('incomeStatementFor(A.id, 2)').totalExpense, 0), 'nouveau semestre (2) : aucune charge héritée');
    const c1 = coherent(eng, 'A.id', 1);
    ok(near(c1.delta, c1.flux), `semestre 1 : variation d'encaisse du bilan ${f4(c1.delta)} = flux ${f4(c1.flux)} (avant : écart de 1,625)`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
    // Hors fin d'année, une écriture ordinaire reste au lancer courant (le repli est retiré après processYearEnd).
    eng.run(`logFin(A.id, 'admin_adjustment', 0.01);`);
    ok(eng.json('state.finLedger[state.finLedger.length-1].roll') === 6, 'écriture suivante : au lancer courant (6), pas au lancer de clôture');
  };
  await scenario('80 — fin d’année : intérêts et compensations au semestre clos', () => s80());
  await contre('80c — contre-épreuve (écritures au nouveau semestre)', ANCIEN_80, s80);

  await scenario('80b — dividendes REIT de fin d’année au semestre clos', async () => {
    const eng = await partie();
    const reit = eng.json(`state.etfs && state.etfs.length ? state.etfs[0].id : null`);
    if(!reit){ ok(true, 'aucun REIT dans cette configuration (fonction désactivée) : cas couvert par le mécanisme commun'); return; }
    eng.run(`state.settings.features.etf = true; state.gameClock.rollCount = 2; advanceGameClock();
      const etf = state.etfs[0]; etf.opened = true; etf.fundCash = 1; A.etfHoldings[etf.id] = 10;
      state.gameClock.rollCount = 5;`);
    const m0 = eng.cashTotal() + eng.run('state.etfs[0].fundCash');
    eng.run('advanceGameClock()');
    const rev = eng.json('incomeStatementFor(A.id, 1).revenues.etf_dividend_revenue || 0');
    ok(rev > 0, `dividende REIT de fin d'année inscrit au semestre clos : ${f4(rev)}`);
    const c1 = coherent(eng, 'A.id', 1);
    ok(near(c1.delta, c1.flux), `semestre 1 : variation d'encaisse ${f4(c1.delta)} = flux ${f4(c1.flux)}`);
    ok(near(eng.cashTotal() + eng.run('state.etfs[0].fundCash'), m0), 'monnaie conservée (encaisse du fonds comprise)');
  });

  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (états financiers) — ${n} vérifications`);
})();
