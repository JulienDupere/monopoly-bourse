# Cahiers de formation — Monopoly Bourse (version finale)

Guides destinés aux **joueurs**, rédigés dans une autre conversation Claude à partir d'une partie de
démonstration à quatre joueurs. Ils décrivent le comportement de l'application du point de vue de la table.

| Cahier | Sujet | Pages | Sections principales |
|---|---|---|---|
| [0](Cahier_0.pdf) | Les règles du jeu | 14 | Mise en place, fondation, enchère d'ouverture, tour de jeu, horloge (lancers, semestres, années), plateau et loyers, pouvoirs du CEO, bourse en une page, fin de partie. **À lire en premier.** |
| [1](Cahier_1.pdf) | Positions longues et courtes | 16 | Achat d'actions, vente à découvert, coût de portage, appel de marge, rachat, ordres en attente bid/ask |
| [2](Cahier_2.pdf) | Les obligations | 17 | Bons gouvernementaux, emprunt au taux sans risque, levier, obligations d'entreprise garanties ou non |
| [3](Cahier_3.pdf) | Les options | 25 | Chaîne d'options, prime, covered call, cash-secured put, protective put, spreads, straddle, marge, échéance |
| [4](Cahier_4.pdf) | Les actions d'entreprises | 16 | IPO, actionnariat, valeur comptable vs cours, cote de crédit, dividende, moteur du cours, bénéfice attendu, parts du CEO |
| [5](Cahier_5.pdf) | Types de terrain | 12 | Terrains de couleur, aéroports, services, ETF/REIT de terrains, lot commercial, cases hostiles |
| [6](Cahier_6.pdf) | Les types d'entreprises | 15 | Dividende, Croissance, GARP, Momentum, les trois sacs de cubes, spirale de détresse |
| [7](Cahier_7.pdf) | Le financement et les accords | 39 | Escalier du financement, swaps de loyers, compensation, émissions, parts privilégiées, hypothèque, prêt de dernier recours, assurance |
| [8](Cahier_8.pdf) | Titrisation (ABS) | 11 | Émission, tranches senior/junior, souscription, versement à chaque loyer. À lire après le cahier 7. |

## Aide-mémoire du joueur

[Aide_memoire.pdf](Aide_memoire.pdf) résume les neuf cahiers en cinq pages imprimables (format Lettre) :
une page de garde, puis une fiche par thème — fonder son entreprise, les actions du joueur, les actions des
entreprises, le financement pour et contre. Les chiffres cités sont les valeurs par défaut des réglages,
vérifiées contre `index.html` le 2026-10-19.

Source modifiable : [Aide_memoire.html](Aide_memoire.html) (contenu de page sans squelette `<html>`, publié
aussi comme artefact claude.ai). Pour régénérer le PDF, envelopper le fichier dans
`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>…</html>` puis imprimer avec Chrome sans
interface :

    chrome --headless=new --no-pdf-header-footer --print-to-pdf=Aide_memoire.pdf <fichier enveloppé>

Vérifier ensuite que le PDF fait exactement 5 pages.

## Corrections apportées aux PDF

| Date | Section | Cahiers | Changement |
|---|---|---|---|
| 2026-10-19 | 306 | 2, 4, 6, 7 et aide-mémoire | L'emprunt n'ajoute plus aucun cube rouge. Toute baisse du dividende récurrent remet le sac type à 20 rouges. Nouvel encadré (cahier 6, p. 6) : verser plus que le bénéfice du semestre rougit 5 cubes du sac type. |
| 2026-10-25 | 307 | 1, 3, 4, 8 et aide-mémoire | Marge vérifiée à l'ouverture d'un découvert, d'une option écrite ou d'une stratégie (cahier 3 p. 2, 19, 23) ; rachat volontaire limité à l'encaisse ; fermetures forcées payées d'abord avec les bons ; dividende payé par la banque sur sa position négative ; ce qu'aucun porteur d'ABS ne reçoit reste à l'émettrice. |
| 2026-10-25 | 308 | 0, 7 | Écran « Vous êtes », 2e confirmation « Les conditions ont changé », indicateur d'enregistrement, refus hors ligne, double clic ignoré, saisie conservée ; confirmation de la subvention d'avance. |
| 2026-10-25 | 309 | 0, 5, 7 et aide-mémoire | Ventes de parts et de maisons à une entreprise sur offre acceptée, banque au prix de rachat pour une part (cahier 7 p. 31) ; part de la banque dans les maisons ; compensation de maison ; plafond de 3 copropriétaires à l'achat seulement (cahier 0 p. 13). |
| 2026-10-25 | 310 | 5 et aide-mémoire | Réserve REIT payée dès la première enchère (p. 5) ; total des mises REIT au plus l'encaisse (p. 7) ; part de REIT à sa valeur d'achat, au plus sa part du dernier prix d'enchère si achetée de gré à gré ; revente sur offre ; mise du lot commercial non bornée par l'encaisse. |
| 2026-10-25 | 311 | 7, 8 et aide-mémoire | ABS sur lot regroupé, aéroport ou service ; verrou dès l'annonce ; regroupement refusé pendant une ABS (cahier 8 p. 4) ; swaps en conflit refusés ; résiliation amiable d'un swap à budget ; actifs ABS au bilan. |
| 2026-10-25 | 312 | 2, 4, 6, 7 et aide-mémoire | Encaisse négative comptée comme dette ; taux plafonné (cahier 7 p. 3) ; hypothèque auprès d'une entreprise sur offre (cahier 7 p. 28) ; confirmation des offres de prêt ; prêt de dernier recours remboursé dans toutes les parties. |
| 2026-10-25 | 313 | 7 et aide-mémoire | Indemnité d'un loyer plafonnée au montant « à risque » de la signature ; taxes couvertes en entier ; franchise jamais négative ; 2e confirmation ; sous-standard remboursée par un contrat normal. |
| 2026-10-25 | 314 | 1, 2, 3, 4, 7 et aide-mémoire | Garantie hors de la marge du CEO (cahier 2 p. 10 et 15, cahier 7 p. 19) ; plafond de 15 % des options écrites nues, puts écrits compris (cahier 3 p. 2 et 4) ; couverture des calls par blocs entiers, jambe du spread d'abord (cahier 3 p. 16, 20, 22) ; « Tour Terminé » retiré tant que l'encaisse personnelle est négative au semestre ; bid payé avec les bons ; cubes de trading plafonnés au cumul. |
| 2026-10-25 | 315 | 0, 4, 6, 7 et aide-mémoire | Vente annoncée du CEO ramenée au plafond (cahier 4 p. 14) ; percentile Croissance et seuil des deux tiers (cahier 6 p. 8) ; arriérage qui bloque le dividende récurrent (cahier 7 p. 25) ; seul le récurrent protège le sac type ; tour qui passe tout seul quand toutes les entreprises sont enquêtées. |
| 2026-10-25 | 316 | 0, 1, 3, 4, 5, 7 et aide-mémoire | Dividende du lancer final versé (cahier 4 p. 9) ; consultation seule après la fin ; compensation et lot commercial réglés à une fin en cours d'année ; aucune fermeture forcée au lancer final. |
| 2026-10-25 | 317 | 0, 1, 2, 3, 4, 5, 6 | Capitalisation « part de la banque comprise » (cahier 4 p. 6) ; années numérotées à partir de 1 ; captures signalées (cahier 4 p. 13, cahier 5 p. 6, cahier 6 p. 6) ; libellés du dividende récurrent, de l'ordre bid et du P&L options. |

Depuis la série 307–317 (octobre 2026), chaque cahier touché se termine par une page « Mise à jour » qui résume le
reste des changements et signale les captures devenues inexactes (les images ne sont pas retouchées).

Les corrections sont faites en place avec PyMuPDF : le texte d'origine est retiré, puis réécrit au même endroit en
Arial (métriques identiques à la Liberation Sans d'origine), sans toucher aux images ni aux encadrés.

## Pour le développement

Quand une mécanique change dans `index.html`, le cahier correspondant et l'aide-mémoire peuvent devenir inexacts. Le signaler à
Julien dans le récapitulatif de la livraison (les PDF ne sont pas régénérés automatiquement).
