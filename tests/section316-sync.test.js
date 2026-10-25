// Test — Section 316 : garde unique de fin de partie sur le banc multi-appareils (faux serveur Firebase partagé,
// un faux SDK par appareil, ordonnanceur à graine : tests/helpers/fake-firebase.js ; mini-DOM : fake-dom.js).
//
// M1 : course entre le lancer qui termine la partie (Alice, lancer 5 → 6, durée maximale) et une annonce de dividende
//      de Bob (2 M$, payable au lancer 6) envoyée en même temps, pour plusieurs graines. Selon l'ordre d'arrivée au
//      serveur : soit l'annonce passe d'abord et le lancer final, rejoué sur l'état frais, la VERSE (décision « dividende
//      du lancer final ») ; soit le lancer passe d'abord et l'annonce, rejouée après le conflit, est REFUSÉE (garde
//      unique). Jamais d'annonce en suspens après la fin ; monnaie conservée ; appareils convergents.
// M2 : Bob a ouvert la fenêtre « Annoncer un dividende » avant la fin ; la fin arrive sur son appareil pendant que la
//      fenêtre est ouverte ; il confirme : refus « La partie est terminée », rien n'est enregistré.
// M3 (retouche de la revue) : quand l'annonce est refusée APRÈS un conflit (la fin arrive avec la valeur du serveur),
//      l'appareil de Bob montre l'écran final et le statut d'action passe à l'échec (avant : écran figé sur l'état
//      d'avant la fin, statut bloqué sur « ⏳ »).
// Contre-épreuve (sans la garde unique) : l'annonce acceptée après la fin reste immobilisée pour toujours.
//
// Lancer depuis la racine du dépôt :  node tests/section316-sync.test.js
const { loadEngine, check } = require('./helpers/engine');
const { Reseau, mulberry32 } = require('./helpers/fake-firebase');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 3) + ' — ' + m); }
}
const ESC = s => JSON.stringify(s);
const f4 = x => (typeof x === 'number' ? x.toFixed(4) : String(x));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// Retouche de la revue : refus de la garde sans notSaved ni statut d'échec (ancien gameEndedActionResult).
const REFUS_SANS_REDESSIN = src => src.replace("  if(label) setMyActionStatus(label, 'failed');\n  return {ok:false, error:gameEndedActionMessage(), code:'game-ended', notSaved:true};", "  return {ok:false, error:gameEndedActionMessage(), code:'game-ended'};");
const SANS_GARDE_UNIQUE = src => src.replace("      if(state && state.gameEndedReason && !allowAfterGameEnd) return gameEndedActionResult(label); // Section 316", '');
// Masse monétaire : encaisses + dividendes annoncés immobilisés.
const masse = s => (s.bank.cash || 0) + s.companies.reduce((t, c) => t + (c.cash || 0), 0) + s.players.reduce((t, p) => t + (p.cash || 0), 0)
  + (s.dividendAnnouncements || []).reduce((t, a) => t + a.amount, 0);

function fausseDate(maintenant){
  return class DateVirtuelle extends Date { constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); } static now(){ return maintenant(); } };
}
// Partie à deux (Alice, Bob), lancer 5, durée maximale = année 0 : le prochain lancer termine la partie.
async function partieReseau(graine, transform){
  const eng = loadEngine();
  const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`state.companies.forEach(c=>{ c.cash = 20; c.position = 10; }); state.gameClock.rollCount = 5; state.hiddenGameLengthTargetYear = 0;`);
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  const R = new Reseau({ graine });
  const chemin = 'data/game:' + code;
  R.ecrireServeur(chemin, eng.mem.get('game:' + code));
  return { R, code, chemin, ids, transform, serveur: () => JSON.parse(R.valeur(chemin)) };
}
function appareilReseau(env, nom, joueurId){
  const client = env.R.creerClient(nom);
  const doc = creerDocument();
  const ls = new Map([['mb:lastcode', env.code], ['mb:mychar:' + env.code, joueurId]]);
  const M = Object.create(Math); M.random = mulberry32(env.R.entier(2 ** 31) + 1);
  const alerts = [];
  const eng = loadEngine({ firebase: client.firebase, transform: env.transform, globals: {
    document: doc,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    Math: M, Date: fausseDate(() => env.R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alerts.push(String(m)), confirm: () => true,
    Event: class { constructor(t){ this.type = t; } },
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc.invalid' },
  } });
  return { nom, client, doc, eng, alerts, run: c => eng.run(c), json: c => eng.json(c) };
}
// Annonce de dividende de Co Bob (mutations de l'applyFn de modalAnnounceDividend), payable au prochain semestre.
const ANNONCE = `attemptActionWithRetry(async ()=>{ const co = state.companies.find(c=>c.name==='Co Bob'); co.cash -= 2; logFin(co.id, 'dividend_payout', -2);
  state.dividendAnnouncements.push({id:uid(), companyId:co.id, amount:2, announcedAtRoll:state.gameClock.rollCount, payAtRoll:(Math.floor(state.gameClock.rollCount/3)+1)*3,
    recordHolders: co.shareholders.filter(s=>s.playerId!=='BANK' && s.shares>1e-9).map(h=>({playerId:h.playerId, shares:h.shares})), totalSharesAtAnnouncement: co.sharesIssued});
  return {ok:true}; }, {label:'Annonce de dividende'})`;

async function course(graine, transform){
  const env = await partieReseau(graine, transform);
  const A = appareilReseau(env, 'Alice', env.ids[0]);
  const B = appareilReseau(env, 'Bob', env.ids[1]);
  await env.R.pomper();
  const S0 = env.serveur();
  const m0 = masse(S0);
  const coA = S0.companies.find(c => c.name === 'Co Alice').id;
  const pA = A.run(`rollDiceAndMove(${ESC(coA)})`);
  const pB = B.run(ANNONCE);
  const [rA, rB] = await Promise.all([env.R.attendrePromesse(pA), env.R.attendrePromesse(pB)]);
  await env.R.pomper();
  const S = env.serveur();
  const brut = env.R.valeur(env.chemin);
  const convergent = [A, B].every(d => d.run('lastSerialized') === brut);
  return { env, A, B, S, S0, m0, rA, rB, convergent };
}

(async () => {
  await scenario('M1. Lancer final contre annonce de dividende envoyée en même temps (10 graines)', async () => {
    let versees = 0, refusees = 0;
    for(const graine of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]){
      const C = await course(316 + graine);
      const { S, S0, rB } = C;
      const bob0 = S0.companies.find(c => c.name === 'Co Bob').cash, bob1 = S.companies.find(c => c.name === 'Co Bob').cash;
      const joueurs = S.players.map((p, i) => p.cash - S0.players[i].cash);
      const issue = rB && rB.ok ? 'versée' : 'refusée';
      if(issue === 'versée') versees++; else refusees++;
      console.log(`    graine ${316 + graine} : annonce ${issue}${rB && !rB.ok ? ` (« ${String(rB.error).slice(0, 40)}… »)` : ''} ; fin ${ESC(S.gameEndedReason && S.gameEndedReason.reason)} lancer ${S.gameClock.rollCount} ; Co Bob ${f4(bob0)} → ${f4(bob1)} ; joueurs ${joueurs.map(f4).join(' / ')}`);
      ok(S.gameEndedReason && S.gameEndedReason.reason === 'maxDuration' && S.gameClock.rollCount === 6, `M1 [${316 + graine}] : un seul lancer, qui termine la partie`);
      ok(S.dividendAnnouncements.length === 0, `M1 [${316 + graine}] : aucune annonce en suspens après la fin`);
      if(issue === 'versée'){
        ok(joueurs.reduce((s, x) => s + x, 0) > 0.5 && S.log.some(l => /Co Bob verse son dividende annoncé/.test(l.text || '')), `M1 [${316 + graine}] : l’annonce enregistrée avant le lancer final est versée aux actionnaires`);
      } else {
        ok(/partie est terminée/.test(rB.error) && near(bob1, bob0) && near(joueurs.reduce((s, x) => s + Math.abs(x), 0), 0), `M1 [${316 + graine}] : l’annonce arrivée après la fin est refusée, Co Bob inchangée`);
      }
      ok(near(masse(S), C.m0), `M1 [${316 + graine}] : monnaie conservée`);
      ok(C.convergent, `M1 [${316 + graine}] : les deux appareils convergent vers la valeur du serveur`);
    }
    console.log(`    bilan : ${versees} annonce(s) versée(s) au lancer final, ${refusees} refusée(s) après la fin`);
    ok(versees > 0 && refusees > 0, 'M1 : les deux ordres d’arrivée sont exercés');
  });

  await scenario('M1b. Contre-épreuve : sans la garde unique, l’annonce arrivée après la fin reste immobilisée', async () => {
    let suspens = 0;
    for(const graine of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]){
      const C = await course(316 + graine, SANS_GARDE_UNIQUE);
      if(C.S.dividendAnnouncements.length > 0) suspens++;
    }
    console.log(`    annonces en suspens pour toujours : ${suspens} graine(s) sur 10`);
    ok(suspens > 0, 'M1b : contre-épreuve — l’ancien code accepte l’annonce après la fin (argent immobilisé)');
  });

  await scenario('M3. Refus après conflit : l’écran de Bob passe à la fin, le statut n’est plus « ⏳ » (retouche de la revue)', async () => {
    for(const variante of ['corrigé', 'ancien']){
      let refus = 0, ecranFinal = 0, enAttente = 0;
      for(let g = 1; g <= 20; g++){
        const C = await course(316 + g, variante === 'ancien' ? REFUS_SANS_REDESSIN : undefined);
        if(C.rB && !C.rB.ok){
          refus++;
          if(C.B.doc.trouver('gameEndedReview')) ecranFinal++;
          if(C.B.run('myLastActionStatus && myLastActionStatus.status') === 'pending') enAttente++;
        }
      }
      console.log(`    [${variante}] refus ${refus} ; écran final affiché ${ecranFinal} ; statut resté « ⏳ » ${enAttente}`);
      ok(refus > 0, `M3 [${variante}] : des refus après conflit sont exercés`);
      if(variante === 'corrigé') ok(ecranFinal === refus && enAttente === 0, 'M3 : à chaque refus, l’écran final s’affiche et le statut passe à l’échec');
      else ok(ecranFinal < refus && enAttente > 0, 'M3 : contre-épreuve — sans notSaved ni statut, l’écran reste figé et le statut bloqué sur « ⏳ »');
    }
  });

  await scenario('M2. Fenêtre « Annoncer un dividende » ouverte avant la fin, confirmée après : refusée', async () => {
    for(const variante of ['corrigé', 'ancien']){
      const env = await partieReseau(3161, variante === 'ancien' ? SANS_GARDE_UNIQUE : undefined);
      const A = appareilReseau(env, 'Alice', env.ids[0]);
      const B = appareilReseau(env, 'Bob', env.ids[1]);
      await env.R.pomper();
      B.run("closeModal(); activeTab = 'entreprise'; render()");
      B.run('modalAnnounceDividend()');
      B.doc.trouver('mDividendAmount').value = '3';
      const coA = A.run("state.companies.find(c=>c.name==='Co Alice').id");
      await env.R.attendrePromesse(A.run(`rollDiceAndMove(${ESC(coA)})`));
      await env.R.pomper();
      const fenetreOuverte = !!B.doc.trouver('mOk') && !!B.run('state.gameEndedReason');
      const bob0 = env.serveur().companies.find(c => c.name === 'Co Bob').cash, m0 = masse(env.serveur());
      B.run('lastActionEndMs = 0; lastModalOpenMs = 0;');
      const c = B.doc.cliquer('#mOk');
      await env.R.attendrePromesse(c.promesse); await env.R.pomper();
      const S = env.serveur();
      const bob1 = S.companies.find(c2 => c2.name === 'Co Bob').cash;
      console.log(`    [${variante}] fenêtre encore ouverte à la fin : ${fenetreOuverte} ; Co Bob ${f4(bob0)} → ${f4(bob1)} ; annonces ${S.dividendAnnouncements.length} ; alertes ${ESC(B.alerts)}`);
      ok(fenetreOuverte, `M2 [${variante}] : la fin arrive sur l’appareil de Bob pendant que sa fenêtre est ouverte (elle n’est pas fermée)`);
      if(variante === 'corrigé'){
        ok(near(bob1, bob0) && S.dividendAnnouncements.length === 0 && /partie est terminée/.test(B.alerts.join(' ')), 'M2 : confirmation refusée — « La partie est terminée », rien d’enregistré');
        ok(near(masse(S), m0), 'M2 : monnaie conservée');
      } else {
        ok(near(bob1, bob0 - 3) && S.dividendAnnouncements.length === 1, 'M2 : contre-épreuve — l’ancien code immobilise 3 M$ après la fin');
      }
    }
  });

  console.log(failures.length ? `\nÉCHECS (${failures.length}) :\n- ` + failures.join('\n- ') : '');
  console.log(`${failures.length ? 'ÉCHEC' : 'OK'} : section 316 (fin de partie, multi-appareils) — ${n} vérifications, ${failures.length} scénario(s) en échec`);
  process.exit(failures.length ? 1 : 0);
})();
