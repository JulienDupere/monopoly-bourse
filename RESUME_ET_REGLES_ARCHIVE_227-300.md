# Monopoly Finances — Archive des sections 227 à 300

Sections déplacées telles quelles de `RESUME_ET_REGLES.md` le 2026-10-20 pour alléger le fichier principal (aucun
changement de texte). Sections 1–20 et 301 et suivantes : `RESUME_ET_REGLES.md`. Sections 21–226 :
`RESUME_ET_REGLES_ARCHIVE.md` (ancien projet claude.ai, absent du dépôt).

---

## 227. Correction de la section 226 — retrait de l'étape « vendre des positions » — 2026-09-07

### Demande

« Non ok voici les étapes. 1) Encaisse 2) Bons sans risque 3) Encaisse negative » — puis, question de
l'utilisateur pour valider que ce 3e point est acceptable tel quel : « qu'arrive til quand ton Encaissé est
négative ».

### Réponse à la question posée (avant l'implémentation)

Ce que fait DÉJÀ l'app quand `player.cash` (l'encaisse PERSONNELLE d'un joueur — pas celle d'une entreprise,
mécanisme distinct) devient négative, sans aucun changement de code nécessaire pour ceci :
- Le concept de FAILLITE JOUEUR a été explicitement retiré du jeu (décision antérieure, 2026-08-31,
  `p.bankrupt` supprimé) — une encaisse négative ne termine JAMAIS la partie pour ce joueur, ne le bloque
  sur AUCUNE action, et n'a AUCUNE pénalité ou intérêt dédié (contrairement à l'encaisse d'une ENTREPRISE,
  qui elle bloque « Tour Terminé » et peut déclencher le moteur boursier — mécanisme séparé, non concerné).
- Elle réduit directement `netWorth(player)` (encaisse + actions longues/courtes + bons + options + créances
  de prêts, TOUT net à la valeur de marché) — la métrique utilisée pour le CLASSEMENT final des joueurs.
  Une encaisse très négative pénalise donc le score final du joueur, sans autre effet immédiat.
- Si ce même joueur détient PAR AILLEURS des positions à découvert en actions ou des options ÉCRITES,
  `enforceMarginCalls()` (vérifiée à CHAQUE lancer) peut alors forcer la fermeture de sa plus grosse position
  à risque si sa marge de maintien n'est plus couverte — mais ce mécanisme existe déjà indépendamment de
  cette section, réagit à `netWorth()` dans son ensemble (pas spécifiquement à l'encaisse), et ne s'applique
  QUE s'il détient déjà de telles positions à risque.
- Sinon (aucune position à découvert/écrite) : rien d'autre ne se produit. L'encaisse reste simplement
  négative jusqu'à ce que le joueur la reconstitue (vente de parts, remboursement de prêt reçu, etc.).

### Correction retenue

Confirmé par l'utilisateur : la cascade de la section 226 passe de 3 à 2 sources avant l'encaisse négative.
« Vendre des positions » (l'ancienne étape 3) est ENTIÈREMENT retirée — une position en actions détenue par
un joueur n'est plus jamais liquidée automatiquement pour régler un exercice d'option forcé, quelle que soit
l'ampleur du découvert résultant. La boucle de liquidation de positions ajoutée à
`raiseCashForForcedSettlement()` à la section 226 est supprimée ; seule l'étape « bons sans risque » demeure
avant que `settleOptionExercise()` ne laisse l'encaisse passer sous zéro (comportement DÉJÀ existant depuis
la section 152, simplement repoussé après l'étape des bons plutôt qu'immédiat).

### Code (`script_extracted.js`)

```js
// raiseCashForForcedSettlement() — la boucle "vend la plus grosse position..." de la section 226 est
// RETIRÉE. Ne reste que l'étape bons sans risque:
function raiseCashForForcedSettlement(player, amountNeeded){
  let remaining = amountNeeded, raised = 0;
  if(remaining>1e-9 && (player.bondBalance||0)>1e-9){
    const fromBonds = Math.min(remaining, player.bondBalance);
    player.bondBalance -= fromBonds; player.cash += fromBonds; state.bank.cash -= fromBonds;
    log(`💰 Règlement forcé d'une option — vente automatique de ${fmt(fromBonds)} de bons sans risque pour ${player.name} (...).`, [/* ... */]);
    remaining -= fromBonds; raised += fromBonds;
  }
  return raised; // si `remaining` subsiste malgré tout, l'appelant laisse l'encaisse finir négative (étape 3)
}
```

### Tests

`smoke_test_step226_forced_option_settlement_liquidation.js` réécrit : les groupes C/D/E de vente de
positions sont retirés, remplacés par un groupe (C) « encaisse ET bons insuffisants → encaisse négative » et
un groupe (D) qui vérifie EXPLICITEMENT qu'une position en actions détenue par ailleurs par le joueur (valeur
largement suffisante pour couvrir le manque) n'est PAS touchée — le cœur de cette correction — même quand
l'encaisse finit très négative. 4 groupes (A→D) au total, tous passants.

Suite complète relancée : **157 scripts, 0 échec**. `node -c script_extracted.js`. `python3 sync_script.py`
exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).


## 228. Indices de secteur superposables au graphique de valeur nette (Portefeuille) — 2026-09-07

### Demande

« Dans le graphique "Évolution de ma valeur nette de liquidation" dans portefeuille mettre aussi des choix
à cocher pour se comparer au index : 1) Le marché (MRKT) 2) Les dividendes (DIVD) 3) Les momentum (MMTM)
4) Les croissances (BOOM) 5) Les GARP (GARP). Les index serait si tu aurais investit à part égale dans
chaque compagnies du secteur spécifique en n'apportant aucun autre changement. »

### Analyse et conception

Cinq nouvelles cases à cocher sur le graphique déjà existant `pf-valeur-nette` (courbe de la valeur nette
de liquidation du joueur, `renderPortefeuille()`), permettant de superposer jusqu'à 5 indices de référence.
Précédent direct déjà en place dans le même onglet: « Comparer le cours entre entreprises »
(`renderPortefeuilleCompareChart`, sections 136/199) utilise déjà exactement ce pattern d'interaction
(cases à cocher → variable de MODULE → re-rendu sans `saveGame()`, voir `data-compare-company`/
`data-compare-market`) — repris ici à l'identique pour `data-nwindex`/`portefeuilleNetWorthIndexSelection`
(nouvelle variable de module, TOUTES décochées par défaut — même raisonnement que
`portefeuilleCompareShowMarket`: ce sont des ajouts synthétiques, pas des séries que l'utilisateur
s'attendrait à voir déjà affichées sur SON propre graphique).

Deux problèmes distincts à résoudre pour le calcul de chaque indice, ni l'un ni l'autre couvert par
`marketAveragePriceSeries` (section 199, la seule moyenne déjà existante — une moyenne de PRIX bruts, donc
biaisée par l'échelle de prix propre à chaque compagnie, jamais un vrai « part égale en $ ») :

1. **« Part égale dans chaque compagnie » (nouvelle fonction `equalWeightIndexNetWorthSeries`)** — chaque
   compagnie du groupe est d'abord normalisée à SA PROPRE valeur de départ (base 1.0 à son tout premier
   point de `stockPriceHistory`), puis ces niveaux normalisés sont moyennés par lancer. Le résultat
   représente fidèlement « 1$ investi à part égale dans chaque compagnie du groupe, composé selon son
   propre rendement », peu importe le prix nominal par part de chacune (une compagnie à 5$/part et une à
   500$/part pèsent alors identiquement, contrairement à une moyenne de prix bruts). Même limite déjà
   acceptée pour `marketAveragePriceSeries` : une compagnie entre dans la moyenne dès son propre premier
   point (jamais de prix fictif avant sa fondation) et, si elle disparaît, cesse entièrement d'y contribuer
   (biais de survie assumé, cohérent avec `activeCompanies()` qui ne renvoie déjà que les compagnies
   actives).
2. **Mise à l'échelle en $ comparable à la valeur nette (jugement d'implémentation)** — un indice de
   rendement pur (parti de 1.0) ne se superpose à rien de lisible à côté d'une courbe en $ (encaisse +
   positions, potentiellement en millions). Lecture retenue, directement suggérée par « en n'apportant
   aucun autre changement » : même point de départ que le joueur, seul le placement diffère ensuite. La
   série est donc ANCRÉE à la valeur nette RÉELLE du joueur (`state.history[].netWorth[me.id]`) au lancer le
   plus proche disponible À OU AVANT le premier lancer où l'indice a lui-même une donnée (une compagnie du
   secteur peut être fondée après le tout début de la partie, donc après le tout premier point d'historique
   du joueur — l'ancrage suit alors ce moment plus tardif, pas le lancer 0), puis chaque point suivant
   applique le rendement composé de l'indice normalisé à ce même ancrage. Les deux courbes démarrent donc
   au même $ à l'instant précis où la comparaison devient possible, exactement comme un « et si j'avais
   plutôt investi dans l'indice X à ce moment-là, avec le même montant ».

Cinq définitions (`NET_WORTH_INDEX_DEFS`) : MRKT = toutes les compagnies (`state.companies`), DIVD/MMTM/
BOOM/GARP = uniquement les compagnies du `COMPANY_TYPES.key` correspondant (`dividende`/`momentum`/
`croissance`/`garp`). Couleurs reprises telles quelles de `SECTOR_TYPE_COLORS` (camembert « Répartition
sectorielle », même onglet) pour MRKT/DIVD/MMTM/BOOM/GARP, cohérentes avec le code couleur déjà associé à
chaque type ailleurs dans l'app ; MRKT reprend la couleur déjà utilisée par « Le marché » du comparateur de
cours (#B45309). Légende affichée (`tvChartLegend`) dès qu'au moins un indice est sélectionné (plus d'une
série sur le graphique) — jamais pour la seule courbe du joueur, comme partout ailleurs dans l'app.

### Code (`script_extracted.js`)

```js
const NET_WORTH_INDEX_DEFS = [
  {key:'MRKT', label:'Le marché (MRKT)', types:null, color:'#B45309'},
  {key:'DIVD', label:'Les dividendes (DIVD)', types:['dividende'], color:'var(--gold)'},
  {key:'MMTM', label:'Les momentum (MMTM)', types:['momentum'], color:'#6D28D9'},
  {key:'BOOM', label:'Les croissances (BOOM)', types:['croissance'], color:'var(--brick)'},
  {key:'GARP', label:'Les GARP (GARP)', types:['garp'], color:'#047857'},
];
function equalWeightIndexNetWorthSeries(me, companies){
  if(!companies || companies.length===0 || !state.history || state.history.length<2) return [];
  const byRoll = {};
  companies.forEach(co=>{
    const hist = co.stockPriceHistory||[];
    if(hist.length===0) return;
    const basePrice = hist[0].price;
    if(basePrice<=1e-9) return;
    hist.forEach(h=>{ (byRoll[h.roll]=byRoll[h.roll]||[]).push(h.price/basePrice); });
  });
  const levelRolls = Object.keys(byRoll).map(Number).sort((a,b)=>a-b);
  if(levelRolls.length===0) return [];
  const levels = levelRolls.map(roll=>{
    const arr = byRoll[roll];
    return {roll, level: arr.reduce((a,b)=>a+b,0)/arr.length};
  });
  const firstLevelRoll = levels[0].roll;
  let anchorNetWorth;
  for(let i=state.history.length-1;i>=0;i--){
    if(state.history[i].roll<=firstLevelRoll){ anchorNetWorth = state.history[i].netWorth[me.id]; break; }
  }
  if(anchorNetWorth===undefined){
    anchorNetWorth = state.history[0].netWorth[me.id]!==undefined ? state.history[0].netWorth[me.id] : 0;
  }
  const baseLevel = levels[0].level;
  if(baseLevel<=1e-9) return [];
  return levels.map(pt=>({x: pt.roll, y: anchorNetWorth * (pt.level/baseLevel)}));
}
// renderPortefeuille() — pf-valeur-nette:
// checkboxes data-nwindex="<KEY>" -> portefeuilleNetWorthIndexSelection (variable de MODULE) -> pour
// chaque clé sélectionnée, filtre state.companies par def.types (ou toutes pour MRKT), calcule
// equalWeightIndexNetWorthSeries(me, cos), ajoute la série au tableau passé à svgLineChart() + tvChartLegend()
// dès que >1 série.
```

### Tests

Nouveau fichier dédié : `smoke_test_step228_net_worth_index_overlay.js` — 5 groupes :
- **(A)** cas de base, 2 compagnies présentes dès le lancer 0 avec des rendements différents (+10%/-10% et
  +20%/-20%) : moyenne normalisée par lancer correcte (1.0 → 1.15 → 0.975), appliquée exactement à
  l'ancrage (valeur nette du joueur au lancer 0).
- **(B)** compagnie fondée en cours de partie (premier point au lancer 2, historique du joueur commençant
  au lancer 0) : l'indice ne démarre qu'au lancer 2, ancré à la valeur nette du joueur À CE LANCER
  (1200$), pas au lancer 0 (1000$) — cœur du point 2 de la conception ci-dessus.
- **(C)** les 5 cases apparaissent dans `renderPortefeuille()`, toutes décochées par défaut, aucune série
  supplémentaire dans la légende tant qu'aucune n'est cochée.
- **(D)** case MRKT cochée : série « Le marché (MRKT) » dans la légende, calculée sur les 2 compagnies
  (tous types confondus).
- **(E)** case DIVD cochée seule : série « Les dividendes (DIVD) » dans la légende (compagnie de type
  dividende seulement), aucune série MRKT.

Suite complète relancée : **158 scripts, 0 échec**. `node -c script_extracted.js`.


## 229. Popup « Évolution de mon portefeuille » — récapitulatif cumulatif de valeur nette (Portefeuille) — 2026-09-07

### Demande

« Dans portefeuille, mettre un bouton à côté du bouton "Revoir le dernier tour" en cliquant un pop-up
apparaît qui montre le détails cummulatif de l'évolution de ton portefeuille. Par exemple : Encaisse de
départ : 14M / Dividendes reçus : 1M / P&L réalisé : (3M) / Prime net d'option : 500K / P&L non réalisé :
2M / Intérêt reçu : 0K / Intérêt payé : 0K / Etc. / Valeur liquidative : XXX. Le tout bien classé, clean. »

### Analyse et conception

Contrairement aux entreprises (qui ont déjà un grand livre catégorisé complet — `FIN_CATEGORIES`/
`state.finLedger`/`logFin`, section 121), AUCUN suivi équivalent n'existait pour un JOUEUR : `avgCost`
(coût moyen pondéré) permet déjà d'afficher le P&L latent d'une position ouverte, mais un P&L RÉALISÉ (une
fois la position vendue) n'était conservé nulle part — perdu au moment même de la vente — et aucun flux
(prime d'option, intérêt de bons, frais d'emprunt à découvert) n'était accumulé dans le temps. Construire ce
popup a donc d'abord exigé d'ajouter un PETIT ensemble de compteurs cumulatifs sur `player`
(`cumDividendsReceived`/`cumRealizedPnl`/`cumOptionNetPremium`/`cumInterestReceived`/`cumInterestPaid`,
plus `startingCash` capturé une seule fois à la création) et de les incrémenter à chaque site de flux de
trésorerie déjà existant :

- **Dividendes reçus** — la boucle de versement existante (section 224/227), `pl.cash += cut`.
- **P&L réalisé** — vente ORDINAIRE d'actions (`executeShareTrade`, branche `sell`) : (prix de vente - coût
  moyen) × parts vendues, capturé AVANT la décrémentation des parts (la formule a besoin de l'avgCost
  D'AVANT) ; clôture d'une position à DÉCOUVERT (`closeShortPosition`) : (prix d'ouverture - prix de
  clôture) × parts ; et la portion de parts RÉELLEMENT détenues livrées lors d'un EXERCICE FORCÉ d'option
  (`settleOptionExercise`, branche vente, `soldFromHoldings`) — économiquement identique à une vente
  ordinaire, même formule. La portion `shortfall` de cette même branche (ouverture d'un découvert neuf)
  N'EST PAS un événement réalisé — seule sa clôture future le sera.
- **Prime nette d'option** — flux de PRIME uniquement (jamais la mécanique du sous-jacent, déjà comptée
  ci-dessus) : `openOptionPosition` (achat: prime payée, négative ; écriture: prime reçue, positive) et
  `closeOptionPosition` (clôture anticipée, symétrique). Un exercice/une expiration
  (`settleOptionExercise`/`settleExpiredOptions`) ne rejoue JAMAIS cette catégorie — la prime a déjà été
  comptée une seule fois, à l'ouverture.
- **Intérêt reçu / Intérêt payé** — `accrueBondInterest` (le signe de l'intérêt suit celui de
  `bondBalance` : positif = reçu, négatif = dette qui s'alourdit = payé) et `accrueShortBorrowFees` (frais
  Hard-to-Borrow d'une position à découvert — toujours payé).
- **P&L non réalisé** — calculé EN DIRECT (jamais stocké) au moment d'ouvrir le popup : mark-to-market de
  TOUT ce qui est encore ouvert aujourd'hui (positions longues vs `avgCost`, positions à découvert vs
  `avgOpenPrice`, positions d'option vs `premiumAtOpen`) — même logique que le P&L latent déjà affiché par
  position ailleurs dans l'onglet Portefeuille, simplement totalisée tous instruments confondus.
- **Autres / ajustement (jugement d'implémentation)** — une ligne résiduelle = `netWorth(player)` moins la
  somme de toutes les catégories ci-dessus, GARANTIT que le total affiché égale TOUJOURS exactement la
  valeur liquidative réelle, même si une exposition non explicitement listée par l'utilisateur (« Etc. » —
  ex. les prêts consentis à des entreprises, `state.loans` `lenderKind:'player'`, volontairement pas
  décomposés en détail ici) ou une sauvegarde migrée depuis avant cette section contribue un écart. N'est
  affichée que si elle n'est pas négligeable (jamais un « 0 » qui n'apporte rien) — reste TOUJOURS incluse
  dans le total sous-jacent, affichée ou non. Vérifié par test (voir plus bas) : dans un scénario qui
  couvre TOUTES les catégories explicitement listées par l'utilisateur, ce résidu est exactement 0 — la
  liste est complète pour ce périmètre, la ligne de sécurité n'est là que pour l'imprévu.

Une sauvegarde déjà en cours au moment de cette section (`migrateState`) démarre tous ces compteurs à 0 et
`startingCash` à l'encaisse ACTUELLE du joueur (impossible de reconstituer rétroactivement un historique
détaillé qui n'a jamais existé) — un avertissement dédié (« le suivi n'a démarré qu'en cours de partie »)
s'affiche alors dans le popup, même principe que `firstPeriodPartial` pour les états financiers d'entreprise
(section 121).

Bouton posé JUSTE À CÔTÉ de « Revoir le dernier tour » (`renderPortefeuilleTopBar`), Portefeuille SEULEMENT
— concept propre au joueur, sans équivalent côté Mon Entreprise. Popup construit avec l'infrastructure
`openModal` déjà existante (même style que `showTransactionPopup`) : une ligne par poste, montant signé
coloré (vert positif/rouge négatif), Valeur liquidative en gras en dernière ligne.

### Code (`script_extracted.js`)

```js
function playerNetWorthReconciliation(player){
  const startingCash = player.startingCash!==undefined ? player.startingCash : player.cash;
  const dividendsReceived = player.cumDividendsReceived||0;
  const realizedPnl = player.cumRealizedPnl||0;
  const optionNetPremium = player.cumOptionNetPremium||0;
  const interestReceived = player.cumInterestReceived||0;
  const interestPaid = player.cumInterestPaid||0;
  let unrealizedPnl = 0;
  // ... mark-to-market des positions longues/courtes/options encore ouvertes ...
  const liquidationValue = netWorth(player);
  const trackedSum = startingCash+dividendsReceived+realizedPnl+optionNetPremium+interestReceived-interestPaid+unrealizedPnl;
  const other = liquidationValue - trackedSum; // résidu — garantit un total toujours exact
  return {startingCash, dividendsReceived, realizedPnl, optionNetPremium, unrealizedPnl, interestReceived, interestPaid, other, liquidationValue, partialTracking: player.reconciliationTrackingStartedAtRoll!==undefined};
}
// Points d'incrémentation: dividendes (boucle de versement), executeShareTrade('sell'), closeShortPosition,
// settleOptionExercise (portion soldFromHoldings), openOptionPosition, closeOptionPosition,
// accrueBondInterest, accrueShortBorrowFees — voir chacun, commentaires « Section 229 ».
function showPortfolioEvolutionPopup(){ /* ... construit la table, openModal(...) ... */ }
```

### Tests

Nouveau fichier dédié : `smoke_test_step229_portfolio_evolution_popup.js` — scénario de bout en bout (2
joueurs, cubes neutralisés en blanc pour un contrôle exact du cours, même technique que
smoke_test_step224/226), 34 assertions couvrant chaque catégorie individuellement (achat/vente partielle
d'actions, short ouvert/clôturé, aller-retour d'option longue ET écrite au même prix — revient exactement à
0 de prime nette, exercice forcé construit à la main comme smoke_test_step226, intérêt de bons sur deux
joueurs de signe opposé via `buyBonds`/`shortBonds` — jamais une affectation directe de `bondBalance`, qui
fausserait l'invariant testé pour une raison étrangère au sujet —, frais d'emprunt à découvert) PUIS
l'invariant central : la somme de TOUTES les lignes (résidu inclus) égale exactement `netWorth(player)`,
avec un résidu « Autres/ajustement » mesuré à EXACTEMENT 0 dans ce scénario qui couvre la liste complète de
l'utilisateur — preuve qu'aucune catégorie n'a été oubliée ni doublée. Enfin, présence du bouton juste après
« Revoir le dernier tour » dans `renderPortefeuille()` et présence de chaque ligne attendue dans le HTML du
popup (labels échappés HTML — `&` devient `&amp;`, ajusté dans les assertions).

Suite complète relancée : **159 scripts, 0 échec**. `node -c script_extracted.js`.


## 230. Retrait des 2 lignes explicatives au-dessus du graphique de valeur nette (Portefeuille) — 2026-09-08

### Contexte et demande

Suite à la section 228, l'utilisateur a demandé pourquoi l'indice DIVD ne suit pas exactement le cours de
son unique compagnie de type dividende sur le graphique « Évolution de ma valeur nette de liquidation »
(question de compréhension, sans changement de code : l'indice compare une mise hypothétique à 100% dans le
secteur à VOTRE valeur nette réelle, qui elle mélange cette action avec de l'encaisse/d'autres actifs qui ne
bougent pas avec le marché — les deux courbes ne se superposent donc jamais parfaitement, même avec une
seule compagnie dans le secteur ; comportement voulu, pas un bug). En regardant une capture d'écran du
graphique pour illustrer sa question, demande explicite de retirer les 2 lignes de texte au-dessus des cases
à cocher : « Voilà regarde, et profite en pour enlever le "Encaisse + positions boursières (longues/courtes)
+ bons + prêts consentis + options, tout à la valeur de marché courante. Se comparer à un indice (part égale
dans chaque compagnie du secteur, à partir de votre propre valeur nette de départ) :" ».

### Changement

Simple retrait des 2 `<div class="small">` explicatifs dans `renderPortefeuille()`, juste au-dessus des
cases à cocher MRKT/DIVD/MMTM/BOOM/GARP (section 228) — les cases à cocher et le graphique lui-même sont
INCHANGÉS, seul le texte descriptif au-dessus disparaît.

### Code (`script_extracted.js`)

```js
${entrepriseAccordion('pf-valeur-nette', 'Évolution de ma valeur nette de liquidation', `
<div style="margin-bottom:6px;">${netWorthIndexCheckboxesHtml}</div>
${netWorthChartHtml}`)}
```

### Tests

Aucun nouveau fichier — retrait de texte pur, aucune logique touchée. Suite complète relancée : **159
scripts, 0 échec**. `node -c script_extracted.js`.

### Addendum (même jour) — cases à cocher réduites au simple ticker

Demande explicite de l'utilisateur, verbatim (immédiatement après le retrait ci-dessus) : « Et met just eles
ticker des index pas le texte devant exemple remplace : Les Momentum (MMTM) par MMTM ». `NET_WORTH_INDEX_DEFS.label`
(section 228) sert à la fois de texte de case à cocher ET de libellé de légende du graphique (`tvChartLegend`,
la même valeur alimente les deux) — les deux affichent donc désormais le simple ticker (« MRKT »/« DIVD »/
« MMTM »/« BOOM »/« GARP »), jamais le texte descriptif devant, cohérent partout où ce libellé apparaît (pas
seulement dans les cases à cocher explicitement citées par l'utilisateur — jugement d'implémentation:
garder les deux en phase plutôt que d'introduire un second champ juste pour la légende). `smoke_test_step228_net_worth_index_overlay.js`
mis à jour (les assertions de légende vérifient désormais `>MRKT</div>`/`>DIVD</div>`). Suite complète
relancée : **159 scripts, 0 échec**.


## 231. Popup « Évolution de mon portefeuille » simplifié — retrait de l'encaisse de départ et de la valeur liquidative, bouton renommé — 2026-09-08

### Demande

« Dans le pop-up évolution de mon portefeuille enlève l'encaisse de départ et la valeur liquidative garde
le reste. Et appelle le bouton détails supplémentaires. »

### Changement

`showPortfolioEvolutionPopup()` (section 229) : les lignes « Encaisse de départ » et « Valeur liquidative »
(l'ancien total en gras en bas de tableau) sont retirées de l'AFFICHAGE — le reste (Dividendes reçus, P&L
réalisé, Prime nette d'option, P&L non réalisé, Intérêt reçu, Intérêt payé, et la ligne résiduelle « Autres
/ ajustement » quand elle n'est pas négligeable) est inchangé. `playerNetWorthReconciliation()` elle-même
n'est PAS touchée — `startingCash`/`liquidationValue` restent calculés en interne (nécessaires au calcul du
résidu « Autres/ajustement », qui doit toujours refléter l'écart réel avec la valeur nette totale même si
celle-ci n'est plus montrée), simplement plus rendus dans le HTML du popup. Le petit avertissement de suivi
partiel (sauvegarde migrée avant cette fonctionnalité) est reformulé pour ne plus faire référence à
« Encaisse de départ », qui n'apparaît plus à l'écran.

Bouton (`renderPortefeuilleTopBar`) renommé de « 📊 Évolution de mon portefeuille » à
« 📊 Détails supplémentaires » — id/comportement/contenu du popup par ailleurs inchangés.

### Tests

`smoke_test_step229_portfolio_evolution_popup.js` mis à jour (groupe J) : vérifie désormais explicitement
que « Encaisse de départ » et « Valeur liquidative » sont ABSENTES du HTML du popup, que les autres lignes
restent toutes présentes, et que le bouton affiche bien « Détails supplémentaires ». Suite complète
relancée : **159 scripts, 0 échec**. `node -c script_extracted.js`.


## 232. Couleurs distinctes sur tous les graphiques (+ correction d'une collision exacte MRKT/DIVD) — 2026-09-08

### Demande

« Ok pour tout les graphiques les différentes lines vont devoir avoir des couleurs plus distints on a de
la misère à voir qui est qui. »

Envoyée avec une capture d'écran du graphique « Évolution de ma valeur nette de liquidation » (section
228) avec les cases MRKT et DIVD cochées en même temps.

### Investigation — un vrai bug, pas seulement une question de goût

En creusant la capture avant de choisir une palette, la cause exacte de « on ne voit pas qui est qui »
pour ce cas précis s'est révélée être une **collision de couleur EXACTE** : `NET_WORTH_INDEX_DEFS.MRKT`
utilisait `'#B45309'` (la couleur codée en dur pour « Le marché », reprise de `var(--gold)`) et
`NET_WORTH_INDEX_DEFS.DIVD` utilisait `COMPANY_TYPES.find(t=>t.key==='dividende').color`, qui valait...
`'#B45309'` également. Les deux lignes étaient donc littéralement la même couleur — ce n'était pas une
question de teintes trop proches, mais un vrai bug. La portée de la demande de l'utilisateur ne se limite
toutefois pas à ce graphique : « pour tout les graphiques » — donc une revue de tous les graphiques
multi-lignes/multi-couleurs de l'application était nécessaire, pas seulement un correctif ponctuel.

Trois graphiques différents utilisaient chacun leur propre objet de couleurs par type de compagnie,
dupliqué littéralement à 3 endroits (aucune source commune) :
- `NET_WORTH_INDEX_DEFS` (section 228, comparateur d'indices dans Portefeuille) ;
- `SECTOR_TYPE_COLORS` dans `renderPortefeuille()` (camembert « Répartition sectorielle ») ;
- `TYPE_COLORS` dans `renderSimulation()` (graphiques du simulateur boursier).

En plus de la collision MRKT/DIVD, ces 3 objets n'étaient même pas garantis rester synchronisés entre eux
(3 copies indépendantes du même concept) — un jugement d'implémentation retenu ici : plutôt que de
recolorer 3 palettes séparément (risque de ré-introduire des divergences plus tard), les consolider en
**une seule source commune**, cohérente avec la demande « pour tout les graphiques ».

### Changement

Deux nouvelles constantes PARTAGÉES, définies une seule fois près de `COMPANY_TYPES` :

```js
const COMPANY_TYPE_COLORS = { dividende:'#CA8A04', croissance:'#65A30D', garp:'#047857', momentum:'#4F46E5' };
const MARKET_ACCENT_COLOR = '#0891B2';
```

Choix des couleurs — raisonnement par séparation de teinte (jugement d'implémentation, aucune contrainte
exprimée par l'utilisateur sur les couleurs précises, seulement sur leur caractère distinct) :
- `PLAYER_COLORS` (`['#C0392B','#2E8B57','#1B3A6B','#E8821E','#8E44AD','#D6409F','#16A085','#7B4B2A']`)
  occupe déjà deux zones de teinte chargées : un groupe chaud rouge/orange/brun (~0°-35°) et un groupe
  vert/sarcelle (~145°-170°). Les 5 nouvelles couleurs ont été choisies pour éviter ces deux zones autant
  que possible, afin qu'aucune ligne d'indice/de type ne se confonde visuellement avec la couleur d'un
  joueur.
- `croissance` était auparavant sur `var(--brick)` (rouge brique) — déplacé volontairement, car cette
  variable CSS est la convention universelle de l'application pour les nombres négatifs/pertes partout
  ailleurs (voir usages de `var(--brick)` dans tout le fichier) ; la réutiliser pour une catégorie de
  compagnie était un doublon sémantique en plus du problème visuel, une croissance positive ne devrait
  jamais visuellement évoquer une perte.
- Résultat : `dividende` = ambre (`#CA8A04`, proche de `--gold` mais pas identique), `croissance` = vert
  lime (`#65A30D`, distinct du vert/sarcelle de `PLAYER_COLORS`), `garp` = vert émeraude foncé (`#047857`,
  séparé du lime), `momentum` = indigo (`#4F46E5`, seule teinte franchement bleu-violet du groupe), marché
  = cyan (`#0891B2`, seule teinte franchement bleu-cyan, loin de la marine `#1B3A6B` de `PLAYER_COLORS`).

`NET_WORTH_INDEX_DEFS` (section 228) repointé :

```js
const NET_WORTH_INDEX_DEFS = [
  {key:'MRKT', label:'MRKT', types:null, color:MARKET_ACCENT_COLOR},
  {key:'DIVD', label:'DIVD', types:['dividende'], color:COMPANY_TYPE_COLORS.dividende},
  {key:'MMTM', label:'MMTM', types:['momentum'], color:COMPANY_TYPE_COLORS.momentum},
  {key:'BOOM', label:'BOOM', types:['croissance'], color:COMPANY_TYPE_COLORS.croissance},
  {key:'GARP', label:'GARP', types:['garp'], color:COMPANY_TYPE_COLORS.garp},
];
```

`SECTOR_TYPE_COLORS` dans `renderPortefeuille()` (camembert sectoriel) et `TYPE_COLORS` dans
`renderSimulation()` (graphiques du simulateur) ne sont plus des objets littéraux dupliqués : les deux
sont maintenant un simple alias vers la constante commune (`const SECTOR_TYPE_COLORS =
COMPANY_TYPE_COLORS;` / `const TYPE_COLORS = COMPANY_TYPE_COLORS;`) — un seul endroit à modifier si la
palette doit encore changer un jour, garantie que les 3 graphiques restent synchronisés.

La ligne « Le marché » du comparateur de cours (`renderPortefeuilleCompareChart`, case à cocher
pré-existante, hors section 228) utilisait elle aussi l'ancienne couleur codée en dur `'#B45309'` —
repointée vers `MARKET_ACCENT_COLOR` par cohérence (même concept « marché » que MRKT dans le nouveau
comparateur d'indices, même couleur partout où « le marché » apparaît).

### Tests

Nouveau fichier `smoke_test_step232_distinct_chart_colors.js` (14 assertions) :
- (A) les 5 couleurs de `NET_WORTH_INDEX_DEFS` sont mutuellement distinctes — prouve directement la
  correction du bug concret rapporté (MRKT ≠ DIVD) ;
- (B) `COMPANY_TYPE_COLORS` (4 types) + `MARKET_ACCENT_COLOR` sont eux aussi mutuellement distincts ;
- (C) aucune de ces 5 couleurs ne coïncide EXACTEMENT avec une couleur de `PLAYER_COLORS` ;
- (D) le camembert sectoriel de `renderPortefeuille()` utilise bien `fill="${COMPANY_TYPE_COLORS.dividende}"`
  pour la tranche Dividendes (source unique, pas une palette divergente) ;
- (E) `renderSimulation()` (après un run réel de `runStockSimulation()`) utilise bien
  `COMPANY_TYPE_COLORS[t.key]` pour chacun des 4 types ;
- (F) la ligne « Le marché » du comparateur de cours utilise `stroke="${MARKET_ACCENT_COLOR}"` et n'utilise
  plus jamais `stroke="#B45309"`.

Suite complète relancée : **160 scripts, 0 échec**. `node -c script_extracted.js`.


## 233. Risque réel sur les obligations joueur→compagnie (+ option garantie) et cote de crédit (flavor) — 2026-09-08

### Demande

Message unique de l'utilisateur regroupant plusieurs correctifs et ajouts, verbatim :

« Quelques correctifs et ajouts :

1) Il faut que les joueurs aient un risque réel en acceptant une émissions d'obligation d'une compagnie.
Par exemple qu'il prête 5M aux termes 20% des loyers avec un multiple 2X. Leur valeur nette ne doit pas
prendre en compte le dû. Si la partie devait se finir abruptement on ne tient pas compte de la dette
restante à être payer... CEPENDANT, ajouter en option quand un joueur soumet son offre (%loyer, Multiple)
un troisième critère, un choix entre "Obligation garantie" vs "Obligation non garantie". Une obligation
garantie ferait en sorte que la dette à être payé (non payé encore) compterai dans la valeur nette du
joueur en fin de partie et se paierai via les parts du CEO de la compagnie. Naturellement si les parts ne
couvrent pas l'entièreté du solde, le joueur aura le maximum entre sa part dû et la valeur du CEO dans
cette entreprise. Un CEO garantissant un tel prêt verra sa valeur nette diminuer en fin de partie pour
rembourser le tout.

2) J'aimerais ajouter un flavor. Une cote de crédit voir en pièce jointe la photo pour chaque compagnie,
mettre la cote dans les produits de financement ou d'émission.

3) J'aimerais ajouter une option pour une compagnie. L'émissions de parts privilégié : [...] »

(point 3 — parts privilégiées rachetables — et point 4 — encaisse négative — détaillés plus bas, voir
« Points 3 et 4 » en fin de section pour leur traitement séparé.)

Photo jointe au point 2 : une table à 20 lignes (AAA, AA+/AA/AA-, A+/A/A-, BBB+/BBB/BBB-, BB+/BB/BB-,
B+/B/B-, CCC+/CCC/CCC-, D) avec pour chacune une description qualitative (« Excellente » … « En faillite »).

### Vérification préalable contre le code et les docs du Project

Avant tout changement : `netWorth(player)` comptait déjà, sans AUCUNE condition, la créance encore due
(`totalDue-repaidSoFar`) sur chaque prêt où le joueur est prêteur (`lenderKind==='player'`) — confirmé un
vrai bug/absence de risque, exactement ce que l'utilisateur signale au point 1. Aucune cote de crédit
n'existait dans le code. `claude/DESIGN_PRIVILEGIEES_ET_NOTATION.md` (déjà dans le Project, daté du jour
même) contenait une spec de conception COMPLÈTE pour la cote de crédit ET pour des parts privilégiées
rachetables — mais avec une mécanique de parts privilégiées matériellement DIFFÉRENTE de celle décrite dans
le point 3 de ce message (valeur nominale fixe vs prix = cours de l'action, premier arrivé premier servi vs
distribution à part égale, rappel à prime dégressive vs prix de rachat fixé par le CEO, valeur figée vs
valeur suivant le cours). Ce conflit, ainsi que la recommandation de la spec elle-même de construire la
cote de crédit SEULE d'abord (affichage pur, avant tout marché de parts privilégiées, pour isoler les
problèmes de calibration), ont été soumis à l'utilisateur via `AskUserQuestion` avant tout code :

- Parts privilégiées : réponse **« Version de ce message »** (le point 3 tel que tapé ici, PAS la version du
  document de conception) — retenue pour une **prochaine passe**, non construite dans cette section.
- Séquençage : réponse **« Cote seule d'abord (recommandé) »** — la cote de crédit est implémentée dans
  cette section en affichage PUR (aucune tarification, aucun cube de changement de cran, aucun marché de
  parts privilégiées encore branché) ; le marché de parts privilégiées suit dans une prochaine passe, une
  fois la cote validée en jouant.

Cette section couvre donc entièrement le point 1, le point 2 (cote de crédit, affichage seul), et confirme
le point 4 (déjà entièrement implémenté, voir plus bas) — le point 3 (parts privilégiées) reste **remis à
plus tard**, sa mécanique confirmée (« Version de ce message ») étant simplement actée ici pour ne pas se
reperdre.

### Partie 1 — Risque réel sur les prêts joueur→compagnie + option « garantie »

`netWorth(player)` ne compte plus AUTOMATIQUEMENT la créance due d'un prêt où le joueur est prêteur — un
prêt **non garanti** (comportement PAR DÉFAUT, y compris pour toute sauvegarde antérieure à cette section,
sans migration nécessaire : `l.secured` est simplement `undefined`, donc falsy) n'apporte plus RIEN à la
valeur nette du prêteur, quel que soit le solde encore dû. Risque réel, exactement comme demandé : « Si la
partie devait se finir abruptement on ne tient pas compte de la dette restante à être payer ».

Un 3e critère est ajouté au formulaire d'offre (`submitLoanOffer`, case à cocher « garantie » dans le
bandeau d'annonces du Portefeuille, et dans le formulaire Administration `modalIssueLoanAdmin`) : un prêt
**garanti** compte au net worth du prêteur, mais PLAFONNÉ à la valeur des parts de fondateur du CEO
emprunteur dans sa propre compagnie — jamais plus que ce que le CEO peut réellement couvrir. La phrase de
l'utilisateur disait littéralement « le maximum entre sa part dû et la valeur du CEO » ; interprétée comme
un lapsus pour un PLAFOND (donc le *minimum* des deux montants) — le contexte immédiat, « si les parts ne
couvrent pas l'entièreté du solde », décrit sans ambiguïté un plafonnement, jamais un plancher. Documenté
en tête de la fonction concernée pour confirmation si ce n'était pas l'intention.

Généralisation retenue au cas de PLUSIEURS prêts garantis simultanés sur la même compagnie (l'utilisateur
n'a donné qu'un exemple à un seul prêt) — jugement d'implémentation : la part du CEO est le collatéral
COMMUN de tous ses prêts garantis, jamais compté deux fois. Si sa valeur ne couvre pas la somme des soldes
garantis dus, le manque est réparti AU PRORATA entre les prêteurs garantis (aucun rang de priorité entre
eux). Le CEO, de son côté, voit sa valeur nette diminuer de la TOTALITÉ du collatéral effectivement consommé
— jamais plus que ce qu'il possède.

#### Code (`script_extracted.js`)

```js
function securedLoanGuaranteeInfo(){
  const payoutByLoanId = {};
  const ceoDeductionByCompanyId = {};
  const byBorrower = {};
  (state.loans||[]).forEach(l=>{
    if(!l.secured) return;
    if(!(l.repaidSoFar < l.totalDue-1e-9)) return;
    (byBorrower[l.borrowerId] = byBorrower[l.borrowerId]||[]).push(l);
  });
  Object.keys(byBorrower).forEach(companyId=>{
    const co = companyById(companyId);
    const loans = byBorrower[companyId];
    if(!co){ return; }
    const sumDue = loans.reduce((s,l)=>s+(l.totalDue-l.repaidSoFar), 0);
    const ceoStake = co.shareholders.find(s=>s.playerId===co.ceoId);
    const ceoStakeValue = ceoStake ? ceoStake.shares*(co.stockPrice||0) : 0;
    const pool = Math.max(0, Math.min(ceoStakeValue, sumDue));
    ceoDeductionByCompanyId[companyId] = pool;
    if(sumDue<=1e-9) return;
    loans.forEach(l=>{
      const due = l.totalDue-l.repaidSoFar;
      payoutByLoanId[l.id] = pool * (due/sumDue);
    });
  });
  return {payoutByLoanId, ceoDeductionByCompanyId};
}
```

Dans `netWorth(player)` : la créance d'un prêt joueur→compagnie n'est plus ajoutée que si `l.secured`, via
`secured.payoutByLoanId[l.id]` — et pour chaque compagnie dont le joueur est CEO, `secured.ceoDeductionByCompanyId[co.id]`
est soustrait (miroir passif, sa propre part étant déjà comptée intégralement par ailleurs dans la boucle
`state.companies`).

`submitLoanOffer`/`acceptLoanOffer`/`issueLoan` transportent désormais un 5e paramètre `secured` (booléen,
`!!` normalisé) de bout en bout — de la case à cocher du formulaire d'offre jusqu'à l'entrée `state.loans`
créée. Statut affiché (🔒 Garantie / Non garantie) : dans le tableau d'offres du CEO emprunteur
(`modalIssueLoan`), dans la vue Mon Entreprise du CEO emprunteur (avec un avertissement dédié quand au moins
un prêt garanti est actif), et dans la vue Portefeuille du prêteur (avec une colonne « Compté à ma valeur
nette » montrant le montant RÉELLEMENT compté — 0 pour un prêt non garanti, potentiellement moins que le
solde dû pour un prêt garanti mal couvert).

#### Tests

`smoke_test_step233_secured_loan_risk.js` (nouveau, 20 assertions, 4 compagnies/CEO + 5 prêteurs dédiés
pour une isolation propre de chaque scénario) : (A) prêt non garanti — créance non comptée du tout ; (B)
prêt garanti entièrement couvert, via le PIPELINE COMPLET (`postLoanRequest`→`submitLoanOffer`→
`acceptLoanOffer`) — pleine créance comptée côté prêteur, diminution exacte côté CEO ; (C) prêt garanti
sous-collatéralisé (un seul prêt) — exactement l'exemple donné par l'utilisateur (`min(solde dû, collatéral)`) ;
(D) DEUX prêts garantis sur la même compagnie, ensemble sous-collatéralisés — répartition au prorata
vérifiée exactement, garde-fou sur la somme ; (E) UI (case à cocher, tableau d'offres, avertissement Mon
Entreprise, colonne Portefeuille). `smoke_test_step70_section157_bonds_and_loan_market.js` mis à jour (test
J) : le comportement attendu s'inverse pour un prêt non garanti (créance NON comptée, au lieu de comptée
intégralement comme avant cette section).

Suite complète relancée : **161 scripts, 0 échec**. `node -c script_extracted.js`.

### Partie 2 — Cote de crédit (flavor, affichage pur)

Reprend fidèlement `claude/DESIGN_PRIVILEGIEES_ET_NOTATION.md` (Partie 1) : 3 facteurs pondérés
50/30/20, recalculés EN DIRECT à chaque affichage (jamais figés), aucune nouvelle donnée nécessaire —
endettement (`companyDebtRatio`), couverture des charges (`netIncomeExpectationRatio`), historique de
défaut (`lastResortLoanUsed`/`dividendLossStreak`, pénalité seulement, jamais un bonus).

Réconciliation entre l'échelle simplifiée de la spec (7 crans : AAA/AA/A/BBB/BB/B/CCC) et l'échelle bien
plus granulaire montrée en pièce jointe (avec +/-, jusqu'à D, 20 lignes avec description qualitative) —
jugement d'implémentation, les deux servent à des fins différentes, jamais en conflit : la note AFFICHÉE
(`grade`) est la granulaire (correspond exactement à la photo), le `cran` grossier (7 niveaux + D) reste la
version simplifiée, réservée à un usage futur (tarification, cubes de changement de cran) qui n'a pas
besoin d'une telle granularité.

Détails de la formule (voir le commentaire complet dans `script_extracted.js`, juste avant
`companyCreditRatingInfo`) :

- **Endettement (50%)** : `companyDebtRatio(company)` directement comme badness (0 à ~1).
- **Couverture des charges (30%)** : `netIncomeExpectationRatio` calculé sur l'HISTORIQUE COMPLET de la
  compagnie (`incomeStatementFor(id,'all')`, jugement d'implémentation — évite une volatilité extrême juste
  après chaque bascule de semestre) ; badness = `1-ratio/2` (0 à ratio≥2, 1 à ratio=0). Cas particulier :
  compagnie sans AUCUNE activité enregistrée (revenus ET dépenses nuls, typiquement tout juste fondée) →
  badness NEUTRE (0.5), pas le pire cas.
- **Historique de défaut (20%, pénalité seulement)** : `lastResortLoanUsed` pèse 0.6 (permanent) ;
  `dividendLossStreak` ajoute 0.15 par semestre consécutif, plafonné à 0.4 — cumulables jusqu'à 1.0.
- **D (« En faillite »)** n'est PAS une simple queue de la note pondérée — c'est un état d'INSOLVABILITÉ
  RÉELLE, déclenché uniquement par `companyDebtRatio(company)>=1` (donc `companyValue(company)<=0`) : un
  plancher séparé, jamais atteignable par un simple cumul de mauvais facteurs.

Affichée aux 3 endroits demandés (« mettre la cote dans les produits de financement ou d'émission ») via un
badge commun `creditRatingBadgeHtml(company)` (couleur à 3 paliers — vert investment grade, doré spéculatif,
brique CCC/D) : Mon Entreprise (sa propre cote), le bandeau d'offres de prêt du Portefeuille (cote de la
compagnie emprunteuse, AVANT que le prêteur ne décide de ses conditions), et `modalIssueLoan` (rappel de sa
propre cote au CEO emprunteur, dans ses 2 branches — formulaire de publication et tableau d'offres reçues).

#### Tests

`smoke_test_step233_credit_rating.js` (nouveau, 22 assertions, 7 compagnies/CEO isolant chaque facteur) :
(A) compagnie fraîche — couverture neutre, investment grade ; (B) couverture des charges — ratio 2 → badness
0, ratio 0.25 → badness 0.875 ; (C) endettement — score exactement dégradé selon `companyDebtRatio` réel ;
(D) insolvabilité réelle — grade forcé à D/« En faillite », jamais un 20e barreau pondéré ; (E) historique
de défaut — pénalité plafonnée à 1.0 vérifiée exactement ; (F) regroupement grade granulaire → cran grossier
et investment grade ; (G) affichage aux 3 endroits demandés. Chaque scénario recalcule INDÉPENDAMMENT, dans
le test, la formule 50/30/20 attendue et compare EXACTEMENT au résultat de `companyCreditRatingInfo()` —
vérifie le câblage des poids/seuils, pas seulement des propriétés qualitatives vagues.

Suite complète relancée : **162 scripts, 0 échec**. `node -c script_extracted.js`.

### Points 3 et 4 de la demande originale

**Point 3 (parts privilégiées rachetables)** : mécanique confirmée par l'utilisateur (« Version de ce
message ») — prix de part = cours de l'action ordinaire courant, l'entreprise fixe le taux de dividende
préférentiel ET un prix de rachat (callable) explicite, plafond cumulatif de 5M$ par partie, avertissement
envoyé à tous les joueurs pour le tour suivant (accepter/refuser, distribution à PART ÉGALE entre tous les
joueurs ayant accepté — PAS premier arrivé premier servi), valeur des parts en fin de partie = le PLUS
PETIT entre le prix du marché et le prix de rachat, arriérés cumulatifs (dividende non versé → cubes rouges
+ blocage des dividendes ordinaires tant que l'arriérage n'est pas réglé), cubes verts au rachat par
l'entreprise. **Remise à une prochaine passe** (réponse de l'utilisateur : « Cote seule d'abord ») —
`claude/DESIGN_PRIVILEGIEES_ET_NOTATION.md` reste la référence pour la cote de crédit (Partie 1, livrée
ci-dessus) ; sa Partie 2 (parts privilégiées) est OBSOLÈTE et sera remplacée par la version confirmée
ci-dessus lors de son implémentation.

**Point 4 (encaisse négative + « Terminer mon tour »)** : verbatim, « Il est possible (sauf ETF pour
soumettre une offre) d'avoir une encaisse négative tant du côté joueur que du côté entreprise. Cependant, il
n'est pas possible de cliquer sur "Terminer mon tour" tant que l'encaisse est négative. » Vérifié contre le
code AVANT toute action : déjà entièrement en place, aucun changement nécessaire. `submitEtfBid` plafonne
toute mise à l'encaisse disponible de la compagnie (`co.cash`, section 216) — une compagnie ne peut jamais
miser plus qu'elle n'a réellement. Le bouton « ✅ Tour Terminé » (`markCompanyReady`, section 179) est
désactivé tant que `company.cash<0`, avec le même garde-fou dupliqué côté fonction (`markCompanyReady`
elle-même refuse si `co.cash<0`). Les joueurs eux-mêmes n'ont plus de « tour » à terminer depuis la
migration acteur-plateau vers les entreprises (étape 5/8, 2026-09-01) — rien à bloquer de ce côté, aucune
régression identifiée par rapport à la description de l'utilisateur.

## 234. Émission de nouvelles actions / Rachat d'actions (nouvelles actions d'entreprise) + correctif encaisse négative "Tour Terminé" — 2026-09-08

Demande explicite de l'utilisateur, verbatim :

> ajouter deux actions dans mon entreprises :
>
> 1) Émissions de nouvelles actions:
> Impact : Reçoit l'argent en fonction du prix de l'action, ajoute des cubes rouges dans les mêmes
> proportion qu'une vente d'actions (avec un petit bonus rouges)
> Limites : Ne peut pas émettre plus que 10% des parts de départ (dans les paramètres de départs)
>
> 2) Rachat d'actions
> impact: Achat au prix des actions, ajoute des cubes verts comme un achat de l'action avec bonus vert.
>
> Toutes part racheter peux être émission a nouveau plus tard, en ajout au 10% d'émissions.
>
> pas d'impact sur le nombre de parts disponibles puisque techniquement dans le jeu il n'y a pas de
> limites.
>
> Est-ce que tu comprend bien?

Avant de répondre, vérification du code (jamais d'implémentation avant confirmation, méthodologie établie
de cette session) : `company.totalShares` n'est JAMAIS muté après la fondation (`createCompany`, une seule
fois) ; `sharesIssued`/`company.shareholders` ne bougent que via l'IPO initiale (`applyCompanyIpoFunding`)
ou le trading secondaire joueur (`executeShareTrade`). Ça confirme la lecture « pas d'impact sur le nombre
de parts disponibles » : les deux nouvelles actions sont un pur mouvement de trésorerie + cubes, sans
jamais toucher `totalShares`/`sharesIssued`/`shareholders` — aucune dilution ni retrait réel de parts,
contrairement à une vraie émission/un vrai rachat boursier. Lecture du mécanisme de trading joueur existant
(`executeShareTrade`/`tradeCubeRange`/`injectStockCube`) pour comprendre « mêmes proportions » : un système
cumulatif anti-fragmentation par compagnie/couleur (`company.tradeImpactAccum`), qui injecte des cubes
proportionnellement au nombre d'« unités d'impact » (0,5% du flottant) franchies par la transaction.

Compréhension restituée à l'utilisateur avant tout code, avec les points d'implémentation encore ouverts
(fenêtre de trading, restriction CEO, saisie en parts vs $) — réponse de l'utilisateur, verbatim :

> Oui restrictions aux semestres seulement, le ceo ça n'a pas rapport ici le ceo contrôle les actions de la
> compagnie mais c'est l'argent de la compagnie qui est utilisé pas celle du CEO personnellement.
>
> aussi pour éviter des problèmes, l'encaisse négatives des joueurs et des entreprises ne permet pas de
> passer au tour suivant seulement aux semestres. dans un tour normal on ferme les yeux. raison: la
> majorité des options de financement sont aux semestres ça briserai le jeu.

### Partie 1 — Émission de nouvelles actions / Rachat d'actions

Deux nouvelles fonctions `issueNewShares(company, qty)` / `buybackShares(company, qty)`, symétriques,
juste après `tradeCompanyShares` dans `script_extracted.js` :

- **Saisie en nombre de PARTS** (`qty`), jamais un montant $ — contrairement au trading joueur, qui
  fonctionne en $ (trading fractionnaire) : ici le plafond de 10% et la fourchette de cubes proportionnelle
  sont tous deux exprimés en parts.
- **Émission** : `company.cash += qty*stockPrice` (émission PRIMAIRE — contrairement au trading secondaire
  joueur qui ne touche JAMAIS `company.cash`, voir le commentaire d'`executeShareTrade`), logué sous
  `share_issuance_proceeds` (même catégorie de grand livre que l'IPO initiale — financement, jamais un
  revenu d'exploitation, `bucket:null`). Cubes ROUGES.
- **Rachat** : `company.cash -= qty*stockPrice`, logué sous une NOUVELLE catégorie symétrique
  `share_repurchase_outflow` (financement, `bucket:null`, ajoutée à `FIN_CATEGORIES`). Cubes VERTS. Aucune
  garde sur l'encaisse résultante — l'encaisse négative est explicitement permise partout dans le jeu sauf
  pour soumettre une offre ETF (section 233 point 4) ; un rachat peut donc rendre l'encaisse négative,
  exactement comme un dividende ou une taxe le peuvent déjà.
- **Cubes — « mêmes proportions »** : réutilise TEL QUEL `tradeCubeRange(company, qty, color)` (même
  accumulateur cumulatif `tradeImpactAccum` que le trading joueur — une émission/un rachat fractionné en
  plusieurs petites tranches ne permet donc pas de passer sous le radar, cohérent avec l'esprit
  anti-fragmentation déjà en place pour le trading joueur).
- **« petit bonus »** : bonus ADDITIF (`STOCK_TRIGGER_SHARE_ISSUANCE_BONUS_MIN/MAX` = 1-2,
  `STOCK_TRIGGER_SHARE_BUYBACK_BONUS_MIN/MAX` = 1-2, calibrables comme tous les `STOCK_TRIGGER_*`
  existants), injecté **inconditionnellement** — jugement d'implémentation documenté ici : contrairement à
  `tradeCubeRange`, qui peut retourner `null` pour une transaction trop petite pour franchir une unité
  d'impact (garde-fou pensé pour le trading joueur, qui PEUT se répéter en une multitude de micro-ordres),
  une émission/un rachat est une décision CEO déclarée, jamais une micro-transaction fragmentée de ce
  genre — le petit bonus, toujours présent, reflète que cette action est structurellement plus
  significative qu'un simple trade secondaire de même taille (dilution réelle pour l'émission, retrait réel
  d'offre pour le rachat).
- **Plafond de 10%** : nouveau champ `company.cumulativeSharesEmittedNet` (initialisé paresseusement à 0,
  même convention que `company.tradeImpactAccum`) = émissions cumulées − rachats cumulés depuis le début de
  la partie, **plancher 0** (jamais négatif). `shareIssuanceRemainingCap(company)` = `max(0, 10%×totalShares
  − cumulativeSharesEmittedNet)`. Un rachat réduit ce compteur (plancher 0) — libère donc bien de la marge
  future, « en ajout au 10% d'émissions », **sans jamais faire dépasser le plafond d'origine** même si
  l'entreprise rachète au total plus qu'elle n'a jamais émis (couvert par un test dédié, voir plus bas).
- **Restrictions communes** (les deux fonctions) : IPO de la compagnie terminée
  (`companyPendingIpoShares<=0`), **fenêtre de trading ouverte** (`tradingWindowOpen()` — semestres
  uniquement, confirmé par l'utilisateur : « restrictions aux semestres seulement »), partie non terminée.
  **Aucune restriction CEO** (contrairement à `tradeCompanyShares`, dont la garde anti-délit d'initié ne
  vise QUE le CEO qui tenterait de trader PERSONNELLEMENT ses propres parts) — confirmé explicitement par
  l'utilisateur : « le ceo ça n'a pas rapport ici le ceo contrôle les actions de la compagnie mais c'est
  l'argent de la compagnie qui est utilisé pas celle du CEO personnellement ».
- **UI** : deux boutons dans le menu ☰ Actions de l'onglet Mon Entreprise, groupe « Finance » (« 📤 Émission
  de nouvelles actions » / « 📥 Rachat d'actions »), ouvrant `modalIssueNewShares()`/`modalBuybackShares()`
  (même pattern qu'`modalAnnounceDividend` : `openModal`, un seul champ numérique, `#mOk` délègue toute la
  logique de mutation à la fonction métier). Désactivés hors fenêtre de trading ; le bouton d'émission est
  en plus désactivé une fois le plafond de 10% atteint (le rachat, lui, n'a pas d'autre limite). Le texte
  d'avertissement des deux modales ne mentionne jamais les cubes (implémentation interne, jamais exposée au
  joueur — même convention que `modalPublicCeoStatement`/section 161), seulement l'effet perçu (pression
  baissière/haussière sur le marché).

Testé par `smoke_test_step234_share_issuance_buyback.js` (39 assertions) : (A) émission de base — encaisse
créditée du montant exact, cubes rouges (base proportionnelle + petit bonus, `Math.random` neutralisé à 0
pour un résultat exactement déterministe), compteur cumulatif, écriture de grand livre
`share_issuance_proceeds` ; (B) plafond de 10% — refus au-delà de la marge restante, succès pile à la
marge, refus total une fois épuisée ; (C) rachat de base — encaisse débitée (peut devenir négative), cubes
verts, écriture `share_repurchase_outflow` ; (D) un rachat libère bien de la marge d'émission sans jamais
dépasser le plafond d'origine ; (E) les 3 restrictions communes (fenêtre de trading, IPO non terminée,
partie terminée) pour les deux actions ; (F) UI — présence/état actif-désactivé des deux boutons selon la
fenêtre de trading et l'épuisement du plafond ; (G) voir Partie 2 ci-dessous.

### Partie 2 — Correctif : encaisse négative ne bloque « Tour Terminé » qu'aux frontières de semestre

Corrige la section 179 (qui bloquait `markCompanyReady` sur `company.cash<0` à CHAQUE tour, sans condition).
Demande explicite de l'utilisateur, verbatim (voir citation complète ci-dessus) : « l'encaisse négatives des
joueurs et des entreprises ne permet pas de passer au tour suivant seulement aux semestres. dans un tour
normal on ferme les yeux. raison: la majorité des options de financement sont aux semestres ça briserai le
jeu. » — la plupart des outils de financement (prêts, dividendes, trading joueur, et désormais
émission/rachat d'actions) ne sont accessibles QU'aux semestres ; bloquer à chaque tour intermédiaire aurait
pu coincer une entreprise en encaisse négative sans aucun moyen d'agir jusqu'au prochain semestre.

Implémentation : `markCompanyReady` (garde métier réelle) et `readyActionHtml` (garde UI, bouton désactivé +
tooltip) bloquent désormais seulement si `company.cash<0 && tradingWindowOpen()` — un tour normal
(`tradingWindowOpen()===false`) laisse passer même avec une encaisse négative. Note : seule l'entreprise a
un bouton « Tour Terminé » dans ce jeu (les joueurs n'ont plus d'action de plateau propre depuis la
migration acteur-plateau vers les entreprises, étape 5/8) — la mention « des joueurs et des entreprises »
de l'utilisateur est donc couverte par ce seul point d'entrée.

Testé dans le même fichier `smoke_test_step234_share_issuance_buyback.js`, scénario (G) : `markCompanyReady`
refuse (encaisse négative + `tradingWindowOpen()===true`) à la frontière de semestre, avec le bouton
désactivé côté UI ; puis, encaisse toujours négative mais `tradingWindowOpen()===false` (tour normal),
`markCompanyReady` accepte (« ferme les yeux ») — vérifié à la fois sur la valeur retournée
(`company.ready===true`) et sur le rendu (le bouton bascule sur « 🔄 Annuler Tour Terminé »).

Suite complète relancée : **163 scripts, 0 échec**. `node -c script_extracted.js` OK. `python3
sync_script.py` relancé, `diff index.html monopolybourse.html` vide.

## 235. Stratégies d'options à règlement CASH SEULEMENT (bull spread / bear spread / ATM straddle) — 2026-09-08

Demande explicite de l'utilisateur, verbatim :

> dans les actions portefeuille ajouter un bouton. Stratégies d'options
>
> Ajouter: acheter/ vendre
> bull spread
> bear spread
> Atm straddle
>
> toutes ces Stratégies sont cash settlement seulement. aucune livraison de stocks comparer aux autres
> options disponibles.

Vérification du code AVANT toute question/implémentation : les options simples existantes (call/put,
long/écrite) sont réglées à l'échéance par EXERCICE/ASSIGNATION PHYSIQUE (`settleOptionExercise`, section
152/226) — un achat/une vente RÉELLE de parts au strike, jamais un simple paiement de la différence en
cash (l'ancien comportement cash a été explicitement remplacé à la section 152). C'est exactement le
contraste que l'utilisateur pointe : ces 3 nouvelles stratégies doivent, elles, rester réglées EN CASH,
jamais par livraison — une exception délibérée pour ces stratégies précisément, la règle générale des
options simples restant inchangée.

Deux points de construction restaient ambigus avant tout code — posés via `AskUserQuestion` :

1. **Instruments du bear spread** : un bull spread « vendu » (jambes inversées) donne déjà mathématiquement
   un bear spread sur calls — construire le bear spread avec des calls en aurait donc fait un pur doublon
   de « vendre un bull spread ». Réponse de l'utilisateur, verbatim : « Acheter un bull spread = +C -C
   vendre un bull spread = - C +C acheter un bear spread = +P -P vendre = -P +P » — confirmé : bull spread
   = CALLS, bear spread = PUTS, deux instruments distincts.
2. **Strikes des spreads** : au choix du joueur (2 menus déroulants, comme la chaîne actuelle) — confirmé,
   jamais une largeur fixe imposée.

### Construction retenue

- **Bull spread** (calls) : acheter = long call strike bas + short call strike haut ; vendre = l'inverse.
- **Bear spread** (puts) : acheter = long put strike haut + short put strike bas ; vendre = l'inverse.
- **ATM straddle** : acheter = long call ATM + long put ATM ; vendre = l'inverse écrit. Strike ATM = le
  `stockPrice` courant AU MOMENT DE L'OUVERTURE (comme n'importe quel strike de la chaîne existante),
  jamais recalculé ensuite.
- **Strikes des spreads** : au choix du joueur parmi n'importe quelle valeur positive (l'UI propose les 5
  strikes de la chaîne existante via 2 menus déroulants « Strike bas »/« Strike haut », par défaut -10%/
  +10%), avec validation stricte `strikeHaut > strikeBas`.
- **Contrats** : un seul nombre, entier positif, IDENTIQUE sur les 2 jambes (ratio 1:1, jamais inégal dans
  cette phase).

### Implémentation

Chaque JAMBE d'une stratégie est une entrée NORMALE de `player.optionPositions` — réutilise TOUTE
l'infrastructure existante du module Options (pricing Black-Scholes via `optionPremiumFor`, marge via
`enforceMarginCalls`/`optionCoveredShares`, déjà génériques sur toute entrée `side:'short'`, clôture
anticipée via `closeOptionPosition` INCHANGÉE), avec deux champs additionnels :
- `strategyId` (partagé entre les 2 jambes d'une même ouverture, pour le regroupement à l'affichage et la
  fermeture atomique) ;
- `cashSettled:true` (bascule le règlement À L'ÉCHÉANCE — voir `settleExpiredOptions`, seule branche
  modifiée — d'un exercice/une assignation PHYSIQUE vers `settleOptionStrategyLegCash`, un simple paiement
  cash de la valeur intrinsèque : position longue ITM → le joueur REÇOIT `intrinsic×100×contrats` ;
  position écrite ITM → le joueur PAIE ce même montant, sans aucune garde d'encaisse — même philosophie
  que l'écriture nue partout ailleurs. AUCUN mouvement sur `company.shareholders`/`player.shortPositions`,
  AUCUN cube injecté — même convention que le reste du module Options, où l'ouverture/la clôture anticipée
  n'injecte déjà aucun cube).

`openOptionStrategy(company, player, kind, direction, strikeLow, strikeHigh, expiryRoll, contracts)` :
mêmes gardes qu'`openOptionPosition` (fenêtre de trading aux semestres, CEO ne peut trader aucune stratégie
sur sa propre compagnie, partie non terminée, IPO terminée, garde « prêt de dernier recours » — aucun
short call ni long put — appliquée JAMBE PAR JAMBE, une stratégie dont au moins une jambe l'enfreint est
refusée EN BLOC). Le coût NET (somme signée des 2 jambes — jambe longue = débit, jambe courte = crédit)
détermine la SEULE garde d'encaisse (un débit net insuffisant refuse l'ouverture ; un crédit net n'a aucune
garde, même philosophie que l'écriture nue).

`closeOptionStrategy(player, strategyId)` : ferme les 2 jambes encore ouvertes via `closeOptionPosition`
(inchangée), agrège les entrées en un seul popup.

Décision d'implémentation documentée (pas demandée à l'utilisateur, détail technique) : AUCUNE fusion avec
une position simple préexistante identique (contrairement à `openOptionPosition`, qui fusionne) — une
ouverture de stratégie crée toujours 2 jambes fraîches, pour qu'une fusion ne fasse jamais basculer
involontairement un contrat physique existant vers un règlement cash (ou l'inverse). Conséquence documentée
et acceptée d'`enforceMarginCalls` (INCHANGÉ, aucun code spécial ajouté) : un appel de marge cible et
clôture une SEULE jambe à la fois — il peut donc, dans un scénario extrême, casser une stratégie en
clôturant une seule de ses 2 jambes, laissant l'autre ouverte comme position simple. Simplification
volontaire, même esprit que d'autres simplifications déjà documentées dans ce module (voir le commentaire
d'`optionCoveredShares`).

### UI

Nouveau bouton « 🧩 Stratégies d'options » dans le menu ☰ Actions du Portefeuille (groupe Options, à côté
de « Voir la chaîne d'options »/« Nouvelle position d'option »), ouvrant `modalOptionStrategy()` :
sélection d'entreprise/stratégie/direction, 2 menus déroulants de strike (masqués pour l'ATM straddle,
qui n'a par définition aucun strike à choisir), échéance, contrats — avec un panneau détaillant les 2
jambes construites et le débit/crédit net AVANT confirmation.

Les jambes de stratégie n'apparaissent plus dans la table « Mes positions d'options » (réservée aux
options simples) — une nouvelle table « Mes stratégies d'options » les regroupe par `strategyId` (1 ligne
par stratégie, coût net à l'ouverture / valeur nette actuelle / P&L latent / bouton « Fermer la
stratégie »), dans le même accordéon « Options (PUT/CALL) ».

### Tests

`smoke_test_step235_option_strategies.js` (28 assertions), une compagnie dédiée par scénario : bull spread
acheté/vendu et bear spread acheté/vendu entièrement ITM (le payoff net cash = exactement la largeur du
spread, jamais l'intrinsèque brut d'une seule jambe — vérifié en agrégeant tous les scénarios sur une
fenêtre de 3 lancers commune, comme `smoke_test_step65`, avec le prix de chaque compagnie figé
indépendamment via un monkey-patch de `drawStockCubes`) ; ATM straddle acheté/vendu (seule la jambe ITM
paie, strike capturé au prix d'ouverture) ; bull spread entièrement hors-jeu (aucun mouvement cash) ;
AUCUNE livraison physique nulle part (`company.shareholders`/`player.shortPositions` strictement
inchangés après un règlement ITM) ; toutes les validations d'ouverture (strikes invalides, contrats non-
entiers, CEO, IPO non terminée, fenêtre de trading fermée, partie terminée) ; clôture anticipée des 2
jambes ; présence UI du bouton et des 2 tables distinctes.

Suite complète relancée : **164 scripts, 0 échec**. `node -c script_extracted.js` OK. `python3
sync_script.py` relancé, `diff index.html monopolybourse.html` vide.

## 236. Correctif de couleur — « Coût net à l'ouverture » des stratégies d'options (Mon Portefeuille) — 2026-09-08

### Contexte

Suite à la vérification de la section 234/235 (rachat d'actions, stratégies d'options), l'utilisateur a
soulevé une question de calibrage sur l'affichage des stratégies d'options, verbatim :

> « mettons ton bull spread tu as mis le coût en vert ca porte pas a confusion un peu une prime a payé au
> net en vert? »

### Vérification préalable contre le code

Confirmé un vrai défaut de cohérence, PAS une divergence par rapport à une demande explicite antérieure —
un oubli lors de l'implémentation de la section 235. Dans `renderPortefeuilleTrading()`, la table « Mes
stratégies d'options » (colonne « Coût net à l'ouverture ») colorait `costAtOpen` avec la MÊME règle que le
P&L (`costAtOpen>=0?vert:rouge`). Mais `costAtOpen` suit une convention VALEUR (jambe longue = +valeur,
jambe courte = -valeur — même sens que `valueNow` juste à côté), PAS une convention de flux de trésorerie.
Concrètement : acheter un bull spread (payer une prime nette, cash SORTANT) donne généralement un
`costAtOpen` POSITIF (le strike bas acheté coûte plus cher que le strike haut vendu) → affiché en VERT,
alors que le joueur vient de débourser de l'argent ; vendre ce même bull spread (encaisser une prime nette,
cash ENTRANT) donne un `costAtOpen` NÉGATIF → affiché en ROUGE, alors que le joueur vient d'encaisser. Sens
inversé par rapport à l'intuition (vert = argent qui rentre, rouge = argent qui sort) et incohérent avec :
(a) le texte du modal d'ouverture (`modalOptionStrategy`, ligne ~16215) qui phrase pourtant correctement le
même montant en cash — « Crédit net reçu » / « Débit net payé » ; (b) le précédent déjà en place dans la
même page pour les options simples — la colonne « Prime à l'ouverture » (`optionsRows`) n'a AUCUNE couleur,
seul le P&L est coloré là-bas.

### Design retenu

`costAtOpen` reste affiché tel quel (même nombre, même convention de signe « valeur » — cohérent avec
`valueNow`/le P&L juste à côté, la relation `pnl = valueNow - costAtOpen` reste arithmétiquement valide).
Seule la COULEUR change : elle suit désormais le sens réel de l'argent à l'ouverture plutôt que le signe de
la valeur — rouge si `costAtOpen>0` (débit net payé, cash sorti), vert sinon (`costAtOpen<=0` : crédit net
reçu ou strictement nul) — soit l'inverse exact du mapping précédent. La colonne P&L n'est pas touchée :
elle reste en logique gain/perte (vert = valeur actuelle > coût, rouge = valeur actuelle < coût), ce qui est
la bonne sémantique pour un P&L latent.

### Code (`script_extracted.js`)

```js
// AVANT (section 235) :
<td class="money" style="color:${costAtOpen>=0?'#047857':'var(--brick)'};">...

// APRÈS (section 236) :
const costAtOpenColor = costAtOpen>0 ? 'var(--brick)' : '#047857';
<td class="money" style="color:${costAtOpenColor};">...
```

### Tests

Aucun test existant ne vérifiait la couleur de cette cellule (`smoke_test_step235_option_strategies.js`
testait les montants, pas le style CSS) — pas de mise à jour de test nécessaire. Suite complète relancée
après le correctif : **164 scripts, 0 échec**. `node -c script_extracted.js`. `python3 sync_script.py`
exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).

### Note — items laissés tels quels (mêmes échanges)

Deux points soulevés par l'utilisateur avant celui-ci ont été vérifiés et discutés, mais volontairement
**laissés tels quels** par décision explicite de l'utilisateur (« On va laisser comme ca c'est pousser pas
mal pour une partie entre amis ») :

1. Les trois textes d'interface disant que la créance garantie d'un prêt « compte en fin de partie » — en
   réalité `netWorth()`/`enforceMarginCalls()` appliquent cet effet en continu, à chaque lancer, pas
   seulement à la fin de partie (voir section 233).
2. L'asymétrie « rachat d'actions » : bonus fixe de 1-2 cubes verts immédiat (indépendant de la taille de
   `qty`, aucun plancher), contre 2-4 cubes rouges potentiels au semestre suivant via les vérifications
   valeur comptable/équité (sections 234).

Aucun changement de code sur ces deux points — notés ici pour mémoire, au cas où le calibrage deviendrait un
problème en jouant.

## 237. Parts privilégiées (troisième instrument de financement par équité, souscrit par les joueurs) — 2026-09-08

### Contexte

Demande de l'utilisateur, verbatim : « On avait pas build les actions privilégiées » — rappel du point 3 de
la section 233 (émission de parts privilégiées, décrit en détail par l'utilisateur le même jour dans le même
message que la cote de crédit et le risque réel sur les obligations), documenté en profondeur dans
`claude/DESIGN_PRIVILEGIEES_ET_NOTATION.md` (Project), Partie 2 (RÉVISÉE), avec la citation verbatim
complète de l'utilisateur :

> « J'aimerais ajouter une option pour une compagnie. L'émissions de parts privilégié :
> - L'entreprise décide combien de parts elle souhaite émettre, le prix d'une part est le prix de l'action
>   ordinaire actuellement. L'entreprise ne peut pas levé plus de 5M$ au total dans la partie cumulatif.
> - L'entreprise décide aussi le taux du dividende préférentielle qu'elle versera
> - L'entreprise décide aussi à quelle prix les parts sont "Callable" et mentionne un prix.
> - Un avertissement s'active sur l'écran des joueurs pour lors du tour suivant. Tous les joueurs ont
>   l'option d'accepter ou de refuser. Les parts disponibles seront distribuer à part égale entre tous les
>   joueurs ayant accepter.
> - Les parts évoluent avec le prix de l'action donc un gain/perte est possible. La valeur en fin de partie
>   est égale à la valeur des parts sur le marché (Le moindre entre le prix du stock market et le prix du
>   callable [...]). Donc si j'ai 10 000 parts callable à 110$ et que le prix est de 120$ ma valeur nette
>   pour ces parts serait de 1,1M$ en fin de partie.
> - Chaque fin d'année financière dans le pop-up de résumé de tour. L'entreprise à l'option de verser son
>   dividende préférentiel. Le pop-up doit avoir à côté de l'option le montant que ça représente. Si le
>   montant n'est pas verser un arrièrage se crée et des "cubes rouges" sont ajoutés au "sac". L'entreprise
>   aura aussi l'option de payer son arrièrage.
> - Les cubes rouges sont ajoutés au sac seulement lorsque le dividendes du tour n'est pas versé, des cubes
>   verts sont ajouté au sac si l'entreprise rachète les parts du marché.
> - Si un arrièrage existe l'option déclarer un dividende n'est plus possible, un message indique qu'il y a
>   un arrièrage de dividende à payer avant et donne l'option de le payer maintenant.
> - Le risque pour le joueur, ils peuvent être call par l'entreprise, les dividendes ne sont pas assuré, et
>   la valeur des parts en fin de partie est "cap" au montant du call ou du stock price, le plus petit des
>   2. Les parts privilégiées peuvent être vendues au marché au minimum du prix du stock et du call. Une
>   fois vendu les autres joueurs peuvent les achetés.
> - Le risque pour l'entreprise, un non versement du dividendes préférentiel, ajoute des cubes rouges et
>   bloque l'option de verser des dividendes ordinaires, tant qu'un arriérage existe. »

Le document de conception listait 5 « Décisions à trancher AVANT l'implémentation », non résolues par ce
message. Résolues cette session par `AskUserQuestion` (les 4 premières — la 5e, le séquençage vs. la cote de
crédit, était déjà tranchée : la cote seule d'abord, livrée à la section 233) :

1. **Base du dividende dû** : « Taux × montant levé à l'émission (recommandé) » — retenu.
2. **Crédit d'équité partiel** (idée de l'ancienne Partie 2, jamais mentionnée dans la description du 8
   septembre) : « Non, ignorer complètement (recommandé) » — retenu. Le capital levé par cet instrument
   n'apparaît donc NULLE PART comme un passif (`companyLiabilitiesForStatements`, `companyDebt`,
   `companyDebtRatio` tous laissés intacts) — lu au sens large, pas seulement pour la cote de crédit.
3. **Restriction de la cote de crédit sur les nouvelles émissions** (idée de l'ancienne Partie 2 originale,
   non reprise dans la version confirmée) : « Non, aucune restriction pour l'instant (recommandé) » —
   retenu.
4. **CEO souscrivant à sa propre offre** : « Non (recommandé) » — retenu, même principe que le marché de
   prêts/les positions à découvert (délit d'initié intégré au jeu).

Une 5e question de confirmation (formulée comme une simple validation à une seule option, « Oui, vas-y »)
a été rejetée par l'outil `AskUserQuestion` lui-même (« fewer than 2 options ») — conformément à
l'instruction reçue en retour, la compréhension a été affirmée en une ligne puis l'implémentation a
directement suivi, sans reformuler la question. Deux jugements d'implémentation en ont découlé, **jamais
explicitement confirmés en mots par l'utilisateur**, documentés ici et dans le code pour que l'utilisateur
puisse les corriger s'ils ne correspondent pas à son intention :

- **Fenêtre de résolution d'une offre** = « jusqu'au prochain lancer de dés » (lecture littérale du « pour
  lors du tour suivant » de la citation) — `resolveAtRoll = createdAtRoll + 1`, résolue automatiquement au
  lancer suivant (jamais un choix manuel du CEO).
- **Cadence du dividende préférentiel** = ANNUELLE (« Chaque fin d'année financière », lu littéralement),
  DISTINCTE du dividende ordinaire qui reste SEMESTRIEL — deux horloges séparées. Un dû impayé bénéficie
  d'une pleine année financière de grâce avant de basculer en arriérage permanent (plutôt que de forcer une
  décision instantanée dans le pop-up éphémère de résumé de tour) — voir « Design retenu » ci-dessous.

### Design retenu

**Un TROISIÈME instrument de financement par équité**, à côté de l'émission/rachat d'actions ORDINAIRES
(section 234) : contrairement à celles-ci, les parts privilégiées sont **souscrites par les joueurs**,
jamais par la trésorerie de l'entreprise elle-même.

- **Modèle de données** : `company.preferredIssuances` (lazy `||[]`, jamais migrée explicitement, même
  convention que `optionPositions`) — un objet par tranche : `{id, companyId, qty, issuePrice (cours
  ORDINAIRE au moment de l'émission, FIGÉ), dividendRate (taux ANNUEL choisi par le CEO), callPrice (prix de
  rachat FIGÉ, choisi par le CEO), createdAtRoll, resolveAtRoll, status:'pending'|'resolved', responses,
  holders:[{playerId,qty}], qtyOutstanding, raisedAmount}`. Marché secondaire global : `state.
  preferredMarketListings`.
- **Émission** (`issuePreferredShares`) : le CEO choisit librement qty/taux/prix de rachat — aucun calcul
  automatique. Gardes : IPO terminée, fenêtre de trading (semestres, même contrainte qu'`issueNewShares`/
  `buybackShares`/le trading joueurs — contrairement au marché de prêts qui n'y est PAS soumis), partie non
  terminée, paramètres valides, plafond cumulatif de 5 M$ **par entreprise** (`settings.
  preferredMaxPrincipal`, mirroir de `loanMaxPrincipal`) **jamais libéré par un rachat** (contrairement au
  plafond d'émission d'actions ordinaires — rien dans la demande de l'utilisateur n'indique le contraire
  ici).
- **Correctif auto-détecté avant tout test utilisateur** : `preferredCapRemaining` doit réserver la marge
  des offres encore **pendantes** (`qty×issuePrice`), pas seulement le `raisedAmount` des offres déjà
  résolues (qui vaut 0 tant qu'une offre est pendante) — sinon un CEO pourrait créer plusieurs offres
  pendantes dans la même fenêtre qui, prises séparément, passent chacune la garde du plafond, puis se
  résolvent ensemble et le dépassent collectivement. Testé explicitement (voir Tests).
- **Résolution** (`resolvePendingPreferredIssuances`, appelée à chaque lancer de dés depuis
  `advanceGameClock`, même emplacement que `settleExpiredOptions`/les annonces CEO) : distribution à **part
  égale** entre tous les accepteurs (jamais premier arrivé premier servi, jamais proportionnel) ; **aucun
  preneur** → annulation silencieuse, aucun cash, aucune part, **aucun cube** (contrairement à l'ancienne
  Partie 2 obsolète qui pénalisait un échec d'émission — non repris, la version confirmée du 8 septembre ne
  le mentionne pas). Un CEO ne peut jamais répondre à sa propre offre (`respondToPreferredIssuance`) ; la
  réponse est un **upsert** — un joueur peut changer d'avis tant que la fenêtre n'est pas résolue.
- **Valeur du détenteur, EN CONTINU** (`netWorth(player)`) : `qty × min(cours ordinaire courant, prix de
  rachat)` pour chaque tranche résolue détenue — appliquée à chaque calcul de `netWorth`, pas seulement en
  fin de partie (même précédent que `securedLoanGuaranteeInfo`, section 233).
- **Rachat (call) par l'entreprise** (`callPreferredShares`) : au prix de rachat FIGÉ à l'émission (jamais
  le cours courant), réduction **pro rata** de CHAQUE détenteur actuel (le CEO ne choisit pas qui est
  rappelé, seulement combien au total — aucune règle de priorité demandée), cubes VERTS (niveau standard
  `STOCK_TRIGGER_LEVEL_MIN/MAX`, réutilisé, aucune nouvelle constante).
- **Dividende préférentiel annuel** (`resolvePreferredDividendsYearEnd`, appelée depuis `processYearEnd`) :
  à chaque fin d'année financière, calcule le dû (`taux × prix d'émission × parts ENCORE en circulation` —
  un rachat réduit donc le dû futur) pour l'année qui vient de se terminer ; si un dû de l'année PRÉCÉDENTE
  est encore impayé au moment où celui-ci se calcule, il bascule en arriérage PERMANENT + cubes rouges
  (niveau standard). Paiement du dû (`payPreferredDividendDue`) ou de l'arriérage
  (`payPreferredDividendArrears`, toujours en un seul versement, ne retire jamais les cubes déjà injectés)
  **sans garde d'encaisse suffisante** (encaisse négative explicitement permise partout dans le jeu, même
  philosophie que la section 233 point 4).
- **Blocage du dividende ordinaire** (`modalAnnounceDividend`) : refuse et alerte si un arriérage RÉEL
  existe (`co.preferredDividendArrears>0`, pas un dû de l'année en cours pas encore lapsé) — **AUCUN
  `confirm()`** (la section 167 a déjà établi que `confirm()` renvoie silencieusement `false` dans
  l'environnement réel de l'utilisateur) ; le bouton dédié « Payer l'arriérage » (Mon Entreprise / pop-up de
  tour) est le seul chemin pour régler l'arriérage.
- **Marché secondaire entre joueurs** (`listPreferredSharesForSale`/`buyPreferredSharesFromListing`/
  `cancelPreferredListing`) : système d'annonces, prix TOUJOURS recalculé **à l'achat** —
  `min(cours,rachat)`, jamais figé à l'annonce — le vendeur ne peut pas acheter sa propre annonce, aucun
  mouvement de `company.cash` (transaction ENTRE joueurs, comme le trading d'actions ordinaires secondaire),
  aucun cube.
- **UI** : Mon Entreprise — bouton « 🎫 Émettre des parts privilégiées » (menu ☰ Actions, groupe Finance),
  accordéon dédié (émissions en cours avec bouton « Racheter (call) », marge cumulative utilisée/restante,
  panneau dû/arriérage avec boutons de paiement). Mon Portefeuille — accordéon « Parts privilégiées »
  (offres en attente à accepter/refuser, parts détenues avec bouton Vendre, marché secondaire — annonces des
  autres/mes propres annonces), masqué si rien à afficher. Pop-up de résumé de tour — section dédiée si un
  dû ou un arriérage existe, avec boutons de paiement directs. Entrée Lexique dédiée.

### Code (`script_extracted.js`)

```js
function preferredCapRemaining(companyId){
  const co = companyById(companyId);
  if(!co) return 0;
  const cap = state.settings.preferredMaxPrincipal||0;
  // Réserve la marge des offres ENCORE PENDANTES (qty*issuePrice), pas seulement raisedAmount (0 tant que
  // pendante) — sinon plusieurs offres pendantes simultanées pourraient collectivement dépasser le plafond.
  const used = (co.preferredIssuances||[]).reduce((s,i)=>s+(i.status==='resolved' ? (i.raisedAmount||0) : i.qty*i.issuePrice), 0);
  return Math.max(0, cap-used);
}

function resolvePendingPreferredIssuances(){
  state.companies.forEach(co=>{
    (co.preferredIssuances||[]).forEach(issuance=>{
      if(issuance.status!=='pending' || state.gameClock.rollCount<issuance.resolveAtRoll) return;
      const accepters = Object.keys(issuance.responses).filter(pid=>issuance.responses[pid]===true);
      issuance.status = 'resolved';
      if(accepters.length===0){ issuance.raisedAmount = 0; issuance.qtyOutstanding = 0; issuance.holders = []; return; }
      const perPlayer = issuance.qty/accepters.length;
      issuance.holders = accepters.map(pid=>({playerId:pid, qty:perPlayer}));
      issuance.qtyOutstanding = issuance.qty;
      issuance.raisedAmount = issuance.qty*issuance.issuePrice;
      co.cash += issuance.raisedAmount;
    });
  });
}

// netWorth(player) — valeur CONTINUE, pas seulement en fin de partie :
state.companies.forEach(co=>{
  (co.preferredIssuances||[]).forEach(issuance=>{
    if(issuance.status!=='resolved') return;
    const h = issuance.holders.find(x=>x.playerId===player.id);
    if(h && h.qty>1e-9) total += h.qty * Math.min(co.stockPrice||0, issuance.callPrice);
  });
});

// modalAnnounceDividend() — AUCUN confirm() (section 167) :
if(myCo.preferredDividendArrears>0){
  alert(`${myCo.name} a un arriérage de dividende préférentiel de ${fmt(myCo.preferredDividendArrears)} à régler avant de pouvoir annoncer un dividende ordinaire — utilisez le bouton « Payer l'arriérage » dans Mon Entreprise.`);
  return;
}
```

### Tests

Nouveau fichier dédié `smoke_test_step237_preferred_shares.js` (84 assertions), avec un seul `createGame()`
et une compagnie/CEO dédiée par scénario (jamais réutilisée entre scénarios, sauf réutilisation volontaire
explicitement documentée) : (A) émission de base — refus du CEO à sa propre offre, split à part égale entre
accepteurs, grand livre, `netWorth()` incluant `min(cours,rachat)×qty` en continu (avant ET après un
mouvement de cours) ; (B) aucun accepteur → annulation silencieuse (aucun cash/cube) ; (D) plafond cumulatif
de 5 M$ — réservation des offres PENDANTES (le correctif ci-dessus, testé en isolant un scénario où une 2e
offre est refusée uniquement grâce à la réservation de la 1re encore pendante), upsert de réponse (accepte/
refuse/accepte), libération de marge quand une offre pendante s'annule faute d'accepteur, résolution
retardée d'un lancer (« jusqu'au prochain lancer » vérifié explicitement : encore pendante au même lancer
que la création, résolue seulement au lancer suivant) ; (E) rachat (call) — réduction pro rata entre
détenteurs, prix de rachat FIGÉ (testé avec un cours très différent au moment du call pour prouver qu'il est
ignoré), cubes verts, réduction de la base du dividende futur ; (F) dividende annuel — calcul du dû, bascule
en arriérage permanent + cubes rouges si impayé à la fin de l'année suivante, blocage du dividende ordinaire
(`modalAnnounceDividend`, message vérifié pour l'absence de toute référence à `confirm`), paiement du dû/de
l'arriérage sans garde d'encaisse suffisante (encaisse forcée négative, paiement accepté quand même) ; (G)
restrictions communes — IPO non terminée, fenêtre de trading fermée, partie terminée, paramètres invalides
(qty/taux/prix de rachat) ; (H) marché secondaire — annonce, achat partiel, prix recalculé à l'achat (cours
changé depuis l'annonce), vendeur ne pouvant pas acheter sa propre annonce, retrait d'annonce, aucun
mouvement de `company.cash` ; (K) UI — Mon Entreprise (bouton d'émission actif/désactivé selon la fenêtre,
panneau dû/arriérage avec bouton de paiement) et Mon Portefeuille (accordéon présent avec offre en attente
pour un non-CEO, absent pour le CEO émetteur lui-même, présent avec bouton Vendre pour un détenteur, absent
pour un joueur totalement extérieur — distingué du libellé « Parts privilégiées » qui peut légitimement
apparaître ailleurs, ex. dans les états financiers de sa PROPRE entreprise émettrice).

Toutes les injections de cubes dépendantes de `Math.random()` sont testées avec `Math.random` neutralisé à
0 (même convention que la section 234) pour un résultat exactement déterministe — un oubli initial
(cube rouge du bascule en arriérage testé SANS neutraliser `Math.random`) a été détecté par un échec
intermittent du test lui-même et corrigé avant livraison.

Suite complète relancée après ajout : **165 scripts, 0 échec**. `node -c script_extracted.js`.
`python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).

## 238. Correctif de conservation de l'argent — parts privilégiées (émission, rachat, dividende) — 2026-09-08

### Contexte

Signalement de l'utilisateur, verbatim, juste après la livraison de la section 237 :

> « L'invariant de conservation de l'argent est cassé
> J'ai fait émettre 20 000 parts privilégiées à 100 $ par Dupéré Industries, Marc a accepté, puis j'ai fait
> terminer le tour aux quatre CEO pour résoudre l'offre.
>
> Banque / Joueurs / Entreprises / Total
> Avant : 500 / 56 / 80 / 636 M$
> Après l'offre : 500 / 56 / 80 / 636 M$
> Après l'acceptation de Marc : 500 / 56 / 80 / 636 M$
> Après résolution : 500 / 56 / 82 / 638 M$
>
> +2 M$ créés de rien. L'encaisse de Marc n'a pas bougé d'un cent, et il détient maintenant 20 000 parts qui
> valent 2 M$ de plus dans sa valeur nette. L'émission a donc créé 2 M$ de trésorerie et 2 M$ de patrimoine.
> La cause est nette : dans tout le bloc des privilégiées (lignes 9269-9545), les seules mutations
> d'encaisse d'un joueur sont buyer.cash et seller.cash sur le marché secondaire. À la résolution, il n'y a
> que co.cash += issuance.raisedAmount. Aucun souscripteur n'est jamais débité, et
> respondToPreferredIssuance ne vérifie aucune solvabilité.
>
> Le dividende préférentiel ne paie personne
>
> le prix du call doit être supérieur au prix actuel »

Les trois affirmations ont été vérifiées directement dans le code avant toute correction (le
raisonnement de l'utilisateur — plages de lignes du bloc des privilégiées incluses — était exact et
directement actionnable) :

1. **Émission/résolution** (`resolvePendingPreferredIssuances`) : `co.cash += issuance.raisedAmount` sans
   AUCUNE contrepartie sur `player.cash` — confirmé, argent créé de rien à chaque résolution avec au moins
   un accepteur.
2. **Dividende préférentiel** (`payPreferredDividendDue`/`payPreferredDividendArrears`) : les deux
   fonctions débitaient `co.cash` mais ne créditaient JAMAIS aucun joueur — confirmé, l'argent débité
   disparaissait purement et simplement.
3. **Validation du prix de rachat** (`issuePreferredShares`) : aucune garde n'existait pour empêcher un
   prix de rachat (callable) inférieur ou égal au cours actuel — confirmé, absent de la section 237.

**4e bogue, de la même famille, détecté par relecture — jamais signalé explicitement par l'utilisateur** :
`callPreferredShares` (le rachat) souffrait du bogue symétrique au point 1 — l'entreprise était débitée du
montant du rachat mais aucun détenteur rappelé n'était jamais crédité, détruisant l'argent au lieu de le
créer. Corrigé proactivement dans le même lot, signalé ici pour que l'utilisateur puisse le vérifier
explicitement (il ne faisait pas partie des 3 points cités).

### Design retenu

- **Émission/résolution** (`resolvePendingPreferredIssuances`) : chaque accepteur est maintenant débité de
  `perPlayerCost = ses parts (part égale) × issuePrice`, en plus du crédit déjà existant sur `co.cash`
  (inchangé). **Aucune garde de solvabilité à l'acceptation** (`respondToPreferredIssuance`) : le coût
  final par accepteur dépend du nombre total d'accepteurs, connu seulement à la résolution — une vérification
  à l'acceptation est donc impossible en principe. C'est un jugement d'implémentation (non demandé
  explicitement), cohérent avec la philosophie « encaisse négative permise partout dans le jeu » déjà
  établie à la section 233 point 4 et réutilisée telle quelle pour le dividende et le rachat (voir
  ci-dessous) — si l'utilisateur préfère exclure ou plafonner les accepteurs insolvables, c'est un
  changement à trancher séparément.
- **Rachat (call)** (`callPreferredShares`, 4e bogue auto-détecté) : chaque détenteur touche maintenant
  `sa réduction de parts (pro rata) × callPrice`, calculée AVANT que sa quantité ne soit réduite (l'ordre
  compte : le montant dû dépend de la quantité D'AVANT la réduction, pas d'après).
- **Dividende préférentiel** (`payPreferredDividendDue`/`payPreferredDividendArrears`) : restructuration
  nécessaire, pas un simple ajout d'une ligne — `co.preferredDividendDueThisYear` et
  `co.preferredDividendArrears` ne portaient qu'un montant AGRÉGÉ, insuffisant pour savoir QUI payer quand
  plusieurs tranches (`preferredIssuances`) coexistent avec des `dividendRate`/`issuePrice`/`holders`
  différents. Ajout d'une ventilation **par tranche** (`items:[{issuanceId, amount}]`), calculée dans
  `resolvePreferredDividendsYearEnd` (aussi bien pour le nouveau dû que pour ce qui bascule en arriérage —
  un arriérage peut ainsi accumuler des `items` de plusieurs années/tranches différentes au fil du temps,
  jamais fusionnés) et consommée par un nouvel helper partagé `distributePreferredAmountToHolders`, qui
  distribue chaque `item.amount` aux détenteurs ACTUELS de la tranche concernée, au prorata de leurs parts
  COURANTES (jamais un instantané figé à la date du dû — cohérent avec `netWorth()`/le marché secondaire,
  qui suivent déjà toujours l'actionnariat courant). Une portion d'un rachat (call) PARTIEL entre-temps ne
  change PAS les proportions relatives entre détenteurs (`callPreferredShares` réduit chacun du même
  ratio) — la distribution reste donc mathématiquement exacte même après un call partiel. Seul un rachat
  TOTAL d'une tranche (plus aucun détenteur) rend sa portion non distribuable : elle retourne à la
  trésorerie de l'entreprise via une nouvelle catégorie de grand livre
  `preferred_dividend_unclaimed_return`, même principe que `dividend_forfeited_return` pour le dividende
  ordinaire (jamais perdue, jamais dupliquée). Les champs `.amount`/`.year` de
  `preferredDividendDueThisYear` restent inchangés (aucun impact sur le code d'AFFICHAGE existant —
  `renderEntreprise`/pop-up de tour) ; seuls `payPreferredDividendDue`/`payPreferredDividendArrears`
  avaient besoin de la nouvelle ventilation `.items`.
- **Validation du prix de rachat** (`issuePreferredShares`) : nouvelle garde — le prix de rachat doit être
  STRICTEMENT supérieur au cours ordinaire actuel au moment de l'émission (`callPrice>price`), sinon
  l'entreprise pourrait émettre puis rappeler immédiatement à perte pour le détenteur, sans aucune prime de
  rappel. Vérifié rétroactivement : aucune valeur `callPrice`/`issuePrice` déjà utilisée dans le test de la
  section 237 ne violait cette règle — aucune régression.

### Code (`script_extracted.js`)

```js
// resolvePendingPreferredIssuances() — chaque accepteur débité de sa part du montant levé :
const perPlayer = issuance.qty/accepters.length;
const perPlayerCost = perPlayer*issuance.issuePrice;
issuance.holders = accepters.map(pid=>({playerId:pid, qty:perPlayer}));
accepters.forEach(pid=>{
  const pl = state.players.find(p=>p.id===pid);
  if(pl){ pl.cash -= perPlayerCost; entries.push({label:`${pl.name} (souscription de parts privilégiées — ${co.name})`, amount:-perPlayerCost}); }
});
co.cash += issuance.raisedAmount;

// callPreferredShares() — chaque détenteur rappelé crédité AVANT réduction de sa quantité :
issuance.holders.forEach(h=>{
  const reduced = h.qty*ratio;
  const owed = reduced*issuance.callPrice;
  const pl = state.players.find(p=>p.id===h.playerId);
  if(pl){ pl.cash += owed; entries.push({label:`${pl.name} (parts privilégiées rappelées — ${co.name})`, amount:owed}); }
  h.qty -= reduced;
});

// issuePreferredShares() — nouvelle garde sur le prix de rachat :
if(!(callPrice>price)) return {ok:false, error:`Le prix de rachat doit être supérieur au cours actuel de l'action ordinaire (${fmtPrice(price)}) — sinon l'entreprise pourrait rappeler immédiatement les parts à perte pour le détenteur.`};

// distributePreferredAmountToHolders() — ventilation par tranche, prorata des détenteurs ACTUELS :
function distributePreferredAmountToHolders(co, items, entries, verbeLabel){
  let distributed = 0;
  (items||[]).forEach(item=>{
    const issuance = (co.preferredIssuances||[]).find(i=>i.id===item.issuanceId);
    const holders = issuance ? issuance.holders : [];
    const totalQty = holders.reduce((s,h)=>s+h.qty, 0);
    if(!issuance || totalQty<=1e-9) return; // tranche entièrement rachetée depuis -> non distribué
    holders.forEach(h=>{
      const cut = item.amount*(h.qty/totalQty);
      const pl = state.players.find(p=>p.id===h.playerId);
      if(pl){ pl.cash += cut; distributed += cut; entries.push({label:`${pl.name} (${verbeLabel} — ${co.name})`, amount:cut}); }
    });
  });
  return distributed;
}
```

### Tests

`smoke_test_step237_preferred_shares.js` étendu (84 → **92 assertions**) — la fonction utilitaire
`totalCashInGame()` (`somme des cash joueurs + somme des cash entreprises`, hors `state.bank`, puisqu'aucune
opération de parts privilégiées ne devrait jamais y toucher) sert d'invariant de conservation, testée à
plusieurs points de contrôle :

- **(A)** émission/résolution : Amir ET Yuki désormais débités de leur coût respectif à la résolution
  (avant le correctif, leur encaisse ne bougeait pas du tout) ; invariant global (joueurs+entreprises)
  inchangé par la résolution (avant le correctif, +4 apparaissait de nulle part).
- **(E)** rachat (call) : Gus ET Hana désormais crédités de `qty rappelée × callPrice` chacun (avant le
  correctif, leur encaisse ne bougeait pas du tout malgré la réduction de leurs parts).
- **(F)** dividende préférentiel : Jax (seul détenteur de la tranche) désormais crédité au paiement de
  l'arriérage ET au paiement du dû courant (avant le correctif, aucun des deux versements ne le créditait —
  exactement le bogue « le dividende préférentiel ne paie personne »).
- **(G)** nouvelle garde sur le prix de rachat : émission refusée si `callPrice` est égal OU inférieur au
  cours actuel de l'entreprise (2 cas testés séparément).
- **Invariant global de bout en bout** : `totalCashInGame()` capturé en tout début de script (avant toute
  opération de parts privilégiées) et en toute fin (après TOUTES les opérations des scénarios A à H,
  y compris le marché secondaire entre joueurs, déjà neutre par nature) doit être strictement identique —
  net des deux forçages DÉLIBÉRÉS de `coF.cash` à une valeur arbitraire dans le scénario (F) (artefacts du
  harnais de test servant à vérifier l'absence de garde de solvabilité au paiement, pas des mouvements du
  moteur — leur écart est capturé explicitement et réinjecté dans l'assertion pour ne pas fausser
  l'invariant).

Suite complète relancée : **165 scripts, 0 échec**. `smoke_test_step237_preferred_shares.js` relancé 5 fois
consécutives pour confirmer le déterminisme (0 échec à chaque fois — aucune dépendance résiduelle à
`Math.random()` non neutralisée). `node -c script_extracted.js`.
`python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).

## 239. Correctif d'étiquette — prix de rachat (callable) des parts privilégiées affiché en $/part, pas M$/part — 2026-09-08

### Contexte

Signalement de l'utilisateur, verbatim : « le libellé du prix de callable mentionné $M/part c'est juste
$/part ».

### Diagnostic

Dans `modalIssuePreferredShares` (la modale « Émettre des parts privilégiées »), le champ de saisie du
prix de rachat était bien géré en $ BRUTS par part de bout en bout — valeur par défaut pré-remplie via
`(myCo.stockPrice||0)*1e6` et reconvertie en unité interne (M$) via `/1e6` à la soumission, exactement la
même convention que `fmtPrice()`/`parsePrice()` déjà utilisée partout ailleurs dans l'app pour un prix PAR
PART (cours de l'action, strikes/primes d'options — voir le commentaire déjà présent au-dessus de la
fonction, section 237). Seule l'ÉTIQUETTE du champ ne suivait pas cette convention : elle interpolait
`${state.unit}` (= `'M$'`, l'unité utilisée PARTOUT ailleurs dans l'app pour un MONTANT GLOBAL comme
l'encaisse ou un montant de prêt) au lieu d'écrire littéralement « $/part », comme le fait chaque autre
site du code qui affiche un prix par part (`${fmtPrice(...)}/part}`, jamais `${state.unit}/part`) —
confirmé par une recherche exhaustive de toutes les occurrences de `/part` dans le fichier : c'était la
seule qui utilisait `state.unit`. Un pur défaut d'affichage : la valeur saisie/utilisée n'a jamais été
fausse (aucun calcul touché), seul le texte du libellé annonçait la mauvaise échelle.

### Correctif

```js
// AVANT :  <label>Prix de rachat (callable, en ${esc(state.unit)}/part)</label>   // affichait "M$/part"
// APRÈS :
<label>Prix de rachat (callable, en $/part)</label>
```

### Tests

Aucun test existant ne référence le texte de ce libellé (vérifié par recherche dans
`smoke_test_step237_preferred_shares.js`) — aucune mise à jour de test nécessaire. Suite complète
relancée après le correctif : **165 scripts, 0 échec**. `node -c script_extracted.js`.
`python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).

## 240. Moteur boursier — séparation trading/fondamental, exemption « mise de départ forcée » de l'IPO, plafond de 15% à la pige — 2026-09-09

### Contexte — signalement initial de l'utilisateur (verbatim intégral)

> Voici une suggestion d'une analyse avec de FAIRE QUOI QUE CE SOIT dit moi ce que tu en penses
>
> Je veux corriger un défaut du moteur boursier : **une entreprise mal gérée gagne de l'argent sur une
> partie complète, alors qu'elle devrait se transiger à une fraction de son prix de départ.**
>
> Définition de « mal gérée » pour ce qui suit : trois semestres sur quatre avec des dépenses supérieures
> aux revenus, une équité qui recule, un bénéfice net qui rate significativement l'attente des analystes,
> aucun dividende, et un recours régulier à l'hypothèque ou à la subvention d'avance pour financer les
> trous.
>
> Simulation du moteur sur **9 années financières** (54 lancers), 8 joueurs, avec un flux de trading
> directionnel — on achète les bonnes entreprises, on vend les mauvaises :
>
> | Part du flottant réellement placée à l'IPO | Bien gérée | Mal gérée |
> |---|---|---|
> | 25 % | 428 $ | 45 $ |
> | 50 % | 620 $ | 107 $ |
> | 100 % | 761 $ | 141 $ |
> | **IPO exemptée de cubes** | **235 $** | **18 $** |
>
> **La cause est unique : le placement du flottant à l'IPO.** Il injecte 84 à 168 cubes verts dans un sac
> qui en contient 28, et il faut 83 lancers — plus long que la partie — pour les résorber. Ces cubes
> portent l'entreprise jusqu'à la fin, quoi qu'elle fasse ensuite. À 141 $ après neuf années d'échecs,
> l'IPO a payé pour ses erreurs. Et même si le flottant ne se place qu'à moitié — ce qui est réaliste,
> puisque l'encaisse des joueurs se partage entre actions, obligations, options, prêts, privilégiées et
> marge — la mal gérée finit encore au-dessus de son prix de départ.
>
> **Le changement, dans `executeShareTrade()` :** si `companyPendingIpoShares(company) > 0`, un achat pris
> sur la portion encore portée par la banque **n'injecte aucun cube** — ne pas appeler `tradeCubeRange()`.
> Dès le flottant entièrement placé, l'impact normal reprend, inchangé.
>
> La justification de conception : souscrire à une IPO n'est pas une opinion sur l'entreprise, c'est le
> marché qui se forme. Ça ne doit pas être un signal haussier. Acheter et vendre doivent continuer à créer
> des pressions haussières et baissières — je veux garder ça — mais ce sont les fondamentaux qui doivent
> piloter la valeur, et aujourd'hui l'IPO les écrase.
>
> **Résultat attendu :** la bien gérée double sur neuf ans (235 $), la mal gérée tombe à 18 $. C'est le
> comportement recherché.
>
> **Deuxième point, moins urgent, à traiter séparément si tu veux :** `STOCK_TRADE_IMPACT_MAX_UNITS = 12`
> plafonne **chaque appel** plutôt que le cumul. Conséquence, un ordre fractionné produit jusqu'à **140
> unités d'impact là où le même ordre passé d'un coup en produit 12** — ça récompense exactement le
> mauvais comportement, et l'impact grandit avec le nombre de joueurs. Le correctif serait un budget
> d'impact **partagé entre le vert et le rouge, par entreprise, remis à zéro à chaque transition de
> semestre** (même crochet que `snapshotBalanceSheets` dans `advanceGameClock`), calibré autour de 4
> unités. Ce n'est pas le correctif principal — vu que l'encaisse des joueurs est rare et dispersée, le
> trading ordinaire ne déplace de toute façon pas grand-chose — c'est une assurance contre un joueur qui
> découperait ses ordres exprès.
>
> Ces chiffres viennent d'un modèle du moteur, pas du moteur lui-même : les ordres de grandeur sont
> fiables, pas les décimales. Une fois l'exemption implémentée, je veux une partie test instrumentée sur
> une durée complète, à 4 et à 8 joueurs, avec le décompte réel des cubes **fondamentaux contre cubes de
> trading** — c'est ce ratio qui dira si les fondamentaux dominent pour de bon.

### Diagnostic — le correctif proposé ciblait du code mort

Vérification faite AVANT toute implémentation (méthodologie de ce fichier) : le garde-fou proposé par
l'utilisateur — bloquer l'injection de cubes dans `executeShareTrade()` quand
`companyPendingIpoShares(company)>0` — ne peut en réalité **jamais se déclencher**. `executeShareTrade()`
refuse déjà intégralement de s'exécuter tant que l'IPO n'est pas terminée (`if(companyPendingIpoShares
(company)>0) return {ok:false, error:...}`, tout en haut de la fonction, avant tout calcul de cube) —
aucun achat n'atteint jamais la logique d'injection de cubes tant que `companyPendingIpoShares(company)>0`
est vrai. Et `applyCompanyIpoFunding()` (l'événement qui finance réellement le flottant à l'IPO) ne touche
lui-même à aucun cube non plus. Le garde proposé serait donc un no-op pur.

Le vrai mécanisme, confirmé en lisant le code : une fois l'IPO financée, l'inventaire massif que la
banque vient d'accumuler (70% du flottant par défaut à `companyCeoStartPct=0.30`) devient **indiscernable**
d'un inventaire banque ordinaire de marché secondaire — un joueur qui achète immédiatement après le
financement de l'IPO pioche dans EXACTEMENT le même compte (`shareholders` avec `playerId:'BANK'`) qu'un
joueur qui rachète des parts revendues par un autre joueur des semaines plus tard. Le diagnostic de
l'utilisateur (« le placement du flottant à l'IPO inonde le sac ») était donc juste dans son intuition,
mais mal localisé dans le code — le vrai point d'intervention n'est pas une garde sur
`companyPendingIpoShares`, c'est un marqueur qui distingue « part jamais possédée par un vrai actionnaire »
de « part réellement revendue sur le marché secondaire », décrémenté au fil des achats.

Sur le deuxième point (fragmentation de `STOCK_TRADE_IMPACT_MAX_UNITS`) : la direction du raisonnement de
l'utilisateur est correcte — un ordre agrégé suffisamment gros, fragmenté en plusieurs appels dont chacun
reste sous le plafond de 12 unités, peut injecter davantage de cubes au total qu'un seul appel plafonné. Le
multiplicateur exact « 140 vs 12 » n'a pas pu être vérifié indépendamment dans le code (dépend d'hypothèses
d'échelle qui ne sont pas dans le moteur lui-même, probablement issues du modèle séparé de l'utilisateur) —
mais le principe est confirmé.

### Itérations de conception (avant toute implémentation)

Suite au diagnostic ci-dessus, plusieurs échanges ont progressivement précisé et durci la spécification —
citations verbatim, dans l'ordre :

> En bout de ligne je veux un petit impact avec le trading pas un immense.

> Dans le scénario actuelle shorter une mauvaise entreprise est perdant

> Et pas d'impact vraiment au départ c'est pas juste

> En bout de ligne j'aimerais que le trading reflecte 10-15% des mouvements du stock. et j'aimerais que ça
> prenne en compte le sentiment des joueurs, une fois la partie lancée. Les joueurs sont un peu obligé
> d'acheter en début de partie ça devrait pas être bullish d'être obligé. Après il faut que ça garde un
> impact (Après mise de début) entre 10-15% de la variation. Propose moi tes idées

À ce stade, deux pistes ont été proposées (dans l'ordre) puis abandonnées avant tout code :

1. **Gouverneur de flux** (proposition initiale) : ratio cumulatif historique trading/fondamental, avec un
   frein progressif à l'approche de 10-15%. Abandonnée — trop indirecte, difficile à faire correspondre à
   un vrai plafond DUR par tirage.
2. **Silos** : deux sous-plafonds fixes séparés (7,5%/7,5%) appliqués À L'INJECTION contre le même
   dénominateur (le sac total), démontré mathématiquement pour ne jamais dépasser 15% combiné — mais
   nécessitait une logique de calcul de « place restante » à CHAQUE site d'injection.

> 2 choses : Est-ce que commencer avec plus que 20M par joueur aiderait à dépasser le Float? Mettons 25M
> donc 6M vont pour CEO donc il reste 19M en trading pour 14M en float.
>
> Deuxièment est-ce que ta proposition est que les cubes du trading soit tagué "Trading" pour toujours
> garder un impact de 15% du sac. et que la vente et l'achat de part affecterait le ratio rouge et vert
> dans ce 15% là?

> Oui c'est beaucoup mieux. Bon pour les émissions et rachat c'est du fondamentale, rien à voir avec le
> trading ou le float.
>
> J'ai juste peur que beaucoup de buy & Hold n'empêche le flottant d'être atteint...

Ce dernier point a fait corriger la conception AVANT tout code : une exemption gardée uniquement sur
`originalFloatRemaining>0` laisserait un flottant jamais épuisé (buy & hold prolongé) exempter une
entreprise de tout cube de trading pour littéralement toute la partie — corrigé en ajoutant un délai de
formation borné dans le temps, alternative à l'épuisement (voir plus bas). Proposé d'abord à 1 semestre (3
lancers), l'utilisateur a tranché pour le double :

> J'adore, mais je dirais 1 an, soit 2 périodes complète de trading. Aussi pour le sac de 15% que va tu
> faire avec les cubes quand il provienne tu trading est-ce que tu remet automatiquement et tu tiens juste
> un % (Thug of war) ou autres

> Ok mettons exemple il y a 100 cubes totaux, 85 fondamentaux, 12 verts trading, 3 rouges trading.
>
> Une action vente ajoute par exemple sorti de ma tête 3 rouges il se passe quoi

> Oui ça me dérange car j'ai l'impression que ça va diluer les ventes. (Cubes rouges trading). Je suis en
> train de penser peut-être à une idée de silos au sein du trading 15% je ne sais pas

Cette objection (« diluer les ventes ») a fait abandonner tout schéma où le sac trading serait plafonné À
L'INJECTION avec un split fixe (ex.: 50/50 vert/rouge) — un tel split écraserait un déséquilibre RÉEL du
sentiment des joueurs (ex.: une vague de ventes) en le noyant dans la moitié « verte » déjà pleine. C'est
l'utilisateur lui-même qui a proposé la solution finale, la plus simple et celle qui règle exactement ce
problème :

> Sinon je sais pas si c'est plus facile à coder. Mais 2 sac un sac trading et un sac fondamenteux. Donc le
> sac trading tu ajoutes les cubes sans limite dedans, le sac fondamenteux aussi. Quand vient le temps de
> piger tu regarde combien tu as de fondamentaux exemple 85. (85/(1-0,15))*15% = 15 ça te donne le nombre
> de cubes à pigé du sac trading et à insérer dans le sac fondamentaux pour cette pige. Tu remet après les
> cubes trading dans leur sac trading. Je pense que ça revient au même que toi le plus simple pour toi
> c'est quoi?

Confirmation finale, avec la dernière précision (aucun cube blanc dans le sac trading) :

> C'est parfait pour moi! Je confirme AUCUN cubes blancs dans le sac trading. Après que tu aies terminé
> j'ai un autre enjeu.
>
> J'ai l'impression que les investisseurs des stock dividende sont avantagés. Ont a calculé pour que
> l'action suivent le cours des autres. MAIS on a pas pensé que les actionnaires recevait des dividendes
> constant qui augmente leur rentabilité et qui peut être réinvestit ailleurs

Le deuxième enjeu (avantage structurel des actions dividende, dû à la composition des dividendes constants)
est explicitement **DIFFÉRÉ** — hors scope de cette section, à traiter séparément une fois celle-ci livrée.

### Design retenu

**1) Exemption « mise de départ forcée » (`company.originalFloatRemaining` / `company.ipoFundedAtRoll`).**
À `applyCompanyIpoFunding()`, le flottant financé par la banque (`remaining`) est capturé dans
`company.originalFloatRemaining` (en PARTS), avec un horodatage `company.ipoFundedAtRoll =
state.gameClock.rollCount`. Dans `executeShareTrade()`, branche `'buy'` seulement (une vente n'est jamais
exemptée — elle revient toujours à un vrai actionnaire qui se départit de parts déjà possédées) : la
portion de l'achat qui pioche encore dans ce flottant, tant qu'on reste dans la fenêtre
(`IPO_FLOAT_EXEMPTION_WINDOW_ROLLS = 6`, soit 1 année financière), est retranchée de la quantité comptée
pour l'injection de cubes — SEULE la portion réelle au-delà (`realQty = qty-exemptQty`) déclenche
`tradeCubeRange`/`injectTradingCube`. L'exemption se termine à la PREMIÈRE des deux conditions atteintes :
flottant épuisé, OU délai écoulé (le correctif « buy & hold » décrit ci-dessus) — jamais reconstituée par
une vente.

**2) Séparation fondamental/trading — deux réserves indépendantes, jamais plafonnées à l'injection.**
`company.stockReserve` (déjà existante) reste 100% fondamentale : tous les déclencheurs Groupe A/B
(bilan, dividendes, attentes, détresse, momentum, dette, AMF, subvention d'avance, hypothèque, prêt, prêt
de dernier recours, mauvais dividende) PLUS les actions corporatives du CEO — émission/rachat d'actions
ordinaires (`issueNewShares`/`buybackShares`, confirmé fondamental par l'utilisateur : « pour les émissions
et rachat c'est du fondamentale, rien à voir avec le trading ou le float ») — continuent d'y injecter via
`injectStockCube`, EXACTEMENT comme avant. `company.tradingReserve = {green, red}` (nouveau) reçoit
désormais tout le trading joueur : achat/vente ordinaire (`executeShareTrade`, portion réelle seulement),
vente à découvert/rachat (`openShortPosition`/`closeShortPosition`), et exercice/assignation d'option
(`settleOptionExercise`) — via la nouvelle fonction `injectTradingCube`, qui mirror exactement
`injectStockCube` mais SANS aucun plancher (contrairement au fondamental, qui garde son plancher
`STOCK_TYPE_RESERVE[type]`) : « pas d'impact vraiment au départ c'est pas juste » — si personne ne trade,
le poids réel est 0, jamais forcé. `tradingReserve` accumule SANS AUCUNE limite à l'injection — tout le
plafonnage se fait au moment de la PIGE (voir 3 ci-dessous), jamais avant.

**3) Emprunt proportionnel plafonné à 15%, au moment de la pige (`drawStockCubes`, réécrite en entier).**
À chaque événement de tirage (une fois par compagnie active, par lancer de dés), avant la boucle de tirage :
`fundamentalTotal = stockReserve.green+red` (F), et `toBorrow = min(round(F × 0,15/0,85),
tradingReserve.green+red disponible)` — c'est EXACTEMENT la formule proposée par l'utilisateur
(`(F/(1-0,15))×15%`, algébriquement identique à `F×0,15/0,85`). L'emprunt est ensuite réparti au PRORATA de
la composition verte/rouge ACTUELLE du sac trading (jamais un split fixe 50/50 — c'est précisément ce qui
règle le problème de dilution soulevé par l'utilisateur : un déséquilibre réel du sentiment se reflète
pleinement dans la portion empruntée, sans jamais être noyé par la couleur opposée). Les cubes empruntés
mais NON tirés à la fin de l'événement retournent intacts dans `company.tradingReserve` (aucune remise
explicite requise — ils n'en sont jamais sortis) ; seule la portion RÉELLEMENT tirée est retranchée
définitivement. `TRADING_SLICE_MAX_PCT = 0,15` — jamais un minimum garanti, toujours un maximum. Aucun cube
blanc n'entre jamais dans ce calcul (confirmé : « AUCUN cubes blancs dans le sac trading »).

**4) Deux accumulateurs de fragmentation séparés (`tradeCubeRange`, 4e paramètre `accumField`).** Le
garde-fou anti-fragmentation existant (`STOCK_TRADE_IMPACT_UNIT_PCT`/`STOCK_TRADE_IMPACT_MAX_UNITS`, déjà
en place depuis la section 161) est conservé TEL QUEL dans son fonctionnement — mais `tradeCubeRange()`
accepte désormais un 4e paramètre optionnel choisissant QUEL compteur cumulatif utiliser :
`company.tradeImpactAccum` (défaut, partagé entre achat/vente/short/option — le trading joueur au sens
large) ou `company.corpActionImpactAccum` (émission/rachat CEO) — les deux familles ne partagent JAMAIS
leur compteur, pour ne jamais laisser une action corporative « consommer » le budget de fragmentation du
trading joueur, ou inversement. Le 2e point de la demande initiale (budget remis à zéro à chaque semestre,
calibré à ~4 unités) n'a PAS été implémenté séparément — jugé redondant maintenant que la séparation
fondamental/trading + le plafond de 15% à la pige couvrent déjà le risque de fond (« l'impact grandit avec
le nombre de joueurs ») par une voie plus directe et plus simple ; à reconsidérer si le fuzz/les parties
tests révèlent encore un schéma de fragmentation problématique.

### Jugements d'implémentation NON explicitement confirmés par l'utilisateur — à valider

Trois décisions de classification/comportement ont dû être tranchées sans confirmation verbatim de
l'utilisateur, documentées dans le code et signalées ici pour révision :

1. **Parts privilégiées (`callPreferredShares`/lapse d'arriérage, section 237)** — classées fondamentales
   par analogie avec l'émission/rachat d'actions ordinaires (financement d'entreprise, pas trading joueur).
   Non explicitement statué par l'utilisateur pour ce cas précis.
2. **Exercice/assignation d'option (`settleOptionExercise`)** — classé trading (un pari joueur qui se
   dénoue), redirigé vers `injectTradingCube`. Non explicitement statué.
3. **`pressPublicCeoStatement`** — la garde de réussite (rouge≥vert) et l'ampleur du calme opèrent
   désormais sur le CUMUL des deux réserves (fondamental+trading — un discours du CEO s'adresse au climat
   perçu dans son ensemble), mais la coupe elle-même s'applique SÉPARÉMENT à chaque réserve, chacune
   plafonnée à son PROPRE vert (jamais un cumul qui ferait basculer une réserve dans le vert grâce au vert
   de l'autre). À corriger si l'intention était plutôt de laisser le trading — un sentiment réel déjà
   exprimé par de vraies transactions — hors de portée d'un simple discours.

### Extraits de code

```js
// applyCompanyIpoFunding() — amorce la fenêtre d'exemption au financement de l'IPO :
company.originalFloatRemaining = remaining;
company.ipoFundedAtRoll = state.gameClock.rollCount;

// executeShareTrade(), branche 'buy' — exemption, PORTION RÉELLE seulement au-delà :
let exemptQty = 0;
if((company.originalFloatRemaining||0)>1e-9 && company.ipoFundedAtRoll!==undefined &&
   (state.gameClock.rollCount-company.ipoFundedAtRoll)<IPO_FLOAT_EXEMPTION_WINDOW_ROLLS){
  exemptQty = Math.min(qty, company.originalFloatRemaining);
  company.originalFloatRemaining -= exemptQty;
}
const realQty = qty-exemptQty;
if(realQty>1e-9){
  const buyCubeRange = tradeCubeRange(company, realQty, 'green');
  if(buyCubeRange) injectTradingCube(company, 'green', buyCubeRange.qtyMin, buyCubeRange.qtyMax);
}

// drawStockCubes() — emprunt proportionnel plafonné à 15%, au moment de la pige :
const fundamentalTotal = r.green + r.red;
const tradingTotalAvailable = tr.green + tr.red;
const toBorrow = Math.min(Math.round(fundamentalTotal * TRADING_SLICE_MAX_PCT/(1-TRADING_SLICE_MAX_PCT)), tradingTotalAvailable);
let tGreen = 0, tRed = 0;
if(toBorrow>0 && tradingTotalAvailable>0){
  tGreen = Math.round(toBorrow * tr.green/tradingTotalAvailable);
  tRed = toBorrow - tGreen;
}
// ... boucle de tirage pondérée sur r.green/r.red/tGreen/tRed (jamais de blanc côté trading) ...
// seule la portion RÉELLEMENT tirée (consumedTradingGreen/consumedTradingRed) est retranchée de tr à la fin.
```

### Tests

Nouveau fichier `smoke_test_step240_trading_vs_fundamental.js` (34 assertions, 0 échec) :

- **(A)** exemption « mise de départ forcée » : achat entièrement exempté (aucun cube, flottant
  décrémenté) ; exemption terminée par ÉPUISEMENT (portion réelle au-delà, cube trading injecté) ; achat
  postérieur 100% réel une fois le flottant à 0 ; exemption terminée par le TEMPS sur une compagnie
  SÉPARÉE (flottant jamais entamé, 6 lancers écoulés depuis le financement) — reproduit exactement le
  scénario buy & hold que l'utilisateur a fait corriger.
- **(B)** achat/vente/ouverture et clôture de short ordinaires -> `tradingReserve`, JAMAIS `stockReserve` ;
  `tradeImpactAccum` partagé entre les 4 canaux confirmé.
- **(C)** `issueNewShares`/`buybackShares` -> `stockReserve` (fondamental), `corpActionImpactAccum` SÉPARÉ
  de `tradeImpactAccum` — indépendance vérifiée dans les deux sens.
- **(D)** vérification directe du calcul d'emprunt de `drawStockCubes` — (a) reprend l'exemple numérique
  donné PAR L'UTILISATEUR lui-même (85 fondamentaux / 12 vert + 3 rouge trading = 15% pile) : le sac
  trading est vidé À LA CUBE PRÈS, au prorata exact de sa composition, `stockReserve` totalement intact ;
  (b) sac trading disproportionné (100 cubes contre F=20) : SEULE la tranche empruntée (4 cubes,
  round(20×0,15/0,85)) est à risque pour cet événement, même avec 10 tirages — les 96 cubes restants ne
  sont jamais entamés.
- **(E)** `pressPublicCeoStatement` : succès/échec sur le CUMUL des 2 réserves, coupe appliquée
  séparément à chacune, chacune plafonnée à son propre vert.

**Régressions détectées et corrigées** dans 3 scripts existants dont les assertions lisaient encore
`company.stockReserve.green/red` pour du trading ORDINAIRE (achat/vente/short) — devenu
`company.tradingReserve.green/red` depuis cette section :

- `smoke_test_step48_trading_phase1_comptant.js` — (A)/(C) redirigées vers `tradingReserve` ; le flottant
  IPO fraîchement financé (700/1000 parts) aurait sinon exempté entièrement les petits achats testés
  (aucun cube du tout), sans rapport avec l'objet du test — `company.originalFloatRemaining` mis à 0
  explicitement avant (A)/(B) pour isoler la question (l'exemption elle-même est couverte par
  `smoke_test_step240_trading_vs_fundamental.js`). (I) (exécution différée d'une annonce CEO) adapté pour
  vérifier `company.tradeImpactAccum.red` plutôt que la réserve directement — la petite vente testée
  (qty=2) ne franchit pas une unité complète compte tenu du cumul déjà en cours, ce qui aurait
  silencieusement fait échouer une vérification sur la réserve.
- `smoke_test_step49_trading_phase2_short.js` — (A)/(C) (`openShortPosition`/`closeShortPosition`)
  redirigées vers `tradingReserve`.
- `smoke_test_trade_cube_range.js` — (g) (`openShortPosition` répété) redirigé vers `tradingReserve`.

Suite complète relancée : **166 scripts (165 existants + le nouveau), 0 échec**. `node -c
script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html` identiques
(`diff` vide).

**Non fait dans cette section** — explicitement différé par l'utilisateur : l'avantage structurel perçu
des actions de type « dividende » (dividendes constants qui composent la rentabilité et sont réinvestissables
ailleurs, jamais pris en compte dans le calibrage des types de compagnie les uns par rapport aux autres) —
« Après que tu aies terminé j'ai un autre enjeu. » À reprendre dans une prochaine section une fois cette
livraison faite.

## 241. Moteur boursier — le « sac type » (3e réserve de cubes, par type de compagnie), Dividende et GARP

### Origine — l'avantage structurel repéré à la section 240

Repris immédiatement après la livraison de la section 240, comme annoncé. L'utilisateur avait déjà signalé
l'enjeu (« l'avantage structurel perçu des actions de type dividende ») ; l'audit du code existant (lecture
de `modalAnnounceDividend`, de la boucle de dividende dans `advanceGameClock`, d'`injectDividendReward`,
et de `RESUME_CALIBRATION_4TYPES.md`) a confirmé le problème précis : `injectDividendReward` appliquait un
bonus multiplicatif `STOCK_TRIGGER_DIVIDEND_TYPE_BONUS_MIN/MAX` (×1,5-2) sur les cubes verts injectés
UNIQUEMENT pour `co.type==='dividende'` — un investisseur Dividende touchait donc à la fois cette hausse de
PRIX artificielle ET le vrai cash de dividende reçu par les actionnaires (`pl.cash += cut`, section 134),
sans que la calibration d'origine (`RESUME_CALIBRATION_4TYPES.md`) n'ait jamais mesuré ce second flux — son
propre tableau de validation montre déjà Dividendes au 2e meilleur rendement de PRIX (137, vs Croissance 293,
Momentum 101, GARP 93) avec un prototype qui « ne capture pas » les vrais dividendes cash, et son historique
documente un problème quasi identique déjà à moitié corrigé (« Round 1 : Dividendes dominait tout... à cause
d'un bonus de séquence qui composait sans frein »).

### Discussion de conception (verbatim, dans l'ordre)

> « le problème avec ex dividende c'est de calibrer les options. Donc non. il faut penser a autres chose.
> la je pensais peut-être un troisième sac avec cubes type. Mais je ne sais pas si bonne idee »

> « Bon, la manière que je vois ça (DISCUSSION pas de code) : On ajoute un sac pour les cubes type. On
> dirait que la manière que je verrais ça c'est que c'est 20 cubes blancs dans le sac et il change de
> couleur en fonction d'actions qui sont prises dans le jeu. Donc rien n'est ajouté, rien n'est enlevé, mais
> tous se transforme dans ce sac. Comment aimes-tu l'idée ? »

> « Ok voici l'idée complète : Le sac trading comme on l'a établit va tirer 15% des cubes, le sac
> fondamentales lui 65% des cubes et le 20% restant sera le sac type. Dans le sac type, il y a 20 cubes
> jamais plus jamais moins (donc toujours remis) les cubes changent de couleur et peuvent passer VERT <=>
> ROUGE ou VERT <=> Blanc <=> Rouge dépendant des actions. Si saturation 20 rouges, rien ne se passe si on
> ajoute des rouges. Sac trading : Reflecte les intentions d'achat comme déjà effectué. Sac fondamentaux :
> Réflecte les fondamenteux. Sac type : Réflecte les différences dans la gestion du type d'entreprise »

> « Oui les blancs participent => rien ne bouge. Exact c'est le reflect des mécaniques spéciale. Saturation
> gèle seulement dans un sens et il faut 20 cubes de la même couleur. GARP à voir. Dividende je pensais à
> ça, les investisseurs s'attendent à recevoir des dividendes le sac mais c'est pas forcément vert ça peut
> être blanc!! »

> « Je le verrais à plus large. Et j'en profiterais pour ajuster la volatilité avec ça je m'explique une
> compagnie dividende qui verse as expected va avoir mettons 18 blancs dans le sac type ça va donc faire
> moins de variation dans le cours ce qui est attendu. Là pour que'est ce qui fait quoi c'est la que je veux
> que tu me sortes tes idées brainstormons »

> « Je le ferais assymétrique. Donc exemple : Voici ta jauge. Pallier 0 : Aucun versement / Pallier 1 : /
> Pallier 2 : / Pallier 3 : Versement standard de départ = Pas de modification / Pallier 4 : / Pallier 5 : /
> Pallier 6 : / Pallier 7 : Je manque d'inspiration aide moi »

> « Donc si je comprend bien le meilleur ratio qu'un joueur peut obtenir c'est 8 verts / 12 blancs »

> « Oui j'aime l'idée une seule chose par contre, rien ne fait revenir les cubes de couleurs vers le blancs,
> donc la volatilité serait de plus en plus grande »

> « Bien écoute ça pourrait être une idée, augmenter les variations de cubes par pallier un peu, mais quand
> ils sont pigés il retourne dans le sac en blanc. »

> « Chaque cube pigé retombe au blanc. Maintenant tu aimes mieux coder ça et après passé à croissance ou on
> passe directement à croissance »

Puis, après le début de l'implémentation (Dividende + GARP), deux précisions supplémentaires reçues en
cours de route :

> « GARP peut-être ajouté des palliers si écart de 20% mettre un ratio 15 couleurs vs 5 blancs, 30% 20
> couleurs vs 0 blancs »

> « Je pense que c'est implicite mais GARP les cubes pigé ne retourne pas blanc dans le sac c'est la
> logique même »

### Conception retenue

**Infrastructure commune aux 4 types** — `company.typeReserve = {green, red, white}`, une réserve de cubes
de taille **fixe et invariante à 20**, initialisée à `{0,0,20}` à la fondation pour TOUS les types (rien ne
« part » avec un biais type). Contrairement à `stockReserve`/`tradingReserve` (injection/consommation), les
cubes du sac type ne font QUE changer de couleur — jamais ajoutés ni retranchés du total.

**Split de tirage à 3 voies** (`drawStockCubes`) : 65 % fondamental / 15 % trading (inchangé, section 240) /
20 % type. Le fondamental (`F = stockReserve.green+red`) reste l'ancre jamais empruntée ; trading et type
sont empruntés au DÉBUT de chaque événement de tirage à hauteur de `F × pct/0,65` (généralisation directe
de l'ancienne formule `F×0,15/0,85` de la section 240 — l'ancre passe de 0,85 à
`FUNDAMENTAL_SLICE_TARGET_PCT=0,65`), chacun plafonné à ce qui est réellement disponible dans sa propre
réserve. Contrairement au trading (jamais de blanc), le sac type est emprunté selon sa PROPRE composition
vert/rouge/BLANC courante — un blanc type tiré est un résultat actif (« rien ne bouge »), pas une absence de
tirage.

**Réversion-au-tirage** : chaque cube type RÉELLEMENT tiré (vert ou rouge) retombe IMMÉDIATEMENT au blanc
dans `company.typeReserve` après avoir produit son effet de prix — « chaque cube pigé retombe au blanc »
(demande explicite). Ceci a été adopté en remplacement d'une proposition initiale de l'assistant (« l'action
opposée soigne la couleur opposée ») pour résoudre un défaut structurel identifié en cours de conception :
sans un chemin de retour couleur→blanc, un sac type ne peut que saturer progressivement au fil d'une partie
(chaque événement historique, bon ou mauvais, « marque » la compagnie pour toujours, avec une volatilité
sans cesse croissante). La réversion-au-tirage crée une décroissance organique et auto-limitée : plus un sac
accumule de couleur, plus il a de chances d'être pigé (donc de revenir au blanc) au prochain événement — un
maintien durable exige des actions RÉPÉTÉES, jamais un seul événement historique.

**Saturation** : un déplacement de cubes (voir `shiftTypeReserve`) vers une couleur gèle UNIQUEMENT si cette
couleur est déjà à 20/20 — en dessous de 20, un déplacement partiel reste normal (borné par ce qui reste
disponible en couleur opposée + blanc, jamais un dépassement de 20).

**GARP** — mécanisme « super simple » (demande explicite), une réinitialisation COMPLÈTE (pas une injection
incrémentale) du sac type à CHAQUE semestre, selon la comparaison valeur comptable par part
(`balanceSheetFor(...).equity / co.totalShares`, la MÊME métrique que le check commun (1) « comptable vs
boursier ») vs cours (`co.stockPrice`) : paliers par MAGNITUDE de l'écart, ajoutés après une 1ère version à
3 états —

| Écart \|cours−valeur\|/valeur | Effet sur le sac (20 cubes) |
|---|---|
| ≤ 2 % (juste prix) | 20 blancs |
| entre 2 % et 20 % | 10 couleur / 10 blanc |
| entre 20 % et 30 % | 15 couleur / 5 blanc |
| ≥ 30 % (saturation) | 20 couleur / 0 blanc |

— la couleur (vert si sous-évalué : valeur > cours ; rouge si survalorisé : valeur < cours) suit la même
règle que le check commun. « Litérralement un changement de tout au tout selon le critère » : ce reset
ÉCRASE l'état précédent du sac (y compris tout effet de réversion-au-tirage accumulé), cohérent avec
l'identité « sans histoire » de GARP. Corollaire explicite de l'utilisateur : **les cubes type de GARP ne
subissent JAMAIS la réversion-au-tirage générique** — « c'est la logique même », puisque ce reset intégral
au semestre remplace déjà ce rôle (`drawStockCubes` porte un garde `company.type!=='garp'` sur la
réversion).

**Dividende — promesse de dividende à la fondation** : quand `type==='dividende'`, un nouveau champ du
formulaire de fondation demande un rendement de dividende annuel PROMIS (%), plancher = le taux sans risque
annuel courant (`state.settings.riskFreeRateAnnual`, SANS prime — décision explicite, contrairement à la
suggestion initiale de l'assistant d'ajouter 1-2 points). Devient `company.dividendBenchmarkPerShare` =
`(promis%/100/2) × stockPriceFounding` — benchmark **par semestre** (le versement reste semestriel : « Ok on
garde par semestre », contre une 1ère idée annuelle envisagée puis écartée), **ancré à `stockPriceFounding`,
JAMAIS au cours courant** (évite qu'un cours en baisse rende la promesse mécaniquement plus facile à tenir).
Un appel programmatique/de test qui omet cette promesse (ancienne UI, ou API directe) reçoit un repli
silencieux au plancher plutôt qu'un blocage — la vraie UI de fondation fournit toujours une valeur
(pré-remplie au plancher par défaut).

**Dividende — jauge à 8 paliers** (dans `modalAnnounceDividend`, fonction `applyDividendGaugeTier`),
asymétrique par design (moins de paliers de coupe, plus graduels à la hausse — « une compagnie qui coupe ne
le fait généralement pas à moitié » vs des histoires de croissance qui peuvent composer sur plusieurs
semestres) :

| Palier | Montant relatif au benchmark courant | Effet sur le sac (20 cubes) |
|---|---|---|
| 0 | Aucun versement (suspension complète) | Choc total — tout le vert ET le blanc basculent en rouge |
| 1 | ≤ 50 % du benchmark | -6 cubes vers le rouge |
| 2 | 50 %-90 % (au-dessus du plancher, sous la bande) | -3 cubes vers le rouge |
| 3 | ±10 % du benchmark (zone de tolérance) | Aucun changement |
| 4 | 110 %-130 % | +3 cubes vers le vert |
| 5 | 130 %-150 % | +6 cumulés depuis le palier 3 |
| 6 | 150 %-175 % | +9 cumulés |
| 7 | ≥ 175 % | +12 cumulés |

La jauge **recentre le benchmark** sur le $/part RÉELLEMENT déclaré après CHAQUE palier confirmé ≠ 3 (permet
à des hausses/coupes soutenues sur plusieurs semestres de continuer à composer, plutôt qu'un plafond
atteignable en une seule déclaration) — confirmé explicitement : « 8 verts/12 blancs » est le maximum
atteignable en UNE déclaration, pas le plafond de toute la partie (qui reste le plafond dur de saturation à
20 cubes). Le palier 0 (suspension) n'est PAS atteignable via une déclaration positive (le formulaire exige
un montant > 0) — détecté automatiquement par le mécanisme EXISTANT de séquence (`thisSem<=0` dans
`advanceGameClock`) : aucun dividende versé ce semestre déclenche le choc total, mais le BENCHMARK reste
INCHANGÉ dans ce cas précis (référence à laquelle revenir si le versement reprend, pas une « nouvelle
normale » — décision d'implémentation, aucune divergence de l'utilisateur sur ce point précis puisque non
abordé explicitement).

**Dividende — auto-versement (bascule opt-in)** : quand activée (case à cocher dans Mon Entreprise, visible
uniquement pour une compagnie Dividende avec benchmark actif), verse AUTOMATIQUEMENT
`dividendBenchmarkPerShare × sharesIssued` à chaque frontière de semestre, sans action du CEO. Payé
EXACTEMENT au benchmark courant, donc TOUJOURS palier 3 par construction — aucun appel à la jauge, aucun
effet sur le sac type. Aucune garde de suffisance de trésorerie (peut rendre `company.cash` négatif) — la
garde EXISTANTE `blockReadyForNegativeCash` (bloque déjà la fin de tour aux frontières de semestre tant que
l'encaisse reste négative) suffit, laissant au CEO les lancers intermédiaires pour se refinancer. Une
déclaration MANUELLE additionnelle le MÊME semestre (un « top-up ») est EXCLUE de la jauge — « Ne change pas
de cubes en verts » — détectée via `company.dividendAutoPaySemesterIdx`, posé par le bloc d'auto-versement.

**Mécanisme retiré** : le bonus multiplicatif `STOCK_TRIGGER_DIVIDEND_TYPE_BONUS_MIN/MAX` dans
`injectDividendReward` (double comptage à l'origine du problème) est supprimé — les mécanismes EXISTANTS
(`dividendStreak`, ratio de distribution `dividendPayoutRatioMin/Full`, `dividendLossStreak`, le lien
dette/spirale de détresse via le cash sortant à l'annonce) restent, eux, INCHANGÉS et continuent de
fonctionner en parallèle pour les 4 types — ils n'ont jamais été la source du double comptage.

**Différé à une prochaine section** : Croissance (piste évoquée : « battre/manquer la moyenne du marché »,
son mécanisme relatif-vs-marché existant) et Momentum (tension explicitement identifiée et non résolue : la
continuation de tendance EST le comportement attendu/récompensé pour ce type, ce qui rentre en tension avec
le motif « blanc = comportement attendu » observé chez Dividende/GARP).

### Implémentation

`script_extracted.js` :
- `createCompany` : `company.typeReserve={green:0,red:0,white:20}` pour les 4 types ; nouveau 5e paramètre
  `dividendPromisedAnnualPct` (undefined → repli au plancher ; fourni mais sous le plancher → refus avec
  message d'alerte) ; `company.dividendBenchmarkPerShare`/`dividendAutoPay=false` pour le type Dividende.
- `migrateState` : amorce `typeReserve`/`dividendAutoPay` pour une partie déjà en cours (aucun benchmark
  n'est inventé pour une compagnie Dividende déjà en cours — jamais de promesse de fondation historisée).
- Formulaire de fondation (`renderCompanySetupGate`) : champ conditionnel `#cDividendPctRow`/`#cDividendPct`
  (visible seulement si type Dividende, plancher = taux sans risque courant), threadé jusqu'à
  `createCompany`.
- `drawStockCubes` : nouvelles constantes `FUNDAMENTAL_SLICE_TARGET_PCT=0,65`/`TYPE_SLICE_MAX_PCT=0,20`
  (`TRADING_SLICE_MAX_PCT=0,15` inchangée) ; emprunt + réversion-au-tirage du sac type (garde
  `company.type!=='garp'` sur la réversion) ; le garde `whiteBonusRemaining` (blanc bonus temporaire du CEO,
  section 160) est resserré à `bucket==='white'` (fondamental) pour ne jamais être consommé par un blanc
  type.
- Nouvelles fonctions : `shiftTypeReserve(company, targetColor, n)`, `wipeTypeReserveToRed(company)`,
  `dividendGaugeTierFor(ratio)`, `applyDividendGaugeTier(co, totalAmount)`.
- Groupe A (`advanceGameClock`) : mécanisme GARP inséré juste après le check commun (1) (réutilise
  `bookPerShare0` déjà calculé) ; palier 0 (choc total) inséré dans la branche `thisSem<=0` existante ;
  nouveau bloc d'auto-versement Dividende (avant le groupe A, juste après le filtrage des annonces
  différées) — `logFin` y reçoit un paramètre `roll` explicite (`rollCount-1`) pour s'estampiller sous le
  semestre qui vient de SE TERMINER (`semesterBefore`), pas le nouveau qui démarre (sans quoi
  `dividendPaidInSemester` ne le verrait jamais, déclenchant par erreur le palier 0 le semestre même où
  l'auto-versement a eu lieu — bug détecté et corrigé pendant l'écriture du test dédié).
- `injectDividendReward` : bonus type Dividende retiré (voir « Mécanisme retiré » plus haut) ; constante
  `STOCK_TRIGGER_DIVIDEND_TYPE_BONUS_MIN/MAX` retirée du code actif (commentaire explicatif conservé).
- `modalAnnounceDividend` : affichage du benchmark/zone de tolérance courants ; applique la jauge à la
  confirmation, SAUF si l'auto-versement a déjà payé ce semestre (`dividendAutoPaySemesterIdx`).
- `renderEntreprise`/`bindTabEvents` : case à cocher `#dividendAutoPayToggle` (visible seulement pour une
  compagnie Dividende avec benchmark actif), bascule immédiate + sauvegarde, sans modal.

**Nouveau fichier de test** : `smoke_test_step241_type_bag_dividende_garp.js` (49 assertions) — fondation
Dividende/GARP (A), emprunt + réversion-au-tirage non-GARP (B), absence de réversion GARP (C),
`shiftTypeReserve` borné + saturation (D), `wipeTypeReserveToRed` (E), mécanisme GARP par paliers de
magnitude via `advanceGameClock` réel (F), `dividendGaugeTierFor`/`applyDividendGaugeTier` — bornes exactes,
deltas, recentrage (G), palier 0 automatique (H), auto-versement de bout en bout (I).

**Régression détectée et corrigée** dans `smoke_test_step46_stock_market_engine_phase_c_dividend.js` (D) :
l'assertion testait explicitement l'ANCIEN bonus multiplicatif retiré (« Eve Corp reçoit STRICTEMENT PLUS
d'appels verts que Dan Corp ») — inversée pour vérifier l'ABSENCE du double comptage (nombre d'appels
IDENTIQUE entre les deux types pour le même événement de dividende).

**Régressions détectées et corrigées** dans `smoke_test_step240_trading_vs_fundamental.js` (D-a)/(D-b) et
`smoke_test_step193_stock_cube_floor.js` (B), toutes causées par le split à 3 voies : (a) l'ancre du
fondamental passe de 0,85 à 0,65, changeant l'emprunt trading EXACT dans un scénario non plafonné
(`round(20×0,15/0,65)=5`, au lieu de 4) — recalculé et corrigé dans step240 (D-b) ; (b) le sac type participe
désormais TOUJOURS au tirage (par défaut 20 blancs, même quand le fondamental est pinné à une seule couleur)
— `typeReserve` neutralisé explicitement (somme nulle) dans les 2 scénarios numériques de step240 et dans
step193 (B), qui testaient auparavant une composition « seule couleur tirable » désormais fausse par
construction.

**Régression de test découverte pendant l'écriture (flakiness)** : la 1ère version de l'assertion du palier
0 (H) dans le nouveau fichier de test attendait une égalité EXACTE `{0,20,0}` juste après le choc — mais le
MÊME `advanceGameClock()` enchaîne, après le groupe A, la boucle de tirage normale du lancer, qui peut (au
hasard) piocher immédiatement 1+ cube dans le sac type fraîchement soufflé et le faire retomber au blanc
(réversion-au-tirage) avant même la lecture par le test — un comportement ATTENDU de l'enchaînement des 2
mécanismes, pas un bug. `Math.random` figé à 0 pour cet appel précis dans le test, pour isoler proprement le
déclenchement du palier lui-même.

Suite complète relancée à répétition (167 scripts, plusieurs passes complètes + 40 exécutions dédiées du
nouveau fichier pour chasser tout aléa restant) : **0 échec**. `node -c script_extracted.js`. `python3
sync_script.py` exécuté ; `index.html`/`monopolybourse.html` identiques (`diff` vide).

**Non fait dans cette section** — explicitement différé, comme convenu avec l'utilisateur : Croissance et
Momentum (leurs propres mécanismes de sac type respectifs). À reprendre dans une prochaine section.

## 242. Moteur boursier — le « sac type » pour Croissance (2 axes, remplace l'ancien check (6))

### Origine

Repris immédiatement après la livraison de la section 241 (Dividende/GARP), suite directe annoncée dans la
dernière question de cette section (« tu aimes mieux coder ça et après passé à croissance ou on passe
directement à croissance »). Discussion purement conversationnelle (« DISCUSSION pas de code », dans le même
esprit que tout le reste du projet), aucune implémentation avant l'accord final.

### Discussion de conception (verbatim, dans l'ordre)

> « Pour croissance, en choisissant le type je mettrais 2 options distinctes, 2 niveaux de croissance élevé
> ou très élevé. Mécanique similaire : 2 Axes, croissances des revenus / Percentile des bénéfices nets »

> « Exact très élevé = Plus difficile mais plus rentable. Croissance des revenus sur cette compagnies (sans
> égards au dépenses) / Percentile des bénéfices : Classer les marges bénéficiaires des compagnies si tu est
> dans la première moitié par exemple = BONS sinon Mauvais »

> « Remplacement : Croissance des revenus = Commun au 2 profils / Élevé >50% = BON <50% = MAUVAIS / Très
> élevé >67% = BON <50% = MAUVAIS 50-67% = Neutre »

> « J'aime ton idée de matrice!!! »

[Image — matrice 3×3 dessinée à la main, AXE 1 en ligne / AXE 2 en colonne, BON/NEUTRE/MAUVAIS pour chaque
axe] suivie de : « Un peu comme GARP c'est un sac qui prend une photo pas de transformation comme dividende »

> « Je veux que l'axe le plus fort soit celui des % des bénéfices (la marge). Axe1 : Percentile de la marge
> / Axe2 : Croissance des revenus. Je ne sais pas quoi mettre comme seuil »

(l'assistant propose les seuils fixes de l'Axe 2 : ≥+20 %=BON, -10 % à +20 %=NEUTRE, <-10 %=MAUVAIS)

> « Oui »

> « bien vu le 5 qui manque c'est la couleur opposé donc 10 Vert , 5 Blancs, 5 rouges » — correctif d'une
> erreur arithmétique repérée par l'assistant dans la matrice dessinée à la main (2 cellules ne sommaient
> qu'à 15 cubes, pas 20) : l'utilisateur confirme que le complément manquant est la couleur OPPOSÉE à la
> cellule (signal contradictoire entre les 2 axes), pas un simple ajout de blanc.

> « Go » — approbation finale du design consolidé, pour l'implémenter « même méthode que Dividende/GARP »
> (fondation + formulaire + mécanisme semestriel + tests + doc + sync).

### Conception retenue

**Fondation** — Croissance demande désormais un profil à la création : `company.croissanceTier` =
`'eleve'` (défaut) ou `'tres_eleve'` (« plus difficile mais plus rentable »).

**Axe 1 (dominant) — percentile de la marge** : la marge nette de CETTE compagnie (`netMargin`, déjà
calculée par ailleurs pour la spirale de détresse universelle) classée en PERCENTILE parmi TOUTES les
compagnies actives ce semestre (fraction des compagnies, elle-même incluse, dont la marge est ≤ la sienne).
Seuils dépendant du profil choisi à la fondation —

| Profil | BON | NEUTRE | MAUVAIS |
|---|---|---|---|
| Élevé | ≥ 50e percentile | *(jamais atteint)* | < 50e percentile |
| Très élevé | ≥ 67e percentile | 50e-67e percentile | < 50e percentile |

— le profil Élevé n'a que 2 états (jamais de NEUTRE, confirmé explicitement : « Élevé >50% = BON <50% =
MAUVAIS »). Sauté (sac type INCHANGÉ ce semestre) si moins de 2 compagnies actives à comparer — une
comparaison à soi-même serait triviale.

**Axe 2 (secondaire, COMMUN aux 2 profils) — croissance des revenus** : réutilise TEL QUEL le calcul déjà
existant `semGrowthById` (croissance du chiffre d'affaires de CETTE compagnie vs le semestre précédent,
« sans égard aux dépenses »), mais comparé à des seuils FIXES (proposés par l'assistant, approuvés
explicitement — « Oui ») plutôt qu'à la moyenne du champ (contrairement à l'ancien check (6), voir plus
bas) :

| Croissance de revenu | Axe |
|---|---|
| ≥ +20 % | BON |
| entre -10 % et +20 % | NEUTRE |
| < -10 % | MAUVAIS |

Sauté (sac type INCHANGÉ) si pas assez d'historique (compagnie fondée ce semestre ou le précédent —
`semGrowthById[co.id]` undefined), exactement comme l'ancien check (6) qu'il remplace.

**Combinaison — reset complet (« photo »), comme GARP** : quand les 2 axes sont calculables, `typeReserve`
est ENTIÈREMENT réécrit chaque semestre (jamais une injection incrémentale) — verbatim : « Un peu comme GARP
c'est un sac qui prend une photo pas de transformation comme dividende ». Aucune réversion-au-tirage non
plus, pour la même raison que GARP (le reset semestriel joue déjà ce rôle). Matrice finale (Axe 1 en ligne,
Axe 2 en colonne), CONFIRMÉE verbatim par l'utilisateur, chaque cellule sommant TOUJOURS à exactement 20 —
les cellules manquantes de 5 cubes dans le dessin original sont complétées par la couleur OPPOSÉE (signal
contradictoire entre les 2 axes), pas par du blanc supplémentaire :

| Marge \ Revenus | BON | NEUTRE | MAUVAIS |
|---|---|---|---|
| **BON** | 20 vert | 15 vert / 5 blanc | 10 vert / 5 blanc / 5 rouge |
| **NEUTRE** | 10 vert / 10 blanc | 20 blanc | 10 rouge / 10 blanc |
| **MAUVAIS** | 10 rouge / 5 blanc / 5 vert | 15 rouge / 5 blanc | 20 rouge |

Pour le profil Élevé, l'axe marge n'atteint jamais NEUTRE — seules les rangées BON/MAUVAIS de cette matrice
sont donc jamais consultées pour ce profil ; la rangée NEUTRE ne s'applique qu'au profil Très élevé.

**Remplacement, pas addition** : ce mécanisme REMPLACE ENTIÈREMENT l'ancien check (6) « performance
relative » (croissance de revenu de cette compagnie vs la MOYENNE du champ, injecté dans le sac FONDAMENTAL
— `stockReserve`) — confirmé explicitement : « Remplacement ». Les 2 mécanismes ne coexistent jamais : le
sac type Croissance vit dans une réserve entièrement séparée (`typeReserve`, jamais `stockReserve`), donc
leur suppression/ajout respectifs n'interfèrent avec aucun autre check du groupe A (tous les autres checks
continuent d'agir sur `stockReserve` exactement comme avant, pour Croissance comme pour les 3 autres types).

### Implémentation

`script_extracted.js` :
- `createCompany` : nouveau 6e paramètre `croissanceTier` (undefined/null → repli silencieux sur `'eleve'` ;
  valeur fournie mais ni `'eleve'` ni `'tres_eleve'` → refus avec message d'alerte, même convention que
  `dividendPromisedAnnualPct` section 241) ; `company.croissanceTier` posé UNIQUEMENT pour le type
  Croissance (undefined pour les 3 autres, jamais consultée pour eux).
- `migrateState` : une compagnie Croissance déjà en cours sans ce champ (vieille sauvegarde) reçoit le
  repli `'eleve'`.
- Formulaire de fondation (`renderCompanySetupGate`) : nouveau champ conditionnel
  `#cCroissanceTierRow`/`#cCroissanceTier` (`<select>` Élevé/Très élevé, visible seulement si type
  Croissance — même bascule que `#cDividendPctRow` de la section 241), threadé jusqu'à `createCompany`.
- Nouvelle constante `TYPE_RESERVE_SNAPSHOT_TYPES = new Set(['garp', 'croissance'])` — centralise les 2
  types dont le sac type est une « photo » semestrielle plutôt qu'un déplacement incrémental, remplaçant le
  garde ponctuel `company.type!=='garp'` de la section 241 aux 2 sites de `drawStockCubes` où la
  réversion-au-tirage est sautée (évite la répétition `type!=='garp' && type!=='croissance'`).
- Nouvelles fonctions : `croissanceMarginPercentile(coId, netMarginById)` (percentile, null si <2
  compagnies), `croissanceMarginAxis(percentile, tier)` (seuils par profil), `croissanceRevenueAxis(growth)`
  (seuils fixes), `croissanceTypeMatrix(marginAxis, revenueAxis)` (lookup de la matrice 3×3 confirmée,
  table `CROISSANCE_TYPE_MATRIX`).
- Groupe A (`advanceGameClock`) : nouveau pré-calcul `netMarginById` (marge nette de CHAQUE compagnie
  active ce semestre, même formule que `netMargin` — calculé UNE fois pour toutes les compagnies, comme
  `semGrowthById` existant, pour permettre la comparaison percentile) ; la variable locale `netMargin`
  (utilisée par le check (2) et la spirale de détresse) est désormais dérivée de `netMarginById[co.id]` au
  lieu d'être recalculée séparément (aucune divergence possible entre les deux). Nouveau bloc Croissance
  inséré juste après le mécanisme GARP (même style « photo ») : calcule les 2 axes, applique
  `croissanceTypeMatrix`, écrase `co.typeReserve` si les 2 axes sont calculables, sinon ne touche à rien.
  L'ancien check (6) est supprimé (commentaire `[RETIRÉ — Section 242]` conservé à sa place) ; l'ancienne
  moyenne du champ `fieldAvgRevGrowth` (qu'il consommait exclusivement) est retirée avec lui — `semGrowthById`
  elle-même reste inchangée, réutilisée pour l'Axe 2 du nouveau mécanisme.

**Nouveau fichier de test** : `smoke_test_step242_type_bag_croissance.js` (43 assertions) — fondation/
migration du profil (A), `croissanceMarginPercentile` (B), `croissanceMarginAxis` par profil (C),
`croissanceRevenueAxis` à seuils fixes (D), les 9 cellules exactes de la matrice + invariant de somme à 20
(E), absence de réversion-au-tirage pour Croissance (F), mécanisme complet de bout en bout via
`advanceGameClock` réel — cellule BON/BON puis MAUVAIS/MAUVAIS sur la MÊME compagnie pour vérifier
l'écrasement complet (« photo », pas incrémental), sauté au 1er semestre d'existence (pas d'historique de
croissance) et sauté à une seule compagnie active (percentile impossible) (G), garde de régression au niveau
du code source confirmant le retrait effectif de l'ancien check (6) (H).

**Régression détectée et corrigée** dans `smoke_test_step55_phase3_polish.js` (Point 21) : le scénario
soumettait le formulaire de fondation avec `#cType` réglé sur `'croissance'` sans jamais toucher au nouveau
champ `#cCroissanceTier` — le mock DOM de ce fichier (contrairement à un vrai `<select>`, toujours
pré-rempli sur sa 1re option) renvoie une chaîne VIDE par défaut pour tout élément non explicitement réglé,
ce qui n'est ni `undefined`/`null` (repli silencieux) ni une valeur valide (`'eleve'`/`'tres_eleve'`) —
`createCompany` refusait donc la fondation avec une alerte, laissant `companyById(a.companyId)` retourner
`null` et le test planter (`TypeError` sur `.name`) au lieu d'échouer proprement sur une assertion. Corrigé
en réglant explicitement `#cCroissanceTier` à `'eleve'` avant la soumission, comme le ferait un vrai
`<select>` par défaut.

Suite complète relancée à répétition (169 scripts au total, 4 passes complètes consécutives) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html`
identiques (`diff` vide).

**Non fait dans cette section** — explicitement différé, comme convenu (méthode identique aux sections 240/
241) : Momentum (son propre mécanisme de sac type). À reprendre dans une prochaine section.

## 243. Moteur boursier — jauge cliquable du dividende RÉCURRENT (déménagée hors de la déclaration manuelle)

### Origine

Repris immédiatement après la livraison de la section 242 (Croissance). L'utilisateur a fourni 2 pièces
jointes (une capture d'écran de l'onglet Entreprise actuel, et un croquis dessiné à la main d'un curseur/
jauge) accompagnées de :

> « Vraiment pas le visuel souhaitez juste l'idée mais j'aimerais que le versement automatique ouvre un
> pop-up qui permet de choisir son niveau augmenter ou diminuer préétablit pour aider le joueur »

Correctif de vocabulaire immédiat :

> « Dans dividende je parle. Montant total d'encaisse c'est plus Coût total désolé »

Puis un correctif de conception majeur, qui redéfinit la portée du reste de la section 241 :

> « Non attend la déclaration de dividendes c'est commun à chaque type et n'affecte aucunement les cubes du
> types, même dividendes. C'est l'option dividende récurrent qui compte, et je veux mettre une jauge qui
> permet au joueur d'augmenter son niveau de dividendes ou le réduire par pallier déterminer, mais ou chaque
> clique à un impact sur les cubes. »

Précision sur le moment où l'effet s'applique (principe « bac à sable jusqu'à confirmation ») :

> « L'impact se fait ressertir lorsqu'il confirme le pop-up, il peut très bien cliquer pour voir l'impact du
> coûts et revenir sans impact tant qu'il ne clique pas confirmer »

Réponse à 2 questions de clarification posées par l'assistant (palier 0/suspension accessible via la jauge ?
et comportement à la réactivation après une suspension) :

> « 1) Oui\n2) Décocher l'option du paiement automatique, si tu arrives à un semestre et que c'est décocher
> donc pas de versement là l'impact arrive. Si tu recoche par la suite le jauge repars au niveau du début de
> jeu »

— le « Oui » répond à une question de l'assistant demandant confirmation que le palier 0 (suspension) reste
exclusivement automatique, jamais atteignable via la jauge du popup.

Réponse à une 3e question (est-ce que les cubes eux-mêmes sont aussi remis à zéro à la réactivation, ou
seulement le prix de référence ?), suivie d'une invitation ouverte pour les 7 seuils de la jauge :

> « 1) seulement le prix, les cubes restent intact ils doivent être pigée pour retourner blanc.
> 2) Tu conseil quoi... »

L'assistant a recommandé de reprendre TELS QUELS les seuils de `dividendGaugeTierFor` (section 241) en
prenant le MILIEU de chaque bande comme les 7 pourcentages de la jauge, pour ne dupliquer aucune logique de
déplacement de cubes. Approbation finale du design consolidé :

> « go »

### Conception retenue

**Correctif rétroactif sur la section 241** — la déclaration manuelle de dividendes (`modalAnnounceDividend`,
commune aux 4 types) n'affecte plus DU TOUT le sac type, même pour le type Dividende (auparavant, un montant
extrême pouvait y déclencher la jauge à 8 paliers de la section 241). Toute la logique de jauge/cubes
déménage ENTIÈREMENT dans le nouveau popup ci-dessous, qui ne concerne QUE l'option « dividende récurrent »
(versement automatique).

**Nouveau popup `modalDividendRecurrentSettings`**, ouvert en cliquant sur le bouton « 🔁 Dividende
récurrent » (qui remplace l'ancienne case à cocher simple) : un curseur à 7 positions (paliers 1-7,
réutilisant TELS QUELS les paliers/deltas de `dividendGaugeTierFor` — palier 4 = centre = « aucun changement
» dans la numérotation section 241, devient ici le palier 3 sur 7 puisque le palier 0/suspension n'est jamais
accessible via la jauge, voir plus bas), une case « verser automatiquement chaque semestre », et un aperçu en
direct ($/part, coût total par semestre) qui se met à jour à CHAQUE déplacement du curseur SANS AUCUN effet
tant que le joueur n'a pas cliqué sur Confirmer — « il peut très bien cliquer pour voir l'impact du coûts et
revenir sans impact tant qu'il ne clique pas confirmer ». Annuler/fermer sans confirmer laisse tout inchangé,
peu importe où le curseur a été laissé (bac à sable complet).

**Palier 0 (suspension) reste exclusivement automatique** — jamais atteignable via la jauge (plage du
curseur : 1 à 7 seulement). Le mécanisme existant (case décochée + aucun versement à une frontière de
semestre → `wipeTypeReserveToRed`) est inchangé ; il pose désormais en plus un nouveau drapeau
`company.dividendRecurrentNeedsReset = true`.

**Réactivation après une suspension** — « la jauge repart au niveau du début de jeu » : à la prochaine
confirmation qui RÉACTIVE le dividende récurrent (case cochée) suite à une suspension, le prix de référence
(`dividendBenchmarkPerShare`) est remis à la promesse de FONDATION (`dividendBenchmarkFounding`, nouveau champ
immuable posé une seule fois à la création). Les CUBES, eux, restent exactement où le choc de suspension les
a laissés — « seulement le prix, les cubes restent intact ils doivent être pigée pour retourner blanc » —
aucune correction rétroactive ; ils ne reviennent au blanc que via le mécanisme de tirage déjà existant
(`drawStockCubes`). Décliner la réactivation (laisser la case décochée en refermant le popup, ou simplement
ne rien faire) laisse le drapeau posé pour la prochaine tentative, sans aucun autre effet.

**Les 7 pourcentages de la jauge** (recommandation de l'assistant, approuvée) — le MILIEU de chaque bande de
`dividendGaugeTierFor`, relatif au benchmark COURANT (ou de fondation, si une réactivation est en attente) :

| Palier | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| % du benchmark | 25 % | 70 % | 100 % | 120 % | 140 % | 162,5 % | 200 % |
| Sens | forte baisse | baisse | inchangé | hausse | forte hausse | très forte hausse | hausse maximale |

**Réutilisation totale de `applyDividendGaugeTier`, sans AUCUNE nouvelle logique de cubes** — parce que
chaque pourcentage ci-dessus est PILE le milieu de sa bande, construire un montant fictif
(`benchmark_actuel × pourcentage × sharesIssued`) et le repasser dans `applyDividendGaugeTier` (section 241,
inchangée) fait retomber le calcul EXACTEMENT dans le palier visé, avec le bon déplacement de cubes et le bon
recentrage du benchmark — aucune duplication entre l'ancien chemin (retiré) et ce nouveau popup.

### Implémentation

`script_extracted.js` :
- `createCompany` (bloc `type==='dividende'`) : nouveaux champs `dividendBenchmarkFounding` (copie
  immuable du benchmark à la fondation) et `dividendRecurrentNeedsReset = false`.
- `migrateState` : une compagnie Dividende déjà en cours reçoit `dividendBenchmarkFounding` en repli sur son
  benchmark COURANT (aucun historique de fondation disponible pour une vieille sauvegarde) et
  `dividendRecurrentNeedsReset = false` si absent.
- Palier 0 automatique (frontière de semestre, dans `advanceGameClock`) : en plus du `wipeTypeReserveToRed`
  déjà existant, pose désormais `co.dividendRecurrentNeedsReset = true`.
- `modalAnnounceDividend` : toute la logique de jauge (calcul du palier actif, exclusion anti-double-compte,
  appel à `applyDividendGaugeTier`) est RETIRÉE — la déclaration manuelle se limite désormais au débit de
  trésorerie et au journal, sans toucher au sac type ni au benchmark, pour aucun type.
- Nouvelle constante `DIVIDEND_RECURRENT_TIER_PCT = [0.25, 0.70, 1.00, 1.20, 1.40, 1.625, 2.00]`.
- Nouvelle fonction `modalDividendRecurrentSettings()` : garde (type Dividende + benchmark actif requis,
  sinon alerte et sortie immédiate) ; `baseBenchmark` = fondation si `dividendRecurrentNeedsReset`, sinon
  benchmark courant (n'affecte que l'AFFICHAGE avant confirmation) ; curseur `#mDivTier` (1-7, défaut 3),
  case `#mDivAutoPayChk`, aperçu en direct (`$/part`, coût total) recalculé à chaque déplacement du curseur
  sans aucun effet d'état ; à la confirmation seulement : reset au benchmark de fondation UNIQUEMENT si la
  case se retrouve cochée ET qu'une réactivation était en attente, pose `dividendAutoPay`, puis — SEULEMENT
  si la case est cochée — construit le montant fictif au palier choisi et le passe à
  `applyDividendGaugeTier` (inchangée).
- Bouton « 🔁 Dividende récurrent » (`renderEntreprise`) remplace l'ancienne case à cocher
  `#dividendAutoPayToggle`, ouvre le nouveau popup ; `bindTabEvents` mis à jour en conséquence.

**Nouveau fichier de test** : `smoke_test_step243_dividend_recurrent_gauge.js` (43 assertions) — fondation/
migration des nouveaux champs (A), la déclaration manuelle n'affecte plus AUCUNEMENT le sac type ni le
benchmark, même pour un montant extrême (B), round-trip complet des 7 paliers à travers
`applyDividendGaugeTier` (C), `modalDividendRecurrentSettings` de bout en bout via le mock DOM — palier 3
par défaut (aucun changement), palier 5 (recentrage + cubes), bac à sable (curseur déplacé puis Annuler =
aucun effet), décocher (aucun effet sur cubes/benchmark peu importe le curseur), garde sur un type
non-Dividende (D), suspension + réactivation — le choc pose le drapeau sans toucher au benchmark courant,
l'aperçu pendant la suspension utilise la fondation, décliner la réactivation ne change rien, réactiver reset
le benchmark à la fondation SANS toucher aux cubes (E).

**2 défauts du harnais de test (mock DOM) détectés et corrigés pendant l'écriture de ce fichier — aucun bug
de production** :
- Le mock DOM ne parse jamais la chaîne HTML passée à `openModal` en éléments individuels ; l'attribut
  `value="3"` du curseur (défaut réel dans un vrai navigateur) restait donc sur sa valeur vide par défaut du
  mock tant que le test ne le réglait pas explicitement, faisant retomber `parseInt('',10)` sur `NaN` puis,
  via `dividendGaugeTierFor`, sur le palier 7 par défaut (aucune comparaison numérique n'étant vraie avec
  `NaN`) — corrompant le benchmark en cascade pour tous les tests suivants sur la même compagnie (chacun
  déclenchant ensuite la garde « pas de benchmark actif » du popup, silencieusement). Corrigé en réglant
  explicitement `#mDivTier` à `'3'` avant toute confirmation qui dépend du défaut visuel.
- `modalDividendRecurrentSettings` écrit l'aperçu via `.textContent` (comme les autres modales du projet),
  mais le test lisait `.innerHTML` (toujours vide, puisque jamais écrit par ce chemin) — corrigé pour lire
  `.textContent`, et l'aperçu INITIAL (avant toute interaction) est désormais explicitement obtenu en
  réglant le curseur à son défaut puis en déclenchant l'évènement `input`, pour reproduire fidèlement
  l'affichage initial d'un vrai navigateur.

Suite complète relancée à répétition (169 scripts au total, 4 passes complètes consécutives) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html`
identiques (`diff` vide).

**Non fait dans cette section** — explicitement différé, comme convenu (méthode identique aux sections
240/241/242) : Momentum (son propre mécanisme de sac type). À reprendre dans une prochaine section.

## 244. Moteur boursier — sac type Croissance, Axe 2 remplacé par « battu/atteint/manqué l'espérance des analystes »

### Origine

Immédiatement après la livraison de la section 243 (dividende récurrent), avant même d'entamer Momentum
(dont la discussion était sur le point de commencer) :

> « avant de faire momentum je veux modifier croissance. Au lieu de l'axe des revenus mettre est-ce tu as
> battu les prediction de l'analyse arrive en dessous ou atteint après on jase momentum »

L'assistant a proposé de réutiliser TEL QUEL le mécanisme existant « espérance de bénéfice net des
analystes » (`companyExpectedNetIncome`, sections 194/210) plutôt que d'inventer un nouveau calcul, avec un
écart normalisé par le chiffre d'affaires (même normalisation que la 1ère version, pré-section-210, de la
vérification (7)) et une zone de tolérance ±5 % autour de 0 pour distinguer « atteint » (neutre) de
« battu »/« en dessous », l'égalité exacte étant quasiment impossible en pratique. Approuvé sans
modification :

> « go »

### Conception retenue

**REMPLACE ENTIÈREMENT l'ancien Axe 2** du sac type Croissance (section 242 : croissance de revenu de cette
compagnie vs seuils fixes ±20 %/-10 %, `croissanceRevenueAxis`/`semGrowthById`, tous deux RETIRÉS). L'Axe 1
(percentile de la marge nette parmi toutes les compagnies actives, seuils par profil) et la matrice 3×3
elle-même (les 9 compositions de cubes, chacune sommant à 20) ne changent PAS — seule la source de l'Axe 2
change.

**Nouvel Axe 2 — `croissanceAnalystAxis(is, expectation)`** : réutilise `companyExpectedNetIncome` (déjà
utilisée par la vérification (7) universelle, section 194/210) — aucun nouveau calcul d'espérance.
`devPct = (bénéfice net réel - espérance) / chiffre d'affaires du semestre`. Zone de tolérance symétrique
`CROISSANCE_ANALYST_TOLERANCE_PCT = 0,05` (±5 %) : `devPct > +5%` → BON (battu), `devPct < -5%` → MAUVAIS
(en dessous), entre les deux bornes INCLUSES → NEUTRE (atteint). Retourne `null` (sac type INCHANGÉ ce
semestre) si le chiffre d'affaires du semestre est nul — un écart en % du chiffre d'affaires n'aurait alors
aucun sens, même garde que l'ancienne version (pré-section-210) de la vérification (7).

**Changement de comportement assumé, conséquence directe de la réutilisation « telle quelle »** :
`companyExpectedNetIncome` retourne désormais TOUJOURS une espérance valide dès le 1er semestre d'une
compagnie (bootstrap 0 $ puis 2 M$, correctif de la section 210) — l'Axe 2 est donc quasiment TOUJOURS
calculable, y compris au tout premier semestre d'existence d'une compagnie Croissance. C'est un changement
par rapport à l'ancien Axe 2 (croissance de revenu), qui sautait systématiquement les 2 premiers semestres
faute d'historique. Seul cas restant où l'Axe 2 est sauté : chiffre d'affaires nul ce semestre précis. Ce
n'est pas un point explicitement discuté avec l'utilisateur — une conséquence prévisible et acceptée de
« réutiliser telle quelle » l'espérance des analystes, documentée ici pour mémoire plutôt que ré-confirmée.

### Implémentation

`script_extracted.js` :
- Pré-calcul `semGrowthById` (section 160, devenu orphelin) RETIRÉ de `advanceGameClock` — plus aucun
  consommateur (l'ancien check (6) était déjà retiré à la section 242 ; le seul consommateur restant, l'Axe
  2 de Croissance, est lui-même remplacé ici).
- Bloc Croissance d'`advanceGameClock` : `croissanceRevenueAxis(semGrowthById[co.id])` remplacé par un appel
  direct à `incomeStatementFor`/`companyExpectedNetIncome` pour le semestre courant, passés à
  `croissanceAnalystAxis`.
- Nouvelle constante `CROISSANCE_ANALYST_TOLERANCE_PCT = 0.05` et nouvelle fonction
  `croissanceAnalystAxis(is, expectation)` (remplace `croissanceRevenueAxis`, RETIRÉE).
- `croissanceTypeMatrix(marginAxis, analystAxis)` : paramètre renommé pour clarté (la matrice
  `CROISSANCE_TYPE_MATRIX` elle-même est INCHANGÉE — voir section 242).
- Commentaire orphelin dans `marketAveragePriceSeries` (référençait `semGrowthById` par analogie) ajusté
  pour ne plus pointer vers du code retiré.

**Fichier de test existant retravaillé** : `smoke_test_step242_type_bag_croissance.js` — la partie (D)
(tests directs de `croissanceRevenueAxis`) et la partie (G) (mécanisme complet de bout en bout, dont le
scénario reposait sur la croissance de revenu) sont retirées avec des commentaires pointant vers le nouveau
fichier ; les parties (A)/(B)/(C)/(E)/(F)/(H), non affectées par ce changement (Axe 1, matrice, réversion-
au-tirage, retrait de l'ancien check (6)), restent inchangées et continuent de passer.

**Nouveau fichier de test** : `smoke_test_step244_croissance_analyst_axis.js` (21 assertions) —
`croissanceAnalystAxis` : bornes EXACTES de la zone de tolérance (±5 %, y compris `devPct=0` exactement),
sauté si chiffre d'affaires nul, gardes défensives (chiffre d'affaires négatif, aucune espérance) (D) ;
mécanisme complet de bout en bout via `advanceGameClock` réel — démontre explicitement que l'Axe 2 n'est
PLUS sauté au 1er semestre d'une compagnie (contrairement à l'ancien mécanisme), cellule BON/BON puis
MAUVAIS/MAUVAIS sur la MÊME compagnie (écrasement complet, « photo »), sauté si chiffre d'affaires nul ce
semestre, sauté si une seule compagnie active (Axe 1 impossible) (G) ; garde de régression au niveau du
code source confirmant le retrait effectif de `croissanceRevenueAxis`/`semGrowthById` et l'existence du
nouveau mécanisme (H).

Suite complète relancée à répétition (170 scripts au total, 4 passes complètes consécutives) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html`
identiques (`diff` vide).

**Non fait dans cette section** — comme demandé explicitement par l'utilisateur (« après on jase momentum »)
: Momentum (son propre mécanisme de sac type). Discussion prévue immédiatement après la livraison de cette
section.

## 245. Moteur boursier — profil Momentum, refonte complète (répartition des sacs 45/25/30, sac type semestriel, revirement de tendance avec choc de prix) — REMPLACE ENTIÈREMENT l'ancien mécanisme par lancer

### Origine

Immédiatement après la livraison de la section 244 (sac type Croissance), demande détaillée et complète de
l'utilisateur pour Momentum (verbatim, intégral) :

> « Logique pour le profil type Momentum.
> 1. Répartition des sacs
> * Sac Fondamentaux : 45%.
>    * De plus, le sac fondamental n'a pas de bonus ou de spécificité différente des autres types c'est
>      pareil comme le reste outre la proportion.
> * Sac Trading : 25% (au lieu de 15%).
> * Sac Type (Momentum) : 30% (au lieu de 20%).
> Proposer des répartitions alternatives pour optimisation de l'équilibrage si nécessaire.
> 2. Évolution du Sac Type (20 cubes au total)
> La composition du sac évolue chaque semestre selon la tendance nette de l'action :
> * Début de partie (neutre) : 20 cubes blancs.
> * Tendance haussière (semestres consécutifs nets positifs) :
>    1. Semestre +1 : 20 verts
>    2. Semestre +2 : 15 verts, 5 blancs
>    3. Semestre +3 : 10 verts, 10 blancs
>    4. Semestre +4 : 5 verts, 15 blancs
>    5. Semestre +5 et plus : 20 blancs
> * Tendance baissière (semestres consécutifs nets négatifs) : Même échelle dégressive avec des cubes
>   rouges.
> 3. Revirement de tendance (Trend Reversal)
> Si un semestre enregistre un résultat net opposé à la tendance en cours (ex. semestre négatif alors que
> le sac était à 10 verts / 10 blancs) :
> 1. Bascule instantanée : Le sac passe directement à 20 cubes de la couleur opposée (ex. 20 rouges).
> 2. Impact immédiat : Application d'un pourcentage d'ajustement direct sur le prix de l'action (Stock
>    Price).
> Livrables demandés :
> 1. Modéliser la logique sous forme de règles précises ou d'algorithme/code si pertinent.
> 2. Proposer 2 à 3 options de pourcentage pour l'impact immédiat sur le prix lors d'un revirement.
> 3. Évaluer l'équilibre de la répartition des sacs (25% Trading / 30% Type).
> 4. Garde en tête qu'après un revirement le point de base est le prix de l'action APRÈS l'impact
>    immédiat »

L'assistant a proposé un algorithme unifié continuation/revirement (voir Implémentation), 2-3 options de
choc de revirement (dont une progression proportionnelle au streak brisé, 3%→15%), une alternative plus
conservatrice 50/20/30 pour la répartition des sacs, et confirmé le point 4 (base = prix après impact).
L'utilisateur a répondu avec 5 points de clarification (verbatim, intégral) :

> « 1) Ne touche pas à la répartition du sac trading, mais pour le sac type je crois qu'il faut
> l'augmenter à 30% au lieu de 20%
> 2) Flottement à zéro mouvement je suis d'accord
> 3) pour ta question sur les fondamentaux oui exactement pareil
> 4) Proportionnel tendance brisé par contre le range de 0% à 12% selon le streak un revirement rapide
> 5) Assure toi qu'il n'y ait pas de double bonus au sein de fondamentaux il doit être identique aux
> autres »

Point 1 rejette l'alternative conservatrice 50/20/30 proposée par l'assistant et confirme la répartition
45/25/30 de la demande initiale. Point 4 corrige la progression proposée (3%→15%) vers 0%→12%. Le point 5,
ambigu sur sa portée exacte (uniquement les checks (2)/(3) affaiblis du groupe A, ou l'ensemble du
mécanisme par lancer de la section 160 ?), a fait l'objet d'une clarification directe (`AskUserQuestion`).
Réponse, décisive et sans ambiguïté (verbatim, intégral) :

> « Tout ce qui a été fait avant pour momentum doit être remplacé par ce qui est ci-haut »

Cette réponse tranche définitivement : ce n'est pas seulement les checks (2)/(3) qui perdent leur réduction
spéciale, c'est **tout l'ancien mécanisme de tendance par lancer** (section 160 — `momDirStreak`/
`momLastDir`, le crochet Groupe B par lancer dans `advanceGameClock`, `isMomentumReversalDraw`,
`STOCK_MOMENTUM_CRASH_STREAK`, `STOCK_REVERSAL_MOVE_DIST`, les entrées Momentum dédiées de
`STOCK_TYPE_RESERVE`/`STOCK_TYPE_MOVE_DIST`) qui disparaît, remplacé intégralement par le nouveau mécanisme
semestriel décrit ci-dessous.

### Conception retenue

**1. Répartition des sacs (`STOCK_SLICE_PCT_BY_TYPE`)** — la constante unique `FUNDAMENTAL_SLICE_TARGET_PCT`/
`TRADING_SLICE_MAX_PCT`/`TYPE_SLICE_MAX_PCT` (section 241, appliquée identiquement aux 4 types) devient une
table **par type**. Momentum seul diverge : fondamental 45%, trading 25% (au lieu de 15%), type 30% (au
lieu de 20%). Les 3 autres types (Dividende/Croissance/GARP) gardent la répartition d'origine 65/15/20.
Aucun bonus ni traitement distinct sur le fondamental de Momentum (verbatim, point 5 de la clarification :
« il n'y ait pas de double bonus au sein de fondamentaux il doit être identique aux autres ») — la SEULE
spécificité de Momentum est cette répartition (45/25/30) et le nouveau sac type semestriel lui-même.

Équilibrage évalué (ratio d'emprunt réel = part empruntée / total fondamental, à réserves disponibles
suffisantes, avant plafonnement) :
- Momentum : trading ≈ 25%/45% ≈ **0,56×** le fondamental ; type ≈ 30%/45% ≈ **0,67×**.
- Les 3 autres types : trading ≈ 15%/65% ≈ **0,23×** ; type ≈ 20%/65% ≈ **0,31×**.

Momentum emprunte donc environ 2,4× plus (en proportion du fondamental) au trading et au sac type que les
3 autres types combinés — cohérent avec son identité (volatilité/tendance amplifiée), le fondamental
restant toujours l'ancre dominante (45% > 25% > 30%, aucune des 2 réserves empruntées ne dépasse jamais le
fondamental lui-même).

**2. Sac type semestriel (`MOMENTUM_TREND_TABLE`)** — comme GARP/Croissance (sections 241/242), une
« photo » complète réinitialisée à CHAQUE semestre (jamais de réversion-au-tirage — voir
`TYPE_RESERVE_SNAPSHOT_TYPES`, qui gagne `'momentum'`). Compare le prix courant (`co.stockPrice`) au prix de
référence (`co.momentumRefPrice`) :
- Prix inchangé (flottement) : « ne compte ni pour ni contre, rien ne change » (verbatim, point 2) — ni le
  streak, ni la direction, ni le sac ne bougent.
- Sinon, la direction (hausse/baisse) prolonge la tendance en cours (`momentumTrendStreak+1`, plafonné à 5
  pour la table) ou la brise (direction opposée).
- Continuation : table symétrique haut/bas, exactement comme demandé (streak 1→20 couleur, 2→15/5, 3→10/10,
  4→5/15, 5+→20 blanc).

**3. Revirement de tendance** — bascule INSTANTANÉE à 20 cubes de la couleur opposée (verbatim : « Bascule
instantanée ») ET choc de prix immédiat (`MOMENTUM_REVERSAL_SHOCK_PCT`), dont l'ampleur dépend du streak
ROMPU (la tendance qui vient d'être brisée) : progression LINÉAIRE de 0% (streak=1, « un revirement
rapide » — tendance à peine amorcée) à 12% (streak=5+, tendance solidement établie), par pas de 3% —
`[null, 0, 0.03, 0.06, 0.09, 0.12]` pour streak 1 à 5 (verbatim, point 4 de la clarification : « Proportionnel
tendance brisé par contre le range de 0% à 12% selon le streak un revirement rapide »). Le nouveau streak
repart à 1 (le revirement lui-même compte comme le 1er semestre de la nouvelle tendance).

**4. Point de base après un revirement** — `co.momentumRefPrice` est réassigné au prix APRÈS l'éventuel choc
(jamais avant) : « après un revirement le point de base est le prix de l'action APRÈS l'impact immédiat »
(verbatim, point 4 de la demande initiale). En continuation (sans revirement), `momentumRefPrice` suit
simplement le prix courant à chaque semestre — pas de choc, donc pas de distinction avant/après.

**5. Retrait complet de l'ancien mécanisme** — suite à « Tout ce qui a été fait avant pour momentum doit
être remplacé par ce qui est ci-haut » : le crochet Groupe B par lancer (`priceBeforeRoll`,
`momDirStreak`/`momLastDir`, injection bonus/crash dans `stockReserve`) disparaît intégralement ;
`isMomentumReversalDraw`/`STOCK_MOMENTUM_CRASH_STREAK`/`STOCK_REVERSAL_MOVE_DIST` disparaissent ; les checks
(2) (« revenus vs dépenses ») et (3) (« équité T1 vs T0 ») du groupe A, auparavant réduits pour Momentum
(0-1 cube au lieu de 1-2), redeviennent standards (identiques à Dividende/GARP — verbatim, point 3 de la
clarification : « pour ta question sur les fondamentaux oui exactement pareil ») ; les entrées Momentum
dédiées de `STOCK_TYPE_RESERVE` (`{green:8,red:8,white:14}`) et `STOCK_TYPE_MOVE_DIST`
(`[[0.02,0.30],[0.03,0.30],[0.04,0.20],[0.07,0.20]]`) disparaissent, Momentum retombant sur le repli `.garp`
déjà prévu par le code appelant — exactement comme n'importe quel type qui n'aurait jamais eu d'entrée
propre.

### Implémentation

`script_extracted.js` :
- `TYPE_RESERVE_SNAPSHOT_TYPES` : `'momentum'` ajouté (`new Set(['garp', 'croissance', 'momentum'])`).
- Nouvelles constantes `MOMENTUM_TREND_TABLE` (table haut/bas × streak 1-5) et `MOMENTUM_REVERSAL_SHOCK_PCT`
  (`[null, 0, 0.03, 0.06, 0.09, 0.12]`), nouvelle fonction `momentumTrendStep(co)` — appelée dans le bloc
  Groupe A d'`advanceGameClock` (`if(co.type==='momentum') momentumTrendStep(co);`), au même endroit que les
  blocs GARP/Croissance.
- `STOCK_SLICE_PCT_BY_TYPE` (nouvelle table par type, remplace les 3 constantes globales
  `FUNDAMENTAL_SLICE_TARGET_PCT`/`TRADING_SLICE_MAX_PCT`/`TYPE_SLICE_MAX_PCT` de la section 241) —
  `drawStockCubes` calcule désormais `toBorrowTrading`/`toBorrowType` à partir de
  `STOCK_SLICE_PCT_BY_TYPE[company.type] || STOCK_SLICE_PCT_BY_TYPE.garp` au lieu des 3 constantes globales.
- Crochet Groupe B par lancer RETIRÉ d'`advanceGameClock` (`priceBeforeRoll`, `momDirStreak`/`momLastDir`,
  bonus/crash) — remplacé par un commentaire de retrait citant la demande utilisateur.
- Checks (2)/(3) du groupe A : ternaires `co.type==='momentum' ? ... : STOCK_TRIGGER_LEVEL_MIN/MAX` retirés
  — chemin unique standard pour Momentum/Dividende/GARP (Croissance garde sa propre branche, section 242).
- `isMomentumReversalDraw` (fonction) et son site d'appel dans `resolveStockDraws` RETIRÉS ; `else if`
  orphelin qui suivait corrigé en `if` simple.
- `STOCK_REVERSAL_MOVE_DIST` et `STOCK_MOMENTUM_CRASH_STREAK` (constantes) RETIRÉES.
- Entrées `momentum` de `STOCK_TYPE_RESERVE` et `STOCK_TYPE_MOVE_DIST` RETIRÉES (repli `.garp` déjà prévu
  par le code appelant).
- `createCompany` : `company.momLastDir`/`company.momDirStreak` RETIRÉS, remplacés par
  `company.momentumRefPrice = founderStockPrice` (pour `type==='momentum'`) — `momentumTrendDir`/
  `momentumTrendStreak` volontairement ABSENTS à la fondation (undefined/0 par défaut, même composition
  neutre que 20 blancs).
- `migrateState` : `co.momLastDir`/`co.momDirStreak` RETIRÉS, remplacés par un repli
  `if(co.type==='momentum' && co.momentumRefPrice===undefined) co.momentumRefPrice = co.stockPrice;` (prix
  COURANT — aucun historique de fondation fiable à reconstruire pour une vieille sauvegarde, même compromis
  que `dividendBenchmarkFounding`, section 243).

**Régression corrigée dans les tests existants** (identifiants retirés, retrouvés par grep exhaustif sur
toute la suite) :
- `smoke_test_step178_last_resort_loan_and_gameend.js` : ligne neutralisant `momDirStreak`/`momLastDir`
  (devenue sans objet) remplacée par un commentaire.
- `smoke_test_step193_stock_cube_floor.js` : `STOCK_TYPE_RESERVE[type]` direct (sans repli) aurait planté
  pour `'momentum'` — corrigé en `STOCK_TYPE_RESERVE[type] || STOCK_TYPE_RESERVE.garp`, comme le code réel.
- `smoke_test_step240_trading_vs_fundamental.js` : commentaire mettant à jour la référence à
  `FUNDAMENTAL_SLICE_TARGET_PCT` (retirée) vers `STOCK_SLICE_PCT_BY_TYPE.garp.fundamental` — aucun impact
  sur le calcul lui-même (ce test n'utilise que le type `'garp'`, INCHANGÉ à 65/15/20).
- `smoke_test_step242_type_bag_croissance.js` : garde de régression (H) sur `TYPE_RESERVE_SNAPSHOT_TYPES`
  exigeait un `Set` à EXACTEMENT 2 éléments (`['garp', 'croissance']`) — assouplie pour exiger seulement que
  `'croissance'` en fasse toujours partie (Momentum a rejoint ce même `Set`).
- `smoke_test_step191_dividend_type_specific_streak.js` : les checks (2)/(3), désormais standards pour
  Momentum (au lieu de réduits 0-1), contribuent chacun un cube supplémentaire dans la fourchette [1,2]
  quand ils se déclenchent — décomptes attendus (A) mis à jour de +1 (revenu≠dépense à chaque semestre
  testé) pour refléter ce changement de comportement ASSUMÉ (conséquence directe du point 3/de la directive
  de remplacement complet), pas une régression.

**Nouveau fichier de test** : `smoke_test_step245_momentum_type_bag.js` (46 assertions) — `momentumTrendStep`
testée directement : flottement sans effet (A), continuation de tendance haut/bas avec table exacte à
chaque palier et plafond à 5 (B), revirement (bascule instantanée + choc exact selon le streak rompu,
nouveau streak=1, `momentumRefPrice` = prix après choc) dans les 2 sens (C) ; `createCompany`/`migrateState`
(D) ; `TYPE_RESERVE_SNAPSHOT_TYPES` inclut désormais Momentum, aucune réversion-au-tirage (E) ;
`STOCK_SLICE_PCT_BY_TYPE` — répartition 45/25/30 exclusive à Momentum, vérifiée directement via
`drawStockCubes` (F) ; garde de régression au niveau du code source confirmant le retrait de TOUS les
identifiants de l'ancien mécanisme et l'existence des nouveaux (G) ; mécanisme complet de bout en bout via
`advanceGameClock` réel, avec un espion sur `momentumTrendStep` pour vérifier l'invariant exact du point 4
sans être perturbé par le tirage boursier du même lancer, qui continue de faire bouger le prix APRÈS que
`momentumRefPrice` ait été posé — même comportement d'ordonnancement que GARP/Croissance (H).

Suite complète relancée à répétition (171 scripts au total, 3 passes complètes consécutives) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`/`monopolybourse.html`
identiques (`diff` vide).

## 246. Livraison — désormais 2 variantes de chaque fichier HTML (commentée + « légère », sans commentaires)

### Origine

Immédiatement après la livraison de la section 245, demande explicite de l'utilisateur sur le processus de
livraison lui-même (verbatim, intégral) :

> « Parfait peux-tu me sortir doréavant un fichier sans commentaire et un avec. Celui avec est pour toi si
> d'autres modifications et le sans pour le mettre en ligne qu'il soit plus léger »

### Conception retenue

Décision de PROCESSUS (pas de mécanique de jeu) — s'applique à TOUTE livraison future, pas seulement à
cette section. À chaque synchronisation (`python3 sync_script.py`), 2 PAIRES de fichiers sont désormais
produites au lieu d'une :
- **`index.html`/`monopolybourse.html`** (INCHANGÉS) — copie de travail COMMENTÉE, pour toute modification
  future (c'est `script_extracted.js`, avec tous ses commentaires de conception/historique, qui reste la
  SEULE source de vérité pour le développement et les tests).
- **`index_leger.html`/`monopolybourse_leger.html`** (NOUVEAU) — copie SANS commentaires, plus légère,
  destinée à être mise en ligne (hébergement/déploiement).

Le retrait des commentaires (`strip_comments.js`, nouveau script) passe par un VRAI parseur JS (`acorn`,
déjà présent dans l'environnement — `/opt/node-tools/node_modules/acorn`), jamais par une regex : une regex
naïve sur `//`/`/* */` risquerait de confondre ces séquences avec du texte à l'intérieur d'une chaîne, d'un
template literal ou d'un littéral regex (le fichier en contient — ex. `.replace(/[.#$\[\]/]/g, '_')`).
`acorn.parse(..., {onComment})` fournit la position EXACTE de chaque commentaire réel (5525 sur le fichier
actuel, ~783 000 caractères — plus de la moitié du fichier), retirée du texte source d'origine SANS toucher
au reste (aucune reformulation, aucun changement de mise en forme du code lui-même) — réduction observée
d'environ 1,47 Mo à 687 Ko pour `script_extracted.js` (~53%).

**Les fichiers légers ne sont JAMAIS utilisés pour les tests.** Vérification faite en pointant
temporairement toute la suite de smoke tests vers la version sans commentaires : 168/171 passent
(comportement identique) ; les 3 échecs restants (`smoke_test_step30_remove_terrains_tab.js`,
`smoke_test_step6c_entreprise_reorg.js`, `smoke_test_step242_type_bag_croissance.js`) sont dus à des gardes
de régression PRÉ-EXISTANTES qui recherchent un texte de COMMENTAIRE précis dans le source pour délimiter
une zone de code (ex. `scriptSrc.indexOf("bloc bindTabEvents t==='assurances' retiré")`) — une fragilité de
CES tests, déjà présente avant cette section, pas une conséquence du retrait des commentaires ni un
changement de comportement réel du moteur. La version originale (`script_extracted.js`, commentée) reste
donc la SEULE cible de test, comme avant — la version légère est un simple sous-produit de livraison,
jamais retestée séparément une fois la version commentée validée.

### Implémentation

- **`strip_comments.js`** (nouveau) : `node strip_comments.js <entrée.js> <sortie.js>` — parse avec `acorn`
  (`ecmaVersion:'latest'`), collecte les plages `[start,end]` de chaque commentaire via `onComment`, les
  retire du texte source par ordre décroissant de position (pour que les indices déjà traités restent
  valides), écrit le résultat.
- **`sync_script.py`** (modifié) : après la synchronisation habituelle de `index.html`/`monopolybourse.html`
  (INCHANGÉE), appelle `strip_comments.js` sur `script_extracted.js` (produit
  `script_extracted.nocomments.js`, fichier intermédiaire jetable) puis réinjecte ce contenu dans le MÊME
  bloc `<script>` (2e balise inline, config Firebase toujours préservée) d'une copie de `index.html`
  DÉJÀ synchronisée, pour produire `index_leger.html`/`monopolybourse_leger.html`.

Vérifications : `node -c` sur `script_extracted.nocomments.js` (syntaxe valide) ; suite complète pointée
temporairement vers la version sans commentaires (168/171, écarts expliqués ci-dessus, AUCUNE régression de
comportement) ; `script_extracted.js` (la copie de travail commentée) confirmé BYTE-À-BYTE inchangé après
toute cette manipulation (`diff` vide contre une sauvegarde prise avant) ; suite complète RELANCÉE contre la
version commentée normale après restauration : **171/171, 0 échec** ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

**À partir de cette section**, chaque livraison future inclut donc les 4 fichiers (2 commentés + 2 légers),
sans qu'il soit nécessaire de le redemander.

## 247. Retrait complet de l'onglet « Simulation »

### Origine

Demande explicite de l'utilisateur, verbatim, intégral :

> « tu peux enlever l'onglet simulation »

### Conception retenue

Retrait pur et simple — contrairement au retrait de l'onglet « Résumé » (section 112), **aucun contenu**
de cet onglet n'est relogé ailleurs : c'était un outil de test/calibration isolé (section 147 — « Possible
de faire une simulation ou un onglet simulation rapidement après des test je trouve que l'action de les
entreprises en croissance explose beaucoup plus que les autres »), qui simulait des compagnies FICTIVES en
mémoire pure, jamais `state.companies`/quoi que ce soit de la partie en cours — sans équivalent joueur à
préserver.

### Implémentation

`script_extracted.js` :
- `visibleTabs()` : `if(myPlayerId===state.creatorId) tabs.push('simulation');` (et son commentaire de
  section 147/171) retiré.
- `tabLabel(t)` : entrée `simulation:'Simulation'` retirée de l'objet.
- `renderTab(t)` : `if(t==='simulation') return renderSimulation();` retiré.
- `bindTabEvents(t)` : bloc `if(t==='simulation'){...}` (lecture du formulaire, bindings `#simRunBtn`/
  `#simResetBtn`) retiré.
- Bloc module dédié retiré EN ENTIER (commentaire de section + code) : `simParams`/`simResults` (variables
  de module), `simDefaultParams()`, `simulateOneCompany(type, p)`, `runStockSimulation(p)`,
  `simFmtIndex(n)`, `renderSimulation()` — 192 lignes.
- Aucun champ de `state`/`state.settings` à nettoyer (`simParams`/`simResults` n'ont jamais été persistés
  ni synchronisés entre appareils — variables de module pures, comme `portefeuilleOptionsCompanyId`
  ailleurs) — aucune migration nécessaire pour les parties déjà en cours.
- Helpers PARTAGÉS consommés par cet onglet (`STOCK_TYPE_RESERVE`, `STOCK_TYPE_MOVE_DIST`,
  `expectedMovePct`, `pickWeighted`, `svgLineChart`, `tvChartLegend`, `COMPANY_TYPES`,
  `COMPANY_TYPE_COLORS`) laissés INTACTS — utilisés ailleurs par le moteur réel, jamais dédiés à cet onglet
  seul (vérifié par grep exhaustif et par la garde de non-régression (e) du nouveau fichier de test).
- Fallback `activeTab` (`render()`, `if(!tabs.includes(activeTab)) activeTab = 'portefeuille';`) déjà
  inchangé — 'simulation' n'a jamais été le repli par défaut (contrairement à 'resume' à la section 112),
  aucune modification nécessaire à ce mécanisme lui-même.

**Fichier de test dédié retiré** : `smoke_test_step60_simulation_tab.js` (test d'origine de la
fonctionnalité elle-même, entièrement obsolète — aucune partie à adapter, contrairement au précédent de la
section 112 où « Cases hostiles » survivait ailleurs).

**Nouveau fichier de test** : `smoke_test_step247_remove_simulation_tab.js` (27 assertions) — même
convention que `smoke_test_step32_remove_resume_tab.js`/`smoke_test_step30_remove_terrains_tab.js` :
`visibleTabs()`/`tabLabel`/`renderTab` ne renvoient plus rien pour 'simulation', pour le créateur ET pour
un non-créateur (a) ; toutes les fonctions/variables dédiées n'existent plus DU TOUT comme globales,
appeler `renderSimulation()` lève une `ReferenceError` précise (b) ; gardes de régression au niveau du
source confirmant la disparition de chaque point d'accroche (nav, dispatch, label, bindings, déclarations
de fonctions/variables) (c) ; le fallback `activeTab` bascule bien vers 'portefeuille' si jamais réglé sur
'simulation' (ex. vieille sauvegarde locale d'un créateur) (d) ; non-régression — les 8 helpers partagés
listés ci-dessus existent toujours (e).

**Adaptations sur des tests préexistants** (2 scripts, aucune assertion de comportement réel perdue) :
- `smoke_test_step171_ui_polish_batch.js` : assertion (9) sur l'ordre exact des onglets — `'simulation'`
  retiré du tableau attendu (`['portefeuille','entreprise','etf','admin','lexique']`).
- `smoke_test_step232_distinct_chart_colors.js` : assertion (E) (« le simulateur utilise
  `COMPANY_TYPE_COLORS` ») retirée avec un commentaire pointant vers cette section — les 4 autres
  vérifications de ce fichier (A/B/C/D/F), sur les VRAIS consommateurs de `COMPANY_TYPE_COLORS`/
  `MARKET_ACCENT_COLOR` (graphique d'indices, camembert sectoriel, comparateur de cours), sont inchangées
  et continuent de passer.

Suite complète relancée à répétition (171 scripts au total — un fichier retiré, un fichier ajouté, 3 passes
complètes consécutives) : **0 échec**. `node -c script_extracted.js`. `python3 sync_script.py` exécuté (voir
section 246 — produit désormais aussi les variantes légères) ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 248. Écran de fin de partie — 3e classement « flavor » : les 5 indices (marché + 4 secteurs)

### Origine

Demande explicite de l'utilisateur, verbatim, intégral :

> « peux tu mettre dans le classement final en fin de partie les Index pour flavor 😉 voir si les joueurs
> aurait battu l'investissement passifs mettre les 5 chaque type et marché »

### Conception retenue

Même esprit et même emplacement (« en dessous ») que le classement d'équité des entreprises déjà ajouté en
« flavor » à la section 182 — `renderGameEndedScreen()` gagne une **3e table**, juste après celle des
entreprises et juste avant le lien « consulter quand même les onglets ».

Aucun nouveau calcul introduit : réutilise TEL QUEL l'infrastructure de la section 228
(`NET_WORTH_INDEX_DEFS` et `equalWeightIndexNetWorthSeries`), déjà éprouvée par le comparateur de courbe de
Mon Portefeuille. Pour chaque joueur, dans le même ordre que le classement des actifs ci-dessus
(comparaison ligne par ligne directe), la table affiche la valeur FINALE (dernier point) de la série « et
si j'avais plutôt investi à part égale dans CE secteur (ou dans le marché entier pour MRKT), sans aucune
autre action » — cette série est elle-même ancrée à la vraie valeur nette du joueur au moment où ce secteur
a commencé à exister (voir le commentaire de la section 228 : pas nécessairement le tout début de partie,
si aucune compagnie de ce type n'existait encore à ce moment).

Convention couleur : vert (`#047857`) si le joueur a RÉELLEMENT fait mieux en jouant activement (ses actifs
finaux réels ≥ cette valeur indicielle) que s'il avait simplement laissé son argent suivre l'indice, rouge
(`var(--brick)`) sinon (a « perdu » contre l'indice passif) — même palette que le reste de l'app. Cellule
« — » (grisée, `var(--muted)`) si l'indice n'a jamais eu la moindre donnée pour ce joueur, c'est-à-dire
qu'aucune compagnie de ce type/secteur n'a jamais existé dans cette partie (série vide retournée par
`equalWeightIndexNetWorthSeries`).

### Implémentation

`script_extracted.js`, dans `renderGameEndedScreen()` :
- `flavorIndexRows` : pour chaque ligne du classement déjà calculé (`ranking`), calcule pour chacun des 5
  `NET_WORTH_INDEX_DEFS` l'ensemble de compagnies du secteur (`def.types===null` → toutes les compagnies
  pour MRKT, sinon filtre par type), appelle `equalWeightIndexNetWorthSeries(row.p, companies)`, et rend
  une cellule « — » si la série est vide ou la valeur finale formatée avec la couleur vert/rouge selon
  `row.nw >= indexFinal`.
- `flavorIndexHeaderCells` : les 5 en-têtes `<th>`, un par ticker (`MRKT`/`DIVD`/`MMTM`/`BOOM`/`GARP` — le
  `label` de chaque def, déjà un simple ticker depuis la section 230, sans retouche nécessaire).
- Nouveau bloc dans le template `app.innerHTML` : titre de section « 📈 Comme flavor — auriez-vous battu
  l'investissement passif ? », un paragraphe explicatif (`<p class="small">`), puis la table
  (`Joueur`/`Actifs réels (JVM)` + les 5 colonnes d'index).
- La carte englobante (`<div class="card pad" ...>`) passe de `max-width:640px` à `max-width:820px` pour
  accueillir confortablement les 7 colonnes de la nouvelle table sans les compresser — les 2 tables
  existantes (qui ont moins de colonnes) restent inchangées visuellement, juste dans une carte plus large.

**Nouveau fichier de test** : `smoke_test_step248_flavor_index_gameend.js` — 2 joueurs (Henri/Iris), une
compagnie dividende et une compagnie momentum (AUCUNE compagnie croissance/garp dans la partie, pour
couvrir le cas « — »), historiques manuels sur les compagnies et `state.history` (même esprit que le test
de la section 228). Henri reçoit un surplus de cash pour garantir un cas « a battu l'indice » (vert) et
Iris reste pauvre pour garantir un cas « a perdu contre l'indice » (rouge) — les 2 couleurs sont bien
couvertes. Les valeurs « attendues » sont calculées en appelant EXACTEMENT les mêmes fonctions que le code
(`netWorth()`, `equalWeightIndexNetWorthSeries()`) plutôt que rederivées à la main, pour ne dépendre
d'aucune hypothèse sur leur formule interne. Couvre : non-régression des 2 tables existantes (A), présence
du nouveau titre et des 5 en-têtes (B), cellules « — » pour les secteurs sans aucune compagnie (C), valeurs
et couleurs exactes pour les secteurs avec compagnies, y compris les 2 cas vert ET rouge (D), aucun
NaN/undefined (E), non-régression du lien « consulter quand même les onglets » (F).

Suite complète relancée à 3 reprises consécutives (172 scripts au total — un fichier ajouté) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 249. Annonce CEO — pop-up de confirmation à l'exécution, calibrage en parts, « Tout vendre » — et nouvel essai automatique en cas de conflit de sauvegarde

### Origine

Deux demandes explicites de l'utilisateur, verbatim, dans la même conversation :

> « Annoncer la vente de part ou l'achat de part d'un CEO ne semble pas fonctionner. Aussi la calibrer en
> terme de part pas de $, mettre une option tout vendre aussi pour allez plus vite dans le pop-up »

précisée ensuite :

> « Pop-up de confirmation quand l'exécution est fait, LE CEO a vendu ses parts après son délai d'annonce
> ou acheter. Mettre l'option de tout vendre et l'option de vendre par part aussi »

et, séparément :

> « Aussi quand 2 actions sont effectué en même temps seule une s'effectue. Comment on peut améliorer ça »

précisée ensuite :

> « Pour la synchronisation c'est possible d'avoir un queue ou du moins si c'est pas possible de laisser
> le pop-up ouvert avec les choix entrée tant que ça pas fonctionner la soumission »

### Diagnostic (avant toute conception)

L'annonce CEO différée (`modalAnnounceCeoTrade`/`executeCeoAnnouncement`, section 128) n'était PAS cassée
côté logique métier : elle crée bien une entrée dans `state.ceoAnnouncements`, exécutée automatiquement 1
an plus tard par `advanceGameClock`. Le vrai problème : **zéro feedback visuel**, ni à l'annonce (déjà
attendu — elle n'exécute rien), ni surtout À L'EXÉCUTION, 1 an plus tard — le seul indice était une ligne
dans le bandeau d'annonces (sans titre) et une entrée de journal, aucun pop-up. D'où l'impression que
« ça ne semble pas fonctionner ».

Complication propre à ce mécanisme : `executeCeoAnnouncement` tourne à l'intérieur de `advanceGameClock`,
qui peut être déclenché par n'importe quel appareil (convention déjà en place dans tout le jeu — voir
l'étape 5/8) — pas forcément celui du CEO concerné. Un simple `showTransactionPopup()` posé directement
là afficherait le pop-up sur le MAUVAIS appareil la plupart du temps. Précédent trouvé et réutilisé TEL
QUEL : `maybeShowDiceRollTurnPopup`/`seenDiceRollEventRoll` (section 205) résout exactement ce problème
pour le pop-up de tour — un événement écrit dans l'état PARTAGÉ, et une variable LOCALE (jamais
sauvegardée) par appareil qui retient ce qui a déjà été vu, vérifiée à CHAQUE `render()`.

Pour la synchronisation : `saveGame()` (section 164) protège déjà contre l'écrasement silencieux via une
relecture-comparaison avant écriture, mais en cas de conflit elle affiche un `alert()` bloquant et
ABANDONNE l'action locale — l'utilisateur doit tout retaper. Aucune primitive transactionnelle
(compare-and-swap) n'est disponible sur les backends de stockage utilisés (même limite déjà documentée
pour l'enchère ETF, voir `startEtfDutchRound`) — une vraie « queue » côté serveur n'est donc pas possible
avec cette architecture. Le repli proposé par l'utilisateur (garder le pop-up ouvert, réessayer) est en
revanche tout à fait réalisable côté client.

### Conception retenue et implémentation

**1) Pop-up de confirmation à l'exécution** — nouveau `state.ceoAnnouncementExecutions` (créé/migré comme
tout autre journal du jeu), alimenté par `executeCeoAnnouncement` UNIQUEMENT sur une exécution RÉUSSIE
(achat ou vente — jamais sur un blocage par le plafond légal ou un échec, hors du périmètre de cette
demande) : `{id (repris de l'annonce), ceoId, companyId, direction, amount, qty, price, roll, entries}`,
plafonné à 50 éléments. Nouvelle `maybeShowCeoAnnouncementExecutionPopup()` (jumelle exacte de
`maybeShowDiceRollTurnPopup`, appelée juste après elle dans `render()`) : cherche la plus ANCIENNE
exécution appartenant à `myPlayerId` pas encore vue sur CET appareil (`seenCeoAnnouncementExecutionIds`,
un `Set` local plutôt qu'une simple valeur — contrairement au pop-up de tour, plusieurs exécutions
distinctes peuvent s'accumuler entre deux rendus), et l'affiche via `showTransactionPopup` — jamais pour
un autre joueur que ce CEO. Garde anti-clobber ajoutée (absente de `maybeShowDiceRollTurnPopup`, mais
nécessaire ici puisque les deux pop-up peuvent se déclencher à la même passe de rendu) : si un modal est
déjà ouvert au moment de l'appel, ne fait RIEN et ne marque rien comme vu — réessayé (et donc jamais
perdu) au rendu suivant. `seenCeoAnnouncementExecutionIds` est amorcé à la connexion/reconnexion
(`createGame`/`loadGame`) avec les ids déjà présents, pour ne jamais rejouer en pop-up une exécution
antérieure à l'arrivée de cet appareil.

**2) Calibrage en parts + « Tout vendre »** — `modalAnnounceCeoTrade` gagne le MÊME sélecteur d'unité
$/parts que `modalBuySellShares`/`modalShortShares` (section 154), avec la même logique de continuité au
changement d'unité, et un lien « Tout vendre » (visible seulement en direction Vente) qui préremplit le
montant avec la position ACTUELLE du CEO, dans l'unité présentement sélectionnée. `amount` reste stocké en
$ (aucune fonction interne modifiée, conversion faite côté UI au prix courant — exactement le même choix
que la section 154) — note ajoutée dans l'info live et le commentaire de code : comme le prix d'exécution
réel n'est connu que dans 1 an, « Tout vendre » n'est qu'un raccourci pratique pour « la valeur $
d'aujourd'hui », pas une garantie de liquider 100% de la position dans 1 an (le nombre réel de parts
échangées dépend du prix futur — déjà expliqué dans le texte d'intro de la modale).

**3) Nouvel essai automatique en cas de conflit de sauvegarde** — `saveGame()` accepte désormais
`{silent:true}` : en cas de conflit, elle rafraîchit `state`/`lastSerialized` sur la version distante
exactement comme avant, mais SANS `alert()` ni `render()`. Nouvelle `attemptActionWithRetry(applyFn,
{maxAttempts=5, onRetry})` : boucle jusqu'à `maxAttempts` — appelle `applyFn()` (qui doit relire TOUT ce
dont il dépend depuis l'état COURANT, ex. `companyById(id)` plutôt qu'une référence capturée une fois pour
toutes, sans quoi le nouvel essai reproduirait exactement le bug D1 déjà corrigé à la section 164), tente
`saveGame({silent:true})` ; en cas de conflit, réessaie `applyFn()` contre l'état FRAIS que `saveGame` vient
de rapatrier (jamais un simple nouvel essai d'écriture de la mutation périmée). Une erreur MÉTIER
(`{ok:false}` renvoyé par `applyFn`, ex. montant invalide) n'est en revanche JAMAIS réessayée — réessayer ne
la corrigerait pas. Câblée dans `modalAnnounceCeoTrade` (le seul site touché dans cette section — les
autres modales de trading pourront être migrées séparément si l'essai est concluant, esprit « petit pas à
la fois ») : la modale reste ouverte avec les valeurs déjà saisies pendant les essais, le bouton
« Annoncer » est désactivé, un message discret (`#mCeoAnnounceRetryStatus`) informe d'un nouvel essai en
cours — la modale ne se ferme qu'au succès final ou à l'échec définitif (après `maxAttempts` tentatives,
cas extrêmement rare : un autre appareil sauvegarderait en continu).

### Tests

**Nouveau fichier de test** : `smoke_test_step249_ceo_announce_ux_and_retry.js` — 3 groupes. (A)
`state.ceoAnnouncementExecutions` alimenté correctement par une exécution réelle (via
`performRollForAllCompanies`, pas un appel direct) ; le pop-up apparaît pour le CEO concerné et JAMAIS pour
un autre joueur ; ne réapparaît pas au rendu suivant (déjà vu) ; ne clobber jamais un modal déjà ouvert à la
même passe de rendu, et l'événement non affiché n'est jamais perdu (réessayé dès que le modal se libère).
(B) sélecteur d'unité présent, bouton « Tout vendre » cocorrectement montré/caché selon la direction et
préremplissant le bon montant dans les 2 unités ; soumission en unité parts correctement convertie en $ à
la sauvegarde. (C) `attemptActionWithRetry`/`saveGame({silent:true})` : succès direct sans conflit (1 seul
appel) ; en cas de conflit avec un 2e appareil, nouvel essai automatique contre l'état frais — LA mutation
du 2e appareil n'est JAMAIS écrasée (non-régression directe du bug D1, section 164) et AUCUNE alerte
bloquante n'apparaît ; un échec métier ne déclenche jamais de nouvel essai ; épuisement des tentatives
(`storageSet` en échec continu, simulé) respecte exactement `maxAttempts`, sans boucle infinie.

Suite complète relancée à 3 reprises consécutives (173 scripts au total — un fichier ajouté) : **0 échec**.
`node -c script_extracted.js`. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 250. Nouvel essai automatique en cas de conflit de sauvegarde — extension à TOUTES les pop-up de formulaire, et correctif d'un bug de conservation de l'état découvert en cours de route

### Origine

Directive explicite de l'utilisateur, verbatim, prolongeant directement le travail de la section 249 (qui
n'avait câblé le nouvel essai automatique que sur `modalAnnounceCeoTrade`, « le seul site touché dans
cette section — les autres modales de trading pourront être migrées séparément si l'essai est concluant,
esprit "petit pas à la fois" ») :

> « il faut que tu implemente a toutes les pop-up de l'application »

### Méthode

Recensement de toutes les fonctions `function modal...`/`async function modal...` du fichier (45 au
total) et classement en deux groupes : celles à convertir, et celles à exclure avec une raison précise.
Travail découpé en 7 lots (petits groupes de modales apparentées, chacun validé par la suite complète de
tests avant de passer au suivant — même discipline « petit pas à la fois » que le reste du projet) :

1. **Lot 1** — modales d'administration : ajustement joueur/compagnie/banque, achat/vente de parts (avec
   copropriété), rachat de part de lot à la banque.
2. **Lot 2** — maisons/hypothèques : compensation de construction, échange de parts entre entreprises
   (share swap), émission de prêt (formulaire Admin), vente de part de lot fusionné, hypothèque
   (terrain seul et lot).
3. **Lot 3** — libre-service d'entreprise : enchère de maisons, vente de maisons entre entreprises.
4. **Lot 4** — assurances : contrat groupé, assurance d'un seul terrain, assurance sous-standard.
5. **Lot 5** — dividendes/émissions d'actions : annonce de dividende, dividende récurrent, émission/rachat
   d'actions ordinaires, émission/rachat de parts privilégiées, vente/achat de parts privilégiées sur le
   marché secondaire.
6. **Lot 6** — CEO/trading joueur : sortie publique du CEO, prêt de dernier recours, achat/vente
   d'actions, vente à découvert, bons gouvernementaux, nouvelle position d'option, nouvelle stratégie
   d'options.
7. **Lot 7** — prêts/ententes entre entreprises : demande d'emprunt (formulaire CEO), proposition de swap
   de loyers, proposition d'accord de compensation de loyer.

### Conventions de conversion (les deux patrons déjà établis à la section 249, généralisés)

Chaque modale convertie suit l'un de deux patrons, selon que sa logique de mutation vivait déjà dans une
fonction séparée ou directement dans le gestionnaire de clic :

- **Patron délégué** (le plus fréquent) : la fonction séparée (`buildHouse`, `executeShareSwap`,
  `sellMergedShare`, `issueMortgage(Lot)`, `submitHouseBid`, `sellHousesToCompany`, `buySubInsurance`,
  `purchaseInsuranceBundle`, `postLoanRequest`, `proposeRentSwap`, `issuePreferredShares`,
  `callPreferredShares`, `listPreferredSharesForSale`, `buyPreferredSharesFromListing`, `triggerLastResortLoan`,
  et d'autres) gagne un paramètre `opts` et un petit utilitaire local `const fail = (msg)=>{
  if(!opts.silent && msg) alert(msg); return {ok:false, error:msg}; };` — chaque `alert(...); return;`
  devient `return fail(...);`, et le `saveGame()/render()` final est gated par `if(!opts.silent){ await
  saveGame(); render(); }`. Le gestionnaire `#mOk` de la modale appelle alors `runModalActionWithRetry(()=>
  maFonction(...,{silent:true}))`.
- **Patron inline** (quand la mutation vivait directement dans `#mOk`, ex. `modalAnnounceDividend`,
  `modalDividendRecurrentSettings`, `modalPublicCeoStatement`, `modalBuySellShares`, `modalShortShares`,
  `modalBonds`, `modalOptionTrade`, `modalOptionStrategy`) : la logique est déplacée telle quelle dans
  l'`applyFn` passé à `runModalActionWithRetry`, qui **relit tous les objets mutés depuis leur id** à
  chaque tentative (`companyById(companyId)`, `state.players.find(p=>p.id===myPlayerId)`, jamais
  `myCo`/`me`/`co` capturés une seule fois à l'ouverture du modal) — indispensable puisqu'un conflit
  distant remplace l'objet `state` global en entier entre deux essais, laissant toute référence capturée
  orpheline.

`runModalActionWithRetry` (introduite section 249) reste inchangée dans son fonctionnement : désactive
`#mOk`, affiche `#mRetryStatus` pendant les essais, réactive le bouton, alerte sur l'échec final (la
modale reste ouverte, les valeurs saisies intactes) ou ferme le modal + `render()` au succès — chaque
modale convertie gagne donc systématiquement un `<div class="small" id="mRetryStatus">` dans son balisage.

### Deux contrats de retour préservés par exception (fonctions à appelant interne strict)

- **`issueLoan`** (section 249) : reste `true`/`false` — `acceptLoanOffer` la teste avec `if(!ok) return;`,
  et un objet `{ok:false}` serait toujours vrai en JS (`!{}` === `false`), cassant cette garde. Un
  `opts.lastError` (« out-parameter ») permet à son seul appelant converti (`modalIssueLoanAdmin`, section
  249) de reconstruire un `{ok,error}` pour `runModalActionWithRetry`.
- **`proposeRentCompensation`** (cette section) : même raisonnement — reste `true`/`false` (aucun autre
  appelant que `modalProposeCompensation`, mais conservé par cohérence avec le patron `issueLoan` déjà
  établi). Son `fail()` local pose `opts.lastError` ; `modalProposeCompensation` enveloppe l'appel dans un
  petit adaptateur (`const ok = await proposeRentCompensation(...,{silent:true}); return ok?{ok:true}:
  {ok:false, error:opts.lastError};`) avant de le passer à `runModalActionWithRetry`, qui n'accepte jamais
  un booléen brut (`true.ok` vaut `undefined`, lu comme un échec).

Autre ajustement de contrat, sans exception : **`buyPreferredSharesFromListing`** prenait auparavant
l'objet `buyer` (capturé à l'ouverture du modal) — puisque cette fonction MUTE `buyer.cash`, une référence
périmée après un conflit aurait écrit dans un joueur orphelin. Son 2e paramètre est désormais `buyerId`
(relu via `state.players.find` à chaque tentative), son seul appelant (`modalBuyPreferredListing`) mis à
jour en conséquence — ainsi que le smoke test qui l'appelait directement avec un objet joueur.

### Modales explicitement exclues (et pourquoi)

1. **Pilotées par un lancer de dé aléatoire** (`modalForceNextTurn`) — un nouvel essai produirait un
   résultat aléatoire RÉELLEMENT différent, jamais une simple répétition de la même mutation.
2. **`modalQuitGame`** — aucun formulaire, aucun appel à `saveGame()`.
3. **Code mort confirmé** (`modalConfirmPassGo`/`passGo`) — un commentaire existant en tête de fonction
   documente que les deux boutons qui l'appelaient ont été retirés ; zéro écouteur DOM restant nulle part.
4. **Modales de navigation pures** (`modalSellShareCompany`, `modalMortgageCompany`,
   `modalBuildHouseCompany`, `modalBuildHouseSource`) — aucune mutation propre, elles ne font que router
   vers une modale déjà convertie (ou un appel direct exclu par la catégorie suivante).
5. **Action directe en un clic, sans formulaire, rien à préserver au réessai** (`repayMortgage`/
   `repayMortgageLot`, l'appel direct `buildHouse(pid)` quand `houseSource` est désactivé, et — nouveau
   jugement cette section — `acceptLoanOffer`, `acceptRentSwapOffer`/`refuseRentSwapOffer`/
   `cancelRentSwapOffer`/`cancelLoanRequest`/`acceptRentCompensationOffer`/`refuseRentCompensationOffer`
   côté propositions entre entreprises) : toutes invoquées directement depuis un bouton de liste, modal
   fermé immédiatement, aucune saisie utilisateur à perdre en cas de conflit — même catégorie que
   `repayMortgage`, déjà exclue avant cette section.
6. **Purement informatives, aucune écriture** (`modalOptionChain` — chaîne de primes en lecture seule,
   `modalSwapOfferDetails` — détails d'une proposition en attente).

### Bug découvert en cours de route — conflation « conflit distant » / « échec d'écriture »

En testant le Lot 1 contre la suite existante, `smoke_test_step22_entreprise_top_action_popups.js`
("vendre 20% de Rose 1 fonctionne réellement") s'est mis à échouer dans un environnement de test sans
`window.storage` configuré (donc `storageSet()` échoue TOUJOURS, jamais un vrai conflit). Diagnostic :
`saveGame(opts)` (section 164) ne retournait que `true`/`false`, où `false` confondait deux situations
pourtant très différentes :

- **(a) un vrai conflit distant** — un autre appareil a sauvegardé en premier ; `state`/`lastSerialized`
  sont rafraîchis sur la copie distante fraîche ;
- **(b) un simple échec d'écriture** — `storageSet()` lui-même échoue (réseau, quota, backend non
  configuré) ; `state` n'est PAS touché.

`attemptActionWithRetry` (section 249) traitait tout `false` comme (a) : « rejouer `applyFn()` contre
l'état rafraîchi est sûr et nécessaire ». C'est CORRECT pour (a), mais FAUX pour (b) : rejouer `applyFn()`
contre un `state` jamais rafraîchi réapplique la MÊME mutation par-dessus elle-même (ex. débiter deux fois
un achat) avant même d'avoir réussi à sauvegarder une seule fois — un bug latent réel, pas seulement un
artefact d'environnement de test : un échec réseau transitoire authentique aurait produit exactement le
même doublage en production.

**Correctif** : `saveGame(opts)` retourne désormais exactement l'une de trois valeurs : `true` (succès),
la chaîne `'conflict'` (état rafraîchi — rejouer `applyFn` est sûr et nécessaire), ou `false` (état NON
touché — rejouer `applyFn` doublerait la mutation). `attemptActionWithRetry` réécrite avec un drapeau
`needsReapply` (démarre à `true` ; en tête de boucle, `applyFn()` n'est rappelée QUE si `needsReapply` ;
après chaque `saveGame({silent:true})`, `needsReapply = (saved==='conflict')`) — un échec d'écriture ne
réessaie donc plus JAMAIS que la sauvegarde, sans jamais rejouer la mutation :

```js
async function attemptActionWithRetry(applyFn, {maxAttempts=5, onRetry}={}){
  let res = null;
  let needsReapply = true;
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    if(needsReapply){
      res = await applyFn();
      if(!res || !res.ok) return res;
    }
    const saved = await saveGame({silent:true});
    if(saved===true) return res;
    if(onRetry) onRetry(attempt);
    needsReapply = (saved==='conflict');
  }
  return {ok:false, error:`Un autre appareil sauvegarde en continu — nouvel essai automatique fait ${maxAttempts} fois sans succès. Réessaie dans un instant.`};
}
```

Vérifié par grep exhaustif que la valeur de retour de `saveGame()` n'est lue que dans
`attemptActionWithRetry` — tout autre site d'appel est du type « tire et oublie » (`await saveGame();
render();`), donc ce changement de contrat (false/'conflict') est sans impact ailleurs. Deux tests
existants dont les assertions encodaient l'ancien comportement (buggé) comme « attendu » ont été corrigés :
`smoke_test_step249_ceo_announce_ux_and_retry.js` (le bloc « C-épuisement », qui attendait `calls===3`,
attend désormais `calls===1` — un échec d'écriture continu ne doit jamais rejouer la mutation) et
`smoke_test_concurrent_save_protection.js` (une assertion `===false` devenue `==='conflict'`).

### Tests

**Nouveau fichier** : `smoke_test_step250_write_failure_vs_conflict.js` — 2 scénarios. (A) `storageSet()`
échoue en continu, jamais de conflit : `applyFn` appelée exactement UNE fois, la mutation simulée
appliquée exactement une fois (jamais doublée/triplée/quadruplée par les tentatives), aucune alerte,
`ok:false` final. (B) scénario mixte réaliste — le 1er appel `storageSet()` d'un premier bac à sable
échoue une seule fois et, comme effet de bord de cet échec, déclenche une VRAIE sauvegarde concurrente
d'un second bac à sable dans le même stockage partagé (un conflit RÉEL n'existe donc qu'à partir du 2e
appel de `saveGame`) : `applyFn` appelée exactement 2 fois (jamais rejouée pour l'échec d'écriture, mais
correctement rejouée pour le vrai conflit), la mutation du premier bac appliquée une seule fois (jamais
doublée), la mutation concurrente du second bac jamais perdue/écrasée, aucune alerte, `ok:true` final.

Chaque lot a été validé par la suite complète avant de passer au suivant. Suite complète relancée à 3
reprises consécutives (174 scripts au total — un fichier ajouté) : **0 échec**. `node -c
script_extracted.js` après chaque lot. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html`
et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 251. Menu ☰ Actions de « Mon Entreprise » — les boutons indisponibles disparaissent au lieu de rester grisés

### Origine

Demande explicite de l'utilisateur, verbatim :

> « faire en sorte que les actions indisponible ne soit pas visible jusqu'au moment où elle sont
> utilisables »

L'application utilisait jusqu'ici, de façon systématique et documentée à de nombreuses reprises dans ce
fichier (sections 170, 178, 234, 237, etc.), le patron « toujours affiché, `disabled` + `title`
explicatif » pour tout bouton d'action dont une précondition de jeu (fenêtre de trading fermée, plafond
atteint, réserve vide, encaisse négative, action déjà consommée pour la partie...) bloque temporairement
ou définitivement l'usage. L'utilisateur demande l'inverse : le bouton n'existe simplement pas dans le
rendu tant que son action n'est pas exécutable, et réapparaît de lui-même (sans aucune transition
particulière) dès que la condition change.

Portée et traitement du tooltip confirmés via `AskUserQuestion` (deux questions, une seule réponse
possible à chacune, options recommandées suivies) :

- **Portée** : « Tout le menu ☰ Actions (Recommandé) » — c'est-à-dire l'ensemble des boutons du panneau
  `entActionsPanel` de l'onglet Mon Entreprise dont la visibilité dépend aujourd'hui d'une précondition de
  jeu (patron `disabled`+`title`), pas seulement un sous-ensemble choisi à la main, et pas le reste de
  l'application (les autres popups/onglets ne sont pas concernés par cette section).
- **Contenu explicatif à conserver** : « Rien à garder (Recommandé) » — le bouton disparaît purement et
  simplement ; aucun texte de remplacement (ni tooltip, ni message inline) n'explique pourquoi il est
  absent. Seul un `title` **purement informatif** (qui ne sert pas à expliquer une indisponibilité — ex.:
  montant/taux de la PROCHAINE subvention d'avance) reste affiché, uniquement quand le bouton lui-même est
  rendu.

### Diagnostic — inventaire du menu ☰ Actions

Le panneau `entActionsPanel` (`renderEntreprise()`) contient une série de boutons répartis en groupes
(Plateau/Immobilier/Finance/Assurance & Swaps). Trois familles bien distinctes s'y trouvent, seule la
première étant concernée par cette section :

1. **Patron `disabled`+`title` sur précondition de JEU** (l'objet de cette section) — 9 boutons dans le
   panneau, plus 1 fonction sœur (`reviewLastTurnButtonHtml`, partagée avec l'onglet Portefeuille,
   rendue juste à côté du panneau) : `readyActionHtml`, `goAdvanceButtonHtml`, `sellHousesButtonHtml`,
   `issueLoanButtonHtml`, `issueSharesButtonHtml`, `buybackSharesButtonHtml`, `issuePreferredButtonHtml`,
   `ceoStatementButtonHtml`, `lastResortLoanButtonHtml`, `reviewLastTurnButtonHtml`.
2. **Toujours affichés, sans condition** (`sellShareButtonHtml`, `buildHouseButtonHtml`,
   `payDividendButtonHtml`, `dividendAutoPayToggleHtml`) — hors scope, rien à changer.
3. **Conditionnés par un drapeau de fonctionnalité `f.xxx`** (`mortgageButtonHtml`, `houseBidButtonHtml`,
   `insuranceBundleButtonHtml`, `proposeSwapButtonHtml`, `proposeCompButtonHtml`) — axe différent
   (réglage de partie, pas indisponibilité temporaire liée à l'état du jeu) : explicitement écarté, non
   touché par cette section.

Un dixième bouton du menu, « Racheter (call) » par émission de parts privilégiées (dans l'accordéon
« Parts privilégiées » plus bas dans l'onglet, PAS dans `entActionsPanel`), garde volontairement le
patron `disabled`+`title` d'origine — hors de la portée confirmée par l'utilisateur (« Tout le menu ☰
Actions »).

### Conception retenue et implémentation

Pour chacun des 10 boutons/fonctions en scope, l'expression JS qui produisait
`` `<button ... ${cond?`disabled title="..."`:''}>Label</button>` `` devient
`` cond ? '' : `<button ...>Label</button>` `` — le bouton entier n'est émis dans le HTML que lorsque son
action est exécutable, sans attribut `disabled` ni `title` explicatif nulle part dans ce menu.

- **`readyActionHtml`** (✅ Tour Terminé) : absent tant que `blockReadyForNegativeCash` (encaisse négative
  + marché ouvert) reste vrai.
- **`goAdvanceButtonHtml`** (💸 Vendre la prochaine subvention d'avance) : absent une fois `atMaxGo`
  (plafond de subventions simultanées atteint) ; le `title` restant (montant/taux de la PROCHAINE avance)
  est purement informatif et ne s'affiche que quand le bouton est rendu — jamais une explication
  d'indisponibilité.
- **`sellHousesButtonHtml`** (🏠 Vendre des maisons) : absent tant que `company.houseReserve<=0`.
- **`issueLoanButtonHtml`** (💰 Prêt) : absent une fois la capacité d'emprunt cumulée épuisée SANS demande
  déjà ouverte (`loanCapExhausted && !openLoanRequest`) — reste visible tant qu'une demande est ouverte ou
  que de la capacité reste disponible ; le `title` restant décrit la demande ouverte ou la capacité
  disponible, jamais une raison de blocage.
- **`issueSharesButtonHtml`** (📤 Émission de nouvelles actions) : absent hors fenêtre de trading ou une
  fois le plafond d'émission de 10% atteint.
- **`buybackSharesButtonHtml`** (📥 Rachat d'actions) : absent hors fenêtre de trading (aucun plafond
  propre à ce bouton).
- **`issuePreferredButtonHtml`** (🎫 Émettre des parts privilégiées) : absent hors fenêtre de trading ou
  une fois le plafond cumulatif de parts privilégiées atteint pour la partie.
- **`ceoStatementButtonHtml`** (📢 Sortie publique du CEO) : absent une fois `company.publicStatementUsed`
  OU `company.lastResortLoanUsed` — ces deux conditions sont définitives pour la partie (le bouton ne
  réapparaît donc jamais une fois masqué pour cette raison, à la différence des autres boutons de la
  liste dont la condition peut redevenir fausse).
- **`lastResortLoanButtonHtml`** (🆘 Prêt de dernier recours) : absent tant que `company.cash>=0`.
- **`reviewLastTurnButtonHtml(idPrefix)`** (🔁 Revoir le dernier tour, fonction partagée Mon
  Entreprise/Portefeuille) : absent tant qu'aucun dernier tour n'est disponible à revoir
  (`!state.lastDiceRollEvent || !myCompany()`).

Chaque site a reçu un commentaire de code dédié « Section 251 » expliquant la précondition et rappelant
qu'aucun texte de remplacement n'est affiché, conformément à la décision confirmée.

**Point porté à l'attention de l'utilisateur** : pour `readyActionHtml` spécifiquement, cacher entièrement
le bouton « ✅ Tour Terminé » quand l'encaisse est négative retire toute rétroaction visuelle à cet
emplacement précis (avant cette section, le bouton grisé + son tooltip indiquaient au moins qu'une action
existait et pourquoi elle était bloquée) — implémenté tel quel puisque l'utilisateur a confirmé deux fois
« rien à garder » pour l'ensemble du menu, mais à reconsidérer spécifiquement pour ce bouton si cela
s'avère déroutant en test de jeu réel (le CEO garde de toute façon accès aux autres boutons du menu —
prêt, dividende, actions... — pour corriger son encaisse avant que le bouton ne réapparaisse).

### Tests

Suite existante mise à jour (8 fichiers dont les assertions encodaient l'ancien patron « grisé+title »
comme comportement attendu, corrigées pour asserter l'absence du marqueur HTML du bouton au lieu de la
présence de l'attribut `disabled`) : `smoke_test_ceo_public_statement.js`,
`smoke_test_step179_ready_requires_nonnegative_cash.js`, `smoke_test_step20_entreprise_popups_restructure.js`,
`smoke_test_step217_review_last_turn_button.js`, `smoke_test_step234_share_issuance_buyback.js`,
`smoke_test_step237_preferred_shares.js`, `smoke_test_step27_sell_houses_between_companies.js`,
`smoke_test_step29_entreprise_menu_icon.js` (ce dernier: la réserve de maisons de l'entreprise de test est
désormais posée explicitement à une valeur positive avant le rendu, pour continuer à exercer le marqueur
`openSellHousesBtn` dans le test générique de structure du panneau). `node -c script_extracted.js` après
chaque lot. Suite complète (174 scripts) relancée à 3 reprises consécutives : **0 échec**. `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 252. Extension de la section 251 à TOUS les boutons des deux menus ☰ Actions (Mon Entreprise ET Portefeuille) — plus seulement ceux au patron grisé+info-bulle

### Origine

Après livraison de la section 251, l'utilisateur a testé l'application et signalé, verbatim (sur plusieurs
messages du même échange) :

> « Actuellement il ne sont pas cliquable mais ils sont toujours visible »
>
> « En fait je viens de comprendre que les bouton n,ont jamais été grisé avec une info bulle non plus pour
> ca je comprenais pas »
>
> « Regarde nous sommes pas à la frontière d'un semestre et rien n'est grisé, rien n'est non visible »
>
> (après capture d'écran du menu ☰ Actions de Mon Entreprise, marché fermé, boutons Immobilier/Finance
> toujours visibles) « Ça fonctionne pas plus dans Mon entreprise »
>
> (après clic sur un de ces boutons) « J'ai un pop-up qui me dit que c'est pas disponible pour le moment »
>
> (confirmation finale, à la question de savoir s'il fallait étendre la portée) « Oui stp tout les boutons
> du menu action qui ne sont pas disponible lors d'un tour ne pas les afficher non visible »

Diagnostic, établi par capture d'écran ET par un test direct du moteur (Node, hors navigateur) sur le
fichier livré: la section 251 fonctionnait exactement comme prévu pour les 9 boutons qui utilisaient DÉJÀ
le patron `disabled`+`title` — mais deux familles de boutons, jamais couvertes par ce patron À L'ORIGINE,
restaient inchangées: (a) dans Mon Entreprise, les boutons « toujours affichés » qui délèguent leur
validation à une alerte au moment du clic (Vendre une part, Hypothéquer, Construire une maison, Enchère de
maisons, Contrat d'assurance, Annoncer un dividende, Swap, Accords de compensation) — c'est en cliquant sur
l'un d'eux (terrain non encore acquis en tout début de partie) que l'utilisateur a vu le pop-up « pas
disponible » qui l'a mené à la bonne piste; (b) le menu ☰ Actions ENTIER de l'onglet Portefeuille
(`pfActionsPanel` — Acheter/Vendre des actions, Vente à découvert, Bons gouvernementaux, Options), qui n'a
jamais eu la moindre garde de disponibilité au rendu, feature-flag ou autre.

### Conception retenue et implémentation

Même principe que la section 251 (bouton absent, sans texte de remplacement, tant que son action ne mène
nulle part) mais élargi aux DEUX menus ☰ Actions au complet. Chaque condition ajoutée est reprise À
L'IDENTIQUE de la garde d'ouverture du modal correspondant (première ligne du `if(...){ alert(...); return;
}` du modal) — aucune nouvelle règle métier introduite, seulement sa réplique en lecture seule au moment du
rendu du menu, exactement comme pour la section 251.

**Mon Entreprise (`entActionsPanel`) — 8 boutons/conditions ajoutés :**

- **`sellShareButtonHtml`** (💵 Vendre une part) et **`mortgageButtonHtml`** (🏦 Hypothéquer, en plus de
  `f.mortgage`) : absents si l'entreprise ne possède aucun terrain ni lot (`state.properties.some(p=>p.
  owners.some(o=>o.companyId===company.id))`) — même garde que `modalSellShareCompany()`/
  `modalMortgageCompany()` (dont `eligible.length===0 && mortgaged.length===0`, équivalent à « aucun terrain
  possédé » puisque tout terrain possédé est soit éligible soit déjà hypothéqué).
- **`buildHouseButtonHtml`** (🏗️ Construire une maison) : absent hors de la fenêtre de fin d'année
  financière (`yearEndWindowOpen()`) ou si aucun terrain de couleur, en lot regroupé, dont l'entreprise
  détient au moins une part, n'est encore constructible (`p.houses<hotelLevel()`) — même double garde que
  `modalBuildHouseCompany()`.
- **`houseBidButtonHtml`** (🏠 Enchère de maisons, en plus de `auctionOn`/`f.houseAuction`) : absent hors de
  la fenêtre de fin d'année financière — même garde que `modalHouseBid()`.
- **`insuranceBundleButtonHtml`** (🛡️ Contrat d'assurance, en plus de `f.insurance||f.subInsurance`) :
  absent si aucun risque n'est assurable pour le terme par défaut (Année > Semestre > sous-standard, même
  sélection que `insuranceTermAvailable`) — même garde que `modalInsureBundle()`
  (`insurableItems`/`subInsurableItems`, répliquées en lecture seule).
- **`payDividendButtonHtml`** (💎 Annoncer un dividende) : absent tant qu'un arriérage de dividende
  préférentiel reste à régler (`company.preferredDividendArrears>0`) — même garde que
  `modalAnnounceDividend()` (seul cas où ce modal refusait l'ouverture avec une alerte plutôt que de
  présenter le formulaire — les autres validations, ex. montant/trésorerie, restent DANS le formulaire,
  donc hors de portée d'une condition d'affichage).
- **`proposeSwapButtonHtml`** (🔄 Swap, en plus de `f.rentSwap`) : absent si l'entreprise ne détient aucun
  terrain/lot échangeable OU s'il n'existe aucune autre entreprise active — même double garde que
  `modalProposeSwap()`.
- **`proposeCompButtonHtml`** (🤝 Accords de compensation, en plus de `f.rentCompensation`) : absent s'il
  n'existe aucune autre entreprise active — même garde que `modalProposeCompensation()`.
- **`dividendAutoPayToggleHtml`** (🔁 Dividende récurrent) : AUCUN changement — sa condition d'affichage
  existante (`company.type==='dividende' && company.dividendBenchmarkPerShare>0`) correspondait déjà
  EXACTEMENT à la garde d'ouverture de `modalDividendRecurrentSettings()` ; ce bouton ne pouvait donc
  jamais afficher le pop-up « pas disponible » signalé par l'utilisateur.

**Portefeuille (`pfActionsPanel`) — 11 boutons, JAMAIS gardés auparavant :**

- **`openBuySharesBtn`**/**`openSellSharesBtn`** (📈/📉 Acheter/Vendre des actions) : absents hors de la
  fenêtre de trading (`tradingWindowOpen()`) ou si aucune entreprise n'est éligible au trading (IPO
  financée, CEO différent du joueur) — même garde que `modalBuySellShares()`.
- **`openAnnounceCeoTradeBtn`** (📢 Annoncer un achat/une vente de mes propres parts, en plus de `isCeo`) :
  absent une fois la partie terminée — même garde que `modalAnnounceCeoTrade()`.
- **`openShortSharesBtn`** (📉 Vendre à découvert) : absent hors fenêtre de trading, partie terminée, ou
  aucune entreprise éligible (IPO financée, CEO différent, AUCUN prêt de dernier recours contracté) — même
  garde que `modalShortShares('open')`.
- **`openCoverShortSharesBtn`** (📈 Racheter pour clôturer) : absent hors fenêtre de trading, partie
  terminée, ou aucune position à découvert déjà ouverte par le joueur — même garde que
  `modalShortShares('close')` (`mode==='close'` reste volontairement NON filtré par IPO/CEO/prêt de dernier
  recours dans le modal — une position déjà ouverte doit toujours pouvoir être rachetée — reproduit ici à
  l'identique).
- **`openInvestBondsBtn`**/**`openWithdrawBondsBtn`**/**`openBorrowBondsBtn`** (💰/🏦/💸 Bons
  gouvernementaux) : absents hors fenêtre de trading ou partie terminée — même garde partagée que
  `modalBonds()` pour ses 3 modes (aucun des 3 modes n'a de garde d'ÉLIGIBILITÉ supplémentaire à
  l'ouverture — un solde à 0 pour « Retirer », par exemple, n'empêche pas l'ouverture du modal, qui affiche
  alors « Solde disponible: 0 » plutôt qu'un pop-up bloquant — aucune condition ajoutée au-delà de la garde
  partagée, pour rester fidèle au comportement réel).
- **`openOptionChainBtn`** (📊 Voir la chaîne d'options) : absent si aucune entreprise n'est éligible — SEUL
  bouton Options SANS garde de fenêtre de trading (purement informatif, aucune transaction) — même garde
  que `modalOptionChain()`.
- **`openOptionTradeBtn`**/**`openOptionStrategyBtn`** (🎯/🧩 Nouvelle position/stratégie d'options) :
  absents hors fenêtre de trading, partie terminée, ou aucune entreprise éligible — même garde que
  `modalOptionTrade()`/`modalOptionStrategy()`.

**Hors de portée, délibérément** : le bouton « Racheter (call) » par émission de parts privilégiées (dans
l'accordéon « Parts privilégiées » de Mon Entreprise) garde le patron `disabled`+`title` — ce n'est pas un
bouton du menu ☰ Actions (ni `entActionsPanel` ni `pfActionsPanel`), donc hors du périmètre « tout les
boutons du menu action » confirmé par l'utilisateur.

### Tests

2 fichiers existants ajustés (setup de scénario, pas d'assertion changée — ces tests vérifient la
STRUCTURE du panneau, pas une règle de disponibilité, et supposaient à tort tous les boutons « toujours
affichés ») : `smoke_test_step29_entreprise_menu_icon.js` (Zenith reçoit désormais un lot regroupé possédé
à 100% pour continuer à exercer `openSellShareBtn`/`openBuildHouseBtn` — `state.gameClock.rollCount` reste
à 0 par défaut, donc `yearEndWindowOpen()` déjà vrai sans changement) ; `smoke_test_step56_phase4_
portefeuille.js` (Julien reçoit une position à découvert ouverte sur Adrian Inc via `openShortPosition()`
pour continuer à exercer `openCoverShortSharesBtn`). `node -c script_extracted.js` après chaque bloc (Mon
Entreprise, puis Portefeuille). Suite complète (174 scripts) relancée à 3 reprises consécutives : **0
échec**. Vérification manuelle supplémentaire (script Node dédié, hors suite de smoke tests, reproduisant
le scénario exact signalé par l'utilisateur — partie fraîche, année 0, semestre 1/2 — 2/3, aucun terrain
encore acquis) : `openSellShareBtn`/`openMortgageBtn`/`openBuildHouseBtn`/`openHouseBidBtn`/
`openInsureBundleBtn`/`openProposeSwapBtn` bien absents, `openProposeCompBtn`/`openPayDividendBtn` bien
présents (aucune précondition liée à la possession d'un terrain) — confirmé également côté Portefeuille:
tous les boutons de trading absents avant financement de l'IPO des entreprises, `openAnnounceCeoTradeBtn`
présent (aucune précondition d'IPO). `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html`
et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 253. Annonce CEO silencieusement bloquée par une IPO non terminée, bloc « Exécutions récentes » dans Détails supplémentaires, intérêt de prêt reçu invisible pour le joueur prêteur, et filet de sécurité contre une modale qui resterait bloquée ouverte

### Origine

Trois messages de l'utilisateur, en cours de test, tous liés au même bloc « Détails supplémentaires » du
Portefeuille (bouton `pfPortfolioEvolutionBtn`/`showPortfolioEvolutionPopup`) et au mécanisme de réessai
automatique (sections 249/250) :

Premier message, deux retours en un seul, verbatim :

« 1) OK je viens de tester à nouveau Annoncr un achat/une vente de mes propres parts, affiche
l'avertissement, mais aucune transaction se s'effectue après 6 lancés.

2) Je pense que ça fonctionne bien ton idée de faire 5 essaies quand des problèmes de timing. Par contre
si l'ordre finit par passer au 3ème il faut fermer la fenêtre pour le moment la fenêtre reste toujours
ouverte même quand elle finit par passé. »

Puis, en cours d'investigation du premier point, deux demandes de fonctionnalité complémentaires,
verbatim :

« Dans le bouton détail supplémentaire du portefeuille, mentionner les exécutions qui ont eu lieu. Par
exemple expiration de l'option XYZ OTM ou ITM avec la résultante. Ou bien offre accepté pour l'émission de
prêt. Transaction CEO complété, etc. »

« Quand un obligations paie une part du loyer au joueur on la voit bien dans mon entreprise, mais on ne la
voit pas dans l'historique de transaction du joueur qui recoit l'intérêt et ça devrait figurer dans détails
supplémentaires pour faire du pouce. »

(« Obligations » ici = les prêts joueur-contre-entreprise du marché de prêts, section 157 — pas les bons
gouvernementaux, malgré le mot; le reste de la phrase, « une part du loyer », confirme sans ambiguïté qu'il
s'agit de la retenue de loyer au profit d'un prêteur, voir applyLoanWithholding.)

### Diagnostic — 1) annonce CEO silencieusement vouée à l'échec

`modalAnnounceCeoTrade()` n'a jamais vérifié que l'entreprise avait terminé son introduction en bourse
(IPO, voir `companyPendingIpoShares`) avant d'accepter une annonce. `executeShareTrade()` le vérifie bien,
mais seulement 6 lancers plus tard, au moment de l'EXÉCUTION différée (`executeCeoAnnouncement`, appelée
depuis `advanceGameClock`) — et son échec n'était alors QUE journalisé dans `state.log`, jamais montré au
CEO concerné (ni alerte, ni pop-up). Résultat exactement conforme au signalement : la modale « affiche
l'avertissement » (le rappel d'irrévocabilité, toujours présent), semble accepter l'annonce normalement,
puis ne produit silencieusement AUCUNE transaction un an plus tard si l'IPO n'est toujours pas terminée à
ce moment-là. Reproduit et confirmé par un test Node dédié (moteur chargé en sandbox `vm`, hors navigateur) :
partie fraîche, compagnie fondée (30% des parts émises au CEO, 70% en attente d'IPO, comportement par
défaut — voir section 1/8), annonce d'achat créée sans erreur, 6 `performRollForAllCompanies()` plus tard :
`state.ceoAnnouncements` vidée (retirée comme toujours à l'exécution) mais `state.ceoAnnouncementExecutions`
vide aussi (aucune entrée ni réussie ni — avant ce correctif — historisée en échec), seul `state.log`
portait la trace : « Zenith n'a pas encore terminé son introduction en bourse (IPO) — pas encore
tradable. »

### Diagnostic — 2) fenêtre de réessai qui resterait ouverte

Investigation approfondie du mécanisme de réessai automatique (sections 249/250) : lecture complète de
`runModalActionWithRetry`/`attemptActionWithRetry`/`saveGame` (les trois maillons), confirmant sur papier
que `closeModal(); render();` s'exécute bien après un succès, PEU IMPORTE le nombre de tentatives
préalables. Simulation Node directe (sandbox `vm`, hors navigateur) du scénario exact décrit — 2 conflits
distants successifs puis succès au 3e essai, en cliquant réellement `#mOk` (pas un appel direct à
`attemptActionWithRetry`) — confirme que le chemin normal ferme bien la modale : `modalHost.innerHTML` vide
après le clic, mutation bien appliquée. Aucune reproduction directe trouvée pour le scénario tel que décrit
avec les outils de simulation disponibles (headless, sans navigateur réel). Un trou de robustesse RÉEL
restait néanmoins ouvert et corrigé par précaution (voir ci-dessous, « Filet de sécurité ») : ni
`runModalActionWithRetry` ni l'usage direct de `attemptActionWithRetry` dans `modalAnnounceCeoTrade` (seule
modale à ne pas passer par le wrapper partagé) n'avaient de `try/catch` — une exception INATTENDUE (pas un
simple `{ok:false}` métier, mais une vraie exception JS, ex. un état distant corrompu qui ferait planter
`migrateState`) aurait laissé `#mOk` désactivé et la modale ouverte indéfiniment, sans aucun message —
symptôme qui correspondrait exactement au signalement, même si la cause exacte réellement rencontrée reste
non confirmée.

### Corrections apportées

**1) Garde IPO à l'annonce CEO, plus jamais silencieuse.** `modalAnnounceCeoTrade()` refuse désormais
l'annonce (alerte immédiate, aucune mutation) si `companyPendingIpoShares(co)>0`, AVANT de créer l'entrée
dans `state.ceoAnnouncements` — même esprit que les sections 251/252 (ne jamais laisser une action se
lancer si elle est vouée à l'échec). Le bouton « 📢 Annoncer un achat/une vente de mes propres parts » du
menu ☰ Actions du Portefeuille (`openAnnounceCeoTradeBtnHtml`) est lui aussi désormais masqué tant que
l'IPO n'est pas terminée, cohérent avec le reste de la section 252.

**Défense en profondeur complémentaire** (couvre toute AUTRE cause du même symptôme, ex. encaisse
personnelle insuffisante au moment de l'exécution, plafond légal de vente CEO dépassé) : `executeCeoAnnouncement()`
historise désormais SYSTÉMATIQUEMENT le résultat de chaque exécution différée dans
`state.ceoAnnouncementExecutions`, réussie (`ok:true`, comme avant) OU ÉCHOUÉE (`ok:false` + `error`,
nouveau) — plus jamais seulement journalisé dans `state.log`. `maybeShowCeoAnnouncementExecutionPopup()`
affiche désormais une alerte explicite (« N'A PAS PU s'exécuter : … ») pour une exécution échouée, au lieu
de ne rien faire du tout (`showTransactionPopup(title, undefined)` ne faisait auparavant RIEN sur une
entrée sans `entries`).

**2) Bloc « Exécutions récentes » dans Détails supplémentaires** (`showPortfolioEvolutionPopup`).
Nouvelle fonction `recentExecutionEntriesForPlayer(player, limit=10)`, qui unifie et trie par récence
(lancer le plus récent d'abord) trois journaux distincts, filtrés du point de vue du joueur affiché :

- `state.ceoAnnouncementExecutions` (existait déjà pour le pop-up de confirmation, section « Nouvelle
  section » ci-dessus dans ce fichier) — ses propres transactions CEO exécutées, réussies OU échouées (voir
  point 1 ci-dessus).
- `state.optionSettlements` (**nouveau tableau**, alimenté par `settleExpiredOptions()`) — ses propres
  règlements d'options arrivées à échéance, avec la résultante (« DANS LA MONNAIE — … » / « HORS-JEU, sans
  valeur »), exactement le texte déjà utilisé par le `log()` existant, simplement dupliqué dans une entrée
  structurée consultable individuellement par ce joueur.
- `state.loans` — les prêts où ce joueur est impliqué, comme CEO de l'entreprise emprunteuse OU comme
  prêteur (`lenderId===player.id`), affichés « Offre de prêt acceptée — … ». (`roll`, nouveau champ ajouté à
  chaque prêt par `issueLoan`, pour pouvoir trier par récence comme les deux autres journaux —
  `createdAt` existait déjà mais n'est qu'un texte de date/heure, pas directement comparable.)

Le bloc n'apparaît dans le pop-up que s'il y a au moins une entrée ; une entrée en échec (CEO) est affichée
en rouge avec un ❌, cohérent avec le reste de l'app.

**3) Intérêt de prêt reçu par un prêteur JOUEUR, désormais visible.** `settlePropertyRent`/
`settleNeutralPawnRent` créditaient déjà correctement `lenderPl.cash` quand une retenue de loyer rembourse
un prêt dont le prêteur est un JOUEUR (`lenderKind==='player'`, marché de prêts, section 157) — mais (a)
n'ajoutaient jamais ce montant à `player.cumInterestReceived` (le total « Intérêt reçu » de
`playerNetWorthReconciliation`/Détails supplémentaires ne comptait donc QUE l'intérêt des bons
gouvernementaux, voir `accrueBondInterest`, jamais celui-ci) et (b) n'en gardaient aucune trace individuelle
consultable par ce joueur (`logFin` ne suit que les compagnies, jamais le cash personnel d'un joueur — la
compagnie EMPRUNTEUSE, elle, voyait bien la retenue dans ses propres états financiers, d'où « on la voit
bien dans mon entreprise » du signalement). Nouvelle fonction partagée
`recordLoanInterestReceivedByPlayer(lenderPl, borrowerCompany, withheld, loan)`, appelée aux deux points de
distribution de loyer concernés : incrémente `cumInterestReceived` (corrige le total agrégé) ET pousse une
entrée dans le nouveau tableau `state.loanInterestPayments` (alimente le bloc « Exécutions récentes »
ci-dessus, texte « Intérêt de prêt reçu — … »).

**4) Filet de sécurité défensif contre une modale bloquée ouverte.** `runModalActionWithRetry` et l'usage
direct de `attemptActionWithRetry` dans `modalAnnounceCeoTrade` encadrent désormais l'appel d'un
`try/catch` : toute exception inattendue réactive systématiquement `#mOk` et affiche une alerte claire
(« Une erreur inattendue est survenue… vous pouvez réessayer »), au lieu de laisser le bouton désactivé et
la modale ouverte indéfiniment sans aucun message. N'affecte en rien le comportement déjà correct du
chemin normal (succès après réessai, échec métier propre) — seulement le cas d'exception non gérée,
auparavant totalement non couvert.

### Tests

Nouveau fichier dédié `smoke_test_step253_recent_executions_and_ipo_gate.js` (7 groupes) : (A)/(B) bouton
`openAnnounceCeoTradeBtn` invisible et annonce refusée (alerte, aucune mutation) avant IPO, visible et
fonctionnelle après financement de l'IPO ; (C)/(D) exécution différée réussie historisée `ok:true` +
pop-up de transaction habituel, exécution échouée (plafond légal simulé) historisée `ok:false` + alerte
explicite (jamais silencieuse) ; (E) règlement d'option OTM et ITM tous deux historisés dans
`state.optionSettlements` et visibles dans `recentExecutionEntriesForPlayer` avec la bonne résultante ; (F)
prêt accepté visible à la fois pour le CEO emprunteur (via sa compagnie) et pour le prêteur ; (G) exception
forcée dans `applyFn` de `runModalActionWithRetry` : `#mOk` réactivé, alerte affichée, retour `{ok:false}`
propre. `smoke_test_step70_section157_bonds_and_loan_market.js`, section (I) (règlement de loyer avec prêt
JOUEUR actif, scénario déjà existant) étendue avec 3 nouvelles assertions : `cumInterestReceived` du
prêteur augmente bien du montant retenu, une entrée est bien ajoutée à `state.loanInterestPayments`, et
elle apparaît bien dans `recentExecutionEntriesForPlayer(prêteur)`. `smoke_test_step55_phase3_polish.js`
(« Point 20c », teste le retrait de `confirm()` pour `modalAnnounceCeoTrade`) corrigé : la compagnie de
test n'avait jamais son IPO financée, scénario devenu invalide par la garde IPO ajoutée en (1) — un appel à
`applyCompanyIpoFunding()` a été ajouté au setup, hors sujet du test lui-même (comportement confirm/mCancel/
mOk), pour rendre l'entreprise tradable avant d'ouvrir la modale. `node -c script_extracted.js` après
chaque bloc. Suite complète (176 scripts désormais) relancée à 3 reprises consécutives : **0 échec**.
`python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 254. Marge disponible et ratio de couverture affichés dans le Portefeuille, sous les Liquidités

### Origine

Demande de l'utilisateur, verbatim : « dans portefeuille en dessous de l'encaisse possible de mettre la
marge disponibles. ainsi que le ratio disponibles entre parenthèses pour indiquer au joueur leur capacité
à allez court. »

### Diagnostic et choix de conception

Le mécanisme d'appel de marge existait déjà (`enforceMarginCalls()`, `SHORT_MARGIN_MAINTENANCE_PCT=0.30`)
mais restait entièrement invisible au joueur avant qu'un appel de marge ne le frappe — aucun moyen de
savoir À L'AVANCE combien de marge restait disponible avant liquidation forcée. La formule exacte de
`enforceMarginCalls` a été extraite dans une nouvelle fonction partagée `requiredMaintenanceMargin(player)`
(30 % × valeur notionnelle des positions à découvert + 30 % × valeur notionnelle de la portion NUE — non
couverte — des options écrites), pour garantir que l'affichage et le déclenchement réel de l'appel de
marge utilisent TOUJOURS exactement le même calcul, sans jamais dupliquer la logique.

La formulation de l'utilisateur (« marge disponible » + « le ratio disponible » entre parenthèses, pour
indiquer « leur capacité à aller court ») était ambiguë entre plusieurs lectures possibles (coussin en
dollars, pourcentage de la valeur nette libre, multiple de couverture). Le choix retenu — cohérent avec le
vocabulaire déjà présent dans l'app (« appel de marge », « cote de crédit ») et avec les conventions d'un
vrai courtier — est :

- **Marge disponible** = `netWorth(player) - requiredMaintenanceMargin(player)` — le coussin en dollars
  au-dessus du minimum exigé ; peut devenir négatif entre deux lancers si la valeur nette baisse sans
  changement de position (affiché en rouge dans ce cas, cohérent avec le reste de l'app).
- **Ratio, entre parenthèses** = `netWorth(player) / requiredMaintenanceMargin(player)`, affiché au format
  « X× » (multiple de couverture — combien de fois la valeur nette couvre l'exigence de marge). Quand
  `requiredMaintenanceMargin` est nul (aucune position à découvert ni option écrite), le ratio est
  remplacé par le libellé neutre « aucune position à marge » plutôt qu'une division par zéro ou un ratio
  infini trompeur.

Si cette lecture du « ratio » ne correspond pas à l'intention du joueur, une correction reste possible —
signalé à l'utilisateur en fin de livraison.

### Corrections apportées

`requiredMaintenanceMargin(player)` (nouvelle fonction, juste avant `enforceMarginCalls()`) : extraite
telle quelle de la boucle interne de `enforceMarginCalls`, qui a été refactorée pour l'appeler
(`const requiredMargin = requiredMaintenanceMargin(p);`) — comportement inchangé, vérifié par
`node -c` et par la suite complète de tests existante (dont les tests dédiés aux appels de marge et aux
options, tous repassés 3 fois de suite sans échec avant l'ajout du nouveau fichier de test).

`renderPortefeuille()` : nouvelle ligne « Marge disponible (vente à découvert/options écrites) » insérée
juste sous « Liquidités » et avant « Mon entreprise (CEO) », affichant le montant (rouge si négatif) suivi
du ratio entre parenthèses selon la formule ci-dessus.

### Tests

Nouveau fichier dédié `smoke_test_step254_available_margin_display.js` (2 groupes, 9 assertions) : (A)
aucune position à découvert/option écrite — marge exigée nulle vérifiée par sanity check indépendant, la
ligne « Marge disponible » est présente, le montant affiché correspond exactement à la valeur nette
entière (`fmt()` calculé à l'intérieur du bac à sable pour comparer des chaînes formatées identiques,
jamais réimplémenté côté hôte Node), et le ratio est bien remplacé par le libellé neutre ; (B) une position
à découvert ouverte (`openShortPosition`) — marge exigée recalculée indépendamment dans le test à partir de
`SHORT_MARGIN_MAINTENANCE_PCT` (30 % × 50 parts, vérifié égal à 15), la ligne « Marge disponible » affiche
exactement `netWorth - requiredMargin`, et le ratio affiché correspond exactement à `netWorth/requiredMargin`
au format « X× ». `node -c script_extracted.js` après chaque étape. Suite complète (176 scripts) relancée
à 3 reprises consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html`
et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 255. Exclusion des parts CEO dans sa propre entreprise du calcul de marge (vente à découvert/options écrites)

### Origine

Demande de l'utilisateur, verbatim, en réaction directe à la section 254 : « pour les shorter ne pas
compter les parts du CEO dans son entreprise dans la valeur nette pour déterminer le 30% et un appel de
marge ne peut pas utiliser les parts du CEO dans sa propre compagnie. »

### Diagnostic et choix de conception

Un CEO possède toujours des parts de SA PROPRE entreprise (`companyCeoStartPct`, par défaut 30 % du total
à la fondation) — `netWorth(player)` les comptait comme n'importe quel autre actif, y compris dans la
comparaison à la marge de maintien exigée (`enforceMarginCalls`, et donc aussi la nouvelle ligne « Marge
disponible » de la section 254). L'utilisateur juge que ces parts ne devraient PAS servir de collatéral
pour couvrir des positions à découvert/options écrites ouvertes sur D'AUTRES compagnies.

Un CEO ne peut de toute façon déjà jamais vendre à découvert ni écrire d'option sur sa PROPRE entreprise
(`openShortPosition`/`openOptionPosition`, « délit d'initié intégré au jeu ») — la fermeture forcée d'un
appel de marge (`closeShortPosition`/`closeOptionPosition`) ne touche donc déjà jamais littéralement aux
parts CEO d'une entreprise. Le seul changement nécessaire est donc dans le calcul de la valeur nette
utilisée pour DÉCIDER si un appel de marge doit se déclencher — pas dans le mécanisme de fermeture
lui-même, qui reste inchangé.

Nouvelle fonction `marginableNetWorth(player)` = `netWorth(player)` moins la valeur de marché des parts
détenues par le joueur dans SA PROPRE entreprise (celle dont il est CEO). `netWorth(player)` lui-même
reste STRICTEMENT INCHANGÉ partout ailleurs dans l'app (classement, condition de victoire, distribution de
dividendes proportionnelle, `playerNetWorthReconciliation`/Détails supplémentaires, etc.) — cette
exclusion est strictement locale au contexte "marge", jamais propagée à `netWorth()` lui-même.

### Corrections apportées

`marginableNetWorth(player)` (nouvelle fonction, juste après `netWorth()`) : reprend `netWorth(player)`
puis soustrait, pour la SEULE entreprise dont ce joueur est CEO, `stake.shares * co.stockPrice` (la valeur
de marché courante de sa participation). `enforceMarginCalls()` : `netWorth(p)>=requiredMargin` remplacé
par `marginableNetWorth(p)>=requiredMargin` — c'est l'UNIQUE changement à cette fonction, tout le reste du
mécanisme (choix du plus gros candidat à fermer, boucle jusqu'à conformité, garde-fous) reste inchangé.
`renderPortefeuille()` (ligne « Marge disponible », section 254) : `netWorth(me)` remplacé par
`marginableNetWorth(me)`, pour que le coussin affiché corresponde EXACTEMENT à ce qui déclenche (ou non)
un appel de marge automatique.

### Tests

`smoke_test_step254_available_margin_display.js` étendu (désormais 4 groupes au lieu de 2, 15
assertions) : (A)/(B) mis à jour pour recalculer indépendamment `marginableNetWorth(j)` au lieu de
`netWorth(j)`, cohérent avec le nouveau comportement (le CEO de test détient toujours des parts de sa
propre entreprise à la fondation, donc l'ancienne comparaison à `netWorth()` échouait désormais — confirmé
en observant l'échec AVANT correction du test, preuve que le changement de comportement est bien réel et
pas un faux négatif) ; nouveau groupe (C), la preuve centrale de cette section : une position à découvert
dimensionnée pour que la marge exigée tombe EXACTEMENT à mi-chemin entre `marginableNetWorth(j)` et
`netWorth(j)` — au-dessus de la première (appel de marge attendu sous la NOUVELLE règle) mais en-dessous de
la seconde (l'ANCIENNE règle, `netWorth()` brut, n'aurait déclenché AUCUN appel de marge dans ce scénario)
— `enforceMarginCalls()` ferme bien la position malgré tout, démontrant que l'exclusion s'applique au
DÉCLENCHEMENT réel et pas seulement à l'affichage ; vérifie aussi indépendamment que
`marginableNetWorth(j) === netWorth(j) − (valeur exacte des parts CEO de Julien dans sa propre
entreprise)`. `node -c script_extracted.js` après chaque étape. Suite complète (176 scripts) relancée à 3
reprises consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html`
et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 256. Remise pour la part de la banque dans l'auto-versement de dividende, alignée sur le dividende annoncé

### Origine

Demande de l'utilisateur, verbatim : « les dividendes verser automatiquement faire une remise pour les
parts de la banque comme le dividendes annoncé. »

### Diagnostic

Une fois l'IPO d'une entreprise financée par la banque (`applyCompanyIpoFunding`), la banque devient un
actionnaire RÉEL de l'entreprise (`company.shareholders` avec `playerId:'BANK'`), comptée dans
`company.sharesIssued`. Le dividende ANNONCÉ (`modalAnnounceDividend`/la boucle `dueDividends`) exclut déjà
la banque du versement et retourne intégralement sa portion à `company.cash` (`unclaimed`, catégorie
`dividend_forfeited_return`) — une vraie remise. L'AUTO-VERSEMENT (`dividendAutoPay`, section 241) excluait
bien la banque du PAIEMENT (`realHolders` filtre `playerId!=='BANK'`) mais calculait `autoAmount` sur
`co.sharesIssued` EN ENTIER (banque comprise) et débitait ce montant COMPLET de `company.cash` — sans
jamais rendre la portion non versée à l'entreprise. Cette portion (benchmark × parts détenues par la
banque) disparaissait donc purement et simplement à chaque auto-versement — une perte sèche récurrente,
jamais présente dans le dividende annoncé.

### Corrections apportées

Bloc d'auto-versement (`advanceGameClock`, boucle `activeCompanies().forEach` du type Dividende) : suit
désormais `paidTotal` (somme réellement versée aux actionnaires réels), calcule `unclaimed = autoAmount -
paidTotal` et, si positif, le recrédite à `company.cash` (`logFin(co.id, 'dividend_forfeited_return',
unclaimed, ...)`, EXACTEMENT la même catégorie comptable que le dividende annoncé) — plus jamais une perte
sèche. Le message de journal (`log(...)`) précise désormais le montant réellement distribué et, le cas
échéant, la portion non versée retournée en trésorerie (« part de la banque »), dans le même esprit que le
message du dividende annoncé. Le calcul PAR ACTIONNAIRE RÉEL (`cut = autoAmount * (h.shares/sharesIssued)`)
reste totalement inchangé — seule la portion de la banque, auparavant perdue, revient maintenant à
l'entreprise.

### Tests

Nouveau fichier dédié `smoke_test_step256_auto_dividend_bank_rebate.js` (2 groupes, 7 assertions) : (A)
IPO financée par la banque (`applyCompanyIpoFunding`) puis auto-versement à la frontière de semestre — le
CEO (actionnaire réel) reçoit EXACTEMENT `benchmark × ses parts` (inchangé), le coût NET réel pour
l'entreprise est `benchmark × (sharesIssued − parts banque)` et non plus `benchmark × sharesIssued` en
entier (vérifié strictement inférieur au montant brut), et la remise atterrit bien dans `company.cash` —
PAS dans `state.bank.cash` (même convention que `dividend_forfeited_return` pour un dividende annoncé) ; (B)
non-régression — sans aucune part de banque (comme le scénario déjà couvert par
`smoke_test_step241_type_bag_dividende_garp.js` groupe I), le coût net reste exactement égal au coût brut,
comportement strictement inchangé. `node -c script_extracted.js`. Suite complète (177 scripts désormais)
relancée à 3 reprises consécutives : **0 échec**. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 257. Audit A1 (assurances et transaction complexe) — 3 correctifs sur settlePropertyRent

### Origine

Rapport d'audit externe (`claude/AUDIT_A1_ASSURANCES.md`, Project — audit exécuté hors ligne sur un bac à
sable, 19 comportements validés, 3 anomalies confirmées aux jointures entre produits financiers, jamais
dans l'assurance elle-même). Demande de l'utilisateur, verbatim : « Correctifs à faire — 3 anomalies
trouvées à l'audit du module d'assurances. » Trois correctifs détaillés fournis par l'utilisateur, chacun
avec le symptôme mesuré, la cause précise et l'option de correction retenue — repris ci-dessous dans le
même ordre. Portée du rapport : `settlePropertyRent` uniquement ; le 4e point de l'audit (bouton
« Résilier » affiché après un lancer — cosmétique) n'a pas été demandé par l'utilisateur dans ce message et
n'a donc pas été touché.

### Correctif 1 — Fuite monétaire sur les terrains de couleur (majeure, réglage par défaut)

Sur un terrain de couleur partiellement vendu, quand « la banque perçoit un loyer sur sa propre part »
(`bankCollectsRent`) est désactivé — le réglage PAR DÉFAUT du formulaire de fondation de partie — le
visiteur payait quand même la part ordinaire invendue de la banque (`purchasableBankShare`), mais aucun
compte ne l'encaissait : `payableShare` retranchait déjà la part du visiteur, les parts hypothéquées/sous
enquête AMF et la réserve ETF non collectée, mais jamais la part ordinaire de la banque, alors que le bloc
qui crédite la banque plus bas n'agit que si l'option est active. L'argent était purement détruit (52 K$
sur le cas mesuré à l'audit) — et quand le terrain est assuré, c'est l'ASSUREUR qui absorbait la part
fantôme à la place du visiteur.

Correction (option A du rapport, retenue) : `if(!state.settings.bankCollectsRent) payableShare -=
purchasableBankShare(p)/100;` — exactement le même traitement que `reservedUncollectedPct` juste au-dessus
(une part non encaissable par personne est retirée du loyer dû, jamais payée par le visiteur en premier
lieu). Portée : terrains de couleur uniquement (aéroports/services étaient déjà propres, leur loyer dû
étant la somme des parts réellement distribuées). Étendu PROACTIVEMENT au même bug, au mot près, dans
`settleNeutralPawnRent` (code jumeau, pion neutre atterrissant sur un terrain de couleur) — pas
explicitement demandé par l'audit (qui ne portait que sur `settlePropertyRent`), mais laisser ce code
jumeau non corrigé aurait créé une incohérence entre les deux chemins pour exactement le même défaut.

### Correctif 2 — L'accord de compensation annulait la retenue de prêt (majeure, exploitable)

Quand la part d'un propriétaire était compensée (inscrite au registre d'un accord de compensation de loyer
au lieu d'être payée en argent), `applyLoanWithholding` ne la voyait jamais : le bloc de compensation
retirait les parts concernées de `distributionCuts` AVANT que le calcul de retenue de prêt (`cutResults`)
n'ait la moindre chance de s'appliquer sur cette liste. Le prêteur ne touchait donc rien, alors que
l'emprunteur avait bel et bien encaissé la valeur économique du loyer sous forme de créance — exploitable
délibérément : un CEO endetté n'avait qu'à signer un accord de compensation avec l'entreprise la plus
susceptible de visiter ses terrains (250 K$ de frais, une seule fois) pour que son prêteur ne voie plus
jamais un dollar de retenue, quel que soit le montant du prêt.

Correction (option A du rapport, « le prêteur se sert en premier ») : dans la boucle de compensation,
`applyLoanWithholding(c.companyId, c.amount)` est désormais appelé sur la part BRUTE, AVANT toute inscription
au registre. Seul le NET (après retenue) entre au registre de compensation et réduit `payable` d'autant —
la portion retenue reste due EN ARGENT par le visiteur (elle reste dans `payable`, donc toujours assurable :
c'est un décaissement réel). Le prêteur est payé par le circuit de versement EXISTANT (`cutResults.forEach`
plus bas), sans dupliquer sa logique banque/entreprise/joueur : une part SYNTHÉTIQUE est réinjectée dans
`distributionCuts`, dont le montant est la seule portion retenue et dont le net vaut zéro (le propriétaire ne
touche rien en argent pour cette part — elle est allée au prêteur), marquée `_precomputedByCompensation`.
Garde contre la double retenue (le point critique signalé par l'utilisateur) : `cutResults =
distributionCuts.map(...)` reconnaît désormais cette marque et RÉUTILISE le résultat déjà calculé au lieu de
rappeler `applyLoanWithholding` une seconde fois — `loan.repaidSoFar` n'est donc jamais incrémenté en double
pour la même part. Les messages de journal annoncent désormais le NET inscrit au registre (jamais le brut),
avec une phrase supplémentaire quand une portion a été retenue en argent pour un prêt actif. Note du rapport,
hors périmètre, respectée : une part compensée ne produit toujours aucune écriture `rent_revenue` au grand
livre du propriétaire (seule la portion synthétique retenue, elle, transite par le circuit normal —
`rent_revenue`/`loan_repayment_via_rent` s'y annulent exactement, cohérent avec son net à zéro).

### Correctif 3 — Libellés du reçu : le swap franchit les blocages (moyenne, visible à l'écran)

Comportement voulu, confirmé par l'utilisateur : le partenaire d'un swap encaisse sa redirection même si le
propriétaire d'origine est sous enquête AMF ou si sa part est hypothéquée — un revenu de swap vient du
terrain de QUELQU'UN D'AUTRE, il n'est donc affecté ni par l'un ni par l'autre. Le problème était uniquement
l'affichage : le même reçu montrait deux lignes contradictoires (« Sophia Rail (enquêtée par l'AMF) : 0,00 »
puis « Sophia Rail (part via swap) : +104 K$ »), illisible à la table.

Correction : la scission du swap (`splitCuts`, dans `settlePropertyRent` ET `settleNeutralPawnRent`) transporte
désormais `fromOwnerId` (le `companyId` du propriétaire d'origine, déjà disponible au point d'appel — aucun
besoin de le faire remonter par `swapSplit` lui-même). Le libellé du versement au partenaire nomme
maintenant explicitement la provenance et lève l'ambiguïté : « Partner Co (revenu de swap versé par Swap
Co — un swap n'est affecté ni par l'enquête AMF ni par l'hypothèque du partenaire) ». La ligne de blocage
(boucle d'information sur `p.owners`, avant réservée à l'AMF) précise maintenant que c'est LA PART de ce
propriétaire qui ne rapporte rien, avec son pourcentage (déjà disponible via `o.share`) : « Sophia Rail —
sa part de 20% ne rapporte rien (enquête AMF) ». Nouvelle branche symétrique pour une part hypothéquée,
absente auparavant (le reçu était muet sur cette raison de blocage alors qu'il en parlait déjà pour l'AMF).
La garde qui neutralise le swap quand le visiteur en est lui-même le partenaire (`swapSplit`) n'a pas été
touchée — vérifiée correcte par l'audit, hors périmètre de ce correctif.

### Tests

Nouveau fichier dédié `smoke_test_step257_audit_a1_settlement_fixes.js` (3 groupes, 22 assertions) : (A)
conservation monétaire TOTALE (banque + Σ joueurs + Σ entreprises) avant/après règlement sur un terrain de
couleur partiellement vendu (40%/30%/30% banque), `bankCollectsRent=false` — 0 fuite, le visiteur ne paie
plus que les 70% réellement distribués, chaque propriétaire reçoit sa part exacte ; contre-épreuve
`bankCollectsRent=true` : conservation toujours parfaite, la banque encaisse bien ses 30% (comportement
pré-existant inchangé) ; (B) prêt joueur (30% de retenue) sur un propriétaire à 100% — sans accord de
compensation : non-régression (visiteur paie le plein loyer, propriétaire reçoit le net, prêteur reçoit la
retenue, `repaidSoFar` avance d'un cran) ; AVEC accord de compensation : le prêteur reçoit QUAND MÊME sa
retenue en argent réel, le propriétaire ne touche rien en cash, le visiteur ne paie plus que la portion
retenue, SEUL le net entre au registre de compensation, et surtout `repaidSoFar` n'avance que d'UN SEUL
cran (aucune double retenue) ; (C) terrain avec un propriétaire sous enquête AMF (20%), un propriétaire
hypothéqué (20%) et un propriétaire ayant swappé 100% de sa part vers un partenaire (30%) — les deux lignes
de blocage mentionnent la part exacte et la bonne raison (AMF/hypothèque), le partenaire du swap reçoit sa
part en argent réel avec un libellé nommant sa provenance et l'immunité AMF/hypothèque, plus jamais
l'ambigu « part via swap ». `node -c script_extracted.js` après chaque bloc. Suite complète (178 scripts
désormais) relancée à 3 reprises consécutives : **0 échec**. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 258. Swap de loyers « général » — application à tout le portefeuille d'une entreprise (présent et futur)

### Origine

Demande explicite de l'utilisateur, verbatim : « dans swap ajouter une option : swap général donc
application à toutes les terrains. par exemple Julien propose un swap général de ses terrains pour 200K
contre 300K des terrains de Mathieu. »

Avant cette section, un swap de loyers (`createRentSwap`/`proposeRentSwap`) désignait toujours UN terrain
précis par côté (ou un lot regroupé, compté comme un seul actif). Impossible de conclure un accord large
portant sur l'ensemble du portefeuille d'une entreprise sans lister — et re-signer à chaque acquisition —
un swap par terrain.

Deux points de conception restaient ouverts dans la demande initiale ; clarifiés avec l'utilisateur via
AskUserQuestion avant toute implémentation :
- **Plafond** : le plafond d'un côté général suit-il un budget total cumulatif, ou le même mécanisme « par
  événement » (non cumulatif) que les swaps spécifiques existants ? Réponse retenue : **« Plafond par
  événement »** — identique au comportement déjà en place, aucun nouveau concept de budget.
- **Portée** : un swap général couvre-t-il un instantané du portefeuille à la signature, ou suit-il
  l'entreprise dans la durée, achats futurs compris ? Réponse retenue : **« Tous les terrains, y compris
  les futurs achats (recommandé) »** — un swap général vise l'ENTREPRISE, pas une liste figée de terrains.

### Diagnostic / conception retenue

Chaque côté d'un swap (`state.rentSwaps`/`state.rentSwapOffers`) gagne un booléen `generalA`/`generalB`.
Quand vrai pour un côté, `propA`/`propB` de ce côté vaut `null` et n'est jamais utilisé — le swap porte
sur TOUT terrain actuellement possédé par l'entreprise concernée, peu importe qu'il ait été acquis avant
ou après la signature.

**Aucun instantané n'est nécessaire pour la portée dynamique** : `swapSplit(propId, ownerId, visitorId,
cutAmount)` est déjà réévalué à chaque atterrissage contre l'ownership RÉEL du moment (`ownerId`, tiré de
`p.owners` au moment du règlement) — un côté général se contente donc de filtrer par `companyId` plutôt
que par `propertyId`, et le comportement « couvre aussi les achats futurs » en découle naturellement, sans
code dédié à la synchronisation.

**Précédence spécifique > général** (décision de conception propre à cette implémentation, non demandée
explicitement mais nécessaire dès que les deux types peuvent coexister pour la même entreprise) :
`swapSplit` cherche d'abord un swap SPÉCIFIQUE correspondant exactement au terrain visité ; ce n'est que
s'il n'en trouve aucun qu'il retombe sur un swap GÉNÉRAL de la même entreprise. Le choix se fait terrain
par terrain, pas swap par swap : un swap spécifique sur un terrain A n'empêche pas un swap général de
s'appliquer normalement sur un terrain B de la même entreprise, non couvert par le spécifique.

**`swapAssetValueSummary(propId, companyId, isGeneral)`** gagne un 3e paramètre : en mode général, plus de
terrain unique à décrire — la fonction parcourt `tradableAssets()` (déjà dédupliqué par lot) et additionne
la valeur intrinsèque et la part de loyer de TOUT ce que l'entreprise possède actuellement, explicitement
étiqueté « actuellement (variera avec les achats/ventes futurs) » plutôt que présenté comme une valeur
figée à la signature — cohérent avec la décision « suit l'entreprise, pas un instantané ». Une entreprise
sans aucun terrain aujourd'hui affiche « aucun terrain possédé actuellement (le swap général s'appliquera
aux futurs achats) » plutôt qu'un montant à zéro trompeur.

**`createRentSwap`/`proposeRentSwap`** gagnent `generalA`/`generalB` en fin de liste de paramètres
(convention déjà en place pour les paramètres optionnels) — tous les appels existants (7 arguments
positionnels, sans ces deux nouveaux paramètres ni `opts`) restent inchangés : `!!undefined` retombe sur
`false`, comportement 100% identique à avant cette section. Les gardes de propriété (« l'entreprise
possède-t-elle bien ce terrain ? ») et la garde d'unicité (`samePropertyOrLot(propA,propB)`) sont
entièrement sautées pour un côté général — **une entreprise peut proposer et faire accepter un swap
général sans posséder le moindre terrain**, conformément à la portée dynamique confirmée par
l'utilisateur.

**UI (`modalProposeSwap`)** : une case « Swap général » par côté remplace le blocage total qui existait
avant cette section (« Vous devez posséder au moins un terrain... », retiré). Une entreprise sans aucun
terrain échangeable voit sa case précochée ET verrouillée côté A (rien à désigner) plutôt que de voir la
modale refuser de s'ouvrir. Cocher la case masque le sélecteur de terrain correspondant. Le bouton
« 🔄 Swap » de Mon Entreprise (`renderEntreprise`) perd sa garde `myTradableAssetsForSwap.length>0` pour
la même raison. `modalSwapOfferDetails` et les blocs d'affichage des offres en attente/swaps actifs
(`renderEntreprise`) passent `generalA`/`generalB` à `swapAssetValueSummary` et affichent « Tous les
terrains de {entreprise} » à la place d'un nom de terrain quand le côté est général.

`migrateState()` : tout swap déjà en base avant cette section porte forcément deux côtés spécifiques
(l'option n'existait pas encore) — backfill `generalA`/`generalB` à `false` pour `state.rentSwaps` et
`state.rentSwapOffers`.

### Tests

Nouveau fichier dédié `smoke_test_step258_general_swap.js` (6 groupes, 24 assertions) : (A) un swap
général créé via `proposeRentSwap`+`acceptRentSwapOffer` s'applique à PLUSIEURS terrains distincts de
l'entreprise, jamais désignés individuellement ; (B) un swap GÉNÉRAL↔GÉNÉRAL est proposable et acceptable
alors qu'AUCUNE des deux entreprises ne possède de terrain, puis un terrain acquis APRÈS coup est
automatiquement couvert dès le premier atterrissage d'un tiers — portée dynamique confirmée ; (C)
précédence : un swap spécifique l'emporte sur un swap général pour le même terrain, mais un AUTRE terrain
de la même entreprise, non couvert par le spécifique, retombe bien sur le général — le choix se fait
terrain par terrain ; (D) plafond par événement non cumulatif : deux visites successives sur deux terrains
différents, couverts par le même swap général plafonné, redirigent chacune EXACTEMENT le plafond, sans
notion de budget déjà consommé ; (E) immunité préservée quand le visiteur est lui-même le partenaire du
swap général ; (F) interaction avec le correctif de libellés de la section 257 : sur un terrain à deux
copropriétaires, la part de l'un (enquêté AMF, sans lien avec le swap) reste bloquée pendant que la part
de l'autre, redirigée par un swap général, est bel et bien versée en argent réel avec un libellé nommant
correctement sa provenance (`fromOwnerId`). `node -c script_extracted.js` après chaque bloc d'édition.
Suite complète (179 scripts désormais) relancée à 3 reprises consécutives : **0 échec** — y compris après
mise à jour de `smoke_test_step55_phase3_polish.js` (Point 17), dont l'assertion testait l'ANCIEN
comportement bloquant (« swap sans terrain → alert() et modale fermée ») intentionnellement remplacé par
cette section (« swap sans terrain → modale ouverte en mode général précoché/verrouillé »). `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html`
(`diff` vide dans les 2 cas).

## 259. Swap de loyers « à budget cumulatif » — bouton indépendant, sans durée, plafond total à vie

### Origine

Demande explicite de l'utilisateur, verbatim : « Ajoute un autre bouton dans les actions mon entreprise
(nomme le à ta guise) indépendant des autres options de swap. Proposition de swap entre 2 joueurs mais
sans limite de temps seulement un plafond. Ce type de swap s'applique sur tout les terrains fonctionne
comme un swap normale, choisit les montants par passage qui peuvent être asymétrique. le swap prend fin
quand le plafond est atteint cumulative. Donc si Julien a obtenu [son plafond] en swap cumulative sa part
arrête et mehdi continue de collecter sa part tant qu'il n'atteint pas aussi son [plafond]. même frais
d'implémentation qu'un swap ordinaire. »

### Diagnostic / conception retenue

Trois points d'interprétation ont dû être tranchés sans aller-retour (jugés non ambigus au vu du reste de
la demande) :
- **Toujours général des deux côtés** (« s'applique sur tout les terrains ») — aucun terrain à désigner,
  réutilise directement l'infrastructure générale de la section 258 (`generalA`/`generalB` forcés à
  `true`, `propA`/`propB` toujours `null`).
- **Plafond par événement initialement omis pour ce type** — « fonctionne comme un swap normal » avait été
  compris comme : le calcul du montant redirigé par visite suit exactement le même moteur que n'importe
  quel swap (pas de logique de rendu dupliquée), mais rien ne le plafonne PAR ÉVÉNEMENT, seul le budget
  cumulatif agissant comme limite. **Corrigé suite au retour de l'utilisateur — voir la sous-section
  « Correction apportée après livraison » plus bas : le plafond par événement (`capA`/`capB`) est
  finalement pleinement disponible pour ce type, en plus du plafond cumulatif.**
- **`budgetCapA`/`budgetCapB` remplacent entièrement `years`** (« au lieu d'un temps maximum c'est un
  budget ») — un swap à budget n'a AUCUNE durée ; il se termine uniquement par épuisement.

Nouveaux champs sur `state.rentSwaps`/`state.rentSwapOffers` : `budgetMode` (booléen), `budgetCapA`/
`budgetCapB` (plafonds cumulatifs À VIE, potentiellement asymétriques — ex. 3M$ pour une entreprise, 2M$
pour l'autre), `disbursedA`/`disbursedB` (cumul déjà reçu par chaque entreprise via CE swap). Convention
conservée de la section 168 : `budgetCapA`/`disbursedA` sont indexés par le RÉCEPTEUR (companyA), pas par
le cédant — cohérent avec la façon dont l'utilisateur a décrit le mécanisme (« Julien a obtenu [X] [...]
sa part arrête »), et symétrique à `capA`/`capB` des swaps ordinaires (indexés par le côté PROPRIÉTAIRE
qui cède).

`swapSplit()` gagne une branche `budgetMode` : après l'immunité propriétaire/partenaire (inchangée), le
montant redirigé au partenaire est `Math.min(cutAmount, budgetCapPartenaire - disbursedPartenaire)` —
c'est-à-dire l'intégralité du loyer, sauf si cela dépasserait ce qu'il reste au partenaire à recevoir, ce
qui cape exactement au plafond. **`disbursedA`/`disbursedB` sont mutés ICI en effet de bord**, au moment
où l'argent change réellement de main — même principe que `applyLoanWithholding`, qui mute
`loan.repaidSoFar` à chaque appel (précédent déjà en place dans ce code) : `swapSplit` n'est jamais appelé
hors d'un règlement RÉEL (`settlePropertyRent`/`settleNeutralPawnRent`), jamais pour un simple aperçu — la
mutation est donc sûre. Le swap est retiré de `state.rentSwaps` uniquement quand les DEUX plafonds sont
pleinement atteints (`disbursedA>=budgetCapA && disbursedB>=budgetCapB`) — tant qu'un seul des deux est
atteint, ce côté-LÀ s'arrête (le propriétaire visité garde tout dès cet instant) tandis que l'autre côté
continue de fonctionner normalement, exactement comme demandé.

Comme un swap à budget n'a pas de durée, `yearsRemaining`/`yearsTotal` restent `null` pour ce type — la
garde d'activité dans `swapSplit` (`s.yearsRemaining>0`) est étendue à `s.budgetMode || s.yearsRemaining>0`
(sans quoi `null>0` étant faux, un swap à budget ne matcherait jamais). Le décompte de fin d'année
(`processYearEnd`) saute désormais les swaps `budgetMode` (`if(!s.budgetMode) s.yearsRemaining -= 1;`) et
ne les retire jamais par le passage du temps (`s.budgetMode || s.yearsRemaining>0` au filtre).

`createRentSwap`/`proposeRentSwap` gagnent `budgetCapA`/`budgetCapB` en toute fin de liste de paramètres
(convention déjà en place). `budgetMode = !!(budgetCapA>0 && budgetCapB>0)` — dès que les deux sont
fournis, le reste (généralité forcée, pas de plafond par événement, pas de validation de durée) suit
automatiquement. Tous les appels existants (sans ces deux paramètres) restent inchangés — `même frais
d'implémentation qu'un swap ordinaire » : réutilisation intégrale du flux propose→accepte→refuse→retire
déjà en place, aucune fonction dupliquée.

**Bouton indépendant** (`openProposeBudgetSwapBtn` → `modalProposeBudgetSwap()`, libellé « 💰 Swap à
budget ») dans le même groupe « Assurance & Swaps » que le bouton « 🔄 Swap » existant, mais modale
volontairement plus simple : ni sélection de terrain, ni durée — seulement l'entreprise partenaire et les
deux plafonds cumulatifs (potentiellement différents). `modalSwapOfferDetails` et les blocs d'affichage
des offres en attente/swaps actifs (`renderEntreprise`) distinguent `budgetMode` : plafond cumulatif total
à la place du plafond par événement, progression `disbursedX/budgetCapX` à la place de la durée
`yearsRemaining/yearsTotal` dans le tableau des swaps actifs.

Interaction avec la section 258 : un swap à budget est un cas particulier de swap général — il est donc
soumis à la MÊME règle de précédence (« spécifique gagne sur général ») que tout autre swap général.

`migrateState()` : tout swap déjà en base avant cette section reçoit `budgetMode:false` par backfill.

### Tests

Nouveau fichier dédié `smoke_test_step259_budget_swap.js` (5 groupes, 26 assertions) : (A) bouton
indépendant et flux propose/accept complet — aucun terrain requis, l'offre ET le swap actif portent
`budgetMode:true` avec les deux plafonds, `generalA`/`generalB` forcés, `propA`/`propB`/`capA`/`capB`/
`years` tous `null` ; (B) mécanique cumulative asymétrique — cas exact de l'exemple utilisateur (plafonds
différents type Julien/Mehdi) : redirection intégrale tant qu'aucun plafond n'est atteint, plafonnement en
cours de visite (conservation vérifiée), arrêt total d'un côté une fois SON plafond atteint pendant que
l'autre côté continue indépendamment jusqu'au sien ; (C) clôture uniquement quand les DEUX plafonds sont
atteints — persistance vérifiée après un seul côté épuisé, retrait vérifié après les deux ; (D)
non-régression durée/fin d'année : `processYearEnd` répété (3 fois) ne retire jamais un swap à budget,
`yearsRemaining` reste `null` ; (E) immunité préservée (visiteur = partenaire) et interaction avec la
précédence de la section 258 (un swap spécifique ordinaire l'emporte sur un swap à budget général
coexistant sur le même terrain). `node -c script_extracted.js` après chaque bloc. Suite complète (180
scripts désormais) relancée à 3 reprises consécutives : **0 échec**. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

### Correction apportée après livraison — ajout du plafond par événement

Retour de l'utilisateur, verbatim, immédiatement après la livraison de la version ci-dessus : « Non il faut
un plafond par événement aussi. » Ceci rejette explicitement le choix de conception « aucun plafond par
événement pour ce type » retenu plus haut (qui avait été clairement signalé à l'utilisateur comme une
décision unilatérale au moment de la livraison).

**Correction retenue** : le plafond par événement (`capA`/`capB`, déjà existant pour les swaps ordinaires)
devient pleinement disponible pour les swaps à budget, EN PLUS du plafond cumulatif (`budgetCapA`/
`budgetCapB`) — les deux limites coexistent et c'est la PLUS restrictive qui s'applique à chaque événement.
Les deux plafonds gardent des conventions d'indexation différentes, conservées telles quelles pour ne pas
changer rétroactivement le sens déjà documenté et testé de `budgetCapA`/`budgetCapB` : `capA`/`capB`
restent indexés par le côté PROPRIÉTAIRE qui cède (comme pour un swap ordinaire), tandis que
`budgetCapA`/`budgetCapB`/`disbursedA`/`disbursedB` restent indexés par le côté RÉCEPTEUR (comme conçu à la
livraison initiale de cette section). `swapSplit()` combine correctement les deux conventions dans sa
branche `budgetMode` : le plafond par événement se lit via `isA` (côté cédant), le plafond cumulatif et son
cumul déjà versé se lisent via `!isA` (côté receveur) — même variable `isA`, deux sens de lecture différents
selon le plafond consulté.

### Corrections apportées

`swapSplit()` (branche `budgetMode`) : le montant redirigé au partenaire est désormais borné successivement
par (1) le plafond par événement du cédant s'il est fourni (`Math.min(cutAmount, capCédant)`), puis (2) le
solde restant du plafond cumulatif du receveur (`Math.min(..., budgetCapReceveur - disbursedReceveur)`) — la
plus restrictive des deux limites l'emporte à chaque visite, exactement comme demandé. `createRentSwap()`/
`proposeRentSwap()` : la mise à `null` forcée de `capA`/`capB` en mode budget est supprimée (seuls
`propA`/`propB` restent forcés à `null`, puisque le mode reste toujours général) — ces deux plafonds sont
maintenant transmis normalement, qu'ils soient fournis (optionnels) ou non. `modalProposeBudgetSwap()` :
deux nouveaux champs optionnels « Plafond par événement » (un par côté), en plus des deux champs de plafond
cumulatif déjà présents ; le texte explicatif de la modale précise désormais que les deux plafonds
combinent, le plus restrictif s'appliquant à chaque passage. `modalSwapOfferDetails()` et les blocs
d'affichage des offres/swaps actifs (`renderEntreprise`) : la ligne « Plafond par événement » redevient
toujours visible (y compris en mode budget, si un plafond a été fourni) et une ligne complémentaire affiche
la progression du plafond cumulatif — les deux informations coexistent désormais au lieu de s'exclure.

### Tests

`smoke_test_step259_budget_swap.js` étendu d'un sixième groupe (F, 10 assertions supplémentaires, 36 au
total) : reproduit l'exemple utilisateur avec un plafond par événement fixé à 30 % du loyer et un plafond
cumulatif fixé à 2,5× ce plafond par événement, puis 4 visites successives sur le même terrain — visites 1
et 2 plafonnées PAR ÉVÉNEMENT (budget encore large, montant reçu identique aux deux visites, cumul exact
2×plafond) ; visite 3 plafonnée par le SOLDE DU BUDGET restant (strictement inférieur au plafond par
événement, cumul atteignant exactement le plafond cumulatif) ; visite 4 à zéro (budget épuisé, propriétaire
garde tout malgré un plafond par événement qui laisserait normalement passer un montant). Les groupes (A) à
(E) existants ont été relancés sans modification après les correctifs et passent tel quel, confirmant la
rétrocompatibilité (aucun de ces groupes ne fournissait de plafond par événement explicite, donc leur
comportement — plafond cumulatif seul — reste identique). `node -c script_extracted.js` après chaque
édition. Suite complète (180 scripts) relancée à 3 reprises consécutives : **0 échec** imputable à cette
correction (un échec isolé et non reproductible de `smoke_test_step193_stock_cube_floor.js`, test
probabiliste sans rapport avec les swaps, observé une seule fois sur les 3×180 exécutions puis confirmé
stable sur 5 relances supplémentaires — flakiness préexistante, non liée à ce changement). `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 260. Audit externe — module Options : 5 correctifs (plancher asymétrique, garde flux nul, marge des spreads, échelle des grecques, signe du coût net)

### Origine

Audit externe reçu de l'utilisateur (rapport complet collé tel quel dans la conversation, structuré en 5
correctifs numérotés), portant sur le module Options (options simples + stratégies bull/bear spread/ATM
straddle, sections 131/218/235). Aucune reformulation ci-dessous — chaque diagnostic et chaque correctif
retenu reprend fidèlement le raisonnement et les recommandations du rapport original.

### Correctif 1 — le plancher de prime ne doit s'appliquer qu'à l'achat

**Diagnostic.** `OPTION_PREMIUM_FLOOR_PCT` (0,5 % du cours) était appliqué dans `optionPremiumFor()`
symétriquement, au prix d'achat comme au prix de vente. Sur les 120 cotations de la partie de test de
l'audit, 25 (21 %) n'étaient plus le prix Black-Scholes mais le plancher, avec des écarts allant jusqu'à
×16 878. Deux exploits, faces d'une même pièce :
- **Exploit A (spread gratuit)** : quand les deux jambes d'un spread tombent sur le plancher, elles se
  cotent au même prix et s'annulent exactement — coût nul à l'ouverture pour un gain potentiel réel (un bear
  spread 80/90 reproduit intégralement par l'interface affichait « Crédit net reçu à l'ouverture : 0 K » et
  rapportait jusqu'à 50 000 $ sans mise, répétable sans limite).
- **Exploit B (écrire du vide)** : écrire 1 000 puts très hors-jeu encaissait le plancher (50 000 $) pour un
  risque valant 2,96 $ en Black-Scholes — la marge exigée était nulle (position réputée cash-secured, ce
  raisonnement-là est correct ; c'est le PRIX de vente qui ne l'était pas).

La cause : une intention légitime (empêcher qu'une option très hors-jeu devienne un levier gratuit à
l'achat) appliquée trop largement (elle protégeait aussi le vendeur). Aggravé par la volatilité dérivée du
moteur de cubes, souvent faible (~8,3 %/an pour une entreprise Dividendes) — Black-Scholes tarife alors un
mouvement de 20 % en 3 lancers à quelques millièmes de dollar, très en-dessous du plancher proportionnel au
cours (pas au risque).

**Correctif retenu.** Le sens de la transaction décide : l'acheteur paie au minimum le plancher (intention
d'origine intégralement préservée) ; le vendeur reçoit la valeur Black-Scholes réelle, sans plancher.
`optionPremiumFor(company, type, strike, expiryRoll, isBuying)` gagne un 5e paramètre : `isBuying===false`
(vente, ou valorisation pure) retourne le Black-Scholes brut ; toute autre valeur (`true` OU omis) applique
le plancher — DÉLIBÉRÉMENT le comportement par défaut le plus PROTECTEUR (un appelant qui omettrait ce
paramètre par erreur reste protégé plutôt que de rouvrir un exploit), plutôt que l'inverse. La fonction reste
le point d'entrée UNIQUE — aucune logique dupliquée ailleurs.

Câblé chez les 3 familles d'appelants identifiées par l'audit :
- **Famille 1 — ouverture** : `openOptionPosition`/`openOptionStrategy` (`isBuying = side==='long'`, par
  jambe pour une stratégie) + leurs 2 aperçus de modale (`modalOptionTrade`/`modalOptionStrategy`, MÊME
  règle que l'exécution, recalculée UNE SEULE fois par jambe pour l'aperçu de stratégie — auparavant appelée
  deux fois sans le côté, source de redondance en plus d'incohérence potentielle).
- **Famille 2 — fermeture** : `closeOptionPosition`, côté INVERSÉ par rapport à `pos.side` (fermer une
  position LONGUE = la VENDRE, pas de plancher ; fermer une position ÉCRITE = la RACHETER, plancher).
- **Famille 3 — valorisation, pas une transaction** : table des positions, table des stratégies, `netWorth`,
  `playerNetWorthReconciliation`, le choix du candidat dans `enforceMarginCalls`, les deltas de portefeuille
  (`computePlayerPortfolioDeltas` — le `premiumPrev` y avait aussi son propre plancher inline, retiré),
  toutes marquées au Black-Scholes brut (`isBuying:false`), SAUF la chaîne d'options affichée
  (`modalOptionChain`) : recommandation spécifique de l'audit pour ce cas précis (« un tableau de
  cotations ») — garde une seule colonne (le prix D'ACHAT, celui que la majorité des joueurs consultent)
  plutôt que d'en afficher deux, mais le dit EXPLICITEMENT en légende (« Prix affiché = prix D'ACHAT [...]
  le prix de VENTE [...] peut être plus bas »).

**Conséquence assumée** (documentée par l'audit, vérifiée par les tests) : un aller-retour ouverture+
fermeture immédiate d'une position ÉCRITE affiche désormais un coût réel (l'écart achat-vente) quand
l'option est assez hors-jeu pour que le plancher morde côté rachat — plus jamais garanti à 0 comme avant ce
correctif (voir `smoke_test_step229_portfolio_evolution_popup.js`, groupe E, mis à jour en conséquence).

### Correctif 2 — refuser une structure qui ne coûte rien

Filet de sécurité générique, utile même après le correctif 1 (qui referme déjà les deux exploits par
lui-même) : attrape n'importe quelle future combinaison de paramètres qui recréerait un flux net nul.
`openOptionStrategy` refuse désormais l'ouverture si `Math.abs(netFlow)<1e-6` (négligeable, epsilon = 1$ réel
de flux total) avec un message explicite (« cette structure ne coûte rien et ne peut que rapporter [...] ce
n'est pas un contrat valide »). Les 3 stratégies réelles (bull/bear spread, straddle) ont TOUJOURS un
potentiel de gain non trivial vu les gardes de strikes déjà en place — le garde-fou ne bloque donc jamais un
trade légitime.

### Correctif 3 — la marge doit voir la jambe longue d'un spread

**Diagnostic.** `optionCoveredShares()` ne reconnaissait que 2 couvertures (parts détenues/cash), jamais la
jambe LONGUE de la même stratégie. Comparaison chiffrée de l'audit, 200 contrats : un call nu écrit (perte
illimitée) et un bull spread ACHETÉ 100/110$ (perte maximale réelle 147K$) exigeaient EXACTEMENT la même
marge (600K$) — le spread mobilisait jusqu'à 4-5× sa perte maximale réelle. Conséquence concrète : un bull
spread de 9 000 contrats, joueur solvable (perte max réelle 9,00M$ contre 19,96M$ de valeur nette), déclenche
un appel de marge INJUSTIFIÉ sous l'ancien calcul (marge exigée 27,00M$, comme si la jambe courte était nue)
— démembrement forcé de la jambe courte, le joueur se retrouve avec une position directionnelle non voulue
alors qu'il n'était jamais en danger.

**Correctif retenu.** Nouvelle fonction `optionSpreadCoverage(player, pos)` : cherche, pour une option
ÉCRITE portant un `strategyId`, une jambe LONGUE encore vivante du MÊME `strategyId`/type/échéance (une
stratégie n'a que 2 jambes — jamais d'ambiguïté). Retourne la quantité protégée (min des 2 jambes) et la
perte maximale RÉELLE par contrat de la paire : call écrit couvert par un call long — marge nulle si
strikeLong≤strikeÉcrit, sinon perte bornée par (strikeLong−strikeÉcrit) ; put écrit couvert par un put long —
marge nulle si strikeLong≥strikeÉcrit, sinon perte bornée par (strikeÉcrit−strikeLong). `requiredMaintenance
Margin()` applique cette perte réelle (SANS le rabais de 30% — ce n'est pas une base notionnelle à
haircuter, c'est déjà le pire cas exact) sur la portion protégée, APRÈS la couverture classique
(`optionCoveredShares`, pour ne jamais compter une même part/un même cash deux fois) ; le reliquat garde le
calcul notionnel nu à 30 % inchangé. Se referme tout seul dans le bon sens si la jambe longue est fermée
entre-temps (par un appel de marge antérieur) : plus de jambe sœur trouvée → redevient pleinement nue au
prochain calcul.

**À ne pas toucher** (rappelé explicitement par l'audit) : la sous-estimation VOLONTAIRE déjà documentée
dans `optionCoveredShares` (un même bloc d'actions/cash peut couvrir plusieurs options écrites à la fois,
calculée indépendamment pour chacune) reste telle quelle — hors-scope de ce correctif.

### Correctif 4 — échelle d'affichage des grecques

**Diagnostic.** Vega et Theta, calculés dans l'échelle interne M$ (comme `stockPrice`/les primes — voir
`fmtPrice`, ×1e6 pour des $ réels), s'affichaient donc systématiquement `V0.00`/`Θ-0.00` sur toute la chaîne
(l'audit mesure un Vega réel de 0,37$ affiché comme 0,00). Gamma souffrait du problème inverse (unités
INVERSES à S) : rapporté à un mouvement de cours d'1 MILLION de $ (l'unité interne), il produisait des
nombres à 5 chiffres (Γ44 253) illisibles. Delta (un ratio sans dimension) était déjà correct.

**Correctif retenu.** Nouvelle fonction `greeksForDisplay(g)` — mise à l'échelle d'AFFICHAGE uniquement, le
calcul (`blackScholesGreeks`/`optionGreeksFor`/`optionGreeksDisplay`/`optionPositionGreeks`) reste
TOTALEMENT inchangé : Vega/Theta ×1e6 (mêmes $ réels que `fmtPrice`), Gamma ÷1e6 (rapporté à 1$ de cours
réel), Delta inchangé. Appliquée aux 3 points d'affichage (table « Mes positions d'options », chaîne
d'options, aperçu de la modale de trade), avec la précision portée à 3 décimales pour Vega/Theta (les
petites valeurs restent visibles, demande explicite de l'audit).

### Correctif 5 — le signe et la couleur qui se contredisent

**Diagnostic.** La colonne « Coût net à l'ouverture » de la table des stratégies affichait déjà la bonne
COULEUR (rouge pour un débit net payé, vert pour un crédit net reçu — correction antérieure, section 236)
mais le NOMBRE suivait encore la convention VALEUR (`costAtOpen`, positif pour un débit) : un débit payé
s'affichait `+8 K$` en ROUGE — le signe contredit sa propre couleur et le libellé de la modale d'ouverture
(« Débit net payé »/« Crédit net reçu »).

**Correctif retenu.** `netFlowAtOpen = -costAtOpen` affiché à la place de `costAtOpen` (la couleur, elle,
reste basée sur `costAtOpen` — déjà correcte, inchangée) : débit payé → négatif ET rouge, crédit reçu →
positif ET vert, cohérent avec le libellé de la modale. La colonne P&L latent juste à côté reste en logique
gain/perte, inchangée (non concernée par ce correctif).

### Ce qui n'a PAS été fait (recommandation explicite de l'audit)

L'audit mentionnait une option consistant à rendre le plancher proportionnel au RISQUE plutôt qu'au cours
(ex. un % de la valeur d'une option ATM de même échéance) — délibérément PAS implémentée : le correctif 1
referme déjà les deux exploits, cette raffinerie ajoute une notion difficile à expliquer à la table pour un
gain marginal. À reconsidérer seulement si le plancher mord encore trop souvent côté acheteur.

### Tests

Nouveau fichier dédié `smoke_test_step260_options_audit_fixes.js` (8 groupes A-H, 39 assertions), 12
compagnies + 12 CEO dédiés (leçon de la section 233 sur l'isolation — un joueur ne peut fonder qu'UNE
entreprise, `createCompany` refuse silencieusement sinon) + 3 traders communs (CEO d'aucune d'entre elles) :
(A) reproduction directe de l'Exploit A (bear spread très hors-jeu) — coût net désormais un débit RÉEL,
jamais 0, égal exactement à prime-vente-brute − prime-achat-flooréeSiNécessaire ; (B) reproduction directe de
l'Exploit B (1 000 puts très hors-jeu écrits) — encaissement = valeur Black-Scholes brute, strictement
inférieur à ce que l'ancien plancher symétrique aurait donné ; (C) non-régression: à la monnaie, achat et
vente restent identiques (le plancher ne mord jamais là) ; (D) le garde-fou du correctif 2 testé
directement (en neutralisant temporairement `optionPremiumFor` pour forcer un flux net nul) — refusé avec le
bon message, ET une structure à prix normaux (flux réel) reste acceptée ; (E) 4 sous-cas du correctif 3 —
(E1) bull spread acheté 100/110$ 200 contrats: marge nulle, (E2) call nu écrit même taille: marge inchangée
à 30% notionnel (comparaison directe), (E3) même spread à 9 000 contrats: marge toujours nulle ET aucun
appel de marge déclenché malgré un cash très limité (reproduit fidèlement l'exemple chiffré de l'audit),
(E4) bull spread VENDU (risque borné, pas nul): marge = perte réelle bornée par la différence des strikes,
sans rabais de 30% ; (F) `greeksForDisplay` vérifiée directement (delta inchangé, gamma÷1e6, vega/theta×1e6)
ET la légende « prix D'ACHAT » présente dans le HTML de la chaîne ; (G) signe cohérent avec la couleur
vérifié dans le HTML rendu de `renderPortefeuille()` — débit net payé négatif/rouge, crédit net reçu
positif/vert ; (H) non-régressions générales — parité put-call à la monnaie tient à 4 décimales,
conservation exacte de l'argent du système (banque+joueur) sur un aller-retour ouverture+fermeture complet.

`smoke_test_step229_portfolio_evolution_popup.js` (groupe E, aller-retour ÉCRIT) mis à jour: n'attend plus un
retour à 0 mais recalcule indépendamment le coût exact attendu de l'écart achat-vente (voir Correctif 1,
conséquence assumée) — confirmé conforme, plus une régression. `node -c script_extracted.js` après chaque
correctif. Suite complète (181 scripts désormais) relancée à 3 reprises consécutives : **0 échec**. `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 261. Audit externe — onglet Portefeuille (audit A3) : 3 correctifs (CEO sur le marché secondaire des privilégiées, arriérage de dividende comme passif, popup de réconciliation qui boucle)

### Origine

Audit externe reçu de l'utilisateur (rapport complet collé tel quel dans la conversation, structuré en 3
correctifs numérotés), portant sur l'onglet Portefeuille — parts privilégiées, bilan/ratio d'endettement de
l'entreprise, popup « Détails supplémentaires ». Verbatim intégral :

> Correctifs — onglet Portefeuille (audit n° 3)
> Trois écarts. Aucun n'est une fuite d'argent : le comptant, les shorts, les bons, les privilégiées et le
> marché de prêts sont tous exacts au centième et l'argent se conserve partout. Ce sont des angles morts — une
> interdiction qui s'arrête à mi-chemin, une dette qui n'est écrite nulle part, et un tableau qui ne montre pas
> son total.
>
> Correctif 1 — Le CEO ne doit pas pouvoir acheter les privilégiées de sa propre entreprise
> Le symptôme
> Le CEO d'une entreprise ne peut pas souscrire aux parts privilégiées de sa propre entreprise : le refus est
> explicite et motivé par le délit d'initié. Mais rien ne l'empêche de les acheter sur le marché secondaire au
> lancer suivant.
> Vérifié : l'achat est accepté, et le CEO émetteur apparaît ensuite dans la table des détenteurs aux côtés
> des vrais souscripteurs.
> Pourquoi ça compte : le CEO est la seule personne à savoir si l'entreprise pourra payer le dividende
> préférentiel de fin d'année, et si elle rappellera la tranche. Or le prix d'achat sur le marché secondaire
> est plafonné à min(cours ordinaire, prix de rachat), tandis que le rappel se fait au prix de rachat. Quand
> le cours ordinaire est sous le prix de rappel, l'écart est un gain sans risque, connu de lui seul, et
> déclenché par lui seul.
> Le correctif — étendre l'interdiction au marché secondaire
> Dans la fonction qui exécute l'achat d'une annonce de parts privilégiées, ajouter un refus quand l'acheteur
> est le CEO de l'entreprise émettrice. L'entreprise est déjà résolue à cet endroit — l'annonce porte son
> identifiant — donc le test est immédiat, et il se place naturellement juste à côté de celui qui empêche déjà
> d'acheter sa propre annonce.
> Reprends la même formulation que le refus existant à la souscription, pour que le joueur voie deux fois la
> même règle plutôt que deux règles différentes : le CEO d'une entreprise ne peut pas détenir ses propres
> parts privilégiées, neuves ou d'occasion.
> Deux choses à ne pas faire au passage :
> Ne bloque pas la mise en vente. Un CEO qui détiendrait déjà des privilégiées de sa propre entreprise — cas
> possible sur une partie sauvegardée avant le correctif — doit pouvoir s'en défaire. Bloquer la sortie
> l'enfermerait dans exactement la position qu'on veut interdire.
> Ne touche pas au refus d'acheter sa propre annonce. C'est une règle différente, qui vise le vendeur, pas
> l'émetteur. Les deux tests coexistent.
>
> Correctif 2 — L'arriérage de dividende préférentiel doit être un passif
> Le symptôme
> Un arriérage de dividende préférentiel est une obligation cumulative, d'un montant précis, qui bloque tout
> dividende ordinaire jusqu'à son règlement. Il n'apparaît nulle part.
> Mesuré avec un arriérage de 320 000 $ posé sur une entreprise : passif court terme 0 $, passif long terme
> 0 $, dette de l'entreprise 0 $, ratio d'endettement 0,0000. Le dividende préférentiel dû de l'année — un
> montant déclaré, daté, affiché à l'écran avec son bouton « Payer maintenant » — est absent lui aussi.
> Les trois conséquences
> L'équité au bilan est surévaluée du montant de l'arriérage, puisque l'équité est calculée comme l'actif
> moins le passif : un passif manquant devient mécaniquement de l'équité.
> La valeur d'entreprise est surévaluée d'autant. Elle alimente l'impôt sur le revenu de la case 4 et la cote
> de crédit.
> Le ratio d'endettement est sous-évalué — et c'est le plus gênant. Ce ratio alimente la prime de risque des
> hypothèques et des subventions d'avance. Une entreprise qui vient de manquer son dividende préférentiel
> obtient donc un meilleur taux d'emprunt qu'elle ne le mériterait, exactement au moment où elle est en
> difficulté. Le signal est à l'envers.
> Le correctif — mais il y a deux endroits, pas un
> C'est le point à ne pas rater. Les passifs de l'entreprise sont composés deux fois, dans deux fonctions
> distinctes qui listent chacune les mêmes trois éléments (hypothèques, subventions d'avance, prêts en
> cours) :
> La fonction qui compose les passifs des états financiers alimente le bilan, donc l'équité affichée.
> La fonction qui calcule la dette de l'entreprise alimente la valeur d'entreprise, le ratio d'endettement, la
> prime de risque et la spirale de détresse.
> Ajouter l'arriérage à une seule des deux corrigerait la moitié du problème et laisserait les deux vues
> incohérentes entre elles. Il faut l'ajouter aux deux, en court terme du côté du bilan.
> Le code lui-même documente qu'exactement ce piège s'est déjà produit une fois : les prêts du marché de prêts
> étaient comptés dans les états financiers mais oubliés dans la dette utilisée par la prime de risque,
> jusqu'à ce que ce soit corrigé. C'est le même écueil, au même endroit.
> Quoi ajouter, exactement
> L'arriérage, obligatoirement. C'est celui qui persiste dans le temps et qui accompagne la détresse. C'est
> lui qui doit peser sur le taux d'emprunt.
> Le dividende dû de l'année, si tu veux être complet. C'est un montant déjà déclaré et exigible. L'ajouter
> est plus rigoureux ; ne pas l'ajouter est défendable puisqu'il se règle ou bascule en arriérage dans
> l'année. Si tu n'en prends qu'un seul, prends l'arriérage.
> Ce que ce correctif ne remet PAS en cause
> Tu as tranché explicitement que le capital privilégié levé n'apparaît nulle part comme un passif —
> « ignorer complètement ». Cette décision reste entière et il n'y a aucune raison d'y toucher : un capital
> levé n'est pas remboursable à échéance, seul le rachat est possible et il est à l'initiative de
> l'entreprise.
> Un arriérage est d'une autre nature : c'est un montant précis, déjà dû, qui bloque une action du jeu tant
> qu'il n'est pas réglé. C'est une dette au sens plein.
>
> Correctif 3 — Le popup « Détails supplémentaires » doit boucler
> Le symptôme
> Le popup affiche six lignes de mouvement. Il n'affiche ni l'encaisse de départ, ni un total. Le joueur ne
> peut donc pas rapprocher ce qu'il lit de sa valeur nette — et s'il essaie, il tombe à côté.
> Sur un portefeuille de test contenant des actions, une position à découvert, des bons et trois positions
> d'options :
> Ligne affichée / Montant
> P&L réalisé / +138 337 $
> Prime nette d'option / −2 296 $
> P&L non réalisé / +281 745 $
> Intérêt payé / −96 335 $
> Somme des lignes affichées / +321 451 $
> Variation réelle de la valeur nette / +323 748 $
> L'écart est de 2 297 $ — exactement l'opposé de la ligne « Prime nette d'option ».
> La cause
> La prime d'option est comptée deux fois. Son effet économique est déjà porté par l'encaisse du joueur et
> par la valeur de marché de l'option dans la valeur nette. L'afficher en plus comme une ligne autonome la
> fait compter une seconde fois.
> Une ligne d'ajustement interne, calculée comme le résidu nécessaire pour que le total tombe juste, absorbe
> silencieusement l'écart — mais cette ligne n'est pas affichée, ce qui rend l'erreur indétectable.
> Vérifié sur cinq états successifs : aucune option, vingt calls achetés, quinze puts écrits en plus, cours
> forcé de +25 %, puis un lancer réel. Dans les cinq cas, la ligne d'ajustement vaut exactement l'opposé de la
> prime nette d'option. Les deux s'annulent toujours, quel que soit le sens ou la taille des positions.
> Les deux correctifs, à faire ensemble
> a) Sortir la prime d'option du total.
> Attention à l'ordre des opérations ici. La ligne d'ajustement est calculée comme la différence entre la
> valeur nette réelle et la somme des catégories suivies. Il ne suffit donc pas de masquer la ligne à
> l'affichage : il faut retirer la prime nette d'option de la somme des catégories suivies elle-même. Sinon
> l'ajustement bascule simplement dans l'autre sens et l'incohérence reste, juste inversée.
> Une fois la prime retirée de cette somme, l'ajustement retombe naturellement à zéro sur un portefeuille
> normal — et c'est précisément le test de non-régression à faire tourner.
> La prime reste une information utile pour le joueur. Affiche-la si tu veux, mais en aparté, hors du total,
> clairement étiquetée comme un rappel de ce qui a été payé ou encaissé en primes — pas comme une composante
> de la valeur nette.
> b) Afficher l'encaisse de départ et le total.
> Le popup s'appelle « évolution de mon portefeuille » : sans point de départ ni point d'arrivée, il n'évolue
> de rien vers rien. Ajoute une première ligne Encaisse de départ et une dernière ligne Valeur liquidative,
> avec un filet de séparation avant le total comme dans les autres tables du jeu.
> Les deux valeurs existent déjà, elles sont simplement calculées et jamais affichées. C'est le geste qui rend
> le tableau vérifiable d'un coup d'œil — et qui aurait rendu cette anomalie visible dès la première partie.

### Correctif 1 — le CEO ne peut plus acheter ses propres privilégiées sur le marché secondaire

**Diagnostic.** `respondToPreferredIssuance` refusait déjà le CEO émetteur à la SOUSCRIPTION (délit
d'initié). Mais `buyPreferredSharesFromListing` (marché SECONDAIRE, une fois les parts déjà en circulation)
ne portait aucune garde équivalente — le CEO pouvait acheter ses propres parts d'occasion au lancer suivant,
un arbitrage sans risque connu de lui seul (achat plafonné à min(cours ordinaire, prix de rachat), rappel au
prix de rachat — gain garanti dès que le cours est sous ce prix).

**Correctif retenu.** Nouvelle garde dans `buyPreferredSharesFromListing`, juste après celle qui refuse déjà
d'acheter sa propre annonce (règle DIFFÉRENTE — vise le vendeur, pas l'émetteur, les deux coexistent) :
`if(co.ceoId===buyer.id) return {ok:false, error:'Le CEO d'une entreprise ne peut pas détenir ses propres
parts privilégiées, neuves ou d'occasion — délit d'initié intégré au jeu.'};` — reprend volontairement la
même formulation (adaptée « souscrire » → « détenir... neuves ou d'occasion ») que le refus à la
souscription, pour que le joueur voie deux fois la même règle plutôt que deux règles différentes. Ne bloque
QUE l'achat : `listPreferredSharesForSale` (mise en vente) reste inchangée sans garde CEO, pour qu'un CEO
détenant déjà des parts (partie sauvegardée avant ce correctif) puisse toujours s'en défaire — bloquer la
sortie l'aurait enfermé dans exactement la position que le correctif vise à interdire.

### Correctif 2 — l'arriérage (et le dû de l'année) de dividende préférentiel devient un passif

**Diagnostic.** `company.preferredDividendArrears` (obligation cumulative, précise, qui bloque tout dividende
ordinaire tant qu'elle n'est pas réglée) et `company.preferredDividendDueThisYear.amount` (montant déjà
déclaré et exigible) n'entraient dans AUCUN calcul financier : ni `companyLiabilitiesForStatements` (donc
absent du bilan — équité mécaniquement surévaluée), ni `companyDebt` (donc absent de `companyDebtRatio` —
ratio d'endettement sous-évalué, ce qui donne à une entreprise venant de manquer son dividende préférentiel un
MEILLEUR taux d'emprunt via `riskAdjustedRate`, signal inversé au pire moment). Le code documentait déjà (voir
section 162) avoir commis exactement cette même erreur une fois avec les prêts du marché de prêts — même
écueil, même endroit.

**Correctif retenu.** Les deux montants (`company.preferredDividendArrears||0` et
`(company.preferredDividendDueThisYear && company.preferredDividendDueThisYear.amount)||0`) sont désormais
ajoutés en passif COURT TERME dans les DEUX fonctions sœurs, délibérément non fusionnées (voir leurs
commentaires respectifs) : `companyLiabilitiesForStatements` (bilan/équité) ET `companyDebt` (ratio
d'endettement/prime de risque/spirale de détresse) — ajouter à une seule aurait laissé les deux vues
incohérentes entre elles, exactement l'écueil déjà documenté pour les prêts. `companyValue` (qui soustrait
`companyDebt` directement) en bénéficie automatiquement, sans modification propre.

**Ce qui n'a PAS été touché** (décision antérieure explicitement confirmée intacte par l'audit) : le CAPITAL
privilégié levé lui-même (`issuance.raisedAmount`) reste totalement absent de tout calcul de passif — « ignorer
complètement », inchangé — puisqu'il n'est pas remboursable à échéance, seul un rachat à l'initiative de
l'entreprise étant possible. Un arriérage est d'une autre nature : un montant précis, déjà dû, qui bloque une
action du jeu tant qu'il n'est pas réglé — une dette au sens plein.

### Correctif 3 — le popup « Détails supplémentaires » boucle enfin

**Diagnostic.** `playerNetWorthReconciliation` incluait `optionNetPremium` (le flux de trésorerie CUMULÉ des
primes d'option, `player.cumOptionNetPremium`) dans `trackedSum`, EN PLUS de `unrealizedPnl` — qui, pour toute
position d'option ENCORE OUVERTE, vaut déjà `(valeur actuelle − premiumAtOpen)` et porte donc déjà l'effet de
cette même prime. Un double-comptage exact, silencieusement absorbé par la ligne « Autres/ajustement » (non
affichée) : l'audit mesure un écart de 2 297 $, exactement l'opposé de la ligne « Prime nette d'option »
(−2 296 $), reproductible sur 5 états de portefeuille successifs (aucune option → +20 calls → +15 puts →
cours forcé +25 % → un lancer réel — voir les tests).

**Correctif retenu — en deux volets, faits ensemble comme demandé.**

**(a) Sortir la prime du total, pas seulement de l'affichage.** Remplacer bêtement `optionNetPremium` par 0
dans `trackedSum` aurait réintroduit le MÊME bug sous une autre forme : `cumOptionNetPremium` contient AUSSI
le flux net des positions déjà CLÔTURÉES (aller-retour vendu/racheté avant échéance) — `closeOptionPosition`
ne touche JAMAIS `cumRealizedPnl`, c'est le SEUL endroit où ce P&L déjà réalisé existe (l'équivalent exact, côté
options, du `cumRealizedPnl` des actions à la vente). L'exclure en bloc aurait fait disparaître ce P&L réalisé
dans « Autres/ajustement » — constaté en testant le popup avec des positions d'options ouvertes PUIS
refermées (`smoke_test_step229...`, groupe E) : résidu de −8,35 $, exactement l'écart achat-vente réel du
Correctif 1 (section 260) qui aurait sinon disparu du total. Le calcul retenu isole donc précisément la
portion à exclure : `optionOpenFlowStillOpen` = somme, pour CHAQUE position encore ouverte, de son flux
d'ouverture (`±optionNotional(shares, premiumAtOpen)`, même signe que `cumOptionNetPremium`) — exactement ce
que `unrealizedPnl` reconstruit déjà. `optionRealizedPnl = optionNetPremium − optionOpenFlowStillOpen` ne peut
alors provenir que de positions déjà CLÔTURÉES — c'est LUI qui entre dans `trackedSum`, à la place de l'ancien
`optionNetPremium` brut. `optionNetPremium` (brut, cumulé) reste calculé et retourné, pour un affichage en
aparté (voir b).

**(b) Réafficher l'encaisse de départ et le total.** Revient explicitement sur la décision de la section 231
(« enlève l'encaisse de départ et la valeur liquidative garde le reste ») — ces deux valeurs, déjà calculées
en interne depuis cette section-là, redeviennent visibles : `startingCash` en PREMIÈRE ligne du tableau,
`liquidationValue` en DERNIÈRE ligne (en gras), précédée d'un filet de séparation (`border-top:2px solid
var(--line)`, même convention que les tableaux financiers de l'entreprise). La ligne « Prime nette d'option »
disparaît du tableau qui boucle (elle ne fait plus partie de `trackedSum`) et réapparaît, si non négligeable,
en simple rappel textuel sous le tableau (« Pour mémoire — prime nette d'option encaissée/payée depuis le
début [...] déjà comptée dans l'encaisse et dans le P&L non réalisé [...] donc PAS incluse dans le total »),
clairement hors total.

### Tests

Nouveau fichier dédié `smoke_test_step261_portfolio_audit_fixes.js` (groupes A-D, 27 assertions) : (A) le CEO
émetteur est refusé sur le marché secondaire avec la formulation EXACTE attendue, tandis qu'un acheteur tiers
non-CEO réussit normalement ; un CEO détenant déjà des parts (simulateur de partie migrée) peut les mettre en
vente sans être bloqué ; la règle distincte « acheter sa propre annonce » continue de fonctionner
indépendamment sur un vendeur non-CEO. (B) un arriérage de 320 000 $ (même montant que l'exemple de l'audit)
produit EXACTEMENT ce montant en passif court terme dans `companyLiabilitiesForStatements` ET dans
`companyDebt`, avec un ratio d'endettement qui devient strictement positif ; le dividende dû de l'année
(45 000 $) s'ajoute par-dessus dans les deux fonctions à la fois ; le capital privilégié LEVÉ
(`raisedAmount`), lui, reste à 0 $ de passif dans les deux cas — décision antérieure non affectée. (C) séquence
en 5 états (aucune option → +20 calls achetés → +15 puts écrits → cours forcé +25 % → un lancer réel) sur des
positions JAMAIS fermées : résidu « Autres/ajustement » négligeable à CHAQUE état malgré une prime nette
d'option cumulée non nulle (sanity vérifiée), et `optionRealizedPnl` reste à 0 tant qu'aucune position n'est
close. (D) le popup affiche « Encaisse de départ » avant « Valeur liquidative », un filet de séparation
précède le total, et le rappel en aparté de la prime nette d'option apparaît quand elle est non négligeable —
« Prime nette d'option » n'est plus une ligne du tableau qui boucle.

`smoke_test_step229_portfolio_evolution_popup.js` mis à jour en conséquence (groupe I : `trackedSum` recalculé
avec `optionRealizedPnl` au lieu de `optionNetPremium`, le résidu retombe à exactement 0 sur ce scénario qui
contient pourtant un aller-retour ÉCRIT avec écart achat-vente réel et un exercice forcé ; groupe J : le popup
attend désormais « Encaisse de départ »/« Valeur liquidative » comme première/dernière ligne, et vérifie que
« Prime nette d'option » n'est plus une ligne du tableau). `node -c script_extracted.js` après chaque
correctif. Suite complète (182 scripts désormais) relancée à 3 reprises consécutives : **0 échec**. `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 262. Audit externe — onglet Mon entreprise (audit A4) : 2 anomalies (émission d'actions crée de l'argent, dividende en suspens) + 1 durcissement (garde CEO d'executeShareTrade)

### Origine

Audit externe reçu de l'utilisateur — rapport `Cahier_A4.pdf` (14 pages), résumé collé dans la conversation.
Périmètre : toutes les actions du CEO non couvertes par les audits 1 à 3 (émission/rachat d'actions,
dividendes, hypothèques, subventions d'avance GO, enchère de maisons, annonces CEO, cote de crédit, prêt de
dernier recours). Verdict : 2 anomalies (1 majeure), 1 point de durcissement, 18 comportements validés
(hypothèque, avances GO, annonces CEO, enchère de maisons, cote de crédit, prêt de dernier recours — tous
confirmés exacts, non repris ici).

**Correction de méthode importante, citée verbatim** : « L'invariant monétaire est désormais mesuré EN
DIRECT dans la page, pas dans la sauvegarde. `issueNewShares`/`buybackShares` ne déclenchent pas de
`saveGame()` — une mesure prise dans le dump montrait un système équilibré alors qu'il ne l'était plus.
L'anomalie n° 1 est restée invisible jusqu'à ce changement. » — retenue pour les tests de cette section (voir
`systemTotal()` dans `smoke_test_step262...`, qui somme `state.bank.cash` + tous les `company.cash` + tous
les `player.cash` directement depuis l'état en mémoire, jamais via une sauvegarde).

### Anomalie 1 (majeure) — l'émission de nouvelles actions crée de l'argent, le rachat en détruit

**Diagnostic.** `issueNewShares()` faisait `company.cash += qty*stockPrice` sans débiter AUCUN compte ;
`buybackShares()` faisait `company.cash -= qty*stockPrice` sans créditer personne. Mesuré par l'audit —
émission de 20 000 parts à 100$ sur une entreprise : trésorerie entreprise 20,00M$→22,00M$, trésorerie
banque INCHANGÉE, total du système 580,00M$→**582,00M$**. Ce qui est délibéré et non remis en cause :
l'absence de dilution (« pas d'impact sur le nombre de parts disponibles puisque techniquement dans le jeu
il n'y a pas de limites », spec verbatim de la section 234). Ce qui n'avait jamais été tranché : qui verse
l'argent — tous les AUTRES chemins de financement de l'entreprise ont une contrepartie explicite (IPO:
banque débitée ; privilégiées: souscripteurs débités ; prêt: prêteur débité ; hypothèque/avance GO/prêt de
dernier recours: banque débitée) — l'émission d'actions était la seule exception, un oubli plutôt qu'un
choix. Cycle exploitable mesuré par l'audit sur deux cycles réels (lancers réels, aucune valeur forcée) :
émettre à un prix, racheter à un prix plus bas restaure le plafond d'émission (voulu) tout en créant
+74 349$ puis +71 740$ nets — total du système 580,000000M$ → 580,146089M$, sans limite sur le nombre de
cycles.

**Correctif retenu.** `state.bank.cash` est désormais débité à l'émission et crédité au rachat — EXACTEMENT
comme `applyCompanyIpoFunding` le fait déjà pour l'IPO. L'écriture de transaction gagne sa deuxième ligne
(elle n'en avait qu'une avant ce correctif — le signal visible à l'écran de l'argent créé/détruit sans
contrepartie). Rien d'autre ne change : ni le plafond de 10 %, ni l'absence de dilution, ni les cubes rouges/
verts, ni la restauration de la marge d'émission par les rachats — le correctif referme le cycle « émettre
haut / racheter bas » en un simple transfert entreprise ↔ banque à somme nulle pour le système, tout en
restant une bonne stratégie financière pour l'entreprise elle-même.

### Anomalie 2 (moyenne) — le dividende annoncé n'appartient à personne entre l'annonce et le versement

**Diagnostic.** À l'annonce, le montant quitte `company.cash` et vit uniquement dans
`state.dividendAnnouncements`, hors de tout compte — mesuré par l'audit sur une annonce de 3,0M$ : argent
visible 580→577M$, montant immobilisé 3,0M$, valeur nette du bénéficiaire inchangée. Bénin dans le cours
normal (l'argent revient intégralement au semestre suivant — vérifié par l'audit, retour exact à
580,000000M$) : le problème est que `state.dividendAnnouncements` n'était consulté QU'À la frontière de
semestre suivante, JAMAIS à la fin de la partie. Une partie qui s'arrête entre l'annonce et le versement
(plancher boursier, banque propriétaire de tout, durée maximale cachée, prêt de dernier recours) laissait ce
montant nulle part : ni versé, ni rendu, absent des valeurs nettes qui décident du vainqueur.

**Correctif retenu (option A, celle recommandée par l'audit).** Nouvelle fonction
`forfeitPendingDividendAnnouncementsAtGameEnd()` : rend à la trésorerie de CHAQUE entreprise concernée le
montant TOTAL de ses annonces encore en attente, réutilisant EXACTEMENT le mécanisme déjà existant pour la
portion non réclamée d'un versement normal (catégorie de grand livre `dividend_forfeited_return`) — la
totalité de chaque annonce encore en attente est ici « non réclamée » au sens le plus large, la partie
n'allant jamais jusqu'à son versement. Appelée UNE SEULE FOIS, juste après que `state.gameEndedReason` soit
posé, aux 4 sites où la partie peut se terminer (chacun déjà gardé par `!state.gameEndedReason` avant
l'affectation) : durée maximale cachée et plancher boursier par tirage de cubes (tous deux dans
`advanceGameClock`), banque propriétaire de tout (`checkBankOwnershipGraceExpiry`), plancher boursier par
prêt de dernier recours (`triggerLastResortLoan` — un chemin CEO déclenché hors du lancer de dés). L'option
B de l'audit (réserver sans débiter à l'annonce, débiter au versement) a été explicitement écartée : plus
« propre » par construction mais exige alors une garde séparée contre la dépense du cash réservé entre-temps
— garde que l'immobilisation actuelle fournit déjà gratuitement.

### Point de durcissement 3 — la garde CEO du comptant n'existait que dans l'interface

**Diagnostic.** `executeShareTrade()` n'avait AUCUNE garde CEO — le CEO en était exclu uniquement parce que
sa propre entreprise n'apparaissait pas dans les listes déroulantes de `tradeCompanyShares()` (point
d'entrée UI, qui porte SA PROPRE garde explicite). Non exploitable en jouant normalement (aucun autre
chemin n'appelait `executeShareTrade` directement avec un CEO tradant sa propre compagnie), mais un défaut
de cohérence par rapport à `openShortPosition`/`openOptionPosition`/`openOptionStrategy`/
`respondToPreferredIssuance`, qui portent TOUTES leur propre garde explicite au niveau de la fonction plutôt
que de compter sur l'UI.

**Correctif retenu.** `executeShareTrade(company, player, direction, amount, _viaCeoAnnouncementChannel)`
gagne la même garde, formulée IDENTIQUEMENT à celle de `tradeCompanyShares`. Piège signalé explicitement par
l'audit et vérifié avant d'écrire le correctif : `executeCeoAnnouncement` appelle légitimement cette fonction
pour le compte du CEO (l'exécution DIFFÉRÉE, 1 an plus tard, d'une annonce publique que le CEO a lui-même
faite — canal explicitement voulu, voir DESIGN_TRADING_JOUEURS.md section 2) — sans exemption, TOUTES les
annonces CEO auraient échoué silencieusement à l'exécution. `_viaCeoAnnouncementChannel` (5e paramètre,
jamais exposé à l'UI, VRAI uniquement depuis `executeCeoAnnouncement`) exempte ce seul chemin légitime.

### Tests

Nouveau fichier dédié `smoke_test_step262_audit_a4_mon_entreprise.js` (groupes A-C, 33 assertions),
`systemTotal()` mesurée EN DIRECT à chaque étape (voir la note de méthode ci-dessus) : (A) émission et rachat
conservent EXACTEMENT le total système (banque+entreprises+joueurs), la banque bouge du montant exact, la
transaction porte 2 lignes qui s'annulent ; le cycle « émettre haut/racheter bas » de l'audit, reproduit à
deux prix différents, laisse désormais le total inchangé au lieu de créer de l'argent. (B) appel direct de
`forfeitPendingDividendAnnouncementsAtGameEnd()` avec 2 annonces sur 2 entreprises distinctes — les DEUX sont
rendues intégralement, le registre est vidé, 2 écritures `dividend_forfeited_return` journalisées ; une
annonce en attente SURVIT à un lancer normal qui ne termine pas la partie (pas de rendu prématuré) ; les 2
sites réels testés directement (`checkBankOwnershipGraceExpiry`/`bankOwnsAll` et `advanceGameClock`/
`maxDuration`) déclenchent bien le rendu — y compris pour une annonce sur une AUTRE entreprise que celle qui
termine la partie. (C) le CEO est refusé en appelant `executeShareTrade` directement, MÊME formulation que
`tradeCompanyShares` ; `_viaCeoAnnouncementChannel:true` débloque exactement ce chemin ; un joueur non-CEO
continue de trader sans le flag ; une exécution d'annonce CEO différée bout en bout (via
`executeCeoAnnouncement`, qui passe désormais le flag lui-même) reste non-régressée.

Régression détectée et corrigée en cours de route : `smoke_test_step178_last_resort_loan_and_gameend.js` et
`smoke_test_step182_5_items_batch.js` appelaient tous deux `executeShareTrade` DIRECTEMENT avec le CEO comme
joueur, pour simuler exactement le canal `executeCeoAnnouncement` (« vente de la totalité des parts du CEO »,
scénario « banque possède tout ») — désormais bloqués par la nouvelle garde faute du flag ; corrigés en
ajoutant `_viaCeoAnnouncementChannel:true` à ces 3 appels, comportement testé inchangé par ailleurs. `node -c
script_extracted.js` après chaque correctif. Suite complète (183 scripts désormais) relancée à 3 reprises
consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 263. Les bons gouvernementaux comptent désormais pour un « cash-secured put »

### Origine

Demande explicite de l'utilisateur, verbatim : « Assure-toi s'il te plaît que les ventes de put, donc écrire
un put, si tu as l'argent en obligation du gouvernement, ça soit considéré comme un cash sécurisé put. »

### Diagnostic

`optionCoveredShares(player, pos)` (module Options) calcule, pour un put ÉCRIT, la portion « cash-secured »
classique: `player.cash / (strike × OPTION_CONTRACT_MULTIPLIER)`. Seul `player.cash` y entrait — les bons
sans risque (`player.bondBalance`, quand il est positif) n'y participaient pas, alors qu'ils sont
économiquement équivalents à du cash disponible: `raiseCashForForcedSettlement` (exercice forcé) les liquide
déjà AUTOMATIQUEMENT en dernier recours, juste après le cash, précisément pour honorer ce genre
d'engagement. S'ils couvrent déjà le risque en pratique (à l'exercice), ils devaient aussi compter en amont,
pour la marge — sans quoi un joueur assis sur des bons largement suffisants pouvait être margé-appelé (voire
voir sa position fermée de force) sur un put qui n'était, dans les faits, jamais en danger.

### Correctif retenu

Le cash disponible pour la couverture d'un put écrit devient `player.cash + Math.max(0,
player.bondBalance||0)`. Le `Math.max(0, ...)` est délibéré : un `bondBalance` NÉGATIF (dette empruntée via
`shortBonds`) n'ajoute jamais de couverture — de l'argent EMPRUNTÉ ne peut pas servir de garantie à
lui-même. La branche CALL (couverture par parts détenues) n'est pas touchée. `optionCoveredShares` reste la
SEULE fonction à modifier — elle est le point d'entrée unique utilisé par `requiredMaintenanceMargin`
(marge exigée, ligne « Marge disponible » du Portefeuille) et par `enforceMarginCalls` (fermeture forcée) :
les deux bénéficient automatiquement du correctif sans changement propre.

### Tests

Nouveau fichier dédié `smoke_test_step263_cash_secured_put_bonds.js` (groupes A-D, 15 assertions) :
(A) `optionCoveredShares()` directement sur un put écrit (strike 100, besoin plein 10 000$/contrat) — cash
seul partiel (0,6 contrat couvert) ; cash + bons POSITIFS → pleinement couvert ; bons NÉGATIFS (dette) →
AUCUN ajout, identique au cas cash-seul ; bons seuls (cash=0) → pleinement couvert. (B) non-régression: la
branche CALL reste totalement insensible à `bondBalance`, même énorme. (C) `requiredMaintenanceMargin()`
bout en bout sur une position réellement ouverte: la marge exigée retombe exactement à 0 une fois les bons
pris en compte. (D) `enforceMarginCalls()` bout en bout: un joueur avec un put nu et une encaisse quasi
nulle subit bien une fermeture forcée SANS les bons (sanity), tandis qu'un joueur identique mais avec
10 000$ en bons — marge exigée nulle — n'est PAS touché, sa position reste intacte. `node -c
script_extracted.js` : SYNTAX OK. Suite complète (184 scripts désormais) relancée à 3 reprises
consécutives : **0 échec** (une exécution isolée de `smoke_test_step193_stock_cube_floor.js`, sans rapport
avec ce correctif — plancher des cubes boursiers — a échoué une fois puis repassé au vert 5/5 en isolation,
flakiness préexistante non liée à ce changement). `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2
cas).

## 264. L'émission d'obligations (prêts d'entreprise) rejoint l'émission de parts privilégiées aux frontières de semestre

### Origine

Suite à une question de l'utilisateur sur le rythme du jeu (« c'est quand dans une année que les entreprises
peuvent émettre des obligations ou des actions privilégiées »), il ressort que `issuePreferredShares()`
était déjà restreinte aux frontières de semestre (`tradingWindowOpen()`, section 134/234) mais que
`postLoanRequest()` — la publication d'une demande d'emprunt par une entreprise, ce que l'utilisateur appelle
« obligations » dans le vocabulaire du jeu (section 157) — ne l'était pas. Demande explicite de l'utilisateur,
verbatim : « Okay, c'est quand que la bourse ouvre pour le trading? [...] Parfait, c'est exactement ce que je
veux. Dans ce cas-là, ce qu'on va faire, c'est qu'on va mettre l'émission des obligations et l'émission de
part privilégiée, d'action privilégiée. On va les mettre aux semestres aussi. »

### Diagnostic

`postLoanRequest(companyId, principal, opts)` ne vérifiait ni la fenêtre de trading ni quoi que ce soit de
temporel — une entreprise pouvait publier une nouvelle demande d'emprunt à n'importe quel lancer de dés,
contrairement à `issuePreferredShares()` qui exige déjà `tradingWindowOpen()`. Seule la PUBLICATION d'une
NOUVELLE demande (l'« émission ») est concernée par la demande de l'utilisateur — gérer une demande déjà
ouverte (un joueur soumet une offre via `submitLoanOffer`, le CEO l'accepte via `acceptLoanOffer` ou annule
la demande via `cancelLoanRequest`) est un mécanisme différent qui continue, comme avant, de fonctionner à
n'importe quel lancer — exactement comme répondre (accepter/refuser) à une émission de parts privilégiées
déjà en cours n'est elle-même jamais soumise à la fenêtre, seule sa création l'est.

### Correctif retenu

`postLoanRequest()` gagne la MÊME garde EXACTE (même fonction `tradingWindowOpen()`, même message d'erreur)
que `issuePreferredShares()` : `if(!tradingWindowOpen()) return fail(...)`, ajoutée juste après la
vérification « entreprise introuvable » et avant la garde de fin de partie. `issueLoan()` (la primitive de
bas niveau) et `acceptLoanOffer()`/`submitLoanOffer()`/`cancelLoanRequest()` restent volontairement
INCHANGÉS — seule l'entrée initiale (la publication) est gatée, cohérent avec le traitement de
`issuePreferredShares` où seule la création de l'émission est gatée, pas les réponses des joueurs qui
suivent.

Deux ajustements UI pour rester cohérent avec le patron déjà en place pour les actions/parts privilégiées
(section 251) :
- **`issueLoanButtonHtml`** (bouton « 💰 Prêt », Mon Entreprise) : absent désormais aussi quand la fenêtre
  est fermée ET qu'aucune demande n'est déjà ouverte (`(loanCapExhausted || !tradingWindowOpen()) &&
  !openLoanRequest`) — reste visible, comme avant, tant qu'une demande est ouverte (consultation/acceptation
  des offres toujours possible) ou que de la capacité reste disponible à fenêtre ouverte.
- **`modalIssueLoan()`** : nouvel écran informatif « Le marché est fermé — une nouvelle demande d'emprunt
  n'est possible qu'aux semestres (prochaine ouverture dans N lancer(s)) » à la place du formulaire, inséré
  juste après le bloc existant « capacité d'emprunt épuisée » — même convention (garde métier réelle dans
  `postLoanRequest`, cet écran n'est que le retour visuel immédiat sans passer par le formulaire/réessai).

### Tests

Nouveau fichier dédié `smoke_test_step264_loan_issuance_semester_window.js` (groupes A-E, 18 assertions) :
(A) `postLoanRequest()` refusée hors fenêtre (rollCount=1) avec message clair et aucune mutation, acceptée à
la frontière de semestre (rollCount=0). (B) une fois une demande ouverte, la fenêtre se ferme puis
`submitLoanOffer()`/`acceptLoanOffer()` fonctionnent quand même (le prêt via `issueLoan()` est bien créé) —
non-régression confirmée. (C) `cancelLoanRequest()` fonctionne aussi hors fenêtre. (D) UI: bouton « 💰 Prêt »
présent fenêtre ouverte sans demande en cours, absent fenêtre fermée sans demande en cours, reste présent
fenêtre fermée avec une demande déjà ouverte (entreprise dédiée pour isoler ce cas, la demande de l'entreprise
utilisée en (A)/(B) n'étant plus « ouverte » une fois son offre acceptée). (E) UI: `modalIssueLoan()` affiche
l'écran « marché fermé » (formulaire absent) hors fenêtre sans demande en cours, le formulaire normal fenêtre
ouverte.

Régression détectée et corrigée dans `smoke_test_step70_section157_bonds_and_loan_market.js` (groupe E) : ce
test postait des demandes d'emprunt à `rollCount=1` (hérité d'un `advanceGameClock()` du groupe C précédent)
— désormais hors fenêtre, donc bloqué par le nouveau correctif. Réaligné sur une frontière de semestre
(`state.gameClock.rollCount -= state.gameClock.rollCount % 3`) avant ce groupe, même pattern déjà utilisé
ailleurs pour ce même mécanisme (ex. `smoke_test_step49_trading_phase2_short.js`, section 134). `node -c
script_extracted.js` : SYNTAX OK. Suite complète (185 scripts désormais) relancée à 3 reprises consécutives :
**0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 265. Le marché des prêts d'entreprise doit se conclure dans le même lancer que sa publication — expiration automatique

### Origine

Demande explicite de l'utilisateur, verbatim : « Okay, c'est là justement que je voulais aller gérer une
demande ouverte, donc les propositions ou l'acceptation. Je veux que ça se fasse dans le même tour, soit au
semestre. Pour ne pas que ça se fasse plus tard, puis qu'il y a des enjeux de liquidité. Donc je veux que
les gens puissent en toute connaissance de cause savoir ce qui se passe. Et si jamais une proposition est
sur la table, puis que le processus n'est pas fini au complet, puis que les dés sont jetés, tout est
annulé. Donc en résumé 100% du processus doit être fait le même semestre. »

### Diagnostic

La section 264 rend `postLoanRequest()` postable UNIQUEMENT à la frontière de semestre
(`tradingWindowOpen()`), mais, en l'état, une fois publiée, la demande pouvait rester ouverte
INDÉFINIMENT — à travers n'importe quel nombre de lancers/semestres suivants — jusqu'à ce qu'une offre soit
acceptée ou la demande annulée à la main. `submitLoanOffer`/`acceptLoanOffer`/`cancelLoanRequest`
n'étaient soumis à AUCUNE contrainte de temps (délibérément, section 264 — « gérer une demande déjà
ouverte reste possible en tout temps »). L'utilisateur clarifie ici que ce n'était PAS l'intention : le
processus complet (publication → offres → acceptation ou annulation) doit tenir dans la même fenêtre — dès
que les dés sont relancés sans qu'une offre ait été acceptée, l'engagement de liquidité qui pesait sur les
joueurs prêteurs potentiels doit disparaître, pas continuer à traîner.

### Correctif retenu

Chaque demande d'emprunt porte désormais `createdAtRoll` (le `rollCount` au moment de sa publication, posé
par `postLoanRequest`). Nouvelle fonction `expirePendingLoanRequests()`, appelée à CHAQUE lancer depuis
`advanceGameClock()` (même emplacement, juste après `resolvePendingPreferredIssuances()` — même
raisonnement de défense en profondeur que les étapes voisines) : annule AUTOMATIQUEMENT toute demande
encore présente dans `state.loanRequests` dont `rollCount > createdAtRoll` — c'est-à-dire dès le TOUT
PROCHAIN lancer de dés qui suit sa publication, qu'une offre ait été soumise ou non. Contrairement à
`resolvePendingPreferredIssuances` (qui RÉSOUT — distribue les parts aux accepteurs), il n'y a ici AUCUNE
résolution de substitution : une demande non acceptée par le CEO avant le lancer suivant est simplement
ANNULÉE, avec TOUTES ses offres reçues sur elle — jamais de prêt créé « par défaut », accepter reste
toujours un choix explicite du CEO (`acceptLoanOffer`, inchangée). `submitLoanOffer`/`acceptLoanOffer`/
`cancelLoanRequest` restent eux-mêmes sans garde de fenêtre (comme depuis la section 264) — c'est la CIBLE
(la demande) qui disparaît, pas la capacité d'agir dessus.

Trois rappels UI ajoutés pour que « les gens puissent en toute connaissance de cause savoir ce qui se
passe » :
- Le message loggé à la publication (`postLoanRequest`) précise désormais explicitement : « Elle doit être
  acceptée (ou annulée) AVANT le prochain lancer de dés, sans quoi elle expire automatiquement d'elle-même,
  avec toute offre reçue entre-temps. »
- Le bandeau d'annonces du Portefeuille (`loanRequestLines`, visible par tout joueur pouvant proposer une
  offre) affiche désormais « ⏳ expire au prochain lancer de dés si non acceptée » sur chaque ligne de
  demande.
- La modale du CEO (`modalIssueLoan`, branche « demande déjà ouverte ») affiche désormais un rappel dédié :
  « Cette demande (et toute offre reçue ci-dessous) expire AUTOMATIQUEMENT, sans acceptation ni cash créé,
  dès le prochain lancer de dés — acceptez une offre ou annulez explicitement avant que les dés ne soient
  jetés. »

**Migration** (`migrateState`) : une demande d'emprunt déjà ouverte dans une sauvegarde antérieure à cette
section n'a pas `createdAtRoll` — elle reçoit le `rollCount` COURANT au moment de la migration (se comporte
ensuite exactement comme une demande fraîchement publiée, expire au tout prochain lancer — aucune
expiration rétroactive instantanée basée sur un historique inconnu).

### Tests

Nouveau fichier dédié `smoke_test_step265_loan_request_semester_expiry.js` (groupes A-F, 18 assertions) :
(A) `postLoanRequest()` pose bien `createdAtRoll` = `rollCount` courant. (B) acceptée AVANT tout lancer
supplémentaire — non-régression par rapport à la section 264. (C) NON acceptée, un lancer de dés survient
(`advanceGameClock`) — la demande ET l'offre reçue sur elle sont automatiquement annulées, aucun prêt créé,
aucun mouvement de cash sur le prêteur potentiel, message clair loggé (vérifié via `state.log` — `unshift`,
donc les nouvelles entrées sont en TÊTE du tableau, pas en queue). (D) plusieurs demandes en parallèle:
celle acceptée AVANT le lancer (son prêt) n'est jamais touchée par l'expiration, seule celle restée ouverte
expire. (E) UI: le bandeau du Portefeuille et la modale CEO affichent tous deux le rappel d'échéance. (F)
`migrateState()`: une demande sans `createdAtRoll` (simulant une ancienne sauvegarde) reçoit le `rollCount`
courant à la migration, sans expiration rétroactive instantanée, puis expire normalement au lancer suivant
comme n'importe quelle demande fraîche.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (186 scripts désormais) relancée à 3 reprises
consécutives : **0 échec** (aucun test existant ne s'appuyait sur une demande d'emprunt survivant à
plusieurs lancers — aucune régression). `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 266. Correctif oublié : `payableRent` (cotation d'assurance) ne reflétait pas la fuite monétaire déjà corrigée dans `settlePropertyRent`/`settleNeutralPawnRent` (audit A1)

### Origine

Signalé par l'utilisateur, verbatim (« bug? »), avec une capture d'écran d'une AUTRE session (Claude
Desktop Windows, même Project) décrivant précisément l'écart : « Le correctif de la fuite monétaire
(section 257, audit A1 anomalie 1) a été appliqué à la fonction qui **règle** le loyer,
`settlePropertyRent`. Il n'a pas été appliqué à la fonction qui **cote** le loyer, `payableRent`. Les deux
doivent donner le même chiffre, et elles ne le donnent plus. »

### Diagnostic

Confirmé par lecture directe du code. La section 257 (audit A1, anomalie #1) avait corrigé la fuite
monétaire dans `settlePropertyRent` (ligne ~16223: `if(!state.settings.bankCollectsRent) payableShare -=
purchasableBankShare(p)/100;`) et, proactivement, dans le code jumeau `settleNeutralPawnRent` (ligne
~16534, même ligne au mot près) — mais **jamais** dans `payableRent` (ligne ~6655), la fonction qui **cote**
le loyer pour l'assurance et l'espérance de gain/perte (utilisée par `insuranceQuote`, `subInsuranceQuote`,
et le résumé des « cases hostiles » de l'onglet Résumé — 6 points d'appel au total, tous des calculs
d'exposition/prime, jamais un règlement réel). Depuis la section 257, sur un terrain de couleur
partiellement vendu avec « la banque perçoit un loyer sur sa propre part » (`bankCollectsRent`) DÉSACTIVÉ
(réglage par défaut) : `settlePropertyRent` ne facture plus au visiteur la part ordinaire non rachetée de
la banque (`purchasableBankShare`), mais `payableRent` la comptait encore comme un risque réel —
l'assurance normale/sous-standard facturait donc une prime sur une exposition FANTÔME qui ne se
matérialise plus jamais au règlement, depuis la section 257 elle-même. Les deux fonctions divergeaient
silencieusement depuis cette date — aucun test existant ne comparait directement leurs résultats.

### Correctif retenu

Même ligne, au mot près, que la section 257 originale, ajoutée à `payableRent` juste avant le plancher
`Math.max(0, payableShare)` : `if(!state.settings.bankCollectsRent) payableShare -=
purchasableBankShare(p)/100;`. Portée strictement identique à la section 257 : la branche aéroport/service
de `payableRent` (retour anticipé, avant cette ligne) n'est jamais touchée — seule la branche terrain de
couleur l'était déjà pour `settlePropertyRent`. Fonction unique modifiée : les 6 points d'appel
(`insuranceQuote`, `subInsuranceQuote`, résumé des « cases hostiles ») en bénéficient tous automatiquement,
même pattern « point d'entrée unique » que les autres correctifs de ce type dans ce fichier (ex.
`optionCoveredShares`, section 263).

### Tests

Nouveau fichier dédié `smoke_test_step266_payable_rent_bank_share_fix.js` (groupes A-F, 18 assertions) :
(A) `bankCollectsRent=false` (défaut) : `payableRent()` exclut bien la part fantôme de la banque (40%+30%
réellement distribués, 30% banque exclu). (B) non-régression `bankCollectsRent=true` : la part de la
banque reste dans l'exposition (elle est réellement payée et réellement encaissée dans ce cas). (C)
combiné avec un copropriétaire hypothéqué : les deux exclusions (hypothèque + part fantôme de la banque)
s'additionnent sans interférence ni double-décompte. **(D) — le cœur du bug** : équivalence DIRECTE entre
`payableRent()` et le montant RÉELLEMENT facturé par `settlePropertyRent()` au visiteur, dans les deux
réglages de `bankCollectsRent` — les deux fonctions sont désormais rigoureusement d'accord. (E)
`insuranceQuote()` : l'exposition cotée (`exposure`) reflète le montant corrigé — la prime n'est plus
surfacturée. (F) non-régression : la branche aéroport/service de `payableRent()`, jamais touchée par ce
correctif, reste insensible à `bankCollectsRent`.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (187 scripts désormais) relancée à 3 reprises
consécutives : **0 échec** (aucun test existant ne comparait directement `payableRent()` et
`settlePropertyRent()` — cet écart n'avait donc jamais été détecté par la suite). `python3 sync_script.py`
exécuté ; `index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff`
vide dans les 2 cas).

## 267. Bandeau « dernière action par joueur, confirmée ou non » dans l'en-tête + point sur les options de base de données temps réel

### Origine

Demande explicite de l'utilisateur, verbatim : « Il y a encore des problèmes avec l'entrée de données
multiutilisateurs. Est-ce que ce serait possible ? D'avoir dans le haut de l'écran. La dernière action que
chaque joueur a effectué. Selon le profil utilisé. Donc chaque joueur pourrait voir si la dernière action
qu'il a essayé de faire a passé. par lasse je veux bien sure dire confirmer enregistre au système. sinon
c'est quoi les option real-time database ».

### Analyse — deux besoins distincts

1. **« Est-ce que ma dernière action est bien enregistrée ? »** — un besoin PAR JOUEUR, réalisable
   immédiatement avec l'architecture existante (voir ci-dessous), sans dépendre du backend de stockage.
2. **« Sinon, c'est quoi les options real-time database ? »** — question sur l'alternative si (1) ne
   suffisait pas. Réponse : `window.storage` (l'environnement Claude/Cowork) est un backend à SONDAGE
   (3 secondes, voir `startPolling()`), sans mécanisme de push — c'est une contrainte de plateforme, pas
   quelque chose que le code de l'app peut changer. En déploiement autonome (GitHub/Vercel, voir
   `DEPLOY.md`), l'app utilise déjà Firebase Realtime Database avec un VRAI écouteur temps réel
   (`ref.on('value', ...)`) — aucun changement de code nécessaire pour en bénéficier, il suffit de
   déployer par cette voie plutôt que de jouer dans l'environnement Claude. Decision : le bandeau ci-dessous
   couvre le besoin (1) et fonctionne identiquement sur les deux backends (il ne dépend que de
   `state.log`/`saveGame()`, jamais du mécanisme de synchronisation lui-même) — aucune migration vers un
   autre backend temps réel n'a été demandée ni entreprise.

### Conception retenue

- **`log(text, entries)`** attribue désormais chaque entrée à `actorPlayerId` (le `myPlayerId` de CET
  appareil au moment de l'appel — log() est toujours synchrone à l'intérieur d'un `applyFn`, donc c'est
  toujours le profil qui a déclenché l'action, y compris pour un effet en cascade comme une expiration
  automatique) et `tsMs` (horodatage numérique). Champs additifs, `undefined`-safe partout ailleurs :
  aucune migration nécessaire pour les parties déjà en cours.
- **`lastActionEntryForPlayer(playerId)`** : la plus récente entrée de `state.log` (déjà en ordre du plus
  récent au plus ancien, `unshift`) attribuée à ce joueur — donc toujours une action déjà **confirmée**
  (state.log ne contient que des mutations déjà sauvegardées avec succès : un conflit écrase le `state`
  local, log() y compris, avant écriture — voir `saveGame()`).
- **`myLastActionStatus`** (variable LOCALE, en mémoire, jamais synchronisée — un « en cours » ou un
  « échec » n'existe par définition que sur CET appareil) : statut de la dernière action *tentée* par le
  profil actuellement sélectionné ici, alimenté par `attemptActionWithRetry({label})` — `'pending'` juste
  avant chaque tentative de sauvegarde, `'confirmed'` après succès, `'failed'` une fois les `maxAttempts`
  épuisés. Un échec MÉTIER (validation, avant tout essai réseau) ne touche PAS ce statut — seuls les vrais
  cycles réseau/conflit sont reflétés.
- **`runModalActionWithRetry()`** dérive automatiquement `label` du TEXTE du bouton `#mOk` (ex. « Confirmer
  l'achat ») quand aucun `label` explicite n'est fourni — donc les ~35 modales déjà converties à ce
  mécanisme bénéficient du nouveau statut SANS AUCUNE modification de leur site d'appel.
- **Affichage (`myActionStatusHtml()`)** : tant qu'une tentative est `pending`/`failed` (rien de plus
  récent n'existe encore dans `state.log`, par définition), affiche `⏳`/`❌` + le libellé local ; sinon
  (rien en cours, ou déjà confirmé — et donc déjà dans `state.log`) retombe sur la dernière entrée de
  `state.log` pour ce joueur (`✅ <texte>`) — ce qui couvre aussi les quelques actions qui n'utilisent pas
  `attemptActionWithRetry` (ex. `setHousesAvailable`) et le cas d'un rechargement de page (où la variable
  en mémoire repart à zéro).
- **Bandeau dans `render()`** (nouvelle classe CSS dédiée `.actionstatusbar`, sous le `.topbar` principal) :
  « Moi : <span id="myActionStatusBar">... » patché EN DIRECT par `attemptActionWithRetry`/
  `runModalActionWithRetry` (sans attendre un `render()` complet — donc visible même modale de réessai
  encore ouverte), suivi d'une ligne compacte listant chaque AUTRE joueur avec sa dernière action confirmée
  (`✅ <texte tronqué>` ou `—` s'il n'a encore rien fait) — répond directement à « la dernière action que
  chaque joueur a effectué ».
- Classe CSS séparée de `.topbar` (pas juste réutilisée) : la règle `.topbar>div{white-space:nowrap}`
  couperait la liste des autres joueurs plutôt que de la laisser s'enrouler sur petit écran — indésirable
  ici. Ajoutée dans `index.html` (source des styles, copiée par `sync_script.py`).

### Tests

Nouveau fichier dédié `smoke_test_step267_last_action_status.js` (groupes A-E, 24 assertions) : (A)
attribution `actorPlayerId`/`tsMs` par `log()`, `lastActionEntryForPlayer()` (y compris `null` pour un
joueur sans aucune action). (B) `myActionStatusHtml()` — `—` vs `✅ <texte>`. (C) `attemptActionWithRetry`
— `pending` posé AVANT l'appel réseau (observé via un espion sur `window.storage.set`), `confirmed` après
succès, `failed` après épuisement de tentatives sur des échecs d'ÉCRITURE répétés, AUCUN effet sur un échec
MÉTIER. (D) `runModalActionWithRetry()` — label auto-dérivé de `#mOk`, patch en direct de
`#myActionStatusBar` dès le `pending`, puis bascule sur `state.log` une fois confirmé. (E) `render()` —
bandeau complet (moi + les autres joueurs).

`node -c script_extracted.js` : SYNTAX OK. Suite complète (188 scripts désormais) relancée à 3 reprises
consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 268. Correctif : le bouton « Prêt » (et le lancer de dés pour tous qu'il déclenche) perdait silencieusement l'action d'un joueur en cas de clics concurrents

### Origine

Signalé par l'utilisateur, verbatim, directement sur l'application déployée (Vercel + Firebase Realtime
Database, pas l'environnement de test) : « l'application sur vercel avec firebase actuellement quand 2
joueurs cliques pour enregistrer une action seulement 1 s'effectue ».

### Diagnostic

Confirmé par lecture directe du code. `markCompanyReady()`, `cancelCompanyReady()` et
`performRollForAllCompanies()` (le lancer de dés pour TOUTES les entreprises, déclenché automatiquement
quand la dernière entreprise se déclare prête — voir section 86) appelaient `saveGame()` **directement**,
sans jamais passer par `attemptActionWithRetry()` — contrairement aux ~35 modales déjà converties à ce
mécanisme depuis la section 250. Le bouton « Prêt » est justement LE cas d'usage où plusieurs CEO cliquent
à quelques secondes d'écart, par design (« que tout les joueurs bougent en meme temps », section 86) : si
un 2e appareil clique alors que sa copie locale de `state` ne contient pas encore le `ready=true` que le
1er appareil vient de sauvegarder (le sondage a jusqu'à 3 secondes de retard, voir `startPolling`),
`saveGame()` détecte un VRAI conflit distant et REFUSE l'écriture — jusqu'ici sans aucun réessai
automatique : le clic du 2e joueur ne produisait simplement rien de sauvegardé, avec pour seul signe une
alerte à remarquer et une action à refaire soi-même. Exactement le symptôme rapporté. Le même trou
touchait `performRollForAllCompanies()` elle-même — la sauvegarde la plus coûteuse à perdre de toute
l'application (mouvement/loyers/taxes/horloge de TOUTES les entreprises d'un coup) : un conflit survenant
pile au moment de cette sauvegarde faisait disparaître tout le tour.

### Correctif retenu

Même mécanisme de réessai automatique déjà utilisé partout ailleurs (`attemptActionWithRetry`, voir
section 267 pour son détail) :
- `markCompanyReady()`/`cancelCompanyReady()` : toutes les vérifications ET la mutation déplacées dans
  `applyFn`, relues À CHAQUE tentative via `companyById(companyId)` (jamais une référence `co` capturée
  avant coup, potentiellement périmée après un conflit) — un conflit relit l'état frais (qui contient
  maintenant le `ready` de l'autre joueur) puis réapplique le sien par-dessus, sans rien perdre.
  `cancelCompanyReady()` garde un court-circuit AVANT le réessai (lecture fraîche unique) pour éviter un
  aller-retour réseau quand il n'y a manifestement rien à annuler.
- `performRollForAllCompanies()` : l'intégralité du corps de la fonction (déjà recalculée depuis `state` à
  chaque appel, aucune référence périmée) déplacée dans `applyFn` — un conflit relit l'état frais puis
  REJOUE l'intégralité du lancer contre lui (nouveaux dés à ce moment-là : sémantique délibérée, « le
  lancer n'a jamais été enregistré, on le refait pour de vrai », jamais un lancer à moitié sauvegardé).
  `results`/`neutralPawnResults` capturés dans des variables du champ d'application englobant pour
  préserver le contrat de retour existant (un tableau, pas `{ok,...}` — voir `checkAllCompaniesReady`/
  `rollDiceForAll` et les tests qui en dépendent déjà). Bénéfice croisé avec la section 267 : ces trois
  actions alimentent désormais, elles aussi, le bandeau « dernière action » de l'en-tête (label
  `'Prêt pour le lancer de dés'`/`'Annuler prêt'`/`'Lancer les dés pour tous'`).

### Tests

Nouveau fichier dédié `smoke_test_step268_ready_conflict_retry.js` (groupes A-C, 16 assertions) — simule
DEUX VRAIS appareils distincts (deux contextes `vm` séparés, chacun avec son propre `state`/
`lastSerialized`, partageant un seul backing de stockage — même pattern que
`smoke_test_step250_write_failure_vs_conflict.js`) pour reproduire fidèlement la course RÉELLE décrite par
l'utilisateur : (A) deux CEO cliquent « Prêt » sur deux appareils, le 2e sur une copie périmée — les DEUX
aboutissent désormais, aucune alerte, l'état final reflète les deux. (B) même course sur
`cancelCompanyReady()`. (C) un conflit survenant PENDANT la résolution du lancer-pour-tous (le 2e appareil
déclenche l'auto-roll sur une copie périmée) est absorbé : le tour se résout une seule fois (horloge +1,
pas 0 ni 2), les deux entreprises sont bien incluses, aucune alerte.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (189 scripts désormais) relancée à 3 reprises
consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 269. Correctif : deux actions DIFFÉRENTES confirmées au même instant sur deux appareils pouvaient s'écraser silencieusement — sauvegarde rendue atomique via `ref.transaction()` (Firebase)

### Origine

Signalé par l'utilisateur, en réponse au correctif de la section 268 (« ok Non tu n'as pas compris. »),
avec un exemple précis, verbatim : « Julien est en train d'acheter des actions d'une compagnie il entre
ses chiffres. Au moment où il clique sur confirmer l'achat Mehdi clique sur une autre action
d'enregistrement comme prendre un go d'avance ou autre. les 2 reçoivent leur pop-up de confirmation le cas
échéant. Dans l'application seulement 1 des 2 actions a été enregistrée... ca se produit quand 2 cliques
ou plus en même temps. »

### Diagnostic

Ce n'est PAS le même bug que la section 268. La section 268 corrigeait un conflit **détecté** mais jamais
réessayé (une alerte visible apparaissait, l'action était à refaire manuellement). Ici, l'utilisateur
précise que **les deux appareils reçoivent normalement leur popup de confirmation** — aucune alerte des
deux côtés — et pourtant une seule des deux actions survit. Cela ne peut arriver que si **aucun conflit
n'est jamais détecté**, par personne.

Racine identifiée par lecture directe du code : `saveGame()` vérifiait l'état distant (`storageGet`) PUIS
écrivait (`storageSet`) — deux appels séparés, jamais atomiques. Si les DEUX appareils font leur
`storageGet()` de vérification avant que l'un des deux n'ait eu le temps de `storageSet()`, **aucun des
deux ne voit l'écriture de l'autre à temps** : chacun conclut « rien n'a changé depuis ma dernière
synchronisation » et procède à l'écriture — le second `storageSet()` à atteindre le serveur écrase
intégralement le premier (`.set()`, que ce soit Firebase ou `window.storage`, remplace la valeur en bloc,
sans fusion). Aucune paire lecture/écriture, aussi rapprochée soit-elle, ne peut fermer cette fenêtre côté
client : il faut une véritable opération de comparaison-puis-échange **atomique côté serveur**.

### Correctif retenu

Firebase Realtime Database expose nativement cette primitive : `ref.transaction(updateFn)`. Le serveur
invoque `updateFn` avec la valeur **réellement présente au moment précis de la tentative d'écriture**
(jamais une valeur pré-lue côté client) et n'engage l'écriture que si `updateFn` l'accepte — sans aucune
fenêtre entre la vérification et l'écriture. `saveGame()` utilise désormais ce mécanisme quand Firebase est
configuré (`firebaseDb()` non nul) :
- Sérialise `state` avec sa version incrémentée dans `rawToTry` (calcul synchrone, AVANT tout `await` —
  son contenu est donc figé, immunisé contre une mutation concurrente de `state` qui se produirait pendant
  l'attente réseau qui suit).
- `ref.transaction(currentVal => currentVal===lastSerialized ? rawToTry : undefined)` — commet
  l'écriture SEULEMENT si la valeur distante au moment RÉEL de la tentative correspond encore à ce que ce
  client avait vu en dernier ; retourne `undefined` (abandon Firebase) sinon. Le tout premier `saveGame()`
  d'un client (`lastSerialized===null`) est protégé de la même façon : n'écrit que si le serveur est LUI
  AUSSI encore vide.
- `committed:true` → succès (`state.version`/`lastSerialized` mis à jour, retourne `true`).
- `committed:false` → conflit RÉEL détecté ATOMIQUEMENT (`txResult.snapshot` porte la valeur EXACTE que le
  serveur avait à cet instant) → même comportement qu'avant (rafraîchit `state`, alerte sauf
  `{silent:true}`, retourne `'conflict'`) → `attemptActionWithRetry` (section 250/267/268) réessaie
  automatiquement contre cet état frais, exactement comme pour un conflit classique.
- Échec réseau/quota/règles (`catch`) → `false`, `state` inchangé, comme avant.

Le contrat de retour à trois valeurs (`true`/`'conflict'`/`false`) reste **exactement identique** des deux
côtés : aucun appelant (les ~116 sites qui appellent `saveGame()`, `attemptActionWithRetry`,
`runModalActionWithRetry`) n'a besoin d'être modifié — le correctif est entièrement interne à `saveGame()`.
`window.storage` (environnement Claude/Cowork) n'expose aucune primitive transactionnelle équivalente —
contrainte de plateforme, comme le sondage 3 secondes déjà documenté (voir Architecture technique) : cette
fenêtre résiduelle y reste ouverte, mais l'usage multi-appareils réel de l'utilisateur passe par le
déploiement Firebase (voir DEPLOY.md), qui bénéficie pleinement du correctif.

### Tests

Nouveau fichier dédié `smoke_test_step269_firebase_atomic_save.js` (groupes A-C, 18 assertions) — simule
DEUX VRAIS appareils (deux contextes `vm` distincts) partageant un **mock fidèle de Firebase Realtime
Database** (lecture-décision-écriture strictement synchrone dans `transaction()`, comme le serveur réel ;
un hook `beforeTransaction` optionnel insère un VRAI délai `await` avant la lecture, pour simuler
fidèlement le temps qu'une requête réseau met à atteindre le serveur — c'est PENDANT ce délai qu'un autre
appareil peut désormais écrire sans que ça ne se perde) : (A) reproduit le scénario EXACT de l'utilisateur
— Julien achète des actions de la compagnie de Mehdi (modale avec réessai, `tradeCompanyShares`) pendant
que Mehdi prend une avance GO (action directe) sur un autre appareil ; la transaction de Julien est
délibérément retardée jusqu'après que Mehdi ait fini d'écrire — les DEUX actions aboutissent, aucune
alerte, les deux effets coexistent dans l'état final. (B) contrat bas niveau : commit/abandon selon que la
valeur distante correspond encore à `lastSerialized`, rafraîchissement de `state` sur le snapshot réel
d'un conflit détecté, protection du tout premier `saveGame()` d'un client (`lastSerialized===null`),
non-écrasement d'une partie déjà commencée ailleurs. (C) non-régression : sans `firebase` défini dans le
contexte (comme tous les 189 autres tests de la suite, qui simulent `window.storage`), `firebaseDb()`
renvoie `null` et l'ancien chemin reste emprunté à l'identique.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (190 scripts désormais) relancée à 3 reprises
consécutives : **0 échec** (les 189 tests préexistants, qui simulent tous `window.storage`, n'exercent
jamais le nouveau chemin Firebase et confirment qu'il n'y a aucun changement de comportement hors de ce
chemin). `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 270. Le bandeau « dernière action par joueur » (section 267) remplacé par un bandeau de préparation (✓/✗ par CEO)

### Origine

Après avoir livré la section 269 (correctif atomique), l'utilisateur a testé et demandé un changement
d'interface sur le bandeau introduit à la section 267, verbatim : « Ok je vais tester mais enlève le
bandeau qui mentionne la dernière actions. Ou en fait remplace là pour indiquer seulement le nom du
joueur : X ou crochet pour montrer qui n'a pas fini son tour ».

### Diagnostic

Le bandeau de la section 267 (« Moi: <mon dernier statut> » + « <Nom>: ✅ <dernière action> » pour chaque
autre joueur) s'est avéré, à l'usage, pas assez lisible : trop de texte variable, peu scannable d'un coup
d'œil pour répondre à la vraie question que se pose un joueur en fin de partie — « qui a fini son tour et
qui traîne encore ? ». L'utilisateur formule lui-même la réponse voulue : juste le nom du joueur avec un
symbole ✓/✗.

### Correctif retenu

Dans `render()`, le bloc qui construisait `othersActionsHtml`/`actionStatusRowHtml` (basé sur
`myActionStatusHtml()` et `lastActionEntryForPlayer()`) est remplacé par un bandeau de **préparation** :
une ligne compacte avec une entrée par CEO dont l'entreprise est éligible au lancer de dés ce tour-ci
(même ensemble `readyRollers` — `activeCompanies().filter(c=>!c.inJail)` — déjà utilisé juste au-dessus
pour le résumé « 🎲: X/Y » de l'en-tête), affichant `✓ <nom du CEO>` si `co.ready===true`, `✗ <nom du CEO>`
sinon. Contrairement à l'ancien bandeau, cette information est **entièrement dérivée de `state`** (le
champ `company.ready`, déjà synchronisé entre appareils depuis longtemps — sections 26/86/87) : aucun
statut local éphémère, donc aucun risque de désynchronisation entre ce qu'affiche un appareil et la
réalité côté serveur.

Réutilise la classe CSS `.actionstatusbar` existante (aucun changement CSS nécessaire). L'élément
`id="myActionStatusBar"` n'est plus émis par `render()` — `updateMyActionStatusBar()` continue d'exister
(patch en direct pendant un `attemptActionWithRetry`/`runModalActionWithRetry` en cours) mais devient un
no-op silencieux puisqu'il est gardé par `if(el)` et que l'élément n'existe plus dans le DOM. La
plomberie sous-jacente de la section 267 (attribution `actorPlayerId`/`tsMs` dans `log()`,
`lastActionEntryForPlayer()`, le paramètre `label` d'`attemptActionWithRetry`, la dérivation automatique
du `label` par `runModalActionWithRetry` depuis `#mOk`) est **conservée intégralement** — seul le rendu
visuel change, pas le mécanisme de suivi, qui reste disponible pour un usage futur (ex. un journal
d'activité détaillé, hors bandeau permanent).

### Tests

`smoke_test_step267_last_action_status.js` mis à jour : les groupes (A) à (D), qui couvrent la plomberie
sous-jacente toujours en place (attribution du log, `myActionStatusHtml()`, statuts pending/confirmed/
failed d'`attemptActionWithRetry`, dérivation automatique du label par `runModalActionWithRetry`),
restent inchangés et continuent de passer tels quels. Le groupe (E), qui testait le rendu de l'ancien
bandeau, est réécrit pour couvrir le nouveau bandeau de préparation : le bandeau ne contient plus
`id="myActionStatusBar"` ; avec les deux entreprises de test non prêtes (valeur par défaut `ready:false`
à la création), leurs deux CEO affichent `✗` et le joueur sans entreprise (`PlayerX`) n'apparaît pas dans
le bandeau ; après passage de l'une des deux entreprises à `ready:true`, son CEO affiche `✓` tandis que
l'autre reste `✗` — preuve que le rendu suit fidèlement `company.ready` et non un état local.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (190 scripts) relancée à 3 reprises
consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 271. Correctif : un pop-up automatique de fin de tour (pur reçu en lecture seule) gelait toute la synchronisation temps réel tant qu'il n'était pas fermé manuellement

### Origine

Retour d'un test utilisateur en conditions réelles (2 joueurs, juste après la livraison de la section
270), verbatim, en deux temps : « OK on prend un step là de 1 l'action n'est plus instantanée c'est long
de 2 quand tout le monde est prêt le rouler de dé de n'effectue pas automatiquement », puis clarification
déterminante : « En fait c'est pas que c'est long c'est qu'il faut faire une autre action un clique changer
l'onglet mettons pour qu'il apparaissent mais les tours ne s'enchaine pas ».

### Diagnostic

Le mécanisme d'auto-déclenchement du lancer pour tous (`markCompanyReady`/`checkAllCompaniesReady`/
`performRollForAllCompanies`, sections 86/268/269) fonctionnait déjà correctement côté DONNÉES — le tour
se résolvait bel et bien dès que la dernière entreprise cliquait « Prêt », peu importe l'appareil. Le
problème était ailleurs : `isLocalInputActive()` (voir Architecture technique / section 187bis) bloquait
TOUTE application d'une mise à jour distante (`applyRemoteStateIfNewer`, appelée par le polling classique
ET par l'abonnement temps réel Firebase) dès qu'UNE modale — n'importe laquelle — était ouverte sur cet
appareil, sans distinction entre une modale contenant un VRAI champ à protéger et un pur pop-up
informatif.

Or `showDiceRollTurnPopup()` (« Résultats du tour », section 205) s'ouvre AUTOMATIQUEMENT — sans aucun
clic — à la fin de CHAQUE tour, sur TOUS les appareils qui reçoivent l'événement (« Toujours affiché »,
demande explicite d'origine). La plupart du temps (hors 1er lancer de l'année pour la mise lot terrain/
ETF), ce pop-up est un pur REÇU en lecture seule (tableaux + bouton OK). Résultat : dès qu'un tour se
terminait, TOUS les appareils gelaient leur synchronisation — y compris le bandeau de préparation ✓/✗ de
la section 270 et le TOUR SUIVANT lui-même — jusqu'à ce que chaque joueur ferme manuellement son pop-up.
D'où le symptôme rapporté : il fallait « faire une autre action, un clic » (fermer le pop-up, ce qui
n'était pas évident puisqu'il ne semblait bloquer visuellement que lui-même) pour que quoi que ce soit
apparaisse, et les tours ne semblaient pas s'enchaîner.

### Correctif retenu

`isLocalInputActive()` ne bloque désormais la synchronisation que si la modale actuellement ouverte
contient VRAIMENT un champ éditable à protéger — détecté par un scan direct du HTML déjà inséré dans
`#modalHost` (`/<(input|textarea|select)[\s>]/i`), pas une requête DOM séparée (fidèle qu'importe comment
ce HTML y a été posé, y compris dans les tests, dont le DOM factice n'implémente pas `querySelector`).
Un `<select>` dans une modale (ex: `#mTerm`) reste protégé exactement comme avant, capturé par ce même
scan. Seul un pur reçu en lecture seule (`showTransactionPopup`, ou `showDiceRollTurnPopup` en dehors
d'une mise lot terrain/ETF due ce lancer-ci) ne bloque plus rien : ces pop-up ne relisent jamais `state`
après affichage (valeurs déjà figées dans leur fermeture JS au moment de l'ouverture) et `render()` ne
touche jamais `#modalHost` (seulement `#app`) — rien ne peut leur être « arraché » par un rendu
sous-jacent, donc rien ne justifiait de les protéger. Aucun changement ailleurs : `attemptActionWithRetry`/
`saveGame`/le mécanisme d'auto-déclenchement du lancer restent inchangés — seul le GARDE de synchronisation
est affiné.

### Tests

Deux tests existants, qui codaient explicitement l'ANCIEN comportement (« n'importe quelle modale ouverte
bloque, peu importe son contenu ») en manipulant `#modalHost.innerHTML` directement avec du contenu
factice sans rapport avec le HTML réel de l'app, sont mis à jour pour refléter le nouveau comportement :
`smoke_test_playtest_feedback_batch1.js` (cas « modal ouvert » désormais scindé en « AVEC un champ
éditable » qui bloque toujours et « REÇU pur » qui ne bloque plus) et
`smoke_test_step187bis_firebase_realtime_sync_and_select_focus.js` (le cas « select dans une modale »
utilise désormais un vrai `<select>` dans le HTML simulé, plus un nouveau cas « pop-up de reçu pur »).

Nouveau fichier dédié `smoke_test_step271_receipt_popup_does_not_block_sync.js` (groupes A-D, contre les
VRAIES fonctions de l'app, pas seulement des chaînes HTML synthétiques) : (A) `showTransactionPopup()` (le
reçu générique utilisé ~20 fois dans l'app) ne bloque pas. (B) `showDiceRollTurnPopup()` sans mise lot
terrain/ETF due (cas le plus fréquent) ne contient aucun champ éditable et ne bloque pas. (C)
`showDiceRollTurnPopup()` AVEC une mise lot terrain due (1er lancer de l'année, `terrainPosInYear===0`)
contient un vrai `<input>` et bloque toujours — non-régression de la protection nécessaire. (D) Bout en
bout avec DEUX appareils simulés (`window.storage` partagé) : reproduit fidèlement le scénario rapporté —
Julien puis Adrian cliquent « Prêt », le clic d'Adrian complète le seuil et déclenche automatiquement le
lancer SUR SON PROPRE appareil, où le pop-up « Résultats du tour » s'ouvre automatiquement ; SANS que cet
appareil ne ferme ce pop-up, Julien redevient prêt pour le tour suivant (sauvegardé côté serveur partagé) —
et le tick de polling suivant sur l'appareil d'Adrian applique bien ce changement malgré le pop-up resté
ouvert, prouvant que « les tours s'enchainent » désormais correctement.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (191 scripts désormais) relancée à 3 reprises
consécutives : **0 échec**. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 272. Correctif systémique : ~50 fonctions d'action du moteur (GO/prison/caution, fusion de lot, enchère de maisons, hypothèques, swaps/compensations de loyer, prêts, options...) sauvegardaient encore directement, sans le réessai automatique déjà en place ailleurs

### Origine

Après la livraison de la section 271, nouveau retour d'un test en conditions réelles, verbatim : « jai
tester rapidement et transaction ca n'a rien changé du tout. Il y a un pop up qui dit de refaire l'action.
Mais il apparaît même pas toujours ». Une confusion initiale sur la fraîcheur du fichier testé (l'utilisateur
avait téléversé une copie périmée sur GitHub à deux reprises, confirmé par comparaison de taille/nombre de
lignes) a été clarifiée par l'utilisateur lui-même : « en faite c'était le bon car j'avais la bande de qui a
joué son tour » — la bande de préparation ✓/✗ n'existant que depuis la section 270, ceci confirmait que le
retour portait bien sur le code À JOUR, pas une copie périmée.

### Diagnostic

Les sections 250/268/269 avaient déjà branché `attemptActionWithRetry`/`saveGame({silent:true})` (réessai
automatique avec relecture de l'état distant en cas de conflit réel, voir leur commentaire de tête) sur
~35 modales de confirmation et sur le bouton « Prêt ». Une relecture exhaustive de `script_extracted.js`
(recherche de tous les appels directs à `await saveGame()`, croisée avec `bindTabEvents` — la fonction
centrale qui relie chaque bouton/élément `data-*` à sa fonction métier) a révélé qu'environ 70 autres points
d'appel, correspondant à ~50 fonctions d'action DISTINCTES du moteur de jeu lui-même (pas des modales de
confirmation, mais les actions les plus centrales de l'app : lancer de dés, GO, prison/caution, fusion de
lot, enchère de maisons, hypothèques, swaps/compensations de loyer, prêts, options, ajustements
d'administration...), appelaient encore `saveGame()` directement, sans jamais passer par
`attemptActionWithRetry`. C'est la VRAIE cause, systémique, du symptôme rapporté : n'importe laquelle de ces
~50 actions pouvait, en cas de collision avec la sauvegarde d'un autre appareil (même sondage à ~3 secondes
de délai déjà identifié à la section 268), afficher une simple alerte de conflit SANS aucun réessai
automatique — parfois sans même d'alerte visible selon le point exact où le conflit survenait — laissant
l'action silencieusement non enregistrée.

### Correctif retenu

Conversion systématique, fonction par fonction, vers le même mécanisme de réessai déjà en place ailleurs :
toutes les vérifications ET la mutation sont déplacées dans un `applyFn` passé à `attemptActionWithRetry`,
relisant l'état frais (`companyById`/`state.properties.find`/etc.) à CHAQUE tentative — jamais une référence
capturée avant coup, potentiellement périmée après un conflit. Une garde silencieuse (`return;` sans alerte)
devient `return {ok:false};` (sans `error`) pour préserver exactement le comportement « rien ne se passe »
d'origine ; une garde avec alerte devient `return {ok:false, error:'...'};`, l'alerte étant affichée par
l'appelant après l'épuisement des tentatives, jamais pendant.

Fonctions converties (liste non exhaustive, la plus significative en premier) : `rollDiceAndMove` (lancer de
dés solo, chemin API/tests), `takeGoAdvance`, `sendToJail`, `payBail`, `passGo` (GO/prison/caution),
`mergeGroup` (fusion de lot), `resolveHouseAuction`/`setHousesAvailable`/`removeHouseBid`/
`adjustHouseReserve` (enchère de maisons), `repayMortgage`/`repayMortgageLot` (hypothèques),
`cancelContract`/`takeOverSubInsurance`/`takeOverInsuranceItemLive`/`takeOverTaxInsuranceLive`/
`takeOverSubInsuranceLive`/`cancelSubInsurance` (assurances), `createRentSwap`/`acceptRentSwapOffer`/
`refuseRentSwapOffer`/`cancelRentSwapOffer` et l'équivalent complet pour les compensations de loyer
(`createRentCompensation`/`acceptRentCompensationOffer`/`refuseRentCompensationOffer`/
`cancelRentCompensationOffer`), `cancelLoanRequest`/`submitLoanOffer`/`cancelLoanOffer`/`acceptLoanOffer`
(prêts), `respondToPreferredIssuance`/`payPreferredDividendDue`/`payPreferredDividendArrears`/
`cancelPreferredListing` (parts privilégiées), `submitTerrainLotBid` (lot commercial), `removeHouse`
(correctif manuel), `closeOptionPositionFromUi`/`closeOptionStrategyFromUi` (clôture d'options), ainsi que
plusieurs gestionnaires inline de l'onglet Administration (bascule de la fenêtre de transactions, position
manuelle, taux d'actualisation/de croissance, affichage TV, franchise du tour dans le formulaire
d'assurance groupée).

`buildHouse` (construction de maison) a nécessité un traitement particulier : trois de ses appelants directs
(court-circuits de `modalBuildHouseSource`, clic « Construire » du choix de terrain) l'appelaient SANS jamais
passer par le réessai, alors qu'un 4e chemin (le modal de compensation) était déjà protégé depuis la section
250 via `opts.silent`. `buildHouse` est donc devenue un petit répartiteur : en mode silencieux, délègue tel
quel à `buildHouseCore` (tout le corps métier original, inchangé, toujours appelable directement par un
appelant qui gère déjà lui-même son propre réessai) ; sinon, s'enveloppe elle-même dans
`attemptActionWithRetry` avant de sauvegarder/rendre/afficher le popup de transaction — corrigeant ainsi les
trois chemins d'un coup sans dupliquer sa logique métier.

Plusieurs fonctions se sont révélées déjà sûres après vérification de leurs appelants (toutes déjà appelées
en mode `{silent:true}` depuis un `runModalActionWithRetry`/`attemptActionWithRetry` englobant) et n'ont donc
volontairement PAS été converties : `purchaseInsuranceBundle`, `issuePreferredShares`, `expireContract`,
`callPreferredShares`, `listPreferredSharesForSale`, `buyPreferredSharesFromListing`, `executeShareSwap`,
`issueMortgage`/`issueMortgageLot`, `postLoanRequest`, `issueLoan`, `sellMergedShare`,
`buyMergedShareFromBank`, `submitHouseBid`, `sellHousesToCompany`, `proposeRentSwap`,
`proposeRentCompensation`, `settlePropertyRent`/`settleNeutralPawnRent` (toujours appelées avec
`{skipSave:true}` par `corePerformDiceRoll`, lui-même sous `attemptActionWithRetry`), `buySubInsurance`. De
même, `payTax` (branche morte : son seul appelant `corePerformDiceRoll` passe toujours `{skipSave:true}`) et
trois fonctions orphelines sans aucun appelant dans tout le fichier (`cancelPropInsurance`,
`expirePropInsurance`, `expireSubInsurance`, dans la même situation que `expireContract` déjà documentée)
n'ont pas été touchées — code mort, sans chemin d'exécution possible depuis l'interface.

### Tests

Nouveau fichier dédié `smoke_test_step272_engine_actions_retry.js` : scénario à VRAIS 2 appareils (même
`backing` de stockage partagé, même technique que `smoke_test_step250_write_failure_vs_conflict.js`) contre
deux fonctions nouvellement converties parmi les plus critiques. (A) `takeGoAdvance()` : un conflit réel est
déclenché pendant la 1re tentative d'écriture du 1er appareil (le 2e appareil sauvegarde une modification
concurrente sans rapport entre-temps) — vérifie que `goAdvancesOwed` est incrémenté d'EXACTEMENT 1 (jamais 0
— perdu — ni 2 — dupliqué par un rejeu de la mutation), que la modification concurrente de l'autre appareil
n'est jamais écrasée, et qu'aucune alerte bloquante ne s'affiche avant le succès final. (B) `sendToJail()` :
même scénario — vérifie que l'entreprise est bien envoyée en prison (`inJail`/`jailTurnsLeft`) malgré le
conflit, sans jamais perdre l'action ni écraser la modification concurrente.

`node -c script_extracted.js` : SYNTAX OK. Suite complète (192 scripts désormais) relancée à 3 reprises
consécutives après l'ensemble des conversions ci-dessus : **0 échec** à chaque fois (une unique défaillance
isolée de `smoke_test_step261_portfolio_audit_fixes.js`, observée une seule fois sur l'ensemble des passages,
a été reproduite 40 fois d'affilée en isolation sans jamais échouer à nouveau — ce test ne touche aucune des
fonctions converties dans cette section ni `advanceGameClock`/le moteur d'options que cette section ne
modifie pas ; retenu comme une flakiness préexistante de ce test précis, indépendante de ce correctif, et non
comme une régression). `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 273. Changement de libellé seulement : « ETF » renommé « REIT » partout où c'est visible par le joueur

Demande explicite de l'utilisateur : « Changement de libellé seulement : Changer les termes ETF pour REIT
pas de changement mécanique. » Aucune mécanique, aucun calcul, aucune structure de donnée ne change — seul
le texte affiché au joueur est modifié.

### Portée

Tous les textes visibles (labels de `ETF_DEFS`, titres de section, boutons, messages `alert`/`log`,
libellés d'états financiers, lexique, écran de configuration, affichage spectateur) sont passés de « ETF »
à « REIT ». Le nom du produit ETF étant prononcé en épelant les lettres (son voyelle), les élisions du
français qui précédaient « ETF » (« l'ETF », « d'ETF », « cet ETF », « de l'ETF ») ne s'appliquent plus
devant « REIT » (prononcé comme le mot anglais, son consonne) : « l'ETF » → « le REIT », « d'ETF » →
« de REIT », « cet ETF » → « ce REIT », « de l'ETF » → « du REIT » (contraction de/le obligatoire devant
consonne). Les formes déjà non-élidées (« les ETF », « un ETF », « chaque ETF », « des parts d'ETF » où
seul « d'ETF » élide) suivent la même règle au cas par cas.

Tous les identifiants internes de code restent inchangés (aucun changement mécanique demandé) :
`ETF_DEFS`, `ETF_MIN_BID`, `state.etfs`, `company.etfHoldings`, `settings.features.etf`,
`etfBankReservePct`, les noms de fonctions (`openAllEtfs`, `submitEtfBid`, `resolveEtfAuction`,
`sellEtfUnits`, `processEtfLap`, `renderEtf`, `companyEtfValue`, etc.), les id DOM (`openEtfsBtn`,
`mEtfBid_*`, `setupEtfReservePct`), les clés de catégories du grand livre (`etf_dividend_revenue`,
`etf_purchase`, `etf_sale`) et la clé d'onglet `etf`. Seules les VALEURS de texte affichées (labels,
titres, messages) changent.

### Méthode

Un script (`node strip_comments.js`, parseur `acorn` déjà existant dans le projet) a servi à séparer le
code/les chaînes des commentaires, pour isoler précisément les 71 occurrences de « ETF »/« Etf » hors
commentaires restées après la conversion — confirmant qu'il ne s'agissait plus que d'identifiants internes
(aucun texte affiché oublié). Les commentaires du code (documentation interne, jamais vue par un joueur)
n'ont volontairement pas été touchés.

### Tests

4 tests vérifiaient le texte affiché exact et ont été mis à jour pour attendre « REIT » au lieu de « ETF » :
`smoke_test_step19_entreprise_rent_etf_go_polish.js`, `smoke_test_step20_entreprise_popups_restructure.js`
et `smoke_test_step6c_entreprise_reorg.js` (badge `📊 REIT (Première rue)` dans Mon Entreprise),
`smoke_test_step221_chain_etf_capex.js` (comptage des 4 badges REIT), et
`smoke_test_step34_remove_etf_and_hostile_hard_text.js` (titre de section, bouton « Ouvrir les REIT », et
deux phrases du Lexique). `node -c script_extracted.js` : SYNTAX OK. Suite complète (192 scripts) relancée
à 3 reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 274. Nouvelle mécanique : swap de revenu fixe/variable (vente du revenu futur de terrains, marché ouvert premier arrivé)

Demande explicite de l'utilisateur, verbatim : « Ajoute une option dans menu action dans mon entreprise. Un
swap revenu fixe vs variable. En gros une entreprise peut décider de soumettre aux autres entreprises un
swap de ses revenus. Elle sélectionné un/des/tous les terrains et demandé un prix en échange un revenu
fixe par exemple 5M et une durée par exemple 1 an. Elle reçoit immédiatement le 5M si accepté par une
entreprise et cède ses revenus de terrains pendant la durée. Il n'est pas possible de vendre, hypothéquer
ou autre sur ses terrains pendant ce temps. Et la priorité de paiement est la même que les autres swap. »

Trois points ont été clarifiés avec l'utilisateur (AskUserQuestion) avant l'implémentation, réponses
retenues :

- **Mécanisme de marché** : marché ouvert, premier arrivé — l'entreprise vendeuse publie une annonce à
  prix fixe visible de toutes les autres entreprises ; la première à cliquer « Accepter » conclut
  l'échange. Ce n'est PAS une proposition ciblée à une seule entreprise (à la différence du swap de loyers
  ordinaire, `state.rentSwaps`, qui reste une proposition + accepter/refuser bilatérale).
- **Portée des terrains** : liste figée à la création de l'annonce — contrairement au côté « général » du
  swap de loyers ordinaire (section 258), qui suit dynamiquement tout le portefeuille présent ET futur, un
  terrain acheté APRÈS la publication de l'annonce (ou APRÈS l'acceptation) n'est jamais concerné.
- **Restrictions additionnelles sur les terrains verrouillés** (en plus de vente/hypothèque, déjà demandées
  explicitement) : seule « nouveau swap/compensation de loyer sur le même terrain » a été retenue parmi les
  options proposées. Construction de maisons et fusion de lot restent donc explicitement PERMISES sur un
  terrain sous swap de revenu actif — choix délibéré de l'utilisateur, pas un oubli.

### Mécanique retenue

Une entreprise vendeuse choisit un ou plusieurs terrains (ou lots regroupés — un lot compte pour un seul),
fixe un prix total et une durée en années, et publie l'annonce (bouton « 💱 Vente de revenu », menu ☰
Actions, Mon Entreprise → `postRevenueSwapListing`). L'annonce (`state.revenueSwapListings`) est visible de
toutes les autres entreprises dans le tableau « Marché des annonces de revenu » (Mon Entreprise, accordéon
Produits financiers). La première entreprise à cliquer « Accepter » (`acceptRevenueSwapListing`) verse le
prix affiché IMMÉDIATEMENT à la vendeuse et reçoit en échange la TOTALITÉ (100%, aucun plafond par
événement contrairement au swap de loyers ordinaire) du loyer de ces terrains pendant la durée convenue —
un swap actif est créé (`state.revenueSwaps`) et l'annonce disparaît pour toutes les autres entreprises. La
vendeuse peut retirer son annonce tant qu'elle n'a pas été acceptée (`cancelRevenueSwapListing`).

**Priorité de paiement** : « la priorité de paiement est la même que les autres swap » a été interprété
comme une MUTUELLE EXCLUSION structurelle plutôt qu'une préférence à arbitrer — un swap de revenu fixe
actif sur un terrain, pour un propriétaire donné, est vérifié EN PREMIER dans `settlePropertyRent`/
`settleNeutralPawnRent` (avant l'appel à `swapSplit`, qui gère le swap de loyers ordinaire) : si un swap de
revenu fixe couvre la part, elle est redirigée en entier vers l'acheteuse et `swapSplit` n'est même pas
appelé pour cette part — un terrain ne peut donc jamais être capté à la fois par un rentSwap ET un swap de
revenu fixe. Vérifié explicitement avec un rentSwap général préexistant sur le même propriétaire/terrain :
le swap de revenu fixe l'emporte toujours, quelle que soit l'ordre de création des deux accords.

**Verrouillage** : tant qu'un swap de revenu fixe est actif sur un terrain donné, la VENDEUSE ne peut plus
le vendre (`modalSellShare`/`sellMergedShare`), l'hypothéquer (`issueMortgage`/`issueMortgageLot`), ni y
signer un nouveau swap de loyers, spécifique seulement (`proposeRentSwap`/`createRentSwap`) — un accord de
compensation de loyer, lui, n'étant jamais spécifique à un terrain, n'a besoin d'aucune garde de création :
la part redirigée par le swap de revenu fixe entre naturellement dans le netting entre le VISITEUR et
l'ACHETEUSE, exactement comme une part déjà redirigée par un rentSwap. Construire une maison (`buildHouse`)
et fusionner un lot (`mergeGroup`) restent explicitement permis (voir clarification ci-dessus).

L'accord expire de lui-même à chaque fin d'année financière (`processYearEnd`, `yearsRemaining` décompte,
aucune clôture manuelle) — les terrains redeviennent alors normalement vendables/hypothécables pour leur
propriétaire d'origine.

### Fichiers/fonctions touchés

`FEATURE_LIST`/`mergedSettings.features`/`migrateState()` : nouveau drapeau `revenueSwap` (activé par
défaut, y compris pour une partie déjà en cours). `state.revenueSwapListings`/`state.revenueSwaps` : deux
nouveaux tableaux d'état. `LEDGER_CATEGORIES` : `revenue_swap_purchase`/`revenue_swap_sale` (même
traitement que `etf_purchase`/`etf_sale`). Nouvelles fonctions moteur : `isPropertyLockedByRevenueSwap`,
`revenueSwapSellableItems`, `postRevenueSwapListing`, `cancelRevenueSwapListing`,
`acceptRevenueSwapListing`. Gardes ajoutées à `issueMortgage`/`issueMortgageLot`, `modalSellShare`/
`sellMergedShare`, `createRentSwap`/`proposeRentSwap` (côté spécifique). Redirection ajoutée dans
`settlePropertyRent`/`settleNeutralPawnRent` (avant `swapSplit`) et dans les libellés `ownerLabel` du reçu
de transaction (distingue désormais un versement « via swap de revenu fixe/variable » d'un versement « via
swap de loyers »). Décompte/expiration ajoutés à `processYearEnd`. Côté interface (Mon Entreprise) :
nouveau bouton « 💱 Vente de revenu » (menu ☰ Actions, groupe « Assurance & Swaps », visible seulement s'il
existe au moins un terrain vendable et une autre entreprise active), nouvelle modale
`modalProposeRevenueSwap` (cases à cocher pour les terrains éligibles, prix, durée), et deux nouveaux
tableaux dans l'accordéon « Produits financiers » — « Marché des annonces de revenu » (Accepter/Retirer) et
« Swaps de revenu fixe/variable actifs » — chacun masqué entièrement s'il est vide, même convention que les
tableaux swaps/compensations existants. Nouvelle entrée de Lexique sous le thème « Swaps et compensations
de loyer ».

### Tests

Nouveau fichier dédié `smoke_test_step274_revenue_swap.js` (37 assertions) : validations de
`postRevenueSwapListing` (aucun terrain, prix nul, durée invalide, terrain non possédé, terrain hypothéqué,
terrain déjà sous un swap de revenu actif, terrain déjà dans une annonce en attente) ; marché ouvert
premier arrivé avec versement immédiat et no-op silencieux sur une 2e tentative tardive ; priorité de
paiement (le swap de revenu fixe l'emporte sur un rentSwap général préexistant sur le même terrain), à la
fois via `settlePropertyRent` et `settleNeutralPawnRent` ; garde-fous bloqués (hypothèque, vente via la
modale réelle, nouveau swap de loyers proposé et créé) sur un terrain verrouillé ; actions explicitement
permises (fusion de lot, construction de maison) sur ce même terrain verrouillé ; décompte et expiration en
fin d'année financière avec déverrouillage. `node -c script_extracted.js` : SYNTAX OK. Suite complète (193
scripts, nouveau test inclus) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).

## 275. Refonte structurelle : la « vente de revenu » devient un véritable ABS (titre adossé à des actifs) — plafond cumulatif de retenue de prêt, part cessible plafonnée, tranches senior/junior à souscription multiple, résolution automatique au semestre

Immédiatement après la livraison de la section 274, demande de correction détaillée de l'utilisateur,
verbatim : « **Contexte** — La « vente de revenu » récemment ajoutée est économiquement une **cession de
loyers futurs**, pas un swap : une partie verse un montant unique et reçoit un flux. Le bouton « 💱 Vente
de revenu » porte le bon nom ; le mot « swap » devrait disparaître du vocabulaire interne de ce produit
pour ne pas le confondre avec les trois vrais swaps déjà présents. Les six changements ci-dessous
corrigent deux défauts structurels et transforment le produit en véritable titre adossé à des actifs, avec
souscription multiple et tranches. Chang. libellé : ABS. Les changements 1 et 2 sont liés et doivent être
faits ensemble : le second dépend du premier pour être correct. »

**1. Plafond CUMULATIF de retenue de loyer à 40%** — « Aujourd'hui, plusieurs prêts simultanés sont
permis et la retenue s'empile : chaque prêt applique son pourcentage au solde restant après les
précédents, jamais au loyer brut. Trois prêts à 40% retiennent donc 40%, puis 40% de 60% = 24%, puis 40%
de 36% = 14,4% — soit 78,4% du loyer au total. Le réglage de 40% est un plafond par prêt, pas un plafond
global. **Le changement :** la retenue agrégée, tous prêts confondus, ne peut jamais dépasser le
pourcentage maximal du réglage (40%) du loyer brut. [...] **Affichage à ajouter :** dans la demande
d'émission d'obligation, le détail doit indiquer le pourcentage de retenue maximal encore disponible pour
cette entreprise (40% moins ce que ses prêts actifs retiennent déjà). »

**2. Ce qui est cédé : la part du vendeur, moins la réserve de retenue** — « La cession ne porte jamais sur
le loyer plein du terrain. [...] Et la part cédée est plafonnée pour ne jamais chevaucher une retenue de
prêt. Le montant maximal cessible = part du vendeur × (100% − plafond de retenue). Avec une part de 40% et
un plafond de 40%, le maximum cessible = 24% du loyer plein. Ce plafond se calcule sur le maximum DU
RÉGLAGE, pas sur les prêts réellement en cours (délibéré — sinon une entreprise sans dette céderait 40%,
emprunterait ensuite, et le chevauchement reviendrait par la porte arrière ; la capacité d'emprunt est
réservée d'avance). »

**3. Publication et résolution dans le même semestre** — « L'annonce se publie au semestre [...]. Elle doit
se résoudre dans ce même semestre, AVANT le lancer de dés [...]. Si personne n'a manifesté d'intérêt,
l'annonce est annulée d'office. Aucun report au semestre suivant. »

**4. Souscription : montant maximal déclaré, partage égal plafonné** — « Plusieurs entreprises souscrivent
et se partagent le flux au prorata de ce qu'elles ont payé [...]. Chaque souscripteur déclare un montant
maximal. Résolution tranche par tranche : (1) part égale = montant recherché / nombre de souscripteurs ;
(2) tout souscripteur dont le max est inférieur à cette part est fixé à son max et sort du partage ; (3)
recalcule une part égale sur le montant restant entre les souscripteurs qui restent ; (4) répète jusqu'à
stabilité. Si la somme des maximums reste sous le montant recherché, la tranche est souscrite
partiellement. »

**5. Deux tranches : senior et junior** — « L'émetteur répartit le montant total entre une tranche senior
et une junior [...]. La tranche SENIOR est servie en premier à chaque loyer encaissé, jusqu'à avoir reçu
son capital + une prime fixe, puis ne reçoit plus rien (rendement plafonné). La tranche JUNIOR reçoit tout
ce qui vient après — rien tant que la senior n'est pas servie en entier, mais empoche l'intégralité du
surplus si les dés sont généreux, sans plafond. **Condition d'existence : au moins un souscripteur senior
à la résolution — sinon l'opération entière est annulée** (annonce retirée, aucun argent ne change de
main). Une tranche junior SANS souscripteur ne bloque rien : le flux résiduel après la senior revient à
l'émetteur, qui conserve le premier risque (rétention du risque, comme la réglementation post-2008). À
l'expiration, chaque porteur garde ce qu'il a reçu — non-recours, aucune obligation de l'émetteur. »

**6. L'ancrage de prix — cinq chiffres, des deux côtés** — « La fenêtre de publication ET la fenêtre de
souscription doivent afficher, à côté du prix demandé, le loyer attendu sur la durée exacte de l'accord
(fonctions d'espérance déjà utilisées pour tarifer les primes d'assurance). Cinq chiffres, séparément pour
les deux tranches : la part cédée (%), la durée (années), le loyer attendu sur cette durée, le prix
demandé, ce que la tranche senior doit recevoir pour être servie en entier. »

Ce que l'émetteur fixe, et ce que l'application calcule seule (correction d'une contradiction interne de la
demande initiale — voir clarifications ci-dessous), verbatim : « Ma liste dans le texte est incomplète. Il
lui faut cinq décisions : Les terrains du panier / La durée / Le montant total recherché / La répartition
senior/junior — 60/40 dans l'exemple / La prime plafonnée de la senior — les 20%. Et le point 5 est celui
que j'avais mal traité : j'ai écrit « définie en réglage », donc globale. C'est une erreur. Cette prime est
le prix de la tranche senior, et elle doit se fixer par opération, pas une fois pour toute la partie. [...]
Je voudrais donc que les tranches et paramètres entre les senior et junior soit fixer d'avance par
l'application pas par un CEO. Faire en sorte que les JOUEURS et les ENTREPRISES puissent acheter des
tranches, mais JAMAIS LE CEO OU LE JOUEUR (CEO) DE L'ENTREPRISE ÉMETRICE. »

Quatre clarifications posées via AskUserQuestion avant l'implémentation, réponses retenues :

- **Vocabulaire** : « Même chose que ETF mais seulement pour le dernier 'Swap' créer pas les anciens » —
  même convention que le renommage ETF→REIT (section 273) : renommage d'AFFICHAGE seulement (le bouton
  « 💱 Vente de revenu » garde son libellé, confirmé correct ; les identifiants internes
  `state.revenueSwaps`/`postRevenueSwapListing`/`features.revenueSwap` ne changent pas), scopé
  STRICTEMENT à ce produit — explicitement PAS appliqué à `rentSwap`/`rentCompensation` (les deux autres
  swaps existants gardent leur vocabulaire).
- **Part cédée** : « Ajustable jusqu'au maximum » — l'émetteur choisit un % de sa part à céder, plafonné
  au maximum calculé (`part détenue × (1 − plafond de retenue de prêt)`), jamais imposé à ce maximum.
- **Répartition senior/junior + prime senior** : « Calculé automatiquement par l'app » — jamais choisi par
  le CEO ; calculé par l'application à partir du risque du panier lui-même (« comme une prime
  d'assurance »). Résout la contradiction interne de la demande (prime par opération vs paramètres fixés
  par l'app) en faveur du calcul automatique — les décisions réelles de l'émetteur se limitent donc à :
  terrains, durée, % cédé (borné), montant total recherché.
- **Déclencheur de résolution** : « Oui, automatique au 1er lancer suivant (recommandé) » — résolution
  entièrement automatique, juste avant le premier lancer de dés (individuel ou « pour tous ») du semestre
  suivant, sans bouton manuel.

### Mécanique retenue

**Plafond cumulatif de retenue de prêt.** Nouvelle fonction `loanWithholdingHeadroom(borrowerId)` = plafond
du réglage (`loanOfferWithholdingPctMax`, 40% par défaut) moins la somme des `withholdingPct` de tous les
prêts actifs non-dernier-recours de l'emprunteur. `submitLoanOffer` borne désormais le % d'offre à
`min(plafond du réglage, headroom résiduel)` ; `issueLoan` re-vérifie ce même plafond en défense en
profondeur (un prêt qui dépasserait le headroom disponible est refusé avec message explicite). Le calcul
séquentiel/cascadé existant d'`applyLoanWithholding` (le plus ancien prêt servi en premier, chacun appliqué
au SOLDE restant après les précédents) reste inchangé — la correction porte uniquement sur la validation à
l'ÉMISSION : la somme NOMINALE des pourcentages ne peut plus dépasser 40%, donc la retenue agrégée réelle
(toujours ≤ la somme nominale, par construction du calcul cascadé) ne peut plus jamais dépasser 40% non
plus. Affichage : le formulaire d'offre de prêt (Portefeuille) montre désormais le headroom résiduel de
l'emprunteur à côté du curseur de %.

**Part cessible plafonnée.** Nouvelle fonction `absMaxCedablePct()` = `1 − loanOfferWithholdingPctMax`
(calculée sur le PLAFOND DU RÉGLAGE, jamais sur les prêts réellement en cours — délibéré, pour empêcher le
contournement « céder d'abord, emprunter ensuite »). La modale de publication borne le curseur de % cédé à
ce maximum et affiche le détail du calcul (part détenue du terrain, plafond de retenue réservé, part
réellement cédée en % du loyer plein).

**Tarification automatique (« comme une prime d'assurance »).** Nouvelle fonction
`computeAbsPricing(sellerId, propertyIds, cededPctOfShare, years)` : pour chaque terrain du panier (lots
fusionnés expansés via `lotProperties()` pour ne jamais sous-compter un lot multi-cases), la probabilité
statique d'atterrissage par case (`p.prob`, indépendante de la position — modèle « n'importe quel visiteur
futur », pas une distance depuis une position actuelle) donne, sur l'horizon en lancers de dés
(`years × 6` — un an = 6 lancers globaux), une espérance et une variance du loyer cédé (approximation
d'épreuves de Bernoulli indépendantes, sommées sur le panier). `meanRent`/`stdRent` en résultent ;
`seniorCapacity = max(0, meanRent − ABS_SENIOR_CONFIDENCE_Z × stdRent)` (nouvelle constante,
`ABS_SENIOR_CONFIDENCE_Z = 1.0`, dans le style des constantes `LAST_RESORT_LOAN_*` existantes — un simple
`const`, pas un réglage de partie). `computeAbsTranches(pricing, amountSought)` en déduit
`seniorAmount = min(amountSought, seniorCapacity)`, `juniorAmount = amountSought − seniorAmount`, et une
prime senior proportionnelle à l'utilisation de la capacité senior (`ABS_SENIOR_BASE_PREMIUM_PCT = 0.10`,
même style de constante) — plus un émetteur demande une part senior proche de sa capacité maximale, plus la
prime exigée par l'application est élevée (cohérent avec la remarque de l'utilisateur : « un émetteur dont
les terrains sont médiocres doit offrir davantage pour trouver un souscripteur senior »). Ces cinq chiffres
(part cédée %, durée, loyer attendu sur la durée, montant recherché, seuil de service complet de la
senior) sont affichés à la fois dans la modale de publication et dans la modale de souscription (point 6).

**Souscription multi-porteur, partage égal plafonné.** Nouvelle fonction
`subscribeRevenueSwapTranche(listingId, tranche, holderType, holderId, maxAmount, opts)` — une COMPAGNIE ou
un JOUEUR (jamais l'entreprise émettrice elle-même, ni le CEO joueur de l'entreprise émettrice — exclusion
« délit d'initié » vérifiée à la souscription) déclare un montant maximal sur la tranche senior ou junior
d'une annonce. `levelAbsSubscriptions(subs, target)` implémente l'algorithme de partage égal plafonné
exactement comme spécifié : part égale = cible / nombre de souscripteurs restants ; tout souscripteur sous
cette part est fixé à son maximum et sort du partage ; recalcul de la part égale sur le solde entre les
souscripteurs restants ; répétition jusqu'à stabilité. Une tranche dont la somme des maximums reste sous sa
cible est souscrite partiellement (l'émetteur lève moins).

**Résolution automatique au semestre.** Nouvelle fonction `maybeResolveRevenueSwapListings()`, appelée au
même point précis que `maybeResolveTerrainLotAuction()`/`maybeResolveEtfAuctions()` — juste avant
l'incrément du compteur de lancers global, dans `rollDiceAndMove` ET `performRollForAllCompanies` — donc
systématiquement au tout premier lancer d'un nouveau semestre (`tradingWindowOpen()` encore vrai), jamais
reporté. `resolveRevenueSwapListing(listing)` : si aucun souscripteur senior, annulation complète (annonce
retirée, aucun argent ne bouge — condition d'existence du point 5) ; sinon, la tranche senior est finalisée
au montant réellement levé (`seniorRaised`, jamais gonflée par l'émetteur — la senior est réservée aux
investisseurs, aucune rétention côté émetteur) et son plafond de service recalculé sur ce montant réel si
sous-souscrite ; la tranche junior est finalisée sur sa cible COMPLÈTE, la portion non souscrite étant
comblée par une entrée synthétique attribuant ce solde à l'émetteur lui-même (rétention du risque — la même
fonction générique de versement traite ensuite cette entrée comme n'importe quel porteur junior, sans cas
spécial). Le capital levé (part réellement souscrite par des tiers, senior + junior) est versé
immédiatement à l'émetteur (`abs_proceeds`) ; chaque souscripteur voit son capital débité (`abs_subscription_outflow`).

**Versement à chaque loyer encaissé — waterfall senior→junior.** Dans `settlePropertyRent` et
`settleNeutralPawnRent`, la vérification d'un ABS actif sur le terrain (propriétaire vendeur, terrain dans
le panier) se fait EN PREMIER, avant `swapSplit` (le swap de loyers ordinaire) — même priorité de paiement
que la section 274, l'ABS l'emportant toujours en cas de chevauchement. La part du propriétaire est scindée
en `retainedAmount = part × (1 − cededPctOfShare)` (flux NORMAL — passe par le pipeline habituel de
retenue de prêt, crédité au vendeur, aucun libellé spécial) et `cededAmount = part × cededPctOfShare`
(détourné vers la nouvelle fonction `distributeAbsCashflow(deal, cededAmount, entries)`, qui sert d'abord
la tranche senior au prorata des porteurs jusqu'à son plafond de service, puis le surplus à la tranche
junior au prorata — `creditAbsHolder` crédite directement `company.cash` ou `player.cash` selon le type de
porteur, exactement comme `recordLoanInterestReceivedByPlayer` le fait déjà pour un prêteur joueur). Un
porteur COMPAGNIE crédité en cours de partie (`abs_income`, revenu opérationnel réel) ; un porteur JOUEUR
voit sa trésorerie personnelle créditée directement et un nouveau champ `player.cumAbsIncomeReceived`
incrémenté (registre plafonné à 50 entrées, `state.absIncomePayments`, même convention que
`state.loanInterestPayments`).

**Non-recours, expiration.** `processYearEnd` décompte les années restantes et fait expirer l'accord en fin
de durée sans obligation résiduelle — chaque porteur garde ce qu'il a reçu, le journal note le % de service
atteint par la senior à l'expiration, et les terrains redeviennent normalement vendables/hypothécables pour
l'émetteur.

**Ce qui ne change pas** : les clauses restrictives (pas de vente/hypothèque/nouveau swap de loyers pendant
l'accord) ; construction de maisons et fusion de lot restent permises ; priorité face au swap de loyers
ordinaire inchangée ; `isPropertyLockedByRevenueSwap`/`revenueSwapSellableItems` inchangées (toujours
valides — `sellerId`/`propertyIds` préservés dans la nouvelle forme du deal).

### Fichiers/fonctions touchés

Nouvelles constantes : `ABS_SENIOR_CONFIDENCE_Z`, `ABS_SENIOR_BASE_PREMIUM_PCT`. Nouvelle fonction
`loanWithholdingHeadroom(borrowerId)` ; `submitLoanOffer`/`issueLoan` mis à jour (bornage + garde en
profondeur) ; `renderPortefeuilleTrading` (affichage du headroom résiduel dans les lignes de demande de
prêt). Réécriture complète du bloc section 274 : `absMaxCedablePct`, `computeAbsPricing`,
`computeAbsTranches`, nouvelle signature `postRevenueSwapListing(companyId, propertyIds, cededPctOfShare,
amountSought, years, opts)` (gardée par `tradingWindowOpen()`), `cancelRevenueSwapListing` (forme
inchangée), `subscribeRevenueSwapTranche`/`cancelRevenueSwapSubscription`, `levelAbsSubscriptions`,
`maybeResolveRevenueSwapListings`/`resolveRevenueSwapListing`, `creditAbsHolder`/`distributeAbsCashflow`.
`maybeResolveRevenueSwapListings()` appelée dans `rollDiceAndMove` et `performRollForAllCompanies`, au même
point que `maybeResolveEtfAuctions()`. Redirection réécrite dans `settlePropertyRent`/
`settleNeutralPawnRent` (split retenu/cédé + waterfall) ; nettoyage du libellé `ownerLabel` (l'ancienne
branche `c.viaRevenueSwap`, plus jamais déclenchée sous le nouveau modèle multi-porteur, retirée — la part
cédée ne transite plus jamais par `cutResults`). `processYearEnd` mis à jour pour l'expiration non-recours
multi-porteur. `LEDGER_CATEGORIES` : `abs_proceeds`/`abs_subscription_outflow`/`abs_income` (les anciennes
`revenue_swap_purchase`/`revenue_swap_sale` conservées pour compatibilité des parties déjà en cours).
`FEATURE_LIST` : libellé de `revenueSwap` mis à jour au vocabulaire ABS (clé de fonctionnalité inchangée).
Côté interface (Mon Entreprise) : modale de publication réécrite (cases à cocher avec part de propriété
affichée, % cédé borné, durée, montant recherché, aperçu des 5 chiffres en direct) ; nouvelle modale de
souscription par tranche (`modalSubscribeRevenueSwapTranche`) ; tables « Marché des annonces » et « ABS
actifs » réécrites (montants et prime par tranche, totaux de souscription, détail des porteurs par tranche
pour un deal résolu). Côté Portefeuille (joueur) : nouveau bandeau de souscription (`absListingLines`,
mêmes conventions que le bandeau d'offres de prêt de la section 157bis — « c'est une action du JOUEUR, pas
de sa compagnie »), bindings `[data-submit-abs-sub]`/`[data-cancel-abs-sub]`. Entrée de Lexique « Vente de
revenu (swap de revenu fixe/variable) » réécrite en « Vente de revenu (ABS — titre adossé à des actifs) » ;
entrée « Prêt » complétée avec la mention du plafond cumulatif.

### Tests

Ancien `smoke_test_step274_revenue_swap.js` supprimé (API remplacée). Nouveau fichier dédié
`smoke_test_step275_abs.js` (48 assertions) : plafond cumulatif de retenue de prêt à l'émission ; part
cessible plafonnée (calculée sur le réglage, pas sur les prêts en cours) ; publication gardée par
`tradingWindowOpen()` avec reprise des validations existantes ; partage égal plafonné
(`levelAbsSubscriptions`, 3 scénarios isolés) ; exclusion CEO/entreprise émettrice et condition d'existence
senior (annulation complète sans souscripteur senior) ; résolution réussie multi-porteur
compagnie+joueur avec rétention junior par l'émetteur ; versement de loyer avec waterfall senior→junior et
split retenu/cédé (vérifié y compris l'interaction avec un prêt actif de l'émetteur sur la part RETENUE —
retenue de prêt et cession ABS sont des mécanismes indépendants et cumulables, agissant chacun sur une part
différente) ; garde-fous inchangés (hypothèque, vente via la modale réelle, nouveau swap de loyers) et
actions explicitement permises (fusion de lot, construction) sur un terrain verrouillé ; expiration
non-recours en fin de durée avec déverrouillage. Deux régressions pré-existantes identifiées et corrigées
— conséquence directe et attendue du durcissement du plafond de retenue (point 1), pas des bugs de
l'implémentation : `smoke_test_step176_playtest_fixes.js` (un `withholdingPct` de test à 0.5, incident au
test réel, abaissé à 0.35, désormais sous le plafond cumulatif) et
`smoke_test_step70_section157_bonds_and_loan_market.js` section (K) (le test exerçait explicitement
l'ancien empilement au-delà de 100% — 50%+40%+30% — que la demande de l'utilisateur identifie comme le bug
à corriger ; entièrement réécrit avec des pourcentages qui totalisent exactement 40%, en conservant la
même structure de test : prêts cascadés multiples, plafond de principal indépendant du plafond de retenue,
remboursement intégral et retrait des prêts actifs). `node -c script_extracted.js` : SYNTAX OK à chaque
édition. Suite complète (193 scripts) relancée à 3 reprises consécutives après correction des deux
régressions : **0 échec** à chaque fois.

## 276. Trois ajustements esthétiques après la livraison de l'ABS (section 275) + badge coloré pour le bandeau de préparation

Demande explicite de l'utilisateur, verbatim : « Les ajustements suivants sont esthétiques seulement :
1) Libellé "Vente de revenu" changé pour "Vente de revenu (ABS)" 2) Changer l'affichage du ABS soumis en
proposition pour l'onglet portefeuille, faire comme dans l'onglet mon entreprise 3) Dans l'action Annoncer
un dividende : changer [le long paragraphe] par "Dès l'annonce, le montant total est bloqué et retiré de la
trésorerie. Le versement intervient le semestre suivant au prorata des actions détenues ce jour-là." »
Puis, en cours de session, une quatrième demande arrivée séparément : « La barre en haut qui montre qu'elle
joueur est prêt. C'est parfait, mais mettre les crochet et "x" plus esthétique un crochet blanc dans une
case vert, un X blanc dans une case rouge. »

### 1. Libellé du bouton

`💱 Vente de revenu` → `💱 Vente de revenu (ABS)` (`proposeRevenueSwapButtonHtml`, menu ☰ Actions, Mon
Entreprise) — seul ce libellé de bouton change ; le vocabulaire interne (`state.revenueSwaps`/
`postRevenueSwapListing`/`features.revenueSwap`) et l'entrée de Lexique (déjà « Vente de revenu (ABS —
titre adossé à des actifs) » depuis la section 275) restent inchangés.

### 2. Affichage du marché ABS dans le Portefeuille, aligné sur Mon Entreprise

Avant cette section, le Portefeuille affichait chaque émission ABS ouverte comme une ligne compacte du
bandeau d'annonces (même bandeau que les dividendes/annonces CEO/demandes d'emprunt), avec DEUX
mini-formulaires inline (montant max senior/junior + boutons Souscrire/Retirer) — voir `absListingLines`,
section 275. Remplacé par le MÊME tableau « Marché des émissions ABS » que Mon Entreprise
(`revenueSwapListingsMarketHtml`) : mêmes colonnes (Émettrice, Terrain(s), % cédé, Durée, Senior
recherché/prime, Junior recherché, Souscriptions), sorti du bandeau compact pour devenir un bloc dédié
(`absPortefeuilleMarketHtml`), affiché juste après le bandeau dividendes/CEO/prêts. Seule différence avec
la version Mon Entreprise : le bouton « Souscrire » porte `data-subscribe-revenue-listing-player` (au lieu
de `data-subscribe-revenue-listing`) et ouvre `modalSubscribeRevenueSwapTranche` avec `subscriberType:
'player'`/`myPlayerId` plutôt que la compagnie de l'acteur courant — même raisonnement que le marché de
prêts (section 157bis : « c'est une action du JOUEUR, pas de sa compagnie »).

Conséquence : la modale de souscription perd son unique point d'entrée dédié au retrait (l'ancien bouton
« Retirer » inline du bandeau Portefeuille). Pour ne pas perdre cette capacité, un bouton « Retirer ma
souscription » a été ajouté DANS la modale elle-même (`modalSubscribeRevenueSwapTranche`, visible
uniquement si une souscription existe déjà pour ce souscripteur/cette tranche), appelant
`cancelRevenueSwapSubscription` — cette modale étant déjà partagée entre Mon Entreprise et le Portefeuille,
les deux bénéficient désormais du retrait, alors que seul le Portefeuille l'offrait avant.

### 3. Texte de la modale « Annoncer un dividende »

Le long paragraphe explicatif (immobilisation immédiate, versement au prorata au semestre suivant, effet
d'une revente/rachat de parts entre-temps, importance de la régularité, choc baissier si le dividende
dépasse ou ignore un bénéfice négatif) est remplacé par une seule phrase : « Dès l'annonce, le montant
total est bloqué et retiré de la trésorerie. Le versement intervient le semestre suivant au prorata des
actions détenues ce jour-là. » Ajustement strictement cosmétique — aucun changement de comportement,
uniquement le texte affiché dans `modalAnnounceDividend`.

### 4. Badge coloré pour le bandeau de préparation (✓/✗)

Le bandeau « qui est prêt » de l'en-tête (section 270, `readinessRowHtml`) affichait un glyphe ✓/✗ nu à
côté du nom du CEO. Remplacé par un petit badge carré coloré : crochet blanc sur fond vert (`#047857`,
même couleur que le P&L positif/la cote investment grade ailleurs dans l'app) quand `co.ready`, X blanc
sur fond brique/rouge (`var(--brick)`, même couleur que les pertes/la cote spéculative) sinon — purement
visuel, la logique dérivée de `state` reste identique.

### Fichiers/fonctions touchés

`proposeRevenueSwapButtonHtml` (libellé). `renderPortefeuilleTrading` : `absListingLines` retiré,
remplacé par `absPortefeuilleListings`/`absPortefeuilleMarketHtml` (tableau), sorti de
`announcementBannerHtml`. Bindings : `[data-submit-abs-sub]`/`[data-cancel-abs-sub]` retirés, remplacés
par `[data-subscribe-revenue-listing-player]` (ouvre la modale, même esprit que
`[data-subscribe-revenue-listing]` de Mon Entreprise). `modalSubscribeRevenueSwapTranche` : nouveau bouton
« Retirer ma souscription » conditionnel. `modalAnnounceDividend` : texte raccourci. `readinessRowHtml` :
badge carré coloré au lieu du glyphe nu.

### Tests

Nouveau fichier dédié `smoke_test_step276_abs_ui_polish.js` : libellé du bouton, tableau ABS du
Portefeuille (mêmes en-têtes que Mon Entreprise, bouton `data-subscribe-revenue-listing-player`, anciens
champs inline disparus), bouton « Retirer ma souscription » (apparaît seulement si une souscription
existe déjà, retire effectivement la souscription), texte de la modale dividende, non-régression du
tableau ABS de Mon Entreprise (souscription compagnie inchangée). `smoke_test_step267_last_action_status.js`
mis à jour (régression attendue : les regex `/✓\s*CeoA/` dépendaient de l'ancien glyphe nu directement
suivi du nom — élargies pour tolérer le balisage du nouveau badge, plus deux nouvelles assertions sur les
couleurs de fond). `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (194
scripts, nouveau test inclus) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3
sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les 2 cas).


## 277. Deux correctifs de fond sur l'ABS (section 275) : la retenue de prêt se prélève désormais AVANT la titrisation, et une division erronée retirée de la tarification

Immédiatement après la livraison des sections 275/276, rapport de bug détaillé de l'utilisateur, verbatim :
« **1. La retenue de prêt doit se prélever AVANT la titrisation.** Le plafond de cession — au plus 60 % de
la part du vendeur, pour réserver les 40 % que peut retenir un prêteur — est arithmétiquement exact : les
deux créances tiennent côte à côte dans les 100 % sans se chevaucher. Mais le règlement du loyer applique
la titrisation avant la retenue de prêt, et le prêteur ne prélève alors ses 40 % que sur la portion
RETENUE par le vendeur, pas sur sa part pleine. **Mesure sur un cas réel.** Vert 1, l'émettrice en détient
40 %, elle a un prêt à 40 % de retenue et une titrisation qui cède le maximum de 60 %. Sa part du loyer est
de 104 000 $. Ce que le plafond réservé prévoit : 41 600 $ au prêteur, 62 400 $ aux porteurs, 0 $ au
vendeur. Ce qui se passe réellement : 16 640 $ au prêteur, 62 400 $ aux porteurs, 24 960 $ au vendeur. Le
prêteur perd 60 % de sa retenue — exactement le pourcentage cédé — et l'argent manquant reste dans la
trésorerie de l'emprunteur. Une entreprise endettée qui titrise se paie donc avec l'argent de son prêteur.
L'invariant monétaire reste parfait : ce n'est pas une fuite, c'est une mauvaise répartition. **Le
correctif.** Dans le règlement du loyer, inverser les deux opérations : prélever d'abord la retenue de
prêt sur la part PLEINE du propriétaire, puis verser aux porteurs de la titrisation le pourcentage cédé de
cette MÊME part pleine — jamais du reliquat. Les deux prélèvements tiennent alors exactement dans les
100 %, ce que le plafond de cession a été conçu pour garantir. Ce qui subsiste après les deux revient au
vendeur, et vaut zéro quand les deux sont au maximum. **Un second cas à traiter dans la foulée.** Le
plafond cumulatif de retenue exclut explicitement les prêts de dernier recours, qui retiennent 50 % des
loyers. Une entreprise ayant déjà un prêt normal à 40 % plus un prêt de dernier recours atteint 90 % de
retenue nominale, alors que la titrisation ne réserve que 40 %. La réserve est donc percée indépendamment
de l'inversion ci-dessus. Façon de régler : le prêt de dernier recours se sert en dernier, il prend donc
50 % de ce qui reste après toutes les déductions. **2. Retirer une division dans la formule d'espérance de
la tarification.** C'est le correctif qui décide si le produit est utilisable. La taille de la tranche
senior n'est pas choisie par l'émetteur : elle est calculée comme une capacité prudente, l'espérance du
flux moins un écart-type. L'idée est bonne. Mais l'espérance est sous-estimée, et la capacité tombe donc
presque toujours à zéro — ce qui donne une tranche senior nulle, donc aucun souscripteur senior possible,
donc une émission annulée d'office. **La cause.** La tarification estime le nombre de visites attendues
avec la probabilité de la case multipliée par le nombre de visiteurs DIVISÉ PAR le nombre total
d'entreprises. La convention utilisée partout ailleurs dans le fichier — notamment dans le calcul de la
valeur intrinsèque d'un terrain, que le commentaire de la fonction cite lui-même en référence — multiplie
par le nombre de visiteurs, sans diviser. Car les visiteurs sont les entreprises (double count). **Le
correctif.** Utiliser la même convention que la valeur intrinsèque : probabilité de la case multipliée par
le nombre de visiteurs, sans division par le total. Une seule opération à retirer. »

### Correctif 1 — ordre retenue de prêt / cession, et prêt de dernier recours servi en dernier

`applyLoanWithholding(companyId, grossAmount, opts)` gagne un 3e paramètre optionnel : `opts.onlyNormal`
traite uniquement les prêts non-dernier-recours, `opts.onlyLastResort` uniquement les prêts de dernier
recours ; sans `opts`, le comportement est inchangé mais l'ORDRE interne est désormais toujours normaux
d'abord, dernier recours ensuite — quel que soit l'ordre de création des prêts (avant ce correctif, un
prêt de dernier recours créé avant un prêt normal pouvait être servi en premier ; la demande de
l'utilisateur, « il prend donc 50 % de ce qui reste après toutes les déductions », impose l'ordre par
GROUPE, jamais par ancienneté). Dans `settlePropertyRent` et `settleNeutralPawnRent`, la branche ABS de la
boucle de répartition applique désormais la séquence en trois temps prescrite : (1) retenue des prêts
NORMAUX sur la part PLEINE du vendeur ; (2) cession du pourcentage titrisé de cette MÊME part pleine
(jamais du reliquat) ; (3) retenue du prêt de DERNIER RECOURS sur ce qui reste après (1) et (2). Les deux
prélèvements (1)+(3) et la cession (2) tiennent ainsi tous dans les 100 % de la part pleine, exactement
comme `absMaxCedablePct()` (= 1 − plafond de retenue normal) est conçu pour le garantir — le prêt de
dernier recours, hors de ce plafond par construction (section 274/segments `LAST_RESORT_LOAN_*`), vient se
servir sur le reliquat restant plutôt que de percer la réserve. Un nouveau drapeau `_precomputedByAbs` sur
le « cut » synthétique signale que sa retenue de prêt a déjà été appliquée EN VRAI (pour ne jamais la
recalculer, ce qui incrémenterait `loan.repaidSoFar` deux fois) : le bloc de compensation de loyer
(`rentCompensation`, guardé par la même convention que `_precomputedByCompensation`) et le mappage final
`cutResults` le respectent tous les deux.

### Correctif 2 — retrait de la division dans `computeAbsPricing`

`const q = p.prob * visitorCount;` remplace `const q = totalCompanies>0 ? p.prob * (visitorCount/totalCompanies) : 0;`
— même convention que `intrinsicValue()` (`rentPerTurn = p.prob * expectedRentValue(p) * opponents`, citée
en référence dans le commentaire de `computeAbsPricing` avant même ce correctif), qui ne divise jamais par
le nombre total d'entreprises. La division comptait les visiteurs deux fois (une fois via le produit par
`visitorCount`, une fois via la division par `totalCompanies`) et sous-estimait le loyer attendu d'un
facteur ~`totalCompanies`, ce qui faisait presque toujours tomber `seniorCapacity` à zéro.

### Calibrage — mesure, pas de changement de réglage

L'utilisateur a explicitement demandé de ne PAS deviner un nouveau calibrage (`ABS_SENIOR_CONFIDENCE_Z`,
actuellement 1.0 écart-type, et un éventuel montant minimal d'émission — inexistant aujourd'hui, seule la
garde `amountSought>0` existe) avant d'avoir des chiffres mesurés : « il vaut mieux les décider sur une
mesure que de tâtonner ». Mesure faite après ce correctif, sur le PANIER RÉEL du plateau (pas les valeurs
réduites des tests), part cédée au maximum (60 %), 4 entreprises actives (`visitorCount=3`) : un groupe
bas de gamme entièrement construit (Brun 1+2, 4 maisons chacun) sur 5 ans donne une capacité senior
`seniorCapacity` ≈ 4 M$ ; le groupe le plus cher du plateau entièrement construit (Bleu foncé 1+2, 4
maisons chacun) sur 5 ans donne ≈ 25 M$ — à comparer aux 14 M$ d'encaisse personnelle mentionnés par
l'utilisateur. Sur 1 an (`termRolls=6`), même le groupe le plus cher retombe à une capacité quasi nulle
(l'écart-type dépasse l'espérance sur un horizon aussi court). Conclusion : l'échelle n'est PAS
systématiquement « modeste » comme anticipé avant mesure — elle dépend fortement du panier et surtout de
la DURÉE (nulle à 1 an, significative dès 5 ans). `ABS_SENIOR_CONFIDENCE_Z` et un éventuel plancher
d'émission restent donc à décider avec l'utilisateur sur la base de ces chiffres, dans une session future
dédiée — aucun changement de réglage n'est fait ici.

### Fichiers/fonctions touchés

`applyLoanWithholding` (nouveau paramètre `opts`, réordonnancement normaux→dernier-recours).
`settlePropertyRent` : branche `revenueSwap` de la boucle `distributionCuts.forEach` (séquence en 3 temps),
bloc `rentCompensation` (respect de `_precomputedByAbs`), mappage final `cutResults` (idem).
`settleNeutralPawnRent` : même branche `revenueSwap` et même mappage `cutResults` (pas d'interaction avec
la compensation de loyer, les pions neutres n'y participant jamais). `computeAbsPricing` (retrait de la
division).

### Tests

`smoke_test_step189_last_resort_loan_withholding_merge.js` : scénario (C) mis à jour pour refléter le
nouvel ordre normaux→dernier-recours (le prêt normal créé APRÈS le prêt de dernier recours est
volontairement servi EN PREMIER, pour prouver que l'ordre est désormais par groupe, jamais par ancienneté
de création — 9 $ retenus par le normal, 10,5 $ par le dernier recours sur le reliquat, 19,5 $ au total sur
un brut de 30 $, au lieu de 15 $/4,5 $ avant ce correctif). `smoke_test_step275_abs.js` : le calcul de
retenue attendue de la section (F) corrigé pour appliquer la retenue à la part PLEINE (`expectedRentP2`)
plutôt qu'au reliquat post-cession ; le montant recherché de la section (F) relevé de 60 à 250 (la
capacité senior mesurée sur ce panier de test, ~189, est désormais intégralement couverte par un montant
de 60, ce qui aurait annulé la tranche junior et rendu caduque l'assertion dédiée à la rétention du solde
junior non souscrit — un montant supérieur à la capacité mesurée laisse un reliquat junior non trivial).
`node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (194 scripts) relancée à 3
reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 278. L'onglet Lexique est retiré et remplacé par un onglet Produits — matrice de référence des 31 produits financiers, 6 familles, filtres cumulables

Demande de l'utilisateur, initialement formulée comme la reprise d'un contenu existant : « Est-ce que tu
es en mesure d'aller voir dans le projet la conversation "Procédure PDF [...]" il y a une matrice
peux-tu ajouter l'équivalent dans un nouvel onglet ». Cette conversation n'étant pas accessible depuis la
session en cours (seuls les documents enregistrés du Projet le sont), l'utilisateur a choisi de coller
directement la spécification complète — intitulée « MATRICE DES PRODUITS FINANCIERS — MONOPOLY BOURSE » —
détaillant les 31 produits (nom, sous-titre, contrepartie, coût, durée, avantages, désavantages, points de
règle) répartis en 6 familles, un schéma de champs exact, et des recommandations d'implémentation
(disclosure natif `<details>/<summary>`, 3 filtres cumulables poche/fenêtre/bilan en état purement local,
non sauvegardé) et de design (couleur d'accent par famille, badges dette/fenêtre/cubes, empilement
responsive sous 760px). Instruction verbatim qui fixe la portée : « Je veux que un onglet qui fais à peu
près ça remplace le lexique ». Le texte collé plaçait pourtant lui-même ce nouvel onglet ENTRE REIT et
Lexique (coexistence), en contradiction directe avec « remplace le lexique » — contradiction signalée à
l'utilisateur via une question de clarification, qui a tranché explicitement : **« Le Lexique disparaît,
contenu perdu »** (aucune fusion du contenu existant du Lexique — qui documentait des mécaniques encore
actives comme les REIT, les cases hostiles, les assurances — ni dans le nouvel onglet, ni ailleurs). En
cours d'implémentation, latitude supplémentaire accordée explicitement : « Tu peux faire des ajustements
que tu trouve pertinent notamment les colonnes et informations » — les 4 colonnes toujours visibles
(nom, contrepartie, coût, durée) et le jeu de badges ont donc été choisis par jugement plutôt que copiés
mot pour mot depuis le texte collé, sans changer le fond (31 produits, 6 familles, le contenu textuel de
chaque produit).

### Contenu : `PRODUCT_FAMILY_DEFS` et `PRODUCTS_MATRIX`

Deux nouvelles constantes au niveau module, juste avant l'ancien emplacement de `renderLexique()` (retiré
entièrement — voir plus bas). `PRODUCT_FAMILY_DEFS` liste les 6 familles avec leur couleur d'accent,
suivant la convention déjà établie de consolidation de palette (section 232) : Flux de loyers (`#047857`,
vert — déjà utilisé pour les montants positifs), Dette (`var(--brick)`, rouge — déjà réservé aux pertes/
montants négatifs, cohérent avec la connotation d'une dette au bilan), Capitaux propres (`var(--gold)`,
doré), Marché — joueur (`var(--board)`, bleu), Assurance (`var(--metal)`, gris). Options et stratégies
utilise `#6D28D9` (violet) — une couleur jamais assignée jusqu'ici (mentionnée une fois dans un commentaire
historique sans être réellement utilisée), délibérément différente du violet déjà pris par un joueur
(`PLAYER_COLORS[4] = '#8E44AD'`) pour éviter toute confusion visuelle. `PRODUCTS_MATRIX` contient les 31
produits transcrits verbatim depuis la spécification collée (champs `f, nm, sub, poche, fen, dette, cubes,
contre, cout, duree, plus[], moins[], facts[]`), répartis 8/4/4/4/8/3 sur les 6 familles dans l'ordre ci-
dessus.

### Rendu : disclosure natif, filtres cumulables, état local non sauvegardé

`renderProduitsMatrice()` remplace `renderLexique()` à l'identique dans le routage (voir plus bas). Chaque
produit est une ligne `<details class="pm-row">` (pas de wrapper `entrepriseAccordion()` — celui-ci
persiste un état ouvert/fermé dans `entrepriseAccordionState`, alors que la spec demande explicitement
qu'aucune ligne ne reste ouverte après un nouveau rendu, et que l'ouverture/fermeture ne dépende d'aucun
JavaScript) : le `<summary>` affiche les 4 colonnes toujours visibles + les badges
(`produitsBadgesHtml()` : poche en contour, fenêtre libre=vert / semestre-année=bleu, dette=rouge si
`dette:true`, cubes=doré si `cubes:true`), le corps déplié affiche avantages/désavantages/points de règle
sur 3 colonnes (1 seule sous 760px). Chaque famille est un bloc `<div class="pm-family">` avec son en-tête
coloré et un compteur (`data-family-count`) mis à jour par le filtrage.

Les 3 groupes de filtres (poche/fenêtre/bilan) sont cumulables : `produitsFilterBarHtml()` rend un bouton
par valeur (`data-filter-group`/`data-filter-value`), `bindTabEvents(t==='matrice')` bascule
`PRODUITS_FILTER_STATE` (un `Set` par groupe) au clic et appelle `produitsApplyFilters()`, qui applique un
OU à l'intérieur d'un groupe et un ET entre les groupes directement sur les éléments déjà présents dans le
DOM (aucun second rendu, aucune sauvegarde) ; une famille devenue entièrement vide se masque à son tour, et
un compteur de résultats (`#pmResultsCount`) s'actualise. `let PRODUITS_FILTER_STATE = {...}` est déclaré
au niveau module, en dehors de `state`, suivant exactement le précédent de `entrepriseAccordionState`
(ligne 360) : redémarrer la partie ou recharger la page réinitialise les filtres, comme demandé (« état
purement local, non sauvegardé »).

### Piège de nommage évité : la clé `'produits'` et la fonction `renderProduits` sont des noms RETIRÉS et surveillés

`'produits'` était une clé d'onglet historique (avant la section 76, fusionnée dans `'assurances'` à cette
section, puis retirée entièrement à la section 93/113) que des tests de non-régression dédiés
(`smoke_test_merged_tab.js`, `smoke_test_step13_assurances_marches_to_entreprise.js`) interdisent
explicitement de voir réapparaître — y compris par une simple correspondance textuelle du nom de fonction
(`!/function renderProduits\s*\(/.test(scriptSrc)`), indépendamment de ce que ferait une éventuelle
nouvelle fonction de ce nom. La clé de routage du nouvel onglet est donc `'matrice'` (le libellé affiché
reste « Produits ») et la fonction de rendu est `renderProduitsMatrice()` — jamais `renderProduits`. Un
espace de noms complètement différent, et sans lien : l'accordéon « Produits financiers » DANS
`renderEntreprise()` (section 148, toujours actif, utilise la clé `'produits'` mais dans le registre séparé
`entrepriseAccordionState`, pas dans `visibleTabs()`) — non touché par ce changement.

### Fichiers/fonctions touchés

`script_extracted.js` : suppression complète de `renderLexique()` (et ses commentaires d'en-tête) ;
ajout de `PRODUCT_FAMILY_DEFS`, `PRODUCTS_MATRIX`, `PRODUITS_FILTER_STATE`, `produitsFenLabel`,
`produitsPocheLabel`, `produitsBadgesHtml`, `produitsRowHtml`, `produitsFamilyHtml`,
`produitsFilterBarHtml`, `produitsApplyFilters`, `renderProduitsMatrice`. `visibleTabs()` :
`tabs.push('lexique')` → `tabs.push('matrice')` (même position, mêmes conditions de visibilité — aucune,
pour tout le monde). `tabLabel()` : entrée `lexique:'Lexique'` → `matrice:'Produits'`. `renderTab()` :
`if(t==='lexique') return renderLexique();` → `if(t==='matrice') return renderProduitsMatrice();`.
`bindTabEvents()` : nouveau bloc `if(t==='matrice'){...}` qui branche les boutons de filtre et le bouton de
réinitialisation, et appelle `produitsApplyFilters()` une première fois au rendu.

### Tests

Neuf fichiers de smoke tests existants référençaient le Lexique et ont été mis à jour pour refléter sa
disparition (retrait chirurgical des seules variables/assertions liées au Lexique, jamais de « stub »
toujours-vrai — conforme à la convention déjà établie) :
`smoke_test_portefeuille_entreprise_tabs.js` (clé `'lexique'` → `'matrice'` dans l'assertion d'ordre des
onglets), `smoke_test_step13_assurances_marches_to_entreprise.js` (passe désormais sans modification, grâce
au renommage `renderProduits` → `renderProduitsMatrice`), `smoke_test_step15_entreprise_condense_lexique.js`
(retrait des points (d)/(e) sur le Lexique), `smoke_test_step171_ui_polish_batch.js` (retrait du point (3)
sur le texte d'intro du Lexique, mise à jour de l'ordre des onglets attendu au point (9)),
`smoke_test_step23_terminology_amf_subventions.js`, `smoke_test_step25_labels_and_cleanup.js`,
`smoke_test_step28_produits_financiers_hide_empty.js` (retrait chirurgical, sans toucher aux tests non
liés — toujours valides — de l'accordéon « Produits financiers » de `renderEntreprise()`),
`smoke_test_step34_remove_etf_and_hostile_hard_text.js` (retrait des points (c)/(d) sur la couverture
Lexique), `smoke_test_step39_icons_tps_tvq_and_company_cash_adjust.js` (retrait des 2 vérifications de
couverture Lexique du renommage « Taxe de luxe »). Nouveau fichier dédié
`smoke_test_step278_produits_matrice.js` : non-régression de la disparition du Lexique
(`renderLexique`/`'lexique'` absents), présence et routage du nouvel onglet (`'matrice'`, libellé
« Produits », `renderTab('matrice')` → `renderProduitsMatrice()`), effectifs exacts des 31 produits sur
les 6 familles, colonnes et badges toujours visibles, disclosure native sans JS, barre de filtres et état
local non persisté, logique de `produitsApplyFilters()` (OU intra-groupe, ET inter-groupes, masquage d'une
famille vide, compteur de résultats). `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite
complète (195 scripts désormais) relancée à 3 reprises consécutives : **0 échec** à chaque fois (un échec
isolé et non reproductible de `smoke_test_step261_portfolio_audit_fixes.js`, sans rapport avec ce
changement — aucune mention de Lexique/matrice/randomness dans ce fichier — s'est produit une seule fois
sur une série de 6 exécutions complètes et n'a pas persisté sur 5 exécutions individuelles suivantes ni sur
les 3 dernières exécutions complètes consécutives). `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`diff` vide dans les
2 cas).

## 279. Bandeau de fin de période, condensation des propositions en attente (Mon Entreprise + nouvelle section Portefeuille), onglet dédié « Devenir l'assureur », suivi des émissions ABS souscrites

Cinq demandes de l'utilisateur, envoyées dans le même message, séparées par des « ------ » (verbatim) :

1. Bandeau de fin de période : « Mettre une "bande" en dessous de l'endroit ou l'on voit les joueurs qui
   sont prêt ou non pour le tour et en haut des onglet. Faire en sorte que cette bande l'est visible qu'au
   semestre ou fin d'année et indiquer dans cette bande : FIN DE SEMESTRE / FIN D'ANNÉE FINANCIÈRE. Mettre
   la bande d'un couleur distinct pour chaque avec l'écriture en blanc. »
2. Condensation Mon Entreprise : « J'aimerais que les propositions en attente des entreprises on voit
   seulement par exemple : Swap de loyers - Julien Holdings Inc. [Détails] [Accepter] [Refuser] / Accord de
   compensation - Julien Holdings Inc. [Détails] [Accepter] [Refuser]. Le reste du texte [...] c'est de
   l'information dans les détail. Déplacer dans la même section les ABS pour souscrire : Les ABS (Ajouter un
   bouton refuser, pour faire disparaître le visuel) »
3. Nouvelle section Portefeuille : « Dans le même ordre d'idée, j'aimerais que pour l'onglet portefeuille tu
   fasses exactement la même chose que l'onglet entreprise et mettre dans le haut complètement une section
   "PROPOSITION EN ATTENTE" qui apparaît seulement quand il y a des propositions. [...] Les demandes
   d'emprunts : 🏦 Demande d'emprunt jul inc Inc. A- Qualité moyenne : 1.00 M$ (0 offres reçues) Tu garde
   identique tu enlèves "⏳ expire au prochain lancer de dés si non acceptée" (Ajouter un bouton refuser,
   pour faire disparaître le visuel). Les ABS (Ajouter un bouton refuser [...]). les demandes de parts
   privilégiées (Ajouter un bouton refuser [...]). Garder les mêmes standard de couleur de bouton (Détails,
   Accepter, Refuser, Proposer) partout dans l'application »
4. Nouvel onglet « Devenir l'assureur » : « Devenir assureur, ça fait beaucoup d'information à la même
   place. Faire un onglet dédié à devenir assureur et reprendre les contrats de la banque donc ne pas avoir
   cette information dans mon entreprise mais dans le nouvel onglet »
5. Suivi ABS souscrites : « Dans mon portefeuille ou dans produits financiers le cas échéant mettre les ABS
   qui sont actifs que tu as contracter avec l'information suivante, le coût ta tranche et le montant reçu à
   présent »

Deux clarifications obtenues ensuite (choix parmi options proposées), verbatim : « Masquage temporaire
(Recommandé) » et « Masquage uniquement pour la vue du joueur pas les autres bien sur » — confirmant que
les nouveaux boutons « Refuser » sur les marchés ouverts (demandes d'emprunt, ABS à souscrire) ne doivent
que masquer visuellement l'élément, temporairement (jamais mémorisé, redevient visible après un
rechargement), et que ce masquage doit être scopé à l'entreprise/au joueur actuellement sélectionné — le
sélecteur « Vous êtes » change `myPlayerId`/`myCoId` sans recharger la page, un masquage global aurait donc
fui d'une entreprise/d'un joueur à l'autre en changeant simplement de sélection.

### 1. Bandeau « FIN DE SEMESTRE » / « FIN D'ANNÉE FINANCIÈRE »

Dans `render()`, juste après `actionStatusRowHtml` (bandeau ✓/✗ de préparation par CEO) et avant
`<div class="tabs">` : `periodEndBannerHtml`, calculé à partir des fonctions déjà existantes
`yearEndWindowOpen()` et `semesterStartWindowOpen()` — une fin d'année est toujours aussi un début de
semestre, donc le bandeau « année » (doré, `FIN D'ANNÉE FINANCIÈRE`) a priorité sur le bandeau « semestre »
(bleu, `FIN DE SEMESTRE`) ; en dehors de ces deux frontières, aucun bandeau. Nouvelles règles CSS :
`.periodendbanner` (texte centré, gras, majuscules, blanc, coins arrondis), `.periodendbanner-semester`
(fond `var(--board)`, bleu), `.periodendbanner-year` (fond `var(--gold)`, doré) — jamais `var(--brick)`,
réservée aux pertes/montants négatifs (convention section 232).

### 2. Mon Entreprise — condensation des propositions + déplacement du marché ABS

Les lignes de swap/compensation entrantes (`offersHtml`) passent d'un texte long (montants, terrains,
plafonds, taux, frais) à une ligne compacte « 🔄 Swap de loyers — *Émetteur* » / « 🤝 Accord de compensation
— *Émetteur* » suivie de Détails/Accepter/Refuser (mêmes classes `btn-ghost`/`btn-primary`/`btn-brick`
déjà en place). Le swap réutilise `modalSwapOfferDetails` (déjà existante) ; nouvelle fonction
`modalCompOfferDetails(offerId)` (même structure) affiche le taux d'intérêt et les frais de signature
retirés de la ligne compacte, nouveau bouton `data-comp-offer-details`. Les annonces ABS à souscrire des
AUTRES entreprises (`revenueSwapListingsMarketHtml`, auparavant dans l'accordéon « Produits financiers »)
rejoignent la même section « Propositions en attente », chacune avec un nouveau bouton
`btn-brick btn-sm` « Refuser » (`data-dismiss-pending="abs:${l.id}"`) à côté du bouton Souscrire existant ;
ma propre annonce (bouton « Retirer ») reste inchangée dans l'accordéon « Produits financiers », puisqu'elle
n'attend aucune décision de ma part.

Masquage local scopé : nouvelle variable de module (jamais dans `state`, jamais sauvegardée, à l'image de
`PRODUITS_FILTER_STATE`/`entrepriseAccordionState`) :

```js
let DISMISSED_PENDING_IDS = {}; // { [scopeKey]: Set<itemKey> }
function isPendingDismissed(scopeKey, itemKey){ return !!(DISMISSED_PENDING_IDS[scopeKey] && DISMISSED_PENDING_IDS[scopeKey].has(itemKey)); }
function dismissPending(scopeKey, itemKey){ (DISMISSED_PENDING_IDS[scopeKey] = DISMISSED_PENDING_IDS[scopeKey]||new Set()).add(itemKey); }
```

`scopeKey` = `myCoId` dans Mon Entreprise, `myPlayerId` dans Portefeuille — jamais une clé globale, pour ne
pas fuiter d'une entreprise/d'un joueur à l'autre au simple changement de sélection « Vous êtes ». Les
listes filtrées excluent tout `itemKey` déjà présent dans `DISMISSED_PENDING_IDS[scopeKey]` avant de
calculer la visibilité de la section. `bindTabEvents` câble `[data-dismiss-pending]` sur
`dismissPending(scopeKey, ...)` puis `render()`.

### 3. Portefeuille — nouvelle section « PROPOSITIONS EN ATTENTE »

Nouvelle section groupée tout en haut de `renderPortefeuille()` (avant `announcementBannerHtml`, qui reste
inchangé — dividendes/CEO/sorties publiques sont de pures notifications, pas des propositions), masquée
dans son ensemble si les trois blocs suivants sont vides :

- Demandes d'emprunt (`loanRequestLines`) : texte gardé identique, retrait du texte d'expiration
  (« ⏳ expire au prochain lancer de dés si non acceptée ») et ajout d'un bouton `btn-brick btn-sm`
  « Refuser » (`data-dismiss-pending="loanreq:${r.id}"`), filtré par `isPendingDismissed(myPlayerId, ...)`.
- ABS à souscrire (`absPortefeuilleMarketHtml`) : même traitement que côté Mon Entreprise, scopé à
  `myPlayerId`.
- Demandes de parts privilégiées (`myPendingPreferredOffers`) : le mécanisme Accepter/Refuser existait déjà
  (`respondToPreferredIssuance`, qui enregistre `issuance.responses[playerId]`) — aucun nouveau mécanisme de
  masquage requis ; le filtre gagne simplement `&& i.responses[me.id]===undefined`, si bien qu'une offre
  répondue (acceptée OU refusée) disparaît d'elle-même de la vue « en attente ». Déplacée de l'accordéon
  « Instruments de trading » vers la nouvelle section ; les 3 autres sous-blocs (parts détenues, marché
  secondaire, mes annonces) restent inchangés dans l'accordéon.

### 4. Nouvel onglet « Devenir l'assureur »

Extraction pure (aucune logique changée) de `becomeInsurerHtml` et ses dépendances directes
(`bankInsuredProps`, `bankTaxInsurances`, `bankSubInsuredProps`, `liveTakeoverPropRow`,
`liveTakeoverTaxRow`, `liveTakeoverSubRow`) depuis `renderEntreprise()` vers une nouvelle fonction dédiée
`renderDevenirAssureur()` (son propre `const company = myCompany();`). Retrait de `${becomeInsurerHtml}` de
l'accordéon « Produits financiers » ; `produitsFinanciersEmpty` ne dépend plus de `becomeInsurerEmpty`, qui
a migré avec le reste. Câblage identique au schéma déjà établi pour les autres onglets : `visibleTabs()`
pousse `'assureur'` juste après `'entreprise'` (uniquement si `myCompany()`), `tabLabel()` ajoute
`assureur:'Devenir l\'assureur'`, `renderTab()` route vers `renderDevenirAssureur()`, `bindTabEvents()`
déplace les écouteurs `data-takeover-live-prop`/`-tax`/`-sub` dans un nouveau bloc `if(t==='assureur')`.

### 5. « Mes émissions ABS souscrites » (coût / tranche / reçu à ce jour)

Nouveau champ `receivedSoFar` par porteur (senior et junior, y compris le porteur synthétique de rétention
du risque), initialisé à 0 dans `resolveRevenueSwapListing()` au moment de la création du deal, et
incrémenté (jamais écrasé) dans `creditAbsHolder(holder, amount, entries, deal, trancheLabel)` à chaque
versement (`holder.receivedSoFar = (holder.receivedSoFar||0) + amount;`), pour les deux branches
(compagnie et joueur) — l'ancien `pl.cumAbsIncomeReceived` restait agrégé sur toutes les émissions
confondues et n'existait que pour les joueurs, insuffisant pour un suivi PAR émission ET pour une
compagnie. `migrateState()` initialise `receivedSoFar` à 0 sur les holders déjà présents dans une partie en
cours.

Nouvelle fonction utilitaire `myAbsHoldings(holderType, holderId)`, qui parcourt `state.revenueSwaps` et
retourne, pour chaque deal où `holderType`/`holderId` apparaît comme porteur senior ou junior : émettrice,
tranche, coût (`h.amount`), reçu à ce jour (`h.receivedSoFar||0`), années restantes. Rendu :
`renderEntreprise()` (accordéon « Produits financiers », après `revenueSwapsActiveHtml`) affiche
`myAbsHoldings('company', myCoId)` ; `renderPortefeuilleTrading()` (accordéon « Instruments de trading »)
affiche `myAbsHoldings('player', me.id)`, avec `showAbs = myAbsHoldingsList.length>0` ajouté à la condition
de visibilité de l'accordéon. Les deux tables sont masquées si vides, même convention que le reste de
l'accordéon.

### Fichiers/fonctions touchés

`script_extracted.js` : `render()` (`periodEndBannerHtml`), nouvelles règles CSS `.periodendbanner*` dans
`index.html` ; `offersHtml` de `renderEntreprise()` (lignes condensées swap/compensation, déplacement du
marché ABS des tiers, retrait de `becomeInsurerHtml`) ; nouvelle `modalCompOfferDetails()` ; nouvelle
`renderDevenirAssureur()` ; `visibleTabs()`/`tabLabel()`/`renderTab()`/`bindTabEvents()` (nouvel onglet
`'assureur'`) ; nouvelles `DISMISSED_PENDING_IDS`/`isPendingDismissed()`/`dismissPending()` (variables de
module, jamais dans `state`) ; `loanRequestLines` et `absPortefeuilleMarketHtml`/`myPendingPreferredOffers`
de `renderPortefeuille()` (nouvelle section « PROPOSITIONS EN ATTENTE ») ; `creditAbsHolder()`,
`resolveRevenueSwapListing()`, `migrateState()` (`receivedSoFar`) ; nouvelle `myAbsHoldings()` ; ajout du
tableau « Mes émissions ABS souscrites » dans `renderEntreprise()` et `renderPortefeuilleTrading()`.

### Tests

Huit fichiers de smoke tests existants référençaient du texte/positionnement retiré ou déplacé par ces
changements et ont été mis à jour chirurgicalement (jamais de stub toujours-vrai) :
`smoke_test_step28_produits_financiers_hide_empty.js` (nouvel helper `renderAssureurFor(playerId)` ;
remplacement des assertions de position de « Devenir l'assureur » DANS l'accordéon par des assertions sur
son propre onglet — `becomeInsurerEmptyStateInOwnTab`, `becomeInsurerNeverInEntreprise`,
`becomeInsurerInOwnTab`, `becomeInsurerShowsBankSubContract`), `smoke_test_step24_devenir_assureur_maisons_suivi.js`
et `smoke_test_step36_devenir_assureur_live_pricing.js` (rendus basculés de `renderTab('entreprise')` vers
`renderTab('assureur')` pour les vérifications propres à « Devenir l'assureur », en conservant
`renderTab('entreprise')` là où le test vérifie autre chose comme le Marché des contrats),
`smoke_test_step25_labels_and_cleanup.js` (même bascule pour la vérification du titre de section),
`smoke_test_step171_ui_polish_batch.js` (ordre des onglets attendu :
`['portefeuille','entreprise','assureur','etf','admin','matrice']`), `smoke_test_step237_preferred_shares.js`
(une offre déjà répondue par un joueur n'apparaît plus dans sa propre vue « en attente », vérifié
séparément d'une offre encore ouverte), `smoke_test_step265_loan_request_semester_expiry.js` (assertion
renommée `bannerNoLongerHasExpiryReminderText`, vérifie l'ABSENCE du texte d'expiration plutôt que sa
présence, + nouvelle assertion sur le bouton `data-dismiss-pending`), `smoke_test_step276_abs_ui_polish.js`
(la ligne condensée `📄 Émission ABS —` remplace l'ancien texte « Marché des émissions ABS » pour les
tiers).

Nouveau fichier dédié `smoke_test_step279_five_refinements.js` (44 assertions) couvrant les 5 points dans
l'ordre, plus la non-fuite et la non-persistance de `DISMISSED_PENDING_IDS` : bandeau conditionnel
semestre/année (absence en milieu de semestre, bonne classe/couleur/texte à chaque frontière, jamais les
deux bandeaux en même temps, position exacte dans le DOM entre le bandeau de préparation et les onglets) ;
lignes condensées swap/compensation + `modalCompOfferDetails` ; marché ABS déplacé avec Refuser et
non-fuite entre deux entreprises (Mathieu masque, Adrian voit toujours) ; demandes d'emprunt sans texte
d'expiration + Refuser + non-fuite entre deux joueurs (Julien masque, Mathieu voit toujours) ; offre de
parts privilégiées qui disparaît d'elle-même une fois répondue ; nouvel onglet `'assureur'` positionné
juste après `'entreprise'`, jamais dupliqué, jamais de contenu « Devenir l'assureur » dans
`renderTab('entreprise')` ; `receivedSoFar` réel sur un scénario de résolution ABS complet (initialisation à
0, accumulation correcte sur 2 versements successifs pour la senior ET la junior, jamais écrasé, plafond
senior respecté puis débordement vers la junior), `myAbsHoldings()` exact pour un porteur compagnie et un
porteur joueur, vide pour une compagnie émettrice qui ne détient aucune tranche de sa propre émission,
affichage correct dans Mon Entreprise ET Portefeuille, table masquée quand vide ; enfin,
`DISMISSED_PENDING_IDS` absent de `state` (ni comme clé, ni dans `JSON.stringify(state)`), confirmé comme
variable de module. `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (196 scripts
désormais) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py`
exécuté ; `index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum`
identique dans les 2 cas).

## 280. Sept textes explicatifs condensés (annonce CEO, emprunt, parts privilégiées, swap de loyers, swap général, compensation de loyer, émission ABS)

Demande explicite de l'utilisateur : remplacer plusieurs textes explicatifs longs de l'application par des
versions plus courtes, fournies verbatim en paires « texte actuel → texte de remplacement » pour sept
modales. Toutes les valeurs dynamiques (pourcentages, montants, plafonds calculés) sont restées de VRAIES
interpolations — jamais des nombres figés en dur — même quand le texte fourni par l'utilisateur montrait un
exemple chiffré (ex. « 15% », « 30 000 parts », « 87,56 $/part » ne sont que le rendu du moment où
l'utilisateur a copié le texte affiché, pas des constantes).

1. **Annonce CEO** (`modalAnnounceCeoTrade`) : les deux paragraphes (explication du mécanisme différé +
   note sur le plafond légal de vente) fusionnés en un seul, et le détail « déjà vendu cette année
   financière » retiré (purement indicatif — le blocage réel reste vérifié à l'exécution par
   `executeCeoAnnouncement`, jamais affecté par ce changement de texte, voir section 207). Les variables
   locales `ceoCapYear`/`ceoCapAlreadySold`, devenues inutilisées, sont retirées ; `ceoCapTotal` reste
   utilisé pour le nombre maximal de parts vendables affiché.
2. **Demande d'emprunt** (`modalIssueLoanRequest`) : le paragraphe d'explication condensé, séparé de la
   ligne « Capacité d'emprunt restante » (reformulée, mêmes valeurs `${fmt(capLeft)}`/
   `${fmt(state.settings.loanMaxPrincipal)}`). Le badge de cote de crédit (`creditRatingBadgeHtml`, ex.
   « A- Qualité moyenne »), composant partagé réutilisé aussi pour les assurances, n'a pas été modifié —
   seul le paragraphe qui le suit a changé.
3. **Émission de parts privilégiées** (`modalIssuePreferredShares`) : le paragraphe unique éclaté en deux
   (mécanisme de l'offre, puis fenêtre de réponse/répartition), et la ligne de prix reformulée (« Marge
   cumulative restante » → « Marge restante », mêmes valeurs `${fmt(remaining)}`/
   `${fmt(state.settings.preferredMaxPrincipal||0)}`).
4. **Swap de loyers ordinaire** (`modalProposeRentSwap`) : le long paragraphe unique éclaté en deux
   (mécanique de redirection, puis plafond/asymétrie/« Swap général »), texte condensé sans perte
   d'information fonctionnelle.
5. **Swap général** (portefeuille complet, même modale) : paragraphe condensé en deux, même traitement.
6. **Accord de compensation de loyer** (`modalProposeCompensation` — PAS `modalCompOfferDetails`, la modale
   « Détails » plus courte ajoutée en section 279 qui n'affichait déjà pas ce texte long) : paragraphe
   éclaté en deux (mécanique de netting, puis règlement de fin d'année + frais de renouvellement), même
   interpolation `${fmt(state.settings.rentCompensationFee)}`.
7. **Émission ABS** (`modalPostRevenueSwapListing`) : paragraphe unique éclaté en deux (sélection/calcul
   automatique des tranches, puis résolution automatique/restrictions pendant la durée du contrat).

### Fichiers/fonctions touchés

`script_extracted.js` : `modalAnnounceCeoTrade`, `modalIssueLoanRequest`, `modalIssuePreferredShares`,
`modalProposeRentSwap` (les deux textes, swap ordinaire et swap général), `modalProposeCompensation`,
`modalPostRevenueSwapListing` — uniquement les chaînes de texte affichées (aucune logique métier changée,
aucune signature de fonction modifiée).

### Tests

Aucun texte long modifié n'était référencé par les smoke tests existants, à une exception près :
`smoke_test_step207_ceo_sell_annual_cap.js` (Groupe J) vérifiait la présence du nombre de parts déjà
vendues cette année financière dans le HTML de `modalAnnounceCeoTrade` — ce détail ayant été
intentionnellement retiré du texte condensé (point 1 ci-dessus), l'assertion correspondante a été retirée
(jamais transformée en stub toujours-vrai) ; les assertions sur le pourcentage du plafond, le nombre
maximal de parts vendables et la mention « vente » restent inchangées et passent toujours. `node -c
script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (196 scripts) relancée à 3 reprises
consécutives : **0 échec** à chaque fois (un échec isolé et non reproductible de
`smoke_test_step261_portfolio_audit_fixes.js` observé sur une série intermédiaire, sans rapport avec ce
changement — aucune mention des textes modifiés dans ce fichier — confirmé non reproductible sur 5
exécutions individuelles consécutives, puis absent des 3 dernières exécutions complètes consécutives,
même schéma déjà documenté en section 278). `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique
dans les 2 cas).

## 281. Quatre correctifs UI dans « Propositions en attente » (étiquette parts privilégiées, retour à la ligne emprunt, texte condensé swap sortant, format ABS unifié) + explication de la tarification senior/junior ABS

Cinq remarques de l'utilisateur après usage de l'application, dans le même message :

1. « Dans portefeuille, une émissions d'action privilégié en attente de réponse c'est pas clairement
   indiqué qu'on parle d'action privilégié. »
2. « Pour les obligations à proposer dans portefeuille c'est bien par contre, après la cote de crédit
   faire un retour à la ligne pour plus de clarté. »
3. Capture d'écran de la modale d'émission ABS, avec la question : « pourquoi montant recherché est
   différent entre senior et junior explique moi. »
4. « dans proposition en attente quand c'est toi qui le fait et attend des nouvelles réduire le texte à
   Swap de loyers proposé à XXXX - En attente de réponse. »
5. « Pour les ABS tu n'as pas le même format pour répondre à une demande dans l'onglet Mon entreprise et
   dans portefeuille. Visuellement j'aime mieux celle de mon entreprise mettre les 2 semblable. »

### 1. Portefeuille — étiquette claire pour une émission de parts privilégiées en attente

Le tableau des offres de parts privilégiées en attente (dans la section « Propositions en attente »,
`renderPortefeuille()`) n'avait aucun en-tête le distinguant des demandes d'emprunt/ABS juste au-dessus.
Nouvelle étiquette « 📈 Émission(s) de parts privilégiées » (même style que l'ancienne étiquette « Marché
des émissions ABS », voir point 5 ci-dessous) insérée juste avant le tableau.

### 2. Portefeuille — retour à la ligne après la cote de crédit sur une demande d'emprunt

Dans `loanRequestLines`, un `<br>` est inséré juste après le badge de cote de crédit
(`creditRatingBadgeHtml`) et avant le montant demandé/nombre d'offres/formulaire — qui passent donc sur
une 2e ligne, comme demandé.

### 3. Explication : pourquoi le « Montant recherché » diffère entre senior et junior dans l'émission ABS

Pas un bug, aucun changement de code pour ce point — explication de la logique déjà en place
(`computeAbsPricing`/`computeAbsTranches`) : le montant total recherché par l'émetteur est d'abord affecté
à la tranche SENIOR, mais seulement jusqu'à `seniorCapacity` = espérance du loyer cédé sur la durée du
contrat **moins** 1 écart-type (`ABS_SENIOR_CONFIDENCE_Z = 1.0`) — une estimation PRUDENTE du loyer qui
sera réellement encaissé, avec environ 84% de confiance (approximation gaussienne) que ce montant suffira à
couvrir la tranche senior. Le reliquat du montant recherché (au-delà de cette capacité prudente) tombe
automatiquement dans la tranche JUNIOR, qui n'a pas de plafond mais n'est remboursée qu'après la senior.
Avec un panier restreint (parfois un seul terrain) et une durée courte (parfois 1 an, soit seulement 6
lancers de dés), l'écart-type du loyer attendu peut dépasser sa moyenne (grande incertitude relative) — la
capacité senior, moyenne moins écart-type, tombe alors à 0, et 100% du montant recherché est mécaniquement
affecté à la junior, exactement le cas montré dans la capture d'écran fournie (loyer attendu 5 K$ ± 12 K$ :
5 000 − 1×12 000 = négatif, plafonné à 0).

### 4. Mon Entreprise — texte condensé pour un swap de loyers proposé (en attente de réponse)

Symétrique de la condensation déjà appliquée aux offres ENTRANTES en section 279 : le texte de la ligne
`outgoingSwapOffers` (montants cédés/obtenus, plafonds, budget cumulatif — calculés via
`swapAssetValueSummary`) est retiré et remplacé par « 🔄 Swap de loyers proposé à *partenaire* — en
attente de sa réponse. », identique en forme à la ligne de compensation déjà condensée
(`outgoingCompOffers`). Les montants restent consultables en entier via le bouton Détails (inchangé, même
`modalSwapOfferDetails` que côté entrant).

### 5. ABS — même format condensé dans Mon Entreprise ET Portefeuille

La section 276 avait aligné le marché ABS du Portefeuille sur Mon Entreprise (tableau complet
Émettrice/Terrain(s)/%/Durée/Senior/Junior/Souscriptions), mais Mon Entreprise est ENSUITE passée, en
section 279, à une ligne condensée (icône 📄 + span + boutons Souscrire/Refuser) sans que le Portefeuille
suive — les deux onglets avaient donc fini par diverger visuellement. `absPortefeuilleMarketHtml` reprend
désormais EXACTEMENT le même texte/format que la ligne `otherAbsListingsToShow` de Mon Entreprise (mêmes
classes `deed-actions`/`ownerchip`, même libellé) — seul l'attribut du bouton Souscrire change
(`data-subscribe-revenue-listing-player`, souscription par le JOUEUR, jamais sa compagnie). Le détail des
souscriptions déjà reçues par tranche, qui n'apparaissait déjà plus côté Mon Entreprise, disparaît donc
aussi côté Portefeuille.

### Fichiers/fonctions touchés

`script_extracted.js` : `renderPortefeuille()` (étiquette parts privilégiées, `<br>` dans
`loanRequestLines`, `absPortefeuilleMarketHtml` reconstruite en format condensé) ; `renderEntreprise()`
(`outgoingSwapOffers`, texte condensé). Aucun changement à `computeAbsPricing`/`computeAbsTranches` (point
3, purement explicatif).

### Tests

Deux fichiers de smoke tests existants référençaient l'ancien format et ont été mis à jour chirurgicalement
(jamais de stub toujours-vrai) : `smoke_test_step276_abs_ui_polish.js` (assertion (2) : vérifie désormais la
ligne condensée « 📄 Émission ABS — » et l'absence de l'ancien tableau, plutôt que les en-têtes
Émettrice/Senior/Junior) et `smoke_test_step177_swap_offer_amounts.js` (assertions (A)/(B) : vérifient
désormais le nouveau format condensé et l'ABSENCE des montants inline sur les lignes entrante ET sortante —
ces montants restent entièrement vérifiés dans la popup Détails, assertion (C), inchangée). Nouveau fichier
dédié `smoke_test_step281_pending_ux_polish.js` (16 assertions) : étiquette « 📈 Émission(s) de parts
privilégiées » positionnée avant son tableau ; `<br>` juste après le badge de cote de crédit sur une
demande d'emprunt, montant/formulaire bien sur la ligne suivante ; texte condensé du swap sortant
(présence du nouveau texte, absence de l'ancien texte verbeux, boutons Détails/Retirer toujours présents) ;
format ABS strictement identique (texte de la ligne, hors attribut de souscription) entre Mon Entreprise et
Portefeuille, ancien tableau absent, boutons Souscrire (compagnie/joueur) et Refuser tous présents. `node -c
script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (197 scripts désormais) relancée à 3
reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique
dans les 2 cas).

## 282. Correctif — bouton « 💱 Vente de revenu (ABS) » visible dans ☰ Actions même quand l'action est impossible

Remarque de l'utilisateur, verbatim : « Certain boutons sont encore visible même si c'est pas possible de
faire l'action regarde ça » — puis, en clarification, que le bouton concerné se trouve dans le menu ☰
Actions de Mon Entreprise.

### Investigation

Revue systématique de chaque bouton du menu ☰ Actions (`entActionsMenuHtml`, `renderEntreprise()`) contre
la garde d'ouverture RÉELLE de la modale qu'il déclenche — convention déjà établie aux sections 251/252 :
un bouton de ce menu doit être ABSENT (jamais grisé+info-bulle) dès que l'action qu'il ouvre ne mène nulle
part, en répliquant EXACTEMENT la (ou les) garde(s) de la modale correspondante. Tous les boutons
respectaient déjà cette convention à l'identique de leur modale, sauf un : `proposeRevenueSwapButtonHtml`
(« 💱 Vente de revenu (ABS) »), dont la condition d'affichage ne reprenait que 2 des 3 gardes bloquantes de
`modalProposeRevenueSwap()` :

- ✅ répliquée : aucune autre entreprise active à qui vendre (`otherActiveCompaniesExist`).
- ✅ répliquée : aucun terrain éligible (`revenueSwapSellableItems(company.id).length>0`).
- ❌ **manquante** : `if(!tradingWindowOpen()){ alert('Une émission ABS ne peut être publiée qu'à
  l'ouverture du marché (début de semestre).'); return; }` — une émission ABS, comme un prêt ou une
  émission de parts privilégiées (`issueLoanButtonHtml`/`issuePreferredButtonHtml`, mêmes règles), ne peut
  être PUBLIÉE qu'au début d'un semestre (voir la section 264 pour les demandes d'emprunt, même
  restriction).
- ❌ **manquante** : `if(!(maxCedablePct>0)){ alert('Aucune part cessible actuellement (le réglage de
  retenue de prêt maximal est à 0%).'); return; }` (`absMaxCedablePct()`) — si `loanOfferWithholdingPctMax`
  est réglé à 100% dans les paramètres, aucune part de loyer n'est cessible, quel que soit le terrain.

Résultat concret du bug : le bouton restait affiché et cliquable en dehors du début de semestre (la
majorité du temps de jeu), ou avec ce réglage à 100% — un clic ouvrait alors une simple alerte
« Une émission ABS ne peut être publiée... » au lieu du formulaire attendu, sans jamais planter, mais en
donnant l'illusion d'une action disponible qui ne l'était pas.

### Correctif

`proposeRevenueSwapButtonHtml` reprend désormais les 3 gardes de `modalProposeRevenueSwap()` À
L'IDENTIQUE :

```js
const proposeRevenueSwapButtonHtml = (f.revenueSwap && tradingWindowOpen() && absMaxCedablePct()>0
  && otherActiveCompaniesExist && revenueSwapSellableItems(company.id).length>0)
  ? `<button class="btn btn-ghost btn-sm" id="openProposeRevenueSwapBtn">💱 Vente de revenu (ABS)</button>`
  : '';
```

Le bouton disparaît désormais tout le temps où l'émission serait refusée par une alerte, et réapparaît de
lui-même dès l'ouverture du marché (début de semestre) — même comportement que les autres boutons du menu.
Les autres boutons du menu ☰ Actions ont été vérifiés un par un contre leur modale respective (voir
investigation ci-dessus) : aucun autre écart trouvé.

### Fichiers/fonctions touchés

`script_extracted.js` : `renderEntreprise()`, `proposeRevenueSwapButtonHtml` uniquement — aucune autre
fonction modifiée, aucune logique métier changée (le comportement de la modale elle-même,
`modalProposeRevenueSwap()`, était déjà correct — seule sa réplique en lecture seule au moment du rendu du
bouton était incomplète).

### Tests

`smoke_test_step276_abs_ui_polish.js` ouvre déjà le marché (`state.gameClock.rollCount = 3`, commentaire
« ouvre le marché (tradingWindowOpen) ») avant de vérifier la présence du bouton — aucune assertion
existante cassée par ce correctif, aucun fichier de test à mettre à jour. `node -c script_extracted.js` :
SYNTAX OK. Suite complète (197 scripts) relancée à 3 reprises consécutives : **0 échec** à chaque fois.
`python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique dans les 2 cas).

## 283. Quatre demandes UI — réorganisation « Produits financiers », logo d'entreprise (écran TV), cases à cocher condensées, textes allégés

Quatre demandes de l'utilisateur dans le même message (plus une confirmation), verbatim :

0. « Masquage uniquement pour la vue du joueur pas les autres bien sur » — confirmation (aucun changement
   de code) que `DISMISSED_PENDING_IDS` (sections 279/281) reste bien scopé à `myCoId`/`myPlayerId`, jamais
   une clé globale — déjà le cas, vérifié à nouveau à cette occasion.
1. « La section produit financier dans mon entreprise je la trouve messy c'est difficile de se retrouver
   quand plusieurs produits. Peux-tu arranger ça. Garde une seule section mais mieux arranger. »
2. « Possible aussi de mettre dans la fondation de l'entreprise un endroit pour uploaded une image 😀 et
   qu'elle apparaissent seulement dans la diffusion sur l'écran télé lors de la présentation » — puis, en
   clarification : « L'image c'est un logo en fait ».
3. « Aussi dans les paramètres de departs les case a cocher reduire le texte a seulement le nom du
   produit. »
4. « Regarde dans l'application ou tu as mis du texte pour mettre ca clair et concis. Il y a beaucoup de
   longueur et les gens ne lisent pas quand trop long. »

### 1. Mon Entreprise — « Produits financiers » regroupé en 4 groupes thématiques (une seule section)

Les 11 blocs plats de l'accordéon (assurée/assureur/sous-standard en vigueur/marché des contrats/swaps/
compensations/annonce ABS/ABS actives/ABS souscrites/prêts emprunté/prêts prêté), auparavant simplement
empilés à plat avec un `margin-top`, sont regroupés en 4 groupes VISUELS — même accordéon UNIQUE (demande
explicite: « Garde une seule section »), aucun tableau/logique retiré ou changé :

- 🛡️ **Assurances** — assurée/assureur/sous-standard en vigueur/marché des contrats.
- 🔄 **Swaps & compensations de loyer** — swaps actifs + accords de compensation actifs.
- 📄 **Émissions ABS** — mon annonce + émissions actives + mes émissions souscrites.
- 🏦 **Prêts** — emprunté + prêté.

Chaque groupe n'apparaît que s'il a du contenu (même convention « masqué si vide » que le reste de
l'accordéon) ; un séparateur `border-top` sépare deux groupes non-vides consécutifs, jamais posé avant le
premier groupe visible. `produitsAssuranceHtml`/`loansBorrowerHtml`/`loansLenderHtml` (nouvelles variables)
reprennent TEXTUELLEMENT le contenu qui vivait à plat dans le gabarit du `return` — aucun texte/attribut
changé, seule l'enveloppe change.

### 2. Logo d'entreprise à la fondation, visible uniquement sur l'écran spectateur (TV) lors de la présentation

Nouveau champ optionnel `#cLogo` (fichier image) dans `renderCompanySetupGate()` — converti en data URL
redimensionnée (`resizeImageFileToDataUrl`, 240px de plus grande dimension, pour ne pas gonfler `state`)
dès le choix du fichier, avec aperçu immédiat. Persisté sur `company.logoDataUrl` via un nouveau paramètre
de `createCompany()` (lazy-init à `null` pour une entreprise déjà fondée, voir `migrateState`).

**Un seul endroit dans toute l'application lit ce champ** : `tvSlideCompanyShowcase()` — la diapositive
« présentation d'entreprise » du mode spectateur (écran TV), déjà existante depuis la section 137
(`state.tvDisplay = {mode:'company', companyId}`, choisie par le créateur dans Administration). Le logo,
quand présent, s'affiche au-dessus du nom de l'entreprise ; absent (entreprise fondée avant cette
fonctionnalité, ou CEO n'ayant rien choisi), rien à sa place. Mon Entreprise, Portefeuille, et tout autre
écran ne l'affichent jamais — exactement la demande (« qu'elle apparaisse seulement dans la diffusion sur
l'écran télé lors de la présentation »).

### 3. Paramètres de départ — cases à cocher des fonctionnalités réduites au nom du produit

`FEATURE_LIST` (liste des fonctionnalités activables à la création d'une partie) gagne un champ `short`
(nom seul, ex. « Assurances », « Émission ABS », « Compensation de loyer ») affiché désormais À CÔTÉ de
chaque case à cocher dans `renderSetup()`, remplaçant l'ancien `label` complet (parfois une phrase entière
avec parenthèses). `label` (la description complète) n'est PAS retirée — reléguée en `title` (infobulle au
survol de la case), donc aucune information perdue, seulement déplacée hors de la vue par défaut — même
convention que `goAdvanceButtonHtml`/`issueLoanButtonHtml` (menu ☰ Actions) pour un détail non essentiel à
la lecture immédiate.

### 4. Textes allégés dans les fenêtres d'action les plus fréquentes

Revue des paragraphes explicatifs (`class="small"`) les plus longs de l'application, en excluant
délibérément : les popups « Détails » (section 279/281 — c'est justement là que vit le détail retiré des
lignes condensées), les écrans réservés au créateur de la partie (Administration — lus une fois, rarement),
et les guides de type d'entreprise (`COMPANY_TYPE_GUIDELINES`/`COMPANY_TYPE_GUIDELINE_UNIVERSAL` — lus une
seule fois, décision stratégique importante qui justifie la densité). Condensés (même information, aucun
fait/chiffre retiré, seulement la formulation) dans les fenêtres ouvertes fréquemment depuis le menu ☰
Actions : `modalProposeSwap`, `modalProposeCompensation`, `modalProposeRevenueSwap`,
`modalPublicCeoStatement`, `modalInsureBundle` (paragraphe d'introduction).

### Fichiers/fonctions touchés

`script_extracted.js` : `renderEntreprise()` (regroupement de l'accordéon « Produits financiers »),
`resizeImageFileToDataUrl` (nouvelle fonction utilitaire), `createCompany()`/`migrateState()`
(`logoDataUrl`), `renderCompanySetupGate()` (champ `#cLogo` + aperçu), `tvSlideCompanyShowcase()` (affichage
du logo), `FEATURE_LIST`/`renderSetup()` (`short`/`title`), et les 5 modales listées au point 4.

### Tests

Aucune assertion existante ne portait sur l'ordre à plat de l'accordéon « Produits financiers », sur le
texte long des `FEATURE_LIST`, ni sur le texte original des 5 modales condensées — aucun fichier de smoke
test à mettre à jour. `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète
(197 scripts) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py`
exécuté ; `index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum`
identique dans les 2 cas).

## 284. Cinq correctifs Mon Entreprise/Portefeuille — doublon « Marché des contrats » retiré, boutons « Annuler » masqués après un lancer, vérification du suivi ABS, fusion « MES POSITIONS », sous-section assureur

Cinq demandes reçues dans un même message (capture d'écran à l'appui pour le point 1), séparées par
`-------`. Citations verbatim :

« 1) Dans la capture d'écran ci joint tu vas voir dans mon entreprise que l'information est déboublé pour
l'assurance. On a juste besoin de voir tes polices d'assurances pas le marché des contrat qui se trouve
dans son onglet maintenant.
2) Aussi le bouton "Annuler" est présent même après les jet de dé avec un pop-up qui mentionne pas
possible, faudrait juste qu'il ne soit pas visible quand c'est pas possible
3) Aussi lorsqu'une titrisation (ABS) est accepter on ne le voit nul part. Il faut qu'il apparaisse tant
dans instruement de trading si c'est un joueur que produit financier si c'est une entreprise.
4) Je pense aussi que la section mes positions bourisère et instruments de trading devrait être une seule
section, "MES POSITIONS" avec des sous-section pour séparer clairement les type (options, actions, short,
privilégie, abs obligation) bien sur dans un ordre cohérant
5) Dans produit financier il faut aussi une sous section comme les autres pour les contrats donc tu es
l'assureur »

### 1. Doublon « Marché des contrats » retiré de Mon Entreprise

La capture d'écran montrait, dans le groupe « 🛡️ Assurances » de l'accordéon « Produits financiers »,
« Assurances — en tant qu'assurée » (Brun 2 / Banque / 7 K$, bouton « Annuler » fonctionnel) IMMÉDIATEMENT
suivie de « Marché des contrats — contrats actifs » listant EXACTEMENT le même contrat (Brun 2 / le nom de
la compagnie / Banque / 7 K$) — un pur doublon. Investigation : la table NORMALE du « Marché des contrats »
(`produitsContractRow`, alimentée par `activeContracts()`, TOUS les contrats de la partie peu importe qui
les a signés) avait sa dernière colonne (reprise) déjà VIDE depuis la section 116/148 — la reprise de
contrat groupé ENTIER a été retirée à cette époque, seule la reprise INDIVIDUELLE via l'onglet dédié
« Devenir l'assureur » (section 279) subsiste pour l'assurance normale. Cette table ne faisait donc plus
que RÉPÉTER, sans aucune action possible, les mêmes lignes déjà affichées dans « Assurances — en tant
qu'assurée/assureur » (qui, elles, ont un vrai bouton Annuler côté assurée) — visible même pour un TIERS
totalement étranger au contrat (`contracts = activeContracts()`, état de partie entier, non filtré par
implication).

La table NORMALE (`produitsContractRow` et son appel) est retirée entièrement. La table SOUS-STANDARD
(`produitsSubRow`), elle, porte une action RÉELLE et UNIQUE — la reprise entre pairs
(`data-takeover-subinsurance`/`canTakeOver`), absente de « Devenir l'assureur » (qui ne couvre que les
contrats tenus par la BANQUE) — conservée, mais renommée et isolée dans sa propre sous-section
« Reprise de contrats sous-standard (marché) » (voir point 5 pour la cohérence avec les autres produits).
`allProductsEmpty` perd son terme `contracts.length===0` (plus aucun contenu n'en dépendait après le
retrait de la table normale).

### 2. Boutons « Annuler » masqués une fois un lancer de dé effectué

Même classe de bug que la section 282 (bouton visible alors que l'action échouerait avec une alerte) :
`cancelContract()`/`cancelSubInsurance()` refusent tous deux (`ok:false`) dès que
`state.gameClock.rollCount !== signedAtRoll` (« au moins un lancer de dé a eu lieu depuis la signature »),
mais cette condition n'était jamais vérifiée au moment de RENDRE le bouton « Annuler (rembourse) » — 3
occurrences : `data-cancel-contract` (table « en tant qu'assurée », contrats normaux), `data-cancel-sub-
insurance` (même table, sous-standard) et `data-cancel-sub-insurance` (« Contrats sous-standard en
vigueur », `subInsuranceActiveListHtml`). Les 3 boutons sont désormais entourés d'une même vérification
`state.gameClock.rollCount === signedAtRoll` (via `c.signedAtRoll` — déjà porté par chaque contrat composite
depuis `activeContracts()` — ou `p.subInsurance.signedAtRoll`), reprenant EXACTEMENT la condition réelle des
fonctions d'annulation — même convention établie à la section 282 (un bouton absent plutôt que
désactivé+infobulle, jamais affiché quand l'action échouerait).

### 3. Suivi des émissions ABS souscrites — vérifié, aucun bug trouvé

Investigation approfondie de bout en bout (souscription → résolution → affichage), plutôt qu'une simple
relecture de code : un scénario complet a été exécuté dans un harnais Node dédié (`vm`, même sandbox que
les smoke tests) — publication d'une émission ABS, souscription SENIOR par une compagnie ET souscription
JUNIOR par un JOUEUR (les deux chemins d'entrée UI, `data-subscribe-revenue-listing`/
`-listing-player`, vérifiés jusqu'à `modalSubscribeRevenueSwapTranche`/`subscribeRevenueSwapTranche`),
résolution (`maybeResolveRevenueSwapListings`/`resolveRevenueSwapListing`), puis rendu de
`renderEntreprise()` (souscripteur compagnie) et `renderPortefeuille()` (souscripteur joueur) : dans les
deux cas, le tableau « Mes émissions ABS souscrites » (accordéon `pf-abs` côté Portefeuille, sous-groupe
« 📄 Émissions ABS » de « Produits financiers » côté Mon Entreprise — les deux déjà implémentés depuis la
section 279) affiche correctement l'émettrice, la tranche, le capital et le montant reçu à ce jour. Un
second scénario (souscription JUNIOR seule, sans aucun souscripteur SENIOR — condition d'existence non
remplie, section 275 point 5) confirme que l'émission est alors annulée EN TOTALITÉ sans mouvement d'argent
— comportement documenté et volontaire (une émission sans souscripteur senior n'a jamais existé), pas un
défaut d'affichage. Aucune régression ni bug reproductible identifié sur le chemin décrit par l'utilisateur
avec la version livrée : le mécanisme (déjà construit à la section 279 d'une session précédente) fonctionne
comme demandé. Aucun changement de code pour ce point.

### 4. Fusion « Mes positions boursières » + « Instruments de trading » → « MES POSITIONS »

Les deux anciennes sections top-niveau de `renderPortefeuilleTrading()` (« Mes positions boursières »,
accordéon `pf-comptant` isolé depuis la section 146 ; « Instruments de trading », regroupant
short/bons/prêts/ABS/options/privilégiées) fusionnent en UNE seule section, un seul titre commun
« MES POSITIONS », toutes les sous-sections (accordéons `pf-*`, contenu individuel INCHANGÉ) dans l'ordre
explicitement demandé : **options** (`pf-options`) → **actions** (`pf-comptant`, renommée « Actions » —
ex-« Mes positions boursières ») → **short** (`pf-short`) → **privilégiées** (`pf-preferred`) →
**ABS/obligations** (`pf-bons` puis `pf-abs`, les deux de nature obligataire, non explicitement départagés
par l'utilisateur) → **prêts aux entreprises** (`pf-loans`, autre instrument à revenu fixe non nommé
explicitement, ajouté juste après ABS/obligations avec lesquelles il partage sa nature). Même convention
« masqué si vide » qu'avant, étendue : la section « MES POSITIONS » entière disparaît désormais si les 7
sous-sections sont TOUTES vides (`showActions` ajoutée au filet, pour ne pas laisser réapparaître un titre
vide si seule l'ex-« Mes positions boursières » aurait été vide dans l'ancienne structure).

### 5. Sous-section « en tant qu'assureur » — déjà présente, confirmée

La table « Assurances — en tant qu'assureur » (`myInsurerContracts` + `subInsurerMine`, sous son propre
petit titre en gras) existait déjà dans `produitsAssuranceHtml`, structurellement au même niveau que
« Assurances — en tant qu'assurée » — elle satisfait déjà la demande d'une sous-section « comme les
autres ». Le retrait du doublon du point 1 clarifie sa lecture (elle n'est plus noyée entre la table
« assurée » et l'ancien « Marché des contrats ») ; le renommage/isolement de la reprise sous-standard en sa
propre sous-section titrée (point 1) applique la même logique de séparation par produit à ce qui restait
mélangé. Aucun changement de code additionnel nécessaire pour ce point au-delà du point 1.

### Fichiers/fonctions touchés

`script_extracted.js` : `renderEntreprise()` (`produitsAssuranceHtml`, retrait de `produitsContractRow` et
de l'ancien `marketContractsHtml`, nouveau `subInsuranceTakeoverMarketHtml`, guard `signedAtRoll` sur 2
boutons, `allProductsEmpty`), `subInsuranceActiveListHtml` (guard `signedAtRoll` sur son bouton), et
`renderPortefeuilleTrading()` (fusion de `instrumentsTradingHtml` avec l'ex-bloc `pf-comptant`, réordonnée,
renommée « MES POSITIONS »).

### Tests

8 fichiers de smoke test référençaient l'ancien titre unique « Marché des contrats » (avec sa table normale
dupliquée) et/ou l'ancien titre séparé « Instruments de trading » : `smoke_test_auto_expire_insurance.js`
(fixtures sans `signedAtRoll` — ajouté), `smoke_test_merged_tab.js`, `smoke_test_step24_devenir_assureur_
maisons_suivi.js`, `smoke_test_step28_produits_financiers_hide_empty.js`,
`smoke_test_step31_actions_menu_click_only_and_contracter_assurance.js`,
`smoke_test_step36_devenir_assureur_live_pricing.js` (ces 4 derniers : assertions inversées — un tiers ne
voit plus du tout un contrat normal qui ne le concerne pas, au lieu de vérifier sa présence sans bouton),
`smoke_test_step171_ui_polish_batch.js` et `smoke_test_step62_portefeuille_layout_v2.js` (assertions
adaptées à la structure fusionnée « MES POSITIONS », plutôt que deux sections séparées) — mise à jour
chirurgicale de chaque assertion concernée, jamais de stub, aucune portée de test réduite. Un nouveau
scénario dynamique ad hoc (souscription/résolution/rendu ABS bout en bout, hors suite de smoke tests) a
servi à l'investigation du point 3, sans révéler de défaut. `node -c script_extracted.js` : SYNTAX OK à
chaque édition. Suite complète (197 scripts) relancée à 3 reprises consécutives : **0 échec** à chaque
fois. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique dans les 2 cas).

### Correctif, 2e passe — retrait complet des 2 blocs « sous-standard » restants

Feedback direct de l'utilisateur sur la livraison ci-dessus, verbatim : « Dans produit financier tu as
encore du déboublement d'information. » Investigation : le point 1 avait retiré le doublon « Marché des
contrats » (table normale), mais laissé en place, renommés et isolés en sous-sections propres, les 2 blocs
sous-standard — « Contrats sous-standard en vigueur » (ex-`subInsuranceActiveListHtml`) et « Reprise de
contrats sous-standard (marché) » (ex-`subInsuranceTakeoverMarketHtml`). Les deux parcouraient TOUS LES
DEUX `state.properties.filter(p=>p.subInsurance)` — c'est-à-dire TOUS les contrats sous-standard de la
partie, y compris les MIENS déjà affichés juste au-dessus dans « Assurances — en tant qu'assurée/assureur »
(avec, elles, un bouton Annuler correctement gardé) : un contrat sous-standard m'impliquant pouvait donc
apparaître jusqu'à 3 fois au total. Demande de clarification posée à l'utilisateur, réponse verbatim :
« Assurances — en tant qu'assurée = Bien / Assurances — en tant qu'assureur = Bien / Contrats sous-standard
en vigueur = Pas nécessaire / Reprise de contrats sous-standard (marché) — la résiliation de votre propre
contrat se fait plus haut, dans la section où vous apparaissez comme assurée = Pas nécessaire / C'est déjà
dans l'onglet devenir assureur » — confirmation explicite d'un RETRAIT ENTIER des deux blocs, pas d'une
fusion ni d'un filtrage.

Les deux blocs sont retirés en totalité de `renderEntreprise()` (plus de titre, plus de table, plus de
placeholder « Aucun X actif »). `allSubInsuredProps`/`produitsSubRow` (qui ne servaient plus qu'à eux)
partent avec eux, de même que le point d'entrée `data-takeover-subinsurance` (reprise sous-standard ENTRE
PAIRS, jamais depuis la banque) — cette action reste définie dans le code (`takeOverSubInsurance`, jamais
appelée nulle part désormais) mais n'a plus aucun bouton dans l'UI, même convention que d'autres capacités
déjà retirées de l'interface par le passé (voir section 117, `modalSubInsureProperty`) : conservée
fonctionnelle par prudence, jamais supprimée. Seule la reprise des contrats sous-standard tenus par la
BANQUE (immense majorité des cas réels) reste accessible, dans l'onglet dédié « Devenir l'assureur »
(section 279, `renderDevenirAssureur`/`bankSubInsuredProps`) — exactement ce que confirme l'utilisateur
(« C'est déjà dans l'onglet devenir assureur »).

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderEntreprise()` (retrait des 2 blocs et de
`allSubInsuredProps`/`produitsSubRow`, `allProductsEmpty` simplifié en conséquence), commentaire mis à jour
au-dessus de `takeOverSubInsurance()` pour documenter son statut orpheline-mais-fonctionnelle.

**Tests** : 5 fichiers référençaient l'un des 2 blocs retirés — `smoke_test_merged_tab.js` (assertion
inversée : le tableau « Marché des contrats » sous-standard doit désormais être absent), `smoke_test_
step13_assurances_marches_to_entreprise.js` (bouton de reprise absent), `smoke_test_step28_produits_
financiers_hide_empty.js` (réécriture de la section vérifiant le masquage « produit vide », le sous-
standard n'y comptant plus), `smoke_test_step31_actions_menu_click_only_et_contracter_assurance.js` (un
tiers non impliqué ne doit plus rien voir du tout), `smoke_test_step37_unified_insurance_modal.js`
(vérifie désormais la table « Assurances — en tant qu'assurée » comme seule source de vérité pour un
contrat sous-standard signé). Mise à jour chirurgicale de chaque assertion, jamais de stub. `node -c
script_extracted.js` : SYNTAX OK. Suite complète relancée à 3 reprises consécutives : **0 échec**.

## 285. « MES POSITIONS » du Portefeuille sans sous-accordéons (style « Produits financiers »), ordre demandé, et confirmation visible d'une souscription ABS avant résolution

Citation verbatim :

« Dans la section mes positions de portefeuille : Je ne veux pas de sous-section du style accordéon, mais
comme dans produit financier 🛡️ Assurances / 🔄 Swaps & compensations de loyer. Mais avec dans cette ordre
* Position longues * Positions courtes * Obligation gouvernementaux * Obligation d'entreprise [Prêt]
* Action privilégiées * Options * Stratégie d'option * Titrisation. De plus une fois qu'une entreprise ou un
joueur accepte une titrisation on ne voit rien nul part. Pas dans les transactions, pas dans les produits
financiers, pas dans mes positions. »

### 1. « MES POSITIONS » — groupes plats non repliables, dans l'ordre exact demandé

Depuis la section 284 (point 4), « MES POSITIONS » (`renderPortefeuilleTrading()`) regroupait 7
sous-sections dans des accordéons `<details>/<summary>` individuels (`pf-options`, `pf-comptant`,
`pf-short`, `pf-preferred`, `pf-bons`, `pf-abs`, `pf-loans`) — chacun repliable/dépliable indépendamment,
état persisté via `entrepriseAccordionState`. Demande explicite : plus aucun accordéon ici, remplacé par le
même motif visuel déjà en place pour « Produits financiers » dans Mon Entreprise (`produitsGroups`/
`produitsGroupsHtml`, section 283) — un simple `<div>` par groupe, icône + libellé en majuscules
(`font-weight:700;text-transform:uppercase;color:var(--muted)`), jamais repliable, sans état à persister.

Les 7 accordéons `entrepriseAccordion('pf-*', ...)` sont retirés et remplacés par un tableau
`positionGroups` (même construction que `produitsGroups` : `{icon, label, html}`, filtré sur `html` non
vide, puis assemblé en `positionGroupsHtml` avec une bordure de séparation entre groupes) dans l'ORDRE
EXACT demandé par l'utilisateur — 8 groupes désormais, « Options » et « Stratégie d'option » (fusionnées
sous un seul accordéon `pf-options` depuis la section 284) redevenant deux groupes SÉPARÉS comme demandé :

1. 📈 Positions longues (ex-« Actions », `pf-comptant`)
2. 📉 Positions courtes (`pf-short`)
3. 🏛️ Obligations gouvernementales (`pf-bons`)
4. 🏦 Obligations d'entreprise (Prêt) (`pf-loans`)
5. ⭐ Actions privilégiées (`pf-preferred`)
6. 🎯 Options (position simple seule — ex-partie de `pf-options`)
7. 🧩 Stratégie d'option (jambes de stratégie — ex-second sous-titre interne de `pf-options`)
8. 📄 Titrisation (`pf-abs`)

Le contenu interne de chaque groupe est INCHANGÉ (aucune logique de calcul touchée) — seul le conteneur
change, d'un `<details>` repliable à un `<div>` toujours visible. Le filet « section entière masquée si
tout est vide » (`showShort`/`showBons`/`showLoans`/`showAbs`/`showOptionsSimple`/`showStrategies`/
`showPreferred`/`showActions`, tous à `false`) est conservé à l'identique. Les 4 autres accordéons du
Portefeuille non concernés par la demande (`pf-comparer`, `pf-secteur`, `pf-valeur-nette`,
`pf-etats-financiers`, `pf-historique`) restent des accordéons repliables classiques, inchangés.

### 2. Titrisation ABS — confirmation de souscription visible AVANT résolution

Investigation du 2e point de la demande (« une fois qu'une entreprise ou un joueur accepte une titrisation
on ne voit rien nulle part ») : contrairement à ce que le libellé suggérait, il ne s'agissait pas d'un bug
dans la RÉSOLUTION — un scénario complet exécuté dans un harnais Node dédié (souscription → résolution
réelle via `performRollForAllCompanies()` → rendu) confirme que la tranche résolue apparaît bien ensuite
dans « Titrisation » (Portefeuille, porteur joueur) et « Mes émissions ABS souscrites » (Mon Entreprise,
porteur compagnie) — plomberie déjà vérifiée à la section 284 point 3 et intacte après le passage aux
groupes non-repliables ci-dessus. Le vrai trou : **souscrire** à une tranche (`subscribeRevenueSwapTranche`)
ne donne, par convention établie dans tout le fichier pour les engagements non-financiers (aucun mouvement
d'argent tant que la résolution n'a pas eu lieu — même logique que les offres de prêt via
`submitLoanOffer`), ni entrée « Historique » (`log()` sans tableau `entries`, volontaire, inchangé), ni
AUCUNE confirmation visuelle immédiate ailleurs — contrairement à une offre de prêt, dont `myOffer` est
toujours pré-rempli dans le formulaire (« Mettre à jour » au lieu de « Proposer »). C'est exactement ce que
décrit l'utilisateur (« on ne voit rien nulle part ») : entre le clic sur « Souscrire » et la résolution
(qui peut attendre jusqu'au prochain semestre), rien ne confirmait que la souscription avait bien été
enregistrée.

Correctif, calqué sur le modèle des demandes d'emprunt, dans `renderEntreprise()` ET
`renderPortefeuilleTrading()` (marché des émissions ABS des AUTRES entreprises/annonces à souscrire) : pour
chaque annonce, recherche de la souscription DÉJÀ enregistrée par le souscripteur courant
(`l.seniorSubs`/`l.juniorSubs.find(...)`), et si trouvée, une ligne « ✓ Vous avez souscrit jusqu'à X
(senior/junior). » apparaît immédiatement sous l'annonce, en vert (`#047857`, même couleur que les montants
positifs ailleurs dans le fichier) ; le bouton correspondant passe de « Souscrire (senior/junior) » à
« Modifier (senior/junior) ». Aucun changement à `subscribeRevenueSwapTranche` elle-même (le choix
délibéré de ne PAS ajouter d'entrée « Historique » pour cet engagement non-financier, cohérent avec le
reste du fichier, est maintenu) — seul l'affichage change.

### Fichiers/fonctions touchés

`script_extracted.js` : `renderPortefeuilleTrading()` (retrait des 7 `entrepriseAccordion('pf-*', ...)`,
nouveau tableau `positionGroups`/`positionGroupsHtml` avec les 8 groupes dans l'ordre demandé, split
Options/Stratégie d'option, plus la confirmation de souscription ABS sur le marché des annonces), et
`renderEntreprise()` (confirmation de souscription ABS symétrique sur `otherAbsListingsToShow`).

### Tests

9 fichiers de smoke test référençaient les anciens titres/accordéons `pf-*` ou leurs libellés :
`smoke_test_step49_trading_phase2_short.js`, `smoke_test_step50_trading_phase3_bonds.js`,
`smoke_test_step51_trading_phase4_options.js` (libellé « Options » ambigu — collision avec un sous-titre
de menu non lié, résolu en ciblant la chaîne préfixée par l'icône « 🎯 Options »),
`smoke_test_step58_portefeuille_reorg.js` (réécriture majeure — `expectedKeys` réduit aux 4 accordéons
restants, nouvelle fonction `extractGroupBlock` remplaçant `extractDetailsBlock` pour les 8 groupes),
`smoke_test_step62_portefeuille_layout_v2.js`, `smoke_test_step171_ui_polish_batch.js`,
`smoke_test_step235_option_strategies.js`, `smoke_test_step237_preferred_shares.js`,
`smoke_test_step279_five_refinements.js` — mise à jour chirurgicale de chaque assertion, jamais de stub.
Un nouveau fichier dédié, `smoke_test_step285_mes_positions_layout.js`, couvre spécifiquement : l'ordre
EXACT des 8 groupes quand tous sont peuplés simultanément, l'absence de tout `data-acc-key`/`<details>`
encore ouvert sur ces 8 groupes, la réutilisation du motif visuel `produitsGroups`, la confirmation « ✓
Vous avez souscrit [...] » ET le changement de bouton en « Modifier » AVANT toute résolution (côté joueur
ET côté compagnie), et la non-régression du rendu APRÈS résolution réelle (`performRollForAllCompanies`)
dans les deux surfaces. `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète
(198 scripts) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py`
exécuté ; `index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum`
identique dans les 2 cas).

## 285bis. « MES POSITIONS » — retrait de 3 textes explicatifs devenus superflus

Citation verbatim : « Dans mes positions : Tu peux enlever le texte suivant : Mes parts privilégiées
détenues / Consultez la chaîne de primes (calls/puts) depuis le menu ☰ Actions ci-dessus — « 📊 Voir la
chaîne d'options ». / Ouvrez un bull spread, un bear spread ou un ATM straddle depuis le menu ☰ Actions
ci-dessus — « 🧩 Stratégies d'options ». Règlement cash uniquement, jamais de livraison de parts. »

Trois retraits ponctuels dans `renderPortefeuilleTrading()`, aucun changement de logique — seul le texte
disparaît, le contenu utile (tables/données) reste identique à sa place :

1. Groupe « ⭐ Actions privilégiées » : le petit sous-titre « Mes parts privilégiées détenues »
   au-dessus de la table des parts détenues est retiré — la table apparaît désormais directement en
   premier élément du groupe (les deux autres sous-titres de ce même groupe, « Marché secondaire —
   annonces d'autres joueurs » et « Mes annonces de vente », non mentionnés par l'utilisateur, restent
   inchangés).
2. Groupe « 🎯 Options » : la phrase de renvoi vers le bouton ☰ Actions (« Consultez la chaîne de primes
   [...] ») est retirée — le groupe ne contient plus que la table des positions d'options elle-même
   (`optionsPositionsHtml`). Le bouton ☰ Actions → « 📊 Voir la chaîne d'options » lui-même n'est PAS
   touché, seul le texte qui y renvoyait depuis ce groupe disparaît.
3. Groupe « 🧩 Stratégie d'option » : même traitement pour la phrase de renvoi vers « 🧩 Stratégies
   d'options » — le groupe ne contient plus que la table des stratégies (`strategiesHtml`).

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuilleTrading()` (3 retraits de texte
dans `positionGroups`, section 285).

**Tests** : `smoke_test_step58_portefeuille_reorg.js` référençait le texte de renvoi retiré du groupe
Options (`optionsBlockPointsToActionsButton`) — assertion inversée en `optionsBlockHasNoActionsButtonText`
(vérifie désormais l'ABSENCE des deux formulations possibles de ce texte). Aucun autre fichier ne
référençait les 3 textes retirés. `node -c script_extracted.js` : SYNTAX OK. Suite complète (198 scripts)
relancée à 3 reprises consécutives : **0 échec** à chaque fois.

## 285ter. « Obligations gouvernementales » — indicateurs Solde initial / Intérêts reçus / Solde total

Citation verbatim : « Dans obligation gouvernementales dans mes positions mettre des indicateurs Solde
initial / Intérêts reçus / Solde total »

`bondBalance` est un solde COMPOSÉ à un seul chiffre (principal et intérêts confondus — voir le commentaire
historique d'`accrueBondInterest`, section 130 : « un seul nombre qui grossit, pas de distinction
principal/intérêt à conserver »). Afficher un « Solde initial » séparé exigeait donc un nouveau sous-total
pour pouvoir le déduire. `cumInterestReceived`/`cumInterestPaid` existaient déjà (section 229, popup
« Évolution de mon portefeuille ») mais agrègent TOUS les intérêts confondus — bons ET prêts joueur-prêteur
(`recordLoanInterestReceivedByPlayer`) — impropres à isoler la part spécifique aux bons.

Nouveau champ `player.cumBondInterest` — sous-total SIGNÉ (positif = intérêt reçu net, négatif = intérêt
payé net sur une dette empruntée via `shortBonds`) alimenté UNIQUEMENT par `accrueBondInterest`, en plus de
(pas à la place de) `cumInterestReceived`/`cumInterestPaid` qui restent inchangés pour le popup existant.
Permet `Solde initial = bondBalance - cumBondInterest` (identité exacte à tout moment, vérifiée par le
nouveau test). Initialisé à 0 à la création d'un joueur et par une ligne de migration dédiée, indépendante
du bloc `if(p.startingCash===undefined)` existant (qui ne s'exécute qu'à la toute première migration d'une
partie) — une partie déjà migrée depuis longtemps (avant l'existence de ce champ) le reçoit quand même,
comme `bondBalance` lui-même.

La table du groupe « 🏛️ Obligations gouvernementales » (`bondsHtml`) gagne 2 nouvelles lignes AVANT
l'ancienne ligne unique (rebaptisée « Solde total », ex-« Solde actuel ») :

- **Solde initial** = `bondBalance - cumBondInterest` — libellé adapté en « Solde initial (dette
  empruntée) » et couleur `--brick` si négatif (même convention déjà en place pour la ligne « Solde
  actuel »/« Solde total »).
- **Intérêts reçus** = `cumBondInterest` — libellé adapté en « Intérêts payés » si négatif (même dualité
  reçu/payé déjà établie par `cumInterestReceived`/`cumInterestPaid`, section 229), couleur `--brick` si
  négatif.
- **Solde total** = `bondBalance` (ligne déjà existante, simplement renommée) — libellé/couleur inchangés
  par ailleurs (« Solde total (dette empruntée) » si négatif).

Les lignes déjà existantes « Taux annuel courant » et « Dette maximale autorisée » (affichée seulement si
endetté) restent inchangées, après ces 3 nouvelles lignes.

**Fichiers/fonctions touchés** : `script_extracted.js` — `createGame()` (nouveau champ `cumBondInterest:0`
à l'initialisation d'un joueur), `migrateState()` (ligne de migration indépendante), `accrueBondInterest()`
(incrémentation signée de `cumBondInterest`, en plus de `cumInterestReceived`/`cumInterestPaid` inchangés),
`renderPortefeuilleTrading()` (`bondsHtml` : 2 nouvelles lignes, renommage de la ligne existante).

**Tests** : aucun fichier existant ne référençait le texte « Solde actuel » (retiré au profit de « Solde
total ») — aucune régression détectée dans la suite existante. Nouveau fichier dédié,
`smoke_test_step285ter_bond_indicators.js`, couvre : placement positif sur 3 lancers (Solde initial = 1000
M$ EXACT, Intérêts reçus = somme EXACTE des intérêts composés, identité Solde initial + Intérêts = Solde
total) ; dette via `shortBonds` (Intérêts payés négatifs, Solde initial moins négatif que le solde courant,
même identité exacte, libellés adaptatifs « Intérêts payés »/« Solde initial (dette empruntée) ») ;
migration d'une sauvegarde sans `cumBondInterest` (initialisée à 0, Solde initial retombe alors sur
`bondBalance`) ; rendu HTML (les 3 libellés présents dans le bon ordre, aucun NaN/undefined). `node -c
script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (199 scripts, incluant le nouveau
fichier) relancée à 3 reprises consécutives : **0 échec** à chaque fois. `python3 sync_script.py` exécuté ;
`index.html`≡`monopolybourse.html` et `index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique
dans les 2 cas).

## 285quater. Titrisation — indicateurs de cascade : combien la senior a reçu, combien il lui reste à recevoir, combien la junior a reçu

Contexte : après les sections 285/285bis/285ter (voir plus haut), l'utilisateur a testé la confirmation de
souscription ABS en conditions réelles (deux échanges de suivi, non reproduits en détail ici — captures
d'écran générées à la demande pour confirmer que le mécanisme fonctionnait bien dès le lancer suivant), puis
a demandé, citation verbatim : « Pour les indications de titrisation ajouter combien le senior a recu
combien il reste a recevoir et combien le junior a recu »

Une émission ABS résolue verse ses loyers cédés selon une CASCADE (voir `distributeAbsCashflow`, section
275) : la tranche SENIOR est servie en premier, jusqu'à son plafond (`seniorCapTotal`) ; seul le
débordement, une fois ce plafond atteint, revient à la tranche JUNIOR (sans plafond). Un porteur — qu'il
détienne la senior OU la junior — bénéficie de voir où en est TOUTE la cascade, pas seulement sa propre
tranche : un porteur junior, en particulier, veut savoir à quel point la senior approche son plafond (signe
que la junior va bientôt commencer à recevoir).

`myAbsHoldings()` calcule désormais, pour CHAQUE ligne qu'elle retourne (peu importe si le porteur
correspondant est lui-même senior ou junior), 3 indicateurs au niveau du DEAL ENTIER :

- **Senior — reçu** = `deal.seniorPaidSoFar` — déjà agrégé au niveau du deal par `distributeAbsCashflow`,
  aucun recalcul nécessaire.
- **Senior — reste à recevoir** = `deal.seniorCapTotal - deal.seniorPaidSoFar` (jamais négatif).
- **Junior — reçu** = somme de `receivedSoFar` sur TOUS les porteurs juniors du deal (y compris la part
  éventuellement RETENUE par l'émetteur si la junior n'a pas été souscrite en entier — porteur synthétique,
  voir `resolveRevenueSwapListing`, section 275 point 5) — aucun agrégat équivalent n'existait déjà pour la
  junior (sans plafond, jamais suivie en cumul au niveau du deal jusqu'ici), recalculé à la volée.

Ces 3 valeurs sont donc IDENTIQUES pour tous les porteurs d'un même deal (senior ou junior) — ce sont des
totaux de cascade, pas des montants par porteur (qui restent, eux, dans la colonne « Reçu à ce jour » déjà
existante, inchangée). 3 nouvelles colonnes (« Senior — reçu » / « Senior — reste à recevoir » / « Junior —
reçu »), après les colonnes déjà existantes, dans les deux tables qui consomment `myAbsHoldings()` : le
groupe « 📄 Titrisation » de « MES POSITIONS » (Portefeuille, section 285) et « Mes émissions ABS
souscrites » (Mon Entreprise, Produits financiers, section 279).

**Fichiers/fonctions touchés** : `script_extracted.js` — `myAbsHoldings()` (3 nouveaux champs calculés par
deal sur chaque ligne retournée), `renderPortefeuilleTrading()` et `renderEntreprise()` (3 nouvelles
colonnes dans les 2 tables consommant `myAbsHoldingsList`).

**Tests** : aucun fichier existant ne référençait la largeur exacte des 2 tables concernées (en-têtes de
colonnes) — aucune régression détectée dans la suite existante. Nouveau fichier dédié,
`smoke_test_step285quater_abs_waterfall_indicators.js`, couvre : les 3 indicateurs à 0 avant tout versement
(reste à recevoir = plafond entier) ; un 1er versement sous le plafond (senior reçoit exactement le
montant, junior toujours à 0) ; un 2e versement qui déborde le plafond (senior plafonnée exactement à
`seniorCapTotal`, reste à recevoir à 0, junior reçoit exactement le débordement) ; l'identité stricte entre
la ligne vue par le porteur senior et celle vue par le porteur junior d'un même deal (mêmes 3 totaux) ; la
non-régression des colonnes déjà existantes ; le rendu HTML dans les deux surfaces (Portefeuille ET Mon
Entreprise), sans NaN/undefined. `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète
(200 scripts, incluant le nouveau fichier) relancée à 3 reprises consécutives : **0 échec** à chaque fois.
`python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique dans les 2 cas).

## 285quinquies. Titrisation — correctif : une tranche senior au plafond nul par construction annulait à tort toute l'émission, y compris la tranche junior pleinement souscrite

Contexte (citation verbatim de l'utilisateur, diagnostic auto-affiné en deux temps) : « AH j'ai trouvé le
bug si quelqu'un indique un montant plus élevé que la tranche disponible ça annule la demande, il faudrait
que si un joueur offre plus que le montant l'application comprenne que c'est équivalent à avoir demandé la
totalité pour titrisation je parle » — hypothèse initiale investiguée et NON reproduite (une offre
surdimensionnée, seule ou combinée à d'autres, est déjà correctement plafonnée par `levelAbsSubscriptions`,
partage égal plafonné — voir section 275 point 4, comportement inchangé et re-vérifié). Diagnostic affiné
ensuite avec un scénario précis : « Ok Joueur A, fait une titrisation sur le orange 1 et le orange 2 (sans
maison les 2). Il cède 60% de sa part durée 1 an pour 3M$. Joueur B: Prend une senior pour 4M$. Entreprise
C: Prend une junior sur le 3M$. Rien ne se passe. Je crois finalement que c'est à cause que la tranche
sénior avait un plafond de 0K. » — auto-diagnostic exact, confirmé par investigation.

`computeAbsPricing` (section 275 point 6) calcule `seniorCapacity = Math.max(0, meanRent -
ABS_SENIOR_CONFIDENCE_Z*stdRent)` — une capacité PRUDENTE (espérance moins un écart-type), qui tombe
légitimement à exactement 0 pour un panier trop petit ou trop volatile par rapport à la durée (peu de
terrains, ou une seule case, sur une durée courte — comportement DOCUMENTÉ et VOULU du modèle de
tarification, pas un bug en soi : un panier de 2 terrains sans maison sur 1 an, comme celui de l'exemple de
l'utilisateur, en fait partie). `computeAbsTranches` en découle: `seniorAmount = min(amountSought,
seniorCapacity) = 0`. Or `levelAbsSubscriptions(subs, target)` (section 275 point 4) ne fait JAMAIS tourner
sa boucle de répartition tant que `target<=1e-9` (`remaining = Math.max(0, target)` démarre déjà à 0) — elle
renvoie donc TOUJOURS un tableau vide dans ce cas, quel que soit le nombre ou le montant des souscripteurs
senior réels.

`resolveRevenueSwapListing()` (section 275 point 5) appliquait une garde UNIQUE et INCONDITIONNELLE :
`if(seniorHolders.length===0){ annulation totale de l'émission }`. Cette garde confondait deux situations
très différentes : (a) la tranche senior a une taille réelle mais personne n'a voulu y souscrire —
annulation VOULUE, condition d'existence originale (section 275 point 5) ; (b) la tranche senior est nulle
PAR CONSTRUCTION du modèle de tarification, donc structurellement IMPOSSIBLE à souscrire pour QUICONQUE,
même avec un souscripteur bien réel prêt à y mettre n'importe quel montant. Dans le cas (b) — celui du
scénario de l'utilisateur — l'émission entière était annulée à tort, y compris la tranche JUNIOR pourtant
pleinement souscrite (Entreprise C perdait sa souscription de 3M$, Joueur A ne recevait jamais son
financement, alors que rien n'empêchait la junior seule de se résoudre).

**Correctif** : la garde `seniorHolders.length===0` ne s'applique désormais QUE si la tranche senior a une
taille réelle (`listing.tranches.seniorAmount>1e-9`) — comportement (a), INCHANGÉ. Quand la tranche senior
est nulle par construction (`seniorAmount<=1e-9`), la condition d'existence se reporte sur l'intérêt
manifesté EN GÉNÉRAL — reprise du principe déjà énoncé section 275 point 3, verbatim : « Si personne n'a
manifesté d'intérêt, l'annonce est annulée d'office » — appliqué ici à la présence d'au moins un
souscripteur JUNIOR réel. Aucun souscripteur (ni senior, ni junior) → toujours annulée (filet de sécurité
conservé). Au moins un souscripteur junior → l'émission se résout désormais avec succès, sans aucun porteur
senior (logiquement, puisque la tranche senior est nulle). Le message de journal (log) de la résolution
réussie gagne un repli `|| 'aucun'` sur la liste des noms de porteurs senior (`seniorNames`), déjà présent
côté `juniorNames` pour la même raison, puisque `seniorHolders` peut désormais être vide même dans le chemin
de résolution RÉUSSIE (pas seulement dans le chemin d'annulation comme avant ce correctif).

**Fichiers/fonctions touchés** : `script_extracted.js` — `resolveRevenueSwapListing()` uniquement
(réordonnancement du calcul de `juniorHoldersReal`/`juniorRaisedReal` avant la garde, condition de la garde
existante restreinte à `seniorAmount>1e-9`, nouvelle garde de repli pour `seniorAmount<=1e-9`, repli textuel
`seniorNames`).

**Tests** : `smoke_test_step275_abs.js`, section (5), reposait — sans le savoir — sur ce même cas limite
(panier à une seule propriété, 1 an, capacité senior nulle par construction) pour tester la condition
d'existence « aucun souscripteur senior → annulation » : elle passait avant ce correctif pour la MAUVAISE
raison (elle exerçait en réalité le chemin de repli devenu (5c), pas la garde originale (5a)). Section (5)
remaniée en trois volets explicites : **(5a)** panier à capacité senior RÉELLEMENT positive (2 terrains avec
maisons, 5 ans) et aucun souscripteur senior → annulation totale, comportement ORIGINAL et INCHANGÉ,
vérifié y compris avec une souscription junior déjà enregistrée (perdue par l'annulation, comme avant) ;
**(5b)** panier à capacité senior NULLE par construction (1 terrain, 1 an, mêmes proportions que le
scénario rapporté par l'utilisateur) et un souscripteur junior → résolution RÉUSSIE, nouvelle couverture du
correctif, avec vérification explicite qu'aucun porteur senior n'existe sur le deal résolu et que les
montants débité/crédité sont exacts ; **(5c)** même panier à capacité senior nulle mais aucun souscripteur
du tout → toujours annulée, nouvelle couverture du filet de sécurité. `node -c script_extracted.js` : SYNTAX
OK à chaque édition. Suite complète (200 scripts) relancée à 3 reprises consécutives : **0 échec** à chaque
fois. `python3 sync_script.py` exécuté ; `index.html`≡`monopolybourse.html` et
`index_leger.html`≡`monopolybourse_leger.html` (`md5sum` identique dans les 2 cas).

## 286. Portefeuille — identification automatique de la stratégie d'une position d'option isolée (Covered Call / Protective Put / Cash-Secured Put / Naked)

Contexte (citation verbatim de l'utilisateur) : « Identification des stratégies d'options : Afficher
Covered Call si la vente de Call est couverte à 100 % par les actions détenues. Afficher Protective Put si
l'achat de Put est adossé aux actions. Afficher Cash-Secured Put si la vente de Put est couverte à 100 % par
l'encaisse. Afficher Naked si la position ne possède pas de couverture. »

Nouvelle fonction `optionPositionStrategyLabel(player, company, pos)` : compare le nombre de parts couvertes
par le contrat (`pos.shares*OPTION_CONTRACT_MULTIPLIER`, l'effet de levier 100× déjà en place — section 145)
à la position en actions RÉELLE du joueur dans `company.shareholders` (call écrit couvert à 100% par les
actions détenues → Covered Call ; put acheté adossé à au moins autant d'actions → Protective Put) ou à son
encaisse disponible via `optionNotional(pos.shares, pos.strike)` (put écrit couvert à 100% par l'encaisse →
Cash-Secured Put). Aucune des trois couvertures ne s'applique → Naked. Couverture évaluée au moment de
l'affichage (pas figée à l'ouverture) : une position ouverte Naked qui devient couverte par un achat
d'actions ultérieur (ou l'inverse) voit son étiquette se mettre à jour au prochain rendu, cohérent avec le
reste de l'application (aucun état de stratégie n'est stocké sur la position elle-même). Voir section 287
pour son intégration dans le tableau « Mes positions ».

**Fichiers/fonctions touchés** : `script_extracted.js` — nouvelle fonction `optionPositionStrategyLabel()`,
juste après `optionPositionGreeks()`.

**Tests** : `smoke_test_step218_greeks_beta.js` étendu — quatre positions isolées construites explicitement
dans chacun des quatre cas (call écrit + actions suffisantes, put acheté + actions suffisantes, put écrit +
encaisse suffisante, position sans aucune couverture), vérifiant que `optionPositionStrategyLabel()` renvoie
bien le libellé attendu pour chacune, y compris la limite exacte (couverture à 99,9% des parts requises →
Naked, à 100,0% exactement → couverte). `node -c script_extracted.js` : SYNTAX OK. Suite complète (200
scripts) relancée à 3 reprises consécutives : **0 échec**.

## 287. Portefeuille — colonne « Stratégie » + bouton « Détail » (grecques déplacées dans une vue détail)

Contexte (citation verbatim de l'utilisateur) : « Optimisation de l'affichage : Ajouter une colonne
« Stratégie » dans les options "Mes positions" pour indiquer clairement le type de stratégie. Ajouter un
bouton « Détail » sur chaque ligne pour accéder aux informations complémentaires. Déplacer l'affichage des
greques à l'intérieur de cette vue détails pour libérer de l'espace. »

Le tableau « Mes positions d'options » (Portefeuille → Instruments de trading) gagne une colonne
« Stratégie » (alimentée par `optionPositionStrategyLabel()`, section 286) entre « Côté » et « Strike ». Les
quatre colonnes de grecques (Δ/Γ/V/Θ), auparavant affichées EN LIGNE pour chaque position (souvent illisible
avec plusieurs positions ouvertes en même temps), sont retirées du tableau principal et remplacées par un
bouton « Détail » (à côté du bouton « Clôturer » déjà existant) qui ouvre une nouvelle modale
`modalOptionPositionDetails(positionId)` : type/côté/strike/contrats/lancers restants avant échéance/
stratégie identifiée, puis un mini-tableau des quatre grecques (même code couleur vert/rouge que l'ancien
affichage en ligne). La position peut avoir été clôturée entre le rendu et le clic (fenêtre de trading très
active) — repli défensif avec `alert()` explicite plutôt qu'une erreur silencieuse.

**Fichiers/fonctions touchés** : `script_extracted.js` — nouvelle fonction `modalOptionPositionDetails()` ;
`renderPortefeuilleTrading()` (tableau des positions d'options : nouvelle colonne Stratégie, colonnes
grecques remplacées par les boutons Détail/Clôturer, en-têtes de colonnes mis à jour) ; `bindTabEvents()`
(nouveau câblage `[data-option-position-details]`).

**Tests** : `smoke_test_step218_greeks_beta.js`, section (F) réécrite — vérifie que le tableau principal ne
contient plus les grecques (absence de `title="Delta`) mais contient bien le bouton Détail, et que la modale
ouverte par `modalOptionPositionDetails()` contient les quatre en-têtes de grecques avec la valeur delta
exacte attendue. `node -c script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3
reprises consécutives : **0 échec**.

## 288. Portefeuille — obligations gouvernementales : informations en colonnes plutôt qu'en lignes

Contexte (citation verbatim de l'utilisateur) : « Mes positions obligations gouvernementales, mettre les
informations sur des colonnes pas des lignes »

Le bloc « Mes obligations gouvernementales » (principal investi/emprunté, intérêts courus, solde net, taux
annuel courant, et — pour une position emprunteuse — la dette maximale autorisée) affichait auparavant CHAQUE
métrique sur sa PROPRE ligne (paire libellé/valeur empilée verticalement). Pivoté en un tableau classique :
une ligne d'en-têtes (une colonne par métrique), une seule ligne de valeurs en dessous — même convention de
lisibilité que les autres tableaux de « Mes positions » (actions, courtes, options). Aucun calcul modifié,
uniquement la disposition ; la colonne « Dette maximale autorisée » reste conditionnelle (n'apparaît que pour
une position nette emprunteuse), comme avant.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuilleTrading()`, variable
`bondsHtml`.

**Tests** : nouveau smoke test dédié (voir section 291 ci-dessous pour la liste complète des couvertures
ajoutées dans ce lot) vérifiant la structure en colonnes (une ligne `<tr>` d'en-têtes suivie d'une seule
ligne `<tr>` de valeurs, plutôt que N lignes libellé/valeur) pour une position emprunteuse ET une position
prêteuse. `node -c script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises
consécutives : **0 échec**.

## 289. Portefeuille — stratégies d'options : une jambe par ligne dans la colonne « Jambes »

Contexte (citation verbatim de l'utilisateur) : « Mes positions stratégies d'options la colonne Jambes
(Strike, +Longues/-Écrite) mettre chaque jambes sur sa propre ligne pas besoin de "/" ». Format demandé
(exemple fourni verbatim) :

```
+C 89,49$
-C 110,00$
```

La colonne « Jambes » du tableau « Mes stratégies d'options » affichait auparavant toutes les jambes d'une
stratégie séparées par « / » sur une seule ligne (avec un traitement spécial pour le straddle, affiché comme
« ATM (strike) » plutôt que ses deux jambes). Unifié : chaque jambe s'affiche désormais sur SA PROPRE ligne
(`<br>` entre chaque jambe), au format exact demandé — signe +/- (longue/écrite) suivi de C/P (call/put) puis
du strike en dollars — pour TOUS les types de stratégies, straddle inclus (qui perd son traitement spécial,
ses deux jambes s'affichant désormais comme n'importe quelle autre stratégie à deux jambes).

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuilleTrading()`, variable
`strikesLabel` dans `strategiesRows`.

**Tests** : nouveau smoke test dédié (section 291) vérifiant le format exact `+C 89,49$<br>-C 110,00$` (et
équivalents pour bear spread/straddle) pour plusieurs types de stratégies, y compris le straddle qui n'a plus
son ancien format spécial « ATM (strike) ». `node -c script_extracted.js` : SYNTAX OK. Suite complète (200
scripts) relancée à 3 reprises consécutives : **0 échec**.

## 290. Mon Entreprise — retrait du texte de rappel « Soumettre ou retirer une offre... » sous l'enchère de maisons

Contexte (citation verbatim de l'utilisateur) : « Dans mon entreprise tu peux enlever le hard text suivant :
Soumettre ou retirer une offre se fait via le bouton « 🏠 Enchère de maisons » tout en haut de page. »

Le bloc `houseBidHintHtml` (rappel de l'offre courante d'enchère de maisons, affiché dans l'accordéon
« Maisons ») combinait deux éléments : le rappel DYNAMIQUE de l'offre courante (« Votre offre actuelle: X
maison(s) à Y$/maison ») et une phrase STATIQUE expliquant où soumettre/retirer une offre. Seule la phrase
statique est retirée — le rappel dynamique de l'offre courante est conservé (utile, contrairement au texte
explicatif fixe). Le bloc entier reste masqué quand il n'y a rien à afficher (aucune offre active), même
convention « masqué si vide » que le reste du fichier — désormais aussi masqué (plutôt que réduit à une
coquille vide) quand l'enchère est ouverte mais qu'aucune offre n'est encore soumise par cette entreprise.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderEntreprise()`, variable
`houseBidHintHtml`.

**Tests** : nouveau smoke test dédié (section 291) vérifiant l'absence du texte statique retiré et la
présence conservée du rappel dynamique quand une offre existe, et l'absence totale du bloc quand aucune
offre n'existe. `node -c script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises
consécutives : **0 échec**.

## 291. Mon Entreprise — Bilan : équivalence Actifs = Passifs + Équité limitée au dernier semestre (historique complet du Bilan conservé)

Contexte (citation verbatim de l'utilisateur, deux messages liés) : « Pour le bilan tu peux seulement mettre
la dernière année pour l'équivalence du Année 1, Semestre 1 : Actifs = Passifs + Équité ✓ » puis, immédiatement
après, correctif de portée explicite : « Pas oublié de garder l'ensemble des semestres dans mon entreprise »
— confirmation que seule la LIGNE de vérification (une ligne par semestre passé, empilées verticalement)
devait être réduite, PAS le tableau du Bilan lui-même (qui affiche tous les semestres côte à côte en
colonnes et reste entièrement INCHANGÉ).

`identityLines` (vérification comptable Actifs=Passifs+Équité, une ligne par période) ne construit plus la
liste complète de toutes les périodes — elle sélectionne désormais la période la PLUS RÉCENTE parmi celles
qui ont un bilan (`statements` étant déjà trié du plus récent au plus ancien via `periods.reverse()` plus
haut dans la fonction, un simple `.find(s=>s.bs)` suffit) et n'affiche qu'une seule ligne pour celle-ci.
Extraction dans une fonction `identityLineFor(s)` pour rester lisible. L'AUTRE occurrence similaire de ce
calcul, dans `renderPortefeuilleFinancials()` (comparaison entre compagnies pour UNE période sélectionnée,
pas un historique de périodes — fonctionnalité différente), est délibérément laissée INCHANGÉE — hors de la
portée de cette demande.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderEntrepriseFinancials()`, variable
`identityLines` (nouvelle fonction interne `identityLineFor`), tableau du Bilan (`bsRowsHtml` et environs)
INCHANGÉ.

**Tests** : nouveau fichier `smoke_test_step291_positions_bilan_entreprise_polish.js` couvrant, sur une
partie avec au moins trois semestres écoulés : (a) le tableau du Bilan contient toujours TOUTES les colonnes
de semestres (aucune régression sur l'historique) ; (b) `identityLines` ne contient plus qu'UNE seule ligne
(celle du semestre le plus récent), plus aucune mention des semestres antérieurs ; (c) le format en colonnes
des obligations gouvernementales (section 288) ; (d) le format une-jambe-par-ligne des stratégies d'options
(section 289) ; (e) l'absence du texte statique de l'enchère de maisons (section 290). `node -c
script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises consécutives : **0
échec**.

## 292. Options — un delta arrondi à 0,00 bloque désormais complètement la prime (contrat impossible à ouvrir)

Contexte (citation verbatim de l'utilisateur) : « dans les options si tu as un delta de 0,00 tu ne devrais
pas avoir une prime, l'option ne devrait pouvoir être contracter »

Nouvelle garde `optionDeltaRoundsToZero(delta)` (vrai si `delta.toFixed(2)===0`, donc un delta affiché comme
« 0,00 » à l'utilisateur, qu'il soit exactement nul ou simplement arrondi en dessous du seuil d'affichage).
`optionPremiumFor()` calcule désormais le delta AVANT le prix (via `blackScholesGreeks`) et retourne 0
immédiatement si ce delta arrondit à zéro — COURT-CIRCUITANT le plancher de prime (`OPTION_PREMIUM_FLOOR_PCT`,
section 145) qui, auparavant, garantissait toujours une prime minimale même pour une option sans valeur
réelle négociable. `openOptionPosition()`/`openOptionStrategy()` refusent désormais explicitement l'ouverture
(erreur explicite plutôt qu'une prime nulle silencieusement acceptée) dès qu'au moins une jambe a un delta
arrondi à 0,00 — une stratégie entière est refusée si NE SERAIT-CE QU'UNE de ses jambes tombe dans ce cas
(cohérent avec le principe qu'une jambe sans valeur réelle rend la stratégie entière incohérente).

Conséquence en cascade sur les tests EXISTANTS : plusieurs scénarios de test utilisaient délibérément des
strikes très profondément hors-jeu (« deep OTM ») pour tester d'autres mécanismes (exclusion d'une
projection, plancher de prime, ancien exploit de plancher) — désormais bloqués par cette nouvelle garde AVANT
même d'atteindre le mécanisme testé. Chacun recalibré à un strike plus proche (delta non-nul mais toujours
minime) préservant l'intention originale du test — voir le détail par fichier ci-dessous.

**Fichiers/fonctions touchés** : `script_extracted.js` — nouvelle fonction `optionDeltaRoundsToZero()`,
`optionPremiumFor()` (garde ajoutée avant le calcul du prix brut), `openOptionPosition()`/
`openOptionStrategy()` (refus explicite si delta arrondi à 0,00, un seul message d'erreur par fonction).

**Tests** : nouveau smoke test dédié couvrant directement la garde (delta arrondi à zéro → prime nulle,
ouverture refusée avec message explicite, aucune mutation de cash/position sur le refus, pour une position
isolée ET une stratégie multi-jambes). Quatre fichiers de tests PRÉ-EXISTANTS recalibrés (strikes déplacés
plus près du cours pour rester dans la zone « delta non-nul » tout en préservant l'intention de chaque
test — vérifié numériquement, `blackScholesGreeks().delta` sondé pour chaque nouveau strike avant
application) : `smoke_test_step182_5_items_batch.js` (strike OTM de test déplacé de 100 à 5,5, stockPrice=5),
`smoke_test_step178_last_resort_loan_and_gameend.js` (strike de 120 à 65, stockPrice=64 à ce point du
scénario), `smoke_test_step235_option_strategies.js` (largeur des bull/bear spreads réduite de 8/12 à 9/11
partout où le sous-jacent est à 10$ sur 6 mois — total de règlement recalculé de 400 à 200 dans le
commentaire du scénario), `smoke_test_step260_options_audit_fixes.js` (les deux scénarios d'exploit de
plancher, initialement aux strikes -20%/-10% de la chaîne, recalibrés à -11%/-9% — sondés pour rester SOUS le
plancher tout en gardant un delta non-nul), `smoke_test_step51_trading_phase4_options.js` (section (B), test
du plancher de prime, strike déplacé de 1$ à 93$ pour un sous-jacent à 100$, delta≈-0,046 — sous le plancher
tout en restant non-nul). `node -c script_extracted.js` : SYNTAX OK à chaque édition. Suite complète (200
scripts) relancée à 3 reprises consécutives : **0 échec** à chaque fois (après recalibration des 4 fichiers
pré-existants et du nouveau test dédié).

## 293. Portefeuille — reformulation du texte d'encaisse projetée tenant compte de l'exercice des options

Contexte (citation verbatim de l'utilisateur) : « Changer "13.98 M$ si les options actuellement dans la
monnaie (achat call/vente put) expiraient et entraînaient une acquisition de stock" pour : "13,98M$, encaisse
considérant l'exercice des options" »

Texte purement esthétique — aucun calcul modifié (le montant projeté `projected` reste identique). Le libellé
long expliquant la mécanique (« si les options actuellement dans la monnaie... entraînaient une acquisition
de stock ») est remplacé par la formulation plus courte demandée.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuille()`, variable
`projectedCashLine`.

**Tests** : `smoke_test_step182_5_items_batch.js` (deux assertions de sous-chaîne mises à jour vers le
nouveau texte, en plus du recalibrage de strike de la section 292 sur ce même fichier). `node -c
script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises consécutives : **0
échec**.

## 294. Portefeuille — position courte : nombre de parts formaté avec séparateur de milliers

Contexte (citation verbatim de l'utilisateur) : « Position courte formaté les parts # ### ###.0000 »

Le tableau « Mes positions courtes » affichait le nombre de parts avec `.toFixed(4)` brut (ex. `1234.5000`,
sans séparateur de milliers) — seul tableau de « Mes positions » à ne pas encore utiliser l'utilitaire déjà
existant `fmtShares()` (formatage `# ### ###.0000`, espaces insécables, 4 décimales) déjà employé partout
ailleurs dans l'application (positions boursières, actionnariat, etc.). Simple remplacement par cet
utilitaire déjà éprouvé — aucune nouvelle logique de formatage introduite.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuilleTrading()`, variable
`shortsRows`.

**Tests** : nouveau smoke test dédié (voir section 296) vérifiant le format `# ### ###.0000` (séparateurs de
milliers en espace insécable, 4 décimales) sur une position courte avec un nombre de parts à quatre chiffres
ou plus. `node -c script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises
consécutives : **0 échec**.

## 295. Mon Entreprise — menu ☰ Actions : couleur commune pour les actions liées au financement, renommage de quatre libellés, retrait de la description d'entreprise

Contexte (trois demandes explicites de l'utilisateur, verbatim) :

« dans mon entreprise 'ACtions' mettre de la même couleur les actions liés au financement: Vendre prochaine
subvention d'avance / Vendre une part / Hypothéquer / Prêt / Émission de nouvelle actions / Émettre part
privilégiés / Vente de revenus (ABS). Laisse Tour terminé en vert, le reste en blanc »

« Libellé des actions dans mon entreprise :
Vendre la prochaine subvention d'avance => Subvention d'avance
Émission de nouvelles actions => Émission d'actions
Émettre des parts privilégiées => Parts privilégiées
Vente de revenu (ABS) => Titrisation »

« Dans mon entreprise pas besoin de mettre la description de l'entreprise à cet endroit »

**Couleur commune (financement)** : les sept boutons listés partagent déjà, pour quatre d'entre eux
(subvention d'avance, prêt, émission d'actions, parts privilégiées), la classe `btn-pale-gold` (doré pâle) —
réutilisée comme couleur commune plutôt que d'introduire une nouvelle classe CSS. Les trois autres
(« Vendre une part », « Hypothéquer », « Titrisation ») passent de `btn-ghost` (blanc/neutre) à
`btn-pale-gold` pour rejoindre le groupe. À l'inverse, trois boutons qui portaient déjà `btn-pale-gold` mais
ne figurent PAS dans la liste de l'utilisateur (« Annoncer un dividende », « Rachat d'actions », « Contrat
d'assurance ») repassent à `btn-ghost` (« le reste en blanc », lu comme s'appliquant à tout bouton du menu
☰ Actions hors des sept listés). « Tour terminé » (`btn-pale-success`, vert) reste INCHANGÉ, comme demandé
explicitement.

**Renommage de quatre libellés** : purement textuel, aucune logique/condition d'affichage modifiée pour les
quatre boutons concernés (`data-go-advance`, `id="openIssueSharesBtn"`, `id="openIssuePreferredBtn"`,
`id="openProposeRevenueSwapBtn"` tous inchangés — seul le texte visible du bouton change).

**Retrait de la description d'entreprise** : le paragraphe `company.description` (affiché en haut de
l'accordéon « Identité » de Mon Entreprise, juste sous le nom/type de l'entreprise) est retiré. Seule cette
occurrence est visée — la description reste affichée ailleurs dans l'application (notamment
`tvSlideCompanyShowcase()`, l'écran TV de présentation d'entreprise), qui n'est pas concerné par cette
demande et reste inchangé.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderEntreprise()` : variables
`goAdvanceButtonHtml`, `sellShareButtonHtml`, `mortgageButtonHtml`, `proposeRevenueSwapButtonHtml`,
`issueSharesButtonHtml`, `issuePreferredButtonHtml` (classe CSS et/ou libellé), `insuranceBundleButtonHtml`,
`payDividendButtonHtml`, `buybackSharesButtonHtml` (classe CSS uniquement), et le template de l'accordéon
« identite » (paragraphe de description retiré). `issueLoanButtonHtml` (« Prêt ») déjà conforme aux deux
demandes (couleur ET libellé) — aucun changement nécessaire.

**Tests** : quatre fichiers pré-existants mis à jour pour refléter les nouveaux libellés (aucune logique de
test modifiée, uniquement les chaînes attendues) : `smoke_test_step19_entreprise_rent_etf_go_polish.js`,
`smoke_test_step234_share_issuance_buyback.js`, `smoke_test_step276_abs_ui_polish.js`,
`smoke_test_step39_icons_tps_tvq_and_company_cash_adjust.js`. Nouveau smoke test dédié (section 296)
couvrant explicitement la couleur de chacun des sept boutons du groupe financement (`btn-pale-gold`), la
couleur des trois boutons repassés en blanc (`btn-ghost`), la couleur inchangée de « Tour terminé »
(`btn-pale-success`), et l'absence de `company.description` dans le HTML rendu de Mon Entreprise (avec une
entreprise dont la description N'EST PAS vide, pour éviter un faux positif). `node -c script_extracted.js` :
SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises consécutives : **0 échec** (une occurrence
isolée d'échec de `smoke_test_step193_stock_cube_floor.js`, test préexistant à tirages aléatoires non
seedés — section 160 — sans lien avec ce lot de changements, re-vérifiée indépendamment comme non
reproductible : 5/5 exécutions individuelles réussies).

## 296. Nouveau smoke test dédié — sections 286 à 295

Nouveau fichier `smoke_test_step291_positions_bilan_entreprise_polish.js` couvrant en un seul script
l'ensemble des changements purement d'affichage de ce lot (sections 286 à 295), pour éviter de disperser des
micro-vérifications dans de nombreux petits fichiers séparés : identification de stratégie (Covered
Call/Protective Put/Cash-Secured Put/Naked, section 286), colonne Stratégie + bouton Détail + grecques
déplacées (section 287, en complément de la couverture déjà existante dans `smoke_test_step218_greeks_beta.js`),
format en colonnes des obligations gouvernementales (section 288), format une-jambe-par-ligne des
stratégies d'options (section 289), absence du texte statique de l'enchère de maisons (section 290),
équivalence du Bilan limitée au dernier semestre avec historique complet conservé (section 291), format
`fmtShares()` des positions courtes (section 294), couleur commune des sept boutons de financement/couleur
blanche du reste/couleur verte inchangée de Tour terminé/absence de la description d'entreprise
(section 295). `node -c script_extracted.js` : SYNTAX OK. Suite complète (200 scripts) relancée à 3 reprises
consécutives : **0 échec**.

## 297. Portefeuille — retrait de la précision « (vente à découvert/options écrites) » sur la marge disponible, texte de la répartition sectorielle raccourci

Contexte (deux demandes explicites de l'utilisateur, verbatim, un seul message) :

« Mes positions :
Enleve ça : (vente à découvert/options écrites)
Change ça : "Proportion de la valeur de marché de vos positions boursières longues seulement." Pour ça
"Proportion de vos positions longues" »

Deux changements purement textuels dans Portefeuille, aucun calcul modifié :

**Marge disponible** : la ligne `<tr>` du haut de page affichait « Marge disponible » suivi d'une précision
entre parenthèses en petit texte grisé, « (vente à découvert/options écrites) » — retirée, le libellé
« Marge disponible » suffit désormais seul. Le montant et le ratio affichés à côté (`fmt(availableMargin)
(${marginRatioLabel})`) restent identiques.

**Répartition sectorielle** : le texte descriptif sous le titre de l'accordéon « Répartition sectorielle »
(déjà raccourci une première fois à la section 171) est de nouveau raccourci — « Proportion de la valeur de
marché de vos positions boursières longues seulement. » devient « Proportion de vos positions longues. ».
Le graphique lui-même (`sectorMixHtml`) reste basé sur les positions longues seulement, comme avant — seul
le texte d'accompagnement change.

**Fichiers/fonctions touchés** : `script_extracted.js` — `renderPortefeuille()`, variables
`availableMarginLine` et le texte statique de l'accordéon `pf-secteur`.

**Tests** : `smoke_test_step171_ui_polish_batch.js` et `smoke_test_step58_portefeuille_reorg.js` mis à jour
vers le nouveau texte de la répartition sectorielle (aucune logique de test modifiée, uniquement la chaîne
attendue). Aucun test existant ne vérifiait la précision retirée de « Marge disponible ». `node -c
script_extracted.js` : SYNTAX OK. Suite complète (201 scripts) relancée à 3 reprises consécutives : **0
échec**.

## 298. Plafond d'exposition en calls longs — 15% de company.totalShares, par joueur par entreprise, rejet dur

Contexte (échange en plusieurs messages, tous verbatim) :

« Est-ce qu'on devrait mettre des limites d'achat d'options surtout achat de call long? »

Diagnostic partagé avec l'utilisateur avant toute calibration : `settleOptionExercise` (exercice physique
d'un call long ITM à l'échéance) débite les parts livrées d'une entrée synthétique « BANK » qui peut devenir
négative **sans aucune limite** (comportement voulu, documenté dans son propre commentaire : « peut devenir
négative — voulu, même convention que partout ailleurs [short selling] »). Contrairement à une émission
d'actions volontaire par le CEO (`issueNewShares`), plafonnée à `SHARE_ISSUANCE_CAP_PCT` (10% cumulatif de
`company.totalShares`, voir section 234), l'exercice d'un call long n'avait **aucun plafond de dilution** :
un joueur pouvait accumuler un nombre arbitrairement grand de calls longs sur une seule compagnie et forcer,
à l'exercice, une émission de parts arbitrairement grande.

Calibration discutée puis fixée par l'utilisateur, verbatim :

« 100 contrats c'est basically 100x100x100$ = 1M. On va y allez avec un seul plafond 200 contrats long par
joueur par entreprises. Pour 2M$ d'exposition sur une entreprises considérant un prix à 100$. Pas de plafond
total cumulé tu en penses quoi »

Proposition de traduire ces « 200 contrats au réglage par défaut » en un **pourcentage dynamique** de
`company.totalShares` (plutôt qu'un nombre de contrats figé), pour rester correctement calibré si
`companyTotalShares` est changé à la mise en place de la partie — approuvée par l'utilisateur, qui a ensuite
ajusté le pourcentage et posé les exigences finales, verbatim :

« Ok met le a 15% alors. Et assure toi que l'application bloque si tu dépasse et indique clairement au
joueur les limites et raison »

— confirmé par un dernier message vérifiant le calcul au réglage par défaut (`companyTotalShares` = 200 000) :

« Donc avec parametre normale 300 contrats »

(300 = 15% × 200 000 parts ÷ 100 parts/contrat = 300, confirmé exact.)

**Décision finale.** Un seul plafond, **par joueur par entreprise** (jamais de plafond agrégé tous joueurs
confondus — explicitement écarté par l'utilisateur), exprimé en `OPTION_LONG_CALL_CAP_PCT = 0.15` (15%) de
`company.totalShares`, converti en nombre de contrats via `÷ OPTION_CONTRACT_MULTIPLIER` (100) et arrondi à
l'entier inférieur (`optionLongCallCapContracts(company)`, nouvelle fonction) — même esprit que
`SHARE_ISSUANCE_CAP_PCT`/`shareIssuanceRemainingCap`, mais un plafond **absolu** (pas un solde restant : un
call long ne « libère » jamais de marge par un rachat, contrairement aux parts émises/rachetées — donc pas
de notion de cumul net à suivre côté options).

**Portée du plafond — uniquement les calls LONGS.** Jamais les puts (un put exercé force une VENTE, pas une
émission — aucune dilution possible) ; jamais les positions ÉCRITES/short (déjà protégées par
`enforceMarginCalls`/`requiredMaintenanceMargin`, et un short call assigné livre des parts que le joueur
assigné doit déjà détenir ou vendre à découvert — aucune émission par la banque dans ce sens). Compte à la
fois les calls longs « simples » (`openOptionPosition`) ET la jambe long call d'une stratégie
(`openOptionStrategy`) — les deux partagent la même liste `player.optionPositions` :
- bull spread **ACHETÉ** : jambe long call au strike bas — comptée.
- bull spread **VENDU** : jambe long call au strike haut (l'autre jambe est un short call) — comptée.
- ATM straddle **ACHETÉ** : jambe long call ATM — comptée.
- bear spread (ACHETÉ ou VENDU) : puts uniquement, jamais de jambe call — jamais comptée.
- ATM straddle **VENDU** : jambes courtes (short call + short put) uniquement — jamais comptée.

**Mécanique du rejet.** Rejet **dur** (bloque toute la transaction en bloc, jamais un remplissage partiel ou
une jambe seule) dès que `contrats déjà détenus + contrats demandés > plafond`, avec un message qui indique
explicitement à la fois le plafond numérique (en contrats, plus le calcul en % et en parts) et la raison
(dilution non plafonnée côté banque à l'exercice physique, contrairement à une émission d'actions normale
plafonnée à 10%) :

> « Plafond de calls longs atteint sur {compagnie} — maximum {N} contrat(s) CALL long(s) par joueur (15% de
> {totalShares} parts ÷ 100 parts/contrat), vous en détenez déjà {M}. Cette limite protège contre une
> dilution disproportionnée de l'entreprise : à l'exercice physique d'un call, la banque livre les parts
> sans aucun plafond de son côté (contrairement à une émission d'actions normale, plafonnée à 10%). »

**Fichiers/fonctions touchés** (`script_extracted.js` uniquement) :
- `OPTION_LONG_CALL_CAP_PCT = 0.15` — nouvelle constante, juste après `optionNotional()` (section 145),
  avec un commentaire d'en-tête citant l'échange complet ci-dessus.
- `playerLongCallContracts(player, companyId)` — nouvelle fonction, additionne `pos.shares` de toutes les
  entrées `player.optionPositions` où `type==='call' && side==='long'` pour cette compagnie (simples ET
  jambes de stratégie confondues, aucune distinction de champ nécessaire).
- `optionLongCallCapContracts(company)` — nouvelle fonction, `Math.floor(OPTION_LONG_CALL_CAP_PCT *
  company.totalShares / OPTION_CONTRACT_MULTIPLIER)`.
- `optionLongCallCapErrorMessage(company, capContracts, already)` — nouvelle fonction, message de rejet
  partagé entre les deux points d'appel ci-dessous (même patron que `issueNewShares`).
- `openOptionPosition()` — nouvelle garde juste après le garde-fou delta-zéro existant (section 260), avant
  toute mutation d'état (`optionNotional`/débit-crédit de cash) : ne s'applique que si `type==='call' &&
  side==='long'`.
- `openOptionStrategy()` — même garde, juste après le garde-fou delta-zéro par jambe, avant le calcul de
  `netFlow` : ne s'applique que si `legs.some(l=>l.type==='call' && l.side==='long')` (au moins une jambe
  long call) — si elle se déclenche, la stratégie ENTIÈRE est refusée, aucune des deux jambes n'est créée.

**Tests.** Nouveau fichier dédié `smoke_test_step298_option_long_call_cap.js` couvrant : (A) ouverture
simple jusqu'au plafond (3 contrats à `companyTotalShares:2000` pour ce test) réussit, un contrat de plus
est refusé en bloc avec un message citant le plafond numérique ET la raison (dilution/banque), et le refus
ne crée aucune position partielle ; (B) agrégation position simple + jambe long call de bull spread
acheté + jambe long call de bull spread vendu = 3/3, un ATM straddle acheté de plus (dépasserait) est
refusé EN BLOC (aucune des deux jambes créée) ; (C) le plafond ne s'applique JAMAIS aux puts (long/short),
aux calls écrits, au bear spread, ni au straddle vendu (tous testés à 10 contrats, largement au-dessus du
plafond de calls, tous réussissent) ; (D) portée PAR JOUEUR PAR ENTREPRISE — un second joueur dispose de son
propre plafond de 3 contrats sur la même compagnie, indépendamment du premier joueur déjà à 3/3 ; (E) le
plafond suit dynamiquement `company.totalShares` — une compagnie à 6 000 parts a un plafond de 9 contrats,
pas 3.

Huit fichiers de smoke tests **pré-existants** ouvraient des calls longs en nombre supérieur au nouveau
plafond par défaut de leur partie de test (la plupart utilisent `companyTotalShares:1000`, choisi pour
d'autres raisons, à une époque où ce plafond n'existait pas encore — 15% de 1000 ÷ 100 = 1 seul contrat) :
`smoke_test_step51_trading_phase4_options.js`, `smoke_test_step178_last_resort_loan_and_gameend.js`,
`smoke_test_step218_greeks_beta.js`, `smoke_test_step235_option_strategies.js`,
`smoke_test_step260_options_audit_fixes.js`, `smoke_test_step261_portfolio_audit_fixes.js`,
`smoke_test_step291_positions_bilan_entreprise_polish.js`, `smoke_test_step54_phase2_rythme_marche.js`.
Correction chirurgicale identique dans chacun : `company.totalShares`/`company.sharesIssued` relevés au
réglage par défaut de production (200 000) juste après la fondation de chaque compagnie concernée
(`sharesIssued` suit `totalShares` pour que l'IPO reste considérée terminée — voir
`companyPendingIpoShares`), sauf le scénario (E3) de `smoke_test_step260_options_audit_fixes.js` qui ouvre
volontairement 9000 contrats pour un test de marge à taille extrême — relevé à 6 000 000 pour couvrir
précisément ce besoin. Vérifié par grep dans chacun de ces huit fichiers qu'aucune assertion ne dépend de la
valeur littérale de `totalShares`/`sharesIssued` — aucune logique de test modifiée, uniquement les données
de mise en place. `node -c script_extracted.js` : SYNTAX OK. Suite complète (202 scripts, +1 nouveau)
relancée à 3 reprises consécutives : **0 échec**.

## 299. Spirale de détresse — seuil d'endettement relevé de 15% à 50%

Contexte : à la demande de l'utilisateur (« Spirale de détresse c'est 15% du ratio dette/actif? »),
confirmation du calcul exact de `companyDebtRatio` (dette ÷ actif brut, où l'actif brut = encaisse +
valeur immobilière + valeur ETF + créances — la dette s'annule algébriquement dans
`companyValue(company) + companyDebt(company)`). Discussion ensuite sur le seuil lui-même (« Est-ce que 15%
c'est trop bas selon toi? ») : jugé bas EN ISOLATION — une simple hypothèque standard (LTV 50% du prix de
base d'un terrain) suffit déjà, à elle seule, à franchir 15% de l'actif brut d'une compagnie fraîchement
fondée (capital de départ 20 M$ par défaut), sans rien d'imprudent — même si la garde combinée (marge nette
négative CE semestre, seule ET simultanément requise pour déclencher la spirale) en atténuait la portée en
pratique. Décision de l'utilisateur, verbatim : « Augmente le à 50% ».

**Changement.** `STOCK_DISTRESS_DEBT_THRESHOLD` : 0.15 → **0.50**. Seule cette constante est touchée — la
condition reste structurellement identique (`companyDebtRatio(co) > STOCK_DISTRESS_DEBT_THRESHOLD &&
netMargin < 0`, réévaluée chaque semestre pour chaque compagnie active), tout comme les quantités injectées
(`STOCK_DISTRESS_INJECT_MIN/MAX` = 3–5 en dette « mauvaise », 1–2 en dette « productive » — voir section 162)
et la table de mouvement renforcée (`STOCK_DISTRESS_MOVE_DIST`) appliquée tant que `co.distressActive` est
vrai. La spirale exige désormais qu'au moins la MOITIÉ de l'actif brut d'une compagnie soit financée par la
dette — plus un simple emprunt ponctuel, un vrai surendettement — en plus d'un semestre déficitaire, avant de
se déclencher.

**Fichiers/fonctions touchés** : `script_extracted.js` uniquement — la constante `STOCK_DISTRESS_DEBT_THRESHOLD`
(section 160, juste au-dessus de `STOCK_DISTRESS_INJECT_MIN/MAX`), aucune autre ligne de code.

**Tests.** Aucun fichier de smoke test n'était couplé à la valeur littérale 0.15 (vérifié par grep dans
tout le dépôt) — aucune modification de test nécessaire. `node -c script_extracted.js` : SYNTAX OK. Suite
complète (202 scripts) relancée à 3 reprises consécutives : **0 échec** (une occurrence isolée d'échec de
`smoke_test_step193_stock_cube_floor.js` sur la 2e passe, test préexistant à tirages aléatoires non seedés —
section 160, sans lien avec ce changement — re-vérifiée indépendamment comme non reproductible : 5/5
exécutions individuelles réussies).

## 300. Spirale de détresse — seuil d'endettement transformé en réglage de partie modifiable

Contexte : à la suite de la section 299 (seuil relevé de 15% à 50%, en dur), demande explicite de
l'utilisateur, verbatim : « Fait en sorte que le ratio dette pour la spirale soit dans les paramètres
modifiables au lieu d'une valeur fixe a 50% ».

**Changement.** L'ancienne constante globale `STOCK_DISTRESS_DEBT_THRESHOLD` (0.50, fixée en dur — section
299) est **retirée** au profit d'un nouveau réglage de partie, `distressDebtThreshold`, suivant exactement
la même convention que les autres réglages de risque d'endettement déjà exposés (`mortgageLTV`,
`mortgageRate`, `debtSpreadFactor`) :

- `DEFAULT_SETTINGS.distressDebtThreshold = 0.5` (même valeur que l'ancien seuil fixe, pour qu'une partie
  créée sans réglage explicite conserve exactement le comportement de la section 299) — `DEFAULT_SETTINGS`
  reste l'unique source de vérité (section 185), injectée automatiquement dans `mergedSettings` de
  `createGame()` via `Object.assign({}, DEFAULT_SETTINGS, ..., settings||{})`.
- `migrateState()` : nouvelle ligne `if(s.settings.distressDebtThreshold===undefined) s.settings.distressDebtThreshold
  = DEFAULT_SETTINGS.distressDebtThreshold;` — une partie déjà en cours, sauvegardée avant cette section,
  reçoit le défaut 0.5 (comportement inchangé), jamais `undefined`.
- Formulaire de création de partie : nouveau champ « Seuil d'endettement (dette/actif brut) déclenchant la
  spirale de détresse boursière (combiné à une marge nette négative le même semestre) » (`setupDistressThreshold`,
  défaut affiché 50%), ajouté dans la sous-section « Hypothèques & risque d'endettement » — juste après le
  champ « Prime de risque max selon l'endettement » (`setupDebtSpread`) — et câblé dans le même bloc de
  construction de `settings` que les autres champs de cette sous-section (conversion points de pourcentage
  → fraction 0-1, même motif que `mortgageLTV`/`mortgageRate`).
- Point d'usage (advanceGameClock, groupe B — section 160) : `companyDebtRatio(co) > STOCK_DISTRESS_DEBT_THRESHOLD`
  devient `companyDebtRatio(co) > state.settings.distressDebtThreshold`. Condition structurellement
  identique par ailleurs (toujours combinée à `netMargin < 0` du même semestre), tout comme les quantités
  injectées et la table de mouvement renforcée (section 299, inchangées).

**Fichiers/fonctions touchés** : `script_extracted.js` uniquement — `DEFAULT_SETTINGS` (nouvelle entrée),
`migrateState()` (nouvelle ligne de défaut différé), le formulaire de création de partie (nouveau champ
HTML + son câblage dans la construction de l'objet `settings`), et le point d'usage unique dans
`advanceGameClock()`. La constante `STOCK_DISTRESS_DEBT_THRESHOLD` elle-même est supprimée (plus aucune
référence dans le code).

**Tests.** Nouveau fichier dédié `smoke_test_step300_distress_threshold_setting.js` (6 sous-tests) :
(A) `DEFAULT_SETTINGS.distressDebtThreshold` vaut bien 0.5 : (F) l'ancienne constante globale n'existe plus
dans le code ; (B) une partie créée sans réglage explicite reçoit bien le défaut 0.5 dans
`state.settings` ; (C) seuil personnalisé ABAISSÉ à 20% : une compagnie à ratio d'endettement 0.3 (qui
n'aurait PAS déclenché la spirale sous l'ancien seuil fixe 50%) déclenche bien `distressActive=true` sous
ce réglage plus bas ; (D) seuil personnalisé RELEVÉ à 80% : une compagnie à ratio d'endettement 0.6 (qui
AURAIT déclenché la spirale sous l'ancien seuil fixe 50%) NE déclenche PAS la spirale sous ce réglage plus
haut — la configurabilité est vérifiée dans les DEUX sens, pas seulement à la hausse ; (E) `migrateState()`
sur une ancienne sauvegarde sans ce champ pose bien le défaut 0.5. `node -c script_extracted.js` : SYNTAX
OK. Suite complète (203 scripts, +1 nouveau) relancée à 3 reprises consécutives : **0 échec**.

