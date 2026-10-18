# Monopoly Finance (« Monopoly Bourse »)

Application web de jeu de société : un registre financier multijoueur pour une partie de Monopoly
enrichie de mécaniques boursières (sociétés, actions, dividendes, ETF, options, obligations,
assurances, ventes à découvert, enchères…). Interface en français.

## Infrastructure

| Élément | Valeur |
|---|---|
| Dépôt GitHub | `JulienDupere/monopoly-bourse` (public, branche `main`) |
| Production | https://monopoly-bourse.vercel.app (Vercel, déploiement automatique à chaque push sur `main`) |
| Base de données | Firebase **Realtime Database**, projet `monopolybourse` |
| Build | Aucun. Site statique, un seul fichier. |

## Structure du code

Tout le projet tient dans **`index.html`** (~20 000 lignes, ~900 Ko) :

- lignes 1–28 : chargement du SDK Firebase (compat 10.14.1) et `window.__FIREBASE_CONFIG__`
- lignes 29–394 : CSS (design system clair « façon Apple », variables dans `:root`)
- lignes 395–438 : HTML (coquille minimale, le reste est rendu en JS)
- lignes 439–20474 : JavaScript vanilla, ~550 fonctions au niveau global

Repères dans le JS :

- constantes de jeu en tête : `GROUPS`, `PROPERTY_DEFS`, `SPECIAL_SQUARES`, `FEATURE_LIST`, `DEFAULT_SETTINGS`
- persistance : `storageGet` / `storageSet` / `storageDelete` (Firebase RTDB sous `data/<clé>`)
- partie : `createGame`, `loadGame`, `saveGame`, `migrateState` (migration de l'état sauvegardé)
- synchro multi-appareils : `startPolling`, `applyRemoteStateIfNewer`, champ `state.version`
- rendu : `render()` puis `renderTab()` qui dispatche vers `renderPortefeuille`, `renderEntreprise`,
  `renderDevenirAssureur`, `renderProduitsMatrice`, `renderAdmin`… ; onglets listés dans `visibleTabs()`
- tour de jeu : `rollDiceAndMove`, `performRollForAllCompanies`, `advanceGameClock`, `processYearEnd`
- marché : `executeShareTrade`, `placeBid` / `placeAsk`, `drawStockCubes`, options (`blackScholesPremium`,
  `openOptionPosition`…), obligations, ventes à découvert, `enforceMarginCalls`

L'état complet de la partie est un seul objet `state` sérialisé en JSON dans Firebase. Toute modification
du schéma doit être accompagnée d'une migration dans `migrateState`.

## Conventions héritées

- Le projet a été construit dans une conversation Claude (hors Claude Code). Les commentaires font
  référence à des « Section NNN » (jusqu'à ~282) d'un document **`RESUME_ET_REGLES.md`** et à un
  **`DEPLOY.md`** qui ne sont **pas** dans le dépôt : ils vivaient dans l'ancienne conversation.
  Si Julien les fournit, les placer à la racine du dépôt.
- Les nombreuses lignes vides dans le JS sont des traces de commentaires supprimés : ne pas s'en inquiéter.
- Les noms de variables CSS historiques (`--board`, `--gold`, `--cream`…) ont été conservés mais
  leur rôle a changé lors de la refonte visuelle (voir le gros commentaire en tête du `<style>`).

## Travailler sur le projet

- Tester localement : ouvrir `index.html` directement dans le navigateur, ou servir le dossier
  (`npx serve .`). L'app parle à la vraie base Firebase de production : créer une partie de test
  plutôt que de toucher à une partie existante.
- Pas de linter ni de tests automatisés pour l'instant.
- Déploiement = `git push origin main`. Vérifier ensuite https://monopoly-bourse.vercel.app.
- Garder le fichier unique sauf décision explicite de découper (le découpage est un chantier à part).
- Répondre et commenter en français.
