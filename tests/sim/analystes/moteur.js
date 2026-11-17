// Chargement du moteur d'index.html (par tests/helpers/engine.js) avec un hasard semé, et petites aides posées DANS
// le contexte du moteur. Aucune règle du jeu n'est réécrite ici : un tour appelle corePerformDiceRoll,
// corePerformNeutralPawnRoll, applySendToJailEffect et advanceGameClock dans le même ordre que
// performRollForAllCompanies (section 315, bogue 69 : enquêtes appliquées après tous les déplacements).
const path = require('path');
const { loadEngine } = require(path.join(__dirname, '..', '..', 'helpers', 'engine'));
const { makeRng } = require('./rng');

const AIDES = String.raw`
var __ctx = null;      // 'co' ou 'pawn' pendant un déplacement (qui paie le loyer)
var __track = null;    // si tableau : [entreprise, payeur, montant] de chaque loyer reçu
var __origLogFin = logFin;
logFin = function(companyId, category, amount, roll){
  if(__track && category==='rent_revenue' && amount) __track.push([companyId, __ctx, amount]);
  return __origLogFin(companyId, category, amount, roll);
};
log = function(){};   // journal neutralisé (le banc ne lit pas state.log)

// Un tour de dés pour tous, comme performRollForAllCompanies, sans l'enregistrement ni la file d'actions.
async function __tour(){
  const alreadyJailed = activeCompanies().filter(c=>c.inJail);
  const rollers = activeCompanies().filter(c=>!c.inJail);
  const jailedPawns = (state.neutralPawns||[]).filter(pw=>pw.inJail);
  const pawnRollers = (state.neutralPawns||[]).filter(pw=>!pw.inJail);
  const res = [];
  for(const co of rollers){ __ctx = 'co'; const r = await corePerformDiceRoll(co, {deferJail:true}); res.push([co, r]); }
  for(const pw of pawnRollers){ __ctx = 'pawn'; await corePerformNeutralPawnRoll(pw); }
  __ctx = null;
  res.forEach(([co, r])=>{ if(r.jailed) applySendToJailEffect(co); });
  alreadyJailed.forEach(co=>{ co.jailTurnsLeft = Math.max(0, co.jailTurnsLeft-1); if(co.jailTurnsLeft<=0) co.inJail = false; });
  jailedPawns.forEach(pw=>{ pw.jailTurnsLeft = Math.max(0, pw.jailTurnsLeft-1); if(pw.jailTurnsLeft<=0) pw.inJail = false; });
  state.lastDiceRollEvent = {roll: state.gameClock.rollCount};
  advanceGameClock();
  state.companies.forEach(c=>{ c.ready = false; });
  return res.map(([co, r])=>({id: co.id, jailed: r.jailed, passedGo: r.passedGo}));
}

// Pose une situation : partie neuve, entreprises, pions neutres, terrains, maisons, hypothèques, encaisse, cours.
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
    const co = state.companies[pr.co];
    p.owners = [{companyId: co.id, share: 100}];
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
  // Cours posé à la valeur comptable par action ; sacs remis à leur état de fondation.
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
    if(co.type==='dividende' && old>0) {
      co.dividendBenchmarkPerShare = co.dividendBenchmarkPerShare * price / old;
      co.dividendBenchmarkFounding = co.dividendBenchmarkPerShare;
    }
  });
  state.log = [];
  return state.companies.map(c=>c.id);
}

// Ce que chaque entreprise inscrit en loyer quand chaque visiteur s'arrête sur un terrain : appel du vrai
// settlePropertyRent / settleNeutralPawnRent (dés = 7 pour les services), tout le monde hors enquête, état rendu
// ensuite à l'identique. names : terrains à calculer (null = tous).
async function __rentTableFor(names){
  const snap = JSON.stringify(state);
  state.companies.forEach(c=>{ c.inJail = false; c.jailTurnsLeft = 0; });
  (state.neutralPawns||[]).forEach(p=>{ p.inJail = false; p.jailTurnsLeft = 0; });
  const out = [];
  const visitors = state.companies.map(c=>({kind:'co', id:c.id})).concat((state.neutralPawns||[]).map(p=>({kind:'pawn', id:p.id})));
  for(const p of state.properties){
    if(names && !names.includes(p.name)) continue;
    if(!p.owners || p.owners.length===0) continue;
    for(const v of visitors){
      if(v.kind==='co' && propertyOwnedShare(p, v.id)>=100) continue;
      const L = state.finLedger.length;
      if(v.kind==='co') await settlePropertyRent(p, v.id, 7, {skipSave:true});
      else await settleNeutralPawnRent(p, v.id, 7, {skipSave:true});
      const added = state.finLedger.slice(L);
      const cuts = {};
      let pay = 0, other = 0;
      added.forEach(e=>{
        if(e.category==='rent_revenue') cuts[e.companyId] = (cuts[e.companyId]||0) + e.amount;
        else if(e.category==='rent_expense' && e.companyId===v.id) pay += -e.amount;
        else other += 1;
      });
      out.push({pos: p.pos, name: p.name, svc: p.type==='service', vid: v.id, vkind: v.kind, cuts, pay, other});
    }
  }
  state = JSON.parse(snap);
  return out;
}
async function __rentTable(){ return __rentTableFor(null); }
// Clé d'un terrain pour le cache des loyers : ses propriétaires, maisons, hypothèques, et les propriétaires de son
// groupe (paliers des aéroports et services).
function __propSigs(){
  return state.properties.map(p=>JSON.stringify([p.name, p.owners, p.houses, (p.mortgages||[]).map(m=>m.companyId),
    state.properties.filter(x=>x.group===p.group).map(x=>x.owners)]));
}
function __mortgageSig(){ return JSON.stringify(state.properties.map(p=>(p.mortgages||[]).map(m=>[m.companyId, m.principal, m.rate]))); }

// Parc vivant (ronde 2) : nActeurs entreprises tirées au hasard ; chacune ajoute une maison sur chaque terrain de son
// groupe de couleur le moins bâti (au plus 5), sinon achète le terrain libre le moins cher ; elle paie (maisons au
// coût HOUSE_COST_BY_GROUP, terrain au prix de base), écritures d'investissement comme dans le moteur.
function __vivant(nActeurs){
  const cos = state.companies.slice();
  const acts = [];
  for(let a=0; a<nActeurs && cos.length; a++){
    const co = cos.splice(Math.floor(Math.random()*cos.length), 1)[0];
    const groups = {};
    state.properties.forEach(p=>{ if(p.type==='color' && propertyOwnedShare(p, co.id)>=100) (groups[p.group] = groups[p.group] || []).push(p); });
    const full = Object.keys(groups).filter(g=>groups[g].length===state.properties.filter(x=>x.group===g).length && groups[g].some(p=>p.houses<5));
    if(full.length){
      full.sort((g1, g2)=>groups[g1].reduce((s,p)=>s+p.houses,0) - groups[g2].reduce((s,p)=>s+p.houses,0));
      const g = full[0]; let cost = 0;
      groups[g].forEach(p=>{ if(p.houses<5){ p.houses += 1; cost += HOUSE_COST_BY_GROUP[g]; } });
      co.cash -= cost; state.bank.cash += cost; logFin(co.id, 'house_construction', -cost);
      acts.push([co.id, 'maison', g]);
    } else {
      const free = state.properties.filter(p=>!p.owners || p.owners.length===0).sort((x, y)=>x.basePrice-y.basePrice);
      if(free.length){
        const p = free[0]; p.owners = [{companyId: co.id, share: 100}];
        co.cash -= p.basePrice; state.bank.cash += p.basePrice; logFin(co.id, 'land_purchase', -p.basePrice);
        acts.push([co.id, 'terrain', p.name]);
      }
    }
  }
  return acts;
}

// Cours au lancer voulu (dernier point de l'historique à ce lancer ou avant) ; K3 lit la course des 6 derniers lancers.
function __priceAt(c, roll){
  const h = c.stockPriceHistory || [];
  let best = h.length ? h[0].price : c.stockPrice;
  for(const e of h){ if(e.roll <= Math.max(0, roll)) best = e.price; else break; }
  return best;
}
function __startOfSemester(){
  const s = Math.floor(state.gameClock.rollCount/3);
  return {
    s, roll: state.gameClock.rollCount,
    cos: state.companies.map(c=>{
      const ex = companyExpectedNetIncome(c, s);
      return {id:c.id, pos:c.position, inJail:!!c.inJail, jtl:c.jailTurnsLeft||0, goOwed:c.goAdvancesOwed||0,
        tax4: taxSquareCost(4, c.id), tax38: taxSquareCost(38, c.id), price:c.stockPrice, shares:c.totalShares,
        type:c.type, tier:c.croissanceTier||null, H: ex ? ex.expected : null, Hboot: !!(ex && ex.bootstrap),
        priceBack: __priceAt(c, state.gameClock.rollCount - 6)};
    }),
    pawns: (state.neutralPawns||[]).map(p=>({id:p.id, pos:p.position, inJail:!!p.inJail, jtl:p.jailTurnsLeft||0})),
  };
}

var __snap0 = null;
function __save(){ __snap0 = JSON.stringify(state); }
function __restore(){ state = JSON.parse(__snap0); }
function __ownersSignature(){ return JSON.stringify(state.properties.map(p=>[p.owners, (p.mortgages||[]).length])); }
// Parc tel qu'il est : propriétaires, maisons, hypothèques (clé du cache des tables de loyers et des charges).
function __boardSignature(){ return JSON.stringify(state.properties.map(p=>[p.owners, p.houses, (p.mortgages||[]).map(m=>[m.companyId, m.principal, m.rate])])); }
// Charges automatiques du semestre qui commence, dette inchangée : 3 lancers sans déplacement, encaisse rendue
// suffisante pour que les intérêts soient payés (sinon le moteur saisit la part au lieu de facturer l'intérêt).
function __frozenNow(){
  const snap = JSON.stringify(state);
  const s = Math.floor(state.gameClock.rollCount/3);
  const before = state.companies.map(c=>incomeStatementFor(c.id, s).netIncome);
  state.companies.forEach(c=>{ c.cash += 1e6; });
  for(let i=0;i<3;i++){ state.lastDiceRollEvent = {roll: state.gameClock.rollCount}; advanceGameClock(); }
  const out = state.companies.map((c, i)=>-(incomeStatementFor(c.id, s).netIncome - before[i])); // charge = − résultat d'un semestre immobile
  state = JSON.parse(snap);
  return out;
}
function __setPositions(cp, pp){
  state.companies.forEach((c, i)=>{ c.position = cp[i]; });
  (state.neutralPawns||[]).forEach((p, i)=>{ p.position = pp[i]; });
}
// Variante transition : +n maisons (au plus 5) sur tous les terrains de couleur de l'entreprise d'indice coIdx.
function __addHouses(coIdx, n){
  const co = state.companies[coIdx];
  state.properties.forEach(p=>{ if(p.type==='color' && propertyOwnedShare(p, co.id)>=100) p.houses = Math.min(5, (p.houses||0) + n); });
}
// Fréquence d'arrivée par case et par lancer réellement joué, par le vrai corePerformNeutralPawnRoll (aucun terrain
// possédé : aucun loyer), avec le décompte d'enquête du tour.
async function __pawnFreq(nRolls){
  const pw = state.neutralPawns[0];
  const counts = new Array(40).fill(0);
  let rolls = 0;
  while(rolls < nRolls){
    if(pw.inJail){ pw.jailTurnsLeft = Math.max(0, pw.jailTurnsLeft-1); if(pw.jailTurnsLeft<=0) pw.inJail = false; continue; }
    const r = await corePerformNeutralPawnRoll(pw);
    counts[r.jailed ? 30 : r.newPos] += 1; rolls++;
  }
  return counts;
}
// Mesure 5 : n lancers de tirages purs (drawStockCubes + resolveStockDraws, nombre de tirages par lancer comme
// advanceGameClock), sans déclencheurs de fin de semestre. Renvoie le cours après chaque lancer.
function __cubeRun(co, nRolls){
  const out = [];
  for(let i=0;i<nRolls;i++){
    const n = STOCK_DRAWS_MIN + Math.floor(Math.random()*(STOCK_DRAWS_MAX-STOCK_DRAWS_MIN+1));
    const seq = drawStockCubes(co, n);
    resolveStockDraws(co, seq);
    out.push(co.stockPrice);
  }
  return out;
}

function __endOfSemester(s){
  return state.companies.map(c=>{
    const is = incomeStatementFor(c.id, s);
    const ex = companyExpectedNetIncome(c, s);
    return {id:c.id, R:is.netIncome, rev:is.totalRevenue, exp:is.totalExpense, oldTier: netIncomeExpectationTier(is, ex),
      // Section 323 : croissanceAnalystAxis(is, verdict) prend maintenant le verdict des analystes (ligne de
      // co.analystHistory) ; l'ancienne forme (is, attente) rendait toujours null avec le nouveau moteur.
      axis: croissanceAnalystAxis(is, (c.analystHistory||[]).find(e=>e && e.semester===s) || null), cats: Object.assign({}, is.revenues, Object.fromEntries(Object.entries(is.expenses).map(([k,v])=>[k,-v]))),
      price: c.stockPrice};
  });
}
`;

function chargerMoteur(seed){
  const rng = makeRng(seed || 1);
  const SeededMath = Object.create(Math);
  SeededMath.random = () => rng.random();
  const eng = loadEngine({ globals: { Math: SeededMath } });
  eng.run(AIDES);
  eng.rng = rng;
  eng.S = eng.sandbox; // fonctions posées par AIDES : eng.S.__tour(), etc. (appel direct, sans recompiler)
  return eng;
}

module.exports = { chargerMoteur };
