// Test — section 315 (audit du 2026-10-19, lot 8) : lancer pour tous.
//  43. Toutes les entreprises sous enquête AMF : le tour passe tout seul (un lancer à la fois, numéro de lancer attendu)
//      tant que personne ne peut lancer ; bouton de secours « Faire passer le tour » (avant : partie figée).
//  69. Lancer « simultané » : les enquêtes AMF ouvertes pendant le lancer prennent effet après TOUS les déplacements
//      (avant : une entreprise créée avant le visiteur perdait le loyer de ce tour, pas une créée après).
// Dés pipés : Math.random remplacé par une file de valeurs pendant le lancer (repli 0,5), puis restauré.
// Lancer depuis la racine du dépôt :  node tests/section315-tour.test.js
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
// Anciens codes.
const ANCIEN_43 = s => s.replace('const nobodyCanRoll = mustBeReady.length===0 && activeCompanies().some(c=>c.inJail);', 'const nobodyCanRoll = false;')
  .replace('const allJailed = noCompanyCanRoll();', 'const allJailed = false;');
const ANCIEN_69 = s => s.replace('if(!(opts && opts.deferJail)) applySendToJailEffect(co);', 'applySendToJailEffect(co);')
  .replace("localResults.forEach(r=>{ if(r.jailed){ const jc = companyById(r.companyId); if(jc) applySendToJailEffect(jc); } });", '');

async function partie(transform){
  const doc = creerDocument();
  const alerts = [];
  const eng = loadEngine({ transform, globals: { document: doc, alert: m => alerts.push(String(m)) } });
  await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.__ids = state.players.map(p=>p.id);
    drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; }; injectStockCube = function(){ return 0; };
    // Dés pipés : file de valeurs de Math.random, consommée par les lancers (repli 0,5).
    globalThis.__des = []; globalThis.__realRandom = Math.random;
    Math.random = function(){ return __des.length ? __des.shift() : 0.5; };
    A.cash = 20; B.cash = 20;`);
  const E = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c) };
  E.fin = () => eng.run('Math.random = __realRandom;');
  E.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await settle(); return r.clic; };
  return E;
}
const D = v => (v - 1) / 6 + 0.01; // valeur de Math.random qui donne le dé v

(async () => {
  // ---------------------------------------------------------------- 43
  const s43a = async (transform) => {
    const E = await partie(transform);
    try{
      E.run(`A.inJail = true; A.jailTurnsLeft = 2; A.position = 10; state.gameClock.rollCount = 1;`);
      const r0 = E.run('state.gameClock.rollCount'), m0 = E.eng.cashTotal();
      await E.run(`sendToJail(B.id)`);          // l'administrateur ouvre une enquête sur la dernière entreprise libre
      ok(E.run('state.gameClock.rollCount') === r0 + 2, `toutes enquêtées : 2 tours passent tout seuls (lancer ${r0} → ${E.run('state.gameClock.rollCount')}) (avant : figé à ${r0})`);
      ok(E.run('A.inJail') === false && E.run('B.inJail') === true && E.run('B.jailTurnsLeft') === 1, `Alpha libérée (non-lieu), Beta : 3 → ${E.run('B.jailTurnsLeft')} tour(s) restant(s)`);
      ok(E.run('state.companies.every(c=>!c.ready)'), 'aucune entreprise « prête » : Alpha, libre, doit valider le tour suivant');
      await E.run(`checkAllCompaniesReady()`);
      ok(E.run('state.gameClock.rollCount') === r0 + 2, 'l’enchaînement s’arrête dès qu’une entreprise peut lancer (aucun lancer de plus)');
      ok(near(E.eng.cashTotal(), m0), 'monnaie conservée');
    } finally { E.fin(); }
  };
  await scenario('43a — l’administrateur enquête la dernière entreprise libre : le tour passe tout seul', () => s43a());
  await contre('43ac — contre-épreuve (partie figée)', ANCIEN_43, s43a);

  await scenario('43b — la dernière entreprise libre valide son tour et tombe sur « Allez en prison » : enchaînement automatique', async () => {
    const E = await partie();
    try{
      E.run(`A.inJail = true; A.jailTurnsLeft = 3; A.position = 10; B.position = 28; myPlayerId = __ids[1]; state.gameClock.rollCount = 1;
        __des = [${D(1)}, ${D(1)}];`);   // Beta : 1 + 1 = 2 → case 30
      const m0 = E.eng.cashTotal();
      const res = await E.run(`markCompanyReady(B.id, 1)`);
      ok(res.ok && res.triggered, '« Tour Terminé » de Beta : le lancer part');
      ok(E.run('state.gameClock.rollCount') === 4, `3 lancers en tout (1 → ${E.run('state.gameClock.rollCount')}) : celui de Beta, puis 2 tours sans personne`);
      ok(E.run('A.inJail') === false && E.run('B.jailTurnsLeft') === 1, `Alpha : 3 → 0 (libre) ; Beta : 3 → ${E.run('B.jailTurnsLeft')}`);
      const suites = E.json(`state.log.filter(l=>/enquête de l'AMF se poursuit/.test(JSON.stringify(l))).length`);
      ok(suites === 4, `journal : 4 lignes « l'enquête se poursuit » (Alpha 2, Alpha 1, Beta 2, Beta 1) — obtenu ${suites}`);
      ok(E.json(`state.log.filter(l=>/déclarée non coupable/.test(JSON.stringify(l))).length`) === 1, 'journal : Alpha « déclarée non coupable » une fois');
      ok(near(E.eng.cashTotal(), m0), 'monnaie conservée');
    } finally { E.fin(); }
  });

  await scenario('43c — partie chargée avec toutes les entreprises enquêtées : bouton de secours « Faire passer le tour »', async () => {
    const E = await partie();
    try{
      E.run(`A.inJail = true; A.jailTurnsLeft = 2; B.inJail = true; B.jailTurnsLeft = 3; A.position = 10; B.position = 10; myPlayerId = __ids[0]; state.gameClock.rollCount = 2;
        activeTab = 'entreprise'; render();`);
      const btn = E.doc.trouver ? E.run(`document.querySelectorAll('[data-pass-all-jailed]').length`) : 0;
      ok(btn === 1, 'onglet Mon entreprise : bouton « ⏭️ Faire passer le tour » affiché');
      ok(E.run(`document.querySelector('[data-pass-all-jailed]').dataset.roll`) === '2', 'le bouton porte le lancer affiché (2)');
      const stale = await E.run(`passTurnAllJailed(1)`);
      ok(stale === false && E.run('state.gameClock.rollCount') === 2, 'lancer périmé (1) : refusé, rien ne bouge');
      await E.cliquer('[data-pass-all-jailed]');
      ok(E.run('state.gameClock.rollCount') === 4, `clic : 2 tours passent (2 → ${E.run('state.gameClock.rollCount')}), jusqu'à la libération d'Alpha`);
      ok(E.run('A.inJail') === false && E.run('B.jailTurnsLeft') === 1, 'Alpha libre, Beta 1 tour restant');
      E.run('render()');
      ok(E.run(`document.querySelectorAll('[data-pass-all-jailed]').length`) === 0, 'une entreprise libre : le bouton disparaît (« Tour Terminé » normal)');
    } finally { E.fin(); }
  });

  // ---------------------------------------------------------------- 69
  // Alpha possède Bleu pâle 1 (case 6) et part de la case 28 (1 + 1 → « Allez en prison ») ; Beta part de la case 2 et
  // fait 2 + 2 → case 6. Ordre de création : Alpha puis Beta (ordre normal), ou Beta puis Alpha (liste inversée).
  const s69 = async (transform, inverse) => {
    const E = await partie(transform);
    try{
      E.run(`const p = state.properties.find(x=>x.name==='Bleu pâle 1'); p.owners = [{companyId:A.id, share:100}]; p.houses = 0; p.mortgages = [];
        A.position = 28; B.position = 2; state.gameClock.rollCount = 1;
        ${inverse ? 'state.companies.reverse();' : ''}
        __des = ${inverse ? `[${D(2)}, ${D(2)}, ${D(1)}, ${D(1)}]` : `[${D(1)}, ${D(1)}, ${D(2)}, ${D(2)}]`};`);
      const a0 = E.run('A.cash'), b0 = E.run('B.cash'), m0 = E.eng.cashTotal();
      const res = await E.run(`performRollForAllCompanies({expectedRoll:1})`);
      ok(Array.isArray(res) && res.length === 2, 'lancer pour tous joué (2 entreprises)');
      ok(E.run('A.inJail') === true && E.run('A.position') === 10 && E.run('B.position') === 6, 'Alpha en enquête (case 10), Beta sur Bleu pâle 1');
      const gain = E.run('A.cash') - a0, paye = b0 - E.run('B.cash');
      return { gain, paye, m: E.eng.cashTotal() - m0 };
    } finally { E.fin(); }
  };
  const s69both = async (transform) => {
    const normal = await s69(transform, false);
    const inverse = await s69(transform, true);
    ok(near(normal.gain, inverse.gain) && normal.gain > 0, `Alpha touche le loyer quel que soit l’ordre : ${f4(normal.gain)} (Alpha avant Beta) et ${f4(inverse.gain)} (Beta avant Alpha) — avant : 0 et 0,06`);
    ok(near(normal.paye, normal.gain) && near(inverse.paye, inverse.gain), 'Beta paie exactement ce qu’Alpha reçoit');
    ok(near(normal.m, 0) && near(inverse.m, 0), 'monnaie conservée dans les deux ordres');
  };
  await scenario('69 — loyer d’une entreprise envoyée en enquête au même lancer : indépendant de l’ordre de création', () => s69both());
  await contre('69c — contre-épreuve (effet AMF immédiat, dépend de l’ordre)', ANCIEN_69, s69both);

  await scenario('69b — lancer solo : l’effet AMF reste immédiat (aucun autre déplacement dans ce lancer)', async () => {
    const E = await partie();
    try{
      E.run(`A.position = 28; state.gameClock.rollCount = 1; __des = [${D(1)}, ${D(1)}];`);
      const r = await E.run(`corePerformDiceRoll(A)`);
      ok(r.jailed && E.run('A.inJail') === true && E.run('A.jailTurnsLeft') === 3, 'corePerformDiceRoll sans option : enquête ouverte tout de suite (3 tours)');
    } finally { E.fin(); }
  });

  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (lancer pour tous) — ${n} vérifications`);
})();
