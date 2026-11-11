// Test — Section 319 (relecture de la synchronisation du 2026-11-11), constat S3 : createGame écrivait la nouvelle
// partie par un set() sans vérifier que le code tiré au hasard (4 lettres parmi 24 = 331 776 codes) était libre, et
// sans lire le retour de l'écriture.
//   - une partie existante de même code était remplacée sur le serveur, sans message sur aucun appareil ;
//   - une création dont l'écriture échouait ouvrait quand même une partie, absente du serveur ;
//   - hors ligne, le clic « Créer la partie » attendait sans fin et sans message.
// Mécanique retenue : écriture « seulement si la place est libre » (transaction Firebase ; lire puis écrire en mode
// local), autre code si la place est prise (20 tirages au plus, sans rien dire), rien d'adopté sur l'appareil avant la
// confirmation du serveur, refus immédiat si la coupure est connue, attente bornée à 15 s sinon, et retrait de la
// partie orpheline si une écriture abandonnée finit par arriver.
//
// Banc : mode local = moteurs du banc partageant un même window.storage ; Firebase = faux serveur et faux SDK de
// tests/helpers/fake-firebase.js (la 1re passe d'une transaction y voit null, cache local vide, et c'est la
// vérification du serveur — « périmée » — qui la fait rejouer sur la vraie valeur), mini-DOM de fake-dom.js pour
// cliquer le vrai bouton « Créer la partie » de l'écran de création, temps virtuel.
// Chaque scénario est rejoué avec l'ancien code réintroduit (option transform) : le défaut doit alors réapparaître.
//
// Lancer depuis la racine du dépôt :  node tests/section319-creation.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { Reseau } = require('./helpers/fake-firebase');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 2) + ' — ' + m); }
}

// Ancien code : set() sans vérification, retour non lu, partie ouverte dans tous les cas.
const ANCIEN = src => src.replace(`const reserved = await reserveNewGame(s);`,
  `await storageSet('game:'+code, JSON.stringify(s), true); const reserved = {ok:true, code, raw: JSON.stringify(s)};`);

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const tiragesPour = code => code.split('').map(ch => (LETTRES.indexOf(ch) + 0.5) / 24);
const caisse = s => (s.bank.cash || 0) + s.companies.reduce((a, c) => a + (c.cash || 0), 0) + s.players.reduce((a, p) => a + (p.cash || 0), 0);
const partiesServeur = R => [...R.serveur.keys()].filter(k => k.startsWith('data/game:'));
const CREER = `createGame(['Xavier','Yann','Zoe'], 50, 1000, 'M$', {}, [])`;

function fausseDate(maintenant){
  return class DateVirtuelle extends Date {
    constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); }
    static now(){ return maintenant(); }
  };
}
// Math dont les premiers tirages sont imposés (file), les suivants au hasard.
function mathAvecTirages(file){ const M = Object.create(Math); M.random = () => (file.length ? file.shift() : Math.random()); return M; }

// Partie existante d'Alice et Bob (deux entreprises financées), fabriquée en mode local puis posée sur un serveur.
async function partieExistante(){
  const eng = loadEngine();
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  return { code, ids, raw: eng.mem.get('game:' + code), chemin: 'data/game:' + code };
}
// Un appareil relié au faux serveur. Sans partie mémorisée : il démarre sur l'écran de création.
function appareil(R, nom, { partie, joueurId, transform, stockageRefuse } = {}){
  const client = R.creerClient(nom);
  const doc = creerDocument();
  const ls = new Map(partie ? [['mb:lastcode', partie.code], ['mb:mychar:' + partie.code, joueurId]] : []);
  const alertes = [], tirages = [];
  const eng = loadEngine({ firebase: client.firebase, transform, globals: {
    document: doc,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { if(stockageRefuse) throw new Error('QuotaExceededError'); ls.set(k, String(v)); },
      removeItem: k => { ls.delete(k); } },
    Math: mathAvecTirages(tirages), Date: fausseDate(() => R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alertes.push(String(m)), confirm: () => true,
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc-319.invalid' },
  } });
  return { nom, client, doc, eng, ls, alertes, tirages };
}
// Le joueur remplit l'écran de création (trois noms, encaisse de départ 77) puis clique « Créer la partie ».
function remplirEcran(D){
  D.eng.run(`setupPlayers = ['Xavier','Yann','Zoe']; renderPlayerLines();`);
  D.doc.trouver('startCash').value = '77';
}
function cliquerCreer(D){
  const r = D.doc.cliquer('createBtn');
  if(r.clic !== 'ok') throw new Error('clic sur « Créer la partie » : ' + r.clic);
  return r.promesse;
}
const ecranDeCreationIntact = D => !!D.doc.trouver('createBtn') && D.doc.trouver('startCash') && D.doc.trouver('startCash').value === '77'
  && D.eng.json('setupPlayers').join(',') === 'Xavier,Yann,Zoe' && !D.doc.trouver('createBtn').disabled;
const aucunePartieSurLAppareil = D => D.eng.run('gameCode') === null && D.eng.run('state') === null && D.eng.run('myPlayerId') === null
  && ![...D.ls.keys()].some(k => k === 'mb:lastcode' || k.startsWith('mb:mychar:'))
  && ![...D.client.ecouteurs.keys()].some(k => k.startsWith('data/game:'));

(async () => {
  // =====================================================================================================
  await scenario('A. Mode local (window.storage) — collision forcée : les 4 tirages donnent le code d’une partie existante', async () => {
    // Un window.storage par appareil : les parties (clés partagées) vont au « serveur » commun, le reste (identité,
    // dernier code) reste sur l'appareil.
    const stockage = (serveur) => { const local = new Map(); const st = { lectures: 0, local,
      get: async (k, partage) => { if(partage) st.lectures++; const m = partage ? serveur : local; return m.has(k) ? { value: m.get(k) } : null; },
      set: async (k, v, partage) => { (partage ? serveur : local).set(k, v); return true; },
      delete: async (k, partage) => { (partage ? serveur : local).delete(k); return true; } }; return st; };
    for(const variante of ['corrigé', 'ancien']){
      const mem = new Map();
      const un = loadEngine({ globals: { storage: stockage(mem) } });
      await un.newGame(['Alice', 'Bob'], ['garp', 'garp']);
      await un.run('saveGame({silent:true})');
      const code1 = un.run('gameCode'), raw1 = mem.get('game:' + code1), total1 = caisse(JSON.parse(raw1));
      const tirages = [], alertes = [], storage = stockage(mem);
      const deux = loadEngine(Object.assign({ globals: { storage, Math: mathAvecTirages(tirages), alert: m => alertes.push(String(m)) } }, variante === 'ancien' ? { transform: ANCIEN } : {}));
      tirages.push(...tiragesPour(code1));                                  // imposés APRÈS le chargement (le moteur tire au hasard en se chargeant)
      const retour = await deux.run(CREER);
      const code2 = deux.run('gameCode'), apres1 = JSON.parse(mem.get('game:' + code1));
      console.log(`    [${variante}] places regardées : ${storage.lectures} | partie ${code1} (Alice, Bob ; version ${JSON.parse(raw1).version} ; caisse ${total1}) — nouvelle partie : code ${code2} — partie ${code1} après : ${apres1.players.map(p => p.name).join(', ')} ; version ${apres1.version}`);
      if(variante === 'corrigé'){
        ok(mem.get('game:' + code1) === raw1, `A : la partie ${code1} d’Alice et Bob est intacte, octet pour octet (caisse ${total1} inchangée)`);
        ok(code2 !== code1 && /^[A-HJ-NP-Z]{4}$/.test(code2), `A : la nouvelle partie a un autre code (${code2})`);
        const neuve = JSON.parse(mem.get('game:' + code2));
        ok(neuve.players.map(p => p.name).join(',') === 'Xavier,Yann,Zoe' && neuve.code === code2 && deux.run('state.code') === code2, 'A : la nouvelle partie est enregistrée sous son propre code, et son champ code le porte');
        ok(mem.get('game:' + code2) === deux.run('lastSerialized') && near(caisse(neuve), 3 * 50 + 1000), 'A : la valeur enregistrée est celle de l’appareil (caisse 3 × 50 + 1 000 = 1 150)');
        ok(retour === true && alertes.length === 0 && storage.lectures === 2, 'A : création réussie au 2e tirage (2 places regardées), sans aucun message au joueur');
        ok(storage.local.get('mychar:' + code2) === deux.run('state.creatorId') && storage.local.get('lastcode') === code2 && !storage.local.has('mychar:' + code1), 'A : identité du créateur et dernier code mémorisés pour le NOUVEAU code');
      } else {
        ok(code2 === code1 && apres1.players[0].name === 'Xavier', 'A : contre-épreuve — avec l’ancien code, la partie d’Alice et Bob est remplacée par celle de Xavier, sans message');
      }
    }
    // Borne : toutes les places essayées sont prises.
    const mem = new Map([['game:NNNN', 'occupée']]);
    const storage = stockage(mem);
    const M = Object.create(Math); M.random = () => 0.5;                    // tous les tirages donnent « NNNN »
    const alertes = [];
    const eng = loadEngine({ globals: { storage, Math: M, alert: m => alertes.push(String(m)) } });
    const retour = await eng.run(CREER);
    console.log(`    borne : ${storage.lectures} places essayées, alerte : ${JSON.stringify(alertes[0] || null)}`);
    ok(retour === false && storage.lectures === 20, 'A : 20 tirages au plus, puis la création s’arrête');
    ok(alertes.length === 1 && /Aucun code de partie libre/.test(alertes[0]), 'A : le joueur est prévenu qu’aucun code libre n’a été trouvé');
    ok(mem.size === 1 && mem.get('game:NNNN') === 'occupée' && storage.local.size === 0 && eng.run('gameCode') === null && eng.run('state') === null, 'A : rien n’est écrit et aucune partie n’est ouverte');
  });

  // =====================================================================================================
  await scenario('B. Firebase — collision forcée : la transaction part sur un cache vide, le serveur la fait rejouer', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const P = await partieExistante();
      const R = new Reseau({ graine: 3 });
      R.ecrireServeur(P.chemin, P.raw);
      const A = appareil(R, 'Alice', { partie: P, joueurId: P.ids[0] });
      await R.pomper();
      await R.attendrePromesse(A.eng.run(`attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); return buyBonds(pl, 1); })`));
      await R.pomper();
      const rawAvant = R.valeur(P.chemin), avant = JSON.parse(rawAvant);
      const D = appareil(R, 'Autre groupe', variante === 'ancien' ? { transform: ANCIEN } : {});
      await R.pomper();
      remplirEcran(D);
      D.tirages.push(...tiragesPour(P.code));
      await R.attendrePromesse(cliquerCreer(D));
      await R.pomper();
      const code2 = D.eng.run('gameCode'), apres = JSON.parse(R.valeur(P.chemin));
      console.log(`    [${variante}] partie ${P.code} avant : ${avant.players.map(p => p.name).join(', ')} ; version ${avant.version} ; ${avant.companies.length} entreprises — nouvelle partie : ${code2} — partie ${P.code} après : ${apres.players.map(p => p.name).join(', ')} ; version ${apres.version} ; ${apres.companies.length} entreprises | transactions de l’autre groupe : ${D.client.stats.transactions}, périmées : ${D.client.stats.perimes}, abandons sur cache local : ${D.client.stats.abandonsLocaux}, écrites : ${D.client.stats.ecritures}`);
      if(variante === 'corrigé'){
        ok(R.valeur(P.chemin) === rawAvant, `B : la partie ${P.code} est intacte sur le serveur (Alice, Bob ; version ${avant.version} ; 2 entreprises ; caisse ${caisse(avant)})`);
        ok(code2 !== P.code && R.valeur('data/game:' + code2) === D.eng.run('lastSerialized'), `B : la nouvelle partie est enregistrée sous un autre code (${code2})`);
        ok(D.client.stats.transactions === 2 && D.client.stats.perimes === 1 && D.client.stats.abandonsLocaux === 0 && D.client.stats.ecritures === 1,
          'B : 1re transaction partie sur un cache vide (null), périmée par le serveur, rejouée sur la vraie valeur puis abandonnée ; 2e transaction écrite sous le nouveau code');
        ok(D.alertes.length === 0 && A.alertes.length === 0, 'B : aucun message, ni pour le créateur ni pour Alice');
        ok(D.ls.get('mb:lastcode') === code2 && D.ls.get('mb:mychar:' + code2) === D.eng.run('state.creatorId') && D.client.ecouteurs.has('data/game:' + code2) && !D.client.ecouteurs.has(P.chemin),
          'B : l’appareil du créateur mémorise et écoute le NOUVEAU code seulement');
        ok(D.eng.run('state.players[0].cash') === 77 && D.eng.json('state.players.map(p=>p.name)').join(',') === 'Xavier,Yann,Zoe', 'B : la partie créée est celle saisie à l’écran (3 joueurs, encaisse de départ 77)');
        // La partie d'Alice continue normalement.
        await R.attendrePromesse(A.eng.run(`attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); return buyBonds(pl, 1); })`));
        await R.pomper();
        const suite = JSON.parse(R.valeur(P.chemin));
        ok(suite.version === avant.version + 1 && suite.players.map(p => p.name).join(',') === 'Alice,Bob' && A.alertes.length === 0, `B : l’action suivante d’Alice s’enregistre dans SA partie (version ${avant.version} → ${suite.version})`);
      } else {
        ok(code2 === P.code && apres.players[0].name === 'Xavier' && apres.companies.length === 0 && A.alertes.length === 0 && D.alertes.length === 0,
          'B : contre-épreuve — avec l’ancien code, la partie d’Alice et Bob est détruite sur le serveur, sans message sur aucun appareil');
      }
    }
  });

  // =====================================================================================================
  await scenario('C. Firebase — écriture refusée par le serveur : aucune partie ouverte, message, écran de création intact', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const R = new Reseau({ graine: 5 });
      const D = appareil(R, 'Xavier', variante === 'ancien' ? { transform: ANCIEN } : {});
      await R.pomper();
      remplirEcran(D);
      if(variante === 'corrigé') R.echouerTransactions(D.client, 1);       // le serveur refuse (permission_denied), rien n'est écrit
      else {                                                               // l'ancien code écrit par set() : même refus
        const db = D.client.firebase.database(), ref0 = db.ref;
        db.ref = p => { const r = ref0(p); if(String(p).startsWith('data/game:')) r.set = () => Promise.reject(new Error('permission_denied')); return r; };
      }
      await R.attendrePromesse(cliquerCreer(D));
      await R.pomper();
      console.log(`    [${variante}] parties sur le serveur : ${partiesServeur(R).length} | sur l’appareil : gameCode ${JSON.stringify(D.eng.run('gameCode'))}, partie affichée : ${D.eng.run('!!state')}, mémorisé : ${JSON.stringify([...D.ls.keys()])} | alertes : ${JSON.stringify(D.alertes)}`);
      if(variante === 'corrigé'){
        ok(partiesServeur(R).length === 0 && R.stats.refus === 1, 'C : le serveur a refusé l’écriture, aucune partie n’y existe');
        ok(aucunePartieSurLAppareil(D), 'C : aucune partie fantôme sur l’appareil (gameCode, state, identité, « lastcode », écoute)');
        ok(D.alertes.length === 1 && /la partie n’a pas été créée/.test(D.alertes[0]) && /refusé/.test(D.alertes[0]), 'C : un message clair dit que la partie n’a pas été créée');
        ok(ecranDeCreationIntact(D), 'C : le joueur reste sur l’écran de création avec sa saisie (3 noms, encaisse 77), bouton de nouveau actif');
        // Il réessaie : cette fois le serveur accepte.
        await R.attendrePromesse(cliquerCreer(D));
        await R.pomper();
        const code = D.eng.run('gameCode');
        ok(partiesServeur(R).length === 1 && R.valeur('data/game:' + code) === D.eng.run('lastSerialized') && D.alertes.length === 1, `C : nouvel essai réussi (partie ${code} ouverte et enregistrée, sans autre message)`);
      } else {
        ok(partiesServeur(R).length === 0 && D.eng.run('gameCode') !== null && D.eng.run('!!state') && D.ls.has('mb:lastcode') && D.alertes.length === 0,
          'C : contre-épreuve — avec l’ancien code, l’appareil ouvre et mémorise une partie qui n’existe pas sur le serveur, sans message');
      }
    }
  });

  // =====================================================================================================
  await scenario('D. Firebase — appareil hors ligne au moment de créer : attente bornée, puis refus immédiat ; écriture tardive retirée', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const R = new Reseau({ graine: 7 });
      const D = appareil(R, 'Xavier', variante === 'ancien' ? { transform: ANCIEN } : {});
      await R.pomper();
      remplirEcran(D);
      R.couper(D.client, 60000);                                           // coupure d'une minute, pas encore connue de l'application
      const t0 = R.maintenant();
      await R.attendrePromesse(cliquerCreer(D));
      const attente = R.maintenant() - t0;
      console.log(`    [${variante}] 1er clic hors ligne : réponse après ${(attente / 1000).toFixed(1)} s | alertes : ${JSON.stringify(D.alertes)} | gameCode ${JSON.stringify(D.eng.run('gameCode'))} | parties sur le serveur : ${partiesServeur(R).length}`);
      if(variante === 'ancien'){
        ok(attente >= 60000 && D.alertes.length === 0 && D.eng.run('gameCode') !== null, 'D : contre-épreuve — avec l’ancien code, le clic attend toute la coupure (60 s) sans aucun message');
        continue;
      }
      ok(attente >= 15000 && attente < 16000, `D : coupure pas encore connue — attente bornée à 15 s (${(attente / 1000).toFixed(1)} s)`);
      ok(D.alertes.length === 1 && /n’a pas répondu en 15 secondes/.test(D.alertes[0]) && /la partie n’a pas été créée/.test(D.alertes[0]), 'D : message clair après l’attente');
      ok(aucunePartieSurLAppareil(D) && ecranDeCreationIntact(D) && partiesServeur(R).length === 0, 'D : aucune partie ouverte, écran de création intact, rien sur le serveur');
      // 2e clic : la coupure est maintenant connue (« .info/connected » faux depuis plus de 2 s).
      const txAvant = D.client.stats.transactions, t1 = R.maintenant();
      await R.attendrePromesse(cliquerCreer(D));
      const attente2 = R.maintenant() - t1;
      console.log(`    [corrigé] 2e clic, coupure connue : réponse après ${attente2} ms | alerte : ${JSON.stringify(D.alertes[1])}`);
      ok(attente2 < 1000 && D.client.stats.transactions === txAvant, 'D : coupure connue — refus immédiat, rien n’est envoyé');
      ok(D.alertes.length === 2 && /Pas de connexion au serveur/.test(D.alertes[1]) && aucunePartieSurLAppareil(D) && ecranDeCreationIntact(D), 'D : message « pas de connexion », écran de création intact');
      // La connexion revient : l'écriture abandonnée du 1er clic part, est écrite… puis retirée par l'appareil.
      const ecrituresAvant = R.stats.ecritures;
      await R.pomper();
      console.log(`    [corrigé] après la reconnexion : ${R.stats.ecritures - ecrituresAvant} écritures (création tardive, puis retrait) | parties sur le serveur : ${partiesServeur(R).length} | alertes : ${D.alertes.length}`);
      ok(R.stats.ecritures - ecrituresAvant === 2 && partiesServeur(R).length === 0, 'D : l’écriture abandonnée finit par arriver au retour de la connexion, et la partie orpheline est aussitôt retirée');
      ok(aucunePartieSurLAppareil(D) && D.alertes.length === 2 && ecranDeCreationIntact(D), 'D : l’appareil n’ouvre pas cette partie tardive et n’affiche rien de plus');
      // En ligne de nouveau : la création fonctionne.
      await R.attendrePromesse(cliquerCreer(D));
      await R.pomper();
      const code = D.eng.run('gameCode');
      ok(code !== null && partiesServeur(R).length === 1 && R.valeur('data/game:' + code) === D.eng.run('lastSerialized') && D.alertes.length === 2, `D : connexion revenue — la création réussit (partie ${code})`);
    }
  });

  // =====================================================================================================
  await scenario('E. Firebase — accusé de réception perdu : la partie est écrite mais la réponse se perd', async () => {
    const R = new Reseau({ graine: 9 });
    const D = appareil(R, 'Xavier');
    await R.pomper();
    remplirEcran(D);
    R.couperApresProchaineEcriture(D.client, 5000);
    await R.attendrePromesse(cliquerCreer(D));
    console.log(`    juste après : parties sur le serveur : ${partiesServeur(R).length} (écrite, accusé perdu) | gameCode ${JSON.stringify(D.eng.run('gameCode'))} | alertes : ${JSON.stringify(D.alertes)}`);
    ok(partiesServeur(R).length === 1, 'E : la partie a bien été écrite sur le serveur, mais l’appareil ne peut pas le savoir');
    ok(D.alertes.length === 1 && /perdue pendant la création/.test(D.alertes[0]) && aucunePartieSurLAppareil(D) && ecranDeCreationIntact(D), 'E : la partie n’est pas ouverte, message clair, écran de création intact');
    await R.pomper();
    console.log(`    après la reconnexion : parties sur le serveur : ${partiesServeur(R).length}`);
    ok(partiesServeur(R).length === 0 && aucunePartieSurLAppareil(D) && D.alertes.length === 1, 'E : au retour de la connexion, la partie orpheline est retirée du serveur');
  });

  // =====================================================================================================
  await scenario('F. Création normale inchangée ; double clic ; stockage du navigateur refusé', async () => {
    // Mode local : le code est celui des 4 premiers tirages quand la place est libre.
    const tirages = [];
    const eng = loadEngine({ globals: { Math: mathAvecTirages(tirages) } });
    tirages.push(...tiragesPour('QJKZ'));
    const retour = await eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
    const s = JSON.parse(eng.mem.get('game:QJKZ'));
    ok(retour === true && eng.run('gameCode') === 'QJKZ' && s.code === 'QJKZ' && s.version === 0 && eng.mem.get('game:QJKZ') === eng.run('lastSerialized'), 'F : mode local, place libre — partie QJKZ créée au premier tirage, version 0');
    ok(near(caisse(s), 2 * 50 + 1000) && s.history.length === 1 && s.history[0].roll === 0 && eng.run('myPlayerId') === s.creatorId && eng.mem.get('lastcode') === 'QJKZ', 'F : caisse 2 × 50 + 1 000 = 1 100, premier point d’historique, créateur identifié, code mémorisé');
    const refus = await eng.run(`createGame(['Alice','alice '], 50, 1000, 'M$', {}, [])`);
    ok(refus === false && eng.run('gameCode') === 'QJKZ' && eng.mem.size === 3, 'F : saisie refusée (deux joueurs du même nom) — rien n’est écrit, la partie ouverte reste QJKZ');
    // Firebase, place libre : une seule transaction, écrite du premier coup.
    const R = new Reseau({ graine: 13 });
    const D = appareil(R, 'Xavier');
    await R.pomper();
    remplirEcran(D);
    const p1 = cliquerCreer(D);
    const occupe = D.doc.trouver('createBtn') && D.doc.trouver('createBtn').disabled === true;
    const p2 = D.eng.run(CREER);                                             // 2e demande pendant la première
    const [, r2] = [await R.attendrePromesse(p1), await R.attendrePromesse(p2)];
    await R.pomper();
    const code = D.eng.run('gameCode');
    console.log(`    Firebase, place libre : partie ${code} | transactions : ${D.client.stats.transactions}, périmées : ${D.client.stats.perimes}, écrites : ${D.client.stats.ecritures} | parties sur le serveur : ${partiesServeur(R).length}`);
    ok(D.client.stats.transactions === 1 && D.client.stats.perimes === 0 && D.client.stats.ecritures === 1 && partiesServeur(R).length === 1, 'F : Firebase, place libre — une seule transaction, écrite du premier coup');
    ok(occupe && r2 === false, 'F : pendant la création le bouton est désactivé, et une 2e demande est ignorée (une seule partie créée)');
    ok(R.valeur('data/game:' + code) === D.eng.run('lastSerialized') && D.client.ecouteurs.has('data/game:' + code) && D.ls.get('mb:lastcode') === code && D.alertes.length === 0, 'F : partie ouverte, écoutée et mémorisée, sans message');
    await R.attendrePromesse(D.eng.run(`attemptActionWithRetry(()=>{ log('essai'); return {ok:true}; })`));
    await R.pomper();
    ok(JSON.parse(R.valeur('data/game:' + code)).version === 1 && D.alertes.length === 0, 'F : la première action s’enregistre par-dessus la partie créée (version 0 → 1)');
    // Stockage du navigateur refusé : la partie existe et reste ouverte, le joueur est prévenu.
    const R2 = new Reseau({ graine: 17 });
    const E = appareil(R2, 'Yann', { stockageRefuse: true });
    await R2.pomper();
    remplirEcran(E);
    await R2.attendrePromesse(cliquerCreer(E));
    await R2.pomper();
    const codeE = E.eng.run('gameCode');
    console.log(`    stockage refusé : partie ${codeE} | alertes : ${JSON.stringify(E.alertes)}`);
    ok(codeE !== null && R2.valeur('data/game:' + codeE) === E.eng.run('lastSerialized') && E.eng.run('myPlayerId') === E.eng.run('state.creatorId'), 'F : stockage du navigateur refusé — la partie est créée et ouverte quand même');
    ok(E.alertes.length === 1 && E.alertes[0].includes(codeE) && /n’a pas pu la mémoriser/.test(E.alertes[0]), 'F : le joueur est prévenu de noter le code');
    // Ni mode local ni Firebase (SDK non chargé) : avant, une partie fantôme s'ouvrait ; désormais refus avec message.
    const alertesG = [];
    const G = loadEngine({ globals: { storage: undefined, alert: m => alertesG.push(String(m)) } });
    const retourG = await G.run(CREER);
    console.log(`    sans serveur : retour ${retourG} | gameCode ${JSON.stringify(G.run('gameCode'))} | alertes : ${JSON.stringify(alertesG)}`);
    ok(retourG === false && G.run('gameCode') === null && G.run('state') === null && alertesG.length === 1 && /Aucun serveur de parties/.test(alertesG[0]), 'F : aucun serveur joignable — création refusée avec un message, aucune partie ouverte');
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
