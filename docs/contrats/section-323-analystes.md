# Section 323 : trois analystes, cible, zone acceptable, verdict

Contrat de construction. Décisions de Julien des 16 et 17 novembre 2026, après une étape de mesure hors du jeu
(`tests/sim/analystes/`, relue deux fois). Ce contrat couvre le moteur (lot 2) et l'affichage (lot 3). Le pari du
PDG (lots 6 et 7) viendra après le choix des tailles ; seul son point d'accroche est réservé ici.

## 0. Règles de travail

- Copie de travail : `C:\Users\Julien\Desktop\Application CLAUDE\Monopoly Finance\.claude\worktrees\section-323`,
  branche `section-323`. Ne travailler que là. Aucun commit, aucun push, aucun changement de branche.
- Tout le code du jeu est dans `index.html` (930 Ko) : ne jamais le lire en entier, chercher avec Grep `-n` puis
  lire des extraits. Chaque changement porte un commentaire `Section 323`.
- Jamais de Firebase réel, de réseau ni de vrai site. Essais par `tests/helpers/engine.js`.
- La somme banque + entreprises + joueurs ne change jamais (`cashTotal()`) : rien dans ce lot ne déplace d'argent.
- Tout nouveau champ d'état a sa valeur par défaut dans `migrateState`.
- Le prototype mesuré et relu sert de référence de calcul : `tests/sim/analystes/analystes.js` (M, σ, K2, médiane,
  zone, comptage) et `tests/sim/analystes/plateau.js` (fréquences exactes du plateau). Le porter, pas le réinventer.

## 1. La règle du jeu

Au début de chaque semestre, trois analystes publient le bénéfice net qu'ils attendent d'une entreprise pour le
semestre qui commence. À la clôture, le bénéfice officiel est comparé à ces chiffres.

### 1.1 Les trois analystes

- **L'historien (H)** : moyenne du bénéfice net des 3 derniers semestres clos (2 s'il n'y en a que 2). Il est
  **absent** tant que l'entreprise n'a pas 2 semestres clos derrière elle. Les valeurs fixes « 0 puis 2 »
  disparaissent.
- **Le modélisateur (M)** : ce que le parc devrait rapporter en 3 lancers, tel qu'il est au moment du calcul.

      M = S + E_recus − E_payes − E_taxes − I

  - `S` : 2 × probabilité exacte que le pion de l'entreprise passe par GO pendant ses lancers du semestre, depuis
    sa position réelle (case 30 qui renvoie en 10 et arrête le pion). `S = 0` si `goAdvancesOwed > 0`.
  - `E_recus` : pour chaque terrain où l'entreprise touche un loyer, chaque visiteur (pions des autres
    entreprises actives et pions neutres) et chacun des 3 tours du semestre : probabilité que le visiteur arrive
    sur la case à ce tour × probabilité que le propriétaire touche ses loyers à ce tour × montant que le moteur
    inscrirait en revenu (parts de copropriété, hypothèque, parts réservées aux REIT ; services : total des dés
    attendu de 7). Voir « Calcul par tour » ci-dessous (ronde de corrections, C4).
  - `E_payes`, `E_taxes` : même calcul pour ce que l'entreprise paierait en s'arrêtant chez les autres ou sur une
    case de taxe.
  - `I` : les charges que le moteur prélèvera seul pendant ces 3 lancers à dette inchangée (intérêts
    hypothécaires, intérêts d'ABS), fin d'année comprise si le semestre la contient. Les intérêts hypothécaires de
    fin d'année sont aussi gardés à part (`parts.mortgage`, signés comme une charge : positifs payés par un
    emprunteur, négatifs reçus par une entreprise prêteuse) : ils sont rejugés à la clôture (1.3).
  - Calcul par tour (ronde de corrections, C4), toujours sans regarder la position des pions : les fréquences
    viennent de la chaîne **exacte** de ce plateau (`jailTurns` des réglages), pas de `p.prob` (`p.prob` et
    `intrinsicValue` ne sont pas touchés). Un pion libre au moment du calcul part de la loi stationnaire des pions
    libres ; à chaque tour il arrive sur une case avec la probabilité de la chaîne ; arrivé sur 30, il part en 10,
    l'enquête prend effet après tous les déplacements du tour (les loyers de ce tour sont encore touchés), il saute
    les `max(1, jailTurns)` tours suivants puis rejoue de la case 10. Une entreprise ne touche pas ses loyers aux
    tours où elle est sous enquête. Les mêmes tables servent à ce qu'une entreprise paie avec son propre pion
    (loyers, taxes). Un pion ou une entreprise déjà sous enquête au moment du calcul saute ses tours restants
    (connus), puis suit les mêmes tables à partir de la case 10 où l'enquête l'a mis. Avant cette correction :
    « lancers restants × fréquence par lancer joué », qui ignorait les enquêtes ouvertes pendant le semestre et
    poussait tout le marché vers le rouge (R − M ≈ −0,3 pour un gros propriétaire).
  - Angle mort voulu : hors la subvention, le modélisateur ne regarde pas la position des pions. Il ignore aussi
    assurances, REIT, lot commercial et accords de compensation (à écrire dans la documentation).
  - Irrégularité prévue `σ` (écart type, arrivées traitées comme indépendantes), avec les mêmes probabilités par
    tour : pour chaque arrivée possible (probabilité `a`), le montant net `N` de l'entreprise dépend des
    propriétaires libres (chacun libre avec la probabilité `f`, indépendamment) ; `σ² = Σ [a Var(N) + a (1 − a) E[N]²]`
    sur toutes les arrivées (loyers reçus, payés, taxes) `+ 4 q (1 − q)` pour la subvention, `q` étant la
    probabilité de passer par GO. Avec tous les propriétaires libres, c'est `a (1 − a) montant²`.
- **Le marché (K)** : `capitalisation × rendement moyen du marché`, où capitalisation = `stockPrice × totalShares`
  et rendement moyen = somme des M des entreprises actives ÷ somme de leurs capitalisations. Absent si la somme
  des capitalisations est nulle ou négative, ou si moins de 2 entreprises actives à capitalisation positive entrent
  dans le rendement moyen (`ANALYST_MARKET_MIN_COMPANIES`) : avec une seule, K = M exactement et le marché n'est pas
  un deuxième avis (ronde de corrections, C3).

### 1.2 Cible et zone

- **Cible** : l'analyste du milieu. Trois analystes : la médiane. Deux : leur moyenne. Un seul : lui.
- **Zone acceptable** : cible ± `max(0,5 M$ ; 0,35 × σ)` (décision D4 de Julien du 2026-11-17, après mesure : un tiers
  des semestres dans la zone au lieu de 43 % ; avant : `0,5 × σ`).

### 1.3 Verdict à la clôture

`R` = bénéfice net officiel du semestre (`incomeStatementFor(co.id, s).netIncome`), affiché tel quel.

Le verdict juge le **bénéfice jugé** `J = R + (intérêts hypothécaires inscrits ce semestre − intérêts figés)`, les
intérêts étant comptés en charge nette (payés moins reçus) et les intérêts figés étant `parts.mortgage` des chiffres
figés (ronde de corrections, C1, sur le modèle du rejugement des dividendes de la section 320). Rembourser une
hypothèque après le premier lancer, en prendre une, ou se faire saisir une part au lieu de payer l'intérêt ne déplace
donc plus le verdict, ni pour l'emprunteur ni pour le prêteur. Le plus souvent, `J = R`. Dans les règles ci-dessous,
« R » désigne `J`.

- `|R − cible| ≤ demi-largeur` : **dans la zone**, 0 ou 1 cube (`ANALYST_ZONE_CUBES_MIN = 0`,
  `ANALYST_ZONE_CUBES_MAX = 1`) du côté de l'écart : vert si `R` est au-dessus de la cible, rouge s'il est en
  dessous, rien en cas d'égalité exacte (décision D2 de Julien du 2026-11-17 ; avant : aucun cube). Le verdict reste
  `'zone'` (et « neutre » pour l'axe Croissance, 1.5).
- Sinon, on compte les analystes strictement battus (`R > chiffre`). Le sens est celui du côté de la cible.
  - Tous du même avis (tous battus, ou aucun) : verdict **fort**, 5 cubes.
  - Analystes divisés : verdict **normal**, 2 cubes.
  - Un seul analyste présent : verdict normal.
- Cubes verts au-dessus, rouges en dessous, au sac fondamental (`injectStockCube`), tirés à la clôture dans la
  fourchette rendue par `analystVerdictCubes` : quantités fixes hors de la zone, 0 ou 1 dans la zone. Le calcul des
  chiffres des analystes reste sans hasard ; seul le tirage des cubes de la zone en utilise un, comme les autres
  déclencheurs du sac.
- Tailles fixées par Julien le 2026-11-17 (décision D1) : normal 2, fort 5.

### 1.4 Les moments

- **Pendant la fenêtre du début de semestre** (avant le premier déplacement du semestre) : les chiffres sont
  **provisoires** et recalculés à l'affichage à partir de l'état courant. Bâtir, hypothéquer ou acheter des
  actions dans la fenêtre change donc ce que les analystes publient.
- **Au premier déplacement du semestre**, quel que soit le chemin (lancer pour tous, lancer d'une entreprise,
  pion neutre) : les chiffres de toutes les entreprises actives sont **figés** dans l'état, dans la même action
  synchronisée que le lancer, **après** les enchères résolues à ce lancer (lot commercial, REIT, ABS mises en vente :
  ce qui est attribué à ce lancer entre dans les chiffres) et avant tout déplacement, y compris quand toutes les
  entreprises sont sous enquête et que personne ne bouge (ronde de corrections, C2).
- **À la clôture** : le verdict juge `R` contre les chiffres figés. Pas de chiffres figés pour ce semestre
  (entreprise créée en cours de semestre, partie migrée en cours de semestre) : pas de verdict.
- Le calcul est pur et déterministe (aucun hasard) : deux appareils obtiennent les mêmes chiffres.

### 1.5 Type Croissance

L'axe 2 de la matrice (`croissanceAnalystAxis`) suit le même verdict (rejugé, 1.3) : au-dessus de la zone = bon, dans la zone =
neutre, en dessous = mauvais. Comme aujourd'hui, sans chiffre d'affaires ce semestre, ou sans verdict, le sac type
reste inchangé. L'axe 1 (marges) et la matrice ne changent pas.

## 2. Données

    co.analystForecast = null | { semester, h, m, k, sigma, target, zone, parts, kAbsent, frozenAtRoll }
    co.analystHistory  = [ { semester, h, m, k, target, zone, actual, judged, adjust, verdict, beaten, of, color, qty, call, callEffect } ]  // 40 max
    co.ceoCall         = null | { semester, kind, atRoll, playerId }   // pari du PDG : voir la section 7

- `kAbsent` (ronde finale, R3) : raison de l'absence du marché, figée avec les chiffres : `'capNotPositive'` (somme des
  capitalisations nulle ou négative), `'fewCompanies'` (moins de 2 entreprises à capitalisation positive), `null` si le
  marché est présent (ou prévision figée avant R3 : l'affichage dit alors « absent au moment de la publication »).
- `call` et `callEffect` : section 7.2.

- `h` et `k` valent `null` quand l'analyste est absent. `zone` est la demi-largeur. `parts` détaille M
  (`subsidy`, `rentsIn`, `rentsOut`, `taxes`, `charges`, et `mortgage` : intérêts hypothécaires de fin d'année,
  compris dans `charges`, gardés à part pour le rejugement).
- `actual` = bénéfice net officiel ; `judged` = bénéfice jugé (1.3) ; `adjust = judged − actual` (0 le plus
  souvent). Une prévision sans `parts.mortgage` n'est pas ajustée.
- `verdict` : `'zone'`, `'normalUp'`, `'strongUp'`, `'normalDown'`, `'strongDown'`.
- `color` : couleur du côté (aussi dans la zone, même quand 0 cube est tiré ; `null` en cas d'égalité exacte) ;
  `qty` : quantité réellement tirée (dans la zone : 0 ou 1).
- Valeurs par défaut dans `migrateState` : `null`, `[]`, `null`.

## 3. Fonctions et constantes (noms fixés, le lot 3 s'appuie dessus)

    const ANALYST_ZONE_K = 0.35, ANALYST_ZONE_FLOOR = 0.5, ANALYST_HISTORIAN_MIN_SEMESTERS = 2;   // 0,35 : D4
    const ANALYST_VERDICT_NORMAL_CUBES = 2, ANALYST_VERDICT_STRONG_CUBES = 5;   // fixées le 2026-11-17 (D1)
    const ANALYST_ZONE_CUBES_MIN = 0, ANALYST_ZONE_CUBES_MAX = 1;               // dans la zone (D2)

    boardLandingFrequencies()            // tableau de 40 fréquences par lancer, mémorisé selon jailTurns
    analystTurnTables(fromJail)          // C4 : { arrive[3][40], free[3] } par tour (pion libre ou sortant d'enquête)
    analystPawnSchedule(pion)            // C4 : tours d'enquête restants, puis les tables par tour décalées
    analystMortgageInterestBooked(is)    // C1 : intérêts hypothécaires inscrits (payés − reçus) d'un compte de résultat
    analystHistorian(co, semester)       // nombre ou null
    analystModeller(co)                  // { expected, sigma, parts }
    analystForecastsLive()               // { [companyId]: { semester, h, m, k, sigma, target, zone, parts } } pour toutes les actives
    analystForecastFor(co)               // les chiffres figés s'ils sont du semestre courant, sinon les provisoires ; + champ `frozen`
    freezeAnalystForecasts()             // fige tout le monde ; sans effet si déjà figé pour ce semestre
    analystVerdict(forecast, actual)     // { verdict, beaten, of }
    analystVerdictCubes(verdict, co, gap, semester?) // { color, qtyMin, qtyMax } (+ call, callEffect avec une annonce) ;
                                          // gap = bénéfice jugé − cible (sert dans la zone) ; semester : par défaut celui
                                          // des chiffres figés ; seul endroit où les tailles sont lues, l'effet de
                                          // l'annonce du PDG s'y greffe (section 7)
    applyAnalystVerdict(co, semester)    // à la clôture : verdict, cubes, ligne d'historique, ligne de journal ;
                                          // remet co.ceoCall à null sur tous les chemins

    // Pari du PDG (section 7)
    ceoCallFor(co, semester)             // l'annonce valable pour ce semestre, sinon null (jamais celle d'un autre semestre)
    ceoCallWindowOpen()                  // aucun lancer ce semestre ET chiffres pas encore figés
    ceoCallRefusal(co, playerId)         // null si permise, sinon le texte du refus
    ceoCallApply(companyId, kind, playerId) // corps de l'action : revérifie, cube immédiat, pose co.ceoCall, journal
    announceCeoCall(companyId, kind, opts?)  // attemptActionWithRetry(ceoCallApply, joueur figé au clic)

`companyExpectedNetIncome` reste (l'historien s'en sert ou la remplace) ; `netIncomeExpectationTier`, ses seuils
(`NET_INCOME_RATIO_*`) et les paliers `STOCK_EXPECTATION_STANDARD/SIGNIFICANT/REALLY_MISSED_*` sont retirés de la
clôture. `netIncomeExpectationRatio` reste s'il sert ailleurs.

Le verdict d'une entreprise est calculé **une seule fois** par clôture et sert aux deux endroits
d'`advanceGameClock` (axe Croissance, cubes du fondamental).

## 4. Affichage (lot 3)

Le lot 3 ne lit que `analystForecastFor(co)`, `co.analystHistory` et les constantes. Il ne calcule rien.

- Onglet Entreprise, à la place de « Bénéfice net attendu par les analystes (ce semestre) » : les trois chiffres
  nommés (Historien, Modélisateur, Marché ; « absent » le cas échéant), la cible, la zone (de … à …), et la
  mention « provisoire, jusqu'au premier lancer du semestre » ou « publié ».
- Graphique « attendu contre réel » (`expectationVsActualChartHtml`) : la cible, la bande de la zone et le
  bénéfice réel par semestre, avec le verdict en clair (dans la zone, normal, fort, et le sens), à partir de
  `co.analystHistory`. Les semestres d'avant la section 323 restent affichés comme aujourd'hui ou sont omis,
  sans erreur.
- Journal et résumé du tour : une ligne par entreprise à la clôture (verdict, analystes battus, cubes). Dans la
  zone (D2) : « dans la zone — 1 cube vert au sac fondamental » ou « dans la zone — aucun cube », sans les analystes
  battus ; même forme dans le tableau du graphique (« dans la zone — 1 cube vert »). Rappel de la règle dans l'onglet
  Entreprise : « dans la zone, 0 ou 1 cube du côté de l'écart (vert au-dessus de la cible, rouge en dessous) ».
- Ronde de corrections : libellé de la cible selon le nombre d'analystes (A1) ; montant nul écrit « 0 » sans signe
  et un seul signe moins (U+2212) dans le bloc, le graphique, le journal et le résumé (A2) ; « intérêts et
  charges » avec le signe de leur effet sur le bénéfice (A3) ; partie terminée : ni « provisoires jusqu'au premier
  lancer », ni verdict annoncé (A4) ; le graphique montre les périodes choisies par l'écran, avec leurs libellés
  (A5) ; bénéfice jugé montré avec une courte explication quand il diffère du bénéfice officiel (A6).
- Textes en français, vocabulaire du jeu. Les couleurs suivent les variables CSS existantes.

## 4 bis. Aussi dans cette section

- **Émission et rachat d'actions (décision D3 de Julien du 2026-11-17)** : les cubes du volume (`tradeCubeRange`) et
  le bonus de la section 322 (`corpActionBonusDue`, `STOCK_TRIGGER_SHARE_ISSUANCE_BONUS_*`,
  `STOCK_TRIGGER_SHARE_BUYBACK_BONUS_*`) d'`issueNewShares` et de `buybackShares` vont au sac **trading**
  (`injectTradingCube`) au lieu du sac fondamental. Mêmes couleurs (rouge à l'émission, vert au rachat), mêmes
  quantités, mêmes règles de la section 322 (un bonus par ouverture du marché, à partir d'une tranche). Les autres
  chemins (fondation, IPO, parts privilégiées) n'injectent aucun cube ; l'exercice des options passait déjà par le
  sac trading. Rien d'autre n'a changé.

## 5. Essais demandés

`tests/section323.test.js` (modèle : `tests/section320.test.js` ou un `audit-bug*.test.js`) :

- chaque fonction sur des chiffres calculés à la main (subvention selon la position, un terrain et un visiteur,
  copropriété, hypothèque, enquête, pion neutre, zone au plancher et au-dessus, médiane à 3, 2 et 1 analystes,
  verdicts des cinq sortes, égalités) ;
- le modélisateur contre une simulation du vrai moteur sur une situation simple (écart dans l'intervalle) ;
- les moments : bâtir dans la fenêtre change les chiffres provisoires, bâtir après le premier lancer ne change
  pas les chiffres figés ; aucun verdict sans chiffres figés ; le verdict n'est appliqué qu'une fois ;
- argent conservé, aucun appel au hasard dans le calcul, partie ancienne migrée sans erreur ;
- au moins 6 versions cassées exprès (`transform`) que le test attrape ;
- les essais existants qui épinglaient l'ancien verdict sont adaptés, chacun listé avec sa raison ;
- `node tests/run-all.js` vert.

## 6. Hors périmètre

Valeur par défaut des pions neutres ; `p.prob` et `intrinsicValue` ; cahiers et aide-mémoire (à signaler
seulement) ; `RESUME_ET_REGLES.md` et `CLAUDE.md` (session principale, à la fin).

## 7. Pari du PDG (lots 6 et 7) — décisions de Julien du 17 novembre 2026

Réglages retenus après la deuxième mesure sur le vrai code : zone à 0,35 (`ANALYST_ZONE_K = 0.35`, plancher 0,5
inchangé) ; avertissement à 1 cube rouge ; promesse à 1 cube vert, 3 cubes rouges de plus si elle est ratée ;
cube de l'annonce au sac fondamental.

### 7.1 La règle

Au début d'un semestre, pendant la fenêtre (avant le premier déplacement du semestre, donc tant que les chiffres
des analystes sont provisoires), le PDG d'une entreprise peut faire UNE annonce pour le semestre qui commence :

- **Avertissement** : 1 cube rouge tout de suite au sac fondamental. À la clôture, si le bénéfice jugé finit sous
  la zone, le verdict est adouci d'un cran : un fort (5 rouges) devient 2 rouges ; un normal (2 rouges) est traité
  comme dans la zone (tirage de 0 ou 1 rouge).
- **Promesse** : 1 cube vert tout de suite au sac fondamental. À la clôture, si le bénéfice jugé finit sous la zone
  (verdict normal ou fort), 3 cubes rouges s'ajoutent aux cubes du verdict. Dans la zone ou au-dessus, la promesse
  est tenue : rien de plus.
- Sans annonce : rien ne change.

Précisions :

- Une seule annonce par entreprise et par semestre, sans retour possible : le cube est donné tout de suite.
- Refusée hors de la fenêtre (dès que les chiffres sont figés), si la partie est terminée, si l'entreprise n'est
  pas active, ou si le semestre n'aura pas de verdict.
- **Permise pendant une enquête de l'AMF**, avertissement comme promesse. La revue de contrôle avait signalé que sous
  enquête au gel le verdict est « fort en dessous » dans 99 % des cas (le modélisateur vaut 0, l'historien et le
  marché ignorent l'enquête) et qu'un avertissement y gagne 2 cubes presque à coup sûr (−2,99 au lieu de −4,96) ; un
  refus avait été posé, puis retiré le 2026-11-17 à la demande de Julien (« Non le pdg peut ») : rester sous enquête
  est un choix, puisqu'on peut payer pour en sortir, et rien de ce qui touche l'AMF ne change.
- Seul le joueur qui dirige l'entreprise peut annoncer (même règle que les autres décisions du PDG dans le jeu :
  dividende, déclaration publique).
- L'annonce ne change ni le nom du verdict, ni l'axe du type Croissance, ni les chiffres des analystes : elle ne
  change que les cubes.
- Une annonce suivie d'un semestre sans verdict (aucun chiffre figé) n'a pas d'autre effet que son cube immédiat.
- Pas de règle spéciale en fin de partie.

### 7.2 Données et fonctions

    co.ceoCall = null | { semester, kind: 'warning' | 'promise', atRoll, playerId }
    co.analystHistory[i].call       = null | 'warning' | 'promise'
    co.analystHistory[i].callEffect = texte court de ce que l'annonce a changé aux cubes (ou null)

    const CEO_WARNING_COST_CUBES = 1, CEO_PROMISE_GAIN_CUBES = 1, CEO_PROMISE_BROKEN_RED_CUBES = 3;

    ceoCallRefusal(co, playerId)          // null si l'annonce est permise, sinon le texte du refus
    announceCeoCall(companyId, kind)      // action synchronisée (attemptActionWithRetry), jamais appliquée deux fois
    analystVerdictCubes(verdict, co, gap) // reste le seul endroit des tailles ; l'effet de l'annonce s'y greffe

`co.ceoCall` reste en place jusqu'à la clôture de son semestre, qui l'applique puis le remet à `null`.

### 7.3 Affichage (lot 7)

- Dans la fenêtre « Résultats du tour », quand le lancer vient de clore un semestre et que le joueur dirige une
  entreprise : un encadré au bas, « Annonce du PDG pour le semestre qui commence », avec la cible et la zone
  provisoires, les trois choix (aucune annonce, avertissement, promesse), une phrase par choix qui dit ce qu'il
  coûte et ce qu'il change, et une confirmation avant d'annoncer.
- Le même encadré dans l'onglet Entreprise, sous les attentes des analystes, pendant la fenêtre (c'est le seul
  accès au tout premier semestre, qui n'a pas de résumé du tour).
- Une fois l'annonce faite, ou la fenêtre fermée : l'encadré dit ce qui a été annoncé (ou « aucune annonce »),
  sans bouton.
- Journal : une ligne à l'annonce, et l'effet de l'annonce dans la ligne du verdict à la clôture. L'annonce est
  visible de tous les joueurs.
