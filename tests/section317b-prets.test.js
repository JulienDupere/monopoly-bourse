// Test — Section 317 (seconde moitié), bogue 97 : « Maximum empruntable » à 0 = illimité pour le moteur, mais l'écran
// affichait « Infinity M$ encore disponible sur un maximum de 0 K$ ».
// Lancer depuis la racine du dépôt :  node tests/section317b-prets.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(max){
  const eng = loadEngine();
  eng.sandbox.alert = () => {};
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])}; state.settings.loanMaxPrincipal = ${max}; state.settings.features.loan = true;`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  return eng;
}

(async () => {
  console.log('Bogue 97 — capacité d\'emprunt illimitée');
  let eng = await setup(0);
  ok(eng.run(`loanCapRemaining(state.companies[0].id)`) === Infinity, 'maximum à 0 : le moteur traite la capacité comme illimitée (Infinity)');
  let tab = eng.run(`renderEntreprise()`);
  ok(!/Infinity/.test(tab), 'l\'onglet Mon Entreprise n\'affiche plus « Infinity »');
  ok(/capacité d&#39;emprunt illimitée|capacité d'emprunt illimitée/.test(tab), 'l\'infobulle du bouton Prêt annonce une capacité illimitée');
  eng.run(`modalIssueLoan()`);
  let m = eng.run(`__modals[__modals.length-1]`);
  ok(/Capacité d'emprunt restante : <b>illimité<\/b>/.test(m), 'la fenêtre de prêt écrit « illimité »');
  ok(!/Infinity/.test(m) && !/max="/.test(m), 'ni « Infinity », ni attribut max invalide dans la fenêtre');
  ok(/sans maximum/.test(m), 'le champ « Capital demandé » précise « sans maximum »');

  // Régression : maximum fixé (5 M$) → affichage inchangé.
  eng = await setup(5);
  tab = eng.run(`renderEntreprise()`);
  ok(/jusqu(&#39;|')à 5\.00 M\$ encore disponible sur un maximum de 5\.00 M\$/.test(tab), 'maximum 5 M$ : « jusqu\'à 5.00 M$ encore disponible sur un maximum de 5.00 M$ » conservé');
  eng.run(`modalIssueLoan()`);
  m = eng.run(`__modals[__modals.length-1]`);
  ok(/Capacité d'emprunt restante : <b>5\.00 M\$<\/b> \(max\. cumulé : 5\.00 M\$\)/.test(m) && /max="5"/.test(m), 'maximum 5 M$ : fenêtre inchangée (restante 5.00 M$, max="5")');

  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
