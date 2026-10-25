// Test — Section 308, lot 1c : une mise à jour venue d'un autre joueur ne ferme ni ne vide jamais une fenêtre, un
// formulaire ou un menu déroulant en cours ; l'action est revérifiée sur l'état à jour à la confirmation ; « Vous
// êtes » est imposé dès le premier accès.
//
// 72 : le rendu d'une valeur reçue effaçait les formulaires (fondation : nom, description, logo, type ; REIT : prix
//      remis à 0, puis « Vendre » cédait 1 % pour 0 $).
// C1 : une fenêtre ouverte ne bloque plus la synchro et n'est jamais remplacée par une fenêtre d'information
//      (« Résultats du tour ») déclenchée par une mise à jour ; celle-ci attend la fermeture.
// C2 : confirmWithFreshConditions — conditions recalculées à la confirmation, 2e confirmation si elles ont changé.
// C4 : un appareil sans identité mémorisée choisit qui il est avant tout autre écran (plus de créateur implicite).
//
// Deux appareils = deux moteurs (vm) avec chacun le mini-DOM du banc (tests/helpers/fake-dom.js, complété ici :
// valeurs par défaut des champs, focus, événements input/change/pointerdown) et un stockage partagé pour les clés
// « game:* » (le reste, dont « mychar:* », reste propre à l'appareil). La synchro passe par le vrai sondage du mode
// local (startPolling), déclenché à la main. Contre-épreuve pour chaque correctif (loadEngine({transform})).
// Lancer depuis la racine du dépôt :  node tests/section308-formulaires.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// --- Mini-DOM du banc, complété pour les champs de formulaire -----------------------------------------------------
function documentDeTest(){
  const doc = creerDocument();
  const docListeners = [];
  const addDoc = doc.addEventListener;
  doc.addEventListener = (t, f, o) => { docListeners.push({ t, f, capture: o === true || !!(o && o.capture) }); return addDoc(t, f, o); };
  const proto = Object.getPrototypeOf(doc.body.__cible);
  let focused = null;
  Object.defineProperty(doc, 'activeElement', { configurable: true, get(){ return (focused && focused.__cible.attache) ? focused : doc.body; } });
  proto.focus = function(){ focused = this.__proxy; };
  proto.blur = function(){ if(focused === this.__proxy) focused = null; };
  const dec = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  Object.defineProperty(proto, 'defaultValue', { configurable: true, get(){ return this.tagName === 'TEXTAREA' ? dec(this._texte || '') : (this._attrs.has('value') ? this._attrs.get('value') : ''); } });
  Object.defineProperty(proto, 'defaultSelected', { configurable: true, get(){ return this._attrs.has('selected'); } });
  Object.defineProperty(proto, 'defaultChecked', { configurable: true, get(){ return this._attrs.has('checked'); } });
  Object.defineProperty(proto, 'type', { configurable: true, get(){ return this._attrs.get('type') || (this.tagName === 'INPUT' ? 'text' : this.tagName.toLowerCase()); } });
  Object.defineProperty(proto, 'options', { configurable: true, get(){ return this.children.filter(c => c.tagName === 'OPTION'); } });
  Object.defineProperty(proto, 'selectedIndex', { configurable: true, get(){ return this.options.findIndex(o => o.value === this.value); } });
  proto.setSelectionRange = function(a, b, d){ this.selectionStart = a; this.selectionEnd = b; this.selectionDirection = d; };
  // Événement : écouteurs du document (capture) puis de l'élément, comme un navigateur pour input/change/keydown.
  const fire = (el, type, extra = {}) => {
    const evt = Object.assign({ type, target: el, preventDefault(){}, stopPropagation(){} }, extra);
    docListeners.filter(l => l.t === type && l.capture).forEach(l => l.f(evt));
    const res = el.__cible._ecouteurs.filter(l => l.type === type).map(l => l.fn.call(el, evt));
    docListeners.filter(l => l.t === type && !l.capture).forEach(l => l.f(evt));
    return Promise.all(res.map(r => Promise.resolve(r)));
  };
  proto.dispatchEvent = function(evt){ fire(this.__proxy, evt.type); return true; };
  doc.fire = fire;
  // Saisie par le joueur : focus, nouvelle valeur, événement input (texte) ou change (liste, fichier).
  doc.taper = (sel, v) => { const el = doc.trouver(sel); el.focus(); el.value = v; return fire(el, 'input'); };
  doc.choisir = (sel, v) => { const el = doc.trouver(sel); el.focus(); fire(el, 'pointerdown'); el.value = v; return fire(el, 'change'); };
  return doc;
}

// --- Appareils ---------------------------------------------------------------------------------------------------
function store(){ return new Map(); }
function appareil(shared, opts = {}){
  const local = opts.local || new Map();
  const doc = documentDeTest();
  const timeouts = [], intervals = new Map(); let nextId = 1;
  const storage = {
    get: async k => { const m = k.startsWith('game:') ? shared : local; return m.has(k) ? { value: m.get(k) } : null; },
    set: async (k, v) => { (k.startsWith('game:') ? shared : local).set(k, v); return true; },
    delete: async k => { (k.startsWith('game:') ? shared : local).delete(k); return true; },
  };
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: {
    document: doc, storage, alert: m => alerts.push(String(m)),
    setTimeout: f => { timeouts.push(f); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } },
  } });
  const D = { eng, doc, alerts, local, run: c => eng.run(c), json: c => eng.json(c) };
  // Sondage du mode local (startPolling) : le vrai code, déclenché à la main.
  D.sonder = async () => { for(const f of [...intervals.values()]) if(/storageGet\('game:'/.test(String(f))) await f(); };
  D.minuteries = async () => { for(let i = 0; i < 50 && timeouts.length; i++){ const f = timeouts.shift(); await f(); } };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.val = sel => { const el = doc.trouver(sel); return el ? el.value : undefined; };
  D.fenetre = () => doc.trouver('modalHost').innerHTML;
  return D;
}
const ESC = s => JSON.stringify(s);

// Partie : Alice (créatrice, appareil A) et Bob (appareil B), avec ou sans entreprises.
async function partie({ withCompanies = true, names = ['Alice', 'Bob'], transform } = {}){
  // REIT activés (onglet REIT visible) pour les scénarios de vente.
  const shared = store();
  const A = appareil(shared, { transform });
  let ids;
  if(withCompanies){
    ids = await A.eng.newGame(names, names.map(() => 'garp'));
    A.run('state.settings.features.etf = true');
    await A.run('saveGame({silent:true})');
  } else {
    await A.run(`createGame(${ESC(names)}, 50, 1000, 'M$', {}, [])`);
    ids = A.json('state.players.map(p=>p.id)');
  }
  const code = A.run('gameCode');
  const B = appareil(shared, { transform });
  await B.run(`loadGame(${ESC(code)})`);
  B.run('render()');
  await B.cliquer(`[data-identity-pick="${ids[1]}"]`);
  A.run('closeModal(); render()'); B.run('closeModal(); render()');
  await A.calme(); await B.calme();
  A.alerts.length = 0; B.alerts.length = 0;
  return { shared, A, B, ids, code };
}

// Contre-épreuves.
const SANS_PRESERVATION = src => src.replace('  render();\n  if(snap){ try{ restoreAppFormState(snap); }', '  render(); snap = null;\n  if(snap){ try{ restoreAppFormState(snap); }');
const FENETRE_BLOQUE_SYNCHRO = src => src.replace('function shouldDeferRemoteState(nowMs){\n', "function shouldDeferRemoteState(nowMs){\n  { const h = document.getElementById('modalHost'); if(h && h.innerHTML && /<(input|textarea|select)[\\s>]/i.test(h.innerHTML)) return true; }\n");
// Retouche de la revue : render() passe par scheduleDeferredPopups ; l'ancien comportement l'ouvrait directement.
const POPUP_REMPLACE = src => src.replace('  if(isModalOpen()) return;\n  const previousSeen', '  const previousSeen')
  .replace('  scheduleDeferredPopups();\n  const tabs = visibleTabs();', '  maybeShowDiceRollTurnPopup(); maybeShowCeoAnnouncementExecutionPopup();\n  const tabs = visibleTabs();');
const SANS_2E_CONFIRMATION = src => src.replace('if(!same(shown, fresh)){ shown = fresh; changedNotice = true; paint();', 'if(false){')
  .replace('if(opts.expectedConditions && !sameConditions(opts.expectedConditions, goAdvanceConditions(companyId))) return staleConditionsResult();', '');
const CREATEUR_IMPLICITE = src => src.replace('else if(!myPlayerId || !state.players.some(p=>p.id===myPlayerId)) myPlayerId = null;', 'else if(!myPlayerId || !state.players.some(p=>p.id===myPlayerId)) myPlayerId = state.players[0] ? state.players[0].id : null;');
const SANS_ADOPTION = src => src.replace('if(attempt===1) adoptReceivedStateBeforeAction();', '');
const SELECT_BLOQUE = src => src.replace("if(appSelectOpenEl && ae===appSelectOpenEl && isAppField(ae) && nowMs-appSelectOpenAtMs < REMOTE_DEFER_SELECT_MS) return true;", "if(ae && ae.tagName==='SELECT' && isAppField(ae)) return true;");

(async () => {
  // =====================================================================================================
  await scenario('A. Fonctions pures : égalité des conditions, champs « modifiés », bornes du report', async () => {
    const eng = loadEngine();
    const same = (a, b) => eng.run(`sameConditions(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    ok(same({ a: 1, b: 'x', c: [1, 2] }, { c: [1, 2], b: 'x', a: 1 + 1e-12 }), 'A : mêmes conditions (ordre des clés indifférent, nombres à 1e-9 près)');
    ok(!same({ amount: 1.8182 }, { amount: 1.6667 }) && !same({ a: 1 }, { a: 1, b: 2 }) && !same({ a: [1] }, { a: [1, 2] }), 'A : montant différent, clé en plus ou tableau différent : conditions changées');
    ok(eng.run('REMOTE_DEFER_TYPING_MS') === 8000 && eng.run('REMOTE_DEFER_SELECT_MS') === 30000, 'A : report borné : 8 s après la dernière frappe, 30 s pour une liste ouverte');
    // Report : sur un vrai document de test.
    const shared = store(); const D = appareil(shared);
    await D.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    D.run(`activeTab = 'etf'; render()`);
    const now = D.run('Date.now()');
    D.run(`globalThis.__f = document.getElementById('whoami')`);
    D.run(`__f.focus(); noteAppFieldEvent('pointerdown', __f, undefined, false, ${now})`);
    ok(D.run(`shouldDeferRemoteState(${now + 1000})`) === true, 'A : liste « Vous êtes » ouverte : la valeur reçue attend');
    ok(D.run(`shouldDeferRemoteState(${now + 30001})`) === false, 'A : … au plus 30 s (jamais de blocage indéfini, section 187bis)');
    D.run(`noteAppFieldEvent('change', __f, undefined, false, ${now + 2000})`);
    ok(D.run(`shouldDeferRemoteState(${now + 2001})`) === false, 'A : choix fait (change), le select garde le focus mais la synchro reprend aussitôt');
    D.run(`noteAppFieldEvent('pointerdown', __f, undefined, false, ${now})`);
    D.run(`noteAppFieldEvent('keydown', __f, 'Escape', false, ${now + 10})`);
    ok(D.run(`shouldDeferRemoteState(${now + 20})`) === false, 'A : liste refermée par Échap : la synchro reprend');
  });

  // =====================================================================================================
  await scenario('B. Bogue 72 — fondation : nom, description, type et logo de Bob survivent à la fondation d’Alice', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await partie({ withCompanies: false, transform: variant === 'ancien' ? SANS_PRESERVATION : undefined });
      const { A, B, ids } = T;
      ok(/Fondez votre entreprise|fondez votre entreprise/.test(B.doc.trouver('app').innerHTML), `B [${variant}] : Bob voit le formulaire de fondation`);
      B.run(`resizeImageFileToDataUrl = async () => 'data:image/png;base64,TE9HTw=='`);
      await B.doc.taper('cName', 'Bob Holdings');
      await B.doc.taper('cDesc', 'Immobilier de luxe');
      await B.doc.choisir('cType', 'croissance');
      const logo = B.doc.trouver('cLogo'); logo.files = [{ name: 'logo.png' }]; await B.doc.fire(logo, 'change');
      await B.calme();
      ok(B.doc.trouver('cCroissanceTierRow').style.display === 'block', `B [${variant}] : type Croissance choisi, sa ligne « Profil de croissance » s’affiche`);
      // Alice fonde son entreprise sur l'appareil A ; l'appareil B reçoit la valeur au sondage suivant.
      await A.run(`createCompany(${ESC(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
      await B.sonder(); await B.calme();
      const seen = B.json(`{companies: state.companies.map(c=>c.name), name: document.getElementById('cName').value, desc: document.getElementById('cDesc').value, type: document.getElementById('cType').value, row: document.getElementById('cCroissanceTierRow').style.display || '', logo: /id="cLogoPreview"[^>]*><img/.test(app.innerHTML)}`);
      console.log(`    [${variant}] Bob voit ${JSON.stringify(seen)}`);
      ok(seen.companies.includes('Co Alice'), `B [${variant}] : la fondation d’Alice est bien reçue par l’appareil de Bob (synchro non bloquée)`);
      if(variant === 'corrigé'){
        ok(seen.name === 'Bob Holdings' && seen.desc === 'Immobilier de luxe', 'B : nom et description conservés (avant : vidés)');
        ok(seen.type === 'croissance' && seen.row === 'block', 'B : type « Croissance » conservé, avec sa ligne « Profil de croissance » (data-restore-sync)');
        ok(seen.logo, 'B : logo choisi conservé (aperçu toujours affiché)');
        await B.cliquer('cSubmit');
        const co = B.json(`state.companies.find(c=>c.ceoId===${ESC(ids[1])})`);
        ok(co && co.name === 'Bob Holdings' && co.type === 'croissance' && co.logoDataUrl === 'data:image/png;base64,TE9HTw==', 'B : « Fonder » crée « Bob Holdings », type Croissance, avec le logo choisi');
        const S = JSON.parse(T.shared.get('game:' + T.code));
        ok(S.companies.length === 2, 'B : les deux fondations sont enregistrées sur le serveur');
      } else {
        ok(seen.name === '' && seen.type !== 'croissance', 'B : contre-épreuve — sans la préservation, le formulaire de Bob est vidé');
      }
    }
  });

  // =====================================================================================================
  await scenario('C. Bogue 72 — liste Type ouverte au moment de la mise à jour : rien n’est refermé, la valeur suit au choix', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await partie({ withCompanies: false, transform: variant === 'ancien' ? SELECT_BLOQUE : undefined });
      const { A, B, ids } = T;
      await B.doc.taper('cName', 'Bob Holdings');
      const sel = B.doc.trouver('cType'); sel.focus(); B.doc.fire(sel, 'pointerdown');   // liste ouverte
      await A.run(`createCompany(${ESC(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
      await B.sonder(); await B.calme();
      const sameEl = B.doc.trouver('cType') === sel;
      const before = B.json('state.companies.length');
      ok(sameEl && before === 0, `C [${variant}] : pendant que la liste est ouverte, rien n’est redessiné (la liste reste ouverte, même élément)`);
      sel.value = 'croissance'; await B.doc.fire(sel, 'change');                           // choix fait ; le focus reste sur la liste
      await B.calme();
      const after = B.json(`{n: state.companies.length, type: document.getElementById('cType').value, name: document.getElementById('cName').value}`);
      console.log(`    [${variant}] après le choix : ${JSON.stringify(after)}, focus sur la liste : ${B.run("document.activeElement.id")}`);
      if(variant === 'corrigé'){
        ok(after.n === 1 && after.type === 'croissance' && after.name === 'Bob Holdings', 'C : dès le choix, la fondation d’Alice s’affiche et le formulaire de Bob est intact (type « croissance », nom)');
        ok(B.run('document.activeElement.id') === 'cType', 'C : le focus est rendu à la liste Type');
      } else {
        await B.sonder(); await B.calme();
        ok(B.json('state.companies.length') === 0, 'C : contre-épreuve — un select qui garde le focus bloquait la synchro indéfiniment (section 187bis)');
      }
    }
  });

  // =====================================================================================================
  await scenario('D. Bogue 72 (variante « 1 % pour 0 $ » du 57) — vente REIT : prix et pourcentage conservés, vente confirmée', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await partie({ names: ['Alice', 'Bob', 'Carl'], transform: variant === 'ancien' ? SANS_PRESERVATION : undefined });
      const { A, B, ids } = T;
      const etf = A.run('state.etfs[0].id');
      const a = A.run(`state.companies.find(c=>c.ceoId===${ESC(ids[0])}).id`), c = A.run(`state.companies.find(c=>c.ceoId===${ESC(ids[2])}).id`);
      await A.run(`attemptActionWithRetry(async ()=>{ companyById(${ESC(a)}).etfHoldings[${ESC(etf)}] = 100; return {ok:true}; })`);
      A.run(`activeTab = 'etf'; render()`);
      await A.doc.choisir(`etfSellBuyer_${etf}`, c);
      await A.doc.taper(`etfSellPct_${etf}`, '30');
      await A.doc.taper(`etfSellPrice_${etf}`, '5');
      A.run(`document.activeElement.blur && document.activeElement.blur()`);
      await A.calme();
      // Bob agit sur son appareil (subvention d'avance de Co Bob) : l'appareil d'Alice reçoit la valeur.
      await B.sonder(); await B.calme();
      const b = B.run(`myCompany().id`);
      await B.run(`takeGoAdvance(${ESC(b)})`);
      await A.sonder(); await A.calme();
      const form = { pct: A.val(`etfSellPct_${etf}`), price: A.val(`etfSellPrice_${etf}`), buyer: A.val(`etfSellBuyer_${etf}`) };
      const bobOwed = A.json(`companyById(${ESC(b)}).goAdvancesOwed`);
      console.log(`    [${variant}] formulaire d’Alice après la mise à jour : ${JSON.stringify(form)} ; Co Bob doit ${bobOwed} subvention(s) sur l’appareil d’Alice`);
      ok(bobOwed === 1, `D [${variant}] : l’action de Bob est reçue par l’appareil d’Alice`);
      const T0 = A.eng.cashTotal(), carl0 = A.json(`companyById(${ESC(c)}).cash`);
      await A.cliquer(`[data-etf-sell="${etf}"]`);
      const html = A.fenetre();
      await A.cliquer('mOk');
      // Section 310 — décision « revente de parts REIT » : la confirmation dépose une offre (rien ne bouge) ; Co Carl l'accepte.
      const S1 = JSON.parse(T.shared.get('game:' + T.code));
      const offerCount = (S1.assetSaleOffers || []).filter(o => o.kind === 'etf').length;
      const carlBeforeAccept = S1.companies.find(x => x.id === c).etfHoldings[etf] || 0;
      const closedAfterOffer = A.fenetre() === '';
      if(offerCount) await A.run(`(async ()=>{ const me = myPlayerId; myPlayerId = companyById(${ESC(c)}).ceoId; await acceptAssetSaleOffer(state.assetSaleOffers[0].id); myPlayerId = me; })()`);
      const S = JSON.parse(T.shared.get('game:' + T.code));
      const carl = S.companies.find(x => x.id === c);
      console.log(`    [${variant}] Co Carl reçoit ${carl.etfHoldings[etf] || 0} % pour ${(carl0 - carl.cash).toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(form.pct === '30' && form.price === '5' && form.buyer === c, 'D : pourcentage (30), prix (5) et acheteur (Co Carl) conservés (avant : 1 et 0)');
        ok(/Proposer une vente de parts de REIT/.test(html) && /<b>30%<\/b>/.test(html) && html.includes(A.run('fmt(5)')) && !/Prix nul/.test(html), 'D : « Proposer la vente » ouvre une confirmation qui récapitule 30 % à Co Carl pour 5,00 M$');
        ok(offerCount === 1 && carlBeforeAccept === 0, 'D : confirmée, une offre est déposée et rien ne bouge avant l’acceptation (section 310)');
        ok(near(carl.etfHoldings[etf], 30) && near(carl0 - carl.cash, 5), 'D : acceptée par Co Carl, la vente cède 30 % pour 5 M$');
        ok(near(A.eng.cashTotal(), T0), 'D : conservation de la monnaie');
        ok(closedAfterOffer, 'D : la fenêtre se ferme après le dépôt de l’offre');
      } else {
        ok(form.price === '' && form.pct === '1', 'D : contre-épreuve — sans la préservation, le prix est vidé (section 310 : champ vide par défaut) et le pourcentage revient à 1');
        ok(/Prix nul/.test(html), 'D : contre-épreuve — la confirmation (C2) signale alors « Prix nul » avant de céder 1 % pour 0 $');
      }
    }
  });

  // =====================================================================================================
  await scenario('E. C1 — focus, curseur et menu Actions conservés ; frappe en cours : la valeur reçue attend', async () => {
    const T = await partie({ names: ['Alice', 'Bob', 'Carl'] });
    const { A, B, ids } = T;
    const etf = A.run('state.etfs[0].id');
    const a = A.run('myCompany().id');
    await A.run(`attemptActionWithRetry(async ()=>{ companyById(${ESC(a)}).etfHoldings[${ESC(etf)}] = 100; return {ok:true}; })`);
    A.run(`activeTab = 'etf'; render()`);
    await A.doc.taper(`etfSellPrice_${etf}`, '12.5');
    const el = A.doc.trouver(`etfSellPrice_${etf}`); el.setSelectionRange(2, 2, 'none');
    const b = B.run('myCompany().id');
    await B.run(`takeGoAdvance(${ESC(b)})`);
    await A.sonder(); await A.calme();
    ok(A.json(`companyById(${ESC(b)}).goAdvancesOwed`) === 0 && A.doc.trouver(`etfSellPrice_${etf}`) === el, 'E : pendant la frappe, la valeur reçue attend (champ intact, clavier mobile non refermé)');
    A.run('appTypingAtMs = Date.now() - 9000');   // 9 s sans frappe : la valeur est appliquée
    await A.sonder(); await A.calme();
    const el2 = A.doc.trouver(`etfSellPrice_${etf}`);
    ok(A.json(`companyById(${ESC(b)}).goAdvancesOwed`) === 1 && el2 !== el, 'E : après 8 s sans frappe, la valeur reçue est appliquée et l’onglet redessiné');
    ok(el2.value === '12.5' && A.run('document.activeElement') === el2 && el2.selectionStart === 2 && el2.selectionEnd === 2, 'E : valeur, focus et curseur rendus au nouveau champ');
    // Menu Actions ouvert dans « Mon Entreprise ».
    A.run(`activeTab = 'entreprise'; render()`);
    await A.cliquer('entActionsMenuBtn');
    ok(A.doc.trouver('entActionsMenu').classList.contains('open'), 'E : menu Actions ouvert');
    await B.run(`takeGoAdvance(${ESC(b)})`);
    await A.sonder(); await A.calme();
    ok(A.json(`companyById(${ESC(b)}).goAdvancesOwed`) === 2, 'E : la valeur suivante est reçue');
    ok(A.doc.trouver('entActionsMenu').classList.contains('open') && A.doc.trouver('entActionsMenuBtn').getAttribute('aria-expanded') === 'true', 'E : le menu Actions reste ouvert après le rendu');
    // Un réglage validé n'est pas « préservé » par-dessus une valeur plus récente.
    const kept = A.json(`(()=>{ const s = captureAppFormState(); return s.fields.length; })()`);
    ok(kept === 0, 'E : aucun champ non modifié n’est capturé (les valeurs à jour s’affichent)');
  });

  // =====================================================================================================
  await scenario('F. C1 — une fenêtre ouverte ne bloque plus la synchro et n’est pas remplacée par « Résultats du tour »', async () => {
    for(const variant of ['corrigé', 'popup', 'blocage']){
      const transform = variant === 'popup' ? POPUP_REMPLACE : variant === 'blocage' ? FENETRE_BLOQUE_SYNCHRO : undefined;
      const T = await partie({ transform });
      const { A, B } = T;
      A.run('modalAdjustBank()');                                   // fenêtre avec un champ (créatrice = Alice)
      A.doc.trouver('mAmount').value = '3';
      const opened = A.fenetre();
      const roll0 = A.run('state.gameClock.rollCount');
      await B.run('rollDiceForAll()'); await B.calme();
      await A.sonder(); await A.calme();
      const r = { roll: A.run('state.gameClock.rollCount'), ev: A.run('state.lastDiceRollEvent ? state.lastDiceRollEvent.roll : null'), same: A.fenetre() === opened, amount: A.val('mAmount'), seen: A.run('seenDiceRollEventRoll') };
      console.log(`    [${variant}] lancer reçu par A : ${roll0} → ${r.roll}, fenêtre intacte : ${r.same}`);
      if(variant === 'corrigé'){
        ok(r.roll === roll0 + 1, 'F : le lancer joué par Bob est reçu malgré la fenêtre ouverte (avant : synchro gelée)');
        ok(r.same && r.amount === '3' && r.ev !== null && r.seen !== r.ev, 'F : la fenêtre d’Alice et sa saisie restent en place ; « Résultats du tour » attend');
        await A.cliquer('mCancel');
        ok(/Résultats du tour/.test(A.fenetre()) && A.run('seenDiceRollEventRoll') === r.ev, 'F : à la fermeture, « Résultats du tour » s’affiche');
        await A.cliquer('mRentTurnOk'); A.run('render()'); await A.calme();
        ok(A.fenetre() === '', 'F : une seule fois (pas de doublon)');
        // Deux lancers pendant une fenêtre : la fenêtre du dernier le signale.
        A.run('modalAdjustBank()');
        await B.sonder(); await B.run('rollDiceForAll()'); await B.calme(); await B.run('rollDiceForAll()'); await B.calme();
        await A.sonder(); await A.calme();
        await A.cliquer('mCancel');
        ok(/Résultats du tour/.test(A.fenetre()) && /1 autre\(s\) lancer\(s\) ont eu lieu/.test(A.fenetre()) && A.run('seenDiceRollEventRoll') === A.run('state.lastDiceRollEvent.roll') && A.run('state.gameClock.rollCount') === roll0 + 3, 'F : deux lancers pendant l’attente : une fenêtre (dernier lancer) qui signale l’autre');
      } else if(variant === 'popup'){
        ok(!r.same && /Résultats du tour/.test(A.fenetre()), 'F : contre-épreuve — sans l’attente, « Résultats du tour » remplace la fenêtre d’Alice');
      } else {
        ok(r.roll === roll0, 'F : contre-épreuve — avec l’ancienne garde, une fenêtre à champ gèle la synchro');
      }
    }
  });

  // =====================================================================================================
  await scenario('G. C2 — subvention d’avance : conditions changées pendant la fenêtre, 2e confirmation', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await partie({ transform: variant === 'ancien' ? SANS_2E_CONFIRMATION : undefined });
      const { A, B } = T;
      const a = A.run('myCompany().id');
      const amount1 = A.run(`goAdvanceAmount(1, companyById(${ESC(a)}))`);
      A.run(`modalConfirmGoAdvance(${ESC(a)})`);
      const html1 = A.fenetre();
      // L'administration change le taux sur un autre appareil (simulé sur B).
      await B.sonder();
      await B.run(`attemptActionWithRetry(async ()=>{ state.settings.goAdvanceRate = 0.25; return {ok:true}; })`);
      await A.sonder(); await A.calme();
      ok(A.fenetre() === html1, `G [${variant}] : la fenêtre reste ouverte et inchangée à la réception`);
      const amount2 = A.run(`goAdvanceAmount(1, companyById(${ESC(a)}))`);
      const cash0 = A.json(`companyById(${ESC(a)}).cash`), T0 = A.eng.cashTotal();
      await A.cliquer('mOk');
      const afterFirst = { owed: A.json(`companyById(${ESC(a)}).goAdvancesOwed`), html: A.fenetre() };
      console.log(`    [${variant}] affiché ${amount1.toFixed(4)} M$, nouveau montant ${amount2.toFixed(4)} M$ ; après la 1re confirmation : ${afterFirst.owed} subvention(s)`);
      if(variant === 'corrigé'){
        ok(afterFirst.owed === 0 && /Les conditions ont changé/.test(afterFirst.html) && afterFirst.html.includes(A.run(`fmt(${amount2})`)), `G : rien n’est vendu ; la fenêtre montre le nouveau montant (${amount2.toFixed(4)} au lieu de ${amount1.toFixed(4)}) et redemande confirmation`);
        await A.cliquer('mOk');
        const S = JSON.parse(T.shared.get('game:' + T.code)).companies.find(x => x.id === a);
        ok(S.goAdvancesOwed === 1 && near(S.cash - cash0, amount2), 'G : 2e confirmation : une subvention vendue, au montant affiché la 2e fois');
        ok(near(A.eng.cashTotal(), T0) && A.fenetre() === '', 'G : conservation de la monnaie ; fenêtre fermée');
        // Course : la condition change ENTRE la vérification et l'enregistrement (sauvegarde concurrente).
        A.run(`modalConfirmGoAdvance(${ESC(a)})`);
        await B.sonder();
        A.run(`globalThis.__orig = adoptLatestRemoteState; adoptLatestRemoteState = function(){ return false; }`);
        await B.run(`attemptActionWithRetry(async ()=>{ state.settings.goAdvanceRate = 0.05; return {ok:true}; })`);
        await A.cliquer('mOk');
        ok(/Les conditions ont changé/.test(A.fenetre()) && A.json(`companyById(${ESC(a)}).goAdvancesOwed`) === 1 && A.alerts.length === 0, 'G : changement découvert à l’enregistrement (conflit) : refus sans vente ni alerte, nouvelles conditions et 2e confirmation');
      } else {
        ok(afterFirst.owed === 1, 'G : contre-épreuve — sans la revérification, la vente part au nouveau montant sans que le joueur l’ait vu');
      }
    }
  });

  // =====================================================================================================
  await scenario('H. C2 — une action adopte la dernière valeur reçue avant de se calculer', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await partie({ transform: variant === 'ancien' ? SANS_ADOPTION : undefined });
      const { A, B } = T;
      await B.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; log('test'); return {ok:true}; })`);
      // Valeur reçue mais mise de côté (frappe en cours) ; Alice lance une action.
      A.run(`lastReceivedRaw = ${ESC(T.shared.get('game:' + T.code))}`);
      let calls = 0; A.sandbox = A.eng.sandbox; A.eng.sandbox.__count = () => calls++;
      const res = A.json(`(()=>{ globalThis.__res = null; attemptActionWithRetry(async ()=>{ __count(); globalThis.__seen = state.bank.cash; state.bank.cash += 0; return {ok:true}; }).then(r=>{ __res = r; }); return 0; })()`);
      await A.calme();
      const seen = A.run('__seen');
      console.log(`    [${variant}] l’action d’Alice voit la banque à ${seen} ; applyFn appelée ${calls} fois`);
      if(variant === 'corrigé') ok(calls === 1 && near(seen, B.run('state.bank.cash')), 'H : l’action se calcule directement sur l’état à jour (un seul calcul, pas de conflit)');
      else ok(calls === 2, 'H : contre-épreuve — sans l’adoption, l’action se calcule sur l’état périmé puis est rejouée après un conflit');
    }
  });

  // =====================================================================================================
  await scenario('I. C4 — « Vous êtes » imposé à un appareil sans identité ; rien ne change pour les autres', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const transform = variant === 'ancien' ? CREATEUR_IMPLICITE : undefined;
      const shared = store();
      const A = appareil(shared, { transform });
      const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', null]);
      await A.run('saveGame({silent:true})');
      const code = A.run('gameCode');
      const Blocal = new Map();
      const B = appareil(shared, { transform, local: Blocal });
      await B.run(`loadGame(${ESC(code)})`); B.run('render()');
      const appHtml = B.doc.trouver('app').innerHTML;
      const who = B.run('myPlayerId');
      console.log(`    [${variant}] appareil B sans identité : myPlayerId = ${who === ids[0] ? 'Alice (créatrice)' : who}`);
      if(variant === 'corrigé'){
        ok(who === null && /Vous êtes/.test(appHtml) && /data-identity-pick/.test(appHtml) && !/data-tab=/.test(appHtml), 'I : l’appareil voit d’abord « Vous êtes » (aucun onglet, aucun rôle)');
        ok(B.run(`state.creatorId===myPlayerId`) === false, 'I : plus de créateur implicite (avant : players[0], onglet Administration)');
        await B.cliquer(`[data-identity-pick="${ids[1]}"]`);
        ok(B.run('myPlayerId') === ids[1] && Blocal.get('mychar:' + code) === ids[1], 'I : Bob choisit son nom : identité mémorisée sur cet appareil');
        ok(/fondez votre entreprise/i.test(B.doc.trouver('app').innerHTML), 'I : Bob arrive sur sa fondation');
        const B2 = appareil(shared, { local: Blocal });
        await B2.run(`loadGame(${ESC(code)})`); B2.run('render()');
        ok(B2.run('myPlayerId') === ids[1] && !/data-identity-pick/.test(B2.doc.trouver('app').innerHTML), 'I : rechargé, l’appareil de Bob le reconnaît directement (aucun écran de choix)');
        ok(A.run('myPlayerId') === ids[0] && A.run('state.creatorId') === ids[0] && /data-tab="admin"/.test(A.doc.trouver('app').innerHTML), 'I : la créatrice, identifiée à la création, garde son appareil et l’Administration');
        const C = appareil(shared);
        await C.run(`loadGame(${ESC(code)}); isSpectator = true;`); C.run('render()');
        ok(!/data-identity-pick/.test(C.doc.trouver('app').innerHTML), 'I : mode spectateur (écran TV) : pas d’écran de choix');
        const D = appareil(shared);
        await D.run(`loadGame(${ESC(code)})`); D.run('render()');
        await D.cliquer('identitySpectator');
        ok(D.run('isSpectator') === true, 'I : depuis l’écran de choix, on peut passer en spectateur');
      } else {
        ok(who === ids[0] && /data-tab="admin"/.test(appHtml), 'I : contre-épreuve — l’appareil sans identité devient la créatrice, avec l’Administration');
      }
    }
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
