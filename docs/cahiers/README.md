# Cahiers de formation — Monopoly Bourse (version finale)

Guides destinés aux **joueurs**, rédigés dans une autre conversation Claude à partir d'une partie de
démonstration à quatre joueurs. Ils décrivent le comportement de l'application du point de vue de la table.

| Cahier | Sujet | Pages | Sections principales |
|---|---|---|---|
| [0](Cahier_0.pdf) | Les règles du jeu | 13 | Mise en place, fondation, enchère d'ouverture, tour de jeu, horloge (lancers, semestres, années), plateau et loyers, pouvoirs du CEO, bourse en une page, fin de partie. **À lire en premier.** |
| [1](Cahier_1.pdf) | Positions longues et courtes | 15 | Achat d'actions, vente à découvert, coût de portage, appel de marge, rachat, ordres en attente bid/ask |
| [2](Cahier_2.pdf) | Les obligations | 16 | Bons gouvernementaux, emprunt au taux sans risque, levier, obligations d'entreprise garanties ou non |
| [3](Cahier_3.pdf) | Les options | 24 | Chaîne d'options, prime, covered call, cash-secured put, protective put, spreads, straddle, marge, échéance |
| [4](Cahier_4.pdf) | Les actions d'entreprises | 15 | IPO, actionnariat, valeur comptable vs cours, cote de crédit, dividende, moteur du cours, bénéfice attendu, parts du CEO |
| [5](Cahier_5.pdf) | Types de terrain | 11 | Terrains de couleur, aéroports, services, ETF/REIT de terrains, lot commercial, cases hostiles |
| [6](Cahier_6.pdf) | Les types d'entreprises | 14 | Dividende, Croissance, GARP, Momentum, les trois sacs de cubes, spirale de détresse |
| [7](Cahier_7.pdf) | Le financement et les accords | 37 | Escalier du financement, swaps de loyers, compensation, émissions, parts privilégiées, hypothèque, prêt de dernier recours, assurance |
| [8](Cahier_8.pdf) | Titrisation (ABS) | 10 | Émission, tranches senior/junior, souscription, versement à chaque loyer. À lire après le cahier 7. |

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

Les corrections sont faites en place avec PyMuPDF : le texte d'origine est retiré, puis réécrit au même endroit en
Arial (métriques identiques à la Liberation Sans d'origine), sans toucher aux images ni aux encadrés.

## Pour le développement

Quand une mécanique change dans `index.html`, le cahier correspondant et l'aide-mémoire peuvent devenir inexacts. Le signaler à
Julien dans le récapitulatif de la livraison (les PDF ne sont pas régénérés automatiquement).
