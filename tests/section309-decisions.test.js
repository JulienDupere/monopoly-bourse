// Test — section 309, décision de Julien (2026-10-25) « Ok go pour tes reco » : plancher de valeur d'un terrain.
// Le prix saisi dans Administration › « Acheter des parts » (modalBuyShares) était recopié tel quel dans
// p.acquisitionPrice, plancher de intrinsicValue pour TOUT le terrain : rachat de 1 % « à 500 M$ pour 100 % », puis
// revente de 100 % à la banque = +370 M$. Le plancher devient le prix RÉELLEMENT payé, en moyenne pondérée par les
// parts : parts achetées ici au prix convenu, les autres au plancher précédent (prix de base s'il n'y en a pas).
// Chaque vérification passe par la vraie fenêtre (mini-DOM) ; contre-épreuve : l'ancienne ligne réintroduite.
// Lancer :  node tests/section309-decisions.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
const ANCIEN = '      prop.acquisitionPrice = price;\n';

async function setup(opts = {}){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2];
           globalThis.P = id => state.properties.find(p=>p.id===id);
           myPlayerId = state.players[0].id;
           drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  E.fenetre = () => doc.trouver('modalHost').innerHTML;
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  E.champ = (id, v) => { doc.trouver(id).value = String(v); };
  // Achat à la banque par la fenêtre de l'Administration : lignes [{pct, co?}] (co = index d'entreprise), prix pour 100 %.
  E.acheter = async (pid, lignes, prix) => {
    E.run(`closeModal(); modalBuyShares('${pid}')`);
    for(let i = 1; i < lignes.length; i++) await E.cliquer('#mAddBuyerRow');
    lignes.forEach((l, i) => {
      if(l.co !== undefined) E.champ('mBuyerCo' + i, E.run(`state.companies[${l.co}].id`));
      E.champ('mBuyerPct' + i, l.pct);
    });
    E.champ('mPrice', prix);
    await E.cliquer('#mOk');
  };
  return E;
}

(async () => {
  // ---------- 1. Scénario de la revue : 1 % « à 500 M$ pour 100 % » ----------
  console.log('1. Brun 1 (prix de base 0,6) : 99 % détenus sans prix enregistré, 1 % racheté « à 500 pour 100 % »');
  let E = await setup();
  E.run(`P('p0').owners=[{companyId:C0.id,share:99}];`);
  ok(E.run(`P('p0').basePrice`) === 0.6 && E.run(`P('p0').acquisitionPrice`) == null, 'départ : prix de base 0,6, aucun plancher enregistré');
  const rachatAvant = E.run(`bankBuybackPrice({type:'prop',id:'p0'},100)`);
  let c0 = E.run('C0.cash'), m0 = E.cash();
  await E.acheter('p0', [{ pct: 1, co: 0 }], 500);
  ok(E.json(`P('p0').owners`).length === 1 && E.run(`P('p0').owners[0].share`) === 100, 'Co Alice détient 100 %');
  ok(near(c0 - E.run('C0.cash'), 5), `Co Alice paie 5 M$ pour 1 % (obtenu ${f4(c0 - E.run('C0.cash'))})`);
  const plancher = E.run(`P('p0').acquisitionPrice`);
  ok(near(plancher, 0.99 * 0.6 + 0.01 * 500), `plancher = 0,99 × 0,6 + 0,01 × 500 = 5,594 (obtenu ${f4(plancher)} ; avant : 500)`);
  const rachatApres = E.run(`bankBuybackPrice({type:'prop',id:'p0'},100)`);
  ok(rachatApres < 5, `valeur de rachat de 100 % : ${f4(rachatAvant)} → ${f4(rachatApres)}, sous les 5 M$ payés`);
  const r = await E.run(`attemptActionWithRetry(()=>sellPropertyShare('p0', C0.id, 'BANK', 100, 0, {silent:true}),{label:'t'})`);
  const gain = E.run('C0.cash') - c0;
  ok(r.ok && gain < 0, `achat 1 % puis revente de 100 % à la banque : gain net ${f4(gain)} M$ (négatif : la triche fait perdre ; avant : +370)`);
  ok(near(E.cash(), m0), 'monnaie conservée (achat et revente)');

  // Contre-épreuve : l'ancienne ligne (prix recopié tel quel) réintroduite.
  X1: {
    const Y = await setup({ transform: s => s.replace(/      \/\/ Section 309 — décision de Julien \(2026-10-25\) : plancher[\s\S]*?prop\.acquisitionPrice = [^\n]*\n/, ANCIEN) });
    Y.run(`P('p0').owners=[{companyId:C0.id,share:99}];`);
    const y0 = Y.run('C0.cash');
    await Y.acheter('p0', [{ pct: 1, co: 0 }], 500);
    await Y.run(`attemptActionWithRetry(()=>sellPropertyShare('p0', C0.id, 'BANK', 100, 0, {silent:true}),{label:'t'})`);
    ok(Y.run(`P('p0').acquisitionPrice`) === 500 && Y.run('C0.cash') - y0 > 300, `contre-épreuve (ancien code) : plancher 500, gain ${f4(Y.run('C0.cash') - y0)} M$ — le test détecte la régression`);
  }

  // ---------- 2. Achat honnête ----------
  console.log('2. Achat honnête de 100 % à 1,2 M$ : plancher 1,2');
  E = await setup();
  E.run(`P('p0').owners=[];`);
  m0 = E.cash();
  await E.acheter('p0', [{ pct: 100, co: 0 }], 1.2);
  ok(near(E.run(`P('p0').acquisitionPrice`), 1.2), `plancher 1,2 (obtenu ${f4(E.run(`P('p0').acquisitionPrice`))})`);
  ok(near(E.run(`intrinsicValue(P('p0'))`), Math.max(1.2, E.run(`intrinsicValue(P('p0'))`))) && E.run(`intrinsicValue(P('p0'))`) >= 1.2 - 1e-9, 'valeur intrinsèque ≥ 1,2');
  ok(near(E.cash(), m0), 'monnaie conservée');

  // ---------- 3. Plancher précédent conservé pour les parts non rachetées ----------
  console.log('3. Rachat partiel après un premier achat : les autres parts comptent au plancher précédent');
  // 100 % achetés à 1,2 ; 50 % revendus à la banque ; 50 % rachetés à 1,0 → 0,5 × 1,2 + 0,5 × 1,0 = 1,1.
  await E.run(`attemptActionWithRetry(()=>sellPropertyShare('p0', C0.id, 'BANK', 50, 0, {silent:true}),{label:'t'})`);
  ok(near(E.run(`P('p0').acquisitionPrice`), 1.2), 'la revente à la banque ne change pas le plancher (1,2)');
  await E.acheter('p0', [{ pct: 50, co: 1 }], 1.0);
  ok(near(E.run(`P('p0').acquisitionPrice`), 1.1), `plancher 0,5 × 1,2 + 0,5 × 1,0 = 1,1 (obtenu ${f4(E.run(`P('p0').acquisitionPrice`))} ; avec le prix de base pour les autres parts : 0,8)`);
  ok(near(E.cash(), m0), 'monnaie conservée');

  // ---------- 4. Plusieurs acheteurs dans la même fenêtre ----------
  console.log('4. Deux acheteurs (30 % + 20 %) à 2 M$ pour 100 % sur Brun 2 (prix de base 1,2), 50 % chez la banque');
  E = await setup();
  E.run(`P('p1').owners=[];`);
  m0 = E.cash();
  await E.acheter('p1', [{ pct: 30, co: 0 }, { pct: 20, co: 1 }], 2);
  ok(E.json(`P('p1').owners.map(o=>o.share)`).join('+') === '30+20', 'parts 30 % et 20 % inscrites');
  ok(near(E.run(`P('p1').acquisitionPrice`), 0.5 * 1.2 + 0.5 * 2), `plancher 0,5 × 1,2 + 0,5 × 2 = 1,6 (obtenu ${f4(E.run(`P('p1').acquisitionPrice`))} ; avant : 2)`);
  ok(near(E.cash(), m0), 'monnaie conservée');

  // ---------- 5. Prix suggéré (wasSeized) et achat refusé ----------
  console.log('5. Fenêtre : prix suggéré après un premier achat ; achat refusé = plancher inchangé');
  ok(/Valeur intrinsèque \(suggérée/.test((E.run(`closeModal(); modalBuyShares('p1')`), E.fenetre())), 'terrain déjà acheté par l’Administration : la valeur intrinsèque est suggérée (indicateur inchangé)');
  E.run(`closeModal(); modalBuyShares('p0')`);
  ok(!/Valeur intrinsèque \(suggérée/.test(E.fenetre()) && /moyenne pondérée/.test(E.fenetre()), 'terrain jamais acheté : prix de base suggéré ; la fenêtre explique la moyenne pondérée');
  const avant = E.run(`P('p1').acquisitionPrice`);
  await E.acheter('p1', [{ pct: 99, co: 2 }], 3);   // dépasse la part rachetable : refusé
  ok(E.run(`P('p1').acquisitionPrice`) === avant && E.alerts.some(a => /dépasse le maximum rachetable/.test(a)), 'achat refusé : plancher inchangé');

  // ---------- 6. Parties existantes ----------
  console.log('6. Parties existantes : le plancher déjà enregistré est conservé par migrateState');
  E.run(`P('p2').acquisitionPrice = 7.5; migrateState(state);`);
  ok(E.run(`P('p2').acquisitionPrice`) === 7.5, 'acquisitionPrice existant inchangé par la migration (parts achetées inconnues)');
  E.run(`delete P('p2').acquisitionPrice; migrateState(state);`);
  ok(E.run(`P('p2').acquisitionPrice`) === null, 'champ absent : null (prix de base) par la migration');

  console.log(`\nOK : section 309 (décision du plancher de valeur) — ${n} vérifications`);
})().catch(e => { console.error('ÉCHEC :', e && e.message ? e.message : e); process.exit(1); });
