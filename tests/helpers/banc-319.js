// Section 319 — petit banc commun aux tests section319-*.test.js : moteurs complets d'index.html (un vm par appareil)
// reliés au faux serveur du dépôt (tests/helpers/fake-firebase.js), comme une vraie page : init() lit « lastcode » et
// « mychar » dans le localStorage de l'appareil, loadGame() lit la partie sur le serveur et pose l'écoute temps réel.
// Repris du banc de la relecture du 2026-11-11 (docs/audit/relecture-synchro-2026-11-11.md, annexe A).
//
//   const { Reseau, partie, appareil, serveur, caisse, ecouler, INVESTIR } = require('./helpers/banc-319');
//   const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);          // partie créée en mode local, puis copiée
//   const R = new Reseau({ graine: 7 }); R.ecrireServeur(P.chemin, P.raw);
//   const A = appareil(R, P, 'Alice', P.ids[0], { transform, dom: true });   // dom : mini-DOM (vrais écouteurs, bandeaux)
//   await R.pomper();
//   const res = await R.attendrePromesse(A.eng.run(INVESTIR(1)));          // « Investir 1 M$ dans les bons »
const { loadEngine } = require('./engine');
const { Reseau } = require('./fake-firebase');
const { creerDocument } = require('./fake-dom');

function fausseDate(maintenant){
  return class DateVirtuelle extends Date {
    constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); }
    static now(){ return maintenant(); }
  };
}
async function partie(noms, types, modifier){
  const eng = loadEngine();
  const ids = await eng.newGame(noms, types);
  if(modifier) eng.run('(' + modifier.toString() + ')(state)');
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  return { code, ids, raw: eng.mem.get('game:' + code), chemin: 'data/game:' + code };
}
// opts : transform (contre-épreuve), dom (mini-DOM), sansPartie (page sans partie mémorisée), avant(client) (réglage
// du faux SDK AVANT le chargement de la page), globals. Avec dom, evenementDocument('visibilitychange') appelle les
// écouteurs que la page a posés sur le document pour cet événement (le mini-DOM ne déclenche que les clics).
function appareil(R, P, nom, joueurId, opts = {}){
  const client = R.creerClient(nom);
  if(opts.avant) opts.avant(client);
  const ls = new Map(opts.sansPartie ? [] : [['mb:lastcode', P.code], ['mb:mychar:' + P.code, joueurId]]);
  const alertes = [];
  const doc = opts.dom ? creerDocument() : null;
  const ecouteursDocument = [];
  if(doc){
    const poser = doc.addEventListener;
    doc.addEventListener = (type, fn, o) => { ecouteursDocument.push({ type, fn }); return poser.call(doc, type, fn, o); };
  }
  const globals = Object.assign({
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    Date: fausseDate(() => R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alertes.push(String(m)), confirm: () => true,
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc-319.invalid' },
  }, doc ? { document: doc } : {}, opts.globals || {});
  const eng = loadEngine({ firebase: client.firebase, transform: opts.transform, globals });
  const evenementDocument = type => { ecouteursDocument.filter(e => e.type === type).forEach(e => e.fn({ type, target: doc })); };
  return { nom, client, eng, alertes, ls, doc, evenementDocument };
}
const serveur = (R, P) => JSON.parse(R.valeur(P.chemin));
// Masse monétaire : banque + entreprises + joueurs (un achat de bons verse l'encaisse du joueur à la banque).
const caisse = s => (s.bank.cash || 0) + s.companies.reduce((a, c) => a + (c.cash || 0), 0) + s.players.reduce((a, p) => a + (p.cash || 0), 0);
// Laisse passer `ms` de temps virtuel SANS sauter par-dessus les minuteries périodiques des pages (pomper() saute
// jusqu'à la prochaine minuterie ponctuelle) : tout ce qui est dû est exécuté, par tranches d'au plus 250 ms.
async function ecouler(R, ms){
  const fin = R.temps + ms;
  await new Promise(r => setImmediate(r));
  while(R.temps < fin){
    if(R.candidats().length) await R.pas();
    else R.temps = Math.min(fin, R.temps + 250);
  }
  while(R.candidats().length) await R.pas();
}
const micro = () => new Promise(r => setImmediate(r));
// La même applyFn que la fenêtre « Investir dans les bons » (modalBonds) : elle relit myPlayerId à chaque application.
const INVESTIR = (m, libelle = 'Investir') => `attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); if(!pl) return {ok:false, error:'Joueur introuvable.'}; const r = buyBonds(pl, ${m}); if(!r.ok) return r; log(pl.name+' investit ${m} dans ses bons', r.entries); return r; }, {label:${JSON.stringify(libelle)}})`;

// Compteur de vérifications et scénarios (même présentation que les autres tests multi-appareils).
function compteur(){
  const T = { n: 0, echecs: [] };
  T.ok = (cond, msg) => { if(!cond) throw new Error('ÉCHEC : ' + msg); console.log('  OK', msg); T.n++; };
  T.scenario = async (titre, fn) => {
    console.log(titre);
    try{ await fn(); }
    catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); T.echecs.push(titre.split(' ')[0] + ' — ' + m); }
  };
  T.fin = (nom) => {
    console.log(T.echecs.length ? `\nÉCHECS (${T.echecs.length}) :\n- ` + T.echecs.join('\n- ') : '');
    console.log(`${T.echecs.length ? 'ÉCHEC' : 'OK'} : ${nom} — ${T.n} vérifications, ${T.echecs.length} scénario(s) en échec`);
    process.exit(T.echecs.length ? 1 : 0);
  };
  return T;
}
// Contre-épreuve : remplace `de` par `vers` dans le code du moteur (erreur si le motif est introuvable).
const sub = (de, vers) => (src) => {
  if(!src.includes(de)) throw new Error('Contre-épreuve : motif introuvable : ' + de.slice(0, 80));
  return src.split(de).join(vers);
};
const enchainer = (...fs) => (src) => fs.reduce((s, f) => f(s), src);

module.exports = { Reseau, loadEngine, partie, appareil, serveur, caisse, ecouler, micro, INVESTIR, compteur, sub, enchainer };
