// Test — section 317 (première moitié), bogues 85, 86, 87, 91 et 98 de l'audit du 2026-10-19 : portefeuille et marché.
// Affichage, journal et libellés seulement : aucun montant d'argent ne change.
//   85. Ordre d'achat (bid) : passer de « parts » à « montant » n'arrondit plus à 10 000 $ et montre l'ordre réel.
//   86. Bons : « Solde initial » et « Intérêts reçus » après un retrait (plus de fausse « dette empruntée »).
//   87. « Résultats du tour » : des bons vendus pour payer un bid ne sont plus une perte.
//   91. Journal du rachat de découvert : montant payé, pas montant saisi.
//   98. Répartition sectorielle : une dette en bons ne fait plus dépasser 100 %.
// Lancer depuis la racine du dépôt :  node tests/section317a-marche.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { transformContre } = require('./helpers/contre317a');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts = {}){
  const doc = creerDocument();
  const eng = loadEngine({ transform: transformContre(), globals: { document: doc, alert: () => {} } });
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['dividende', 'garp']);
  eng.run(`globalThis.A = state.companies.find(c=>c.type==='dividende');
    globalThis.B = state.companies.find(c=>c.type==='garp');
    globalThis.C = state.players.find(p=>p.name==='Carl');
    globalThis.AL = state.players.find(p=>p.name==='Alice');
    state.gameClock.rollCount = 3; myPlayerId = C.id;
    drawStockCubes = function(){ return []; };
    globalThis.__logs = []; globalThis.__realLog = log; log = function(t, e){ __logs.push(String(t)); return __realLog.apply(this, arguments); };`);
  const fire = (sel, type) => { const el = doc.trouver(sel); return Promise.all(el.__cible._ecouteurs.filter(l => l.type === type).map(l => l.fn.call(el, { type, target: el, preventDefault(){}, stopPropagation(){} }))); };
  return { eng, doc, fire };
}
const f2 = (x) => Number(x).toFixed(2);
const texte = (el) => String(el.textContent || el.innerHTML || '');
const triplet = (html) => { // solde initial / intérêts / solde total du tableau des bons
  const m = /<td class="money" style="[^"]*">([-0-9.]+)<\/td><td class="money" style="[^"]*">([-0-9.]+)<\/td><td class="money" style="[^"]*">([-0-9.]+)<\/td><td>[0-9.]+%\/an/.exec(html);
  return m ? m.slice(1, 4).map(parseFloat) : null;
};

(async () => {
  console.log('85. Bid : conversion « parts » -> « montant » sans arrondi caché');
  for (const [parts, attendu] of [[4000, '0.006'], [3000, '0.0045']]) {
    const { eng, doc, fire } = await setup();
    eng.run(`B.stockPrice = 0.0000015; modalPlaceBidOrder();`); // cours 1,50 $
    doc.trouver('mBidCompany').value = eng.run('B.id');
    doc.trouver('mBidPrice').value = '1.5';
    doc.trouver('mBidUnit').value = 'shares'; await fire('#mBidUnit', 'change');
    doc.trouver('mBidQty').value = String(parts);
    await fire('#mBidQty', 'input');
    ok(/Ordre plac/.test(texte(doc.trouver('mBidQtyHint'))), `${parts} parts : l’ordre réellement placé est affiché sous le champ`);
    doc.trouver('mBidUnit').value = 'dollars'; await fire('#mBidUnit', 'change');
    const montant = doc.trouver('mBidQty').value;
    ok(montant === attendu, `${parts} parts à 1,50 $ -> montant « ${montant} » M$ (attendu ${attendu} ; avant : ${parts === 4000 ? '0.01, soit 6 666 parts' : '0.00, ordre refusé'})`);
    ok(near(parseFloat(montant) / 0.0000015, parts, 1e-3), `${parts} parts retrouvées à partir du montant affiché`);
    // Placer l'ordre en « montant » : le nombre de parts enregistré est celui annoncé.
    await fire('#mOk', 'click');
    const q = eng.json(`C.pendingBids.map(b=>b.qty)`);
    ok(q.length === 1 && near(q[0], parts, 1e-3), `l’ordre enregistré porte ${parts} parts`);
  }

  console.log('86. Bons après un retrait');
  {
    const { eng } = await setup();
    // Carl place 10 M$, 0,15 M$ d’intérêts s’accumulent (10,15), puis il retire 10,10 : il reste 0,05 M$ de bons, mais le cumul d’intérêts vaut toujours 0,15.
    eng.run(`C.bondBalance = 0.05; C.cumBondInterest = 0.15; fmt = function(x){ return String(Math.round(x*1e9)/1e9); };`);
    const html = eng.run(`renderPortefeuilleTrading(C, null)`);
    ok(!/Solde initial \(dette emprunt/.test(html), 'solde positif après retrait : plus de « Solde initial (dette empruntée) » en rouge');
    const t = triplet(html);
    ok(t && near(t[0], 0, 1e-9) && near(t[1], 0.05, 1e-9) && near(t[2], 0.05, 1e-9), `solde initial 0, intérêts 0,05 (plafonnés au solde), solde total 0,05 (reçu : ${t && t.join(' / ')} ; avant : −0.10 en rouge, intérêts 0.15)`);
    // Une vraie dette reste signalée.
    eng.run(`C.bondBalance = -2; C.cumBondInterest = -0.1;`);
    const h2 = eng.run(`renderPortefeuilleTrading(C, null)`);
    ok(/Solde initial \(dette empruntée\)/.test(h2) && /Intérêts payés/.test(h2), 'une vraie dette reste libellée « dette empruntée » / « Intérêts payés »');
    // Placement normal non retiré : inchangé.
    eng.run(`C.bondBalance = 10.15; C.cumBondInterest = 0.15;`);
    const t3 = triplet(eng.run(`renderPortefeuilleTrading(C, null)`));
    ok(t3 && near(t3[0], 10, 1e-9) && near(t3[1], 0.15, 1e-9), 'placement en cours : solde initial 10, intérêts reçus 0.15 (inchangé)');
  }

  console.log('87. Résultats du tour : bons vendus pour payer un bid');
  {
    const { eng } = await setup();
    eng.run(`B.stockPriceHistory = [{price:0.0000099},{price:0.00001}]; B.stockPrice = 0.00001;
      AL.cash = 0; AL.bondBalance = 2;
      AL.pendingBids = [{id:'bid1', companyId:B.id, price:0.00001, qty:200000, placedRoll:1}];`);
    const m0 = eng.cashTotal(); // bons = créance sur la banque (hors masse) ; vendus puis dépensés, la masse ne bouge pas
    eng.run(`globalThis.snap = snapshotPlayerBondsAndLoans();
      checkPendingOrders(B);`);
    const apres = eng.json(`({bonds: AL.bondBalance, shares: (B.shareholders.find(s=>s.playerId===AL.id)||{shares:0}).shares})`);
    ok(near(apres.bonds, 0, 1e-9) && near(apres.shares, 200000, 1e-6), `le bid de 2 M$ est payé avec les bons (bons ${f2(apres.bonds)}, ${apres.shares} parts achetées)`);
    const d = eng.json(`computePlayerPortfolioDeltas(snap)[AL.id]`);
    const reel = 200000 * (0.00001 - 0.0000099); // seule variation réelle : la hausse du cours sur les parts
    ok(near(d.bondVar, 0, 1e-9), `variation des bons = 0 (avant : −2,00) — reçu ${d.bondVar}`);
    ok(near(d.totalVar, reel, 1e-9), `variation du portefeuille = +${reel.toFixed(4)} M$ (la vraie), pas −${(2 - reel).toFixed(4)} — reçu ${d.totalVar}`);
    ok(near(eng.cashTotal(), m0, 1e-9), 'masse monétaire conservée');
    // Un autre mouvement de bons pendant le tour reste compté.
    eng.run(`AL.bondBalance = 1; globalThis.snap2 = snapshotPlayerBondsAndLoans(); AL.bondBalance = 0.5;`);
    ok(near(eng.json(`computePlayerPortfolioDeltas(snap2)[AL.id].bondVar`), -0.5, 1e-9), 'un autre mouvement de bons reste compté normalement (−0,5)');
  }

  console.log('91. Journal du rachat de découvert');
  {
    const { eng, doc, fire } = await setup();
    const r = eng.json(`(()=>{ const x = openShortPosition(B, C, 2); return {ok:!!x.ok, error:x.error||''}; })()`);
    ok(r.ok, 'Carl vend à découvert pour 2 M$ de Co Bob' + (r.ok ? '' : ' — ' + r.error));
    eng.run(`__logs.length = 0; modalShortShares('close');`);
    doc.trouver('mShortCompany').value = eng.run('B.id');
    doc.trouver('mShortUnit').value = 'dollars';
    doc.trouver('mShortAmount').value = '10';
    const cash0 = eng.run('C.cash'), m0 = eng.cashTotal();
    await fire('#mOk', 'click');
    const paye = cash0 - eng.run('C.cash');
    ok(near(paye, 2, 1e-6), `Carl a payé ${f2(paye)} M$ (position fermée)`);
    const ligne = eng.json(`__logs.find(t=>/rachète pour clôturer/.test(t))`);
    const f = (x) => eng.run(`fmt(${x})`);
    ok(!!ligne && ligne.includes(`pour ${f(2)} (`) && !ligne.includes(`pour ${f(10)}`), `journal : « ${ligne && ligne.slice(0, 90)}… » annonce le montant payé (${f(2)}), pas le montant saisi (${f(10)})`);
    ok(near(eng.cashTotal(), m0, 1e-9), 'masse monétaire conservée');
  }

  console.log('98. Répartition sectorielle avec une dette en bons');
  {
    const { eng } = await setup();
    // Carl : 6 M$ de parts de Co Alice (dividende), 4 M$ de Co Bob (garp), dette de 2 M$ en bons.
    eng.run(`[[A, 6], [B, 4]].forEach(([co, v])=>{ co.stockPrice = 0.0001; co.shareholders.push({playerId:C.id, shares:v/0.0001, avgCost:0.0001}); });
      C.bondBalance = -2;`);
    const html = eng.run(`renderPortefeuilleTrading(C, null)`);
    const pcts = [...html.matchAll(/\(([0-9.]+)%\)<\/div>/g)].map(m => parseFloat(m[1]));
    ok(pcts.length === 2, `deux tranches affichées (reçu ${pcts.length})`);
    ok(pcts.every(p => p <= 100 + 1e-9) && near(pcts.reduce((s, p) => s + p, 0), 100, 0.11), `pourcentages ${pcts.join(' % + ')} % : somme 100 % (avant : 75 % + 50 %, soit 125 %)`);
    ok(/Dette en bons gouvernementaux/.test(html), 'la dette en bons est signalée à part');
    // Dette plus grosse que les actions : plus de « aucune position » trompeur.
    eng.run(`C.bondBalance = -50;`);
    const h2 = eng.run(`renderPortefeuilleTrading(C, null)`);
    ok(!/Aucune position boursière ni bon gouvernemental/.test(h2), 'avec des actions et une grosse dette, la répartition n’affirme pas qu’il n’y a aucune position');
  }

  console.log(`\nOK : section 317a (marché) — ${n} vérifications`);
})().catch(e => { console.error(e); process.exit(1); });
