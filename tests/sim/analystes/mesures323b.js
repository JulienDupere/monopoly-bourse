// 2e mesure de la section 323, sur le moteur CORRIGÉ (modélisateur par tour C4, bénéfice jugé C1, gel après les
// enchères C2, marché absent sous 2 entreprises C3 ; tailles 2 et 5, 0 ou 1 cube dans la zone).
// Point d'entrée : node tests/sim/analystes/mesures323b.js [partie]
//   parties : verif, z1, z2, z3, g1, g2, g3, g4, analyse ; sans argument : toutes, dans l'ordre.
// Variables : N_C (suites par table et par rotation pour les zones, 250), N_G (pari, 100), ZONE_PDG (« k,plancher »
//   de la zone du pari, « 0.35,0.5 » par défaut), DOSSIER_323B (bruts ; par défaut <tmp>/banc323b).
// Sorties : resultats-323b.json et resultats-323b.txt ici (partie « analyse »).
const fs = require('fs'), path = require('path'), os = require('os');
const { chargerMoteur323 } = require('./moteur323');
const S = require('./suites323');
const { verifierTour323, verifierGel } = require('./verif323');

const N_C = +process.env.N_C || 250;
const N_G = +process.env.N_G || 100;
const [ZK, ZF] = (process.env.ZONE_PDG || '0.35,0.5').split(',').map(Number);
const DOSSIER = process.env.DOSSIER_323B || path.join(os.tmpdir(), 'banc323b');
fs.mkdirSync(DOSSIER, { recursive: true });

// Mesures 1 et 2. zone null = constantes du moteur (k 0,5, plancher 0,5). verdict null = analystVerdictCubes du moteur.
const VARIANTES_Z = [
  { cle: 'z50', nom: 'k 0,5 plancher 0,5 (moteur)', zone: null, detail: true },
  { cle: 'coupe', nom: 'verdict coupé (0 cube), k 0,5', zone: null, verdict: { n: 0, f: 0, zmax: 0 } },
  { cle: 'z35', nom: 'k 0,35 plancher 0,5', zone: [0.35, 0.5] },
  { cle: 'z25', nom: 'k 0,25 plancher 0,5', zone: [0.25, 0.5] },
  { cle: 'z35f25', nom: 'k 0,35 plancher 0,25', zone: [0.35, 0.25] },
].map(v => Object.assign({ injections: true, N: N_C }, v));

// Mesure 3 : variantes de la promesse (cp verts à l'annonce ; x rouges de plus si ratée ; monte : un cran de plus au-dessus).
const PROMESSES = { A: { cp: 2, x: 5 }, B: { cp: 3, x: 5 }, C: { cp: 2, x: 5, monte: true }, D: { cp: 1, x: 3 }, E: { cp: 2, x: 7 } };
const SACS = { fond: { dest: 'fond', trading: null }, vide: { dest: 'trading', trading: null }, charge: { dest: 'trading', trading: { green: 10, red: 6 } } };
const cleG = (sac, strat, cw, P) => `b_${sac}_${strat}${cw ? '_w' + cw : ''}${P ? '_' + P : ''}`;
function varG(sac, strat, cw, P){
  const p = P ? PROMESSES[P] : { cp: 0, x: 0 };
  return { cle: cleG(sac, strat, cw, P), sac, strat, cwN: cw || 0, P: P || null, zone: [ZK, ZF], N: N_G,
    pdg: { strat, cw: cw || 0, cp: p.cp, x: p.x, monte: !!p.monte, theta: 0.5, dest: SACS[sac].dest, trading: SACS[sac].trading } };
}
const VARIANTES_G = [];
VARIANTES_G.push(varG('fond', 'jamais'), varG('fond', 'avertir', 1), varG('fond', 'avertir', 2), varG('fond', 'informeA', 1), varG('fond', 'informeA', 2));
Object.keys(PROMESSES).forEach(P => VARIANTES_G.push(varG('fond', 'promettre', 0, P), varG('fond', 'informe', 1, P), varG('fond', 'informeP', 0, P)));
VARIANTES_G.push(varG('fond', 'informe', 2, 'A'));
for(const sac of ['vide', 'charge'])
  VARIANTES_G.push(varG(sac, 'jamais'), varG(sac, 'avertir', 1), varG(sac, 'promettre', 0, 'A'), varG(sac, 'informe', 1, 'A'), varG(sac, 'informeP', 0, 'A'), varG(sac, 'informeA', 1));

const CODE_V = { zone: 'z', normalUp: 'u', strongUp: 'U', normalDown: 'd', strongDown: 'D' };
const CODE_P = { avertir: 'a', promettre: 'p' };
const r6 = x => (x === null || x === undefined || !isFinite(x)) ? null : +x.toPrecision(6);
const r4 = x => (x === null || x === undefined || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4;

async function lancer(v){
  const t0 = Date.now();
  const eng = chargerMoteur323({ split: true });
  if(v.verdict || v.pdg) S.installerVerdict(eng, v.verdict || { n: 2, f: 5, zmax: 1 });
  if(v.zone) S.installerZone(eng, v.zone[0], v.zone[1]);
  const injAgg = { verdict: { green: 0, red: 0 }, autres: { green: 0, red: 0 } }, suites = [];
  for(const tb of Object.keys(S.TABLES323)){
    for(let rot = 0; rot < S.NROT; rot++){
      const prep = await S.preparer(eng, tb, rot);
      for(let i = 0; i < v.N; i++){
        const r = await S.jouerSuite(eng, prep, i, { injections: v.injections, pdg: v.pdg });
        if(r.inj) r.inj.forEach(([cid, col, q, line]) => { injAgg[line === 'verdict' ? 'verdict' : 'autres'][col] += q; });
        suites.push({ tb, rot, i, sa: r.saisie, fi: r.fin, rf: r.raison, c: r.cos.map(c => {
          const byS = {}; (c.hist || []).forEach(h => { byS[h.s] = h; });
          const o = { x: c.idx, ty: c.type, ti: c.tier, p: c.prix.map(p => r6(p / c.p0)), n: c.ni.map(r4),
            v: c.prix.map((_, s) => byS[s] ? CODE_V[byS[s].v] : '-').join(''),
            q: c.prix.map((_, s) => byS[s] ? (byS[s].col === 'red' ? -byS[s].q : byS[s].q) : 0) };
          if(v.detail){ const g = key => c.prix.map((_, s) => byS[s] ? r4(byS[s][key]) : null); o.h = g('h'); o.m = g('m'); o.k = g('k'); o.t = g('t'); o.z = g('z'); o.j = g('j'); }
          if(v.pdg) o.c = c.pari.map(x => x ? CODE_P[x] : '.').join('');
          return o;
        }) });
      }
    }
  }
  const out = { cle: v.cle, variante: v, duree: (Date.now() - t0) / 1000, suites, injections: injAgg };
  fs.writeFileSync(path.join(DOSSIER, v.cle + '.json'), JSON.stringify(out));
  console.log(`  ${v.cle} : ${suites.length} suites, ${out.duree.toFixed(0)} s`);
}

async function partieVerif(){
  const res = { tours: [] };
  for(const [tb, rot] of [['8+3', 0], ['8+3', 2], ['4+2', 1], ['4+2', 3]]) res.tours.push(await verifierTour323(false, tb, rot, 5, 12));
  res.gel = await verifierGel();
  fs.writeFileSync(path.join(DOSSIER, 'verif.json'), JSON.stringify(res));
  console.log(JSON.stringify(res.tours.map(t => `${t.tb} r${t.rot} : ${t.egal}/${t.nSeeds}`)), JSON.stringify(res.gel));
}

const tranche = (a, b) => async () => { for(const v of VARIANTES_G.slice(a, b)) await lancer(v); };
const PARTIES = {
  verif: partieVerif,
  z1: async () => { for(const v of VARIANTES_Z.slice(0, 2)) await lancer(v); },
  z2: async () => { for(const v of VARIANTES_Z.slice(2, 4)) await lancer(v); },
  z3: async () => { for(const v of VARIANTES_Z.slice(4)) await lancer(v); },
  g1: tranche(0, 9), g2: tranche(9, 17), g3: tranche(17, 25), g4: tranche(25),
  analyse: async () => { await require('./analyse323b').analyser(DOSSIER, { VARIANTES_Z, VARIANTES_G, PROMESSES, cleG, N_C, N_G, ZK, ZF }); },
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
