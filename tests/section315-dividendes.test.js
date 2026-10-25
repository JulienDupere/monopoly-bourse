// Test — section 315 (audit du 2026-10-19, lot 8) : dividendes et sac type des compagnies Dividendes.
//  25. Le sac type d'une Dividendes ne réagit QU'AU dividende récurrent : s'il n'est pas versé, 20 rouges, même avec un
//      dividende manuel (avant : un dividende manuel de 1 $ évitait le choc).
//  Décisions de Julien (section 306) : le ratio de distribution > 1 compte TOUS les dividendes réellement versés
//      (récurrent et manuels), HORS part de la banque.
//  27. Un arriérage de dividende privilégié bloque aussi l'auto-versement du dividende récurrent (trace au journal).
// Partie : Alice dirige Alpha (Dividendes, référence 0,0000015 M$/part × 200 000 parts = 0,3 M$ par semestre ; la banque
// détient 70 % des parts : 0,21 M$ de la référence ne sont jamais versés), Bob dirige Beta (GARP).
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section315-dividendes.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
const settle = async () => { for(let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
async function contre(title, transform, fn){
  console.log(title);
  let failed = false;
  try{ await fn(transform); }catch(e){ failed = true; console.log('  (échec attendu) ' + String(e.message).slice(0, 160)); }
  try{ check(failed, 'contre-épreuve : l’ancien code fait échouer ce scénario'); n++; }
  catch(e){ failures.push(title.slice(0, 4) + ' — ' + e.message); }
}

// Anciens codes (contre-épreuves).
const ANCIEN_25 = s => s.replace("if(co.type==='dividende' && co.dividendBenchmarkPerShare>0 && !recurrentDividendPaidIds.has(co.id)){", "if(co.type==='dividende' && co.dividendBenchmarkPerShare>0 && !(dividendPaidInSemester(co.id, semesterBefore)>0)){");
const ANCIEN_RATIO = s => s.replace('const paidForRatio = dividendNetPaidInSemester(co.id, semesterBefore);', 'const paidForRatio = dividendPaidInSemester(co.id, semesterBefore);');
const ANCIEN_27 = s => s.replace('if(co.preferredDividendArrears>0){\n          log(`${co.name}: dividende récurrent automatique NON versé', 'if(false){\n          log(`${co.name}: dividende récurrent automatique NON versé');

async function partie(transform){
  const doc = creerDocument();
  const eng = loadEngine({ transform, globals: { document: doc, alert: () => {} } });
  await eng.newGame(['Alice', 'Bob'], ['dividende', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    myPlayerId = state.players[0].id;
    drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; }; injectStockCube = function(){ return 0; };
    globalThis.__net = {};
    const __is = incomeStatementFor;
    incomeStatementFor = function(id, s){ const r = __is(id, s); if(__net[id]!==undefined){ r.netIncome = __net[id]; r.totalRevenue = Math.max(__net[id], 0) + 1; r.totalExpense = r.totalRevenue - __net[id]; } return r; };
    A.cash = 20;`);
  const E = { eng, doc, run: c => eng.run(c), json: c => eng.json(c) };
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  // Dividende manuel par la vraie fenêtre « Annoncer un dividende ».
  E.annoncer = async amount => {
    E.run(`closeModal(); modalAnnounceDividend()`);
    doc.trouver('mDividendAmount').value = String(amount);
    await E.cliquer('#mOk');
  };
  E.cloture = () => E.run(`advanceGameClock()`);
  return E;
}

(async () => {
  // ---------------------------------------------------------------- 25
  const s25 = async (transform) => {
    const E = await partie(transform);
    E.run(`state.gameClock.rollCount = 1; A.dividendAutoPay = false; A.typeReserve = {green:20, red:0, white:0}; __net[A.id] = 1;`);
    const c0 = E.eng.cashTotal();
    await E.annoncer(0.000001);
    ok(E.run('state.dividendAnnouncements.length') === 1, 'dividende manuel de 1 $ annoncé (0,000001 M$), dividende récurrent décoché');
    E.run('state.gameClock.rollCount = 2;');
    E.cloture();
    const tp = E.json('A.typeReserve');
    ok(tp.green === 0 && tp.red === 20 && tp.white === 0, `clôture du semestre : sac type 20 verts → 0V/20R/0B — obtenu ${JSON.stringify(tp)} (avant : 20 verts conservés)`);
    ok(E.run('A.dividendRecurrentNeedsReset') === true, 'dividende récurrent marqué « suspendu » (repart du niveau de fondation)');
    ok(near(E.eng.cashTotal(), c0), 'monnaie conservée');
  };
  await scenario('25 — un dividende manuel de 1 $ ne remplace pas le dividende récurrent', () => s25());
  await contre('25c — contre-épreuve (le dividende manuel évitait le choc)', ANCIEN_25, s25);

  await scenario('25b — contrôle : dividende récurrent versé (0,3 M$, bénéfice 1 M$) → sac type intact', async () => {
    const E = await partie();
    E.run(`state.gameClock.rollCount = 2; A.dividendAutoPay = true; A.typeReserve = {green:20, red:0, white:0}; __net[A.id] = 1;`);
    const c0 = E.eng.cashTotal(), a0 = E.run('A.cash');
    E.cloture();
    ok(JSON.stringify(E.json('A.typeReserve')) === '{"green":20,"red":0,"white":0}', 'sac type 20 verts conservé');
    ok(near(a0 - E.run('A.cash'), 0.09), `Alpha ne débourse que la part des actionnaires réels : ${f4(a0 - E.run('A.cash'))} (0,3 × 30 %)`);
    ok(near(E.eng.cashTotal(), c0), 'monnaie conservée');
  });

  // ---------------------------------------------------------------- ratio de distribution (décisions)
  const sBanque = async (transform) => {
    const E = await partie(transform);
    E.run(`state.gameClock.rollCount = 2; A.dividendAutoPay = true; A.typeReserve = {green:6, red:1, white:3}; __net[A.id] = 0.2;`);
    E.cloture();
    ok(near(E.run('dividendNetPaidInSemester(A.id, 0)'), 0.09) && near(E.run('dividendPaidInSemester(A.id, 0)'), 0.3), 'semestre 0 : 0,3 débité, 0,21 (part de la banque) rendu → 0,09 réellement versé');
    const tp = E.json('A.typeReserve');
    ok(JSON.stringify(tp) === '{"green":6,"red":1,"white":3}', `bénéfice 0,2 : ratio réel 45 % → sac type inchangé 6V/1R/3B — obtenu ${JSON.stringify(tp)} (avant : ratio 150 % avec la part de la banque → 4V/6R/0B)`);
  };
  await scenario('R1 — ratio de distribution sans la part de la banque (0,09 versé pour 0,2 de bénéfice)', () => sBanque());
  await contre('R1c — contre-épreuve (part de la banque comptée)', ANCIEN_RATIO, sBanque);

  await scenario('R2 — ratio sur TOUS les dividendes réellement versés : récurrent 0,09 + manuel 0,15 > bénéfice 0,2', async () => {
    const E = await partie();
    E.run(`state.gameClock.rollCount = 1; A.dividendAutoPay = true; A.typeReserve = {green:6, red:1, white:3}; __net[A.id] = 0.2;`);
    const c0 = E.eng.cashTotal();
    await E.annoncer(0.5);
    E.run('state.gameClock.rollCount = 2;');
    E.cloture();
    ok(near(E.run('dividendNetPaidInSemester(A.id, 0)'), 0.24), `réellement versé au semestre 0 : 0,09 (récurrent) + 0,15 (manuel, 30 % de 0,5) = ${f4(E.run('dividendNetPaidInSemester(A.id, 0)'))}`);
    const tp = E.json('A.typeReserve');
    ok(JSON.stringify(tp) === '{"green":4,"red":6,"white":0}', `ratio 120 % → 5 cubes rougis (3 blancs puis 2 verts) : 4V/6R/0B — obtenu ${JSON.stringify(tp)}`);
    ok(/ratio de distribution : 120 %/.test(JSON.stringify(E.json('state.log.slice(0, 40)'))), 'journal : « ratio de distribution : 120 % »');
    ok(near(E.eng.cashTotal(), c0), 'monnaie conservée');
  });

  await scenario('R3 — dividende manuel seul de 0,5 (0,15 réellement versé) pour 0,1 de bénéfice : 5 cubes rougis… puis 20 rouges (aucun récurrent)', async () => {
    const E = await partie();
    E.run(`state.gameClock.rollCount = 1; A.dividendAutoPay = false; A.typeReserve = {green:6, red:1, white:3}; __net[A.id] = 0.1;`);
    await E.annoncer(0.5);
    E.run('state.gameClock.rollCount = 2;');
    E.cloture();
    ok(JSON.stringify(E.json('A.typeReserve')) === '{"green":0,"red":20,"white":0}', 'sac type à 20 rouges (le dividende manuel ne remplace pas le récurrent)');
  });

  // ---------------------------------------------------------------- 27
  const s27 = async (transform) => {
    const E = await partie(transform);
    E.run(`state.gameClock.rollCount = 2; A.dividendAutoPay = true; A.preferredDividendArrears = 0.32; A.typeReserve = {green:10, red:0, white:10}; __net[A.id] = 1;
      const bank = A.shareholders.find(s=>s.playerId==='BANK'); bank.shares -= 50000; A.shareholders.push({playerId: state.players[1].id, shares: 50000, avgCost: 0.0001});`);
    const c0 = E.eng.cashTotal(), a0 = E.run('A.cash'), bob0 = E.run('state.players[1].cash');
    E.cloture();
    ok(near(E.run('state.players[1].cash'), bob0), `Bob (50 000 parts ordinaires) ne reçoit rien — reçu ${f4(E.run('state.players[1].cash') - bob0)} (avant : 0,075)`);
    ok(near(E.run('A.cash'), a0) && near(E.run('A.preferredDividendArrears'), 0.32), 'Alpha ne verse rien ; arriérage toujours de 0,32');
    ok(E.json('state.log.slice(0, 40)').some(l => /dividende récurrent automatique NON versé ce semestre — arriérage/.test(JSON.stringify(l))), 'journal : « dividende récurrent automatique NON versé ce semestre — arriérage… »');
    ok(JSON.stringify(E.json('A.typeReserve')) === '{"green":0,"red":20,"white":0}', 'dividende récurrent non versé : sac type à 20 rouges (bogue 25)');
    ok(near(E.eng.cashTotal(), c0), 'monnaie conservée');
    // L'arriérage réglé, l'auto-versement reprend au semestre suivant.
    E.run(`A.preferredDividendArrears = 0; A.dividendRecurrentNeedsReset = false; state.gameClock.rollCount = 8;`);
    const bob1 = E.run('state.players[1].cash');
    E.cloture();
    ok(near(E.run('state.players[1].cash') - bob1, 0.075), `arriérage réglé : Bob reçoit de nouveau 0,075 — reçu ${f4(E.run('state.players[1].cash') - bob1)}`);
  };
  await scenario('27 — arriérage de privilégié de 0,32 : l’auto-versement est bloqué', () => s27());
  await contre('27c — contre-épreuve (auto-versement malgré l’arriérage)', ANCIEN_27, s27);

  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (dividendes) — ${n} vérifications`);
})();
