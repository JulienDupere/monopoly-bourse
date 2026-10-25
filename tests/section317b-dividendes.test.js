// Test — Section 317 (seconde moitié), bogues 82, 83 et 84 : affichage et journal des dividendes.
//   82 : « coût total par semestre » du dividende récurrent = part de la banque comprise (3 fois le coût réel).
//   83 : journal du versement : la banque, qui encaisse le paiement du vendeur à découvert, n'apparaît pas ; le texte
//        parle de parts « non réclamées » d'actionnaires « ayant vendu » alors que c'est la part de la banque.
//   84 : fenêtre « Dividende annoncé » : « écart d'arrondi » pour tout le montant immobilisé.
// Aucun montant d'argent ne change : on vérifie aussi la conservation de la masse.
// Lancer depuis la racine du dépôt :  node tests/section317b-dividendes.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const failures = [];
const ok = (cond, msg) => { try { check(cond, msg); n++; } catch(e){ failures.push(msg); console.log('  ' + e.message); } };

function installModalDom(eng){
  const registry = new Map();
  const fallback = eng.sandbox.document.getElementById;
  eng.sandbox.document.getElementById = (id) => registry.has(id) ? registry.get(id) : fallback(id);
  return {
    reset(){ registry.clear(); },
    add(id){
      const listeners = {};
      const base = {
        id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
        addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(){},
        async fire(type){ for(const fn of (listeners[type] || [])) await fn({ target: el }); },
      };
      const el = new Proxy(base, { get(t, k){ return (k in t) ? t[k] : fallback(id)[k]; }, set(t, k, v){ t[k] = v; return true; } });
      registry.set(id, el);
      return el;
    },
    get(id){ return registry.get(id); },
  };
}

async function setup(types, opts){
  const eng = loadEngine(opts);
  eng.sandbox.alert = () => {};
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], types, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  eng.run(`globalThis.__A = () => state.companies.find(c=>c.ceoId===${JSON.stringify(ids[0])});`);
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push({msg: String(msg), entries: entries ? JSON.parse(JSON.stringify(entries)) : []}); return __realLog.apply(this, arguments); };`);
  eng.run(`globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
  return { eng, ids, dom: installModalDom(eng) };
}

const costText = (html) => (/id="mDivTotalCost">([^<]*)</.exec(html) || [])[1];

(async () => {
  // ---------- Bogue 82 ----------
  console.log('\nBogue 82 — coût total par semestre du dividende récurrent');
  {
    const { eng, dom } = await setup(['dividende']);
    eng.run(`__A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = true;`);
    const held = eng.json(`__A().shareholders.map(s=>[s.playerId==='BANK'?'BANK':'CEO', s.shares])`);
    const bank = held.find(h => h[0] === 'BANK')[1], ceo = held.find(h => h[0] === 'CEO')[1];
    ok(eng.run(`__A().sharesIssued`) === 200000 && bank === 140000 && ceo === 60000, `départ : 200 000 parts émises, 140 000 à la banque, 60 000 au CEO (${bank} / ${ceo})`);
    eng.run(`__modals.length = 0; modalDividendRecurrentSettings();`);
    const html = eng.run(`__modals[__modals.length-1]`);
    ok(costText(html) === '90 K$', `l'ouverture affiche un coût de 90 K$ (1,50 $ x 60 000 parts réelles) et non 300 K$ (affiché : ${costText(html)})`);
    ok(/hors part de la banque/.test(html), 'le libellé précise « hors part de la banque »');
    // Réel : le versement automatique coûte 90 K$ à l'entreprise.
    const co0 = eng.run(`__A().cash`);
    eng.run(`advanceGameClock(); advanceGameClock(); advanceGameClock();`);
    const cost = co0 - eng.run(`__A().cash`);
    ok(near(cost, 0.09, 1e-9), `coût réel du versement automatique = 0,09 M$ (${cost})`);
    // L'aperçu suit le curseur : palier 5 (x1,40) = 126 K$.
    dom.reset(); dom.add('mCancel'); dom.add('mOk'); dom.add('mDivTierLabel'); dom.add('mDivPerShare'); dom.add('mDivCutWarning');
    const tier = dom.add('mDivTier'); const total = dom.add('mDivTotalCost'); dom.add('mDivAutoPayChk');
    eng.run(`modalDividendRecurrentSettings()`);
    tier.value = '5';
    await tier.fire('input');
    ok(total.textContent === '126 K$', `curseur au palier 5 (x1,40) : 126 K$ (affiché : ${total.textContent})`);
  }

  // ---------- Bogue 83 ----------
  async function scenario83(mode){
    const { eng, ids, dom } = await setup(['garp']);
    const A = `__A()`;
    if(mode === 'auto') eng.run(`__A().type = 'dividende'; __A().dividendBenchmarkPerShare = 5e-6; __A().dividendAutoPay = true;`);
    // Chloé vend 2 M$ d'Alpha à découvert.
    const r = eng.json(`(function(){ const x = openShortPosition(__A(), state.players[2], 2); return {ok: !!(x&&x.ok), error: x&&x.error}; })()`);
    ok(r.ok, `Chloé vend à découvert (${r.error || 'accepté'})`);
    const shortShares = eng.run(`state.players[2].shortPositions[__A().id].shares`);
    if(mode === 'announce'){
      dom.reset(); dom.add('mOk'); const input = dom.add('mDividendAmount');
      eng.run(`modalAnnounceDividend()`);
      input.value = '1';
      await dom.get('mOk').fire('click');
      ok(eng.run(`state.dividendAnnouncements.length`) === 1, 'dividende de 1 M$ annoncé');
    }
    const m0 = eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
    const b0 = eng.run(`state.bank.cash`);
    eng.run(`__logs.length = 0;`);
    eng.run(`advanceGameClock(); advanceGameClock(); advanceGameClock();`);
    const m1 = eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
    const logEntry = eng.json(`__logs.find(l=>/verse (son dividende|automatiquement)/.test(l.msg))`);
    return { eng, shortShares, m0, m1, b0, logEntry };
  }
  for(const mode of ['announce', 'auto']){
    console.log(`\nBogue 83 — journal du dividende (${mode === 'announce' ? 'annoncé' : 'auto-versé'}), Chloé à découvert`);
    const s = await scenario83(mode);
    ok(!!s.logEntry, 'une ligne de journal du versement existe');
    const perShare = mode === 'announce' ? 1 / 200000 : 5e-6;
    const owed = perShare * s.shortShares;
    const bankLines = s.logEntry.entries.filter(e => /^Banque \(paiement reçu/.test(e.label));
    ok(bankLines.length === 1 && near(bankLines[0].amount, owed, 1e-9), `la banque apparaît au journal avec +${owed.toFixed(6)} M$ reçus du vendeur à découvert (lignes : ${JSON.stringify(bankLines)})`);
    const compens = s.logEntry.entries.filter(e => /^Chloe \(paiement compensatoire/.test(e.label));
    ok(compens.length === 1 && near(compens[0].amount, -owed, 1e-9), `Chloé paie -${owed.toFixed(6)} M$ (même ligne qu'avant)`);
    ok(near(s.m1, s.m0, 1e-9), `masse conservée, banque comprise (${s.m0} -> ${s.m1})`);
    ok(!/ayant vendu/.test(s.logEntry.msg), `le texte ne parle plus d'actionnaires « ayant vendu » : personne n'a vendu (« ${s.logEntry.msg.slice(0, 220)}... »)`);
    ok(/part de la banque/.test(s.logEntry.msg), 'le texte attribue la part non versée à la banque');
    // Les lignes du journal s'équilibrent (somme nulle pour l'auto-versement ; pour l'annoncé, le montant immobilisé à l'annonce).
    const total = s.logEntry.entries.reduce((t, e) => t + e.amount, 0);
    ok(near(total, mode === 'announce' ? 1 : 0, 1e-9), `somme des lignes du journal = ${mode === 'announce' ? '+1 (montant annoncé immobilisé, voir la ligne d\'annonce)' : '0'} (${total})`);
  }
  {
    console.log('\nBogue 83 — texte quand un actionnaire a vraiment vendu entre l\'annonce et le versement');
    const { eng, ids, dom } = await setup(['garp']);
    // Bob achète 1 M$ de parts, le dividende est annoncé, puis Bob revend tout.
    eng.run(`(function(){ const co=__A(); const bob=state.players[1]; const price=co.stockPrice; const sh=0.5/price; co.shareholders.push({playerId:bob.id, shares:sh}); const b=co.shareholders.find(s=>s.playerId==='BANK'); b.shares-=sh; })()`);
    dom.reset(); dom.add('mOk'); const input = dom.add('mDividendAmount');
    eng.run(`modalAnnounceDividend()`);
    input.value = '1';
    await dom.get('mOk').fire('click');
    eng.run(`(function(){ const co=__A(); const bob=state.players[1]; const e=co.shareholders.find(s=>s.playerId===bob.id); const b=co.shareholders.find(s=>s.playerId==='BANK'); b.shares+=e.shares; e.shares=0; })()`);
    const m0 = eng.cashTotal() + 1;
    eng.run(`__logs.length = 0; advanceGameClock(); advanceGameClock(); advanceGameClock();`);
    const m1 = eng.cashTotal();
    const l = eng.json(`__logs.find(l=>/verse son dividende/.test(l.msg))`);
    ok(/ayant vendu/.test(l.msg) && /part de la banque/.test(l.msg), `le texte distingue la banque et les actionnaires ayant vendu (« ${l.msg.slice(0, 260)} »)`);
    ok(near(m1, m0, 1e-9), 'masse conservée');
  }

  // ---------- Bogue 84 ----------
  console.log('\nBogue 84 — fenêtre « Dividende annoncé »');
  {
    const { eng, dom } = await setup(['garp']);
    dom.reset(); dom.add('mOk'); const input = dom.add('mDividendAmount');
    eng.run(`__modals.length = 0; modalAnnounceDividend()`);
    input.value = '1';
    await dom.get('mOk').fire('click');
    const popup = eng.run(`__modals[__modals.length-1]`);
    ok(/Dividende annoncé/.test(popup), 'la fenêtre de confirmation s\'ouvre');
    ok(/Somme des mouvements: -1\.0000/.test(popup), 'somme des mouvements : -1.0000 (montant immobilisé)');
    ok(!/écart d.arrondi/.test(popup), 'plus d\'« écart d\'arrondi » pour un montant de 1 M$');
    ok(/immobilisé jusqu.{1,6}au versement/.test(popup), 'la fenêtre explique que le montant est immobilisé jusqu\'au versement');
    const pop = (entries, note) => { eng.run(`__modals.length = 0; showTransactionPopup('T', ${JSON.stringify(entries)}${note ? ', ' + JSON.stringify(note) : ''});`); return eng.run(`__modals[__modals.length-1]`); };
    ok(/\(équilibré\)/.test(pop([{label:'a', amount:1}, {label:'b', amount:-1}])), 'somme nulle : « équilibré »');
    ok(/écart d.arrondi/.test(pop([{label:'a', amount:0.007}])), 'somme de 0,007 : « écart d\'arrondi » conservé pour un vrai arrondi');
    ok(!/écart d.arrondi/.test(pop([{label:'a', amount:3}])), 'somme de 3 sans note : plus d\'« écart d\'arrondi »');
  }

  console.log(`\n${n} vérifications réussies, ${failures.length} échec(s).`);
  if(failures.length){ console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
