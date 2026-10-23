import {automaticMagneticFormFactorWeight, computeMagneticFormFactor, magneticIonConfigurations} from './magnetic-form-factor.js';
import {MAGNETIC_ION_DATA} from './magnetic-form-factor-data.js';
// Bragg intensities from a fully specified COMMENSURATE magnetic motif.
// Intensity is the unpolarized magnetic structure factor in barn per magnetic
// cell, excluding scale, Lorentz, absorption, extinction and form-factor terms.
export const MAGNETIC_BRAGG_CONSTANT_BARN = 0.07265; // (gamma*r0/2)^2
const twopi=2*Math.PI;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a);
const unit=a=>{const n=norm(a);return n>1e-12?a.map(x=>x/n):[0,0,0];};
const plus=(a,b)=>a.map((x,i)=>x+b[i]);
const times=(a,s)=>a.map(x=>x*s);
function rotate(v,axis,angle){const u=unit(axis),c=Math.cos(angle),s=Math.sin(angle);return plus(plus(times(v,c),times(cross(u,v),s)),times(u,dot(u,v)*(1-c)));}
export function latticeVectors(l){
  const [a,b,c]=[l.a,l.b,l.c].map(Number);
  const [alpha,beta,gamma]=[l.alpha,l.beta,l.gamma].map(x=>Number(x)*Math.PI/180);
  const ca=Math.cos(alpha), cb=Math.cos(beta), cg=Math.cos(gamma), sg=Math.sin(gamma);
  if(!(a>0&&b>0&&c>0&&Math.abs(sg)>1e-9))throw Error('Invalid magnetic cell.');
  const A=[a,0,0],B=[b*cg,b*sg,0],cx=c*cb,cy=c*(ca-cb*cg)/sg;
  const cz2=c*c-cx*cx-cy*cy;
  if(!(cz2>0))throw Error('Invalid magnetic lattice geometry.');
  return [A,B,[cx,cy,Math.sqrt(cz2)]];
}
export function cartesianMoment(crystalAxis,lattice){
  const axes=latticeVectors(lattice).map(unit);
  return crystalAxis.reduce((v,x,i)=>plus(v,times(axes[i],Number(x)||0)),[0,0,0]);
}
function reciprocalBasis(lattice){
  const [a,b,c]=latticeVectors(lattice);
  const vol=dot(a,cross(b,c));
  return [times(cross(b,c),twopi/vol),times(cross(c,a),twopi/vol),times(cross(a,b),twopi/vol)];
}
export function reciprocalVector(lattice,hkl){
  const B=reciprocalBasis(lattice);
  return hkl.reduce((v,x,i)=>plus(v,times(B[i],x)),[0,0,0]);
}
// Finite supercell for k=(n1/d1,n2/d2,n3/d3). Strict rational check
// avoids silently replacing a genuinely incommensurate modulation.
export function rationalDenominator(value,max=24,tol=1e-8){
  const v=Number(value);
  if(!Number.isFinite(v))throw Error('Invalid propagation-vector component.');
  for(let d=1;d<=max;d++)if(Math.abs(v*d-Math.round(v*d))<=tol*d)return d;
  throw Error('Incommensurate k is not supported in the finite-cell Bragg calculator.');
}
// Moment of an atom at position r (parent-cell fractional coordinates,
// including the lattice-cell offset) for a single-k structure. The phase is
// 2*pi*k.r of the ATOM POSITION, so centring translations (R, C, I, F
// lattices) and atoms inside the cell get their own phase automatically —
// e.g. NiTiO3, k = (0,0,3/2): ferromagnetic Ni layers stacked antiparallel.
//   collinear : m * sign(cos(2*pi*k.r)); at cos = 0 exactly, frac(k.r) = 1/4
//               gives -m and 3/4 gives +m (deterministic tie-break).
//   sinusoidal: m cos(2*pi*k.r)
//   helical   : m rotated about `axis` by -/+ 2*pi*k.r (CCW / CW).
export function modulatedMoment(m,kr,{mode='collinear',axis=[0,0,1],chirality='CCW'}={}){
  let f=Number(kr)-Math.floor(Number(kr));
  if(f>1-1e-9) f=0;
  if(mode==='collinear') return (f<0.25-1e-9 || f>=0.75-1e-9) ? m.slice() : m.map(v=>-v);
  const phase=twopi*f;
  if(mode==='sinusoidal'){
    const c=Math.cos(phase);
    return m.map(v=>v*(Math.abs(c)<1e-12?0:c));
  }
  if(mode==='helical') return rotate(m,axis,(chirality==='CW'?1:-1)*phase);
  throw Error('Unsupported magnetic structure type.');
}
// Phase reference of an atom relative to its position in the cell (see
// parseCifStructure: phaseRef = r_s + w + T for the atom W r_s + w + T made
// from asymmetric site r_s by {W|w}). The phase of the atom drawn at r in
// cell R is 2*pi*k.(R + r + shift) = 2*pi*k.(R + T + w + r_s):
// rotations of a site keep its phase, translations carry k.t. Zero for
// atoms without a reference (identity images, edited structures).
export function symmetryPhaseShift(atom){
  return [[atom?.phaseRefX,atom?.x],[atom?.phaseRefY,atom?.y],[atom?.phaseRefZ,atom?.z]]
    .map(([s,x])=>Number.isFinite(Number(s))&&Number.isFinite(Number(x))?Number(s)-Number(x):0);
}
// Collinear sign is ill-defined where cos(2*pi*k.r) ~ 0 (k.r ~ 1/4, 3/4):
// e.g. bcc with k = (0,0,1/2) puts the body centre on a node.
export function collinearSignAmbiguous(kr,tol=0.1){
  return Math.abs(Math.cos(twopi*Number(kr)))<tol;
}
// Single-k motif of a NUCLEAR structure with symmetry-linked site moments
// (CIF + k). Imported mCIF models are assembled in cif/ui/magnetic-model.js.
export function buildMagneticMotif({structure,settings=new Map(),q=[0,0,0],mode='collinear',axis='c',chirality='CCW',maxAtoms=1500}){
  if(!structure?.atoms?.length)throw Error('No atomic structure loaded.');
  const dims=q.map(v=>rationalDenominator(v));
  const size=dims.reduce((a,b)=>a*b,1)*structure.atoms.length;
  if(size>maxAtoms)throw Error(`Magnetic supercell would contain ${size} atoms (limit ${maxAtoms}).`);
  const parentBasis=latticeVectors(structure.lattice);
  const rotAxis=parentBasis[['a','b','c'].indexOf(axis)]||parentBasis[2];
  const sites=[];
  let ambiguousSites=0;
  for(let ix=0;ix<dims[0];ix++)for(let iy=0;iy<dims[1];iy++)for(let iz=0;iz<dims[2];iz++){
    for(const atom of structure.atoms){
      const p=[atom.x+ix,atom.y+iy,atom.z+iz];
      const kr=dot(q,p)+dot(q,symmetryPhaseShift(atom));
      const key=`${atom.sourceSiteIndex}:${structure.asymmetricSites?.[atom.sourceSiteIndex]?.label||atom.sourceLabel||atom.element}`;
      const s=settings.get(key);
      let m=(s?.enabled && [s.mx,s.my,s.mz].every(Number.isFinite))?[s.mx,s.my,s.mz]:[0,0,0];
      if(mode==='collinear' && norm(m)>1e-12 && collinearSignAmbiguous(kr)) ambiguousSites++;
      m=modulatedMoment(m,kr,{mode,axis:rotAxis,chirality});
      // Biso/Uaniso travel with the site: the magnetic and nuclear amplitudes
      // of one atom share the same Debye-Waller factor.
      sites.push({element:atom.element,occupancy:Number(atom.occupancy??1),
        Biso:Number(atom.Biso)||0,Uaniso:atom.Uaniso||null,
        fract:p.map((x,i)=>x/dims[i]), moment:m,sourceLabel:atom.sourceLabel});
    }
  }
  const lattice={...structure.lattice,a:structure.lattice.a*dims[0],b:structure.lattice.b*dims[1],c:structure.lattice.c*dims[2]};
  return {lattice,sites,replication:dims,source:'CIF + k',ambiguousSites,
    caveat:'Dipole approximation with the selected magnetic-ion form factors (f = 1 where none is selected). Same Debye-Waller factor as the nuclear calculation. Single magnetic domain. No absorption, extinction, or instrument corrections.'};
}
// Debye-Waller factor of one site, identical to nuclearStructureFactorSquared:
// U^ij (CIF convention, along normalized a*,b*,c*) or Biso. A diagonal
// supercell leaves the reciprocal-axis directions, hence U^ij, unchanged.
function debyeWaller(site,hkl,q,rlen){
  if(site.Uaniso && rlen){
    const g=[hkl[0]*rlen[0],hkl[1]*rlen[1],hkl[2]*rlen[2]];
    let quad=0;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)quad+=g[i]*Number(site.Uaniso[i][j]||0)*g[j];
    return Math.exp(-2*Math.PI*Math.PI*quad);
  }
  const B=Number(site.Biso)||0;
  return B ? Math.exp(-B*q*q/(16*Math.PI*Math.PI)) : 1;
}
export function magneticStructureFactorSquared(motif,hkl,{formFactor=()=>1}={}){
  const Q=reciprocalVector(motif.lattice,hkl),q=norm(Q);
  if(!(q>1e-9))return 0;
  const rlen=reciprocalBasis(motif.lattice).map(v=>norm(v)/twopi);
  const n=Q.map(x=>x/q),re=[0,0,0],im=[0,0,0];
  for(const s of motif.sites){
    if(!s.moment || norm(s.moment)<1e-12)continue;
    const v=plus(s.moment,times(n,-dot(s.moment,n)));
    const ff=Number(formFactor(s.element,q));
    if(!Number.isFinite(ff))throw Error('Invalid magnetic form factor.');
    const amp=(s.occupancy??1)*ff*debyeWaller(s,hkl,q,rlen);
    const phase=twopi*dot(hkl,s.fract),c=Math.cos(phase),sn=Math.sin(phase);
    for(let i=0;i<3;i++){re[i]+=amp*v[i]*c;im[i]+=amp*v[i]*sn;}
  }
  return MAGNETIC_BRAGG_CONSTANT_BARN*(dot(re,re)+dot(im,im));
}
// Only use magnetic-ion factors when oxidation states are explicitly known.
// Site labels such as Cu1 are crystallographic labels, NOT Cu+.
export function explicitMagneticIonFactors(cifText){
  const lines=String(cifText||'').split(/\r?\n/);
  const result={};
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().toLowerCase()!=='loop_')continue;
    const fields=[];let j=i+1;
    while(j<lines.length && lines[j].trim().startsWith('_')){fields.push(lines[j].trim().split(/\s+/)[0].toLowerCase());j++;}
    const symbolColumn=fields.indexOf('_atom_type_symbol');
    const oxColumn=fields.indexOf('_atom_type_oxidation_number');
    if(symbolColumn<0||oxColumn<0)continue;
    for(;j<lines.length;j++){
      const line=lines[j].trim();
      if(!line||line.startsWith('#'))continue;
      if(line==='loop_'||line.startsWith('_')||line.startsWith('data_')||line.startsWith('save_'))break;
      const tokens=line.match(/(?:'[^']*'|"[^"]*"|\S+)/g)||[];
      if(tokens.length<fields.length)continue;
      const element=tokens[symbolColumn].replace(/^['"]|['"]$/g,'').match(/^[A-Z][a-z]?/)?.[0];
      const ox=Number(tokens[oxColumn]);
      if(!element||!Number.isInteger(ox)||ox<0)continue;
      const ion=element+ox;
      if(magneticIonConfigurations(ion).length){
        if(Object.hasOwn(result,element)&&result[element]!==ion)result[element]=null;
        else if(!Object.hasOwn(result,element))result[element]=ion;
      }
    }
  }
  return result;
}
// Dipole-approximation form factor f(Q) = <j0> + c <j2> of the ion chosen for
// an element (ionByElement: {Fe:'Fe3', ...}); 1 when no ion is chosen.
// c follows the Toolbox default: 0 for 3d/4d/5d, (2-g)/g for 4f/5f ions.
export function magneticIonFormFactor(element,Q,ionByElement={}){
  const symbol=String(element||'').match(/^[A-Z][a-z]?/)?.[0]||'';
  const ion=ionByElement[symbol];
  if(!ion)return 1;
  const entry=MAGNETIC_ION_DATA[ion]?.[0];
  if(!entry)return 1;
  const [config,term]=entry;
  return computeMagneticFormFactor(ion,Q,{config,j2Weight:automaticMagneticFormFactorWeight(config,term)}).f;
}
// Magnetic elements (with a nonzero moment) of a motif, sorted.
export function magneticElementsOfMotif(motif){
  return [...new Set((motif?.sites||[]).filter(s=>s.moment&&norm(s.moment)>1e-12)
    .map(s=>String(s.element||'').match(/^[A-Z][a-z]?/)?.[0]).filter(Boolean))].sort();
}
function magneticFormFactorDisplay(motif,Q,ionByElement){
  const elements=[...new Set(motif.sites.filter(s=>s.moment&&norm(s.moment)>1e-12).map(s=>s.element))].sort();
  if(!elements.length)return {display:'1',sortValue:1};
  const factors=elements.map(element=>({element,ion:ionByElement[element],value:magneticIonFormFactor(element,Q,ionByElement)}));
  if(factors.length===1)return {display:Number(factors[0].value.toFixed(5)).toString(),sortValue:factors[0].value};
  return {display:factors.map(f=>`${f.ion||f.element}: ${Number(f.value.toFixed(4))}`).join('; '),sortValue:factors.reduce((sum,f)=>sum+f.value,0)/factors.length};
}
export function magneticBraggPeaks(motif,wavelength,{twoThetaMax=180,maxCandidates=350000,ionByElement={}}={}){
  const lambda=Number(wavelength);if(!(lambda>0))throw Error('Wavelength must be positive.');
  const qMax=4*Math.PI/lambda, l=motif.lattice;
  const bound=[l.a,l.b,l.c].map(x=>Math.ceil(qMax*Number(x)/(twopi))+2);
  const count=bound.reduce((a,n)=>a*(2*n+1),1);
  if(count>maxCandidates)throw Error(`Too many magnetic hkl candidates (${count}); increase wavelength.`);
  const result=[];
  for(let h=-bound[0];h<=bound[0];h++)for(let k=-bound[1];k<=bound[1];k++)for(let z=-bound[2];z<=bound[2];z++){
    if(!(h||k||z))continue;
    const hkl=[h,k,z],q=norm(reciprocalVector(l,hkl));
    if(!(q>1e-9)||q>qMax+1e-8)continue;
    const theta2=2*Math.asin(Math.min(1,q*lambda/(4*Math.PI)))*180/Math.PI;
    if(theta2>twoThetaMax+1e-8)continue;
    const formFactor=(element,Q)=>magneticIonFormFactor(element,Q,ionByElement);
    const intensity=magneticStructureFactorSquared(motif,hkl,{formFactor});
    if(intensity>1e-12){
      const ff=magneticFormFactorDisplay(motif,q,ionByElement);
      result.push({hkl,q,d:twopi/q,twoTheta:theta2,intensity,formFactor:ff.display,formFactorSort:ff.sortValue});
    }
  }
  const max=Math.max(0,...result.map(r=>r.intensity));
  // 1e-6 of the strongest peak: rounded file coordinates (e.g. 0.33333) leave
  // ~1e-8 residues at systematically absent positions; drop them as zero.
  return result.filter(r=>r.intensity>Math.max(1e-12,max*1e-6)).sort((a,b)=>b.intensity-a.intensity);
}

// Parent indexing for the app's explicitly tagged commensurate supercell exports.
// Generic imported mCIF files may use different cell settings: never infer
// their parent basis from k alone.
export function parentIndexingFromMcif(text, magneticLattice, q){
  const src=String(text||'');
  const tag=(name)=>src.split(/\r?\n/).map(line=>line.trim()).find(line=>
    line.toLowerCase().startsWith(name.toLowerCase()+' '))?.slice(name.length).trim().replace(/^[\"']|[\"']$/g,'');
  // FullProf writes an empty transform_Pp_abc ''; treat ''/?/. as absent.
  const blank=v=>v===undefined||/^(?:|\?|\.)$/.test(String(v).trim())?undefined:v;
  const parent=blank(tag('_parent_space_group.transform_Pp_abc'));
  const child=blank(tag('_parent_space_group.child_transform_Pp_abc'));
  // k = 0: the magnetic structure has the periodicity of the nuclear one, so
  // the magnetic cell is the parent cell unless a transform says otherwise.
  const kZero=Array.isArray(q)&&q.length===3&&q.every(v=>Number.isFinite(Number(v))&&Math.abs(Number(v))<1e-12);
  if(kZero && parent===undefined && child===undefined){
    const lattice={...magneticLattice};
    if(['a','b','c'].every(key=>Number(lattice[key])>0))
      return {replication:[1,1,1],lattice,reference:'k = 0: magnetic cell = nuclear cell',kZero:true};
  }
  const hasParent=/_parent_space_group\.(?:IT_number|name_H-M_alt)/i.test(src);
  if(!hasParent)return null;
  const identity=/^a\s*,\s*b\s*,\s*c\s*;\s*0\s*,\s*0\s*,\s*0$/i;
  // Support an explicitly declared, zero-origin, orthogonal-index (diagonal)
  // parent-to-child supercell mapping. More general sheared/transposed mCIF
  // settings must use a full change-of-basis implementation: NEVER guess.
  if((parent===undefined || identity.test(parent)) && child){
    const pieces=child.split(';');
    if(pieces.length===2 && /^0\s*,\s*0\s*,\s*0$/.test(pieces[1].trim())){
      const coords=pieces[0].split(',').map(x=>x.trim());
      const axes=['a','b','c'];
      if(coords.length===3){
        const replication=coords.map((v,i)=>{
          const m=v.match(new RegExp('^(?:([1-9]\\d*)\\s*\\*?\\s*)?'+axes[i]+'$','i'));
          return m?Number(m[1]||1):NaN;
        });
        if(replication.every(n=>Number.isInteger(n)&&n>=1&&n<=128)){
          const lattice={...magneticLattice};
          for(const [i,key] of ['a','b','c'].entries())lattice[key]=Number(lattice[key])/replication[i];
          if(['a','b','c'].every(key=>Number.isFinite(lattice[key])&&lattice[key]>0))
            return {replication,lattice,reference:'explicit magCIF parent-child diagonal basis'};
        }
      }
    }
  }
  // An explicit but unsupported transformation must not be replaced by a
  // denominator-based guess even when an old generator marker is present.
  if(child || parent)return null;
  // This marker belongs exclusively to *our own* legacy exports and proves
  // their diagonal replication layout. The wavevector alone proves nothing.
  if(!/^# Commensurate magnetic supercell generated from user-entered moments\.\s*$/m.test(src))return null;
  if(!/_parent_propagation_vector\.kxkykz/i.test(src))return null;
  if(!Array.isArray(q)||q.length!==3)return null;
  let dims;
  try { dims=q.map(v=>rationalDenominator(v)); } catch {return null;}
  const lattice={...magneticLattice};
  for(const [i,key] of ['a','b','c'].entries()){
    const length=Number(lattice[key]);if(!(length>0))return null;
    lattice[key]=length/dims[i];
  }
  return {replication:dims,lattice,reference:'legacy app-generated magnetic supercell'};
}

export function hklInParentCell(magneticHkl,replication){
  return magneticHkl.map((v,i)=>Number(v)/Number(replication[i]));
}
