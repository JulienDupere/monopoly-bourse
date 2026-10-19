// Test — audit, bogue 1 (section 307) : titrisation (ABS) SANS tranche junior.
// Quand le montant recherché est inférieur ou égal à la capacité senior, computeAbsTranches donne juniorAmount = 0 :
// l'émission n'a alors aucun porteur junior (ni tiers, ni rétention par l'émettrice). Avant le correctif, une fois le
// plafond senior atteint, la part cédée du loyer n'était versée à PERSONNE, alors que settlePropertyRent et
// settleNeutralPawnRent la retiraient quand même à l'émettrice : l'argent disparaissait à chaque loyer.
// Règle (RESUME_ET_REGLES.md, section 275 point 5) : « le flux résiduel après la senior revient à l'émetteur ».
// Section 304 : abs_interest_expense de l'émettrice = somme des abs_income des porteurs, même lancer.
//
// Ce test vérifie, visite après visite : argent payé par le visiteur (ou la banque) = argent reçu par l'émettrice
// + porteurs + autres bénéficiaires (prêteurs), et la cohérence des écritures abs_interest_expense / abs_income.
// Lancer depuis la racine du dépôt :  node tests/audit-bug1.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const EPS = 1e-6;
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

(async () => {
  const eng = loadEngine();
  const { run, json } = eng;
  await eng.newGame(['Alice', 'Bob', 'Carla'], ['dividende', 'garp', 'garp']);
  run(`globalThis.A = state.companies.find(c=>c.name==='Co Alice');
       globalThis.B = state.companies.find(c=>c.name==='Co Bob');
       globalThis.C = state.companies.find(c=>c.name==='Co Carla');
       globalThis.BOB = state.players.find(p=>p.name==='Bob');
       globalThis.CARLA = state.players.find(p=>p.name==='Carla');
       state.settings.features.revenueSwap = true;
       state.settings.features.loan = true;
       state.rentCompensations = [];
       state.neutralPawns.push({id:'pion-test', name:'Pion test', position:0, inJail:false, jailTurnsLeft:0});
       globalThis.P = state.properties.find(p=>p.name==='Bleu foncé 2');
       P.owners = [{companyId:A.id, share:100}]; P.houses = 4; P.mortgages = []; P.insurance = null; P.subInsurance = null;`);
  const ids = json(`({A:A.id, B:B.id, C:C.id, BOB:BOB.id, CARLA:CARLA.id})`);
  // Les fonds de départ peuvent être modestes : on donne de la marge aux souscripteurs (la masse est mesurée en delta).
  run(`C.cash += 50; BOB.cash += 50; CARLA.cash += 50; B.cash += 500;`);
  const RENT = run(`colorRentAt(P, P.houses)`);
  ok(near(RENT, 17), `Bleu foncé 2 avec 4 maisons : loyer de 17 (obtenu ${RENT})`);

  // ---------- Outils ----------
  const snap = () => json(`({bank: state.bank.cash,
    co: Object.fromEntries(state.companies.map(c=>[c.id, c.cash])),
    pl: Object.fromEntries(state.players.map(p=>[p.id, p.cash])),
    plAbs: Object.fromEntries(state.players.map(p=>[p.id, p.cumAbsIncomeReceived||0])),
    led: state.finLedger.length})`);
  // Prépare une émission ABS sur P (60 % cédés, 5 ans) et la résout à l'ouverture du marché.
  async function emission(label, amountSought, subs, propsExpr = '[P.id]', years = 5){
    run(`state.revenueSwaps = []; state.revenueSwapListings = []; state.loans = []; state.gameClock.rollCount = 0;`);
    const r = await run(`postRevenueSwapListing(A.id, ${propsExpr}, 0.6, ${amountSought}, ${years}, {silent:true})`);
    ok(r && r.ok, `${label} : publication de l'émission acceptée (${amountSought} recherché)`);
    const lid = run(`state.revenueSwapListings[0].id`);
    for(const s of subs){
      const rs = await run(`subscribeRevenueSwapTranche(${JSON.stringify(lid)}, '${s.tranche}', '${s.type}', ${JSON.stringify(s.id)}, ${s.max}, {silent:true})`);
      ok(rs && rs.ok, `${label} : souscription ${s.tranche} de ${s.who} jusqu'à ${s.max}`);
    }
    const tranches = json(`state.revenueSwapListings[0].tranches`);
    const m0 = eng.cashTotal();
    run(`maybeResolveRevenueSwapListings()`);
    ok(near(eng.cashTotal(), m0), `${label} : la résolution conserve la masse monétaire`);
    run(`state.gameClock.rollCount = 1;`);
    const deal = json(`state.revenueSwaps[0]`);
    ok(!!deal, `${label} : accord ABS actif après résolution`);
    return {tranches, deal};
  }
  // Une visite : la société B (ou le pion neutre, loyer payé par la banque) tombe sur P.
  // holders : ids (entreprises ou joueurs) des porteurs ; lenders : ids des prêteurs non bancaires éventuels.
  async function visite(kind, holders, prop = 'P'){
    const s0 = snap(), m0 = eng.cashTotal();
    if(kind==='pion') await run(`settleNeutralPawnRent(${prop}, 'pion-test', 7, {skipSave:true})`);
    else await run(`settlePropertyRent(${prop}, B.id, 7, {skipSave:true})`);
    const s1 = snap(), m1 = eng.cashTotal();
    const led = json(`state.finLedger.slice(${s0.led})`);
    const dCo = (id) => (s1.co[id]||0) - (s0.co[id]||0), dPl = (id) => (s1.pl[id]||0) - (s0.pl[id]||0);
    const dOf = (id) => (id in s1.co ? dCo(id) : dPl(id));
    const payeur = kind==='pion' ? (s1.bank - s0.bank) : dCo(ids.B);
    const emettrice = dCo(ids.A);
    const porteurs = holders.reduce((s, id) => s + dOf(id), 0);
    // Tous les autres (banque si elle n'est pas le payeur, autres entreprises, joueurs) : prêteurs, etc.
    let autres = 0;
    if(kind!=='pion') autres += s1.bank - s0.bank;
    Object.keys(s1.co).forEach(id => { if(id!==ids.A && id!==ids.B && !holders.includes(id)) autres += dCo(id); });
    Object.keys(s1.pl).forEach(id => { if(!holders.includes(id)) autres += dPl(id); });
    const sumCat = (cat, who) => led.filter(e => e.category===cat && (!who || e.companyId===who)).reduce((s, e) => s + e.amount, 0);
    const absIncomePl = Object.keys(s1.plAbs).reduce((s, id) => s + (s1.plAbs[id] - s0.plAbs[id]), 0);
    return {payeur, emettrice, porteurs, autres, dMasse: m1 - m0,
      absExpense: sumCat('abs_interest_expense', ids.A), absIncome: sumCat('abs_income') + absIncomePl,
      absIncomeEmettrice: sumCat('abs_income', ids.A), rentRevenue: sumCat('rent_revenue', ids.A),
      seniorPaidSoFar: run(`state.revenueSwaps[0].seniorPaidSoFar`), dOf};
  }
  function bilan(label, i, v, rent = RENT){
    console.log(`  ${label} visite ${i} : payeur ${f(v.payeur)} | émettrice ${f(v.emettrice)} | porteurs ${f(v.porteurs)} | autres ${f(v.autres)} | Δ masse ${f(v.dMasse)} | abs_interest_expense ${f(v.absExpense)} / abs_income ${f(v.absIncome)}`);
    ok(near(v.dMasse, 0, EPS), `${label} visite ${i} : masse monétaire conservée (Δ = ${f(v.dMasse)})`);
    ok(near(-v.payeur, v.emettrice + v.porteurs + v.autres, EPS),
      `${label} visite ${i} : payé ${f(-v.payeur)} = émettrice ${f(v.emettrice)} + porteurs ${f(v.porteurs)} + autres ${f(v.autres)}`);
    ok(near(-v.absExpense, v.absIncome, EPS),
      `${label} visite ${i} : abs_interest_expense (${f(v.absExpense)}) = − somme des abs_income des porteurs (${f(v.absIncome)}) (section 304)`);
    ok(near(v.rentRevenue, rent, EPS), `${label} visite ${i} : rent_revenue de l'émettrice au montant brut (${f(v.rentRevenue)})`);
  }

  // =====================================================================================================
  // S1 — scénario de la fiche (C73) : 1,80 recherché pour une capacité senior de 3,61 -> junior = 0.
  // C souscrit toute la senior (plafond 2,07). B visite 12 fois.
  console.log('S1 — junior nulle, senior pleinement souscrite, 12 visites de B');
  {
    const {tranches, deal} = await emission('S1', 1.8, [{tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:5}]);
    ok(near(tranches.juniorAmount, 0) && near(tranches.seniorAmount, 1.8), `S1 : tranches senior 1,8 / junior 0 (senior ${f(tranches.seniorAmount)}, junior ${f(tranches.juniorAmount)})`);
    ok(deal.juniorHolders.length===0, 'S1 : aucun porteur junior (ni tiers, ni rétention)');
    const cap = deal.seniorCapTotal;
    ok(cap > 2 && cap < 2.1, `S1 : plafond senior ≈ 2,07 (${f(cap)})`);
    let totEmettrice = 0, totPorteurs = 0, totPaye = 0, totExpense = 0, totIncome = 0;
    for(let i = 1; i <= 12; i++){
      const v = await visite('B', [ids.C]);
      bilan('S1', i, v);
      totEmettrice += v.emettrice; totPorteurs += v.porteurs; totPaye += -v.payeur; totExpense += v.absExpense; totIncome += v.absIncome;
      if(i === 1){
        ok(near(v.porteurs, cap, EPS), `S1 visite 1 : le porteur senior reçoit exactement son plafond (${f(v.porteurs)})`);
        ok(near(v.emettrice, RENT - cap, EPS), `S1 visite 1 : l'émettrice garde le reste du loyer, part cédée non versée comprise (${f(v.emettrice)})`);
        ok(near(v.absExpense, -cap, EPS), `S1 visite 1 : abs_interest_expense = montant réellement versé au porteur (${f(v.absExpense)})`);
      } else {
        ok(near(v.porteurs, 0, EPS), `S1 visite ${i} : senior servie, le porteur ne reçoit plus rien`);
        ok(near(v.emettrice, RENT, EPS), `S1 visite ${i} : l'émettrice reçoit le loyer entier (${f(v.emettrice)})`);
        ok(near(v.absExpense, 0, EPS), `S1 visite ${i} : aucune dépense d'intérêt ABS (rien n'a été versé aux porteurs)`);
      }
    }
    ok(near(totPaye, 12*RENT, EPS) && near(totEmettrice + totPorteurs, totPaye, EPS),
      `S1 total : payé ${f(totPaye)} = émettrice ${f(totEmettrice)} + porteur ${f(totPorteurs)} (rien de détruit)`);
    ok(near(totPorteurs, cap, EPS) && near(run(`state.revenueSwaps[0].seniorPaidSoFar`), cap, EPS), 'S1 total : la senior a reçu son plafond, pas plus');
    ok(near(-totExpense, totIncome, EPS) && near(-totExpense, cap, EPS), `S1 total : abs_interest_expense cumulé ${f(totExpense)} = abs_income cumulé ${f(totIncome)}`);
  }

  // =====================================================================================================
  // S2 — junior nulle ET senior sous-souscrite (plafond recalculé sur le montant levé), avec un porteur joueur.
  console.log('S2 — junior nulle, senior sous-souscrite (Co Carla 0,5 + joueur Bob 0,3)');
  {
    const {deal} = await emission('S2', 1.8, [
      {tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:0.5},
      {tranche:'senior', type:'player', id:ids.BOB, who:'Bob (joueur)', max:0.3}]);
    ok(near(deal.seniorRaised, 0.8) && deal.juniorHolders.length===0, `S2 : senior levée 0,8, aucun porteur junior (levé ${f(deal.seniorRaised)})`);
    const cap = deal.seniorCapTotal;
    for(let i = 1; i <= 4; i++){
      const v = await visite('B', [ids.C, ids.BOB]);
      bilan('S2', i, v);
      const attendu = i === 1 ? cap : 0;
      ok(near(v.porteurs, attendu, EPS), `S2 visite ${i} : porteurs ${f(v.porteurs)} (attendu ${f(attendu)})`);
      ok(near(v.emettrice, RENT - attendu, EPS), `S2 visite ${i} : émettrice ${f(v.emettrice)} (attendu ${f(RENT - attendu)})`);
      if(i === 1) ok(near(v.dOf(ids.BOB), cap*0.3/0.8, EPS), `S2 visite 1 : le joueur Bob reçoit sa quote-part du plafond (${f(v.dOf(ids.BOB))})`);
    }
  }

  // =====================================================================================================
  // S3 — chemin jumeau settleNeutralPawnRent (loyer payé par la banque) ; une souscription junior est ignorée
  // puisque la tranche junior est nulle (aucun argent ne doit bouger pour Carla).
  console.log('S3 — pion neutre (banque payeuse), junior nulle, souscription junior ignorée');
  {
    const carla0 = run(`CARLA.cash`);
    const {deal} = await emission('S3', 1.8, [
      {tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:5},
      {tranche:'junior', type:'player', id:ids.CARLA, who:'Carla (joueuse)', max:1}]);
    ok(deal.juniorHolders.length===0 && near(run(`CARLA.cash`), carla0), 'S3 : la souscription junior de Carla est ignorée (junior nulle), son argent ne bouge pas');
    const cap = deal.seniorCapTotal;
    for(let i = 1; i <= 4; i++){
      const v = await visite('pion', [ids.C]);
      bilan('S3 (pion)', i, v);
      const attendu = i === 1 ? cap : 0;
      ok(near(-v.payeur, RENT, EPS), `S3 visite ${i} : la banque paie le loyer plein (${f(-v.payeur)})`);
      ok(near(v.porteurs, attendu, EPS) && near(v.emettrice, RENT - attendu, EPS),
        `S3 visite ${i} : porteur ${f(v.porteurs)}, émettrice ${f(v.emettrice)} (le non-versé reste à l'émettrice)`);
    }
    // Une visite d'entreprise après des visites de pion : même règle.
    const v = await visite('B', [ids.C]);
    bilan('S3 (B après pions)', 5, v);
    ok(near(v.emettrice, RENT, EPS), 'S3 : visite de B après les pions, l\'émettrice reçoit le loyer entier');
  }

  // =====================================================================================================
  // S4 — autres bénéficiaires : l'émettrice a un prêt normal (30 %) et un prêt de dernier recours (50 %) auprès de
  // la banque, et un prêt normal (10 %) auprès du joueur Carla. Les retenues portent sur ce qui reste à l'émettrice.
  console.log('S4 — junior nulle, prêts actifs de l\'émettrice (banque + joueuse Carla)');
  {
    const {deal} = await emission('S4', 1.8, [{tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:5}]);
    run(`state.loans.push({id:'pret-banque', lenderId:'BANK', lenderKind:'bank', borrowerId:A.id, principal:100, totalDue:1000, repaidSoFar:0, withholdingPct:0.3, multiple:10});
         state.loans.push({id:'pret-carla', lenderId:CARLA.id, lenderKind:'player', borrowerId:A.id, principal:100, totalDue:1000, repaidSoFar:0, withholdingPct:0.1, multiple:10});
         state.loans.push({id:'pret-dr', lenderId:'BANK', lenderKind:'bank', borrowerId:A.id, principal:100, totalDue:1000, repaidSoFar:0, withholdingPct:0.5, multiple:10, lastResort:true});`);
    const cap = deal.seniorCapTotal;
    for(let i = 1; i <= 3; i++){
      const v = await visite('B', [ids.C]);
      bilan('S4', i, v);
      const versé = i === 1 ? cap : 0;
      // Retenues normales : 30 % puis 10 % du reste ; cession ; dernier recours : 50 % du résiduel.
      const apresNormal = RENT * 0.7 * 0.9;
      const residuel = apresNormal - versé;
      const attenduEmettrice = residuel * 0.5;
      ok(near(v.porteurs, versé, EPS), `S4 visite ${i} : porteur ${f(v.porteurs)} (attendu ${f(versé)})`);
      ok(near(v.emettrice, attenduEmettrice, EPS), `S4 visite ${i} : émettrice ${f(v.emettrice)} (attendu ${f(attenduEmettrice)})`);
      ok(near(v.autres, RENT - versé - attenduEmettrice, EPS), `S4 visite ${i} : prêteurs (banque + Carla) ${f(v.autres)}`);
    }
    run(`state.loans = [];`);
  }

  // =====================================================================================================
  // S5 — témoins inchangés : junior > 0 (5 recherché) avec une junior tierce (Carla 0,5) et le solde retenu par
  // l'émettrice (rétention synthétique, section 275). La cascade doit rester exactement celle d'avant.
  console.log('S5 — témoin : junior non nulle, porteur tiers + rétention de l\'émettrice');
  {
    const {tranches, deal} = await emission('S5', 5, [
      {tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:10},
      {tranche:'junior', type:'player', id:ids.CARLA, who:'Carla (joueuse)', max:0.5}]);
    ok(tranches.juniorAmount > 0.5, `S5 : junior non nulle (${f(tranches.juniorAmount)})`);
    const jT = deal.juniorHolders.reduce((s, h) => s + h.amount, 0);
    const ret = deal.juniorHolders.find(h => h.holderId===ids.A);
    ok(deal.juniorHolders.length===2 && !!ret, 'S5 : deux porteurs junior (Carla + rétention de l\'émettrice)');
    const cap = deal.seniorCapTotal, ceded = RENT*0.6;
    let servi = 0;
    for(let i = 1; i <= 3; i++){
      const v = await visite('B', [ids.C, ids.CARLA]);
      bilan('S5', i, v);
      ok(near(v.absExpense, -ceded, EPS), `S5 visite ${i} : toute la part cédée est versée (abs_interest_expense ${f(v.absExpense)})`);
      const toSenior = Math.min(ceded, cap - servi); servi += toSenior;
      const toJunior = ceded - toSenior;
      const carla = toJunior * (0.5/jT), retention = toJunior * (ret.amount/jT);
      ok(near(v.dOf(ids.C), toSenior, EPS) && near(v.dOf(ids.CARLA), carla, EPS),
        `S5 visite ${i} : senior ${f(v.dOf(ids.C))}, junior Carla ${f(v.dOf(ids.CARLA))}`);
      ok(near(v.emettrice, RENT - ceded + retention, EPS) && near(v.absIncomeEmettrice, retention, EPS),
        `S5 visite ${i} : émettrice ${f(v.emettrice)} dont rétention junior ${f(v.absIncomeEmettrice)}`);
    }
  }

  // =====================================================================================================
  // S6 — variante de la fiche (C30) : panier de trois terrains (les trois Orange avec hôtel), 3 ans, montant
  // recherché = 80 % de la capacité senior -> junior nulle. B visite les trois terrains tour à tour.
  console.log('S6 — panier des trois Orange (hôtels), 3 ans, 80 % de la capacité, junior nulle');
  {
    run(`globalThis.O1 = state.properties.find(p=>p.name==='Orange 1');
         globalThis.O2 = state.properties.find(p=>p.name==='Orange 2');
         globalThis.O3 = state.properties.find(p=>p.name==='Orange 3');
         [O1, O2, O3].forEach(p=>{ p.owners = [{companyId:A.id, share:100}]; p.houses = 5; p.mortgages = []; p.insurance = null; p.subInsurance = null; });`);
    const cap0 = run(`computeAbsPricing(A.id, [O1.id, O2.id, O3.id], 0.6, 3).seniorCapacity`);
    const {tranches, deal} = await emission('S6', 0.8*cap0, [{tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:50}], '[O1.id, O2.id, O3.id]', 3);
    ok(near(tranches.juniorAmount, 0) && deal.juniorHolders.length===0, `S6 : junior nulle sur le panier (capacité ${f(cap0)}, senior ${f(tranches.seniorAmount)})`);
    const cap = deal.seniorCapTotal;
    let servi = 0, totPaye = 0, totRecu = 0;
    const tour = ['O1', 'O3', 'O2', 'O1', 'O3', 'O2'];
    for(let i = 0; i < tour.length; i++){
      const rent = run(`colorRentAt(${tour[i]}, ${tour[i]}.houses)`);
      const v = await visite('B', [ids.C], tour[i]);
      bilan(`S6 (${tour[i]})`, i + 1, v, rent);
      const toSenior = Math.min(rent*0.6, cap - servi); servi += toSenior;
      ok(near(v.porteurs, toSenior, EPS) && near(v.emettrice, rent - toSenior, EPS),
        `S6 visite ${i + 1} : porteur ${f(v.porteurs)} (attendu ${f(toSenior)}), émettrice ${f(v.emettrice)} (attendu ${f(rent - toSenior)})`);
      totPaye += -v.payeur; totRecu += v.emettrice + v.porteurs;
    }
    ok(near(totPaye, totRecu, EPS) && near(servi, cap, EPS), `S6 total : payé ${f(totPaye)} = reçu ${f(totRecu)} ; senior servie à son plafond ${f(cap)}`);
  }

  // =====================================================================================================
  // S7 — robustesse « panier sans porteur » : le seul porteur senior n'existe plus (identifiant introuvable). Rien ne
  // lui est versé, donc rien ne doit être retiré à l'émettrice ni passé en abs_interest_expense.
  console.log('S7 — porteur introuvable : la part cédée non versée reste à l\'émettrice');
  {
    await emission('S7', 1.8, [{tranche:'senior', type:'company', id:ids.C, who:'Co Carla', max:5}]);
    run(`state.revenueSwaps[0].seniorHolders[0].holderId = 'entreprise-disparue';`);
    const v = await visite('B', [ids.C]);
    bilan('S7', 1, v);
    ok(near(v.porteurs, 0, EPS) && near(v.emettrice, RENT, EPS), `S7 : rien versé au porteur introuvable, l'émettrice reçoit ${f(v.emettrice)}`);
    ok(near(v.absExpense, 0, EPS), 'S7 : aucune dépense d\'intérêt ABS inscrite');
    ok(near(run(`state.revenueSwaps[0].seniorHolders[0].receivedSoFar||0`), 0, EPS), 'S7 : receivedSoFar du porteur introuvable reste à 0');
  }

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
