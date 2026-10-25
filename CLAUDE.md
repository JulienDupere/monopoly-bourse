# Monopoly Finance (« Monopoly Bourse »)

Registre financier web d'une partie de Monopoly enrichie de bourse (sociétés, actions, dividendes, REIT, options,
obligations, assurances, ventes à découvert, ABS, enchères…). Interface, réponses, commentaires et documentation
en français.

## Lire peu : chercher d'abord

Ne JAMAIS lire en entier `index.html` (~930 Ko, ~250 k jetons), `RESUME_ET_REGLES.md` (~60 Ko), son archive
`RESUME_ET_REGLES_ARCHIVE_227-300.md` (~565 Ko, ~150 k jetons) ni les fichiers de `docs/audit/` (le JSON fait 1,7 Mo). Chercher avec Grep (`-n`), puis lire l'extrait utile avec Read
`offset`/`limit`. Ne jamais se fier à un numéro de ligne noté quelque part : le retrouver par une recherche.

| Pour trouver… | Motif Grep | Fichier |
|---|---|---|
| une fonction | `^(async )?function nomFonction\(` | `index.html` |
| ses appels, ou un champ d'état | `nomFonction\(` ou `\.nomDuChamp\b` | `index.html` |
| le code d'une livraison | `Section 307` (commentaire posé sur chaque changement) | `index.html` |
| une section des règles | `^## 307\.` | glob `RESUME_ET_REGLES*.md` (fichier principal et archive) |
| le numéro de la dernière section | `^## [0-9]+\.` (dernier résultat) | `RESUME_ET_REGLES.md` |
| l'historique d'une mécanique | `^## .*découvert` (titres seulement) | glob `RESUME_ET_REGLES*.md` |
| un bogue de l'audit | `^#### 42\.` | `docs/audit/audit-2026-10-19.md` |

Seule exception : les sections 1 à 20 de `RESUME_ET_REGLES.md` (les ~310 premières lignes, ~20 Ko, avant le
titre `## 301.`) peuvent se lire d'un bloc quand on touche une règle de base.

## Infrastructure

| Élément | Valeur |
|---|---|
| Dépôt | `JulienDupere/monopoly-bourse` (public), branche `main`, aucun build : site statique d'un seul fichier |
| Production | https://monopoly-bourse.vercel.app et https://monopoly-finance.vercel.app (Vercel redéploie à chaque push sur `main`) |
| Base | Firebase Realtime Database, projet `monopolybourse`, données sous `data/<clé>`, partie partagée = clé `game:CODE` |

## Fichiers

- `index.html` : tout le code, à garder en un seul fichier sauf décision explicite. Dans l'ordre : SDK Firebase
  compat 10.14.1 et `window.__FIREBASE_CONFIG__`, CSS, coquille HTML minimale, puis un unique gros `<script>` final
  (JS vanilla, ~500 fonctions globales, tout le rendu en JS). Variante « légère » : peu de commentaires, beaucoup
  de lignes vides.
- `RESUME_ET_REGLES.md` : la bible. Sections 1–20 = concept, modèle de données, règles de base (§17 bogues déjà
  corrigés, §20 erreurs de raisonnement à éviter). Sections 301+ = une section par livraison. Sections 227–300
  archivées dans `RESUME_ET_REGLES_ARCHIVE_227-300.md` ; 21–226 dans `RESUME_ET_REGLES_ARCHIVE.md`, absent du dépôt. Les sous-titres « Code (`script_extracted.js`) » des
  anciennes sections désignent aujourd'hui le script d'`index.html`.
- `DEPLOY.md` : déploiement et historique des règles de sécurité Firebase. Son §2 décrit un ancien pipeline
  (`script_extracted.js`, `sync_script.py`, smoke tests) abandonné : ces fichiers n'existent plus.
- `docs/audit/audit-2026-10-19.md` : audit du moteur, 101 bogues numérotés par gravité décroissante (1–2 critiques,
  3–6 graves, 7–43 moyens, 44–101 faibles), puis « Questions de conception à trancher ». Verdicts détaillés dans le
  JSON voisin (Grep `"rank": 42,`). Au 2026-10-24 : 1–6 corrigés (section 307) ; 17, 32, 44, 57–60, 71–74
  corrigés (section 308, synchronisation) ; vague 2 : 8, 9, 13, 16, 33, 34, 35, 63
  (section 309, immobilier ; 64 voulu), 18–22, 30, 42, 70 (section 311, ABS et swaps), 10, 23, 24, 47, 50, 65
  (section 312, financement), 14, 15, 39, 40, 48, 49, 52 (section 313, assurance) ; vague 3 (2026-10-25) : 28, 29,
  46, 54 (section 310, REIT et lot commercial), 7, 11, 31, 36, 37, 38, 67, 75 (section 314, marché), 25–27, 41, 43,
  66, 68, 69, 80, 81 (section 315, cubes, dividendes, états), 55, 56, 76, 92, 100 (section 316, fin de partie),
  77–79, 82–91, 93–99, 101 (section 317, affichage et saisie). Tous les moyens et faibles du périmètre sont traités,
  sauf 12, 45, 51, 53, 61, 62 (écartés par Julien) et 64 (voulu).
- `docs/cahiers/` : neuf cahiers PDF de formation des joueurs et un aide-mémoire (index : `README.md`). Si une
  livraison change une mécanique qu'ils décrivent, le signaler à Julien (mises à jour en attente : rubriques
  « Changements visibles pour les joueurs » des sections 307 à 317).

## Repères dans le code (par nom)

- Constantes : `GROUPS`, `PROPERTY_DEFS`, `SPECIAL_SQUARES`, `FEATURE_LIST`, `DEFAULT_SETTINGS`.
- État : un seul objet global `state`, sérialisé en JSON. `createGame`, `loadGame`, `saveGame` (écriture atomique
  par `ref.transaction()`), `migrateState`.
- Persistance : `storageGet` / `storageSet` / `storageDelete` utilisent `window.storage` s'il existe (tests, mode
  local), sinon `localStorage` pour les clés non partagées, sinon Firebase après `await firebaseAuthReady()`.
- Synchro multi-appareils : `startPolling`, `applyRemoteStateIfNewer`, champ `state.version`. Toute action passe par
  `attemptActionWithRetry` (file, adoptée seulement si enregistrée, clé d'idempotence `state.appliedActionIds`) ou
  `runModalActionWithRetry` ; rendu sur valeur reçue : `renderPreservingForms` ; conditions affichées revérifiées :
  `confirmWithFreshConditions` (section 308).
- Rendu : `render()` → `renderTab()` → `renderPortefeuille`, `renderEntreprise`, `renderDevenirAssureur`,
  `renderProduitsMatrice`, `renderAdmin`… ; liste des onglets dans `visibleTabs()`.
- Tour de jeu : `rollDiceAndMove`, `performRollForAllCompanies`, `advanceGameClock`, `processYearEnd`.
- Marché : `executeShareTrade`, `placeBid` / `placeAsk` / `checkPendingOrders`, `drawStockCubes`, options
  (`blackScholesPremium`, `openOptionPosition`…), `enforceMarginCalls`.

## Règles impératives

- **Jamais de test contre la vraie base Firebase, le vrai Vercel ou le vrai GitHub** (DEPLOY.md §4). Tester en Node
  avec le banc ci-dessous, ou ouvrir `index.html` dans un navigateur avec un shim `window.storage` (mode local).
- **Firebase** : les règles exigent `auth != null` et l'app se connecte anonymement. Tout nouvel accès à la base
  attend d'abord `await firebaseAuthReady()`. Le bandeau `#firebaseAuthWarning` signale une connexion refusée.
- **Conservation de la monnaie** : toute opération laisse inchangée la somme banque + entreprises + joueurs
  (`cashTotal()` dans les tests). Plusieurs bogues passés créaient ou détruisaient de l'argent.
- **Nouveau champ d'état** = sa valeur par défaut dans `migrateState`, sinon les parties en cours cassent.
- **Scénario chiffré** obligatoire avant de déclarer un correctif réglé ; un chiffre surprenant n'est pas forcément
  un bogue (RESUME_ET_REGLES.md §20).
- Variables CSS historiques (`--board`, `--gold`, `--cream`, `--brick`…) : nom conservé, rôle changé (commentaire
  en tête du `<style>`).

## Tests

- `node tests/run-all.js` lance tous les `tests/*.test.js` (68 fichiers, 2 833 vérifications et 53 cas
  multi-appareils au 2026-10-25, après la vague 3 et les réponses de Julien). Banc multi-appareils : `tests/section308-sync.test.js` (faux serveur
  `tests/helpers/fake-firebase.js`, mini-DOM `tests/helpers/fake-dom.js` ; `SYNC_SEEDS=40` pour un passage long). Il charge
  tout le script d'`index.html`, donc une erreur de syntaxe le fait échouer. Tout doit passer avant un push.
- Syntaxe seule : `node -e "new (require('vm').Script)(require('./tests/helpers/engine').engineSource())"`.
- Nouveau test : banc `tests/helpers/engine.js` (usage dans son en-tête). `loadEngine()` charge le moteur dans un
  `vm` (faux DOM, `window.storage` en mémoire, aucun Firebase) ; `newGame(noms, types)` crée une partie et ses
  entreprises ; `run(code)` / `json(code)` évaluent dans le moteur et permettent de remplacer une fonction par un
  espion ; `cashTotal()` ; `check`, `near`. Options : `{ firebase }` (faux SDK, pour `saveGame`) et `{ transform }`
  (contre-épreuve : réintroduire l'ancien code et prouver que le test échoue). Modèles : `tests/audit-bug*.test.js`.

## Livraison

1. Coder dans `index.html`, avec un commentaire `Section NNN` sur chaque changement.
2. Ajouter un test `tests/sectionNNN.test.js` (ou `audit-bugN.test.js`) et lancer `node tests/run-all.js`.
3. Ajouter `## NNN.` à la fin de `RESUME_ET_REGLES.md` : demande verbatim de Julien, mécanique retenue, tests
   (modèle : section 307).
4. Montrer le résultat à Julien. Commit et `git push origin main` seulement avec son accord (pousser = mettre en
   production), puis vérifier que https://monopoly-bourse.vercel.app se charge.
