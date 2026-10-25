// Test — Section 311, bogue 42 : souscrire à une ABS faisait disparaître le montant investi du bilan du souscripteur.
// Décision de Julien : le souscripteur garde un actif à son bilan. Méthode retenue : flux restant à recevoir selon le
// modèle de tarification (computeAbsPricing sur les lancers restants), répartis selon la cascade senior/junior, au
// prorata de la mise ; non actualisé (comme les prêts à recevoir) ; ce qui est encaissé sort de la valeur ; 0 à
// l'échéance ; la rétention junior de l'émettrice n'est pas comptée ; pas de dette côté émettrice (voulu).
// Lancer depuis la racine du dépôt :  node tests/section311-abs-bilan.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'C'], ['garp', 'garp', 'garp']);
  run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
       state.settings.features.revenueSwap = true; state.settings.features.loan = false; state.rentCompensations = [];
       globalThis.V = ['Vert 1','Vert 2','Vert 3'].map(nm=>state.properties.find(p=>p.name===nm));
       V.forEach(p=>{ p.owners = [{companyId:B.id, share:maxPlayerOwnPct()}]; p.houses = 5; p.mortgages = []; p.groupMergeId = 'lot-vert'; });
       A.cash += 30; C.cash += 300; state.gameClock.rollCount = 0;`);
  return eng;
}
// B émet une ABS de 3 ans sur le lot Vert : capacité senior + 2 en junior. A souscrit 5 en senior, C 1 en junior.
async function emission(eng){
  const { run } = eng;
  const cap = run(`computeAbsPricing(B.id, [V[0].id], 0.6, 3).seniorCapacity`);
  const r = await run(`postRevenueSwapListing(B.id, [V[0].id], 0.6, ${cap + 2}, 3, {silent:true})`);
  if(!r.ok) throw new Error(r.error);
  const lid = run(`state.revenueSwapListings[0].id`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'senior', 'company', A.id, 5, {silent:true})`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'junior', 'company', C.id, 1, {silent:true})`);
  const vA0 = run(`companyValue(A)`), vB0 = run(`companyValue(B)`), cashA0 = run(`A.cash`);
  run(`maybeResolveRevenueSwapListings()`);
  return { vA0, vB0, cashA0, cap };
}

(async () => {
  console.log('1 — la souscription reste à l’actif du souscripteur');
  {
    const eng = await setup();
    const { run, json } = eng;
    const { vA0, vB0, cashA0, cap } = await emission(eng);
    const deal = json(`state.revenueSwaps[0]`);
    const paid = cashA0 - run(`A.cash`);
    const asset = run(`companyAbsHoldingsValue(A.id)`);
    const E = run(`computeAbsPricing(B.id, [V[0].id], 0.6, 3).meanRent`);
    const expectedAsset = Math.min(E, deal.seniorCapTotal) * (5 / deal.seniorRaised);
    console.log(`  A paie ${f(paid)} ; actif ABS ${f(asset)} (flux attendus ${f(E)}, plafond senior ${f(deal.seniorCapTotal)}) ; valeur de A ${f(vA0)} -> ${f(run('companyValue(A)'))}`);
    ok(near(paid, 5), 'A paie 5 à la résolution');
    ok(near(asset, expectedAsset), `actif = min(flux attendus, plafond senior) × part de A (${f(expectedAsset)})`);
    ok(asset >= 5 - 1e-9, 'l’actif couvre au moins la mise (la senior est tarifée sous la capacité)');
    ok(near(run(`companyValue(A)`), vA0 - 5 + asset), 'valeur de A = avant − 5 + actif ABS (la mise ne disparaît plus)');
    const bs = json(`balanceSheetFor(A.id, Math.floor(state.gameClock.rollCount/3))`);
    ok(near(bs.absReceivable, asset) && near(bs.assetsLongTerm, bs.realEstate + bs.mortgageReceivable + asset), 'bilan : ligne « Titres ABS détenus » comprise dans les actifs long terme');
    run(`snapshotBalanceSheets()`);
    ok(near(json(`state.balanceSheetSnapshots.find(s=>s.companyId===A.id && s.semesterIndex===Math.floor(state.gameClock.rollCount/3))`).absReceivable, asset), 'instantané de semestre : même montant');
    ok(near(run(`companyAbsHoldingsValue(B.id)`), 0), 'émettrice : sa rétention junior n’est pas comptée (ses terrains le sont déjà)');
    ok(run(`companyAbsHoldingsValue(C.id)`) > 0, 'porteur junior tiers : actif positif');

    console.log('2 — sans double compte : un versement senior déplace la valeur de l’actif vers la trésorerie');
    const vA1 = run(`companyValue(A)`), cash1 = run(`A.cash`);
    await run(`settlePropertyRent(V[1], C.id, 7, {skipSave:true})`);
    const received = run(`A.cash`) - cash1, asset2 = run(`companyAbsHoldingsValue(A.id)`);
    console.log(`  versement reçu ${f(received)} ; actif ${f(asset)} -> ${f(asset2)} ; valeur de A ${f(vA1)} -> ${f(run('companyValue(A)'))}`);
    ok(received > 0 && near(asset - asset2, received), 'l’actif baisse exactement du montant encaissé (plafond senior consommé)');
    ok(near(run(`companyValue(A)`), vA1), 'valeur de A inchangée par l’encaissement');

    console.log('3 — échéance : l’actif tombe à 0');
    for(let i = 0; i < 18; i++) run(`advanceGameClock()`);
    ok(run(`state.revenueSwaps.length`) === 0 && near(run(`companyAbsHoldingsValue(A.id)`), 0), 'après 3 ans, accord échu, actif nul');
  }
  console.log('4 — contre-épreuve : actif ABS retiré de la valeur');
  {
    const eng = await setup({ transform: (src) => src.replace("+ (receiv.absHoldings||0) - companyDebt(company);", "- companyDebt(company);") });
    const { run } = eng;
    const { vA0 } = await emission(eng);
    console.log(`  code d'avant : valeur de A ${f(vA0)} -> ${f(run('companyValue(A)'))}`);
    ok(near(run(`companyValue(A)`), vA0 - 5), 'sans le correctif : la valeur de A baisse exactement de la mise (5)');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
