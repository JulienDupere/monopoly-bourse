// Section 312 — prêts : bogues 23, 24 et 47 de l'audit du 2026-10-19.
//   Bogue 23 : dans une partie sans l'option « Prêts », le prêt de dernier recours (10 M$ de la banque) n'était jamais
//              remboursé : la retenue de 50 % des loyers dépendait de l'option. Décision : le prêt de dernier recours
//              reste offert (il ne relève pas de l'option « Prêts », qui concerne le marché des obligations entre
//              joueurs et entreprises) et il est TOUJOURS remboursé par sa retenue, sur les quatre chemins du loyer.
//   Bogue 24 : quand le prêteur modifiait son offre (même identifiant), la fenêtre déjà ouverte chez le CEO montrait
//              encore les anciennes conditions et « Accepter » signait les nouvelles. Désormais « Accepter » ouvre une
//              confirmation (confirmWithFreshConditions) qui part des conditions affichées sur la ligne : si l'offre a
//              changé, rien n'est signé, la fenêtre montre les nouvelles conditions et redemande confirmation ;
//              acceptLoanOffer revérifie les conditions confirmées sur l'état frais (staleConditionsResult).
//   Bogue 47 : le prêt saisi par l'administrateur (arbitrage) n'appliquait pas les bornes affichées par le formulaire
//              (5 à 40 %, 1 à 2,5×) : 0 % = prêt jamais remboursé, % négatif = plafond de retenue contourné, multiple
//              négatif = capital perdu. Le moteur (issueLoan) applique désormais les bornes des réglages de la partie et
//              refuse toute valeur nulle, négative ou non numérique.
// Chaque correctif a sa contre-épreuve (ancien code réintroduit par loadEngine({transform}) : le test échoue).
// Lancer depuis la racine du dépôt :  node tests/section312-prets.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { partie } = require('./helpers/appareils-312');
const ESC = x => JSON.stringify(x);

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));

// Ancien code du bogue 23 : retenue des loyers conditionnée à l'option « Prêts », dernier recours compris.
const ANCIEN_23 = src => {
  const out = src.replace(/applyRentLoanWithholding\(([^;]*?)\)(?=;|\s*:)/g, (m, args) => `(state.settings.features.loan ? applyLoanWithholding(${args}) : {net:${args.split(',')[1].trim()}, totalWithheld:0, withholdings:[]})`);
  return out;
};
// Retouche de la revue : contre-épreuve chemin par chemin. Ancien code réintroduit sur les seuls appels d'indices
// donnés, dans l'ordre du source : 0-1 ABS (loyer d'une entreprise), 2 compensation, 3 loyer ordinaire,
// 4-5 ABS (pion neutre), 6 pion neutre ordinaire.
const ANCIEN_23_SUR = indices => src => {
  let i = -1;
  return src.replace(/applyRentLoanWithholding\(([^;]*?)\)(?=;|\s*:)/g, (m, args) => (++i, indices.includes(i)
    ? `(state.settings.features.loan ? applyLoanWithholding(${args}) : {net:${args.split(',')[1].trim()}, totalWithheld:0, withholdings:[]})` : m));
};

// Partie à deux, option « Prêts » DÉCOCHÉE. Alpha (A) possède seule Bleu foncé 2 avec 2 maisons (loyer 6 M$) ; Beta (B) y tombe.
async function setup(transform, names = ['Alice', 'Bob']){
  const eng = loadEngine(transform ? { transform } : {});
  const ids = await eng.newGame(names, ['garp', 'garp']);
  eng.run(`globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    state.settings.features.loan = false; state.rentCompensations = []; state.revenueSwaps = [];
    state.neutralPawns.push({id:'pion-test', name:'Pion test', position:0, inJail:false, jailTurnsLeft:0});
    globalThis.P = state.properties.find(p=>p.name==='Bleu foncé 2');
    P.owners = [{companyId:A.id, share:100}]; P.houses = 2; P.mortgages = []; P.insurance = null; P.subInsurance = null;
    B.cash += 100;`);
  return { eng, ids };
}
const snap = eng => eng.json(`({A: A.cash, B: B.cash, bank: state.bank.cash, repaid: (state.loans.find(l=>l.lastResort)||{}).repaidSoFar||0})`);

async function bug23(eng, variantLabel){
  const RENT = eng.run('colorRentAt(P, P.houses)');
  // 1. Prêt de dernier recours dans une partie sans « Prêts ».
  eng.run('A.cash = -1');
  const t0 = eng.cashTotal();
  const res = eng.json('triggerLastResortLoan(A.id)');
  ok(res && res.ok && near(eng.run('A.cash'), 9) && near(eng.cashTotal(), t0), '23 : sans l’option « Prêts », le prêt de dernier recours reste offert : Alpha passe de −1 à 9 M$, monnaie conservée');
  const loan = eng.json('state.loans.find(l=>l.lastResort)');
  ok(loan && near(loan.totalDue, 20) && near(loan.withholdingPct, 0.5), '23 : prêt de 10 M$ à rembourser 20 M$ par une retenue de 50 % des loyers');
  // 2. Loyer ordinaire payé par Beta.
  let s0 = snap(eng), m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  let s1 = snap(eng);
  console.log(`    [${variantLabel}] loyer ${f4(RENT)} payé par Beta : Alpha +${f4(s1.A - s0.A)}, banque +${f4(s1.bank - s0.bank)}, remboursé ${f4(s1.repaid)}`);
  ok(near(s1.B - s0.B, -RENT) && near(s1.A - s0.A, RENT / 2) && near(s1.bank - s0.bank, RENT / 2) && near(s1.repaid, RENT / 2),
    `23 : loyer de ${RENT} M$ payé par Beta : ${RENT / 2} retenus pour la banque, ${RENT / 2} pour Alpha (avant : ${RENT} pour Alpha, rien retenu)`);
  ok(near(eng.cashTotal(), m0), '23 : loyer ordinaire — monnaie conservée');
  // 3. Loyer d'un pion neutre (payé par la banque).
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run(`settleNeutralPawnRent(P, 'pion-test', 7, {skipSave:true})`);
  s1 = snap(eng);
  ok(near(s1.A - s0.A, RENT / 2) && near(s1.bank - s0.bank, -RENT / 2) && near(s1.repaid - s0.repaid, RENT / 2) && near(eng.cashTotal(), m0),
    `23 : pion neutre : la banque verse ${RENT}, en récupère ${RENT / 2} par la retenue ; Alpha reçoit ${RENT / 2} ; monnaie conservée`);
  // 4. Terrain titrisé (ABS sans porteur : rien n'est versé aux porteurs) — chemins jumeaux des deux fonctions.
  eng.run(`state.revenueSwaps = [{id:'abs-test', sellerId:A.id, propertyIds:[P.id], cededPctOfShare:0.6, seniorCapTotal:0, seniorPaidSoFar:0, seniorRaised:0, seniorHolders:[], juniorHolders:[]}]`);
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  await eng.run(`settleNeutralPawnRent(P, 'pion-test', 7, {skipSave:true})`);
  s1 = snap(eng);
  ok(near(s1.repaid - s0.repaid, RENT) && near(s1.A - s0.A, RENT) && near(eng.cashTotal(), m0),
    `23 : terrain sous ABS (Beta puis pion) : ${RENT / 2} retenus à chaque loyer (${RENT} au total), monnaie conservée`);
  eng.run('state.revenueSwaps = []');
  // 5. Accord de compensation : la retenue part en argent, le reste est inscrit au registre.
  eng.run(`state.settings.features.rentCompensation = true; state.rentCompensations = [{id:'comp-test', companyA:B.id, companyB:A.id, balance:0, interestRate:0}]`);
  s0 = snap(eng); m0 = eng.cashTotal();
  await eng.run('settlePropertyRent(P, B.id, 7, {skipSave:true})');
  s1 = snap(eng);
  const bal = eng.run(`state.rentCompensations[0].balance`);
  ok(near(s1.repaid - s0.repaid, RENT / 2) && near(Math.abs(bal), RENT / 2) && near(s1.B - s0.B, -RENT / 2) && near(eng.cashTotal(), m0),
    `23 : accord de compensation : ${RENT / 2} versés en argent à la banque (retenue), ${RENT / 2} inscrits au registre ; monnaie conservée`);
  const repaid = eng.json('state.loans.find(l=>l.lastResort).repaidSoFar');
  ok(near(repaid, 2.5 * RENT), `23 : au total ${f4(repaid)} M$ remboursés sur 20 (5 retenues de la moitié d’un loyer de ${RENT} M$)`);
}

// Ancien code du bogue 47 : aucune borne sur le % ni sur le multiple dans issueLoan.
const ANCIEN_47 = src => src.replace('function loanTermsError(withholdingPct, multiple){', 'function loanTermsError(withholdingPct, multiple){ return null;');

async function bug47(eng){
  // Chloé (3e joueuse, sans entreprise) prête à Alpha ; réglages par défaut : 5 à 40 %, 1 à 2,5×.
  const CH = eng.run('state.players[2].id');
  const essai = async (pct, mult, principal = 3) => {
    const before = eng.json('({loans: state.loans.length, ch: state.players[2].cash, A: A.cash})'), m0 = eng.cashTotal();
    const r = await eng.run(`(async()=>{ const o = {silent:true}; const ok = await issueLoan(${JSON.stringify(CH)}, A.id, ${principal}, ${pct}, ${mult}, false, o); return JSON.stringify({ok, err:o.lastError||null}); })()`);
    const res = JSON.parse(r);
    const after = eng.json('({loans: state.loans.length, ch: state.players[2].cash, A: A.cash})');
    return { res, unchanged: after.loans === before.loans && near(after.ch, before.ch) && near(after.A, before.A), conserved: near(eng.cashTotal(), m0) };
  };
  const refus = [[0, 2, '0 %'], [-0.4, 2, '−40 %'], [0.04, 2, '4 % (< 5 %)'], [0.41, 2, '41 % (> 40 %)'], [NaN, 2, '% non numérique'],
    [0.2, 0, 'multiple 0'], [0.2, -1, 'multiple −1'], [0.2, 0.9, 'multiple 0,9 (< 1)'], [0.2, 2.6, 'multiple 2,6 (> 2,5)'], [0.2, NaN, 'multiple non numérique']];
  for(const [pct, mult, label] of refus){
    const e = await essai(pct, mult);
    ok(e.res.ok === false && e.unchanged && e.conserved && /entre/.test(e.res.err || ''), `47 : prêt d'arbitrage à ${label} refusé par le moteur, rien ne bouge (« ${(e.res.err || '').slice(0, 70)}… »)`);
  }
  const good = await essai(0.4, 2.5);
  const loan = eng.json('state.loans[state.loans.length-1]');
  ok(good.res.ok === true && good.conserved && near(loan.withholdingPct, 0.4) && near(loan.totalDue, 7.5), '47 : bornes incluses acceptées : 3 M$ à 40 % et 2,5× → 7,5 M$ à rembourser ; monnaie conservée');
  const low = await essai(0.05, 1, 0);
  ok(low.res.ok === false, '47 : capital nul toujours refusé');
  // Réglages personnalisés de la partie : les bornes suivent (10 à 20 %, 1,5 à 2×).
  eng.run('state.loans = state.loans.filter(l=>l.lenderId!==state.players[2].id); state.settings.loanOfferWithholdingPctMin = 0.1; state.settings.loanOfferWithholdingPctMax = 0.2; state.settings.loanOfferMultipleMin = 1.5; state.settings.loanOfferMultipleMax = 2;');
  ok((await essai(0.3, 1.8)).res.ok === false && (await essai(0.15, 2.2)).res.ok === false && (await essai(0.15, 1.8)).res.ok === true,
    '47 : réglages 10–20 % et 1,5–2× : 30 % refusé, 2,2× refusé, 15 % à 1,8× accepté');
}

// Ancien code du bogue 24 : « Accepter » signe directement l'offre courante, sans revérification des conditions vues.
const ANCIEN_24 = src => src
  .replace("b.addEventListener('click', ()=>modalAcceptLoanOffer(b.dataset.acceptLoanOffer, shownOfferConditions[b.dataset.acceptLoanOffer]))", "b.addEventListener('click', ()=>{ closeModal(); acceptLoanOffer(b.dataset.acceptLoanOffer); })")
  .replace('if(opts.expectedConditions && !sameConditions(opts.expectedConditions, loanOfferConditions(offerId))) return staleConditionsResult();', '');

async function bug24(variant, transform){
  const T = await partie({ transform });
  const { A, B, ids } = T;
  const BOB = `state.players.find(p=>p.id===${ESC(ids[1])})`;
  // Alice (Co Alice) publie une demande de 2 M$ ; Bob offre 5 % / 1× / non garanti.
  await A.run(`attemptActionWithRetry(async ()=>{ state.loanRequests.push({id:'req-1', borrowerId: myCompany().id, principal:2, createdAt:'t', createdAtRoll: state.gameClock.rollCount}); return {ok:true}; })`);
  await B.sonder();
  const r1 = await B.run(`submitLoanOffer('req-1', ${BOB}, 0.05, 1, false)`);
  ok(r1 && r1.ok, `24 [${variant}] : Bob offre 5 % / 1× / non garanti`);
  await A.sonder(); await A.calme();
  const offerId = A.run('state.loanOffers[0].id');
  A.run('modalIssueLoan()');
  const html1 = A.fenetre();
  ok(/<td>5%<\/td><td>1×<\/td><td>Non garantie<\/td>/.test(html1), `24 [${variant}] : la fenêtre d’Alice affiche 5 % / 1× / non garantie`);
  // Bob modifie son offre : 30 % / 2,5× / garantie (même identifiant).
  await B.sonder();
  const r2 = await B.run(`submitLoanOffer('req-1', ${BOB}, 0.3, 2.5, true)`);
  ok(r2 && r2.ok && B.run('state.loanOffers[0].id') === offerId, `24 [${variant}] : Bob met à jour son offre à 30 % / 2,5× / garantie, même identifiant`);
  await A.sonder(); await A.calme();
  ok(A.fenetre() === html1, `24 [${variant}] : la fenêtre d’Alice reste ouverte et inchangée (section 308)`);
  const T0 = A.eng.cashTotal();
  await A.cliquer(`[data-accept-loan-offer="${offerId}"]`);
  const loans1 = T.serveur().loans.filter(l=>l.lenderId===ids[1]);
  console.log(`    [${variant}] après le clic « Accepter » sur la ligne 5 % / 1× : ${loans1.length} prêt(s) enregistré(s)${loans1.length ? ` à ${loans1[0].withholdingPct*100} % / ${loans1[0].multiple}× / ${loans1[0].secured ? 'garanti' : 'non garanti'}` : ''}`);
  ok(loans1.length === 0, `24 [${variant}] : « Accepter » ne signe rien sans que le CEO ait vu les conditions (obtenu : ${loans1.length} prêt)`);
  const html2 = A.fenetre();
  ok(/5%/.test(html2) && /1×/.test(html2) && !/Les conditions ont changé/.test(html2), '24 : la confirmation reprend les conditions affichées sur la ligne (5 % / 1×)');
  await A.cliquer('mOk');
  const html3 = A.fenetre();
  ok(T.serveur().loans.length === 0 && /Les conditions ont changé/.test(html3) && /30%/.test(html3) && /2\.5×/.test(html3) && /GARANTI/.test(html3),
    '24 : à la confirmation, rien n’est signé ; la fenêtre montre 30 % / 2,5× / GARANTI et redemande confirmation');
  await A.cliquer('mOk');
  const S = T.serveur();
  const loan = S.loans.find(l=>l.lenderId===ids[1]);
  ok(loan && near(loan.withholdingPct, 0.3) && near(loan.multiple, 2.5) && loan.secured === true && near(loan.principal, 2) && A.fenetre() === '',
    '24 : 2e confirmation : prêt signé aux conditions vues la 2e fois (2 M$, 30 %, 2,5×, garanti) ; fenêtre fermée');
  ok(near(A.eng.cashTotal(), T0) && S.loanOffers.length === 0 && S.loanRequests.length === 0, '24 : monnaie conservée ; demande et offres retirées');
  // Course : l'offre change ENTRE la vérification de la fenêtre et l'enregistrement (sauvegarde concurrente).
  await A.run(`attemptActionWithRetry(async ()=>{ state.loanRequests.push({id:'req-2', borrowerId: myCompany().id, principal:1, createdAt:'t', createdAtRoll: state.gameClock.rollCount}); return {ok:true}; })`);
  await B.sonder();
  await B.run(`submitLoanOffer('req-2', ${BOB}, 0.05, 1, false)`);
  await A.sonder(); await A.calme();
  const offer2 = A.run(`state.loanOffers.find(o=>o.requestId==='req-2').id`);
  A.run('modalIssueLoan()');
  await A.cliquer(`[data-accept-loan-offer="${offer2}"]`);
  await B.sonder();
  await B.run(`submitLoanOffer('req-2', ${BOB}, 0.1, 2, false)`);
  A.run(`adoptLatestRemoteState = function(){ return false; }`);
  await A.cliquer('mOk');
  ok(T.serveur().loans.length === 1 && /Les conditions ont changé/.test(A.fenetre()) && /10%/.test(A.fenetre()) && A.alerts.length === 0,
    '24 : changement découvert à l’enregistrement (conflit) : rien n’est signé, nouvelles conditions (10 % / 2×) et 2e confirmation, sans alerte');
}

(async () => {
  await scenario('A. Bogue 23 — le prêt de dernier recours est remboursé même sans l’option « Prêts »', async () => {
    const { eng } = await setup();
    await bug23(eng, 'corrigé');
  });
  await scenario('B. Bogue 23 — contre-épreuve (retenue conditionnée à l’option)', async () => {
    const { eng } = await setup(ANCIEN_23);
    let failed = null;
    try{ await bug23(eng, 'ancien'); }catch(e){ failed = e.message; }
    ok(failed && /23 :/.test(failed), `contre-épreuve : l'ancien code échoue (${failed})`);
  });
  for(const [nom, indices, motif] of [['loyer ordinaire', [3], /23 : loyer de 6 M\$ payé par Beta/], ['pion neutre', [6], /23 : pion neutre/],
    ['ABS, loyer d’une entreprise', [0, 1], /23 : terrain sous ABS/], ['ABS, pion neutre', [4, 5], /23 : terrain sous ABS/], ['accord de compensation', [2], /23 : accord de compensation/]]){
    await scenario(`B. Bogue 23 — contre-épreuve sur le seul chemin « ${nom} »`, async () => {
      const { eng } = await setup(ANCIEN_23_SUR(indices));
      let failed = null;
      try{ await bug23(eng, 'ancien : ' + nom); }catch(e){ failed = e.message; }
      ok(failed && motif.test(failed), `contre-épreuve (${nom}) : l'ancien code sur ce seul chemin fait échouer sa vérification (${failed})`);
    });
  }
  await scenario('E. Bogue 24 — offre de prêt modifiée : nouvelle confirmation avant toute signature', async () => {
    await bug24('corrigé');
  });
  await scenario('F. Bogue 24 — contre-épreuve (« Accepter » signe l’offre courante)', async () => {
    let failed = null;
    try{ await bug24('ancien', ANCIEN_24); }catch(e){ failed = e.message; }
    ok(failed && /24 \[ancien\] : « Accepter » ne signe rien/.test(failed), `contre-épreuve : l'ancien code signe les conditions non vues (${failed})`);
  });
  await scenario('G. Bogue 24 — contre-épreuve (sans la revérification dans acceptLoanOffer)', async () => {
    let failed = null;
    try{ await bug24('sans garde', src => src.replace('if(opts.expectedConditions && !sameConditions(opts.expectedConditions, loanOfferConditions(offerId))) return staleConditionsResult();', '')); }catch(e){ failed = e.message; }
    ok(failed && /24 : changement découvert à l’enregistrement/.test(failed), `contre-épreuve : sans la garde de l'applyFn, la course signe les nouvelles conditions (${failed})`);
  });
  await scenario('C. Bogue 47 — prêt d’arbitrage : bornes appliquées par le moteur', async () => {
    const { eng } = await setup(undefined, ['Alice', 'Bob', 'Chloé']);
    await bug47(eng);
  });
  await scenario('D. Bogue 47 — contre-épreuve (aucune borne)', async () => {
    const { eng } = await setup(ANCIEN_47, ['Alice', 'Bob', 'Chloé']);
    let failed = null;
    try{ await bug47(eng); }catch(e){ failed = e.message; }
    ok(failed && /47 :/.test(failed), `contre-épreuve : sans les bornes, le test échoue (${failed})`);
  });
  if(failures.length){ console.log(`\n${failures.length} scénario(s) en échec :\n` + failures.join('\n')); process.exit(1); }
  console.log(`\n${n} vérifications, 0 échec`);
})();
