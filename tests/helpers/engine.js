// Banc d'essai partagé : charge TOUT le moteur d'index.html dans un vm Node, avec un faux DOM permissif et un
// window.storage en mémoire (la branche window.storage est prioritaire : aucun accès Firebase).
//
//   const { loadEngine } = require('./helpers/engine');
//   const eng = loadEngine();
//   await eng.newGame(['Alice', 'Bob'], ['dividende', 'garp']);   // crée la partie, les entreprises, finance les IPO
//   eng.run(`state.players[0].cash`);                               // évalue du code DANS le contexte du moteur
//   eng.run(`injectStockCube = function(){ return 0; }`);           // remplace une fonction du moteur par un espion
//   eng.cashTotal();                                                // banque + entreprises + joueurs (hors bons et séquestres)
//
// Options : loadEngine({ firebase }) installe un faux SDK Firebase et retire window.storage, pour tester la branche
// Firebase (saveGame, transactions). loadEngine({ transform }) modifie le code du moteur avant chargement
// (contre-épreuve). Les top-level `let` du moteur (state, gameCode…) sont visibles par run().
const fs = require('fs'), path = require('path'), vm = require('vm');

function engineSource(){
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const OPEN = '\n<script>\n', CLOSE = '\n</script>';
  const a = html.lastIndexOf(OPEN), b = html.lastIndexOf(CLOSE);
  if(a < 0 || b < a) throw new Error('Script principal introuvable dans index.html');
  return html.slice(a + OPEN.length, b);
}

function fakeNode(){
  const fn = function(){ return fakeNode(); };
  return new Proxy(fn, {
    get(t, k){
      if(k === Symbol.toPrimitive) return () => '';
      if(k === 'style' || k === 'dataset' || k === 'classList') return t[k] || (t[k] = new Proxy({}, {get:(o,kk)=> (kk in o ? o[kk] : (()=>false)), set:(o,kk,v)=>{o[kk]=v;return true;}}));
      if(k === 'value' || k === 'textContent' || k === 'innerHTML') return t[k] || '';
      if(k === 'checked') return !!t[k];
      if(k === 'length') return 0;
      if(k in t) return t[k];
      return fakeNode();
    },
    set(t, k, v){ t[k] = v; return true; },
    apply(){ return fakeNode(); },
  });
}

function loadEngine(opts = {}){
  const mem = new Map();
  const sandbox = {
    console, Math, Date, JSON, Promise, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, Symbol,
    parseFloat, parseInt, isFinite, isNaN,
    setTimeout: (f)=>0, clearTimeout: ()=>{}, setInterval: ()=>0, clearInterval: ()=>{},
    alert: ()=>{}, confirm: ()=>true, prompt: ()=>null,
    localStorage: { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
    navigator: { clipboard: { writeText: async()=>{} } },
    location: { hash:'', search:'', href:'http://localhost/' },
    requestAnimationFrame: ()=>0,
  };
  sandbox.window = sandbox;
  if(opts.firebase){
    sandbox.firebase = opts.firebase;
  } else {
    sandbox.window.storage = {
      get: async (k)=> mem.has(k) ? {value: mem.get(k)} : null,
      set: async (k, v)=> { mem.set(k, v); return true; },
      delete: async (k)=> { mem.delete(k); return true; },
    };
  }
  sandbox.document = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'querySelectorAll' ? (()=>[]) : (()=>fakeNode()))) });
  vm.createContext(sandbox);
  // opts.transform(src) permet une contre-épreuve : recharger le moteur avec un ancien comportement réintroduit,
  // pour prouver qu'un test détecte bien la régression qu'il est censé verrouiller.
  let src = engineSource();
  if(opts.transform){
    const before = src;
    src = opts.transform(src);
    if(src === before) throw new Error('Contre-épreuve : la transformation n’a rien modifié (motif introuvable)');
  }
  vm.runInContext(src, sandbox, {filename: 'index.html#script'});
  const run = (code) => vm.runInContext(code, sandbox);
  const json = (code) => JSON.parse(run(`JSON.stringify(${code})`));

  async function newGame(names = ['Alice', 'Bob'], types = ['garp', 'garp'], startCash = 50, bankCash = 1000, settings = {}){
    await run(`createGame(${JSON.stringify(names)}, ${startCash}, ${bankCash}, 'M$', ${JSON.stringify(settings)}, [])`);
    const ids = json(`state.players.map(p=>p.id)`);
    for(let i = 0; i < types.length && i < ids.length; i++){
      if(!types[i]) continue;
      await run(`createCompany(${JSON.stringify(ids[i])}, ${JSON.stringify('Co ' + names[i])}, '', ${JSON.stringify(types[i])}, null, null, null)`);
    }
    run(`state.companies.forEach(c=>applyCompanyIpoFunding(c))`);
    return ids;
  }

  const cashTotal = () => run(`(state.bank.cash||0) + state.companies.reduce((s,c)=>s+(c.cash||0),0) + state.players.reduce((s,p)=>s+(p.cash||0),0)`);

  return { sandbox, run, json, newGame, cashTotal, mem };
}

// Petite aide d'assertion lisible en français.
function check(cond, msg){ if(!cond) throw new Error('ÉCHEC : ' + msg); console.log('  OK', msg); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

module.exports = { loadEngine, check, near, engineSource };
