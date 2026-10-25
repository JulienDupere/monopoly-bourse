// Test — section 310 (lot 3 de l'audit du 2026-10-19) : lot commercial.
// Décision de Julien, verbatim : « lot commercial : le gagnant ne débourse rien sur le moment, seul le différentiel
// entre revenus comptés et mise est réglé (vérifier et corriger si besoin) ».
// 1. Vérification : c'est déjà le cas (aucun mouvement à l'enchère ni au passage sur une case du lot ; en fin
//    d'année, seul l'écart loyers comptés − mise passe entre le gagnant et les autres entreprises).
// 2. Question de conception de l'audit (« la mise n'a aucune limite et aucun lien avec la trésorerie, si bien qu'une
//    entreprise peut finir à −2 M$ après avoir gagné ») : la mise, qui est la perte maximale du gagnant, ne dépasse
//    plus son encaisse (au dépôt, revérifié à la résolution).
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

  await scenario('B. Limite de la mise — Co Alice (5 M$) mise 8 M$ sur le lot', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace(/    \/\/ Section 310 — décision « lot commercial » : la mise[\s\S]*?\/\/ fin limite \(dépôt\)\n/, '')
        .replace(/  \/\/ Section 310 — décision « lot commercial » : chaque mise est revérifiée[\s\S]*?\/\/ fin limite \(résolution\)\n/, '  const bids = state.terrainLot.bids;\n') } : {});
      E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 8, 0.1, 1)`);
      const bids = E.run('state.terrainLot.bids.length');
      const T0 = E.cash();
      await resolve(E);
      await yearEnd(E); // personne n'est tombé sur le lot
      console.log(`    [${variant}] mises enregistrées : ${bids} ; encaisse de Co Alice après la fin d'année : ${E.run('A.cash').toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(bids === 0 && E.alerts.length === 1 && /encaisse/.test(E.alerts[0]) && /perte maximale/.test(E.alerts[0]), `mise refusée : « ${E.alerts[0]} »`);
        ok(near(E.run('A.cash'), 5) && near(E.cash(), T0), 'Co Alice garde 5 M$ (avant : −3 M$ après avoir gagné)');
        E.alerts.length = 0;
        await E.run(`submitTerrainLotBid(A.id, 5, 0.1, 1)`);
        ok(E.run('state.terrainLot.bids.length') === 1 && E.alerts.length === 0, 'une mise égale à l’encaisse (5 M$) est acceptée');
        E.run('A.cash = -1');
        await E.run(`submitTerrainLotBid(A.id, 0, 0.1, 1)`);
        ok(E.run('state.terrainLot.bids[0].price') === 0, 'une mise de 0 (aucune perte possible) reste permise, même à encaisse négative');
      } else {
        ok(bids === 1 && near(E.run('A.cash'), -3), 'contre-épreuve : sans la limite, Co Alice gagne et finit à −3 M$');
      }
    }
  });

  await scenario('C. Limite revérifiée à la résolution : la mise que l’encaisse ne couvre plus est écartée', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace(/  \/\/ Section 310 — décision « lot commercial » : chaque mise est revérifiée[\s\S]*?\/\/ fin limite \(résolution\)\n/, '  const bids = state.terrainLot.bids;\n') } : {});
      E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 4, 0.1, 1)`);
      E.run('as(B)'); await E.run(`submitTerrainLotBid(B.id, 1, 0.1, 1)`);
      E.run('A.cash -= 3; state.bank.cash += 3;'); // Co Alice dépense 3 M$ avant la résolution : il lui reste 2
      await resolve(E);
      const winner = E.run('state.terrainLot.active && companyById(state.terrainLot.active.companyId).name');
      console.log(`    [${variant}] lot gagné par ${winner}`);
      if(variant === 'corrigé'){
        ok(winner === 'Co Bob', 'la mise de 4 M$ de Co Alice (encaisse 2 M$) est écartée, Co Bob l’emporte');
        ok(E.json('state.log.some(l=>l.text.includes("La mise de Co Alice sur le lot commercial") && l.text.includes("écartée"))'), 'le journal explique la mise écartée');
      } else {
        ok(winner === 'Co Alice', 'contre-épreuve : sans la revérification, Co Alice gagne avec une mise que son encaisse ne couvre plus');
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

  // Retouche de la revue : la mise du lot compte dans le même total que les mises REIT (dépôt et résolution).
  const NO_CUMUL = s => s.replace('  const lotBid = terrainLotCommittedBid(companyId);', '  const lotBid = 0;')
    .replace(/    if\(clampedPrice>0 && clampedPrice\+etfCommitted>[^\n]*\n/, '')
    .replace('    const lotExposure = terrainLotActiveExposure(co.id);', '    const lotExposure = 0;');
  const withEtf = E => E.run(`state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; }); A.cash = 20; B.cash = 20;`);
  const resolveAll = E => E.run(`act(async ()=>{ maybeResolveTerrainLotAuction(); maybeResolveEtfAuctions(); return {ok:true}; })`);
  await scenario('E. Retouche de la revue — Co Alice (20 M$) mise 20 sur le lot ET 20 sur un REIT', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: NO_CUMUL } : {});
      withEtf(E);
      E.run('as(A)');
      await E.run(`submitTerrainLotBid(A.id, 20, 0.1, 1)`);
      const r = await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:20}])`);
      const T0 = E.cash();
      await resolveAll(E);
      await yearEnd(E); // personne n'est tombé sur le lot
      console.log(`    [${variant}] mise REIT ${r.ok ? 'acceptée' : 'refusée'} ; encaisse de Co Alice après la fin d'année : ${E.run('A.cash').toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(!r.ok && /lot commercial/.test(r.error) && /40[,.]00/.test(r.error), `la mise REIT est refusée : total engagé 40 pour 20 d'encaisse (« ${r.error} »)`);
        ok(near(E.run('A.cash'), 0) && near(E.cash(), T0), 'Co Alice gagne le lot, rate son pari et finit à 0 (avant : −20)');
      } else {
        ok(r.ok && near(E.run('A.cash'), -20), 'contre-épreuve : sans le cumul, les deux mises passent et Co Alice finit à −20');
      }
    }
    // Ordre inverse : REIT d'abord, puis le lot.
    const E = await setup();
    withEtf(E); E.run('as(A)');
    await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:20}])`);
    E.alerts.length = 0;
    await E.run(`submitTerrainLotBid(A.id, 20, 0.1, 1)`);
    ok(E.run('state.terrainLot.bids.length') === 0 && /mises REIT/.test(E.alerts[0] || ''), `ordre inverse : la mise sur le lot est refusée (« ${E.alerts[0]} »)`);
    await E.run(`submitTerrainLotBid(A.id, 0, 0.1, 1)`);
    ok(E.run('state.terrainLot.bids.length') === 1, 'une mise de 0 sur le lot reste permise');
  });

  await scenario('F. Retouche de la revue — résolution : le lot (résolu d’abord) réduit l’encaisse disponible pour les REIT', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: NO_CUMUL } : {});
      withEtf(E);
      E.run('as(A)'); await E.run(`submitTerrainLotBid(A.id, 10, 0.1, 1)`); await E.run(`submitEtfBids(A.id, [{etfId:'rue1', price:10}])`);
      E.run('as(B)'); await E.run(`submitEtfBids(B.id, [{etfId:'rue1', price:3}])`);
      E.run('A.cash -= 5; state.bank.cash += 5;'); // Co Alice dépense 5 avant l'enchère : 15 pour 20 engagés
      await resolveAll(E);
      const rue1 = E.run(`state.companies.find(c=>(c.etfHoldings.rue1||0)>=100).name`);
      console.log(`    [${variant}] lot à ${E.run('companyById(state.terrainLot.active.companyId).name')}, Première rue à ${rue1} ; encaisse de Co Alice ${E.run('A.cash').toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(E.run('state.terrainLot.active.companyId === A.id') && rue1 === 'Co Bob' && near(E.run('A.cash'), 15), 'lot gagné par Co Alice (10 engagés) ; sa mise REIT de 10 dépasse les 5 restants : écartée, Co Bob gagne');
        ok(E.json('state.log.some(l=>l.text.includes("engagés sur le lot commercial"))'), 'le journal explique la part engagée sur le lot');
      } else {
        ok(rue1 === 'Co Alice' && near(E.run('A.cash'), 5), 'contre-épreuve : sans le cumul, Co Alice gagne aussi le REIT (5 M$ pour 10 engagés sur le lot)');
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
