// Test — audit, bogue 4 (Section 307) : dividende ordinaire quand la banque a une position négative — « la banque paie ».
//
// Règle voulue (comme un vendeur à découvert, section 298) :
//   - montant par part FIXE : montant annoncé ÷ parts émises (sharesIssued) ; à l'auto-versement, la référence ;
//   - chaque porteur positif reçoit ce montant par part × ses parts éligibles ; pour un dividende ANNONCÉ, parts
//     éligibles = min(parts à l'annonce, parts au versement), calculées AU VERSEMENT (plus de base figée à l'annonce) ;
//   - l'entreprise débite le montant annoncé ; la portion d'une banque POSITIVE (et des porteurs qui ont vendu)
//     revient à la trésorerie ;
//   - banque NÉGATIVE : la banque paie l'excédent depuis state.bank.cash, de sorte que
//     total versé = débit net de l'entreprise + paiement de la banque, au centime près ;
//   - les vendeurs à découvert paient au même taux par part ;
//   - auto-versement : le CEO reçoit exactement référence × ses parts (section 256).
// Couvre : vraie modale modalAnnounceDividend + advanceGameClock, auto-versement, achats au-delà du flottant,
// puts écrits assignés, revente par les sur-détenteurs entre l'annonce et le versement, achats après l'annonce,
// découverts ouverts, conservation de la masse EN INCLUANT la banque.
// Lancer depuis la racine du dépôt :  node tests/audit-bug4.test.js
const { loadEngine, check, near } = require('./helpers/engine');

const CENTIME = 1e-8; // 0,01 $ exprimé en M$ : tolérance « au centime près »
let n = 0;
const failures = [];
// Chaque vérification est indépendante : on note les échecs et on continue, pour voir TOUS les écarts d'un coup.
const ok = (cond, msg) => { try { check(cond, msg); n++; } catch(e){ failures.push(msg); console.log('  ' + e.message); } };
const f6 = (x) => Number(x).toFixed(6);

// ---------- Faux DOM minimal pour piloter la vraie modale d'annonce ----------
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

// ---------- Mise en place commune : réglages par défaut (encaisse de départ 20 M$, 200 000 parts, CEO 30 %) ----------
async function setup(names, types){
  const eng = loadEngine();
  const alerts = [];
  eng.sandbox.alert = (m) => { alerts.push(String(m)); };
  const ids = await eng.newGame(names, types, 20, 1000);
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  eng.run(`globalThis.__A = () => state.companies.find(c=>c.ceoId===${JSON.stringify(ids[0])});`);
  eng.run(`globalThis.__P = (name) => state.players.find(p=>p.name===name);`);
  // Espion sur log() : garde les écritures des versements (paiements compensatoires des découverts et de la banque).
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push({msg: String(msg), entries: entries ? JSON.parse(JSON.stringify(entries)) : []}); return __realLog.apply(this, arguments); };`);
  const payoutEntries = (prefix) => eng.run(`__logs.filter(l=>/verse (son dividende|automatiquement)/.test(l.msg)).reduce((s,l)=>s+l.entries.filter(e=>e.label.indexOf(${JSON.stringify(prefix)})===0).reduce((t,e)=>t-e.amount,0),0)`);
  const compensation = (name) => payoutEntries(name + ' (paiement compensatoire');
  const bankPaid = () => payoutEntries('Banque (paiement compensatoire');
  const dom = installModalDom(eng);
  // Masse totale : banque + entreprises + joueurs + dividendes immobilisés (bons hors jeu ici).
  const money = () => eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
  const holders = () => Object.fromEntries(eng.json(`__A().shareholders.map(s=>[s.playerId==='BANK' ? 'BANK' : state.players.find(p=>p.id===s.playerId).name, s.shares])`));
  const shortShares = (name) => eng.run(`(__P(${JSON.stringify(name)}).shortPositions||{})[__A().id] ? __P(${JSON.stringify(name)}).shortPositions[__A().id].shares : 0`);
  const received = () => eng.json(`Object.fromEntries(state.players.map(p=>[p.name, p.cumDividendsReceived||0]))`);
  const trade = (name, side, amount) => eng.json(`(function(){ const r = tradeCompanyShares(__A(), __P(${JSON.stringify(name)}), ${JSON.stringify(side)}, ${amount}); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
  const short = (name, amount) => eng.json(`(function(){ const r = openShortPosition(__A(), __P(${JSON.stringify(name)}), ${amount}); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
  async function announce(amount){
    eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
    dom.reset(); dom.add('mOk'); const input = dom.add('mDividendAmount');
    eng.run(`modalAnnounceDividend()`);
    input.value = String(amount);
    await dom.get('mOk').fire('click');
  }
  const advance = (k) => { for(let i = 0; i < k; i++) eng.run(`advanceGameClock()`); };
  return { eng, ids, alerts, money, holders, shortShares, received, trade, short, announce, advance, compensation, bankPaid };
}
const diff = (after, before) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - (before[k] || 0)]));
const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);

// Vérifications communes d'un versement. Hann = détention à l'annonce (null pour l'auto-versement), Hpay = au versement.
function checkPayout(g, { label, perShare, debit, Hann, Hpay, shorts, paid, coCost, bankDelta, m0 }){
  const players = Object.keys(Hpay).filter(k => k !== 'BANK');
  let expectedTotal = 0;
  for(const p of players){
    const elig = Math.max(0, Hann ? Math.min(Hann[p] || 0, Hpay[p] || 0) : (Hpay[p] || 0));
    const exp = perShare * elig;
    expectedTotal += exp;
    if(elig > 1e-9 || Math.abs(paid[p] || 0) > CENTIME) ok(near(paid[p] || 0, exp, CENTIME), `${label} : ${p} reçoit ${f6(perShare * 1e6)} $/part × ${Math.round(elig)} parts éligibles = ${f6(exp)} (reçu ${f6(paid[p] || 0)})`);
  }
  const totalPaid = sum(paid);
  const bankPays = g.bankPaid();
  const expBankPays = Math.max(0, expectedTotal - debit), expReturned = Math.max(0, debit - expectedTotal);
  ok(near(totalPaid, expectedTotal, CENTIME), `${label} : total versé ${f6(totalPaid)} (attendu ${f6(expectedTotal)})`);
  ok(near(bankPays, expBankPays, CENTIME), `${label} : la banque paie ${f6(bankPays)} (attendu ${f6(expBankPays)})`);
  ok(near(coCost, debit - expReturned, CENTIME), `${label} : coût net pour l'entreprise ${f6(coCost)} = débit ${f6(debit)} − retour trésorerie ${f6(expReturned)}`);
  ok(near(totalPaid, coCost + bankPays, CENTIME), `${label} : total versé (${f6(totalPaid)}) = débit net de l'entreprise (${f6(coCost)}) + paiement de la banque (${f6(bankPays)}), au centime près`);
  let comp = 0;
  for(const who of shorts){
    const sh = g.shortShares(who), owed = g.compensation(who);
    comp += owed;
    ok(owed > 0 && near(owed, perShare * sh, CENTIME), `${label} : ${who} (à découvert sur ${Math.round(sh)} parts) paie ${f6(owed)} = même taux par part × ${Math.round(sh)}`);
  }
  // Sans découvert (pas de frais d'emprunt pendant les lancers), l'encaisse de la banque bouge exactement de son paiement.
  if(!shorts.length) ok(near(bankDelta, -bankPays, CENTIME), `${label} : l'encaisse de la banque baisse exactement de son paiement (${f6(bankDelta)})`);
  const m1 = g.money();
  ok(near(m1, m0, CENTIME), `${label} : masse conservée, banque comprise : ${f6(m0)} → ${f6(m1)} (Δ=${f6(m1 - m0)})`);
  return { totalPaid, bankPays, comp, returned: debit - coCost };
}

// Dividende ANNONCÉ par la vraie modale (lancer 0), opérations éventuelles entre l'annonce et le versement (même fenêtre
// de marché), versement au lancer 3 par le vrai advanceGameClock.
async function announced({ label, names = ['Alice', 'Bob', 'Carol'], buys = [], shorts = [], between = [], amount }){
  console.log(`\n${label}`);
  const g = await setup(names, ['garp']);
  for(const [who, amt] of buys){ const r = g.trade(who, 'buy', amt); ok(r.ok, `${who} achète ${amt} M$ d'Alpha (${r.error || 'accepté'})`); }
  for(const [who, amt] of shorts){ const r = g.short(who, amt); ok(r.ok, `${who} vend ${amt} M$ d'Alpha à découvert (${r.error || 'accepté'})`); }
  const issued = g.eng.run(`__A().sharesIssued`);
  const m0 = g.money(), co0 = g.eng.run(`__A().cash`), r0 = g.received(), b0 = g.eng.run(`state.bank.cash`);
  const Hann = g.holders();
  console.log('  à l’annonce :', JSON.stringify(Object.entries(Hann).map(([k, v]) => [k, Math.round(v)])));
  await g.announce(amount);
  const anns = g.eng.json(`state.dividendAnnouncements.map(a=>({amount:a.amount, basis:a.totalSharesAtAnnouncement}))`);
  ok(anns.length === 1 && near(anns[0].amount, amount) && anns[0].basis === issued, `annonce de ${amount} M$ enregistrée, base = parts émises (${anns[0] && anns[0].basis}) (alertes : ${JSON.stringify(g.alerts)})`);
  ok(near(co0 - g.eng.run(`__A().cash`), amount, CENTIME), `la trésorerie d'Alpha est débitée de ${amount} M$ à l'annonce`);
  for(const [who, side, amt] of between){ const r = g.trade(who, side, amt); ok(r.ok, `entre l'annonce et le versement : ${who} ${side === 'sell' ? 'revend' : 'achète'} ${amt} M$ d'Alpha (${r.error || 'accepté'})`); }
  const bBetween = g.eng.run(`state.bank.cash`);
  g.advance(3);
  ok(g.eng.run(`state.dividendAnnouncements.length`) === 0, 'le dividende annoncé est versé au semestre suivant');
  const Hpay = g.holders();
  if(between.length) console.log('  au versement :', JSON.stringify(Object.entries(Hpay).map(([k, v]) => [k, Math.round(v)])));
  const paid = diff(g.received(), r0);
  // Coût net de l'entreprise sur l'ensemble annonce + versement, hors effet des opérations intermédiaires (aucune
  // n'affecte la trésorerie d'Alpha : les échanges se font contre la banque).
  const coCost = co0 - g.eng.run(`__A().cash`);
  const bankDelta = g.eng.run(`state.bank.cash`) - bBetween;
  const res = checkPayout(g, { label: 'versement', perShare: amount / issued, debit: amount, Hann, Hpay, shorts: shorts.map(s => s[0]), paid, coCost, bankDelta, m0 });
  ok(near(g.money(), m0, CENTIME), `masse conservée de l'annonce au versement, banque comprise (Δ=${f6(g.money() - m0)})`);
  console.log('  reçus :', Object.entries(paid).map(([k, v]) => `${k} ${f6(v)}`).join(' / '), `— banque paie ${f6(res.bankPays)} ; retour trésorerie ${f6(res.returned)}`);
  return { g, paid, ...res, b0 };
}

// AUTO-VERSEMENT (dividende récurrent) : référence 1,5 $/part → 300 K$ pour 200 000 parts émises.
async function auto({ label, names = ['Alice', 'Bob', 'Carol'], buys = [], shorts = [] }){
  console.log(`\n${label}`);
  const g = await setup(names, ['dividende']);
  g.eng.run(`__A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = true;`);
  for(const [who, amt] of buys){ const r = g.trade(who, 'buy', amt); ok(r.ok, `${who} achète ${amt} M$ d'Alpha (${r.error || 'accepté'})`); }
  for(const [who, amt] of shorts){ const r = g.short(who, amt); ok(r.ok, `${who} vend ${amt} M$ d'Alpha à découvert (${r.error || 'accepté'})`); }
  const issued = g.eng.run(`__A().sharesIssued`);
  const H = g.holders();
  console.log('  actionnaires :', JSON.stringify(Object.entries(H).map(([k, v]) => [k, Math.round(v)])));
  const m0 = g.money(), co0 = g.eng.run(`__A().cash`), r0 = g.received(), b0 = g.eng.run(`state.bank.cash`);
  g.advance(3);
  const paid = diff(g.received(), r0);
  const res = checkPayout(g, { label: 'auto-versement', perShare: 1.5e-6, debit: 1.5e-6 * issued, Hann: null, Hpay: g.holders(), shorts: shorts.map(s => s[0]), paid, coCost: co0 - g.eng.run(`__A().cash`), bankDelta: g.eng.run(`state.bank.cash`) - b0, m0 });
  ok(near(paid.Alice, 1.5e-6 * H.Alice, CENTIME), `section 256 : le CEO reçoit EXACTEMENT référence × ses parts (${f6(1.5e-6 * H.Alice)})`);
  console.log('  reçus :', Object.entries(paid).map(([k, v]) => `${k} ${f6(v)}`).join(' / '), `— banque paie ${f6(res.bankPays)} ; retour trésorerie ${f6(res.returned)}`);
  return { g, paid, ...res };
}

(async () => {
  // ===== 1. Dividende annoncé =====
  console.log('1. Dividende annoncé (vraie modale + advanceGameClock)');
  let r = await announced({ label: 'Témoin : achats 7 + 7 M$ (exactement le flottant, banque à 0), 1 M$', buys: [['Bob', 7], ['Carol', 7]], amount: 1 });
  ok(near(r.paid.Alice, 0.3, CENTIME) && near(r.paid.Bob, 0.35, CENTIME) && near(r.bankPays, 0, CENTIME), 'Alice 0,30 ; Bob 0,35 ; Carol 0,35 ; la banque ne paie rien');
  r = await announced({ label: 'Témoin : achats 6 + 6 M$ (banque positive, 20 000 parts), 1 M$', buys: [['Bob', 6], ['Carol', 6]], amount: 1 });
  ok(near(r.paid.Bob, 0.3, CENTIME) && near(r.returned, 0.1, CENTIME) && near(r.bankPays, 0, CENTIME), 'non-régression : 0,3 / 0,3 / 0,3 versés, 0,1 M$ (part de la banque positive) rendu à la trésorerie');
  r = await announced({ label: 'Achats au-delà du flottant : 8 + 8 M$ (banque à −20 000 parts), 1 M$', buys: [['Bob', 8], ['Carol', 8]], amount: 1 });
  ok(near(r.paid.Alice, 0.3, CENTIME) && near(r.paid.Bob, 0.4, CENTIME) && near(r.totalPaid, 1.1, CENTIME), 'montant par part fixe (5 $/part) : Alice 0,30 ; Bob 0,40 ; Carol 0,40');
  ok(near(r.bankPays, 0.1, CENTIME) && near(r.returned, 0, CENTIME), 'l’entreprise paie 1,00 M$, la banque paie 0,10 M$ (= 5 $/part × 20 000 parts négatives)');
  r = await announced({ label: 'Achats au-delà du flottant : 10 + 10 M$ (banque à −60 000 parts), 2 M$', buys: [['Bob', 10], ['Carol', 10]], amount: 2 });
  ok(near(r.paid.Alice, 0.6, CENTIME) && near(r.paid.Bob, 1, CENTIME) && near(r.bankPays, 0.6, CENTIME), 'Alice 0,60 (30 % des parts émises, plus de dilution) ; Bob 1,00 ; Carol 1,00 ; la banque paie 0,60');

  // Revente par les sur-détenteurs entre l'annonce et le versement : la base se calcule AU VERSEMENT.
  r = await announced({ label: 'Revente totale avant le versement : Dave 2, Bob 10, Carol 10 M$ (banque −80 000), 1 M$ annoncé, Bob et Carol revendent tout', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Dave', 2], ['Bob', 10], ['Carol', 10]], between: [['Bob', 'sell', 10], ['Carol', 'sell', 10]], amount: 1 });
  ok(near(r.paid.Alice, 0.3, CENTIME) && near(r.paid.Dave, 0.1, CENTIME) && near(r.returned, 0.6, CENTIME) && near(r.bankPays, 0, CENTIME), 'les porteurs restés fidèles ne sont plus sous-payés : Alice 0,30, Dave 0,10 ; 0,60 rendu à la trésorerie ; la banque (redevenue positive) ne paie rien');
  r = await announced({ label: 'Revente partielle : mêmes achats, Bob revend la moitié (banque −30 000 au versement)', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Dave', 2], ['Bob', 10], ['Carol', 10]], between: [['Bob', 'sell', 5]], amount: 1 });
  ok(near(r.paid.Bob, 0.25, CENTIME) && near(r.paid.Carol, 0.5, CENTIME) && near(r.bankPays, 0.15, CENTIME), 'Bob reçoit sur ses 50 000 parts restantes (0,25), Carol 0,50 ; la banque paie 0,15 (= 5 $/part × 30 000)');
  // Achat APRÈS l'annonce : l'acheteur n'est pas éligible, la banque ne paie que l'excédent réellement versé.
  r = await announced({ label: 'Achat après l’annonce : 8 + 8 M$, 1 M$ annoncé, puis Dave achète 2 M$ (banque −40 000 au versement)', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Bob', 8], ['Carol', 8]], between: [['Dave', 'buy', 2]], amount: 1 });
  ok(near(r.paid.Dave || 0, 0, CENTIME) && near(r.totalPaid, 1.1, CENTIME) && near(r.bankPays, 0.1, CENTIME), 'Dave n’est pas éligible ; 1,10 versé, la banque paie l’excédent réel (0,10), pas 0,20');

  // Découverts ouverts.
  r = await announced({ label: 'Découvert + surdétention : achats 10 + 10 M$ et Dave à découvert de 2 M$ (banque −80 000), 1 M$', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Bob', 10], ['Carol', 10]], shorts: [['Dave', 2]], amount: 1 });
  ok(near(r.totalPaid, 1.3, CENTIME) && near(r.bankPays, 0.3, CENTIME) && near(r.comp, 0.1, CENTIME), 'porteurs 1,30 ; la banque paie 0,30 (surdétention de 60 000 parts) ; Dave paie 0,10 à la banque (20 000 parts empruntées)');
  r = await announced({ label: 'Non-régression : Bob à découvert de 2 M$ seul (banque positive), 1 M$', shorts: [['Bob', 2]], amount: 1 });
  ok(near(r.paid.Alice, 0.3, CENTIME) && near(r.comp, 0.1, CENTIME) && near(r.returned, 0.7, CENTIME) && near(r.bankPays, 0, CENTIME), 'découvert seul : Alice 0,3 ; Bob paie 0,1 de compensation ; 0,7 rendu à la trésorerie (inchangé)');

  // ===== 2. Auto-versement (dividende récurrent) =====
  console.log('\n2. Auto-versement (dividende récurrent, 300 K$ par semestre)');
  r = await auto({ label: 'Témoin : achats 7 + 7 M$ (banque à 0)', buys: [['Bob', 7], ['Carol', 7]] });
  ok(near(r.totalPaid, 0.3, CENTIME) && near(r.bankPays, 0, CENTIME), '300 K$ versés, la banque ne paie rien');
  r = await auto({ label: 'Témoin : achats 6 + 6 M$ (banque positive)', buys: [['Bob', 6], ['Carol', 6]] });
  ok(near(r.returned, 0.03, CENTIME), 'banque positive : 30 K$ (sa part) rendus à la trésorerie (section 256 inchangée)');
  r = await auto({ label: 'Achats au-delà du flottant : 10 + 10 M$ (banque à −60 000 parts)', buys: [['Bob', 10], ['Carol', 10]] });
  ok(near(r.paid.Bob, 0.15, CENTIME) && near(r.totalPaid, 0.39, CENTIME) && near(r.bankPays, 0.09, CENTIME), 'Bob et Carol 0,15 chacun, total 0,39 : l’entreprise paie 0,30 et la banque 0,09');
  r = await auto({ label: 'Achats au-delà du flottant : 14 + 14 M$ (banque à −140 000 parts)', buys: [['Bob', 14], ['Carol', 14]] });
  ok(near(r.totalPaid, 0.51, CENTIME) && near(r.bankPays, 0.21, CENTIME), 'total 0,51 : la banque paie 0,21');
  r = await auto({ label: 'Découvert + surdétention : 10 + 10 M$ et Dave à découvert de 2 M$', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Bob', 10], ['Carol', 10]], shorts: [['Dave', 2]] });
  ok(near(r.bankPays, 0.09, CENTIME) && near(r.comp, 0.03, CENTIME), 'la banque paie 0,09 ; Dave paie 0,03 à la banque');
  r = await auto({ label: 'Non-régression : Bob à découvert de 2 M$ seul (banque positive)', shorts: [['Bob', 2]] });
  ok(near(r.paid.Alice, 0.09, CENTIME) && near(r.bankPays, 0, CENTIME), 'découvert seul : le CEO reçoit toujours référence × ses parts, la banque ne paie rien');

  // ===== 3. Puts écrits assignés (la banque livre les parts) =====
  for(const mode of ['auto', 'annonce']){
    console.log(`\n3. Puts écrits assignés — ${mode === 'auto' ? 'auto-versement de 300 K$' : 'dividende annoncé de 1 M$'}`);
    const g = await setup(['Alice', 'Bob', 'Carl'], ['dividende']);
    g.eng.run(`__A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = ${mode === 'auto'};`);
    const strike = g.eng.run(`__A().stockPrice`);
    for(const who of ['Bob', 'Carl']){
      // Section 314 — 1 000 puts dépassent le plafond de 15 % des options écrites (300 contrats) : position héritée,
      // ouverte plafond neutralisé le temps de l'ouverture (le sujet du test est l'assignation au-delà du flottant).
      const rr = g.eng.json(`(function(){ const realCap = optionWrittenCapContracts; optionWrittenCapContracts = function(){ return Infinity; }; try { const r = openOptionPosition(__A(), __P(${JSON.stringify(who)}), 'put', 'short', __A().stockPrice, 3, 1000); return {ok: !!(r && r.ok), error: r && r.error}; } finally { optionWrittenCapContracts = realCap; } })()`);
      ok(rr.ok, `${who} écrit 1 000 puts ATM au strike ${strike}, couverts par l'encaisse (${rr.error || 'accepté'})`);
    }
    g.advance(2);
    g.eng.run(`__A().stockPrice = ${strike * 0.9};`); // le cours finit sous le strike : assignation au lancer 3
    g.advance(1);
    const H = g.holders();
    console.log('  après assignation :', JSON.stringify(Object.entries(H).map(([k, v]) => [k, Math.round(v)])));
    ok(H.BANK < -1 && near(H.Bob, 100000, 1e-6), `assignation : Bob reçoit 100 000 parts livrées par la banque, qui tombe à ${Math.round(H.BANK)}`);
    const issued = g.eng.run(`__A().sharesIssued`);
    const amount = mode === 'annonce' ? 1 : 1.5e-6 * issued;
    const m0 = g.money(), r0 = g.received(), co0 = g.eng.run(`__A().cash`), b0 = g.eng.run(`state.bank.cash`);
    if(mode === 'annonce'){
      await g.announce(1);
      ok(g.eng.run(`state.dividendAnnouncements.length`) === 1, `annonce de 1 M$ enregistrée (alertes : ${JSON.stringify(g.alerts)})`);
    }
    g.advance(3);
    const paid = diff(g.received(), r0);
    const res = checkPayout(g, { label: mode, perShare: amount / issued, debit: amount, Hann: mode === 'annonce' ? H : null, Hpay: g.holders(), shorts: [], paid, coCost: co0 - g.eng.run(`__A().cash`), bankDelta: g.eng.run(`state.bank.cash`) - b0, m0 });
    ok(near(res.totalPaid, amount * 1.3, CENTIME) && near(res.bankPays, amount * 0.3, CENTIME), `${f6(amount * 1.3)} versés : l’entreprise paie ${f6(amount)}, la banque ${f6(amount * 0.3)} (60 000 parts livrées au-delà du flottant)`);
  }

  if(failures.length){
    console.log(`\n${failures.length} vérification(s) en ÉCHEC (${n} OK) :`);
    failures.forEach((m) => console.log('  - ' + m));
    process.exit(1);
  }
  console.log(`\n${n} vérifications OK`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
