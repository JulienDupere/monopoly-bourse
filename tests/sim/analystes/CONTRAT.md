# Banc de mesure « trois analystes » : contrat

Mesure hors du jeu, demandée par Julien le 2026-11-16 avant toute construction. Ce dossier ne contient que des
outils de mesure : rien ici n'est chargé par `index.html` ni lancé par `node tests/run-all.js` (qui ne prend que
`tests/*.test.js`).

## Règles du dossier

- Ne créer des fichiers que dans `tests/sim/analystes/`. Ne modifier ni `index.html` ni aucun autre fichier.
- Le moteur est chargé par `tests/helpers/engine.js` (`loadEngine`, option `globals` pour un `Math` à hasard
  semé, donc des résultats reproductibles). Aucun accès Firebase, aucun réseau.
- Les règles du jeu ne sont jamais réécrites : loyers, taxes, GO, enquête de l'AMF et intérêts viennent des
  fonctions du moteur (`corePerformDiceRoll`, `corePerformNeutralPawnRoll`, `settlePropertyRent`,
  `settleNeutralPawnRent`, `payTax`, `applyPassGoEffect`, `advanceGameClock`, `incomeStatementFor`).
- Les analystes, la cible, la zone et le pari sont des prototypes écrits ici, selon les formules ci-dessous.

## Vocabulaire

- Semestre `s` : les lancers `3s`, `3s+1`, `3s+2`. Début de semestre : `rollCount % 3 === 0`.
- `R` : bénéfice officiel du semestre, `incomeStatementFor(co.id, s).netIncome`, tout compris.
- Visiteurs d'une entreprise `c` : les pions des autres entreprises actives et les pions neutres.
- `n_v` : nombre de lancers qu'un pion fera dans le semestre (3, moins les tours d'enquête qui lui restent).

## Les trois analystes (chiffres publiés au début du semestre)

### H, l'historien

`companyExpectedNetIncome(co, s).expected`, sans changement : 0 au 1er semestre, 2 au 2e, puis moyenne des 2,
puis des 3 derniers semestres clos.

### M, le modélisateur

Il regarde le parc tel qu'il est au début du semestre. Il utilise la probabilité moyenne de chaque case
(`p.prob`), pas la position des pions, sauf pour la subvention.

    M = S + E_recus − E_payes − E_taxes − I

- `S` (subvention) : `2 × q`, où `q` est la probabilité exacte que le pion de `c` passe par GO dans ses `n_c`
  lancers, depuis sa position réelle (convolution des dés, case 30 qui renvoie en 10). `S = 0` si
  `goAdvancesOwed > 0` (le passage rembourse une avance).
- `E_recus = Σ_p Σ_v n_v × π_p × a(c, p, v)`, où `π_p = p.prob` et `a(c, p, v)` est ce que `c` inscrit en revenu
  quand le visiteur `v` s'arrête sur `p` (parts de copropriété, hypothèque, enquête, parts réservées aux REIT :
  montant pris de la logique du moteur, pas recalculé à la main ; services : total des dés attendu de 7).
- `E_payes = n_c × Σ_q π_q × b(c, q)`, où `b(c, q)` est ce que `c` inscrit en dépense en s'arrêtant sur `q`.
- `E_taxes = n_c × Σ_cases de taxe π × montant` (probabilité de la case mesurée si elle n'a pas de `prob`).
- `I` : les intérêts et autres charges que le moteur prélève seul pendant 3 lancers, dette inchangée.

Irrégularité prévue (écart type), arrivées traitées comme indépendantes :

    σ_M² = Σ_p Σ_v n_v π_p (1 − π_p) a² + n_c Σ_q π_q (1 − π_q) b² + (même terme pour les taxes) + 4 q (1 − q)

À vérifier d'abord : `p.prob` contre la fréquence simulée d'arrivée par case et par lancer. Si l'écart relatif
dépasse 10 % sur des cases qui comptent, le signaler et mesurer aussi avec la fréquence simulée.

### K, le marché

`cap_c = stockPrice × totalShares`. Deux candidats, à mesurer tous les deux :

- `K1 = cap_c × y1`, avec `y1 = 3 × (r − g) / (1 + g)` (taux `discountRate` et `growthRate` des réglages, ceux
  de `intrinsicValue`).
- `K2 = cap_c × (Σ_j M_j / Σ_j cap_j)` sur les entreprises actives : le marché exige de chacun le rendement
  moyen du marché. Variante par type : `K2 × f`, `f` dans {0,6 ; 0,8 ; 1} pour une Croissance.

## Cible, zone, verdict

- Cible `T` = médiane de `H`, `M`, `K`.
- Zone : demi-largeur `z = max(plancher, k × σ_M)`. À balayer : `k` dans {0,25 ; 0,5 ; 0,75 ; 1}, plancher dans
  {0,25 ; 0,5 ; 1} M$.
- `|R − T| ≤ z` : dans la zone, aucun effet.
- Sinon `b` = nombre d'analystes strictement battus (`R > X`). Au-dessus de la zone : `b = 3` fort positif,
  `b = 2` normal positif. En dessous : `b = 0` fort négatif, `b = 1` normal négatif.
- Référence : l'ancien verdict, `netIncomeExpectationTier(is, expectation)`.

## Pari du PDG

Annoncé au début du semestre. Avertissement : coût immédiat, résultat sous la zone adouci d'un cran (fort →
normal → rien). Promesse : gain immédiat, résultat sous la zone aggravé d'un cran. Le banc ne fixe pas les
tailles : il donne les fréquences (sous la zone en normal, sous la zone en fort) qui permettent de calculer le
gain moyen pour n'importe quelle taille.

Information du PDG : le joueur voit la position des pions, l'analyste non. Calculer au début du semestre un
modèle « avec positions » `M'` (mêmes formules, probabilités exactes depuis les positions réelles). Classer
les semestres en trois tiers selon `M' − M` et donner les fréquences du verdict dans chaque tiers.

## Situations

Tables : 8 entreprises + 3 pions neutres (référence), 6 + 5, 4 + 7, et 4 + 0 (contraste).
Phases, posées par manipulation de l'état (propriétaires, maisons, hypothèques) :

- début : semestres 1 et 2 d'une partie neuve (pions à GO, quelques terrains, aucune maison) ;
- milieu : environ 3 terrains par entreprise, quelques groupes complets avec 1 ou 2 maisons, quelques hypothèques ;
- fin : plusieurs groupes à 3, 4 ou 5 maisons, des entreprises à terrains épars, une entreprise très endettée.

Profils à suivre dans chaque table : entreprise concentrée (un groupe chargé), entreprise diversifiée (petits
terrains, aéroports, services), entreprise endettée. Les quatre types (Dividende, GARP, Croissance aux deux
niveaux, Momentum) sont répartis entre les entreprises.

Pour chaque situation : des suites de 4 semestres depuis le même état de départ (positions des pions tirées au
hasard, sauf au début). Le verdict porte sur le 4e, H vient des 3 premiers. Variante « transition » : des
maisons sont ajoutées juste avant le 4e semestre (H en retard, M à jour).

## Mesures demandées

1. Justesse du modélisateur : `M` et `σ_M` contre la moyenne et l'écart type simulés de `R`, par profil et phase.
2. Fréquences du verdict (dans la zone, normal ±, fort ±) pour chaque `k` et chaque plancher, par profil, phase
   et table ; même tableau pour l'ancien verdict.
3. Analyste marché : fréquence à laquelle `K1` et `K2` sont battus, écart `K / M`, sensibilité quand le cours
   s'écarte de ± 30 %.
4. Pari du PDG : fréquences sous la zone, en tout et par tiers d'information.
5. Poids d'un effet, par type d'entreprise : effet moyen sur le cours de +1, +3, +7 cubes rouges ou verts au
   fondamental après 1 et 2 semestres, bruit de fond, et dérive par semestre de chacune des 9 cases de
   `CROISSANCE_TYPE_MATRIX`. Reproduire d'abord la mesure connue (GARP, sac 10/10/8, 1 cube rouge = −0,3 %,
   3 = −1,1 %, 7 = −2,8 %, bruit ± 6,5 % sur un semestre).
6. Type Croissance : fréquence de bon / neutre / mauvais sur l'axe des analystes avec la règle actuelle
   (`croissanceAnalystAxis`, ± 5 % du chiffre d'affaires contre H), avec le passage (a) (hors zone = bon ou
   mauvais) et le passage (b) (seul un 3-0 compte) ; dérive moyenne du cours qui en résulte.
7. Pions neutres : pour chaque table, bénéfice moyen par entreprise et par semestre, part venant des pions
   neutres (argent neuf) et part venant des autres entreprises, irrégularité des revenus. Confirmer qui paie
   le loyer d'un pion neutre.

## Sorties

- `node tests/sim/analystes/mesures.js` affiche les tableaux et écrit `resultats.json` et `resultats.txt` ici.
- Un cas simple calculé à la main (une entreprise, un terrain, un visiteur) doit donner le même chiffre par le
  calcul, par le modélisateur et par la simulation ; il est gardé comme vérification au début du script.

## Ronde 2 (2026-11-16, après la relecture)

La relecture confirme la mécanique du banc (ordre d'un lancer, M, M', σ, K, médiane, zone, comptage) mais montre
que l'agrégat de la ronde 1 ne doit pas servir aux décisions : le début y pèse 50 %, le 2e semestre (H = 2) fait
80 % de l'asymétrie fort− / fort+, le parc figé rend H ≈ M, et profil, type et dette sont confondus.
Julien a aussi précisé deux choses : les cubes créent des tendances (il faut juger sur plusieurs semestres, pas
sur le semestre immédiat ; pas de gros paquets de cubes, pas de saut direct du cours), et sa règle pour les pions
neutres est 2-3 joueurs = 1, 4-7 = 2, 8 et plus = 3.

### Corrections de méthode

1. Verdicts publiés par phase : 1er semestre, 2e semestre, milieu, fin, transition, chacun à part. L'agrégat
   « partie type » ne mêle que milieu + fin (base de décision) ; les deux premiers semestres restent à part.
2. Parc vivant : des situations où plusieurs entreprises achètent ou bâtissent à chaque semestre de la suite
   (pas seulement juste avant le 4e), puis les fréquences du 2-1 et du 3-0.
3. Juger aussi le 3e semestre de la suite (sans fin d'année), en plus du 4e.
4. Types tournés sur chaque profil (chaque type passe par chaque profil), pour séparer type, profil et dette.
5. Entreprise endettée : une variante avec une encaisse suffisante pour payer ses intérêts ; les tableaux de
   décision écartent les suites avec saisie, et disent combien sont écartées.
6. Le script vérifie lui-même que son tour de dés égale `performRollForAllCompanies` (rendu neutralisé, car
   `render()` consomme du hasard). Services : vrai total des dés dans M'. Médianes de K / M sans les M négatifs.
   Tiers d'information donnés par phase (ils sont inertes au 1er semestre). Mesure 6 sur les mêmes populations
   pour la règle actuelle et pour (a) et (b).

### Variantes à mesurer

- Historien au début : (H0) 0 puis 2 comme aujourd'hui ; (H1) il s'abstient aux deux premiers semestres (cible =
  milieu de M et K, 2 battus = fort, 1 battu = normal).
- Marché : K2 tel quel ; K3 = M + max(|M|, 0,5) × (ρ − 1), où ρ est la performance du cours de l'entreprise sur
  ses 6 derniers lancers divisée par la moyenne de la même performance sur les entreprises actives (le marché
  part du chiffre du modélisateur et le corrige selon la course récente de l'action).
- Référence symétrique : M' pris comme cible unique.
- Modélisateur : avec `p.prob` et avec les fréquences exactes du plateau (les deux, côte à côte).

### Mesures nouvelles

8. Tendances (par type, tirages purs) : cours typique (médiane) et bruit après 1, 2, 3, 4 et 6 semestres, pour
   une injection unique de 3, 5, 7 cubes et pour une injection répétée à chaque semestre de 2, 3, 5 cubes, en
   rouge et en vert. Repère déjà mesuré (GARP, 10/10/8, net du cas sans cube) : 3 rouges une fois ≈ −2 % au
   total ; 3 rouges par semestre ≈ −12 % après 6 semestres ; 5 par semestre ≈ −22 % ; bruit 15,9 % à 6 semestres.
9. Dérive du marché sous le nouveau verdict : une entreprise reçoit à chaque semestre, pendant 10 semestres, un
   verdict tiré selon les fréquences mesurées (milieu + fin, sans saisie) ; tailles candidates en cubes au
   fondamental : (normal 3, fort 5), (normal 3, fort 6), (normal 2, fort 5). Donner la dérive moyenne et la
   dispersion, et la même chose avec l'ancien verdict (paliers 1-2, 3-5, 6-8 aux fréquences mesurées).
10. Pari du PDG en cubes : avec les effets de la mesure 8, valeur moyenne d'un avertissement (1 cube rouge au
    départ, résultat sous la zone adouci d'un cran) et d'une promesse (1 cube vert au départ, résultat sous la
    zone aggravé d'un cran), en % du cours sur 4 semestres, en tout et par tiers d'information (milieu + fin).
11. Pions neutres selon la règle de Julien : tables 2 + 1, 3 + 1, 4 + 2, 6 + 2, 7 + 2, 8 + 3, avec le MÊME parc
    total réparti également entre les entreprises (tout le plateau possédé, mêmes maisons au total). Bénéfice
    moyen par entreprise et par semestre, part venant des pions neutres, écart type, par phase.
