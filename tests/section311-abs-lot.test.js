// Test — Section 311, bogue 18 : deux ABS d'une même entreprise puis regroupement du lot -> la seconde n'est plus payée.
// Décision de Julien : « une titrisation n'est permise que sur un lot de couleur déjà regroupé ; les aéroports et
// services font exception et restent permis ». Refus à l'annonce, revérifié à la résolution. Parties en cours (ABS
// déjà émises sur un terrain seul, pas de migration rétroactive) : le regroupement du lot est refusé tant qu'une ABS
// court (ou est annoncée) sur un de ses terrains.
// Lancer depuis la racine du dépôt :  node tests/section311-abs-lot.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'C', 'D'], ['garp', 'garp', 'garp', 'garp']);
  run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2]; globalThis.D = state.companies[3];
       state.settings.features.revenueSwap = true; state.settings.features.loan = false; state.rentCompensations = [];
       globalThis.B1 = state.properties.find(p=>p.name==='Brun 1'); globalThis.B2 = state.properties.find(p=>p.name==='Brun 2');
       globalThis.AE1 = state.properties.find(p=>p.name==='Aéroport 1');
       [B1, B2, AE1].forEach(p=>{ p.owners = [{companyId:A.id, share:maxPlayerOwnPct()}]; p.mortgages = []; p.houses = 0; });
       B1.houses = 3; B2.houses = 3;
       C.cash += 50; D.cash += 50; B.cash += 500;
       globalThis.__alerts = []; alert = (m)=>{ __alerts.push(String(m)); };
       state.gameClock.rollCount = 0;`);
  return eng;
}
// ABS « d'une ancienne version » : émise sur un terrain seul, telle que resolveRevenueSwapListing la créait.
const legacyDeal = (id, prop, holder) => `({id:'${id}', sellerId:A.id, propertyIds:[${prop}.id], cededPctOfShare:0.6, years:5, yearsRemaining:5,
  pricing:{termRolls:30, meanRent:10, stdRent:2, seniorCapacity:8}, seniorPremiumPct:0.1, seniorRaised:1, juniorRaised:0,
  seniorCapTotal:1000, seniorPaidSoFar:0, seniorHolders:[{holderType:'company', holderId:${holder}.id, amount:1, receivedSoFar:0}], juniorHolders:[]})`;

// Scénario de l'audit : ABS1 sur Brun 1 (Co C), ABS2 sur Brun 2 (Co D), regroupement demandé, 10 passages de Co B.
async function scenarioAudit(eng){
  const { run } = eng;
  run(`state.revenueSwaps = [${legacyDeal('abs1', 'B1', 'C')}, ${legacyDeal('abs2', 'B2', 'D')}];`);
  await run(`mergeGroup('BRUN')`);
  const merged = run(`!!B1.groupMergeId`);
  const c0 = run(`C.cash`), d0 = run(`D.cash`), m0 = eng.cashTotal();
  for(let i = 0; i < 10; i++) await run(`settlePropertyRent(${i % 2 ? 'B2' : 'B1'}, B.id, 7, {skipSave:true})`);
  return { merged, toC: run(`C.cash`) - c0, toD: run(`D.cash`) - d0, dMasse: eng.cashTotal() - m0, alert: run(`__alerts.join(' | ')`) };
}

(async () => {
  // ---------- 1. Règle à l'annonce ----------
  console.log('1 — annonce : terrain de couleur seul refusé, lot regroupé / aéroport permis');
  {
    const eng = await setup();
    const { run } = eng;
    const r1 = await run(`postRevenueSwapListing(A.id, [B1.id], 0.6, 1, 2, {silent:true})`);
    ok(r1 && !r1.ok && /regroupé en lot/.test(r1.error), `annonce sur Brun 1 (terrain seul) refusée : « ${r1 && r1.error} »`);
    ok(run(`state.revenueSwapListings.length`) === 0, 'aucune annonce enregistrée');
    ok(run(`revenueSwapSellableItems(A.id).every(it=>it.id!==B1.id && it.id!==B2.id)`), 'la fenêtre de publication ne propose pas les terrains de couleur seuls');
    ok(run(`revenueSwapSellableItems(A.id).some(it=>it.id===AE1.id)`), 'la fenêtre de publication propose l’aéroport');
    const r2 = await run(`postRevenueSwapListing(A.id, [AE1.id], 0.6, 0.2, 2, {silent:true})`);
    ok(r2 && r2.ok, 'annonce sur Aéroport 1 (seul) acceptée : exception aéroports et services');
    run(`state.revenueSwapListings = [];`);
    await run(`mergeGroup('BRUN')`);
    ok(run(`!!B1.groupMergeId && B1.groupMergeId===B2.groupMergeId`), 'le lot Brun est regroupé');
    const r3 = await run(`postRevenueSwapListing(A.id, [B1.id, B2.id], 0.6, 1, 2, {silent:true})`);
    ok(r3 && r3.ok, 'annonce sur le lot Brun regroupé acceptée');
    ok(run(`state.revenueSwapListings[0].propertyIds.length`) === 1, 'le lot compte comme un seul actif dans l’annonce');
  }

  // ---------- 2. Revérification à la résolution ----------
  console.log('2 — résolution : une annonce d’une ancienne version sur un terrain seul est annulée sans mouvement d’argent');
  {
    const eng = await setup();
    const { run } = eng;
    run(`state.revenueSwapListings.push({id:'old', sellerId:A.id, propertyIds:[B1.id], cededPctOfShare:0.6, amountSought:1, years:2,
           pricing:computeAbsPricing(A.id, [B1.id], 0.6, 2), tranches:computeAbsTranches(computeAbsPricing(A.id, [B1.id], 0.6, 2), 1),
           seniorSubs:[{id:'s', holderType:'company', holderId:C.id, maxAmount:5}], juniorSubs:[], createdRoll:0});`);
    const a0 = run(`A.cash`), c0 = run(`C.cash`), m0 = eng.cashTotal();
    run(`maybeResolveRevenueSwapListings()`);
    ok(run(`state.revenueSwaps.length`) === 0 && run(`state.revenueSwapListings.length`) === 0, 'annonce retirée, aucun accord ABS créé');
    ok(near(run(`A.cash`), a0) && near(run(`C.cash`), c0) && near(eng.cashTotal(), m0), `aucun argent n'a bougé (A ${f(run('A.cash') - a0)}, C ${f(run('C.cash') - c0)})`);
    ok(/regroupé en lot/.test(run(`state.log[0] ? JSON.stringify(state.log.slice(0,3)) : ''`)), 'le journal explique l’annulation');
  }

  // ---------- 3. Partie en cours : deux ABS déjà émises sur Brun 1 et Brun 2 ----------
  console.log('3 — partie en cours : regroupement refusé tant que les deux ABS courent, chacune reste payée');
  {
    const eng = await setup();
    const { run } = eng;
    const rent1 = run(`colorRentAt(B1, B1.houses) * maxPlayerOwnPct()/100`), rent2 = run(`colorRentAt(B2, B2.houses) * maxPlayerOwnPct()/100`);
    const v = await scenarioAudit(eng);
    console.log(`  après correctif : regroupé ${v.merged} ; Co C reçoit ${f(v.toC)}, Co D reçoit ${f(v.toD)} ; Δ masse ${f(v.dMasse)}`);
    ok(!v.merged, 'regroupement du lot Brun refusé');
    ok(/émission ABS court/.test(v.alert), `message clair : « ${v.alert} »`);
    ok(near(v.toC, 5 * rent1 * 0.6) && near(v.toD, 5 * rent2 * 0.6), `chaque porteur touche sa part cédée : C ${f(v.toC)} (attendu ${f(5 * rent1 * 0.6)}), D ${f(v.toD)} (attendu ${f(5 * rent2 * 0.6)})`);
    ok(near(v.dMasse, 0), 'monnaie conservée sur les 10 passages');
    // Une fois les ABS échues, le regroupement redevient possible.
    run(`state.revenueSwaps = [];`);
    await run(`mergeGroup('BRUN')`);
    ok(run(`!!B1.groupMergeId`), 'après l’échéance des ABS, le regroupement est accepté');
  }

  // ---------- 4. Contre-épreuve : sans le refus de regroupement, la seconde ABS n'est plus payée ----------
  console.log('4 — contre-épreuve : ancien regroupement réintroduit');
  {
    const eng = await setup({ transform: (src) => src.replace(
      "if(state.revenueSwaps.concat(state.revenueSwapListings).some(s=>(s.propertyIds||[]).some(pid=>props.some(p=>p.id===pid)))) return",
      "if(false) return") });
    const v = await scenarioAudit(eng);
    console.log(`  code d'avant : regroupé ${v.merged} ; Co C reçoit ${f(v.toC)}, Co D reçoit ${f(v.toD)}`);
    ok(v.merged && v.toC > 0 && near(v.toD, 0), 'sans le correctif : lot regroupé, Co C touche tout et Co D (porteur de la 2e ABS) ne touche rien');
    const eng2 = await setup({ transform: (src) => src.replace(
      "if(p && p.type==='color' && !p.groupMergeId) return `", "if(false) return `") });
    const r = await eng2.run(`postRevenueSwapListing(A.id, [B1.id], 0.6, 1, 2, {silent:true})`);
    ok(r && r.ok, 'sans le correctif : l’annonce sur un terrain de couleur seul était acceptée');
  }

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
