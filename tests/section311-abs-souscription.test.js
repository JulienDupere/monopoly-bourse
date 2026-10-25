// Test — Section 311, bogue 20 : souscrire aux deux tranches d'une même ABS permettait de payer plus que son encaisse.
// Chaque tranche était plafonnée séparément à l'encaisse du souscripteur. Correctif : plafond sur le TOTAL, la senior
// étant répartie d'abord, la junior du même souscripteur plafonnée au reste de son encaisse.
// Lancer depuis la racine du dépôt :  node tests/section311-abs-souscription.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function scenario(opts, cash = 2){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'Carl'], ['garp', 'garp', null]);
  // Lot Vert regroupé, détenu par A, avec hôtels : capacité senior confortable. Carl (joueur) a 2 d'encaisse.
  run(`globalThis.A = state.companies[0]; globalThis.CARL = state.players.find(p=>p.name==='Carl');
       state.settings.features.revenueSwap = true; state.settings.features.loan = false;
       globalThis.V = ['Vert 1','Vert 2','Vert 3'].map(nm=>state.properties.find(p=>p.name===nm));
       V.forEach(p=>{ p.owners = [{companyId:A.id, share:maxPlayerOwnPct()}]; p.houses = 5; p.mortgages = []; p.groupMergeId = 'lot-vert'; });
       CARL.cash = ${cash}; state.gameClock.rollCount = 0;`);
  const cap = run(`computeAbsPricing(A.id, [V[0].id], 0.6, 5).seniorCapacity`);
  // Montant recherché : toute la capacité senior + 2 en junior.
  const r = await run(`postRevenueSwapListing(A.id, [V[0].id], 0.6, ${cap + 2}, 5, {silent:true})`);
  if(!r.ok) throw new Error(r.error);
  const tr = run(`JSON.stringify(state.revenueSwapListings[0].tranches)`);
  const lid = run(`state.revenueSwapListings[0].id`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'senior', 'player', CARL.id, 2, {silent:true})`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'junior', 'player', CARL.id, 2, {silent:true})`);
  const m0 = eng.cashTotal();
  run(`maybeResolveRevenueSwapListings()`);
  const deal = JSON.parse(run(`JSON.stringify(state.revenueSwaps[0]||null)`));
  return { cap, tr: JSON.parse(tr), carl: run(`CARL.cash`), deal, dMasse: eng.cashTotal() - m0, a: run(`A.cash`) };
}

(async () => {
  console.log('1 — Carl a 2, souscrit 2 en senior et 2 en junior (scénario de l’audit)');
  {
    const v = await scenario();
    const paidSenior = v.deal.seniorHolders.filter(h=>h.holderType==='player').reduce((s,h)=>s+h.amount,0);
    const paidJunior = v.deal.juniorHolders.filter(h=>h.holderType==='player').reduce((s,h)=>s+h.amount,0);
    console.log(`  capacité senior ${f(v.cap)} ; tranches senior ${f(v.tr.seniorAmount)} / junior ${f(v.tr.juniorAmount)} ; Carl paie ${f(paidSenior)} senior + ${f(paidJunior)} junior ; encaisse finale ${f(v.carl)}`);
    ok(v.tr.seniorAmount >= 2 && v.tr.juniorAmount >= 2, 'les deux tranches cherchent au moins 2 chacune');
    ok(near(paidSenior, 2), 'Carl obtient 2 en senior (servie d’abord)');
    ok(near(paidJunior, 0), 'rien en junior : son encaisse est épuisée');
    ok(v.carl >= -1e-9 && near(v.carl, 0), `encaisse de Carl jamais négative (${f(v.carl)})`);
    ok(near(v.dMasse, 0), 'monnaie conservée à la résolution');
    const ret = v.deal.juniorHolders.find(h=>h.holderType==='company');
    ok(ret && near(ret.amount, v.tr.juniorAmount), 'la junior non souscrite est retenue par l’émettrice (rétention, section 275)');
  }
  console.log('1b — Carl a 3 : 2 en senior, puis 1 en junior (le reste de son encaisse)');
  {
    const v = await scenario(undefined, 3);
    const paidJunior = v.deal.juniorHolders.filter(h=>h.holderType==='player').reduce((s,h)=>s+h.amount,0);
    ok(near(paidJunior, 1) && near(v.carl, 0), `junior plafonnée au reste : ${f(paidJunior)} payé, encaisse finale ${f(v.carl)}`);
  }
  console.log('2 — contre-épreuve : plafonds séparés par tranche réintroduits');
  {
    const v = await scenario({ transform: (src) => src.replace(
      "listing.juniorSubs.map(s=>clampCash(s, seniorAllocatedTo(s)))", "listing.juniorSubs.map(s=>clampCash(s, 0))") });
    console.log(`  code d'avant : encaisse finale de Carl ${f(v.carl)}`);
    ok(near(v.carl, -2), 'sans le correctif : Carl paie 4 avec 2 d’encaisse et finit à −2');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
