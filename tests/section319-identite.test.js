// Test — Section 319 (lot A), constat S2 de la relecture du 2026-11-11 : « Vous êtes » changé pendant qu'une action
// s'enregistre ; l'action, rejouée après un conflit, est débitée au NOUVEAU joueur.
//
// Scénario chiffré (téléphone partagé par Alice et Bob, encaisses 44 chacun) : Chloé vient d'enregistrer une action
// que le téléphone n'a pas encore reçue ; Alice confirme « Investir 1 M$ dans les bons » (1er essai calculé à son
// nom) ; avant la fin de l'enregistrement, le téléphone passe à Bob, qui choisit « Vous êtes : Bob » ; l'essai
// d'Alice tombe sur un conflit et son applyFn, qui relit myPlayerId, est rejouée.
// Avant : 1 M$ prélevé sur l'encaisse de Bob (43), journal « Bob investit », annoncé réussi ; Alice n'a rien.
// Après, deux gardes :
//   1. les menus « Vous êtes » (#whoami, #cWhoami) refusent le changement tant qu'une action de cet appareil est en
//      vol ou en file : la liste revient à l'identité en cours, un message bref l'explique ; l'action d'Alice
//      s'enregistre à son nom (Alice 43, Bob 44) ;
//   2. filet : l'identité est mémorisée à l'appel d'attemptActionWithRetry ; si elle a changé avant une application
//      (changement par programme, garde 1 contournée), rien n'est appliqué : résultat notSaved (Alice 44, Bob 44).
//
// A. Garde du menu, vrai écouteur de #whoami (mini-DOM), conflit et rejeu : l'action reste celle d'Alice.
// B. Filet seul (identité changée par programme pendant l'enregistrement) : refus propre, Bob jamais débité.
// C. Contre-épreuves : sans la garde du menu (le filet tient) ; sans les deux (Bob est débité).
// D. Action en file : identité changée avant son tour → refusée à sa 1re application.
// E. Rien de cassé : action lancée sans identité puis choix sur l'écran « Vous êtes » ; même identité re-choisie ;
//    #cWhoami (écran de fondation) ; chooseIdentity ; unités.
//
// Lancer depuis la racine du dépôt :  node tests/section319-identite.test.js
const { Reseau, loadEngine, partie, appareil, serveur, caisse, micro, INVESTIR, compteur, sub, enchainer } = require('./helpers/banc-319');
const T = compteur(); const { ok, scenario } = T;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ESC = s => JSON.stringify(s);

// Contre-épreuves (ancien comportement réintroduit).
const SANS_GARDE_MENU = sub("    if(identityChangeBlocked(e.target.value)){ e.target.value = myPlayerId; return; } // Section 319 — S2 : pas de changement d'identité pendant qu'une action s'enregistre\n", '');
const SANS_FILET = sub('  applyFn = ()=> actionIdentityChanged(identityAtCall) ? identityChangedActionResult(opts && opts.label) : guardedFn();\n', '');
const ANCIEN = enchainer(SANS_GARDE_MENU, SANS_FILET);

// Ce que fait un joueur qui choisit une autre ligne de la liste : la valeur change, puis l'événement « change ».
async function changer(app, id, valeur){
  const el = app.doc.trouver(id);
  if(!el) throw new Error('élément absent : #' + id);
  el.value = valeur;
  const ecouteurs = el.__cible._ecouteurs.filter(e => e.type === 'change');
  if(!ecouteurs.length) throw new Error('aucun écouteur « change » sur #' + id);
  for(const e of ecouteurs) await e.fn.call(el, { type: 'change', target: el, currentTarget: el });
  await micro();
}
const indicateur = app => app.doc.trouver('actionStatusIndicator').innerHTML;
const joueur = (s, nom) => s.players.find(p => p.name === nom);

// Téléphone partagé (« Vous êtes » = Alice) et téléphone de Chloé. Chloé enregistre une action que le téléphone
// partagé n'a pas encore reçue, puis Alice confirme « Investir 1 » : son 1er essai est en vol, un conflit l'attend.
async function miseEnPlace(transform, graine = 5){
  const P = await partie(['Alice', 'Bob', 'Chloe'], ['garp', 'garp', 'garp']);
  const R = new Reseau({ graine });
  R.ecrireServeur(P.chemin, P.raw);
  const Tel = appareil(R, P, 'Téléphone partagé', P.ids[0], { transform, dom: true });
  const C = appareil(R, P, 'Chloe', P.ids[2], { transform });
  await R.pomper();
  const avant = serveur(R, P);
  const pC = C.eng.run(INVESTIR(0.01));
  await micro();
  for(let i = 0; i < 50 && serveur(R, P).version === avant.version; i++) R.livrerAuServeur(C.client);
  if(serveur(R, P).version !== avant.version + 1 || Tel.eng.run('state.version') !== avant.version) throw new Error('mise en place : le conflit attendu n’est pas en place');
  const e = { P, R, Tel, C, avant, pC, res: null };
  Tel.eng.run(INVESTIR(1)).then(r => { e.res = r; });
  await micro();   // l'applyFn d'Alice a tourné (1er essai, à son nom) et sa transaction est partie
  if(Tel.eng.run('actionsInFlight') !== 1 || !/Alice investit 1/.test(Tel.eng.run('state.log[0].text'))) throw new Error('mise en place : l’action d’Alice devrait être en vol');
  return e;
}
async function finir(e){
  await e.R.pomper(); await e.pC;
  const S = serveur(e.R, e.P);
  const m = {
    S, alice: joueur(S, 'Alice'), bob: joueur(S, 'Bob'), chloe: joueur(S, 'Chloe'),
    journal: S.log.slice(0, 2).map(x => String(x.text).slice(0, 60)).reverse().join(' PUIS '),
    monnaie: near(caisse(e.avant), caisse(S)),
    egal: e.Tel.eng.run('JSON.stringify(state)') === e.R.valeur(e.P.chemin),
  };
  console.log(`    bons : Alice ${m.alice.bondBalance || 0} | Bob ${m.bob.bondBalance || 0} ; encaisse : Alice ${m.alice.cash} | Bob ${m.bob.cash} ; annoncé : ${JSON.stringify(e.res && { ok: e.res.ok, notSaved: e.res.notSaved, reason: e.res.reason })} ; journal : ${m.journal}`);
  return m;
}

(async () => {
  await scenario('A. Garde du menu : « Vous êtes » refuse le changement pendant l’enregistrement ; l’action reste celle d’Alice', async () => {
    const e = await miseEnPlace();
    const { Tel, P } = e;
    ok(Tel.doc.trouver('whoami') && Tel.doc.trouver('whoami').value === P.ids[0], 'A : le menu « Vous êtes » affiche Alice');
    await changer(Tel, 'whoami', P.ids[1]);   // Bob choisit « Vous êtes : Bob » pendant l'enregistrement
    ok(Tel.eng.run('myPlayerId') === P.ids[0], 'A : pendant l’enregistrement, l’identité de l’appareil reste Alice');
    ok(Tel.doc.trouver('whoami').value === P.ids[0], 'A : la liste revient à l’identité en cours (Alice)');
    ok(/Vous êtes/.test(indicateur(Tel)) && /en cours d’enregistrement/.test(indicateur(Tel)), 'A : un message bref l’explique (« Une action est en cours d’enregistrement : « Vous êtes » ne peut pas changer… »)');
    ok(Tel.ls.get('mb:mychar:' + P.code) === P.ids[0], 'A : l’identité mémorisée sur l’appareil n’a pas changé');
    const m = await finir(e);
    ok(e.res && e.res.ok === true, 'A : l’action d’Alice est annoncée réussie (rejouée après le conflit avec Chloé)');
    ok(near(m.alice.bondBalance, 1) && near(m.alice.cash, 43), 'A : 1 M$ investi au nom d’Alice (encaisse 44 → 43)');
    ok(!m.bob.bondBalance && near(m.bob.cash, 44), 'A : Bob n’est pas débité (encaisse 44, aucun bon)');
    ok(/Chloe investit 0.01/.test(m.journal) && /Alice investit 1/.test(m.journal) && !/Bob investit/.test(JSON.stringify(m.S.log)), 'A : journal « Chloe investit » puis « Alice investit », jamais « Bob investit »');
    ok(m.monnaie && m.egal, 'A : monnaie conservée ; l’appareil affiche la valeur du serveur');
    // L'action terminée, le changement est de nouveau accepté.
    await changer(Tel, 'whoami', P.ids[1]);
    ok(Tel.eng.run('myPlayerId') === P.ids[1] && Tel.ls.get('mb:mychar:' + P.code) === P.ids[1] && Tel.doc.trouver('whoami').value === P.ids[1], 'A : une fois l’action enregistrée, « Vous êtes : Bob » est accepté et mémorisé');
    const rB = await e.R.attendrePromesse(Tel.eng.run(INVESTIR(2)));
    await e.R.pomper();
    const S2 = serveur(e.R, P);
    ok(rB.ok && near(joueur(S2, 'Bob').bondBalance, 2) && near(joueur(S2, 'Bob').cash, 42) && near(joueur(S2, 'Alice').cash, 43), 'A : l’action suivante est bien celle de Bob (2 M$, encaisse 44 → 42)');
  });

  await scenario('B. Filet : identité changée par programme pendant l’enregistrement → refus propre, Bob jamais débité', async () => {
    const e = await miseEnPlace();
    const { Tel, P } = e;
    Tel.eng.run(`myPlayerId = ${ESC(P.ids[1])}; render();`);   // sans passer par le menu
    const m = await finir(e);
    ok(e.res && e.res.ok === false && e.res.notSaved === true && e.res.reason === 'identity' && e.res.code === 'identity-changed', 'B : l’action d’Alice est refusée proprement (notSaved, raison « identity »)');
    ok(/Vous êtes/.test(e.res.error) && /PAS été enregistrée/.test(e.res.error), 'B : message clair (« Vous êtes » a changé… n’a PAS été enregistrée)');
    ok(!m.bob.bondBalance && near(m.bob.cash, 44), 'B : Bob n’est pas débité (encaisse 44, aucun bon)');
    ok(!m.alice.bondBalance && near(m.alice.cash, 44), 'B : rien n’est enregistré pour Alice non plus (encaisse 44)');
    ok(near(m.chloe.bondBalance, 0.01) && !/Bob investit|Alice investit/.test(JSON.stringify(m.S.log)), 'B : l’action de Chloé est en place ; le journal ne porte ni « Alice investit » ni « Bob investit »');
    ok(m.monnaie && m.egal, 'B : monnaie conservée ; l’appareil affiche la valeur du serveur (état restauré)');
    ok(Tel.eng.run('actionsInFlight') === 0 && Tel.eng.run('myLastActionStatus && myLastActionStatus.status') === 'failed', 'B : plus aucune action en vol ; le statut de l’action passe à l’échec');
    // Sans conflit (pas de rejeu) : l'identité changée après le 1er essai ne change rien, l'action est celle d'Alice.
    const P2 = await partie(['Alice', 'Bob'], ['garp', 'garp']);
    const R2 = new Reseau({ graine: 6 });
    R2.ecrireServeur(P2.chemin, P2.raw);
    const Tel2 = appareil(R2, P2, 'Téléphone partagé', P2.ids[0], { dom: true });
    await R2.pomper();
    let res2 = null; Tel2.eng.run(INVESTIR(1)).then(r => { res2 = r; });
    await micro();
    Tel2.eng.run(`myPlayerId = ${ESC(P2.ids[1])};`);
    await R2.pomper();
    const S2 = serveur(R2, P2);
    ok(res2 && res2.ok === true && near(joueur(S2, 'Alice').bondBalance, 1) && !joueur(S2, 'Bob').bondBalance, 'B : sans rejeu, le 1er essai (calculé au nom d’Alice) est enregistré tel quel : Alice 1 M$, Bob rien');
  });

  await scenario('C. Contre-épreuves : sans la garde du menu, le filet tient ; sans les deux, Bob est débité', async () => {
    const e1 = await miseEnPlace(SANS_GARDE_MENU);
    await changer(e1.Tel, 'whoami', e1.P.ids[1]);
    ok(e1.Tel.eng.run('myPlayerId') === e1.P.ids[1], 'C : sans la garde du menu, l’identité passe à Bob pendant l’enregistrement');
    const m1 = await finir(e1);
    ok(e1.res && e1.res.ok === false && e1.res.reason === 'identity' && !m1.bob.bondBalance && near(m1.bob.cash, 44) && !m1.alice.bondBalance, 'C : le filet refuse le rejeu : Bob 44, Alice 44, rien n’est enregistré');
    const e2 = await miseEnPlace(ANCIEN);
    await changer(e2.Tel, 'whoami', e2.P.ids[1]);
    const m2 = await finir(e2);
    ok(e2.res && e2.res.ok === true && near(m2.bob.bondBalance, 1) && near(m2.bob.cash, 43) && !m2.alice.bondBalance && near(m2.alice.cash, 44) && /Bob investit 1/.test(m2.journal),
      'C : ancien code — l’investissement confirmé par Alice est prélevé sur Bob (44 → 43), journal « Bob investit », annoncé réussi');
    const e3 = await miseEnPlace(SANS_FILET);
    e3.Tel.eng.run(`myPlayerId = ${ESC(e3.P.ids[1])}; render();`);
    const m3 = await finir(e3);
    ok(near(m3.bob.bondBalance, 1) && near(m3.bob.cash, 43), 'C : sans le filet, un changement par programme débite Bob (44 → 43)');
  });

  await scenario('D. Action en file : identité changée avant son tour → refusée à sa 1re application', async () => {
    const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
    const R = new Reseau({ graine: 8 });
    R.ecrireServeur(P.chemin, P.raw);
    const Tel = appareil(R, P, 'Téléphone partagé', P.ids[0], { dom: true });
    await R.pomper();
    const avant = serveur(R, P);
    let r1 = null, r2 = null;
    Tel.eng.run(INVESTIR(1)).then(r => { r1 = r; });
    Tel.eng.run(INVESTIR(3)).then(r => { r2 = r; });   // en file derrière la première
    await micro();
    ok(Tel.eng.run('actionsInFlight') === 2, 'D : deux actions d’Alice, l’une en vol, l’autre en file');
    await changer(Tel, 'whoami', P.ids[1]);
    ok(Tel.eng.run('myPlayerId') === P.ids[0] && Tel.doc.trouver('whoami').value === P.ids[0], 'D : le menu refuse le changement tant qu’une action est en vol ou en file');
    Tel.eng.run(`myPlayerId = ${ESC(P.ids[1])};`);   // garde contournée (programme) avant le tour de la 2e action
    await R.pomper();
    const S = serveur(R, P);
    console.log(`    bons : Alice ${joueur(S, 'Alice').bondBalance || 0} | Bob ${joueur(S, 'Bob').bondBalance || 0} ; annoncé : 1re ${JSON.stringify({ ok: r1.ok })}, 2e ${JSON.stringify({ ok: r2.ok, reason: r2.reason })}`);
    ok(r1 && r1.ok === true && near(joueur(S, 'Alice').bondBalance, 1), 'D : la 1re action (déjà appliquée au nom d’Alice) est enregistrée : Alice 1 M$');
    ok(r2 && r2.ok === false && r2.notSaved === true && r2.reason === 'identity', 'D : la 2e, pas encore appliquée, est refusée (raison « identity »)');
    ok(!joueur(S, 'Bob').bondBalance && near(joueur(S, 'Bob').cash, 44) && near(joueur(S, 'Alice').cash, 43), 'D : Bob n’est pas débité des 3 M$ (encaisse 44) ; Alice 43');
    ok(near(caisse(avant), caisse(S)) && Tel.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'D : monnaie conservée ; appareil = serveur');
  });

  await scenario('E. Rien de cassé : écran « Vous êtes », action lancée par programme, même identité, écran de fondation', async () => {
    // Appareil sans identité mémorisée : écran « Vous êtes ». Une action lancée par programme (sans identité) est en
    // vol quand le joueur choisit son nom : le choix est accepté et l'action s'enregistre.
    const P = await partie(['Alice', 'Bob', 'Chloe'], ['garp', null, 'garp']);   // Bob n'a pas encore d'entreprise
    const R = new Reseau({ graine: 9 });
    R.ecrireServeur(P.chemin, P.raw);
    const N = appareil(R, P, 'Nouvel appareil', null, { dom: true });
    await R.pomper();
    const avant = serveur(R, P);
    ok(N.eng.run('myPlayerId') === null && !!N.doc.trouver(`[data-identity-pick="${P.ids[0]}"]`), 'E : appareil sans identité : écran « Vous êtes »');
    let rp = null; N.eng.run(`attemptActionWithRetry(()=>{ state.bank.cash -= 1; state.players[2].cash += 1; return {ok:true}; }, {label:'Programme'})`).then(r => { rp = r; });
    await micro();
    const clic = N.doc.cliquer(`[data-identity-pick="${P.ids[0]}"]`); await clic.promesse; await micro();
    ok(clic.clic === 'ok' && N.eng.run('myPlayerId') === P.ids[0] && N.ls.get('mb:mychar:' + P.code) === P.ids[0], 'E : le choix « Vous êtes : Alice » est accepté pendant l’action lancée sans identité');
    await R.pomper();
    let S = serveur(R, P);
    ok(rp && rp.ok === true && near(S.players[2].cash, avant.players[2].cash + 1) && near(caisse(S), caisse(avant)), 'E : l’action lancée par programme est enregistrée (Chloe +1, banque −1, monnaie conservée)');
    // Même identité re-choisie pendant une action : ni refus ni message.
    let ra = null; N.eng.run(INVESTIR(1)).then(r => { ra = r; });
    await micro();
    const indic0 = indicateur(N);
    await changer(N, 'whoami', P.ids[0]);
    ok(N.eng.run('myPlayerId') === P.ids[0] && !/ne peut pas changer/.test(indicateur(N)) && !/ne peut pas changer/.test(indic0), 'E : re-choisir la même identité pendant une action ne déclenche aucun refus');
    ok(await N.eng.run(`chooseIdentity(${ESC(P.ids[2])})`) === false && N.eng.run('myPlayerId') === P.ids[0], 'E : chooseIdentity vers un autre joueur est refusé pendant une action d’un appareil identifié');
    await R.pomper();
    S = serveur(R, P);
    ok(ra && ra.ok === true && near(joueur(S, 'Alice').bondBalance, 1), 'E : l’action d’Alice est enregistrée (1 M$)');
    ok(await N.eng.run(`chooseIdentity(${ESC(P.ids[1])})`) === true && N.eng.run('myPlayerId') === P.ids[1], 'E : hors action, chooseIdentity fonctionne (Bob)');
    // Écran de fondation (Bob n'a pas d'entreprise) : le menu #cWhoami porte la même garde.
    N.eng.run('render()'); await micro();
    ok(!!N.doc.trouver('cWhoami') && N.doc.trouver('cWhoami').value === P.ids[1], 'E : écran de fondation de Bob, menu « Vous êtes » (#cWhoami) sur Bob');
    let rb = null; N.eng.run(INVESTIR(2)).then(r => { rb = r; });
    await micro();
    await changer(N, 'cWhoami', P.ids[0]);
    ok(N.eng.run('myPlayerId') === P.ids[1] && N.doc.trouver('cWhoami').value === P.ids[1] && /ne peut pas changer/.test(indicateur(N)), 'E : #cWhoami refuse aussi le changement pendant une action (reste Bob, message bref)');
    await R.pomper();
    S = serveur(R, P);
    ok(rb && rb.ok === true && near(joueur(S, 'Bob').bondBalance, 2) && near(joueur(S, 'Alice').bondBalance, 1) && near(caisse(S), caisse(avant)), 'E : l’action de Bob est enregistrée à son nom (2 M$) ; monnaie conservée');
    await changer(N, 'cWhoami', P.ids[0]);
    ok(N.eng.run('myPlayerId') === P.ids[0], 'E : une fois l’action terminée, #cWhoami accepte le changement');
    // Unités (mode local).
    const eng = loadEngine();
    const ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    eng.run(`myPlayerId = ${ESC(ids[0])}`);
    ok(eng.run('actionIdentityChanged(undefined)') === false && eng.run('actionIdentityChanged(null)') === false && eng.run(`actionIdentityChanged(${ESC(ids[0])})`) === false && eng.run(`actionIdentityChanged(${ESC(ids[1])})`) === true,
      'E : filet — pas d’identité à l’appel : jamais de refus ; même identité : non ; identité différente : oui');
    ok(eng.run(`identityChangeBlocked(${ESC(ids[1])})`) === false, 'E : hors action, le changement d’identité n’est pas bloqué');
    // Modèle habituel des tests et des outils : identité posée par programme AVANT l'action, rendue APRÈS.
    const m0 = eng.cashTotal();
    const r = await eng.run(`(async ()=>{ const moi = myPlayerId; myPlayerId = ${ESC(ids[1])}; const r = await ${INVESTIR(1)}; myPlayerId = moi; return r; })()`);
    ok(r.ok === true && near(eng.run('state.players[1].bondBalance'), 1) && near(eng.cashTotal(), m0), 'E : identité posée par programme avant l’action et rendue après : l’action passe (Bob 1 M$), monnaie conservée');
  });

  T.fin('section 319 (S2 : identité changée pendant un enregistrement)');
})();
