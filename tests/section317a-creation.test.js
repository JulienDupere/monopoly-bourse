// Test — section 317 (première moitié), bogues 96, 99 et 101 de l'audit du 2026-10-19 : validations de saisie à la
// création d'une partie et d'une entreprise.
//   96. Réglages de création bornés (% du CEO <= 100, réserve REIT, retenues de prêt, paires min/max...), message clair.
//   99. Noms en double refusés : joueurs entre eux, entreprise portant le nom d'un joueur ou d'une autre entreprise.
//  101. Logo d'entreprise : data URL d'image seulement, inséré sans injection possible dans l'écran TV.
// Lancer depuis la racine du dépôt :  node tests/section317a-creation.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { transformContre } = require('./helpers/contre317a');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

function moteur(opts = {}){
  const alerts = [];
  const eng = loadEngine({ transform: transformContre(), globals: { alert: (m) => alerts.push(String(m)) } });
  return { eng, alerts };
}
const nbParties = (eng) => eng.run(`typeof state !== 'undefined' && state && state.players ? state.players.length : 0`);

(async () => {
  console.log('96. Réglages de création');
  const cas = [
    ['% des parts du CEO à 150', { companyCeoStartPct: 1.5 }, /entre 1 et 100/],
    ['% des parts du CEO à 0,5 %', { companyCeoStartPct: 0.005 }, /entre 1 et 100/],
    ['retenue de prêt maximum laissée vide (0)', { loanOfferWithholdingPctMax: 0 }, /laissé vide/],
    ['% des parts du CEO à 0', { companyCeoStartPct: 0 }, /entre 1 et 100/],
    ['réserve REIT à 100 %', { etfBankReservePct: 100 }, /REIT/],
    ['retenue de prêt minimum 50 % > maximum 40 %', { loanOfferWithholdingPctMin: 0.5, loanOfferWithholdingPctMax: 0.4 }, /minimum \(50\.0 %\) dépasse le maximum/],
    ['retenue de prêt maximum 150 %', { loanOfferWithholdingPctMax: 1.5 }, /loyers retenus/],
    ['multiple de prêt minimum 0,5', { loanOfferMultipleMin: 0.5 }, /au moins 1/],
    ['multiple de prêt maximum < minimum', { loanOfferMultipleMin: 2, loanOfferMultipleMax: 1.5 }, /au moins égal au minimum/],
    ['ratios de dividende plancher > plein', { dividendPayoutRatioMin: 0.4, dividendPayoutRatioFull: 0.2 }, /plancher/],
    ['ratio de dividende à 300 %', { dividendPayoutRatioFull: 3 }, /ratios dividende/],
    ['durée de partie min 5 > max 3', { maxGameYearsMin: 5, maxGameYearsMax: 3 }, /minimale dépasse/],
    ['rachat minimum de la banque à 150 %', { bankMinSellPct: 150 }, /minimum de rachat/],
  ];
  for (const [titre, reglages, motif] of cas) {
    const { eng, alerts } = moteur();
    await eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', ${JSON.stringify(reglages)}, [])`);
    ok(alerts.length === 1 && motif.test(alerts[0]) && nbParties(eng) === 0, `${titre} : création refusée, message « ${(alerts[0] || '').slice(0, 70)}… », aucune partie créée`);
  }
  {
    const { eng, alerts } = moteur();
    await eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {companyCeoStartPct: 1, etfBankReservePct: 99, loanOfferWithholdingPctMin: 0.4, loanOfferWithholdingPctMax: 0.4, dividendPayoutRatioMin: 0.25, dividendPayoutRatioFull: 0.25, maxGameYearsMin: 3, maxGameYearsMax: 3}, [])`);
    ok(alerts.length === 0 && nbParties(eng) === 2, 'valeurs limites valides (CEO 100 %, réserve 99 %, min = max) : partie créée sans message');
    const e2 = moteur();
    await e2.eng.run(`createGame(['Alice','Bob'], 50, 1000, 'M$', {}, [])`);
    ok(e2.alerts.length === 0 && nbParties(e2.eng) === 2, 'réglages par défaut : partie créée (rien ne change pour les parties normales)');
  }

  console.log('99. Noms en double');
  {
    const { eng, alerts } = moteur();
    await eng.run(`createGame(['Alex','alex ','Sam'], 50, 1000, 'M$', {}, [])`);
    ok(alerts.length === 1 && /même nom/.test(alerts[0]) && nbParties(eng) === 0, `joueurs « Alex » et « alex  » : création refusée — « ${alerts[0]} »`);
  }
  {
    const { eng, alerts } = moteur();
    await eng.newGame(['Alex', 'Sam', 'Lou'], []);
    const ids = eng.json(`state.players.map(p=>p.id)`);
    await eng.run(`createCompany(${JSON.stringify(ids[1])}, 'Alex', '', 'garp', null, null, null)`);
    ok(eng.run(`state.companies.length`) === 0, 'l’entreprise de Sam ne peut pas s’appeler « Alex » (nom d’un joueur) : non créée');
    ok(alerts.some(a => /nom d'un joueur/.test(a)), `message clair : « ${alerts.find(a => /nom d'un joueur/.test(a))} »`);
    await eng.run(`createCompany(${JSON.stringify(ids[1])}, ' SAM ', '', 'garp', null, null, null)`);
    ok(eng.run(`state.companies.length`) === 0, 'même le nom de son propre CEO (« SAM », casse et espaces ignorés) est refusé');
    await eng.run(`createCompany(${JSON.stringify(ids[1])}, 'Sambuca', '', 'garp', null, null, null)`);
    ok(eng.run(`state.companies.length`) === 1, 'un nom différent est accepté (« Sambuca »)');
    await eng.run(`createCompany(${JSON.stringify(ids[2])}, 'sambuca', '', 'garp', null, null, null)`);
    ok(eng.run(`state.companies.length`) === 1, 'une autre entreprise au même nom (« sambuca ») reste refusée (règle existante)');
  }

  console.log('101. Logo d’entreprise');
  {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const piege = 'x" onerror="alert(1)';
    const piege2 = 'data:image/png;base64,AAAA" onerror="alert(1)';
    const piege3 = 'javascript:alert(1)';
    const piege4 = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
    const { eng } = moteur();
    await eng.newGame(['Alice', 'Bob'], []);
    const ids = eng.json(`state.players.map(p=>p.id)`);
    for (const [i, logo, attendu, titre] of [[0, png, png, 'vraie image PNG'], [1, piege, null, 'logo piégé (guillemet + onerror)']]) {
      await eng.run(`createCompany(${JSON.stringify(ids[i])}, ${JSON.stringify('Soc' + i)}, '', 'garp', null, null, ${JSON.stringify(logo)})`);
      const stocke = eng.run(`state.companies.find(c=>c.name==='Soc${i}').logoDataUrl`);
      ok(stocke === attendu, `${titre} : logo enregistré = ${attendu === null ? 'null' : 'l’image'}`);
    }
    const cid0 = eng.run(`state.companies.find(c=>c.name==='Soc0').id`), cid1 = eng.run(`state.companies.find(c=>c.name==='Soc1').id`);
    const tv0 = eng.run(`tvSlideCompanyShowcase(${JSON.stringify(cid0)})`);
    ok(tv0.includes(`<img src="${png}"`), 'écran TV : la vraie image est affichée');
    // Parties déjà sauvegardées avec un logo piégé : l'affichage se défend aussi.
    for (const mauvais of [piege, piege2, piege3, piege4]) {
      eng.run(`state.companies.find(c=>c.name==='Soc1').logoDataUrl = ${JSON.stringify(mauvais)}`);
      const tv = eng.run(`tvSlideCompanyShowcase(${JSON.stringify(cid1)})`);
      ok(!/onerror|javascript:|<img/i.test(tv), `écran TV : logo « ${mauvais.slice(0, 40)} » jamais inséré (aucune balise img, aucun onerror)`);
    }
    ok(eng.run(`safeLogoDataUrl(${JSON.stringify(png)})`) === png && eng.run(`safeLogoDataUrl(null)`) === null && eng.run(`safeLogoDataUrl(42)`) === null, 'safeLogoDataUrl : image acceptée, null et nombre écartés');
  }

  console.log(`\nOK : section 317a (création) — ${n} vérifications`);
})().catch(e => { console.error(e); process.exit(1); });
