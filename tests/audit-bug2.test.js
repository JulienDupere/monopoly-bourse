// Test — audit, bogue 2 (Section 307) : parts privilégiées, une annonce de vente ne peut jamais porter plus
// de parts que le vendeur n'en détient réellement.
//   (a) à la mise en vente : parts déjà annoncées par ce porteur sur l'émission + nouvelle annonce <= parts détenues ;
//   (b) à l'achat : quantité transférée plafonnée à la détention du vendeur à cet instant ; détention nulle =>
//       annonce retirée, achat refusé avec un message clair ; l'acheteur ne paie que les parts transférées ;
//   (c) après un rachat (call) ou tout autre mouvement, les annonces sont réduites à la nouvelle détention, ou
//       retirées si elles tombent à 0 (y compris pour une partie sauvegardée avant le correctif : migrateState).
// Partout : conservation de la monnaie (argent débité = argent crédité) et somme des détenteurs = parts en circulation.
// Lancer depuis la racine du dépôt :  node tests/audit-bug2.test.js
const { loadEngine, check, near } = require('./helpers/engine');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const M = (x) => Number(x).toFixed(6);

// Partie à 5 joueurs ; Alice est CEO d'Alpha, cours 100 $ (0,0001 M$). Alpha émet 20 000 privilégiées
// (dividende 5 %, rachat 150 $ = 0,00015 M$) ; Bob et Dave acceptent et reçoivent 10 000 parts chacun.
async function setup(){
  const eng = loadEngine();
  await eng.newGame(['Alice', 'Bob', 'Carol', 'Dave', 'Eve'], ['garp']);
  eng.run(`globalThis.P = {}; state.players.forEach(p=>P[p.name]=p);
    globalThis.A = ()=>state.companies[0];
    globalThis.ISS = ()=>state.companies[0].preferredIssuances[0];
    globalThis.nameOf = (id)=>{ const p = state.players.find(x=>x.id===id); return p ? p.name : '?'; };
    A().stockPrice = 0.0001; state.gameClock.rollCount = 0;`);
  const r = await eng.run(`attemptActionWithRetry(()=>issuePreferredShares(A().id, 20000, 0.05, 0.00015, {silent:true}))`);
  if(!r || !r.ok) throw new Error('émission refusée : ' + (r && r.error));
  await eng.run(`respondToPreferredIssuance(ISS().id, P.Bob, true)`);
  await eng.run(`respondToPreferredIssuance(ISS().id, P.Dave, true)`);
  eng.run(`state.gameClock.rollCount = 1; resolvePendingPreferredIssuances(); state.gameClock.rollCount = 3;`);
  if(!eng.run(`tradingWindowOpen()`)) throw new Error('le marché devrait être ouvert (frontière de semestre)');

  const act = async (expr) => {
    const res = await eng.run(`attemptActionWithRetry(()=>${expr})`);
    return { ok: !!(res && res.ok), error: (res && res.error) || '' };
  };
  const holders = () => eng.json(`ISS().holders.map(h=>({n:nameOf(h.playerId), q:h.qty}))`);
  const held = (name) => { const h = holders().find(x => x.n === name); return h ? h.q : 0; };
  const listings = () => eng.json(`state.preferredMarketListings.map(l=>({id:l.id, n:nameOf(l.sellerId), q:l.qty}))`);
  const listedBy = (name) => listings().filter(l => l.n === name).reduce((s, l) => s + l.q, 0);
  const cash = (name) => eng.run(`P.${name}.cash`);
  const playersCash = () => eng.run(`state.players.reduce((s,p)=>s+p.cash,0)`);
  const coCash = () => eng.run(`A().cash`);
  const outstanding = () => eng.run(`ISS().qtyOutstanding`);
  const list = (name, qty) => act(`listPreferredSharesForSale(A().id, ISS().id, P.${name}, ${qty}, {silent:true})`);
  const buy = (listingId, name, qty) => act(`buyPreferredSharesFromListing(${JSON.stringify(listingId)}, P.${name}.id, ${qty}, {silent:true})`);
  const call = (qty) => act(`callPreferredShares(A().id, ISS().id, ${qty}, {silent:true})`);

  // Invariants vérifiés après chaque étape : détenteurs = parts en circulation, et aucune annonce ne dépasse la
  // détention réelle de son vendeur.
  const invariants = (label) => {
    const sum = holders().reduce((s, h) => s + h.q, 0);
    ok(near(sum, outstanding()), `${label} : somme des détenteurs (${sum}) = parts en circulation (${outstanding()})`);
    const sellers = [...new Set(listings().map(l => l.n))];
    const over = sellers.filter(s => listedBy(s) > held(s) + 1e-9).map(s => `${s} annonce ${listedBy(s)} pour ${held(s)} détenue(s)`);
    ok(over.length === 0, `${label} : aucune annonce ne dépasse la détention du vendeur${over.length ? ' — ' + over.join(', ') : ''}`);
  };
  // Un rachat ne doit ni créer ni détruire d'argent : l'entreprise paie exactement ce que les joueurs reçoivent.
  const callConserves = async (qty, label) => {
    const t0 = eng.cashTotal(), co0 = coCash(), pl0 = playersCash();
    const r = await call(qty);
    ok(r.ok, `${label} : rachat de ${qty} parts accepté${r.ok ? '' : ' — ' + r.error}`);
    const coDelta = coCash() - co0, plDelta = playersCash() - pl0;
    ok(near(coDelta, -qty * 0.00015), `${label} : l'entreprise paie ${M(-coDelta)} M$ (attendu ${M(qty * 0.00015)})`);
    ok(near(plDelta, -coDelta), `${label} : les joueurs reçoivent ${M(plDelta)} M$ = montant payé par l'entreprise`);
    ok(near(eng.cashTotal(), t0), `${label} : total du système inchangé (${M(t0)} -> ${M(eng.cashTotal())})`);
  };

  ok(near(held('Bob'), 10000) && near(held('Dave'), 10000) && near(outstanding(), 20000), 'émission résolue : Bob 10 000, Dave 10 000, 20 000 en circulation');
  return { eng, act, holders, held, listings, listedBy, cash, playersCash, coCash, outstanding, list, buy, call, invariants, callConserves };
}

const scenarios = [];

// ---------- Cas A (fiche) : annonce, puis rachat partiel, puis achat de bonne foi, puis rachat du solde ----------
scenarios.push(['Cas A — annonce puis rachat partiel', async () => {
  const t = await setup();
  const T0 = t.eng.cashTotal();
  let r = await t.list('Bob', 10000);
  ok(r.ok, 'Bob met ses 10 000 parts en vente');
  await t.callConserves(10000, 'rappel de 10 000 parts');
  ok(near(t.held('Bob'), 5000) && near(t.held('Dave'), 5000), 'après le rappel, Bob et Dave détiennent 5 000 parts chacun');
  ok(near(t.listedBy('Bob'), 5000), `l'annonce de Bob est réduite à sa nouvelle détention (5 000) — elle porte ${t.listedBy('Bob')}`);
  t.invariants('après le rappel partiel');

  const listingId = t.listings()[0].id;
  const bob0 = t.cash('Bob'), carol0 = t.cash('Carol');
  r = await t.buy(listingId, 'Carol', 10000);
  ok(!r.ok, `Carol ne peut pas acheter 10 000 parts sur une annonce qui n'en porte plus que 5 000${r.ok ? '' : ' (« ' + r.error + ' »)'}`);
  ok(near(t.cash('Bob'), bob0) && near(t.cash('Carol'), carol0), 'aucun argent ne bouge sur un achat refusé');
  r = await t.buy(listingId, 'Carol', 5000);
  ok(r.ok, `Carol achète les 5 000 parts réellement en vente${r.ok ? '' : ' — ' + r.error}`);
  ok(near(t.cash('Bob') - bob0, 0.5), `Bob encaisse 0,5 M$ (5 000 × 100 $) — reçu ${M(t.cash('Bob') - bob0)}`);
  ok(near(carol0 - t.cash('Carol'), t.cash('Bob') - bob0), 'Carol paie exactement ce que Bob encaisse');
  ok(near(t.held('Carol'), 5000) && near(t.held('Bob'), 0), 'Carol détient 5 000 parts, Bob plus aucune');
  ok(t.listings().length === 0, 'l\'annonce épuisée disparaît');
  t.invariants('après l\'achat de Carol');

  await t.callConserves(10000, 'rappel du solde (10 000 parts)');
  ok(t.holders().length === 0 && near(t.outstanding(), 0), 'plus aucun détenteur ni aucune part en circulation');
  ok(near(t.eng.cashTotal(), T0), `cas A : total du système conservé de bout en bout (${M(T0)} -> ${M(t.eng.cashTotal())})`);
}]);

// ---------- Cas B (fiche) : rachat total pendant qu'une annonce est ouverte ----------
scenarios.push(['Cas B — rachat total, annonce ouverte', async () => {
  const t = await setup();
  const T0 = t.eng.cashTotal();
  let r = await t.list('Bob', 10000);
  ok(r.ok, 'Bob met ses 10 000 parts en vente');
  const listingId = t.listings()[0].id;
  await t.callConserves(20000, 'rappel total (20 000 parts)');
  ok(t.listings().length === 0, `l'annonce de Bob est retirée après le rachat total (annonces restantes : ${JSON.stringify(t.listings().map(l => l.q))})`);
  const bob0 = t.cash('Bob'), carol0 = t.cash('Carol'), nw0 = t.eng.run(`netWorth(P.Carol)`);
  r = await t.buy(listingId, 'Carol', 10000);
  ok(!r.ok, `l'achat de parts déjà rachetées est refusé${r.ok ? '' : ' (« ' + r.error + ' »)'}`);
  ok(near(t.cash('Bob'), bob0) && near(t.cash('Carol'), carol0), 'Bob n\'est pas payé une seconde fois, Carol ne paie rien');
  ok(t.holders().length === 0 && near(t.outstanding(), 0), 'aucune part fantôme : aucun détenteur pour 0 part en circulation');
  ok(near(t.eng.run(`netWorth(P.Carol)`), nw0), 'la valeur nette de Carol ne compte aucune part fantôme');
  ok(near(t.eng.cashTotal(), T0), 'cas B : total du système conservé');
}]);

// ---------- Cas C (fiche) : deux annonces avec les mêmes parts ----------
scenarios.push(['Cas C — deux annonces avec les mêmes parts', async () => {
  const t = await setup();
  const T0 = t.eng.cashTotal();
  let r = await t.list('Bob', 10000);
  ok(r.ok, 'première annonce de Bob (10 000 parts) acceptée');
  r = await t.list('Bob', 10000);
  ok(!r.ok, `seconde annonce de 10 000 parts refusée${r.ok ? '' : ' (« ' + r.error + ' »)'}`);
  ok(/déjà en vente/.test(r.error), 'le message de refus explique que les parts sont déjà en vente');
  r = await t.list('Bob', 1);
  ok(!r.ok, 'même 1 part de plus est refusée : tout est déjà annoncé');
  ok(t.listings().length === 1 && near(t.listedBy('Bob'), 10000), 'une seule annonce de 10 000 parts pour Bob');

  // Variante : plusieurs annonces dont la somme égale exactement la détention.
  r = await t.list('Dave', 6000);
  ok(r.ok, 'Dave annonce 6 000 parts');
  r = await t.list('Dave', 4000);
  ok(r.ok, 'Dave annonce 4 000 parts de plus (total 10 000 = sa détention)');
  r = await t.list('Dave', 1);
  ok(!r.ok, 'Dave ne peut rien annoncer au-delà de ses 10 000 parts');
  t.invariants('après les annonces');

  // Retirer une annonce libère les parts correspondantes.
  const dave4000 = t.listings().find(l => l.n === 'Dave' && near(l.q, 4000)).id;
  r = await t.eng.run(`cancelPreferredListing(${JSON.stringify(dave4000)}, P.Dave.id)`);
  ok(r && r.ok, 'Dave retire son annonce de 4 000 parts');
  r = await t.list('Dave', 4000);
  ok(r.ok, 'les 4 000 parts libérées peuvent être annoncées à nouveau');

  const bobListing = t.listings().find(l => l.n === 'Bob').id;
  const dave6000 = t.listings().find(l => l.n === 'Dave' && near(l.q, 6000)).id;
  const bob0 = t.cash('Bob'), dave0 = t.cash('Dave'), carol0 = t.cash('Carol'), eve0 = t.cash('Eve');
  r = await t.buy(bobListing, 'Carol', 10000);
  ok(r.ok, 'Carol achète l\'annonce de Bob');
  r = await t.buy(dave6000, 'Eve', 6000);
  ok(r.ok, 'Eve achète l\'annonce de 6 000 parts de Dave');
  ok(near(t.cash('Bob') - bob0, 1), `Bob encaisse 1 M$ une seule fois — reçu ${M(t.cash('Bob') - bob0)}`);
  ok(near(t.cash('Dave') - dave0, 0.6), 'Dave encaisse 0,6 M$');
  ok(near((carol0 - t.cash('Carol')) + (eve0 - t.cash('Eve')), (t.cash('Bob') - bob0) + (t.cash('Dave') - dave0)), 'les acheteurs paient exactement ce que les vendeurs encaissent');
  ok(near(t.listedBy('Dave'), 4000) && near(t.held('Dave'), 4000), 'il reste à Dave 4 000 parts et son annonce de 4 000 parts');
  t.invariants('après les achats');

  await t.callConserves(20000, 'rappel total (20 000 parts)');
  ok(t.listings().length === 0, 'l\'annonce restante de Dave est retirée par le rachat total');
  ok(near(t.eng.cashTotal(), T0), `cas C : aucun argent créé (${M(T0)} -> ${M(t.eng.cashTotal())})`);
}]);

// ---------- Annonce partielle puis rachat : l'annonce est réduite au prorata de la nouvelle détention ----------
scenarios.push(['Annonce partielle puis rachat', async () => {
  const t = await setup();
  let r = await t.list('Bob', 8000);
  ok(r.ok, 'Bob annonce 8 000 de ses 10 000 parts');
  await t.callConserves(10000, 'rappel de 10 000 parts');
  ok(near(t.listedBy('Bob'), 5000), `l'annonce de 8 000 parts est réduite aux 5 000 parts restantes — elle porte ${t.listedBy('Bob')}`);
  r = await t.list('Bob', 1);
  ok(!r.ok, 'Bob ne peut plus rien annoncer : ses 5 000 parts sont déjà en vente');
  await t.callConserves(4000, 'rappel de 4 000 parts');
  ok(near(t.held('Bob'), 3000) && near(t.listedBy('Bob'), 3000), 'Bob détient 3 000 parts, son annonce suit (3 000)');
  t.invariants('après deux rappels partiels');
}]);

// ---------- Partie sauvegardée AVANT le correctif : annonces déjà en excès ----------
scenarios.push(['Annonces héritées en excès (achat plafonné, migrateState)', async () => {
  const t = await setup();
  const T0 = t.eng.cashTotal();
  await t.callConserves(10000, 'rappel de 10 000 parts');
  // Annonces écrites directement dans l'état (sans passer par la mise en vente), comme dans une ancienne sauvegarde.
  t.eng.run(`state.preferredMarketListings.push({id:'old1', companyId:A().id, issuanceId:ISS().id, sellerId:P.Bob.id, qty:10000, createdAt:'ancien'});`);
  const bob0 = t.cash('Bob'), carol0 = t.cash('Carol');
  let r = await t.buy('old1', 'Carol', 10000);
  ok(r.ok, `achat sur une annonce périmée de 10 000 parts (Bob n'en a que 5 000)${r.ok ? '' : ' — ' + r.error}`);
  ok(near(t.held('Carol'), 5000), `seules les 5 000 parts réellement détenues sont transférées — Carol en reçoit ${t.held('Carol')}`);
  ok(near(carol0 - t.cash('Carol'), 0.5), `Carol ne paie que les parts transférées (0,5 M$) — payé ${M(carol0 - t.cash('Carol'))}`);
  ok(near(t.cash('Bob') - bob0, 0.5), 'Bob n\'encaisse que 0,5 M$');
  ok(t.listings().length === 0, 'l\'annonce périmée disparaît');
  t.invariants('après l\'achat plafonné');

  t.eng.run(`state.preferredMarketListings.push({id:'old2', companyId:A().id, issuanceId:ISS().id, sellerId:P.Bob.id, qty:3000, createdAt:'ancien'});`);
  const eve0 = t.cash('Eve'), bob1 = t.cash('Bob');
  r = await t.buy('old2', 'Eve', 3000);
  ok(!r.ok, `achat refusé quand le vendeur ne détient plus rien${r.ok ? '' : ' (« ' + r.error + ' »)'}`);
  ok(/ne détient plus/.test(r.error) && /retirée/.test(r.error), 'le message dit clairement que le vendeur ne détient plus ces parts et que l\'annonce est retirée');
  ok(near(t.cash('Eve'), eve0) && near(t.cash('Bob'), bob1), 'aucun argent ne bouge');
  ok(!t.listings().some(l => l.id === 'old2'), 'l\'annonce sans parts derrière est retirée');
  ok(t.held('Eve') === 0, 'Eve ne reçoit aucune part fantôme');

  // Chargement d'une ancienne sauvegarde : deux annonces de 4 000 (8 000 au total) pour Dave qui n'en détient
  // que 5 000, et une annonce de Bob qui n'en détient plus aucune.
  t.eng.run(`state.preferredMarketListings.push(
    {id:'old3', companyId:A().id, issuanceId:ISS().id, sellerId:P.Dave.id, qty:4000, createdAt:'ancien'},
    {id:'old4', companyId:A().id, issuanceId:ISS().id, sellerId:P.Dave.id, qty:4000, createdAt:'ancien'},
    {id:'old5', companyId:A().id, issuanceId:ISS().id, sellerId:P.Bob.id, qty:1000, createdAt:'ancien'});
    migrateState(state);`);
  const ls = t.listings();
  ok(ls.length === 2 && ls[0].id === 'old3' && near(ls[0].q, 4000) && ls[1].id === 'old4' && near(ls[1].q, 1000),
    `au chargement, les annonces de Dave sont ramenées à ses 5 000 parts (4 000 + 1 000) et celle de Bob est retirée — ${JSON.stringify(ls.map(l => [l.id, l.q]))}`);
  t.invariants('après migrateState');

  await t.callConserves(10000, 'rappel du solde (10 000 parts)');
  ok(t.listings().length === 0, 'plus aucune annonce après le rachat total');
  ok(near(t.eng.cashTotal(), T0), `total du système conservé de bout en bout (${M(T0)} -> ${M(t.eng.cashTotal())})`);
}]);

(async () => {
  const failures = [];
  for(const [name, fn] of scenarios){
    console.log(name);
    try { await fn(); }
    catch(e){ failures.push(`${name} : ${e.message}`); console.log('  ' + e.message); }
  }
  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec sur ${scenarios.length} :`);
    failures.forEach(f => console.log('  - ' + f));
    console.log(`ÉCHEC — ${failures.length} scénario(s) en échec (${n} vérifications OK avant l'échec)`);
    process.exit(1);
  }
  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error('ÉCHEC :', e && e.stack || e); process.exit(1); });
