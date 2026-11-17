// Test — section 323 (lot 7) : interface du pari du PDG (contrat docs/contrats/section-323-analystes.md, 7.3).
// L'encadré « Annonce du PDG pour le semestre qui commence » (ceoCallBoxHtml), à deux endroits : fenêtre « Résultats du
// tour » (place 'pop') et onglet Entreprise sous les attentes des analystes (place 'ent').
//   A. Encadré permis (cible provisoire, règle, deux gestes, « ne rien annoncer ») aux deux endroits.
//   B. Déjà annoncé (avertissement, promesse) : le texte de l'annonce, sans bouton ; ligne visible de tous (autre joueur).
//   C. Refus : fenêtre fermée, semestre sans verdict, partie terminée ; joueur sans entreprise : rien du tout.
//   D. Fenêtre du tour : absente quand le lancer ne clôt pas un semestre ou que le semestre a déjà changé.
//   E. Nombres lus dans les constantes du moteur (transform) : le texte suit.
//   F. Clic : confirmation, revérification des conditions, appel unique de announceCeoCall avec le bon `kind`, même en
//      double clic ; fenêtre du tour rouverte à jour ; écran redessiné.
//   G. Versions cassées exprès (option transform) : chacune doit faire échouer la suite.
// Lancer depuis la racine du dépôt :  node tests/section323-pari-affichage.test.js
const { loadEngine } = require('./helpers/engine');

let n = 0, quiet = false;
function ok(cond, msg){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  n++; if(!quiet) console.log('  OK', msg);
}
const strip = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
const swap = (a, b) => (src) => { if(!src.includes(a)) throw new Error('motif introuvable : ' + a.slice(0, 70)); return src.split(a).join(b); };
const chain = (...fs) => (src) => fs.reduce((s, f) => f(s), src);
// Constantes d'essai : tout nombre affiché doit suivre.
const CONST_LINE = 'const CEO_WARNING_COST_CUBES = 1, CEO_PROMISE_GAIN_CUBES = 1, CEO_PROMISE_BROKEN_RED_CUBES = 3;';
const AUTRES_CONSTANTES = chain(
  swap(CONST_LINE, 'const CEO_WARNING_COST_CUBES = 4, CEO_PROMISE_GAIN_CUBES = 2, CEO_PROMISE_BROKEN_RED_CUBES = 6;'),
  swap('ANALYST_VERDICT_STRONG_CUBES = 5', 'ANALYST_VERDICT_STRONG_CUBES = 7'));
const K_DEFAUT = { w: 1, g: 1, b: 3, s: 5 }, K_AUTRE = { w: 4, g: 2, b: 6, s: 7 };
const cubes = (k, c) => `${k} cube${k > 1 ? 's' : ''} ${c === 'r' ? 'rouge' : 'vert'}${k > 1 ? 's' : ''}`;

async function boot(transform){
  const eng = loadEngine({ transform, globals: { alert: (m) => { eng.alerts.push(String(m)); } } });
  eng.alerts = [];
  eng.ids = await eng.newGame(['Alice', 'Bob'], ['garp', 'garp'], 20, 1000);
  eng.run(`myPlayerId = ${JSON.stringify(eng.ids[0])}; globalThis.A = state.companies[0]; globalThis.B = state.companies[1];
    globalThis.__modals = []; openModal = function(h){ __modals.push(String(h)); };
    globalThis.__els = {};
    const __orig = document.getElementById;
    document.getElementById = function(id){
      if(/CeoWarningBtn$|CeoPromiseBtn$|^mOk$|^mCancel$/.test(id)) return __els[id] || (__els[id] = {id, disabled:false, listeners:{}, addEventListener(t, f){ this.listeners[t] = f; }});
      return __orig(id);
    };
    globalThis.__click = async id => { const e = __els[id]; return (e && e.listeners.click) ? await e.listeners.click({}) : 'no-listener'; };
    globalThis.__calls = []; globalThis.__renders = 0;
    const __ann = announceCeoCall; announceCeoCall = function(id, k, o){ __calls.push([id, k]); return __ann(id, k, o); };
    renderPreservingForms = function(){ __renders++; };`);
  return eng;
}
const box = (eng, who, place) => eng.run(`ceoCallBoxHtml(${who}, '${place}')`);
const lastModal = (eng) => eng.run(`__modals[__modals.length-1]`);
const popup = (eng, roll) => { eng.run(`state.lastDiceRollEvent = {roll:${roll}, portfolioDeltas:{}}; __modals.length = 0; showDiceRollTurnPopup(A, ${roll});`); return lastModal(eng); };

async function suite(transform, K){
  K = K || K_DEFAUT;
  const eng = await boot(transform);
  const [alice, bob] = eng.ids;
  const NORMAL = 2, ZMIN = 0, ZMAX = 1;
  const texteAvert = `Avertissement : coûte tout de suite ${cubes(K.w, 'r')} au sac fondamental. Si le bénéfice finit sous la zone, le verdict est adouci d'un cran : un verdict fort passe de ${K.s} à ${NORMAL} cubes rouges, un verdict normal de ${NORMAL} cubes rouges à un tirage de ${ZMIN} ou ${ZMAX} cube rouge.`;
  const textePromesse = `Promesse : donne tout de suite ${cubes(K.g, 'v')} au sac fondamental. Si le bénéfice finit sous la zone, ${cubes(K.b, 'r')} s'ajoutent au verdict ; dans la zone ou au-dessus, la promesse est tenue : rien de plus.`;

  console.log('\nA. Encadré permis, aux deux endroits');
  eng.run(`state.gameClock.rollCount = 0;`);
  const [tg, lo, hi] = eng.json(`(()=>{ const f = analystForecastFor(A); return [analystSigned(f.target), analystSigned(f.target - f.zone), analystSigned(f.target + f.zone)]; })()`);
  const ligneCible = `Cible provisoire des analystes : ${tg} — zone acceptable de ${lo} à ${hi}.`;
  const hEnt = box(eng, 'A', 'ent'), tEnt = strip(hEnt);
  console.log('   ' + tEnt);
  ok(tEnt.startsWith('📣 Annonce du PDG pour le semestre qui commence'), 'titre « Annonce du PDG pour le semestre qui commence »');
  ok(tEnt.includes(ligneCible), 'cible et zone provisoires : « ' + ligneCible + ' »');
  ok(tEnt.includes('Une seule annonce par semestre, sans retour possible, avant le premier lancer du semestre.'), 'règle en une ligne');
  ok(tEnt.includes(texteAvert), 'avertissement : coût immédiat et effet à la clôture, nombres des constantes');
  ok(tEnt.includes(textePromesse), 'promesse : gain immédiat et risque, nombres des constantes');
  ok(tEnt.includes('Ne rien annoncer : rien ne change.'), '« Ne rien annoncer : rien ne change. »');
  ok(/id="entCeoWarningBtn"/.test(hEnt) && /id="entCeoPromiseBtn"/.test(hEnt), 'deux boutons (avertissement, promesse) avec leurs identifiants');
  ok(/max-width:100%;white-space:normal/.test(hEnt), 'boutons qui ne débordent pas (téléphone)');
  const page = eng.run(`renderEntreprise()`);
  const pageT = strip(page);
  ok(pageT.includes('Attentes des analystes (ce semestre)') && pageT.includes('Annonce du PDG pour le semestre qui commence') && /id="entCeoPromiseBtn"/.test(page), "onglet Entreprise : l'encadré est dans la page");
  ok(pageT.indexOf('Attentes des analystes') < pageT.indexOf('Annonce du PDG pour le semestre qui commence'), "l'encadré est sous le bloc des attentes");
  // Fenêtre du tour : le lancer 2 clôt le semestre 0 ; le semestre 1 commence (rollCount 3).
  eng.run(`state.gameClock.rollCount = 3;`);
  const hPop = popup(eng, 2), tPop = strip(hPop);
  ok(/id="popCeoCallBox"/.test(hPop) && tPop.includes('Annonce du PDG pour le semestre qui commence'), 'fenêtre du tour : encadré présent quand le lancer clôt un semestre');
  ok(tPop.includes(ligneCible) && tPop.includes(texteAvert) && tPop.includes(textePromesse), 'fenêtre du tour : même contenu (cible, avertissement, promesse)');
  ok(/id="popCeoWarningBtn"/.test(hPop) && /id="popCeoPromiseBtn"/.test(hPop), 'fenêtre du tour : deux boutons');

  console.log('\nD. Fenêtre du tour : encadré absent quand il ne doit pas y être');
  ok(!/CeoCallBox/.test(popup(eng, 1)), 'lancer 1 (ne clôt pas un semestre) : pas d\'encadré');
  ok(!/CeoCallBox/.test(popup(eng, 3)), 'lancer 3 (début d\'un semestre) : pas d\'encadré');
  eng.run(`state.gameClock.rollCount = 6;`);
  ok(!/CeoCallBox/.test(popup(eng, 2)), 'fenêtre du lancer 2 revue deux semestres plus tard : pas d\'encadré');
  eng.run(`state.gameClock.rollCount = 3;`);

  console.log('\nB. Déjà annoncé');
  for(const [kind, mot, cube] of [['warning', 'avertissement', `${cubes(K.w, 'r')} ajouté au sac fondamental`], ['promise', 'promesse', `${cubes(K.g, 'v')} reçu au sac fondamental`]]){
    const e = await boot(transform);
    e.run(`state.gameClock.rollCount = 3;`);
    const r = e.json(`ceoCallApply(A.id, '${kind}', myPlayerId)`);
    ok(r.ok === true, `${mot} faite par le moteur`);
    for(const place of ['ent', 'pop']){
      const h = place === 'ent' ? box(e, 'A', 'ent') : popup(e, 2), t = strip(h);
      ok(t.includes(`Annonce faite pour ce semestre : ${mot} — ${cube}.`), `${place} : « Annonce faite pour ce semestre : ${mot} — ${cube}. »`);
      ok(!/CeoWarningBtn|CeoPromiseBtn/.test(h) && !t.includes('Ne rien annoncer'), `${place} : aucun bouton`);
    }
    console.log('   ' + strip(box(e, 'A', 'ent')));
    // Visible de tous : le bloc des attentes dit l'annonce, même vu par un autre joueur.
    e.run(`myPlayerId = ${JSON.stringify(bob)};`);
    const bloc = strip(e.run(`analystExpectationBlockHtml(A)`));
    ok(bloc.includes(`Annonce du PDG pour ce semestre : ${mot}`), `bloc des attentes : l'annonce (${mot}) est visible d'un autre joueur`);
    ok(box(e, 'A', 'ent') === '', "l'encadré, lui, n'est pas montré à un autre joueur");
    e.run(`state.gameClock.rollCount = 6; A.analystForecast = null;`);
    ok(!strip(e.run(`analystExpectationBlockHtml(A)`)).includes('Annonce du PDG pour ce semestre'), 'une annonce d\'un autre semestre n\'est pas affichée');
  }
  ok(!strip(eng.run(`analystExpectationBlockHtml(A)`)).includes('Annonce du PDG pour ce semestre'), 'sans annonce : aucune ligne dans le bloc des attentes');

  console.log('\nC. Refus et joueur sans entreprise');
  const e2 = await boot(transform);
  e2.run(`state.gameClock.rollCount = 3; A.analystForecast = {semester:1, h:1, m:2, k:3, sigma:0.4, target:2, zone:0.5, parts:{subsidy:1.2, rentsIn:3, rentsOut:0.8, taxes:0.4, charges:0.1}, frozenAtRoll:3};`);
  let h = box(e2, 'A', 'ent'), t = strip(h);
  console.log('   fenêtre fermée : ' + t);
  ok(t.includes('Trop tard pour ce semestre : les chiffres des analystes sont publiés depuis le premier lancer.') && !/CeoWarningBtn|CeoPromiseBtn/.test(h), 'fenêtre fermée : texte du moteur, pas de bouton');
  e2.run(`A.analystForecast = null; state.gameClock.rollCount = 4;`);
  h = box(e2, 'A', 'ent'); t = strip(h);
  console.log('   semestre sans verdict : ' + t);
  ok(/n’aura pas de verdict des analystes/.test(t) && !/CeoWarningBtn|CeoPromiseBtn/.test(h), 'semestre sans verdict : texte du moteur, pas de bouton');
  e2.run(`state.gameClock.rollCount = 3; state.gameEndedReason = {reason:'maxDuration', roll:3, year:0};`);
  h = box(e2, 'A', 'ent'); t = strip(h);
  console.log('   partie terminée : ' + t);
  ok(/La partie est terminée/.test(t) && !/CeoWarningBtn|CeoPromiseBtn/.test(h), 'partie terminée : texte du moteur, pas de bouton');
  ok(/La partie est terminée/.test(strip(popup(e2, 2))), 'partie terminée : même texte dans la fenêtre du tour');
  e2.run(`state.gameEndedReason = null; myPlayerId = 'personne';`);
  ok(box(e2, 'A', 'ent') === '' && box(e2, 'A', 'pop') === '', 'joueur sans entreprise : rien du tout (onglet)');
  ok(!/CeoCallBox/.test(popup(e2, 2)), 'joueur sans entreprise : rien du tout (fenêtre du tour)');
  e2.run(`myPlayerId = ${JSON.stringify(bob)};`);
  ok(box(e2, 'A', 'ent') === '', "l'entreprise d'un autre : rien du tout");

  console.log('\nF. Clic, confirmation, appel unique');
  const e3 = await boot(transform);
  e3.run(`state.gameClock.rollCount = 3; bindCeoCallBox('pop', A, ()=>showDiceRollTurnPopup(A, 2));`);
  popup(e3, 2);
  await e3.run(`__click('popCeoPromiseBtn')`);
  const conf = strip(lastModal(e3));
  console.log('   confirmation : ' + conf);
  ok(conf.includes('Annonce du PDG — promesse') && conf.includes('vous allez faire une promesse pour le semestre 2 de l\'année 1'), 'confirmation : le geste et le semestre');
  // Ronde finale (R6) : « Tout de suite : 1 cube vert au sac fondamental. », sans « tout de suite » répété.
  ok(conf.includes(`Tout de suite : ${cubes(K.g, 'v')} au sac fondamental.`) && conf.includes(`${cubes(K.b, 'r')} s'ajoutent au verdict`), 'confirmation : effet immédiat et effet à la clôture');
  ok(!/Tout de suite : (donne|coûte)/.test(conf) && (conf.match(/tout de suite/gi) || []).length === 2, 'R6 : « tout de suite » pas répété dans la ligne de l\'effet immédiat (reste : le titre et l\'avertissement « sans retour »)');
  ok(conf.includes('Sans retour possible'), 'confirmation : « sans retour possible »');
  ok(e3.json(`__calls`).length === 0 && e3.json(`A.ceoCall`) === null, 'rien n\'est annoncé avant la confirmation');
  await e3.run(`Promise.all([__click('mOk'), __click('mOk')])`);
  ok(JSON.stringify(e3.json(`__calls`)) === JSON.stringify([[e3.json(`A.id`), 'promise']]), 'double clic sur « Annoncer » : un seul appel à announceCeoCall, avec kind = promise');
  ok(e3.json(`A.ceoCall.kind`) === 'promise' && e3.json(`A.ceoCall.semester`) === 1, 'annonce posée par le moteur pour le semestre 1');
  ok(e3.json(`__renders`) === 1, 'écran redessiné une fois (renderPreservingForms)');
  const apres = strip(lastModal(e3));
  ok(apres.includes('Résultats du tour') && apres.includes(`Annonce faite pour ce semestre : promesse — ${cubes(K.g, 'v')} reçu au sac fondamental.`) && !/CeoPromiseBtn/.test(lastModal(e3)), 'fenêtre du tour rouverte : annonce faite, plus de bouton');
  ok(e3.alerts.length === 0, 'aucune alerte');

  const e4 = await boot(transform);
  e4.run(`state.gameClock.rollCount = 0; bindCeoCallBox('ent', A);`);
  await e4.run(`__click('entCeoWarningBtn')`);
  ok(/vous allez faire un <b>avertissement|vous allez faire un avertissement/.test(strip(lastModal(e4)).replace('<b>', '')) || strip(lastModal(e4)).includes('vous allez faire un avertissement'), 'confirmation de l\'avertissement');
  ok(strip(lastModal(e4)).includes(`Tout de suite : ${cubes(K.w, 'r')} au sac fondamental.`), `R6 : confirmation de l'avertissement : « Tout de suite : ${cubes(K.w, 'r')} au sac fondamental. »`);
  await e4.run(`__click('mOk')`);
  ok(JSON.stringify(e4.json(`__calls.map(c=>c[1])`)) === '["warning"]' && e4.json(`A.ceoCall.kind`) === 'warning', 'bouton Avertissement : kind = warning');
  ok(e4.json(`__renders`) === 1, 'onglet : écran redessiné');

  // Conditions changées entre l'affichage et la confirmation : rien n'est annoncé, le refus est montré.
  const e5 = await boot(transform);
  e5.run(`state.gameClock.rollCount = 0; bindCeoCallBox('ent', A);`);
  await e5.run(`__click('entCeoPromiseBtn')`);
  e5.run(`freezeAnalystForecasts();`); // un autre appareil a lancé : fenêtre fermée
  await e5.run(`__click('mOk')`);
  ok(e5.json(`__calls`).length === 0 && e5.json(`A.ceoCall`) === null, 'fenêtre fermée avant la confirmation : aucun appel, rien d\'annoncé');
  const fin = strip(lastModal(e5));
  ok(fin.includes('Trop tard pour ce semestre') && fin.includes('Les conditions ont changé'), 'le texte du refus du moteur est montré tel quel');
  // Refus du moteur après la confirmation (par exemple un autre appareil a annoncé entre-temps) : texte montré.
  const e6 = await boot(transform);
  e6.run(`state.gameClock.rollCount = 0; bindCeoCallBox('ent', A);`);
  await e6.run(`__click('entCeoWarningBtn')`);
  e6.run(`announceCeoCall = function(){ return Promise.resolve({ok:false, error:'Refus du moteur : texte exact.'}); };`);
  await e6.run(`__click('mOk')`);
  ok(e6.alerts.length === 1 && e6.alerts[0] === 'Refus du moteur : texte exact.', 'refus de l\'action : le texte est montré tel quel');

  console.log('\nH. Ronde finale (R1, R4, R5)');
  // Entreprise sous enquête de l'AMF : l'annonce reste permise (décision de Julien du 2026-11-17, « Non le pdg peut ») :
  // l'encadré garde ses deux boutons, aux deux endroits, et ne montre aucun refus.
  const e7 = await boot(transform);
  e7.run(`state.gameClock.rollCount = 3; A.inJail = true; A.jailTurnsLeft = 3;`);
  const hj = box(e7, 'A', 'ent'), tj = strip(hj), pj = popup(e7, 2);
  console.log('   sous enquête : ' + tj.slice(0, 160));
  ok(/id="entCeoWarningBtn"/.test(hj) && /id="entCeoPromiseBtn"/.test(hj) && !/sous enquête/.test(tj), 'sous enquête : les deux boutons restent, aucun refus (onglet)');
  ok(/CeoWarningBtn/.test(pj) && /CeoPromiseBtn/.test(pj) && !/sous enquête/.test(strip(pj)), 'sous enquête : les deux boutons restent dans la fenêtre du tour');
  // R4 : un joueur qui regarde l'entreprise d'un autre (Bob, qui dirige B, devant A) : ni encadré ni bouton, aux deux
  // endroits ; seulement la ligne publique quand une annonce est faite.
  const e8 = await boot(transform);
  e8.run(`state.gameClock.rollCount = 3; myPlayerId = ${JSON.stringify(e8.ids[1])};`);
  ok(e8.run(`myCompany().id`) === e8.run(`B.id`), 'R4 : Bob dirige B');
  ok(box(e8, 'A', 'ent') === '' && box(e8, 'A', 'pop') === '', 'R4 : encadré du pari pour A vu par Bob : rien (onglet et fenêtre du tour)');
  const pb = popup(e8, 2);
  ok(!/CeoCallBox|CeoWarningBtn|CeoPromiseBtn/.test(pb) && !strip(pb).includes('Annonce du PDG pour le semestre qui commence'), 'R4 : fenêtre du tour de A vue par Bob : ni encadré ni bouton');
  ok(!strip(e8.run(`analystExpectationBlockHtml(A)`)).includes('Annonce du PDG'), 'R4 : bloc des attentes de A vu par Bob, sans annonce : rien sur le pari');
  e8.run(`ceoCallApply(A.id, 'promise', A.ceoId);`);
  const blocB = e8.run(`analystExpectationBlockHtml(A)`);
  ok(strip(blocB).includes('Annonce du PDG pour ce semestre : promesse') && !/CeoWarningBtn|CeoPromiseBtn|CeoCallBox/.test(blocB) && box(e8, 'A', 'ent') === '', 'R4 : annonce faite par Alice : Bob voit la ligne publique seulement');
  ok(/id="entCeoWarningBtn"/.test(box(e8, 'B', 'ent')), 'R4 : Bob garde ses boutons pour sa propre entreprise B');
  // R5 : l'état est remplacé par une copie (comme l'adoption d'un état distant) entre le clic sur le bouton de l'encadré
  // et la confirmation : la fenêtre du tour rouverte relit l'entreprise et montre l'annonce faite, sans bouton.
  const e9 = await boot(transform);
  e9.run(`state.gameClock.rollCount = 3;`);
  popup(e9, 2);
  await e9.run(`__click('popCeoWarningBtn')`);
  e9.run(`state = JSON.parse(JSON.stringify(state)); globalThis.A = state.companies[0]; globalThis.B = state.companies[1];`);
  await e9.run(`__click('mOk')`);
  const re = lastModal(e9);
  ok(e9.json(`A.ceoCall && A.ceoCall.kind`) === 'warning', 'R5 : annonce posée sur l\'état remplacé');
  ok(strip(re).includes('Résultats du tour') && strip(re).includes('Annonce faite pour ce semestre : avertissement') && !/CeoWarningBtn|CeoPromiseBtn/.test(re), 'R5 : fenêtre du tour rouverte à jour (annonce faite, plus de bouton) malgré l\'objet entreprise périmé');
  // Même piège dans l'onglet : boutons branchés, état remplacé avant le clic : l'annonce va à l'entreprise du nouvel état.
  const e10 = await boot(transform);
  e10.run(`state.gameClock.rollCount = 0; bindCeoCallBox('ent', A);`);
  e10.run(`state = JSON.parse(JSON.stringify(state)); globalThis.A = state.companies[0];`);
  await e10.run(`__click('entCeoPromiseBtn')`);
  await e10.run(`__click('mOk')`);
  ok(e10.json(`A.ceoCall && A.ceoCall.kind`) === 'promise' && e10.json(`__calls.length`) === 1, 'R5 : onglet : état remplacé avant le clic, l\'annonce va à l\'entreprise du nouvel état');
}

// --- G. Versions cassées exprès -------------------------------------------------------------------------------
const rep = (a, b) => swap(a, b);
const MUTATIONS = [
  ['nombre du coût de l\'avertissement écrit en dur', rep("? `coûte tout de suite ${ceoCubesText(CEO_WARNING_COST_CUBES, 'red')} au sac fondamental`", "? `coûte tout de suite 1 cube rouge au sac fondamental`")],
  ['pénalité de la promesse écrite en dur', rep("${ceoCubesText(CEO_PROMISE_BROKEN_RED_CUBES, 'red')} s'ajoutent au verdict", "3 cubes rouges s'ajoutent au verdict")],
  ['verdict fort écrit en dur', rep('un verdict fort passe de ${ANALYST_VERDICT_STRONG_CUBES} à', 'un verdict fort passe de 5 à')],
  ['encadré de la fenêtre du tour sans test du semestre', rep('analystCurrentSemester()===closedSemesterForAnalysts+1', 'true')],
  ['encadré de la fenêtre du tour même sans clôture', rep('(closedSemesterForAnalysts!==null && analystCurrentSemester()', '(true && analystCurrentSemester()')],
  ['bouton Promesse qui envoie un avertissement', rep('announceCeoCall(companyId, kind); }', "announceCeoCall(companyId, 'warning'); }")],
  ['double clic non gardé', rep('if(ceoCallBusy) return {ok:false, error:null};', '')],
  ['encadré montré à un autre joueur', rep('if(!co || !me || me.id!==co.id) return \'\';', "if(!co) return '';")],
  ['refus du moteur caché', rep('if(refusal) return box(`<div class="small" style="margin-top:4px;">${esc(refusal)}</div>`);', "if(refusal) return '';")],
  ['boutons encore là après l\'annonce', rep('  if(done){\n    const cubes', '  if(false){\n    const cubes')],
  ['ligne visible de tous retirée', rep('    ${ceoCallPublicLineHtml(co)}\n', '')],
  ['écran pas redessiné après l\'annonce', rep('onDone: ()=>{ renderPreservingForms(); if(', 'onDone: ()=>{ if(')],
  ['fenêtre du tour pas rouverte après l\'annonce', rep("bindCeoCallBox('pop', co, ()=>{ const fresh = companyById(ceoCallCoId); if(fresh) showDiceRollTurnPopup(fresh, roll); });", "bindCeoCallBox('pop', co);")],
  // Ronde finale.
  ['encadré sans bouton pendant une enquête (refus retiré à la demande de Julien)', rep('  if(!ceoCallWindowOpen()){\n    const frozen = co.analystForecast', "  if(co.inJail) return 'refus pendant une enquête';\n  if(!ceoCallWindowOpen()){\n    const frozen = co.analystForecast")],
  ['R4 : encadré montré pour l\'entreprise d\'un autre joueur qui dirige une entreprise', rep("if(!co || !me || me.id!==co.id) return '';", "if(!co || !me) return '';")],
  ['R5 : fenêtre du tour rouverte avec l\'objet entreprise capturé avant l\'action', rep("const fresh = companyById(ceoCallCoId); if(fresh) showDiceRollTurnPopup(fresh, roll);", "showDiceRollTurnPopup(co, roll);")],
  ['R6 : « tout de suite » répété dans la confirmation', rep('${esc(ceoCallNowCubesText(kind))}.</div><!-- Section 323 (R6)', '${esc(ceoCallNowText(kind))}.</div><!-- Section 323 (R6)')],
  ['conditions non revérifiées à la confirmation', rep('return refusal ? {unavailable: refusal} : {kind, semester', 'return {kind, semester')],
];

(async () => {
  await suite(undefined, K_DEFAUT);
  const nBase = n;
  console.log('\nE. Nombres lus dans les constantes du moteur (autres valeurs)');
  await suite(AUTRES_CONSTANTES, K_AUTRE);
  ok(true, 'toute la suite rejouée avec d\'autres constantes (coût 4, gain 2, pénalité 6, verdict fort 7) : le texte suit');
  console.log('\nG. Versions cassées exprès (mutations)');
  let caught = 0; const failures = [];
  for(const [nm, tf] of MUTATIONS){
    quiet = true; let err = null;
    const autres = /écrit.? en dur/.test(nm); // ces trois-là ne se voient qu'avec d'autres valeurs des constantes
    const log = console.log; console.log = () => {};
    try { await suite(autres ? chain(AUTRES_CONSTANTES, tf) : tf, autres ? K_AUTRE : K_DEFAUT); } catch(e){ err = (e && e.message) ? e.message : String(e); }
    console.log = log; quiet = false;
    const real = !!err && !/motif introuvable/.test(err);
    try { ok(real, `mutation « ${nm} » attrapée — ${err ? err.replace(/^ÉCHEC : /, '').slice(0, 110) : 'non attrapée !'}`); caught++; }
    catch(e){ failures.push(e.message); console.log('  ' + e.message); }
  }
  console.log(`\n${n} vérifications, ${caught}/${MUTATIONS.length} versions cassées attrapées.`);
  if(failures.length){ console.log('ÉCHECS : ' + failures.length); process.exit(1); }
})().catch(e => { console.log(e && e.stack ? e.stack : e); process.exit(1); });
