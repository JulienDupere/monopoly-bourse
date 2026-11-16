// Test — section 321, lot B (refonte, décision de Julien) : baisse du cours au versement d'un dividende selon les
// bénéfices non répartis (BNR), tout PAR ACTION. À chaque clôture de semestre, juste après les versements (annonces
// échues et récurrent) et avant les déclencheurs du sac fondamental et le tirage des cubes :
//   d = dividende par action versé à cette clôture ; ratio = d ÷ (BNR ÷ parts émises), plafonné à 1 (BNR ≤ 0 : 1) ;
//   baisse = d × ratio ; jamais sous le DOUBLE du plancher de fin de partie (dessous : rien), jamais de fin de partie.
// BNR = bénéfices nets du premier semestre de l'entreprise jusqu'au semestre qui se ferme inclus − dividendes ordinaires
// réellement versés des semestres d'avant − dividendes privilégiés réellement versés jusqu'à ce semestre inclus.
// Partie en cours au moment de la mise à jour : seulement à partir du semestre suivant. Aussi : cubes rouges des
// annonces symboliques (≤ 80 % des BNR : rien ; ≤ 100 % : 0 à 1 ; au-delà ou BNR ≤ 0 : 1 à 2) et règle des 5 cubes du
// sac type retirée.
// Contre-épreuves : chaque scénario est rejoué sur le moteur d'AVANT la section 321 (commit 5d1bf58, lu par git), puis
// sur des versions cassées exprès : elles doivent échouer.
// Lancer depuis la racine du dépôt :  node tests/section321-versement.test.js
const path = require('path');
const { execSync } = require('child_process');
const { loadEngine, near } = require('./helpers/engine');

const US = 1e-6;          // 1 $ en M$ (les cours sont tenus en M$ par action)
const BASE_COMMIT = '5d1bf58';

// ---------------------------------------------------------------------------------------------------------------
// Banc : partie à trois joueurs, hasard piloté (bas / haut / naturel), tirages des cubes neutres (le cours ne bouge que
// par la règle testée), bénéfice imposé (__ovIS, par id ou id:semestre), BNR imposés (__ovBNR, par id) ou réels.
function installModalDom(eng){
  const registry = new Map();
  const fallback = eng.sandbox.document.getElementById;
  eng.sandbox.document.getElementById = (id) => registry.has(id) ? registry.get(id) : fallback(id);
  return {
    reset(){ registry.clear(); },
    add(id, init = {}){
      const listeners = {};
      const base = Object.assign({
        id, value: '', checked: false, textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
        addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(){},
        async fire(type){ for(const fn of (listeners[type] || [])) await fn({ target: el }); },
      }, init);
      const el = new Proxy(base, { get(t, k){ return (k in t) ? t[k] : fallback(id)[k]; }, set(t, k, v){ t[k] = v; return true; } });
      registry.set(id, el);
      return el;
    },
    get(id){ return registry.get(id); },
  };
}

async function partie(engOpts, types, { real100 = false, realResolve = false } = {}){
  const ctl = { mode: 'natural', k: 0 };
  const M = Object.create(Math);
  M.random = () => {
    if(ctl.mode === 'min'){ ctl.k++; return (ctl.k % 100000) * 1e-9 + 1e-12; }
    if(ctl.mode === 'max'){ ctl.k++; return 1 - ((ctl.k % 100000) + 1) * 1e-9; }
    return Math.random();
  };
  const alerts = [];
  const eng = loadEngine({ transform: engOpts.transform, globals: { Math: M, alert: (m) => alerts.push(String(m)) } });
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], types, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; };`);
  if(!realResolve) eng.run(`resolveStockDraws = function(c){ return {price:c.stockPrice, gameOver:false}; };`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg){ __logs.push(String(msg)); return __realLog.apply(this, arguments); };`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  eng.run(`globalThis.__ovIS = {}; globalThis.__realIS = incomeStatementFor;
    incomeStatementFor = function(id, sem){ const r = __realIS(id, sem); const k2 = id+':'+sem;
      if(__ovIS[k2]!==undefined) r.netIncome = __ovIS[k2]; else if(__ovIS[id]!==undefined) r.netIncome = __ovIS[id]; return r; };`);
  eng.run(`globalThis.__ovBNR = {}; if(typeof dividendRetainedEarnings==='function'){ globalThis.__realBNR = dividendRetainedEarnings;
    dividendRetainedEarnings = function(co, sem){ const r = __realBNR(co, sem); if(__ovBNR[co.id]!==undefined) r.retainedEarnings = __ovBNR[co.id]; return r; }; }`);
  if(real100) eng.run(`state.companies.forEach(c=>{ const other = state.players.find(p=>p.id!==c.ceoId); const b = c.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = other.id; });`);
  // Espion : cubes injectés au sac fondamental (quantité, cours vu, origine section 320, pendant advanceGameClock).
  const inj = [];
  const real = eng.sandbox.injectStockCube;
  eng.sandbox.injectStockCube = function(co, color, a, b){
    const stack = String(new Error().stack);
    const q = real(co, color, a, b);
    inj.push({ co: co.id, color, q, price: co.stockPrice, s320: /closeAnnouncedDividendPayoutPenalty|applyAnnouncedDividendPayoutPenalty/.test(stack), inClock: /advanceGameClock/.test(stack) });
    return q;
  };
  const T = { eng, ids, ctl, alerts, inj, dom: installModalDom(eng) };
  T.co = (i) => `state.companies.find(c=>c.ceoId===${JSON.stringify(ids[i])})`;
  T.money = () => eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
  T.price = (i) => eng.run(`${T.co(i)}.stockPrice`);
  T.setup = (i, code) => eng.run(code.replace(/\bA\b/g, T.co(i)));
  T.reds320 = () => inj.filter(x => x.s320).reduce((s, x) => s + x.q, 0);
  return T;
}
// Cours 100 $, fondation 100 $ (plancher 5 $, garde 10 $), trésorerie confortable ; BNR imposés si `bnr` est donné.
function prep(T, i, { bnr, netIncome = 1, price = 100, founding = 100, cash = 40, roll = 6 } = {}){
  T.setup(i, `__ovIS[A.id] = ${netIncome}; ${bnr !== undefined ? `__ovBNR[A.id] = ${bnr};` : ''} A.stockPrice = ${price * US}; A.stockPriceFounding = ${founding * US}; A.cash = ${cash}; state.gameClock.rollCount = ${roll};`);
}
const closeSemester = (T) => T.eng.run(`(function(){ const r = state.gameClock.rollCount; state.gameClock.rollCount = Math.floor(r/3)*3 + 2; advanceGameClock(); return state.gameClock.rollCount; })()`);
const closeMode = (T, mode) => { T.ctl.mode = mode; try { return closeSemester(T); } finally { T.ctl.mode = 'natural'; } };

// Annonce par la vraie fenêtre (saisie, « input », clic sur Annoncer) ; rend l'aperçu affiché et la ligne fixe.
async function annoncer(T, i, amount, mode = 'natural'){
  const { eng, dom } = T;
  dom.reset(); dom.add('mOk'); dom.add('mCancel');
  const input = dom.add('mDividendAmount'); const prev = dom.add('mDividendPayoutPreview');
  eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(i)}.ceoId`))}; __modals.length = 0; modalAnnounceDividend();`);
  const html = eng.run(`__modals[__modals.length-1] || ''`);
  input.value = String(amount);
  await input.fire('input');
  const preview = String(prev.innerHTML || '');
  const nAnn0 = eng.run(`state.dividendAnnouncements.length`), red0 = T.reds320();
  T.ctl.mode = mode;
  try { await dom.get('mOk').fire('click'); } finally { T.ctl.mode = 'natural'; }
  return { preview, html, drop: dropOf(preview), added: T.reds320() - red0, announced: eng.run(`state.dividendAnnouncements.length`) === nAnn0 + 1 };
}
// Vraie fenêtre « Dividende récurrent » (case, palier 1..7 ; 3 = inchangé) : rend l'aperçu affiché.
async function recurrent(T, i, checked, tier = 3){
  const { eng, dom } = T;
  dom.reset();
  ['mOk', 'mCancel', 'mDivTierLabel', 'mDivPerShare', 'mDivTotalCost', 'mDivCutWarning', 'mDivPayoutWarning'].forEach(id => dom.add(id));
  dom.add('mDivAutoPayChk', { checked });
  const t = dom.add('mDivTier', { value: String(tier) });
  eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(i)}.ceoId`))}; __modals.length = 0; modalDividendRecurrentSettings();`);
  const html = eng.run(`__modals[__modals.length-1] || ''`);
  await t.fire('input');
  const warn = String(dom.get('mDivPayoutWarning').innerHTML || '');
  await dom.get('mOk').fire('click');
  return { warn, html, drop: dropOf(warn) };
}
function dropOf(html){ const m = /data-price-drop="([^"]+)"/.exec(html || ''); return m ? Number(m[1]) : 0; }
const fmt$ = (x) => (x / US).toFixed(4) + ' $';
// Parts de la banque : `pct` % des 200 000 parts (le reste à Bob ; le CEO garde ses 60 000 si possible).
function bankShare(T, i, pct){
  T.setup(i, `(function(){ const c = A; const issued = c.sharesIssued; const bank = c.shareholders.find(s=>s.playerId==='BANK');
    const bob = state.players.find(p=>p.id!==c.ceoId).id; let other = c.shareholders.find(s=>s.playerId===bob);
    if(!other){ other = {playerId: bob, shares: 0}; c.shareholders.push(other); }
    const total = bank.shares + other.shares; bank.shares = issued*${pct}/100; other.shares = total - bank.shares; })()`);
}

// ---------------------------------------------------------------------------------------------------------------
const SCENARIOS = [];
const scenario = (id, title, base, fn) => SCENARIOS.push({ id, title, base, fn });

// Annonce de `amount` M$ par une GARP (200 000 parts), BNR imposés, clôture ; vérifie la baisse attendue en $.
async function annonceEtClot(o, ok, label, { amount, bnr, expectedDrop, bank = null, price = 100 }){
  const T = await partie(o, ['garp'], { real100: bank === 0 });
  if(bank !== null && bank !== 0 && bank !== 70) bankShare(T, 0, bank);
  prep(T, 0, { bnr, price });
  const m0 = T.money();
  const r = await annoncer(T, 0, amount);
  ok(r.announced, `${label} : annonce de ${amount} M$ acceptée`);
  const p0 = T.price(0);
  closeSemester(T);
  const drop = p0 - T.price(0);
  ok(near(drop, expectedDrop * US, 1e-11), `${label} : le cours baisse de ${expectedDrop.toFixed(4)} $ (${fmt$(p0)} -> ${fmt$(T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), `${label} : monnaie conservée`);
  return { T, r, drop };
}

scenario('S1', 'exemples de Julien : 3 M$ annoncés sur 200 000 parts à 100 $ (15 $ par action)', 'fail', async (o, ok) => {
  const cas = [['BNR 6 M$ (ratio 0,5)', 6, 7.5], ['BNR 3 M$ (ratio 1)', 3, 15], ['BNR 1 M$ (ratio plafonné à 1)', 1, 15],
    ['BNR nuls', 0, 15], ['BNR négatifs (−2 M$)', -2, 15], ['BNR 30 M$ (ratio 0,1)', 30, 1.5]];
  for(const [label, bnr, exp] of cas){
    const { T } = await annonceEtClot(o, ok, label, { amount: 3, bnr, expectedDrop: exp, bank: 0 });
    if(bnr === 6){
      const h = T.eng.json(`${T.co(0)}.stockPriceHistory.slice(-1)[0]`);
      ok(h && h.roll === 9 && near(h.price, 92.5 * US, 1e-12), `historique du cours : dernier point au lancer 9 à 92,50 $ (${JSON.stringify(h)})`);
      const line = T.eng.run(`__logs.find(l=>l.includes('📉')) || ''`);
      if(o.verbose) console.log(`    journal : ${line}`);
      ok(/100\.00 \$ → 92\.50 \$/.test(line) && /15\.00 \$ par action/.test(line) && /rendement 15 %/.test(line) && /6\.00 M\$/.test(line) && /30\.00 \$ par action/.test(line) && /50 %/.test(line),
        'journal : dividende par action, rendement, BNR (total et par action), ratio, cours avant et après');
    }
  }
});

scenario('S2', 'la part de la banque ne change rien : 0 %, 50 % et 70 % des parts, même baisse de 7,50 $', 'fail', async (o, ok) => {
  const drops = [];
  for(const bank of [0, 50, 70]){
    const { T, drop } = await annonceEtClot(o, ok, `banque à ${bank} %`, { amount: 3, bnr: 6, expectedDrop: 7.5, bank });
    const real = T.eng.run(`dividendNetPaidInSemester(${T.co(0)}.id, 2)`);
    ok(near(real, 3 * (100 - bank) / 100, 1e-9), `banque à ${bank} % : versé réellement aux actionnaires ${real.toFixed(2)} M$`);
    drops.push(drop);
  }
  ok(drops.every(d => near(d, drops[0], 1e-15)), 'même baisse dans les trois cas');
});

scenario('S3', 'cas de Julien : bénéfice de 1 $ ce semestre, BNR 5 M$ (vrais), dividende de 2 M$ : baisse de 4 $', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, {});
  T.setup(0, `__ovIS[A.id+':0'] = 3; __ovIS[A.id+':1'] = 2; __ovIS[A.id+':2'] = 1e-6;`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 2.0, 'max');
  const p0 = T.price(0);
  closeSemester(T);
  ok(near(p0 - T.price(0), 4 * US, 1e-11), `10 $ par action, BNR 25 $ par action (ratio 0,4) : baisse de 4 $ (${fmt$(p0 - T.price(0))})`);
  ok(r.added === 0 && T.reds320() === 0, `ratio 40 % des BNR : aucun cube rouge, même au tirage haut (${T.reds320()})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S4', 'BNR réels sur plusieurs semestres : dividendes ordinaires d’avant (hors part de la banque) et privilégiés déduits', 'fail', async (o, ok) => {
  // Bénéfices : semestre 0 = 4, semestre 1 = 3, semestre 2 (qui se ferme) = 2 M$ -> 9 M$.
  // Semestre 1 : annonce de 1 M$, banque à 70 % : 0,3 M$ réellement versés (0,7 M$ revenus en trésorerie).
  // Privilégiés : 0,5 M$ versés et 0,1 M$ revenus au semestre 1, arriérage de 0,2 M$ payé au semestre 2 -> 0,6 M$.
  // BNR à la clôture du semestre 2 = 9 − 0,3 − 0,6 = 8,1 M$ = 40,50 $ par action. Annonce de 4,05 M$ (20,25 $) : ratio
  // 0,5, baisse 10,125 $.
  const T = await partie(o, ['garp']);
  prep(T, 0, { roll: 3 });
  T.setup(0, `__ovIS[A.id+':0'] = 4; __ovIS[A.id+':1'] = 3; __ovIS[A.id+':2'] = 2;`);
  await annoncer(T, 0, 1.0);
  T.setup(0, `logFin(A.id, 'preferred_dividend_payout', -0.5, 4); logFin(A.id, 'preferred_dividend_unclaimed_return', 0.1, 4);`);
  closeSemester(T);
  T.setup(0, `A.stockPrice = ${100 * US}; logFin(A.id, 'preferred_dividend_arrears_paid', -0.2, 7);`);
  if(o.engine === 'new') ok(near(T.eng.run(`__realBNR(${T.co(0)}, 2).retainedEarnings`), 8.1, 1e-9), `BNR du semestre 2 : ${T.eng.run(`__realBNR(${T.co(0)}, 2).retainedEarnings`).toFixed(4)} M$ (9 − 0,3 − 0,6)`);
  const m0 = T.money();
  await annoncer(T, 0, 4.05);
  const p0 = T.price(0);
  closeSemester(T);
  ok(near(p0 - T.price(0), 10.125 * US, 1e-11), `annonce de 4,05 M$ (20,25 $ par action) sur 40,50 $ de BNR par action : baisse de 10,125 $ (${fmt$(p0 - T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S5', 'récurrent seul d’une Dividendes, petites et grandes réserves : baisse, mais aucun cube', 'fail', async (o, ok) => {
  for(const [label, bnr, exp] of [['5 $ par action, BNR 10 M$ (50 $ par action)', 10, 0.5], ['5 $ par action, BNR 1 M$', 1, 5]]){
    const T = await partie(o, ['dividende'], { real100: true });
    prep(T, 0, { bnr });
    T.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
    const m0 = T.money(), p0 = T.price(0);
    closeMode(T, 'max');
    ok(near(p0 - T.price(0), exp * US, 1e-11), `récurrent ${label} : baisse de ${exp} $ (${fmt$(p0 - T.price(0))})`);
    ok(T.reds320() === 0, `récurrent ${label} : aucun cube rouge (le récurrent seul n'en ajoute jamais)`);
    ok(near(m0, T.money(), 1e-9), `récurrent ${label} : monnaie conservée`);
  }
});

scenario('S6', 'annonce + récurrent : 5 $ + 5 $ par action sur 100 $ de BNR par action : baisse de 1 $', 'fail', async (o, ok) => {
  const T = await partie(o, ['dividende'], { real100: true });
  prep(T, 0, { bnr: 20 });
  T.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 1.0);
  ok(r.announced && near(r.drop, 1 * US, 1e-11), `aperçu de l'annonce : environ 1 $, récurrent compris (${fmt$(r.drop)})`);
  const p0 = T.price(0);
  closeSemester(T);
  ok(near(p0 - T.price(0), 1 * US, 1e-11), `clôture : baisse de 1 $ (${fmt$(p0 - T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S7', 'garde : jamais sous deux fois le plancher, la partie continue ; déjà dessous, le cours ne bouge pas', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp', 'garp'], { real100: true, realResolve: true });
  prep(T, 0, { bnr: 0, price: 12 });
  T.setup(1, `A.stockPrice = ${100 * US}; A.stockPriceFounding = ${100 * US};`);
  const m0 = T.money();
  await annoncer(T, 0, 3);
  closeSemester(T);
  ok(near(T.price(0), 10 * US, 1e-15), `cours 12 $, baisse de 15 $ demandée : arrêt à 10 $, deux fois le plancher de 5 $ (${fmt$(T.price(0))})`);
  ok(T.eng.run(`state.gameEndedReason`) == null, 'la partie continue (aucune fin « cours à 0 »)');
  const line = T.eng.run(`__logs.find(l=>l.includes('📉')) || ''`);
  ok(/10\.00 \$ \(deux fois le cours plancher\)/.test(line), 'le journal dit que la baisse s\'arrête à deux fois le cours plancher');
  T.setup(0, `A.stockPrice = ${9 * US};`);
  await annoncer(T, 0, 3);
  closeSemester(T);
  ok(near(T.price(0), 9 * US, 1e-15) && T.eng.run(`state.gameEndedReason`) == null, `cours déjà sous la garde (9 $) : il ne bouge pas, toujours en jeu (${fmt$(T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S8', 'fin de partie : dividende dû au lancer final, cours abaissé dans le classement', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { bnr: 6, roll: 9 });
  T.eng.run(`state.hiddenGameLengthTargetYear = 1;`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 3);
  T.eng.run(`state.gameClock.rollCount = 11;`);
  const p0 = T.price(0);
  T.eng.run(`advanceGameClock();`);
  const reason = T.eng.json(`state.gameEndedReason`);
  ok(r.announced && reason && reason.reason === 'maxDuration', `fin de partie par durée maximale (${JSON.stringify(reason)})`);
  ok(T.eng.run(`__logs.some(l=>l.includes('verse son dividende annoncé de 3.00 M$'))`), 'le dividende dû a bien été versé au lancer final');
  ok(near(p0 - T.price(0), 7.5 * US, 1e-11), `cours abaissé de 7,50 $ au lancer final (${fmt$(p0)} -> ${fmt$(T.price(0))})`);
  const holder = T.eng.run(`${T.co(0)}.shareholders.find(s=>s.playerId!==${T.co(0)}.ceoId).playerId`);
  const nw = T.eng.run(`netWorth(state.players.find(p=>p.id===${JSON.stringify(holder)}))`);
  const shares = T.eng.run(`${T.co(0)}.shareholders.find(s=>s.playerId===${JSON.stringify(holder)}).shares`);
  const nwOld = T.eng.run(`(function(){ const c = ${T.co(0)}; const keep = c.stockPrice; c.stockPrice = ${p0}; const v = netWorth(state.players.find(p=>p.id===${JSON.stringify(holder)})); c.stockPrice = keep; return v; })()`);
  ok(near(nwOld - nw, shares * 7.5 * US, 1e-9), `classement : valeur nette du porteur de ${shares} parts réduite de ${(nwOld - nw).toFixed(4)} M$ (= parts × 7,50 $)`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée jusqu\'à la fin');
});

scenario('S9', 'fin de partie : dividende pas encore dû, rendu à l’entreprise, aucune baisse', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp', 'garp'], { real100: true });
  prep(T, 0, { bnr: 6, roll: 9 });
  const bob = T.eng.run(`${T.co(1)}.id`);
  const m0 = T.money(), cash0 = T.eng.run(`${T.co(0)}.cash`);
  await annoncer(T, 0, 3);
  T.eng.run(`resolveStockDraws = function(c){ return {price:c.stockPrice, gameOver: c.id===${JSON.stringify(bob)}}; }; advanceGameClock();`);
  const reason = T.eng.json(`state.gameEndedReason`);
  ok(reason && reason.reason === 'stockFloor', `fin de partie « cours à 0 » au lancer 10 (${JSON.stringify(reason)})`);
  ok(near(T.eng.run(`${T.co(0)}.cash`), cash0, 1e-9) && T.eng.run(`state.dividendAnnouncements.length`) === 0, 'dividende pas encore dû : rendu en entier à l\'entreprise');
  ok(near(T.price(0), 100 * US, 1e-15), `aucune baisse du cours (${fmt$(T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  const C = await partie(o, ['garp'], { real100: true });
  prep(C, 0, { bnr: 6, roll: 9 });
  await annoncer(C, 0, 3);
  closeSemester(C);
  ok(near(100 * US - C.price(0), 7.5 * US, 1e-11), `contrôle : le même dividende, versé, fait baisser le cours de 7,50 $ (${fmt$(100 * US - C.price(0))})`);
});

scenario('S10', 'partie en cours au moment de la mise à jour : baisse seulement au semestre suivant', 'fail', async (o, ok) => {
  // Partie neuve : la règle vaut dès le premier semestre.
  const N = await partie(o, ['garp']);
  ok(N.eng.run(`state.dividendPriceDropFromSemester`) === 0, 'partie neuve : marqueur à 0');
  // Partie enregistrée par le moteur d'AVANT (commit de base), annonce de 3 M$ au semestre 2, rechargée.
  const baseSrc = baseEngineSource();
  const B = await partie(baseSrc ? { transform: () => baseSrc } : o, ['garp'], { real100: true });
  prep(B, 0, {});
  await annoncer(B, 0, 3);
  if(!baseSrc) B.eng.run(`delete state.dividendPriceDropFromSemester;`);
  const saved = B.eng.run(`JSON.stringify(state)`);
  const T = await partie(o, ['garp']);
  T.eng.run(`state = JSON.parse(${JSON.stringify(saved)}); migrateState(state);`);
  ok(T.eng.run(`state.dividendPriceDropFromSemester`) === 3, `chargée au semestre 2 : la règle commence au semestre 3 (${T.eng.run(`state.dividendPriceDropFromSemester`)})`);
  T.eng.run(`__ovBNR[state.companies[0].id] = 6; state.companies[0].cash = 40;`);
  const m0 = T.money(), p0 = T.eng.run(`state.companies[0].stockPrice`);
  let err = null;
  try { closeSemester(T); } catch(e){ err = e; }
  ok(!err && T.eng.run(`state.gameClock.rollCount`) === 9 && T.eng.run(`state.dividendAnnouncements.length`) === 0, `clôture sans erreur, annonce versée${err ? ' : ' + err.message : ''}`);
  ok(near(T.eng.run(`state.companies[0].stockPrice`), p0, 1e-15), 'annonce du semestre de la mise à jour : aucune baisse');
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  // Semestre suivant : la règle s'applique.
  T.eng.run(`myPlayerId = state.companies[0].ceoId;`);
  T.co = () => `state.companies[0]`;
  await annoncer(T, 0, 3);
  const q0 = T.eng.run(`state.companies[0].stockPrice`);
  closeSemester(T);
  ok(near(q0 - T.eng.run(`state.companies[0].stockPrice`), 7.5 * US, 1e-11), `semestre suivant : baisse de 7,50 $ (${fmt$(q0 - T.eng.run(`state.companies[0].stockPrice`))})`);
});

scenario('S11', 'aperçus des deux fenêtres = baisse appliquée (parts constantes)', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { bnr: 6 });
  const r = await annoncer(T, 0, 3);
  const txt = r.preview.replace(/<[^>]+>/g, '');
  if(o.verbose) console.log(`    aperçu : « ${txt} »`);
  ok(/environ/.test(txt) && /15\.00 \$ par action/.test(txt) && /rendement 15 %/.test(txt) && /BNR 6\.00 M\$/.test(txt) && /30\.00 \$ par action/.test(txt) && /ratio 50 %/.test(txt) && /soit 7,5 %/.test(txt) && near(r.drop, 7.5 * US, 1e-11),
    `annonce : dividende par action, rendement, BNR total et par action, ratio, « environ 7.50 $ par action, soit 7,5 % » (${fmt$(r.drop)})`);
  ok(/bénéfices non répartis \(BNR\)/.test(r.html) && !/1 à 2 cubes rouges \(jusqu'à 100 %\)|6 à 8/.test(r.html), 'ligne fixe : la règle des BNR en langage de joueur, plus les anciens paliers');
  const p0 = T.price(0); closeSemester(T);
  ok(near(p0 - T.price(0), r.drop, 1e-12), `baisse appliquée = aperçu (${fmt$(p0 - T.price(0))})`);
  // Fenêtre du récurrent, sans annonce : 5 $ par action, BNR 1 M$ (5 $ par action) -> environ 5 $ ; case décochée -> rien.
  const R = await partie(o, ['dividende'], { real100: true });
  prep(R, 0, { bnr: 1 });
  R.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  const off = await recurrent(R, 0, false, 3);
  ok(off.drop === 0, 'récurrent, case décochée : aucune baisse annoncée');
  R.setup(0, `A.dividendRecurrentChangedSemesterIdx = -1;`);
  const on = await recurrent(R, 0, true, 3);
  ok(/environ/.test(on.warn) && near(on.drop, 5 * US, 1e-11) && !/cube/.test(on.warn.replace(/Sac fondamental[^<]*/g, '')), `récurrent 5 $ (ratio 1), sans annonce : « environ 5.00 $ » (${fmt$(on.drop)})`);
  ok(!/5 cubes|DIVIDEND_OVERPAYOUT|dépassent le bénéfice net/.test(on.html.replace(/<!--[\s\S]*?-->/g, '')) && /une hausse y ajoute des cubes verts/.test(on.html), 'rappel du sac type : hausse = verts, baisse ou absence = 20 rouges ; plus de règle des 5 cubes');
  const q0 = R.price(0); closeSemester(R);
  ok(near(q0 - R.price(0), on.drop, 1e-12), `baisse appliquée = aperçu du récurrent (${fmt$(q0 - R.price(0))})`);
  const help = R.eng.run(`COMPANY_TYPE_GUIDELINES.dividende`);
  ok(/bénéfices non répartis/.test(help) && !/rougir 5 cubes/.test(help), 'aide du type Dividendes : régularité = bon sac type, verser sans BNR = le cours descend');
});

scenario('S12', 'cubes rouges des annonces : symboliques (0 à 1, puis 1 à 2), même pour un dividende énorme', 'fail', async (o, ok) => {
  for(const mode of ['min', 'max']){
    for(const [amount, bnr, want] of [[0.9, 1, { min: 0, max: 1 }], [1.3, 1, { min: 1, max: 2 }], [25, 1, { min: 1, max: 2 }], [1, -5, { min: 1, max: 2 }]]){
      const T = await partie(o, ['garp'], { real100: true });
      prep(T, 0, { bnr, cash: 40 });
      await annoncer(T, 0, amount, mode);
      closeMode(T, mode);
      const reds = T.reds320();
      ok(reds === want[mode], `[${mode}] annonce de ${amount} M$ pour ${bnr} M$ de BNR : ${reds} rouge(s) au sac fondamental (attendu ${want[mode]})`);
    }
  }
  // Premier palier tiré à 0 puis palier relevé : total entre 1 et 2.
  for(const [m1, m2, want] of [['min', 'min', 1], ['min', 'max', 2]]){
    const T = await partie(o, ['garp'], { real100: true });
    prep(T, 0, { bnr: 1 });
    const a = await annoncer(T, 0, 0.9, m1), b = await annoncer(T, 0, 0.3, m2);
    ok(a.added === 0 && a.added + b.added === want, `90 % (tirage ${m1}) : ${a.added}, puis 120 % (tirage ${m2}) : +${b.added} = ${want}`);
  }
});

scenario('S13', 'sac type : verser plus que le bénéfice ne rougit plus rien ; hausse et baisse du récurrent inchangées', 'fail', async (o, ok) => {
  const T = await partie(o, ['dividende'], { real100: true });
  prep(T, 0, { bnr: 50, netIncome: 0.1 });
  T.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false; A.typeReserve = {green:6, red:1, white:3};`);
  closeSemester(T);
  const tp = T.eng.json(`Object.assign({}, ${T.co(0)}.typeReserve)`);
  ok(tp.green === 6 && tp.red === 1 && tp.white === 3, `1 M$ versés pour 0,1 M$ de bénéfice (1000 %) : sac type inchangé 6V/1R/3B (${JSON.stringify(tp)} ; avant : 4V/6R/0B)`);
  const g = T.eng.json(`(function(){ const c = ${T.co(0)}; c.typeReserve = {green:8, red:2, white:10}; const ref = c.dividendBenchmarkPerShare;
    const up = applyDividendGaugeTier(c, ref*1.2*c.sharesIssued); const tUp = Object.assign({}, c.typeReserve);
    c.dividendBenchmarkPerShare = ref; c.typeReserve = {green:8, red:2, white:10};
    const down = applyDividendGaugeTier(c, ref*0.7*c.sharesIssued); return {up, tUp, down, tDown: Object.assign({}, c.typeReserve)}; })()`);
  ok(g.up === 4 && g.tUp.green === 11 && g.down === 2 && g.tDown.red === 20, `jauge du récurrent : hausse +3 verts (${JSON.stringify(g.tUp)}), baisse = 20 rouges (${JSON.stringify(g.tDown)})`);
  T.setup(0, `A.dividendAutoPay = false; A.typeReserve = {green:6, red:1, white:3};`);
  closeSemester(T);
  ok(T.eng.run(`${T.co(0)}.typeReserve.red`) === 20, 'semestre sans versement récurrent : sac type à 20 rouges (inchangé)');
});

scenario('S14', 'baisse appliquée AVANT les déclencheurs du sac fondamental de la clôture', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { bnr: 6 });
  await annoncer(T, 0, 3);
  const id = T.eng.run(`${T.co(0)}.id`);
  T.inj.length = 0;
  closeSemester(T);
  const trig = T.inj.filter(x => x.co === id && x.inClock && !x.s320);
  ok(trig.length > 0 && trig.every(x => near(x.price, 92.5 * US, 1e-12)), `les ${trig.length} déclencheurs de la clôture voient le cours abaissé (92,50 $ : ${trig.map(x => fmt$(x.price)).join(', ')})`);
});

// ---------------------------------------------------------------------------------------------------------------
let baseSrcCache;
function baseEngineSource(){
  if(baseSrcCache !== undefined) return baseSrcCache;
  try {
    const html = execSync(`git show ${BASE_COMMIT}:index.html`, { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
    const OPEN = '\n<script>\n', CLOSE = '\n</script>';
    const a = html.lastIndexOf(OPEN), b = html.lastIndexOf(CLOSE);
    baseSrcCache = (a >= 0 && b > a) ? html.slice(a + OPEN.length, b) : null;
  } catch(e){ baseSrcCache = null; }
  return baseSrcCache;
}

async function runScenario(sc, engOpts, verbose){
  const fails = []; let count = 0;
  const ok = (cond, msg) => { count++; if(cond){ if(verbose) console.log('  OK', msg); } else { fails.push(msg); if(verbose) console.log('  ÉCHEC', msg); } };
  try { await sc.fn(Object.assign({ verbose }, engOpts), ok); }
  catch(e){ fails.push('exception : ' + (e && e.message ? e.message : String(e))); if(verbose) console.log('  EXCEPTION', e && e.stack); }
  return { fails, count };
}

const sub = (a, b) => (src) => src.split(a).join(b);
const CALL = "    Object.keys(dividendPerSharePaidById).forEach(id=>applyDividendPayoutPriceDrop(companyById(id), semesterBefore, dividendPerSharePaidById[id]));\n";
const MUTATIONS = [
  ['ratio non plafonné', sub('const priceRatio = noReserve ? 1 : Math.min(1, ratio);', 'const priceRatio = noReserve ? 1 : ratio;'), ['S1']],
  ['BNR sans les dividendes ordinaires d’avant', sub('if(e.semesterIndex<semesterIdx) ordinaryPaid += -e.amount;', 'if(false) ordinaryPaid += -e.amount;'), ['S4']],
  ['BNR sans les dividendes privilégiés', sub('      preferredPaid += -e.amount;\n', '      preferredPaid += 0;\n'), ['S4']],
  ['BNR sans le semestre qui se ferme', sub('for(let sem=first; sem<=semesterIdx; sem++) netIncome +=', 'for(let sem=first; sem<semesterIdx; sem++) netIncome +='), ['S3', 'S4']],
  ['dividendes ordinaires comptés avec la part de la banque', sub("if(e.category==='dividend_payout' || e.category==='dividend_forfeited_return'){", "if(e.category==='dividend_payout'){"), ['S4']],
  ['la part de la banque change la baisse', sub('const d = dividendReservePriceDrop(perShareTotal, bnr.retainedEarnings,', 'const d = dividendReservePriceDrop(dividendNetPaidInSemester(co.id, semesterIdx)/co.sharesIssued, bnr.retainedEarnings,'), ['S2']],
  ['garde du double plancher ignorée', sub('const priceAfter = (dropPerShare>0 && p>g) ? Math.max(g, p - dropPerShare) : p;', 'const priceAfter = dropPerShare>0 ? Math.max(0, p - dropPerShare) : p;'), ['S7']],
  ['garde au simple plancher', sub('const DIVIDEND_PRICE_DROP_GUARD_MULTIPLE = 2;', 'const DIVIDEND_PRICE_DROP_GUARD_MULTIPLE = 1;'), ['S7']],
  ['règle appliquée dès le semestre de la mise à jour', sub('s.dividendPriceDropFromSemester = Math.floor(((s.gameClock && s.gameClock.rollCount)||0)/3) + 1;', 's.dividendPriceDropFromSemester = 0;'), ['S10']],
  ['pas de baisse au lancer final', sub(CALL, CALL.replace('    Object.keys', '    if(!state.gameEndedReason) Object.keys')), ['S8']],
  ['récurrent oublié dans le dividende par action', (src) => src.replace(/(co\.dividendAutoPaySemesterIdx = semesterAfter;\n\s*)dividendPerSharePaidById\[co\.id\] = \(dividendPerSharePaidById\[co\.id\]\|\|0\) \+ perShare; \/\/ Section 321\n/, '$1'), ['S5', 'S6']],
  ['baisse après les déclencheurs du sac fondamental', (src) => {
    if(!src.includes(CALL)) return src;
    const s = src.replace(CALL, '');
    const anchor = "        injectStockCube(co, 'red', STOCK_TRIGGER_NEGATIVE_CASH_MIN, STOCK_TRIGGER_NEGATIVE_CASH_MAX);\n      }\n    });\n";
    return s.includes(anchor) ? s.replace(anchor, anchor + CALL) : src;
  }, ['S14']],
  ['anciens cubes remis (6 à 8 au-delà des réserves)', sub('{maxRatio:Infinity, min:DIVIDEND_RESERVE_OVER_RED_MIN, max:DIVIDEND_RESERVE_OVER_RED_MAX}', '{maxRatio:Infinity, min:6, max:8}'), ['S12']],
  ['cubes jugés sur le bénéfice du semestre (ancienne mesure)', sub('const judged = dividendReserveRatio(ps.perShare, bnr.retainedEarnings, co.sharesIssued);', 'const judged = dividendReserveRatio(ps.perShare, incomeStatementFor(co.id, ps.curSemesterIdx).netIncome, co.sharesIssued);'), ['S3']],
  ['règle des 5 cubes du sac type remise', sub("      // fondamental (announcedDividendPayoutPenalty).\n", "      // fondamental (announcedDividendPayoutPenalty).\n      { const paidForRatio = dividendNetPaidInSemester(co.id, semesterBefore); if(co.type==='dividende' && paidForRatio>1e-9 && (is.netIncome<=1e-9 || paidForRatio/is.netIncome>1)){ const tp = co.typeReserve; const w = Math.min(5, tp.white); tp.white -= w; tp.red += w; const g = Math.min(5-w, tp.green); tp.green -= g; tp.red += g; } }\n"), ['S13']],
  ['aperçu du récurrent sans le récurrent', sub("const recurrentPart = co.type==='dividende' ? recurrentPerShare : 0;", 'const recurrentPart = 0;'), ['S11', 'S6']],
  ['récurrent seul qui ajoute des cubes à la clôture', sub('  if(co.dividendPenaltySemesterIdx!==semesterIdx) return 0;\n  if(!(perSharePaid>1e-15)) return 0;', '  if(!(perSharePaid>1e-15)) return 0;'), ['S5']],
];

(async () => {
  let total = 0; const failures = [];
  console.log('=== Moteur testé ===');
  for(const sc of SCENARIOS){
    console.log(`${sc.id}. ${sc.title}`);
    const r = await runScenario(sc, { engine: 'new' }, true);
    total += r.count;
    r.fails.forEach(f => failures.push(`${sc.id} — ${f}`));
  }
  console.log('\n=== Contre-épreuve : moteur d\'avant la section 321 (commit ' + BASE_COMMIT + ') ===');
  const baseSrc = baseEngineSource();
  if(!baseSrc){
    console.log('  git indisponible : contre-épreuve sur le moteur d\'avant sautée (les versions cassées ci-dessous restent).');
  } else {
    for(const sc of SCENARIOS){
      const r = await runScenario(sc, { transform: () => baseSrc, engine: 'base' }, false);
      const failed = r.fails.length > 0;
      const expected = sc.base === 'fail';
      console.log(`  ${failed === expected ? 'OK' : 'ÉCHEC'} ${sc.id} : ${failed ? 'échoue' : 'passe'} sur le moteur d'avant${failed ? ' (' + r.fails[0].slice(0, 90) + '…)' : ''}${expected ? '' : ' (attendu : passe)'}`);
      total++;
      if(failed !== expected) failures.push(`contre-épreuve ${sc.id} : ${failed ? 'échoue' : 'passe'} sur le moteur d'avant`);
    }
  }
  console.log('\n=== Versions cassées exprès ===');
  for(const [label, tf, targets] of MUTATIONS){
    let caught = [];
    for(const id of targets){
      const sc = SCENARIOS.find(s => s.id === id);
      const r = await runScenario(sc, { transform: tf, engine: 'new' }, false);
      if(r.fails.some(f => /transformation n.a rien modifié/.test(f))){ caught = []; console.log(`  (motif de la version cassée introuvable pour ${id})`); break; }
      if(r.fails.length) caught.push(`${id} (${r.fails[0].slice(0, 70)}…)`);
    }
    total++;
    console.log(`  ${caught.length ? 'OK' : 'ÉCHEC'} « ${label} » ${caught.length ? 'attrapée par ' + caught.join(' ; ') : 'NON attrapée'}`);
    if(!caught.length) failures.push(`version cassée non attrapée : ${label}`);
  }
  if(failures.length){
    console.log(`\n${failures.length} échec(s) :`); failures.forEach(f => console.log('  - ' + f));
    console.log(`ÉCHEC : section 321 (versement) — ${failures.length} échec(s) sur ${total} vérifications`);
    process.exit(1);
  }
  console.log(`\nOK : section 321 (versement) — ${total} vérifications`);
})();
