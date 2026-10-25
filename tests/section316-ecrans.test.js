// Test — Section 316 : écrans de fin de partie et consultation (bogues 55, 56, 76 et 100 de l'audit du 2026-10-19),
// avec les VRAIS gestionnaires de clics d'index.html (mini-DOM du banc, tests/helpers/fake-dom.js), mode local.
//
// E1 (bogue 100) : après « consulter quand même » puis « quitter la partie », la partie suivante terminée sur le même
//     appareil n'affichait jamais son écran de classement final.
// E2 (bogue 76) : un joueur sans entreprise ne voyait, en consultation, que l'écran de fondation (et pouvait fonder).
// E3 (bogue 56) : la fenêtre « Annoncer un dividende » fonctionnait après la fin : l'argent était immobilisé à jamais.
// E4 (bogue 55) : l'onglet « Devenir l'assureur » proposait encore la reprise des contrats de la banque.
// E5 : la consultation fonctionne (tous les onglets se dessinent) ; l'en-tête dit « consultation seulement » ; les
//     ajustements d'encaisse de l'administrateur (liste blanche) restent possibles après la fin.
//
// Lancer depuis la racine du dépôt :  node tests/section316-ecrans.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
const ESC = s => JSON.stringify(s);

// --- Contre-épreuves -------------------------------------------------------------------------------------------------
const SANS_GARDE_UNIQUE = src => src.replace("      if(state && state.gameEndedReason && !allowAfterGameEnd) return gameEndedActionResult(label); // Section 316", '');
const CONSULTATION_PERSISTANTE = src => src.replace(/\r?\n  __gameEndedReviewMode = false; \/\/ Section 316 — bogue 100[^\r\n]*/g, '');
const PORTE_DE_FONDATION = src => src.replace('  if(me && !me.companyId && !state.gameEndedReason){ renderCompanySetupGate(me); return; }', '  if(me && !me.companyId){ renderCompanySetupGate(me); return; }');
const BOUTON_REPRISE = src => src.replace("    const canTakeOver = myCoId!==p.insurance.insuredCompanyId && !state.gameEndedReason;", "    const canTakeOver = myCoId!==p.insurance.insuredCompanyId;");
// Retouche de la revue : contre-épreuves des lignes taxe et sous-standard.
const BOUTON_REPRISE_TAXE = src => src.replace("    const canTakeOver = myCoId!==t.insuredCompanyId && !state.gameEndedReason;", "    const canTakeOver = myCoId!==t.insuredCompanyId;");
const BOUTON_REPRISE_SOUS = src => src.replace("    const canTakeOver = myCoId!==p.subInsurance.insuredCompanyId && !state.gameEndedReason;", "    const canTakeOver = myCoId!==p.subInsurance.insuredCompanyId;");

// --- Appareil en mode local (window.storage), comme tests/section313-fenetre.test.js --------------------------------
function documentDeTest(){
  const doc = creerDocument();
  const proto = Object.getPrototypeOf(doc.body.__cible);
  const fire = (el, type) => {
    const evt = { type, target: el, preventDefault(){}, stopPropagation(){} };
    return Promise.all(el.__cible._ecouteurs.filter(l => l.type === type).map(l => Promise.resolve(l.fn.call(el, evt))));
  };
  proto.dispatchEvent = function(evt){ fire(this.__proxy, evt.type); return true; };
  doc.fire = fire;
  return doc;
}
function appareil(shared, opts = {}){
  const local = new Map();
  const doc = documentDeTest();
  const timeouts = [], intervals = new Map(); let nextId = 1;
  const storage = {
    get: async k => { const m = k.startsWith('game:') ? shared : local; return m.has(k) ? { value: m.get(k) } : null; },
    set: async (k, v) => { (k.startsWith('game:') ? shared : local).set(k, v); return true; },
    delete: async k => { (k.startsWith('game:') ? shared : local).delete(k); return true; },
  };
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: {
    document: doc, storage, alert: m => alerts.push(String(m)),
    setTimeout: (f, ms) => { timeouts.push({ f, ms: Number(ms) || 0 }); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } },
  } });
  const D = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c) };
  D.minuteries = async () => { for(let i = 0; i < 50 && timeouts.length; i++){ const t = timeouts.shift(); await t.f(); } };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.ancien = () => eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;');          // « plus de 500 ms plus tard »
  D.cliquer = async sel => { D.ancien(); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.app = () => doc.trouver('app').innerHTML;
  D.fenetre = () => doc.trouver('modalHost').innerHTML;
  D.ecranFinal = () => /id="gameEndedReview"/.test(D.app());
  return D;
}
// Partie à trois (Alice, créatrice, sur l'appareil) : Co Alice, Co Bob, Carl sans entreprise. Fin de partie au lancer 9
// (cours de Co Bob à 0), enregistrée comme par un autre appareil.
async function partie(opts = {}){
  const shared = opts.shared || new Map();
  const A = opts.appareil || appareil(shared, opts);
  const ids = await A.eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', null]);
  await A.run(`attemptActionWithRetry(async ()=>{ state.companies.forEach(c=>{ c.cash = 20; c.position = 10; }); state.gameClock.rollCount = 9; ${opts.setup || ''} return {ok:true}; })`);
  A.run(`myPlayerId = ${ESC(ids[0])}`);
  A.run('closeModal(); render()'); await A.calme();
  A.alerts.length = 0;
  return { shared, A, ids, code: A.run('gameCode') };
}
async function terminer(A){
  const r = await A.run(`attemptActionWithRetry(async ()=>{ const b = state.companies.find(c=>c.name==='Co Bob'); state.gameEndedReason = {reason:'stockFloor', companyId:b.id, companyName:b.name, roll:state.gameClock.rollCount}; return {ok:true}; })`);
  if(!r.ok) throw new Error('Mise en place : fin de partie non enregistrée');
  A.run('closeModal(); render()'); await A.calme();
  A.alerts.length = 0;
}
const serveur = T => JSON.parse(T.shared.get('game:' + T.code));

(async () => {
  // ------------------------------------------------------------------------------------------------- Bogue 100
  await scenario('E1. Consulter, quitter, puis une nouvelle partie se termine : son écran final s’affiche (bogue 100)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const shared = new Map();
      const A = appareil(shared, variante === 'ancien' ? { transform: CONSULTATION_PERSISTANTE } : {});
      const T1 = await partie({ shared, appareil: A });
      await terminer(A);
      const final1 = A.ecranFinal();
      await A.cliquer('#gameEndedReview');
      const consult = !A.ecranFinal() && /consultation seulement/.test(A.app());
      await A.run('performQuitGame()'); await A.calme();
      const T2 = await partie({ shared, appareil: A });
      await terminer(A);
      const final2 = A.ecranFinal();
      console.log(`    [${variante}] partie 1 (${T1.code}) : écran final ${final1}, consultation ${consult} ; partie 2 (${T2.code}) terminée : écran final ${final2}`);
      ok(final1 && consult, 'E1 : partie 1 terminée : écran final, puis consultation des onglets');
      if(variante === 'corrigé') ok(final2, 'E1 : la partie 2 terminée affiche son classement final');
      else ok(!final2, 'E1 : contre-épreuve — l’ancien code garde le mode consultation : pas d’écran final pour la partie 2');
    }
    // Rejoindre une autre partie terminée (loadGame) remet aussi l'écran final en premier.
    const shared = new Map();
    const A = appareil(shared);
    const T1 = await partie({ shared, appareil: A });
    await terminer(A);
    const T2 = await partie({ shared, appareil: A });
    await terminer(A);
    await A.cliquer('#gameEndedReview');
    await A.run(`loadGame(${ESC(T1.code)})`); A.run(`myPlayerId = ${ESC(T1.ids[0])}; render()`); await A.calme();
    ok(A.ecranFinal(), `E1 : rejoindre la partie terminée ${T1.code} après avoir consulté ${T2.code} : écran final d’abord`);
  });

  // ------------------------------------------------------------------------------------------------- Bogue 76
  await scenario('E2. Joueur sans entreprise : il consulte les onglets et ne peut plus fonder (bogue 76)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: PORTE_DE_FONDATION } : {});
      const { A } = T;
      await terminer(A);
      A.run(`myPlayerId = ${ESC(T.ids[2])}; render()`); await A.calme();
      ok(A.ecranFinal(), `E2 [${variante}] : Carl voit d’abord le classement final`);
      await A.cliquer('#gameEndedReview');
      const fondation = /fondez votre entreprise/.test(A.app());
      console.log(`    [${variante}] consultation de Carl : écran de fondation ${fondation} ; onglets ${ESC(A.json('visibleTabs()'))}`);
      if(variante === 'corrigé'){
        ok(!fondation && /Portefeuille/.test(A.app()), 'E2 : Carl consulte les onglets (Portefeuille…), pas l’écran de fondation');
        const dessines = [];
        for(const t of A.json('visibleTabs()')){ A.run(`activeTab = ${ESC(t)}; render()`); await A.calme(); if(A.app().length > 200 && !/fondez votre entreprise/.test(A.app())) dessines.push(t); }
        ok(dessines.length === A.json('visibleTabs()').length, `E2 : chaque onglet de Carl se dessine (${ESC(dessines)})`);
        const avant = T.shared.get('game:' + T.code);
        await A.run(`createCompany(${ESC(T.ids[2])}, 'Gamma tardive', '', 'garp', null, null, null)`);
        ok(T.shared.get('game:' + T.code) === avant && /partie est terminée/.test(A.alerts.join(' ')), 'E2 : fonder « Gamma tardive » est refusé, rien n’est enregistré');
      } else {
        ok(fondation, 'E2 : contre-épreuve — l’ancien code ne montre à Carl que l’écran de fondation');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------- Bogue 56
  await scenario('E3. Fenêtre « Annoncer un dividende » après la fin : refusée, l’argent reste (bogue 56)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie(variante === 'ancien' ? { transform: SANS_GARDE_UNIQUE } : {});
      const { A } = T;
      await terminer(A);
      await A.cliquer('#gameEndedReview');
      A.run("activeTab = 'entreprise'; render()"); await A.calme();
      A.run('modalAnnounceDividend()'); await A.calme();
      A.doc.trouver('mDividendAmount').value = '5';
      await A.cliquer('#mOk');
      const S = serveur(T);
      const coA = S.companies.find(c => c.name === 'Co Alice');
      console.log(`    [${variante}] Co Alice ${f4(coA.cash)} ; annonces ${S.dividendAnnouncements.length} ; alertes ${ESC(A.alerts)}`);
      if(variante === 'corrigé'){
        ok(near(coA.cash, 20) && S.dividendAnnouncements.length === 0, 'E3 : annonce refusée, Co Alice garde ses 20 M$');
        ok(A.alerts.length === 1 && /partie est terminée/.test(A.alerts[0]), 'E3 : message « La partie est terminée »');
      } else {
        ok(near(coA.cash, 15) && S.dividendAnnouncements.length === 1, 'E3 : contre-épreuve — l’ancien code immobilise 5 M$ qui ne seront jamais versés');
      }
    }
  });

  // ------------------------------------------------------------------------------------------------- Bogue 55
  await scenario('E4. « Devenir l’assureur » après la fin : plus de bouton de reprise, et le clic est refusé (bogue 55)', async () => {
    const CONTRAT = `const a = state.companies.find(c=>c.name==='Co Alice'); a.position = 30;
      const p = state.properties.find(p=>p.name==='Bleu foncé 2'); p.owners = [{companyId:state.companies.find(c=>c.name==='Co Bob').id, share:100}];
      p.insurance = {insurerId:'BANK', insuredCompanyId:a.id, claimMode:'recurring', deductible:0, quotedTerm:'year', coveredAmount:0.5, premium:0.2};`;
    for(const variante of ['corrigé', 'ancien']){
      const T = await partie({ setup: CONTRAT, transform: variante === 'ancien' ? BOUTON_REPRISE : undefined });
      const { A } = T;
      A.run(`myPlayerId = ${ESC(T.ids[1])}; activeTab = 'assureur'; render()`); await A.calme();
      const avantFin = !!A.doc.trouver('[data-takeover-live-prop]');
      await terminer(A);
      await A.cliquer('#gameEndedReview');
      A.run("activeTab = 'assureur'; render()"); await A.calme();
      const bouton = !!A.doc.trouver('[data-takeover-live-prop]');
      console.log(`    [${variante}] bouton « Devenir l’assureur » : avant la fin ${avantFin}, après ${bouton}`);
      ok(avantFin, `E4 [${variante}] : avant la fin, Bob peut reprendre le contrat banque de Co Alice`);
      if(variante === 'corrigé') ok(!bouton, 'E4 : après la fin, plus de bouton « Devenir l’assureur »');
      else {
        ok(bouton, 'E4 : contre-épreuve — l’ancien rendu garde le bouton');
        // Même avec le bouton, la garde unique refuse le clic.
        const b0 = serveur(T).companies.find(c => c.name === 'Co Bob').cash;
        await A.cliquer('[data-takeover-live-prop]');
        const S = serveur(T);
        ok(near(S.companies.find(c => c.name === 'Co Bob').cash, b0) && S.properties.find(p => p.name === 'Bleu foncé 2').insurance.insurerId === 'BANK' && /partie est terminée/.test(A.alerts.join(' ')), 'E4 : le clic sur l’ancien bouton est refusé par la garde unique (Co Bob inchangée, banque assureur)');
      }
    }
  });

  await scenario('E4b. « Devenir l’assureur » après la fin : lignes taxe et sous-standard (retouche de la revue)', async () => {
    const CONTRATS = `const a = state.companies.find(c=>c.name==='Co Alice'); a.position = 30;
      const p = state.properties.find(p=>p.name==='Bleu foncé 2'); p.owners = [{companyId:state.companies.find(c=>c.name==='Co Bob').id, share:100}];
      state.taxInsurances.push({taxPos:4, insuredCompanyId:a.id, insurerId:'BANK', claimMode:'recurring', deductible:0, quotedTerm:'year', coveredAmount:2, premium:0.3});
      p.subInsurance = {insurerId:'BANK', insuredCompanyId:a.id, deductible:0, coveredAmount:0.5, premium:0.1};`;
    const boutons = A => ({ taxe: !!A.doc.trouver('[data-takeover-live-tax]'), sous: !!A.doc.trouver('[data-takeover-live-sub]') });
    for(const [variante, transform] of [['corrigé', undefined], ['ancienne ligne taxe', BOUTON_REPRISE_TAXE], ['ancienne ligne sous-standard', BOUTON_REPRISE_SOUS]]){
      const T = await partie({ setup: CONTRATS, transform });
      const { A } = T;
      A.run(`myPlayerId = ${ESC(T.ids[1])}; activeTab = 'assureur'; render()`); await A.calme();
      const avant = boutons(A);
      await terminer(A);
      await A.cliquer('#gameEndedReview');
      A.run("activeTab = 'assureur'; render()"); await A.calme();
      const apres = boutons(A);
      console.log(`    [${variante}] boutons avant la fin ${ESC(avant)}, après ${ESC(apres)}`);
      ok(avant.taxe && avant.sous, `E4b [${variante}] : avant la fin, Bob peut reprendre les contrats banque taxe et sous-standard`);
      if(variante === 'corrigé') ok(!apres.taxe && !apres.sous, 'E4b : après la fin, plus de bouton de reprise sur les lignes taxe et sous-standard');
      else if(variante === 'ancienne ligne taxe') ok(apres.taxe && !apres.sous, 'E4b : contre-épreuve — l’ancienne ligne taxe garde son bouton après la fin');
      else ok(apres.sous && !apres.taxe, 'E4b : contre-épreuve — l’ancienne ligne sous-standard garde son bouton après la fin');
    }
  });

  // ------------------------------------------------------------------------------------------------- Consultation
  await scenario('E5. Consultation : tous les onglets se dessinent, en-tête « consultation seulement », ajustement de l’administrateur permis', async () => {
    const T = await partie();
    const { A } = T;
    await terminer(A);
    ok(A.ecranFinal() && /Classement final/.test(A.app()), 'E5 : écran de classement final');
    await A.cliquer('#gameEndedReview');
    const onglets = A.json('visibleTabs()');
    const vus = [];
    for(const t of onglets){
      A.run(`activeTab = ${ESC(t)}; render()`); await A.calme();
      if(A.app().length > 200 && !A.ecranFinal()) vus.push(t);
    }
    console.log(`    onglets d’Alice : ${ESC(onglets)} ; dessinés : ${ESC(vus)}`);
    ok(onglets.length >= 4 && vus.length === onglets.length, 'E5 : chaque onglet d’Alice (CEO, administratrice) se dessine en consultation');
    ok(/consultation seulement, aucune action n’est enregistrée/.test(A.app()), 'E5 : l’en-tête signale « consultation seulement »');
    // Ajustement d'encaisse (administration) : correction d'arbitre permise après la fin.
    const coA = A.run("state.companies.find(c=>c.name==='Co Alice').id");
    const m0 = A.eng.cashTotal();
    A.run(`modalAdjustCompany(${ESC(coA)})`); await A.calme();
    A.doc.trouver('mAmount').value = '2';
    A.doc.trouver('mReason').value = 'correction de fin de partie';
    await A.cliquer('#mOk');
    const S = serveur(T);
    ok(near(S.companies.find(c => c.name === 'Co Alice').cash, 22) && S.log.some(l => /correction de fin de partie/.test(l.text || '')), 'E5 : ajustement de +2 enregistré et journalisé (Co Alice 20 → 22)');
    ok(near(A.eng.cashTotal(), m0), 'E5 : monnaie conservée (la banque verse les 2)');
    // Une autre action de l'onglet Administration (fenêtre de transactions) reste refusée.
    const avant = T.shared.get('game:' + T.code);
    A.run("activeTab = 'admin'; render()"); await A.calme();
    A.alerts.length = 0;
    ok(!!A.doc.trouver('#toggleStock'), 'mise en place : bouton « fenêtre de transactions » présent dans l’onglet Administration');
    await A.cliquer('#toggleStock');
    ok(T.shared.get('game:' + T.code) === avant && /partie est terminée/.test(A.alerts.join(' ')), 'E5 : basculer la fenêtre de transactions est refusé après la fin (rien d’enregistré, message clair)');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 316 (écrans de fin de partie) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
