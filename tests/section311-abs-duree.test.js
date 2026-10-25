// Test — Section 311, bogue 19 : une ABS publiée au 2e semestre durait deux fois moins longtemps que la durée payée.
// Le prix suppose years × 6 lancers (computeAbsPricing) ; la durée était décomptée en fins d'année. Correctif : l'ABS
// est servie years × 6 lancers à partir de sa résolution (deal.endRoll), quelle que soit la date de publication.
// Lancer depuis la racine du dépôt :  node tests/section311-abs-duree.test.js
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
       globalThis.AE = state.properties.find(p=>p.name==='Aéroport 1');
       AE.owners = [{companyId:A.id, share:maxPlayerOwnPct()}]; AE.mortgages = [];
       C.cash += 50; B.cash += 500;`);
  return eng;
}

// Publie au lancer `startRoll` une ABS de `years` an(s) sur l'aéroport, la fait résoudre, puis joue des lancers :
// à chaque lancer, Co B visite l'aéroport, puis l'horloge avance. Renvoie le nombre de lancers servis.
async function scenario(eng, startRoll, years){
  const { run, json } = eng;
  run(`state.gameClock.rollCount = ${startRoll}; state.revenueSwaps = []; state.revenueSwapListings = [];`);
  const r = await run(`postRevenueSwapListing(A.id, [AE.id], 0.6, 0.05, ${years}, {silent:true})`);
  if(!r || !r.ok) throw new Error('publication refusée : ' + (r && r.error));
  const lid = run(`state.revenueSwapListings[0].id`);
  await run(`subscribeRevenueSwapTranche(${JSON.stringify(lid)}, 'junior', 'company', C.id, 5, {silent:true})`);
  const termRolls = run(`state.revenueSwapListings[0].pricing.termRolls`);
  run(`maybeResolveRevenueSwapListings()`);
  const servedRolls = [];
  let paidToHolder = 0;
  const m0 = eng.cashTotal();
  for(let i = 0; i < 24; i++){
    const roll = run(`state.gameClock.rollCount`);
    const active = run(`state.revenueSwaps.length`) === 1;
    const c0 = run(`C.cash`);
    await run(`settlePropertyRent(AE, B.id, 7, {skipSave:true})`);
    if(active) servedRolls.push(roll);
    paidToHolder += run(`C.cash`) - c0;
    run(`advanceGameClock()`);
  }
  const lastLog = json(`state.log.map(l=>l.text).find(t=>/arrive à échéance/.test(t)) || ''`);
  return { termRolls, servedRolls, paidToHolder, dMasse: eng.cashTotal() - m0, lastLog };
}

(async () => {
  console.log('1 — ABS d’un an publiée au 2e semestre (lancer 3)');
  {
    const eng = await setup();
    const v = await scenario(eng, 3, 1);
    console.log(`  tarifée sur ${v.termRolls} lancers ; servie aux lancers ${v.servedRolls.join(', ')} ; porteur ${f(v.paidToHolder)}`);
    ok(v.termRolls === 6, 'le prix suppose 6 lancers');
    ok(v.servedRolls.length === 6, `servie 6 lancers (obtenu ${v.servedRolls.length})`);
    ok(v.servedRolls[0] === 3 && v.servedRolls[5] === 8, 'du lancer 3 au lancer 8 inclus');
    ok(/après 1 an\(s\)/.test(v.lastLog), 'message d’échéance « après 1 an(s) »');
    ok(near(v.dMasse, 0), 'monnaie conservée');
  }
  console.log('2 — ABS de deux ans publiée au 1er semestre (lancer 6) : inchangée, 12 lancers');
  {
    const eng = await setup();
    const v = await scenario(eng, 6, 2);
    ok(v.servedRolls.length === 12 && v.servedRolls[0] === 6 && v.servedRolls[11] === 17, `servie 12 lancers, du lancer 6 au lancer 17 (obtenu ${v.servedRolls.length})`);
  }
  console.log('3 — durée restante affichée et accord d’une ancienne version');
  {
    const eng = await setup();
    const { run } = eng;
    run(`state.gameClock.rollCount = 3; state.revenueSwaps = [];`);
    await run(`postRevenueSwapListing(A.id, [AE.id], 0.6, 0.05, 1, {silent:true})`);
    await run(`subscribeRevenueSwapTranche(state.revenueSwapListings[0].id, 'junior', 'company', C.id, 5, {silent:true})`);
    run(`maybeResolveRevenueSwapListings()`);
    ok(run(`state.revenueSwaps[0].endRoll`) === 9, 'endRoll = lancer de résolution (3) + 6');
    for(let i = 0; i < 3; i++) run(`advanceGameClock()`);
    ok(near(run(`state.revenueSwaps[0].yearsRemaining`), 0.5), `au lancer 6 (fin d'année), durée restante 0,5 an (obtenu ${run('state.revenueSwaps[0].yearsRemaining')})`);
    // Accord d'une ancienne version (sans endRoll) : migrateState lui donne null, décompte annuel conservé.
    run(`state.gameClock.rollCount = 3; state.revenueSwaps = [{id:'old', sellerId:A.id, propertyIds:[AE.id], cededPctOfShare:0.6, years:1, yearsRemaining:1,
           pricing:{termRolls:6, meanRent:1, stdRent:0, seniorCapacity:1}, seniorPremiumPct:0.1, seniorRaised:0.05, juniorRaised:0, seniorCapTotal:0.06,
           seniorPaidSoFar:0, seniorHolders:[], juniorHolders:[]}]; migrateState(state);`);
    ok(run(`state.revenueSwaps[0].endRoll`) === null, 'migrateState : endRoll = null pour un accord existant');
    for(let i = 0; i < 3; i++) run(`advanceGameClock()`);
    ok(run(`state.revenueSwaps.length`) === 0, 'accord d’une ancienne version : échu à la fin d’année, comme avant (pas de migration rétroactive)');
  }
  console.log('4 — contre-épreuve : décompte en fins d’année réintroduit');
  {
    const eng = await setup({ transform: (src) => src.replace(
      "endRoll: state.gameClock.rollCount + listing.years*6,", "endRoll: null,") });
    const v = await scenario(eng, 3, 1);
    console.log(`  code d'avant : tarifée sur ${v.termRolls} lancers, servie aux lancers ${v.servedRolls.join(', ')}`);
    ok(v.servedRolls.length === 3, 'sans le correctif : servie 3 lancers seulement pour 6 payés');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
