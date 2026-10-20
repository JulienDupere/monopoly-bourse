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
