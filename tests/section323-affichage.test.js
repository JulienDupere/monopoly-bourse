// Test — section 323 (lot affichage) : onglet Entreprise « Attentes des analystes », graphique « cible et résultat réel »,
// ligne de verdict de la fenêtre « Résultats du tour » (contrat docs/contrats/section-323-analystes.md, section 4), avec
// la ronde de corrections : A1 libellé de la cible selon le nombre d'analystes, A2 montants nuls « 0 » et un seul signe
// moins (U+2212), A3 « intérêts et charges » avec le bon signe, A4 partie terminée, A5 périodes choisies par l'écran,
// A6 bénéfice jugé quand il diffère du bénéfice officiel.
//   A. Bloc de l'onglet Entreprise dans les quatre états (provisoire, publié, pas de verdict, analyste absent), zone
//      « de … à … » juste sur un exemple chiffré, détail du modélisateur, rappel de la règle (tailles lues dans les constantes).
//   B. Graphique : aucun historique (message court), puis les cinq sortes de verdict, bande, cible et table.
//   C. Fenêtre du tour : ligne de verdict seulement au dernier lancer d'un semestre jugé.
//   D. Ancienne partie migrée (ni prévision ni historique) : tout s'affiche sans erreur.
//   E. Versions cassées exprès (option transform) : chacune doit faire échouer le même jeu de vérifications.
// Lancer depuis la racine du dépôt :  node tests/section323-affichage.test.js
const { loadEngine } = require('./helpers/engine');

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}
const strip = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const MINUS = '\u2212';
// A2 : ni « +0 », ni « −0 », ni signe moins ASCII devant un chiffre dans un texte affiché.
const signesPropres = t => !/(^|[\s(])[-+\u2212]0( |$|[.,)])/.test(t) && !/(^|[\s(])-\d/.test(t);
const swap = (a, b) => (src) => { if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 70)); return src.split(a).join(b); };
const chain = (...fs) => (src) => fs.reduce((s, f) => f(s), src);
// Tailles de cubes d'essai (7 au lieu de 5) : le rappel de la règle doit lire la constante, pas un chiffre écrit en dur.
const TAILLE_7 = swap('ANALYST_VERDICT_STRONG_CUBES = 5', 'ANALYST_VERDICT_STRONG_CUBES = 7');

async function boot(transform){
  const eng = loadEngine({ transform, globals: { alert: () => {} } });
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])}; globalThis.A = state.companies[0];`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  return eng;
}
const bloc = (eng) => strip(eng.run(`analystExpectationBlockHtml(A)`));
// Prévision figée d'exemple : cible 2, zone 0,5 (de 1,5 à 2,5), les trois analystes présents.
const FIGEE = `A.analystForecast = {semester:0, h:1, m:2, k:3, sigma:0.4, target:2, zone:0.5, parts:{subsidy:1.2, rentsIn:3, rentsOut:0.8, taxes:0.4, charges:0.1}, frozenAtRoll:0};`;

async function suite(transform, taille7){
  const eng = await boot(transform);

  console.log('\nA. Onglet Entreprise : le bloc des trois analystes');
  // État 1 : provisoire (rollCount 0, rien de figé), historien absent (0 semestre clos).
  eng.run(`state.gameClock.rollCount = 0; A.analystForecast = null;`);
  let t = bloc(eng);
  console.log('   ' + t);
  ok(/Historien absent l'entreprise n'a pas encore 2 semestres clos/.test(t), 'historien absent, avec la raison (pas encore 2 semestres clos)');
  ok(/Modélisateur ([+\u2212]\d|0 )/.test(t) && /ce que le parc devrait rapporter en 3 lancers/.test(t), 'modélisateur : un chiffre signé et son explication');
  ok(/Marché [+\u2212]\d[\d.]* [KM]\$ /.test(t) || /Marché absent/.test(t), 'marché : un chiffre ou « absent »');
  ok(signesPropres(t), 'A2 : aucun « +0 » ni « −0 », aucun signe moins ASCII (provisoire)');
  ok(/Chiffres provisoires : ils bougent jusqu'au premier lancer du semestre\./.test(t), 'état provisoire : texte exact');
  ok(!/Chiffres publiés\.|Pas de verdict ce semestre/.test(t), 'état provisoire : ni « publiés » ni « pas de verdict »');
  const f0 = eng.json(`analystForecastFor(A)`);
  ok(f0.frozen === false && f0.verdictPossible === true && f0.h === null, 'le moteur confirme : provisoire, verdict possible, historien absent');
  ok(/Cible \(/.test(t) && /zone acceptable de/.test(t), 'cible et zone acceptable présentes');

  // État 2 : publié (figé au premier lancer), on pose des chiffres connus pour vérifier la zone.
  eng.run(FIGEE);
  t = bloc(eng);
  console.log('   ' + t);
  ok(/Chiffres publiés\./.test(t) && !/provisoires|Pas de verdict/.test(t), 'état publié : « Chiffres publiés. » seulement');
  ok(/Historien \+1\.00 M\$/.test(t), 'historien +1,00 M$ avec son explication');
  ok(/Modélisateur \+2\.00 M\$/.test(t) && /Marché \+3\.00 M\$/.test(t), 'modélisateur +2,00 M$ et marché +3,00 M$');
  ok(/Cible \(l'analyste du milieu\) : \+2\.00 M\$ — zone acceptable de \+1\.50 M\$ à \+2\.50 M\$/.test(t), 'cible +2,00 M$ ; zone de +1,50 à +2,50 M$ (cible ∓ demi-largeur 0,5)');
  ok(/Détail du modélisateur : subvention de départ \+1\.20 M\$, loyers reçus \+3\.00 M\$, loyers payés \u2212800 K\$, taxes \u2212400 K\$, intérêts et charges \u2212100 K\$\./.test(t), 'détail du modélisateur sur une ligne (subvention, loyers reçus, loyers payés, taxes, intérêts et charges)');
  ok(/Cible \(l'analyste du milieu\) :/.test(t), "A1 : trois analystes présents : « Cible (l'analyste du milieu) »");
  ok(/dans la zone, 0 ou 1 cube du côté de l'écart \(vert au-dessus de la cible, rouge en dessous\)/.test(t) && /analystes divisés donnent un verdict normal \(2 cubes\)/.test(t) && new RegExp('tous du même avis un verdict fort \\(' + (taille7 ? 7 : 5) + ' cubes\\)').test(t), 'rappel de la règle (D1, D2) : zone 0 ou 1 cube du côté de l\'écart, verdict normal 2 cubes, verdict fort ' + (taille7 ? 7 : 5) + ' cubes (constantes du moteur)');

  // Zone sous zéro et cible négative : « de … à … » reste juste.
  eng.run(`A.analystForecast.target = -1; A.analystForecast.zone = 0.5; A.analystForecast.h = null;`);
  t = bloc(eng);
  ok(/Cible \(le milieu entre les deux analystes présents\) : \u22121\.00 M\$ — zone acceptable de \u22121\.50 M\$ à \u2212500 K\$/.test(t), 'cible négative : zone de −1,50 M$ à −500 K$ (signe moins U+2212)');
  ok(/Historien absent/.test(t), 'analyste absent (h = null) : « absent » écrit à sa place');
  ok(signesPropres(t), 'A2 : signes propres (cible négative)');
  console.log('   A1 (2 analystes) : ' + (/Cible \([^)]*\)/.exec(t) || [''])[0]);

  // Marché absent.
  // Ronde finale (R3) : la raison suit kAbsent (gardé avec les chiffres figés).
  eng.run(`A.analystForecast.k = null; A.analystForecast.kAbsent = 'capNotPositive';`);
  t = bloc(eng);
  ok(/Marché absent la capitalisation du marché n'est pas positive/.test(t), 'marché absent : « absent » avec la raison (capitalisation du marché pas positive)');
  eng.run(`A.analystForecast.kAbsent = 'fewCompanies';`);
  ok(/Marché absent moins de 2 entreprises à capitalisation positive : pas de deuxième avis/.test(bloc(eng)), 'R3 : marché absent faute de 2 entreprises à capitalisation positive : la vraie raison');
  {
    // Chiffres provisoires calculés par le moteur : une seule entreprise à capitalisation positive, puis aucune.
    const e1 = await boot(transform);
    e1.run(`state.gameClock.rollCount = 0; state.companies.forEach(c=>{ c.analystForecast = null; }); state.companies[1].stockPrice = 0;`);
    const t1 = bloc(e1);
    ok(e1.json(`analystForecastFor(A).kAbsent`) === 'fewCompanies' && /Marché absent moins de 2 entreprises à capitalisation positive/.test(t1) && !/capitalisation du marché n'est pas positive/.test(t1),
      'R3 : une seule entreprise à capitalisation positive (moteur) : « moins de 2 entreprises… », pas « capitalisation pas positive »');
    e1.run(`state.companies.forEach(c=>{ c.stockPrice = 0; });`);
    ok(e1.json(`analystForecastFor(A).kAbsent`) === 'capNotPositive' && /Marché absent la capitalisation du marché n'est pas positive/.test(bloc(e1)), 'R3 : aucune capitalisation positive (moteur) : « la capitalisation du marché n\'est pas positive »');
    e1.run(`state.companies.forEach(c=>{ c.stockPrice = 2; });`);
    ok(e1.json(`analystForecastFor(A).kAbsent`) === null && !/Marché absent/.test(bloc(e1)), 'R3 : deux capitalisations positives : marché présent, kAbsent null');
    e1.run(`state.companies[1].stockPrice = 0; freezeAnalystForecasts(); state.companies[1].stockPrice = 2;`);
    ok(e1.json(`analystForecastFor(A).frozen`) === true && /moins de 2 entreprises à capitalisation positive/.test(bloc(e1)), 'R3 : raison figée avec les chiffres (le marché revenu après le gel ne la change pas)');
  }
  eng.run(`A.analystForecast.kAbsent = 'capNotPositive';`);
  ok(/Cible \(le chiffre du seul analyste présent\) : −1\.00 M\$/.test(t), "A1 : un seul analyste présent : « Cible (le chiffre du seul analyste présent) »");
  console.log('   A1 (1 analyste) : ' + (/Cible \([^)]*\) : \S+ \S+/.exec(t) || [''])[0]);

  // A2 et A3 : montants nuls, prêteur (intérêts et charges = revenu net), intérêts hypothécaires de fin d'année.
  eng.run(`A.analystForecast = {semester:0, h:0.0002, m:0, k:-0.0004, sigma:0, target:0, zone:0.5, parts:{subsidy:0, rentsIn:1.4, rentsOut:0, taxes:0, charges:-1.4, mortgage:-1.4}, frozenAtRoll:0};`);
  t = bloc(eng);
  console.log('   ' + t.slice(0, t.indexOf('Chiffres')));
  ok(/Historien 0 /.test(t) && /Modélisateur 0 /.test(t) && /Marché 0 /.test(t) && /Cible \(l'analyste du milieu\) : 0 — zone acceptable de \u2212500 K\$ à \+500 K\$/.test(t), 'A2 : montants nuls écrits « 0 », sans signe (+0,2 K$ et −0,4 K$ arrondis compris)');
  ok(/loyers payés 0, taxes 0, intérêts et charges \+1\.40 M\$ \(dont intérêts hypothécaires de fin d'année \+1\.40 M\$, comptés tels que prévus ici au verdict\)\./.test(t) && !/\u2212-|−-/.test(t),
    'A3 : prêteur : « intérêts et charges +1,40 M$ » (revenu net, plus de « −-1.40 M$ »), intérêts hypothécaires reçus signalés');
  ok(signesPropres(t), 'A2 : signes propres (montants nuls)');

  // A4 : partie terminée pendant la fenêtre (chiffres provisoires) puis avec des chiffres publiés.
  eng.run(`A.analystForecast = null; state.gameClock.rollCount = 0; state.gameEndedReason = {reason:'maxDuration', roll:0, year:0};`);
  t = bloc(eng);
  ok(/Partie terminée : plus aucun lancer, ces chiffres ne seront pas publiés\./.test(t) && !/premier lancer/.test(t), "A4 : partie terminée dans la fenêtre : plus de « provisoires jusqu'au premier lancer »");
  console.log('   A4 : ' + (/Partie terminée[^.]*\./.exec(t) || [''])[0]);
  eng.run(FIGEE);
  t = bloc(eng);
  ok(/Chiffres publiés, mais la partie est terminée : ce semestre ne sera pas clos, pas de verdict\./.test(t), 'A4 : partie terminée avec des chiffres publiés : pas de verdict annoncé');
  eng.run(`state.gameEndedReason = null;`);

  // État 3 : pas de verdict (semestre commencé sans chiffres figés).
  eng.run(`A.analystForecast = null; state.gameClock.rollCount = 1;`);
  t = bloc(eng);
  console.log('   ' + t);
  ok(/Pas de verdict ce semestre : les chiffres n'ont pas été publiés au début du semestre\./.test(t), 'état « pas de verdict » : texte exact');
  ok(!/Chiffres provisoires|Chiffres publiés/.test(t), 'état « pas de verdict » : pas de fausse promesse (ni provisoire ni publié)');

  // Tailles de cubes lues dans les constantes (transformées à 7 par TAILLE_7 pour ce contrôle).
  if(taille7){
    ok(/verdict fort \(7 cubes\)/.test(bloc(eng)), 'tailles lues dans la constante : 7 cubes quand la constante vaut 7');
  }

  // Le bloc est bien dans la page de l'onglet.
  eng.run(`state.gameClock.rollCount = 0; A.analystForecast = null;`);
  const page = strip(eng.run(`renderEntreprise()`));
  ok(/Attentes des analystes \(ce semestre\)/.test(page) && /Historien/.test(page), "l'onglet Entreprise affiche « Attentes des analystes (ce semestre) »");
  ok(!/Bénéfice net attendu par les analystes/.test(page), "l'ancien titre « Bénéfice net attendu par les analystes » a disparu");

  console.log('\nB. Graphique « cible et résultat réel »');
  eng.run(`A.analystHistory = [];`);
  const vide = eng.run(`expectationVsActualChartHtml(A, [])`);
  ok(strip(vide) === 'Pas encore de semestre jugé par les analystes.' && !/<svg/.test(vide), 'aucun historique : message court, pas de graphique');
  eng.run(`A.analystHistory = [
    {semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:2.2, verdict:'zone', beaten:1, of:1, color:null, qty:0},
    {semester:1, h:1, m:2, k:3, target:2, zone:0.5, actual:2.8, verdict:'normalUp', beaten:2, of:3, color:'green', qty:2},
    {semester:2, h:1, m:2, k:3, target:2, zone:0.5, actual:3.6, verdict:'strongUp', beaten:3, of:3, color:'green', qty:5},
    {semester:3, h:1, m:2, k:3, target:2, zone:0.5, actual:1.2, verdict:'normalDown', beaten:1, of:3, color:'red', qty:2},
    {semester:4, h:1, m:2, k:3, target:2, zone:0.5, actual:-0.4, verdict:'strongDown', beaten:0, of:3, color:'red', qty:5}];`);
  const g = eng.run(`expectationVsActualChartHtml(A, [])`);
  const gt = strip(g);
  console.log('   ' + gt.slice(gt.indexOf('Semestre')));
  ok(/<svg/.test(g) && (g.match(/<circle cx=/g) || []).length === 5 + 1, 'cinq points de bénéfice réel dessinés (plus celui de la légende)');
  ok((g.match(/<rect x=.*? opacity="0.16"/g) || []).length === 5 + 1, 'cinq bandes de zone (plus celle de la légende)');
  ok(/Dans la zone/.test(g) && /Au-dessus/.test(g) && /Sous la zone/.test(g) && /verdict fort/.test(g) && /verdict normal/.test(g), 'verdicts en clair sous le graphique');
  ok(/Semestre 1 \+2\.00 M\$ \+1\.50 M\$ à \+2\.50 M\$ \+2\.20 M\$ dans la zone — aucun cube/.test(gt) && !/dans la zone — 1 analyste/.test(gt), 'ligne 1 : « dans la zone — aucun cube » (D2 : les analystes battus ne jouent aucun rôle dans la zone)');
  ok(/Semestre 2 \+2\.00 M\$ \+1\.50 M\$ à \+2\.50 M\$ \+2\.80 M\$ au-dessus de la zone \(verdict normal\) — 2 analystes battus sur 3 — 2 cubes verts/.test(gt), 'ligne 2 : au-dessus, verdict normal, 2 cubes verts');
  ok(/Semestre 3 [^|]*?au-dessus de la zone \(verdict fort\) — 3 analystes battus sur 3 — 5 cubes verts/.test(gt), 'ligne 3 : au-dessus, verdict fort, 5 cubes verts');
  ok(/Semestre 4 [^|]*?sous la zone \(verdict normal\) — 1 analyste battu sur 3 — 2 cubes rouges/.test(gt), 'ligne 4 : sous la zone, verdict normal, 2 cubes rouges');
  ok(/Semestre 5 [^|]*?\u2212400 K\$ sous la zone \(verdict fort\) — 0 analyste battu sur 3 — 5 cubes rouges/.test(gt), 'ligne 5 : sous la zone, verdict fort, 5 cubes rouges (bénéfice négatif, signe U+2212)');
  ok(signesPropres(gt), 'A2 : signes propres dans le graphique et sa table (axes compris)');
  // Couleurs de sens : vert au-dessus (normal ET fort), rouge en dessous, gris dans la zone.
  const cl = (label) => { const m = new RegExp(`color:([^;]+);font-weight:600;">${label}`).exec(g); return m && m[1]; };
  ok(cl('au-dessus de la zone \\(verdict normal\\)') === '#047857' && cl('au-dessus de la zone \\(verdict fort\\)') === '#047857', 'au-dessus de la zone (normal et fort) : vert');
  ok(cl('sous la zone \\(verdict normal\\)') === 'var(--brick)' && cl('sous la zone \\(verdict fort\\)') === 'var(--brick)', 'sous la zone : rouge du jeu');
  ok(cl('dans la zone') === '#64748b', 'dans la zone : gris');
  // A5 : avec des périodes, le graphique montre ces périodes-là (et seulement elles), avec leurs libellés.
  const g2 = eng.run(`expectationVsActualChartHtml(A, [{semesterIndex:1, label:'Année 1, Semestre 2', isCurrent:false}])`);
  const g2t = strip(g2);
  ok(/Année 1, Semestre 2 \+2\.00 M\$/.test(g2t) && !/Semestre 1 |Semestre 3|Semestre 4|Semestre 5/.test(g2t) && (g2.match(/<circle cx=/g) || []).length === 1 + 1,
    'A5 : une seule période choisie : une seule colonne (son libellé), pas les cinq semestres de l\'historique');
  eng.run(`A.analystHistory = []; for(let s=0; s<40; s++) A.analystHistory.push({semester:s, h:null, m:1, k:null, target:1, zone:0.5, actual:1.1, judged:1.1, adjust:0, verdict:'zone', beaten:1, of:1, color:null, qty:0});
    state.gameClock.rollCount = 120; A.analystForecast = null;`);
  const per = `[{semesterIndex:38, label:'Année 20, Semestre 1', isCurrent:false}, {semesterIndex:39, label:'Année 20, Semestre 2', isCurrent:false}, {semesterIndex:40, label:'Année 21, Semestre 1', isCurrent:true}]`;
  const g3 = eng.run(`expectationVsActualChartHtml(A, ${per})`), g3t = strip(g3);
  console.log('   A5 : ' + g3t.slice(g3t.indexOf('Semestre Cible')));
  ok((g3.match(/<tr><td>/g) || []).length === 3 && (g3.match(/>Dans la zone</g) || []).length === 2 && /En cours/.test(g3) && /Année 21 Semestre 1 [^|]*en cours \(chiffres provisoires\)/.test(g3t),
    'A5 : 40 semestres jugés, 3 périodes choisies : 3 colonnes (2 jugées, la période en cours avec sa cible provisoire)');
  const g4 = strip(eng.run(`expectationVsActualChartHtml(A, [{semesterIndex:0, label:'Année 1, Semestre 1', isCurrent:false}, {semesterIndex:41, label:'Année 21, Semestre 2', isCurrent:false}])`));
  ok(/Année 21, Semestre 2 – – – pas de verdict/.test(g4), 'A5 : période sans ligne d\'historique : « pas de verdict », rien d\'inventé');
  ok(/Semestre 1/.test(strip(eng.run(`expectationVsActualChartHtml(A, [])`))), 'sans périodes : les semestres de l\'historique (« Semestre N »)');
  eng.run(`state.gameClock.rollCount = 0;`);

  // A6 : bénéfice jugé différent du bénéfice officiel (intérêts hypothécaires rejugés).
  eng.run(`A.analystHistory = [{semester:1, h:null, m:0.5, k:null, target:0.5, zone:0.5, actual:1.0, judged:0.6, adjust:-0.4, verdict:'zone', beaten:1, of:1, color:null, qty:0}];`);
  const g6 = eng.run(`expectationVsActualChartHtml(A, [])`), g6t = strip(g6);
  console.log('   A6 (tableau) : ' + g6t.slice(g6t.indexOf('Semestre 2')));
  ok(/Semestre 2 \+500 K\$ 0 à \+1\.00 M\$ \+1\.00 M\$ bénéfice jugé \+600 K\$ : intérêts hypothécaires de fin d'année comptés tels que prévus au premier lancer du semestre, ajustement de \u2212400 K\$ dans la zone/.test(g6t),
    'A6 : tableau du graphique : bénéfice officiel +1,00 M$, puis le bénéfice jugé +600 K$ et son explication');
  ok(/fill="none"/.test(g6) && /Bénéfice jugé/.test(g6) && /Bénéfice officiel/.test(g6), 'A6 : graphique : point plein au bénéfice jugé, cercle creux au bénéfice officiel, légende des deux');
  // Historique abîmé (anciennes lignes sans nombres) : ignoré sans erreur.
  eng.run(`A.analystHistory = [null, {semester:0}, {semester:1, target:1, zone:0.5, actual:1, verdict:'zone', beaten:1, of:1, color:null, qty:0}];`);
  ok(/Semestre 2/.test(strip(eng.run(`expectationVsActualChartHtml(A, [])`))), 'lignes incomplètes ignorées, la ligne valable est dessinée');
  ok(/Bénéfice net : cible des analystes et résultat réel/.test(strip(eng.run(`renderEntrepriseFinancials(A)`))), 'titre du graphique : « Bénéfice net : cible des analystes et résultat réel »');

  // D2 : dans la zone, 0 ou 1 cube du côté de l'écart (la ligne garde la couleur du côté et la quantité tirée).
  eng.run(`A.analystHistory = [{semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:2.3, judged:2.3, adjust:0, verdict:'zone', beaten:1, of:1, color:'green', qty:1},
    {semester:1, h:null, m:2, k:null, target:2, zone:0.5, actual:1.8, judged:1.8, adjust:0, verdict:'zone', beaten:0, of:1, color:'red', qty:0}];`);
  const gz = strip(eng.run(`expectationVsActualChartHtml(A, [])`));
  console.log('   D2 (tableau) : ' + gz.slice(gz.indexOf('Semestre 1 +2.00')));
  ok(/Semestre 1 \+2\.00 M\$ \+1\.50 M\$ à \+2\.50 M\$ \+2\.30 M\$ dans la zone — 1 cube vert/.test(gz) && /Semestre 2 \+2\.00 M\$ \+1\.50 M\$ à \+2\.50 M\$ \+1\.80 M\$ dans la zone — aucun cube/.test(gz),
    'D2 : tableau du graphique : « dans la zone — 1 cube vert » et « dans la zone — aucun cube »');

  console.log('\nC. Fenêtre « Résultats du tour » : verdict à la clôture');
  eng.run(`A.analystHistory = [{semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:3.1, verdict:'normalUp', beaten:1, of:1, color:'green', qty:2}];`);
  eng.run(`state.lastDiceRollEvent = {roll:2, portfolioDeltas:{}}; __modals.length = 0; showDiceRollTurnPopup(A, 2);`);
  const p2 = strip(eng.run(`__modals[__modals.length-1]`));
  console.log('   ' + (/Analystes, fin de semestre[^]*?\./.exec(p2) || [''])[0]);
  ok(/Analystes, fin de semestre : bénéfice net \+3\.10 M\$ contre une cible de \+2\.00 M\$ \(zone de \+1\.50 M\$ à \+2\.50 M\$\) : au-dessus de la zone \(verdict normal\), 1 analyste battu sur 1 — 2 cubes verts au sac fondamental\./.test(p2), 'dernier lancer du semestre 0 : une ligne de verdict (battus, cubes)');
  ok(!/bénéfice jugé/.test(p2), 'bénéfice jugé = officiel : pas de mention');
  // A6 et A2 dans la fenêtre du tour : bénéfice jugé, signe moins U+2212.
  eng.run(`A.analystHistory = [{semester:0, h:null, m:-1, k:null, target:-1, zone:0.5, actual:-0.2, judged:-0.9, adjust:-0.7, verdict:'zone', beaten:1, of:1, color:null, qty:0}]; __modals.length = 0; showDiceRollTurnPopup(A, 2);`);
  const p6 = strip(eng.run(`__modals[__modals.length-1]`));
  const l6 = (/Analystes, fin de semestre[^]*?au sac fondamental\.|Analystes, fin de semestre[^]*?aucun cube\./.exec(p6) || [''])[0];
  console.log('   A6 (résumé du tour) : ' + l6);
  ok(/bénéfice net \u2212200 K\$ \(bénéfice jugé \u2212900 K\$ : intérêts hypothécaires de fin d'année comptés tels que prévus au premier lancer du semestre, ajustement de \u2212700 K\$\) contre une cible de \u22121\.00 M\$ \(zone de \u22121\.50 M\$ à \u2212500 K\$\) : dans la zone/.test(l6) && signesPropres(l6),
    'A6 : résumé du tour : bénéfice officiel, puis le bénéfice jugé et son explication ; A2 : signe U+2212');
  eng.run(`A.analystHistory = [{semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:2.3, judged:2.3, adjust:0, verdict:'zone', beaten:1, of:1, color:'green', qty:1}]; __modals.length = 0; showDiceRollTurnPopup(A, 2);`);
  const pz1 = strip(eng.run(`__modals[__modals.length-1]`));
  console.log('   D2 (résumé, 1 cube) : ' + (/Analystes, fin de semestre[^]*?fondamental\./.exec(pz1) || [''])[0]);
  ok(/: dans la zone — 1 cube vert au sac fondamental\./.test(pz1), 'D2 : résumé du tour : « dans la zone — 1 cube vert au sac fondamental »');
  eng.run(`A.analystHistory = [{semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:1.8, judged:1.8, adjust:0, verdict:'zone', beaten:0, of:1, color:'red', qty:0}]; __modals.length = 0; showDiceRollTurnPopup(A, 2);`);
  const pz0 = strip(eng.run(`__modals[__modals.length-1]`));
  console.log('   D2 (résumé, 0 cube) : ' + (/Analystes, fin de semestre[^]*?aucun cube\./.exec(pz0) || [''])[0]);
  ok(/: dans la zone — aucun cube\./.test(pz0), 'D2 : résumé du tour : « dans la zone — aucun cube »');
  eng.run(`__modals.length = 0; showDiceRollTurnPopup(A, 1);`);
  ok(!/Analystes, fin de semestre/.test(strip(eng.run(`__modals[__modals.length-1]`))), 'lancer en milieu de semestre : aucune ligne de verdict');
  eng.run(`__modals.length = 0; showDiceRollTurnPopup(A, 5);`);
  ok(!/Analystes, fin de semestre/.test(strip(eng.run(`__modals[__modals.length-1]`))), 'fin de semestre sans ligne d\'historique (pas de verdict) : aucune ligne');

  console.log('\nD. Ancienne partie migrée');
  eng.run(`delete A.analystForecast; delete A.analystHistory; state.gameClock.rollCount = 4;`);
  let erreur = null;
  try{
    const o = strip(eng.run(`renderEntreprise()`));
    ok(/Attentes des analystes/.test(o) && /Pas de verdict ce semestre/.test(o), "partie sans prévision ni historique : l'onglet s'affiche, « Pas de verdict ce semestre »");
    ok(/Pas encore de semestre jugé par les analystes\./.test(strip(eng.run(`expectationVsActualChartHtml(A, [])`))), 'partie sans historique : message court');
    eng.run(`__modals.length = 0; state.lastDiceRollEvent = {roll:5, portfolioDeltas:{}}; showDiceRollTurnPopup(A, 5);`);
    ok(!/Analystes, fin de semestre/.test(strip(eng.run(`__modals[__modals.length-1]`))), 'partie sans historique : la fenêtre du tour s\'ouvre sans ligne de verdict');
  } catch(e){ erreur = e; }
  if(erreur) throw erreur;
  const mig = await boot(transform);
  mig.run(`delete A.analystForecast; delete A.analystHistory; migrateState(state);`);
  ok(Array.isArray(mig.json(`A.analystHistory`)) && /Attentes des analystes/.test(strip(mig.run(`renderEntreprise()`))), 'migrateState puis rendu : sans erreur');
}

(async () => {
  console.log('Suite sur le code actuel');
  await suite(null);
  const base = n;
  console.log('\nSuite avec tailles de cubes de 7 (le rappel doit lire la constante)');
  await suite(TAILLE_7, true);

  console.log('\nE. Versions cassées exprès : chacune doit être attrapée');
  const MUTANTS = [
    ['état publié affiché comme provisoire', swap("(f.frozen ? 'Chiffres publiés.'", "(f.frozen ? 'Chiffres provisoires : ils bougent jusqu\\'au premier lancer du semestre.'")],
    ['zone : borne haute prise du mauvais côté', swap('const lo = f.target - f.zone, hi = f.target + f.zone;\n  // Ronde', 'const lo = f.target - f.zone, hi = f.target - f.zone;\n  // Ronde')],
    ['analyste absent affiché comme 0', swap('v===null ? `<td class="small">absent</td>`', 'v===null ? `<td class="money">0.00 M$</td>`')],
    ['rappel de la règle avec la taille écrite en dur', chain(TAILLE_7, swap('un verdict fort (${analystCubesPhrase(ANALYST_VERDICT_STRONG_CUBES)})', 'un verdict fort (${analystCubesPhrase(5)})'))],
    ['verdict fort au-dessus non coloré en vert', swap("(verdict==='normalUp'||verdict==='strongUp') ? '#047857'", "(verdict==='normalUp') ? '#047857'")],
    ['graphique sans historique : message d\'avant', swap('Pas encore de semestre jugé par les analystes.', 'Pas encore assez d\\\'historique.')],
    ['fenêtre du tour sans la ligne de verdict', swap('${analystVerdictSectionHtml}', '')],
    ['« pas de verdict » jamais affiché', swap("!f.verdictPossible\n    ?", 'false\n    ?')],
    ['A1 : « l\'analyste du milieu » quel que soit le nombre d\'analystes', swap(`present>=3 ? "l'analyste du milieu" : present===2 ? 'le milieu entre les deux analystes présents' : 'le chiffre du seul analyste présent'`, `"l'analyste du milieu"`)],
    ['A2 : « +0 » et signe moins ASCII (ancien analystSigned)', swap("return analystIsZero(v) ? '0' : (v<0 ? ANALYST_MINUS : '+') + fmt(Math.abs(v)); }", "return (v>=0?'+':'') + fmt(v); }")],
    ['A2 : signe moins ASCII', swap("const ANALYST_MINUS = '\\u2212';", "const ANALYST_MINUS = '-';")],
    ['A3 : « charges −-1.40 M$ » (ancien détail)', swap('intérêts et charges ${esc(analystSigned(-p.charges))}', 'charges −${esc(fmt(p.charges))}')],
    ['A4 : partie terminée ignorée', swap('state.gameEndedReason\n    ? (f.frozen', 'false\n    ? (f.frozen')],
    ['A5 : graphique sans le choix de périodes', swap('(Array.isArray(periods) && periods.length>0)', 'false')],
    ['D2 : ancien rappel « dans la zone, rien »', swap("dans la zone, ${ANALYST_ZONE_CUBES_MIN} ou ${ANALYST_ZONE_CUBES_MAX} cube du côté de l'écart (vert au-dessus de la cible, rouge en dessous)", 'dans la zone, rien')],
    ['D2 : cube de la zone jamais écrit', swap("(e.qty>0 && e.color) ? analystCubesPhrase(e.qty)", "(e.qty>0 && e.color && e.verdict!=='zone') ? analystCubesPhrase(e.qty)")],
    ['A6 : bénéfice jugé jamais montré', swap('const adj = analystJudgedOf(e) - e.actual;', 'const adj = 0;')],
    ['R3 : raison du marché absent toujours « capitalisation pas positive »', swap("const kAbsent = marketPresent ? null : (sumCap<=0 ? 'capNotPositive' : 'fewCompanies');", "const kAbsent = marketPresent ? null : 'capNotPositive';")],
    ['R3 : ancien texte du marché absent', swap("    : f.kAbsent==='fewCompanies' ? `moins de", "    : false ? `moins de")],
  ];
  quiet = true;
  const nAvant = n;
  let attrapees = 0;
  for(const [nom, tf] of MUTANTS){
    let attrapee = false;
    try{ await suite(tf, /7 cubes/.test(nom) || nom.indexOf('en dur')>=0); } catch(e){ attrapee = /ÉCHEC|motif introuvable/.test(String(e.message)) && !/motif introuvable/.test(String(e.message)); if(!attrapee) throw e; }
    if(attrapee) attrapees++; else { quiet = false; ok(false, `version cassée NON attrapée : ${nom}`); }
  }
  quiet = false; n = nAvant;
  for(const [nom] of MUTANTS) ok(true, `version cassée attrapée : ${nom}`);
  ok(attrapees === MUTANTS.length, `${attrapees} versions cassées sur ${MUTANTS.length} attrapées`);
  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
