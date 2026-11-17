// Test — Section 317 (seconde moitié), bogues 89 et 90 : libellés de l'onglet Mon Entreprise.
//   89 : « Capitalisation boursière (excl. part de la banque) » : le chiffre inclut en fait la part de la banque.
//   90 : l'attente fixe de 2 M$ du 2e semestre (remplacée en section 323 par les trois analystes : le test vérifie qu'elle a disparu).
// Lancer depuis la racine du dépôt :  node tests/section317b-entreprise.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts = {}){
  const eng = loadEngine(opts);
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
  return eng;
}

(async () => {
  console.log('Bogue 89 — libellé de la capitalisation boursière');
  const eng = await setup();
  const info = eng.json(`(function(){ const c = state.companies[0]; const bank = c.shareholders.find(s=>s.playerId==='BANK'); return {issued: c.sharesIssued, bank: bank.shares, price: c.stockPrice}; })()`);
  console.log('  parts émises', info.issued, ', banque', info.bank, ', prix', info.price);
  ok(info.bank > 0.5 * info.issued, 'la banque détient la majorité des parts émises (IPO)');
  const html = eng.run(`renderEntrepriseFinancials(state.companies[0])`);
  const ligne = (/<tr><td>Capitalisation boursière[\s\S]*?<\/tr>/.exec(html) || [''])[0];
  ok(ligne.length > 0, 'la ligne « Capitalisation boursière » est affichée');
  ok(!/excl\. part de la banque/.test(ligne), 'le libellé ne promet plus « excl. part de la banque »');
  ok(/part de la banque comprise/.test(ligne), 'le libellé annonce « part de la banque comprise »');
  // Le chiffre est bien prix × toutes les parts émises (banque comprise) : le libellé correspond désormais au calcul.
  const cap = eng.run(`(function(){ const c = state.companies[0]; return c.stockPrice * c.sharesIssued; })()`);
  const capHorsBanque = info.price * (info.issued - info.bank);
  const ratios = eng.run(`companyRatiosForPeriod(state.companies[0], {period: {isCurrent:true, semesterIndex:0}, inc: incomeStatementFor(state.companies[0].id, 0), bs: null}, null).marketCap`);
  ok(ratios == null || near(ratios, cap, 1e-9), `capitalisation calculée = prix × parts émises = ${cap} (hors banque ce serait ${capHorsBanque})`);

  // Section 323 : l'attente fixe de départ (+2 M$ au 2e semestre) n'existe plus ; le bloc « Attentes des analystes »
  // (trois analystes) la remplace. Le contrôle du bogue 90 devient : plus aucun chiffre fixe « sans lien avec ses résultats ».
  console.log('\nBogue 90 — l\'attente fixe de départ a disparu (section 323)');
  const e2 = await setup();
  for(const rolls of [0, 3, 6, 9]){
    e2.run(`state.gameClock.rollCount = ${rolls};`);
    const h = e2.run(`renderEntreprise()`);
    ok(!/attente fixe de départ|attente de départ/.test(h), `${rolls} lancers : plus d'attente fixe de départ`);
    ok(/Attentes des analystes/.test(h) && /Modélisateur/.test(h), `${rolls} lancers : le bloc des trois analystes est affiché`);
  }

  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
