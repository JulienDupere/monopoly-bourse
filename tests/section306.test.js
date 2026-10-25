// Test — section 306 : emprunt sans cube rouge, baisse du dividende récurrent = 20 rouges,
// ratio de distribution > 1 = 5 cubes rougis (blancs d'abord, puis verts).
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

  // ---------- 3. Ratio de distribution > 1 à la clôture du semestre ----------
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

  let c = closeSemester(1.0, 1.2, {green:6, red:1, white:3}, 1.0, 1.2, {green:6, red:1, white:3});
  assert.deepStrictEqual(c.A, {green:4, red:6, white:0}, 'Dividendes ratio 120 % : ' + JSON.stringify(c.A));
  assert.ok(c.msg.length === 1 && /Alpha Div/.test(c.msg[0]), 'un seul message, pour la Dividendes : ' + JSON.stringify(c.msg));
  // La GARP est rephotographiée chaque semestre : son sac doit être identique avec ou sans versement excessif.
  const cNoDiv = closeSemester(1.0, 1.2, {green:6, red:1, white:3}, 1.0, 0, {green:6, red:1, white:3});
  assert.deepStrictEqual(c.B, cNoDiv.B, 'GARP : même sac avec ratio 120 % ou sans dividende');
  ok('ratio 120 % : 6V/1R/3B -> 4V/6R/0B (3 blancs puis 2 verts) ; la GARP n’est pas touchée par la règle (sac ' + JSON.stringify(c.B) + ' dans les deux cas)');
  ok('journal : « ' + c.msg[0].slice(0, 110) + '… »');

  c = closeSemester(1.0, 0.8, {green:6, red:1, white:3}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:6, red:1, white:3});
  ok('ratio 80 % : sac type inchangé');

  c = closeSemester(1.0, 1.0, {green:6, red:1, white:3}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:6, red:1, white:3});
  ok('ratio exactement 100 % : inchangé (la règle exige strictement plus que 1)');

  c = closeSemester(-0.5, 0.3, {green:10, red:0, white:2}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:7, red:5, white:0});
  ok('bénéfice négatif avec versement : traité comme ratio > 1 -> 2 blancs puis 3 verts rougis');

  c = closeSemester(1.0, 5.0, {green:2, red:15, white:1}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:0, red:18, white:0});
  ok('moins de 5 cubes disponibles : seuls 1 blanc et 2 verts rougissent, rien n’est inventé');

  c = closeSemester(1.0, 0, {green:6, red:1, white:3}, 1.0, 0, {green:0, red:0, white:20});
  assert.deepStrictEqual(c.A, {green:0, red:20, white:0});
  ok('aucun versement : règle existante inchangée, sac type à 20 rouges');

  // Somme des cubes du sac type toujours égale à 20
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error('ÉCHEC :', e && e.stack || e); process.exit(1); });
