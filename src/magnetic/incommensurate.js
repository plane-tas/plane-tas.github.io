// Incommensurate (single-k) magnetic structures, Fcal-n style.
//
// Every magnetic atom j of the nuclear cell carries two moment vectors M1, M2
// (components along unit vectors parallel to a, b, c, in mu_B) and a phase
// phi_j. The moment of the atom at r = l + d_j (lattice vector l, fractional
// position d_j in the cell) is
//   M(r) = M1 cos(2 pi q.r - phi_j) + M2 sin(2 pi q.r - phi_j),
// with q the propagation vector in r.l.u. (used exactly as entered, never
// replaced by a fraction). No magnetic supercell is built: the magnetic
// scattering is calculated directly at the satellites H = G +/- q of the
// nuclear reciprocal lattice points G:
//   F(G + q) = sum_j (M1 + i M2)_j / 2 exp(+i phi_j) exp(2 pi i G.d_j)
//   F(G - q) = sum_j (M1 - i M2)_j / 2 exp(-i phi_j) exp(2 pi i G.d_j)
// times the occupancy, form factor and Debye-Waller factor of the atom.
// When 2q is a reciprocal lattice vector (e.g. q = 1/2) a satellite of each
// branch falls on the same point; their amplitudes are added coherently.
// An optional uniform moment M0 of a site (e.g. a conical structure read from
// an mCIF) scatters at G itself: F(G) = sum_j M0_j exp(2 pi i G.d_j).
// Intensities are |F_perp|^2 in barn per nuclear cell, directly comparable
// with the nuclear |F_N|^2. One magnetic domain (the entered q) is calculated.
import {MAGNETIC_BRAGG_CONSTANT_BARN, cartesianMoment, debyeWaller, latticeVectors,
  magneticFormFactorDisplay, magneticIonFormFactor, reciprocalBasis, reciprocalVector} from './magnetic-reflections.js';

const twopi=2*Math.PI;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=a=>Math.hypot(...a);
const wrap=v=>{const w=v-Math.floor(v);return w>1-1e-9?0:w;};

// Fourier components of an expanded mCIF atom (parseCifStructure:
// magneticFourier = {cos, sin, phaseSign s, phaseShift t, transformR, transformFactor})
//   M(r) = T [Mcos cos 2pi(s k.r + t) + Msin sin 2pi(s k.r + t)] + M0
// in the form M1 cos(2pi k.r - phi) + M2 sin(2pi k.r - phi) + M0:
//   M1 = T Mcos,  M2 = s T Msin,  phi = -s 360 t (degrees)   (crystal-axis components).
export function incommensurateSettingFromMcifAtom(atom){
  const f=atom?.magneticFourier, m0=Array.isArray(atom?.magneticMoment)?atom.magneticMoment.map(v=>Number(v)||0):[0,0,0];
  if(!f) return {m1:[0,0,0],m2:[0,0,0],m0,phase:0};
  const factor=Number.isFinite(Number(f.transformFactor))?Number(f.transformFactor):1;
  const apply=v=>Array.isArray(f.transformR)
    ? f.transformR.map(row=>factor*row.reduce((sum,x,j)=>sum+x*(Number(v[j])||0),0))
    : (v||[0,0,0]).map(x=>Number(x)||0);
  const s=Number(f.phaseSign)<0?-1:1, t=Number(f.phaseShift)||0;
  const clean=v=>v.map(x=>Math.abs(x)<1e-12?0:x);
  const phase=((-s*360*t)%360+360)%360;
  return {m1:clean(apply(f.cos||[0,0,0])),m2:clean(apply(f.sin||[0,0,0]).map(v=>s*v)),m0,phase:Math.abs(phase-360)<1e-9?0:phase};
}

// Moment (Cartesian, mu_B) of a site of an incommensurate model at the full
// fractional position r (including the lattice translation).
export function incommensurateMomentAt(site,q,r){
  const x=twopi*dot(q,r)-(Number(site.phase)||0);
  const c=Math.cos(x), s=Math.sin(x);
  return site.m1.map((v,i)=>v*c+site.m2[i]*s+(site.m0?.[i]||0));
}

// Model from per-atom settings {m1:[a,b,c], m2:[a,b,c], phase:deg} (crystal-axis
// components). atoms: the nuclear-cell atoms (fractional x, y, z).
export function buildIncommensurateModel({lattice,atoms,q,settingFor}){
  if(!Array.isArray(q) || q.length!==3 || !q.every(Number.isFinite)) throw Error('Invalid propagation vector.');
  latticeVectors(lattice);
  const sites=[];
  // Every atom is kept (nonmagnetic ones with zero moments): the composition
  // of the cell is used to choose the magnetic ions (charge balance).
  for(const atom of atoms||[]){
    const s=settingFor(atom)||{};
    const on=!!s.enabled;
    const m1c=on?(s.m1||[0,0,0]).map(v=>Number(v)||0):[0,0,0], m2c=on?(s.m2||[0,0,0]).map(v=>Number(v)||0):[0,0,0];
    const m0c=on?(s.m0||[0,0,0]).map(v=>Number(v)||0):[0,0,0];
    const m1=cartesianMoment(m1c,lattice), m2=cartesianMoment(m2c,lattice), m0=cartesianMoment(m0c,lattice);
    sites.push({element:atom.element,occupancy:Number(atom.occupancy??1),
      Biso:Number(atom.Biso)||0,Uaniso:atom.Uaniso||null,
      fract:[atom.x,atom.y,atom.z].map(v=>wrap(Number(v))),
      m1,m2,m0,m1Crystal:m1c,m2Crystal:m2c,phase:(Number(s.phase)||0)*Math.PI/180,
      // Representative moment: marks the site as magnetic (form-factor selectors).
      moment:[m1,m2,m0].reduce((a,b)=>norm(b)>norm(a)?b:a),sourceLabel:atom.sourceLabel});
  }
  return {lattice,sites,q:q.slice(),replication:[1,1,1],parentReplication:[1,1,1],
    incommensurate:true,source:'CIF + incommensurate k',ambiguousSites:0};
}

// Satellites G +/- q within 2theta_max. Rows {hkl, G, branch, satellite, q, d,
// twoTheta, intensity (barn per nuclear cell), formFactor, formFactorSort}.
export function incommensurateSatellites(model,wavelength,{twoThetaMax=180,ionByElement={},maxCandidates=350000}={}){
  const lambda=Number(wavelength);if(!(lambda>0))throw Error('Wavelength must be positive.');
  const qv=model.q, l=model.lattice;
  const qMax=4*Math.PI/lambda;
  const qLen=norm(reciprocalVector(l,qv));
  const bound=[l.a,l.b,l.c].map((x,i)=>Math.ceil((qMax+qLen)*Number(x)/twopi)+2+Math.ceil(Math.abs(qv[i])));
  const count=bound.reduce((a,n)=>a*(2*n+1),1)*2;
  if(count>maxCandidates)throw Error(`Too many magnetic satellite candidates (${count}); increase wavelength.`);
  const rlen=reciprocalBasis(l).map(v=>norm(v)/twopi);
  const formFactor=(element,Q)=>magneticIonFormFactor(element,Q,ionByElement);
  const key=h=>h.map(v=>{const x=Number(v.toFixed(6));return Object.is(x,-0)?0:x;}).join(',');
  const acc=new Map();
  const uniform=model.sites.some(s=>s.m0 && norm(s.m0)>1e-12);
  const magneticSites=model.sites.filter(s=>norm(s.m1)>1e-12||norm(s.m2)>1e-12||(s.m0&&norm(s.m0)>1e-12));
  for(let h=-bound[0];h<=bound[0];h++)for(let k=-bound[1];k<=bound[1];k++)for(let z=-bound[2];z<=bound[2];z++){
    const G=[h,k,z];
    for(const branch of uniform?[1,-1,0]:[1,-1]){
      const H=G.map((g,i)=>g+branch*qv[i]);
      const Q=reciprocalVector(l,H), q=norm(Q);
      if(!(q>1e-9) || q>qMax+1e-8) continue;
      let entry=acc.get(key(H));
      if(!entry){ entry={hkl:H,Q,q,re:[0,0,0],im:[0,0,0],parts:[]}; acc.set(key(H),entry); }
      entry.parts.push({G,branch});
      for(const s of magneticSites){
        if(branch===0){
          // Uniform moment M0 at G.
          if(!s.m0 || norm(s.m0)<1e-12) continue;
          const amp0=(s.occupancy??1)*Number(formFactor(s.element,q))*debyeWaller(s,H,q,rlen);
          const a0=twopi*dot(G,s.fract), c0=Math.cos(a0), s0=Math.sin(a0);
          for(let i=0;i<3;i++){ entry.re[i]+=amp0*s.m0[i]*c0; entry.im[i]+=amp0*s.m0[i]*s0; }
          continue;
        }
        const amp=(s.occupancy??1)*Number(formFactor(s.element,q))*debyeWaller(s,H,q,rlen)/2;
        // (M1 + i*branch*M2) exp(i*branch*phi) exp(2 pi i G.d)
        const a=branch*s.phase+twopi*dot(G,s.fract), c=Math.cos(a), sn=Math.sin(a);
        for(let i=0;i<3;i++){
          const vr=s.m1[i], vi=branch*s.m2[i];
          entry.re[i]+=amp*(vr*c-vi*sn);
          entry.im[i]+=amp*(vr*sn+vi*c);
        }
      }
    }
  }
  const result=[];
  for(const e of acc.values()){
    const n=e.Q.map(x=>x/e.q);
    const perp=v=>{const d=dot(v,n);return v.map((x,i)=>x-d*n[i]);};
    const re=perp(e.re), im=perp(e.im);
    const intensity=MAGNETIC_BRAGG_CONSTANT_BARN*(dot(re,re)+dot(im,im));
    if(!(intensity>1e-12)) continue;
    const theta2=2*Math.asin(Math.min(1,e.q*lambda/(4*Math.PI)))*180/Math.PI;
    if(theta2>twoThetaMax+1e-8) continue;
    const ff=magneticFormFactorDisplay(model,e.q,ionByElement);
    const label=e.parts.map(({G,branch})=>branch ? `(${G.join(' ')})${branch>0?'+k':'−k'}` : `uniform moment M0 at (${G.join(' ')})`).join(' = ');
    result.push({hkl:e.hkl,satellite:label,q:e.q,d:twopi/e.q,twoTheta:theta2,intensity,formFactor:ff.display,formFactorSort:ff.sortValue});
  }
  const max=Math.max(0,...result.map(r=>r.intensity));
  return result.filter(r=>r.intensity>Math.max(1e-12,max*1e-6)).sort((a,b)=>b.intensity-a.intensity);
}
