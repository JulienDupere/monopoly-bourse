// Section 312 — bogues 10 et 65 de l'audit du 2026-10-19 : ratio d'endettement et plafond du taux.
//   Bogue 10 : quand l'encaisse négative dépassait tous les autres actifs, companyDebtRatio renvoyait 0 : l'entreprise
//              la plus insolvable obtenait la cote AA, le taux de base, la volatilité minimale et échappait à la spirale
//              de détresse. Désormais une encaisse négative compte comme une dette (ratio = dettes / actifs positifs).
//   Bogue 65 : la prime de risque n'était pas plafonnée (taux jusqu'à 15 035 %). Décision de Julien : le taux final ne
//              dépasse jamais le maximum choisi à la création (taux de base + prime max « si 100 % endetté ») ; la
//              subvention d'avance suit.
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section312-ratio.test.js
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

// Ancien code (contre-épreuves).
const ANCIEN_RATIO = src => src.replace(
  /function companyDebtRatio\(company\)\{[\s\S]*?\n\}\nconst DEBT_RATIO_MAX/,
  'function companyDebtRatio(company){\n  const debt = companyDebt(company);\n  const grossAssets = companyValue(company) + debt;\n  return grossAssets>0 ? debt/grossAssets : 0;\n}\nconst DEBT_RATIO_MAX');
const ANCIEN_TAUX = src => src.replace(
  /function riskAdjustedRate\(baseRate, company\)\{[\s\S]*?\n\}/,
  'function riskAdjustedRate(baseRate, company){\n  return baseRate + companyDebtRatio(company) * state.settings.debtSpreadFactor;\n}');

// Partie à deux : A = Alpha (Alice), B = Beta (Bob). Alpha n'a aucun terrain ; une dette de 12,5 M$ (prêt bancaire
// fictif, compté par companyDebt) ; taux hypothécaire de base 35 %, subvention 10 %, prime max 50 %.
async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    state.loans.push({id:'L-test', lenderId:'BANK', lenderKind:'bank', borrowerId:A.id, principal:5, totalDue:12.5, repaidSoFar:0, withholdingPct:0.2, multiple:2.5});`);
  return { eng, ids };
}
const etat = (eng) => eng.json(`({ratio: companyDebtRatio(A), rate: riskAdjustedRate(state.settings.mortgageRate, A), go: goAdvanceAmount(1, A),
  grade: companyCreditRatingInfo(A).grade, insolvent: companyCreditRatingInfo(A).insolvent, vol: volatilityMultiplier(A), sigma: companyAnnualSigma(A),
  distress: companyDebtRatio(A) > state.settings.distressDebtThreshold})`);

// --- Bogue 10 -------------------------------------------------------------------------------------------------
async function bug10(eng){
  eng.run('A.cash = 0.5');
  const s05 = etat(eng);
  eng.run('A.cash = -3');
  const sm3 = etat(eng);
  console.log(`    encaisse 0,5 : ratio ${f4(s05.ratio)}, cote ${s05.grade}, taux ${f4(s05.rate)}, avance ${f4(s05.go)}, volatilité ${f4(s05.vol)}`);
  console.log(`    encaisse −3  : ratio ${f4(sm3.ratio)}, cote ${sm3.grade}, taux ${f4(sm3.rate)}, avance ${f4(sm3.go)}, volatilité ${f4(sm3.vol)}`);
  ok(sm3.ratio >= s05.ratio, `10 : encaisse −3 M$ (pire) → ratio ${f4(sm3.ratio)} ≥ celui à +0,5 M$ (${f4(s05.ratio)})`);
  ok(sm3.grade === 'D' && sm3.insolvent, `10 : encaisse −3 M$ → cote D (« En faillite »), et non AA (obtenu : ${sm3.grade})`);
  ok(near(sm3.rate, 0.85), `10 : encaisse −3 M$ → taux hypothécaire au maximum 85 % (35 % + 50 %), et non le taux de base 35 % (obtenu : ${f4(sm3.rate)})`);
  ok(near(sm3.go, 1.25), `10 : encaisse −3 M$ → 1re subvention d'avance 2/(1+0,6) = 1,25 M$, et non 1,82 M$ (obtenu : ${f4(sm3.go)})`);
  ok(near(sm3.vol, 2.5) && near(sm3.sigma, s05.sigma), `10 : volatilité au plafond 2,5 (et non 1) ; σ annuel des options identique au cas +0,5 M$ (${f4(sm3.sigma)})`);
  ok(sm3.distress === true, '10 : la condition d’endettement de la spirale de détresse est remplie (ratio > seuil 50 %)');
  // Monotonie : plus l'encaisse baisse, plus le ratio monte (jamais de retour à 0).
  const ratios = [20, 5, 0.5, 0.01, 0, -1, -3, -50].map(c => { eng.run(`A.cash = ${c}`); return eng.run('companyDebtRatio(A)'); });
  ok(ratios.every((r, i) => i === 0 || r >= ratios[i - 1] - 1e-12) && ratios.every(r => Number.isFinite(r) && r > 0),
    `10 : ratio croissant quand l'encaisse baisse de 20 à −50 M$, toujours fini et > 0 (${ratios.map(f4).join(' → ')})`);
  // Encaisse négative couverte par d'autres actifs : elle compte comme une dette. Alpha détient une créance de 10 M$
  // (prêt à Beta) ; dette 2 M$ (12,5 → on rembourse 10,5) ; encaisse −1 M$ → ratio (2+1)/10 = 0,30 (avant : 2/9 = 0,222).
  eng.run(`state.loans.find(l=>l.id==='L-test').repaidSoFar = 10.5;
    state.loans.push({id:'L-recv', lenderId:A.id, lenderKind:'company', borrowerId:B.id, principal:4, totalDue:10, repaidSoFar:0, withholdingPct:0.2, multiple:2.5});
    A.cash = -1;`);
  const r1 = eng.run('companyDebtRatio(A)');
  ok(near(r1, 0.3), `10 : créance 10 M$, dette 2 M$, encaisse −1 M$ → ratio 3/10 = 0,30 (obtenu : ${f4(r1)})`);
  // Seuil d'insolvabilité inchangé : ratio ≥ 1 exactement quand la valeur comptable est ≤ 0.
  eng.run('A.cash = -8');
  const atZero = eng.json('({v: companyValue(A), r: companyDebtRatio(A), g: companyCreditRatingInfo(A).grade})');
  eng.run('A.cash = -7.9');
  const above = eng.json('({v: companyValue(A), r: companyDebtRatio(A), g: companyCreditRatingInfo(A).grade})');
  eng.run('A.cash = -10');
  const below = eng.json('({v: companyValue(A), r: companyDebtRatio(A), g: companyCreditRatingInfo(A).grade})');
  ok(near(atZero.v, 0) && near(atZero.r, 1) && atZero.g === 'D', `10 : valeur comptable 0 → ratio 1, cote D (ratio ${f4(atZero.r)})`);
  ok(above.v > 0 && above.r < 1 && above.g !== 'D', `10 : valeur comptable +0,1 → ratio ${f4(above.r)} < 1, pas en faillite (cote ${above.g})`);
  ok(below.v < 0 && below.r > 1 && below.g === 'D', `10 : valeur comptable −2 (encaisse −10 > autres actifs) → ratio ${f4(below.r)} > 1, cote D (avant : ratio 0, cote AA)`);
}

// --- Bogue 65 -------------------------------------------------------------------------------------------------
async function bug65(eng){
  eng.run('A.cash = 0.01');
  const s = etat(eng);
  console.log(`    encaisse 0,01, dette 12,5 : ratio ${f4(s.ratio)}, taux ${f4(s.rate)}, avance ${f4(s.go)}`);
  ok(near(s.rate, 0.85), `65 : taux hypothécaire plafonné à 35 % + 50 % = 85 % (obtenu : ${f4(s.rate)} ; avant : 62 535 %)`);
  ok(near(s.go, 1.25), `65 : 1re subvention d'avance = 2/(1+10 %+50 %) = 1,25 M$ (obtenu : ${f4(s.go)} ; avant : 0,0032)`);
  ok(near(eng.run('goAdvanceAmount(2, A)'), 2 / (1.6 * 1.6)), '65 : 2e subvention d’avance = 2/1,6² = 0,78125 M$');
  ok(near(eng.run('goAdvanceConditions(A.id).rate'), 0.6), '65 : la fenêtre de la subvention affiche le taux plafonné 60 %');
  // Réglage personnalisé : prime max 30 % → taux au plus 35 % + 30 %.
  eng.run('state.settings.debtSpreadFactor = 0.3');
  ok(near(eng.run('riskAdjustedRate(state.settings.mortgageRate, A)'), 0.65), '65 : prime max réglée à 30 % → taux hypothécaire au plus 65 %');
  eng.run('state.settings.debtSpreadFactor = 0.5');
  // Sous 100 % d'endettement, rien ne change : dette 12,5, encaisse 12,5 → ratio 1 ; encaisse 25 → ratio 0,5 → 35 % + 25 %.
  eng.run('A.cash = 25');
  ok(near(eng.run('riskAdjustedRate(state.settings.mortgageRate, A)'), 0.6), '65 : ratio 0,5 → taux 35 % + 0,5 × 50 % = 60 % (inchangé sous le plafond)');
  // Vraie hypothèque bancaire : le taux inscrit sur l'hypothèque est plafonné. Alpha reçoit Boulevard de Belleville seul.
  eng.run(`A.cash = 0.01; globalThis.P = state.properties.find(p=>p.type==='color' && !p.groupMergeId && p.owners.length===0); P.owners = [{companyId:A.id, share:100}];`);
  const tot0 = eng.cashTotal();
  const res = await eng.run(`issueMortgage(P.id, A.id, 'BANK', {silent:true})`);
  const m = eng.json('P.mortgages[0]');
  ok(res && res.ok && m && near(m.rate, 0.85), `65 : hypothèque bancaire inscrite à 85 %/an (obtenu : ${m ? f4(m.rate) : '—'})`);
  ok(near(eng.cashTotal(), tot0), '65 : hypothèque bancaire — monnaie conservée');
}

(async () => {
  await scenario('A. Bogue 10 — encaisse négative = dette ; la plus insolvable a la pire cote', async () => {
    const { eng } = await setup();
    await bug10(eng);
  });
  await scenario('B. Bogue 10 — contre-épreuve (ancien companyDebtRatio)', async () => {
    const { eng } = await setup(ANCIEN_RATIO);
    let failed = null;
    try{ await bug10(eng); }catch(e){ failed = e.message; }
    ok(failed && /10 :/.test(failed), `contre-épreuve : l'ancien calcul échoue (${failed})`);
  });
  await scenario('C. Bogue 65 — taux final plafonné au maximum choisi à la création', async () => {
    const { eng } = await setup();
    await bug65(eng);
  });
  await scenario('D. Bogue 65 — contre-épreuve (ancienne prime non plafonnée)', async () => {
    const { eng } = await setup(ANCIEN_TAUX);
    let failed = null;
    try{ await bug65(eng); }catch(e){ failed = e.message; }
    ok(failed && /65 :/.test(failed), `contre-épreuve : la prime non plafonnée échoue (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\n${n} vérifications, 0 échec`);
})();
