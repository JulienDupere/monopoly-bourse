// Contre-épreuves automatiques (section 317, seconde moitié) : pour chaque bogue d'affichage, une observation minimale est
// faite sur le moteur ACTUEL (elle doit montrer le comportement corrigé) puis sur un moteur où l'ancien code est
// réintroduit par loadEngine({transform}) (elle doit montrer le défaut). Si le correctif disparaît, ce fichier échoue.
// Couvre 82, 83, 84, 89, 90, 93, 94, 97 et le libellé de durée de partie (95). Les bogues 88 et 95 (années) ont leur
// contre-épreuve dans section317b-lot.test.js et section317b-annees.test.js.
// Lancer depuis la racine du dépôt :  node tests/section317b-contre.test.js
const { loadEngine, check } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const BS = String.fromCharCode(92);
const swap = (a, b) => (src) => { if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 60)); return src.split(a).join(b); };

async function boot(transform, types = ['garp'], extra){
  const doc = creerDocument();
  const eng = loadEngine({ transform, globals: { document: doc, alert: () => {} } });
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], types, 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])}; injectStockCube = function(){ return 0; }; drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push({msg: String(msg), entries: entries ? JSON.parse(JSON.stringify(entries)) : []}); return __realLog.apply(this, arguments); };`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  return { eng, doc };
}

// Chaque entrée : transform (ancien code), observe(eng) -> booléen « comportement corrigé ».
const cas = [
  { bogue: '82 coût du récurrent', transform: swap('fmt(baseBenchmark*dividendPaidShares)}</b>', 'fmt(baseBenchmark*myCo.sharesIssued)}</b>'), types: ['dividende'],
    obs: async (eng) => { eng.run(`__A=()=>state.companies[0]; __A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = true; modalDividendRecurrentSettings();`); return />90 K\$</.test(eng.run(`__modals[__modals.length-1]`)); } },
  { bogue: '83 banque au journal', transform: swap('Banque (paiement reçu du vendeur', 'Banque (reçu du vendeur'), types: ['dividende'],
    obs: async (eng) => {
      eng.run(`state.companies[0].dividendBenchmarkPerShare = 5e-6; state.companies[0].dividendAutoPay = true; openShortPosition(state.companies[0], state.players[2], 2); __logs.length = 0; advanceGameClock(); advanceGameClock(); advanceGameClock();`);
      return eng.json(`__logs.some(l=>l.entries.some(e=>e.label.indexOf('Banque (paiement reçu')===0))`); } },
  { bogue: '84 écart d\'arrondi', transform: swap(':Math.abs(total)>=0.01?(balanceNote?' + `'('+esc(balanceNote)+')':''):'(écart d`, `:'(écart d`),
    obs: async (eng) => { eng.run(`__modals.length = 0; showTransactionPopup('T', [{label:'a', amount:3}], 'note');`); return !/écart d.arrondi/.test(eng.run(`__modals[__modals.length-1]`)); } },
  { bogue: '89 libellé capitalisation', transform: swap('(toutes les parts émises, part de la banque comprise)', '(excl. part de la banque)'),
    obs: async (eng) => !/excl\. part de la banque/.test(eng.run(`renderEntrepriseFinancials(state.companies[0])`)) },
  { bogue: '90 attente fixe', transform: swap('netIncomeExpectation.bootstrap ? (', 'false ? ('),
    obs: async (eng) => { eng.run(`state.gameClock.rollCount = 3;`); return /attente fixe de départ pour le 2e semestre de l'entreprise/.test(eng.run(`renderEntreprise()`)); } },
  { bogue: '93 taux du journal', transform: swap('(taux ${(priceRate*100).toFixed(1)}%)', '(taux ${(riskAdjustedRate(state.settings.goAdvanceRate,co)*100).toFixed(1)}%)'),
    obs: async (eng) => {
      eng.run(`state.settings.goAdvanceRate = 0.10; state.settings.debtSpreadFactor = 0.10; globalThis.C = state.companies[0];`);
      await eng.run(`takeGoAdvance(C.id, {expectedOwed: 0, expectedConditions: goAdvanceConditions(C.id), fromConfirm: true})`);
      return eng.json(`__logs.some(l=>l.msg.indexOf('(taux 10.0%)')>=0)`); } },
  { bogue: '94 prêt de dernier recours', transform: swap("text: l.lastResort // Section 317 — bogue 94 : le prêt de dernier recours n'est pas une offre acceptée", 'text: false'),
    obs: async (eng) => { eng.run(`globalThis.C = state.companies[0]; state.gameClock.rollCount = 30; C.cash = -1; triggerLastResortLoan(C.id);`); return eng.json(`recentExecutionEntriesForPlayer(state.players[0], 10).some(e=>e.text.indexOf('Prêt de dernier recours')===0)`); } },
  { bogue: '97 illimité', transform: swap("function fmtLoanCap(v){ return isFinite(v) ? fmt(v) : 'illimité'; }", 'function fmtLoanCap(v){ return fmt(v); }'),
    obs: async (eng) => { eng.run(`state.settings.loanMaxPrincipal = 0; state.settings.features.loan = true; modalIssueLoan();`); return eng.run(`__modals[__modals.length-1]`).includes('<b>illimité</b>'); } },
  { bogue: '95 libellé de durée', transform: swap("La partie s'arrête à la fin de l'année N+1 affichée", 'Un an est choisi'),
    obs: async (eng, doc) => { eng.run(`renderSetup()`); return /fin de l'année N\+1 affichée/.test(doc.trouver('app').innerHTML); } },
];

(async () => {
  for(const c of cas){
    console.log('\nContre-épreuve — bogue ' + c.bogue);
    const apres = await boot(null, c.types);
    ok(await c.obs(apres.eng, apres.doc), 'code actuel : comportement corrigé observé');
    const avant = await boot(c.transform, c.types);
    ok(!(await c.obs(avant.eng, avant.doc)), 'ancien code réintroduit : le défaut revient — le test détecte la régression');
  }
  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
