// Test — Section 317 (seconde moitié), bogue 88 : le regroupement d'un lot efface l'historique des coûts et des loyers.
// Avant : « Mon Entreprise » lit la clé du lot (« lot:… ») après le regroupement, mais l'historique est rangé sous la clé
// de chaque terrain (« prop:… ») : coûts et loyers tombent à 0 et le profit du lot est faux.
// Après : les statistiques d'affichage sont reportées sous la clé du lot au regroupement (aucune encaisse ne bouge).
// Lancer depuis la racine du dépôt :  node tests/section317b-lot.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

async function setup(opts = {}){
  const doc = creerDocument();
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: () => {} } });
  await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.P = id => state.properties.find(p=>p.id===id);
           myPlayerId = state.creatorId;
           P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}];`);
  return eng;
}

(async () => {
  console.log('Bogue 88 — le regroupement garde l\'historique des coûts et des loyers');
  const scenario = async (opts) => {
    const eng = await setup(opts);
    // Co Bob a payé 0,9 M$ de terrains (0,5 + 0,4) et touché 0,1 M$ de loyer (0,06 + 0,04) ; Co Alice 0,3 de coût et 0,2 de loyer.
    eng.run(`addRealEstateCapex('prop:p0', C1.id, 0.5); addRealEstateCapex('prop:p1', C1.id, 0.4);
             addRealEstateRevenue('prop:p0', C1.id, 0.06); addRealEstateRevenue('prop:p1', C1.id, 0.04);
             addRealEstateCapex('prop:p0', C0.id, 0.3); addRealEstateRevenue('prop:p1', C0.id, 0.2);`);
    const total0 = eng.cashTotal();
    eng.run(`mergeGroup('BRUN')`); await settle();
    return { eng, total0 };
  };
  const { eng, total0 } = await scenario();
  ok(eng.run(`!!P('p0').groupMergeId && P('p0').groupMergeId === P('p1').groupMergeId`), 'le lot Brun est regroupé');
  const read = (co) => eng.json(`(function(){ const k = realEstateKeyFor(P('p0')); return {capex: companyRealEstateCapex(k, ${co}.id), revenue: companyRealEstateRevenue(k, ${co}.id)}; })()`);
  let b = read('C1'), a = read('C0');
  ok(near(b.capex, 0.9) && near(b.revenue, 0.1), `Co Bob : coûts 0,90 et loyers 0,10 conservés sous la clé du lot (${JSON.stringify(b)}) — avant : 0 et 0`);
  ok(near(a.capex, 0.3) && near(a.revenue, 0.2), `Co Alice : coûts 0,30 et loyers 0,20 conservés (${JSON.stringify(a)})`);
  // Une maison à 0,2 après le regroupement : profit affiché = 0,1 − (0,9 + 0,2) = −1,0 (et non −0,2).
  eng.run(`addRealEstateCapex(realEstateKeyFor(P('p0')), C1.id, 0.2)`);
  b = read('C1');
  ok(near(b.revenue - b.capex, -1.0), `après une maison à 0,2 M$ : profit du lot de Co Bob = ${(b.revenue - b.capex).toFixed(2)} (attendu −1,00 ; avant : −0,20)`);
  ok(eng.json(`Object.keys(state.realEstateCapex).filter(k=>k==='prop:p0'||k==='prop:p1')`).length === 0, 'les clés « prop:… » reportées sont retirées : aucun double compte');
  ok(near(eng.cashTotal(), total0), `aucune encaisse ne bouge (${total0} → ${eng.cashTotal()})`);
  // Partie ancienne (rien d'enregistré) : le regroupement fonctionne sans erreur, statistiques à zéro.
  const eng2 = await setup();
  eng2.run(`state.realEstateCapex = undefined; state.realEstateRevenue = undefined;`);
  eng2.run(`mergeGroup('BRUN')`); await settle();
  ok(eng2.run(`!!P('p0').groupMergeId`) && eng2.run(`companyRealEstateCapex(realEstateKeyFor(P('p0')), C1.id)`) === 0, 'ancienne partie sans statistiques : regroupement sans erreur, zéros');
  // Contre-épreuve : sans le report, le test échoue.
  const X = await scenario({ transform: s => s.replace("Object.keys(old).forEach(cid=>add('lot:'+mergeId, cid, old[cid]));", '') });
  const xb = X.eng.json(`(function(){ const k = realEstateKeyFor(P('p0')); return companyRealEstateCapex(k, C1.id); })()`);
  ok(xb === 0, `contre-épreuve (report retiré) : coûts de Co Bob = ${xb} après le regroupement — le test détecte la régression`);
  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
