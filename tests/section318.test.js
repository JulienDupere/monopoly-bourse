// Test — Section 318 : présentation (aucune mécanique de jeu, aucun changement d'argent ni d'état).
//   Volet A (téléphone) : CSS ≤ 600 px, tableaux dans .table-scroll, --sbw du bandeau défilant.
//   Volet B (clavier, lecteur d'écran) : onglets ARIA et flèches, fenêtres (role="dialog", Échap, Tab piégé, focus),
//   liens « quitter la partie » en boutons, bandeau aria-hidden, noms accessibles des cases à cocher.
//
// Lancer depuis la racine du dépôt :  node tests/section318.test.js
const fs = require('fs'), path = require('path');
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
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// Contre-épreuve : l'ancien code des onglets (div sans rôle ni tabindex).
const ANCIENS_ONGLETS = src => src.replace(/`<button type="button" class="tab [^\n]*<\/button>`/, "`<div class=\"tab ${t===activeTab?'active':''}\" data-tab=\"${t}\">${tabLabel(t)}</div>`");
// Contre-épreuve : sans le gestionnaire de touches des onglets (clavier inutilisable).
const SANS_TOUCHES_ONGLETS = src => src.replace("tabsBar.addEventListener('keydown', e=>{", "tabsBar.addEventListener('keyup', e=>{");
// Contre-épreuve : --sbw jamais recalculée après un rendu.
const SANS_SBW_AU_RENDU = src => src.replace('  updateScrollbarWidthVar();\n  ensureActiveTabVisible();', '  ensureActiveTabVisible();');
// Contre-épreuve : Échap sans le délai de l'anti-rebond.
const ECHAP_SANS_DELAI = src => src.replace('return nowMs-openedMs >= ACTION_CLICK_DEBOUNCE_MS;', 'return true;');

async function appareil(transform, opts = {}){
  const doc = creerDocument();
  const proto = Object.getPrototypeOf(doc.body.__cible);
  const focus = []; // identifiants des éléments qui reçoivent le focus
  proto.focus = function(){ focus.push(this.id || this.tagName); };
  let actif = null; // élément « actif » simulé (null : le corps du document)
  Object.defineProperty(doc, 'activeElement', { get: () => actif || doc.body, configurable: true });
  const observes = [];
  const style = {}; style.setProperty = (k, v) => { style[k] = v; };
  Object.defineProperty(doc.documentElement, 'style', { value: style }); doc.documentElement.clientWidth = 1000;
  const keydowns = [];
  const orig = doc.addEventListener;
  doc.addEventListener = (t, f, o) => { if(t === 'keydown' && !o) keydowns.push(f); return orig.call(doc, t, f, o); };
  const eng = loadEngine({ transform, globals: { document: doc, Event: class { constructor(t){ this.type = t; } }, innerWidth: 1000,
    matchMedia: () => ({ matches: opts.fin !== false }),
    ResizeObserver: class { constructor(cb){ this.cb = cb; observes.push(this); } observe(el){ this.cible = el; } } } });
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])}; render();`);
  return { eng, doc, keydowns, focus, observes, style, definirActif: x => { actif = x; }, app: () => doc.trouver('app').innerHTML, modal: () => doc.trouver('modalHost').innerHTML };
}

(async () => {
  await scenario('A. Balisage des onglets', async () => {
    const A = await appareil();
    const h = A.app();
    const boutons = h.match(/<button type="button" class="tab [^>]*>/g) || [];
    ok(/<div class="tabs" id="tabsBar" role="tablist" aria-label="Sections de la partie">/.test(h), 'A : la bande porte role="tablist" et un nom');
    ok(boutons.length >= 4 && boutons.every(b => /role="tab"/.test(b) && /aria-controls="tabbody"/.test(b) && /id="tab-[a-z]+"/.test(b)), 'A : chaque onglet est un <button role="tab"> relié à #tabbody (' + boutons.length + ' onglets)');
    ok(boutons.filter(b => /tabindex="0"/.test(b)).length === 1 && boutons.filter(b => /tabindex="-1"/.test(b)).length === boutons.length - 1, 'A : un seul onglet dans l’ordre de tabulation (tabindex=0), les autres à -1');
    ok(boutons.filter(b => /aria-selected="true"/.test(b)).length === 1 && boutons.filter(b => /aria-selected="false"/.test(b)).length === boutons.length - 1, 'A : un seul onglet aria-selected="true"');
    const actif = A.eng.run('activeTab');
    ok(new RegExp(`class="tab active" role="tab" id="tab-${actif}" aria-selected="true"[^>]*tabindex="0"`).test(h), 'A : l’onglet actif est celui qui est sélectionné et tabulable');
    ok(new RegExp(`id="tabbody" role="tabpanel" aria-labelledby="tab-${actif}"`).test(h), 'A : #tabbody est un tabpanel étiqueté par l’onglet actif');
    // Le clic sur un onglet marche toujours (les boutons sous .tabs restent « libres » pour l’anti-rebond).
    const autre = (h.match(/data-tab="([a-z]+)"/g) || []).map(x => x.slice(10, -1)).find(t => t !== actif);
    const r = A.doc.cliquer(`.tab[data-tab="${autre}"]`);
    ok(r.clic === 'ok' && A.eng.run('activeTab') === autre && new RegExp(`id="tab-${autre}" aria-selected="true"`).test(A.app()), 'A : clic sur l’onglet « ' + autre + ' » : actif et sélectionné');
    // Contre-épreuve de balisage : l'ancien code des onglets échoue au même contrôle.
    const V = await appareil(ANCIENS_ONGLETS);
    ok(!/role="tab"/.test(V.app()) && !/tabindex="0"/.test(V.app()), 'A : contre-épreuve — avec l’ancien code des onglets, role="tab" et tabindex sont absents (le contrôle échoue)');
    ok(/<div class="tabs" id="tabsBar" role="tablist"/.test(h), 'A : la bande porte id="tabsBar" (défilement restauré par la section 308)');
  });

  await scenario('A2. Gestionnaire de touches réel des onglets', async () => {
    const touches = (A, key, extra) => {
      const bar = A.doc.trouver('tabsBar');
      const actif = A.eng.run('activeTab');
      let prevented = false;
      const evt = Object.assign({ key, target: { dataset: { tab: actif } }, preventDefault(){ prevented = true; } }, extra || {});
      bar.__cible._ecouteurs.filter(l => l.type === 'keydown').forEach(l => l.fn.call(bar, evt));
      return prevented;
    };
    const A = await appareil();
    const premier = A.eng.run('activeTab');
    const liste = (A.app().match(/data-tab="([a-z]+)"/g) || []).map(x => x.slice(10, -1));
    ok(touches(A, 'ArrowRight') === true && A.eng.run('activeTab') === liste[1], 'A2 : flèche droite change d’onglet (' + premier + ' → ' + liste[1] + ')');
    ok(touches(A, 'Home') === true && A.eng.run('activeTab') === liste[0], 'A2 : Début ramène au premier onglet');
    ok(touches(A, 'End') === true && A.eng.run('activeTab') === liste[liste.length - 1], 'A2 : Fin va au dernier onglet');
    ok(touches(A, 'ArrowRight') === true && A.eng.run('activeTab') === liste[0], 'A2 : flèche droite sur le dernier → bouclage sur le premier');
    for(const mod of ['altKey', 'ctrlKey', 'metaKey']){
      const avant = A.eng.run('activeTab');
      ok(touches(A, 'ArrowLeft', { [mod]: true }) === false && A.eng.run('activeTab') === avant, 'A2 : ' + mod + ' + flèche : ignoré (le navigateur garde son raccourci, ex. Alt+Flèche gauche = retour)');
    }
    // Focus : si un onglet avait le focus, il le retrouve (le nouvel onglet actif) après le rendu.
    A.definirActif({ id: 'tab-' + A.eng.run('activeTab'), isConnected: true });
    A.eng.run('app.contains = function(){ return true; }');
    A.focus.length = 0;
    touches(A, 'ArrowRight');
    ok(A.focus.join() === 'tab-' + A.eng.run('activeTab'), 'A2 : le focus suit sur le nouvel onglet actif après le rendu (' + A.focus.join() + ')');
    // Contre-épreuve : sans gestionnaire de touches, rien ne bouge.
    const V = await appareil(SANS_TOUCHES_ONGLETS);
    const v0 = V.eng.run('activeTab');
    const barV = V.doc.trouver('tabsBar');
    barV.__cible._ecouteurs.filter(l => l.type === 'keydown').forEach(l => l.fn.call(barV, { key: 'ArrowRight', target: { dataset: { tab: v0 } }, preventDefault(){} }));
    ok(V.eng.run('activeTab') === v0, 'A2 : contre-épreuve — sans le gestionnaire de touches, la flèche droite ne change pas d’onglet (le contrôle échoue)');
  });

  await scenario('B. Touches des onglets et bande défilante', async () => {
    const A = await appareil();
    const tabs = ['a', 'b', 'c', 'd'];
    const k = (cur, key) => A.eng.run(`nextTabForKey(${JSON.stringify(tabs)}, ${JSON.stringify(cur)}, ${JSON.stringify(key)})`);
    ok(k('a', 'ArrowRight') === 'b' && k('c', 'ArrowRight') === 'd', 'B : flèche droite → onglet suivant');
    ok(k('d', 'ArrowRight') === 'a', 'B : flèche droite sur le dernier → bouclage sur le premier');
    ok(k('b', 'ArrowLeft') === 'a' && k('a', 'ArrowLeft') === 'd', 'B : flèche gauche → précédent, bouclage sur le dernier');
    ok(k('c', 'Home') === 'a' && k('b', 'End') === 'd', 'B : Début et Fin');
    ok(k('b', 'ArrowDown') === null && k('b', 'Enter') === null && k('b', 'x') === null, 'B : les autres touches ne concernent pas les onglets');
    const s = (bar, tab, sl) => A.eng.run(`tabStripScrollLeft(${JSON.stringify(bar)}, ${JSON.stringify(tab)}, ${sl}, 8)`);
    const bar = { left: 0, right: 375 };
    ok(s(bar, { left: 20, right: 120 }, 50) === 50, 'B : onglet déjà visible → scrollLeft inchangé');
    ok(s(bar, { left: 300, right: 460 }, 50) === 50 + 85 + 8, 'B : onglet coupé à droite → la bande défile juste assez (+ marge 8)');
    ok(s(bar, { left: -60, right: 40 }, 100) === 100 - 60 - 8, 'B : onglet coupé à gauche → la bande revient en arrière');
    ok(s(bar, { left: -60, right: 40 }, 10) === 0, 'B : jamais de scrollLeft négatif');
  });

  await scenario('C. Fenêtres : role="dialog", titre relié, Échap, Tab piégé', async () => {
    const A = await appareil();
    A.eng.run(`openModal('<h3>Titre test</h3><label>Montant</label><input type="number" id="mX"><div class="modal-actions"><button id="mOk">OK</button></div>')`);
    const m = A.modal();
    ok(/<div class="modal" role="dialog" aria-modal="true" tabindex="-1">/.test(m), 'C : la fenêtre porte role="dialog", aria-modal="true" et tabindex="-1"');
    // Le mini-DOM n'indexe pas les <h3> : le titre relié est vérifié sur une fenêtre factice.
    for(const [idInitial, attendu] of [['', 'modalTitle'], ['monTitre', 'monTitre']]){
      const attrs = {}, h3 = { id: idInitial, setAttribute(){} };
      const mod = { setAttribute: (k, v) => { attrs[k] = v; }, querySelector: s => (s === 'h3' ? h3 : null), querySelectorAll: () => [], focus(){} };
      A.eng.sandbox.__hote2 = { querySelector: () => mod, contains: () => false };
      A.eng.run('setupModalAccessibility(__hote2, true, null)');
      ok(h3.id === attendu && attrs['aria-labelledby'] === attendu, `C : le premier h3 ${idInitial ? 'garde son id' : 'reçoit un id'} et la fenêtre y est reliée (aria-labelledby="${attendu}")`);
    }
    // Échap : même règle que le clic sur le fond.
    const echap = A.keydowns[A.keydowns.length - 1];
    ok(typeof echap === 'function', 'C : un écouteur keydown du document est posé');
    const touche = (key, tag, extra) => { let prevented = false; echap(Object.assign({ key, target: { tagName: tag || 'INPUT' }, preventDefault(){ prevented = true; } }, extra || {})); return prevented; };
    ok(A.eng.run('isModalOpen()') && A.eng.run('Date.now()-lastModalOpenMs < ACTION_CLICK_DEBOUNCE_MS'), 'C : mise en place — la fenêtre vient de s’ouvrir (moins de 500 ms)');
    touche('Escape');
    ok(A.eng.run('isModalOpen()'), 'C : Échap avant ACTION_CLICK_DEBOUNCE_MS ne ferme pas la fenêtre');
    A.eng.run('lastModalOpenMs = Date.now() - ACTION_CLICK_DEBOUNCE_MS - 1');
    touche('Escape', 'SELECT');
    ok(A.eng.run('isModalOpen()'), 'C : Échap dont la cible est un SELECT ne ferme pas la fenêtre');
    ok(touche('Enter') === false && A.eng.run('isModalOpen()'), 'C : une autre touche ne ferme rien');
    ok(touche('Escape') === true && !A.eng.run('isModalOpen()'), 'C : Échap après le délai ferme la fenêtre');
    ok(touche('Escape') === false, 'C : Échap sans fenêtre ouverte ne fait rien');
    // Règle pure.
    const r = (tag, now, open) => A.eng.run(`modalEscapeShouldClose(${JSON.stringify(tag)}, ${now}, ${open})`);
    ok(r('DIV', 1000, 500) === true && r('DIV', 999, 500) === false && r('SELECT', 5000, 0) === false, 'C : règle pure (500 ms exactement : permis ; SELECT : jamais)');
    // Contre-épreuve : sans le délai, le contrôle échoue.
    const V = await appareil(ECHAP_SANS_DELAI);
    V.eng.run(`openModal('<h3>T</h3><input id="mX">')`);
    const echapV = V.keydowns[V.keydowns.length - 1];
    echapV({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault(){} });
    ok(!V.eng.run('isModalOpen()'), 'C : contre-épreuve — sans le délai, Échap ferme aussitôt (le contrôle « pas avant 500 ms » échoue)');
    // Tab piégé (règle pure, éléments factices).
    const E = i => ({ i }), modal = { m: 1 };
    const [a, b, c] = [E(1), E(2), E(3)];
    A.eng.sandbox.__t = { a, b, c, modal };
    const tt = (list, active, shift) => { A.eng.sandbox.__l = list; A.eng.sandbox.__a = active; return A.eng.run(`modalTabTarget(__l, __a, ${shift}, __t.modal)`); };
    ok(tt([a, b, c], c, false) === a, 'C : Tab sur le dernier élément → premier (bouclage)');
    ok(tt([a, b, c], a, true) === c, 'C : Maj+Tab sur le premier élément → dernier (bouclage)');
    ok(tt([a, b, c], modal, true) === c && tt([a, b, c], modal, false) === a, 'C : focus sur la fenêtre elle-même → Tab va au premier, Maj+Tab au dernier');
    ok(tt([a, b, c], b, false) === null && tt([a, b, c], b, true) === null, 'C : au milieu, le navigateur garde la main (null)');
    ok(tt([a, b, c], { dehors: 1 }, false) === a, 'C : focus hors de la fenêtre → ramené dedans');
    ok(tt([], a, false) === modal, 'C : fenêtre sans élément focalisable → la fenêtre elle-même');
  });

  await scenario('D. Focus : ouverture, redessin, fermeture', async () => {
    const A = await appareil();
    const journal = [];
    const mk = (id, tag, type) => ({ id, tagName: tag, type, disabled: false, offsetParent: {}, focus(){ journal.push(id); }, isConnected: true });
    const champ = mk('mX', 'INPUT', 'number'), bouton = mk('mOk', 'BUTTON'), selecteur = mk('mS', 'SELECT');
    const hote = { contains: x => x === champ || x === bouton || x === selecteur || x === modal };
    const modal = {
      focus(){ journal.push('modal'); }, setAttribute(){}, querySelector: () => null,
      querySelectorAll: s => (s === 'input,select,textarea' ? A.eng.sandbox.__champs : []),
    };
    hote.querySelector = () => modal;
    A.eng.sandbox.__hote = hote;
    A.eng.sandbox.__champs = [bouton, champ];             // le bouton n'est pas un champ de saisie
    A.eng.run('setupModalAccessibility(__hote, false, null)');
    ok(journal.join() === 'mX', 'D : à l’ouverture, le focus va au premier champ de saisie (jamais au bouton de confirmation)');
    journal.length = 0;
    A.eng.sandbox.__champs = [];
    A.eng.run('setupModalAccessibility(__hote, false, null)');
    ok(journal.join() === 'modal', 'D : sans champ de saisie, le focus va à la fenêtre elle-même');
    journal.length = 0;
    A.eng.sandbox.__champs = [selecteur, champ];
    A.eng.run('setupModalAccessibility(__hote, false, null)');
    ok(journal.join() === 'mS', 'D : un select compte comme champ de saisie (le premier dans l’ordre du document)');
    // Redessin : même id retrouvé, sinon la fenêtre ; focus hors fenêtre : on n'y touche pas.
    journal.length = 0;
    A.eng.sandbox.__champs = [champ];
    A.eng.sandbox.__rf = { id: 'inconnu' };
    A.eng.run('setupModalAccessibility(__hote, true, __rf)');
    ok(journal.join() === 'modal', 'D : redessin, élément de même id introuvable → la fenêtre');
    journal.length = 0;
    A.eng.run('setupModalAccessibility(__hote, true, null)');
    ok(journal.length === 0, 'D : redessin avec le focus hors de la fenêtre → rien n’est déplacé');
    // Fermeture : le focus revient à l'élément mémorisé s'il est encore dans le document.
    journal.length = 0;
    const origine = mk('retour', 'BUTTON');
    A.eng.sandbox.__orig = origine;
    A.eng.run(`openModal('<h3>T</h3>'); modalReturnFocus = __orig; closeModal();`);
    ok(journal.join() === 'retour', 'D : à la fermeture, le focus est rendu à l’élément mémorisé');
    journal.length = 0;
    origine.isConnected = false;
    A.eng.run(`openModal('<h3>T</h3>'); modalReturnFocus = __orig; closeModal();`);
    ok(journal.length === 0, 'D : élément retiré du document → pas de focus rendu');
  });

  await scenario('E. Tableaux : enveloppe .table-scroll idempotente', async () => {
    const A = await appareil();
    const classes = (el) => ({ add(c){ el.cls.add(c); }, contains(c){ return el.cls.has(c); } });
    const noeud = (tag) => { const el = { tag, cls: new Set(), enfants: [], parentNode: null }; el.classList = classes(el); Object.defineProperty(el, 'className', { set(v){ el.cls = new Set(String(v).split(/\s+/)); } }); el.insertBefore = (x, ref) => { x.parentNode = el; el.enfants.splice(el.enfants.indexOf(ref), 0, x); return x; }; el.appendChild = x => { if(x.parentNode){ x.parentNode.enfants = x.parentNode.enfants.filter(y => y !== x); } x.parentNode = el; el.enfants.push(x); return x; }; return el; };
    const racine = noeud('div'), t1 = noeud('table'), t2 = noeud('table');
    racine.appendChild(t1); racine.appendChild(t2);
    racine.querySelectorAll = () => { const out = []; const rec = e => e.enfants.forEach(c => { if(c.tag === 'table') out.push(c); rec(c); }); rec(racine); return out; };
    A.eng.sandbox.__doc = { createElement: tag => noeud(tag), activeElement: null, body: {} };
    A.eng.sandbox.__racine = racine;
    A.eng.run('document = __doc');
    const n1 = A.eng.run('wrapTablesForScroll(__racine)');
    ok(n1 === 2 && racine.enfants.length === 2 && racine.enfants.every(w => w.cls.has('table-scroll') && w.enfants.length === 1), 'E : deux tables → deux enveloppes .table-scroll');
    const n2 = A.eng.run('wrapTablesForScroll(__racine)');
    ok(n2 === 0 && racine.enfants.length === 2 && t1.parentNode.enfants.length === 1, 'E : second passage : rien de ré-enveloppé (idempotent)');
    // Dans l'application, aucun sélecteur CSS ou JS ne dépend de la parenté d'une table.
    ok(!/[>+]\s*table\b/.test(HTML.slice(0, HTML.indexOf('</style>'))), 'E : aucune règle CSS ne cible « > table » ou « + table »');
    ok(/table\{width:100%;border-collapse:collapse;/.test(HTML), 'E : les tableaux gardent width:100% à l’intérieur du conteneur');
  });

  await scenario('F. CSS et balisage statique', async () => {
    const css = HTML.slice(0, HTML.indexOf('</style>'));
    const mobile = css.slice(css.indexOf('@media (max-width:600px){\n  .topbar>div'));
    ok(/\.topbar>div\{white-space:normal;\}/.test(mobile), 'F : sous 600 px, la barre du haut passe à la ligne');
    ok(/\.tabs\{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;/.test(mobile) && /\.tabs::-webkit-scrollbar\{display:none;\}/.test(mobile) && /\.tab\{flex:0 0 auto;\}/.test(mobile), 'F : sous 600 px, onglets sur une ligne qui défile, barre masquée');
    ok(/\.brand h1\{font-size:22px;\}/.test(mobile) && /\.brand\{margin-bottom:10px;\}/.test(mobile), 'F : sous 600 px, titre à 22 px et marge réduite');
    ok(/\.topbar>div\{white-space:nowrap;\}/.test(css), 'F : le comportement ordinateur (nowrap) est conservé');
    ok(/\.tab:focus-visible\{outline-offset:-2px;\}/.test(mobile) && /\.tabs\{padding-bottom:2px;\}/.test(mobile), 'F : sous 600 px, l’anneau de focus d’un onglet n’est pas rogné par la bande');
    ok(/\.table-scroll\{overflow-x:auto;width:100%;max-width:100%;/.test(css), 'F : .table-scroll défile horizontalement');
    ok(/width:calc\(100vw - var\(--sbw,0px\)\);/.test(css) && /margin-left:calc\(50% - 50vw \+ var\(--sbw,0px\) \/ 2\);/.test(css), 'F : le bandeau défilant retire --sbw de 100vw et se recentre');
    ok(/:focus-visible\{outline:2px solid var\(--board\);outline-offset:2px;\}/.test(css), 'F : anneau de focus commun');
    ok(!/outline\s*:\s*(none|0)\b/.test(css.replace('.modal:focus{outline:none;}', '')), 'F : aucun outline:none hors la fenêtre elle-même (conteneur non interactif)');
    ok(/\.linklike\{background:transparent;border:0;padding:0;margin:0;font:inherit;color:inherit;text-decoration:underline;/.test(css), 'F : .linklike garde l’aspect d’un lien souligné');
    ok(/<div class="ticker-wrap" aria-hidden="true">/.test(HTML), 'F : le bandeau défilant est aria-hidden');
    for(const id of ['leaveGame', 'leaveGameSetup', 'leaveGameIdentity', 'identitySpectator', 'leaveGameSpectator', 'exitSpectator', 'gameEndedReview']){
      ok(new RegExp(`<button type="button" class="linklike[ a-z]*" data-free-click id="${id}">`).test(HTML), `F : #${id} est un <button class="linklike" data-free-click>`);
    }
    ok(!/<span[^>]*cursor:pointer/.test(HTML), 'F : plus aucun <span style="cursor:pointer"> dans le fichier');
    ok(/data-nwindex="\$\{def\.key\}" aria-label=/.test(HTML) && /data-compare-company="\$\{co\.id\}" aria-label=/.test(HTML) && /data-compare-market aria-label=/.test(HTML), 'F : cases des graphiques (MRKT, DIVD, MMTM, BOOM, GARP, comparateur) avec aria-label');
    // L'écran rendu : le lien « quitter la partie » de la barre du haut est un bouton.
    const A = await appareil();
    ok(/<button type="button" class="linklike" data-free-click id="leaveGame">quitter la partie<\/button>/.test(A.app()), 'F : écran rendu — « quitter la partie » est un bouton');
    ok(/aria-label="Afficher l’indice MRKT sur le graphique"/.test((() => { A.eng.run(`activeTab = 'portefeuille'; render();`); return A.doc.trouver('tabbody').innerHTML; })()), 'F : écran rendu — la case MRKT a un nom accessible');
  });

  await scenario('G. Fenêtres avec les vrais écouteurs : Tab piégé, focus mémorisé, écran tactile', async () => {
    const A = await appareil();
    const clavier = A.keydowns[A.keydowns.length - 1];
    const touche = (key, extra) => { let prevented = false; clavier(Object.assign({ key, target: { tagName: 'BUTTON' }, preventDefault(){ prevented = true; } }, extra || {})); return prevented; };
    A.eng.run(`openModal('<h3>T</h3><button id="b1">A</button><button id="b2">B</button>')`);
    const b1 = A.doc.trouver('b1'), b2 = A.doc.trouver('b2');
    A.focus.length = 0;
    A.definirActif(b2);
    ok(touche('Tab') === true && A.focus.join() === 'b1', 'G : Tab sur le dernier bouton → focus au premier (bouclage, vrai écouteur)');
    A.focus.length = 0; A.definirActif(b1);
    ok(touche('Tab', { shiftKey: true }) === true && A.focus.join() === 'b2', 'G : Maj+Tab sur le premier bouton → focus au dernier');
    A.focus.length = 0; A.definirActif(null);
    ok(touche('Tab') === true && A.focus.join() === 'b1', 'G : focus hors de la fenêtre → Tab le ramène dedans');
    A.focus.length = 0; A.definirActif(b1);
    ok(touche('Tab') === false && A.focus.length === 0, 'G : Tab au milieu de la fenêtre : le navigateur garde la main');
    // openModal capte lui-même l'élément actif, et closeModal le lui rend.
    const B = await appareil();
    const externe = { id: 'externe', isConnected: true, focus(){ B.focus.push('externe'); } };
    B.eng.run('closeModal()');
    B.definirActif(externe);
    B.eng.run(`openModal('<h3>T</h3><button id="b1">A</button>')`);
    B.definirActif(null);
    B.focus.length = 0;
    B.eng.run('openModal("<h3>Autre</h3><button id=\\"b3\\">A</button>")'); // une fenêtre en remplace une autre : l'origine est conservée
    B.focus.length = 0;
    B.eng.run('closeModal()');
    ok(B.focus.join() === 'externe', 'G : openModal mémorise l’élément actif (sans pose manuelle) et closeModal le lui rend, même après remplacement par une autre fenêtre (' + B.focus.join() + ')');
    // Écran tactile : pas de focus sur un champ (clavier virtuel, zoom Safari), focus sur la fenêtre.
    for(const [fin, attendu] of [[true, 'mX'], [false, 'modal']]){
      const C = await appareil(undefined, { fin });
      C.focus.length = 0;
      C.eng.run(`openModal('<h3>T</h3><input type="number" id="mX"><button id="mOk">OK</button>')`);
      ok(C.focus.length === 1 && (attendu === 'mX' ? C.focus[0] === 'mX' : C.focus[0] === 'DIV'), `G : ${fin ? 'souris précise' : 'écran tactile'} → focus sur ${fin ? 'le premier champ' : 'la fenêtre elle-même'} (${C.focus.join()})`);
    }
  });

  await scenario('H. --sbw, ResizeObserver, tables enveloppées au rendu', async () => {
    const A = await appareil();
    ok(A.observes.length === 1 && A.observes[0].cible === A.doc.documentElement, 'H : un ResizeObserver surveille <html>');
    A.eng.sandbox.innerWidth = 1008; A.doc.documentElement.clientWidth = 1000;
    A.observes[0].cb();
    ok(A.style['--sbw'] === '8px', 'H : la barre verticale apparaît sans « resize » : le ResizeObserver recalcule --sbw (8px)');
    A.eng.sandbox.innerWidth = 1000; A.eng.run('render()');
    ok(A.style['--sbw'] === '0px', 'H : render() recalcule --sbw (retour à 0px)');
    A.eng.sandbox.innerWidth = 1008; A.eng.run('render()');
    ok(A.style['--sbw'] === '8px', 'H : render() recalcule --sbw après l’apparition de la barre (8px)');
    const V = await appareil(SANS_SBW_AU_RENDU);
    V.eng.sandbox.innerWidth = 1008; V.eng.run('render()');
    ok(V.style['--sbw'] !== '8px', 'H : contre-épreuve — sans l’appel dans render(), --sbw n’est pas recalculée (le contrôle échoue)');
    // render() enveloppe les tables de #app tout de suite (avant la restauration de défilement de la section 308).
    const appels = [];
    A.eng.sandbox.__appels = appels;
    A.eng.run('(function(orig){ wrapTablesForScroll = function(r){ __appels.push(r && r.id); return orig(r); }; })(wrapTablesForScroll)');
    A.eng.run('render()');
    ok(appels.includes('app'), 'H : render() appelle wrapTablesForScroll(app) de façon synchrone');
    // Ids stables, par ordre du document, identiques d'un rendu à l'autre ; fenêtre : préfixe distinct.
    const noeud = (tag) => { const el = { tag, id: '', cls: new Set(), enfants: [], parentNode: null }; el.classList = { add(c){ el.cls.add(c); }, contains(c){ return el.cls.has(c); } }; Object.defineProperty(el, 'className', { set(v){ el.cls = new Set(String(v).split(/s+/)); } }); el.setAttribute = (k, v) => { if(k === 'id') el.id = v; }; el.insertBefore = (x, ref) => { x.parentNode = el; el.enfants.splice(el.enfants.indexOf(ref), 0, x); return x; }; el.appendChild = x => { if(x.parentNode) x.parentNode.enfants = x.parentNode.enfants.filter(y => y !== x); x.parentNode = el; el.enfants.push(x); return x; }; return el; };
    const racine = (id, n) => { const r = noeud('div'); r.id = id; for(let i = 0; i < n; i++) r.appendChild(noeud('table')); r.querySelectorAll = () => r.enfants.flatMap(function f(c){ return c.tag === 'table' ? [c] : c.enfants.flatMap(f); }); return r; };
    A.eng.sandbox.__doc = { createElement: tag => noeud(tag), activeElement: null, body: {} };
    A.eng.run('document = __doc');
    const rApp = racine('app', 3), rMod = racine('modalHost', 2);
    A.eng.sandbox.__r1 = rApp; A.eng.sandbox.__r2 = rMod;
    A.eng.run('wrapTablesForScroll(__r1); wrapTablesForScroll(__r2);');
    ok(rApp.enfants.map(w => w.id).join() === 'tblscroll-0,tblscroll-1,tblscroll-2' && rMod.enfants.map(w => w.id).join() === 'tblscroll-m0,tblscroll-m1', 'H : ids stables par ordre du document (tblscroll-0…, tblscroll-m0… dans une fenêtre)');
    A.eng.run('wrapTablesForScroll(__r1);');
    ok(rApp.enfants.length === 3 && rApp.enfants.map(w => w.id).join() === 'tblscroll-0,tblscroll-1,tblscroll-2', 'H : un second passage ne change ni les enveloppes ni les ids');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 318 (présentation, mobile et accessibilité) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
