// Test — section 323 (lot moteur) : trois analystes (historien, modélisateur, marché), cible, zone acceptable, verdict
// hors zone (contrat docs/contrats/section-323-analystes.md, sections 1, 2, 3 et 5), avec la ronde de corrections
// (C1 intérêts hypothécaires rejugés, C2 gel après les enchères, C3 marché absent à moins de 2 entreprises, C4 calcul
// par tour avec les enquêtes ouvertes pendant le semestre).
//   A. Chaque fonction sur des chiffres calculés à la main : chaîne du plateau et tables PAR TOUR (énumération de
//      toutes les suites de dés, à part), subvention selon la position, un terrain et un visiteur, copropriété,
//      hypothèque (loyer et intérêts de fin d'année, lot regroupé), enquête, pion neutre, service, swap de loyer,
//      historien, marché, cible à 3, 2 et 1 analystes, zone au plancher et au-dessus, verdicts des cinq sortes, égalités.
//   B. Le modélisateur contre une simulation du vrai moteur : situation simple (B1) et situation chargée par le vrai
//      performRollForAllCompanies (B2 : hypothèque, copropriété, aéroports, services, pions neutres, case 30 active).
//   C. Les moments : provisoire pendant la fenêtre, figé au premier lancer (trois chemins), après les enchères du même
//      lancer, même si toutes les entreprises sont enquêtées ; aucun verdict sans chiffres figés ; verdict appliqué une
//      seule fois ; bénéfice jugé (intérêts hypothécaires rejugés : remboursement après le gel, prêteur) ; axe des
//      analystes des Croissance. Décisions du 2026-11-17 : tailles 2 et 5 (D1) ; dans la zone, 0 ou 1 cube du côté de
//      l'écart (D2) ; cubes de l'émission et du rachat d'actions au sac trading (D3).
//   D. Monnaie conservée, aucun appel au hasard dans le calcul, partie ancienne migrée sans erreur.
//   E. Versions cassées exprès (option transform) : chacune doit être attrapée par au moins un scénario.
// Lancer depuis la racine du dépôt :  node tests/section323.test.js
const { loadEngine, near } = require('./helpers/engine');

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}

// --- Références indépendantes du moteur ----------------------------------------------------------------------
const DICE = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
const P = r => DICE[r] / 36;
// Loi stationnaire de la position d'un pion libre avant son lancer (chaîne des lancers joués, 30 renvoie en 10) et
// fréquence d'arrivée par lancer joué (même définition que tests/sim/analystes/plateau.js), recalculées ici.
function chain(){
  let pi = new Array(40).fill(1/40);
  for(let it = 0; it < 5000; it++){
    const nx = new Array(40).fill(0);
    for(let k = 0; k < 40; k++) for(let r = 2; r <= 12; r++){ let d = (k + r) % 40; if(d === 30) d = 10; nx[d] += pi[k] * P(r); }
    let diff = 0; for(let k = 0; k < 40; k++) diff += Math.abs(nx[k] - pi[k]);
    pi = nx; if(diff < 1e-15) break;
  }
  const land = new Array(40).fill(0);
  for(let k = 0; k < 40; k++) for(let r = 2; r <= 12; r++) land[(k + r) % 40] += pi[k] * P(r);
  return { pi, land };
}
const { pi: PI, land: FREQ } = chain();
// Tables par tour (3 tours) par ÉNUMÉRATION de toutes les suites de dés (le moteur, lui, propage une distribution) :
// arrive[t][case], free[t] = probabilité de ne pas être sous enquête au tour t. Arrivé sur 30 au tour t : case 10,
// enquête aux tours t+1 … t+skip, rejoue ensuite. Départ : loi PI (pion libre) ou case 10 (pion qui sort d'enquête).
function turnRef(skip, fromJail){
  const arrive = [0, 1, 2].map(() => new Array(40).fill(0)), free = [0, 0, 0];
  (function start(){
    function walk(pos, t, w, wait){
      if(t === 3 || !w) return;
      if(wait > 0) return walk(pos, t + 1, w, wait - 1);
      free[t] += w;
      for(let r = 2; r <= 12; r++){
        const d = (pos + r) % 40, wr = w * P(r);
        arrive[t][d] += wr;
        if(d === 30) walk(10, t + 1, wr, skip); else walk(d, t + 1, wr, 0);
      }
    }
    if(fromJail) walk(10, 0, 1, 0); else for(let k = 0; k < 40; k++) if(PI[k]) walk(k, 0, PI[k], 0);
  })();
  return { arrive, free };
}
const TT = { 3: { free: turnRef(3, false), jail: turnRef(3, true) }, 1: { free: turnRef(1, false), jail: turnRef(1, true) } };
// Calendrier d'un pion : j tours d'enquête restants, puis les tables décalées.
function sched(j, skip = 3){
  const T = j > 0 ? TT[skip].jail : TT[skip].free;
  return { a: (t, pos) => t < j ? 0 : T.arrive[t - j][pos], f: t => t < j ? 0 : T.free[t - j] };
}
const FREE = sched(0);
// Flux « le visiteur V arrive sur pos, le propriétaire O est libre, montant m » sur les 3 tours : espérance et
// variance (Bernoulli de probabilité a × f par tour, arrivées traitées comme indépendantes).
function flow(V, O, pos, m){
  let e = 0, v = 0;
  for(let t = 0; t < 3; t++){ const p = V.a(t, pos) * (O ? O.f(t) : 1); e += p * m; v += p * (1 - p) * m * m; }
  return { e, v };
}
// Passage par GO en n lancers depuis pos : énumération de toutes les suites de dés. Arrivée sur 30 : le pion part en
// 10 et saute `skip` lancers.
function passGoBrute(pos, nRolls, skip){
  let q = 0;
  (function walk(p, t, w, passed, wait){
    if(t === nRolls){ if(passed) q += w; return; }
    if(wait > 0) return walk(p, t + 1, w, passed, wait - 1);
    for(let r = 2; r <= 12; r++){
      const d = (p + r) % 40, pg = passed || d < p;
      if(d === 30) walk(10, t + 1, w * P(r), pg, skip); else walk(d, t + 1, w * P(r), pg, 0);
    }
  })(pos, 0, 1, false, 0);
  return q;
}

// --- Partie d'essai ------------------------------------------------------------------------------------------
// Hasard contrôlé : ctl.count compte les appels à Math.random ; ctl.seed > 0 rend le hasard reproductible.
async function partie(opts = {}){
  const ctl = { count: 0, seed: opts.seed || 0 };
  let s = ctl.seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math);
  M.random = () => { ctl.count++; return ctl.seed ? rnd() : Math.random(); };
  const eng = loadEngine({ globals: { Math: M, alert: () => {} }, transform: opts.transform });
  const names = opts.names || ['Alice', 'Bob', 'Chloe'];
  const ids = await eng.newGame(names, opts.types || names.map(() => 'garp'), 50, 1000);
  eng.ctl = ctl; eng.ids = ids;
  // Plateau vide, pions à GO, rien d'hypothéqué ni d'échangé ; A, B, C = entreprises dans l'ordre de création.
  eng.run(`
    state.properties.forEach(p=>{ p.owners = []; p.houses = 0; p.mortgages = []; p.insurance = null; p.subInsurance = null; });
    state.rentSwaps = []; state.revenueSwaps = []; state.neutralPawns = state.neutralPawns || [];
    state.companies.forEach(c=>{ c.position = 0; c.inJail = false; c.jailTurnsLeft = 0; c.goAdvancesOwed = 0; });
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2] || null;
    globalThis.rebind = function(){ globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2] || null; };
    globalThis.prop = function(pos){ return state.properties.find(x=>x.pos===pos); };
    globalThis.own = function(pos, list, houses){ const p = prop(pos); p.owners = list.map(([c, sh])=>({companyId:c.id, share:sh})); p.houses = houses||0; return p; };
    globalThis.addPawn = function(id, pos){ state.neutralPawns.push({id, name:'Neutre '+id, position:pos||0, inJail:false, jailTurnsLeft:0}); };
  `);
  return eng;
}
const live = (eng, who) => eng.json(`analystForecastsLive()[${who}.id]`);
const taxOf = (eng, who) => eng.json(`[taxSquareCost(4, ${who}.id), taxSquareCost(38, ${who}.id)]`);
// Taxes attendues sur le calendrier S (pion libre par défaut), et leur variance.
function taxes(c4, c38, S = FREE){
  let e = 0, v = 0;
  for(let t = 0; t < 3; t++) for(const [pos, c] of [[4, c4], [38, c38]]){ const a = S.a(t, pos); e += a * c; v += a * (1 - a) * c * c; }
  return { e, v };
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const sameTable = (x, y, eps = 1e-12) => x.free.every((v, t) => close(v, y.free[t], eps)) && x.arrive.every((row, t) => row.every((v, d) => close(v, y.arrive[t][d], eps)));

// --- Scénarios -----------------------------------------------------------------------------------------------
const SCENARIOS = [];
function scenario(key, title, fn){ SCENARIOS.push({ key, title, fn }); }

scenario('freq', 'A1. Chaîne du plateau, tables par tour (C4), subvention selon la position', async (tf) => {
  const eng = await partie({ transform: tf });
  const f = eng.json(`boardLandingFrequencies()`);
  ok(f.length === 40 && f.every((x, i) => close(x, FREQ[i], 1e-12)), `boardLandingFrequencies = chaîne recalculée à part (40 cases, écart ≤ 1e-12 ; case 24 : ${f[24].toFixed(6)})`);
  ok(near(f.reduce((a, b) => a + b, 0), 1, 1e-9) && near(f[30], FREQ[30], 1e-12), 'somme des fréquences = 1 (arrivée sur 30 comptée sur 30)');
  eng.run(`boardLandingFrequencies()[24] = 99;`);
  ok(close(eng.run(`boardLandingFrequencies()[24]`), FREQ[24], 1e-12), 'la table rendue est une copie (la mémoire n\'est pas abîmée par un appelant)');
  // Tables par tour : énumération de toutes les suites de dés (ici) contre la propagation du moteur.
  for(const jt of [3, 1, 0]){
    eng.run(`state.settings.jailTurns = ${jt};`);
    const skip = Math.max(1, jt);
    const tf0 = eng.json(`analystTurnTables(false)`), tj0 = eng.json(`analystTurnTables(true)`);
    ok(sameTable(tf0, TT[skip].free) && sameTable(tj0, TT[skip].jail),
      `jailTurns = ${jt} : tables par tour = énumération des dés (pion libre : libre ${tf0.free.map(x => x.toFixed(4)).join(' / ')} ; sortie d'enquête : ${tj0.free.map(x => x.toFixed(4)).join(' / ')})`);
  }
  eng.run(`state.settings.jailTurns = 3;`);
  const T = TT[3].free;
  ok(close(T.free[1], 1 - FREQ[30], 1e-12) && close(T.free[2], 1 - FREQ[30] - T.arrive[1][30], 1e-12) && close(T.arrive[0][39], FREQ[39], 1e-12),
    `pion libre (3 tours d'enquête) : tour 0 = loi par lancer joué ; libre au tour 1 = 1 − π(30) = ${T.free[1].toFixed(6)} ; au tour 2 = ${T.free[2].toFixed(6)}`);
  // Un pion envoyé en enquête au tour 0 (case 10) ne lance plus au tour 1 : les arrivées partant de 10 (cases 12 à 22)
  // perdent π(30) × P(dés) ; la case 39, hors d'atteinte de 10, ne change pas.
  ok(close(T.arrive[1][19], FREQ[19] - FREQ[30] * P(9), 1e-12) && close(T.arrive[1][39], FREQ[39], 1e-12),
    `tour 1 : arrivée sur 19 = π(19) − π(30) × P(9) = ${T.arrive[1][19].toFixed(6)} (au lieu de ${FREQ[19].toFixed(6)}) ; sur 39, inchangée`);
  // Subvention : 2 × probabilité de passer par GO, depuis la position réelle.
  for(const [pos, label] of [[0, 'case 0 (GO) : 36 cases au plus en 3 lancers'], [38, 'case 38 : tout lancer passe par GO'], [33, 'case 33'], [28, 'case 28'], [21, 'case 21']]){
    eng.run(`A.position = ${pos};`);
    const L = live(eng, 'A');
    const q = passGoBrute(pos, 3, 3);
    ok(close(L.parts.subsidy, 2 * q, 1e-12), `subvention depuis la ${label} : 2 × ${q.toFixed(6)} = ${L.parts.subsidy.toFixed(6)}`);
  }
  // Irrégularité de la subvention : σ² = taxes + 4 q (1 − q) (rien d'autre : aucun terrain).
  eng.run(`A.position = 33;`);
  const q33 = passGoBrute(33, 3, 3), t33 = taxes(...taxOf(eng, 'A'));
  ok(close(live(eng, 'A').sigma, Math.sqrt(t33.v + 4 * q33 * (1 - q33)), 1e-9), `case 33 : σ² = taxes + 4 q (1 − q), q = ${q33.toFixed(6)} (σ = ${live(eng, 'A').sigma.toFixed(6)})`);
  // jailTurns = 1 : le pion envoyé en enquête rejoue dans le semestre (2e lancer sauté seulement).
  eng.run(`state.settings.jailTurns = 1;`);
  for(const pos of [20, 24, 28]){
    eng.run(`A.position = ${pos};`);
    const q = passGoBrute(pos, 3, 1);
    ok(close(live(eng, 'A').parts.subsidy, 2 * q, 1e-12), `jailTurns = 1, case ${pos} : retour d'enquête au bon lancer, S = 2 × ${q.toFixed(6)}`);
  }
  eng.run(`state.settings.jailTurns = 3; A.position = 38;`);
  let L = live(eng, 'A');
  const t = taxes(...taxOf(eng, 'A'));
  ok(close(L.parts.subsidy, 2, 1e-12) && close(L.sigma, Math.sqrt(t.v), 1e-9), `case 38 : S = 2, aucune irrégularité de subvention (σ = taxes seules ${Math.sqrt(t.v).toFixed(6)})`);
  eng.run(`A.goAdvancesOwed = 1;`);
  L = live(eng, 'A');
  const t2 = taxes(...taxOf(eng, 'A')); // l'avance due compte comme une dette : la valeur, donc l'impôt, change
  ok(L.parts.subsidy === 0 && close(L.sigma, Math.sqrt(t2.v), 1e-9), 'avance de subvention due : S = 0 (le passage rembourse l\'avance)');
  eng.run(`A.goAdvancesOwed = 0; A.position = 10; A.inJail = true; A.jailTurnsLeft = 2;`);
  ok(live(eng, 'A').parts.subsidy === 0, 'pion enquêté (2 tours restants) en case 10 : 1 lancer, GO hors d\'atteinte, S = 0');
});

scenario('loyer', 'A2. Un terrain et un visiteur, copropriété, service (calcul par tour)', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  const R = 6;
  eng.run(`own(39, [[A, 100]], 2);`);
  const LA = live(eng, 'A'), LB = live(eng, 'B');
  const tA = taxes(...taxOf(eng, 'A')), tB = taxes(...taxOf(eng, 'B'));
  const fl = flow(FREE, FREE, 39, R);
  ok(close(LA.parts.rentsIn, fl.e) && LA.parts.rentsOut === 0, `A reçoit Σ_t a_B(t, 39) × f_A(t) × 6 = ${fl.e.toFixed(6)} (Bleu foncé 2, 2 maisons ; 3 × π × 6 = ${(3 * FREQ[39] * R).toFixed(6)} avant)`);
  ok(close(LA.m, fl.e - tA.e) && close(LB.m, -fl.e - tB.e), `M(A) = loyers − taxes = ${LA.m.toFixed(6)} ; M(B) = −loyers − taxes = ${LB.m.toFixed(6)}`);
  ok(close(LA.sigma, Math.sqrt(fl.v + tA.v)), `σ(A)² = Σ_t a f (1 − a f) 6² + taxes : σ = ${LA.sigma.toFixed(6)}`);
  ok(close(LA.parts.taxes, tA.e) && LA.parts.subsidy === 0 && LA.parts.charges === 0 && LA.parts.mortgage === 0, 'parts de M : taxes par tour, aucune subvention depuis GO, aucune charge');
  // Copropriété à trois : A 60 %, B 40 % ; un 3e visiteur.
  const eng3 = await partie({ transform: tf });
  eng3.run(`own(39, [[A, 60], [B, 40]], 2);`);
  const a = live(eng3, 'A'), b = live(eng3, 'B'), c = live(eng3, 'C');
  const f6 = flow(FREE, FREE, 39, 0.6 * R), f4 = flow(FREE, FREE, 39, 0.4 * R), f10 = flow(FREE, FREE, 39, R);
  ok(close(a.parts.rentsIn, 2 * f6.e) && close(a.parts.rentsOut, f4.e),
    `copropriété : A reçoit 60 % de B et de C (${a.parts.rentsIn.toFixed(6)}), paie 40 % à B en visitant (${a.parts.rentsOut.toFixed(6)})`);
  ok(close(b.parts.rentsIn, 2 * f4.e) && close(b.parts.rentsOut, f6.e) && close(c.parts.rentsOut, f10.e),
    'copropriété : B reçoit 40 % de A et de C, paie 60 % ; C paie le loyer entier');
  const tA3 = taxes(...taxOf(eng3, 'A'));
  ok(close(a.sigma, Math.sqrt(2 * f6.v + f4.v + tA3.v)),
    'copropriété : σ(A)² = [(0,6 × 6)² (B) + (0,6 × 6)² (C) + (0,4 × 6)² (A visite)] par tour + taxes');
  // Service : total des dés attendu de 7.
  const eng4 = await partie({ names: ['Alice', 'Bob'], transform: tf });
  eng4.run(`own(12, [[A, 100]], 0);`);
  const fs = flow(FREE, FREE, 12, 0.04 * 7);
  ok(close(live(eng4, 'A').parts.rentsIn, fs.e), `service (1 sur 2, ×0,04) : Σ_t a f × 0,04 × 7 = ${fs.e.toFixed(6)}`);
});

scenario('hypotheque', 'A3. Hypothèque : part sans loyer, intérêts de fin d\'année (à part), lot regroupé', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  const R = 6;
  eng.run(`own(39, [[A, 100]], 2).mortgages = [{companyId:A.id, principal:4, rate:0.1, lenderId:B.id}];`);
  let a = live(eng, 'A'), b = live(eng, 'B');
  ok(a.parts.rentsIn === 0 && b.parts.rentsOut === 0 && a.parts.charges === 0 && b.parts.charges === 0,
    'semestre 0 (sans fin d\'année) : part hypothéquée sans loyer, B ne paie rien, aucune charge');
  eng.run(`state.gameClock.rollCount = 3;`);
  a = live(eng, 'A'); b = live(eng, 'B');
  ok(close(a.parts.charges, 0.4) && close(b.parts.charges, -0.4), `semestre 1 (fin d'année) : intérêt 4 × 10 % = 0,4 à la charge de A, reçu par le prêteur B (${b.parts.charges})`);
  ok(close(a.parts.mortgage, 0.4) && close(b.parts.mortgage, -0.4), 'intérêts hypothécaires gardés à part (parts.mortgage : +0,4 payé, −0,4 reçu), pour être rejugés à la clôture');
  ok(close(a.m, a.parts.subsidy + a.parts.rentsIn - a.parts.rentsOut - a.parts.taxes - a.parts.charges), 'M = S + reçus − payés − taxes − I');
  eng.run(`state.gameClock.rollCount = 6;`);
  ok(live(eng, 'A').parts.charges === 0 && live(eng, 'A').parts.mortgage === 0, 'semestre 2 (sans fin d\'année) : plus d\'intérêt');
  eng.run(`state.settings.mortgageRentContinues = true;`);
  ok(close(live(eng, 'A').parts.rentsIn, flow(FREE, FREE, 39, R).e), 'réglage « le loyer continue » : la part hypothéquée rapporte');
  // Lot regroupé (37 et 39) : processMortgageInterest ne facture que l'hôte du lot, même si une copie de l'hypothèque
  // traîne sur l'autre terrain (ancienne donnée) ; le modélisateur doit prévoir exactement ce que le vrai moteur prélève.
  const e2 = await partie({ names: ['Alice', 'Bob'], transform: tf });
  e2.run(`own(37, [[A, 100]], 0); own(39, [[A, 100]], 0); prop(37).groupMergeId = 'L1'; prop(39).groupMergeId = 'L1';
    prop(37).mortgages = [{companyId:A.id, principal:5, rate:0.2, lenderId:'BANK'}]; prop(39).mortgages = [{companyId:A.id, principal:5, rate:0.2, lenderId:'BANK'}];
    state.gameClock.rollCount = 3; A.cash = 500;`);
  const host = e2.json(`lotMortgageHost('L1').pos`);
  const real = e2.json(`(function(){ const snap = JSON.stringify(state), L = state.finLedger.length; processMortgageInterest();
    const paid = -state.finLedger.slice(L).filter(e=>e.companyId===A.id && e.category==='mortgage_interest_expense').reduce((s,e)=>s+e.amount, 0);
    state = JSON.parse(snap); rebind(); return paid; })()`);
  const la = live(e2, 'A');
  ok(close(real, 1) && close(la.parts.mortgage, real), `lot regroupé (hôte : case ${host}) : intérêt prévu ${la.parts.mortgage} = intérêt prélevé par processMortgageInterest ${real} (une fois, pas par terrain)`);
});

scenario('enquete', 'A4. Enquête : propriétaire et visiteur (tours restants connus, puis tables par tour)', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  const R = 6;
  eng.run(`own(39, [[A, 100]], 2); A.inJail = true; A.jailTurnsLeft = 2; A.position = 10;`);
  let a = live(eng, 'A'), b = live(eng, 'B');
  const SA = sched(2), fA = flow(FREE, SA, 39, R);
  ok(close(a.parts.rentsIn, fA.e) && close(b.parts.rentsOut, fA.e) && close(fA.e, TT[3].free.arrive[2][39] * R, 1e-12),
    `A enquêtée (2 tours) : sa part ne rapporte qu'au 3e tour (a_B(2, 39) × 6 = ${a.parts.rentsIn.toFixed(6)}), B ne paie que ce tour-là`);
  const tA = taxes(...taxOf(eng, 'A'), SA);
  ok(close(a.parts.taxes, tA.e) && tA.e === 0, 'A enquêtée : un seul tour, depuis la case 10 où l\'enquête l\'a mise (cases 4 et 38 hors d\'atteinte : taxes 0)');
  eng.run(`A.inJail = false; A.jailTurnsLeft = 0; B.inJail = true; B.jailTurnsLeft = 1; B.position = 10;`);
  a = live(eng, 'A');
  const fB1 = flow(sched(1), FREE, 39, R);
  ok(close(a.parts.rentsIn, fB1.e), `B enquêtée (1 tour) : 2 tours de visite depuis la case 10 (${fB1.e.toFixed(6)})`);
  eng.run(`B.jailTurnsLeft = 0;`);
  ok(close(live(eng, 'A').parts.rentsIn, fB1.e), 'B enquêtée avec 0 tour restant : elle saute quand même son prochain lancer');
  eng.run(`B.jailTurnsLeft = 5;`);
  ok(live(eng, 'A').parts.rentsIn === 0, 'B enquêtée (5 tours) : aucune visite ce semestre');
});

scenario('pion', 'A5. Pion neutre et swap de loyer', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  const R = 6, fl = flow(FREE, FREE, 39, R);
  eng.run(`own(39, [[A, 100]], 2); addPawn('pw1');`);
  let a = live(eng, 'A'), b = live(eng, 'B');
  ok(close(a.parts.rentsIn, 2 * fl.e) && close(b.parts.rentsOut, fl.e), `pion neutre : A reçoit de B et du pion (${(2 * fl.e).toFixed(6)}), seul B paie (la banque paie pour le pion)`);
  eng.run(`state.neutralPawns[0].inJail = true; state.neutralPawns[0].jailTurnsLeft = 3;`);
  ok(close(live(eng, 'A').parts.rentsIn, fl.e), 'pion neutre enquêté (3 tours) : il ne visite pas ce semestre');
  eng.run(`state.neutralPawns[0].jailTurnsLeft = 1;`);
  ok(close(live(eng, 'A').parts.rentsIn, fl.e + flow(sched(1), FREE, 39, R).e), 'pion neutre enquêté (1 tour) : 2 tours de visite depuis la case 10');
  // Swap de loyer à budget : la part de A va au partenaire B (sauf quand B visite) ; le budget n'est pas consommé.
  const eng2 = await partie({ transform: tf });
  eng2.run(`own(39, [[A, 100]], 2);
    state.rentSwaps.push({id:'sw', companyA:A.id, companyB:B.id, generalA:false, generalB:true, propA:prop(39).id, budgetMode:true, capA:null, capB:null, budgetCapA:50, budgetCapB:50, disbursedA:0, disbursedB:0});`);
  const before = eng2.run(`JSON.stringify(state.rentSwaps)`);
  a = live(eng2, 'A'); b = live(eng2, 'B');
  const c = live(eng2, 'C');
  ok(close(a.parts.rentsIn, fl.e) && close(b.parts.rentsIn, fl.e) && close(c.parts.rentsOut, fl.e),
    'swap à budget : A garde le loyer payé par B (partenaire), B reçoit celui payé par C');
  ok(eng2.run(`JSON.stringify(state.rentSwaps)`) === before, 'le calcul ne consomme pas le budget du swap (état inchangé)');
});

// Montant par arrivée selon le modélisateur, contre ce que le VRAI settlePropertyRent inscrit pour une arrivée de B
// (seul visiteur : C est enquêtée pour tout le semestre et A ne visite que ses propres terrains).
scenario('parite', 'A8. Par arrivée : modélisateur = écritures du vrai settlePropertyRent (13 situations)', async (tf) => {
  const cases = [
    ['A seul, 2 maisons', `own(39, [[A, 100]], 2);`, 39],
    ['A 60 %, C 40 % (C enquêtée : sa part ne rapporte rien)', `own(39, [[A, 60], [C, 40]], 2);`, 39],
    ['A 70 %, banque 30 % (la banque perçoit)', `own(39, [[A, 70]], 1);`, 39],
    ['A 70 %, banque 30 % (la banque ne perçoit pas)', `own(39, [[A, 70]], 1); state.settings.bankCollectsRent = false;`, 39],
    ['A hypothéquée (60 %), B 10 %, banque 30 % : B ne paie que la part de la banque', `own(39, [[A, 60], [B, 10]], 2); prop(39).mortgages = [{companyId:A.id, principal:2, rate:0.1, lenderId:'BANK'}];`, 39],
    ['ABS : moitié de la part cédée, senior détenue par C', `own(39, [[A, 100]], 2); state.revenueSwaps.push({id:'abs1', sellerId:A.id, propertyIds:[prop(39).id], cededPctOfShare:0.5, seniorCapTotal:10, seniorPaidSoFar:0, seniorRaised:5, seniorHolders:[{holderType:'company', holderId:C.id, amount:5}], juniorHolders:[]});`, 39],
    ['swap de loyer : la part de A va à C (plafond 1 par arrivée)', `own(39, [[A, 100]], 2); state.rentSwaps.push({id:'sw', companyA:A.id, companyB:C.id, generalA:false, generalB:true, propA:prop(39).id, budgetMode:false, yearsRemaining:2, capA:1, capB:null});`, 39],
    ['REIT : 10 % réservés, moitié des parts vendues (5 % du loyer au fonds), 10 % à la banque', `state.settings.features.etf = true; own(39, [[A, 80]], 2); prop(39).etfReservedPct = 10;
      state.etfs.find(x=>x.id==='rue4').opened = true; C.etfHoldings = {rue4: 50};`, 39],
    ['deux aéroports à A', `own(5, [[A, 100]], 0); own(15, [[A, 100]], 0);`, 5],
    ['deux aéroports à A, sa part du 5 hypothéquée : B ne paie rien au 5', `own(5, [[A, 100]], 0); own(15, [[A, 100]], 0); prop(5).mortgages = [{companyId:A.id, principal:1, rate:0.1, lenderId:'BANK'}];`, 5],
    ['aéroport, 10 % réservés au REIT, aucune part vendue : rien de plus à payer', `state.settings.features.etf = true; own(5, [[A, 80]], 0); prop(5).etfReservedPct = 10;`, 5],
    ['service (dés = 7)', `own(12, [[A, 100]], 0); own(28, [[A, 50]], 0);`, 12],
    ['service hypothéqué (part de A au 12)', `own(12, [[A, 100]], 0); own(28, [[A, 50]], 0); prop(12).mortgages = [{companyId:A.id, principal:1, rate:0.1, lenderId:'BANK'}];`, 12],
  ];
  for(const [label, setup, pos] of cases){
    const eng = await partie({ transform: tf });
    eng.run(`${setup} C.inJail = true; C.jailTurnsLeft = 3; B.position = 0;`);
    const model = eng.json(`(function(){ const all = analystForecastsLive(); return state.companies.map(c=>all[c.id].parts); })()`);
    // Montant d'une arrivée de B selon les règles du modélisateur (A libre, C enquêtée).
    const perLanding = eng.json(`(function(){
      const p = prop(${pos}), rc = analystRentCuts(p, B.id, false); const net = {};
      if(!rc) return net;
      const free = rc.cuts.filter(c=>!state.companies.find(x=>x.id===c.ownerId).inJail);
      const payable = free.reduce((s,c)=>s+c.amount, 0) + rc.extra;
      free.forEach(c=>{ const r = analystCutRecipients(p, c.ownerId, B.id, c.amount);
        r.revenue.forEach(([id,a])=>{ net[id] = (net[id]||0) + a; }); if(r.absOut>0) net[c.ownerId] = (net[c.ownerId]||0) - r.absOut;
        r.absIn.forEach(([id,a])=>{ net[id] = (net[id]||0) + a; }); });
      if(payable) net[B.id] = (net[B.id]||0) - payable; return net; })()`);
    const real = eng.json(`(function(){
      const snap = JSON.stringify(state), L = state.finLedger.length; const net = {};
      settlePropertyRent(prop(${pos}), B.id, 7, {skipSave:true});
      state.finLedger.slice(L).forEach(e=>{ const m = FIN_CATEGORIES[e.category]; if(m && m.bucket) net[e.companyId] = (net[e.companyId]||0) + e.amount; });
      state = JSON.parse(snap); rebind();
      return net; })()`);
    const ids = new Set(Object.keys(perLanding).concat(Object.keys(real)));
    const same = [...ids].every(id => near(perLanding[id] || 0, real[id] || 0, 1e-9));
    ok(same, `${label} : par arrivée de B, modèle ${JSON.stringify(perLanding)} = moteur ${JSON.stringify(real)}`);
    // Et le modélisateur complet applique les tables par tour à ce montant (un seul terrain possédé, B seul visiteur).
    if(pos === 39){
      const [a] = model;
      const aNet = perLanding[eng.json(`A.id`)] || 0;
      const fl = flow(FREE, FREE, 39, aNet);
      ok(near(a.rentsIn - a.charges, fl.e, 1e-9), `${label} : modélisateur de A = Σ_t a_B(t) f_A(t) × montant net (${fl.e.toFixed(6)})`);
    }
  }
});

scenario('analystes', 'A6. Historien, marché (C3 : au moins 2 capitalisations positives), cible, zone', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  // Bénéfices passés de A : semestre 0 : 1 ; 1 : 2 ; 2 : 4 ; 3 : −1.
  eng.run(`[[0, 1], [1, 2], [2, 4], [3, -1]].forEach(([s, v])=>logFin(A.id, v>0 ? 'rent_revenue' : 'tax_expense', v, s*3));`);
  ok(eng.json(`[analystHistorian(A, 0), analystHistorian(A, 1)]`).every(x => x === null), 'historien absent aux semestres 0 et 1 (moins de 2 semestres clos)');
  ok(near(eng.run(`analystHistorian(A, 2)`), 1.5), 'semestre 2 : moyenne des 2 semestres clos (1 et 2) = 1,5');
  ok(near(eng.run(`analystHistorian(A, 3)`), 7 / 3), 'semestre 3 : moyenne des 3 derniers (1, 2, 4) = 2,333');
  ok(near(eng.run(`analystHistorian(A, 4)`), 5 / 3), 'semestre 4 : moyenne des 3 derniers (2, 4, −1) = 1,667');
  eng.run(`A.createdAtRoll = 6;`);
  ok(eng.run(`analystHistorian(A, 3)`) === null && near(eng.run(`analystHistorian(A, 4)`), 1.5), 'entreprise créée au semestre 2 : absente au semestre 3, moyenne de 2 au semestre 4');
  eng.run(`A.createdAtRoll = 0; state.finLedgerStartedAtRoll = 6;`);
  ok(eng.run(`analystHistorian(A, 3)`) === null && near(eng.run(`analystHistorian(A, 4)`), 1.5), 'registre financier commencé au semestre 2 : historien absent au semestre 3, moyenne des semestres 2 et 3 au semestre 4');
  eng.run(`state.finLedgerStartedAtRoll = 0;`);
  // Marché : capitalisation × Σ M ÷ Σ capitalisations.
  eng.run(`own(39, [[A, 100]], 2); A.stockPrice = 3; A.totalShares = 10; B.stockPrice = 1; B.totalShares = 10;`);
  const all = eng.json(`analystForecastsLive()`), ids = eng.json(`[A.id, B.id]`);
  const sumM = all[ids[0]].m + all[ids[1]].m;
  ok(close(all[ids[0]].k, 30 * sumM / 40) && close(all[ids[1]].k, 10 * sumM / 40), `marché : K(A) = 30 × ΣM ÷ 40 = ${all[ids[0]].k.toFixed(6)}, K(B) = 10 × ΣM ÷ 40`);
  // C3 : une seule capitalisation positive : K serait exactement M (pas un deuxième avis) ; le marché est absent.
  eng.run(`B.stockPrice = 0;`);
  const one = eng.json(`analystForecastsLive()`);
  ok(one[ids[0]].k === null && one[ids[1]].k === null, `une seule entreprise à capitalisation positive : marché absent pour toutes (sinon K(A) = M(A) = ${one[ids[0]].m.toFixed(6)})`);
  const e3 = await partie({ transform: tf });
  e3.run(`A.stockPrice = 2; A.totalShares = 10; B.stockPrice = 1; B.totalShares = 10; C.stockPrice = 0;`);
  ok(e3.json(`Object.values(analystForecastsLive()).every(f=>typeof f.k==='number')`), '3 entreprises dont 2 à capitalisation positive : marché présent pour les trois');
  eng.run(`A.stockPrice = 0; B.stockPrice = 0;`);
  ok(eng.json(`Object.values(analystForecastsLive()).every(f=>f.k===null)`), 'capitalisations nulles : marché absent');
  // Cible et zone (fonction pure).
  const tz = (h, m, k, s) => eng.json(`analystTargetAndZone(${h}, ${m}, ${k}, ${s})`);
  ok(tz(5, 1, 3, 0).target === 3 && tz(-2, 7, 1, 0).target === 1, 'cible à 3 analystes : la médiane (5, 1, 3 → 3 ; −2, 7, 1 → 1)');
  ok(tz('null', 1, 4, 0).target === 2.5 && tz(2, 6, 'null', 0).target === 4, 'cible à 2 analystes : leur moyenne');
  ok(tz('null', -1.25, 'null', 0).target === -1.25, 'cible à 1 analyste : lui');
  // Section 323 (D4, décision de Julien du 2026-11-17) : zone à 0,35 × σ (avant : 0,5 × σ ; σ = 3 donnait 1,5).
  ok(tz(1, 2, 3, 0).zone === 0.5 && tz(1, 2, 3, 1).zone === 0.5 && tz(1, 2, 3, 1.4).zone === 0.5, 'zone au plancher : 0,5 tant que 0,35 × σ ≤ 0,5 (σ = 0, 1, 1,4)');
  ok(Math.abs(tz(1, 2, 3, 3).zone - 1.05) < 1e-12, 'zone au-dessus du plancher : σ = 3 → 0,35 × 3 = 1,05 (D4 ; avant : 1,5)');
  ok(Math.abs(tz(1, 2, 3, 2).zone - 0.7) < 1e-12, 'zone au-dessus du plancher : σ = 2 → 0,7 (D4 ; avec 0,5 × σ : 1)');
  // Un seul analyste présent dans la partie : cible = M.
  const L = eng.json(`analystForecastFor(A)`);
  ok(L.h === null && L.k === null && L.target === L.m && L.frozen === false && L.verdictPossible === true, 'semestre 0, cours nuls : historien et marché absents, cible = M, chiffres provisoires');
});

scenario('verdict', 'A7. Verdicts des cinq sortes, égalités, cubes', async (tf) => {
  const eng = await partie({ names: ['Alice', 'Bob'], transform: tf });
  const V = (f, R) => eng.json(`analystVerdict(${JSON.stringify(f)}, ${R})`);
  const f3 = { h: 1, m: 2, k: 3, target: 2, zone: 0.5 };
  const cases = [
    [2.5, 'zone', 2, 'borne haute de la zone (2,5 pile)'], [1.5, 'zone', 1, 'borne basse (1,5 pile)'], [2, 'zone', 1, 'sur la cible'],
    [2.75, 'normalUp', 2, 'au-dessus, 2 battus sur 3'], [3.5, 'strongUp', 3, 'au-dessus, 3 sur 3'],
    [1.25, 'normalDown', 1, 'en dessous, 1 battu'], [0.5, 'strongDown', 0, 'en dessous, aucun battu'],
  ];
  for(const [R, v, b, label] of cases){
    const r = V(f3, R);
    ok(r.verdict === v && r.beaten === b && r.of === 3, `${label} : ${v}, ${b} battu(s) sur 3 — obtenu ${r.verdict}, ${r.beaten}`);
  }
  // Égalité avec un analyste : pas battu (strictement au-dessus).
  const fe = { h: 3, m: 2, k: 4, target: 3, zone: 0.5 };
  const r1 = V(fe, 4);
  ok(r1.verdict === 'normalUp' && r1.beaten === 2, 'R = 4 égal au marché (4) : pas battu → 2 sur 3, normal au-dessus');
  const fd = { h: 1, m: 2, k: 0.5, target: 1, zone: 0.25 };
  const r2 = V(fd, 0.5);
  ok(r2.verdict === 'strongDown' && r2.beaten === 0, 'R = 0,5 égal au marché (0,5) : aucun battu → fort en dessous');
  // Deux analystes, un seul.
  ok(V({ h: null, m: 1, k: 3, target: 2, zone: 0.5 }, 4).verdict === 'strongUp', '2 analystes tous battus : fort');
  ok(V({ h: null, m: 1, k: 3, target: 2, zone: 0.5 }, 0).verdict === 'strongDown', '2 analystes, aucun battu : fort');
  ok(V({ h: null, m: 1, k: 3, target: 2, zone: 0.5 }, 2.75).verdict === 'normalUp', '2 analystes divisés (au-dessus de la zone) : normal');
  ok(V({ h: null, m: 1, k: null, target: 1, zone: 0.5 }, 9).verdict === 'normalUp' && V({ h: null, m: 1, k: null, target: 1, zone: 0.5 }, -9).verdict === 'normalDown',
    'un seul analyste : normal, même loin de la zone');
  // Cubes.
  const C = (v, gap) => eng.json(`analystVerdictCubes(${JSON.stringify(v)}, A, ${gap === undefined ? 'undefined' : gap})`);
  const fixe = (c, color, q) => c.color === color && c.qtyMin === q && c.qtyMax === q;
  ok(fixe(C('normalUp'), 'green', 2) && fixe(C('strongUp'), 'green', 5), 'D1 : au-dessus : 2 verts (normal), 5 verts (fort), quantités fixes');
  ok(fixe(C('normalDown'), 'red', 2) && fixe(C('strongDown'), 'red', 5), 'D1 : en dessous : 2 rouges (normal), 5 rouges (fort)');
  ok(eng.json(`[ANALYST_VERDICT_NORMAL_CUBES, ANALYST_VERDICT_STRONG_CUBES, ANALYST_ZONE_CUBES_MIN, ANALYST_ZONE_CUBES_MAX]`).join() === '2,5,0,1', 'constantes : normal 2, fort 5, zone de 0 à 1');
  const zu = C('zone', 0.2), zd = C('zone', -0.2), z0 = C('zone', 0);
  ok(zu.color === 'green' && zu.qtyMin === 0 && zu.qtyMax === 1 && zd.color === 'red' && zd.qtyMin === 0 && zd.qtyMax === 1,
    'D2 : dans la zone au-dessus de la cible : 0 à 1 vert ; en dessous : 0 à 1 rouge');
  ok(z0.color === null && z0.qtyMax === 0 && C('zone').color === null, 'D2 : dans la zone, égalité exacte (ou écart inconnu) : rien');
  // Axe des analystes des Croissance : les cinq sortes de verdict.
  const ax = v => eng.json(`croissanceAnalystAxis({totalRevenue:1}, ${JSON.stringify(v)})`);
  ok(ax('normalUp') === 'bon' && ax('strongUp') === 'bon' && ax('zone') === 'neutre' && ax('normalDown') === 'mauvais' && ax('strongDown') === 'mauvais',
    'axe Croissance : au-dessus (normal ET fort) = bon, zone = neutre, en dessous = mauvais');
});

// Clôture d'un semestre avec des chiffres figés imposés et un résultat imposé ; renvoie les injections espionnées.
function setupClose(eng, semester, forecasts, results){
  eng.run(`globalThis.__inj = []; globalThis.__realInj = injectStockCube;
    injectStockCube = function(co, color, a, b){ const q = __realInj(co, color, a, b); __inj.push({co:co.id, color, a, b, q}); return q; };
    drawStockCubes = function(){ return []; };
    globalThis.__res = ${JSON.stringify(results)}; globalThis.__realIS2 = incomeStatementFor;
    incomeStatementFor = function(id, s){ const r = __res[id]; if(r && s===${semester}) return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:r.rev, totalExpense:r.rev-r.ni, netIncome:r.ni}; return __realIS2(id, s); };`);
  Object.entries(forecasts).forEach(([id, f]) => eng.run(`companyById(${JSON.stringify(id)}).analystForecast = ${JSON.stringify(Object.assign({ semester, sigma: 0, parts: {}, frozenAtRoll: semester * 3 }, f))};`));
  eng.run(`state.gameClock.rollCount = ${semester * 3 + 2};`);
}

scenario('cloture', 'C1. Clôture : verdict, cubes, historique, journal ; une seule fois ; sans chiffres figés, rien', async (tf) => {
  const eng = await partie({ transform: tf });
  const [a, b, c] = eng.json(`state.companies.map(x=>x.id)`);
  setupClose(eng, 1, { [a]: { h: 1, m: 2, k: 3, target: 2, zone: 0.5 }, [b]: { h: 1, m: 2, k: 3, target: 2, zone: 0.5 } },
    { [a]: { rev: 10, ni: 3.5 }, [b]: { rev: 10, ni: 1.25 }, [c]: { rev: 10, ni: 9 } });
  const m0 = eng.cashTotal();
  eng.run(`advanceGameClock()`);
  ok(near(eng.cashTotal(), m0), 'monnaie conservée à la clôture');
  const inj = eng.json(`__inj`);
  const mine = id => inj.filter(x => x.co === id && x.a === x.b && (x.a === 2 || x.a === 5) && x.q === x.a);
  const ha = eng.json(`A.analystHistory`), hb = eng.json(`B.analystHistory`), hc = eng.json(`C.analystHistory`);
  ok(ha.length === 1 && ha[0].verdict === 'strongUp' && ha[0].color === 'green' && ha[0].qty === 5 && ha[0].actual === 3.5 && ha[0].judged === 3.5 && ha[0].adjust === 0 && ha[0].beaten === 3 && ha[0].of === 3 && ha[0].semester === 1,
    `A (3,5 contre cible 2 ± 0,5, 3 battus) : fort au-dessus, 5 verts ; jugé = officiel (aucune hypothèque) — historique ${JSON.stringify(ha[0])}`);
  ok(mine(a).length === 1 && mine(a)[0].color === 'green' && mine(a)[0].a === 5, 'A : une injection de 5 verts exactement (quantité fixe)');
  ok(hb.length === 1 && hb[0].verdict === 'normalDown' && hb[0].qty === 2 && hb[0].color === 'red' && mine(b).length === 1, 'B (1,25, 1 battu) : normal en dessous, 2 rouges (D1)');
  ok(hc.length === 0, 'C sans chiffres figés pour ce semestre : aucun verdict, aucune ligne d\'historique');
  const logs = eng.json(`state.log.map(l=>String(l.text||l)).filter(t=>t.includes('analystes'))`);
  ok(logs.length === 2 && logs.some(t => t.includes('Alice') && t.includes('5 cubes verts')) && !logs.some(t => t.includes('jugé')), `une ligne de journal par verdict, sans « jugé » quand rien n'est ajusté — ${logs[0]}`);
  // Une seule fois.
  const reserve = eng.json(`A.stockReserve`);
  const again = eng.json(`applyAnalystVerdict(A, 1)`);
  ok(again.repeated === true && again.verdict === 'strongUp' && eng.json(`A.analystHistory.length`) === 1 && JSON.stringify(eng.json(`A.stockReserve`)) === JSON.stringify(reserve),
    'appliqué une seule fois : un 2e appel rend la ligne existante sans cube ni ligne de plus');
  ok(eng.json(`applyAnalystVerdict(A, 0)`) === null, 'chiffres figés d\'un autre semestre : aucun verdict');
  // Dans la zone, au-dessus de la cible (2,75 contre 2,5) : ligne d'historique, tirage de 0 à 1 cube vert (D2).
  const eng2 = await partie({ transform: tf });
  const [a2] = eng2.json(`state.companies.map(x=>x.id)`);
  setupClose(eng2, 0, { [a2]: { h: null, m: 2, k: 3, target: 2.5, zone: 0.5 } }, { [a2]: { rev: 10, ni: 2.75 } });
  eng2.run(`advanceGameClock()`);
  const h2 = eng2.json(`A.analystHistory`);
  const z2 = eng2.json(`__inj`).filter(x => x.co === a2 && x.color === 'green' && x.a === 0 && x.b === 1);
  ok(h2.length === 1 && h2[0].verdict === 'zone' && h2[0].color === 'green' && (h2[0].qty === 0 || h2[0].qty === 1) && h2[0].h === null && z2.length === 1 && z2[0].q === h2[0].qty,
    `dans la zone au-dessus de la cible : ligne d'historique (historien absent), un tirage de 0 à 1 vert (tiré : ${h2[0].qty})`);
  // Historique limité à 40 lignes.
  eng2.run(`A.analystHistory = []; for(let s=0; s<45; s++){ A.analystForecast = {semester:s, h:null, m:0, k:null, sigma:0, target:0, zone:0.5, parts:{}}; applyAnalystVerdict(A, s); }`);
  ok(eng2.json(`A.analystHistory.length`) === 40 && eng2.json(`A.analystHistory[0].semester`) === 5, 'historique : 40 lignes au plus (les plus anciennes retirées)');
});

scenario('croissance', 'C2. Axe des analystes des Croissance (verdict rejugé compris)', async (tf) => {
  // Croissance A et GARP B ; marges : A −50 % (mauvaise), B +30 %. Matrice mauvais / {bon, neutre, mauvais}.
  for(const [ni, verdict, expect] of [[-1, 'bon', { green: 5, red: 10, white: 5 }], [-5, 'neutre', { green: 0, red: 15, white: 5 }], [-4.8, 'neutre', { green: 0, red: 15, white: 5 }], [-5.2, 'neutre', { green: 0, red: 15, white: 5 }], [-9, 'mauvais', { green: 0, red: 20, white: 0 }]]){
    const eng = await partie({ names: ['Alice', 'Bob'], types: ['croissance', 'garp'], transform: tf });
    const [a, b] = eng.json(`state.companies.map(x=>x.id)`);
    eng.run(`A.croissanceTier = 'eleve'; A.typeReserve = {green:0, red:0, white:20};`);
    // R(A) contre cible −5 ± 0,5 : −1 au-dessus, −5 dans la zone, −9 en dessous ; marge fixée par les revenus.
    setupClose(eng, 1, { [a]: { h: null, m: -5, k: null, target: -5, zone: 0.5 } }, { [a]: { rev: Math.abs(ni) * 2, ni: ni }, [b]: { rev: 10, ni: 3 } });
    eng.run(`advanceGameClock()`);
    const tp = eng.json(`A.typeReserve`);
    ok(tp.green === expect.green && tp.red === expect.red && tp.white === expect.white, `Croissance, verdict ${verdict} → matrice mauvais/${verdict} = ${JSON.stringify(expect)} — obtenu ${JSON.stringify(tp)}`);
  }
  // Bénéfice jugé : intérêt hypothécaire figé à 1 (aucun inscrit) → officiel −0,5 (au-dessus de −1,5 ± 0,5), jugé −1,5
  // (dans la zone) : l'axe suit le verdict rejugé (neutre), pas l'officiel (bon).
  const ej = await partie({ names: ['Alice', 'Bob'], types: ['croissance', 'garp'], transform: tf });
  const [aj, bj] = ej.json(`state.companies.map(x=>x.id)`);
  ej.run(`A.croissanceTier = 'eleve'; A.typeReserve = {green:0, red:0, white:20};`);
  setupClose(ej, 1, { [aj]: { h: null, m: -1.5, k: null, target: -1.5, zone: 0.5, parts: { mortgage: 1, charges: 1 } } }, { [aj]: { rev: 1, ni: -0.5 }, [bj]: { rev: 10, ni: 3 } });
  ej.run(`advanceGameClock()`);
  const hj = ej.json(`A.analystHistory[0]`), tj = ej.json(`A.typeReserve`);
  ok(hj.actual === -0.5 && close(hj.judged, -1.5) && close(hj.adjust, -1) && hj.verdict === 'zone' && tj.green === 0 && tj.red === 15 && tj.white === 5,
    `Croissance, intérêt figé 1 non inscrit : jugé −1,5 dans la zone → matrice mauvais/neutre ${JSON.stringify(tj)} (officiel −0,5 aurait donné « bon »)`);
  const eng = await partie({ names: ['Alice', 'Bob'], types: ['croissance', 'garp'], transform: tf });
  eng.run(`A.croissanceTier = 'eleve'; A.typeReserve = {green:1, red:2, white:17};`);
  setupClose(eng, 1, {}, { [eng.json(`A.id`)]: { rev: 2, ni: -1 } });
  eng.run(`advanceGameClock()`);
  ok(JSON.stringify(eng.json(`A.typeReserve`)) === JSON.stringify({ green: 1, red: 2, white: 17 }), 'Croissance sans chiffres figés : sac type inchangé');
  const eng2 = await partie({ names: ['Alice', 'Bob'], types: ['croissance', 'garp'], transform: tf });
  const a2 = eng2.json(`A.id`);
  eng2.run(`A.croissanceTier = 'eleve'; A.typeReserve = {green:1, red:2, white:17};`);
  setupClose(eng2, 1, { [a2]: { h: null, m: -5, k: null, target: -5, zone: 0.5 } }, { [a2]: { rev: 0, ni: -1 } });
  eng2.run(`advanceGameClock()`);
  ok(JSON.stringify(eng2.json(`A.typeReserve`)) === JSON.stringify({ green: 1, red: 2, white: 17 }) && eng2.json(`A.analystHistory.length`) === 1,
    'Croissance sans chiffre d\'affaires : verdict au fondamental, sac type inchangé');
});

// C1 — un semestre de fin d'année joué par le vrai performRollForAllCompanies, avec une hypothèque de A (20 M$ à 35 %,
// intérêt 7 M$) ; `quand` = moment du remboursement : 'fenetre' (avant le premier lancer), 'apres' (après le premier
// lancer : le contournement), 'jamais', ou 'nouvelle' (hypothèque prise après le premier lancer). Le loyer de la part
// hypothéquée continue (réglage), pour que seul l'intérêt sépare les cas ; historien absent (semestre 1), marché
// neutralisé par un espion (capitalisations vues nulles ; un cours à 0 finirait la partie) : cible = M. Même graine :
// mêmes dés dans tous les cas.
async function semestreHypotheque(tf, quand, lender){
  const eng = await partie({ names: ['Alice', 'Bob'], seed: 3231, transform: tf });
  eng.run(`own(39, [[A, 100]], 3); state.settings.mortgageRentContinues = true; state.hiddenGameLengthTargetYear = 999;
    A.cash = 500; B.cash = 500; analystMarketCap = function(){ return 0; }; state.gameClock.rollCount = 3;
    ${quand === 'nouvelle' ? '' : `prop(39).mortgages = [{companyId:A.id, principal:20, rate:0.35, lenderId:${lender ? 'B.id' : "'BANK'"}}];`}`);
  const repay = async () => { eng.run(`state.stockMarket.tradingOpen = true;`); await eng.run(`repayMortgage(prop(39).id, A.id)`); eng.run(`state.stockMarket.tradingOpen = false;`); };
  if(quand === 'fenetre') await repay();
  const m0 = eng.cashTotal();
  await eng.run(`performRollForAllCompanies()`);
  if(quand === 'apres') await repay();
  if(quand === 'nouvelle') eng.run(`prop(39).mortgages = [{companyId:A.id, principal:20, rate:0.35, lenderId:'BANK'}];`);
  await eng.run(`performRollForAllCompanies()`); await eng.run(`performRollForAllCompanies()`);
  return {
    eng, cashOk: near(eng.cashTotal(), m0, 1e-6),
    fA: eng.json(`A.analystForecast`), fB: eng.json(`B.analystForecast`),
    hA: eng.json(`A.analystHistory[0]`), hB: eng.json(`B.analystHistory[0]`),
    officialVerdictA: eng.json(`analystVerdict(A.analystForecast, A.analystHistory[0].actual).verdict`),
  };
}
scenario('rejuge', 'C4. Bénéfice jugé : intérêts hypothécaires rejugés à la clôture (C1)', async (tf) => {
  const fen = await semestreHypotheque(tf, 'fenetre', false);
  const apr = await semestreHypotheque(tf, 'apres', false);
  const jam = await semestreHypotheque(tf, 'jamais', false);
  ok(fen.fA.parts.mortgage === 0 && close(apr.fA.parts.mortgage, 7) && close(jam.fA.parts.mortgage, 7), 'chiffres figés : intérêt de fin d\'année 0 (remboursé dans la fenêtre), 7 (encore hypothéqué au premier lancer)');
  ok(fen.hA.adjust === 0 && fen.hA.judged === fen.hA.actual, `remboursé dans la fenêtre : rien à rejuger (jugé = officiel = ${fen.hA.actual.toFixed(4)})`);
  ok(jam.hA.adjust === 0 && close(jam.hA.actual, fen.hA.actual - 7, 1e-9), 'jamais remboursé : l\'intérêt de 7 est inscrit comme prévu, rien à rejuger');
  ok(close(apr.hA.actual, fen.hA.actual, 1e-9) && close(apr.hA.adjust, -7) && close(apr.hA.judged, apr.hA.actual - 7),
    `remboursé APRÈS le premier lancer : officiel ${apr.hA.actual.toFixed(4)} (sans intérêt), jugé ${apr.hA.judged.toFixed(4)} (intérêt figé de 7 compté)`);
  ok(close(apr.hA.judged - apr.hA.target, fen.hA.judged - fen.hA.target, 1e-9) && apr.hA.verdict === fen.hA.verdict && apr.hA.beaten === fen.hA.beaten,
    `contournement refermé : même écart à la cible (${(apr.hA.judged - apr.hA.target).toFixed(4)}) et même verdict (${apr.hA.verdict}) qu'avec le remboursement dans la fenêtre`);
  ok(apr.officialVerdictA !== apr.hA.verdict, `sans le rejugement, le bénéfice officiel aurait donné « ${apr.officialVerdictA} » au lieu de « ${apr.hA.verdict} » (cubes gagnés sans risque)`);
  ok(fen.cashOk && apr.cashOk && jam.cashOk, 'monnaie conservée dans les trois cas');
  // Prêteur : B prête à A ; A rembourse après le premier lancer, B ne reçoit pas l'intérêt que son M comptait.
  const lfen = await semestreHypotheque(tf, 'fenetre', true);
  const lapr = await semestreHypotheque(tf, 'apres', true);
  ok(close(lapr.fB.parts.mortgage, -7) && lfen.fB.parts.mortgage === 0, 'prêteur B : intérêt reçu figé (−7 en charge) au premier lancer, 0 si remboursé dans la fenêtre');
  ok(close(lapr.hB.adjust, 7) && close(lapr.hB.judged - lapr.hB.target, lfen.hB.judged - lfen.hB.target, 1e-9) && lapr.hB.verdict === lfen.hB.verdict,
    `prêteur : intérêt manqué rajouté au bénéfice jugé (+7), même écart à la cible et même verdict (${lapr.hB.verdict}) qu'avec le remboursement dans la fenêtre`);
  // Ronde finale (R2) : prêteur dont l'hypothèque est gardée : B touche son intérêt de fin d'année (7, comme prévu au
  // gel) : ajustement 0, bénéfice jugé = officiel, verdict = celui du bénéfice officiel.
  const ljam = await semestreHypotheque(tf, 'jamais', true);
  const booked = ljam.eng.json(`analystMortgageInterestBooked(incomeStatementFor(B.id, 1))`);
  ok(close(ljam.fB.parts.mortgage, -7) && close(booked, -7), `prêteur, hypothèque gardée : intérêt figé −7 (reçu, en charge négative), intérêt inscrit −7 (${booked})`);
  ok(ljam.hB.adjust === 0 && ljam.hB.judged === ljam.hB.actual && ljam.eng.json(`analystVerdict(B.analystForecast, B.analystHistory[0].actual).verdict`) === ljam.hB.verdict,
    `prêteur, hypothèque gardée : ajustement 0, jugé = officiel (${ljam.hB.actual.toFixed(4)}), verdict inchangé (${ljam.hB.verdict})`);
  ok(ljam.cashOk, 'prêteur, hypothèque gardée : monnaie conservée');
  // Hypothèque prise après le premier lancer : l'intérêt inscrit n'était pas prévu, il est retiré du jugement.
  const nouv = await semestreHypotheque(tf, 'nouvelle', false);
  ok(nouv.fA.parts.mortgage === 0 && close(nouv.hA.adjust, 7) && close(nouv.hA.judged, fen.hA.actual, 1e-9),
    'hypothèque prise après le gel : intérêt de 7 inscrit mais pas prévu, bénéfice jugé = celui sans hypothèque');
  const logs = apr.eng.json(`state.log.map(l=>String(l.text||l)).filter(t=>t.includes('analystes'))`);
  ok(logs.some(t => t.includes('Alice') && t.includes('bénéfice jugé') && t.includes('intérêts hypothécaires')), `journal : le bénéfice jugé est dit en clair — ${(logs.find(t => t.includes('Alice')) || '').slice(0, 220)}`);
});

// D1 et D2 — clôtures répétées sur des chiffres figés et un bénéfice imposés (vrai applyAnalystVerdict, vrai
// injectStockCube, hasard semé) : tailles fixes hors zone, tirage de 0 ou 1 cube dans la zone, du côté de l'écart.
scenario('zone', 'C6. Tailles du verdict (D1) et tirage de 0 ou 1 cube dans la zone (D2)', async (tf) => {
  const eng = await partie({ seed: 20261117, transform: tf });
  eng.run(`globalThis.__ni = 0; globalThis.__k = 0;
    incomeStatementFor = function(id, s){ return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:10, totalExpense:10-__ni, netIncome:__ni}; };
    globalThis.__close = function(ni, n, f){ const out = []; for(let i=0; i<n; i++){ __ni = ni; const s = 1000 + (__k++);
      A.analystForecast = Object.assign({semester:s, sigma:0, parts:{}}, f);
      const g0 = A.stockReserve.green, r0 = A.stockReserve.red, m0 = state.log.length; const e = applyAnalystVerdict(A, s);
      out.push({v:e.verdict, c:e.color, q:e.qty, dg:A.stockReserve.green-g0, dr:A.stockReserve.red-r0, log:String((state.log[0]||{}).text||'')}); } // journal : la ligne la plus récente est en tête
      return out; };`);
  const F1 = { h: null, m: 2, k: null, target: 2, zone: 0.5 }, F3 = { h: 1, m: 2, k: 3, target: 2, zone: 0.5 };
  // D1 : quantités fixes hors zone.
  const [nu] = eng.json(`__close(2.75, 1, ${JSON.stringify(F3)})`), [su] = eng.json(`__close(3.5, 1, ${JSON.stringify(F3)})`);
  const [nd] = eng.json(`__close(1.25, 1, ${JSON.stringify(F3)})`), [sd] = eng.json(`__close(0.5, 1, ${JSON.stringify(F3)})`);
  ok(nu.v === 'normalUp' && nu.q === 2 && nu.dg === 2 && su.v === 'strongUp' && su.q === 5 && su.dg === 5, 'D1 : au-dessus : verdict normal = 2 verts, fort = 5 verts au sac fondamental');
  ok(nd.v === 'normalDown' && nd.q === 2 && nd.dr === 2 && sd.v === 'strongDown' && sd.q === 5 && sd.dr === 5, 'D1 : en dessous : verdict normal = 2 rouges, fort = 5 rouges');
  // D2 : dans la zone, 300 clôtures de chaque côté.
  const N = 300;
  const up = eng.json(`__close(2.3, ${N}, ${JSON.stringify(F1)})`), dn = eng.json(`__close(1.7, ${N}, ${JSON.stringify(F1)})`), eq = eng.json(`__close(2, 50, ${JSON.stringify(F1)})`);
  const ones = a => a.filter(x => x.q === 1).length;
  ok(up.every(x => x.v === 'zone' && x.c === 'green' && (x.q === 0 || x.q === 1) && x.dg === x.q && x.dr === 0) && ones(up) > 0 && ones(up) < N,
    `D2 : au-dessus de la cible dans la zone (${N} clôtures) : vert, 0 ou 1 cube (1 cube ${ones(up)} fois, 0 cube ${N - ones(up)} fois), sac fondamental = quantité tirée`);
  ok(dn.every(x => x.v === 'zone' && x.c === 'red' && (x.q === 0 || x.q === 1) && x.dr === x.q && x.dg === 0) && ones(dn) > 0 && ones(dn) < N,
    `D2 : en dessous de la cible dans la zone : rouge, 0 ou 1 cube (1 cube ${ones(dn)} fois, 0 cube ${N - ones(dn)} fois)`);
  ok(Math.abs(ones(up) / N - 0.5) < 0.12 && Math.abs(ones(dn) / N - 0.5) < 0.12, 'D2 : tirage équilibré entre 0 et 1 (environ une fois sur deux)');
  ok(eq.every(x => x.v === 'zone' && x.c === null && x.q === 0 && x.dg === 0 && x.dr === 0), 'D2 : égalité exacte avec la cible : aucune couleur, aucun cube');
  const l1 = up.find(x => x.q === 1).log, l0 = up.find(x => x.q === 0).log;
  ok(/: dans la zone — 1 cube vert au sac fondamental\.$/.test(l1) && /: dans la zone — aucun cube\.$/.test(l0) && !/battu/.test(l1),
    `D2 : journal : « ${l1.slice(l1.indexOf('dans la zone'))} » / « ${l0.slice(l0.indexOf('dans la zone'))} »`);
  ok(eng.json(`A.analystHistory`).every(e => e.verdict !== 'zone' || ((e.qty === 0 || e.qty === 1) && (e.color === 'green' || e.color === 'red' || (e.color === null && e.qty === 0)))),
    'D2 : historique : couleur du côté et quantité réellement tirée (0 ou 1)');
});

// D3 — émission et rachat d'actions : les cubes du volume et le bonus de la section 322 vont au sac TRADING.
scenario('emission', 'C7. Émission et rachat d\'actions : cubes au sac trading, bonus compris (D3)', async (tf) => {
  const eng = await partie({ seed: 3233, transform: tf });
  ok(eng.run(`tradingWindowOpen()`) === true, 'marché ouvert (début de partie)');
  const lot = eng.run(`Math.ceil(STOCK_TRADE_IMPACT_UNIT_PCT * A.totalShares)`);
  eng.run(`A.cash = 1e6;`);
  const snap = () => eng.json(`({f: Object.assign({}, A.stockReserve), t: Object.assign({}, A.tradingReserve)})`);
  const s0 = snap(), m0 = eng.cashTotal();
  const r1 = eng.json(`issueNewShares(A, ${lot})`);
  const s1 = snap();
  ok(r1.ok && r1.cubesInjected >= 2 && r1.cubesInjected <= 4 && s1.t.red - s0.t.red === r1.cubesInjected && s1.t.green === s0.t.green,
    `émission d'une tranche (${lot} parts) : ${r1.cubesInjected} cubes rouges (bonus 1-2 + volume 1-2) au sac trading`);
  ok(JSON.stringify(s1.f) === JSON.stringify(s0.f), 'émission : le sac fondamental ne bouge pas');
  const r2 = eng.json(`buybackShares(A, ${lot})`);
  const s2 = snap();
  ok(r2.ok && r2.cubesInjected >= 2 && r2.cubesInjected <= 4 && s2.t.green - s1.t.green === r2.cubesInjected && s2.t.red === s1.t.red,
    `rachat d'une tranche : ${r2.cubesInjected} cubes verts (bonus 1-2 + volume 1-2) au sac trading`);
  ok(JSON.stringify(s2.f) === JSON.stringify(s0.f), 'rachat : le sac fondamental ne bouge pas');
  const r3 = eng.json(`buybackShares(A, ${lot})`), s3 = snap();
  ok(r3.ok && r3.cubesInjected >= 1 && r3.cubesInjected <= 2 && s3.t.green - s2.t.green === r3.cubesInjected, 'section 322 inchangée : 2e rachat de la fenêtre = volume seul (1 à 2), pas de 2e bonus');
  ok(near(eng.cashTotal(), m0), 'monnaie conservée');
});

scenario('moments', 'C3. Les moments : provisoire, figé au premier lancer (trois chemins), migrée en cours de semestre', async (tf) => {
  const eng = await partie({ transform: tf });
  eng.run(`own(39, [[A, 100]], 1); A.position = 38;`);
  const p0 = eng.json(`analystForecastFor(A)`);
  eng.run(`prop(39).houses = 3;`);
  const p1 = eng.json(`analystForecastFor(A)`);
  ok(p0.frozen === false && p1.frozen === false && p1.m > p0.m + 0.1, `fenêtre : bâtir change les chiffres provisoires (M ${p0.m.toFixed(4)} → ${p1.m.toFixed(4)})`);
  const m0 = eng.cashTotal();
  await eng.run(`performRollForAllCompanies()`);
  const f = eng.json(`A.analystForecast`);
  ok(f && f.semester === 0 && f.frozenAtRoll === 0 && close(f.m, p1.m) && close(f.parts.subsidy, 2, 1e-12),
    'lancer pour tous : chiffres figés AVANT le déplacement (subvention de la case 38 = 2), égaux aux provisoires affichés');
  ok(eng.json(`state.companies.every(c=>c.analystForecast && c.analystForecast.semester===0)`), 'toutes les entreprises actives sont figées dans la même action');
  ok(near(eng.cashTotal(), m0), 'monnaie conservée par le lancer');
  eng.run(`prop(39).houses = 5;`);
  const fr = eng.json(`analystForecastFor(A)`);
  ok(fr.frozen === true && close(fr.m, p1.m) && close(fr.target, f.target), 'après le premier lancer : bâtir ne change plus les chiffres figés');
  ok(eng.json(`freezeAnalystForecasts()`) === false && close(eng.json(`A.analystForecast.m`), p1.m), 'freezeAnalystForecasts hors de la fenêtre : sans effet');
  await eng.run(`performRollForAllCompanies()`); await eng.run(`performRollForAllCompanies()`);
  ok(eng.json(`state.gameClock.rollCount`) === 3 && eng.json(`state.companies.every(c=>c.analystHistory.length===1 && c.analystHistory[0].semester===0)`), 'clôture du semestre 0 : un verdict par entreprise');
  const nxt = eng.json(`analystForecastFor(A)`);
  ok(nxt.frozen === false && nxt.semester === 1 && nxt.verdictPossible === true, 'nouveau semestre : chiffres de nouveau provisoires');
  // Chemin du lancer d'une seule entreprise.
  const e2 = await partie({ transform: tf });
  await e2.run(`rollDiceAndMove(B.id)`);
  ok(e2.json(`state.companies.every(c=>c.analystForecast && c.analystForecast.semester===0 && c.analystForecast.frozenAtRoll===0)`), 'lancer d\'une entreprise (rollDiceAndMove) : tout le monde est figé');
  // Chemin d'un pion neutre seul (corePerformNeutralPawnRoll).
  const e3 = await partie({ transform: tf });
  e3.run(`addPawn('pw1');`);
  await e3.run(`corePerformNeutralPawnRoll(state.neutralPawns[0])`);
  ok(e3.json(`state.companies.every(c=>c.analystForecast && c.analystForecast.semester===0)`), 'déplacement d\'un pion neutre : tout le monde est figé');
  // Entreprise créée en cours de semestre : pas de chiffres figés, pas de verdict.
  const e4 = await partie({ names: ['Alice', 'Bob', 'Chloe'], types: ['garp', 'garp', null], transform: tf });
  await e4.run(`performRollForAllCompanies()`);
  await e4.run(`createCompany(state.players[2].id, 'Co Tard', '', 'garp', null, null, null)`);
  e4.run(`applyCompanyIpoFunding(state.companies[2]);`);
  const late = e4.json(`analystForecastFor(state.companies[2])`);
  ok(late.frozen === false && late.verdictPossible === false, 'entreprise créée en cours de semestre : chiffres provisoires, aucun verdict possible');
  await e4.run(`performRollForAllCompanies()`); await e4.run(`performRollForAllCompanies()`);
  ok(e4.json(`state.companies[2].analystHistory.length`) === 0 && e4.json(`state.companies[0].analystHistory.length`) === 1, 'à la clôture : verdict pour les deux premières, aucune pour la nouvelle');
});

// C2 — le gel vient APRÈS les enchères résolues au même lancer (lot commercial, REIT, ABS) et avant tout déplacement,
// sur les deux chemins de lancer ; et même quand toutes les entreprises sont enquêtées au premier lancer du semestre.
scenario('gel', 'C5. Gel après les enchères du même lancer (C2), et quand toutes les entreprises sont enquêtées', async (tf) => {
  for(const [fn, quoi] of [['maybeResolveTerrainLotAuction', 'lot commercial'], ['maybeResolveEtfAuctions', 'enchère de REIT'], ['maybeResolveRevenueSwapListings', 'ABS mise en vente']]){
    for(const [chemin, appel] of [['lancer pour tous', 'performRollForAllCompanies()'], ['lancer d\'une entreprise', 'rollDiceAndMove(B.id)']]){
      const eng = await partie({ transform: tf });
      // L'enchère résolue à ce lancer donne à A le Bleu foncé 2 (3 maisons) : les chiffres figés doivent le compter.
      eng.run(`${fn} = function(){ if(!prop(39).owners.length) own(39, [[A, 100]], 3); };`);
      await eng.run(appel);
      const fz = eng.json(`A.analystForecast`);
      ok(fz && fz.semester === 0 && fz.parts.rentsIn > 0.1, `${quoi}, ${chemin} : attribution du même lancer comptée dans les chiffres figés (loyers reçus ${fz ? fz.parts.rentsIn.toFixed(4) : '—'})`);
    }
  }
  const eng = await partie({ transform: tf });
  eng.run(`state.companies.forEach(c=>{ c.inJail = true; c.jailTurnsLeft = 2; c.position = 10; });`);
  await eng.run(`performRollForAllCompanies()`);
  ok(eng.json(`state.companies.every(c=>c.analystForecast && c.analystForecast.semester===0 && c.analystForecast.frozenAtRoll===0)`), 'toutes les entreprises enquêtées au premier lancer : personne ne bouge, les chiffres sont quand même figés');
  await eng.run(`performRollForAllCompanies()`); await eng.run(`performRollForAllCompanies()`);
  ok(eng.json(`state.companies.every(c=>c.analystHistory.length===1)`), '… et le semestre a son verdict à la clôture');
});

scenario('migree', 'D1. Partie ancienne migrée en cours de semestre, argent conservé, aucun hasard', async (tf) => {
  const eng = await partie({ transform: tf });
  eng.run(`own(39, [[A, 100]], 2); own(1, [[B, 50], [C, 50]], 0);`);
  await eng.run(`performRollForAllCompanies()`);
  // Partie d'avant la section 323 : champs absents, chargée au lancer 1 (milieu du semestre 0).
  eng.run(`(function(){ const s = JSON.parse(JSON.stringify(state)); s.companies.forEach(c=>{ delete c.analystForecast; delete c.analystHistory; delete c.ceoCall; }); migrateState(s); state = s; rebind(); })()`);
  ok(eng.json(`state.companies.every(c=>c.analystForecast===null && Array.isArray(c.analystHistory) && c.analystHistory.length===0 && c.ceoCall===null)`),
    'migrateState : analystForecast null, analystHistory [], ceoCall null');
  const f = eng.json(`analystForecastFor(A)`);
  ok(f.frozen === false && f.verdictPossible === false && typeof f.m === 'number', 'partie migrée en cours de semestre : chiffres provisoires, aucun verdict possible');
  await eng.run(`performRollForAllCompanies()`); await eng.run(`performRollForAllCompanies()`);
  ok(eng.json(`state.gameClock.rollCount`) === 3 && eng.json(`state.companies.every(c=>c.analystHistory.length===0)`), 'clôture du semestre migré : aucun verdict, aucune erreur');
  await eng.run(`performRollForAllCompanies()`);
  ok(eng.json(`state.companies.every(c=>c.analystForecast && c.analystForecast.semester===1)`), 'semestre suivant : chiffres figés au premier lancer');
  // Argent conservé et aucun hasard dans le calcul.
  const m0 = eng.cashTotal(), c0 = eng.ctl.count, st0 = eng.run(`JSON.stringify(state)`);
  eng.json(`[analystForecastsLive(), analystForecastFor(A), analystModeller(B), analystHistorian(C, 1), boardLandingFrequencies(), analystTurnTables(false), analystVerdict(A.analystForecast, 1)]`);
  ok(eng.ctl.count === c0, `aucun appel à Math.random dans le calcul des analystes (${eng.ctl.count - c0} appel)`);
  ok(near(eng.cashTotal(), m0) && eng.run(`JSON.stringify(state)`) === st0, 'calcul pur : monnaie et état inchangés');
  eng.run(`state.gameClock.rollCount = 6; A.analystForecast = null; B.analystForecast = null; C.analystForecast = null;`);
  const c1 = eng.ctl.count, m1 = eng.cashTotal();
  ok(eng.json(`freezeAnalystForecasts()`) === true && eng.ctl.count === c1 && near(eng.cashTotal(), m1), 'figer les chiffres : aucun hasard, aucune monnaie déplacée');
  // Chargement complet (saveGame / loadGame) d'une partie de l'ancien format.
  eng.run(`state.companies.forEach(c=>{ delete c.analystForecast; delete c.analystHistory; delete c.ceoCall; });`);
  await eng.run(`saveGame()`);
  const code = eng.run(`gameCode`);
  const eng2 = loadEngine();
  for(const [k, v] of eng.mem) eng2.mem.set(k, v);
  ok(await eng2.run(`loadGame(${JSON.stringify(code)})`) === true && eng2.json(`state.companies.every(c=>c.analystForecast===null && c.analystHistory.length===0)`), 'partie de l\'ancien format enregistrée puis chargée : valeurs par défaut posées');
});

// B. Le modélisateur contre le vrai moteur : suites de semestres, positions et enquêtes reportées d'un semestre au
// suivant (loi stationnaire), l'état du parc remis à l'identique au début de chaque semestre.
scenario('simulation', 'B1. Modélisateur contre une simulation du vrai moteur (A : Bleu foncé 2 à 3 maisons ; B, C, un pion neutre)', async (tf) => {
  const eng = await partie({ seed: 20261117, transform: tf });
  eng.run(`own(39, [[A, 100]], 3); addPawn('pw1'); log = function(){};`);
  const N = 2500;
  const out = await eng.run(`(async function(){
    const snap = JSON.stringify(state);
    let carry = null; const d = [], sig = [], ms = [];
    for(let i=0; i<${N}; i++){
      state = JSON.parse(snap);
      if(carry){ state.companies.forEach((c, k)=>Object.assign(c, carry.c[k])); state.neutralPawns.forEach((p, k)=>Object.assign(p, carry.p[k])); }
      for(let r=0; r<3; r++){
        if(r===0) freezeAnalystForecasts(); // comme performRollForAllCompanies, avant tout déplacement
        const alreadyJailed = activeCompanies().filter(c=>c.inJail), rollers = activeCompanies().filter(c=>!c.inJail);
        const jailedPawns = state.neutralPawns.filter(p=>p.inJail), pawnRollers = state.neutralPawns.filter(p=>!p.inJail);
        const res = [];
        for(const co of rollers) res.push([co, await corePerformDiceRoll(co, {deferJail:true})]);
        for(const pw of pawnRollers) await corePerformNeutralPawnRoll(pw);
        res.forEach(([co, x])=>{ if(x.jailed) applySendToJailEffect(co); });
        alreadyJailed.forEach(co=>{ co.jailTurnsLeft = Math.max(0, co.jailTurnsLeft-1); if(co.jailTurnsLeft<=0) co.inJail = false; });
        jailedPawns.forEach(pw=>{ pw.jailTurnsLeft = Math.max(0, pw.jailTurnsLeft-1); if(pw.jailTurnsLeft<=0) pw.inJail = false; });
        if(r===0){ const f = state.companies[0].analystForecast; ms.push(f.m); sig.push(f.sigma); }
        advanceGameClock();
      }
      const R = incomeStatementFor(state.companies[0].id, 0).netIncome;
      d.push(R - ms[ms.length-1]);
      carry = {c: state.companies.map(c=>({position:c.position, inJail:c.inJail, jailTurnsLeft:c.jailTurnsLeft})), p: state.neutralPawns.map(p=>({position:p.position, inJail:p.inJail, jailTurnsLeft:p.jailTurnsLeft}))};
    }
    const mean = d.reduce((a,b)=>a+b,0)/d.length;
    const sd = Math.sqrt(d.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(d.length-1));
    const sigMean = Math.sqrt(sig.reduce((a,b)=>a+b*b,0)/sig.length);
    const mMean = ms.reduce((a,b)=>a+b,0)/ms.length;
    return JSON.stringify({mean, sd, sigMean, mMean});
  })()`);
  const r = JSON.parse(out);
  const se = r.sd / Math.sqrt(N);
  ok(Math.abs(r.mean) <= 4 * se, `écart moyen R − M sur ${N} semestres : ${r.mean.toFixed(4)} (M moyen ${r.mMean.toFixed(4)}), dans ± 4 erreurs types (${(4 * se).toFixed(4)})`);
  ok(Math.abs(r.sigMean / r.sd - 1) <= 0.15, `irrégularité prévue σ ${r.sigMean.toFixed(4)} contre écart type mesuré ${r.sd.toFixed(4)} (à 15 % près)`);
});

// B2 (C4) — situation chargée, VRAI performRollForAllCompanies : hypothèque (part de B sur 37, semestre de fin d'année),
// copropriété (37 : A 60 / B 40 ; 28 : B 50 / C 50), part de la banque (1 : C 90 %), aéroports, services, A enquêtée et
// un pion neutre enquêté au départ, case 30 active ; positions et enquêtes reportées d'un semestre au suivant. Version
// courte de la mesure de la revue (20 000 semestres hors dépôt) : graine fixe, R − M dans ± 3 erreurs types pour
// chaque entreprise. Avant la correction : R − M ≈ −0,3 pour un gros propriétaire (z ≈ −6 sur 20 000 semestres).
scenario('parite-sim', 'B2. Modélisateur contre le vrai lancer pour tous, situation chargée, case 30 active (C4)', async (tf) => {
  const N = 3000;
  const eng = await partie({ seed: 777, transform: tf });
  eng.run(`
    state.hiddenGameLengthTargetYear = 999;
    own(39, [[A,100]], 3); own(37, [[A,60],[B,40]], 2); prop(37).mortgages = [{companyId:B.id, principal:3, rate:0.35, lenderId:'BANK'}];
    own(1, [[C,90]], 4); own(3, [[C,100]], 4); own(5, [[C,100]], 0); own(15, [[C,100]], 0);
    own(12, [[B,100]], 0); own(28, [[B,50],[C,50]], 0); own(24, [[B,100]], 3); own(21, [[B,100]], 3); own(23,[[B,100]],3);
    addPawn('pw1', 0); addPawn('pw2', 10); state.neutralPawns[1].inJail = true; state.neutralPawns[1].jailTurnsLeft = 2;
    A.position = 10; A.inJail = true; A.jailTurnsLeft = 1; B.position = 35; C.position = 22;
    state.companies.forEach(c=>{ c.cash = 500; });
    state.gameClock.rollCount = 3;
    drawStockCubes = function(){ return []; };
    log = function(){};`);
  const out = JSON.parse(await eng.run(`(async function(){
    const snap = JSON.stringify(state); let carry = null; const rec = {};
    for(let i=0;i<${N};i++){
      state = JSON.parse(snap); rebind();
      if(carry){ state.companies.forEach((c,k)=>Object.assign(c, carry.c[k])); state.neutralPawns.forEach((p,k)=>Object.assign(p, carry.p[k])); }
      for(let r=0;r<3;r++){ const x = await performRollForAllCompanies(); if(!x) throw new Error('lancer refusé '+r); }
      state.companies.forEach(c=>{
        const f = c.analystForecast; const R = incomeStatementFor(c.id, 1).netIncome;
        (rec[c.name] = rec[c.name] || {d:[], s:[]}); rec[c.name].d.push(R - f.m); rec[c.name].s.push(f.sigma);
      });
      carry = {c: state.companies.map(c=>({position:c.position, inJail:c.inJail, jailTurnsLeft:c.jailTurnsLeft})), p: state.neutralPawns.map(p=>({position:p.position, inJail:p.inJail, jailTurnsLeft:p.jailTurnsLeft}))};
    }
    const res = {};
    Object.keys(rec).forEach(k=>{ const d = rec[k].d, n = d.length; const mean = d.reduce((a,b)=>a+b,0)/n;
      const sd = Math.sqrt(d.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)); const sig = Math.sqrt(rec[k].s.reduce((a,b)=>a+b*b,0)/n);
      res[k] = {mean, se: sd/Math.sqrt(n), sd, sig}; });
    return JSON.stringify(res);
  })()`));
  for(const [name, r] of Object.entries(out)){
    ok(Math.abs(r.mean) <= 3 * r.se, `${name} : R − M moyen ${r.mean.toFixed(4)} sur ${N} semestres, dans ± 3 erreurs types (${(3 * r.se).toFixed(4)})`);
    ok(Math.abs(r.sig / r.sd - 1) <= 0.15, `${name} : σ prévu ${r.sig.toFixed(3)} contre écart type mesuré ${r.sd.toFixed(3)} (à 15 % près)`);
  }
});

// --- Versions cassées exprès ----------------------------------------------------------------------------------
function rep(src, a, b){ if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 80)); return src.split(a).join(b); }
const FREEZE_ALL = "    // enchères résolues à ce lancer et avant tout déplacement, même si toutes les entreprises sont sous enquête.\n    freezeAnalystForecasts();\n";
const FREEZE_SOLO = "    // déplacement, dans la même action.\n    freezeAnalystForecasts();\n";
const MUTATIONS = [
  // Lot moteur (première ronde).
  ['plancher de la zone à 0,25', s => rep(s, 'const ANALYST_ZONE_K = 0.35, ANALYST_ZONE_FLOOR = 0.5,', 'const ANALYST_ZONE_K = 0.35, ANALYST_ZONE_FLOOR = 0.25,'), ['analystes']],
  ['zone revenue à 0,5 × σ (D4)', s => rep(s, 'const ANALYST_ZONE_K = 0.35, ANALYST_ZONE_FLOOR = 0.5,', 'const ANALYST_ZONE_K = 0.5, ANALYST_ZONE_FLOOR = 0.5,'), ['analystes']],
  ['bord de la zone exclu (< au lieu de ≤)', s => rep(s, 'if(Math.abs(actual - f.target) <= f.zone)', 'if(Math.abs(actual - f.target) < f.zone)'), ['verdict']],
  ['égalité comptée comme battue', s => rep(s, 'const beaten = vals.filter(x=>actual > x).length;', 'const beaten = vals.filter(x=>actual >= x).length;'), ['verdict']],
  ['un seul analyste donne un verdict fort', s => rep(s, "(of>1 && beaten===of) ? 'strongUp'", "(beaten===of) ? 'strongUp'"), ['verdict']],
  ['cible = moyenne des trois au lieu de la médiane', s => rep(s, 'vals.length===3 ? vals[1]', 'vals.length===3 ? (vals[0]+vals[1]+vals[2])/3'), ['analystes']],
  ['historien présent dès 1 semestre clos', s => rep(s, 'ANALYST_HISTORIAN_MIN_SEMESTERS = 2;', 'ANALYST_HISTORIAN_MIN_SEMESTERS = 1;'), ['analystes']],
  ['propriétaire enquêté payé quand même', s => rep(s, 'const f = sched[c.ownerId] ? sched[c.ownerId].free(t) : 1;', 'const f = 1;'), ['enquete']],
  ['intérêts hypothécaires au mauvais semestre', s => rep(s, 'if(semester % 2 !== 1) return out;', 'if(semester % 2 !== 0) return out;'), ['hypotheque']],
  ['subvention malgré une avance due', s => rep(s, 'if(!(c.goAdvancesOwed>0)){ o.subsidy', 'if(true){ o.subsidy'), ['freq']],
  ['pions neutres oubliés', s => rep(s, '.concat((state.neutralPawns||[]).map(pw=>({id:pw.id, pawn:true, s:analystPawnSchedule(pw)})));', ';'), ['pion']],
  ['swap consommé par le calcul', s => rep(s, 'if(opts && opts.dryRun) return {toOwner, toPartner, partnerId}; // Section 323', ''), ['pion']],
  // Pari du PDG (section 7) : la garde porte maintenant aussi l'effacement de l'annonce (dropCall) ; même retrait.
  ['verdict appliqué deux fois', s => rep(s, 'if(done){ dropCall(); return Object.assign({repeated:true}, done); }', ''), ['cloture']],
  ['figer hors de la fenêtre', s => rep(s, "if(!state || !state.gameClock || rollsInCurrentSemester()!==0) return false;", 'if(!state || !state.gameClock) return false;'), ['moments', 'migree']],
  ['figer après le déplacement', s => rep(rep(rep(rep(rep(s, FREEZE_ALL, ''), FREEZE_SOLO, ''),
    "  freezeAnalystForecasts(); // Section 323 — quel que soit le chemin du lancer (sans effet si déjà figé ou hors de la fenêtre)\n", ''),
    "  freezeAnalystForecasts(); // Section 323 — idem pour un pion neutre\n", ''),
    '    const localNeutralPawnResults = [];', '    freezeAnalystForecasts(); const localNeutralPawnResults = [];'), ['moments']],
  ['hasard dans le modélisateur', s => rep(s, 'const n = ANALYST_ROLLS_PER_SEMESTER;\n  const sem = Math.floor((state.gameClock.rollCount||0)/3);\n  const cos = activeCompanies();\n  const out = {}, sched = {};', 'const n = ANALYST_ROLLS_PER_SEMESTER; Math.random();\n  const sem = Math.floor((state.gameClock.rollCount||0)/3);\n  const cos = activeCompanies();\n  const out = {}, sched = {};'), ['migree']],
  ['axe Croissance : zone comptée « bon »', s => rep(s, "if(v==='zone') return 'neutre';", "if(v==='zone') return 'bon';"), ['croissance']],
  ['champs par défaut oubliés par migrateState', s => rep(s, 'if(!Array.isArray(co.analystHistory)) co.analystHistory = [];', ''), ['migree']],
  ['part de la banque oubliée dans ce que paie le visiteur', s => rep(s, '(state.settings.bankCollectsRent ? purchasableBankShare(p)/100 : 0)', '0'), ['parite']],
  ['intérêt d’ABS oublié', s => rep(s, 'const flows = analystAbsFlows(deal, amount * (deal.cededPctOfShare||0));', 'const flows = analystAbsFlows(deal, 0);'), ['parite']],
  ['part réservée vendue des REIT oubliée (couleurs)', s => rep(s, 'extra = rentTotal * (collected/100 + ', 'extra = rentTotal * (0 + '), ['parite']],
  ['taxes du visiteur oubliées (modélisateur faussé)', s => rep(s, 'o.taxes += a*cost; o.v += a*(1-a)*cost*cost;', ''), ['loyer', 'simulation']],
  // Les 8 versions cassées qui avaient survécu à la revue (trous de test, code juste).
  ['revue 1 : variance de la subvention retirée', s => rep(s, 'o.v += ANALYST_GO_SUBSIDY*ANALYST_GO_SUBSIDY*q*(1-q);', ''), ['freq']],
  // Motif exact de la revue : il touche aussi les tables par tour. Sur la subvention SEULE, cette version est
  // équivalente (sorti en 10 au tour 1 ou 2, le pion ne peut plus passer GO avant la fin du semestre) ; elle est
  // attrapée par les tables par tour (jailTurns = 1) et les montants qui en dépendent.
  ['revue 2 : retour d\'enquête un lancer trop tôt (jailTurns = 1)', s => rep(s, 'reentry[t+1+skip] = (reentry[t+1+skip]||0) + w;', 'reentry[t+skip] = (reentry[t+skip]||0) + w;'), ['freq']],
  ['revue 3 : finLedgerStartedAtRoll ignoré par l\'historien', s => rep(s, "Math.floor((state.finLedgerStartedAtRoll||0)/3));\n  const prior", "0);\n  const prior"), ['analystes']],
  ['revue 4 : gel retiré de performRollForAllCompanies (toutes enquêtées)', s => rep(s, FREEZE_ALL, ''), ['gel']],
  ['revue 5 : Croissance, verdict fort au-dessus pas compté « bon »', s => rep(s, "if(v==='normalUp' || v==='strongUp') return 'bon';", "if(v==='normalUp') return 'bon';"), ['verdict']],
  ['revue 6 : intérêts d\'un lot comptés sur chaque terrain', s => rep(s, "    if(p.groupMergeId && lotMortgageHost(p.groupMergeId)!==p) return;\n    p.mortgages.forEach(m=>{\n      if(!companyById(m.companyId)) return;\n      const interest", "    p.mortgages.forEach(m=>{\n      if(!companyById(m.companyId)) return;\n      const interest"), ['hypotheque']],
  ['revue 7 : hypothèque ignorée pour les aéroports et services', s => rep(s, 'cuts = groupRentSettlement(p, visitorId, dice).cuts.filter(c=>!mortgagedIds.includes(c.companyId))', 'cuts = groupRentSettlement(p, visitorId, dice).cuts'), ['parite']],
  ['revue 8 : part REIT réservée non vendue payée sur les aéroports', s => rep(s, 'if(collected>0) extra = etfFloorAirportServiceRate(p) * (p.type===\'service\' ? dice : 1) * (collected/100);', 'extra = etfFloorAirportServiceRate(p) * (p.type===\'service\' ? dice : 1) * (etfReservedFloorPct(p)/100);'), ['parite']],
  // Ronde de corrections : une version cassée par correction.
  ['C1 : bénéfice officiel jugé (intérêts non rejugés)', s => rep(s, 'const judged = actual + adjust;', 'const judged = actual;'), ['rejuge']],
  ['R2 : intérêt hypothécaire reçu par le prêteur ignoré', s => rep(s, "return ((is.expenses && is.expenses.mortgage_interest_expense)||0) - ((is.revenues && is.revenues.mortgage_interest_revenue)||0);", "return ((is.expenses && is.expenses.mortgage_interest_expense)||0);"), ['rejuge']],
  ['C1 : intérêt figé non gardé à part',s => rep(s, 'charges:o.charges, mortgage:mort};', 'charges:o.charges};'), ['hypotheque', 'rejuge']],
  ['C2 : gel avant les enchères du même lancer', s => rep(rep(rep(s, FREEZE_ALL, ''), FREEZE_SOLO, ''),
    '    const portfolioSnap = snapshotPlayerBondsAndLoans();', '    freezeAnalystForecasts(); const portfolioSnap = snapshotPlayerBondsAndLoans();'), ['gel']],
  ['C3 : marché présent avec une seule capitalisation positive', s => rep(s, 'nCap>=ANALYST_MARKET_MIN_COMPANIES', 'nCap>=1'), ['analystes']],
  ['C4 : enquête pendant le semestre ignorée (propriétaire)', s => rep(s, 'const f = sched[c.ownerId] ? sched[c.ownerId].free(t) : 1;', 'const f = (sched[c.ownerId] && t < sched[c.ownerId].j) ? 0 : 1;'), ['loyer']],
  ['C4 : enquête pendant le semestre ignorée (visiteur : 3 × fréquence par lancer joué)', s => rep(s, "          if(SPECIAL_SQUARES[d] && SPECIAL_SQUARES[d].kind==='gotojail') reentry[t+1+skip] = (reentry[t+1+skip]||0) + w;\n          else nx[d] += w;", "          if(SPECIAL_SQUARES[d] && SPECIAL_SQUARES[d].kind==='gotojail') nx[10] += w;\n          else nx[d] += w;"), ['freq', 'loyer']],
  ['C4 : sortie d\'enquête depuis la loi stationnaire au lieu de la case 10', s => rep(s, 'const T = analystTurnTables(j>0);', 'const T = analystTurnTables(false);'), ['enquete']],
  ['D1 : verdict normal à 3 cubes', s => rep(s, 'const ANALYST_VERDICT_NORMAL_CUBES = 2,', 'const ANALYST_VERDICT_NORMAL_CUBES = 3,'), ['verdict', 'zone']],
  ['D2 : la zone ne donne rien', s => rep(s, "if(gap>0) return {color:'green', qtyMin:ANALYST_ZONE_CUBES_MIN, qtyMax:ANALYST_ZONE_CUBES_MAX};", "if(gap>0) return {color:null, qtyMin:0, qtyMax:0};"), ['zone']],
  ['D2 : zone toujours verte', s => rep(s, "if(gap<0) return {color:'red', qtyMin:ANALYST_ZONE_CUBES_MIN", "if(gap<0) return {color:'green', qtyMin:ANALYST_ZONE_CUBES_MIN"), ['verdict', 'zone']],
  ['D2 : toujours 1 cube dans la zone', s => rep(s, 'const ANALYST_ZONE_CUBES_MIN = 0,', 'const ANALYST_ZONE_CUBES_MIN = 1,'), ['zone']],
  ['D2 : égalité exacte comptée au-dessus', s => rep(s, "if(gap>0) return {color:'green'", "if(gap>=0) return {color:'green'"), ['verdict', 'zone']],
  ['D3 : cubes de l\'émission au sac fondamental', s => rep(s, "cubesInjected += injectTradingCube(company, 'red'", "cubesInjected += injectStockCube(company, 'red'"), ['emission']],
  ['D3 : cubes du rachat au sac fondamental', s => rep(s, "cubesInjected += injectTradingCube(company, 'green'", "cubesInjected += injectStockCube(company, 'green'"), ['emission']],
  ['C4 : σ sans le terme des propriétaires incertains', s => rep(s, 'out[id].v += a*(varN[id]||0) + a*(1-a)*mean[id]*mean[id];', 'out[id].v += a*(1-a)*mean[id]*mean[id];'), ['loyer']],
];

async function runScenario(sc, tf){
  try { await sc.fn(tf); return null; }
  catch(e){ return (e && e.message) ? e.message : String(e); }
}

(async () => {
  const failures = [];
  for(const sc of SCENARIOS){
    console.log(sc.title);
    const err = await runScenario(sc, undefined);
    if(err){ console.log('  ' + err); failures.push(sc.title.slice(0, 50) + ' — ' + err); }
  }
  const nMain = n;
  console.log('E. Versions cassées exprès (mutations)');
  let caught = 0;
  for(const [nm, tf, keys] of MUTATIONS){
    quiet = true;
    let err = null;
    for(const k of keys){ if(err) break; const sc = SCENARIOS.find(x => x.key === k); err = await runScenario(sc, tf); }
    quiet = false;
    const real = !!err && !/motif introuvable/.test(err);
    try { ok(real, `mutation « ${nm} » attrapée — ${err ? err.replace(/^ÉCHEC : /, '').slice(0, 130) : 'non attrapée !'}`); caught++; }
    catch(e){ failures.push(e.message); console.log('  ' + e.message); }
  }
  if(failures.length){
    console.log(`\nÉCHEC : section 323 (analystes) — ${failures.length} échec(s) :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`\nOK : section 323 (analystes, moteur) — ${n} vérifications (${nMain} sur le nouveau code), ${caught}/${MUTATIONS.length} versions cassées attrapées`);
})().catch(e => { console.log('ÉCHEC : ' + (e && e.stack || e)); process.exit(1); });
