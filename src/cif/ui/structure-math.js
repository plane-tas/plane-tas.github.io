// Vector/lattice math and element colour helpers for the structure viewer.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installStructureMath(ctx){
  const {deps:{
    PI
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    assignDistinctElementColors, directLatticeBasis, directionFromPolar, directionToPolar,
    elementColor, fracWrap01, fractionalToCartesian, hslToHex, vecAdd, vecCross, vecDot, vecNorm,
    vecNormalize, vecScale, vecSub
  });

function vecAdd(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function vecSub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function vecScale(v,s){ return [v[0]*s,v[1]*s,v[2]*s]; }
function vecDot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function vecCross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function vecNorm(v){ return Math.hypot(v[0],v[1],v[2]); }
function vecNormalize(v){ const n=vecNorm(v); return n>1e-12 ? [v[0]/n,v[1]/n,v[2]/n] : [0,0,1]; }
function directionToPolar(v){
  if(vecNorm(v)<1e-12) return {theta:0,phi:0};
  const n=vecNormalize(v);
  const theta=Math.acos(Math.max(-1,Math.min(1,n[2])))*180/PI;
  let phi=Math.atan2(n[1],n[0])*180/PI;
  if(phi<0) phi+=360;
  return {theta,phi};
}
function directionFromPolar(thetaDeg,phiDeg){
  const theta=Number(thetaDeg)*PI/180, phi=Number(phiDeg)*PI/180;
  if(!Number.isFinite(theta)||!Number.isFinite(phi)) return [0,0,1];
  return [Math.sin(theta)*Math.cos(phi),Math.sin(theta)*Math.sin(phi),Math.cos(theta)];
}
function fracWrap01(x){ return ((x%1)+1)%1; }
function clampInt(value,min,max,fallback=1){
  const n=Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
}
function directLatticeBasis(lattice){
  const a=Number(lattice?.a), b=Number(lattice?.b), c=Number(lattice?.c);
  const al=Number(lattice?.alpha||90)*PI/180;
  const be=Number(lattice?.beta||90)*PI/180;
  const ga=Number(lattice?.gamma||90)*PI/180;
  if(![a,b,c,al,be,ga].every(Number.isFinite) || !(a>0&&b>0&&c>0)) return null;
  const ca=Math.cos(al), cb=Math.cos(be), cg=Math.cos(ga), sg=Math.sin(ga);
  if(Math.abs(sg)<1e-12) return null;
  const avec=[a,0,0];
  const bvec=[b*cg,b*sg,0];
  const cx=c*cb;
  const cy=c*(ca-cb*cg)/sg;
  const cz2=Math.max(0,c*c-cx*cx-cy*cy);
  const cvec=[cx,cy,Math.sqrt(cz2)];
  const V=vecDot(avec,vecCross(bvec,cvec));
  if(!(Math.abs(V)>1e-12)) return null;
  const astar=vecScale(vecCross(bvec,cvec),1/V);
  const bstar=vecScale(vecCross(cvec,avec),1/V);
  const cstar=vecScale(vecCross(avec,bvec),1/V);
  return {a:avec,b:bvec,c:cvec,astar,bstar,cstar,volume:Math.abs(V)};
}
function fractionalToCartesian(basis,frac){
  return vecAdd(vecAdd(vecScale(basis.a,frac[0]),vecScale(basis.b,frac[1])),vecScale(basis.c,frac[2]));
}
function supercellCenter(basis,repeats){
  return vecScale(vecAdd(vecAdd(vecScale(basis.a,repeats.x),vecScale(basis.b,repeats.y)),vecScale(basis.c,repeats.z)),0.5);
}
function hashString(str){
  let h=0;
  const s=String(str||"");
  for(let i=0;i<s.length;i++) h=((h<<5)-h+s.charCodeAt(i))|0;
  return Math.abs(h);
}
function hslToHex(h,s,l){
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;} else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
  const hex=v=>Math.round((v+m)*255).toString(16).padStart(2,"0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
function assignDistinctElementColors(elements){
  cifState.structureElementDefaultColors.clear();
  elements.forEach((element,index)=>{
    const color=index<cifState.STRUCTURE_PALETTE.length ? cifState.STRUCTURE_PALETTE[index] : hslToHex((index*137.508)%360,68,50);
    cifState.structureElementDefaultColors.set(String(element),color);
  });
}
function defaultElementColor(element){
  return cifState.structureElementDefaultColors.get(String(element||"")) || cifState.STRUCTURE_PALETTE[hashString(element)%cifState.STRUCTURE_PALETTE.length];
}
function elementColor(element){
  return cifState.structureAtomColorOverrides.get(String(element||"")) || defaultElementColor(element);
}
}
