// Test — Section 308 : retouches de la revue critique du lot 1 (synchronisation, fenêtres, clics).
//
// R1 : double clic sur « Annuler » d'un ordre en attente (onglet Portefeuille) : le libellé « Annuler » libérait le
//      bouton de l'anti-rebond, le 2e clic annulait l'ordre suivant, remonté sous le curseur.
// R2 : clic avalé : au focusout du champ quitté (mousedown sur un bouton), la valeur reçue mise de côté était
//      appliquée par une minuterie de 0 ms, AVANT le mouseup : #app redessiné, bouton pressé détaché, pas de click.
// R3 : « Résultats du tour » perdu : render() l'ouvrait directement (et la marquait vue), puis l'appelant la
//      remplaçait par sa fenêtre de transaction (runModalActionWithRetry : closeModal(); render() ; buildHouse :
//      render(); showTransactionPopup(...)) : jamais montrée.
// R9 : une action en file qui échoue ne fait pas reculer seenDiceRollEventRoll (doublon de « Résultats du tour »).
// R4 : action lancée hors ligne : avec le vrai SDK, la transaction attend la reconnexion sans limite ; tous les
//      boutons d'action étaient ignorés sans message et rien n'était visible. Désormais : refus de lancer une action
//      quand la connexion est connue comme coupée, indicateur « Enregistrement… / en attente du réseau », clic
//      ignoré signalé ; l'action déjà en vol s'enregistre au retour de la connexion (voulu).
// R5 : relecture après un accusé perdu : once('value') sur un chemin écouté répond depuis le cache local, qui peut
//      ne pas contenir l'écriture ; « non écrite » n'est conclu que sur une version STRICTEMENT plus récente que la
//      base de l'essai, sinon l'issue est incertaine (le faux SDK du banc est fidèle sur ce point).
// R6 : issue incertaine dans une fenêtre : la fenêtre se ferme (OK actif invitait à recliquer → doublon possible).
// R10 : appel imbriqué d'attemptActionWithRetry signalé par console.error.
// R7 : champ qui enregistre au « change » (mDiscount) restauré après un rendu : le navigateur n'émet plus « change »
//      à la sortie du champ (valeur posée par le code) ; la valeur affichée n'était jamais enregistrée.
// R8 : fermer une fenêtre arme l'anti-rebond ; une fenêtre qui vient d'apparaître n'accepte aucun clic pendant
//      500 ms ; une fenêtre qui se redessine elle-même ne relance pas l'anti-rebond.
// R11 (documentation seule, commentaire près d'adoptRemoteRaw) : pas de test.
//
// Appareils = moteurs (vm) avec le mini-DOM du banc (tests/helpers/fake-dom.js), complété ici pour les champs,
// le focus et les événements. Contre-épreuve pour chaque correctif (loadEngine({transform})).
// Lancer depuis la racine du dépôt :  node tests/section308-retouches.test.js
const { loadEngine, check } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');
const { Reseau, mulberry32 } = require('./helpers/fake-firebase');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// --- Mini-DOM du banc, complété pour les champs de formulaire (comme section308-formulaires) ----------------------
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
  const fire = (el, type, extra = {}) => {
    const evt = Object.assign({ type, target: el, preventDefault(){}, stopPropagation(){} }, extra);
    docListeners.filter(l => l.t === type && l.capture).forEach(l => l.f(evt));
    const res = el.__cible._ecouteurs.filter(l => l.type === type).map(l => l.fn.call(el, evt));
    docListeners.filter(l => l.t === type && !l.capture).forEach(l => l.f(evt));
    return Promise.all(res.map(r => Promise.resolve(r)));
  };
  proto.dispatchEvent = function(evt){ fire(this.__proxy, evt.type); return true; };
  doc.fire = fire;
  doc.taper = (sel, v) => { const el = doc.trouver(sel); el.focus(); el.value = v; return fire(el, 'input'); };
  return doc;
}

// --- Appareils en mode local (window.storage partagé pour « game:* ») ---------------------------------------------
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
    setTimeout: (f, ms) => { timeouts.push({ f, ms: Number(ms) || 0 }); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } },
  } });
  const D = { eng, doc, alerts, local, timeouts, run: c => eng.run(c), json: c => eng.json(c) };
  D.sonder = async () => { for(const f of [...intervals.values()]) if(/storageGet\('game:'/.test(String(f))) await f(); };
  // Minuteries : toutes (maxMs = Infinity) ou seulement celles d'au plus maxMs (ex. 0 : « avant le mouseup »).
  D.minuteries = async (maxMs = Infinity) => {
    for(let i = 0; i < 50; i++){
      const k = timeouts.findIndex(t => t.ms <= maxMs);
      if(k < 0) break;
      const t = timeouts.splice(k, 1)[0]; await t.f();
    }
  };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.ancien = () => eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;');          // « plus de 500 ms plus tard »
  D.cliquer = async sel => { D.ancien(); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.val = sel => { const el = doc.trouver(sel); return el ? el.value : undefined; };
  D.fenetre = () => doc.trouver('modalHost').innerHTML;
  return D;
}
const ESC = s => JSON.stringify(s);
const tick = async (k = 5) => { for(let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };

// Une partie à deux joueurs sur un appareil (Alice), avec entreprises.
async function partieSolo(opts = {}){
  const shared = new Map();
  const A = appareil(shared, opts);
  const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  await A.run('saveGame({silent:true})');
  A.run(`myPlayerId = ${ESC(ids[0])}`);
  A.run('closeModal(); render()'); await A.calme();
  A.alerts.length = 0;
  return { shared, A, ids, code: A.run('gameCode'), serveur: () => JSON.parse(shared.get('game:' + A.run('gameCode'))) };
}

// --- Appareils sur le faux serveur Firebase du banc (tests/helpers/fake-firebase.js) --------------------------------
function fausseDate(maintenant){
  return class DateVirtuelle extends Date { constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); } static now(){ return maintenant(); } };
}
async function partieReseau(graine, transform){
  const eng = loadEngine();
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  const R = new Reseau({ graine });
  const chemin = 'data/game:' + code;
  R.ecrireServeur(chemin, eng.mem.get('game:' + code));
  return { R, code, chemin, ids, transform, serveur: () => JSON.parse(R.valeur(chemin)) };
}
function appareilReseau(env, nom, joueurId){
  const client = env.R.creerClient(nom);
  const doc = documentDeTest();
  const ls = new Map([['mb:lastcode', env.code], ['mb:mychar:' + env.code, joueurId]]);
  const M = Object.create(Math); M.random = mulberry32(env.R.entier(2 ** 31) + 1);
  const alerts = [];
  const eng = loadEngine({ firebase: client.firebase, transform: env.transform, globals: {
    document: doc,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    Math: M, Date: fausseDate(() => env.R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alerts.push(String(m)), confirm: () => true,
    Event: class { constructor(t){ this.type = t; } },
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc.invalid' },
  } });
  return { nom, client, doc, eng, alerts, run: c => eng.run(c), json: c => eng.json(c) };
}
const indicateur = app => { const el = app.doc.trouver('actionStatusIndicator'); return { visible: el.classList.contains('show'), horsLigne: el.classList.contains('offline'), texte: el.innerHTML }; };

// --- Contre-épreuves ------------------------------------------------------------------------------------------------
const ANNULER_LIBRE_PARTOUT = src => src.replace("return !!(b.closest && b.closest('#modalHost')) && /^(annuler|fermer|ok|×|✕)$/i.test((b.textContent||'').trim());", "return /^(annuler|fermer|ok|×|✕)$/i.test((b.textContent||'').trim());");
const FERMETURE_SANS_ANTIREBOND = src => src.replace('  if(isModalOpen()) lastModalOpenMs = Date.now();\n', '');
const FENETRE_NEUVE_CLIQUABLE = src => src.replace("if(anyBtn && anyBtn.closest && anyBtn.closest('#modalHost') && Date.now()-lastModalOpenMs < ACTION_CLICK_DEBOUNCE_MS){", 'if(false){');
const POINTEUR_IGNORE = src => src.replace('  if(pointerDeferRemainingMs(nowMs)>0) return true; // Section 308', '  // Section 308')
  .replace('    if(wait>0 && gameCode && lastReceivedRaw){ scheduleRemoteStateFlush(wait+5); return; }\n', '');
const SANS_CHANGE_A_LA_SORTIE = src => src.replace("if(el.isConnected!==false && el.value!==el.defaultValue && typeof el.dispatchEvent==='function' && typeof Event==='function') el.dispatchEvent(new Event('change', {bubbles:true}));", '');
const RENDU_OUVRE_POPUP = src => src.replace('  scheduleDeferredPopups();\n  const tabs = visibleTabs();', '  maybeShowDiceRollTurnPopup(); maybeShowCeoAnnouncementExecutionPopup();\n  const tabs = visibleTabs();');
const VU_RECULE = src => src.replace("if(typeof seenDiceRollEventRoll!=='number' || (typeof l.seenDiceRollEventRoll==='number' && l.seenDiceRollEventRoll>=seenDiceRollEventRoll)) seenDiceRollEventRoll = l.seenDiceRollEventRoll;", 'seenDiceRollEventRoll = l.seenDiceRollEventRoll;');
const SANS_REFUS_HORS_LIGNE = src => src.replace('  if(window.storage || firebaseConnected!==false) return false;', '  return false;');
const RELECTURE_NAIVE = src => src.replace('provenAbsent = typeof fresh.version===\'number\' && maybeWrittenBaseVersion!==null && fresh.version>maybeWrittenBaseVersion;', 'provenAbsent = true;');
const FENETRE_RESTE_OUVERTE = src => src.replace('  if(res && res.uncertain){ closeModal(); if(res.error) alert(res.error); return res; }\n', '');
const IMBRIQUE_WARN = src => src.replace("console.error('attemptActionWithRetry imbriqué : exécuté dans l’action en cours.');", "console.warn('attemptActionWithRetry imbriqué : exécuté dans l’action en cours.');");
const REDESSIN_RELANCE = src => src.replace('  if(!redraw) lastModalOpenMs = Date.now();\n', '  lastModalOpenMs = Date.now();\n');
// Vérification des retouches : contre-épreuves de R4b et R7b.
const SANS_GRACE_REPRISE = src => src.replace(' && nowMs - lastBecameVisibleMs >= OFFLINE_RESUME_GRACE_MS;', ';');
const MARQUE_GARDEE_AU_RENDU = src => src.replace('  restoredUncommittedFields = new WeakSet(); // Section 308 — vérification des retouches', '  // Section 308 — vérification des retouches');

(async () => {
  // =====================================================================================================
  await scenario('R1. Double clic sur « Annuler » d’un ordre en attente : le 2e clic n’annule pas l’ordre remonté', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partieSolo(variante === 'ancien' ? { transform: ANNULER_LIBRE_PARTOUT } : {});
      const { A } = T;
      const coB = A.run("state.companies.find(c=>c.name==='Co Bob').id");
      await A.run(`attemptActionWithRetry(async ()=>{ const p = state.players[0]; p.pendingBids = [{id:'b1', companyId:${ESC(coB)}, price:1, qty:1, createdAt:'x', roll:0}, {id:'b2', companyId:${ESC(coB)}, price:2, qty:1, createdAt:'x', roll:0}]; return {ok:true}; })`);
      A.run("activeTab = 'portefeuille'; render()"); A.ancien();
      const avant = A.doc.trouver('[data-cancel-bid]').dataset.cancelBid;
      const c1 = A.doc.cliquer('[data-cancel-bid]'); await c1.promesse; await tick();
      const remonte = A.doc.trouver('[data-cancel-bid]');
      const c2 = A.doc.cliquer('[data-cancel-bid]'); await c2.promesse; await tick();   // ~100 ms plus tard
      const restants = T.serveur().players[0].pendingBids.map(b => b.id);
      console.log(`    [${variante}] 1re ligne ${avant} → ${remonte && remonte.dataset.cancelBid} ; clics : ${c1.clic}, ${c2.clic} ; ordres restants : ${ESC(restants)}`);
      if(variante === 'corrigé'){
        ok(c1.clic === 'ok' && c2.clic === 'bloqué', 'R1 : 1er clic accepté, 2e clic du double clic ignoré');
        ok(ESC(restants) === '["b2"]', 'R1 : seul l’ordre b1 est annulé, b2 (remonté sous le curseur) reste');
        A.ancien();
        const c3 = A.doc.cliquer('[data-cancel-bid]'); await c3.promesse; await tick();
        ok(c3.clic === 'ok' && T.serveur().players[0].pendingBids.length === 0, 'R1 : un clic voulu, 500 ms plus tard, annule b2 normalement');
      } else {
        ok(c2.clic === 'ok' && restants.length === 0, 'R1 : contre-épreuve — avec le libellé libre partout, le double clic annule les deux ordres');
      }
    }
  });

  // =====================================================================================================
  await scenario('R2. Clic sur « Fonder » pendant qu’une valeur reçue attend : le bouton pressé n’est pas redessiné', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const shared = new Map();
      const transform = variante === 'ancien' ? POINTEUR_IGNORE : undefined;
      const A = appareil(shared, { transform });
      await A.run(`createGame(["Alice","Bob"], 50, 1000, 'M$', {}, [])`);
      const ids = A.json('state.players.map(p=>p.id)');
      const B = appareil(shared, { transform });
      await B.run(`loadGame(${ESC(A.run('gameCode'))})`); B.run('render()');
      await B.cliquer(`[data-identity-pick="${ids[1]}"]`);
      await B.doc.taper('#cName', 'Bob Holdings');
      await A.run(`createCompany(${ESC(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
      await B.sonder();
      const enAttente = B.run('lastReceivedRaw!==lastSerialized');
      // Bob appuie sur « Fonder » : pointerdown/mousedown sur le bouton, puis focusout du champ (ordre du navigateur) ;
      // le navigateur exécute les minuteries de 0 ms avant le mouseup.
      const bouton = B.doc.trouver('#cSubmit'), champ = B.doc.trouver('#cName');
      B.doc.fire(bouton, 'pointerdown'); B.doc.fire(bouton, 'mousedown');
      champ.blur(); B.doc.fire(champ, 'focusout');
      await B.minuteries(0);
      const attache = B.doc.trouver('#cSubmit') === bouton;
      console.log(`    [${variante}] valeur reçue en attente : ${enAttente} ; après focusout + minuterie 0 ms, bouton pressé encore attaché : ${attache}`);
      if(variante === 'corrigé'){
        ok(enAttente && attache, 'R2 : pointeur enfoncé : #app n’est pas redessiné, le bouton pressé reste le même (le click aura lieu)');
        B.doc.fire(bouton, 'pointerup'); B.doc.fire(bouton, 'mouseup');
        B.ancien(); const c = B.doc.cliquer('#cSubmit'); await c.promesse; await B.calme();
        const S = JSON.parse(shared.get('game:' + A.run('gameCode')));
        ok(c.clic === 'ok' && S.companies.length === 2 && S.companies.some(x => x.name === 'Bob Holdings' && x.ceoId === ids[1]), 'R2 : le click arrive : « Bob Holdings » est fondée, Co Alice est conservée (2 entreprises sur le serveur)');
        ok(B.run("state.companies.some(c=>c.name==='Co Alice')"), 'R2 : l’appareil de Bob affiche ensuite Co Alice');
        // Borne : un pointeur jamais relâché ne gèle pas la synchro.
        await A.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[0].cash += 1; return {ok:true}; })`);
        B.doc.fire(B.doc.trouver('#app'), 'pointerdown');
        await B.sonder();
        ok(B.run('shouldDeferRemoteState()') === true && B.run('lastReceivedRaw!==lastSerialized'), 'R2 : pointeur enfoncé : la valeur reçue attend');
        B.run('appPointerDownAtMs = Date.now() - REMOTE_DEFER_POINTER_MS - 1');
        await B.sonder();
        ok(B.run('lastReceivedRaw===lastSerialized'), 'R2 : borne — après 5 s sans relâchement, la valeur reçue est appliquée');
      } else {
        ok(enAttente && !attache, 'R2 : contre-épreuve — sans l’attente du relâchement, #app est redessiné entre mousedown et mouseup (bouton détaché : pas de click)');
      }
    }
  });

  // =====================================================================================================
  await scenario('R3. Lancer reçu pendant une fenêtre d’action : « Résultats du tour » s’affiche après la fenêtre de transaction', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const shared = new Map();
      const transform = variante === 'ancien' ? RENDU_OUVRE_POPUP : undefined;
      const A = appareil(shared, { transform });
      const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      await A.run('saveGame({silent:true})');
      const code = A.run('gameCode');
      A.run(`myPlayerId = ${ESC(ids[0])}; closeModal(); render()`); await A.calme();
      const B = appareil(shared, { transform });
      await B.run(`loadGame(${ESC(code)})`); B.run(`myPlayerId = ${ESC(ids[1])}; closeModal(); render()`); await B.calme();
      // a) Prêt de dernier recours (runModalActionWithRetry puis showTransactionPopup), lancer reçu pendant la fenêtre.
      await A.run(`attemptActionWithRetry(async ()=>{ const c = myCompany(); state.bank.cash += c.cash + 1; c.cash = -1; return {ok:true}; })`);
      A.run('render()'); await A.calme(); await B.sonder(); await B.calme();
      A.run('modalLastResortLoan()');
      await B.run('performRollForAllCompanies({auto:true})'); await B.calme();
      await A.sonder(); await A.calme();
      const recu = A.run('state.gameClock.rollCount') === 1 && /Prêt de dernier recours/.test(A.fenetre());
      await A.cliquer('#mOk');
      const apres = /Prêt de dernier recours/.test(A.fenetre()) && /Débit/.test(A.fenetre());
      await A.cliquer('#mOk');                     // « OK » de la fenêtre de transaction
      const tour = /Résultats du tour/.test(A.fenetre());
      // b) « render(); showTransactionPopup(...) » (buildHouse, payBail…) avec un lancer pas encore vu.
      A.run('closeModal()'); await A.calme();
      await B.run('performRollForAllCompanies({auto:true})'); await B.calme();
      A.run('actionsInFlight++'); await A.sonder(); A.run('actionsInFlight--');   // reçu pendant une action : aucun rendu
      A.run("adoptLatestRemoteState(); closeModal(); render(); showTransactionPopup('Construction de maison', [{label:'Banque', amount:1}, {label:'Co Alice', amount:-1}])");
      await A.calme();
      const b1 = /Construction de maison/.test(A.fenetre());
      await A.cliquer('#mOk');
      const b2 = /Résultats du tour/.test(A.fenetre()) && A.run('seenDiceRollEventRoll') === A.run('state.lastDiceRollEvent.roll') && A.run('state.gameClock.rollCount') === 2;
      console.log(`    [${variante}] a) lancer reçu, fenêtre intacte : ${recu} ; après « Confirmer » : transaction ${apres} ; après « OK » : « Résultats du tour » ${tour} | b) transaction ${b1}, puis « Résultats du tour » ${b2}`);
      if(variante === 'corrigé'){
        ok(recu && apres, 'R3 : la fenêtre de l’action reste en place pendant le lancer reçu, puis montre la transaction');
        ok(tour, 'R3 : à la fermeture de la transaction, « Résultats du tour » s’affiche (lancer reçu pendant la fenêtre)');
        ok(b1 && b2, 'R3 : « render(); showTransactionPopup(...) » : la transaction d’abord, « Résultats du tour » à sa fermeture');
      } else {
        ok(apres && !tour && b1 && !b2, 'R3 : contre-épreuve — ouverte par render() puis remplacée, « Résultats du tour » n’est jamais montrée');
      }
    }
  });

  // =====================================================================================================
  await scenario('R9. Une action en file qui échoue ne fait pas reculer « Résultats du tour » déjà montrée', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partieSolo(variante === 'ancien' ? { transform: VU_RECULE } : {});
      const { A } = T;
      A.run('seenDiceRollEventRoll = 4');
      const total0 = A.eng.cashTotal();
      // La fenêtre du lancer 5 est montrée pendant l'action (simulé), puis l'action échoue après avoir modifié state.
      const r = await A.run(`attemptActionWithRetry(async ()=>{ seenDiceRollEventRoll = 5; state.bank.cash -= 1; return {ok:false, error:null}; })`);
      const vu = A.run('seenDiceRollEventRoll');
      console.log(`    [${variante}] action refusée : ${r.ok === false} ; seenDiceRollEventRoll après restauration : ${vu}`);
      if(variante === 'corrigé') ok(r.ok === false && vu === 5 && A.eng.cashTotal() === total0, 'R9 : l’action est annulée (monnaie intacte) mais seenDiceRollEventRoll ne recule pas (5)');
      else ok(vu === 4, 'R9 : contre-épreuve — l’ancienne restauration ramène seenDiceRollEventRoll à 4 (la fenêtre reviendrait)');
    }
  });

  // =====================================================================================================
  await scenario('R4. Connexion coupée : action refusée avec un message, indicateur visible, clic ignoré signalé', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const env = await partieReseau(404, variante === 'ancien' ? SANS_REFUS_HORS_LIGNE : undefined);
      const A = appareilReseau(env, 'Alice', env.ids[0]);
      await env.R.pomper();
      const coB = A.run("state.companies.find(c=>c.name==='Co Bob').id");
      await env.R.attendrePromesse(A.run(`attemptActionWithRetry(async ()=>{ state.players[0].pendingBids = [{id:'b1', companyId:${ESC(coB)}, price:1, qty:1, createdAt:'x', roll:0}]; return {ok:true}; })`));
      await env.R.pomper();
      A.run("closeModal(); activeTab = 'portefeuille'; render()");
      const enLigne = A.run('firebaseConnected') === true && !indicateur(A).visible;
      const cash0 = env.serveur().players[0].cash;
      env.R.couper(A.client, 120000); await tick();
      const coupe = A.run('firebaseConnected') === false;
      // 1) Action lancée juste après la coupure (dans le délai de grâce) : en vol, elle attend la reconnexion.
      const p1 = A.run(`globalThis.__r1 = null; attemptActionWithRetry(async ()=>{ state.players[0].cash += 1; state.bank.cash -= 1; return {ok:true}; }, {label:'Virement test'}).then(r=>{ __r1 = r; return r; })`);
      await tick(10);
      const ind1 = indicateur(A);
      // 2) Clic sur un bouton d'action pendant l'envoi : ignoré, et signalé.
      A.run('lastActionEndMs = 0; lastModalOpenMs = 0;');
      const c = A.doc.cliquer('[data-cancel-bid]'); await c.promesse;
      const ind2 = indicateur(A);
      // 3) Trois secondes plus tard, toujours hors ligne : une nouvelle action n'est pas lancée.
      env.R.temps += 3000;
      const p2 = A.run(`globalThis.__r2 = null; attemptActionWithRetry(async ()=>{ state.players[0].cash += 5; state.bank.cash -= 5; return {ok:true}; }).then(r=>{ __r2 = r; return r; })`);
      await tick(10);
      const r2 = A.json('__r2'); const enVol = A.run('actionsInFlight'); const cashLocal = A.run('state.players[0].cash');
      const ind3 = indicateur(A);
      console.log(`    [${variante}] en ligne ${enLigne}, coupé ${coupe} ; action 1 en vol : indicateur « ${ind1.texte} » (visible ${ind1.visible}, rouge ${ind1.horsLigne}) ; clic : ${c.clic}, « ${ind2.texte} » ; action 2 : ${JSON.stringify(r2)}, actions en vol ${enVol}`);
      if(variante === 'corrigé'){
        ok(enLigne && coupe, 'R4 : « .info/connected » suivi (vrai en ligne, faux pendant la coupure)');
        ok(ind1.visible && ind1.horsLigne && /en attente du réseau/.test(ind1.texte) && /Virement test/.test(ind1.texte), 'R4 : action en vol hors ligne : indicateur visible « ⏳ Enregistrement en attente du réseau (Virement test)… »');
        ok(c.clic === 'bloqué' && /déjà en cours d’enregistrement/.test(ind2.texte), 'R4 : clic ignoré pendant l’envoi : signalé dans l’indicateur');
        ok(r2 && r2.ok === false && r2.reason === 'offline' && /Pas de connexion au serveur : action non envoyée/.test(r2.error) && enVol === 1 && cashLocal === cash0 + 1, 'R4 : connexion coupée depuis plus de 2 s : action refusée tout de suite, message clair, rien de modifié ni mis en file');
        ok(ind3.visible && /Pas de connexion au serveur/.test(ind3.texte), 'R4 : le refus est aussi affiché dans l’indicateur (même si l’appelant n’affiche pas l’erreur)');
        const r1 = await env.R.attendrePromesse(p1); await env.R.pomper();
        const S = env.serveur();
        ok(r1.ok === true && S.players[0].cash === cash0 + 1 && A.run('firebaseConnected') === true && !indicateur(A).visible, 'R4 : à la reconnexion, l’action en vol s’enregistre une fois (+1), l’action refusée est absente (pas +5) ; indicateur masqué');
        A.run('firebaseConnected = false; firebaseDisconnectedSinceMs = 0;');
        ok(A.run('isKnownOffline()') === true, 'R4 : (contrôle) coupure connue depuis longtemps → refus');
        const L = appareil(new Map());
        ok(L.run('firebaseConnected = false; firebaseDisconnectedSinceMs = 0; isKnownOffline()') === false, 'R4 : mode local (window.storage) : jamais de refus « hors ligne »');
      } else {
        ok(r2 === null && enVol === 2, 'R4 : contre-épreuve — sans le refus, la 2e action part en file et attend la reconnexion sans limite');
      }
    }
  });

  // =====================================================================================================
  await scenario('R4b. Retour au premier plan avec une coupure datée d’avant la veille : pas de refus le temps que le SDK se reconnecte', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const env = await partieReseau(405, variante === 'ancien' ? SANS_GRACE_REPRISE : undefined);
      const A = appareilReseau(env, 'Alice', env.ids[0]);
      await env.R.pomper();
      A.run('firebaseConnected = false; firebaseDisconnectedSinceMs = Date.now() - 600000;');   // coupure vue en arrière-plan il y a 10 min
      A.doc.fire(A.doc.body, 'visibilitychange');                                               // l'appli revient au premier plan
      const auRetour = A.run('isKnownOffline()');
      env.R.temps += 4001;
      const plusTard = A.run('isKnownOffline()');
      console.log(`    [${variante}] au retour : refus ${auRetour} ; 4 s plus tard, toujours coupé : refus ${plusTard}`);
      if(variante === 'corrigé'){
        ok(auRetour === false, 'R4b : au retour au premier plan, aucune action n’est refusée « hors ligne » pendant le délai de reconnexion');
        ok(plusTard === true, 'R4b : toujours coupé 4 s après le retour : le refus reprend');
      } else {
        ok(auRetour === true, 'R4b : contre-épreuve — sans délai depuis le retour au premier plan, refus immédiat au réveil du téléphone');
      }
    }
  });

  // =====================================================================================================
  await scenario('R5. Accusé perdu puis relecture depuis le cache local : issue incertaine, jamais « PAS enregistrée » à tort', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const env = await partieReseau(505, variante === 'ancien' ? RELECTURE_NAIVE : undefined);
      const A = appareilReseau(env, 'Alice', env.ids[0]);
      await env.R.pomper();
      // a) La 1re écriture arrive sur le serveur, l'accusé et la valeur poussée sont perdus (cache local périmé) ; les
      //    essais suivants échouent (« disconnect ») ; la connexion est revenue : la relecture répond depuis le cache.
      A.eng.sandbox.__ecrireServeur = raw => env.R.ecrireServeur(env.chemin, raw);
      A.run(`globalThis.__ecrit = false; saveGame = async function(){ saveFailureMaybeWritten = true; if(!__ecrit){ __ecrit = true; __ecrireServeur(JSON.stringify(Object.assign({}, state, {version: state.version + 1}))); } return false; }`);
      const cash0 = env.serveur().players[0].cash;
      const ra = await env.R.attendrePromesse(A.run(`attemptActionWithRetry(async ()=>{ state.players[0].cash += 7; state.bank.cash -= 7; return {ok:true}; })`));
      const Sa = env.serveur();
      // b) Contrôle : la valeur relue est plus récente (version de base + 1, écrite par un autre appareil) et ne contient
      //    pas l'action : « PAS enregistrée » reste la bonne conclusion.
      const env2 = await partieReseau(506, variante === 'ancien' ? RELECTURE_NAIVE : undefined);
      const B = appareilReseau(env2, 'Alice', env2.ids[0]);
      await env2.R.pomper();
      B.eng.sandbox.__autreEcriture = () => { const s = env2.serveur(); s.bank.cash -= 2; s.players[1].cash += 2; s.version += 1; const raw = JSON.stringify(s); env2.R.ecrireServeur(env2.chemin, raw); B.client.vue.set(env2.chemin, raw); };
      B.run(`globalThis.__ecrit = false; saveGame = async function(){ saveFailureMaybeWritten = true; if(!__ecrit){ __ecrit = true; __autreEcriture(); } return false; }`);
      const rb = await env2.R.attendrePromesse(B.run(`attemptActionWithRetry(async ()=>{ state.players[0].cash += 7; state.bank.cash -= 7; return {ok:true}; })`));
      console.log(`    [${variante}] a) serveur : Alice ${cash0} → ${Sa.players[0].cash} ; annonce : ${JSON.stringify({ ok: ra.ok, uncertain: ra.uncertain, reason: ra.reason })} | b) annonce : ${JSON.stringify({ ok: rb.ok, uncertain: rb.uncertain, reason: rb.reason })}`);
      if(variante === 'corrigé'){
        ok(Sa.players[0].cash === cash0 + 7 && ra.ok === false && ra.uncertain === true && ra.reason === 'unknown' && /impossible de savoir/.test(ra.error), 'R5 : écriture faite, cache périmé : issue incertaine (« impossible de savoir »), pas « PAS enregistrée »');
        ok(A.run('state.players[0].cash') === cash0, 'R5 : l’appareil revient au dernier état enregistré qu’il connaît (la partie se mettra à jour au retour de la connexion)');
        ok(rb.ok === false && !rb.uncertain && rb.reason === 'network' && rb.notSaved === true, 'R5 : valeur relue plus récente sans l’action : « PAS enregistrée » (preuve d’absence)');
        // Fidélité du faux SDK (en-tête de tests/helpers/fake-firebase.js) : once() depuis le cache d'un chemin écouté.
        const C = appareilReseau(env2, 'Carl', env2.ids[1]);
        await env2.R.pomper();
        const avant = env2.R.valeur(env2.chemin);
        const s = JSON.parse(avant); s.version += 1; env2.R.ecrireServeur(env2.chemin, JSON.stringify(s));   // écrit sans pousser
        const lu = await env2.R.attendrePromesse(C.run(`firebase.database().ref(${ESC(env2.chemin)}).once('value').then(x=>x.val())`));
        env2.R.ecrireServeur('data/autre', 'valeur-serveur');
        const luSansEcoute = await env2.R.attendrePromesse(C.run(`firebase.database().ref('data/autre').once('value').then(x=>x.val())`));
        env2.R.couper(C.client, 1000); await tick();
        const infoCoupe = await env2.R.attendrePromesse(C.run(`firebase.database().ref('.info/connected').once('value').then(x=>x.val())`));
        await env2.R.pomper();
        const infoRetour = await env2.R.attendrePromesse(C.run(`firebase.database().ref('.info/connected').once('value').then(x=>x.val())`));
        ok(lu === avant && luSansEcoute === 'valeur-serveur' && infoCoupe === false && infoRetour === true, 'R5 : faux SDK fidèle — once() sur un chemin écouté répond depuis le cache (même périmé), sinon depuis le serveur ; « .info/connected » faux pendant la coupure, vrai au retour');
      } else {
        ok(Sa.players[0].cash === cash0 + 7 && ra.ok === false && !ra.uncertain && ra.notSaved === true, 'R5 : contre-épreuve — relecture naïve : « PAS enregistrée » alors que le serveur a l’action (le joueur reclique : doublon)');
      }
    }
  });

  // =====================================================================================================
  await scenario('R6. Issue incertaine dans une fenêtre : la fenêtre se ferme', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partieSolo(variante === 'ancien' ? { transform: FENETRE_RESTE_OUVERTE } : {});
      const { A } = T;
      A.run(`saveGame = async function(){ saveFailureMaybeWritten = true; return false; }; readServerGameRaw = async function(){ return {ok:false}; };`);
      A.run(`openModal('<h3>Virement</h3><div id="mRetryStatus"></div><button id="mCancel">Annuler</button><button id="mOk">Confirmer le virement</button>'); document.getElementById('mOk').addEventListener('click', ()=>runModalActionWithRetry(async ()=>{ state.players[0].cash += 1; state.bank.cash -= 1; return {ok:true}; }));`);
      await A.cliquer('#mOk');
      const ouverte = A.doc.fenetreOuverte();
      const okActif = ouverte && A.doc.trouver('mOk') && !A.doc.trouver('mOk').disabled;
      console.log(`    [${variante}] fenêtre ouverte après l’issue incertaine : ${ouverte} (OK actif ${!!okActif}) ; alerte : ${A.alerts.join(' | ').slice(0, 90)}…`);
      if(variante === 'corrigé') ok(!ouverte && A.alerts.some(m => /impossible de savoir/.test(m) && /se mettra à jour au retour de la connexion/.test(m)), 'R6 : la fenêtre se ferme, le message explique que la partie se mettra à jour au retour de la connexion');
      else ok(ouverte && okActif, 'R6 : contre-épreuve — la fenêtre restait ouverte avec « Confirmer » actif (recliquer = nouvel identifiant, doublon possible)');
    }
  });

  // =====================================================================================================
  await scenario('R10. Appel imbriqué d’attemptActionWithRetry : console.error', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partieSolo(variante === 'ancien' ? { transform: IMBRIQUE_WARN } : {});
      const errs = [], warns = [];
      T.A.eng.sandbox.console = Object.assign(Object.create(console), { error: (...a) => errs.push(a.join(' ')), warn: (...a) => warns.push(a.join(' ')) });
      const r = await T.A.run(`attemptActionWithRetry(async ()=>{ const inner = await attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[0].cash += 1; return {ok:true}; }); return inner; })`);
      const signale = errs.some(m => /imbriqué/.test(m));
      console.log(`    [${variante}] action : ${r.ok} ; console.error : ${signale} ; console.warn : ${warns.some(m => /imbriqué/.test(m))}`);
      if(variante === 'corrigé') ok(r.ok === true && signale, 'R10 : l’appel imbriqué s’exécute dans l’action englobante et est signalé par console.error');
      else ok(!signale, 'R10 : contre-épreuve — avec console.warn, rien n’apparaît dans les erreurs');
    }
  });

  // =====================================================================================================
  await scenario('R7. Taux d’actualisation tapé, rendu distant, sortie du champ : la valeur affichée est enregistrée', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const shared = new Map();
      const transform = variante === 'ancien' ? SANS_CHANGE_A_LA_SORTIE : undefined;
      const A = appareil(shared, { transform });
      const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      await A.run('saveGame({silent:true})');
      const code = A.run('gameCode');
      A.run(`myPlayerId = ${ESC(ids[0])}; activeTab = 'admin'; closeModal(); render()`); await A.calme();
      const B = appareil(shared, { transform });
      await B.run(`loadGame(${ESC(code)})`); B.run(`myPlayerId = ${ESC(ids[1])}; render()`);
      const taux0 = A.run('state.settings.discountRate');
      await A.doc.taper('#mDiscount', '12');
      await B.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 2; state.players[1].cash += 2; return {ok:true}; })`);
      A.run('appTypingAtMs = Date.now() - REMOTE_DEFER_TYPING_MS - 1');   // 8 s sans frappe, focus toujours dans le champ
      await A.sonder();
      const champ = A.doc.trouver('#mDiscount');
      const restaure = A.run('state.players[1].cash') === JSON.parse(shared.get('game:' + code)).players[1].cash && champ.value === '12' && A.run('document.activeElement') === champ;
      const v0 = JSON.parse(shared.get('game:' + code)).version;
      champ.blur(); A.doc.fire(champ, 'focusout'); await A.calme();
      const S = JSON.parse(shared.get('game:' + code));
      console.log(`    [${variante}] taux ${taux0} ; après rendu distant : champ « ${champ.value} », focus rendu ${restaure} ; à la sortie du champ : serveur ${S.settings.discountRate} (version ${v0} → ${S.version})`);
      if(variante === 'corrigé'){
        ok(restaure, 'R7 : le rendu distant passe ; « 12 » et le focus sont rendus au nouveau champ');
        ok(Math.abs(S.settings.discountRate - 0.12) < 1e-12 && S.version === v0 + 1, 'R7 : à la sortie du champ, 12 % est enregistré, une fois');
        // Le joueur retouche la valeur après la restauration : le navigateur émet « change » lui-même, pas de doublon.
        await A.doc.taper('#mGrowth', '7');
        await B.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[1].cash += 1; return {ok:true}; })`);
        A.run('appTypingAtMs = Date.now() - REMOTE_DEFER_TYPING_MS - 1'); await A.sonder();
        const g = A.doc.trouver('#mGrowth');
        const gRestaure = g.value === '7';
        g.value = '8'; await A.doc.fire(g, 'input'); await A.doc.fire(g, 'change'); await A.calme();
        const v1 = JSON.parse(shared.get('game:' + code)).version;
        g.blur(); A.doc.fire(g, 'focusout'); await A.calme();
        const S2 = JSON.parse(shared.get('game:' + code));
        ok(gRestaure && Math.abs(S2.settings.growthRate - 0.08) < 1e-12 && S2.version === v1, 'R7 : valeur retouchée après restauration : enregistrée par le « change » du navigateur, aucun second enregistrement à la sortie');
      } else {
        ok(restaure && Math.abs(S.settings.discountRate - taux0) < 1e-12, 'R7 : contre-épreuve — sans « change » à la sortie, 12 % reste affiché mais n’est jamais enregistré');
      }
    }
  });

  // =====================================================================================================
  await scenario('R7b. Saisie poursuivie après une restauration, 2e rendu distant (Chrome émet focusout au retrait) : rien n’est enregistré en pleine saisie', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const shared = new Map();
      const transform = variante === 'ancien' ? MARQUE_GARDEE_AU_RENDU : undefined;
      const A = appareil(shared, { transform });
      const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      await A.run('saveGame({silent:true})');
      const code = A.run('gameCode');
      A.run(`myPlayerId = ${ESC(ids[0])}; activeTab = 'admin'; closeModal(); render()`); await A.calme();
      const B = appareil(shared, { transform });
      await B.run(`loadGame(${ESC(code)})`); B.run(`myPlayerId = ${ESC(ids[1])}; render()`);
      // Comme Chrome : retirer par innerHTML le champ qui a le focus émet focusout sur l'ancien champ.
      A.run(`(function(){ const r = render; render = function(){ const ae = document.activeElement; if(ae && ae.id==='mDiscount') noteAppFieldEvent('focusout', ae); return r.apply(this, arguments); }; })()`);
      const taux0 = JSON.parse(shared.get('game:' + code)).settings.discountRate;
      await A.doc.taper('#mDiscount', '12');
      await B.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[1].cash += 1; return {ok:true}; })`);
      A.run('appTypingAtMs = Date.now() - REMOTE_DEFER_TYPING_MS - 1'); await A.sonder(); await A.calme();
      await A.doc.taper('#mDiscount', '125');          // la saisie continue dans le champ restauré
      await B.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[1].cash += 1; return {ok:true}; })`);
      A.run('appTypingAtMs = Date.now() - REMOTE_DEFER_TYPING_MS - 1'); await A.sonder(); await A.calme();
      const S = JSON.parse(shared.get('game:' + code));
      const champ = A.doc.trouver('#mDiscount');
      const focus = A.run("document.activeElement && document.activeElement.id");
      console.log(`    [${variante}] taux ${taux0} ; après le 2e rendu distant : champ « ${champ.value} », focus ${focus}, serveur ${S.settings.discountRate}`);
      if(variante === 'corrigé'){
        ok(Math.abs(S.settings.discountRate - taux0) < 1e-12 && champ.value === '125' && focus === 'mDiscount', 'R7b : 2e rendu distant en pleine saisie : rien n’est enregistré, « 125 » et le focus restent dans le champ');
        champ.blur(); A.doc.fire(champ, 'focusout'); await A.calme();
        const S2 = JSON.parse(shared.get('game:' + code));
        ok(Math.abs(S2.settings.discountRate - 1.25) < 1e-12 && S2.version === S.version + 1, 'R7b : à la sortie du champ, 125 % est enregistré, une fois');
      } else {
        ok(Math.abs(S.settings.discountRate - 1.25) < 1e-12, 'R7b : contre-épreuve — sans remise à zéro des marques au rendu, la valeur intermédiaire est enregistrée en pleine saisie');
      }
    }
  });

  // =====================================================================================================
  await scenario('R8. Fermer une fenêtre arme l’anti-rebond ; une fenêtre neuve n’accepte aucun clic pendant 500 ms', async () => {
    for(const variante of ['corrigé', 'fermeture', 'fenêtre neuve', 'redessin']){
      const transform = { 'fermeture': FERMETURE_SANS_ANTIREBOND, 'fenêtre neuve': FENETRE_NEUVE_CLIQUABLE, 'redessin': REDESSIN_RELANCE }[variante];
      const T = await partieSolo(transform ? { transform } : {});
      const { A } = T;
      const coB = A.run("state.companies.find(c=>c.name==='Co Bob').id");
      await A.run(`attemptActionWithRetry(async ()=>{ state.players[0].pendingBids = [{id:'b1', companyId:${ESC(coB)}, price:1, qty:1, createdAt:'x', roll:0}]; return {ok:true}; })`);
      A.run("activeTab = 'portefeuille'; render()");
      // a) Double clic sur « OK » d'une fenêtre d'information : le 2e clic tombe sur « Annuler » de l'ordre, dessous.
      A.run("showTransactionPopup('Test', [{label:'Banque', amount:1}, {label:'Alice', amount:-1}])"); A.ancien();
      const ok1 = A.doc.cliquer('mOk'); await ok1.promesse;
      const dessous = A.doc.cliquer('[data-cancel-bid]'); await dessous.promesse; await tick();
      const ordres = T.serveur().players[0].pendingBids.length;
      // b) La fenêtre suivante (« Résultats du tour » en attente) apparaît à la fermeture : un 2e clic immédiat sur
      //    son « OK » ne la referme pas.
      A.run("state.lastDiceRollEvent = {roll: state.gameClock.rollCount, dice:[1,2]}; seenDiceRollEventRoll = -1;");
      A.run("showTransactionPopup('Test 2', [{label:'Banque', amount:1}, {label:'Alice', amount:-1}])"); A.ancien();
      const ok2 = A.doc.cliquer('mOk'); await ok2.promesse; await A.minuteries(0);
      const tourOuvert = /Résultats du tour/.test(A.fenetre());
      const ok3 = A.doc.cliquer('mRentTurnOk'); await ok3.promesse;
      const tourReste = /Résultats du tour/.test(A.fenetre());
      // c) Fenêtre qui se redessine elle-même : pas de nouvel anti-rebond.
      A.run("closeModal(); openModal('<h3>X</h3><button id=\"mOk\">Confirmer</button>'); lastModalOpenMs = 0; openModal('<h3>X bis</h3><button id=\"mOk\">Confirmer</button>', {redraw:true})");
      const garde = A.run('lastModalOpenMs');
      console.log(`    [${variante}] a) clic dessous : ${dessous.clic}, ordres restants ${ordres} ; b) « Résultats du tour » ouvert ${tourOuvert}, 2e clic : ${ok3.clic}, reste ouvert ${tourReste} ; c) redessin → lastModalOpenMs ${garde === 0 ? 'inchangé' : 'relancé'}`);
      if(variante === 'corrigé'){
        ok(ok1.clic === 'ok' && dessous.clic === 'bloqué' && ordres === 1, 'R8 : après « OK », le 2e clic du double clic ne tombe pas sur « Annuler » de l’ordre en dessous');
        ok(tourOuvert && ok3.clic === 'bloqué' && tourReste, 'R8 : « Résultats du tour », apparu à la fermeture, n’est pas refermé par le 2e clic');
        ok(garde === 0, 'R8 : une fenêtre qui se redessine ({redraw:true}) ne relance pas les 500 ms');
        A.ancien(); const ok4 = A.doc.cliquer('mOk'); await ok4.promesse;
        ok(ok4.clic === 'ok', 'R8 : 500 ms plus tard, la fenêtre redessinée accepte le clic');
      } else if(variante === 'fermeture'){
        ok(dessous.clic === 'ok' && ordres === 0, 'R8 : contre-épreuve — sans l’anti-rebond à la fermeture, le 2e clic annule l’ordre en dessous');
      } else if(variante === 'fenêtre neuve'){
        ok(tourOuvert && ok3.clic === 'ok' && !tourReste, 'R8 : contre-épreuve — sans la garde des fenêtres neuves, le 2e clic referme « Résultats du tour » aussitôt');
      } else {
        ok(garde !== 0, 'R8 : contre-épreuve — sans l’option redraw, le redessin relance l’anti-rebond');
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
