// Test — audit du 2026-10-19, bogue 3, retouches (section 307) : options écrites, fermetures forcées, marge initiale.
//
// A1. closeOptionPosition : le rachat VOLONTAIRE d'une option ÉCRITE exige l'encaisse (comme closeShortPosition),
//     avec un message qui donne le maximum rachetable.
// A2. closeOptionStrategy : flux net de toutes les jambes calculé AVANT de fermer quoi que ce soit ; débit net >
//     encaisse => toute la stratégie est refusée. Jamais de fermeture partielle.
// A3. Fermetures FORCÉES (appel de marge, _bypassTradingWindow) de découverts et d'options écrites : les bons
//     gouvernementaux sont vendus d'abord (raiseCashForForcedSettlement, cascade des sections 226/227) ; l'encaisse
//     ne devient négative que si les bons ne suffisent pas.
// A4. Marge initiale : openShortPosition, openOptionPosition (côté écrit) et openOptionStrategy (jambes écrites)
//     refusent l'ouverture si, après l'opération simulée, marginableNetWorth < requiredMaintenanceMargin ; le message
//     donne le maximum ouvrable. Une ouverture couverte qui n'exige aucune marge reste possible.
//
// Les positions « héritées » (ouvertes avant la marge initiale, ex. partie sauvegardée) sont créées avec legacy(),
// qui neutralise la marge exigée le temps de l'ouverture seulement.
//
// Lancer depuis la racine du dépôt :  node tests/audit-bug3b.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const failures = [];
const ok = (cond, msg) => { try { check(cond, msg); n++; } catch(e){ failures.push(msg); console.log('  ' + e.message); } };
const MAX = 'Number.MAX_SAFE_INTEGER';
const f2 = (x) => Number(x).toFixed(2);

// Partie à trois : Alice CEO d'Alpha (Dividendes), Bob CEO de Beta (GARP), Carl sans entreprise, 50 M$ chacun.
// Lancer 3 : marché ouvert. Tirages de cubes neutralisés.
async function setup(){
  const eng = loadEngine();
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['dividende', 'garp']);
  eng.run(`globalThis.A = state.companies.find(c=>c.type==='dividende');
    globalThis.B = state.companies.find(c=>c.type==='garp');
    globalThis.C = state.players.find(p=>p.name==='Carl');
    state.gameClock.rollCount = 3;
    drawStockCubes = function(){ return []; };
    resolveStockDraws = function(){ return {gameOver:false}; };
    globalThis.legacy = function(fn){ const real = requiredMaintenanceMargin; requiredMaintenanceMargin = function(){ return 0; };
      try { return fn(); } finally { requiredMaintenanceMargin = real; } };
    globalThis.R = function(r){ return {ok: !!(r && r.ok), error: (r && r.error) || '', qty: r && r.qty}; };
    globalThis.opts = function(pl){ return (pl.optionPositions||[]).map(p=>({id:p.id, type:p.type, side:p.side, strike:p.strike, shares:p.shares, sid:p.strategyId||null})); };
    globalThis.snapC = function(){ return {cash: C.cash, bonds: C.bondBalance||0, bank: state.bank.cash, opts: JSON.stringify(opts(C)),
      short: (C.shortPositions && C.shortPositions[B.id]) ? C.shortPositions[B.id].shares : 0}; };
    globalThis.__logs = []; globalThis.__realLog = log; log = function(t, e){ __logs.push(String(t)); return __realLog.apply(this, arguments); };`);
  // Masse : banque + entreprises + joueurs. Les bons sont une créance sur la banque (leur argent est dans state.bank.cash) :
  // la vente forcée de bons déplace de l'argent de la banque vers l'encaisse du joueur, sans en créer.
  const mass = () => eng.cashTotal();
  return { eng, mass, S: eng.run(`B.stockPrice`) };
}
const same = (a, b) => ['cash', 'bonds', 'bank', 'short'].every(k => near(a[k], b[k], 1e-9)) && a.opts === b.opts;

(async () => {
  // =====================================================================================================
  console.log('A1. Rachat volontaire d’une option ÉCRITE (closeOptionPosition)');
  {
    const { eng, mass, S } = await setup();
    const K = 0.8 * S;
    const bid = eng.run(`optionPremiumFor(B, 'call', ${K}, 12, false)`);
    const N = Math.floor(1000 / (bid * 100));
    let r = eng.json(`R(legacy(()=>openOptionPosition(B, C, 'call', 'short', ${K}, 12, ${N})))`);
    ok(r.ok, `position héritée : Carl a écrit ${N} calls Beta au strike −20 % (prime ≈ 1 000 M$)`);
    r = eng.json(`R(buyBonds(C, 1000))`);
    ok(r.ok && eng.run(`C.cash`) < 60, `Carl place 1 000 M$ en bons (encaisse ${f2(eng.run('C.cash'))} M$)`);
    const posId = eng.json(`opts(C)[0].id`);
    const ask = eng.run(`optionPremiumFor(B, 'call', ${K}, 12, true)`);
    const before = eng.json(`snapC()`), m0 = mass();
    r = eng.json(`R(closeOptionPosition(C, ${JSON.stringify(posId)}, ${MAX}))`);
    ok(!r.ok && /Encaisse personnelle insuffisante/.test(r.error), 'rachat de TOUTES les options écrites avec ~50 M$ d’encaisse : REFUSÉ — « ' + r.error.slice(0, 90) + '… »');
    const maxContracts = Math.floor(before.cash / (ask * 100));
    ok(new RegExp(`Maximum rachetable avec l'encaisse actuelle : ${maxContracts} contrat`).test(r.error), `le refus donne le maximum rachetable : ${maxContracts} contrat(s)`);
    ok(same(eng.json(`snapC()`), before) && near(mass(), m0, 1e-9), 'refus sans effet : encaisse, bons, banque et position inchangés');
    r = eng.json(`R(closeOptionPosition(C, ${JSON.stringify(posId)}, ${maxContracts + 1}))`);
    ok(!r.ok, `rachat de ${maxContracts + 1} contrats (un de plus que le maximum) : refusé`);
    r = eng.json(`R(closeOptionPosition(C, ${JSON.stringify(posId)}, ${maxContracts}))`);
    const after = eng.json(`snapC()`);
    ok(r.ok && after.cash >= -1e-9, `rachat de ${maxContracts} contrats (le maximum) : accepté, encaisse ${f2(after.cash)} M$ ≥ 0`);
    ok(near(after.bank - before.bank, before.cash - after.cash, 1e-9) && near(mass(), m0, 1e-9), 'argent débité = argent crédité (Carl → banque), masse conservée');

    // Chemin de l'interface : closeOptionPositionFromUi affiche le refus.
    const alerts = [];
    eng.sandbox.alert = (m) => { alerts.push(String(m)); };
    eng.run(`myPlayerId = C.id;`);
    const b2 = eng.json(`snapC()`);
    await eng.run(`closeOptionPositionFromUi(${JSON.stringify(posId)})`);
    ok(alerts.length === 1 && /Encaisse personnelle insuffisante/.test(alerts[0]), 'interface (closeOptionPositionFromUi) : le refus est affiché');
    ok(same(eng.json(`snapC()`), b2), 'interface : aucun effet sur l’état');
  }
  {
    // Non-régression : petite option écrite, encaisse suffisante => rachat accepté ; option ACHETÉE : vente libre.
    const { eng, mass, S } = await setup();
    let r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${S}, 12, 10))`);
    ok(r.ok, 'Carl écrit 10 calls ATM (petite position, marge respectée)');
    r = eng.json(`R(openOptionPosition(B, C, 'put', 'long', ${S}, 12, 10))`);
    ok(r.ok, 'Carl achète 10 puts ATM');
    const m0 = mass();
    const ids = eng.json(`opts(C).map(p=>p.id)`);
    for(const id of ids){ r = eng.json(`R(closeOptionPosition(C, ${JSON.stringify(id)}, ${MAX}))`); ok(r.ok, 'clôture acceptée (encaisse suffisante / option achetée)'); }
    ok(eng.json(`opts(C).length`) === 0 && near(mass(), m0, 1e-9), 'plus aucune option, masse conservée');
  }

  // =====================================================================================================
  console.log('\nA2. Clôture d’une stratégie (closeOptionStrategy) : flux net calculé avant, jamais de fermeture partielle');
  {
    const { eng, mass, S } = await setup();
    const callBid = eng.run(`optionPremiumFor(B, 'call', B.stockPrice, 12, false)`), putBid = eng.run(`optionPremiumFor(B, 'put', B.stockPrice, 12, false)`);
    const N = Math.floor(1000 / ((callBid + putBid) * 100));
    let r = eng.json(`R(legacy(()=>openOptionStrategy(B, C, 'straddle', 'sell', 0, 0, 12, ${N})))`);
    ok(r.ok, `stratégie héritée : Carl a vendu ${N} straddles ATM (crédit ≈ 1 000 M$)`);
    ok(eng.json(`R(buyBonds(C, 1000))`).ok, 'Carl place 1 000 M$ en bons');
    const sid = eng.json(`opts(C)[0].sid`);
    const before = eng.json(`snapC()`), m0 = mass();
    r = eng.json(`R(closeOptionStrategy(C, ${JSON.stringify(sid)}))`);
    ok(!r.ok && /Encaisse personnelle insuffisante/.test(r.error), 'clôture du straddle vendu sans encaisse : REFUSÉE — « ' + r.error.slice(0, 90) + '… »');
    ok(same(eng.json(`snapC()`), before) && near(mass(), m0, 1e-9), 'refus d’un bloc : les deux jambes restent ouvertes, aucun argent ne bouge');
  }
  {
    // Spread vendu (call bas écrit, call haut acheté) : le débit de la jambe écrite dépasse l'encaisse, mais le
    // crédit de la jambe achetée la complète ; le débit NET est couvert => les DEUX jambes sont fermées.
    const { eng, mass, S } = await setup();
    let r = eng.json(`R(openOptionStrategy(B, C, 'bullSpread', 'sell', ${0.9 * S}, ${1.1 * S}, 12, 300))`);
    ok(r.ok, `Carl vend 300 bull spreads (plafond des calls longs) (${r.error || 'accepté'})`);
    const sid = eng.json(`opts(C)[0].sid`);
    const shortAsk = eng.run(`optionPremiumFor(B, 'call', ${0.9 * S}, 12, true)`), longBid = eng.run(`optionPremiumFor(B, 'call', ${1.1 * S}, 12, false)`);
    const netDebit = (shortAsk - longBid) * 300 * 100, gross = shortAsk * 300 * 100;
    eng.run(`C.cash = ${(netDebit + gross) / 2};`); // entre le débit net et le débit brut de la jambe écrite
    const before = eng.json(`snapC()`), m0 = mass();
    r = eng.json(`R(closeOptionStrategy(C, ${JSON.stringify(sid)}))`);
    const after = eng.json(`snapC()`);
    ok(r.ok && eng.json(`opts(C).length`) === 0, `débit net ${f2(netDebit)} M$ ≤ encaisse ${f2(before.cash)} M$ < débit brut ${f2(gross)} M$ : les deux jambes sont fermées`);
    ok(near(before.cash - after.cash, netDebit, 1e-9) && near(after.bank - before.bank, netDebit, 1e-9) && near(mass(), m0, 1e-9), 'Carl paie exactement le débit net à la banque, masse conservée');
    // Même spread, encaisse juste sous le débit net : refus d'un bloc.
    const g2 = await setup();
    g2.eng.json(`R(openOptionStrategy(B, C, 'bullSpread', 'sell', ${0.9 * S}, ${1.1 * S}, 12, 300))`);
    const sid2 = g2.eng.json(`opts(C)[0].sid`);
    g2.eng.run(`C.cash = ${netDebit - 0.01};`);
    const b2 = g2.eng.json(`snapC()`);
    r = g2.eng.json(`R(closeOptionStrategy(C, ${JSON.stringify(sid2)}))`);
    ok(!r.ok && same(g2.eng.json(`snapC()`), b2), 'encaisse 0,01 M$ sous le débit net : refus, aucune jambe fermée (pas de fermeture partielle)');
    // Marché fermé : refus explicite (avant : ok:true avec 0 contrat fermé).
    g2.eng.run(`C.cash = 1000; state.gameClock.rollCount = 4;`);
    r = g2.eng.json(`R(closeOptionStrategy(C, ${JSON.stringify(sid2)}))`);
    ok(!r.ok && /marché est fermé/.test(r.error), 'marché fermé : la clôture de stratégie est refusée explicitement (plus de « ok » à 0 contrat)');
  }

  // =====================================================================================================
  console.log('\nA3. Fermetures forcées : les bons d’abord, l’encaisse négative seulement si les bons ne suffisent pas');
  {
    const { eng, mass } = await setup();
    let r = eng.json(`R(legacy(()=>openShortPosition(B, C, 1000)))`);
    ok(r.ok, 'découvert hérité de 1 000 M$ sur Beta');
    ok(eng.json(`R(buyBonds(C, 1000))`).ok, 'Carl place 1 000 M$ en bons (encaisse 50 M$)');
    ok(eng.run(`marginableNetWorth(C) < requiredMaintenanceMargin(C)`), 'Carl est sous la marge de maintien');
    const before = eng.json(`snapC()`), m0 = mass();
    eng.run(`__logs.length = 0; enforceMarginCalls();`);
    const after = eng.json(`snapC()`);
    ok(after.short === 0, 'appel de marge : le découvert est fermé de force');
    ok(near(after.cash, 0, 1e-6), `l’encaisse ne devient PAS négative : ${f2(after.cash)} M$ (avant la retouche : −950 M$)`);
    ok(near(after.bonds, before.bonds - 950, 1e-6), `les bons paient le manque : ${f2(before.bonds)} → ${f2(after.bonds)} M$`);
    ok(near(mass(), m0, 1e-6), 'masse conservée (banque + entreprises + joueurs)');
    ok(eng.json(`__logs`).some(t => /vente automatique de 950\.00 M\$ de bons/.test(t)), 'le journal annonce la vente automatique des bons');
    // Sur un an : plus de dette gratuite face à un gros solde de bons.
    for(let i = 0; i < 6; i++) eng.run(`advanceGameClock()`);
    ok(eng.run(`C.cash`) > -1 && eng.run(`netWorth(C)`) < 52, `un an plus tard : encaisse ${f2(eng.run('C.cash'))} M$, valeur nette ${f2(eng.run('netWorth(C)'))} M$ (plus de gain sans risque)`);
  }
  {
    // Bons insuffisants : seul le reste rend l'encaisse négative.
    const { eng, mass } = await setup();
    eng.run(`legacy(()=>openShortPosition(B, C, 1000)); buyBonds(C, 100); C.cash = 0;`);
    const before = eng.json(`snapC()`), m0 = mass();
    const r = eng.json(`R(closeShortPosition(B, C, ${MAX}, true))`);
    const after = eng.json(`snapC()`);
    ok(r.ok && after.short === 0, 'fermeture forcée (_bypassTradingWindow) de 1 000 M$ avec 0 d’encaisse et 100 M$ de bons : acceptée');
    ok(near(after.bonds, 0, 1e-9) && near(after.cash, -900, 1e-6), `bons vidés (${f2(after.bonds)}), encaisse négative du seul reste : ${f2(after.cash)} M$`);
    ok(near(after.bank - before.bank, 1000 - 100, 1e-6) && near(mass(), m0, 1e-6), 'la banque reçoit 1 000 M$ et rembourse 100 M$ de bons : masse conservée');
  }
  {
    // Option écrite fermée de force : même cascade.
    const { eng, mass, S } = await setup();
    const K = 0.8 * S;
    const bid = eng.run(`optionPremiumFor(B, 'call', ${K}, 12, false)`);
    const N = Math.floor(1000 / (bid * 100));
    eng.run(`legacy(()=>openOptionPosition(B, C, 'call', 'short', ${K}, 12, ${N})); buyBonds(C, 1000);`);
    const before = eng.json(`snapC()`), m0 = mass();
    const ask = eng.run(`optionPremiumFor(B, 'call', ${K}, 12, true)`);
    const cost = N * 100 * ask;
    eng.run(`enforceMarginCalls()`);
    const after = eng.json(`snapC()`);
    ok(eng.json(`opts(C).length`) === 0, 'appel de marge : les calls écrits sont rachetés de force');
    ok(after.cash >= -1e-6 && near(after.bonds, before.bonds - (cost - before.cash), 1e-6), `encaisse ${f2(after.cash)} M$ (≥ 0), bons ${f2(before.bonds)} → ${f2(after.bonds)} M$ (manque de ${f2(cost - before.cash)} M$ payé par les bons)`);
    ok(near(mass(), m0, 1e-6), 'masse conservée (banque + entreprises + joueurs)');
  }

  // =====================================================================================================
  console.log('\nA4. Marge initiale à l’ouverture');
  {
    const { eng, mass, S } = await setup();
    const head = eng.run(`marginableNetWorth(C) - requiredMaintenanceMargin(C)`);
    const maxShort = Math.floor(head / 0.30 * 100) / 100;
    const bankShares = () => eng.run(`(B.shareholders.find(s=>s.playerId==='BANK')||{shares:0}).shares`);
    const before = eng.json(`snapC()`), bs0 = bankShares(), m0 = mass();
    let r = eng.json(`R(openShortPosition(B, C, 1000))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'découvert de 1 000 M$ avec 50 M$ de valeur nette : REFUSÉ — « ' + r.error.slice(0, 90) + '… »');
    ok(r.error.includes(`Montant maximal ouvrable : ${eng.run(`fmt(${maxShort})`)}`), `le refus donne le montant maximal ouvrable : ${eng.run(`fmt(${maxShort})`)}`);
    ok(same(eng.json(`snapC()`), before) && bankShares() === bs0 && near(mass(), m0, 1e-12), 'refus sans effet : encaisse, banque, parts de la banque inchangées');
    r = eng.json(`R(openShortPosition(B, C, ${maxShort}))`);
    ok(r.ok, `découvert du maximum annoncé (${f2(maxShort)} M$) : accepté`);
    ok(eng.run(`marginableNetWorth(C) >= requiredMaintenanceMargin(C)`), 'après l’ouverture, la marge de maintien est respectée');
    r = eng.json(`R(openShortPosition(B, C, 1))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'un découvert de plus (1 M$) : refusé');
    ok(eng.run(`(enforceMarginCalls(), !!(C.shortPositions && C.shortPositions[B.id]))`), 'pas d’appel de marge immédiat : la position reste ouverte');
  }
  {
    // Calls écrits nus : refus au-delà du maximum de contrats, le maximum annoncé est réellement ouvrable.
    const { eng, S } = await setup();
    const K = 0.8 * S;
    let r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${K}, 12, 400000))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'écriture de 400 000 calls nus : REFUSÉE — « ' + r.error.slice(0, 90) + '… »');
    const m = /Nombre maximal de contrats ouvrables : ([0-9   ]+)/.exec(r.error);
    const maxC = m ? parseInt(m[1].replace(/[^0-9]/g, ''), 10) : NaN;
    ok(maxC > 0 && maxC < 400000, `le refus donne le nombre maximal de contrats : ${maxC}`);
    r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${K}, 12, ${maxC}))`);
    ok(r.ok && eng.run(`marginableNetWorth(C) >= requiredMaintenanceMargin(C)`), `écriture de ${maxC} calls (le maximum) : acceptée, marge respectée`);
    r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${K}, 12, 1))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'un contrat de plus : refusé');
  }
  {
    // Ouvertures couvertes : aucune marge exigée, toujours possibles — même pour un joueur sous l'eau.
    const { eng, S } = await setup();
    ok(eng.json(`R(executeShareTrade(B, C, 'buy', 40))`).ok, 'Carl achète 40 M$ d’actions Beta');
    const held = eng.run(`B.shareholders.find(s=>s.playerId===C.id).shares`);
    const cc = Math.floor(held / 100);
    eng.run(`C.cash -= 200;`); // dette : valeur nette très négative
    ok(eng.run(`marginableNetWorth(C)`) < 0, `Carl est sous l’eau (valeur nette ${f2(eng.run('marginableNetWorth(C)'))} M$)`);
    let r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${1.1 * S}, 12, ${cc}))`);
    ok(r.ok && near(eng.run(`requiredMaintenanceMargin(C)`), 0, 1e-12), `covered call (${cc} contrats couverts par ses ${Math.round(held)} parts) : accepté, marge exigée 0`);
    r = eng.json(`R(openOptionPosition(B, C, 'call', 'short', ${1.1 * S}, 12, 1))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'un call de plus, non couvert : refusé');
    r = eng.json(`R(openShortPosition(B, C, 1))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'découvert de 1 M$ sous l’eau : refusé');
  }
  {
    const { eng, S } = await setup();
    const csp = Math.floor(eng.run(`C.cash`) / (S * 100));
    let r = eng.json(`R(openOptionPosition(B, C, 'put', 'short', ${S}, 12, ${csp}))`);
    ok(r.ok && near(eng.run(`requiredMaintenanceMargin(C)`), 0, 1e-12), `cash-secured put (${csp} puts ATM couverts par l’encaisse) : accepté, marge exigée 0`);
  }
  {
    // Stratégies : straddle vendu énorme refusé (maximum annoncé) ; bull spread acheté (jambe écrite protégée) accepté.
    const { eng, S } = await setup();
    let r = eng.json(`R(openOptionStrategy(B, C, 'straddle', 'sell', 0, 0, 12, 400000))`);
    ok(!r.ok && /Marge initiale insuffisante/.test(r.error), 'vente de 400 000 straddles : REFUSÉE — « ' + r.error.slice(0, 90) + '… »');
    const m = /Nombre maximal de contrats ouvrables : ([0-9   ]+)/.exec(r.error);
    const maxC = m ? parseInt(m[1].replace(/[^0-9]/g, ''), 10) : NaN;
    ok(maxC > 0 && maxC < 400000, `le refus donne le nombre maximal de contrats : ${maxC}`);
    r = eng.json(`R(openOptionStrategy(B, C, 'straddle', 'sell', 0, 0, 12, ${maxC}))`);
    ok(r.ok && eng.run(`marginableNetWorth(C) >= requiredMaintenanceMargin(C)`), `vente de ${maxC} straddles (le maximum) : acceptée, marge respectée`);
    const g2 = await setup();
    r = g2.eng.json(`R(openOptionStrategy(B, C, 'bullSpread', 'buy', ${0.9 * S}, ${1.1 * S}, 12, 300))`);
    ok(r.ok && near(g2.eng.run(`requiredMaintenanceMargin(C)`), 0, 1e-12), 'achat de 300 bull spreads (plafond des calls longs) (jambe écrite couverte par la jambe achetée) : accepté, marge exigée 0');
  }

  if(failures.length){
    console.log(`\n${failures.length} vérification(s) en ÉCHEC (${n} OK) :`);
    failures.forEach((m) => console.log('  - ' + m));
    process.exit(1);
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
