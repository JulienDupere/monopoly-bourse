// Test — section 320 : les dividendes et le sac fondamental (décision de Julien).
//   A. Plus de séquence de dividendes au sac fondamental, pour les quatre types (ni verts de série, ni rouges de série
//      brisée, ni les 1 à 2 verts des Croissance et Momentum). Les règles du sac TYPE restent (sections 306 et 315).
//   B. Réglages dividendPayoutRatioMin / Full et dividendLossPauseMax retirés du menu de départ et du moteur.
//   C. Un dividende ANNONCÉ ajoute des rouges au sac fondamental selon le ratio de distribution cumulé du semestre
//      (annonces hors part de la banque + récurrent d'une Dividendes) ÷ bénéfice du dernier semestre clos :
//      ≤ 80 % rien ; ≤ 100 % 1 à 2 ; ≤ 150 % 3 à 5 ; au-delà ou sans bénéfice 6 à 8. Le palier du cumul compte.
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
  const i = lines.findIndex(l => l.includes("const mortgageInterestExpense = is.expenses['mortgage_interest_expense']"));
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
    add(id){
      const listeners = {};
      const base = {
        id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
        addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(){},
        async fire(type){ for(const fn of (listeners[type] || [])) await fn({ target: el }); },
      };
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
  if(real100){
    eng.run(`state.companies.forEach(c=>{ const other = state.players.find(p=>p.id!==c.ceoId); const b = c.shareholders.find(s=>s.playerId==='BANK'); if(b) b.playerId = other.id; });`);
  }
  // Espion du sac fondamental : quantité et ligne d'appel dans le script.
  const inj = [];
  const real = eng.sandbox.injectStockCube;
  eng.sandbox.injectStockCube = function(co, color, a, b){
    const st = String(new Error().stack).split('\n').slice(2);
    let line = null;
    for(const s of st){ const m = /index\.html#script:(\d+):/.exec(s); if(m){ line = +m[1]; break; } }
    const q = real(co, color, a, b);
    inj.push({ co: co.id, color, q, line });
    return q;
  };
  const T = { eng, ids, ctl, alerts, inj, dom: installModalDom(eng) };
  T.co = (i) => `state.companies.find(c=>c.ceoId===${JSON.stringify(ids[i])})`;
  T.money = () => eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
  T.dividendInj = (i) => { const id = eng.run(`${T.co(i)}.id`); return inj.filter(x => x.co === id && x.line > RANGE[0] && x.line < RANGE[1]); };
  return T;
}

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
    ok(tp.green === 4 && tp.red === 6 && tp.white === 0, `règle du sac type (section 306) inchangée : 6V/1R/3B -> 4V/6R/0B (${JSON.stringify(tp)})`);
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

  await scenario('3. Paliers du ratio de distribution (annonce seule, 100 % des parts aux actionnaires réels, bénéfice 1 M$)', async () => {
    const cas = [
      ['70 %', 1, 0.7, 0, 0], ['80 % pile', 1, 0.8, 0, 0], ['90 %', 1, 0.9, 1, 2], ['100 % pile', 1, 1.0, 1, 2],
      ['120 %', 1, 1.2, 3, 5], ['150 % pile', 1, 1.5, 3, 5], ['200 %', 1, 2.0, 6, 8], ['semestre déficitaire (-0,5 M$)', -0.5, 0.3, 6, 8],
    ];
    for(const [titre, ni, amount, lo, hi] of cas){
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
      ok(res.min === lo && res.max === hi, `${titre} : ${lo === hi ? lo : lo + ' à ' + hi} rouge(s) (tirage bas ${res.min}, tirage haut ${res.max}), monnaie conservée`);
    }
    // Hasard réel : toujours dans les bornes.
    const T = await partie(['garp'], { real100: true });
    T.eng.run(`__ovIS[${T.co(0)}.id] = 1; state.gameClock.rollCount = 3;`);
    const vus = new Set();
    for(let t = 0; t < 30; t++){
      T.eng.run(`state.dividendAnnouncements = []; ${T.co(0)}.dividendPenaltySemesterIdx = -1; ${T.co(0)}.cash = 20;`);
      vus.add((await annoncer(T, 0, 1.2)).added);
    }
    ok([...vus].every(x => x >= 3 && x <= 5), `120 %, 30 tirages au hasard : toujours entre 3 et 5 (${[...vus].sort().join(', ')})`);
  });

  await scenario('4. Dividendes : récurrent + annonce', async () => {
    const T = await partie(['dividende'], { real100: true });
    const A = T.co(0);
    // Récurrent : 3 $/part × 200 000 parts réelles = 0,6 M$ (60 % du bénéfice de 1 M$) ; annonce de 0,3 M$ -> 90 %.
    T.eng.run(`__ovIS[${A}.id] = 1; ${A}.dividendBenchmarkPerShare = 3e-6; ${A}.dividendAutoPay = true; state.gameClock.rollCount = 3;`);
    const lo = await annoncer(T, 0, 0.3, 'min');
    T.eng.run(`state.dividendAnnouncements = []; ${A}.dividendPenaltySemesterIdx = -1; ${A}.cash += 0.3;`);
    const hi = await annoncer(T, 0, 0.3, 'max');
    ok(lo.added === 1 && hi.added === 2, `récurrent 60 % + annonce 30 % = 90 % : 1 à 2 rouges (bas ${lo.added}, haut ${hi.added})`);
    ok(/90 %/.test(hi.preview), `l'aperçu compte le récurrent : « ${hi.preview.replace(/<[^>]+>/g, '').slice(0, 120)}… »`);
    // Récurrent seul à 90 % : rien, ni à l'annonce (il n'y en a pas) ni à la clôture.
    const T2 = await partie(['dividende'], { real100: true });
    const A2 = T2.co(0);
    T2.eng.run(`__ovIS[${A2}.id] = 1; ${A2}.dividendBenchmarkPerShare = 4.5e-6; ${A2}.dividendAutoPay = true; state.gameClock.rollCount = 3;`);
    const info = T2.eng.json(`announcedDividendPayoutPenalty(${A2}, 0)`);
    ok(info.tier === 0 && near(info.ratio, 0.9, 1e-9), `sans annonce, ratio affiché 90 % mais palier 0 (${JSON.stringify({ tier: info.tier, ratio: info.ratio })})`);
    const m0 = T2.money(), red0 = T2.eng.run(`${A2}.stockReserve.red`);
    closeSemester(T2);
    ok(T2.dividendInj(0).length === 0, 'récurrent seul à 90 % versé à la clôture : aucune injection liée aux dividendes');
    ok(near(m0, T2.money(), 1e-9), 'monnaie conservée au versement du récurrent');
    void red0;
  });

  await scenario('5. Cumul dans le semestre', async () => {
    for(const mode of ['min', 'max']){
      const T = await partie(['garp'], { real100: true });
      const A = T.co(0);
      T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
      const a1 = await annoncer(T, 0, 0.5, mode), a2 = await annoncer(T, 0, 0.5, mode);
      ok(a1.added === 0 && a2.added === (mode === 'min' ? 1 : 2), `[${mode}] 50 % puis 50 % : ${a1.added} puis ${a2.added} rouge(s) — total ${a1.added + a2.added} (palier 1 à 2)`);
    }
    for(const mode of ['min', 'max']){
      const T = await partie(['garp'], { real100: true });
      const A = T.co(0);
      T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
      const m0 = T.money(); const steps = [];
      for(let k = 0; k < 4; k++) steps.push((await annoncer(T, 0, 0.5, mode)).added);
      const total = steps.reduce((s, x) => s + x, 0);
      ok(total === (mode === 'min' ? 6 : 8), `[${mode}] quatre annonces de 50 % : ${steps.join(' + ')} = ${total} rouges (jamais plus que le palier 6 à 8)`);
      ok(near(m0, T.money(), 1e-9), `[${mode}] monnaie conservée sur les quatre annonces`);
      // Une 5e annonce au même palier : rien de plus.
      ok((await annoncer(T, 0, 0.5, mode)).added === 0, `[${mode}] 5e annonce (250 %, même palier) : aucun rouge de plus`);
      // Semestre suivant : remise à zéro.
      closeSemester(T);
      const b1 = await annoncer(T, 0, 0.5, mode), b2 = await annoncer(T, 0, 0.5, mode);
      ok(T.eng.run(`${A}.dividendPenaltySemesterIdx`) === 2 && b1.added === 0 && b2.added === (mode === 'min' ? 1 : 2), `[${mode}] semestre suivant : on repart de zéro (50 % : ${b1.added}, puis 100 % : ${b2.added})`);
    }
    // Hasard réel : quatre annonces, total toujours entre 6 et 8.
    const totals = new Set();
    for(let t = 0; t < 15; t++){
      const T = await partie(['garp'], { real100: true });
      T.eng.run(`__ovIS[${T.co(0)}.id] = 1; state.gameClock.rollCount = 3;`);
      let tot = 0; for(let k = 0; k < 4; k++) tot += (await annoncer(T, 0, 0.5)).added;
      totals.add(tot);
    }
    ok([...totals].every(x => x >= 6 && x <= 8), `quatre annonces de 50 %, 15 parties au hasard : total toujours entre 6 et 8 (${[...totals].sort().join(', ')})`);
  });

  await scenario('6. Part de la banque exclue', async () => {
    const T = await partie(['garp']);
    const A = T.co(0);
    const bank = T.eng.run(`${A}.shareholders.find(s=>s.playerId==='BANK').shares`), issued = T.eng.run(`${A}.sharesIssued`);
    T.eng.run(`__ovIS[${A}.id] = 1; state.gameClock.rollCount = 3;`);
    const r = await annoncer(T, 0, 1.0, 'max');
    ok(near(bank / issued, 0.7) && r.added === 0, `la banque détient ${bank} parts sur ${issued} (70 %) ; annonce de 1 M$ = bénéfice : ratio 30 %, aucun rouge (${r.added})`);
    ok(/30 %/.test(r.preview) && /aucun cube/.test(r.preview), `aperçu : « ${r.preview.replace(/<[^>]+>/g, '').slice(0, 110)}… »`);
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
    ok(tierOf(a.preview) === 0 && /80 %/.test(a.preview) && /aucun cube/.test(a.preview) && !/brick/.test(a.preview) && a.added === 0, `80 % pile : aperçu palier 0, « aucun cube », pas en rouge ; appliqué : ${a.added}`);
    const b = await annoncer(T, 0, 0.4);
    const tierB = T.eng.run(`${A}.dividendPenaltyTier`);
    ok(tierOf(b.preview) === 2 && tierB === 2 && /120 %/.test(b.preview) && /3 à 5 cubes rouges/.test(b.preview) && /brick/.test(b.preview) && b.added >= 3 && b.added <= 5,
      `+0,4 M$ (cumul 120 %) : aperçu palier 2 « 3 à 5 cubes rouges » en rouge ; appliqué palier ${tierB}, ${b.added} rouges`);
    const c = await annoncer(T, 0, 0.5);
    const tierC = T.eng.run(`${A}.dividendPenaltyTier`), totC = T.eng.run(`${A}.dividendPenaltyRedAdded`);
    ok(tierOf(c.preview) === 3 && tierC === 3 && /170 %/.test(c.preview) && /de plus/.test(c.preview) && totC >= 6 && totC <= 8,
      `+0,5 M$ (cumul 170 %) : aperçu palier 3 « de plus », appliqué palier ${tierC}, total du semestre ${totC} rouges`);
    const d = await annoncer(T, 0, 0.1);
    ok(tierOf(d.preview) === 3 && /aucun cube de plus/.test(d.preview) && d.added === 0, `+0,1 M$ (même palier) : aperçu « aucun cube de plus », appliqué ${d.added}`);
    const logLine = T.eng.json(`__logs.filter(l=>/sac fondamental/.test(l))`);
    ok(logLine.length === 2 && /120 %/.test(logLine[0]) && /bénéfice du semestre|bénéfice du dernier semestre clos/.test(logLine[0]), `journal : « ${(logLine[0] || '').slice(0, 160)} »`);
    console.log(`    aperçu (120 %) : « ${b.preview.replace(/<[^>]+>/g, '')} »`);
    console.log(`    journal (170 %) : « ${logLine[1] || ''} »`);
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

  if(failures.length){
    console.log(`\nÉCHEC : ${failures.length} scénario(s) en échec :\n  ` + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`\nOK : section 320 (dividendes) — ${n} vérifications`);
})().catch(e => { console.error('ÉCHEC :', e && e.stack || e); process.exit(1); });
