// Test — section 306 : emprunt sans cube rouge, baisse du dividende récurrent = 20 rouges,
// ratio de distribution > 1 = 5 cubes rougis — règle retirée par la section 321 (le scénario 3 prouve qu'aucun cube ne rougit).
// Charge TOUT le script d'index.html dans un vm avec un faux DOM et un window.storage en mémoire
// (aucun accès Firebase : la branche window.storage est prise en priorité).
const fs = require('fs'), path = require('path'), vm = require('vm');
// Extrait le dernier <script> d'index.html (le moteur), sans dépendance externe.
// Lancer depuis la racine du dépôt :  node tests/section306.test.js
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const OPEN = '\n<script>\n', CLOSE = '\n</script>';
const lastOpen = html.lastIndexOf(OPEN);
const lastClose = html.lastIndexOf(CLOSE);
if(lastOpen < 0 || lastClose < lastOpen) throw new Error('Script principal introuvable dans index.html');
const src = html.slice(lastOpen + OPEN.length, lastClose);

// Faux DOM permissif : tout accès renvoie un objet qui accepte n'importe quoi.
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
const mem = new Map();
const logs = [];
const sandbox = {
  console, Math, Date, JSON, Promise, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, Symbol, parseFloat, parseInt, isFinite, isNaN,
  setTimeout: (f)=>0, clearTimeout: ()=>{}, setInterval: ()=>0, clearInterval: ()=>{},
  alert: ()=>{}, confirm: ()=>true, prompt: ()=>null,
  localStorage: { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
  navigator: { clipboard: { writeText: async()=>{} } },
  location: { hash:'', search:'', href:'http://localhost/' },
  requestAnimationFrame: ()=>0,
};
sandbox.window = sandbox;
sandbox.window.storage = {
  get: async (k)=> mem.has(k) ? {value: mem.get(k)} : null,
  set: async (k, v)=> { mem.set(k, v); return true; },
  delete: async (k)=> { mem.delete(k); return true; },
};
sandbox.document = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'querySelectorAll' ? (()=>[]) : (()=>fakeNode()))) });
vm.createContext(sandbox);
vm.runInContext(src, sandbox, {filename: 'script_main.js'});

const run = (code) => vm.runInContext(code, sandbox);

(async () => {
  let n = 0; const ok = (m) => { n++; console.log('  OK', m); };
  const assert = require('assert');

  // ---------- Mise en place : partie locale à deux joueurs ----------
  await run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
  const ids = JSON.parse(run(`JSON.stringify(state.players.map(p=>p.id))`));
  await run(`createCompany(${JSON.stringify(ids[0])}, 'Alpha Div', '', 'dividende', null, null, null)`);
  await run(`createCompany(${JSON.stringify(ids[1])}, 'Beta Garp', '', 'garp', null, null, null)`);
  run(`state.companies.forEach(c=>applyCompanyIpoFunding(c))`);
  const nCo = run(`state.companies.length`);
  assert.strictEqual(nCo, 2, 'deux entreprises créées');
  run(`globalThis.A = state.companies.find(c=>c.type==='dividende'); globalThis.B = state.companies.find(c=>c.type==='garp');`);
  assert.ok(run(`A.dividendBenchmarkPerShare>0`), 'la Dividendes a une référence de fondation');
  ok('partie créée : Alpha Div (Dividendes, référence ' + run(`A.dividendBenchmarkPerShare.toFixed(6)`) + ' M$/part) et Beta Garp');

  // ---------- 1. Emprunt : aucun cube rouge ----------
  console.log('1. Demande d’emprunt acceptée');
  run(`globalThis.__inj = []; globalThis.__realInject = injectStockCube; injectStockCube = function(co,color,a,b){ __inj.push({co:co.name,color,a,b}); return __realInject(co,color,a,b); };`);
  run(`state.gameClock.rollCount = 0;`); // frontière de semestre : marché ouvert
  const redBefore = run(`A.stockReserve.red`);
  const cashBefore = run(`A.cash`);
  const loanOk = await run(`issueLoan(${JSON.stringify(ids[1])}, A.id, 2, 0.2, 1.5, false, {})`);
  assert.ok(loanOk, 'le prêt est accepté');
  assert.ok(Math.abs(run(`A.cash`) - cashBefore - 2) < 1e-9, 'la trésorerie reçoit 2 M$');
  const redInj = JSON.parse(run(`JSON.stringify(__inj.filter(x=>x.co==='Alpha Div' && x.color==='red'))`));
  assert.deepStrictEqual(redInj, [], 'aucune injection rouge : ' + JSON.stringify(redInj));
  assert.strictEqual(run(`A.stockReserve.red`), redBefore, 'sac fondamental rouge inchangé');
  ok('prêt de 2 M$ créé, trésorerie +2 M$, 0 cube rouge injecté (' + redBefore + ' rouges avant et après)');
  run(`injectStockCube = __realInject;`);

  // ---------- 2. Jauge du dividende récurrent ----------
  console.log('2. Jauge du dividende récurrent');
  const gauge = (pct, start) => JSON.parse(run(`(function(){
    A.typeReserve = ${JSON.stringify(start)};
    const ref = A.dividendBenchmarkPerShare;
    const tier = applyDividendGaugeTier(A, ref * ${pct} * A.sharesIssued);
    const out = {tier, tp: Object.assign({}, A.typeReserve), refRatio: A.dividendBenchmarkPerShare/ref};
    A.dividendBenchmarkPerShare = ref; // remise à la référence pour le cas suivant
    return JSON.stringify(out);
  })()`));
  const start = {green:8, red:2, white:10};
  let r = gauge(0.25, start);
  assert.strictEqual(r.tier, 1); assert.deepStrictEqual(r.tp, {green:0, red:20, white:0});
  assert.ok(Math.abs(r.refRatio - 0.25) < 1e-9, 'référence abaissée au nouveau niveau');
  ok('palier 1 (25 % de la référence) : sac type 8V/2R/10B -> 0V/20R/0B, référence abaissée');
  r = gauge(0.70, start);
  assert.strictEqual(r.tier, 2); assert.deepStrictEqual(r.tp, {green:0, red:20, white:0});
  ok('palier 2 (70 %) : sac type -> 20 rouges');
  r = gauge(0.89, start);
  assert.strictEqual(r.tier, 2); assert.deepStrictEqual(r.tp, {green:0, red:20, white:0});
  ok('baisse de 11 %, juste hors tolérance : 20 rouges');
  r = gauge(0.95, start);
  assert.strictEqual(r.tier, 3); assert.deepStrictEqual(r.tp, start);
  assert.ok(Math.abs(r.refRatio - 1) < 1e-9);
  ok('baisse de 5 %, dans la tolérance de 10 % : palier 3, rien ne bouge');
  r = gauge(1.20, start);
  assert.strictEqual(r.tier, 4); assert.deepStrictEqual(r.tp, {green:11, red:0, white:9});
  ok('hausse de 20 % : +3 verts comme avant (2 rouges convertis, puis 1 blanc)');
  r = gauge(2.00, start);
  assert.strictEqual(r.tier, 7); assert.deepStrictEqual(r.tp, {green:20, red:0, white:0});
  ok('hausse maximale : +12 verts, plafonné à 20');

  // ---------- 3. Ratio de distribution > 1 à la clôture du semestre : plus aucun cube rougi (section 321) ----------
  console.log('3. Ratio de distribution à la clôture du semestre');
  run(`globalThis.__realIS = incomeStatementFor; globalThis.__realDiv = dividendPaidInSemester;
       globalThis.__ovIS = {}; globalThis.__ovDiv = {};
       incomeStatementFor = function(id, sem){ const r = __realIS(id, sem); if(__ovIS[id]!==undefined) r.netIncome = __ovIS[id]; return r; };
       dividendPaidInSemester = function(id, sem){ return __ovDiv[id]!==undefined ? __ovDiv[id] : __realDiv(id, sem); };
       // Section 315 — le ratio compte les dividendes réellement versés (dividendNetPaidInSemester) : même substitution.
       globalThis.__realNet = dividendNetPaidInSemester;
       dividendNetPaidInSemester = function(id, sem){ return __ovDiv[id]!==undefined ? __ovDiv[id] : __realNet(id, sem); };
       // Tirages neutralisés : ils ont lieu APRÈS les contrôles de semestre et blanchissent des cubes au hasard.
       drawStockCubes = function(){ return []; };
       resolveStockDraws = function(){ return {gameOver:false}; };`);
  const closeSemester = (netA, divA, startA, netB, divB, startB) => JSON.parse(run(`(function(){
    state.gameEndedReason = null;
    A.typeReserve = ${JSON.stringify(startA)}; B.typeReserve = ${JSON.stringify(startB)};
    __ovIS[A.id] = ${netA}; __ovDiv[A.id] = ${divA};
    __ovIS[B.id] = ${netB}; __ovDiv[B.id] = ${divB};
    A.dividendAutoPay = ${divA}>0;           // Section 315 — bogue 25 : un versement = le dividende récurrent (seul à protéger le sac type)
    state.gameClock.rollCount = 2;           // 2 -> 3 : fin du semestre 0, pas de fin d'année
    const nLog = state.log ? state.log.length : 0;
    advanceGameClock();
    const msgs = (state.log||[]).slice(0, Math.max(0,(state.log||[]).length - nLog)).concat((state.log||[]).slice(nLog)).map(e=>e.text||e.msg||e.message||String(e));
    return JSON.stringify({A: Object.assign({}, A.typeReserve), B: Object.assign({}, B.typeReserve),
      msg: msgs.filter(m=>/ratio de distribution/.test(m))});
  })()`));

  // Section 321 — décision de Julien : la règle « dividendes versés > bénéfice du semestre = 5 cubes du sac type rougis »
  // (sections 306 et 315) est retirée (« pour ne pas pénaliser 2 fois la même chose dans le sac TYPE du Dividende ») :
  // quel que soit le ratio, un versement récurrent laisse le sac type intact. Avant : 120 % -> 4V/6R/0B, etc.
  const cas = [
    ['ratio 120 %', 1.0, 1.2, {green:6, red:1, white:3}],
    ['ratio 80 %', 1.0, 0.8, {green:6, red:1, white:3}],
    ['ratio exactement 100 %', 1.0, 1.0, {green:6, red:1, white:3}],
    ['bénéfice négatif avec versement', -0.5, 0.3, {green:10, red:0, white:2}],
    ['ratio 500 %', 1.0, 5.0, {green:2, red:15, white:1}],
  ];
  for(const [label, net, div, startA] of cas){
    const c = closeSemester(net, div, startA, 1.0, div, {green:6, red:1, white:3});
    assert.deepStrictEqual(c.A, startA, label + ' : ' + JSON.stringify(c.A));
    assert.ok(c.msg.length === 0, 'aucun message « ratio de distribution » : ' + JSON.stringify(c.msg));
    ok(label + ' : sac type de la Dividendes inchangé ' + JSON.stringify(startA) + ' (section 321 : règle des 5 cubes retirée), aucun message');
  }
  // La GARP : même sac avec ou sans versement (elle n'a jamais été touchée par cette règle).
  const g1 = closeSemester(1.0, 1.2, {green:6, red:1, white:3}, 1.0, 1.2, {green:6, red:1, white:3});
  const g0 = closeSemester(1.0, 1.2, {green:6, red:1, white:3}, 1.0, 0, {green:6, red:1, white:3});
  assert.deepStrictEqual(g1.B, g0.B, 'GARP : même sac avec ratio 120 % ou sans dividende');
  ok('GARP : même sac avec ou sans versement (' + JSON.stringify(g1.B) + ')');

  const c = closeSemester(1.0, 0, {green:6, red:1, white:3}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:0, red:20, white:0});
  ok('aucun versement : règle existante inchangée, sac type à 20 rouges');

  // Somme des cubes du sac type toujours égale à 20
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error('ÉCHEC :', e && e.stack || e); process.exit(1); });
