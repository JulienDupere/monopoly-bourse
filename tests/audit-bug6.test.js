// Test — audit, bogue 6 : l'impôt sur le revenu (case 4) ne doit JAMAIS être négatif.
// Règle (RESUME §10, Cahier 0) : « prélève 10 % de la valeur de l'entreprise, au plus 2 M$ ».
// Une entreprise dont la valeur comptable est négative (dettes > actifs) ne paie rien et ne reçoit rien :
//   - sans assurance, la banque ne doit pas la subventionner ;
//   - avec une assurance taxe signée plus tôt, aucune monnaie ne doit être détruite.
// Vérifie aussi le cas normal (10 %), le plafond de 2 M$, la case TPS/TVQ (1 M$ fixe) et les cotations d'assurance.
// Lancer depuis la racine du dépôt :  node tests/audit-bug6.test.js
const { loadEngine, near } = require('./helpers/engine');

let nChecks = 0;
const failures = [];
function check(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  nChecks++;
  console.log('  OK', msg);
}
const f4 = (x) => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Nouvelle partie à deux : A = entreprise d'Alice (dividende), B = entreprise de Bob (garp). Valeur 20 M$ chacune.
async function setup(){
  const eng = loadEngine();
  const ids = await eng.newGame(['Alice', 'Bob'], ['dividende', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; state.gameClock.rollCount = 0;`);
  return { eng, ids };
}

// Transfert conservatif (loyers simulés) : `who` verse `amount` à `to`.
function transfer(eng, who, to, amount){ eng.run(`${who}.cash -= ${amount}; ${to}.cash += ${amount};`); }

// Vrai lancer corePerformDiceRoll avec dés pipés.
async function roll(eng, who, from, d1, d2){
  eng.run(`${who}.position = ${from};`);
  const seq = [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01];
  let i = 0;
  const real = Math.random;
  Math.random = () => (i < seq.length ? seq[i++] : 0.5);
  try { return await eng.run(`corePerformDiceRoll(${who})`); }
  finally { Math.random = real; }
}

function snap(eng){
  return {
    A: eng.run('A.cash'), B: eng.run('B.cash'), bank: eng.run('state.bank.cash'),
    total: eng.cashTotal(), ledger: eng.run('state.finLedger.length'),
  };
}
function ledgerSince(eng, n){
  return eng.json(`state.finLedger.slice(${n}).map(e=>({who: e.companyId===A.id?'A':(e.companyId===B.id?'B':e.companyId), cat:e.category, amt:e.amount}))`);
}

// Atterrissage sur la case 4 d'une entreprise à valeur négative : aucun mouvement d'argent, grand livre muet.
async function expectNoTaxMovement(eng, tag){
  const v = eng.run('companyValue(A)');
  check(v < 0, `${tag} : la valeur d'Alpha est bien négative (${f4(v)} M$)`);
  const cost = eng.run('taxSquareCost(4, A.id)');
  const s0 = snap(eng);
  const r = await roll(eng, 'A', 0, 1, 3);
  const s1 = snap(eng);
  check(eng.run('A.position') === 4, `${tag} : le lancer 1+3 amène Alpha de la case 0 à la case 4`);
  check(near(s1.total, s0.total), `${tag} : masse monétaire conservée (${f4(s0.total)} → ${f4(s1.total)})`);
  check(near(s1.A, s0.A), `${tag} : l'encaisse d'Alpha ne bouge pas (${f4(s0.A)} → ${f4(s1.A)})`);
  check(near(s1.B, s0.B), `${tag} : l'encaisse de Beta ne bouge pas (${f4(s0.B)} → ${f4(s1.B)})`);
  check(near(s1.bank, s0.bank), `${tag} : la banque ne verse rien (${f4(s0.bank)} → ${f4(s1.bank)})`);
  const led = ledgerSince(eng, s0.ledger).filter(e => /tax|insurance_claim/.test(e.cat));
  check(led.length === 0, `${tag} : aucune écriture d'impôt ni de sinistre au grand livre (${JSON.stringify(led)})`);
  const entries = (r && r.taxEntries) || [];
  check(entries.every(e => near(e.amount, 0)), `${tag} : les écritures de la transaction sont toutes nulles (${JSON.stringify(entries)})`);
  check(cost === 0, `${tag} : taxSquareCost(4) vaut 0 et non 10 % d'une valeur négative (obtenu ${f4(cost)})`);
}

// Achat d'une assurance taxe case 4 par Alpha, avec le vrai purchaseInsuranceBundle, quand sa valeur est positive.
async function insureTax(eng, insurer, deductible){
  eng.run(`myCompany = function(){ return A; }; A.currentDeductible = ${deductible};`);
  const q = eng.json(`taxInsuranceQuote(4, A.id, 'recurring')`);
  check(q.exposure > 0, `assurance : exposition positive au moment de la signature (${f4(q.exposure)})`);
  const before = eng.cashTotal();
  const insurerId = insurer === 'BANK' ? `'BANK'` : `${insurer}.id`;
  const res = await eng.run(`purchaseInsuranceBundle([{item:{type:'tax', id:4, label:'Impôt sur le revenu'}, insurerId:${insurerId}, premium:${Math.max(q.floor, 0.01)}}], 'recurring', 'year', {silent:true})`);
  check(res && res.ok, `assurance : contrat taxe case 4 signé auprès de ${insurer === 'BANK' ? 'la Banque' : 'Beta'}, franchise ${deductible}`);
  check(near(eng.cashTotal(), before), 'assurance : la prime conserve la masse monétaire');
  check(eng.run(`state.taxInsurances.filter(t=>t.insuredCompanyId===A.id && t.taxPos===4).length`) === 1, 'assurance : contrat actif sur la case 4');
}

async function scenario(name, fn){
  console.log(`\n— ${name}`);
  try { await fn(); }
  catch(e){ failures.push(name); console.log('  ' + e.message); }
}

(async () => {
  // ---------- 1. Entreprise normale : 10 % de sa valeur ----------
  await scenario('1. Entreprise normale (valeur 8 M$) : impôt = 10 %', async () => {
    const { eng } = await setup();
    transfer(eng, 'A', 'B', 12);
    const v = eng.run('companyValue(A)');
    const cost = eng.run('taxSquareCost(4, A.id)');
    check(near(v, 8), `valeur d'Alpha = 8 M$ (obtenu ${f4(v)})`);
    check(near(cost, 0.8), `taxSquareCost(4) = 10 % de 8 = 0,8 M$ (obtenu ${f4(cost)})`);
    const s0 = snap(eng);
    await roll(eng, 'A', 0, 1, 3);
    const s1 = snap(eng);
    check(near(s1.A - s0.A, -0.8), `Alpha paie 0,8 M$ (Δ ${f4(s1.A - s0.A)})`);
    check(near(s1.bank - s0.bank, 0.8), `la banque perçoit 0,8 M$ (Δ ${f4(s1.bank - s0.bank)})`);
    check(near(s1.total, s0.total), 'masse monétaire conservée');
    const led = ledgerSince(eng, s0.ledger).filter(e => e.cat === 'tax_expense');
    check(led.length === 1 && near(led[0].amt, -0.8), `grand livre : tax_expense = −0,8 (${JSON.stringify(led)})`);
  });

  // ---------- 2. Entreprise très riche : plafond de 2 M$ ----------
  await scenario('2. Entreprise très riche : plafond de 2 M$', async () => {
    const { eng } = await setup();
    transfer(eng, 'A', 'B', 12);              // B vaut 32 M$
    eng.run(`state.bank.cash -= 100; B.cash += 100;`); // puis 132 M$ (transfert conservatif depuis la banque)
    const v = eng.run('companyValue(B)');
    const cost = eng.run('taxSquareCost(4, B.id)');
    check(v > 100, `valeur de Beta > 100 M$ (obtenu ${f4(v)})`);
    check(cost === 2, `taxSquareCost(4) plafonné à 2 M$ (obtenu ${f4(cost)})`);
    const s0 = snap(eng);
    await roll(eng, 'B', 0, 1, 3);
    const s1 = snap(eng);
    check(near(s1.B - s0.B, -2), `Beta paie exactement 2 M$ (Δ ${f4(s1.B - s0.B)})`);
    check(near(s1.bank - s0.bank, 2), `la banque perçoit 2 M$ (Δ ${f4(s1.bank - s0.bank)})`);
    check(near(s1.total, s0.total), 'masse monétaire conservée');
    // Valeur exactement nulle : impôt nul.
    eng.run(`A.cash -= companyValue(A);`);
    check(near(eng.run('companyValue(A)'), 0) && eng.run('taxSquareCost(4, A.id)') === 0, 'valeur nulle : impôt nul');
  });

  // ---------- 3. Valeur négative, non assurée — variantes de la fiche ----------
  await scenario('3a. Non assurée, 5 subventions d\'avance (valeur −9 M$, fiche C60)', async () => {
    const { eng } = await setup();
    for(let i = 0; i < 5; i++) await eng.run(`takeGoAdvance(A.id)`);
    check(eng.run('A.goAdvancesOwed') === 5, '5 subventions d\'avance prises avec le vrai takeGoAdvance');
    transfer(eng, 'A', 'B', eng.run('A.cash') - 1);
    check(near(eng.run('companyValue(A)'), -9), `valeur d'Alpha = −9 M$ (obtenu ${f4(eng.run('companyValue(A)'))})`);
    await expectNoTaxMovement(eng, '3a');
  });

  await scenario('3b. Non assurée, prêt de 5 M$ à 2,5× (valeur −5,5 M$, fiche C6)', async () => {
    const { eng, ids } = await setup();
    const ok = await eng.run(`issueLoan(${JSON.stringify(ids[1])}, A.id, 5, 0.2, 2.5, false, {silent:true})`);
    check(ok === true, 'prêt non garanti de Bob à Alpha : 5 M$ à 2,5× (vrai issueLoan)');
    transfer(eng, 'A', 'B', eng.run('A.cash') - 7);
    check(near(eng.run('companyValue(A)'), -5.5), `valeur d'Alpha = −5,5 M$ (obtenu ${f4(eng.run('companyValue(A)'))})`);
    await expectNoTaxMovement(eng, '3b');
  });

  await scenario('3c. Non assurée, encaisse négative −5 M$ puis prêt de dernier recours', async () => {
    const { eng } = await setup();
    transfer(eng, 'A', 'B', eng.run('A.cash') + 5);
    check(near(eng.run('A.cash'), -5), 'encaisse d\'Alpha = −5 M$ (tolérée hors frontière de semestre)');
    await expectNoTaxMovement(eng, '3c (encaisse −5)');
    const res = eng.json(`triggerLastResortLoan(A.id)`);
    check(res && res.ok !== false, 'prêt de dernier recours accordé (vrai triggerLastResortLoan)');
    await expectNoTaxMovement(eng, '3c (après dernier recours)');
  });

  // ---------- 4. Valeur négative, assurée — la monnaie ne doit pas être détruite ----------
  await scenario('4a. Assurée auprès de Beta (franchise 0,1), puis valeur −9 M$', async () => {
    const { eng } = await setup();
    await insureTax(eng, 'B', 0.1);
    for(let i = 0; i < 5; i++) await eng.run(`takeGoAdvance(A.id)`);
    transfer(eng, 'A', 'B', eng.run('A.cash') - 1);
    await expectNoTaxMovement(eng, '4a');
    check(eng.run(`state.taxInsurances.filter(t=>t.insuredCompanyId===A.id && t.taxPos===4).length`) === 1, '4a : le contrat récurrent reste actif');
  });

  await scenario('4b. Assurée auprès de la Banque (franchise 0), puis encaisse −8 M$ (fiche C19)', async () => {
    const { eng } = await setup();
    await insureTax(eng, 'BANK', 0);
    transfer(eng, 'A', 'B', eng.run('A.cash') + 8);
    check(near(eng.run('companyValue(A)'), -8), `valeur d'Alpha = −8 M$ (obtenu ${f4(eng.run('companyValue(A)'))})`);
    await expectNoTaxMovement(eng, '4b');
  });

  await scenario('4c. Assurée auprès de Beta, prêt 5 M$ à 2,5× puis dernier recours (fiche C6 d)', async () => {
    const { eng, ids } = await setup();
    await insureTax(eng, 'B', 0.1);
    check(await eng.run(`issueLoan(${JSON.stringify(ids[1])}, A.id, 5, 0.2, 2.5, false, {silent:true})`) === true, 'prêt de 5 M$ à 2,5× accordé');
    transfer(eng, 'A', 'B', eng.run('A.cash') + 1);
    eng.json(`triggerLastResortLoan(A.id)`);
    check(eng.run('companyValue(A)') < -20, `valeur d'Alpha sous −20 M$ (obtenu ${f4(eng.run('companyValue(A)'))})`);
    await expectNoTaxMovement(eng, '4c');
  });

  // ---------- 5. Témoin assuré à valeur positive : le partage franchise / assureur reste inchangé ----------
  await scenario('5. Témoin : assurée auprès de Beta (franchise 0,1), valeur 8 M$', async () => {
    const { eng } = await setup();
    await insureTax(eng, 'B', 0.1);
    transfer(eng, 'A', 'B', eng.run('companyValue(A)') - 8);
    check(near(eng.run('taxSquareCost(4, A.id)'), 0.8), 'impôt = 0,8 M$');
    const s0 = snap(eng);
    await roll(eng, 'A', 0, 1, 3);
    const s1 = snap(eng);
    check(near(s1.A - s0.A, -0.1), `Alpha paie la franchise de 0,1 M$ (Δ ${f4(s1.A - s0.A)})`);
    check(near(s1.B - s0.B, -0.7), `Beta (assureur) paie 0,7 M$ (Δ ${f4(s1.B - s0.B)})`);
    check(near(s1.bank - s0.bank, 0.8), `la banque perçoit 0,8 M$ (Δ ${f4(s1.bank - s0.bank)})`);
    check(near(s1.total, s0.total), 'masse monétaire conservée');
  });

  // ---------- 6. Cotations d'assurance et TPS/TVQ ----------
  await scenario('6. Cotations d\'assurance et case TPS/TVQ (1 M$ fixe)', async () => {
    const { eng } = await setup();
    transfer(eng, 'A', 'B', eng.run('A.cash') + 5);   // valeur −5
    check(eng.json(`taxInsuranceQuote(4, A.id, 'recurring')`).exposure === 0, 'taxInsuranceQuote : exposition nulle à valeur négative');
    check(eng.json(`liveTakeoverTaxQuote(4, A.id, 'recurring', 0, 'year')`).exposure === 0, 'liveTakeoverTaxQuote : exposition nulle à valeur négative');
    check(!eng.json(`insurableItems(A.id, 'recurring').map(x=>x.type+':'+x.id)`).includes('tax:4'), 'insurableItems : la case 4 n\'est pas proposée à valeur négative');
    check(eng.run('taxSquareCost(38, A.id)') === 1 && eng.run('taxSquareCost(38, B.id)') === 1, 'TPS/TVQ : 1 M$ fixe, quelle que soit la valeur');
    const s0 = snap(eng);
    await roll(eng, 'A', 34, 1, 3);
    const s1 = snap(eng);
    check(eng.run('A.position') === 38, 'le lancer 1+3 amène Alpha de la case 34 à la case 38');
    check(near(s1.A - s0.A, -1) && near(s1.bank - s0.bank, 1), `TPS/TVQ : Alpha paie 1 M$ à la banque même à valeur négative (Δ ${f4(s1.A - s0.A)})`);
    check(near(s1.total, s0.total), 'TPS/TVQ : masse monétaire conservée');
  });

  if(failures.length){
    console.log(`\n${nChecks} vérifications passées avant les échecs`);
    console.log(`ÉCHEC : ${failures.length} scénario(s) en échec : ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log(`\n${nChecks} vérifications OK`);
})().catch(e => { console.error(e); process.exit(1); });
