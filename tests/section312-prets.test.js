// Section 312 — prêts : bogues 23, 24 et 47 de l'audit du 2026-10-19.
//   Bogue 23 : dans une partie sans l'option « Prêts », le prêt de dernier recours (10 M$ de la banque) n'était jamais
//              remboursé : la retenue de 50 % des loyers dépendait de l'option. Décision : le prêt de dernier recours
//              reste offert (il ne relève pas de l'option « Prêts », qui concerne le marché des obligations entre
//              joueurs et entreprises) et il est TOUJOURS remboursé par sa retenue, sur les quatre chemins du loyer.
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section312-prets.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Ancien code du bogue 23 : retenue des loyers conditionnée à l'option « Prêts », dernier recours compris.
const ANCIEN_23 = src => {
  const out = src.replace(/applyRentLoanWithholding\(([^;]*?)\)(?=;|\s*:)/g, (m, args) => `(state.settings.features.loan ? applyLoanWithholding(${args}) : {net:${args.split(',')[1].trim()}, totalWithheld:0, withholdings:[]})`);
  return out;
};

// Partie à deux, option « Prêts » DÉCOCHÉE. Alpha (A) possède seule Bleu foncé 2 avec 2 maisons (loyer 6 M$) ; Beta (B) y tombe.
async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    state.settings.features.loan = false; state.rentCompensations = []; state.revenueSwaps = [];
    state.neutralPawns.push({id:'pion-test', name:'Pion test', position:0, inJail:false, jailTurnsLeft:0});
    globalThis.P = state.properties.find(p=>p.name==='Bleu foncé 2');
    P.owners = [{companyId:A.id, share:100}]; P.houses = 2; P.mortgages = []; P.insurance = null; P.subInsurance = null;
    B.cash += 100;`);
  return { eng, ids };
}
const snap = eng => eng.json(`({A: A.cash, B: B.cash, bank: state.bank.cash, repaid: (state.loans.find(l=>l.lastResort)||{}).repaidSoFar||0})`);

async function bug23(eng, variantLabel){
  const RENT = eng.run('colorRentAt(P, P.houses)');
  // 1. Prêt de dernier recours dans une partie sans « Prêts ».
  eng.run('A.cash = -1');
  const t0 = eng.cashTotal();
  const res = eng.json('triggerLastResortLoan(A.id)');
  ok(res && res.ok && near(eng.run('A.cash'), 9) && near(eng.cashTotal(), t0), '23 : sans l’option « Prêts », le prêt de dernier recours reste offert : Alpha passe de −1 à 9 M$, monnaie conservée');
  const loan = eng.json('state.loans.find(l=>l.lastResort)');
  ok(loan && near(loan.totalDue, 20) && near(loan.withholdingPct, 0.5), '23 : prêt de 10 M$ à rembourser 20 M$ par une retenue de 50 % des loyers');
  // 2. Loyer ordinaire payé par Beta.
  let s0 = snap(eng), m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  let s1 = snap(eng);
  console.log(`    [${variantLabel}] loyer ${f4(RENT)} payé par Beta : Alpha +${f4(s1.A - s0.A)}, banque +${f4(s1.bank - s0.bank)}, remboursé ${f4(s1.repaid)}`);
  ok(near(s1.B - s0.B, -RENT) && near(s1.A - s0.A, RENT / 2) && near(s1.bank - s0.bank, RENT / 2) && near(s1.repaid, RENT / 2),
    `23 : loyer de ${RENT} M$ payé par Beta : ${RENT / 2} retenus pour la banque, ${RENT / 2} pour Alpha (avant : ${RENT} pour Alpha, rien retenu)`);
  ok(near(eng.cashTotal(), m0), '23 : loyer ordinaire — monnaie conservée');
  // 3. Loyer d'un pion neutre (payé par la banque).
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run(`settleNeutralPawnRent(P, 'pion-test', 7, {skipSave:true})`);
  s1 = snap(eng);
  ok(near(s1.A - s0.A, RENT / 2) && near(s1.bank - s0.bank, -RENT / 2) && near(s1.repaid - s0.repaid, RENT / 2) && near(eng.cashTotal(), m0),
    `23 : pion neutre : la banque verse ${RENT}, en récupère ${RENT / 2} par la retenue ; Alpha reçoit ${RENT / 2} ; monnaie conservée`);
  // 4. Terrain titrisé (ABS sans porteur : rien n'est versé aux porteurs) — chemins jumeaux des deux fonctions.
  eng.run(`state.revenueSwaps = [{id:'abs-test', sellerId:A.id, propertyIds:[P.id], cededPctOfShare:0.6, seniorCapTotal:0, seniorPaidSoFar:0, seniorRaised:0, seniorHolders:[], juniorHolders:[]}]`);
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  await eng.run(`settleNeutralPawnRent(P, 'pion-test', 7, {skipSave:true})`);
  s1 = snap(eng);
  ok(near(s1.repaid - s0.repaid, RENT) && near(s1.A - s0.A, RENT) && near(eng.cashTotal(), m0),
    `23 : terrain sous ABS (Beta puis pion) : ${RENT / 2} retenus à chaque loyer (${RENT} au total), monnaie conservée`);
  eng.run('state.revenueSwaps = []');
  // 5. Accord de compensation : la retenue part en argent, le reste est inscrit au registre.
  eng.run(`state.settings.features.rentCompensation = true; state.rentCompensations = [{id:'comp-test', companyA:B.id, companyB:A.id, balance:0, interestRate:0}]`);
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  s1 = snap(eng);
  const bal = eng.run(`state.rentCompensations[0].balance`);
  ok(near(s1.repaid - s0.repaid, RENT / 2) && near(Math.abs(bal), RENT / 2) && near(s1.B - s0.B, -RENT / 2) && near(eng.cashTotal(), m0),
    `23 : accord de compensation : ${RENT / 2} versés en argent à la banque (retenue), ${RENT / 2} inscrits au registre ; monnaie conservée`);
  const repaid = eng.json('state.loans.find(l=>l.lastResort).repaidSoFar');
  ok(near(repaid, 2.5 * RENT), `23 : au total ${f4(repaid)} M$ remboursés sur 20 (5 retenues de la moitié d’un loyer de ${RENT} M$)`);
}

(async () => {
  await scenario('A. Bogue 23 — le prêt de dernier recours est remboursé même sans l’option « Prêts »', async () => {
    const { eng } = await setup();
    await bug23(eng, 'corrigé');
  });
  await scenario('B. Bogue 23 — contre-épreuve (retenue conditionnée à l’option)', async () => {
    const { eng } = await setup(ANCIEN_23);
    let failed = null;
    try{ await bug23(eng, 'ancien'); }catch(e){ failed = e.message; }
    ok(failed && /23 :/.test(failed), `contre-épreuve : l'ancien code échoue (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\n${n} vérifications, 0 échec`);
})();
