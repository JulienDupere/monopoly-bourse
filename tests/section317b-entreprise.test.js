// Test — Section 317 (seconde moitié), bogues 89 et 90 : libellés de l'onglet Mon Entreprise.
//   89 : « Capitalisation boursière (excl. part de la banque) » : le chiffre inclut en fait la part de la banque.
//   90 : l'attente fixe de 2 M$ du 2e semestre est présentée comme la « moyenne du dernier semestre clos ».
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

  console.log('\nBogue 90 — attente de résultat net du 2e semestre');
  const e2 = await setup();
  const attente = (rolls) => { e2.run(`state.gameClock.rollCount = ${rolls};`); const h = e2.run(`renderEntreprise()`); return (/Pas encore assez d[\s\S]*?\.<\/span>|<span class="money"[^>]*>[^<]*<\/span> <span class="small">\(([^<]*)\)<\/span>/.exec(h) || [])[0] || ''; };
  const s2 = attente(3);
  ok(/\+2\.00 M\$/.test(s2), `2e semestre : l'attente fixe de +2,00 M$ est affichée (${s2.replace(/<[^>]*>/g, '')})`);
  ok(!/moyenne/.test(s2), `2e semestre : ne parle plus de « moyenne » (${s2.replace(/<[^>]*>/g, '')})`);
  ok(/attente fixe de départ du 2e semestre/.test(s2), '2e semestre : « attente fixe de départ du 2e semestre, sans lien avec vos résultats »');
  const s1 = attente(0);
  ok(!/moyenne des 0/.test(s1), `1er semestre : plus de « moyenne des 0 dernier(s) semestre(s) » (${s1.replace(/<[^>]*>/g, '')})`);
  const s3 = attente(6);
  ok(/moyenne|résultat net du dernier/.test(s3) && !/attente fixe/.test(s3), `3e semestre : vraie moyenne des semestres clos (${s3.replace(/<[^>]*>/g, '')})`);
  const s4 = attente(9);
  ok(/moyenne des 3 derniers semestres clos|moyenne des 2 derniers semestres clos/.test(s4), `4e semestre : « moyenne des N derniers semestres clos » (${s4.replace(/<[^>]*>/g, '')})`);

  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
