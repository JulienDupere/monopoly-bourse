// Ronde 2 : analyses des verdicts (par phase, partie type sans saisie, parc vivant), H0 / H1, K2 / K3, référence M',
// marché, tiers d'information, mesure 6 sur les mêmes populations.
const { verdict, verdictH1, verdictRef, median3 } = require('./analystes');

const KS = [0.25, 0.5, 0.75];
const FL = 0.5;
const CL = ['zone', 'n+', 'f+', 'n-', 'f-'];

function Mof(r, Mv){ return Mv === 's' ? {M: r.Ms, s: r.ss, sum: r.sumMs} : {M: r.Mp, s: r.sp, sum: r.sumMp}; }
function Kof(r, Mv, Kv){
  const m = Mof(r, Mv);
  if(Kv === 'K1') return r.K1;
  if(Kv === 'K3') return m.M + Math.max(Math.abs(m.M), 0.5) * (r.rho - 1);
  return r.sumCap > 0 ? r.cap * m.sum / r.sumCap : 0;
}
function classer(r, Mv, Kv, k, fl, H){
  const m = Mof(r, Mv), K = Kof(r, Mv, Kv);
  if(H === 'H1') return verdictH1(r.R, m.M, K, m.s, k, fl);
  return verdict(r.R, r.H, m.M, K, m.s, k, fl);
}
function compte(list, fn, keys){
  const c = {}; keys.forEach(k => { c[k] = 0; });
  list.forEach(r => { const x = fn(r); c[x] = (c[x]||0) + 1; });
  const out = {n: list.length};
  for(const k in c) out[k] = list.length ? c[k] / list.length : 0;
  return out;
}

// Groupes de décision. Les suites avec saisie (part saisie faute d'intérêt payé) sont écartées partout sauf au début
// (aucune saisie possible avant la fin d'année) ; le nombre écarté est rendu.
function groupes(recs){
  const G = {};
  const add = (name, r) => { (G[name] || (G[name] = [])).push(r); };
  const ecartes = {};
  recs.forEach(r => {
    const base = r.ph.replace(/-[TV]$/, '');
    const tag = r.ph.endsWith('-T') ? 'transition' : r.ph.endsWith('-V') ? 'vivant' : 'base';
    const name = `${r.ph} S${r.sem}`;
    if(r.seized){ ecartes[name] = (ecartes[name]||0) + 1; return; }
    add(name, r);
    if(base !== 'debut' && tag === 'base'){ add('partie type (milieu+fin, S3+S4)', r); add(`partie type S${r.sem}`, r); }
    if(base !== 'debut' && tag === 'vivant'){ add('parc vivant (milieu+fin, S3+S4)', r); add(`parc vivant S${r.sem}`, r); }
  });
  return { G, ecartes };
}

function tableauxVerdict(list){
  const out = {};
  for(const Mv of ['p', 's']) for(const Kv of ['K2', 'K3']) for(const k of KS)
    out[`${Mv}/${Kv}/k${k}`] = compte(list, r => classer(r, Mv, Kv, k, FL, 'H0'), CL);
  for(const k of KS) out[`Mref/k${k}`] = compte(list, r => verdictRef(r.R, r.Mq, r.sq, k, FL), ['zone', '+', '-']);
  return out;
}
function tableauxH1(list){
  const out = {};
  for(const H of ['H0', 'H1']) for(const Mv of ['p', 's']) for(const Kv of ['K2', 'K3']) for(const k of KS)
    out[`${H}/${Mv}/${Kv}/k${k}`] = compte(list, r => classer(r, Mv, Kv, k, FL, H), CL);
  return out;
}
function parProfil(list, Mv, Kv, k){
  const out = {};
  for(const pf of ['concentree', 'diversifiee', 'endettee', 'ordinaire']){
    const l = list.filter(r => r.pf === pf);
    out[pf] = compte(l, r => classer(r, Mv, Kv, k, FL, 'H0'), CL);
  }
  for(const ty of ['garp', 'dividende', 'croissance', 'momentum']){
    const l = list.filter(r => r.ty.startsWith(ty));
    out['type ' + ty] = compte(l, r => classer(r, Mv, Kv, k, FL, 'H0'), CL);
  }
  return out;
}

const medianOf = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length/2)] : null; };
function marche(list){
  const out = {};
  for(const pf of ['tous', 'concentree', 'diversifiee', 'endettee', 'ordinaire']){
    const l = pf === 'tous' ? list : list.filter(r => r.pf === pf);
    const pos = l.filter(r => r.Mp > 0);
    const o = { n: l.length, nMpositif: pos.length };
    for(const Kv of ['K1', 'K2', 'K3']){
      o['battu' + Kv] = l.reduce((s, r) => s + (r.R > Kof(r, 'p', Kv)), 0) / l.length;
      o['med' + Kv + 'surM'] = medianOf(pos.map(r => Kof(r, 'p', Kv) / r.Mp));
      const c = {H:0, M:0, K:0};
      l.forEach(r => { const K = Kof(r, 'p', Kv); const T = median3(r.H, r.Mp, K); if(T === r.Mp) c.M++; else if(T === r.H) c.H++; else c.K++; });
      o['cible' + Kv] = {H: c.H/l.length, M: c.M/l.length, K: c.K/l.length};
    }
    o.battuM = l.reduce((s, r) => s + (r.R > r.Mp), 0) / l.length;
    o.battuH = l.reduce((s, r) => s + (r.R > r.H), 0) / l.length;
    o.medRho = medianOf(l.map(r => r.rho));
    o.p10Rho = (() => { const b = l.map(r => r.rho).sort((x, y) => x - y); return b[Math.floor(b.length*0.1)]; })();
    o.p90Rho = (() => { const b = l.map(r => r.rho).sort((x, y) => x - y); return b[Math.floor(b.length*0.9)]; })();
    out[pf] = o;
  }
  return out;
}

// Tiers d'information : M' − M (variante Mv) classé dans chaque table × phase × semestre × profil.
function tiers(list, Mv, Kv, k){
  const g = {};
  list.forEach(r => { const key = `${r.tb}|${r.ph}|${r.sem}|${r.pf}`; (g[key] || (g[key] = [])).push(r); });
  const T = new Map();
  for(const key in g){
    const l = g[key].slice().sort((a, b) => (a.Mq - Mof(a, Mv).M) - (b.Mq - Mof(b, Mv).M));
    l.forEach((r, i) => T.set(r, Math.min(2, Math.floor(3 * i / l.length))));
  }
  const res = { ensemble: compte(list, r => classer(r, Mv, Kv, k, FL, 'H0'), CL) };
  for(let t=0;t<3;t++){
    const lt = list.filter(r => T.get(r) === t);
    const c = compte(lt, r => classer(r, Mv, Kv, k, FL, 'H0'), CL);
    c.ecartMoyen = lt.length ? lt.reduce((s, r) => s + (r.Mq - Mof(r, Mv).M), 0) / lt.length : null;
    res['tiers' + (t+1)] = c;
  }
  return res;
}

// Mesure 6 : population commune (semestres où la règle actuelle a un axe, chiffre d'affaires > 0) pour les trois
// règles, et population entière pour (a) et (b).
function mesure6(list, Mv, Kv, derive){
  const regles = {
    actuelle: r => r.ax,
    a: k => r => { const v = classer(r, Mv, Kv, k, FL, 'H0'); return v === 'zone' ? 'neutre' : (v.endsWith('+') ? 'bon' : 'mauvais'); },
    b: k => r => { const v = classer(r, Mv, Kv, k, FL, 'H0'); return v === 'f+' ? 'bon' : (v === 'f-' ? 'mauvais' : 'neutre'); },
  };
  const pops = { commune: list.filter(r => r.ax), entiere: list };
  const out = {};
  for(const pn in pops){
    const l = pops[pn];
    out[pn] = { n: l.length };
    const fns = { actuelle: regles.actuelle };
    KS.forEach(k => { fns['a_k' + k] = regles.a(k); fns['b_k' + k] = regles.b(k); });
    for(const rn in fns){
      if(pn === 'entiere' && rn === 'actuelle') continue;
      const fn = fns[rn];
      const axe = {bon:0, neutre:0, mauvais:0};
      const der = {eleve:0, tres_eleve:0};
      l.forEach(r => { const a = fn(r); axe[a]++; der.eleve += derive[r.axE][a]; der.tres_eleve += derive[r.axT][a]; });
      for(const a in axe) axe[a] /= l.length;
      out[pn][rn] = { axe, deriveEleve: der.eleve / l.length, deriveTresEleve: der.tres_eleve / l.length };
    }
  }
  return out;
}

module.exports = { groupes, tableauxVerdict, tableauxH1, parProfil, marche, tiers, mesure6, classer, Kof, Mof, KS, FL, CL };
