// Test — Section 319 (lot A), constat M5 de la relecture du 2026-11-11 : écoute révoquée par le serveur, ou connexion
// anonyme ratée, jamais retentée. L'appareil devenait sourd (plus aucune mise à jour) et chacune de ses actions
// échouait, après 5 essais, avec le message faux « Conflits répétés : d'autres joueurs enregistrent en même temps ».
//
// Le faux serveur (tests/helpers/fake-firebase.js, ajouts désactivés par défaut) sait révoquer une écoute
// (R.revoquerEcoute : rappel d'annulation « permission_denied », comme PersistentConnection.onListenRevoked_), perdre
// la session anonyme d'un client (client.session = false : écoutes, lectures et transactions refusées) et refuser la
// connexion anonyme (client.authRefusee = true).
//
// Après : l'écoute annulée est reposée après une nouvelle authentification (résultat en cache oublié), par essais
// espacés et bornés (2 s, 5 s, 15 s, 30 s, puis 60 s quatre fois) ; une action tentée relance une série épuisée ;
// tant que l'appareil est sourd, une action est refusée tout de suite avec la vraie cause ; le bandeau
// #firebaseAuthWarning disparaît dès qu'une valeur est de nouveau reçue ; un échec d'authentification n'est plus gardé
// en cache pour toujours (nouvel essai après 5 s).
//
// A. Révocation simple (l'authentification marche) : l'écoute revient en 2 s, l'action suivante passe.
//    Contre-épreuve (ancien code) : appareil sourd pour toujours, 5 transactions par action, « Conflits répétés ».
// B. Session perdue et connexion anonyme refusée : message vrai, aucune transaction, essais bornés ; quand la
//    connexion anonyme redevient possible, l'essai suivant recrée la session, l'écoute revient, l'action passe.
//    Contre-épreuve : sans l'oubli du résultat en cache, la session n'est jamais recréée.
// C. Connexion anonyme ratée au chargement de la page : firebaseAuthReady() réessaie après 5 s (pas avant).
//    Contre-épreuve : échec gardé en cache pour toujours.
// D. Appareil devenu sourd PENDANT une action : le message final dit la vraie cause.
// E. Partie rechargée ou quittée pendant que l'appareil est sourd : essais arrêtés, bandeau retiré à la valeur reçue.
// F. Mode local (window.storage) : jamais « sourd ».
//
// Lancer depuis la racine du dépôt :  node tests/section319-ecoute.test.js
const { Reseau, loadEngine, partie, appareil, serveur, caisse, ecouler, micro, INVESTIR, compteur, sub } = require('./helpers/banc-319');
const T = compteur(); const { ok, scenario } = T;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ESC = s => JSON.stringify(s);

// Contre-épreuves (ancien comportement réintroduit).
const ANCIEN = sub('    firebaseListenLost = true;\n    scheduleGameListenerRetry(db, generation);\n', '');
const SANS_OUBLI = sub('    forgetFirebaseAuthResult(); // nouvelle authentification : session anonyme recréée si elle a disparu\n', '');
const ECHEC_EN_CACHE = sub('  if(firebaseAuthPromise && firebaseAuthOutcome && !firebaseAuthOutcome.ok && Date.now()-firebaseAuthOutcome.atMs >= FIREBASE_AUTH_RETRY_MIN_MS) forgetFirebaseAuthResult();\n', '');

const bandeau = app => app.doc.trouver('firebaseAuthWarning').style.display;
const sourd = app => app.eng.run('firebaseListenLost');
const ecoutes = (e) => (e.A.client.ecouteurs.get(e.P.chemin) || []).length;
const silencieux = { console: { error(){}, log(){}, warn(){} } };   // les annulations d'écoute sont journalisées par console.error

async function miseEnPlace({ transform, graine = 9, avant } = {}){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { transform, dom: true, avant, globals: silencieux });
  const B = appareil(R, P, 'Bob', P.ids[1], { transform });
  await R.pomper();
  return { P, R, A, B, avant: serveur(R, P) };
}
// Le serveur révoque l'écoute d'Alice ; le message est livré à son appareil.
async function revoquer(e){
  e.R.revoquerEcoute(e.A.client, e.P.chemin);
  for(let i = 0; i < 20 && e.A.client.entrant.length; i++){ e.R.livrerAuClient(e.A.client); await micro(); }
}
const resume = r => JSON.stringify(r && { ok: r.ok, notSaved: r.notSaved, reason: r.reason });

(async () => {
  await scenario('A. Écoute révoquée (authentification valide) : reposée en 2 s, l’action suivante passe', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const e = await miseEnPlace({ transform: variante === 'ancien' ? ANCIEN : undefined });
      const { R, A, B, P } = e;
      const depart = { bandeau: bandeau(A), ecoutes: ecoutes(e) };
      await revoquer(e);
      const juste = { sourd: sourd(A), bandeau: bandeau(A), ecoutes: ecoutes(e) };
      const tx0 = A.client.stats.transactions;
      const r0 = variante === 'corrigé' ? await A.eng.run(INVESTIR(1)) : null;   // action tentée pendant que l'appareil est sourd
      const txRefus = A.client.stats.transactions - tx0;
      await R.attendrePromesse(B.eng.run(INVESTIR(2)));   // Bob joue : Alice ne le reçoit plus
      if(variante === 'corrigé') await ecouler(R, 3000);
      else for(let k = 0; k < 100; k++){ R.temps += 3000; await R.pomper(); }   // 5 minutes
      const apres = { sourd: sourd(A), bandeau: bandeau(A), ecoutes: ecoutes(e), version: A.eng.run('state.version'), bonsBobVus: A.eng.run('state.players[1].bondBalance') || 0 };
      const tx1 = A.client.stats.transactions;
      const r1 = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
      const txAction = A.client.stats.transactions - tx1;
      if(variante === 'corrigé') await R.pomper();
      const S = serveur(R, P);
      console.log(`    [${variante}] après la révocation : sourd ${juste.sourd}, bandeau ${juste.bandeau}, écoutes ${juste.ecoutes} ; plus tard : serveur version ${S.version - (r1.ok ? 1 : 0)}, écran d'Alice version ${apres.version}, bons de Bob vus ${apres.bonsBobVus} (serveur 2), bandeau ${apres.bandeau}, écoutes ${apres.ecoutes} ; action d'Alice : ${resume(r1)}, ${txAction} transaction(s) ; bons d'Alice sur le serveur ${S.players[0].bondBalance || 0}`);
      if(variante === 'corrigé'){
        ok(depart.bandeau === 'none' && depart.ecoutes === 1, 'A : au départ, une écoute active et pas de bandeau');
        ok(juste.sourd === true && juste.bandeau === 'block' && juste.ecoutes === 0, 'A : écoute révoquée : appareil sourd, bandeau « Connexion à Firebase refusée » affiché');
        ok(r0.ok === false && r0.notSaved === true && r0.reason === 'auth' && txRefus === 0, 'A : action tentée pendant ce temps : refusée tout de suite, aucune transaction envoyée');
        ok(/Connexion à Firebase refusée/.test(r0.error) && /rechargez la page/.test(r0.error) && !/Conflits répétés/.test(r0.error), 'A : message vrai (« Connexion à Firebase refusée… rechargez la page »), pas « Conflits répétés »');
        ok(apres.sourd === false && apres.ecoutes === 1, 'A : 3 s plus tard, l’écoute est reposée (une seule)');
        ok(apres.bonsBobVus === 2 && apres.version === e.avant.version + 1, 'A : l’appareil d’Alice a reçu l’action de Bob (2 M$ de bons, version du serveur)');
        ok(apres.bandeau === 'none', 'A : le bandeau a disparu');
        ok(r1.ok === true && txAction === 1 && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'A : l’action suivante d’Alice passe du premier coup (1 transaction, 1 M$, encaisse 44 → 43)');
        ok(near(caisse(S), caisse(e.avant)) && A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'A : monnaie conservée ; l’appareil affiche la valeur du serveur');
      } else {
        ok(apres.ecoutes === 0 && apres.bonsBobVus === 0 && apres.version === e.avant.version, 'A : contre-épreuve — 5 minutes plus tard, l’appareil est toujours sourd (action de Bob jamais reçue)');
        ok(r1.ok === false && r1.reason === 'conflict' && txAction === 5 && /Conflits répétés/.test(r1.error) && !S.players[0].bondBalance, 'A : contre-épreuve — action d’Alice : 5 transactions, « Conflits répétés », rien d’enregistré');
      }
    }
  });

  await scenario('B. Session perdue et connexion anonyme refusée : message vrai, essais bornés, puis retour dès que la connexion est possible', async () => {
    const e = await miseEnPlace({ graine: 10 });
    const { R, A, P } = e;
    let connexions = 0;
    const auth = A.client.firebase.auth(), signIn = auth.signInAnonymously;
    auth.signInAnonymously = (...a) => { connexions++; return signIn(...a); };
    A.client.session = false; A.client.authRefusee = true;
    await revoquer(e);
    const t0 = R.temps;
    await ecouler(R, 10000);
    ok(sourd(A) === true && bandeau(A) === 'block' && A.eng.run('firebaseRelistenAttempt') === 3 && connexions === 2, `A.10 s : deux essais faits (à 2 s et 7 s), refusés ; le 3e est programmé ; appareil toujours sourd, bandeau affiché`.replace('A.10', 'B : 10'));
    const tx0 = A.client.stats.transactions;
    const r0 = await A.eng.run(INVESTIR(1));
    ok(r0.ok === false && r0.notSaved === true && r0.reason === 'auth' && A.client.stats.transactions === tx0, 'B : action refusée tout de suite, aucune transaction');
    ok(/Connexion à Firebase refusée/.test(r0.error) && /rechargez la page/.test(r0.error) && !/Conflits répétés/.test(r0.error), 'B : le message dit la vraie cause (connexion à Firebase refusée, recharger la page)');
    ok(/Connexion à Firebase refusée/.test(A.doc.trouver('actionStatusIndicator').innerHTML), 'B : le message est aussi affiché près des onglets (visible même si la fenêtre ne montre pas l’erreur)');
    await R.pomper();   // la série d'essais se termine d'elle-même
    const duree = R.temps - t0;
    console.log(`    série d'essais : ${A.eng.run('firebaseRelistenAttempt')} essais en ${(duree / 1000).toFixed(0)} s, ${connexions} tentative(s) de connexion anonyme ; sourd ${sourd(A)}, bandeau ${bandeau(A)}`);
    ok(A.eng.run('firebaseRelistenAttempt') === 8 && A.eng.run('firebaseRelistenPending') === false && connexions === 8, 'B : essais bornés — 8 essais (2, 5, 15, 30 s, puis 60 s quatre fois), puis plus rien');
    ok(duree >= 292000 && duree < 300000, `B : la série dure environ 5 minutes (${(duree / 1000).toFixed(0)} s)`);
    ok(sourd(A) === true && bandeau(A) === 'block' && !serveur(R, P).players[0].bondBalance, 'B : toujours sourd, bandeau affiché, rien d’enregistré');
    // Série épuisée : une action tentée (refusée) en relance une, toujours sans succès tant que la connexion est refusée.
    const r1 = await A.eng.run(INVESTIR(1));
    ok(r1.ok === false && r1.reason === 'auth' && A.eng.run('firebaseRelistenPending') === true, 'B : série épuisée : l’action tentée est refusée et relance une série d’essais');
    await R.pomper();
    ok(sourd(A) === true && A.eng.run('firebaseRelistenAttempt') === 8 && A.eng.run('firebaseRelistenPending') === false && connexions === 16, 'B : cette 2e série (8 essais) s’épuise elle aussi : la connexion anonyme est toujours refusée');
    // La connexion anonyme redevient possible ; le joueur rallume son écran (retour au premier plan) : nouvelle série ;
    // 2 s plus tard, la session est recréée, l'écoute revient.
    A.client.authRefusee = false;
    A.doc.visibilityState = 'hidden'; A.evenementDocument('visibilitychange');
    const cachee = A.eng.run('firebaseRelistenPending');
    A.doc.visibilityState = 'visible'; A.evenementDocument('visibilitychange');
    ok(cachee === false && A.eng.run('firebaseRelistenPending') === true, 'B : le retour de la page au premier plan relance une série d’essais (pas son passage en arrière-plan)');
    await ecouler(R, 3000);
    ok(A.client.session === true && connexions === 17, 'B : l’essai suivant refait la connexion anonyme (session recréée)');
    ok(sourd(A) === false && bandeau(A) === 'none' && ecoutes(e) === 1, 'B : l’écoute est revenue, le bandeau a disparu');
    const r2 = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
    await R.pomper();
    const S = serveur(R, P);
    ok(r2.ok === true && near(S.players[0].bondBalance, 1) && near(S.players[0].cash, 43), 'B : l’action passe (1 M$ investi une seule fois, encaisse 44 → 43)');
    ok(near(caisse(S), caisse(e.avant)) && A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'B : monnaie conservée ; l’appareil affiche la valeur du serveur');
    // Contre-épreuve : sans l'oubli du résultat d'authentification en cache, la session perdue n'est jamais recréée.
    for(const variante of ['corrigé', 'sans oubli']){
      const f = await miseEnPlace({ graine: 12, transform: variante === 'corrigé' ? undefined : SANS_OUBLI });
      f.A.client.session = false;   // session supprimée ; la connexion anonyme, elle, marcherait
      await revoquer(f);
      await f.R.pomper();
      console.log(`    [${variante}] session supprimée : sourd ${sourd(f.A)}, session recréée ${f.A.client.session}, bandeau ${bandeau(f.A)}`);
      if(variante === 'corrigé') ok(sourd(f.A) === false && f.A.client.session === true && bandeau(f.A) === 'none', 'B : session anonyme supprimée : recréée au 1er essai, l’écoute revient');
      else ok(sourd(f.A) === true && f.A.client.session === false && bandeau(f.A) === 'block', 'B : contre-épreuve — résultat d’authentification gardé en cache : session jamais recréée, appareil sourd après les 8 essais');
    }
  });

  await scenario('C. Connexion anonyme ratée au chargement : firebaseAuthReady() réessaie après 5 s, pas avant', async () => {
    for(const variante of ['corrigé', 'ancien']){
      let connexions = 0;
      const refuser = client => {
        client.session = false; client.authRefusee = true;
        const auth = client.firebase.auth(), signIn = auth.signInAnonymously;
        auth.signInAnonymously = (...a) => { connexions++; return signIn(...a); };
      };
      const e = await miseEnPlace({ graine: 13, avant: refuser, transform: variante === 'ancien' ? ECHEC_EN_CACHE : undefined });
      const { R, A, P } = e;
      const charge = A.eng.run('!!gameCode'), c0 = connexions;
      R.temps += 5000;                                   // plus de 5 s après l'échec du chargement
      const a1 = await A.eng.run('firebaseAuthReady()'), b1 = bandeau(A), c1 = connexions;   // nouvel essai, encore refusé : échec daté de maintenant
      A.client.authRefusee = false;                      // le réseau de l'appareil est revenu
      const a2 = await A.eng.run('firebaseAuthReady()'), c2 = connexions;
      R.temps += 4999;
      const a3 = await A.eng.run('firebaseAuthReady()'), c3 = connexions;
      R.temps += 1;
      const a4 = await A.eng.run('firebaseAuthReady()'), c4 = connexions, b4 = bandeau(A);
      const rejoint = await R.attendrePromesse(A.eng.run(`loadGame(${ESC(P.code)})`));
      console.log(`    [${variante}] au chargement : partie chargée ${charge}, authentifié ${a1}, bandeau ${b1} ; tentatives de connexion ${c0} puis ${c1} ; connexion redevenue possible : aussitôt ${a2}, à 4,999 s ${a3}, à 5 s ${a4} (tentatives ${c2}, ${c3}, ${c4}), bandeau ${b4} ; rejoindre la partie : ${rejoint}`);
      if(variante === 'corrigé'){
        ok(charge === false && c0 === 1 && a1 === false && c1 === 2 && b1 === 'block', 'C : connexion anonyme refusée au chargement : partie non chargée, bandeau affiché ; 5 s plus tard, un nouvel essai (encore refusé)');
        ok(a2 === false && a3 === false && c2 === 2 && c3 === 2, 'C : pas de nouvel essai avant 5 s (l’échec reste en cache : aucune tentative de connexion de plus)');
        ok(a4 === true && c4 === 3 && b4 === 'none', 'C : après 5 s, firebaseAuthReady() refait la connexion anonyme : réussie, bandeau retiré');
        ok(rejoint === true, 'C : la partie peut alors être rejointe sans recharger la page');
        A.eng.run('render()'); await R.pomper();
        const r = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
        await R.pomper();
        ok(r.ok === true && near(serveur(R, P).players[0].bondBalance, 1) && near(caisse(serveur(R, P)), caisse(e.avant)), 'C : et une action passe (1 M$, monnaie conservée)');
      } else {
        ok(a4 === false && c4 === 1 && b4 === 'block' && rejoint === false, 'C : contre-épreuve — échec gardé en cache pour toujours : jamais de nouvel essai, partie impossible à rejoindre sans recharger');
      }
    }
  });

  await scenario('D. Appareil devenu sourd pendant une action : le message final dit la vraie cause', async () => {
    const e = await miseEnPlace({ graine: 14 });
    const { R, A, P } = e;
    let res = null; A.eng.run(INVESTIR(1)).then(r => { res = r; });
    await micro();                                        // 1er essai parti vers le serveur
    A.client.session = false; A.client.authRefusee = true;
    await revoquer(e);                                    // l'écoute tombe avant la réponse
    await R.pomper();
    const S = serveur(R, P);
    console.log(`    annoncé : ${resume(res)} ; message : ${String(res && res.error).slice(0, 90)}…`);
    ok(res && res.ok === false && res.notSaved === true && res.reason === 'auth', 'D : l’action échoue avec la raison « auth » (et non « conflict » ou « network »)');
    ok(/Connexion à Firebase refusée/.test(res.error) && /PAS été enregistrée/.test(res.error) && /rechargez la page/.test(res.error) && !/Conflits répétés/.test(res.error), 'D : message vrai — connexion à Firebase refusée, action PAS enregistrée, recharger la page');
    ok(!S.players[0].bondBalance && near(S.players[0].cash, 44) && near(caisse(S), caisse(e.avant)), 'D : rien n’est enregistré (encaisse 44), monnaie conservée');
    ok(near(A.eng.run('state.players[0].cash'), 44) && !A.eng.run('state.players[0].bondBalance'), 'D : l’appareil revient au dernier état enregistré');
  });

  await scenario('E. Partie rechargée ou quittée pendant que l’appareil est sourd : essais arrêtés, bandeau retiré à la valeur reçue', async () => {
    const e = await miseEnPlace({ graine: 15 });
    const { R, A, P } = e;
    A.client.session = false; A.client.authRefusee = true;
    await revoquer(e);
    ok(sourd(A) === true && A.eng.run('firebaseRelistenPending') === true, 'E : appareil sourd, un essai est programmé');
    A.eng.run('stopSync()');   // ce que font « quitter la partie » et tout rechargement de partie
    const pas0 = R.stats.pas;
    await R.pomper();
    ok(sourd(A) === false && A.eng.run('firebaseRelistenPending') === false && A.eng.run('firebaseRelistenAttempt') === 0 && ecoutes(e) === 0, 'E : stopSync() arrête les essais (aucune écoute reposée pour la partie quittée)');
    ok(R.stats.pas - pas0 < 50, 'E : plus aucune minuterie d’essai en attente');
    ok(bandeau(A) === 'block', 'E : le bandeau reste tant que rien n’est revenu');
    A.client.session = true; A.client.authRefusee = false;   // la session est de retour
    const rejoint = await R.attendrePromesse(A.eng.run(`loadGame(${ESC(P.code)})`));
    await R.pomper();
    ok(rejoint === true && ecoutes(e) === 1 && bandeau(A) === 'none' && sourd(A) === false, 'E : partie rechargée : nouvelle écoute, et le bandeau disparaît à la première valeur reçue');
  });

  await scenario('F. Mode local (window.storage) : jamais « sourd »', async () => {
    const eng = loadEngine();
    await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    const m0 = eng.cashTotal();
    eng.run('firebaseListenLost = true');
    ok(eng.run('isFirebaseDeaf()') === false && eng.run('retryGameListenerNow()') === false, 'F : en mode local, l’appareil n’est jamais considéré comme sourd');
    const r = await eng.run(`attemptActionWithRetry(()=>buyBonds(state.players[0], 1))`);
    ok(r.ok === true && near(eng.run('state.players[0].bondBalance'), 1) && near(eng.cashTotal(), m0), 'F : les actions passent (1 M$), monnaie conservée');
    eng.run('firebaseListenLost = false');
    ok(JSON.stringify(eng.json('FIREBASE_RELISTEN_DELAYS_MS')) === '[2000,5000,15000,30000,60000,60000,60000,60000]' && eng.run('FIREBASE_AUTH_RETRY_MIN_MS') === 5000, 'F : réglages — essais à 2, 5, 15, 30 s puis 60 s quatre fois ; nouvel essai d’authentification après 5 s');
  });

  T.fin('section 319 (M5 : écoute révoquée, authentification retentée)');
})();
