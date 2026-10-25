// Test — Section 311, point ajouté par l'orchestrateur (signalé par le lot 5) : refuseRentSwapOffer (et son équivalent
// refuseRentCompensationOffer, ainsi que les deux « accepter ») ne vérifiaient pas qui répondait. N'importe quel joueur
// pouvait effacer l'offre faite à une autre entreprise, ou la signer à sa place. Correctif : seul le CEO de l'entreprise
// destinataire accepte ou refuse (contrôle dans l'applyFn) ; l'auteur peut retirer sa propre offre.
// Lancer depuis la racine du dépôt :  node tests/section311-offres.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

async function setup(opts){
  const eng = loadEngine(opts);
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['A', 'B', 'C'], ['garp', 'garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2];
           state.settings.features.rentSwap = true; state.settings.features.rentCompensation = true;
           A.cash += 50; B.cash += 50;
           state.rentSwapOffers = [{id:'sw', fromCompanyId:A.id, propA:null, generalA:true, capA:null, toCompanyId:B.id, propB:null, generalB:true, capB:null, years:2, budgetMode:false, budgetCapA:null, budgetCapB:null}];
           state.rentCompensationOffers = [{id:'co', fromCompanyId:A.id, toCompanyId:B.id, interestRate:0.05}];
           globalThis.as = co => { myPlayerId = co.ceoId; };`);
  await eng.run('saveGame({silent:true})'); // offres enregistrées, comme si Co A les avait proposées
  const offers = () => eng.json(`({sw: state.rentSwapOffers.map(o=>o.id), co: state.rentCompensationOffers.map(o=>o.id), swaps: state.rentSwaps.length, comps: state.rentCompensations.length})`);
  return { eng, alerts, offers };
}

(async () => {
  console.log('1 — un tiers (CEO de Co C) ne peut ni refuser ni accepter');
  {
    const { eng, alerts, offers } = await setup();
    const { run } = eng;
    run(`as(C)`);
    await run(`refuseRentSwapOffer('sw')`); await run(`refuseRentCompensationOffer('co')`);
    let o = offers();
    ok(o.sw.length === 1 && o.co.length === 1, 'refus par un tiers : les deux offres restent');
    ok(alerts.length === 2 && alerts.every(a => /Seul le CEO de Co B/.test(a)), `message clair : « ${alerts[0]} »`);
    await run(`acceptRentSwapOffer('sw')`); await run(`acceptRentCompensationOffer('co')`);
    o = offers();
    ok(o.swaps === 0 && o.comps === 0 && o.sw.length === 1 && o.co.length === 1, 'acceptation par un tiers : rien n’est signé, les offres restent');
    const saved = JSON.parse(eng.mem.get('game:' + run('gameCode')));
    ok(saved.rentSwapOffers.length === 1 && saved.rentCompensationOffers.length === 1, 'les offres sont toujours enregistrées');
  }
  console.log('2 — l’auteur (Co A) ne peut pas refuser à la place du destinataire, mais peut retirer');
  {
    const { eng, offers } = await setup();
    const { run } = eng;
    run(`as(A)`);
    await run(`refuseRentSwapOffer('sw')`); await run(`refuseRentCompensationOffer('co')`);
    ok(offers().sw.length === 1 && offers().co.length === 1, 'refus par l’auteur : refusé');
    await run(`cancelRentSwapOffer('sw')`); await run(`cancelRentCompensationOffer('co')`);
    ok(offers().sw.length === 0 && offers().co.length === 0, 'retrait par l’auteur : les deux offres sont retirées');
  }
  console.log('3 — le CEO destinataire (Co B) refuse ou accepte');
  {
    const { eng, offers } = await setup();
    const { run } = eng;
    run(`as(B)`);
    await run(`refuseRentSwapOffer('sw')`);
    ok(offers().sw.length === 0, 'refus du swap par Co B : offre retirée');
    const m0 = eng.cashTotal();
    await run(`acceptRentCompensationOffer('co')`);
    ok(offers().co.length === 0 && offers().comps === 1, 'acceptation de la compensation par Co B : accord signé');
    ok(near(eng.cashTotal(), m0), 'monnaie conservée (frais de signature versés à la banque)');
  }
  console.log('4 — contre-épreuve : contrôle retiré');
  {
    // Section 309-313 — intégration : le contrôle est mutualisé (offerResponderRefusal) ; la contre-épreuve le retire
    // pour les offres de swap et de compensation.
    const { eng, offers } = await setup({ transform: (src) => src.replace("function rentOfferResponderRefusal(offer){", "function rentOfferResponderRefusal(offer){ return null;") });
    const { run } = eng;
    run(`as(C)`);
    await run(`refuseRentSwapOffer('sw')`); await run(`refuseRentCompensationOffer('co')`);
    ok(offers().sw.length === 0 && offers().co.length === 0, 'sans le correctif : le CEO de Co C efface les offres faites à Co B');
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
