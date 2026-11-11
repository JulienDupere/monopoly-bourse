// Test — Section 319 (lot C, constat M3) : onglet « Produits », fiche ouverte conservée quand l'onglet est redessiné.
//
// Avant : chaque produit était rendu dans un <details class="pm-row"> sans état mémorisé ; à chaque action d'un autre
// joueur, l'onglet était redessiné et la fiche que le joueur lisait se repliait.
// Désormais : les fiches ouvertes sont mémorisées sur l'appareil (produitsOpenRows, jamais dans state), par une clé
// stable du produit, comme entrepriseAccordionState pour « Mon Entreprise ».
//
// H1 : fiche ouverte, action d'un autre joueur reçue : la fiche est redessinée ouverte (les autres restent fermées).
// H2 : fiche refermée par le joueur : elle reste fermée au redessin suivant.
// H3 : filtres de l'onglet : la fiche encore affichée reste ouverte (pas de redessin) ; masquée par un filtre puis
//      réaffichée après un redessin, elle est toujours ouverte.
// H4 : rien dans state (aucun champ, version et valeur partagée inchangées), clés uniques, contenu des fiches inchangé.
// H1b : contre-épreuve (loadEngine({ transform })) : sans l'attribut « open » au rendu, la fiche se replie.
// Deux appareils en mode local (stockage partagé pour « game:* »), mini-DOM du banc (tests/helpers/fake-dom.js,
// complété pour la section 319 : propriété « open » d'un <details>). Le joueur qui ouvre une fiche = open puis « toggle ».
// Lancer depuis la racine du dépôt :  node tests/section319-produits.test.js
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
const ESC = s => JSON.stringify(s);

function appareil(shared, opts = {}){
  const local = new Map();
  const doc = creerDocument();
  const fire = (el, type) => {
    const evt = { type, target: el, preventDefault(){}, stopPropagation(){} };
    return Promise.all(el.__cible._ecouteurs.filter(l => l.type === type).map(l => Promise.resolve(l.fn.call(el, evt))));
  };
  const timeouts = [], intervals = new Map(); let nextId = 1;
  const storage = {
    get: async k => { const m = k.startsWith('game:') ? shared : local; return m.has(k) ? { value: m.get(k) } : null; },
    set: async (k, v) => { (k.startsWith('game:') ? shared : local).set(k, v); return true; },
    delete: async k => { (k.startsWith('game:') ? shared : local).delete(k); return true; },
  };
  const eng = loadEngine({ transform: opts.transform, globals: {
    document: doc, storage, alert: () => {},
    setTimeout: (f, ms) => { timeouts.push({ f, ms: Number(ms) || 0 }); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } },
  } });
  const D = { eng, doc, run: c => eng.run(c), json: c => eng.json(c) };
  D.sonder = async () => { for(const f of [...intervals.values()]) if(/storageGet\('game:'/.test(String(f))) await f(); };
  D.minuteries = async () => { for(let i = 0; i < 50 && timeouts.length; i++){ const t = timeouts.shift(); await t.f(); } };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.fiche = key => doc.trouver(`details.pm-row[data-pm-key="${key}"]`);
  D.fiches = () => doc.querySelectorAll('details.pm-row');
  D.ouvertes = () => D.fiches().filter(d => d.open === true).map(d => d.dataset.pmKey);
  // Le joueur clique le résumé d'une fiche : le navigateur bascule « open » puis émet « toggle ».
  D.basculer = async key => { const d = D.fiche(key); d.open = !d.open; await fire(d, 'toggle'); };
  return D;
}
// Alice (appareil A) lit l'onglet « Produits » ; Bob (appareil B) joue.
async function partie(opts = {}){
  const shared = new Map();
  const A = appareil(shared, opts);
  const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  await A.run('saveGame({silent:true})');
  const code = A.run('gameCode');
  A.run(`myPlayerId = ${ESC(ids[0])}; closeModal(); activeTab = 'matrice'; render()`); await A.calme();
  const B = appareil(shared);
  await B.run(`loadGame(${ESC(code)})`); B.run(`myPlayerId = ${ESC(ids[1])}; closeModal();`); await B.calme();
  let k = 0;
  // Action d'un autre joueur (virement Bob → banque, monnaie conservée), puis réception par l'appareil d'Alice.
  const actionDeBob = async () => {
    k++;
    await B.run(`attemptActionWithRetry(async ()=>{ state.companies[1].cash -= 1; state.bank.cash += 1; log('Action de Bob n° ${k}'); return {ok:true}; }, {label:'action de Bob'})`);
    await A.sonder(); await A.calme();
  };
  return { shared, A, B, ids, code, actionDeBob };
}
const CLE = (A, nom) => A.run(`produitsRowKey(PRODUCTS_MATRIX.find(p=>p.nm===${ESC(nom)}))`);
const SANS_OPEN = s => s.replace("${produitsOpenRows[key]===true ? ' open' : ''}>", '>');

(async () => {
  await scenario('H1. Fiche « Hypothèque » ouverte, deux actions de Bob reçues : la fiche reste ouverte', async () => {
    const { A, actionDeBob } = await partie();
    const total = A.run('PRODUCTS_MATRIX.length'), cle = CLE(A, 'Hypothèque');
    ok(A.fiches().length === total && total > 10 && A.ouvertes().length === 0, `témoin : ${total} fiches rendues, toutes fermées`);
    const avant = A.fiche(cle);
    await A.basculer(cle);
    const v0 = A.run('state.version');
    await actionDeBob();
    const apres = A.fiche(cle);
    console.log(`    version ${v0} → ${A.run('state.version')} ; fiches ouvertes après redessin : ${JSON.stringify(A.ouvertes())}`);
    ok(A.run('state.version') > v0 && apres !== avant && !avant.__cible.attache, 'témoin : la mise à jour est reçue et l’onglet a bien été redessiné (nouvel élément)');
    ok(apres.open === true && apres.hasAttribute('open'), 'la fiche « Hypothèque » est redessinée ouverte');
    ok(A.ouvertes().length === 1 && A.ouvertes()[0] === cle, `elle est la seule ouverte (1 sur ${total})`);
    await actionDeBob();
    ok(A.fiche(cle).open === true && A.ouvertes().length === 1, '2e action de Bob : toujours ouverte (l’écouteur est rebranché à chaque dessin)');
    const autre = CLE(A, 'Vente à découvert');
    await A.basculer(autre); await actionDeBob();
    ok(A.ouvertes().length === 2 && A.fiche(autre).open === true && A.fiche(cle).open === true, 'deux fiches ouvertes : les deux survivent');
    A.run(`activeTab = 'portefeuille'; render()`); await A.calme();
    A.run(`activeTab = 'matrice'; render()`); await A.calme();
    ok(A.ouvertes().length === 2, 'aller-retour sur un autre onglet : les deux fiches sont retrouvées ouvertes (comme « Mon Entreprise »)');
  });

  await scenario('H1b. Contre-épreuve : rendu sans l’état mémorisé → la fiche se replie', async () => {
    const { A, actionDeBob } = await partie({ transform: SANS_OPEN });
    const cle = CLE(A, 'Hypothèque');
    await A.basculer(cle);
    ok(A.fiche(cle).open === true, 'témoin : la fiche est ouverte');
    await actionDeBob();
    ok(A.fiche(cle).open === false && A.ouvertes().length === 0, 'contre-épreuve : après l’action de Bob, la fiche est repliée');
  });

  await scenario('H2. Fiche refermée par le joueur : elle reste fermée', async () => {
    const { A, actionDeBob } = await partie();
    const cle = CLE(A, 'Hypothèque');
    await A.basculer(cle); await actionDeBob();
    await A.basculer(cle);
    ok(A.fiche(cle).open === false, 'témoin : le joueur referme la fiche');
    await actionDeBob();
    ok(A.fiche(cle).open === false && A.ouvertes().length === 0, 'après l’action de Bob : toujours fermée');
  });

  await scenario('H3. Filtres de l’onglet', async () => {
    const { A, actionDeBob } = await partie();
    const cle = CLE(A, 'Hypothèque');                    // trésorerie d'entreprise, tout lancer, crée une dette
    await A.basculer(cle);
    const el = A.fiche(cle);
    ok(await A.cliquer('.pm-filter-btn[data-filter-value="entreprise"]') === 'ok', 'filtre « Trésorerie d’entreprise » cliqué');
    ok(A.fiche(cle) === el && el.open === true && !el.classList.contains('pm-hidden'), 'la ligne est encore affichée : même élément, toujours ouvert');
    ok(A.fiches().some(d => d.classList.contains('pm-hidden')), 'témoin : le filtre masque d’autres lignes');
    await actionDeBob();
    ok(A.fiche(cle).open === true && !A.fiche(cle).classList.contains('pm-hidden'), 'action de Bob avec le filtre actif : fiche ouverte, toujours affichée');
    await A.cliquer('#pmFilterReset');
    await A.cliquer('.pm-filter-btn[data-filter-value="non"]');                 // « Aucune dette » : masque l'hypothèque
    ok(A.fiche(cle).classList.contains('pm-hidden'), 'filtre « Aucune dette » : la ligne « Hypothèque » est masquée');
    await actionDeBob();
    await A.cliquer('#pmFilterReset');
    ok(!A.fiche(cle).classList.contains('pm-hidden') && A.fiche(cle).open === true, 'filtres réinitialisés après un redessin : la ligne revient, encore ouverte');
  });

  await scenario('H4. État d’affichage hors de la partie ; clés uniques ; contenu des fiches inchangé', async () => {
    const { shared, A, code } = await partie();
    const cles = A.json('PRODUCTS_MATRIX.map(p=>produitsRowKey(p))');
    ok(new Set(cles).size === cles.length && cles.every(k => /^pm\d+$/.test(k)), `${cles.length} produits, ${new Set(cles).size} clés distinctes`);
    const brut = shared.get('game:' + code), v0 = A.run('state.version');
    const htmlFerme = A.run('renderProduitsMatrice()');
    await A.basculer(CLE(A, 'Hypothèque'));
    ok(shared.get('game:' + code) === brut && A.run('state.version') === v0 && A.run('actionsInFlight') === 0, 'ouvrir une fiche n’écrit rien dans la partie (valeur partagée et version inchangées)');
    ok(!/produitsOpenRows|pm-key|"pm\d+"/.test(A.run('JSON.stringify(state)')), 'aucun champ d’affichage dans state');
    const htmlOuvert = A.run('renderProduitsMatrice()');
    ok(htmlOuvert !== htmlFerme && htmlOuvert.replace(' open>', '>') === htmlFerme, 'le rendu ne diffère que par l’attribut « open » de la fiche ouverte');
    ok(htmlFerme.replace(/ data-pm-key="pm\d+"/g, '').split('<details class="pm-row" data-poche=').length - 1 === cles.length, 'hors la clé ajoutée, chaque ligne garde son balisage d’origine');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 319 (onglet Produits, lot C) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
