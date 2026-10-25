// Test — Section 311, bogue 42 : souscrire à une ABS faisait disparaître le montant investi du bilan du souscripteur.
// Décision de Julien : le souscripteur garde un actif à son bilan. Méthode retenue : flux restant à recevoir selon le
// modèle de tarification (computeAbsPricing sur les lancers restants), répartis selon la cascade senior/junior, au
// prorata de la mise ; non actualisé (comme les prêts à recevoir) ; ce qui est encaissé sort de la valeur ; 0 à
// l'échéance ; la rétention junior de l'émettrice n'est pas comptée.
// Retouche de la revue : sans contrepartie, le flux était compté deux fois (l'émettrice garde son terrain à pleine
// valeur). L'émettrice inscrit un contre-actif « Flux ABS cédés » égal à la valeur des parts tenues par des tiers,
// calculée par la même fonction : la somme des companyValue ne bouge plus sans monnaie déplacée. Pas de dette côté
// émettrice (companyDebt inchangé). Joueur porteur : titres dans netWorth, pas dans marginableNetWorth.
// Lancer depuis la racine du dépôt :  node tests/section311-abs-bilan.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'C', 'Carl'], ['garp', 'garp', 'garp', null]);
  run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
       globalThis.CARL = state.players.find(p=>p.name==='Carl');
       state.settings.features.revenueSwap = true; state.settings.features.loan = false; state.rentCompensations = [];
       globalThis.V = ['Vert 1','Vert 2','Vert 3'].map(nm=>state.properties.find(p=>p.name===nm));
       V.forEach(p=>{ p.owners = [{companyId:B.id, share:maxPlayerOwnPct()}]; p.houses = 5; p.mortgages = []; p.groupMergeId = 'lot-vert'; });
       A.cash += 30; C.cash += 300; CARL.cash += 20; state.gameClock.rollCount = 0;
       globalThis.sumValues = ()=> state.companies.reduce((s,c)=>s+companyValue(c), 0);
       globalThis.sumHoldings = ()=> state.companies.reduce((s,c)=>s+companyAbsHoldingsValue(c.id), 0) + state.players.reduce((s,p)=>s+absHoldingsValueOf('player', p.id), 0);
       globalThis.sumCeded = ()=> state.companies.reduce((s,c)=>s+companyAbsCededValue(c.id), 0);`);
  return eng;
}
// B émet une ABS de 3 ans sur le lot Vert : capacité senior + `junior` en junior. subs : [tranche, type, qui, max].
async function emission(eng, junior, subs){
  const { run } = eng;
  const cap = run(`computeAbsPricing(B.id, [V[0].id], 0.6, 3).seniorCapacity`);
  const r = await run(`postRevenueSwapListing(B.id, [V[0].id], 0.6, ${cap + junior}, 3, {silent:true})`);
  if(!r.ok) throw new Error(r.error);
  const lid = run(`state.revenueSwapListings[0].id`);
  for(const [tranche, type, who, max] of subs) await run(`subscribeRevenueSwapTranche('${lid}', '${tranche}', '${type}', ${who}.id, ${max}, {silent:true})`);
  const before = { vA: run(`companyValue(A)`), vB: run(`companyValue(B)`), sum: run(`sumValues()`), cashA: run(`A.cash`),
    debtB: run(`companyDebt(B)`), nwCarl: run(`netWorth(CARL)`), cashCarl: run(`CARL.cash`) };
  run(`maybeResolveRevenueSwapListings()`);
  return { cap, before };
}
const balanced = (run) => near(run(`sumHoldings()`), run(`sumCeded()`));

(async () => {
  console.log('1 — senior (A) + junior (C) : actif chez les porteurs, contre-actif chez l’émettrice');
  {
    const eng = await setup();
    const { run, json } = eng;
    const { before } = await emission(eng, 2, [['senior', 'company', 'A', 5], ['junior', 'company', 'C', 1]]);
    const deal = json(`state.revenueSwaps[0]`);
    const asset = run(`companyAbsHoldingsValue(A.id)`), ceded = run(`companyAbsCededValue(B.id)`);
    const E = run(`computeAbsPricing(B.id, [V[0].id], 0.6, 3).meanRent`);
    const expectedAsset = Math.min(E, deal.seniorCapTotal) * (5 / deal.seniorRaised);
    console.log(`  A paie 5 ; actif ABS de A ${f(asset)} ; contre-actif de B ${f(ceded)} ; somme des valeurs ${f(before.sum)} -> ${f(run('sumValues()'))}`);
    ok(near(before.cashA - run(`A.cash`), 5), 'A paie 5 à la résolution');
    ok(near(asset, expectedAsset), `actif de A = min(flux attendus, plafond senior) × part de A (${f(expectedAsset)})`);
    ok(near(run(`companyValue(A)`), before.vA - 5 + asset), 'valeur de A = avant − 5 + actif ABS (la mise ne disparaît plus)');
    ok(near(ceded, asset + run(`companyAbsHoldingsValue(C.id)`)), 'contre-actif de B = parts des tiers (A senior + C junior), même calcul');
    ok(near(run(`sumValues()`), before.sum), 'somme des companyValue inchangée à la résolution (aucune valeur créée)');
    ok(near(run(`companyDebt(B)`), before.debtB), 'pas de dette côté émettrice (companyDebt inchangé)');
    const bsA = json(`balanceSheetFor(A.id, Math.floor(state.gameClock.rollCount/3))`), bsB = json(`balanceSheetFor(B.id, Math.floor(state.gameClock.rollCount/3))`);
    ok(near(bsA.absReceivable, asset) && near(bsA.assetsLongTerm, bsA.realEstate + bsA.mortgageReceivable + asset), 'bilan de A : « Titres ABS détenus » dans les actifs long terme');
    ok(near(bsB.absCeded, ceded) && near(bsB.assetsLongTerm, bsB.realEstate + bsB.mortgageReceivable - ceded), 'bilan de B : « Flux ABS cédés » en contre-actif');
    run(`snapshotBalanceSheets()`);
    ok(near(json(`state.balanceSheetSnapshots.find(s=>s.companyId===B.id && s.semesterIndex===Math.floor(state.gameClock.rollCount/3))`).absCeded, ceded), 'instantané de semestre : même contre-actif');
    ok(near(run(`companyAbsHoldingsValue(B.id)`), 0), 'émettrice : sa rétention junior n’est pas comptée');

    console.log('2 — versements : la valeur passe de l’actif à la trésorerie, la somme ne bouge pas');
    for(let i = 0; i < 3; i++){
      const s0 = run(`sumValues()`), vA0 = run(`companyValue(A)`), cash0 = run(`A.cash`), a0 = run(`companyAbsHoldingsValue(A.id)`);
      await run(`settlePropertyRent(V[${i % 3}], C.id, 7, {skipSave:true})`);
      const received = run(`A.cash`) - cash0, a1 = run(`companyAbsHoldingsValue(A.id)`);
      console.log(`  versement ${i + 1} : A reçoit ${f(received)}, actif ${f(a0)} -> ${f(a1)} ; somme des valeurs Δ ${f(run('sumValues()') - s0)}`);
      ok(near(run(`sumValues()`), s0), `versement ${i + 1} : somme des companyValue inchangée`);
      ok(near(a0 - a1, received) && near(run(`companyValue(A)`), vA0), `versement ${i + 1} : l’actif de A baisse de ce qu’elle encaisse, sa valeur ne bouge pas`);
      ok(balanced(run), `versement ${i + 1} : actifs des porteurs = contre-actif de l’émettrice`);
    }
    console.log('3 — échéance : actif et contre-actif tombent à 0 ensemble');
    for(let i = 0; i < 17; i++){ run(`advanceGameClock()`); if(!balanced(run)) break; }
    ok(balanced(run) && run(`state.revenueSwaps.length`) === 1, 'jusqu’au dernier lancer : actifs = contre-actif');
    run(`advanceGameClock()`);
    ok(run(`state.revenueSwaps.length`) === 0 && near(run(`sumHoldings()`), 0) && near(run(`sumCeded()`), 0), 'après 3 ans : accord échu, actif et contre-actif nuls');
  }
  console.log('4 — « junior bradée » (A prend aussi la junior pour 0,01) : transfert de valeur réel, aucune création');
  {
    const eng = await setup();
    const { run } = eng;
    const { before } = await emission(eng, 0.01, [['senior', 'company', 'A', 50], ['junior', 'company', 'A', 0.01]]);
    const dA = run(`companyValue(A)`) - before.vA, dB = run(`companyValue(B)`) - before.vB;
    console.log(`  valeur de A Δ ${f(dA)}, de B Δ ${f(dB)} ; somme Δ ${f(run('sumValues()') - before.sum)}`);
    ok(near(run(`sumValues()`), before.sum) && near(dA, -dB), 'somme inchangée : ce que A gagne, B (qui brade sa junior) le perd');
  }
  console.log('5 — rétention et annulation');
  {
    const eng = await setup();
    const { run } = eng;
    const { before } = await emission(eng, 2, [['senior', 'company', 'A', 5]]); // junior entièrement retenue par B
    ok(near(run(`sumValues()`), before.sum) && balanced(run), 'junior retenue par l’émettrice : somme inchangée, rétention ni à l’actif ni au contre-actif');
    const eng2 = await setup();
    const r2 = await emission(eng2, 2, [['junior', 'company', 'A', 1]]); // aucun senior : émission annulée
    ok(eng2.run(`state.revenueSwaps.length`) === 0 && near(eng2.run(`sumValues()`), r2.before.sum), 'émission annulée : rien ne bouge');
  }
  console.log('6 — joueur porteur : titres dans netWorth, pas dans marginableNetWorth');
  {
    const eng = await setup();
    const { run } = eng;
    const { before } = await emission(eng, 2, [['senior', 'company', 'A', 5], ['junior', 'player', 'CARL', 1]]);
    const held = run(`absHoldingsValueOf('player', CARL.id)`);
    ok(held > 0 && near(run(`netWorth(CARL)`), before.nwCarl - 1 + held), `netWorth de Carl = avant − 1 + titres (${f(held)})`);
    ok(near(run(`marginableNetWorth(CARL)`), run(`netWorth(CARL)`) - held), 'marginableNetWorth exclut le titre (non liquide)');
    ok(near(run(`sumValues()`) + run(`netWorth(CARL)`) - before.nwCarl, before.sum), 'entreprises + joueur : aucune valeur créée');
  }
  console.log('7 — contre-épreuve : sans le contre-actif');
  {
    const eng = await setup({ transform: (src) => src.replace("+ (receiv.absHoldings||0) - (receiv.absCeded||0) - companyDebt(company);", "+ (receiv.absHoldings||0) - companyDebt(company);") });
    const { run } = eng;
    const { before } = await emission(eng, 2, [['senior', 'company', 'A', 5], ['junior', 'company', 'C', 1]]);
    console.log(`  code d'avant : somme des valeurs ${f(before.sum)} -> ${f(run('sumValues()'))}`);
    ok(run(`sumValues()`) > before.sum + 1, 'sans le contre-actif : la somme des companyValue monte sans aucune monnaie déplacée');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
