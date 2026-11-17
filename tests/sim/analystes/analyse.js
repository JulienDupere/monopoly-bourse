// Analyse des tirages : les 7 mesures du contrat, à partir des enregistrements de simulation.js.
const { verdict, median3 } = require('./analystes');

const KS = [0.25, 0.5, 0.75, 1];
const PLANCHERS = [0.25, 0.5, 1];
const CLASSES = ['zone', 'n+', 'f+', 'n-', 'f-'];
const OLD = ['flat', 'beat', 'sigBeat', 'miss', 'sigMiss', 'reallyMiss'];

// ---------- Accumulateurs par semestre (mesures 1 et 7) ----------
function puits(){
  const m1 = {}, m7 = {};
  function semestre(o){
    for(const key of [`${o.tb}|${o.ph}|${o.pf}`, `*|${o.ph}|${o.pf}`]){
      const g = m1[key] || (m1[key] = {P: z1(), S: z1(), Q: z1(), R: {n:0, s:0, q:0}});
      g.R.n++; g.R.s += o.R; g.R.q += o.R*o.R;
      add1(g.P, o.R, o.mP); add1(g.S, o.R, o.mS); add1(g.Q, o.R, o.mQ);
    }
    if(!/-[TV]$/.test(o.ph)){
      for(const key of [`${o.tb}|${o.ph}`, `${o.tb}|*`]){
        const g = m7[key] || (m7[key] = {n:0, R:0, R2:0, pawn:0, co:0, rent:0, rent2:0, go:0, paid:0, tax:0, interest:0, erPawn:0, erCo:0});
        const rent = o.rent.pawn + o.rent.co;
        g.n++; g.R += o.R; g.R2 += o.R*o.R; g.pawn += o.rent.pawn; g.co += o.rent.co; g.rent += rent; g.rent2 += rent*rent;
        g.go += o.cats.go_salary_revenue || 0; g.paid += -(o.cats.rent_expense || 0); g.tax += -(o.cats.tax_expense || 0);
        g.interest += -(o.cats.mortgage_interest_expense || 0);
        g.erPawn += o.mP.ErPawn; g.erCo += o.mP.ErCo;
      }
    }
  }
  return { m1, m7, semestre };
}
function z1(){ return {n:0, M:0, v:0, d:0, d2:0, in1:0, in2:0}; }
function add1(a, R, m){
  const d = R - m.M; a.n++; a.M += m.M; a.v += m.sigma*m.sigma; a.d += d; a.d2 += d*d;
  if(Math.abs(d) <= m.sigma + 1e-12) a.in1++; if(Math.abs(d) <= 2*m.sigma + 1e-12) a.in2++;
}

function mesure1(m1){
  const out = {};
  for(const key in m1){
    const g = m1[key], R = g.R, meanR = R.s/R.n, sdR = Math.sqrt(Math.max(0, R.q/R.n - meanR*meanR));
    const v = {};
    for(const k of ['P', 'S', 'Q']){
      const a = g[k], md = a.d/a.n;
      v[k] = { moyM: a.M/a.n, sigmaM: Math.sqrt(a.v/a.n), biais: md, sdEcart: Math.sqrt(Math.max(0, a.d2/a.n - md*md)),
        dans1s: a.in1/a.n, dans2s: a.in2/a.n };
    }
    out[key] = { n: R.n, moyR: meanR, sdR, P: v.P, S: v.S, Q: v.Q };
  }
  return out;
}

function mesure7(m7){
  const out = {};
  for(const key in m7){
    const g = m7[key], n = g.n, mr = g.rent/n;
    out[key] = { n, moyR: g.R/n, sdR: Math.sqrt(Math.max(0, g.R2/n - (g.R/n)**2)),
      loyersPions: g.pawn/n, loyersEntreprises: g.co/n, partPions: g.rent > 0 ? g.pawn/g.rent : 0,
      sdLoyers: Math.sqrt(Math.max(0, g.rent2/n - mr*mr)), cvLoyers: mr > 0 ? Math.sqrt(Math.max(0, g.rent2/n - mr*mr))/mr : null,
      salaireGO: g.go/n, loyersPayes: g.paid/n, taxes: g.tax/n, interets: g.interest/n,
      modeleLoyersPions: g.erPawn/n, modeleLoyersEntreprises: g.erCo/n };
  }
  return out;
}

// ---------- Verdicts ----------
function Kof(r, Kv, scale, f){
  scale = scale || 1; f = f || 1;
  if(Kv === 'K1') return r.K1 * scale * f;
  const sumM = Kv === 'K2s' ? r.sumMs : r.sumMp;
  const capC = r.cap * scale, sumCap = r.sumCap + (scale - 1) * r.cap;
  return sumCap > 0 ? capC * sumM / sumCap * f : 0;
}
function Mof(r, Mv){ return Mv === 's' ? {M: r.Ms, s: r.ss} : {M: r.Mp, s: r.sp}; }
function classer(r, Mv, Kv, k, fl, scale, f){
  const m = Mof(r, Mv);
  return verdict(r.R, r.H, m.M, Kof(r, Kv, scale, f), m.s, k, fl);
}
function compte(list, fn, keys){
  const c = {}; keys.forEach(k => { c[k] = 0; });
  list.forEach(r => { const x = fn(r); c[x] = (c[x]||0) + 1; });
  const n = list.length, out = {n};
  for(const k in c) out[k] = n ? c[k]/n : 0;
  return out;
}
function grouper(list, keyFn){
  const g = {};
  list.forEach(r => { const k = keyFn(r); (g[k] || (g[k] = [])).push(r); });
  return g;
}

const VARIANTES = [['p','K1'], ['p','K2'], ['s','K1'], ['s','K2s']];

function mesure2(recs){
  const out = { grille: {}, parPhaseProfil: {}, parTable: {}, ancien: {} };
  const base = recs.filter(r => !r.ph.endsWith('-T'));
  for(const [Mv, Kv] of VARIANTES){
    const vk = Mv + '/' + Kv;
    out.grille[vk] = {}; out.parPhaseProfil[vk] = {}; out.parTable[vk] = {};
    for(const k of KS) for(const fl of PLANCHERS){
      const ck = `k${k}_p${fl}`;
      const fn = r => classer(r, Mv, Kv, k, fl);
      out.grille[vk][ck] = { tout: compte(base, fn, CLASSES) };
      const byPh = grouper(recs, r => r.ph);
      for(const ph in byPh) out.grille[vk][ck][ph] = compte(byPh[ph], fn, CLASSES);
      const byPP = grouper(recs, r => r.ph + '|' + r.pf);
      out.parPhaseProfil[vk][ck] = {};
      for(const key in byPP) out.parPhaseProfil[vk][ck][key] = compte(byPP[key], fn, CLASSES);
      const byT = grouper(recs, r => r.tb + '|' + r.ph + '|' + r.pf);
      out.parTable[vk][ck] = {};
      for(const key in byT) out.parTable[vk][ck][key] = compte(byT[key], fn, CLASSES);
    }
  }
  const byPP = grouper(recs, r => r.ph + '|' + r.pf);
  for(const key in byPP) out.ancien[key] = compte(byPP[key], r => r.old || 'aucun', OLD);
  const byT = grouper(recs, r => r.tb + '|' + r.ph + '|' + r.pf);
  out.ancienParTable = {};
  for(const key in byT) out.ancienParTable[key] = compte(byT[key], r => r.old || 'aucun', OLD);
  out.ancienTout = compte(base, r => r.old || 'aucun', OLD);
  // Diagnostic hors contrat : part des semestres au-delà de 2 demi-largeurs (un « fort » défini par la distance).
  out.auDela2z = {};
  for(const [Mv, Kv] of VARIANTES) for(const k of KS) for(const fl of PLANCHERS){
    let up = 0, dn = 0;
    base.forEach(r => { const m = Mof(r, Mv); const T = median3(r.H, m.M, Kof(r, Kv)); const z = Math.max(fl, k * m.s);
      if(r.R > T + 2*z) up++; else if(r.R < T - 2*z) dn++; });
    out.auDela2z[`${Mv}/${Kv}/k${k}_p${fl}`] = { haut: up/base.length, bas: dn/base.length };
  }
  return out;
}

function mesure3(recs, ref){
  const out = { parPhaseProfil: {}, sensibilite: {}, croissanceF: {} };
  const byPP = grouper(recs, r => r.ph + '|' + r.pf);
  const mean = (l, f) => l.reduce((s, r) => s + f(r), 0) / l.length;
  const medianOf = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length/2)] : null; };
  for(const key in byPP){
    const l = byPP[key];
    const big = l.filter(r => Math.abs(r.Mp) > 0.25);
    const tgt = Kv => { const c = {H:0, M:0, K:0}; l.forEach(r => { const K = Kof(r, Kv); const T = median3(r.H, r.Mp, K); if(T === r.H) c.H++; else if(T === r.Mp) c.M++; else c.K++; }); for(const k in c) c[k] /= l.length; return c; };
    out.parPhaseProfil[key] = {
      n: l.length, moyR: mean(l, r => r.R), medR: medianOf(l.map(r => r.R)), moyH: mean(l, r => r.H), moyM: mean(l, r => r.Mp), moyK1: mean(l, r => r.K1), moyK2: mean(l, r => Kof(r, 'K2')),
      battuH: mean(l, r => +(r.R > r.H)), battuM: mean(l, r => +(r.R > r.Mp)), battuK1: mean(l, r => +(r.R > r.K1)), battuK2: mean(l, r => +(r.R > Kof(r, 'K2'))),
      medK1surM: medianOf(big.map(r => r.K1 / r.Mp)), medK2surM: medianOf(big.map(r => Kof(r, 'K2') / r.Mp)),
      cibleK1: tgt('K1'), cibleK2: tgt('K2'),
    };
  }
  const base = recs.filter(r => !r.ph.endsWith('-T'));
  for(const Kv of ['K1', 'K2']){
    out.sensibilite[Kv] = {};
    const ref1 = base.map(r => classer(r, ref.Mv, Kv, ref.k, ref.fl, 1));
    for(const sc of [0.7, 1, 1.3]){
      const cl = base.map(r => classer(r, ref.Mv, Kv, ref.k, ref.fl, sc));
      const c = {}; CLASSES.forEach(k => { c[k] = 0; }); cl.forEach(x => { c[x]++; });
      for(const k in c) c[k] /= cl.length;
      c.change = cl.reduce((s, x, i) => s + (x !== ref1[i]), 0) / cl.length;
      c.battu = base.reduce((s, r) => s + (r.R > Kof(r, Kv, sc)), 0) / base.length;
      out.sensibilite[Kv]['x' + sc] = c;
    }
  }
  const cro = base.filter(r => r.ty.startsWith('croissance'));
  for(const f of [0.6, 0.8, 1]){
    const c = compte(cro, r => classer(r, ref.Mv, 'K2', ref.k, ref.fl, 1, f), CLASSES);
    c.battuK = cro.reduce((s, r) => s + (r.R > Kof(r, 'K2', 1, f)), 0) / cro.length;
    out.croissanceF['f' + f] = c;
  }
  return out;
}

function mesure4(recs, Mv, Kv, reglages){
  const out = {};
  const groups = grouper(recs, r => r.tb + '|' + r.ph + '|' + r.pf);
  const tiers = new Map();
  for(const key in groups){
    const l = groups[key].slice().sort((a, b) => (a.Mq - Mof(a, Mv).M) - (b.Mq - Mof(b, Mv).M));
    l.forEach((r, i) => tiers.set(r, Math.min(2, Math.floor(3 * i / l.length))));
  }
  for(const [k, fl] of reglages){
    const ck = `k${k}_p${fl}`;
    const res = {};
    const sets = { tout: recs.filter(r => !r.ph.endsWith('-T')) };
    ['concentree', 'diversifiee', 'endettee', 'ordinaire'].forEach(pf => { sets[pf] = sets.tout.filter(r => r.pf === pf); });
    sets.transition = recs.filter(r => r.ph.endsWith('-T'));
    for(const name in sets){
      res[name] = {};
      const l = sets[name];
      res[name].ensemble = compte(l, r => classer(r, Mv, Kv, k, fl), CLASSES);
      for(let t=0;t<3;t++){
        const lt = l.filter(r => tiers.get(r) === t);
        const c = compte(lt, r => classer(r, Mv, Kv, k, fl), CLASSES);
        c.ecartMoyen = lt.length ? lt.reduce((s, r) => s + (r.Mq - Mof(r, Mv).M), 0) / lt.length : null;
        res[name]['tiers' + (t+1)] = c;
      }
    }
    out[ck] = res;
  }
  return out;
}

function mesure6(recs, Mv, Kv, reglages, derive){
  const out = {};
  const base = recs.filter(r => !r.ph.endsWith('-T'));
  const sets = { toutes: base, croissanceSeules: base.filter(r => r.ty.startsWith('croissance')) };
  const regles = { actuelle: () => r => r.ax };
  for(const [k, fl] of reglages){
    regles[`a_k${k}_p${fl}`] = () => r => { const v = classer(r, Mv, Kv, k, fl); return v === 'zone' ? 'neutre' : (v.endsWith('+') ? 'bon' : 'mauvais'); };
    regles[`b_k${k}_p${fl}`] = () => r => { const v = classer(r, Mv, Kv, k, fl); return v === 'f+' ? 'bon' : (v === 'f-' ? 'mauvais' : 'neutre'); };
  }
  for(const sname in sets){
    out[sname] = {};
    const l = sets[sname];
    for(const rn in regles){
      const fn = regles[rn]();
      const res = { n: l.length, axe: {bon:0, neutre:0, mauvais:0, aucun:0} };
      for(const tier of ['eleve', 'tres_eleve']){
        const cells = {}; let drift = 0, nd = 0;
        l.forEach(r => {
          const a = fn(r); const mg = tier === 'eleve' ? r.axE : r.axT;
          if(tier === 'eleve') res.axe[a || 'aucun']++;
          if(!a || !mg) return;
          const key = mg + '/' + a; cells[key] = (cells[key]||0) + 1;
          drift += derive[mg][a]; nd++;
        });
        for(const c in cells) cells[c] /= l.length;
        res[tier] = { cases: cells, deriveMoyenne: nd ? drift/nd : null, sansMatrice: (l.length - nd)/l.length };
      }
      for(const a in res.axe) res.axe[a] /= l.length;
      out[sname][rn] = res;
    }
  }
  return out;
}

module.exports = { puits, mesure1, mesure2, mesure3, mesure4, mesure6, mesure7, classer, Kof, KS, PLANCHERS, CLASSES, OLD, VARIANTES };
