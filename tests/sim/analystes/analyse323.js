// Analyse des suites du banc 323 (mesures A à G). Lit les résultats bruts de mesures323.js, écrit resultats-323.json
// et resultats-323.txt dans ce dossier.
const fs = require('fs'), path = require('path');

const PROFILS = ['concentree', 'diversifiee', 'endettee', 'ordinaire'];
const profilDe = x => PROFILS[Math.min(x, 3)];
const PHASES = [['S1-2', 0, 1], ['S3-6', 2, 5], ['S7-12', 6, 11]];
const phaseDe = s => PHASES.find(p => s >= p[1] && s <= p[2])[0];

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if(a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const quant = (a, q) => { if(!a.length) return NaN; const b = Float64Array.from(a).sort(); const p = (b.length - 1) * q, i = Math.floor(p); return i + 1 < b.length ? b[i] + (b[i + 1] - b[i]) * (p - i) : b[i]; };
const med = a => quant(a, 0.5);
function rangs(a){
  const idx = a.map((x, i) => [x, i]).sort((u, v) => u[0] - v[0]);
  const r = new Array(a.length);
  for(let i = 0; i < idx.length;){ let j = i; while(j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rr = (i + j) / 2; for(let k = i; k <= j; k++) r[idx[k][1]] = rr; i = j + 1; }
  return r;
}
function pearson(x, y){ const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for(let i = 0; i < x.length; i++){ a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }
const spearman = (x, y) => x.length > 2 ? pearson(rangs(x), rangs(y)) : NaN;
const lg = x => Math.log(Math.max(x, 1e-6));
const pc = x => (x === null || x === undefined || !isFinite(x)) ? '—' : (100 * x).toFixed(1);
const f2 = x => (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(2);
const f3 = x => (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(3);
const pct = x => (x === null || x === undefined || !isFinite(x)) ? '—' : (100 * (Math.exp(x) - 1)).toFixed(1); // écart de log → %

// Capitalisation de départ (= valeur comptable de départ) de chaque entreprise, par table et rotation : elle ne dépend
// pas de la suite (les positions des pions ne changent pas le bilan de départ).
async function capitauxDepart(){
  const { chargerMoteur323 } = require('./moteur323');
  const S = require('./suites323');
  const eng = chargerMoteur323({});
  const out = {};
  for(const tb of Object.keys(S.TABLES323)) for(let rot = 0; rot < S.NROT; rot++){
    await S.preparer(eng, tb, rot);
    out[tb + '|' + rot] = eng.json(`state.companies.map(c=>c.stockPrice*c.totalShares)`);
  }
  return out;
}

async function analyser(dossier, cfg){
  const CAP = await capitauxDepart();
  const TXT = [];
  const say = (s = '') => { TXT.push(s); console.log(s); };
  const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
  const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
  function tableau(entetes, lignes){
    const w = entetes.map((h, i) => Math.max(String(h).length, ...lignes.map(l => String(l[i]).length)));
    say(entetes.map((h, i) => i === 0 ? pad(h, w[i]) : lpad(h, w[i])).join('  '));
    lignes.forEach(l => say(l.map((x, i) => i === 0 ? pad(x, w[i]) : lpad(x, w[i])).join('  ')));
  }
  const lire = cle => { const f = path.join(dossier, cle + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const OUT = { meta: { date: new Date().toISOString(), N_C: cfg.N_C, N_G: cfg.N_G, dossier }, verif: lire('verif') };
  const V = {};
  cfg.VARIANTES_C.forEach(v => { V[v.cle] = lire(v.cle); });
  const n35 = V.n35;
  const nSem = 12;

  say('BANC « SECTION 323 » — vrai code (index.html de la copie de travail) et ancien moteur (HEAD)');
  say(`Suites de ${nSem} semestres, départ « milieu » du prototype, parc vivant, tables 8 + 3 et 4 + 2, 4 rotations des types ; ${cfg.N_C} suites par table et par rotation pour les tailles (${8 * cfg.N_C} suites par variante), ${cfg.N_G} pour le pari du PDG.`);
  say(`Mêmes graines pour toutes les variantes : mêmes dés, mêmes achats du parc vivant ; tirages de cubes appariés lancer par lancer.`);
  say(`Durées des variantes (s) : ${Object.keys(V).filter(k => V[k]).map(k => `${k} ${V[k].duree.toFixed(0)}`).join(', ')}`);
  say('');

  // ---------- Vérifications ----------
  const ve = OUT.verif;
  if(ve){
    say('== Vérifications ==');
    say(`Tour du banc (avec ses espions) contre le vrai performRollForAllCompanies d'un moteur sans espions (rendu et journal neutralisés), même graine, 12 lancers : ${ve.tours.map(t => `${t.ancien ? 'ancien' : 'nouveau'} ${t.tb} rot.${t.rot} ${t.egal}/${t.nSeeds}`).join(' ; ')}`);
    say(`Gel : chiffres figés au premier lancer égaux aux chiffres provisoires de la fenêtre ${ve.gel.egauxAuGel}/${ve.gel.total} semestres ; semestres jugés par entreprise : ${ve.gel.verdictsParEntreprise[0]} (une fois chacun).`);
  }
  // Appariement : mêmes bénéfices d'une variante de taille à l'autre (preuve que seuls les cubes diffèrent).
  if(V.n00 && n35){
    let diff = 0, tot = 0;
    n35.suites.forEach((s, k) => { const o = V.n00.suites[k]; s.c.forEach((c, j) => { tot++; if(JSON.stringify(c.n.slice(0, Math.min(c.n.length, o.c[j].n.length))) !== JSON.stringify(o.c[j].n.slice(0, Math.min(c.n.length, o.c[j].n.length)))) diff++; }); });
    say(`Appariement : bénéfices semestriels identiques entre (0,0) et (3,5) pour ${tot - diff}/${tot} entreprises-suites.`);
    OUT.appariement = { identiques: tot - diff, total: tot };
  }
  say('');

  // ---------- Saisies et fins ----------
  OUT.saisies = {};
  say('== Suites avec saisie (hypothèque reprise par le moteur) et fins anticipées (plancher du cours, entreprise inactive) ==');
  const lignesS = [];
  for(const k of Object.keys(V)){ const d = V[k]; if(!d) continue;
    for(const tb of ['8+3', '4+2']){
      const ss = d.suites.filter(s => s.tb === tb);
      const sa = ss.filter(s => s.sa >= 0).length, fi = ss.filter(s => s.fi >= 0);
      const raisons = {}; fi.forEach(s => { raisons[s.rf] = (raisons[s.rf] || 0) + 1;
        // entreprise au cours le plus bas (relatif) au moment de la fin : celle qui a touché le plancher, en général
        const low = s.c.reduce((a, c) => (c.p[c.p.length - 1] < a.p[a.p.length - 1] ? c : a), s.c[0]);
        const k2 = 'plancher ' + profilDe(low.x); raisons[k2] = (raisons[k2] || 0) + 1; });
      OUT.saisies[k + '|' + tb] = { n: ss.length, saisies: sa, fins: fi.length, raisons, achats: mean(ss.map(s => s.ac)) };
      lignesS.push([`${k} ${tb}`, ss.length, `${sa} (${pc(sa / ss.length)} %)`, `${fi.length} ${JSON.stringify(raisons)}`, f2(mean(ss.map(s => s.ac)))]);
    } }
  tableau(['variante table', 'suites', 'avec saisie', 'fins anticipées', 'achats/suite'], lignesS);
  say('Les tableaux gardent les suites avec saisie (sinon 2 suites sur 3 seraient perdues, surtout celles où l\'endettée va mal) ; A et C sont aussi donnés « sans saisie ». Les mesures de cours n\'utilisent que les suites allées au bout des 12 semestres.');
  say('');

  // Enregistrements entreprise-semestre de (3,5).
  const recs = [];
  if(n35) n35.suites.forEach(s => s.c.forEach(c => {
    for(let t = 0; t < c.v.length; t++) if(c.v[t] !== '-') recs.push({ tb: s.tb, sa: s.sa, pf: profilDe(c.x), ty: c.ty, s: t, v: c.v[t], h: c.h[t], m: c.m[t], k: c.k[t], t: c.t[t], z: c.z[t], r: c.n[t], b: c.b[t], of: c.of[t] });
  }));
  const freqV = l => { const o = { n: l.length, z: 0, u: 0, U: 0, d: 0, D: 0 }; l.forEach(r => { o[r.v]++; }); ['z', 'u', 'U', 'd', 'D'].forEach(k => { o[k] /= (l.length || 1); }); return o; };
  const ligneV = (nom, o) => [nom, o.n, pc(o.z), pc(o.u), pc(o.U), pc(o.d), pc(o.D)];

  // ---------- A ----------
  OUT.A = {};
  say('== A. Fréquences du verdict avec le vrai code, tailles (3,5) — dans la zone / normal+ / fort+ / normal− / fort− (%) ==');
  say('Repère du prototype (partie type milieu + fin, zone 0,5 σ, plancher 0,5) : 41,6 / 4,6 / 22,7 / 2,9 / 28,1.');
  const grpA = [['tout', recs], ['tout sans saisie', recs.filter(r => r.sa < 0)], ['8+3', recs.filter(r => r.tb === '8+3')], ['4+2', recs.filter(r => r.tb === '4+2')]];
  PHASES.forEach(([p, a, b]) => grpA.push(['phase ' + p, recs.filter(r => r.s >= a && r.s <= b)]));
  PROFILS.forEach(pf => grpA.push(['profil ' + pf, recs.filter(r => r.pf === pf)]));
  PROFILS.forEach(pf => PHASES.slice(1).forEach(([p, a, b]) => grpA.push([`${pf} ${p}`, recs.filter(r => r.pf === pf && r.s >= a && r.s <= b)])));
  ['garp', 'dividende', 'croissance', 'momentum'].forEach(ty => grpA.push(['type ' + ty, recs.filter(r => r.ty === ty && r.s >= 2)]));
  const lA = grpA.map(([nom, l]) => { const o = freqV(l); OUT.A[nom] = o; return ligneV(nom, o); });
  tableau(['groupe', 'n', 'zone', 'n+', 'f+', 'n−', 'f−'], lA);
  // Cible : quel analyste est au milieu ; analystes absents.
  const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-3;
  const cibleDe = r => {
    const pres = [r.h, r.m, r.k].filter(x => x !== null).length;
    if(pres === 3) return near(r.t, r.m) ? 'M' : near(r.t, r.h) ? 'H' : near(r.t, r.k) ? 'K' : '?';
    if(pres === 2) return r.h === null ? 'moy. M-K (H absent)' : 'moy. H-M (K absent)';
    return 'seul';
  };
  OUT.A.cible = {};
  const lC = [];
  for(const [nom, l] of [['S1-2', recs.filter(r => r.s <= 1)], ['S3-12', recs.filter(r => r.s >= 2)], ...PROFILS.map(pf => [pf + ' S3-12', recs.filter(r => r.pf === pf && r.s >= 2)])]){
    const c = {}; l.forEach(r => { const k = cibleDe(r); c[k] = (c[k] || 0) + 1; });
    const o = {}; Object.keys(c).forEach(k => { o[k] = c[k] / l.length; });
    o.hAbsent = l.filter(r => r.h === null).length / l.length; o.kAbsent = l.filter(r => r.k === null).length / l.length;
    OUT.A.cible[nom] = o;
    lC.push([nom, l.length, pc(o.H || 0), pc(o.M || 0), pc(o.K || 0), pc(o['moy. M-K (H absent)'] || 0), pc(o['moy. H-M (K absent)'] || 0), pc(o.hAbsent), pc(o.kAbsent)]);
  }
  say('-- Analyste retenu comme cible (%) et analystes absents (%) --');
  tableau(['groupe', 'n', 'cible H', 'cible M', 'cible K', 'moy. M-K', 'moy. H-M', 'H absent', 'K absent'], lC);
  say('');

  // ---------- B ----------
  OUT.B = {};
  const complete = s => s.fi < 0;
  const D2 = V.deuxA;
  say('== B. Le penchant du marché se corrige-t-il ? Par profil et par semestre (tailles 3,5 ; suites complètes) ==');
  const parSem = (d, f) => { const o = {}; PROFILS.forEach(pf => { o[pf] = []; for(let s = 0; s < nSem; s++) o[pf].push([]); });
    d.suites.filter(complete).forEach(su => su.c.forEach(c => { const pf = profilDe(c.x); for(let s = 0; s < nSem; s++){ const v = f(c, s); if(v !== null && v !== undefined && isFinite(v)) o[pf][s].push(v); } })); return o; };
  const semCols = [0, 1, 2, 3, 5, 7, 9, 11];
  if(n35){
    const batK = parSem(n35, (c, s) => (c.k[s] === null || c.v[s] === '-') ? null : (c.n[s] > c.k[s] ? 1 : 0));
    const ecTM = parSem(n35, (c, s) => (c.t[s] === null || c.v[s] === '-') ? null : c.t[s] - c.m[s]);
    const prix = parSem(n35, (c, s) => c.p[s]);
    const kSurM = parSem(n35, (c, s) => (c.k[s] === null || !(c.m[s] > 0.05)) ? null : c.k[s] / c.m[s]);
    OUT.B.marcheBattu = {}; OUT.B.cibleMoinsM = {}; OUT.B.prixMedian = {}; OUT.B.KsurM = {};
    say('-- part des semestres où le marché K est battu (R > K), % --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.marcheBattu[pf] = batK[pf].map(mean); return [pf, ...semCols.map(s => pc(mean(batK[pf][s])))]; }));
    say('-- médiane de K / M (M > 0,05) --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.KsurM[pf] = kSurM[pf].map(med); return [pf, ...semCols.map(s => f2(med(kSurM[pf][s])))]; }));
    say('-- écart cible − modélisateur, moyenne (M$) --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.cibleMoinsM[pf] = ecTM[pf].map(mean); return [pf, ...semCols.map(s => f2(mean(ecTM[pf][s])))]; }));
    say('-- cours médian (fin du semestre ÷ départ), trois analystes --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.prixMedian[pf] = prix[pf].map(med); return [pf, ...semCols.map(s => f3(med(prix[pf][s])))]; }));
    const ecart = (a, s) => mean(a.concentree[s]) - mean(a.endettee[s]);
    OUT.B.ecartConcEnd = { 'S3-4': (ecart(batK, 2) + ecart(batK, 3)) / 2, 'S11-12': (ecart(batK, 10) + ecart(batK, 11)) / 2 };
    say(`Écart concentrée − endettée de la part « marché battu » : S3-4 ${pc(OUT.B.ecartConcEnd['S3-4'])} pts, S11-12 ${pc(OUT.B.ecartConcEnd['S11-12'])} pts.`);
  }
  if(D2){
    const prix2 = parSem(D2, (c, s) => c.p[s]);
    const ecTM2 = parSem(D2, (c, s) => (c.t[s] === null || c.v[s] === '-') ? null : c.t[s] - c.m[s]);
    OUT.B.deuxAnalystes = { prixMedian: {}, cibleMoinsM: {}, A: {} };
    say('-- variante deux analystes (historien + modélisateur, marché retiré), même tailles : cours médian --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.deuxAnalystes.prixMedian[pf] = prix2[pf].map(med); return [pf, ...semCols.map(s => f3(med(prix2[pf][s])))]; }));
    say('-- deux analystes : écart cible − modélisateur, moyenne (M$) --');
    tableau(['profil', ...semCols.map(s => 'S' + (s + 1))], PROFILS.map(pf => { OUT.B.deuxAnalystes.cibleMoinsM[pf] = ecTM2[pf].map(mean); return [pf, ...semCols.map(s => f2(mean(ecTM2[pf][s])))]; }));
    const recs2 = []; D2.suites.forEach(s => s.c.forEach(c => { for(let t = 2; t < c.v.length; t++) if(c.v[t] !== '-') recs2.push({ pf: profilDe(c.x), v: c.v[t] }); }));
    say('-- deux analystes : fréquences du verdict, semestres 3 à 12 --');
    tableau(['groupe', 'n', 'zone', 'n+', 'f+', 'n−', 'f−'], [['tout', recs2], ...PROFILS.map(pf => [pf, recs2.filter(r => r.pf === pf)])].map(([nom, l]) => { const o = freqV(l); OUT.B.deuxAnalystes.A[nom] = o; return ligneV(nom, o); }));
    if(n35){ const r3 = recs.filter(r => r.s >= 2); say('   (trois analystes, mêmes semestres : ' + ligneV('tout', freqV(r3)).slice(2).join(' / ') + ' ; ' + PROFILS.map(pf => pf + ' ' + ligneV('', freqV(r3.filter(r => r.pf === pf))).slice(2).join('/')).join(' ; ') + ')'); }
  }
  say('');

  // ---------- C et D ----------
  OUT.C = {};
  say('== C/D. Tailles (normal, fort) sur 12 semestres, vrai moteur ; « ancien » = moteur d\'avant la section 323 (paliers 1-2 / 3-5 / 6-8) ==');
  say('y = log(cours au semestre 12 ÷ cours de départ) ; q = bénéfice cumulé sur 12 semestres ÷ capitalisation de départ (le cours de départ est la valeur comptable par action).');
  const cles = ['n00', 'n24', 'n35', 'n36', 'n47', 'ancien', 'deuxA'].filter(k => V[k]);
  const nomV = k => k === 'ancien' ? 'ancien' : k === 'deuxA' ? '(3,5) sans K' : `(${k[1]},${k[2]})`;
  function statsC(d, filtre){
    const out = {};
    for(const tb of ['8+3', '4+2', 'tout']){
      const ss = d.suites.filter(s => (tb === 'tout' || s.tb === tb) && complete(s) && (!filtre || filtre(s)));
      const items = []; ss.forEach(s => s.c.forEach(c => items.push({ pf: profilDe(c.x), ty: c.ty, ti: c.ti, y: lg(c.p[11]), y4: lg(c.p[3]), y8: lg(c.p[7]),
        q: c.n.reduce((a, b) => a + b, 0) / CAP[s.tb + '|' + s.rot][c.x] })));
      const o = { n: items.length, deriveMoy: mean(items.map(i => i.y)), deriveMed: med(items.map(i => i.y)), sd: sd(items.map(i => i.y)),
        iqr: quant(items.map(i => i.y), 0.75) - quant(items.map(i => i.y), 0.25), spearman: spearman(items.map(i => i.q), items.map(i => i.y)) };
      const qs = items.map(i => i.q), q1 = quant(qs, 1 / 3), q2 = quant(qs, 2 / 3);
      o.tiers = med(items.filter(i => i.q >= q2).map(i => i.y)) - med(items.filter(i => i.q <= q1).map(i => i.y));
      // Au sein d'un même profil (entreprises comparables) : Spearman moyen et écart des tiers.
      const sp = [], tg = [];
      PROFILS.forEach(pf => { const it = items.filter(i => i.pf === pf); if(it.length < 30) return; sp.push(spearman(it.map(i => i.q), it.map(i => i.y)));
        const qq = it.map(i => i.q), a = quant(qq, 1 / 3), b = quant(qq, 2 / 3); tg.push(med(it.filter(i => i.q >= b).map(i => i.y)) - med(it.filter(i => i.q <= a).map(i => i.y))); });
      o.spearmanIntraProfil = mean(sp); o.tiersIntraProfil = mean(tg);
      o.profil = {}; PROFILS.forEach(pf => { const it = items.filter(i => i.pf === pf); o.profil[pf] = { n: it.length, y4: med(it.map(i => i.y4)), y8: med(it.map(i => i.y8)), y12: med(it.map(i => i.y)), sd: sd(it.map(i => i.y)), q: mean(it.map(i => i.q)) }; });
      o.type = {}; ['garp', 'dividende', 'croissance', 'momentum'].forEach(ty => { const it = items.filter(i => i.ty === ty); o.type[ty] = { n: it.length, y4: med(it.map(i => i.y4)), y8: med(it.map(i => i.y8)), y12: med(it.map(i => i.y)), sd: sd(it.map(i => i.y)) }; });
      o.croissance = {}; ['eleve', 'tres_eleve'].forEach(ti => { const it = items.filter(i => i.ty === 'croissance' && i.ti === ti); o.croissance[ti] = { n: it.length, y4: med(it.map(i => i.y4)), y8: med(it.map(i => i.y8)), y12: med(it.map(i => i.y)) }; });
      out[tb] = o;
    }
    return out;
  }
  cles.forEach(k => { OUT.C[k] = statsC(V[k]); OUT.C[k + ' sans saisie'] = statsC(V[k], s => s.sa < 0); });
  for(const tb of ['8+3', '4+2']){
    say(`-- ${tb} : tout le marché (cours en %, médiane de exp(y) − 1 ; dispersion = écart type de y) --`);
    tableau(['tailles', 'n', 'dérive moy. %', 'dérive méd. %', 'écart type y', 'IQR y', 'Spearman q-y', 'tiers haut − bas %', 'Spearman intra-profil', 'tiers intra-profil %', '| sans saisie : n', 'Spearman', 'tiers %'],
      cles.map(k => { const o = OUT.C[k][tb], o2 = OUT.C[k + ' sans saisie'][tb]; return [nomV(k), o.n, pct(o.deriveMoy), pct(o.deriveMed), f3(o.sd), f3(o.iqr), f3(o.spearman), pct(o.tiers), f3(o.spearmanIntraProfil), pct(o.tiersIntraProfil), '| ' + o2.n, f3(o2.spearman), pct(o2.tiers)]; }));
    say(`-- ${tb} : cours médian par profil après 4 / 8 / 12 semestres (%) et écart type de y à 12 --`);
    tableau(['tailles', ...PROFILS.map(pf => pf)], cles.map(k => [nomV(k), ...PROFILS.map(pf => { const x = OUT.C[k][tb].profil[pf]; return `${pct(x.y4)} / ${pct(x.y8)} / ${pct(x.y12)} (${f2(x.sd)})`; })]));
    say(`-- ${tb} : cours médian par type après 4 / 8 / 12 semestres (%) et écart type de y à 12 --`);
    tableau(['tailles', 'garp', 'dividende', 'croissance', 'momentum'], cles.map(k => [nomV(k), ...['garp', 'dividende', 'croissance', 'momentum'].map(ty => { const x = OUT.C[k][tb].type[ty]; return `${pct(x.y4)} / ${pct(x.y8)} / ${pct(x.y12)} (${f2(x.sd)})`; })]));
  }
  // Part des cubes injectés à la clôture.
  OUT.C.cubes = {};
  for(const k of ['n35', 'ancien', 'n00']){ const d = V[k]; if(!d) continue;
    for(const tb of ['8+3', '4+2']){
      const ent = Object.keys(d.injections).filter(x => x.startsWith(tb + '|'));
      const tot = ent.reduce((s, x) => s + d.injections[x].green + d.injections[x].red, 0);
      const rows = ent.map(x => { const o = d.injections[x]; return [x.slice(tb.length + 1), o.green, o.red, pc((o.green + o.red) / tot)]; }).sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
      OUT.C.cubes[k + '|' + tb] = { total: tot, sources: Object.fromEntries(ent.map(x => [x.slice(tb.length + 1), d.injections[x]])) };
      say(`-- cubes injectés au sac fondamental pendant advanceGameClock, ${nomV(k)}, ${tb} (${tot} cubes sur ${d.suites.filter(s => s.tb === tb).length} suites) --`);
      tableau(['source', 'verts', 'rouges', 'part %'], rows);
    } }
  say('');

  // ---------- E ----------
  OUT.E = {};
  say('== E. Alternance des verdicts (même entreprise, semestre suivant), semestres 3 à 12 ==');
  const signe = c => ('uU'.includes(c) ? 1 : 'dD'.includes(c) ? -1 : 0);
  const signeAnc = c => ('bB'.includes(c) ? 1 : 'mMR'.includes(c) ? -1 : 0);
  function alternance(d, codes, sg, depuis){
    const trans = {}; const runs = { 1: [], '-1': [] }; let base = {}; let nb = 0;
    d.suites.forEach(s => s.c.forEach(c => {
      const v = c.v || ''; let cur = 0, len = 0;
      for(let t = depuis; t < v.length; t++){
        const x = v[t]; if(x === '-') continue;
        base[x] = (base[x] || 0) + 1; nb++;
        if(t + 1 < v.length && v[t + 1] !== '-' && codes.includes(x)){ const o = trans[x] || (trans[x] = {}); o[v[t + 1]] = (o[v[t + 1]] || 0) + 1; }
        const g = sg(x);
        if(g !== 0 && g === cur) len++; else { if(cur !== 0) runs[cur].push(len); cur = g; len = g ? 1 : 0; }
      }
      if(cur !== 0) runs[cur].push(len);
    }));
    const o = { base: {}, apres: {}, series: {} };
    Object.keys(base).forEach(k => { o.base[k] = base[k] / nb; });
    Object.keys(trans).forEach(x => { const t = trans[x], n = Object.values(t).reduce((a, b) => a + b, 0); o.apres[x] = { n }; Object.keys(t).forEach(y => { o.apres[x][y] = t[y] / n; }); });
    [1, -1].forEach(g => { const r = runs[g]; o.series[g > 0 ? '+' : '−'] = { n: r.length, moy: mean(r), p3: r.filter(x => x >= 3).length / r.length }; });
    return o;
  }
  const lE = [];
  for(const k of ['n35', 'n00']){ if(!V[k]) continue; const a = alternance(V[k], ['U', 'D', 'u', 'd'], signe, 2); OUT.E[k] = a;
    ['U', 'D'].forEach(x => { const t = a.apres[x] || {}; lE.push([`${nomV(k)} après ${x === 'U' ? 'fort+' : 'fort−'} (n=${t.n})`, pc(t.z || 0), pc(t.u || 0), pc(t.U || 0), pc(t.d || 0), pc(t.D || 0)]); });
    lE.push([`${nomV(k)} ensemble`, pc(a.base.z), pc(a.base.u), pc(a.base.U), pc(a.base.d), pc(a.base.D)]); }
  tableau(['', 'zone', 'n+', 'f+', 'n−', 'f−'], lE);
  if(V.ancien){ const a = alternance(V.ancien, ['B', 'R', 'b', 'm', 'M'], signeAnc, 2); OUT.E.ancien = a;
    say('-- ancien verdict (paliers) : après « nettement battu » (B) et « vraiment raté » (R) — battu b, nettement B, raté m, nettement M, vraiment R --');
    tableau(['', 'b', 'B', 'm', 'M', 'R', 'f'], [['B', a.apres.B], ['R', a.apres.R]].map(([x, t]) => [`après ${x} (n=${t.n})`, pc(t.b || 0), pc(t.B || 0), pc(t.m || 0), pc(t.M || 0), pc(t.R || 0), pc(t.f || 0)]).concat([['ensemble', pc(a.base.b), pc(a.base.B), pc(a.base.m), pc(a.base.M), pc(a.base.R), pc(a.base.f || 0)]]));
  }
  say('-- longueur des séries de même signe (une zone coupe la série) : nombre, longueur moyenne, part de 3 ou plus --');
  tableau(['variante', 'séries +', 'moy.', '≥ 3 %', 'séries −', 'moy.', '≥ 3 %'], Object.keys(OUT.E).map(k => { const s = OUT.E[k].series; return [nomV(k), s['+'].n, f2(s['+'].moy), pc(s['+'].p3), s['−'].n, f2(s['−'].moy), pc(s['−'].p3)]; }));
  say('');

  // ---------- F ----------
  OUT.F = {};
  say('== F. Type Croissance : cases de la matrice (axe des marges / axe des analystes), % des clôtures où le sac type est recomposé ==');
  const CELLS = []; ['bon', 'neutre', 'mauvais'].forEach(mg => ['bon', 'neutre', 'mauvais'].forEach(an => CELLS.push(mg + '/' + an)));
  for(const k of ['n35', 'ancien']){ const d = V[k]; if(!d) continue;
    for(const ti of ['eleve', 'tres_eleve']){
      const cnt = {}; let tot = 0;
      Object.keys(d.cellules).forEach(x => { const [tb, t, cell] = x.split('|'); if(t !== ti) return; cnt[cell] = (cnt[cell] || 0) + d.cellules[x]; tot += d.cellules[x]; });
      let closings = 0; d.suites.forEach(s => s.c.forEach(c => { if(c.ty === 'croissance' && c.ti === ti) closings += c.n.length; }));
      OUT.F[k + '|' + ti] = { total: tot, clotures: closings, cases: Object.fromEntries(CELLS.map(c => [c, (cnt[c] || 0) / (tot || 1)])) };
    } }
  tableau(['marges/analystes', ...Object.keys(OUT.F).map(k => k.replace('|', ' ').replace('n35', 'nouveau (3,5)'))], CELLS.map(c => [c, ...Object.keys(OUT.F).map(k => pc(OUT.F[k].cases[c]))])
    .concat([['recomposé / clôtures', ...Object.keys(OUT.F).map(k => pc(OUT.F[k].total / OUT.F[k].clotures))]]));
  say('-- cours médian d\'une Croissance après 4 / 8 / 12 semestres (%), toutes tables --');
  tableau(['variante', 'élevé', 'très élevé'], cles.map(k => [nomV(k), ...['eleve', 'tres_eleve'].map(ti => { const x = OUT.C[k].tout.croissance[ti]; return `${pct(x.y4)} / ${pct(x.y8)} / ${pct(x.y12)} (n=${x.n})`; })]));
  say('');

  // ---------- G ----------
  OUT.G = {};
  say('== G. Pari du PDG simulé (tailles 3,5), gain sur le cours après 12 semestres contre « jamais », mêmes suites ==');
  say('gain = moyenne de log(cours stratégie ÷ cours « jamais ») par entreprise, en % ; ± = demi-largeur de l\'intervalle à 95 %. « informé » : avertit si M\' − M < −θ × zone, promet si M\' − M > +θ × zone.');
  const passes = [['vide', s => cfg.cleStrat(s, 'vide'), cfg.STRATS, 'sac trading vide (personne n\'échange)'],
    ['charge', s => cfg.cleStrat(s, 'charge'), cfg.STRATS, 'sac trading chargé (10 verts et 6 rouges entretenus à chaque semestre)'],
    ['g2', cfg.cleStrat2, cfg.STRATS2 || [], '2e passe : tailles (2,5), sac trading vide, promesse non tenue aggravée de A cubes (normal → fort ; fort → 5 + A)']];
  for(const [sac, cleDe, strats, titre] of passes){
    const base = lire(cleDe({ s: 'jamais' })); if(!base) continue;
    const key = s => `${s.tb}|${s.rot}|${s.i}`;
    const bmap = new Map(base.suites.filter(complete).map(s => [key(s), s]));
    const lignes = [];
    for(const st of strats){ if(st.s === 'jamais') continue;
      const d = lire(cleDe(st)); if(!d) continue;
      const g = [], gp = {}; let na = 0, np = 0, nc = 0; const sousZone = { a: [0, 0], p: [0, 0], '.': [0, 0] };
      d.suites.filter(complete).forEach(s => { const b = bmap.get(key(s)); if(!b) return;
        s.c.forEach((c, j) => { const x = lg(c.p[11]) - lg(b.c[j].p[11]); g.push(x); (gp[profilDe(c.x)] = gp[profilDe(c.x)] || []).push(x);
          for(let t = 0; t < c.c.length; t++){ nc++; const call = c.c[t]; if(call === 'a') na++; if(call === 'p') np++;
            if(c.v && c.v[t] !== '-'){ sousZone[call][1]++; if('dD'.includes(c.v[t])) sousZone[call][0]++; if(c.v[t] === 'D') sousZone[call][2] = (sousZone[call][2] || 0) + 1; } } }); });
      const o = { n: g.length, gain: mean(g), ic: 1.96 * sd(g) / Math.sqrt(g.length), avertit: na / nc, promet: np / nc,
        sousZoneSi: Object.fromEntries(Object.keys(sousZone).map(k => [k, sousZone[k][1] ? sousZone[k][0] / sousZone[k][1] : null])),
        fortMoinsSi: Object.fromEntries(Object.keys(sousZone).map(k => [k, sousZone[k][1] ? (sousZone[k][2] || 0) / sousZone[k][1] : null])),
        profil: Object.fromEntries(Object.keys(gp).map(pf => [pf, { gain: mean(gp[pf]), ic: 1.96 * sd(gp[pf]) / Math.sqrt(gp[pf].length) }])) };
      OUT.G[cleDe(st)] = o;
      const nomS = (st.s === 'informe' ? `informé θ=${st.theta} (avert. ${st.cw}, prom. ${st.cp})` : st.s === 'avertir' ? `toujours avertir (coût ${st.cw})` : `toujours promettre (gain ${st.cp})`) + (st.a ? ` A=${st.a}` : '');
      lignes.push([nomS, o.n, `${pct(o.gain)} ± ${(100 * o.ic).toFixed(1)}`, pc(o.avertit), pc(o.promet), pc(o.sousZoneSi.a), pc(o.sousZoneSi.p), pc(o.sousZoneSi['.']),
        PROFILS.map(pf => o.profil[pf] ? pct(o.profil[pf].gain) : '—').join(' / ')]);
    }
    say(`-- ${titre} --`);
    tableau(['stratégie', 'n', 'gain % ± 95 %', 'avertit %', 'promet %', 'sous zone si avert. %', 'si prom. %', 'si rien %', 'gain par profil conc / div / endet / ord'], lignes);
  }
  say('');
  fs.writeFileSync(path.join(__dirname, 'resultats-323.json'), JSON.stringify(OUT, null, 1));
  fs.writeFileSync(path.join(__dirname, 'resultats-323.txt'), TXT.join('\n') + '\n');
}

module.exports = { analyser };
