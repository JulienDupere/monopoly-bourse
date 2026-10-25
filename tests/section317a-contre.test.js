// Test — section 317 (première moitié) : contre-épreuves. Pour chacun des bogues 77, 78, 79, 85, 86, 87, 91, 96, 98,
// 99 et 101, l'ancien code est réintroduit dans le moteur (tests/helpers/contre317a.js) et le test du bogue DOIT
// échouer ; sans modification, il réussit. Un test qui ne détecterait pas la régression ferait échouer ce fichier.
// Lancer depuis la racine du dépôt :  node tests/section317a-contre.test.js
const { spawnSync } = require('child_process');
const path = require('path');
const { check } = require('./helpers/engine');
const { CLES } = require('./helpers/contre317a');

const FICHIER = { '77': 'options', '78': 'options', '79': 'options', '85': 'marche', '86': 'marche', '87': 'marche', '91': 'marche', '98': 'marche', '86b': 'marche', '98b': 'marche', '96b': 'creation',
  '96': 'creation', '99a': 'creation', '99b': 'creation', '101a': 'creation', '101b': 'creation' };
let n = 0;
const lancer = (cle) => spawnSync(process.execPath, [path.join(__dirname, `section317a-${FICHIER[cle]}.test.js`)], { env: Object.assign({}, process.env, cle ? { CONTRE_317A: cle } : {}), encoding: 'utf8' });

for (const f of ['options', 'marche', 'creation']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, `section317a-${f}.test.js`)], { env: Object.assign({}, process.env, { CONTRE_317A: '' }), encoding: 'utf8' });
  check(r.status === 0, `section317a-${f} : réussit avec le code corrigé`); n++;
}
for (const cle of CLES) {
  check(!!FICHIER[cle], `contre-épreuve ${cle} rattachée à un fichier de test`); n++;
  const r = lancer(cle);
  const sortie = (r.stdout || '') + (r.stderr || '');
  check(r.status !== 0 && /ÉCHEC/.test(sortie), `bogue ${cle} : le test ÉCHOUE quand l'ancien code est réintroduit`); n++;
}
console.log(`\nOK : section 317a (contre-épreuves) — ${n} vérifications`);
