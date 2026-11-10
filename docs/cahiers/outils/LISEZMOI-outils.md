# Outils de correction des cahiers PDF (`outils_cahiers.py`)

Dossier de l'outil W : `docs/cahiers/outils/` du dépôt (copié le 2026-11-10 depuis l'ancien dossier de travail temporaire, supprimé depuis). Travailler sur des COPIES des PDF de `docs/cahiers/`, jamais sur les originaux du dépôt. Python 3.11 + PyMuPDF. Toujours lancer avec `python -I`
(dans ce cas le dossier courant n'est pas dans le chemin des modules : en module, faire
`sys.path.insert(0, W)` puis `import outils_cahiers as oc`).

Polices lues dans `C:\Windows\Fonts` (variable `CAHIERS_POLICES` pour changer), Chrome dans
`C:\Program Files\Google\Chrome\Application\chrome.exe` (variable `CAHIERS_CHROME`).

## Commandes (depuis W)

```
# 1. Appliquer tout corrections.json à un dossier d'originaux (copies de travail, jamais le dépôt)
python -I outils_cahiers.py appliquer-tout originaux corrections.json sortie
#    -> écrit tous les cahiers dans « sortie » (ceux sans correction sont copiés tels quels).
#    Code de sortie 1 s'il reste des corrections refusées (liste affichée) ; les autres sont appliquées.

# 1 bis. Un seul cahier (liste JSON, ou dictionnaire {nom: liste})
python -I outils_cahiers.py appliquer originaux/Cahier_1.pdf sortie/Cahier_1.pdf corrections.json

# 2. Ajouter une page « Mise à jour » (gabarit rempli par --cahier / --page, ou HTML déjà prêt)
python -I outils_cahiers.py ajouter-page sortie/Cahier_1.pdf sortie/Cahier_1.pdf gabarit-mise-a-jour.html --cahier 1 --page 16
#    (entrée et sortie peuvent être le même fichier ; le contenu se modifie dans une copie du gabarit)

# 3. PNG de contrôle (110 dpi par défaut ; --dpi 200 pour zoomer)
python -I outils_cahiers.py rendre sortie/Cahier_1.pdf controle 15 16

# 4. Différentiel de texte avant/après (pages, lignes retirées/ajoutées)
python -I outils_cahiers.py comparer originaux/Cahier_1.pdf sortie/Cahier_1.pdf

# 5. Aide à écrire « ancien » : paragraphes détectés d'une page, avec leur texte
python -I outils_cahiers.py paragraphes originaux/Cahier_1.pdf 15
```

En module : `appliquer(pdf_in, pdf_out, corrections) -> (journal, erreurs)`, `appliquer_dossier(...)`,
`ajouter_page(pdf_in, pdf_out, html) -> nb_pages`, `remplir_gabarit(chemin, cahier, page)`,
`rendre(pdf, pages, dossier, dpi=110)`, `comparer(avant, apres) -> dict`.

## Format de `corrections.json`

```json
{ "Cahier_1.pdf": [
    {"page": 15, "ancien": "à votre prix limite (chapitre 11).", "nouveau": "…"},
    {"page": 15, "ancien": "Aucune limite", "nouveau": "**Aucune limite (à surveiller)**"} ] }
```

- `page` : 1 = première. `ancien` : sous-chaîne d'UN paragraphe (ou d'une cellule), comparée après
  normalisation des blancs (retours à la ligne, U+00A0, U+202F, césures sur trait d'union). Introuvable ou
  présent plusieurs fois : la correction est refusée avec un message clair. Option `"occurrence": n` (1 = première
  dans l'ordre de lecture) pour trancher une ambiguïté.
- `nouveau` : texte libre. `**gras**` et `__italique__` permis. Sans balise, le texte remplaçant garde le style
  (gras/italique) du premier caractère remplacé ; avec `**`, on repart en maigre et seules les balises mettent en
  gras (d'où `**Aucune limite (à surveiller)**` dans une cellule en gras).
- Option `"typographie": false` pour désactiver la conversion automatique en espace insécable (U+00A0) des
  espaces avant `? ! ; : » %` et après `«`.
- Les corrections d'une même page s'appliquent dans l'ordre ; on peut en enchaîner plusieurs sur le même paragraphe.

## Ce que fait l'outil

Paragraphe retrouvé (lignes de même abscisse, taille, couleur, interligne cohérent) ; largeur de colonne déduite de
l'encadré, de la colonne du tableau ou de la page puis recalée sur les coupures d'origine (le journal indique
« recomposition de l'original identique » : l'outil retrouve exactement les coupures du PDF d'origine) ;
effacement du texte du paragraphe seul (rédaction sans remplissage, images et dessins intacts) ; réécriture ligne
par ligne en Arial / Arial Bold / Arial Italic / Bold Italic incorporées (Times New Roman si le paragraphe était en
Liberation Serif), même abscisse, même première ligne de base, même interligne, couleur et taille. Le journal
(`journal` renvoyé et affiché) donne par correction : lignes avant/après, place restante, agrandissement d'encadré.
Si le paragraphe est le dernier de son encadré et grandit, l'encadré est agrandi (fond, filets haut/bas/droit, barre
de couleur à gauche) tant qu'il reste de la place avant l'obstacle suivant (marge de 2 pt). Sinon : refus
« déborde de N pt », rien n'est écrit pour cette correction.
La table ToUnicode des polices Arial du fichier est réparée à l'enregistrement (sans cela, l'espace se copie en
U+00A0, « - » en trait d'union conditionnel et « ; » en point d'interrogation grec).

Contrôle sur les 9 cahiers : sur 755 paragraphes de plusieurs lignes, 755 sont recomposés avec les mêmes coupures de
ligne que l'original ; une correction « à vide » (ancien = nouveau) sur 8 paragraphes par cahier ne change aucune
ligne de texte (`comparer`) et le rendu reste visuellement identique.

## Limites connues

- Polices prises en charge : Liberation Sans / Arial (et Serif / Times). Un paragraphe en DejaVu (chapeaux
  en capitales espacées, légendes de capture, pied de page, numéros) est refusé : ces textes ne se recomposent pas.
- Aucun déplacement des éléments voisins : si le paragraphe grandit, il ne peut utiliser que l'espace blanc sous lui
  (jusqu'au texte, à l'image ou au filet suivant, moins 2 pt). Un paragraphe qui rétrécit laisse un vide.
- Un paragraphe très mal groupé (lignes d'un autre texte imbriquées dans sa zone, p. ex. Cahier_4 p. 13 : le
  paragraphe « Un CEO ne peut ni acheter… ») est refusé (« chevauche un autre texte ») plutôt que mal effacé.
- Les exposants (« n° ») de l'ancien texte sont conservés tels quels ; on ne sait pas en créer dans `nouveau`.
  Le texte à remplacer doit les écrire comme l'extraction les rend (« no 3 »).
- Le rendu est d'un demi-pixel près : Chrome arrondit chaque ligne à 0,75 pt ; l'outil utilise l'interligne moyen.
  Pas de crénage (Chrome en applique un peu) : les coupures de lignes sont identiques à l'original sur les 755 paragraphes
  testés, mais un texte très différent peut se couper une lettre plus tôt/plus tard qu'avec Chrome.
- Les espaces insécables étroits et ordinaires partagent un glyphe : à l'extraction, un nbsp réécrit ressort en
  espace simple (sans conséquence pour la recherche).
- `ajouter_page` : sous Windows, Chrome dispose de Georgia et Consolas, alors que les cahiers d'origine (produits sous
  Linux) ont Liberation Serif (titre) et DejaVu (pied de page, surtitres). La page ajoutée a donc un titre en Georgia
  (chiffres elzéviriens, « 2026 ») et un pied de page un peu différents : pour un rendu identique, mettre
  `"Liberation Serif"` ou `"Times New Roman"` avant `Georgia` dans la pile de polices du gabarit. Un contenu trop long
  (2 pages) est refusé.
- Cahier_6.pdf (p. 7, « au­delà ») contient déjà du texte Arial recomposé auparavant : son trait d'union était
  extrait comme U+00AD ; l'enregistrement par l'outil le corrige en « - ».
