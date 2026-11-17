// Vérifications de départ : probabilités par case, cas calculé à la main, qui paie le loyer d'un pion neutre.
const { chargerMoteur } = require('./moteur');
const { seedOf } = require('./rng');
const { stationnaire } = require('./plateau');
const { modele } = require('./analystes');

// p.prob (PROPERTY_DEFS) contre la fréquence exacte (chaîne de Markov du plateau) et la fréquence simulée par le vrai
// corePerformNeutralPawnRoll.
async function verifierProbas(nRolls){
  const eng = chargerMoteur(seedOf('freq', 0));
  await eng.run(`createGame(['A','B'], 50, 1000, 'M$', {}, ['P'])`);
  const counts = await eng.S.__pawnFreq(nRolls);
  const defs = eng.json(`PROPERTY_DEFS.map(d=>({name:d[0], prob:d[5], pos:d[6]}))`);
  const ex = stationnaire();
  const rows = [];
  for(let sq=0; sq<40; sq++){
    const d = defs.find(x => x.pos === sq);
    const sim = counts[sq] / nRolls;
    const ic = 1.96 * Math.sqrt(sim * (1 - sim) / nRolls);
    rows.push({sq, name: d ? d.name : (sq===4||sq===38 ? 'Taxe '+sq : (sq===30 ? '→ Prison' : (sq===10?'Prison':(sq===0?'GO':'case '+sq)))),
      prob: d ? d.prob : null, exact: ex.land[sq], sim, ic, ecartRel: d ? (d.prob - ex.land[sq]) / ex.land[sq] : null});
  }
  return { nRolls, rows, exact: ex };
}

// Cas à la main : une entreprise A (seule) possède Orange 3 (case 19) avec 2 maisons (loyer 2,2 M$) ; un pion neutre
// part de la case 12, A de la case 31 (elle ne peut pas atteindre la case 30 en 3 lancers, donc jamais sous enquête).
// Probabilité que le pion s'arrête sur 19 en 3 lancers : 6/36 + 20/1296 + 6/46656 = 8502/46656.
async function casMain(N){
  const eng = chargerMoteur(1);
  await eng.run(`createGame(['A','B'], 50, 1000, 'M$', {}, ['P'])`);
  await eng.run(`createCompany(state.players[0].id, 'Co A', '', 'garp', null, null, null)`);
  eng.run(`state.companies.forEach(c=>applyCompanyIpoFunding(c)); (function(){ const p = state.properties.find(x=>x.pos===19); p.owners=[{companyId: state.companies[0].id, share:100}]; p.houses=2; })(); state.log=[];`);
  const rent = eng.json(`colorRentAt(state.properties.find(x=>x.pos===19), 2)`);
  const main = rent * 8502 / 46656;
  eng.S.__setPositions([31], [12]);
  eng.S.__save();
  const table = await eng.S.__rentTable();
  const st = eng.S.__startOfSemester();
  const mq = modele(st, table, null, [0], true)[st.cos[0].id];
  let s = 0, q = 0;
  for(let i=0;i<N;i++){
    eng.S.__restore(); eng.rng.seed(seedOf('main', i));
    for(let t=0;t<3;t++) await eng.S.__tour();
    const x = eng.json(`(incomeStatementFor(state.companies[0].id, 0).revenues.rent_revenue||0)`);
    s += x; q += x*x;
  }
  const mean = s / N, sd = Math.sqrt(q/N - mean*mean);
  // Même cas en régime établi : le pion joue 12 tours d'échauffement (il peut être sous enquête au début du semestre
  // mesuré, comme dans une vraie partie), A est replacée en 31 ; puis M (fréquences exactes, n_v = 3 − tours d'enquête
  // restants), M' (positions et enquêtes) et la simulation du semestre suivant (semestre 4).
  const ex = stationnaire();
  let s2 = 0, q2 = 0, sM = 0, sMq = 0, jailedStart = 0;
  for(let i=0;i<N;i++){
    eng.S.__restore(); eng.rng.seed(seedOf('main-stat', i));
    let u = eng.rng.random(), acc = 0, k = 0; for(; k<40; k++){ acc += ex.pos[k]; if(u < acc) break; }
    eng.S.__setPositions([31], [Math.min(k, 39)]);
    for(let t=0;t<12;t++) await eng.S.__tour();
    eng.run(`(function(){ const c = state.companies[0]; c.position = 31; c.inJail = false; c.jailTurnsLeft = 0; })()`);
    const st2 = eng.S.__startOfSemester();
    if(st2.pawns[0].inJail) jailedStart++;
    sM += modele(st2, table, ex.land, [0], false)[st2.cos[0].id].ErPawn;
    sMq += modele(st2, table, null, [0], true)[st2.cos[0].id].ErPawn;
    for(let t=0;t<3;t++) await eng.S.__tour();
    const x = eng.json(`(incomeStatementFor(state.companies[0].id, 4).revenues.rent_revenue||0)`);
    s2 += x; q2 += x*x;
  }
  const m2 = s2 / N, sd2 = Math.sqrt(q2/N - m2*m2);
  return { rent, main, modelePositions: mq.ErPawn, simulation: mean, icSim: 1.96 * sd / Math.sqrt(N), N,
    regime: { formule: 3 * ex.land[19] * rent, modeleM: sM / N, modelePositions: sMq / N, simulation: m2, icSim: 1.96 * sd2 / Math.sqrt(N), sousEnqueteAuDebut: jailedStart / N } };
}

// Qui paie le loyer d'un pion neutre : la banque (settleNeutralPawnRent : state.bank.cash -= payable).
async function payeurPionNeutre(){
  const eng = chargerMoteur(1);
  await eng.run(`createGame(['A','B'], 50, 1000, 'M$', {}, ['P'])`);
  await eng.run(`createCompany(state.players[0].id, 'Co A', '', 'garp', null, null, null)`);
  eng.run(`state.companies.forEach(c=>applyCompanyIpoFunding(c)); (function(){ const p = state.properties.find(x=>x.pos===19); p.owners=[{companyId: state.companies[0].id, share:100}]; p.houses=2; })();`);
  const before = eng.json(`({bank: state.bank.cash, co: state.companies[0].cash, players: state.players.map(p=>p.cash), total: (state.bank.cash||0)+state.companies.reduce((s,c)=>s+c.cash,0)+state.players.reduce((s,p)=>s+p.cash,0)})`);
  await eng.run(`settleNeutralPawnRent(state.properties.find(x=>x.pos===19), state.neutralPawns[0].id, 7, {skipSave:true})`);
  const after = eng.json(`({bank: state.bank.cash, co: state.companies[0].cash, players: state.players.map(p=>p.cash), total: (state.bank.cash||0)+state.companies.reduce((s,c)=>s+c.cash,0)+state.players.reduce((s,p)=>s+p.cash,0)})`);
  return { banque: after.bank - before.bank, entreprise: after.co - before.co, joueurs: after.players.map((x, i) => x - before.players[i]), total: after.total - before.total };
}

// Ronde 2, correction 6 : le tour du banc (__tour) contre le vrai performRollForAllCompanies, même graine, 12 lancers,
// sur une situation milieu 8+3. Le rendu est neutralisé (render() tire du hasard par svgLineChart) ; on mesure aussi,
// pour mémoire, ce que donne le vrai lancer avec le rendu actif.
async function verifierTour(specFn, nSeeds){
  const eng = chargerMoteur(1);
  await eng.S.__setup(specFn());
  eng.S.__save();
  const photo = () => eng.json(`({pos: state.companies.map(c=>[c.position, c.inJail, c.jailTurnsLeft]), pions: (state.neutralPawns||[]).map(p=>[p.position, p.inJail]),
    cours: state.companies.map(c=>c.stockPrice), cash: state.companies.map(c=>c.cash), banque: state.bank.cash,
    sacs: state.companies.map(c=>[c.stockReserve, c.typeReserve]), livre: state.finLedger.map(e=>[e.companyId, e.semesterIndex, e.category, e.amount]),
    tour: state.gameClock.rollCount})`);
  const origRender = eng.S.render;
  let egal = 0, egalRendu = 0;
  const ecarts = [];
  for(let k=0;k<nSeeds;k++){
    eng.S.__restore(); eng.rng.seed(seedOf('tour', k));
    for(let t=0;t<12;t++) await eng.S.__tour();
    const a = JSON.stringify(photo());
    eng.S.__restore(); eng.rng.seed(seedOf('tour', k));
    eng.run(`render = function(){}`);
    for(let t=0;t<12;t++) await eng.run(`performRollForAllCompanies({})`);
    const b = JSON.stringify(photo());
    eng.S.render = origRender;
    eng.S.__restore(); eng.rng.seed(seedOf('tour', k));
    for(let t=0;t<12;t++) await eng.run(`performRollForAllCompanies({})`);
    const c = JSON.stringify(photo());
    if(a === b) egal++; else ecarts.push(k);
    if(a === c) egalRendu++;
  }
  return { nSeeds, egalRenduNeutralise: egal, egalRenduActif: egalRendu, ecarts };
}

module.exports = { verifierProbas, casMain, payeurPionNeutre, verifierTour };
