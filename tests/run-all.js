// Lance tous les tests/*.test.js l'un après l'autre et résume.  Usage :  node tests/run-all.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for(const f of files){
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if(!ok) failed++;
  const last = (r.stdout || '').trim().split('\n').pop();
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${f}${last ? '  — ' + last.trim() : ''}`);
  if(!ok){ console.log((r.stdout || '').split('\n').slice(-15).join('\n')); console.log(r.stderr || ''); }
}
console.log(`\n${files.length - failed}/${files.length} fichiers de test réussis`);
process.exit(failed ? 1 : 0);
