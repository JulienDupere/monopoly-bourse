// Test — section 309, retouches de la revue : achats à la banque de l'Administration (créateur revérifié, prix fini
// et positif), écart réel de l'arrondi du regroupement (scénario Rose), prix proposé qui suit le pourcentage, expiration
// des offres de vente au lancer suivant (et prix refusé au dépôt), échange de parts réservé au créateur dans le moteur,
// un seul message quand la compensation de maison est périmée. Chaque correctif a sa contre-épreuve.
// Lancer :  node tests/section309-retouches.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           globalThis.P = id => state.properties.find(p=>p.id===id);
           globalThis.as = i => { myPlayerId = state.players[i].id; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.champ = (id, v) => { doc.trouver(id).value = String(v); };
  E.saisir = (id, v) => { const el = doc.trouver(id); el.value = String(v); el.__cible._ecouteurs.filter(l => l.type === 'input').forEach(l => l.fn.call(el, { type: 'input', target: el })); };
  return E;
}

(async () => {
  // ---------- 1. Achats à la banque de l'Administration ----------
  console.log('1. Achat à la banque (Administration) : créateur revérifié, prix fini et positif');
  let E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:99}]; as(1);`);   // Bob, non créateur, avec une fenêtre forgée
  const acqPrix = () => E.run(`P('p0').acquisitionPrice`);
  const ouvrirAchat = async (pct, prix) => {
    E.run(`modalBuyShares('p0')`);
    const id = (E.fenetre().match(/id="(mRowPct[^"]*)"/) || E.fenetre().match(/id="(mBuyerPct[^"]*)"/) || [])[1];
    if(id) E.champ(id, pct);
    E.champ('mPrice', prix);
    await E.cliquer('#mOk');
  };
  await ouvrirAchat(1, 500);
  ok(E.alerts.some(a => /Seul le créateur de la partie peut enregistrer un achat de terrain à la banque/.test(a)) && E.json(`P('p0').owners`).length === 1 && acqPrix() == null, 'Bob : achat refusé dans l’applyFn, aucune part, aucun prix d’acquisition inscrit');
  E.run('closeModal(); as(0);');
  await ouvrirAchat(1, '1e999');
  ok(E.alerts.some(a => /Le prix convenu doit être positif/.test(a)) && acqPrix() == null, 'Alice : prix infini (1e999) refusé');
  E.run('closeModal()');
  await ouvrirAchat(1, 0);
  ok(acqPrix() == null, 'prix nul refusé');
  E.run('closeModal()');
  X0: {
    const Y = await setup({ transform: s => s.replace("      if(myPlayerId!==state.creatorId) return {ok:false, error:'Seul le créateur de la partie peut enregistrer un achat de terrain à la banque.'};\n", '') });
    Y.run(`P('p0').owners=[{companyId:C0.id,share:99}]; as(1);`);
    Y.run(`modalBuyShares('p0')`);
    const id = (Y.fenetre().match(/id="(mRowPct[^"]*)"/) || Y.fenetre().match(/id="(mBuyerPct[^"]*)"/) || [])[1];
    if(id) Y.champ(id, 1);
    Y.champ('mPrice', 500);
    await Y.cliquer('#mOk');
    ok(Y.run(`P('p0').acquisitionPrice`) != null && Y.json(`P('p0').owners`).length === 2, 'contre-épreuve (contrôle retiré) : Bob inscrit un achat et un prix d’acquisition — le test détecte la régression'); // Section 309 — décision de Julien (2026-10-25) : plancher en moyenne pondérée (5,594 et non 500)
  }
  // Lot regroupé.
  E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(0);`);
  E.run(`mergeGroup('BRUN')`); await settle();
  await E.run(`act(()=>sellMergedShare(P('p0').groupMergeId, C1.id, 'BANK', 10, 0, {silent:true}))`);
  E.run('as(1)');
  let r = await E.run(`act(()=>buyMergedShareFromBank(P('p0').groupMergeId, C1.id, 10, 0.01, {silent:true}))`);
  ok(!r.ok && /Seul le créateur de la partie/.test(r.error), 'lot : Bob ne peut pas enregistrer le rachat d’une part à la banque');
  E.run('as(0)');
  r = await E.run(`act(()=>buyMergedShareFromBank(P('p0').groupMergeId, C1.id, 10, Infinity, {silent:true}))`);
  ok(!r.ok && /positif/.test(r.error), 'lot : prix infini refusé');
  r = await E.run(`act(()=>buyMergedShareFromBank(P('p0').groupMergeId, C1.id, 10, 0.2, {silent:true}))`);
  ok(r.ok, 'lot : la créatrice enregistre le rachat à 0,2 M$');
  let X = await setup({ transform: s => s.replace("  if(myPlayerId!==state.creatorId) return fail('Seul le créateur de la partie peut enregistrer le rachat d’une part de lot à la banque.');\n", '') });
  X.run(`P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(0);`);
  X.run(`mergeGroup('BRUN')`); await settle();
  await X.run(`act(()=>sellMergedShare(P('p0').groupMergeId, C1.id, 'BANK', 10, 0, {silent:true}))`);
  X.run('as(1)');
  r = await X.run(`act(()=>buyMergedShareFromBank(P('p0').groupMergeId, C1.id, 10, 0.2, {silent:true}))`); // Section 309-313 — retouche de la revue des décisions : prix au-dessus du minimum (valeur de rachat)
  ok(r.ok, 'contre-épreuve (contrôle retiré) : Bob rachète 10 % du lot pour 0,2 M$ — le test détecte la régression');

  // ---------- 2. Écart réel de l'arrondi du regroupement (scénario Rose de l'audit) ----------
  console.log('2. Regroupement : écart réel de l’arrondi (documenté)');
  E = await setup();
  const rose = E.json(`state.properties.filter(p=>p.group==='ROSE').map(p=>p.id)`);
  E.run(`P('${rose[0]}').owners=[{companyId:C0.id,share:1},{companyId:C1.id,share:99}]; P('${rose[1]}').owners=[{companyId:C1.id,share:100}];
         P('${rose[2]}').owners=[{companyId:C1.id,share:98},{companyId:C2.id,share:1},{companyId:C3.id,share:1}]; as(0);`);
  const prix = E.json(`['${rose[0]}','${rose[1]}','${rose[2]}'].map(id=>P(id).basePrice)`);
  const exactBob = (prix[0] * 0.99 + prix[1] + prix[2] * 0.98) / (prix[0] + prix[1] + prix[2]) * 100;
  E.run(`mergeGroup('ROSE')`); await settle();
  const bob = E.json(`P('${rose[0]}').owners`).find(o => o.companyId === E.run('C1.id')).share;
  ok(near(exactBob, 98.95, 0.01) && bob === 97, `Rose : Bob passe de ${exactBob.toFixed(2)} % exacts à ${bob} % (1,95 point cédé ; borne documentée : moins de k + 1 points, k = 3 petites parts)`);
  ok(E.json(`P('${rose[0]}').owners`).every(o => o.share >= 1), 'les trois petites parts sont relevées à 1 %');

  // ---------- 4. Le prix proposé suit le pourcentage ----------
  console.log('4. « Vendre une part » : le prix proposé suit le pourcentage tant que le joueur ne l’a pas modifié');
  E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(1);`);
  E.run(`modalSellShare('p0')`);
  const p40 = E.run(`bankBuybackPrice({type:'prop', id:'p0'}, 40).toFixed(2)`), p10 = E.run(`bankBuybackPrice({type:'prop', id:'p0'}, 10).toFixed(2)`);
  ok(E.doc.trouver('mPrice').value === p40, `prix proposé pour 40 % : ${p40}`);
  E.saisir('mPct', 10);
  ok(E.doc.trouver('mPrice').value === p10, `pourcentage ramené à 10 % : prix proposé recalculé à ${p10} (avant : resté à ${p40})`);
  E.saisir('mPrice', 3); E.saisir('mPct', 20);
  ok(E.doc.trouver('mPrice').value === '3', 'prix saisi par le joueur (3) : il n’est plus écrasé quand le pourcentage change');
  X = await setup({ transform: s => s.replace("    if(pEl && !priceTouched) pEl.value = bankBuybackPrice(asset, pct).toFixed(2);\n", '') });
  X.run(`P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(1);`);
  X.run(`modalSellShare('p0')`);
  X.saisir('mPct', 10);
  ok(X.doc.trouver('mPrice').value === p40, 'contre-épreuve (recalcul retiré) : l’offre de 10 % partirait au prix de 40 % — le test détecte la régression');

  // ---------- 5. Expiration des offres, prix refusé au dépôt, lancer affiché ----------
  console.log('5. Offres de vente : expiration au lancer suivant, prix refusé au dépôt, lancer affiché');
  const OFFRE = `act(()=>proposeAssetSale({kind:'houses', sellerId:C0.id, buyerId:C1.id, qty:1, pricePerHouse:PRIX}, {silent:true}))`;
  E = await setup();
  E.run(`C0.houseReserve = 2; as(0);`);
  for(const v of ['Infinity', 'NaN', '0', '-1']){
    r = await E.run(OFFRE.replace('PRIX', v));
    ok(!r.ok && /strictement positif/.test(r.error), `prix ${v} refusé au dépôt`);
  }
  r = await E.run(OFFRE.replace('PRIX', '0.5'));
  ok(r.ok && E.json('state.assetSaleOffers').length === 1 && E.json('state.assetSaleOffers')[0].roll === 0, 'offre de 1 maison à 0,5 M$ déposée au lancer 0');
  E.run('as(1)');
  ok(/déposée au lancer 0, expire au lancer suivant/.test(E.run('renderEntreprise()')), 'Bob voit le lancer de dépôt et l’expiration');
  const id0 = E.json('state.assetSaleOffers')[0].id;
  E.run(`modalAcceptAssetSaleOffer(${JSON.stringify(id0)})`);
  ok(/Offre déposée au lancer 0 : elle expire au lancer de dés suivant/.test(E.fenetre()), 'la fenêtre d’acceptation rappelle l’expiration');
  E.run('closeModal(); advanceGameClock();');
  ok(E.json('state.assetSaleOffers').length === 0 && E.json('state.log').some(l => /déposée au lancer 0\) expire sans avoir été acceptée/.test(JSON.stringify(l))), 'lancer suivant : l’offre expire, trace au journal');
  ok(E.run('C0.houseReserve') === 2 && E.run('C1.houseReserve') === 0, 'rien n’a été transféré');
  // Acceptation sur un état où le lancer a changé (offre encore listée) : refus.
  E.run(`as(0)`);
  await E.run(OFFRE.replace('PRIX', '0.5'));
  E.run(`state.assetSaleOffers[0].roll = state.gameClock.rollCount - 1; as(1);`);
  r = await E.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
  ok(!r.ok && /a expiré au lancer de dés suivant/.test(r.error) && E.run('C1.houseReserve') === 0, 'acceptation après changement de lancer : refusée, rien ne bouge');
  X = await setup({ transform: s => s.replace("  expireAssetSaleOffers(); // Section 309 — retouche de la revue : les offres de vente expirent au lancer suivant\n", '') });
  X.run(`C0.houseReserve = 2; as(0);`);
  await X.run(OFFRE.replace('PRIX', '0.5'));
  X.run('advanceGameClock();');
  ok(X.json('state.assetSaleOffers').length === 1, 'contre-épreuve (expiration retirée) : l’offre survit au lancer — le test détecte la régression');

  // ---------- 6. Échange réservé au créateur dans le moteur ; un seul message de compensation périmée ----------
  console.log('6. Échange de parts réservé au créateur (moteur) ; compensation périmée : un seul message');
  E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:100}]; P('p1').owners=[{companyId:C1.id,share:100}]; as(1);`);
  r = await E.run(`act(()=>executeShareSwap('prop','p0',C0.id,100,'prop','p1',C1.id,100,{silent:true}))`);
  ok(!r.ok && /Seul le créateur de la partie/.test(r.error) && E.json(`P('p0').owners`)[0].companyId === E.run('C0.id'), 'Bob appelle executeShareSwap directement : refusé, Brun 1 reste à Co Alice');
  X = await setup({ transform: s => s.replace("  if(myPlayerId!==state.creatorId) return fail('Seul le créateur de la partie peut arbitrer un échange de parts.'); // Section 309 — retouche de la revue : vérifié dans le moteur\n", '') });
  X.run(`P('p0').owners=[{companyId:C0.id,share:100}]; P('p1').owners=[{companyId:C1.id,share:100}]; as(1);`);
  r = await X.run(`act(()=>executeShareSwap('prop','p0',C0.id,100,'prop','p1',C1.id,100,{silent:true}))`);
  ok(r.ok, 'contre-épreuve (contrôle retiré) : Bob prend Brun 1 — le test détecte la régression');
  const STALE = `state.settings.features.houseSource = true; C0.houseReserve = 1;
    ['p0','p1'].forEach(id=>{ P(id).owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P(id).groupMergeId='LOTB'; }); as(0);`;
  const CHANGE = `['p0','p1'].forEach(id=>{ P(id).owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:30},{companyId:C2.id,share:10}]; });`;
  E = await setup();
  E.run(STALE); E.run(`modalHouseCompensation('p0', C0.id, 1)`); E.run(CHANGE);
  await E.cliquer('#mOk');
  ok(E.alerts.length === 0 && /Les parts ont changé/.test(E.fenetre()) && E.run(`P('p0').houses`) === 0, 'parts changées : aucune alerte, seul le bandeau de la fenêtre redessinée prévient ; rien n’est construit');
  X = await setup({ transform: s => s.replace("      return (r && r.code==='stale-conditions') ? {ok:false, code:r.code} : r;\n", '      return r;\n') });
  X.run(STALE); X.run(`modalHouseCompensation('p0', C0.id, 1)`); X.run(CHANGE);
  await X.cliquer('#mOk');
  ok(X.alerts.some(a => /Les conditions ont changé/.test(a)) && /Les parts ont changé/.test(X.fenetre()), 'contre-épreuve (ancien envoi) : alerte ET bandeau, double message — le test détecte la régression');

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
