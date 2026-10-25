// Test — Section 313 : fenêtre « Assurer plusieurs cases » (bogues 14, 15, 40 et 49), avec les VRAIS gestionnaires de
// clics d'index.html (mini-DOM du banc, tests/helpers/fake-dom.js), appareils en mode local.
//
// F1 (bogue 15) : franchise affichée 1,9 ; le joueur tape 0 et clique aussitôt « Confirmer » (sur mobile, le champ
//     n'est pas quitté : la franchise n'est pas encore enregistrée). Avant : contrat signé à la franchise et à la
//     prime de l'ancienne valeur, alors que l'écran montrait 0. Désormais : nouvelle confirmation avec la franchise 0
//     et la prime à jour, puis contrat à ces conditions.
// F2 (bogue 49) : la fenêtre est ouverte en case 37 (prime sous-standard pour 1/36) ; un autre appareil déplace le pion
//     en case 32 (6/36). Avant : contrat signé à l'ancienne prime. Désormais : « Les conditions ont changé », prime à
//     jour, 2e confirmation.
// F3 : conditions inchangées : signature directe, sans fenêtre supplémentaire.
// F4 (bogue 14) : franchise −5 saisie : refusée, la fenêtre revient à la franchise enregistrée.
// F5 (bogue 40) : types d'assurance désactivés : absents du menu « Terme », bouton masqué s'il n'y a rien à signer.
// Lancer depuis la racine du dépôt :  node tests/section313-fenetre.test.js
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
const P = "state.properties.find(p=>p.id==='p21')";   // relu à chaque fois (l'état est remplacé à chaque valeur reçue)

// --- Appareils en mode local (window.storage partagé pour « game:* »), comme tests/section308-retouches.test.js ----
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
  D.sonder = async () => { for(const f of [...intervals.values()]) if(/storageGet\('game:'/.test(String(f))) await f(); };
  D.minuteries = async () => { for(let i = 0; i < 50 && timeouts.length; i++){ const t = timeouts.shift(); await t.f(); } };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.ancien = () => eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;');          // « plus de 500 ms plus tard »
  D.cliquer = async sel => { D.ancien(); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.fenetre = () => doc.trouver('modalHost').innerHTML;
  D.cocher = async sel => { const el = doc.trouver(sel); el.checked = true; await doc.fire(el, 'change'); };
  return D;
}
// Partie à deux (Alice sur l'appareil A) : Bob possède Bleu foncé 2 (case 39, loyer 0,5), Alice en case 30.
async function partie(opts = {}){
  const shared = new Map();
  const A = appareil(shared, opts);
  const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  A.run(`const P = state.properties.find(p=>p.name==='Bleu foncé 2'); P.owners = [{companyId:state.companies[1].id, share:100}]; P.houses = 0; P.mortgages = [];
    state.companies[0].position = 30; state.companies[0].cash = 50; state.gameClock.rollCount = ${opts.roll || 0};`);
  if(opts.setup) A.run(opts.setup);
  await A.run('saveGame({silent:true})');
  A.run(`myPlayerId = ${ESC(ids[0])}`);
  A.run('closeModal(); render()'); await A.calme();
  A.alerts.length = 0;
  return { shared, A, ids, code: A.run('gameCode') };
}
// Index de la ligne d'une case dans la fenêtre (même ordre que insurableItems / subInsurableItems).
const ligne = (A, term, type, id) => A.run(`(${term === 'sub' ? 'subInsurableItems(myCompany().id)' : `insurableItems(myCompany().id, 'recurring', ${term === 'semester' ? 'rollsUntilSemesterEnd()' : 'rollsUntilYearEnd()'})`}).findIndex(x=>x.type===${ESC(type)} && x.id===${ESC(id)})`);

const CLIC_DIRECT = "  if(!sameConditions(shown, fresh)){ openFresh(); return {ok:false, code:'stale-conditions', shown:true}; }";

(async () => {
  await scenario('F1. Franchise 1,9 affichée, 0 tapé puis « Confirmer » aussitôt (bogue 15)', async () => {
    const { A } = await partie({ setup: 'state.companies[0].currentDeductible = 1.9;' });
    A.run('modalInsureBundle()'); await A.calme();
    const idx = ligne(A, 'year', 'tax', 4);
    ok(idx >= 0 && /Impôt sur le revenu/.test(A.fenetre()), 'la fenêtre propose l’Impôt sur le revenu (franchise 1,9 : 0,1 à risque)');
    const prime19 = A.run(`taxInsuranceQuote(4, myCompany().id, 'recurring', rollsUntilYearEnd(), 1.9).ceil`);
    const prime0 = A.run(`taxInsuranceQuote(4, myCompany().id, 'recurring', rollsUntilYearEnd(), 0).ceil`);
    await A.cocher(`.bundle-check[data-idx="${idx}"]`);
    A.doc.trouver('mDeductibleGlobal').value = '0';             // tapé, champ pas encore quitté (pas de « change »)
    const cash0 = A.run('myCompany().cash'), m0 = A.eng.cashTotal();
    await A.cliquer('#mOk');
    const t1 = A.json('state.taxInsurances');
    console.log(`    prime affichée ${f4(prime19)} (franchise 1,9) ; prime à franchise 0 : ${f4(prime0)} ; contrats après le 1er clic : ${t1.length}`);
    ok(t1.length === 0 && near(A.run('myCompany().cash'), cash0), '1er clic : rien n’est signé (avant : contrat à franchise 1,9 alors que l’écran montrait 0)');
    ok(/Les conditions ont changé/.test(A.fenetre()) && A.fenetre().includes(A.run(`fmt(${prime0})`)), 'nouvelle confirmation : prime à jour pour la franchise 0 affichée');
    await A.cliquer('#mOk');
    const t = A.json('state.taxInsurances');
    ok(t.length === 1 && t[0].deductible === 0 && near(t[0].premium, prime0), `2e clic : contrat à franchise 0 au prix ${f4(prime0)} (et non ${f4(prime19)})`);
    ok(near(t[0].coveredAmount, 2), 'montant couvert enregistré : 2 (impôt plafonné à 2, franchise 0)');
    ok(near(A.run('myCompany().cash'), cash0 - prime0) && near(A.eng.cashTotal(), m0), 'prime payée = prime confirmée ; monnaie conservée');
    ok(A.run('myCompany().currentDeductible') === 0, 'la franchise confirmée devient celle du tour');
    ok(!A.doc.trouver('mOk'), 'la fenêtre est fermée');
  });

  await scenario('F1b. Contre-épreuve : ancien « Confirmer » (primes de l’ouverture, franchise enregistrée)', async () => {
    const ANCIEN_OK = s => s.replace('    return confirmInsuranceBundle(myCo.id, keys, claimMode, term, deductible, shown);',
      "    return runModalActionWithRetry(()=>purchaseInsuranceBundle(keys.map(k=>{ const it = items.find(x=>x.type===k.type && x.id===k.id); return {item:it, insurerId:'BANK', premium:it.q.ceil}; }), claimMode, term, {silent:true}));");
    const { A } = await partie({ setup: 'state.companies[0].currentDeductible = 1.9;', transform: ANCIEN_OK });
    A.run('modalInsureBundle()'); await A.calme();
    await A.cocher(`.bundle-check[data-idx="${ligne(A, 'year', 'tax', 4)}"]`);
    A.doc.trouver('mDeductibleGlobal').value = '0';
    await A.cliquer('#mOk');
    const t = A.json('state.taxInsurances');
    ok(t.length === 1 && t[0].deductible === 1.9, `contre-épreuve : contrat signé au 1er clic à la franchise 1,9 (prime ${f4(t[0] && t[0].premium)}) alors que l’écran montrait 0`);
  });

  await scenario('F2. Pion déplacé par un autre appareil pendant la fenêtre sous-standard (bogue 49)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const { shared, A, ids, code } = await partie({ roll: 1, setup: 'state.companies[0].position = 37;', transform: variante === 'ancien' ? (s => s.replace(CLIC_DIRECT, '')) : undefined });
      A.run('modalInsureBundle()'); await A.calme();
      const idx = ligne(A, 'sub', 'prop', 'p21');
      const prime37 = A.run(`subInsuranceQuote(${P}, myCompany().id).ceil`);
      await A.cocher(`.bundle-check[data-idx="${idx}"]`);
      // Appareil de Bob : déplace le pion d'Alice (comme un lancer) et enregistre.
      const B = appareil(shared);
      await B.run(`loadGame(${ESC(code)})`); B.run(`myPlayerId = ${ESC(ids[1])}; closeModal();`); await B.calme();
      await B.run(`attemptActionWithRetry(async ()=>{ state.companies[0].position = 32; return {ok:true}; }, {label:'lancer simulé'})`);
      await A.sonder(); await A.calme();
      ok(A.run('state.companies[0].position') === 32 && !!A.doc.trouver('mOk'), `[${variante}] position reçue (case 32), fenêtre toujours ouverte`);
      const prime32 = A.run(`subInsuranceQuote(${P}, myCompany().id).ceil`);
      await A.cliquer('#mOk');
      const signe1 = A.json(`${P}.subInsurance`);
      console.log(`    [${variante}] prime affichée ${f4(prime37)} (case 37), à jour ${f4(prime32)} (case 32) ; après le 1er clic : ${signe1 ? 'signé à ' + f4(signe1.premium) : 'rien signé'}`);
      if(variante === 'corrigé'){
        ok(!signe1 && /Les conditions ont changé/.test(A.fenetre()) && A.fenetre().includes(A.run(`fmt(${prime32})`)), '1er clic : rien signé, nouvelle confirmation à la prime à jour');
        await A.cliquer('#mOk');
        const s = A.json(`${P}.subInsurance`);
        ok(s && near(s.premium, prime32) && near(s.premium, 6 * prime37), `2e clic : contrat à ${f4(prime32)} (6/36) et non ${f4(prime37)} (1/36)`);
      } else {
        ok(!!signe1 && near(signe1.premium, prime32) && !/Les conditions ont changé/.test(A.fenetre()), 'contre-épreuve : sans la comparaison au clic, contrat signé sans 2e confirmation');
      }
    }
  });

  await scenario('F3. Conditions inchangées : signature directe', async () => {
    const { A } = await partie();
    A.run('modalInsureBundle()'); await A.calme();
    const idx = ligne(A, 'year', 'prop', 'p21');
    const prime = A.run(`insuranceQuote(${P}, myCompany().id, 'recurring', rollsUntilYearEnd()).ceil`);
    await A.cocher(`.bundle-check[data-idx="${idx}"]`);
    await A.cliquer('#mOk');
    const ins = A.json(`${P}.insurance`);
    ok(ins && near(ins.premium, prime) && near(ins.coveredAmount, 0.5), `contrat signé au 1er clic (prime ${f4(prime)}, couvert 0,5)`);
    ok(!/Les conditions ont changé/.test(A.fenetre()), 'aucune fenêtre supplémentaire');
  });

  await scenario('F4. Franchise −5 saisie (bogue 14)', async () => {
    const { A } = await partie();
    A.run('modalInsureBundle()'); await A.calme();
    const el = A.doc.trouver('mDeductibleGlobal');
    el.value = '-5';
    await A.doc.fire(el, 'change'); await A.calme();
    ok(A.run('myCompany().currentDeductible') === 0, 'la franchise du tour reste à 0');
    ok(A.alerts.some(m => /positif ou nul/.test(m)), `message : « ${A.alerts[A.alerts.length - 1]} »`);
    ok(A.doc.trouver('mDeductibleGlobal').value === '0', 'la fenêtre revient à la franchise enregistrée (0)');
    ok(/min="0"/.test(A.fenetre()), 'le champ porte min="0"');
    // Le même −5 tapé puis « Confirmer » sans quitter le champ : refusé aussi.
    const idx = ligne(A, 'year', 'prop', 'p21');
    await A.cocher(`.bundle-check[data-idx="${idx}"]`);
    A.doc.trouver('mDeductibleGlobal').value = '-5';
    A.alerts.length = 0;
    await A.cliquer('#mOk');
    ok(!A.json(`${P}.insurance`) && A.alerts.some(m => /positif ou nul/.test(m)), '« Confirmer » avec −5 : refusé, rien signé');
  });

  await scenario('F5. Types d’assurance désactivés par le créateur (bogue 40)', async () => {
    let T = await partie({ setup: 'state.settings.features.subInsurance = false;' });
    T.A.run('modalInsureBundle()'); await T.A.calme();
    let html = T.A.fenetre();
    ok(/value="year"/.test(html) && !/value="sub"/.test(html), 'sous-standard désactivée : absente du menu « Terme »');
    T = await partie({ setup: 'state.settings.features.insurance = false;' });
    T.A.run('modalInsureBundle()'); await T.A.calme();
    html = T.A.fenetre();
    ok(!/value="year"/.test(html) && !/value="semester"/.test(html) && /value="sub" selected/.test(html), 'assurance normale désactivée : seul le sous-standard est proposé (et choisi)');
    T = await partie({ roll: 1, setup: 'state.settings.features.subInsurance = false;' });
    T.A.run(`activeTab = 'entreprise'; render()`); await T.A.calme();
    ok(!T.A.doc.trouver('openInsureBundleBtn'), 'lancer 1, sous-standard désactivée : pas de bouton « Contrat d’assurance »');
    T.A.run('modalInsureBundle()'); await T.A.calme();
    ok(!T.A.doc.trouver('mOk') && T.A.alerts.some(m => /Aucune assurance n’est signable/.test(m)), 'la fenêtre ne s’ouvre pas (message)');
    T = await partie({ roll: 1, setup: 'state.activeTab = "entreprise";' });
    T.A.run(`activeTab = 'entreprise'; render()`); await T.A.calme();
    ok(!!T.A.doc.trouver('openInsureBundleBtn'), 'témoin : sous-standard activée, le bouton est là');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 313 (fenêtre d’assurance) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
