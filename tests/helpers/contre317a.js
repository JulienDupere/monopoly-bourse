// Section 317 (première moitié) — contre-épreuves : chaque entrée réintroduit l'ancien code d'un bogue dans le moteur
// chargé par le banc. Les tests section317a-*.test.js lisent la variable d'environnement CONTRE_317A (numéro du bogue)
// et chargent le moteur ainsi modifié ; le test DOIT alors échouer (vérifié par tests/section317a-contre.test.js).
const sub = (de, vers) => (src) => {
  if(!src.includes(de)) throw new Error('Contre-épreuve : motif introuvable : ' + de.slice(0, 70));
  return src.split(de).join(vers);
};
const TR = {
  '77': [sub("...(Math.abs(r.optionRealizedPnl)>1e-9 ? [{label:'P&L options clôturées', value:r.optionRealizedPnl}] : []),", '')],
  '78': [sub("player.cumOptionNetPremium = (player.cumOptionNetPremium||0) + amount; // Section 317", '// Section 317'),
         sub("player.cumOptionNetPremium = (player.cumOptionNetPremium||0) - amount; // Section 317", '// Section 317')],
  '79': [sub('if(!isBuy && !pos.cashSettled) return;', 'if(!isBuy) return;'), sub('if(pos.cashSettled) projected +=', 'if(false) projected +=')],
  '85': [sub("newUnit==='shares' ? qty.toFixed(4) : String(Number(amt.toFixed(6)))", "(newUnit==='shares' ? qty : amt).toFixed(newUnit==='shares'?4:2)")],
  '86': [sub('Math.min(bondInterestRaw, Math.max(0, bondBalanceNow))', 'bondInterestRaw')],
  '87': [sub('+ (bidBondsSoldThisRoll[pl.id]||0); // Section 317', '; // Section 317')],
  '91': [sub('pour ${fmt(paidAmount)} (', 'pour ${fmt(amount)} (')],
  '96': [sub("const num = v=>typeof v==='number' && isFinite(v);", "return null; const num = v=>typeof v==='number' && isFinite(v);")],
  '99a': [sub('if(seen.has(key)) return', 'if(false) return')],
  '99b': [sub('if(state.players.some(p=>p.name.trim().toLowerCase()===name.toLowerCase())) return', 'if(false) return')],
  '101a': [sub('logoDataUrl: safeLogoDataUrl(logoDataUrl),', 'logoDataUrl: logoDataUrl || null,')],
  '98': [sub("value: Math.max(0, me.bondBalance||0), color: 'var(--muted)'}", "value: me.bondBalance||0, color: 'var(--muted)'}")],
  '101b': [sub('const safeLogo = safeLogoDataUrl(co.logoDataUrl);', 'const safeLogo = co.logoDataUrl;'), sub('<img src="${esc(safeLogo)}"', '<img src="${safeLogo}"')],
};
function transformContre(){
  const k = process.env.CONTRE_317A;
  if(!k) return undefined;
  if(!TR[k]) throw new Error('CONTRE_317A inconnu : ' + k);
  return (src) => TR[k].reduce((s, f) => f(s), src);
}
module.exports = { transformContre, CLES: Object.keys(TR) };
