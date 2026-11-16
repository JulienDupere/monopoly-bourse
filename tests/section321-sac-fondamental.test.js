// Test — section 321 (lot A) : règles qui alimentent le sac FONDAMENTAL (décisions de Julien).
//   1. Semestre rentable ou déficitaire : 3 à 5 cubes (avant 1 à 2), pour les quatre types (branches ordinaires des
//      Croissance comprises) ; rien à l'équilibre. Grosses marges des Croissance inchangées (5 à 9 verts, 5 à 8 rouges).
//   2. Équité en hausse ou en baisse : plus aucun cube.
//   3. Revenus en hausse ou en baisse par rapport au semestre précédent : plus aucun cube.
//   4. Case Départ : plus de cube vert (salaire perçu ou avance remboursée) ; la subvention de 2 M$ reste.
//   5. Couverture des intérêts = (bénéfice net + TOUS les intérêts) ÷ intérêts : < 1 : 3 à 5 rouges ; [1, 2[ : 1 à 2
//      rouges ; ≥ 2 : 0 à 1 vert (hypothèques et titrisation ABS).
//   6. Cours contre valeur comptable par action (sauf Croissance) : rien entre 90 % et 110 % (bornes comprises) ;
//      valeur comptable nulle ou négative : rouges.
// Hasard : un faux Math (globals) impose le bas (« min ») ou le haut (« max ») de chaque tirage : la quantité tirée par
// injectStockCube est alors exactement la borne basse ou haute. Chaque injection est espionnée avec sa ligne d'appel,
// et rangée par règle d'après le texte de cette ligne dans le script chargé (même rangement pour l'ancien code).
// États financiers du semestre clos imposés (incomeStatementFor, balanceSheetFor, companyExpectedNetIncome remplacés).
// Contre-épreuves : chaque scénario nouveau est rejoué sur l'ancien code reconstitué (option transform) et doit y
// échouer ; puis des versions cassées exprès (mutations) doivent être attrapées.
// Contre-épreuve sur le vrai commit de base : S321_BASE=<copie d'index.html du commit 5d1bf58> node tests/section321-sac-fondamental.test.js
// Lancer depuis la racine du dépôt :  node tests/section321-sac-fondamental.test.js
const fs = require('fs');
const { loadEngine, near, engineSource } = require('./helpers/engine');

const SRC = engineSource();
const TYPES = ['dividende', 'garp', 'croissance', 'momentum'];
const CLOSE_SEM = 2, CLOSE_ROLL = CLOSE_SEM * 3 + 2; // semestre 2 : le semestre 1 existe (anciennes règles d'équité et de revenus)

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}

// Rangement d'une injection d'après le texte de sa ligne d'appel (nouveau code et ancien code).
function classify(text){
  if(/STOCK_CROISSANCE_BIG_(BEAT|MISS)_MARGIN\) injectStockCube/.test(text)) return 'grosseMarge';
  if(/is\.totalRevenue [<>] is\.totalExpense\) injectStockCube/.test(text)) return 'benefice';
  if(/bsThis\.equity [<>] bsPrev\.equity/.test(text)) return 'equite';
  if(/isPrevForGrowth\.totalRevenue/.test(text)) return 'revenus';
  if(/interestCoverage|STOCK_INTEREST_COVERAGE/.test(text)) return 'couverture';
  if(/bookPerShare0/.test(text)) return 'valorisation';
  if(/tier==='/.test(text)) return 'attendu';
  if(/STOCK_TRIGGER_NEGATIVE_CASH/.test(text)) return 'encaisse';
  if(/STOCK_DISTRESS_INJECT/.test(text)) return 'detresse';
  if(/STOCK_TRIGGER_GO_ADVANCE_RED/.test(text)) return 'avanceGO';
  return 'autre';
}

// Partie à quatre entreprises, une de chaque type (ordre de TYPES). transform : contre-épreuve ou mutation.
async function partie(transform){
  const ctl = { mode: 'natural', k: 0 };
  const M = Object.create(Math);
  M.random = () => {
    if(ctl.mode === 'min'){ ctl.k++; return (ctl.k % 100000) * 1e-9 + 1e-12; }
    if(ctl.mode === 'max'){ ctl.k++; return 1 - ((ctl.k % 100000) + 1) * 1e-9; }
    return Math.random();
  };
  const src = transform ? transform(SRC) : SRC;
  const lines = src.split('\n');
  const eng = loadEngine({ globals: { Math: M, alert: () => {} }, transform: transform ? () => src : undefined });
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe', 'Dan'], TYPES, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  // États imposés : __ov[id] = { is, prevIs, bs, prevBs, expect } (is = {rev, exp, m, a} : revenus, dépenses totales,
  // intérêts hypothécaires et intérêts ABS compris dans les dépenses).
  eng.run(`globalThis.__ov = {}; globalThis.__closingSem = -1;
    globalThis.__realIS = incomeStatementFor; globalThis.__realBS = balanceSheetFor;
    incomeStatementFor = function(id, sem){
      const c = __ov[id]; let o = null;
      if(c && sem===__closingSem && c.is) o = c.is;
      else if(c && sem===__closingSem-1 && c.prevIs) o = c.prevIs;
      if(!o) return __realIS(id, sem);
      const m = o.m||0, a = o.a||0, expenses = {};
      if(o.exp-m-a) expenses.rent_expense = o.exp-m-a;
      if(m) expenses.mortgage_interest_expense = m;
      if(a) expenses.abs_interest_expense = a;
      return {companyId:id, semesterIndex:sem, revenues:{rent_revenue:o.rev}, expenses, totalRevenue:o.rev, totalExpense:o.exp, netIncome:o.rev-o.exp};
    };
    balanceSheetFor = function(id, sem){
      const c = __ov[id], r = __realBS(id, sem);
      if(c && sem===__closingSem && c.bs) return Object.assign({}, r||{companyId:id, semesterIndex:sem}, c.bs);
      if(c && sem===__closingSem-1 && c.prevBs) return Object.assign({}, r||{companyId:id, semesterIndex:sem}, c.prevBs);
      return r;
    };
    companyExpectedNetIncome = function(co, sem){ const c = __ov[co.id]; return (c && c.expect) ? c.expect : null; };`);
  const inj = [];
  const real = eng.sandbox.injectStockCube;
  eng.sandbox.injectStockCube = function(co, color, a, b){
    const st = String(new Error().stack).split('\n');
    let line = null;
    for(const s of st){ const mm = /index\.html#script:(\d+):/.exec(s); if(mm){ line = +mm[1]; break; } }
    const q = real(co, color, a, b);
    inj.push({ co: co.id, color, q, rule: line ? classify(lines[line - 1] || '') : 'autre' });
    return q;
  };
  const coIds = eng.json(`state.companies.map(c=>c.id)`);
  const S = eng.run(`state.companies[0].totalShares`);
  const T = { eng, ids, ctl, inj, coIds, S };
  // Réglages par entreprise : cfg[i] = { is, prevIs, book, prevBook, price, cash, expect } (book = valeur comptable
  // par action, 10 par défaut ; price = cours, 10 par défaut : valorisation neutre).
  T.setup = (cfg) => {
    cfg.forEach((c, i) => {
      if(!c) return;
      const id = coIds[i];
      const o = { is: c.is || null, prevIs: c.prevIs || null, expect: c.expect || null };
      o.bs = { equity: (c.book === undefined ? 10 : c.book) * S };
      if(c.cash !== undefined) o.bs.cash = c.cash;
      if(c.prevBook !== undefined) o.prevBs = { equity: c.prevBook * S };
      eng.run(`__ov[${JSON.stringify(id)}] = ${JSON.stringify(o)}; companyById(${JSON.stringify(id)}).stockPrice = ${c.price === undefined ? 10 : c.price};`);
    });
  };
  // Clôture du semestre CLOSE_SEM ; rend les injections de la clôture par entreprise, et vérifie la monnaie.
  T.close = (mode, label) => {
    eng.run(`state.gameClock.rollCount = ${CLOSE_ROLL}; __closingSem = ${CLOSE_SEM};`);
    const m0 = eng.cashTotal();
    inj.length = 0;
    ctl.mode = mode;
    try { eng.run(`advanceGameClock()`); } finally { ctl.mode = 'natural'; }
    ok(near(m0, eng.cashTotal()), `${label} : monnaie conservée à la clôture (${m0.toFixed(4)})`);
    return coIds.map(id => inj.filter(x => x.co === id));
  };
  return T;
}

const lo = (mode, a, b) => mode === 'min' ? a : b;
const fmtInj = (list) => list.map(x => `${x.rule}:${x.color}:${x.q}`).join(', ') || 'aucune';
// Une seule injection de la règle `rule`, de couleur `color`, et rien d'autre pour cette entreprise.
function onlyRule(list, rule, color, q, label){
  const mine = list.filter(x => x.rule === rule), others = list.filter(x => x.rule !== rule);
  ok(mine.length === 1 && mine[0].color === color && mine[0].q === q && others.length === 0,
    `${label} : ${rule} ${color} ${q}, rien d'autre — obtenu ${fmtInj(list)}`);
}
function nothing(list, label){ ok(list.length === 0, `${label} : aucune injection — obtenu ${fmtInj(list)}`); }

const PROFIT = { rev: 10, exp: 9 };     // bénéfice 1, marge 10 % : branche ordinaire des Croissance
const LOSS = { rev: 10, exp: 10.5 };    // perte 0,5, marge −5 % : branche ordinaire des Croissance
const EVEN = { rev: 10, exp: 10 };

// --- Scénarios --------------------------------------------------------------------------------------------------
// fails : contre-épreuves (ancien code reconstitué, par point) sous lesquelles le scénario doit échouer.
const SCENARIOS = [
  { key: 'benefice', fails: ['P1'], title: '1. Semestre rentable 3 à 5 verts, déficitaire 3 à 5 rouges, équilibre : rien (quatre types)', fn: async (tf) => {
    for(const mode of ['min', 'max']){
      for(const [nm, is, color] of [['rentable', PROFIT, 'green'], ['déficitaire', LOSS, 'red'], ['équilibre', EVEN, null]]){
        const T = await partie(tf);
        T.setup(TYPES.map(() => ({ is })));
        const res = T.close(mode, `${nm} (${mode})`);
        res.forEach((list, i) => {
          const label = `${TYPES[i]}, semestre ${nm}, tirage ${mode}`;
          if(color) onlyRule(list, 'benefice', color, lo(mode, 3, 5), label); else nothing(list, label);
        });
      }
    }
  }},
  { key: 'equite', fails: ['P2'], title: '2. Équité en hausse ou en baisse : plus aucun cube', fn: async (tf) => {
    for(const mode of ['min', 'max']){
      for(const [nm, prevBook] of [['en hausse (5 → 10 par action)', 5], ['en baisse (15 → 10 par action)', 15]]){
        const T = await partie(tf);
        T.setup(TYPES.map(() => ({ is: PROFIT, prevIs: PROFIT, prevBook })));
        const res = T.close(mode, `équité ${nm} (${mode})`);
        res.forEach((list, i) => onlyRule(list, 'benefice', 'green', lo(mode, 3, 5), `${TYPES[i]}, équité ${nm}, tirage ${mode} : seul le bénéfice compte`));
      }
    }
  }},
  { key: 'revenus', fails: ['P3'], title: '3. Revenus en hausse ou en baisse : plus aucun cube', fn: async (tf) => {
    for(const mode of ['min', 'max']){
      for(const [nm, prevIs] of [['en hausse (5 → 10)', { rev: 5, exp: 4 }], ['en baisse (15 → 10)', { rev: 15, exp: 14 }]]){
        const T = await partie(tf);
        T.setup(TYPES.map(() => ({ is: PROFIT, prevIs })));
        const res = T.close(mode, `revenus ${nm} (${mode})`);
        res.forEach((list, i) => onlyRule(list, 'benefice', 'green', lo(mode, 3, 5), `${TYPES[i]}, revenus ${nm}, tirage ${mode} : seul le bénéfice compte`));
      }
    }
  }},
  { key: 'depart', fails: ['P4'], title: '4. Case Départ : salaire versé ou avance remboursée, aucun cube (quatre types)', fn: async (tf) => {
    const T = await partie(tf);
    for(const mode of ['min', 'max']){
      for(let i = 0; i < 4; i++){
        const id = JSON.stringify(T.coIds[i]);
        T.eng.run(`companyById(${id}).goAdvancesOwed = 0;`);
        const c0 = T.eng.run(`companyById(${id}).cash`), b0 = T.eng.run(`state.bank.cash`), m0 = T.eng.cashTotal();
        const r0 = T.eng.json(`companyById(${id}).stockReserve`);
        T.inj.length = 0; T.ctl.mode = mode;
        try { T.eng.run(`applyPassGoEffect(companyById(${id}))`); } finally { T.ctl.mode = 'natural'; }
        const r1 = T.eng.json(`companyById(${id}).stockReserve`);
        ok(near(T.eng.run(`companyById(${id}).cash`) - c0, 2) && near(T.eng.run(`state.bank.cash`) - b0, -2) && near(T.eng.cashTotal(), m0),
          `${TYPES[i]} (${mode}) : salaire de 2 M$ versé par la banque, monnaie conservée`);
        ok(T.inj.length === 0 && r1.green === r0.green && r1.red === r0.red, `${TYPES[i]} (${mode}) : salaire perçu, aucun cube — obtenu ${fmtInj(T.inj)}`);
        T.eng.run(`companyById(${id}).goAdvancesOwed = 1;`);
        const c1 = T.eng.run(`companyById(${id}).cash`), m1 = T.eng.cashTotal();
        T.inj.length = 0; T.ctl.mode = mode;
        try { T.eng.run(`applyPassGoEffect(companyById(${id}))`); } finally { T.ctl.mode = 'natural'; }
        ok(T.eng.run(`companyById(${id}).goAdvancesOwed`) === 0 && near(T.eng.run(`companyById(${id}).cash`), c1) && near(T.eng.cashTotal(), m1),
          `${TYPES[i]} (${mode}) : avance remboursée, aucun salaire, monnaie conservée`);
        ok(T.inj.length === 0, `${TYPES[i]} (${mode}) : avance remboursée, aucun cube — obtenu ${fmtInj(T.inj)}`);
      }
    }
  }},
];

// Couverture : intérêts de 2 ; bénéfice net = (couverture − 1) × 2 ; revenus 10.
const COVERAGE_CASES = [[0.5, 'red', 3, 5], [1, 'red', 1, 2], [1.5, 'red', 1, 2], [2, 'green', 0, 1], [3, 'green', 0, 1]];
for(const [variant, m, a, fails] of [['hypothèque seule', 2, 0, ['P5']], ['titrisation ABS seule', 0, 2, ['P5']], ['hypothèque et ABS (1 + 1)', 1, 1, ['P5']]]){
  SCENARIOS.push({ key: 'couverture-' + variant, fails, title: `5. Couverture des intérêts, ${variant} : 0,5 / 1 pile / 1,5 / 2 pile / 3`, fn: async (tf) => {
    for(const mode of ['min', 'max']){
      for(const [cov, color, qa, qb] of COVERAGE_CASES){
        const ni = (cov - 1) * 2;
        const T = await partie(tf);
        T.setup(TYPES.map(() => ({ is: { rev: 10, exp: 10 - ni, m, a } })));
        const res = T.close(mode, `couverture ${cov} (${variant}, ${mode})`);
        res.forEach((list, i) => {
          const mine = list.filter(x => x.rule === 'couverture');
          ok(mine.length === 1 && mine[0].color === color && mine[0].q === lo(mode, qa, qb),
            `${TYPES[i]}, ${variant}, couverture ${cov} (bénéfice ${ni}), tirage ${mode} : ${color} ${lo(mode, qa, qb)} — obtenu ${fmtInj(mine)}`);
        });
      }
    }
  }});
}

SCENARIOS.push({ key: 'valorisation', fails: ['P6'], title: '6. Cours contre valeur comptable : 85 %, 90 % pile, 100 %, 110 % pile, 115 %, valeur nulle et négative', fn: async (tf) => {
  const cases = [['85 %', 10, 8.5, 'green'], ['90 % pile', 10, 9, null], ['100 %', 10, 10, null], ['110 % pile', 10, 11, null], ['115 %', 10, 11.5, 'red'],
    ['valeur comptable nulle', 0, 10, 'red'], ['valeur comptable négative (−5)', -5, 10, 'red']];
  for(const mode of ['min', 'max']){
    for(const [nm, book, price, color] of cases){
      const T = await partie(tf);
      T.setup(TYPES.map(() => ({ is: EVEN, book, price })));
      const res = T.close(mode, `valorisation ${nm} (${mode})`);
      res.forEach((list, i) => {
        const label = `${TYPES[i]}, cours ${price} pour ${book} par action (${nm}), tirage ${mode}`;
        if(TYPES[i] === 'croissance' || !color) nothing(list, label);
        else onlyRule(list, 'valorisation', color, lo(mode, 1, 2), label);
      });
    }
  }
}});

SCENARIOS.push({ key: 'inchange', fails: [], title: '7. Règles inchangées : bénéfice contre attendu, encaisse négative, grosses marges des Croissance, subvention d\'avance', fn: async (tf) => {
  for(const mode of ['min', 'max']){
    const T = await partie(tf);
    T.setup([
      { is: PROFIT, expect: { expected: 0, semestersUsed: 0, bootstrap: true }, cash: -1 },   // attendu « beat » 1 à 2 ; encaisse < 0 : 1 à 2
      { is: { rev: 10, exp: 6 }, expect: { expected: 1, semestersUsed: 3 } },                // « sigBeat » 3 à 5 (ratio 1,67)
      { is: { rev: 10, exp: 30 }, expect: { expected: 0, semestersUsed: 3 } },               // « reallyMiss » 6 à 8 ; marge −200 % : 5 à 8 rouges
      { is: { rev: 10, exp: 15 }, expect: { expected: 0, semestersUsed: 3 } },               // « sigMiss » 3 à 5 (ratio 0,67)
    ]);
    const res = T.close(mode, `règles inchangées (${mode})`);
    const pick = (list, rule) => list.filter(x => x.rule === rule).map(x => x.color + ' ' + x.q).join(',');
    ok(pick(res[0], 'attendu') === `green ${lo(mode, 1, 2)}`, `dividende : bénéfice au-dessus de l'attendu : vert ${lo(mode, 1, 2)} — obtenu ${fmtInj(res[0])}`);
    ok(pick(res[0], 'encaisse') === `red ${lo(mode, 1, 2)}`, `dividende : encaisse négative : rouge ${lo(mode, 1, 2)}`);
    ok(pick(res[1], 'attendu') === `green ${lo(mode, 3, 5)}`, `GARP : bénéfice nettement au-dessus de l'attendu : vert ${lo(mode, 3, 5)} — obtenu ${fmtInj(res[1])}`);
    ok(pick(res[2], 'attendu') === `red ${lo(mode, 6, 8)}`, `Croissance : choc majeur sous l'attendu : rouge ${lo(mode, 6, 8)} — obtenu ${fmtInj(res[2])}`);
    ok(pick(res[2], 'grosseMarge') === `red ${lo(mode, 5, 8)}` && pick(res[2], 'benefice') === '', `Croissance : grosse perte (marge −200 %) : rouge ${lo(mode, 5, 8)}, pas de règle ordinaire`);
    ok(pick(res[3], 'attendu') === `red ${lo(mode, 3, 5)}`, `Momentum : bénéfice nettement sous l'attendu : rouge ${lo(mode, 3, 5)} — obtenu ${fmtInj(res[3])}`);
    const T2 = await partie(tf);
    T2.setup([null, null, { is: { rev: 10, exp: 6 } }, null]);
    const res2 = T2.close(mode, `grosse marge (${mode})`);
    ok(pick(res2[2], 'grosseMarge') === `green ${lo(mode, 5, 9)}` && pick(res2[2], 'benefice') === '',
      `Croissance : grosse marge (40 %) : vert ${lo(mode, 5, 9)}, pas de règle ordinaire — obtenu ${fmtInj(res2[2])}`);
    const id = JSON.stringify(T2.coIds[1]), m0 = T2.eng.cashTotal();
    T2.inj.length = 0; T2.ctl.mode = mode;
    try { await T2.eng.run(`takeGoAdvance(${id})`); } finally { T2.ctl.mode = 'natural'; }
    ok(fmtInj(T2.inj) === `avanceGO:red:${lo(mode, 1, 2)}` && T2.eng.run(`companyById(${id}).goAdvancesOwed`) === 1 && near(T2.eng.cashTotal(), m0),
      `subvention d'avance prise : rouge ${lo(mode, 1, 2)} (inchangé), monnaie conservée — obtenu ${fmtInj(T2.inj)}`);
  }
}});

// --- Ancien code reconstitué, point par point (contre-épreuves) ----------------------------------------------
function rep(src, a, b){ if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 80)); return src.split(a).join(b); }
const OLD = {
  P1: s => rep(s, 'const STOCK_TRIGGER_PROFIT_MIN = 3, STOCK_TRIGGER_PROFIT_MAX = 5;', 'const STOCK_TRIGGER_PROFIT_MIN = 1, STOCK_TRIGGER_PROFIT_MAX = 2;'),
  P2: s => rep(s, "      // Section 321 (lot A, décision de Julien) : plus de cubes pour une équité en hausse ou en baisse d'un semestre à\n",
    "      const bsPrev = balanceSheetFor(co.id, semesterBefore-1);\n      if(bsThis && bsPrev){\n" +
    "        if(bsThis.equity > bsPrev.equity) injectStockCube(co, 'green', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n" +
    "        else if(bsThis.equity < bsPrev.equity) injectStockCube(co, 'red', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n      }\n" +
    "      // Section 321 (lot A, décision de Julien) : plus de cubes pour une équité en hausse ou en baisse d'un semestre à\n"),
  P3: s => rep(s, '      // Section 321 (lot A, décision de Julien) : plus de cubes pour des revenus en hausse',
    "      const earliestSemForGrowth = Math.max(Math.floor((co.createdAtRoll||0)/3), Math.floor((state.finLedgerStartedAtRoll||0)/3));\n" +
    "      if((semesterBefore-1) >= earliestSemForGrowth){\n        const isPrevForGrowth = incomeStatementFor(co.id, semesterBefore-1);\n" +
    "        if(is.totalRevenue > isPrevForGrowth.totalRevenue) injectStockCube(co, 'green', 0, 1);\n" +
    "        else if(is.totalRevenue < isPrevForGrowth.totalRevenue) injectStockCube(co, 'red', 0, 1);\n      }\n" +
    '      // Section 321 (lot A, décision de Julien) : plus de cubes pour des revenus en hausse'),
  P4: s => rep(rep(s, '    // Section 321 (lot A) : plus de cube vert (voir plus haut).\n', "    injectStockCube(co, 'green', 1, 2);\n"),
    '    // tous les cours avec le temps). Le salaire perçu compte déjà dans le bénéfice du semestre (go_salary_revenue).\n',
    "    // tous les cours avec le temps). Le salaire perçu compte déjà dans le bénéfice du semestre (go_salary_revenue).\n    injectStockCube(co, 'green', 1, 2);\n"),
  P5: s => rep(s, "      const interestExpense = semesterInterestExpense(is);\n      if(interestExpense>1e-9){\n" +
    "        const interestCoverage = (is.netIncome + interestExpense)/interestExpense;\n" +
    "        if(interestCoverage < STOCK_INTEREST_COVERAGE_WEAK - 1e-9) injectStockCube(co, 'red', STOCK_INTEREST_COVERAGE_UNCOVERED_RED_MIN, STOCK_INTEREST_COVERAGE_UNCOVERED_RED_MAX);\n" +
    "        else if(interestCoverage < STOCK_INTEREST_COVERAGE_STRONG - 1e-9) injectStockCube(co, 'red', STOCK_INTEREST_COVERAGE_WEAK_RED_MIN, STOCK_INTEREST_COVERAGE_WEAK_RED_MAX);\n" +
    "        else injectStockCube(co, 'green', STOCK_INTEREST_COVERAGE_STRONG_GREEN_MIN, STOCK_INTEREST_COVERAGE_STRONG_GREEN_MAX);\n",
    "      const mortgageInterestExpense = is.expenses['mortgage_interest_expense']||0;\n      if(mortgageInterestExpense>1e-9){\n" +
    "        const interestCoverage = (is.netIncome + mortgageInterestExpense)/mortgageInterestExpense;\n" +
    "        if(interestCoverage > 1.0) injectStockCube(co, 'green', 0, 1);\n        else if(interestCoverage < 1.0) injectStockCube(co, 'red', 0, 1);\n"),
  P6: s => rep(s, "        if(bookPerShare0 > 1e-9){\n" +
    "          if(co.stockPrice < bookPerShare0*(1-STOCK_BOOK_VALUE_TOLERANCE_PCT)) injectStockCube(co, 'green', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n" +
    "          else if(co.stockPrice > bookPerShare0*(1+STOCK_BOOK_VALUE_TOLERANCE_PCT)) injectStockCube(co, 'red', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n" +
    "        } else if(bookPerShare0 < co.stockPrice) injectStockCube(co, 'red', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n",
    "        if(bookPerShare0 > co.stockPrice) injectStockCube(co, 'green', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n" +
    "        else if(bookPerShare0 < co.stockPrice) injectStockCube(co, 'red', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n"),
};
const OLD_ALL = s => Object.values(OLD).reduce((acc, f) => f(acc), s);

// --- Versions cassées exprès (mutations) et scénarios qui doivent les attraper ---------------------------------
const MUTATIONS = [
  ['bénéfice à 2 à 5 cubes', s => rep(s, 'const STOCK_TRIGGER_PROFIT_MIN = 3,', 'const STOCK_TRIGGER_PROFIT_MIN = 2,'), ['benefice']],
  ['Croissance ordinaire restée à 1 à 2 verts', s => rep(s, "else if(is.totalRevenue > is.totalExpense) injectStockCube(co, 'green', STOCK_TRIGGER_PROFIT_MIN, STOCK_TRIGGER_PROFIT_MAX);",
    "else if(is.totalRevenue > is.totalExpense) injectStockCube(co, 'green', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);"), ['benefice']],
  ['tolérance de valorisation à 5 %', s => rep(s, 'const STOCK_BOOK_VALUE_TOLERANCE_PCT = 0.10;', 'const STOCK_BOOK_VALUE_TOLERANCE_PCT = 0.05;'), ['valorisation']],
  ['90 % pile compté comme sous la valeur', s => rep(s, 'co.stockPrice < bookPerShare0*(1-', 'co.stockPrice <= bookPerShare0*(1-'), ['valorisation']],
  ['110 % pile compté comme au-dessus', s => rep(s, 'co.stockPrice > bookPerShare0*(1+', 'co.stockPrice >= bookPerShare0*(1+'), ['valorisation']],
  ['valeur comptable négative oubliée', s => rep(s, "        } else if(bookPerShare0 < co.stockPrice) injectStockCube(co, 'red', STOCK_TRIGGER_LEVEL_MIN, STOCK_TRIGGER_LEVEL_MAX);\n", '        }\n'), ['valorisation']],
  ['valorisation appliquée aux Croissance', s => rep(s, "if(co.type!=='croissance' && bookPerShare0!==null){\n        if(bookPerShare0 > 1e-9){", 'if(bookPerShare0!==null){\n        if(bookPerShare0 > 1e-9){'), ['valorisation']],
  ['intérêts ABS oubliés', s => rep(s, "['mortgage_interest_expense', 'abs_interest_expense']", "['mortgage_interest_expense']"), ['couverture-titrisation ABS seule']],
  ['couverture 1 pile comptée sous 1', s => rep(s, 'STOCK_INTEREST_COVERAGE_WEAK - 1e-9', 'STOCK_INTEREST_COVERAGE_WEAK + 1e-9'), ['couverture-hypothèque seule']],
  ['couverture 2 pile comptée sous 2', s => rep(s, 'STOCK_INTEREST_COVERAGE_STRONG - 1e-9', 'STOCK_INTEREST_COVERAGE_STRONG + 1e-9'), ['couverture-hypothèque seule']],
  ['couverture sans réintégrer les intérêts', s => rep(s, '(is.netIncome + interestExpense)/interestExpense', 'is.netIncome/interestExpense'), ['couverture-hypothèque seule']],
  ['cube vert du salaire de la case Départ remis', s => rep(s, '    // Section 321 (lot A) : plus de cube vert (voir plus haut).\n', "    injectStockCube(co, 'green', 1, 2);\n"), ['depart']],
  // Section 321 (lot B, retouche de la revue) : la branche « avance remboursée » de la case Départ avait sa règle sans version cassée.
  ['cube vert de l’avance remboursée remis', s => rep(s, '    entries = [];\n    log(`${co.name} passe par GO — rembourse une avance', "    entries = []; injectStockCube(co, 'green', 1, 2);\n    log(`${co.name} passe par GO — rembourse une avance"), ['depart']],
  ['grosse marge des Croissance à 3 à 9', s => rep(s, "injectStockCube(co, 'green', 5, 9)", "injectStockCube(co, 'green', 3, 9)"), ['inchange']],
  ['encaisse négative oubliée', s => rep(s, 'if(bsThis && bsThis.cash<0){', 'if(false){'), ['inchange']],
];

async function runScenario(sc, tf){
  try { await sc.fn(tf); return null; }
  catch(e){ return (e && e.message) ? e.message : String(e); }
}

// Partie enregistrée par l'ancien code (reconstitué, ou commit de base si S321_BASE), chargée par le nouveau.
async function partieDAvant(oldTransform){
  const oldEng = loadEngine({ transform: oldTransform });
  await oldEng.newGame(['Alice', 'Bob', 'Chloe', 'Dan'], TYPES, 20, 1000);
  oldEng.run(`state.gameClock.rollCount = 0; for(let k=0;k<4;k++) advanceGameClock(); applyPassGoEffect(state.companies[0]); applyPassGoEffect(state.companies[1]);`);
  await oldEng.run(`saveGame()`);
  const code = oldEng.run(`gameCode`), roll0 = oldEng.run(`state.gameClock.rollCount`);
  const eng = loadEngine();
  for(const [k, v] of oldEng.mem) eng.mem.set(k, v);
  const loaded = await eng.run(`loadGame(${JSON.stringify(code)})`);
  ok(loaded === true && eng.run(`state.companies.length`) === 4 && eng.run(`state.gameClock.rollCount`) === roll0,
    `partie de l'ancien code (lancer ${roll0}) chargée par le nouveau : 4 entreprises`);
  const lines = SRC.split('\n'), inj = [];
  const real = eng.sandbox.injectStockCube;
  eng.sandbox.injectStockCube = function(co, color, a, b){
    const st = String(new Error().stack).split('\n'); let line = null;
    for(const s of st){ const mm = /index\.html#script:(\d+):/.exec(s); if(mm){ line = +mm[1]; break; } }
    const q = real(co, color, a, b); inj.push({ co: co.id, color, q, rule: line ? classify(lines[line - 1]) : 'autre' }); return q;
  };
  eng.run(`state.gameClock.rollCount = 5;`);
  const m0 = eng.cashTotal();
  eng.run(`drawStockCubes = function(){ return []; };`);
  eng.run(`advanceGameClock()`);
  ok(eng.run(`state.gameClock.rollCount`) === 6 && !eng.run(`state.gameEndedReason`), 'semestre 1 clôturé par le nouveau code (lancer 6), partie en cours');
  ok(near(eng.cashTotal(), m0), `monnaie conservée à la clôture (${m0.toFixed(4)})`);
  const profit = inj.filter(x => x.rule === 'benefice');
  ok(inj.every(x => x.rule !== 'equite' && x.rule !== 'revenus') && profit.every(x => x.q >= 3 && x.q <= 5),
    `clôture : ni équité ni revenus, bénéfice à 3 à 5 cubes — obtenu ${fmtInj(inj)}`);
}

(async () => {
  const base = process.env.S321_BASE;
  if(base){
    // Contre-épreuve sur le vrai commit de base : chaque scénario nouveau doit échouer.
    const html = fs.readFileSync(base, 'utf8').replace(/\r\n/g, '\n');
    const a = html.lastIndexOf('\n<script>\n'), b = html.lastIndexOf('\n</script>');
    const baseSrc = html.slice(a + '\n<script>\n'.length, b);
    quiet = true;
    let bad = 0;
    for(const sc of SCENARIOS){
      const err = await runScenario(sc, () => baseSrc);
      const expectFail = sc.fails.length > 0;
      console.log(`${(!!err) === expectFail ? 'attendu' : 'INATTENDU'} : ${sc.title} — ${err ? 'échoue : ' + err.slice(0, 160) : 'passe'}`);
      if((!!err) !== expectFail) bad++;
    }
    quiet = false;
    try { await partieDAvant(() => baseSrc); console.log('attendu : partie enregistrée par le commit de base, chargée et clôturée par le nouveau code'); }
    catch(e){ bad++; console.log('INATTENDU : partie du commit de base — ' + e.message); }
    console.log(bad ? `ÉCHEC : ${bad} scénario(s) au comportement inattendu sur le commit de base` : 'OK : contre-épreuve sur le commit de base conforme');
    process.exit(bad ? 1 : 0);
  }

  const failures = [];
  for(const sc of SCENARIOS){
    console.log(sc.title);
    const err = await runScenario(sc, null);
    if(err){ console.log('  ' + err); failures.push(sc.title.slice(0, 40) + ' — ' + err); }
  }
  console.log('8. Partie enregistrée avant le lot : chargée et clôturée par le nouveau code');
  try { await partieDAvant(OLD_ALL); } catch(e){ console.log('  ' + e.message); failures.push('partie d’avant — ' + e.message); }
  const nMain = n;

  console.log('9. Contre-épreuves : chaque scénario nouveau échoue sur l\'ancien code de son point');
  quiet = true;
  for(const sc of SCENARIOS){
    for(const p of sc.fails){
      const err = await runScenario(sc, OLD[p]);
      quiet = false;
      try { ok(!!err, `ancien code ${p} : « ${sc.title.slice(0, 60)}… » échoue — ${err ? err.replace(/^ÉCHEC : /, '').slice(0, 140) : 'il passe !'}`); }
      catch(e){ failures.push(e.message); console.log('  ' + e.message); }
      quiet = true;
    }
  }
  // Ancien code complet : les mêmes scénarios échouent, sauf le n° 7 (règles inchangées) qui passe.
  for(const sc of SCENARIOS){
    const err = await runScenario(sc, OLD_ALL);
    quiet = false;
    try { ok((!!err) === (sc.fails.length > 0), `ancien code complet : « ${sc.title.slice(0, 60)}… » ${err ? 'échoue' : 'passe'}`); }
    catch(e){ failures.push(e.message); console.log('  ' + e.message); }
    quiet = true;
  }

  console.log('10. Versions cassées exprès (mutations)');
  let caught = 0;
  for(const [nm, tf, keys] of MUTATIONS){
    let err = null;
    for(const k of keys){ const sc = SCENARIOS.find(x => x.key === k); err = err || await runScenario(sc, tf); }
    quiet = false;
    try { ok(!!err, `mutation « ${nm} » attrapée — ${err ? err.replace(/^ÉCHEC : /, '').slice(0, 140) : 'non attrapée !'}`); caught++; }
    catch(e){ failures.push(e.message); console.log('  ' + e.message); }
    quiet = true;
  }
  quiet = false;

  if(failures.length){
    console.log(`\nÉCHEC : section 321 (lot A, sac fondamental) — ${failures.length} échec(s) :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`\nOK : section 321 (lot A, sac fondamental) — ${n} vérifications (${nMain} sur le nouveau code), ${caught}/${MUTATIONS.length} mutations attrapées`);
})().catch(e => { console.log('ÉCHEC : ' + (e && e.stack || e)); process.exit(1); });
