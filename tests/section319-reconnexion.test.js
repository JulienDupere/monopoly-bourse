// Test — Section 319 (lot A), constat M4 de la relecture du 2026-11-11 : après une panne de réseau, le vrai SDK
// (compat 10.14.1) espace ses tentatives de reconnexion (délai x1,3 à chaque échec, jusqu'à 5 minutes) ; pendant ce
// temps l'application refuse toute action (« Pas de connexion au serveur ») alors qu'Internet est revenu.
//
// Le faux SDK est ici en mode « reconnexionProgressive » (tests/helpers/fake-firebase.js, désactivé par défaut) :
// tentatives à délai croissant comme PersistentConnection ; goOffline() + goOnline() = délai remis à 1 s et tentative
// immédiate. Scénario chiffré : la box d'Alice perd Internet 20 minutes, écran allumé. À la fin de la panne, le délai
// du SDK est au plafond (300 s) : la tentative suivante peut tomber jusqu'à 5 minutes plus tard.
// Après : tant que « .info/connected » est faux et que la page est visible, l'application relance la reconnexion
// (goOffline puis goOnline) toutes les 15 s, et à chaque action refusée hors ligne (au plus une relance par 5 s).
//
// A. Relance périodique : après 20 minutes de panne, la connexion revient moins de 20 s après Internet, et l'action
//    d'Alice passe. Contre-épreuve (sans relance) : attente bien plus longue, actions refusées entre-temps.
// B. Relance sur action refusée (relance périodique neutralisée pour l'isoler) : l'action tentée 1 s après le retour
//    d'Internet est refusée, provoque la reconnexion en moins de 2 s, et l'essai suivant passe.
// C. Gardes : jamais connecté, jamais en mode local, jamais page cachée, jamais sans goOffline/goOnline, au plus une
//    relance par 5 s (15 s pour la relance périodique, après 15 s de coupure) ; goOnline toujours tenté.
// D. Une action en vol n'est ni perdue ni doublée par les relances (accusé perdu ; action lancée au début de la panne).
//
// Lancer depuis la racine du dépôt :  node tests/section319-reconnexion.test.js
const { Reseau, loadEngine, partie, appareil, serveur, caisse, ecouler, micro, INVESTIR, compteur, sub } = require('./helpers/banc-319');
const T = compteur(); const { ok, scenario } = T;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const s1 = ms => (ms / 1000).toFixed(1) + ' s';

// Contre-épreuves.
const SANS_RELANCE = sub('function nudgeFirebaseReconnect(minGapMs, minOfflineMs){\n', 'function nudgeFirebaseReconnect(minGapMs, minOfflineMs){\n  return false;\n');
const SANS_PERIODIQUE = sub('    nudgeFirebaseReconnect(FIREBASE_RECONNECT_NUDGE_EVERY_MS, FIREBASE_RECONNECT_NUDGE_EVERY_MS); // Section 319 — M4 : coupure qui dure, page visible : relance périodique de la reconnexion\n', '');

const PANNE_MS = 20 * 60 * 1000;
async function miseEnPlace({ transform, graine, progressive = true }){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine, reconnexionProgressive: progressive });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { transform, dom: true }), B = appareil(R, P, 'Bob', P.ids[1], { transform });
  await R.pomper();
  // Compte les relances (goOnline) et leurs heures.
  A.eng.run(`globalThis.__relances = []; (function(){ const d = firebaseDbInstance; if(d && typeof d.goOnline === 'function'){ const g = d.goOnline; d.goOnline = function(){ __relances.push(Date.now()); return g.apply(this, arguments); }; } })()`);
  return { P, R, A, B, avant: serveur(R, P) };
}
// Attend la reconnexion d'Alice (au plus maxMs) ; renvoie le temps écoulé depuis `depuis`.
async function attendreConnexion(e, depuis, maxMs){
  while(!e.A.client.connecte && e.R.temps - depuis < maxMs) await ecouler(e.R, 250);
  await micro();
  return e.A.client.connecte ? e.R.temps - depuis : null;
}
const ecartMin = t => t.slice(1).reduce((m, x, i) => Math.min(m, x - t[i]), Infinity);

(async () => {
  await scenario('A. Panne de 20 minutes, écran allumé : la connexion revient moins de 20 s après Internet (relance périodique)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const e = await miseEnPlace({ graine: 21, transform: variante === 'ancien' ? SANS_RELANCE : undefined });
      const { R, A, P } = e;
      const t0 = R.temps;
      R.couper(A.client, PANNE_MS);
      await ecouler(R, PANNE_MS - (R.temps - t0));
      const retour = t0 + PANNE_MS;
      const relances = A.eng.json('__relances');
      console.log(`    [${variante}] pendant la panne : ${A.client.tentatives.length} tentative(s) de connexion, ${relances.length} relance(s) de l'application ; délai du SDK avant sa prochaine tentative : jusqu'à ${s1(A.client.delaiReconnexion)}`);
      // Aucune action tentée avant la reconnexion dans la variante corrigée (elle relancerait aussi : scénario B).
      const refus = variante === 'ancien' ? await A.eng.run(INVESTIR(1)) : null;   // Internet vient de revenir ; l'appareil ne le sait pas
      const attente = await attendreConnexion(e, retour, 6 * 60 * 1000);
      console.log(`    [${variante}] Internet revenu ; connexion rétablie après ${attente === null ? 'plus de 6 minutes' : s1(attente)}`);
      if(variante === 'corrigé'){
        ok(relances.length >= 17 && relances.length <= 26 && ecartMin(relances) >= 15000, `A : relances espacées tant que la coupure dure, 15 s au moins puis jusqu’à 60 s (${relances.length} en 20 minutes, écart minimal ${s1(ecartMin(relances))})`);
        ok(A.client.delaiReconnexion <= 60000, `A : le délai du SDK reste sous une minute (${s1(A.client.delaiReconnexion)} au lieu de 300 s)`);
        ok(attente !== null && attente <= 20000, `A : connexion rétablie ${s1(attente)} après le retour d'Internet (moins de 20 s)`);
        const res = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
        await R.pomper();
        const S = serveur(R, P);
        ok(res.ok === true && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'A : l’action d’Alice passe aussitôt (1 M$, encaisse 44 → 43)');
        ok(near(caisse(S), caisse(e.avant)) && A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'A : monnaie conservée ; l’appareil affiche la valeur du serveur');
      } else {
        ok(relances.length === 0 && near(A.client.delaiReconnexion, 300000), 'A : contre-épreuve — sans relance, le délai du SDK est au plafond (300 s)');
        ok(attente === null || attente > 20000, `A : contre-épreuve — connexion rétablie seulement après ${attente === null ? 'plus de 6 minutes' : s1(attente)} ; d'ici là toute action est refusée`);
        ok(refus.ok === false && refus.reason === 'offline', 'A : contre-épreuve — action refusée « Pas de connexion au serveur » alors qu’Internet est revenu');
      }
    }
  });

  await scenario('B. Action tentée après le retour d’Internet : refusée, elle provoque la reconnexion en moins de 2 s ; l’essai suivant passe', async () => {
    for(const variante of ['corrigé', 'ancien']){
      // La relance périodique est neutralisée dans les deux variantes, pour isoler la relance déclenchée par l'action.
      const e = await miseEnPlace({ graine: 22, transform: variante === 'ancien' ? SANS_RELANCE : SANS_PERIODIQUE });
      const { R, A, P } = e;
      const t0 = R.temps;
      R.couper(A.client, PANNE_MS);
      await ecouler(R, PANNE_MS + 1000 - (R.temps - t0));   // Internet est revenu depuis 1 s
      const horsLigne = !A.client.connecte && A.eng.run('isKnownOffline()') === true;
      const tx0 = A.client.stats.transactions, tent0 = A.client.tentatives.length, delai0 = A.client.delaiReconnexion;
      const tClic = R.temps;
      const r1 = await A.eng.run(INVESTIR(1));
      const relances = A.eng.json('__relances'), rienEnvoye = A.client.stats.transactions === tx0;
      await ecouler(R, 2000);
      const provoquees = A.client.tentatives.filter(t => t >= tClic).length;
      const connecte = A.client.connecte && A.eng.run('firebaseConnected') === true;
      const r2 = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
      await R.pomper();
      const S = serveur(R, P);
      console.log(`    [${variante}] 1 s après le retour d'Internet : hors ligne ${horsLigne}, délai du SDK ${s1(delai0)} ; 1er essai : ${JSON.stringify({ ok: r1.ok, reason: r1.reason })}, relances ${relances.length}, tentatives de connexion dans les 2 s ${provoquees} ; 2 s plus tard : connecté ${connecte} ; 2e essai : ${JSON.stringify({ ok: r2.ok, reason: r2.reason })} ; bons d'Alice ${S.players[0].bondBalance || 0}`);
      if(variante === 'corrigé'){
        ok(horsLigne && near(delai0, 300000), 'B : 1 s après le retour d’Internet, l’appareil se croit encore hors ligne (délai du SDK au plafond : 300 s)');
        ok(r1.ok === false && r1.reason === 'offline' && r1.notSaved === true && rienEnvoye, 'B : 1er essai refusé (« Pas de connexion au serveur »), rien n’est envoyé');
        ok(relances.length === 1 && A.client.tentatives.length > tent0 && A.client.tentatives[tent0] - tClic <= 500, `B : ce refus relance la reconnexion (goOffline + goOnline) : tentative ${A.client.tentatives[tent0] - tClic} ms après le clic`);
        ok(connecte, 'B : 2 s plus tard, la connexion est rétablie');
        ok(r2.ok === true && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'B : le 2e essai passe (1 M$ investi une seule fois, encaisse 44 → 43)');
        ok(near(caisse(S), caisse(e.avant)) && A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'B : monnaie conservée ; l’appareil affiche la valeur du serveur');
      } else {
        ok(horsLigne && r1.ok === false && relances.length === 0 && !connecte, 'B : contre-épreuve — sans relance, 2 s après le refus l’appareil est toujours hors ligne');
        ok(r2.ok === false && r2.reason === 'offline' && !S.players[0].bondBalance, 'B : contre-épreuve — le 2e essai est refusé lui aussi, rien n’est enregistré');
      }
    }
  });

  await scenario('C. Gardes : seulement quand la connexion est coupée, page visible, vrai SDK ; au plus une relance par 5 s', async () => {
    const e = await miseEnPlace({ graine: 23 });
    const { R, A } = e;
    const n = () => A.eng.run('__relances.length');
    ok(A.eng.run('nudgeFirebaseReconnect()') === false && n() === 0, 'C : connecté : aucune relance');
    R.couper(A.client, 60 * 60 * 1000); await micro();
    ok(A.eng.run('firebaseConnected') === false, 'C : coupure : « .info/connected » est faux');
    ok(A.eng.run('nudgeFirebaseReconnect()') === true && n() === 1, 'C : coupé : relance (goOffline puis goOnline)');
    ok(A.eng.run('nudgeFirebaseReconnect()') === false && n() === 1, 'C : relance immédiate suivante : refusée');
    // Section 319 — retouche du banc réel : l'écart exigé double après chaque relance d'une même coupure (5, 10, 20, 40, 60 s).
    R.temps += 9999;
    ok(A.eng.run('nudgeFirebaseReconnect()') === false && n() === 1, 'C : 9,999 s plus tard : encore refusée (écart doublé après la 1re relance)');
    R.temps += 1;
    ok(A.eng.run('nudgeFirebaseReconnect()') === true && n() === 2, 'C : 10 s plus tard : acceptée ; l’écart exigé passe à 20 s');
    R.temps += 15000;
    ok(A.eng.run('nudgeFirebaseReconnect(FIREBASE_RECONNECT_NUDGE_EVERY_MS, FIREBASE_RECONNECT_NUDGE_EVERY_MS)') === false && n() === 2, 'C : relance périodique 15 s après la précédente : refusée (écart exigé : 20 s)');
    R.temps += 5000;
    A.doc.visibilityState = 'hidden';
    ok(A.eng.run('nudgeFirebaseReconnect(FIREBASE_RECONNECT_NUDGE_EVERY_MS, FIREBASE_RECONNECT_NUDGE_EVERY_MS)') === false && A.eng.run('nudgeFirebaseReconnect()') === false && n() === 2, 'C : page cachée : aucune relance');
    A.doc.visibilityState = 'visible';
    ok(A.eng.run('nudgeFirebaseReconnect(FIREBASE_RECONNECT_NUDGE_EVERY_MS, FIREBASE_RECONNECT_NUDGE_EVERY_MS)') === true && n() === 3, 'C : page visible, 20 s après la précédente : relance périodique ; l’écart exigé passe à 40 s');
    ok(A.eng.run('FIREBASE_RECONNECT_NUDGE_MIN_MS') === 5000 && A.eng.run('FIREBASE_RECONNECT_NUDGE_EVERY_MS') === 15000 && A.eng.run('FIREBASE_RECONNECT_NUDGE_MAX_GAP_MS') === 60000 && A.eng.run('firebaseReconnectNudgeGapMs') === 40000, 'C : réglages — 5 s au moins, 15 s pour la relance périodique, écart doublé jusqu’à 60 s');
    // goOffline qui échoue : goOnline est tenté quand même (ne jamais rester hors ligne).
    R.temps += 40000;
    A.eng.run(`console = {error(){}, log(){}, warn(){}}; firebaseDbInstance.goOffline = function(){ throw new Error('panne simulée'); };`);
    ok(A.eng.run('nudgeFirebaseReconnect()') === true && n() === 4, 'C : goOffline en erreur : goOnline est appelé quand même');
    // SDK sans goOffline / goOnline (faux SDK par défaut) : rien, sans erreur.
    const e2 = await miseEnPlace({ graine: 24, progressive: false });
    e2.R.couper(e2.A.client, 5000); await micro();
    ok(e2.A.eng.run('firebaseConnected') === false && e2.A.eng.run('nudgeFirebaseReconnect()') === false, 'C : base sans goOffline/goOnline : aucune relance, aucune erreur');
    await e2.R.pomper();
    // Mode local (window.storage) : jamais, même si un SDK et une connexion « coupée » étaient présents.
    const eng = loadEngine();
    await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    eng.run(`globalThis.__n = 0; firebaseConnected = false; firebaseDisconnectedSinceMs = 1; firebaseDbInstance = {goOffline(){ __n++; }, goOnline(){ __n++; }};`);
    ok(eng.run('nudgeFirebaseReconnect()') === false && eng.run('__n') === 0, 'C : mode local (window.storage) : jamais de relance');
    eng.run('firebaseDbInstance = null; firebaseConnected = null;');
  });

  await scenario('D. Une action en vol n’est ni perdue ni doublée par les relances', async () => {
    // a) Accusé perdu : le serveur a écrit, la connexion tombe 60 s ; relances pendant la coupure.
    const e = await miseEnPlace({ graine: 25 });
    e.R.couperApresProchaineEcriture(e.A.client, 60 * 1000);
    let ra = null; e.A.eng.run(INVESTIR(1)).then(r => { ra = r; });
    for(let i = 0; i < 400 && ra === null; i++) await ecouler(e.R, 500);
    await e.R.pomper();
    let S = serveur(e.R, e.P);
    console.log(`    a) accusé perdu, coupure de 60 s : ${e.A.eng.run('__relances.length')} relance(s) ; annoncé ${JSON.stringify(ra && { ok: ra.ok, uncertain: ra.uncertain, reason: ra.reason })} ; bons d'Alice ${S.players[0].bondBalance || 0}, encaisse ${S.players[0].cash}`);
    ok(e.A.eng.run('__relances.length') >= 2, 'D : des relances ont eu lieu pendant la coupure');
    ok(ra && ra.ok === true && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'D : accusé perdu + relances : l’action est reconnue écrite, un seul investissement (44 → 43)');
    ok(near(caisse(S), caisse(e.avant)) && e.A.eng.run('JSON.stringify(state)') === e.R.valeur(e.P.chemin), 'D : monnaie conservée ; appareil = serveur');
    // b) Action lancée dans les 2 premières secondes de la panne (pas encore « connue ») : elle attend le réseau.
    const f = await miseEnPlace({ graine: 26 });
    f.R.couper(f.A.client, 60 * 1000); await micro();
    let rb = null; f.A.eng.run(INVESTIR(1)).then(r => { rb = r; });
    await micro();
    const enVol = f.A.eng.run('actionsInFlight') === 1;
    for(let i = 0; i < 400 && rb === null; i++) await ecouler(f.R, 500);
    await f.R.pomper();
    S = serveur(f.R, f.P);
    console.log(`    b) action en attente du réseau, coupure de 60 s : ${f.A.eng.run('__relances.length')} relance(s) ; annoncé ${JSON.stringify(rb && { ok: rb.ok, reason: rb.reason })} ; bons d'Alice ${S.players[0].bondBalance || 0}`);
    ok(enVol && f.A.eng.run('__relances.length') >= 2 && rb && rb.ok === true && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'D : action en attente du réseau + relances : enregistrée une seule fois au retour (44 → 43)');
    ok(near(caisse(S), caisse(f.avant)) && f.A.eng.run('JSON.stringify(state)') === f.R.valeur(f.P.chemin), 'D : monnaie conservée ; appareil = serveur');
  });

  T.fin('section 319 (M4 : reconnexion relancée après une panne)');
})();
