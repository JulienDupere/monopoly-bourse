// Test — section 310 (lot 3 de l'audit du 2026-10-19) : revente de parts REIT.
// Bogue 46 : le prix convenu valait 0 par défaut et acceptait un nombre négatif (−5 : le vendeur cédait ses parts ET
//            payait 5 M$). Refusé désormais (prix strictement positif).
// Décision de Julien, verbatim : « ventes unilatérales (vendre des maisons, revente de parts REIT) : exiger l'accord
// de l'acheteur ». La revente de parts REIT devient une OFFRE (state.assetSaleOffers, kind 'etf', modèle de la
// section 309) : rien ne bouge avant l'acceptation par le CEO acheteur, qui revérifie encaisse et détention ; le
// vendeur peut la retirer ; elle expire au lancer de dés suivant. La confirmation de la section 308
// (modalConfirmEtfSale) devient le dépôt de l'offre.
// Lancer depuis la racine du dépôt :  node tests/section310-reit-vente.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// Partie à quatre (Co Alice = C0 … Co Dan = C3), REIT activés ; Co Alice détient 100 % de la Première rue.
async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; });
           state.gameClock.rollCount = 3;
           C0.etfHoldings.rue1 = 100; C0.cash = 20; C1.cash = 20; C2.cash = 20; C3.cash = 20;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           globalThis.offers = () => state.assetSaleOffers.filter(o=>o.kind==='etf');`);
  await eng.run('saveGame({silent:true})');
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.held = co => E.run(`${co}.etfHoldings.rue1||0`);
  return E;
}

(async () => {
  await scenario('A. Bogue 46 — Co Alice vend 10 % à Co Bob en tapant −5, puis 20 % au prix 0 laissé par défaut', async () => {
    const E = await setup();
    E.run('as(C0)');
    const T0 = E.cash(), a0 = E.run('C0.cash'), b0 = E.run('C1.cash');
    const r1 = await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 10, -5)`);
    const r2 = await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 20, 0)`);
    console.log(`    −5 : ${r1.ok ? 'accepté' : 'refusé (« ' + r1.error + ' »)'} ; 0 : ${r2.ok ? 'accepté' : 'refusé'} ; Co Alice ${E.held('C0')} %, encaisse ${E.run('C0.cash').toFixed(2)}`);
    ok(!r1.ok && /strictement positif/.test(r1.error), 'prix −5 refusé (avant : Co Alice cédait 10 % ET payait 5 M$)');
    ok(!r2.ok && /strictement positif/.test(r2.error), 'prix 0 refusé (avant : 20 % donnés, « pour 0.00 » au journal)');
    ok(E.held('C0') === 100 && E.held('C1') === 0 && near(E.run('C0.cash'), a0) && near(E.run('C1.cash'), b0), 'rien n’a bougé : 100 % à Co Alice, encaisses inchangées');
    ok(E.run('offers().length') === 0 && near(E.cash(), T0), 'aucune offre enregistrée, monnaie conservée');
    // Requête forgée directement au cœur de la vente (ancien appareil) : refus aussi.
    const r3 = E.json(`executeEtfSale('rue1', C0.id, C1.id, 10, -5, {silent:true})`);
    ok(!r3.ok && /strictement positif/.test(r3.error), 'cœur de la vente (executeEtfSale) : prix négatif refusé');
    const X = await setup({ transform: s => s.replace("  if(!(Number.isFinite(price) && price>0)) return fail('Le prix convenu doit être un nombre strictement positif.'); // Section 310 — bogue 46\n", '') });
    const x3 = X.json(`executeEtfSale('rue1', C0.id, C1.id, 10, -5, {silent:true})`);
    ok(x3.ok && near(X.run('C0.cash'), 15), 'contre-épreuve (garde retirée) : le cœur de la vente cède 10 % ET fait payer 5 M$ au vendeur');
    ok(/min="0\.01" step="0\.01" id="etfSellPrice_\$\{etf\.id\}" value=""/.test(require('./helpers/engine').engineSource()), 'champ « Prix convenu » : minimum 0,01 et vide par défaut (avant : 0)');
  });

  await scenario('B. Décision — l’offre ne bouge rien avant l’acceptation du CEO acheteur', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace("    return proposeAssetSale({kind:'etf', etfId, sellerId, buyerId, pct, price}, {silent:true}); // Section 310 — décision « revente de parts REIT »", "    { const r = executeEtfSale(etfId, sellerId, buyerId, pct, price, {silent:true}); return r; }") } : {});
      E.run('as(C0)');
      const T0 = E.cash();
      const r = await E.run(`sellEtfUnits('rue1', C0.id, C2.id, 30, 5)`);
      const after = { a: E.held('C0'), c: E.held('C2'), ca: E.run('C0.cash'), cc: E.run('C2.cash'), offers: E.run('offers().length') };
      console.log(`    [${variant}] après « Vendre 30 % pour 5 » : Co Alice ${after.a} %, Co Carl ${after.c} % ; encaisses ${after.ca.toFixed(2)} / ${after.cc.toFixed(2)} ; offres ${after.offers}`);
      if(variant === 'corrigé'){
        ok(r.ok && after.offers === 1, 'une offre est déposée');
        ok(after.a === 100 && after.c === 0 && near(after.ca, 20) && near(after.cc, 20), 'rien ne bouge : parts et encaisses inchangées (avant : Co Carl débité sans avoir accepté)');
        const o = E.json('offers()[0]');
        ok(o.sellerId === E.run('C0.id') && o.buyerId === E.run('C2.id') && o.pct === 30 && o.price === 5 && o.roll === 3 && o.etfId === 'rue1', 'offre : vendeur, acheteur, 30 %, 5 M$, lancer 3, Première rue');
        ok(/Co Alice propose à Co Carl : 30% du REIT \(Première rue\) pour/.test(E.run('state.log[0].text')), 'journal : « Co Alice propose à Co Carl : 30% du REIT (Première rue) … »');
        // L'offre est visible dans l'onglet Mon Entreprise de Co Carl (offres reçues) et de Co Alice (offres envoyées).
        ok(/30% du REIT \(Première rue\)/.test(E.run('assetSaleOffersHtml(C2)')) && /data-accept-asset-offer/.test(E.run('assetSaleOffersHtml(C2)')), 'Co Carl voit l’offre avec Accepter / Refuser');
        ok(/data-cancel-asset-offer/.test(E.run('assetSaleOffersHtml(C0)')), 'Co Alice voit son offre avec Retirer');
        // Un tiers (Co Bob) et le vendeur ne peuvent pas accepter.
        E.run('as(C1)'); let ra = await E.run(`acceptAssetSaleOffer(offers()[0].id)`);
        ok(!ra.ok && /Seul le CEO de Co Carl/.test(ra.error), 'Co Bob ne peut pas accepter à la place de Co Carl');
        E.run('as(C0)'); ra = await E.run(`acceptAssetSaleOffer(offers()[0].id)`);
        ok(!ra.ok && E.held('C2') === 0, 'Co Alice ne peut pas accepter sa propre offre');
        // Co Carl accepte.
        E.run('as(C2)'); ra = await E.run(`acceptAssetSaleOffer(offers()[0].id)`);
        ok(ra.ok && E.held('C0') === 70 && E.held('C2') === 30, 'acceptée par Co Carl : 70 % / 30 %');
        ok(near(E.run('C0.cash'), 25) && near(E.run('C2.cash'), 15) && E.run('offers().length') === 0, 'Co Carl paie 5 M$ à Co Alice, l’offre disparaît');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(after.c === 30 && near(after.cc, 15) && after.offers === 0, 'contre-épreuve : sans l’offre, Co Carl reçoit 30 % et paie 5 M$ sans avoir accepté');
      }
    }
  });

  await scenario('C. Revérification à l’acceptation : encaisse de l’acheteur, détention du vendeur, expiration', async () => {
    const E = await setup();
    E.run('as(C0)');
    await E.run(`sellEtfUnits('rue1', C0.id, C2.id, 30, 5)`);
    const id = E.run('offers()[0].id');
    const T0 = E.cash();
    // Co Carl n'a plus que 4 M$.
    E.run('C2.cash = 4; state.bank.cash += 16;');
    E.run('as(C2)'); let r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(id)})`);
    ok(!r.ok && /n'a pas assez d'encaisse/.test(r.error) && E.run('offers().length') === 1 && E.held('C2') === 0, `encaisse insuffisante (4 < 5) : refus clair, l’offre reste (« ${r && r.error} »)`);
    E.run('C2.cash = 20; state.bank.cash -= 16;');
    // Entre-temps, Co Alice a cédé 80 % ailleurs (à Co Dan) : il ne lui reste que 20 %.
    E.run('C0.etfHoldings.rue1 = 20; C3.etfHoldings.rue1 = 80;');
    r = await E.run(`acceptAssetSaleOffer(${JSON.stringify(id)})`);
    ok(!r.ok && /Pourcentage invalide/.test(r.error) && E.held('C2') === 0 && near(E.run('C2.cash'), 20), 'le vendeur ne détient plus 30 % : refus, rien n’est payé');
    E.run('C0.etfHoldings.rue1 = 100; C3.etfHoldings.rue1 = 0;');
    // Le lancer suivant : l'offre expire (journal), l'acceptation est refusée.
    E.run(`state.gameClock.rollCount = 4; expireAssetSaleOffers();`);
    ok(E.run('offers().length') === 0 && /expire sans avoir été acceptée/.test(E.run('state.log[0].text')) && /30% du REIT \(Première rue\)/.test(E.run('state.log[0].text')), 'au lancer suivant, l’offre expire avec une trace au journal');
    ok(near(E.cash(), T0) && E.held('C2') === 0, 'rien n’a été payé, monnaie conservée');
    // Refus et retrait.
    E.run('as(C0)'); await E.run(`sellEtfUnits('rue1', C0.id, C2.id, 10, 2)`); await E.run(`sellEtfUnits('rue1', C0.id, C3.id, 10, 2)`);
    E.run('as(C2)'); await E.run(`refuseAssetSaleOffer(offers().find(o=>o.buyerId===C2.id).id)`);
    E.run('as(C0)'); await E.run(`cancelAssetSaleOffer(offers().find(o=>o.buyerId===C3.id).id)`);
    ok(E.run('offers().length') === 0 && E.held('C0') === 100, 'refus par Co Carl et retrait par Co Alice : offres retirées, rien ne bouge');
    // Seul le CEO vendeur dépose l'offre.
    E.run('as(C1)'); r = await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 10, 0.01)`);
    ok(!r.ok && /Seul le CEO de Co Alice/.test(r.error) && E.run('offers().length') === 0, 'Bob ne peut pas proposer les parts de Co Alice');
  });

  await scenario('D. Double clic et parts déjà promises', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace(/    if\(pendingEtf\.some\([^\n]*\n/, '') } : {});
      E.run('as(C0)');
      const call = `sellEtfUnits('rue1', C0.id, C2.id, 30, 5, {expectedHeld:100})`;
      await E.run(`Promise.all([${call}, ${call}])`);
      const count = E.run('offers().length');
      console.log(`    [${variant}] offres après un double envoi : ${count}`);
      if(variant === 'corrigé'){
        ok(count === 1 && E.alerts.some(a => /déjà en attente/.test(a)), 'une seule offre ; le 2e envoi est refusé (« déjà en attente »)');
        await E.run(`sellEtfUnits('rue1', C0.id, C3.id, 60, 9)`);
        ok(E.run('offers().length') === 2, 'une 2e offre de 60 % à Co Dan (30 + 60 ≤ 100) est acceptée');
        const r = await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 20, 3)`);
        ok(!r.ok && /déjà promis/.test(r.error) && E.run('offers().length') === 2, `20 % de plus (30 + 60 + 20 > 100) : refusé (« ${r.error} »)`);
      } else {
        ok(count === 2, 'contre-épreuve : sans la garde, le double envoi dépose deux offres identiques');
      }
    }
  });

  await scenario('D2. Retouche de la revue — contre-épreuve de la garde « parts déjà promises »', async () => {
    const X = await setup({ transform: s => s.replace(/    if\(promised\+offer\.pct>heldNow\+1e-9\)[^\n]*\n/, '') });
    X.run('as(C0)');
    await X.run(`sellEtfUnits('rue1', C0.id, C2.id, 30, 5)`); await X.run(`sellEtfUnits('rue1', C0.id, C3.id, 60, 9)`);
    const r = await X.run(`sellEtfUnits('rue1', C0.id, C1.id, 20, 3)`);
    ok(r.ok && X.run('offers().length') === 3 && X.run('offers().reduce((s,o)=>s+o.pct,0)') === 110, 'contre-épreuve (garde retirée) : 110 % du REIT promis dans trois offres — le test D détecte la régression');
  });

  await scenario('E. Fenêtres : la confirmation de la section 308 dépose l’offre ; l’acheteur accepte dans sa fenêtre', async () => {
    const E = await setup();
    E.run('as(C0)');
    const T0 = E.cash();
    E.run(`modalConfirmEtfSale('rue1', C0.id, C2.id, 30, 5, 100)`);
    let html = E.fenetre();
    ok(/Proposer une vente de parts de REIT/.test(html) && /Rien n'est payé ni transféré avant/.test(html) && /Proposer 30% pour/.test(html), 'la fenêtre récapitule l’offre et précise que rien ne bouge avant l’acceptation');
    await E.cliquer('mOk');
    ok(E.run('offers().length') === 1 && E.fenetre() === '' && E.held('C2') === 0, 'confirmée : offre déposée, fenêtre fermée, rien de transféré');
    E.run(`modalConfirmEtfSale('rue1', C0.id, C2.id, 10, 0, 100)`);
    html = E.fenetre();
    ok(/Prix nul ou négatif/.test(html), 'prix 0 : la fenêtre avertit que l’offre sera refusée');
    await E.cliquer('mOk');
    ok(E.run('offers().length') === 1 && E.alerts.some(a => /strictement positif/.test(a)), 'confirmée quand même : refus clair, aucune offre de plus');
    E.run('closeModal()');
    E.run('as(C2)');
    E.run(`modalAcceptAssetSaleOffer(offers()[0].id)`);
    html = E.fenetre();
    ok(/30% du REIT \(Première rue\)/.test(html) && /reçoit les parts du REIT/.test(html), 'fenêtre d’acceptation : « 30% du REIT (Première rue) », l’acheteur reçoit les parts');
    await E.cliquer('mOk');
    ok(E.held('C2') === 30 && E.held('C0') === 70 && near(E.run('C2.cash'), 15) && near(E.cash(), T0), 'acceptée : 30 % pour 5 M$, monnaie conservée');
  });

  if(failures.length){ console.log(`\nÉCHEC : section 310 (revente de parts REIT) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 310 (revente de parts REIT) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
