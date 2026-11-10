# Plan de mise à jour des cahiers — sections 307 à 317 (2026-10-25)

Mise à jour des neuf cahiers de formation et de l'aide-mémoire après la série de corrections du moteur
(sections 307 à 317, en production depuis le 2026-10-25). Ni les PDF ni le dépôt ne sont modifiés ici : ce plan
décrit ce que les agents Sonnet appliqueront, puis ce que le réviseur Opus vérifiera.

## 0. Fichiers produits

Dossier de travail : `C:\Users\Julien\AppData\Local\Temp\claude\C--Users-Julien-Desktop-Application-CLAUDE-Monopoly-Finance\b61bd93d-d303-4b52-aa72-8d6d4e7c4e7c\scratchpad\cahiers-travail\`
(noté `…\cahiers-travail\` plus bas).

| Fichier | Contenu |
|---|---|
| `…\cahiers-travail\corrections.json` | 32 corrections en place, 8 cahiers (aucune pour le cahier 1). Format demandé : `{"Cahier_N.pdf": [{page, ancien, nouveau, section, raison}]}`. |
| `…\cahiers-travail\maj-Cahier_0.html` … `maj-Cahier_8.html`, `maj-Cahier_7-1.html`, `maj-Cahier_7-2.html` | 10 pages « Mise à jour » (une par cahier, deux pour le cahier 7), remplies à partir du gabarit. Toutes vérifiées : 1 page, dernier encadré au-dessus de y = 718 pt. |
| `…\cahiers-travail\Aide_memoire.html` | Aide-mémoire modifié (22 remplacements de la section 7 ci-dessous), imprimé en exactement 5 pages. |
| `…\cahiers-travail\aide-remplacements.json` | Les 22 remplacements de l'aide-mémoire, sous forme exacte (même contenu que la section 7). |
| `…\cahiers-travail\outils\verifie.py` | Contrôle de `corrections.json` : `ancien` unique sur la page (lignes jointes par une espace), estimation du nombre de lignes avec les métriques Helvetica (≈ Arial). `python -I outils\verifie.py corrections.json` |
| `…\cahiers-travail\outils\gras.py` | Mots en gras dans chaque `ancien` (pour reporter le gras dans `nouveau`). |
| `…\cahiers-travail\outils\genere.py`, `contenu\*.html` | Régénère les pages `maj-*.html` depuis `contenu\` et le gabarit, imprime avec Chrome et mesure (1 page, bas du dernier encadré). Ajoute les espaces insécables avant ; : % » M$ K$ $ et après «. |
| `…\cahiers-travail\outils\aide.py` | Enveloppe et imprime un `Aide_memoire.html`, compte les pages et la marge au-dessus du pied de chaque fiche. |
| `…\cahiers-travail\rendus\` | PDF et PNG de contrôle (pages de mise à jour, aide-mémoire modifié, zones des PDF d'origine). |

### Consignes pour les agents qui appliquent

1. **Corrections en place** : appliquer `corrections.json` tel quel. Le gras d'origine contenu dans `ancien` est reporté
   avec `**…**` dans `nouveau` (vérifié par `outils\gras.py`). Toutes les corrections gardent le même nombre de lignes
   que le paragraphe d'origine (simulation Helvetica), sauf indication contraire ci-dessous ; la plupart sont dans des
   encadrés dont le fond ne laisse aucune ligne de plus.
2. **Paragraphes serrés** (deux paragraphes sans espace entre eux) : cahier 3 p. 16 (premier encadré : « L'outil ouvre… »
   puis « Sur notre bull spread… »), cahier 7 p. 31 (liste 1. 2. 3. puis « Le prêt de dernier recours… »), cahier 8 p. 4
   (« Les terrains du panier… » puis « En revanche… »). L'outil doit garder ces retours à la ligne ; les textes de
   remplacement sont de longueur égale ou inférieure, donc même une fusion ne déborderait pas.
3. **Pages de mise à jour** : imprimer chaque `maj-*.html` (Chrome sans interface, format Lettre) et l'ajouter à la fin du
   cahier correspondant ; pour le cahier 7, `maj-Cahier_7-1.html` (p. 38) puis `maj-Cahier_7-2.html` (p. 39).
4. **Aide-mémoire** : appliquer les 22 remplacements de la section 7 à `docs/cahiers/Aide_memoire.html` (ou recopier
   `…\cahiers-travail\Aide_memoire.html`, identique), envelopper, imprimer, vérifier 5 pages (`outils\aide.py` : marge
   au-dessus du pied ≥ 31 pt sur chaque fiche).
5. Mettre à jour `docs/cahiers/README.md` (section 8). Le CLAUDE.md du projet mentionne encore « mises à jour en
   attente : rubriques Changements visibles des sections 307 à 317 » : à retirer une fois les PDF régénérés.

---

## 1. Cahier 0 — Les règles du jeu (13 → 14 pages)

**(A) Corrections en place (1)**

| Page | Avant → après | Section |
|---|---|---|
| 13 | « 3 — le nombre maximum de copropriétaires sur un même terrain. » → « … à l'achat d'un terrain. » | 309 |

Vérifié, pas de correction : p. 6 « Un terrain accepte au maximum trois copropriétaires à l'acquisition » (exact) ; p. 7
encadré sur l'encaisse négative (toujours vrai pour l'entreprise ; l'encaisse personnelle est ajoutée en (B)) ; p. 8
« chaque copropriétaire paie sa part de chaque maison » (vrai ; la part de la banque est en (B) du cahier 5) ; p. 12
« vente de parts… sous forme d'offre que l'autre accepte » (devenu exact avec la section 309).

**(B) Page « Mise à jour » p. 14** — `maj-Cahier_0.html`, 5 encadrés, 1 745 caractères, bas à 714 pt.
- Jouer à plusieurs appareils : écran « Vous êtes », saisie conservée, « Les conditions ont changé »,
  « ⏳ Enregistrement en cours… », refus hors ligne, double clic ignoré (308).
- Le tour de jeu : « ✅ Tour Terminé » refusé au semestre si l'encaisse personnelle est négative (314) ; tour qui passe
  tout seul quand toutes les entreprises sont enquêtées, bouton « ⏭️ Faire passer le tour » (315) ; « 🎲 Résultats du
  tour » attend la fermeture de la fenêtre en cours (308).
- Ventes et copropriété : ventes à une entreprise sur offre (« Offres de vente en attente », expire au lancer suivant),
  banque au prix de rachat ; plafond de 3 copropriétaires à l'achat seulement (309).
- La fin de la partie : consultation seule (« 🏁 Partie terminée… — consultation seulement »), dividende du lancer final
  versé, compensation et lot commercial réglés à une fin en cours d'année, lot au prorata (316).
- Les années : numérotées à partir de 1, « Année : 1 (semestre 1/2 — 0/3 lancers faits) » (317).

Omis faute de place (effet mineur) : une entreprise envoyée en enquête pendant un lancer touche les loyers de ce lancer
(315) ; joueur sans entreprise qui consulte à la fin, classement final revu après avoir quitté (316) ; alertes de
création (réglages hors bornes, noms en double) et nom d'entreprise égal à un joueur refusé (317).

**(C) Captures** : aucune devenue trompeuse (écran de fondation p. 4, menu ☰ Actions p. 9 : sans barre d'années ni
mécanique modifiée).

**(D) README** : 14 pages.

## 2. Cahier 1 — Positions longues et courtes (15 → 16 pages)

**(A) Corrections en place : aucune.** Rien n'y est devenu faux : la marge à l'ouverture, l'encaisse exigée au rachat,
le bid payé avec une encaisse négative et l'appel de marge au lancer final sont des ajouts. P. 11 (« ferme d'office…
sans attendre l'ouverture du marché ») reste vrai sauf au lancer final, traité en (B).

**(B) Page « Mise à jour » p. 16** — `maj-Cahier_1.html`, 4 encadrés, 1 455 caractères, bas à 645 pt.
- Ouvrir et racheter un découvert : marge vérifiée à l'ouverture (307) ; rachat limité à l'encaisse, message avec le
  maximum, journal au montant réellement payé (307, 317) ; montant non valide ou > 1 000 000 M$ refusé (314).
- L'appel de marge : bons vendus d'abord (307) ; garantie d'un prêt garanti hors de la marge du CEO (314) ; aucune
  fermeture forcée au lancer final (316).
- Votre encaisse au semestre : « ✅ Tour Terminé » refusé si l'encaisse personnelle est négative, moyens de remonter (314).
- Ordres bid et ask : bid déclenché avec une encaisse un peu négative (314) ; ligne « Ordre qui sera placé : … »,
  conversion sans arrondi (317) ; ask non exécuté s'il découvre des options écrites au-delà du plafond (314).

**(C) Captures** : formulaire de bid p. 14 sans la nouvelle ligne « Ordre qui sera placé » : pas trompeur, non signalé.

**(D) README** : 16 pages.

## 3. Cahier 2 — Les obligations (16 → 17 pages)

**(A) Corrections en place (2)**

| Page | Avant → après | Section |
|---|---|---|
| 10 | Encadré « Une inexactitude dans les textes de l'application » : « …votre valeur nette sert aussi à vérifier votre marge… fermées de force bien avant la fin de la partie. » → la déduction pèse sur le classement, pas sur la marge ; aucune offre garantie ne déclenche d'appel de marge. Le titre reste juste : l'application dit toujours « en fin de partie » (vérifié dans `index.html`, quatre textes). | 314 |
| 15 | Piège 6 : « …et elle compte dans votre marge à chaque lancer. » → « …immédiate et permanente, mais elle ne compte pas dans votre marge. » | 314 |

**(B) Page « Mise à jour » p. 17** — `maj-Cahier_2.html`, 4 encadrés, 1 361 caractères, bas à 610 pt.
- Bons gouvernementaux : intérêt ajouté au solde à chaque lancer, payé par la banque au retrait (314) ; « Solde
  initial » et « Intérêts » cohérents après un retrait (317) ; bid payé par les bons même encaisse négative (314) ;
  emprunt en bons pour remonter l'encaisse personnelle au semestre (314).
- Garantie et marge (314).
- Accepter une offre : confirmation et « Les conditions ont changé » (312) ; bornes appliquées par le jeu (312) ;
  « illimité » sans maximum (317).
- Avant de prêter : encaisse négative comptée comme dette, cote jusqu'à D (312) ; dette « productive » seulement si les
  investissements suivent l'emprunt (315).

**(C) Captures** : aucune trompeuse.

**(D) README** : 17 pages.

## 4. Cahier 3 — Les options (24 → 25 pages)

**(A) Corrections en place (9)**

| Page | Avant → après | Section |
|---|---|---|
| 2 | « Rien ne vous en empêche, aucun message ne vous prévient. » → « Seuls la marge à l'ouverture et un plafond de 15 % des parts vous arrêtent. » | 307, 314 |
| 4 | « Les puts et les options écrites n'ont pas de plafond. » → « Même plafond pour les options écrites nues, puts compris ; aucun pour les covered calls. » (+14 % sur le paragraphe, mêmes 3 lignes) | 314 |
| 16 | « Il commence par la couverture classique… côté acheté. » → jambe sœur avant les parts pour un call, après l'encaisse pour un put | 314 (retouche) |
| 16 | « La jambe écrite d'un bull spread est un call : des parts… s'applique avant la jambe sœur… » → bear spread : encaisse avant la jambe sœur ; bull spread : jambe sœur d'abord, parts libres | 314 (retouche) |
| 19 | Straddle vendu : « l'application ne vérifie pas votre encaisse… Un joueur sans un sou peut donc en ouvrir cinquante contrats… dès le lancer suivant. » → marge vérifiée dès l'ouverture, joueur sans un sou refusé ; « lui non plus » retiré | 307 |
| 20 | Tableau, ligne Call écrit : « parts détenues ÷ 100 » → « blocs entiers de 100 parts détenues » (cellule : 314 pt sur 343 disponibles ; `verifie.py` signale « TROP » à tort, il ne voit pas la largeur de la cellule) | 314 (retouche) |
| 20 | « le calcul ajoute une étape après le tableau » → « …une étape au tableau » (`ancien` s'arrête avant la césure « ci-/dessus ») | 314 |
| 22 | Piège 1 : « couvrent 2,5, et la moitié du troisième est nue. » → « couvrent 2, et le troisième est entièrement nu. » (2e ligne du piège, bloc de texte à part dans le PDF) | 314 (retouche) |
| 23 | Piège 8 : « aucune vérification d'encaisse — puis… au lancer suivant » → « mais jusqu'à 60 % du notionnel exigés en marge dès l'ouverture, puis à chaque lancer » | 307 |

**(B) Page « Mise à jour » p. 25** — `maj-Cahier_3.html`, 4 encadrés, 1 589 caractères, bas à 656 pt.
- Écrire : deux nouvelles limites — marge à l'ouverture, exemple du straddle vendu de 50 contrats à 100 $ (jusqu'à
  300 000 $ : 30 % × 50 × 100 × 100 $ × 2 jambes) (307) ; plafond de 300 contrats nus pour 200 000 parts, puts écrits
  comptés nus, covered calls et jambes de spread exclus (314, réponse de Julien).
- Ce qui peut être refusé ensuite : vente de parts, ask exécuté, clôture seule de la jambe achetée d'un spread (314,
  décision de Julien).
- Couverture des calls : blocs entiers partagés, jambe du spread d'abord, option simple distincte d'une jambe (314).
- Racheter, et la fin de partie : rachat limité à l'encaisse, stratégie en tout ou rien (307) ; bons vendus d'abord ;
  rien de fermé au lancer final (316) ; ligne « P&L options clôturées » (317).

**(C) Captures** : aucune trompeuse (formulaires d'option sans message de plafond : pas faux).

**(D) README** : 25 pages.

## 5. Cahier 4 — Les actions d'entreprises (15 → 16 pages)

**(A) Corrections en place (4)**

| Page | Avant → après | Section |
|---|---|---|
| 6 | Tableau des ratios, capitalisation : « hors part de la banque » → « part de la banque comprise » | 317 |
| 6 | Même ligne, colonne « Comment le lire » : « La taille réelle du morceau en jeu » → « La taille de l'entreprise entière » | 317 |
| 9 | Encadré « Si la partie se termine entre l'annonce et le versement » : fin avant le lancer du versement → rendu à l'entreprise ; fin au lancer même du versement → dividende payé | 316 |
| 14 | Vente annoncée du CEO au-delà de 15 % : « annulée en entier à l'échéance » → « ramenée au plafond à l'échéance ; si le plafond est déjà atteint, elle est annulée » | 315 |

**(B) Page « Mise à jour » p. 16** — `maj-Cahier_4.html`, 5 encadrés, 1 439 caractères, bas à 699 pt.
- Dividendes : banque à position négative qui paie son excédent (307) ; « Coût total par semestre (hors part de la
  banque, rendue à la trésorerie) » (317) ; journal et fenêtre « Dividende annoncé » (317).
- Cubes et cours : plafond d'impact au cumul des ordres d'une fenêtre de marché (314) ; sortie publique sans rouge
  ajouté (315). Le texte p. 11 (« fractionner un gros ordre ne change rien au total ») devient exact.
- États financiers et attente : écritures de fin d'année et part non versée au semestre clos (315) ; attente de départ
  des deux premiers semestres (317).
- Cote de crédit : encaisse négative comptée comme dette (312).
- Capture de la page 13 (voir C).

**(C) Captures** : **p. 13**, fenêtre « Annoncer une transaction » : « une vente qui le dépasserait alors sera
intégralement annulée » → trompeuse (315), signalée dans la page de mise à jour. P. 6 (ratios) : libellé sans la
précision « part de la banque comprise », chiffres déjà totaux : pas trompeur.

**(D) README** : 16 pages.

## 6. Cahier 5 — Types de terrain (11 → 12 pages)

**(A) Corrections en place (2)**

| Page | Avant → après | Section |
|---|---|---|
| 5 | REIT : « Une fois que l'administrateur les a ouverts… Avant l'ouverture, ce loyer n'est versé à personne. » → « Une fois qu'une première enchère a attribué le fonds… Avant cette enchère, le visiteur ne paie pas cette part. » (bas de page : longueur identique) | 310 |
| 7 | « Une mise ne peut pas dépasser l'encaisse de votre entreprise. » → « Le total de vos mises REIT ne peut pas dépasser l'encaisse de votre entreprise. » | 310 |

Respecté (décisions finales de Julien, pas la liste « Changements visibles » de la section 310) : la mise du lot
commercial n'est PAS bornée par l'encaisse (seulement finie et ≤ 1 000 000 M$) ; elle n'entre pas dans le total des mises
REIT ; une part de REIT est portée à sa valeur d'achat, et au plus à sa part du dernier prix d'enchère si elle est
achetée de gré à gré.

**(B) Page « Mise à jour » p. 12** — `maj-Cahier_5.html`, 5 encadrés, 1 861 caractères, bas à 714 pt.
- Enchères de REIT : total ≤ encaisse (seule la part à racheter compte), baisser ou retirer toujours permis, envoi
  groupé, seul le CEO mise, ordre de résolution et mise écartée (310).
- Valeur au bilan et revente : valeur d'achat (colonne « Valeur d'achat (bilan) »), exemple de gré à gré (10 % payés
  2 M$, dernier prix 10 M$, portés 1 M$), « Proposer la vente » (310).
- Lot commercial : mise non bornée par l'encaisse, hors total REIT (310, réponse de Julien) ; fin en cours d'année au
  prorata, exemple 9 M$ → 1,50 M$ (316).
- Construire, racheter, regrouper : part de la banque dans les maisons, « Valeur convenue de la maison », banque jamais
  sous sa valeur de rachat, plus de 3 copropriétaires après regroupement, plancher 1 % (309).
- Capture de la page 6 (voir C).

Omis faute de place : le prix payé à la banque (Administration) ne relève le plancher de valeur du terrain qu'au prorata
des parts achetées (309, décision de Julien).

**(C) Captures** : **p. 6**, onglet ETF : la barre du haut affiche « Année : 0 (semestre 1/2 — 0/3) » → trompeuse
(317, l'année affichée commence à 1), signalée.

**(D) README** : 12 pages.

## 7. Cahier 6 — Les types d'entreprises (14 → 15 pages)

**(A) Corrections en place (2)**

| Page | Avant → après | Section |
|---|---|---|
| 8 | Axe 1 : « percentile… parmi toutes les entreprises actives » → « face aux autres entreprises actives » | 315 |
| 8 | Profil Très élevé : « au-dessus du deuxième tiers = bon, entre médiane et deux tiers = neutre… » → « dépasser au moins les deux tiers des autres = bon, la moitié = neutre, moins = mauvais » | 315 (réponse de Julien) |

Non corrigé en place : p. 6, encadré « Ne distribuez pas plus que votre bénéfice » (« dividendes versés » n'est pas
faux ; la précision « hors part de la banque » est en (B)) ; p. 12 « servi à de vrais investissements » (cohérent avec
la règle de la dette productive ; précision en (B)) ; profil Élevé p. 8 (« au-dessus de la médiane » reste juste).

**(B) Page « Mise à jour » p. 15** — `maj-Cahier_6.html`, 5 encadrés, 1 678 caractères, bas à 698 pt.
- Dividendes : seul le récurrent protège le sac type ; arriérage de privilégié qui bloque le récurrent sans le
  suspendre ; ratio sans la part de la banque, exemple 0,3 dont 0,21 à la banque → 45 % (315).
- Croissance : percentile des autres, seuils moitié et deux tiers, exemple +40 / +30 / −10 / −30 % (315).
- GARP et spirale : GARP à équité ≤ 0 → 20 rouges (315) ; encaisse négative = dette (312) ; dette productive (315).
- Sortie publique et états financiers (315).
- Capture de la page 6 (voir C).

**(C) Captures** : **p. 6**, fenêtre « Dividende récurrent » : « Coût total par semestre : 800 K$ » calculé sur toutes
les parts → trompeuse (317, libellé et calcul hors part de la banque), signalée.

**(D) README** : 15 pages.

## 8. Cahier 7 — Le financement et les accords (37 → 39 pages)

**(A) Corrections en place (5)**

| Page | Avant → après | Section |
|---|---|---|
| 3 | Formule de la prime de risque : ratio plafonné à 1, dette « découvert compris », « jamais plus de 85 % » | 312 |
| 19 | Encadré « En fin de partie n'est pas tout à fait exact » : même correction que le cahier 2 p. 10 (pas d'effet sur la marge) | 314 |
| 25 | « l'annonce d'un dividende ordinaire est refusée » → « aucun dividende ordinaire n'est versé, pas même le récurrent » | 315 |
| 28 | Prêteur entreprise : « peut détenir votre hypothèque » → « …si son CEO accepte votre offre avant le prochain lancer » (paragraphe réécrit pour garder 3 lignes) | 312 |
| 31 | « 1. Vendez des maisons… Immédiat, sans cube rouge, sans dette. » → « Sans cube rouge, sans dette. » | 309 |

**Non corrigé en place, à dessein** : légende p. 34 « Vendre une part de terrain : comptant immédiat, aucune dette
créée. » Elle est composée en DejaVu Sans Mono 8,5 pt ; l'outil recompose en Arial, la légende changerait de police. La
correction (immédiat seulement à la banque) est dans la page de mise à jour p. 39. L'exemple p. 25 (« dû à la fin de
l'année 2… arriérage qu'à la fin de l'année 3 ») est relatif et reste juste avec la nouvelle numérotation (317).

**(B) Pages « Mise à jour » p. 38 et 39**
- `maj-Cahier_7-1.html` (p. 38, 4 encadrés, 1 860 caractères, bas à 718 pt) : crédit et taux (encaisse négative = dette,
  taux plafonné, 1re subvention d'avance ≥ 1,25 M$, confirmation de la subvention et taux au journal — 312, 308, 317) ;
  prêts et hypothèques (confirmation d'une offre de prêt, hypothèque auprès d'une entreprise sur offre, dernier recours
  retenu même sans l'option « Prêts » — 312) ; swaps et compensation (un seul swap général ou à budget, un seul swap
  spécifique par terrain, vente bloquée, résiliation amiable, destinataire seul, regroupement refusé avec deux swaps
  spécifiques, compensation réglée à une fin en cours d'année — 311, 316) ; dividendes privilégiés (arriérage qui bloque
  le récurrent — 315).
- `maj-Cahier_7-2.html` (p. 39, 4 encadrés, 1 654 caractères, bas à 640 pt) : vendre une part ou des maisons (vendeur
  imposé, banque immédiate au prix de rachat, offre à une entreprise, légende p. 34, échange refusé — 309, 311) ;
  assurance (franchise ≥ 0, indemnité plafonnée au montant « à risque » avec l'exemple 0,5 / 19,5, taxe couverte en
  entier, 2e confirmation, sous-standard remboursée, case taxe non reproposée, type désactivé absent, assureur disparu —
  313) ; répondre à une proposition (« Propositions en attente », « Offres de vente en attente » — 309, 311, 312) ;
  sortie publique (315).

**(C) Captures** : aucune trompeuse en soi. P. 34 : la capture montre seulement le choix du terrain ; c'est la légende
qui est inexacte (traitée en B). P. 28 : confirmation d'hypothèque auprès de la banque, toujours juste.

**(D) README** : 39 pages.

## 9. Cahier 8 — Titrisation (10 → 11 pages)

**(A) Corrections en place (3, page 4)**

| Page | Avant → après | Section |
|---|---|---|
| 4 | « sont partiellement verrouillés tant que l'accord court : vous ne pouvez ni vendre une part, » → « verrouillés dès l'annonce et tant que l'accord court : vous ne pouvez ni vendre ni échanger une part, » | 311 |
| 4 | « construire des maisons reste permis, et fusionner un lot aussi… » → construire reste permis ; regrouper un lot est refusé pendant une émission | 311 |
| 4 | Étape 1 : « Un terrain déjà hypothéqué ou déjà dans une autre émission n'apparaît pas. » → « Seuls y figurent les lots de couleur regroupés, les aéroports et les services, ni hypothéqués ni déjà dans une émission. » | 311 |

**(B) Page « Mise à jour » p. 11** — `maj-Cahier_8.html`, 4 encadrés, 1 343 caractères, bas à 578 pt.
- Sur quoi émettre : lot regroupé, aéroport ou service ; verrou dès l'annonce, offre d'hypothèque retirée ; annulation à
  la résolution (311).
- Durée et souscription : durée en lancers depuis la résolution ; plafond d'encaisse sur les deux tranches, exemple
  2 M$ (311).
- Au bilan : « ↳ Titres ABS détenus (flux attendus) » et « ↳ Flux ABS cédés (contre-actif) », valeur nette du joueur
  hors marge, palier de chaque copropriétaire (311).
- Sans porteur junior : ce qui n'est versé à aucun porteur reste à l'émettrice (307).

La consigne citait aussi 316 pour le cahier 8 (« dividende annoncé payable au lancer final ») : le cahier 8 ne parle pas
de dividendes ; ce point est corrigé dans le cahier 4 (p. 9).

**(C) Captures** : aucune.

**(D) README** : 11 pages.

---

## 7 bis. Aide-mémoire (5 pages, inchangé)

Source : `docs/cahiers/Aide_memoire.html`. Version modifiée prête : `…\cahiers-travail\Aide_memoire.html` (22 remplacements
ci-dessous). Imprimée avec Chrome sans interface : **5 pages**, pied présent sur chaque fiche, marge au-dessus du pied :
couverture 148 pt, fiche 1 118 pt, fiche 2 86 pt, fiche 3 31 pt, fiche 4 35 pt (avant : 148 / 143 / 129 / 110 / 88 pt).
Polices identiques au PDF du dépôt (Inter, IBM Plex Mono, Segoe UI Bold).

Chaque `ancien` apparaît exactement une fois dans le fichier d'origine (vérifié). Appliquer dans l'ordre.

@@REMPLACEMENTS@@

---

## 8. README (`docs/cahiers/README.md`)

**Colonne « Pages » du premier tableau** : cahier 0 : 14 ; 1 : 16 ; 2 : 17 ; 3 : 25 ; 4 : 16 ; 5 : 12 ; 6 : 15 ; 7 : 39 ;
8 : 11. Aide-mémoire : 5 pages, inchangé.

**Lignes à ajouter au tableau « Corrections apportées aux PDF »** (date = jour de l'application) :

| Date | Section | Cahiers | Changement |
|---|---|---|---|
| 2026-10-25 | 307 | 1, 3, 4, 8 et aide-mémoire | Marge vérifiée à l'ouverture d'un découvert, d'une option écrite ou d'une stratégie (cahier 3 p. 2, 19, 23) ; rachat volontaire limité à l'encaisse ; fermetures forcées payées d'abord avec les bons ; dividende payé par la banque sur sa position négative ; ce qu'aucun porteur d'ABS ne reçoit reste à l'émettrice. |
| 2026-10-25 | 308 | 0, 7 | Écran « Vous êtes », 2e confirmation « Les conditions ont changé », indicateur d'enregistrement, refus hors ligne, double clic ignoré, saisie conservée ; confirmation de la subvention d'avance. |
| 2026-10-25 | 309 | 0, 5, 7 et aide-mémoire | Ventes de parts et de maisons à une entreprise sur offre acceptée, banque au prix de rachat (cahier 7 p. 31) ; part de la banque dans les maisons ; compensation de maison ; plafond de 3 copropriétaires à l'achat seulement (cahier 0 p. 13). |
| 2026-10-25 | 310 | 5 et aide-mémoire | Réserve REIT payée dès la première enchère (p. 5) ; total des mises REIT au plus l'encaisse (p. 7) ; part de REIT à sa valeur d'achat, plafond de gré à gré ; revente sur offre ; mise du lot commercial non bornée par l'encaisse. |
| 2026-10-25 | 311 | 7, 8 et aide-mémoire | ABS sur lot regroupé, aéroport ou service ; verrou dès l'annonce ; regroupement refusé pendant une ABS (cahier 8 p. 4) ; swaps en conflit refusés ; résiliation amiable d'un swap à budget ; actifs ABS au bilan. |
| 2026-10-25 | 312 | 2, 4, 6, 7 et aide-mémoire | Encaisse négative comptée comme dette ; taux plafonné (cahier 7 p. 3) ; hypothèque auprès d'une entreprise sur offre (cahier 7 p. 28) ; confirmation des offres de prêt ; prêt de dernier recours remboursé dans toutes les parties. |
| 2026-10-25 | 313 | 7 et aide-mémoire | Indemnité d'un loyer plafonnée au montant « à risque » de la signature ; taxes couvertes en entier ; franchise jamais négative ; 2e confirmation ; sous-standard remboursée par un contrat normal. |
| 2026-10-25 | 314 | 1, 2, 3, 4, 7 et aide-mémoire | Garantie hors de la marge du CEO (cahier 2 p. 10 et 15, cahier 7 p. 19) ; plafond de 15 % des options écrites nues (cahier 3 p. 2 et 4) ; couverture des calls par blocs entiers, jambe du spread d'abord (cahier 3 p. 16, 20, 22) ; « Tour Terminé » bloqué par une encaisse personnelle négative ; bid payé avec les bons ; cubes de trading plafonnés au cumul. |
| 2026-10-25 | 315 | 0, 4, 6, 7 et aide-mémoire | Vente annoncée du CEO ramenée au plafond (cahier 4 p. 14) ; percentile Croissance et seuil des deux tiers (cahier 6 p. 8) ; arriérage qui bloque le dividende récurrent (cahier 7 p. 25) ; seul le récurrent protège le sac type ; tour qui passe tout seul quand toutes les entreprises sont enquêtées. |
| 2026-10-25 | 316 | 0, 1, 3, 4, 5, 7 et aide-mémoire | Dividende du lancer final versé (cahier 4 p. 9) ; consultation seule après la fin ; compensation et lot commercial réglés à une fin en cours d'année ; aucune fermeture forcée au lancer final. |
| 2026-10-25 | 317 | 0, 1, 2, 3, 4, 5, 6 | Capitalisation « part de la banque comprise » (cahier 4 p. 6) ; années numérotées à partir de 1 ; captures signalées (cahier 4 p. 13, cahier 5 p. 6, cahier 6 p. 6) ; libellés du dividende récurrent, de l'ordre bid et du P&L options. |

**Phrase à ajouter sous le tableau** : « Depuis la série 307–317 (octobre 2026), chaque cahier touché se termine par une
page « Mise à jour » qui résume le reste des changements et signale les captures devenues inexactes (les images ne sont
pas retouchées). »

---

## 9. Points incertains et questions pour Julien

1. **Règles « à valider » documentées comme acquises** (elles sont en production) : prêt de dernier recours retenu même
   sans l'option « Prêts » (312, point 3) ; prix du lot commercial au prorata à une fin en cours d'année (316) ; put écrit
   toujours compté nu pour le plafond (314). Si Julien revient sur l'un d'eux, retoucher les pages de mise à jour des
   cahiers 7, 5 et 3.
2. **Cahier 3 p. 16 et p. 20** : l'ordre de couverture des calls (jambe du spread avant les parts) vient d'une retouche
   de revue. Corriger en place deux encadrés pour un cas rare (spread vendu par un porteur de parts) est-il souhaité ? La
   page de mise à jour suffirait sinon (retirer alors les deux corrections p. 16 et la seconde p. 20).
3. **Cahier 2 p. 10 et cahier 7 p. 19** : les textes de l'application parlent toujours de garantie « en fin de partie »
   (quatre endroits d'`index.html`). Les corriger aussi dans l'application rendrait ces encadrés caducs.
4. **Légende en police mono du cahier 7 p. 34** : laissée telle quelle (l'outil recompose en Arial). L'outil pourrait-il
   recomposer en DejaVu Sans Mono ? Sinon, la page de mise à jour la corrige.
5. **Années (317)** : aucun « année 0 », « année 1 » ou « an 0 » dans le texte des cahiers ; seule la capture du cahier 5
   p. 6 montre « Année : 0 ». Les autres captures ne montrent pas la barre du haut (vérifié sur les 55 grandes captures et
   les captures de fenêtres).
6. **Omis faute de place** (effet mineur) : enquête ouverte après tous les déplacements (315), joueur sans entreprise à
   la fin et classement revu après avoir quitté (316), alertes de création de partie et nom d'entreprise égal à un joueur
   (317), plancher de valeur au prorata des parts achetées à la banque (309).
