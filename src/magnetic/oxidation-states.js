// Automatic oxidation states by charge balance, used to pick the magnetic-ion
// form factor when the CIF gives no _atom_type_oxidation_number.
// Each element takes one oxidation state (no mixed valence). Candidates are
// listed in order of preference; the neutral assignment with the lowest total
// preference rank wins.

const ANIONS=[['F',-1],['O',-2],['Cl',-1],['Br',-1],['I',-1]];
const SOFT_ANIONS=[['N',-3],['S',-2],['Se',-2],['Te',-2],['P',-3],['As',-3],['Sb',-3],['C',-4],['H',-1]];

const CATION_STATES={
  H:[1],Li:[1],Na:[1],K:[1],Rb:[1],Cs:[1],Ag:[1],Cu:[2,1,3],Au:[1,3],Tl:[1,3],Hg:[2,1],
  Be:[2],Mg:[2],Ca:[2],Sr:[2],Ba:[2],Zn:[2],Cd:[2],Pb:[2,4],Sn:[4,2],Ge:[4],Si:[4],C:[4],
  B:[3],Al:[3],Ga:[3],In:[3],Sc:[3],Y:[3],La:[3],Bi:[3,5],Sb:[5,3],As:[5,3],P:[5],N:[5,3],
  S:[6,4],Se:[4,6],Te:[4,6],I:[5,7],
  Ti:[4,3],Zr:[4],Hf:[4],V:[5,4,3],Nb:[5,4],Ta:[5],Cr:[3,6,4],Mo:[6,4,5],W:[6,5,4],
  Mn:[2,3,4],Re:[4,6,5,7],Fe:[3,2],Ru:[4,3,5],Os:[4,5,6],Co:[2,3],Rh:[3,4],Ir:[4,3,5],
  Ni:[2,3],Pd:[2,4],Pt:[4,2],
  Ce:[3,4],Pr:[3,4],Nd:[3],Pm:[3],Sm:[3,2],Eu:[3,2],Gd:[3],Tb:[3,4],Dy:[3],Ho:[3],Er:[3],
  Tm:[3],Yb:[3,2],Lu:[3],U:[4,6,5,3],Np:[4,5,6],Pu:[4,3],Am:[3]
};

const symbolOf=e=>String(e||'').match(/^[A-Z][a-z]?/)?.[0]||'';

// composition: {element: count}. Returns {element: oxidationState} or null.
export function chargeBalancedOxidationStates(composition){
  const counts={};
  for(const [element,n] of Object.entries(composition||{})){
    const s=symbolOf(element); if(s&&n>1e-9) counts[s]=(counts[s]||0)+Number(n);
  }
  const elements=Object.keys(counts);
  if(elements.length<2) return null;
  // Hard anions first; otherwise the first soft anion present (most electronegative).
  let anions=ANIONS.filter(([e])=>counts[e]);
  if(!anions.length){ const soft=SOFT_ANIONS.find(([e])=>counts[e]); if(soft) anions=[soft]; }
  if(!anions.length) return null;
  const anionSet=new Set(anions.map(([e])=>e));
  const result=Object.fromEntries(anions);
  let charge=anions.reduce((sum,[e,ox])=>sum+counts[e]*ox,0);
  const cations=elements.filter(e=>!anionSet.has(e));
  if(!cations.length || cations.some(e=>!CATION_STATES[e])) return null;
  let best=null;
  const choice=new Array(cations.length).fill(0);
  let combos=cations.reduce((p,e)=>p*CATION_STATES[e].length,1);
  if(combos>200000) return null;
  for(let n=0;n<combos;n++){
    let k=n,total=charge,rank=0;
    for(let i=0;i<cations.length;i++){
      const states=CATION_STATES[cations[i]];
      choice[i]=k%states.length; k=Math.floor(k/states.length);
      total+=counts[cations[i]]*states[choice[i]]; rank+=choice[i];
    }
    if(Math.abs(total)<1e-3*Math.max(1,charge<0?-charge:charge) && (!best||rank<best.rank)){
      best={rank,states:cations.map((e,i)=>CATION_STATES[e][choice[i]])};
    }
  }
  if(!best) return null;
  cations.forEach((e,i)=>{result[e]=best.states[i];});
  return result;
}

export function compositionOfSites(sites){
  const out={};
  for(const s of sites||[]){
    const e=symbolOf(s.element); if(!e) continue;
    out[e]=(out[e]||0)+Number(s.occupancy??1);
  }
  return out;
}

// Most common state, used when charge balance fails.
export function preferredOxidationState(element){
  return CATION_STATES[symbolOf(element)]?.[0] ?? null;
}
