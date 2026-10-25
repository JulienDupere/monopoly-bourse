// Test — Sections 310 à 317 : intégration de la vague 3 (lots 3, 7, 8, 9, 10a, 10b), comportements croisés.
//
// I1 — dividende annoncé + vente à découvert + fin de partie par durée maximale (lots 8, 9 et 10b dans
//      advanceGameClock) : l'annonce échue au lancer final est versée (section 316), l'auto-versement aussi ; dans LES
//      DEUX chemins de versement, le paiement compensatoire du vendeur à découvert apparaît côté banque (bogue 83) ;
//      la part non versée est inscrite au semestre clos (section 315, bogue 81) : variation d'encaisse du bilan = flux
//      du semestre ; monnaie conservée (encaisses + annonces immobilisées).
// I2 — numéros d'année affichés (bogue 95, lot 10b) dans le code du lot 3 : la mise REIT (applyEtfBids, où la ligne a
//      été déplacée par le lot 3 : git ne signalait aucun conflit) et le résultat de l'enchère (resolveEtfAuction).
// I3 — bid payé par les bons (bogue 36, lot 7) qui échoue : les bons sont rendus ET la statistique d'intérêts plafonnée
//      au solde (bogue 86, lot 10a) revient à sa valeur (défaut d'interaction corrigé à l'intégration).
//
// Chaque point a sa contre-épreuve (loadEngine({transform}) : l'ancien code réintroduit fait échouer le test).
// Lancer depuis la racine du dépôt :  node tests/section310-integration.test.js
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
// I1 : résolution naïve du conflit lot 8 × lot 10b (côté lot 10b) : part non versée inscrite au NOUVEAU semestre.
const PART_NON_VERSEE_NOUVEAU_SEMESTRE = src => src.replace(
  "        logFin(co.id, 'dividend_forfeited_return', unclaimed, state.gameClock.rollCount-1);\n        entries.push({label:`${co.name} (portion de dividende non versée — part de la banque",
  "        logFin(co.id, 'dividend_forfeited_return', unclaimed);\n        entries.push({label:`${co.name} (portion de dividende non versée — part de la banque");
// I1 : résolution côté lot 8 seul : ligne Banque absente du versement annoncé.
const SANS_LIGNE_BANQUE_ANNONCE = src => src.replace(
  "          entries.push({label:`Banque (paiement reçu du vendeur à découvert ${pl.name} — ${co.name})`, amount:owed}); // Section 317 — bogue 83 : la banque encaisse, elle apparaît au journal\n        }",
  "        }");
// I1 : ligne Banque absente de l'auto-versement.
const SANS_LIGNE_BANQUE_AUTO = src => src.replace(
  "              entries.push({label:`Banque (paiement reçu du vendeur à découvert ${pl.name} — ${co.name})`, amount:owed}); // Section 317 — bogue 83 : la banque encaisse, elle apparaît au journal\n",
  '');
// I2 : la ligne déplacée par le lot 3 garde l'indice interne.
const MISE_ANNEE_INTERNE = src => src.replace(
  "    log(`${co.name} soumet une mise pour le ${etfLabel(etf.id)} de l'année ${displayGameYear()}:",
  "    log(`${co.name} soumet une mise pour le ${etfLabel(etf.id)} de l'année ${currentGameYear()}:");
const ENCHERE_ANNEE_INTERNE = src => src.replace(
  "remporte l'enchère du ${etfLabel(etf.id)} de l'année ${displayGameYear(year)} à ${fmt(winner.price)} pour l'ensemble du lot.${winnerPriorPct",
  "remporte l'enchère du ${etfLabel(etf.id)} de l'année ${year} à ${fmt(winner.price)} pour l'ensemble du lot.${winnerPriorPct");
// I3 : la statistique n'est pas restaurée quand l'achat échoue (code des lots 7 et 10a fusionnés tels quels).
const STAT_NON_RESTAUREE = src => src.replace(' player.cumBondInterest = cumBondInterestBefore; } // Section 310-317', ' } // Section 310-317');

// Partie à trois : Alice (Co Alice, type Dividendes), Bob (Co Bob), Carl (aucune entreprise, vendeur à découvert).
async function partie(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  const ids = await eng.newGame(['Alice', 'Bob', 'Carl'], ['dividende', 'garp', null]);
  eng.run(`myPlayerId = ${ESC(ids[0])};
    globalThis.A = ()=>state.companies.find(c=>c.name==='Co Alice'); globalThis.B = ()=>state.companies.find(c=>c.name==='Co Bob');
    globalThis.CARL = ()=>state.players.find(p=>p.name==='Carl');`);
  return { eng, ids, run: c => eng.run(c), json: c => eng.json(c) };
}
const masse = T => T.eng.cashTotal() + T.run('(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)');
// Un lancer réel (rollDiceAndMove) depuis la case 10 : 2 à 12 ne touche ni GO, ni taxe, ni terrain possédé.
async function lancer(T){
  await T.run(`attemptActionWithRetry(async ()=>{ A().position = 10; B().position = 10; return {ok:true}; })`);
  await T.run(`rollDiceAndMove(B().id)`);
}

(async () => {
  // ------------------------------------------------------------------------------------------------------------- I1
  await scenario('I1 — dividende annoncé + vente à découvert + fin par durée maximale : monnaie, ligne Banque, bilan = flux', async () => {
    for(const variante of ['corrigé', 'part au nouveau semestre', 'sans Banque (annonce)', 'sans Banque (auto)']){
      const transform = { 'part au nouveau semestre': PART_NON_VERSEE_NOUVEAU_SEMESTRE, 'sans Banque (annonce)': SANS_LIGNE_BANQUE_ANNONCE, 'sans Banque (auto)': SANS_LIGNE_BANQUE_AUTO }[variante];
      const T = await partie({ transform });
      T.run('drawStockCubes = function(){ return []; };');
      // Co Alice : dividende récurrent de 0,3 M$ par semestre (auto-versement) ; lancer 2.
      await T.run(`attemptActionWithRetry(async ()=>{ const co = A(); co.cash = 30; co.dividendAutoPay = true;
        co.dividendBenchmarkPerShare = 0.3/co.sharesIssued; co.dividendBenchmarkFounding = co.dividendBenchmarkPerShare;
        state.gameClock.rollCount = 2; return {ok:true}; })`);
      const m0 = masse(T);
      await lancer(T);                                                       // 2 → 3 : semestre 0 clos (photo)
      ok(T.run('state.gameClock.rollCount') === 3 && T.json('balanceSheetFor(A().id, 0)') !== null, `[${variante}] mise en place : semestre 0 clos, photo du bilan prise`);
      // Lancer 3 (marché ouvert) : Carl vend Co Alice à découvert pour 2 M$.
      const r = await T.run(`attemptActionWithRetry(async ()=>openShortPosition(A(), CARL(), 2))`);
      const shortShares = T.run('CARL().shortPositions[A().id].shares');
      ok(r && r.ok && shortShares > 0, `[${variante}] Carl est à découvert sur Co Alice (${f4(shortShares)} parts)`);
      await lancer(T);                                                       // 3 → 4
      // Lancer 4 : Co Alice annonce 1 M$ payable au lancer 6 ; la partie se termine au lancer 5 → 6 (durée maximale).
      await T.run(`attemptActionWithRetry(async ()=>{ const co = A(); co.cash -= 1; logFin(co.id, 'dividend_payout', -1);
        state.dividendAnnouncements.push({id:'i1', companyId:co.id, amount:1, announcedAtRoll:4, payAtRoll:6,
          recordHolders: co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9).map(h=>({playerId:h.playerId, shares:h.shares})),
          totalSharesAtAnnouncement: co.sharesIssued});
        state.hiddenGameLengthTargetYear = 0; return {ok:true}; })`);
      await lancer(T);                                                       // 4 → 5
      ok(!T.run('state.gameEndedReason'), `[${variante}] la partie continue au lancer 5`);
      await lancer(T);                                                       // 5 → 6 : fin, versements
      const fin = T.json('state.gameEndedReason');
      ok(fin && fin.reason === 'maxDuration' && T.run('state.gameClock.rollCount') === 6, `[${variante}] la partie se termine au lancer 6 (durée maximale)`);
      const L = T.json(`(()=>{ const co = A(); const per = 1/co.sharesIssued, bench = co.dividendBenchmarkPerShare;
        const find = re => state.log.find(l=>re.test(l.text||''));
        const ann = find(/verse son dividende annoncé de 1\\.00/), auto = find(/verse automatiquement son dividende/);
        const banque = l => l && l.entries ? l.entries.filter(e=>/^Banque \\(paiement reçu du vendeur à découvert Carl — Co Alice\\)/.test(e.label)).map(e=>e.amount) : null;
        const carl = l => l && l.entries ? l.entries.filter(e=>/^Carl \\(paiement compensatoire — position à découvert sur Co Alice\\)/.test(e.label)).map(e=>e.amount) : null;
        const b1 = balanceSheetFor(co.id, 1), b0 = balanceSheetFor(co.id, 0);
        return { annLog: !!ann, autoLog: !!auto, banqueAnn: banque(ann), banqueAuto: banque(auto), carlAnn: carl(ann), carlAuto: carl(auto),
          duAnn: per*CARL().shortPositions[co.id].shares, duAuto: bench*CARL().shortPositions[co.id].shares,
          dCash: b1 && b0 ? b1.cash - b0.cash : null, flux: cashFlowStatementFor(co.id, 1).netChange, fluxNouveau: cashFlowStatementFor(co.id, 2).netChange,
          cashFin: co.cash, photo1: b1 ? b1.cash : null, annonces: state.dividendAnnouncements.length }; })()`);
      console.log(`    [${variante}] Banque (annonce) ${ESC(L.banqueAnn)} / dû ${f4(L.duAnn)} ; Banque (auto) ${ESC(L.banqueAuto)} / dû ${f4(L.duAuto)} ; semestre 1 : Δencaisse ${f4(L.dCash)} / flux ${f4(L.flux)} ; flux du semestre 2 ${f4(L.fluxNouveau)} ; monnaie Δ ${(masse(T) - m0).toExponential(1)}`);
      ok(L.annLog && L.autoLog && L.annonces === 0, `[${variante}] l’annonce échue et l’auto-versement sont tous deux versés au lancer final`);
      ok(near(masse(T), m0), `[${variante}] monnaie conservée (encaisses + annonces immobilisées)`);
      const banqueAnnOk = L.banqueAnn && L.banqueAnn.length === 1 && near(L.banqueAnn[0], L.duAnn) && L.carlAnn && near(L.carlAnn[0], -L.duAnn);
      const banqueAutoOk = L.banqueAuto && L.banqueAuto.length === 1 && near(L.banqueAuto[0], L.duAuto) && L.carlAuto && near(L.carlAuto[0], -L.duAuto);
      const bilanOk = L.dCash !== null && near(L.dCash, L.flux) && near(L.fluxNouveau, 0) && near(L.photo1, L.cashFin);
      if(variante === 'corrigé'){
        ok(banqueAnnOk, `I1 : versement annoncé — ligne « Banque (paiement reçu du vendeur à découvert Carl — Co Alice) » +${f4(L.duAnn)}, en face de Carl −${f4(L.duAnn)}`);
        ok(banqueAutoOk, `I1 : auto-versement — même ligne Banque +${f4(L.duAuto)}, en face de Carl −${f4(L.duAuto)}`);
        ok(bilanOk, `I1 : bilan du semestre clos = flux (${f4(L.dCash)} = ${f4(L.flux)}), rien d’inscrit au semestre suivant, photo = encaisse finale`);
      } else if(variante === 'part au nouveau semestre'){
        ok(!bilanOk, 'I1 : contre-épreuve — part non versée inscrite au nouveau semestre (conflit résolu côté lot 10b) : bilan ≠ flux');
      } else if(variante === 'sans Banque (annonce)'){
        ok(!banqueAnnOk && banqueAutoOk, 'I1 : contre-épreuve — conflit résolu côté lot 8 : plus de ligne Banque dans le versement annoncé');
      } else {
        ok(banqueAnnOk && !banqueAutoOk, 'I1 : contre-épreuve — sans la ligne Banque de l’auto-versement, le test la réclame');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------------------- I2
  await scenario('I2 — numéros d’année affichés dans le code du lot 3 (mise et enchère REIT) : displayGameYear', async () => {
    for(const variante of ['corrigé', 'mise', 'enchère']){
      const T = await partie({ transform: variante === 'mise' ? MISE_ANNEE_INTERNE : variante === 'enchère' ? ENCHERE_ANNEE_INTERNE : undefined });
      // Lancer 7 : 2e année (indice interne 1, « Année 2 » dans la barre du haut et les états financiers).
      await T.run(`attemptActionWithRetry(async ()=>{ state.settings.features.etf = true; state.etfs.forEach(e=>{ e.opened = true; });
        state.gameClock.rollCount = 7; A().cash = 20; return {ok:true}; })`);
      const r = await T.run(`attemptActionWithRetry(async ()=>applyEtfBids(A().id, [{etfId: state.etfs[0].id, price: 5}]), {label:'Mise REIT'})`);
      const mise = T.run(`(state.log.find(l=>/soumet une mise pour le/.test(l.text||''))||{}).text||''`);
      await T.run(`attemptActionWithRetry(async ()=>{ resolveEtfAuction(state.etfs[0], currentGameYear()); return {ok:true}; })`);
      const enchere = T.run(`(state.log.find(l=>/remporte l'enchère du/.test(l.text||''))||{}).text||''`);
      const barre = T.run('displayGameYear()');
      console.log(`    [${variante}] barre « Année ${barre} » ; « ${mise.slice(0, 90)} » ; « ${enchere.slice(0, 80)} »`);
      ok(r && r.ok && barre === 2, `[${variante}] mise en place : mise acceptée au lancer 7, barre du haut « Année 2 »`);
      const miseOk = /de l'année 2: 5\.00/.test(mise), enchereOk = /de l'année 2 à 5\.00/.test(enchere);
      if(variante === 'corrigé'){
        ok(miseOk, 'I2 : la mise REIT (applyEtfBids, lot 3) est journalisée « de l’année 2 », comme la barre du haut');
        ok(enchereOk, 'I2 : le résultat de l’enchère (texte enrichi du lot 3) dit aussi « de l’année 2 »');
      } else if(variante === 'mise'){
        ok(!miseOk && /de l'année 1: /.test(mise), 'I2 : contre-épreuve — currentGameYear() dans applyEtfBids écrit « année 1 » au lancer 7');
      } else {
        ok(!enchereOk && /de l'année 1 à /.test(enchere), 'I2 : contre-épreuve — l’indice interne dans resolveEtfAuction écrit « année 1 »');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------------------- I3
  await scenario('I3 — bid payé par les bons qui échoue : bons ET statistique d’intérêts (bogue 86) restaurés', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie({ transform: variante === 'ancien' ? STAT_NON_RESTAUREE : undefined });
      // Bob : encaisse 0, 1 M$ de bons dont 0,6 d'intérêts cumulés ; bid de 0,8 M$ sur Co Alice ; l'achat est refusé.
      await T.run(`attemptActionWithRetry(async ()=>{ const bob = state.players[1]; bob.cash = 0; bob.bondBalance = 1; state.bank.cash -= 1; bob.cumBondInterest = 0.6; return {ok:true}; })`);
      const avant = T.json('(()=>{ const b = state.players[1]; return {cash:b.cash, bonds:b.bondBalance, stat:b.cumBondInterest}; })()');
      const m0 = T.eng.cashTotal();
      const r = T.json(`(()=>{ const real = executeShareTrade; executeShareTrade = function(){ return {ok:false, error:'refus simulé'}; };
        try{ const bid = {companyId: A().id, price: A().stockPrice, qty: 0.8/A().stockPrice}; return fillPendingBid(state.players[1], A(), bid); }
        finally{ executeShareTrade = real; } })()`);
      const apres = T.json('(()=>{ const b = state.players[1]; return {cash:b.cash, bonds:b.bondBalance, stat:b.cumBondInterest}; })()');
      console.log(`    [${variante}] avant ${ESC(avant)} → après ${ESC(apres)} (rempli ${r.filled})`);
      ok(r.filled === 0 && near(apres.cash, avant.cash) && near(apres.bonds, avant.bonds) && near(T.eng.cashTotal(), m0), `[${variante}] achat refusé : encaisse, bons et monnaie inchangés`);
      if(variante === 'corrigé') ok(near(apres.stat, 0.6), 'I3 : les intérêts reçus affichés restent 0,6 (le solde de bons est revenu à 1 ; sans restauration : 0,2, le solde momentané)');
      else ok(!near(apres.stat, 0.6), 'I3 : contre-épreuve — sans restauration, la statistique reste plafonnée au solde momentané (0,6 → ' + f4(apres.stat) + ')');
    }
  });

  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : sections 310-317 (intégration de la vague 3) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
