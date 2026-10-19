// Test — audit du 2026-10-19, bogue 3 (section 307) : rachat VOLONTAIRE d'un découvert sans encaisse.
//
// Avant la correction, closeShortPosition débitait le rachat sans vérifier l'encaisse personnelle. Pendant une même
// fenêtre de marché, un joueur pouvait : 1) vendre à découvert un montant énorme, 2) placer le produit en bons,
// 3) racheter le découvert sans encaisse. Il gardait une encaisse très négative et gratuite, un énorme solde de bons
// rémunéré par la banque, et contournait le plafond de 5 M$ de dette en bons (+30,38 M$ par an sur 1 000 M$).
//
// Comportement voulu : un rachat VOLONTAIRE (sans _bypassTradingWindow, depuis l'interface) exige que l'encaisse
// couvre le montant payé ; sinon il est refusé avec un message qui donne le montant maximal rachetable avec l'encaisse
// actuelle. Les fermetures FORCÉES (appel de marge, _bypassTradingWindow) restent inchangées : elles peuvent rendre
// l'encaisse négative.
//
// Lancer depuis la racine du dépôt :  node tests/audit-bug3.test.js
const { loadEngine, check, near, engineSource } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const MAX = 'Number.MAX_SAFE_INTEGER';

// Partie à trois : Alice CEO d'Alpha (Dividendes), Bob CEO de Beta (GARP), Carl sans entreprise, 50 M$ chacun au départ.
// Lancer 3 : frontière de semestre, marché ouvert. Tirages de cubes neutralisés pour un déroulé déterministe.
async function setup(){
  const eng = await (async () => { const e = loadEngine(); await e.newGame(['Alice', 'Bob', 'Carl'], ['dividende', 'garp']); return e; })();
  eng.run(`globalThis.A = state.companies.find(c=>c.type==='dividende');
           globalThis.B = state.companies.find(c=>c.type==='garp');
           globalThis.ALICE = state.players.find(p=>p.name==='Alice');
           globalThis.C = state.players.find(p=>p.name==='Carl');
           state.gameClock.rollCount = 3;
           drawStockCubes = function(){ return []; };
           resolveStockDraws = function(){ return {gameOver:false}; };
           globalThis.snap = function(pl){
             const pos = pl.shortPositions && pl.shortPositions[B.id];
             const bankEntry = B.shareholders.find(s=>s.playerId==='BANK');
             return {cash: pl.cash, bonds: pl.bondBalance||0, short: pos ? pos.shares : 0, bank: state.bank.cash,
                     bankShares: bankEntry ? bankEntry.shares : 0, pnl: pl.cumRealizedPnl||0};
           };`);
  return eng;
}
const sameSnap = (a, b) => ['cash', 'bonds', 'short', 'bank', 'bankShares', 'pnl'].every(k => near(a[k], b[k], 1e-9));

(async () => {
  // ---------- 1. L'exploit de la fiche : découvert énorme, bons, rachat sans encaisse ----------
  console.log('1. Exploit : vendre 1 000 M$ à découvert, placer en bons, racheter sans encaisse');
  let eng = await setup();
  ok(eng.run(`tradingWindowOpen()`) === true, 'lancer 3 : le marché est ouvert');
  ok(near(eng.run(`C.cash`), 50), 'Carl part avec 50 M$ d’encaisse');
  const priceB = eng.run(`B.stockPrice`);
  const total0 = eng.cashTotal();
  let r = eng.json(`shortBonds(C, 1000)`);
  ok(!r.ok && /5\.00 M\$/.test(r.error), 'emprunt direct de 1 000 M$ en bons refusé au plafond de 5 M$ : « ' + r.error.slice(0, 80) + '… »');
  r = eng.json(`openShortPosition(B, C, 1000)`);
  ok(r.ok && near(eng.run(`C.cash`), 1050), 'vente à découvert de 1 000 M$ de Beta acceptée (encaisse 1 050 M$)');
  r = eng.json(`buyBonds(C, 1000)`);
  ok(r.ok && near(eng.run(`C.cash`), 50) && near(eng.run(`C.bondBalance`), 1000), 'placement de 1 000 M$ en bons accepté (encaisse 50 M$, bons 1 000 M$)');
  ok(near(eng.cashTotal(), total0, 1e-6), 'conservation : ouverture du découvert et achat de bons ne créent ni ne détruisent d’argent (hors bons)');

  let before = eng.json(`snap(C)`);
  let total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(!r.ok, 'rachat de TOUT le découvert (1 000 M$) avec 50 M$ d’encaisse : REFUSÉ');
  ok(/Encaisse personnelle insuffisante/.test(r.error || ''), 'le refus parle de l’encaisse personnelle insuffisante');
  ok(/Montant maximal rachetable avec l'encaisse actuelle : 50\.00 M\$/.test(r.error || ''), 'le refus donne le montant maximal rachetable : 50.00 M$ — « ' + (r.error || '') + ' »');
  ok(sameSnap(eng.json(`snap(C)`), before), 'refus sans effet : encaisse, bons, découvert, banque, parts de la banque et P&L réalisé inchangés');
  ok(near(eng.cashTotal(), total1, 1e-9), 'conservation : le refus ne déplace aucun argent');

  r = eng.json(`closeShortPosition(B, C, 1000)`);
  ok(!r.ok && /Encaisse personnelle insuffisante/.test(r.error || ''), 'rachat du montant exact (1 000 M$) : refusé aussi');
  r = eng.json(`closeShortPosition(B, C, 50.01)`);
  ok(!r.ok && /Encaisse personnelle insuffisante/.test(r.error || ''), 'rachat de 50.01 M$, juste au-dessus de l’encaisse : refusé');
  ok(sameSnap(eng.json(`snap(C)`), before), 'après ces refus, l’état de Carl et de la banque est toujours intact');

  // Le montant maximal annoncé est réellement rachetable, et le rachat conserve la monnaie.
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, C, 50)`);
  let after = eng.json(`snap(C)`);
  ok(r.ok, 'rachat partiel de 50 M$ (le maximum annoncé) : accepté');
  ok(near(after.cash - before.cash, -50, 1e-9) && near(after.bank - before.bank, 50, 1e-9), 'argent débité = argent crédité : Carl −50 M$, banque +50 M$');
  ok(near(after.short, before.short - 50 / priceB, 1e-6) && near(after.bankShares - before.bankShares, 50 / priceB, 1e-6), 'le découvert diminue de ' + (50 / priceB).toFixed(0) + ' parts, rendues à la banque');
  ok(near(eng.cashTotal(), total1, 1e-9), 'conservation : total banque + entreprises + joueurs inchangé');
  r = eng.json(`closeShortPosition(B, C, 0.001)`);
  ok(!r.ok && /Montant maximal rachetable avec l'encaisse actuelle : 0 K\$/.test(r.error || ''), 'encaisse épuisée : même 1 K$ de rachat est refusé, maximum annoncé 0 K$');
  ok(eng.run(`requiredMaintenanceMargin(C)`) > 0, 'le reste du découvert reste ouvert : la marge exigée n’est plus nulle (' + eng.run(`requiredMaintenanceMargin(C)`).toFixed(2) + ' M$)');

  // Fermeture FORCÉE (appel de marge) : inchangée, elle peut rendre l'encaisse négative.
  ok(eng.run(`marginableNetWorth(C) < requiredMaintenanceMargin(C)`), 'Carl est sous la marge de maintien');
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(t, e){ __logs.push(String(t)); return __realLog(t, e); };`);
  eng.run(`enforceMarginCalls()`);
  eng.run(`log = __realLog;`);
  after = eng.json(`snap(C)`);
  const forced = before.short * priceB;
  ok(after.short === 0 && eng.run(`!(C.shortPositions && C.shortPositions[B.id])`), 'appel de marge : la position restante est fermée de force');
  ok(after.cash < 0 && near(after.cash, before.cash - forced, 1e-6), 'l’appel de marge rend l’encaisse négative (' + after.cash.toFixed(2) + ' M$), comme avant');
  ok(near(after.bank - before.bank, forced, 1e-6), 'argent débité = argent crédité : banque +' + forced.toFixed(2) + ' M$');
  ok(near(eng.cashTotal(), total1, 1e-6), 'conservation pendant l’appel de marge');
  ok(eng.json(`__logs`).some(t => /Appel de marge AUTOMATIQUE/.test(t) && /Ce n'est PAS une décision du joueur/.test(t)), 'le journal annonce la fermeture FORCÉE');

  // ---------- 2. Sur une année : la manœuvre ne rapporte plus rien sans risque ----------
  console.log('2. Une année plus tard (6 lancers)');
  eng = await setup();
  eng.run(`openShortPosition(B, C, 1000); buyBonds(C, 1000);`);
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(!r.ok, 'le rachat sans encaisse est refusé');
  eng.run(`advanceGameClock()`);
  ok(eng.run(`!(C.shortPositions && C.shortPositions[B.id])`), 'au lancer suivant, l’appel de marge ferme la position (chemin forcé, marché fermé)');
  ok(eng.run(`C.cash`) < -950, 'encaisse après fermeture forcée et frais d’emprunt : ' + eng.run(`C.cash`).toFixed(2) + ' M$ (frais payés)');
  ok(eng.run(`C.cumInterestPaid||0`) > 0, 'Carl a payé ' + eng.run(`C.cumInterestPaid`).toFixed(2) + ' M$ de frais d’emprunt');
  for(let i = 0; i < 5; i++) eng.run(`advanceGameClock()`);
  const nw = eng.run(`netWorth(C)`);
  ok(nw < 50, 'valeur nette après un an : ' + nw.toFixed(2) + ' M$ < 50 M$ (avant la correction : 80,38 M$, +30,38 M$ sans risque)');

  // ---------- 3. Variantes : levier long gratuit, et joueur CEO d'une autre entreprise ----------
  console.log('3. Variantes de la fiche');
  eng = await setup();
  eng.run(`openShortPosition(B, C, 1000)`);
  r = eng.json(`executeShareTrade(A, C, 'buy', 1000)`);
  ok(r.ok, 'Carl achète 1 000 M$ d’actions Alpha avec le produit du découvert');
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(!r.ok && /Montant maximal rachetable avec l'encaisse actuelle : 50\.00 M\$/.test(r.error || ''), 'découvert -> actions -> rachat : refusé (maximum 50.00 M$), plus de levier long gratuit');
  ok(sameSnap(eng.json(`snap(C)`), before) && near(eng.cashTotal(), total1, 1e-9), 'refus sans effet ni mouvement d’argent');

  eng = await setup();
  const aliceCash = eng.run(`ALICE.cash`);
  r = eng.json(`openShortPosition(B, ALICE, 1000)`);
  ok(r.ok, 'Alice, CEO d’Alpha, vend Beta à découvert pour 1 000 M$');
  r = eng.json(`buyBonds(ALICE, 1000)`);
  ok(r.ok, 'Alice place 1 000 M$ en bons');
  before = eng.json(`snap(ALICE)`); total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, ALICE, ${MAX})`);
  ok(!r.ok && /Encaisse personnelle insuffisante/.test(r.error || '') && r.error.includes(eng.run(`fmt(Math.floor(ALICE.cash*100)/100)`)), 'Alice : rachat sans encaisse refusé, maximum annoncé ' + eng.run(`fmt(Math.floor(ALICE.cash*100)/100)`) + ' (son encaisse ' + aliceCash.toFixed(2) + ' M$)');
  ok(sameSnap(eng.json(`snap(ALICE)`), before) && near(eng.cashTotal(), total1, 1e-9), 'refus sans effet ni mouvement d’argent');

  // ---------- 4. Rachats normaux : toujours possibles avec assez d'encaisse ----------
  console.log('4. Rachats normaux avec assez d’encaisse');
  eng = await setup();
  const bank0 = eng.run(`state.bank.cash`), total2 = eng.cashTotal();
  r = eng.json(`openShortPosition(B, C, 10)`);
  ok(r.ok && near(eng.run(`C.cash`), 60), 'Carl vend 10 M$ de Beta à découvert (encaisse 60 M$)');
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(r.ok && near(r.qty, 10 / priceB, 1e-6), 'rachat de tout (montant demandé plafonné à la position : 10 M$) : accepté');
  ok(near(eng.run(`C.cash`), 50) && eng.run(`!(C.shortPositions && C.shortPositions[B.id])`), 'encaisse revenue à 50 M$, position supprimée');
  ok(near(eng.run(`state.bank.cash`), bank0, 1e-9) && near(eng.cashTotal(), total2, 1e-9), 'conservation : la banque retrouve exactement son encaisse');

  // Rachat à perte : le cours double, le rachat coûte 40 M$ ; refusé avec 30 M$, accepté après retrait de bons.
  eng = await setup();
  eng.run(`openShortPosition(B, C, 20); buyBonds(C, 40); B.stockPrice = B.stockPrice*2;`);
  ok(near(eng.run(`C.cash`), 30), 'découvert de 20 M$, 40 M$ placés en bons, encaisse 30 M$, puis le cours de Beta double');
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(!r.ok && /coûte 40\.00 M\$/.test(r.error || '') && /Montant maximal rachetable avec l'encaisse actuelle : 30\.00 M\$/.test(r.error || ''), 'rachat à 40 M$ avec 30 M$ : refusé, coût 40.00 M$ et maximum 30.00 M$ annoncés');
  r = eng.json(`withdrawBonds(C, 10)`);
  ok(r.ok && near(eng.run(`C.cash`), 40), 'Carl retire 10 M$ de bons (encaisse 40 M$)');
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  after = eng.json(`snap(C)`);
  ok(r.ok && near(after.cash, 0, 1e-9) && after.short === 0, 'rachat de 40 M$ avec exactement 40 M$ : accepté, encaisse 0');
  ok(near(after.bank - before.bank, 40, 1e-9) && near(eng.cashTotal(), total1, 1e-9), 'argent débité = argent crédité (40 M$), total conservé');
  ok(near(after.pnl, -20, 1e-9), 'P&L réalisé : −20 M$ (perte du découvert)');

  // ---------- 5. Fermeture forcée hors fenêtre de marché ----------
  console.log('5. Fermeture forcée (_bypassTradingWindow) hors fenêtre de marché');
  eng = await setup();
  eng.run(`openShortPosition(B, C, 1000); buyBonds(C, 1000); state.gameClock.rollCount = 4;`);
  ok(eng.run(`tradingWindowOpen()`) === false, 'lancer 4 : marché fermé');
  r = eng.json(`closeShortPosition(B, C, ${MAX})`);
  ok(!r.ok && /marché est fermé/.test(r.error || ''), 'rachat volontaire hors fenêtre : refusé pour marché fermé (inchangé)');
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  r = eng.json(`closeShortPosition(B, C, ${MAX}, true)`);
  after = eng.json(`snap(C)`);
  ok(r.ok && after.short === 0 && near(after.cash, -950, 1e-6), 'fermeture forcée de 1 000 M$ avec 50 M$ : acceptée, encaisse −950 M$ (mécanisme existant)');
  ok(near(after.bank - before.bank, 1000, 1e-6) && near(eng.cashTotal(), total1, 1e-6), 'argent débité = argent crédité (1 000 M$), total conservé');

  // ---------- 6. Chemin de l'interface : modalShortShares('close') ----------
  console.log('6. Interface : fenêtre « Racheter pour clôturer »');
  eng = await setup();
  eng.run(`openShortPosition(B, C, 1000); buyBonds(C, 1000); myPlayerId = C.id;`);
  const alerts = [];
  eng.sandbox.alert = (m) => { alerts.push(String(m)); };
  const ctl = {};
  const mkEl = (id, props) => { const l = {}; ctl[id] = Object.assign({ id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, _l: l, addEventListener: (ev, fn) => { l[ev] = fn; } }, props); };
  const fallbackGetById = eng.sandbox.document.getElementById;
  eng.sandbox.document.getElementById = (id) => ctl[id] || fallbackGetById(id);
  const openCloseModal = (amount) => {
    ['mShortInfo', 'mShortAmountLabel', 'mRetryStatus', 'mCancel'].forEach(id => mkEl(id));
    mkEl('mShortCompany', { value: eng.run(`B.id`) });
    mkEl('mShortUnit', { value: 'dollars' });
    mkEl('mShortAmount', { value: String(amount) });
    mkEl('mOk', { textContent: 'Racheter pour clôturer' });
    eng.run(`modalShortShares('close')`);
    return ctl.mOk._l.click;
  };
  before = eng.json(`snap(C)`); total1 = eng.cashTotal();
  let click = openCloseModal(1000);
  ok(typeof click === 'function', 'la fenêtre de rachat s’ouvre pour Carl (position ouverte sur Beta)');
  await click();
  ok(alerts.length === 1 && /Encaisse personnelle insuffisante/.test(alerts[0]) && /Montant maximal rachetable avec l'encaisse actuelle : 50\.00 M\$/.test(alerts[0]), 'clic sur « Racheter pour clôturer » 1 000 M$ : refus affiché avec le maximum 50.00 M$');
  ok(sameSnap(eng.json(`snap(C)`), before) && near(eng.cashTotal(), total1, 1e-9), 'aucun effet sur l’état ni sur l’argent');
  click = openCloseModal(50);
  await click();
  after = eng.json(`snap(C)`);
  ok(alerts.length === 1 && near(after.cash, 0, 1e-9) && near(after.bank - before.bank, 50, 1e-9), 'clic avec 50 M$ (le maximum) : rachat accepté, Carl −50 M$, banque +50 M$');
  ok(near(eng.cashTotal(), total1, 1e-9), 'conservation sur le chemin de l’interface');

  // ---------- 7. Tous les appelants de closeShortPosition sont recensés ----------
  console.log('7. Appelants de closeShortPosition');
  const src = engineSource();
  const calls = [...src.matchAll(/(?<!function )closeShortPosition\(([^)]*)\)/g)].map(m => m[1].trim());
  ok(calls.length === 2, 'deux appels dans le moteur : ' + JSON.stringify(calls));
  ok(calls.filter(a => /,\s*true$/.test(a)).length === 1 && /function enforceMarginCalls\(\)[\s\S]*?closeShortPosition\(co, p, Number\.MAX_SAFE_INTEGER, true\)/.test(src), 'seul l’appel de marge (enforceMarginCalls) passe _bypassTradingWindow');
  ok(calls.includes('co, pl, amount'), 'l’interface (modalShortShares) appelle sans contournement : la garde d’encaisse s’applique');

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
