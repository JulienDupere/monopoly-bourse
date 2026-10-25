// Test — section 317 (première moitié), bogues 77, 78 et 79 de l'audit du 2026-10-19 : options, fenêtre « Détails
// supplémentaires » et encaisse projetée. Affichage et catégorie de journal seulement : aucun montant d'argent ne change.
//   77. La fenêtre « Évolution de mon portefeuille » doit avoir une ligne pour le gain ou la perte des options
//       clôturées / expirées : la somme des lignes = la valeur liquidative.
//   78. Le règlement en argent d'une jambe de stratégie à l'échéance entre dans le P&L des options (pas « Autres »).
//   79. « Encaisse considérant l'exercice des options » : une jambe réglée en argent crédite / débite sa valeur
//       intrinsèque au lieu de retirer un prix d'achat de parts qui ne seront jamais livrées.
// Lancer depuis la racine du dépôt :  node tests/section317a-options.test.js
const { loadEngine, check, near } = require('./helpers/engine');
const { transformContre } = require('./helpers/contre317a');

let n = 0;
const ok = (cond, msg) => { check(cond, msg); n++; };

// Carl (sans entreprise) achète un bull spread sur l'action de Bob ; fmt() est remplacé par String() pour lire les
// montants exacts dans le HTML des fenêtres.
async function setup(opts){
  const eng = loadEngine({ transform: transformContre() });
  await eng.newGame(['Alice', 'Bob', 'Carl'], ['dividende', 'garp']);
  eng.run(`globalThis.B = state.companies.find(c=>c.type==='garp');
    globalThis.C = state.players.find(p=>p.name==='Carl');
    state.gameClock.rollCount = 3; myPlayerId = C.id;
    globalThis.__html = ''; openModal = function(h){ __html = h; };
    fmt = function(x){ return String(Math.round(x*1e9)/1e9); };`);
  return eng;
}
const rows = (html) => { // [{label, value}] des lignes du tableau de la fenêtre
  const out = [];
  const re = /<tr[^>]*><td>([^<]*)<\/td><td class="money"[^>]*>([^<]*)<\/td><\/tr>/g;
  let m; while((m = re.exec(html))) out.push({label: m[1].replace(/&amp;/g, '&'), value: parseFloat(m[2].replace('+', ''))});
  return out;
};

(async () => {
  console.log('77 et 78. Bull spread réglé en argent à l’échéance, puis fenêtre « Évolution de mon portefeuille »');
  {
    const eng = await setup();
    const S = eng.run(`B.stockPrice`);
    const m0 = eng.cashTotal(), cash0 = eng.run(`C.cash`);
    const r = eng.json(`(()=>{ const x = openOptionStrategy(B, C, 'bullSpread', 'buy', ${S}, ${1.2 * S}, 12, 300); return {ok:!!x.ok, error:x.error||''}; })()`);
    ok(r.ok, 'Carl achète 300 contrats d’un bull spread (strikes S et 1,2 S), échéance au lancer 12' + (r.ok ? '' : ' — ' + r.error));
    const cashOpen = eng.run(`C.cash`);
    // Cours à 1,5 S à l’échéance : jambe longue vaut 0,5 S, jambe écrite coûte 0,3 S, soit +0,2 S × 100 × 2 000.
    eng.run(`B.stockPrice = ${1.5 * S}; state.gameClock.rollCount = 12; settleExpiredOptions();`);
    const gain = 0.2 * S * 100 * 300;
    const cash1 = eng.run(`C.cash`);
    ok(near(cash1 - cashOpen, gain, 1e-9), `règlement en argent : +${gain.toFixed(6)} M$ crédités à Carl (inchangé)`);
    ok(near(eng.cashTotal(), m0, 1e-9), 'masse monétaire conservée');
    const rec = eng.json(`playerNetWorthReconciliation(C)`);
    ok(near(rec.optionRealizedPnl, cash1 - cash0, 1e-9), `bogue 78 : le P&L des options contient le règlement (${rec.optionRealizedPnl.toFixed(6)} = ${(cash1 - cash0).toFixed(6)})`);
    ok(Math.abs(rec.other) < 1e-9, `bogue 78 : « Autres / ajustement » est nul (${rec.other.toExponential(2)}) au lieu de contenir le gain`);
    eng.run(`showPortfolioEvolutionPopup();`);
    const rs = rows(eng.run(`__html`));
    const liq = rs.find(r => r.label === 'Valeur liquidative').value;
    const sumLines = rs.filter(r => r.label !== 'Valeur liquidative').reduce((s, r) => s + r.value, 0);
    ok(rs.some(r => r.label === 'P&L options clôturées' && near(r.value, cash1 - cash0, 1e-9)), 'bogue 77 : une ligne « P&L options clôturées » montre le gain des options');
    ok(near(sumLines, liq, 1e-9), `bogue 77 : la somme des lignes (${sumLines.toFixed(6)}) = la valeur liquidative (${liq.toFixed(6)})`);
    ok(!rs.some(r => r.label === 'Autres / ajustement'), 'plus de ligne « Autres / ajustement » inutile');
  }

  console.log('77 seul. Options ordinaires clôturées avec un gain de 0,0219 M$ (cas du rapport)');
  {
    const eng = await setup();
    eng.run(`C.cumOptionNetPremium = 0.0219; C.cash += 0.0219; state.bank.cash -= 0.0219;`);
    eng.run(`showPortfolioEvolutionPopup();`);
    const rs = rows(eng.run(`__html`));
    const liq = rs.find(r => r.label === 'Valeur liquidative').value;
    const sumLines = rs.filter(r => r.label !== 'Valeur liquidative').reduce((s, r) => s + r.value, 0);
    ok(near(sumLines, liq, 1e-9) && near(liq, 50.0219, 1e-9), `somme des lignes ${sumLines.toFixed(4)} = valeur liquidative ${liq.toFixed(4)} (avant : 50,0000 contre 50,0219)`);
  }

  console.log('79. Encaisse projetée avec un bull spread réglé en argent');
  {
    const eng = await setup();
    const S = eng.run(`B.stockPrice`);
    const r = eng.json(`(()=>{ const x = openOptionStrategy(B, C, 'bullSpread', 'buy', ${S}, ${1.5 * S}, 12, 200); return {ok:!!x.ok, error:x.error||''}; })()`);
    ok(r.ok, 'Carl achète 200 contrats de bull spread (strikes S et 1,5 S)' + (r.ok ? '' : ' — ' + r.error));
    const cash = eng.run(`C.cash`);
    eng.run(`B.stockPrice = ${1.2 * S};`); // +20 % : seule la jambe longue est dans la monnaie, valeur 0,2 S × 100 × 200
    const expected = cash + 0.2 * S * 100 * 200;
    const html = eng.run(`renderPortefeuille()`);
    const m = /\(([-0-9.]+), encaisse considérant l'exercice des options\)/.exec(html);
    ok(!!m, 'la ligne de projection est affichée');
    ok(near(parseFloat(m[1]), expected, 1e-9), `projection ${m && m[1]} = encaisse ${cash.toFixed(6)} + valeur intrinsèque ${(expected - cash).toFixed(6)} (avant : encaisse moins ${(0.2 * 0 + S * 100 * 200).toFixed(4)} de prix d’exercice jamais payé)`);
    // Même résultat que le règlement réel.
    const projected = parseFloat(m[1]);
    eng.run(`state.gameClock.rollCount = 12; settleExpiredOptions();`);
    ok(near(eng.run(`C.cash`), projected, 1e-9), 'le règlement réel donne exactement la projection');
    // Jambe écrite dans la monnaie : débit de la valeur intrinsèque.
    const eng2 = await setup();
    const S2 = eng2.run(`B.stockPrice`);
    const r2 = eng2.json(`(()=>{ const x = openOptionStrategy(B, C, 'bullSpread', 'buy', ${S2}, ${1.1 * S2}, 12, 200); return {ok:!!x.ok, error:x.error||''}; })()`);
    ok(r2.ok, 'second cas : bull spread à strikes serrés (S et 1,1 S)');
    const cash2 = eng2.run(`C.cash`);
    eng2.run(`B.stockPrice = ${1.5 * S2};`);
    const html2 = eng2.run(`renderPortefeuille()`);
    const m2 = /\(([-0-9.]+), encaisse considérant l'exercice des options\)/.exec(html2);
    ok(m2 && near(parseFloat(m2[1]), cash2 + 0.1 * S2 * 100 * 200, 1e-9), 'jambes longue et écrite dans la monnaie : projection = gain net du spread');
  }

  console.log(`\nOK : section 317a (options) — ${n} vérifications`);
})().catch(e => { console.error(e); process.exit(1); });
