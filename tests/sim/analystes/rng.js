// Hasard semé et reproductible (xoshiro128**, semé par splitmix32). Banc de mesure « trois analystes ».
// Un seul générateur par moteur : rng.seed(n) le replace au début d'une suite connue ; rng.random() remplace
// Math.random dans le moteur (voir moteur.js).
function splitmix32(a){
  return function(){
    a |= 0; a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}
function makeRng(seed){
  let s0, s1, s2, s3;
  function seedWith(n){
    const sm = splitmix32(n >>> 0);
    s0 = sm(); s1 = sm(); s2 = sm(); s3 = sm();
    if((s0|s1|s2|s3) === 0) s0 = 1;
  }
  function next(){
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9);
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    return (r >>> 0) / 4294967296;
  }
  function rotl(x, k){ return (x << k) | (x >>> (32 - k)); }
  seedWith(seed || 1);
  return { seed: seedWith, random: next, getState: () => [s0, s1, s2, s3], setState: a => { [s0, s1, s2, s3] = a; } };
}
// Graine dérivée d'une étiquette et d'un numéro de tirage (même graine = même suite de dés et de cubes).
function seedOf(label, i){
  let h = 2166136261;
  const s = label + '#' + i;
  for(let k = 0; k < s.length; k++){ h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
module.exports = { makeRng, seedOf };
