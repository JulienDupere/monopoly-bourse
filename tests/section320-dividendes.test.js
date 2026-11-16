// Test — section 320 : les dividendes et le sac fondamental (décision de Julien).
//   A. Plus de séquence de dividendes au sac fondamental, pour les quatre types (ni verts de série, ni rouges de série
//      brisée, ni les 1 à 2 verts des Croissance et Momentum). Les règles du sac TYPE restent (sections 306 et 315).
//   B. Réglages dividendPayoutRatioMin / Full et dividendLossPauseMax retirés du menu de départ et du moteur.
//   C. Un dividende ANNONCÉ ajoute des rouges au sac fondamental selon le ratio de distribution cumulé du semestre ÷
//      bénéfice du dernier semestre clos. Section 321 (décisions de Julien) : ratio PAR ACTION (dividendes par action du
//      semestre, récurrent compris, ÷ bénéfice par action ; la part de la banque ne change rien) et quantités FIXES,
//      symboliques : ≤ 80 % : 0 ; au-delà, bénéfice nul compris : 1 ; bénéfice négatif : 2. Le palier du cumul compte.
//   Section 321 : la règle des 5 cubes du sac type (sections 306 et 315) est retirée (scénario 1).
// Hasard : un faux Math (globals) impose le bas (« min ») ou le haut (« max ») de chaque tirage, avec des valeurs toutes
// différentes (les identifiants uid() restent distincts). Les injections du sac fondamental faites à la clôture sont
// espionnées avec leur ligne d'appel : celles du bloc « dividendes » d'advanceGameClock (entre le test de couverture des
// intérêts et la règle du sac type de la section 315) doivent disparaître.
// Lancer depuis la racine du dépôt :  node tests/section320-dividendes.test.js
const { loadEngine, check, near, engineSource } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const failures = [];
const ok = (cond, msg) => { check(cond, msg); n++; };
async function scenario(title, fn){
  console.log(title);
  try { await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// Lignes (1 = première ligne du script) qui encadrent le bloc des dividendes de la clôture de semestre.
function dividendBlockRange(){
  const lines = engineSource().split('\n');
  // Section 321 (lot A) : la couverture des intérêts lit toutes les dépenses d'intérêts (semesterInterestExpense) ;
  // ancien repère « const mortgageInterestExpense = is.expenses['mortgage_interest_expense'] » gardé en repli.
  let i = lines.findIndex(l => l.includes('const interestExpense = semesterInterestExpense(is);'));
  if(i < 0) i = lines.findIndex(l => l.includes("const mortgageInterestExpense = is.expenses['mortgage_interest_expense']"));
  let j = i; while(j < lines.length && lines[j].trim() !== '}') j++;
  const k = lines.findIndex(l => l.includes("Section 315 — bogue 25 (décision de Julien) : le sac type d'une Dividendes"));
  if(i < 0 || k < 0 || !(j < k)) throw new Error('bloc des dividendes introuvable dans advanceGameClock');
  return [j + 1, k + 1];
}
const RANGE = dividendBlockRange();

// Fenêtres : éléments enregistrés par id (modèle : section317b-dividendes.test.js).
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

// Partie à trois joueurs ; `types` = types des entreprises d'Alice, Bob, Chloé. real100 : la part de la banque passe à
// un joueur qui n'est pas le CEO (100 % des parts aux actionnaires réels, chiffres ronds).
async function partie(types, { real100 = false } = {}){
  const ctl = { mode: 'natural', k: 0 };
  const M = Object.create(Math);
  M.random = () => {
    if(ctl.mode === 'min'){ ctl.k++; return (ctl.k % 100000) * 1e-9 + 1e-12; }
    if(ctl.mode === 'max'){ ctl.k++; return 1 - ((ctl.k % 100000) + 1) * 1e-9; }
    return Math.random();
  };
  const alerts = [];
  const eng = loadEngine({ globals: { Math: M, alert: (m) => alerts.push(String(m)) } });
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], types, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg){ __logs.push(String(msg)); return __realLog.apply(this, arguments); };`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  // Bénéfice imposé par entreprise (clé id) ou par entreprise et semestre (clé id:sem).
  eng.run(`globalThis.__ovIS = {}; globalThis.__realIS = incomeStatementFor;
    incomeStatementFor = function(id, sem){ const r = __realIS(id, sem); const k2 = id+':'+sem;
      if(__ovIS[k2]!==undefined) r.netIncome = __ovIS[k2]; else if(__ovIS[id]!==undefined) r.netIncome = __ovIS[id]; return r; };`);
  // Section 321 — BNR imposés par entreprise (clé id, en M$, convertis par action) ; sans clé, vrais BNR. Ils ne jouent
  // que sur la baisse du cours (les cubes suivent le bénéfice de référence).
  eng.run(`globalThis.__ovBNR = {}; globalThis.__realBNR = dividendRetainedEarnings;
    dividendRetainedEarnings = function(co, sem){ const r = __realBNR(co, sem); if(__ovBNR[co.id]!==undefined){ r.perShare = __ovBNR[co.id]/co.sharesIssued; r.adjusted = r.perShare*r.realShares; } return r; };`);
  if(real100){
    eng.run(`state.companies.forEach(c=>{ const other = state.players.find(p=>p.id!==c.ceoId); const b = c.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = other.id; });`);
  }
  // Espion du sac fondamental : quantité et ligne d'appel dans le script.
  const inj = [];
  const real = eng.sandbox.injectStockCube;
  eng.sandbox.injectStockCube = function(co, color, a, b){
    const stack = String(new Error().stack);
    const st = stack.split('\n').slice(2);
    let line = null;
    for(const s of st){ const m = /index\.html#script:(\d+):/.exec(s); if(m){ line = +m[1]; break; } }
    const q = real(co, color, a, b);
    inj.push({ co: co.id, color, q, line, atClose: /closeAnnouncedDividendPayoutPenalty/.test(stack) });
    return q;
  };
  const T = { eng, ids, ctl, alerts, inj, dom: installModalDom(eng) };
  T.co = (i) => `state.companies.find(c=>c.ceoId===${JSON.stringify(ids[i])})`;
  T.money = () => eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
  T.dividendInj = (i) => { const id = eng.run(`${T.co(i)}.id`); return inj.filter(x => x.co === id && x.line > RANGE[0] && x.line < RANGE[1]); };
  // Section 320 (retouches) : rouges ajoutés par le recalcul de la clôture (closeAnnouncedDividendPayoutPenalty).
  T.closeReds = (i) => { const id = eng.run(`${T.co(i)}.id`); return inj.filter(x => x.co === id && x.atClose).reduce((s, x) => s + x.q, 0); };
  return T;
}

// Section 320 (retouches) : vraie fenêtre « Dividende récurrent » (case, palier 1..7 ; 3 = inchangé). Rend les
// messages d'alerte apparus et les rouges ajoutés au sac fondamental pendant la confirmation.
async function recurrent(T, i, checked, tier = 3, mode = 'natural'){
  const { eng, dom } = T;
  dom.reset();
  ['mOk', 'mCancel', 'mDivTierLabel', 'mDivPerShare', 'mDivTotalCost', 'mDivCutWarning', 'mDivPayoutWarning'].forEach(id => dom.add(id));
  dom.add('mDivAutoPayChk', { checked });
  const t = dom.add('mDivTier', { value: String(tier) });
  eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(i)}.ceoId`))}; __modals.length = 0; modalDividendRecurrentSettings();`);
  await t.fire('input');
  const html = eng.run(`__modals[__modals.length-1] || ''`);
  const warn = String(dom.get('mDivPayoutWarning').innerHTML || '');
  const a0 = T.alerts.length, red0 = eng.run(`${T.co(i)}.stockReserve.red`);
  T.ctl.mode = mode;
  try { await dom.get('mOk').fire('click'); } finally { T.ctl.mode = 'natural'; }
  return { alerts: T.alerts.slice(a0), added: eng.run(`${T.co(i)}.stockReserve.red`) - red0, html, warn };
}
const closeSemesterMode = (T, mode) => { T.ctl.mode = mode; try { return closeSemester(T); } finally { T.ctl.mode = 'natural'; } };

// Annonce par la vraie fenêtre (saisie, événement « input », clic sur Annoncer) ; rend l'aperçu affiché juste avant.
async function annoncer(T, i, amount, mode = 'natural'){
  const { eng, dom } = T;
  dom.reset(); dom.add('mOk'); dom.add('mCancel');
  const input = dom.add('mDividendAmount'); const prev = dom.add('mDividendPayoutPreview');
  eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${T.co(i)}.ceoId`))}; __modals.length = 0; modalAnnounceDividend();`);
  input.value = String(amount);
  await input.fire('input');
  const preview = String(prev.innerHTML || '');
  const red0 = eng.run(`${T.co(i)}.stockReserve.red`), nAnn0 = eng.run(`state.dividendAnnouncements.length`);
  T.ctl.mode = mode;
  try { await dom.get('mOk').fire('click'); } finally { T.ctl.mode = 'natural'; }
  const red1 = eng.run(`${T.co(i)}.stockReserve.red`);
  return { preview, added: red1 - red0, announced: eng.run(`state.dividendAnnouncements.length`) === nAnn0 + 1 };
}
const closeSemester = (T) => T.eng.run(`(function(){ const r = state.gameClock.rollCount; state.gameClock.rollCount = Math.floor(r/3)*3 + 2; advanceGameClock(); return state.gameClock.rollCount; })()`);

(async () => {
  console.log(`Bloc des dividendes de la clôture : lignes ${RANGE[0]} à ${RANGE[1]} du script`);

  await scenario('1. Dividendes : récurrent seul, au-dessus du bénéfice', async () => {
    const T = await partie(['dividende']);
    const A = T.co(0);
    // Bénéfice 1 M$ ; référence 25 $/part × 60 000 parts réelles = 1,5 M$ versés aux actionnaires réels (150 %).
    T.eng.run(`__ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 2.5e-5; ${A}.dividendAutoPay = true; ${A}.typeReserve = {green:6, red:1, white:3}; ${A}.dividendStreak = 3; state.gameClock.rollCount = 2;`);
    const fund0 = T.eng.json(`Object.assign({}, ${A}.stockReserve)`), m0 = T.money();
    closeSemester(T);
    const di = T.dividendInj(0), tp = T.eng.json(`Object.assign({}, ${A}.typeReserve)`), m1 = T.money();
    console.log(`    sac fondamental avant ${JSON.stringify(fund0)} ; injections du bloc dividendes : ${JSON.stringify(di)} ; sac type après ${JSON.stringify(tp)}`);
    ok(di.length === 0, 'récurrent de 150 % du bénéfice (et une ancienne série de 3) : aucune injection liée aux dividendes dans le sac fondamental');
    ok(tp.green === 6 && tp.red === 1 && tp.white === 3, `section 321 : plus de règle des 5 cubes au sac type, 6V/1R/3B inchangé (avant : 4V/6R/0B) (${JSON.stringify(tp)})`);
    ok(near(m0, m1, 1e-9), `monnaie conservée (${m0} -> ${m1})`);
    // Récurrent non versé (case décochée) : sac type à 20 rouges, toujours aucun cube fondamental lié aux dividendes.
    T.eng.run(`${A}.dividendAutoPay = false; ${A}.typeReserve = {green:6, red:1, white:3};`);
    T.inj.length = 0; closeSemester(T);
    ok(T.dividendInj(0).length === 0 && T.eng.run(`${A}.typeReserve.red`) === 20, 'récurrent non versé : sac type à 20 rouges (section 315), sac fondamental non touché');
  });

  await scenario('2. GARP, Croissance, Momentum : plus de vert de dividende, plus de rouge de série brisée', async () => {
    const T = await partie(['garp', 'croissance', 'momentum']);
    T.eng.run(`state.companies.forEach(c=>{ __ovIS[c.id] = 1; }); state.gameClock.rollCount = 3;`);
    const m0 = T.money();
    for(let i = 0; i < 3; i++){
      const r = await annoncer(T, i, 0.5);
      ok(r.announced && r.added === 0, `${['GARP', 'Croissance', 'Momentum'][i]} : annonce de 0,5 M$ (bénéfice 1 M$, ratio 50 % brut) acceptée, aucun rouge à l'annonce`);
    }
    T.inj.length = 0; closeSemester(T);
    for(let i = 0; i < 3; i++){
      const di = T.dividendInj(i);
      ok(di.length === 0, `${['GARP', 'Croissance', 'Momentum'][i]} : à la clôture, aucun cube vert de dividende (${JSON.stringify(di)})`);
    }
    ok(near(m0, T.money(), 1e-9), 'monnaie conservée (annonces puis versement)');
    // Aucun dividende, ancienne série en cours (partie d'avant) : avant, la série brisée donnait des rouges.
    T.eng.run(`state.companies.forEach(c=>{ c.dividendStreak = 3; c.dividendLossStreak = 2; c.badDividendStreak = 2; });`);
    T.inj.length = 0; closeSemester(T);
    for(let i = 0; i < 3; i++) ok(T.dividendInj(i).length === 0, `${['GARP', 'Croissance', 'Momentum'][i]} : aucun dividende (série de 3 en mémoire) : aucun rouge`);
  });

  await scenario('3. Paliers du ratio de distribution par action (annonce seule, bénéfice du dernier semestre clos)', async () => {
    const cas = [
      ['70 %', 1, 0.7, 0], ['80 % pile', 1, 0.8, 0], ['90 %', 1, 0.9, 1], ['100 % pile', 1, 1.0, 1], ['500 %', 1, 5.0, 1],
      ['cas de Julien : bénéfice de 1 $, annonce de 2 M$', 1e-6, 2.0, 1], ['bénéfice nul, 0,3 M$', 0, 0.3, 1],
      ['bénéfice −0,5 M$, 10 000 $', -0.5, 0.01, 2], ['bénéfice −0,5 M$, 5 M$', -0.5, 5.0, 2],
    ];
    for(const [titre, ni, amount, want] of cas){
      const res = {};
      for(const mode of ['min', 'max']){
        const T = await partie(['garp'], { real100: true });
        T.eng.run(`__ovIS[${T.co(0)}.id] = ${ni}; state.gameClock.rollCount = 3;`);
        const m0 = T.money();
        const r = await annoncer(T, 0, amount, mode);
        res[mode] = r.added;
        if(!near(m0, T.money(), 1e-9)) throw new Error(`${titre} : monnaie non conservée`);
        if(!r.announced) throw new Error(`${titre} : annonce refusée`);
      }
      ok(res.min === want && res.max === want, `${titre} : ${want} rouge(s), quantité fixe (tirage bas ${res.min}, tirage haut ${res.max}), monnaie conservée`);
    }
    const T = await partie(['garp'], { real100: true });
    T.eng.run(`__ovIS[${T.co(0)}.id] = 1; state.gameClock.rollCount = 3;`);
    const vus = new Set();
    for(let t = 0; t < 30; t++){
      T.eng.run(`state.dividendAnnouncements = []; ${T.co(0)}.dividendPenaltySemesterIdx = -1; ${T.co(0)}.cash = 20;`);
      vus.add((await annoncer(T, 0, 1.2)).added);
    }
    ok(vus.size === 1 && vus.has(1), `120 %, 30 annonces au hasard réel : toujours 1 rouge (${[...vus].join(', ')})`);
  });

  await scenario('4. Dividendes : récurrent + annonce', async () => {
    const T = await partie(['dividende'], { real100: true });
    const A = T.co(0);
    // Récurrent : 3 $/part × 200 000 parts réelles = 0,6 M$ (60 % du bénéfice de 1 M$) ; annonce de 0,3 M$ -> 90 %.
    T.eng.run(`__ovIS[${A}.id] = 1; __ovBNR[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 3e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 3;`);
    const lo = await annoncer(T, 0, 0.3, 'min');
    T.eng.run(`state.dividendAnnouncements = []; ${A}.dividendPenaltySemesterIdx = -1; ${A}.cash += 0.3;`);
    const hi = await annoncer(T, 0, 0.3, 'max');
    ok(lo.added === 1 && hi.added === 1, `récurrent 3 $ + annonce 1,50 $ par action = 90 % du bénéfice par action (5 $) : 1 rouge (bas ${lo.added}, haut ${hi.added})`);
    ok(/90 %/.test(hi.preview), `l'aperçu compte le récurrent : « ${hi.preview.replace(/<[^>]+>/g, '').slice(0, 120)}… »`);
    // Récurrent seul à 90 % : rien, ni à l'annonce (il n'y en a pas) ni à la clôture.
    const T2 = await partie(['dividende'], { real100: true });
    const A2 = T2.co(0);
    T2.eng.run(`__ovIS[${A2}.id] = 1; __ovBNR[${A2}.id] = 1; ${A2}.dividendBenchmarkPerShare = 4.5e-6; ${A2}.dividendAutoPay = true; state.gameClock.rollCount = 3;`);
    const info = T2.eng.json(`announcedDividendPayoutPenalty(${A2}, 0)`);
    ok(info.tier === 0 && near(info.ratio, 0.9, 1e-9), `sans annonce, ratio affiché 90 % mais palier 0 (${JSON.stringify({ tier: info.tier, ratio: info.ratio })})`);
    const m0 = T2.money(), red0 = T2.eng.run(`${A2}.stockReserve.red`);
    closeSemester(T2);
    ok(T2.dividendInj(0).length === 0, 'récurrent seul à 90 % versé à la clôture : aucune injection liée aux dividendes');
    ok(near(m0, T2.money(), 1e-9), 'monnaie conservée au versement du récurrent');
    void red0;
  });

  await scenario('5. Cumul dans le semestre', async () => {
    const setup = (T) => T.eng.run(`__ovIS[${T.co(0)}.id] = 1; state.gameClock.rollCount = 3;`);
    for(const mode of ['min', 'max']){
      const T = await partie(['garp'], { real100: true }); setup(T);
      const A = T.co(0);
      const a1 = await annoncer(T, 0, 0.5, mode), a2 = await annoncer(T, 0, 0.5, mode);
      ok(a1.added === 0 && a2.added === 1, `[${mode}] 50 % puis 50 % : ${a1.added} puis ${a2.added} rouge — total ${a1.added + a2.added}`);
      const m0 = T.money();
      const a3 = await annoncer(T, 0, 0.5, mode), a4 = await annoncer(T, 0, 2.0, mode);
      ok(a3.added === 0 && a4.added === 0 && T.eng.run(`${A}.dividendPenaltyRedAdded`) === 1 && near(m0, T.money(), 1e-9), `[${mode}] 150 % puis 350 % (même palier) : aucun rouge de plus (total ${T.eng.run(`${A}.dividendPenaltyRedAdded`)}), monnaie conservée`);
      closeSemester(T);
      const b1 = await annoncer(T, 0, 0.5, mode), b2 = await annoncer(T, 0, 0.5, mode);
      ok(T.eng.run(`${A}.dividendPenaltySemesterIdx`) === 2 && b1.added === 0 && b2.added === 1, `[${mode}] semestre suivant : on repart de zéro (50 % : ${b1.added}, puis 100 % : ${b2.added})`);
    }
  });

  await scenario('6. Part de la banque sans effet (tout se calcule par action)', async () => {
    for(const [amount, want] of [[0.8, 0], [0.9, 1]]){
      const res = [];
      for(const bank of ['0', '70']){
        const T = await partie(['garp'], { real100: bank === '0' });
        const A = T.co(0);
        T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
        const r = await annoncer(T, 0, amount, 'max');
        res.push(r.added);
        ok(r.added === want && new RegExp(Math.round(amount*100) + ' %').test(r.preview), `banque à ${bank} % : annonce de ${amount} M$ (${amount*5} $ par action) sur 5 $ de bénéfice par action : ${r.added} rouge — « ${r.preview.replace(/<[^>]+>/g, '').slice(-110)} »`);
      }
      ok(res[0] === res[1], `${amount} M$ : même résultat avec la banque à 70 % ou à 0 % (section 320 d'origine : 70 % de parts bancaires = ratio hors banque de ${Math.round(amount*30)} %)`);
    }
  });

  await scenario('7. Partie d’avant, menu de départ et création', async () => {
    const T = await partie(['dividende', 'garp']);
    const A = T.co(0);
    T.eng.run(`state.settings.dividendPayoutRatioMin = 0.15; state.settings.dividendPayoutRatioFull = 0.25; state.settings.dividendLossPauseMax = 2;
      state.companies.forEach(c=>{ c.dividendStreak = 4; c.badDividendStreak = 2; c.dividendLossStreak = 3; delete c.dividendPenaltySemesterIdx; delete c.dividendPenaltyTier; delete c.dividendPenaltyRedAdded; });
      __ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 1e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 2;`);
    const raw = T.eng.run(`JSON.stringify(state)`), code = T.eng.run('gameCode');
    await T.eng.run(`storageSet('game:'+gameCode, ${JSON.stringify(raw)}, true)`);
    const loaded = await T.eng.run(`loadGame(${JSON.stringify(code)})`);
    const f = T.eng.json(`state.companies.map(c=>[c.dividendPenaltySemesterIdx, c.dividendPenaltyTier, c.dividendPenaltyRedAdded])`);
    ok(loaded === true && f.every(x => x[0] === -1 && x[1] === 0 && x[2] === 0), `partie d'avant chargée ; nouveaux champs par défaut (${JSON.stringify(f)})`);
    T.eng.run(`state.companies.forEach(c=>{ if(c.type==='dividende') __ovIS[c.id] = 1; });`);
    const m0 = T.money();
    T.inj.length = 0;
    closeSemester(T);
    ok(T.dividendInj(0).length === 0 && T.dividendInj(1).length === 0, 'clôture de semestre avec une série de 4 en mémoire : aucune injection liée aux dividendes');
    const r = await annoncer(T, 0, 0.1);
    ok(r.announced && T.alerts.length === 0, `annonce d'un dividende sans erreur (${T.alerts.join(' | ') || 'aucun message'})`);
    ok(near(m0, T.money(), 1e-9), 'monnaie conservée');
    // Menu de départ : vrai écran, vrai bouton « Créer la partie ».
    const doc = creerDocument();
    const E = loadEngine({ globals: { document: doc, alert: () => {} } });
    E.run('renderSetup()');
    const absents = ['setupDividendPayoutRatioMin', 'setupDividendPayoutRatioFull', 'setupDividendLossPauseMax'].filter(id => !doc.trouver(id));
    ok(absents.length === 3 && !!doc.trouver('createBtn') && !/Séquence de dividendes|Ratio dividende\/bénéfice|tolérés en pause/.test(String(E.run('app.innerHTML')).replace(/<!--[\s\S]*?-->/g, '')), 'menu de départ : plus de bloc « Séquence de dividendes » ni de ses trois champs');
    E.run(`setupPlayers = ['Xavier','Yann']; renderPlayerLines();`);
    const c = doc.cliquer('createBtn');
    await c.promesse;
    const s = E.json(`state ? {n: state.players.length, keys: Object.keys(state.settings).filter(k=>/dividendPayoutRatio|dividendLossPause/.test(k))} : null`);
    ok(s && s.n === 2 && s.keys.length === 0, `création de partie par le menu : 2 joueurs, aucun des trois réglages dans la partie (${JSON.stringify(s)})`);
  });

  await scenario('8. Aperçu de la fenêtre = palier appliqué', async () => {
    const T = await partie(['garp'], { real100: true });
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
    const tierOf = (html) => +((/data-payout-tier="(\d)"/.exec(html) || [])[1]);
    const a = await annoncer(T, 0, 0.8);
    ok(tierOf(a.preview) === 0 && /80 %/.test(a.preview) && /aucun cube/.test(a.preview) && a.added === 0, `80 % pile : aperçu palier 0, « aucun cube » ; appliqué : ${a.added}`);
    const b = await annoncer(T, 0, 0.1);
    ok(tierOf(b.preview) === 1 && T.eng.run(`${A}.dividendPenaltyTier`) === 1 && /90 %/.test(b.preview) && /1 cube rouge/.test(b.preview) && /brick/.test(b.preview) && b.added === 1,
      `+0,1 M$ (cumul 90 %) : aperçu palier 1 « 1 cube rouge » en rouge ; appliqué ${b.added}`);
    const c = await annoncer(T, 0, 0.3);
    ok(tierOf(c.preview) === 1 && /aucun cube de plus/.test(c.preview) && c.added === 0 && T.eng.run(`${A}.dividendPenaltyRedAdded`) === 1, `+0,3 M$ (cumul 120 %, même palier) : « aucun cube de plus », appliqué ${c.added}`);
    const logLine = T.eng.json(`__logs.filter(l=>/sac fondamental/.test(l))`);
    ok(logLine.length === 1 && /90 %/.test(logLine[0]) && /dernier semestre clos/.test(logLine[0]), `journal : « ${(logLine[0] || '').slice(0, 170)} »`);
    console.log(`    aperçu (120 %) : « ${c.preview.replace(/<[^>]+>/g, '')} »`);
  });

  await scenario('9. Cote de crédit : semestres de dividende sans bénéfice relus dans les états', async () => {
    const T = await partie(['dividende']);
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id] = -0.5; ${A}.dividendBenchmarkPerShare = 1e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 2;`);
    const c0 = T.eng.json(`companyCreditRatingInfo(${A}).defaultBadness`);
    closeSemester(T); closeSemester(T);
    const c2 = T.eng.json(`companyCreditRatingInfo(${A}).defaultBadness`);
    T.eng.run(`${A}.dividendAutoPay = false;`);
    closeSemester(T);
    const c3 = T.eng.json(`companyCreditRatingInfo(${A}).defaultBadness`);
    ok(near(c0, 0) && near(c2, 0.3) && near(c3, 0), `dividende versé deux semestres de suite sans bénéfice : composante « défaut » 0 -> 0,3 ; semestre suivant sans dividende : 0 (${c0}, ${c2}, ${c3})`);
    ok(T.eng.run(`companyCreditRatingInfo(${A}).dividendLossSemesters`) === 0, 'le nombre de semestres est exposé sous dividendLossSemesters');
  });

  // =================== Section 320 — retouches de la revue ===================
  await scenario('10. Référence = dernier semestre CLOS, même si le bénéfice change d’un semestre à l’autre', async () => {
    for(const mode of ['min', 'max']){
      const T = await partie(['garp'], { real100: true });
      const A = T.co(0);
      // Semestre 0 (clos) : 1 M$ ; semestre 1 (en cours) : 10 M$. Annonce de 0,9 M$ au semestre 1 : 90 % du semestre clos.
      T.eng.run(`__ovIS[${A}.id+':0'] = 1; __ovIS[${A}.id+':1'] = 10; state.gameClock.rollCount = 3;`);
      const r = await annoncer(T, 0, 0.9, mode);
      ok(r.added === 1 && /90 %/.test(r.preview), `[${mode}] bénéfice clos 1 M$, bénéfice en cours 10 M$, annonce 0,9 M$ : 90 % du semestre clos, ${r.added} rouge`);
    }
    const T2 = await partie(['garp'], { real100: true });
    const B = T2.co(0);
    T2.eng.run(`__ovIS[${B}.id+':1'] = 10; __ovIS[${B}.id+':2'] = 1; state.gameClock.rollCount = 6;`);
    const r2 = await annoncer(T2, 0, 0.9, 'max');
    ok(r2.added === 0 && /9 %/.test(r2.preview), `semestre 2 : référence = semestre 1 (10 M$), annonce 0,9 M$ = 9 %, aucun rouge (${r2.added})`);
  });

  await scenario('11. Cumul de deux annonces avec la banque à 70 % : même ratio par action qu’à 0 %', async () => {
    const res = {};
    for(const mode of ['min', 'max']){
      const T = await partie(['garp']);
      T.eng.run(`__ovIS[${T.co(0)}.id] = 1; state.gameClock.rollCount = 3;`);
      const a = await annoncer(T, 0, 0.5, mode);   // 2,50 $ par action = 50 % du bénéfice par action (5 $)
      const b = await annoncer(T, 0, 0.4, mode);   // + 2 $ : 90 %
      res[mode] = [a.added, b.added];
    }
    ok(res.min[0] === 0 && res.max[0] === 0 && res.min[1] === 1 && res.max[1] === 1, `annonce de 0,5 M$ (50 %) : 0 ; puis 0,4 M$ (cumul 90 %) : 1 (bas ${res.min}, haut ${res.max}) — la part de la banque n'entre plus dans le calcul (avant : 27 % hors banque, aucun rouge)`);
  });

  await scenario('12. Récurrent décoché puis recoché, jauge relevée, même bénéfice de référence à la clôture : constat 1', async () => {
    const setup = (T, A, bench, auto) => T.eng.run(`__ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = ${bench}; ${A}.dividendAutoPay = ${auto}; state.gameClock.rollCount = 3;`);
    // a) Cas honnête : récurrent 3 $ coché + annonce 1,50 $ = 90 % : 1 à l'annonce, rien de plus à la clôture.
    {
      const T = await partie(['dividende'], { real100: true });
      const A = T.co(0);
      setup(T, A, 3e-6, true);
      const m0 = T.money();
      const a = await annoncer(T, 0, 0.3, 'max');
      closeSemesterMode(T, 'max');
      ok(a.added === 1 && T.closeReds(0) === 0 && T.eng.run(`${A}.dividendPenaltyRedAdded`) === 1 && near(m0, T.money(), 1e-9),
        `honnête : 1 rouge à l'annonce (90 %), versé 4,50 $ par action à la clôture = même palier : 0 de plus (${T.closeReds(0)}), monnaie conservée`);
    }
    // b) Décoche, annonce 0,8 M$ (80 % : rien), recoche : 3 + 4 = 7 $ par action = 140 % -> 1 dès la confirmation.
    for(const mode of ['min', 'max']){
      const T = await partie(['dividende'], { real100: true });
      const A = T.co(0);
      setup(T, A, 3e-6, true);
      const m0 = T.money();
      const off = await recurrent(T, 0, false, 3);
      const a = await annoncer(T, 0, 0.8, mode);
      const on = await recurrent(T, 0, true, 3, mode);
      const logs = T.eng.json(`__logs.filter(l=>/récurrent modifié après une annonce/.test(l))`);
      closeSemesterMode(T, mode);
      const paid = T.eng.run(`dividendNetPaidInSemester(${A}.id, 1)`);
      ok(off.alerts.length === 0 && a.added === 0 && on.added === 1 && T.closeReds(0) === 0 && near(paid, 1.4, 1e-9),
        `[${mode}] décoche, annonce 0,8 M$ : ${a.added} rouge ; recoche : +${on.added} tout de suite (140 %) ; clôture : versé ${paid.toFixed(2)} M$, +${T.closeReds(0)}`);
      ok(logs.length === 1 && /140 %/.test(logs[0]), `[${mode}] journal : « ${(logs[0] || '').slice(0, 150)}… »`);
      ok(near(m0, T.money(), 1e-9), `[${mode}] monnaie conservée`);
    }
    // c) Avertissement de la fenêtre du récurrent avant de confirmer (case recochée, annonce de ce semestre).
    {
      const T = await partie(['dividende'], { real100: true });
      const A = T.co(0);
      setup(T, A, 3e-6, false);
      await annoncer(T, 0, 0.8);
      const r = await recurrent(T, 0, true, 3, 'min');
      ok(/dividende annoncé ce semestre/.test(r.warn) && /140 %/.test(r.warn) && /1 cube rouge/.test(r.warn),
        `fenêtre du récurrent, avant confirmation : « ${r.warn.replace(/<[^>]+>/g, '').slice(0, 170)}… »`);
    }
    // d) Annonce 0,2 M$ (80 % pile avec le récurrent 3 $), puis jauge au palier 7 (x2 : 6 $) : 140 % -> 1.
    for(const mode of ['min', 'max']){
      const T = await partie(['dividende'], { real100: true });
      const A = T.co(0);
      setup(T, A, 3e-6, true);
      const a = await annoncer(T, 0, 0.2, mode);
      const g = await recurrent(T, 0, true, 7, mode);
      closeSemesterMode(T, mode);
      ok(a.added === 0 && near(T.eng.run(`${A}.dividendBenchmarkPerShare`), 6e-6, 1e-15) && g.added === 1 && T.closeReds(0) === 0,
        `[${mode}] annonce 0,2 M$ (80 %) : ${a.added} ; jauge au palier 7 (récurrent 6 $, 140 %) : +${g.added} tout de suite ; clôture : +${T.closeReds(0)}`);
    }
    // e) Le rejugement de la clôture garde le bénéfice de référence de l'annonce (mémorisé), même s'il est revu ensuite.
    {
      const T = await partie(['garp'], { real100: true });
      const A = T.co(0);
      T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
      const a = await annoncer(T, 0, 0.9);
      T.eng.run(`__ovIS[${A}.id+':0'] = -1;`);
      closeSemester(T);
      ok(a.added === 1 && T.closeReds(0) === 0 && T.eng.run(`${A}.dividendPenaltyRefNetIncome`) === 1, `annonce à 90 % : ${a.added} ; bénéfice de référence revu à −1 M$ ensuite : la clôture rejuge sur le bénéfice mémorisé (1 M$), +${T.closeReds(0)}`);
    }
  });

  await scenario('13. Entreprise fondée en cours de partie : constat 2', async () => {
    const T = await partie(['garp', null]);
    T.eng.run(`state.gameClock.rollCount = 6;`);
    await T.eng.run(`createCompany(${JSON.stringify(T.ids[1])}, 'Co Bob', '', 'garp', null, null, null)`);
    T.eng.run(`state.companies.forEach(c=>applyCompanyIpoFunding(c)); (function(){ const b = ${T.co(1)}; const sh = b.shareholders.find(s=>s.playerId==='BANK'); if(sh) sh.playerId = state.players[2].id; })();`);
    const B = T.co(1);
    T.eng.run(`__ovIS[${B}.id+':2'] = 5;`);
    const r = await annoncer(T, 1, 1.0, 'max');
    ok(T.eng.run(`${B}.createdAtRoll`) === 6 && r.announced && r.added === 0 && /20 %/.test(r.preview) && /premier semestre/.test(r.preview),
      `fondée au lancer 6, bénéfice du semestre en cours 5 M$, annonce 1 M$ : 20 %, aucun rouge (${r.added}) — « ${r.preview.replace(/<[^>]+>/g, '').slice(-140)} »`);
    // Semestre suivant : la référence redevient le semestre clos.
    closeSemester(T);
    T.eng.run(`__ovIS[${B}.id+':2'] = 1; __ovIS[${B}.id+':3'] = 9;`);
    const r2 = await annoncer(T, 1, 0.9, 'max');
    ok(r2.added === 1 && /du dernier semestre clos/.test(r2.preview), `semestre suivant : référence = semestre clos (1 M$), 0,9 M$ = 90 % : ${r2.added} rouge`);
    // Section 321 — premier semestre : la référence (semestre en cours) peut passer en perte : 1 puis 2 au total.
    const Y = await partie(['garp', null]);
    Y.eng.run(`state.gameClock.rollCount = 6;`);
    await Y.eng.run(`createCompany(${JSON.stringify(Y.ids[1])}, 'Co Bob', '', 'garp', null, null, null)`);
    Y.eng.run(`state.companies.forEach(c=>applyCompanyIpoFunding(c)); (function(){ const b = ${Y.co(1)}; const sh = b.shareholders.find(s=>s.playerId==='BANK'); if(sh) sh.playerId = state.players[2].id; b.cash = 20; })();`);
    Y.eng.run(`__ovIS[${Y.co(1)}.id+':2'] = 1;`);
    const y1 = await annoncer(Y, 1, 0.9);
    Y.eng.run(`__ovIS[${Y.co(1)}.id+':2'] = -1;`);
    const y2 = await annoncer(Y, 1, 0.01);
    ok(y1.added === 1 && y2.added === 1 && Y.eng.run(`${Y.co(1)}.dividendPenaltyRedAdded`) === 2, `premier semestre : 90 % -> ${y1.added} ; bénéfice du semestre devenu négatif -> +${y2.added} (total 2, jamais plus)`);
  });

  await scenario('14. Banque en position négative : récurrent plafonné aux parts émises', async () => {
    const T = await partie(['dividende']);
    const A = T.co(0);
    // Parts émises 200 000 ; banque à -50 000 ; CEO 60 000 et Bob 190 000 = 250 000 parts réelles.
    T.eng.run(`(function(){ const c = ${A}; const bank = c.shareholders.find(s=>s.playerId==='BANK'); bank.shares = -50000;
      const ceo = c.shareholders.find(s=>s.playerId===c.ceoId); c.shareholders.push(Object.assign({}, ceo, {playerId: state.players.find(p=>p.id!==c.ceoId).id, shares: 190000}));
      __ovIS[c.id] = 1; __ovBNR[c.id] = 1; c.dividendBenchmarkPerShare = 3.5e-6; c.dividendAutoPay = true; state.gameClock.rollCount = 3; })()`);
    const info = T.eng.json(`announcedDividendPayoutPenalty(${A}, 0.05)`);
    const r = await annoncer(T, 0, 0.05, 'max');
    ok(near(info.recurrentPerShare, 3.5e-6, 1e-15) && near(info.ratio, 0.75, 1e-9) && r.added === 0,
      `récurrent 3,50 $ par action, quel que soit le nombre de parts réelles (250 000) ; + 0,05 M$ (0,25 $ par action) = 3,75 $ sur 5 $ de bénéfice par action = 75 %, aucun rouge (${r.added})`);
  });

  await scenario('15. Cote de crédit : dividende versé sur un bénéfice POSITIF', async () => {
    const T = await partie(['dividende']);
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 1e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 2;`);
    closeSemester(T); closeSemester(T);
    const c = T.eng.json(`companyCreditRatingInfo(${A})`);
    ok(near(c.defaultBadness, 0) && c.dividendLossSemesters === 0, `deux semestres de dividende avec bénéfice 1 M$ : composante « défaut » ${c.defaultBadness}, 0 semestre compté`);
  });

  await scenario('16. Aperçu périmé : clôture faite par un autre appareil pendant que la fenêtre est ouverte (constat 3)', async () => {
    const T = await partie(['garp'], { real100: true });
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id+':0'] = 10; __ovIS[${A}.id+':1'] = -1; state.gameClock.rollCount = 5;`);
    const { eng, dom } = T;
    dom.reset(); dom.add('mOk'); dom.add('mCancel');
    const input = dom.add('mDividendAmount'); const prev = dom.add('mDividendPayoutPreview');
    eng.run(`myPlayerId = ${JSON.stringify(eng.run(`${A}.ceoId`))}; modalAnnounceDividend();`);
    input.value = '1'; await input.fire('input');
    const shown = String(prev.innerHTML);
    eng.run(`advanceGameClock();`);  // l'autre appareil clôt le semestre 1 (bénéfice -1 M$)
    const red0 = eng.run(`${A}.stockReserve.red`), a0 = T.alerts.length, n0 = eng.run(`state.dividendAnnouncements.length`);
    await dom.get('mOk').fire('click');
    const refused = eng.run(`state.dividendAnnouncements.length`) === n0 && eng.run(`${A}.stockReserve.red`) === red0;
    const msg = T.alerts.slice(a0).join(' | ');
    ok(/10 %/.test(shown) && refused && /ratio de distribution a changé/.test(msg), `aperçu « 10 %, aucun cube » puis clôture : clic refusé, rien d'annoncé ni de rouge — « ${msg.slice(0, 110)}… »`);
    ok(/data-payout-tier="2"/.test(String(prev.innerHTML)) && /négatif/.test(String(prev.innerHTML)), 'l’aperçu est rafraîchi : bénéfice négatif, 2 rouges');
    T.ctl.mode = 'max';
    try { await dom.get('mOk').fire('click'); } finally { T.ctl.mode = 'natural'; }
    ok(eng.run(`state.dividendAnnouncements.length`) === n0 + 1 && eng.run(`${A}.stockReserve.red`) - red0 === 2, `le joueur reconfirme : annonce faite, ${eng.run(`${A}.stockReserve.red`) - red0} rouges (ceux affichés)`);
  });

  await scenario('17. Partie d’avant chargée en plein semestre, avec une annonce faite sous l’ancienne règle (constat 4)', async () => {
    const T = await partie(['garp'], { real100: true });
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id] = 1; __ovBNR[${A}.id] = 1; state.gameClock.rollCount = 3;
      (function(){ const c = ${A}; c.cash -= 1.2; logFin(c.id, 'dividend_payout', -1.2);
        state.dividendAnnouncements.push({id: uid(), companyId: c.id, amount: 1.2, announcedAtRoll: 3, payAtRoll: 6,
          recordHolders: c.shareholders.filter(s=>s.playerId!=='BANK').map(h=>({playerId:h.playerId, shares:h.shares})), totalSharesAtAnnouncement: c.sharesIssued});
        c.badDividendStreak = 1; delete c.dividendPenaltySemesterIdx; delete c.dividendPenaltyTier; delete c.dividendPenaltyRedAdded; delete c.dividendPenaltyRefNetIncome; delete c.dividendRecurrentChangedSemesterIdx; })();`);
    const raw = T.eng.run(`JSON.stringify(state)`), code = T.eng.run('gameCode');
    await T.eng.run(`storageSet('game:'+gameCode, ${JSON.stringify(raw)}, true)`);
    await T.eng.run(`loadGame(${JSON.stringify(code)})`);
    const f = T.eng.json(`[${A}.dividendPenaltySemesterIdx, ${A}.dividendPenaltyTier, ${A}.dividendPenaltyRedAdded, ${A}.dividendRecurrentChangedSemesterIdx]`);
    ok(f[0] === 1 && f[1] === 2 && f[2] === 0 && f[3] === -1, `chargée au semestre 1 avec une annonce de 1,2 M$ de ce semestre : semestre déjà jugé (palier max = 2 depuis la section 321, 0 rouge) ${JSON.stringify(f)}`);
    const m0 = T.money();
    const r = await annoncer(T, 0, 0.1, 'max');
    closeSemesterMode(T, 'max');
    ok(r.announced && r.added === 0 && T.closeReds(0) === 0 && near(m0, T.money(), 1e-9), `nouvelle annonce de 0,1 M$ (cumul 130 %) : ${r.added} rouge ; clôture : +${T.closeReds(0)} ; monnaie conservée`);
    const r2 = await annoncer(T, 0, 1.2, 'min');
    ok(r2.added === 1, `semestre suivant : nouvelle règle (1,2 M$ = 120 % du bénéfice) : ${r2.added} rouge`);
  });

  await scenario('18. Jauge du récurrent : un seul changement de niveau par semestre', async () => {
    const T = await partie(['dividende'], { real100: true });
    const A = T.co(0);
    T.eng.run(`__ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 1e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 3;`);
    const bm = () => T.eng.run(`${A}.dividendBenchmarkPerShare`);
    const r1 = await recurrent(T, 0, true, 7);
    ok(r1.alerts.length === 0 && near(bm(), 2e-6, 1e-15), `1er changement du semestre (palier 7) accepté : 1,00 -> ${(bm()*1e6).toFixed(2)} $/part`);
    const r2 = await recurrent(T, 0, true, 7);
    ok(r2.alerts.length === 1 && /déjà été modifié ce semestre/.test(r2.alerts[0]) && near(bm(), 2e-6, 1e-15), `2e hausse du même semestre refusée, référence inchangée — « ${(r2.alerts[0] || '').slice(0, 120)} »`);
    ok(/déjà été modifié ce semestre/.test(r2.html) && /id="mDivTier"[^>]*disabled/.test(r2.html), 'la fenêtre l’affiche dès l’ouverture et le curseur de niveau est désactivé');
    const tp0 = T.eng.json(`Object.assign({}, ${A}.typeReserve)`);
    const r3 = await recurrent(T, 0, true, 1);
    ok(r3.alerts.length === 1 && near(bm(), 2e-6, 1e-15) && JSON.stringify(T.eng.json(`Object.assign({}, ${A}.typeReserve)`)) === JSON.stringify(tp0), 'hausse puis baisse dans le même semestre : baisse refusée (référence et sac type inchangés)');
    const r4 = await recurrent(T, 0, false, 3), off = T.eng.run(`${A}.dividendAutoPay`);
    const r5 = await recurrent(T, 0, true, 3), on = T.eng.run(`${A}.dividendAutoPay`);
    ok(r4.alerts.length === 0 && off === false && r5.alerts.length === 0 && on === true && near(bm(), 2e-6, 1e-15), 'la case « Verser automatiquement » reste libre : décochée puis recochée dans le même semestre');
    closeSemester(T);
    const r6 = await recurrent(T, 0, true, 7);
    ok(r6.alerts.length === 0 && near(bm(), 4e-6, 1e-15) && !/déjà été modifié/.test(r6.html), `semestre suivant : changement accepté de nouveau (${(bm()*1e6).toFixed(2)} $/part)`);
    // Réactivation après suspension : retour au niveau de fondation = le changement du semestre.
    const S = await partie(['dividende'], { real100: true });
    const C = S.co(0);
    S.eng.run(`__ovIS[${C}.id] = 1; ${C}.dividendBenchmarkPerShare = 3e-6; ${C}.dividendBenchmarkFounding = 1e-6; ${C}.dividendAutoPay = false; state.gameClock.rollCount = 3;`);
    closeSemester(S);
    const susp = S.eng.run(`${C}.dividendRecurrentNeedsReset`);
    const q1 = await recurrent(S, 0, true, 7);
    const after1 = S.eng.run(`${C}.dividendBenchmarkPerShare`);
    const q2 = await recurrent(S, 0, true, 4);
    ok(susp === true && q1.alerts.length === 0 && near(after1, 2e-6, 1e-15) && q2.alerts.length === 1 && near(S.eng.run(`${C}.dividendBenchmarkPerShare`), 2e-6, 1e-15),
      `réactivation après suspension au palier 7 : fondation 1,00 x 2 = ${(after1*1e6).toFixed(2)} $/part (une confirmation) ; un 2e changement (palier 4) dans le semestre est refusé`);
    const U = await partie(['dividende'], { real100: true });
    const D = U.co(0);
    U.eng.run(`__ovIS[${D}.id] = 1; ${D}.dividendBenchmarkPerShare = 3e-6; ${D}.dividendBenchmarkFounding = 1e-6; ${D}.dividendAutoPay = false; state.gameClock.rollCount = 3;`);
    closeSemester(U);
    const u1 = await recurrent(U, 0, true, 3);
    const u2 = await recurrent(U, 0, true, 7);
    ok(u1.alerts.length === 0 && u2.alerts.length === 1 && near(U.eng.run(`${D}.dividendBenchmarkPerShare`), 1e-6, 1e-15), 'réactivation au palier 3 (retour à la fondation) puis palier 7 dans le même semestre : refusé');
  });

  if(failures.length){
    console.log(`\nÉCHEC : ${failures.length} scénario(s) en échec :\n  ` + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`\nOK : section 320 (dividendes) — ${n} vérifications`);
})().catch(e => { console.error('ÉCHEC :', e && e.stack || e); process.exit(1); });
