// Test — Section 309-313, intégration de la vague 2 (lots 2, 4, 5 et 6 → sections 309, 311, 312, 313) : raccords
// de comportement entre lots développés en parallèle. Chaque raccord a sa contre-épreuve (loadEngine({transform})).
//   1. Verrous ABS du lot 4 (ABS conclue OU annoncée) sur les voies de vente du lot 2 : offre de vente déposée puis ABS
//      annoncée → acceptation refusée sur l'état frais, rien ne bouge, monnaie conservée ; dépôt et vente à la banque
//      refusés aussi ; même chose pour une part de lot.
//   2. Échange de parts : un seul contrôle ABS (shareSwapGiveRefusal), message du lot 4.
//   3. Hypothèque (lot 5) : verrou ABS (annonce comprise) et message du lot 4 dans mortgageAssetTerms ; une offre
//      d'hypothèque devient caduque dès l'annonce (retirée dans la même écriture).
//   4. Loyer : ABS (lot 4) + accord de compensation (lot 4, bogue 70) + retenues de prêt (lot 5, bogue 23) sur le même
//      loyer, option « Prêts » cochée puis décochée : monnaie conservée, états conformes.
//   5. Seul le CEO destinataire répond : offres de vente (lot 2) et d'hypothèque (lot 5), contrôle commun.
//   6. Expirations : offres de vente et d'hypothèque expirent au même endroit du cycle (même lancer, même écriture).
//   7. Noyau 308 : un nettoyage des offres d'hypothèque qui lève n'empêche jamais l'action d'être enregistrée.
// Lancer depuis la racine du dépôt :  node tests/section309-integration.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f4 = x => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts = {}){
  const errors = [];
  const cons = Object.assign(Object.create(console), { error: (...a) => { errors.push(a.map(String).join(' ')); } });
  const eng = loadEngine(Object.assign({}, opts, { globals: Object.assign({ console: cons }, opts.globals || {}) }));
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
           state.settings.features.revenueSwap = true; state.settings.features.rentSwap = true; state.rentCompensations = [];
           state.settings.mortgageRentContinues = false; state.gameClock.rollCount = 0;
           globalThis.AE = state.properties.find(p=>p.name==='Aéroport 1'); AE.owners = [{companyId:B.id, share:maxPlayerOwnPct()}]; AE.mortgages = [];
           globalThis.AE2 = state.properties.find(p=>p.name==='Aéroport 2'); AE2.owners = [{companyId:C.id, share:maxPlayerOwnPct()}]; AE2.mortgages = [];
           globalThis.BF = ['Bleu foncé 1','Bleu foncé 2'].map(nm=>state.properties.find(p=>p.name===nm));
           BF.forEach(p=>{ p.owners = [{companyId:A.id, share:maxPlayerOwnPct()}]; p.mortgages = []; p.groupMergeId = 'lot-bf'; p.houses = 0; });
           A.cash += 50; B.cash += 50; C.cash += 50;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           globalThis.shareOf = (p, co) => propertyOwnedShare(p, co.id);`);
  const saved = () => JSON.parse(eng.mem.get('game:' + eng.run('gameCode')));
  return { eng, run: c => eng.run(c), json: c => eng.json(c), alerts, errors, saved, cash: () => eng.cashTotal() };
}
const ABS_AE = `act(()=>postRevenueSwapListing(B.id, [AE.id], 0.6, 3, 2, {silent:true}))`;
const OFFRE_AE = `act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:AE.id, sellerId:B.id, buyerId:C.id, pct:10, price:2}, {silent:true}))`;

(async () => {
  // ---------- 1. Verrous ABS sur les voies de vente du lot 2 ----------
  console.log('1 — offre de vente déposée, PUIS ABS annoncée : acceptation refusée (verrou du lot 4 sur la voie du lot 2)');
  {
    const E = await setup();
    E.run('as(B)');
    let r = await E.run(OFFRE_AE);
    ok(r.ok && E.json('state.assetSaleOffers.length') === 1, 'Co Bob propose 10 % de l’Aéroport 1 à Co Carl pour 2 M$ (offre déposée, rien ne bouge)');
    r = await E.run(ABS_AE);
    ok(r.ok && E.json('state.revenueSwapListings.length') === 1, 'Co Bob annonce ensuite une émission ABS sur l’Aéroport 1');
    const m0 = E.cash(), b0 = E.run('B.cash'), c0 = E.run('C.cash'), sh0 = E.run('shareOf(AE, B)');
    E.run('as(C)');
    const offerId = E.run('state.assetSaleOffers[0].id');
    r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offerId)})`);
    ok(!r.ok && /Offre non exécutée/.test(r.error) && /Co Bob a annoncé une émission ABS sur Aéroport 1/.test(r.error) && /impossible de le vendre/.test(r.error), `acceptation par Co Carl refusée : « ${r.error} »`);
    ok(E.run('shareOf(AE, B)') === sh0 && E.run('shareOf(AE, C)') === 0 && near(E.run('B.cash'), b0) && near(E.run('C.cash'), c0), `rien ne bouge : Co Bob garde ${sh0} %, encaisses inchangées`);
    ok(near(E.cash(), m0), 'monnaie conservée');
    ok(E.json('state.assetSaleOffers.length') === 1 && E.saved().assetSaleOffers.length === 1, 'l’offre reste en attente (refus = état restauré), Co Carl peut la refuser');
    E.run('as(B)');
    r = await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:AE.id, sellerId:B.id, buyerId:C.id, pct:5, price:1}, {silent:true}))`);
    ok(!r.ok && /a annoncé une émission ABS/.test(r.error), `nouveau dépôt refusé pendant l’annonce : « ${r.error} »`);
    r = await E.run(`act(()=>executeShareSale({type:'prop', id:AE.id}, B.id, 'BANK', 10, 0, {silent:true}))`);
    ok(!r.ok && /a annoncé une émission ABS/.test(r.error) && E.run('shareOf(AE, B)') === sh0 && near(E.cash(), m0), `vente à la banque refusée : « ${r.error} »`);
    // ABS conclue (et non plus annoncée) : même refus, message de l'accord conclu.
    E.run(`state.revenueSwapListings = []; state.revenueSwaps.push({id:'abs-ae', sellerId:B.id, propertyIds:[AE.id], cededPctOfShare:0.6, seniorHolders:[], juniorHolders:[], seniorCapTotal:0, seniorPaidSoFar:0, seniorRaised:0});`);
    E.run('as(C)');
    r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offerId)})`);
    ok(!r.ok && /Co Bob a vendu le revenu de Aéroport 1 en ABS/.test(r.error) && E.run('shareOf(AE, C)') === 0 && near(E.cash(), m0), `ABS conclue : acceptation refusée aussi : « ${r.error} »`);
  }
  console.log('1b — part d’un lot regroupé : offre déposée puis ABS annoncée sur le lot → acceptation refusée');
  {
    const E = await setup();
    E.run('as(A)');
    let r = await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'lot', assetId:'lot-bf', sellerId:A.id, buyerId:C.id, pct:10, price:3}, {silent:true}))`);
    ok(r.ok, 'Co Alice propose 10 % du lot Bleu foncé à Co Carl pour 3 M$');
    r = await E.run(`act(()=>postRevenueSwapListing(A.id, [BF[1].id], 0.6, 3, 2, {silent:true}))`);
    ok(r.ok, 'Co Alice annonce une ABS sur le lot Bleu foncé');
    const m0 = E.cash();
    E.run('as(C)');
    r = await E.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
    ok(!r.ok && /a annoncé une émission ABS sur le lot Bleu foncé/.test(r.error) && E.run('shareOf(BF[0], C)') === 0 && near(E.cash(), m0), `acceptation refusée, rien ne bouge, monnaie conservée : « ${r.error} »`);
  }
  console.log('1c — contre-épreuve : verrou ABS retiré de sellPropertyShare');
  {
    const E = await setup({ transform: s => s.replace("  if(isPropertyLockedByRevenueSwap(pid, sellerId)) return fail(revenueSwapLockMessage(pid, sellerId, 'de le vendre'));\n", '') });
    E.run('as(B)');
    await E.run(OFFRE_AE); await E.run(ABS_AE);
    E.run('as(C)');
    const r = await E.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
    ok(r.ok && E.run('shareOf(AE, C)') === 10, 'sans le raccord : Co Carl achète 10 % d’un terrain dont le revenu est annoncé en ABS — le test détecte la régression');
  }

  // ---------- 2. Échange de parts : un seul contrôle ABS ----------
  console.log('2 — échange de parts : un seul contrôle ABS, message du lot 4');
  {
    const src = require('./helpers/engine').engineSource();
    const body = src.slice(src.indexOf('async function executeShareSwap('), src.indexOf('function groupMergeEligible('));
    ok(!/isPropertyLockedByRevenueSwap|rentSwapSaleLockMessage/.test(body), 'executeShareSwap ne contient plus de contrôle ABS ni de swap en double (tout est dans shareSwapGiveRefusal)');
    const E = await setup();
    E.run('as(B)'); await E.run(ABS_AE);
    E.run('myPlayerId = state.creatorId');
    const m0 = E.cash();
    const r = await E.run(`act(()=>executeShareSwap('prop', AE.id, B.id, 10, 'prop', AE2.id, C.id, 10, {silent:true}))`);
    ok(!r.ok && /Co Bob a annoncé une émission ABS sur Aéroport 1/.test(r.error) && /impossible de l'échanger/.test(r.error), `échange refusé pendant l’annonce : « ${r.error} »`);
    ok(E.run('shareOf(AE, C)') === 0 && E.run('shareOf(AE2, B)') === 0 && near(E.cash(), m0), 'parts inchangées, monnaie conservée');
    const X = await setup({ transform: s => s.replace("  if(isPropertyLockedByRevenueSwap(host.id, giverId)) return revenueSwapLockMessage(host.id, giverId, \"de l'échanger\");\n", '') });
    X.run('as(B)'); await X.run(ABS_AE);
    X.run('myPlayerId = state.creatorId');
    const rx = await X.run(`act(()=>executeShareSwap('prop', AE.id, B.id, 10, 'prop', AE2.id, C.id, 10, {silent:true}))`);
    ok(rx.ok && X.run('shareOf(AE, C)') === 10, 'contre-épreuve : contrôle unique retiré → l’échange passe (aucun autre contrôle ne le rattrape)');
  }

  // ---------- 3. Hypothèque : verrou ABS du lot 4 dans les offres du lot 5 ----------
  console.log('3 — offre d’hypothèque (lot 5) et annonce d’ABS (lot 4)');
  {
    const E = await setup();
    E.run('as(B)');
    let r = await E.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    ok(r.ok && E.json('state.mortgageOffers.length') === 1, 'Co Bob propose à Co Carl une hypothèque sur sa part de l’Aéroport 1');
    r = await E.run(ABS_AE);
    ok(r.ok && E.json('state.mortgageOffers.length') === 0 && E.saved().mortgageOffers.length === 0, 'l’annonce d’ABS rend l’offre caduque : retirée dans la même écriture');
    ok(E.json('state.log').some(l => /offre d'hypothèque de Co Bob sur Aéroport 1 auprès de Co Carl est retirée : Co Bob a annoncé une émission ABS/.test(l.text)), 'trace au journal, avec le motif de l’annonce');
    r = await E.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    ok(!r.ok && /Co Bob a annoncé une émission ABS sur Aéroport 1, résolue au prochain lancer de dés — impossible de l'hypothéquer/.test(r.error), `nouvelle offre refusée : « ${r.error} »`);
    r = await E.run(`act(()=>issueMortgage(AE.id, B.id, 'BANK', {silent:true}))`);
    ok(!r.ok && /impossible de l'hypothéquer/.test(r.error) && E.json('AE.mortgages').length === 0, 'hypothèque auprès de la banque refusée aussi');
    // Nettoyage désactivé (ancien onglet) : l'acceptation revérifie quand même le verrou sur l'état frais.
    const Y = await setup({ transform: s => s.replace('      try{ dropStaleMortgageOffers(); }\n', '      try{ }\n') });
    Y.run('as(B)');
    await Y.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`); await Y.run(ABS_AE);
    Y.run('as(C)');
    const m0 = Y.cash(), c0 = Y.run('C.cash');
    const ra = await Y.run(`acceptMortgageOffer(state.mortgageOffers[0].id)`);
    ok(!ra.ok && /a annoncé une émission ABS/.test(ra.error) && near(Y.run('C.cash'), c0) && near(Y.cash(), m0), `sans nettoyage : acceptation refusée, Co Carl n’avance rien : « ${ra.error} »`);
    const X = await setup({ transform: s => s.replace("  if(isPropertyLockedByRevenueSwap(host.id, borrowerId)) return {unavailable:revenueSwapLockMessage(host.id, borrowerId, \"de l'hypothéquer\")};",
      "  if(isPropertyLockedByRevenueSwap(host.id, borrowerId)) return {unavailable:`Le revenu de ${label} a été vendu (swap de revenu fixe/variable) — impossible de l'hypothéquer tant que l'accord est actif.`};") });
    X.run('as(B)'); await X.run(ABS_AE);
    const rx = await X.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    ok(!rx.ok && !/a annoncé une émission ABS/.test(rx.error), 'contre-épreuve : ancien message réintroduit → « a été vendu » alors que l’ABS n’est qu’annoncée — le test le détecte');
  }

  // ---------- 4. ABS + compensation + prêts sur le même loyer ----------
  for(const loanOn of [true, false]){
    console.log(`4 — ABS + accord de compensation + prêts sur le même loyer (option « Prêts » ${loanOn ? 'cochée' : 'décochée'})`);
    const run4 = async (transform) => {
      const E = await setup(transform ? { transform } : {});
      E.run(`state.settings.features.loan = ${loanOn}; state.settings.features.rentCompensation = true;
        globalThis.V = ['Vert 1','Vert 2','Vert 3'].map(nm=>state.properties.find(p=>p.name===nm));
        V.forEach(p=>{ p.owners = [{companyId:B.id, share:90}]; p.houses = 0; p.mortgages = []; p.groupMergeId = 'lot-vert'; p.insurance = null; p.subInsurance = null; });
        V[0].houses = 1;
        state.revenueSwaps = [{id:'abs', sellerId:B.id, propertyIds:[V[0].id], cededPctOfShare:0.6, years:3, yearsRemaining:3, endRoll:18,
          pricing:{termRolls:18, meanRent:10, stdRent:1, seniorCapacity:0}, seniorPremiumPct:0.1, seniorRaised:0, juniorRaised:1, seniorCapTotal:0, seniorPaidSoFar:0,
          seniorHolders:[], juniorHolders:[{holderType:'company', holderId:C.id, amount:1, receivedSoFar:0}]}];
        state.rentCompensations = [{id:'comp', companyA:A.id, companyB:B.id, interestRate:0.05, balance:0}];
        globalThis.LP = state.players[2];
        state.loans = [
          {id:'pret', lenderId:LP.id, lenderKind:'player', borrowerId:B.id, principal:5, totalDue:50, repaidSoFar:0, withholdingPct:0.2, multiple:10, secured:false, createdAt:'t', roll:0},
          {id:'dr', lenderId:'BANK', lenderKind:'bank', borrowerId:B.id, principal:10, totalDue:20, repaidSoFar:0, withholdingPct:0.5, multiple:2, createdAt:'t', lastResort:true}];`);
      const full = E.run('colorRentAt(V[0], V[0].houses) * 0.9');
      const snap = () => E.json(`({a:A.cash, b:B.cash, c:C.cash, lp:LP.cash, bank:state.bank.cash, pret:state.loans[0].repaidSoFar, dr:state.loans[1].repaidSoFar, bal:state.rentCompensations[0].balance, led:state.finLedger.length})`);
      const s0 = snap(), m0 = E.cash();
      await E.run('settlePropertyRent(V[0], A.id, 7, {skipSave:true})');
      const s1 = snap();
      const led = E.json(`state.finLedger.slice(${s0.led})`);
      const sum = (cat, id) => led.filter(e => e.category === cat && e.companyId === id).reduce((s, e) => s + e.amount, 0);
      const bId = E.run('B.id'), cId = E.run('C.id');
      return { full, s0, s1, dMasse: E.cash() - m0, rent: sum('rent_revenue', bId), interest: sum('abs_interest_expense', bId), repay: sum('loan_repayment_via_rent', bId), absIncome: sum('abs_income', cId) };
    };
    const v = await run4();
    const F = v.full, d = k => v.s1[k] - v.s0[k];
    // Calcul attendu : retenue ordinaire (20 % du loyer entier si l'option est cochée), part cédée aux porteurs (60 %),
    // retenue de dernier recours (50 % de ce qui reste), le reste (net) au registre de compensation.
    const wN = loanOn ? 0.2 * F : 0, ceded = 0.6 * F, resid = Math.max(0, F - wN - ceded), wLR = 0.5 * resid, net = resid - wLR;
    console.log(`  loyer de la part de Co Bob ${f4(F)} : porteurs ${f4(ceded)}, prêt ordinaire ${f4(wN)}, dernier recours ${f4(wLR)}, registre ${f4(net)}`);
    ok(near(d('c'), ceded) && near(v.absIncome, ceded), `le porteur (Co Carl) reçoit la part cédée ${f4(ceded)} (abs_income)`);
    ok(near(d('pret'), wN) && near(d('lp'), wN), `prêt ordinaire : ${f4(wN)} retenus et versés au prêteur${loanOn ? '' : ' (rien : option « Prêts » décochée)'}`);
    ok(near(d('dr'), wLR), `prêt de dernier recours : ${f4(wLR)} retenus sur le reste après cession (bogue 23 : même sans l’option)`);
    ok(near(Math.abs(d('bal')), net), `registre de compensation : ${f4(net)} inscrits, aucun argent versé pour cette part`);
    ok(near(d('b'), 0), 'Co Bob : trésorerie inchangée (tout est versé aux porteurs, aux prêteurs ou inscrit au registre)');
    ok(near(v.rent, F - net) && near(v.interest, -ceded) && near(v.repay, -(wN + wLR)), `états de Co Bob : loyer réglé ${f4(v.rent)} = part cédée + retenues, intérêt d’ABS ${f4(v.interest)}, remboursement ${f4(v.repay)} (bogue 70)`);
    ok(near(v.rent + v.interest + v.repay, d('b')), 'états de Co Bob cohérents avec sa trésorerie');
    ok(near(v.dMasse, 0), 'monnaie conservée');
    if(loanOn){
      const w = await run4(s => s.replace("const settledNow = c._precomputedByAbs ? Math.max(0, c.amount - Math.max(0, net)) : r.totalWithheld;", "const settledNow = r.totalWithheld;"));
      ok(!near(w.rent, F - net), `contre-épreuve (bogue 70 retiré) : loyer enregistré ${f4(w.rent)} au lieu de ${f4(F - net)} — le test le détecte`);
    } else {
      let i = -1;
      const w = await run4(s => s.replace(/applyRentLoanWithholding\(([^;]*?)\)(?=;|\s*:)/g, (m, args) => (++i, i <= 1
        ? `(state.settings.features.loan ? applyLoanWithholding(${args}) : {net:${args.split(',')[1].trim()}, totalWithheld:0, withholdings:[]})` : m)));
      ok(near(w.s1.dr - w.s0.dr, 0) && !near(wLR, 0), 'contre-épreuve (retenue du lot 5 retirée du chemin ABS) : le dernier recours n’est plus remboursé — le test le détecte');
    }
  }

  // ---------- 5. Seul le CEO destinataire répond ----------
  console.log('5 — offres de vente et d’hypothèque : seul le CEO destinataire accepte ou refuse');
  {
    const E = await setup();
    E.run('as(B)');
    await E.run(OFFRE_AE);
    await E.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    const sid = E.run('state.assetSaleOffers[0].id'), mid = E.run('state.mortgageOffers[0].id');
    E.run('as(A)'); // tiers
    let r1 = await E.run(`acceptAssetSaleOffer(${JSON.stringify(sid)})`), r2 = await E.run(`refuseAssetSaleOffer(${JSON.stringify(sid)})`);
    let r3 = await E.run(`acceptMortgageOffer(${JSON.stringify(mid)})`), r4 = await E.run(`refuseMortgageOffer(${JSON.stringify(mid)})`);
    ok([r1, r2, r3, r4].every(r => !r.ok && /Seul le CEO de Co Carl peut/.test(r.error)), `un tiers (CEO de Co Alice) ne peut ni accepter ni refuser : « ${r1.error} » / « ${r3.error} »`);
    E.run('as(B)'); // auteur
    r2 = await E.run(`refuseAssetSaleOffer(${JSON.stringify(sid)})`); r4 = await E.run(`refuseMortgageOffer(${JSON.stringify(mid)})`);
    ok(!r2.ok && !r4.ok && E.json('state.assetSaleOffers.length') === 1 && E.json('state.mortgageOffers.length') === 1, 'l’auteur (Co Bob) ne refuse pas à la place du destinataire ; les offres restent');
    E.run('as(C)');
    r2 = await E.run(`refuseAssetSaleOffer(${JSON.stringify(sid)})`); r4 = await E.run(`refuseMortgageOffer(${JSON.stringify(mid)})`);
    ok(r2.ok && r4.ok && E.json('state.assetSaleOffers.length') === 0 && E.json('state.mortgageOffers.length') === 0, 'le CEO de Co Carl refuse les deux offres');
    const X = await setup({ transform: s => s.replace('function offerResponderRefusal(companyId, fallbackLabel, actionText){', 'function offerResponderRefusal(companyId, fallbackLabel, actionText){ return null;') });
    X.run('as(B)'); await X.run(OFFRE_AE); await X.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    X.run('as(A)');
    await X.run(`refuseAssetSaleOffer(state.assetSaleOffers[0].id)`); await X.run(`refuseMortgageOffer(state.mortgageOffers[0].id)`);
    ok(X.json('state.assetSaleOffers.length') === 0 && X.json('state.mortgageOffers.length') === 0, 'contre-épreuve : contrôle commun retiré → un tiers efface les offres faites à Co Carl');
  }

  // ---------- 6. Expirations au même endroit du cycle ----------
  console.log('6 — offres de vente et d’hypothèque : expiration au même lancer, dans la même écriture');
  {
    const E = await setup();
    E.run('as(B)');
    await E.run(OFFRE_AE);
    await E.run(`proposeMortgageOffer('prop', AE.id, B.id, C.id)`);
    const v0 = E.saved().version;
    const r = await E.run(`act(async ()=>{ advanceGameClock(); return {ok:true}; })`);
    const S = E.saved();
    ok(r.ok && S.version === v0 + 1 && S.assetSaleOffers.length === 0 && S.mortgageOffers.length === 0, 'au lancer suivant, les deux offres expirent dans la même écriture');
    const texts = S.log.map(l => l.text);
    ok(texts.some(t => /expire sans avoir été acceptée avant le lancer de dés suivant/.test(t)) && texts.some(t => /offre d'hypothèque de Co Bob .* expire/.test(t)), 'deux traces au journal (vente et hypothèque)');
    const src = require('./helpers/engine').engineSource();
    const i1 = src.indexOf('  expirePendingLoanRequests();\n  expirePendingMortgageOffers();'), i2 = src.indexOf('  expirePendingMortgageOffers(); // Section 312 — retouche de la revue\n  expireAssetSaleOffers();');
    ok(i1 >= 0 && i2 >= 0, 'advanceGameClock : expirePendingLoanRequests, expirePendingMortgageOffers et expireAssetSaleOffers sont voisines');
  }

  // ---------- 7. Noyau 308 : nettoyage qui lève ----------
  console.log('7 — nettoyage des offres d’hypothèque qui lève : l’action est quand même enregistrée');
  {
    const E = await setup();
    E.run(`dropStaleMortgageOffers = function(){ throw new Error('panne simulée du nettoyage'); }`);
    const r = await E.run(`act(()=>{ state.marqueurIntegration = 42; log('action de test'); return {ok:true}; })`);
    ok(r && r.ok, 'l’action réussit malgré l’exception du nettoyage');
    ok(E.saved().marqueurIntegration === 42 && E.run('state.marqueurIntegration') === 42, 'la mutation est enregistrée (valeur sauvegardée) et gardée en mémoire');
    ok(E.errors.some(e => /Nettoyage des offres d’hypothèque caduques impossible/.test(e) && /panne simulée/.test(e)), 'l’erreur est journalisée dans la console');
    const r2 = await E.run(`act(()=>{ state.marqueurIntegration = 43; return {ok:true}; })`);
    ok(r2.ok && E.saved().marqueurIntegration === 43, 'les actions suivantes passent aussi (partie non bloquée)');
    const X = await setup({ transform: s => s.replace('      try{ dropStaleMortgageOffers(); }\n      catch(e){', '      dropStaleMortgageOffers();\n      if(0) try{ }catch(e){') });
    X.run(`dropStaleMortgageOffers = function(){ throw new Error('panne simulée du nettoyage'); }`);
    let rx, thrown = null;
    try{ rx = await X.run(`act(()=>{ state.marqueurIntegration = 42; return {ok:true}; })`); }catch(e){ thrown = e; }
    ok((thrown || !(rx && rx.ok)) && X.saved().marqueurIntegration === undefined, 'contre-épreuve : sans protection, l’action échoue (exception) et rien n’est enregistré — le test le détecte');
  }

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
