// Test — Section 319 (lot A), constat S1 de la relecture du 2026-11-11 : action appliquée deux fois après un accusé de
// réception perdu, dès que 100 actions d'autres joueurs passent avant le nouvel essai.
//
// Avant : la question « mon action a-t-elle été écrite ? » se posait à state.appliedActionIds, qui ne garde que les
// 100 derniers identifiants. Scénario chiffré : Alice (encaisse 44) confirme « Investir 1 M$ dans les bons » ; le
// serveur écrit, l'accusé se perd, son téléphone reste coupé 30 minutes ; Bob enregistre 100 petites actions ;
// au retour, l'essai d'Alice voit un conflit, ne trouve plus son identifiant et rejoue : 2 M$ investis (encaisse 42)
// pour UN clic, annoncé « réussi ».
// Après : state.appliedActionSeq garde, par préfixe d'appareil (chargement de page + file d'actions), le dernier
// numéro d'action enregistré, dans la même écriture que la mutation ; l'action n° n est écrite si la liste la contient
// OU si la table porte un numéro >= n pour son préfixe. Avec 99, 100 ou 250 actions de Bob : 1 M$ investi (43).
//
// A. Banc multi-appareils (faux serveur) : 99, 100 et 250 actions des autres pendant la coupure.
// B. Contre-épreuve : la table ne répond jamais (ancien code) → 2 investissements dès 100 actions.
// C. Borne de la table : au-delà de 300 versions d'écart après un essai peut-être écrit, l'absence ne prouve plus
//    rien → issue incertaine, jamais de rejeu (contre-épreuve : rejeu, 2 investissements).
// D. Relecture du serveur après échec réseau (2e endroit qui pose la question) : identifiant sorti de la liste mais
//    numéro dans la table → « réussi », et non « PAS enregistrée » à tort.
// E. Mise en ligne progressive : un appareil encore sur l'ancien code (liste seule) garde la table intacte.
// F. Unités : valeur par défaut dans migrateState, borne à 300 préfixes (les plus récemment mis à jour), ordre gardé
//    par JSON, identifiants mal formés, actions imbriquées (un seul numéro) et actions en file (numéros croissants),
//    file d'actions rechargée (préfixe distinct).
//
// Lancer depuis la racine du dépôt :  node tests/section319-idempotence.test.js
const { Reseau, loadEngine, partie, appareil, serveur, caisse, INVESTIR, compteur, sub } = require('./helpers/banc-319');
const T = compteur(); const { ok, scenario } = T;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ESC = s => JSON.stringify(s);

// Contre-épreuves (ancien comportement réintroduit).
const SANS_TABLE = sub('function stateHasActionSeq(s, id){\n', 'function stateHasActionSeq(s, id){\n  return false;\n');
const SANS_BORNE = sub('function actionAbsenceProvable(freshVersion, minMaybeWrittenBaseVersion){\n', 'function actionAbsenceProvable(freshVersion, minMaybeWrittenBaseVersion){\n  return true;\n');
// Appareil resté sur le code d'avant la section 319 : ni lecture ni écriture de la table.
const ANCIEN_APPAREIL = src => SANS_TABLE(sub('  const a = parseActionId(id);\n  if(!a) return;\n', '  return;\n')(src));

const bons = (s, i) => s.players[i].bondBalance || 0;
const prefixeDe = app => app.eng.run(`ACTION_ID_PREFIX + '-' + actionGeneration`);

// Alice clique UNE fois « Investir 1 » ; le serveur écrit, l'accusé se perd, son téléphone reste coupé 30 minutes ;
// pendant ce temps, Bob enregistre nb petites actions (ou `pendant` modifie le serveur) ; puis Alice se reconnecte.
async function accusePerdu({ nb = 0, transform, transformBob, pendant, graine = 7 }){
  const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
  const R = new Reseau({ graine });
  R.ecrireServeur(P.chemin, P.raw);
  const A = appareil(R, P, 'Alice', P.ids[0], { transform });
  const B = appareil(R, P, 'Bob', P.ids[1], { transform: transformBob === undefined ? transform : transformBob });
  await R.pomper();
  const avant = serveur(R, P);
  R.couperApresProchaineEcriture(A.client, 30 * 60 * 1000);
  let res = null; A.eng.run(INVESTIR(1)).then(r => { res = r; });
  for(let i = 0; i < 2000 && bons(serveur(R, P), 0) !== 1; i++) await R.pas();
  const ecrit = serveur(R, P);
  for(let i = 0; i < nb; i++){
    const r = await R.attendrePromesse(B.eng.run(INVESTIR(0.01)));
    if(!r.ok) throw new Error('action de Bob refusée : ' + r.error);
  }
  if(pendant) pendant({ R, P, A, B });
  const milieu = serveur(R, P);
  await R.pomper();            // le temps passe, Alice se reconnecte, son action en vol se termine
  const apres = serveur(R, P);
  const m = {
    bonsAvant: bons(avant, 0), bonsEcrit: bons(ecrit, 0), bonsMilieu: bons(milieu, 0), bonsApres: bons(apres, 0),
    encaisseAvant: avant.players[0].cash, encaisseApres: apres.players[0].cash,
    monnaie: near(caisse(avant), caisse(apres)), res,
    egal: A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin),
    ids: (apres.appliedActionIds || []).length, table: apres.appliedActionSeq || {},
    prefixeAlice: prefixeDe(A), prefixeBob: prefixeDe(B), versions: apres.version - avant.version,
  };
  console.log(`    ${nb} action(s) de Bob — bons d'Alice sur le serveur : avant ${m.bonsAvant} | après son clic (accusé perdu) ${m.bonsEcrit} | fin de la coupure ${m.bonsMilieu} | après la reconnexion ${m.bonsApres} ; encaisse ${m.encaisseAvant} → ${m.encaisseApres} ; annoncé : ${JSON.stringify(res && { ok: res.ok, uncertain: res.uncertain, notSaved: res.notSaved, reason: res.reason })} ; identifiants gardés ${m.ids}, table ${JSON.stringify(Object.values(m.table))}`);
  return m;
}

(async () => {
  await scenario('A. Accusé perdu, puis 99, 100 et 250 actions des autres pendant la coupure : un seul investissement pour un clic', async () => {
    for(const nb of [99, 100, 250]){
      const m = await accusePerdu({ nb });
      ok(m.bonsEcrit === 1 && m.bonsApres === 1, `A (${nb}) : le serveur porte UN investissement de 1 M$ (après le clic ${m.bonsEcrit}, après la reconnexion ${m.bonsApres})`);
      ok(near(m.encaisseAvant, 44) && near(m.encaisseApres, 43), `A (${nb}) : encaisse d'Alice 44 → 43 (et non 42)`);
      ok(m.res && m.res.ok === true && !m.res.uncertain, `A (${nb}) : l'action est annoncée réussie`);
      ok(m.egal, `A (${nb}) : l'état de l'appareil d'Alice = la valeur du serveur`);
      ok(m.monnaie, `A (${nb}) : monnaie conservée (banque + entreprises + joueurs)`);
      ok(m.table[m.prefixeAlice] === 1 && m.table[m.prefixeBob] === nb && Object.keys(m.table).length === 3, `A (${nb}) : table « dernier numéro par préfixe » = Alice 1, Bob ${nb} (et 2 pour la page qui a créé la partie et ses deux entreprises)`);
      ok(m.ids === Math.min(100, nb + 1), `A (${nb}) : la liste appliedActionIds reste alimentée et bornée à 100 (${m.ids})`);
    }
  });

  await scenario('B. Contre-épreuve : sans la table (liste des 100 derniers identifiants seule), l’action est doublée dès 100 actions', async () => {
    const a = await accusePerdu({ nb: 99, transform: SANS_TABLE });
    ok(a.bonsApres === 1, 'B (99) : ancien code — encore un seul investissement (l’identifiant est le plus ancien des 100 gardés)');
    for(const nb of [100, 250]){
      const m = await accusePerdu({ nb, transform: SANS_TABLE });
      ok(m.bonsApres === 2 && near(m.encaisseApres, 42) && m.res && m.res.ok === true, `B (${nb}) : ancien code — 2 M$ investis pour UN clic (encaisse 44 → 42), annoncé « réussi »`);
    }
  });

  await scenario('C. Borne de la table : au-delà de 300 versions d’écart, issue incertaine et jamais de rejeu', async () => {
    // Pendant la coupure d'Alice, 400 écritures d'autres préfixes ont passé : son préfixe est sorti de la table et son
    // identifiant de la liste (simulé directement sur le serveur ; son investissement de 1 M$ y est toujours).
    const evincer = ({ R, P, A }) => {
      const s = serveur(R, P);
      s.appliedActionIds = [];
      delete s.appliedActionSeq[prefixeDe(A)];
      s.version += 400;
      R.ecrireServeur(P.chemin, JSON.stringify(s));
    };
    const m = await accusePerdu({ pendant: evincer });
    ok(m.bonsApres === 1 && near(m.encaisseApres, 43), 'C : préfixe sorti de la table, 400 versions plus tard : aucun rejeu (1 M$ investi, encaisse 43)');
    ok(m.res && m.res.ok === false && m.res.uncertain === true && m.res.reason === 'unknown' && /impossible de savoir/.test(m.res.error), 'C : issue annoncée incertaine (« impossible de savoir »), ni « réussi » ni « PAS enregistrée »');
    ok(m.egal && m.monnaie, 'C : l’appareil affiche la valeur du serveur ; monnaie conservée');
    const c = await accusePerdu({ pendant: evincer, transform: SANS_BORNE });
    ok(c.bonsApres === 2 && near(c.encaisseApres, 42), 'C : contre-épreuve — sans la borne, l’action est rejouée (2 M$, encaisse 42)');
    // Contrôle : écart faible et action vraiment absente (l'écriture n'est jamais arrivée) → le rejeu reste permis.
    const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
    const eng = loadEngine();
    ok(eng.run('actionAbsenceProvable(310, 10)') === true && eng.run('actionAbsenceProvable(311, 10)') === false && eng.run('actionAbsenceProvable(50, null)') === false && eng.run('APPLIED_ACTION_SEQ_MAX') === 300,
      'C : l’absence prouve quelque chose jusqu’à 300 versions d’écart (310 − 10), plus au-delà (311 − 10)');
    void P;
  });

  await scenario('D. Relecture du serveur après échec réseau : identifiant sorti de la liste, numéro dans la table → « réussi »', async () => {
    for(const variante of ['corrigé', 'ancien', 'borne']){
      const P = await partie(['Alice', 'Bob'], ['garp', 'garp']);
      const R = new Reseau({ graine: 11 });
      R.ecrireServeur(P.chemin, P.raw);
      const A = appareil(R, P, 'Alice', P.ids[0], { transform: variante === 'ancien' ? SANS_TABLE : undefined });
      await R.pomper();
      const cash0 = serveur(R, P).players[0].cash;
      // La 1re écriture arrive sur le serveur (accusé perdu), puis 120 écritures d'autres joueurs passent : la liste ne
      // contient plus l'identifiant d'Alice, la table porte toujours son numéro. Tous ses essais échouent
      // (« disconnect »), puis la relecture répond avec cette valeur fraîche.
      A.eng.sandbox.__ecrireServeur = raw => {
        const s = JSON.parse(raw);
        s.appliedActionIds = Array.from({ length: 100 }, (x, i) => 'autre-0.' + (i + 1));
        s.appliedActionSeq.autre = 120;
        if(variante === 'borne'){ delete s.appliedActionSeq[prefixeDe(A)]; s.version += 400; } else s.version += 120;
        const frais = JSON.stringify(s);
        R.ecrireServeur(P.chemin, frais); A.client.vue.set(P.chemin, frais);
      };
      A.eng.run(`globalThis.__ecrit = false; saveGame = async function(){ saveFailureMaybeWritten = true; if(!__ecrit){ __ecrit = true; __ecrireServeur(JSON.stringify(Object.assign({}, state, {version: state.version + 1}))); } return false; }`);
      const r = await R.attendrePromesse(A.eng.run(`attemptActionWithRetry(async ()=>{ state.players[0].cash += 7; state.bank.cash -= 7; return {ok:true}; })`));
      const S = serveur(R, P);
      console.log(`    [${variante}] serveur : Alice ${cash0} → ${S.players[0].cash} ; annonce : ${JSON.stringify({ ok: r.ok, uncertain: r.uncertain, notSaved: r.notSaved, reason: r.reason })} ; appareil : ${A.eng.run('state.players[0].cash')}`);
      if(variante === 'corrigé'){
        ok(near(S.players[0].cash, cash0 + 7) && r.ok === true, 'D : l’écriture est faite et l’action est annoncée réussie (numéro trouvé dans la table)');
        ok(near(A.eng.run('state.players[0].cash'), cash0 + 7) && A.eng.run('JSON.stringify(state)') === R.valeur(P.chemin), 'D : l’appareil adopte la valeur du serveur');
      } else if(variante === 'ancien'){
        ok(near(S.players[0].cash, cash0 + 7) && r.ok === false && r.notSaved === true && r.reason === 'network' && /PAS été enregistrée/.test(r.error), 'D : contre-épreuve — ancien code : « PAS enregistrée » alors que le serveur porte l’action (+7)');
      } else {
        ok(near(S.players[0].cash, cash0 + 7) && r.ok === false && r.uncertain === true && r.reason === 'unknown', 'D : préfixe sorti de la table et 400 versions d’écart : issue incertaine, pas « PAS enregistrée »');
      }
    }
  });

  await scenario('E. Mise en ligne progressive : un appareil resté sur l’ancien code garde la table intacte', async () => {
    const m = await accusePerdu({ nb: 100, transformBob: ANCIEN_APPAREIL });
    ok(m.bonsApres === 1 && near(m.encaisseApres, 43) && m.res && m.res.ok === true, 'E : Alice (nouveau code), accusé perdu, 100 actions de Bob (ancien code) : un seul investissement');
    ok(m.table[m.prefixeAlice] === 1 && Object.keys(m.table).length === 2, 'E : les 100 écritures de l’ancien appareil ont gardé la table (création 2, Alice 1), sans y ajouter de préfixe');
    ok(m.ids === 100 && m.egal && m.monnaie, 'E : la liste des identifiants reste alimentée par les deux ; appareil = serveur ; monnaie conservée');
    // Sens inverse : l'action d'un appareil ancien n'est reconnue que par la liste (comme avant), sans erreur.
    const inv = await accusePerdu({ nb: 5, transform: ANCIEN_APPAREIL, transformBob: null });
    ok(inv.bonsApres === 1 && inv.res && inv.res.ok === true && inv.table[inv.prefixeBob] === 5 && inv.table[inv.prefixeAlice] === undefined, 'E : Alice sur l’ancien code, Bob sur le nouveau : son action est retrouvée par la liste, la table ne porte que Bob (5)');
  });

  await scenario('F. Unités : migrateState, borne à 300 préfixes, ordre gardé par JSON, identifiants mal formés, imbrication, file', async () => {
    const eng = loadEngine();
    await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
    const m0 = eng.cashTotal();
    // Valeur par défaut dans migrateState (partie d'avant la section 319), et réparation d'une valeur invalide.
    const mig = eng.json(`(()=>{ const out = []; for(const v of [undefined, null, 'x', [1, 2], 7, {'abc-0': 4}]){ const s = JSON.parse(JSON.stringify(state)); if(v === undefined) delete s.appliedActionSeq; else s.appliedActionSeq = v; migrateState(s); out.push(s.appliedActionSeq); } return out; })()`);
    ok(mig.slice(0, 5).every(t => t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).length === 0), 'F : migrateState pose appliedActionSeq = {} quand le champ manque ou est invalide (absent, null, texte, tableau, nombre)');
    ok(JSON.stringify(mig[5]) === '{"abc-0":4}', 'F : migrateState garde une table existante');
    // Lecture : liste OU table ; identifiants mal formés ; autre file d'actions ; ancien format dans la liste.
    const lect = eng.json(`(()=>{ const s = {appliedActionIds:['vieux.3'], appliedActionSeq:{'abc-0':5}}; return ['abc-0.5','abc-0.1','abc-0.6','abc-1.1','abd-0.1','abc-0','abc-0.','abc-0.x','.5','abc-0.0','abc-0.1.5','vieux.3','vieux.2'].map(id=>stateHasActionId(s, id)); })()`);
    ok(JSON.stringify(lect) === JSON.stringify([true, true, false, false, false, false, false, false, false, false, false, true, false]), 'F : écrite si numéro <= dernier numéro du préfixe ; autre préfixe, autre file ou identifiant mal formé : non ; ancien format : par la liste');
    ok(eng.run(`stateHasActionId(null, 'a-0.1')`) === false && eng.run(`stateHasActionId({}, 'a-0.1')`) === false && eng.run(`stateHasActionId({appliedActionSeq:[5]}, '0.1')`) === false, 'F : état vide ou table invalide : jamais « écrite »');
    // Borne : 350 préfixes → les 300 plus récemment mis à jour ; un préfixe remis à jour repasse en dernier.
    const borne = eng.json(`(()=>{ const sauve = state.appliedActionSeq, sauveIds = state.appliedActionIds; state.appliedActionSeq = {}; state.appliedActionIds = [];
      for(let i = 0; i < 350; i++) recordActionId('p' + i + '-0.1');
      const k1 = Object.keys(state.appliedActionSeq);
      recordActionId('p50-0.4'); recordActionId('p50-0.2');           // remis à jour (le numéro ne redescend jamais)
      recordActionId('q-0.1');                                        // un préfixe de plus : le plus ancien sort
      const k2 = Object.keys(JSON.parse(JSON.stringify(state.appliedActionSeq)));
      const out = {n1: k1.length, premier1: k1[0], dernier1: k1[k1.length - 1], n2: k2.length, premier2: k2[0], fin2: k2.slice(-2), p50: state.appliedActionSeq['p50-0'], ids: state.appliedActionIds.length};
      state.appliedActionSeq = sauve; state.appliedActionIds = sauveIds; return out; })()`);
    ok(borne.n1 === 300 && borne.premier1 === 'p50-0' && borne.dernier1 === 'p349-0', 'F : 350 préfixes enregistrés → 300 gardés, les plus récents (p50 à p349)');
    ok(borne.n2 === 300 && borne.premier2 === 'p52-0' && JSON.stringify(borne.fin2) === '["p50-0","q-0"]' && borne.p50 === 4, 'F : un préfixe remis à jour repasse en dernier (ordre gardé après JSON) et son numéro ne redescend pas (4)');
    ok(borne.ids === 100, 'F : la liste appliedActionIds reste bornée à 100');
    // Actions imbriquées : un seul numéro pour l'action englobante ; actions en file : numéros croissants.
    const prefixe = eng.run(`ACTION_ID_PREFIX + '-' + actionGeneration`);
    const n0 = eng.run('actionIdCounter');
    const r1 = await eng.run(`attemptActionWithRetry(async ()=>{ const r = await attemptActionWithRetry(()=>buyBonds(state.players[0], 1)); if(!r.ok) return r; return attemptActionWithRetry(()=>buyBonds(state.players[0], 2)); })`);
    ok(r1 && r1.ok && eng.run('actionIdCounter') === n0 + 1 && eng.run(`state.appliedActionSeq[${ESC(prefixe)}]`) === n0 + 1 && near(eng.run('state.players[0].bondBalance'), 3), 'F : action imbriquée (1 M$ puis 2 M$) : un seul numéro, celui de l’action englobante ; 3 M$ de bons');
    const p2 = eng.run(`attemptActionWithRetry(()=>buyBonds(state.players[0], 1))`), p3 = eng.run(`attemptActionWithRetry(()=>buyBonds(state.players[0], 1))`);
    const [r2, r3] = [await p2, await p3];
    ok(r2.ok && r3.ok && eng.run(`state.appliedActionSeq[${ESC(prefixe)}]`) === n0 + 3 && near(eng.run('state.players[0].bondBalance'), 5), 'F : deux actions en file : numéros croissants, la table porte le dernier ; 5 M$ de bons');
    ok(eng.run(`stateHasActionId(state, ${ESC(prefixe + '.' + (n0 + 2))})`) === true && eng.run(`stateHasActionId(state, ${ESC(prefixe + '.' + (n0 + 4))})`) === false, 'F : l’action n° 2 est reconnue écrite, la n° 4 (pas encore lancée) non');
    ok(near(eng.cashTotal(), m0), 'F : monnaie conservée');
    // Partie rechargée : nouvelle file d'actions, donc nouveau préfixe ; les numéros de l'ancienne file ne prouvent rien.
    const code = eng.run('gameCode');
    await eng.run(`loadGame(${ESC(code)})`);
    const prefixe2 = eng.run(`ACTION_ID_PREFIX + '-' + actionGeneration`);
    const r4 = await eng.run(`attemptActionWithRetry(()=>buyBonds(state.players[0], 1))`);
    ok(prefixe2 !== prefixe && r4.ok && eng.run(`state.appliedActionSeq[${ESC(prefixe2)}]`) === n0 + 4 && eng.run(`state.appliedActionSeq[${ESC(prefixe)}]`) === n0 + 3, 'F : après un rechargement de la partie, les actions portent un préfixe distinct (ancienne file : dernier numéro inchangé)');
    ok(eng.run(`stateHasActionId({appliedActionIds:[], appliedActionSeq:{[${ESC(prefixe2)}]: 9}}, ${ESC(prefixe + '.5')})`) === false, 'F : un numéro de la nouvelle file ne fait pas passer pour écrite une action de l’ancienne');
  });

  T.fin('section 319 (S1 : idempotence sans fenêtre glissante)');
})();
