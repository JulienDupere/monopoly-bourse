// Test — Section 311, bogue 22 : deux swaps de loyers sur la même entreprise, le second ne jouait que dans un sens.
// swapSplit ne retient qu'un swap par (entreprise, terrain). Option retenue (la plus sûre) : refuser la proposition et la
// signature d'un swap en conflit avec un swap actif (deux côtés généraux/à budget pour la même entreprise, ou deux côtés
// spécifiques sur le même terrain/lot). Spécifique + général restent permis (précédence de la section 258).
// Lancer depuis la racine du dépôt :  node tests/section311-swaps.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['A', 'B', 'C', 'D'], ['garp', 'garp', 'garp', 'garp']);
  run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2]; globalThis.D = state.companies[3];
       state.settings.features.rentSwap = true; state.rentSwaps = []; state.rentSwapOffers = [];
       const own = (nm, co)=>{ const p = state.properties.find(x=>x.name===nm); p.owners = [{companyId:co.id, share:maxPlayerOwnPct()}]; p.mortgages = []; return p; };
       globalThis.PA = own('Rose 1', A); globalThis.PA2 = own('Rose 2', A); globalThis.PB = own('Jaune 1', B); globalThis.PC = own('Vert 1', C);
       globalThis.__alerts = []; alert = (m)=>{ __alerts.push(String(m)); };`);
  return eng;
}
const general = (a, b) => `createRentSwap(null, ${a}.id, null, ${b}.id, 3, null, null, true, true, 0, 0, {silent:true})`;

// Scénario de l'audit : A ⇄ B général, puis A ⇄ C général. Qui reçoit quoi quand D visite A, puis C ?
async function scenarioAudit(eng){
  const { run, json } = eng;
  const r1 = await run(general('A', 'B'));
  const r2 = await run(general('A', 'C'));
  const visitA = json(`swapSplit(PA.id, A.id, D.id, 1)`), visitC = json(`swapSplit(PC.id, C.id, D.id, 1)`);
  return { r1, r2, visitA, visitC, nameOf: (id) => run(`(companyById(${JSON.stringify(id)})||{}).name`) };
}

(async () => {
  console.log('1 — scénario de l’audit : second swap général refusé');
  {
    const eng = await setup();
    const { run } = eng;
    const v = await scenarioAudit(eng);
    ok(v.r1.ok, 'swap général A ⇄ B signé');
    ok(!v.r2.ok && /général/.test(v.r2.error), `swap général A ⇄ C refusé : « ${v.r2.error} »`);
    ok(run(`state.rentSwaps.length`) === 1, 'un seul swap actif');
    const p = await run(`proposeRentSwap(null, C.id, null, A.id, 3, null, null, true, true, 0, 0, {silent:true})`);
    ok(!p.ok, 'la proposition C ⇄ A générale est refusée dès la proposition');
    const bud = await run(`proposeRentSwap(null, A.id, null, D.id, null, null, null, false, false, 5, 5, {silent:true})`);
    ok(!bud.ok, 'un swap à budget (côtés généraux) avec A est refusé aussi');
  }
  console.log('2 — combinaisons permises et refusées');
  {
    const eng = await setup();
    const { run } = eng;
    ok((await run(general('A', 'B'))).ok, 'A ⇄ B général');
    const s1 = await run(`createRentSwap(PA.id, A.id, PC.id, C.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    ok(s1.ok, 'A (Rose 1, spécifique) ⇄ C (Vert 1, spécifique) permis à côté du général : précédence section 258');
    const s2 = await run(`createRentSwap(PA.id, A.id, PB.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    ok(!s2.ok && /Rose 1/.test(s2.error), `second swap spécifique sur Rose 1 refusé : « ${s2.error} »`);
    run(`PA.groupMergeId = PA2.groupMergeId = 'lot-rose';`);
    const s4 = await run(`createRentSwap(PA2.id, A.id, PB.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    ok(!s4.ok && /Lot Rose/.test(s4.error), `Rose 1 et Rose 2 regroupés : un swap spécifique sur Rose 2 (même lot que Rose 1) est refusé : « ${s4.error} »`);
    run(`PA.groupMergeId = PA2.groupMergeId = null;`);
    const s3 = await run(`createRentSwap(PA2.id, A.id, null, D.id, 2, null, null, false, true, 0, 0, {silent:true})`);
    ok(s3.ok, 'lot non regroupé : A (Rose 2, spécifique) ⇄ D (général) permis, D n’avait aucun swap général');
    // Swaps échus : le conflit disparaît.
    run(`state.rentSwaps.forEach(s=>{ s.yearsRemaining = 0; });`);
    ok((await run(general('A', 'C'))).ok, 'après l’échéance des swaps, un nouveau swap général est permis');
  }
  console.log('3 — revérification à la signature : deux propositions en attente');
  {
    const eng = await setup();
    const { run } = eng;
    await run(`proposeRentSwap(null, B.id, null, A.id, 3, null, null, true, true, 0, 0, {silent:true})`);
    await run(`proposeRentSwap(null, C.id, null, A.id, 3, null, null, true, true, 0, 0, {silent:true})`);
    const ids = JSON.parse(run(`JSON.stringify(state.rentSwapOffers.map(o=>o.id))`));
    ok(ids.length === 2, 'deux propositions générales en attente pour A');
    await run(`acceptRentSwapOffer('${ids[0]}')`);
    await run(`acceptRentSwapOffer('${ids[1]}')`);
    ok(run(`state.rentSwaps.length`) === 1, 'une seule signée');
    ok(run(`state.rentSwapOffers.length`) === 1 && run(`state.rentSwapOffers[0].id`) === ids[1], 'la seconde proposition reste en attente (rien n’est perdu)');
    ok(/général/.test(run(`__alerts.join(' | ')`)), 'message clair à la signature refusée');
  }
  console.log('4 — contre-épreuve : contrôle de conflit retiré');
  {
    const eng = await setup({ transform: (src) => src.replace("  if(!clash) return null;\n", "  return null;\n") });
    const v = await scenarioAudit(eng);
    console.log(`  code d'avant : D visite A -> part redirigée vers ${v.nameOf(v.visitA.partnerId)} (${v.visitA.toPartner}) ; D visite C -> vers ${v.nameOf(v.visitC.partnerId)} (${v.visitC.toPartner})`);
    ok(v.r2.ok && v.visitA.partnerId === eng.run('B.id') && v.visitC.partnerId === eng.run('A.id'),
      'sans le correctif : A ⇄ C signé, C verse à A mais A ne verse jamais à C (le swap A ⇄ B est seul retenu pour A)');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
