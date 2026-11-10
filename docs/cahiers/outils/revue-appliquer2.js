// Reprise des remplacements qui butaient sur les espaces insécables (U+00A0) et les fins de ligne CRLF,
// puis typographie française (U+00A0) dans le texte de <main> des pages « Mise à jour ».
const fs = require("fs");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tolerant = a => new RegExp(a.split(/(\n| )/).map(p => p === "\n" ? "\\r?\\n" : p === " " ? "[ \\u00a0]" : esc(p)).join(""), "g");
const R = {
  "maj-Cahier_0.html": [
    ["L'application a été corrigée en octobre 2026 : voici ce qui change pour toute la table.", "L'application a été corrigée en octobre 2026. La page 13 a été corrigée en place ; voici ce qui change pour toute la table."],
    ["compte les années à partir de 1, comme les états financiers :", "compte les années à partir de 1 :"],
  ],
  "maj-Cahier_1.html": [
    ["Un ask qui rendrait nues des options écrites au-delà du plafond (cahier n<sup>o</sup> 3) n'est pas exécuté : il reste en attente.", "Une vente de parts, au comptant ou par ask, qui rendrait nues des options écrites au-delà du plafond (cahier n<sup>o</sup> 3) est refusée ; l'ask reste en attente."],
  ],
  "maj-Cahier_5.html": [
    ["au prorata : lot gagné à 9 M$ au lancer 7, fin au lancer 8, prix 1,50 M$.", "au prorata des lancers écoulés depuis l'enchère : lot gagné à 9 M$, fin un lancer plus tard, prix 9 × 1/6 = 1,50 M$."],
  ],
  "maj-Cahier_6.html": [
    ["hors part de la banque : 0,3 M$ dont 0,21 M$ à la banque, bénéfice 0,2 M$ : ratio 45 %", "hors part de la banque. Exemple : 0,3 M$ dont 0,21 M$ à la banque, bénéfice 0,2 M$ → ratio 45 %"],
  ],
  "maj-Cahier_7-1.html": [
    ["rapporte au moins 1,25 M$.", "rapporte au moins 1,25 M$ (réglages par défaut)."],
    ["« Vendre la prochaine subvention d'avance » ouvre une confirmation ;", "« 💸 Subvention d'avance » ouvre une confirmation (« Vendre la subvention (…) ») ;"],
  ],
  "Aide_memoire.html": [
    ["          <li>Ensuite, l'application passe en consultation : plus aucune action n'est enregistrée.</li>\n        </ul>", "        </ul>\r\n        <p>Ensuite, l'application passe en consultation : plus aucune action n'est enregistrée.</p>"],
  ],
};
let ok = true;
for (const [f, list] of Object.entries(R)) {
  let s = fs.readFileSync(f, "utf8");
  for (const [a, b] of list) {
    const re = tolerant(a); const n = (s.match(re) || []).length;
    if (n !== 1) { console.log("ÉCHEC", f, n, a.slice(0, 60)); ok = false; continue; }
    s = s.replace(re, () => b);
  }
  fs.writeFileSync(f, s);
}
// Typographie : U+00A0 avant : ; ! ? » % et entre un chiffre et M$/K$/$, après «, dans le texte de <main> seulement.
for (const f of fs.readdirSync(".").filter(f => /^maj-.*\.html$/.test(f))) {
  let s = fs.readFileSync(f, "utf8");
  const i = s.indexOf("<main>"), j = s.indexOf("</main>");
  const main = s.slice(i, j).replace(/>([^<]*)</g, (m, t) => ">" + t
    .replace(/ ([:;!?»%])/g, " $1").replace(/« /g, "« ").replace(/(\d) (M\$|K\$|\$)/g, "$1 $2") + "<");
  s = s.slice(0, i) + main + s.slice(j);
  fs.writeFileSync(f, s);
}
console.log(ok ? "tout appliqué" : "ÉCHECS ci-dessus");
