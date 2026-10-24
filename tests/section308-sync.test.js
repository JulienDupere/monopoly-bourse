// Test — Section 308, partie B : banc d'essai multi-appareils.
//
// Demande de Julien (verbatim) : « Je ne veux pas de problème de synchronisation, de fermeture quand une action d'un
// autre joueur est prise. »
//
// Plusieurs appareils = plusieurs moteurs complets (un vm chacun, chargé depuis index.html), chacun avec son faux SDK
// Firebase, tous reliés au même faux serveur (tests/helpers/fake-firebase.js). Un ordonnanceur à graine fixe décide
// de l'ordre et du moment de chaque livraison réseau, du début de chaque action, des coupures et des rechargements.
// Chaque appareil démarre comme une vraie page : init() lit « lastcode » et « mychar » dans son localStorage, puis
// loadGame() lit la partie sur le serveur et pose l'écouteur temps réel.
//
// Les actions passent par l'interface réelle (mini-DOM de tests/helpers/fake-dom.js) : fenêtre ouverte par la vraie
// fonction modal…, champs remplis, clic sur le vrai bouton #mOk (qui respecte « disabled » et disparaît quand la
// fenêtre se ferme) ; « Tour Terminé » et son annulation = clic sur le vrai bouton de l'onglet Entreprise, avec les
// écouteurs posés par bindTabEvents (donc avec toute garde anti-double-clic qui y serait ajoutée). TOUTES passent
// par la COUCHE D'ADAPTATION ci-dessous (objet ACTIONS) : c'est le seul endroit à modifier si l'interface change.
//
// Traçage : chaque action reçoit un contexte (AsyncLocalStorage, qui suit les await à travers le vm). Une enveloppe
// autour de attemptActionWithRetry ajoute un marqueur {t, r} dans state.__banc quand l'applyFn réussit (t = action
// et numéro d'appel, r = rollCount au moment de l'application) ; une enveloppe autour de advanceGameClock ajoute
// {t, de, att, fin} dans state.__lancers (de = rollCount avant le lancer, att = rollCount affiché au clic, fin = la
// partie était déjà terminée). Ces marqueurs voyagent avec l'état : ils sont sur le serveur exactement si la mutation
// y est. L'« annonce » d'une action est le résultat renvoyé par attemptActionWithRetry (ce que la fonction métier
// utilise pour afficher l'échec ou fermer la fenêtre) ; les alert() sont capturées par action.
//
// Invariants vérifiés après retour au calme (voir verifier()) : aucune action perdue, doublée ou fantôme ; une action
// interrompue par un rechargement est appliquée au plus une fois ; aucune action jamais terminée ; actions de tour
// appliquées au lancer affiché ; un seul lancer par tour, jamais après la fin de partie ; masse monétaire conservée
// sur le serveur et sur chaque appareil ; tous les appareils convergent vers la valeur du serveur.
//
// Lancer :  node tests/section308-sync.test.js
//   SYNC_SEEDS=N        nombre de graines par scénario (passage long ; défaut : petit nombre, < ~30 s au total)
//   SYNC_SCENARIO=S3    ne lancer que les scénarios dont le code commence par S3
//   SYNC_GRAINE=7       ne lancer que cette graine (reproduction)
//   SYNC_VERBEUX=1      afficher le journal réseau et les actions de chaque cas en échec
//   SYNC_TOUT=1         avec SYNC_VERBEUX, détailler aussi les cas réussis
//   SYNC_TRANSFORM=f.js charger les moteurs avec module.exports = (source) => source modifiée (prototype de correctif,
//                       contre-épreuve) ; voir l'option transform de tests/helpers/engine.js
const { AsyncLocalStorage } = require('async_hooks');
const { loadEngine } = require('./helpers/engine');
const { Reseau, mulberry32 } = require('./helpers/fake-firebase');
const { creerDocument } = require('./helpers/fake-dom');

const als = new AsyncLocalStorage();
const NB_GRAINES = process.env.SYNC_SEEDS ? Math.max(1, parseInt(process.env.SYNC_SEEDS, 10)) : null;
const FILTRE = process.env.SYNC_SCENARIO || '';
const GRAINE_SEULE = process.env.SYNC_GRAINE ? parseInt(process.env.SYNC_GRAINE, 10) : null;
const VERBEUX = !!process.env.SYNC_VERBEUX;
const TRANSFORM = process.env.SYNC_TRANSFORM ? require(require('path').resolve(process.env.SYNC_TRANSFORM)) : undefined;
const exceptionsNonRattrapees = [];
process.on('unhandledRejection', (e) => { exceptionsNonRattrapees.push(String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); });

// =====================================================================================================================
// Partie initiale (créée une fois, en mode local window.storage, puis copiée sur le faux serveur de chaque cas)
// =====================================================================================================================
let PARTIE = null;
async function partieInitiale(){
  if(PARTIE) return PARTIE;
  const sauveRandom = Math.random;
  const r = mulberry32(308); Math.random = r;
  const eng = loadEngine({ transform: TRANSFORM });
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloé'], ['garp', 'dividende', 'garp']);
  const ok = await eng.run(`saveGame({silent:true})`);
  Math.random = sauveRandom;
  if(ok !== true) throw new Error('Mise en place : sauvegarde initiale impossible');
  const code = eng.run('gameCode');
  PARTIE = { code, ids, raw: eng.mem.get('game:' + code), chemin: 'data/game:' + code.replace(/[.#$\[\]/]/g, '_') };
  return PARTIE;
}
// Variantes de la partie initiale (modifient la valeur de départ sur le serveur).
const VARIANTES = {
  base: s => s,
  // Alice et Chloé ont déjà cliqué « Tour Terminé » : le clic de Bob est le dernier.
  pretsSaufBob: s => { s.companies.forEach(c => { if(c.name !== 'Co Bob') c.ready = true; }); return s; },
  // Le prochain lancer termine la partie (durée maximale : année 0 dépassée au lancer 6).
  finAuProchainLancer: s => { s.gameClock.rollCount = 5; s.hiddenGameLengthTargetYear = 0; return s; },
  // Bob et Chloé sont sous enquête : Alice est la seule entreprise qui lance (scénario du bogue 59).
  aliceSeuleLance: s => { s.companies.forEach(c => { if(c.name !== 'Co Alice'){ c.inJail = true; c.jailTurnsLeft = 3; } }); return s; },
};

// =====================================================================================================================
// Enveloppes de traçage installées dans chaque moteur après son chargement.
// =====================================================================================================================
const INSTALLER_TRACAGE = `(function(){
  const origTenter = attemptActionWithRetry;
  attemptActionWithRetry = function(applyFn, o){
    const ctx = __banc.contexte();
    // Hors action du banc, ou appel imbriqué depuis une applyFn (il s'exécute dans l'action englobante, dont le
    // marqueur couvre déjà les mutations) : pas de traçage séparé.
    if(!ctx || ctx.dansApply > 0) return origTenter.apply(this, arguments);
    const i = ++ctx.nAppels;
    const t = ctx.tag + '/' + i;
    ctx.appels[i] = 'en cours';
    const enveloppe = async function(){
      const r0 = (state && state.gameClock) ? state.gameClock.rollCount : null;
      let res;
      ctx.dansApply = (ctx.dansApply || 0) + 1;
      try{ res = await applyFn.apply(this, arguments); } finally { ctx.dansApply--; }
      if(res && res.ok){ if(!Array.isArray(state.__banc)) state.__banc = []; state.__banc.push({t: t, r: r0}); }
      return res;
    };
    return origTenter.call(this, enveloppe, o).then(
      // Section 308 — accusé de réception perdu : issue « incertaine » quand le serveur n'a pas pu être relu.
      res => { ctx.appels[i] = (res && res.uncertain) ? 'incertaine' : !!(res && res.ok); return res; },
      e => { ctx.appels[i] = 'exception'; throw e; });
  };
  const origHorloge = advanceGameClock;
  advanceGameClock = function(){
    const ctx = __banc.contexte();
    if(!Array.isArray(state.__lancers)) state.__lancers = [];
    state.__lancers.push({t: ctx ? ctx.tag : null, de: state.gameClock.rollCount,
      att: (ctx && ctx.attendu !== undefined) ? ctx.attendu : null, fin: !!state.gameEndedReason});
    return origHorloge.apply(this, arguments);
  };
})()`;

function fausseDate(maintenant){
  return class DateVirtuelle extends Date {
    constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); }
    static now(){ return maintenant(); }
  };
}

// =====================================================================================================================
// Appareils
// =====================================================================================================================
async function creerAppareil(env, nom, joueurId){
  const n = (env.compteurPages[nom] = (env.compteurPages[nom] || 0) + 1);
  const client = env.R.creerClient(n > 1 ? `${nom}(page ${n})` : nom);
  const doc = creerDocument();
  const app = { nom, joueurId, client, doc, page: n, vivant: true, plan: [], occupe: false, enCours: new Set(), alertesHorsAction: [] };
  const ls = new Map([['mb:lastcode', env.code], ['mb:mychar:' + env.code, joueurId]]);
  const M = Object.create(Math); M.random = mulberry32(env.R.entier(2 ** 31) + 1);
  app.eng = loadEngine({
    firebase: client.firebase,
    transform: TRANSFORM,
    globals: {
      document: doc,
      localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
      Math: M, Date: fausseDate(() => env.R.maintenant()),
      setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
      alert: (m) => { const ctx = als.getStore(); (ctx ? ctx.alertes : app.alertesHorsAction).push(String(m)); },
      confirm: () => true,
      __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc-308.invalid' },
      __banc: { contexte: () => als.getStore() || null },
    },
  });
  app.eng.run(INSTALLER_TRACAGE);
  env.appareils.push(app);
  return app;
}
const etatDe = (app) => app.eng.json('state');
const lancerAffiche = (app) => app.eng.run('state && state.gameClock ? state.gameClock.rollCount : null');
const societeDe = (app) => app.eng.run('(myCompany()||{}).id || null');

// =====================================================================================================================
// COUCHE D'ADAPTATION — une entrée par type d'action. preparer() fait ce que l'utilisateur fait AVANT le clic
// (ouvrir la fenêtre, remplir les champs) et renvoie false si l'action ne peut pas commencer (fenêtre refusée) ;
// cliquer() fait le clic et renvoie la promesse du gestionnaire. ctx.attendu = rollCount affiché au moment du clic,
// pour les actions liées au tour (pour le 2e clic d'un double clic, celui du 1er : même intention, même tour vu).
// État après la fusion avec le lot 1a (API section 308) : rien à appeler directement. Les boutons « Tour Terminé »
// et « Annuler » portent data-roll et leurs écouteurs (bindTabEvents) passent ce numéro à markCompanyReady /
// cancelCompanyReady ; la fenêtre « Forcer le tour » appelle performRollForAllCompanies({expectedRoll, logLine}) ;
// la garde anti-double-clic est un écouteur du document en phase de capture (le mini-DOM l'exécute : un clic
// qu'elle arrête est noté « bloqué »). Un double clic = deux clics sur le même bouton, donc avec le même data-roll ;
// ctx.attendu (même valeur pour les deux clics) sert seulement aux invariants. Si l'interface change encore
// (sélecteurs, identifiants de champs), c'est ICI et seulement ici qu'il faut l'adapter.
// =====================================================================================================================
function ouvrirFenetre(app, ouverture, champs){
  app.eng.run(ouverture);
  if(!app.doc.trouver('mOk')) return false;
  for(const [id, v] of Object.entries(champs || {})){
    const el = app.doc.trouver(id);
    if(!el) return false;
    el.value = String(v);
  }
  return true;
}
const cliquerOk = (app, ctx) => { const r = app.doc.cliquer('mOk'); ctx.clic = r.clic; return r.promesse; };
// L'utilisateur se place sur un onglet (clic sur le vrai onglet ; à défaut, comme le ferait ce clic).
function allerOnglet(app, onglet){
  if(app.eng.run('activeTab') === onglet) return true;
  const r = app.doc.cliquer(`.tab[data-tab="${onglet}"]`);
  return r.clic === 'ok' && app.eng.run('activeTab') === onglet;
}
const cliquerBouton = (app, ctx, sel) => { const r = app.doc.cliquer(sel); ctx.clic = r.clic; return r.promesse; };
const ACTIONS = {
  acheter: {
    preparer: (app, p) => ouvrirFenetre(app, `modalBuySellShares('buy')`, { mTradeCompany: p.societeId, mTradeUnit: 'dollars', mTradeAmount: p.montant }),
    cliquer: (app, p, ctx) => cliquerOk(app, ctx),
  },
  vendre: {
    preparer: (app, p) => ouvrirFenetre(app, `modalBuySellShares('sell')`, { mTradeCompany: p.societeId, mTradeUnit: 'dollars', mTradeAmount: p.montant }),
    cliquer: (app, p, ctx) => cliquerOk(app, ctx),
  },
  investirBons: {
    preparer: (app, p) => ouvrirFenetre(app, `modalBonds('invest')`, { mBondAmount: p.montant }),
    cliquer: (app, p, ctx) => cliquerOk(app, ctx),
  },
  retirerBons: {
    preparer: (app, p) => ouvrirFenetre(app, `modalBonds('withdraw')`, { mBondAmount: p.montant }),
    cliquer: (app, p, ctx) => cliquerOk(app, ctx),
  },
  // Bouton « Tour Terminé » de l'onglet Entreprise ([data-mark-ready], écouteur posé par bindTabEvents).
  tourTermine: {
    preparer: (app) => allerOnglet(app, 'entreprise'),
    cliquer: (app, p, ctx) => { if(ctx.attendu === undefined) ctx.attendu = lancerAffiche(app); return cliquerBouton(app, ctx, `[data-mark-ready="${societeDe(app)}"]`); },
  },
  // Bouton « Annuler Tour Terminé » ([data-cancel-ready]).
  annulerTour: {
    preparer: (app) => allerOnglet(app, 'entreprise'),
    cliquer: (app, p, ctx) => { if(ctx.attendu === undefined) ctx.attendu = lancerAffiche(app); return cliquerBouton(app, ctx, `[data-cancel-ready="${societeDe(app)}"]`); },
  },
  // Onglet Admin : bouton « Forcer le prochain tour » (#forceNextTurnBtn), puis confirmation dans la fenêtre.
  forcerTour: {
    preparer: (app) => allerOnglet(app, 'admin') && app.doc.cliquer('forceNextTurnBtn').clic === 'ok' && !!app.doc.trouver('mOk'),
    cliquer: (app, p, ctx) => { if(ctx.attendu === undefined) ctx.attendu = lancerAffiche(app); return cliquerOk(app, ctx); },
  },
  // Action admin simple (attemptActionWithRetry direct) : champ #mHousesAvail puis bouton #setHousesBtn.
  maisons: {
    preparer: (app, p) => { if(!allerOnglet(app, 'admin')) return false; const el = app.doc.trouver('mHousesAvail'); if(!el) return false; el.value = String(p.n); return true; },
    cliquer: (app, p, ctx) => cliquerBouton(app, ctx, 'setHousesBtn'),
  },
};
const ACTIONS_DE_TOUR = new Set(['tourTermine', 'annulerTour']);

// =====================================================================================================================
// Pilote : chaque appareil exécute son plan d'actions l'une après l'autre (un humain attend le résultat avant de
// recliquer), les appareils entre eux sont concurrents. Une action « double » = deux clics sans attendre.
// =====================================================================================================================
function nouveauContexte(env, app, type, numeroClic){
  const k = ++env.compteurActions;
  const ctx = { tag: `${app.nom}.${k}.${type}${numeroClic > 1 ? '.clic' + numeroClic : ''}`, type, appareil: app.nom, page: app.page,
    app, attendu: undefined, nAppels: 0, appels: {}, alertes: [], etat: 'en cours', erreur: null, clic: null, debutPas: env.R.stats.pas };
  env.contextes.push(ctx);
  return ctx;
}
async function executerAction(env, app, action){
  const def = ACTIONS[action.type];
  const ctx1 = nouveauContexte(env, app, action.type, 1);
  const suivre = (ctx, p) => Promise.resolve(p).then(() => { ctx.etat = 'terminé'; }, (e) => { ctx.etat = 'exception'; ctx.erreur = String(e && e.message || e); });
  const promesses = [];
  await als.run(ctx1, async () => {
    let pret;
    try{ pret = def.preparer(app, action.params || {}); }
    catch(e){ ctx1.etat = 'exception'; ctx1.erreur = String(e && e.message || e); return; }
    if(!pret){ ctx1.etat = 'terminé'; ctx1.clic = 'impossible'; return; }
    // L'utilisateur lit, remplit et confirme : au moins 600 ms (un humain ne confirme pas une fenêtre en moins d'une
    // demi-seconde ; l'interface ignore d'ailleurs les clics d'action moins de 500 ms après l'ouverture d'une fenêtre).
    await env.R.delai(600 + env.R.entier(action.saisieMs === undefined ? 1500 : action.saisieMs));
    if(!app.vivant) return;
    promesses.push(suivre(ctx1, def.cliquer(app, action.params || {}, ctx1)));
    if(action.double){
      if(env.R.hasard() < 0.5) await env.R.delai(1 + env.R.entier(150));
      if(!app.vivant) return;
      const ctx2 = nouveauContexte(env, app, action.type, 2);
      ctx2.attendu = ctx1.attendu;      // même intention : l'utilisateur a double-cliqué en voyant le même tour
      promesses.push(als.run(ctx2, () => suivre(ctx2, def.cliquer(app, action.params || {}, ctx2))));
    }
    await Promise.all(promesses);
  });
  // L'utilisateur ferme ce qui reste ouvert (fenêtre d'erreur restée ouverte, récapitulatif de transaction…).
  if(app.vivant) app.eng.run('closeModal()');
}
function candidatsPilote(env){
  const c = [];
  for(const app of env.appareils){
    if(!app.vivant || app.occupe || !app.plan.length) continue;
    // Une page qui vient de s'ouvrir n'a pas de boutons tant que la partie n'est pas chargée.
    if(!app.pret && !(app.pret = !!app.eng.run('!!(state && gameCode)'))) continue;
    c.push(() => {
      app.occupe = true;
      const action = app.plan.shift();
      const p = executerAction(env, app, action)
        .then(() => env.R.delai(env.R.entier(action.reflexionMs === undefined ? 2000 : action.reflexionMs)))
        .finally(() => { app.occupe = false; app.enCours.delete(p); });
      app.enCours.add(p);
    });
  }
  for(const f of env.perturbations) { const g = f(env); if(g) c.push(g); }
  return c;
}

// Rechargement : la page de l'appareil est fermée en plein envoi (ce qui était parti peut arriver au serveur), puis
// une nouvelle page s'ouvre pour le même joueur (nouveau moteur, cache vide, init() → loadGame).
async function recharger(env, app){
  const arrives = env.R.fermer(app.client);
  app.vivant = false;
  env.evenements.push(`pas ${env.R.stats.pas} : rechargement de ${app.client.nom} (${arrives} message(s) en route arrivés au serveur)`);
  const neuf = await creerAppareil(env, app.nom, app.joueurId);
  neuf.plan = app.plan; app.plan = [];
  return neuf;
}

// =====================================================================================================================
// Mise en place d'un cas
// =====================================================================================================================
async function preparerCas(graine, variantes){
  const P = await partieInitiale();
  const R = new Reseau({ graine });
  let s = JSON.parse(P.raw);
  for(const v of [].concat(variantes)) s = VARIANTES[v](s);
  const raw = JSON.stringify(s);
  R.ecrireServeur(P.chemin, raw);
  const env = { R, code: P.code, chemin: P.chemin, ids: P.ids, appareils: [], contextes: [], compteurActions: 0, compteurPages: {},
    perturbations: [], evenements: [], initial: JSON.parse(raw) };
  const noms = ['Alice', 'Bob', 'Chloé'];
  for(let i = 0; i < noms.length; i++) await creerAppareil(env, noms[i], P.ids[i]);
  await R.pomper();
  for(const app of env.appareils){
    const vu = app.eng.json('{code: gameCode, moi: myPlayerId, ok: !!state}');
    if(vu.code !== P.code || vu.moi !== app.joueurId || !vu.ok) throw new Error(`Mise en place : ${app.nom} n'a pas chargé la partie (${JSON.stringify(vu)})`);
  }
  return env;
}
const appareil = (env, nom) => env.appareils.filter(a => a.vivant && a.nom === nom).pop();

async function derouler(env){
  await env.R.pomper({ extra: () => candidatsPilote(env) });
  // Retour au calme complet : fermer les fenêtres restées ouvertes (popups de résultats…) et laisser jouer la
  // resynchronisation périodique.
  for(const app of env.appareils) if(app.vivant) app.eng.run('closeModal()');
  await env.R.pomper();
}

// =====================================================================================================================
// Invariants
// =====================================================================================================================
const masse = (s) => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0)
  + s.players.reduce((t, p) => t + (p.cash || 0) + (p.cumInterestReceived || 0) - (p.cumInterestPaid || 0), 0);
function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function compter(liste, t){ return (liste || []).filter(m => m.t === t).length; }

function verifier(env){
  const V = [];
  const ajouter = (code, detail) => V.push({ code, detail });
  const rawServeur = env.R.valeur(env.chemin);
  const S = JSON.parse(rawServeur);
  const vivants = env.appareils.filter(a => a.vivant);
  const locaux = new Map(vivants.map(a => [a, etatDe(a)]));

  // 1) Actions : annoncée réussie → exactement une fois ; échouée / refusée → absente (serveur et mémoire) ;
  //    interrompue par un rechargement → au plus une fois ; jamais « en cours » sur un appareil vivant.
  for(const ctx of env.contextes){
    const vivant = ctx.app.vivant;
    if(ctx.etat === 'exception') ajouter('EXCEPTION', `${ctx.tag} : exception non rattrapée « ${ctx.erreur} »`);
    if(ctx.etat === 'en cours' && vivant) ajouter('NON_TERMINÉE', `${ctx.tag} : l'action n'a jamais rendu la main (appareil vivant)`);
    for(const [i, res] of Object.entries(ctx.appels)){
      const t = ctx.tag + '/' + i;
      const n = compter(S.__banc, t);
      const quoi = i === '1' ? ctx.tag : `${ctx.tag} (appel ${i} : ${i === '2' && ctx.type === 'tourTermine' ? 'lancer déclenché' : 'suite'})`;
      if(res === true){
        if(n === 0) ajouter('PERDUE', `${quoi} annoncée RÉUSSIE mais absente du serveur`);
        if(n > 1) ajouter('DOUBLÉE', `${quoi} annoncée réussie mais appliquée ${n} fois sur le serveur`);
      } else if(res === false || res === 'exception'){
        if(n > 0) ajouter('FANTÔME', `${quoi} annoncée en ÉCHEC (${ctx.alertes.slice(-1)[0] || 'sans message'}) mais présente ${n} fois sur le serveur`);
        if(vivant){
          const local = locaux.get(ctx.app);
          const nl = local ? compter(local.__banc, t) : 0;
          if(nl > 0) ajouter('FANTÔME_LOCAL', `${quoi} annoncée en échec mais présente dans la mémoire de ${ctx.app.client.nom}`);
        }
      } else if(res === 'incertaine'){
        // Annoncée « on ne sait pas si elle a été enregistrée » (serveur injoignable) : 0 ou 1 fois, jamais plus.
        if(n > 1) ajouter('DOUBLÉE', `${quoi} d'issue incertaine mais appliquée ${n} fois sur le serveur`);
      } else {                                                        // 'en cours' : interrompue
        if(vivant) continue;                                          // déjà signalée NON_TERMINÉE
        if(n > 1) ajouter('DOUBLÉE', `${quoi} interrompue par un rechargement mais appliquée ${n} fois`);
      }
    }
    // Action de tour appliquée à un autre lancer que celui affiché au clic.
    if(ACTIONS_DE_TOUR.has(ctx.type) && ctx.attendu !== undefined){
      for(const m of (S.__banc || []).filter(m => m.t === ctx.tag + '/1')){
        if(m.r !== ctx.attendu) ajouter('TOUR_DÉCALÉ', `${ctx.tag} cliqué au lancer ${ctx.attendu} mais appliqué au lancer ${m.r} (l'entreprise est marquée pour un autre tour)`);
      }
    }
  }
  // 2) Lancers : chaque lancer enregistré correspond au tour affiché au clic, jamais après la fin de partie ;
  //    rollCount n'avance que par ces lancers.
  const lancers = S.__lancers || [];
  for(const L of lancers){
    if(L.fin) ajouter('LANCER_APRÈS_FIN', `lancer ${L.de}→${L.de + 1} (${L.t}) joué alors que la partie était déjà terminée`);
    if(L.att !== null && L.att !== undefined && L.de !== L.att) ajouter('LANCER_EN_TROP', `lancer ${L.de}→${L.de + 1} (${L.t}) déclenché pour le tour ${L.att} : rollCount avance deux fois pour un même tour`);
  }
  const avance = S.gameClock.rollCount - env.initial.gameClock.rollCount;
  if(avance !== lancers.length) ajouter('HORLOGE', `rollCount a avancé de ${avance} mais ${lancers.length} lancer(s) sont enregistrés`);
  if(S.gameEndedReason && S.gameEndedReason.roll !== undefined && S.gameClock.rollCount > S.gameEndedReason.roll)
    ajouter('LANCER_APRÈS_FIN', `rollCount ${S.gameClock.rollCount} au-delà du lancer de fin de partie (${S.gameEndedReason.roll})`);
  // 3) Monnaie.
  const m0 = masse(env.initial);
  if(Math.abs(masse(S) - m0) > 1e-6) ajouter('MONNAIE', `serveur : masse monétaire ${masse(S).toFixed(6)} au lieu de ${m0.toFixed(6)}`);
  for(const [app, L] of locaux) if(L && Math.abs(masse(L) - m0) > 1e-6) ajouter('MONNAIE', `${app.client.nom} : masse monétaire ${masse(L).toFixed(6)} au lieu de ${m0.toFixed(6)}`);
  // 4) Convergence : lastSerialized = valeur du serveur, et état en mémoire = cette valeur passée par migrateState
  //    (normalisation locale faite à chaque chargement, qui peut compléter des champs absents de la valeur brute).
  for(const [app, L] of locaux){
    const ls = app.eng.run('lastSerialized');
    if(ls !== rawServeur){ ajouter('DIVERGENCE', `${app.client.nom} : lastSerialized (v${JSON.parse(ls || '{}').version}) ≠ serveur (v${S.version})`); continue; }
    const M = app.eng.json(`(function(){ const s = JSON.parse(lastSerialized); migrateState(s); return s; })()`);
    if(canon(L) !== canon(M)){
      const diff = Object.keys(Object.assign({}, M, L)).filter(k => canon(M[k]) !== canon(L[k]));
      ajouter('DIVERGENCE', `${app.client.nom} : l'état en mémoire diffère de la valeur enregistrée (champs : ${diff.join(', ')})`);
    }
  }
  // 5) Exceptions dans les rappels des moteurs.
  for(const e of env.R.erreursEcouteurs) ajouter('EXCEPTION', e.split('\n')[0]);
  return V;
}

// =====================================================================================================================
// Génération des plans
// =====================================================================================================================
function planAleatoire(env, nom, n, { doubles = 0 } = {}){
  const R = env.R;
  const autres = env.initial.companies.filter(c => c.name !== 'Co ' + nom).map(c => c.id);
  const types = nom === 'Alice'
    ? ['acheter', 'acheter', 'vendre', 'investirBons', 'retirerBons', 'tourTermine', 'tourTermine', 'annulerTour', 'forcerTour', 'maisons']
    : ['acheter', 'acheter', 'vendre', 'investirBons', 'retirerBons', 'tourTermine', 'tourTermine', 'annulerTour'];
  const plan = [];
  for(let i = 0; i < n; i++){
    const type = R.choisir(types);
    const params = { societeId: R.choisir(autres), montant: (1 + R.entier(30)) / 10, n: R.entier(20) };
    plan.push({ type, params, double: R.hasard() < doubles });
  }
  return plan;
}

// =====================================================================================================================
// Scénarios
// =====================================================================================================================
const SCENARIOS = [
  { code: 'S1', titre: 'Actions concurrentes aléatoires de trois joueurs', graines: [11, 12, 13, 14, 15, 16], variante: 'base',
    plan(env){ for(const nom of ['Alice', 'Bob', 'Chloé']) appareil(env, nom).plan = planAleatoire(env, nom, 7); } },
  { code: 'S2a', titre: 'Dernier « Tour Terminé » contre « Forcer le tour »', graines: [21, 22, 23, 24, 25, 26, 27, 28], variante: 'pretsSaufBob',
    plan(env){
      appareil(env, 'Bob').plan = [{ type: 'tourTermine', saisieMs: 300 }];
      appareil(env, 'Alice').plan = [{ type: 'forcerTour', saisieMs: 300 }];
    } },
  { code: 'S2b', titre: 'Lancer contre fin de partie (le prochain lancer termine la partie)', graines: [31, 32, 33, 34, 35, 36, 37, 38], variante: ['pretsSaufBob', 'finAuProchainLancer'],
    plan(env){
      appareil(env, 'Bob').plan = [{ type: 'tourTermine', saisieMs: 300 }];
      appareil(env, 'Alice').plan = [{ type: 'forcerTour', saisieMs: 300 }];
    } },
  { code: 'S3', titre: 'Échecs réseau pendant les sauvegardes (refus du serveur, coupures)', graines: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50], variante: 'base',
    plan(env){
      for(const nom of ['Alice', 'Bob', 'Chloé']) appareil(env, nom).plan = planAleatoire(env, nom, 6);
      let budget = 6;
      env.perturbations.push((e) => {
        if(budget <= 0) return null;
        // Surtout pendant qu'une transaction est en vol (c'est là qu'une panne a des conséquences), parfois au repos.
        const enVol = e.appareils.filter(a => a.vivant && a.client.connecte && a.client.requetes.some(q => q.type === 'tx'));
        const cibles = enVol.length && e.R.hasard() < 0.8 ? enVol : e.appareils.filter(a => a.vivant && a.client.connecte);
        if(!cibles.length || e.R.hasard() > (enVol.length ? 0.25 : 0.02)) return null;
        const cible = e.R.choisir(cibles);
        return () => {
          budget--;
          if(e.R.hasard() < 0.5){
            const n = 1 + e.R.entier(7);
            e.R.echouerTransactions(cible.client, n);
            e.evenements.push(`pas ${e.R.stats.pas} : le serveur refusera les ${n} prochaines transactions de ${cible.client.nom}`);
          } else {
            const d = 100 + e.R.entier(3000);
            e.R.couper(cible.client, d);
            e.evenements.push(`pas ${e.R.stats.pas} : coupure réseau de ${cible.client.nom} pendant ${d} ms`);
          }
        };
      });
    } },
  { code: 'S3b', titre: 'Accusé de réception perdu : la connexion tombe juste après l’écriture sur le serveur', graines: [81, 82, 83], variante: 'base',
    plan(env){
      appareil(env, 'Alice').plan = [{ type: 'investirBons', params: { montant: 1.5 } }];
      appareil(env, 'Bob').plan = [{ type: 'acheter', params: { societeId: env.initial.companies.find(c => c.name === 'Co Alice').id, montant: 0.7 }, saisieMs: 3000 }];
      // La première transaction écrite d'Alice perd son accusé : la connexion tombe juste après l'écriture.
      env.R.couperApresProchaineEcriture(appareil(env, 'Alice').client, 500 + env.R.entier(2000));
      env.evenements.push('la connexion d’Alice tombera juste après l’écriture de sa prochaine transaction');
    } },
  { code: 'S4', titre: 'Rechargement d’un appareil en plein envoi', graines: [51, 52, 53, 54, 55, 56, 57, 58], variante: 'base',
    plan(env){
      for(const nom of ['Alice', 'Bob', 'Chloé']) appareil(env, nom).plan = planAleatoire(env, nom, 5);
      let budget = 3;
      env.perturbations.push((e) => {
        if(budget <= 0) return null;
        // Un appareil dont une transaction est partie sans réponse : on recharge sa page à ce moment-là.
        const cibles = e.appareils.filter(a => a.vivant && a.client.requetes.some(q => q.type === 'tx'));
        if(!cibles.length || e.R.hasard() > 0.3) return null;
        const cible = e.R.choisir(cibles);
        return () => { budget--; recharger(e, cible); };
      });
    } },
  { code: 'S5a', titre: 'Doubles clics (même action lancée deux fois sans attendre)', graines: [61, 62, 63, 64, 65, 66], variante: 'base',
    plan(env){ for(const nom of ['Alice', 'Bob', 'Chloé']) appareil(env, nom).plan = planAleatoire(env, nom, 5, { doubles: 0.7 }); } },
  { code: 'S5b', titre: 'Double clic sur « Tour Terminé » de la seule entreprise qui lance (bogue 59)', graines: [71, 72, 73, 74], variante: 'aliceSeuleLance',
    plan(env){ appareil(env, 'Alice').plan = [{ type: 'tourTermine', double: true, saisieMs: 0 }]; } },
];

// =====================================================================================================================
// Exécution
// =====================================================================================================================
const AUDIT = {
  PERDUE: '44', FANTÔME: '44 (ou accusé perdu, voir S3b)', FANTÔME_LOCAL: '44', DOUBLÉE: '44 / 59', LANCER_EN_TROP: '17 / 59', LANCER_APRÈS_FIN: '17',
  TOUR_DÉCALÉ: '17 / 59', DIVERGENCE: '(synchro)', MONNAIE: '(monnaie)', NON_TERMINÉE: '(blocage)', EXCEPTION: '(exception)', HORLOGE: '(horloge)',
};
function graines(sc){
  if(GRAINE_SEULE !== null) return [GRAINE_SEULE];
  if(NB_GRAINES === null) return sc.graines;
  const g = sc.graines.slice(0, NB_GRAINES);
  for(let i = g.length; i < NB_GRAINES; i++) g.push(sc.graines[0] * 1000 + i);
  return g;
}

(async () => {
  const debut = Date.now();
  const echecs = [];
  let cas = 0, verifications = 0;
  for(const sc of SCENARIOS){
    if(FILTRE && !sc.code.startsWith(FILTRE)) continue;
    console.log(`${sc.code}. ${sc.titre}`);
    for(const g of graines(sc)){
      cas++;
      let env, V;
      try{
        env = await preparerCas(g, sc.variante);
        sc.plan(env);
        await derouler(env);
        V = verifier(env);
      }catch(e){
        V = [{ code: 'EXCEPTION', detail: 'le banc lui-même a levé : ' + String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') }];
      }
      verifications += 1;
      const S = env ? JSON.parse(env.R.valeur(env.chemin)) : null;
      const bilan = env ? `${env.contextes.length} clic(s), ${S ? (S.__lancers || []).length : '?'} lancer(s), ${env.R.stats.pas} pas, ${env.R.stats.transactions} transactions (${env.R.stats.ecritures} écrites, ${env.R.stats.perimes} périmées, ${env.R.stats.abandonsLocaux} abandons sur cache, ${env.R.stats.refus} refusées), ${env.R.stats.coupures} coupure(s), ${env.R.stats.fermetures} rechargement(s)` : '';
      if(!V.length && !process.env.SYNC_TOUT){ console.log(`  OK   graine ${g} — ${bilan}`); continue; }
      const codes = [...new Set(V.map(v => v.code))];
      console.log(`  ÉCHEC graine ${g} — ${codes.join(', ')} — ${bilan}`);
      const vus = new Set();
      for(const v of V){ const k = v.code + v.detail; if(vus.has(k)) continue; vus.add(k); console.log(`     · [${v.code} → audit ${AUDIT[v.code] || '?'}] ${v.detail}`); }
      if(VERBEUX && env){
        console.log('     --- événements ---'); env.evenements.forEach(e => console.log('     ' + e));
        console.log('     --- actions ---');
        env.contextes.forEach(c => console.log(`     ${c.tag} : clic ${c.clic}, état ${c.etat}, appels ${JSON.stringify(c.appels)}, attendu ${c.attendu}, alertes ${JSON.stringify(c.alertes.map(a => a.slice(0, 90)))}`));
        console.log('     --- journal réseau (fin) ---'); env.R.journal.slice(-80).forEach(l => console.log('     ' + l));
      }
      echecs.push({ sc: sc.code, g, codes });
    }
  }
  if(exceptionsNonRattrapees.length){
    console.log(`\n${exceptionsNonRattrapees.length} rejet(s) de promesse non rattrapé(s) dans les moteurs, par exemple : ${exceptionsNonRattrapees[0]}`);
  }
  const duree = ((Date.now() - debut) / 1000).toFixed(1);
  if(echecs.length){
    console.log(`\nRésumé : ${echecs.length} cas en échec sur ${cas} (${duree} s) :`);
    const parCode = {};
    echecs.forEach(e => e.codes.forEach(c => { (parCode[c] = parCode[c] || []).push(`${e.sc}/${e.g}`); }));
    Object.entries(parCode).forEach(([c, l]) => console.log(`  ${c} (audit ${AUDIT[c] || '?'}) : ${l.join(' ')}`));
    console.log(`Reproduire un cas : SYNC_SCENARIO=<code> SYNC_GRAINE=<graine> SYNC_VERBEUX=1 node tests/section308-sync.test.js`);
    console.log(`${echecs.length} cas en échec sur ${cas} — invariants violés : ${Object.keys(parCode).join(', ')}`);
    process.exit(1);
  }
  console.log(`${cas} cas multi-appareils OK (${duree} s)`);
})().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });

