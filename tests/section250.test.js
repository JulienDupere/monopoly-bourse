// Test — Section 250 (correctif d'origine, fait par Sonnet) : une ÉCRITURE qui échoue (réseau coupé, Firebase
// indisponible) ne doit JAMAIS faire rejouer l'action. Seul un VRAI conflit (un autre appareil a sauvegardé
// entre-temps) la fait recalculer, sur l'état frais. Avant la section 250, saveGame renvoyait le même `false`
// dans les deux cas et attemptActionWithRetry rejouait l'action à chaque essai : un achat pouvait être appliqué
// jusqu'à 5 fois.
//
// Le test se termine par une CONTRE-ÉPREUVE : il recharge le moteur avec l'ancien comportement réintroduit
// (« toujours rejouer ») et vérifie que le scénario A détecte bien le rejeu. Si un jour la ligne du correctif
// est modifiée, ce test échoue.
//
// Lancer depuis la racine du dépôt :  node tests/section250.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

// ---------- Faux SDK Firebase minimal ----------
// - l'écouteur on('value') reçoit aussitôt sa valeur : le cache local est connu (pas le cas du rechargement,
//   couvert par audit-bug5.test.js) ;
// - failWrites = k : les k prochaines transactions échouent avec une erreur réseau (la promesse est rejetée,
//   saveGame renvoie false) ;
// - conflictBeforeNextTx = fonction : juste avant la prochaine transaction, « un autre appareil » modifie la
//   partie sur le serveur ; la transaction voit alors une valeur différente et s'abandonne (vrai conflit).
function makeFakeFirebase(){
  const server = new Map();
  const listeners = new Map();
  const ctl = { failWrites: 0, conflictBeforeNextTx: null };
  const stats = { tx: [] };
  const cur = p => (server.has(p) ? server.get(p) : null);
  const snap = v => ({ exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : v) });
  function ref(p){
    return {
      once(){ return Promise.resolve(snap(cur(p))); },
      on(ev, cb){ listeners.set(p, (listeners.get(p) || []).concat([cb])); cb(snap(cur(p))); return cb; },
      off(ev, cb){ listeners.set(p, (listeners.get(p) || []).filter(x => x !== cb)); },
      set(v){ server.set(p, v); return Promise.resolve(); },
      remove(){ server.delete(p); return Promise.resolve(); },
      transaction(fn){
        if(ctl.failWrites > 0){
          ctl.failWrites--;
          stats.tx.push('échec réseau');
          return Promise.reject(new Error('Réseau coupé (simulé)'));
        }
        if(ctl.conflictBeforeNextTx){ const f = ctl.conflictBeforeNextTx; ctl.conflictBeforeNextTx = null; f(); }
        const input = cur(p);
        const out = fn(input);
        if(out === undefined){ stats.tx.push('conflit'); return Promise.resolve({ committed: false, snapshot: snap(input) }); }
        server.set(p, out);
        stats.tx.push('écrit');
        return Promise.resolve({ committed: true, snapshot: snap(out) });
      },
    };
  }
  const firebase = {
    apps: [],
    initializeApp(){ this.apps.push({}); },
    database(){ return { ref }; },
    auth(){ return { currentUser: { uid: 'anonyme' }, onAuthStateChanged(cb){ cb({ uid: 'anonyme' }); return () => {}; }, signInAnonymously: async () => ({}) }; },
  };
  return { firebase, server, ctl, stats };
}

const BUY_RE = /achète des actions de Co Alice/;
const totalOf = s => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0) + s.players.reduce((t, p) => t + (p.cash || 0), 0);

async function setup(engineOpts = {}){
  const fb = makeFakeFirebase();
  const eng = loadEngine(Object.assign({ firebase: fb.firebase }, engineOpts));
  eng.sandbox.__FIREBASE_CONFIG__ = { apiKey: 'cle-de-test', databaseURL: 'https://test.firebaseio.com' };
  const alerts = [];
  eng.sandbox.alert = m => alerts.push(String(m));
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  const saved = await eng.run(`saveGame({silent:true})`);
  if(saved !== true) throw new Error('Mise en place : la sauvegarde initiale a échoué (' + saved + ')');
  eng.run(`myPlayerId = ${JSON.stringify(ids[1])}`);
  const path = 'data/game:' + eng.run('gameCode');
  const server = () => JSON.parse(fb.server.get(path));
  const local = () => eng.json('state');
  const bob = s => {
    const b = s.players.find(p => p.id === ids[1]);
    const a = s.companies.find(c => c.name === 'Co Alice');
    const sh = (a.shareholders.find(x => x.playerId === ids[1]) || { shares: 0 }).shares;
    return { cash: b.cash, shares: sh, buys: s.log.filter(e => BUY_RE.test(e.text)).length, version: s.version, total: totalOf(s) };
  };
  // « Un autre appareil » : Alice verse 3 M$ à la banque, directement sur le serveur.
  const otherDeviceWrite = () => {
    const s = server();
    s.players[0].cash -= 3; s.bank.cash += 3;
    s.log.unshift({ text: 'Alice verse 3 à la banque (autre appareil).', time: '' });
    s.version = (s.version || 0) + 1;
    fb.server.set(path, JSON.stringify(s));
  };
  fb.stats.tx.length = 0; alerts.length = 0;
  return { fb, eng, alerts, ids, server, local, bob, otherDeviceWrite };
}

// Bob confirme « Acheter 2 M$ » d'actions de Co Alice dans la fenêtre d'achat (même chemin que l'interface).
const BUY_CODE = `(globalThis.__applyCalls = 0, runModalActionWithRetry(()=>{
  globalThis.__applyCalls++;
  const co = state.companies.find(c=>c.name==='Co Alice');
  const pl = state.players.find(p=>p.id===myPlayerId);
  const r = tradeCompanyShares(co, pl, 'buy', 2);
  if(!r.ok) return r;
  log(pl.name+' achète des actions de '+co.name+' pour 2 (section 250).', r.entries);
  return r;
}))`;

// Ancien comportement d'avant la section 250 : l'action est rejouée après CHAQUE échec, conflit ou non.
const REVERT_250 = src => src.replace("needsReapply = (saved==='conflict');", 'needsReapply = true;');

async function scenarioA(T, label){
  const before = T.bob(T.server());
  T.fb.ctl.failWrites = 5;
  const res = await T.eng.run(BUY_CODE);
  const L = T.bob(T.local()), S = T.bob(T.server());
  return { before, res, L, S, applyCalls: T.eng.run('__applyCalls'), tx: T.fb.stats.tx.slice() };
}

(async () => {
  // ===================================================================================================
  console.log('A. Écriture coupée 5 fois de suite pendant un achat de 2 M$');
  {
    const T = await setup();
    const r = await scenarioA(T);
    console.log('    transactions :', r.tx.join(', '), '| action appliquée', r.applyCalls, 'fois');
    ok(r.tx.length === 5 && r.tx.every(t => t === 'échec réseau'), 'A : 5 tentatives d’écriture, toutes en échec réseau');
    ok(r.applyCalls === 1, `A : l’achat n’est appliqué qu’UNE fois malgré 5 échecs (appliqué ${r.applyCalls} fois)`);
    ok(r.res && r.res.ok === false, 'A : l’action est signalée en échec');
    ok(T.alerts.length === 1, 'A : un seul message d’échec affiché');
    // Section 308 : l'achat non enregistré est retiré de l'appareil (avant : il y restait, appliqué une fois).
    ok(near(r.L.cash, r.before.cash) && r.L.buys === 0, `A : sur l’appareil, l’achat non enregistré est retiré (encaisse ${r.before.cash.toFixed(2)} → ${r.L.cash.toFixed(2)})`);
    ok(near(r.S.cash, r.before.cash) && r.S.buys === 0 && r.S.version === r.before.version, 'A : le serveur n’a rien reçu');
    // Le réseau revient : la prochaine sauvegarde enregistre UN seul achat, jamais cinq.
    const saved = await T.eng.run('saveGame({silent:true})');
    const S2 = T.bob(T.server());
    ok(saved === true, 'A : au retour du réseau, la sauvegarde suivante réussit');
    ok(S2.buys <= 1 && near(S2.cash, r.before.cash - 2 * S2.buys), `A : le serveur enregistre au plus UN achat (${S2.buys}), jamais cinq`);
    ok(near(S2.total, r.before.total), 'A : conservation de la monnaie sur le serveur');
  }

  // ===================================================================================================
  console.log('B. Écriture coupée 2 fois, puis rétablie');
  {
    const T = await setup();
    const before = T.bob(T.server());
    T.fb.ctl.failWrites = 2;
    const res = await T.eng.run(BUY_CODE);
    const L = T.bob(T.local()), S = T.bob(T.server());
    console.log('    transactions :', T.fb.stats.tx.join(', '), '| action appliquée', T.eng.run('__applyCalls'), 'fois');
    ok(T.fb.stats.tx.join(',') === 'échec réseau,échec réseau,écrit', 'B : deux échecs puis une écriture réussie');
    ok(T.eng.run('__applyCalls') === 1, 'B : l’achat n’est appliqué qu’UNE fois');
    ok(res && res.ok === true && T.alerts.length === 0, 'B : l’achat réussit, sans message d’erreur');
    ok(near(S.cash, before.cash - 2) && S.buys === 1, `B : le serveur enregistre un seul achat (encaisse ${S.cash.toFixed(2)})`);
    ok(S.version === before.version + 1, 'B : une seule écriture sur le serveur');
    ok(near(L.cash, S.cash) && L.buys === S.buys, 'B : l’appareil et le serveur sont identiques');
    ok(near(S.total, before.total), 'B : conservation de la monnaie');
  }

  // ===================================================================================================
  console.log('C. Témoin : un VRAI conflit fait recalculer l’action, une seule fois, sur l’état frais');
  {
    const T = await setup();
    const before = T.bob(T.server());
    const alice0 = T.server().players[0].cash;
    T.fb.ctl.conflictBeforeNextTx = T.otherDeviceWrite;
    const res = await T.eng.run(BUY_CODE);
    const S = T.server(), B = T.bob(S);
    console.log('    transactions :', T.fb.stats.tx.join(', '), '| action appliquée', T.eng.run('__applyCalls'), 'fois');
    ok(T.fb.stats.tx.join(',') === 'conflit,écrit', 'C : un conflit, puis une écriture');
    ok(T.eng.run('__applyCalls') === 2, 'C : l’achat est recalculé une fois sur l’état frais (2 calculs, 1 seul enregistré)');
    ok(res && res.ok === true, 'C : l’achat réussit');
    ok(near(S.players[0].cash, alice0 - 3), 'C : l’action de l’autre appareil (Alice) est conservée');
    ok(near(B.cash, before.cash - 2) && B.buys === 1, `C : l’achat de Bob est enregistré une seule fois (encaisse ${B.cash.toFixed(2)})`);
    ok(B.version === before.version + 2, 'C : deux écritures au total (Alice, puis Bob)');
    ok(near(totalOf(S), before.total), 'C : conservation de la monnaie');
  }

  // ===================================================================================================
  console.log('D. Contre-épreuve : avec l’ancien comportement réintroduit, le test détecte bien le rejeu');
  {
    const T = await setup({ transform: REVERT_250 });
    const r = await scenarioA(T);
    console.log('    ancien comportement : action appliquée', r.applyCalls, 'fois, encaisse', r.before.cash.toFixed(2), '→', r.L.cash.toFixed(2));
    ok(r.applyCalls === 5, `D : sans le correctif, l’achat est appliqué 5 fois (${r.applyCalls}) — le scénario A l’aurait détecté`);
    // Section 308 : l'enveloppe retire la dernière application non enregistrée ; il en reste quatre (8 M$).
    ok(near(r.L.cash, r.before.cash - 8), `D : sans le correctif, l’appareil garde 4 achats non enregistrés, 8 M$ débités (${r.L.cash.toFixed(2)})`);
  }

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
