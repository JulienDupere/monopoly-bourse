// Test — Section 313 : assurance (bogues 14, 15, 39, 40, 48, 49 et 52 de l'audit du 2026-10-19), côté moteur.
//
// 14 : une franchise négative (champ « Franchise » à −5) élargissait la couverture au-delà du loyer : l'assureur
//      payait 5,5 pour un loyer de 0,5 et 5 M$ disparaissaient. La franchise est désormais bornée par le moteur.
// 15 / 49 : la prime affichée à l'ouverture était réutilisée à la confirmation (nouvelle franchise, ou position
//      changée par un lancer) : le moteur recalcule la prime sur l'état frais et refuse (« conditions changées »)
//      si elle diffère de celle confirmée.
// 39 (décision de Julien) : l'indemnité est plafonnée au montant couvert affiché à la signature.
// 40 : un type d'assurance désactivé par le créateur ne se vend plus.
// 48 : une case taxe déjà assurée par l'entreprise n'est plus reproposée ni revendue.
// 52 : pas d'assurance sous-standard sur un terrain déjà couvert par la propre assurance normale de l'entreprise.
//
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section313-assurance.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Partie à deux : A = entreprise d'Alice (l'appareil joue Alice), B = entreprise de Bob, propriétaire de Bleu foncé 2
// (case 39, loyer 0,5 sans maison, 20 avec hôtel). Début d'année (lancer 0) : les termes Année et Semestre sont
// signables. A est en case 30.
async function partie(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    globalThis.P = state.properties.find(p=>p.name==='Bleu foncé 2');
    P.owners = [{companyId:B.id, share:100}]; P.houses = 0; P.mortgages = []; P.insurance = null; P.subInsurance = null;
    state.gameClock.rollCount = 0; A.position = 30; A.cash = 50; B.cash = 50;`);
  return eng;
}
const snap = eng => eng.json(`({A:A.cash, B:B.cash, bank:state.bank.cash})`);
// Achat d'un contrat groupé auprès de la banque, comme la fenêtre : conditions recalculées puis confirmées.
async function signer(eng, keys, term, deductible, claimMode = 'recurring'){
  const c = eng.json(`insuranceBundleConditions(A.id, ${JSON.stringify(keys)}, '${claimMode}', '${term}', ${deductible})`);
  if(c.unavailable) return { ok:false, error:c.unavailable, cond:c };
  const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle(${JSON.stringify(c.items.map(i=>({item:{type:i.type, id:i.id, label:i.label}, insurerId:'BANK', premium:i.premium})))}, '${claimMode}', '${term}', {silent:true, deductible:${deductible}, expectedConditions:${JSON.stringify(c)}}))`);
  return Object.assign({ cond:c }, r);
}
const KEY_P = { type:'prop', id:'p21' };

(async () => {
  // ---------------------------------------------------------------- Bogue 14
  await scenario('14a — la franchise du tour refuse un montant négatif (moteur, pas seulement le champ)', async () => {
    const eng = await partie();
    const r = await eng.run(`setTurnDeductible(-5)`);
    ok(r && r.ok === false, `setTurnDeductible(−5) est refusée (${r && r.error})`);
    ok(eng.run('A.currentDeductible') === 0, 'la franchise du tour reste à 0');
    const r2 = await eng.run(`setTurnDeductible(0.2)`);
    ok(r2 && r2.ok && near(eng.run('A.currentDeductible'), 0.2), 'setTurnDeductible(0,2) est acceptée');
    const m0 = eng.cashTotal(), s0 = snap(eng);
    const r3 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:1.62}], 'recurring', 'year', {silent:true, deductible:-5}))`);
    ok(r3 && r3.ok === false && !eng.run('P.insurance'), `contrat à franchise −5 refusé par le moteur (${r3 && r3.error})`);
    ok(near(snap(eng).A, s0.A) && near(eng.cashTotal(), m0), 'rien n’a été payé');
  });

  await scenario('14b — ancienne partie : franchise du tour à −5 ramenée à 0, cotation à 0,5 « à risque » (et non 5,5)', async () => {
    const eng = await partie();
    eng.run(`A.currentDeductible = -5; migrateState(state);`);
    ok(eng.run('A.currentDeductible') === 0, 'migrateState ramène la franchise négative à 0');
    eng.run(`A.currentDeductible = -5;`);   // valeur négative encore présente (appareil non migré) : cotation bornée
    const q = eng.json(`insuranceQuote(P, A.id, 'recurring', 6)`);
    ok(near(q.exposure, 0.5), `exposition cotée 0,5 avec une franchise stockée à −5 (obtenu ${f4(q.exposure)})`);
    const qt = eng.json(`taxInsuranceQuote(38, A.id, 'recurring', 6)`);
    ok(near(qt.exposure, 1), `TPS/TVQ cotée 1 (et non 6) (obtenu ${f4(qt.exposure)})`);
  });

  await scenario('14c — contrat existant à franchise −5 : le loyer de 0,5 ne détruit plus 5 M$', async () => {
    const eng = await partie();
    eng.run(`P.insurance = {insuredCompanyId:A.id, premium:1.62, insurerId:'BANK', deductible:-5, contractId:'c1', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year'};`);
    const m0 = eng.cashTotal(), s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    const s1 = snap(eng), m1 = eng.cashTotal();
    console.log(`    A ${f4(s1.A - s0.A)}, B ${f4(s1.B - s0.B)}, banque ${f4(s1.bank - s0.bank)}, masse ${f4(m1 - m0)}`);
    ok(near(m1, m0), `masse monétaire conservée (écart ${f4(m1 - m0)} ; avant : −5)`);
    ok(near(s1.B - s0.B, 0.5) && near(s1.bank - s0.bank, -0.5) && near(s1.A - s0.A, 0), 'la banque (assureur) paie 0,5, B reçoit 0,5, A ne paie rien');
  });

  await scenario('14d — taxe assurée à franchise −5 (assureur = B) : la TPS/TVQ de 1 ne détruit plus 5 M$', async () => {
    const eng = await partie();
    eng.run(`state.taxInsurances = [{id:'t1', contractId:'c2', taxPos:38, insuredCompanyId:A.id, premium:0.3, insurerId:B.id, deductible:-5, claimMode:'recurring', signedAtRoll:0, quotedTerm:'year'}];`);
    const m0 = eng.cashTotal(), s0 = snap(eng);
    await eng.run(`payTax(A.id, 38, {skipSave:true})`);
    const s1 = snap(eng), m1 = eng.cashTotal();
    console.log(`    A ${f4(s1.A - s0.A)}, B ${f4(s1.B - s0.B)}, banque ${f4(s1.bank - s0.bank)}, masse ${f4(m1 - m0)}`);
    ok(near(m1, m0), `masse monétaire conservée (écart ${f4(m1 - m0)})`);
    ok(near(s1.B - s0.B, -1) && near(s1.bank - s0.bank, 1) && near(s1.A - s0.A, 0), 'B (assureur) paie 1, la banque perçoit 1, A ne paie rien');
  });

  await scenario('14e — contre-épreuve : ancienne franchise non bornée au sinistre → 5 M$ détruits', async () => {
    const eng = await partie({ transform: s => s.replace("const deductible = Math.min(sanitizeDeductible(insured.deductible), payable);", "const deductible = Math.min(insured.deductible||0, payable);") });
    eng.run(`P.insurance = {insuredCompanyId:A.id, premium:1.62, insurerId:'BANK', deductible:-5, contractId:'c1', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year'};`);
    const m0 = eng.cashTotal();
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    ok(near(eng.cashTotal() - m0, -5), `contre-épreuve : 5 M$ disparaissent avec l'ancien code (écart ${f4(eng.cashTotal() - m0)})`);
  });

  // ---------------------------------------------------------------- Bogue 39
  await scenario('39a — terrain nu assuré (0,5 couvert), hôtel construit ensuite : l’assureur paie 0,5, A le reste', async () => {
    const eng = await partie();
    const r = await signer(eng, [KEY_P], 'year', 0);
    ok(r.ok, 'contrat annuel signé sur Bleu foncé 2 sans maison');
    const ins = eng.json('P.insurance');
    console.log(`    prime ${f4(ins.premium)}, montant couvert ${f4(ins.coveredAmount)}`);
    ok(near(ins.coveredAmount, 0.5) && near(ins.coveredAmount, r.cond.items[0].covered), 'le contrat enregistre le montant couvert affiché (0,5)');
    eng.run('P.houses = 5;');
    ok(near(eng.run('colorRentAt(P, P.houses)'), 20), 'B construit un hôtel : loyer 20');
    const m0 = eng.cashTotal(), s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    const s1 = snap(eng);
    console.log(`    A ${f4(s1.A - s0.A)}, B ${f4(s1.B - s0.B)}, banque ${f4(s1.bank - s0.bank)}`);
    ok(near(s1.bank - s0.bank, -0.5), `la banque (assureur) paie 0,5 (avant : 20) — obtenu ${f4(s0.bank - s1.bank)}`);
    ok(near(s1.A - s0.A, -19.5), `A paie l’excédent : 19,5 (obtenu ${f4(s0.A - s1.A)})`);
    ok(near(s1.B - s0.B, 20) && near(eng.cashTotal(), m0), 'B reçoit le loyer entier (20) ; monnaie conservée');
    const led = eng.json(`state.finLedger.filter(e=>e.companyId===A.id && e.category==='insurance_claim_revenue').map(e=>e.amount)`);
    ok(near(led[led.length - 1], 0.5), 'état des résultats de A : indemnité de 0,5');
  });

  await scenario('39b — franchise 0,2, signé avec 2 maisons (couvert 5,8) ; hôtel, puis loyer redescendu sous la signature : indemnité = loyer − franchise', async () => {
    const eng = await partie();
    eng.run('P.houses = 2;');   // loyer 6
    const r = await signer(eng, [KEY_P], 'year', 0.2);
    ok(r.ok && near(eng.json('P.insurance').coveredAmount, 5.8) && near(eng.json('P.insurance').deductible, 0.2), 'signé avec 2 maisons et franchise 0,2 : couvert 5,8');
    eng.run('P.houses = 5;');
    let s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    let s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 5.8) && near(s0.A - s1.A, 14.2), `hôtel (20) : banque 5,8, A 14,2 (franchise 0,2 + excédent 14) — obtenu ${f4(s0.bank - s1.bank)} / ${f4(s0.A - s1.A)}`);
    eng.run('P.houses = 0;');
    s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 0.3) && near(s0.A - s1.A, 0.2), `terrain nu (0,5) : banque 0,3, A 0,2 — obtenu ${f4(s0.bank - s1.bank)} / ${f4(s0.A - s1.A)}`);
  });

  await scenario('39c — sous-standard et taxe : même plafond', async () => {
    const eng = await partie();
    eng.run('state.gameClock.rollCount = 1; A.position = 30;');
    const r = await signer(eng, [KEY_P], 'sub', 0);
    ok(r.ok && near(eng.json('P.subInsurance').coveredAmount, 0.5), 'sous-standard signée : couvert 0,5');
    eng.run('P.houses = 5;');
    let s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    let s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 0.5) && near(s0.A - s1.A, 19.5), `hôtel : banque 0,5, A 19,5 — obtenu ${f4(s0.bank - s1.bank)} / ${f4(s0.A - s1.A)}`);
    // Impôt sur le revenu : 10 % de la valeur, au plus 2. Valeur 8 à la signature (impôt 0,8), 20 au sinistre (2).
    eng.run(`state.gameClock.rollCount = 0; globalThis.__val = 8; const __cv = companyValue; companyValue = c => (c && c.id===A.id) ? globalThis.__val : __cv(c);`);
    const rt = await signer(eng, [{ type:'tax', id:4 }], 'year', 0);
    ok(rt.ok && near(eng.json('state.taxInsurances[0].coveredAmount'), 0.8), 'Impôt assuré avec une valeur de 8 : couvert 0,8');
    eng.run('globalThis.__val = 20;');
    s0 = snap(eng); const m0 = eng.cashTotal();
    await eng.run(`payTax(A.id, 4, {skipSave:true})`);
    s1 = snap(eng);
    ok(near(s0.A - s1.A, 1.2) && near(s1.bank - s0.bank, 2 - 0.8) && near(eng.cashTotal(), m0), `impôt de 2 : assureur 0,8, A 1,2 ; monnaie conservée — obtenu A ${f4(s0.A - s1.A)}`);
  });

  await scenario('39d — service : plafond ramené au lancer réel (montant affiché pour 7) ; 2e service acheté ensuite', async () => {
    const eng = await partie();
    eng.run(`globalThis.S1 = state.properties.find(p=>p.name==='Service 1'); globalThis.S2 = state.properties.find(p=>p.name==='Service 2');
      S1.owners = [{companyId:B.id, share:100}]; S1.mortgages = []; S1.insurance = null; S2.owners = []; A.position = 2;`);
    const r = await signer(eng, [{ type:'prop', id:eng.run('S1.id') }], 'year', 0);
    const cov = eng.json('S1.insurance').coveredAmount;
    ok(r.ok && near(cov, 0.04 * 7), `service assuré : couvert ${f4(cov)} (multiplicateur 0,04 × 7)`);
    let s0 = snap(eng);
    await eng.run(`settlePropertyRent(S1, A.id, 12, {skipSave:true})`);
    let s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 0.48) && near(s0.A - s1.A, 0), `lancer de 12, rien n’a changé : la banque paie tout (0,48) — obtenu ${f4(s0.bank - s1.bank)}`);
    eng.run(`S2.owners = [{companyId:B.id, share:100}]; S2.mortgages = [];`);   // multiplicateur 0,1
    s0 = snap(eng); const m0 = eng.cashTotal();
    await eng.run(`settlePropertyRent(S1, A.id, 12, {skipSave:true})`);
    s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 0.48) && near(s0.A - s1.A, 0.72) && near(eng.cashTotal(), m0), `2e service acquis après la signature (loyer 1,2) : banque 0,48, A 0,72 — obtenu ${f4(s0.bank - s1.bank)} / ${f4(s0.A - s1.A)}`);
  });

  await scenario('39e — contrat signé avant la mise à jour : aucun plafond (règle de sa signature) ; reprise plafonnée', async () => {
    const eng = await partie();
    eng.run(`P.insurance = {insuredCompanyId:A.id, premium:0.12, insurerId:'BANK', deductible:0, contractId:'c1', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year'}; migrateState(state);`);
    ok(eng.json('P.insurance').coveredAmount === null, 'migrateState : coveredAmount = null (non plafonné)');
    eng.run('P.houses = 5;');
    const s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    const s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 20) && near(s0.A - s1.A, 0), 'ancien contrat : l’assureur paie le loyer entier (20), comme promis à la signature');
    // Reprise d'un contrat plafonné : le prix de reprise ne porte que sur le montant couvert.
    eng.run(`P.insurance = null; P.houses = 0;`);
    await signer(eng, [KEY_P], 'year', 0);
    eng.run('P.houses = 5;');
    const live = eng.json(`liveTakeoverPropQuote(P, A.id, 'recurring', 0, 'year', P.insurance.coveredAmount)`);
    ok(near(live.exposure, 0.5), `prix de reprise calculé sur 0,5 couvert (et non 20) — exposition ${f4(live.exposure)}`);
  });

  await scenario('39f — contre-épreuve : sans plafond, l’assureur paie l’hôtel entier', async () => {
    const eng = await partie({ transform: s => s.replace("const insurerPortion = insuranceIndemnity(payable, deductible, insured, p.type==='service' ? diceTotal : null);", "const insurerPortion = payable - deductible;") });
    await signer(eng, [KEY_P], 'year', 0);
    eng.run('P.houses = 5;');
    const s0 = snap(eng);
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    ok(near(s0.bank - snap(eng).bank, 20), 'contre-épreuve : la banque paie 20 avec l’ancien code');
  });

  // ---------------------------------------------------------------- Bogue 40
  await scenario('40a — sous-standard désactivée : refusée par le moteur ; assurance normale désactivée : refusée', async () => {
    const eng = await partie();
    eng.run(`state.settings.features.subInsurance = false; state.gameClock.rollCount = 1;`);
    const m0 = eng.cashTotal(), a0 = eng.run('A.cash');
    const c = eng.json(`insuranceBundleConditions(A.id, [{type:'prop', id:'p21'}], 'recurring', 'sub', 0)`);
    ok(!!c.unavailable, `conditions : « ${c.unavailable} »`);
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${eng.run("subInsuranceQuote(P, A.id).ceil")}}], 'recurring', 'sub', {silent:true}))`);
    ok(r.ok === false && !eng.run('P.subInsurance'), `contrat sous-standard refusé (${r.error})`);
    const r2 = await eng.run(`attemptActionWithRetry(()=>buySubInsurance('p21', A.id, 'BANK', 0.11, {silent:true}))`);
    ok(r2.ok === false && !eng.run('P.subInsurance'), 'buySubInsurance refusée elle aussi');
    ok(near(eng.run('A.cash'), a0) && near(eng.cashTotal(), m0), 'aucune prime payée');
    ok(eng.run(`defaultInsuranceTerm()`) === null, 'aucun terme proposé au lancer 1 (normale hors fenêtre, sous-standard désactivée)');
    eng.run(`state.settings.features.subInsurance = true; state.settings.features.insurance = false; state.gameClock.rollCount = 0;`);
    const r3 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${eng.run("insuranceQuote(P, A.id, 'recurring', 6).ceil")}}], 'recurring', 'year', {silent:true}))`);
    ok(r3.ok === false && !eng.run('P.insurance'), `contrat annuel refusé quand l’assurance normale est désactivée (${r3.error})`);
    ok(eng.run(`defaultInsuranceTerm()`) === 'sub', 'au début d’année, seul le sous-standard est proposé');
    eng.run(`state.settings.features.insurance = true;`);
    ok((await signer(eng, [KEY_P], 'year', 0)).ok, 'témoin : les deux activées, le contrat annuel se signe');
  });

  await scenario('40b — contre-épreuve : sans le refus du moteur, le sous-standard désactivé se vend', async () => {
    // Les trois refus du moteur (contrat groupé, conditions, achat sous-standard) retirés : retour à l'ancien code.
    const eng = await partie({ transform: s => s
      .replace("if(!insuranceTermEnabled(term)) return fail(insuranceTermDisabledMessage(term));", "")
      .replace("if(!insuranceTermEnabled(term)) return {unavailable:insuranceTermDisabledMessage(term)};", "")
      .replace("if(!insuranceTermEnabled('sub')) return fail(insuranceTermDisabledMessage('sub'));", "") });
    eng.run(`state.settings.features.subInsurance = false; state.gameClock.rollCount = 1;`);
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${eng.run("subInsuranceQuote(P, A.id).ceil")}}], 'recurring', 'sub', {silent:true}))`);
    ok(r.ok && !!eng.run('P.subInsurance'), `contre-épreuve : le sous-standard désactivé se vend avec l’ancien code`);
  });

  // ---------------------------------------------------------------- Bogue 48
  await scenario('48a — TPS/TVQ assurée : plus reproposée, 2e achat refusé ; B peut toujours l’assurer pour lui', async () => {
    const eng = await partie();
    const r = await signer(eng, [{ type:'tax', id:38 }], 'year', 0);
    ok(r.ok && eng.run('state.taxInsurances.length') === 1, `TPS/TVQ assurée par A (prime ${f4(r.cond.items[0].premium)})`);
    ok(!eng.json(`insurableItems(A.id, 'recurring', 6)`).some(x => x.type === 'tax' && x.id === 38), 'la TPS/TVQ n’est plus proposée à A');
    const a0 = eng.run('A.cash'), m0 = eng.cashTotal();
    const prem = eng.run(`taxInsuranceQuote(38, A.id, 'recurring', 6).ceil`);
    const r2 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'tax', id:38, label:'TPS/TVQ'}, insurerId:'BANK', premium:${prem}}], 'recurring', 'year', {silent:true}))`);
    ok(r2.ok === false && eng.run('state.taxInsurances.length') === 1, `2e contrat sur la TPS/TVQ refusé (${r2.error})`);
    ok(near(eng.run('A.cash'), a0) && near(eng.cashTotal(), m0), 'la 2e prime n’est pas payée');
    eng.run('B.position = 30;');
    ok(eng.json(`insurableItems(B.id, 'recurring', 6)`).some(x => x.type === 'tax' && x.id === 38), 'B peut toujours assurer la TPS/TVQ pour lui-même');
  });

  await scenario('48b — contre-épreuve : sans le filtre, la TPS/TVQ est reproposée', async () => {
    const eng = await partie({ transform: s => s.replace(".filter(t=>!state.taxInsurances.some(ti=>ti.taxPos===t.pos && ti.insuredCompanyId===companyId))", "") });
    await signer(eng, [{ type:'tax', id:38 }], 'year', 0);
    ok(eng.json(`insurableItems(A.id, 'recurring', 6)`).some(x => x.type === 'tax' && x.id === 38), 'contre-épreuve : la case est reproposée avec l’ancien code');
  });

  // ---------------------------------------------------------------- Bogue 52
  await scenario('52a — terrain couvert par la propre assurance normale de A : sous-standard refusée ; couvert pour B : permise', async () => {
    const eng = await partie();
    await signer(eng, [KEY_P], 'year', 0);
    ok(eng.json('P.insurance').insuredCompanyId === eng.run('A.id'), 'A assure Bleu foncé 2 à l’année');
    ok(!eng.json(`subInsurableItems(A.id)`).some(x => x.id === 'p21'), 'Bleu foncé 2 n’est plus proposé en sous-standard à A');
    const a0 = eng.run('A.cash'), m0 = eng.cashTotal();
    const r = await eng.run(`attemptActionWithRetry(()=>buySubInsurance('p21', A.id, 'BANK', 0.1667, {silent:true}))`);
    ok(r.ok === false && !eng.run('P.subInsurance'), `buySubInsurance refusée (${r.error})`);
    const r2 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${eng.run("subInsuranceQuote(P, A.id).ceil")}}], 'recurring', 'sub', {silent:true}))`);
    ok(r2.ok === false && !eng.run('P.subInsurance'), `contrat groupé sous-standard refusé (${r2.error})`);
    ok(near(eng.run('A.cash'), a0) && near(eng.cashTotal(), m0), 'aucune prime payée');
    eng.run(`P.insurance.insuredCompanyId = B.id;`);   // l'assurance normale couvre B, pas A
    ok(eng.json(`subInsurableItems(A.id)`).some(x => x.id === 'p21'), 'si l’assurance normale couvre une autre entreprise, A peut prendre le sous-standard');
  });

  await scenario('52b — contre-épreuve : sans le filtre, le sous-standard est proposé', async () => {
    const eng = await partie({ transform: s => s.replace(".filter(p=>!(p.insurance && p.insurance.insuredCompanyId===companyId))", "") });
    await signer(eng, [KEY_P], 'year', 0);
    ok(eng.json(`subInsurableItems(A.id)`).some(x => x.id === 'p21'), 'contre-épreuve : proposé avec l’ancien code');
  });

  // ---------------------------------------------------------------- Bogues 15 et 49 (moteur)
  await scenario('15a — prime affichée avec la franchise 1,9, franchise passée à 0 avant l’enregistrement : refus « conditions changées »', async () => {
    const eng = await partie();
    eng.run('A.currentDeductible = 1.9;');
    const shown = eng.json(`insuranceBundleConditions(A.id, [{type:'tax', id:4}], 'recurring', 'year', 1.9)`);
    console.log(`    affiché : prime ${f4(shown.items[0].premium)} pour ${f4(shown.items[0].covered)} couvert`);
    eng.run('A.currentDeductible = 0;');   // la franchise du tour vient d'être enregistrée à 0 (action précédente)
    const a0 = eng.run('A.cash'), m0 = eng.cashTotal();
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'tax', id:4, label:'Impôt sur le revenu'}, insurerId:'BANK', premium:${shown.items[0].premium}}], 'recurring', 'year', {silent:true}))`);
    ok(r.ok === false && r.code === 'stale-conditions', `l’ancienne prime n’est pas acceptée pour la franchise 0 (${r.code})`);
    ok(eng.run('state.taxInsurances.length') === 0 && near(eng.run('A.cash'), a0) && near(eng.cashTotal(), m0), 'rien n’est signé ni payé');
    const fresh = eng.json(`insuranceBundleConditions(A.id, [{type:'tax', id:4}], 'recurring', 'year', 0)`);
    const r2 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'tax', id:4, label:'Impôt sur le revenu'}, insurerId:'BANK', premium:${fresh.items[0].premium}}], 'recurring', 'year', {silent:true, deductible:0, expectedConditions:${JSON.stringify(fresh)}}))`);
    const t = eng.json('state.taxInsurances[0]');
    ok(r2.ok && t && near(t.premium, fresh.items[0].premium) && t.deductible === 0, `après nouvelle confirmation : contrat à franchise 0 au juste prix ${f4(fresh.items[0].premium)} (et non ${f4(shown.items[0].premium)})`);
    ok(near(eng.run('A.cash'), a0 - fresh.items[0].premium) && near(eng.cashTotal(), m0), 'prime payée = prime confirmée ; monnaie conservée');
  });

  await scenario('15b — conditions confirmées à une franchise, enregistrement demandé à une autre : refus', async () => {
    const eng = await partie();
    const c19 = eng.json(`insuranceBundleConditions(A.id, [{type:'tax', id:4}], 'recurring', 'year', 1.9)`);
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'tax', id:4, label:'Impôt'}, insurerId:'BANK', premium:${c19.items[0].premium}}], 'recurring', 'year', {silent:true, deductible:0, expectedConditions:${JSON.stringify(c19)}}))`);
    ok(r.ok === false && r.code === 'stale-conditions' && eng.run('state.taxInsurances.length') === 0, 'refus : la franchise saisie ne correspond pas aux conditions confirmées');
  });

  await scenario('49a — sous-standard cotée en case 37 (1/36), pion déplacé en case 32 (6/36) avant la confirmation : refus', async () => {
    const eng = await partie();
    eng.run('state.gameClock.rollCount = 1; A.position = 37;');
    const shown = eng.json(`insuranceBundleConditions(A.id, [{type:'prop', id:'p21'}], 'recurring', 'sub', 0)`);
    eng.run('A.position = 32;');   // un lancer joué sur un autre appareil
    const fresh = eng.json(`insuranceBundleConditions(A.id, [{type:'prop', id:'p21'}], 'recurring', 'sub', 0)`);
    console.log(`    prime affichée ${f4(shown.items[0].premium)}, prime à jour ${f4(fresh.items[0].premium)}`);
    ok(near(fresh.items[0].premium, 6 * shown.items[0].premium), 'la prime à jour est 6 fois l’ancienne (6/36 contre 1/36)');
    const a0 = eng.run('A.cash');
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${shown.items[0].premium}}], 'recurring', 'sub', {silent:true, deductible:0, expectedConditions:${JSON.stringify(shown)}}))`);
    ok(r.ok === false && r.code === 'stale-conditions' && !eng.run('P.subInsurance') && near(eng.run('A.cash'), a0), 'refus « conditions changées », rien signé ni payé');
    const r2 = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${shown.items[0].premium}}], 'recurring', 'sub', {silent:true}))`);
    ok(r2.ok === false && r2.code === 'stale-conditions' && !eng.run('P.subInsurance'), 'sans conditions confirmées non plus : la prime passée doit égaler la prime à jour');
  });

  await scenario('49b — contre-épreuve : sans la revérification, le contrat est signé à l’ancienne prime', async () => {
    const eng = await partie({ transform: s => s.replace("if(opts.expectedConditions ? !sameConditions(opts.expectedConditions, fresh) : premiumMismatch) return staleConditionsResult();", "") });
    eng.run('state.gameClock.rollCount = 1; A.position = 37;');
    const shown = eng.json(`insuranceBundleConditions(A.id, [{type:'prop', id:'p21'}], 'recurring', 'sub', 0)`);
    eng.run('A.position = 32;');
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle([{item:{type:'prop', id:'p21', label:'Bleu foncé 2'}, insurerId:'BANK', premium:${shown.items[0].premium}}], 'recurring', 'sub', {silent:true, deductible:0, expectedConditions:${JSON.stringify(shown)}}))`);
    ok(r.ok && !!eng.run('P.subInsurance'), 'contre-épreuve : contrat signé malgré le changement de position');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 313 (assurance, moteur) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
