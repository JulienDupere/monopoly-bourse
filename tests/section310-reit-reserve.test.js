// Test — section 310 (lot 3 de l'audit du 2026-10-19) : bogue 54 et décision de Julien sur la réserve REIT.
// Demande verbatim : « 54 : le visiteur ne paie que la part VENDUE du REIT (10 % de réserve, 50 % vendu = 5 % du
// loyer), et les détenteurs se partagent cette part ».
// Avant : la part collectée valait min(réserve, parts détenues) — 10 % de réserve et 50 % des parts vendues faisaient
// payer les 10 % entiers (unités mélangées : % du terrain contre % du REIT). Désormais : réserve × parts vendues / 100.
// La part non vendue n'est pas payée (REIT ouvert sans détenteur : rien, comme avant ; le message d'ouverture ne
// prétend plus que la banque collecte). Toutes les voies du loyer passent par etfReservedCollectedPct : terrain seul,
// lot regroupé, terrain sous ABS, accord de compensation, pion neutre (payé par la banque), estimation payableRent ; monnaie conservée
// (banque + entreprises + joueurs + fonds REIT).
// Lancer depuis la racine du dépôt :  node tests/section310-reit-reserve.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// Partie à quatre ; REIT activés et ouverts. Vert 1, 2, 3 (REIT Quatrième rue) : Co Bob 90 %, réserve de la banque
// 10 %, 3 maisons (loyer de Vert 1 : 9 M$).
async function setup(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  await eng.newGame(['Alice', 'Bob', 'Carl', 'Dan'], ['garp', 'garp', 'garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1]; globalThis.C = state.companies[2]; globalThis.D = state.companies[3];
           state.settings.features.etf = true; state.settings.features.loan = false; state.rentCompensations = [];
           state.etfs.forEach(e=>{ e.opened = true; });
           globalThis.R4 = state.etfs.find(e=>e.id==='rue4');
           globalThis.V = state.properties.filter(p=>p.group==='VERT');
           V.forEach(p=>{ p.owners = [{companyId:B.id, share:90}]; p.etfReservedPct = 10; p.houses = 3; p.mortgages = []; });
           globalThis.V1 = V[0];
           A.cash = 50; B.cash = 50; C.cash = 50; D.cash = 50;
           globalThis.as = co => { myPlayerId = co.ceoId; };
           globalThis.act = fn => attemptActionWithRetry(fn, {label:'test'});
           globalThis.masse = () => state.bank.cash + state.companies.reduce((s,c)=>s+c.cash,0) + state.players.reduce((s,p)=>s+p.cash,0) + state.etfs.reduce((s,e)=>s+e.fundCash,0);`);
  const E = { eng, alerts, run: c => eng.run(c), json: c => eng.json(c) };
  return E;
}
// Co Alice tombe sur Vert 1 : ce qu'elle paie, ce que reçoit le fonds du REIT.
async function visit(E, holdings){
  E.run(`state.companies.forEach(c=>{ c.etfHoldings.rue4 = 0; }); ${holdings}; R4.fundCash = 0;`);
  const a0 = E.run('A.cash'), m0 = E.run('masse()');
  await E.run(`act(async ()=>{ await settlePropertyRent(V1, A.id, 7, {skipSave:true}); return {ok:true}; })`);
  return { paid: a0 - E.run('A.cash'), fund: E.run('R4.fundCash'), dMasse: E.run('masse()') - m0 };
}
const OLD_FORMULA = s => s.replace(/  \/\/ Section 310 — décision \(bogue 54\)[\s\S]*?return reservedPct \* Math\.max\(0, Math\.min\(100, etfTotalHeldPct\(etf\)\)\) \/ 100;\n/, '  return Math.max(0, Math.min(reservedPct, etfTotalHeldPct(etf)));\n');

(async () => {
  await scenario('A. Terrain seul — Vert 1 (loyer 9), réserve 10 %, parts du REIT vendues : 0 %, 50 %, 100 %, 5 %', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD_FORMULA } : {});
      ok(near(E.run('colorRentAt(V1, 3)'), 9), `[${variant}] loyer de Vert 1 avec 3 maisons : 9 M$`);
      const r0 = await visit(E, '');
      const r50 = await visit(E, 'C.etfHoldings.rue4 = 50');
      const r100 = await visit(E, 'C.etfHoldings.rue4 = 100');
      const r5 = await visit(E, 'C.etfHoldings.rue4 = 5');
      const fmt = r => `paie ${r.paid.toFixed(3)} dont ${r.fund.toFixed(3)} au fonds`;
      console.log(`    [${variant}] 0 % vendu : ${fmt(r0)} ; 50 % : ${fmt(r50)} ; 100 % : ${fmt(r100)} ; 5 % : ${fmt(r5)}`);
      if(variant === 'corrigé'){
        ok(near(r0.paid, 8.1) && near(r0.fund, 0), 'aucune part vendue : Co Alice paie les 90 % de Co Bob (8,1), rien pour la réserve');
        ok(near(r50.paid, 8.55) && near(r50.fund, 0.45), '50 % vendus : 8,1 + 5 % de 9 = 8,55, dont 0,45 au fonds (avant : 9 et 0,9)');
        ok(near(r100.paid, 9) && near(r100.fund, 0.9), '100 % vendus : réserve entière, 9 dont 0,9 au fonds');
        ok(near(r5.paid, 8.145) && near(r5.fund, 0.045), '5 % vendus : 0,5 % du loyer, 0,045 au fonds (avant : 5 % du loyer, 0,45)');
        ok([r0, r50, r100, r5].every(r => near(r.dMasse, 0)), 'monnaie conservée à chaque passage (fonds REIT compris)');
      } else {
        ok(near(r50.paid, 9) && near(r50.fund, 0.9), 'contre-épreuve : avec min(réserve, parts vendues), 50 % vendus font payer la réserve entière');
      }
    }
  });

  await scenario('B. Les détenteurs se partagent la part payée (dividende REIT de fin d’année)', async () => {
    const E = await setup();
    const r = await visit(E, 'C.etfHoldings.rue4 = 30; D.etfHoldings.rue4 = 20');
    ok(near(r.paid, 8.55) && near(r.fund, 0.45), '50 % vendus (Co Carl 30 %, Co Dan 20 %) : 0,45 au fonds');
    const c0 = E.run('C.cash'), d0 = E.run('D.cash'), m0 = E.run('masse()');
    E.run('processEtfLap()');
    const dc = E.run('C.cash') - c0, dd = E.run('D.cash') - d0;
    console.log(`    dividende : Co Carl +${dc.toFixed(3)}, Co Dan +${dd.toFixed(3)}, fonds restant ${E.run('R4.fundCash').toFixed(3)}`);
    ok(near(dc, 0.27) && near(dd, 0.18) && near(E.run('R4.fundCash'), 0), 'Co Carl reçoit 0,27 (30/50) et Co Dan 0,18 (20/50) : toute la part payée, rien ne reste au fonds');
    ok(near(E.run('masse()'), m0), 'monnaie conservée');
  });

  await scenario('C. Autres voies du loyer : estimation, pion neutre, terrain sous ABS, accord de compensation, lot regroupé', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: OLD_FORMULA } : {});
      E.run('C.etfHoldings.rue4 = 50; R4.fundCash = 0;');
      const est = E.run('payableRent(V1, A.id)');
      // Pion neutre : la banque paie le loyer.
      E.run(`state.neutralPawns = [{id:'pw1', name:'Pion 1', position:V1.pos, inJail:false, jailTurnsLeft:0}];`);
      let m0 = E.run('masse()'), b0 = E.run('state.bank.cash');
      await E.run(`act(async ()=>{ await settleNeutralPawnRent(V1, 'pw1', 7, {skipSave:true}); return {ok:true}; })`);
      const pawnPaid = b0 - E.run('state.bank.cash'), pawnFund = E.run('R4.fundCash'), pawnMasse = E.run('masse()') - m0;
      // Terrain sous ABS (60 % de la part de Co Bob cédés à Co Dan, porteur senior).
      E.run(`R4.fundCash = 0; state.revenueSwaps = [{id:'abs1', sellerId:B.id, propertyIds:[V1.id], cededPctOfShare:0.6, years:5, yearsRemaining:5,
              pricing:{termRolls:30, meanRent:10, stdRent:2, seniorCapacity:80}, seniorPremiumPct:0.1, seniorRaised:50, juniorRaised:0,
              seniorCapTotal:1000, seniorPaidSoFar:0, seniorHolders:[{holderType:'company', holderId:D.id, amount:50, receivedSoFar:0}], juniorHolders:[]}];`);
      const rAbs = await visit(E, 'C.etfHoldings.rue4 = 50');
      E.run('state.revenueSwaps = [];');
      // Accord de compensation Co Alice / Co Bob : la part de Co Bob va au registre, la réserve est payée en argent.
      E.run(`state.settings.features.rentCompensation = true; state.rentCompensations = [{id:'rc', companyA:A.id, companyB:B.id, interestRate:0.05, balance:0, createdAt:''}];`);
      const rComp = await visit(E, 'C.etfHoldings.rue4 = 50');
      const compBalance = E.run('state.rentCompensations[0].balance');
      E.run('state.rentCompensations = [];');
      // Lot Vert regroupé.
      E.run('as(A)'); await E.run(`mergeGroup('VERT')`);
      const merged = E.run('!!V1.groupMergeId');
      const rLot = await visit(E, 'C.etfHoldings.rue4 = 50');
      console.log(`    [${variant}] estimation ${est.toFixed(3)} ; pion neutre ${pawnPaid.toFixed(3)} (fonds ${pawnFund.toFixed(3)}) ; ABS ${rAbs.paid.toFixed(3)} (fonds ${rAbs.fund.toFixed(3)}) ; lot regroupé (${merged}) ${rLot.paid.toFixed(3)} (fonds ${rLot.fund.toFixed(3)})`);
      if(variant === 'corrigé'){
        ok(near(est, 8.55), 'estimation payableRent : 8,55');
        ok(near(pawnPaid, 8.55) && near(pawnFund, 0.45) && near(pawnMasse, 0), 'pion neutre : la banque paie 8,55 dont 0,45 au fonds, monnaie conservée');
        ok(near(rAbs.paid, 8.55) && near(rAbs.fund, 0.45) && near(rAbs.dMasse, 0), 'terrain sous ABS : 8,55 dont 0,45 au fonds, monnaie conservée');
        ok(near(rComp.paid, 0.45) && near(rComp.fund, 0.45) && near(compBalance, 8.1) && near(rComp.dMasse, 0), 'accord de compensation : 8,1 inscrits au registre, seule la réserve vendue (0,45) est payée en argent au fonds');
        ok(merged && near(rLot.paid, 8.55) && near(rLot.fund, 0.45) && near(rLot.dMasse, 0), 'lot regroupé : 8,55 dont 0,45 au fonds, monnaie conservée');
      } else {
        ok(near(est, 9) && near(pawnPaid, 9) && near(rAbs.paid, 9) && near(rLot.paid, 9), 'contre-épreuve : l’ancienne formule fait payer 9 sur toutes les voies');
      }
    }
  });

  await scenario('D. Ouverture des REIT : le journal ne prétend plus que la banque collecte sans détenteur', async () => {
    const E = await setup();
    E.run(`state.etfs.forEach(e=>{ e.opened = false; }); myPlayerId = state.creatorId;`);
    await E.run('openAllEtfs()');
    const txt = E.run(`state.log[0].text`);
    ok(E.run('state.etfs.every(e=>e.opened)'), 'REIT ouverts');
    ok(!/commence à collecter/.test(txt) && /avant la première enchère/.test(txt) && /réserve entière/.test(txt), `message : « ${txt} »`);
  });

  if(failures.length){ console.log(`\nÉCHEC : section 310 (réserve REIT) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 310 (réserve REIT) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
