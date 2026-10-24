// Section 308 — mini-DOM pour le banc multi-appareils : assez fidèle pour que les VRAIS gestionnaires de clics
// d'index.html s'exécutent (boutons des fenêtres et des onglets), sans dépendance externe.
//
//   const { creerDocument } = require('./helpers/fake-dom');
//   const doc = creerDocument();                       // coquille HTML d'index.html (#app, #modalHost…) déjà analysée
//   const eng = loadEngine({ globals: { document: doc } });
//   doc.cliquer('#mOk');                               // clic : écouteurs du document (capture), de l'élément et de
//   doc.cliquer('[data-mark-ready="co1"]');            // ses ancêtres, puis du document (bulle) ; renvoie {clic, promesse}
//
// Fidélité : chaque affectation de innerHTML est analysée (balises, attributs, imbrication) ; les anciens enfants sont
// détachés (getElementById → null, un clic dessus est « absent »), les nouveaux reçoivent leurs propres écouteurs ;
// value (input, select = option choisie ou première option), disabled (un clic sur un bouton désactivé est ignoré,
// comme dans un navigateur), dataset, classList, getAttribute, closest, querySelector(All) pour les sélecteurs simples
// utilisés par index.html (balise, #id, .classe, [attr], [attr="v"], combinaisons, listes « a, b », descendant).
// Limites : pas de mise en page, pas d'événements autres que ceux qu'on déclenche, textContent recalculé sur le HTML
// d'origine, sélecteurs complexes (>, :not…) non gérés (querySelectorAll → [], querySelector → nœud factice
// permissif). Un id inconnu (jamais vu dans un HTML analysé) donne un élément générique permissif, comme le faux
// DOM d'engine.js, pour ne pas faire planter un rendu sur un détail.
const fs = require('fs'), path = require('path');
const { fakeNode } = require('./engine');

const INTERACTIFS = new Set(['button', 'input', 'select', 'textarea', 'a', 'form', 'details', 'label', 'option']);
const VIDES = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RE_BALISE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>"'\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
const RE_ATTR = /([^\s=>"'\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const decoder = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const camel = s => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());

let coquilleCache = null;
function coquille(){
  if(coquilleCache !== null) return coquilleCache;
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const a = html.indexOf('<body'), b = html.lastIndexOf('\n<script>\n');
  coquilleCache = (a >= 0 && b > a) ? html.slice(html.indexOf('>', a) + 1, b) : '<div id="app"></div><div id="modalHost"></div>';
  return coquilleCache;
}

// Sélecteurs simples : "a, b" ; chaque partie = composés séparés par des espaces (descendant).
function compiler(sel){
  const parties = String(sel).split(',').map(s => s.trim()).filter(Boolean);
  const res = [];
  for(const p of parties){
    if(/[>+~:]/.test(p.replace(/\[[^\]]*\]/g, ''))) return null;           // non pris en charge
    const composes = p.match(/(?:[^\s\[]+|\[[^\]]*\])+/g);
    if(!composes) return null;
    const chaine = [];
    for(const c of composes){
      const m = { tag: null, id: null, classes: [], attrs: [] };
      const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([^\s=\]]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
      let x, fin = 0;
      while((x = re.exec(c))){
        if(x.index !== fin) return null;
        fin = re.lastIndex;
        if(x[1]) m.tag = x[1].toUpperCase();
        else if(x[2]) m.id = x[2];
        else if(x[3]) m.classes.push(x[3]);
        else m.attrs.push({ nom: x[4], val: x[5] !== undefined ? x[5] : x[6] !== undefined ? x[6] : x[7] });
      }
      if(fin !== c.length) return null;
      chaine.push(m);
    }
    res.push(chaine);
  }
  return res;
}
function correspondSimple(el, m){
  const t = el.__cible;
  if(m.tag && t.tagName !== m.tag) return false;
  if(m.id && t.id !== m.id) return false;
  for(const c of m.classes) if(!t._cls.has(c)) return false;
  for(const a of m.attrs){
    if(!t._attrs.has(a.nom)) return false;
    if(a.val !== undefined && t._attrs.get(a.nom) !== a.val) return false;
  }
  return true;
}
function correspond(el, compile){
  for(const chaine of compile){
    if(!correspondSimple(el, chaine[chaine.length - 1])) continue;
    let i = chaine.length - 2, p = el.__cible._parent;
    while(i >= 0 && p){ if(correspondSimple(p, chaine[i])) i--; p = p.__cible._parent; }
    if(i < 0) return true;
  }
  return false;
}

function creerDocument({ html = coquille() } = {}){
  let attaches = [];                      // éléments analysés attachés, dans l'ordre de création
  const parId = new Map();                // id -> dernier élément attaché portant cet id
  const detachesIds = new Set();          // ids vus puis détachés : getElementById → null
  const generiques = new Map();
  const ecouteursDoc = [];                // {type, fn, capture}

  // Éléments : méthodes sur un prototype commun (création peu coûteuse), enveloppés dans un Proxy permissif.
  class Element {
    constructor(tag, attrs, parent, generique){
      this.tagName = String(tag || 'div').toUpperCase(); this._attrs = new Map(attrs || []); this._classes = null; this._parent = parent || null;
      this._ecouteurs = []; this._html = ''; this._texte = ''; this.attache = false; this._generique = !!generique;
      this.value = ''; this.checked = false; this.disabled = false; this._style = null; this._dataset = null;
      this.id = this._attrs.get('id') || '';
      if(this._attrs.has('value')) this.value = this._attrs.get('value');
      if(this._attrs.has('disabled')) this.disabled = true;
      if(this._attrs.has('checked')) this.checked = true;
    }
    get _cls(){ if(!this._classes) this._classes = new Set((this._attrs.get('class') || '').split(/\s+/).filter(Boolean)); return this._classes; }
    get style(){ return this._style || (this._style = {}); }
    get dataset(){
      if(!this._dataset){ this._dataset = {}; for(const [k, v] of this._attrs) if(k.startsWith('data-')) this._dataset[camel(k.slice(5))] = v; }
      return this._dataset;
    }
    addEventListener(type, fn, opts){ this._ecouteurs.push({ type, fn, capture: opts === true || !!(opts && opts.capture) }); }
    removeEventListener(type, fn){ this._ecouteurs = this._ecouteurs.filter(e => !(e.type === type && e.fn === fn)); }
    getAttribute(n){ return this._attrs.has(n) ? this._attrs.get(n) : null; }
    hasAttribute(n){ return this._attrs.has(n); }
    setAttribute(n, v){ this._attrs.set(n, String(v)); if(n === 'id') this.id = String(v); if(n === 'class') this._classes = null; if(n.startsWith('data-')) this._dataset = null; if(n === 'disabled') this.disabled = true; }
    removeAttribute(n){ this._attrs.delete(n); if(n === 'class') this._classes = null; if(n === 'disabled') this.disabled = false; }
    querySelectorAll(sel){ return chercher(sel, this.__proxy); }
    querySelector(sel){ const c = compiler(sel); if(!c) return fakeNode(); return chercher(c, this.__proxy)[0] || null; }
    closest(sel){ const c = compiler(sel); if(!c) return null; let p = this.__proxy; while(p){ if(correspond(p, c)) return p; p = p.__cible._parent; } return null; }
    contains(x){ let p = x; while(p){ if(p === this.__proxy) return true; p = p.__cible ? p.__cible._parent : null; } return false; }
    appendChild(x){ return x; } removeChild(x){ return x; } insertBefore(x){ return x; } replaceChildren(){ this.innerHTML = ''; }
    insertAdjacentHTML(pos, h){ this.innerHTML = this._html + h; }
    remove(){ detacher(this.__proxy, true); }
    focus(){} blur(){} select(){} click(){ cliquerElement(this.__proxy); } scrollIntoView(){} scrollTo(){}
    getBoundingClientRect(){ return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    get className(){ return [...this._cls].join(' '); }
    set className(v){ this._attrs.set('class', String(v)); this._classes = null; }
    get classList(){ const s = this._cls; return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if(on) s.add(c); else s.delete(c); return on; }, contains: c => s.has(c) }; }
    get innerHTML(){ return this._html; }
    set innerHTML(h){ this._html = String(h); analyser(this.__proxy, this._html); }
    get textContent(){ return this._texteModifie !== undefined ? this._texteModifie : decoder(this._texte.replace(/<[^>]*>/g, '')); }
    set textContent(v){ this._texteModifie = String(v); }
    get innerText(){ return this.textContent; }
    set innerText(v){ this.textContent = v; }
    get parentElement(){ return this._parent; }
    get parentNode(){ return this._parent; }
    get children(){ return attaches.filter(e => e.__cible._parent === this.__proxy); }
    get options(){ return []; }
  }
  const GESTIONNAIRE = {
    get(o, k){ if(k === '__cible') return o; if(k in o) return o[k]; if(typeof k === 'symbol') return undefined; return fakeNode(); },
    set(o, k, v){ o[k] = v; return true; },
  };
  function element(tag, attrs, parent, generique){
    const t = new Element(tag, attrs, parent, generique);
    const p = new Proxy(t, GESTIONNAIRE);
    t.__proxy = p;
    return p;
  }
  function detacher(el, aussiLuiMeme){
    const D = new Set([el]);
    for(const e of attaches) if(D.has(e.__cible._parent)) D.add(e);
    if(!aussiLuiMeme) D.delete(el);
    attaches = attaches.filter(e => {
      if(!D.has(e)) return true;
      e.__cible.attache = false;
      const id = e.__cible.id;
      if(id && parId.get(id) === e){ parId.delete(id); detachesIds.add(id); }
      return false;
    });
  }
  function analyser(conteneur, html){
    detacher(conteneur, false);
    const pile = [{ tag: '#', el: conteneur }];      // balises ouvertes ; el = null pour une balise sans objet
    const parentReel = () => { for(let i = pile.length - 1; i >= 0; i--) if(pile[i].el) return pile[i].el; return conteneur; };
    RE_BALISE.lastIndex = 0;
    let m;
    while((m = RE_BALISE.exec(html))){
      if(m[0].startsWith('<!--')) continue;
      if(m[1]){                                                  // balise fermante
        const tag = m[1].toUpperCase();
        for(let i = pile.length - 1; i > 0; i--){
          if(pile[i].tag === tag){
            for(let j = pile.length - 1; j >= i; j--){ const o = pile[j]; if(o.el) o.el.__cible._texte = html.slice(o.debut, m.index); }
            pile.length = i; break;
          }
        }
        continue;
      }
      const tag = m[2].toLowerCase();
      const attrs = [];
      RE_ATTR.lastIndex = 0;
      let a;
      while((a = RE_ATTR.exec(m[3] || ''))) attrs.push([a[1].toLowerCase(), decoder(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '')]);
      if(!attrs.length && !INTERACTIFS.has(tag)){ if(!VIDES.has(tag) && !m[4]) pile.push({ tag: tag.toUpperCase(), el: null }); continue; }
      const el = element(tag, attrs, parentReel());
      el.__cible.attache = true;
      attaches.push(el);
      const id = el.__cible.id;
      if(id){ parId.set(id, el); detachesIds.delete(id); }
      if(tag === 'select'){
        const fin = html.indexOf('</select>', RE_BALISE.lastIndex);
        const corps = html.slice(RE_BALISE.lastIndex, fin < 0 ? undefined : fin);
        const choisie = /<option\b[^>]*\bselected\b[^>]*>/.exec(corps) || /<option\b[^>]*>/.exec(corps);
        if(choisie){ const v = /\bvalue\s*=\s*"([^"]*)"/.exec(choisie[0]); el.__cible.value = v ? decoder(v[1]) : ''; }
      }
      if(tag === 'textarea'){
        const fin = html.indexOf('</textarea>', RE_BALISE.lastIndex);
        el.__cible.value = decoder(html.slice(RE_BALISE.lastIndex, fin < 0 ? undefined : fin));
      }
      if(!VIDES.has(tag) && !m[4]) pile.push({ tag: tag.toUpperCase(), el, debut: RE_BALISE.lastIndex });
    }
  }
  function chercher(sel, racine){
    const c = typeof sel === 'string' ? compiler(sel) : sel;
    if(!c) return [];
    return attaches.filter(e => {
      if(!correspond(e, c)) return false;
      if(!racine) return true;
      let p = e.__cible._parent;
      while(p){ if(p === racine) return true; p = p.__cible._parent; }
      return false;
    });
  }
  function cliquerElement(el){
    if(!el || !el.__cible || !el.__cible.attache) return { clic: 'absent', promesse: Promise.resolve() };
    if(el.__cible.disabled) return { clic: 'désactivé', promesse: Promise.resolve() };
    let arret = false, arretImmediat = false, empeche = false;
    const evt = { type: 'click', target: el, currentTarget: null, bubbles: true,
      preventDefault(){ empeche = true; }, get defaultPrevented(){ return empeche; },
      stopPropagation(){ arret = true; }, stopImmediatePropagation(){ arret = true; arretImmediat = true; } };
    const resultats = [];
    const appeler = (liste, cible, phaseCapture) => {
      for(const e of liste.slice()){
        if(e.type !== 'click') continue;
        if(phaseCapture !== null && e.capture !== phaseCapture) continue;
        evt.currentTarget = cible;
        resultats.push(e.fn.call(cible, evt));
        if(arretImmediat) return;
      }
    };
    appeler(ecouteursDoc, doc, true);
    if(!arret){
      let p = el;
      while(p && !arret){ appeler(p.__cible._ecouteurs, p, p === el ? null : false); p = p.__cible._parent; }
    }
    if(!arret) appeler(ecouteursDoc, doc, false);
    return { clic: 'ok', promesse: Promise.all(resultats.map(r => Promise.resolve(r))) };
  }

  const racine = element('body', [], null);
  racine.__cible.attache = true;
  const actif = racine;
  const doc = {
    getElementById(id){
      if(parId.has(id)) return parId.get(id);
      if(detachesIds.has(id)) return null;
      if(!generiques.has(id)) generiques.set(id, element('div', [['id', id]], null, true));
      return generiques.get(id);
    },
    querySelectorAll(sel){ return chercher(sel, null); },
    querySelector(sel){ const c = compiler(sel); if(!c) return fakeNode(); return chercher(c, null)[0] || null; },
    createElement(tag){ return element(tag, [], null, true); },
    createTextNode(){ return fakeNode(); },
    addEventListener(type, fn, opts){ ecouteursDoc.push({ type, fn, capture: opts === true || !!(opts && opts.capture) }); },
    removeEventListener(type, fn){ const i = ecouteursDoc.findIndex(e => e.type === type && e.fn === fn); if(i >= 0) ecouteursDoc.splice(i, 1); },
    get activeElement(){ return actif; },
    body: racine, head: element('head', [], null, true), documentElement: element('html', [], null, true),
    title: '', hidden: false, visibilityState: 'visible',
  };
  // Outils du banc (hors moteur).
  const trouver = (sel) => (/^[\w-]+$/.test(sel) ? (parId.get(sel) || null) : (chercher(sel, null)[0] || null));
  doc.trouver = trouver;
  doc.cliquer = (sel) => cliquerElement(trouver(sel));
  doc.fenetreOuverte = () => !!(parId.get('modalHost') && parId.get('modalHost').__cible._html);
  racine.innerHTML = html;
  return doc;
}

module.exports = { creerDocument, compiler };
