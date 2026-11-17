// Suites longues (12 semestres et plus) sur le vrai moteur, parc vivant, pour la mesure de la section 323.
// Situation de départ : la phase « milieu » du prototype (situations.js), tables 8 + 3 et 4 + 2, types tournés.
const { seedOf } = require('./rng');
const { stationnaire } = require('./plateau');
const { PHASES, profilDe } = require('./situations');

const CYCLE = ['garp', 'dividende', 'croissance', 'momentum'];
const NROT = 4;
function typesFor(n, rot){
  const out = [];
  for(let i=0;i<n;i++){
    const type = CYCLE[(i + rot) % 4];
    out.push(type === 'croissance' ? {type, tier: rot % 2 ? 'tres_eleve' : 'eleve'} : {type});
  }
  return out;
}
// acteurs : entreprises du parc vivant par semestre (2 sur 8, 1 sur 4).
const TABLES323 = { '8+3': { n: 8, pawns: 3, acteurs: 2 }, '4+2': { n: 4, pawns: 2, acteurs: 1 } };
const RESERVE = 1; // encaisse gardée après un achat du parc vivant (M$)

function spec323(tb, rot){
  const T = TABLES323[tb], P = PHASES.milieu;
  const names = []; for(let i=0;i<T.n;i++) names.push('J' + (i+1));
  const props = [];
  const add = (list, co) => list.forEach(p => props.push(Object.assign({co}, p)));
  add(P.conc, 0); add(P.div, 1); add(P.debt, 2);
  for(let i=3;i<T.n;i++) add(P.ords[i-3], i);
  const cash = names.map((_, i) => i===2 ? P.cash.debt : P.cash.normal);
  const goAdv = names.map((_, i) => i===2 ? P.goAdvDebt : 0);
  return { names, types: typesFor(T.n, rot), pawns: T.pawns, props, cash, goAdv };
}

// Tailles du verdict (normal, fort) et pari du PDG simulé, par remplacement de analystVerdictCubes (le seul endroit où
// les tailles sont lues). Avertissement : sous la zone adouci d'un cran (fort → normal → rien). Promesse : sous la zone
// aggravé d'un cran (normal → fort, fort → fort + (fort − normal)). Au-dessus de la zone : inchangé.
// aggr (facultatif) : cubes ajoutés à un fort sous la zone quand la promesse n'est pas tenue (défaut : fort − normal,
// « un cran ») ; un normal sous la zone devient toujours un fort.
function installerTailles(eng, n, f, aggr){
  if(aggr === undefined || aggr === null) aggr = f - n;
  eng.run(`var __N = ${n}, __F = ${f}, __AG = ${aggr};
  analystVerdictCubes = function(v, co){
    let col = null, q = 0;
    if(v==='normalUp'){ col='green'; q=__N; } else if(v==='strongUp'){ col='green'; q=__F; }
    else if(v==='normalDown'){ col='red'; q=__N; } else if(v==='strongDown'){ col='red'; q=__F; }
    if(co && co.__pari && col==='red'){
      if(co.__pari==='avertir') q = v==='strongDown' ? __N : 0;
      else if(co.__pari==='promettre') q = v==='normalDown' ? __F : __F + __AG;
    }
    return q>0 ? {color: col, qty: q} : {color: null, qty: 0};
  };`);
}
// 2e mesure (moteur corrigé, forme { color, qtyMin, qtyMax } et gap = bénéfice jugé − cible). o = { n, f, zmax } :
// hors zone n (normal) ou f (fort) cubes fixes ; dans la zone 0 à zmax cube(s) du côté de l'écart (moteur : 2, 5, 1).
// Pari du PDG (co.__pari = { t: 'avertir'|'promettre', x, monte }) :
//  - avertissement : fort sous la zone → normal ; normal sous la zone → traité comme dans la zone (0 ou 1 rouge) ;
//  - promesse : sous la zone (normal ou fort), x rouges de plus ; si monte, au-dessus de la zone un cran de plus
//    (normal → fort, fort → fort + 3).
function installerVerdict(eng, o){
  eng.run(`var __VN = ${o.n}, __VF = ${o.f}, __ZM = ${o.zmax};
  analystVerdictCubes = function(v, co, gap){
    const P = co && co.__pari;
    const zone = (col) => col ? {color: col, qtyMin: 0, qtyMax: __ZM} : {color: null, qtyMin: 0, qtyMax: 0};
    const side = gap > 0 ? 'green' : gap < 0 ? 'red' : null;
    let col = null, q = 0;
    if(v === 'zone') return zone(side);
    if(v === 'normalUp'){ col = 'green'; q = (P && P.t === 'promettre' && P.monte) ? __VF : __VN; }
    else if(v === 'strongUp'){ col = 'green'; q = (P && P.t === 'promettre' && P.monte) ? __VF + 3 : __VF; }
    else if(v === 'normalDown'){
      if(P && P.t === 'avertir') return zone('red');
      col = 'red'; q = __VN + ((P && P.t === 'promettre') ? P.x : 0);
    } else if(v === 'strongDown'){
      col = 'red'; q = (P && P.t === 'avertir') ? __VN : __VF + ((P && P.t === 'promettre') ? P.x : 0);
    } else return {color: null, qtyMin: 0, qtyMax: 0};
    return q > 0 ? {color: col, qtyMin: q, qtyMax: q} : {color: null, qtyMin: 0, qtyMax: 0};
  };`);
}
// Largeur de la zone : cible ± max(plancher ; k × σ), par remplacement d'analystTargetAndZone (les constantes sont des const).
function installerZone(eng, k, plancher){
  eng.run(`analystTargetAndZone = function(h, m, kk, sigma){
    const vals = [h, m, kk].filter(x=>typeof x==='number' && isFinite(x)).sort((a,b)=>a-b);
    const target = vals.length===3 ? vals[1] : vals.length===2 ? (vals[0]+vals[1])/2 : vals.length===1 ? vals[0] : 0;
    return {target, zone: Math.max(${plancher}, ${k} * (sigma||0))};
  };`);
}
function installerDeuxAnalystes(eng){ eng.run(`analystMarketCap = function(){ return 0; }`); }

const ST = stationnaire();
function tirePos(u){ let acc = 0; for(let k=0;k<40;k++){ acc += ST.pos[k]; if(u < acc) return k; } return 39; }

// Prépare la situation une fois par moteur et par (table, rotation) ; renvoie une fonction qui joue la suite i.
async function preparer(eng, tb, rot){
  const spec = spec323(tb, rot);
  await eng.S.__setup(spec);
  eng.S.__save();
  const meta = eng.json(`state.companies.map(c=>({id:c.id, type:c.type, tier:c.croissanceTier||null, shares:c.totalShares}))`);
  return { spec, meta, tb, rot };
}

// pdg : null ou { strat: 'jamais'|'avertir'|'promettre'|'informe', cw, cp, theta, trading: null|{green, red} }.
async function jouerSuite(eng, prep, i, opts){
  const { spec, meta, tb, rot } = prep;
  const nSem = opts.nSem || 12;
  eng.S.__restore();
  eng.debutSuite(`${opts.seedTag || 's323'}|${tb}|${rot}|${i}`);
  const cp = spec.names.map(() => tirePos(eng.tirageP()));
  const pp = []; for(let k=0;k<spec.pawns;k++) pp.push(tirePos(eng.tirageP()));
  eng.S.__setPositions(cp, pp);
  eng.S.__injLog = opts.injections ? [] : null;
  eng.S.__cellLog = opts.cellules ? [] : null;
  const mort0 = eng.S.__mortgageSig();
  const nCos = meta.length;
  const cos = meta.map((m, idx) => ({ idx, id: m.id, pf: profilDe(idx), type: m.type, tier: m.tier, shares: m.shares,
    p0: null, prix: [], ni: [], ancien: [], pari: [], ecartMp: [] }));
  let saisie = -1, fin = -1, acts = 0;
  const pdg = opts.pdg || null;
  for(let s=0; s<nSem; s++){
    if(s >= 1) acts += eng.S.__vivant(TABLES323[tb].acteurs, RESERVE).length;
    if(pdg){
      const res = eng.json(`(function(){
        const pdg = ${JSON.stringify(pdg)};
        const live = analystForecastsLive();
        const inf = pdg.strat.startsWith('informe');
        const mp = inf ? __modelPositions() : null;
        return activeCompanies().map(co=>{
          if(pdg.trading){ co.tradingReserve.green = Math.max(co.tradingReserve.green, pdg.trading.green); co.tradingReserve.red = Math.max(co.tradingReserve.red, pdg.trading.red); }
          let call = null, d = null;
          const L = live[co.id];
          if(pdg.strat === 'avertir') call = 'avertir';
          else if(pdg.strat === 'promettre') call = 'promettre';
          else if(inf && L){ d = mp[co.id] - L.m;
            if(d < -pdg.theta*L.zone && pdg.strat !== 'informeP') call = 'avertir';
            else if(d > pdg.theta*L.zone && pdg.strat !== 'informeA') call = 'promettre'; }
          co.__pari = call ? {t: call, x: pdg.x||0, monte: !!pdg.monte} : null;
          // Cube de l'annonce : sac fondamental (dest 'fond') ou sac trading (vide ou chargé).
          const inj = pdg.dest === 'fond' ? injectStockCube : injectTradingCube;
          if(call === 'avertir' && pdg.cw > 0) inj(co, 'red', pdg.cw, pdg.cw);
          if(call === 'promettre' && pdg.cp > 0) inj(co, 'green', pdg.cp, pdg.cp);
          return [co.id, call, d, L ? L.zone : null];
        });
      })()`);
      const by = {}; res.forEach(r => { by[r[0]] = r; });
      cos.forEach(c => { const r = by[c.id]; c.pari.push(r ? r[1] : null); c.ecartMp.push(r ? r[2] : null); });
    }
    if(s === 0){ const p = eng.json(`state.companies.map(c=>c.stockPrice)`); cos.forEach((c, k) => { c.p0 = p[k]; }); }
    for(let t=0;t<3;t++) await eng.S.__tour();
    const end = eng.json(`(function(){ const s = ${s}; return {
      prix: state.companies.map(c=>c.stockPrice),
      ni: state.companies.map(c=>incomeStatementFor(c.id, s).netIncome),
      ancien: ${eng.ancien ? `state.companies.map(c=>netIncomeExpectationTier(incomeStatementFor(c.id, s), companyExpectedNetIncome(c, s)))` : 'null'},
      actives: activeCompanies().length, finie: !!state.gameEndedReason }; })()`);
    cos.forEach((c, k) => { c.prix.push(end.prix[k]); c.ni.push(end.ni[k]); if(end.ancien) c.ancien.push(end.ancien[k]); });
    if(saisie < 0 && eng.S.__mortgageSig() !== mort0) saisie = s;
    if(end.finie || end.actives < nCos){ fin = s; break; }
  }
  const hist = eng.ancien ? null : eng.json(`state.companies.map(c=>(c.analystHistory||[]).map(e=>({s:e.semester, h:e.h, m:e.m, k:e.k, t:e.target, z:e.zone, r:e.actual, j:(typeof e.judged==='number' ? e.judged : e.actual), v:e.verdict, b:e.beaten, of:e.of, col:e.color, q:e.qty})))`);
  if(hist) cos.forEach((c, k) => { c.hist = hist[k]; });
  const raison = fin >= 0 ? eng.json(`state.gameEndedReason ? state.gameEndedReason.reason : ('actives ' + activeCompanies().length)`) : null;
  return { tb, rot, i, saisie, fin, raison, acts, cos, inj: eng.S.__injLog, cells: eng.S.__cellLog };
}

module.exports = { TABLES323, NROT, spec323, preparer, jouerSuite, installerTailles, installerVerdict, installerZone, installerDeuxAnalystes, typesFor };
