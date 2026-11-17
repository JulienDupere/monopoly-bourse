// Vérifications du banc 323.
// 1) Le tour du banc (__tour, avec les espions) égale le vrai performRollForAllCompanies d'un moteur SANS espions
//    (fonctions d'origine remises ; seul le rendu et le journal sont neutralisés), même graine, un seul flux de hasard,
//    sur 12 lancers (4 semestres : chiffres figés, verdicts, cubes) ; nouveau et ancien moteur.
// 2) Le gel des chiffres : figés au premier lancer, égaux aux chiffres provisoires de la fenêtre, verdict une fois.
const { chargerMoteur323 } = require('./moteur323');
const { spec323 } = require('./suites323');
const { seedOf } = require('./rng');

const PHOTO = `({pos: state.companies.map(c=>[c.position, c.inJail, c.jailTurnsLeft]), pions: (state.neutralPawns||[]).map(p=>[p.position, p.inJail]),
  cours: state.companies.map(c=>c.stockPrice), cash: state.companies.map(c=>c.cash), banque: state.bank.cash,
  sacs: state.companies.map(c=>[c.stockReserve, c.typeReserve, c.tradingReserve]), livre: state.finLedger.map(e=>[e.companyId, e.semesterIndex, e.category, e.amount]),
  analystes: state.companies.map(c=>[c.analystForecast||null, c.analystHistory||null]), tour: state.gameClock.rollCount})`;

const RETIRER_ESPIONS = `injectStockCube = __o_inject; injectTradingCube = __o_injectT; advanceGameClock = __o_clock; drawStockCubes = __o_draw;
  resolveStockDraws = __o_resolve; croissanceMarginPercentile = __o_pct; croissanceTypeMatrix = __o_mat;
  if(typeof __o_verdict === 'function') applyAnalystVerdict = __o_verdict; if(typeof __o_tier === 'function') netIncomeExpectationTier = __o_tier;`;

async function verifierTour323(ancien, tb, rot, nSeeds, nRolls){
  const spec = spec323(tb, rot);
  const a = chargerMoteur323({ ancien }), b = chargerMoteur323({ ancien });
  await a.S.__setup(spec); a.S.__save();
  await b.S.__setup(spec); b.S.__save();
  b.run(RETIRER_ESPIONS);
  let egal = 0; const ecarts = [];
  for(let k=0;k<nSeeds;k++){
    a.S.__restore(); a.rng.seed(seedOf('tour323', k));
    a.S.__setPositions(spec.names.map((_, j) => (k*7 + j*11) % 40), Array.from({length: spec.pawns}, (_, j) => (k*5 + j*13) % 40));
    for(let t=0;t<nRolls;t++) await a.S.__tour();
    const x = JSON.stringify(a.json(PHOTO));
    b.S.__restore(); b.rng.seed(seedOf('tour323', k));
    b.S.__setPositions(spec.names.map((_, j) => (k*7 + j*11) % 40), Array.from({length: spec.pawns}, (_, j) => (k*5 + j*13) % 40));
    for(let t=0;t<nRolls;t++) await b.run(`performRollForAllCompanies({})`);
    const y = JSON.stringify(b.json(PHOTO));
    if(x === y) egal++; else ecarts.push(k);
  }
  const verdicts = ancien ? null : a.json(`state.companies.map(c=>(c.analystHistory||[]).length)`);
  return { ancien: !!ancien, tb, rot, nSeeds, nRolls, egal, ecarts, verdictsDerniereSuite: verdicts };
}

// Chiffres provisoires dans la fenêtre = chiffres figés au premier lancer ; un verdict par entreprise et par semestre
// clos ; partie de 4 semestres sans erreur.
async function verifierGel(){
  const eng = chargerMoteur323({});
  const spec = spec323('8+3', 0);
  await eng.S.__setup(spec); eng.S.__save(); eng.rng.seed(7);
  const out = { egauxAuGel: 0, total: 0, verdictsParEntreprise: null };
  for(let s=0;s<4;s++){
    const live = eng.json(`analystForecastsLive()`);
    await eng.S.__tour();
    const ok = eng.json(`state.companies.every(c=>{ const L = ${JSON.stringify(live)}[c.id]; const f = c.analystForecast; return f && L && f.semester===L.semester && f.m===L.m && f.h===L.h && f.k===L.k && f.target===L.target && f.zone===L.zone; })`);
    if(ok) out.egauxAuGel++;
    await eng.S.__tour(); await eng.S.__tour();
  }
  out.total = 4;
  out.verdictsParEntreprise = eng.json(`state.companies.map(c=>(c.analystHistory||[]).map(e=>e.semester).join(','))`);
  return out;
}

module.exports = { verifierTour323, verifierGel };
