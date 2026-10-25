// Test — Section 316 : fin de partie (bogues 55, 56, 76, 92 de l'audit du 2026-10-19, défaut des hypothèques
// bancaires signalé par une revue), côté moteur. Décisions de Julien : tests/section316-decisions.test.js.
//
// Garde unique (généralisation de l'angle mort 5 de l'audit : ~30 points d'entrée sans garde gameEndedReason) :
//   runActionWithRetry refuse toute action quand la partie est DÉJÀ terminée sur l'état frais (avant l'applyFn, et
//   de nouveau après un conflit). Le lancer qui termine la partie pose gameEndedReason pendant sa propre action : il
//   passe. Liste blanche : {allowAfterGameEnd:true} (ajustements d'encaisse de l'administrateur).
// 55 : « Devenir l'assureur » après la fin : reprise d'un contrat banque = prime sans risque.
// 56 : annonce de dividende après la fin (moteur : la même garde ; fenêtre : tests/section316-ecrans.test.js).
// 76 : fonder une entreprise / financer son IPO après la fin.
// Revue : issueMortgage / issueMortgageLot (chemin bancaire) sans garde gameEndedReason.
// 92 : appel de marge au lancer qui termine la partie : faux message « la fermeture forcée a échoué ».
//
// Chaque correctif a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section316-fin-de-partie.test.js
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
const SANS_GARDE_UNIQUE = src => src.replace("      if(state && state.gameEndedReason && !allowAfterGameEnd) return gameEndedActionResult(); // Section 316", '');
const SANS_GARDE_HYPOTHEQUE = src => src.split("  if(state.gameEndedReason) return fail(gameEndedActionMessage()); // Section 316 — revue : chemin bancaire").join('');
const MARGE_A_LA_FIN = src => src.replace("  if(state.gameEndedReason){ noteMarginShortfallsAtGameEnd(); return; } // Section 316 — bogue 92", '');

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
// Fin de partie enregistrée (comme un lancer final joué par un autre appareil).
async function terminer(T, reason = 'stockFloor'){
  const r = await T.run(`attemptActionWithRetry(async ()=>{ state.gameEndedReason = {reason:${ESC(reason)}, companyId:B().id, companyName:'Co Bob', roll:state.gameClock.rollCount}; return {ok:true}; })`);
  if(!r.ok) throw new Error('Mise en place : fin de partie non enregistrée');
  T.alerts.length = 0;
}
const enregistre = T => JSON.parse(T.eng.mem.get('game:' + T.run('gameCode')));
// Masse monétaire : encaisses + dividendes annoncés immobilisés (sortis de la trésorerie, pas encore versés).
const masse = T => T.eng.cashTotal() + T.run('(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)');

(async () => {
  // ------------------------------------------------------------------------------------------------- Garde unique
  await scenario('G1 — garde unique : toute action est refusée sur une partie terminée, rien n’est enregistré', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_UNIQUE } : {});
      await terminer(T);
      const m0 = masse(T), avant = T.eng.mem.get('game:' + T.run('gameCode'));
      let appelee = false;
      T.eng.sandbox.__marque = () => { appelee = true; };
      const r = await T.run(`attemptActionWithRetry(async ()=>{ __marque(); A().cash += 5; state.bank.cash -= 5; return {ok:true}; }, {label:'essai'})`);
      console.log(`    [${variante}] résultat ${ESC({ ok: r.ok, code: r.code, error: r.error })}`);
      if(variante === 'corrigé'){
        ok(r.ok === false && r.code === 'game-ended' && /partie est terminée/.test(r.error), 'G1 : refus « La partie est terminée » (code game-ended)');
        ok(!appelee, 'G1 : l’applyFn n’est même pas exécutée');
        ok(T.eng.mem.get('game:' + T.run('gameCode')) === avant && near(T.run('A().cash'), 50), 'G1 : rien n’est enregistré, encaisse de Co Alice inchangée (50)');
        ok(near(masse(T), m0), 'G1 : monnaie conservée');
        // Liste blanche : ajustement de l'administrateur.
        const r2 = await T.run(`attemptActionWithRetry(async ()=>{ A().cash += 1; state.bank.cash -= 1; return {ok:true}; }, {allowAfterGameEnd:true})`);
        ok(r2.ok && near(enregistre(T).companies.find(c => c.name === 'Co Alice').cash, 51), 'G1 : une action de la liste blanche (allowAfterGameEnd) passe et s’enregistre');
      } else {
        ok(r.ok === true && appelee && near(enregistre(T).companies.find(c => c.name === 'Co Alice').cash, 55), 'G1 : contre-épreuve — sans la garde, l’action passe après la fin (Co Alice 50 → 55)');
      }
    }
  });

  await scenario('G2 — le lancer qui TERMINE la partie fonctionne toujours ; le suivant est refusé', async () => {
    const T = await partie({ roll: 5 });
    T.run(`state.hiddenGameLengthTargetYear = 0; drawStockCubes = function(){ return []; };`);
    const m0 = masse(T);
    const r = await T.run(`rollDiceAndMove(A().id)`);
    const S = enregistre(T);
    ok(r && S.gameEndedReason && S.gameEndedReason.reason === 'maxDuration' && S.gameClock.rollCount === 6, `G2 : le lancer 5 → 6 est joué et termine la partie (${ESC(S.gameEndedReason)})`);
    ok(near(masse(T), m0), 'G2 : monnaie conservée');
    T.alerts.length = 0;
    const r2 = await T.run(`rollDiceAndMove(A().id)`);
    ok(r2 === null && enregistre(T).gameClock.rollCount === 6 && /partie est terminée/.test(T.alerts.join(' ')), 'G2 : aucun lancer après la fin (rollCount reste 6)');
  });

  // ------------------------------------------------------------------------------------------------- Bogue 55
  await scenario('55 — après la fin, « Devenir l’assureur » ne rapporte plus de prime sans risque (terrain, taxe, sous-standard)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_UNIQUE } : {});
      // Trois contrats banque sur Co Alice : terrain (Bleu foncé 2, Année), taxe (case 4), sous-standard (Bleu foncé 2).
      await T.run(`attemptActionWithRetry(async ()=>{ A().position = 30;
        P().insurance = {insurerId:'BANK', insuredCompanyId:A().id, claimMode:'recurring', deductible:0, quotedTerm:'year', coveredAmount:0.5, premium:0.2};
        state.taxInsurances.push({taxPos:4, insuredCompanyId:A().id, insurerId:'BANK', claimMode:'recurring', deductible:0, quotedTerm:'year', coveredAmount:2, premium:0.3});
        P().subInsurance = {insurerId:'BANK', insuredCompanyId:A().id, deductible:0, coveredAmount:0.5, premium:0.1};
        return {ok:true}; })`);
      const prix = T.json(`(()=>{ const p = P(); return {
        terrain: liveTakeoverPropQuote(p, A().id, 'recurring', 0, 'year', 0.5).ceil,
        taxe: liveTakeoverTaxQuote(4, A().id, 'recurring', 0, 'year', 2).ceil,
        sous: liveTakeoverSubQuote(p, A().id, 0, 0.5).ceil }; })()`);
      await terminer(T);
      T.run(`myPlayerId = ${ESC(T.ids[1])}`);   // Bob (Co Bob) reprend les contrats
      const m0 = masse(T), b0 = T.run('B().cash');
      await T.run(`takeOverInsuranceItemLive(P().id)`);
      await T.run(`takeOverTaxInsuranceLive(4, A().id)`);
      await T.run(`takeOverSubInsuranceLive(P().id)`);
      const S = enregistre(T);
      const Bs = S.companies.find(c => c.name === 'Co Bob');
      const P2 = S.properties.find(p => p.name === 'Bleu foncé 2');
      const assureurs = [P2.insurance.insurerId, S.taxInsurances[0].insurerId, P2.subInsurance.insurerId];
      console.log(`    [${variante}] primes de reprise ${f4(prix.terrain)} + ${f4(prix.taxe)} + ${f4(prix.sous)} ; Co Bob ${f4(b0)} → ${f4(Bs.cash)} ; assureurs ${ESC(assureurs.map(a => a === 'BANK' ? 'BANK' : 'Co Bob'))}`);
      ok(prix.terrain > 0 && prix.taxe > 0 && prix.sous > 0, 'mise en place : les trois reprises ont un prix positif');
      if(variante === 'corrigé'){
        ok(near(Bs.cash, b0) && assureurs.every(a => a === 'BANK'), '55 : les trois reprises sont refusées — Co Bob inchangée, la banque reste l’assureur');
        ok(T.alerts.length === 3 && T.alerts.every(a => /partie est terminée/.test(a)), '55 : message « La partie est terminée » à chaque essai');
        ok(near(masse(T), m0), '55 : monnaie conservée');
      } else {
        ok(near(Bs.cash, b0 + prix.terrain + prix.taxe + prix.sous) && assureurs.every(a => a !== 'BANK'), '55 : contre-épreuve — sans la garde, Co Bob encaisse les trois primes après la fin');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------- Bogue 56 (moteur)
  await scenario('56 — annonce de dividende après la fin : refusée, la trésorerie ne quitte pas l’entreprise', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_UNIQUE } : {});
      await T.run(`attemptActionWithRetry(async ()=>{ state.companies.forEach(c=>{ c.cash = 20; }); return {ok:true}; })`);   // Co Alice et Co Bob à 20
      await terminer(T);
      // L'applyFn de la fenêtre « Annoncer un dividende » (modalAnnounceDividend), réduite à ses mutations.
      const r = await T.run(`attemptActionWithRetry(async ()=>{ const co = A(); co.cash -= 5; logFin(co.id, 'dividend_payout', -5);
        state.dividendAnnouncements.push({id:uid(), companyId:co.id, amount:5, announcedAtRoll:state.gameClock.rollCount, payAtRoll:3, recordHolders:[], totalSharesAtAnnouncement:co.sharesIssued});
        return {ok:true}; })`);
      const S = enregistre(T);
      const a = S.companies.find(c => c.name === 'Co Alice');
      console.log(`    [${variante}] Co Alice ${f4(a.cash)} ; annonces ${S.dividendAnnouncements.length}`);
      if(variante === 'corrigé') ok(!r.ok && near(a.cash, 20) && S.dividendAnnouncements.length === 0, '56 : annonce refusée, Co Alice garde ses 20 M$');
      else ok(r.ok && near(a.cash, 15) && S.dividendAnnouncements.length === 1, '56 : contre-épreuve — sans la garde, 5 M$ immobilisés à jamais (20 → 15)');
    }
  });

  // ------------------------------------------------------------------------------------------------- Bogue 76 (moteur)
  await scenario('76 — fonder une entreprise ou financer son IPO après la fin : refusé', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_UNIQUE } : {});
      await terminer(T);
      const m0 = masse(T);
      T.run(`myPlayerId = ${ESC(T.ids[2])}`);
      await T.run(`createCompany(${ESC(T.ids[2])}, 'Gamma tardive', '', 'garp', null, null, null)`);
      const g = () => enregistre(T).companies.find(c => c.name === 'Gamma tardive');
      if(variante === 'corrigé'){
        ok(!g() && enregistre(T).companies.length === 2 && /partie est terminée/.test(T.alerts.join(' ')), '76 : Carl ne peut pas fonder « Gamma tardive » après la fin');
        ok(near(masse(T), m0), '76 : monnaie conservée');
      } else {
        ok(!!g(), '76 : contre-épreuve — sans la garde, « Gamma tardive » est fondée après la fin');
        T.run(`myPlayerId = ${ESC(T.ids[0])}`);
        await T.run(`fundCompanyIpo(${ESC(g().id)})`);
        ok(g().sharesIssued === g().totalShares, '76 : contre-épreuve — et son IPO est financée : elle entre au classement final');
      }
    }
    // IPO d'une entreprise déjà fondée mais pas encore financée, puis partie terminée.
    const T = await partie();
    T.run(`myPlayerId = ${ESC(T.ids[2])}`);
    await T.run(`createCompany(${ESC(T.ids[2])}, 'Gamma', '', 'garp', null, null, null)`);
    const gid = T.json(`state.companies.find(c=>c.name==='Gamma').id`);
    await terminer(T);
    T.run(`myPlayerId = ${ESC(T.ids[0])}`);
    const b0 = T.run('state.bank.cash');
    await T.run(`fundCompanyIpo(${ESC(gid)})`);
    const G = enregistre(T).companies.find(c => c.id === gid);
    ok(G.sharesIssued < G.totalShares && near(enregistre(T).bank.cash, b0), `76 : l’IPO de Gamma n’est pas financée après la fin (${G.sharesIssued}/${G.totalShares} parts émises)`);
  });

  // ------------------------------------------------------------------------------------------------- Revue : hypothèques
  await scenario('H — issueMortgage / issueMortgageLot : la partie terminée est vérifiée aussi dans le chemin bancaire', async () => {
    for(const variante of ['corrigé', 'ancien']){
      // L'appel direct (hors file d'actions) n'est protégé que par la garde de la fonction elle-même.
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_HYPOTHEQUE } : {});
      await terminer(T);
      const b0 = T.run('B().cash');
      const r = await T.run(`issueMortgage(P().id, B().id, 'BANK', {silent:true})`);
      // Lot regroupé : Bleu foncé 1 et 2 à Co Bob, regroupés.
      T.run(`(()=>{ const ps = state.properties.filter(p=>p.group===P().group); ps.forEach(p=>{ p.owners=[{companyId:B().id, share:100}]; p.groupMergeId='m1'; p.mortgages=[]; }); })()`);
      const rl = await T.run(`issueMortgageLot('m1', B().id, 'BANK', {silent:true})`);
      console.log(`    [${variante}] terrain ${ESC(r)} ; lot ${ESC(rl)} ; Co Bob ${f4(b0)} → ${f4(T.run('B().cash'))}`);
      if(variante === 'corrigé'){
        ok(!r.ok && /partie est terminée/.test(r.error), 'H : hypothèque bancaire d’un terrain refusée après la fin');
        ok(!rl.ok && /partie est terminée/.test(rl.error), 'H : hypothèque bancaire d’un lot refusée après la fin');
        ok(near(T.run('B().cash'), b0), 'H : Co Bob ne reçoit rien');
      } else {
        ok(r.ok && T.run('B().cash') > b0, 'H : contre-épreuve — sans la garde, la banque prête après la fin');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------- Bogue 92
  await scenario('92 — appel de marge au lancer qui termine la partie : plus de faux « la fermeture forcée a échoué »', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(Object.assign({ roll: 5 }, variante === 'ancien' ? { transform: MARGE_A_LA_FIN } : {}));
      // Carl a vendu à découvert 50 parts de Co Bob et n'a plus que −20 M$ : sous la marge de maintien.
      await T.run(`attemptActionWithRetry(async ()=>{ const c = state.players[2]; c.shortPositions = {[B().id]: {shares:50, avgOpenPrice:B().stockPrice, openedRoll:0}};
        state.bank.cash += c.cash + 20; c.cash = -20; state.hiddenGameLengthTargetYear = 0; return {ok:true}; })`);
      T.run('drawStockCubes = function(){ return []; };');
      const sous = T.json(`({req: requiredMaintenanceMargin(state.players[2]), net: marginableNetWorth(state.players[2])})`);
      const m0 = masse(T);
      await T.run(`rollDiceAndMove(A().id)`);
      const S = enregistre(T);
      const textes = S.log.map(l => l.text || '');
      const faux = textes.filter(t => /la fermeture forcée a échoué/.test(t));
      const info = textes.filter(t => /sous la marge de maintien au lancer final/.test(t));
      console.log(`    [${variante}] marge exigée ${f4(sous.req)}, valeur nette admissible ${f4(sous.net)} ; fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} ; faux messages ${faux.length} ; info ${info.length}`);
      ok(sous.net < sous.req && S.gameEndedReason, 'mise en place : Carl est sous la marge au lancer qui termine la partie');
      if(variante === 'corrigé'){
        ok(faux.length === 0, '92 : aucun « la fermeture forcée a échoué » au journal');
        ok(info.length === 1 && /juste valeur marchande/.test(info[0]), `92 : une ligne d’information claire (« ${info[0] ? info[0].slice(0, 90) : ''}… »)`);
        ok(near(S.players[2].shortPositions[T.run('B().id')].shares, 50), '92 : la position reste ouverte, valorisée au classement final');
        ok(near(masse(T), m0), '92 : monnaie conservée');
      } else {
        ok(faux.length >= 1, '92 : contre-épreuve — l’ancien code écrit « la fermeture forcée a échoué »');
      }
    }
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 316 (fin de partie, moteur) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
