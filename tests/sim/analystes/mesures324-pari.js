// Section 324 — mesure d'appoint : le pari du PDG (avertissement 1 rouge ; promesse 1 vert, 3 rouges si ratée ; cube
// de l'annonce au sac fondamental) avec la zone 0,25 / plancher 0,35, comparée à la zone 0,35 / plancher 0,5.
// Même méthode que mesures323b.js + analyse323b.js (mesure 3) : gain = moyenne de log(cours ÷ cours « jamais »).
// Résumé : resultats-324.txt. Non lancé par run-all.
// Usage : node tests/sim/analystes/mesures324-pari.js [N]   (N suites par table et par rotation, 100 par défaut)
const path = require('path');
const banc = __dirname;
const N = +process.argv[2] || 100;
const { chargerMoteur323 } = require(path.join(banc, 'moteur323'));
const S = require(path.join(banc, 'suites323'));

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if(a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const lg = x => Math.log(Math.max(x, 1e-6));
const CODE_V = { zone: 'z', normalUp: 'u', strongUp: 'U', normalDown: 'd', strongDown: 'D' };
const CODE_P = { avertir: 'a', promettre: 'p' };

const pdg = (strat, cw, cp, x) => ({ strat, cw: cw || 0, cp: cp || 0, x: x || 0, monte: false, theta: 0.5, dest: 'fond', trading: null });
const STRATS = [
  ['jamais', pdg('jamais')],
  ['toujours avertir (1 R)', pdg('avertir', 1)],
  ['informé, avertissements seuls (1 R)', pdg('informeA', 1)],
  ['toujours promettre (1 V, ratée +3 R)', pdg('promettre', 0, 1, 3)],
  ['informé, avert. 1 R + promesse (1 V, +3 R)', pdg('informe', 1, 1, 3)],
  ['informé, promesses seules (1 V, +3 R)', pdg('informeP', 0, 1, 3)],
];
const ZONES = [[0.35, 0.5], [0.25, 0.35]];

async function lancer(zone, p){
  const eng = chargerMoteur323({ split: true });
  S.installerVerdict(eng, { n: 2, f: 5, zmax: 1 });
  S.installerZone(eng, zone[0], zone[1]);
  const suites = new Map();
  for(const tb of Object.keys(S.TABLES323)){
    for(let rot = 0; rot < S.NROT; rot++){
      const prep = await S.preparer(eng, tb, rot);
      for(let i = 0; i < N; i++){
        const r = await S.jouerSuite(eng, prep, i, { injections: true, pdg: p });
        if(!(r.fin < 0)) continue;
        suites.set(`${tb}|${rot}|${i}`, r.cos.map(c => {
          const byS = {}; (c.hist || []).forEach(h => { byS[h.s] = h; });
          return { p11: c.prix[11] / c.p0, v: c.prix.map((_, s) => byS[s] ? CODE_V[byS[s].v] : '-'), c: c.pari.map(x => x ? CODE_P[x] : '.') };
        }));
      }
    }
  }
  return suites;
}

(async () => {
  for(const zone of ZONES){
    console.log(`== zone k ${zone[0]} plancher ${zone[1]} ==`);
    let base = null;
    for(const [nom, p] of STRATS){
      const t0 = Date.now();
      const d = await lancer(zone, p);
      if(!base){ base = d; console.log(`  jamais : ${d.size} suites (${((Date.now() - t0) / 1000).toFixed(0)} s)`); continue; }
      const g = [], nAnn = []; let na = 0, np = 0, nc = 0; const sz = { a: [0, 0], p: [0, 0], '.': [0, 0] };
      d.forEach((cos, k) => { const b = base.get(k); if(!b) return;
        cos.forEach((c, j) => { g.push(lg(c.p11) - lg(b[j].p11));
          let n = 0; for(let t = 0; t < c.c.length; t++){ nc++; const call = c.c[t]; if(call === 'a') na++; if(call === 'p') np++; if(call !== '.') n++;
            if(c.v[t] !== '-'){ sz[call][1]++; if('dD'.includes(c.v[t])) sz[call][0]++; } } nAnn.push(n); }); });
      const gain = mean(g), ic = 1.96 * sd(g) / Math.sqrt(g.length), ann = mean(nAnn);
      const pc = x => x[1] ? (100 * x[0] / x[1]).toFixed(1) : '—';
      console.log(`  ${nom.padEnd(46)} n=${g.length}  gain ${(100 * gain).toFixed(1)} ± ${(100 * ic).toFixed(1)} %  annonces ${ann.toFixed(2)}  avertit ${(100 * na / nc).toFixed(1)} %  promet ${(100 * np / nc).toFixed(1)} %  sous zone si avert. ${pc(sz.a)}  si prom. ${pc(sz.p)}  si rien ${pc(sz['.'])}  par annonce ${(100 * gain / ann).toFixed(2)} ± ${(100 * ic / ann).toFixed(2)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
