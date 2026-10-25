// Section 312 — bogue 50 de l'audit du 2026-10-19 et décision de Julien : « hypothèque auprès d'une autre
// entreprise : étape d'acceptation par le CEO prêteur ».
//   Avant : l'emprunteur choisissait une entreprise prêteuse, qui était débitée sans avoir accepté, et son encaisse
//   n'était vérifiée qu'à l'ouverture de la fenêtre (Co Bob à 2 M$ dépense 1,9 M$ pendant que la fenêtre d'Alice est
//   ouverte : il avance quand même 2 M$ et tombe à −1,90 M$).
//   Désormais l'hypothèque auprès d'une entreprise est une OFFRE (state.mortgageOffers) : rien ne bouge avant que le
//   CEO prêteur l'accepte ; tout est revérifié à l'acceptation (encaisse du prêteur, part détenue, terrain non
//   regroupé en lot, lot non dissous, déjà hypothéqué, partie terminée…) ; l'auteur peut retirer son offre, le prêteur
//   la refuser. L'hypothèque auprès de la banque reste immédiate (conditions revérifiées à la confirmation).
// Contre-épreuves : ancienne fenêtre et ancien moteur réintroduits par loadEngine({transform}) : le test échoue.
// Lancer depuis la racine du dépôt :  node tests/section312-hypotheque.test.js
const { check, near } = require('./helpers/engine');
const { partie } = require('./helpers/appareils-312');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f2 = x => (typeof x === 'number' ? x.toFixed(2) : String(x));

// Ancienne fenêtre (code de main 5915ded) et ancien moteur sans contrôle du prêteur.
const OLD_MODAL = `function __oldModalMortgage(pid){
  const p = state.properties.find(x=>x.id===pid);
  const myCo = myCompany();
  if(!myCo){ alert('x'); return; }
  const share = propertyOwnedShare(p, myCo.id);
  if(share<=0){ alert('x'); return; }
  const principal = maxMortgage(p, myCo.id);
  const rate = riskAdjustedRate(state.settings.mortgageRate, myCo);
  openModal(\`<h3>Hypothéquer votre part — \${esc(p.name)}</h3>
    <label>Prêteur</label>
    <select id="mLender">\${insurerOptionsHtml(myCo.id, principal)}</select>
    <div class="small" id="mRetryStatus"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Annuler</button><button class="btn btn-primary" id="mOk">Confirmer</button></div>\`);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  document.getElementById('mOk').addEventListener('click', async ()=>{
    const lenderId = document.getElementById('mLender').value;
    await runModalActionWithRetry(()=>issueMortgage(pid, myCo.id, lenderId, {silent:true}));
  });
}
`;
const ANCIEN_50 = src => src
  .replace('function modalMortgage(pid){', OLD_MODAL + 'function modalMortgage(pid){ return __oldModalMortgage(pid);')
  .replace('function mortgageLenderError(borrowerId, lenderId, principal, opts){', 'function mortgageLenderError(borrowerId, lenderId, principal, opts){ return null;');

// Partie : Alice (Co Alice, appareil A) détient seule Bleu foncé 2 (prix 4 M$ → hypothèque 2 M$) ; Co Bob a 2 M$.
async function setup(transform){
  const T = await partie({ transform });
  const { A, B } = T;
  await A.run(`attemptActionWithRetry(async ()=>{
    const a = state.companies[0], b = state.companies[1];
    const P = state.properties.find(p=>p.name==='Bleu foncé 2'); P.owners = [{companyId:a.id, share:100}]; P.mortgages = [];
    state.bank.cash += b.cash - 2; b.cash = 2; return {ok:true}; })`);
  await B.sonder(); await A.calme(); await B.calme();
  T.P = A.run(`state.properties.find(p=>p.name==='Bleu foncé 2').id`);
  T.a = A.run('state.companies[0].id'); T.b = A.run('state.companies[1].id');
  const S = T.serveur();
  T.cash = (s, id) => s.companies.find(c => c.id === id).cash;
  T.total = s => s.bank.cash + s.companies.reduce((x, c) => x + c.cash, 0) + s.players.reduce((x, p) => x + p.cash, 0);
  T.total0 = T.total(S);
  return T;
}
// Bob dépense 1,9 M$ (versés à la banque) pendant que la fenêtre d'Alice est ouverte.
async function bobDepense(T, montant){
  await T.B.sonder();
  await T.B.run(`attemptActionWithRetry(async ()=>{ const b = companyById(${JSON.stringify(T.b)}); b.cash -= ${montant}; state.bank.cash += ${montant}; return {ok:true}; })`);
}
async function aliceOuvre(T, lenderId){
  T.A.run(`modalMortgage(${JSON.stringify(T.P)})`);
  T.A.doc.trouver('mLender').value = lenderId;
}

async function scenarioAudit(T, variant){
  const { A, B } = T;
  await aliceOuvre(T, T.b);
  ok(/2,00|2\.00/.test(A.fenetre()) || A.fenetre().includes(A.run('fmt(2)')), `50 [${variant}] : la fenêtre d’Alice propose 2 M$ (50 % de 4 M$) auprès de Co Bob`);
  await bobDepense(T, 1.9);
  await A.cliquer('mOk');
  const S = T.serveur();
  console.log(`    [${variant}] après la confirmation d’Alice : Co Bob ${f2(T.cash(S, T.b))} M$, Co Alice ${f2(T.cash(S, T.a))} M$, hypothèques ${S.properties.find(p=>p.id===T.P).mortgages.length}, offres ${(S.mortgageOffers||[]).length}`);
  ok(near(T.cash(S, T.b), 0.1) && S.properties.find(p => p.id === T.P).mortgages.length === 0,
    `50 [${variant}] : Co Bob n’est pas débité sans avoir accepté (reste à 0,10 M$, et non −1,90 M$) ; aucune hypothèque inscrite`);
  return S;
}

(async () => {
  await scenario('A. Scénario de l’audit : l’hypothèque auprès de Co Bob devient une offre que son CEO accepte', async () => {
    const T = await setup();
    const { A, B } = T;
    const S1 = await scenarioAudit(T, 'corrigé');
    const offer = (S1.mortgageOffers || [])[0];
    ok(offer && offer.borrowerId === T.a && offer.lenderId === T.b && near(offer.principal, 2) && near(offer.rate, A.run('riskAdjustedRate(state.settings.mortgageRate, companyById(' + JSON.stringify(T.a) + '))')) && near(T.total(S1), T.total0),
      '50 : une offre est enregistrée (Co Alice → Co Bob, 2 M$, taux affiché) ; rien n’a bougé, monnaie conservée');
    ok(A.fenetre() === '' && A.alerts.length === 0, '50 : la fenêtre d’Alice se ferme sans message d’erreur');
    // Bob voit l'offre dans l'onglet de son entreprise ; Alice voit son offre en attente avec « Retirer ».
    await B.sonder(); B.run(`activeTab = 'entreprise'; render()`); await B.calme();
    A.run(`activeTab = 'entreprise'; render()`); await A.calme();
    ok(B.existe(`[data-accept-mortgage-offer="${offer.id}"]`) && B.existe(`[data-refuse-mortgage-offer="${offer.id}"]`) && !B.existe(`[data-cancel-mortgage-offer="${offer.id}"]`),
      '50 : Bob (CEO prêteur) voit l’offre avec « Accepter » et « Refuser »');
    ok(A.existe(`[data-cancel-mortgage-offer="${offer.id}"]`) && !A.existe(`[data-accept-mortgage-offer="${offer.id}"]`), '50 : Alice voit son offre en attente avec « Retirer » seulement');
    // Bob accepte alors qu'il n'a plus que 0,10 M$ : refus clair, l'offre reste.
    await B.cliquer(`[data-accept-mortgage-offer="${offer.id}"]`);
    ok(/2,00|2\.00/.test(B.fenetre()) || B.fenetre().includes(B.run('fmt(2)')), '50 : la confirmation de Bob affiche les conditions (2 M$)');
    await B.cliquer('mOk');
    let S = T.serveur();
    ok(S.mortgageOffers.length === 1 && near(T.cash(S, T.b), 0.1) && B.alerts.some(m => /encaisse/.test(m)), `50 : acceptation refusée faute d’encaisse (« ${(B.alerts[0] || '').slice(0, 80)}… »), l’offre reste, rien ne bouge`);
    // Bob se renfloue (3 M$ de la banque), puis accepte.
    B.run('closeModal()'); B.alerts.length = 0;
    await B.run(`attemptActionWithRetry(async ()=>{ const b = companyById(${JSON.stringify(T.b)}); b.cash += 3; state.bank.cash -= 3; return {ok:true}; })`);
    B.run(`activeTab = 'portefeuille'; render()`); await B.calme();
    ok(B.existe(`[data-accept-mortgage-offer="${offer.id}"]`) && /Offre d'hypothèque reçue/.test(B.doc.trouver('tabbody').innerHTML), '50 : l’offre reçue apparaît aussi dans le fil « Propositions en attente » du Portefeuille de Bob');
    const before = T.serveur();
    await B.cliquer(`[data-accept-mortgage-offer="${offer.id}"]`);
    await B.cliquer('mOk');
    S = T.serveur();
    const m = S.properties.find(p => p.id === T.P).mortgages[0];
    console.log(`    acceptation : Co Bob ${f2(T.cash(before, T.b))} → ${f2(T.cash(S, T.b))}, Co Alice ${f2(T.cash(before, T.a))} → ${f2(T.cash(S, T.a))}`);
    ok(m && m.lenderId === T.b && m.companyId === T.a && near(m.principal, 2) && near(m.rate, offer.rate), '50 : Bob accepte : hypothèque inscrite (prêteur Co Bob, 2 M$, au taux de l’offre)');
    ok(near(T.cash(S, T.b) - T.cash(before, T.b), -2) && near(T.cash(S, T.a) - T.cash(before, T.a), 2) && near(T.total(S), T.total0), '50 : Co Bob −2 M$, Co Alice +2 M$ ; monnaie conservée');
    ok(S.mortgageOffers.length === 0 && B.fenetre() === '' && B.alerts.length === 0, '50 : acceptée depuis le Portefeuille : offre retirée, fenêtre fermée, aucune alerte');
  });

  await scenario('B. Contre-épreuve : ancienne fenêtre et ancien moteur (prêteur débité sans accord)', async () => {
    const T = await setup(ANCIEN_50);
    let failed = null;
    try{ await scenarioAudit(T, 'ancien'); }catch(e){ failed = e.message; }
    ok(failed && /50 \[ancien\] : Co Bob n’est pas débité/.test(failed), `contre-épreuve : l’ancien code débite Co Bob sans son accord (${failed})`);
  });

  // Retouche de la revue : une offre devenue caduque est retirée dans l'action qui change la part (même écriture).
  // Section 309-313 — intégration : l'appel est désormais protégé par un try/catch dans runActionWithRetry.
  const SANS_RETRAIT = src => src.replace("      try{ dropStaleMortgageOffers(); }\n", '      try{ }\n');
  async function caduques(T, variant){
    const { A, B } = T;
    const J = JSON.stringify;
    await B.run(`attemptActionWithRetry(async ()=>{ const b = companyById(${J(T.b)}); b.cash += 10; state.bank.cash -= 10; return {ok:true}; })`);
    const propose = async (kind = 'prop', asset = T.P) => {
      await A.sonder();
      const r = await A.run(`proposeMortgageOffer(${J(kind)}, ${J(asset)}, ${J(T.a)}, ${J(T.b)}, {expectedConditions: mortgageAssetTerms(${J(kind)}, ${J(asset)}, ${J(T.a)}), fromConfirm:true})`);
      await B.sonder();
      return r;
    };
    const offres = () => T.serveur().mortgageOffers || [];
    const trace = motif => T.serveur().log.slice(0, 3).some(l => /offre d'hypothèque/.test(l.text) && /retirée/.test(l.text) && motif.test(l.text));
    let r = await propose();
    ok(r && r.ok, `50 [${variant}] : offre proposée par Alice`);
    // Une part avec une offre en attente n'est plus listée comme éligible dans « Hypothéquer ».
    A.run('modalMortgageCompany()');
    ok(!A.existe(`[data-mc-choice="prop:${T.P}"]`), `50 [${variant}] : la part déjà proposée n’est plus listée comme éligible dans « Hypothéquer »`);
    A.run('closeModal()');
    // 1. Alice vend la moitié de sa part (action) : l'offre devient caduque.
    await A.sonder();
    await A.run(`attemptActionWithRetry(async ()=>{ const P = state.properties.find(p=>p.id===${J(T.P)}); P.owners = [{companyId:${J(T.a)}, share:50}]; return {ok:true}; })`);
    console.log(`    [${variant}] après la vente de la moitié de la part : ${offres().length} offre(s) en attente`);
    ok(offres().length === 0 && trace(/100% à 50%/), `50 [${variant}] : part passée de 100 % à 50 % → offre retirée dans la même écriture, trace au journal`);
    // 2. Part rétablie ; nouvelle offre ; Alice hypothèque sa part auprès de la banque (immédiat).
    await A.run(`attemptActionWithRetry(async ()=>{ state.properties.find(p=>p.id===${J(T.P)}).owners = [{companyId:${J(T.a)}, share:100}]; return {ok:true}; })`);
    r = await propose();
    const S0 = T.serveur();
    r = await A.run(`attemptActionWithRetry(()=>issueMortgage(${J(T.P)}, ${J(T.a)}, 'BANK', {silent:true}))`);
    ok(r && r.ok && near(T.total(T.serveur()), T.total(S0)) && offres().length === 0 && trace(/déjà hypothéqué/),
      '50 : hypothèque bancaire immédiate (monnaie conservée) ; l’offre en attente sur la même part est retirée, trace au journal');
    // 3. Remboursement, nouvelle offre, puis regroupement du terrain en lot.
    await A.run(`attemptActionWithRetry(async ()=>{ const P = state.properties.find(p=>p.id===${J(T.P)}); const m = P.mortgages[0]; const a = companyById(${J(T.a)}); a.cash -= m.principal; state.bank.cash += m.principal; P.mortgages = []; return {ok:true}; })`);
    r = await propose();
    await A.run(`attemptActionWithRetry(async ()=>{ state.properties.find(p=>p.id===${J(T.P)}).groupMergeId = 'lot-test'; return {ok:true}; })`);
    ok(offres().length === 0 && trace(/fait désormais partie du lot .* regroupé — rien n’a été fait ; hypothéquez votre part du lot entier \(menu Hypothéquer\)/),
      '50 : terrain regroupé en lot → offre retirée (message commun avec le lot 2)');
    await A.run(`attemptActionWithRetry(async ()=>{ delete state.properties.find(p=>p.id===${J(T.P)}).groupMergeId; return {ok:true}; })`);
    // 4. Offre sur un lot, puis lot dissous.
    await A.run(`attemptActionWithRetry(async ()=>{ const a = ${J(T.a)}; ['Brun 1','Brun 2'].forEach(nm=>{ const p = state.properties.find(x=>x.name===nm); p.owners = [{companyId:a, share:100}]; p.groupMergeId = 'lot-brun'; p.mortgages = []; }); return {ok:true}; })`);
    r = await propose('lot', 'lot-brun');
    ok(r && r.ok && offres().length === 1, '50 : offre d’hypothèque sur le lot Brun');
    await A.sonder();
    await A.run(`attemptActionWithRetry(async ()=>{ ['Brun 1','Brun 2'].forEach(nm=>{ delete state.properties.find(x=>x.name===nm).groupMergeId; }); return {ok:true}; })`);
    ok(offres().length === 0 && trace(/lot n’existe plus/), '50 : lot dissous → offre retirée, trace au journal');
    ok(near(T.total(T.serveur()), T.total0), '50 : monnaie conservée sur tout le scénario');
  }

  await scenario('C. Offres caduques retirées dans l’action qui change la part', async () => {
    await caduques(await setup(), 'corrigé');
  });
  await scenario('C2. Contre-épreuve : sans le retrait des offres caduques', async () => {
    let failed = null;
    try{ await caduques(await setup(SANS_RETRAIT), 'ancien'); }catch(e){ failed = e.message; }
    ok(failed && /50 \[ancien\] : part passée de 100 % à 50 %/.test(failed), `contre-épreuve : l’offre caduque restait en attente (${failed})`);
  });

  await scenario('C3. Revérifications à l’acceptation et droits (accepter, refuser, retirer)', async () => {
    const T = await setup();
    const { A, B } = T;
    const J = JSON.stringify;
    await B.run(`attemptActionWithRetry(async ()=>{ const b = companyById(${J(T.b)}); b.cash += 10; state.bank.cash -= 10; return {ok:true}; })`);
    await A.sonder();
    const propose = async () => { await A.sonder(); const r = await A.run(`proposeMortgageOffer('prop', ${J(T.P)}, ${J(T.a)}, ${J(T.b)}, {expectedConditions: mortgageAssetTerms('prop', ${J(T.P)}, ${J(T.a)})})`); await B.sonder(); return r; };
    let r = await propose();
    ok(r && r.ok, '50 : offre proposée par Alice');
    const id = T.serveur().mortgageOffers[0].id;
    r = await propose();
    ok(r && !r.ok && /déjà/.test(r.error) && T.serveur().mortgageOffers.length === 1, `50 : 2e offre sur la même part refusée (« ${r && r.error} »)`);
    r = await A.run(`acceptMortgageOffer(${J(id)}, {fromConfirm:true})`);
    ok(r && !r.ok && T.serveur().mortgageOffers.length === 1, `50 : Alice ne peut pas accepter à la place du CEO prêteur (« ${r && r.error} »)`);
    // Part changée sur l'appareil de Bob sans passer par une action (ancien onglet, cas limite) : l'acceptation
    // revérifie tout sur l'état et refuse ; rien ne bouge.
    await B.sonder();
    B.run(`state.properties.find(p=>p.id===${J(T.P)}).owners = [{companyId:${J(T.a)}, share:50}]`);
    const S0 = T.serveur();
    r = await B.run(`acceptMortgageOffer(${J(id)}, {fromConfirm:true})`);
    ok(r && !r.ok && /part/.test(r.error) && T.serveur().properties.find(p=>p.id===T.P).mortgages.length === 0 && near(T.total(T.serveur()), T.total(S0)),
      `50 : acceptation revérifiée : part changée → refus (« ${r && r.error} »), rien ne bouge`);
    await B.sonder();
    // Bob ne peut pas retirer l'offre ; il la refuse : retirée, trace au journal.
    await B.run(`cancelMortgageOffer(${J(id)})`);
    ok(T.serveur().mortgageOffers.length === 1, '50 : Bob ne peut pas retirer l’offre d’Alice');
    await B.run(`refuseMortgageOffer(${J(id)})`);
    let S = T.serveur();
    ok(S.mortgageOffers.length === 0 && S.log.some(l => /refuse l'offre d'hypothèque/.test(l.text)), '50 : Bob refuse : offre retirée, trace au journal');
    // Alice retire une nouvelle offre.
    r = await propose();
    const id2 = T.serveur().mortgageOffers[0].id;
    await A.run(`cancelMortgageOffer(${J(id2)})`);
    ok(T.serveur().mortgageOffers.length === 0, '50 : Alice retire son offre');
    // Partie terminée entre l'offre et l'acceptation.
    r = await propose();
    const id3 = T.serveur().mortgageOffers[0].id;
    await A.run(`attemptActionWithRetry(async ()=>{ state.gameEndedReason = {reason:'test'}; return {ok:true}; })`);
    await B.sonder();
    r = await B.run(`acceptMortgageOffer(${J(id3)}, {fromConfirm:true})`);
    ok(r && !r.ok && /terminée/.test(r.error), `50 : partie terminée → refus (« ${r && r.error} »)`);
    ok(near(T.total(T.serveur()), T.total0), '50 : monnaie conservée');
  });

  // Retouche de la revue [grave] : sans expiration, le prêteur choisissait le moment d'accepter (sonde-saisie.js).
  const SANS_GARDE = src => src
    .replace("    if(state.gameClock.rollCount > (offer.createdAtRoll||0)) return {ok:false, error:'Cette offre d’hypothèque a expiré : elle ne valait que jusqu’au lancer de dés suivant sa création. L’emprunteuse peut en proposer une nouvelle.'};\n", '');
  const SANS_EXPIRATION_AU_LANCER = src => src.replace("  expirePendingMortgageOffers(); // Section 312 — retouche de la revue\n", '');
  async function expiration(variant, transform){
    const T = await setup(transform);
    const { A, B } = T;
    const J = JSON.stringify;
    await A.run(`attemptActionWithRetry(async ()=>{ state.properties.find(p=>p.id===${J(T.P)}).houses = 3; const b = companyById(${J(T.b)}); b.cash += 10; state.bank.cash -= 10; return {ok:true}; })`);
    await A.sonder();
    // Lancer 0 : Alice, en bonne santé, propose 2 M$ à 35 % à Co Bob.
    const r = await A.run(`proposeMortgageOffer('prop', ${J(T.P)}, ${J(T.a)}, ${J(T.b)}, {expectedConditions: mortgageAssetTerms('prop', ${J(T.P)}, ${J(T.a)}), fromConfirm:true})`);
    ok(r && r.ok, `expiration [${variant}] : offre de 2 M$ à 35 % au lancer 0`);
    // Un vrai lancer (advanceGameClock) : l'offre expire, trace au journal.
    await A.run(`attemptActionWithRetry(async ()=>{ advanceGameClock(); return {ok:true}; })`);
    const S1 = T.serveur();
    console.log(`    [${variant}] après le lancer suivant : ${(S1.mortgageOffers || []).length} offre(s) en attente`);
    ok((S1.mortgageOffers || []).length === 0 && S1.log.some(l => /offre d'hypothèque/.test(l.text) && /expire/.test(l.text)), `expiration [${variant}] : au lancer suivant, l’offre expire (trace au journal)`);
    // Garde de l'acceptation : offre réinsérée telle quelle (ancien onglet), 40 lancers plus tard, Alice à −5 M$.
    await A.run(`attemptActionWithRetry(async ()=>{ state.mortgageOffers = [{id:'vieille', kind:'prop', assetId:${J(T.P)}, label:'Bleu foncé 2', borrowerId:${J(T.a)}, lenderId:${J(T.b)}, share:100, principal:2, rate:0.35, createdAtRoll:0}];
      const a = companyById(${J(T.a)}); state.bank.cash += a.cash + 5; a.cash = -5; state.gameClock.rollCount += 40; return {ok:true}; })`);
    await B.sonder();
    const S2 = T.serveur();
    const acc = await B.run(`acceptMortgageOffer('vieille', {fromConfirm:true})`);
    B.run('processMortgageInterest()');
    const owners = B.json(`state.properties.find(p=>p.id===${J(T.P)}).owners`);
    console.log(`    [${variant}] acceptation 41 lancers plus tard : ${acc && acc.ok ? 'acceptée' : 'refusée'} ; propriétaires après l’intérêt annuel : ${owners.map(o => (o.companyId === T.b ? 'Co Bob ' : 'Co Alice ') + o.share + '%').join(', ')}`);
    ok(acc && !acc.ok && /expiré/.test(acc.error) && near(T.total(T.serveur()), T.total(S2)) && T.serveur().properties.find(p=>p.id===T.P).mortgages.length === 0,
      `expiration [${variant}] : offre du lancer 0 acceptée au lancer 41 → refusée (« ${acc && acc.error} »), rien ne bouge, pas de saisie possible`);
  }
  await scenario('F. Expiration de l’offre d’hypothèque au lancer suivant (retouche de la revue)', async () => {
    await expiration('corrigé');
  });
  await scenario('F2. Contre-épreuve : sans la garde, le prêteur accepte 41 lancers plus tard et saisit la part', async () => {
    let failed = null;
    try{ await expiration('sans garde', SANS_GARDE); }catch(e){ failed = e.message; }
    ok(failed && /expiration \[sans garde\] : offre du lancer 0 acceptée au lancer 41/.test(failed), `contre-épreuve : sans la garde, l’offre périmée était acceptée (${failed})`);
  });
  await scenario('F3. Contre-épreuve : sans l’expiration au lancer', async () => {
    let failed = null;
    try{ await expiration('sans expiration', SANS_EXPIRATION_AU_LANCER); }catch(e){ failed = e.message; }
    ok(failed && /expiration \[sans expiration\] : au lancer suivant/.test(failed), `contre-épreuve : sans l’expiration, l’offre restait en attente après le lancer (${failed})`);
  });

  await scenario('D. Moteur : une hypothèque auprès d’une entreprise ne peut plus être imposée sans offre acceptée', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await setup(variant === 'ancien' ? ANCIEN_50 : undefined);
      const { A } = T;
      const r = await A.run(`attemptActionWithRetry(()=>issueMortgage(${JSON.stringify(T.P)}, ${JSON.stringify(T.a)}, ${JSON.stringify(T.b)}, {silent:true}))`);
      const S = T.serveur();
      console.log(`    [${variant}] issueMortgage direct auprès de Co Bob : ${r && r.ok ? 'accepté' : 'refusé'} ; Co Bob ${f2(T.cash(S, T.b))} M$`);
      if(variant === 'corrigé') ok(r && !r.ok && near(T.cash(S, T.b), 2), `50 : issueMortgage direct auprès d’une entreprise refusé (« ${r && r.error} ») ; Co Bob garde 2 M$`);
      else ok(r && r.ok && near(T.cash(S, T.b), 0), '50 : contre-épreuve — l’ancien moteur débitait Co Bob sans offre');
    }
  });

  await scenario('E. Banque : hypothèque immédiate, conditions revérifiées à la confirmation', async () => {
    const T = await setup();
    const { A, B } = T;
    await aliceOuvre(T, 'BANK');
    const rate0 = A.run(`riskAdjustedRate(state.settings.mortgageRate, companyById(${JSON.stringify(T.a)}))`);
    // L'administration change le taux hypothécaire sur un autre appareil pendant que la fenêtre est ouverte.
    await B.sonder();
    await B.run(`attemptActionWithRetry(async ()=>{ state.settings.mortgageRate = 0.5; return {ok:true}; })`);
    await A.sonder(); await A.calme();
    await A.cliquer('mOk');
    let S = T.serveur();
    ok(S.properties.find(p=>p.id===T.P).mortgages.length === 0 && /Les conditions ont changé/.test(A.fenetre()), '50 : taux changé pendant la fenêtre → rien n’est fait, 2e confirmation avec le nouveau taux');
    ok(A.doc.trouver('mLender') && A.doc.trouver('mLender').value === 'BANK', '50 : le prêteur choisi (Banque) est conservé dans la 2e fenêtre');
    await A.cliquer('mOk');
    S = T.serveur();
    const m = S.properties.find(p=>p.id===T.P).mortgages[0];
    const rate1 = A.run(`state.properties.find(p=>p.id===${JSON.stringify(T.P)}).mortgages[0].rate`);
    ok(m && m.lenderId === 'BANK' && near(m.principal, 2) && rate1 > rate0 && near(T.total(S), T.total0) && (S.mortgageOffers || []).length === 0,
      `50 : 2e confirmation : hypothèque bancaire immédiate (2 M$ à ${f2(rate1 * 100)} % au lieu de ${f2(rate0 * 100)} %), sans offre, monnaie conservée`);
  });

  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\n${n} vérifications, 0 échec`);
})();
