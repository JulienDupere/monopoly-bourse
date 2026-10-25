// Test — Section 308 : actions de tour liées au numéro du lancer (bogues 17 et 59) et fenêtre « Résultats du tour »
// (bogue 74).
//
// 17 : « Forcer le tour » (administrateur) croise le dernier « Tour Terminé » d'un autre appareil : le perdant du
//      conflit rejouait un lancer complet par-dessus (2 lancers pour un tour) ; un lancer pouvait aussi être joué
//      sur une partie terminée entre-temps.
// 59 : double « Tour Terminé » : le 2e clic marquait l'entreprise prête pour le tour SUIVANT, et si elle était seule
//      à lancer, déclenchait un 2e lancer.
// 74 : la fenêtre « Résultats du tour » affichait les dés d'une tentative de lancer refusée par le serveur (un autre
//      appareil a écrit pendant l'envoi) ; le lancer réellement enregistré n'apparaissait jamais.
//
// Banc : un faux serveur Firebase partagé, un faux SDK par appareil (chacun son moteur dans son vm). Le faux SDK
// reproduit le vrai : 1re passe de la transaction sur le cache local, événement local optimiste si applyLocally
// n'est pas false (puis retour en arrière si le serveur refuse), livraison asynchrone des valeurs aux écouteurs.
//
// Lancer depuis la racine du dépôt :  node tests/section308-tour.test.js
const { loadEngine, check } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

// ---------- Faux serveur Firebase partagé (copie locale, voir l'en-tête) ----------
function makeFakeServer(){
  const data = new Map();
  const clients = [];
  const ctl = { failNext: {}, onTx: null };
  const stats = { tx: [] };
  const tick = () => new Promise(r => setImmediate(r));
  const snap = v => ({ exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : v) });
  const cur = p => (data.has(p) ? data.get(p) : null);
  function write(p, v){ data.set(p, v); clients.forEach(c => c.deliver(p, v)); }
  function sdk(name){
    const listeners = new Map(), cache = new Map();
    const client = {
      deliver(p, v){ queueMicrotask(() => { cache.set(p, v); (listeners.get(p) || []).forEach(cb => cb(snap(v))); }); },
      fireLocal(p, v){ (listeners.get(p) || []).forEach(cb => cb(snap(v))); },
    };
    clients.push(client);
    function ref(p){
      return {
        once(){ return Promise.resolve(snap(cur(p))); },
        on(ev, cb){
          listeners.set(p, (listeners.get(p) || []).concat([cb]));
          queueMicrotask(() => { if(!(listeners.get(p) || []).includes(cb)) return; cache.set(p, cur(p)); cb(snap(cur(p))); });
          return cb;
        },
        off(ev, cb){ listeners.set(p, (listeners.get(p) || []).filter(x => x !== cb)); },
        set(v){ write(p, v); return Promise.resolve(); },
        remove(){ data.delete(p); clients.forEach(c => c.deliver(p, null)); return Promise.resolve(); },
        async transaction(fn, onComplete, applyLocally){
          const optimistic = applyLocally !== false;
          let input = cache.has(p) ? cache.get(p) : null;
          let out = fn(input);
          const entry = { client: name, result: null };
          stats.tx.push(entry);
          if(out === undefined){ entry.result = 'abandon'; return { committed: false, snapshot: snap(input) }; }
          if(optimistic) client.fireLocal(p, out);
          await tick();
          if(ctl.onTx) await ctl.onTx({ client: name, out, write: v => write(p, v), current: () => cur(p) });
          await tick();
          if(ctl.failNext[name] > 0){
            ctl.failNext[name]--;
            entry.result = 'échec réseau';
            if(optimistic) client.fireLocal(p, cur(p));
            throw new Error('permission_denied (simulé)');
          }
          for(let i = 0; i < 25; i++){
            const now = cur(p);
            if(now === input){ entry.result = 'écrit'; write(p, out); return { committed: true, snapshot: snap(out) }; }
            input = now; out = fn(input);
            if(out === undefined){ entry.result = 'conflit'; if(optimistic) client.fireLocal(p, now); return { committed: false, snapshot: snap(now) }; }
          }
          throw new Error('maxretry');
        },
      };
    }
    return {
      apps: [],
      initializeApp(){ this.apps.push({}); },
      database(){ return { ref }; },
      auth(){ return { currentUser: { uid: name }, onAuthStateChanged(cb){ cb({ uid: name }); return () => {}; }, signInAnonymously: async () => ({}) }; },
    };
  }
  const settle = async () => { for(let i = 0; i < 8; i++) await tick(); };
  return { data, ctl, stats, sdk, write, cur, tick, settle };
}

function seedRandom(seed){ let s = seed >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const totalOf = s => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0) + s.players.reduce((t, p) => t + (p.cash || 0), 0);

function device(server, name, engineOpts = {}){
  const eng = loadEngine(Object.assign({ firebase: server.sdk(name) }, engineOpts));
  eng.sandbox.__FIREBASE_CONFIG__ = { apiKey: 'cle-de-test', databaseURL: 'https://test.firebaseio.com' };
  const alerts = [];
  eng.sandbox.alert = m => alerts.push(String(m));
  return { eng, alerts, name };
}

// Partie à deux appareils : A = Alice (créatrice, administratrice, CEO de « Co Alice »), B = Bob (CEO de « Co Bob »).
async function setup(engineOpts = {}){
  seedRandom(308);
  const server = makeFakeServer();
  const A = device(server, 'A', engineOpts), B = device(server, 'B', engineOpts);
  await A.eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
  await server.settle();
  const ids = A.eng.json('state.players.map(p=>p.id)');
  await A.eng.run(`createCompany(${JSON.stringify(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
  await A.eng.run(`myPlayerId = ${JSON.stringify(ids[1])}; createCompany(${JSON.stringify(ids[1])}, 'Co Bob', '', 'garp', null, null, null)`);
  A.eng.run(`myPlayerId = ${JSON.stringify(ids[0])}`);
  await A.eng.run(`attemptActionWithRetry(async ()=>{ state.companies.forEach(c=>applyCompanyIpoFunding(c)); return {ok:true}; })`);
  await server.settle();
  const code = A.eng.run('gameCode');
  const path = 'data/game:' + code;
  if(!(await B.eng.run(`loadGame(${JSON.stringify(code)})`))) throw new Error('Mise en place : B ne charge pas la partie');
  B.eng.run(`myPlayerId = ${JSON.stringify(ids[1])}`);
  await server.settle();
  const S = () => JSON.parse(server.cur(path));
  const co = (s, name) => s.companies.find(c => c.name === name);
  A.alerts.length = 0; B.alerts.length = 0; server.stats.tx.length = 0;
  return { server, A, B, ids, code, path, S, co };
}
// « Un autre appareil » modifie la partie directement sur le serveur (transaction réussie d'un 3e appareil).
function foreignEdit(T, mutate){
  const s = T.S(); mutate(s); s.version = (s.version || 0) + 1;
  T.server.write(T.path, JSON.stringify(s));
}
const coIdOf = (dev, name) => dev.eng.run(`state.companies.find(c=>c.name===${JSON.stringify(name)}).id`);
const converged = (T) => T.A.eng.run('lastSerialized') === T.server.cur(T.path) && T.B.eng.run('lastSerialized') === T.server.cur(T.path)
  && T.A.eng.run('JSON.stringify(state)') === T.A.eng.run('(()=>{const s=JSON.parse(lastSerialized); migrateState(s); return JSON.stringify(s);})()')
  && T.B.eng.run('JSON.stringify(state)') === T.B.eng.run('(()=>{const s=JSON.parse(lastSerialized); migrateState(s); return JSON.stringify(s);})()');

// Ancien comportement (contre-épreuve) : aucune revérification du lancer visé ni de la disponibilité des entreprises.
const REVERT_TURN = src => src
  .replace('function turnActionRefusal(expectedRoll){', 'function turnActionRefusal(expectedRoll){ return null;')
  .replace('    if(opts.requireAllReady){', '    if(false){')
  .replace("    if(co.ready) return {ok:false, error:null, code:'already-ready'};", '');
// Ancien comportement (contre-épreuve 74) : événement local optimiste et écouteur appliqué pendant l'action.
const REVERT_74 = src => src
  .replace('}, undefined, false); // Section 308', '}); // Section 308')
  .replace('  if(actionsInFlight>0) return false;\r\n', '').replace('  if(actionsInFlight>0) return false;\n', '')
  .replace('function restoreActionLocals(l){', 'function restoreActionLocals(l){ return;')
  // Retouche de la revue : render() n'ouvre plus la fenêtre directement (scheduleDeferredPopups) ; ancien comportement.
  .replace('  scheduleDeferredPopups();\n  const tabs = visibleTabs();', '  maybeShowDiceRollTurnPopup(); maybeShowCeoAnnouncementExecutionPopup();\n  const tabs = visibleTabs();');

const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 2) + ' — ' + m); }
}

// Scénario 17a : Alice prête ; Bob clique le dernier « Tour Terminé » pendant que l'administratrice force le tour.
async function race17(T){
  const coA = coIdOf(T.A, 'Co Alice'), coB = coIdOf(T.B, 'Co Bob');
  const r0 = await T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
  await T.server.settle();
  const before = T.S();
  // Les deux appareils agissent « en même temps » (aucun n'attend l'autre).
  const pB = T.B.eng.run(`markCompanyReady(${JSON.stringify(coB)}, 0)`);
  const pA = T.A.eng.run(`performRollForAllCompanies({expectedRoll:0, logLine:'⏩ Forçage (test).'})`);
  const [rB, rA] = await Promise.all([pB, pA]);
  await T.server.settle();
  return { r0, rA, rB, before, after: T.S() };
}

(async () => {
  // =====================================================================================================
  await scenario('A. Bogue 17 — « Forcer le tour » croise le dernier « Tour Terminé » : un seul lancer', async () => {
    const T = await setup();
    const r = await race17(T);
    console.log('    transactions :', T.server.stats.tx.map(t => t.client + ':' + t.result).join(', '));
    console.log(`    rollCount serveur : ${r.before.gameClock.rollCount} → ${r.after.gameClock.rollCount}`);
    ok(r.r0 && r.r0.ok === true && r.r0.triggered === false, 'A : Alice est prête (Bob ne l’est pas encore, pas de lancer)');
    ok(r.after.gameClock.rollCount === 1, `A : un seul lancer enregistré (rollCount 0 → ${r.after.gameClock.rollCount}, avant le correctif : 2)`);
    ok(r.after.companies.every(c => !c.ready), 'A : statuts « prête » remis à zéro après l’unique lancer');
    const rollLines = r.after.log.filter(e => /est déclarée non coupable|passe par GO|Forçage \(test\)/.test(e.text)).length;
    ok(r.after.log.filter(e => /Forçage \(test\)/.test(e.text)).length <= 1, 'A : la ligne « forçage » est au plus une fois au journal, écrite dans l’action du lancer');
    const refused = [r.rA, r.rB].filter(x => x === null || (x && x.triggered === false));
    ok(refused.length >= 1, 'A : l’un des deux déclencheurs est refusé sans rejouer le lancer');
    ok(T.A.alerts.concat(T.B.alerts).every(a => /déjà été joué/.test(a)), `A : seul message éventuel : « Ce lancer a déjà été joué » (${JSON.stringify(T.A.alerts.concat(T.B.alerts))})`);
    ok(Math.abs(totalOf(r.after) - totalOf(r.before)) < 1e-6, 'A : conservation de la monnaie sur le serveur');
    ok(converged(T), 'A : les deux appareils convergent vers la valeur du serveur');
  });

  // =====================================================================================================
  await scenario('G. Bogue 17 — Alice annule son « Tour Terminé » pendant que le dernier « Tour Terminé » lance', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await setup(variant === 'ancien' ? { transform: REVERT_TURN } : {});
      const coA = coIdOf(T.A, 'Co Alice'), coB = coIdOf(T.B, 'Co Bob');
      await T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
      await T.server.settle();
      let fired = false;
      T.server.ctl.onTx = async ({ client, out }) => {
        if(fired || client !== 'B' || !JSON.parse(out).lastDiceRollEvent) return;
        fired = true;
        foreignEdit(T, s => { s.companies.find(c => c.name === 'Co Alice').ready = false; s.log.push({ ts: '', text: 'Co Alice annule son statut « prête » (autre appareil).' }); });
      };
      const r = await T.B.eng.run(`markCompanyReady(${JSON.stringify(coB)}, 0)`);
      await T.server.settle();
      const S = T.S();
      if(variant === 'corrigé'){
        ok(fired && r && r.ok === true && r.triggered === false, 'G : Bob est prêt ; son lancer, rejoué sur l’état frais, voit qu’Alice n’est plus prête et n’a pas lieu');
        ok(S.gameClock.rollCount === 0, `G : aucun lancer (rollCount ${S.gameClock.rollCount}, avant le correctif : 1)`);
        ok(T.B.alerts.length === 0, 'G : aucun message sur l’appareil de Bob (le lancer attend simplement Alice)');
        ok(S.companies.find(c => c.name === 'Co Bob').ready === true && converged(T), 'G : Bob reste prêt, les appareils convergent');
      } else {
        ok(S.gameClock.rollCount === 1, `G : contre-épreuve — sans le correctif, le lancer ignore l’annulation d’Alice (rollCount ${S.gameClock.rollCount})`);
      }
    }
  });

  // =====================================================================================================
  await scenario('B. Bogue 17 — la partie se termine pendant l’envoi du lancer : aucun lancer sur la partie finie', async () => {
    const T = await setup();
    const before = T.S();
    let fired = false;
    T.server.ctl.onTx = async ({ client, out }) => {
      if(fired || client !== 'B' || !JSON.parse(out).lastDiceRollEvent) return;
      fired = true;
      foreignEdit(T, s => { s.gameEndedReason = { reason: 'maxDuration' }; s.log.push({ ts: '', text: 'Fin de partie (autre appareil).' }); });
    };
    const res = await T.B.eng.run(`performRollForAllCompanies({expectedRoll:0})`);
    await T.server.settle();
    const S = T.S();
    console.log('    transactions :', T.server.stats.tx.map(t => t.client + ':' + t.result).join(', '), '| alertes :', JSON.stringify(T.B.alerts));
    ok(fired, 'B : la fin de partie est enregistrée par un autre appareil pendant l’envoi du lancer');
    ok(res === null, 'B : le lancer est refusé');
    ok(S.gameEndedReason && S.gameClock.rollCount === before.gameClock.rollCount, `B : aucun lancer sur la partie terminée (rollCount ${S.gameClock.rollCount}, avant le correctif : ${before.gameClock.rollCount + 1})`);
    ok(S.companies.every(c => c.position === before.companies.find(x => x.id === c.id).position), 'B : aucun pion n’a bougé');
    ok(T.B.alerts.length === 1 && /partie est terminée/.test(T.B.alerts[0]), 'B : message « La partie est terminée »');
    ok(converged(T), 'B : les appareils convergent');
    // Contre-épreuve : sans la vérification dans l'action, le lancer est rejoué sur la partie terminée.
    // Section 316 — la garde unique de fin de partie (runActionWithRetry) refuse aussi ce lancer : la contre-épreuve
    // retire les deux vérifications.
    const T2 = await setup({ transform: src => REVERT_TURN(src).replace('      if(state && state.gameEndedReason && !allowAfterGameEnd) return gameEndedActionResult(label); // Section 316', '') });
    let fired2 = false;
    T2.server.ctl.onTx = async ({ client, out }) => {
      if(fired2 || client !== 'B' || !JSON.parse(out).lastDiceRollEvent) return;
      fired2 = true;
      foreignEdit(T2, s => { s.gameEndedReason = { reason: 'maxDuration' }; });
    };
    await T2.B.eng.run(`performRollForAllCompanies({expectedRoll:0})`);
    await T2.server.settle();
    ok(T2.S().gameEndedReason && T2.S().gameClock.rollCount === 1, 'B : contre-épreuve — sans le correctif, un lancer est joué sur la partie terminée');
  });

  // =====================================================================================================
  await scenario('C. Bogue 59 — double « Tour Terminé » (Co Bob enquêtée, Co Alice seule à lancer)', async () => {
    const T = await setup();
    const coA = coIdOf(T.A, 'Co Alice');
    await T.A.eng.run(`attemptActionWithRetry(async ()=>{ const b = state.companies.find(c=>c.name==='Co Bob'); b.inJail = true; b.jailTurnsLeft = 3; return {ok:true}; })`);
    await T.server.settle();
    // 1) Deux clics sans attendre (la file les sérialise) : le 2e trouve l'entreprise déjà prête.
    const p1 = T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    const p2 = T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    const [r1, r2] = await Promise.all([p1, p2]);
    await T.server.settle();
    let S = T.S();
    ok(r1 && r1.ok && r1.triggered === true, 'C : le 1er clic marque Co Alice prête et déclenche le lancer (seule à lancer)');
    ok(r2 && r2.ok === false && r2.code === 'already-ready' && T.A.alerts.length === 0, 'C : le 2e clic, mis en file, trouve Co Alice déjà prête : ignoré sans message');
    ok(S.gameClock.rollCount === 1, `C : un seul lancer (rollCount ${S.gameClock.rollCount})`);
    // 2) 2e clic arrivé après le lancer, avec le numéro de lancer affiché au 1er clic.
    const r3 = await T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    await T.server.settle();
    S = T.S();
    const bob = S.companies.find(c => c.name === 'Co Bob');
    console.log(`    après le 2e clic tardif : rollCount ${S.gameClock.rollCount}, Co Alice prête = ${S.companies.find(c => c.name === 'Co Alice').ready}, enquête de Co Bob : ${bob.jailTurnsLeft} tour(s)`);
    ok(r3 && r3.ok === false && r3.code === 'stale-roll', 'C : le clic tardif est refusé : « Ce lancer a déjà été joué »');
    ok(T.A.alerts.length === 1 && /déjà été joué/.test(T.A.alerts[0]), 'C : le message « Ce lancer a déjà été joué » est affiché');
    ok(S.gameClock.rollCount === 1, `C : toujours un seul lancer (rollCount ${S.gameClock.rollCount}, avant le correctif : 2)`);
    ok(!S.companies.find(c => c.name === 'Co Alice').ready, 'C : Co Alice n’est PAS marquée prête pour le tour suivant (elle garde sa fenêtre de décision)');
    ok(bob.jailTurnsLeft === 2, `C : l’enquête de Co Bob ne perd qu’un tour (${bob.jailTurnsLeft} restant(s), avant le correctif : 1)`);
  });

  // =====================================================================================================
  await scenario('D. Bogue 17 — annuler « Tour Terminé » après que le lancer a été joué', async () => {
    const T = await setup();
    const coA = coIdOf(T.A, 'Co Alice'), coB = coIdOf(T.B, 'Co Bob');
    await T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    await T.server.settle();
    await T.B.eng.run(`markCompanyReady(${JSON.stringify(coB)}, 0)`);
    await T.server.settle();
    ok(T.S().gameClock.rollCount === 1, 'D : le lancer a eu lieu (toutes prêtes)');
    // Alice a encore l'ancien écran : elle clique « Annuler Tour Terminé » du lancer 0.
    await T.A.eng.run(`attemptActionWithRetry(async ()=>{ state.companies.find(c=>c.name==='Co Alice').ready = true; return {ok:true}; })`);
    await T.server.settle();
    const v0 = T.S().version;
    const r = await T.A.eng.run(`cancelCompanyReady(${JSON.stringify(coA)}, 0)`);
    await T.server.settle();
    ok(r && r.ok === false && r.code === 'stale-roll', 'D : l’annulation visant le lancer 0 est refusée (le lancer a été joué)');
    ok(T.S().version === v0 && T.S().companies.find(c => c.name === 'Co Alice').ready === true, 'D : rien n’est enregistré : le « prête » du tour suivant reste intact');
    const r2 = await T.A.eng.run(`cancelCompanyReady(${JSON.stringify(coA)}, 1)`);
    await T.server.settle();
    ok(r2 && r2.ok === true && !T.S().companies.find(c => c.name === 'Co Alice').ready, 'D : l’annulation visant le lancer affiché (1) fonctionne');
  });

  // =====================================================================================================
  await scenario('E. Bogue 74 — « Résultats du tour » d’un lancer refusé puis rejoué', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await setup(variant === 'ancien' ? { transform: REVERT_74 } : {});
      const coA = coIdOf(T.A, 'Co Alice'), coB = coIdOf(T.B, 'Co Bob');
      await T.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
      await T.server.settle();
      T.B.eng.run(`globalThis.__popups = []; showDiceRollTurnPopup = function(co, roll){ __popups.push({roll, pos: co.position, price: co.stockPrice, cash: co.cash}); };`);
      let fired = false;
      T.server.ctl.onTx = async ({ client, out }) => {
        if(fired || client !== 'B' || !JSON.parse(out).lastDiceRollEvent) return;
        fired = true;
        foreignEdit(T, s => { s.log.push({ ts: '', text: 'Écriture sans rapport (autre appareil).' }); });
      };
      seedRandom(74);
      await T.B.eng.run(`markCompanyReady(${JSON.stringify(coB)}, 0)`);
      await T.server.settle();
      T.B.eng.run('maybeShowPendingPopups()'); // fenêtres différées (retouche de la revue) : minuteries inactives dans ce banc
      const S = T.S();
      const real = S.companies.find(c => c.id === coB);
      const pops = T.B.eng.json('__popups');
      const last = pops[pops.length - 1];
      const matches = !!last && last.roll === 0 && last.pos === real.position && Math.abs(last.price - real.stockPrice) < 1e-9 && Math.abs(last.cash - real.cash) < 1e-9;
      console.log(`    [${variant}] fenêtres ouvertes : ${JSON.stringify(pops)} | lancer enregistré : case ${real.position}, cours ${real.stockPrice}, encaisse ${real.cash.toFixed(4)}`);
      if(variant === 'corrigé'){
        ok(fired && S.gameClock.rollCount === 1, 'E : une écriture concurrente arrive pendant l’envoi du lancer, qui est rejoué puis enregistré une fois');
        ok(pops.length === 1, `E : une seule fenêtre « Résultats du tour » (${pops.length})`);
        ok(matches, 'E : elle montre le lancer réellement enregistré (case, cours, encaisse identiques au serveur)');
      } else {
        ok(!matches, 'E : contre-épreuve — avec l’ancien comportement (événement optimiste, écouteur actif pendant l’action), la fenêtre montre un lancer qui n’a pas été enregistré');
      }
    }
  });

  // =====================================================================================================
  await scenario('F. Contre-épreuve 17/59 : sans la vérification du lancer visé, les scénarios A et C échouent', async () => {
    const T = await setup({ transform: REVERT_TURN });
    const r = await race17(T);
    console.log(`    ancien comportement : rollCount ${r.before.gameClock.rollCount} → ${r.after.gameClock.rollCount}`);
    ok(r.after.gameClock.rollCount === 2, `F : sans le correctif, deux lancers pour un tour (rollCount ${r.after.gameClock.rollCount})`);
    const T2 = await setup({ transform: REVERT_TURN });
    const coA = coIdOf(T2.A, 'Co Alice');
    await T2.A.eng.run(`attemptActionWithRetry(async ()=>{ const b = state.companies.find(c=>c.name==='Co Bob'); b.inJail = true; b.jailTurnsLeft = 3; return {ok:true}; })`);
    await T2.server.settle();
    await T2.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    await T2.server.settle();
    await T2.A.eng.run(`markCompanyReady(${JSON.stringify(coA)}, 0)`);
    await T2.server.settle();
    ok(T2.S().gameClock.rollCount === 2, `F : sans le correctif, le 2e clic déclenche un 2e lancer (rollCount ${T2.S().gameClock.rollCount})`);
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
