// Test — Section 316 : décisions de Julien sur la fin de partie, côté moteur.
//
// « dividende annoncé dû au lancer final = versé aux actionnaires » : une annonce échue au lancer qui termine la partie
//   (durée maximale : la fin est posée avant le versement du changement de semestre) était rendue à l'entreprise ;
//   elle est désormais versée avec les règles actuelles (section 307). Une annonce pas encore échue reste rendue.
// « fin de partie en cours d'année : régler les soldes de compensation et le pari du lot commercial, comptés au
//   classement final » : mêmes fonctions et mêmes règles qu'en fin d'année ; rien en double à une frontière d'année.
//   Retouche de la revue (option à valider par Julien) : le prix du lot commercial est réglé au prorata des lancers
//   écoulés depuis l'enchère, sur 6 (prix × écoulés ÷ 6), contre les loyers comptés ; l'année complète ne change pas.
//
// Chaque décision a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section316-decisions.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 4) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
const ESC = s => JSON.stringify(s);

// --- Contre-épreuves -------------------------------------------------------------------------------------------------
const DIVIDENDE_DU_RENDU = src => src.replace("  const pending = state.dividendAnnouncements.filter(ann=>!(ann.payAtRoll<=state.gameClock.rollCount)); // Section 316 — décision", "  const pending = state.dividendAnnouncements;");
const SANS_REGLEMENT_FIN = src => src.replace("  settleYearContractsAtGameEnd(); // Section 316 — décision", '');
const PRIX_ENTIER = src => src.replace('    lot.price = pr.price; // Section 316 — retouche de la revue : prix au prorata', '');

// Partie à trois : Alice (créatrice, Co Alice), Bob (Co Bob), Carl (aucune entreprise). Bob possède Bleu foncé 2
// (case 39, loyer 0,5) ; Co Alice et Co Bob sont en case 10 (un lancer de 2 à 12 n'atteint ni GO, ni une taxe, ni
// une case du lot commercial, ni un terrain d'une autre entreprise).
async function partie(opts = {}){
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: { alert: m => alerts.push(String(m)) } });
  const ids = await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`myPlayerId = ${ESC(ids[0])};
    globalThis.A = ()=>state.companies.find(c=>c.name==='Co Alice'); globalThis.B = ()=>state.companies.find(c=>c.name==='Co Bob');
    globalThis.P = ()=>state.properties.find(p=>p.name==='Bleu foncé 2');`);
  await eng.run(`attemptActionWithRetry(async ()=>{
    P().owners = [{companyId:B().id, share:100}]; P().houses = 0; P().mortgages = []; P().insurance = null; P().subInsurance = null;
    state.gameClock.rollCount = ${opts.roll || 0}; A().position = 10; B().position = 10; A().cash = 50; B().cash = 50;
    return {ok:true}; })`);
  alerts.length = 0;
  return { eng, ids, alerts, run: c => eng.run(c), json: c => eng.json(c) };
}
const enregistre = T => JSON.parse(T.eng.mem.get('game:' + T.run('gameCode')));
// Masse monétaire : encaisses + dividendes annoncés immobilisés (sortis de la trésorerie, pas encore versés).
const masse = T => T.eng.cashTotal() + T.run('(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)');

(async () => {
  // ------------------------------------------------------------------------------------------------- Décision dividende
  await scenario('D1 — décision : dividende annoncé dû au lancer final (durée maximale) = versé aux actionnaires', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(Object.assign({ roll: 4 }, variante === 'ancien' ? { transform: DIVIDENDE_DU_RENDU } : {}));
      // Lancer 4 : Co Alice annonce 6 M$, payable au lancer 6 ; la partie se termine au lancer 5 → 6.
      await T.run(`attemptActionWithRetry(async ()=>{ const co = A(); co.cash -= 6; logFin(co.id, 'dividend_payout', -6);
        state.dividendAnnouncements.push({id:'d1', companyId:co.id, amount:6, announcedAtRoll:4, payAtRoll:6,
          recordHolders: co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9).map(h=>({playerId:h.playerId, shares:h.shares})),
          totalSharesAtAnnouncement: co.sharesIssued});
        state.gameClock.rollCount = 5; state.hiddenGameLengthTargetYear = 0; return {ok:true}; })`);
      T.run('drawStockCubes = function(){ return []; };');
      const attendu = T.json(`(()=>{ const co = A(); const per = 6/co.sharesIssued; const o = {}; co.shareholders.filter(s=>s.playerId!=='BANK').forEach(s=>{ o[s.playerId] = per*s.shares; }); return o; })()`);
      const j0 = T.json('state.players.map(p=>p.cash)'), a0 = T.run('A().cash'), m0 = masse(T);
      await T.run(`rollDiceAndMove(B().id)`);
      const S = enregistre(T);
      const j1 = S.players.map(p => p.cash), a1 = S.companies.find(c => c.name === 'Co Alice').cash;
      const recu = S.players.map((p, i) => j1[i] - j0[i]);
      const totalRecu = recu.reduce((s, x) => s + x, 0);
      const totalAttendu = Object.values(attendu).reduce((s, x) => s + x, 0);
      console.log(`    [${variante}] fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; reçu par les joueurs ${recu.map(f4).join(' / ')} (attendu ${f4(totalAttendu)}) ; Co Alice ${f4(a0)} → ${f4(a1)}`);
      ok(S.gameEndedReason && S.gameEndedReason.reason === 'maxDuration' && S.gameClock.rollCount === 6, 'mise en place : la partie se termine au lancer 6 (durée maximale)');
      if(variante === 'corrigé'){
        ok(S.players.every((p, i) => near(recu[i], attendu[p.id] || 0)), 'D1 : chaque actionnaire reçoit montant ÷ parts émises × ses parts éligibles');
        ok(near(a1 - a0, 6 - totalAttendu) && S.dividendAnnouncements.length === 0, `D1 : Co Alice ne récupère que la part non réclamée (${f4(6 - totalAttendu)} : parts de la banque), l’annonce est soldée`);
        ok(S.log.some(l => /verse son dividende annoncé de 6\.00/.test(l.text || '')) && !S.log.some(l => /avant le versement du dividende/.test(l.text || '')), 'D1 : journal « verse son dividende annoncé », plus « rendu à sa trésorerie »');
        ok(near(masse(T), m0), 'D1 : monnaie conservée');
      } else {
        ok(near(totalRecu, 0) && near(a1 - a0, 6), 'D1 : contre-épreuve — l’ancien code rend les 6 M$ à Co Alice, rien aux actionnaires');
      }
    }
  });

  await scenario('D2 — un dividende PAS encore dû à la fin (fin en cours de semestre) reste rendu à l’entreprise', async () => {
    const T = await partie({ roll: 1 });
    await T.run(`attemptActionWithRetry(async ()=>{ const co = A(); co.cash -= 4; logFin(co.id, 'dividend_payout', -4);
      state.dividendAnnouncements.push({id:'d2', companyId:co.id, amount:4, announcedAtRoll:1, payAtRoll:3,
        recordHolders: co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9).map(h=>({playerId:h.playerId, shares:h.shares})), totalSharesAtAnnouncement: co.sharesIssued});
      return {ok:true}; })`);
    T.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(co){ return {gameOver: co.name==='Co Bob'}; };`);
    const j0 = T.json('state.players.map(p=>p.cash)'), a0 = T.run('A().cash'), m0 = masse(T);
    await T.run(`rollDiceAndMove(B().id)`);   // lancer 1 → 2 : Co Bob tombe à 0, fin de partie
    const S = enregistre(T);
    const a1 = S.companies.find(c => c.name === 'Co Alice').cash;
    console.log(`    fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; Co Alice ${f4(a0)} → ${f4(a1)}`);
    ok(S.gameEndedReason && S.gameEndedReason.reason === 'stockFloor' && S.gameClock.rollCount === 2, 'mise en place : fin au lancer 2 (cours de Co Bob à 0)');
    ok(near(a1 - a0, 4) && S.players.every((p, i) => near(p.cash, j0[i])) && S.dividendAnnouncements.length === 0, 'D2 : les 4 M$ dus au lancer 3 reviennent à Co Alice (règle inchangée)');
    ok(near(masse(T), m0), 'D2 : monnaie conservée');
  });

  // ------------------------------------------------------------------------------------------------- Décision fin en cours d'année
  // Compensation Co Alice ⇄ Co Bob : balance 3 due par Co Alice, intérêt 10 % → 3,30 versé à Co Bob.
  // Lot commercial de Co Alice (année 1, enchère résolue au lancer 7) : prix 6 pour l'année, loyers comptés 0,5.
  // Retouche de la revue : à une fin en cours d'année, prix au prorata des lancers écoulés depuis l'enchère, sur 6 :
  // fin au lancer 8 → 1 lancer → prix 1,00 → pari raté de 0,50 versé à Co Bob (seule autre entreprise).
  // Prix entier (ancien règlement) : pari raté de 5,50.
  const CONTRATS = `state.settings.features.rentCompensation = true; state.settings.features.terrainLot = true;
    state.rentCompensations.push({id:'rc1', companyA:A().id, companyB:B().id, interestRate:0.1, balance:3, createdAt:'x'});
    state.terrainLot.active = {companyId:A().id, price:6, loyer:1, numSquares:2, squares:[2,7], accrued:0.5, year:1};`;
  async function finEnCoursDAnnee(transform, declencheur){
    const T = await partie({ roll: 7, transform });
    await T.run(`attemptActionWithRetry(async ()=>{ ${CONTRATS} ${declencheur.setup || ''} return {ok:true}; })`);
    T.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = ${declencheur.draws || 'function(){ return {gameOver:false}; }'};`);
    const a0 = T.run('A().cash'), b0 = T.run('B().cash'), m0 = masse(T);
    const v0 = T.json('({A: companyValue(A()), B: companyValue(B())})');
    await T.run(`rollDiceAndMove(A().id)`);   // lancer 7 → 8 (année 1, 1er semestre... en cours d'année)
    const S = enregistre(T);
    const a1 = S.companies.find(c => c.name === 'Co Alice').cash, b1 = S.companies.find(c => c.name === 'Co Bob').cash;
    return { T, S, a0, b0, a1, b1, m0, v0 };
  }
  for(const [code, declencheur] of [
    ['F1', { titre: 'Co Bob à 100 % banque (délai de grâce expiré)', raison: 'bankOwnsAll', setup: 'B().bankOwnedGraceExpiry = 8;' }],
    ['F2', { titre: 'cours de Co Bob à 0', raison: 'stockFloor', draws: "function(co){ return {gameOver: co.name==='Co Bob'}; }" }],
  ]){
    await scenario(`${code} — décision : fin en cours d’année (${declencheur.titre}) : compensation et lot commercial réglés, comptés au classement`, async () => {
      for(const variante of ['corrigé', 'ancien', 'prix entier']){
        const R = await finEnCoursDAnnee(variante === 'ancien' ? SANS_REGLEMENT_FIN : variante === 'prix entier' ? PRIX_ENTIER : undefined, declencheur);
        const { T, S } = R;
        const v1 = T.json('({A: companyValue(A()), B: companyValue(B())})');
        console.log(`    [${variante}] fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; Co Alice ${f4(R.a0)} → ${f4(R.a1)} ; Co Bob ${f4(R.b0)} → ${f4(R.b1)} ; compensations ${S.rentCompensations.length} ; lot actif ${!!S.terrainLot.active} ; valeur Co Bob ${f4(R.v0.B)} → ${f4(v1.B)}`);
        ok(S.gameEndedReason && S.gameEndedReason.reason === declencheur.raison && S.gameClock.rollCount === 8, `mise en place : fin de partie au lancer 8 (${declencheur.raison}), en cours d’année`);
        if(variante === 'corrigé'){
          ok(near(R.a1 - R.a0, -3.8) && near(R.b1 - R.b0, 3.8), `${code} : Co Alice verse 3,30 (compensation + 10 %) + 0,50 (pari raté au prorata : 1 lancer sur 6, prix 1,00 contre 0,50 de loyers) = 3,80 à Co Bob`);
          ok(S.rentCompensations.length === 0 && !S.terrainLot.active && S.terrainLot.lastResult && near(S.terrainLot.lastResult.balance, -0.5) && S.terrainLot.lastResult.elapsedRolls === 1 && near(S.terrainLot.lastResult.fullYearPrice, 6), `${code} : accord soldé et clôturé, lot commercial réglé (solde −0,50, 1 lancer écoulé, prix annuel 6 consignés)`);
          ok(near(v1.B - R.v0.B, 3.8) && near(v1.A - R.v0.A, -3.8), `${code} : l’équité des entreprises (classement final) en tient compte (±3,80)`);
          ok(S.log.some(l => /Fin de partie en cours d’année/.test(l.text || '')), `${code} : le journal annonce le règlement de fin de partie`);
          ok(near(masse(T), R.m0), `${code} : monnaie conservée`);
        } else if(variante === 'ancien'){
          ok(near(R.a1, R.a0) && S.rentCompensations.length === 1 && !!S.terrainLot.active, `${code} : contre-épreuve — l’ancien code laisse la balance et le pari en suspens pour toujours`);
        } else {
          ok(near(R.a1 - R.a0, -8.8) && near(masse(T), R.m0), `${code} : contre-épreuve — au prix entier, Co Alice paierait 3,30 + 5,50 = 8,80 pour un seul lancer de lot`);
        }
      }
    });
  }

  await scenario('F4 — décision : fin entre deux lancers (prêt de dernier recours qui fait tomber le cours à 0) : réglée aussi', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie({ roll: 9, transform: variante === 'ancien' ? SANS_REGLEMENT_FIN : undefined });
      await T.run(`attemptActionWithRetry(async ()=>{ ${CONTRATS} const b = B(); b.cash = -1; state.bank.cash += 51; b.stockPrice = b.stockPriceFounding * STOCK_FOUNDING_FLOOR_PCT * 1.01; return {ok:true}; })`);
      const a0 = T.run('A().cash'), m0 = masse(T);
      const r = await T.run(`attemptActionWithRetry(()=>triggerLastResortLoan(B().id))`);
      const S = enregistre(T);
      const a1 = S.companies.find(c => c.name === 'Co Alice').cash;
      console.log(`    [${variante}] prêt ${r && r.ok} ; fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; Co Alice ${f4(a0)} → ${f4(a1)} ; compensations ${S.rentCompensations.length} ; lot actif ${!!S.terrainLot.active}`);
      ok(r && r.ok && S.gameEndedReason && S.gameEndedReason.reason === 'stockFloor', 'mise en place : le prêt de dernier recours fait tomber le cours de Co Bob sous le plancher : fin de partie');
      if(variante === 'corrigé'){
        ok(near(a1 - a0, -4.8) && S.rentCompensations.length === 0 && !S.terrainLot.active, 'F4 : fin au lancer 9 (2 lancers de lot) : Co Alice verse 3,30 + 1,50 (prix 2,00 au prorata contre 0,50 de loyers) ; accord et lot commercial réglés');
        ok(near(masse(T), m0), 'F4 : monnaie conservée');
      } else {
        ok(near(a1, a0) && S.rentCompensations.length === 1, 'F4 : contre-épreuve — l’ancien code laisse tout en suspens');
      }
    }
  });

  await scenario('F5 — retouche de la revue : lot gagné au lancer 7, fin au lancer 8, aucun loyer : prix 9 × 1/6 = 1,50 et non 9', async () => {
    for(const variante of ['corrigé', 'prix entier']){
      const T = await partie({ roll: 7, transform: variante === 'prix entier' ? PRIX_ENTIER : undefined });
      // Mise de Co Alice : prix 9, loyer 1, cases 2 et 7 (hors de portée d'un lancer depuis la case 10).
      await T.run(`attemptActionWithRetry(async ()=>{ state.settings.features.terrainLot = true; state.terrainLot.active = null;
        state.terrainLot.bids = [{companyId:A().id, price:9, loyer:1, numSquares:2}]; return {ok:true}; })`);
      T.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(co){ return {gameOver: co.name==='Co Bob'}; };`);
      const a0 = T.run('A().cash'), b0 = T.run('B().cash'), m0 = masse(T);
      await T.run('rollDiceAndMove(B().id)');   // lancer 7 → 8 : l'enchère se résout, puis Co Bob tombe à 0
      const S = enregistre(T);
      const a1 = S.companies.find(c => c.name === 'Co Alice').cash, b1 = S.companies.find(c => c.name === 'Co Bob').cash;
      console.log(`    [${variante}] fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; lot ${ESC(S.terrainLot.lastResult)} ; Co Alice ${f4(a0)} → ${f4(a1)} ; Co Bob ${f4(b0)} → ${f4(b1)}`);
      ok(S.gameEndedReason && S.gameEndedReason.reason === 'stockFloor' && S.gameClock.rollCount === 8 && S.terrainLot.lastResult && S.terrainLot.lastResult.companyId === S.companies.find(c => c.name === 'Co Alice').id, 'mise en place : Co Alice remporte le lot au lancer 7 → 8, la partie se termine à ce lancer');
      if(variante === 'corrigé'){
        ok(near(a1 - a0, -1.5) && near(b1 - b0, 1.5), 'F5 : Co Alice paie 1,50 (9 × 1 lancer ÷ 6, aucun loyer) à Co Bob');
        ok(S.log.some(l => /ramené au prorata de 1 lancer\(s\) écoulé\(s\) sur 6/.test(l.text || '')), 'F5 : le journal explique le prorata');
        ok(near(masse(T), m0), 'F5 : monnaie conservée');
      } else {
        ok(near(a1 - a0, -9), 'F5 : contre-épreuve — au prix entier, Co Alice paie 9 pour un lot tenu un seul lancer');
      }
    }
  });

  await scenario('F3 — fin à la frontière d’année (durée maximale) : réglé une seule fois, par la fin d’année', async () => {
    const T = await partie({ roll: 5 });
    await T.run(`attemptActionWithRetry(async ()=>{ ${CONTRATS.replace("year:1", "year:0")} state.hiddenGameLengthTargetYear = 0; return {ok:true}; })`);
    T.run('drawStockCubes = function(){ return []; };');
    const a0 = T.run('A().cash'), b0 = T.run('B().cash'), m0 = masse(T);
    await T.run(`rollDiceAndMove(B().id)`);
    const S = enregistre(T);
    const a1 = S.companies.find(c => c.name === 'Co Alice').cash, b1 = S.companies.find(c => c.name === 'Co Bob').cash;
    console.log(`    fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} au lancer ${S.gameClock.rollCount} ; Co Alice ${f4(a0)} → ${f4(a1)} ; Co Bob ${f4(b0)} → ${f4(b1)}`);
    ok(S.gameEndedReason && S.gameEndedReason.reason === 'maxDuration', 'mise en place : fin au lancer 6 (durée maximale)');
    ok(near(a1 - a0, -8.8) && near(b1 - b0, 8.8), 'F3 : année complète, prix entier (inchangé) : 3,30 + 5,50 = 8,80 versés une seule fois (pas de double règlement)');
    ok(!S.log.some(l => /Fin de partie en cours d’année/.test(l.text || '')), 'F3 : pas de ligne « fin de partie en cours d’année » (tout est déjà réglé)');
    ok(near(masse(T), m0), 'F3 : monnaie conservée');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 316 (décisions de Julien, moteur) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
