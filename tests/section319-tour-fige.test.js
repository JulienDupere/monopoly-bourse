// Test — Section 319 (relecture de la synchronisation du 2026-11-11), constat M1 : tour figé entre « Tour Terminé »
// et le lancer. Le dernier « Tour Terminé » fait deux écritures : 1) l'entreprise est prête (markCompanyReady),
// 2) le lancer (checkAllCompaniesReady → performRollForAllCompanies). Si la page disparaît entre les deux, ou si la
// seconde échoue, toutes les entreprises sont prêtes sur le serveur, le lancer n'a pas eu lieu, et aucun appareil ne
// le relançait : chaque CEO ne voyait que « Annuler Tour Terminé », sans explication.
// Mécanique retenue : un secours visible, sans automatisme. Quand l'état « toutes prêtes, pas de lancer » dure depuis
// 5 s sur un appareil, la barre des entreprises prêtes y montre « Toutes les entreprises sont prêtes, mais le lancer
// n'est pas parti. » et un bouton « Lancer les dés » (numéro du lancer affiché), à chaque joueur identifié.
//
// Banc : faux serveur et faux SDK de tests/helpers/fake-firebase.js (un client par appareil, fermeture de page),
// mini-DOM de fake-dom.js pour cliquer les VRAIS boutons, temps virtuel (Date et minuteries des moteurs).
// Contre-épreuve : le scénario est rejoué sans le secours (option transform) : le tour reste figé.
//
// Lancer depuis la racine du dépôt :  node tests/section319-tour-fige.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { Reseau } = require('./helpers/fake-firebase');
const { creerDocument } = require('./helpers/fake-dom');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };
const failures = [];
async function scenario(title, fn){
  console.log(title);
  try{ await fn(); }
  catch(e){ const m = (e && e.message) ? e.message : String(e); console.log('  ' + m); failures.push(title.slice(0, 2) + ' — ' + m); }
}

// Ancien écran : ni la barre des entreprises prêtes ni l'onglet Entreprise ne montrent le secours.
const SANS_SECOURS = src => src.replace('${stuckRollRescueHtml()}', '').replace('${stuckRollRescueHtml(true)}', '');

const BOUTON = '[data-roll-rescue]';
const caisse = s => (s.bank.cash || 0) + s.companies.reduce((a, c) => a + (c.cash || 0), 0) + s.players.reduce((a, p) => a + (p.cash || 0), 0);

function fausseDate(maintenant){
  return class DateVirtuelle extends Date {
    constructor(...a){ if(a.length === 0) super(maintenant()); else super(...a); }
    static now(){ return maintenant(); }
  };
}
// Partie à trois CEO fabriquée en mode local ; modifier(state) la met dans l'état de départ voulu.
async function partie(modifier){
  const eng = loadEngine();
  const ids = await eng.newGame(['Alice', 'Bob', 'Chloe'], ['garp', 'dividende', 'garp']);
  if(modifier) eng.run('(' + modifier.toString() + ')(state)');
  await eng.run('saveGame({silent:true})');
  const code = eng.run('gameCode');
  return { code, ids, raw: eng.mem.get('game:' + code), chemin: 'data/game:' + code };
}
// Un appareil (page) relié au faux serveur, avec la partie et l'identité mémorisées comme après une première visite.
function appareil(R, P, nom, joueurId, { transform, spectateur } = {}){
  const client = R.creerClient(nom);
  const doc = creerDocument();
  const ls = new Map([['mb:lastcode', P.code]]);
  if(joueurId) ls.set('mb:mychar:' + P.code, joueurId);
  if(spectateur) ls.set('mb:lastspectator', '1');
  const alertes = [];
  const eng = loadEngine({ firebase: client.firebase, transform, globals: {
    document: doc,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    Date: fausseDate(() => R.maintenant()),
    setTimeout: client.setTimeout, setInterval: client.setInterval, clearTimeout: client.clearTimeout, clearInterval: client.clearInterval,
    alert: m => alertes.push(String(m)), confirm: () => true,
    __FIREBASE_CONFIG__: { apiKey: 'cle-de-test', databaseURL: 'https://banc-319.invalid' },
  } });
  return { nom, client, doc, eng, alertes };
}
const serveur = (R, P) => JSON.parse(R.valeur(P.chemin));
// Le mini-DOM garde le HTML de chaque élément à part : barre du haut dans #app, onglet ouvert dans #tabbody.
const ecran = d => String(d.doc.trouver('app').innerHTML) + String((d.doc.trouver('tabbody') || { innerHTML: '' }).innerHTML);
const boutonVisible = d => !!d.doc.trouver(BOUTON);
const aJour = (R, P, d) => d.eng.run('lastSerialized') === R.valeur(P.chemin);
const etat = s => `lancer ${s.gameClock.rollCount} | prêtes : ${s.companies.map(c => c.name + '=' + !!c.ready).join(', ')}`;
// Avance pas à pas jusqu'à ce que cond() soit vraie.
async function jusqua(R, cond, quoi){
  const microtaches = () => new Promise(r => setImmediate(r));
  await microtaches();                                                     // une page tout juste chargée n'a encore rien envoyé
  for(let i = 0, calmes = 0; i < 20000 && calmes < 3; i++){
    if(cond()) return;
    if(await R.pas()) calmes = 0; else { calmes++; await microtaches(); }
  }
  if(!cond()) throw new Error('Banc : jamais atteint — ' + quoi);
}
function cliquer(d, sel){
  const r = d.doc.cliquer(sel);
  if(r.clic !== 'ok') throw new Error(`${d.nom} : clic sur ${sel} : ${r.clic}`);
  return r.promesse;
}

// Scénario du rapport : Alice et Chloe sont prêtes, Bob clique le dernier « Tour Terminé », sa page disparaît entre
// l'écriture « prête » et le lancer.
async function tourFige(opts = {}){
  const P = await partie(s => { s.companies.forEach(c => { if(c.name !== 'Co Bob') c.ready = true; }); });
  const R = new Reseau({ graine: opts.graine || 11 });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], opts), B = appareil(R, P, 'Bob', P.ids[1], opts), C = appareil(R, P, 'Chloe', P.ids[2], opts);
  await R.pomper();
  const s0 = serveur(R, P);
  const coBob = s0.companies.find(c => c.name === 'Co Bob').id;
  cliquer(B, '.tab[data-tab="entreprise"]');
  cliquer(B, `[data-mark-ready="${coBob}"]`).catch(() => {});
  await jusqua(R, () => serveur(R, P).companies.find(c => c.id === coBob).ready, 'écriture « prête » de Bob');
  R.fermer(B.client);                                                      // la page de Bob disparaît avant le lancer
  return { P, R, A, B, C, s0, coBob };
}

(async () => {
  // =====================================================================================================
  await scenario('A. Page de Bob rechargée entre « prête » et le lancer : le secours apparaît sur chaque appareil après 5 s', async () => {
    const T = await tourFige();
    const { P, R, A, C, s0 } = T;
    const total0 = caisse(s0);
    console.log(`    départ : ${etat(s0)} | caisse ${total0}`);
    // Alice et Chloe reçoivent l'état « toutes prêtes » : rien ne s'affiche tout de suite.
    await jusqua(R, () => aJour(R, P, A) && aJour(R, P, C) && /3\/3/.test(ecran(A)) && /3\/3/.test(ecran(C)), 'réception de l’état « toutes prêtes »');
    const tVu = R.maintenant(), s1 = serveur(R, P);
    console.log(`    après la disparition de la page de Bob : ${etat(s1)} | version ${s1.version}`);
    ok(s1.gameClock.rollCount === 0 && s1.companies.every(c => c.ready), 'A : sur le serveur, les 3 entreprises sont prêtes et le lancer 0 n’a pas eu lieu');
    ok(!boutonVisible(A) && !boutonVisible(C) && /3\/3/.test(ecran(A)), 'A : à la réception (3/3 prêtes), le secours n’est pas encore affiché (pas de clignotement)');
    // Le délai s'écoule sans aucune action d'un joueur.
    const apparu = {};
    for(const d of [A, C]){ await jusqua(R, () => boutonVisible(d), `bouton de secours chez ${d.nom}`); apparu[d.nom] = R.maintenant() - tVu; }
    console.log(`    secours affiché sans action d’un joueur : Alice après ${(apparu.Alice / 1000).toFixed(2)} s, Chloe après ${(apparu.Chloe / 1000).toFixed(2)} s (délai : 5 s)`);
    ok(apparu.Alice >= 4800 && apparu.Alice < 6500 && apparu.Chloe >= 4800 && apparu.Chloe < 6500, 'A : le bouton apparaît de lui-même environ 5 s après, chez Alice et chez Chloe');
    ok(/Toutes les entreprises sont prêtes, mais le lancer n'est pas parti\./.test(ecran(A)) && /Lancer les dés/.test(ecran(A)) && A.doc.trouver(BOUTON).dataset.roll === '0', 'A : ligne d’explication et bouton « Lancer les dés » portant le numéro du lancer affiché (0)');
    // Bob recharge sa page : l'état « prêtes sans lancer » est détecté au chargement.
    const B2 = appareil(R, P, 'Bob (page rechargée)', P.ids[1]);
    await jusqua(R, () => /3\/3/.test(ecran(B2)), 'premier rendu de la page rechargée');
    const tB = R.maintenant();
    ok(!boutonVisible(B2), 'A : page de Bob rechargée — pas de bouton au premier rendu');
    await jusqua(R, () => boutonVisible(B2), 'bouton de secours chez Bob');
    const dB = R.maintenant() - tB;
    console.log(`    page de Bob rechargée : secours affiché après ${(dB / 1000).toFixed(2)} s`);
    ok(dB >= 4800 && dB < 6500, 'A : page de Bob rechargée — le bouton apparaît environ 5 s après le chargement');
    cliquer(B2, '.tab[data-tab="entreprise"]');
    ok(/Annuler Tour Terminé<\/button><div class="small">Toutes les entreprises sont prêtes, mais le lancer n'est pas parti\.<\/div><button[^>]*data-roll-rescue="1" data-roll="0"/.test(String(B2.doc.trouver('tabbody').innerHTML)) && B2.doc.trouver('#tabbody ' + BOUTON),
      'A : dans l’onglet Entreprise, l’explication et le bouton sont aussi sous « Annuler Tour Terminé »');
    // Un spectateur n'a pas le bouton.
    const S = appareil(R, P, 'Spectateur', null, { spectateur: true });
    // Dix minutes passent : aucun automatisme, le lancer n'a toujours pas eu lieu.
    for(let k = 0; k < 200; k++){ R.temps += 3000; await R.pomper(); }
    const s2 = serveur(R, P);
    console.log(`    10 minutes plus tard : ${etat(s2)} | version ${s2.version} | bouton : Alice ${boutonVisible(A)}, Bob ${boutonVisible(B2)}, Chloe ${boutonVisible(C)}, spectateur ${boutonVisible(S)}`);
    ok(s2.gameClock.rollCount === 0 && s2.version === s1.version, 'A : pas d’automatisme — rien n’est écrit tant que personne ne clique');
    ok(boutonVisible(A) && boutonVisible(B2) && boutonVisible(C), 'A : le bouton est toujours là sur les trois appareils des joueurs');
    ok(S.eng.run('isSpectator') === true && !boutonVisible(S) && !/Lancer les dés/.test(ecran(S)), 'A : le spectateur ne voit pas le bouton');
    // Chloe clique « Lancer les dés » : un seul lancer.
    await R.attendrePromesse(cliquer(C, BOUTON));
    await R.pomper();
    const s3 = serveur(R, P);
    console.log(`    après le clic de Chloe : ${etat(s3)} | caisse ${caisse(s3)} | alertes : Alice ${A.alertes.length}, Bob ${B2.alertes.length}, Chloe ${C.alertes.length}`);
    ok(s3.gameClock.rollCount === 1 && s3.lastDiceRollEvent && s3.lastDiceRollEvent.roll === 0, 'A : un clic lance les dés — le lancer 0 est joué, la partie passe au lancer 1');
    ok(s3.companies.every(c => !c.ready), 'A : après le lancer, plus aucune entreprise n’est « prête »');
    ok(near(caisse(s3), total0), `A : conservation de la monnaie (caisse ${total0} → ${caisse(s3)})`);
    ok(A.alertes.length === 0 && B2.alertes.length === 0 && C.alertes.length === 0, 'A : aucune alerte sur aucun appareil');
    ok(aJour(R, P, A) && aJour(R, P, B2) && aJour(R, P, C) && !boutonVisible(A) && !boutonVisible(B2) && !boutonVisible(C), 'A : les trois appareils sont à jour et le bouton a disparu partout');
    // Le temps passe encore : rien d'autre ne se lance.
    for(let k = 0; k < 10; k++){ R.temps += 3000; await R.pomper(); }
    ok(serveur(R, P).gameClock.rollCount === 1 && !boutonVisible(A), 'A : un seul lancer en tout, et le bouton ne revient pas');
  });

  // =====================================================================================================
  await scenario('B. Deux appareils cliquent « Lancer les dés » en même temps : un seul lancer, aucune alerte', async () => {
    let conflits = 0;
    const graines = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for(const graine of graines){
      const P = await partie(s => { s.companies.forEach(c => { c.ready = true; }); });
      const R = new Reseau({ graine });
      R.ecrireServeur(P.chemin, P.raw);
      const A = appareil(R, P, 'Alice', P.ids[0]), C = appareil(R, P, 'Chloe', P.ids[2]);
      await jusqua(R, () => boutonVisible(A) && boutonVisible(C), 'bouton de secours sur les deux appareils');
      const total0 = caisse(serveur(R, P)), tx0 = R.stats.transactions;
      const pa = cliquer(A, BOUTON), pc = cliquer(C, BOUTON);                // les deux clics partent avant toute réponse
      await R.attendrePromesse(Promise.all([pa, pc]));
      await R.pomper();
      const s = serveur(R, P);
      if(R.stats.perimes > 0) conflits++;
      if(!(s.gameClock.rollCount === 1 && A.alertes.length === 0 && C.alertes.length === 0 && near(caisse(s), total0) && aJour(R, P, A) && aJour(R, P, C) && !boutonVisible(A) && !boutonVisible(C)))
        throw new Error(`ÉCHEC : B : graine ${graine} — lancer ${s.gameClock.rollCount}, alertes Alice ${JSON.stringify(A.alertes)}, Chloe ${JSON.stringify(C.alertes)}, caisse ${total0} → ${caisse(s)}, transactions ${R.stats.transactions - tx0}`);
    }
    console.log(`    ${graines.length} déroulés (graines 1 à 12) : toujours un seul lancer ; ${conflits} avec une transaction périmée par le serveur (les deux lancers sont arrivés au serveur)`);
    ok(true, `B : ${graines.length} déroulés — lancer 0 → 1 exactement, 0 alerte sur les deux appareils, monnaie conservée, appareils à jour, bouton disparu`);
    ok(conflits >= 1, `B : la course est réelle dans ${conflits} déroulé(s) sur ${graines.length} (le perdant est refusé « déjà joué » en silence)`);
    // Double clic sur un même appareil.
    const P = await partie(s => { s.companies.forEach(c => { c.ready = true; }); });
    const R = new Reseau({ graine: 21 });
    R.ecrireServeur(P.chemin, P.raw);
    const A = appareil(R, P, 'Alice', P.ids[0]);
    await jusqua(R, () => boutonVisible(A), 'bouton de secours');
    cliquer(A, '.tab[data-tab="entreprise"]');                               // cette fois par le bouton de l'onglet Entreprise
    const r1 = A.doc.cliquer('#tabbody ' + BOUTON), r2 = A.doc.cliquer('#tabbody ' + BOUTON);
    await R.attendrePromesse(Promise.all([r1.promesse, r2.promesse]));
    await R.pomper();
    console.log(`    double clic d’Alice (bouton de l’onglet Entreprise) : 1er clic « ${r1.clic} », 2e clic « ${r2.clic} » | lancer ${serveur(R, P).gameClock.rollCount} | alertes : ${A.alertes.length}`);
    ok(r1.clic === 'ok' && serveur(R, P).gameClock.rollCount === 1 && A.alertes.length === 0, 'B : double clic sur le même appareil — un seul lancer, aucune alerte');
  });

  // =====================================================================================================
  await scenario('C. Tour normal, annulation : le secours ne s’affiche jamais à tort', async () => {
    // Tour normal : Bob clique le dernier « Tour Terminé », ses deux écritures arrivent.
    const P = await partie(s => { s.companies.forEach(c => { if(c.name !== 'Co Bob') c.ready = true; }); });
    const R = new Reseau({ graine: 31 });
    R.ecrireServeur(P.chemin, P.raw);
    const A = appareil(R, P, 'Alice', P.ids[0]), B = appareil(R, P, 'Bob', P.ids[1]), C = appareil(R, P, 'Chloe', P.ids[2]);
    await R.pomper();
    const coBob = serveur(R, P).companies.find(c => c.name === 'Co Bob').id;
    cliquer(B, '.tab[data-tab="entreprise"]');
    const t0 = R.maintenant();
    const p = cliquer(B, `[data-mark-ready="${coBob}"]`);
    let vuPret = false, clignote = false, tLancer = null;
    for(let i = 0; i < 20000; i++){
      const s = serveur(R, P);
      if(s.gameClock.rollCount === 0 && s.companies.every(c => c.ready)) vuPret = true;
      if(s.gameClock.rollCount === 1 && tLancer === null) tLancer = R.maintenant() - t0;
      if(boutonVisible(A) || boutonVisible(B) || boutonVisible(C)) clignote = true;
      if(!(await R.pas())) break;
    }
    await p;
    for(let k = 0; k < 5; k++){ R.temps += 3000; await R.pomper(); if(boutonVisible(A) || boutonVisible(B) || boutonVisible(C)) clignote = true; }
    console.log(`    tour normal : état « toutes prêtes sans lancer » traversé : ${vuPret} | lancer enregistré ${tLancer} ms après le clic | secours affiché à un moment : ${clignote}`);
    ok(vuPret && serveur(R, P).gameClock.rollCount === 1 && tLancer < 5000, 'C : tour normal — les deux écritures de Bob se suivent en moins de 5 s (lancer 0 → 1)');
    ok(!clignote && A.alertes.length + B.alertes.length + C.alertes.length === 0, 'C : le secours ne s’affiche à aucun moment, sur aucun appareil, ni pendant ni après');
    // Tour figé, puis Alice annule son « Tour Terminé » : le secours disparaît partout.
    const T = await tourFige({ graine: 33 });
    await jusqua(T.R, () => boutonVisible(T.A) && boutonVisible(T.C), 'bouton de secours');
    cliquer(T.A, '.tab[data-tab="entreprise"]');
    const coAlice = serveur(T.R, T.P).companies.find(c => c.name === 'Co Alice').id;
    await T.R.attendrePromesse(cliquer(T.A, `[data-cancel-ready="${coAlice}"]`));
    await T.R.pomper();
    for(let k = 0; k < 5; k++){ T.R.temps += 3000; await T.R.pomper(); }
    const s = serveur(T.R, T.P);
    console.log(`    tour figé puis « Annuler Tour Terminé » d’Alice : ${etat(s)} | bouton : Alice ${boutonVisible(T.A)}, Chloe ${boutonVisible(T.C)}`);
    ok(s.gameClock.rollCount === 0 && !s.companies.find(c => c.id === coAlice).ready && !boutonVisible(T.A) && !boutonVisible(T.C), 'C : une entreprise n’est plus prête — le secours disparaît sur chaque appareil, aucun lancer');
    // Alice reclique « Tour Terminé » : le tour repart normalement (ses deux écritures).
    await T.R.attendrePromesse(cliquer(T.A, `[data-mark-ready="${coAlice}"]`));
    await T.R.pomper();
    ok(serveur(T.R, T.P).gameClock.rollCount === 1 && T.A.alertes.length === 0 && T.C.alertes.length === 0, 'C : Alice reclique « Tour Terminé » — le lancer part normalement (0 → 1), sans alerte');
    // Même état atteint par une autre suite de deux écritures : la dernière entreprise pas prête est envoyée en
    // enquête AMF (sendToJail : 1) enquête, 2) lancer) et la page disparaît avant le lancer. Le secours le couvre.
    const P3 = await partie(s => { s.companies.forEach(c => { if(c.name === 'Co Bob'){ c.inJail = true; c.jailTurnsLeft = 3; c.ready = false; } else c.ready = true; }); });
    const R3 = new Reseau({ graine: 35 });
    R3.ecrireServeur(P3.chemin, P3.raw);
    const A3 = appareil(R3, P3, 'Alice', P3.ids[0]), C3 = appareil(R3, P3, 'Chloe', P3.ids[2]);
    await jusqua(R3, () => boutonVisible(A3) && boutonVisible(C3), 'bouton de secours (une entreprise enquêtée)');
    const total3 = caisse(serveur(R3, P3));
    await R3.attendrePromesse(cliquer(A3, BOUTON));
    await R3.pomper();
    const s3 = serveur(R3, P3);
    console.log(`    Co Bob enquêtée (3 tours), Alice et Chloe prêtes, lancer jamais parti : secours affiché ; après le clic d’Alice : lancer ${s3.gameClock.rollCount}, enquête de Co Bob : ${s3.companies.find(c => c.name === 'Co Bob').jailTurnsLeft} tour(s) restant(s)`);
    ok(s3.gameClock.rollCount === 1 && s3.companies.find(c => c.name === 'Co Bob').jailTurnsLeft === 2 && near(caisse(s3), total3) && A3.alertes.length === 0 && C3.alertes.length === 0,
      'C : 2 entreprises libres prêtes, 1 enquêtée — le secours s’affiche aussi et lance les dés une fois (0 → 1, enquête 3 → 2 tours, monnaie conservée)');
  });

  // =====================================================================================================
  await scenario('D. Contre-épreuve : sans le secours, le tour reste figé', async () => {
    const T = await tourFige({ transform: SANS_SECOURS });
    const { P, R, A, C } = T;
    const B2 = appareil(R, P, 'Bob (page rechargée)', P.ids[1], { transform: SANS_SECOURS });
    for(let k = 0; k < 200; k++){ R.temps += 3000; await R.pomper(); }
    const s = serveur(R, P);
    for(const d of [A, B2, C]) cliquer(d, '.tab[data-tab="entreprise"]');
    const vues = [A, B2, C].map(d => `${d.nom} : « Tour Terminé » ${/data-mark-ready=/.test(ecran(d))}, « Annuler Tour Terminé » ${/data-cancel-ready=/.test(ecran(d))}, « Lancer les dés » ${boutonVisible(d) || /Lancer les dés/.test(ecran(d))}`);
    console.log(`    ancien écran, 10 minutes plus tard : ${etat(s)}`);
    vues.forEach(v => console.log('      ' + v));
    ok(s.gameClock.rollCount === 0 && s.companies.every(c => c.ready), 'D : sans le secours, toutes les entreprises sont prêtes et le lancer n’a toujours pas eu lieu après 10 minutes');
    ok([A, B2, C].every(d => !boutonVisible(d) && !/Lancer les dés/.test(ecran(d)) && /data-cancel-ready=/.test(ecran(d)) && !/data-mark-ready=/.test(ecran(d))), 'D : chaque CEO n’a que « Annuler Tour Terminé », sans explication ni bouton de lancer');
  });

  if(failures.length){
    console.log(`\n${failures.length} scénario(s) en échec :`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`${n} vérifications OK`);
})().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
