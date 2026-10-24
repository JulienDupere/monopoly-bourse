// Test — Section 308 : retouches de la revue critique du lot 1 (synchronisation, fenêtres, clics).
//
// R1 : double clic sur « Annuler » d'un ordre en attente (onglet Portefeuille) : le libellé « Annuler » libérait le
//      bouton de l'anti-rebond, le 2e clic annulait l'ordre suivant, remonté sous le curseur.
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
