// Situations posées à la main (CONTRAT.md, « Situations », et ronde 2). Profils suivis : 0 = concentrée (un groupe
// chargé), 1 = diversifiée (petits terrains, aéroports, services), 2 = endettée ; les suivantes sont « ordinaires ».
const PROFILS = ['concentree', 'diversifiee', 'endettee'];
const profilDe = i => PROFILS[i] || 'ordinaire';

const TABLES = {
  '8+3': { n: 8, pawns: 3 }, '6+5': { n: 6, pawns: 5 }, '4+7': { n: 4, pawns: 7 }, '4+0': { n: 4, pawns: 0 },
};

// Ronde 2, correction 4 : types tournés sur les profils. Rotation r : l'entreprise i reçoit CYCLE[(i + r) % 4] ; une
// Croissance est « élevée » aux rotations paires, « très élevée » aux impaires. Sur les 4 rotations, chaque profil
// passe par chacun des quatre types.
const CYCLE = ['garp', 'dividende', 'croissance', 'momentum'];
const NROT = 4;
function typesFor(n, rot){
  const out = [];
  for(let i=0;i<n;i++){
    const type = CYCLE[(i + rot) % 4];
    out.push(type === 'croissance' ? {type, tier: rot % 2 ? 'tres_eleve' : 'eleve'} : {type});
  }
  return out;
}

const grp = (noms, h, extra) => noms.map(n => Object.assign({name: n, houses: h||0}, extra||{}));
const G = {
  BRUN: ['Brun 1','Brun 2'], BLEU_PALE: ['Bleu pâle 1','Bleu pâle 2','Bleu pâle 3'], ROSE: ['Rose 1','Rose 2','Rose 3'],
  ORANGE: ['Orange 1','Orange 2','Orange 3'], ROUGE: ['Rouge 1','Rouge 2','Rouge 3'], JAUNE: ['Jaune 1','Jaune 2','Jaune 3'],
  VERT: ['Vert 1','Vert 2','Vert 3'], BLEU_FONCE: ['Bleu foncé 1','Bleu foncé 2'],
  AEROPORT: ['Aéroport 1','Aéroport 2','Aéroport 3','Aéroport 4'], SERVICE: ['Service 1','Service 2'],
};

// Par phase : terrains des trois profils suivis, puis des « ordinaires » dans l'ordre, encaisse et avances GO.
// Ronde 2, correction 5 : l'endettée a une encaisse suffisante pour payer ses intérêts annuels.
const PHASES = {
  debut: {
    conc: grp(['Orange 1','Orange 2']),
    div:  grp(['Aéroport 1','Service 1']),
    debt: [{name:'Rose 1'}, {name:'Rose 2', mortgage:true}],
    ords: [grp(['Rouge 1','Brun 1']), grp(['Vert 1']), grp(['Jaune 1','Aéroport 3']), grp(['Bleu pâle 1']), grp(['Bleu foncé 1'])],
    cash: {normal: 15, debt: 8}, goAdvDebt: 1,
  },
  milieu: {
    conc: grp(G.ORANGE, 2),
    div:  grp(['Aéroport 1','Aéroport 2','Service 1','Brun 1']),
    debt: [{name:'Rose 1', houses:1}, {name:'Rose 2', houses:1}, {name:'Rose 3', houses:1, mortgage:true}],
    ords: [grp(G.VERT, 1), grp(G.BLEU_PALE, 2), grp(['Rouge 1','Rouge 2','Jaune 1']), grp(['Jaune 2','Jaune 3','Aéroport 3']),
           grp(['Bleu foncé 1','Rouge 3','Aéroport 4','Service 2'])],
    cash: {normal: 6, debt: 10}, goAdvDebt: 2,
  },
  fin: {
    conc: grp(G.ROUGE, 4),
    div:  grp(['Brun 1','Bleu pâle 1','Aéroport 1','Aéroport 2','Aéroport 3','Service 1','Service 2']),
    debt: [{name:'Jaune 1', houses:3}, {name:'Jaune 2', houses:3}, {name:'Jaune 3', houses:3, mortgage:true}, {name:'Aéroport 4', mortgage:true}],
    ords: [grp(G.VERT, 5), grp(G.BLEU_FONCE, 3), grp(G.ORANGE, 3), grp(G.ROSE, 2), grp(['Bleu pâle 2','Bleu pâle 3','Brun 2'])],
    cash: {normal: 20, debt: 30}, goAdvDebt: 3,
  },
};

function specFor(tableKey, phaseKey, rot){
  const T = TABLES[tableKey], P = PHASES[phaseKey];
  const names = []; for(let i=0;i<T.n;i++) names.push('J' + (i+1));
  const props = [];
  const add = (list, co) => list.forEach(p => props.push(Object.assign({co}, p)));
  add(P.conc, 0); add(P.div, 1); add(P.debt, 2);
  for(let i=3;i<T.n;i++) add(P.ords[i-3], i);
  const cash = names.map((_, i) => i===2 ? P.cash.debt : P.cash.normal);
  const goAdv = names.map((_, i) => i===2 ? P.goAdvDebt : 0);
  return { names, types: typesFor(T.n, rot||0), pawns: T.pawns, props, cash, goAdv };
}

// Variante « transition » : +2 maisons (au plus 5) sur le groupe de l'entreprise concentrée juste avant le 4e semestre.
const TRANSITION_HOUSES = 2;
// Parc vivant : entreprises qui achètent ou bâtissent au début des semestres 2, 3 et 4 de la suite.
const VIVANT_ACTEURS = 2;

// Mesure 11 : tout le plateau possédé, réparti également ; mêmes maisons au total pour toutes les tables.
const TABLES11 = { '2+1': [2,1], '3+1': [3,1], '4+2': [4,2], '6+2': [6,2], '7+2': [7,2], '8+3': [8,3] };
const MAISONS11 = {
  debut:  {},
  milieu: {BRUN:1, BLEU_PALE:2, ROSE:1, ORANGE:2, ROUGE:1, JAUNE:1, VERT:1, BLEU_FONCE:0},
  fin:    {BRUN:3, BLEU_PALE:4, ROSE:3, ORANGE:4, ROUGE:4, JAUNE:3, VERT:5, BLEU_FONCE:3},
};
// defs : [{name, group, type, prob, rent}] (PROPERTY_DEFS). Terrains triés par loyer attendu (prob × loyer à la
// phase), distribués en serpentin (1..n, n..1) pour égaliser les parts.
function spec11(tableKey, phaseKey, defs){
  const [n, pawns] = TABLES11[tableKey];
  const H = MAISONS11[phaseKey];
  const names = []; for(let i=0;i<n;i++) names.push('J' + (i+1));
  const items = defs.map(d => {
    const h = d.type === 'color' ? (H[d.group] || 0) : 0;
    const rent = d.type === 'color' ? d.rent[h] : (d.type === 'airport' ? d.rent[0] : 7 * d.rent[0]);
    return { name: d.name, houses: h, val: d.prob * rent };
  }).sort((a, b) => b.val - a.val);
  const props = items.map((it, k) => { const round = Math.floor(k / n), pos = k % n; return { name: it.name, houses: it.houses, co: round % 2 ? n - 1 - pos : pos }; });
  return { names, types: names.map(() => ({type:'garp'})), pawns, props, cash: names.map(() => 20), goAdv: names.map(() => 0) };
}

module.exports = { TABLES, PHASES, PROFILS, profilDe, specFor, TRANSITION_HOUSES, VIVANT_ACTEURS, NROT, TABLES11, spec11 };
