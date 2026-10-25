# Monopoly Finances — Résumé complet du projet

Ce document résume l'application "monopoly-bourse.html" (renommée "Monopoly Finances" dans
l'interface depuis le 4e playtest) pour permettre de reprendre le développement dans une
nouvelle conversation avec Claude, sans devoir tout réexpliquer.

**Pour démarrer une nouvelle conversation :** uploadez `monopoly-bourse.html` et ce fichier,
puis dites simplement "Voici mon application Monopoly Finances en cours de développement,
lis le résumé joint pour comprendre le contexte avant qu'on continue." (Ce projet Claude
contient aussi une copie à jour des deux fichiers, donc une nouvelle conversation dans ce
même projet peut y accéder directement sans upload.)

---

## 1. Concept général

Application web autonome (un seul fichier HTML/CSS/JS, aucune dépendance externe) qui
remplace le classeur Excel utilisé pour gérer les aspects financiers d'une partie de
Monopoly jouée physiquement autour d'une table, chaque joueur ayant son propre ordinateur.
L'état de la partie est partagé entre tous les appareils via `window.storage` (clé
`game:{CODE}` à 4 lettres, sondage toutes les 3 secondes). Le plateau physique et les
dés restent réels — l'app ne fait que la comptabilité financière et les calculs actuariels.

## 2. Architecture technique

- **Fichier unique** : HTML + CSS + JS inline, aucune dépendance.
- **État partagé** : `window.storage.get/set('game:CODE', ..., shared=true)`.
- **`state.creatorId`** = premier joueur = administrateur de la partie (seul à pouvoir
  regrouper des lots, notamment).
- **`migrateState(s)`** : fonction de rétrocompatibilité — chaque nouveau champ ajouté
  au fil du développement DOIT y avoir une entrée `if(s.x===undefined) s.x = valeurParDéfaut`
  pour que les parties déjà en cours ne cassent pas au rechargement.
- **`freshProperties()`** : génère les 28 terrains à partir de `PROPERTY_DEFS`.
- Tous les montants internes sont en **M$** (millions), affichés automatiquement en
  **K$** si `< 1M` via la fonction `fmt()`.

## 3. Paramètres de partie (fixés à la création, dans `state.settings`)

| Paramètre | Défaut | Description |
|---|---|---|
| `insuranceMarkup` | 25% | Majoration de profit banque (assurances, rachat) |
| `discountRate` / `growthRate` | 10% / 2% | Taux d'actualisation / croissance des loyers (valeur intrinsèque) |
| `mortgageLTV` | 50% | % de la valeur empruntable en hypothèque |
| `mortgageRate` | 17% | Taux d'intérêt hypothécaire de base |
| `mortgageRentContinues` | false | Le loyer continue-t-il pendant une hypothèque active? |
| `liquidationPenalty` | 0% | Pénalité additionnelle SEULEMENT sur le rachat/liquidation |
| `debtSpreadFactor` | 50% | Prime de risque max ajoutée au taux si 100% endetté |
| `marginMultiple` | 2 | Multiple d'appel de marge boursière |
| `maxOwners` | 3 | Nombre max de copropriétaires simultanés par terrain |
| `jailTurns` | 3 | Tours à purger avant sortie de prison gratuite |
| `jailBailCost` | 0.5 (500K) | Coût de la caution pour sortie immédiate |
| `bankCollectsRent` | true | La banque perçoit-elle un loyer sur sa propre part d'un terrain? |
| `neutralPawnCapsAtGo` | false | Voir section 11 — modèle de risque du pion neutre |
| `sharesPerPlayer` | 1000 | Nombre de parts boursières émises par joueur |
| `riskFreeRate` | 3% | Taux de l'actif sans risque en bourse |
| `goAdvanceRate` | 10% | Taux d'actualisation du marché à terme GO |
| `rentCompensationFee` | 0.25 (250K) | Frais fixe à la signature d'un accord de compensation de loyer (par joueur) |
| `loanWithholdingPct` | 20% | Voir section 23 — % de tous les loyers reçus par l'emprunteur, retenu et versé au prêteur |
| `loanRepaymentMultiple` | 1.5 | Voir section 23 — multiple du capital à rembourser (via les retenues) pour qu'elles s'arrêtent |
| `loanMaxPrincipal` | 5 (5M$) | Voir section 23 — montant maximal empruntable par prêt |
| `linearRent` | false | Voir section 22 — loyer linéaire (au lieu d'exponentiel) sur les terrains de couleur |
| `housesBeforeHotel` | 4 | Nombre de niveaux de maison avant l'hôtel — n'a d'effet qu'avec `linearRent` (section 22) |
| `features.*` | tous `true` | Activation/désactivation de chaque sous-système |

## 4. Modèle de valorisation des terrains

- **Prix plancher (`basePrice`)** : le prix normal du Monopoly classique, fixe.
- **Prix d'acquisition (`acquisitionPrice`)** : mis à jour à CHAQUE achat direct ou
  enchère remportée — représente ce qui a été réellement payé.
- **Valeur intrinsèque (`intrinsicValue(p)`)** : DCF (perpétuité croissante) des loyers
  futurs + moitié du prix plancher (valeur d'hypothèque), **plancher au prix d'acquisition**
  (jamais en dessous de ce qui a été payé).
- **Valeur de rachat (`buybackValue(p)`)** : `intrinsicValue × (1 − markup) × (1 − liquidationPenalty)`.
- **Valeur immobilière d'un joueur** (`realEstateValue`) : utilise la **valeur intrinsèque**
  (pas le rachat) — décision explicite de l'utilisateur.
- **Valeur nette d'un joueur** (`netWorth`) = encaisse + valeur immobilière + valeur boursière.
- ⚠️ **Piège de circularité déjà résolu** : le prix d'une action (`companyValue`/`sharePrice`)
  utilise SEULEMENT encaisse + immobilier (jamais la valeur boursière du joueur), sinon
  boucle infinie avec `netWorth`.
- **Regroupement en lot** : pondération basée sur le **prix plancher (`basePrice`)**, PAS
  la valeur intrinsèque (pour éviter qu'un joueur ayant surenchéri à l'achat n'obtienne
  une part disproportionnée du lot).

## 5. Copropriété et parts

- Jusqu'à `maxOwners` copropriétaires par terrain (`p.owners = [{playerId, share}]`).
- **"No free lunch"** : un copropriétaire qui visite son propre terrain paie la part des
  AUTRES copropriétaires (jamais la sienne).
- **Regroupement de lot** (`groupMergeId`) : une fois qu'un groupe de couleur/aéroports/
  services est 100% possédé par des joueurs, l'admin peut le regrouper — toutes les
  propriétés du groupe partagent alors les MÊMES parts (synchronisées). Maisons et loyer
  restent individuels par terrain à l'intérieur du lot. Payer le loyer sur un lot demande
  d'abord quel terrain précis a été visité.
- **Échange de parts** (`executeShareSwap`/`tradableAssets`) : les joueurs peuvent échanger
  des parts entre deux actifs (terrain individuel OU lot entier, traité comme une seule unité).

## 6. Loyers — aéroports et services (règle par palier individuel)

**Important : ce n'est PAS une simple part proportionnelle du loyer total.**
Pour un aéroport/service visité, CHAQUE copropriétaire applique SON PROPRE palier
personnel (déterminé par le nombre total d'aéroports/services qu'IL détient, tous
terrains confondus), pondéré par SA part sur le terrain visité précis, puis on additionne :

```
contribution(copropriétaire) = tarif_selon_SON_nombre_total_d_aéroports × sa_part_%_sur_CE_terrain
```

- Aéroports : 1/2/3/4 détenus → 250K/500K/1M/2M.
- Services : 1/2 détenus → 40K×dés / 100K×dés.
- Fonction clé : `groupRentSettlement(p, visitorId, diceSum)`.
- Une fois un lot d'aéroports/services complet regroupé, tout le monde compte
  automatiquement 4 aéroports détenus (palier max) — conséquence naturelle du regroupement.

## 7. Maisons

- Construction possible **SEULEMENT sur un terrain regroupé en lot** (pas sur un terrain seul).
- Coût **fixe selon le groupe de couleur** (pas progressif selon le nombre de maisons) :
  Brun/Bleu pâle 500K, Rose/Orange 1M, Rouge/Jaune 1,5M, Vert/Bleu foncé 2M.
- Coût réparti automatiquement entre les copropriétaires selon leurs parts actuelles,
  avec popup de confirmation. Fonction : `buildHouse(pid)`.
- Retrait de maison (`removeHouse`) toujours gratuit, sans restriction de lot.
- **Voir section 22** pour l'option "loyer linéaire" (remplace la progression
  exponentielle classique du loyer par niveau de construction) et le nombre de niveaux
  de maison avant l'hôtel configurable (4 par défaut).

## 8. Hypothèques

- **Par part individuelle**, pas par terrain entier : chaque copropriétaire peut
  hypothéquer SA part indépendamment des autres (`p.mortgages = [{ownerId, principal,
  rate, lenderId}]`, tableau, pas un objet unique).
- **Terrain seul (hors lot)** : montant = `prix_de_base × sa_part_% × mortgageLTV`
  (valeur NORMALE du Monopoly, PAS la valeur intrinsèque).
- **Lot regroupé** : montant = `valeur_intrinsèque_du_LOT_ENTIER × sa_part_% × mortgageLTV`
  (fonctions séparées `maxMortgageLot`/`issueMortgageLot`/`repayMortgageLot`).
- Prêteur = banque ou un autre joueur.
- **Emprunt possible à tout moment**, mais **remboursement seulement quand la bourse
  est ouverte** (`state.stockMarket.tradingOpen`) — simplification demandée par l'utilisateur.
- Part hypothéquée : aucun loyer perçu par défaut (sauf option `mortgageRentContinues`).
- Défaut de paiement d'intérêt → saisie de la part par le prêteur (sur tous les terrains
  du lot si c'est une hypothèque de lot).

## 9. Prison

- `player.inJail`, `player.jailTurnsLeft`.
- Boutons dans l'onglet Banque : Mettre en prison / Purger un tour / Payer caution.
- **Aucun loyer collecté** pour un propriétaire en prison — sa part est EXCLUE du calcul
  payable (le visiteur ne paie pas cette portion), avec une ligne à 0$ « (en prison) »
  dans le registre de transactions pour que ce soit visible.
- **Exception importante** : pour les COTATIONS D'ASSURANCE, l'exposition assurable
  INCLUT quand même les parts des joueurs en prison (raisonnement : ils peuvent sortir
  à tout moment, donc c'est un vrai risque pour l'assureur). Géré dans `payableRent()`.

## 10. Assurances (terrains + cases taxes + paquets Chance/Chess)

- **Modèle de risque** : `expectedLandingsPerYear(offset)` = espérance du NOMBRE de fois
  qu'on tombe sur une case (pas juste la probabilité d'au moins une fois) — corrige un
  biais découvert où les sinistres multiples dans une même année n'étaient pas comptés.
- **Deux modes de couverture au choix, par contrat** (`claimMode`) :
  - `recurring` : chaque passage est couvert (prime basée sur l'espérance du nombre de fois).
  - `single` : un seul sinistre par terrain couvert, la couverture se consomme après
    (prime basée sur `lapLandingProbability`, probabilité d'au moins une fois).
- **Contrats groupés** (`state.taxInsurances`, `p.insurance.contractId`) : un joueur peut
  sélectionner PLUSIEURS cases (terrains + taxes) en une seule action ; si assignées au
  même vendeur, ça forme un seul contrat ; sinon plusieurs contrats (un par vendeur).
- **Cases taxes assurables** : Impôt sur le revenu = min(10% valeur entreprise, 2M),
  Taxe de luxe = 1M fixe.
- **Franchise** (`state.currentDeductible`) réduit le risque assuré.
- Affichage des lignes : `"{Nom} : {prob}% de probabilité de sinistre. {exposure} à risque."`
- Bouton « Piger une carte » retiré (les joueurs pigent physiquement maintenant) —
  `applyCardDraw`/`modalDrawCard` supprimés du code.
- **Note (voir section 21)** : les parts couvertes par un accord de compensation de loyer
  actif contournent l'assurance pour ce passage précis (aucun cash ne bouge, donc rien
  à assurer sur cette portion).

## 11. Pion neutre & Obligations catastrophe

- Le pion neutre (`state.neutralPawn.totalDistance`) avance manuellement (admin entre
  la somme des dés). Une "année" = 40 cases parcourues.
- **`lapLandingProbability(offset)`** : modèle de marche circulaire (PAS un simple arrêt
  au premier passage de 40) — une case proche a un risque non-nul car le pion peut
  dépasser un tour complet et reboucler dessus.
- **Option `neutralPawnCapsAtGo`** : si activée, le pion termine TOUJOURS son année pile
  sur GO (dernier jet plafonné manuellement par l'admin). Conséquence structurelle : la
  case juste après GO (Brun 1) devient IMPOSSIBLE à atteindre (jet minimum = 2, position
  ne fait que croître dans l'année). Utilise `yearNoHitProbabilityCapped`. Par défaut
  désactivée (modèle classique).
- **Obligations catastrophe** (`state.catBonds`) : entente entre **2 JOUEURS SEULEMENT**
  (jamais la banque). Déclenchement basé sur la position du **pion neutre** (pas les
  joueurs), vérifié à CHAQUE avancée (`checkCatBondTriggers`), pas seulement en fin
  d'année. Durée toujours 1 an. Coupon fixé exactement au point mort actuariel
  (`p/(1-p)`, sans majoration). Source de financement au choix : encaisse boursière OU
  encaisse de jeu (`fundSource: 'stock'|'cash'`). Si déclenché : capital perdu, conservé
  par la contrepartie. Sinon à l'échéance : capital + coupon versé par la contrepartie.
- **Calcul de probabilité pour plusieurs terrains** : vraie chaîne de Markov à absorption
  multiple (PAS une hypothèse d'indépendance entre terrains, qui sous-estime le risque
  quand les cases suivies sont proches les unes des autres).
- **Point d'accroche pour tout traitement de fin d'année** : `advanceNeutralPawn()`, dans
  la boucle `for(let i=0;i<(after-before);i++){...}` — c'est ici que sont traités les
  intérêts hypothécaires, les obligations catastrophe, les dividendes REIT, la décrémentation
  des swaps de loyers, et depuis la section 21, le règlement des accords de compensation
  de loyer.

## 12. Swaps de loyers

- Deux joueurs échangent les revenus de deux terrains (ou lots) pour une durée
  déterminée, avec un plafond optionnel **par événement, PAS cumulatif** :
  - Si la part due ≤ plafond → toute la part part chez le partenaire.
  - Si la part due > plafond → seul le plafond est redirigé, le propriétaire garde
    la différence.
  - Les deux côtés peuvent avoir des plafonds différents (asymétrique).
- **Règles anti-remboursement de soi-même** (`swapSplit`) :
  - Si le visiteur EST le propriétaire (auto-visite) → aucun effet du swap, "no free
    lunch" s'applique normalement.
  - Si le visiteur EST le partenaire du swap → aucune redirection (sinon il se
    rembourserait une partie de ce qu'il vient de payer).
  - Sinon (tiers) → la redirection s'applique normalement selon le plafond.
- **Interaction avec la section 21** : `swapSplit` s'applique D'ABORD (détermine le
  bénéficiaire final d'une part), PUIS la vérification d'accord de compensation se fait
  entre le visiteur et ce bénéficiaire final — les deux mécanismes se composent proprement.

## 13. Bourse

- Portefeuille séparé et étanche (`stockCash`), 5M$ de départ, ne peut PAS servir à
  payer des dettes du plateau principal.
- Achat/vente/court/couverture d'actions d'un joueur, actif sans risque.
- **Prix d'une action** (`sharePrice`) = `companyValue(joueur) / sharesPerPlayer`, où
  `companyValue` = encaisse + immobilier SEULEMENT (jamais la valeur boursière, pour
  éviter la circularité — voir section 4).
- Appels de marge automatiques si l'exposition à découvert dépasse `equity × marginMultiple`.

## 14. REIT (fonds immobilier)

- Un groupe 100% possédé peut être converti en REIT : parts distribuées selon l'apport
  pondéré (valeur de rachat au moment de la conversion), négociables en bourse séparée.
- **Dividendes automatiques** : à chaque passage d'année, 100% de la caisse accumulée du
  fonds est distribuée aux détenteurs de parts au prorata (`processReitDividends`),
  versée dans leur encaisse boursière.

## 15. Registre de transactions

- Chaque mouvement d'argent (loyer, achat, hypothèque, assurance, bourse, etc.) est
  enregistré avec un détail débit/crédit structuré (`log(text, entries)`), affiché dans
  l'onglet Transactions et dans des popups de confirmation.
- Les propriétaires en prison apparaissent avec une ligne à 0$ « (en prison) » pour
  transparence, même s'ils ne reçoivent rien.
- Les parts déviées vers un accord de compensation de loyer (section 21) apparaissent
  de la même façon, avec une ligne à 0$ « (compensation, inscrit au registre) », plus une
  ligne de journal séparée indiquant la nouvelle balance du contrat.

## 16. Mode spectateur (écran TV)

- Un appareil peut rejoindre en lecture seule (`isSpectator`), sans identité de joueur,
  avec des diapositives qui défilent automatiquement (classement, année, faits
  marquants, records, bourse).

## 17. Bugs déjà trouvés et corrigés (pour référence, éviter de les réintroduire)

- `issueMortgage`/`repayMortgage` (terrain individuel) avaient complètement disparu du
  fichier lors d'une édition — restaurés et testés.
- `swapRecipient` (ancienne fonction) référencée mais supprimée ailleurs — remplacée
  par `swapSplit` partout, y compris dans `modalPayRent` qui utilisait encore l'ancien nom.
- Bouton fantôme `data-auction` sans élément HTML correspondant — nettoyé.
- La valeur d'exposition assurable pour aéroports/services utilisait l'ancienne formule
  à un seul propriétaire au lieu du calcul par palier individuel — corrigé dans
  `payableRent`.

## 18. Comment auditer à nouveau si des bugs sont suspectés

Un script de test de fumée a été utilisé pour valider l'ensemble des fonctionnalités
en simulant une partie complète (4 joueurs, terrains variés, toutes les actions
principales) et en interceptant les erreurs. Approche recommandée pour une nouvelle
conversation si des doutes surgissent :
1. Extraire le JS du fichier HTML (`<script>...</script>`).
2. Vérifier la syntaxe (`node --check`).
3. Chercher les fonctions dupliquées et les appels vers des fonctions non définies.
4. Simuler une partie complète en Node.js en appelant chaque fonction majeure avec des
   données réalistes, et intercepter les exceptions. Pour tester des flux qui passent par
   des modals DOM (ex: `modalPayRent`), utiliser `vm.createContext` avec un DOM factice
   (registre d'éléments persistant par id) plutôt qu'un simple `eval()` — les déclarations
   `let`/`const` top-level du script (`state`, etc.) ne survivent pas à un `eval()` isolé.

## 19. Ce qui reste éventuellement à faire / pistes ouvertes

- Aucune tâche explicitement laissée en suspens au moment de la rédaction de ce résumé.
- Si l'utilisateur mentionne un problème, toujours vérifier D'ABORD si c'est vraiment un
  bug ou un comportement attendu selon les règles ci-dessus (plusieurs "bugs" rapportés
  se sont avérés être des malentendus sur des mécaniques déjà en place — voir section 20).

## 20. Erreurs de raisonnement à éviter

- Ne pas supposer qu'un chiffre "surprenant" est un bug sans vérifier le calcul exact
  d'abord (position du pion neutre, palier individuel, etc.) — plusieurs fois dans ce
  projet, un calcul "étrange" s'est avéré parfaitement correct une fois vérifié.
- Toujours tester une correction avec un scénario concret AVANT de la présenter comme
  réglée — le calcul manuel de l'utilisateur est souvent la meilleure façon de valider.
- Toujours copier le fichier vers `/mnt/user-data/outputs/` (ou l'équivalent selon
  l'environnement Claude utilisé) et le republier après CHAQUE changement, sinon
  l'utilisateur télécharge une version obsolète.


---

**Note (archivage, 2026-09-10) :** pour garder ce document sous la limite de taille du Project
claude.ai, les sections chronologiques 21 à 226 (historique détaillé de chaque demande/correctif, du
22 août au 6 septembre 2026) ont été déplacées dans un document séparé :
[`claude/RESUME_ET_REGLES_ARCHIVE.md`](RESUME_ET_REGLES_ARCHIVE.md), dans le même Project. Ce fichier-ci
conserve les sections de référence (1 à 20 — concept, architecture, modèle de données, règles de jeu de
base) et reprend la numérotation chronologique à partir de la section 227 (7 septembre 2026 et plus
récent). Pour retrouver un correctif antérieur à la section 227, consulter l'archive.

**Note (archivage, 2026-10-20) :** les sections 227 à 300 ont été déplacées
telles quelles dans [`RESUME_ET_REGLES_ARCHIVE_227-300.md`](RESUME_ET_REGLES_ARCHIVE_227-300.md), dans le dépôt.
Ce fichier-ci reprend à la section 301.

---

## 301. Ordres en attente (bid/ask) — trading joueurs, exécution automatique au déclenchement

Demande explicite de l'utilisateur, verbatim : « Possible d'ajouter au achat d'action un cours acheteur
(bid) et cours vendeur (ask) mettre une section dans mes positions qui représente les bid en attente. Et
une option sur les action détenu pour ajouter un ask quand elle sont dans mes positions. Si le cours de
l'action frappe et dépassé le bid tu rammase le stock a ce prix ou vend a ce prix ».

**Clarifications obtenues** (questions posées avant l'implémentation, vu l'ampleur de la fonctionnalité) :

- Réservation des ressources : « Pour un bid, qui s'exécute tu peux utiliser l'argent des bons
  gouvernementaux ou l'encaisse. S'il manque d'argent order partiel fill. Pour le ask tu le met sur une
  action que tu possède donc pas d'enjeu. Pour un découvert bien tu n'as pas besoin d'encaisse c'est la
  marge et ça c'est à toi de bien gérer. » — aucune réservation au PLACEMENT ; au DÉCLENCHEMENT, un bid
  puise l'encaisse PUIS les bons gouvernementaux pour combler le manque, et REMPLIT PARTIELLEMENT si même
  la somme des deux est insuffisante (jamais un échec pur) ; un ask se plafonne symétriquement à ce qui est
  ENCORE détenu au moment du déclenchement.
- Nombre d'ordres simultanés : « Plusieurs bids/asks empilés » — aucune limite, y compris plusieurs ordres
  sur la MÊME entreprise à des prix différents.
- Expiration : « Jamais d'expiration automatique » — un ordre reste actif jusqu'à exécution (même
  partielle) ou annulation manuelle par le joueur.
- Impact de marché : « Oui, comme un trade normal (recommandé) » — un fill déclenché injecte les cubes
  d'impact de marché exactement comme un achat/une vente manuel (vert/rouge).

**Mécanique.** Un bid = cours acheteur + quantité de parts, déclenché quand `company.stockPrice` descend AU
NIVEAU du prix limite ou EN DESSOUS. Un ask = cours vendeur + quantité, déclenché quand le prix MONTE au
niveau du prix limite ou AU-DESSUS — « frappe et dépassé » dans les deux sens. Un fill s'exécute TOUJOURS au
PRIX DE L'ORDRE (le cours acheteur/vendeur fixé par le joueur), jamais au prix de marché qui a déclenché
(« tu ramasses le stock à CE PRIX »). Vérifié à CHAQUE lancer, pour CHAQUE compagnie, juste après
`resolveStockDraws()` (le prix fraîchement résolu de ce tirage) — les autres événements plus rares qui
mutent aussi `company.stockPrice` (retournement de tendance Momentum, choc du prêt de dernier recours) ne
posent pas de vérification dédiée : un ordre encore qualifié sera de toute façon rattrapé au prochain
tirage, puisqu'il n'expire jamais. Aucune compétition de priorité entre joueurs n'est nécessaire : la
banque reste la contrepartie ÉLASTIQUE de chaque trade (comme pour tout achat/vente ordinaire) — chaque
ordre qualifié est donc traité indépendamment.

**Implémentation.** `executeShareTrade()` gagne un paramètre optionnel `_priceOverride` (6e argument, jamais
exposé à l'UI directement) : s'il est fourni, le trade s'exécute à ce prix plutôt qu'à
`company.stockPrice||0` — c'est le SEUL changement à cette fonction, tout le reste (calcul de la quantité,
coût moyen pondéré, exemption du flottant IPO, injection de cube, P&L réalisé, délai de grâce
banque-propriétaire-à-100%) est réutilisé TEL QUEL, sans duplication de code, pour qu'un fill se comporte en
tout point comme un trade manuel (sauf le prix d'exécution). Nouvelles fonctions : `placeBid`/`placeAsk`
(mêmes gardes qu'un achat/une vente ordinaire — fenêtre de trading au placement, délit d'initié CEO, IPO
financée — plus la garde de détention réelle pour `placeAsk`) ; `cancelBid`/`cancelAsk` (retrait simple,
aucune ressource à restituer puisque rien n'est réservé) ; `fillPendingBid`/`fillPendingAsk` (calcul du
remplissage, complet ou partiel, puis délégation à `executeShareTrade` avec `_priceOverride`) ;
`checkPendingOrders(company)` (point d'entrée appelé depuis `advanceGameClock`, juste après
`resolveStockDraws`, pour CHAQUE compagnie à CHAQUE lancer — parcourt tous les joueurs, exécute chaque ordre
qualifié, journalise chaque fill via `log()`). Nouveaux champs par joueur : `pendingBids`/`pendingAsks`
(tableaux, comme `optionPositions` — un joueur peut empiler plusieurs ordres), initialisés à `[]` dans
`createGame()` et par défaut différé dans `migrateState()` pour une sauvegarde déjà en cours.

**Interface.** Portefeuille, menu ☰ Actions : nouveau groupe « Ordres en attente » avec les boutons
« 🎯 Placer un bid » (`modalPlaceBidOrder` — sélecteur de compagnie + prix limite + quantité en $ ou en
parts, converti au PRIX LIMITE saisi, jamais le prix courant) et « 🎯 Placer un ask » (`modalPlaceAskOrder`,
optionnellement pré-rempli avec une compagnie donnée — sélecteur restreint aux compagnies où je détiens
réellement des parts). Nouveau bouton « 🎯 Ask » sur chaque ligne de la table « Positions longues », ouvrant
`modalPlaceAskOrder` pré-rempli avec cette compagnie (« une option sur les actions détenues », demande
explicite de l'utilisateur). Nouvelle sous-section « Ordres en attente » dans « MES POSITIONS », juste après
« Positions longues » — deux tables (bids/asks encore actifs, avec leur quantité RÉSIDUELLE — un ordre
partiellement rempli continue d'y apparaître) et un bouton Annuler par ligne, masquée entièrement si aucun
ordre n'est en attente (même convention masqué-si-vide que le reste de cette section).

Noms de fonctions `modalPlaceBidOrder`/`modalPlaceAskOrder` (et non `modalPlaceBid`/`modalPlaceAsk`) :
collision évitée avec l'ancien sous-système d'enchère de terrain legacy (`modalPlaceBid`, retiré à la
section 30), dont un smoke test existant vérifie explicitement l'absence totale du code.

**Tests.** Nouveau fichier dédié `smoke_test_step301_bid_ask_orders.js` (10 sous-tests : gardes de
placement bid/ask, empilement de plusieurs ordres, annulation, remplissage complet bid/ask au prix DE
L'ORDRE avec injection de cube vert/rouge, remplissage PARTIEL bid — encaisse puis bons gouvernementaux,
jamais de dette — et ask — plafonné à ce qui est encore détenu, plusieurs bids empilés à des prix
différents où seuls les qualifiés se déclenchent, absence d'expiration automatique après 20 vérifications
successives, défaut `migrateState()` pour une ancienne sauvegarde). `node -c script_extracted.js` : SYNTAX
OK. Suite complète (204 scripts, +1 nouveau) relancée à 3 reprises consécutives : **0 échec**.

## 302. Ordres en attente — libellés allégés, correctif d'échelle du prix limite, et percentile de
volatilité propre à la compagnie

**(a) Libellés allégés.** Demande explicite de l'utilisateur, en deux temps : « Tu peux enlevvé cette
phrase, "🎯 Bids en attente (achat — déclenché si le cours descend au prix indiqué ou sous celui-ci)" »,
puis « Même chose pour le ask » / « Tu peux enlever ça : "(vente — déclenché si le cours monte au prix
indiqué ou au-dessus de celui-ci)" ». Les deux titres de tableau dans la sous-section « Ordres en attente »
de Portefeuille (`pendingOrdersHtml`, voir section 301) sont réduits à « 🎯 Bids en attente » et « 🎯 Asks en
attente », sans la parenthèse explicative — l'information (déclenchement à la baisse/hausse du prix limite)
reste disponible via le libellé de la colonne « Prix limite » elle-même et les tooltips des modales de
placement, donc rien n'est perdu, seulement condensé.

**(b) Correctif d'échelle — « Prix limite ».** Bug rapporté, verbatim : « Aussi dans ton prix limite dans
'Ordres en attente' le prix/part soit prix limite n'est pas dans un format $/part ou prix de l'action, quand
tu entre 99$/action il indique 99000000.00 ». Cause racine : l'échelle monétaire interne de toute
l'application est le MILLION de dollars (M$) — `fmtPrice(n)` multiplie systématiquement par 1e6 pour
convertir un prix interne en dollars bruts affichés (ex. interne `0.0001` → affiché « 100.00 $ »), utilisé
PARTOUT où un prix par part est montré (« Prix courant », primes d'option, etc.). Les champs « Prix limite »
de `modalPlaceBidOrder`/`modalPlaceAskOrder` prenaient au contraire la saisie de l'utilisateur DIRECTEMENT
comme prix à l'échelle interne, sans jamais la diviser par 1e6 — un joueur tapant « 99 » (voulant dire
« 99 $/part », par cohérence avec l'affichage de « Prix courant » juste au-dessus) voyait donc son ordre
stocké à `price=99` (interprété en interne comme 99 M$/part), puis réaffiché comme `99 × 1e6 = 99 000 000,00 $`
dans le tableau « Ordres en attente ».

Correctif : le champ « Prix limite » reste saisi en dollars BRUTS (libellé changé de « en M$/part » à
« en $/part », `step` ajusté de `0.0001` à `0.01`, plus adapté à une saisie en dollars entiers/centimes) et
est reconverti à l'échelle interne (`÷1e6`, symétrique de `fmtPrice`) au tout premier point d'utilisation —
avant tout calcul $↔parts (la conversion Montant/Nombre-de-parts au changement d'unité, qui utilise le prix
limite comme taux de change), et avant l'appel à `placeBid`/`placeAsk` (qui attendent un prix à l'échelle
interne, comparé directement à `company.stockPrice`). Le champ « Montant (en M$) » n'est PAS touché — il
reste, comme dans `modalBuySellShares`, à l'échelle M$ native de `state.unit`, seule la conversion
intermédiaire change. Aucun changement côté stockage (`player.pendingBids`/`pendingAsks`) ni côté affichage
du tableau (`fmtPrice(b.price)`/`fmtPrice(a.price)`) : une fois le prix stocké correctement à l'échelle
interne, la chaîne d'affichage déjà en place le réaffiche correctement sans modification.

**(c) Percentile de volatilité, relatif à la compagnie elle-même.** Demande explicite de l'utilisateur,
apparue dans la même conversation : « Dans analyse des ratios des états financiers, mettre sous volatilité,
le percentile de cette volatilité par rapport à cette entreprise, pour savoir quand c'est très haut ou bas
comparativement à l'entreprise, mettre "--" si pas assez de donnée » (valeur de repli corrigée de « 50 » à
« -- » par l'utilisateur lui-même, juste après la demande initiale).

Nouvelle fonction `companyVolatilityPercentile(company, targetVolatility, uptoRoll, marketSeries)` :
reconstruit la distribution historique de la volatilité PROPRE à cette compagnie (jamais comparée aux
autres compagnies — à la différence de `croissanceMarginPercentile`, section 242, qui compare ENTRE
compagnies) en recalculant `companyBetaVolatility` à la clôture de chaque semestre disponible (depuis la
fondation de la compagnie ET depuis `state.finLedgerStartedAtRoll`, même borne que `financialPeriods`/
`companyExpectedNetIncome`) jusqu'à `uptoRoll` inclus, puis retourne le pourcentage de points de cette
distribution dont la volatilité est inférieure ou égale à `targetVolatility` (même formule que
`croissanceMarginPercentile`). Retourne `null` — jamais un 50 arbitraire — si `targetVolatility` est
lui-même `null`, ou si moins de `STOCK_VOLATILITY_PERCENTILE_MIN_SAMPLES` (=3) points historiques sont
disponibles ; le rendu affiche alors « -- » plutôt qu'un chiffre trompeur.

`companyRatiosForPeriod` expose désormais `volatilityPercentile` (calculé juste après `volatility`, en
réutilisant le même `uptoRoll`/`marketSeries`) — nouvelle ligne « Percentile de volatilité (vs historique
propre de la compagnie) », juste sous la ligne « Volatilité », dans les DEUX tableaux « Analyse de ratios »
existants (`renderPortefeuilleFinancials`, une colonne par compagnie à une période choisie, et
`renderEntrepriseFinancials`, une colonne par période pour une compagnie donnée — section 200/203) : cellule
« Xᵉ percentile » ou « -- » si non calculable, sans code couleur particulier (contrairement aux autres
ratios signés, un percentile est toujours entre 0 et 100 et n'a pas de sens « positif/négatif »).

**Tests.** Nouveau fichier dédié `smoke_test_step302_bid_ask_price_units_and_volatility_percentile.js` (6
sous-tests : libellés compacts bid ET ask sans la parenthèse retirée ; `modalPlaceBidOrder` unité « parts »
— prix limite saisi en $ bruts stocké correctement à l'échelle interne, `fmtPrice` symétrique le réaffiche
identique ; `modalPlaceBidOrder` unité « Montant (M$) » — la conversion $↔parts au changement d'unité
utilise bien le prix RECONVERTI, jamais le prix brut saisi ; `modalPlaceAskOrder` même correctif ;
`companyVolatilityPercentile` avec historique suffisant — non-null, borné [0,100], une cible extrême tombe
au 100e/0e percentile ; `companyVolatilityPercentile` avec historique insuffisant — `null`, jamais 50,
propagé jusqu'à `companyRatiosForPeriod`). `node -c script_extracted.js` : SYNTAX OK. Suite complète (205
scripts, +1 nouveau) relancée à 3 reprises consécutives : **0 échec**.

## 303. Deux nouvelles vérifications « de fond » du moteur de cubes — croissance des revenus et couverture
des intérêts, fourchette volontairement allégée

Suite de la même conversation que la section 302, sur les métriques du moteur de cubes fondamentaux
(Groupe A — les 3 vérifications universelles réévaluées à chaque semestre pour chaque compagnie, voir
DESIGN_MOTEUR_BOURSIER.md). Trois pistes de nouvelles vérifications ont été proposées et discutées, chacune
reposant sur des données déjà publiques (grand livre catégorisé, bilans semestriels) mais non encore
consultées par le moteur : (1) croissance des revenus d'un semestre à l'autre — distincte de la
profitabilité absolue déjà vérifiée ; (2) qualité du profit — flux de trésorerie d'exploitation vs bénéfice
net ; (3) couverture des intérêts — capacité de l'exploitation à honorer le service de la dette, distincte
du ratio dette/actif déjà utilisé pour la volatilité/la spirale de détresse. Demande explicite de
l'utilisateur, verbatim : « Les 3 m'intéresse s'il sont considérés des 2 côtés vert et rouge ».

**Piste abandonnée : qualité du profit.** Vérifiée avant implémentation plutôt que supposée : dans
`FIN_CATEGORIES`, TOUTES les catégories `bucket:'revenue'`/`bucket:'expense'` ont `cf:'operating'` sans
exception — donc `cashFlowStatementFor(...).totals.operating` est mathématiquement IDENTIQUE à
`incomeStatementFor(...).netIncome` dans ce moteur, dont la comptabilité est 100% cash (aucune notion
d'accrual, aucune distinction entre le moment où un revenu est comptabilisé et celui où il est encaissé).
Un check comparant les deux ne se serait donc JAMAIS déclenché — signalé à l'utilisateur avant
implémentation plutôt que livré comme code mort silencieux.

**(3b) Croissance des revenus d'un semestre à l'autre.** Comparaison NOMINALE (pas un pourcentage, juste un
sens de variation — même style que la vérification (3) existante, équité T1 vs T0) : revenus du semestre
écoulé (`is.totalRevenue`) vs revenus du semestre PRÉCÉDENT (`incomeStatementFor(co.id, semesterBefore-1)`).
Revenus en hausse → vert ; en baisse → rouge ; égalité exacte → aucune injection. Distincte de la
vérification (2) existante (profitabilité ABSOLUE du semestre, revenus vs dépenses — une compagnie peut être
rentable mais stagnante, ou en perte mais en forte croissance de revenus) et de l'Axe 2 du sac type
Croissance (comparaison à la MOYENNE DES AUTRES compagnies ce semestre, jamais à SA PROPRE trajectoire dans
le temps). Sautée si le semestre précédent n'existe pas encore pour cette compagnie (avant sa fondation OU
avant `state.finLedgerStartedAtRoll` — même garde `earliestSem` que `companyExpectedNetIncome`, sections
194/210) : `incomeStatementFor()` ne retourne jamais `null` (juste des totaux à zéro), donc cette garde
explicite évite de confondre « revenus nuls avant la fondation » avec une vraie baisse de revenus.

**(3c) Couverture des intérêts.** Capacité du semestre écoulé à couvrir ses propres intérêts hypothécaires
(`mortgage_interest_expense` — seule catégorie d'intérêt isolée séparément au grand livre ; l'intérêt des
prêts joueur↔compagnie est composé avec le principal dans un solde courant unique, jamais isolé, voir
`accrueBondInterest`/`withdrawBonds`, donc pas mesurable ici). EBIT reconstitué en rajoutant l'intérêt déjà
soustrait de `is.netIncome`, divisé par ce même intérêt, comparé au seuil de rentabilité (couverture 1.0×) :
au-dessus → vert, en dessous → rouge, jamais de zone neutre (binaire, comme les autres vérifications de ce
groupe). Distincte de `companyDebtRatio` (déjà utilisée pour la volatilité/la spirale de détresse) : un
ratio de STRUCTURE (combien de dette au total) plutôt que de CAPACITÉ (le revenu d'exploitation suffit-il à
couvrir les intérêts de cette dette précise) — une compagnie très endettée mais très rentable n'est pas dans
la même situation qu'une compagnie tout aussi endettée mais à peine profitable. Sautée s'il n'y a AUCUN
intérêt hypothécaire ce semestre (rien à couvrir — ni pénalité ni récompense, pour ne pas favoriser
artificiellement chaque compagnie sans hypothèque à chaque semestre, déjà récompensée ailleurs par un
`companyDebtRatio`/multiplicateur de volatilité plus bas).

**Fourchette allégée, sur demande explicite.** Une fois les deux checks implémentés au niveau standard du
groupe A (`STOCK_TRIGGER_LEVEL_MIN/MAX` = 1-2, comme les vérifications (1)-(3) déjà calibrées sur 6000
parties simulées — voir RESUME_CALIBRATION_4TYPES.md), demande explicite de l'utilisateur : « Fait en sorte
que ça soit pas majeure pour pas déséquilibré juste considéré un peu. » Nouvelle constante dédiée
`STOCK_TRIGGER_FUNDAMENTAL_EXTRA_MIN/MAX = 0-1` (plancher à 0 inclus, contrairement au niveau standard
toujours ≥1) — même échelle que d'autres triggers déjà qualifiés de « mineurs » ailleurs dans ce groupe (ex.
`STOCK_TRIGGER_LOAN_RED_MIN/MAX` = 0-1). Avec cette fourchette, (3b) et (3c) peuvent parfois n'injecter
AUCUN cube même quand le sens (vert/rouge) est correct — un vrai « considéré un peu », jamais un poids égal
aux 3 vérifications historiques. Les deux nouvelles vérifications s'appliquent UNIFORMÉMENT à tous les types
(comme la vérification (3) existante) — aucune pondération par type pour l'instant.

**Nettoyage connexe.** Un test préexistant, `smoke_test_step193_stock_cube_floor.js`, s'est révélé
occasionnellement flaky (~3% des exécutions) en cours de route — découverte fortuite pendant les 3 relances
consécutives de la suite complète, sans lien avec la section 303. Cause : son scénario (B) biaisait
fortement (mais pas totalement) `stockReserve` vers le vert pour vérifier qu'une séquence de tirages restait
« tout vert », sans neutraliser `stockReserve.red`/`white` ni `company.typeReserve` (qui participe toujours
au tirage, à hauteur de son 20% cible, même quand le fondamental est pinné à une seule couleur — voir le
commentaire du 2e scénario du même fichier). Corrigé en zérotant explicitement rouge/blanc des deux réserves
avant le tirage biaisé (déterministe à 100%, jamais juste « presque toujours ») — vérifié sur 40 exécutions
consécutives sans aucun échec après correctif (contre environ 1 échec sur 30 avant correctif).

**Tests.** Nouveau fichier dédié
`smoke_test_step303_fundamental_checks_growth_interest_coverage.js` (7 sous-tests : croissance des revenus
côté vert et côté rouge, sautée au tout premier semestre d'une compagnie ; couverture des intérêts côté vert
et côté rouge, sautée sans intérêt hypothécaire ce semestre ; vérification statistique sur 60 semestres
consécutifs que la fourchette allégée [0,1] est bien exploitée dans les deux bornes, jamais un [1,1]
déguisé). `smoke_test_step46_stock_market_engine_phase_c_dividend.js` mis à jour (scénario E, Farid Corp) :
la nouvelle vérification (3b) réagit désormais, elle aussi, à la baisse de revenu (100→0) déjà présente dans
ce scénario — 3 injections au lieu de 2, la nouvelle venant en 1ère position (exécutée avant la rupture de
séquence dividende et l'espérance des analystes dans `advanceGameClock`), toutes réverifiées avec la
fourchette allégée exacte. `node -c script_extracted.js` : SYNTAX OK. Suite complète (206 scripts, +1
nouveau) relancée à 3 reprises consécutives : **0 échec**.

## 304. Titrisation ABS — revenu de loyer PLEIN à l'état des résultats, dépense d'intérêt dédiée plutôt
qu'une simple soustraction de la part cédée

Suite de la même conversation que les sections 302-303. Demande explicite de l'utilisateur, verbatim : « les
normes comptables t'obligent à garder le revenu PLEIN à ton état des résultats et à comptabiliser plutôt une
dépense d'intérêt sur ce que tu verses aux porteurs [...] avec sa propre ligne de revenus et dépenses pour
les dissocier des autres Loyer ». Suivie d'une clarification distincte, également traitée ici par
vérification (aucun changement de code requis) : « tu devrait pas avoir gain en capital et perte en capital
nottament pour le changement de main des reit » — déjà le cas partout dans le fichier (aucune catégorie
`capital_gain`/`capital_loss` n'existe ; le rachat annuel du lot REIT et la revente de parts REIT entre
entreprises restent tous deux `bucket:null, cf:'investing'`, comme `land_sale`/`land_purchase` — voir le
commentaire de la section 216/272, point 6, qui cite déjà une demande antérieure identique de l'utilisateur :
« je ne veux pas avoir l'idée du gain en capital sur les autres actifs... je garderais ça simple. »)

**Raisonnement comptable.** Une titrisation est une « vraie vente » (revenu cédé disparaît du compte de
résultat) seulement si le cédant abandonne réellement le contrôle de l'actif sous-jacent (ASC 860/IFRS 9 :
isolation légale, libre disposition du porteur, aucune reprise de contrôle possible par le cédant). Sinon,
elle est traitée comme un emprunt garanti (« secured borrowing ») : l'actif reste au bilan du cédant, le
revenu plein continue d'être comptabilisé, et les versements aux porteurs deviennent une dépense d'intérêt.
Les règles de l'ABS dans l'app correspondent structurellement au second cas, pas au premier : l'entreprise
émettrice reste propriétaire du terrain pendant toute la durée du contrat (juste invendable/non
hypothécable), qui lui revient intégralement à l'échéance (non-recours, section 275) — jamais une vraie
cession d'actif. D'où le choix : loyer plein comptabilisé, dépense d'intérêt dédiée sur la part versée aux
porteurs.

**Neutralité du bénéfice net, vérifiée avant implémentation.** Avant ce changement, `settlePropertyRent`/
`settleNeutralPawnRent` détournaient `cededAmount` (= `full * cededPctOfShare`) hors du pipeline normal
AVANT qu'il touche `rent_revenue` — seul `retainedAmount` (`full - cededAmount`) était comptabilisé, aucune
dépense compensatoire. Avec ce changement, `rent_revenue` comptabilise désormais `full` (montant brut), et
une nouvelle catégorie `abs_interest_expense` (symétrique à `abs_income` déjà existante côté porteur —
`bucket:'expense', cf:'operating'`) comptabilise `-cededAmount`. L'écart net (`full - cededAmount =
retainedAmount`) est mathématiquement identique à l'ancien comportement : AUCUN changement de bénéfice net,
ni de trésorerie réelle (le cash cédé partait déjà directement aux porteurs via `distributeAbsCashflow`,
hors de `c.net` — seule la PRÉSENTATION brute/nette à l'état des résultats change). Conséquence délibérément
acceptée et documentée : une compagnie qui titrise verra désormais son `totalRevenue` gonflé par le loyer
cédé (jamais son bénéfice net) — ça peut légèrement avantager la nouvelle vérification (3b) de la section
303 (croissance du revenu BRUT, sans nettage par les dépenses), un effet secondaire mineur mais réel, jugé
acceptable puisqu'il reflète fidèlement une comptabilité « emprunt garanti » plutôt qu'un artefact de bug.

**Implémentation.** `FIN_CATEGORIES.abs_interest_expense` ajoutée juste après `abs_income`. Dans
`settlePropertyRent` et son chemin jumeau `settleNeutralPawnRent` (pion neutre) : le `splitCuts.push(...)`
de la branche ABS passe désormais `amount:full` (au lieu de `amount:retainedAmount`) et porte un nouveau
champ `absCeded:cededAmount` — `net`/`withheld`/`withholdings` (mouvements de trésorerie réels) restent
inchangés. Dans les deux `cutResults.forEach` correspondants, `logFin(owner.id, 'rent_revenue', c.amount)`
comptabilise désormais le montant plein, suivi d'un nouveau `if(c.absCeded>0) logFin(owner.id,
'abs_interest_expense', -c.absCeded);`. Garde d'existence de l'écriture assouplie de `retainedAmount>1e-9 ||
totalWithheld>1e-9` à `full>1e-9 || totalWithheld>1e-9` : une cession proche de 100% (part retenue quasi
nulle) doit quand même produire une écriture `rent_revenue`/`abs_interest_expense` au plein — l'ancien garde-
fou aurait silencieusement omis les deux dans ce cas. Aucun changement requis côté rendu (« État des
résultats » de Portefeuille/Mon Entreprise, tableau du pop-up de fin de tour, ratios) : ces vues dérivent
déjà dynamiquement `Object.keys(FIN_CATEGORIES)` par `bucket`, donc la nouvelle catégorie apparaît
automatiquement comme sa propre ligne, dissociée du loyer normal, sans code UI à toucher.

**Tests.** Nouveau fichier dédié
`smoke_test_step304_abs_gross_revenue_interest_expense.js` (18 assertions) : forme de la nouvelle catégorie
(bucket/cf, symétrie avec `abs_income`, absence confirmée de toute catégorie `capital_gain`/`capital_loss`) ;
`rent_revenue` au montant BRUT et `abs_interest_expense` au montant cédé (négatif) sur un versement de loyer
réel avec émission ABS résolue ; somme des deux égale exactement l'ancien `retainedAmount` (neutralité du
bénéfice net) ; trésorerie de l'émettrice et des porteurs (senior+junior) inchangée par rapport à l'ancien
comportement ; double-entry (`abs_interest_expense` de l'émettrice = somme des `abs_income` des porteurs,
même lancer) ; cas bord de cession proche de 100% (l'ancien garde-fou aurait omis les écritures) ; même
correctif vérifié sur le chemin jumeau `settleNeutralPawnRent`. `smoke_test_step275_abs.js` (comportement de
trésorerie/déblocage/expiration de l'ABS, section 275) rejoué sans modification : toutes ses assertions
passent toujours, confirmant que la refonte comptable ne touche à aucun mouvement d'argent réel. `node -c
script_extracted.js` : SYNTAX OK. Suite complète (207 scripts, +1 nouveau) relancée à 3 reprises
consécutives : **0 échec**.


## 305. Connexion anonyme Firebase — l'app s'authentifie avant tout accès à la base (règles `auth != null`) — 2026-10-18

Première livraison faite dans **Claude Code** (dépôt cloné localement, commits et push directs vers
`JulienDupere/monopoly-bourse`, déploiement Vercel automatique). Le pipeline `script_extracted.js` /
`sync_script.py` / variantes « légère » n'existe plus : `index.html` est désormais l'unique fichier source.

**Contexte.** DEPLOY.md §3 consignait une « action en suspens » : les règles de la Realtime Database avaient
été durcies à `".read": "auth != null", ".write": "auth != null"`, mais personne n'avait vérifié que l'app
s'authentifiait. Vérification du 2026-10-18 : `index.html` ne chargeait que `firebase-app-compat` et
`firebase-database-compat` (pas de SDK Auth, aucun `signInAnonymously()`), et une lecture REST anonyme de
`/data.json` renvoyait `401 Permission denied`. Conséquence : en production, `storageGet()` renvoyait `null`
(exception avalée), `saveGame()` échouait (bandeau « dernière sauvegarde a échoué ») et l'abonnement
temps réel était annulé silencieusement — plus aucune partie ne pouvait se charger ni se sauvegarder.

Demande explicite de l'utilisateur, verbatim : « Oui, ajoute la connexion anonyme Firebase dans index.html.
Je m'occupe d'activer l'auth anonyme dans la console Firebase. »

**Changement.**

- `<head>` : ajout de `https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js` (même version
  que les deux autres SDK compat).
- Nouvelle fonction `firebaseAuthReady()` (à côté de `firebaseDb()`), qui renvoie une promesse mémorisée
  (`firebaseAuthPromise`) résolue à `true` une fois connecté, `false` si la connexion est refusée :
  1. si `firebase.auth().currentUser` existe déjà → `true` immédiatement ;
  2. sinon, un seul `onAuthStateChanged` : si le SDK restaure une session anonyme persistée (cas normal
     d'une visite suivante) → `true` sans nouvelle connexion ; sinon `signInAnonymously()` → `true`, ou
     `false` + `console.error` si refusé (`auth/admin-restricted-operation` quand l'auth anonyme n'est pas
     activée dans la console, ou réseau coupé) ;
  3. dans tous les cas, `toggleFirebaseAuthWarning(!ok)` pilote un **nouveau bandeau**
     `#firebaseAuthWarning` (même classe `.config-warning` que les deux bandeaux existants) qui explique à
     l'utilisateur quoi faire (recharger ; sinon le créateur active l'auth Anonyme dans la console).
  La promesse est **mémorisée** : des centaines d'accès concurrents ne déclenchent qu'une seule connexion.
  Un échec est lui aussi mémorisé (pas de tentative toutes les 3 s par le sondage) ; rechargement requis.
- `firebaseDb()` appelle `firebaseAuthReady()` dès l'initialisation (sans attendre) pour que la connexion
  parte le plus tôt possible.
- Les **trois chemins d'accès à la base** attendent désormais `await firebaseAuthReady()` juste avant
  l'appel SDK : `storageGet` / `storageSet` / `storageDelete` (branche Firebase seulement — les branches
  `window.storage` et `localStorage` sont inchangées), `saveGame()` avant `ref.transaction()`, et
  `startPolling()` avant `ref.on('value')`.
- `startPolling()` : comme l'abonnement est maintenant posé de façon asynchrone, un compteur
  `syncGeneration` (incrémenté par `startPolling()` et `stopSync()`) empêche un abonnement « fantôme » si
  `stopSync()` ou un second `startPolling()` survient avant la fin de l'authentification. L'abonnement
  reçoit aussi un callback d'annulation : une annulation `PERMISSION_DENIED` affiche le bandeau auth au
  lieu de rester silencieuse.
- Si le SDK Auth n'est pas chargé (`firebase.auth` absent), `firebaseAuthReady()` renvoie `false` sans
  erreur et le comportement antérieur est conservé intégralement.

**Côté console Firebase (à faire par Julien, hors code)** : Authentication → Sign-in method → activer
**Anonyme**. Tant que ce n'est pas fait, l'app affiche le bandeau « Connexion à Firebase refusée ».

**Tests.** Pas de test contre la vraie base (règle DEPLOY.md §4). Script Node `test_auth.js` (hors dépôt,
dans le bac à sable de la session) qui charge les blocs `firebaseDb`…`storageDelete` et
`startPolling`…`stopSync` extraits d'`index.html` dans un `vm` avec un SDK Firebase simulé ; 10 scénarios :
(1) `once()` n'est appelé qu'après `signInAnonymously()` résolu, bandeau masqué ; (2) 3 accès concurrents
= 1 seule connexion ; (3) connexion refusée → `storageGet`/`storageSet` renvoient `null` proprement,
bandeau visible, erreur loguée ; (4) `currentUser` déjà présent → ni `onAuthStateChanged` ni
`signInAnonymously` ; (5) session persistée restaurée → pas de nouvelle connexion, désabonnement fait ;
(6) SDK Auth absent → `false`, accès effectué comme avant ; (7) `startPolling` pose `on()` seulement
après l'auth et applique bien les données reçues ; (8) `startPolling` puis `stopSync` avant la fin de
l'auth → aucun `on()`, handle `null` ; (9) deux `startPolling` rapprochés → un seul `on()` ; (10)
annulation `PERMISSION_DENIED` → bandeau auth visible. Relancé 3 fois : **0 échec**. Syntaxe du script
principal extrait d'`index.html` vérifiée avec `node --check` : OK.


## 306. Emprunt sans cube rouge, baisse du dividende récurrent = sac type à 20 rouges, et règle du ratio de distribution > 1 (Dividendes) — 2026-10-19

Demande explicite de l'utilisateur, verbatim : « Demande d'emprunt = aucun cubes rouges · Dividende une réduction
du dividende pour les compagnies à dividendes = le sac passe à 20 cubes rouges dans le sac type · Aussi dans le sac
type de dividendes si le ratio de distribution [Dividendes versées/Profit] > 1 changé 5 cubes en rouge (Blanc=>Rouge
priorité suivi de Vert => Rouge) ».

**1. Demande d'emprunt.** `issueLoan()` n'injecte plus aucun cube rouge à l'emprunteuse (avant : 0 à 1, constante
`STOCK_TRIGGER_LOAN_RED_MIN/MAX`, supprimée). Les autres financements sont inchangés (hypothèque 1–2, subvention
d'avance 1–2, émission d'actions 1–2 + taille, prêt de dernier recours 6–10). La matrice des produits affichait déjà
« sans cubes » pour l'obligation d'entreprise : elle est désormais exacte. Le prêt continue de compter dans la dette
(cote de crédit, spirale de détresse) comme avant.

**2. Baisse du dividende récurrent (type Dividendes).** `dividendGaugeTierFor()` : les paliers 1 (≤ 50 % de la
référence) et 2 (sous 90 %) ne déplacent plus le sac de −6 / −3 ; ils renvoient `wipe:true` et
`applyDividendGaugeTier()` appelle `wipeTypeReserveToRed()` → sac type = 20 rouges, 0 vert, 0 blanc. La référence
est abaissée au nouveau niveau comme avant. **Hypothèse retenue** : la tolérance de ±10 % (palier 3, « inchangé »)
reste neutre — une baisse de moins de 10 % n'est pas considérée comme une réduction. Les hausses (paliers 4 à 7 :
+3, +6, +9, +12) sont inchangées. La fenêtre « Dividende récurrent » affiche un avertissement rouge dès qu'un palier
de baisse est sélectionné, et un rappel de la règle du ratio de distribution.

**3. Ratio de distribution > 1 (type Dividendes).** À la clôture de chaque semestre, dans le bloc dividendes
d'`advanceGameClock()` (après la logique de série existante) : si l'entreprise est de type Dividendes, a versé des
dividendes ce semestre (`dividendPaidInSemester` > 0) et que ce versement dépasse son bénéfice net du semestre
(`incomeStatementFor(...).netIncome`), 5 cubes du sac type passent au rouge via la nouvelle fonction
`redenTypeReserveWhiteFirst()` : les **blancs d'abord**, puis les **verts** (ordre inverse de `shiftTypeReserve`,
qui puise d'abord dans la couleur opposée). Constante `DIVIDEND_OVERPAYOUT_RED_CUBES = 5`. S'il reste moins de 5
blancs + verts, seuls ceux-là rougissent. **Hypothèses retenues** : un ratio exactement égal à 1 ne déclenche rien
(« > 1 » strict) ; un semestre à bénéfice nul ou négatif avec un versement compte comme un ratio > 1 (on distribue
plus que ce qu'on a gagné). Les autres types ne sont pas concernés. Un message au journal indique le ratio et le
nombre de cubes rougis. Le texte d'aide du type Dividendes (`COMPANY_TYPE_GUIDELINES.dividende`) mentionne les
deux règles.

**Tests.** Nouveau fichier `tests/section306.test.js` (premier test versionné dans le dépôt) : charge tout le moteur
d'`index.html` dans un `vm` Node avec un faux DOM et un `window.storage` en mémoire (aucun accès Firebase), crée une
partie locale à deux joueurs (une Dividendes, une GARP), puis vérifie 15 points : prêt accepté sans aucune injection
rouge ; paliers 1 et 2 → 20 rouges et référence abaissée ; baisse de 11 % → 20 rouges ; baisse de 5 % → rien ;
hausses inchangées ; ratio 120 % → 6V/1R/3B devient 4V/6R/0B ; GARP non touchée ; ratio 80 % et 100 % → rien ;
bénéfice négatif → règle appliquée ; moins de 5 cubes disponibles → plafonné ; aucun versement → règle existante
(20 rouges). Les tirages de cubes, aléatoires et postérieurs aux contrôles, sont neutralisés pendant le test. Lancé
3 fois : **0 échec**. `node --check` du script : OK.

**Documentation joueurs mise à jour** : cahiers 2, 4, 6 et 7 (PDF corrigés en place) et l'aide-mémoire.


## 307. Correction des 6 bogues critiques et graves de l'audit du 2026-10-19

Contexte : audit Opus du moteur (rapport `docs/audit/audit-2026-10-19.md`, 101 bogues confirmés). Demande explicite
de l'utilisateur, verbatim : « Oui, corrige les 6 bogues critiques et graves, avec un test pour chacun, puis
montre-moi le résultat avant de pousser. » Chaque correction a été faite dans une copie isolée, avec un test qui
échoue sur l'ancien code et réussit sur le nouveau, puis attaquée par trois réviseurs ; leurs remarques ont donné
une série de retouches. Chaque changement du code porte le commentaire « Section 307 ».

1. **Titrisation (ABS) sans tranche junior** — `creditAbsHolder` et `distributeAbsCashflow` renvoient le montant
   réellement versé aux porteurs ; `settlePropertyRent` et `settleNeutralPawnRent` ne retirent à l'émettrice que ce
   montant. Ce qui n'est versé à aucun porteur reste à l'émettrice (rétention du risque, sections 275 et 277).
   `abs_interest_expense` = montant réellement versé (section 304).
2. **Parts privilégiées, annonces de vente** — nouvelle `reconcilePreferredListings` : une annonce ne porte jamais
   plus de parts que le vendeur n'en détient (à la mise en vente, à l'achat, après un rachat). `callPreferredShares`
   répartit le paiement sur la somme réelle des parts des porteurs : total versé = total débité, même dans une
   partie déjà corrompue.
3. **Rachat sans encaisse** — un rachat volontaire de découvert (`closeShortPosition`) ou d'option écrite
   (`closeOptionPosition`, `closeOptionStrategy` en tout ou rien) exige l'encaisse, avec le maximum rachetable dans
   le message. Les fermetures forcées (appel de marge) puisent d'abord dans les bons
   (`raiseCashForForcedSettlement`, comme l'exercice forcé des sections 226-227). **Marge initiale** : ouvrir un
   découvert, une option écrite ou une stratégie avec jambes écrites est refusé si, après l'ouverture simulée, la
   valeur nette admissible est sous la marge exigée (`initialMarginCheck`, `maxContractsWithinInitialMargin`) ; les
   positions couvertes, qui n'augmentent pas la marge exigée, restent permises. Le plafond de 15 % des options
   écrites viendra avec la série suivante.
4. **Dividendes quand la banque a une position négative** — décision de l'utilisateur : « la banque paie », comme un
   vendeur à découvert. Montant par part = montant ÷ parts émises ; chaque porteur reçoit ce montant × ses parts
   éligibles, calculées AU VERSEMENT (min(parts à l'annonce, parts au versement)). L'entreprise débite le montant
   annoncé ; l'excédent réellement versé est payé par la banque (`settleBankDividendExcess`). Le CEO reçoit
   exactement référence × parts à l'auto-versement (section 256).
5. **Action rejouée après un rechargement** — `saveGame` : une transaction refusée avec un instantané distant vide
   relit la valeur du serveur (`once('value')`), remplace `state`, puis renvoie `'conflict'` ; l'action n'est
   réappliquée qu'une fois, sur l'état frais. Si le serveur ne renvoie rien, échec sans rejeu.
6. **Impôt sur le revenu négatif** — `taxSquareCost` : impôt = min(2, max(0, 10 % de la valeur)).

**Tests** : `tests/helpers/engine.js` (banc partagé), `tests/run-all.js` (lanceur), `tests/audit-bug1` à `bug6`
et `bug3b`. **925 vérifications, 8 fichiers, 0 échec.** Une simulation de partie complète n'a trouvé aucune fuite
d'argent due aux corrections.

**Documentation joueurs à mettre à jour avec la série suivante** : cahier 1 (rachat de découvert, marge à
l'ouverture), cahier 3 (rachat d'option écrite, marge), cahier 8 (part non versée), aide-mémoire fiche 2.

## 308. Synchronisation et multijoueur : une action n'est adoptée que si elle est enregistrée, plus de double envoi, plus de fenêtre fermée ou vidée par un autre joueur — 2026-10-24

Contexte : première série de corrections des bogues moyens et faibles de l'audit du 2026-10-19 (lot 1 sur 10, le
plus prioritaire). Demande explicite de l'utilisateur, verbatim : « Je ne veux pas de problème de synchronisation,
de fermeture quand une action d'un autre joueur est prise. » Il a demandé aussi : « une mise à jour venue d'un autre
joueur ne doit jamais fermer ni vider une fenêtre, un formulaire ou un menu déroulant en cours, l'action étant
revérifiée sur l'état à jour à la confirmation », « imposer le choix Vous êtes dès le premier accès », une
confirmation pour la subvention d'avance, et un banc d'essai multi-appareils. Bogues traités : 17, 32, 44, 57, 58,
59, 60, 71, 72, 73, 74, plus un défaut trouvé par le banc (accusé de réception perdu). Chaque changement du code
porte le commentaire « Section 308 ».

1. **Adoption transactionnelle** (`attemptActionWithRetry` → `runActionWithRetry`, `finishAction`) — une seule
   action à la fois par appareil (file ; les appels programmatiques attendent leur tour). Pendant une action, une
   valeur reçue du serveur est mise de côté et appliquée à la fin ; une valeur plus ancienne que la dernière
   confirmée (version plus basse) n'est jamais appliquée. Une action n'est adoptée que si sa sauvegarde réussit : sur
   tout échec (refus de l'applyFn après modification, exception, réseau, conflits répétés), `state` revient au
   dernier état confirmé et les globales du lancer sont restaurées. Exception : `{ok:false, persist:true}` (annonce
   de privilégiées périmée retirée, section 307). Messages : « connexion perdue » ou « conflits répétés », « Votre
   action n'a PAS été enregistrée ; la partie affiche le dernier état enregistré ». Transaction Firebase en
   `applyLocally=false`. Corrige 44 (action perdue annoncée réussie, ou appliquée deux fois au clic suivant), 73
   (offre de swap ou de compensation effacée par un refus) et 74 (« Résultats du tour » d'un lancer rejoué).
2. **Accusé de réception perdu** (trouvé par le banc) — le serveur écrit l'action puis la connexion tombe avant la
   réponse : l'essai suivant voyait un conflit et rejouait l'action (enregistrée deux fois), ou l'annonçait « PAS
   enregistrée » alors qu'elle l'était. Chaque action a désormais un identifiant unique, ajouté à
   `state.appliedActionIds` (100 derniers, défaut `[]` dans `migrateState`) dans la même écriture que la mutation.
   En conflit, si l'état frais contient l'identifiant, l'action est réussie sans rejeu ; avant d'annoncer un échec
   réseau, le serveur est relu. Relecture impossible : « impossible de savoir si votre action a été enregistrée »
   (résultat `{ok:false, uncertain:true}`).
3. **Pas de double envoi** — le bouton cliqué est désactivé pendant l'envoi ; un clic sur un bouton d'action est
   ignoré pendant une action et 500 ms après sa fin ou l'ouverture d'une fenêtre (`shouldIgnoreActionClick`) ;
   onglets, menus, champs, Annuler/Fermer/OK restent libres. Gardes de fond : `sendToJail` refuse une entreprise déjà
   enquêtée (60) ; la vente REIT porte la détention affichée (`expectedHeld`, 57) ; la subvention d'avance passe par
   une fenêtre de confirmation qui fige le rang (`expectedOwed`, 58, décision de l'utilisateur). Corrige 32 (2e clic
   sur la ligne remontée).
4. **Actions de tour liées au numéro du lancer** — « Tour Terminé », son annulation et « Forcer le tour » portent le
   `rollCount` affiché (`data-roll`) ; refus dans l'applyFn si le lancer a changé (« Ce lancer a déjà été joué ») ou
   si la partie est terminée. Le lancer non forcé revérifie que toutes les entreprises qui lancent sont prêtes.
   Corrige 17 (deux lancers pour un tour, lancer après la fin de partie) et 59 (double « Tour Terminé »).
5. **Mode local** (71) — `saveGame` n'utilise Firebase que sans `window.storage`.
6. **Fenêtres, formulaires et menus** (72) — la valeur reçue est appliquée tout de suite et l'onglet redessiné en
   préservant les champs modifiés par le joueur (clé `id`/`name`/`data-*`, jamais en double), le focus, le curseur,
   les menus ouverts, le défilement et le logo de fondation (`renderPreservingForms`). Rendu différé seulement
   pendant une vraie interaction (8 s après la dernière frappe, 30 s au plus pour un `<select>` ouvert :
   `shouldDeferRemoteState`), pour ne pas recréer le blocage de la section 187bis. Une fenêtre ouverte ne bloque
   plus la synchro et n'est jamais remplacée : « Résultats du tour » et l'annonce CEO exécutée attendent sa
   fermeture (une seule fenêtre, qui signale les autres lancers).
7. **Revérification à la confirmation** — au début de chaque action, la dernière valeur reçue est adoptée.
   Utilitaire `confirmWithFreshConditions` : si les conditions affichées à l'ouverture ont changé, la fenêtre montre
   les nouvelles et demande une 2e confirmation ; rien n'est fait avant. Appliqué à la subvention d'avance et à la
   vente REIT (nouvelle fenêtre de confirmation qui signale un prix nul). À appliquer ensuite à l'assurance (15/49)
   et aux prêts (24/50). Audit des ~100 applyFn : aucune ne modifie un objet de `state` capturé avant l'action.
8. **« Vous êtes » imposé** (décision de l'utilisateur) — `loadGame` ne donne plus `players[0]` (le créateur) à un
   appareil sans identité mémorisée ; `renderIdentityGate` s'affiche avant tout autre écran (joueurs, spectateur,
   quitter) et `chooseIdentity` mémorise le choix.
9. **Retouches de la revue** (un réviseur Opus, puis vérification) — le texte « Annuler »/« Fermer »/« OK » ne
   libère un bouton de l'anti-rebond que dans une fenêtre (les « Annuler » de la liste des ordres en attente y sont
   soumis : un double clic annulait deux ordres) ; `closeModal` arme l'anti-rebond et une fenêtre apparue depuis
   moins de 500 ms n'accepte aucun clic ; la valeur reçue attend qu'aucun pointeur ne soit enfoncé (un clic sur
   « Fonder » juste après une saisie était avalé) ; `render()` ne fait plus que programmer les fenêtres
   d'information (`scheduleDeferredPopups`), si bien que « Résultats du tour » n'est plus jamais remplacée ni
   perdue ; un champ qui enregistre au `change` et a été restauré est enregistré à la sortie du champ, jamais
   par le retrait du champ lors d'un rendu (Chrome émet alors `focusout`), donc jamais en pleine saisie.
   **Hors ligne** : suivi de `.info/connected` ; une action lancée quand la coupure est connue depuis plus de 2 s
   (et plus de 4 s après le dernier retour au premier plan, le temps que le SDK se reconnecte au réveil du
   téléphone) est refusée (« Pas de connexion au serveur : action non envoyée… ») ; indicateur `#actionStatusIndicator` en bas
   d'écran (« ⏳ Enregistrement en cours… », « en attente du réseau » en rouge, clic ignoré signalé) ; une action
   déjà en vol s'enregistre à la reconnexion, revérifiée sur l'état frais. Coupure « silencieuse » (Wi-Fi sans
   Internet, 4G saturée : `.info/connected` reste vrai) : au-delà de 8 s sans réponse, l'indicateur passe au rouge
   « Connexion lente ou perdue » (affichage seulement : l'action part dès que le serveur répond, sans doublon). La
   relecture après un accusé perdu ne conclut « non écrite » que si la version lue dépasse la base de l'action (le
   vrai SDK répond à `once` depuis son cache) ; sinon issue incertaine, et la fenêtre se ferme.

**Banc d'essai multi-appareils** : `tests/helpers/fake-firebase.js` (faux serveur partagé, un faux SDK compat par
appareil, transactions comme le vrai SDK, coupures, refus, fermeture de page, ordonnanceur à graine),
`tests/helpers/fake-dom.js` (mini-DOM qui exécute les vrais gestionnaires de clics), `tests/section308-sync.test.js`
(8 scénarios : actions concurrentes, Tour Terminé contre Forcer le tour, fin de partie, échecs réseau, accusé perdu,
rechargement, doubles clics ; invariants : aucune action perdue, doublée ou fantôme, monnaie conservée, un lancer
par tour, jamais après la fin, convergence). Sur le code d'avant : 22 cas sur 50 en échec (bogues 17, 44, 59).
`SYNC_SEEDS=N` pour un passage long.

**Tests** : `tests/section308-transaction`, `-tour`, `-clics`, `-formulaires`, `-retouches`, `-sync` ;
`audit-bug5` (scénario C) et `section250` (A, D) adaptés : l'achat non enregistré est retiré de l'appareil. Chaque
correctif a sa contre-épreuve. **15 fichiers, 1 190 vérifications et 53 cas multi-appareils, 0 échec ; 320 cas
multi-appareils avec `SYNC_SEEDS=40`.** **Essai réel** avec le vrai SDK Firebase 10.14.1 contre l'émulateur local
(projet `demo-monopoly`, règles `auth != null`, outils hors dépôt dans `C:\Users\Julien\tools\firebase-emulateur`) : 88 cas
(actions concurrentes, Tour Terminé contre Forcer le tour, doubles clics, coupures franches et silencieuses,
accusés perdus, rechargements), aucun invariant violé ; essai au navigateur à deux appareils concluant.

**Mise en production** : demander à tous les joueurs de recharger la page (un ancien onglet reste compatible, mais
n'a ni la file d'actions, ni la clé d'idempotence, ni l'écran « Vous êtes »).

**Documentation joueurs à mettre à jour** : écran « Vous êtes » au premier accès ; confirmation de la subvention
d'avance et de la vente REIT ; 2e confirmation « Les conditions ont changé » ; indicateur d'enregistrement et refus
hors ligne ; messages « Ce lancer a déjà été joué », « connexion perdue », « conflits répétés », « impossible de
savoir si votre action a été enregistrée » ; saisies et fenêtres conservées quand un autre joueur agit.

## 309. Immobilier, parts et maisons : vendeur imposé, banque au prix de rachat, offres à accepter, monnaie conservée à la construction — 2026-10-24

Vague 2 de la série de corrections ; le numéro 310 est réservé au lot REIT et lot commercial (vague 3).

Contexte : lot 2 de la série de corrections de l'audit du 2026-10-19 (bogues moyens et faibles). Demandes de Julien,
verbatim : « Moyens : tout corriger SAUF le 12 » ; « Faibles : tout corriger SAUF 45, 51 et 53 » ; « ventes
unilatérales (vendre des maisons, revente de parts REIT) : exiger l'accord de l'acheteur » (ici : vendre des maisons ;
la revente de parts REIT relève d'un autre lot) ; « compensation de maison : chaque autre copropriétaire paie sa
quote-part au propriétaire de la maison, qui ne se paie pas lui-même, et l'affichage montre le montant réellement
transféré ». Sur le plafond de copropriétaires, en réponse à « regrouper un lot qui dépasserait le plafond de trois
copropriétaires » : « C'est ok, si après le regroupement il y a plus que 3 propriétaires » ; puis : « Non le plafond
s'applique seulement à l'achat initiale du terrain individuel ». Bogues traités : 8, 9, 13, 16, 33, 34, 35, 63 ; 64
voulu, non corrigé. Chaque changement du code porte le commentaire « Section 309 ».

1. **Vendeur imposé** (bogue 8 ; `modalSellShareForm`, commune à `modalSellShare` et `modalSellMergedShare`,
   `sellPropertyShare`, `sellMergedShare`, `proposeAssetSale`) — la fenêtre « Vendre une part » n'a plus de menu
   « Vendeur » : le vendeur est l'entreprise du CEO qui agit (« Vendeur : Co Bob (40 % détenus) ») ; l'acheteur est
   une AUTRE entreprise ou la banque. Revérifié dans l'applyFn : seul le CEO vendeur dépose l'offre ou vend à la
   banque ; une entreprise ne peut pas se vendre une part. Scénario : Brun 1, Co Alice 60 %, Co Bob 40 %. Avant :
   Bob, fenêtre ouverte sur « Co Alice » par défaut, s'attribuait les 60 % pour 0,01 M$ ; Co Alice pouvait se vendre
   1 % pour 5 M$ (faux investissement de 5 M$). Après : la requête est refusée (« Seul le CEO de Co Alice peut
   proposer la vente de ses actifs », « Une entreprise ne peut pas se vendre une part à elle-même »), rien ne bouge.
2. **La banque paie sa valeur de rachat** (bogue 9 ; `bankBuybackPrice`, `modalConfirmBankShareSale`) — vente à la
   banque : prix = valeur de rachat calculée par le moteur (`buybackValue` du terrain, `buybackValueLot` du lot,
   × pourcentage vendu), annoncé dans une fenêtre de confirmation (`confirmWithFreshConditions` : si la valeur change
   avant le clic, 2e confirmation) ; le prix saisi ne vaut que pour une entreprise. Scénario : Co Alice vend 1 % de
   Brun 1 à la banque en tapant 500 M$. Avant : +500 M$ pour Co Alice, −500 M$ pour la banque. Après : la fenêtre
   annonce 5 K$ ; Co Alice +0,0045 M$, banque −0,0045 M$ (valeur intrinsèque 0,6 × (1 − 25 %) × 1 %). Lot Brun :
   1 % = 0,0135 M$ (valeur de rachat 0,45 + 0,90).
3. **Ventes à une entreprise = offres à accepter** (décision « ventes unilatérales » ; `state.assetSaleOffers`, défaut
   `[]` dans `migrateState` et `createGame` ; `proposeAssetSale`, `acceptAssetSaleOffer` /
   `modalAcceptAssetSaleOffer`, `refuseAssetSaleOffer`, `cancelAssetSaleOffer`, `assetSaleOffersHtml`) — « Vendre des
   maisons » et « Vendre une part » à une entreprise déposent une offre {vendeur, acheteur, quantité et prix par maison
   | terrain ou lot, pourcentage, prix, auteur, lancer, heure}. Rien ne bouge (argent, maisons, parts) avant
   l'acceptation. Le dépôt est vérifié à blanc (réserve, part détenue, hypothèque, ABS, lot regroupé) ; un prix non
   fini ou non positif est refusé. L'offre expire au lancer de dés suivant son dépôt (`expireAssetSaleOffers`, au même
   moment du cycle que les demandes d'emprunt, trace au journal ; une acceptation sur un lancer changé est refusée) ;
   le lancer de dépôt est affiché (« déposée au lancer 12, expire au lancer suivant »). Dans « Vendre une part », le
   prix proposé suit le pourcentage tant que le joueur ne l'a pas modifié lui-même. L'offre s'affiche
   dans l'onglet Mon Entreprise de l'acheteur (« Co Alice vous propose 2 maison(s) de sa réserve (500 K$/maison) pour
   1.00 M$ », Accepter / Refuser) et du vendeur (« en attente de sa réponse », Retirer). Seul le CEO acheteur accepte
   ou refuse ; seul le vendeur retire. À l'acceptation (fenêtre « Accepter et payer 1.00 M$ »,
   `confirmWithFreshConditions`), tout est revérifié sur l'état frais, encaisse de l'acheteur comprise ; si l'offre
   n'est plus exécutable : « Offre non exécutée — … Rien n'a été payé ni transféré ; l'offre reste en attente
   (refusez-la, ou le vendeur peut la retirer) ». Scénario maisons : Co Alice (3 maisons) propose 2 maisons à
   0,5 M$ à Co Bob ; avec 0,5 M$ d'encaisse, Bob est refusé et l'offre reste ; avec 20 M$, il accepte : Co Bob −1 M$,
   Co Alice +1 M$, réserves 3 → 1 et 0 → 2, monnaie conservée. Avant : Co Bob était débité sans rien accepter, même
   sans encaisse. Une même maison offerte à Carl et à Dan : la 2e acceptation est refusée (réserve vide). Scénario
   parts : Bob propose 10 % de Brun 1 à Co Carl pour 3 M$ ; Carl accepte : Co Carl −3 M$, Co Bob +3 M$, Brun 1 =
   60 / 30 / 10 %.
4. **Construction : la banque n'encaisse que ce que paient les entreprises** (bogue 13 ; `buildHouseCore`) — règle §7,
   « chaque copropriétaire paie sa part de chaque maison » : la part du lot que les entreprises ne détiennent pas
   (réserve REIT, part revendue à la banque) est à la charge de la banque, comme le prévoyait déjà la ligne
   « Banque (REIT) » du reçu. Le reçu est équilibré : « Banque (REIT (Première rue), part de 10 % non détenue par les
   entreprises — à sa charge) −0,05 », « Banque (construction) +0,50 ». Scénario : lot Brun, Co Alice 60 %, Co Bob
   30 %, réserve REIT 10 %, maison à 0,5 M$. Avant : 0,30 + 0,15 payés, banque +0,50 : 0,05 M$ créés par maison.
   Après : banque +0,45, monnaie conservée. Sans REIT, après la vente de 40 % du lot à la banque : avant 0,20 M$ créés
   par maison, après banque +0,30 = ce que paie Co Alice. Option écartée : faire payer la part de la banque aux
   copropriétaires (contraire à §7).
5. **Provenance des maisons** (bogue 33 ; `buildHouseCore`) — la réserve de la source est revérifiée dans l'applyFn ;
   sans maison fournie, ni construction ni compensation ; avec l'option active, une construction sans source est
   refusée. Scénario : Co Carl a 1 maison, deux constructions la choisissent avec 0,4 M$ de compensation. Avant :
   deux maisons construites, Co Carl reçoit 0,8 M$. Après : la 2e est refusée (« Co Carl n'a plus de maison en
   réserve… rien n'a été construit ni payé »), Co Carl reçoit 0,4 M$ une fois.
6. **Compensation de maison** (décision ; `houseCompensationTransfers`, `buildHouseCore`, `modalHouseCompensation`) —
   le montant saisi est la « Valeur convenue de la maison » ; chaque autre copropriétaire paie sa quote-part (sa part
   divisée par le total des parts détenues par les entreprises, jamais la banque ni le REIT) à l'entreprise qui
   fournit la maison, qui ne se paie pas la sienne. La fenêtre affiche chaque versement et « Montant réellement
   transféré à … » ; le journal et la fenêtre de transaction montrent le même montant. Les versements affichés sont
   revérifiés à la confirmation : si les parts ont changé, rien n'est fait et la fenêtre se redessine avec les
   nouveaux chiffres. Un payeur qui ne peut pas couvrir sa part de construction plus sa quote-part est refusé
   (avant : encaisse négative). Scénario : lot Brun, Co Alice 60 % (fournit la maison), Co Bob 40 %, valeur 1 M$.
   Avant : le champ disait « Montant total à transférer : 1 M$ » alors que 0,40 M$ seulement étaient transférés.
   Après : « Co Bob paie 400 K$ (quote-part 40 %) — Montant réellement transféré à Co Alice : 400 K$ (Co Alice ne se
   paie pas sa propre quote-part de 60 %) ». Source non copropriétaire (Co Carl) : Co Alice 0,60, Co Bob 0,40, Co Carl
   reçoit 1 M$. Avec le REIT (60 / 30 / réserve 10) : Co Bob paie 30/90 × 0,9 = 0,30 M$.
7. **Échange de parts** (bogues 16 et 35 ; `shareSwapGiveRefusal`, `executeShareSwap`, `transferAssetShare`,
   `modalShareSwap`) — une part donnée subit les mêmes refus que la vente : hypothèque de celui qui la donne, revenu
   cédé par ABS (swap de revenu fixe/variable) ; un terrain devenu membre d'un lot regroupé ne s'échange plus seul ;
   le créateur est revérifié dans le moteur (`executeShareSwap`), pas seulement dans la fenêtre. Scénario : Co Alice hypothèque Brun 1 (0,3 M$ auprès de la
   banque) puis l'administratrice échange 100 % de Brun 1 contre Brun 2 de Co Bob. Avant : échange accepté,
   hypothèque restée au nom de Co Alice, la banque perd 0,3 M$ au défaut. Après : « Co Alice a hypothéqué sa part de
   Brun 1 — remboursez l'hypothèque avant de pouvoir l'échanger », rien ne bouge.
8. **Terrain regroupé entre l'ouverture et la confirmation** (bogues 34 et 35 ; `issueMortgage`,
   `shareAssetMergedRefusal`) — hypothèque, vente ou échange d'un terrain seul refusés avec un message clair si le lot a
   été regroupé entre-temps (« Brun 2 fait désormais partie du lot Brun regroupé — rien n'a été fait ; hypothéquez
   votre part du lot entier »). Scénario 34 : avant, hypothèque de 0,36 M$ acceptée sur Brun 2 du lot, sans intérêt ni
   saisie ; après, refus, aucun emprunt versé. Scénario 35 : avant, la vente de 30 % de Brun 1 ne modifiait que Brun 1
   (lot désynchronisé, parts recopiées sans paiement à la vente suivante) ; après, refus, les terrains du lot gardent
   les mêmes parts. Un identifiant de lot absent n'est plus interprété comme « tous les terrains non regroupés ».
9. **Regroupement sans part confisquée** (bogue 63 ; `mergeRoundShares`, `mergeGroup`) — parts entières, somme
   exacte (100 %, ou 90 % avec le REIT), personne à 0 % : méthode des plus forts restes avec un plancher de 1 %
   (chacun reçoit max(1, partie entière), le reste manquant va aux plus fortes décimales ; l'excédent dû aux planchers
   est repris un point à la fois aux parts au-dessus de 1 %, les moins lésées d'abord). Aucun argent ne bouge ; sans
   part inférieure à 1 %, le résultat est identique à l'ancien (vérifié sur 200 cas). Écart réel : une part relevée à
   1 % gagne moins d'un point, mais l'excédent ainsi créé (au plus k points, k = nombre de parts exactes inférieures à
   1 %) est repris aux autres sans paiement : un copropriétaire peut céder jusqu'à k + 1 points (strictement moins).
   Scénario Rose de l'audit (3 petites parts) : Bob passe de 98,95 % exacts à 97 %, soit 1,95 point cédé sans
   paiement. Option laissée à Julien : compenser en argent l'écart de chacun au prix de rachat du lot, entre
   copropriétaires. Un copropriétaire à 0 % n'est pas repris. Scénario : Bleu pâle 1 = Co Alice 1 % /
   Co Bob 99 %, Bleu pâle 2 = Co Bob 100 %, Bleu pâle 3 = Co Bob 99 % / Co Carl 1 % (parts exactes 0,31 / 99,31 /
   0,38 %). Avant : Co Alice 0 % (part confisquée, copropriétaire fantôme). Après : 1 / 98 / 1 %.
10. **Achats à la banque de l'Administration** (retouche de la revue ; `modalBuyShares`, `buyMergedShareFromBank`) —
    le créateur est revérifié dans l'applyFn et un prix nul, négatif ou non fini est refusé. Constat antérieur au lot :
    le prix saisi « pour 100 % » devient `acquisitionPrice`, plancher de la valeur intrinsèque, donc du prix de rachat ;
    racheter 1 % « à 500 M$ pour 100 % » (5 M$ payés) puis tout revendre à la banque rapporte +370 M$. La question de
    fond (le prix saisi peut-il relever ce plancher ?) est posée à Julien ; `intrinsicValue` n'est pas modifiée.
11. **Plafond de copropriétaires** (bogue 64 : voulu, non corrigé, décision de Julien) — le plafond (`maxOwners`, 3)
    ne s'applique qu'à l'achat initial d'un terrain individuel (contrôle existant inchangé). La vente de gré à gré, la
    vente de lot, l'échange de parts, le rachat de lot à la banque et le regroupement ne le vérifient pas. Un lot
    regroupé peut donc compter plus de 3 copropriétaires (ex. 10 / 50 / 20 / 20 %) ; ses parts se vendent et
    s'échangent ensuite comme les autres, sans plafond.

**Tests** : `tests/section309-ventes.test.js` (51 vérifications : bogues 8, 9, 35, offres de parts),
`tests/section309-maisons.test.js` (43 : bogues 13, 33, compensation, offres de maisons, `migrateState`),
`tests/section309-lots.test.js` (25 : bogues 16, 34, 35, 63, regroupement au-delà du plafond),
`tests/section309-retouches.test.js` (29 : retouches de la revue — achats de l'Administration, écart du scénario Rose,
prix proposé, expiration des offres, échange réservé au créateur, message unique de compensation périmée). Fenêtres testées avec le
mini-DOM du banc (vrais gestionnaires de clics). Chaque correctif a sa contre-épreuve (`loadEngine({transform})`).
Monnaie conservée vérifiée sur chaque scénario. **19 fichiers, 1 338 vérifications et 53 cas multi-appareils, 0 échec ;
320 cas multi-appareils avec `SYNC_SEEDS=40`.**

**Documentation joueurs à mettre à jour** (cahiers 0, 5 et 7, aide-mémoire « Vendre une part ou des maisons ») :
- « Vendre une part » : le vendeur est toujours votre entreprise ; la banque rachète à sa valeur de rachat, annoncée
  avant confirmation (plus de prix libre) ; une vente à une entreprise est une offre que son CEO accepte ou refuse.
- « Vendre des maisons » : offre à accepter par le CEO acheteur, paiement à l'acceptation, encaisse vérifiée.
- Nouvelle rubrique « Offres de vente en attente » dans Mon Entreprise (Accepter / Refuser / Retirer) ; une offre
  expire au lancer de dés suivant son dépôt.
- Construction sur un lot dont la banque ou le REIT détient une part : la banque paie sa part (reçu équilibré).
- Compensation de maison : saisir la valeur convenue de la maison ; chaque autre copropriétaire paie sa quote-part ;
  la fenêtre affiche le montant réellement transféré ; un payeur sans encaisse suffisante bloque la construction.
- Échange de parts : impossible sur une part hypothéquée ou sous ABS.
- Regroupement : chaque copropriétaire garde au moins 1 % (une grande part peut céder près de 2 points quand
  plusieurs petites parts sont relevées) ; plus de 3 copropriétaires possibles après regroupement ;
  le plafond de 3 ne vaut qu'à l'achat initial d'un terrain.

**Intégration** (vague 2, branche `serie-309`) : les verrous de la section 311 (ABS conclue OU annoncée, swap de loyers spécifique) s'appliquent à toutes les voies de vente de cette section : vente à la banque, dépôt à blanc et acceptation d'une offre de part de terrain (`sellPropertyShare`, raccord fait à l'intégration) ou de lot (`sellMergedShare`). Une offre déposée puis rattrapée par une annonce d'ABS ou par un swap spécifique est refusée à l'acceptation (« Offre non exécutée — Co Bob a annoncé une émission ABS sur Aéroport 1… »), rien ne bouge, l'offre reste en attente, monnaie conservée. Échange de parts : un seul contrôle ABS et swap spécifique, dans `shareSwapGiveRefusal`, avec les messages de la section 311 (le contrôle en double d'`executeShareSwap` est retiré). Garde « terrain regroupé » d'`issueMortgage` unique, commune avec la section 312 ; dans la fenêtre d'hypothèque de la section 312, ce refus s'affiche dans la fenêtre redessinée « Les conditions ont changé ». Accepter ou refuser une offre de vente passe par le contrôle commun `offerResponderRefusal` (messages inchangés). Les offres de vente expirent au même endroit du cycle que les offres d'hypothèque (`advanceGameClock`, à côté de `expirePendingLoanRequests`, même écriture). Une offre de vente devenue inexécutable reste affichée jusqu'à son expiration au lancer suivant (refus clair à l'acceptation), alors qu'une offre d'hypothèque caduque est retirée tout de suite : choix du lot 2 conservé. Les maisons de réserve ne sont rattachées à aucun terrain : aucun verrou ABS ni swap ne s'y applique. Tests : `tests/section309-integration.test.js` (54 vérifications, contre-épreuve pour chaque raccord) ; `section309-lots` adapté (bogue 34 lu dans la fenêtre redessinée, message ABS de la section 311). Suite intégrée : 35 fichiers, 1 811 vérifications et 53 cas multi-appareils, 0 échec ; 320 cas multi-appareils avec `SYNC_SEEDS=40`.

**Décisions de Julien (2026-10-25)** — réponse aux questions du point d'étape, verbatim : « Ok go pour tes reco ».
Chaque changement du code porte le commentaire « Section 309 — décision de Julien (2026-10-25) ».

- **Plancher de valeur d'un terrain = prix réellement payé, en moyenne pondérée par les parts** (question de fond du
  point 10) — `modalBuyShares` (Administration › « Acheter des parts ») ne recopie plus le prix convenu dans
  `acquisitionPrice` (plancher de `intrinsicValue` pour 100 % du terrain). Nouveau plancher = plancher précédent ×
  (100 − parts achetées) / 100 + prix convenu × parts achetées / 100, le plancher précédent étant le prix de base s'il
  n'y en a pas. Les parts acquises sans prix enregistré (ou détenues par la banque) comptent au plancher précédent
  plutôt qu'au prix de base : il résume déjà les achats antérieurs (100 % achetés à 1,2, 50 % revendus à la banque puis
  rachetés à 1,0 → 1,1 ; avec le prix de base, 0,8 : un rachat partiel effacerait le prix payé avant). Le plancher
  monte au plus du montant réellement payé : la triche fait perdre de l'argent. *Avant* : Brun 1 (base 0,6), 99 %
  détenus, 1 % racheté « à 500 pour 100 % » (5 M$) → plancher 500, revente de 100 % à la banque : +370 M$. *Après* :
  plancher 0,99 × 0,6 + 0,01 × 500 = 5,594, valeur de rachat de 100 % 4,1955, gain net −0,80 M$. Achat honnête de
  100 % à 1,2 : plancher 1,2. Deux acheteurs (30 % + 20 %) à 2 sur Brun 2 (base 1,2) : 1,6. Un achat refusé ne change
  rien. La fenêtre rappelle la règle et affiche le plancher actuel. `wasSeized` (prix suggéré = valeur intrinsèque si
  le terrain a déjà été acheté par l'Administration) est inchangé : `acquisitionPrice` reste non nul après un premier
  achat. `modalBuyShares` est le seul endroit qui écrit `acquisitionPrice` (le rachat d'une part de lot,
  `buyMergedShareFromBank`, n'y touche pas). Parties existantes : un plancher déjà enregistré est conservé tel quel
  (les parts achetées à l'époque sont inconnues) ; champ absent → `null` (prix de base) par `migrateState`, comme avant.
- **Limite connue : un achat honnête PARTIEL n'est protégé qu'en partie.** Le plancher pondéré mêle le prix payé et le
  plancher des autres parts. Exemple : 50 % de Brun 2 (prix de base 1,2) achetés « à 2 pour 100 % » (1 M$ payé) →
  plancher 0,5 × 1,2 + 0,5 × 2 = 1,6 ; revendus aussitôt à la banque, ces 50 % rapportent 0,60 (0,5 × 0,75 × 1,6) au
  lieu de 0,75 (0,5 × 0,75 × 2) si le plancher était le prix payé. C'est le prix de la protection contre la triche du
  rachat de 1 % : seul un achat de 100 % garde un plancher égal au prix payé.
- **Retouches de la revue des décisions** (commentaire « Section 309-313 — retouche de la revue des décisions ») :
  - *Prix minimum = valeur de rachat de la banque.* Les parts non achetées comptant au plancher précédent, acheter 1 %
    « à 0,01 pour 100 % » sur un terrain au plancher 10 puis le revendre à la banque rapportait +0,074 par cycle
    (+4,70 sur 100 cycles). La banque ne vend plus jamais une part moins cher que ce qu'elle la rachèterait :
    `modalBuyShares` refuse un prix pour 100 % inférieur à `bankMinSalePrice100` (valeur de rachat pour 100 %,
    arrondie au centime supérieur, recalculée dans l'applyFn), `buyMergedShareFromBank` un prix inférieur à
    `buybackValueLot` × pourcentage (même défaut pour un lot : achat à 0,01 puis revente à la valeur de rachat). Le
    message donne le minimum (« au moins 7.50 pour 100 % ») ; les fenêtres l'annoncent et la fenêtre du terrain ne
    suggère jamais moins. Boucle « 1 % à 0,01 » au plancher 10 : +1,35 sur 20 cycles avant, 0 après ; au prix minimum,
    chaque cycle perd (−0,0047 sur 20 cycles).
  - *Terrain regroupé entre-temps* : l'applyFn de `modalBuyShares` refuse un terrain regroupé en lot entre l'ouverture
    de la fenêtre et la confirmation (« … fait désormais partie du lot … regroupé — rien n'a été acheté »).
- **Sans code** : part de la banque ou du REIT dans le coût d'une maison payée par la banque (gardé) ; pas de
  compensation en argent de l'écart d'arrondi du regroupement (gardé) ; choix déjà faits confirmés (vente de part à une
  entreprise par offre à accepter, prix proposé = valeur de rachat de la banque, compensation de maison refusée si un
  copropriétaire ne peut pas payer).
- **Tests** : `tests/section309-decisions.test.js` (33 vérifications, par la vraie fenêtre sur le mini-DOM ;
  contre-épreuves : l'ancienne ligne réintroduite redonne un plancher de 500 et +370 M$ ; prix minimum retiré, terrain
  et lot ; contrôle du regroupement retiré) ; contre-épreuves de `tests/section309-retouches.test.js` adaptées
  (plancher 5,594 et non 500 ; rachat de lot à 0,2, au-dessus du minimum).
- **Joueurs** (cahier 5, aide-mémoire) : le prix convenu lors d'un achat de parts à la banque ne relève le plancher de
  valeur du terrain qu'au prorata des parts achetées ; un achat partiel est donc moins bien protégé qu'un achat de
  100 % (50 % de Brun 2 achetés « à 2 pour 100 % » se revendent 0,60 à la banque, et non 0,75) ; la banque ne vend
  jamais une part (terrain ou lot) moins cher que sa valeur de rachat, et la fenêtre annonce ce prix minimum.

## 311. Titrisation (ABS), swaps de loyers et accords de compensation : lot de couleur regroupé exigé, durée servie = durée payée, terrain verrouillé dès l'annonce, actif au bilan du souscripteur — 2026-10-24

Contexte : lot 4 de la série de corrections des bogues moyens et faibles de l'audit du 2026-10-19 (cadre de
synchronisation de la section 308). Demandes de l'utilisateur, verbatim : « Moyens : tout corriger SAUF le 12 » ;
« Faibles : tout corriger SAUF 45, 51 et 53 » ; « 18 : une titrisation n'est permise que sur un lot de couleur déjà
regroupé ; les aéroports et services font exception et restent permis » ; « swap de loyer spécifique : bloquer la
vente du terrain concerné » ; « souscripteur d'ABS : garder un actif à son bilan (42) » ; « anciennes parties et
migration des prêts joueurs : ne pas traiter ». Bogues traités : 18, 19, 20, 21, 22, 30, 42, 70, la décision « swap
spécifique », et un point ajouté en cours de lot (signalé par le lot 5) : qui peut accepter ou refuser une offre de
swap ou de compensation. Chaque changement du code porte le commentaire « Section 311 ».

1. **ABS seulement sur un lot de couleur déjà regroupé** (bogue 18, décision de l'utilisateur) — nouvelle
   `absPropertyNotEligibleReason` : un terrain de couleur non regroupé est refusé à l'annonce
   (`postRevenueSwapListing`), absent de la fenêtre de publication (`revenueSwapSellableItems`) et revérifié à la
   résolution (`resolveRevenueSwapListing`). Aéroports et services : permis terrain par terrain, comme avant.
   **Parties en cours** (pas de migration rétroactive) : `mergeGroup` refuse de regrouper un lot tant qu'une ABS court
   (ou est annoncée) sur un de ses terrains (« Regroupement impossible : une émission ABS court… attendez son
   échéance »). Scénario de l'audit (Co A : ABS1 sur Brun 1 souscrite par Co C, ABS2 sur Brun 2 souscrite par Co D,
   3 maisons, 10 passages de Co B) : avant, lot regroupé, C reçoit 8,10 et D 0 ; après, regroupement refusé, C reçoit
   2,70 et D 5,40 (chacun sa part cédée), monnaie conservée.
2. **Durée servie = durée payée** (bogue 19) — le prix suppose years × 6 lancers ; l'accord porte désormais
   `endRoll` = lancer de résolution + years × 6 (toujours un début de semestre) et expire par `expireRevenueSwaps`, à
   la fin d'année et à chaque changement de semestre ; `yearsRemaining` affiche la durée restante (0,5 an possible).
   Accords existants : `endRoll = null` dans `migrateState`, décompte annuel inchangé. ABS d'un an publiée au lancer 3 :
   avant, servie aux lancers 3, 4, 5 (3 lancers pour 6 payés) ; après, lancers 3 à 8.
3. **Plafond d'encaisse sur le total des deux tranches** (bogue 20) — à la résolution, la senior est répartie d'abord ;
   la junior d'un même souscripteur est plafonnée à son encaisse moins ce qui lui est attribué en senior. Carl, 2 M$,
   souscrit 2 en senior et 2 en junior : avant, il paie 4 et finit à −2 ; après, 2 en senior, 0 en junior, encaisse 0
   (avec 3 M$ : 2 + 1). Mention dans la fenêtre de souscription.
4. **Terrain verrouillé dès l'annonce, tout revérifié à la résolution** (bogue 21) — `isPropertyLockedByRevenueSwap`
   couvre aussi les annonces en attente : vente, hypothèque, swap de loyers et nouvelle annonce refusés dès l'annonce ;
   l'échange de parts (`executeShareSwap`), jusque-là sans contrôle ABS, est refusé lui aussi. L'annonce mémorise les
   parts détenues (`ownedShares`) ; à la résolution : hypothèque de l'émettrice, autre ABS, part réduite, loyer attendu
   recalculé inférieur à celui affiché (maisons vendues, palier perdu) → annulation propre, personne ne paie, raison au
   journal. Construire une maison entre-temps ne gêne pas. Scénario de l'audit (A annonce sur le lot Bleu foncé, C
   souscrit 3, A hypothèque avant le lancer) : avant, C paie 3 puis reçoit 0 à chaque passage ; après, l'hypothèque est
   refusée, l'ABS est conclue et C reçoit sa part (51 sur 5 passages avec 4 maisons). Messages (retouche de la revue,
   `revenueSwapLockMessage`) : pendant l'annonce, « Co A a annoncé une émission ABS sur le lot Bleu foncé, résolue au
   prochain lancer de dés — impossible de … tant que l'annonce est en attente » ; une fois conclue, « Co A a vendu le
   revenu du lot Bleu foncé en ABS — impossible de … tant que l'accord court ». Le journal de résolution et la fenêtre
   d'émission ne parlent plus de « fusionner en lot » ni de « lots toujours permis ».
5. **Deux swaps de loyers en conflit** (bogue 22, option la plus sûre) — `rentSwapConflictReason` refuse la
   proposition et la signature (revérifiée dans `createRentSwap`) d'un swap qui entrerait en conflit avec un swap
   actif : deux côtés généraux ou à budget pour la même entreprise, ou deux côtés spécifiques sur le même terrain/lot.
   Un spécifique et un général restent compatibles (précédence de la section 258). Une offre refusée à la signature
   reste en attente. Scénario de l'audit (A ⇄ B général, puis A ⇄ C général) : avant, signé, et quand D visite A seul B
   reçoit, quand D visite C c'est A qui reçoit (le swap A ⇄ C ne joue que dans un sens) ; après, le second est refusé.
   Retouche de la revue : le côté d'un swap à budget est ÉPUISÉ quand le partenaire a reçu tout son plafond (section
   259 : « sa part arrête ») ; ce côté n'est plus retenu par `swapSplit` (il redirigeait déjà 0) ni compté comme conflit
   (`rentSwapBudgetSideExhausted`), sinon une entreprise restait bloquée à vie par un swap à budget dont le partenaire
   n'a pas de terrain. Le côté qui peut encore progresser (terrains présents et futurs) reste actif : les règles ne
   prévoient aucune résiliation.
6. **Swap de loyers spécifique : vente et échange bloqués** (décision de l'utilisateur) — `rentSwapSaleLockMessage`,
   revérifiée dans l'applyFn de la fenêtre « Vendre une part », de `sellMergedShare` et d'`executeShareSwap` : « Co A a
   engagé Rose 1 dans un swap de loyers avec Co B — impossible de vendre sa part de ce terrain tant que le swap court
   (encore 2 an(s)). » Les deux côtés spécifiques sont bloqués ; un côté général ne bloque rien ; un copropriétaire qui
   n'est pas partie au swap vend librement.
7. **Aéroports et services en copropriété** (bogue 30) — `expectedRentValue(p, companyId)` et
   `intrinsicValue(p, companyId)` : palier de l'entreprise concernée pour la valeur de sa part
   (`companyRealEstateValue`), le prix de son ABS (`computeAbsPricing`) et le résumé de swap ; sans entreprise, moyenne
   des paliers pondérée par les parts, indépendante de l'ordre. Co1 détient la moitié de l'Aéroport 1, Co0 l'autre
   moitié et les trois autres : espérance de l'ABS de Co1 (1 an, 60 %) avant 0,2133 si Co0 est listée en premier
   (0,0267 sinon), après 0,0267 dans les deux cas, cohérente avec le loyer réellement versé (0,125 par passage) ;
   valeur immobilière de Co1 avant 2,0056 ou 1,75 selon l'ordre, après 1,75. Retouche de la revue : le tableau des
   terrains de l'onglet Entreprise affiche aussi le palier de l'entreprise (`intrinsicValue`, `intrinsicValueLot`,
   `expectedRentValue` avec `company.id` : 125 K$ au lieu de 563 K$ dans l'exemple), et un copropriétaire sans
   entreprise ne provoque plus de récursion infinie (`o.companyId ?? null`).
8. **Actif au bilan du souscripteur** (bogue 42, décision de l'utilisateur) — `companyAbsHoldingsValue` : flux que la
   participation doit encore rapporter selon le modèle même de la tarification (`computeAbsPricing` sur les lancers
   restants, état du moment), répartis selon la cascade (senior : au plus le reste de son plafond ; junior :
   l'espérance au-delà), au prorata de la mise ; non actualisé, comme les prêts à recevoir. Ce qui est encaissé sort
   de la valeur ; 0 à l'échéance ; la rétention junior de l'émettrice n'est pas comptée. Compté dans `companyValue` et
   au bilan (« ↳ Titres ABS détenus (flux attendus) », actifs long terme, instantanés de semestre). **Contre-actif de
   l'émettrice** (retouche de la revue, décision de l'orchestrateur à valider par l'utilisateur) : l'émettrice gardant
   son terrain à pleine valeur, le flux était compté deux fois (somme des `companyValue` +11,13 en senior seule,
   +22,16 avec une junior « bradée » à 0,01, sans monnaie déplacée). Elle inscrit « ↳ Flux ABS cédés (contre-actif) »
   = valeur des parts tenues par des tiers, même calcul (`absHolderValues`) : déduit de `companyValue` et du bilan,
   pas de `companyDebt` (pas de dette côté émettrice, section 304). La somme des valeurs ne bouge plus à la
   résolution, aux versements ni à l'échéance ; une junior bradée n'est plus qu'un transfert de valeur réel (A +12,88,
   émettrice −12,88). Joueur porteur : titres comptés dans `netWorth` (classement), pas dans `marginableNetWorth`
   (titre non liquide). A souscrit 5 en senior (plafond 6) : avant, valeur de A 50 → 45 ; après, A +1 et émettrice −1
   (somme inchangée) ; un versement de 6 fait passer l'actif à 0 sans changer la valeur de A.
9. **ABS + accord de compensation** (bogue 70) — l'émettrice enregistre, comme sans compensation, la charge d'intérêt
   d'ABS et le loyer réglé en argent (versé aux porteurs, retenues de prêt) ; la part nette inscrite au registre est
   constatée au règlement de fin d'année (`rent_compensation_revenue`), jamais deux fois. Trésorerie inchangée. Co1
   (90 % du lot Vert, ABS à 60 %, compensation avec Co0), loyer de 1,17 pour sa part : avant, ni loyer ni intérêt ;
   après, loyer 0,702, intérêt −0,702, registre 0,468 (règlement : 0,4914 avec 5 %) — au total 1,17, comme sans
   compensation.
10. **Offres de swap et de compensation : seule l'entreprise destinataire répond** (point ajouté, signalé par le lot
   5) — `refuseRentSwapOffer`, `refuseRentCompensationOffer`, et aussi `acceptRentSwapOffer` /
   `acceptRentCompensationOffer`, ne vérifiaient pas qui répondait : n'importe quel joueur pouvait effacer l'offre faite
   à une autre entreprise, voire la signer à sa place. `rentOfferResponderRefusal` (dans l'applyFn) : seul le CEO de
   l'entreprise destinataire accepte ou refuse ; l'auteur garde « Retirer ». L'interface ne montrait déjà les boutons
   qu'au destinataire.

**Tests** : `tests/section311-abs-lot` (18), `-abs-duree` (11), `-abs-souscription` (8), `-abs-verrou` (18),
`-swaps` (16), `-swap-vente` (11, par la vraie fenêtre sur le mini-DOM du banc), `-copropriete` (8), `-abs-bilan` (12),
`-abs-compensation` (11), `-offres` (10) : 123 vérifications, portées à 151 par les retouches de la revue
(`-abs-bilan` 28, `-swaps` 21, `-copropriete` 12, `-abs-verrou` 21), chaque correctif avec sa contre-épreuve. Adaptés :
`audit-bug1` (lots Bleu foncé et Orange regroupés, règle 1) et `section308-transaction` scénario E (l'appareil qui
accepte est celui du destinataire, point 10). **25 fichiers, 1 341 vérifications et 53 cas multi-appareils, 0 échec ;
320 cas multi-appareils avec `SYNC_SEEDS=40`.**

**Changements visibles pour les joueurs (cahier 8 et aide-mémoire)** : une ABS ne se publie que sur un lot de couleur
regroupé, un aéroport ou un service ; un lot ne se regroupe pas pendant une ABS d'une ancienne version sur un de ses
terrains ; durée d'une ABS comptée en lancers depuis la résolution (durée restante en demi-années) ; le total souscrit
dans les deux tranches ne dépasse jamais l'encaisse (senior servie d'abord) ; terrain verrouillé dès l'annonce
(vente, échange, hypothèque, swap), annulation à la résolution si le terrain a changé ou si le loyer attendu a baissé ;
deuxième swap général (ou deuxième swap sur un même terrain) refusé ; terrain engagé dans un swap spécifique invendable
et non échangeable tant que le swap court ; valeur des aéroports et services au palier de chaque copropriétaire ;
lignes « Titres ABS détenus » et « Flux ABS cédés (contre-actif) » au bilan ; titres ABS d'un joueur comptés dans sa
valeur nette (pas dans sa marge) ; un côté épuisé d'un swap à budget ne bloque plus de nouveau swap ; messages de refus
propres à une annonce d'ABS ; seul le CEO destinataire répond à une offre de swap ou de compensation.

**Intégration** (vague 2) : la fenêtre « Vendre une part » est désormais celle de la section 309 (vendeur imposé, offre à accepter, banque au prix de rachat). Le verrou du swap spécifique (point 6) et le verrou ABS (point 4) y sont reportés dans `sellPropertyShare` : vente à la banque, dépôt de l'offre et acceptation, revérifiés sur l'état frais. Échange de parts : un seul contrôle, dans `shareSwapGiveRefusal`. Offre d'hypothèque de la section 312 : verrou ABS (annonce comprise) et message de cette section dans `mortgageAssetTerms`. L'annonce d'une ABS retire, dans la même écriture, une offre d'hypothèque en attente sur le terrain (trace au journal). `rentOfferResponderRefusal` délègue au contrôle commun `offerResponderRefusal`. Loyer : les chemins ABS et compensation (point 9) passent par la retenue de prêt de la section 312 (`applyRentLoanWithholding`, seule voie) dans `settlePropertyRent` et `settleNeutralPawnRent`. `mergeGroup` : refus pendant une ABS et arrondi de la section 309 conservés tous deux. Tests : `section311-swap-vente` réécrit sur la nouvelle fenêtre (19 vérifications, dont « offre déposée puis swap spécifique signé » et la vente à la banque) ; contre-épreuve de `section311-offres` recadrée sur le contrôle commun ; scénarios croisés dans `section309-integration`.

**Décisions de Julien (2026-10-25)** — réponse aux questions du point d'étape, verbatim : « Ok go pour tes reco ».
Chaque changement du code porte le commentaire « Section 311 — décision de Julien (2026-10-25) ».

- **Résiliation amiable d'un swap à budget** (question 8 de la revue) — un swap à budget cumulatif n'a pas de durée et
  ne prend fin qu'à l'épuisement de ses deux côtés : s'aucun côté ne progresse, il liait les deux entreprises sans
  limite. L'un des deux CEO propose la résiliation (`proposeRentSwapTermination`, bouton « Proposer une résiliation
  amiable » dans le tableau des swaps actifs) ; la demande est enregistrée dans `state.rentSwapTerminationRequests`
  (défaut `[]` dans `migrateState` et à la création : `{id, swapId, fromCompanyId, toCompanyId, byPlayerId, roll,
  createdAt}`). Seul le CEO de l'autre entreprise l'accepte ou la refuse (`rentOfferResponderRefusal`), l'auteur peut
  la retirer ; elle s'affiche dans « Propositions en attente » des deux entreprises et expire au lancer de dés suivant
  (`expireRentSwapTerminationRequests`, à côté de `expireAssetSaleOffers`, trace au journal). À l'acceptation, le swap
  prend fin sans aucun paiement (ce qui a été reçu reste acquis). Tout est revérifié dans les applyFn sur l'état frais :
  swap encore actif et à budget, CEO d'une des deux entreprises, une seule demande en attente par swap, destinataire,
  lancer inchangé ; un swap déjà épuisé rend la demande « sans objet » (retirée). Un swap à durée ne se résilie pas (il
  prend fin à son échéance). Un ancien swap sans identifiant en reçoit un déterministe (`rs-ancien-<rang>-<A>-<B>`,
  identique sur tous les appareils). *Avant* : swap à budget A ⇄ B (5 / 5) sans progrès → A ne pouvait plus signer
  aucun swap général. *Après* : Alice propose, Bob accepte → le swap prend fin, encaisses et monnaie inchangées, A signe
  ensuite un swap général avec C ; Alice ne peut pas accepter sa propre demande, un tiers ne peut ni accepter ni refuser.
- **Regroupement refusé avec deux swaps spécifiques d'une même entreprise sur le lot** (question 9) — `mergeGroup`
  (`mergeGroupSpecificSwapsRefusal`, comme pour une ABS en cours) refuse le regroupement quand une même entreprise a
  des swaps spécifiques actifs sur deux terrains (côtés) différents du lot, avec un message qui nomme l'entreprise, les
  terrains et les partenaires. *Avant* : Brun 1 et Brun 2 à A, swaps A (Brun 1) ⇄ B (Jaune 1) et A (Brun 2) ⇄ C
  (Vert 1) ; après regroupement, `swapSplit` ne retenait que le premier pour le lot : le loyer de Brun 2 partait chez B
  et C ne recevait plus rien. *Après* : « Regroupement impossible : Co Alice a des swaps de loyers spécifiques actifs
  sur plusieurs terrains de ce lot — Brun 1 (avec Co Bob), Brun 2 (avec Co Carl)… » ; à l'échéance de l'un d'eux, le
  regroupement redevient possible. Restent permis : un seul swap spécifique (avec ou sans swap général), et deux
  entreprises différentes ayant chacune un swap sur un terrain du lot. Les côtés sont comptés (et pas seulement les
  terrains) : deux swaps spécifiques d'une même entreprise sur le même terrain, possibles seulement dans une partie
  antérieure au bogue 22, bloquent aussi le regroupement.
- **Tests** : `tests/section311-decisions.test.js` (42 vérifications, dont les vrais boutons sur le mini-DOM ;
  contre-épreuves : contrôle du destinataire retiré, expiration retirée, refus du regroupement retiré).
- **Joueurs** (cahier 8, aide-mémoire) : un swap à budget peut être résilié à l'amiable, sans paiement, si les deux CEO
  sont d'accord (demande valable jusqu'au lancer suivant) ; un lot ne se regroupe pas tant qu'une même entreprise a des
  swaps spécifiques sur deux de ses terrains.

## 312. Financement et crédit : ratio d'endettement, taux plafonné, prêts et hypothèques (audit, lot 5) — 2026-10-24

Contexte : lot 5 de la série de corrections des bogues moyens et faibles de l'audit du 2026-10-19 (bogues 10, 23, 24,
47, 50 et 65). Demandes de l'utilisateur, verbatim : « Moyens : tout corriger SAUF le 12 » ; « Faibles : tout corriger
SAUF 45, 51 et 53 » ; « 65 : plafonner le taux final au maximum choisi à la création » ; « hypothèque auprès d'une
autre entreprise : étape d'acceptation par le CEO prêteur » ; « anciennes parties et migration des prêts joueurs : ne
pas traiter ». Travail fait dans une copie isolée, dans le cadre de synchronisation de la section 308 ; chaque
correction a un test qui échoue sur l'ancien code (contre-épreuve) et réussit sur le nouveau. Chaque changement du
code porte le commentaire « Section 312 ».

1. **Ratio d'endettement : une encaisse négative compte comme une dette** (bogue 10, `companyDebtRatio`) — avant,
   actifs = valeur + dette : quand l'encaisse négative dépassait les autres actifs, les actifs devenaient ≤ 0 et le
   ratio valait 0. L'entreprise la plus insolvable avait la cote AA, le taux de base, la volatilité minimale et
   échappait à la spirale de détresse. Désormais ratio = (dettes + découvert) / actifs positifs (encaisse positive,
   immobilier, REIT, créances). Le seuil d'insolvabilité est inchangé (ratio ≥ 1 exactement quand la valeur comptable
   est ≤ 0). Sans aucun actif positif mais avec une dette, le ratio prend la valeur plafond technique 1 000
   (`DEBT_RATIO_MAX`, ni infini ni NaN). Effets sur tous les appelants : cote de crédit, taux hypothécaire et taux de
   la subvention d'avance (`riskAdjustedRate`), volatilité des cubes (`volatilityMultiplier`, bornée à 2,5), σ des
   options (`companyAnnualSigma`), condition d'endettement de la spirale de détresse. Cohérent avec la section 306
   (le prêt compte toujours dans la dette, sans cube rouge à l'emprunt).
   Scénario : Alpha, sans terrain, doit 12,5 M$. Encaisse +0,5 M$ : ratio 25, cote D, put d'un semestre à 8,05 % du
   cours. Encaisse −3 M$ (pire) — avant : ratio 0, cote AA, taux hypothécaire 35 %, 1re subvention 1,82 M$,
   volatilité 1, put 3,22 % ; après : ratio au plafond, cote D, taux 85 %, subvention 1,25 M$, volatilité 2,5, put
   8,05 %. Créance 10 M$, dette 2 M$, encaisse −1 M$ : ratio 0,30 (avant 0,22).
2. **Taux final plafonné au maximum choisi à la création** (bogue 65, décision de l'utilisateur, `riskAdjustedRate`) —
   taux = taux de base + min(1, ratio) × prime max « si 100 % endetté ». La subvention d'avance suit
   (`goAdvanceAmount`). Avant : encaisse 0,01 M$ et 12,5 M$ de dette → taux hypothécaire 62 535 % et 1re subvention
   0,003 M$ ; après : 85 % (35 % + 50 %) et 1,25 M$ (2 / 1,6). Sous 100 % d'endettement, rien ne change (ratio 0,5 →
   35 % + 25 % = 60 %). Une prime max réglée à 30 % plafonne le taux hypothécaire à 65 %.
3. **Prêt de dernier recours toujours remboursé** (bogue 23, `applyRentLoanWithholding`) — **choix à valider** : les
   règles ne rattachent pas ce prêt à l'option « Prêts » (son libellé vise le marché des obligations ; la matrice des
   produits le présente comme le recours « sans condition »). Il reste donc offert dans toutes les parties, mais sa
   retenue de 50 % des loyers s'applique désormais même sans l'option, sur les quatre chemins du loyer (loyer
   ordinaire, pion neutre, terrain titrisé, accord de compensation). Les prêts ordinaires restent commandés par
   l'option. Scénario (partie sans « Prêts ») : Alpha à −1 M$ prend le prêt (10 M$, 20 M$ à rembourser) ; Beta paie un
   loyer de 6 M$ — avant : 6 M$ à Alpha, rien retenu (10 M$ gratuits, répétables) ; après : 3 M$ à la banque, 3 M$ à
   Alpha.
4. **Offre de prêt modifiée par le prêteur** (bogue 24, `modalAcceptLoanOffer`, `loanOfferConditions`,
   `acceptLoanOffer`) — « Accepter » ouvre une confirmation (`confirmWithFreshConditions`) qui part des conditions
   affichées sur la ligne ; si l'offre a changé entre-temps (même identifiant), rien n'est signé : la fenêtre montre
   les nouvelles conditions et redemande confirmation. L'action revérifie les conditions confirmées sur l'état frais
   (course avec une sauvegarde concurrente → 2e confirmation). Scénario : Bob offre 5 % / 1× / non garanti, Alice
   ouvre la fenêtre, Bob passe à 30 % / 2,5× / garanti — avant : le clic d'Alice signait 30 % / 2,5× / garanti ;
   après : rien n'est signé avant qu'elle ait vu et confirmé ces conditions.
5. **Bornes du prêt d'arbitrage appliquées par le moteur** (bogue 47, `loanTermsError` dans `issueLoan`) — % de
   retenue et multiple compris dans les bornes des réglages de la partie (5–40 % et 1–2,5× par défaut), strictement
   positifs et numériques, pour tout prêt ordinaire. Avant : 0 % (prêt jamais remboursé), −40 % (plafond cumulatif
   contourné), multiple négatif (capital perdu) étaient acceptés ; après : refus « Le % des loyers retenu doit être
   entre 5% et 40% », rien ne bouge.
6. **Hypothèque auprès d'une autre entreprise = offre acceptée par son CEO** (bogue 50 et décision de l'utilisateur ;
   `proposeMortgageOffer`, `acceptMortgageOffer`, `refuseMortgageOffer`, `cancelMortgageOffer`,
   `mortgageAssetTerms`, `mortgageLenderError`, `modalMortgageAsset`, `modalAcceptMortgageOffer`) — auprès de la
   banque, l'hypothèque reste immédiate (conditions revérifiées à la confirmation). Auprès d'une entreprise, la
   confirmation crée une offre (`state.mortgageOffers`, défaut `[]` dans `migrateState` : identifiant, emprunteur,
   prêteur, terrain ou lot, part, montant, taux, auteur, date et lancer) ; rien ne bouge avant l'acceptation. Seul le
   CEO prêteur accepte (confirmation aux conditions de l'offre, qui sont figées : montant et taux affichés à
   l'emprunteur) ou refuse ; l'auteur peut retirer son offre ; une seule offre en attente par part. À l'acceptation,
   tout est revérifié sur l'état frais : encaisse du prêteur, part inchangée, montant ≤ maximum hypothécable actuel,
   terrain non regroupé en lot, lot non dissous, part non hypothéquée entre-temps, verrou ABS, partie terminée ; si
   l'offre n'est plus valable, refus clair et l'offre reste (le prêteur la refuse ou l'auteur la retire). Le moteur
   (`issueMortgage`, `issueMortgageLot`) refuse désormais un prêteur non bancaire sans offre acceptée et vérifie son
   encaisse. Les offres apparaissent dans « Propositions en attente » de l'onglet de l'entreprise (prêteur :
   Accepter / Refuser ; emprunteur : Retirer). Scénario de l'audit : Co Bob a 2 M$ ; pendant que la fenêtre d'Alice
   est ouverte, Bob dépense 1,9 M$ ; Alice confirme — avant : Co Bob avance 2 M$ sans avoir accepté et tombe à
   −1,90 M$ ; après : une offre est créée, Co Bob reste à 0,10 M$ ; son acceptation est refusée faute d'encaisse
   (l'offre reste) ; renfloué, il accepte : Co Bob −2 M$, Co Alice +2 M$, monnaie conservée.
7. **Retouches de la revue** — (a) **Expiration** : une offre d'hypothèque ne vaut que jusqu'au lancer de dés suivant
   sa création (`expirePendingMortgageOffers`, au même endroit du cycle que les demandes d'emprunt, trace au journal) ;
   `acceptMortgageOffer` refuse une offre expirée. Sans cela, le prêteur choisissait le moment : offre de 2 M$ à 35 %
   au lancer 0, acceptée 40 lancers plus tard sur une emprunteuse à −5 M$ juste avant la fin d'année → intérêt
   impayable, part et maisons (6,7 M$) saisies pour 2 M$ avancés ; après : refus « Cette offre d'hypothèque a
   expiré ». (b) **Offres caduques** : une offre dont la part a été hypothéquée auprès de la banque, vendue en tout ou
   en partie, regroupée en lot, ou dont le lot a été dissous, est retirée dans la même écriture que le changement
   (`dropStaleMortgageOffers`, appelée à la fin de chaque action réussie dans `runActionWithRetry`), avec une trace au
   journal ; une part déjà proposée n'est plus listée comme éligible dans « Hypothéquer ». L'acceptation revérifie
   quand même tout (ancien onglet). (c) Garde « terrain regroupé » : même message que le lot 2 (« … fait désormais
   partie du lot … regroupé — rien n'a été fait ; hypothéquez votre part du lot entier (menu Hypothéquer). »).
   (d) Les offres reçues apparaissent aussi dans « Propositions en attente » du Portefeuille du CEO prêteur (Accepter /
   Refuser). (e) Libellé de l'option « Prêts » : « … — le prêt de dernier recours reste offert et remboursé par
   retenue, même sans cette option » (choix du point 3, à valider).

**Tests** : `tests/section312-ratio.test.js` (21 vérifications : bogues 10 et 65), `tests/section312-prets.test.js`
(77 : bogues 23, 24 et 47, dont une contre-épreuve par chemin du loyer pour le 23 et deux appareils pour le 24),
`tests/section312-hypotheque.test.js` (47 : bogue 50, deux appareils, scénario de l'audit, expiration au lancer,
offres caduques, revérifications à l'acceptation, droits d'accepter, refuser et retirer, Portefeuille, banque
immédiate), nouveau banc `tests/helpers/appareils-312.js` (deux moteurs partageant la partie, vrais gestionnaires de
clics). Chaque correctif a sa contre-épreuve (`loadEngine({transform})`). **Suite complète : 18 fichiers, 1 335
vérifications et 53 cas multi-appareils, 0 échec ; 320 cas multi-appareils avec `SYNC_SEEDS=40`.** Monnaie conservée
dans chaque scénario.

**Hors périmètre** (autres lots ou décision de l'utilisateur) : 12, 45, 51, 53, 61, 62, 31 (marge), 94 et 97
(affichage), dette « productive », migration des anciens prêts de joueurs.

**Changements visibles pour les joueurs (cahiers à mettre à jour, cahier 7 surtout)** : une entreprise en encaisse
négative est désormais traitée comme endettée (cote de crédit plus basse, jusqu'à D ; taux plus élevés ; cours plus
volatil ; options plus chères ; spirale de détresse possible) ; le taux d'emprunt ne dépasse jamais taux de base +
prime max du réglage (la subvention d'avance a donc un plancher) ; le prêt de dernier recours est remboursé par 50 %
des loyers dans toutes les parties ; accepter une offre de prêt passe par une fenêtre de confirmation qui signale une
offre modifiée ; le prêt d'arbitrage refuse les valeurs hors bornes ; l'hypothèque auprès d'une autre entreprise
devient une offre que le CEO prêteur accepte ou refuse avant le prochain lancer de dés (onglet de son entreprise ou
Portefeuille ; sinon elle expire) ; elle est retirée si la part change entre-temps (la banque reste immédiate) ;
le libellé de l'option « Prêts » précise que le prêt de dernier recours reste disponible et remboursé.

**Intégration** (vague 2) : la garde « terrain regroupé » d'`issueMortgage` est unique (message de la section 309). `dropStaleMortgageOffers` est protégé dans `runActionWithRetry` par un try/catch (erreur dans la console) : une exception ne fait jamais échouer l'action (sans protection, elle rejetait l'action sans restaurer l'état et pouvait bloquer toute la partie) ; les offres restent alors en place et leur acceptation revérifie tout. Les motifs de retrait sont calculés avant toute écriture. Verrou ABS de la section 311 (annonce comprise) et son message dans `mortgageAssetTerms`. Accepter ou refuser une offre d'hypothèque passe par le contrôle commun `offerResponderRefusal`. Expiration au même endroit du cycle que les offres de vente de la section 309. Retenue de prêt : `applyRentLoanWithholding` est la seule voie sur les quatre chemins du loyer, chemins ABS et compensation de la section 311 compris. Scénario : part de 1,17 de loyer sous ABS à 60 %, accord de compensation, prêt ordinaire à 20 % et prêt de dernier recours. Option « Prêts » cochée : porteur 0,702, prêt ordinaire 0,234, dernier recours 0,117, registre 0,117. Décochée : porteur 0,702, dernier recours 0,234, registre 0,234. Monnaie conservée dans les deux cas. Le ratio d'endettement s'appuie sur `companyValue`, qui compte les titres ABS et le contre-actif de la section 311. Tests : contre-épreuve de `section312-hypotheque` recadrée sur l'appel protégé ; « nettoyage qui lève : l'action est quand même enregistrée » dans `section309-integration`.

## 313. Assurance : franchise jamais négative, prime revérifiée à la confirmation, indemnité plafonnée au montant couvert, types désactivés respectés, plus de couverture en double — 2026-10-24

Contexte : lot 6 de la série de corrections de l'audit du 2026-10-19 (bogues 14, 15, 39, 40, 48, 49 et 52).
Demandes de l'utilisateur, verbatim : « Moyens : tout corriger SAUF le 12 » ; « Faibles : tout corriger SAUF 45, 51
et 53 » ; « 39 : plafonner l'indemnité d'assurance au montant couvert affiché à la signature ». Les bogues 51 et 53
(assurance) ne sont pas traités, comme demandé. Chaque changement du code porte le commentaire « Section 313 ».
Le cadre de synchronisation de la section 308 est respecté : toutes les mutations passent par
`attemptActionWithRetry` / `runModalActionWithRetry`, les conditions affichées passent par
`confirmWithFreshConditions`.

1. **Franchise jamais négative (bogue 14)** : `sanitizeDeductible` (nombre fini, au moins 0). La franchise du
   tour est enregistrée par `setTurnDeductible`, qui refuse un montant négatif ou invalide (« La franchise doit être
   un montant positif ou nul. ») ; le champ porte `min="0"` et revient à la franchise enregistrée après un refus.
   `purchaseInsuranceBundle` refuse lui aussi une franchise négative. Les cotations (`insuranceQuote`,
   `subInsuranceQuote`, `taxInsuranceQuote`, prix de reprise) et les sinistres (`settlePropertyRent`, `payTax`)
   bornent la franchise des contrats existants : elle n'est jamais négative et ne dépasse jamais la perte.
   `migrateState` ramène à 0 une franchise du tour négative.
   *Avant* : franchise −5, Bleu foncé 2 (loyer 0,5) coté « 5,5 à risque » pour 1,32 ; au sinistre la banque payait
   5,5, B recevait 0,5 : **5 M$ détruits**. *Après* : refusé à la saisie et au moteur ; un contrat existant à −5
   donne banque −0,5, B +0,5, A 0, masse conservée. Même chose pour une taxe assurée (TPS/TVQ : l'assureur paie 1 et
   non 6).
2. **Prime revérifiée à la confirmation (bogues 15 et 49)** : `insuranceBundleConditions` calcule les conditions
   d'un contrat groupé (primes, montants couverts, franchise, terme, cases retirées) sur l'état COURANT pour les
   cases cochées et la franchise SAISIE. Au clic sur « Confirmer la sélection » (`confirmInsuranceBundle`), la
   dernière valeur reçue est adoptée et les conditions recalculées avec la franchise tapée (même si le champ n'a
   pas encore été quitté, cas des téléphones) : identiques à celles affichées, le contrat est signé ; différentes,
   la fenêtre « Les conditions ont changé » montre les nouvelles primes et rien n'est signé avant la 2e
   confirmation. L'applyFn (`purchaseInsuranceBundle`) recalcule encore les primes sur l'état frais et renvoie
   `staleConditionsResult()` si elles diffèrent des conditions confirmées (ou, sans conditions confirmées, si une
   prime passée diffère de la prime à jour). La franchise confirmée devient celle du tour. Une case devenue
   inassurable entre-temps (assurée par un autre, hors de portée) est retirée et nommée.
   *Bogue 15, avant* : franchise 1,9 affichée, Impôt sur le revenu coté 0,0184 ; le joueur tape 0 et confirme :
   contrat à franchise 0 au prix 0,0184 (juste prix 0,3687). *Après* : refus « conditions changées », nouvelle
   confirmation à 0,3687 pour la franchise 0.
   *Bogue 49, avant* : sous-standard sur Bleu foncé 2 cotée 0,0278 en case 37 (1/36) ; un autre appareil amène le
   pion en case 32 (6/36) ; contrat signé à 0,0278. *Après* : « Les conditions ont changé », prime 0,1667, 2e
   confirmation.
3. **Indemnité plafonnée au montant couvert affiché à la signature (bogue 39, décision de l'utilisateur)** :
   chaque contrat (terrain, sous-standard, taxe) enregistre `coveredAmount` = le montant « à risque » affiché à la
   signature (perte − franchise). Au sinistre, `insuranceIndemnity` : l'assureur paie au plus ce montant ; la
   franchise ET la part du loyer (ou de la taxe) au-delà du montant couvert sont payées par l'assuré (ligne « au-delà
   du montant couvert à la signature » dans la transaction et le journal) ; le propriétaire reçoit toujours le loyer
   entier. Le prix de reprise d'un contrat (« Devenir l'assureur ») est calculé sur l'exposition plafonnée.
   *Avant* : Co0 assure Bleu foncé 2 nu (0,5 couvert) pour 0,12 ; Co1 construit un hôtel (loyer 20, cote 4,80) ; au
   sinistre la banque payait 20. *Après* : la banque paie 0,5, Co0 paie 19,5, Co1 reçoit 20 ; masse conservée. Avec
   une franchise de 0,2 signée à 2 maisons (couvert 5,8) : hôtel → assureur 5,8, assuré 14,2 ; loyer redescendu à
   0,5 → assureur 0,3, assuré 0,2. Impôt sur le revenu assuré à une valeur de 8 (couvert 0,8), valeur 20 au
   sinistre (impôt 2) → assureur 0,8, assuré 1,2.
4. **Types d'assurance désactivés (bogue 40)** : `insuranceTermEnabled` (« Assurances » = Année et Semestre,
   « Assurance sous-standard » = 1 tour), `defaultInsuranceTerm`. Refus dans `purchaseInsuranceBundle`,
   `insuranceBundleConditions` et `buySubInsurance` ; les termes désactivés sont retirés du menu « Terme » ; le
   bouton « Contrat d'assurance » est masqué quand aucun terme activé n'est signable. *Avant* : sous-standard
   décochée, Co0 en achète une (0,1111) ; assurance normale décochée, Co0 signe un contrat annuel. *Après* : refus
   (« … est désactivée dans cette partie (réglage du créateur) »), rien payé.
5. **Taxe assurée deux fois (bogue 48)** : `insurableItems` ne propose plus une case taxe déjà assurée par
   l'entreprise ; un 2e contrat est refusé par le moteur. Une autre entreprise peut toujours assurer la même case
   pour elle-même. *Avant* : TPS/TVQ assurée deux fois, 2 × 0,2638 payés pour un seul sinistre indemnisé.
   *Après* : 1 contrat, 0,2638 payé.
6. **Sous-standard inutile (bogue 52)** : `subInsurableItems` et `buySubInsurance` écartent un terrain déjà couvert
   par l'assurance normale de la MÊME entreprise (qui passe toujours en premier). *Avant* : Co0 assuré à l'année sur
   Bleu foncé 2 achète en plus le sous-standard (0,1111) qui ne peut jamais servir. *Après* : non proposé, refusé.
   Si l'assurance normale du terrain couvre une autre entreprise, le sous-standard reste possible. Ordre inverse
   (sous-standard prise d'abord, contrat annuel ensuite sur la même case) : aucun argent déplacé, mais la fenêtre du
   contrat annuel avertit que la sous-standard ne servira plus et qu'elle reste annulable, prime remboursée, avant
   le prochain lancer.
7. **Retouches de la revue** :
   - **Case retirée sans boucle** : à la confirmation, toutes les cases choisies sont transmises à l'applyFn, y
     compris celles retirées entre-temps (assurées par une autre entreprise, ou hors de portée après un lancer).
     Avant, seules les cases restantes l'étaient : l'applyFn ne retrouvait pas les cases retirées, « Les conditions
     ont changé » revenait à chaque clic et rien n'était jamais signé. *Après* : 1er clic, case retirée signalée ;
     2e clic, les cases restantes sont signées (annuel : TPS/TVQ seule, 0,2638 ; sous-standard : 0,0389) ; monnaie
     conservée.
   - **Assureur introuvable** (entreprise disparue) : le sinistre est traité comme non assuré, l'assuré paie tout
     (`insurerExists`, dans `settlePropertyRent` et `payTax`). *Avant* : l'indemnité n'était débitée de personne
     (+0,4 M$ créés sur une TPS/TVQ couverte à 0,4). Défaut antérieur à cette série.
   - Service : intitulés « à risque / couvert pour un lancer de 7 (ajusté au lancer réel) » ; le journal du
     sinistre donne le montant couvert pour le lancer réel (« 0.48 pour ce lancer de 12 »), et une ligne de journal
     existe aussi pour un sinistre sous-standard. La franchise changée par la confirmation est journalisée ; la liste
     des contrats affiche la franchise bornée (≥ 0) des anciens contrats.

**Contrats en cours** (à valider) : `migrateState` donne `coveredAmount = null` aux contrats signés avant cette
mise à jour : ils ne sont pas plafonnés (règle en vigueur à leur signature) et expirent au plus tard à la fin de
l'année financière. **Services** (à valider) : le montant « à risque » d'un service est affiché pour un lancer de 7 ;
le plafond suit le lancer réel (montant couvert brut × dés / 7), pour ne plafonner que ce qui a changé depuis la
signature (2e service acquis…) et non le hasard des dés, déjà compris dans la prime. Exemple : Service 1 couvert
0,28 ; lancer de 12 sans changement → l'assureur paie tout (0,48) ; 2e service acquis ensuite (loyer 1,2) →
assureur 0,48, assuré 0,72.

**Tests** : `tests/section313-assurance.test.js` (moteur : 78 vérifications, 27 scénarios dont 9 de contre-épreuve :
plafonds du terrain, du sous-standard, des taxes et de la reprise, assureur introuvable…) et
`tests/section313-fenetre.test.js` (fenêtre, vrais gestionnaires de clics : 37 vérifications, dont 3 scénarios de
contre-épreuve, case retirée comprise) ; `tests/audit-bug6.test.js` adapté (il achetait l'assurance à une prime arbitraire, désormais la
prime bancaire à jour). **17 fichiers, 0 échec ; 320 cas multi-appareils avec `SYNC_SEEDS=40`.**

**Changements visibles pour les joueurs (cahier 7, aide-mémoire)** : la franchise ne peut plus être négative ;
le « à risque » affiché à la signature est aussi le plafond de l'indemnité (si le loyer augmente ensuite, l'excédent
est à la charge de l'assuré ; service : montant pour un lancer de 7, ajusté au lancer réel) ; une prime qui a
changé depuis l'ouverture de la fenêtre (franchise modifiée, pion déplacé, maisons construites) demande une 2e
confirmation « Les conditions ont changé » ; un type d'assurance désactivé par le créateur n'apparaît plus ; une
case taxe déjà assurée n'est plus reproposée ; pas de sous-standard sur un terrain déjà couvert par sa propre
assurance normale, et avertissement si l'on signe un contrat annuel par-dessus sa propre sous-standard ; un contrat
dont l'assureur a disparu ne couvre plus rien.

**Intégration** (vague 2) : aucun conflit ni raccord nécessaire avec les sections 309, 311 et 312. Les sinistres (`settlePropertyRent`, `payTax`) cohabitent sans changement avec les retenues de prêt et les chemins ABS et compensation (suite complète et sondes de la revue vertes).

**Décisions de Julien (2026-10-25)** — réponse aux questions du point d'étape, verbatim : « Ok go pour tes reco ».
Chaque changement du code porte le commentaire « Section 313 — décision de Julien (2026-10-25) ».

- **Cases taxe non plafonnées** (question 3 et remarque b du réviseur) — le plafond de l'indemnité du bogue 39 ne vise
  plus que les loyers (terrains, aéroports, services, sous-standard). Pour l'Impôt sur le revenu et la TPS/TVQ,
  l'assureur paie la taxe due au sinistre moins la franchise (`payTax`) ; le contrat est signé sans plafond
  (`coveredAmount = null`) ; un contrat de taxe déjà signé avec un plafond n'est plus plafonné ; le prix de reprise
  (`liveTakeoverTaxQuote`) est calculé sur le montant actuel. La fenêtre de confirmation affiche « aujourd'hui (non
  plafonné) » pour une taxe et précise que seules les indemnités des terrains sont plafonnées. *Avant* : Impôt assuré
  avec une valeur de 8 (0,8), sinistre avec une valeur de 20 (2) → l'assuré payait 1,2 de la hausse naturelle de sa
  valeur. *Après* : l'assureur paie 2, l'assuré 0 ; franchise 0,3 et assureur B : assuré 0,3, B 1,7 (avant : 1,6 et 0,4).
  Seul un assureur introuvable laisse encore la taxe à la charge de l'assuré. Loyers inchangés (terrain couvert 0,5,
  hôtel ensuite : assureur 0,5, assuré 19,5) ; prorata des services gardé (question 2).
- **Sous-standard remboursée automatiquement** (proposition 6) — quand une entreprise signe un contrat normal (annuel ou
  semestriel) sur une case où ELLE a une assurance sous-standard du lancer en cours, celle-ci est annulée et sa prime
  remboursée dans la même action (`purchaseInsuranceBundle`, `cancelSubInsuranceForNormalContract`, même logique que
  `cancelSubInsurance`). Rembourse l'assureur ACTUEL du contrat : la banque, ou l'entreprise qui l'a repris (elle a
  reçu la prime, ou le prix de reprise, et porte le risque) ; assureur introuvable : annulée sans remboursement
  (personne ne peut payer, aucun argent créé). Trace : la ligne du contrat au journal mentionne l'annulation et le
  remboursement, et sa transaction contient les deux mouvements. Le remboursement attendu (montant, assureur) fait
  partie des conditions confirmées : une sous-standard annulée entre l'affichage et la signature donne « Les conditions
  ont changé ». L'avertissement du lot 6 est remplacé par « votre assurance sous-standard sur cette case sera annulée et
  sa prime (…) remboursée automatiquement par … à la signature ». Une sous-standard d'une autre entreprise n'est pas
  touchée. Exemple : sous-standard sur Bleu foncé 2 à 0,1111, puis contrat annuel à 0,1200 → A paie net 0,0089 ;
  reprise par C : C rembourse 0,1111, la banque garde 0,1200 ; monnaie conservée. Comme dans `cancelSubInsurance`,
  une entreprise assureur sans encaisse suffisante rembourse quand même (encaisse négative).
- **Retouches de la revue des décisions** (commentaire « Section 309-313 — retouche de la revue des décisions ») :
  - *Plus de fausse alerte au 1er clic* : la fenêtre « Assurer plusieurs cases » construisait les conditions affichées
    sans le remboursement de la sous-standard, que les conditions vérifiées contiennent : « Les conditions ont changé »
    s'affichait à chaque 1er clic quand on signait par-dessus sa propre sous-standard. Utilitaire partagé
    `insuranceSubRefundConditions`, calculé à l'ouverture de la fenêtre : signature dès le 1er clic.
  - *Assureur introuvable, défaut antérieur* : `cancelSubInsurance` (+0,1 créé), `mergeGroup` (assurance normale et
    sous-standard, +0,3), `cancelContract` (contrat groupé, +0,3) et `cancelPropInsurance` (jamais appelée) créditaient
    l'assurée sans débiter personne. Utilitaire `refundInsurancePremium` (même garde que le remboursement automatique) :
    assureur ou assurée introuvable, aucun remboursement, contrat annulé quand même, trace au journal ; monnaie
    conservée.
- **Sans code** : prorata des services gardé ; contrats antérieurs sans plafond, franchise confirmée devenant celle du
  tour et prix de reprise plafonné (loyers) confirmés.
- **Tests** : `tests/section313-decisions.test.js` (36 vérifications, 14 scénarios dont 4 de contre-épreuve : plafond
  des taxes réintroduit, reprise plafonnée réintroduite, annulation automatique retirée, garde de l'assureur introuvable
  retirée) ; `tests/section313-fenetre.test.js` F8 / F8b (signature dès le 1er clic par la vraie fenêtre, contre-épreuve) ;
  adaptés : `section313-assurance` 39c (taxe non plafonnée), 39g (contre-épreuve = plafond réintroduit), R4b (+1 créé
  au lieu de +0,4), `section313-fenetre` F1 (aucun plafond enregistré sur la taxe) et F7 (mention du remboursement).
- **Joueurs** (cahier 7, aide-mémoire) : une taxe assurée est couverte en entier (moins la franchise), même si elle a
  augmenté depuis la signature ; signer un contrat annuel ou semestriel sur une case déjà couverte par sa propre
  sous-standard l'annule et rembourse sa prime automatiquement.
