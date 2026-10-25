// Section 314 — bogues 11, 31 et 37 de l'audit du 2026-10-19 : découverts, marge et encaisse négative.
//   Bogue 11 : un montant non fini (« 1e309 » = Infinity) dans « Vendre à découvert » ou dans un ordre en attente
//              n'était pas refusé en tant que tel ; un nombre de parts infini devient null à la sauvegarde (la dette
//              disparaissait au rechargement). La section 307 (marge initiale) arrêtait déjà le découvert par accident ;
//              les ordres en attente (bid/ask) acceptaient encore Infinity. Désormais tout montant non fini est refusé.
//   Bogue 31 : marge d'un CEO dont l'entreprise a un prêt garanti : la garantie était retirée deux fois (avec les parts
//              de CEO, déjà exclues, puis de la valeur nette), d'où un appel de marge à tort. Comptée une fois.
//   Bogue 37 : une encaisse PERSONNELLE négative ne bloquait pas « Tour Terminé » au semestre. Elle le bloque, comme
//              l'encaisse de l'entreprise (règle de Julien), revérifiée dans l'applyFn (refus sans sauvegarde).
//   Retouches de la revue : un résidu d'arrondi (≈ −1e-17) laissé par un paiement financé par les bons ne bloque plus
//              « Tour Terminé » (résidu prélevé sur les bons, gardes tolérantes à 1e-9) ; un montant de découvert
//              démesuré est refusé avec un libellé lisible ; contre-épreuve de la garde sur le nombre de parts.
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section314-marge.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Ancien code (contre-épreuves).
const ANCIEN_FINI = src => src
  .replace("  if(!Number.isFinite(amount)) return {ok:false, error:'Montant invalide : saisissez un nombre fini.'};\n  if(player.id===company.ceoId)", '  if(player.id===company.ceoId)')
  .split("  if(!Number.isFinite(price) || !Number.isFinite(qty)) return {ok:false, error:'Prix limite ou quantité invalide : saisissez des nombres finis.'};").join('');
const ANCIEN_MARGE = src => src.replace('    total += secured.ceoDeductionByCompanyId[co.id]||0; // Section 314 — bogue 31\n', '');
const ANCIEN_PRET = src => src
  .replace(/    if\(ceoPlayer && \(ceoPlayer\.cash\|\|0\)<-1e-9 && tradingWindowOpen\(\)\) return [^\n]*\n/, '')
  .replace('const blockReadyForNegativeCash = (company.cash<-1e-9 || ceoCashNegativeForReady) && tradingWindowOpen();', 'const blockReadyForNegativeCash = company.cash<0 && tradingWindowOpen();');
const SANS_GARDE_PARTS = src => src.replace(/  if\(!Number\.isFinite\(qty\)\) return \{ok:false, error:'Montant invalide : le nombre[^\n]*\n/, '');
const SANS_DEMESURE = src => src.replace(/  if\(amount>SHORT_AMOUNT_ABSURD_MAX\) return [^\n]*\n/, '');
// Retouche de la revue : sans prélèvement du résidu sur les bons, ou avec les comparaisons strictes d'avant.
const SANS_RESIDU = src => src.replace(/function absorbCashRoundingResidueWithBonds\(player\)\{[\s\S]*?\n\}\n/,
  'function absorbCashRoundingResidueWithBonds(player){}\n');
const STRICT = src => src
  .replace('(ceoPlayerForReady.cash||0)<-1e-9', '(ceoPlayerForReady.cash||0)<0')
  .replace('(company.cash<-1e-9 || ceoCashNegativeForReady)', '(company.cash<0 || ceoCashNegativeForReady)')
  .replace('if(co.cash<-1e-9 && tradingWindowOpen())', 'if(co.cash<0 && tradingWindowOpen())')
  .replace('(ceoPlayer.cash||0)<-1e-9 && tradingWindowOpen()', '(ceoPlayer.cash||0)<0 && tradingWindowOpen()');

async function setup(transform){
  const eng = loadEngine(transform ? { transform } : {});
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  eng.run(`globalThis.ALICE = state.players[0]; globalThis.BOB = state.players[1]; globalThis.C = state.players[2];
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    state.gameClock.rollCount = 0; injectStockCube = function(){ return 0; };
    globalThis.alerts = []; alert = m => alerts.push(String(m));
    // Nombres non finis n'importe où dans l'état (ils deviennent null à la sauvegarde JSON).
    globalThis.nonFinis = function(){ const out = []; (function walk(v, path){
      if(typeof v === 'number'){ if(!Number.isFinite(v)) out.push(path); return; }
      if(v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], path + '.' + k)); })(state, 'state'); return out; };`);
  return eng;
}

// --- Bogue 11 -------------------------------------------------------------------------------------------------
async function bug11(eng){
  const t0 = eng.cashTotal();
  const price = eng.run('B.stockPrice');
  for(const amt of ['Infinity', 'parseFloat("1e309")']){
    const r = eng.json(`openShortPosition(B, C, ${amt})`);
    ok(!r.ok && /Montant invalide/.test(r.error), `11 : découvert de ${amt} M$ refusé comme montant invalide (et non « marge initiale insuffisante pour Infinity M$ ») — ${r.error}`);
  }
  for(const amt of ['1e305', '1e300']){
    const r2 = eng.json(`openShortPosition(B, C, ${amt})`);
    ok(!r2.ok && /Montant démesuré/.test(r2.error) && !/e\+/.test(r2.error), `11 : découvert de ${amt} M$ refusé avec un libellé lisible, sans « 1e+300 » — ${r2.error}`);
  }
  // Garde sur le nombre de parts : un cours infime (1e-306 M$) rend le nombre de parts infini pour un montant fini.
  const p0 = eng.run('B.stockPrice');
  eng.run('B.stockPrice = 1e-306');
  const r3 = eng.json(`openShortPosition(B, C, 1000)`);
  eng.run(`B.stockPrice = ${p0}`);
  ok(!r3.ok && /nombre de parts correspondant n’est pas un nombre fini/.test(r3.error), `11 : 1 000 M$ à 1e-306 M$/part (parts infinies) refusé par la garde sur le nombre de parts — ${r3.error}`);
  ok(eng.json(`!C.shortPositions || !C.shortPositions[B.id]`) && near(eng.run('C.cash'), 50), '11 : aucun découvert ouvert, encaisse de Carl intacte (50 M$)');
  const bidInf = eng.json(`placeBid(C, B, ${price}, Infinity)`), bidPx = eng.json(`placeBid(C, B, Infinity, 10)`);
  ok(!bidInf.ok && !bidPx.ok, `11 : bid d’une quantité infinie ou à prix limite infini refusé (${bidInf.error})`);
  eng.run(`B.shareholders.push({playerId:C.id, shares:1000})`);
  const askInf = eng.json(`placeAsk(C, B, Infinity, 10)`);
  ok(!askInf.ok, `11 : ask à prix limite infini refusé (${askInf.error})`);
  ok(eng.json(`(C.pendingBids||[]).length + (C.pendingAsks||[]).length`) === 0, '11 : aucun ordre fantôme enregistré');
  const nf = eng.json('nonFinis()');
  ok(nf.length === 0, `11 : aucun nombre non fini dans l’état (${nf.join(', ') || 'aucun'})`);
  const closeInf = eng.json(`closeShortPosition(B, C, Infinity)`);
  ok(!closeInf.ok, '11 : rachat d’un montant infini refusé');
  ok(near(eng.cashTotal(), t0), '11 : monnaie conservée');
  // Un montant fini raisonnable reste accepté.
  ok(eng.json(`openShortPosition(B, C, 10)`).ok && near(eng.run('C.cash'), 60), '11 : découvert normal de 10 M$ toujours accepté (encaisse 60 M$)');
}

// --- Bogue 31 -------------------------------------------------------------------------------------------------
// Alice : CEO de Co Alice (60 000 parts à 100 $ = 6 M$). Encaisse ramenée à 10 M$, puis découvert de 20 M$ sur Co Bob :
// encaisse 30, découvert 20 → valeur nette admissible (hors parts de CEO) 10, marge exigée 30 % × 20 = 6, marge
// disponible 4. Prêt garanti de Bob à Co Alice : 5 M$ à 2× (10 M$ dus) → garantie = min(6, 10) = 6 M$.
async function bug31(eng){
  eng.run(`ALICE.cash = 10; myPlayerId = ALICE.id;`);
  ok(eng.json('openShortPosition(B, ALICE, 20)').ok, '31 : Alice vend Co Bob à découvert pour 20 M$');
  const sans = eng.json('({nw: marginableNetWorth(ALICE), req: requiredMaintenanceMargin(ALICE), net: netWorth(ALICE)})');
  ok(near(sans.nw, 10) && near(sans.req, 6), `31 : sans prêt — valeur nette admissible ${f4(sans.nw)}, marge exigée ${f4(sans.req)}, marge disponible ${f4(sans.nw - sans.req)}`);
  eng.run(`state.loans.push({id:'L-g', lenderId:BOB.id, lenderKind:'player', borrowerId:A.id, principal:5, totalDue:10, repaidSoFar:0, withholdingPct:0.2, multiple:2, secured:true});`);
  const avec = eng.json('({nw: marginableNetWorth(ALICE), req: requiredMaintenanceMargin(ALICE), net: netWorth(ALICE), ded: securedLoanGuaranteeInfo().ceoDeductionByCompanyId[A.id]})');
  console.log(`    avec prêt garanti : garantie ${f4(avec.ded)}, valeur nette (classement) ${f4(sans.net)} → ${f4(avec.net)}, admissible ${f4(avec.nw)}`);
  ok(near(avec.ded, 6) && near(avec.net, sans.net - 6), '31 : la valeur nette du classement baisse de la garantie (6 M$), comme avant');
  ok(near(avec.nw, 10), `31 : valeur nette admissible inchangée à 10 M$ (parts de CEO déjà exclues, garantie comptée une fois ; avant : 4) — obtenu ${f4(avec.nw)}`);
  const html = eng.run('renderPortefeuille()');
  const m = /Marge disponible<\/td><td[^>]*>([^<(]*)/.exec(html);
  ok(m && /4\.00 M\$/.test(m[1]), `31 : l’affichage « Marge disponible » montre 4.00 M$ (avant : −2.00 M$) — obtenu « ${m ? m[1].trim() : '—'} »`);
  const t0 = eng.cashTotal();
  eng.run('enforceMarginCalls()');
  ok(near(eng.json(`(ALICE.shortPositions[B.id]||{shares:0}).shares`) * eng.run('B.stockPrice'), 20, 1e-9), '31 : aucun appel de marge à tort — le découvert de 20 M$ reste ouvert');
  ok(near(eng.cashTotal(), t0), '31 : monnaie conservée');
  // La garantie reste plafonnée par la valeur des parts : sans parts de CEO, rien n'est rendu.
  eng.run(`B.stockPrice = B.stockPrice * 1.5;`);
  const req2 = eng.run('requiredMaintenanceMargin(ALICE)'), nw2 = eng.run('marginableNetWorth(ALICE)');
  ok(near(nw2, 30 - 30) && near(req2, 9), `31 : si Co Bob monte de 50 %, admissible ${f4(nw2)} < exigée ${f4(req2)} : l’appel de marge reste dû`);
}

// --- Bogue 37 -------------------------------------------------------------------------------------------------
async function bug37(eng){
  eng.run(`myPlayerId = ALICE.id; ALICE.cash = -456; A.cash = 20;`);
  const v0 = eng.run('state.version');
  ok(!/data-mark-ready=/.test(eng.run('renderEntreprise()')), '37 : semestre, encaisse personnelle −456 M$ → bouton « Tour Terminé » absent');
  ok(/Votre encaisse personnelle est négative/.test(eng.run('renderEntreprise()')), '37 : un bandeau explique le blocage');
  const r = await eng.run(`markCompanyReady(A.id, 0)`);
  const s = eng.json('({ready: A.ready, alert: alerts[alerts.length-1] || "", v: state.version})');
  ok(r && !r.ok && !s.ready, '37 : « Tour Terminé » refusé (Co Alice pas prête)');
  ok(/encaisse personnelle ≥ 0\$/.test(s.alert) && /retirez des bons/.test(s.alert) && /empruntez en bons/.test(s.alert) && /vendez des actions/.test(s.alert), `37 : message clair, avec les moyens de remonter à 0 (retrait de bons, emprunt en bons, vente) — ${s.alert}`);
  ok(s.v === v0, '37 : refus sans sauvegarde (version inchangée)');
  // Encaisse redevenue positive : accepté.
  eng.run(`ALICE.cash = 0`);
  ok(/data-mark-ready=/.test(eng.run('renderEntreprise()')), '37 : encaisse personnelle 0 → bouton présent');
  const r2 = await eng.run(`markCompanyReady(A.id, 0)`);
  ok(r2 && r2.ok && eng.run('A.ready') === true, '37 : encaisse personnelle 0 → « Tour Terminé » accepté');
  // Hors semestre (tour normal), on ferme les yeux : accepté même à −456 M$.
  eng.run(`A.ready = false; state.gameClock.rollCount = 1; ALICE.cash = -456;`);
  const r3 = await eng.run(`markCompanyReady(A.id, 1)`);
  ok(r3 && r3.ok && eng.run('A.ready') === true, '37 : hors semestre, encaisse personnelle −456 M$ → accepté (règle des semestres seulement)');
}

// --- Retouche de la revue : résidu d'arrondi après un paiement financé par les bons --------------------------------
async function residu(eng){
  eng.run(`injectTradingCube = function(){ return 0; };`);
  const price = eng.run('B.stockPrice');
  // Scénario de la revue : encaisse −0,3, bons 100, bid de 0,37 M$.
  eng.run(`ALICE.cash = -0.3; ALICE.bondBalance = 100; ALICE.pendingBids = [];`);
  const t0 = eng.cashTotal();
  eng.run(`placeBid(ALICE, B, ${price}, ${0.37 / price}); checkPendingOrders(B);`);
  const s = eng.json('({cash: ALICE.cash, bonds: ALICE.bondBalance, bids: ALICE.pendingBids.length})');
  ok(s.bids === 0 && s.cash >= 0 && near(s.cash, 0, 1e-12), `résidu : encaisse −0,3, bons 100, bid 0,37 → bid exécuté, encaisse ${s.cash} (jamais sous 0)`);
  ok(near(s.bonds, 100 - 0.67, 1e-9) && near(eng.cashTotal(), t0, 1e-9), `résidu : bons ${f4(s.bonds)} (0,67 vendus), monnaie conservée`);
  eng.run(`myPlayerId = ALICE.id; A.cash = 20; A.ready = false; state.gameClock.rollCount = 12;`);
  ok(/data-mark-ready=/.test(eng.run('renderEntreprise()')) && !/Votre encaisse personnelle est négative/.test(eng.run('renderEntreprise()')), 'résidu : au semestre, bouton « Tour Terminé » présent, aucun bandeau « −0 K$ »');
  const r = await eng.run('markCompanyReady(A.id, 12)');
  ok(r && r.ok && eng.run('A.ready') === true, 'résidu : « Tour Terminé » accepté');
  // Balayage de la sonde de la revue : 1 000 bids (encaisse −0,1 à −4, montants 0,37 à 9,25) → jamais d'encaisse < 0.
  let neg = 0;
  for(let i = 1; i <= 40; i++) for(let j = 1; j <= 25; j++){
    eng.run(`ALICE.cash = ${-i / 10}; ALICE.bondBalance = 100; ALICE.pendingBids = []; placeBid(ALICE, B, ${price}, ${j * 0.37 / price}); checkPendingOrders(B);`);
    if(eng.run('ALICE.cash') < 0) neg++;
  }
  ok(neg === 0, `résidu : 1 000 bids payés par les bons depuis une encaisse négative → ${neg} encaisse(s) < 0 (avant : 133)`);
  // Fermetures forcées (appel de marge) payées par les bons : même garantie.
  let negForce = 0;
  for(let i = 1; i <= 20; i++) for(let j = 1; j <= 10; j++){
    eng.run(`C.shortPositions = {}; C.optionPositions = []; C.cash = 50; C.bondBalance = 0;
      openShortPosition(B, C, ${j * 0.37}); C.cash = ${-i / 10}; C.bondBalance = 100; closeShortPosition(B, C, Number.MAX_SAFE_INTEGER, true);`);
    if(eng.run('C.cash') < 0) negForce++;
  }
  ok(negForce === 0, `résidu : 200 rachats forcés de découvert payés par les bons → ${negForce} encaisse(s) < 0`);
}
async function tolerance(eng){
  eng.run(`myPlayerId = ALICE.id; A.cash = 20; A.ready = false; state.gameClock.rollCount = 12; ALICE.cash = -1e-17;`);
  ok(/data-mark-ready=/.test(eng.run('renderEntreprise()')), 'tolérance : encaisse personnelle −1e-17 → bouton présent');
  let r = await eng.run('markCompanyReady(A.id, 12)');
  ok(r && r.ok, 'tolérance : encaisse personnelle −1e-17 → « Tour Terminé » accepté');
  eng.run(`A.ready = false; ALICE.cash = 0; A.cash = -1e-17;`);
  ok(/data-mark-ready=/.test(eng.run('renderEntreprise()')) && !/Encaisse négative/.test(eng.run('renderEntreprise()')), 'tolérance : encaisse de l’entreprise −1e-17 → bouton présent, pas de bandeau');
  r = await eng.run('markCompanyReady(A.id, 12)');
  ok(r && r.ok, 'tolérance : encaisse de l’entreprise −1e-17 → « Tour Terminé » accepté');
  eng.run(`A.ready = false; A.cash = 20; ALICE.cash = -0.001;`);
  r = await eng.run('markCompanyReady(A.id, 12)');
  ok(r && !r.ok, 'tolérance : une vraie dette (−1 K$) reste bloquante');
}

(async () => {
  await scenario('A. Bogue 11 — montants non finis refusés, aucun Infinity dans l’état', async () => { await bug11(await setup()); });
  await scenario('B. Bogue 11 — contre-épreuve (gardes de finitude retirées)', async () => {
    let failed = null;
    try{ await bug11(await setup(ANCIEN_FINI)); }catch(e){ failed = e.message; }
    ok(failed && /11 :/.test(failed), `contre-épreuve : l’ancien code échoue (${failed})`);
  });
  await scenario('C. Bogue 31 — garantie d’un prêt garanti comptée une fois dans la marge du CEO', async () => { await bug31(await setup()); });
  await scenario('D. Bogue 31 — contre-épreuve (garantie retirée deux fois)', async () => {
    let failed = null;
    try{ await bug31(await setup(ANCIEN_MARGE)); }catch(e){ failed = e.message; }
    ok(failed && /31 :/.test(failed), `contre-épreuve : l’ancien calcul échoue (${failed})`);
  });
  await scenario('E. Bogue 37 — encaisse personnelle négative : « Tour Terminé » bloqué au semestre', async () => { await bug37(await setup()); });
  await scenario('F. Bogue 37 — contre-épreuve (seule l’encaisse de l’entreprise vérifiée)', async () => {
    let failed = null;
    try{ await bug37(await setup(ANCIEN_PRET)); }catch(e){ failed = e.message; }
    ok(failed && /37 :/.test(failed), `contre-épreuve : l’ancien code échoue (${failed})`);
  });
  await scenario('H. Bogue 11 — contre-épreuve (garde sur le nombre de parts retirée)', async () => {
    let failed = null;
    try{ await bug11(await setup(SANS_GARDE_PARTS)); }catch(e){ failed = e.message; }
    ok(failed && /garde sur le nombre de parts/.test(failed), `contre-épreuve : sans la garde, le refus n’est plus le bon (${failed})`);
  });
  await scenario('I. Bogue 11 — contre-épreuve (montant démesuré non refusé : libellé « 1e+300 M$ »)', async () => {
    let failed = null;
    try{ await bug11(await setup(SANS_DEMESURE)); }catch(e){ failed = e.message; }
    ok(failed && /libellé lisible/.test(failed), `contre-épreuve : l’ancien libellé échoue (${failed})`);
  });
  await scenario('J. Retouche — résidu d’arrondi après un paiement par les bons : encaisse jamais sous 0', async () => { await residu(await setup()); });
  await scenario('K. Retouche — contre-épreuve (résidu non prélevé, comparaisons strictes)', async () => {
    let failed = null;
    try{ await residu(await setup(src => STRICT(SANS_RESIDU(src)))); }catch(e){ failed = e.message; }
    ok(failed && /résidu :/.test(failed), `contre-épreuve : l’encaisse finit sous 0 et bloque le tour (${failed})`);
  });
  await scenario('L. Retouche — gardes de « Tour Terminé » tolérantes à l’arrondi', async () => { await tolerance(await setup()); });
  await scenario('M. Retouche — contre-épreuve (comparaisons strictes)', async () => {
    let failed = null;
    try{ await tolerance(await setup(STRICT)); }catch(e){ failed = e.message; }
    ok(failed && /tolérance :/.test(failed), `contre-épreuve : −1e-17 bloque le tour (${failed})`);
  });
  await scenario('G. Bogue 37 — contre-épreuve (garde du moteur seule retirée : le bouton caché ne suffit pas)', async () => {
    let failed = null;
    try{ await bug37(await setup(src => src.replace(/    if\(ceoPlayer && \(ceoPlayer\.cash\|\|0\)<-1e-9 && tradingWindowOpen\(\)\) return [^\n]*\n/, ''))); }catch(e){ failed = e.message; }
    ok(failed && /37 : « Tour Terminé » refusé/.test(failed), `contre-épreuve : sans la garde de l’applyFn, l’action passe (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\nOK : section 314 (découverts, marge, encaisse négative — bogues 11, 31, 37) — ${n} vérifications, 0 scénario(s) en échec`);
})();
