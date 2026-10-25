// Test — Section 317 (seconde moitié), bogue 95 : la même période portait deux numéros d'année selon l'écran.
// Avant : barre du haut, journal et enchères comptaient à partir de 0 (indice interne currentGameYear()), les états
// financiers à partir de 1 (« Année 1, Semestre 1 »). Au lancer 6, la barre affichait « Année : 1 » et les états
// « Année 2, Semestre 1 ».
// Après (décision de Julien : « corriger la double numérotation des années ET réécrire clairement les libellés ») :
// une seule numérotation, celle des états financiers (année 1 = première année), partout où le joueur lit un numéro
// d'année ; l'indice interne (clé des enchères, du plafond de vente CEO, de la durée cachée) ne change pas.
// Lancer depuis la racine du dépôt :  node tests/section317b-annees.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts = {}){
  const doc = creerDocument();
  const eng = loadEngine({ transform: opts.transform, globals: { document: doc, alert: () => {} } });
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push(String(msg)); return __realLog.apply(this, arguments); };`);
  return { eng, doc };
}
const barreAnnee = (eng, doc) => { eng.run(`render()`); const h = doc.trouver('app').innerHTML; return (/Année : <b>(\d+)<\/b> \(semestre (\d)\/2 — (\d)\/3 lancers faits\)/.exec(h) || []).slice(1).map(Number); };
const etatAnnee = (eng) => { const p = eng.json(`financialPeriods().find(p=>p.isCurrent)`); const m = /Année (\d+), Semestre (\d)/.exec(p.label); return [Number(m[1]), Number(m[2])]; };

(async () => {
  console.log('Bogue 95 — une seule numérotation des années');
  const { eng, doc } = await setup();
  // La barre du haut et les états financiers montrent la MÊME année et le même semestre à chaque lancer.
  const lignes = [];
  for(const rolls of [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 17, 18]){
    eng.run(`state.gameClock.rollCount = ${rolls};`);
    const [ya, sa, ra] = barreAnnee(eng, doc), [yb, sb] = etatAnnee(eng);
    lignes.push(`lancer ${rolls} : barre ${ya}/${sa} (${ra}/3), états ${yb}/${sb}`);
    ok(ya === yb && sa === sb && ra === rolls % 3, `lancer ${rolls} : barre du haut « Année ${ya}, semestre ${sa}, ${ra}/3 lancers faits » = états financiers « Année ${yb}, Semestre ${sb} »`);
  }
  eng.run(`state.gameClock.rollCount = 0;`);
  ok(barreAnnee(eng, doc)[0] === 1, 'au tout début de la partie la barre du haut affiche l\'année 1 (et non 0)');
  eng.run(`state.gameClock.rollCount = 6;`);
  ok(barreAnnee(eng, doc)[0] === 2 && etatAnnee(eng)[0] === 2, 'au lancer 6 : année 2 partout (avant : barre « 1 », états « 2 »)');

  // Journal : le passage d'année annonce l'année qui commence avec le numéro des états financiers.
  eng.run(`state.gameClock.rollCount = 5; __logs.length = 0; advanceGameClock();`);
  const passage = eng.json(`__logs.find(l=>l.indexOf("année financière") >= 0 && l.indexOf("commence") >= 0)`);
  ok(/L'année financière 2 commence/.test(passage), `le journal annonce « L'année financière 2 commence » au lancer 6 (${passage && passage.slice(0, 50)}) — avant : « 1 »`);
  ok(etatAnnee(eng)[0] === 2, 'au même moment, les états financiers sont en « Année 2 »');

  // Enchères (lot commercial, REIT) : le numéro d'année affiché est le même.
  eng.run(`state.gameClock.rollCount = 7; state.terrainLot.bids = []; state.terrainLot.active = null;`);
  const tlHtml = eng.run(`(function(){ return displayGameYear(); })()`);
  ok(tlHtml === 2, 'displayGameYear() au lancer 7 = 2 (indice interne currentGameYear() = 1, inchangé)');
  ok(eng.run(`currentGameYear()`) === 1, 'l\'indice interne currentGameYear() reste 0-based (clé des enchères, plafond CEO, durée cachée)');
  // Résolution du lot commercial : le journal cite l'année affichée.
  eng.run(`__logs.length = 0; state.terrainLot.bids.push({companyId: state.companies[0].id, price: 0.1, loyer: 0.05, numSquares: 1}); resolveTerrainLotAuction(currentGameYear());`);
  ok(eng.json(`__logs.some(l=>/enchère du lot commercial de l'année 2:/.test(l))`), 'enchère du lot commercial au lancer 7 : « de l\'année 2 » (avant : « 1 »)');
  // Fin d'année du lot commercial.
  eng.run(`__logs.length = 0; settleTerrainLotYearEnd(1, 12);`);
  ok(eng.json(`__logs.some(l=>/Lot commercial de l'année 2 réglé/.test(l))`), 'règlement du lot commercial de la 2e année : « année 2 réglé »');

  // Durée de partie inchangée : la fin se déclenche toujours sur l'indice interne (une plage N–N donne N+1 années jouées).
  const dur = await setup();
  dur.eng.run(`state.hiddenGameLengthTargetYear = 1; state.gameClock.rollCount = 10;`);
  dur.eng.run(`advanceGameClock(); advanceGameClock();`); // lancers 11 puis 12 : l'indice interne passe de 1 à 2 > cible 1
  ok(dur.eng.run(`!!state.gameEndedReason && state.gameEndedReason.reason`) === 'maxDuration' && dur.eng.run(`state.gameClock.rollCount`) === 12, 'durée cachée de 1 an : la partie finit au passage à l\'indice 2 (lancer 12), soit après 2 années jouées — mécanique inchangée');

  // Tableau de bord TV.
  eng.run(`state.gameClock.rollCount = 6;`);
  const tv = eng.run(`tvSlideYear()`);
  ok(/<div class="tv-big">2<\/div>/.test(tv) && /0\/3 lancers de dés faits ce semestre/.test(tv), 'écran TV : « 2 » et « 0/3 lancers de dés faits ce semestre »');

  // Contre-épreuve : indice interne affiché dans la barre → écart avec les états financiers.
  const X = await setup({ transform: s => s.replace('Année : <b>${displayGameYear()}</b>', 'Année : <b>${currentGameYear()}</b>') });
  X.eng.run(`state.gameClock.rollCount = 6;`);
  const [yx] = barreAnnee(X.eng, X.doc), [ye] = etatAnnee(X.eng);
  ok(yx !== ye, `contre-épreuve (ancien code) : barre « ${yx} » ≠ états « ${ye} » — le test détecte la régression`);

  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
