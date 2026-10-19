// Test — Section 307, bogue 5 : juste après un rechargement de page, une action pouvait être appliquée
// jusqu'à 5 fois puis enregistrée.
//
// Cause : avec le SDK Firebase, la PREMIÈRE exécution de la fonction de transaction se fait sur le cache local.
// Juste après un rechargement, l'écouteur temps réel n'a pas encore reçu sa première valeur : ce cache vaut
// null. saveGame abandonnait alors la transaction (null !== lastSerialized), recevait un instantané vide, ne
// rafraîchissait PAS l'état… mais renvoyait quand même 'conflict'. attemptActionWithRetry rejouait donc
// l'action sur l'état DÉJÀ modifié, 5 fois de suite, et la prochaine action réussie enregistrait le tout.
//
// Comportement attendu : sur un instantané vide, saveGame relit la valeur faisant foi sur le serveur
// (once('value')), remplace l'état par celle-ci, puis renvoie 'conflict' : l'action est réappliquée UNE fois
// sur l'état frais. Si le serveur ne renvoie rien (partie supprimée), échec SANS réappliquer.
//
// Lancer depuis la racine du dépôt :  node tests/audit-bug5.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

// ---------- Faux SDK Firebase (Realtime Database, API compat) ----------
// Il reproduit les traits du vrai SDK qui comptent ici :
//  1) le cache local d'un chemin n'existe que si un écouteur on('value') y est posé ET a reçu sa première
//     valeur (un aller-retour réseau plus tard) ; once('value') lit la valeur du serveur ;
//  2) transaction(fn) exécute fn D'ABORD sur ce cache local (null s'il est vide) ; si fn renvoie undefined, la
//     transaction est abandonnée aussitôt, sans aller au serveur (committed:false, instantané vide) ;
//  3) sinon la valeur part au serveur ; si le serveur avait autre chose que la valeur locale, fn est relancée
//     sur la vraie valeur du serveur (« datastale »), jusqu'à écriture ou abandon.
// Réglages : holdListeners — la première valeur d'un nouvel écouteur est retenue (réseau lent après un
// rechargement) ; onceWarmsCache — once() partage la vue de l'écouteur déjà posé (comme le vrai SDK) et lui
// livre donc sa première valeur en même temps ; à false, cas le plus défavorable : le cache reste vide.
function makeFakeFirebase(){
  const server = new Map();
  const listeners = new Map();          // chemin -> [{cb, primed}]
  const held = [];                      // premières valeurs d'écouteurs encore « en route »
  const opts = { holdListeners: false, onceWarmsCache: true };
  const stats = { tx: [], once: 0 };
  const cur = p => (server.has(p) ? server.get(p) : null);
  const snap = v => ({ exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : v) });
  const list = p => listeners.get(p) || [];
  const cacheKnown = p => list(p).some(l => l.primed);
  const prime = (p, l) => { if(l.primed || !list(p).includes(l)) return; l.primed = true; l.cb(snap(cur(p))); };
  const broadcast = p => list(p).filter(l => l.primed).forEach(l => l.cb(snap(cur(p))));
  const release = (path) => {
    const todo = held.filter(h => path === undefined || h.p === path);
    todo.forEach(h => held.splice(held.indexOf(h), 1));
    todo.forEach(h => prime(h.p, h.l));
  };
  function ref(p){
    return {
      once(){
        stats.once++;
        return Promise.resolve().then(() => { if(opts.onceWarmsCache) release(p); return snap(cur(p)); });
      },
      on(ev, cb){
        const l = { cb, primed: false };
        listeners.set(p, list(p).concat([l]));
        if(opts.holdListeners) held.push({ p, l }); else prime(p, l);
        return cb;
      },
      off(ev, cb){ listeners.set(p, list(p).filter(l => l.cb !== cb)); },
      set(v){ server.set(p, v); broadcast(p); return Promise.resolve(); },
      remove(){ server.delete(p); broadcast(p); return Promise.resolve(); },
      transaction(fn){
        const known = cacheKnown(p);
        let input = known ? cur(p) : null;     // 1re exécution : cache local, null s'il est vide
        let out = fn(input);
        const entry = { cache: known ? 'connu' : 'vide' };
        stats.tx.push(entry);
        if(out === undefined){ entry.result = 'abandon'; return Promise.resolve({ committed: false, snapshot: snap(input) }); }
        return Promise.resolve().then(() => {
          for(let i = 0; i < 25; i++){
            const now = cur(p);
            if(now === input){ server.set(p, out); entry.result = 'écrit'; broadcast(p); return { committed: true, snapshot: snap(out) }; }
            input = now; out = fn(input);
            if(out === undefined){ entry.result = 'abandon (serveur)'; return { committed: false, snapshot: snap(input) }; }
          }
          throw new Error('maxretry');
        });
      },
    };
  }
  const db = { ref };
  const firebase = {
    apps: [],
    initializeApp(){ this.apps.push({}); },
    database(){ return db; },
    auth(){ return { currentUser: { uid: 'anonyme' }, onAuthStateChanged(cb){ cb({ uid: 'anonyme' }); return () => {}; }, signInAnonymously: async () => ({}) }; },
  };
  return { firebase, server, opts, stats, release };
}

// Tirages déterministes (le sandbox partage l'objet Math de Node).
function seedRandom(seed){ let s = seed >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

const totalOf = s => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0) + s.players.reduce((t, p) => t + (p.cash || 0), 0);
const BUY_RE = /achète des actions de Co Alice/;

async function setup(){
  seedRandom(307);
  const fb = makeFakeFirebase();
  const eng = loadEngine({ firebase: fb.firebase });
  eng.sandbox.__FIREBASE_CONFIG__ = { apiKey: 'cle-de-test', databaseURL: 'https://test.firebaseio.com' };
  const alerts = [];
  eng.sandbox.alert = m => alerts.push(String(m));
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  const saved = await eng.run(`saveGame({silent:true})`);       // enregistre le financement des IPO
  if(saved !== true) throw new Error('Mise en place : la sauvegarde initiale a échoué (' + saved + ')');
  const code = eng.run('gameCode');
  const path = 'data/game:' + code;
  const server = () => JSON.parse(fb.server.get(path));
  const local = () => eng.json('state');
  const bob = s => {
    const b = s.players.find(p => p.id === ids[1]);
    const a = s.companies.find(c => c.name === 'Co Alice');
    const sh = (a.shareholders.find(x => x.playerId === ids[1]) || { shares: 0 }).shares;
    return { cash: b.cash, shares: sh, buys: s.log.filter(e => BUY_RE.test(e.text)).length, version: s.version, roll: s.gameClock.rollCount, total: totalOf(s) };
  };
  // Rechargement de la page sur l'appareil de Bob : la page repart sans écouteur ni cache (stopSync), init()
  // appelle loadGame(code), qui lit la partie avec once() puis pose un NOUVEL écouteur dont la première
  // valeur n'est pas encore arrivée.
  async function reload(){
    eng.run('stopSync()');
    fb.opts.holdListeners = true;
    const loaded = await eng.run(`loadGame(${JSON.stringify(code)})`);
    eng.run(`myPlayerId = ${JSON.stringify(ids[1])}`);
    fb.stats.tx.length = 0; fb.stats.once = 0; alerts.length = 0;
    return loaded;
  }
  return { fb, eng, alerts, ids, code, path, server, local, bob, reload };
}

// Bob confirme « Acheter 2 M$ » d'actions de Co Alice dans la modale (même corps que la modale d'achat).
const BUY_CODE = `(globalThis.__applyCalls = 0, runModalActionWithRetry(()=>{
  globalThis.__applyCalls++;
  const co = state.companies.find(c=>c.name==='Co Alice');
  const pl = state.players.find(p=>p.id===myPlayerId);
  const r = tradeCompanyShares(co, pl, 'buy', 2);
  if(!r.ok) return r;
  log(pl.name+' achète des actions de '+co.name+' pour 2 (rechargement).', r.entries);
  return r;
}))`;

const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 1) + ' — ' + m); }
}

(async () => {
  // =====================================================================================================
  await scenario('A. Achat de 2 M$ juste après un rechargement (cache local vide, once() le réchauffe)', async () => {
    const T = await setup();
    const before = T.bob(T.server());
    ok(await T.reload(), 'A : la partie est rechargée depuis le serveur');
    ok(near(T.bob(T.local()).cash, before.cash), `A : après rechargement, Bob a ${before.cash.toFixed(2)} M$ sur son appareil`);
    const res = await T.eng.run(BUY_CODE);
    const tx = T.fb.stats.tx.map(t => t.cache + '/' + t.result).join(', ');
    console.log('    transactions :', tx, '| lectures once :', T.fb.stats.once, '| applyFn appelée', T.eng.run('__applyCalls'), 'fois');
    console.log('    état local après UN clic : encaisse de Bob', T.bob(T.local()).cash.toFixed(2), 'M$, achats au journal', T.bob(T.local()).buys);
    ok(res && res.ok === true, 'A : l’achat réussit (pas de message « 5 fois sans succès »)');
    ok(T.alerts.length === 0, 'A : aucune alerte affichée');
    const L = T.bob(T.local()), S = T.bob(T.server());
    ok(near(L.cash, before.cash - 2), `A : encaisse locale de Bob débitée UNE fois (${before.cash.toFixed(2)} → ${L.cash.toFixed(2)}, attendu ${(before.cash - 2).toFixed(2)})`);
    ok(near(S.cash, before.cash - 2), `A : encaisse de Bob enregistrée sur le serveur débitée une fois (${S.cash.toFixed(2)})`);
    ok(L.buys === 1 && S.buys === 1, `A : une seule ligne d’achat au journal, en local (${L.buys}) et sur le serveur (${S.buys})`);
    ok(S.shares > before.shares && near(S.shares, L.shares), `A : parts de Bob identiques en local et sur le serveur (${S.shares.toFixed(2)})`);
    ok(S.version === before.version + 1, `A : une seule écriture sur le serveur (version ${before.version} → ${S.version})`);
    ok(T.fb.stats.tx.length === 2 && T.fb.stats.tx[0].result === 'abandon' && T.fb.stats.tx[1].result === 'écrit', 'A : 1 abandon sur cache vide, puis 1 écriture après relecture du serveur');
    ok(T.fb.stats.once === 1, 'A : la valeur faisant foi est relue UNE fois sur le serveur (once)');
    ok(T.eng.run('lastSerialized') === T.fb.server.get(T.path), 'A : lastSerialized correspond à la valeur enregistrée sur le serveur');
    ok(near(L.total, before.total) && near(S.total, before.total), `A : conservation de la monnaie — total ${before.total.toFixed(4)} inchangé en local et sur le serveur (argent débité à Bob = argent crédité)`);
    // L'écouteur reçoit enfin sa première valeur, puis Bob fait une autre action.
    T.fb.release();
    await T.eng.run(`setHousesAvailable(1)`);
    const S2 = T.bob(T.server());
    ok(near(S2.cash, before.cash - 2) && S2.buys === 1, `A : après l’action suivante, le serveur garde un seul achat (encaisse ${S2.cash.toFixed(2)}, ${S2.buys} achat)`);
    ok(near(S2.total, before.total), 'A : conservation de la monnaie après l’action suivante');
  });

  // =====================================================================================================
  await scenario('B. Cas le plus défavorable : le cache reste vide pendant les 5 essais', async () => {
    const T = await setup();
    T.fb.opts.onceWarmsCache = false;
    const before = T.bob(T.server());
    await T.reload();
    const res = await T.eng.run(BUY_CODE);
    console.log('    transactions :', T.fb.stats.tx.map(t => t.cache + '/' + t.result).join(', '), '| lectures once :', T.fb.stats.once);
    ok(res && res.ok === false, 'B : l’achat échoue proprement après 5 essais');
    ok(T.alerts.length === 1 && /5 fois sans succès/.test(T.alerts[0]), 'B : le message d’échec est affiché une fois');
    ok(T.fb.stats.tx.every(t => t.result === 'abandon') && T.fb.stats.tx.length === 5, 'B : 5 transactions abandonnées, aucune écriture');
    const L = T.bob(T.local());
    ok(near(L.cash, before.cash) && L.buys === 0, `B : l’état local n’est PAS sali (encaisse ${L.cash.toFixed(2)}, ${L.buys} achat) — il a été remplacé par la valeur du serveur`);
    ok(near(T.bob(T.server()).cash, before.cash), 'B : le serveur n’a rien reçu');
    T.fb.release();
    await T.eng.run(`setHousesAvailable(1)`);
    const S2 = T.bob(T.server());
    ok(near(S2.cash, before.cash) && S2.buys === 0, `B : l’action suivante n’enregistre aucun achat fantôme (encaisse ${S2.cash.toFixed(2)}, avant le correctif : 5 achats)`);
    // Bob reclique « Confirmer » comme l'y invite le message : un seul achat (avant le correctif : 6).
    T.fb.stats.tx.length = 0; T.alerts.length = 0;
    const res2 = await T.eng.run(BUY_CODE);
    const S3 = T.bob(T.server());
    ok(res2 && res2.ok === true && T.fb.stats.tx.length === 1, 'B : le nouveau clic de Bob réussit du premier coup (cache désormais reçu)');
    ok(near(S3.cash, before.cash - 2) && S3.buys === 1, `B : le serveur enregistre UN achat au total (encaisse ${S3.cash.toFixed(2)}, ${S3.buys} achat)`);
    ok(near(S3.total, before.total), 'B : conservation de la monnaie sur le serveur');
  });

  // =====================================================================================================
  await scenario('C. Partie supprimée par un autre appareil : le serveur ne renvoie rien', async () => {
    const T = await setup();
    const before = T.bob(T.server());
    await T.reload();
    T.fb.server.delete(T.path);
    const res = await T.eng.run(BUY_CODE);
    console.log('    transactions :', T.fb.stats.tx.map(t => t.cache + '/' + t.result).join(', '), '| lectures once :', T.fb.stats.once, '| applyFn appelée', T.eng.run('__applyCalls'), 'fois');
    ok(res && res.ok === false, 'C : l’action échoue');
    ok(T.eng.run('__applyCalls') === 1, `C : l’action n’est JAMAIS réappliquée (applyFn appelée ${T.eng.run('__applyCalls')} fois, attendu 1)`);
    const L = T.bob(T.local());
    ok(near(L.cash, before.cash - 2) && L.buys === 1, `C : l’état local porte au plus UNE application (encaisse ${L.cash.toFixed(2)}, ${L.buys} achat)`);
    ok(!T.fb.server.has(T.path), 'C : la partie supprimée n’est pas recréée sur le serveur');
  });

  // =====================================================================================================
  await scenario('D. Un autre appareil a enregistré pendant la fenêtre (cache vide, serveur plus récent)', async () => {
    const T = await setup();
    const before = T.bob(T.server());
    await T.reload();
    // Pendant que le téléphone de Bob recharge, Alice verse 3 M$ à la banque depuis son appareil.
    const s = T.server();
    const alice0 = s.players[0].cash;
    s.players[0].cash -= 3; s.bank.cash += 3; s.version += 1;
    s.log.push({ ts: '', text: 'Alice verse 3 à la banque (autre appareil).' });
    T.fb.server.set(T.path, JSON.stringify(s));
    const res = await T.eng.run(BUY_CODE);
    ok(res && res.ok === true, 'D : l’achat de Bob réussit après rafraîchissement');
    const S = T.server();
    ok(near(S.players[0].cash, alice0 - 3) && S.log.some(e => /Alice verse 3/.test(e.text)), 'D : l’action d’Alice est conservée');
    ok(near(T.bob(S).cash, before.cash - 2) && T.bob(S).buys === 1, `D : l’achat de Bob est enregistré une fois (encaisse ${T.bob(S).cash.toFixed(2)})`);
    ok(S.version === before.version + 2, `D : deux écritures au total (Alice puis Bob, version ${S.version})`);
    ok(near(totalOf(S), before.total), 'D : conservation de la monnaie sur le serveur');
  });

  // =====================================================================================================
  await scenario('E. Sauvegarde directe non silencieuse (saveGame()) juste après un rechargement', async () => {
    const T = await setup();
    const before = T.bob(T.server());
    await T.reload();
    T.eng.run(`(function(){ const b = state.players.find(p=>p.id===myPlayerId); b.cash -= 1; state.bank.cash += 1; })()`);
    const r = await T.eng.run(`saveGame()`);
    ok(r === 'conflict', `E : saveGame renvoie 'conflict' (${r})`);
    ok(T.alerts.length === 1, 'E : l’alerte « tu peux refaire ton action » est affichée');
    ok(near(T.bob(T.local()).cash, before.cash), `E : l’état local a bien été rafraîchi depuis le serveur, comme l’annonce l’alerte (encaisse ${T.bob(T.local()).cash.toFixed(2)})`);
    ok(T.eng.run('lastSerialized') === T.fb.server.get(T.path), 'E : lastSerialized = valeur du serveur');
    T.fb.release();
    await T.eng.run(`setHousesAvailable(1)`);
    ok(near(T.bob(T.server()).cash, before.cash), 'E : l’action suivante n’enregistre pas en douce la mutation abandonnée');
  });

  // =====================================================================================================
  await scenario('F. « Lancer les dés pour tous » juste après un rechargement', async () => {
    const T = await setup();
    const before = T.bob(T.server());
    await T.reload();
    seedRandom(5);
    await T.eng.run(`performRollForAllCompanies()`);
    console.log('    transactions :', T.fb.stats.tx.map(t => t.cache + '/' + t.result).join(', '), '| lectures once :', T.fb.stats.once);
    const L = T.bob(T.local()), S = T.bob(T.server());
    console.log('    rollCount après UN clic : local', L.roll, '| serveur', S.roll, '(avant :', before.roll + ')');
    ok(!T.alerts.some(a => /sans succès/.test(a)), 'F : pas de message d’échec');
    ok(L.roll === before.roll + 1, `F : l’horloge locale n’avance que d’un lancer (${before.roll} → ${L.roll})`);
    ok(S.roll === before.roll + 1, `F : l’horloge enregistrée n’avance que d’un lancer (${S.roll})`);
    ok(S.version === before.version + 1, 'F : une seule écriture du lancer sur le serveur');
    ok(T.eng.run('lastSerialized') === T.fb.server.get(T.path), 'F : l’état local correspond exactement à ce qui est enregistré');
    ok(near(S.total, before.total) && near(L.total, before.total), `F : conservation de la monnaie pendant l’unique lancer — total ${before.total.toFixed(4)} en local et sur le serveur`);
    T.fb.release();
    await T.eng.run(`setHousesAvailable(3)`);
    ok(T.bob(T.server()).roll === before.roll + 1, `F : après l’action suivante, le serveur garde un seul lancer (rollCount ${T.bob(T.server()).roll}, avant le correctif : ${before.roll + 5})`);
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec sur 6 :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
