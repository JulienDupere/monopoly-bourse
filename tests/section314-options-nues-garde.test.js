// Test — section 314, décision de Julien (2026-10-25) : refus des opérations qui portent les options écrites NUES
// au-delà du plafond. Revue : deux contournements du plafond de 15 % (sonde-options.js) :
//   1. acheter 60 000 parts, écrire 600 covered calls (aucun nu), revendre les parts : 600 calls nus (plafond 300) ;
//   2. acheter un bear spread ×1000 (jambes protégées), clôturer seule la jambe achetée : 1 000 puts écrits nus.
// Décision de Julien (verbatim) : « Oui : REIT acheté de gré à gré évalué au plus à la part du dernier prix d'enchère
// (option b), et refus des opérations qui portent les options nues au-delà du plafond. Applique, fais tester, puis
// montre-moi avant de pousser. »
// Mécanique : nakedWrittenCapBreach simule l'opération (writtenOptionCoverage avec override) et la refuse si, après
// elle, le joueur aurait plus de contrats nus que le plafond ET plus qu'avant. Voies volontaires : executeShareTrade
// (vente directe, ask exécuté, annonce CEO) et closeOptionPosition sans drapeau. Jamais bloqués : appel de marge,
// règlement à l'échéance, clôture d'une stratégie entière.
// Contre-épreuves : SANS_GARDE (garde neutralisée) ; GARDE_NAIVE (refus dès que l'on reste au-delà du plafond, voies
// forcées comprises) pour prouver que l'appel de marge et les positions héritées ne sont pas bloqués.
// Lancer depuis la racine du dépôt :  node tests/section314-options-nues-garde.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

const GUARD = '  if(after > cap + 1e-9 && after > before + 1e-9) return {cap, before, after};';
const need = (s, a) => { if(!s.includes(a)) throw new Error('contre-épreuve : motif introuvable — ' + a.slice(0, 60)); return s; };
const SANS_GARDE = s => need(s, GUARD).replace(GUARD, '  if(false) return {cap, before, after};');
const GARDE_NAIVE = s => {
  const flag = '  if(!_bypassTradingWindow && !_cashPrechecked){';
  need(need(s, GUARD), flag);
  return s.replace(GUARD, '  if(after > cap + 1e-9) return {cap, before, after};').replace(flag, '  if(true){');
};

// Partie à trois : Co Alice, Co Bob (200 000 parts, plafond 300 contrats nus), Carl sans entreprise.
async function setup(opts = {}){
  const eng = loadEngine({ transform: opts.transform });
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`globalThis.B = state.companies[1]; globalThis.C = state.players[2]; globalThis.P = B.stockPrice;
    state.gameClock.rollCount = 0; myPlayerId = C.id; globalThis.alerts = []; alert = m => alerts.push(String(m));
    globalThis.naked = () => playerNakedWrittenContracts(C, B.id);
    globalThis.held = () => ((B.shareholders.find(s=>s.playerId===C.id)||{}).shares||0);
    globalThis.give = (pl, q) => { const bk = B.shareholders.find(s=>s.playerId==='BANK'); bk.shares -= q;
      let e = B.shareholders.find(s=>s.playerId===pl.id); if(!e){ e = {playerId:pl.id, shares:0, avgCost:B.stockPrice}; B.shareholders.push(e); } e.shares += q; };
    globalThis.inject = (pl, type, side, strike, expiryRoll, shares, extra) => { pl.optionPositions = pl.optionPositions||[];
      const p = Object.assign({id:uid(), companyId:B.id, type, side, strike, expiryRoll, shares, openedRoll:0, premiumAtOpen:0}, extra||{}); pl.optionPositions.push(p); return p.id; };`);
  return { eng, run: c => eng.run(c), json: c => eng.json(c), cash: () => eng.cashTotal() };
}
const covered600 = E => {
  let r = E.json(`executeShareTrade(B, C, 'buy', 60000*P)`);
  if(!r.ok) throw new Error('achat : ' + r.error);
  r = E.json(`openOptionPosition(B, C, 'call', 'short', P*1.1, 12, 600)`);
  if(!r.ok) throw new Error('covered calls : ' + r.error);
};

(async () => {
  await scenario('A. Sonde 1 — 60 000 parts, 600 covered calls, revente des parts (vente directe)', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: SANS_GARDE } : {});
      ok(E.run('optionWrittenCapContracts(B)') === 300, `[${variant}] plafond : 15 % × 200 000 ÷ 100 = 300 contrats nus`);
      const T0 = E.cash();
      covered600(E);
      ok(E.run('naked()') === 0, `[${variant}] 600 covered calls sur 60 000 parts : 0 contrat nu`);
      const r = E.json(`executeShareTrade(B, C, 'sell', 60000*P)`);
      console.log(`    [${variant}] revente des 60 000 parts : ${r.ok ? 'acceptée' : 'refusée'} → ${E.run('naked()')} nus, ${E.run('held()')} parts`);
      if(variant === 'corrigé'){
        ok(!r.ok && /600 contrat\(s\)/.test(r.error) && /plafond de 300/.test(r.error) && /au plus 30[^0-9]?000/.test(r.error), 'refus : le message donne les 600 contrats nus que la vente créerait, le plafond de 300 et le maximum vendable (30 000 parts)');
        ok(E.run('held()') === 60000 && E.run('naked()') === 0 && near(E.cash(), T0), 'rien ne bouge : 60 000 parts, 0 nu, monnaie conservée');
        let r2 = E.json(`executeShareTrade(B, C, 'sell', 30000*P)`);
        ok(r2.ok && E.run('naked()') === 300, 'vente de 30 000 parts acceptée : 300 calls nus (= plafond)');
        r2 = E.json(`executeShareTrade(B, C, 'sell', 100*P)`);
        ok(!r2.ok && /301 contrat/.test(r2.error), '100 parts de plus : refusées (301 nus)');
        r2 = E.json(`closeOptionPosition(C, C.optionPositions[0].id, 100)`);
        ok(r2.ok && E.run('naked()') === 200, 'racheter 100 calls écrits reste permis (200 nus)');
        r2 = E.json(`executeShareTrade(B, C, 'sell', 10000*P)`);
        ok(r2.ok && E.run('naked()') === 300 && near(E.cash(), T0), 'puis 10 000 parts de plus se vendent (300 nus) ; monnaie conservée');
      } else {
        ok(r.ok && E.run('naked()') === 600, 'contre-épreuve : sans la garde, la vente passe et laisse 600 calls nus (plafond 300)');
      }
    }
  });

  await scenario('B. Ask exécuté : Carl (600 covered calls) place un ask de 60 000 parts, le cours l’atteint', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: SANS_GARDE } : {});
      covered600(E);
      const r = E.json(`placeAsk(C, B, P*2, 60000)`);
      ok(r.ok, `[${variant}] ask déposé (rien n'est vendu au dépôt)`);
      const T0 = E.cash();
      E.run(`B.stockPrice = P*2; checkPendingOrders(B); checkPendingOrders(B);`);
      const logs = E.run(`state.log.filter(l=>/Ask NON exécuté/.test(l.text)).length`);
      console.log(`    [${variant}] après deux passages : ${E.run('held()')} parts, ${E.run('naked()')} nus, asks en attente ${E.run('(C.pendingAsks||[]).length')}, messages ${logs}`);
      if(variant === 'corrigé'){
        ok(E.run('held()') === 60000 && E.run('naked()') === 0 && E.run('(C.pendingAsks||[]).length') === 1 && near(E.cash(), T0), 'ask non exécuté : 60 000 parts gardées, ordre toujours en attente, monnaie conservée');
        ok(logs === 1 && E.run(`/600 contrat\\(s\\)/.test(state.log.find(l=>/Ask NON exécuté/.test(l.text)).text)`), 'expliqué UNE fois au journal (600 nus, plafond), pas à chaque passage');
      } else {
        ok(E.run('held()') === 0 && E.run('naked()') === 600, 'contre-épreuve : sans la garde, l’ask vend tout et laisse 600 calls nus');
      }
    }
  });

  await scenario('C. Annonce CEO : vente annoncée qui découvrirait des calls (positions injectées : le CEO ne peut plus en écrire)', async () => {
    const E = await setup();
    E.run(`globalThis.Bob = state.players[1]; Bob.optionPositions = []; inject(Bob, 'call', 'short', P*3, 24, 900);`);
    const before = E.run(`playerNakedWrittenContracts(Bob, B.id)`), heldBob = E.run(`B.shareholders.find(s=>s.playerId===Bob.id).shares`);
    E.run(`executeCeoAnnouncement({id:'annT', companyId:B.id, ceoId:Bob.id, direction:'sell', amount:30000*P, executeAtRoll:0})`);
    const exec = E.json(`state.ceoAnnouncementExecutions[state.ceoAnnouncementExecutions.length-1]`);
    ok(heldBob === 60000 && before === 300, 'Bob : 60 000 parts, 900 calls écrits dont 300 nus (= plafond)');
    ok(exec && exec.ok === false && /600 contrat\(s\)/.test(exec.error) && E.run(`B.shareholders.find(s=>s.playerId===Bob.id).shares`) === 60000, 'vente annoncée de 30 000 parts : non exécutée (600 nus), consignée comme échec, parts gardées');
  });

  await scenario('D. Sonde 2 — bear spread acheté ×1000, clôture de la seule jambe achetée', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const E = await setup(variant === 'ancien' ? { transform: SANS_GARDE } : {});
      const T0 = E.cash();
      let r = E.json(`openOptionStrategy(B, C, 'bearSpread', 'buy', P*0.9, P*1.1, 12, 1000)`);
      ok(r.ok && E.run('naked()') === 0, `[${variant}] bear spread ×1000 : jambe écrite protégée, 0 nu`);
      E.run(`globalThis.LONG = C.optionPositions.find(p=>p.strategyId && p.side==='long').id;`);
      r = await E.run(`attemptActionWithRetry(async ()=>{ const r = closeOptionPosition(C, LONG, Number.MAX_SAFE_INTEGER); return r.ok ? {ok:true} : {ok:false, error:r.error}; }, {label:'test'})`);
      console.log(`    [${variant}] clôture de la jambe achetée : ${r.ok ? 'acceptée' : 'refusée'} → ${E.run('naked()')} nus`);
      if(variant === 'corrigé'){
        ok(!r.ok && /1000 contrat\(s\)/.test(r.error) && /plafond de 300/.test(r.error) && /stratégie entière/.test(r.error) && /au plus 300 contrat/.test(r.error), 'refus : 1 000 puts nus annoncés, plafond 300, conseil (stratégie entière, ou au plus 300 contrats)');
        ok(E.run('C.optionPositions.length') === 2 && E.run('naked()') === 0 && near(E.cash(), T0), 'rien ne bouge (2 jambes, 0 nu), monnaie conservée');
        r = E.json(`closeOptionPosition(C, LONG, 300)`);
        ok(r.ok && E.run('naked()') === 300, 'clôture de 300 contrats de la jambe achetée : permise (300 nus)');
        r = E.json(`closeOptionPosition(C, LONG, 1)`);
        ok(!r.ok, 'un contrat de plus : refusé (301)');
        r = E.json(`closeOptionStrategy(C, C.optionPositions[0].strategyId)`);
        ok(r.ok && E.run('(C.optionPositions||[]).length') === 0 && near(E.cash(), T0), 'clôture de la stratégie entière : jamais bloquée (jambe achetée d’abord), monnaie conservée');
      } else {
        ok(r.ok && E.run('naked()') === 1000, 'contre-épreuve : sans la garde, la clôture passe et laisse 1 000 puts nus');
      }
    }
  });

  await scenario('E. Positions héritées au-delà du plafond : seul ce qui augmente les contrats nus est bloqué', async () => {
    for(const variant of ['corrigé', 'naïve']){
      const E = await setup(variant === 'naïve' ? { transform: GARDE_NAIVE } : {});
      E.run(`C.optionPositions = []; for(let k=0;k<4;k++) inject(C, 'put', 'short', P*0.5, 12, 200); give(C, 5000);`);
      ok(E.run('naked()') === 800, `[${variant}] 800 puts nus hérités (plafond 300) ; 5 000 parts sans call à couvrir`);
      const r1 = E.json(`closeOptionPosition(C, C.optionPositions[0].id, 50)`);
      const r2 = E.json(`executeShareTrade(B, C, 'sell', 5000*P)`);
      if(variant === 'corrigé'){
        ok(r1.ok && r2.ok && E.run('naked()') === 750, 'racheter 50 puts (750 nus) et vendre les 5 000 parts (aucun call découvert) : permis');
        const r3 = E.json(`openOptionPosition(B, C, 'put', 'short', P*0.5, 12, 1)`);
        ok(!r3.ok, 'écrire 1 put de plus : refusé (751 > 750)');
      } else {
        ok(!r1.ok, 'contre-épreuve (garde naïve « refus dès que l’on reste au-delà du plafond ») : même le rachat de 50 puts serait bloqué');
      }
    }
  });

  await scenario('F. Appel de marge non bloqué : 800 puts nus hérités, cours effondré, encaisse 50', async () => {
    for(const variant of ['corrigé', 'naïve']){
      const E = await setup(variant === 'naïve' ? { transform: GARDE_NAIVE } : {});
      E.run(`C.optionPositions = []; for(let k=0;k<4;k++) inject(C, 'put', 'short', 1, 12, 200); B.stockPrice = 0.5; C.cash = 50; C.bondBalance = 0;`);
      const T0 = E.cash();
      ok(E.run('naked()') === 800 && E.run('marginableNetWorth(C) < requiredMaintenanceMargin(C)'), `[${variant}] Carl est sous la marge de maintien (800 puts nus)`);
      await E.run(`attemptActionWithRetry(async ()=>{ enforceMarginCalls(); return {ok:true}; }, {label:'test'})`);
      const failed = E.run(`state.log.some(l=>/la fermeture forcée a échoué/.test(l.text))`);
      const forced = E.run(`state.log.filter(l=>/clôture FORCÉE/.test(l.text)).length`);
      console.log(`    [${variant}] après l’appel de marge : ${E.run('naked()')} puts nus, ${forced} clôture(s) forcée(s), échec ${failed}, encaisse ${E.run('C.cash').toFixed(2)}`);
      if(variant === 'corrigé'){
        ok(!failed && forced >= 1 && E.run('naked()') < 800 && near(E.cash(), T0), 'clôtures forcées exécutées (aucun échec), monnaie conservée');
        ok(E.run('marginableNetWorth(C) >= requiredMaintenanceMargin(C) - 1e-9') || E.run('naked()') === 0, 'l’appel de marge va jusqu’au bout (marge rétablie ou plus aucune position écrite)');
      } else {
        ok(failed && E.run('naked()') === 800, 'contre-épreuve : une garde appliquée aux voies forcées bloquerait l’appel de marge (« la fermeture forcée a échoué »)');
      }
    }
  });

  await scenario('G. Règlement à l’échéance non bloqué : 600 puts achetés exercés livrent les 60 000 parts qui couvraient 600 calls', async () => {
    const E = await setup();
    E.run(`B.stockPrice = 1; C.optionPositions = []; give(C, 60000); inject(C, 'call', 'short', 5, 24, 600); inject(C, 'put', 'long', 2, 6, 600); state.gameClock.rollCount = 6;`);
    ok(E.run('naked()') === 0, '600 calls couverts par 60 000 parts, 0 nu');
    const T0 = E.cash();
    await E.run(`attemptActionWithRetry(async ()=>{ settleExpiredOptions(); return {ok:true}; }, {label:'test'})`);
    ok(E.run('held()') === 0 && E.run('naked()') === 600 && E.run(`C.optionPositions.length`) === 1 && near(E.cash(), T0), 'puts exercés : 60 000 parts livrées, les 600 calls deviennent nus (au-delà du plafond, voie forcée), monnaie conservée');
    const r = E.json(`openOptionPosition(B, C, 'call', 'short', 6, 24, 1)`);
    ok(!r.ok, 'ensuite, écrire un call de plus reste refusé');
  });

  if(failures.length){ console.log(`\nÉCHEC : section 314 (garde des options nues) — ${failures.length} scénario(s) en échec :`); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`\nOK : section 314 (garde des options nues) — ${n} vérifications, 0 scénario(s) en échec`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
