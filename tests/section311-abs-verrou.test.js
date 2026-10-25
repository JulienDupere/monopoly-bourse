// Test — Section 311, bogue 21 : une ABS était conclue même si le terrain avait été hypothéqué (ou swappé, vendu)
// entre l'annonce et la résolution : les souscripteurs payaient pour un flux qui n'existait plus.
// Correctif : le terrain est verrouillé dès l'annonce (vente, échange, hypothèque, swap de loyers) et tout est
// revérifié à la résolution (hypothèque, autre ABS, part détenue, loyer attendu) ; sinon annulation propre.
// Lancer depuis la racine du dépôt :  node tests/section311-abs-verrou.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'C'], ['garp', 'garp', 'garp']);
  run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
       state.settings.features.revenueSwap = true; state.settings.features.loan = false; state.settings.features.rentSwap = true;
       state.settings.mortgageRentContinues = false; state.rentCompensations = [];
       globalThis.BF1 = state.properties.find(p=>p.name==='Bleu foncé 1'); globalThis.BF2 = state.properties.find(p=>p.name==='Bleu foncé 2');
       [BF1, BF2].forEach(p=>{ p.owners = [{companyId:A.id, share:maxPlayerOwnPct()}]; p.mortgages = []; p.groupMergeId = 'lot-bf'; });
       BF1.houses = 4; BF2.houses = 4;
       globalThis.AE = state.properties.find(p=>p.name==='Aéroport 1'); AE.owners = [{companyId:B.id, share:maxPlayerOwnPct()}]; AE.mortgages = [];
       C.cash += 50; B.cash += 500; state.gameClock.rollCount = 0;`);
  return eng;
}
// A annonce une ABS sur le lot Bleu foncé ; C souscrit 3 (senior et junior : le plafond total joue, section 311 bogue 20).
async function announce(eng){
  const { run } = eng;
  const r = await run(`postRevenueSwapListing(A.id, [BF2.id], 0.6, 3, 2, {silent:true})`);
  if(!r.ok) throw new Error(r.error);
  const lid = run(`state.revenueSwapListings[0].id`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'senior', 'company', C.id, 3, {silent:true})`);
  await run(`subscribeRevenueSwapTranche('${lid}', 'junior', 'company', C.id, 3, {silent:true})`);
}
async function resolveAndVisit(eng, visits = 5){
  const { run } = eng;
  const c0 = run(`C.cash`), a0 = run(`A.cash`), m0 = eng.cashTotal();
  run(`maybeResolveRevenueSwapListings()`);
  const concluded = run(`state.revenueSwaps.length`) === 1;
  const cAfterResolution = run(`C.cash`);
  for(let i = 0; i < visits; i++) await run(`settlePropertyRent(BF2, B.id, 7, {skipSave:true})`);
  return { concluded, cPaid: c0 - cAfterResolution, cReceived: run(`C.cash`) - cAfterResolution, aDelta: run(`A.cash`) - a0,
    dMasse: eng.cashTotal() - m0, log: run(`state.log.slice(0,4).map(l=>l.text).join(' | ')`) };
}

(async () => {
  console.log('1 — verrou dès l’annonce');
  {
    const eng = await setup();
    const { run } = eng;
    await announce(eng);
    const m = await run(`issueMortgageLot('lot-bf', A.id, 'BANK', {silent:true})`);
    ok(m && !m.ok, `hypothèque du lot refusée pendant l’annonce : « ${m && m.error} »`);
    const s = await run(`sellMergedShare('lot-bf', A.id, B.id, 10, 1, {silent:true})`);
    ok(s && !s.ok, `vente d’une part du lot refusée : « ${s && s.error} »`);
    const x = await run(`executeShareSwap('lot', 'lot-bf', A.id, 10, 'prop', AE.id, B.id, 10, {silent:true})`);
    ok(x && !x.ok && /ABS/.test(x.error), `échange d’une part du lot refusé : « ${x && x.error} »`);
    const w = await run(`proposeRentSwap(BF2.id, A.id, AE.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    ok(w && !w.ok, `swap de loyers sur le lot refusé : « ${w && w.error} »`);
    // Retouche de la revue : pendant une simple annonce, le message ne dit pas que le revenu « a été vendu ».
    ok([m, s, x, w].every(r => /a annoncé une émission ABS/.test(r.error) && !/a été vendu|a vendu/.test(r.error)), 'messages propres à l’annonce (hypothèque, vente, échange, swap)');
    const r2 = await run(`postRevenueSwapListing(A.id, [BF1.id], 0.6, 1, 2, {silent:true})`);
    ok(r2 && !r2.ok && /en attente/.test(r2.error), `2e annonce sur le même lot refusée : « ${r2 && r2.error} »`);
    ok(run(`revenueSwapSellableItems(A.id).every(it=>it.id!==BF1.id && it.id!==BF2.id)`), 'le lot annoncé n’est plus proposé à la titrisation');
    run(`state.revenueSwapListings = [];`);
    const m2 = await run(`issueMortgageLot('lot-bf', A.id, 'BANK', {silent:true})`);
    ok(m2 && m2.ok, 'annonce retirée : le lot redevient hypothécable');
  }

  console.log('2 — revérification à la résolution (état modifié de force : ancienne version, saisie…)');
  const cases = [
    ['hypothèque de l’émettrice', `BF1.mortgages = [{companyId:A.id, principal:1, rate:0.1, lenderId:'BANK'}];`, /hypothéqué/],
    ['part réduite', `[BF1, BF2].forEach(p=>{ p.owners = [{companyId:A.id, share:40}, {companyId:B.id, share:maxPlayerOwnPct()-40}]; });`, /a diminué/],
    ['autre ABS conclue', `state.revenueSwaps.push({id:'x', sellerId:A.id, propertyIds:[BF1.id], cededPctOfShare:0.1, years:1, yearsRemaining:1, endRoll:6, seniorRaised:0, juniorRaised:0, seniorCapTotal:0, seniorPaidSoFar:0, seniorHolders:[], juniorHolders:[]});`, /autre émission ABS/],
    ['maisons vendues (loyer attendu en baisse)', `BF1.houses = 0; BF2.houses = 0;`, /loyer attendu/],
  ];
  for(const [label, mutate, re] of cases){
    const eng = await setup();
    const { run } = eng;
    await announce(eng);
    run(mutate);
    const before = run(`state.revenueSwaps.length`);
    const v = await resolveAndVisit(eng, 0);
    ok(run(`state.revenueSwaps.length`) === before && near(v.cPaid, 0) && near(v.aDelta, 0) && near(v.dMasse, 0),
      `${label} : émission annulée, personne ne paie (C ${f(-v.cPaid)}, A ${f(v.aDelta)})`);
    ok(re.test(v.log), `${label} : le journal donne la raison`);
  }
  {
    const eng = await setup();
    const { run } = eng;
    await announce(eng);
    run(`BF1.houses = 5;`); // construction permise : le loyer attendu monte, l'émission tient
    const v = await resolveAndVisit(eng, 0);
    ok(v.concluded && near(v.cPaid, 3), `maison construite depuis l’annonce : émission conclue, C paie ${f(v.cPaid)}`);
  }

  console.log('3 — scénario de l’audit : hypothèque après l’annonce, puis 5 passages de B');
  {
    const eng = await setup();
    const { run } = eng;
    await announce(eng);
    await run(`issueMortgageLot('lot-bf', A.id, 'BANK', {silent:true})`);
    const v = await resolveAndVisit(eng);
    console.log(`  après correctif : conclue ${v.concluded} ; C paie ${f(v.cPaid)}, reçoit ${f(v.cReceived)}`);
    const m2 = await run(`issueMortgageLot('lot-bf', A.id, 'BANK', {silent:true})`);
    ok(!m2.ok && /a vendu le revenu du lot Bleu foncé en ABS/.test(m2.error) && /tant que l'accord court/.test(m2.error), `accord conclu : message « vendu » (${m2.error})`);
    const logRes = run(`state.log.map(l=>l.text).find(t=>/Émission ABS de .* résolue/.test(t)) || ''`);
    ok(logRes && !/fusionner/.test(logRes) && /construire/.test(logRes), 'journal de résolution : plus de « libre de les fusionner en lot »');
    ok(v.concluded && near(v.cPaid, 3) && v.cReceived > 0, 'l’hypothèque a été refusée : l’ABS est conclue et C est payé');
  }
  console.log('4 — contre-épreuve : verrou limité aux ABS conclues et résolution sans revérification');
  {
    const eng = await setup({ transform: (src) => src
      .replace("return state.revenueSwaps.concat(state.revenueSwapListings||[]).some(s=>s.sellerId===companyId", "return state.revenueSwaps.some(s=>s.sellerId===companyId")
      .replace("if((host.mortgages||[]).some(m=>m.companyId===seller.id)){ absCancel(", "if(false){ absCancel(") });
    const { run } = eng;
    await announce(eng);
    const m = await run(`issueMortgageLot('lot-bf', A.id, 'BANK', {silent:true})`);
    const v = await resolveAndVisit(eng);
    console.log(`  code d'avant : hypothèque ${m.ok ? 'acceptée' : 'refusée'} ; conclue ${v.concluded} ; C paie ${f(v.cPaid)}, reçoit ${f(v.cReceived)}`);
    ok(m.ok && v.concluded && near(v.cPaid, 3) && near(v.cReceived, 0), 'sans le correctif : C paie 3 et ne reçoit rien (terrain hypothéqué)');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
