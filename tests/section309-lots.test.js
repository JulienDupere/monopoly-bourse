// Test — section 309 (lot 2 de l'audit du 2026-10-19 : immobilier, parts et maisons) : échange de parts, hypothèque et
// regroupement de lot. Bogue 16 (l'échange de parts transférait des parts hypothéquées ou sous ABS), bogue 34
// (hypothèque d'un terrain seul acceptée après le regroupement du lot), bogue 35 (échange d'un terrain seul confirmé
// après le regroupement), bogue 63 (le regroupement pouvait arrondir une petite part à 0 %). Décisions de Julien : le
// regroupement reste permis au-delà du plafond de copropriétaires, et ce plafond ne vaut qu'à l'achat initial d'un
// terrain individuel (bogue 64 voulu, non corrigé).
//
// Chaque correctif a sa contre-épreuve (loadEngine({transform})). Lancer :  node tests/section309-lots.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           globalThis.P = id => state.properties.find(p=>p.id===id);
           globalThis.as = i => { myPlayerId = state.players[i].id; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           globalThis.own = id => JSON.stringify(P(id).owners);`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.champ = (id, v) => { doc.trouver(id).value = String(v); };
  return E;
}
// Brun 1 (p0) : Co Alice 100 % ; Brun 2 (p1) : Co Bob 100 %.
const BRUN_SEPARE = `P('p0').owners=[{companyId:C0.id,share:100}]; P('p1').owners=[{companyId:C1.id,share:100}]; as(0);`;
const SWAP_100 = `act(()=>executeShareSwap('prop','p0',C0.id,100,'prop','p1',C1.id,100,{silent:true}))`;

(async () => {
  // ---------- Bogue 16 : échange de parts hypothéquées ou sous ABS ----------
  console.log('Bogue 16 — échange de parts (Administration) : mêmes refus que la vente normale');
  let E = await setup();
  E.run(BRUN_SEPARE);
  let r = await E.run(`act(()=>issueMortgage('p0', C0.id, 'BANK', {silent:true}))`);
  ok(r.ok && E.json(`P('p0').mortgages`).length === 1 && near(E.json(`P('p0').mortgages`)[0].principal, 0.3), 'Co Alice hypothèque Brun 1 auprès de la banque (0,3 M$)');
  let o0 = E.run(`own('p0')`), o1 = E.run(`own('p1')`), total0 = E.cash();
  r = await E.run(SWAP_100);
  ok(!r.ok && /Co Alice a hypothéqué sa part de Brun 1/.test(r.error), 'échange de 100 % de Brun 1 contre Brun 2 refusé : « ' + r.error + ' »');
  ok(E.run(`own('p0')`) === o0 && E.run(`own('p1')`) === o1 && E.json(`P('p0').mortgages`).length === 1 && near(E.cash(), total0), 'parts, hypothèque et monnaie inchangées : la banque garde sa garantie');
  // Variante ABS : le revenu de Brun 2 est cédé (swap de revenu fixe/variable actif).
  E = await setup();
  E.run(BRUN_SEPARE + `state.revenueSwaps.push({id:'abs1', sellerId:C1.id, propertyIds:['p1']});`);
  r = await E.run(SWAP_100);
  // Section 309-313 — intégration : un seul contrôle ABS dans l'échange (shareSwapGiveRefusal), avec le message du lot 4.
  ok(!r.ok && /Co Bob a vendu le revenu de Brun 2 en ABS — impossible de l'échanger/.test(r.error) && E.run(`own('p1')`).includes(E.run('C1.id')), 'Brun 2 sous ABS : échange refusé, Co Bob garde Brun 2 (les porteurs continuent d’être payés) : « ' + r.error + ' »');
  // Sans blocage : l'échange fonctionne et conserve la monnaie.
  E = await setup();
  E.run(BRUN_SEPARE);
  total0 = E.cash();
  r = await E.run(SWAP_100);
  ok(r.ok && E.run(`own('p0')`).includes(E.run('C1.id')) && E.run(`own('p1')`).includes(E.run('C0.id')) && near(E.cash(), total0), 'sans hypothèque ni ABS : l’échange Brun 1 ↔ Brun 2 se fait, monnaie conservée');
  // L'échange reste réservé au créateur, revérifié dans l'applyFn.
  E = await setup();
  E.run(BRUN_SEPARE + `as(1);`);
  E.run(`modalShareSwap()`);
  E.champ('mCompanyA', E.run('C0.id')); E.champ('mAssetA', 'prop:p0'); E.champ('mPctA', 100);
  E.champ('mCompanyB', E.run('C1.id')); E.champ('mAssetB', 'prop:p1'); E.champ('mPctB', 100);
  await E.cliquer('#mOk');
  ok(E.alerts.some(a => /Seul le créateur de la partie peut arbitrer un échange de parts/.test(a)) && E.run(`own('p0')`).includes(E.run('C0.id')), 'Bob (non créateur) ne peut pas lancer l’échange : refus dans l’applyFn');
  let X = await setup({ transform: s => s.replace("  const refusalA = shareSwapGiveRefusal(assetA, companyAId);\n  if(refusalA) return fail(refusalA);\n", '') });
  X.run(BRUN_SEPARE);
  await X.run(`act(()=>issueMortgage('p0', C0.id, 'BANK', {silent:true}))`);
  r = await X.run(SWAP_100);
  ok(r.ok && X.run(`own('p0')`).includes(X.run('C1.id')), 'contre-épreuve (refus retiré) : Brun 1 hypothéquée part chez Co Bob, l’hypothèque reste au nom de Co Alice — le test détecte la régression');

  // ---------- Bogue 34 : hypothèque d'un terrain seul après le regroupement ----------
  console.log('Bogue 34 — hypothèque d’un terrain déjà regroupé en lot');
  const BRUN_6040 = `P('p0').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; P('p1').owners=[{companyId:C0.id,share:60},{companyId:C1.id,share:40}]; as(0);`;
  E = await setup();
  E.run(BRUN_6040);
  E.run(`modalMortgage('p1')`);                 // Alice ouvre l'hypothèque de Brun 2 (terrain seul)
  E.run(`mergeGroup('BRUN')`); await settle();   // l'administratrice regroupe le lot
  let c0 = E.run('C0.cash'); total0 = E.cash();
  await E.cliquer('#mOk');
  // Section 309-313 — intégration : avec la fenêtre du lot 5 (confirmWithFreshConditions), le refus s'affiche dans la
  // fenêtre redessinée « Les conditions ont changé », et non plus dans une alerte.
  ok(/Les conditions ont changé/.test(E.fenetre()) && /Brun 2 fait désormais partie du lot Brun regroupé — rien n’a été fait ; hypothéquez votre part du lot entier/.test(E.fenetre()), 'confirmation après le regroupement : refus clair dans la fenêtre redessinée (« hypothéquez votre part du lot entier »)');
  ok(near(E.run('C0.cash'), c0) && E.json(`P('p1').mortgages||[]`).length === 0 && near(E.cash(), total0), 'aucun emprunt versé, aucune hypothèque inscrite (avant : 0,36 M$ sans intérêt ni saisie possible)');
  r = await E.run(`act(()=>issueMortgageLot(P('p0').groupMergeId, C0.id, 'BANK', {silent:true}))`);
  ok(r.ok, 'l’hypothèque de la part du lot reste possible (issueMortgageLot)');
  X = await setup({ transform: s => s.replace("  if(p.groupMergeId) return fail(`${p.name} fait désormais partie du lot ${GROUPS[p.group].label} regroupé — rien n’a été fait ; hypothéquez votre part du lot entier (menu Hypothéquer).`);\n", '') });
  X.run(BRUN_6040);
  X.run(`mergeGroup('BRUN')`); await settle();
  r = await X.run(`act(()=>issueMortgage('p1', C0.id, 'BANK', {silent:true}))`);
  ok(r.ok && near(X.json(`P('p1').mortgages`)[0].principal, 0.36), 'contre-épreuve (refus retiré) : hypothèque de 0,36 M$ acceptée sur un terrain du lot — le test détecte la régression');

  // ---------- Bogue 35 : échange d'un terrain seul après le regroupement ----------
  console.log('Bogue 35 — échange d’un terrain seul confirmé après le regroupement du lot');
  E = await setup();
  E.run(BRUN_6040 + `P('p2').owners=[{companyId:C2.id,share:100}];`);
  E.run(`mergeGroup('BRUN')`); await settle();
  r = await E.run(`act(()=>executeShareSwap('prop','p0',C0.id,30,'prop','p2',C2.id,30,{silent:true}))`);
  ok(!r.ok && /Brun 1 fait désormais partie du lot Brun regroupé/.test(r.error), 'échange de 30 % de Brun 1 (choisi avant le regroupement) refusé clairement');
  ok(E.run(`own('p0')`) === E.run(`own('p1')`), 'Brun 1 et Brun 2 gardent les mêmes parts (lot synchronisé)');
  ok(E.run(`transferAssetShare({type:'prop', id:'p0'}, C0.id, C2.id, 10)`) === false && E.run(`own('p0')`) === E.run(`own('p1')`), 'transferAssetShare refuse aussi un terrain seul d’un lot regroupé');
  r = await E.run(`act(()=>executeShareSwap('lot',P('p0').groupMergeId,C0.id,30,'prop','p2',C2.id,30,{silent:true}))`);
  ok(r.ok && E.run(`own('p0')`) === E.run(`own('p1')`) && E.run(`own('p0')`).includes(E.run('C2.id')), 'l’échange d’une part du LOT reste possible, appliqué aux deux terrains');
  X = await setup({ transform: s => s.replace("  if(asset.type==='prop' && host.groupMergeId) return false; // Section 309 — bogue 35 : jamais un terrain seul d'un lot regroupé (parts désynchronisées)\n", '').replace("  if(mergedRefusal) return mergedRefusal;\n  const host = assetHostProperty(asset);", "  const host = assetHostProperty(asset);") });
  X.run(BRUN_6040 + `P('p2').owners=[{companyId:C2.id,share:100}];`);
  X.run(`mergeGroup('BRUN')`); await settle();
  r = await X.run(`act(()=>executeShareSwap('prop','p0',C0.id,30,'prop','p2',C2.id,30,{silent:true}))`);
  ok(r.ok && X.run(`own('p0')`) !== X.run(`own('p1')`), 'contre-épreuve (refus retiré) : seule Brun 1 change, le lot est désynchronisé — le test détecte la régression');

  // ---------- Bogue 63 : aucune part arrondie à 0 % au regroupement ----------
  console.log('Bogue 63 — regroupement : aucune part confisquée, aucun copropriétaire à 0 %');
  // Bleu pâle 1 (p2, 1 M$) : Co Alice 1 %, Co Bob 99 % ; Bleu pâle 2 (p3, 1 M$) : Co Bob 100 % ;
  // Bleu pâle 3 (p4, 1,2 M$) : Co Bob 99 %, Co Carl 1 %. Parts exactes : Alice 0,3125 %, Bob 99,3125 %, Carl 0,375 %.
  const BP = `P('p2').owners=[{companyId:C0.id,share:1},{companyId:C1.id,share:99}]; P('p3').owners=[{companyId:C1.id,share:100}];
              P('p4').owners=[{companyId:C1.id,share:99},{companyId:C2.id,share:1}]; as(0);`;
  E = await setup();
  E.run(BP);
  total0 = E.cash();
  E.run(`mergeGroup('BLEU_PALE')`); await settle();
  let owners = E.json(`P('p2').owners`);
  const sh = id => (owners.find(o => o.companyId === E.run(id)) || {}).share;
  ok(!!E.run(`P('p2').groupMergeId`), 'le lot Bleu pâle est regroupé');
  ok(sh('C0.id') === 1 && sh('C1.id') === 98 && sh('C2.id') === 1, 'parts : Co Alice 1 %, Co Bob 98 %, Co Carl 1 % (avant : Co Alice 0 %, part confisquée, copropriétaire fantôme)');
  ok(owners.every(o => o.share > 0) && owners.reduce((s, o) => s + o.share, 0) === 100, 'aucune part à 0 %, somme = 100 % exactement');
  ok(E.run(`own('p2')`) === E.run(`own('p3')`) && E.run(`own('p3')`) === E.run(`own('p4')`), 'les trois terrains portent les mêmes parts');
  ok(near(E.cash(), total0), 'aucun argent ne bouge au regroupement');
  X = await setup({ transform: s => s.replace("  const finalShares = mergeRoundShares(rawShares, cap); // Section 309 — bogue 63 : plus forts restes avec plancher de 1 %\n",
    "  const floorShares = rawShares.map(s=>Math.floor(s));\n  const assignedFloor = floorShares.reduce((a,b)=>a+b,0);\n  const remainder = Math.round(cap - assignedFloor);\n  const order = entries.map((_,idx)=>idx).sort((a,b)=> (rawShares[b]-floorShares[b]) - (rawShares[a]-floorShares[a]));\n  const finalShares = floorShares.slice();\n  for(let i=0;i<remainder && i<order.length;i++){ finalShares[order[i]] += 1; }\n") });
  X.run(BP);
  X.run(`mergeGroup('BLEU_PALE')`); await settle();
  ok(X.json(`P('p2').owners`).some(o => o.share === 0), 'contre-épreuve (ancien arrondi) : Co Alice tombe à 0 % — le test détecte la régression');
  // Sans part inférieure à 1 %, le nouvel arrondi donne exactement l'ancien résultat (200 cas tirés au hasard).
  const oldRound = (raw, cap) => { const f = raw.map(s => Math.floor(s)); const rem = Math.round(cap - f.reduce((a, b) => a + b, 0)); const ord = raw.map((_, i) => i).sort((a, b) => (raw[b] - f[b]) - (raw[a] - f[a])); const out = f.slice(); for(let i = 0; i < rem && i < ord.length; i++) out[ord[i]] += 1; return out; };
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let same = 0;
  for(let k = 0; k < 200; k++){
    const m = 2 + Math.floor(rnd() * 3), cap = rnd() < 0.5 ? 100 : 90;
    const w = Array.from({ length: m }, () => 1 + rnd() * 10), sw = w.reduce((a, b) => a + b, 0);
    let raw = w.map(x => x / sw * cap);
    if(raw.some(x => x < 1)) { same++; continue; }
    if(JSON.stringify(E.json(`mergeRoundShares(${JSON.stringify(raw)}, ${cap})`)) === JSON.stringify(oldRound(raw, cap))) same++;
  }
  ok(same === 200, 'sans part inférieure à 1 %, le nouvel arrondi est identique à l’ancien (200 cas sur 200)');
  const tiny = E.json(`mergeRoundShares([0.2, 0.3, 0.4, 99.1], 100)`);
  ok(tiny.join() === '1,1,1,97' && tiny.reduce((a, b) => a + b, 0) === 100, 'trois petites parts (0,2 / 0,3 / 0,4 %) : 1 / 1 / 1 %, la grande passe de 99,1 à 97 % ; somme 100');
  // Décision de Julien : le regroupement reste permis au-delà du plafond de copropriétaires.
  E = await setup();
  E.run(`P('p2').owners=[{companyId:C0.id,share:10},{companyId:C1.id,share:90}]; P('p3').owners=[{companyId:C1.id,share:100}];
         P('p4').owners=[{companyId:C1.id,share:40},{companyId:C2.id,share:30},{companyId:C3.id,share:30}]; as(0);`);
  E.run(`mergeGroup('BLEU_PALE')`); await settle();
  owners = E.json(`P('p2').owners`);
  ok(!!E.run(`P('p2').groupMergeId`) && owners.length === 4 && owners.every(o => o.share > 0) && owners.reduce((s, o) => s + o.share, 0) === 100, 'décision de Julien : regroupement accepté avec 4 copropriétaires (' + owners.map(o => o.share + ' %').join(', ') + '), aucun à 0 %');

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
