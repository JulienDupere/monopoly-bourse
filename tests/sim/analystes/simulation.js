// Suites de semestres sur les situations posées, par le vrai moteur ; à chaque début de semestre, les trois analystes.
const { seedOf } = require('./rng');
const { modele } = require('./analystes');
const { profilDe, TRANSITION_HOUSES, VIVANT_ACTEURS } = require('./situations');

const Y1 = (r, g) => 3 * (r - g) / (1 + g);

function sample(dist, u){
  let acc = 0;
  for(let k=0;k<dist.length;k++){ acc += dist[k]; if(u < acc) return k; }
  return dist.length - 1;
}

// opts : { tb, ph, rot, N (suites par variante), variants ('base' | 'transition' | 'vivant'), nSem, judge (semestres
// jugés, indices 0..3), atGo (pions à GO au départ), seedLabel, records (false : pas d'enregistrement de verdict) }.
async function runSituation(eng, ctx, spec, opts, sinks){
  await eng.S.__setup(spec);
  const settings = eng.json(`({r: state.settings.discountRate, g: state.settings.growthRate})`);
  const y1 = Y1(settings.r, settings.g);
  // Le modélisateur regarde le parc au début de chaque semestre : loyers recalculés terrain par terrain dès qu'un
  // terrain (ou son groupe) change, charges automatiques recalculées dès que les hypothèques changent ; le hasard du
  // moteur est mis de côté pendant ces calculs, les suites restent identiques d'une variante à l'autre.
  const cacheP = new Map(), cacheI = new Map();
  let otherCats = 0, calculs = 0;
  async function tableNow(){
    const sigs = eng.S.__propSigs();
    const names = eng.json(`state.properties.map(p=>p.name)`);
    const missing = [];
    sigs.forEach((s, k) => { if(!cacheP.has(s)) missing.push(k); });
    if(missing.length){
      const rs = eng.rng.getState();
      const entries = await eng.S.__rentTableFor(missing.map(k => names[k]));
      eng.rng.setState(rs);
      missing.forEach(k => cacheP.set(sigs[k], entries.filter(e => e.name === names[k])));
      otherCats += entries.reduce((s, e) => s + e.other, 0); calculs++;
    }
    const t = []; sigs.forEach(s => { for(const e of cacheP.get(s)) t.push(e); });
    return t;
  }
  function chargesNow(s){
    const key = eng.S.__mortgageSig() + '|' + s;
    let v = cacheI.get(key);
    if(!v){ const rs = eng.rng.getState(); v = eng.S.__frozenNow(); eng.rng.setState(rs); cacheI.set(key, v); }
    return v;
  }
  eng.S.__save();
  const nSem = opts.nSem;
  const seizures = {}, acts = {maison:0, terrain:0};
  for(const va of opts.variants){
    seizures[va] = 0;
    const phv = opts.ph + (va === 'transition' ? '-T' : va === 'vivant' ? '-V' : '');
    for(let i=0;i<opts.N;i++){
      eng.S.__restore();
      eng.rng.seed(seedOf(opts.seedLabel + (va === 'vivant' ? '|V' : ''), i));
      if(!opts.atGo){
        const cp = spec.names.map(() => sample(ctx.statPos, eng.rng.random()));
        const pp = []; for(let k=0;k<spec.pawns;k++) pp.push(sample(ctx.statPos, eng.rng.random()));
        eng.S.__setPositions(cp, pp);
      }
      const mort0 = eng.S.__mortgageSig();
      let seized = false;
      for(let s=0;s<nSem;s++){
        if(va === 'transition' && s === 3) eng.S.__addHouses(0, TRANSITION_HOUSES);
        if(va === 'vivant' && s >= 1) eng.S.__vivant(VIVANT_ACTEURS).forEach(a => { acts[a[1]]++; });
        const st = eng.S.__startOfSemester();
        const tab = await tableNow();
        const Isem = chargesNow(s);
        eng.S.__track = [];
        for(let t=0;t<3;t++) await eng.S.__tour();
        const end = eng.S.__endOfSemester(s);
        const track = eng.S.__track; eng.S.__track = null;
        if(eng.S.__mortgageSig() !== mort0) seized = true;
        const mP = modele(st, tab, ctx.probPP, Isem, false);
        const mS = modele(st, tab, ctx.probExact, Isem, false);
        const mQ = modele(st, tab, null, Isem, true);
        const rentBy = {};
        track.forEach(([cid, who, amt]) => { const o = rentBy[cid] || (rentBy[cid] = {pawn:0, co:0}); o[who === 'pawn' ? 'pawn' : 'co'] += amt; });
        const margins = {};
        end.forEach(e => { margins[e.id] = e.rev > 1e-9 ? (e.rev - e.exp)/e.rev : (e.exp > 0 ? -1 : 0); });
        const sumCap = st.cos.reduce((a, c) => a + c.price * c.shares, 0);
        const sumMp = st.cos.reduce((a, c) => a + mP[c.id].M, 0);
        const sumMs = st.cos.reduce((a, c) => a + mS[c.id].M, 0);
        const perf = st.cos.map(c => c.priceBack > 0 ? c.price / c.priceBack : 1);
        const meanPerf = perf.reduce((a, b) => a + b, 0) / perf.length;
        st.cos.forEach((c, idx) => {
          const e = end[idx]; const pf = profilDe(idx);
          const rb = rentBy[c.id] || {pawn:0, co:0};
          // Variante transition : seul le 4e semestre diffère de la base (mêmes dés avant), lui seul est compté.
          if(sinks.semestre && (va !== 'transition' || s === 3))
            sinks.semestre({tb: opts.tb, ph: phv, pf, s, R: e.R, mP: mP[c.id], mS: mS[c.id], mQ: mQ[c.id], rent: rb, cats: e.cats});
          if(!opts.judge.includes(s) || !sinks.record) return;
          if(va === 'transition' && s !== 3) return;
          const pct = eng.S.croissanceMarginPercentile(c.id, margins);
          const cap = c.price * c.shares;
          sinks.record({
            tb: opts.tb, ph: phv, va, sem: s + 1, i, c: idx, pf, rot: opts.rot, ty: c.type + (c.tier ? '/' + c.tier : ''), seized,
            R: e.R, rev: e.rev, exp: e.exp, old: e.oldTier, ax: e.axis, H: c.H, hb: c.Hboot,
            Mp: mP[c.id].M, sp: mP[c.id].sigma, Ms: mS[c.id].M, ss: mS[c.id].sigma, Mq: mQ[c.id].M, sq: mQ[c.id].sigma,
            cap, K1: cap * y1, sumCap, sumMp, sumMs, rho: meanPerf > 0 ? perf[idx] / meanPerf : 1,
            mpct: pct, axE: eng.S.croissanceMarginAxis(pct, 'eleve'), axT: eng.S.croissanceMarginAxis(pct, 'tres_eleve'),
          });
        });
      }
      if(seized) seizures[va]++;
    }
  }
  return { y1, otherCats, seizures, calculsTables: calculs, acts };
}

module.exports = { runSituation };
