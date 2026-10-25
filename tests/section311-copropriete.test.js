// Test — Section 311, bogue 30 : aéroports et services en copropriété : la valeur et le prix d'une ABS utilisaient le
// palier du PREMIER copropriétaire de la liste. Correctif : palier du vrai propriétaire de la part (expectedRentValue /
// intrinsicValue avec companyId) ; sans entreprise, moyenne des paliers pondérée par les parts (indépendante de l'ordre).
// Lancer depuis la racine du dépôt :  node tests/section311-copropriete.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function setup(opts){
  const eng = loadEngine(opts);
  const { run } = eng;
  await eng.newGame(['Zéro', 'Un', 'Deux'], ['garp', 'garp', 'garp']);
  // Scénario de l'audit : Co0 détient la moitié de l'Aéroport 1 et les trois autres aéroports en entier ; Co1 détient
  // l'autre moitié de l'Aéroport 1 seulement. Même chose pour les services (Co0 : Service 1 à moitié et Service 2).
  run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1];
       state.settings.features.revenueSwap = true;
       const full = maxPlayerOwnPct(), half = full/2;
       globalThis.AE = [1,2,3,4].map(i=>state.properties.find(p=>p.name==='Aéroport '+i));
       globalThis.SV = [1,2].map(i=>state.properties.find(p=>p.name==='Service '+i));
       AE.forEach((p,i)=>{ p.owners = i===0 ? [{companyId:C0.id, share:half}, {companyId:C1.id, share:half}] : [{companyId:C0.id, share:full}]; p.mortgages = []; });
       SV.forEach((p,i)=>{ p.owners = i===0 ? [{companyId:C0.id, share:half}, {companyId:C1.id, share:half}] : [{companyId:C0.id, share:full}]; p.mortgages = []; });
       globalThis.flip = ()=>{ AE[0].owners.reverse(); SV[0].owners.reverse(); };`);
  return eng;
}
function measure(eng){
  const { run } = eng;
  return {
    absMean: run(`computeAbsPricing(C1.id, [AE[0].id], 0.6, 1).meanRent`),
    absMeanSvc: run(`computeAbsPricing(C1.id, [SV[0].id], 0.6, 1).meanRent`),
    reC1: run(`companyRealEstateValue(C1)`), reC0: run(`companyRealEstateValue(C0)`),
    ivProp: run(`intrinsicValue(AE[0])`),
  };
}

(async () => {
  console.log('1 — palier du vrai propriétaire, indépendant de l’ordre');
  {
    const eng = await setup();
    const { run } = eng;
    const rent1 = run(`AE[0].rent[0]`), rent4 = run(`AE[0].rent[3]`);
    ok(near(run(`expectedRentValue(AE[0], C1.id)`), rent1) && near(run(`expectedRentValue(AE[0], C0.id)`), rent4),
      `Aéroport 1 : palier de Co1 ${rent1} (1 aéroport), de Co0 ${rent4} (4 aéroports)`);
    const a = measure(eng); run(`flip()`); const b = measure(eng);
    console.log(`  ABS de Co1 sur sa moitié d'Aéroport 1 (1 an, 60 %) : espérance ${f(a.absMean)} (ordre inversé ${f(b.absMean)})`);
    console.log(`  valeur immobilière Co1 ${f(a.reC1)} / ${f(b.reC1)} ; Co0 ${f(a.reC0)} / ${f(b.reC0)}`);
    // Espérance attendue : 6 lancers × probabilité × (nombre d'entreprises − 1) visiteurs × loyer au palier 1 × part × 60 %.
    const expected = run(`6 * AE[0].prob * (activeCompanies().length-1) * AE[0].rent[0] * (maxPlayerOwnPct()/2/100) * 0.6`);
    ok(near(a.absMean, expected) && near(b.absMean, expected), `espérance de l'ABS de Co1 au palier 1 (${f(expected)}), quel que soit l'ordre`);
    const expectedSvc = run(`6 * SV[0].prob * (activeCompanies().length-1) * 7 * SV[0].rent[0] * (maxPlayerOwnPct()/2/100) * 0.6`);
    ok(near(a.absMeanSvc, expectedSvc) && near(b.absMeanSvc, expectedSvc), `service : espérance de l'ABS de Co1 au palier 1 (${f(expectedSvc)})`);
    ok(near(a.reC1, b.reC1) && near(a.reC0, b.reC0), 'valeurs immobilières de Co0 et Co1 indépendantes de l’ordre des copropriétaires');
    ok(near(a.ivProp, b.ivProp), `valeur du terrain seul (moyenne pondérée des paliers) indépendante de l’ordre (${f(a.ivProp)})`);
    // Cohérence avec le loyer réellement encaissé : groupRentSettlement paie chaque copropriétaire à son propre palier.
    const cut = run(`groupRentSettlement(AE[0], state.companies[2].id, null).cuts.find(c=>c.companyId===C1.id).amount`);
    ok(near(cut, rent1 * run(`maxPlayerOwnPct()/2/100`)), `loyer réellement versé à Co1 par visite : ${f(cut)} (palier 1), cohérent avec le prix`);
  }
  console.log('2 — contre-épreuve : palier du premier copropriétaire réintroduit');
  {
    const eng = await setup({ transform: (src) => src.replace("  if(companyId===undefined){\n    const ownedPct",
      "  companyId = p.owners[0] ? p.owners[0].companyId : null;\n  if(false){\n    const ownedPct") });
    const { run } = eng;
    const a = measure(eng); run(`flip()`); const b = measure(eng);
    console.log(`  code d'avant : espérance ABS Co1 ${f(a.absMean)} (ordre inversé ${f(b.absMean)}) ; valeur immobilière Co1 ${f(a.reC1)} / ${f(b.reC1)}`);
    ok(near(a.absMean / b.absMean, run(`AE[0].rent[3] / AE[0].rent[0]`)), 'sans le correctif : l’ABS de Co1 est tarifée 8 fois trop cher quand Co0 est listée en premier');
    ok(!near(a.reC1, b.reC1), 'sans le correctif : la valeur immobilière de Co1 change avec l’ordre');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
