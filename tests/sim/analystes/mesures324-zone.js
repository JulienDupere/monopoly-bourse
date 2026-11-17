// Section 324 — mesure d'appoint : part des semestres dans la zone pour des zones plus étroites (dont une zone FIXE
// de ± 0,35 M$), comparée au réglage de la section 323 (k 0,35, plancher 0,5). Mêmes suites, mêmes graines que
// mesures323b.js. Résumé : resultats-324.txt. Non lancé par run-all.
// Usage : node tests/sim/analystes/mesures324-zone.js [N]   (N suites par table et par rotation, 60 par défaut)
const path = require('path');
const banc = __dirname;
const N = +process.argv[2] || 60;
const { chargerMoteur323 } = require(path.join(banc, 'moteur323'));
const S = require(path.join(banc, 'suites323'));

const VARIANTES = [
  { nom: 'k 0,35 plancher 0,5 (323)', zone: [0.35, 0.5] },
  { nom: 'fixe ± 0,35 M$', zone: [0, 0.35] },
  { nom: 'fixe ± 0,50 M$', zone: [0, 0.5] },
  { nom: 'k 0,25 plancher 0,35 (324)', zone: [0.25, 0.35] },
  { nom: 'k 0,15 plancher 0,35', zone: [0.15, 0.35] },
];

(async () => {
  for(const v of VARIANTES){
    const t0 = Date.now();
    const eng = chargerMoteur323({ split: true });
    S.installerZone(eng, v.zone[0], v.zone[1]);
    const n = { z: 0, u: 0, U: 0, d: 0, D: 0 };
    let cubes = 0, net = 0, zsum = 0, zn = 0;
    const parTable = {};
    for(const tb of Object.keys(S.TABLES323)){
      parTable[tb] = { z: 0, tot: 0 };
      for(let rot = 0; rot < S.NROT; rot++){
        const prep = await S.preparer(eng, tb, rot);
        for(let i = 0; i < N; i++){
          const r = await S.jouerSuite(eng, prep, i, { injections: true });
          r.cos.forEach(c => (c.hist || []).forEach(h => {
            const code = { zone: 'z', normalUp: 'u', strongUp: 'U', normalDown: 'd', strongDown: 'D' }[h.v];
            if(!code) return;
            n[code]++; parTable[tb].tot++; if(code === 'z') parTable[tb].z++;
            cubes += h.q; net += (h.col === 'red' ? -h.q : h.q);
            if(typeof h.z === 'number'){ zsum += h.z; zn++; }
          }));
        }
      }
    }
    const tot = n.z + n.u + n.U + n.d + n.D;
    const pc = x => (100 * x / tot).toFixed(1);
    console.log(`${v.nom.padEnd(28)} n=${tot}  zone ${pc(n.z)} %  normal+ ${pc(n.u)}  fort+ ${pc(n.U)}  normal- ${pc(n.d)}  fort- ${pc(n.D)}  cubes/sem ${(cubes / tot).toFixed(2)}  net ${(net / tot).toFixed(3)}  demi-zone moy. ${zn ? (zsum / zn).toFixed(2) : '?'} M$  ` +
      Object.keys(parTable).map(tb => `${tb}: ${(100 * parTable[tb].z / parTable[tb].tot).toFixed(1)} %`).join('  ') + `  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
