// Test — section 323, pari du PDG, côté moteur (contrat docs/contrats/section-323-analystes.md, section 7) et zone
// à 0,35 × σ (décision D4).
//   A. Les refus (ceoCallRefusal) : fenêtre ouverte, après le premier lancer sur les trois chemins (lancer pour tous,
//      lancer d'une entreprise, pion neutre), après le gel seul, joueur qui ne dirige pas l'entreprise, deuxième
//      annonce, partie terminée, entreprise inactive, entreprise créée en cours de semestre, partie migrée en cours
//      de semestre, annonce inconnue, annonce périmée qui ne bloque pas ; entreprise sous enquête de l'AMF : annonce
//      permise (décision de Julien), à l'écran et dans l'action.
//   B. L'annonce (announceCeoCall, vraie action synchronisée) : cube immédiat (couleur, quantité, sac), argent
//      conservé, journal, enregistrement ; deuxième annonce et double clic refusés ; chiffres des analystes inchangés.
//   C. La clôture : avertissement et promesse × (fort au-dessus, normal au-dessus, zone au-dessus, zone en dessous,
//      normal en dessous, fort en dessous), quantités exactes, verdict et chiffres inchangés, ceoCall remis à null,
//      historique et ligne de journal ; axe Croissance inchangé ; parcours complet par le vrai lancer.
//   D. Deux appareils (faux serveur) : annonces simultanées, accusé perdu puis reconnexion (rejeu) : un seul cube.
//   E. Partie ancienne migrée, annonce périmée ignorée, semestre sans verdict, affichage sans erreur.
//   F. Versions cassées exprès (transform) : chacune doit être attrapée.
// Lancer depuis la racine du dépôt :  node tests/section323-pari.test.js
const { loadEngine, near } = require('./helpers/engine');
const { Reseau, partie: partieReseau, appareil, serveur, caisse } = require('./helpers/banc-319');

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}
const strip = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// --- Partie d'essai (hasard semé, comme tests/section323.test.js) --------------------------------------------
async function partie(opts = {}){
  let s = (opts.seed || 3237) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rnd;
  const eng = loadEngine({ globals: { Math: M, alert: () => {} }, transform: opts.transform });
  const names = opts.names || ['Alice', 'Bob'];
  const ids = await eng.newGame(names, opts.types || names.map(() => 'garp'), 50, 1000);
  eng.ids = ids;
  eng.run(`myPlayerId = ${JSON.stringify(ids[0])};
    globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };`);
  return eng;
}
const refus = (eng, who, pid) => eng.json(`ceoCallRefusal(${who}, ${JSON.stringify(pid)})`);
const logs = (eng, re) => eng.json(`state.log.map(l=>String(l.text||l))`).filter(t => re.test(t));

const SCENARIOS = [];
function scenario(key, title, fn){ SCENARIOS.push({ key, title, fn }); }

// --- A. Refus ------------------------------------------------------------------------------------------------
scenario('refus', 'A. Refus : fenêtre, gel sur tous les chemins, dirigeant, une seule annonce, fin de partie, inactive, sans verdict', async (tf) => {
  const eng = await partie({ transform: tf });
  const [alice, bob] = eng.ids;
  ok(refus(eng, 'A', alice) === null, 'fenêtre du tout premier semestre, Alice dirige A : annonce permise');
  ok(eng.run(`ceoCallWindowOpen()`) === true, 'fenêtre ouverte : aucun lancer, chiffres provisoires');
  ok(/Seul le PDG de Co Alice/.test(refus(eng, 'A', bob)), `Bob ne dirige pas A : « ${refus(eng, 'A', bob)} »`);
  ok(/Seul le PDG/.test(refus(eng, 'A', '')) && /Seul le PDG/.test(eng.json(`ceoCallRefusal(A, null)`)), 'sans identité : refusée');
  ok(eng.json(`ceoCallRefusal(null, ${JSON.stringify(alice)})`) === 'Entreprise introuvable.', 'entreprise introuvable');
  ok(/n’est pas une entreprise active/.test(eng.json(`ceoCallRefusal(Object.assign({}, A, {id:'fantome'}), ${JSON.stringify(alice)})`)), 'entreprise absente des entreprises actives : refusée');
  ok(/Annonce inconnue/.test(eng.json(`ceoCallApply(A.id, 'menace', ${JSON.stringify(alice)})`).error) && eng.json(`A.ceoCall`) === null, 'annonce inconnue : refusée, rien de posé');
  eng.run(`state.gameEndedReason = {reason:'maxDuration', roll:0, year:0};`);
  ok(/La partie est terminée/.test(refus(eng, 'A', alice)), 'partie terminée : refusée');
  eng.run(`state.gameEndedReason = null;`);
  // Deuxième annonce.
  const r1 = eng.json(`ceoCallApply(A.id, 'promise', ${JSON.stringify(alice)})`);
  ok(r1.ok === true, 'première annonce (promesse) faite');
  ok(/déjà fait son annonce pour ce semestre \(promesse\)/.test(refus(eng, 'A', alice)), `deuxième annonce : « ${refus(eng, 'A', alice)} »`);
  const r2 = eng.json(`ceoCallApply(A.id, 'warning', ${JSON.stringify(alice)})`);
  ok(r2.ok === false && eng.json(`A.ceoCall.kind`) === 'promise', 'deuxième annonce refusée, la première reste (aucun retour possible)');
  ok(refus(eng, 'B', bob) === null, 'B (Bob) peut encore annoncer : une annonce par entreprise');
  // Gel seul (sans lancer) : fenêtre fermée.
  eng.run(`freezeAnalystForecasts();`);
  ok(eng.run(`rollsInCurrentSemester()`) === 0 && /Trop tard pour ce semestre/.test(refus(eng, 'B', bob)), 'chiffres figés, aucun lancer compté : fenêtre fermée par le gel');
  // Les trois chemins de lancer.
  for(const [chemin, appel] of [['lancer pour tous', 'performRollForAllCompanies()'], ['lancer d\'une entreprise', 'rollDiceAndMove(B.id)'], ['pion neutre', "(state.neutralPawns = state.neutralPawns||[], state.neutralPawns.push({id:'pw', name:'N', position:0, inJail:false, jailTurnsLeft:0}), corePerformNeutralPawnRoll(state.neutralPawns[state.neutralPawns.length-1]))"]]){
    const e = await partie({ transform: tf });
    ok(refus(e, 'A', e.ids[0]) === null, `${chemin} : permise avant`);
    await e.run(appel);
    ok(/Trop tard pour ce semestre/.test(refus(e, 'A', e.ids[0])), `${chemin} : refusée après le premier déplacement — « ${refus(e, 'A', e.ids[0]).slice(0, 60)}… »`);
    const r = await e.run(`announceCeoCall(A.id, 'warning')`);
    ok(r.ok === false && e.json(`A.ceoCall`) === null, `${chemin} : l'action refuse aussi (revérifiée dans l'action)`);
  }
  // Fenêtre fermée entre l'affichage et le clic : l'écran a vu « permise », un lancer passe, puis le clic.
  const e2 = await partie({ transform: tf });
  ok(refus(e2, 'A', e2.ids[0]) === null, 'écran : permise');
  const pRoll = e2.run(`performRollForAllCompanies()`);
  const pCall = e2.run(`announceCeoCall(A.id, 'promise')`);
  await pRoll; const rc = await pCall;
  ok(rc.ok === false && /Trop tard/.test(rc.error) && e2.json(`A.ceoCall`) === null && e2.json(`state.log.map(l=>String(l.text||l))`).every(t => !/📣/.test(t)), 'clic mis en file derrière un lancer : refusé dans l\'action, aucun cube, aucune ligne');
  // Nouveau semestre : de nouveau permise.
  await e2.run(`performRollForAllCompanies()`); await e2.run(`performRollForAllCompanies()`);
  ok(e2.run(`state.gameClock.rollCount`) === 3 && refus(e2, 'A', e2.ids[0]) === null, 'semestre suivant, avant son premier lancer : permise');
  // Entreprise créée en cours de semestre.
  const e3 = await partie({ names: ['Alice', 'Bob', 'Chloe'], types: ['garp', 'garp', null], transform: tf });
  await e3.run(`performRollForAllCompanies()`);
  await e3.run(`createCompany(state.players[2].id, 'Co Tard', '', 'garp', null, null, null)`);
  e3.run(`applyCompanyIpoFunding(state.companies[2]);`);
  ok(/n’aura pas de verdict des analystes pour Co Tard/.test(e3.json(`ceoCallRefusal(state.companies[2], state.players[2].id)`)), 'entreprise créée en cours de semestre : refusée (pas de verdict)');
  // Entreprise créée DANS la fenêtre (avant le premier lancer) : permise, elle sera figée au premier lancer.
  const e4 = await partie({ names: ['Alice', 'Bob', 'Chloe'], types: ['garp', 'garp', null], transform: tf });
  await e4.run(`createCompany(state.players[2].id, 'Co Tot', '', 'garp', null, null, null)`);
  e4.run(`applyCompanyIpoFunding(state.companies[2]);`);
  ok(e4.json(`ceoCallRefusal(state.companies[2], state.players[2].id)`) === null, 'entreprise créée dans la fenêtre : permise');
  // Partie migrée en cours de semestre : aucun chiffre figé.
  const e5 = await partie({ transform: tf });
  e5.run(`state.gameClock.rollCount = 4; state.companies.forEach(c=>{ c.analystForecast = null; });`);
  ok(/n’aura pas de verdict/.test(refus(e5, 'A', e5.ids[0])), 'partie migrée en cours de semestre : refusée (pas de verdict)');
  // Entreprise sous enquête de l'AMF : annonce PERMISE (décision de Julien du 2026-11-17, « Non le pdg peut » : rester
  // sous enquête est un choix, rien de l'AMF ne change). À l'écran et dans l'action, avertissement comme promesse.
  for(const kind of ['warning', 'promise']){
    const e6 = await partie({ seed: 41, transform: tf });
    e6.run(`A.inJail = true; A.jailTurnsLeft = 3;`);
    ok(refus(e6, 'A', e6.ids[0]) === null, `entreprise sous enquête : ${kind} permise (aucun refus)`);
    const coul = kind === 'warning' ? 'red' : 'green';
    const avant = e6.json(`A.stockReserve.${coul}`);
    const r = await e6.run(`announceCeoCall(A.id, '${kind}')`);
    ok(r.ok === true && e6.json(`A.ceoCall`).kind === kind && e6.json(`A.stockReserve.${coul}`) === avant + 1, `entreprise sous enquête : ${kind} passe dans l'action, 1 cube ${coul === 'red' ? 'rouge' : 'vert'} posé`);
    ok(e6.json(`A.inJail`) === true && e6.json(`A.jailTurnsLeft`) === 3, `entreprise sous enquête : l'annonce ne touche pas à l'enquête`);
  }
  // Annonce périmée (semestre 0) au semestre 1 : ne bloque pas.
  const e7 = await partie({ transform: tf });
  e7.run(`state.gameClock.rollCount = 3; A.ceoCall = {semester:0, kind:'promise', atRoll:0, playerId:${JSON.stringify(e7.ids[0])}};`);
  ok(refus(e7, 'A', e7.ids[0]) === null && e7.json(`ceoCallFor(A, 1)`) === null, 'annonce d\'un ancien semestre restée dans l\'état : ne compte pas, nouvelle annonce permise');
});

// --- B. L'annonce ---------------------------------------------------------------------------------------------
scenario('annonce', 'B. Annonce synchronisée : cube immédiat, argent conservé, journal, une seule fois', async (tf) => {
  for(const [kind, color, other] of [['warning', 'red', 'green'], ['promise', 'green', 'red']]){
    const eng = await partie({ transform: tf });
    const [alice] = eng.ids;
    const live0 = eng.json(`analystForecastFor(A)`);
    const snap = () => eng.json(`({f:Object.assign({}, A.stockReserve), t:Object.assign({}, A.tradingReserve||{}), ty:Object.assign({}, A.typeReserve||{}), bf:Object.assign({}, B.stockReserve), cash:A.cash, price:A.stockPrice})`);
    const s0 = snap(), m0 = eng.cashTotal();
    const ids0 = eng.json(`(state.appliedActionIds||[]).length`);
    const r = await eng.run(`announceCeoCall(A.id, ${JSON.stringify(kind)})`);
    const s1 = snap();
    ok(r.ok === true && r.kind === kind && r.color === color && r.qty === 1 && r.semester === 0, `${kind} : action réussie, ${JSON.stringify({ kind: r.kind, color: r.color, qty: r.qty, semester: r.semester })}`);
    ok(s1.f[color] - s0.f[color] === 1 && s1.f[other] === s0.f[other] && s1.f.white === s0.f.white, `${kind} : 1 cube ${color === 'red' ? 'rouge' : 'vert'} au sac FONDAMENTAL (${s0.f[color]} → ${s1.f[color]}), rien d'autre`);
    ok(JSON.stringify(s1.t) === JSON.stringify(s0.t) && JSON.stringify(s1.ty) === JSON.stringify(s0.ty) && JSON.stringify(s1.bf) === JSON.stringify(s0.bf), `${kind} : sac trading, sac type et sac de B inchangés`);
    ok(near(eng.cashTotal(), m0) && s1.cash === s0.cash && s1.price === s0.price, `${kind} : argent conservé, encaisse et cours inchangés`);
    const call = eng.json(`A.ceoCall`);
    ok(call && call.semester === 0 && call.kind === kind && call.atRoll === 0 && call.playerId === alice, `${kind} : co.ceoCall = ${JSON.stringify(call)}`);
    const l = logs(eng, /📣/);
    ok(l.length === 1 && l[0].includes('Co Alice') && l[0].includes(kind === 'warning' ? 'avertissement du PDG' : 'promesse du PDG') && l[0].includes('semestre 1 de l\'année 1') && l[0].includes('au sac fondamental'), `${kind} : une ligne de journal visible de tous — « ${l[0]} »`);
    ok(eng.json(`(state.appliedActionIds||[]).length`) === ids0 + 1, `${kind} : passée par la file d'actions (identifiant enregistré)`);
    const saved = JSON.parse(eng.mem.get('game:' + eng.run('gameCode')));
    ok(saved.companies[0].ceoCall && saved.companies[0].ceoCall.kind === kind && saved.companies[0].stockReserve[color] === s1.f[color], `${kind} : enregistrée avec son cube (même écriture)`);
    const live1 = eng.json(`analystForecastFor(A)`);
    ok(JSON.stringify(live1) === JSON.stringify(live0), `${kind} : chiffres des analystes inchangés par l'annonce`);
    // Deuxième annonce et double clic.
    const r2 = await eng.run(`announceCeoCall(A.id, 'warning')`);
    ok(r2.ok === false && /déjà fait son annonce/.test(r2.error) && JSON.stringify(snap().f) === JSON.stringify(s1.f), `${kind} : deuxième annonce refusée, aucun cube de plus`);
  }
  // Double clic (deux actions en file, la seconde voit la première).
  const eng = await partie({ transform: tf });
  eng.run(`myPlayerId = ${JSON.stringify(eng.ids[1])};`);
  const g0 = eng.json(`B.stockReserve.green`);
  const [x, y] = await Promise.all([eng.run(`announceCeoCall(B.id, 'promise')`), eng.run(`announceCeoCall(B.id, 'promise')`)]);
  ok([x, y].filter(r => r.ok).length === 1 && eng.json(`B.stockReserve.green`) === g0 + 1 && logs(eng, /📣/).length === 1, 'double clic : une seule annonce, un seul cube vert, une seule ligne');
  // Joueur qui ne dirige pas l'entreprise.
  const red0 = eng.json(`A.stockReserve.red`);
  const rb = await eng.run(`announceCeoCall(A.id, 'warning')`);
  ok(rb.ok === false && /Seul le PDG de Co Alice/.test(rb.error) && eng.json(`A.ceoCall`) === null && eng.json(`A.stockReserve.red`) === red0, 'Bob annonce pour A : refusée, aucun cube');
  // « Vous êtes » change pendant que l'action attend dans la file : l'action n'est pas faite au nom du nouveau joueur.
  const e2 = await partie({ transform: tf });
  const pRoll = e2.run(`performRollForAllCompanies()`); // occupe la file
  const pCall = e2.run(`announceCeoCall(A.id, 'promise')`); // lancée au nom d'Alice
  e2.run(`myPlayerId = ${JSON.stringify(e2.ids[1])};`);
  await pRoll; const rcall = await pCall;
  ok(rcall.ok === false && e2.json(`A.ceoCall`) === null, 'identité changée pendant l\'attente : rien n\'est annoncé');
});

// --- C. Clôture -----------------------------------------------------------------------------------------------
// Clôtures répétées sur des chiffres figés et un bénéfice imposés (vrai applyAnalystVerdict, vrai injectStockCube,
// hasard semé). Prévision à 3 analystes : 1, 2, 3 ; cible 2 ; zone ± 0,5.
const F3 = { h: 1, m: 2, k: 3, target: 2, zone: 0.5 };
const CAS = [ // [bénéfice, verdict, couleur, cubes sans annonce, avec avertissement, avec promesse] ; [a, b] = tirage
  [3.5, 'strongUp', 'green', [5, 5], [5, 5], [5, 5]],
  [2.75, 'normalUp', 'green', [2, 2], [2, 2], [2, 2]],
  [2.3, 'zone', 'green', [0, 1], [0, 1], [0, 1]],
  [1.7, 'zone', 'red', [0, 1], [0, 1], [0, 1]],
  [1.25, 'normalDown', 'red', [2, 2], [0, 1], [5, 5]],
  [0.5, 'strongDown', 'red', [5, 5], [2, 2], [8, 8]],
];
async function closeBench(tf, seed){
  const eng = await partie({ seed, transform: tf });
  eng.run(`globalThis.__ni = 0; globalThis.__k = 0; globalThis.__inj = [];
    globalThis.__realInj = injectStockCube;
    injectStockCube = function(co, color, a, b){ const q = __realInj(co, color, a, b); __inj.push({co:co.id, color, a, b, q}); return q; };
    incomeStatementFor = function(id, s){ return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:10, totalExpense:10-__ni, netIncome:__ni}; };
    globalThis.__close = function(ni, kind, f){ __ni = ni; const s = 1000 + (__k++); __inj.length = 0;
      A.analystForecast = Object.assign({semester:s, sigma:0, parts:{}}, f);
      A.ceoCall = kind ? {semester:s, kind, atRoll:s*3, playerId:A.ceoId} : null;
      const fc0 = JSON.stringify(A.analystForecast);
      const g0 = A.stockReserve.green, r0 = A.stockReserve.red;
      const e = applyAnalystVerdict(A, s);
      return {e, dg:A.stockReserve.green-g0, dr:A.stockReserve.red-r0, inj:__inj.slice(), callAfter:A.ceoCall, log:String((state.log[0]||{}).text||''), fcSame: JSON.stringify(A.analystForecast)===fc0}; };`);
  return eng;
}
scenario('cloture', 'C1. Clôture : avertissement et promesse dans les six cas, quantités exactes', async (tf) => {
  const eng = await closeBench(tf, 20261117);
  for(const [ni, verdict, color, none, warn, prom] of CAS){
    for(const [kind, range] of [[null, none], ['warning', warn], ['promise', prom]]){
      const N = range[0] === range[1] ? 1 : 200;
      const outs = eng.json(`Array.from({length:${N}}, ()=>__close(${ni}, ${JSON.stringify(kind)}, ${JSON.stringify(F3)}))`);
      const name = `${kind || 'sans annonce'} × ${verdict} (${ni})`;
      const o = outs[0];
      ok(outs.every(x => x.e.verdict === verdict && x.e.color === color && x.e.qty >= range[0] && x.e.qty <= range[1] && x.e.beaten === o.e.beaten && x.fcSame),
        `${name} : verdict « ${verdict} » inchangé, ${color === 'red' ? 'rouge' : 'vert'}, ${range[0] === range[1] ? range[0] + ' cube(s)' : 'tirage de ' + range[0] + ' à ' + range[1]}`);
      ok(outs.every(x => x.inj.length === 1 && x.inj[0].color === color && x.inj[0].a === range[0] && x.inj[0].b === range[1] && x.inj[0].q === x.e.qty) || (range[1] === 0 && outs.every(x => x.inj.length === 0)),
        `${name} : une seule injection au sac fondamental, fourchette [${range[0]}, ${range[1]}]`);
      ok(outs.every(x => (color === 'red' ? x.dr === x.e.qty && x.dg === 0 : x.dg === x.e.qty && x.dr === 0)), `${name} : le sac fondamental reçoit exactement la quantité inscrite`);
      if(N > 1){ const ones = outs.filter(x => x.e.qty === 1).length; ok(ones > 0 && ones < N, `${name} : le tirage donne 0 et 1 (1 cube ${ones} fois sur ${N})`); }
      ok(outs.every(x => x.callAfter === null), `${name} : co.ceoCall remis à null à la clôture`);
      ok(outs.every(x => x.e.call === kind), `${name} : historique : call = ${kind}`);
      const changed = (kind === 'warning' && /Down$/.test(verdict)) || (kind === 'promise' && /Down$/.test(verdict));
      ok(outs.every(x => changed ? typeof x.e.callEffect === 'string' && x.e.callEffect.length > 0 : x.e.callEffect === null), `${name} : callEffect ${changed ? '« ' + o.e.callEffect + ' »' : 'null (rien changé)'}`);
      if(kind){
        const expectTxt = changed ? o.e.callEffect : (kind === 'promise' ? 'promesse du PDG tenue' : 'avertissement du PDG sans effet');
        ok(o.log.includes(expectTxt) && o.log.includes('analystes'), `${name} : journal — « …${o.log.slice(o.log.indexOf(' : ', o.log.indexOf('zone de')) + 3)} »`);
      } else ok(!/PDG/.test(o.log), `${name} : journal sans mention du PDG`);
    }
  }
  // Textes exacts des trois effets.
  const fx = (ni, kind) => eng.json(`__close(${ni}, '${kind}', ${JSON.stringify(F3)}).e.callEffect`);
  ok(fx(0.5, 'warning') === 'avertissement du PDG : 2 cubes rouges au lieu de 5', 'texte : avertissement, fort en dessous');
  ok(fx(1.25, 'warning') === 'avertissement du PDG : tirage de la zone, 0 ou 1 cube rouge, au lieu de 2 cubes rouges', 'texte : avertissement, normal en dessous');
  ok(fx(1.25, 'promise') === 'promesse du PDG non tenue : 3 cubes rouges de plus', 'texte : promesse non tenue');
  // Ligne complète du journal, promesse ratée sur un verdict fort : 8 rouges.
  const b = eng.json(`__close(0.5, 'promise', ${JSON.stringify(F3)})`);
  ok(/sous la zone \(verdict fort\), 0 analyste battu sur 3 — 8 cubes rouges au sac fondamental \(promesse du PDG non tenue : 3 cubes rouges de plus\)\.$/.test(b.log), `journal : « ${b.log.slice(b.log.indexOf('sous la zone'))} »`);
  // Monnaie : une clôture avec annonce ne déplace aucun argent.
  const m0 = eng.cashTotal();
  eng.json(`[__close(0.5, 'promise', ${JSON.stringify(F3)}), __close(0.5, 'warning', ${JSON.stringify(F3)})]`);
  ok(near(eng.cashTotal(), m0), 'monnaie conservée par les clôtures avec annonce');
});

// Sans annonce, le résultat est identique à l'ancien code : mêmes cubes et même historique, sur une suite identique.
scenario('sans', 'C2. Sans annonce : rien ne change (comparé au code sans le pari)', async (tf) => {
  const runAll = async (transform) => {
    const eng = await closeBench(transform, 777);
    const out = [];
    for(const [ni] of CAS) for(let i = 0; i < 20; i++) out.push(eng.json(`(r=>({v:r.e.verdict, q:r.e.qty, c:r.e.color, dg:r.dg, dr:r.dr, log:r.log}))(__close(${ni}, null, ${JSON.stringify(F3)}))`));
    return out;
  };
  const now = await runAll(tf);
  // Référence : la greffe de l'annonce retirée (le code des lots 2 et 3).
  const sansPari = s => { const a = '  const call = ceoCallFor(co, sem);\n  if(!call) return base;'; if(!s.includes(a)) throw new Error('motif introuvable : greffe'); return (tf ? tf(s) : s).split(a).join('  return base;'); };
  const ref = await runAll(sansPari);
  ok(JSON.stringify(now) === JSON.stringify(ref), `sans annonce : ${now.length} clôtures identiques à la référence sans greffe (cubes, couleurs, journal)`);
});

scenario('verdict', 'C3. L\'annonce ne change ni le verdict, ni l\'axe Croissance, ni les chiffres (vraie clôture par advanceGameClock)', async (tf) => {
  const res = {};
  for(const kind of [null, 'warning', 'promise']){
    const eng = await partie({ names: ['Alice', 'Bob'], types: ['croissance', 'garp'], transform: tf });
    eng.run(`A.croissanceTier = 'eleve'; A.typeReserve = {green:0, red:0, white:20}; drawStockCubes = function(){ return []; };
      incomeStatementFor = function(id, s){ const ni = id===A.id ? -9 : 3; return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:Math.abs(ni)*2, totalExpense:Math.abs(ni)*2-ni, netIncome:ni}; };
      A.analystForecast = {semester:1, h:null, m:-5, k:null, sigma:0, target:-5, zone:0.5, parts:{}, frozenAtRoll:3};
      B.analystForecast = {semester:1, h:null, m:3, k:null, sigma:0, target:3, zone:0.5, parts:{}, frozenAtRoll:3};
      state.gameClock.rollCount = 5;
      ${kind ? `A.ceoCall = {semester:1, kind:'${kind}', atRoll:3, playerId:A.ceoId};` : ''}`);
    const m0 = eng.cashTotal();
    eng.run(`advanceGameClock()`);
    res[kind || 'aucune'] = eng.json(`({h:A.analystHistory[0], ty:A.typeReserve, f:A.analystForecast, call:A.ceoCall, b:B.analystHistory[0]})`);
    ok(near(eng.cashTotal(), m0), `${kind || 'sans annonce'} : monnaie conservée à la clôture`);
  }
  const base = res.aucune;
  for(const k of ['warning', 'promise']){
    const r = res[k];
    ok(r.h.verdict === base.h.verdict && r.h.beaten === base.h.beaten && r.h.target === base.h.target && r.h.zone === base.h.zone && r.h.judged === base.h.judged, `${k} : même verdict (${r.h.verdict}) et mêmes chiffres dans l'historique`);
    ok(JSON.stringify(r.ty) === JSON.stringify(base.ty), `${k} : axe Croissance inchangé (sac type ${JSON.stringify(r.ty)})`);
    ok(JSON.stringify(r.f) === JSON.stringify(base.f), `${k} : chiffres figés inchangés`);
    ok(r.call === null && JSON.stringify(r.b) === JSON.stringify(base.b), `${k} : ceoCall remis à null ; B (sans annonce) inchangé`);
  }
  ok(base.h.verdict === 'normalDown' && base.h.qty === 2 && res.warning.h.qty <= 1 && res.promise.h.qty === 5, `cubes seuls changés : sans annonce 2, avertissement ${res.warning.h.qty} (0 ou 1), promesse 5`);
});

scenario('parcours', 'C4. Parcours complet : annonce par l\'action, gel, trois vrais lancers, clôture', async (tf) => {
  for(const kind of ['warning', 'promise']){
    const eng = await partie({ seed: kind === 'warning' ? 11 : 12, transform: tf });
    const live = eng.json(`analystForecastFor(A)`);
    const r = await eng.run(`announceCeoCall(A.id, '${kind}')`);
    ok(r.ok, `${kind} : annonce faite dans la fenêtre`);
    const m0 = eng.cashTotal();
    await eng.run(`performRollForAllCompanies()`);
    const f = eng.json(`A.analystForecast`);
    ok(f.semester === 0 && f.m === live.m && f.target === live.target && f.zone === live.zone, `${kind} : chiffres figés = chiffres provisoires vus avant l'annonce`);
    ok(eng.json(`A.ceoCall.kind`) === kind, `${kind} : annonce gardée jusqu'à la clôture`);
    await eng.run(`performRollForAllCompanies()`); await eng.run(`performRollForAllCompanies()`);
    const h = eng.json(`A.analystHistory[0]`);
    ok(h && h.semester === 0 && h.call === kind && eng.json(`A.ceoCall`) === null, `${kind} : clôture : historique ${JSON.stringify({ verdict: h && h.verdict, qty: h && h.qty, call: h && h.call, callEffect: h && h.callEffect })}, ceoCall remis à null`);
    const down = /Down$/.test(h.verdict);
    const exp = kind === 'promise' ? (down ? [h.verdict === 'strongDown' ? 8 : 5] : null) : (down ? (h.verdict === 'strongDown' ? [2] : [0, 1]) : null);
    if(exp) ok(exp.includes(h.qty) && typeof h.callEffect === 'string', `${kind} : ${h.verdict} → ${h.qty} cube(s), effet « ${h.callEffect} »`);
    else ok(h.callEffect === null, `${kind} : ${h.verdict} → aucun effet de l'annonce`);
    ok(near(eng.cashTotal(), m0), `${kind} : monnaie conservée sur les trois lancers`);
    ok(eng.json(`ceoCallRefusal(A, myPlayerId)`) === null, `${kind} : semestre suivant, nouvelle annonce permise`);
  }
});

scenario('fin', 'C5. Promesse au tout dernier semestre : pas de règle spéciale (décision de Julien)', async (tf) => {
  const eng = await partie({ transform: tf });
  eng.run(`drawStockCubes = function(){ return []; };
    incomeStatementFor = function(id, s){ return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:10, totalExpense:9.5, netIncome:0.5}; };
    A.analystForecast = Object.assign({semester:1, sigma:0, parts:{}, frozenAtRoll:3}, ${JSON.stringify(F3)});
    A.ceoCall = {semester:1, kind:'promise', atRoll:3, playerId:A.ceoId};
    state.hiddenGameLengthTargetYear = 0; state.gameClock.rollCount = 5; advanceGameClock();`);
  const r = eng.json(`({ended: !!state.gameEndedReason, h: A.analystHistory[0], call: A.ceoCall})`);
  ok(r.ended && r.h && r.h.call === 'promise' && r.h.qty === 8 && r.call === null, `clôture qui termine la partie : promesse ratée jugée comme ailleurs (8 rouges), annonce effacée`);
  ok(/La partie est terminée/.test(eng.json(`ceoCallRefusal(A, myPlayerId)`)), 'partie terminée : plus d\'annonce');
});

// --- D. Deux appareils ----------------------------------------------------------------------------------------
scenario('appareils', 'D. Deux appareils (faux serveur) : simultanées, accusé perdu : un seul cube', async (tf) => {
  // D1. Deux appareils d'Alice annoncent en même temps (l'un un avertissement, l'autre une promesse).
  {
    const P = await partieReseau(['Alice', 'Bob'], ['garp', 'garp']);
    const R = new Reseau({ graine: 5 });
    R.ecrireServeur(P.chemin, P.raw);
    const T1 = appareil(R, P, 'Alice-tel', P.ids[0], { transform: tf });
    const T2 = appareil(R, P, 'Alice-pc', P.ids[0], { transform: tf });
    await R.pomper();
    const avant = serveur(R, P);
    const id = JSON.stringify(avant.companies[0].id);
    const p1 = T1.eng.run(`announceCeoCall(${id}, 'warning')`), p2 = T2.eng.run(`announceCeoCall(${id}, 'promise')`);
    const r1 = await R.attendrePromesse(p1), r2 = await R.attendrePromesse(p2);
    await R.pomper();
    const apres = serveur(R, P);
    const fa = avant.companies[0].stockReserve, fb = apres.companies[0].stockReserve;
    const oks = [r1, r2].filter(r => r && r.ok);
    const added = (fb.red - fa.red) + (fb.green - fa.green);
    ok(oks.length === 1 && added === 1, `simultanées : une réussie, l'autre refusée (« ${([r1, r2].find(r => !r.ok) || {}).error} ») ; ${added} cube ajouté sur le serveur`);
    const kind = apres.companies[0].ceoCall && apres.companies[0].ceoCall.kind;
    ok(kind === oks[0].kind && (kind === 'warning' ? fb.red - fa.red === 1 : fb.green - fa.green === 1), `le serveur porte l'annonce gagnante (${kind}) et son cube`);
    ok(apres.log.filter(l => /📣/.test(String(l.text || l))).length === 1, 'une seule ligne d\'annonce au journal partagé');
    ok(near(caisse(avant), caisse(apres)), 'monnaie conservée');
    ok(T1.eng.run('JSON.stringify(state)') === R.valeur(P.chemin) && T2.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'les deux appareils = la valeur du serveur');
  }
  // D2. Accusé perdu : le serveur écrit, l'accusé se perd, Bob enregistre 110 actions, Alice se reconnecte (rejeu).
  for(const nb of [0, 110]){
    const P = await partieReseau(['Alice', 'Bob'], ['garp', 'garp']);
    const R = new Reseau({ graine: 9 });
    R.ecrireServeur(P.chemin, P.raw);
    const A = appareil(R, P, 'Alice', P.ids[0], { transform: tf });
    const Bd = appareil(R, P, 'Bob', P.ids[1], { transform: tf });
    await R.pomper();
    const avant = serveur(R, P);
    const id = JSON.stringify(avant.companies[0].id);
    R.couperApresProchaineEcriture(A.client, 30 * 60 * 1000);
    let res = null; A.eng.run(`announceCeoCall(${id}, 'promise')`).then(r => { res = r; });
    for(let i = 0; i < 2000 && !serveur(R, P).companies[0].ceoCall; i++) await R.pas();
    for(let i = 0; i < nb; i++){
      const r = await R.attendrePromesse(Bd.eng.run(`attemptActionWithRetry(()=>{ const pl = state.players.find(p=>p.id===myPlayerId); pl.note = (pl.note||0)+1; return {ok:true}; }, {label:'petite'})`));
      if(!r.ok) throw new Error('action de Bob refusée : ' + r.error);
    }
    await R.pomper();
    const apres = serveur(R, P);
    const dg = apres.companies[0].stockReserve.green - avant.companies[0].stockReserve.green;
    ok(dg === 1 && apres.companies[0].ceoCall && apres.companies[0].ceoCall.kind === 'promise' && apres.log.filter(l => /📣/.test(String(l.text || l))).length === 1,
      `accusé perdu puis ${nb} action(s) de Bob : un seul cube vert (+${dg}) et une seule annonce sur le serveur`);
    ok(res && res.ok === true && !res.uncertain, `accusé perdu (${nb}) : l'action est annoncée réussie (${JSON.stringify(res && { ok: res.ok, error: res.error })})`);
    ok(near(caisse(avant), caisse(apres)), `accusé perdu (${nb}) : monnaie conservée`);
  }
});

// --- E. Migration, annonce périmée, semestre sans verdict, affichage ----------------------------------------
scenario('migration', 'E. Partie ancienne migrée, annonce périmée, semestre sans verdict, affichage', async (tf) => {
  const eng = await partie({ seed: 5, transform: tf });
  // Partie ancienne : ni ceoCall, ni call dans l'historique.
  eng.run(`(function(){ const s = JSON.parse(JSON.stringify(state)); s.companies.forEach(c=>{ delete c.ceoCall; c.analystHistory = [{semester:0, h:null, m:2, k:null, target:2, zone:0.5, actual:0.5, verdict:'strongDown', beaten:0, of:1, color:'red', qty:5}]; }); s.companies[1].ceoCall = 'illisible'; migrateState(s); state = s; A = state.companies[0]; B = state.companies[1]; })()`);
  ok(eng.json(`A.ceoCall`) === null && eng.json(`B.ceoCall`) === null, 'migrateState : ceoCall absent → null, forme illisible → null');
  const line = eng.run(`analystVerdictLineText(A.analystHistory[0], true)`);
  ok(/— 5 cubes rouges au sac fondamental\.$/.test(line) && !/PDG/.test(line), `ancienne ligne d'historique sans annonce : « …${line.slice(line.indexOf('—'))} »`);
  ok(eng.json(`ceoCallRefusal(A, myPlayerId)`) === null, 'partie migrée, au début d\'un semestre : annonce permise');
  // Annonce périmée : promesse du semestre 0 restée dans l'état, clôture du semestre 2 sous la zone (fort).
  const e2 = await closeBench(tf, 9);
  const st = e2.json(`(function(){ __ni = 0.5; A.analystForecast = Object.assign({semester:2, sigma:0, parts:{}}, ${JSON.stringify(F3)}); A.ceoCall = {semester:0, kind:'promise', atRoll:0, playerId:A.ceoId};
    const r0 = A.stockReserve.red; const e = applyAnalystVerdict(A, 2); return {e, dr:A.stockReserve.red-r0, call:A.ceoCall}; })()`);
  ok(st.e.verdict === 'strongDown' && st.e.qty === 5 && st.dr === 5 && st.e.call === null && st.e.callEffect === null && st.call === null, `annonce périmée (semestre 0) à la clôture du semestre 2 : ignorée (5 rouges, pas 8) et effacée — ${JSON.stringify({ qty: st.e.qty, call: st.e.call })}`);
  ok(e2.json(`analystVerdictCubes('strongDown', {ceoCall:{semester:0, kind:'promise'}, analystForecast:{semester:2}}, -1.5).qtyMax`) === 5, 'analystVerdictCubes : semestre par défaut = celui des chiffres figés, annonce d\'un autre semestre ignorée');
  // Semestre sans verdict : annonce faite, puis aucun chiffre figé à la clôture.
  const e3 = await partie({ seed: 6, transform: tf });
  await e3.run(`announceCeoCall(A.id, 'promise')`);
  e3.run(`drawStockCubes = function(){ return []; }; globalThis.__vc = 0; globalThis.__rvc = analystVerdictCubes; analystVerdictCubes = function(){ __vc++; return __rvc.apply(null, arguments); };
    state.gameClock.rollCount = 2; state.companies.forEach(c=>{ c.analystForecast = null; }); advanceGameClock();`);
  ok(e3.json(`A.analystHistory.length`) === 0 && e3.json(`A.ceoCall`) === null, 'semestre sans verdict : aucune ligne d\'historique, l\'annonce est effacée');
  const lg = logs(e3, /reste sans effet/);
  ok(lg.length === 1 && /promesse/.test(lg[0]), `semestre sans verdict : une ligne dit que l'annonce reste sans effet — « ${lg[0]} »`);
  ok(e3.json(`__vc`) === 0 && !logs(e3, /promesse du PDG non tenue/).length, 'semestre sans verdict : aucun cube de verdict ni de promesse (seul le cube de l\'annonce a compté)');
  // Un semestre plus tard, elle ne revient pas : clôture suivante avec chiffres figés et bénéfice sous la zone.
  e3.run(`incomeStatementFor = function(id, s){ return {companyId:id, semesterIndex:s, revenues:{}, expenses:{}, totalRevenue:10, totalExpense:9.5, netIncome:0.5}; };
    A.analystForecast = Object.assign({semester:1, sigma:0, parts:{}}, ${JSON.stringify(F3)}); state.gameClock.rollCount = 5; advanceGameClock();`);
  const h3 = e3.json(`A.analystHistory[0]`);
  ok(h3 && h3.semester === 1 && h3.call === null && h3.qty === 5, `semestre suivant : l'ancienne annonce ne s'applique pas (5 rouges, call null)`);
  // Affichage : rien ne plante, la ligne du verdict reste juste dans le résumé du tour et le tableau du graphique.
  const e4 = await partie({ transform: tf });
  e4.run(`A.analystHistory = [{semester:0, h:1, m:2, k:3, target:2, zone:0.5, actual:0.5, judged:0.5, adjust:0, verdict:'strongDown', beaten:0, of:3, color:'red', qty:8, call:'promise', callEffect:'promesse du PDG non tenue : 3 cubes rouges de plus'},
    {semester:1, h:1, m:2, k:3, target:2, zone:0.5, actual:1.25, judged:1.25, adjust:0, verdict:'normalDown', beaten:1, of:3, color:'red', qty:0, call:'warning', callEffect:'avertissement du PDG : tirage de la zone, 0 ou 1 cube rouge, au lieu de 2 cubes rouges'},
    {semester:2, h:1, m:2, k:3, target:2, zone:0.5, actual:3.5, judged:3.5, adjust:0, verdict:'strongUp', beaten:3, of:3, color:'green', qty:5, call:'promise', callEffect:null}];
    state.gameClock.rollCount = 9; A.ceoCall = {semester:3, kind:'warning', atRoll:9, playerId:A.ceoId};
    state.lastDiceRollEvent = {roll:2, portfolioDeltas:{}}; __modals.length = 0; showDiceRollTurnPopup(A, 2);`);
  const pop = strip(e4.run(`__modals[__modals.length-1]`));
  ok(/sous la zone \(verdict fort\), 0 analyste battu sur 3 — 8 cubes rouges au sac fondamental \(promesse du PDG non tenue : 3 cubes rouges de plus\)\./.test(pop), 'résumé du tour : 8 rouges et la promesse non tenue');
  e4.run(`state.lastDiceRollEvent = {roll:5, portfolioDeltas:{}}; __modals.length = 0; showDiceRollTurnPopup(A, 5);`);
  const pop2 = strip(e4.run(`__modals[__modals.length-1]`));
  ok(/sous la zone \(verdict normal\), 1 analyste battu sur 3 — aucun cube \(avertissement du PDG : tirage de la zone, 0 ou 1 cube rouge, au lieu de 2 cubes rouges\)\./.test(pop2), 'résumé du tour : avertissement, « aucun cube » expliqué');
  const tab = strip(e4.run(`expectationVsActualChartHtml(A, [])`));
  ok(/8 cubes rouges \(promesse du PDG non tenue/.test(tab) && /aucun cube \(avertissement du PDG/.test(tab) && /5 cubes verts \(promesse du PDG tenue\)/.test(tab), 'tableau du graphique : effet de chaque annonce, promesse tenue comprise');
  const page = strip(e4.run(`renderEntreprise()`));
  ok(/Attentes des analystes/.test(page), 'onglet Entreprise : s\'affiche avec une annonce en cours');
  ok(strip(e4.run(`analystExpectationBlockHtml(A)`)).length > 0, 'bloc des attentes : s\'affiche avec une annonce en cours');
});

// --- F. Versions cassées exprès -------------------------------------------------------------------------------
function rep(src, a, b){ if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 80)); return src.split(a).join(b); }
const MUTATIONS = [
  ['annonce possible après le gel', s => rep(s, '  return !activeCompanies().some(c=>c.analystForecast && c.analystForecast.semester===sem);\n}', '  return true;\n}'), ['refus']],
  ['annonce possible après le premier lancer (fenêtre jamais fermée)', s => rep(s, "  if(!ceoCallWindowOpen()){\n", "  if(false){\n"), ['refus']],
  ['annonce appliquée deux fois', s => rep(s, '  if(done) return `${co.name} a déjà fait son annonce', '  if(false) return `${co.name} a déjà fait son annonce'), ['refus', 'annonce', 'appareils']],
  ['promesse pénalisée dans la zone', s => rep(s, "  const down = verdict==='normalDown' || verdict==='strongDown';", "  const down = verdict==='normalDown' || verdict==='strongDown' || (verdict==='zone' && gap<0);"), ['cloture']],
  ['avertissement qui adoucit au-dessus de la zone', s => rep(s, '  if(!down) return out;\n  if(call.kind===', "  if(!down && call.kind!=='warning') return out;\n  if(call.kind==="), ['cloture']],
  ['cube de l\'annonce au mauvais sac (trading)', s => rep(s, '  const qty = injectStockCube(co, color, n, n);', '  const qty = injectTradingCube(co, color, n, n);'), ['annonce']],
  ['couleurs de l\'annonce inversées', s => rep(s, "  const color = kind==='warning' ? 'red' : 'green';", "  const color = kind==='warning' ? 'green' : 'red';"), ['annonce']],
  ['pénalité de la promesse oubliée', s => rep(s, '    out.qtyMin += CEO_PROMISE_BROKEN_RED_CUBES; out.qtyMax += CEO_PROMISE_BROKEN_RED_CUBES;\n', ''), ['cloture']],
  ['avertissement fort non adouci', s => rep(s, '      out.qtyMin = out.qtyMax = ANALYST_VERDICT_NORMAL_CUBES;', '      out.qtyMin = out.qtyMax = ANALYST_VERDICT_STRONG_CUBES;'), ['cloture']],
  ['ceoCall jamais remis à null', s => rep(s, '  const dropCall = ()=>{ if(', '  const dropCall = ()=>{}; const __unused = ()=>{ if('), ['cloture', 'verdict', 'migration']],
  ['annonce par un autre joueur', s => rep(s, '  if(!playerId || co.ceoId!==playerId) return `Seul le PDG', '  if(false) return `Seul le PDG'), ['refus', 'annonce']],
  ['annonce périmée appliquée à un autre semestre', s => rep(s, "typeof semester!=='number' || c.semester!==semester ||", "typeof semester!=='number' ||"), ['refus', 'migration']],
  ['annonce refusée pendant une enquête de l\'AMF (refus retiré à la demande de Julien)', s => rep(s, '  if(!ceoCallWindowOpen()){\n    const frozen = co.analystForecast', "  if(co.inJail) return 'refus pendant une enquête';\n  if(!ceoCallWindowOpen()){\n    const frozen = co.analystForecast"), ['refus']],
  ['annonce permise en fin de partie', s => rep(s, "  if(state.gameEndedReason) return 'La partie est terminée — plus aucune annonce", "  if(false) return 'La partie est terminée — plus aucune annonce"), ['refus']],
  ['annonce qui change le verdict (fort ramené à normal)', s => rep(s, '  const v = analystVerdict(fc, judged);', "  const v = analystVerdict(fc, judged); if(call && v.verdict==='strongDown') v.verdict = 'normalDown';"), ['cloture', 'verdict']],
];

async function runScenario(sc, tf){
  try { await sc.fn(tf); return null; }
  catch(e){ return (e && e.message) ? e.message : String(e); }
}

(async () => {
  const failures = [];
  for(const sc of SCENARIOS){
    console.log(sc.title);
    const err = await runScenario(sc, undefined);
    if(err){ console.log('  ' + err); failures.push(sc.title.slice(0, 50) + ' — ' + err); }
  }
  const nMain = n;
  console.log('F. Versions cassées exprès (mutations)');
  let caught = 0;
  for(const [nm, tf, keys] of MUTATIONS){
    quiet = true;
    let err = null;
    for(const k of keys){ if(err) break; const sc = SCENARIOS.find(x => x.key === k); err = await runScenario(sc, tf); }
    quiet = false;
    const real = !!err && !/motif introuvable/.test(err);
    try { ok(real, `mutation « ${nm} » attrapée — ${err ? err.replace(/^ÉCHEC : /, '').slice(0, 130) : 'non attrapée !'}`); caught++; }
    catch(e){ failures.push(e.message); console.log('  ' + e.message); }
  }
  if(failures.length){
    console.log(`\nÉCHEC : section 323 (pari du PDG) — ${failures.length} échec(s) :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`\nOK : section 323 (pari du PDG, moteur) — ${n} vérifications (${nMain} sur le nouveau code), ${caught}/${MUTATIONS.length} versions cassées attrapées`);
})().catch(e => { console.log('ÉCHEC : ' + (e && e.stack || e)); process.exit(1); });
