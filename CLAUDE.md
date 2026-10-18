# Monopoly Finance (« Monopoly Bourse »)

Application web de jeu de société : un registre financier multijoueur pour une partie de Monopoly
enrichie de mécaniques boursières (sociétés, actions, dividendes, REIT, options, obligations,
assurances, ventes à découvert, ABS, enchères…). Interface en français.

## Documents de référence (à lire avant toute modification de règle)

- **`RESUME_ET_REGLES.md`** : la bible du projet. Sections 1–20 = concept, architecture, modèle de données,
  règles de base, erreurs de raisonnement à éviter. Sections 227+ = historique chronologique de chaque
  demande et correctif (une section par livraison, avec la demande verbatim de Julien, la mécanique
  retenue et les tests). **Toute nouvelle livraison ajoute une section numérotée à la suite** (dernière
  au 2026-10-18 : section 305).
- Les sections 21–226 sont dans `RESUME_ET_REGLES_ARCHIVE.md` (pas encore dans le dépôt).
- **`DEPLOY.md`** : architecture de déploiement et historique des règles de sécurité Firebase.

## Infrastructure

| Élément | Valeur |
|---|---|
| Dépôt GitHub | `JulienDupere/monopoly-bourse` (public, branche `main`) |
| Production | https://monopoly-bourse.vercel.app et https://monopoly-finance.vercel.app (même déploiement Vercel, automatique à chaque push sur `main`) |
| Base de données | Firebase **Realtime Database**, projet `monopolybourse`, données sous `data/<clé>` |
| Build | Aucun. Site statique, un seul fichier. |

### Authentification Firebase

Les règles RTDB exigent `auth != null` (DEPLOY.md §3). Depuis la section 305 (2026-10-18), l'app se
connecte anonymement via `firebaseAuthReady()` et **tout accès à la base doit l'attendre**
(`await firebaseAuthReady()` avant un appel SDK). L'authentification anonyme doit être activée dans la
console Firebase par Julien ; sinon le bandeau `#firebaseAuthWarning` s'affiche.

## Structure du code

Tout le projet tient dans **`index.html`** (~20 000 lignes, ~900 Ko). C'est la variante « légère »
(commentaires retirés, d'où les nombreuses lignes vides) de l'ancien pipeline décrit dans DEPLOY.md §2 ;
ce pipeline (`script_extracted.js`, `sync_script.py`, ~207 smoke tests) n'est pas dans le dépôt.

- lignes 1–28 : chargement du SDK Firebase (compat 10.14.1) et `window.__FIREBASE_CONFIG__`
- lignes 29–394 : CSS (design system clair « façon Apple », variables dans `:root`)
- lignes 395–438 : HTML (coquille minimale, le reste est rendu en JS)
- lignes 439–20474 : JavaScript vanilla, ~550 fonctions au niveau global

Repères dans le JS :

- constantes de jeu en tête : `GROUPS`, `PROPERTY_DEFS`, `SPECIAL_SQUARES`, `FEATURE_LIST`, `DEFAULT_SETTINGS`
- persistance : `storageGet` / `storageSet` / `storageDelete`. Trois backends dans cet ordre :
  `window.storage` s'il existe (ancien environnement Claude), sinon `localStorage` pour les clés non
  partagées, sinon Firebase pour l'état partagé de la partie (clé `game:CODE`), après `firebaseAuthReady()`.
- vérification avant push : extraire le script principal (`sed -n` entre le dernier `<script>` et le
  `</script>` final) et lancer `node --check` ; pour la logique testable, un script Node qui charge le bloc
  concerné dans un `vm` avec des dépendances simulées (exemple : section 305).
- partie : `createGame`, `loadGame`, `saveGame` (écriture atomique via `ref.transaction()`),
  `migrateState` (migration de l'état sauvegardé)
- synchro multi-appareils : `startPolling`, `applyRemoteStateIfNewer`, champ `state.version`
- rendu : `render()` puis `renderTab()` qui dispatche vers `renderPortefeuille`, `renderEntreprise`,
  `renderDevenirAssureur`, `renderProduitsMatrice`, `renderAdmin`… ; onglets listés dans `visibleTabs()`
- tour de jeu : `rollDiceAndMove`, `performRollForAllCompanies`, `advanceGameClock`, `processYearEnd`
- marché : `executeShareTrade`, ordres en attente `placeBid` / `placeAsk` / `checkPendingOrders`,
  `drawStockCubes`, options (`blackScholesPremium`, `openOptionPosition`…), obligations, ventes à
  découvert, `enforceMarginCalls`

L'état complet de la partie est un seul objet `state` sérialisé en JSON dans Firebase. **Tout nouveau
champ doit avoir sa ligne par défaut dans `migrateState`** pour ne pas casser les parties en cours.

## Règles de travail (héritées, à respecter)

- **Ne jamais tester contre la vraie base Firebase, le vrai Vercel ou le vrai GitHub** (DEPLOY.md §4).
  Pour un test local : ouvrir `index.html` dans le navigateur avec un shim `window.storage` injecté
  (l'app bascule alors en mode local), ou tester la logique pure avec des scripts Node.
- Vérifier une correction avec un scénario chiffré concret avant de la déclarer réglée
  (RESUME_ET_REGLES.md §20). Un chiffre « surprenant » n'est pas forcément un bug.
- Conserver la monnaie : toute transaction doit laisser la somme des encaisses inchangée
  (plusieurs correctifs passés portaient sur de l'argent créé ou détruit).
- Garder le fichier unique sauf décision explicite de découper.
- Les noms de variables CSS historiques (`--board`, `--gold`, `--cream`…) ont été conservés mais leur
  rôle a changé lors de la refonte visuelle (voir le gros commentaire en tête du `<style>`).
- Déploiement = `git push origin main`, puis vérifier https://monopoly-bourse.vercel.app.
- Répondre, commenter et documenter en français.
