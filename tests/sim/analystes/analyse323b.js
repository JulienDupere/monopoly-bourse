// Analyse de la 2e mesure (moteur corrigé) : mesures 1 à 3. Écrit resultats-323b.json et resultats-323b.txt ici.
const fs = require('fs'), path = require('path');

const PROFILS = ['concentree', 'diversifiee', 'endettee', 'ordinaire'];
const profilDe = x => PROFILS[Math.min(x, 3)];
const PHASES = [['S1-2', 0, 1], ['S3-6', 2, 5], ['S7-12', 6, 11]];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if(a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const quant = (a, q) => { if(!a.length) return NaN; const b = Float64Array.from(a).sort(); const p = (b.length - 1) * q, i = Math.floor(p); return i + 1 < b.length ? b[i] + (b[i + 1] - b[i]) * (p - i) : b[i]; };
const med = a => quant(a, 0.5);
function rangs(a){ const idx = a.map((x, i) => [x, i]).sort((u, v) => u[0] - v[0]); const r = new Array(a.length);
  for(let i = 0; i < idx.length;){ let j = i; while(j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for(let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(x, y){ const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for(let i = 0; i < x.length; i++){ a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }
const spearman = (x, y) => x.length > 2 ? pearson(rangs(x), rangs(y)) : NaN;
const lg = x => Math.log(Math.max(x, 1e-6));
const pc = x => (x === null || x === undefined || !isFinite(x)) ? '—' : (100 * x).toFixed(1);
const f2 = x => (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(2);
const f3 = x => (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(3);
const pct = x => (x === null || x === undefined || !isFinite(x)) ? '—' : (100 * (Math.exp(x) - 1)).toFixed(1);

async function capitauxDepart(){
  const { chargerMoteur323 } = require('./moteur323');
  const S = require('./suites323');
  const eng = chargerMoteur323({});
  const out = {};
  for(const tb of Object.keys(S.TABLES323)) for(let rot = 0; rot < S.NROT; rot++){ await S.preparer(eng, tb, rot); out[tb + '|' + rot] = eng.json(`state.companies.map(c=>c.stockPrice*c.totalShares)`); }
  return out;
}

async function analyser(dossier, cfg){
  const CAP = await capitauxDepart();
  const TXT = []; const say = (s = '') => { TXT.push(s); console.log(s); };
  const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
  const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
  function tableau(e, l){ const w = e.map((h, i) => Math.max(String(h).length, ...l.map(r => String(r[i]).length)));
    say(e.map((h, i) => i ? lpad(h, w[i]) : pad(h, w[i])).join('  ')); l.forEach(r => say(r.map((x, i) => i ? lpad(x, w[i]) : pad(x, w[i])).join('  '))); }
  const lire = cle => { const f = path.join(dossier, cle + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const avant = (() => { const f = path.join(__dirname, 'resultats-323.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; })();
  const OUT = { meta: { date: new Date().toISOString(), N_C: cfg.N_C, N_G: cfg.N_G, zonePari: [cfg.ZK, cfg.ZF] }, verif: lire('verif') };
  const complete = s => s.fi < 0;

  say('BANC « SECTION 323 », 2e MESURE — moteur corrigé (modélisateur par tour, bénéfice jugé, gel après les enchères, marché à 2 entreprises au moins), tailles 2 / 5, 0 ou 1 cube dans la zone');
  say(`Suites de 12 semestres, départ « milieu », parc vivant, tables 8 + 3 et 4 + 2, 4 rotations des types ; ${cfg.N_C} suites par table et rotation pour les zones (${8 * cfg.N_C} par variante), ${cfg.N_G} pour le pari (${8 * cfg.N_G}). Mêmes graines partout : mêmes dés et mêmes achats d'une variante à l'autre.`);
  if(OUT.verif) say(`Vérification : tour du banc = vrai performRollForAllCompanies (rendu neutralisé), 12 lancers : ${OUT.verif.tours.map(t => `${t.tb} rot.${t.rot} ${t.egal}/${t.nSeeds}`).join(' ; ')} ; gel = chiffres provisoires ${OUT.verif.gel.egauxAuGel}/${OUT.verif.gel.total}.`);
  say('');

  // ---------- Statistiques d'une variante de zone ----------
  function stats(d){
    const o = { duree: d.duree };
    const recs = [];
    d.suites.forEach(s => s.c.forEach(c => { for(let t = 0; t < c.v.length; t++) if(c.v[t] !== '-') recs.push({ tb: s.tb, pf: profilDe(c.x), s: t, v: c.v[t], q: c.q[t] }); }));
    const fr = l => { const r = { n: l.length, z: 0, u: 0, U: 0, d: 0, D: 0 }; l.forEach(x => { r[x.v]++; }); ['z', 'u', 'U', 'd', 'D'].forEach(k => { r[k] /= (l.length || 1); }); return r; };
    o.freq = { tout: fr(recs) };
    PROFILS.forEach(pf => { o.freq[pf] = fr(recs.filter(r => r.pf === pf)); });
    PHASES.forEach(([p, a, b]) => { o.freq[p] = fr(recs.filter(r => r.s >= a && r.s <= b)); });
    ['8+3', '4+2'].forEach(tb => { o.freq[tb] = fr(recs.filter(r => r.tb === tb)); });
    const vg = d.injections.verdict; o.rouges = vg.red / ((vg.red + vg.green) || 1);
    o.cubesParSem = mean(recs.map(r => Math.abs(r.q))); o.netParSem = mean(recs.map(r => r.q));
    o.cubesZone = mean(recs.filter(r => r.v === 'z').map(r => Math.abs(r.q)));
    o.table = {};
    for(const tb of ['8+3', '4+2']){
      const ss = d.suites.filter(s => s.tb === tb);
      const items = []; ss.filter(complete).forEach(s => s.c.forEach(c => items.push({ pf: profilDe(c.x), y: lg(c.p[11]), q: c.n.reduce((a, b) => a + b, 0) / CAP[s.tb + '|' + s.rot][c.x] })));
      const sp = []; PROFILS.forEach(pf => { const it = items.filter(i => i.pf === pf); if(it.length > 30) sp.push(spearman(it.map(i => i.q), it.map(i => i.y))); });
      o.table[tb] = { suites: ss.length, plancher: ss.filter(s => s.fi >= 0 && s.rf === 'stockFloor').length, finsAutres: ss.filter(s => s.fi >= 0 && s.rf !== 'stockFloor').length,
        saisies: ss.filter(s => s.sa >= 0).length, deriveMed: med(items.map(i => i.y)), sdY: sd(items.map(i => i.y)), iqrY: quant(items.map(i => i.y), 0.75) - quant(items.map(i => i.y), 0.25),
        spearman: spearman(items.map(i => i.q), items.map(i => i.y)), spearmanIntra: mean(sp),
        profil: Object.fromEntries(PROFILS.map(pf => [pf, med(items.filter(i => i.pf === pf).map(i => i.y))])) };
    }
    // Alternance (semestres 3 à 12).
    const trans = { U: {}, D: {} }; const runs = [];
    d.suites.forEach(s => s.c.forEach(c => { const v = c.v; let cur = 0, len = 0;
      for(let t = 2; t < v.length; t++){ const x = v[t]; if(x === '-') continue;
        if(t + 1 < v.length && v[t + 1] !== '-' && (x === 'U' || x === 'D')) trans[x][v[t + 1]] = (trans[x][v[t + 1]] || 0) + 1;
        const g = 'uU'.includes(x) ? 1 : 'dD'.includes(x) ? -1 : 0;
        if(g !== 0 && g === cur) len++; else { if(cur !== 0) runs.push(len); cur = g; len = g ? 1 : 0; } }
      if(cur !== 0) runs.push(len); }));
    o.apres = {}; ['U', 'D'].forEach(x => { const t = trans[x], n = Object.values(t).reduce((a, b) => a + b, 0); o.apres[x] = { n }; ['z', 'u', 'U', 'd', 'D'].forEach(y => { o.apres[x][y] = (t[y] || 0) / n; }); });
    o.serie = { moy: mean(runs), p3: runs.filter(x => x >= 3).length / runs.length };
    return o;
  }

  const Z = {}; cfg.VARIANTES_Z.forEach(v => { const d = lire(v.cle); if(d) Z[v.cle] = stats(d); });
  OUT.zones = Z;

  // ---------- Mesure 1 ----------
  say('== Mesure 1 : le verdict après les corrections — tailles (2,5), 0 ou 1 cube dans la zone, k 0,5 ==');
  const z = Z.z50;
  if(z){
    const ligne = (nom, r) => [nom, r.n, pc(r.z), pc(r.u), pc(r.U), pc(r.d), pc(r.D)];
    tableau(['groupe', 'n', 'zone', 'n+', 'f+', 'n−', 'f−'], [['avant correction (3,5), tout', 143768, '43.8', '3.5', '22.5', '2.3', '27.8'],
      ...['tout', '8+3', '4+2', ...PROFILS, ...PHASES.map(p => p[0])].map(k => ligne(k, z.freq[k]))]);
    // Biais R − M (bénéfice jugé − modélisateur) par profil.
    const d = lire('z50'); const bias = {}; const dessus = {};
    d.suites.forEach(s => s.c.forEach(c => { const pf = profilDe(c.x); for(let t = 0; t < 12; t++){ if(c.j && c.j[t] != null && c.m[t] != null){ (bias[pf] = bias[pf] || []).push(c.j[t] - c.m[t]); (dessus[pf] = dessus[pf] || []).push(c.j[t] > c.t[t] ? 1 : 0); } } }));
    OUT.biais = Object.fromEntries(PROFILS.map(pf => [pf, { RmoinsM: mean(bias[pf]), ic: 1.96 * sd(bias[pf]) / Math.sqrt(bias[pf].length), partAuDessusCible: mean(dessus[pf]) }]));
    say('Biais du modélisateur, bénéfice jugé − M (M$, moyenne ± 95 %) et part des semestres au-dessus de la cible : ' + PROFILS.map(pf => `${pf} ${f2(OUT.biais[pf].RmoinsM)} ± ${f2(OUT.biais[pf].ic)} (${pc(OUT.biais[pf].partAuDessusCible)} %)`).join(' ; '));
    const a35 = avant && avant.C && avant.C.n35, a00 = avant && avant.C && avant.C.n00;
    const rows = [];
    if(a35) rows.push(['avant, (3,5), 0 dans la zone', '55.0 / 52.6', '—', f2(100 * (Math.exp(a35['8+3'].deriveMed) - 1)), f2(100 * (Math.exp(a35['4+2'].deriveMed) - 1)), f3(a35['8+3'].spearman), f3(a35['4+2'].spearman), f3(a35['8+3'].spearmanIntraProfil), '50 / 12', '1.22']);
    if(a00) rows.push(['avant, verdict coupé', '—', '0', f2(100 * (Math.exp(a00['8+3'].deriveMed) - 1)), f2(100 * (Math.exp(a00['4+2'].deriveMed) - 1)), f3(a00['8+3'].spearman), f3(a00['4+2'].spearman), f3(a00['8+3'].spearmanIntraProfil), '35 / 6', '1.22']);
    for(const k of ['coupe', 'z50']){ const x = Z[k]; if(!x) continue;
      rows.push([k === 'z50' ? 'après, (2,5), 0-1 dans la zone' : 'après, verdict coupé', pc(x.rouges), f2(x.cubesParSem), pct(x.table['8+3'].deriveMed), pct(x.table['4+2'].deriveMed), f3(x.table['8+3'].spearman), f3(x.table['4+2'].spearman), f3(x.table['8+3'].spearmanIntra), `${x.table['8+3'].plancher} / ${x.table['4+2'].plancher}`, f2(x.serie.moy)]); }
    tableau(['', 'rouges du verdict %', 'cubes verdict / sem.', 'dérive méd. 8+3 %', '4+2 %', 'Spearman 8+3', '4+2', 'intra-profil 8+3', 'plancher /1000 (8+3 / 4+2)', 'série moy.'], rows);
    say(`Alternance : après un fort+ → ${['z', 'u', 'U', 'd', 'D'].map(k => k + ' ' + pc(z.apres.U[k])).join(', ')} (n=${z.apres.U.n}) ; après un fort− → ${['z', 'u', 'U', 'd', 'D'].map(k => k + ' ' + pc(z.apres.D[k])).join(', ')} (n=${z.apres.D.n}) ; séries de même signe ${f2(z.serie.moy)} semestre, ${pc(z.serie.p3)} % de 3 ou plus. (Avant : après fort+ f− 34,5 %, après fort− f+ 30,3 %.)`);
    say(`Cubes nets du verdict par entreprise et par semestre : ${f3(z.netParSem)} (négatif = rouge) ; dans la zone ${f3(z.cubesZone)} cube en moyenne.`);
  }
  say('');

  // ---------- Mesure 2 ----------
  say('== Mesure 2 : largeur de la zone (tailles 2,5 ; 0 ou 1 cube dans la zone) ==');
  const ordre = ['z50', 'z35', 'z35f25', 'z25', 'coupe'].filter(k => Z[k]);
  const nomZ = k => cfg.VARIANTES_Z.find(v => v.cle === k).nom;
  tableau(['réglage', 'zone', 'n+', 'f+', 'n−', 'f−', 'normal / hors zone', 'rouges %', 'cubes / sem.', 'écart type y 8+3', '4+2', 'dérive méd. 8+3 %', '4+2 %', 'Spearman 8+3', '4+2', 'intra 8+3', 'plancher 8+3', '4+2'],
    ordre.map(k => { const x = Z[k], f = x.freq.tout; return [nomZ(k), pc(f.z), pc(f.u), pc(f.U), pc(f.d), pc(f.D), pc((f.u + f.d) / (1 - f.z)), pc(x.rouges), f2(x.cubesParSem), f3(x.table['8+3'].sdY), f3(x.table['4+2'].sdY),
      pct(x.table['8+3'].deriveMed), pct(x.table['4+2'].deriveMed), f3(x.table['8+3'].spearman), f3(x.table['4+2'].spearman), f3(x.table['8+3'].spearmanIntra), x.table['8+3'].plancher, x.table['4+2'].plancher]; }));
  say('-- part des semestres dans la zone, par profil et par phase (%) --');
  tableau(['réglage', ...PROFILS, ...PHASES.map(p => p[0])], ordre.filter(k => k !== 'coupe').map(k => [nomZ(k), ...PROFILS.map(pf => pc(Z[k].freq[pf].z)), ...PHASES.map(p => pc(Z[k].freq[p[0]].z))]));
  say('-- cours médian à 12 semestres par profil (%), 8+3 --');
  tableau(['réglage', ...PROFILS], ordre.map(k => [nomZ(k), ...PROFILS.map(pf => pct(Z[k].table['8+3'].profil[pf]))]));
  say('-- alternance --');
  tableau(['réglage', 'après f+ : f−', 'après f+ : f+', 'après f− : f+', 'après f− : f−', 'série moy.', '≥ 3 %'], ordre.map(k => { const x = Z[k]; return [nomZ(k), pc(x.apres.U.D), pc(x.apres.U.U), pc(x.apres.D.U), pc(x.apres.D.D), f2(x.serie.moy), pc(x.serie.p3)]; }));
  say('');

  // ---------- Mesure 3 ----------
  OUT.G = {};
  say(`== Mesure 3 : pari du PDG (simulé), tailles (2,5), 0 ou 1 cube dans la zone, zone k ${cfg.ZK} plancher ${cfg.ZF} ; gain sur le cours à 12 semestres contre « jamais », mêmes suites ==`);
  say('gain = moyenne de log(cours ÷ cours « jamais ») par entreprise (%), ± 95 %. Annonces = nombre moyen par entreprise sur 12 semestres. Informé : avertit si M\' − M < −0,5 zone, promet si M\' − M > +0,5 zone.');
  const nomP = P => { const p = cfg.PROMESSES[P]; return `P-${P} (${p.cp} V, ratée +${p.x} R${p.monte ? ', réussie +1 cran' : ''})`; };
  for(const sac of ['fond', 'vide', 'charge']){
    const base = lire(cfg.cleG(sac, 'jamais')); if(!base) continue;
    const key = s => `${s.tb}|${s.rot}|${s.i}`;
    const bmap = new Map(base.suites.filter(complete).map(s => [key(s), s]));
    const lignes = [];
    for(const v of cfg.VARIANTES_G.filter(v => v.sac === sac && v.strat !== 'jamais')){
      const d = lire(v.cle); if(!d) continue;
      const g = [], nAnn = []; let na = 0, np = 0, nc = 0; const sz = { a: [0, 0], p: [0, 0], '.': [0, 0] };
      d.suites.filter(complete).forEach(s => { const b = bmap.get(key(s)); if(!b) return;
        s.c.forEach((c, j) => { g.push(lg(c.p[11]) - lg(b.c[j].p[11]));
          let k = 0; for(let t = 0; t < c.c.length; t++){ nc++; const call = c.c[t]; if(call === 'a') na++; if(call === 'p') np++; if(call !== '.') k++;
            if(c.v[t] !== '-'){ sz[call][1]++; if('dD'.includes(c.v[t])) sz[call][0]++; } } nAnn.push(k); }); });
      const o = { n: g.length, gain: mean(g), ic: 1.96 * sd(g) / Math.sqrt(g.length), annonces: mean(nAnn), avertit: na / nc, promet: np / nc,
        sousZone: Object.fromEntries(Object.keys(sz).map(k => [k, sz[k][1] ? sz[k][0] / sz[k][1] : null])) };
      o.parAnnonce = o.gain / o.annonces; o.icParAnnonce = o.ic / o.annonces;
      OUT.G[v.cle] = o;
      const nomS = v.strat === 'avertir' ? `toujours avertir (${v.cwN} R)` : v.strat === 'promettre' ? `toujours promettre, ${nomP(v.P)}` :
        v.strat === 'informe' ? `informé, avert. ${v.cwN} R + ${nomP(v.P)}` : v.strat === 'informeP' ? `informé, promesses seules, ${nomP(v.P)}` : `informé, avertissements seuls (${v.cwN} R)`;
      lignes.push([nomS, o.n, `${pct(o.gain)} ± ${(100 * o.ic).toFixed(1)}`, f2(o.annonces), pc(o.avertit), pc(o.promet), pc(o.sousZone.a), pc(o.sousZone.p), pc(o.sousZone['.']),
        v.strat.startsWith('informe') ? `${(100 * o.parAnnonce).toFixed(2)} ± ${(100 * o.icParAnnonce).toFixed(2)}` : '—']);
    }
    say(`-- cube de l'annonce : ${sac === 'fond' ? 'sac fondamental' : sac === 'vide' ? 'sac trading vide' : 'sac trading chargé (10 V, 6 R entretenus)'} --`);
    tableau(['stratégie', 'n', 'gain % ± 95 %', 'annonces', 'avertit %', 'promet %', 'sous zone si avert. %', 'si prom. %', 'si rien %', 'gain par annonce (pts %)'], lignes);
  }
  say('');
  fs.writeFileSync(path.join(__dirname, 'resultats-323b.json'), JSON.stringify(OUT, null, 1));
  fs.writeFileSync(path.join(__dirname, 'resultats-323b.txt'), TXT.join('\n') + '\n');
}

module.exports = { analyser };
