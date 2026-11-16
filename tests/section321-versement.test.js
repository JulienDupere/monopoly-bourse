// Test — section 321, lot B (refonte, décision de Julien) : baisse du cours au versement d'un dividende selon les
// bénéfices non répartis (BNR), tout PAR ACTION. À chaque clôture de semestre, juste après les versements (annonces
// échues et récurrent) et avant les déclencheurs du sac fondamental et le tirage des cubes :
//   d = dividende par action versé à cette clôture ; ratio = d ÷ (BNR ÷ parts émises), plafonné à 1 (BNR ≤ 0 : 1) ;
//   baisse = d × ratio ; jamais sous le DOUBLE du plancher de fin de partie (dessous : rien), jamais de fin de partie.
// BNR par action = somme des (bénéfice net ÷ parts émises) du premier semestre jusqu'au semestre qui se ferme inclus
// − dividendes ordinaires PAR ACTION versés aux clôtures d'avant − dividendes privilégiés versés ÷ parts émises ;
// « BNR ajustés » = BNR par action × parts des actionnaires réels. Partie en cours au moment de la mise à jour :
// seulement à partir du semestre suivant. Aussi : cubes rouges symboliques et FIXES des annonces, sur le ratio de
// distribution par action du semestre de référence (≤ 80 % : 0 ; au-delà, bénéfice nul compris : 1 ; bénéfice négatif :
// 2), et règle des 5 cubes du sac type retirée.
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
    dividendRetainedEarnings = function(co, sem){ const r = __realBNR(co, sem); if(__ovBNR[co.id]!==undefined){ r.perShare = __ovBNR[co.id]/co.sharesIssued; r.adjusted = r.perShare*r.realShares; } return r; }; }`);
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
// Cours 100 $, fondation 100 $ (plancher 5 $, garde 10 $), trésorerie confortable ; BNR imposés si `bnr` est donné
// (en M$ pour 200 000 parts, convertis en BNR par action : 6 M$ = 30 $ par action).
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
// Annonce posée directement dans l'état (sans la fenêtre ni ses refus), comme la sonde p1 du réviseur : sert à prouver
// que la CLÔTURE annule ce que le cours ne peut pas absorber, même si l'annonce est passée.
function pushAnnouncement(T, i, amount){
  return T.eng.run(`(function(){ const co=${T.co(i)}; const amount=${amount};
    if(amount>co.cash+1e-9) return 'trop';
    co.cash -= amount; logFin(co.id, 'dividend_payout', -amount);
    const rh = co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9);
    state.dividendAnnouncements.push({id:uid(), companyId:co.id, amount, announcedAtRoll:state.gameClock.rollCount,
      payAtRoll:(Math.floor(state.gameClock.rollCount/3)+1)*3, recordHolders: rh.map(h=>({playerId:h.playerId, shares:h.shares})), totalSharesAtAnnouncement: co.sharesIssued});
    return 'ok'; })()`);
}
function dropOf(html){ const m = /data-price-drop="([^"]+)"/.exec(html || ''); return m ? Number(m[1]) : 0; }
const attr = (html, name) => { const m = new RegExp(name + '="([^"]*)"').exec(html || ''); return m ? m[1] : null; };
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
  ok(r.announced, 'annonce acceptée');
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S4', 'BNR par action sur plusieurs semestres : dividende d’avant PAR ACTION (banque comprise) et privilégiés déduits', 'fail', async (o, ok) => {
  // Bénéfices : semestre 0 = 4, semestre 1 = 3, semestre 2 (qui se ferme) = 2 M$ -> 9 M$ = 45 $ par action.
  // Semestre 1 : annonce de 1 M$ = 5 $ par action (banque à 70 % : 0,3 M$ seulement reçus par les joueurs).
  // Privilégiés : 0,5 M$ versés et 0,1 M$ revenus au semestre 1, arriérage de 0,2 M$ payé au semestre 2 -> 0,6 M$ = 3 $.
  // BNR par action à la clôture du semestre 2 = 45 − 5 − 3 = 37 $ (ajustés aux joueurs : 37 $ × 60 000 = 2,22 M$).
  // Annonce de 3,7 M$ (18,50 $) : ratio 0,5, baisse 9,25 $.
  const T = await partie(o, ['garp']);
  prep(T, 0, { roll: 3 });
  T.setup(0, `__ovIS[A.id+':0'] = 4; __ovIS[A.id+':1'] = 3; __ovIS[A.id+':2'] = 2;`);
  await annoncer(T, 0, 1.0);
  T.setup(0, `logFin(A.id, 'preferred_dividend_payout', -0.5, 4); logFin(A.id, 'preferred_dividend_unclaimed_return', 0.1, 4);`);
  closeSemester(T);
  T.setup(0, `A.stockPrice = ${100 * US}; logFin(A.id, 'preferred_dividend_arrears_paid', -0.2, 7);`);
  if(o.engine === 'new'){
    const b = T.eng.json(`__realBNR(${T.co(0)}, 2)`);
    ok(near(b.perShare, 37 * US, 1e-12) && near(b.adjusted, 2.22, 1e-9), `BNR du semestre 2 : ${fmt$(b.perShare)} par action (45 − 5 − 3), ajustés aux joueurs ${b.adjusted.toFixed(4)} M$`);
  }
  const m0 = T.money();
  await annoncer(T, 0, 3.7);
  const p0 = T.price(0);
  closeSemester(T);
  ok(near(p0 - T.price(0), 9.25 * US, 1e-11), `annonce de 3,7 M$ (18,50 $ par action) sur 37 $ de BNR par action : baisse de 9,25 $ (${fmt$(p0 - T.price(0))})`);
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

scenario('S7', 'garde : un dividende que le cours ne peut pas absorber n’est pas versé (refus, annulation, récurrent bloqué)', 'fail', async (o, ok) => {
  // a) Cours 12 $, fondation 100 $ (garde 10 $), BNR nuls : au plus 2 $ par action = 0,4 M$. 3 M$ refusés.
  const T = await partie(o, ['garp', 'garp'], { real100: true, realResolve: true });
  prep(T, 0, { bnr: 0, price: 12 });
  T.setup(1, `A.stockPrice = ${100 * US}; A.stockPriceFounding = ${100 * US};`);
  const m0 = T.money(), a0 = T.alerts.length;
  const r1 = await annoncer(T, 0, 3);
  const msg = T.alerts.slice(a0).join(' | ');
  ok(!r1.announced && /ne peut pas absorber/.test(msg) && /400 K\$/.test(msg) && /2\.00 \$ par action/.test(msg), `3 M$ à 12 $ de cours : refusé — « ${msg.slice(0, 160)}… »`);
  ok(attr(r1.preview, 'data-refused') === '1' && /au plus <b>400 K\$<\/b>/.test(r1.preview) && /⚠️/.test(r1.preview), 'aperçu : « refusé », avec le maximum permis (400 K$)');
  // b) 0,4 M$ (2 $) : accepté ; à la clôture, le cours atterrit exactement sur la garde (permis), la partie continue.
  const r2 = await annoncer(T, 0, 0.4);
  closeSemester(T);
  ok(r2.announced && near(T.price(0), 10 * US, 1e-15) && T.eng.run(`state.gameEndedReason`) == null, `0,4 M$ : accepté, cours 12 -> ${fmt$(T.price(0))} (sur la garde), partie en cours`);
  T.eng.run(`advanceGameClock();`);
  ok(T.eng.run(`state.gameEndedReason`) == null, 'lancer suivant (tirages réels, sans cube) : toujours en jeu');
  // c) À la garde : même 10 000 $ sont refusés (plus aucune marge).
  T.setup(0, `state.gameClock.rollCount = 9;`);
  const r3 = await annoncer(T, 0, 0.01);
  ok(!r3.announced && /au plus <b>0\.00 M\$|au plus <b>0 K\$/.test(r3.preview), `cours à la garde : 10 000 $ refusés (${r3.preview.replace(/<[^>]+>/g, '').slice(0, 90)}…)`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');

  // d) Annonce de 3 M$ passée à 100 $, cours tombé à 12 $ avant la clôture : RÉDUITE à 2 $ par action (0,4 M$),
  //    2,6 M$ rendus ; puis, à la garde (10 $), une autre annonce est ANNULÉE en entier.
  {
    const D = await partie(o, ['garp']);
    prep(D, 0, { bnr: 0 });
    const r = await annoncer(D, 0, 3);
    const m1 = D.money();
    D.setup(0, `A.stockPrice = ${12 * US};`);
    const cash0 = D.eng.run(`${D.co(0)}.cash`), alice0 = D.eng.run(`state.players[0].cash`);
    closeSemester(D);
    const id = D.eng.run(`${D.co(0)}.id`);
    ok(r.announced && near(D.price(0), 10 * US, 1e-12) && near(D.eng.run(`state.players[0].cash`) - alice0, 60000 * 2 * US, 1e-9),
      `annonce de 3 M$ faite à 100 $, cours 12 $ à la clôture : réduite à 2 $ par action (Alice, 60 000 parts, reçoit ${(D.eng.run(`state.players[0].cash`) - alice0).toFixed(4)} M$), cours -> ${fmt$(D.price(0))}`);
    ok(near(D.eng.run(`dividendPaidInSemester(${JSON.stringify(id)}, 2)`), 0.4, 1e-9) && near(D.eng.run(`dividendNetPaidInSemester(${JSON.stringify(id)}, 2)`), 0.12, 1e-9),
      'réduite : dividendPaidInSemester = 0,4 M$ déclarés, dividendNetPaidInSemester = 0,12 M$ (hors part de la banque)');
    if(o.engine === 'new') ok(near(D.eng.json(`__realBNR(${D.co(0)}, 3)`).ordinaryPaid, 0.4, 1e-9) && near(D.eng.run(`companyAverageDividendAnnounced(${JSON.stringify(id)})`), 0.4, 1e-9),
      'réduite : 0,4 M$ seulement déduits des BNR du semestre suivant et comptés dans la moyenne des annonces');
    ok(D.eng.json(`__logs`).some(l=>/✂️/.test(l) && /réduit de 3\.00 M\$ à 400 K\$/.test(l) && /2\.60 M\$ rendu/.test(l)) && near(m1, D.money(), 1e-9), 'journal : « réduit de 3,00 M$ à 400 K$ … 2,60 M$ rendu » ; monnaie conservée');
    // À la garde : plus rien ne passe, l'annonce est annulée en entier.
    pushAnnouncement(D, 0, 1);
    const cash1 = D.eng.run(`${D.co(0)}.cash`), alice1 = D.eng.run(`state.players[0].cash`);
    closeSemester(D);
    ok(near(D.eng.run(`${D.co(0)}.cash`) - cash1, 1, 1e-9) && near(D.eng.run(`state.players[0].cash`), alice1, 1e-12) && near(D.eng.run(`dividendPaidInSemester(${JSON.stringify(id)}, 3)`), 0, 1e-12)
      && D.eng.run(`__logs.some(l=>/🚫/.test(l) && /ANNULÉ/.test(l))`), 'à la garde : annonce de 1 M$ annulée en entier, rendue, personne payé, pas un versement');
    if(o.engine === 'new') ok(near(D.eng.run(`companyAverageDividendAnnounced(${JSON.stringify(id)})`), 0.4, 1e-9), 'annulée en entier : pas comptée dans la moyenne des annonces (toujours 0,4 M$)');
    void cash0;
  }
  // e) Récurrent à 12 $ de cours, 5 $ par action, BNR nuls (au plus 2 $) : NON versé, sac type à 20 rouges ; la fenêtre le dit.
  {
    const E = await partie(o, ['dividende'], { real100: true });
    prep(E, 0, { bnr: 0, price: 12 });
    E.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false; A.typeReserve = {green:10, red:0, white:10};`);
    const w = await recurrent(E, 0, true, 3);
    ok(attr(w.warn, 'data-refused') === '1' && /ne sera pas versé à la clôture si le cours ne remonte pas/.test(w.warn), `fenêtre du récurrent : « ${w.warn.replace(/<[^>]+>/g, '').slice(0, 140)}… »`);
    const holders0 = E.eng.json(`state.players.map(p=>p.cash)`), m1 = E.money();
    closeSemester(E);
    ok(E.eng.json(`state.players.map(p=>p.cash)`).every((c, k) => near(c, holders0[k], 1e-12)) && E.eng.run(`${E.co(0)}.typeReserve.red`) === 20 && near(E.price(0), 12 * US, 1e-15),
      'récurrent non versé : aucun joueur payé, sac type à 20 rouges, cours inchangé');
    ok(E.eng.run(`__logs.some(l=>/🚫/.test(l) && /récurrent automatique NON versé/.test(l))`) && near(m1, E.money(), 1e-9), 'journal : récurrent non versé ; monnaie conservée');
  }
  // f) Récurrent 1 $ + annonce de 1 M$ (5 $) faite à 100 $ : à 12 $ (au plus 2 $), le récurrent passe d'abord, l'annonce
  //    est réduite à 1 $ par action ; cours -> 10 $.
  {
    const F = await partie(o, ['dividende'], { real100: true });
    prep(F, 0, { bnr: 0 });
    F.setup(0, `A.dividendBenchmarkPerShare = ${1 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
    await annoncer(F, 0, 1);
    F.setup(0, `A.stockPrice = ${12 * US}; A.dividendRecurrentChangedSemesterIdx = -1;`);
    const w = await recurrent(F, 0, true, 3);
    ok(/le dividende annoncé ce semestre sera réduit ou annulé à la clôture/.test(w.warn), 'fenêtre du récurrent : « sera réduit ou annulé à la clôture »');
    const m1 = F.money();
    closeSemester(F);
    ok(near(F.price(0), 10 * US, 1e-12) && F.eng.run(`state.dividendAnnouncements.length`) === 0 && near(m1, F.money(), 1e-9), `récurrent versé d'abord, annonce réduite à 1 $ : cours 12 -> ${fmt$(F.price(0))}, monnaie conservée`);
  }
  // g) Forme fermée : cours 12 $, garde 10 $, BNR 8 $ par action (1,6 M$) : au plus √(2 × 8) = 4 $ par action.
  {
    const G = await partie(o, ['garp'], { real100: true });
    prep(G, 0, { bnr: 1.6, price: 12 });
    const no = await annoncer(G, 0, 0.82);
    ok(!no.announced && /au plus 4\.00 \$ par action/.test(no.preview), '4,10 $ par action refusés : au plus 4,00 $ (√(2 × 8))');
    const yes = await annoncer(G, 0, 0.6);
    closeSemester(G);
    ok(yes.announced && near(G.price(0), (12 - 1.125) * US, 1e-12), `3 $ par action acceptés : baisse 3 × 3 ÷ 8 = 1,125 $ (${fmt$(G.price(0))})`);
  }
  // h) Scénario du réviseur sur plusieurs semestres : descente à la garde par un gros dividende, puis la caisse vidée
  //    chaque semestre (annonces posées directement) ; seul, puis avec un allié qui achète 100 000 parts de la banque.
  for(const ally of [false, true]){
    const H = await partie(o, ['garp', 'garp']);
    prep(H, 0, { bnr: 0, cash: 40, roll: 0 });
    const m1 = H.money();
    const big = await annoncer(H, 0, 18);
    closeSemester(H);
    ok(big.announced && near(H.price(0), 10 * US, 1e-12), `${ally ? '[allié] ' : ''}18 M$ (90 $ par action) : cours 100 -> 10 $, sur la garde`);
    if(ally) H.eng.json(`(function(){ const co=${H.co(0)}; const b=state.players[1]; return tradeCompanyShares(co, b, 'buy', 100000*co.stockPrice); })()`);
    const alice0 = H.eng.run(`state.players[0].cash`), bob0 = H.eng.run(`state.players[1].cash`), co0 = H.eng.run(`${H.co(0)}.cash`);
    for(let k = 0; k < 4; k++){ pushAnnouncement(H, 0, Math.floor(H.eng.run(`${H.co(0)}.cash`) * 1e6) / 1e6); closeSemester(H); }
    ok(near(H.eng.run(`state.players[0].cash`), alice0, 1e-9) && near(H.eng.run(`state.players[1].cash`), bob0, 1e-9) && near(H.eng.run(`${H.co(0)}.cash`), co0, 1e-6) && near(H.price(0), 10 * US, 1e-12),
      `${ally ? '[allié] ' : ''}quatre semestres à vider la caisse : plus rien ne sort (Alice ${alice0.toFixed(3)} -> ${H.eng.run(`state.players[0].cash`).toFixed(3)}, caisse ${co0.toFixed(3)} -> ${H.eng.run(`${H.co(0)}.cash`).toFixed(3)})`);
    ok(near(m1, H.money(), 1e-9), `${ally ? '[allié] ' : ''}monnaie conservée`);
  }
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
  ok(/environ/.test(txt) && /15\.00 \$ par action/.test(txt) && /rendement 15 %/.test(txt) && /BNR 30\.00 \$ par action \(6\.00 M\$ pour les actionnaires\)/.test(txt) && /ratio 50 %/.test(txt) && /soit 7,5 %/.test(txt) && near(r.drop, 7.5 * US, 1e-11),
    `annonce : dividende par action, rendement, BNR total et par action, ratio, « environ 7.50 $ par action, soit 7,5 % » (${fmt$(r.drop)})`);
  ok(/bénéfices non répartis \(BNR\)/.test(r.html) && !/1 à 2 cubes rouges \(jusqu'à 100 %\)|6 à 8/.test(r.html), 'ligne fixe : la règle des BNR en langage de joueur, plus les anciens paliers');
  const fixed = (/<div class="small" style="margin-bottom:6px;color:var\(--muted\);">([^<]*)<\/div>/.exec(r.html) || [])[1] || '';
  ok(fixed.split(/\.(\s|$)/).filter(x => x.trim().length > 3).length <= 2 && /0, 1 ou 2 cubes rouges/.test(fixed), `ligne fixe : deux phrases au plus (« ${fixed.slice(0, 90)}… »)`);
  ok(attr(r.preview, 'data-alarm') === '1' && /⚠️/.test(r.preview), 'baisse de 7,5 % du cours : aperçu en alerte');
  const N = await partie(o, ['garp'], { real100: true });
  prep(N, 0, { bnr: 6 });
  const small = await annoncer(N, 0, 0.1);
  ok(attr(small.preview, 'data-alarm') === '0' && !/⚠️/.test(small.preview) && !/brick/.test(small.preview), `0,1 M$ (baisse de 0,01 $ sur 100 $) : aperçu neutre, sans ⚠️ ni rouge (« ${small.preview.replace(/<[^>]+>/g, '').slice(0, 80)}… »)`);
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

scenario('S12', 'cubes rouges des annonces : symboliques et fixes, sur le ratio de distribution par action du dernier semestre clos', 'fail', async (o, ok) => {
  // Bénéfice de référence = semestre 1 (clos) ; annonces au semestre 2. 200 000 parts.
  const cas = [
    ['bénéfice 1 M$ (5 $ par action), 0,8 M$ (4 $) = 80 %', 1, 0.8, 0],
    ['bénéfice 1 M$, 0,9 M$ = 90 %', 1, 0.9, 1],
    ['bénéfice 1 M$, 25 M$ = 2500 %', 1, 25, 1],
    ['bénéfice de 1 $, 2 M$', 1e-6, 2, 1],
    ['bénéfice nul, 0,1 M$', 0, 0.1, 1],
    ['bénéfice −0,5 M$, 10 000 $', -0.5, 0.01, 2],
  ];
  for(const [label, ni, amount, want] of cas){
    for(const bank of [0, 50, 70]){
      for(const mode of ['min', 'max']){
        const T = await partie(o, ['garp'], { real100: bank === 0 });
        if(bank === 50) bankShare(T, 0, 50);
        prep(T, 0, { netIncome: ni, bnr: 50, cash: 40 });
        const r = await annoncer(T, 0, amount, mode);
        closeMode(T, mode);
        const reds = T.reds320();
        if(reds !== want || r.added !== want || !r.announced) ok(false, `[banque ${bank} %, ${mode}] ${label} : ${reds} rouge(s) au sac fondamental (attendu ${want})`);
      }
    }
    ok(true, `${label} : ${want} cube(s) rouge(s), banque à 0 %, 50 % ou 70 %, tirage bas ou haut (quantité fixe)`);
  }
  // Récurrent seul, même sur un bénéfice négatif : aucun cube.
  const R = await partie(o, ['dividende'], { real100: true });
  prep(R, 0, { netIncome: -1, bnr: 50 });
  R.setup(0, `A.dividendBenchmarkPerShare = ${5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  closeSemester(R);
  ok(R.reds320() === 0, 'récurrent seul sur un bénéfice négatif : aucun cube');
  // Cumul : 50 % (0) puis 90 % (1) ; jeune entreprise : 1 puis 2 quand son bénéfice (semestre en cours) devient négatif.
  const C = await partie(o, ['garp'], { real100: true });
  prep(C, 0, { netIncome: 1, bnr: 50 });
  const c1 = await annoncer(C, 0, 0.5), c2 = await annoncer(C, 0, 0.4), c3 = await annoncer(C, 0, 0.1);
  ok(c1.added === 0 && c2.added === 1 && c3.added === 0 && C.reds320() === 1, `cumul : 50 % -> ${c1.added}, 90 % -> +${c2.added}, 100 % -> +${c3.added} (total ${C.reds320()})`);
  const Y = await partie(o, ['garp', 'garp']);
  Y.eng.run(`state.gameClock.rollCount = 7;`);
  await Y.eng.run(`createCompany(${JSON.stringify(Y.ids[2])}, 'Co Chloe', '', 'garp', null, null, null)`);
  Y.eng.run(`applyCompanyIpoFunding(${Y.co(2)});`);
  Y.setup(2, `{ const b = A.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = ${JSON.stringify(Y.ids[0])}; } A.cash = 40; __ovIS[A.id+':2'] = 1;`);
  const y1 = await annoncer(Y, 2, 0.9);
  Y.setup(2, `__ovIS[A.id+':2'] = -1;`);
  const y2 = await annoncer(Y, 2, 0.01);
  ok(y1.added === 1 && y2.added === 1, `jeune entreprise (référence = semestre en cours) : 90 % -> ${y1.added} ; bénéfice devenu négatif -> +${y2.added} (total 2)`);
  // Rejugement à la clôture sur le MÊME bénéfice de référence : versé = annoncé, rien de plus.
  ok(C.eng.run(`${C.co(0)}.dividendPenaltyRefNetIncome`) === 1, 'bénéfice de référence mémorisé à l\'annonce (1 M$)');
  closeSemester(C);
  ok(C.reds320() === 1, `clôture : même palier, aucun cube de plus (${C.reds320()})`);
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

scenario('S15', 'BNR par action réels, « des pommes avec des pommes » : banque à 0 %, 50 % ou 70 %, deux dividendes successifs', 'fail', async (o, ok) => {
  const drops = {};
  for(const bank of [0, 50, 70]){
    // Un semestre à 2 M$ de bénéfice (semestre 0), 200 000 parts : BNR 10 $ par action (ajustés : 2 M$ × part des joueurs).
    const T = await partie(o, ['garp'], { real100: bank === 0 });
    if(bank === 50) bankShare(T, 0, 50);
    prep(T, 0, { netIncome: 0, roll: 3 });
    T.setup(0, `__ovIS[A.id+':0'] = 2;`);
    if(o.engine === 'new'){
      const b = T.eng.json(`__realBNR(${T.co(0)}, 1)`);
      ok(near(b.perShare, 10 * US, 1e-12) && near(b.adjusted, 2 * (100 - bank) / 100, 1e-9), `banque ${bank} % : BNR 10 $ par action, ajustés ${b.adjusted.toFixed(2)} M$`);
    }
    const m0 = T.money();
    await annoncer(T, 0, 1.0);                       // 5 $ par action : ratio 0,5, baisse 2,50 $
    let p0 = T.price(0); closeSemester(T);
    const d1 = p0 - T.price(0);
    if(o.engine === 'new'){
      const b2 = T.eng.json(`__realBNR(${T.co(0)}, 2)`);
      ok(near(b2.perShare, 5 * US, 1e-12), `banque ${bank} % : après un dividende de 5 $ par action, il reste ${fmt$(b2.perShare)} de BNR par action`);
    }
    T.setup(0, `A.stockPrice = ${100 * US};`);
    await annoncer(T, 0, 1.0);                       // 5 $ sur 5 $ : ratio 1, baisse 5 $
    p0 = T.price(0); closeSemester(T);
    const d2 = p0 - T.price(0);
    ok(near(d1, 2.5 * US, 1e-11) && near(d2, 5 * US, 1e-11), `banque ${bank} % : 1er dividende de 5 $ -> baisse ${fmt$(d1)} ; 2e de 5 $ -> baisse ${fmt$(d2)}`);
    ok(near(m0, T.money(), 1e-9), `banque ${bank} % : monnaie conservée`);
    drops[bank] = [d1, d2];
    // Exemple de Julien : 15 $ par action sur 10 $ de BNR par action : ratio 1,5 plafonné à 1, baisse de 15 $.
    const J = await partie(o, ['garp'], { real100: bank === 0 });
    if(bank === 50) bankShare(J, 0, 50);
    prep(J, 0, { netIncome: 0, roll: 3 });
    J.setup(0, `__ovIS[A.id+':0'] = 2;`);
    await annoncer(J, 0, 3.0);
    const q0 = J.price(0); closeSemester(J);
    ok(near(q0 - J.price(0), 15 * US, 1e-11), `banque ${bank} % : 15 $ par action sur 10 $ de BNR par action : baisse de 15 $ (${fmt$(q0 - J.price(0))})`);
  }
  ok(near(drops[0][1], drops[50][1], 1e-15) && near(drops[0][1], drops[70][1], 1e-15), 'mêmes baisses avec la banque à 0 %, 50 % et 70 %');
});

scenario('S16', 'BNR en dollars : dividende versé avant l’IPO, puis IPO tardive (parts émises 60 000 -> 200 000)', 'fail', async (o, ok) => {
  const eng = loadEngine({ transform: o.transform });
  await eng.run(`createGame(['Alice', 'Bob'], 20, 1000, 'M$', {}, [])`);
  const ids = eng.json(`state.players.map(p=>p.id)`);
  await eng.run(`createCompany(${JSON.stringify(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(c){ return {price:c.stockPrice, gameOver:false}; };
    globalThis.__ovIS = {}; globalThis.__realIS = incomeStatementFor;
    incomeStatementFor = function(id, sem){ const r = __realIS(id, sem); const k2 = id+':'+sem; if(__ovIS[k2]!==undefined) r.netIncome = __ovIS[k2]; else if(__ovIS[id]!==undefined) r.netIncome = __ovIS[id]; return r; };`);
  const T = { eng, ids, co: () => `state.companies[0]` };
  eng.run(`(function(){ const c = state.companies[0]; __ovIS[c.id] = 0; __ovIS[c.id+':0'] = 2; c.cash = 20; state.gameClock.rollCount = 3; })()`);
  const issued0 = eng.run(`state.companies[0].sharesIssued`);
  pushAnnouncement(T, 0, 0.6);                      // 0,6 M$ sur les parts émises avant l'IPO
  eng.run(`(function(){ const r = state.gameClock.rollCount; state.gameClock.rollCount = Math.floor(r/3)*3 + 2; advanceGameClock(); })()`);
  eng.run(`applyCompanyIpoFunding(state.companies[0]);`);
  const issued1 = eng.run(`state.companies[0].sharesIssued`);
  const b = eng.json(`dividendRetainedEarnings(state.companies[0], 2)`);
  ok(issued0 < issued1 && near(b.retainedEarnings, 1.4, 1e-9) && near(b.perShare, 1.4 / issued1, 1e-15),
    `IPO : ${issued0} -> ${issued1} parts ; BNR 2 − 0,6 = ${b.retainedEarnings.toFixed(4)} M$, soit ${fmt$(b.perShare)} par action aux parts actuelles (et non 0 $ : 10 $ par action d'avant comptés aux parts d'aujourd'hui)`);
  // Une partie enregistrée par la version précédente (cumul par action dans l'état) se charge.
  const saved = eng.run(`(function(){ const s = JSON.parse(JSON.stringify(state)); s.companies[0].dividendPerShareBySemester = {1: 1e-5}; return JSON.stringify(s); })()`);
  let err = null;
  try { eng.run(`state = JSON.parse(${JSON.stringify(saved)}); migrateState(state);`); } catch(e){ err = e; }
  ok(!err && near(eng.json(`dividendRetainedEarnings(state.companies[0], 2)`).perShare, b.perShare, 1e-15), 'partie portant l\'ancien cumul par action : se charge, le cumul est ignoré');
});

scenario('S17', 'options : ajustement proportionnel au versement (strike × f, contrats ÷ f), sans gain fabriqué', 'fail', async (o, ok) => {
  const res = {};
  for(const avec of [false, true]){
    const T = await partie(o, ['garp'], { real100: true });
    prep(T, 0, { bnr: 6 });
    const m0 = T.money();
    const A = T.co(0);
    const open = T.eng.json(`(function(){ const co=${A}; const bob=state.players[1], chloe=state.players[2];
      const a = openOptionPosition(co, bob, 'put', 'long', 100e-6, 12, 20);
      const b = openOptionPosition(co, chloe, 'call', 'long', 90e-6, 12, 10);
      const c = openOptionStrategy(co, bob, 'bearSpread', 'buy', 95e-6, 105e-6, 12, 5);
      return [a.ok, b.ok, c.ok, a.error||b.error||c.error||null]; })()`);
    const bob0 = T.eng.run(`state.players[1].cash - (state.players[1].cumDividendsReceived||0)`); // hors dividendes reçus (Bob détient aussi des actions)
    const before = T.eng.json(`state.players.flatMap(p=>(p.optionPositions||[]).map(x=>({k:x.strike, n:x.shares, cost:x.shares*x.premiumAtOpen})))`);
    if(avec) await annoncer(T, 0, 3);
    T.eng.run(`globalThis.__snap = snapshotPlayerBondsAndLoans(); 1`);
    closeSemester(T);
    const after = T.eng.json(`state.players.flatMap(p=>(p.optionPositions||[]).map(x=>({k:x.strike, n:x.shares, cost:x.shares*x.premiumAtOpen})))`);
    if(avec){
      const f = 92.5 / 100;
      ok(open[0] && open[1] && open[2], `positions ouvertes : put long, call long, bear spread (${JSON.stringify(open)})`);
      ok(after.length === before.length && after.every((x, j) => near(x.k, before[j].k * f, 1e-12) && near(x.n, before[j].n / f, 1e-9) && near(x.cost, before[j].cost, 1e-15)),
        `f = 0,925 : strikes ${before.map(x => (x.k / US).toFixed(1)).join(', ')} -> ${after.map(x => (x.k / US).toFixed(3)).join(', ')} ; contrats ÷ f ; coût d'ouverture (contrats × prime) inchangé`);
      const legs = T.eng.json(`state.players[1].optionPositions.filter(x=>x.strategyId).map(x=>({k:x.strike, n:x.shares}))`);
      ok(legs.length === 2 && near(Math.abs(legs[0].k - legs[1].k) * legs[0].n, 10 * US * 5, 1e-12), 'bear spread : largeur × contrats conservée (10 $ × 5)');
      ok(T.eng.json(`__logs`).filter(l=>/🔧/.test(l) && /fractionnement/.test(l) && /100\.00 \$ → 92\.50 \$/.test(l) && /20 contrats → 21,62/.test(l)).length === 1, 'une ligne de journal : proportion et exemple (strike 100 $ → 92,50 $, 20 contrats → 21,62)');
      const dv = T.eng.json(`(function(){ const d = computePlayerPortfolioDeltas(__snap); const co=${A}; const pl = state.players[2]; const pos = pl.optionPositions[0];
        const hist = co.stockPriceHistory; const pricePrev = hist[hist.length-2].price; const r = state.settings.riskFreeRateAnnual||0;
        const Tprev = Math.max(0, (pos.expiryRoll-(state.gameClock.rollCount-1))/6);
        const want = (optionPremiumFor(co, pos.type, pos.strike, pos.expiryRoll, false)*pos.shares - blackScholesPremium(pricePrev, 90e-6, Tprev, r, companyAnnualSigma(co), pos.type)*10) * OPTION_CONTRACT_MULTIPLIER;
        return {got: d[pl.id].optionVar, want}; })()`);
      ok(near(dv.got, dv.want, 1e-12), `variation du portefeuille de Chloé : ${dv.got.toFixed(6)} M$ = valeur d'après − valeur d'avant (10 contrats au strike de 90 $) (${dv.want.toFixed(6)})`);
    } else {
      ok(after.every((x, j) => near(x.k, before[j].k, 1e-15) && near(x.n, before[j].n, 1e-12)), 'sans dividende : strikes et contrats inchangés');
    }
    const pos = T.eng.json(`state.players[1].optionPositions.filter(x=>!x.strategyId).map(x=>({id:x.id, shares:x.shares}))`);
    T.eng.json(`(function(){ const r = closeOptionPosition(state.players[1], ${JSON.stringify(pos[0].id)}, ${pos[0].shares}); return r.ok; })()`);
    res[avec] = T.eng.run(`state.players[1].cash - (state.players[1].cumDividendsReceived||0)`) - bob0;
    ok(near(m0, T.money(), 1e-9), `${avec ? 'avec' : 'sans'} annonce : monnaie conservée`);
  }
  ok(Math.abs(res[true] - res[false]) < 0.05, `put de Bob revendu : gain net ${res[true].toFixed(4)} M$ avec annonce, ${res[false].toFixed(4)} M$ sans (pas de gain fabriqué par la baisse)`);
});

scenario('S19', 'options : valeur de marché de chaque position inchangée par l’ajustement (call, put, bear spread, straddle ; achetés et vendus ; baisse de 4 % et de 90 %)', 'fail', async (o, ok) => {
  for(const f of [0.96, 0.10]){
    const T = await partie(o, ['garp'], { real100: true });
    prep(T, 0, { bnr: 6 });
    const A = T.co(0);
    // Chloé détient 10 000 parts : ses 100 calls écrits sont couverts ; après une grosse baisse, ils le sont en partie.
    T.eng.run(`(function(){ const co=${A}; const bob = co.shareholders.find(s=>s.playerId===state.players[1].id); bob.shares -= 10000; co.shareholders.push({playerId: state.players[2].id, shares: 10000}); })()`);
    const open = T.eng.json(`(function(){ const co=${A}; const bob=state.players[1], chloe=state.players[2]; const out = [];
      out.push(openOptionPosition(co, bob, 'call', 'long', 105e-6, 12, 7));
      out.push(openOptionPosition(co, bob, 'put', 'long', 95e-6, 12, 9));
      out.push(openOptionPosition(co, chloe, 'call', 'short', 110e-6, 12, 100));
      out.push(openOptionPosition(co, chloe, 'put', 'short', 90e-6, 12, 3));
      out.push(openOptionStrategy(co, bob, 'bearSpread', 'buy', 95e-6, 105e-6, 12, 4));
      out.push(openOptionStrategy(co, chloe, 'bearSpread', 'sell', 95e-6, 105e-6, 12, 2));
      out.push(openOptionStrategy(co, bob, 'straddle', 'buy', 0, 0, 12, 3));
      out.push(openOptionStrategy(co, chloe, 'straddle', 'sell', 0, 0, 12, 1));
      return out.map(r=>r.ok ? 'ok' : r.error); })()`);
    ok(open.every(x => x === 'ok'), `[f = ${f}] huit ouvertures : ${JSON.stringify(open)}`);
    const valueCode = `(function(){ const co=${A}; const S = co.stockPrice; const r = state.settings.riskFreeRateAnnual||0;
      return state.players.flatMap(p=>(p.optionPositions||[]).filter(x=>x.companyId===co.id).map(x=>({id:x.id,
        v: (x.side==='long'?1:-1) * x.shares * OPTION_CONTRACT_MULTIPLIER * blackScholesPremium(S, x.strike, (x.expiryRoll-state.gameClock.rollCount)/6, r, __sigma0, x.type),
        cost: x.shares * x.premiumAtOpen, k: x.strike, n: x.shares }))); })()`;
    T.eng.run(`globalThis.__sigma0 = companyAnnualSigma(${A});`);
    const v0 = T.eng.json(valueCode);
    const nw0 = T.eng.json(`state.players.map(p=>netWorth(p))`);
    T.eng.run(`(function(){ const co=${A}; const S0 = co.stockPrice; co.stockPrice = S0*${f}; adjustOptionsForDividend(co, S0, co.stockPrice); })()`);
    const v1 = T.eng.json(valueCode);
    const worst = Math.max(...v0.map((x, j) => Math.abs(x.v - v1[j].v) / Math.max(1e-9, Math.abs(x.v))));
    ok(v1.length === v0.length && v0.every((x, j) => near(x.v, v1[j].v, Math.max(1e-12, 1e-9 * Math.abs(x.v)))), `[f = ${f}] valeur de marché de chacune des ${v0.length} positions inchangée, à volatilité égale (écart relatif max ${worst.toExponential(1)})`);
    ok(v0.every((x, j) => near(x.cost, v1[j].cost, 1e-15) && near(v1[j].k, x.k * f, 1e-15) && near(v1[j].n, x.n / f, 1e-9)), `[f = ${f}] strikes × f, contrats ÷ f, coût d'ouverture inchangé`);
    // Rien ne casse : marge, étiquettes, appels de marge (aucun déclenché par l'ajustement seul), fermeture partielle.
    T.eng.run(`__logs.length = 0;`);
    const probe = T.eng.json(`(function(){ const co=${A}; const out = {};
      out.margin = state.players.map(p=>requiredMaintenanceMargin(p));
      out.labels = state.players.flatMap(p=>(p.optionPositions||[]).map(x=>optionPositionStrategyLabel(p, co, x)));
      out.naked = playerNakedWrittenContracts(state.players[2], co.id);
      enforceMarginCalls();
      return out; })()`);
    const marginCalls = T.eng.json(`__logs.filter(l=>/Appel de marge/i.test(l))`);
    ok(probe.margin.every(x => isFinite(x)) && probe.labels.every(x => typeof x === 'string') && marginCalls.length === 0,
      `[f = ${f}] marge et étiquettes calculées sans erreur (contrats nus de Chloé : ${probe.naked.toFixed(2)}), aucun appel de marge déclenché par l'ajustement seul`);
    const nw1 = T.eng.json(`state.players.map(p=>netWorth(p))`);
    void nw0; void nw1;
    const part = T.eng.json(`(function(){ const pos = state.players[1].optionPositions.find(x=>!x.strategyId && x.type==='call'); const n = pos.shares; const r = closeOptionPosition(state.players[1], pos.id, n/3); return {ok:r.ok, err:r.error||null, left: pos.shares, n}; })()`);
    ok(part.ok && near(part.left, part.n * 2 / 3, 1e-9), `[f = ${f}] fermeture partielle d'un tiers des ${part.n.toFixed(4)} contrats : ${part.left.toFixed(4)} restants`);
    // Règlement à l'échéance : le put long de Bob (9 contrats à 95 $ avant l'ajustement) exercé au même montant total
    // (contrats ÷ f × 100 × strike × f = 9 × 100 × 95 $), avec 1/f fois plus de parts livrées.
    const ex = T.eng.json(`(function(){ const co=${A}; const bob=state.players[1]; const pos = bob.optionPositions.find(x=>!x.strategyId && x.type==='put');
      bob.optionPositions = [pos]; state.players.forEach(p=>{ if(p!==bob) p.optionPositions = []; }); // ce put seul à l'échéance
      const n = pos.shares; co.stockPrice = pos.strike*0.5; state.gameClock.rollCount = pos.expiryRoll; const c0 = bob.cash;
      const st = co.shareholders.find(s=>s.playerId===bob.id); const s0 = st.shares; settleExpiredOptions();
      return {cash: bob.cash - c0, shares: s0 - st.shares, n}; })()`);
    ok(near(ex.cash, 9 * 100 * 95 * US, 1e-9) && near(ex.shares, 900 / f, 1e-6), `[f = ${f}] put exercé à l'échéance : ${ex.cash.toFixed(6)} M$ encaissés (= 9 × 100 × 95 $), ${ex.shares.toFixed(1)} parts livrées (900 ÷ f)`);
  }
});

scenario('S20', 'découvert : paie le dividende versé, le montant réduit, rien pour une annonce annulée', 'fail', async (o, ok) => {
  for(const [label, priceAtClose, perShare] of [['versée', 100, 15], ['réduite', 12, 2], ['annulée (à la garde)', 10, 0]]){
    const T = await partie(o, ['garp']);
    prep(T, 0, { bnr: 0 });
    T.eng.run(`accrueShortBorrowFees = function(){};`); // frais d'emprunt neutralisés : seul le paiement compensatoire compte
    const sh = T.eng.json(`(function(){ const r = openShortPosition(${T.co(0)}, state.players[2], 1); return {ok:r.ok, err:r.error||null, shares: (state.players[2].shortPositions[${T.co(0)}.id]||{}).shares}; })()`);
    const r = await annoncer(T, 0, 3);
    T.setup(0, `A.stockPrice = ${priceAtClose * US};`);
    const c0 = T.eng.run(`state.players[2].cash`), m1 = T.money();
    closeSemester(T);
    const paid = c0 - T.eng.run(`state.players[2].cash`);
    ok(sh.ok && r.announced && near(paid, sh.shares * perShare * US, 1e-9) && near(m1, T.money(), 1e-9),
      `annonce de 3 M$ ${label} : le vendeur à découvert (${sh.shares} parts) paie ${paid.toFixed(4)} M$ (= parts × ${perShare} $), monnaie conservée${sh.ok ? '' : ' — ' + sh.err}`);
  }
});

scenario('S21', 'garde graduée (scénario vu à l’écran) : récurrent d’abord, puis les annonces dans l’ordre, la dernière réduite', 'fail', async (o, ok) => {
  // Cours 100 $, BNR 10 $ par action, récurrent 1,50 $, annonces de 1 M$ (5 $) puis 16,7 M$ (83,50 $, le maximum affiché).
  // Les cubes font glisser le cours à 98,23 $ : maximum 88,23 $ ; récurrent 1,50 $ versé, 1 M$ versé en entier, 16,7 M$
  // réduit à 81,73 $ par action (16,346 M$), 0,354 M$ rendu, cours final 10 $.
  const T = await partie(o, ['dividende']);
  prep(T, 0, { bnr: 2 });
  T.setup(0, `A.dividendBenchmarkPerShare = ${1.5 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  const a1 = await annoncer(T, 0, 1);
  const a2 = await annoncer(T, 0, 16.7);
  ok(a1.announced && a2.announced, `annonces acceptées (maximum affiché avant la 2e : ${(a2.preview.match(/maximum encore permis ce semestre : ([^ ]+ M\$)/) || [])[1] || '?'})`);
  T.setup(0, `A.stockPrice = ${98.23 * US};`);
  const m1 = T.money();
  const holders0 = T.eng.json(`state.players.map(p=>p.cash)`), cash0 = T.eng.run(`${T.co(0)}.cash`);
  closeSemester(T);
  const id = T.eng.run(`${T.co(0)}.id`);
  const alice = T.eng.run(`state.players[0].cash`) - holders0[0]; // Alice : 60 000 parts
  ok(near(T.price(0), 10 * US, 1e-12), `cours final ${fmt$(T.price(0))} (sur la garde, ni refusé ni rogné)`);
  ok(near(alice, 60000 * (1.5 + 5 + 81.73) * US, 1e-6), `Alice (60 000 parts) reçoit 1,50 + 5 + 81,73 $ par action = ${alice.toFixed(4)} M$`);
  ok(T.eng.json(`__logs`).some(l=>/✂️/.test(l) && /réduit de 16\.70 M\$ à 16\.35 M\$/.test(l) && /354 K\$ rendu/.test(l)), 'journal : « réduit de 16,70 M$ à 16,35 M$ … 354 K$ rendu »');
  ok(near(T.eng.run(`dividendPaidInSemester(${JSON.stringify(id)}, 2)`), 0.3 + 1 + 16.346, 1e-6), `déclarés au semestre : 0,3 (récurrent) + 1 + 16,346 = ${T.eng.run(`dividendPaidInSemester(${JSON.stringify(id)}, 2)`).toFixed(4)} M$`);
  if(o.engine === 'new') ok(near(T.eng.json(`__realBNR(${T.co(0)}, 3)`).ordinaryPaid, 17.646, 1e-6), 'BNR du semestre suivant : 17,646 M$ de dividendes déduits (le montant réduit, pas 18 M$)');
  ok(near(m1, T.money(), 1e-9), 'monnaie conservée');
  void cash0;
});

scenario('S18', 'Momentum : la baisse du versement n’est pas lue comme un semestre perdu (sonde p6)', 'fail', async (o, ok) => {
  const out = {};
  for(const amount of [0, 1.2]){
    const T = await partie(o, ['momentum'], { real100: true });
    prep(T, 0, { bnr: 0 });
    T.setup(0, `A.momentumRefPrice = ${95 * US}; A.momentumTrendDir = 'up'; A.momentumTrendStreak = 4;`);
    if(amount) await annoncer(T, 0, amount);
    closeSemester(T);
    out[amount] = T.eng.json(`(function(){ const c=${T.co(0)}; return {p:c.stockPrice, dir:c.momentumTrendDir, streak:c.momentumTrendStreak, tr:c.typeReserve, ref:c.momentumRefPrice}; })()`);
  }
  ok(near(out[1.2].p, 94 * US, 1e-12) && out[1.2].dir === 'up' && out[1.2].streak === out[0].streak && JSON.stringify(out[1.2].tr) === JSON.stringify(out[0].tr),
    `6 $ de dividende sans BNR : cours 100 -> ${fmt$(out[1.2].p)}, tendance ${out[1.2].dir} ${out[1.2].streak} (sans dividende : ${out[0].dir} ${out[0].streak}), sac type identique ${JSON.stringify(out[1.2].tr)}`);
});

scenario('S22', 'sonde p4 du réviseur : acheteur et vendeur de puts, avec ou sans l’annonce de 18 M$ (volatilité fixée)', 'pass', async (o, ok) => { // moteur d'avant : ni baisse ni ajustement, donc rien à comparer (« pass »)
  // 50 puts K = 100 $ achetés ou vendus juste après l'annonce, revendus ou rachetés après la clôture (cours 100 -> 10 $).
  // Volatilité fixée à 15 % (elle dépend aussi de la taille de l'entreprise, que l'annonce change : effet à part).
  const pct = {};
  for(const side of ['long', 'short']){
    for(const avec of [false, true]){
      const T = await partie(o, ['garp', 'garp', 'garp']);
      prep(T, 0, { bnr: 0 });
      T.eng.run(`companyAnnualSigma = function(){ return 0.15; };`);
      const m0 = T.money();
      if(avec) pushAnnouncement(T, 0, 18);
      const bob = `state.players[1]`;
      const c0 = T.eng.run(`${bob}.cash - (${bob}.cumDividendsReceived||0)`);
      const open = T.eng.json(`(function(){ const r = openOptionPosition(${T.co(0)}, ${bob}, 'put', ${JSON.stringify(side)}, 100e-6, 12, 50); return r.ok || r.error; })()`);
      const prime = Math.abs(c0 - T.eng.run(`${bob}.cash - (${bob}.cumDividendsReceived||0)`));
      closeSemester(T);
      const pos = T.eng.json(`${bob}.optionPositions.map(x=>({id:x.id, shares:x.shares}))`);
      const close = T.eng.json(`(function(){ const r = closeOptionPosition(${bob}, ${JSON.stringify(pos[0].id)}, ${pos[0].shares}); return r.ok || r.error; })()`);
      const net = T.eng.run(`${bob}.cash - (${bob}.cumDividendsReceived||0)`) - c0;
      pct[side + avec] = net / prime;
      if(o.verbose) console.log(`    ${side === 'long' ? 'acheteur' : 'vendeur '} ${avec ? 'avec annonce' : 'sans annonce'} : ouverture ${open}, prime ${prime.toFixed(5)} M$, cours ${fmt$(T.price(0))}, rachat ${close}, résultat net ${net.toFixed(5)} M$ (${(net / prime * 100).toFixed(1)} % de la prime)`);
      ok(open === true && close === true && near(m0, T.money(), 1e-9), `${side === 'long' ? 'acheteur' : 'vendeur'} ${avec ? 'avec' : 'sans'} annonce : ouverture et rachat faits, monnaie conservée`);
    }
  }
  ok(Math.abs(pct.longtrue - pct.longfalse) < 0.01, `acheteur : ${(pct.longtrue * 100).toFixed(1)} % de la prime avec l'annonce, ${(pct.longfalse * 100).toFixed(1)} % sans (avant, ajustement additif : −94 %)`);
  ok(pct.shorttrue <= pct.shortfalse + 0.01, `vendeur : ${(pct.shorttrue * 100).toFixed(1)} % de la prime avec l'annonce, ${(pct.shortfalse * 100).toFixed(1)} % sans (son gain ne dépasse pas celui sans annonce)`);
});

scenario('S23', 'ordre d’achat à cours limité : exécuté au cours s’il est plus bas que la limite (sonde p9)', 'fail', async (o, ok) => {
  // a) Sonde p9 : Chloé a un ordre d'achat de 10 000 parts à 95 $ ; le versement de 18 M$ fait tomber le cours à 10 $.
  {
    const T = await partie(o, ['garp', 'garp', 'garp']);
    prep(T, 0, { bnr: 0 });
    const m0 = T.money();
    const placed = T.eng.json(`placeBid(state.players[2], ${T.co(0)}, 95e-6, 10000)`);
    pushAnnouncement(T, 0, 18);
    const c0 = T.eng.run(`state.players[2].cash`);
    closeSemester(T);
    const st = T.eng.json(`(function(){ const co=${T.co(0)}; const e = co.shareholders.find(s=>s.playerId===state.players[2].id); return {shares: e?e.shares:0, price: co.stockPrice}; })()`);
    const cost = c0 - T.eng.run(`state.players[2].cash`);
    ok(placed.ok && near(st.price, 10 * US, 1e-12) && near(st.shares, 10000, 1e-6) && near(cost, 0.1, 1e-9), `p9 : ordre à 95 $ exécuté au cours de 10 $ : 10 000 parts payées ${cost.toFixed(3)} M$ (avant : 0,950 M$)`);
    ok(T.eng.json(`__logs`).some(l => /Bid déclenché/.test(l) && /exécuté à 10\.00 \$\/part \(limite 95\.00 \$\)/.test(l)), 'journal : « exécuté à 10,00 $/part (limite 95,00 $) »');
    ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  }
  // b) Cas ordinaire : les cubes font passer le cours sous la limite (97 $ pour une limite de 99 $) : exécuté à 97 $ ;
  //    au-dessus de la limite (101 $), rien.
  {
    const T = await partie(o, ['garp', 'garp', 'garp']);
    prep(T, 0, { bnr: 50 });
    const m0 = T.money();
    T.eng.json(`placeBid(state.players[2], ${T.co(0)}, 99e-6, 1000)`);
    T.setup(0, `A.stockPrice = ${101 * US}; checkPendingOrders(A);`);
    const left = T.eng.run(`state.players[2].pendingBids.length`);
    const c0 = T.eng.run(`state.players[2].cash`);
    T.setup(0, `A.stockPrice = ${97 * US}; checkPendingOrders(A);`);
    const cost = c0 - T.eng.run(`state.players[2].cash`);
    ok(left === 1 && near(cost, 1000 * 97 * US, 1e-12) && T.eng.run(`state.players[2].pendingBids.length`) === 0, `cours à 101 $ : rien ; cours à 97 $ : 1 000 parts à 97 $ (${cost.toFixed(4)} M$), jamais au-dessus de la limite de 99 $`);
    ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  }
});

scenario('S24', 'plafonds d’options en contrats d’origine (sonde p10) ; la marge lit les vrais contrats', 'fail', async (o, ok) => {
  // a) Sonde p10 : Bob, 30 000 parts, 300 calls écrits couverts ; versement de 10 M$ sans BNR : f = 0,5, 600 contrats dont
  //    300 nus en vrais contrats, 150 en contrats d'origine ; la vente de 1 000 parts passe.
  {
    const T = await partie(o, ['garp', 'garp', 'garp']);
    prep(T, 0, { bnr: 0 });
    const A = T.co(0);
    const w = T.eng.json(`(function(){ const co=${A}; const bob=state.players[1]; tradeCompanyShares(co, bob, 'buy', 30000*co.stockPrice); const r = openOptionPosition(co, bob, 'call', 'short', 110e-6, 18, 300); return r.ok || r.error; })()`);
    pushAnnouncement(T, 0, 10);
    closeSemester(T);
    const st = T.eng.json(`(function(){ const co=${A}; const bob=state.players[1]; const pos = bob.optionPositions[0];
      return {n: pos.shares, f: pos.dividendAdjustFactor, naked: playerNakedWrittenContracts(bob, co.id), margin: requiredMaintenanceMargin(bob), price: co.stockPrice}; })()`);
    ok(w === true && near(st.f, 0.5, 1e-12) && near(st.n, 600, 1e-9) && near(st.naked, 150, 1e-9), `f = 0,5 : ${st.n} contrats, facteur ${st.f}, contrats nus comptés au plafond ${st.naked} (contrats d'origine)`);
    ok(near(st.margin, 0.3 * 300 * 100 * st.price, 1e-12), `la marge lit les vrais contrats : 30 % × 300 nus × 100 × ${fmt$(st.price)} = ${st.margin.toFixed(3)} M$`);
    const sell = T.eng.json(`(function(){ const co=${A}; const r = tradeCompanyShares(co, state.players[1], 'sell', 1000*co.stockPrice); return r.ok || r.error; })()`);
    ok(sell === true, `vente de 1 000 parts par Bob : acceptée (${sell})`);
  }
  // b) Au plafond AVANT l'ajustement (300 puts nus) : pas « au-delà » après ; une NOUVELLE vente qui dépasse reste refusée.
  //    c) Fermeture partielle et fusion : facteur cohérent. d) Calls achetés : plafond en contrats d'origine.
  {
    const T = await partie(o, ['garp', 'garp', 'garp']);
    prep(T, 0, { bnr: 0 });
    const A = T.co(0);
    const w = T.eng.json(`(function(){ const co=${A}; const r1 = openOptionPosition(co, state.players[2], 'put', 'short', 90e-6, 18, 300); const r2 = openOptionPosition(co, state.players[1], 'call', 'long', 120e-6, 18, 200); return [r1.ok || r1.error, r2.ok || r2.error]; })()`);
    pushAnnouncement(T, 0, 10);
    closeSemester(T);
    const naked = T.eng.run(`playerNakedWrittenContracts(state.players[2], ${A}.id)`);
    const real = T.eng.run(`state.players[2].optionPositions[0].shares`);
    ok(w[0] === true && w[1] === true && near(naked, 300, 1e-9) && near(real, 600, 1e-9), `Chloé au plafond avant (300 puts nus) : ${real} vrais contrats, ${naked} au plafond — pas au-delà`);
    const k = T.eng.run(`state.players[2].optionPositions[0].strike`);
    const more = T.eng.json(`(function(){ const r = openOptionPosition(${A}, state.players[2], 'put', 'short', ${k}, 18, 1); return r.ok || r.error; })()`);
    ok(more !== true && /Plafond d'options écrites/.test(String(more)), 'une NOUVELLE vente d\'un contrat de plus : refusée (plafond vraiment dépassé)');
    const closeHalf = T.eng.json(`(function(){ const pl=state.players[2]; const pos = pl.optionPositions[0]; const r = closeOptionPosition(pl, pos.id, pos.shares/2); return {ok: r.ok, f: pos.dividendAdjustFactor, n: pos.shares}; })()`);
    ok(closeHalf.ok && near(closeHalf.f, 0.5, 1e-12) && near(T.eng.run(`playerNakedWrittenContracts(state.players[2], ${A}.id)`), 150, 1e-9), `fermeture de la moitié : facteur inchangé (${closeHalf.f}), ${closeHalf.n} contrats = 150 d'origine`);
    const merge = T.eng.json(`(function(){ const pl=state.players[2]; const r = openOptionPosition(${A}, pl, 'put', 'short', ${k}, 18, 10); const pos = pl.optionPositions[0]; return {ok: r.ok || r.error, len: pl.optionPositions.length, n: pos.shares, f: pos.dividendAdjustFactor}; })()`);
    ok(merge.ok === true && merge.len === 1 && near(merge.n * merge.f, 160, 1e-9), `fusion de 10 nouveaux contrats au même strike : ${merge.n} contrats, facteur ${merge.f.toFixed(4)} = 160 contrats d'origine`);
    const lc = T.eng.json(`(function(){ const r = openOptionPosition(${A}, state.players[1], 'call', 'long', 120e-6*0.5, 18, 50); return {ok: r.ok || r.error, n: playerLongCallContracts(state.players[1], ${A}.id)}; })()`);
    ok(lc.ok === true && near(lc.n, 250, 1e-9), `calls achetés : 200 d'origine (400 vrais) + 50 nouveaux acceptés sous le plafond de 300 (${lc.n} d'origine)`);
  }
});

scenario('S25', 'vendeur de calls couverts PROCHE de sa limite de marge : ce que fait l’ajustement (constat)', 'fail', async (o, ok) => {
  // Bob : 30 000 parts, 300 calls couverts (marge 0), et un découvert sur l'entreprise de Chloé qui l'amène à 0,2 M$ de sa
  // marge de maintien. Versement de 10 M$ sans BNR (f = 0,5) : sa valeur nette ne change pas (dividende reçu = baisse
  // de ses parts), mais 300 calls deviennent nus : marge exigée + 0,45 M$. Constat attendu : appel de marge.
  const T = await partie(o, ['garp', 'garp', 'garp']);
  prep(T, 0, { bnr: 0 });
  const A = T.co(0), C = T.co(2);
  T.setup(2, `A.stockPrice = ${100 * US}; A.stockPriceFounding = ${100 * US};`);
  const setup = T.eng.json(`(function(){ const co=${A}, chloeCo=${C}; const bob=state.players[1];
    tradeCompanyShares(co, bob, 'buy', 30000*co.stockPrice);
    const r1 = openOptionPosition(co, bob, 'call', 'short', 110e-6, 18, 300);
    const r2 = openShortPosition(chloeCo, bob, 10);
    const req = requiredMaintenanceMargin(bob), nw = marginableNetWorth(bob);
    bob.cash -= (nw - req - 0.2); state.bank.cash += (nw - req - 0.2);
    return {r1: r1.ok || r1.error, r2: r2.ok || r2.error, req, room: marginableNetWorth(bob) - requiredMaintenanceMargin(bob)}; })()`);
  const m0 = T.money();
  pushAnnouncement(T, 0, 10);
  const nw0 = T.eng.run(`netWorth(state.players[1])`);
  T.eng.run(`accrueShortBorrowFees = function(){}; __logs.length = 0;`);
  closeSemester(T);
  const calls = T.eng.json(`__logs`).filter(l => /Appel de marge/i.test(l));
  const after = T.eng.json(`(function(){ const bob=state.players[1]; return {opts: bob.optionPositions.length, short: !!(bob.shortPositions[${C}.id] && bob.shortPositions[${C}.id].shares>1e-9), nw: netWorth(bob), room: marginableNetWorth(bob) - requiredMaintenanceMargin(bob)}; })()`);
  if(o.verbose) console.log(`    constat : marge libre avant ${setup.room.toFixed(3)} M$ ; ${calls.length} appel(s) de marge à la clôture ; après : ${after.opts} position(s) d'options, découvert ${after.short ? 'ouvert' : 'fermé'}, marge libre ${after.room.toFixed(3)} M$`);
  if(o.verbose && calls.length) console.log(`    « ${calls[0].slice(0, 200)}… »`);
  ok(setup.r1 === true && setup.r2 === true && near(setup.room, 0.2, 1e-9), `mise en place : 300 calls couverts, découvert de 10 M$, marge libre 0,2 M$ (${JSON.stringify(setup)})`);
  ok(calls.length >= 1 && after.room >= -1e-9, `constat : l'ajustement seul (valeur nette ${nw0.toFixed(3)} -> ${after.nw.toFixed(3)} avant frais) déclenche ${calls.length} appel(s) de marge, jusqu'à revenir dans la marge`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
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
  ['BNR sans les dividendes ordinaires d’avant', sub('if(e.semesterIndex<semesterIdx) ordinaryPaid += -e.amount;', 'if(false) ordinaryPaid += -e.amount;'), ['S4', 'S15', 'S16']],
  ['BNR d’avant avec les dividendes nets de la part de la banque', sub("if(e.category==='dividend_payout' || e.category==='dividend_cancelled_return'){", "if(e.category==='dividend_payout' || e.category==='dividend_cancelled_return' || e.category==='dividend_forfeited_return'){"), ['S4', 'S15']],
  ['annonce annulée déduite des BNR', sub("if(e.category==='dividend_payout' || e.category==='dividend_cancelled_return'){", "if(e.category==='dividend_payout'){"), ['S7']],
  ['annonce annulée comptée comme versée', sub("e.semesterIndex===semesterIndex && (e.category==='dividend_payout' || e.category==='dividend_cancelled_return'))", "e.semesterIndex===semesterIndex && e.category==='dividend_payout')"), ['S7']],
  ['BNR par action au cumul de l’état (parts de l’époque)', sub('  const perShare = issued>0 ? retainedEarnings/issued : 0;\n', '  const perShare = issued>0 ? (netIncome - preferredPaid)/issued - ordinaryPaid/(co.ceoShares||60000) : 0;\n'), ['S16']],
  ['garde ignorée à l’annonce', sub('      if(guardPv.refused){', '      if(false){'), ['S7']],
  ['garde ignorée à la clôture', sub('    if(dividendAbsorbable(e.annPerShare + e.recPerShare, co.stockPrice, guard, bnr)) return;', '    return;'), ['S7']],
  ['annonce annulée mais versée quand même', sub('      if(dividendGuard.cancelled.has(ann.id)) return;', '      if(false) return;'), ['S7']],
  ['récurrent non absorbable versé quand même', sub('        if(dividendGuard.recurrentBlocked.has(co.id)){', '        if(false){'), ['S7']],
  ['atterrir sur la garde refusé', sub('  return d <= max*(1+1e-9) + 1e-15;', '  return d < max*(1-1e-9);'), ['S7']],
  ['forme fermée sans racine', sub('  return m>=b ? m : Math.sqrt(m*b);', '  return m;'), ['S7']],
  ['fenêtre du récurrent muette sur le non-versement', sub('  else if(opts.recurrentWindow && !pv.recurrentFits){', '  else if(false){'), ['S7']],
  ['options non ajustées', sub('  adjustOptionsForDividend(co, d.priceBefore, d.priceAfter); // Section 321', '  // Section 321'), ['S17', 'S22']],
  ['seuls les puts ajustés', sub("      if(pos.companyId!==co.id || !(pos.shares>1e-9)) return;\n      const same = ", "      if(pos.companyId!==co.id || !(pos.shares>1e-9) || pos.type!=='put') return;\n      const same = "), ['S17', 'S19']],
  ['f oublié sur les contrats', sub('      pos.shares = pos.shares / f;\n', ''), ['S19']],
  ['f oublié sur la prime d’ouverture', sub("      if(typeof pos.premiumAtOpen==='number') pos.premiumAtOpen = pos.premiumAtOpen * f;\n", ''), ['S19']],
  ['ordre d’achat exécuté à sa limite', sub('  const price = (company && company.stockPrice>0) ? Math.min(bid.price, company.stockPrice) : bid.price;', '  const price = bid.price;'), ['S23']],
  ['facteur oublié dans le plafond des options écrites', sub('naked += c.naked * (Number(pos.dividendAdjustFactor)||1);', 'naked += c.naked;'), ['S24']],
  ['facteur oublié dans le plafond des calls achetés', sub('.reduce((sum,p)=>sum+optionOriginContracts(p), 0);', '.reduce((sum,p)=>sum+p.shares, 0);'), ['S24']],
  ['facteur appliqué à la marge', sub('requiredMargin += SHORT_MARGIN_MAINTENANCE_PCT * cov.naked * OPTION_CONTRACT_MULTIPLIER', 'requiredMargin += SHORT_MARGIN_MAINTENANCE_PCT * cov.naked * (Number(pos.dividendAdjustFactor)||1) * OPTION_CONTRACT_MULTIPLIER'), ['S24']],
  ['facteur non cumulé à l’ajustement', sub('      pos.dividendAdjustFactor = (Number(pos.dividendAdjustFactor)||1) * f;', '      pos.dividendAdjustFactor = 1;'), ['S24']],
  ['fusion sans facteur moyen', sub("    existing.dividendAdjustFactor = (existing.shares*(Number(existing.dividendAdjustFactor)||1) + shares)/(existing.shares+shares);\n", ''), ['S24']],
  ['moyenne des annonces : annulation complète comptée', sub('  const n = entries.length - returns.filter(e=>e.dividendFullyCancelled).length;', '  const n = entries.length;'), ['S7']],
  ['moyenne des annonces : annonce réduite retirée du nombre', sub('  const n = entries.length - returns.filter(e=>e.dividendFullyCancelled).length;', '  const n = entries.length - returns.length;'), ['S7']],
  ['moyenne des annonces : part rendue non retranchée', sub('  return (entries.reduce((s,e)=>s+(-e.amount), 0) - returns.reduce((s,e)=>s+e.amount, 0)) / n;', '  return entries.reduce((s,e)=>s+(-e.amount), 0) / n;'), ['S7']],
  ['f inversé', sub('  const f = priceAfter/priceBefore;', '  const f = priceBefore/priceAfter;'), ['S19', 'S22']],
  ['variation du portefeuille aux contrats d’après', sub("const sharesPrev = (adj && typeof adj.sharesBefore==='number') ? adj.sharesBefore : pos.shares;", 'const sharesPrev = pos.shares;'), ['S17']],
  ['réduction oubliée pour les découverts', sub('      const dividendPerShare = perShare; // Section 307', '      const dividendPerShare = ((dividendGuard.reduced.get(ann.id)||{}).original||ann.amount)/(co.sharesIssued || ann.totalSharesAtAnnouncement || totalRecordShares); // Section 307'), ['S20']],
  ['retour au mauvais semestre', sub("logFin(co.id, 'dividend_cancelled_return', returned, ann.announcedAtRoll||0);", "logFin(co.id, 'dividend_cancelled_return', returned, state.gameClock.rollCount);"), ['S7', 'S21']],
  ['ordre des annonces inversé', sub('((x.ann.announcedAtRoll||0) - (y.ann.announcedAtRoll||0)) || (x.order - y.order)', '((y.ann.announcedAtRoll||0) - (x.ann.announcedAtRoll||0)) || (y.order - x.order)'), ['S21']],
  ['annonce réduite annulée en entier', sub('      const keep = room>1e-15 ? room*denom : 0;', '      const keep = 0;'), ['S7', 'S21']],
  ['récurrent jugé après les annonces', sub("      if(fits(e.recPerShare, room)) room = Math.max(0, room - e.recPerShare);\n      else recurrentBlocked.add(co.id);", "      recurrentBlocked.add(co.id);"), ['S21']],
  ['variation du portefeuille au strike d’après', sub('const strikePrev = adj ? adj.before : pos.strike;', 'const strikePrev = pos.strike;'), ['S17']],
  ['référence Momentum non abaissée', sub("  if(typeof co.momentumRefPrice==='number') co.momentumRefPrice = Math.max(0, co.momentumRefPrice - d.appliedDrop);", ''), ['S18']],
  ['aperçu toujours en alerte', sub('  const alarm = addsCube || bigDrop || blocked;', '  const alarm = true;'), ['S11']],
  ['ratio non plafonné', sub('const priceRatio = noReserve ? 1 : Math.min(1, ratio);', 'const priceRatio = noReserve ? 1 : ratio;'), ['S1']],
  ['BNR ajustés pris pour des BNR par action ÷ parts émises (pommes et oranges)', sub('const d = dividendReservePriceDrop(perShareTotal, bnr.perShare,', 'const d = dividendReservePriceDrop(perShareTotal, bnr.adjusted/co.sharesIssued,'), ['S15']],
  ['BNR sans les dividendes privilégiés', sub('      preferredPaid += -e.amount;\n', '      preferredPaid += 0;\n'), ['S4']],
  ['BNR sans le semestre qui se ferme', sub('for(let sem=first; sem<=semesterIdx; sem++) netIncome +=', 'for(let sem=first; sem<semesterIdx; sem++) netIncome +='), ['S3', 'S4']],
  ['la part de la banque change la baisse', sub('const d = dividendReservePriceDrop(perShareTotal, bnr.perShare,', 'const d = dividendReservePriceDrop(dividendNetPaidInSemester(co.id, semesterIdx)/co.sharesIssued, bnr.perShare,'), ['S2']],
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
  ['cubes tirés au hasard (0 à 1 au lieu de 1)', sub('{maxRatio:Infinity, min:DIVIDEND_PAYOUT_OVER_RED, max:DIVIDEND_PAYOUT_OVER_RED},', '{maxRatio:Infinity, min:0, max:DIVIDEND_PAYOUT_OVER_RED},'), ['S12']],
  ['cubes jugés sur les BNR', sub('const judged = dividendPayoutRatioTier(ps.perShare, netIncome, co.sharesIssued);', 'const judged = dividendPayoutRatioTier(ps.perShare, dividendRetainedEarnings(co, ps.curSemesterIdx).perShare*co.sharesIssued, co.sharesIssued);'), ['S12']],
  ['2 cubes pour un bénéfice de 1 $', sub('const loss = ni < -1e-9;', 'const loss = ni < 1e-3;'), ['S12']],
  ['cubes comptés hors part de la banque (section 320 d’origine)', sub('const judged = dividendPayoutRatioTier(ps.perShare, netIncome, co.sharesIssued);', "const judged = dividendPayoutRatioTier(ps.perShare, netIncome, co.shareholders.filter(h=>h.playerId!=='BANK').reduce((t,h)=>t+h.shares,0));"), ['S12']],
  ['bénéfice de référence non mémorisé (rejugement sur un autre bénéfice)', sub("  if(!info.keepRef && typeof info.netIncome==='number') co.dividendPenaltyRefNetIncome = info.netIncome;\n", ''), ['S12']],
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
