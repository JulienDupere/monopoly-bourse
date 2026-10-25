// Test — Section 311, décision de Julien : « swap de loyer spécifique : bloquer la vente du terrain concerné ».
// Tant qu'un swap de loyers SPÉCIFIQUE court sur un terrain (ou son lot), l'entreprise qui l'y a engagé ne peut ni le
// vendre (fenêtre « Vendre une part », vente d'une part de lot) ni l'échanger ; message clair ; revérifié dans l'applyFn.
// La vente passe par la vraie fenêtre (mini-DOM du banc, tests/helpers/fake-dom.js).
// Lancer depuis la racine du dépôt :  node tests/section311-swap-vente.test.js
const { loadEngine, check } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

async function setup(opts = {}){
  const doc = creerDocument();
  let T = 1e12;
  class DateV extends Date { constructor(...a){ if(a.length) super(...a); else super(T); } static now(){ return T; } }
  const eng = loadEngine(Object.assign({ globals: { document: doc, Date: DateV } }, opts));
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['A', 'B', 'C'], ['garp', 'garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
           state.settings.features.rentSwap = true; state.rentSwaps = [];
           globalThis.R1 = state.properties.find(p=>p.name==='Rose 1'); R1.owners = [{companyId:A.id, share:60}, {companyId:C.id, share:30}]; R1.mortgages = [];
           globalThis.J1 = state.properties.find(p=>p.name==='Jaune 1'); J1.owners = [{companyId:B.id, share:90}]; J1.mortgages = [];
           globalThis.O = ['Orange 1','Orange 2','Orange 3'].map(nm=>state.properties.find(p=>p.name===nm));
           O.forEach(p=>{ p.owners = [{companyId:A.id, share:90}]; p.mortgages = []; p.groupMergeId = 'lot-orange'; });
           A.cash += 100; B.cash += 100; C.cash += 100;`);
  // Vente par la fenêtre : vendeur, acheteur, %, prix, puis « Confirmer la vente » (après l'anti-rebond de 500 ms).
  async function vendreParFenetre(propExpr, sellerExpr, buyerExpr, pct, price){
    alerts.length = 0;
    eng.run(`modalSellShare(${propExpr}.id)`);
    const el = id => doc.getElementById(id);
    el('mSeller').value = eng.run(`${sellerExpr}.id`); el('mBuyer').value = eng.run(`${buyerExpr}.id`);
    el('mPct').value = String(pct); el('mPrice').value = String(price);
    T += 2000;
    const r = doc.cliquer('mOk'); await r.promesse; await settle();
    const status = el('mRetryStatus') ? el('mRetryStatus').textContent : '';
    eng.run(`closeModal()`); T += 2000;
    return { clic: r.clic, message: [status, ...alerts].filter(Boolean).join(' | ') };
  }
  return { eng, vendreParFenetre };
}

(async () => {
  console.log('1 — swap spécifique Rose 1 (A) ⇄ Jaune 1 (B) : vente et échange bloqués');
  {
    const { eng, vendreParFenetre } = await setup();
    const { run } = eng;
    const s = await run(`createRentSwap(R1.id, A.id, J1.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    ok(s.ok, 'swap spécifique signé');
    const m0 = eng.cashTotal();
    const v = await vendreParFenetre('R1', 'A', 'B', 30, 2);
    ok(v.clic === 'ok' && run(`propertyOwnedShare(R1, A.id)`) === 60, 'vente de 30 % de Rose 1 par A refusée : part inchangée (60 %)');
    ok(/swap de loyers avec Co B/.test(v.message) && /tant que le swap court/.test(v.message), `message clair : « ${v.message} »`);
    const vb = await vendreParFenetre('J1', 'B', 'C', 10, 1);
    ok(run(`propertyOwnedShare(J1, B.id)`) === 90, 'la partenaire B (côté spécifique Jaune 1) ne peut pas vendre non plus');
    const vc = await vendreParFenetre('R1', 'C', 'B', 10, 1);
    ok(run(`propertyOwnedShare(R1, C.id)`) === 20, 'C, copropriétaire de Rose 1 sans swap, vend librement 10 %');
    const x = await run(`executeShareSwap('prop', R1.id, A.id, 10, 'prop', J1.id, B.id, 10, {silent:true})`);
    ok(!x.ok && /échanger/.test(x.error), `échange de Rose 1 refusé : « ${x.error} »`);
    ok(Math.abs(eng.cashTotal() - m0) < 1e-9, 'monnaie conservée');
    run(`state.rentSwaps[0].yearsRemaining = 0;`);
    await vendreParFenetre('R1', 'A', 'B', 30, 2);
    ok(run(`propertyOwnedShare(R1, A.id)`) === 30, 'swap échu : la vente redevient possible');
  }
  console.log('2 — lot regroupé : swap spécifique sur Orange 2, vente d’une part du lot bloquée');
  {
    const { eng } = await setup();
    const { run } = eng;
    await run(`createRentSwap(O[1].id, A.id, null, B.id, 2, null, null, false, true, 0, 0, {silent:true})`);
    const r = await run(`sellMergedShare('lot-orange', A.id, C.id, 10, 1, {silent:true})`);
    ok(!r.ok && /Lot Orange/.test(r.error), `vente d’une part du lot Orange refusée : « ${r.error} »`);
    // Un swap où le côté de A est GÉNÉRAL ne bloque pas la vente (décision limitée au swap spécifique).
    run(`state.rentSwaps = []; state.rentSwaps.push({id:'g', propA:null, companyA:A.id, generalA:true, capA:null, propB:J1.id, companyB:B.id, generalB:false, capB:null, yearsRemaining:2, yearsTotal:2, budgetMode:false});`);
    const r3 = await run(`sellMergedShare('lot-orange', A.id, C.id, 10, 1, {silent:true})`);
    ok(r3.ok, 'swap général de A : la vente d’une part du lot reste permise');
  }
  console.log('3 — contre-épreuve : blocage retiré');
  {
    const { eng, vendreParFenetre } = await setup({ transform: (src) => src.replace("  if(!s) return null;\n  const co = companyById(companyId), partner", "  return null;\n  const co = companyById(companyId), partner") });
    const { run } = eng;
    await run(`createRentSwap(R1.id, A.id, J1.id, B.id, 2, null, null, false, false, 0, 0, {silent:true})`);
    await vendreParFenetre('R1', 'A', 'B', 30, 2);
    ok(run(`propertyOwnedShare(R1, A.id)`) === 30, 'sans la décision : A vend Rose 1 alors que le swap court');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
