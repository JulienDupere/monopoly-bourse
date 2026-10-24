// Test — Section 308 : pas de double envoi (bogues 32, 57, 58, 60) ; anti-rebond des boutons d'action.
//
// 32 : double clic dans une liste : la ligne traitée disparaît, la suivante remonte et le 2e clic agit sur elle
//      (ici : « Ouvrir une enquête AMF » sur Co Bob, le 2e clic tombe sur Co Carl).
// 57 : double clic « Vendre » des parts REIT : la vente était répétée (l'acheteur recevait 60 % et payait 2 fois).
// 58 : double clic « Subvention d'avance » : deux subventions vendues ; décision de Julien : confirmation explicite.
// 60 : double clic « Ouvrir une enquête AMF » : cubes rouges injectés deux fois.
//
// L'anti-rebond est une fonction pure (shouldIgnoreActionClick), testée directement, puis de bout en bout avec le
// vrai gestionnaire de clics du moteur (capturé par un document de test). Contre-épreuve pour chaque correctif.
// Lancer depuis la racine du dépôt :  node tests/section308-clics.test.js
const { loadEngine, check, near, engineSource } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const tick = () => new Promise(r => setImmediate(r));
const settle = async () => { for(let i = 0; i < 10; i++) await tick(); };

// Document de test : garde le gestionnaire de clics posé par le moteur et des nœuds persistants pour la fenêtre.
const WITH_TEST_DOCUMENT = src => `globalThis.__clickHandlers = []; globalThis.__nodes = new Map();
globalThis.document = (function(base){
  const kept = new Set(['modalHost','modalBg','mOk','mCancel']);
  const mk = id => ({ id, innerHTML:'', textContent:'', value:'', disabled:false, style:{}, dataset:{}, _l:{},
    addEventListener(t, f){ (this._l[t] = this._l[t] || []).push(f); }, setAttribute(){}, hasAttribute(){ return false; }, closest(){ return null; } });
  return new Proxy({}, { get(o, k){
    if(k === 'addEventListener') return (t, f) => { if(t === 'click') __clickHandlers.push(f); };
    if(k === 'getElementById') return id => kept.has(id) ? (__nodes.get(id) || (__nodes.set(id, mk(id)), __nodes.get(id))) : base.getElementById(id);
    return base[k];
  }});
})(globalThis.document);
` + src;
const compose = (...fs) => src => fs.reduce((s, f) => f(s), src);
// Contre-épreuves.
const NO_DEBOUNCE = src => src.replace('function shouldIgnoreActionClick(nowMs, busy, lastBlockingMs, isActionTarget){', 'function shouldIgnoreActionClick(nowMs, busy, lastBlockingMs, isActionTarget){ return false;');
const NO_JAIL_CHECK = src => src.replace(/    if\(co\.inJail\) return \{ok:false, error:`\$\{co\.name\} fait déjà[^\n]*\n/, '');
const NO_ETF_CHECK = src => src.replace(/    if\(typeof opts\.expectedHeld==='number'[^\n]*\n/, '');
const NO_GO_CHECK = src => src.replace("if(Number.isInteger(opts.expectedOwed) && (co.goAdvancesOwed||0)!==opts.expectedOwed){", 'if(false){');

// Bouton factice (élément <button> vu par le gestionnaire de clics).
function button(opts){
  const b = Object.assign({ id: '', tagName: 'BUTTON', textContent: '', disabled: false, attrs: {}, inTabs: false }, opts);
  b.hasAttribute = a => Object.prototype.hasOwnProperty.call(b.attrs, a);
  b.closest = sel => (sel === 'button' ? b : (b.inTabs ? {} : null));
  return b;
}
// Clic de bout en bout : le gestionnaire du moteur (phase de capture) décide ; s'il laisse passer, le gestionnaire
// du bouton lance son action (comme bindTabEvents).
function click(eng, btn, action){
  const e = { target: btn, stopped: false, stopPropagation(){ this.stopped = true; }, preventDefault(){} };
  eng.run('__clickHandlers').forEach(h => h(e));
  if(e.stopped) return { ignored: true, done: Promise.resolve() };
  return { ignored: false, done: Promise.resolve(eng.run(action)) };
}

const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 2) + ' — ' + m); }
}

async function game3(engineOpts){
  const eng = loadEngine(engineOpts);
  const alerts = []; eng.sandbox.alert = m => alerts.push(String(m));
  const ids = await eng.newGame(['Alice', 'Bob', 'Carl'], ['garp', 'garp', 'garp']);
  await eng.run('saveGame({silent:true})');
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])}`);
  eng.run(`globalThis.coId = name => state.companies.find(c=>c.name===name).id; globalThis.coOf = name => state.companies.find(c=>c.name===name);`);
  alerts.length = 0;
  return { eng, alerts, ids, saved: () => JSON.parse(eng.mem.get('game:' + eng.run('gameCode'))) };
}

(async () => {
  // =====================================================================================================
  await scenario('A. Décision pure : ignorer un clic ?', async () => {
    const eng = loadEngine();
    const f = (now, busy, last, act) => eng.run(`shouldIgnoreActionClick(${now}, ${busy}, ${last}, ${act})`);
    ok(eng.run('ACTION_CLICK_DEBOUNCE_MS') === 500, 'A : anti-rebond de 500 ms');
    ok(f(10000, true, 0, false) === false && f(10000, false, 9999, false) === false, 'A : un clic hors bouton d’action (onglet, menu, liste) n’est jamais ignoré');
    ok(f(10000, true, 0, true) === true, 'A : clic sur un bouton d’action pendant une action en cours : ignoré');
    ok(f(10000, false, 9700, true) === true && f(10000, false, 9501, true) === true, 'A : moins de 500 ms après la fin d’une action ou l’ouverture d’une fenêtre : ignoré');
    ok(f(10000, false, 9500, true) === false && f(10000, false, 0, true) === false, 'A : à partir de 500 ms : accepté');
    const free = b => eng.sandbox.isFreeClickButton(b);
    ok(free(button({ id: 'mCancel', textContent: 'Annuler' })) && free(button({ textContent: ' Fermer ' })) && free(button({ textContent: 'OK' })), 'A : Annuler / Fermer / OK restent libres');
    ok(!free(button({ textContent: 'Annuler un bid' })) && !free(button({ id: 'mCancelRequest', textContent: 'Annuler la demande' })), 'A : « Annuler un bid », « Annuler la demande » sont des actions (anti-rebond)');
    ok(free(button({ id: 'entActionsMenuBtn' })) && free(button({ attrs: { 'aria-expanded': 'false' } })) && free(button({ attrs: { 'data-free-click': '' } })) && free(button({ inTabs: true })), 'A : menus (aria-expanded, menu Actions), onglets et data-free-click restent libres');
    ok(!free(button({ textContent: 'Ouvrir une enquête AMF' })) && !free(button({ id: 'mOk', textContent: 'Confirmer' })), 'A : boutons d’action et de confirmation soumis à l’anti-rebond');
  });

  // =====================================================================================================
  await scenario('B. Bogue 32 — double clic dans la liste « Ouvrir une enquête AMF » : la ligne suivante remonte', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await game3({ transform: variant === 'ancien' ? compose(WITH_TEST_DOCUMENT, NO_DEBOUNCE) : WITH_TEST_DOCUMENT });
      const bob = T.eng.run(`coId('Co Bob')`), carl = T.eng.run(`coId('Co Carl')`);
      T.eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;');   // la mise en place est loin (plus de 500 ms)
      // Ligne 1 = Co Bob ; après l'enquête, son bouton disparaît et la ligne 1 devient Co Carl.
      const c1 = click(T.eng, button({ textContent: 'Ouvrir une enquête AMF' }), `sendToJail(${JSON.stringify(bob)})`);
      // Clic pendant l'envoi (bouton suivant) : ignoré.
      const cBusy = click(T.eng, button({ textContent: 'Ouvrir une enquête AMF' }), `sendToJail(${JSON.stringify(carl)})`);
      await c1.done; await cBusy.done;
      // 2e clic du double clic, juste après le nouveau rendu : il tombe sur la ligne de Co Carl, remontée.
      const c2 = click(T.eng, button({ textContent: 'Ouvrir une enquête AMF' }), `sendToJail(${JSON.stringify(carl)})`);
      await c2.done;
      const S = T.saved();
      const jailed = S.companies.filter(c => c.inJail).map(c => c.name);
      console.log(`    [${variant}] clic pendant l’envoi ignoré : ${cBusy.ignored}, 2e clic ignoré : ${c2.ignored}, entreprises enquêtées : ${JSON.stringify(jailed)}`);
      if(variant === 'corrigé'){
        ok(!c1.ignored && cBusy.ignored && c2.ignored, 'B : 1er clic accepté ; clic pendant l’envoi et 2e clic du double clic ignorés');
        ok(jailed.length === 1 && jailed[0] === 'Co Bob', 'B : seule Co Bob est enquêtée (avant le correctif : Co Carl aussi)');
        T.eng.run('lastActionEndMs = Date.now() - 600; lastModalOpenMs = 0;');
        const c3 = click(T.eng, button({ textContent: 'Ouvrir une enquête AMF' }), `sendToJail(${JSON.stringify(carl)})`);
        await c3.done;
        ok(!c3.ignored && T.saved().companies.find(c => c.id === carl).inJail, 'B : un clic voulu, 500 ms plus tard, fonctionne normalement');
        const tab = click(T.eng, button({ inTabs: true }), '0');
        ok(!tab.ignored, 'B : un clic d’onglet n’est jamais bloqué');
      } else {
        ok(jailed.includes('Co Carl'), 'B : contre-épreuve — sans l’anti-rebond, le 2e clic ouvre une enquête sur Co Carl, qu’on n’a pas choisie');
      }
    }
  });

  // =====================================================================================================
  await scenario('C. Bogue 60 — « Ouvrir une enquête AMF » envoyé deux fois (2e clic passé, ou 2e appareil)', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await game3(variant === 'ancien' ? { transform: NO_JAIL_CHECK } : {});
      T.eng.run(`globalThis.__cubes = 0; const __inj = injectStockCube; injectStockCube = function(co, color){ if(color==='red') __cubes++; return __inj.apply(this, arguments); };`);
      const bob = T.eng.run(`coId('Co Bob')`);
      await T.eng.run(`Promise.all([sendToJail(${JSON.stringify(bob)}), sendToJail(${JSON.stringify(bob)})])`);
      const S = T.saved();
      const lines = S.log.filter(e => /Co Bob fait l'objet d'une enquête de l'AMF/.test(e.text)).length;
      console.log(`    [${variant}] injections de cubes rouges : ${T.eng.run('__cubes')}, lignes « enquête » : ${lines}, alertes : ${JSON.stringify(T.alerts)}`);
      if(variant === 'corrigé'){
        ok(T.eng.run('__cubes') === 1 && lines === 1, 'C : une seule enquête : cubes rouges injectés une fois, une ligne au journal');
        ok(T.alerts.length === 1 && /fait déjà l'objet d'une enquête/.test(T.alerts[0]), 'C : le 2e envoi est refusé avec un message clair');
        ok(S.companies.find(c => c.id === bob).jailTurnsLeft === S.settings.jailTurns, 'C : la durée de l’enquête n’est pas réinitialisée');
      } else {
        ok(T.eng.run('__cubes') === 2 && lines === 2, 'C : contre-épreuve — sans le refus, cubes rouges injectés deux fois');
      }
    }
  });

  // =====================================================================================================
  await scenario('D. Bogue 57 — « Vendre » 30 % d’un REIT pour 5 M$ envoyé deux fois', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await game3(variant === 'ancien' ? { transform: NO_ETF_CHECK } : {});
      const etf = T.eng.run('state.etfs[0].id');
      await T.eng.run(`attemptActionWithRetry(async ()=>{ coOf('Co Alice').etfHoldings[${JSON.stringify(etf)}] = 100; return {ok:true}; })`);
      const a = T.eng.run(`coId('Co Alice')`), c = T.eng.run(`coId('Co Carl')`);
      const S0 = T.saved();
      const T0 = T.eng.cashTotal();
      // Le bouton porte la détention affichée (100 %) : les deux envois aussi.
      const call = `sellEtfUnits(${JSON.stringify(etf)}, ${JSON.stringify(a)}, ${JSON.stringify(c)}, 30, 5, {expectedHeld:100})`;
      await T.eng.run(`Promise.all([${call}, ${call}])`);
      const S = T.saved();
      const carl = S.companies.find(x => x.id === c), carl0 = S0.companies.find(x => x.id === c);
      const alice = S.companies.find(x => x.id === a), alice0 = S0.companies.find(x => x.id === a);
      console.log(`    [${variant}] Co Carl : ${carl.etfHoldings[etf] || 0} % du REIT, a payé ${(carl0.cash - carl.cash).toFixed(2)} M$ ; Co Alice garde ${alice.etfHoldings[etf]} %`);
      if(variant === 'corrigé'){
        ok(near(carl.etfHoldings[etf], 30) && near(carl0.cash - carl.cash, 5), 'D : Co Carl reçoit 30 % et paie 5 M$, une seule fois');
        ok(near(alice.etfHoldings[etf], 70) && near(alice.cash - alice0.cash, 5), 'D : Co Alice garde 70 % et encaisse 5 M$');
        ok(T.alerts.length === 1 && /détient maintenant 70%/.test(T.alerts[0]) && /rien n'a été vendu/.test(T.alerts[0]), 'D : le 2e envoi est refusé (« détient maintenant 70 % … rien n’a été vendu »)');
        ok(near(T.eng.cashTotal(), T0), 'D : conservation de la monnaie');
      } else {
        ok(near(carl.etfHoldings[etf], 60) && near(carl0.cash - carl.cash, 10), 'D : contre-épreuve — sans la vérification, la vente est répétée (60 %, 10 M$)');
      }
    }
    const src = engineSource();
    ok(/data-etf-sell="\$\{etf\.id\}" data-etf-held="\$\{myHeld\}"/.test(src) && /sellEtfUnits\(id, myCo\.id, buyerId, pct, price, Number\.isFinite\(expectedHeld\) \? \{expectedHeld\} : \{\}\)/.test(src), 'D : le bouton « Vendre » transmet la détention affichée au moment du clic');
  });

  // =====================================================================================================
  await scenario('E. Bogue 58 — « Subvention d’avance » : confirmation explicite, et pas de 2e vente sur double confirmation', async () => {
    for(const variant of ['corrigé', 'ancien']){
      const T = await game3({ transform: variant === 'ancien' ? compose(WITH_TEST_DOCUMENT, NO_GO_CHECK) : WITH_TEST_DOCUMENT });
      const a = T.eng.run(`coId('Co Alice')`);
      const S0 = T.saved();
      const T0 = T.eng.cashTotal();
      const expectedAmount = T.eng.run(`goAdvanceAmount(1, coOf('Co Alice'))`);
      T.eng.run(`modalConfirmGoAdvance(${JSON.stringify(a)})`);
      const html = T.eng.run(`document.getElementById('modalHost').innerHTML`);
      const owedOpen = T.eng.run(`coOf('Co Alice').goAdvancesOwed`);
      // Double clic sur « Vendre la subvention » : les deux gestionnaires partent avant la fin du 1er envoi.
      const okHandlers = T.eng.run(`document.getElementById('mOk')._l.click`);
      okHandlers.forEach(h => h()); okHandlers.forEach(h => h());
      await settle();
      const S = T.saved();
      const alice = S.companies.find(c => c.id === a), alice0 = S0.companies.find(c => c.id === a);
      console.log(`    [${variant}] subventions dues : ${alice.goAdvancesOwed}, encaisse ${alice0.cash.toFixed(2)} → ${alice.cash.toFixed(2)}, alertes : ${JSON.stringify(T.alerts)}`);
      if(variant === 'corrigé'){
        ok(/Vendre la subvention/.test(html) && /ne peut pas être annulée/.test(html) && owedOpen === 0, 'E : la fenêtre de confirmation s’ouvre (montant, conséquences) et rien n’est vendu avant la confirmation');
        ok(alice.goAdvancesOwed === 1, `E : une seule subvention vendue (${alice.goAdvancesOwed}, avant le correctif : 2)`);
        ok(near(alice.cash - alice0.cash, expectedAmount) && html.includes(T.eng.run(`fmt(${expectedAmount})`)), `E : Co Alice reçoit le montant affiché dans la fenêtre, une fois (${expectedAmount.toFixed(4)} M$)`);
        ok(T.alerts.length === 1 && /rien n'a été vendu/.test(T.alerts[0]), 'E : la 2e confirmation est refusée avec un message clair');
        ok(near(T.eng.cashTotal(), T0), 'E : conservation de la monnaie');
      } else {
        ok(alice.goAdvancesOwed === 2, 'E : contre-épreuve — sans la vérification, la double confirmation vend deux subventions');
      }
    }
    const src = engineSource();
    ok(/\[data-go-advance\]'\)\.forEach\(b=>b\.addEventListener\('click', \(\)=>modalConfirmGoAdvance\(b\.dataset\.goAdvance\)\)\)/.test(src), 'E : le bouton « Subvention d’avance » ouvre la confirmation au lieu de vendre directement');
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
