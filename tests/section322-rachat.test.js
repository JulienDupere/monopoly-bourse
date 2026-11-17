// Section 322 — bonus du rachat d'actions (1 à 2 verts) et de l'émission (1 à 2 rouges) : une seule fois par fenêtre de
// marché et par entreprise, et seulement quand l'opération franchit une tranche d'impact (0,5 % des parts, soit 1 000
// parts pour 200 000). Avant : à chaque appel, quelle que soit la quantité (20 rachats d'une part = 20 à 40 verts pour
// 2 000 $). Et un rachat au-delà de la trésorerie est refusé (avant : accepté, trésorerie négative).
// Vrai moteur, vrai tradeCubeRange ; injectStockCube est espionné pour compter les ajouts sans tirage.
const { loadEngine } = require('./helpers/engine');

let compte = 0;
function verifie(cond, msg, muet){
  if(!cond) throw new Error('ÉCHEC : ' + msg);
  if(!muet){ compte++; console.log('  OK', msg); }
}
const pres = (a, b) => Math.abs(a - b) < 1e-9;

async function partie(opts){
  const eng = loadEngine(opts || {});
  await eng.newGame(['Alice', 'Bob'], ['garp', 'garp']);
  eng.run(`globalThis.__inj = []; globalThis.__vrai = injectStockCube;
    injectStockCube = function(co, color, a, b){ __inj.push({co: co.id, color, min: a, max: b}); return __vrai.apply(this, arguments); };`);
  return eng;
}
const ajouts = eng => eng.json('__inj');
const vide = eng => eng.run('__inj.length = 0');
const rachat = (eng, q) => eng.json(`buybackShares(state.companies[0], ${q})`);
const emission = (eng, q) => eng.json(`issueNewShares(state.companies[0], ${q})`);
const estBonus = a => a.min === a.max && (a.min === 1 || a.min === 2);   // le bonus est tiré puis injecté en quantité fixe
const fenetreSuivante = eng => eng.run('state.gameClock.rollCount += 3');   // le marché n'ouvre qu'un lancer par semestre

async function scenarios(opts, muet){
  const v = (c, m) => verifie(c, m, muet);

  // S1 — la pompe : 20 rachats d'une part dans la même fenêtre.
  {
    const eng = await partie(opts);
    v(eng.run('tradingWindowOpen()') === true && eng.run('state.companies[0].totalShares') === 200000, 'S1 : marché ouvert, 200 000 parts (tranche de 1 000 parts)');
    const t0 = eng.cashTotal(), caisse0 = eng.run('state.companies[0].cash');
    for(let i = 0; i < 20; i++) v(rachat(eng, 1).ok === true, 'S1 : rachat d\'une part n° ' + (i + 1) + ' accepté');
    v(ajouts(eng).length === 0, 'S1 : 20 rachats d\'une part n\'ajoutent AUCUN cube (avant : 20 à 40 verts)');
    v(pres(eng.run('state.companies[0].cash'), caisse0 - 20 * 1e-4), 'S1 : la caisse paie 20 parts à 100 $');
    v(pres(eng.cashTotal(), t0), 'S1 : monnaie conservée');
  }

  // S2 — une tranche : le bonus une fois, puis la base seule dans la même fenêtre.
  {
    const eng = await partie(opts);
    const r1 = rachat(eng, 1000);
    let a = ajouts(eng);
    v(r1.ok && a.length === 2 && a.every(x => x.color === 'green'), 'S2 : 1 000 parts = deux ajouts verts');
    v(estBonus(a[0]) && a[1].min === 1 && a[1].max === 2, 'S2 : le bonus (1 ou 2, fixe) puis la base d\'une tranche (1 à 2)');
    v(r1.cubesInjected >= 2 && r1.cubesInjected <= 4, 'S2 : entre 2 et 4 cubes au total');
    vide(eng);
    rachat(eng, 1000);
    a = ajouts(eng);
    v(a.length === 1 && a[0].min === 1 && a[0].max === 2, 'S2 : 2e tranche de la même fenêtre = la base seule, pas de 2e bonus');
    vide(eng);
    for(let i = 0; i < 5; i++) rachat(eng, 1);
    v(ajouts(eng).length === 0, 'S2 : des rachats d\'une part après le bonus n\'ajoutent rien');
    vide(eng);
    rachat(eng, 3000);
    a = ajouts(eng);
    v(a.length === 1 && a[0].min === 3 && a[0].max === 6, 'S2 : 3 tranches d\'un coup = la base de 3 tranches (3 à 6), toujours sans bonus');
  }

  // S3 — fenêtre suivante : le bonus revient, une fois.
  {
    const eng = await partie(opts);
    rachat(eng, 1000); vide(eng);
    fenetreSuivante(eng);
    v(eng.run('tradingWindowOpen()') === true, 'S3 : fenêtre suivante ouverte');
    rachat(eng, 1000);
    let a = ajouts(eng);
    v(a.length === 2 && estBonus(a[0]) && a[1].min === 1 && a[1].max === 2, 'S3 : à la fenêtre suivante, bonus + base de nouveau');
    vide(eng);
    rachat(eng, 1000);
    a = ajouts(eng);
    v(a.length === 1 && !estBonus(a[0]), 'S3 : et une seule fois dans cette fenêtre');
  }

  // S4 — la tranche se compte en cumul : 999 parts, puis 1 part à la fenêtre suivante.
  {
    const eng = await partie(opts);
    rachat(eng, 999);
    v(ajouts(eng).length === 0, 'S4 : 999 parts (sous la tranche) = aucun cube, pas même le bonus');
    fenetreSuivante(eng);
    rachat(eng, 1);
    const a = ajouts(eng);
    v(a.length === 2 && estBonus(a[0]) && a[1].min === 1 && a[1].max === 2, 'S4 : la 1 000e part franchit la tranche : bonus + base');
  }

  // S5 — plafond de 12 tranches par fenêtre : au-delà, ni base ni bonus.
  {
    const eng = await partie(opts);
    rachat(eng, 12000);
    let a = ajouts(eng);
    v(a.length === 2 && estBonus(a[0]) && a[1].min === 12 && a[1].max === 24, 'S5 : 12 000 parts = bonus + 12 tranches (12 à 24)');
    vide(eng);
    rachat(eng, 5000);
    v(ajouts(eng).length === 0, 'S5 : au-delà du plafond de la fenêtre, plus aucun cube');
  }

  // S6 — émission : même règle, en rouge, et les deux bonus sont indépendants.
  {
    const eng = await partie(opts);
    const t0 = eng.cashTotal();
    for(let i = 0; i < 20; i++) v(emission(eng, 1).ok === true, 'S6 : émission d\'une part n° ' + (i + 1) + ' acceptée');
    v(ajouts(eng).length === 0, 'S6 : 20 émissions d\'une part n\'ajoutent AUCUN cube (avant : 20 à 40 rouges)');
    emission(eng, 1000);
    let a = ajouts(eng);
    v(a.length === 2 && a.every(x => x.color === 'red') && estBonus(a[0]) && a[1].min === 1 && a[1].max === 2, 'S6 : 1 000 parts émises = bonus rouge + base rouge');
    vide(eng);
    emission(eng, 1000);
    a = ajouts(eng);
    v(a.length === 1 && a[0].color === 'red' && !estBonus(a[0]), 'S6 : 2e émission de la fenêtre = la base seule');
    vide(eng);
    rachat(eng, 1);
    v(ajouts(eng).length === 0, 'S6 : budget de la fenêtre déjà ouvert par l\'émission : un rachat d\'une part n\'ajoute toujours rien');
    rachat(eng, 999);
    a = ajouts(eng);
    v(a.length === 2 && a.every(x => x.color === 'green') && estBonus(a[0]), 'S6 : le bonus du rachat reste dû dans la même fenêtre (bonus distincts)');
    v(pres(eng.cashTotal(), t0), 'S6 : monnaie conservée');
  }

  // S7 — partie enregistrée avant la section : budget de fenêtre sans le champ « bonus ».
  {
    const eng = await partie(opts);
    eng.run('state.companies[0].tradeImpactBudget = {window: state.gameClock.rollCount, used: {}}');
    rachat(eng, 1000);
    const a = ajouts(eng);
    v(a.length === 2 && estBonus(a[0]), 'S7 : budget sans champ « bonus » : le bonus est donné, sans erreur');
    v(eng.json('state.companies[0].tradeImpactBudget.bonus').buyback === true, 'S7 : et il est mémorisé pour la fenêtre');
    eng.run('const __copie322 = JSON.parse(JSON.stringify(state)); migrateState(__copie322); state = __copie322;');
    vide(eng);
    rachat(eng, 1000);
    v(ajouts(eng).length === 1, 'S7 : après un aller-retour par migrateState, toujours pas de 2e bonus dans la fenêtre');
  }

  // S8 — rachat au-delà de la trésorerie : refusé, rien ne bouge (avant : accepté, trésorerie à −80 M$).
  {
    const eng = await partie(opts);
    const caisse = eng.run('state.companies[0].cash');   // 20 M$
    const t0 = eng.cashTotal();
    const photo = eng.run('JSON.stringify(state.companies[0])');
    const r = rachat(eng, 1000000);                      // 100 M$ au cours de 100 $
    v(r.ok === false && /trésorerie/.test(r.error || ''), 'S8 : 1 000 000 de parts (100 M$) avec 20 M$ en caisse : refusé, message clair');
    v(eng.run('JSON.stringify(state.companies[0])') === photo && ajouts(eng).length === 0, 'S8 : un refus ne change rien (caisse, cumul des tranches, cubes)');
    v(pres(eng.cashTotal(), t0), 'S8 : monnaie conservée après le refus');
    const r2 = rachat(eng, caisse / 1e-4);               // toute la trésorerie
    v(r2.ok === true && Math.abs(eng.run('state.companies[0].cash')) < 1e-9, 'S8 : un rachat d\'exactement toute la trésorerie reste permis (caisse à 0)');
    v(rachat(eng, 1).ok === false, 'S8 : caisse vide : une part de plus est refusée');
    v(pres(eng.cashTotal(), t0), 'S8 : monnaie conservée à la fin');
  }
}

// Versions cassées exprès : chacune doit faire échouer les scénarios.
const MUTATIONS = [
  ['ancien code (bonus à chaque rachat)', s => s.replace("if(corpActionBonusDue(company, 'buyback', base)){", 'if(true){')],
  ['ancien code (bonus à chaque émission)', s => s.replace("if(corpActionBonusDue(company, 'issuance', base)){", 'if(true){')],
  ['bonus sans tranche franchie', s => s.replace('  if(!base) return false;\n  const budget = company.tradeImpactBudget;', '  const budget = company.tradeImpactBudget;')],
  ['bonus jamais mémorisé', s => s.replace('  budget.bonus[kind] = true;\n', '')],
  ['mémoire du bonus ignorée', s => s.replace('  if(budget.bonus[kind]) return false;\n', '')],
  ['rachat et émission confondus', s => s.replace("corpActionBonusDue(company, 'issuance', base)", "corpActionBonusDue(company, 'buyback', base)")],
  ['bonus supprimé', s => s.replace('  budget.bonus[kind] = true;\n  return true;', '  budget.bonus[kind] = true;\n  return false;')],
  ['rachat sans contrôle de la trésorerie', s => s.replace('if(amount > (company.cash||0) + 1e-9) return {ok:false, error:`Montant du rachat', 'if(false) return {ok:false, error:`Montant du rachat')],
];

(async () => {
  await scenarios(null, false);
  let attrapees = 0;
  for(const [nom, transform] of MUTATIONS){
    let echec = null;
    try { await scenarios({ transform }, true); } catch(e){ echec = e; }
    if(!echec) throw new Error('ÉCHEC : la version cassée « ' + nom + ' » n\'est pas attrapée');
    if(!/^ÉCHEC : S\d/.test(echec.message)) throw echec;   // une vraie erreur (motif introuvable, exception) n'est pas une preuve
    attrapees++;
    console.log('  OK version cassée attrapée : ' + nom + ' -> ' + echec.message.slice(8, 70));
  }
  console.log(`OK : section 322 (bonus du rachat et de l'émission) — ${compte} vérifications, ${attrapees}/${MUTATIONS.length} versions cassées attrapées`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
