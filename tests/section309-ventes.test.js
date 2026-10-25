// Test — section 309 (lot 2 de l'audit du 2026-10-19 : immobilier, parts et maisons) : vente d'une part de terrain ou
// de lot. Bogues 8 (vendre la part d'une AUTRE entreprise, ou se vendre une part), 9 (la banque payait le prix saisi
// par le CEO), 35 (vente d'un terrain confirmée après le regroupement du lot), et décision de Julien « ventes
// unilatérales : exiger l'accord de l'acheteur » appliquée à la vente d'une part à une entreprise (offre que le CEO
// acheteur accepte ou refuse ; rien ne bouge avant). Bogue 64 (plafond de copropriétaires) : voulu, non corrigé
// (décision de Julien : le plafond ne vaut qu'à l'achat initial d'un terrain individuel).
//
// Chaque correctif a sa contre-épreuve : loadEngine({transform}) réintroduit l'ancien comportement et le même
// scénario échoue. Lancer depuis la racine du dépôt :  node tests/section309-ventes.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

// Partie à quatre : Alice (créatrice) CEO de Co Alice = C0, Bob → C1, Carl → C2, Dan → C3 ; 20 M$ de trésorerie
// chacune. Mini-DOM du banc : les vrais gestionnaires des fenêtres s'exécutent.
async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           globalThis.P = id => state.properties.find(p=>p.id===id);
           globalThis.as = i => { myPlayerId = state.players[i].id; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.champ = (id, v) => { doc.trouver(id).value = String(v); };
  return E;
}
// Brun 1 (p0, prix de base 0,6) : C0 60 %, C1 40 %. Brun 2 (p1) : C0 60 %, C1 40 %.
const BRUN_6040 = `P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}];
                   P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}];`;

(async () => {
  // ---------- Bogue 8 : le vendeur est l'entreprise du CEO qui agit ----------
  console.log('Bogue 8 — « Vendre une part » : vendeur = entreprise du CEO, acheteur ≠ vendeur');
  let E = await setup();
  E.run(BRUN_6040 + `as(1);`);
  E.run(`modalSellShare('p0')`);
  let html = E.fenetre();
  ok(!/id="mSeller"/.test(html), 'la fenêtre de Bob n’a plus de menu « Vendeur » (avant : Co Alice 60 % proposée par défaut)');
  ok(/Vendeur : <b>Co Bob<\/b> \(40% détenus\)/.test(html), 'la fenêtre affiche le vendeur imposé : « Vendeur : Co Bob (40% détenus) »');
  ok(!new RegExp(`<option value="${E.run('C1.id')}"`).test(html), 'Co Bob ne figure pas parmi les acheteurs (pas de vente à soi-même)');
  E.run('closeModal()');
  let total0 = E.cash();
  // Requête forgée (ancien appareil, console) : Bob vend les 60 % de Co Alice à Co Bob pour 0,01 M$.
  let r = await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C0.id, buyerId:C1.id, pct:60, price:0.01}, {silent:true}))`);
  ok(!r.ok && /Seul le CEO de Co Alice/.test(r.error), 'Bob ne peut pas proposer la part de Co Alice : « ' + r.error + ' »');
  ok(E.json(`P('p0').owners`).find(o => o.companyId === E.run('C0.id')).share === 60 && E.json('state.assetSaleOffers').length === 0, 'Brun 1 inchangé (Co Alice 60 %), aucune offre enregistrée');
  r = await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C1.id, pct:1, price:5}, {silent:true}))`);
  ok(!r.ok && /AUTRE entreprise/.test(r.error), 'offre à soi-même refusée : « ' + r.error + ' »');
  r = E.json(`sellPropertyShare('p0', C1.id, C1.id, 1, 5, {silent:true})`);
  ok(!r.ok && /elle-même/.test(r.error), 'cœur de la vente : se vendre 1 % à soi-même pour 5 M$ refusé (« ' + r.error + ' »)');
  E.run('as(0)'); E.run(`mergeGroup('BRUN')`); await settle();
  const lotId = E.run(`P('p0').groupMergeId`);
  r = await E.run(`sellMergedShare(${JSON.stringify(lotId)}, C0.id, C0.id, 1, 5, {silent:true})`);
  ok(!r.ok && /elle-même/.test(r.error), 'lot regroupé : se vendre une part à soi-même refusé');
  ok(near(E.cash(), total0) && E.run(`Object.values(state.realEstateCapex||{}).every(m=>Object.values(m).every(v=>v===0))`), 'aucun faux investissement inscrit, monnaie conservée');
  // Contre-épreuve : sans la garde acheteur ≠ vendeur, se vendre 1 % pour 5 M$ « réussit » et inscrit 5 M$ de coûts.
  ok(typeof lotId === 'string', 'le lot Brun a bien été regroupé');
  let X = await setup({ transform: s => s.replace("  if(buyerId===sellerId) return fail('Une entreprise ne peut pas se vendre une part à elle-même — choisissez un autre acheteur.');\n  const buyer = buyerId==='BANK' ? null : companyById(buyerId);\n  if(buyerId!=='BANK' && !buyer) return fail('Entreprise acheteuse introuvable.');\n  const sellerOwn = prop.owners", "  const buyer = buyerId==='BANK' ? null : companyById(buyerId);\n  if(buyerId!=='BANK' && !buyer) return fail('Entreprise acheteuse introuvable.');\n  const sellerOwn = prop.owners") });
  X.run(BRUN_6040);
  r = X.json(`sellPropertyShare('p0', C1.id, C1.id, 1, 5, {silent:true})`);
  ok(r.ok, 'contre-épreuve (garde retirée) : l’auto-vente de 1 % pour 5 M$ est acceptée — le test détecte la régression');
  X = await setup({ transform: s => s.replace("  if(myPlayerId!==seller.ceoId) return fail(`Seul le CEO de ${seller.name} peut proposer la vente de ses actifs.`);\n", '') });
  X.run(BRUN_6040 + `as(1);`);
  r = await X.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C0.id, buyerId:C1.id, pct:60, price:0.01}, {silent:true}))`);
  ok(r.ok, 'contre-épreuve (contrôle du CEO retiré) : Bob peut mettre en vente la part de Co Alice — le test détecte la régression');

  // ---------- Bogue 9 : la banque paie sa valeur de rachat ----------
  console.log('Bogue 9 — vente à la banque : valeur de rachat calculée par le moteur, jamais le prix saisi');
  E = await setup();
  E.run(BRUN_6040 + `as(0);`);
  const bv1 = E.run(`buybackValue(P('p0')) * 0.01`);
  ok(near(bv1, 0.0045, 1e-9), 'valeur de rachat de 1 % de Brun 1 : 0,0045 M$ (valeur intrinsèque 0,6 × (1 − 25 %) × 1 %)');
  total0 = E.cash();
  let c0 = E.run('C0.cash'), bank0 = E.run('state.bank.cash');
  E.run(`modalSellShare('p0')`);
  E.champ('mBuyer', 'BANK'); E.champ('mPct', 1); E.champ('mPrice', 500);
  await E.cliquer('#mOk');
  html = E.fenetre();
  ok(/Vendre à la banque/.test(html) && /valeur de rachat/.test(html) && /5 K\$/.test(html), 'Alice tape 500 M$ : la fenêtre de confirmation annonce la valeur de rachat (5 K$), pas 500 M$');
  ok(near(E.run('C0.cash'), c0), 'rien n’est vendu avant la confirmation');
  await E.cliquer('#mOk');
  ok(near(E.run('C0.cash') - c0, 0.0045, 1e-9) && near(E.run('state.bank.cash') - bank0, -0.0045, 1e-9), 'après confirmation : Co Alice +0,0045 M$, banque −0,0045 M$ (avant : +500 M$ / −500 M$)');
  ok(E.json(`P('p0').owners`).find(o => o.companyId === E.run('C0.id')).share === 59, 'Co Alice passe de 60 % à 59 % de Brun 1');
  ok(near(E.cash(), total0), 'monnaie conservée');
  // Cœur appelé avec un prix saisi de 500 M$ (requête forgée) : la banque paie quand même la valeur de rachat.
  c0 = E.run('C0.cash');
  r = await E.run(`act(()=>sellPropertyShare('p0', C0.id, 'BANK', 1, 500, {silent:true}))`);
  ok(r.ok && near(E.run('C0.cash') - c0, 0.0045, 1e-9), 'cœur de la vente avec 500 M$ saisis : la banque paie 0,0045 M$');
  ok(near(E.cash(), total0), 'monnaie conservée sur toutes les ventes à la banque');
  // Lot regroupé : 1 % du lot Brun à la banque (valeur de rachat du lot = 0,45 + 0,90 = 1,35 M$).
  E = await setup();
  E.run(BRUN_6040 + `as(0);`);
  E.run(`mergeGroup('BRUN')`); await settle();
  const lot = E.run(`P('p0').groupMergeId`);
  ok(typeof lot === 'string' && lot.length > 0, 'le lot Brun est regroupé');
  const bvLot = E.run(`buybackValueLot(${JSON.stringify(lot)}) * 0.01`);
  ok(near(bvLot, 0.0135, 1e-9), 'valeur de rachat de 1 % du lot Brun : 0,0135 M$');
  total0 = E.cash();
  c0 = E.run('C0.cash');
  r = await E.run(`act(()=>sellMergedShare(${JSON.stringify(lot)}, C0.id, 'BANK', 1, 500, {silent:true}))`);
  ok(r.ok && near(E.run('C0.cash') - c0, bvLot, 1e-9), `lot Brun : 1 % vendu à la banque pour sa valeur de rachat (${bvLot.toFixed(4)} M$), pas 500 M$`);
  ok(E.json(`state.properties.filter(p=>p.groupMergeId===${JSON.stringify(lot)}).map(p=>p.owners[0].share)`).join() === '59,59', 'Co Alice passe à 59 % sur les deux terrains du lot');
  ok(near(E.cash(), total0), 'monnaie conservée');
  r = await E.run(`sellMergedShare(undefined, C0.id, 'BANK', 1, 0, {silent:true})`);
  ok(!r.ok && /Ce lot n’existe plus/.test(r.error), 'identifiant de lot absent : refus clair (jamais « tous les terrains non regroupés »)');
  // Conditions changées entre l'affichage et le clic : 2e confirmation, rien n'est fait.
  E = await setup();
  E.run(BRUN_6040 + `as(0);`);
  E.run(`modalConfirmBankShareSale({type:'prop', id:'p0'}, C0.id, 10)`);
  const prixAffiche = E.run(`bankBuybackPrice({type:'prop', id:'p0'}, 10)`);
  E.run(`P('p0').acquisitionPrice = 1.2;`); // le prix plancher change : la valeur de rachat double
  c0 = E.run('C0.cash');
  await E.cliquer('#mOk');
  ok(near(E.run('C0.cash'), c0) && /Les conditions ont changé/.test(E.fenetre()), 'valeur de rachat changée avant le clic : rien n’est vendu, la fenêtre affiche les nouvelles conditions');
  await E.cliquer('#mOk');
  ok(near(E.run('C0.cash') - c0, 2 * prixAffiche, 1e-9), `2e confirmation : vente au nouveau prix (${(2 * prixAffiche).toFixed(3)} M$ au lieu de ${prixAffiche.toFixed(3)})`);
  // Contre-épreuve : sans le calcul imposé, la banque paie le prix saisi.
  X = await setup({ transform: s => s.replace("  if(buyerId==='BANK') price = bankBuybackPrice({type:'prop', id:pid}, pct);\n  else if(!(price>0))", "  if(!(price>0))") });
  X.run(BRUN_6040);
  c0 = X.run('C0.cash');
  r = X.json(`sellPropertyShare('p0', C0.id, 'BANK', 1, 500, {silent:true})`);
  ok(r.ok && near(X.run('C0.cash') - c0, 500), 'contre-épreuve (calcul retiré) : la banque paie 500 M$ pour 1 % — le test détecte la régression');

  // ---------- Décision « ventes unilatérales » : vente d'une part à une entreprise = offre à accepter ----------
  console.log('Décision — vente d’une part à une entreprise : offre que le CEO acheteur accepte ou refuse');
  E = await setup();
  E.run(BRUN_6040 + `as(1);`);
  total0 = E.cash();
  let c1 = E.run('C1.cash'), c2 = E.run('C2.cash');
  E.run(`modalSellShare('p0')`);
  E.champ('mBuyer', E.run('C2.id')); E.champ('mPct', 10); E.champ('mPrice', 3);
  await E.cliquer('#mOk');
  let offers = E.json('state.assetSaleOffers');
  ok(offers.length === 1 && offers[0].pct === 10 && offers[0].price === 3 && offers[0].buyerId === E.run('C2.id'), 'Bob propose 10 % de Brun 1 à Co Carl pour 3 M$ : offre enregistrée');
  ok(near(E.run('C1.cash'), c1) && near(E.run('C2.cash'), c2) && !E.json(`P('p0').owners`).some(o => o.companyId === E.run('C2.id')), 'rien ne bouge avant l’acceptation : encaisses et parts inchangées');
  E.run('as(2)');
  ok(/Co Bob vous propose 10% de Brun 1 pour 3\.00 M\$/.test(E.run('renderEntreprise()')) && /data-accept-asset-offer/.test(E.run('renderEntreprise()')), 'l’offre apparaît dans l’onglet Mon Entreprise de Carl, avec Accepter / Refuser');
  E.run('as(1)');
  ok(/Offre à Co Carl : 10% de Brun 1/.test(E.run('renderEntreprise()')) && /data-cancel-asset-offer/.test(E.run('renderEntreprise()')), 'Bob voit son offre en attente, avec Retirer');
  E.run('as(0)');
  r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(!r.ok && /Seul le CEO de Co Carl/.test(r.error), 'Alice ne peut pas accepter à la place de Carl');
  E.run('as(2)');
  E.run(`C2.cash = 2;`);
  E.run(`modalAcceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(/Accepter et payer 3\.00 M\$/.test(E.fenetre()), 'Carl voit les conditions : « Accepter et payer 3.00 M$ »');
  await E.cliquer('#mOk');
  ok(E.alerts.some(a => /Offre non exécutée — Co Carl n'a pas assez d'encaisse/.test(a)) && E.json('state.assetSaleOffers').length === 1 && near(E.run('C2.cash'), 2), 'encaisse de Carl insuffisante (2 M$) : refus clair, rien n’est payé, l’offre reste en attente');
  E.run(`closeModal(); C2.cash = 20;`);
  c1 = E.run('C1.cash');
  total0 = E.cash();
  E.run(`modalAcceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  await E.cliquer('#mOk');
  ok(near(E.run('C2.cash'), 17) && near(E.run('C1.cash') - c1, 3), 'Carl accepte : Co Carl −3 M$, Co Bob +3 M$');
  ok(JSON.stringify(E.json(`P('p0').owners`)) === JSON.stringify([{ companyId: E.run('C0.id'), share: 60 }, { companyId: E.run('C1.id'), share: 30 }, { companyId: E.run('C2.id'), share: 10 }]), 'Brun 1 : Co Alice 60 %, Co Bob 30 %, Co Carl 10 %');
  ok(E.json('state.assetSaleOffers').length === 0 && near(E.cash(), total0), 'l’offre disparaît après l’acceptation ; monnaie conservée');
  // Refus et retrait.
  E.run('as(1)');
  await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C3.id, pct:5, price:1}, {silent:true}))`);
  await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C0.id, pct:5, price:1}, {silent:true}))`);
  offers = E.json('state.assetSaleOffers');
  ok(offers.length === 2 && offers[0].buyerId === E.run('C3.id') && offers[1].buyerId === E.run('C0.id'), 'offres de 5 % à Co Dan et à Co Alice enregistrées');
  E.run('as(3)');
  r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(r.ok && E.json(`P('p0').owners`).length === 4, 'Dan accepte : Co Dan devient 4e copropriétaire de Brun 1 — voulu (décision de Julien : le plafond ne vaut qu’à l’achat initial du terrain, bogue 64 non corrigé)');
  offers = E.json('state.assetSaleOffers');
  E.run('as(2)');
  r = await E.run(`cancelAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(!r.ok && E.json('state.assetSaleOffers').length === 1, 'Carl ne peut pas retirer l’offre de Bob');
  E.run('as(0)');
  r = await E.run(`refuseAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(r.ok && E.json('state.assetSaleOffers').length === 0 && E.json('state.log').some(l => /Co Alice refuse l'offre de Co Bob/.test(l.text || l.msg || JSON.stringify(l))), 'Alice refuse : l’offre disparaît, le journal le note');
  E.run('as(1)');
  await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C0.id, pct:5, price:1}, {silent:true}))`);
  offers = E.json('state.assetSaleOffers');
  r = await E.run(`cancelAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(r.ok && E.json('state.assetSaleOffers').length === 0, 'Bob retire son offre avant réponse');
  // La part a été vendue ailleurs entre l'offre et l'acceptation : refus, rien ne bouge.
  await E.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C0.id, pct:25, price:1}, {silent:true}))`);
  offers = E.json('state.assetSaleOffers');
  ok(offers.length === 1, 'Bob (25 %) propose toute sa part de Brun 1 à Co Alice');
  await E.run(`act(()=>sellPropertyShare('p0', C1.id, 'BANK', 10, 0, {silent:true}))`);
  E.run('as(0)');
  c0 = E.run('C0.cash');
  r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(offers[0].id)})`);
  ok(!r.ok && /Pourcentage invalide/.test(r.error) && near(E.run('C0.cash'), c0) && E.json('state.assetSaleOffers').length === 1, 'Co Bob a vendu 10 % à la banque entre-temps (reste 15 %) : l’acceptation de 25 % est refusée, rien ne bouge, l’offre reste (Alice peut la refuser)');
  // Contre-épreuve : sans contrôle d'encaisse à l'acceptation, l'acheteur paie sans en avoir les moyens.
  X = await setup({ transform: s => s.replace("    if(!opts.dryRun && buyer.cash<price-1e-9) return fail(`${buyer.name} n'a pas assez d'encaisse pour payer ${fmt(price)} (encaisse : ${fmt(buyer.cash)}).`);\n  }\n  if(opts.dryRun) return {ok:true};\n  prop.owners = newOwners;", "  }\n  if(opts.dryRun) return {ok:true};\n  prop.owners = newOwners;") });
  X.run(BRUN_6040 + `as(1);`);
  await X.run(`act(()=>proposeAssetSale({kind:'share', assetType:'prop', assetId:'p0', sellerId:C1.id, buyerId:C2.id, pct:10, price:30}, {silent:true}))`);
  X.run('as(2)');
  r = await X.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
  ok(r.ok && X.run('C2.cash') < 0, 'contre-épreuve (contrôle d’encaisse retiré) : Co Carl paie 30 M$ avec 20 M$ (encaisse ' + X.run('C2.cash').toFixed(2) + ' M$) — le test détecte la régression');

  // ---------- Bogue 35 : terrain regroupé entre l'ouverture et la confirmation ----------
  console.log('Bogue 35 — vente d’un terrain confirmée après le regroupement du lot');
  E = await setup();
  E.run(BRUN_6040 + `as(0);`);
  E.run(`modalSellShare('p0')`);                     // Alice ouvre la vente de Brun 1 (terrain seul)
  E.run(`mergeGroup('BRUN')`); await settle();         // l'administratrice regroupe le lot pendant ce temps
  E.champ('mBuyer', E.run('C2.id')); E.champ('mPct', 30); E.champ('mPrice', 0.5);
  await E.cliquer('#mOk');
  ok(E.alerts.some(a => /Brun 1 fait désormais partie du lot Brun regroupé/.test(a)) && E.json('state.assetSaleOffers').length === 0, 'offre refusée : « Brun 1 fait désormais partie du lot Brun regroupé… vendez une part du lot entier »');
  r = E.json(`sellPropertyShare('p0', C0.id, 'BANK', 30, 0, {silent:true})`);
  ok(!r.ok && /fait désormais partie du lot/.test(r.error), 'vente du terrain seul à la banque : même refus');
  ok(JSON.stringify(E.json(`P('p0').owners`)) === JSON.stringify(E.json(`P('p1').owners`)), 'les parts de Brun 1 et Brun 2 restent identiques (lot synchronisé)');
  X = await setup({ transform: s => s.replace("  const mergedRefusal = shareAssetMergedRefusal({type:'prop', id:pid});\n  if(mergedRefusal) return fail(mergedRefusal);\n  const seller = companyById(sellerId);", "  const seller = companyById(sellerId);") });
  X.run(BRUN_6040);
  X.run(`mergeGroup('BRUN')`); await settle();
  r = X.json(`sellPropertyShare('p0', C0.id, 'BANK', 30, 0, {silent:true})`);
  ok(r.ok && JSON.stringify(X.json(`P('p0').owners`)) !== JSON.stringify(X.json(`P('p1').owners`)), 'contre-épreuve (refus retiré) : seule Brun 1 change, le lot est désynchronisé — le test détecte la régression');

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
