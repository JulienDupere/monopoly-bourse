// Test — section 321, lot B : baisse du cours au versement d'un dividende (décision de Julien, « dollar pour dollar
// >80% »). À chaque clôture de semestre, juste après les versements (annonces échues et récurrent) et avant les
// déclencheurs du sac fondamental et le tirage des cubes, une entreprise qui vient de verser voit son cours baisser de
//   dividende total par action × excédent ÷ distribué,  excédent = max(0, distribué − 80 % × bénéfice de référence),
// distribué = versé aux actionnaires réels (hors part de la banque), bénéfice de référence = celui de la section 320
// (nul ou négatif = 0). Le cours s'arrête au plancher de fin de partie sans jamais la déclencher. Au lancer final, la
// baisse précède le classement ; un dividende pas encore dû à la fin est rendu, sans baisse.
// Contre-épreuves : chaque scénario est rejoué sur le moteur d'AVANT (commit 5d1bf58, lu par git), puis sur des versions
// cassées exprès (seuil ignoré, part de la banque comptée, plancher ignoré, baisse après la fin…) : elles doivent échouer.
// Lancer depuis la racine du dépôt :  node tests/section321-versement.test.js
const path = require('path');
const { execSync } = require('child_process');
const { loadEngine, near } = require('./helpers/engine');

const US = 1e-6;          // 1 $ en M$ (les cours sont tenus en M$ par action)
const BASE_COMMIT = '5d1bf58';

// ---------------------------------------------------------------------------------------------------------------
// Banc : partie à trois joueurs, hasard piloté (bas / haut / naturel, comme la section 320), tirages des cubes neutres
// (le cours ne bouge que par la règle testée), bénéfice imposé par entreprise ou par entreprise et semestre.
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
  const eng = loadEngine(Object.assign({}, engOpts, { globals: { Math: M, alert: (m) => alerts.push(String(m)) } }));
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], types, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; };`);
  if(!realResolve) eng.run(`resolveStockDraws = function(c){ return {price:c.stockPrice, gameOver:false}; };`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg){ __logs.push(String(msg)); return __realLog.apply(this, arguments); };`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  eng.run(`globalThis.__ovIS = {}; globalThis.__realIS = incomeStatementFor;
    incomeStatementFor = function(id, sem){ const r = __realIS(id, sem); const k2 = id+':'+sem;
      if(__ovIS[k2]!==undefined) r.netIncome = __ovIS[k2]; else if(__ovIS[id]!==undefined) r.netIncome = __ovIS[id]; return r; };`);
  if(real100) eng.run(`state.companies.forEach(c=>{ const other = state.players.find(p=>p.id!==c.ceoId); const b = c.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = other.id; });`);
  // Espion : cubes injectés (couleur, quantité, origine section 320, cours vu au moment de l'injection).
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
  return T;
}
// Cours de 50 $, fondation 50 $ (plancher 2,50 $), trésorerie confortable, bénéfice de référence imposé.
function prep(T, i, { netIncome = 1, price = 50, founding = 50, cash = 20, roll = 6 } = {}){
  T.setup(i, `__ovIS[A.id] = ${netIncome}; A.stockPrice = ${price * US}; A.stockPriceFounding = ${founding * US}; A.cash = ${cash}; state.gameClock.rollCount = ${roll};`);
}
const closeSemester = (T) => T.eng.run(`(function(){ const r = state.gameClock.rollCount; state.gameClock.rollCount = Math.floor(r/3)*3 + 2; advanceGameClock(); return state.gameClock.rollCount; })()`);

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
  const nAnn0 = eng.run(`state.dividendAnnouncements.length`);
  T.ctl.mode = mode;
  try { await dom.get('mOk').fire('click'); } finally { T.ctl.mode = 'natural'; }
  return { preview, html, drop: dropOf(preview), announced: eng.run(`state.dividendAnnouncements.length`) === nAnn0 + 1 };
}
// Vraie fenêtre « Dividende récurrent » (case, palier 1..7 ; 3 = inchangé) : rend l'avertissement de baisse affiché.
async function recurrent(T, i, checked, tier = 3){
  const { eng, dom } = T;
  dom.reset();
  ['mOk', 'mCancel', 'mDivTierLabel', 'mDivPerShare', 'mDivTotalCost', 'mDivCutWarning', 'mDivPayoutWarning', 'mDivPriceDropWarning'].forEach(id => dom.add(id));
  dom.add('mDivAutoPayChk', { checked });
  const t = dom.add('mDivTier', { value: String(tier) });
  eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(i)}.ceoId`))}; __modals.length = 0; modalDividendRecurrentSettings();`);
  await t.fire('input');
  const warn = String(dom.get('mDivPriceDropWarning').innerHTML || '');
  await dom.get('mOk').fire('click');
  return { warn, drop: dropOf(warn) };
}
function dropOf(html){ const m = /data-price-drop="([^"]+)"/.exec(html || ''); return m ? Number(m[1]) : 0; }
const fmt$ = (x) => (x / US).toFixed(4) + ' $';

// ---------------------------------------------------------------------------------------------------------------
// Scénarios : chacun reçoit (engOpts, ok) ; `base` = 'fail' s'il doit échouer sur le moteur d'avant.
const SCENARIOS = [];
const scenario = (id, title, base, fn) => SCENARIOS.push({ id, title, base, fn });

// Annonce seule d'une GARP, 100 % des parts aux actionnaires réels (200 000), bénéfice 1 M$, cours 50 $.
async function annonceSeule(engOpts, ok, label, amount, netIncome, expectedDrop){
  const T = await partie(engOpts, ['garp'], { real100: true });
  prep(T, 0, { netIncome });
  const m0 = T.money();
  const r = await annoncer(T, 0, amount);
  ok(r.announced, `${label} : annonce de ${amount} M$ acceptée`);
  const p0 = T.price(0);
  closeSemester(T);
  const p1 = T.price(0);
  ok(near(p0 - p1, expectedDrop * US, 1e-12), `${label} : le cours baisse de ${expectedDrop.toFixed(4)} $ (${fmt$(p0)} -> ${fmt$(p1)})`);
  ok(near(m0, T.money(), 1e-9), `${label} : monnaie conservée (${m0} -> ${T.money()})`);
  return T;
}

scenario('S1', 'versement à 50 % et à 80 % pile du bénéfice : aucune baisse', 'pass', async (o, ok) => {
  const T1 = await annonceSeule(o, ok, '50 % (0,5 M$, 2,50 $ par action)', 0.5, 1, 0);
  ok(!T1.eng.run(`__logs.some(l=>l.includes('📉'))`), '50 % : aucune ligne de baisse au journal');
  await annonceSeule(o, ok, '80 % pile (0,8 M$, 4 $ par action)', 0.8, 1, 0);
});

scenario('S2', 'versement à 100 % : baisse de 20 % du dividende par action', 'fail', async (o, ok) => {
  const T = await annonceSeule(o, ok, '100 % (1 M$, 5 $ par action)', 1.0, 1, 1);
  const h = T.eng.json(`${T.co(0)}.stockPriceHistory.slice(-1)[0]`);
  ok(h && h.roll === 9 && near(h.price, 49 * US, 1e-12), `historique du cours : dernier point au lancer 9 à 49 $ (${JSON.stringify(h)})`);
  const line = T.eng.run(`__logs.find(l=>l.includes('📉')) || ''`);
  if(o.verbose) console.log(`    journal : ${line}`);
  ok(/50\.00 \$ → 49\.00 \$/.test(line) && /1\.00 M\$/.test(line) && /80 %/.test(line) && /20 % du versement/.test(line),
    'journal : montant versé, bénéfice de référence, part au-delà de 80 %, cours avant et après');
});

scenario('S3', 'vidage à 500 % : baisse de 84 % du dividende par action', 'fail', async (o, ok) => {
  // 5 M$ = 25 $ par action ; excédent 5 − 0,8 = 4,2 M$ = 84 % du versement : 21 $.
  await annonceSeule(o, ok, '500 % (5 M$, 25 $ par action)', 5.0, 1, 21);
});

scenario('S4', 'bénéfice nul ou négatif : baisse de tout le dividende par action', 'fail', async (o, ok) => {
  await annonceSeule(o, ok, 'bénéfice nul, 0,5 M$', 0.5, 0, 2.5);
  await annonceSeule(o, ok, 'bénéfice de −0,5 M$, 0,5 M$', 0.5, -0.5, 2.5);
});

scenario('S5', 'banque à 70 % des parts : l\'exemple chiffré de la consigne', 'fail', async (o, ok) => {
  // 200 000 parts, 60 000 aux actionnaires réels ; annonce de 4,3 M$ = 21,50 $ par action, 1,29 M$ reçus par eux.
  // Excédent 1,29 − 0,8 = 0,49 M$ (38 % du versement) ; baisse 21,50 × 0,49 ÷ 1,29 = 8,1667 $.
  const T = await partie(o, ['garp']);
  prep(T, 0, { netIncome: 1 });
  const real = T.eng.run(`${T.co(0)}.shareholders.filter(s=>s.playerId!=='BANK').reduce((t,s)=>t+s.shares,0)`);
  ok(real === 60000 && T.eng.run(`${T.co(0)}.sharesIssued`) === 200000, `parts : 60 000 réelles sur 200 000 (${real})`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 4.3);
  const p0 = T.price(0);
  closeSemester(T);
  const drop = p0 - T.price(0);
  ok(near(drop, 21.5 * 0.49 / 1.29 * US, 1e-12), `baisse de 8,1667 $ (${fmt$(drop)}), et non 17,50 $ (part de la banque comptée)`);
  ok(near(r.drop, drop, 1e-12), `l'aperçu de la fenêtre annonçait la même baisse (${fmt$(r.drop)})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée (la part de la banque revient à l\'entreprise)');
});

scenario('S6', 'récurrent seul d\'une Dividendes, dans et hors du seuil', 'fail', async (o, ok) => {
  for(const [label, perShare, expected] of [['3 $ par action (0,6 M$, 60 %)', 3, 0], ['6 $ par action (1,2 M$, 120 %)', 6, 2]]){
    const T = await partie(o, ['dividende'], { real100: true });
    prep(T, 0, { netIncome: 1 });
    T.setup(0, `A.dividendBenchmarkPerShare = ${perShare * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
    const m0 = T.money(), p0 = T.price(0), red0 = T.inj.filter(x => x.s320).length;
    closeSemester(T);
    const drop = p0 - T.price(0);
    ok(near(drop, expected * US, 1e-12), `récurrent ${label} : baisse de ${expected} $ (${fmt$(drop)})`);
    ok(T.inj.filter(x => x.s320).length === red0, `récurrent ${label} : aucun cube de la section 320 (réservés aux annonces)`);
    ok(near(m0, T.money(), 1e-9), `récurrent ${label} : monnaie conservée`);
  }
});

scenario('S7', 'annonce + récurrent', 'fail', async (o, ok) => {
  // Récurrent 3 $ (0,6 M$) + annonce 0,4 M$ (2 $) = 1 M$ et 5 $ par action : excédent 20 %, baisse 1 $.
  const T = await partie(o, ['dividende'], { real100: true });
  prep(T, 0, { netIncome: 1 });
  T.setup(0, `A.dividendBenchmarkPerShare = ${3 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 0.4);
  ok(r.announced && near(r.drop, 1 * US, 1e-12), `aperçu de l'annonce : environ 1 $ (${fmt$(r.drop)}), récurrent compris`);
  const p0 = T.price(0);
  closeSemester(T);
  ok(near(p0 - T.price(0), 1 * US, 1e-12), `clôture : baisse de 1 $ (${fmt$(p0 - T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S8', 'entreprise dans son premier semestre : référence = ce semestre', 'fail', async (o, ok) => {
  // Entreprise de Chloé fondée au lancer 7 (semestre 2) ; semestre 1 imposé à −5 M$ (elle n'existait pas), semestre 2 à
  // 1 M$. Récurrent 6 $ (1,2 M$) : référence 1 M$ -> baisse 2 $ (et non 6 $, tout le dividende, sur le semestre 1).
  const T = await partie(o, ['garp', 'garp']);
  T.eng.run(`state.gameClock.rollCount = 7;`);
  await T.eng.run(`createCompany(${JSON.stringify(T.ids[2])}, 'Co Chloe', '', 'dividende', null, null, null)`);
  T.eng.run(`applyCompanyIpoFunding(${T.co(2)});`);
  T.setup(2, `{ const b = A.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = ${JSON.stringify(T.ids[0])}; }
    A.stockPrice = ${50 * US}; A.stockPriceFounding = ${50 * US}; A.cash = 20;
    A.dividendBenchmarkPerShare = ${6 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;
    __ovIS[A.id+':1'] = -5; __ovIS[A.id+':2'] = 1;`);
  ok(T.eng.run(`${T.co(2)}.createdAtRoll`) === 7, 'entreprise fondée au lancer 7');
  const m0 = T.money(), p0 = T.price(2);
  closeSemester(T);
  ok(near(p0 - T.price(2), 2 * US, 1e-12), `premier semestre : baisse de 2 $ (${fmt$(p0 - T.price(2))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  // Annonce dans le premier semestre : la référence mémorisée à l'annonce (section 320) est celle de la clôture, même si
  // le bénéfice du semestre change ensuite (ici 1 M$ à l'annonce, 5 M$ à la clôture : baisse de 1 $ pour 1 M$ annoncé).
  const T2 = await partie(o, ['garp', 'garp']);
  T2.eng.run(`state.gameClock.rollCount = 7;`);
  await T2.eng.run(`createCompany(${JSON.stringify(T2.ids[2])}, 'Co Chloe', '', 'garp', null, null, null)`);
  T2.eng.run(`applyCompanyIpoFunding(${T2.co(2)});`);
  T2.setup(2, `{ const b = A.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = ${JSON.stringify(T2.ids[0])}; }
    A.stockPrice = ${50 * US}; A.stockPriceFounding = ${50 * US}; A.cash = 20; __ovIS[A.id+':1'] = -5; __ovIS[A.id+':2'] = 1;`);
  const r = await annoncer(T2, 2, 1.0);
  T2.setup(2, `__ovIS[A.id+':2'] = 5;`);
  const q0 = T2.price(2);
  closeSemester(T2);
  ok(r.announced && near(q0 - T2.price(2), 1 * US, 1e-12), `annonce de 1 M$ jugée sur la référence de l'annonce (1 M$) : baisse de 1 $ (${fmt$(q0 - T2.price(2))})`);
});

scenario('S9', 'plancher : la baisse s\'arrête au plancher et la partie continue', 'fail', async (o, ok) => {
  // Cours 4 $, fondation 50 $ (plancher 2,50 $) ; vidage à 500 % : 21 $ de baisse demandés, arrêt à 2,50 $.
  const T = await partie(o, ['garp', 'garp'], { real100: true, realResolve: true });
  prep(T, 0, { netIncome: 1, price: 4 });
  T.setup(1, `A.stockPrice = ${50 * US}; A.stockPriceFounding = ${50 * US};`);
  const m0 = T.money();
  await annoncer(T, 0, 5.0);
  closeSemester(T);
  ok(near(T.price(0), 2.5 * US, 1e-15), `cours arrêté au plancher de 2,50 $ (${fmt$(T.price(0))})`);
  ok(T.eng.run(`state.gameEndedReason`) == null, 'la partie continue (aucune fin « cours à 0 »)');
  T.eng.run(`advanceGameClock();`);
  ok(T.eng.run(`state.gameEndedReason`) == null && near(T.price(0), 2.5 * US, 1e-15), 'lancer suivant (tirages réels, sans cube) : toujours en jeu, cours au plancher');
  const line = T.eng.run(`__logs.find(l=>l.includes('📉')) || ''`);
  ok(/plancher de 2\.50 \$/.test(line), 'le journal dit que la baisse s\'arrête au plancher');
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
});

scenario('S10', 'fin de partie : dividende dû au lancer final, cours abaissé dans le classement', 'fail', async (o, ok) => {
  // Durée maximale : fin à la frontière de l'année 2 (lancer 12). Annonce de 5 M$ au lancer 9, due au lancer 12.
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { netIncome: 1, roll: 9 });
  T.eng.run(`state.hiddenGameLengthTargetYear = 1;`);
  const m0 = T.money();
  const r = await annoncer(T, 0, 5.0);
  T.eng.run(`state.gameClock.rollCount = 11;`);
  const p0 = T.price(0);
  T.eng.run(`advanceGameClock();`);
  const reason = T.eng.json(`state.gameEndedReason`);
  ok(r.announced && reason && reason.reason === 'maxDuration', `fin de partie par durée maximale (${JSON.stringify(reason)})`);
  ok(T.eng.run(`__logs.some(l=>l.includes('verse son dividende annoncé de 5.00 M$'))`), 'le dividende dû a bien été versé au lancer final');
  ok(near(p0 - T.price(0), 21 * US, 1e-12), `cours abaissé de 21 $ au lancer final (${fmt$(p0)} -> ${fmt$(T.price(0))})`);
  // Classement final (renderGameEndedScreen) = netWorth de chaque joueur, lu sur le cours abaissé.
  const holder = T.eng.run(`${T.co(0)}.shareholders.find(s=>s.playerId!=='BANK' && s.playerId!==${T.co(0)}.ceoId).playerId`);
  const nw = T.eng.run(`netWorth(state.players.find(p=>p.id===${JSON.stringify(holder)}))`);
  const shares = T.eng.run(`${T.co(0)}.shareholders.find(s=>s.playerId===${JSON.stringify(holder)}).shares`);
  const nwOld = T.eng.run(`(function(){ const c = ${T.co(0)}; const keep = c.stockPrice; c.stockPrice = ${p0}; const v = netWorth(state.players.find(p=>p.id===${JSON.stringify(holder)})); c.stockPrice = keep; return v; })()`);
  ok(near(nwOld - nw, shares * 21 * US, 1e-9), `classement : valeur nette du porteur de ${shares} parts réduite de ${((nwOld - nw)).toFixed(4)} M$ (= parts × 21 $)`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée jusqu\'à la fin');
});

scenario('S11', 'fin de partie : dividende pas encore dû, rendu à l\'entreprise, aucune baisse', 'fail', async (o, ok) => {
  // Annonce de 5 M$ au lancer 9 (due au lancer 12) ; au lancer 10, l'entreprise de Bob tombe à 0 : fin « cours à 0 ».
  // Contrôle : le même versement, dû, aurait fait baisser le cours (c'est ce qui fait échouer le moteur d'avant).
  const T = await partie(o, ['garp', 'garp'], { real100: true });
  prep(T, 0, { netIncome: 1, roll: 9 });
  const bob = T.eng.run(`${T.co(1)}.id`);
  const m0 = T.money(), cash0 = T.eng.run(`${T.co(0)}.cash`);
  await annoncer(T, 0, 5.0);
  T.eng.run(`resolveStockDraws = function(c){ return {price:c.stockPrice, gameOver: c.id===${JSON.stringify(bob)}}; }; advanceGameClock();`);
  const reason = T.eng.json(`state.gameEndedReason`);
  ok(reason && reason.reason === 'stockFloor', `fin de partie « cours à 0 » au lancer 10 (${JSON.stringify(reason)})`);
  ok(near(T.eng.run(`${T.co(0)}.cash`), cash0, 1e-9) && T.eng.run(`state.dividendAnnouncements.length`) === 0, 'dividende pas encore dû : rendu en entier à l\'entreprise');
  ok(near(T.price(0), 50 * US, 1e-15), `aucune baisse du cours (${fmt$(T.price(0))})`);
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  const C = await partie(o, ['garp'], { real100: true });
  prep(C, 0, { netIncome: 1, roll: 9 });
  await annoncer(C, 0, 5.0);
  closeSemester(C);
  ok(near(50 * US - C.price(0), 21 * US, 1e-12), `contrôle : le même dividende, versé, fait baisser le cours de 21 $ (${fmt$(50 * US - C.price(0))})`);
});

scenario('S12', 'aperçus des deux fenêtres = baisse appliquée (parts constantes)', 'fail', async (o, ok) => {
  // Fenêtre d'annonce : 1 M$ (100 %) -> environ 1 $ ; 0,5 M$ (50 %) -> rien d'affiché.
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { netIncome: 1 });
  const small = await (async () => { const { eng, dom } = T; dom.reset(); dom.add('mOk'); dom.add('mCancel');
    const input = dom.add('mDividendAmount'); const prev = dom.add('mDividendPayoutPreview');
    eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(0)}.ceoId`))}; modalAnnounceDividend();`);
    input.value = '0.5'; await input.fire('input'); return String(prev.innerHTML || ''); })();
  ok(dropOf(small) === 0 && !/data-price-drop/.test(small), 'annonce de 50 % : aucune baisse annoncée dans l\'aperçu');
  const r = await annoncer(T, 0, 1.0);
  ok(/environ/.test(r.preview) && near(r.drop, 1 * US, 1e-12), `annonce de 100 % : « environ 1.00 $ par action » (${fmt$(r.drop)})`);
  ok(/Cours : au versement, il baisse de la part du dividende par action qui dépasse 80 %/.test(r.html), 'ligne fixe des paliers : la baisse du cours en une phrase');
  const p0 = T.price(0); closeSemester(T);
  ok(near(p0 - T.price(0), r.drop, 1e-12), `baisse appliquée = aperçu (${fmt$(p0 - T.price(0))})`);
  // Fenêtre du récurrent, sans annonce : 6 $ (120 %) -> environ 2 $ ; 3 $ (60 %) -> rien ; case décochée -> rien.
  const R = await partie(o, ['dividende'], { real100: true });
  prep(R, 0, { netIncome: 1 });
  R.setup(0, `A.dividendBenchmarkPerShare = ${3 * US}; A.dividendAutoPay = true; A.dividendRecurrentNeedsReset = false;`);
  const w60 = await recurrent(R, 0, true, 3);
  ok(w60.drop === 0, 'récurrent 3 $ (60 %) : aucun avertissement de baisse');
  R.setup(0, `A.dividendBenchmarkPerShare = ${6 * US}; A.dividendRecurrentChangedSemesterIdx = -1;`);
  const off = await recurrent(R, 0, false, 3);
  ok(off.drop === 0, 'récurrent 6 $ mais case décochée : aucun avertissement');
  const w120 = await recurrent(R, 0, true, 3);
  ok(/environ/.test(w120.warn) && near(w120.drop, 2 * US, 1e-12), `récurrent 6 $ (120 %), sans annonce : « environ 2.00 $ » (${fmt$(w120.drop)})`);
  const q0 = R.price(0); closeSemester(R);
  ok(near(q0 - R.price(0), w120.drop, 1e-12), `baisse appliquée = avertissement (${fmt$(q0 - R.price(0))})`);
});

scenario('S13', 'cubes de la section 320 inchangés (annonce et clôture, tirages bas et hauts)', 'pass', async (o, ok) => {
  for(const mode of ['min', 'max']){
    for(const amount of [0.9, 1.3, 5.0]){
      const T = await partie(o, ['garp'], { real100: true });
      prep(T, 0, { netIncome: 1 });
      await annoncer(T, 0, amount, mode);
      T.ctl.mode = mode; try { closeSemester(T); } finally { T.ctl.mode = 'natural'; }
      const reds = T.inj.filter(x => x.s320).reduce((s, x) => s + x.q, 0);
      const want = { 0.9: [1, 2], 1.3: [3, 5], 5.0: [6, 8] }[amount][mode === 'min' ? 0 : 1];
      ok(reds === want, `[${mode}] annonce de ${amount * 100} % : ${reds} rouges de la section 320 (attendu ${want})`);
    }
  }
});

scenario('S14', 'baisse appliquée AVANT les déclencheurs du sac fondamental de la clôture', 'fail', async (o, ok) => {
  const T = await partie(o, ['garp'], { real100: true });
  prep(T, 0, { netIncome: 1 });
  await annoncer(T, 0, 1.0);
  const id = T.eng.run(`${T.co(0)}.id`);
  T.inj.length = 0;
  closeSemester(T);
  const trig = T.inj.filter(x => x.co === id && x.inClock && !x.s320);
  ok(trig.length > 0 && trig.every(x => near(x.price, 49 * US, 1e-12)), `les ${trig.length} déclencheurs de la clôture voient le cours abaissé (49 $ : ${trig.map(x => fmt$(x.price)).join(', ')})`);
});

scenario('S15', 'partie enregistrée avant le lot : se charge et clôture un semestre', 'fail', async (o, ok) => {
  // Partie fabriquée par le moteur d'AVANT (commit de base), annonce en cours, puis rechargée dans le moteur testé.
  const baseSrc = baseEngineSource();
  let saved;
  if(baseSrc){
    const B = await partie({ transform: () => baseSrc }, ['dividende'], { real100: true });
    prep(B, 0, { netIncome: 1 });
    B.setup(0, `A.dividendBenchmarkPerShare = ${3 * US}; A.dividendAutoPay = true;`);
    await annoncer(B, 0, 1.0);
    saved = B.eng.run(`JSON.stringify(state)`);
  } else {
    console.log('    (git indisponible : partie fabriquée par le moteur testé)');
    const B = await partie(o, ['dividende'], { real100: true });
    prep(B, 0, { netIncome: 1 });
    B.setup(0, `A.dividendBenchmarkPerShare = ${3 * US}; A.dividendAutoPay = true;`);
    await annoncer(B, 0, 1.0);
    saved = B.eng.run(`JSON.stringify(state)`);
  }
  const T = await partie(o, ['garp']);
  // Même chemin que le chargement d'une partie (loadGame) : JSON relu, puis migrateState.
  T.eng.run(`state = JSON.parse(${JSON.stringify(saved)}); migrateState(state);`);
  T.eng.run(`__ovIS[state.companies[0].id] = 1;`);
  ok(T.eng.run(`state.gameClock.rollCount`) === 6 && T.eng.run(`state.dividendAnnouncements.length`) === 1, 'partie d\'avant chargée : lancer 6, une annonce de 1 M$ en cours');
  const m0 = T.money();
  let err = null;
  try { closeSemester(T); } catch(e){ err = e; }
  ok(!err, `clôture sans erreur${err ? ' : ' + err.message : ''}`);
  ok(T.eng.run(`state.gameClock.rollCount`) === 9 && T.eng.run(`state.dividendAnnouncements.length`) === 0, 'semestre clos, annonce versée');
  ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
  // Annonce 1 M$ (5 $) + récurrent 3 $ (0,6 M$) = 1,6 M$ et 8 $ par action ; excédent 0,8 M$ = 50 % : baisse de 4 $.
  ok(near(50 * US - T.eng.run(`state.companies[0].stockPrice`), 4 * US, 1e-12), `la règle s'applique dès la première clôture : baisse de 4 $ (${fmt$(50 * US - T.eng.run(`state.companies[0].stockPrice`))})`);
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

// Versions cassées exprès (sur le moteur testé) et scénarios qui doivent les attraper.
const sub = (a, b) => (src) => src.split(a).join(b);
const MUTATIONS = [
  ['seuil de 80 % ignoré', sub('const threshold = DIVIDEND_PAYOUT_PRICE_DROP_RATIO * refUsed;', 'const threshold = 0;'), ['S1']],
  ['part de la banque comptée', sub('const distributed = dividendNetPaidInSemester(co.id, semesterIdx);', 'const distributed = dividendPaidInSemester(co.id, semesterIdx);'), ['S5']],
  ['plancher ignoré', sub('Math.max(Math.min(p, floor), p - dropPerShare)', 'Math.max(0, p - dropPerShare)'), ['S9']],
  ['baisse de tout le dividende dès 80 %', sub('const dropPerShare = perShare * excessFraction;', 'const dropPerShare = excess>0 ? perShare : 0;'), ['S2', 'S3', 'S5']],
  ['pas de baisse au lancer final (après le classement)', sub('    Object.keys(dividendPerSharePaidById).forEach(', '    if(!state.gameEndedReason) Object.keys(dividendPerSharePaidById).forEach('), ['S10']],
  ['récurrent oublié dans le dividende par action', (src) => src.replace(/(co\.dividendAutoPaySemesterIdx = semesterAfter;\n\s*)dividendPerSharePaidById\[co\.id\] = \(dividendPerSharePaidById\[co\.id\]\|\|0\) \+ perShare; \/\/ Section 321\n/, '$1'), ['S6', 'S7']],
  ['référence : toujours le semestre précédent (jeune entreprise)', sub('return incomeStatementFor(co.id, dividendPayoutRefSemesterIdx(co, semesterIdx)).netIncome;', 'return incomeStatementFor(co.id, semesterIdx-1).netIncome;'), ['S8']],
  ['référence mémorisée à l\'annonce ignorée', sub("if(co.dividendPenaltySemesterIdx===semesterIdx && typeof co.dividendPenaltyRefNetIncome==='number') return co.dividendPenaltyRefNetIncome;", ''), ['S8']],
  ['baisse après les déclencheurs du sac fondamental', (src) => {
    const call = "    Object.keys(dividendPerSharePaidById).forEach(id=>applyDividendPayoutPriceDrop(companyById(id), semesterBefore, dividendPerSharePaidById[id]));\n";
    if(!src.includes(call)) return src;
    const s = src.replace(call, '');
    const anchor = '        injectStockCube(co, \'red\', STOCK_TRIGGER_NEGATIVE_CASH_MIN, STOCK_TRIGGER_NEGATIVE_CASH_MAX);\n      }\n    });\n';
    return s.includes(anchor) ? s.replace(anchor, anchor + call) : src;
  }, ['S14']],
  ['aperçu du récurrent sans le récurrent', sub("(co.type==='dividende' ? recurrentPerShare : 0)", '0'), ['S12', 'S7']],
  ['aperçu de l\'annonce absent', sub("el.innerHTML = pv.html + (dropHtml ? `<br>${dropHtml}` : '');", 'el.innerHTML = pv.html;'), ['S12']],
  ['cours sous le plancher accepté (fin de partie possible)', sub('Math.max(Math.min(p, floor), p - dropPerShare)', 'Math.max(Math.min(p, floor) * 0.5, p - dropPerShare)'), ['S9']],
];

(async () => {
  let total = 0; const failures = [];
  console.log('=== Moteur testé ===');
  for(const sc of SCENARIOS){
    console.log(`${sc.id}. ${sc.title}`);
    const r = await runScenario(sc, {}, true);
    total += r.count;
    r.fails.forEach(f => failures.push(`${sc.id} — ${f}`));
  }
  console.log('\n=== Contre-épreuve : moteur d\'avant (commit ' + BASE_COMMIT + ') ===');
  const baseSrc = baseEngineSource();
  if(!baseSrc){
    console.log('  git indisponible : contre-épreuve sur le moteur d\'avant sautée (les versions cassées ci-dessous restent).');
  } else {
    for(const sc of SCENARIOS){
      const r = await runScenario(sc, { transform: () => baseSrc }, false);
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
      let r;
      try { r = await runScenario(sc, { transform: tf }, false); }
      catch(e){ r = { fails: ['chargement : ' + e.message] }; }
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
