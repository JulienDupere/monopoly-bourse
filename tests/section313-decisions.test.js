// Test — section 313, décisions de Julien (2026-10-25) « Ok go pour tes reco » :
// T. Le plafond de l'indemnité (bogue 39) ne s'applique PLUS aux cases taxe (Impôt sur le revenu, TPS/TVQ) : il ne vise
//    que les loyers. Avant : Impôt assuré avec une valeur de 8 (0,8), sinistre avec une valeur de 20 (2) → l'assuré
//    payait 1,2 de la hausse naturelle de sa valeur.
// S. Contrat normal (annuel ou semestriel) signé sur une case où l'entreprise a déjà une assurance sous-standard : la
//    sous-standard est annulée et sa prime remboursée dans la même action, par son assureur ACTUEL (banque, ou entreprise
//    qui l'a reprise), avec une trace au journal et dans la transaction ; monnaie conservée.
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section313-decisions.test.js
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

// Partie à trois : A = entreprise d'Alice (l'appareil joue Alice), B = entreprise de Bob, propriétaire de Bleu foncé 2
// (case 39, loyer 0,5 sans maison, 20 avec hôtel), C = entreprise de Carl. Début d'année (lancer 0) : les termes Année
// et Semestre sont signables. A est en case 30.
async function partie(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const ids = await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', 'garp']);
  eng.run(`globalThis.__ids = ${JSON.stringify(ids)}; myPlayerId = __ids[0];
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
    globalThis.P = state.properties.find(p=>p.name==='Bleu foncé 2');
    P.owners = [{companyId:B.id, share:100}]; P.houses = 0; P.mortgages = []; P.insurance = null; P.subInsurance = null;
    state.gameClock.rollCount = 0; A.position = 30; A.cash = 50; B.cash = 50; C.cash = 50;
    globalThis.__val = 8; const __cv = companyValue; companyValue = c => (c && c.id===A.id) ? globalThis.__val : __cv(c);`);
  return eng;
}
const snap = eng => eng.json(`({A:A.cash, B:B.cash, C:C.cash, bank:state.bank.cash})`);
async function signer(eng, keys, term, deductible, claimMode = 'recurring'){
  const c = eng.json(`insuranceBundleConditions(A.id, ${JSON.stringify(keys)}, '${claimMode}', '${term}', ${deductible})`);
  if(c.unavailable) return { ok:false, error:c.unavailable, cond:c };
  const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle(${JSON.stringify(c.items.map(i=>({item:{type:i.type, id:i.id, label:i.label}, insurerId:'BANK', premium:i.premium})))}, '${claimMode}', '${term}', {silent:true, deductible:${deductible}, expectedConditions:${JSON.stringify(c)}}))`);
  return Object.assign({ cond:c }, r);
}
const KEY_P = { type:'prop', id:'p21' };
const IMPOT = { type:'tax', id:4 };
// Ancien code du sinistre de taxe (plafond du bogue 39), pour les contre-épreuves.
const PLAFOND_TAXE = s => s.replace(/const insurerPortion = insurerExists\(ins\.insurerId\) \? Math\.max\(0, cost - deductible\) : 0;[^\n]*/, "const insurerPortion = insurerExists(ins.insurerId) ? insuranceIndemnity(cost, deductible, ins, null) : 0;")
  .replace(/coveredAmount:null\}\); \/\/ Section 313 — décision de Julien \(2026-10-25\) : taxe non plafonnée/, 'coveredAmount:s.item.covered});');

(async () => {
  // ---------------------------------------------------------------- T. Taxes non plafonnées
  await scenario('T1 — Impôt sur le revenu assuré avec une valeur de 8 (0,8), sinistre avec une valeur de 20 (2) : l’assureur paie 2', async () => {
    const eng = await partie();
    const r = await signer(eng, [IMPOT], 'year', 0);
    ok(r.ok && eng.run('state.taxInsurances.length') === 1, `Impôt assuré (prime ${f4(r.cond.items[0].premium)}, montant actuel 0,8)`);
    ok(eng.json('state.taxInsurances[0].coveredAmount') === null, 'contrat de taxe signé sans plafond (coveredAmount = null)');
    eng.run('globalThis.__val = 20;');
    const s0 = snap(eng), m0 = eng.cashTotal();
    await eng.run(`payTax(A.id, 4, {skipSave:true})`);
    const s1 = snap(eng);
    ok(near(s0.A - s1.A, 0) && near(s0.bank - s1.bank, 0), `impôt de 2 : A ne paie rien, la banque assureur paie 2 et perçoit 2 — obtenu A ${f4(s0.A - s1.A)} (avant : 1,2)`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
    ok(!/au-delà du montant couvert/.test(JSON.stringify(eng.json('state.log[0]'))), 'journal : aucune part « au-delà du montant couvert »');
  });
  await scenario('T2 — franchise 0,3 : A paie 0,3, l’assureur (B, après reprise) 1,7 ; contrat ancien plafonné à 0,4 : plafond ignoré', async () => {
    const eng = await partie();
    eng.run(`state.taxInsurances = [{id:'t', contractId:'k', taxPos:4, insuredCompanyId:A.id, premium:0.1, insurerId:B.id, deductible:0.3, claimMode:'recurring', signedAtRoll:0, quotedTerm:'year', coveredAmount:0.4}]; globalThis.__val = 20;`);
    const s0 = snap(eng), m0 = eng.cashTotal();
    await eng.run(`payTax(A.id, 4, {skipSave:true})`);
    const s1 = snap(eng);
    ok(near(s0.A - s1.A, 0.3) && near(s0.B - s1.B, 1.7) && near(s1.bank - s0.bank, 2), `A 0,3, B 1,7, banque +2 — obtenu A ${f4(s0.A - s1.A)}, B ${f4(s0.B - s1.B)} (avant : A 1,6, B 0,4)`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
  });
  await scenario('T3 — reprise d’un contrat de taxe : prix calculé sur le montant actuel (2), pas sur un plafond', async () => {
    const eng = await partie();
    eng.run(`state.taxInsurances = [{id:'t', contractId:'k', taxPos:4, insuredCompanyId:A.id, premium:0.1, insurerId:'BANK', deductible:0, claimMode:'recurring', signedAtRoll:0, quotedTerm:'year', coveredAmount:0.8}]; globalThis.__val = 20;`);
    ok(near(eng.json(`liveTakeoverTaxQuote(4, A.id, 'recurring', 0, 'year', 0.8)`).exposure, 2), 'exposition de reprise = 2 (et non 0,8)');
  });
  await scenario('T4 — les loyers restent plafonnés (terrain nu couvert 0,5, hôtel ensuite : assureur 0,5, A 19,5)', async () => {
    const eng = await partie();
    const r = await signer(eng, [KEY_P], 'year', 0);
    ok(r.ok && near(eng.json('P.insurance').coveredAmount, 0.5), 'terrain assuré : couvert 0,5');
    eng.run('P.houses = 5;');
    const s0 = snap(eng), m0 = eng.cashTotal();
    await eng.run(`settlePropertyRent(P, A.id, 9, {skipSave:true})`);
    const s1 = snap(eng);
    ok(near(s0.bank - s1.bank, 0.5) && near(s0.A - s1.A, 19.5) && near(eng.cashTotal(), m0), `hôtel : banque 0,5, A 19,5 — obtenu ${f4(s0.bank - s1.bank)} / ${f4(s0.A - s1.A)}`);
  });
  await scenario('T5 — contre-épreuve : plafond des taxes réintroduit, A paie 1,2 de l’impôt de 2', async () => {
    const eng = await partie({ transform: PLAFOND_TAXE });
    await signer(eng, [IMPOT], 'year', 0);
    eng.run('globalThis.__val = 20;');
    const s0 = snap(eng);
    await eng.run(`payTax(A.id, 4, {skipSave:true})`);
    ok(near(s0.A - snap(eng).A, 1.2), `contre-épreuve : A paie ${f4(s0.A - snap(eng).A)} — le test détecte la régression`);
  });
  await scenario('T6 — contre-épreuve : reprise plafonnée réintroduite, exposition 0,8', async () => {
    const eng = await partie({ transform: s => s.replace("const cost = Math.max(0, taxSquareCost(taxPos, insuredCompanyId) - sanitizeDeductible(originalDeductible)); // Section 313 — bogue 14 ; décision",
      "const cost = capInsuredExposure(Math.max(0, taxSquareCost(taxPos, insuredCompanyId) - sanitizeDeductible(originalDeductible)), coveredAmount); // décision") });
    eng.run('globalThis.__val = 20;');
    ok(near(eng.json(`liveTakeoverTaxQuote(4, A.id, 'recurring', 0, 'year', 0.8)`).exposure, 0.8), 'contre-épreuve : exposition 0,8 — T3 détecte la régression');
  });

  // ---------------------------------------------------------------- S. Sous-standard remboursée automatiquement
  // A signe d'abord une sous-standard sur Bleu foncé 2 (lancer 0), puis un contrat annuel sur la même case.
  async function avecSousStandard(opts = {}){
    const eng = await partie(opts);
    const r = await signer(eng, [KEY_P], 'sub', 0);
    if(!r.ok) throw new Error('sous-standard non signée : ' + r.error);
    return { eng, prime: eng.run('P.subInsurance.premium') };
  }
  await scenario('S1 — contrat annuel sur une case couverte par la sous-standard de A : annulée et remboursée par la banque, dans la même action', async () => {
    const { eng, prime } = await avecSousStandard();
    const c = eng.json(`insuranceBundleConditions(A.id, [${JSON.stringify(KEY_P)}], 'recurring', 'year', 0)`);
    ok(near(c.items[0].subRefund, prime) && c.items[0].subRefundInsurerId === 'BANK', `conditions affichées : remboursement de ${f4(prime)} par la banque`);
    const html = eng.run(`insuranceBundleDescribe(${JSON.stringify(c)})`);
    ok(/sous-standard sur cette case sera annulée et sa prime \([^)]*\) remboursée automatiquement par Banque/.test(html) && !/ne servira plus/.test(html), 'fenêtre de confirmation : mention claire du remboursement (plus d’avertissement « ne servira plus »)');
    const s0 = snap(eng), m0 = eng.cashTotal(), n0 = eng.run('state.log.length');
    const r = await signer(eng, [KEY_P], 'year', 0);
    const s1 = snap(eng);
    ok(r.ok && eng.run('!!P.insurance') && eng.run('P.subInsurance') === null, 'contrat annuel signé ; sous-standard annulée');
    ok(near(s0.A - s1.A, r.cond.total - prime) && near(s1.bank - s0.bank, r.cond.total - prime), `A paie la prime annuelle ${f4(r.cond.total)} et récupère ${f4(prime)} (net ${f4(s0.A - s1.A)})`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
    const lignes = eng.json(`state.log.slice(0, state.log.length - ${n0})`);
    const ligne = lignes.find(e => /contrat groupé/.test(JSON.stringify(e)));
    const txt = JSON.stringify(ligne || {});
    ok(/sous-standard sur Bleu foncé 2 annulée, prime de .+? remboursée par Banque/.test(txt), 'journal : la ligne du contrat mentionne l’annulation et le remboursement');
    ok(ligne && Array.isArray(ligne.entries) && ligne.entries.some(e => near(e.amount, prime) && /remboursement sous-standard/.test(e.label)) && ligne.entries.some(e => near(e.amount, -prime) && /Banque/.test(e.label)), 'transaction du contrat : remboursement +prime à A, −prime à la banque');
  });
  await scenario('S2 — sous-standard reprise par C : c’est C, l’assureur actuel, qui rembourse', async () => {
    const { eng, prime } = await avecSousStandard();
    eng.run('myPlayerId = __ids[2];');
    await eng.run(`takeOverSubInsurance(P.id)`);
    eng.run('myPlayerId = __ids[0];');
    ok(eng.run('P.subInsurance.insurerId') === eng.run('C.id'), 'C a repris la sous-standard (et perçu la prime)');
    const s0 = snap(eng), m0 = eng.cashTotal();
    const r = await signer(eng, [KEY_P], 'year', 0);
    const s1 = snap(eng);
    ok(r.ok && eng.run('P.subInsurance') === null, 'contrat annuel signé, sous-standard annulée');
    ok(near(s0.C - s1.C, prime) && near(s1.bank - s0.bank, r.cond.total), `C rembourse ${f4(prime)} ; la banque garde la prime annuelle ${f4(r.cond.total)}`);
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
  });
  await scenario('S3 — assureur de la sous-standard introuvable : annulée sans remboursement (aucun argent créé)', async () => {
    const { eng } = await avecSousStandard();
    eng.run(`P.subInsurance.insurerId = 'disparue';`);
    const c = eng.json(`insuranceBundleConditions(A.id, [${JSON.stringify(KEY_P)}], 'recurring', 'year', 0)`);
    ok(c.items[0].subRefund === 0 && /annulée sans remboursement/.test(eng.run(`insuranceBundleDescribe(${JSON.stringify(c)})`)), 'fenêtre : « annulée sans remboursement (assureur introuvable) »');
    const s0 = snap(eng), m0 = eng.cashTotal();
    const r = await signer(eng, [KEY_P], 'year', 0);
    ok(r.ok && eng.run('P.subInsurance') === null && near(s0.A - snap(eng).A, r.cond.total), 'sous-standard annulée, A ne récupère rien');
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
  });
  await scenario('S4 — contrat semestriel de A sur une case où la sous-standard est celle d’une AUTRE entreprise (C) : rien n’est annulé', async () => {
    const eng = await partie();
    eng.run(`P.subInsurance = {insuredCompanyId:C.id, premium:0.05, insurerId:'BANK', deductible:0, signedAtRoll:0, coveredAmount:0.5};`);
    const m0 = eng.cashTotal(), s0 = snap(eng);
    const r = await signer(eng, [KEY_P], 'semester', 0);
    ok(r.ok && eng.run('P.subInsurance.insuredCompanyId') === eng.run('C.id') && near(snap(eng).C, s0.C), 'sous-standard de C conservée, C non remboursé');
    ok(near(eng.cashTotal(), m0), 'monnaie conservée');
  });
  await scenario('S5 — sous-standard annulée à la main entre l’affichage et la signature : « conditions changées », rien signé', async () => {
    const { eng } = await avecSousStandard();
    const c = eng.json(`insuranceBundleConditions(A.id, [${JSON.stringify(KEY_P)}], 'recurring', 'year', 0)`);
    await eng.run(`cancelSubInsurance(P.id)`);
    const m0 = eng.cashTotal(), a0 = eng.run('A.cash');
    const r = await eng.run(`attemptActionWithRetry(()=>purchaseInsuranceBundle(${JSON.stringify(c.items.map(i=>({item:{type:i.type, id:i.id, label:i.label}, insurerId:'BANK', premium:i.premium})))}, 'recurring', 'year', {silent:true, deductible:0, expectedConditions:${JSON.stringify(c)}}))`);
    ok(r.ok === false && r.code === 'stale-conditions' && !eng.run('P.insurance') && near(eng.run('A.cash'), a0) && near(eng.cashTotal(), m0), 'refus « conditions changées » : le remboursement affiché n’existe plus');
  });
  await scenario('S6 — contre-épreuve : sans l’annulation automatique, la sous-standard reste et sa prime est perdue', async () => {
    const { eng, prime } = await avecSousStandard({ transform: s => s.replace("if(subInsuranceRefundableOnNormal(p, myCo.id)){", "if(false){") });
    const s0 = snap(eng);
    const r = await signer(eng, [KEY_P], 'year', 0);
    ok(r.ok && eng.run('!!P.subInsurance') && near(s0.A - snap(eng).A, r.cond.total), `contre-épreuve : sous-standard toujours là, A ne récupère pas ${f4(prime)} — S1 détecte la régression`);
  });

  // ---------------------------------------------------------------- I. Remboursement par un assureur introuvable
  // Retouche de la revue des décisions (défaut antérieur) : cancelSubInsurance, mergeGroup, cancelContract et
  // cancelPropInsurance créditaient l'assurée sans débiter personne quand l'assureur avait disparu.
  async function introuvable(opts = {}){
    const out = {};
    let eng = await partie(opts);
    eng.run(`P.subInsurance = {insuredCompanyId:A.id, premium:0.1, insurerId:'disparue', deductible:0, signedAtRoll:0, coveredAmount:0.5};`);
    let m0 = eng.cashTotal();
    await eng.run('cancelSubInsurance(P.id)');
    out.sub = { d: eng.cashTotal() - m0, annulee: eng.run('P.subInsurance') === null, log: dernier(eng) };
    eng = await partie(opts);
    eng.run(`P.insurance = {insuredCompanyId:A.id, premium:0.3, insurerId:'disparue', deductible:0, contractId:'kk', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year', coveredAmount:null};`);
    m0 = eng.cashTotal();
    await eng.run(`cancelContract('kk')`);
    out.contrat = { d: eng.cashTotal() - m0, annulee: eng.run('P.insurance') === null, log: dernier(eng) };
    eng = await partie(opts);
    eng.run(`P.insurance = {insuredCompanyId:A.id, premium:0.3, insurerId:'disparue', deductible:0, contractId:'kk', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year', coveredAmount:null};`);
    m0 = eng.cashTotal();
    await eng.run(`cancelPropInsurance(P.id)`);
    out.prop = { d: eng.cashTotal() - m0, annulee: eng.run('P.insurance') === null };
    eng = await partie(opts);
    eng.run(`myPlayerId = state.creatorId; const L = state.properties.filter(p=>p.group==='BRUN'); L.forEach(p=>{ p.owners=[{companyId:A.id, share:maxPlayerOwnPct()}]; p.houses=0; p.mortgages=[]; });
      L[0].insurance = {insuredCompanyId:B.id, premium:0.2, insurerId:'disparue', deductible:0, contractId:'k', claimMode:'recurring', signedAtRoll:0, quotedTerm:'year', coveredAmount:null};
      L[1].subInsurance = {insuredCompanyId:B.id, premium:0.1, insurerId:'disparue2', deductible:0, signedAtRoll:0, coveredAmount:null};`);
    m0 = eng.cashTotal();
    await eng.run(`mergeGroup('BRUN')`);
    out.lot = { d: eng.cashTotal() - m0, regroupe: !!eng.run(`state.properties.find(p=>p.group==='BRUN').groupMergeId`) };
    return out;
  }
  const dernier = eng => JSON.stringify(eng.json('state.log[0]'));
  await scenario('I1 — assureur introuvable : annulation et regroupement sans remboursement, aucun argent créé', async () => {
    const r = await introuvable();
    ok(r.sub.annulee && near(r.sub.d, 0) && /introuvable : aucun remboursement/.test(r.sub.log), `cancelSubInsurance : annulée, Δ monnaie ${f4(r.sub.d)} (avant : +0,1), trace au journal`);
    ok(r.contrat.annulee && near(r.contrat.d, 0) && /introuvable : aucun remboursement/.test(r.contrat.log), `cancelContract : annulé, Δ monnaie ${f4(r.contrat.d)} (avant : +0,3), trace au journal`);
    ok(r.prop.annulee && near(r.prop.d, 0), `cancelPropInsurance : annulée, Δ monnaie ${f4(r.prop.d)} (avant : +0,3)`);
    ok(r.lot.regroupe && near(r.lot.d, 0), `mergeGroup (normale + sous-standard) : lot regroupé, Δ monnaie ${f4(r.lot.d)} (avant : +0,3)`);
  });
  await scenario('I2 — contre-épreuve : garde retirée, de l’argent est créé aux quatre endroits', async () => {
    const r = await introuvable({ transform: s => s.replace("  if(!insurerExists(insurerId) || !co) return false; // garde : assureur ou assurée introuvable\n", '') });
    ok(near(r.sub.d, 0.1) && near(r.contrat.d, 0.3) && near(r.prop.d, 0.3) && near(r.lot.d, 0.3), `contre-épreuve : +${f4(r.sub.d)}, +${f4(r.contrat.d)}, +${f4(r.prop.d)}, +${f4(r.lot.d)} créés — I1 détecte la régression`);
  });
  await scenario('I3 — assureur existant : remboursement inchangé (banque)', async () => {
    const eng = await partie();
    eng.run(`P.subInsurance = {insuredCompanyId:A.id, premium:0.1, insurerId:'BANK', deductible:0, signedAtRoll:0, coveredAmount:0.5};`);
    const s0 = snap(eng), m0 = eng.cashTotal();
    await eng.run('cancelSubInsurance(P.id)');
    ok(near(snap(eng).A - s0.A, 0.1) && near(s0.bank - snap(eng).bank, 0.1) && near(eng.cashTotal(), m0), 'A récupère 0,1, la banque rembourse 0,1, monnaie conservée');
  });

  if(failures.length){ console.log(`\nÉCHEC : ${failures.length} scénario(s) : ${failures.join(' | ')}`); process.exit(1); }
  console.log(`\nOK : section 313 (décisions de Julien) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e); process.exit(1); });
