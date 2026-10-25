// Test — Section 311, bogue 70 : ABS combinée à un accord de compensation : le loyer cédé disparaissait des états
// financiers de l'émettrice (ni loyer, ni charge d'intérêt d'ABS), alors que la trésorerie était juste.
// Correctif : l'émettrice enregistre, comme sans compensation, le loyer réglé en argent (versé aux porteurs) et la charge
// d'intérêt d'ABS ; la part inscrite au registre est constatée au règlement de fin d'année (jamais deux fois).
// Lancer depuis la racine du dépôt :  node tests/section311-abs-compensation.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const f = (x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4);

async function scenario(opts, withCompensation){
  const eng = loadEngine(opts);
  const { run, json } = eng;
  await eng.newGame(['Zéro', 'Un', 'Deux'], ['garp', 'garp', 'garp']);
  // Scénario de l'audit : Co1 possède 90 % du lot Vert (regroupé, règle du bogue 18), a émis une ABS à 60 % souscrite
  // par Co2 (junior : tout le flux cédé lui revient), et un accord de compensation avec Co0. Co0 passe sur Vert 1.
  run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2];
       state.settings.features.revenueSwap = true; state.settings.features.loan = false; state.settings.features.rentCompensation = true;
       globalThis.V = ['Vert 1','Vert 2','Vert 3'].map(nm=>state.properties.find(p=>p.name===nm));
       V.forEach(p=>{ p.owners = [{companyId:C1.id, share:90}]; p.houses = 0; p.mortgages = []; p.groupMergeId = 'lot-vert'; });
       V[0].houses = 1;
       C2.cash += 100; C0.cash += 100; state.gameClock.rollCount = 0; state.rentCompensations = [];
       state.revenueSwaps = [{id:'abs', sellerId:C1.id, propertyIds:[V[0].id], cededPctOfShare:0.6, years:3, yearsRemaining:3, endRoll:18,
         pricing:{termRolls:18, meanRent:10, stdRent:1, seniorCapacity:0}, seniorPremiumPct:0.1, seniorRaised:0, juniorRaised:1, seniorCapTotal:0, seniorPaidSoFar:0,
         seniorHolders:[], juniorHolders:[{holderType:'company', holderId:C2.id, amount:1, receivedSoFar:0}]}];
       ${withCompensation ? `state.rentCompensations.push({id:'comp', companyA:C0.id, companyB:C1.id, interestRate:0.05, balance:0});` : ''}`);
  const full = run(`colorRentAt(V[0], V[0].houses) * 0.9`);
  const bankPart = run(`state.settings.bankCollectsRent ? colorRentAt(V[0], V[0].houses) * purchasableBankShare(V[0])/100 : 0`); // part non détenue (10 %)
  const led0 = run(`state.finLedger.length`), m0 = eng.cashTotal();
  const cash0 = json(`({c0:C0.cash, c1:C1.cash, c2:C2.cash})`);
  await run(`settlePropertyRent(V[0], C0.id, 7, {skipSave:true})`);
  const led = json(`state.finLedger.slice(${led0})`);
  const sum = (cat, id) => led.filter(e => e.category === cat && e.companyId === id).reduce((s, e) => s + e.amount, 0);
  const ids = json(`({c0:C0.id, c1:C1.id, c2:C2.id})`);
  const cash1 = json(`({c0:C0.cash, c1:C1.cash, c2:C2.cash})`);
  return { eng, full, ids, bankPart,
    rent: sum('rent_revenue', ids.c1), interest: sum('abs_interest_expense', ids.c1), absIncome: sum('abs_income', ids.c2),
    visitorExpense: sum('rent_expense', ids.c0), balance: run(`(state.rentCompensations[0]||{}).balance||0`),
    dCash: { c0: cash1.c0 - cash0.c0, c1: cash1.c1 - cash0.c1, c2: cash1.c2 - cash0.c2 }, dMasse: eng.cashTotal() - m0 };
}

(async () => {
  console.log('1 — référence sans compensation');
  const ref = await scenario(undefined, false);
  console.log(`  loyer brut ${f(ref.full)} : rent_revenue ${f(ref.rent)}, abs_interest_expense ${f(ref.interest)} ; trésorerie Co1 ${f(ref.dCash.c1)}, Co2 ${f(ref.dCash.c2)}`);
  ok(near(ref.rent, ref.full) && near(ref.interest, -0.6 * ref.full), 'sans compensation : loyer brut et intérêt d’ABS (60 %) enregistrés');

  console.log('2 — avec compensation Co0 ⇄ Co1 (scénario de l’audit)');
  const v = await scenario(undefined, true);
  const ceded = 0.6 * v.full, net = v.full - ceded;
  console.log(`  rent_revenue ${f(v.rent)}, abs_interest_expense ${f(v.interest)}, abs_income Co2 ${f(v.absIncome)} ; registre ${f(v.balance)} ; trésorerie Co0 ${f(v.dCash.c0)}, Co1 ${f(v.dCash.c1)}, Co2 ${f(v.dCash.c2)}`);
  ok(near(v.interest, -ceded), `charge d’intérêt d’ABS enregistrée comme sans compensation (${f(v.interest)})`);
  ok(near(v.rent, ceded), `loyer réglé en argent enregistré maintenant (${f(v.rent)} = part versée aux porteurs)`);
  ok(near(v.absIncome, -v.interest), 'intérêt d’ABS de l’émettrice = revenu ABS du porteur (section 304)');
  ok(near(Math.abs(v.balance), net), `la part nette (${f(net)}) est au registre de compensation, constatée au règlement de fin d’année`);
  ok(near(v.rent + Math.abs(v.balance), ref.rent) && near(v.interest, ref.interest), 'sur l’ensemble (loyer + registre), mêmes montants que sans compensation, sans double compte');
  ok(near(v.dCash.c1, 0) && near(v.dCash.c2, ceded) && near(v.dCash.c0, -ceded - v.bankPart), `trésorerie : Co0 paie la part cédée (+ ${f(v.bankPart)} à la banque pour sa part de 10 %), Co2 la reçoit, Co1 rien`);
  ok(near(-v.visitorExpense, v.rent + v.bankPart), 'symétrie : charge de loyer du visiteur = loyer enregistré par l’émettrice + part de la banque');
  ok(near(v.dMasse, 0), 'monnaie conservée');
  // Règlement de fin d'année : Co1 constate le reste en rent_compensation_revenue.
  const led0 = v.eng.run(`state.finLedger.length`);
  v.eng.run(`state.rentCompensations.forEach(c=>settleRentCompensation(c))`);
  const comp = v.eng.json(`state.finLedger.slice(${led0}).filter(e=>e.category==='rent_compensation_revenue' && e.companyId===${JSON.stringify(v.ids.c1)}).reduce((s,e)=>s+e.amount,0)`);
  ok(near(comp, net * 1.05), `règlement : Co1 constate ${f(comp)} (net ${f(net)} + 5 % d’intérêt)`);

  console.log('3 — contre-épreuve : ancien traitement réintroduit');
  {
    const w = await scenario({ transform: (src) => src.replace(
      "const settledNow = c._precomputedByAbs ? Math.max(0, c.amount - Math.max(0, net)) : r.totalWithheld;", "const settledNow = r.totalWithheld;") }, true);
    console.log(`  code d'avant : rent_revenue ${f(w.rent)}, abs_interest_expense ${f(w.interest)} ; abs_income Co2 ${f(w.absIncome)}`);
    ok(near(w.rent, 0) && near(w.interest, 0) && w.absIncome > 0, 'sans le correctif : l’émettrice n’enregistre rien alors que le porteur reçoit son revenu');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
