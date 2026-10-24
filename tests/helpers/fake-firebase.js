// Section 308 — faux serveur Firebase Realtime Database partagé par plusieurs appareils simulés, un faux SDK
// « compat 10.14.1 » par appareil, et un ordonnanceur déterministe à graine qui décide de l'ordre et du moment de
// chaque livraison réseau. Sert au banc multi-appareils (tests/section308-sync.test.js).
//
//   const { Reseau } = require('./helpers/fake-firebase');
//   const R = new Reseau({ graine: 42 });
//   const client = R.creerClient('Alice');                 // un appareil = un client = un faux SDK
//   const eng = loadEngine({ firebase: client.firebase, globals: { setTimeout: client.setTimeout, … } });
//   const p = eng.run(`saveGame({silent:true})`);          // la transaction part dans le réseau simulé…
//   await R.attendrePromesse(p);                           // … et l'ordonnanceur livre les messages jusqu'au résultat
//   await R.pomper();                                      // livre tout ce qui reste, jusqu'au calme
//   R.valeur('data/game:ABCD');                            // valeur faisant foi sur le serveur
//
// Ce que le faux SDK reproduit du vrai (ce qu'utilise index.html : firebaseDb, firebaseAuthReady, storageGet/Set/
// Delete, saveGame, startPolling/stopSync) :
//  - firebase.apps / initializeApp / database() / auth() ; auth anonyme minimale (currentUser déjà présent,
//    onAuthStateChanged, signInAnonymously).
//  - ref(chemin).on('value', cb) : demande d'écoute envoyée au serveur, qui répond par la valeur courante, puis
//    pousse chaque nouvelle valeur. Le cache local d'un chemin n'existe que tant qu'un écouteur y est posé ET a reçu
//    sa première valeur. off() retire l'écouteur ; sans écouteur, le cache est oublié.
//  - ref.once('value') : comme le vrai SDK (once = écoute ponctuelle), répond depuis le CACHE du client quand un
//    écouteur est actif sur le chemin et a déjà reçu sa valeur (cache rempli) — même pendant une coupure, et même si
//    ce cache ne contient pas encore une écriture faite sur le serveur (accusé perdu) ; sinon lit la valeur du
//    serveur (aller-retour, en attente pendant une coupure). [Section 308 — retouche de la revue : fidélité.]
//  - ref('.info/connected') : chemin local, jamais envoyé au serveur ; on('value') et once('value') donnent l'état de
//    la connexion du client (vrai au départ, faux pendant une coupure, de nouveau vrai à la reconnexion), et chaque
//    changement est notifié aux écouteurs (de façon asynchrone). [Section 308 — retouche de la revue : fidélité.]
//  - ref.transaction(fn, onComplete, applyLocally) :
//      1re passe de fn sur le cache LOCAL (null tant que l'écouteur n'a rien reçu) ; fn renvoie undefined → abandon
//      immédiat, résolu avec {committed:false, snapshot} de l'instantané local ; sinon la valeur part au serveur avec
//      sa base ; le serveur écrit si sa valeur est encore la base, sinon répond « datastale » avec sa valeur et le
//      client relance fn dessus (au plus 25 envois, puis erreur « maxretry ») ; succès → l'auteur reçoit l'accusé et
//      les autres clients abonnés reçoivent la nouvelle valeur ; chaque écouteur est appelé de façon asynchrone,
//      dans l'ordre d'arrivée des messages de SON client (FIFO par client et par sens).
//      applyLocally (vrai par défaut, comme le vrai SDK) : la valeur proposée est montrée tout de suite aux écouteurs
//      locaux (événement « optimiste », synchrone pendant l'appel), puis retirée si la transaction échoue ou est
//      abandonnée. applyLocally=false : les écouteurs ne voient que des valeurs confirmées par le serveur.
//  - ref.set / ref.remove : écriture inconditionnelle, accusé, valeur poussée aux autres abonnés.
//  - Coupure réseau (couper) : les messages encore en route vers le serveur y arrivent ou sont perdus (un préfixe
//    tiré au sort arrive), les messages en route vers le client sont perdus (accusés de réception compris). Comme le
//    vrai SDK (PersistentConnection.cancelSentTransactions_ : « we don't know if our sent transactions succeeded or
//    not »), toute transaction DÉJÀ ENVOYÉE est alors rejetée avec l'erreur « disconnect » — que le serveur l'ait
//    écrite ou non. Les transactions lancées pendant la coupure attendent la reconnexion. À la reconnexion, le
//    client renvoie d'abord ses écoutes (le serveur répond par la valeur courante), puis ses lectures et écritures
//    simples (set) sans réponse, à l'identique.
//  - Accusé perdu (couperApresProchaineEcriture) : coupure déclenchée juste après l'écriture de la prochaine
//    transaction du client.
//  - Échec de transaction (echouerTransactions) : le serveur refuse les n prochaines transactions du client sans
//    rien écrire (erreur « permission_denied », comme un jeton d'authentification expiré) → la promesse est rejetée.
//  - Fermeture de page (fermer) : comme une coupure, mais le client ne revient jamais ; ses promesses en attente ne
//    se résolvent jamais (la page n'existe plus). Un rechargement = fermer + nouveau client + nouveau moteur.
// Limites connues (voir aussi le brouillon de documentation de la section 308) : pas de file de transactions
// chaînées sur un même chemin (deux transactions simultanées d'un même client partent chacune avec sa propre base),
// pas de hachage (comparaison exacte des chaînes, équivalente pour des valeurs JSON sérialisées), pas de requêtes
// (orderBy…), pas de persistance hors ligne, pas de règles de sécurité.
//
// Ordonnanceur : à chaque pas, un candidat est tiré au sort parmi : la tête de la file sortante de chaque client
// connecté (livraison au serveur), la tête de sa file entrante (livraison au client), les minuteries échues
// (setTimeout/setInterval des moteurs, en temps virtuel), et les candidats fournis par l'appelant (ex. « l'appareil X
// commence sa prochaine action »). Après chaque pas, les microtâches des moteurs sont vidées (setImmediate). Le temps
// virtuel avance d'un nombre aléatoire de millisecondes par pas ; R.maintenant() le donne (pour Date.now des moteurs).
// Tout est tiré d'un seul générateur mulberry32(graine) : même graine → même déroulé.

function mulberry32(graine){
  let a = graine >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = v => (v === undefined ? null : v);
const instantane = v => ({ exists: () => v !== null && v !== undefined, val: () => norm(v), key: null });
const microtaches = () => new Promise(r => setImmediate(r));

class Reseau {
  constructor({ graine = 1, pasMinMs = 5, pasMaxMs = 120, maxEssaisTransaction = 25, journalMax = 400 } = {}){
    this.alea = mulberry32(graine);
    this.graine = graine;
    this.serveur = new Map();            // chemin -> valeur (chaîne JSON pour les parties)
    this.abonnes = new Map();            // chemin -> Set(client)
    this.clients = [];
    this.minuteries = [];                // {id, client, du, fn, intervalle}
    this.prochainIdMinuterie = 1;
    this.temps = 1_700_000_000_000;      // temps virtuel (ms)
    this.pasMinMs = pasMinMs; this.pasMaxMs = pasMaxMs;
    this.maxEssaisTransaction = maxEssaisTransaction;
    this.journal = []; this.journalMax = journalMax;
    this.erreursEcouteurs = [];          // exceptions levées par les rappels des moteurs (écouteurs, minuteries)
    this.stats = { pas: 0, transactions: 0, ecritures: 0, perimes: 0, abandonsLocaux: 0, refus: 0, coupures: 0, fermetures: 0 };
  }

  // ---------- outils ----------
  hasard(){ return this.alea(); }
  entier(n){ return Math.floor(this.alea() * n); }
  choisir(liste){ return liste[this.entier(liste.length)]; }
  maintenant(){ return this.temps; }
  noter(texte){ this.journal.push(`[${this.stats.pas}] ${texte}`); if(this.journal.length > this.journalMax) this.journal.shift(); }
  valeur(chemin){ return this.serveur.has(chemin) ? this.serveur.get(chemin) : null; }
  ecrireServeur(chemin, v){ if(v === null || v === undefined) this.serveur.delete(chemin); else this.serveur.set(chemin, v); }

  // ---------- clients ----------
  creerClient(nom){
    const R = this;
    const client = {
      nom, vivant: true, connecte: true,
      requetes: [],                      // demandes sans réponse, dans l'ordre d'envoi : {id, type, chemin, arrive, …}
      entrant: [],                       // messages du serveur en route vers le client (FIFO)
      vue: new Map(),                    // chemin -> valeur connue du serveur (cache), seulement si écouté et amorcé
      superpositions: new Map(),         // chemin -> [{tx, valeur}] valeurs optimistes (applyLocally)
      ecouteurs: new Map(),              // chemin -> [{cb, annule, vu, amorce}]
      prochainId: 1,
      stats: { transactions: 0, ecritures: 0, perimes: 0, abandonsLocaux: 0, refus: 0 },
      echecsAVenir: 0,                   // nombre de transactions que le serveur refusera
      infoConnecte: [],                  // écouteurs de « .info/connected » (Section 308 — retouche de la revue)
    };
    client.firebase = this.fauxSdk(client);
    client.setTimeout = (fn, ms) => R.planifier(client, fn, ms, false);
    client.setInterval = (fn, ms) => R.planifier(client, fn, ms, true);
    client.clearTimeout = client.clearInterval = (id) => R.annulerMinuterie(id);
    this.clients.push(client);
    return client;
  }

  fauxSdk(client){
    const R = this;
    const apps = [];
    const utilisateur = { uid: 'anonyme-' + client.nom, isAnonymous: true };
    const auth = {
      currentUser: utilisateur,
      onAuthStateChanged(cb){ Promise.resolve().then(() => cb(utilisateur)); return () => {}; },
      signInAnonymously: async () => ({ user: utilisateur }),
    };
    const db = { ref: (chemin) => R.fausseRef(client, String(chemin)) };
    return {
      apps,
      initializeApp(cfg){ const app = { name: '[DEFAULT]', options: cfg }; apps.push(app); return app; },
      database(){ return db; },
      auth(){ return auth; },
    };
  }

  // Section 308 — retouche de la revue : « .info/connected », servi localement comme dans le vrai SDK.
  refInfoConnecte(client){
    const R = this;
    return {
      key: 'connected',
      toString(){ return 'faux://.info/connected'; },
      on(evenement, cb){
        client.infoConnecte.push(cb);
        Promise.resolve().then(() => { if(client.vivant && client.infoConnecte.includes(cb)) R.appelerInfo(client, cb); });
        return cb;
      },
      off(evenement, cb){ client.infoConnecte = cb === undefined ? [] : client.infoConnecte.filter(x => x !== cb); },
      once(){ return Promise.resolve().then(() => instantane(client.connecte)); },
    };
  }
  appelerInfo(client, cb){
    try{ cb(instantane(client.connecte)); }
    catch(err){ this.erreursEcouteurs.push(`${client.nom} : écouteur .info/connected : ${err && err.stack || err}`); }
  }
  notifierConnexion(client){
    for(const cb of client.infoConnecte.slice()) Promise.resolve().then(() => { if(client.vivant && client.infoConnecte.includes(cb)) this.appelerInfo(client, cb); });
  }

  fausseRef(client, chemin){
    const R = this;
    if(chemin === '.info/connected') return this.refInfoConnecte(client);
    return {
      key: chemin.split('/').pop(),
      toString(){ return 'faux://' + chemin; },
      on(evenement, cb, annule){
        if(evenement !== 'value') throw new Error('Faux SDK : seul l’événement « value » est simulé (' + evenement + ')');
        R.ajouterEcouteur(client, chemin, cb, annule);
        return cb;
      },
      off(evenement, cb){ R.retirerEcouteur(client, chemin, cb); },
      once(evenement){
        if(evenement !== 'value') throw new Error('Faux SDK : once(« value ») seulement');
        // Section 308 — retouche de la revue : écouteur actif et cache rempli → réponse depuis le cache, sans aller-retour.
        if(client.ecouteurs.has(chemin) && client.vue.has(chemin)){
          const v = R.visible(client, chemin).valeur;
          R.noter(`${client.nom} : once(${chemin}) servi depuis le cache local (${resume(v)})`);
          return Promise.resolve().then(() => instantane(v));
        }
        return new Promise((resolve, reject) => R.envoyer(client, { type: 'lire', chemin, resolve, reject }));
      },
      set(v){ return new Promise((resolve, reject) => R.envoyer(client, { type: 'ecrire', chemin, valeur: norm(v), resolve, reject })); },
      remove(){ return new Promise((resolve, reject) => R.envoyer(client, { type: 'ecrire', chemin, valeur: null, resolve, reject })); },
      transaction(fn, onComplete, applyLocally){ return R.demarrerTransaction(client, chemin, fn, onComplete, applyLocally !== false); },
    };
  }

  // ---------- vue locale et écouteurs ----------
  visible(client, chemin){
    const sup = client.superpositions.get(chemin);
    if(sup && sup.length) return { connu: true, valeur: sup[sup.length - 1].valeur };
    if(client.vue.has(chemin)) return { connu: true, valeur: client.vue.get(chemin) };
    return { connu: false, valeur: null };
  }
  notifier(client, chemin){
    if(!client.vivant) return;
    const v = this.visible(client, chemin);
    if(!v.connu) return;
    for(const e of (client.ecouteurs.get(chemin) || []).slice()){
      if(e.amorce && e.vu === v.valeur) continue;
      e.amorce = true; e.vu = v.valeur;
      try{ e.cb(instantane(v.valeur)); }
      catch(err){ this.erreursEcouteurs.push(`${client.nom} : écouteur ${chemin} : ${err && err.stack || err}`); }
    }
  }
  ajouterEcouteur(client, chemin, cb, annule){
    const liste = client.ecouteurs.get(chemin) || [];
    const dejaAbonne = liste.length > 0;
    liste.push({ cb, annule, vu: undefined, amorce: false });
    client.ecouteurs.set(chemin, liste);
    if(!dejaAbonne) this.envoyer(client, { type: 'ecoute', chemin });
    else if(this.visible(client, chemin).connu) Promise.resolve().then(() => this.notifier(client, chemin));
  }
  retirerEcouteur(client, chemin, cb){
    const liste = (client.ecouteurs.get(chemin) || []).filter(e => cb !== undefined && e.cb !== cb);
    if(liste.length){ client.ecouteurs.set(chemin, liste); return; }
    client.ecouteurs.delete(chemin);
    client.vue.delete(chemin);           // sans écouteur, le vrai SDK oublie le cache du chemin
    client.requetes = client.requetes.filter(q => !(q.type === 'ecoute' && q.chemin === chemin));
    this.envoyer(client, { type: 'finEcoute', chemin });
  }

  // ---------- envoi et traitement par le serveur ----------
  envoyer(client, requete){
    if(!client.vivant) return;           // page fermée : rien ne part
    requete.id = client.prochainId++;
    requete.arrive = false;
    client.requetes.push(requete);
  }
  livrerAuServeur(client){
    const q = client.requetes.find(r => !r.arrive);
    if(!q) return false;
    q.arrive = true;
    const repondre = (msg) => { if(client.vivant && client.connecte) client.entrant.push(Object.assign({ requete: q }, msg)); };
    const pousserAuxAutres = (chemin, valeur) => {
      for(const c of (this.abonnes.get(chemin) || [])) if(c !== client && c.vivant && c.connecte) c.entrant.push({ type: 'donnee', chemin, valeur });
    };
    const actuel = this.valeur(q.chemin);
    switch(q.type){
      case 'ecoute': {
        const s = this.abonnes.get(q.chemin) || new Set(); s.add(client); this.abonnes.set(q.chemin, s);
        client.requetes.splice(client.requetes.indexOf(q), 1);
        client.entrant.push({ type: 'donnee', chemin: q.chemin, valeur: actuel });
        break;
      }
      case 'finEcoute': {
        const s = this.abonnes.get(q.chemin); if(s) s.delete(client);
        client.requetes.splice(client.requetes.indexOf(q), 1);
        break;
      }
      case 'lire': repondre({ type: 'lu', valeur: actuel }); break;
      case 'ecrire': {
        this.ecrireServeur(q.chemin, q.valeur); this.stats.ecritures++;
        this.noter(`${client.nom} écrit (set) ${q.chemin}`);
        repondre({ type: 'ecritOk', valeur: q.valeur });
        pousserAuxAutres(q.chemin, q.valeur);
        break;
      }
      case 'tx': {
        if(client.echecsAVenir > 0){
          client.echecsAVenir--; this.stats.refus++; client.stats.refus++;
          this.noter(`${client.nom} : transaction #${q.tx.num} REFUSÉE par le serveur (permission_denied)`);
          repondre({ type: 'txErreur', code: 'permission_denied' });
        } else if(actuel === q.base){
          this.ecrireServeur(q.chemin, q.valeur); this.stats.ecritures++; client.stats.ecritures++;
          this.noter(`${client.nom} : transaction #${q.tx.num} ÉCRITE (${resume(q.valeur)})`);
          repondre({ type: 'txOk', valeur: q.valeur });
          pousserAuxAutres(q.chemin, q.valeur);
          if(client.coupureApresEcriture){                // accusé de réception perdu (voir couperApresProchaineEcriture)
            const d = client.coupureApresEcriture; client.coupureApresEcriture = 0;
            this.couper(client, d);
          }
        } else {
          this.stats.perimes++; client.stats.perimes++;
          this.noter(`${client.nom} : transaction #${q.tx.num} périmée (base ${resume(q.base)} ≠ serveur ${resume(actuel)})`);
          repondre({ type: 'txPerime', valeur: actuel });
        }
        break;
      }
      default: throw new Error('Faux serveur : requête inconnue ' + q.type);
    }
    return true;
  }

  // ---------- traitement par le client ----------
  livrerAuClient(client){
    const m = client.entrant.shift();
    if(!m) return false;
    const q = m.requete;
    const retirer = () => { const i = client.requetes.indexOf(q); if(i >= 0) client.requetes.splice(i, 1); };
    switch(m.type){
      case 'donnee':
        if(!client.ecouteurs.has(m.chemin)) break;       // plus écouté : ignoré
        client.vue.set(m.chemin, m.valeur);
        this.notifier(client, m.chemin);
        break;
      case 'lu': retirer(); q.resolve(instantane(m.valeur)); break;
      case 'ecritOk':
        retirer();
        if(client.ecouteurs.has(q.chemin)){ client.vue.set(q.chemin, m.valeur); this.notifier(client, q.chemin); }
        q.resolve();
        break;
      case 'txOk': {
        retirer();
        const tx = q.tx;
        if(client.ecouteurs.has(q.chemin)) client.vue.set(q.chemin, m.valeur);
        this.retirerSuperposition(client, tx);
        this.notifier(client, q.chemin);
        this.terminerTransaction(tx, null, true, m.valeur);
        break;
      }
      case 'txErreur': {
        retirer();
        const tx = q.tx;
        this.retirerSuperposition(client, tx);
        this.notifier(client, q.chemin);
        this.terminerTransaction(tx, new Error(m.code), false, null);
        break;
      }
      case 'txPerime': {
        retirer();
        const tx = q.tx;
        if(client.ecouteurs.has(q.chemin)) client.vue.set(q.chemin, m.valeur);
        this.passeTransaction(tx, m.valeur);
        break;
      }
      default: throw new Error('Faux client : message inconnu ' + m.type);
    }
    return true;
  }

  // ---------- transactions ----------
  demarrerTransaction(client, chemin, fn, onComplete, applyLocally){
    this.stats.transactions++; client.stats.transactions++;
    const tx = { client, chemin, fn, onComplete, applyLocally, envois: 0, num: client.stats.transactions };
    const promesse = new Promise((resolve, reject) => { tx.resolve = resolve; tx.reject = reject; });
    const v = this.visible(client, chemin);
    this.passeTransaction(tx, v.connu ? v.valeur : null, true);
    return promesse;
  }
  // Une passe : exécute fn sur `entree` ; abandon, ou envoi au serveur avec `entree` comme base.
  passeTransaction(tx, entree, premiere){
    const client = tx.client;
    if(!client.vivant) return;
    let sortie;
    try{ sortie = tx.fn(norm(entree)); }
    catch(err){ this.retirerSuperposition(client, tx); this.notifier(client, tx.chemin); this.terminerTransaction(tx, err, false, null); return; }
    if(sortie === undefined){
      if(premiere){ this.stats.abandonsLocaux++; client.stats.abandonsLocaux++; }
      this.noter(`${client.nom} : transaction #${tx.num} abandonnée par la fonction (${premiere ? 'cache local ' + resume(entree) : 'valeur serveur'})`);
      this.retirerSuperposition(client, tx);
      this.notifier(client, tx.chemin);
      // Le vrai SDK résout la promesse via un rappel : la suite de l'appelant s'exécute en microtâche.
      this.terminerTransaction(tx, null, false, norm(entree));
      return;
    }
    tx.envois++;
    if(tx.envois > this.maxEssaisTransaction){
      this.retirerSuperposition(client, tx); this.notifier(client, tx.chemin);
      this.terminerTransaction(tx, new Error('maxretry'), false, null);
      return;
    }
    if(tx.applyLocally){
      const sup = client.superpositions.get(tx.chemin) || [];
      const deja = sup.find(s => s.tx === tx);
      if(deja) deja.valeur = sortie; else sup.push({ tx, valeur: sortie });
      client.superpositions.set(tx.chemin, sup);
      this.notifier(client, tx.chemin);                  // événement optimiste, synchrone comme dans le vrai SDK
    }
    this.envoyer(client, { type: 'tx', chemin: tx.chemin, base: norm(entree), valeur: sortie, tx });
  }
  retirerSuperposition(client, tx){
    const sup = client.superpositions.get(tx.chemin);
    if(!sup) return;
    const i = sup.findIndex(s => s.tx === tx);
    if(i >= 0) sup.splice(i, 1);
    if(!sup.length) client.superpositions.delete(tx.chemin);
  }
  terminerTransaction(tx, erreur, committed, valeur){
    if(!tx.client.vivant) return;
    if(typeof tx.onComplete === 'function'){
      try{ tx.onComplete(erreur, committed, erreur ? null : instantane(valeur)); }
      catch(err){ this.erreursEcouteurs.push(`${tx.client.nom} : onComplete : ${err && err.stack || err}`); }
    }
    if(erreur) tx.reject(erreur); else tx.resolve({ committed, snapshot: instantane(valeur) });
  }

  // ---------- pannes ----------
  // Coupure : un préfixe tiré au sort des messages sortants arrive au serveur, le reste et tout l'entrant sont perdus.
  couper(client, dureeMs){
    if(!client.vivant || !client.connecte) return;
    this.stats.coupures++;
    const enRoute = client.requetes.filter(r => !r.arrive).length;
    const k = this.entier(enRoute + 1);
    for(let i = 0; i < k; i++) this.livrerAuServeur(client);
    const perdus = client.entrant.length;
    client.entrant.length = 0;
    for(const s of this.abonnes.values()) s.delete(client);
    client.connecte = false;
    this.notifierConnexion(client);      // Section 308 — retouche de la revue : « .info/connected » passe à faux
    // Transactions envoyées : rejetées « disconnect » (le client ne sait pas si elles ont été écrites).
    const envoyees = client.requetes.filter(r => r.type === 'tx');
    client.requetes = client.requetes.filter(r => r.type !== 'ecoute' && r.type !== 'finEcoute' && r.type !== 'tx');
    client.requetes.forEach(r => { r.arrive = false; });
    this.noter(`${client.nom} : COUPURE réseau pour ${dureeMs} ms (${k}/${enRoute} message(s) en route arrivés au serveur, ${perdus} message(s) vers le client perdus, ${envoyees.length} transaction(s) annulée(s) « disconnect »)`);
    for(const q of envoyees){
      this.retirerSuperposition(client, q.tx);
      this.notifier(client, q.chemin);
      this.terminerTransaction(q.tx, new Error('disconnect'), false, null);
    }
    this.planifier(null, () => this.reconnecter(client), dureeMs, false);
  }
  reconnecter(client){
    if(!client.vivant || client.connecte) return;
    client.connecte = true;
    this.notifierConnexion(client);      // Section 308 — retouche de la revue : « .info/connected » repasse à vrai
    const ecoutes = [...client.ecouteurs.keys()].map(chemin => ({ type: 'ecoute', chemin, id: client.prochainId++, arrive: false }));
    client.requetes = ecoutes.concat(client.requetes);
    this.noter(`${client.nom} : reconnexion (${client.requetes.length} demande(s) à renvoyer)`);
  }
  // Page fermée (ou rechargée) : un préfixe des messages sortants arrive quand même, puis plus rien.
  fermer(client){
    if(!client.vivant) return;
    this.stats.fermetures++;
    let arrives = 0;
    if(client.connecte){
      const enRoute = client.requetes.filter(r => !r.arrive).length;
      const k = this.entier(enRoute + 1);
      for(let i = 0; i < k; i++) if(this.livrerAuServeur(client)) arrives++;
      this.noter(`${client.nom} : PAGE FERMÉE (${arrives}/${enRoute} message(s) en route arrivés au serveur)`);
    }
    client.vivant = false; client.connecte = false;
    client.entrant.length = 0; client.requetes.length = 0;
    for(const s of this.abonnes.values()) s.delete(client);
    this.minuteries = this.minuteries.filter(m => m.client !== client);
    return arrives;
  }
  echouerTransactions(client, n = 1){ client.echecsAVenir += n; }
  // La connexion du client tombe juste après que le serveur a écrit sa prochaine transaction : l'écriture est faite,
  // l'accusé est perdu, le SDK rejette la transaction (« disconnect »).
  couperApresProchaineEcriture(client, dureeMs){ client.coupureApresEcriture = Math.max(1, dureeMs); }

  // ---------- minuteries en temps virtuel ----------
  planifier(client, fn, ms, intervalle){
    const id = this.prochainIdMinuterie++;
    const d = Math.max(0, Number(ms) || 0);
    this.minuteries.push({ id, client, du: this.temps + d, ms: d, fn, intervalle: !!intervalle });
    return id;
  }
  annulerMinuterie(id){ this.minuteries = this.minuteries.filter(m => m.id !== id); }
  delai(ms){ return new Promise(r => this.planifier(null, r, ms, false)); }
  declencher(m){
    if(m.intervalle) m.du = this.temps + Math.max(1, m.ms);
    else this.minuteries.splice(this.minuteries.indexOf(m), 1);
    try{ m.fn(); }
    catch(err){ this.erreursEcouteurs.push(`${m.client ? m.client.nom : 'banc'} : minuterie : ${err && err.stack || err}`); }
  }

  // ---------- ordonnanceur ----------
  candidats(extra){
    const c = [];
    for(const cl of this.clients){
      if(!cl.vivant || !cl.connecte) continue;
      if(cl.requetes.some(r => !r.arrive)) c.push(() => this.livrerAuServeur(cl));
      if(cl.entrant.length) c.push(() => this.livrerAuClient(cl));
    }
    const echue = this.minuteries.filter(m => !m.intervalle && m.du <= this.temps).sort((a, b) => a.du - b.du || a.id - b.id)[0];
    if(echue) c.push(() => this.declencher(echue));
    const intervalle = this.minuteries.filter(m => m.intervalle && m.du <= this.temps).sort((a, b) => a.du - b.du || a.id - b.id)[0];
    if(intervalle) c.push(() => this.declencher(intervalle));
    if(extra) for(const f of extra()) c.push(f);
    return c;
  }
  // Un pas : tire un candidat, l'exécute, puis laisse les moteurs vider leurs microtâches. Renvoie false si rien
  // n'était possible (hors minuteries futures).
  async pas(extra){
    const c = this.candidats(extra);
    if(!c.length){
      const futures = this.minuteries.filter(m => !m.intervalle);
      if(!futures.length) return false;
      this.temps = Math.max(this.temps, Math.min(...futures.map(m => m.du)));
      return this.pas(extra);
    }
    this.stats.pas++;
    this.temps += this.pasMinMs + this.entier(this.pasMaxMs - this.pasMinMs + 1);
    this.choisir(c)();
    await microtaches();
    return true;
  }
  // Livre jusqu'au calme : plus aucun message, plus aucune minuterie ponctuelle, plus de candidat extra ; puis
  // déclenche une fois les minuteries périodiques (ex. la resynchronisation toutes les 3 s de startPolling) et
  // recommence si elles ont produit du trafic.
  async pomper({ extra, maxPas = 200000 } = {}){
    await microtaches();
    for(let tour = 0; tour < 50; tour++){
      while(await this.pas(extra)){
        if(this.stats.pas > maxPas) throw new Error(`Ordonnanceur : plus de ${maxPas} pas sans calme (boucle infinie ?)`);
      }
      const periodiques = this.minuteries.filter(m => m.intervalle);
      if(!periodiques.length) return;
      this.temps += 3000;
      for(const m of periodiques.slice()) if(this.minuteries.includes(m)) this.declencher(m);
      await microtaches();
      if(!this.candidats(extra).length && !this.minuteries.some(m => !m.intervalle)) return;
    }
  }
  // Livre jusqu'à ce que la promesse soit réglée (ou jusqu'au calme : erreur, la promesse ne se réglera jamais).
  async attendrePromesse(p, { extra } = {}){
    let regle = false, valeur, erreur, rejete = false;
    Promise.resolve(p).then(v => { regle = true; valeur = v; }, e => { regle = true; rejete = true; erreur = e; });
    await microtaches();
    while(!regle){
      if(!(await this.pas(extra))) throw new Error('Ordonnanceur : calme atteint mais la promesse attendue n’est jamais réglée');
    }
    if(rejete) throw erreur;
    return valeur;
  }
}

// Résumé lisible d'une valeur de partie pour le journal : version et nombre de lancers.
function resume(v){
  if(v === null || v === undefined) return 'null';
  const m = /"version":(\d+)/.exec(String(v).slice(-400)) || /"version":(\d+)/.exec(String(v));
  return m ? 'v' + m[1] : String(v).slice(0, 20);
}

module.exports = { Reseau, mulberry32, instantane };
