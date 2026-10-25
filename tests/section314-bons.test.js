// Section 314 — bogues 7 et 36 de l'audit du 2026-10-19 : bons gouvernementaux.
//   Bogue 7  : la banque payait chaque intérêt deux fois. accrueBondInterest débitait la banque à chaque lancer (sans
//              créditer personne), puis withdrawBonds lui faisait payer de nouveau capital + intérêts au retrait :
//              un placement détruisait de l'argent, un emprunt en créait. Désormais la banque garde le dépôt et
//              l'intérêt s'ajoute au solde de bons sans mouvement d'encaisse : il n'est payé (ou reçu) qu'une fois,
//              au retrait (ou au remboursement). cashTotal() est conservé à chaque étape.
//   Bogue 36 : un bid ne s'exécutait jamais quand l'encaisse était négative, même avec assez de bons (le manque était
//              calculé sur max(0, encaisse)). Désormais le bid est payé avec l'encaisse puis les bons : les bons
//              comblent d'abord l'encaisse négative, puis le prix.
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section314-bons.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Ancien code (contre-épreuves).
const ANCIEN_INTERET = src => src.replace(
  /(const interest = p\.bondBalance\*perRollRate;\n    p\.bondBalance \+= interest;\n)/,
  '$1    state.bank.cash -= interest;\n');
const ANCIEN_BID = src => src.replace(
  /function fillPendingBid\(player, company, bid\)\{[\s\S]*?\n\}\n/,
  `function fillPendingBid(player, company, bid){
  const price = bid.price;
  if(!(price>0)) return {filled:0};
  const cashAvail = Math.max(0, player.cash||0);
  const bondsAvail = Math.max(0, player.bondBalance||0);
  const totalAvail = cashAvail + bondsAvail;
  if(totalAvail<=1e-9) return {filled:0};
  const affordableQty = totalAvail/price;
  const qtyToFill = Math.min(bid.qty, affordableQty);
  if(qtyToFill<=1e-9) return {filled:0};
  const amount = qtyToFill*price;
  const bondsNeeded = Math.max(0, amount-cashAvail);
  if(bondsNeeded>1e-9){
    player.bondBalance -= bondsNeeded;
    player.cash += bondsNeeded;
    state.bank.cash -= bondsNeeded;
  }
  const r = executeShareTrade(company, player, 'buy', amount, false, price);
  if(!r.ok){
    if(bondsNeeded>1e-9){ player.bondBalance += bondsNeeded; player.cash -= bondsNeeded; state.bank.cash += bondsNeeded; }
    return {filled:0};
  }
  bid.qty -= qtyToFill;
  return {filled:qtyToFill, entries:r.entries, amount, qty:qtyToFill};
}
`);

// Partie à trois : Alice (Co Alice), Bob (Co Bob), Carl sans entreprise. Taux sans risque 3 %/an (0,5 %/lancer).
async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`globalThis.ALICE = state.players[0]; globalThis.BOB = state.players[1]; globalThis.C = state.players[2];
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    state.settings.riskFreeRateAnnual = 0.03; state.gameClock.rollCount = 0;
    injectStockCube = function(){ return 0; };`);
  return eng;
}

// --- Bogue 7 --------------------------------------------------------------------------------------------------
async function bug7(eng){
  // Placement : Alice place 4 M$, 6 lancers d'intérêts (un an), puis retire tout.
  const t0 = eng.cashTotal();
  const alice0 = eng.run('ALICE.cash'), bank0 = eng.run('state.bank.cash');
  ok(eng.json('buyBonds(ALICE, 4)').ok, '7 : Alice place 4 M$ en bons (marché ouvert)');
  ok(near(eng.cashTotal(), t0), '7 : placement — monnaie conservée (encaisse d’Alice → banque)');
  const steps = [];
  for(let i = 0; i < 6; i++){ eng.run('accrueBondInterest()'); steps.push(eng.cashTotal()); }
  const solde = eng.run('ALICE.bondBalance'), attendu = 4 * (Math.pow(1.005, 6) - 1);
  ok(steps.every(t => near(t, t0, 1e-9)), `7 : chacun des 6 lancers d’intérêts laisse la masse inchangée (${steps.map(f4).join(', ')})`);
  ok(near(solde, 4 + attendu, 1e-9), `7 : solde de bons 4 × 1,005^6 = ${f4(4 + attendu)} M$ (obtenu : ${f4(solde)})`);
  ok(near(eng.run('ALICE.cumBondInterest'), attendu, 1e-9), `7 : intérêts cumulés affichés ${f4(attendu)} M$`);
  eng.run('state.gameClock.rollCount = 6');
  ok(eng.json(`withdrawBonds(ALICE, ALICE.bondBalance)`).ok, `7 : Alice retire ${f4(solde)} M$`);
  const gainAlice = eng.run('ALICE.cash') - alice0, perteBanque = bank0 - eng.run('state.bank.cash');
  ok(near(gainAlice, attendu, 1e-9), `7 : Alice gagne ${f4(gainAlice)} M$ (intérêts ${f4(attendu)})`);
  ok(near(perteBanque, attendu, 1e-9), `7 : la banque paie l’intérêt UNE fois : −${f4(perteBanque)} M$ (avant : −0,2430, deux fois)`);
  ok(near(eng.cashTotal(), t0, 1e-9), `7 : placement complet — masse totale inchangée (écart ${f4(eng.cashTotal() - t0)} ; avant : −0,1215)`);

  // Emprunt : Bob emprunte 4 M$ en bons (vente à découvert de bons), un an, puis rembourse en rachetant des bons.
  eng.run('state.gameClock.rollCount = 6; state.settings.bondShortMax = 10');
  const t1 = eng.cashTotal(), bob1 = eng.run('BOB.cash'), bank1 = eng.run('state.bank.cash');
  ok(eng.json('shortBonds(BOB, 4)').ok && near(eng.run('BOB.bondBalance'), -4), '7 : Bob emprunte 4 M$ (solde de bons −4)');
  ok(near(eng.cashTotal(), t1), '7 : emprunt — monnaie conservée (banque → Bob)');
  const steps2 = [];
  for(let i = 0; i < 6; i++){ eng.run('accrueBondInterest()'); steps2.push(eng.cashTotal()); }
  ok(steps2.every(t => near(t, t1, 1e-9)), '7 : les 6 lancers d’intérêts d’emprunt laissent la masse inchangée');
  const dette = -eng.run('BOB.bondBalance');
  ok(near(dette, 4 + attendu, 1e-9), `7 : dette de Bob 4 × 1,005^6 = ${f4(dette)} M$`);
  ok(near(eng.run('BOB.cumInterestPaid'), attendu, 1e-9), `7 : intérêts payés cumulés de Bob ${f4(attendu)} M$`);
  eng.run('state.gameClock.rollCount = 12');
  ok(eng.json(`buyBonds(BOB, ${dette})`).ok && near(eng.run('BOB.bondBalance'), 0, 1e-9), `7 : Bob rembourse ${f4(dette)} M$ (solde de bons 0)`);
  const coutBob = bob1 - eng.run('BOB.cash'), gainBanque = eng.run('state.bank.cash') - bank1;
  ok(near(coutBob, attendu, 1e-9) && near(gainBanque, attendu, 1e-9), `7 : Bob paie ${f4(coutBob)} M$ d’intérêts, la banque les reçoit une fois (+${f4(gainBanque)})`);
  ok(near(eng.cashTotal(), t1, 1e-9), `7 : emprunt complet — masse totale inchangée (écart ${f4(eng.cashTotal() - t1)} ; avant : +0,1215)`);

  // Règlement forcé (appel de marge, exercice) : les bons vendus d'office sont payés par la banque, une seule fois.
  eng.run('state.gameClock.rollCount = 12');
  eng.json('buyBonds(C, 10)');
  const t2 = eng.cashTotal(), c2 = eng.json('({cash:C.cash, bonds:C.bondBalance, bank:state.bank.cash})');
  const raised = eng.run(`raiseCashForForcedSettlement(C, 3, 'test')`);
  const c3 = eng.json('({cash:C.cash, bonds:C.bondBalance, bank:state.bank.cash})');
  ok(near(raised, 3) && near(c3.bonds, c2.bonds - 3) && near(c3.cash, c2.cash + 3) && near(c3.bank, c2.bank - 3) && near(eng.cashTotal(), t2),
    '7 : vente forcée de 3 M$ de bons — bons −3, encaisse +3, banque −3, masse inchangée');
}

// --- Bogue 36 -------------------------------------------------------------------------------------------------
async function bug36(eng){
  const price = eng.run('B.stockPrice');
  const qty = 5 / price;
  eng.run(`buyBonds(ALICE, 10); ALICE.cash = -0.5; ALICE.pendingBids = [];`);
  ok(eng.json(`placeBid(ALICE, B, ${price}, ${qty})`).ok, `36 : Alice (encaisse −0,5 M$, bons 10 M$) place un bid de ${qty.toFixed(0)} parts de Co Bob à ${price} M$/part (5 M$)`);
  const t0 = eng.cashTotal();
  const parts0 = eng.run(`(B.shareholders.find(s=>s.playerId===ALICE.id)||{shares:0}).shares`);
  eng.run('checkPendingOrders(B)');
  const parts1 = eng.run(`(B.shareholders.find(s=>s.playerId===ALICE.id)||{shares:0}).shares`);
  const s = eng.json('({cash:ALICE.cash, bonds:ALICE.bondBalance, bids:ALICE.pendingBids.length})');
  console.log(`    après le déclenchement : parts +${(parts1 - parts0).toFixed(0)}, encaisse ${f4(s.cash)}, bons ${f4(s.bonds)}, bids restants ${s.bids}`);
  ok(near(parts1 - parts0, qty, 1e-6), `36 : le bid s’exécute en entier : +${(parts1 - parts0).toFixed(0)} parts (avant : 0, à chaque lancer)`);
  ok(near(s.cash, 0, 1e-9) && near(s.bonds, 4.5, 1e-9), `36 : payé avec l’encaisse puis les bons : 5,5 M$ de bons vendus (0,5 comblent l’encaisse négative, 5 paient), encaisse 0, bons 4,5 (obtenu : ${f4(s.cash)} / ${f4(s.bonds)})`);
  ok(s.bids === 0, '36 : le bid exécuté quitte la liste');
  ok(near(eng.cashTotal(), t0, 1e-9), '36 : monnaie conservée');
  // Remplissage partiel : encaisse −3, bons 5 → liquidité nette 2 M$ → bid de 5 M$ rempli pour 2 M$.
  eng.run(`ALICE.bondBalance = 5; ALICE.cash = -3; ALICE.pendingBids = [];`);
  eng.json(`placeBid(ALICE, B, ${price}, ${qty})`);
  const p2 = eng.run(`(B.shareholders.find(s=>s.playerId===ALICE.id)||{shares:0}).shares`);
  eng.run('checkPendingOrders(B)');
  const p3 = eng.run(`(B.shareholders.find(s=>s.playerId===ALICE.id)||{shares:0}).shares`);
  const s2 = eng.json('({cash:ALICE.cash, bonds:ALICE.bondBalance, left:ALICE.pendingBids.length ? ALICE.pendingBids[0].qty : 0})');
  ok(near((p3 - p2) * price, 2, 1e-9) && near(s2.cash, 0, 1e-9) && near(s2.bonds, 0, 1e-9) && near(s2.left * price, 3, 1e-9),
    `36 : encaisse −3, bons 5 → achat partiel de 2 M$ (liquidité nette), bons 0, encaisse 0, reste du bid 3 M$`);
  // Liquidité nette négative : rien ne bouge.
  eng.run(`ALICE.bondBalance = 2; ALICE.cash = -3; ALICE.pendingBids = [];`);
  eng.json(`placeBid(ALICE, B, ${price}, ${qty})`);
  const before = eng.json('({cash:ALICE.cash, bonds:ALICE.bondBalance})');
  eng.run('checkPendingOrders(B)');
  const after = eng.json('({cash:ALICE.cash, bonds:ALICE.bondBalance, left:ALICE.pendingBids.length})');
  ok(near(after.cash, before.cash) && near(after.bonds, before.bonds) && after.left === 1, '36 : encaisse −3, bons 2 (liquidité −1) → aucun achat, bons intacts, bid conservé');
}

(async () => {
  await scenario('A. Bogue 7 — intérêt des bons payé ou reçu une seule fois, masse conservée', async () => {
    await bug7(await setup());
  });
  await scenario('B. Bogue 7 — contre-épreuve (banque débitée à chaque lancer)', async () => {
    let failed = null;
    try{ await bug7(await setup(ANCIEN_INTERET)); }catch(e){ failed = e.message; }
    ok(failed && /7 :/.test(failed), `contre-épreuve : l’ancien calcul échoue (${failed})`);
  });
  await scenario('C. Bogue 36 — bid payé avec l’encaisse négative puis les bons', async () => {
    await bug36(await setup());
  });
  await scenario('D. Bogue 36 — contre-épreuve (manque calculé sur max(0, encaisse))', async () => {
    let failed = null;
    try{ await bug36(await setup(ANCIEN_BID)); }catch(e){ failed = e.message; }
    ok(failed && /36 :/.test(failed), `contre-épreuve : l’ancien fillPendingBid échoue (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 314 (bons, bogues 7 et 36) — ${n} vérifications, 0 scénario(s) en échec`);
})();
