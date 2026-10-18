# Monopoly Bourse — déploiement

Ce document rassemble ce qu'on a établi ensemble sur l'architecture de déploiement de l'app. Certaines
sections sont confirmées (on en a discuté explicitement ou je les ai configurées avec toi), d'autres sont
marquées **à confirmer** parce que je n'ai jamais vu directement ton dépôt GitHub ni ta console Vercel/
Firebase dans une session — je ne veux pas inventer des détails que je n'ai pas vérifiés.

## 1. Architecture

- **Code source** : app web mono-fichier HTML/CSS/JS (pas de framework, pas de build step côté navigateur).
- **Dépôt GitHub** : `JulienDupere/monopoly-bourse`.
- **Hébergement** : Vercel, en ligne à <https://monopoly-finance.vercel.app>.
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

**À confirmer avec toi** : comment les fichiers livrés (`index.html`/`index_leger.html`) se rendent
concrètement jusqu'à ton dépôt GitHub aujourd'hui — upload manuel via l'interface web de GitHub, un autre
outil, ou autre chose? Dis-le-moi et je complète cette section avec les étapes exactes (et, si tu passes à
Claude Code, ce serait justement l'étape que ça automatiserait).

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

**Action en suspens — à vérifier/compléter** : pour que la règle `auth != null` fonctionne SANS casser
l'app (sans ça, plus personne ne peut lire/écrire), il faut :
- Activer l'authentification anonyme dans Firebase Console → Authentication → Sign-in method → Anonyme.
- Ajouter un appel `firebase.auth().signInAnonymously()` avant toute lecture/écriture, dans le fichier qui
  initialise Firebase pour l'app (probablement un petit fichier séparé de `script_extracted.js`, celui qui
  remplace `window.storage` en production).

Je n'ai pas encore vu ce fichier, donc je ne sais pas s'il contient déjà cet appel ou non. Si l'app
fonctionne toujours normalement en ligne depuis que tu as publié la règle `auth != null`, c'est probablement
déjà en place (ou Firebase l'ajoute par défaut dans ton SDK) ; si la synchronisation a cessé de fonctionner,
c'est très probablement ça qui manque — partage-moi ce fichier (ou le lien du dépôt) et je l'ajoute.

## 4. Précaution permanente — tests et démos

Règle déjà en place et à garder : **ne jamais utiliser le vrai GitHub, le vrai Vercel ou la vraie base
Firebase pour une démonstration ou un test** — toujours un bac à sable local, hors ligne, isolé de la
partie réellement déployée. Ça reste vrai peu importe l'outil utilisé pour travailler sur le projet
(Cowork aujourd'hui, ou Claude Code si tu migres).
