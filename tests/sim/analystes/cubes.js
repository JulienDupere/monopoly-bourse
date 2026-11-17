// Mesure 5 : poids d'un cube. Tirages purs par le vrai drawStockCubes / resolveStockDraws (nombre de tirages par lancer
// tiré comme dans advanceGameClock), volatilité forcée à 1, sans les déclencheurs de fin de semestre. Les variantes
// d'un même tirage i partagent la même graine (hasard commun) : l'écart moyen se mesure avec peu de bruit.
const { chargerMoteur } = require('./moteur');
const { seedOf } = require('./rng');

const AIDE_CUBES = String.raw`
function __cubeTrial(base, addG, addR, typeRes, nRolls){
  const co = state.companies[0];
  co.stockReserve = {green: base.green + addG, red: base.red + addR, white: base.white};
  co.tradingReserve = {green:0, red:0};
  co.typeReserve = Object.assign({}, typeRes);
  co.whiteBonusRemaining = 0; co.distressActive = false; co.lastResortLoanUsed = false;
  co.stockPrice = 1; co.stockPriceFounding = 1e-12; co.stockPriceHistory = [];
  return __cubeRun(co, nRolls);
}
`;

const TYPES = [
  {key:'dividende', type:'dividende'}, {key:'garp', type:'garp'},
  {key:'croissance', type:'croissance'}, {key:'momentum', type:'momentum'},
];

async function moteurCubes(type){
  const eng = chargerMoteur(1);
  await eng.newGame(['A', 'B'], [type, null]);
  eng.run(`volatilityMultiplier = function(){ return 1; }`);
  eng.run(AIDE_CUBES);
  const base = eng.json(`STOCK_TYPE_RESERVE[${JSON.stringify(type)}] || STOCK_TYPE_RESERVE.garp`);
  return { eng, base };
}

// Renvoie, pour chaque variante, la variation moyenne du cours (%) après 1 et 2 semestres, son écart à la base
// (même tirage) et l'écart type de la base (le bruit de fond).
async function mesurerType(type, variantes, N){
  const { eng, base } = await moteurCubes(type);
  const W = {green:0, red:0, white:20};
  const acc = variantes.map(() => ({s1:0, s2:0, d1:0, d2:0, dd1:0, dd2:0}));
  let b1 = 0, b1q = 0, b2 = 0, b2q = 0;
  for(let i=0;i<N;i++){
    const seed = seedOf('cubes-' + type, i);
    eng.rng.seed(seed);
    const pb = eng.S.__cubeTrial(base, 0, 0, W, 6);
    const x1 = pb[2] - 1, x2 = pb[5] - 1;
    b1 += x1; b1q += x1*x1; b2 += x2; b2q += x2*x2;
    variantes.forEach((v, k) => {
      eng.rng.seed(seed);
      const pv = eng.S.__cubeTrial(base, v.g||0, v.r||0, v.typeRes || W, 6);
      const y1 = pv[2] - 1, y2 = pv[5] - 1, a = acc[k];
      a.s1 += y1; a.s2 += y2; a.d1 += y1 - x1; a.d2 += y2 - x2; a.dd1 += (y1-x1)**2; a.dd2 += (y2-x2)**2;
    });
  }
  const sd = (s, q) => Math.sqrt(Math.max(0, q/N - (s/N)**2));
  return {
    type, base, N,
    bruit1: 100*sd(b1, b1q), bruit2: 100*sd(b2, b2q), moyBase1: 100*b1/N, moyBase2: 100*b2/N,
    variantes: variantes.map((v, k) => {
      const a = acc[k];
      return { label: v.label, moy1: 100*a.s1/N, moy2: 100*a.s2/N, effet1: 100*a.d1/N, effet2: 100*a.d2/N,
        ic1: 196*sd(a.d1, a.dd1)/Math.sqrt(N), ic2: 196*sd(a.d2, a.dd2)/Math.sqrt(N) };
    }),
  };
}

module.exports = { mesurerType, TYPES };
