// Test — Section 319 (lot C, constat M2) : fenêtre « Assurer plusieurs cases », avec les VRAIS gestionnaires
// d'index.html (mini-DOM du banc) et l'ORDRE RÉEL d'un navigateur : taper une franchise puis cliquer un bouton émet
// « change » (au mousedown, quand le champ perd le focus) AVANT « click », sans rien attendre entre les deux.
//
// Avant : « change » lançait une action (setTurnDeductible) ; le clic sur « Confirmer la sélection » tombait sur la
// garde anti-double-envoi et était ignoré ; puis la fenêtre était redessinée et les cases cochées perdues.
// Désormais : rien n'est enregistré à la sortie du champ ; les primes sont recalculées sur place pour la franchise
// tapée ; la confirmation enregistre la franchise avec le contrat ; les cases cochées survivent à tout redessin.
//
// G1 : franchise tapée puis « Confirmer » aussitôt : contrat signé en UN clic, à la franchise tapée.
// G2 : franchise changée : cases gardées, primes et sous-total justes, rien d'écrit dans la partie.
// G3 : franchise qui fait disparaître puis revenir une ligne : les cases des lignes restantes sont gardées.
// G4 : mode d'indemnisation puis durée changés : cases et franchise tapée gardées, sous-total à jour.
// G5 : franchise négative : refusée, cases gardées ; franchise tapée puis « Annuler » : rien n'est enregistré.
// Contre-épreuves (G1b, G2b, G4b) : ancien code réintroduit par loadEngine({ transform }).
// Lancer depuis la racine du dépôt :  node tests/section319-assurance.test.js
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
const P = "state.properties.find(p=>p.id==='p21')";

// --- Appareil en mode local, comme tests/section313-fenetre.test.js ---------------------------------------------
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
  D.fenetre = () => doc.trouver('modalHost').innerHTML;
  D.cocher = async sel => { const el = doc.trouver(sel); el.checked = true; await doc.fire(el, 'change'); };
  // Saisie puis sortie du champ (ou choix dans une liste) : « change », attendu jusqu'au calme.
  D.changer = async (id, v) => { const el = doc.trouver(id); el.value = String(v); await doc.fire(el, 'change'); await D.calme(); };
  return D;
}
// Partie à deux (Alice sur l'appareil A) : Bob possède Bleu foncé 2 (case 39, loyer 0,5), Alice en case 30.
async function partie(opts = {}){
  const shared = new Map();
  const A = appareil(shared, opts);
  const ids = await A.eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  A.run(`const P = state.properties.find(p=>p.name==='Bleu foncé 2'); P.owners = [{companyId:state.companies[1].id, share:100}]; P.houses = 0; P.mortgages = [];
    state.companies[0].position = 30; state.companies[0].cash = 50; state.gameClock.rollCount = 0;`);
  if(opts.setup) A.run(opts.setup);
  await A.run('saveGame({silent:true})');
  A.run(`myPlayerId = ${ESC(ids[0])}`);
  A.run('closeModal(); render()'); await A.calme();
  A.alerts.length = 0;
  return { shared, A, ids, code: A.run('gameCode') };
}
// Lignes de la fenêtre pour un terme, un mode et une franchise donnés (même ordre que la fenêtre).
const ITEMS = (term, mode, ded) => term === 'sub' ? `subInsurableItems(myCompany().id, ${ded})` : `insurableItems(myCompany().id, ${ESC(mode)}, ${term === 'semester' ? 'rollsUntilSemesterEnd()' : 'rollsUntilYearEnd()'}, ${ded})`;
const ligne = (A, term, mode, ded, type, id) => A.run(`(${ITEMS(term, mode, ded)}).findIndex(x=>x.type===${ESC(type)} && x.id===${ESC(id)})`);
const prime = (A, term, mode, ded, type, id) => A.run(`((${ITEMS(term, mode, ded)}).find(x=>x.type===${ESC(type)} && x.id===${ESC(id)})||{q:{}}).q.ceil`);
const cochee = (A, idx) => { const el = idx >= 0 ? A.doc.trouver(`.bundle-check[data-idx="${idx}"]`) : null; return !!(el && el.checked); };
const primeAffichee = (A, idx) => A.doc.trouver(`.bundle-premium-value[data-idx="${idx}"]`).textContent;
const sousTotal = A => A.doc.trouver('bundleSubtotal').textContent;
const attendu = (A, nb, somme) => A.run(`\`Sous-total (${nb} case${nb > 1 ? 's' : ''} cochée${nb > 1 ? 's' : ''}): \${fmt(${somme})}\``);

// Contre-épreuves : ancien code réintroduit.
const NOUVEAU_CHANGE = "  if(mDedGlobalEl) mDedGlobalEl.addEventListener('change', ()=>{\n";
const ANCIEN_CHANGE = "  if(mDedGlobalEl) mDedGlobalEl.addEventListener('change', async ()=>{\n" +
  "    { const typed0 = parseFloat(mDedGlobalEl.value); const res = await setTurnDeductible(Number.isFinite(typed0) ? typed0 : 0);\n" +
  "      const stillHere = document.getElementById('mDeductibleGlobal')===mDedGlobalEl;\n" +
  "      if(!res.ok){ if(res.error) alert(res.error); if(stillHere) modalInsureBundle(claimMode, term, true); return; }\n" +
  "      if(stillHere) modalInsureBundle(claimMode, term, true); return; }\n";
const ancienChange = s => s.replace(NOUVEAU_CHANGE, ANCIEN_CHANGE);
const sansBrouillon = s => s.split(', true, bundleDraft()); }').join(', true); }');

// G1 : franchise 1,9 affichée ; Alice coche l'Impôt sur le revenu, tape 0 et clique « Confirmer » dans le même geste.
async function changePuisClic(transform){
  const { A } = await partie({ setup: 'state.companies[0].currentDeductible = 1.9;', transform });
  A.run('modalInsureBundle()'); await A.calme();
  const idx = ligne(A, 'year', 'recurring', 1.9, 'tax', 4);
  const prime19 = prime(A, 'year', 'recurring', 1.9, 'tax', 4), prime0 = prime(A, 'year', 'recurring', 0, 'tax', 4);
  await A.cocher(`.bundle-check[data-idx="${idx}"]`);
  const cash0 = A.run('myCompany().cash'), m0 = A.eng.cashTotal();
  A.ancien();                                                    // la fenêtre est ouverte depuis plus de 500 ms
  const ded = A.doc.trouver('mDeductibleGlobal'); ded.value = '0';
  const pChange = A.doc.fire(ded, 'change');                     // NON attendu : le clic suit dans le même geste
  const enVol = A.run('actionsInFlight');
  const r = A.doc.cliquer('#mOk');
  await r.promesse; await pChange; await A.calme();
  const idx0 = ligne(A, 'year', 'recurring', 0, 'tax', 4);
  return { A, prime19, prime0, cash0, m0, enVol, clic: r.clic, contrats: A.json('state.taxInsurances'), ouverte: !!A.doc.trouver('mOk'),
    changed: /Les conditions ont changé/.test(A.fenetre()), cochee: cochee(A, idx0) };
}

(async () => {
  await scenario('G1. Franchise tapée (1,9 → 0) puis « Confirmer la sélection » aussitôt : « change » puis « click »', async () => {
    const r = await changePuisClic();
    console.log(`    prime à franchise 1,9 : ${f4(r.prime19)} ; à franchise 0 : ${f4(r.prime0)} ; actions en vol entre « change » et « click » : ${r.enVol} ; clic : ${r.clic} ; contrats : ${r.contrats.length}`);
    ok(r.enVol === 0, 'aucune action n’est lancée par la sortie du champ de franchise');
    ok(r.clic === 'ok', 'le clic sur « Confirmer la sélection » n’est pas ignoré');
    ok(r.contrats.length === 1 && r.contrats[0].deductible === 0 && near(r.contrats[0].premium, r.prime0), `UN clic : contrat signé à la franchise tapée (0), prime ${f4(r.prime0)} et non ${f4(r.prime19)}`);
    ok(!r.changed && !r.ouverte, 'pas de fenêtre « Les conditions ont changé » ; la fenêtre est fermée');
    ok(near(r.A.run('myCompany().cash'), r.cash0 - r.prime0) && near(r.A.eng.cashTotal(), r.m0), 'prime payée = prime affichée ; monnaie conservée');
    ok(r.A.run('myCompany().currentDeductible') === 0, 'la franchise confirmée devient celle du tour (enregistrée avec le contrat)');
    ok(r.A.json('state.log').some(l => /Franchise de .* pour ce tour fixée à 0\.00/.test(JSON.stringify(l))), 'le journal note la franchise fixée à 0,00');
    ok(r.A.alerts.length === 0, 'aucun message d’erreur');
  });
  await scenario('G1b. Contre-épreuve : ancien « change » (action setTurnDeductible, puis redessin)', async () => {
    const r = await changePuisClic(ancienChange);
    console.log(`    actions en vol entre « change » et « click » : ${r.enVol} ; clic : ${r.clic} ; contrats : ${r.contrats.length} ; case encore cochée : ${r.cochee}`);
    ok(r.enVol === 1 && r.clic === 'bloqué', 'contre-épreuve : une action est en vol, le clic de confirmation est ignoré');
    ok(r.contrats.length === 0 && r.ouverte && !r.cochee, 'contre-épreuve : rien n’est signé et la case cochée est perdue (tout est à refaire)');
  });

  // G2 : mêmes lignes avant et après (franchise 0 → 0,1) : cases gardées, primes et sous-total recalculés.
  async function franchiseChangee(transform){
    const { shared, A, code } = await partie({ transform });
    A.run('modalInsureBundle()'); await A.calme();
    const iTax = ligne(A, 'year', 'recurring', 0, 'tax', 4), iProp = ligne(A, 'year', 'recurring', 0, 'prop', 'p21');
    await A.cocher(`.bundle-check[data-idx="${iTax}"]`); await A.cocher(`.bundle-check[data-idx="${iProp}"]`);
    const avant = shared.get('game:' + code);
    await A.changer('mDeductibleGlobal', '0.1');
    return { A, shared, code, avant, iTax, iProp };
  }
  await scenario('G2. Franchise changée (0 → 0,1) : cases gardées, primes et sous-total justes, rien d’enregistré', async () => {
    const { A, shared, code, avant, iTax, iProp } = await franchiseChangee();
    const pTax0 = prime(A, 'year', 'recurring', 0, 'tax', 4), pTax = prime(A, 'year', 'recurring', 0.1, 'tax', 4), pProp = prime(A, 'year', 'recurring', 0.1, 'prop', 'p21');
    console.log(`    Impôt sur le revenu : ${f4(pTax0)} → ${f4(pTax)} ; Bleu foncé 2 : ${f4(pProp)} ; ${sousTotal(A)}`);
    ok(ligne(A, 'year', 'recurring', 0.1, 'tax', 4) === iTax && ligne(A, 'year', 'recurring', 0.1, 'prop', 'p21') === iProp, 'témoin : mêmes lignes à la franchise 0,1');
    ok(cochee(A, iTax) && cochee(A, iProp), 'les deux cases cochées le sont toujours');
    ok(pTax < pTax0 && primeAffichee(A, iTax) === A.run(`fmt(${pTax})`) && primeAffichee(A, iProp) === A.run(`fmt(${pProp})`), 'les primes affichées sont celles de la franchise 0,1');
    ok(A.doc.trouver(`.bundle-label[data-idx="${iProp}"]`).innerHTML.includes(A.run('fmt(0.4)') + ' à risque'), `le montant « à risque » de Bleu foncé 2 suit (0,5 − 0,1 = ${A.run('fmt(0.4)')})`);
    ok(sousTotal(A) === attendu(A, 2, pTax + pProp), 'le sous-total suit : 2 cases, somme des primes à jour');
    ok(A.run('myCompany().currentDeductible') === 0 && shared.get('game:' + code) === avant && A.run('actionsInFlight') === 0, 'rien n’est écrit dans la partie tant que le contrat n’est pas confirmé');
    const cash0 = A.run('myCompany().cash'), m0 = A.eng.cashTotal();
    ok(await A.cliquer('#mOk') === 'ok' && !A.doc.trouver('mOk') && !/Les conditions ont changé/.test(A.fenetre()), '« Confirmer la sélection » : signé au 1er clic');
    const t = A.json('state.taxInsurances'), ins = A.json(`${P}.insurance`);
    ok(t.length === 1 && t[0].deductible === 0.1 && near(t[0].premium, pTax) && ins && ins.deductible === 0.1 && near(ins.premium, pProp), 'les deux cases sont assurées à la franchise 0,1 et aux primes affichées');
    ok(near(A.run('myCompany().cash'), cash0 - pTax - pProp) && near(A.eng.cashTotal(), m0) && A.run('myCompany().currentDeductible') === 0.1, 'prime payée = sous-total affiché ; monnaie conservée ; franchise du tour = 0,1');
  });
  await scenario('G2b. Contre-épreuve : ancien « change » → fenêtre redessinée, cases perdues', async () => {
    const { A, iTax, iProp } = await franchiseChangee(ancienChange);
    ok(!cochee(A, iTax) && !cochee(A, iProp) && sousTotal(A) === attendu(A, 0, 0), 'contre-épreuve : les deux cases sont décochées, sous-total à 0');
  });

  await scenario('G3. Franchise qui retire une ligne (0 → 1), puis la ramène (1 → 0)', async () => {
    const { A } = await partie();
    A.run('modalInsureBundle()'); await A.calme();
    await A.cocher(`.bundle-check[data-idx="${ligne(A, 'year', 'recurring', 0, 'tax', 4)}"]`);
    await A.cocher(`.bundle-check[data-idx="${ligne(A, 'year', 'recurring', 0, 'prop', 'p21')}"]`);
    await A.changer('mDeductibleGlobal', '1');
    const iTax1 = ligne(A, 'year', 'recurring', 1, 'tax', 4), pTax1 = prime(A, 'year', 'recurring', 1, 'tax', 4);
    ok(ligne(A, 'year', 'recurring', 1, 'prop', 'p21') === -1 && !/Bleu foncé 2/.test(A.doc.trouver('bundleRows').innerHTML), 'franchise 1 ≥ loyer 0,5 : la ligne Bleu foncé 2 disparaît');
    ok(iTax1 >= 0 && cochee(A, iTax1) && primeAffichee(A, iTax1) === A.run(`fmt(${pTax1})`), 'l’Impôt sur le revenu reste coché, à sa nouvelle prime');
    ok(sousTotal(A) === attendu(A, 1, pTax1), `le sous-total suit : 1 case (${sousTotal(A)})`);
    await A.changer('mDeductibleGlobal', '0');
    const iTax0 = ligne(A, 'year', 'recurring', 0, 'tax', 4), iProp0 = ligne(A, 'year', 'recurring', 0, 'prop', 'p21'), pTax0 = prime(A, 'year', 'recurring', 0, 'tax', 4);
    ok(cochee(A, iTax0) && !cochee(A, iProp0), 'franchise 0 : l’Impôt reste coché ; Bleu foncé 2 revient, non coché (sa ligne avait disparu)');
    ok(sousTotal(A) === attendu(A, 1, pTax0), 'le sous-total suit');
    await A.cocher(`.bundle-check[data-idx="${iProp0}"]`);
    ok(sousTotal(A) === attendu(A, 2, pTax0 + prime(A, 'year', 'recurring', 0, 'prop', 'p21')), 'cocher la ligne revenue met à jour le sous-total (case rebranchée)');
  });

  // G4 : redessins complets de la fenêtre (listes déroulantes).
  async function modePuisDuree(transform){
    const { A } = await partie({ transform });
    A.run('modalInsureBundle()'); await A.calme();
    await A.cocher(`.bundle-check[data-idx="${ligne(A, 'year', 'recurring', 0, 'tax', 4)}"]`);
    await A.cocher(`.bundle-check[data-idx="${ligne(A, 'year', 'recurring', 0, 'prop', 'p21')}"]`);
    await A.changer('mDeductibleGlobal', '0.1');
    await A.changer('mClaimMode', 'single');
    return { A };
  }
  await scenario('G4. Mode d’indemnisation, puis durée changés : cases et franchise tapée gardées', async () => {
    const { A } = await modePuisDuree();
    let iTax = ligne(A, 'year', 'single', 0.1, 'tax', 4), iProp = ligne(A, 'year', 'single', 0.1, 'prop', 'p21');
    let pTax = prime(A, 'year', 'single', 0.1, 'tax', 4), pProp = prime(A, 'year', 'single', 0.1, 'prop', 'p21');
    ok(/value="single" selected/.test(A.fenetre()), 'témoin : la fenêtre est redessinée en « Un seul sinistre par terrain »');
    ok(cochee(A, iTax) && cochee(A, iProp), 'mode changé : les deux cases restent cochées');
    ok(A.doc.trouver('mDeductibleGlobal').value === '0.1' && A.run('myCompany().currentDeductible') === 0, 'la franchise tapée (0,1) reste dans le champ, sans être enregistrée');
    ok(pTax < prime(A, 'year', 'recurring', 0.1, 'tax', 4) && primeAffichee(A, iTax) === A.run(`fmt(${pTax})`) && sousTotal(A) === attendu(A, 2, pTax + pProp), `primes du mode « un seul sinistre » à la franchise 0,1 ; ${sousTotal(A)}`);
    await A.changer('mTerm', 'semester');
    iTax = ligne(A, 'semester', 'single', 0.1, 'tax', 4); iProp = ligne(A, 'semester', 'single', 0.1, 'prop', 'p21');
    pTax = prime(A, 'semester', 'single', 0.1, 'tax', 4); pProp = prime(A, 'semester', 'single', 0.1, 'prop', 'p21');
    ok(/value="semester" selected/.test(A.fenetre()) && cochee(A, iTax) && cochee(A, iProp) && sousTotal(A) === attendu(A, 2, pTax + pProp), `durée « Semestre » : cases gardées ; ${sousTotal(A)}`);
    await A.changer('mTerm', 'sub');
    const iSub = ligne(A, 'sub', null, 0.1, 'prop', 'p21'), pSub = prime(A, 'sub', null, 0.1, 'prop', 'p21');
    ok(iSub >= 0 && cochee(A, iSub) && !/Impôt sur le revenu/.test(A.doc.trouver('bundleRows').innerHTML), 'durée « sous-standard » : Bleu foncé 2 reste coché ; la taxe (non assurable ainsi) n’est plus listée');
    ok(sousTotal(A) === attendu(A, 1, pSub) && A.doc.trouver('mDeductibleGlobal').value === '0.1', `sous-total : 1 case (${sousTotal(A)}) ; franchise tapée toujours là`);
    const cash0 = A.run('myCompany().cash'), m0 = A.eng.cashTotal();
    ok(await A.cliquer('#mOk') === 'ok' && !A.doc.trouver('mOk'), '« Confirmer la sélection » : signé au 1er clic');
    const s = A.json(`${P}.subInsurance`);
    ok(s && s.deductible === 0.1 && near(s.premium, pSub) && near(A.run('myCompany().cash'), cash0 - pSub) && near(A.eng.cashTotal(), m0), `sous-standard signée à la franchise 0,1 (prime ${f4(pSub)}) ; monnaie conservée`);
  });
  await scenario('G4b. Contre-épreuve : redessin sans les choix du joueur → cases perdues', async () => {
    const { A } = await modePuisDuree(sansBrouillon);
    ok(!cochee(A, ligne(A, 'year', 'single', 0, 'tax', 4)) && !cochee(A, ligne(A, 'year', 'single', 0, 'prop', 'p21')), 'contre-épreuve : mode changé, les deux cases sont décochées');
    ok(A.doc.trouver('mDeductibleGlobal').value === '0', 'contre-épreuve : la franchise tapée est perdue aussi (retour à 0)');
  });

  await scenario('G5. Franchise négative refusée ; franchise tapée puis « Annuler »', async () => {
    const { shared, A, code } = await partie({ setup: 'state.companies[0].currentDeductible = 0.2;' });
    A.run('modalInsureBundle()'); await A.calme();
    const iTax = ligne(A, 'year', 'recurring', 0.2, 'tax', 4);
    await A.cocher(`.bundle-check[data-idx="${iTax}"]`);
    await A.changer('mDeductibleGlobal', '-5');
    ok(A.alerts.some(m => /positif ou nul/.test(m)) && A.doc.trouver('mDeductibleGlobal').value === '0.2', '−5 : message, et le champ revient à la franchise affichée (0,2)');
    ok(cochee(A, iTax) && primeAffichee(A, iTax) === A.run(`fmt(${prime(A, 'year', 'recurring', 0.2, 'tax', 4)})`), 'la case reste cochée, prime inchangée');
    const avant = shared.get('game:' + code);
    await A.changer('mDeductibleGlobal', '0.7');
    ok(await A.cliquer('#mCancel') === 'ok' && !A.doc.trouver('mOk'), '0,7 tapé puis « Annuler » : la fenêtre se ferme');
    ok(A.run('myCompany().currentDeductible') === 0.2 && shared.get('game:' + code) === avant, 'rien n’est enregistré : la franchise du tour reste 0,2');
    A.run('modalInsureBundle()'); await A.calme();
    ok(A.doc.trouver('mDeductibleGlobal').value === '0.2', 'fenêtre rouverte : franchise du tour (0,2), pas celle abandonnée');
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 319 (fenêtre d’assurance, lot C) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
