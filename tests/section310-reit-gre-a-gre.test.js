// Test — section 310, décision de Julien (2026-10-25) sur la valeur au bilan d'une part de REIT achetée de gré à gré.
// Revue : en BOUCLE (Co Alice vend 1 % à un complice pour 10 M$, le complice le lui revend 10 M$), la valeur d'achat
// d'un REIT montait sans limite (22 → 352,37 en 40 allers-retours) sans un dollar dépensé.
// Décision de Julien (verbatim) : « Oui : REIT acheté de gré à gré évalué au plus à la part du dernier prix d'enchère
// (option b), et refus des opérations qui portent les options nues au-delà du plafond. Applique, fais tester, puis
// montre-moi avant de pousser. »
// Mécanique : à l'acceptation d'une offre de revente (executeEtfSale), l'acheteur ajoute à son coût le plus petit du
// prix payé et de pct × dernier prix d'enchère / 100 (etfOtcBookValue). Les achats à l'ENCHÈRE restent au prix payé ;
// le vendeur sort toujours son coût au prorata (gain ou perte réalisé) ; la monnaie ne change pas.
// Contre-épreuve : loadEngine({transform}) remet l'ancien code (coût de l'acheteur + prix payé), les scénarios A et B échouent.
// Lancer depuis la racine du dépôt :  node tests/section310-reit-gre-a-gre.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

async function setup(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2];
           state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; });
           state.gameClock.rollCount = 1;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.E = id => state.etfs.find(e=>e.id===id);`);
  return { eng, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
}
// Offre de revente déposée par le CEO du vendeur, acceptée par le CEO de l'acheteur.
async function sale(E, from, to, pct, price){
  E.run(`as(${from})`);
  const r = await E.run(`sellEtfUnits('rue1', ${from}.id, ${to}.id, ${pct}, ${price})`);
  if(!r || !r.ok) return r;
  E.run(`as(${to})`);
  const id = E.run(`state.assetSaleOffers[state.assetSaleOffers.length-1].id`);
  return await E.run(`acceptAssetSaleOffer('${id}')`);
}
const resolve = E => E.run(`attemptActionWithRetry(async ()=>{ maybeResolveEtfAuctions(); return {ok:true}; }, {label:'test'})`);

// Ancien code : l'acheteur de gré à gré ajoutait à son coût le prix payé.
const OLD = s => {
  const a = "  setEtfCost(buyer, etfId, ((buyer.etfHoldings[etfId]||0)>0 ? etfCostOf(buyer, etfId) : 0) + bookValue);";
  if(!s.includes(a)) throw new Error('contre-épreuve : code introuvable');
  return s.replace(a, "  setEtfCost(buyer, etfId, ((buyer.etfHoldings[etfId]||0)>0 ? etfCostOf(buyer, etfId) : 0) + price);");
};

(async () => {
  await scenario('A. Boucle du complice : Co Alice (100 %, coût 2, dernier prix d’enchère 2) vend 1 % à Co Bob pour 10 et le rachète 10, 40 fois', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD } : {});
      E.run(`C0.cash = 20; C1.cash = 10; C0.etfHoldings.rue1 = 100; C0.etfCost = {rue1: 2}; E('rue1').lastAuctionPrice = 2; E('rue1').valuationPrice = 2;`);
      const T0 = E.cash();
      const v = () => E.json('[companyValue(C0), companyEtfValue(C0), companyValue(C1), companyEtfValue(C1)]');
      const v0 = v();
      let refused = null;
      for(let k = 1; k <= 40 && !refused; k++){
        const a = await sale(E, 'C0', 'C1', 1, 10); if(!a || !a.ok){ refused = a; break; }
        const b = await sale(E, 'C1', 'C0', 1, 10); if(!b || !b.ok){ refused = b; break; }
        if(k === 1 && variant === 'corrigé'){
          const v1 = v();
          ok(near(v1[1], 2) && near(v1[0], v0[0]) && near(v1[2], v0[2]), `[corrigé] après 1 aller-retour : REIT de Co Alice toujours à 2 (1,98 restant + 0,02 racheté), valeurs ${v0[0].toFixed(2)} / ${v0[2].toFixed(2)} inchangées`);
        }
      }
      const v40 = v();
      console.log(`    [${variant}] après 40 allers-retours : Co Alice ${v0[0].toFixed(2)} → ${v40[0].toFixed(2)} (REIT ${v0[1].toFixed(2)} → ${v40[1].toFixed(2)}), Co Bob ${v0[2].toFixed(2)} → ${v40[2].toFixed(2)}`);
      ok(!refused && E.run('C0.etfHoldings.rue1') === 100 && near(E.run('C0.cash'), 20) && near(E.run('C1.cash'), 10) && near(E.cash(), T0), `[${variant}] 80 ventes acceptées, Co Alice de nouveau à 100 %, encaisses 20 / 10, monnaie conservée`);
      if(variant === 'corrigé'){
        ok(near(v40[1], 2) && near(v40[0], 22) && near(v40[2], 10) && near(v40[3], 0), 'la boucle ne gonfle plus rien : REIT de Co Alice 2, valeur 22 ; Co Bob 10, sans part');
      } else {
        ok(v40[1] > 300, `contre-épreuve : avec l’ancien code, le REIT de Co Alice monte à ${v40[1].toFixed(2)} (> 300) sans argent dépensé`);
      }
    }
  });

  await scenario('B. Achat honnête de gré à gré : dernier prix d’enchère 10 ; Co Alice (100 %, coût 10) vend à Co Bob', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD } : {});
      E.run(`C0.cash = 0; C1.cash = 20; C0.etfHoldings.rue1 = 100; C0.etfCost = {rue1: 10}; E('rue1').lastAuctionPrice = 10; E('rue1').valuationPrice = 10;`);
      const T0 = E.cash();
      const a0 = E.run('companyValue(C0)'), b0 = E.run('companyValue(C1)');
      let r = await sale(E, 'C0', 'C1', 30, 3);
      ok(r && r.ok && near(E.run('C1.etfCost.rue1'), 3) && near(E.run('C0.etfCost.rue1'), 7) && near(E.run('companyValue(C1)'), b0) && near(E.run('companyValue(C0)'), a0), `[${variant}] 30 % pour 3 (= 30 % × 10, prix d’enchère) : Co Bob porte 3 (le prix payé), Co Alice garde 7 ; aucune valeur ne bouge`);
      r = await sale(E, 'C0', 'C1', 20, 1.5);
      ok(r && r.ok && near(E.run('C1.etfCost.rue1'), 4.5) && near(E.run('C0.etfCost.rue1'), 5) && near(E.run('companyValue(C0)') - a0, -0.5), `[${variant}] 20 % pour 1,5 (sous les 2 de l’enchère) : Co Bob porte 1,5 de plus (4,5), Co Alice sort 2 de coût et réalise une perte de 0,5`);
      // Achat au-dessus de la part du prix d'enchère : 10 % pour 2 (part d'enchère 1).
      E.run(`as(C0)`); await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 10, 2)`);
      const cond = E.json(`assetSaleOfferConditions(state.assetSaleOffers[0].id)`);
      if(variant === 'corrigé') ok(near(cond.etfBookValue, 1) && near(cond.total, 2), 'la fenêtre d’acceptation annonce la valeur au bilan : 1 pour 2 payés');
      E.run(`as(C1)`); r = await E.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
      const bCost = E.run('C1.etfCost.rue1');
      console.log(`    [${variant}] 10 % payés 2 : coût de Co Bob 4,5 → ${bCost.toFixed(2)} ; monnaie ${near(E.cash(), T0) ? 'conservée' : 'NON conservée'}`);
      ok(r && r.ok && near(E.run('C1.cash'), 20 - 3 - 1.5 - 2) && near(E.cash(), T0), `[${variant}] Co Bob paie bien 2 (encaisse 13,5) ; monnaie conservée`);
      if(variant === 'corrigé'){
        ok(near(bCost, 5.5) && near(E.run('companyValue(C1)') - b0, -1), 'au-dessus de la part d’enchère : Co Bob ne porte que 1 (10 % × 10) ; il a payé 1 de trop, sa valeur baisse de 1');
        ok(E.run('state.log.some(l=>/portées au bilan de Co Bob pour/.test(l.text))'), 'le journal explique la valeur retenue');
      } else {
        ok(near(bCost, 6.5), 'contre-épreuve : avec l’ancien code, Co Bob porte les 2 payés (6,5)');
      }
    }
  });

  await scenario('C. Rachat cher à l’ENCHÈRE (compté au prix payé), puis revente de gré à gré avec perte', async () => {
    const E = await setup();
    E.run(`C0.cash = 20; C1.cash = 0; C2.cash = 10; C0.etfHoldings.rue1 = 60; C1.etfHoldings.rue1 = 40; C0.etfCost = {rue1: 1.2}; C1.etfCost = {rue1: 0.8}; E('rue1').lastAuctionPrice = 2; E('rue1').valuationPrice = 2;`);
    const T0 = E.cash();
    E.run('as(C0)'); await E.run(`submitEtfBid(C0.id, 'rue1', 20)`);
    await resolve(E);
    ok(near(E.run('C0.cash'), 12) && near(E.run('C0.etfCost.rue1'), 9.2) && near(E.run(`E('rue1').lastAuctionPrice`), 20), 'enchère à 20 : Co Alice paie 8 à Co Bob pour ses 40 % et les porte à 8 (prix payé, pas plafonné) : coût 1,2 + 8 = 9,2');
    const a1 = E.run('companyValue(C0)'), c1 = E.run('companyValue(C2)');
    const r = await sale(E, 'C0', 'C2', 50, 3);
    ok(r && r.ok && near(E.run('C0.etfCost.rue1'), 4.6) && near(E.run('companyValue(C0)') - a1, -1.6), 'revente de 50 % à Co Carl pour 3 : coût sorti 4,6, perte réalisée 1,6');
    ok(near(E.run('C2.etfCost.rue1'), 3) && near(E.run('companyValue(C2)'), c1) && near(E.cash(), T0), 'Co Carl porte 3 (sous les 10 de sa part d’enchère : prix payé) ; monnaie conservée');
  });

  await scenario('D. Parts détenues sans aucune enchère passée (ancienne partie) : valeur au bilan 0 pour l’acheteur de gré à gré', async () => {
    const E = await setup();
    E.run(`C0.cash = 0; C1.cash = 10; C0.etfHoldings.rue1 = 100; C0.etfCost = {rue1: 0}; E('rue1').lastAuctionPrice = 0;`);
    const T0 = E.cash();
    const r = await sale(E, 'C0', 'C1', 50, 4);
    ok(r && r.ok && E.run('C1.etfCost.rue1') === 0 && near(E.run('C1.cash'), 6) && near(E.cash(), T0), 'dernier prix d’enchère 0 : Co Bob paie 4, porte 0 (lecture littérale de la décision) ; monnaie conservée');
  });

  if(failures.length){ console.log(`\nÉCHEC : section 310 (REIT de gré à gré) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 310 (REIT de gré à gré) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
