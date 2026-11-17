// Test — section 324 (affichage des analystes ; contrat docs/contrats/section-324-affichage.md, parties B et C).
//   B1. Les trois analystes sur le graphique : une marque par analyste présent (historien = losange bleu, modélisateur =
//       triangle violet, marché = carré orange), à la hauteur de son chiffre, dans la moitié gauche de la colonne ; le point
//       du bénéfice dans la moitié droite ; analyste absent = pas de marque ; échelle qui tient compte des analystes ;
//       légende ; semestre en cours dessiné sans point de résultat.
//   B2. Lien « Détails » (analystDetailsBtn-<id>) et fenêtre openAnalystDetailsModal : tous les semestres, tableau complet,
//       détail du modélisateur du semestre en cours ; plus de tableau sous le graphique de l'onglet Entreprise.
//   B3. Bouton « Détails » du Portefeuille (pfAnalystDetailsBtn) et fenêtre « toutes les entreprises » : graphiques compacts
//       sur tous les semestres, échelle propre à chaque entreprise, volet « Chiffres ».
//   B4. Garde-fous : texte dangereux échappé, 40 semestres, 8 entreprises, partie terminée, entreprise sans historique,
//       ancienne partie, boutons présents ET branchés.
//   E.  Versions cassées exprès (option transform) : chacune doit faire échouer la suite.
// Lancer depuis la racine du dépôt :  node tests/section324-affichage.test.js
const { loadEngine } = require('./helpers/engine');

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}
const strip = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const swap = (a, b) => (src) => { if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 70)); return src.split(a).join(b); };
const chain = (...fs) => (src) => fs.reduce((s, f) => f(s), src);
const count = (h, re) => (String(h).match(re) || []).length;

// Géométrie du graphique (px) : normal = bandeau de 220 puis colonnes de 140 ; compact = bandeau de 58 puis colonnes de 64.
// Section 324 (E3) : en compact la colonne vaut clamp(64, floor(980 / n), 112) (n = nombre de colonnes).
const compactW = nCols => Math.max(64, Math.min(112, Math.floor(980 / nCols)));
const GEO = {
  full: { padL: 220, colW: 140, padT: 16, plotH: 156, markR: 6, resR: 7 },
  compact: { padL: 58, colW: 64, padT: 12, plotH: 132, markR: 3.5, resR: 5 },
};
const geoCompact = nCols => Object.assign({}, GEO.compact, { colW: compactW(nCols) });
// Lit les marques d'analystes et les points de résultat dans le SVG d'un graphique.
function parseChart(html){
  const marks = [];
  const reM = /<(polygon|rect)\b([^>]*?) data-analyst="([hmk])">(.*?)<\/\1>/g;
  let m;
  while((m = reM.exec(html))){
    const attrs = m[2], key = m[3], inner = m[4];
    const fill = (/fill="([^"]+)"/.exec(attrs) || [])[1];
    const title = (/<title>(.*?)<\/title>/.exec(inner) || [])[1] || '';
    let x, y, kind, r;
    if(m[1] === 'polygon'){
      const pts = /points="([^"]+)"/.exec(attrs)[1].trim().split(/\s+/).map(p => p.split(',').map(Number));
      kind = pts.length === 4 ? 'diamond' : 'triangle';
      r = (Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]))) / 2;
      x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      // losange : centre = moyenne des 4 sommets ; triangle : sommet haut + rayon (= moitié de l'écart haut-bas / 1,8)
      if(kind === 'diamond') y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      else { const top = pts[0][1], bottom = pts[1][1]; y = top + (bottom - top) / 1.8; }
    } else {
      kind = 'square';
      const g = k => Number(new RegExp(`${k}="([^"]+)"`).exec(attrs)[1]);
      x = g('x') + g('width') / 2; y = g('y') + g('height') / 2; r = g('width') / 1.7;
    }
    marks.push({ key, kind, fill, title, x, y, r });
  }
  const results = [];
  const reC = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"[^>]*data-result="(judged|official)"/g;
  while((m = reC.exec(html))) results.push({ kind: m[4], x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) });
  return { marks, results };
}
const colOf = (x, g) => Math.floor((x - g.padL) / g.colW);
const centerOf = (i, g) => g.padL + i * g.colW + g.colW / 2;

async function boot(transform, names, types){
  const eng = loadEngine({ transform, globals: { alert: () => {} } });
  names = names || ['Alice', 'Bob']; types = types || names.map(() => 'garp');
  eng.ids = await eng.newGame(names, types, 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(eng.ids[0])}; globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };
    globalThis.__closed = 0; closeModal = function(){ __closed++; };
    globalThis.__els = {};
    const __orig = document.getElementById;
    document.getElementById = function(id){
      if(/^mAnalyst\\w*Close$|^pfAnalystDetailsBtn$/.test(id)) return __els[id] || (__els[id] = {id, listeners:{}, addEventListener(t, f){ this.listeners[t] = f; }});
      return __orig(id);
    };
    globalThis.__btns = [];
    document.querySelectorAll = function(sel){ return sel === '[data-analyst-details]' ? __btns : []; };`);
  return eng;
}
const lastModal = eng => eng.run(`__modals[__modals.length-1]`);
// Les boutons « Détails » d'un HTML, sous la forme que leur donne le vrai DOM (dataset + addEventListener).
function pushButtons(eng, html){
  const ids = []; const re = /data-analyst-details="([^"]*)"/g; let m;
  while((m = re.exec(html))) ids.push(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  eng.run(`__btns.length = 0; ${JSON.stringify(ids)}.forEach(id=>__btns.push({dataset:{analystDetails:id}, listeners:{}, addEventListener(t, f){ this.listeners[t] = f; }}));`);
  return ids;
}

const HIST5 = `[
  {semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:2.2, judged:2.2, adjust:0, verdict:'zone', beaten:1, of:1, color:null, qty:0},
  {semester:1, h:1, m:2, k:3, target:2, zone:0.5, actual:2.8, judged:2.8, adjust:0, verdict:'normalUp', beaten:2, of:3, color:'green', qty:2, call:'promise', callEffect:'promesse du PDG tenue'},
  {semester:2, h:1, m:2, k:3, target:2, zone:0.5, actual:3.6, judged:3.6, adjust:0, verdict:'strongUp', beaten:3, of:3, color:'green', qty:5},
  {semester:3, h:1, m:2, k:3, target:2, zone:0.5, actual:1.2, judged:1.2, adjust:0, verdict:'normalDown', beaten:1, of:3, color:'red', qty:2},
  {semester:4, h:1, m:2, k:3, target:2, zone:0.5, actual:-0.4, judged:-0.4, adjust:0, verdict:'strongDown', beaten:0, of:3, color:'red', qty:5}]`;
// Semestre en cours (5) avec des chiffres publiés connus : historien 1,50, modélisateur 2, marché absent.
const COURANT = `A.analystForecast = {semester:5, h:1.5, m:2, k:null, kAbsent:'fewCompanies', sigma:0.4, target:1.75, zone:0.35, parts:{subsidy:1.2, rentsIn:3, rentsOut:0.8, taxes:0.4, charges:0.1}, frozenAtRoll:15};`;
const periodsOf = eng => eng.json(`financialPeriods()`);

async function suite(transform){
  const eng = await boot(transform);
  eng.run(`A.analystHistory = ${HIST5}; state.gameClock.rollCount = 15; ${COURANT}`);
  const per = JSON.stringify(periodsOf(eng));
  ok(eng.json(`financialPeriods().length`) === 6, 'le jeu d\'essai a 6 périodes (5 jugées, la 6e en cours)');
  const chart = (opts) => eng.run(`expectationVsActualChartHtml(A, ${per}${opts ? ', ' + JSON.stringify(opts) : ''})`);

  console.log('\nB1. Les trois analystes sur le graphique');
  eng.run(`globalThis.__K = ANALYST_MARKS;`);
  const mk = eng.json(`ANALYST_MARKS`);
  ok(mk.length === 3 && mk[0].key === 'h' && mk[0].name === 'Historien' && mk[0].shape === 'diamond' && mk[0].color === '#2563eb'
    && mk[1].key === 'm' && mk[1].name === 'Modélisateur' && mk[1].shape === 'triangle' && mk[1].color === '#7c3aed'
    && mk[2].key === 'k' && mk[2].name === 'Marché' && mk[2].shape === 'square' && mk[2].color === '#d97706', 'ANALYST_MARKS : historien losange #2563eb, modélisateur triangle #7c3aed, marché carré #d97706');
  ok(mk.every(m => !/^#(047857|dc2626|b91c1c)$/i.test(m.color) && !/green|red|brick/.test(m.color)), 'aucune couleur d\'analyste n\'est le vert ni le rouge du verdict');
  const g1 = chart(), P = parseChart(g1), G = GEO.full;
  const byKey = k => P.marks.filter(m => m.key === k);
  ok(byKey('h').length === 5 && byKey('m').length === 6 && byKey('k').length === 4, 'marques : historien 5 (absent au semestre 0), modélisateur 6, marché 4 (absent au semestre 0 et au semestre en cours)');
  ok(byKey('h').every(m => m.kind === 'diamond' && m.fill === '#2563eb') && byKey('m').every(m => m.kind === 'triangle' && m.fill === '#7c3aed') && byKey('k').every(m => m.kind === 'square' && m.fill === '#d97706'),
    'formes et couleurs : losange bleu, triangle violet, carré orange');
  ok(count(g1, /data-analyst="/g) === 15, 'aucune marque en trop : 5 + 6 + 4');
  // Titres.
  ok(byKey('h').filter(m => m.title === 'Historien : +1.00 M$').length === 4 && byKey('h').some(m => m.title === 'Historien : +1.50 M$') && byKey('m').every(m => m.title === 'Modélisateur : +2.00 M$') && byKey('k').every(m => m.title === 'Marché : +3.00 M$'),
    'chaque marque a son <title> (« Historien : +1.00 M$ »…) avec le bon chiffre');
  // Colonne de chaque marque : moitié gauche ; point du bénéfice : moitié droite.
  ok(P.marks.every(m => m.x < centerOf(colOf(m.x, G), G)) && P.marks.every(m => m.x > G.padL + colOf(m.x, G) * G.colW), 'les marques d\'analystes sont dans la moitié gauche de leur colonne');
  ok(P.results.length === 5 && P.results.every(r => r.x > centerOf(colOf(r.x, G), G)), 'les 5 points de bénéfice sont dans la moitié droite de leur colonne (pas de point au semestre en cours)');
  ok(!P.results.some(r => colOf(r.x, G) === 5), 'semestre en cours : marques d\'analystes mais pas de point de résultat');
  ok(P.marks.filter(m => colOf(m.x, G) === 5).map(m => m.key).sort().join('') === 'hm', 'semestre en cours : marques de l\'historien et du modélisateur (marché absent)');
  // Hauteur : valeurs 1, 2, 3 régulièrement espacées -> centres régulièrement espacés ; le plus grand chiffre est le plus haut.
  const c1 = i => ['h', 'm', 'k'].map(k => P.marks.find(m => m.key === k && colOf(m.x, G) === i));
  const [h1, m1, k1] = c1(1);
  ok(h1.y > m1.y && m1.y > k1.y && Math.abs((h1.y - m1.y) - (m1.y - k1.y)) < 1e-6, 'hauteur proportionnelle au chiffre (1, 2 et 3 M$ : écarts égaux, le plus grand chiffre en haut)');
  const lineY = (/<line x1="[-\d.]+" x2="[-\d.]+" y1="([-\d.]+)" y2="[-\d.]+" stroke="#64748b" stroke-width="2.5"/.exec(g1.slice(g1.indexOf('data-analyst-chart'))) || [])[1];
  ok(lineY !== undefined && Math.abs(c1(0)[1].y - Number(lineY)) < 1e-6, 'le modélisateur au niveau de la cible (2 M$ au semestre 0) : même hauteur que le trait de la cible');
  ok(P.marks.every(m => m.y >= G.padT - 1 && m.y <= G.padT + G.plotH + 1) && P.results.every(r => r.y >= G.padT - 1 && r.y <= G.padT + G.plotH + 1), 'toutes les marques restent dans le cadre');
  // Échelle : un analyste très loin de la zone ne sort pas du cadre.
  eng.run(`A.analystHistory = [{semester:0, h:30, m:2, k:-25, target:2, zone:0.5, actual:2.2, judged:2.2, adjust:0, verdict:'zone', beaten:1, of:3, color:null, qty:0}];`);
  const Pw = parseChart(eng.run(`expectationVsActualChartHtml(A, [{semesterIndex:0, label:'Année 1, Semestre 1', isCurrent:false}])`));
  ok(Pw.marks.length === 3 && Pw.marks.every(m => m.y >= G.padT - 1 && m.y <= G.padT + G.plotH + 1), 'échelle : historien à +30 M$ et marché à −25 M$ restent dans le cadre');
  // Quatre chiffres égaux : aucune superposition.
  for(const [compact, nCols] of [[false, 1], [true, 1], [true, 7], [true, 12], [true, 13], [true, 41]]){
    const g = compact ? geoCompact(nCols) : GEO.full;
    eng.run(`A.analystHistory = []; for(let s=0; s<${nCols}; s++) A.analystHistory.push({semester:s, h:2, m:2, k:2, target:2, zone:0.5, actual:2, judged:2, adjust:0, verdict:'zone', beaten:0, of:3, color:null, qty:0});`);
    const pr = JSON.stringify(Array.from({ length: nCols }, (_, s) => ({ semesterIndex: s, label: `Année ${Math.floor(s / 2) + 1}, Semestre ${s % 2 + 1}`, isCurrent: false })));
    const html = eng.run(`expectationVsActualChartHtml(A, ${pr}, ${compact ? '{compact:true}' : '{}'})`);
    const Pe = parseChart(html);
    const items = Pe.marks.map(m => ({ x: m.x, y: m.y, r: m.r })).concat(Pe.results.map(r => ({ x: r.x, y: r.y, r: r.r })));
    let minGap = Infinity;
    for(let i = 0; i < items.length; i++) for(let j = i + 1; j < items.length; j++) minGap = Math.min(minGap, Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) - items[i].r - items[j].r);
    const maxMark = Math.max(...Pe.marks.map(m => m.r)), maxRes = Math.max(...Pe.results.map(r => r.r));
    ok(items.length === 4 * nCols && minGap > 0, `${compact ? 'compact' : 'normal'}, ${nCols} colonne(s) : chiffres égaux (2 M$) : 4 formes par colonne, aucune ne touche une autre (écart minimal ${minGap.toFixed(1)} px)`);
    if(compact){
      const w = Number(/<svg width="(\d+)" height="\d+" viewBox="[^"]*" style="overflow:visible;display:block;" data-analyst-chart/.exec(html)[1]);
      ok(w === g.padL + nCols * g.colW, `compact, ${nCols} colonne(s) : colonnes de ${g.colW} px (clamp(64, floor(980 / n), 112)), largeur ${w}`);
      ok(maxMark <= 5.5 + 1e-9 && maxRes <= 6.5 + 1e-9 && (g.colW > 64 ? maxMark > 3.6 : maxMark <= 3.6), `compact, ${nCols} colonne(s) : marques de rayon ${maxMark.toFixed(2)} (3,5 à 5,5), point de rayon ${maxRes.toFixed(2)} (5 à 6,5) : ils grossissent avec la largeur, avec un plafond`);
      ok(Pe.marks.every(m => m.x < centerOf(colOf(m.x, g), g)) && Pe.results.every(r => r.x > centerOf(colOf(r.x, g), g)) && colOf(Pe.marks[Pe.marks.length - 1].x, g) === nCols - 1, `compact, ${nCols} colonne(s) : marques à gauche du centre, point à droite, dans la bonne colonne`);
    }
  }
  eng.run(`A.analystHistory = []; A.analystHistory.push({semester:0, h:2, m:2, k:2, target:2, zone:0.5, actual:2, judged:2, adjust:0, verdict:'zone', beaten:0, of:3, color:null, qty:0});`);
  // Légende.
  eng.run(`A.analystHistory = ${HIST5};`);
  ok(/data-analyst-legend/.test(chart()) && ['Zone acceptable', 'Cible', 'Historien', 'Modélisateur', 'Marché', 'Bénéfice réel'].every(t => strip(chart()).includes(t)) && count(chart(), /data-legend-analyst="/g) === 3,
    'légende : zone, cible, les trois analystes (avec leur forme), bénéfice');
  ok(!/Bénéfice officiel/.test(chart()), 'légende : pas de « Bénéfice officiel » quand le bénéfice jugé est égal à l\'officiel');
  // Bénéfice officiel différent : cercle creux et légende des deux.
  eng.run(`A.analystHistory[1].judged = 2.5; A.analystHistory[1].adjust = -0.3;`);
  const gJ = chart(), PJ = parseChart(gJ);
  ok(PJ.results.filter(r => r.kind === 'official').length === 1 && PJ.results.filter(r => r.kind === 'judged').length === 5 && /Bénéfice jugé/.test(gJ) && /Bénéfice officiel/.test(gJ), 'bénéfice officiel différent : un cercle creux de plus et la légende des deux');
  // D1 : hauteur du point plein (bénéfice jugé, 2,5) et du cercle creux (officiel, 2,8) : échelle tirée de deux marques connues.
  {
    const yh = PJ.marks.find(m => m.key === 'h' && colOf(m.x, G) === 1).y, ym = PJ.marks.find(m => m.key === 'm' && colOf(m.x, G) === 1).y;
    const yOf = v => ym + (2 - v) * (yh - ym);
    const rj = PJ.results.find(r => r.kind === 'judged' && colOf(r.x, G) === 1), ro = PJ.results.find(r => r.kind === 'official' && colOf(r.x, G) === 1);
    ok(Math.abs(rj.y - yOf(2.5)) < 0.1 && Math.abs(ro.y - yOf(2.8)) < 0.1 && Math.abs(rj.y - ro.y) > 3, `D1 : point plein à la hauteur du bénéfice jugé (${rj.y.toFixed(1)} px pour 2,5 M$) et cercle creux à celle de l'officiel (${ro.y.toFixed(1)} px pour 2,8 M$)`);
    // D4 : même chose en mode compact : le cercle creux est dessiné.
    const Pc = parseChart(eng.run(`expectationVsActualChartHtml(A, ${per}, {compact:true})`));
    ok(Pc.results.filter(r => r.kind === 'official').length === 1 && Pc.results.filter(r => r.kind === 'judged').length === 5, 'D4 : mode compact : le cercle creux du bénéfice officiel est dessiné (1 cercle, 5 points pleins)');
  }
  eng.run(`A.analystHistory = ${HIST5};`);
  // Semestre en cours provisoire (pas de gel).
  eng.run(`A.analystForecast = null;`);
  const gp = chart(), Pp = parseChart(gp);
  ok(Pp.marks.filter(m => colOf(m.x, G) === 5).length >= 2 && /provisoire/.test(strip(gp)) && Pp.results.length === 5, 'semestre en cours provisoire : marques dessinées (chiffres provisoires), toujours sans point de résultat');
  eng.run(COURANT);

  console.log('\nB2. Lien « Détails » et fenêtre des chiffres');
  const idA = eng.json(`A.id`);
  ok(count(g1, new RegExp(`id="analystDetailsBtn-${idA}"`, 'g')) === 1 && />Détails<\/button>/.test(g1) && /class="btn btn-sm"/.test(g1), 'le graphique a un bouton « Détails » (analystDetailsBtn-<id>, btn btn-sm)');
  ok(!/analystDetailsBtn/.test(chart({ detailsButton: false })) && /analystDetailsBtn/.test(chart({ compact: true, detailsButton: true })), 'option detailsButton : false le retire, true le met même en mode compact');
  ok(!/<table|<th>/.test(g1), 'plus aucun tableau sous le graphique');
  const ent = eng.run(`renderEntrepriseFinancials(A)`);
  ok(/analystDetailsBtn-/.test(ent) && !/data-analyst-table/.test(ent) && !/Zone acceptable<\/th>/.test(ent) && /Bénéfice net : cible des analystes et résultat réel/.test(strip(ent)), 'onglet Entreprise : le graphique et son bouton, mais pas le tableau des chiffres');
  // La fenêtre : tous les semestres, même si l'écran n'en montre qu'une.
  const one = chart().length; // (le graphique de l'écran peut ne montrer qu'une période)
  const gOne = eng.run(`expectationVsActualChartHtml(A, [{semesterIndex:2, label:'Année 2, Semestre 1', isCurrent:false}])`);
  ok(count(gOne, /data-result="judged"/g) === 1 && one > 0, 'l\'écran peut ne montrer qu\'une période (une seule colonne)');
  eng.run(`__modals.length = 0; openAnalystDetailsModal(A.id);`);
  const md = lastModal(eng), mdt = strip(md);
  ok(/<style>\.modal\{max-width:1240px;\}<\/style>/.test(md) && mdt.includes('📊 Analystes — Co Alice : tous les chiffres'), 'fenêtre large (1 240 px, E1), titre « 📊 Analystes — Co Alice : tous les chiffres »');
  ok(count(md, /data-analyst-row=/g) === 6 && count(md, /data-analyst-current=/g) === 1, 'fenêtre : 5 semestres jugés + le semestre en cours = 6 lignes (tous, pas la période de l\'écran)');
  const heads = (/<tr><th>Semestre<\/th>.*?<\/tr>/.exec(md) || [''])[0].match(/<th>/g) || [];
  ok(heads.length === 12 && /Historien/.test(md) && /Modélisateur/.test(md) && /Marché/.test(md) && ['Cible', 'Zone acceptable', 'Bénéfice officiel', 'Bénéfice jugé', 'Verdict', 'Analystes battus', 'Cubes', 'Annonce du PDG'].every(t => mdt.includes(t)), 'douze colonnes : Semestre, 3 analystes, Cible, Zone, Bénéfice officiel, Bénéfice jugé, Verdict, Battus, Cubes, Annonce');
  const order = ['Année 1, Semestre 1', 'Année 1, Semestre 2', 'Année 2, Semestre 1', 'Année 2, Semestre 2', 'Année 3, Semestre 1', 'Année 3, Semestre 2'].map(t => mdt.indexOf(t, mdt.indexOf('Annonce du PDG')));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'du plus ancien au plus récent, le semestre en cours en dernier');
  ok(/Année 1, Semestre 1 absent \+2\.00 M\$ absent/.test(mdt), 'analyste absent : « absent » au tableau (historien et marché du semestre 0)');
  ok(/Année 1, Semestre 2 \+1\.00 M\$ \+2\.00 M\$ \+3\.00 M\$ \+2\.00 M\$ \+1\.50 M\$ à \+2\.50 M\$ \+2\.80 M\$ \+2\.80 M\$ au-dessus de la zone \(verdict normal\) 2 sur 3 2 cubes verts Promesse du PDG tenue/.test(mdt), 'ligne du semestre 1 : chiffres des trois analystes, cible, zone, bénéfices, verdict, battus, cubes, annonce du PDG (E2 : texte seul, majuscule, sans « promesse — promesse… »)');
  ok(!/promesse — promesse/i.test(mdt), 'E2 : le libellé de l\'annonce n\'est plus répété devant son texte');
  ok(/Année 3, Semestre 2 en cours \(chiffres publiés\) \+1\.50 M\$ \+2\.00 M\$ absent \+1\.75 M\$ \+1\.40 M\$ à \+2\.10 M\$ – – – – – –/.test(mdt), 'semestre en cours : « en cours (chiffres publiés) », marché absent, résultat / verdict / battus / cubes / annonce en « – »');
  ok(/Détail du modélisateur : subvention de départ \+1\.20 M\$, loyers reçus \+3\.00 M\$, loyers payés −800 K\$, taxes −400 K\$, intérêts et charges −100 K\$\./.test(mdt), 'sous le tableau : détail du modélisateur du semestre en cours');
  ok(mdt.indexOf('Détail du modélisateur') > mdt.indexOf('Année 3, Semestre 2') && /id="mAnalystDetailsClose"/.test(md) && /Fermer/.test(mdt), 'le détail est sous le tableau ; bouton « Fermer »');
  // Annonce du PDG au semestre en cours.
  eng.run(`A.ceoCall = {kind:'warning', semester:5};`);
  ok(/Année 3, Semestre 2 en cours \(chiffres publiés\) .*– – – – – Avertissement$/.test(strip(eng.run(`analystDetailsTableHtml(A)`))), 'semestre en cours : l\'annonce du PDG faite (avertissement) est écrite dans la dernière colonne');
  eng.run(`A.ceoCall = null;`);
  // Provisoire.
  eng.run(`A.analystForecast = null;`);
  ok(/en cours \(chiffres provisoires\)/.test(strip(eng.run(`analystDetailsTableHtml(A)`))), 'semestre en cours provisoire : « en cours (chiffres provisoires) »');
  eng.run(COURANT);
  // Bénéfice jugé différent : la note.
  eng.run(`A.analystHistory[1].judged = 2.5; A.analystHistory[1].adjust = -0.3;`);
  ok(/\+2\.80 M\$ \+2\.50 M\$ bénéfice jugé \+2\.50 M\$ : intérêts hypothécaires/.test(strip(eng.run(`analystDetailsTableHtml(A)`))), 'bénéfice jugé différent : le jugé et sa note à côté de l\'officiel');
  eng.run(`A.analystHistory = ${HIST5};`);
  // Entreprise inconnue.
  eng.run(`__modals.length = 0; openAnalystDetailsModal('inconnue');`);
  ok(eng.json(`__modals.length`) === 0, 'entreprise inconnue : aucune fenêtre, aucune erreur');

  console.log('\nB2 (suite). Boutons branchés');
  pushButtons(eng, g1);
  ok(eng.json(`__btns.length`) === 1, 'un bouton « Détails » trouvé dans le graphique');
  eng.run(`bindAnalystButtons();`);
  ok(eng.json(`__btns[0].listeners.click !== undefined`) && eng.json(`typeof __btns[0].listeners.click`) === 'function', 'bindAnalystButtons : le bouton « Détails » reçoit un écouteur');
  eng.run(`__modals.length = 0; __btns[0].listeners.click({});`);
  ok(strip(lastModal(eng)).includes('Analystes — Co Alice : tous les chiffres'), 'clic sur « Détails » : la fenêtre de la bonne entreprise s\'ouvre');
  eng.run(`__els = {}; __modals.length = 0; openAnalystDetailsModal(A.id);`);
  ok(eng.json(`__els.mAnalystDetailsClose.listeners.click === closeModal`) , '« Fermer » est branché sur closeModal');
  // Les deux onglets rebranchent à chaque rendu.
  eng.run(`globalThis.__bound = 0; bindAnalystButtons = function(){ __bound++; }; bindTabEvents('entreprise');`);
  ok(eng.json(`__bound`) >= 1, 'bindTabEvents(entreprise) rebranche les boutons « Détails »');
  eng.run(`__bound = 0; bindTabEvents('portefeuille');`);
  ok(eng.json(`__bound`) >= 1, 'bindTabEvents(portefeuille) rebranche le bouton « Détails »');

  console.log('\nB3. Portefeuille : bouton « Détails » et fenêtre « toutes les entreprises »');
  const eng3 = await boot(transform);
  eng3.run(`state.gameClock.rollCount = 6;`);
  const pf = eng3.run(`renderPortefeuilleFinancials()`), pft = strip(pf);
  ok(count(pf, /id="pfAnalystDetailsBtn"/g) === 1 && /Attentes des analystes/.test(pft) && />Détails<\/button>/.test(pf), 'Portefeuille › États financiers : titre « Attentes des analystes » et bouton pfAnalystDetailsBtn');
  ok(pft.indexOf('État des résultats') < pft.indexOf('Attentes des analystes') && pft.indexOf('Attentes des analystes') < pft.indexOf('Bilan'), 'placé juste après « État des résultats » (avant le bilan)');
  ok(/Pour chaque entreprise/.test(pft), 'une ligne d\'explication courte');
  eng3.run(`bindAnalystButtons();`);
  ok(eng3.json(`typeof __els.pfAnalystDetailsBtn.listeners.click`) === 'function', 'le bouton « Détails » du Portefeuille a un écouteur');
  eng3.run(`__modals.length = 0; __els.pfAnalystDetailsBtn.listeners.click({});`);
  ok(/toutes les entreprises/.test(strip(lastModal(eng3))), 'clic : la fenêtre « toutes les entreprises » s\'ouvre');

  // Fenêtre avec 8 entreprises, 40 semestres chacune, nom dangereux, échelle propre à chacune.
  const noms = ['Ana', 'Bea', 'Cal', 'Dan', 'Eve', 'Flo', 'Gus', 'Hal'];
  const e8 = await boot(transform, noms);
  const mkHist = (base, N) => `(()=>{ const a = []; for(let s=0; s<${N}; s++){ const v = ${base}*(1 + 0.1*Math.sin(s)); const verdict = ['zone','normalUp','strongUp','normalDown','strongDown'][s%5]; a.push({semester:s, h:v*0.8, m:v, k:s%7===0 ? null : v*1.3, target:v, zone:${base}*0.2, actual:v + (s%5===1 ? ${base}*0.3 : s%5===2 ? ${base}*0.6 : s%5===3 ? -${base}*0.3 : s%5===4 ? -${base}*0.6 : 0), judged:v, adjust:0, verdict, beaten:s%4, of:3, color:null, qty:0}); } return a; })()`;
  e8.run(`state.gameClock.rollCount = 120; state.companies.forEach((c, i)=>{ c.analystHistory = ${mkHist('1', 40)}; c.analystForecast = null; });
    state.companies[1].analystHistory = ${mkHist('50', 40)};
    state.companies[0].name = '<img src=x onerror=alert(1)>"&'; state.companies[0].type = '<b>x</b>'; portefeuilleSelectedSemester = 5;`);
  ok(e8.json(`activeCompanies().length`) === 8, 'huit entreprises actives');
  e8.run(`__modals.length = 0; openAnalystOverviewModal();`);
  const ov = lastModal(e8), ovt = strip(ov);
  ok(/<style>\.modal\{max-width:1240px;\}<\/style>/.test(ov) && ovt.includes('📊 Analystes — toutes les entreprises') && /id="mAnalystOverviewClose"/.test(ov), 'fenêtre large (1240 px), titre « toutes les entreprises », bouton « Fermer »');
  ok(count(ov, /data-analyst-company="/g) === 8 && count(ov, /data-analyst-chart="compact"/g) === 8, 'un bloc et un graphique compact par entreprise (8)');
  ok(count(ov, /data-analyst-legend/g) === 1 && count(ov, /data-legend-analyst="/g) === 3, 'une seule légende commune, en tête');
  ok(count(ov, /<details/g) === 8 && count(ov, />Chiffres<\/summary>/g) === 8 && count(ov, /<table data-analyst-table/g) === 8, 'chaque entreprise a un volet repliable « Chiffres » avec son tableau');
  ok(!/analystDetailsBtn/.test(ov), 'pas de bouton « Détails » dans les graphiques de la fenêtre (une seule fenêtre à la fois)');
  const blocks = ov.split('data-analyst-company="').slice(1);
  const svgOf = b => /<svg width="\d+" height="\d+" viewBox="[^"]*" style="overflow:visible;display:block;" data-analyst-chart="compact">[^]*?<\/svg>/.exec(b)[0];
  const GC = geoCompact(41);
  ok(blocks.every(b => count(b, /data-verdict-sign="/g) === 40), 'tous les semestres (40 jugés) pour chaque entreprise, alors que l\'écran n\'en montre qu\'un (Portefeuille sur le semestre 5)');
  ok(blocks.every(b => /<svg width="2682" /.test(b)), 'largeur = 58 + 41 colonnes de 64 px = 2 682 px (40 jugés + le semestre en cours) : défilement de côté');
  ok(!/Année/.test(blocks.map(svgOf).join('')) && /An 1/.test(svgOf(blocks[0])) && /S2/.test(svgOf(blocks[0])), 'libellés courts « An 1 » / « S1 » sur deux lignes');
  // Échelle propre : l'entreprise à 1 M$ et celle à 50 M$ occupent toute la hauteur.
  const spread = b => { const ys = parseChart(svgOf(b)).marks.map(m => m.y); return [Math.min(...ys), Math.max(...ys)]; };
  const [lo0, hi0] = spread(blocks[0]), [lo1, hi1] = spread(blocks[1]);
  ok(hi0 - lo0 > 60 && hi1 - lo1 > 60 && [lo0, lo1].every(v => v >= GC.padT - 1) && [hi0, hi1].every(v => v <= GC.padT + GC.plotH + 1), `échelle propre à chaque entreprise : amplitudes de ${(hi0 - lo0).toFixed(0)} et ${(hi1 - lo1).toFixed(0)} px pour 1 M$ et 50 M$`);
  // Signes du verdict.
  const sg = (b, v) => (new RegExp(`fill="([^"]+)" font-size="12" data-verdict-sign="${v}">([^<]*)<`).exec(b) || []);
  const sgs = ['strongUp', 'normalUp', 'zone', 'normalDown', 'strongDown'].map(v => sg(blocks[2], v));
  ok(sgs.map(x => x[2]).join(' ') === '▲▲ ▲ = ▼ ▼▼', 'signes du verdict : ▲▲ ▲ = ▼ ▼▼');
  ok(sgs[0][1] === '#047857' && sgs[1][1] === '#047857' && sgs[2][1] === '#64748b' && sgs[3][1] === 'var(--brick)' && sgs[4][1] === 'var(--brick)', 'signes de la couleur du verdict (vert, gris, rouge du jeu)');
  const sample = parseChart(svgOf(blocks[3]));
  ok(sample.marks.length > 100 && sample.marks.every(m => m.x < centerOf(colOf(m.x, GC), GC)) && sample.results.every(r => r.x > centerOf(colOf(r.x, GC), GC)), 'mode compact : marques à gauche du centre, point du bénéfice à droite, sur les 41 colonnes');
  // Échappement.
  ok(!/<img/.test(ov) && !/<b>x<\/b>/.test(ov) && ov.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;') && ov.includes('&lt;b&gt;x&lt;/b&gt;'), 'texte dangereux dans le nom et le type d\'une entreprise : échappé dans la fenêtre « toutes les entreprises »');
  e8.run(`__modals.length = 0; openAnalystDetailsModal(A.id);`);
  ok(!/<img/.test(lastModal(e8)) && lastModal(e8).includes('&lt;img src=x onerror=alert(1)&gt;'), 'texte dangereux dans le nom : échappé dans la fenêtre « Détails »');
  const evil = e8.run(`expectationVsActualChartHtml({id:'a"b<x>', analystHistory:${mkHist('1', 3)}}, [])`);
  ok(!/id="analystDetailsBtn-a"b/.test(evil) && /id="analystDetailsBtn-a&quot;b&lt;x&gt;"/.test(evil), 'identifiant d\'entreprise dangereux : échappé dans le bouton');
  // Quarante semestres, graphique normal.
  const g40 = e8.run(`expectationVsActualChartHtml(state.companies[2], financialPeriods())`);
  ok(/<svg width="5960"/.test(g40) && count(g40, /data-result="judged"/g) === 40, 'graphique normal à 40 semestres jugés (+ le semestre en cours) : 40 points, largeur 220 + 41 × 140 = 5 960 px, sans erreur');

  console.log('\nB4. Garde-fous');
  const eg = await boot(transform);
  // Entreprise sans historique : message.
  eg.run(`state.gameClock.rollCount = 4; A.analystForecast = null; A.analystHistory = [];`);
  ok(/Pas encore de semestre jugé par les analystes\./.test(strip(eg.run(`expectationVsActualChartHtml(A, financialPeriods())`))) && !/<svg/.test(eg.run(`expectationVsActualChartHtml(A, financialPeriods())`)), 'entreprise sans historique : message court, pas de graphique ni de bouton');
  ok(/Pas encore de semestre jugé par les analystes\./.test(strip(eg.run(`analystDetailsTableHtml(A)`))), 'entreprise sans historique : le tableau dit la même chose');
  eg.run(`__modals.length = 0; openAnalystDetailsModal(A.id);`);
  ok(/Pas encore de semestre jugé/.test(strip(lastModal(eg))) && !/Détail du modélisateur/.test(lastModal(eg)), 'fenêtre « Détails » d\'une entreprise sans historique : message, sans détail du modélisateur');
  eg.run(`__modals.length = 0; openAnalystOverviewModal();`);
  ok(count(lastModal(eg), /Pas encore de semestre jugé par les analystes\./g) >= 2, 'fenêtre « toutes les entreprises » : chaque entreprise sans historique dit « Pas encore de semestre jugé »');
  // Ancienne partie (ni prévision ni historique).
  eg.run(`delete A.analystForecast; delete A.analystHistory; delete B.analystHistory;`);
  let erreur = null;
  try{ eg.run(`__modals.length = 0; openAnalystOverviewModal(); openAnalystDetailsModal(A.id); renderEntrepriseFinancials(A); renderPortefeuilleFinancials();`); }catch(e){ erreur = e; }
  ok(erreur === null, 'ancienne partie (ni prévision ni historique) : tout s\'ouvre sans erreur');
  // Partie terminée : pas de semestre en cours.
  eg.run(`A.analystHistory = ${HIST5}; state.gameClock.rollCount = 15; ${COURANT} state.gameEndedReason = {reason:'maxDuration', roll:15, year:2};`);
  const tend = eg.run(`analystDetailsTableHtml(A)`);
  ok(count(tend, /data-analyst-row=/g) === 5 && !/data-analyst-current/.test(tend) && !/en cours/.test(tend), 'partie terminée : 5 lignes, aucun semestre « en cours »');
  const gend = parseChart(eg.run(`expectationVsActualChartHtml(A, financialPeriods())`));
  ok(gend.marks.every(m => colOf(m.x, GEO.full) < 5) && gend.results.length === 5, 'partie terminée : aucune marque ni point au semestre en cours');
  eg.run(`__modals.length = 0; openAnalystDetailsModal(A.id);`);
  ok(!/Détail du modélisateur/.test(lastModal(eg)), 'partie terminée : pas de détail du modélisateur (plus de semestre en cours)');
  eg.run(`state.gameEndedReason = null;`);
  // Rien n'est écrit dans l'état.
  const avant = eg.run(`JSON.stringify(state)`);
  eg.run(`__modals.length = 0; expectationVsActualChartHtml(A, financialPeriods()); expectationVsActualChartHtml(A, financialPeriods(), {compact:true}); analystDetailsTableHtml(A); openAnalystDetailsModal(A.id); openAnalystOverviewModal(); renderEntrepriseFinancials(A); renderPortefeuilleFinancials();`);
  ok(eg.run(`JSON.stringify(state)`) === avant, 'aucune écriture dans l\'état : afficher ne change rien');
  // Contrat : une seule fonction de graphique (le mode compact n'est pas une copie).
  ok(eg.run(`typeof expectationVsActualChartHtml`) === 'function' && !/function expectationVsActualCompact/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')), 'le mode compact est une option du même graphique (pas de copie)');
  // Compact : colonnes de 64 px, une douzaine de semestres sans défiler dans 1100 px.
  eg.run(`A.analystHistory = ${mkHist('1', 12)}; state.gameClock.rollCount = 33; A.analystForecast = null;`);
  const gc = eg.run(`expectationVsActualChartHtml(A, financialPeriods().slice(0, 12), {compact:true})`);
  ok(/<svg width="1030" /.test(gc) && !/data-analyst-legend/.test(gc) && !/analystDetailsBtn/.test(gc) && /data-analyst-chart="compact"/.test(gc), 'compact : 12 colonnes de 81 px = 1 030 px (< 1 100, sans défiler), sans légende ni bouton');
  ok(parseChart(gc).marks.every(m => m.fill && /<title>/.test(gc)), 'compact : les marques gardent leur titre (info-bulle)');

  console.log('\nE1, E2, M3, M4, M5, D2, D3, D5 : ronde de corrections');
  const ec = await boot(transform);
  ec.run(`A.analystHistory = ${HIST5}; state.gameClock.rollCount = 15; ${COURANT}`);
  // E1 : tableau serré, montants et zone sur une ligne, style porté par le tableau.
  const tab = ec.run(`analystDetailsTableHtml(A)`);
  ok(/<style>[^<]*table\[data-analyst-table\] th, table\[data-analyst-table\] td\{padding:6px 8px;font-size:12px;\}[^<]*table\[data-analyst-table\] td\.money\{white-space:nowrap;\}/.test(tab), 'E1 : style du tableau (cellules « padding:6px 8px;font-size:12px », montants sans retour à la ligne) porté par le tableau lui-même');
  const tds = tab.match(/<td class="money"[^>]*>/g) || [];
  // 5 lignes jugées × (3 analystes présents ou non… cible, zone, officiel, jugé) : au moins 4 montants par ligne + la ligne en cours.
  ok(tds.length >= 5 * 6 + 3, `E1 : toutes les cellules de montant ont la classe « money » (${tds.length} cellules)`);
  ok(/<td class="money">\+1\.50 M\$ à \+2\.50 M\$<\/td>/.test(tab) && /<td class="small verdict"/.test(tab) && /<td class="small annonce"/.test(tab), 'E1 : la zone (« +1.50 M$ à +2.50 M$ ») est dans une seule cellule « money » ; verdict et annonce ont leur largeur minimale');
  ec.run(`A.analystHistory[1].judged = 2.5; A.analystHistory[1].adjust = -0.3;`);
  ok(/<div class="small" style="font-weight:400;">bénéfice jugé \+2\.50 M\$/.test(ec.run(`analystDetailsTableHtml(A)`)), 'E1 : la note du bénéfice jugé reste dans un bloc qui peut passer à la ligne');
  ec.run(`A.analystHistory = ${HIST5};`);
  // E2 : texte de l'annonce sans répétition, majuscule au début.
  ec.run(`A.analystHistory[2].call = 'warning'; A.analystHistory[2].callEffect = null; A.analystHistory[3].call = 'promise'; A.analystHistory[3].callEffect = 'promesse du PDG non tenue : 3 cubes rouges de plus';`);
  const t2 = strip(ec.run(`analystDetailsTableHtml(A)`));
  ok(/Avertissement du PDG sans effet : bénéfice pas sous la zone/.test(t2) && /Promesse du PDG non tenue : 3 cubes rouges de plus/.test(t2) && !/avertissement — |promesse — /.test(t2), 'E2 : « Avertissement du PDG sans effet… » et « Promesse du PDG non tenue… », sans libellé répété devant');
  ec.run(`A.analystHistory = ${HIST5}; A.ceoCall = {kind:'promise', semester:5};`);
  ok(/– – – – – Promesse$/.test(strip(ec.run(`analystDetailsTableHtml(A)`))), 'E2 : ligne en cours : « Promesse » (majuscule)');
  // D5 : annonce périmée d'un autre semestre : pas montrée sur la ligne en cours.
  ec.run(`A.ceoCall = {kind:'promise', semester:3};`);
  ok(/– – – – – –$/.test(strip(ec.run(`analystDetailsTableHtml(A)`))), 'D5 : annonce d\'un autre semestre (3) pas montrée sur la ligne du semestre en cours (5)');
  ec.run(`A.ceoCall = null;`);
  // M4 : une ligne sans verdict connu est ignorée.
  ec.run(`A.analystHistory = ${HIST5}; A.analystHistory.push({semester:6, h:1, m:2, k:3, target:2, zone:0.5, actual:2, judged:2, adjust:0, beaten:0, of:3, color:null, qty:0}, {semester:7, h:1, m:2, k:3, target:2, zone:0.5, actual:2, judged:2, adjust:0, verdict:'bidon', beaten:0, of:3, color:null, qty:0});`);
  const t4 = ec.run(`analystDetailsTableHtml(A)`), c4 = ec.run(`expectationVsActualChartHtml(A, [])`);
  ok(!/undefined/.test(strip(t4)) && !/undefined|NaN/.test(strip(c4)) && count(t4, /data-analyst-row=/g) === 6, 'M4 : une ligne sans verdict, ou au verdict inconnu, est ignorée (plus de « undefined sur undefined »), les 5 lignes valables et le semestre en cours restent');
  ec.run(`A.analystHistory = ${HIST5};`);
  // M3 : boutons de lecture seule libres de clic.
  const fakeBtn = (html, re) => { const tag = new RegExp(re).exec(html); if(!tag) return null; const t = tag[0]; return { id: (/id="([^"]+)"/.exec(t) || [])[1], textContent: 'x', hasAttribute: a => new RegExp(`\\s${a}[\\s=>]`).test(t), closest: () => null }; };
  ec.sandbox.__fb = [];
  const gBtn = fakeBtn(ec.run(`expectationVsActualChartHtml(A, ${JSON.stringify(periodsOf(ec))})`), '<button[^>]*analystDetailsBtn-[^>]*>');
  const pBtn = fakeBtn(ec.run(`renderPortefeuilleFinancials()`), '<button[^>]*pfAnalystDetailsBtn[^>]*>');
  ec.run(`__modals.length = 0; openAnalystDetailsModal(A.id);`);
  const cBtn1 = fakeBtn(ec.run(`__modals[0]`), '<button[^>]*mAnalystDetailsClose[^>]*>');
  ec.run(`__modals.length = 0; openAnalystOverviewModal();`);
  const cBtn2 = fakeBtn(ec.run(`__modals[0]`), '<button[^>]*mAnalystOverviewClose[^>]*>');
  const free = b => ec.sandbox.isFreeClickButton(b);
  ok(gBtn && free(gBtn), 'M3 : le bouton « Détails » du graphique est libre de clic (data-free-click)');
  ok(pBtn && free(pBtn), 'M3 : le bouton « Détails » du Portefeuille est libre de clic');
  ok(cBtn1 && free(cBtn1) && cBtn2 && free(cBtn2), 'M3 : les boutons « Fermer » des deux fenêtres sont libres de clic');
  // M5 : partie terminée, pas de colonne vide pour le semestre qui n'aura pas lieu.
  ec.run(`state.gameEndedReason = {reason:'maxDuration', roll:15, year:2}; __modals.length = 0; openAnalystOverviewModal();`);
  const ovEnd = ec.run(`__modals[0]`);
  ok(count(ovEnd, /<tspan x="[\d.]+" dy="12">S[12]<\/tspan>/g) === 5 && /<svg width="618" /.test(ovEnd), 'M5 : partie terminée : 5 colonnes (semestres 0 à 4), pas de colonne vide pour le semestre en cours qui n\'aura pas lieu (2 entreprises)');
  ec.run(`A.analystHistory.push({semester:5, h:1, m:2, k:3, target:2, zone:0.5, actual:2, judged:2, adjust:0, verdict:'zone', beaten:0, of:3, color:null, qty:0}); __modals.length = 0; openAnalystOverviewModal();`);
  ok(/<svg width="730" /.test(ec.run(`__modals[0]`)), 'M5 : partie terminée mais ce semestre a une ligne d\'historique : sa colonne est gardée (6 colonnes)');
  ec.run(`state.gameEndedReason = null; A.analystHistory = ${HIST5};`);
  // D2 : légende commune de la fenêtre « toutes les entreprises ».
  ec.run(`__modals.length = 0; openAnalystOverviewModal();`);
  const legendOf = h => strip((/data-analyst-legend[^]*?<\/div>/.exec(h) || [''])[0]);
  ok(/Bénéfice réel/.test(legendOf(ec.run(`__modals[0]`))) && !/Bénéfice officiel/.test(legendOf(ec.run(`__modals[0]`))), 'D2 : aucun bénéfice jugé différent : légende « Bénéfice réel », sans « Bénéfice officiel »');
  ec.run(`A.analystHistory[1].judged = 2.5; A.analystHistory[1].adjust = -0.3; __modals.length = 0; openAnalystOverviewModal();`);
  ok(/Bénéfice jugé/.test(legendOf(ec.run(`__modals[0]`))) && /Bénéfice officiel/.test(legendOf(ec.run(`__modals[0]`))) && count(ec.run(`__modals[0]`), /data-analyst-legend/g) === 1, 'D2 : un bénéfice jugé diffère : la légende commune montre « Bénéfice jugé » et « Bénéfice officiel » (une seule légende)');
  ec.run(`A.analystHistory = ${HIST5};`);
  // D3 : seules les entreprises actives (activeCompanies) sont listées.
  ec.run(`const __ac = activeCompanies; activeCompanies = function(){ return state.companies.slice(0, 1); }; __modals.length = 0; openAnalystOverviewModal(); activeCompanies = __ac;`);
  ok(count(ec.run(`__modals[0]`), /data-analyst-company="/g) === 1, 'D3 : la fenêtre « toutes les entreprises » ne liste que les entreprises actives (1 sur 2)');

  console.log('\nS1. Indication dans le bloc des attentes (plus d\'encadré dans l\'onglet Entreprise)');
  const es = await boot(transform, ['Alice', 'Bob', 'Cleo'], ['garp', 'garp', null]);
  const [alice, bob, cleo] = es.ids;
  const hint = () => es.run(`analystExpectationBlockHtml(A)`);
  const HINT = /data-ceo-call-hint/;
  es.run(`state.gameClock.rollCount = 3; state.lastDiceRollEvent = {roll:2, portfolioDeltas:{}};`);
  ok(HINT.test(hint()) && strip(hint()).includes('📣 Annonce du PDG encore possible pour ce semestre, jusqu\'au premier lancer : bouton « 🔁 Revoir le dernier tour ».'), 'S1 : PDG qui peut annoncer (semestre 1, avant le premier lancer) : la ligne d\'indication est là');
  const pageS = es.run(`renderEntreprise()`);
  ok(HINT.test(pageS) && !/CeoCallBox|CeoWarningBtn|CeoPromiseBtn/.test(pageS), 'S1 : onglet Entreprise : l\'indication, mais toujours aucun encadré ni bouton d\'annonce');
  es.run(`myPlayerId = ${JSON.stringify(bob)};`);
  ok(!HINT.test(hint()), 'S1 : un autre joueur (Bob, PDG de B) ne voit pas l\'indication sur l\'entreprise A');
  ok(HINT.test(es.run(`analystExpectationBlockHtml(B)`)), 'S1 : Bob la voit sur sa propre entreprise B');
  es.run(`myPlayerId = ${JSON.stringify(alice)};`);
  es.run(`state.gameClock.rollCount = 0;`);
  ok(!HINT.test(hint()), 'S1 : premier semestre : pas d\'indication');
  es.run(`state.gameClock.rollCount = 4;`);
  ok(!HINT.test(hint()), 'S1 : après le premier lancer du semestre : pas d\'indication');
  es.run(`state.gameClock.rollCount = 3; ceoCallApply(A.id, 'promise', A.ceoId);`);
  ok(!HINT.test(hint()), 'S1 : annonce déjà faite : pas d\'indication');
  es.run(`A.ceoCall = null;`);
  ok(HINT.test(hint()), 'S1 : (contrôle) sans annonce, l\'indication revient');
  // « Revoir le dernier tour » montre l'encadré avec ses boutons dans les trois cas.
  const revoir = () => { es.run(`__modals.length = 0; reviewLastTurnSummary();`); return lastModal(es) || ''; };
  const avecBoutons = h => /id="popCeoWarningBtn"/.test(h) && /id="popCeoPromiseBtn"/.test(h);
  es.run(`state = JSON.parse(JSON.stringify(state)); migrateState(state); globalThis.A = state.companies[0]; globalThis.B = state.companies[1];`);
  ok(avecBoutons(revoir()), 'S1 cas 1 (partie rechargée : état copié et migrateState) : « Revoir le dernier tour » montre l\'encadré avec ses deux boutons');
  es.run(`myPlayerId = ${JSON.stringify(bob)};`);
  ok(avecBoutons(revoir()) && strip(revoir()).includes('Co Bob'), 'S1 cas 2 (« Vous êtes » changé pour Bob) : « Revoir le dernier tour » montre l\'encadré de Bob avec ses boutons');
  await es.run(`createCompany(${JSON.stringify(cleo)}, 'Co Cleo', '', 'garp', null, null, null)`);
  es.run(`state.companies.forEach(c=>applyCompanyIpoFunding(c)); myPlayerId = ${JSON.stringify(cleo)}; globalThis.C = state.companies[2];`);
  ok(es.run(`ceoCallRefusal(C, myPlayerId)`) === null && HINT.test(es.run(`analystExpectationBlockHtml(C)`)), 'S1 cas 3 : entreprise fondée pendant la fenêtre : l\'indication est là pour sa PDG');
  ok(avecBoutons(revoir()) && strip(revoir()).includes('Co Cleo'), 'S1 cas 3 (entreprise fondée pendant la fenêtre) : « Revoir le dernier tour » montre l\'encadré avec ses deux boutons');
}

// --- E. Versions cassées exprès -------------------------------------------------------------------------------
const MUTANTS = [
  ['marque d\'un analyste absent dessinée', swap('if(v===null) return; // analyste absent : pas de marque', '/* cassé */')],
  ['mauvais chiffre pour un analyste (tous au niveau du modélisateur)', swap('const v = d.an[m.key];', 'const v = d.an.m;')],
  ['échelle sans les chiffres des analystes', swap('.concat(ANALYST_MARKS.map(m=>d.an[m.key]).filter(v=>v!==null))', '')],
  ['marques dans la moitié droite', swap('mx:[-50,-34,-18]', 'mx:[50,34,18]')],
  ['marques compactes qui se touchent', swap('mx:[-25*s,-16*s,-7*s]', 'mx:[-25*s,-24*s,-23*s]')],
  ['E3 : colonnes compactes toujours à 64 px', swap('const cw = Math.max(64, Math.min(112, Math.floor(980/n))), s = cw/64;', 'const cw = 64, s = cw/64;')],
  ['E3 : rayons sans plafond', swap('mr:Math.min(5.5,3.5*s)', 'mr:3.5*s*1.6')],
  ['historien en vert (couleur réservée au verdict)', swap("color:'#2563eb'", "color:'#047857'")],
  ['historien carré au lieu de losange', swap("shape:'diamond'", "shape:'square'")],
  ['marques sans <title>', swap("`<title>${esc(m.name + ' : ' + analystSigned(v))}</title>`", "''")],
  ['légende sans les analystes', swap("].concat(ANALYST_MARKS.map(m=>item(analystMarkShape(m, 9, 7, 5, `data-legend-analyst=\"${m.key}\"`, ''), m.name)));", '];')],
  ['semestre en cours montré partie terminée (tableau)', swap('if(!co || state.gameEndedReason) return null;', 'if(!co) return null;')],
  ['semestre en cours montré partie terminée (graphique)', swap('if(!e && p.isCurrent && !state.gameEndedReason){', 'if(!e && p.isCurrent){')],
  ['tableau limité à une seule période', swap('const rows = analystHistoryRows(co);\n  const curF', 'const rows = analystHistoryRows(co).slice(-1);\n  const curF')],
  ['analyste absent écrit 0 au tableau', swap("    : `<td class=\"small\">absent</td>`;", "    : `<td class=\"money\">0</td>`;")],
  ['nom d\'entreprise non échappé (fenêtre « Détails »)', swap('<h3>📊 Analystes — ${esc(co.name)} : tous les chiffres</h3>', '<h3>📊 Analystes — ${co.name} : tous les chiffres</h3>')],
  ['nom d\'entreprise non échappé (toutes les entreprises)', swap('<div style="font-weight:700;margin-bottom:4px;">${esc(c.name)} <span', '<div style="font-weight:700;margin-bottom:4px;">${c.name} <span')],
  ['type d\'entreprise non échappé', swap("${esc(typeLabel||'')}</span>", "${typeLabel||''}</span>")],
  ['identifiant du bouton non échappé', swap('id="analystDetailsBtn-${esc(company.id)}" data-analyst-details="${esc(company.id)}"', 'id="analystDetailsBtn-${company.id}" data-analyst-details="${company.id}"')],
  ['mode compact ignoré', swap('const compact = !!opts.compact;', 'const compact = false;')],
  ['bouton « Détails » du graphique sans écouteur', swap("b.addEventListener('click', ()=>openAnalystDetailsModal(id));", 'void 0;')],
  ['bouton « Détails » du Portefeuille sans écouteur', swap("if(ov) ov.addEventListener('click', ()=>openAnalystOverviewModal());", 'if(ov) void 0;')],
  ['« Fermer » sans écouteur', swap("if(close) close.addEventListener('click', closeModal);\n}\n\n// Section 324 (B3) — tous les semestres", 'void 0;\n}\n\n// Section 324 (B3) — tous les semestres')],
  ['onglet Entreprise sans rebranchement', swap("bindAnalystButtons(); // Section 324 : lien « Détails » du graphique des analystes", '')],
  ['Portefeuille sans rebranchement', swap("bindAnalystButtons(); // Section 324 : bouton « Détails » des attentes des analystes", '')],
  ['bouton du Portefeuille absent', swap('id="pfAnalystDetailsBtn">Détails</button>', 'id="pfAnalystDetailsBtnX">Détails</button>')],
  ['fenêtre « toutes les entreprises » limitée au semestre en cours', swap('const periods = analystAllPeriods(cos);', 'const periods = [{semesterIndex:analystCurrentSemester(), label:analystSemesterLabel(analystCurrentSemester()), isCurrent:true}];')],
  ['volet « Chiffres » absent', swap('<summary class="small" style="cursor:pointer;">Chiffres</summary>', '<summary class="small" style="cursor:pointer;">Autre</summary>')],
  ['annonce du PDG du semestre en cours oubliée', swap('<td class="small annonce">${cc ? esc(cap(CEO_CALL_LABELS[cc.kind])) : dash}</td>', '<td class="small annonce">${dash}</td>')],
  ['D5 : annonce brute de l\'entreprise (même périmée) sur la ligne en cours', swap('const cc = ceoCallFor(co, curF.semester);', 'const cc = co.ceoCall;')],
  ['D1 : point plein à la hauteur du bénéfice officiel', swap('cy="${yAt(d.judged)}" r="${L.rr}"', 'cy="${yAt(d.e.actual)}" r="${L.rr}"')],
  ['D4 : cercle du bénéfice officiel non dessiné en compact', swap('if(Math.abs(d.judged - d.e.actual)>1e-9) marks +=', 'if(!compact && Math.abs(d.judged - d.e.actual)>1e-9) marks +=')],
  ['D2 : légende commune sans « Bénéfice officiel »', swap('const anyAdjusted = cos.some(', 'const anyAdjusted = false && cos.some(')],
  ['D3 : toutes les entreprises du jeu, pas seulement les actives', swap('function openAnalystOverviewModal(){\n  const cos = activeCompanies();', 'function openAnalystOverviewModal(){\n  const cos = state.companies;')],
  ['E1 : montants qui passent à la ligne', swap('table[data-analyst-table] td.money{white-space:nowrap;}', 'table[data-analyst-table] td.money{}')],
  ['E1 : cellules non serrées', swap('{padding:6px 8px;font-size:12px;}', '{}')],
  ['E1 : zone sans la classe des montants', swap('const zoneCell = x => `<td class="money">', 'const zoneCell = x => `<td>')],
  ['E1 : fenêtre « Détails » à 960 px', swap('<style>.modal{max-width:1240px;}</style>\n    <h3>📊 Analystes — ${esc(co.name)}', '<style>.modal{max-width:960px;}</style>\n    <h3>📊 Analystes — ${esc(co.name)}')],
  ['E2 : libellé de l\'annonce sans majuscule', swap('esc(cap(callTxt))', 'esc(callTxt)')],
  ['E2 : libellé répété devant le texte', swap('const call = callTxt ? esc(cap(callTxt)) : dash;', 'const call = callTxt ? esc(CEO_CALL_LABELS[e.call] + \' — \' + callTxt) : dash;')],
  ['M3 : bouton « Détails » du graphique pas libre de clic', swap('class="btn btn-sm" data-free-click id="analystDetailsBtn-', 'class="btn btn-sm" id="analystDetailsBtn-')],
  ['M3 : bouton « Détails » du Portefeuille pas libre de clic', swap('data-free-click id="pfAnalystDetailsBtn"', 'id="pfAnalystDetailsBtn"')],
  ['M3 : « Fermer » de la fenêtre Détails pas libre de clic', swap('data-free-click id="mAnalystDetailsClose"', 'id="mAnalystDetailsClose"')],
  ['M3 : « Fermer » de la fenêtre générale pas libre de clic', swap('data-free-click id="mAnalystOverviewClose"', 'id="mAnalystOverviewClose"')],
  ['M4 : ligne sans verdict connu gardée', swap("typeof e.zone==='number' && ANALYST_VERDICT_LABELS[e.verdict]) // Section 324 (M4)", "typeof e.zone==='number') // Section 324 (M4)")],
  ['M5 : colonne vide du semestre qui n\'aura pas lieu', swap('if(state.gameEndedReason && !(companies||[]).some(', 'if(false && !(companies||[]).some(')],
  ['S1 : indication montrée à tout le monde', chain(swap("if(!co || !me || me.id!==co.id) return '';\n  if(ceoCallRefusal(co, myPlayerId)!==null) return '';", "if(!co) return '';\n  if(ceoCallRefusal(co, co.ceoId)!==null) return '';"))],
  ['S1 : indication montrée même quand l\'annonce est refusée', swap("if(ceoCallRefusal(co, myPlayerId)!==null) return '';", '')],
  ['S1 : indication retirée du bloc des attentes', swap('${ceoCallPublicLineHtml(co)}${ceoCallHintHtml(co)}<!-- Section 324 (S1) -->', '${ceoCallPublicLineHtml(co)}')],
  ['signe du verdict fort sans doublon', swap("strongUp:'▲▲'", "strongUp:'▲'")],
  ['détail du modélisateur absent de la fenêtre', swap("${curF ? `<div style=\"margin-top:8px;\">${analystModelerDetailHtml(curF)}</div>` : ''}", '')],
  ['tableau encore sous le graphique', swap("</svg></div>`;\n}\n\n// Section 324 (B2) — tableau de tous", "</svg></div><table><tr><th>Zone acceptable</th></tr></table>`;\n}\n\n// Section 324 (B2) — tableau de tous")],
];

(async () => {
  console.log('Suite sur le code actuel');
  await suite(null);
  console.log('\nE. Versions cassées exprès : chacune doit être attrapée');
  quiet = true;
  const nAvant = n;
  let attrapees = 0;
  const log = console.log;
  for(const [nom, tf] of MUTANTS){
    let attrapee = false, msg = '';
    console.log = () => {};
    try{ await suite(tf); }
    catch(e){ msg = String(e && e.message); attrapee = /ÉCHEC/.test(msg); if(!attrapee) { console.log = log; throw e; } }
    console.log = log;
    if(attrapee) attrapees++; else { quiet = false; ok(false, `version cassée NON attrapée : ${nom}`); }
  }
  quiet = false; n = nAvant;
  for(const [nom] of MUTANTS) ok(true, `version cassée attrapée : ${nom}`);
  ok(attrapees === MUTANTS.length, `${attrapees} versions cassées sur ${MUTANTS.length} attrapées`);
  console.log(`\n${n} vérifications réussies.`);
})().catch(e => { console.error(e); process.exit(1); });
