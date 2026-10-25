// Test — section 311, décisions de Julien (2026-10-25) « Ok go pour tes reco » :
// R. Résiliation amiable d'un swap à budget : l'un des deux CEO la propose, seul le CEO de l'autre entreprise l'accepte
//    ou la refuse ; l'auteur peut la retirer ; elle expire au lancer suivant. À l'acceptation, le swap prend fin sans
//    paiement (avant : un swap à budget dont aucun côté ne progresse liait les deux entreprises sans limite).
// M. Regroupement d'un lot refusé quand une même entreprise a des swaps spécifiques actifs sur deux terrains différents
//    de ce lot (après le regroupement, swapSplit n'en retiendrait qu'un : le second ne jouerait plus que dans un sens).
// Chaque correctif a sa contre-épreuve (loadEngine({transform})).
// Lancer depuis la racine du dépôt :  node tests/section311-decisions.test.js
const { loadEngine, check } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  const ids = await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  run(`globalThis.__ids = ${JSON.stringify(ids)}; globalThis.as = i => { myPlayerId = __ids[i]; };
       globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2]; globalThis.D = state.companies[3];
       state.settings.features.rentSwap = true; state.rentSwaps = []; state.rentSwapOffers = [];
       const own = (nm, co)=>{ const p = state.properties.find(x=>x.name===nm); p.owners = [{companyId:co.id, share:maxPlayerOwnPct()}]; p.mortgages = []; return p; };
       globalThis.PB1 = own('Brun 1', A); globalThis.PB2 = own('Brun 2', A); globalThis.PJ = own('Jaune 1', B); globalThis.PV = own('Vert 1', C);
       globalThis.__alerts = []; alert = (m)=>{ __alerts.push(String(m)); };
       drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };
       as(0);`);
  return eng;
}
const BUDGET = (a, b) => `createRentSwap(null, ${a}.id, null, ${b}.id, null, null, null, false, false, 5, 5, {silent:true})`;
const reqs = eng => eng.json('state.rentSwapTerminationRequests');
const dernierJournal = eng => JSON.stringify(eng.json('state.log[0]'));

(async () => {
  // ---------------------------------------------------------------- R. Résiliation amiable
  console.log('R1 — proposition par Alice (CEO de A), acceptation par Bob (CEO de B) : le swap prend fin sans paiement');
  {
    const eng = await setup();
    const { run, json } = eng;
    ok((await run(BUDGET('A', 'B'))).ok, 'swap à budget A ⇄ B (5 / 5) signé');
    const swapId = run('state.rentSwaps[0].id');
    ok(!(await run(`createRentSwap(null, A.id, null, C.id, 3, null, null, true, true, 0, 0, {silent:true})`)).ok, 'avant : A ne peut signer aucun swap général avec C (le swap à budget la lie)');
    ok(/data-propose-swap-termination="[^"]+"/.test(run('renderEntreprise()')), 'onglet Mon Entreprise d’Alice : bouton « Proposer une résiliation amiable »');
    const m0 = eng.cashTotal(), cash0 = json('state.companies.map(c=>c.cash)');
    let r = await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    ok(r.ok && reqs(eng).length === 1 && reqs(eng)[0].fromCompanyId === run('A.id') && reqs(eng)[0].toCompanyId === run('B.id') && reqs(eng)[0].roll === 0, 'demande enregistrée : de A vers B, au lancer 0');
    ok(run('state.rentSwaps.length') === 1, 'rien ne change avant l’acceptation : le swap court toujours');
    ok(/propose à Co Bob de résilier à l’amiable/.test(dernierJournal(eng)), 'journal : proposition tracée');
    // Qui peut répondre ?
    const reqId = reqs(eng)[0].id;
    r = await run(`acceptRentSwapTermination(${JSON.stringify(reqId)})`);
    ok(!r.ok && /Seul le CEO de Co Bob/.test(r.error) && run('state.rentSwaps.length') === 1, `Alice (auteure) ne peut pas accepter sa propre demande : « ${r.error} »`);
    run('as(2)');
    r = await run(`acceptRentSwapTermination(${JSON.stringify(reqId)})`);
    ok(!r.ok && /Seul le CEO de Co Bob/.test(r.error), 'Carl (tiers) ne peut pas accepter');
    r = await run(`refuseRentSwapTermination(${JSON.stringify(reqId)})`);
    ok(!r.ok && reqs(eng).length === 1, 'Carl ne peut pas refuser (effacer) la demande');
    r = await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    ok(!r.ok && /Seul le CEO d’une des deux entreprises/.test(r.error), 'Carl ne peut pas proposer de résiliation');
    run('as(1)');
    r = await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    ok(!r.ok && /déjà en attente/.test(r.error), 'Bob ne peut pas déposer une seconde demande pendant que la première attend');
    ok(/data-accept-swap-termination="[^"]+"/.test(run('renderEntreprise()')) && /data-refuse-swap-termination="[^"]+"/.test(run('renderEntreprise()')), 'onglet Mon Entreprise de Bob : Accepter / Refuser la résiliation');
    r = await run(`acceptRentSwapTermination(${JSON.stringify(reqId)})`);
    ok(r.ok && run('state.rentSwaps.length') === 0 && reqs(eng).length === 0, 'Bob accepte : swap terminé, demande retirée');
    ok(JSON.stringify(json('state.companies.map(c=>c.cash)')) === JSON.stringify(cash0) && Math.abs(eng.cashTotal() - m0) < 1e-9, 'aucun paiement : encaisses et monnaie inchangées');
    ok(/résiliation amiable[^"]*sans paiement/.test(dernierJournal(eng)), 'journal : fin du swap sans paiement');
    run('as(0)');
    ok((await run(`createRentSwap(null, A.id, null, C.id, 3, null, null, true, true, 0, 0, {silent:true})`)).ok, 'après : A signe un swap général avec C');
  }
  console.log('R2 — refus, retrait, swap à durée, expiration au lancer suivant, swap épuisé entre-temps');
  {
    const eng = await setup();
    const { run } = eng;
    await run(BUDGET('A', 'B'));
    const swapId = run('state.rentSwaps[0].id');
    run('as(1)');
    await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    run('as(0)');
    let r = await run(`refuseRentSwapTermination(${JSON.stringify(reqs(eng)[0].id)})`);
    ok(r.ok && reqs(eng).length === 0 && run('state.rentSwaps.length') === 1, 'Alice refuse la demande de Bob : demande retirée, le swap continue');
    ok(/refuse la résiliation amiable/.test(dernierJournal(eng)), 'journal : refus tracé');
    await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    run('as(1)');
    r = await run(`cancelRentSwapTermination(${JSON.stringify(reqs(eng)[0].id)})`);
    ok(!r.ok && reqs(eng).length === 1, 'Bob ne peut pas retirer la demande d’Alice');
    run('as(0)');
    r = await run(`cancelRentSwapTermination(${JSON.stringify(reqs(eng)[0].id)})`);
    ok(r.ok && reqs(eng).length === 0 && run('state.rentSwaps.length') === 1, 'Alice retire sa demande');
    // Swap à durée : pas de résiliation amiable (il prend fin à son échéance).
    await run(`createRentSwap(PB1.id, A.id, PV.id, C.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    const dureeId = run('state.rentSwaps.find(s=>!s.budgetMode).id');
    r = await run(`proposeRentSwapTermination(${JSON.stringify(dureeId)})`);
    ok(!r.ok && /swap à budget/.test(r.error), `swap à durée : résiliation refusée (« ${r.error} »)`);
    // Expiration au lancer suivant.
    await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    const reqId = reqs(eng)[0].id;
    run('advanceGameClock();');
    ok(reqs(eng).length === 0 && run('state.rentSwaps.filter(s=>s.budgetMode).length') === 1, 'lancer suivant : la demande expire, le swap continue');
    ok(eng.json('state.log').some(l => /résiliation amiable[^"]*expire/.test(JSON.stringify(l))), 'journal : expiration tracée');
    run('as(1)');
    r = await run(`acceptRentSwapTermination(${JSON.stringify(reqId)})`);
    ok(!r.ok && run('state.rentSwaps.filter(s=>s.budgetMode).length') === 1, 'acceptation après expiration : refusée, le swap continue');
    // Demande encore listée mais lancer changé (appareil en retard) : refus.
    run('as(0)');
    await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    run('state.rentSwapTerminationRequests[0].roll = state.gameClock.rollCount - 1; as(1);');
    r = await run(`acceptRentSwapTermination(state.rentSwapTerminationRequests[0].id)`);
    ok(!r.ok && /a expiré au lancer de dés suivant/.test(r.error) && run('state.rentSwaps.filter(s=>s.budgetMode).length') === 1, 'lancer changé : acceptation refusée');
    // Swap épuisé des deux côtés entre la demande et l'acceptation : demande sans objet, retirée.
    run('state.rentSwapTerminationRequests = []; as(0);');
    await run(`proposeRentSwapTermination(${JSON.stringify(swapId)})`);
    run(`state.rentSwaps = state.rentSwaps.filter(s=>!s.budgetMode); as(1);`);
    r = await run(`acceptRentSwapTermination(state.rentSwapTerminationRequests[0].id)`);
    ok(r.ok && reqs(eng).length === 0 && /sans objet/.test(dernierJournal(eng)), 'swap déjà terminé : demande retirée « sans objet »');
  }
  console.log('R3 — parties existantes : champ par défaut, identifiant stable des anciens swaps');
  {
    const eng = await setup();
    const { run } = eng;
    run(`delete state.rentSwapTerminationRequests; state.rentSwaps = [{propA:null, companyA:A.id, generalA:true, capA:null, propB:null, companyB:B.id, generalB:true, capB:null, yearsRemaining:null, yearsTotal:null, budgetMode:true, budgetCapA:5, budgetCapB:5, disbursedA:0, disbursedB:0}];
         globalThis.__copie = JSON.parse(JSON.stringify(state)); migrateState(state); migrateState(__copie);`);
    ok(Array.isArray(reqs(eng)) && reqs(eng).length === 0, 'migrateState : rentSwapTerminationRequests = []');
    ok(!!run('state.rentSwaps[0].id') && run('state.rentSwaps[0].id') === run('__copie.rentSwaps[0].id'), `ancien swap sans identifiant : identifiant déterministe (${run('state.rentSwaps[0].id')}), identique sur deux appareils`);
    const r = await run(`proposeRentSwapTermination(state.rentSwaps[0].id)`);
    ok(r.ok, 'l’ancien swap à budget peut être résilié');
  }
  console.log('R4 — contre-épreuves');
  {
    const eng = await setup({ transform: s => s.replace("    const notResponder = rentOfferResponderRefusal(req); // Section 311 — décision de Julien (2026-10-25) : seul le CEO destinataire répond\n    if(notResponder) return notResponder;\n", '') });
    const { run } = eng;
    await run(BUDGET('A', 'B'));
    await run(`proposeRentSwapTermination(state.rentSwaps[0].id)`);
    const r = await run(`acceptRentSwapTermination(state.rentSwapTerminationRequests[0].id)`);
    ok(r.ok && run('state.rentSwaps.length') === 0, 'contre-épreuve (contrôle du destinataire retiré) : Alice résilie seule — R1 détecte la régression');
  }
  {
    const eng = await setup({ transform: s => s.replace("  expireRentSwapTerminationRequests(); // Section 311 — décision de Julien (2026-10-25)\n", '') });
    const { run } = eng;
    await run(BUDGET('A', 'B'));
    await run(`proposeRentSwapTermination(state.rentSwaps[0].id)`);
    run('advanceGameClock();');
    ok(reqs(eng).length === 1, 'contre-épreuve (expiration retirée) : la demande survit au lancer — R2 détecte la régression');
  }

  console.log('R5 — vrais boutons de l’onglet Mon Entreprise (mini-DOM) : proposer (Alice), accepter (Bob)');
  {
    const { creerDocument } = require('./helpers/fake-dom');
    const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
    const doc = creerDocument();
    const eng = loadEngine({ globals: { document: doc, alert: () => {} } });
    const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    eng.run(`myPlayerId = ${JSON.stringify(ids[0])}; state.settings.features.rentSwap = true; state.rentSwaps = [];`);
    await eng.run(`createRentSwap(null, state.companies[0].id, null, state.companies[1].id, null, null, null, false, false, 5, 5, {silent:true})`);
    eng.run(`activeTab = 'entreprise'; render();`);
    const clic = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
    const c1 = await clic(`[data-propose-swap-termination="${eng.run('state.rentSwaps[0].id')}"]`);
    ok(c1 === 'ok' && reqs(eng).length === 1, 'clic « Proposer une résiliation amiable » : demande enregistrée');
    eng.run(`myPlayerId = ${JSON.stringify(ids[1])}; render();`);
    const c2 = await clic(`[data-accept-swap-termination="${reqs(eng)[0].id}"]`);
    ok(c2 === 'ok' && eng.run('state.rentSwaps.length') === 0, 'clic « Accepter la résiliation » (Bob) : swap terminé');
  }

  // ---------------------------------------------------------------- M. Regroupement et swaps spécifiques
  console.log('M1 — A a deux swaps spécifiques actifs, sur Brun 1 et Brun 2 : regroupement du lot Brun refusé');
  {
    const eng = await setup();
    const { run, json } = eng;
    ok((await run(`createRentSwap(PB1.id, A.id, PJ.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`)).ok, 'swap A (Brun 1) ⇄ B (Jaune 1)');
    ok((await run(`createRentSwap(PB2.id, A.id, PV.id, C.id, 2, null, null, false, false, 0, 0, {silent:true})`)).ok, 'swap A (Brun 2) ⇄ C (Vert 1)');
    const m0 = eng.cashTotal();
    await run(`mergeGroup('BRUN')`);
    const msg = json('__alerts').pop() || '';
    ok(!run('PB1.groupMergeId') && !run('PB2.groupMergeId'), 'lot non regroupé');
    ok(/Regroupement impossible/.test(msg) && /Co Alice/.test(msg) && /Brun 1/.test(msg) && /Brun 2/.test(msg) && /Co Bob/.test(msg) && /Co Carl/.test(msg), `message clair : « ${msg} »`);
    ok(Math.abs(eng.cashTotal() - m0) < 1e-9, 'rien n’a bougé');
    // Un des deux swaps arrive à échéance : le regroupement redevient possible.
    run(`state.rentSwaps.find(s=>s.propA===PB2.id).yearsRemaining = 0;`);
    await run(`mergeGroup('BRUN')`);
    ok(!!run('PB1.groupMergeId') && run('PB1.groupMergeId') === run('PB2.groupMergeId'), 'second swap échu : lot regroupé');
  }
  console.log('M2 — cas permis : un seul swap spécifique ; deux entreprises différentes, un swap chacune ; un swap général');
  {
    let eng = await setup();
    await eng.run(`createRentSwap(PB1.id, A.id, PJ.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await eng.run(`createRentSwap(null, A.id, PV.id, C.id, 2, null, null, true, false, 0, 0, {silent:true})`);
    await eng.run(`mergeGroup('BRUN')`);
    ok(!!eng.run('PB1.groupMergeId'), 'un swap spécifique (Brun 1) + un swap général de A : regroupement permis');
    eng = await setup();
    eng.run(`PB2.owners = [{companyId:D.id, share:maxPlayerOwnPct()}];`);
    await eng.run(`createRentSwap(PB1.id, A.id, PJ.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await eng.run(`createRentSwap(PB2.id, D.id, PV.id, C.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await eng.run(`mergeGroup('BRUN')`);
    ok(!!eng.run('PB1.groupMergeId'), 'A sur Brun 1, D sur Brun 2 (entreprises différentes) : regroupement permis');
  }
  console.log('M3 — contre-épreuve : sans le refus, le second swap de A ne joue plus que dans un sens');
  {
    const eng = await setup({ transform: s => s.replace("  const twoSwapsRefusal = mergeGroupSpecificSwapsRefusal(props); // Section 311 — décision de Julien (2026-10-25)\n  if(twoSwapsRefusal) return {ok:false, error:twoSwapsRefusal};\n", '') });
    const { run, json } = eng;
    await run(`createRentSwap(PB1.id, A.id, PJ.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await run(`createRentSwap(PB2.id, A.id, PV.id, C.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await run(`mergeGroup('BRUN')`);
    const split = json(`swapSplit(PB2.id, A.id, D.id, 1)`);
    ok(!!run('PB1.groupMergeId') && split.partnerId === run('B.id'), 'contre-épreuve : lot regroupé, le loyer de Brun 2 part chez B (et plus chez C) — M1 détecte la régression');
  }

  console.log(`\nOK : section 311 (décisions de Julien) — ${n} vérifications`);
})().catch(e => { console.error('ÉCHEC :', e && e.message ? e.message : e); process.exit(1); });
