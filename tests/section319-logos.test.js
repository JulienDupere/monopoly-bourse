// Test — section 319, M6 : le logo d'une entreprise vit dans l'état de la partie, donc il est renvoyé à tous les
// appareils à chaque action. Une photo en PNG de 240 px y pèse ~110 Ko, contre ~15 Ko en JPEG à la même taille.
// Règle : image sans transparence = JPEG quand il pèse moins de la moitié du PNG (une photo : ~1/7) ; logo dessiné
// (gain faible, bords moins nets) ou transparent = PNG ; dans le doute, PNG.
// Les poids ci-dessous sont ceux mesurés (en caractères de data URL). Lancer :  node tests/section319-logos.test.js
const { loadEngine } = require('./helpers/engine');

let nChecks = 0;
function check(cond, msg){ if(!cond) throw new Error('ÉCHEC : ' + msg); nChecks++; console.log('  OK', msg); }

const PNG = n => 'data:image/png;base64,' + 'A'.repeat(n);
const JPEG = n => 'data:image/jpeg;base64,' + 'B'.repeat(n);

// Faux canvas : pixels opaques sauf mention contraire, et poids choisi pour chaque format.
function fauxCanvas(o){
  const appels = [];
  const ctx = {
    drawImage(){},
    getImageData(x, y, w, h){
      if(o.pixelsIllisibles) throw new Error('lecture des pixels refusée');
      const d = new Uint8ClampedArray(w * h * 4).fill(255);
      if(o.alpha !== undefined) d[4 * 5 + 3] = o.alpha;   // un seul pixel non opaque suffit
      return { data: d };
    },
  };
  const canvas = {
    width: 0, height: 0,
    getContext(){ return ctx; },
    toDataURL(type, q){
      appels.push({ type, q });
      if(type !== 'image/jpeg') return PNG(o.png);
      if(o.jpegRefuse === 'exception') throw new Error('format refusé');
      if(o.jpegRefuse === 'png') return PNG(o.png);        // un navigateur qui ne sait pas faire rend du PNG
      return JPEG(o.jpeg);
    },
  };
  return { canvas, ctx, appels };
}

class FauxFileReader { readAsDataURL(){ this.result = 'data:image/jpeg;base64,SOURCE'; setImmediate(() => this.onload()); } }
const fauxImage = (w, h) => class { set src(v){ this.width = w; this.height = h; setImmediate(() => this.onload()); } };

// Chaîne complète : fichier choisi -> image 1200 x 800 -> canvas 240 x 160 -> data URL rangée dans l'entreprise.
async function chaine(transform){
  const eng = loadEngine({ transform, globals: { FileReader: FauxFileReader, Image: fauxImage(1200, 800) } });
  const f = fauxCanvas({ png: 112000, jpeg: 15000 });
  eng.sandbox.document.createElement = () => f.canvas;
  const url = await eng.run('resizeImageFileToDataUrl({}, 240)');
  return { eng, f, url };
}

(async () => {
  const eng = loadEngine();
  const choisir = o => { const f = fauxCanvas(o); return { url: eng.run('lighterLogoDataUrl')(f.canvas, f.ctx, 240, 240), f }; };

  console.log('1. Photo sans transparence');
  let r = choisir({ png: 112000, jpeg: 15000 });
  check(r.url === JPEG(15000), 'une photo opaque est rangée en JPEG (15 000 caractères au lieu de 112 000)');
  check(r.f.appels.some(a => a.type === 'image/jpeg' && a.q === 0.85), 'le JPEG est demandé à la qualité 0,85');

  console.log('2. Logo dessiné (aplats, texte)');
  r = choisir({ png: 2300, jpeg: 6400 });
  check(r.url === PNG(2300), 'un logo dessiné reste en PNG, plus léger et net (2 300 contre 6 400)');
  // Mesuré dans Chrome sur un logo dessiné réduit de 1200 à 240 px : PNG 10 898 caractères, JPEG 8 515.
  r = choisir({ png: 10898, jpeg: 8515 });
  check(r.url === PNG(10898), 'JPEG à peine plus léger (8 515 contre 10 898) : PNG gardé, pour des bords nets');
  check(choisir({ png: 10000, jpeg: 4000 }).url === JPEG(4000) && choisir({ png: 10000, jpeg: 6000 }).url === PNG(10000), 'seuil : JPEG à 40 % du PNG retenu, à 60 % écarté');

  console.log('3. Image avec transparence');
  r = choisir({ png: 112000, jpeg: 15000, alpha: 254 });
  check(r.url === PNG(112000), 'un seul pixel non opaque : PNG gardé, même si le JPEG serait plus léger');
  check(!r.f.appels.some(a => a.type === 'image/jpeg'), 'le JPEG n’est même pas demandé pour une image transparente');

  console.log('4. Dans le doute, PNG comme avant');
  check(choisir({ png: 112000, jpeg: 15000, pixelsIllisibles: true }).url === PNG(112000), 'pixels illisibles : PNG');
  check(choisir({ png: 112000, jpeg: 15000, jpegRefuse: 'exception' }).url === PNG(112000), 'JPEG refusé par une exception : PNG');
  check(choisir({ png: 112000, jpeg: 15000, jpegRefuse: 'png' }).url === PNG(112000), 'navigateur qui rend du PNG à la place du JPEG : PNG');

  console.log('5. Chaîne complète, du fichier à l’entreprise');
  const c = await chaine();
  check(c.f.canvas.width === 240 && c.f.canvas.height === 160, 'une image de 1200 x 800 est réduite à 240 x 160');
  check(c.url === JPEG(15000), 'le fichier choisi donne un logo en JPEG');
  check(c.eng.run('safeLogoDataUrl')(c.url) === c.url, 'ce logo passe la validation du moteur');
  const ids = await c.eng.newGame(['Alice', 'Bob'], [null, 'garp']);
  const avant = c.eng.cashTotal();
  await c.eng.sandbox.createCompany(ids[0], 'Photo SA', '', 'garp', null, null, c.url);
  check(c.eng.run('state.companies.find(x=>x.name==="Photo SA").logoDataUrl') === c.url, 'l’entreprise fondée garde ce logo');
  check(Math.abs(c.eng.cashTotal() - avant) < 1e-9, 'monnaie conservée à la fondation');
  const poids = c.eng.run('JSON.stringify(state).length');
  check(poids < 112000, `l’état de la partie pèse ${poids} caractères, moins qu’un seul logo photo en PNG`);

  console.log('6. Contre-épreuve : avec l’ancien code, la même photo pèse 7 fois plus');
  const ancien = await chaine(src => src.replace('resolve(lighterLogoDataUrl(canvas, ctx, w, h));', "resolve(canvas.toDataURL('image/png'));"));
  check(ancien.url === PNG(112000), 'ancien code réintroduit : le logo photo sort en PNG de 112 000 caractères');
  check(ancien.url.length > 7 * c.url.length, 'soit plus de 7 fois le poids du nouveau');

  console.log(`${nChecks} vérifications OK`);
})().catch(e => { console.error(e); process.exit(1); });
