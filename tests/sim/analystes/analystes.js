// Prototypes des analystes (CONTRAT.md) : modélisateur M (et M' avec positions), marché K1 / K2 / K3, cible, zone,
// verdict. Calcul pur (aucun moteur) : les montants viennent de la table des loyers produite par le vrai moteur
// (__rentTableFor), des taxes (taxSquareCost) et des charges automatiques (__frozenNow).
const { depuisPosition } = require('./plateau');

const TAX_POS = [4, 38];

// st : début de semestre (__startOfSemester) ; table : entrées de loyers ; prob : probabilité d'arrivée par case et par
// lancer (40 valeurs) ; Isem : charges automatiques du semestre par entreprise ; positions : true pour M' (probabilités
// exactes depuis les positions réelles, enquêtes en cours de semestre comprises, et — ronde 2 — vrai total des dés pour
// les services : le montant inscrit à 7 est mis à l'échelle du total qui mène sur la case).
function modele(st, table, prob, Isem, positions){
  const movers = st.cos.map(c => ({id:c.id, pos:c.pos, j: c.inJail ? Math.min(3, c.jtl) : 0}))
    .concat(st.pawns.map(p => ({id:p.id, pos:p.pos, j: p.inJail ? Math.min(3, p.jtl) : 0})));
  const info = {};
  movers.forEach(m => { info[m.id] = { j: m.j, dp: depuisPosition(m.pos, 3 - m.j) }; });
  // Renvoie [E(indicateur × échelle), E(indicateur × échelle²)] pour une arrivée du pion id au tour t sur sq.
  const landE = (id, t, sq, svc) => {
    const x = info[id]; if(t < x.j) return null;
    if(!positions){ const p = prob[sq]; return p ? [p, p] : null; }
    const k = t - x.j;
    if(svc){ const a = x.dp.landDice[k][sq] / 7, b = x.dp.landDice2[k][sq] / 49; return a ? [a, b] : null; }
    const p = x.dp.land[k][sq]; return p ? [p, p] : null;
  };
  const freeP = (id, t) => {
    const x = info[id]; if(t < x.j) return 0;
    return positions ? 1 - x.dp.jailBefore[t - x.j] : 1;
  };
  const out = {};
  st.cos.forEach((c, i) => { out[c.id] = {Er:0, ErPawn:0, ErCo:0, Ep:0, Et:0, S:0, I: Isem ? Isem[i] : 0, v:0}; });
  for(const e of table){
    for(let t=0;t<3;t++){
      const le = landE(e.vid, t, e.pos, e.svc); if(!le) continue;
      const [e1, e2] = le;
      let sumCuts = 0, freeCuts = 0;
      for(const o in e.cuts){
        const amt = e.cuts[o]; sumCuts += amt;
        const f = freeP(o, t); if(!f || !out[o]) continue;
        const mean = f * e1 * amt;
        out[o].Er += mean; out[o].v += f * e2 * amt * amt - mean * mean;
        if(e.vkind === 'pawn') out[o].ErPawn += mean; else out[o].ErCo += mean;
        freeCuts += f * amt;
      }
      if(e.vkind === 'co' && out[e.vid]){
        const payT = freeCuts + Math.max(0, e.pay - sumCuts);
        const mean = e1 * payT;
        out[e.vid].Ep += mean; out[e.vid].v += e2 * payT * payT - mean * mean;
      }
    }
  }
  st.cos.forEach(c => {
    const o = out[c.id];
    for(let t=0;t<3;t++){
      for(const sq of TAX_POS){
        const le = landE(c.id, t, sq, false); if(!le) continue;
        const cost = sq === 4 ? c.tax4 : c.tax38;
        o.Et += le[0] * cost; o.v += le[0] * (1 - le[0]) * cost * cost;
      }
    }
    // Subvention : toujours depuis la position réelle (contrat) ; aucune si une avance est due.
    const q = info[c.id].dp.passGo;
    o.q = q;
    if(!(c.goOwed > 0)){ o.S = 2 * q; o.v += 4 * q * (1 - q); }
    o.M = o.S + o.Er - o.Ep - o.Et - o.I;
    o.sigma = Math.sqrt(Math.max(0, o.v));
  });
  return out;
}

const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

// Verdict à trois analystes (H0) : 'zone', 'n+', 'f+', 'n-', 'f-'.
function verdict(R, H, M, K, sigma, k, plancher){
  const T = median3(H, M, K);
  const z = Math.max(plancher, k * sigma);
  if(Math.abs(R - T) <= z) return 'zone';
  const b = (R > H) + (R > M) + (R > K);
  if(R > T) return b === 3 ? 'f+' : 'n+';
  return b === 0 ? 'f-' : 'n-';
}
// H1 : l'historien s'abstient (deux premiers semestres) ; cible = milieu de M et K ; 2 battus = fort, 1 = normal.
function verdictH1(R, M, K, sigma, k, plancher){
  const T = (M + K) / 2;
  const z = Math.max(plancher, k * sigma);
  if(Math.abs(R - T) <= z) return 'zone';
  const b = (R > M) + (R > K);
  if(R > T) return b === 2 ? 'f+' : 'n+';
  return b === 0 ? 'f-' : 'n-';
}
// Référence symétrique : M' seul comme cible ; '+' ou '-' hors zone.
function verdictRef(R, Mq, sq, k, plancher){
  const z = Math.max(plancher, k * sq);
  if(Math.abs(R - Mq) <= z) return 'zone';
  return R > Mq ? '+' : '-';
}

module.exports = { modele, verdict, verdictH1, verdictRef, median3 };
