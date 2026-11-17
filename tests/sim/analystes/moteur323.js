// Banc « section 323 » : charge le VRAI moteur (index.html de la copie de travail) ou l'ANCIEN moteur (HEAD, avant la
// section 323, lu par `git show HEAD:index.html` et passé par l'option `transform` de loadEngine), avec un hasard semé.
// Aucune règle du jeu n'est réécrite : un tour appelle les mêmes fonctions, dans le même ordre, que
// performRollForAllCompanies (vérifié par verifierTour323). Les seules additions sont des espions (journal des cubes
// injectés à la clôture, cases de la matrice Croissance), le parc vivant (achats et constructions du banc) et M'
// (modélisateur « avec positions » du pari du PDG).
//
// Hasard en plusieurs flux (option split) : dés (D), cubes et clôture (C, ressemé à chaque lancer et pour chaque
// entreprise), injections de cubes (I, ressemé à chaque lancer), parc vivant (P). Ainsi deux variantes d'une même
// suite (tailles des cubes, stratégie du PDG) jouent EXACTEMENT les mêmes dés et les mêmes achats, et leurs tirages de
// cubes restent appariés lancer par lancer : les écarts mesurés entre variantes ne viennent que des cubes. Sans split
// (vérification du tour), un seul générateur, comme le moteur.
const path = require('path'), fs = require('fs'), childProcess = require('child_process');
const { loadEngine } = require(path.join(__dirname, '..', '..', 'helpers', 'engine'));
const { makeRng, seedOf } = require('./rng');

const RACINE = path.join(__dirname, '..', '..', '..');

function scriptDe(html){
  html = html.replace(/\r\n/g, '\n');
  const OPEN = '\n<script>\n', CLOSE = '\n</script>';
  const a = html.lastIndexOf(OPEN), b = html.lastIndexOf(CLOSE);
  if(a < 0 || b < a) throw new Error('Script principal introuvable');
  return html.slice(a + OPEN.length, b);
}
let ancienCache = null;
function ancienScript(){
  if(ancienCache) return ancienCache;
  const html = childProcess.execFileSync('git', ['show', 'HEAD:index.html'], { cwd: RACINE, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  ancienCache = scriptDe(html);
  return ancienCache;
}
let nouveauCache = null;
function nouveauScript(){
  if(!nouveauCache) nouveauCache = scriptDe(fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8'));
  return nouveauCache;
}

const AIDES = String.raw`
var __inClock = false, __pendTier = null, __srcVerdict = false, __injLog = null, __cellLog = null, __curCo = null;
log = function(){};
render = function(){};

var __o_inject = injectStockCube;
injectStockCube = function(co, color, a, b){
  const prev = __stream('I');
  const q = __o_inject(co, color, a, b);
  __stream(prev);
  if(__injLog && __inClock && q > 0){
    let src = __srcVerdict ? 'verdict' : null;
    if(!src && __pendTier){ src = 'verdict'; __pendTier = null; }
    let line = 0;
    if(!src){ const fr = (new Error().stack || '').split('\n')[2] || ''; const m = fr.match(/:(\d+):\d+\)?\s*$/); line = m ? +m[1] : 0; }
    __injLog.push([co.id, color, q, src || line]);
  }
  return q;
};
var __o_injectT = injectTradingCube;
injectTradingCube = function(co, color, a, b){ const prev = __stream('I'); const q = __o_injectT(co, color, a, b); __stream(prev); return q; };
var __o_clock = advanceGameClock;
advanceGameClock = function(){
  __inClock = true;
  __reseed('C', 'clock|' + state.gameClock.rollCount); __reseed('I', 'inj|' + state.gameClock.rollCount);
  const prev = __stream('C');
  try { return __o_clock.apply(this, arguments); }
  finally { __inClock = false; __pendTier = null; __stream(prev); }
};
var __o_draw = drawStockCubes;
drawStockCubes = function(co, n){ __reseed('C', 'd|' + state.gameClock.rollCount + '|' + co.id); return __o_draw(co, n); };
var __o_resolve = resolveStockDraws;
resolveStockDraws = function(co, seq){ __reseed('C', 'r|' + state.gameClock.rollCount + '|' + co.id); return __o_resolve(co, seq); };
if(typeof applyAnalystVerdict === 'function'){
  var __o_verdict = applyAnalystVerdict;
  applyAnalystVerdict = function(co, s){ __srcVerdict = true; try { return __o_verdict(co, s); } finally { __srcVerdict = false; } };
}
if(typeof netIncomeExpectationTier === 'function'){
  var __o_tier = netIncomeExpectationTier;
  netIncomeExpectationTier = function(is, ex){ const t = __o_tier(is, ex); if(__inClock && t && t !== 'flat') __pendTier = t; return t; };
}
var __o_pct = croissanceMarginPercentile;
croissanceMarginPercentile = function(coId, m){ __curCo = coId; return __o_pct(coId, m); };
var __o_mat = croissanceTypeMatrix;
croissanceTypeMatrix = function(mg, an){ if(__cellLog && __inClock) __cellLog.push([__curCo, mg, an]); return __o_mat(mg, an); };

// Un tour de dés pour tous, comme performRollForAllCompanies (sans la file d'actions ni l'enregistrement).
async function __tour(){
  const alreadyJailed = activeCompanies().filter(c=>c.inJail);
  const rollers = activeCompanies().filter(c=>!c.inJail);
  const jailedPawns = (state.neutralPawns||[]).filter(pw=>pw.inJail);
  const pawnRollers = (state.neutralPawns||[]).filter(pw=>!pw.inJail);
  // Ronde de corrections (C2) : le gel a lieu APRÈS les enchères résolues à ce lancer (même ordre que le vrai lancer).
  const snap = snapshotPlayerBondsAndLoans();
  maybeResolveTerrainLotAuction(); maybeResolveEtfAuctions(); maybeResolveRevenueSwapListings();
  if(typeof freezeAnalystForecasts === 'function') freezeAnalystForecasts();
  const res = [];
  const prev = __stream('D');
  for(const co of rollers){ const r = await corePerformDiceRoll(co, {deferJail:true}); res.push([co, r]); }
  for(const pw of pawnRollers){ await corePerformNeutralPawnRoll(pw); }
  __stream(prev);
  res.forEach(([co, r])=>{ if(r.jailed) applySendToJailEffect(co); });
  alreadyJailed.forEach(co=>{ co.jailTurnsLeft = Math.max(0, co.jailTurnsLeft-1); if(co.jailTurnsLeft<=0) co.inJail = false; });
  jailedPawns.forEach(pw=>{ pw.jailTurnsLeft = Math.max(0, pw.jailTurnsLeft-1); if(pw.jailTurnsLeft<=0) pw.inJail = false; });
  state.lastDiceRollEvent = {roll: state.gameClock.rollCount};
  advanceGameClock();
  state.lastDiceRollEvent.portfolioDeltas = computePlayerPortfolioDeltas(snap);
  state.companies.forEach(c=>{ c.ready = false; });
}

// Pose une situation (comme moteur.js : partie neuve, entreprises, pions neutres, terrains, maisons, hypothèques,
// encaisse, cours à la valeur comptable par action, sacs à leur état de fondation).
async function __setup(spec){
  const pawnNames = [];
  for(let i=0;i<spec.pawns;i++) pawnNames.push('Neutre ' + (i+1));
  await createGame(spec.names, 50, 1000, 'M$', {}, pawnNames);
  const ids = state.players.map(p=>p.id);
  for(let i=0;i<spec.types.length;i++){
    const t = spec.types[i];
    await createCompany(ids[i], 'Co ' + spec.names[i], '', t.type, null, t.tier||null, null);
  }
  state.companies.forEach(c=>applyCompanyIpoFunding(c));
  for(const pr of spec.props){
    const p = state.properties.find(x=>x.name===pr.name);
    if(!p) throw new Error('Terrain introuvable : ' + pr.name);
    p.owners = [{companyId: state.companies[pr.co].id, share: 100}];
    p.houses = pr.houses||0;
  }
  for(const pr of spec.props){
    if(!pr.mortgage) continue;
    const p = state.properties.find(x=>x.name===pr.name);
    const r = await issueMortgage(p.id, state.companies[pr.co].id, 'BANK', {silent:true});
    if(!r || !r.ok) throw new Error('Hypothèque refusée : ' + pr.name + ' ' + (r && r.error));
  }
  state.companies.forEach((co, i)=>{
    co.cash = spec.cash[i];
    co.goAdvancesOwed = spec.goAdv[i]||0;
    if(co.type==='dividende') co.dividendAutoPay = true;
  });
  state.companies.forEach(co=>{
    co.stockReserve = Object.assign({}, STOCK_TYPE_RESERVE[co.type] || STOCK_TYPE_RESERVE.garp);
    co.tradingReserve = {green:0, red:0};
    co.typeReserve = {green:0, red:0, white:20};
    const bs = balanceSheetFor(co.id, 0);
    const price = Math.max(1e-9, bs.equity / co.totalShares);
    const old = co.stockPrice;
    co.stockPrice = price; co.stockPriceFounding = price;
    co.stockPriceHistory = [{roll: 0, price}];
    if(co.type==='momentum') co.momentumRefPrice = price;
    if(co.type==='dividende' && old>0){
      co.dividendBenchmarkPerShare = co.dividendBenchmarkPerShare * price / old;
      co.dividendBenchmarkFounding = co.dividendBenchmarkPerShare;
    }
  });
  state.log = [];
  return state.companies.map(c=>c.id);
}
var __snap0 = null;
function __save(){ __snap0 = JSON.stringify(state); }
function __restore(){ state = JSON.parse(__snap0); }
function __setPositions(cp, pp){
  state.companies.forEach((c, i)=>{ c.position = cp[i]; });
  (state.neutralPawns||[]).forEach((p, i)=>{ p.position = pp[i]; });
}
function __mortgageSig(){ return JSON.stringify(state.properties.map(p=>(p.mortgages||[]).map(m=>[m.companyId, m.principal]))); }

// Parc vivant : nAct entreprises tirées au hasard (flux P), chacune agit une fois dans la fenêtre du début de semestre,
// avec son encaisse (reste au moins 'reserve' après l'achat), dans ce que le jeu permet :
//  - maisons seulement dans la fenêtre de fin d'année (yearEndWindowOpen), au plus hotelLevel(), une maison de plus sur
//    chaque terrain du groupe de couleur complet le moins bâti, au coût HOUSE_COST_BY_GROUP (écritures du moteur) ;
//  - sinon achat d'un terrain libre à la banque, au prix max(prix de base, bankMinSalePrice100) : d'abord un terrain
//    d'un groupe où elle possède déjà un terrain, sinon le moins cher.
// Écart connu au vrai jeu : la construction réelle exige un lot regroupé (groupMergeId) ; le banc construit sur le
// groupe complet sans regroupement, comme le prototype.
function __vivant(nAct, reserve){
  const prev = __stream('P');
  const cos = activeCompanies().slice();
  const acts = [];
  const yearEnd = yearEndWindowOpen();
  for(let a=0; a<nAct && cos.length; a++){
    const co = cos.splice(Math.floor(Math.random()*cos.length), 1)[0];
    let done = false;
    if(yearEnd){
      const groups = {};
      state.properties.forEach(p=>{ if(p.type==='color' && propertyOwnedShare(p, co.id)>=100) (groups[p.group] = groups[p.group] || []).push(p); });
      const full = Object.keys(groups).filter(g=>groups[g].length===state.properties.filter(x=>x.group===g).length && groups[g].some(p=>p.houses<hotelLevel()));
      full.sort((g1, g2)=>groups[g1].reduce((s,p)=>s+p.houses,0) - groups[g2].reduce((s,p)=>s+p.houses,0));
      for(const g of full){
        const todo = groups[g].filter(p=>p.houses<hotelLevel());
        const cost = todo.length * (HOUSE_COST_BY_GROUP[g]||0);
        if(co.cash - cost < reserve) continue;
        todo.forEach(p=>{
          const c1 = HOUSE_COST_BY_GROUP[g]||0;
          p.houses += 1; co.cash -= c1; state.bank.cash += c1;
          logFin(co.id, 'house_construction', -c1); addRealEstateCapex(realEstateKeyFor(p), co.id, c1);
        });
        acts.push([co.id, 'maison', g]); done = true; break;
      }
    }
    if(!done){
      const mine = new Set(state.properties.filter(p=>propertyOwnedShare(p, co.id)>0).map(p=>p.group));
      const free = state.properties.filter(p=>(!p.owners || p.owners.length===0) && !p.groupMergeId)
        .map(p=>({p, price: Math.max(p.basePrice||0, bankMinSalePrice100(p))}))
        .sort((x, y)=>((mine.has(y.p.group)?1:0) - (mine.has(x.p.group)?1:0)) || (x.price - y.price));
      for(const f of free){
        if(co.cash - f.price < reserve) continue;
        f.p.owners = [{companyId: co.id, share: 100}];
        co.cash -= f.price; state.bank.cash += f.price;
        logFin(co.id, 'land_purchase', -f.price); addRealEstateCapex(realEstateKeyFor(f.p), co.id, f.price);
        acts.push([co.id, 'terrain', f.p.name]); break;
      }
    }
  }
  __stream(prev);
  return acts;
}

// M' (modèle « avec positions » du pari du PDG) : le VRAI modélisateur du moteur (analystModelAll, ronde de
// corrections C4 : calcul par tour, enquêtes ouvertes pendant le semestre, propriétaires libres avec la probabilité
// free(t)), appelé en remplaçant seulement analystPawnSchedule par des tables par tour calculées depuis la POSITION
// RÉELLE de chaque pion (mêmes règles qu'analystTurnTables : arrivée sur 30 → case 10, enquête après les déplacements
// du tour, max(1, jailTurns) tours sautés puis retour en 10). Toutes les autres règles sont celles du moteur.
function __tablesDepuis(pos0){
  const n = ANALYST_ROLLS_PER_SEMESTER;
  const skip = Math.max(1, (state.settings && state.settings.jailTurns)||0);
  let dist = new Array(40).fill(0); dist[(((pos0|0)%40)+40)%40] = 1;
  const reentry = {}, arrive = [], free = [];
  for(let t=0;t<n;t++){
    if(reentry[t]) dist[10] += reentry[t];
    free.push(dist.reduce((s,x)=>s+x, 0));
    const arr = new Array(40).fill(0), nx = new Array(40).fill(0);
    for(let k=0;k<40;k++){
      const m = dist[k]; if(!m) continue;
      for(let r=2;r<=12;r++){
        const d = (k+r)%40, w = m*DICE_PROB_36[r]/36;
        arr[d] += w;
        if(SPECIAL_SQUARES[d] && SPECIAL_SQUARES[d].kind==='gotojail') reentry[t+1+skip] = (reentry[t+1+skip]||0) + w;
        else nx[d] += w;
      }
    }
    arrive.push(arr); dist = nx;
  }
  return {arrive, free};
}
function __modelPositions(){
  const orig = analystPawnSchedule;
  analystPawnSchedule = function(x){
    const j = analystJailSkip(x);
    const T = __tablesDepuis(j > 0 ? 10 : (x.position||0));
    return { j, arrive: t => t<j ? null : T.arrive[t-j], free: t => t<j ? 0 : T.free[t-j] };
  };
  try {
    const all = analystModelAll();
    const out = {}; Object.keys(all).forEach(id => { out[id] = all[id].expected; });
    return out;
  } finally { analystPawnSchedule = orig; }
}
`;

// Charge un moteur. opts : { ancien (moteur d'avant la section 323), split (flux de hasard séparés), seed }.
function chargerMoteur323(opts = {}){
  const main = makeRng(opts.seed || 1);
  const flux = { M: main, D: makeRng(1), C: makeRng(2), I: makeRng(3), P: makeRng(4) };
  let cur = 'M', base = 'x';
  const split = !!opts.split;
  const SeededMath = Object.create(Math);
  SeededMath.random = () => flux[split ? cur : 'M'].random();
  const globals = {
    Math: SeededMath,
    __stream: (k) => { const p = cur; cur = k; return p; },
    __reseed: (k, label) => { if(split) flux[k].seed(seedOf(base + '|' + k + '|' + label, 0)); },
  };
  const lo = { globals };
  if(opts.ancien){ const src = ancienScript(); lo.transform = () => src; }
  const eng = loadEngine(lo);
  eng.run(AIDES);
  eng.S = eng.sandbox;
  eng.rng = main;
  eng.flux = flux;
  eng.ancien = !!opts.ancien;
  eng.source = opts.ancien ? ancienScript() : nouveauScript();
  // Début d'une suite : graine de base (flux C et I ressemés à chaque lancer à partir d'elle), flux D et P semés.
  eng.debutSuite = (label) => {
    base = label; cur = 'M';
    main.seed(seedOf(label + '|M', 0));
    flux.D.seed(seedOf(label + '|D', 0)); flux.P.seed(seedOf(label + '|P', 0));
    flux.C.seed(seedOf(label + '|C0', 0)); flux.I.seed(seedOf(label + '|I0', 0));
  };
  eng.tirageP = () => (split ? flux.P : main).random();
  return eng;
}

module.exports = { chargerMoteur323, ancienScript, nouveauScript };
