// Mise à jour de docs/cahiers/README.md et de la ligne « docs/cahiers » du CLAUDE.md du projet (fichiers CRLF).
const fs = require("fs");
const R = "C:/Users/Julien/Desktop/Application CLAUDE/Monopoly Finance/";
const fail = m => { console.log("ÉCHEC", m); process.exitCode = 1; };

// README : nombre de pages du premier tableau.
let s = fs.readFileSync(R + "docs/cahiers/README.md", "utf8");
const pages = { 0: [13, 14], 1: [15, 16], 2: [16, 17], 3: [24, 25], 4: [15, 16], 5: [11, 12], 6: [14, 15], 7: [37, 39], 8: [10, 11] };
for (const [c, [a, b]] of Object.entries(pages)) {
  const re = new RegExp("(\\| \\[" + c + "\\]\\(Cahier_" + c + "\\.pdf\\) \\| [^|]+\\| )" + a + "( \\|)");
  if (!re.test(s)) fail("pages du cahier " + c); else s = s.replace(re, "$1" + b + "$2");
}

// README : lignes du tableau « Corrections apportées aux PDF », puis phrase explicative.
const rows = [
  "| 2026-10-25 | 307 | 1, 3, 4, 8 et aide-mémoire | Marge vérifiée à l'ouverture d'un découvert, d'une option écrite ou d'une stratégie (cahier 3 p. 2, 19, 23) ; rachat volontaire limité à l'encaisse ; fermetures forcées payées d'abord avec les bons ; dividende payé par la banque sur sa position négative ; ce qu'aucun porteur d'ABS ne reçoit reste à l'émettrice. |",
  "| 2026-10-25 | 308 | 0, 7 | Écran « Vous êtes », 2e confirmation « Les conditions ont changé », indicateur d'enregistrement, refus hors ligne, double clic ignoré, saisie conservée ; confirmation de la subvention d'avance. |",
  "| 2026-10-25 | 309 | 0, 5, 7 et aide-mémoire | Ventes de parts et de maisons à une entreprise sur offre acceptée, banque au prix de rachat pour une part (cahier 7 p. 31) ; part de la banque dans les maisons ; compensation de maison ; plafond de 3 copropriétaires à l'achat seulement (cahier 0 p. 13). |",
  "| 2026-10-25 | 310 | 5 et aide-mémoire | Réserve REIT payée dès la première enchère (p. 5) ; total des mises REIT au plus l'encaisse (p. 7) ; part de REIT à sa valeur d'achat, au plus sa part du dernier prix d'enchère si achetée de gré à gré ; revente sur offre ; mise du lot commercial non bornée par l'encaisse. |",
  "| 2026-10-25 | 311 | 7, 8 et aide-mémoire | ABS sur lot regroupé, aéroport ou service ; verrou dès l'annonce ; regroupement refusé pendant une ABS (cahier 8 p. 4) ; swaps en conflit refusés ; résiliation amiable d'un swap à budget ; actifs ABS au bilan. |",
  "| 2026-10-25 | 312 | 2, 4, 6, 7 et aide-mémoire | Encaisse négative comptée comme dette ; taux plafonné (cahier 7 p. 3) ; hypothèque auprès d'une entreprise sur offre (cahier 7 p. 28) ; confirmation des offres de prêt ; prêt de dernier recours remboursé dans toutes les parties. |",
  "| 2026-10-25 | 313 | 7 et aide-mémoire | Indemnité d'un loyer plafonnée au montant « à risque » de la signature ; taxes couvertes en entier ; franchise jamais négative ; 2e confirmation ; sous-standard remboursée par un contrat normal. |",
  "| 2026-10-25 | 314 | 1, 2, 3, 4, 7 et aide-mémoire | Garantie hors de la marge du CEO (cahier 2 p. 10 et 15, cahier 7 p. 19) ; plafond de 15 % des options écrites nues, puts écrits compris (cahier 3 p. 2 et 4) ; couverture des calls par blocs entiers, jambe du spread d'abord (cahier 3 p. 16, 20, 22) ; « Tour Terminé » retiré tant que l'encaisse personnelle est négative au semestre ; bid payé avec les bons ; cubes de trading plafonnés au cumul. |",
  "| 2026-10-25 | 315 | 0, 4, 6, 7 et aide-mémoire | Vente annoncée du CEO ramenée au plafond (cahier 4 p. 14) ; percentile Croissance et seuil des deux tiers (cahier 6 p. 8) ; arriérage qui bloque le dividende récurrent (cahier 7 p. 25) ; seul le récurrent protège le sac type ; tour qui passe tout seul quand toutes les entreprises sont enquêtées. |",
  "| 2026-10-25 | 316 | 0, 1, 3, 4, 5, 7 et aide-mémoire | Dividende du lancer final versé (cahier 4 p. 9) ; consultation seule après la fin ; compensation et lot commercial réglés à une fin en cours d'année ; aucune fermeture forcée au lancer final. |",
  "| 2026-10-25 | 317 | 0, 1, 2, 3, 4, 5, 6 | Capitalisation « part de la banque comprise » (cahier 4 p. 6) ; années numérotées à partir de 1 ; captures signalées (cahier 4 p. 13, cahier 5 p. 6, cahier 6 p. 6) ; libellés du dividende récurrent, de l'ordre bid et du P&L options. |",
];
const anchor = s.split("\r\n").findIndex(l => l.startsWith("| 2026-10-19 | 306 |"));
if (anchor < 0) fail("ligne 306 du README");
else {
  const L = s.split("\r\n");
  L.splice(anchor + 1, 0, ...rows, "",
    "Depuis la série 307–317 (octobre 2026), chaque cahier touché se termine par une page « Mise à jour » qui résume le",
    "reste des changements et signale les captures devenues inexactes (les images ne sont pas retouchées).");
  s = L.join("\r\n");
}
fs.writeFileSync(R + "docs/cahiers/README.md", s);

// CLAUDE.md : la mention « mises à jour en attente » devient l'état à jour.
let c = fs.readFileSync(R + "CLAUDE.md", "utf8");
const old = "le signaler à Julien (mises à jour en attente : rubriques\r\n  « Changements visibles pour les joueurs » des sections 307 à 317).";
const neu = "le signaler à Julien (à jour des sections 307 à 317 au 2026-10-25 :\r\n  corrections en place et page « Mise à jour » à la fin de chaque cahier, voir `README.md`).";
if (c.split(old).length !== 2) fail("ligne docs/cahiers du CLAUDE.md"); else c = c.replace(old, neu);
fs.writeFileSync(R + "CLAUDE.md", c);
console.log(process.exitCode ? "avec échecs" : "README et CLAUDE.md mis à jour");
