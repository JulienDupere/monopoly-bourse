// Report des constats de la relecture Opus (contenu) : remplacements exacts, chacun doit apparaître une seule fois.
const fs = require("fs");
const R = {
  "maj-Cahier_0.html": [
    ["L'application a été corrigée en octobre 2026 : voici ce qui change pour toute la table.", "L'application a été corrigée en octobre 2026. La page 13 a été corrigée en place ; voici ce qui change pour toute la table."],
    ["Si les chiffres ont bougé, la fenêtre affiche <b>", "Si les chiffres ont bougé, certaines fenêtres (prêts, assurance, ventes, subvention) affichent <b>"],
    ["Au semestre, <b>✅ Tour Terminé</b> est aussi refusé si votre <b>encaisse personnelle</b> est négative. Un bandeau rouge de Mon Entreprise dit comment remonter à zéro.", "Au semestre, le bouton <b>✅ Tour Terminé</b> disparaît aussi tant que votre <b>encaisse personnelle</b> est négative ; un bandeau rouge de Mon Entreprise l'explique."],
    ["La banque rachète tout de suite, à sa valeur de rachat.", "La banque rachète une part tout de suite, à sa valeur de rachat ; les maisons ne se vendent qu'à une entreprise."],
    ["compte les années à partir de 1, comme les états financiers :", "compte les années à partir de 1 :"],
  ],
  "maj-Cahier_1.html": [
    ["<b>✅ Tour Terminé</b> est refusé au semestre si votre encaisse personnelle est négative.", "<b>✅ Tour Terminé</b> disparaît au semestre tant que votre encaisse personnelle est négative."],
    ["Un ask qui rendrait nues des options écrites au-delà du plafond (cahier n<sup>o</sup> 3) n'est pas exécuté : il reste en attente.", "Une vente de parts, au comptant ou par ask, qui rendrait nues des options écrites au-delà du plafond (cahier n<sup>o</sup> 3) est refusée ; l'ask reste en attente."],
    ["valeur nette admissible", "valeur nette marginable"],
  ],
  "maj-Cahier_3.html": [
    ["Vendre vos parts, laisser un ask s'exécuter ou clôturer seule la jambe achetée d'un spread est refusé si vos contrats nus dépassent alors le plafond. Fermer la stratégie entière reste toujours permis.", "Vendre des parts qui couvrent vos calls écrits, au comptant ou par un ask, est refusé si vos contrats nus dépassent alors le plafond ; l'ask reste en attente. Racheter des options écrites reste permis."],
    ["valeur nette admissible", "valeur nette marginable"],
  ],
  "maj-Cahier_5.html": [
    ["au prorata : lot gagné à 9 M$ au lancer 7, fin au lancer 8, prix 1,50 M$.", "au prorata des lancers écoulés depuis l'enchère : lot gagné à 9 M$, fin un lancer plus tard, prix 9 × 1/6 = 1,50 M$."],
  ],
  "maj-Cahier_6.html": [
    ["hors part de la banque : 0,3 M$ dont 0,21 M$ à la banque, bénéfice 0,2 M$ : ratio 45 %", "hors part de la banque. Exemple : 0,3 M$ dont 0,21 M$ à la banque, bénéfice 0,2 M$ → ratio 45 %"],
  ],
  "maj-Cahier_7-1.html": [
    ["cours plus volatil, options plus chères, spirale", "cours plus volatil, spirale"],
    ["rapporte au moins 1,25 M$.", "rapporte au moins 1,25 M$ (réglages par défaut)."],
    ["« Vendre la prochaine subvention d'avance » ouvre une confirmation ;", "« 💸 Subvention d'avance » ouvre une confirmation (« Vendre la subvention (…) ») ;"],
  ],
  "maj-Cahier_7-2.html": [
    ["Toutes expirent au lancer de dés suivant.", "Ces offres et demandes expirent au lancer de dés suivant ; les offres de swap et de compensation, non."],
    ["Une case taxe déjà assurée n'est plus proposée", "Une case taxe déjà assurée par votre entreprise n'est plus proposée"],
    ["<b>plafonne l'indemnité</b> d'un loyer", "<b>plafonne l'indemnité</b> d'un loyer (service : ajusté aux dés)"],
  ],
  "Aide_memoire.html": [
    ["en encaisse ou en bons. Les deux n'exigent aucune marge.", "en encaisse ou en bons, mais compté nu pour le plafond. Les deux n'exigent aucune marge."],
    ["À la banque : comptant immédiat, au prix de rachat. À une entreprise : sur offre que son CEO accepte.", "Part à la banque : comptant immédiat, au prix de rachat. Part ou maisons à une entreprise : sur offre acceptée."],
    ["          <li>Ensuite, l'application passe en consultation : plus aucune action n'est enregistrée.</li>\n        </ul>", "        </ul>\n        <p>Ensuite, l'application passe en consultation : plus aucune action n'est enregistrée.</p>"],
  ],
};
let ok = true;
for (const [f, list] of Object.entries(R)) {
  let s = fs.readFileSync(f, "utf8");
  for (const [a, b] of list) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.log("ÉCHEC", f, n + " occurrence(s) :", a.slice(0, 70)); ok = false; continue; }
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
const J = [
  ["sortie-A/corrections-A.json", "Cahier_3.pdf", 1, "Puts achetés : aucun plafond. Écrites nues (puts compris) : même plafond, compté à part."],
  ["sortie-A/corrections-A.json", "Cahier_3.pdf", 3, "La jambe écrite d'un **bull** spread est un call : la jambe sœur la couvre d'abord, vos parts restent libres. Celle d'un **bear** spread est un put : l'**encaisse** la couvre, **avant** la jambe sœur, recalculée à chaque contrôle — dépenser votre encaisse rend un put écrit nu rétroactivement."],
  ["sortie-A/corrections-A.json", "Cahier_3.pdf", 5, "Contrats couverts = **blocs entiers de 100 parts**. Le reste est nu."],
  ["sortie-B/corrections-B.json", "Cahier_6.pdf", 1, "Trois états : dépasser au moins les deux tiers des autres = bon, au moins la moitié = neutre, sinon mauvais"],
  ["sortie-B/corrections-B.json", "Cahier_8.pdf", 2, "N'y figurent que les lots regroupés, aéroports et services, ni hypothéqués ni déjà en émission."],
];
for (const [f, k, i, nouveau] of J) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!j[k] || !j[k][i]) { console.log("ÉCHEC", f, k, i); ok = false; continue; }
  j[k][i].nouveau = nouveau; j[k][i].raison = (j[k][i].raison || "") + " (retouche de la relecture)";
  fs.writeFileSync(f, JSON.stringify(j, null, 1));
}
console.log(ok ? "tout appliqué" : "ÉCHECS ci-dessus");
