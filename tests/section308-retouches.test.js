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
// R7 : champ qui enregistre au « change » (mDiscount) restauré après un rendu : le navigateur n'émet plus « change »
//      à la sortie du champ (valeur posée par le code) ; la valeur affichée n'était jamais enregistrée.
// R8 : fermer une fenêtre arme l'anti-rebond ; une fenêtre qui vient d'apparaître n'accepte aucun clic pendant
//      500 ms ; une fenêtre qui se redessine elle-même ne relance pas l'anti-rebond.
// (Les autres retouches sont ajoutées au fil des commits, un scénario par point.)
//
// Appareils = moteurs (vm) avec le mini-DOM du banc (tests/helpers/fake-dom.js), complété ici pour les champs,
// le focus et les événements. Contre-épreuve pour chaque correctif (loadEngine({transform})).
// Lancer depuis la racine du dépôt :  node tests/section308-retouches.test.js
const { loadEngine, check } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

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

// --- Contre-épreuves ------------------------------------------------------------------------------------------------
const ANNULER_LIBRE_PARTOUT = src => src.replace("return !!(b.closest && b.closest('#modalHost')) && /^(annuler|fermer|ok|×|✕)$/i.test((b.textContent||'').trim());", "return /^(annuler|fermer|ok|×|✕)$/i.test((b.textContent||'').trim());");
const FERMETURE_SANS_ANTIREBOND = src => src.replace('  if(isModalOpen()) lastModalOpenMs = Date.now();\n', '');
const FENETRE_NEUVE_CLIQUABLE = src => src.replace("if(anyBtn && anyBtn.closest && anyBtn.closest('#modalHost') && Date.now()-lastModalOpenMs < ACTION_CLICK_DEBOUNCE_MS){", 'if(false){');
const POINTEUR_IGNORE = src => src.replace('  if(pointerDeferRemainingMs(nowMs)>0) return true; // Section 308', '  // Section 308')
  .replace('    if(wait>0 && gameCode && lastReceivedRaw){ scheduleRemoteStateFlush(wait+5); return; }\n', '');
const SANS_CHANGE_A_LA_SORTIE = src => src.replace("if(el.value!==el.defaultValue && typeof el.dispatchEvent==='function' && typeof Event==='function') el.dispatchEvent(new Event('change', {bubbles:true}));", '');
const RENDU_OUVRE_POPUP = src => src.replace('  scheduleDeferredPopups();\n  const tabs = visibleTabs();', '  maybeShowDiceRollTurnPopup(); maybeShowCeoAnnouncementExecutionPopup();\n  const tabs = visibleTabs();');
const VU_RECULE = src => src.replace("if(typeof seenDiceRollEventRoll!=='number' || (typeof l.seenDiceRollEventRoll==='number' && l.seenDiceRollEventRoll>=seenDiceRollEventRoll)) seenDiceRollEventRoll = l.seenDiceRollEventRoll;", 'seenDiceRollEventRoll = l.seenDiceRollEventRoll;');
const REDESSIN_RELANCE = src => src.replace('  if(!redraw) lastModalOpenMs = Date.now();\n', '  lastModalOpenMs = Date.now();\n');

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
