// Banc de mesure de la section 323 sur le VRAI code (index.html de la copie de travail) et sur l'ancien (HEAD).
// Point d'entrée : node tests/sim/analystes/mesures323.js [partie]
//   parties : verif, c1, c2, g1, g2, g3, g4, analyse ; sans argument : toutes, dans l'ordre (≈ 40 min).
// Variables : N_C (suites par table et par rotation des types pour les tailles, 250), N_G (pari du PDG, 100),
//   DOSSIER_323 (résultats bruts intermédiaires ; par défaut <tmp>/banc323).
// Sorties : resultats-323.json et resultats-323.txt ici (partie « analyse »).
const fs = require('fs'), path = require('path'), os = require('os');
const { chargerMoteur323 } = require('./moteur323');
const S = require('./suites323');
const { verifierTour323, verifierGel } = require('./verif323');

const N_C = +process.env.N_C || 250;
const N_G = +process.env.N_G || 100;
const DOSSIER = process.env.DOSSIER_323 || path.join(os.tmpdir(), 'banc323');
fs.mkdirSync(DOSSIER, { recursive: true });

const TAILLES = [[0, 0], [2, 4], [3, 5], [3, 6], [4, 7]];
const VARIANTES_C = [
  ...TAILLES.map(([n, f]) => ({ cle: `n${n}${f}`, tailles: [n, f], detail: n === 3 && f === 5, injections: true, cellules: true, N: N_C })),
  { cle: 'ancien', ancien: true, injections: true, cellules: true, N: N_C },
  { cle: 'deuxA', tailles: [3, 5], deuxA: true, detail: true, N: N_C },
];
const STRATS = [
  { s: 'jamais' }, { s: 'avertir', cw: 1 }, { s: 'avertir', cw: 2 }, { s: 'promettre', cp: 1 }, { s: 'promettre', cp: 2 }, { s: 'promettre', cp: 3 },
  ...[[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]].map(([cw, cp]) => ({ s: 'informe', cw, cp, theta: 1 })),
  ...[[1, 1], [1, 2], [2, 2]].map(([cw, cp]) => ({ s: 'informe', cw, cp, theta: 0.5 })),
];
const SACS = { vide: null, charge: { green: 10, red: 6 } };
const cleStrat = (st, sac) => `g_${sac}_${st.s}${st.cw ? '_w' + st.cw : ''}${st.cp ? '_p' + st.cp : ''}${st.theta ? '_t' + st.theta : ''}`;
const VARIANTES_G = [];
for(const sac of Object.keys(SACS)) for(const st of STRATS)
  VARIANTES_G.push({ cle: cleStrat(st, sac), tailles: [3, 5], pdg: { strat: st.s, cw: st.cw || 0, cp: st.cp || 0, theta: st.theta || 1, trading: SACS[sac] }, N: N_G });

// Pari, 2e passe (après lecture de G) : tailles (2,5), avertissement 1 rouge, promesse 1 vert, promesse non tenue
// aggravée de A cubes (fort → 5 + A ; normal → fort), A = 3 (un cran) et 5 ; sac trading vide.
const STRATS2 = [{ s: 'jamais' }, { s: 'avertir', cw: 1 }, ...[3, 5].flatMap(a => [{ s: 'promettre', cp: 1, a }, { s: 'informe', cw: 1, cp: 1, theta: 0.5, a }, { s: 'informe', cw: 1, cp: 1, theta: 1, a }])];
const cleStrat2 = st => `g2_${st.s}${st.cw ? '_w' + st.cw : ''}${st.cp ? '_p' + st.cp : ''}${st.theta ? '_t' + st.theta : ''}${st.a ? '_a' + st.a : ''}`;
const VARIANTES_G2 = STRATS2.map(st => ({ cle: cleStrat2(st), tailles: [2, 5], aggr: st.a || 3, pdg: { strat: st.s, cw: st.cw || 0, cp: st.cp || 0, theta: st.theta || 1, trading: null }, N: N_G }));

const CODE_V ={ zone: 'z', normalUp: 'u', strongUp: 'U', normalDown: 'd', strongDown: 'D' };
const CODE_T = { beat: 'b', sigBeat: 'B', miss: 'm', sigMiss: 'M', reallyMiss: 'R', flat: 'f' };
const CODE_P = { avertir: 'a', promettre: 'p' };
const r6 = x => (x === null || x === undefined || !isFinite(x)) ? null : +x.toPrecision(6);
const r4 = x => (x === null || x === undefined || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4;

// Étiquette d'une ligne du moteur qui injecte des cubes à la clôture (lue dans le source chargé).
function etiquette(src, line){
  if(line === 'verdict') return 'verdict des analystes (ou ancien palier)';
  const L = (src[line - 1] || '').trim();
  if(/STOCK_TRIGGER_PROFIT/.test(L)) return 'semestre rentable / déficitaire (3-5)';
  if(/'green', 5, 9|'red', 5, 8/.test(L)) return 'grosse marge Croissance (5-9 / 5-8)';
  if(/INTEREST_COVERAGE/.test(L)) return 'couverture des intérêts';
  if(/DISTRESS/.test(L)) return 'détresse (dette)';
  if(/NEGATIVE_CASH/.test(L)) return 'encaisse négative';
  if(/STOCK_TRIGGER_LEVEL/.test(L)) return 'cours contre valeur comptable (1-2)';
  if(/added, added/.test(L)) return 'dividende annoncé (section 320)';
  return 'autre : ' + L.slice(0, 60);
}

async function lancerVariante(v){
  const t0 = Date.now();
  const eng = chargerMoteur323({ split: true, ancien: !!v.ancien });
  if(v.tailles) S.installerTailles(eng, v.tailles[0], v.tailles[1], v.aggr);
  if(v.deuxA) S.installerDeuxAnalystes(eng);
  const src = eng.source.split('\n');
  const injAgg = {}, cellAgg = {}, suites = [];
  for(const tb of Object.keys(S.TABLES323)){
    for(let rot = 0; rot < S.NROT; rot++){
      const prep = await S.preparer(eng, tb, rot);
      for(let i = 0; i < v.N; i++){
        const r = await S.jouerSuite(eng, prep, i, { injections: v.injections, cellules: v.cellules, pdg: v.pdg });
        if(r.inj) r.inj.forEach(([cid, col, q, line]) => {
          const k = tb + '|' + etiquette(src, line);
          const o = injAgg[k] || (injAgg[k] = { green: 0, red: 0, n: 0 });
          o[col] += q; o.n++;
        });
        if(r.cells){
          const tierOf = {}; r.cos.forEach(c => { tierOf[c.id] = c.tier; });
          r.cells.forEach(([cid, mg, an]) => { const k = `${tb}|${tierOf[cid]}|${mg}/${an}`; cellAgg[k] = (cellAgg[k] || 0) + 1; });
        }
        suites.push({ tb, rot, i, sa: r.saisie, fi: r.fin, rf: r.raison, ac: r.acts, c: r.cos.map(c => {
          const o = { x: c.idx, ty: c.type, ti: c.tier, p: c.prix.map(p => r6(p / c.p0)), n: c.ni.map(r4) };
          if(c.hist){
            const byS = {}; c.hist.forEach(h => { byS[h.s] = h; });
            o.v = c.prix.map((_, s) => byS[s] ? CODE_V[byS[s].v] : '-').join('');
            if(v.detail){
              const g = key => c.prix.map((_, s) => byS[s] ? r4(byS[s][key]) : null);
              o.h = g('h'); o.m = g('m'); o.k = g('k'); o.t = g('t'); o.z = g('z');
              o.b = c.prix.map((_, s) => byS[s] ? byS[s].b : '-').join(''); o.of = c.prix.map((_, s) => byS[s] ? byS[s].of : '-').join('');
            }
          }
          if(c.ancien && c.ancien.length) o.v = c.ancien.map(t => t ? CODE_T[t] : '-').join('');
          if(v.pdg){ o.c = c.pari.map(x => x ? CODE_P[x] : '.').join(''); if(v.pdg.strat === 'informe') o.d = c.ecartMp.map(r4); }
          return o;
        }) });
      }
    }
  }
  const out = { cle: v.cle, variante: Object.assign({}, v), duree: (Date.now() - t0) / 1000, suites, injections: injAgg, cellules: cellAgg };
  fs.writeFileSync(path.join(DOSSIER, v.cle + '.json'), JSON.stringify(out));
  console.log(`  ${v.cle} : ${suites.length} suites, ${out.duree.toFixed(0)} s`);
}

async function partieVerif(){
  const t0 = Date.now();
  const res = { tours: [] };
  for(const anc of [false, true]) for(const [tb, rot] of [['8+3', 0], ['8+3', 2], ['4+2', 1], ['4+2', 3]])
    res.tours.push(await verifierTour323(anc, tb, rot, 5, 12));
  res.gel = await verifierGel();
  res.duree = (Date.now() - t0) / 1000;
  fs.writeFileSync(path.join(DOSSIER, 'verif.json'), JSON.stringify(res));
  console.log(JSON.stringify(res.tours.map(t => `${t.ancien ? 'ancien' : 'nouveau'} ${t.tb} r${t.rot} : ${t.egal}/${t.nSeeds}`)), JSON.stringify(res.gel));
}

const PARTIES = {
  verif: partieVerif,
  c1: async () => { for(const v of VARIANTES_C.slice(0, 4)) await lancerVariante(v); },
  c2: async () => { for(const v of VARIANTES_C.slice(4)) await lancerVariante(v); },
  g1: async () => { for(const v of VARIANTES_G.slice(0, 8)) await lancerVariante(v); },
  g2: async () => { for(const v of VARIANTES_G.slice(8, 15)) await lancerVariante(v); },
  g3: async () => { for(const v of VARIANTES_G.slice(15, 23)) await lancerVariante(v); },
  g4: async () => { for(const v of VARIANTES_G.slice(23)) await lancerVariante(v); },
  g5: async () => { for(const v of VARIANTES_G2.slice(0, 4)) await lancerVariante(v); },
  g6: async () => { for(const v of VARIANTES_G2.slice(4)) await lancerVariante(v); },
  analyse: async () => { await require('./analyse323').analyser(DOSSIER, { VARIANTES_C, VARIANTES_G, STRATS, cleStrat, STRATS2, cleStrat2, N_C, N_G }); },
};

(async () => {
  const quoi = process.argv[2];
  const liste = quoi ? [quoi] : Object.keys(PARTIES);
  for(const p of liste){
    if(!PARTIES[p]) throw new Error('Partie inconnue : ' + p);
    const t = Date.now();
    console.log(`== partie ${p} ==`);
    await PARTIES[p]();
    console.log(`   ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
})().catch(e => { console.error(e); process.exit(1); });

module.exports = { VARIANTES_C, VARIANTES_G, STRATS, cleStrat };
