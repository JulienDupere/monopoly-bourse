// Test — section 319, retouches de la revue des corrections (2026-11-11). Lancer : node tests/section319-retouches.test.js
// R1. Écran de création : un refus « pas de connexion » relance la reconnexion (sinon, après une longue panne, il
//     faut attendre le délai du SDK, jusqu'à 5 minutes, sans battement ni action pour le raccourcir).
// R2. Une création abandonnée ne retire du serveur QUE la valeur écrite par cet appareil : la partie qu'un autre
//     groupe a créée entre-temps sous le même code n'est jamais supprimée.
// R3. Une autre partie rejointe pendant l'attente d'une création reste ouverte ; la partie créée est retirée.
// R4. Le bouton de secours « Lancer les dés » n'apparaît pas avant 5 s, même si l'écran est redessiné entre-temps.
// R5. Connexion lente à s'ouvrir (défaut trouvé par le banc du vrai SDK) : les relances de la reconnexion s'espacent
//     (écart doublé après chacune), sinon chaque relance abandonnait la tentative en cours et rien n'aboutissait.
// R6. Partie quittée puis rejointe pendant qu'une action attend le réseau (trouvé par le banc du vrai SDK, garde de
//     l'interface contournée) : l'enregistrement tardif ne touche plus l'état rechargé ; l'action n'est pas effacée.
// Chaque scénario a sa contre-épreuve : l'ancien code (ou la garde retirée) est réintroduit par { transform }.
const { Reseau, partie, appareil, ecouler, micro, sub, INVESTIR } = require('./helpers/banc-319');

let nChecks = 0;
const ok = (c, m) => { if(!c) throw new Error('ÉCHEC : ' + m); nChecks++; console.log('  OK', m); };
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const tiragesPour = code => code.split('').map(ch => (LETTRES.indexOf(ch) + 0.5) / 24);
const CREER = noms => `createGame(${JSON.stringify(noms)}, 50, 1000, 'M$', {}, [])`;
// Appareil sans partie mémorisée, dont on peut forcer les tirages du code de partie.
function neuf(R, P, nom, transform){
  const tirages = [], M = Object.create(Math); M.random = () => (tirages.length ? tirages.shift() : Math.random());
  const a = appareil(R, P, nom, null, { sansPartie: true, dom: true, transform, globals: { Math: M } });
  a.tirages = tirages;
  return a;
}
const SANS_RELANCE = sub("if(isKnownOffline()){ nudgeFirebaseReconnect(); return {ok:false, reason:'offline'}; }", "if(isKnownOffline()) return {ok:false, reason:'offline'};");
const RETRAIT_SANS_CONDITION = sub('(cur===null || cur===undefined || cur===value) ? null : undefined', 'null');
const SANS_GARDE_AUTRE_PARTIE = sub('if(gameCode!==codeBeforeCreation){', 'if(false){');
const SECOURS_SANS_DELAI = sub('return nowMs - stuckRollWatch.sinceMs >= STUCK_ROLL_RESCUE_DELAY_MS;', 'return true;');

// R1 — panne de 20 minutes, Internet revenu depuis 5 s ; le joueur reclique « Créer » toutes les 10 s.
async function r1(transform){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 21, reconnexionProgressive: true });
  const X = neuf(R, P, 'Xavier', transform);
  await R.pomper();
  const p1 = X.eng.run(CREER(['Xavier', 'Yann'])); await micro();
  R.couper(X.client, 20 * 60 * 1000);
  await R.attendrePromesse(p1);
  await ecouler(R, 20 * 60 * 1000 + 5000);
  const t0 = R.maintenant(); let clics = 0, cree = false;
  while(!cree && R.maintenant() - t0 < 6 * 60 * 1000){
    cree = await R.attendrePromesse(X.eng.run(CREER(['Xavier', 'Yann']))); clics++;
    if(!cree) await ecouler(R, 10000);
  }
  return { clics, secondes: Math.round((R.maintenant() - t0) / 1000), cree };
}

// R2 — Xavier crée KKKK, sa transaction se perd (coupure) ; un autre groupe crée KKKK ; Xavier revient.
async function r2(transform){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 3 });
  const X = neuf(R, P, 'Xavier', transform), G = neuf(R, P, 'Autre groupe', transform);
  await R.pomper();
  X.tirages.push(...tiragesPour('KKKK'));
  const pX = X.eng.run(CREER(['Xavier', 'Yann']));
  for(let i = 0; i < 50 && !X.client.requetes.some(r => r.type === 'tx' && !r.arrive); i++) await micro();
  const entier = R.entier; R.entier = () => 0;            // la coupure tombe avant tout message : rien n'arrive au serveur
  R.couper(X.client, 60000); R.entier = entier;
  const rX = await R.attendrePromesse(pX);
  const libre = R.valeur('data/game:KKKK') === null;
  G.tirages.push(...tiragesPour('KKKK'));
  const rG = await R.attendrePromesse(G.eng.run(CREER(['Gina', 'Hugo'])));
  await R.pomper(); await R.pomper();                      // Xavier se reconnecte ; son retrait conditionnel part
  const apres = R.valeur('data/game:KKKK');
  return { rX, libre, rG, codeG: G.eng.run('gameCode'), joueurs: apres ? JSON.parse(apres).players.map(p => p.name).join(', ') : null, ouverteChezX: X.eng.run('gameCode') };
}

// R3 — « Créer » (le 1er code tiré est déjà pris : il faut un 2e aller-retour) puis « Rejoindre » la partie d'Alice :
// la lecture de la partie rejointe arrive avant la confirmation de la création.
async function r3(transform){
  for(let graine = 1; graine <= 40; graine++){
    const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
    const R = new Reseau({ graine });
    R.ecrireServeur(P.chemin, P.raw);
    const X = neuf(R, P, 'Xavier', transform);
    await R.pomper();
    X.tirages.push(...tiragesPour(P.code));
    const pCree = X.eng.run(CREER(['Xavier', 'Yann'])); await micro();
    const pRejoint = X.eng.run(`loadGame(${JSON.stringify(P.code)})`);
    for(let i = 0; i < 4000 && X.eng.run('gameCode') !== P.code && X.eng.run('createGameInFlight'); i++) await R.pas();
    if(!(X.eng.run('gameCode') === P.code && X.eng.run('createGameInFlight'))){ await R.pomper(); continue; } // ordre inverse : autre graine
    const rCree = await R.attendrePromesse(pCree); await pRejoint; await R.pomper(); await R.pomper();
    const autres = Array.from(R.serveur.keys()).filter(k => k !== P.chemin);
    return { graine, rCree, ouverte: X.eng.run('gameCode'), attendue: P.code, joueurs: X.eng.json('state.players.map(p=>p.name)').join(', '), orphelines: autres.length };
  }
  return null;
}

// R4 — toutes les entreprises prêtes, lancer pas parti : écran redessiné à 3 s, puis à 5,2 s.
async function r4(transform){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp'], s => { s.companies.forEach(c => { c.ready = true; }); });
  const R = new Reseau({ graine: 9 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { dom: true, transform });
  await R.pomper();
  const bouton = () => /data-roll-rescue/.test(A.eng.run('stuckRollRescueHtml()'));
  A.eng.run('stuckRollWatch = null; render()');
  const a0 = bouton(); await ecouler(R, 3000); A.eng.run('render()'); const a3 = bouton();
  await ecouler(R, 2200); A.eng.run('render()'); const a5 = bouton();
  return { a0, a3, a5, lancer: A.eng.run('state.gameClock.rollCount') };
}

// R5 — panne de 20 s, puis le réseau revient mais la connexion met `lent` ms à s'ouvrir.
const RELANCES_A_ECART_FIXE = sub('Math.max(minGapMs||0, firebaseReconnectNudgeGapMs)', 'Math.max(minGapMs||0, FIREBASE_RECONNECT_NUDGE_MIN_MS)');
async function r5(transform, lent, clics){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 5, reconnexionProgressive: true, ouvertureLenteMs: lent });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { dom: true, transform });
  await R.pomper();
  R.couper(A.client, 20000);
  await ecouler(R, 20000);
  const t0 = R.maintenant();
  while(!A.client.connecte && R.maintenant() - t0 < 120000){
    if(clics) A.eng.run(INVESTIR(1));                      // le joueur retente son action : refusée hors ligne
    await ecouler(R, clics ? 6000 : 1000);
  }
  const secondes = Math.round((R.maintenant() - t0) / 1000);
  let action = null;
  if(A.client.connecte){ await ecouler(R, 3000); action = await R.attendrePromesse(A.eng.run(INVESTIR(1))); }
  return { connecte: A.client.connecte, secondes, action: action && action.ok };
}

// R6 — le vrai SDK répond à la lecture de loadGame depuis son cache, avec l'état d'AVANT l'action (une transaction
// en attente y garde une écoute interne) : simulé ici en remplaçant storageGet le temps de rejoindre. Au retour du
// réseau, la valeur reçue est mise de côté (comme pendant une saisie) jusqu'après l'accusé de la transaction.
const SANS_GARDE_ENREGISTREMENT = sub('if(staleSave()){ saveFailureMaybeWritten = false; return !!(txResult && txResult.committed); }', '');
async function r6(transform){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 11 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { dom: true, transform });
  await R.pomper();
  const avant = R.valeur(P.chemin);
  R.couper(A.client, 5000);
  const p1 = A.eng.run(INVESTIR(1)); await micro();          // la transaction attend le réseau
  A.eng.sandbox.__avant = avant; A.eng.sandbox.__cle = 'game:' + P.code;
  A.eng.run('globalThis.__sg = storageGet; storageGet = async (k, sh) => (k === __cle ? __avant : __sg(k, sh));');
  await A.eng.run('performQuitGame()');
  const rejoint = await A.eng.run('loadGame(' + JSON.stringify(P.code) + ')');
  A.eng.run('storageGet = __sg; globalThis.__sd = shouldDeferRemoteState; shouldDeferRemoteState = () => true;');
  await ecouler(R, 8000); const r1 = await p1;
  A.eng.run('shouldDeferRemoteState = __sd;');
  await ecouler(R, 4000);                                    // le battement applique la valeur mise de côté
  const bons = () => JSON.parse(R.valeur(P.chemin)).players[0].bondBalance || 0;
  const serveur1 = bons(), ecran1 = A.eng.run('state.players[0].bondBalance || 0');
  const r2 = await R.attendrePromesse(A.eng.run(INVESTIR(0.5))); await R.pomper();
  return { rejoint, r1: r1 && r1.ok, serveur1, ecran1, r2: r2 && r2.ok, serveur2: bons(), egal: A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin) };
}

(async () => {
  console.log('R1. Création refusée hors ligne : la reconnexion est relancée');
  let a = await r1(), b = await r1(SANS_RELANCE);
  console.log(`    corrigé : créée au ${a.clics}e clic, ${a.secondes} s après le retour ; sans la relance : ${b.cree ? 'créée au ' + b.clics + 'e clic, ' + b.secondes + ' s' : 'pas créée en 6 minutes'}`);
  ok(a.cree && a.clics <= 3 && a.secondes <= 30, `R1 : partie créée au ${a.clics}e clic, ${a.secondes} s après le retour d’Internet`);
  ok(!b.cree || b.secondes >= 60, 'R1 : contre-épreuve — sans la relance, il faut attendre le délai du SDK (une minute ou plus)');

  console.log('R2. Création abandonnée : la partie d’un autre groupe sous le même code n’est jamais retirée');
  a = await r2(); b = await r2(RETRAIT_SANS_CONDITION);
  ok(a.rX === false && a.libre && a.ouverteChezX === null, 'R2 : la création de Xavier échoue (connexion perdue), rien d’ouvert, rien sur le serveur');
  ok(a.rG === true && a.codeG === 'KKKK', 'R2 : l’autre groupe crée sa partie sous le code KKKK');
  ok(a.joueurs === 'Gina, Hugo', 'R2 : au retour de Xavier, la partie de Gina et Hugo est intacte');
  ok(b.joueurs === null, 'R2 : contre-épreuve — retrait sans condition : la partie de l’autre groupe est supprimée');

  console.log('R3. Autre partie rejointe pendant l’attente d’une création');
  a = await r3(); b = await r3(SANS_GARDE_AUTRE_PARTIE);
  ok(a && b, 'R3 : l’ordre « lecture avant création » a été obtenu');
  console.log(`    corrigé (graine ${a.graine}) : createGame = ${a.rCree}, partie ouverte ${a.ouverte} (${a.joueurs}), autres parties sur le serveur : ${a.orphelines} ; sans la garde (graine ${b.graine}) : partie ouverte ${b.ouverte} (${b.joueurs})`);
  ok(a.rCree === false && a.ouverte === a.attendue && a.joueurs === 'Alice, Bob', 'R3 : la partie rejointe reste ouverte, la création est abandonnée');
  ok(a.orphelines === 0, 'R3 : la partie créée entre-temps est retirée du serveur');
  ok(b.ouverte !== b.attendue && b.joueurs === 'Xavier, Yann', 'R3 : contre-épreuve — sans la garde, le joueur est tiré dans la partie créée');

  console.log('R4. Bouton de secours : pas avant 5 secondes');
  a = await r4(); b = await r4(SECOURS_SANS_DELAI);
  ok(a.a0 === false && a.a3 === false, 'R4 : pas de bouton au 1er rendu ni au rendu à 3 s');
  ok(a.a5 === true && a.lancer === 0, 'R4 : bouton présent à 5,2 s, sans qu’aucun lancer soit parti');
  ok(b.a3 === true, 'R4 : contre-épreuve — sans le délai, le bouton apparaît dès le rendu à 3 s');

  console.log('R5. Connexion lente à s’ouvrir : les relances ne l’empêchent plus d’aboutir');
  for(const [lent, clics, nom] of [[16000, false, 'ouverture de 16 s, sans rien faire'], [8000, true, 'ouverture de 8 s, action retentée toutes les 6 s'], [20000, true, 'ouverture de 20 s, action retentée toutes les 6 s']]){
    a = await r5(undefined, lent, clics); b = await r5(RELANCES_A_ECART_FIXE, lent, clics);
    console.log(`    ${nom} : corrigé = ${a.connecte ? 'connecté après ' + a.secondes + ' s' : 'jamais en 120 s'} ; écart fixe = ${b.connecte ? 'connecté après ' + b.secondes + ' s' : 'jamais en 120 s'}`);
    ok(a.connecte && a.secondes <= 100 && a.action === true, `R5 : ${nom} — connecté après ${a.secondes} s, l’action suivante est enregistrée`);
    ok(!b.connecte, `R5 : contre-épreuve (${nom}) — à écart fixe, la connexion n’aboutit jamais en 120 s`);
  }

  console.log('R6. Partie quittée puis rejointe pendant qu’une action attend le réseau');
  a = await r6(); b = await r6(SANS_GARDE_ENREGISTREMENT);
  console.log(`    corrigé : action 1 sur le serveur ${a.serveur1}, à l’écran ${a.ecran1} ; après l’action 2 : ${a.serveur2} ; sans la garde : à l’écran ${b.ecran1}, après l’action 2 : ${b.serveur2}`);
  ok(a.rejoint === true && a.serveur1 === 1 && a.ecran1 === 1, 'R6 : l’action 1 (1 M$) est sur le serveur et l’écran rechargé la montre');
  ok(a.r2 === true && Math.abs(a.serveur2 - 1.5) < 1e-9 && a.egal, 'R6 : après l’action 2 (0,5 M$), les deux sont sur le serveur (1,5 M$) et l’appareil = le serveur');
  ok(b.ecran1 === 0 && Math.abs(b.serveur2 - 0.5) < 1e-9, 'R6 : contre-épreuve — sans la garde, l’action 2 efface l’action 1 du serveur (0,5 M$ au lieu de 1,5)');

  console.log(`${nChecks} vérifications OK`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
