// Test — section 310 (lot 3 de l'audit du 2026-10-19 : REIT et lot commercial) : mises REIT.
// Bogue 28 : la limite « mise ≤ encaisse » n'était vérifiée que mise par mise ; une entreprise misait toute son
//            encaisse sur chacun des 4 REIT, les gagnait tous et finissait très en négatif. Correctif : le TOTAL de
//            ce qu'une entreprise paierait si elle gagnait toutes ses mises ne dépasse pas son encaisse (au dépôt),
//            et chaque mise est revérifiée à la résolution (une mise devenue non couverte est écartée).
// Bogue 29 : le détenteur unique misait sur son propre REIT sans rien payer et le lot était ensuite évalué au prix
//            de cette mise. Correctif : la valeur du lot (valuationPrice) garde l'ancienne valeur pour la part que le
//            gagnant détenait déjà et ne prend le prix de la mise que pour la part réellement payée.
//
// Chaque correctif a sa contre-épreuve : loadEngine({transform}) réintroduit l'ancien code, le même scénario échoue.
// Lancer depuis la racine du dépôt :  node tests/section310-reit-mises.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// Partie à quatre (Co Alice = C0 … Co Dan = C3), REIT activés et ouverts, fenêtre de mise (lancer 1 de l'année).
async function setup(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.C0 = state.companies[0]; globalThis.C1 = state.companies[1]; globalThis.C2 = state.companies[2]; globalThis.C3 = state.companies[3];
           state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; });
           state.gameClock.rollCount = 1;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.E = id => state.etfs.find(e=>e.id===id);`);
  const E = { eng, alerts, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
  return E;
}
const resolve = E => E.run(`attemptActionWithRetry(async ()=>{ maybeResolveEtfAuctions(); return {ok:true}; }, {label:'test'})`);

// Ancien code (contre-épreuves).
const OLD_BID_CHECK = s => s.replace(/  \/\/ Section 310 — bogue 28 : plafond sur le TOTAL[\s\S]*?\/\/ fin bogue 28 \(dépôt\)\n/, '');
const OLD_RESOLVE_CHECK = s => s.replace(/  \/\/ Section 310 — bogue 28 : chaque mise est revérifiée[\s\S]*?\/\/ fin bogue 28 \(résolution\)\n/, '  const bids = (etf.bids||[]).filter(b=>b.price>=ETF_MIN_BID);\n');
const OLD_VALUATION = s => s.replace('etf.valuationPrice = valuationPrice; // Section 310 — bogue 29', 'etf.valuationPrice = winner.price;');

(async () => {
  await scenario('A. Bogue 28 — Co Alice (20 M$) mise 20 M$ sur chacun des 4 REIT', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => OLD_RESOLVE_CHECK(OLD_BID_CHECK(s)) } : {});
      E.run(`C0.cash = 20; as(C0);`);
      const T0 = E.cash();
      for(const id of ['rue1', 'rue2', 'rue3', 'rue4']) await E.run(`submitEtfBid(C0.id, '${id}', 20)`);
      const bids = E.json(`state.etfs.map(e=>(e.bids||[]).length)`);
      await resolve(E);
      const cash = E.run('C0.cash');
      const won = E.json(`state.etfs.filter(e=>(C0.etfHoldings[e.id]||0)>=100).map(e=>e.id)`);
      console.log(`    [${variant}] mises enregistrées par REIT : ${bids.join(', ')} ; REIT gagnés : ${won.join(', ') || 'aucun'} ; encaisse finale de Co Alice : ${cash.toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(bids.join(',') === '1,0,0,0', 'seule la 1re mise (20 M$) est enregistrée : les trois suivantes porteraient le total à 40, 60, 80 M$');
        ok(E.alerts.length === 3 && E.alerts.every(a => /total/.test(a) && /20[,.]00/.test(a)), `refus clair : « ${E.alerts[0]} »`);
        ok(won.join(',') === 'rue1' && near(cash, 0), 'Co Alice gagne la Première rue et finit à 0 M$ (avant : 4 REIT et −60 M$)');
        ok(near(E.cash(), T0), 'monnaie conservée (le prix va à la banque)');
      } else {
        ok(bids.join(',') === '1,1,1,1' && near(cash, -60), 'contre-épreuve : sans le plafond sur le total, 4 REIT gagnés et −60 M$');
      }
    }
  });

  await scenario('B. Bogue 28 — mises déposées ensemble (fenêtre de fin de tour) : un seul envoi, total vérifié', async () => {
    const E = await setup();
    E.run(`C0.cash = 20; as(C0);`);
    let r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:8}, {etfId:'rue2', price:7}, {etfId:'rue3', price:5}])`);
    ok(r.ok && E.json(`['rue1','rue2','rue3','rue4'].map(id=>((E(id).bids||[])[0]||{}).price||0)`).join(',') === '8,7,5,0', 'mises 8 + 7 + 5 = 20 M$ = encaisse : acceptées');
    r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:8}, {etfId:'rue2', price:7}, {etfId:'rue3', price:5}, {etfId:'rue4', price:1}])`);
    ok(!r.ok && /21[,.]00/.test(r.error), `21 M$ au total : tout l'envoi est refusé (« ${r.error} »)`);
    ok(E.json(`((E('rue4').bids||[])[0]||{}).price||0`) === 0 && E.json(`E('rue1').bids[0].price`) === 8, 'les mises précédentes restent inchangées');
    // Rééquilibrer : baisser la Première rue à 2 et monter la Quatrième à 6 (total 20) est accepté d'un bloc, quel que
    // soit l'ordre des REIT (avant, l'envoi mise par mise refusait la hausse tant que l'ancienne mise comptait).
    r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue4', price:6}, {etfId:'rue1', price:2}, {etfId:'rue2', price:7}, {etfId:'rue3', price:5}])`);
    ok(r.ok && E.json(`['rue1','rue2','rue3','rue4'].map(id=>((E(id).bids||[])[0]||{}).price||0)`).join(',') === '2,7,5,6', 'rééquilibrage 2 + 7 + 5 + 6 = 20 M$ accepté d’un bloc');
    // Mise sur son propre REIT : seule la part non détenue compte (Co Alice détient 50 % de la Deuxième rue).
    E.run(`C0.etfHoldings.rue2 = 50; C1.etfHoldings.rue2 = 50;`);
    r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:2}, {etfId:'rue2', price:14}, {etfId:'rue3', price:5}, {etfId:'rue4', price:6}])`);
    ok(r.ok, 'Co Alice détient 50 % de la Deuxième rue : sa mise de 14 ne l’engage que pour 7 (2 + 7 + 5 + 6 = 20) — acceptée');
    ok(E.run(`etfCommittedBidTotal(C0.id)`) === 20, 'engagement total calculé : 20 M$');
    const T0 = E.cash();
    // Mise par mise (ancien bouton) : même plafond.
    await E.run(`submitEtfBid(C0.id, 'rue4', 7)`);
    ok(E.json(`E('rue4').bids[0].price`) === 6 && /total/.test(E.alerts.pop()), 'submitEtfBid seul : porter la Quatrième rue à 7 (total 21) est refusé');
    ok(near(E.cash(), T0), 'aucune monnaie ne bouge au dépôt');
  });

  await scenario('C. Bogue 28 — revérifié à la résolution : la mise devenue non couverte est écartée', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD_RESOLVE_CHECK } : {});
      E.run(`C0.cash = 20; C1.cash = 20;`);
      E.run('as(C0)'); await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:12}, {etfId:'rue2', price:8}])`);
      E.run('as(C1)'); await E.run(`submitEtfBids(C1.id, [{etfId:'rue2', price:5}])`);
      // Entre le dépôt et la résolution, Co Alice dépense 5 M$ (achat de terrain, prime…) : elle n'a plus que 15.
      E.run(`C0.cash -= 5; state.bank.cash += 5;`);
      const T0 = E.cash();
      await resolve(E);
      const c0 = E.run('C0.cash'), c1 = E.run('C1.cash');
      const rue2 = E.json(`state.companies.filter(c=>(c.etfHoldings.rue2||0)>=100).map(c=>c.name)`);
      console.log(`    [${variant}] Deuxième rue gagnée par ${rue2.join(', ')} ; Co Alice ${c0.toFixed(2)} M$, Co Bob ${c1.toFixed(2)} M$`);
      if(variant === 'corrigé'){
        ok(E.run(`C0.etfHoldings.rue1`) === 100 && near(c0, 3), 'Première rue : Co Alice paie 12 M$ (15 → 3 M$)');
        ok(rue2.join() === 'Co Bob' && near(c1, 15), 'Deuxième rue : la mise de 8 M$ de Co Alice (encaisse restante 3 M$) est écartée, Co Bob gagne à 5 M$');
        ok(E.json(`state.log.some(l=>l.text.includes('La mise de Co Alice sur le REIT (Deuxième rue)') && l.text.includes('est écartée'))`), 'le journal explique la mise écartée');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(rue2.join() === 'Co Alice' && near(c0, -5), 'contre-épreuve : sans la revérification, Co Alice gagne aussi la Deuxième rue et finit à −5 M$');
      }
    }
  });

  await scenario('D. Bogue 29 — le détenteur unique mise 20 sur son propre REIT (dernier prix 2)', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD_VALUATION } : {});
      E.run(`C0.cash = 20; C0.etfHoldings.rue1 = 100; E('rue1').lastAuctionPrice = 2; E('rue1').valuationPrice = 2; E('rue1').lastAuctionYear = 0;`);
      const v0 = E.run('companyEtfValue(C0)'), cv0 = E.run('companyValue(C0)');
      E.run('as(C0)'); await E.run(`submitEtfBid(C0.id, 'rue1', 20)`);
      const T0 = E.cash();
      await resolve(E);
      const v1 = E.run('companyEtfValue(C0)'), cv1 = E.run('companyValue(C0)');
      console.log(`    [${variant}] valeur du REIT pour Co Alice : ${v0.toFixed(2)} → ${v1.toFixed(2)} M$ ; valeur de l'entreprise ${cv0.toFixed(2)} → ${cv1.toFixed(2)} M$ ; encaisse ${E.run('C0.cash').toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(near(E.run('C0.cash'), 20), 'Co Alice ne paie rien (elle détenait déjà 100 %) — inchangé, voulu');
        ok(near(v1, 2) && near(cv1, cv0), 'la valeur du REIT reste 2 M$ : une mise non payée ne gonfle plus la valeur de l’entreprise (avant : 20)');
        ok(E.run(`E('rue1').lastAuctionPrice`) === 20, 'la mise gagnante reste affichée comme dernier prix d’enchère (20)');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(near(v1, 20) && near(cv1 - cv0, 18), 'contre-épreuve : avec l’ancienne évaluation, la valeur de l’entreprise gagne 18 M$ sans rien payer');
      }
    }
  });

  await scenario('E. Bogue 29 — détenteur à 60 % : la part rachetée à Co Bob est valorisée au plus à l’ancienne valeur', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD_VALUATION } : {});
      E.run(`C0.cash = 20; C1.cash = 0; C0.etfHoldings.rue1 = 60; C1.etfHoldings.rue1 = 40; E('rue1').lastAuctionPrice = 2; E('rue1').valuationPrice = 2;`);
      const cv0 = E.run('companyValue(C0)');
      E.run('as(C0)'); await E.run(`submitEtfBid(C0.id, 'rue1', 20)`);
      const T0 = E.cash();
      await resolve(E);
      const cv1 = E.run('companyValue(C0)');
      console.log(`    [${variant}] Co Alice paie ${(20 - E.run('C0.cash')).toFixed(2)} M$ à Co Bob ; valeur du lot ${E.run(`etfLotValuationPrice(E('rue1'))`)} ; valeur de Co Alice ${cv0.toFixed(2)} → ${cv1.toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(near(E.run('C0.cash'), 12) && near(E.run('C1.cash'), 8), 'Co Alice rachète les 40 % de Co Bob au prix de la mise : 8 M$');
        // Retouche de la revue (complice) : la part rachetée à une AUTRE entreprise par un détenteur est valorisée au
        // plus petit de la mise (20) et de l'ancienne valeur (2) — choix prudent, à valider par Julien.
        ok(near(E.run(`etfLotValuationPrice(E('rue1'))`), 2), 'lot valorisé 2 × 60 % + min(20 ; 2) × 40 % = 2 M$');
        ok(near(cv1 - cv0, -7.2), 'valeur de Co Alice : −8 M$ d’encaisse, +0,8 M$ de REIT (−7,2) : jamais de hausse au-delà du payé');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(near(cv1 - cv0, 10.8), 'contre-épreuve : l’ancienne évaluation gonfle Co Alice de 10,8 M$ pour 8 M$ payés');
      }
    }
  });

  await scenario('F. Bogue 29 — premier achat (aucun détenteur) : la valeur est le prix payé ; migration', async () => {
    const E = await setup();
    E.run(`C0.cash = 20;`);
    E.run('as(C0)'); await E.run(`submitEtfBid(C0.id, 'rue3', 6)`);
    await resolve(E);
    ok(near(E.run(`etfLotValuationPrice(E('rue3'))`), 6) && near(E.run('companyEtfValue(C0)'), 6), 'aucun détenteur : lot valorisé au prix payé, 6 M$');
    E.run(`state.etfs.forEach(e=>{ delete e.valuationPrice; }); E('rue2').lastAuctionPrice = 3; migrateState(state);`);
    ok(E.run(`E('rue2').valuationPrice`) === 3 && E.run(`E('rue3').valuationPrice`) === 6, 'partie en cours : migrateState reprend le dernier prix d’enchère comme valeur du lot');
  });

  await scenario('G. Bogue 29, retouche de la revue — complice : revendre 99 % à Co Bob pour 19,8 puis remiser 20', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace("const fromCompaniesValue = winnerPriorPct>1e-9 ? Math.min(winner.price, prevValuation) : winner.price;", 'const fromCompaniesValue = winner.price;') } : {});
      E.run(`C0.cash = 20; C1.cash = 20; C0.etfHoldings.rue1 = 100; E('rue1').lastAuctionPrice = 2; E('rue1').valuationPrice = 2; E('rue1').lastAuctionYear = 0;`);
      const val = co => E.run(`${co}.cash + companyEtfValue(${co})`);
      const a0 = val('C0'), b0 = val('C1');
      E.run('as(C0)'); await E.run(`sellEtfUnits('rue1', C0.id, C1.id, 99, 19.8)`);
      E.run('as(C1)'); await E.run(`acceptAssetSaleOffer(state.assetSaleOffers[0].id)`);
      E.run('as(C0)'); await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:20}])`);
      const T0 = E.cash();
      await resolve(E);
      const a1 = val('C0'), b1 = val('C1');
      console.log(`    [${variant}] encaisses ${E.run('C0.cash').toFixed(2)} / ${E.run('C1.cash').toFixed(2)} ; lot valorisé ${E.run(`etfLotValuationPrice(E('rue1'))`).toFixed(2)} ; valeur Co Alice ${a0.toFixed(2)} → ${a1.toFixed(2)}, Co Bob ${b0.toFixed(2)} → ${b1.toFixed(2)}`);
      ok(near(E.run('C0.cash'), 20) && near(E.run('C1.cash'), 20) && E.run('C0.etfHoldings.rue1') === 100, `[${variant}] aller-retour : encaisses revenues à 20 / 20, Co Alice de nouveau à 100 %`);
      if(variant === 'corrigé'){
        ok(near(E.run(`etfLotValuationPrice(E('rue1'))`), 2) && near(a1, a0), 'lot toujours valorisé 2 : la valeur de Co Alice reste 22 (avant : 39,82)');
        ok(near(E.cash(), T0), 'monnaie conservée');
      } else {
        ok(near(a1, 39.82), 'contre-épreuve : sans la retouche, le lot vaut 19,82 et Co Alice passe de 22 à 39,82');
      }
    }
  });

  await scenario('H. Retouches de la revue — seul le CEO mise ; une mise de 0 est toujours permise', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: s => s.replace("  const notCeo = offerResponderRefusal(companyId, 'cette entreprise', 'miser pour elle'); // Section 310 — retouche de la revue : seul le CEO mise\n  if(notCeo) return notCeo;\n", '') } : {});
      E.run(`C0.cash = 20; as(C1);`);
      const r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:20}])`);
      const n = E.run(`(E('rue1').bids||[]).length`);
      if(variant === 'corrigé'){
        ok(!r.ok && /Seul le CEO de Co Alice/.test(r.error) && n === 0, `le CEO de Co Bob ne peut pas miser pour Co Alice (« ${r.error} »)`);
      } else {
        ok(r.ok && n === 1, 'contre-épreuve : sans le contrôle, le CEO de Co Bob engage 20 M$ de Co Alice');
      }
    }
    const E = await setup();
    E.run(`C0.cash = 20; as(C0);`);
    await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:12}, {etfId:'rue2', price:8}])`);
    E.run('C0.cash = -1;'); // l'encaisse devient négative
    let r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:0}, {etfId:'rue2', price:8}])`);
    ok(r.ok && E.run(`(E('rue1').bids||[]).length`) === 0, 'encaisse négative : retirer sa mise (0) est accepté, même si une autre mise reste au-dessus de l’encaisse');
    r = await E.run(`submitEtfBids(C0.id, [{etfId:'rue1', price:1}, {etfId:'rue2', price:8}])`);
    ok(!r.ok, 'mais une hausse reste refusée');
  });

  if(failures.length){ console.log(`\nÉCHEC : section 310 (mises REIT) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 310 (mises REIT) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
