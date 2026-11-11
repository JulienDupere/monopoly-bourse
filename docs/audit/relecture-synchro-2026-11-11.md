<!--
Relecture indépendante de l'enregistrement et de la synchronisation multi-appareils, faite le 2026-11-11 par un
agent de relecture (Fable, effort élevé, lecture seule) sur le commit 1f4ba45 (code en production ce jour-là).
Les constats S1 à S3, M1 à M5 et les logos de M6 ont été corrigés le jour même : section 319 de RESUME_ET_REGLES.md.

Vérification par la session principale le même jour : les sept scripts de preuve (annexes B à H) ont été rejoués
et donnent le résultat annoncé ; chaque endroit cité a été relu dans index.html. Le constat M3 repose sur la
lecture du code seulement, et M2 n'a pas été vu dans un vrai navigateur.

Les scripts vivaient dans un dossier temporaire qui peut avoir été effacé : ils sont recopiés en entier dans les
annexes. Pour les rejouer, les déposer dans un même dossier hors du dépôt (ils chargent le banc du dépôt par son
chemin absolu, voir REPO dans banc.js).
-->

# Relecture critique — enregistrement et synchronisation multi-appareils (commit 1f4ba45)

## Verdict

- **Aucun défaut bloquant.** Le cœur transactionnel (`saveGame`, `runActionWithRetry`, `finishAction`, `applyRemoteStateIfNewer`) tient à la lecture ligne par ligne et aux essais.
- **Trois défauts sérieux par nature mais rares**, tous prouvés par script : une action doublée, une action débitée au mauvais joueur, une partie écrasée.
- **Six défauts mineurs** : blocages contournables ou gênes. Quatre sont prouvés, un est établi par lecture du code, un est une mesure.
- Rien n'a été modifié dans le dépôt (`git status` vide à la fin). Aucun accès hors de 127.0.0.1. Aucun processus laissé en marche.
- **L'émulateur n'a pas été démarré** : je ne suis pas certain que `firebase-tools` n'appelle rien à l'extérieur au lancement. Le vrai SDK n'a donc servi qu'à une sonde locale (M4).

Dossier des scripts : `C:\Users\Julien\AppData\Local\Temp\claude\6b1c9c30fd872467\0c56fad7-48bd-418e-a881-a569945fae2b\scratchpad\relecture-synchro\`. Les scripts de preuve sont recopiés en annexe ; les preuves S1 à M5 demandent `banc.js` dans le même dossier.

---

## Constats sérieux

### S1 — Action appliquée deux fois après un accusé perdu, dès que 100 actions d'autres joueurs passent avant le nouvel essai (invariant 2)

- **Endroit** : `recordActionId` / `APPLIED_ACTION_IDS_MAX = 100` (grep `APPLIED_ACTION_IDS_MAX`) ; branche `saved==='conflict' && stateHasActionId(...)` de `runActionWithRetry` (grep `déjà écrite \(accusé perdu\)`).
- **Scénario** :
  1. Alice confirme « Investir 1 M$ dans les bons ». Le serveur écrit, l'accusé se perd, son téléphone reste coupé (verrouillé, Wi-Fi perdu).
  2. Les autres enregistrent 100 actions. L'identifiant d'Alice sort de la liste des 100.
  3. Au retour, l'essai suivant voit un conflit, ne trouve plus son identifiant et rejoue l'action.
  4. Résultat : 2 M$ investis pour un seul clic, annoncé « réussi ». Personne ne voit rien.
- **Pourquoi les tests ne le voient pas** : les scénarios d'accusé perdu du banc ont des coupures courtes et quelques actions concurrentes, jamais 100.
- **Preuve** : `preuve-fenetre100.js` (annexe B). Avec 99 actions, un seul investissement ; avec 100, deux.
- **Confiance** : élevée sur le mécanisme. Le vrai SDK rejette bien « disconnect » puis attend la reconnexion (RAPPORT.md du banc réel, §3.1). Probabilité faible : accusé perdu et longue absence ensemble.
- **Correction la plus petite** : après un essai « peut-être écrit », si la version fraîche dépasse la version de base d'au moins 100 et que l'identifiant est absent, rendre l'issue « incertaine » au lieu de rejouer. Plus propre : garder le dernier numéro appliqué par préfixe d'appareil.

### S2 — « Vous êtes » changé pendant qu'une action s'enregistre : l'action rejouée est débitée au nouveau joueur (invariants 1 et 3 du point de vue des joueurs)

- **Endroit** : écouteur `change` de `#whoami` dans `render()` (grep `getElementById\('whoami'\).addEventListener`). `whoami` est dans la liste libre de `isFreeClickButton`. Les applyFn relisent `myPlayerId` à chaque application (ex. `modalBonds`).
- **Scénario (téléphone partagé par Alice et Bob)** :
  1. Alice confirme « Investir 1 ». Le premier essai est calculé à son nom.
  2. Avant la fin de l'enregistrement, le téléphone passe à Bob, qui choisit « Vous êtes : Bob ».
  3. L'essai d'Alice tombe sur un conflit (Chloé vient d'enregistrer). L'applyFn est rejouée avec `myPlayerId` = Bob.
  4. Résultat : 1 M$ prélevé sur l'encaisse de Bob, journal « Bob investit », annoncé réussi. Alice n'a rien.
- **Variante plus probable** : l'action d'Alice attend le réseau (« en attente du réseau », parfois des dizaines de secondes). Un conflit au retour est alors presque certain.
- **Pourquoi les tests ne le voient pas** : dans tous les bancs, l'identité d'un appareil est fixe pendant une action.
- **Preuve** : `preuve-vous-etes.js` (annexe C).
- **Confiance** : élevée sur le mécanisme. Exposition nulle si chaque joueur garde son téléphone et ne touche pas à « Vous êtes ».
- **Correction la plus petite** : mémoriser `myPlayerId` au lancement dans `attemptActionWithRetry` et abandonner (`notSaved`) s'il a changé avant une application. Ou désactiver `#whoami` tant que `actionsInFlight>0`.

### S3 — `createGame` écrase sans avertir une partie existante de même code (destruction de données)

- **Endroit** : `createGame`, tirage du code (grep `ABCDEFGHJKLMNPQRSTUVWXYZ`) puis `await storageSet('game:'+code, JSON.stringify(s), true)`. C'est un `set()` sans vérification, et son retour n'est pas lu.
- **Scénario** :
  1. Le code fait 4 lettres parmi 24, soit 331 776 codes. La base garde toutes les anciennes parties.
  2. Une création tombe sur un code occupé avec une probabilité de (parties stockées) / 331 776, par exemple 0,015 % avec 50 parties.
  3. La partie existante est remplacée sur le serveur, sans aucun message.
  4. Ses joueurs gardent l'ancien écran (version reçue plus basse, donc ignorée). Leur prochaine action adopte la partie des inconnus.
- **Pourquoi les tests ne le voient pas** : chaque test crée une seule partie sur un serveur vide.
- **Preuve** : `preuve-code-collision.js` (annexe D), collision forcée en fixant les 4 tirages.
- **Confiance** : élevée. Très rare, mais perte totale et silencieuse.
- **Correction la plus petite** : écrire par `transaction(cur => cur===null ? raw : undefined)` et retirer un code si la place est prise. Vérifier aussi le retour : une création dont l'écriture échoue affiche aujourd'hui une partie qui n'existe pas sur le serveur.

---

## Constats mineurs

### M1 — Tour figé : le dernier « Tour Terminé » fait deux écritures, et rien ne relance le lancer si la seconde n'a pas lieu (invariant 8)

- **Endroit** : `markCompanyReady` (écriture 1, `co.ready = true`) puis `checkAllCompaniesReady` → `performRollForAllCompanies` (écriture 2). Boutons : grep `data-cancel-ready`.
- **Scénario** : Bob, dernier à cliquer, voit sa page disparaître entre les deux écritures (rechargement, Safari suspendu, « conflits répétés » ou exception sur le lancer). Sur le serveur, tout le monde est prêt et le lancer n'a pas eu lieu.
- **Ce que voient les joueurs** : aucun appareil ne relance. Chaque CEO n'a que « Annuler Tour Terminé », sans message. Dix minutes plus tard, rien n'a bougé.
- **Contournement** : un CEO annule puis reclique, ou le créateur force le tour (onglet Administration, visible de lui seul).
- **Pourquoi les tests ne le voient pas** : les invariants du banc vérifient « au plus un lancer par tour », pas « le lancer finit par avoir lieu ».
- **Preuve** : `preuve-tour-fige.js` (annexe E).
- **Confiance** : élevée. Fenêtre courte (moins d'une seconde), donc rare.
- **Correction** : un bouton de secours « Lancer les dés » quand toutes les entreprises libres sont prêtes, sur le modèle de `data-pass-all-jailed`, qui appelle `checkAllCompaniesReady(roll)`.

### M2 — Champ qui enregistre au « change » : le clic de confirmation qui suit la saisie est ignoré, et la fenêtre d'assurance perd les cases cochées (invariant 8)

- **Endroit** : écouteur `change` de `mDeductibleGlobal` dans `modalInsureBundle` (grep `mDedGlobalEl.addEventListener`) ; garde des clics (grep `Une action est déjà en cours`). Même effet pour `mDiscount` et `mGrowth`.
- **Scénario** :
  1. Alice coche des cases, tape une franchise, clique « Confirmer la sélection ».
  2. Le navigateur émet `change` au mousedown, avant `click`. Le `change` lance `setTurnDeductible` (`actionsInFlight` = 1).
  3. Le clic est ignoré (« ce clic a été ignoré », ou en silence si l'action finit dans les 500 ms).
  4. La fenêtre se redessine et les cases sont décochées. Il faut tout recocher et recliquer.
- **Pourquoi les tests ne le voient pas** : le scénario F1 de `tests/section313-fenetre.test.js` pose la valeur sans émettre `change` (son commentaire le dit), puis clique. Ce n'est pas l'ordre réel d'un navigateur.
- **Preuve** : `preuve-change-puis-clic.js` (annexe F), sur le mini-DOM du dépôt avec l'ordre change puis click.
- **Confiance** : élevée sur ordinateur et Android. À vérifier sur iOS Safari, où un appui sur un bouton ne retire pas toujours le focus du champ.
- **Correction** : ne plus enregistrer la franchise au `change` dans cette fenêtre (la confirmation transmet déjà la valeur tapée), et conserver les cases cochées au redessin.

### M3 — Onglet « Produits » : la fiche ouverte se referme à chaque action d'un autre joueur (invariant 7)

- **Endroit** : `produitsRowHtml` (grep `<details class="pm-row"`), sans `id` ni état mémorisé. `captureAppFormState` ne garde que `.open[id]` et `[aria-expanded="true"][id]`.
- **Scénario** : un joueur lit une fiche dépliée. Toute action d'un autre joueur redessine l'onglet (`render()` réécrit `tabbody`), la fiche se replie et le texte saute. En pleine fenêtre de marché, cela arrive plusieurs fois par minute.
- **Pourquoi les tests ne le voient pas** : le mini-DOM ne modélise pas `<details open>` ; les tests couvrent les champs et les menus avec `id`.
- **Preuve** : non exécutée, lecture du code seulement (il faudrait un vrai navigateur). Les accordéons de « Mon Entreprise », eux, ont leur état mémorisé.
- **Confiance** : élevée.
- **Correction** : mémoriser les fiches ouvertes comme `entrepriseAccordionState`, ou ne pas redessiner l'onglet `matrice` sur une valeur reçue (son contenu ne dépend pas de l'état).

### M4 — Après une panne de réseau, le SDK peut attendre plusieurs minutes avant de se reconnecter ; l'application refuse toute action pendant ce temps (invariant 8)

- **Endroit** : `isKnownOffline` / `OFFLINE_ACTION_MESSAGE` (grep `OFFLINE_REFUSE_GRACE_MS`). SDK 10.14.1, `index.cjs.js` : `RECONNECT_MAX_DELAY_DEFAULT = 60*5*1000`, multiplicateur 1,3. `onVisible_` ne remet le délai à 1 s que s'il est déjà au maximum.
- **Scénario** : la box perd Internet 90 s, les téléphones restent en Wi-Fi, écran allumé (donc pas d'événement `online`). Au retour d'Internet, la prochaine tentative tombe entre 0 et 66 s plus tard. Après une panne plus longue, le plafond est de 5 min.
- **Ce que voient les joueurs** : « Pas de connexion au serveur : action non envoyée » alors qu'Internet marche. Rien n'indique de recharger.
- **Pourquoi les tests ne le voient pas** : le faux SDK se reconnecte à l'heure fixée par le test ; le banc réel utilisait `goOffline` / `goOnline`, qui remet le délai à zéro.
- **Preuve** : `sonde-reconnexion.js` (annexe G), vrai SDK contre un port local que le script ouvre lui-même. En 90 s : 16 tentatives, écarts croissants, `reconnectDelay_` = 66,5 s, plafond 300 s.
- **Confiance** : élevée sur le SDK, moyenne sur la fréquence.
- **Correction** : sur une action refusée hors ligne avec la page visible, appeler `db.goOffline(); db.goOnline();` (`resume()` remet le délai à 1 s et relance tout de suite).

### M5 — Écoute révoquée ou connexion anonyme ratée, jamais retentée : appareil sourd, et toutes ses actions échouent en « conflits répétés » (invariants 6 et 8)

- **Endroit** : `onCancel` de `startPolling` (grep `Abonnement Firebase annulé`) journalise sans reposer l'écoute. `firebaseAuthReady` met son résultat en cache, même `false` (grep `firebaseAuthPromise = new Promise`).
- **Scénario** : le serveur révoque l'écoute (SDK : `onListenRevoked_` → `permission_denied`). Cas typiques : jeton expiré non rafraîchi à temps après une longue veille, session anonyme supprimée, connexion anonyme ratée au chargement.
- **Ce que voit le joueur** : plus aucune mise à jour. Chaque action fait 5 essais puis affiche « Conflits répétés : d'autres joueurs enregistrent en même temps », ce qui est faux. Seul le bandeau « Connexion à Firebase refusée… recharge la page » donne le bon remède.
- **Cause** : sans écoute, le cache du SDK est vide et la première passe de la transaction abandonne à chaque essai.
- **Pourquoi les tests ne le voient pas** : la fausse authentification est toujours connectée et le faux serveur ne révoque jamais une écoute.
- **Preuve** : la conséquence est prouvée par `preuve-ecoute-revoquee.js` (annexe H), révocation simulée à la main. Le déclencheur n'est pas prouvé : à prouver sur l'émulateur (`signOut()` forcé ou suppression du compte anonyme).
- **Confiance** : élevée sur la conséquence, faible sur la fréquence.
- **Correction** : dans `onCancel`, remettre `firebaseAuthPromise` à `null`, attendre `firebaseAuthReady()`, puis reposer l'écoute après un délai.

### M6 — Tout l'état part à chaque action et arrive sur chaque appareil : taille et débit (hypothèse la moins couverte)

- **Mesure** (`taille.js`, annexe I) : partie passive à 6 joueurs, 25,6 Ko au départ, 141,8 Ko après 60 lancers, 351 Ko après 240. Plus gros champs : `balanceSheetSnapshots`, `companies` (historiques de cours), `history`, `log`.
- **Logos** : ils sont stockés dans l'état en PNG de 240 px (grep `resizeImageFileToDataUrl(file, 240)`). Une photo peut ajouter de l'ordre de 100 à 200 Ko par entreprise à chaque écriture. C'est une estimation, non mesurée faute de canvas.
- **Conséquences possibles, non prouvées** :
  - écritures plus longues en 4G, donc fenêtre de conflit plus large (5 conflits de suite donnent « PAS enregistrée ») ;
  - trafic par partie de l'ordre de (nombre d'actions × taille × nombre d'appareils), à comparer au quota du forfait Firebase ;
  - repli du SDK en « long-polling » très lent si un réseau bloque les WebSockets.
- **Limite de taille** : aucun risque (10 Mo par chaîne).
- **Correction** : à surveiller dans la console Firebase. Logos en JPEG ou WebP plus petits, ou hors de l'état.

### Note — exception non rattrapée dans `saveGame` après un conflit

Dans la branche conflit, `JSON.parse(remoteRaw)` et `migrateState` ne sont pas protégés, et `runActionWithRetry` n'a pas de `catch` autour de `saveGame`. Si `migrateState` levait une exception sur une valeur du serveur, l'état local resterait modifié sans être restauré. Je n'ai trouvé aucun état qui déclenche ce cas : c'est théorique.

---

## (1) Ce que j'ai relu et trouvé solide

- **Cœur transactionnel**, branche par branche :
  - trois issues de `saveGame`, cache vide à la première passe, relecture `once` ;
  - accusé perdu avec ou sans conflit intercalé, règle « prouvé absent seulement si version lue > base » (elle tient même si l'ancienne socket livre en retard) ;
  - restauration par copie profonde (chaîne JSON), file d'actions, `actionsInFlight` décrémenté sur toutes les sorties ;
  - valeur reçue pendant une action, version qui ne recule jamais, garde de fin de partie (316), nettoyage `dropStaleMortgageOffers` protégé.
- **Suites du dépôt à HEAD** : `node tests/run-all.js` donne 71/71 fichiers réussis ; `SYNC_SEEDS=40 node tests/section308-sync.test.js` donne 320 cas multi-appareils OK.
- **Contournements (C)** :
  - les 34 appels directs à `saveGame()` sont derrière `opts.silent` / `skipSave` et tous leurs appelants passent `silent:true` ; quatre fonctions à sauvegarde directe sont du code mort (`expireContract`, `cancelPropInsurance`, `expirePropInsurance`, `expireSubInsurance`), ainsi que `rollDiceAndMove` ;
  - aucun `setTimeout` ni écouteur `change` ne modifie l'état hors enveloppe ;
  - les traitements automatiques (enchères, fin d'année, appels de marge) sont dans l'écriture du lancer ;
  - balayage statique des 111 appels d'enveloppe : aucune applyFn n'écrit dans un objet de `state` capturé avant l'action, y compris dans le code des sections 309 à 318 ;
  - `rendu-mutation.js` (annexe K) : 504 rendus, 0 modification de `state`.
- **Migration (F)** : `migration.js` (annexe J). Une partie créée et jouée 14 lancers avec le code de la section 308 (commit 5915ded), rechargée par le code actuel : aucune exception sur 12 lancers ni au rendu. Les seules clés absentes sont `absReceivable` / `absCeded` des anciens bilans, lues avec `||0`. `migrateState` ne contient ni `uid()` ni hasard.
- **Fenêtres et formulaires (E)** :
  - `render()` ne touche jamais `#modalHost` ; `closeModal` n'est appelé que par des gestes du joueur ; les fenêtres d'information attendent ;
  - 178 champs de gabarit, tous avec une clé, sauf une case d'affichage ;
  - tous les reports sont bornés (5 s, 8 s, 30 s) et la minuterie de 3 s rattrape.
- **Hypothèses SDK confirmées dans la source 10.14.1** : `cancelSentTransactions_` → « disconnect », `MAX_TRANSACTION_RETRIES = 25` (jamais atteint, la fonction abandonne), transactions lancées hors ligne mises en attente.

## (2) Ce que je n'ai PAS couvert

- **Vrai SDK à HEAD** : le banc réel de `C:\Users\Julien\tools\firebase-emulateur\banc-reel\banc-reel.js` est câblé sur `.claude/worktrees/serie-308`, qui n'existe plus. Le code d'après 308 n'a donc jamais tourné contre le vrai SDK. À refaire en pointant `COPIE` sur le dépôt.
- **Vrai navigateur** : aucun essai. M2 et M3 reposent sur l'ordre standard des événements et sur la lecture du code. Rien sur iOS Safari (gel de page, focus, IndexedDB).
- **Logique métier des applyFn** : je n'ai lu que les offres de vente (309/310), les bons, le tour et la franchise. Les fenêtres qui n'utilisent pas `confirmWithFreshConditions` peuvent encore afficher des conditions périmées (refus possible, pas de corruption).
- **Parties anciennes riches** : la migration n'a été essayée que sur une partie passive, sans swaps, ABS, assurances, prêts ni options.
- **Mode spectateur / TV, hors périmètre** ; même chose pour les règles de sécurité : `auth != null` à la racine, dépôt public, donc tout visiteur anonyme peut lire ou supprimer `data/`.
- **Balayages statiques** : ce sont des heuristiques au niveau des fonctions nommées. Un gabarit de fenêtre construit par une fonction auxiliaire leur échappe.

## (3) Hypothèses du faux SDK les plus fragiles

1. **Reconnexion** : immédiate à l'heure choisie dans le faux SDK ; dans le vrai, attente croissante jusqu'à 5 min, remise à zéro seulement par `online`, `goOnline` ou un retour au premier plan quand le délai est au maximum (M4).
2. **Authentification** : toujours valide dans le faux SDK. Aucune expiration de jeton, aucune écoute révoquée, aucun échec de connexion anonyme (M5).
3. **Messages instantanés quelle que soit la taille** : le vrai envoi de 100 Ko à 1 Mo par action élargit la fenêtre de conflit ; pas de quota ni de repli long-polling (M6).
4. **Page** : fermée ou vivante seulement. Pas de page gelée puis dégelée longtemps après (S1), pas de changement d'identité en cours d'action (S2).
5. **Serveur d'une seule partie par test** : `set()` y écrase sans conséquence visible (S3).

---

## Annexes — scripts de preuve et sorties

### A. `banc.js` (commun aux preuves S1 à M5)

```js
// Petit banc commun aux preuves : moteurs complets d'index.html (un vm par appareil) relies au faux serveur du depot.
const REPO = 'C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance';
const { loadEngine } = require(REPO + '/tests/helpers/engine.js');
const { Reseau } = require(REPO + '/tests/helpers/fake-firebase.js');
function fausseDate(maintenant){
  return class DateVirtuelle extends Date {
    constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); }
    static now(){ return maintenant(); }
  };
}
async function partie(noms, types, modifier){
  const eng = loadEngine();
  const ids = await eng.newGame(noms, types);
  if(modifier) eng.run('(' + modifier.toString() + ')(state)');
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  return { code, ids, raw: eng.mem.get('game:' + code), chemin: 'data/game:' + code };
}
function appareil(R, P, nom, joueurId, opts = {}){
  const client = R.creerClient(nom);
  const ls = new Map(opts.sansPartie ? [] : [['mb:lastcode', P.code], ['mb:mychar:' + P.code, joueurId]]);
  const alertes = [];
  const globals = Object.assign({
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    Date: fausseDate(() => R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alertes.push(String(m)), confirm: () => true,
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc.invalid' },
  }, opts.globals || {});
  const eng = loadEngine({ firebase: client.firebase, globals });
  return { nom, client, eng, alertes, ls };
}
const serveur = (R, P) => JSON.parse(R.valeur(P.chemin));
const caisse = s => (s.bank.cash || 0) + s.companies.reduce((a, c) => a + (c.cash || 0), 0) + s.players.reduce((a, p) => a + (p.cash || 0), 0);
module.exports = { REPO, loadEngine, Reseau, partie, appareil, serveur, caisse };
```

### B. `preuve-fenetre100.js` (S1)

```js
// PREUVE D — cle d'idempotence limitee aux 100 derniers identifiants : action DOUBLEE apres un accuse perdu si plus
// de 100 actions d'autres joueurs s'enregistrent avant le nouvel essai de l'appareil (telephone verrouille).
const { Reseau, partie, appareil, serveur, caisse } = require('./banc.js');
// La meme applyFn que la fenetre « Investir dans les bons » (modalBonds).
const INVESTIR = m => `attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); const r = buyBonds(pl, ${m}); if(!r.ok) return r; log(pl.name+' investit', r.entries); return r; }, {label:'Investir'})`;
async function cas(nbActionsDeBob){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 7 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0]), B = appareil(R, P, 'Bob', P.ids[1]);
  await R.pomper();
  const bons = (s, i) => s.players[i].bondBalance || 0;
  const avant = serveur(R, P);
  // Alice clique UNE fois « Investir 1 » ; le serveur ecrit, l'accuse se perd, son telephone reste coupe 30 minutes.
  R.couperApresProchaineEcriture(A.client, 30 * 60 * 1000);
  const pA = A.eng.run(INVESTIR(1));
  let resA = null; pA.then(r => { resA = r; });
  for(let i = 0; i < 2000 && bons(serveur(R, P), 0) !== 1; i++) await R.pas();
  const ecrit = serveur(R, P);
  // Pendant la coupure d'Alice, Bob enregistre nbActionsDeBob petites actions.
  for(let i = 0; i < nbActionsDeBob; i++){
    const r = await R.attendrePromesse(B.eng.run(INVESTIR(0.01)));
    if(!r.ok) throw new Error('action de Bob refusee : ' + r.error);
  }
  const milieu = serveur(R, P);
  await R.pomper();            // le temps passe, Alice se reconnecte, son action en vol se termine
  const apres = serveur(R, P);
  console.log(`--- ${nbActionsDeBob} actions de Bob pendant la coupure d'Alice`);
  console.log('  bons d\'Alice sur le serveur : avant', bons(avant, 0), '| apres son clic (accuse perdu)', bons(ecrit, 0), '| fin de la coupure', bons(milieu, 0), '| apres la reconnexion', bons(apres, 0));
  console.log('  encaisse d\'Alice : avant', avant.players[0].cash, '| apres', apres.players[0].cash, '| identifiants gardes :', apres.appliedActionIds.length, '| monnaie conservee :', Math.abs(caisse(avant) - caisse(apres)) < 1e-9);
  console.log('  resultat annonce a Alice :', JSON.stringify(resA && { ok: resA.ok, uncertain: resA.uncertain, notSaved: resA.notSaved, reason: resA.reason }), '| etat d\'Alice = serveur :', A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin));
  return bons(apres, 0);
}
(async () => {
  const a = await cas(99), b = await cas(100);
  console.log(a === 1 ? 'OK      99 actions : un seul investissement (1)' : 'ECHEC   99 actions : ' + a);
  console.log(b === 1 ? 'OK     100 actions : un seul investissement (1)' : 'DEFAUT 100 actions : l\'investissement d\'Alice est applique ' + b + ' fois pour UN seul clic');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie :
```
--- 99 actions de Bob pendant la coupure d'Alice
  bons d'Alice sur le serveur : avant 0 | apres son clic (accuse perdu) 1 | fin de la coupure 1 | apres la reconnexion 1
  encaisse d'Alice : avant 44 | apres 43 | identifiants gardes : 100 | monnaie conservee : true
  resultat annonce a Alice : {"ok":true} | etat d'Alice = serveur : true
--- 100 actions de Bob pendant la coupure d'Alice
  bons d'Alice sur le serveur : avant 0 | apres son clic (accuse perdu) 1 | fin de la coupure 1 | apres la reconnexion 2
  encaisse d'Alice : avant 44 | apres 42 | identifiants gardes : 100 | monnaie conservee : true
  resultat annonce a Alice : {"ok":true} | etat d'Alice = serveur : true
OK      99 actions : un seul investissement (1)
DEFAUT 100 actions : l'investissement d'Alice est applique 2 fois pour UN seul clic
```

### C. `preuve-vous-etes.js` (S2)

```js
// PREUVE — telephone partage par deux joueurs : le menu « Vous etes » (#whoami) reste utilisable pendant qu'une action
// s'enregistre. Si l'action est rejouee apres un conflit, son applyFn relit myPlayerId : elle s'applique alors au
// NOUVEAU joueur choisi (son argent), alors que c'est l'autre qui a confirme.
const { Reseau, partie, appareil, serveur, caisse } = require('./banc.js');
const INVESTIR = m => `attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); const r = buyBonds(pl, ${m}); if(!r.ok) return r; log(pl.name+' investit ${m} dans ses bons', r.entries); return r; }, {label:'Investir'})`;
(async () => {
  const P = await partie(['Alice', 'Bob', 'Chloe'], ['garp', 'garp', 'garp']);
  const R = new Reseau({ graine: 5 });
  R.ecrireServeur(P.chemin, P.raw);
  const T = appareil(R, P, 'Telephone partage (Alice et Bob)', P.ids[0]);   // « Vous etes » = Alice
  const C = appareil(R, P, 'Chloe', P.ids[2]);
  await R.pomper();
  const avant = serveur(R, P);
  // 1. Chloe enregistre une action ; le telephone partage ne l'a pas encore recue.
  const micro = () => new Promise(r => setImmediate(r));
  const pC = C.eng.run(INVESTIR(0.01));
  await micro();
  for(let i = 0; i < 50 && serveur(R, P).version === avant.version; i++) R.livrerAuServeur(C.client);
  console.log('version du serveur : depart', avant.version, '| apres l action de Chloe', serveur(R, P).version, '| le telephone affiche encore la version', T.eng.run('state.version'));
  // 2. Alice confirme « Investir 1 » sur le telephone partage.
  let resT = null; T.eng.run(INVESTIR(1)).then(r => { resT = r; });
  await micro();   // l'applyFn d'Alice a tourne (1er essai, au nom d'Alice) et sa transaction est partie
  console.log('1er essai calcule au nom de :', T.eng.run('state.log[0].text'));
  // 3. Elle passe aussitot le telephone a Bob, qui choisit « Vous etes : Bob » (ce que fait l'ecouteur de #whoami).
  T.eng.run(`myPlayerId = ${JSON.stringify(P.ids[1])}; render();`);
  await R.pomper(); await pC;
  const apres = serveur(R, P);
  const b = n => apres.players.find(p => p.name === n);
  console.log('resultat annonce sur le telephone :', JSON.stringify(resT && { ok: resT.ok }), '| alertes :', T.alertes.length);
  console.log('bons : Alice', b('Alice').bondBalance, '| Bob', b('Bob').bondBalance, '| encaisse : Alice', b('Alice').cash, '(avant', avant.players[0].cash + ')', '| Bob', b('Bob').cash, '(avant', avant.players[1].cash + ')');
  console.log('journal :', apres.log.slice(0, 2).map(e => e.text).reverse().join(' PUIS '), '| monnaie conservee :', Math.abs(caisse(avant) - caisse(apres)) < 1e-9);
  console.log(b('Bob').bondBalance === 1 && !b('Alice').bondBalance ? 'DEFAUT : l\'investissement confirme par Alice a ete preleve sur l\'encaisse de Bob' : 'OK : l\'investissement est celui d\'Alice');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie :
```
version du serveur : depart 4 | apres l action de Chloe 5 | le telephone affiche encore la version 4
1er essai calcule au nom de : Alice investit 1 dans ses bons
resultat annonce sur le telephone : {"ok":true} | alertes : 0
bons : Alice 0 | Bob 1 | encaisse : Alice 44 (avant 44) | Bob 43 (avant 44)
journal : Chloe investit 0.01 dans ses bons PUIS Bob investit 1 dans ses bons | monnaie conservee : true
DEFAUT : l'investissement confirme par Alice a ete preleve sur l'encaisse de Bob
```

### D. `preuve-code-collision.js` (S3)

```js
// PREUVE — createGame ecrit la nouvelle partie par un set() sans verifier que le code tire au sort (4 lettres parmi
// 24 = 331 776 codes) est libre : une partie existante qui porte ce code est remplacee sans avertissement.
const { Reseau, partie, appareil, serveur } = require('./banc.js');
(async () => {
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 3 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0]);
  await R.pomper();
  await R.attendrePromesse(A.eng.run(`attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); return buyBonds(pl, 1); })`));
  const avant = serveur(R, P);
  console.log('partie', P.code, 'avant : joueurs', avant.players.map(p => p.name).join(', '), '| version', avant.version, '| entreprises', avant.companies.length);
  // Un autre groupe cree une partie ; le hasard lui donne le meme code (force ici : les 4 premiers tirages).
  const lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const tirages = [];
  const M = Object.create(Math); M.random = () => (tirages.length ? tirages.shift() : Math.random());
  const D = appareil(R, P, 'Autre groupe', null, { sansPartie: true, globals: { Math: M } });
  await R.pomper();
  P.code.split('').forEach(ch => tirages.push((lettres.indexOf(ch) + 0.5) / 24)); // les 4 lettres du code
  await R.attendrePromesse(D.eng.run(`createGame(['Xavier','Yann','Zoe'], 50, 1000, 'M$', {}, [])`));
  await R.pomper();
  const apres = serveur(R, P);
  console.log('code de la nouvelle partie :', D.eng.run('gameCode'), '(identique :', D.eng.run('gameCode') === P.code, ')');
  console.log('partie', P.code, 'apres : joueurs', apres.players.map(p => p.name).join(', '), '| version', apres.version, '| entreprises', apres.companies.length);
  console.log('appareil d\'Alice : joueurs affiches', A.eng.json('state.players.map(p=>p.name)').join(', '), '| son identite existe encore :', A.eng.run('state.players.some(p=>p.id===myPlayerId)'), '| alertes :', A.alertes.length);
  console.log(apres.players[0].name === 'Xavier' ? 'DEFAUT : la partie d\'Alice et Bob est detruite sur le serveur, sans message sur aucun appareil' : 'OK : la partie existante est intacte');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie (le code change à chaque lancement) :
```
partie DMHW avant : joueurs Alice, Bob | version 4 | entreprises 2
code de la nouvelle partie : DMHW (identique : true )
partie DMHW apres : joueurs Xavier, Yann, Zoe | version 0 | entreprises 0
appareil d'Alice : joueurs affiches Alice, Bob | son identite existe encore : true | alertes : 0
DEFAUT : la partie d'Alice et Bob est detruite sur le serveur, sans message sur aucun appareil
```

### E. `preuve-tour-fige.js` (M1)

```js
// PREUVE — « Tour Termine » du dernier CEO = DEUX ecritures (1 : pret ; 2 : lancer). Si l'appareil disparait entre
// les deux (page fermee ou rechargee, telephone verrouille, echec de la 2e ecriture), tout le monde est « pret »,
// aucun lancer n'a lieu, aucun appareil ne le relance et l'ecran n'offre que « Annuler Tour Termine ».
const { Reseau, partie, appareil, serveur } = require('./banc.js');
(async () => {
  const P = await partie(['Alice', 'Bob', 'Chloe'], ['garp', 'dividende', 'garp'], s => { s.companies.forEach(c => { if(c.name !== 'Co Bob') c.ready = true; }); });
  const R = new Reseau({ graine: 11 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0]), B = appareil(R, P, 'Bob', P.ids[1]), C = appareil(R, P, 'Chloe', P.ids[2]);
  await R.pomper();
  const s0 = serveur(R, P);
  const coBob = s0.companies.find(c => c.name === 'Co Bob').id;
  console.log('depart : lancer', s0.gameClock.rollCount, '| pretes :', s0.companies.map(c => c.name + '=' + !!c.ready).join(', '));
  // Bob clique « Tour Termine » (le dernier). Sa 1re ecriture arrive ; sa page disparait avant la 2e (le lancer).
  B.eng.run(`markCompanyReady(${JSON.stringify(coBob)}, ${s0.gameClock.rollCount})`).catch(() => {});
  for(let i = 0; i < 2000 && !serveur(R, P).companies.find(c => c.id === coBob).ready; i++) await R.pas();
  R.fermer(B.client);
  await R.pomper();
  // Dix minutes passent : minuteries de resynchronisation de tous les appareils, Bob rouvre la page.
  const B2 = appareil(R, P, 'Bob (page rechargee)', P.ids[1]);
  for(let k = 0; k < 200; k++){ R.temps += 3000; await R.pomper(); }
  const s1 = serveur(R, P);
  console.log('10 minutes plus tard : lancer', s1.gameClock.rollCount, '| pretes :', s1.companies.map(c => c.name + '=' + !!c.ready).join(', '), '| version', s1.version);
  for(const d of [A, B2, C]){
    const html = String(d.eng.run(`activeTab='entreprise'; renderTab('entreprise')`));
    console.log(' ', d.nom, ': bouton « Tour Termine » :', html.includes('data-mark-ready='), '| bouton « Annuler Tour Termine » :', html.includes('data-cancel-ready='), '| autre bouton de lancer :', /data-pass-all-jailed=|Lancer les d/.test(html), '| alertes :', d.alertes.length);
  }
  const fige = s1.gameClock.rollCount === s0.gameClock.rollCount && s1.companies.every(c => c.ready);
  console.log(fige ? 'DEFAUT : toutes les entreprises sont pretes, le lancer n\'a pas eu lieu et rien ne le relance' : 'OK : le lancer a eu lieu');
  // Contournement : un CEO annule puis reclique.
  await R.attendrePromesse(A.eng.run(`cancelCompanyReady(myCompany().id, state.gameClock.rollCount)`));
  await R.attendrePromesse(A.eng.run(`markCompanyReady(myCompany().id, state.gameClock.rollCount)`));
  await R.pomper();
  console.log('apres « Annuler » puis « Tour Termine » d\'Alice : lancer', serveur(R, P).gameClock.rollCount);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie :
```
depart : lancer 0 | pretes : Co Alice=true, Co Bob=false, Co Chloe=true
10 minutes plus tard : lancer 0 | pretes : Co Alice=true, Co Bob=true, Co Chloe=true | version 5
  Alice : bouton « Tour Termine » : false | bouton « Annuler Tour Termine » : true | autre bouton de lancer : false | alertes : 0
  Bob (page rechargee) : bouton « Tour Termine » : false | bouton « Annuler Tour Termine » : true | autre bouton de lancer : false | alertes : 0
  Chloe : bouton « Tour Termine » : false | bouton « Annuler Tour Termine » : true | autre bouton de lancer : false | alertes : 0
DEFAUT : toutes les entreprises sont pretes, le lancer n'a pas eu lieu et rien ne le relance
apres « Annuler » puis « Tour Termine » d'Alice : lancer 1
```

### F. `preuve-change-puis-clic.js` (M2)

```js
// PREUVE — champ qui enregistre au « change » (franchise de la fenetre « Assurer plusieurs cases », mDiscount, mGrowth) :
// dans un navigateur, cliquer un bouton juste apres la saisie emet « change » (au mousedown, quand le champ perd le
// focus) AVANT « click ». Le « change » lance une action ; le clic tombe alors sur la garde anti-double-envoi et est
// ignore ; puis la fenetre est redessinee et les cases cochees sont perdues.
// Banc : celui de tests/section313-fenetre.test.js (scenario F1), avec l'ordre reel des evenements.
const REPO = 'C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance';
const { loadEngine } = require(REPO + '/tests/helpers/engine.js');
const { creerDocument } = require(REPO + '/tests/helpers/fake-dom.js');
function appareil(shared){
  const local = new Map();
  const doc = creerDocument();
  const proto = Object.getPrototypeOf(doc.body.__cible);
  const fire = (el, type) => { const evt = { type, target: el, preventDefault(){}, stopPropagation(){} }; return Promise.all(el.__cible._ecouteurs.filter(l => l.type === type).map(l => Promise.resolve(l.fn.call(el, evt)))); };
  proto.dispatchEvent = function(evt){ fire(this.__proxy, evt.type); return true; };
  const timeouts = [], intervals = new Map(); let nextId = 1;
  const storage = {
    get: async k => { const m = k.startsWith('game:') ? shared : local; return m.has(k) ? { value: m.get(k) } : null; },
    set: async (k, v) => { (k.startsWith('game:') ? shared : local).set(k, v); return true; },
    delete: async k => { (k.startsWith('game:') ? shared : local).delete(k); return true; },
  };
  const alerts = [];
  const eng = loadEngine({ globals: { document: doc, storage, alert: m => alerts.push(String(m)),
    setTimeout: (f, ms) => { timeouts.push({ f, ms: Number(ms) || 0 }); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; }, clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } } } });
  const D = { eng, doc, alerts, fire, run: c => eng.run(c), json: c => eng.json(c) };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); for(let k = 0; k < 50 && timeouts.length; k++){ const t = timeouts.shift(); await t.f(); } } };
  return D;
}
(async () => {
  const A = appareil(new Map());
  const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  A.run(`const P = state.properties.find(p=>p.name==='Bleu foncé 2'); P.owners = [{companyId:state.companies[1].id, share:100}]; P.houses = 0; P.mortgages = [];
    state.companies[0].position = 30; state.companies[0].cash = 50; state.companies[0].currentDeductible = 1.9;`);
  await A.run('saveGame({silent:true})');
  A.run(`myPlayerId = ${JSON.stringify(ids[0])}; closeModal(); render()`); await A.calme();
  A.run('modalInsureBundle()'); await A.calme();
  const idx = A.run(`insurableItems(myCompany().id, 'recurring', rollsUntilYearEnd()).findIndex(x=>x.type==='tax' && x.id===4)`);
  const caseSel = `.bundle-check[data-idx="${idx}"]`;
  const box = A.doc.trouver(caseSel); box.checked = true; await A.fire(box, 'change');
  A.run('lastActionEndMs = 0; lastModalOpenMs = 0;');           // la fenetre est ouverte depuis plus de 500 ms
  console.log('avant : case cochee', A.doc.trouver(caseSel).checked, '| franchise enregistree', A.run('myCompany().currentDeductible'), '| contrats', A.json('state.taxInsurances').length);
  // Le joueur tape 0 dans « Franchise » puis clique « Confirmer la selection » : change (mousedown) PUIS click.
  const ded = A.doc.trouver('mDeductibleGlobal'); ded.value = '0';
  const pChange = A.fire(ded, 'change');                          // non attendu : le clic suit dans le meme geste
  console.log('entre « change » et « click » : actions en vol =', A.run('actionsInFlight'));
  const r = A.doc.cliquer('#mOk');
  console.log('clic sur « Confirmer la selection » :', r.clic, '| message :', JSON.stringify((A.run('actionStatusFlash')||{}).text || null));
  await r.promesse; await pChange; await A.calme();
  const boxApres = A.doc.trouver(caseSel);
  console.log('apres : fenetre encore ouverte', !!A.doc.trouver('mOk'), '| case cochee', !!(boxApres && boxApres.checked), '| franchise enregistree', A.run('myCompany().currentDeductible'), '| contrats signes', A.json('state.taxInsurances').length, '| alertes', A.alerts.length);
  console.log(r.clic !== 'ok' && !(boxApres && boxApres.checked) ? 'DEFAUT : le clic de confirmation est ignore et la selection du joueur est videe (il doit tout recocher et recliquer)' : 'OK');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie :
```
avant : case cochee true | franchise enregistree 1.9 | contrats 0
entre « change » et « click » : actions en vol = 1
clic sur « Confirmer la selection » : bloqué | message : "Une action est déjà en cours d’enregistrement : ce clic a été ignoré."
apres : fenetre encore ouverte true | case cochee false | franchise enregistree 0 | contrats signes 0 | alertes 0
DEFAUT : le clic de confirmation est ignore et la selection du joueur est videe (il doit tout recocher et recliquer)
```

### G. `sonde-reconnexion.js` (M4 ; vrai SDK, 127.0.0.1:9777 seulement)

```js
// SONDE (vrai SDK firebase 10.14.1 compat, AUCUN reseau exterieur : seulement 127.0.0.1:9777, un port local que ce
// script ouvre lui-meme) — panne du serveur vue par le SDK : chaque tentative de connexion est acceptee puis coupee
// aussitot. On note l'heure de chaque tentative : l'ecart entre deux tentatives grandit (x1,3, jusqu'a 5 minutes).
// Dans Node comme sur un ecran reste allume en Wi-Fi : pas d'evenement « online », pas de changement de visibilite.
const path = require('path'), net = require('net');
const NM = 'C:/Users/Julien/tools/firebase-emulateur/node_modules';
const firebase = require(path.join(NM, 'firebase', 'compat', 'app'));
require(path.join(NM, 'firebase', 'compat', 'database'));
const PORT = 9777, DUREE = +(process.argv[2] || 100) * 1000;
const t0 = Date.now(); const tentatives = [];
const srv = net.createServer(s => { tentatives.push(Date.now() - t0); s.on('error', () => {}); s.destroy(); });
srv.listen(PORT, '127.0.0.1', () => {
  const app = firebase.initializeApp({ apiKey: 'demo-key', projectId: 'demo-sonde', databaseURL: 'http://127.0.0.1:' + PORT + '/?ns=demo-sonde' }, 'sonde');
  const db = app.database();
  db.useEmulator('127.0.0.1', PORT);
  let etat = null;
  db.ref('.info/connected').on('value', s => { etat = s.val(); });
  db.ref('data/x').on('value', () => {}, () => {});
  setTimeout(async () => {
    const ecarts = tentatives.map((t, i) => i ? ((t - tentatives[i - 1]) / 1000).toFixed(1) : (t / 1000).toFixed(1));
    console.log('duree de la panne observee :', (DUREE / 1000) + ' s | .info/connected =', etat, '| tentatives de connexion :', tentatives.length);
    console.log('instant de chaque tentative (s) :', tentatives.map(t => (t / 1000).toFixed(1)).join(' '));
    console.log('ecart avec la precedente (s)   :', ecarts.join(' '));
    const pc = db._delegate && db._delegate._repoInternal && db._delegate._repoInternal.persistentConnection_;
    if(pc) console.log('delai maximal avant la PROCHAINE tentative (reconnectDelay_ du SDK) :', (pc.reconnectDelay_ / 1000).toFixed(1), 's ; plafond du SDK :', (pc.maxReconnectDelay_ / 1000), 's');
    try{ db.goOffline(); await app.delete(); }catch(e){}
    srv.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  }, DUREE);
});
```

Lancé par `node sonde-reconnexion.js 90`. Sortie :
```
duree de la panne observee : 90 s | .info/connected = false | tentatives de connexion : 16
instant de chaque tentative (s) : 0.0 0.8 1.5 2.2 3.5 5.6 7.7 7.8 8.7 12.6 22.7 34.2 44.7 53.0 75.6 75.8
ecart avec la precedente (s)   : 0.0 0.8 0.7 0.8 1.3 2.1 2.1 0.1 0.9 3.9 10.1 11.6 10.5 8.3 22.6 0.1
delai maximal avant la PROCHAINE tentative (reconnectDelay_ du SDK) : 66.5 s ; plafond du SDK : 300 s
```

### H. `preuve-ecoute-revoquee.js` (M5, conséquence seulement)

```js
// PREUVE (consequence seulement) — si le serveur revoque l'ecoute temps reel d'un appareil (vrai SDK :
// PersistentConnection.onListenRevoked_ retire l'ecoute et appelle le rappel d'annulation avec « permission_denied »),
// startPolling ne la repose jamais : l'appareil ne recoit plus rien et CHAQUE action echoue par « conflits repetes »,
// alors que le serveur repond et que personne d'autre n'ecrit. La revocation est simulee ici a la main.
const { Reseau, partie, appareil, serveur } = require('./banc.js');
const INVESTIR = m => `attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); const r = buyBonds(pl, ${m}); if(!r.ok) return r; log(pl.name+' investit', r.entries); return r; }, {label:'Investir'})`;
(async () => {
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine: 9 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0]), B = appareil(R, P, 'Bob', P.ids[1]);
  await R.pomper();
  // Revocation de l'ecoute d'Alice par le serveur (ce que fait le vrai SDK : ecoute retiree, cache du chemin oublie).
  const liste = A.client.ecouteurs.get(P.chemin) || [];
  A.client.ecouteurs.delete(P.chemin); A.client.vue.delete(P.chemin);
  for(const s of R.abonnes.values()) s.delete(A.client);
  liste.forEach(e => { if(e.annule) e.annule(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); });
  // Bob joue : Alice ne le voit plus, meme apres 5 minutes.
  await R.attendrePromesse(B.eng.run(INVESTIR(2)));
  for(let k = 0; k < 100; k++){ R.temps += 3000; await R.pomper(); }
  console.log('serveur : version', serveur(R, P).version, '| ecran d\'Alice : version', A.eng.run('state.version'), '| bons de Bob vus par Alice :', A.eng.run('state.players[1].bondBalance'), '(serveur :', serveur(R, P).players[1].bondBalance + ')');
  // Alice agit, trois fois de suite.
  for(let i = 1; i <= 3; i++){
    const tx0 = A.client.stats.transactions;
    const r = await R.attendrePromesse(A.eng.run(INVESTIR(1)));
    console.log(`action ${i} d'Alice : ok=${r.ok} raison=${r.reason} | transactions tentees : ${A.client.stats.transactions - tx0} | message : ${String(r.error).slice(0, 96)}…`);
  }
  console.log('bons d\'Alice sur le serveur :', serveur(R, P).players[0].bondBalance, '| ecoutes actives d\'Alice :', (A.client.ecouteurs.get(P.chemin) || []).length);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie :
```
serveur : version 4 | ecran d'Alice : version 3 | bons de Bob vus par Alice : 0 (serveur : 2)
action 1 d'Alice : ok=false raison=conflict | transactions tentees : 5 | message : Conflits répétés : d’autres joueurs enregistrent en même temps — nouvel essai automatique fait 5…
action 2 d'Alice : ok=false raison=conflict | transactions tentees : 5 | message : Conflits répétés : d’autres joueurs enregistrent en même temps — nouvel essai automatique fait 5…
action 3 d'Alice : ok=false raison=conflict | transactions tentees : 5 | message : Conflits répétés : d’autres joueurs enregistrent en même temps — nouvel essai automatique fait 5…
bons d'Alice sur le serveur : 0 | ecoutes actives d'Alice : 0
```

### I. `taille.js` (M6)

```js
// Mesure : taille de l'etat serialise (ce qui part au serveur a CHAQUE action) au fil des lancers.
const { loadEngine } = require('C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance/tests/helpers/engine.js');
(async()=>{
  const eng = loadEngine();
  await eng.newGame(['A','B','C','D','E','F'], ['garp','dividende','garp','dividende','garp','garp'], 50, 5000, {});
  const size = ()=> eng.run('JSON.stringify(state).length');
  console.log('lancer 0 :', size(), 'octets');
  let rolls=0;
  for(let i=1;i<=240;i++){
    const before = eng.run('state.rollCount||0');
    try{ await eng.run('performRollForAllCompanies({})'); }catch(e){ console.log('exception', e.message); break; }
    if(eng.run('!!state.gameEndedReason')){ console.log('fin de partie au lancer', i, eng.run('JSON.stringify(state.gameEndedReason)')); break; }
    rolls++;
    if(i%30===0) console.log('lancer', i, '(rollCount', eng.run('state.rollCount'), ') :', size(), 'octets');
  }
  const keys = eng.json('Object.keys(state).map(k=>[k, JSON.stringify(state[k]===undefined?null:state[k]).length]).sort((a,b)=>b[1]-a[1]).slice(0,12)');
  console.log('plus gros champs :', keys.map(k=>k[0]+'='+k[1]).join(', '));
  const co = eng.json('Object.keys(state.companies[0]).map(k=>[k, JSON.stringify(state.companies[0][k]===undefined?null:state.companies[0][k]).length]).sort((a,b)=>b[1]-a[1]).slice(0,8)');
  console.log('entreprise 0 :', co.map(k=>k[0]+'='+k[1]).join(', '));
})();
```

Sortie (le « rollCount undefined » vient d'une erreur du script : le compteur est `state.gameClock.rollCount` ; les tailles sont justes) :
```
lancer 0 : 25634 octets
lancer 30 (rollCount undefined ) : 98099 octets
lancer 60 (rollCount undefined ) : 141822 octets
lancer 90 (rollCount undefined ) : 177308 octets
lancer 120 (rollCount undefined ) : 212291 octets
lancer 150 (rollCount undefined ) : 247338 octets
lancer 180 (rollCount undefined ) : 281597 octets
lancer 210 (rollCount undefined ) : 316641 octets
lancer 240 (rollCount undefined ) : 351011 octets
plus gros champs : balanceSheetSnapshots=138181, companies=68129, history=52907, log=49925, finLedger=25321, properties=7949, players=2785, appliedActionIds=2301, settings=1222, lastDiceRollEvent=764, etfs=461, houseAuction=49
entreprise 0 : stockPriceHistory=10390, shareholders=92, stockReserve=33, typeReserve=30, stockPrice=22, tradingReserve=19, id=9, ceoId=9
```

### J. `migration.js` (F, à l'appui de « trouvé solide »)

Il demande `index-308.html` dans le même dossier, obtenu par `git show 5915ded:index.html > index-308.html` (écrit dans le scratchpad, pas dans le dépôt).

```js
// F — une partie creee et jouee avec le code de la section 308 (commit 5915ded), rechargee par le code actuel :
// champs absents apres migrateState, exceptions pendant 12 lancers, idempotence de migrateState.
const fs = require('fs');
const { loadEngine } = require('C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance/tests/helpers/engine.js');
function oldSource(file){
  const html = fs.readFileSync(__dirname + '/' + file, 'utf8').split(String.fromCharCode(13)).join('');
  const OPEN = '\n<script>\n', CLOSE = '\n</script>';
  const a = html.lastIndexOf(OPEN), b = html.lastIndexOf(CLOSE);
  return html.slice(a + OPEN.length, b);
}
function shape(o, p, out){
  if(o === null || typeof o !== 'object') return out;
  if(Array.isArray(o)){ o.forEach(x => shape(x, p + '[]', out)); return out; }
  for(const k of Object.keys(o)){
    const kk = /^[a-z0-9]{6,9}$/.test(k) && /[0-9]/.test(k) ? '<id>' : k;
    out.add(p + '.' + kk); shape(o[k], p + '.' + kk, out);
  }
  return out;
}
(async () => {
  const names = ['A','B','C','D'], types = ['garp','dividende','garp','dividende'];
  const old = loadEngine({ transform: () => oldSource(process.argv[2] || 'index-308.html') });
  await old.newGame(names, types, 50, 5000, {});
  for(let i = 0; i < 14; i++) await old.run('performRollForAllCompanies({})');
  const code = old.run('gameCode');
  const rawOld = old.run('JSON.stringify(state)');
  console.log('ancienne partie :', code, rawOld.length, 'octets, rollCount', old.run('state.gameClock && JSON.stringify(state.gameClock)'));

  const cur = loadEngine();
  cur.mem.set('game:' + code, rawOld);
  const ok = await cur.run('loadGame(' + JSON.stringify(code) + ')');
  console.log('loadGame par le code actuel :', ok);
  const migrated = JSON.parse(cur.run('JSON.stringify(state)'));

  const fresh = loadEngine();
  await fresh.newGame(names, types, 50, 5000, {});
  for(let i = 0; i < 14; i++) await fresh.run('performRollForAllCompanies({})');
  const freshState = JSON.parse(fresh.run('JSON.stringify(state)'));
  const sm = shape(migrated, 'state', new Set()), sf = shape(freshState, 'state', new Set());
  const missing = [...sf].filter(k => !sm.has(k) && !/[.]log[[]|lastDiceRollEvent|history[[][]][.]netWorth|portfolioDeltas/.test(k));
  console.log('cles presentes dans une partie neuve et absentes de la partie migree :', missing.length ? missing.join(', ') : 'aucune');

  // idempotence de migrateState sur l'etat actuel
  const r1 = cur.run('(function(){ const a = JSON.stringify(state); const s2 = JSON.parse(a); migrateState(s2); const b = JSON.stringify(s2); const s3 = JSON.parse(b); migrateState(s3); return JSON.stringify([a===b, b===JSON.stringify(s3)]); })()');
  console.log('migrateState inerte sur un etat deja migre [1er passage, 2e passage] :', r1);
  const r2 = fresh.run('(function(){ const a = JSON.stringify(state); const s2 = JSON.parse(a); migrateState(s2); return a===JSON.stringify(s2); })()');
  console.log('migrateState inerte sur une partie neuve jouee 14 lancers :', r2);

  // 12 lancers sur la partie migree
  let exc = null; const cash0 = cur.cashTotal();
  for(let i = 0; i < 12 && !exc; i++){ try{ await cur.run('performRollForAllCompanies({})'); }catch(e){ exc = e; } }
  console.log('12 lancers sur la partie migree :', exc ? 'EXCEPTION ' + exc.stack.split('\n').slice(0,3).join(' | ') : 'sans exception', '; fin de partie :', cur.run('JSON.stringify(state.gameEndedReason||null)'));
  // rendu de chaque onglet
  const tabs = cur.run('JSON.stringify((typeof visibleTabs==="function") ? visibleTabs().map(t=>t.key||t.id||t) : [])');
  console.log('onglets :', tabs);
  for(const t of JSON.parse(tabs)){ try{ cur.run('myPlayerId = state.players[0].id; renderTab(' + JSON.stringify(t) + ')'); }catch(e){ console.log('  rendu ' + t + ' : EXCEPTION', e.message); } }
  console.log('rendus termines');
})().catch(e => { console.error('ECHEC', e); process.exit(1); });
```

Sortie :
```
ancienne partie : WETZ 41938 octets, rollCount {"rollCount":14}
loadGame par le code actuel : true
cles presentes dans une partie neuve et absentes de la partie migree : state.history[].netWorth.xugqutn, state.balanceSheetSnapshots[].absReceivable, state.balanceSheetSnapshots[].absCeded
migrateState inerte sur un etat deja migre [1er passage, 2e passage] : [true,true]
migrateState inerte sur une partie neuve jouee 14 lancers : false
12 lancers sur la partie migree : sans exception ; fin de partie : null
onglets : ["portefeuille","matrice"]
rendus termines
```

Deux précisions sur cette sortie :
- `netWorth.xugqutn` est un identifiant de joueur que le filtre du script n'a pas reconnu, pas un champ manquant.
- Le « false » de la quatrième ligne vient de valeurs par défaut que le créateur de la partie n'a pas encore en local (`etfs[].priceHistory`, `tradeImpactBudget`, `dividendRecurrentNeedsReset`, `subInsurance: null`). Le code les lit toutes avec une garde ; c'est sans effet.

### K. `rendu-mutation.js` (C, à l'appui de « trouvé solide »)

```js
// C — un rendu modifie-t-il state ? (une mutation faite dans un rendu partirait avec la prochaine action de l'appareil,
// ou serait effacee par la prochaine valeur recue.) Partie jouee 20 lancers, chaque onglet, chaque joueur, render() complet.
const { loadEngine } = require('C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance/tests/helpers/engine.js');
(async () => {
  const eng = loadEngine();
  await eng.newGame(['A','B','C','D'], ['garp','dividende','garp','dividende'], 50, 5000, {});
  let n = 0, mut = 0;
  for(let roll = 0; roll <= 20; roll++){
    for(const pid of eng.json('state.players.map(p=>p.id)')){
      for(const t of ['portefeuille','entreprise','assureur','admin','etf','matrice']){
        const before = eng.run('JSON.stringify(state)');
        try{ eng.run(`myPlayerId=${JSON.stringify(pid)}; activeTab=${JSON.stringify(t)}; renderTab(activeTab); render(); bindTabEvents(activeTab);`); }
        catch(e){ console.log('exception au rendu', t, e.message.slice(0, 120)); }
        n++;
        const after = eng.run('JSON.stringify(state)');
        if(after !== before){ mut++; if(mut <= 5){ const a = JSON.parse(before), b = JSON.parse(after); const d = []; (function walk(x, y, p){ if(d.length > 6) return; if(JSON.stringify(x) === JSON.stringify(y)) return; if(x && y && typeof x === 'object' && typeof y === 'object'){ for(const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); } else d.push(p + ' : ' + JSON.stringify(x) + ' -> ' + JSON.stringify(y)); })(a, b, 'state'); console.log('MUTATION au rendu de', t, ':', d.join(' ; ').slice(0, 400)); } }
      }
    }
    await eng.run('performRollForAllCompanies({})');
  }
  console.log(n, 'rendus,', mut, 'ont modifie state');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
```

Sortie : `504 rendus, 0 ont modifie state`

### Balayages statiques non recopiés

`enclosing.js`, `graph.js`, `captures.js`, `captures2.js`, `liaisons.js`, `liaisons2.js` et `champs.js` sont dans le même dossier. Ce sont des heuristiques par expressions régulières qui appuient des constats d'absence, pas des preuves de défaut :
- fonction englobante de chaque `saveGame(` et ses appelants ;
- graphe d'appel des fonctions qui modifient l'état sans enveloppe ;
- variables déclarées avant un appel d'enveloppe et écrites dans l'applyFn (0 écriture sur 111 appels) ;
- attributs `data-*` liés à l'échelle du document et présents dans un gabarit de fenêtre (aucun) ;
- champs de gabarit sans clé (3 sur 178, dont 2 dans un commentaire).