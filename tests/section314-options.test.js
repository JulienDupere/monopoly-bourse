// Section 314 — options : bogues 38 et 75 de l'audit du 2026-10-19, et décision de Julien sur les options écrites.
//   Bogue 38 : une option simple identique à une jambe de stratégie (même type, côté, strike, échéance) fusionnait avec
//              elle : elle disparaissait de « Mes positions », devenait réglée en argent et ne se fermait plus seule.
//              Désormais l'option simple est une position distincte (jamais fusionnée dans une jambe de stratégie).
//   Décision : « options écrites : plafond de 15 % des parts de l'entreprise par joueur (comme les calls achetés) ».
//              Un joueur ne peut avoir, sur une entreprise, plus de floor(15 % × parts émises ÷ 100) contrats ÉCRITS
//              (calls et puts, positions simples et jambes écrites des stratégies), vérifié dans openOptionPosition
//              et openOptionStrategy, donc dans l'applyFn.
//   Bogue 75 : « Fermer la stratégie » marché fermé ou partie terminée annonçait au journal une fausse clôture
//              (0 contrat). Déjà corrigé par la section 307 (closeOptionStrategy refuse avant tout, tout ou rien) :
//              test de verrou, contre-épreuve avec la version d'avant la section 307.
// Lancer depuis la racine du dépôt :  node tests/section314-options.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}

// Ancien code (contre-épreuves).
const ANCIEN_FUSION = src => src.split('pos.expiryRoll===expiryRoll && !pos.strategyId').join('pos.expiryRoll===expiryRoll');
const SANS_PLAFOND_ECRIT = src => src
  .replace('if(alreadyWritten + shares > capWritten + 1e-9){', 'if(false){')
  .replace('if(alreadyWritten + writtenLegCount*contracts > capWritten + 1e-9){', 'if(false){');
const ANCIEN_FERMER = src => src.replace(/function closeOptionStrategy\(player, strategyId\)\{[\s\S]*?\n\}\n/,
  `function closeOptionStrategy(player, strategyId){
  const legs = (player.optionPositions||[]).filter(p=>p.strategyId===strategyId && p.shares>1e-9);
  if(legs.length===0) return {ok:false, error:'Stratégie introuvable ou déjà clôturée.'};
  const entries = [];
  let qty = 0;
  legs.forEach(leg=>{
    const res = closeOptionPosition(player, leg.id, Number.MAX_SAFE_INTEGER);
    if(res.ok){ entries.push(...res.entries); qty += res.qty; }
  });
  return {ok:true, entries, qty};
}
`);

// Partie à trois : Carl (sans entreprise, 50 M$) trade des options sur Co Bob (200 000 parts à 100 $ = 0,0001 M$).
async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`globalThis.B = state.companies[1]; globalThis.C = state.players[2]; globalThis.P = B.stockPrice;
    state.gameClock.rollCount = 0; myPlayerId = C.id;
    globalThis.alerts = []; alert = m => alerts.push(String(m));`);
  return eng;
}
const positions = (eng) => eng.json(`C.optionPositions.map(p=>({type:p.type, side:p.side, strike:+(p.strike/P).toFixed(2), shares:p.shares, strat:!!p.strategyId, cash:!!p.cashSettled, id:p.id}))`);

// --- Bogue 38 -------------------------------------------------------------------------------------------------
async function bug38(eng){
  const t0 = eng.cashTotal();
  ok(eng.json(`openOptionStrategy(B, C, 'bullSpread', 'buy', P*0.9, P*1.1, 12, 2)`).ok, '38 : Carl ouvre un bull spread 90/110 $ de 2 contrats');
  ok(eng.json(`openOptionPosition(B, C, 'call', 'long', P*0.9, 12, 1)`).ok, '38 : Carl achète un call simple à 90 $ (même échéance)');
  const pos = positions(eng);
  console.log('    positions : ' + pos.map(p => `${p.side} ${p.type} ${p.strike} ×${p.shares}${p.strat ? ' (stratégie)' : ''}`).join(' | '));
  const jambe = pos.find(p => p.strat && p.side === 'long'), simple = pos.find(p => !p.strat);
  ok(jambe && jambe.shares === 2, `38 : la jambe achetée de la stratégie reste à 2 contrats (avant : 3) — obtenu ${jambe && jambe.shares}`);
  ok(simple && simple.shares === 1 && simple.type === 'call' && simple.side === 'long' && !simple.cash, '38 : le call simple est une position distincte de 1 contrat, livrable en parts (non réglée en argent)');
  // Fermeture seule de l'option simple : la stratégie est intacte.
  eng.run('state.gameClock.rollCount = 0');
  const r = eng.json(`closeOptionPosition(C, ${JSON.stringify(simple ? simple.id : '')}, 1)`);
  const pos2 = positions(eng);
  ok(r.ok && pos2.length === 2 && pos2.every(p => p.strat && p.shares === 2), '38 : le call simple se ferme seul ; les 2 jambes de la stratégie restent à 2 contrats');
  // Écriture simple identique à la jambe écrite : position distincte aussi (marge initiale simulée sur la bonne position).
  ok(eng.json(`openOptionPosition(B, C, 'call', 'short', P*1.1, 12, 1)`).ok, '38 : Carl écrit un call simple à 110 $ identique à la jambe écrite');
  const pos3 = positions(eng);
  ok(pos3.length === 3 && pos3.find(p => p.strat && p.side === 'short').shares === 2 && pos3.find(p => !p.strat && p.side === 'short').shares === 1,
    '38 : la jambe écrite reste à 2 contrats, le call écrit simple est distinct (1 contrat)');
  ok(near(eng.cashTotal(), t0), '38 : monnaie conservée');
}

// --- Décision : plafond de 15 % des options écrites ----------------------------------------------------------
async function plafond(eng){
  const cap = eng.run('optionWrittenCapContracts(B)');
  ok(cap === 300, `plafond : 15 % × 200 000 parts ÷ 100 = ${cap} contrats écrits par joueur sur Co Bob`);
  ok(eng.json(`openOptionPosition(B, C, 'put', 'short', P*0.9, 12, 200)`).ok, 'plafond : Carl écrit 200 puts (200/300)');
  const r1 = eng.json(`openOptionPosition(B, C, 'call', 'short', P*1.1, 12, 101)`);
  ok(!r1.ok && /Plafond d'options écrites/.test(r1.error), `plafond : 101 calls écrits de plus (301/300) refusés — ${r1.error}`);
  ok(eng.json(`openOptionPosition(B, C, 'call', 'short', P*1.1, 12, 60)`).ok, 'plafond : 60 calls écrits acceptés (260/300)');
  // Stratégie : un straddle vendu a 2 jambes écrites → 2 × 21 = 42 contrats écrits (302/300) refusé ; 2 × 20 accepté.
  const r2 = eng.json(`openOptionStrategy(B, C, 'straddle', 'sell', 0, 0, 12, 21)`);
  ok(!r2.ok && /Plafond d'options écrites/.test(r2.error), `plafond : straddle vendu de 21 contrats (2 jambes écrites → 302/300) refusé`);
  ok(eng.json(`openOptionStrategy(B, C, 'straddle', 'sell', 0, 0, 12, 20)`).ok, 'plafond : straddle vendu de 20 contrats (300/300) accepté');
  ok(eng.run(`playerWrittenOptionContracts(C, B.id)`) === 300, 'plafond : 300 contrats écrits au total (simples + jambes de stratégie)');
  const r3 = eng.json(`openOptionStrategy(B, C, 'bullSpread', 'buy', P*0.9, P*1.1, 12, 1)`);
  ok(!r3.ok && /Plafond d'options écrites/.test(r3.error), 'plafond : un bull spread (1 jambe écrite) est refusé une fois le plafond atteint');
  // Les achats restent libres (plafond propre aux calls achetés), comme sur une autre entreprise.
  ok(eng.json(`openOptionPosition(B, C, 'put', 'long', P*0.9, 12, 5)`).ok, 'plafond : acheter des puts reste possible (le plafond vise les options écrites)');
  ok(eng.json(`openOptionPosition(state.companies[0], C, 'put', 'short', state.companies[0].stockPrice*0.9, 12, 10)`).ok, 'plafond : par entreprise — écrire sur Co Alice reste possible');
  // Revérifié dans l'applyFn : l'action passe par runModalActionWithRetry → openOptionPosition sur l'état frais.
  const t0 = eng.cashTotal();
  const res = await eng.run(`runModalActionWithRetry(()=>openOptionPosition(companyById(B.id), state.players.find(p=>p.id===myPlayerId), 'call', 'short', P*1.1, 12, 1))`);
  ok(res && !res.ok && near(eng.cashTotal(), t0) && eng.run(`playerWrittenOptionContracts(C, B.id)`) === 300, 'plafond : refus dans l’applyFn, rien d’enregistré (toujours 300 contrats, monnaie inchangée)');
  // Une position fermée libère le plafond.
  eng.run(`globalThis.PUTS = C.optionPositions.find(p=>!p.strategyId && p.type==='put' && p.side==='short');`);
  ok(eng.json(`closeOptionPosition(C, PUTS.id, 50)`).ok && eng.json(`openOptionPosition(B, C, 'call', 'short', P*1.1, 12, 50)`).ok, 'plafond : racheter 50 puts écrits libère 50 contrats');
}

// --- Bogue 75 -------------------------------------------------------------------------------------------------
async function bug75(eng){
  ok(eng.json(`openOptionStrategy(B, C, 'bullSpread', 'buy', P*0.9, P*1.1, 12, 2)`).ok, '75 : Carl ouvre un bull spread au lancer 0');
  const sid = eng.run('C.optionPositions[0].strategyId');
  for(const [label, setupCode] of [['marché fermé (lancer 1)', 'state.gameClock.rollCount = 1'], ['partie terminée', "state.gameClock.rollCount = 3; state.gameEndedReason = 'test'"]]){
    eng.run(setupCode + '; alerts.length = 0;');
    const log0 = eng.run('state.log.length'), t0 = eng.cashTotal();
    await eng.run(`closeOptionStrategyFromUi(${JSON.stringify(sid)})`);
    const s = eng.json(`({log: state.log.length, legs: C.optionPositions.filter(p=>p.strategyId===${JSON.stringify(sid)} && p.shares===2).length, alert: alerts[0]||''})`);
    ok(s.log === log0, `75 : ${label} — aucune ligne au journal (avant : « Carl clôture sa stratégie (0.0000 contrat) »)`);
    ok(s.legs === 2 && near(eng.cashTotal(), t0), `75 : ${label} — les 2 jambes restent ouvertes, monnaie inchangée`);
    ok(/marché est fermé|partie est terminée/.test(s.alert), `75 : ${label} — refus clair : ${s.alert}`);
  }
}

(async () => {
  await scenario('A. Bogue 38 — option simple jamais fusionnée dans une jambe de stratégie', async () => { await bug38(await setup()); });
  await scenario('B. Bogue 38 — contre-épreuve (fusion d’avant)', async () => {
    let failed = null;
    try{ await bug38(await setup(ANCIEN_FUSION)); }catch(e){ failed = e.message; }
    ok(failed && /38 :/.test(failed), `contre-épreuve : l’ancienne recherche échoue (${failed})`);
  });
  await scenario('C. Décision — plafond de 15 % des parts par joueur pour les options écrites', async () => { await plafond(await setup()); });
  await scenario('D. Décision — contre-épreuve (sans plafond)', async () => {
    let failed = null;
    try{ await plafond(await setup(SANS_PLAFOND_ECRIT)); }catch(e){ failed = e.message; }
    ok(failed && /plafond :/.test(failed), `contre-épreuve : sans plafond, le test échoue (${failed})`);
  });
  await scenario('E. Bogue 75 — « Fermer la stratégie » marché fermé ou partie terminée : refus, aucun journal', async () => { await bug75(await setup()); });
  await scenario('F. Bogue 75 — contre-épreuve (closeOptionStrategy d’avant la section 307)', async () => {
    let failed = null;
    try{ await bug75(await setup(ANCIEN_FERMER)); }catch(e){ failed = e.message; }
    ok(failed && /75 :/.test(failed), `contre-épreuve : l’ancienne clôture annonce un faux succès (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 314 (options — bogues 38, 75 et plafond des options écrites) — ${n} vérifications, 0 scénario(s) en échec`);
})();
