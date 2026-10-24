// Test — Section 308 : enveloppe transactionnelle des actions (bogues 44, 71, 73) et infrastructure (file d'actions,
// valeurs reçues mises de côté pendant une action, messages d'échec).
//
// 44 : après un échec de sauvegarde, l'action restait dans la mémoire de l'appareil : annoncée réussie mais perdue
//      (l'écouteur remplaçait state pendant l'envoi), ou appliquée une 2e fois au clic suivant (achat de 1 M$
//      enregistré −2 M$).
// 71 : en mode local (window.storage), saveGame écrivait quand même dans Firebase si le SDK était chargé.
// 73 : accepter une offre de swap ou de compensation sans pouvoir la conclure effaçait l'offre (retirée de state
//      avant l'échec, puis enregistrée par l'action suivante).
//
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section308-transaction.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

// ---------- Faux serveur Firebase (même modèle que tests/section308-tour.test.js) ----------
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

const totalOf = s => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0) + s.players.reduce((t, p) => t + (p.cash || 0), 0);
const BUY_RE = /achète des actions de Co Alice/;

// Appareil de Bob en ligne (faux Firebase) dans une partie Alice/Bob.
async function setupFirebase(engineOpts = {}){
  const server = makeFakeServer();
  const eng = loadEngine(Object.assign({ firebase: server.sdk('B') }, engineOpts));
  eng.sandbox.__FIREBASE_CONFIG__ = { apiKey: 'cle-de-test', databaseURL: 'https://test.firebaseio.com' };
  const alerts = [];
  eng.sandbox.alert = m => alerts.push(String(m));
  await eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
  await server.settle();
  const ids = eng.json('state.players.map(p=>p.id)');
  await eng.run(`createCompany(${JSON.stringify(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
  await eng.run(`myPlayerId = ${JSON.stringify(ids[1])}; createCompany(${JSON.stringify(ids[1])}, 'Co Bob', '', 'garp', null, null, null)`);
  await eng.run(`attemptActionWithRetry(async ()=>{ state.companies.forEach(c=>applyCompanyIpoFunding(c)); return {ok:true}; })`);
  await server.settle();
  const path = 'data/game:' + eng.run('gameCode');
  const S = () => JSON.parse(server.cur(path));
  const L = () => eng.json('state');
  const bob = s => {
    const b = s.players.find(p => p.id === ids[1]);
    const a = s.companies.find(c => c.name === 'Co Alice');
    const sh = (a.shareholders.find(x => x.playerId === ids[1]) || { shares: 0 }).shares;
    return { cash: b.cash, shares: sh, buys: s.log.filter(e => BUY_RE.test(e.text)).length, version: s.version, total: totalOf(s) };
  };
  const foreignEdit = (mutate) => { const s = S(); mutate(s); s.version = (s.version || 0) + 1; server.write(path, JSON.stringify(s)); };
  alerts.length = 0; server.stats.tx.length = 0;
  return { server, eng, alerts, ids, path, S, L, bob, foreignEdit };
}

// Bob confirme « Acheter 1 M$ » d'actions de Co Alice dans la fenêtre d'achat.
const BUY_CODE = `(globalThis.__applyCalls = 0, runModalActionWithRetry(()=>{
  globalThis.__applyCalls++;
  const co = state.companies.find(c=>c.name==='Co Alice');
  const pl = state.players.find(p=>p.id===myPlayerId);
  const r = tradeCompanyShares(co, pl, 'buy', 1);
  if(!r.ok) return r;
  log(pl.name+' achète des actions de '+co.name+' pour 1 (section 308).', r.entries);
  return r;
}))`;
// Action directe sans fenêtre : la banque verse 7 M$ à Bob.
const GIFT_CODE = `attemptActionWithRetry(async ()=>{
  const b = state.players.find(p=>p.id===myPlayerId);
  b.cash += 7; state.bank.cash -= 7;
  log('La banque verse 7 à Bob (section 308).');
  return {ok:true};
})`;
const GIFT_RE = /La banque verse 7 à Bob/;

// Contre-épreuves (ancien comportement réintroduit).
const NO_RESTORE_ON_FAILED_SAVE = src => src.replace(
  "if(failure==='conflict') restoreActionLocals(baseLocals); else restoreActionBase(baseRaw, baseLocals);",
  'restoreActionLocals(baseLocals);');
const OLD_LISTENER = src => src
  .replace('}, undefined, false); // Section 308', '}); // Section 308')
  .replace('  if(actionsInFlight>0) return false;\r\n', '').replace('  if(actionsInFlight>0) return false;\n', '')
  .replace('if(typeof incoming.version===\'number\' && confirmedVersion!==null && incoming.version<confirmedVersion) return false;', '');
const NO_DEFERRAL = src => src.replace('  if(actionsInFlight>0) return false;\r\n', '').replace('  if(actionsInFlight>0) return false;\n', '');
const NO_RESTORE_ON_REFUSAL = src => src.replace(
  'if(gen===actionGeneration) restoreActionBase(baseRaw, baseLocals); return res; }',
  'return res; }');
const OLD_SAVE_BACKEND = src => src.replace('const fbDb = window.storage ? null : firebaseDb();', 'const fbDb = firebaseDb();');
const NO_QUEUE = src => src.replace(
  'const run = actionQueueTail.then(()=>runActionWithRetry(applyFn, opts||{}, gen));',
  'const run = runActionWithRetry(applyFn, opts||{}, gen);');

const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 2) + ' — ' + m); }
}

async function scenarioNetworkThenRetry(engineOpts){
  const T = await setupFirebase(engineOpts);
  const before = T.bob(T.S());
  T.server.ctl.failNext.B = 5;
  const res = await T.eng.run(BUY_CODE);
  await T.server.settle();
  const afterFail = { L: T.bob(T.L()), S: T.bob(T.S()), alerts: T.alerts.slice(), res };
  T.alerts.length = 0;
  const res2 = await T.eng.run(BUY_CODE);       // le réseau revient, Bob reclique
  await T.server.settle();
  return { T, before, afterFail, res2, S2: T.bob(T.S()), L2: T.bob(T.L()) };
}

(async () => {
  // =====================================================================================================
  await scenario('A. Bogue 44 — 5 sauvegardes perdues (réseau) pendant un achat de 1 M$, puis nouveau clic', async () => {
    const r = await scenarioNetworkThenRetry();
    const { before, afterFail: f } = r;
    console.log(`    après l’échec : encaisse locale ${f.L.cash.toFixed(2)} (avant ${before.cash.toFixed(2)}), achats au journal ${f.L.buys} | message : « ${(f.alerts[0] || '').slice(0, 110)}… »`);
    ok(f.res && f.res.ok === false && f.res.notSaved === true && f.res.reason === 'network', 'A : l’achat est signalé non enregistré, cause « réseau »');
    ok(f.alerts.length === 1 && /Connexion au serveur perdue/.test(f.alerts[0]) && /PAS été enregistrée/.test(f.alerts[0]) && /dernier état enregistré/.test(f.alerts[0]), 'A : message clair : connexion perdue, action NON enregistrée, la partie affiche le dernier état enregistré');
    ok(near(f.L.cash, before.cash) && near(f.L.shares, before.shares) && f.L.buys === 0, 'A : l’appareil revient exactement au dernier état enregistré (encaisse, parts, journal)');
    ok(near(f.S.cash, before.cash) && f.S.version === before.version, 'A : le serveur n’a rien reçu');
    ok(r.T.eng.run('lastSerialized') === r.T.server.cur(r.T.path), 'A : lastSerialized = valeur du serveur');
    ok(r.res2 && r.res2.ok === true, 'A : le nouveau clic réussit');
    ok(near(r.S2.cash, before.cash - 1) && r.S2.buys === 1, `A : le serveur enregistre UN achat de 1 M$ (encaisse ${before.cash.toFixed(2)} → ${r.S2.cash.toFixed(2)}, avant le correctif : −2 M$)`);
    ok(near(r.S2.shares - before.shares, r.L2.shares - before.shares) && r.S2.shares > before.shares, 'A : parts identiques sur l’appareil et le serveur');
    ok(near(r.S2.total, before.total), 'A : conservation de la monnaie');
    const c = await scenarioNetworkThenRetry({ transform: NO_RESTORE_ON_FAILED_SAVE });
    console.log(`    contre-épreuve : encaisse enregistrée ${c.before.cash.toFixed(2)} → ${c.S2.cash.toFixed(2)}, achats ${c.S2.buys}`);
    ok(near(c.S2.cash, c.before.cash - 2) && c.S2.buys === 2, 'A : contre-épreuve — sans la restauration, le 2e clic enregistre l’achat deux fois (−2 M$)');
  });

  // =====================================================================================================
  await scenario('B. Bogue 44 — envoi refusé une fois après l’événement local optimiste, puis accepté (sans fenêtre)', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await setupFirebase(variant === 'ancien' ? { transform: OLD_LISTENER } : {});
      const before = T.S();
      const bob0 = before.players.find(p => p.id === T.ids[1]).cash;
      T.server.ctl.failNext.B = 1;
      const res = await T.eng.run(GIFT_CODE);
      await T.server.settle();
      const S = T.S();
      const bobS = S.players.find(p => p.id === T.ids[1]).cash;
      const saved = near(bobS, bob0 + 7) && S.log.some(e => GIFT_RE.test(e.text));
      console.log(`    [${variant}] retour ok=${res && res.ok} | encaisse de Bob sur le serveur ${bob0.toFixed(2)} → ${bobS.toFixed(2)} | transactions : ${T.server.stats.tx.map(t => t.result).join(', ')}`);
      if(variant === 'corrigé'){
        ok(res && res.ok === true && saved, 'B : l’action annoncée réussie est bien sur le serveur (+7 M$ et sa ligne de journal)');
        ok(near(totalOf(S), totalOf(before)), 'B : conservation de la monnaie');
        ok(T.eng.run('lastSerialized') === T.server.cur(T.path), 'B : l’appareil correspond au serveur');
      } else {
        ok(res && res.ok === true && !saved, 'B : contre-épreuve — avec l’ancien écouteur (événement optimiste puis retour arrière appliqués pendant l’action), l’action est annoncée réussie mais perdue');
      }
    }
  });

  // =====================================================================================================
  await scenario('C. Valeur d’un autre appareil reçue pendant un envoi qui échoue : mise de côté jusqu’à la fin de l’action', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await setupFirebase(variant === 'ancien' ? { transform: NO_DEFERRAL } : {});
      const before = T.S();
      const bob0 = before.players.find(p => p.id === T.ids[1]).cash;
      const alice0 = before.players.find(p => p.id === T.ids[0]).cash;
      T.server.ctl.failNext.B = 1;
      let fired = false;
      T.server.ctl.onTx = async () => {
        if(fired) return; fired = true;
        T.foreignEdit(s => { s.players[0].cash -= 3; s.bank.cash += 3; s.log.push({ ts: '', text: 'Alice verse 3 à la banque (autre appareil).' }); });
      };
      const res = await T.eng.run(GIFT_CODE);
      await T.server.settle();
      const S = T.S();
      const bobS = S.players.find(p => p.id === T.ids[1]).cash, aliceS = S.players.find(p => p.id === T.ids[0]).cash;
      const both = near(bobS, bob0 + 7) && near(aliceS, alice0 - 3);
      console.log(`    [${variant}] retour ok=${res && res.ok} | serveur : Bob ${bob0.toFixed(2)} → ${bobS.toFixed(2)}, Alice ${alice0.toFixed(2)} → ${aliceS.toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(res && res.ok === true && both, 'C : les deux actions sont enregistrées (Bob +7, Alice −3) : rien de perdu');
        ok(near(totalOf(S), totalOf(before)), 'C : conservation de la monnaie');
        ok(T.eng.run('lastSerialized') === T.server.cur(T.path) && near(T.eng.json('state').players[1].cash, bobS), 'C : l’appareil a convergé vers le serveur');
      } else {
        ok(res && res.ok === true && !near(bobS, bob0 + 7), 'C : contre-épreuve — si la valeur reçue remplace state pendant l’action, l’action de Bob est annoncée réussie mais perdue');
      }
    }
  });

  // =====================================================================================================
  await scenario('D. Conflits répétés : message distinct, l’appareil affiche la valeur du serveur', async () => {
    const T = await setupFirebase();
    T.server.ctl.onTx = async () => { T.foreignEdit(s => { s.log.push({ ts: '', text: 'Écriture concurrente.' }); }); };
    const res = await T.eng.run(GIFT_CODE);
    T.server.ctl.onTx = null;
    await T.server.settle();
    ok(res && res.ok === false && res.notSaved && res.reason === 'conflict', 'D : action non enregistrée après 5 conflits, cause « conflit »');
    ok(/Conflits répétés/.test(res.error) && /5 fois sans succès/.test(res.error) && /PAS été enregistrée/.test(res.error), 'D : le message parle de conflits répétés (et non de connexion perdue)');
    ok(!T.S().log.some(e => GIFT_RE.test(e.text)) && !T.eng.json('state').log.some(e => GIFT_RE.test(e.text)), 'D : l’action n’est ni sur le serveur ni sur l’appareil');
    ok(T.eng.run('lastSerialized') === T.server.cur(T.path), 'D : l’appareil affiche la dernière valeur du serveur');
  });

  // =====================================================================================================
  await scenario('E. Bogue 73 — accepter une offre de compensation ou de swap qu’on ne peut pas conclure', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const eng = loadEngine(variant === 'ancien' ? { transform: NO_RESTORE_ON_REFUSAL } : {});
      const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
      await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      eng.run(`globalThis.coA = state.companies[0].id; globalThis.coB = state.companies[1].id;`);
      const propIds = eng.json(`state.properties.filter(p=>p.owners.length===0).slice(0,2).map(p=>p.id)`);
      await eng.run(`attemptActionWithRetry(async ()=>{
        state.companies[1].cash = 0.1;
        state.rentCompensationOffers.push({id:'comp1', fromCompanyId:coA, toCompanyId:coB, interestRate:0.1});
        state.rentSwapOffers.push({id:'swap1', fromCompanyId:coA, propA:${JSON.stringify(propIds[0])}, generalA:false, capA:null, toCompanyId:coB, propB:${JSON.stringify(propIds[1])}, generalB:false, capB:null, years:1, budgetMode:false, budgetCapA:null, budgetCapB:null});
        return {ok:true};
      })`);
      const T0 = eng.cashTotal();
      await eng.run(`acceptRentCompensationOffer('comp1')`);
      await eng.run(`acceptRentSwapOffer('swap1')`);
      const local = eng.json(`({comp: state.rentCompensationOffers.map(o=>o.id), swap: state.rentSwapOffers.map(o=>o.id)})`);
      await eng.run(`setHousesAvailable(3)`);       // action suivante, réussie
      const saved = JSON.parse(eng.mem.get('game:' + eng.run('gameCode')));
      const kept = saved.rentCompensationOffers.some(o => o.id === 'comp1') && saved.rentSwapOffers.some(o => o.id === 'swap1');
      console.log(`    [${variant}] alertes : ${alerts.length} | offres sur l’appareil : ${JSON.stringify(local)} | offres enregistrées après l’action suivante : comp ${saved.rentCompensationOffers.length}, swap ${saved.rentSwapOffers.length}`);
      if(variant === 'corrigé'){
        ok(alerts.length === 2 && /frais/.test(alerts[0]) && /ne possède plus/.test(alerts[1]), 'E : les deux refus sont expliqués (frais impayables ; terrain non détenu)');
        ok(local.comp.includes('comp1') && local.swap.includes('swap1'), 'E : les deux offres restent sur l’appareil après le refus');
        ok(kept, 'E : après l’action suivante, les deux offres sont toujours enregistrées (avant le correctif : effacées sans trace)');
        ok(near(eng.cashTotal(), T0), 'E : conservation de la monnaie');
      } else {
        ok(!kept, 'E : contre-épreuve — sans la restauration sur refus, l’action suivante efface les offres');
      }
    }
  });

  // =====================================================================================================
  await scenario('F. Bogue 71 — mode local (window.storage) avec le SDK Firebase chargé : aucune écriture Firebase', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const server = makeFakeServer();
      const eng = loadEngine(Object.assign({ firebase: server.sdk('local') }, variant === 'ancien' ? { transform: OLD_SAVE_BACKEND } : {}));
      eng.sandbox.__FIREBASE_CONFIG__ = { apiKey: 'cle-de-test', databaseURL: 'https://test.firebaseio.com' };
      const mem = new Map();
      eng.sandbox.storage = { get: async k => (mem.has(k) ? { value: mem.get(k) } : null), set: async (k, v) => { mem.set(k, v); return true; }, delete: async k => { mem.delete(k); return true; } };
      const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
      await eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
      const ids = eng.json('state.players.map(p=>p.id)');
      await eng.run(`createCompany(${JSON.stringify(ids[0])}, 'Co Alice', '', 'garp', null, null, null)`);
      await server.settle();
      const key = 'game:' + eng.run('gameCode');
      console.log(`    [${variant}] transactions Firebase : ${server.stats.tx.length}, clés Firebase : ${server.data.size}, alertes : ${JSON.stringify(alerts)}`);
      if(variant === 'corrigé'){
        ok(server.stats.tx.length === 0 && server.data.size === 0, 'F : rien n’est envoyé à Firebase (ni transaction ni écriture)');
        ok(mem.get(key) === eng.run('lastSerialized') && JSON.parse(mem.get(key)).companies.length === 1, 'F : la fondation de Co Alice est enregistrée dans window.storage');
        ok(alerts.length === 0, 'F : aucune alerte (avant le correctif : « Alice a déjà une entreprise »)');
      } else {
        ok(server.stats.tx.length > 0, 'F : contre-épreuve — avec l’ancien saveGame, la sauvegarde part vers Firebase');
      }
    }
  });

  // =====================================================================================================
  await scenario('G. Exception dans une action : rien n’est enregistré, l’appareil revient au dernier état', async () => {
    const eng = loadEngine();
    await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    await eng.run('saveGame({silent:true})');
    const key = 'game:' + eng.run('gameCode');
    const saved0 = eng.mem.get(key), bank0 = eng.run('state.bank.cash');
    let res, threw = false;
    try{ res = await eng.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 5; state.players[0].cash += 5; throw new Error('panne simulée'); })`); }
    catch(e){ threw = true; }
    ok(!threw && res && res.ok === false && res.reason === 'exception' && /panne simulée/.test(res.error) && /PAS été enregistrée/.test(res.error), 'G : l’exception devient un échec explicite (« action non enregistrée »)');
    ok(near(eng.run('state.bank.cash'), bank0) && eng.mem.get(key) === saved0, 'G : l’état local est restauré et rien n’est écrit');
    const r2 = await eng.run(`attemptActionWithRetry(async ()=>{ state.bank.cash -= 1; state.players[0].cash += 1; return {ok:true}; })`);
    ok(r2 && r2.ok && near(JSON.parse(eng.mem.get(key)).bank.cash, bank0 - 1), 'G : l’action suivante n’enregistre que sa propre modification');
  });

  // =====================================================================================================
  await scenario('H. File d’actions : une séquence programmatique (plusieurs mises d’une même fenêtre) est sérialisée, rien n’est perdu', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const eng = loadEngine(variant === 'ancien' ? { transform: NO_QUEUE } : {});
      eng.sandbox.__tick = () => new Promise(r => setImmediate(r));
      await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      await eng.run('saveGame({silent:true})');
      const bank0 = eng.run('state.bank.cash');
      eng.run(`globalThis.__active = 0; globalThis.__max = 0; globalThis.__order = [];`);
      const results = await eng.run(`Promise.all([1,2,3].map(i=>attemptActionWithRetry(async ()=>{
        __active++; __max = Math.max(__max, __active);
        const before = state.bank.cash;
        await __tick();
        state.bank.cash = before - i; state.players[0].cash += i; __order.push(i);
        __active--;
        return {ok:true};
      })))`);
      const saved = JSON.parse(eng.mem.get('game:' + eng.run('gameCode')));
      console.log(`    [${variant}] exécutions simultanées max : ${eng.run('__max')}, ordre : ${eng.json('__order')}, banque enregistrée ${bank0} → ${saved.bank.cash}`);
      if(variant === 'corrigé'){
        ok(results.every(r => r && r.ok), 'H : les trois actions réussissent');
        ok(eng.run('__max') === 1 && eng.json('__order').join(',') === '1,2,3', 'H : jamais deux actions en même temps, dans l’ordre des appels');
        ok(near(saved.bank.cash, bank0 - 6), 'H : les trois versements sont enregistrés (−6)');
        ok(eng.run('actionsInFlight') === 0, 'H : la file est vide à la fin');
      } else {
        ok(eng.run('__max') > 1 && !near(saved.bank.cash, bank0 - 6), 'H : contre-épreuve — sans file, les actions se chevauchent et des versements sont perdus');
      }
    }
  });

  // =====================================================================================================
  await scenario('I. Action imbriquée : exécutée dans l’action englobante, sans blocage', async () => {
    const eng = loadEngine();
    await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    await eng.run('saveGame({silent:true})');
    const v0 = eng.run('state.version');
    const res = await eng.run(`attemptActionWithRetry(async ()=>{
      state.bank.cash -= 1; state.players[0].cash += 1;
      const inner = await attemptActionWithRetry(async ()=>{ state.bank.cash -= 2; state.players[1].cash += 2; return {ok:true}; });
      return inner;
    })`);
    ok(res && res.ok && eng.run('state.version') === v0 + 1, 'I : une seule sauvegarde pour l’action et son action imbriquée');
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
