# Section 324 — analystes : zone resserrée, annonce du PDG, graphique et fenêtres « Détails »

Demandes de Julien du 2026-11-17, après la mise en production de la section 323 :

1. « Annonce du PDG je veux qu'elle soit dans le Pop-up du résumé de tour » ; puis, sur l'encadré de l'onglet
   Entreprise : « Enlever au premier tour on ne va pas faire de prédictions PDG ».
2. « Je pensais qu'on avait dit que la zone était +- 350K » ; puis, après la mesure : « Pour le multiple je comprend
   ton point utilise 0.25 alors ».
3. « Je veux voir les autres analystes sur le graphiques ».
4. « Toutes les données en chiffre j'aimerais avoir un lien "Details" sur le graphique dans un coin qui fait un pop-up
   avec les informations complète ».
5. « Dans la page pour les joueurs pour analyser les compagnies j'aimerais avoir la aussi un bouton details. Ce bouton
   donnerai un pop-up qui montrerait les graph de toutes les entreprises une en dessous de l'autre sur l'ensemble des
   semestres avec les points des analyste les zone et leur résultats pour analyser le tout ».

## A. Règles (déjà posées dans `index.html` par la session principale)

- **Zone** : `ANALYST_ZONE_K = 0.25`, `ANALYST_ZONE_FLOOR = 0.35`. Zone = cible ± max(0,35 M$ ; 0,25 × σ).
  Mesure d'appoint (34 500 semestres par réglage, mêmes suites que `mesures323b.js`) : 23,1 % des semestres dans la
  zone (31,5 % avant), demi-largeur moyenne 0,92 M$ (1,29 M$ avant).
- **Annonce du PDG** : aucune annonce au premier semestre de la partie (`CEO_CALL_FIRST_SEMESTER = 1`, refus dans
  `ceoCallRefusal` quand `analystCurrentSemester() < CEO_CALL_FIRST_SEMESTER`, donc aussi dans l'action synchronisée).
  L'encadré (`ceoCallBoxHtml`) n'existe plus que dans la fenêtre « Résultats du tour » (place `'pop'`) du lancer qui
  clôt un semestre ; il est retiré de l'onglet Entreprise (plus de place `'ent'`, plus de `bindCeoCallBox('ent', …)`).
  L'annonce faite reste visible de tous dans le bloc « Attentes des analystes » (`ceoCallPublicLineHtml`).
  La fenêtre se rouvre par le bouton « revoir le dernier tour » (`reviewLastTurnSummary`). Après la revue : le PDG
  qui peut encore annoncer voit dans ce bloc une ligne d'indication (`ceoCallHintHtml`, `data-ceo-call-hint`) qui le
  renvoie à ce bouton — jamais de bouton d'annonce dans l'onglet.
- Après l'essai à l'écran : fenêtres à `max-width:1240px` (douze colonnes sans défiler), colonnes du mode compact de
  largeur adaptative `clamp(64, floor(980 / n), 112)`, boutons « Détails » et « Fermer » en `data-free-click`.

## B. Affichage (à construire)

Rien du moteur ne change. Tout se lit dans `co.analystHistory` (une ligne par semestre jugé :
`{semester, h, m, k, target, zone, actual, judged, adjust, verdict, beaten, of, color, qty, call, callEffect}` ;
`h`, `m` ou `k` valent `null` pour un analyste absent) et, pour le semestre en cours, dans `analystForecastFor(co)`
(`{h, m, k, target, zone, frozen, verdictPossible, parts, …}`). Aucun nouveau champ d'état.

### B1. Les trois analystes sur le graphique (`expectationVsActualChartHtml`)

- Par colonne (semestre jugé, ou semestre en cours avec chiffres), une marque par analyste présent, à la hauteur de
  son chiffre : **historien = losange, modélisateur = triangle, marché = carré**. Couleurs fixes, jamais le vert ni le
  rouge (réservés au verdict) : historien `#2563eb`, modélisateur `#7c3aed`, marché `#d97706`. Constante unique
  `ANALYST_MARKS` (clé, nom affiché, forme, couleur), lue par le graphique, la légende et les tableaux.
- Les trois marques sont dans la moitié gauche de la colonne, côte à côte ; le point du bénéfice (jugé, et officiel
  s'il diffère) passe dans la moitié droite : aucune superposition même si les quatre chiffres sont égaux.
- Chaque marque porte un `<title>` (« Historien : +2,77 M$ ») et un attribut `data-analyst="h|m|k"`.
- L'échelle verticale tient compte des chiffres des analystes (un analyste hors de la zone ne sort pas du cadre).
- Légende complétée : zone, cible, les trois analystes, bénéfice (jugé / officiel comme aujourd'hui).
- Semestre en cours : marques dessinées comme les autres (chiffres provisoires ou publiés), pas de point de résultat.

### B2. Lien « Détails » et fenêtre des chiffres (une entreprise)

- Un lien « Détails » (bouton `btn btn-sm`, identifiant `analystDetailsBtn-<id entreprise>`) dans le coin supérieur
  droit du graphique. Il ouvre la fenêtre `openAnalystDetailsModal(companyId)`.
- Le tableau aujourd'hui sous le graphique (Semestre / Cible / Zone acceptable / Réel / Verdict) **quitte la page** :
  il vit dans la fenêtre, complété. Sous le graphique il ne reste rien d'autre que le graphique.
- Fenêtre « 📊 Analystes — {entreprise} : tous les chiffres », large (même procédé que les autres fenêtres larges :
  `<style>.modal{max-width:960px;}</style>` dans le contenu), tableau défilant de côté, un bouton « Fermer ».
  Une ligne par semestre de `co.analystHistory` (TOUS, pas seulement la période choisie à l'écran), du plus ancien au
  plus récent, puis le semestre en cours s'il a des chiffres. Colonnes :
  Semestre | Historien | Modélisateur | Marché | Cible | Zone acceptable | Bénéfice officiel | Bénéfice jugé |
  Verdict | Analystes battus | Cubes | Annonce du PDG.
  - analyste absent : « absent » ; semestre en cours : résultat, verdict, battus et cubes en « – », et la mention
    « en cours (chiffres provisoires) » ou « en cours (chiffres publiés) » ;
  - « Bénéfice jugé » = `analystJudgedOf(e)`, avec la note de `analystJudgedNote(e)` quand il diffère de l'officiel ;
  - « Cubes » = `analystCubesText(e)` ; « Annonce du PDG » = le libellé (`CEO_CALL_LABELS`) et `analystCallText(e)`,
    « – » sans annonce ; pour le semestre en cours, l'annonce de `ceoCallFor(co, analystCurrentSemester())` ;
  - sous le tableau, pour le semestre en cours, le détail du modélisateur (subvention, loyers reçus et payés, taxes,
    intérêts et charges), repris du bloc « Attentes des analystes » par une fonction commune, pas recopié.
- Le tableau est fabriqué par une fonction réutilisable `analystDetailsTableHtml(co)` (aussi utilisée en B3).

### B3. Bouton « Détails » de la page d'analyse et fenêtre « toutes les entreprises »

- Dans Portefeuille › « États financiers par entreprise » (`renderPortefeuilleFinancials`), juste après « État des
  résultats » : un titre de section « Attentes des analystes », une ligne d'explication courte, et un bouton
  « Détails » (identifiant `pfAnalystDetailsBtn`) qui ouvre `openAnalystOverviewModal()`.
- Fenêtre « 📊 Analystes — toutes les entreprises », large (`max-width:1100px`), bouton « Fermer ». En tête, une seule
  légende commune. Puis, pour chaque entreprise de `activeCompanies()`, l'une sous l'autre :
  - son nom et son type ;
  - son graphique sur **tous les semestres** (`financialPeriods()` en entier, pas la période choisie), en mode
    compact : colonnes étroites (une douzaine de semestres visibles sans défiler dans 1100 px, défilement de côté
    au-delà), libellés courts sur deux lignes (« An 1 » / « S1 »), sous chaque colonne un signe court du verdict
    (▲▲ fort au-dessus, ▲ normal au-dessus, = dans la zone, ▼ normal dessous, ▼▼ fort dessous, rien sans verdict),
    de la couleur du verdict ; mêmes marques d'analystes, zone, cible et point du résultat que B1 ;
  - échelle verticale propre à chaque entreprise ;
  - un volet repliable (`<details><summary>Chiffres</summary>…</details>`) avec `analystDetailsTableHtml(co)` (la
    fenêtre du jeu est unique : pas de fenêtre ouverte depuis une fenêtre).
  - entreprise sans aucun semestre jugé ni chiffres en cours : « Pas encore de semestre jugé par les analystes. »
- Le mode compact est une option du même `expectationVsActualChartHtml(company, periods, opts)` (pas une copie) :
  `opts = {compact, detailsButton}` ; sans `opts`, le graphique de l'onglet Entreprise (colonnes larges, lien Détails).

### B4. Garde-fous

- Tout texte venant de l'état passe par `esc`. Aucune écriture dans l'état, aucune action synchronisée : ce lot ne
  fait qu'afficher.
- Partie d'avant la section 323 (aucun historique), analyste absent, semestre sans verdict, 40 semestres
  d'historique, 8 entreprises, partie terminée (`state.gameEndedReason` : pas de semestre « en cours ») : rien ne
  plante et rien n'est inventé.
- Les identifiants des boutons sont uniques dans la page ; le lien « Détails » est rebranché à chaque rendu (là où
  l'onglet Entreprise et le Portefeuille branchent déjà leurs boutons).

## C. Tests

- `tests/section323.test.js`, `tests/section323-pari.test.js` : adaptés aux règles A (zone, premier semestre), avec
  les versions cassées exprès correspondantes.
- `tests/section323-affichage.test.js`, `tests/section323-pari-affichage.test.js` : adaptés (tableau déplacé dans la
  fenêtre, encadré retiré de l'onglet Entreprise, nouvelles valeurs de zone).
- `tests/section324-affichage.test.js` : B1 à B4, avec versions cassées exprès.
- `node tests/run-all.js` vert.
