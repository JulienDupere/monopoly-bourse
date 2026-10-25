// Test — section 309 (lot 2 de l'audit du 2026-10-19 : immobilier, parts et maisons) : maisons. Bogue 13 (construire
// créait de l'argent quand la banque ou le REIT détient une part du lot), bogue 33 (option « provenance des maisons » :
// construction depuis une réserve vide, compensation versée quand même), décision de Julien sur la compensation de
// maison (chaque autre copropriétaire paie sa quote-part, le fournisseur ne se paie pas lui-même, l'affichage montre le
// montant réellement transféré) et décision « ventes unilatérales » appliquée à « Vendre des maisons » (offre à
// accepter par le CEO acheteur).
//
// Chaque correctif a sa contre-épreuve (loadEngine({transform})). Lancer :  node tests/section309-maisons.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

// Partie à quatre (Alice créatrice → C0, Bob → C1, Carl → C2, Dan → C3), lancer 0 : fenêtre de fin d'année ouverte.
async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           globalThis.P = id => state.properties.find(p=>p.id===id);
           globalThis.as = i => { myPlayerId = state.players[i].id; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           globalThis.lotBrun = owners => { ['p0','p1'].forEach(id=>{ P(id).owners = owners.map(o=>({...o})); P(id).groupMergeId = 'LOTB'; }); };`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.champ = (id, v) => { doc.trouver(id).value = String(v); };
  E.snap = () => E.json(`{c0:C0.cash, c1:C1.cash, c2:C2.cash, c3:C3.cash, bank:state.bank.cash, h0:P('p0').houses, h1:P('p1').houses, r0:C0.houseReserve, r1:C1.houseReserve, r2:C2.houseReserve, r3:C3.houseReserve}`);
  return E;
}
const sumEntries = es => es.reduce((s, e) => s + e.amount, 0);
const OLD_BANK_CREDIT = s => s.replace('    state.bank.cash += paidByOwners;\n', '    state.bank.cash += cost;\n');

(async () => {
  // ---------- Bogue 13 : la banque n'encaisse que ce que les entreprises paient ----------
  console.log('Bogue 13 — construction sur un lot dont la banque ou le REIT détient une part');
  let E = await setup();
  // Lot Brun regroupé avec le REIT : réserve de 10 % (C0 60 %, C1 30 %, REIT 10 %).
  E.run(`state.settings.features.etf = true; state.settings.etfBankReservePct = 10;
         ['p0','p1'].forEach(id=>{ P(id).etfReservedPct = 10; P(id).owners = [{companyId:C0.id,share:60},{companyId:C1.id,share:30}]; }); as(0);`);
  E.run(`mergeGroup('BRUN')`); await settle();
  ok(E.json(`P('p0').owners.map(o=>o.share)`).join() === '60,30' && !!E.run(`P('p0').groupMergeId`), 'lot Brun regroupé : Co Alice 60 %, Co Bob 30 %, réserve REIT 10 %');
  let total0 = E.cash(), s0 = E.snap();
  let r = await E.run(`act(()=>buildHouseCore('p0', null, 0, {silent:true}))`);
  let s1 = E.snap();
  ok(r.ok && s1.h0 === 1, 'maison construite sur Brun 1 (coût 0,5 M$)');
  ok(near(s1.c0 - s0.c0, -0.30) && near(s1.c1 - s0.c1, -0.15), 'Co Alice paie 0,30 M$ (60 %), Co Bob 0,15 M$ (30 %)');
  ok(near(s1.bank - s0.bank, 0.45), 'la banque encaisse 0,45 M$ (avant : 0,50 M$, soit 0,05 M$ créés)');
  ok(near(E.cash(), total0), 'monnaie conservée');
  const entries = r.entries;
  ok(near(sumEntries(entries), 0) && entries.some(e => /REIT \(Première rue\), part de 10% non détenue par les entreprises — à sa charge/.test(e.label) && near(e.amount, -0.05)), 'reçu équilibré (somme 0) : « Banque (REIT (Première rue), part de 10% non détenue par les entreprises — à sa charge) −0,05 »');
  let X = await setup({ transform: OLD_BANK_CREDIT });
  X.run(`state.settings.features.etf = true; state.settings.etfBankReservePct = 10;
         ['p0','p1'].forEach(id=>{ P(id).etfReservedPct = 10; P(id).owners = [{companyId:C0.id,share:60},{companyId:C1.id,share:30}]; }); as(0);`);
  X.run(`mergeGroup('BRUN')`); await settle();
  total0 = X.cash();
  await X.run(`act(()=>buildHouseCore('p0', null, 0, {silent:true}))`);
  ok(near(X.cash() - total0, 0.05), 'contre-épreuve (banque créditée du prix complet) : 0,05 M$ créés — le test détecte la régression');
  // Sans REIT : part du lot revendue à la banque.
  E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(0);`);
  E.run(`mergeGroup('BRUN')`); await settle();
  await E.run(`act(()=>sellMergedShare(P('p0').groupMergeId, C1.id, 'BANK', 40, 0, {silent:true}))`);
  total0 = E.cash(); s0 = E.snap();
  r = await E.run(`act(()=>buildHouseCore('p0', null, 0, {silent:true}))`);
  s1 = E.snap();
  ok(r.ok && near(s1.c0 - s0.c0, -0.30) && near(s1.bank - s0.bank, 0.30) && near(E.cash(), total0), 'lot Brun : Co Alice 60 %, banque 40 % : Co Alice paie 0,30 M$, la banque encaisse 0,30 M$ (avant : 0,50, soit 0,20 M$ créés)');
  ok(near(sumEntries(r.entries), 0), 'reçu équilibré');

  // ---------- Bogue 33 : réserve de la source revérifiée, aucune compensation sans maison fournie ----------
  console.log('Bogue 33 — option « provenance des maisons » : réserve revérifiée à la confirmation');
  const SRC = `state.settings.features.houseSource = true; C2.houseReserve = 1;
               lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:40}]); as(0);`;
  E = await setup();
  E.run(SRC);
  total0 = E.cash(); s0 = E.snap();
  // Deux CEO ont ouvert la fenêtre avec la même source (Co Carl, 1 maison) ; les deux confirment.
  r = await E.run(`act(()=>buildHouseCore('p0', C2.id, 0.4, {silent:true}))`);
  let r2 = await E.run(`act(()=>buildHouseCore('p1', C2.id, 0.4, {silent:true}))`);
  s1 = E.snap();
  ok(r.ok && s1.h0 === 1 && s1.r2 === 0, '1re construction : maison prise dans la réserve de Co Carl (réserve 1 → 0)');
  ok(!r2.ok && /Co Carl n'a plus de maison en réserve/.test(r2.error) && s1.h1 === 0, '2e construction refusée : « ' + r2.error + ' »');
  ok(near(s1.c2 - s0.c2, 0.4), 'Co Carl reçoit sa compensation UNE fois (0,4 M$ ; avant : 0,8 M$ pour une seule maison fournie)');
  ok(near(E.cash(), total0), 'monnaie conservée');
  r = await E.run(`act(()=>buildHouseCore('p1', null, 0, {silent:true}))`);
  ok(!r.ok && /provenance des maisons/.test(r.error), 'option active : une construction sans source est refusée');
  X = await setup({ transform: s => s.replace("    if(!((source.houseReserve||0)>=1)) return fail(", "    if(false) return fail(") });
  X.run(SRC);
  s0 = X.snap();
  await X.run(`act(()=>buildHouseCore('p0', C2.id, 0.4, {silent:true}))`);
  r2 = await X.run(`act(()=>buildHouseCore('p1', C2.id, 0.4, {silent:true}))`);
  ok(r2.ok && near(X.snap().c2 - s0.c2, 0.8), 'contre-épreuve (contrôle retiré) : deux maisons pour une seule en réserve, 0,8 M$ de compensation — le test détecte la régression');

  // ---------- Décision : compensation de maison ----------
  console.log('Décision — compensation de maison : quote-parts des AUTRES copropriétaires, montant réellement transféré affiché');
  E = await setup();
  E.run(`state.settings.features.houseSource = true; C0.houseReserve = 1; lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:40}]); as(0);`);
  E.run(`modalHouseCompensation('p0', C0.id)`);
  ok(/Valeur convenue de la maison/.test(E.fenetre()) && !/Montant total à transférer/.test(E.fenetre()), 'le champ s’appelle « Valeur convenue de la maison » (avant : « Montant total à transférer », qui n’était pas le montant transféré)');
  E.run(`modalHouseCompensation('p0', C0.id, 1)`);
  let html = E.fenetre();
  ok(/Co Bob paie 400 K\$ \(quote-part 40%/.test(html), 'aperçu : « Co Bob paie 400 K$ (quote-part 40 %…) »');
  ok(/Montant réellement transféré à Co Alice : 400 K\$/.test(html) && /Co Alice ne se paie pas sa propre quote-part de 60%/.test(html), 'aperçu : « Montant réellement transféré à Co Alice : 400 K$ », « Co Alice ne se paie pas sa propre quote-part de 60 % »');
  total0 = E.cash(); s0 = E.snap();
  E.run(`window.__popups = []; showTransactionPopup = (t, es) => window.__popups.push({t, es});`);
  await E.cliquer('#mOk');
  s1 = E.snap();
  ok(s1.h0 === 1 && s1.r0 === 0, 'maison construite avec la maison de la réserve de Co Alice');
  ok(near(s1.c1 - s0.c1, -0.20 - 0.40) && near(s1.c0 - s0.c0, -0.30 + 0.40), 'Co Bob paie 0,20 (construction) + 0,40 (quote-part) ; Co Alice paie 0,30 et reçoit 0,40 — elle ne se paie pas elle-même');
  const pop = E.json('window.__popups')[0];
  ok(pop && pop.es.some(e => /Co Alice \(compensation reçue/.test(e.label) && near(e.amount, 0.4)) && pop.es.some(e => /Co Bob \(compensation maison, quote-part de 40%/.test(e.label) && near(e.amount, -0.4)), 'fenêtre de transaction : Co Bob −0,40, Co Alice +0,40 (montant réellement transféré)');
  ok(E.json('state.log').some(l => /compensation de 400 K\$ réellement versée/.test(JSON.stringify(l)) && /Co Alice ne se paie pas sa propre quote-part de 60%/.test(JSON.stringify(l))), 'journal : « compensation de 400 K$ réellement versée… (valeur convenue 1,00 M$ ; Co Alice ne se paie pas sa propre quote-part de 60 %) »');
  ok(near(sumEntries(pop.es), 0) && near(E.cash(), total0), 'reçu équilibré, monnaie conservée');
  // Source non copropriétaire : tous les copropriétaires paient, la source reçoit la valeur entière.
  E = await setup();
  E.run(`state.settings.features.houseSource = true; C2.houseReserve = 1; lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:40}]); as(0);`);
  s0 = E.snap();
  r = await E.run(`act(()=>buildHouseCore('p0', C2.id, 1, {silent:true}))`);
  s1 = E.snap();
  ok(r.ok && near(s1.c2 - s0.c2, 1) && near(s1.c0 - s0.c0, -0.30 - 0.60) && near(s1.c1 - s0.c1, -0.20 - 0.40), 'source non copropriétaire (Co Carl) : Co Alice 0,60, Co Bob 0,40, Co Carl reçoit 1,00 M$');
  // Avec la réserve REIT : quote-part = part / parts détenues par les entreprises (hors REIT).
  E = await setup();
  E.run(`state.settings.features.etf = true; state.settings.etfBankReservePct = 10; state.settings.features.houseSource = true; C0.houseReserve = 1;
         ['p0','p1'].forEach(id=>{ P(id).etfReservedPct = 10; }); lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:30}]); as(0);`);
  total0 = E.cash(); s0 = E.snap();
  r = await E.run(`act(()=>buildHouseCore('p0', C0.id, 0.9, {silent:true}))`);
  s1 = E.snap();
  ok(r.ok && near(s1.c1 - s0.c1, -0.15 - 0.30) && near(E.cash(), total0), 'avec le REIT (10 %) : Co Bob (30 %) paie 30/90 de 0,9 = 0,30 M$ à Co Alice, la banque ne paie aucune compensation');
  // Encaisse insuffisante d'un payeur : refus, rien ne bouge.
  E = await setup();
  E.run(`state.settings.features.houseSource = true; C0.houseReserve = 1; lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:40}]); C1.cash = 0.3; as(0);`);
  s0 = E.snap();
  r = await E.run(`act(()=>buildHouseCore('p0', C0.id, 1, {silent:true}))`);
  ok(!r.ok && /Co Bob n'a pas assez d'encaisse pour payer sa part de la construction \(200 K\$\) et sa quote-part de la compensation \(400 K\$\)/.test(r.error) && JSON.stringify(E.snap()) === JSON.stringify(s0), 'Co Bob (0,3 M$) ne peut pas payer 0,20 + 0,40 : refus clair, rien ne bouge (avant : encaisse négative)');
  // Parts changées entre l'ouverture de la fenêtre et le clic : rien n'est fait, la fenêtre se redessine.
  const STALE = `state.settings.features.houseSource = true; C0.houseReserve = 1; lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:40}]); as(0);`;
  E = await setup();
  E.run(STALE);
  E.run(`modalHouseCompensation('p0', C0.id, 1)`);
  E.run(`lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:30},{companyId:C2.id,share:10}])`); // Co Bob a vendu 10 % du lot
  s0 = E.snap();
  await E.cliquer('#mOk');
  ok(JSON.stringify(E.snap()) === JSON.stringify(s0) && /Les parts ont changé/.test(E.fenetre()) && /Co Carl paie 100 K\$/.test(E.fenetre()), 'parts changées avant le clic : rien n’est construit ni payé ; la fenêtre affiche les nouveaux versements (Co Carl paie 100 K$)');
  await E.cliquer('#mOk');
  s1 = E.snap();
  ok(s1.h0 === 1 && near(s1.c1 - s0.c1, -0.15 - 0.30) && near(s1.c2 - s0.c2, -0.05 - 0.10), '2e confirmation : construit avec les versements affichés (Co Bob 0,30, Co Carl 0,10)');
  X = await setup({ transform: s => s.replace("  if(opts.expectedTransfers && !sameConditions(opts.expectedTransfers, transfers.map(t=>({companyId:t.companyId, amount:t.amount})))) return staleConditionsResult();\n", '') });
  X.run(STALE);
  X.run(`modalHouseCompensation('p0', C0.id, 1)`);
  X.run(`lotBrun([{companyId:C0.id,share:60},{companyId:C1.id,share:30},{companyId:C2.id,share:10}])`);
  s0 = X.snap();
  await X.cliquer('#mOk');
  ok(X.snap().h0 === 1 && near(X.snap().c2 - s0.c2, -0.05 - 0.10), 'contre-épreuve (revérification retirée) : Co Carl paie une compensation qu’aucune fenêtre ne lui a montrée — le test détecte la régression');

  // ---------- Décision « ventes unilatérales » : vendre des maisons = offre à accepter ----------
  console.log('Décision — « Vendre des maisons » : offre que le CEO acheteur accepte ou refuse');
  E = await setup();
  E.run(`C0.houseReserve = 3; as(0);`);
  total0 = E.cash(); s0 = E.snap();
  E.run(`modalSellHouses()`);
  ok(/Proposer la vente/.test(E.fenetre()) && /C'est une <b>offre<\/b>/.test(E.fenetre()), 'la fenêtre « Vendre des maisons » annonce une offre (bouton « Proposer la vente »)');
  E.champ('mSellHousesBuyer', E.run('C1.id')); E.champ('mSellHousesQty', 2); E.champ('mSellHousesPrice', 0.5);
  await E.cliquer('#mOk');
  let offers = E.json('state.assetSaleOffers');
  ok(offers.length === 1 && offers[0].kind === 'houses' && offers[0].qty === 2 && offers[0].pricePerHouse === 0.5, 'offre enregistrée : 2 maisons à 0,5 M$ pour Co Bob');
  ok(JSON.stringify(E.snap()) === JSON.stringify(s0), 'rien ne bouge avant l’acceptation (ni argent, ni maisons)');
  E.run('as(1)');
  ok(/Co Alice vous propose 2 maison\(s\) de sa réserve \(500 K\$\/maison\) pour 1\.00 M\$/.test(E.run('renderEntreprise()')), 'l’offre apparaît dans l’onglet Mon Entreprise de Bob');
  E.run('as(2)');
  r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(!r.ok && /Seul le CEO de Co Bob/.test(r.error), 'Carl ne peut pas accepter à la place de Bob');
  E.run('as(0)');
  r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(!r.ok, 'Alice ne peut pas accepter sa propre offre');
  E.run('as(1); C1.cash = 0.5;');
  E.run(`modalAcceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  await E.cliquer('#mOk');
  ok(E.alerts.some(a => /Offre non exécutée — Co Bob n'a pas assez d'encaisse pour payer 1\.00 M\$/.test(a)) && E.json('state.assetSaleOffers').length === 1 && E.run('C0.houseReserve') === 3, 'Co Bob (0,5 M$) : refus clair à l’acceptation, rien ne bouge, l’offre reste');
  E.run('closeModal(); C1.cash = 20;');
  total0 = E.cash();
  E.run(`modalAcceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  await E.cliquer('#mOk');
  s1 = E.snap();
  ok(near(s1.c1, 19) && near(s1.c0 - s0.c0, 1) && s1.r0 === 1 && s1.r1 === 2, 'Bob accepte : Co Bob −1 M$, Co Alice +1 M$, réserves 3 → 1 et 0 → 2');
  ok(E.json('state.assetSaleOffers').length === 0 && near(E.cash(), total0), 'offre retirée de la liste, monnaie conservée');
  // Réserve vendue ailleurs entre l'offre et l'acceptation.
  E.run('as(0)');
  await E.run(`act(()=>proposeAssetSale({kind:'houses', sellerId:C0.id, buyerId:C2.id, qty:1, pricePerHouse:0.4}, {silent:true}))`);
  await E.run(`act(()=>proposeAssetSale({kind:'houses', sellerId:C0.id, buyerId:C3.id, qty:1, pricePerHouse:0.6}, {silent:true}))`);
  offers = E.json('state.assetSaleOffers');
  E.run('as(2)'); r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  E.run('as(3)'); r2 = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[1].id)})`);
  ok(r.ok && !r2.ok && /Co Alice n'a que 0 maison\(s\)/.test(r2.error) && E.run('C3.houseReserve') === 0 && E.json('state.assetSaleOffers').length === 1, 'la même maison offerte à Carl et à Dan : Carl accepte, l’acceptation de Dan est refusée (réserve vide), son offre reste');
  r = await E.run(`refuseAssetSaleOffer(${JSON.stringify(offers[1].id)})`);
  ok(r.ok && E.json('state.assetSaleOffers').length === 0, 'Dan refuse l’offre devenue impossible : elle disparaît');
  // Ancienne partie : champ absent → [] par migrateState.
  ok(E.json(`(()=>{ const s = JSON.parse(JSON.stringify(state)); delete s.assetSaleOffers; migrateState(s); return s.assetSaleOffers; })()`).length === 0, 'migrateState : une ancienne partie reçoit assetSaleOffers = []');
  // Contre-épreuves.
  X = await setup({ transform: s => s.replace("proposeAssetSale({kind:'houses', sellerId:myCo.id, buyerId, qty, pricePerHouse:price}, {silent:true})", 'sellHousesToCompany(myCo.id, buyerId, qty, price, {silent:true})') });
  X.run(`C0.houseReserve = 3; as(0);`);
  s0 = X.snap();
  X.run(`modalSellHouses()`);
  X.champ('mSellHousesBuyer', X.run('C1.id')); X.champ('mSellHousesQty', 2); X.champ('mSellHousesPrice', 0.5);
  await X.cliquer('#mOk');
  ok(near(X.snap().c1 - s0.c1, -1), 'contre-épreuve (ancienne vente directe) : Co Bob est débité sans avoir rien accepté — le test détecte la régression');
  X = await setup({ transform: s => s.replace("  if(!opts.dryRun && buyer.cash<totalPrice-1e-9) return fail(", "  if(false) return fail(") });
  X.run(`C0.houseReserve = 3; as(0);`);
  await X.run(`act(()=>proposeAssetSale({kind:'houses', sellerId:C0.id, buyerId:C1.id, qty:2, pricePerHouse:15}, {silent:true}))`);
  X.run('as(1)');
  r = await X.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
  ok(r.ok && X.run('C1.cash') < 0, 'contre-épreuve (contrôle d’encaisse retiré) : Co Bob paie 30 M$ avec 20 M$ — le test détecte la régression');

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
