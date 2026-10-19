// Test — audit, bogue 4 (Section 307) : un dividende ordinaire ne verse JAMAIS plus que ce que l'entreprise débite,
// même quand la banque a une position négative (achats au-delà du flottant, assignation de puts écrits).
// Répartition attendue : chaque porteur positif reçoit montant × (ses parts ÷ base), où
//   base = max(sharesIssued, somme des parts détenues positivement — une position négative de la banque compte pour 0).
// La portion d'une banque POSITIVE retourne à la trésorerie ; les vendeurs à découvert paient au même taux par part.
// Couvre : dividende annoncé (vraie modale modalAnnounceDividend + advanceGameClock), auto-versement (dividende
// récurrent), puts écrits assignés, annonce enregistrée par l'ancien code (base = sharesIssued), non-régressions.
// Lancer depuis la racine du dépôt :  node tests/audit-bug4.test.js
const { loadEngine, check, near } = require('./helpers/engine');

const CENTIME = 1e-8; // 0,01 $ exprimé en M$ : tolérance « au centime près »
let n = 0;
const failures = [];
// Chaque vérification est indépendante : on note les échecs et on continue, pour voir TOUS les écarts d'un coup.
const ok = (cond, msg) => { try { check(cond, msg); n++; } catch(e){ failures.push(msg); console.log('  ' + e.message); } };
const f6 = (x) => Number(x).toFixed(6);

// ---------- Faux DOM minimal pour piloter la vraie modale d'annonce ----------
// Seuls « mOk » (bouton Annoncer) et « mDividendAmount » (champ du montant) sont de vrais éléments ;
// tout le reste du DOM reste le faux nœud permissif du banc d'essai.
function installModalDom(eng){
  const registry = new Map();
  const fallback = eng.sandbox.document.getElementById; // renvoie un faux nœud permissif
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
  // Tirages de cubes neutralisés : le cours reste fixe (il n'intervient pas dans la répartition du dividende).
  eng.run(`drawStockCubes = function(){ return []; }; resolveStockDraws = function(){ return {gameOver:false}; };`);
  eng.run(`globalThis.__A = () => state.companies.find(c=>c.ceoId===${JSON.stringify(ids[0])});`);
  eng.run(`globalThis.__P = (name) => state.players.find(p=>p.name===name);`);
  // Espion sur log() : garde les écritures des versements (pour isoler les paiements compensatoires des découverts).
  eng.run(`globalThis.__logs = []; globalThis.__realLog = log; log = function(msg, entries){ __logs.push({msg: String(msg), entries: entries ? JSON.parse(JSON.stringify(entries)) : []}); return __realLog.apply(this, arguments); };`);
  const compensation = (name) => eng.run(`__logs.filter(l=>/verse (son dividende|automatiquement)/.test(l.msg)).reduce((s,l)=>s+l.entries.filter(e=>e.label.indexOf(${JSON.stringify(name + ' (paiement compensatoire')})===0).reduce((t,e)=>t-e.amount,0),0)`);
  const dom = installModalDom(eng);
  const money = () => eng.cashTotal() + eng.run(`(state.dividendAnnouncements||[]).reduce((s,a)=>s+a.amount,0)`);
  const holders = () => eng.json(`__A().shareholders.map(s=>({id: s.playerId==='BANK' ? 'BANK' : state.players.find(p=>p.id===s.playerId).name, shares: s.shares}))`);
  const received = () => eng.json(`Object.fromEntries(state.players.map(p=>[p.name, p.cumDividendsReceived||0]))`);
  const cash = () => eng.json(`Object.fromEntries(state.players.map(p=>[p.name, p.cash]))`);
  const buy = (name, amount) => eng.json(`(function(){ const r = tradeCompanyShares(__A(), __P(${JSON.stringify(name)}), 'buy', ${amount}); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
  async function announce(amount){
    eng.run(`myPlayerId = ${JSON.stringify(ids[0])};`);
    dom.reset(); dom.add('mOk'); const input = dom.add('mDividendAmount');
    eng.run(`modalAnnounceDividend()`);
    input.value = String(amount);
    await dom.get('mOk').fire('click');
  }
  const advance = (k) => { for(let i = 0; i < k; i++) eng.run(`advanceGameClock()`); };
  return { eng, ids, alerts, money, holders, received, cash, buy, announce, advance, compensation };
}

// Base attendue : max(sharesIssued, somme des positions positives — banque négative comptée 0).
function expectedBasis(holders, sharesIssued){
  const pos = holders.reduce((s, h) => s + Math.max(0, h.shares), 0);
  return Math.max(sharesIssued, pos);
}
const diff = (after, before) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - (before[k] || 0)]));
const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);

// Scénario d'un dividende ANNONCÉ par la vraie modale, payé au semestre suivant par le vrai advanceGameClock.
async function announcedScenario({ label, buys = [], shorts = [], amount, names = ['Alice', 'Bob', 'Carol'] }){
  console.log(`\n${label}`);
  const g = await setup(names, ['garp']);
  for(const [who, amt] of buys){ const r = g.buy(who, amt); ok(r.ok, `${who} achète ${amt} M$ d'Alpha (${r.error || 'accepté'})`); }
  for(const [who, amt] of shorts){
    const r = g.eng.json(`(function(){ const r = openShortPosition(__A(), __P(${JSON.stringify(who)}), ${amt}); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
    ok(r.ok, `${who} vend ${amt} M$ d'Alpha à découvert (${r.error || 'accepté'})`);
  }
  const H = g.holders();
  const issued = g.eng.run(`__A().sharesIssued`);
  const bank = (H.find(h => h.id === 'BANK') || { shares: 0 }).shares;
  console.log('  actionnaires :', JSON.stringify(H.map(h => [h.id, Math.round(h.shares)])), '— parts émises', issued);
  const m0 = g.money(), co0 = g.eng.run(`__A().cash`), r0 = g.received();
  await g.announce(amount);
  const anns = g.eng.json(`state.dividendAnnouncements.map(a=>({amount:a.amount, basis:a.totalSharesAtAnnouncement, rec:a.recordHolders.reduce((s,h)=>s+h.shares,0)}))`);
  ok(anns.length === 1 && near(anns[0].amount, amount), `l'annonce de ${amount} M$ est enregistrée (alertes : ${JSON.stringify(g.alerts)})`);
  ok(near(co0 - g.eng.run(`__A().cash`), amount, CENTIME), `la trésorerie d'Alpha est débitée de ${amount} M$ à l'annonce`);
  ok(anns[0].basis >= anns[0].rec - 1e-9, `la base enregistrée (${anns[0].basis}) couvre les parts des détenteurs enregistrés (${anns[0].rec})`);
  g.advance(3); // lancers 1, 2, 3 : versement à la frontière de semestre
  ok(g.eng.run(`state.dividendAnnouncements.length`) === 0, 'le dividende annoncé est versé au semestre suivant');
  const paid = diff(g.received(), r0);
  const totalPaid = sum(paid);
  const returned = g.eng.run(`__A().cash`) - (co0 - amount);
  const basis = expectedBasis(H, issued);
  console.log('  reçus :', Object.entries(paid).map(([k, v]) => `${k} ${f6(v)}`).join(' / '), `— total ${f6(totalPaid)} pour ${f6(amount)} débité ; retour trésorerie ${f6(returned)}`);
  ok(totalPaid <= amount + CENTIME, `le total versé (${f6(totalPaid)}) ne dépasse pas le montant débité (${f6(amount)})`);
  for(const h of H){
    if(h.id === 'BANK' || h.shares <= 1e-9) continue;
    ok(near(paid[h.id], amount * h.shares / basis, CENTIME), `${h.id} reçoit ${amount} × ${Math.round(h.shares)} / ${Math.round(basis)} = ${f6(amount * h.shares / basis)}`);
  }
  const bankPortion = amount * Math.max(0, bank) / basis;
  const shortPortion = amount * shorts.reduce((s, [who]) => s + g.eng.run(`(__P(${JSON.stringify(who)}).shortPositions||{})[__A().id] ? __P(${JSON.stringify(who)}).shortPositions[__A().id].shares : 0`), 0) / basis;
  ok(near(totalPaid + returned, amount, CENTIME), `conservation : versé (${f6(totalPaid)}) + retour trésorerie (${f6(returned)}) = débité (${f6(amount)})`);
  ok(near(returned, amount - totalPaid, CENTIME) && returned >= -CENTIME, `la portion non versée (${f6(returned)}) revient à la trésorerie, jamais négative`);
  if(bank >= 0) ok(near(returned, bankPortion + shortPortion, CENTIME), `banque positive : la remise vaut la part de la banque${shorts.length ? ' et des parts prêtées à découvert' : ''} (${f6(bankPortion + shortPortion)})`);
  // Vendeurs à découvert : paiement compensatoire au même taux par part que les porteurs.
  let compTotal = 0;
  for(const [who] of shorts){
    const sh = g.eng.run(`__P(${JSON.stringify(who)}).shortPositions[__A().id].shares`);
    const owed = g.compensation(who);
    compTotal += owed;
    ok(owed > 0 && near(owed / sh, amount / basis, 1e-12), `${who} (à découvert sur ${Math.round(sh)} parts) paie ${f6(owed)}, soit le même taux par part que les porteurs (${amount} / ${Math.round(basis)})`);
  }
  const m1 = g.money();
  ok(near(m1, m0, CENTIME), `masse monétaire conservée : ${f6(m0)} → ${f6(m1)} (Δ=${f6(m1 - m0)})`);
  return { g, paid, totalPaid, returned, basis, bank, compTotal };
}

// Scénario d'AUTO-VERSEMENT (dividende récurrent) : référence 1,5 $/part → 300 K$ pour 200 000 parts émises.
async function autoScenario({ label, buys = [], shorts = [], names = ['Alice', 'Bob', 'Carol'] }){
  console.log(`\n${label}`);
  const g = await setup(names, ['dividende']);
  g.eng.run(`__A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = true;`);
  for(const [who, amt] of buys){ const r = g.buy(who, amt); ok(r.ok, `${who} achète ${amt} M$ d'Alpha (${r.error || 'accepté'})`); }
  for(const [who, amt] of shorts){
    const r = g.eng.json(`(function(){ const r = openShortPosition(__A(), __P(${JSON.stringify(who)}), ${amt}); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
    ok(r.ok, `${who} vend ${amt} M$ d'Alpha à découvert (${r.error || 'accepté'})`);
  }
  const H = g.holders(); const issued = g.eng.run(`__A().sharesIssued`);
  const bank = (H.find(h => h.id === 'BANK') || { shares: 0 }).shares;
  console.log('  actionnaires :', JSON.stringify(H.map(h => [h.id, Math.round(h.shares)])), '— parts émises', issued);
  const autoAmount = 1.5e-6 * issued;
  const m0 = g.money(), co0 = g.eng.run(`__A().cash`), r0 = g.received();
  g.advance(3);
  const paid = diff(g.received(), r0); const totalPaid = sum(paid);
  const coDelta = g.eng.run(`__A().cash`) - co0;
  const basis = expectedBasis(H, issued);
  console.log('  reçus :', Object.entries(paid).map(([k, v]) => `${k} ${f6(v)}`).join(' / '), `— total ${f6(totalPaid)} ; trésorerie ${f6(coDelta)}`);
  ok(totalPaid <= autoAmount + CENTIME, `auto-versement : total versé (${f6(totalPaid)}) ≤ montant débité (${f6(autoAmount)})`);
  for(const h of H){
    if(h.id === 'BANK' || h.shares <= 1e-9) continue;
    ok(near(paid[h.id], autoAmount * h.shares / basis, CENTIME), `${h.id} reçoit ${f6(autoAmount)} × ${Math.round(h.shares)} / ${Math.round(basis)} = ${f6(autoAmount * h.shares / basis)}`);
  }
  ok(near(-coDelta, totalPaid, CENTIME), `conservation : coût net pour Alpha (${f6(-coDelta)}) = total versé (${f6(totalPaid)})`);
  if(bank >= 0 && !shorts.length) ok(near(-coDelta, 1.5e-6 * (issued - bank), CENTIME), `banque positive : coût net = référence × (parts émises − parts banque) (section 256 inchangée)`);
  for(const [who] of shorts){
    const sh = g.eng.run(`__P(${JSON.stringify(who)}).shortPositions[__A().id].shares`);
    const owed = g.compensation(who);
    ok(owed > 0 && near(owed / sh, autoAmount / basis, 1e-12), `${who} (à découvert sur ${Math.round(sh)} parts) paie ${f6(owed)}, soit le même taux par part que les porteurs (${f6(autoAmount)} / ${Math.round(basis)})`);
  }
  const m1 = g.money();
  ok(near(m1, m0, CENTIME), `masse monétaire conservée : ${f6(m0)} → ${f6(m1)} (Δ=${f6(m1 - m0)})`);
  return { g, paid, totalPaid, basis };
}

(async () => {
  // ===== 1. Dividende annoncé =====
  console.log('1. Dividende annoncé (vraie modale + advanceGameClock)');
  await announcedScenario({ label: 'Témoin : achats 7 + 7 M$ (exactement le flottant, banque à 0)', buys: [['Bob', 7], ['Carol', 7]], amount: 1 });
  const t6 = await announcedScenario({ label: 'Témoin : achats 6 + 6 M$ (banque positive, 20 000 parts)', buys: [['Bob', 6], ['Carol', 6]], amount: 1 });
  ok(near(t6.paid.Alice, 0.3, CENTIME) && near(t6.paid.Bob, 0.3, CENTIME) && near(t6.returned, 0.1, CENTIME), 'non-régression : 0,3 / 0,3 / 0,3 versés et 0,1 M$ (part de la banque) rendu à la trésorerie');
  const d8 = await announcedScenario({ label: 'Défaut : achats 8 + 8 M$ (banque à −20 000 parts), 1 M$ annoncé', buys: [['Bob', 8], ['Carol', 8]], amount: 1 });
  ok(d8.bank < 0, `la banque est bien négative (${Math.round(d8.bank)} parts)`);
  ok(near(d8.totalPaid, 1, CENTIME), `exactement 1,00 M$ distribué (et non 1,10 M$) : ${f6(d8.totalPaid)}`);
  const d10 = await announcedScenario({ label: 'Variante : achats 10 + 10 M$ (banque à −60 000 parts), 2 M$ annoncés', buys: [['Bob', 10], ['Carol', 10]], amount: 2 });
  ok(near(d10.totalPaid, 2, CENTIME), `exactement 2,00 M$ distribués (et non 2,60 M$) : ${f6(d10.totalPaid)}`);
  ok(near(d10.paid.Alice, 2 * 60000 / 260000, CENTIME), 'le CEO reçoit 2 × 60 000 / 260 000 (base = parts réellement détenues)');

  // Vendeur à découvert + banque négative au-delà des découverts : la base reste les parts détenues positivement.
  const s1 = await announcedScenario({ label: 'Variante : achats 10 + 10 M$ et Dave à découvert de 2 M$ (banque à −80 000), 1 M$ annoncé', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Bob', 10], ['Carol', 10]], shorts: [['Dave', 2]], amount: 1 });
  ok(near(s1.totalPaid, 1, CENTIME), `découvert + surdétention : 1,00 M$ distribué aux porteurs (${f6(s1.totalPaid)})`);
  ok(near(s1.compTotal, 1 * 20000 / 260000, CENTIME), `le paiement compensatoire de Dave (${f6(s1.compTotal)}) vaut 20 000 × 1 / 260 000`);
  // Découvert seul, banque positive : règle inchangée (taux = montant / parts émises).
  const s2 = await announcedScenario({ label: 'Non-régression : Bob à découvert de 2 M$ seul (banque positive), 1 M$ annoncé', buys: [], shorts: [['Bob', 2]], amount: 1 });
  ok(near(s2.paid.Alice, 0.3, CENTIME) && near(s2.compTotal, 0.1, CENTIME) && near(s2.returned, 0.7, CENTIME), 'découvert seul : Alice 0,3 ; Bob paie 0,1 de compensation ; 0,7 rendu à la trésorerie (inchangé)');

  // Annonce enregistrée par l'ANCIEN code (base = sharesIssued) dans une partie sauvegardée : le versement est quand même plafonné.
  console.log('\nAnnonce héritée (base = sharesIssued) avec banque à −60 000 parts');
  {
    const g = await setup(['Alice', 'Bob', 'Carol'], ['garp']);
    ok(g.buy('Bob', 10).ok && g.buy('Carol', 10).ok, 'Bob et Carol achètent 10 M$ chacun');
    const m0 = g.money(), r0 = g.received();
    g.eng.run(`(function(){ const co = __A(); co.cash -= 2; logFin(co.id, 'dividend_payout', -2);
      state.dividendAnnouncements.push({ id: uid(), companyId: co.id, amount: 2, announcedAtRoll: 0, payAtRoll: 3,
        recordHolders: co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9).map(h=>({playerId:h.playerId, shares:h.shares})),
        totalSharesAtAnnouncement: co.sharesIssued }); })()`);
    const co0 = g.eng.run(`__A().cash`);
    g.advance(3);
    const paid = sum(diff(g.received(), r0));
    ok(near(paid, 2, CENTIME), `annonce héritée : 2,00 M$ distribués (et non 2,60 M$) : ${f6(paid)}`);
    ok(near(g.eng.run(`__A().cash`), co0, CENTIME), 'aucun reliquat négatif ni positif sur la trésorerie');
    ok(near(g.money(), m0, CENTIME), `masse monétaire conservée (Δ=${f6(g.money() - m0)})`);
  }

  // ===== 2. Auto-versement (dividende récurrent) =====
  console.log('\n2. Auto-versement (dividende récurrent, 300 K$ par semestre)');
  const a7 = await autoScenario({ label: 'Témoin : achats 7 + 7 M$ (banque à 0)', buys: [['Bob', 7], ['Carol', 7]] });
  ok(near(a7.paid.Alice, 0.09, CENTIME), 'non-régression : le CEO reçoit exactement référence × ses parts (0,09 M$)');
  await autoScenario({ label: 'Témoin : achats 6 + 6 M$ (banque positive)', buys: [['Bob', 6], ['Carol', 6]] });
  const a10 = await autoScenario({ label: 'Défaut : achats 10 + 10 M$ (banque à −60 000 parts)', buys: [['Bob', 10], ['Carol', 10]] });
  ok(near(a10.totalPaid, 0.3, CENTIME), `exactement 300 K$ distribués (et non 390 K$) : ${f6(a10.totalPaid)}`);
  const a14 = await autoScenario({ label: 'Défaut : achats 14 + 14 M$ (encaisse complète, banque à −140 000 parts)', buys: [['Bob', 14], ['Carol', 14]] });
  ok(near(a14.totalPaid, 0.3, CENTIME), `exactement 300 K$ distribués (et non 510 K$) : ${f6(a14.totalPaid)}`);
  const as = await autoScenario({ label: 'Variante : achats 10 + 10 M$ et Dave à découvert de 2 M$ (banque à −80 000)', names: ['Alice', 'Bob', 'Carol', 'Dave'], buys: [['Bob', 10], ['Carol', 10]], shorts: [['Dave', 2]] });
  ok(near(as.totalPaid, 0.3, CENTIME), `découvert + surdétention : exactement 300 K$ distribués aux porteurs (${f6(as.totalPaid)})`);
  const as2 = await autoScenario({ label: 'Non-régression : Bob à découvert de 2 M$ seul (banque positive)', shorts: [['Bob', 2]] });
  ok(near(as2.paid.Alice, 0.09, CENTIME) && near(as2.basis, 200000, 1e-6), 'découvert seul : le CEO reçoit toujours référence × ses parts (base = parts émises)');

  // ===== 3. Puts écrits assignés (la banque livre les parts) =====
  for(const mode of ['auto', 'annonce']){
    console.log(`\n3. Puts écrits assignés — ${mode === 'auto' ? 'auto-versement de 300 K$' : 'dividende annoncé de 1 M$'}`);
    const g = await setup(['Alice', 'Bob', 'Carl'], ['dividende']);
    g.eng.run(`__A().dividendBenchmarkPerShare = 1.5e-6; __A().dividendAutoPay = ${mode === 'auto'};`);
    const strike = g.eng.run(`__A().stockPrice`);
    for(const who of ['Bob', 'Carl']){
      const r = g.eng.json(`(function(){ const r = openOptionPosition(__A(), __P(${JSON.stringify(who)}), 'put', 'short', __A().stockPrice, 3, 1000); return {ok: !!(r && r.ok), error: r && r.error}; })()`);
      ok(r.ok, `${who} écrit 1 000 puts ATM au strike ${strike} (${r.error || 'accepté'})`);
    }
    g.advance(2);
    g.eng.run(`__A().stockPrice = ${strike * 0.9};`); // le cours finit sous le strike : assignation au lancer 3
    g.advance(1);
    const H = g.holders();
    const bank = H.find(h => h.id === 'BANK').shares;
    console.log('  après assignation :', JSON.stringify(H.map(h => [h.id, Math.round(h.shares)])));
    ok(bank < -1 && near(H.find(h => h.id === 'Bob').shares, 100000, 1e-6), `assignation : Bob reçoit 100 000 parts livrées par la banque, qui tombe à ${Math.round(bank)}`);
    const issued = g.eng.run(`__A().sharesIssued`);
    const basis = expectedBasis(H, issued);
    let amount;
    if(mode === 'annonce'){ amount = 1; }
    else amount = 1.5e-6 * issued;
    const m0 = g.money(), r0 = g.received(), co0 = g.eng.run(`__A().cash`);
    if(mode === 'annonce'){
      await g.announce(1);
      ok(g.eng.run(`state.dividendAnnouncements.length`) === 1, `annonce de 1 M$ enregistrée (alertes : ${JSON.stringify(g.alerts)})`);
    }
    g.advance(3); // lancers 4, 5, 6 : versement au semestre suivant
    const paid = diff(g.received(), r0); const totalPaid = sum(paid);
    console.log('  reçus :', Object.entries(paid).map(([k, v]) => `${k} ${f6(v)}`).join(' / '), `— total ${f6(totalPaid)} pour ${f6(amount)}`);
    ok(near(totalPaid, amount, CENTIME), `exactement ${f6(amount)} M$ distribués (et non ${f6(amount * 260000 / 200000)})`);
    ok(near(paid.Alice, amount * 60000 / basis, CENTIME) && near(paid.Bob, amount * 100000 / basis, CENTIME), `répartition sur les parts réellement détenues (base ${Math.round(basis)})`);
    ok(near(co0 - g.eng.run(`__A().cash`), amount, CENTIME), `l'entreprise débite exactement ${f6(amount)} M$`);
    ok(near(g.money(), m0, CENTIME), `masse monétaire conservée (Δ=${f6(g.money() - m0)})`);
  }

  if(failures.length){
    console.log(`\n${failures.length} vérification(s) en ÉCHEC (${n} OK) :`);
    failures.forEach((m) => console.log('  - ' + m));
    process.exit(1);
  }
  console.log(`\n${n} vérifications OK`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
