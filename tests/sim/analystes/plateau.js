// Probabilités exactes du plateau du jeu (40 cases, 2 dés, case 30 qui renvoie en 10, aucune carte).
// Tirées des mêmes règles que corePerformDiceRoll : passage par GO = nouvelle case < ancienne (avant le renvoi),
// arrivée sur 30 = enquête (le pion ne relance plus dans le semestre : jailTurns = 3 ≥ lancers restants).
const DICE = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
const P = r => DICE[r] / 36;

// Loi stationnaire de la position AVANT un lancer, et fréquence d'arrivée par case et par lancer (arrivée sur 30 comptée
// sur 30, puis le pion part en 10).
function stationnaire(){
  let pi = new Array(40).fill(1/40);
  for(let it=0; it<5000; it++){
    const nx = new Array(40).fill(0);
    for(let k=0;k<40;k++){ if(!pi[k]) continue; for(let r=2;r<=12;r++){ let d=(k+r)%40; if(d===30) d=10; nx[d]+=pi[k]*P(r); } }
    let diff = 0; for(let k=0;k<40;k++) diff += Math.abs(nx[k]-pi[k]);
    pi = nx; if(diff < 1e-15) break;
  }
  const land = new Array(40).fill(0);
  for(let k=0;k<40;k++) for(let r=2;r<=12;r++) land[(k+r)%40] += pi[k]*P(r);
  return { pos: pi, land };
}

// Depuis une position réelle : pour chacun des n lancers, probabilité d'arriver sur chaque case ; probabilité de
// passer par GO ; probabilité d'avoir été mis sous enquête avant chaque lancer (le pion ne joue plus ensuite).
function depuisPosition(pos0, n){
  let dist = new Array(40).fill(0); dist[pos0] = 1;
  const land = [], landDice = [], landDice2 = [], jailBefore = [];
  let jailed = 0, passGo = 0;
  for(let t=0;t<n;t++){
    jailBefore.push(jailed);
    const L = new Array(40).fill(0), LD = new Array(40).fill(0), LD2 = new Array(40).fill(0), nx = new Array(40).fill(0);
    for(let k=0;k<40;k++){
      const m = dist[k]; if(!m) continue;
      for(let r=2;r<=12;r++){
        const d = (k+r)%40, w = m*P(r);
        L[d] += w; LD[d] += w*r; LD2[d] += w*r*r; // Ronde 2 : vrai total des dés à l'arrivée (services)
        if(d < k) passGo += w;
        if(d===30) jailed += w; else nx[d] += w;
      }
    }
    land.push(L); landDice.push(LD); landDice2.push(LD2); dist = nx;
  }
  return { land, landDice, landDice2, passGo, jailBefore, jailedEnd: jailed };
}

module.exports = { DICE, P, stationnaire, depuisPosition };
