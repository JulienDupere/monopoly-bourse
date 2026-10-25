// Test — section 315 (audit du 2026-10-19, lot 8), bogue 43 sur DEUX appareils : toutes les entreprises sont sous
// enquête AMF et les deux appareils cliquent « Faire passer le tour » en même temps. Le cadre de la section 308 (numéro
// de lancer attendu dans chaque action) garantit que les tours ne passent qu'une fois : 2 lancers en tout (jusqu'à la
// libération d'Alpha), pas 4 ; monnaie conservée ; les deux appareils convergent.
// Banc à deux appareils : copie locale de celui de tests/section308-tour.test.js (faux serveur Firebase partagé).
// Lancer depuis la racine du dépôt :  node tests/section315-tour-sync.test.js
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

const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
const ANCIEN_43 = s => s.replace('const nobodyCanRoll = mustBeReady.length===0 && activeCompanies().some(c=>c.inJail);', 'const nobodyCanRoll = false;')
  .replace('const allJailed = noCompanyCanRoll();', 'const allJailed = false;');

async function course(engineOpts, tours = [2, 3]){
  const T = await setup(engineOpts);
  foreignEdit(T, s => {
    const a = s.companies.find(c => c.name === 'Co Alice'), b = s.companies.find(c => c.name === 'Co Bob');
    a.inJail = true; a.jailTurnsLeft = tours[0]; a.position = 10; b.inJail = true; b.jailTurnsLeft = tours[1]; b.position = 10;
    s.gameClock.rollCount = 1;
  });
  await T.server.settle();
  const before = T.S();
  const pA = T.A.eng.run('passTurnAllJailed(1)');
  const pB = T.B.eng.run('passTurnAllJailed(1)');
  await Promise.all([pA, pB]);
  await T.server.settle();
  return { T, before, after: T.S() };
}

(async () => {
  await scenario('43s — deux appareils cliquent « Faire passer le tour » au même lancer : les tours ne passent qu’une fois', async () => {
    const { T, before, after } = await course();
    console.log('    transactions :', T.server.stats.tx.map(t => t.client + ':' + t.result).join(', '));
    ok(after.gameClock.rollCount === 3, `2 lancers en tout (1 → ${after.gameClock.rollCount}), pas 4`);
    const a = after.companies.find(c => c.name === 'Co Alice'), b = after.companies.find(c => c.name === 'Co Bob');
    ok(a.inJail === false && b.inJail === true && b.jailTurnsLeft === 1, `Alpha libre, Beta 1 tour restant (obtenu ${b.jailTurnsLeft})`);
    ok(T.A.alerts.concat(T.B.alerts).length === 0, `aucune alerte (refus « déjà joué » silencieux) : ${JSON.stringify(T.A.alerts.concat(T.B.alerts))}`);
    ok(Math.abs(totalOf(after) - totalOf(before)) < 1e-6, 'monnaie conservée sur le serveur');
    ok(converged(T), 'les deux appareils convergent vers la valeur du serveur');
  });
  await scenario('43sc — contre-épreuve (ancien code : partie figée, aucun lancer)', async () => {
    const { after } = await course({ transform: ANCIEN_43 });
    let failed = false;
    try{ check(after.gameClock.rollCount === 3, 'ancien code : 2 lancers'); }catch(e){ failed = true; console.log('  (échec attendu) ' + e.message + ' — rollCount ' + after.gameClock.rollCount); }
    ok(failed, 'contre-épreuve : l’ancien code fait échouer ce scénario');
  });
  // Retouche de la revue : ce sont les revérifications de la section 308 dans l'action du lancer (numéro de lancer attendu
  // ET entreprises prêtes) qui empêchent un tour en trop. Neutraliser le seul numéro de lancer ne suffit pas à le montrer :
  // tant que toutes sont enquêtées, un lancer « en double » ne se distingue pas d'un lancer enchaîné (les comptes à
  // rebours font foi), et dès qu'Alpha est libre la revérification « toutes prêtes » refuse le rejeu (2 lancers).
  const SANS_NUMERO = s => s.replace('function turnActionRefusal(expectedRoll){', 'function turnActionRefusal(expectedRoll){ return null;');
  await scenario('43sd — numéro de lancer seul neutralisé : toujours 2 lancers (la revérification « toutes prêtes » protège)', async () => {
    const { T, after } = await course({ transform: SANS_NUMERO });
    console.log('    transactions :', T.server.stats.tx.map(t => t.client + ':' + t.result).join(', '));
    ok(after.gameClock.rollCount === 3, `2 lancers (obtenu ${after.gameClock.rollCount - 1})`);
  });
  await scenario('43se — contre-épreuve (numéro de lancer ET revérification « toutes prêtes » neutralisés : tour en trop)', async () => {
    const { T, after } = await course({ transform: s => SANS_NUMERO(s).replace('if(opts.requireAllReady){', 'if(false){') });
    console.log('    transactions :', T.server.stats.tx.map(t => t.client + ':' + t.result).join(', '));
    let failed = false;
    try{ check(after.gameClock.rollCount === 3, 'sans revérification : 2 lancers'); }catch(e){ failed = true; console.log(`  (échec attendu) ${e.message} — ${after.gameClock.rollCount - 1} lancers au lieu de 2 (le rejeu de Beta passe alors qu'Alpha, libérée, n'a pas validé son tour)`); }
    ok(failed, 'contre-épreuve : sans les revérifications de la section 308, le rejeu du 2e appareil joue un tour en trop');
  });
  if(failures.length){ console.log('\nÉCHECS :\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 315 (bogue 43, deux appareils) — ${n} vérifications`);
})();
