// Section 312 — banc à deux appareils pour les tests des offres (prêt, hypothèque) : deux moteurs (vm) qui partagent
// la même partie en mode local (window.storage commun pour les clés game:*), chacun avec le mini-DOM du banc
// (tests/helpers/fake-dom.js), si bien que les VRAIS gestionnaires de clics des fenêtres s'exécutent.
// Repris du harnais de tests/section308-formulaires.test.js (version réduite : pas de champs, pas de focus).
//
//   const { partie } = require('./helpers/appareils-312');
//   const T = await partie({ transform, names: ['Alice', 'Bob'] });   // A = appareil d'Alice, B = appareil de Bob
//   await T.B.sonder();                     // l'appareil reçoit la dernière valeur partagée (sondage du mode local)
//   await T.A.cliquer('[data-x="id"]');     // clic réel ; attend la fin de l'action
//   T.A.fenetre();                          // HTML de la fenêtre ouverte ('' si aucune)
const { loadEngine } = require('./engine');
const { creerDocument } = require('./fake-dom');

function appareil(shared, opts = {}){
  const local = new Map();
  const doc = creerDocument();
  const timeouts = [], intervals = new Map(); let nextId = 1;
  const storage = {
    get: async k => { const m = k.startsWith('game:') ? shared : local; return m.has(k) ? { value: m.get(k) } : null; },
    set: async (k, v) => { (k.startsWith('game:') ? shared : local).set(k, v); return true; },
    delete: async k => { (k.startsWith('game:') ? shared : local).delete(k); return true; },
  };
  const alerts = [];
  const eng = loadEngine({ transform: opts.transform, globals: {
    document: doc, storage, alert: m => alerts.push(String(m)),
    setTimeout: f => { timeouts.push(f); return nextId++; },
    setInterval: f => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: id => { intervals.delete(id); },
    Event: class { constructor(t){ this.type = t; } },
  } });
  const D = { eng, doc, alerts, run: c => eng.run(c), json: c => eng.json(c) };
  D.sonder = async () => { for(const f of [...intervals.values()]) if(/storageGet\('game:'/.test(String(f))) await f(); };
  D.minuteries = async () => { for(let i = 0; i < 50 && timeouts.length; i++){ const f = timeouts.shift(); await f(); } };
  D.calme = async () => { for(let i = 0; i < 10; i++){ await new Promise(r => setImmediate(r)); await D.minuteries(); } };
  D.cliquer = async sel => { eng.run('lastActionEndMs = 0; lastModalOpenMs = 0;'); const r = doc.cliquer(sel); await r.promesse; await D.calme(); return r.clic; };
  D.fenetre = () => { const h = doc.trouver('modalHost'); return h ? h.innerHTML : ''; };
  D.existe = sel => !!doc.trouver(sel);
  return D;
}

// Partie : Alice (créatrice, appareil A) et Bob (appareil B), chacun CEO d'une entreprise GARP.
async function partie({ transform, names = ['Alice', 'Bob'], types } = {}){
  const shared = new Map();
  const A = appareil(shared, { transform });
  const ids = await A.eng.newGame(names, types || names.map(() => 'garp'));
  await A.run('saveGame({silent:true})');
  const code = A.run('gameCode');
  const B = appareil(shared, { transform });
  await B.run(`loadGame(${JSON.stringify(code)})`);
  B.run('render()');
  await B.cliquer(`[data-identity-pick="${ids[1]}"]`);
  A.run('closeModal(); render()'); B.run('closeModal(); render()');
  await A.calme(); await B.calme();
  A.alerts.length = 0; B.alerts.length = 0;
  const serveur = () => JSON.parse(shared.get('game:' + code));
  return { shared, A, B, ids, code, serveur };
}

module.exports = { appareil, partie };
