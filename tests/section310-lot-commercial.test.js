// Test — section 310 (lot 3 de l'audit du 2026-10-19) : lot commercial.
// Décision de Julien, verbatim : « lot commercial : le gagnant ne débourse rien sur le moment, seul le différentiel
// entre revenus comptés et mise est réglé (vérifier et corriger si besoin) ».
// 1. Vérification : c'est déjà le cas (aucun mouvement à l'enchère ni au passage sur une case du lot ; en fin
//    d'année, seul l'écart loyers comptés − mise passe entre le gagnant et les autres entreprises).
// 2. Question de conception de l'audit (« la mise n'a aucune limite et aucun lien avec la trésorerie ») : le lot 3 avait
//    ajouté une limite « mise ≤ encaisse » (seule et cumulée avec les mises REIT). Réponse de Julien (2026-10-25),
//    verbatim : « Non, si je possède 2M en encaisse mais que je mise 4M pour le lot commercial c'est correct. […] c'est
//    pas un vrai transfert d'argent jusqua la toute fin. » La limite est retirée (dépôt, résolution, total des mises
//    REIT) ; les scénarios B, C, E, F le prouvent, avec contre-épreuve qui réintroduit la limite du lot 3.
// 3. Le règlement du pari est une fonction réutilisable (settleTerrainLotYearEnd), à brancher en fin de partie par
//    la section 316 : appelée en cours d'année, elle règle les loyers comptés jusque-là, une seule fois.
// Lancer depuis la racine du dépôt :  node tests/section310-lot-commercial.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

async function setup(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2]; globalThis.D = state.companies[3];
           state.settings.features.terrainLot = true; state.gameClock.rollCount = 1;
           A.cash = 5; B.cash = 5; C.cash = 5; D.cash = 5;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});`);
  const E = { eng, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.cashes = () => E.json('[A.cash, B.cash, C.cash, D.cash]');
  return E;
}
const resolve = E => E.run(`act(async ()=>{ maybeResolveTerrainLotAuction(); return {ok:true}; })`);
const yearEnd = E => E.run(`act(async ()=>{ settleTerrainLotYearEnd(currentGameYear(), state.gameClock.rollCount); return {ok:true}; })`);
// Co Bob lance les dés depuis GO : 1 + 1 = 2, il tombe sur la case 2 (1re case du lot).
async function landOnLot(E){
  const real = Math.random;
  Math.random = () => 0;
  try{ await E.run(`act(async ()=>{ B.position = 0; await corePerformDiceRoll(B); return {ok:true}; })`); }
  finally{ Math.random = real; }
}

(async () => {
  await scenario('A. Vérification — le gagnant ne débourse rien ; seul l’écart loyers comptés − mise est réglé', async () => {
    const E = await setup();
    E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 2, 0.5, 2)`);
    const T0 = E.cash(), c0 = E.cashes();
    await resolve(E);
    ok(E.run('state.terrainLot.active.companyId === A.id') && JSON.stringify(E.cashes()) === JSON.stringify(c0), 'enchère gagnée par Co Alice (mise 2, loyer 0,5, 2 cases) : aucune encaisse ne bouge');
    const b0 = E.run('B.cash');
    await landOnLot(E);
    ok(E.run('B.position') === 2 && near(E.run('state.terrainLot.active.accrued'), 0.5), 'Co Bob tombe sur la case 2 : 0,5 compté au pari');
    ok(near(E.run('B.cash'), b0) && /aucune transaction immédiate/.test(E.json('state.log.map(l=>l.text).join(" | ")')), 'Co Bob ne paie rien sur le moment');
    E.run('state.terrainLot.active.accrued += 1'); // deux autres passages : 1,5 comptés au total
    await yearEnd(E);
    const c1 = E.cashes();
    console.log(`    pari raté (1,5 comptés pour une mise de 2) : encaisses ${c0.map(x => x.toFixed(4)).join(' / ')} → ${c1.map(x => x.toFixed(4)).join(' / ')}`);
    ok(near(c1[0], 4.5) && [1, 2, 3].every(i => near(c1[i], 5 + 0.5 / 3)), 'fin d’année : Co Alice verse l’écart 0,5, soit 0,1667 à chacune des 3 autres');
    ok(near(E.cash(), T0) && E.run('state.terrainLot.active') === null && near(E.run('state.terrainLot.lastResult.balance'), -0.5), 'monnaie conservée, pari clos (solde −0,5 conservé dans lastResult)');
    // Pari gagné.
    E.run('state.gameClock.rollCount = 7; as(A);'); await E.run(`submitTerrainLotBid(A.id, 2, 0.5, 2)`);
    await resolve(E);
    E.run('state.terrainLot.active.accrued = 3.5');
    const c2 = E.cashes();
    await yearEnd(E);
    const c3 = E.cashes();
    ok(near(c3[0] - c2[0], 1.5) && [1, 2, 3].every(i => near(c2[i] - c3[i], 0.5)), 'pari gagné (3,5 comptés pour 2) : chaque autre entreprise verse 0,5, Co Alice encaisse 1,5');
    ok(near(E.cash(), T0), 'monnaie conservée');
  });

  // Ancien code du lot 3 (contre-épreuves) : limite « mise ≤ encaisse » au dépôt (seule et cumulée) et à la résolution.
  const LOT3_DEPOT = src => src.replace("    // Section 310 — réponse de Julien (2026-10-25) : « c'est pas un vrai transfert d'argent jusqu'à la toute fin ». Plus\n",
    "    if(clampedPrice>0 && clampedPrice>co.cash+1e-9) return {ok:false, error:'mise supérieure à l\\'encaisse (perte maximale)'};\n" +
    "    { const etfC = state.settings.features.etf ? etfCommittedBidTotal(companyId) : 0; const prevB = ((state.terrainLot.bids||[]).find(x=>x.companyId===companyId)||{}).price||0;\n" +
    "      if(clampedPrice>0 && clampedPrice+etfC>co.cash+1e-9 && clampedPrice>prevB+1e-9) return {ok:false, error:'lot commercial et mises REIT au-delà de l\\'encaisse'}; }\n" +
    "    // Section 310 — réponse de Julien (2026-10-25) : « c'est pas un vrai transfert d'argent jusqu'à la toute fin ». Plus\n");
  const LOT3_RESOLUTION = src => src.replace("  const bids = state.terrainLot.bids;\n  state.terrainLot.bids = [];",
    "  const bids = state.terrainLot.bids.filter(b=>{ const bidder = companyById(b.companyId); if(b.price>0 && b.price>bidder.cash+1e-9){ log('La mise de '+bidder.name+' sur le lot commercial est écartée'); return false; } return true; });\n  state.terrainLot.bids = [];");

  await scenario('B. Réponse de Julien — Co Alice (2 M$ d’encaisse) mise 4 M$ sur le lot ; 2,5 M$ comptés', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => LOT3_RESOLUTION(LOT3_DEPOT(s)) } : {});
      E.run('A.cash = 2; as(A)'); await E.run(`submitTerrainLotBid(A.id, 4, 0.5, 2)`);
      const bids = E.run('state.terrainLot.bids.length');
      const T0 = E.cash(), c0 = E.cashes();
      await resolve(E);
      const won = E.run('!!state.terrainLot.active && state.terrainLot.active.companyId === A.id');
      const afterAuction = E.cashes();
      if(won) E.run('state.terrainLot.active.accrued = 2.5'); // plusieurs passages : 2,5 M$ comptés
      await yearEnd(E);
      const c1 = E.cashes();
      console.log(`    [${variant}] mise ${bids ? 'acceptée' : 'refusée'} ; lot ${won ? 'gagné' : 'non gagné'} ; encaisses ${c0.map(x => x.toFixed(4)).join(' / ')} → ${c1.map(x => x.toFixed(4)).join(' / ')}`);
      if(variant === 'corrigé'){
        ok(bids === 1 && E.alerts.length === 0, 'mise de 4 M$ avec 2 M$ d’encaisse : acceptée (avant : refusée, « mise ≤ encaisse »)');
        ok(won && JSON.stringify(afterAuction) === JSON.stringify(c0), 'Co Alice gagne le lot ; rien n’est transféré à l’enchère');
        ok(near(c1[0], 0.5) && [1, 2, 3].every(i => near(c1[i], 5.5)), 'fin d’année : perte 4 − 2,5 = 1,5 versée (0,5 à chacune des 3 autres) ; Co Alice 2 → 0,5');
        ok(near(E.cash(), T0), 'monnaie conservée');
        E.run('state.gameClock.rollCount = 7; A.cash = -1;'); E.alerts.length = 0;
        await E.run(`submitTerrainLotBid(A.id, 3, 0.5, 2)`);
        ok(E.run('state.terrainLot.bids.length') === 1 && E.alerts.length === 0, 'même à encaisse négative, la mise est acceptée (aucun transfert avant la fin d’année)');
      } else {
        ok(bids === 0 && !won && near(c1[0], 2), 'contre-épreuve : avec la limite du lot 3, la mise de 4 M$ est refusée');
      }
    }
  });

  await scenario('C. Réponse de Julien — à la résolution, plus de mise écartée faute d’encaisse', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: LOT3_RESOLUTION } : {});
      E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 4, 0.1, 1)`);
      E.run('as(B)'); await E.run(`submitTerrainLotBid(B.id, 1, 0.1, 1)`);
      E.run('A.cash -= 3; state.bank.cash += 3;'); // Co Alice dépense 3 M$ avant la résolution : il lui reste 2
      const T0 = E.cash();
      await resolve(E);
      const winner = E.run('state.terrainLot.active && companyById(state.terrainLot.active.companyId).name');
      console.log(`    [${variant}] lot gagné par ${winner}`);
      if(variant === 'corrigé'){
        ok(winner === 'Co Alice' && near(E.run('A.cash'), 2) && near(E.cash(), T0), 'la meilleure mise (4 M$, Co Alice, encaisse 2) l’emporte ; rien n’est payé');
      } else {
        ok(winner === 'Co Bob', 'contre-épreuve : avec la revérification du lot 3, la mise de Co Alice est écartée et Co Bob gagne');
      }
    }
  });

  await scenario('D. Règlement réutilisable (fin de partie, section 316) : en cours d’année, une seule fois', async () => {
    const E = await setup();
    E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 1, 0.5, 3)`);
    await resolve(E);
    E.run('state.gameClock.rollCount = 3; state.terrainLot.active.accrued = 2.5;');
    const T0 = E.cash(), c0 = E.cashes();
    await E.run(`act(async ()=>{ settleTerrainLotYearEnd(currentGameYear(), state.gameClock.rollCount); return {ok:true}; })`);
    const c1 = E.cashes();
    ok(near(c1[0] - c0[0], 1.5) && [1, 2, 3].every(i => near(c0[i] - c1[i], 0.5)), 'au lancer 3 (milieu d’année) : écart 2,5 − 1 = 1,5 réglé, 0,5 par entreprise');
    await E.run(`act(async ()=>{ settleTerrainLotYearEnd(currentGameYear(), state.gameClock.rollCount); return {ok:true}; })`);
    ok(JSON.stringify(E.cashes()) === JSON.stringify(c1) && near(E.cash(), T0), '2e appel : rien ne bouge (pari déjà clos), monnaie conservée');
  });

  // Réponse de Julien (2026-10-25) : la mise du lot ne compte plus dans le total des mises REIT (dépôt et résolution).
  // Contre-épreuve : le cumul du lot 3 réintroduit.
  const LOT3_CUMUL = src => LOT3_DEPOT(src)
    .replace("  const totalBefore = etfCommittedBidTotal(companyId);\n  const total = etfCommittedBidTotal(companyId, overrides);",
      "  const lotBid = ((state.terrainLot.bids||[]).find(x=>x.companyId===companyId)||{}).price||0;\n  const totalBefore = etfCommittedBidTotal(companyId) + lotBid;\n  const total = etfCommittedBidTotal(companyId, overrides) + lotBid;")
    .replace("    if(due>co.cash+1e-9){ // Section 310 — réponse de Julien (2026-10-25) : le pari du lot commercial n'est plus déduit de l'encaisse",
      "    const lotA = state.terrainLot.active; const lotExposure = (lotA && lotA.companyId===co.id) ? Math.max(0, lotA.price - (lotA.accrued||0)) : 0;\n    if(due>co.cash-lotExposure+1e-9){");
  const withEtf = E => E.run(`state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; }); A.cash = 20; B.cash = 20;`);
  const resolveAll = E => E.run(`act(async ()=>{ maybeResolveTerrainLotAuction(); maybeResolveEtfAuctions(); return {ok:true}; })`);
  await scenario('E. Réponse de Julien — Co Alice (20 M$) mise 20 sur le lot ET 20 sur un REIT', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: LOT3_CUMUL } : {});
      withEtf(E);
      E.run('as(A)');
      await E.run(`submitTerrainLotBid(A.id, 20, 0.1, 1)`);
      const r = await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:20}])`);
      const T0 = E.cash(), committed = E.run('etfCommittedBidTotal(A.id)');
      await resolveAll(E);
      const lotWon = E.run('!!state.terrainLot.active && state.terrainLot.active.companyId === A.id');
      const reitWon = E.run('A.etfHoldings.rue1') === 100;
      await yearEnd(E); // personne n'est tombé sur le lot
      console.log(`    [${variant}] mise REIT ${r.ok ? 'acceptée' : 'refusée'} ; lot ${lotWon ? 'gagné' : 'non'} ; Première rue ${reitWon ? 'gagnée' : 'non'} ; encaisse de Co Alice après la fin d'année : ${E.run('A.cash').toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(r.ok && committed === 20, 'la mise REIT est acceptée : le total des mises REIT (20) ne compte plus le lot');
        ok(lotWon && reitWon, 'Co Alice gagne le lot et la Première rue (20 M$ payés pour le REIT)');
        ok(near(E.run('A.cash'), -20) && near(E.cash(), T0), 'pari raté : la mise du lot (20) est réglée en fin d’année, Co Alice finance −20 (voulu par Julien)');
      } else {
        ok(!r.ok && /encaisse/.test(r.error), 'contre-épreuve : avec le cumul du lot 3, la mise REIT est refusée (total 40)');
      }
    }
    // Ordre inverse : REIT d'abord, puis le lot.
    const E = await setup();
    withEtf(E); E.run('as(A)');
    await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:20}])`);
    E.alerts.length = 0;
    await E.run(`submitTerrainLotBid(A.id, 20, 0.1, 1)`);
    ok(E.run('state.terrainLot.bids.length') === 1 && E.alerts.length === 0, 'ordre inverse : la mise de 20 sur le lot est acceptée après 20 de mises REIT');
    const r = await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:20}, {etfId:'rue2', price:1}])`);
    ok(!r.ok && /21[,.]00/.test(r.error) && !/lot commercial/.test(r.error), `la limite des mises REIT elles-mêmes (bogue 28) reste : 21 refusé (« ${r.error} »)`);
  });

  await scenario('F. Réponse de Julien — résolution : le lot gagné juste avant ne réduit plus l’encaisse disponible pour les REIT', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: LOT3_CUMUL } : {});
      withEtf(E);
      E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 10, 0.1, 1)`); await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:10}])`);
      E.run('as(B)'); await E.run(`submitEtfBids(B.id, [{etfId:'rue1', price:3}])`);
      E.run('A.cash -= 5; state.bank.cash += 5;'); // Co Alice dépense 5 avant l'enchère : 15
      const T0 = E.cash();
      await resolveAll(E);
      const rue1 = E.run(`state.companies.find(c=>(c.etfHoldings.rue1||0)>=100).name`);
      console.log(`    [${variant}] lot à ${E.run('companyById(state.terrainLot.active.companyId).name')}, Première rue à ${rue1} ; encaisse de Co Alice ${E.run('A.cash').toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(E.run('state.terrainLot.active.companyId === A.id') && rue1 === 'Co Alice' && near(E.run('A.cash'), 5), 'lot gagné par Co Alice ; sa mise REIT de 10 est couverte par ses 15 M$ : elle gagne aussi la Première rue (15 → 5)');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(rue1 === 'Co Bob', 'contre-épreuve : avec le cumul du lot 3, la mise REIT est écartée (10 engagés sur le lot) et Co Bob gagne');
      }
    }
  });

  await scenario('G. Retouche de la revue — seul le CEO mise sur le lot', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace("    const notCeo = offerResponderRefusal(companyId, 'cette entreprise', 'miser pour elle'); // Section 310 — retouche de la revue : seul le CEO mise\n    if(notCeo) return notCeo;\n", '') } : {});
      E.run('as(B)'); await E.run(`submitTerrainLotBid(A.id, 5, 1, 7)`);
      const n = E.run('state.terrainLot.bids.length');
      if(variant === 'corrigé') ok(n === 0 && /Seul le CEO de Co Alice/.test(E.alerts[0] || ''), `le CEO de Co Bob ne peut pas miser pour Co Alice (« ${E.alerts[0]} »)`);
      else ok(n === 1, 'contre-épreuve : sans le contrôle, le CEO de Co Bob engage Co Alice sur le lot');
    }
  });

  if(failures.length){ console.log(`\nÉCHEC : section 310 (lot commercial) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 310 (lot commercial) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
