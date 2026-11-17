// Ronde 2, mesures 8 à 10 : tendances installées par des cubes au fondamental, sur plusieurs semestres. Tirages purs par
// le vrai drawStockCubes / resolveStockDraws (volatilité forcée à 1, sans les déclencheurs de fin de semestre), cubes
// ajoutés au fondamental au début des semestres voulus. Les variantes d'un même tirage i partagent la même graine.
const { chargerMoteur } = require('./moteur');
const { makeRng, seedOf } = require('./rng');

const AIDE = String.raw`
function __trend(base, plan, nSem){
  const co = state.companies[0];
  co.stockReserve = {green: base.green, red: base.red, white: base.white};
  co.tradingReserve = {green:0, red:0};
  co.typeReserve = {green:0, red:0, white:20};
  co.whiteBonusRemaining = 0; co.distressActive = false; co.lastResortLoanUsed = false;
  co.stockPrice = 1; co.stockPriceFounding = 1e-12; co.stockPriceHistory = [];
  const out = [];
  for(let s=0;s<nSem;s++){
    const inj = plan[s];
    if(inj){ co.stockReserve.green += inj.g||0; co.stockReserve.red += inj.r||0; }
    __cubeRun(co, 3);
    out.push(co.stockPrice);
  }
  return out;
}
`;

async function moteurType(type){
  const eng = chargerMoteur(1);
  await eng.newGame(['A', 'B'], [type, null]);
  eng.run(`volatilityMultiplier = function(){ return 1; }`);
  eng.run(AIDE);
  const base = eng.json(`STOCK_TYPE_RESERVE[${JSON.stringify(type)}] || STOCK_TYPE_RESERVE.garp`);
  return { eng, base };
}

const med = a => { const b = Float64Array.from(a).sort(); const n = b.length; return n % 2 ? b[(n-1)/2] : (b[n/2-1] + b[n/2]) / 2; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x-m)*(x-m)))); };

// Mesure 8. configs : [{label, plan: [{g, r} par semestre]}]. Pour chaque config et chaque semestre de HORIZONS :
// médiane du cours (% de variation), écart à la médiane de base (« net »), effet moyen au même tirage, bruit.
const HORIZONS = [1, 2, 3, 4, 6];
async function mesure8(type, configs, N, nSem){
  const { eng, base } = await moteurType(type);
  const P0 = [], PV = configs.map(() => []);
  for(let i=0;i<N;i++){
    const seed = seedOf('tendance-' + type, i);
    eng.rng.seed(seed); P0.push(eng.S.__trend(base, [], nSem));
    configs.forEach((c, k) => { eng.rng.seed(seed); PV[k].push(eng.S.__trend(base, c.plan, nSem)); });
  }
  const at = (arr, h) => arr.map(p => p[h-1] - 1);
  const res = { type, base, N, bruit: {}, medianeBase: {}, configs: [] };
  HORIZONS.forEach(h => { const b = at(P0, h); res.bruit[h] = 100*sd(b); res.medianeBase[h] = 100*med(b); });
  configs.forEach((c, k) => {
    const o = { label: c.label, mediane: {}, netMediane: {}, effetMoyen: {}, icEffet: {} };
    HORIZONS.forEach(h => {
      const v = at(PV[k], h), b = at(P0, h), d = v.map((x, i) => x - b[i]);
      o.mediane[h] = 100*med(v); o.netMediane[h] = 100*(med(v) - med(b));
      o.effetMoyen[h] = 100*mean(d); o.icEffet[h] = 196*sd(d)/Math.sqrt(N);
    });
    res.configs.push(o);
  });
  return res;
}

// Mesure 9 : verdict tiré à chaque semestre selon des fréquences (classe → probabilité), cubes ajoutés au début du
// semestre suivant. tailles : classe → [couleur, min, max] (nombre tiré uniformément entre min et max, comme
// injectStockCube). Renvoie la variation (%) après nSem semestres : moyenne, médiane, écart type, et l'écart moyen au
// même tirage sans verdict.
async function mesure9(type, scenarios, N, nSem){
  const { eng, base } = await moteurType(type);
  const out = [];
  const b0 = [];
  for(let i=0;i<N;i++){ eng.rng.seed(seedOf('derive-' + type, i)); b0.push(eng.S.__trend(base, [], nSem)[nSem-1] - 1); }
  for(const sc of scenarios){
    const v = [];
    for(let i=0;i<N;i++){
      const vr = makeRng(seedOf('verdicts-' + sc.label, i));
      const plan = [];  // un verdict par semestre, ses cubes agissent dès ce semestre
      for(let s=0;s<nSem;s++){
        let u = vr.random(), cls = null;
        for(const k in sc.freq){ u -= sc.freq[k]; if(u < 0){ cls = k; break; } }
        const t = cls && sc.tailles[cls];
        if(!t){ plan.push(null); continue; }
        const q = t[1] + Math.floor(vr.random() * (t[2] - t[1] + 1));
        plan.push(t[0] === 'g' ? {g:q} : {r:q});
      }
      eng.rng.seed(seedOf('derive-' + type, i));
      v.push(eng.S.__trend(base, plan, nSem)[nSem-1] - 1);
    }
    const d = v.map((x, i) => x - b0[i]);
    out.push({ label: sc.label, moyenne: 100*mean(v), mediane: 100*med(v), ecartType: 100*sd(v), effetMoyen: 100*mean(d),
      icEffet: 196*sd(d)/Math.sqrt(N), parSemestre: 100*(Math.pow(1 + med(v), 1/nSem) - Math.pow(1 + med(b0), 1/nSem)) });
  }
  return { type, N, nSem, base: { moyenne: 100*mean(b0), mediane: 100*med(b0), ecartType: 100*sd(b0) }, scenarios: out };
}

module.exports = { mesure8, mesure9, HORIZONS };
