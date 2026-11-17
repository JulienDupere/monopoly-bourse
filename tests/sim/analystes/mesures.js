// Banc de mesure « trois analystes » (CONTRAT.md, ronde 2). Point d'entrée : node tests/sim/analystes/mesures.js
// Variables : N_ROT (suites par situation et par rotation des types, 300 ; 4 rotations), N_CUBES (repro des cubes et
// matrice Croissance, 100000), N_TEND (mesure 8, 40000), N_DER (mesure 9, 20000), N_11 (mesure 11, 500 suites),
// N_FREQ (400000), N_MAIN (40000). Écrit resultats.json et resultats.txt ici (ronde 1 : resultats-ronde1.*).
const fs = require('fs'), path = require('path');
const { chargerMoteur } = require('./moteur');
const { stationnaire } = require('./plateau');
const { TABLES, NROT, specFor, TABLES11, spec11 } = require('./situations');
const { runSituation } = require('./simulation');
const { mesurerType } = require('./cubes');
const { mesure8, mesure9, HORIZONS } = require('./tendances');
const { verifierProbas, casMain, payeurPionNeutre, verifierTour } = require('./verif');
const A = require('./analyse');
const B = require('./analyse2');

const N_ROT = +process.env.N_ROT || 300;
const N_CUBES = +process.env.N_CUBES || 100000;
const N_TEND = +process.env.N_TEND || 40000;
const N_DER = +process.env.N_DER || 20000;
const N_11 = +process.env.N_11 || 500;
const N_FREQ = +process.env.N_FREQ || 400000;
const N_MAIN = +process.env.N_MAIN || 40000;

const TXT = [];
const say = (s = '') => { TXT.push(s); console.log(s); };
const f2 = x => (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(2);
const pc = x => (x === null || x === undefined || !isFinite(x)) ? '—' : (100*x).toFixed(1);
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
function tableau(entetes, lignes){
  const w = entetes.map((h, i) => Math.max(String(h).length, ...lignes.map(l => String(l[i]).length)));
  say(entetes.map((h, i) => i === 0 ? pad(h, w[i]) : lpad(h, w[i])).join('  '));
  lignes.forEach(l => say(l.map((x, i) => i === 0 ? pad(x, w[i]) : lpad(x, w[i])).join('  ')));
}
const ligneCL = c => [pc(c.zone), pc(c['n+']), pc(c['f+']), pc(c['n-']), pc(c['f-'])];

(async () => {
  const t0 = Date.now();
  const OUT = { meta: { date: new Date().toISOString(), ronde: 2, N_ROT, NROT, N_CUBES, N_TEND, N_DER, N_11, N_FREQ, N_MAIN }, verifications: {}, mesures: {} };
  say('BANC « TROIS ANALYSTES » — ronde 2');
  say(`Tirages : ${N_ROT} suites × ${NROT} rotations des types par situation et par variante ; cubes ${N_CUBES} ; tendances ${N_TEND} ; dérive ${N_DER} ; mesure 11 : ${N_11} suites ; fréquences ${N_FREQ} lancers ; cas à la main ${N_MAIN}.`);
  say('');

  // ---------- Vérifications ----------
  const tv = await verifierTour(() => specFor('8+3', 'milieu', 0), 5);
  OUT.verifications.tour = tv;
  say('== Vérification A : tour du banc contre le vrai performRollForAllCompanies (8+3 milieu, 12 lancers, même graine) ==');
  say(`rendu neutralisé : identique ${tv.egalRenduNeutralise}/${tv.nSeeds} (positions, enquêtes, cours, encaisses, banque, sacs, grand livre entier) ; rendu actif : identique ${tv.egalRenduActif}/${tv.nSeeds} (render() consomme du hasard)`);
  const g = await mesurerType('garp', [{label:'+1R', r:1}, {label:'+3R', r:3}, {label:'+7R', r:7}], N_CUBES);
  const attendu = { '+1R': [-0.26, -0.31], '+3R': [-1.14, -1.53], '+7R': [-2.77, -4.64] };
  const repro = Object.keys(attendu).map(l => { const v = g.variantes.find(x => x.label === l); return [l, f2(v.effet1), f2(attendu[l][0]), f2(v.effet2), f2(attendu[l][1])]; });
  OUT.verifications.mesureConnue = { variantes: g.variantes, bruit1: g.bruit1, bruit2: g.bruit2 };
  say('== Vérification B : mesure connue des cubes (GARP 10/10/8, volatilité 1) ==');
  tableau(['ajout', '1 sem.', 'attendu', '2 sem.', 'attendu'], repro);
  say(`bruit : ${f2(g.bruit1)} % (attendu 6,5) et ${f2(g.bruit2)} % (attendu 9,2)`);
  const matrice = chargerMoteur(1).json('CROISSANCE_TYPE_MATRIX');
  const vars = []; for(const mg in matrice) for(const an in matrice[mg]) vars.push({label: `M:${mg}/${an}`, typeRes: matrice[mg][an]});
  const cro = await mesurerType('croissance', vars, N_CUBES);
  const derive = { bon:{}, neutre:{}, mauvais:{} };
  cro.variantes.forEach(v => { const [mg, an] = v.label.slice(2).split('/'); derive[mg][an] = v.effet1 / 100; });
  OUT.mesures.matriceCroissance = derive;
  const pr = await verifierProbas(N_FREQ);
  OUT.verifications.probas = pr.rows;
  const gros = pr.rows.filter(r => r.ecartRel !== null && Math.abs(r.ecartRel) > 0.10);
  say(`== Vérification C : p.prob — ${gros.length} cases sur 28 à plus de 10 % de la fréquence exacte (${gros.map(r => r.name + ' ' + pc(r.ecartRel) + ' %').join(', ')}) ; exacte contre simulée : plus grand écart ${f2(Math.max(...pr.rows.map(r => Math.abs(r.sim - r.exact) / (r.ic || 1))))} demi-largeur(s) ==`);
  const cm = await casMain(N_MAIN);
  OUT.verifications.casMain = cm;
  say(`== Vérification D : cas à la main : ${cm.main.toFixed(5)} ; M' ${cm.modelePositions.toFixed(5)} ; simulation ${cm.simulation.toFixed(5)} ± ${cm.icSim.toFixed(5)} ; régime établi : M ${cm.regime.modeleM.toFixed(5)}, M' ${cm.regime.modelePositions.toFixed(5)}, simulation ${cm.regime.simulation.toFixed(5)} ± ${cm.regime.icSim.toFixed(5)} ==`);
  const pn = await payeurPionNeutre();
  OUT.verifications.payeurPionNeutre = pn;
  say(`== Vérification E : loyer d'un pion neutre : banque ${f2(pn.banque)}, entreprise ${f2(pn.entreprise)}, total ${f2(pn.total)} ==`);
  say('');

  // ---------- Simulations des situations ----------
  const ex = stationnaire();
  const probPP = ex.land.slice();
  pr.rows.forEach(r => { if(r.prob !== null) probPP[r.sq] = r.prob; });
  const ctx = { statPos: ex.pos, probPP, probExact: ex.land };
  const sink = A.puits();
  const recs = [];
  sink.record = r => recs.push(r);
  const eng = chargerMoteur(1);
  OUT.situations = {};
  const ts = Date.now();
  for(const tb of Object.keys(TABLES)){
    for(const ph of ['debut', 'milieu', 'fin']){
      const t1 = Date.now();
      const info = { saisies: {}, acts: {maison:0, terrain:0}, calculsTables: 0 };
      for(let rot=0; rot<NROT; rot++){
        const o = ph === 'debut'
          ? { tb, ph, rot, N: N_ROT, variants: ['base'], nSem: 2, judge: [0, 1], atGo: true, seedLabel: `${tb}|${ph}|${rot}` }
          : { tb, ph, rot, N: N_ROT, variants: ['base', 'transition', 'vivant'], nSem: 4, judge: [2, 3], atGo: false, seedLabel: `${tb}|${ph}|${rot}` };
        const r = await runSituation(eng, ctx, specFor(tb, ph, rot), o, sink);
        for(const va in r.seizures) info.saisies[va] = (info.saisies[va]||0) + r.seizures[va];
        info.acts.maison += r.acts.maison; info.acts.terrain += r.acts.terrain; info.calculsTables += r.calculsTables;
      }
      OUT.situations[tb + '|' + ph] = info;
      console.log(`  ${tb} ${ph} : ${((Date.now()-t1)/1000).toFixed(1)} s`);
    }
  }
  const dureeSim = (Date.now() - ts) / 1000;
  say(`Suites avec saisie (sur ${N_ROT*NROT} par variante) : ` + Object.keys(OUT.situations).filter(k => !k.endsWith('debut')).map(k => `${k} ${JSON.stringify(OUT.situations[k].saisies)}`).join(' ; '));
  say('');

  // ---------- Mesure 1 (rappel) ----------
  const m1 = A.mesure1(sink.m1);
  OUT.mesures.m1 = m1;
  say('== Mesure 1 : justesse du modélisateur (tous les semestres) — biais R−M, σ prévu, écart type réel de R−M ==');
  const l1 = [];
  for(const ph of ['debut', 'milieu', 'fin', 'milieu-T', 'fin-T', 'milieu-V', 'fin-V']) for(const pf of ['concentree', 'diversifiee', 'endettee', 'ordinaire']){
    const x = m1[`*|${ph}|${pf}`]; if(!x) continue;
    l1.push([`${ph} ${pf}`, x.n, f2(x.moyR), f2(x.P.biais), f2(x.S.biais), f2(x.Q.biais), f2(x.P.sigmaM), f2(x.P.sdEcart), f2(x.Q.sigmaM), f2(x.Q.sdEcart), pc(x.P.dans1s)]);
  }
  tableau(['phase profil', 'n', 'moy R', 'R−M', 'R−Mx', 'R−M\'', 'σM', 'sd(R−M)', 'σM\'', 'sd(R−M\')', 'dans 1σ %'], l1);
  say('');

  // ---------- Verdicts ----------
  const { G, ecartes } = B.groupes(recs);
  OUT.mesures.ecartesSaisie = ecartes;
  const ordre = ['debut S1', 'debut S2', 'milieu S3', 'milieu S4', 'fin S3', 'fin S4', 'partie type S3', 'partie type S4', 'partie type (milieu+fin, S3+S4)',
    'milieu-T S4', 'fin-T S4', 'milieu-V S3', 'milieu-V S4', 'fin-V S3', 'fin-V S4', 'parc vivant S3', 'parc vivant S4', 'parc vivant (milieu+fin, S3+S4)'];
  OUT.mesures.verdicts = {};
  say('== Mesure 2 : fréquences du verdict (%) par phase — plancher 0,5 ; zone / n+ / f+ / n− / f− ; Mref = M\' seul comme cible (zone / + / −) ==');
  say(`Semestres écartés pour saisie : ${JSON.stringify(ecartes)}`);
  for(const name of ordre){
    const l = G[name]; if(!l) continue;
    const t = B.tableauxVerdict(l);
    OUT.mesures.verdicts[name] = t;
    say(`-- ${name} (n = ${l.length}) --`);
    const rows = [];
    for(const Mv of ['p', 's']) for(const Kv of ['K2', 'K3']) for(const k of B.KS) rows.push([`${Mv === 'p' ? 'p.prob' : 'exacte'} ${Kv} k=${k}`, ...ligneCL(t[`${Mv}/${Kv}/k${k}`])]);
    for(const k of B.KS){ const c = t[`Mref/k${k}`]; rows.push([`M' seul k=${k}`, pc(c.zone), pc(c['+']), '', pc(c['-']), '']); }
    tableau(['variante', 'zone', 'n+ (+)', 'f+', 'n− (−)', 'f−'], rows);
  }
  say('');
  OUT.mesures.parProfil = {};
  for(const name of ['partie type (milieu+fin, S3+S4)', 'parc vivant (milieu+fin, S3+S4)']){
    say(`-- ${name} : par profil et par type (p.prob, k=0,5) : K2 | K3 --`);
    const a = B.parProfil(G[name], 'p', 'K2', 0.5), b = B.parProfil(G[name], 'p', 'K3', 0.5);
    OUT.mesures.parProfil[name] = { K2: a, K3: b };
    tableau(['', 'n', 'K2 zone', 'n+', 'f+', 'n−', 'f−', '| K3 zone', 'n+', 'f+', 'n−', 'f−'], Object.keys(a).map(k => [k, a[k].n, ...ligneCL(a[k]), '| ' + pc(b[k].zone), pc(b[k]['n+']), pc(b[k]['f+']), pc(b[k]['n-']), pc(b[k]['f-'])]));
  }
  say('');

  // ---------- H0 / H1 ----------
  OUT.mesures.H0H1 = {};
  say('== Deux premiers semestres : H0 (historien à 0 puis 2) contre H1 (historien absent, cible = milieu de M et K) ==');
  for(const name of ['debut S1', 'debut S2']){
    const t = B.tableauxH1(G[name]);
    OUT.mesures.H0H1[name] = t;
    say(`-- ${name} (n = ${G[name].length}) --`);
    const rows = [];
    for(const Mv of ['p', 's']) for(const Kv of ['K2', 'K3']) for(const k of B.KS)
      rows.push([`${Mv === 'p' ? 'p.prob' : 'exacte'} ${Kv} k=${k}`, ...ligneCL(t[`H0/${Mv}/${Kv}/k${k}`]), '|', ...ligneCL(t[`H1/${Mv}/${Kv}/k${k}`])]);
    tableau(['variante', 'H0 zone', 'n+', 'f+', 'n−', 'f−', '|', 'H1 zone', 'n+', 'f+', 'n−', 'f−'], rows);
  }
  const anc = name => { const l = G[name]; const c = {}; l.forEach(r => { c[r.old||'aucun'] = (c[r.old||'aucun']||0) + 1; }); for(const k in c) c[k] /= l.length; return c; };
  OUT.mesures.ancien = {};
  for(const name of ['debut S1', 'debut S2', 'partie type (milieu+fin, S3+S4)', 'parc vivant (milieu+fin, S3+S4)']){
    OUT.mesures.ancien[name] = anc(name);
    say(`ancien verdict, ${name} : ` + Object.entries(OUT.mesures.ancien[name]).map(([k, v]) => `${k} ${pc(v)}`).join(', '));
  }
  say('');

  // ---------- Marché ----------
  OUT.mesures.marche = {};
  say('== Mesure 3 : analyste marché (p.prob) — part des semestres où R bat K, médiane K/M (M > 0 seulement), analyste retenu comme cible (H/M/K) ==');
  for(const name of ['partie type (milieu+fin, S3+S4)', 'parc vivant (milieu+fin, S3+S4)', 'debut S2']){
    const m = B.marche(G[name]);
    OUT.mesures.marche[name] = m;
    say(`-- ${name} --`);
    tableau(['profil', 'n', 'R>H', 'R>M', 'R>K1', 'R>K2', 'R>K3', 'K1/M', 'K2/M', 'K3/M', 'cible K2 H/M/K', 'cible K3 H/M/K', 'ρ p10/méd/p90'],
      Object.keys(m).map(pf => { const x = m[pf]; return [pf, x.n, pc(x.battuH), pc(x.battuM), pc(x.battuK1), pc(x.battuK2), pc(x.battuK3), f2(x.medK1surM), f2(x.medK2surM), f2(x.medK3surM),
        `${pc(x.cibleK2.H)}/${pc(x.cibleK2.M)}/${pc(x.cibleK2.K)}`, `${pc(x.cibleK3.H)}/${pc(x.cibleK3.M)}/${pc(x.cibleK3.K)}`, `${f2(x.p10Rho)}/${f2(x.medRho)}/${f2(x.p90Rho)}`]; }));
  }
  say('');

  // ---------- Tiers d'information (base de la mesure 10) ----------
  OUT.mesures.tiers = {};
  say('== Tiers d\'information (M\' − M, formés dans chaque table × phase × semestre × profil) : sous la zone n− / f− (%) ==');
  const tiersRows = [];
  for(const name of ['debut S1', 'debut S2', 'milieu S3', 'milieu S4', 'fin S3', 'fin S4', 'partie type (milieu+fin, S3+S4)', 'milieu-T S4', 'fin-T S4', 'parc vivant (milieu+fin, S3+S4)']){
    for(const Kv of ['K2', 'K3']) for(const k of [0.25, 0.5, 0.75]){
      const t = B.tiers(G[name], 'p', Kv, k);
      OUT.mesures.tiers[`${name}|${Kv}|k${k}`] = t;
      if(k === 0.5 || name.startsWith('partie type'))
        tiersRows.push([`${name} ${Kv} k=${k}`, `${pc(t.ensemble['n-'])}/${pc(t.ensemble['f-'])}`, `${pc(t.tiers1['n-'])}/${pc(t.tiers1['f-'])}`, `${pc(t.tiers2['n-'])}/${pc(t.tiers2['f-'])}`, `${pc(t.tiers3['n-'])}/${pc(t.tiers3['f-'])}`,
          `${f2(t.tiers1.ecartMoyen)}/${f2(t.tiers2.ecartMoyen)}/${f2(t.tiers3.ecartMoyen)}`]);
    }
  }
  tableau(['groupe', 'ensemble', 'tiers bas', 'tiers milieu', 'tiers haut', 'M\'−M moyen'], tiersRows);
  say('');

  // ---------- Mesure 6 ----------
  OUT.mesures.m6 = {};
  say('== Mesure 6 : type Croissance (toutes entreprises « comme si » Croissance ; p.prob, K2 et K3) : axe des analystes (%) et dérive du sac type (%/sem.) ==');
  say('Population commune = semestres où la règle actuelle a un axe (chiffre d\'affaires > 0), pour les trois règles ; population entière pour (a) et (b).');
  for(const name of ['partie type (milieu+fin, S3+S4)', 'parc vivant (milieu+fin, S3+S4)']){
    for(const Kv of ['K2', 'K3']){
      const m6 = B.mesure6(G[name], 'p', Kv, derive);
      OUT.mesures.m6[`${name}|${Kv}`] = m6;
      say(`-- ${name}, ${Kv} --`);
      const rows = [];
      for(const pn of ['commune', 'entiere']) for(const rn in m6[pn]){ if(rn === 'n') continue; const x = m6[pn][rn]; rows.push([`${pn} (n=${m6[pn].n}) ${rn}`, pc(x.axe.bon), pc(x.axe.neutre), pc(x.axe.mauvais), f2(100*x.deriveEleve), f2(100*x.deriveTresEleve)]); }
      tableau(['population règle', 'bon', 'neutre', 'mauvais', 'dérive élevé', 'dérive très élevé'], rows);
    }
  }
  say('');

  // ---------- Mesure 8 ----------
  const t8 = Date.now();
  OUT.mesures.m8 = {};
  say('== Mesure 8 : tendances (tirages purs, volatilité 1) — effet net sur le cours (%, médiane du cas avec cubes − médiane sans cube) ==');
  const rep = (k, col) => Array.from({length: 6}, () => col === 'R' ? {r: k} : {g: k});
  const once = (k, col) => [col === 'R' ? {r: k} : {g: k}];
  for(const type of ['garp', 'dividende', 'croissance', 'momentum']){
    const configs = [];
    const singles = type === 'garp' ? [1, 2, 3, 5, 6, 7, 8, 9] : [3, 5, 7];
    for(const col of ['R', 'V']){
      singles.forEach(k => configs.push({label: `${k}${col} une fois`, plan: once(k, col)}));
      [2, 3, 5].forEach(k => configs.push({label: `${k}${col} par sem.`, plan: rep(k, col)}));
    }
    const r = await mesure8(type, configs, N_TEND, 6);
    OUT.mesures.m8[type] = r;
    say(`-- ${type} (sac ${r.base.green}V/${r.base.red}R/${r.base.white}B) ; bruit (écart type) : ${HORIZONS.map(h => `${h} sem. ${f2(r.bruit[h])}`).join(', ')} --`);
    tableau(['injection', ...HORIZONS.map(h => `${h} sem.`), 'effet moyen 6 sem.'],
      r.configs.filter(c => type === 'garp' ? !/^(1|2|6|8|9)[RV] une/.test(c.label) : true).map(c => [c.label, ...HORIZONS.map(h => f2(c.netMediane[h])), f2(c.effetMoyen[6])]));
  }
  const gm = OUT.mesures.m8.garp, gc = l => gm.configs.find(c => c.label === l);
  say(`repère GARP (contrat) : 3 rouges une fois ≈ −2 % → ${f2(gc('3R une fois').netMediane[6])} ; 3 par semestre ≈ −12 % à 6 sem. → ${f2(gc('3R par sem.').netMediane[6])} ; 5 par semestre ≈ −22 % → ${f2(gc('5R par sem.').netMediane[6])} ; bruit 15,9 % à 6 sem. → ${f2(gm.bruit[6])}`);
  say(`durée mesure 8 : ${((Date.now()-t8)/1000).toFixed(0)} s`);
  say('');

  // ---------- Mesure 9 ----------
  const pt = G['partie type (milieu+fin, S3+S4)'];
  const freqOf = (Mv, Kv, k) => { const c = OUT.mesures.verdicts['partie type (milieu+fin, S3+S4)'][`${Mv}/${Kv}/k${k}`]; return { 'n+': c['n+'], 'f+': c['f+'], 'n-': c['n-'], 'f-': c['f-'] }; };
  const tailles = (n, f) => ({ 'n+': ['g', n, n], 'f+': ['g', f, f], 'n-': ['r', n, n], 'f-': ['r', f, f] });
  const scen = [];
  for(const Kv of ['K2', 'K3']) for(const k of [0.25, 0.5, 0.75]) for(const [n, f] of [[3, 5], [3, 6], [2, 5]])
    scen.push({ label: `${Kv} k=${k} normal ${n} fort ${f}`, freq: freqOf('p', Kv, k), tailles: tailles(n, f) });
  const oldF = OUT.mesures.ancien['partie type (milieu+fin, S3+S4)'];
  scen.push({ label: 'ancien verdict (paliers 1-2, 3-5, 6-8)', freq: { beat: oldF.beat||0, sigBeat: oldF.sigBeat||0, miss: oldF.miss||0, sigMiss: oldF.sigMiss||0, reallyMiss: oldF.reallyMiss||0 },
    tailles: { beat: ['g', 1, 2], sigBeat: ['g', 3, 5], miss: ['r', 1, 2], sigMiss: ['r', 3, 5], reallyMiss: ['r', 6, 8] } });
  const m9 = await mesure9('garp', scen, N_DER, 10);
  OUT.mesures.m9 = m9;
  say('== Mesure 9 : dérive du cours sous le verdict, 10 semestres, un verdict tiré par semestre aux fréquences de la partie type (GARP, tirages purs) ==');
  say(`sans verdict : moyenne ${f2(m9.base.moyenne)} %, médiane ${f2(m9.base.mediane)} %, écart type ${f2(m9.base.ecartType)} %`);
  tableau(['scénario', 'moyenne %', 'médiane %', 'écart type %', 'effet moyen %', '± 95 %', 'par semestre (médiane) %'],
    m9.scenarios.map(s => [s.label, f2(s.moyenne), f2(s.mediane), f2(s.ecartType), f2(s.effetMoyen), f2(s.icEffet), f2(s.parSemestre)]));
  say('');

  // ---------- Mesure 10 ----------
  // Effets moyens à 4 semestres d'une injection unique (GARP, mesure 8), en valeur absolue.
  const e4 = (k, col) => { if(k === 0) return 0; const c = gm.configs.find(x => x.label === `${k}${col} une fois`); return c ? Math.abs(c.effetMoyen[4]) : null; };
  OUT.mesures.m10 = {};
  say('== Mesure 10 : pari du PDG en cubes, en % du cours sur 4 semestres (GARP), partie type, p.prob ==');
  say('Avertissement = −effet(1 rouge) + P(f−)·[E(fort) − E(normal)] + P(n−)·E(normal). Promesse = +effet(1 vert) − P(n−)·[E(fort) − E(normal)] − P(f−)·X ; X = 0 si le fort ne s\'aggrave pas (A), X = E(2 fort − normal) − E(fort) sinon (B).');
  const rows10 = [];
  for(const Kv of ['K2', 'K3']) for(const k of [0.25, 0.5, 0.75]){
    const t = OUT.mesures.tiers[`partie type (milieu+fin, S3+S4)|${Kv}|k${k}`];
    for(const [n, f] of [[3, 5], [3, 6], [2, 5]]){
      const En = e4(n, 'R'), Ef = e4(f, 'R'), Eagg = e4(2*f - n, 'R');
      const val = (c) => {
        const av = -e4(1, 'R') + c['f-'] * (Ef - En) + c['n-'] * En;
        const prA = e4(1, 'V') - c['n-'] * (Ef - En);
        const prB = prA - c['f-'] * (Eagg - Ef);
        return { av, prA, prB };
      };
      const o = { ensemble: val(t.ensemble), tiers1: val(t.tiers1), tiers2: val(t.tiers2), tiers3: val(t.tiers3) };
      OUT.mesures.m10[`${Kv}|k${k}|${n}/${f}`] = o;
      rows10.push([`${Kv} k=${k} n${n} f${f}`, ...['ensemble', 'tiers1', 'tiers2', 'tiers3'].map(x => `${f2(o[x].av)} / ${f2(o[x].prA)} / ${f2(o[x].prB)}`)]);
    }
  }
  say(`effets à 4 sem. utilisés (|%|) : rouges ${[1,2,3,5,6,7,8,9].map(k => `${k}:${f2(e4(k,'R'))}`).join(' ')} ; 1 vert : ${f2(e4(1,'V'))}`);
  tableau(['réglage', 'ensemble avert. / prom. A / prom. B', 'tiers bas', 'tiers milieu', 'tiers haut'], rows10);
  say('');

  // ---------- Mesure 7 (rappel) et 11 ----------
  const m7 = A.mesure7(sink.m7);
  OUT.mesures.m7 = m7;
  const t11 = Date.now();
  const defs = eng.json(`PROPERTY_DEFS.map(d=>({name:d[0], group:d[1], type:d[2], rent:d[4], prob:d[5]}))`);
  const sink11 = A.puits();
  OUT.mesures.m11parts = {};
  for(const tb of Object.keys(TABLES11)) for(const ph of ['debut', 'milieu', 'fin']){
    const spec = spec11(tb, ph, defs);
    const parts = spec.names.map((_, i) => spec.props.filter(p => p.co === i).length);
    OUT.mesures.m11parts[tb + '|' + ph] = parts;
    await runSituation(eng, ctx, spec, { tb, ph, rot: 0, N: N_11, variants: ['base'], nSem: ph === 'debut' ? 2 : 4, judge: [], atGo: ph === 'debut', seedLabel: `m11|${tb}|${ph}` }, { semestre: sink11.semestre });
  }
  const m11 = A.mesure7(sink11.m7);
  OUT.mesures.m11 = m11;
  say('== Mesure 11 : pions neutres selon la règle de Julien (2-3 joueurs = 1, 4-7 = 2, 8+ = 3), tout le plateau possédé et réparti également, mêmes maisons ==');
  tableau(['table phase', 'moy R', 'sd R', 'loyers pions', 'loyers entr.', 'part pions %', 'salaire GO', 'taxes', 'bénéfice table'],
    Object.keys(TABLES11).flatMap(tb => ['debut', 'milieu', 'fin', '*'].map(ph => { const x = m11[`${tb}|${ph}`]; const n = TABLES11[tb][0];
      return [`${tb} ${ph === '*' ? 'toutes' : ph}`, f2(x.moyR), f2(x.sdR), f2(x.loyersPions), f2(x.loyersEntreprises), pc(x.partPions), f2(x.salaireGO), f2(x.taxes), f2(n * x.moyR)]; })));
  say(`durée mesure 11 : ${((Date.now()-t11)/1000).toFixed(0)} s`);
  say('');

  const duree = (Date.now() - t0) / 1000;
  OUT.meta.dureeTotale = duree; OUT.meta.dureeSimulations = dureeSim; OUT.meta.nRecords = recs.length;
  say(`Durée : ${duree.toFixed(0)} s au total, dont ${dureeSim.toFixed(0)} s de simulation des situations ; ${recs.length} semestres jugés.`);
  fs.writeFileSync(path.join(__dirname, 'resultats.json'), JSON.stringify(OUT, null, 1));
  fs.writeFileSync(path.join(__dirname, 'resultats.txt'), TXT.join('\n') + '\n');
})().catch(e => { console.error(e); process.exit(1); });
