# Monopoly Bourse — déploiement

Ce document rassemble ce qu'on a établi ensemble sur l'architecture de déploiement de l'app. Certaines
sections sont confirmées (on en a discuté explicitement ou je les ai configurées avec toi), d'autres sont
marquées **à confirmer** parce que je n'ai jamais vu directement ton dépôt GitHub ni ta console Vercel/
Firebase dans une session — je ne veux pas inventer des détails que je n'ai pas vérifiés.

## 1. Architecture

- **Code source** : app web mono-fichier HTML/CSS/JS (pas de framework, pas de build step côté navigateur).
- **Dépôt GitHub** : `JulienDupere/monopoly-bourse`.
- **Hébergement** : Vercel, en ligne à <https://monopoly-bourse.vercel.app> (alias :
  <https://monopoly-finance.vercel.app>, même déploiement). Redéploiement automatique à chaque push sur `main`.
- **État de partie partagé** : Firebase Realtime Database — remplace, en production, l'API `window.storage`
  utilisée pendant le développement dans l'environnement Claude. Synchronisation en temps réel confirmée
  fonctionnelle entre les appareils des joueurs.
- **Aucun système de compte joueur** : les joueurs s'identifient par leur nom seulement, sans mot de passe.
  C'est le créateur de la partie (une notion gérée par l'app elle-même, pas par un vrai login) qui a accès
  à certains contrôles (changer de tour, ouvrir/fermer les achats d'assurance, etc.).

## 2. Fichiers sources et pipeline de build/test (côté Claude)

Le fichier de travail canonique est `script_extracted.js` (tout le JS de l'app). Il est ensuite synchronisé
dans 4 fichiers HTML via `sync_script.py` :

| Fichier               | Contenu                                      |
|-----------------------|-----------------------------------------------|
| `index.html`          | Version commentée (copie de travail)          |
| `monopolybourse.html` | Identique à `index.html` (doc du Projet)      |
| `index_leger.html`    | Version sans commentaires ("légère")          |
| `monopolybourse_leger.html` | Identique à `index_leger.html` (doc du Projet) |

Avant toute livraison : `node -c script_extracted.js` (vérification de syntaxe), puis la suite complète de
smoke tests (plus de 200 fichiers `smoke_test_*.js`) relancée **3 fois consécutives sans aucun échec**, puis
`python3 sync_script.py`, puis vérification que les paires de fichiers sont bien identiques (md5sum).

**Mise à jour 2026-10-18 — passage à Claude Code.** Le pipeline ci-dessus est historique. Désormais :
le dépôt est cloné localement dans `Desktop/Application CLAUDE/Monopoly Finance`, `index.html` (variante
« légère », sans les gros commentaires) est l'**unique fichier source**, les modifications sont commitées
et poussées directement sur `main` depuis Claude Code, et Vercel redéploie automatiquement. Avant chaque
push : `node --check` sur le script extrait d'`index.html`, et tests Node avec SDK simulé quand la logique
s'y prête (voir CLAUDE.md). Les anciens uploads manuels via l'interface GitHub (« Add files via upload »)
ne sont plus nécessaires.

## 3. Règles de sécurité — Firebase Realtime Database

Historique de ce qu'on vient de régler ensemble :

1. **Avertissement initial (danger)** : règles grandes ouvertes (`.read`/`.write` à `true` pour tout le
   monde, y compris des robots qui scannent le web).
2. **Correctif appliqué** : règles changées pour exiger une authentification —

   ```json
   {
     "rules": {
       ".read": "auth != null",
       ".write": "auth != null"
     }
   }
   ```

   Publié dans Firebase Console → Realtime Database → Règles.
3. **Avertissement résiduel (attention, pas danger)** : Firebase signale que « n'importe quel utilisateur
   authentifié » a accès à tout — normal et attendu pour une app sans distinction de permissions entre
   joueurs (ils doivent tous pouvoir lire/écrire le même état de partie).

**Résolution (2026-10-18, section 305 de RESUME_ET_REGLES.md).** Vérification faite : l'app ne
s'authentifiait pas (aucun SDK Auth chargé), et une lecture REST anonyme renvoyait `401 Permission denied` —
la sauvegarde et la synchro étaient donc cassées en production depuis la publication de la règle.
Correctif côté code livré : `firebase-auth-compat.js` chargé dans le `<head>`, et `firebaseAuthReady()`
(connexion anonyme, session persistée réutilisée) attendue avant chaque accès à la base. Un bandeau
« Connexion à Firebase refusée » s'affiche si la connexion échoue.

**Côté console (fait par Julien le 2026-10-18)** : Authentication → Sign-in method → fournisseur
**Anonyme** activé, avec le nettoyage automatique des comptes anonymes de plus de 30 jours (sans
conséquence : rien n'est rattaché à l'UID, l'app recrée une session au besoin). Vérifié en ligne le même
jour : connexion anonyme OK, lecture de la base OK, aucun bandeau d'erreur, et la session est bien réutilisée
d'un rechargement à l'autre. Si l'erreur `auth/admin-restricted-operation` réapparaît un jour, vérifier ce
fournisseur et, dans Authentication → Settings → User actions, que « Enable create (sign-up) » est coché.

## 4. Précaution permanente — tests et démos

Règle déjà en place et à garder : **ne jamais utiliser le vrai GitHub, le vrai Vercel ou la vraie base
Firebase pour une démonstration ou un test** — toujours un bac à sable local, hors ligne, isolé de la
partie réellement déployée. Ça reste vrai peu importe l'outil utilisé pour travailler sur le projet
(Cowork aujourd'hui, ou Claude Code si tu migres).
