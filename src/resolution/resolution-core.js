import {
  zeros, transpose, add, sub, matmul, matvec, diag, blockDiag, inverse,
  solve, submatrix, swapRowsCols, symmetrize, choleskyPositiveDefinite,
  det3, dot, norm, cross, normalize, eigSym2, logAbsDet
} from '../core/matrix.js';
import {OUT_OF_PLANE_TOLERANCE_DEG, RL_calc, UB_calc} from '../core/tas-core.js';

const PI=Math.PI;
const D2R=PI/180;
const R2D=180/PI;
const GAUSS_SIGMA_FROM_FWHM=0.4246609;
const E2K2=2.072;
const E2K2_RES=2.072142;

const sind=d=>Math.sin(d*D2R), cosd=d=>Math.cos(d*D2R), tand=d=>Math.tan(d*D2R);
const asind=x=>Math.asin(x)*R2D, acosd=x=>Math.acos(x)*R2D, atand=x=>Math.atan(x)*R2D;

// Reciprocal lattice and UB: the same routines as the angle calculation
// (src/core/tas-core.js), so the two can never disagree.
export {RL_calc};

function gcdInt(a,b){
  a=Math.abs(Math.trunc(a)); b=Math.abs(Math.trunc(b));
  while(b){ const t=a%b; a=b; b=t; }
  return a||1;
}

function compactDirectionHKL(v){
  const s=Math.max(...v.map(x=>Math.abs(x)));
  if(!(s>1e-12)) throw new Error('Cannot normalize a zero reciprocal-space direction.');
  const w=v.map(x=>Math.abs(x/s)<1e-12?0:x/s);

  // Prefer a compact integer representation for simple rational directions.
  // IMPORTANT: do not flip the sign. The direction inherited from the
  // original V is preserved so that (U, V_perp, W) keeps the same handedness.
  for(let d=1;d<=24;d++){
    const z=w.map(x=>Math.round(x*d));
    if(w.every((x,i)=>Math.abs(x*d-z[i])<1e-9)){
      let g=0;
      for(const x of z){
        if(x!==0) g=g===0?Math.abs(x):gcdInt(g,x);
      }
      return z.map(x=>x/(g||1));
    }
  }

  return w.map(x=>Math.abs(x)<1e-12?0:Number(x.toPrecision(8)));
}

export function inferOrthogonalInPlaneHKL(rl, sv1, sv2){
  const U=sv1.map(Number), V=sv2.map(Number);
  if(norm(U)<1e-12) throw new Error('U must not be zero.');
  if(norm(V)<1e-12) throw new Error('V must not be zero.');

  const G=[
    [rl.astar[0], rl.bstar[0], rl.cstar[0]],
    [rl.astar[1], rl.bstar[1], rl.cstar[1]],
    [rl.astar[2], rl.bstar[2], rl.cstar[2]],
  ];

  const qU=matvec(G,U);
  const qV=matvec(G,V);
  if(norm(qU)<1e-12) throw new Error('U gives a zero reciprocal-space vector.');
  if(norm(qV)<1e-12) throw new Error('V gives a zero reciprocal-space vector.');

  // Gram-Schmidt in physical reciprocal Cartesian space.
  // The remaining component retains the direction of the user's original V.
  const uu=dot(qU,qU);
  let qVperp=qV.map((x,i)=>x-dot(qV,qU)/uu*qU[i]);
  if(norm(qVperp)<1e-12){
    throw new Error('U and V must define a non-degenerate scattering plane.');
  }

  // Keep the sign inherited from the entered V.  Do not canonicalize or
  // reflect the in-plane transverse direction: U/V order defines handedness.

  const vPerp=solve(G,qVperp);
  return compactDirectionHKL(vPerp);
}

export function inferOutOfPlaneHKL(rl, sv1, sv2){
  const U=sv1.map(Number), V=sv2.map(Number);
  if(norm(U)<1e-12) throw new Error('U must not be zero.');
  if(norm(V)<1e-12) throw new Error('V must not be zero.');

  // Reciprocal-lattice basis in Cartesian reciprocal space:
  //
  //     Q = h a* + k b* + l c*
  //
  // The physical out-of-plane direction is defined by Q_U x Q_V,
  // not by a simple cross product of the Miller-index triples.
  const G=[
    [rl.astar[0], rl.bstar[0], rl.cstar[0]],
    [rl.astar[1], rl.bstar[1], rl.cstar[1]],
    [rl.astar[2], rl.bstar[2], rl.cstar[2]],
  ];

  const qU=matvec(G,U);
  const qV=matvec(G,V);
  if(norm(qU)<1e-12) throw new Error('U gives a zero reciprocal-space vector.');
  if(norm(qV)<1e-12) throw new Error('V gives a zero reciprocal-space vector.');

  const qW=cross(qU,qV);
  if(norm(qW)<1e-12) throw new Error('U and V must define a non-degenerate scattering plane.');

  // Preserve the entered handedness: swapping U and V reverses W.
  // Express the physical U x V normal in reciprocal-lattice coordinates.
  let w=solve(G,qW);

  // HKL coefficients have an arbitrary common scale.  Use a deterministic
  // convention: the largest absolute coefficient is 1.
  const s=Math.max(...w.map(x=>Math.abs(x)));
  if(!(s>1e-12)) throw new Error('Failed to determine the out-of-plane direction.');
  w=w.map(x=>Math.abs(x/s)<1e-12?0:x/s);

  return w;
}

function qFromUB(UB,hkl){ return matvec(UB,hkl).map(x=>2*PI*x); }

function schur2(RM, keep){
  const all=[0,1,2,3], elim=all.filter(i=>!keep.includes(i));
  const M=submatrix(RM,keep,keep);
  if(elim.length===0) return M;
  const B=submatrix(RM,keep,elim), C=submatrix(RM,elim,elim);
  return sub(M,matmul(matmul(B,inverse(C)),transpose(B)));
}

function ellipsePoints(M2, scaleX=1, scaleY=1, n=181){
  const S=symmetrize(M2), {values,vectors}=eigSym2(S), c=2*Math.log(2);
  if(values.some(v=>v<=0)) throw new Error('Ellipse matrix is not positive definite.');
  const r=[Math.sqrt(c/values[0]),Math.sqrt(c/values[1])];
  const x=[],y=[];
  for(let i=0;i<n;i++){
    const t=2*PI*i/(n-1), local=[r[0]*Math.cos(t),r[1]*Math.sin(t)];
    const p=matvec(vectors,local); x.push(p[0]/scaleX); y.push(p[1]/scaleY);
  }
  return {x,y};
}

function findMaxAlongAxis(RM,idx){
  RM=symmetrize(RM);
  if(!choleskyPositiveDefinite(RM)) throw new Error('RM must be positive definite to define a bounded resolution ellipsoid.');
  const e=Array(RM.length).fill(0); e[idx]=1;
  const direction=solve(RM,e), a=direction[idx];
  if(!(a>0)) throw new Error('Failed to obtain a positive projected variance.');
  const c=2*Math.log(2);
  return {max:Math.sqrt(c*a), coords:direction.map(x=>Math.sqrt(c/a)*x)};
}
function coherentFwhm(RM,idx){
  const a=RM[idx][idx]; if(!(a>0)) throw new Error(`RM[${idx},${idx}] must be positive.`);
  return 2*Math.sqrt(2*Math.log(2)/a);
}
// FWHM (deg) of motor scans through a Bragg peak (a point in Q and ħω; the
// energies stay fixed): the section of the ellipsoid along the line each
// scan moves Q in the local frame (Q∥, Q⊥, E, Qout).
//   ω (S1, rocking): Q⊥ by |Q| per rad.
//   θ–2θ (S1 turning half of S2, in the sense that keeps an elastic scan
//     radial): S2 turns the kf direction, Q moving normal to kf by kf per rad
//     (the kf angle column of the TAS B matrix), and S1 adds Q⊥.
//   χ (4-circle): Qout by |Q| per rad.
function scanWidths(RM,angles,energies,fourCircle=false){
  try{
    const R=symmetrize(RM), ki=Math.sqrt(energies.Ei/E2K2), kf=Math.sqrt(energies.Ef/E2K2);
    const {phi,thetaS}=angles;
    const q=Math.sqrt(Math.max(0,ki*ki+kf*kf-2*ki*kf*cosd(2*thetaS)));
    const fwhm=u=>{
      const v=[u[0],u[1],0,u[2]], Rv=matvec(R,v), a=v.reduce((s,x,i)=>s+x*Rv[i],0);
      return a>0 ? 2*Math.sqrt(2*Math.log(2)/a)*R2D : null;
    };
    const b0=-sind(phi-2*thetaS), b1=-cosd(phi-2*thetaS), sense=-(Math.sign(b1)||1);
    const tt=fwhm([kf*b0,kf*b1+sense*q/2,0]);
    return {omega:fwhm([0,q,0]),
      thetaTwoTheta:tt===null ? null : {S1:tt/2,S2:tt},
      chi:fourCircle ? fwhm([0,0,q]) : null};
  }catch(_e){ return null; }
}
function rot4(theta,tilt=0){
  const ct=Math.cos(theta), st=Math.sin(theta), cp=Math.cos(tilt), sp=Math.sin(tilt);
  const Rt=[[ct,-st,0,0],[st,ct,0,0],[0,0,1,0],[0,0,0,1]];
  const Rp=[[cp,0,0,-sp],[0,1,0,0],[0,0,1,0],[sp,0,0,cp]];
  return matmul(Rp,Rt);
}

export function calcResolution(lc,rl,col,mos,config,approximation,focusing,geom,calc,unitMode='rlu',{fourCircle=false}={}){
  const gm1=!!col.gm_1st;
  // 3rd horizontal collimator: Soller (entered value) or radial (the angular
  // size of the analyzer seen from the sample).
  const radial3=!!col.radial_3rd;
  const div1h=col.div_1st_h, div1v=col.div_1st_v;
  const div1m=col.div_1st_m;
  const {div_2nd_h:div2h,div_2nd_v:div2v,div_3rd_h:div3h,div_3rd_v:div3v,div_4th_h:div4h,div_4th_v:div4v}=col;
  const MHF=!!focusing.monochromator.horizontal.enabled, MVF=!!focusing.monochromator.vertical.enabled;
  const AHF=!!focusing.analyzer.horizontal.enabled, AVF=!!focusing.analyzer.vertical.enabled;
  const numMh=focusing.monochromator.horizontal.blades, numMv=focusing.monochromator.vertical.blades;
  const numAh=focusing.analyzer.horizontal.blades, numAv=focusing.analyzer.vertical.blades;
  const {L0,L1,L2,L3,beam_width,beam_height,mono_width,mono_height,mono_thickness,ana_width,ana_height,ana_thickness,det_width,det_height}=geom;
  const {d_mono,mos_mono_h,mos_mono_v,mos_sam_h,mos_sam_v,d_ana,mos_ana_h,mos_ana_v}=mos;
  const energyMode=config.energy_mode, sense=config.sign_config, method=approximation.method;
  let Ei=energyMode==='Ei fixed' ? config.Ei : config.Ef+calc.hw;
  let Ef=energyMode==='Ei fixed' ? config.Ei-calc.hw : config.Ef;
  if(!(Ei>0&&Ef>0)) throw new Error(`Ei and Ef must be positive. Ei=${Ei}, Ef=${Ef}`);

  const ub=UB_calc(lc,rl), UB=ub.UB;
  if(det3(ub.U)<=0) throw new Error('Orientation matrix U is not right handed.');
  const hkl=[calc.h,calc.k,calc.l], qRaw=qFromUB(UB,hkl), qnorm=norm(qRaw);
  if(qnorm<1e-12) throw new Error('Q = 0 cannot define the local TAS resolution coordinate system.');
  // A Q slightly out of the U-V plane (within OUT_OF_PLANE_TOLERANCE_DEG) is
  // reached by tilting the sample: rotate it into the plane, keeping |Q|.
  // 4-circle: chi and phi bring any Q into the scattering plane; the sample
  // (Popovici shape) is taken along the in-plane direction of Q (U when Q is
  // along W).
  const qInPlane=Math.hypot(qRaw[0],qRaw[1]);
  const tiltDeg=Math.atan2(Math.abs(qRaw[2]),qInPlane)/D2R;
  if(!fourCircle && tiltDeg>OUT_OF_PLANE_TOLERANCE_DEG+1e-9) throw new Error(`Q is ${tiltDeg.toFixed(2)}° out of the U–V plane (tolerance ${OUT_OF_PLANE_TOLERANCE_DEG}°).`);
  const Qsample=!(tiltDeg>0) ? qRaw : qInPlane>1e-9*qnorm ? [qRaw[0]*qnorm/qInPlane,qRaw[1]*qnorm/qInPlane,0] : [qnorm,0,0];
  const kiCal=Math.sqrt(Ei/E2K2), kfCal=Math.sqrt(Ef/E2K2);
  let cosPhi=(kiCal*kiCal+kfCal*kfCal-qnorm*qnorm)/(2*kiCal*kfCal);
  if(cosPhi < -1-1e-10 || cosPhi > 1+1e-10) throw new Error('The requested Q and ħω are kinematically inaccessible.');
  cosPhi=Math.max(-1,Math.min(1,cosPhi));
  const phiCal=acosd(cosPhi);
  const monoArg=(2*PI/d_mono)/(2*kiCal), anaArg=(2*PI/d_ana)/(2*kfCal);
  if(Math.abs(monoArg)>1 || Math.abs(anaArg)>1) throw new Error('Monochromator/analyzer Bragg condition is inaccessible for the selected energy.');
  let C1abs=asind(monoArg), C3abs=asind(anaArg);
  // Scattering signs of monochromator, sample and analyzer, from the Sense.
  if(!/^[+-]{3}$/.test(String(sense))) throw new Error(`Unsupported TAS sign configuration: ${sense}`);
  const [sm,ss,sa]=[...String(sense)].map(c=>c==='-' ? -1 : +1);
  const A1=sm*2*C1abs, A2=ss*phiCal, A3=sa*2*C3abs;
  const thetaM=A1/2, thetaS=A2/2, thetaA=A3/2;
  const ki=Math.sqrt(Ei/E2K2), kf=Math.sqrt(Ef/E2K2);
  const Q=Math.sqrt(ki*ki+kf*kf-2*ki*kf*cosd(A2));
  const phi=Math.atan2(-kf*sind(2*thetaS),ki-kf*cosd(2*thetaS))*R2D;

  // A blank (or non-positive) collimator entry means "no Soller collimator".
  //  - Popovici: no collimator at all (G entry 0); the divergence is limited
  //    only by the component sizes already in the shape matrices.
  //  - Cooper-Nathans (no component sizes): the geometric divergence of the
  //    two components it connects.  Two apertures a and b at distance L pass a
  //    trapezoidal angular profile (uniform a/L convolved with uniform b/L),
  //    used with the same variance: sigma^2 = ((a/L)^2 + (b/L)^2)/12.
  //    a, b are widths (horizontal; crystals projected by |sin(theta)|) or
  //    heights (vertical).
  const isOpen=v=>!(Number(v)>0)||!Number.isFinite(Number(v));
  const toSigma=arcmin=>arcmin/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const sinM=Math.abs(sind(A1/2)), sinA=Math.abs(sind(A3/2));
  const sD=geom.sample_shape==='box'
    ? Math.max(Number(geom.sample_u)>0?Number(geom.sample_u):0.01, Number(geom.sample_v)>0?Number(geom.sample_v):0.01)
    : (Number(geom.sample_diameter)>0 ? Number(geom.sample_diameter) : 0.01);
  const sH=Number(geom.sample_height)>0 ? Number(geom.sample_height) : 0.02;
  const mW=numMh*mono_width*sinM, mH=numMv*mono_height, aW=numAh*ana_width*sinA, aH=numAv*ana_height;
  const geomSigma=(a,b,L)=>{
    const ta=2*Math.atan(a/(2*L)), tb=2*Math.atan(b/(2*L));
    return Math.sqrt((ta*ta+tb*tb)/12);
  };
  const geomDiv={
    h1:geomSigma(beam_width,mW,L0), v1:geomSigma(beam_height,mH,L0),
    h2:geomSigma(mW,sD,L1), v2:geomSigma(mH,sH,L1),
    h3:geomSigma(sD,aW,L2), v3:geomSigma(sH,aH,L2),
    h4:geomSigma(aW,det_width,L3), v4:geomSigma(aH,det_height,L3)
  };
  const openSlot={};
  const collSigma=(v,key)=>{ if(isOpen(v)){ openSlot[key]=true; return geomDiv[key]; } return toSigma(v); };

  let alpha1,beta1;
  if(!gm1){ alpha1=collSigma(div1h,'h1'); beta1=collSigma(div1v,'v1'); }
  else {
    const NA=6.022e23, ro=8.908, MNi=58.69, bc=1.03e-12, lambda=Math.sqrt(81.81/Ei)*1e-8;
    const val=lambda*Math.sqrt(NA*ro/MNi*bc/PI);
    if(Math.abs(val)>1) throw new Error('Supermirror divergence expression is outside arcsin domain.');
    // A guide (supermirror, m-value) transmits a roughly rectangular angular
    // profile of full width 2*m*theta_c; its standard deviation is
    // m*theta_c/sqrt(3).  theta_c is the
    // natural-Ni critical angle at this wavelength (about 0.1 deg per A).
    const thetaC=Math.asin(val);
    alpha1=div1m*thetaC/Math.sqrt(3); beta1=alpha1;
  }
  const alpha2=collSigma(div2h,'h2');
  let alpha3;
  // Radial 3rd collimator (default with a horizontally focusing analyzer):
  // the divergence is the angular size of the analyzer seen from the sample.
  // The beam meets the analyzer face at the Bragg angle thetaA, so the
  // projected width is W*|sin(thetaA)| (A3 = 2*thetaA).  The uniform angular
  // profile enters with its variance: equivalent Gaussian FWHM = af*sqrt(8 ln2/12).
  let radial3FwhmArcmin=null;
  if(radial3){ const W=ana_width*numAh*Math.abs(sind(A3/2)), af=2*atand((W/2)/L2); alpha3=af/180*PI*GAUSS_SIGMA_FROM_FWHM*Math.sqrt(8*Math.log(2)/12); radial3FwhmArcmin=af*60*Math.sqrt(8*Math.log(2)/12); }
  else alpha3=collSigma(div3h,'h3');
  const alpha4=collSigma(div4h,'h4');
  const beta2=collSigma(div2v,'v2'), beta3=collSigma(div3v,'v3'), beta4=collSigma(div4v,'v4');
  const etaM=mos_mono_h/60/180*PI*GAUSS_SIGMA_FROM_FWHM, etaMp=mos_mono_v/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const etaA=mos_ana_h/60/180*PI*GAUSS_SIGMA_FROM_FWHM, etaAp=mos_ana_v/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const etaS=mos_sam_h/60/180*PI*GAUSS_SIGMA_FROM_FWHM, etaSp=mos_sam_v/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const positive=[alpha1,alpha2,beta1,beta2,alpha3,alpha4,beta3,beta4,etaM,etaMp,etaA,etaAp];
  if(positive.some(x=>!Number.isFinite(x)||Math.abs(x)<1e-15)) throw new Error('Collimation and crystal mosaic values must be non-zero for the resolution calculation.');

  const G=diag([alpha1,alpha2,beta1,beta2,alpha3,alpha4,beta3,beta4].map(x=>1/(x*x)));
  // Popovici: a blank slot transmits everything (no Soller collimator).  The
  // supermirror (1st) and the focusing-analyzer acceptance (3rd) are kept.
  const slotKeys=['h1','h2','v1','v2','h3','h4','v3','v4'];
  const Gpop=diag([alpha1,alpha2,beta1,beta2,alpha3,alpha4,beta3,beta4].map((x,i)=>{
    const key=slotKeys[i];
    const replaced=(gm1&&(key==='h1'||key==='v1'))||(radial3&&key==='h3');
    return (openSlot[key]&&!replaced) ? 0 : 1/(x*x);
  }));
  const F=diag([etaM,etaMp,etaA,etaAp].map(x=>1/(x*x)));
  const A=zeros(6,8), C=zeros(4,8), B=zeros(4,6);
  A[0][0]=ki/(2*tand(thetaM)); A[0][1]=-A[0][0]; A[3][4]=kf/(2*tand(thetaA)); A[3][5]=-A[3][4];
  A[1][1]=ki; A[2][3]=ki; A[4][4]=kf; A[5][6]=kf;
  B[0][0]=cosd(phi); B[0][1]=sind(phi); B[0][3]=-cosd(phi-2*thetaS); B[0][4]=-sind(phi-2*thetaS);
  B[1][0]=-B[0][1]; B[1][1]=B[0][0]; B[1][3]=-B[0][4]; B[1][4]=B[0][3]; B[2][2]=1; B[2][5]=-1;
  B[3][0]=2*E2K2_RES*ki; B[3][3]=-2*E2K2_RES*kf;
  C[0][0]=0.5; C[0][1]=0.5; C[2][4]=0.5; C[2][5]=0.5;
  C[1][2]=1/(2*sind(thetaM)); C[1][3]=-C[1][2]; C[3][6]=1/(2*sind(thetaA)); C[3][7]=-C[3][6];

  const term=inverse(add(G,matmul(matmul(transpose(C),F),C)));
  const HF=matmul(matmul(A,term),transpose(A));
  let Minv, lnH=null, lnHmon=null;
  if(method==='Popovici'){
    // Shape matrices hold second moments <x^2> of uniform distributions
    // (Popovici 1975, App. 3), all in metres:
    // a full rectangular size A gives A^2/12, a circular cross section of
    // diameter D gives D^2/16 (sqrt<x^2> = D/4).
    const rect=a=>a*a/12, circ=d=>d*d/16;
    const bshape=geom.beam_shape==='circle'
      ? diag([circ(beam_width),circ(beam_height)])
      : diag([rect(beam_width),rect(beam_height)]);
    const mshape=diag([rect(mono_thickness),rect(numMh*mono_width),rect(numMv*mono_height)]);
    const sampleD=Number(geom.sample_diameter)>0 ? Number(geom.sample_diameter) : 0.01;
    const sampleH=Number(geom.sample_height)>0 ? Number(geom.sample_height) : 0.02;
    const psi=thetaS-phi, rot=[[cosd(psi),sind(psi),0],[-sind(psi),cosd(psi),0],[0,0,1]];
    // Sample shape in the local resolution frame (x || Q, y in plane, z up),
    // the same frame as the resolution matrix RM.
    //   cylinder: diameter d, height h      -> diag(d^2/16, d^2/16, h^2/12)
    //   box: edge lengths along U and along the in-plane direction
    //        perpendicular to U (V side), height h; each edge a gives a^2/12
    //        along its own direction, rotated into the Q frame.
    let sampleLocal;
    if(geom.sample_shape==='box'){
      // 0.1 mm floor keeps the shape matrix invertible for very thin plates.
      const Lu=Number(geom.sample_u)>0 ? Math.max(Number(geom.sample_u),1e-4) : 0.01;
      const Lv=Number(geom.sample_v)>0 ? Math.max(Number(geom.sample_v),1e-4) : 0.01;
      const qOutS=Qsample[2], qPlane=[Qsample[0],Qsample[1],0];
      if(Math.abs(qOutS)>1e-8*Math.max(qnorm,1)) throw new Error('Q is out of the U–V plane.');
      const ex=normalize(qPlane), ey=normalize(cross([0,0,1],ex));
      const uS=normalize(qFromUB(UB,lc.sv1));
      const vS=normalize(qFromUB(UB,inferOrthogonalInPlaneHKL(rl,lc.sv1,lc.sv2)));
      const cu=[dot(uS,ex),dot(uS,ey)], cv=[dot(vS,ex),dot(vS,ey)];
      const a=rect(Lu), b=rect(Lv);
      const sxx=a*cu[0]*cu[0]+b*cv[0]*cv[0], syy=a*cu[1]*cu[1]+b*cv[1]*cv[1], sxy=a*cu[0]*cu[1]+b*cv[0]*cv[1];
      sampleLocal=[[sxx,sxy,0],[sxy,syy,0],[0,0,rect(sampleH)]];
    } else sampleLocal=diag([circ(sampleD),circ(sampleD),rect(sampleH)]);
    // Q frame -> Popovici sample frame: S' = R^T S R (as ResMat; irrelevant
    // for an isotropic cylinder, essential for a box).
    const sshape=matmul(matmul(transpose(rot),sampleLocal),rot);
    const ashape=diag([rect(ana_thickness),rect(numAh*ana_width),rect(numAv*ana_height)]);
    // Detector: rectangle (width x height) or vertical cylinder (diameter x height).
    const dshape=geom.det_shape==='rectangle'
      ? diag([rect(det_width),rect(det_height)])
      : diag([circ(det_width),rect(det_height)]);
    const S=inverse(blockDiag(bshape,mshape,sshape,ashape,dshape));
    const f=(Lx,Ly)=>1/(1/Lx+1/Ly);
    // Focusing radii carry the sign of sin(theta): T contains 2/(rho*sin(theta))
    // and 2*sin(theta)/rho', which must equal +(1/Lx+1/Ly) for focusing in both
    // scattering senses.  With |sin| the -+- (and anti-W analyzer) branches were
    // defocused instead of focused.
    const Vcurv=(Lx,Ly,th)=>2*f(Lx,Ly)*sind(th);
    const Hcurv=(Lx,Ly,th)=>2*f(Lx,Ly)/sind(th);
    const monorv=MVF?Vcurv(L0,L1,thetaM):1e10, monorh=MHF?Hcurv(L0,L1,thetaM):1e10;
    const anarv=AVF?Vcurv(L2,L3,thetaA):1e10, anarh=AHF?Hcurv(L2,L3,thetaA):1e10;
    const T=zeros(4,13), D=zeros(8,13);
    T[0][0]=-1/(2*L0); T[0][2]=cosd(thetaM)*(1/L1-1/L0)/2; T[0][3]=sind(thetaM)*(1/L0+1/L1-2/(monorh*sind(thetaM)))/2; T[0][5]=sind(thetaS)/(2*L1); T[0][6]=cosd(thetaS)/(2*L1);
    T[1][1]=-1/(2*L0*sind(thetaM)); T[1][4]=(1/L0+1/L1-2*sind(thetaM)/monorv)/(2*sind(thetaM)); T[1][7]=-1/(2*L1*sind(thetaM));
    T[2][5]=sind(thetaS)/(2*L2); T[2][6]=-cosd(thetaS)/(2*L2); T[2][8]=cosd(thetaA)*(1/L3-1/L2)/2; T[2][9]=sind(thetaA)*(1/L2+1/L3-2/(anarh*sind(thetaA)))/2; T[2][11]=1/(2*L3);
    T[3][7]=-1/(2*L2*sind(thetaA)); T[3][10]=(1/L2+1/L3-2*sind(thetaA)/anarv)/(2*sind(thetaA)); T[3][12]=-1/(2*L3*sind(thetaA));
    D[0][0]=-1/L0; D[0][2]=-cosd(thetaM)/L0; D[0][3]=sind(thetaM)/L0; D[2][1]=D[0][0]; D[2][4]=-D[0][0];
    D[1][2]=cosd(thetaM)/L1; D[1][3]=sind(thetaM)/L1; D[1][5]=sind(thetaS)/L1; D[1][6]=cosd(thetaS)/L1;
    D[3][4]=-1/L1; D[3][7]=-D[3][4]; D[4][5]=sind(thetaS)/L2; D[4][6]=-cosd(thetaS)/L2; D[4][8]=-cosd(thetaA)/L2; D[4][9]=sind(thetaA)/L2;
    D[6][7]=-1/L2; D[6][10]=-D[6][7]; D[5][8]=cosd(thetaA)/L3; D[5][9]=sind(thetaA)/L3; D[5][11]=1/L3; D[7][10]=-D[5][11]; D[7][12]=D[5][11];
    const STFT=add(S,matmul(matmul(transpose(T),F),T));
    const core1=matmul(matmul(D,inverse(STFT)),transpose(D));
    const core2=add(inverse(core1),Gpop);
    const inner=inverse(core2);
    Minv=matmul(matmul(matmul(matmul(B,A),inner),transpose(A)),transpose(B));
    // Popovici parts of R0 and Rmon (see the prefactor below).  The monitor
    // is half way between monochromator and sample and large enough to take
    // the whole incident beam (1 m x 1 m; its size then no longer matters).
    try{
      const Lm=L1/2, f2=submatrix(F,[0,1],[0,1]), i4=[0,1,2,3];
      const t=zeros(2,7), d=zeros(4,7);
      t[0][0]=-1/(2*L0); t[0][2]=cosd(thetaM)*(1/Lm-1/L0)/2; t[0][3]=sind(thetaM)*(1/L0+1/Lm-2/(monorh*sind(thetaM)))/2; t[0][6]=1/(2*Lm);
      t[1][1]=-1/(2*L0*sind(thetaM)); t[1][4]=(1/L0+1/Lm-2*sind(thetaM)/monorv)/(2*sind(thetaM));
      d[0][0]=-1/L0; d[0][2]=-cosd(thetaM)/L0; d[0][3]=sind(thetaM)/L0; d[2][1]=-1/L0; d[2][4]=1/L0;
      d[1][2]=cosd(thetaM)/Lm; d[1][3]=sind(thetaM)/Lm; d[1][6]=1/Lm; d[3][4]=-1/Lm;
      const s=inverse(blockDiag(bshape,mshape,diag([rect(1),rect(1)])));
      const hMon=add(inverse(matmul(matmul(d,inverse(add(s,matmul(matmul(transpose(t),f2),t)))),transpose(d))),submatrix(Gpop,i4,i4));
      lnH=logAbsDet(core2); lnHmon=logAbsDet(hMon);
    }catch(_e){ lnH=NaN; }
  } else if(method==='Cooper-Nathans'){
    if(AHF){
      const P=inverse(HF); P[4][4]=(1/(kf*alpha3))**2; P[3][4]=0; P[3][3]=(tand(thetaA)/(etaA*kf))**2; P[4][3]=0;
      Minv=matmul(matmul(B,inverse(P)),transpose(B));
    } else Minv=matmul(matmul(B,HF),transpose(B));
  } else throw new Error(`Unknown approximation: ${method}`);

  // Intensity prefactor, normalised to monitor counts: R0/Rmon with
  //   R0   = (kf/ki) pi^2 (ki^3 cot thetaM)(kf^3 cot thetaA)/(4 sin thetaM sin thetaA)
  //          * sqrt(det F / det H) * (2pi)^-2 sqrt(det M)       (source flux)
  //   Rmon = (1/ki) pi (ki^3 cot thetaM)/(2 sin thetaM) * sqrt(det f / det Hmon)
  //   H = G + C'FC, Hmon = g + c'fc (Cooper-Nathans);
  //   H = [D(S+T'FT)^-1 D']^-1 + G, Hmon = [d(s+t'ft)^-1 d']^-1 + g (Popovici).
  // The convolution uses the resolution function normalised to unit volume,
  // so the prefactor is R0/Rmon (2pi)^2/sqrt(det M); ki^3 cot(thetaM) cancels:
  //   prefactor = kf (kf^3 cot thetaA) pi/(2 sin thetaA) sqrt(det F det Hmon / (det H det f)).
  // G, F and S hold standard deviations (FWHM converted), as do the
  // determinants; with FWHM values R0/Rmon would be 8 ln2 larger.
  let prefactor=null;
  try{
    const i4=[0,1,2,3], f2=submatrix(F,[0,1],[0,1]), c2=submatrix(C,[0,1],i4);
    if(method!=='Popovici'){
      lnH=logAbsDet(add(G,matmul(matmul(transpose(C),F),C)));
      lnHmon=logAbsDet(add(submatrix(G,i4,i4),matmul(matmul(transpose(c2),f2),c2)));
    }
    const lr=(logAbsDet(F)-lnH-logAbsDet(f2)+lnHmon)/2;
    const Ra=kf*kf*kf/Math.abs(tand(thetaA));
    const v=Ra*PI/(2*Math.abs(sind(thetaA)))*Math.exp(lr)*kf;
    prefactor=Number.isFinite(v) ? v : null;
  }catch(_e){ prefactor=null; }

  let RM=swapRowsCols(inverse(Minv),[0,1,3,2]);
  let RMinv=inverse(RM); RMinv[1][1]+=Q*Q*etaS*etaS; RMinv[3][3]+=Q*Q*etaSp*etaSp; RM=inverse(RMinv);

  if(fourCircle){
    // 4-circle with the analyzer: a diffractometer whose analyzer only sets
    // the energy window.  Every measurement is at ħω = 0, so the Q
    // resolution is the ΔE = 0 section of the 4D ellipsoid: the E row and
    // column are dropped (an uncoupled placeholder, as for a 2-axis), and the
    // result is shown as a diffraction one (Q only).  The scans use the full
    // matrix (the same section).
    const S=symmetrize(RM), RMsec=S.map((row,i)=>row.map((x,j)=>i===2||j===2 ? (i===j ? 1 : 0) : x));
    return {...fourCircleFrames(RMsec,lc,rl,UB,qRaw,hkl,unitMode),
      fourCircle:true, analyzer:true, diffraction:true,
      scans:scanWidths(RM,{thetaS,phi},{Ei,Ef},true),
      angles:{A1,A2,A3,thetaM,thetaS,thetaA,phi}, energies:{Ei,Ef}, UB,
      collimation3:{radial:radial3,fwhmArcmin:radial3FwhmArcmin}, prefactor};
  }
  return {...resolutionFrames(RM,lc,rl,UB,Qsample,qnorm,hkl,unitMode),
    scans:scanWidths(RM,{thetaS,phi},{Ei,Ef}),
    angles:{A1,A2,A3,thetaM,thetaS,thetaA,phi}, energies:{Ei,Ef}, UB,
    collimation3:{radial:radial3,fwhmArcmin:radial3FwhmArcmin}, prefactor};
}

// Widths, ellipses and the display frames (U-based, lattice, Q) of a local
// resolution matrix RM in the order (Q∥, Q⊥, E, Qout).
// basis: the crystal directions (UB frame) of the local axes Q∥, Q⊥, Qout;
// by default Q in the U–V plane with Qout along W (TAS).  A 4-circle gives
// its own (Q, W × Q, Q × (W × Q)): chi and phi turn the crystal.
function resolutionFrames(RM,lc,rl,UB,Qsample,qnorm,hkl,unitMode,basis=null){
  const sv2Orth=inferOrthogonalInPlaneHKL(rl,lc.sv1,lc.sv2);
  const Qx=qFromUB(UB,lc.sv1), Qy=qFromUB(UB,sv2Orth), Qz=qFromUB(UB,lc.sv3);
  const qxNorm=norm(Qx), qyNorm=norm(Qy), qzNorm=norm(Qz), qvNorm=norm(Qsample);
  if(Math.min(qxNorm,qyNorm,qzNorm)<1e-12) throw new Error('U, V and W reciprocal-space directions must be non-zero.');
  let eX, eY, eZ;
  if(basis){ ({eX,eY,eZ}=basis); }
  else{
    const sampleNormal=[0,0,1], qOut=dot(Qsample,sampleNormal);
    if(Math.abs(qOut)>1e-8*Math.max(qvNorm,1)) throw new Error('Q is out of the U–V plane (Reference Q may be: it only sets the S1 offset).');
    const Qplane=Qsample.map((x,i)=>x-qOut*sampleNormal[i]);
    eX=normalize(Qplane); eZ=sampleNormal; eY=normalize(cross(eZ,eX));
  }
  if(dot(cross(eX,eY),eZ)<1-1e-10) throw new Error('Failed to construct a right-handed local resolution basis.');

  // RM is expressed in the TAS-local coordinates
  //   (Q_parallel, Q_perp, E, Q_out),
  // where eX is parallel to the actual calculation Q, eY is the in-plane
  // perpendicular direction, and eZ is out of the scattering plane.
  //
  // Build the U-based change of basis explicitly instead of reconstructing it
  // from Euler-like angles.  The columns of C are the new (U,V,E,W) basis
  // vectors expressed in the old local coordinates, so
  //
  //       delta_local = C delta_UVW
  //       RM_U = C^T RM C .
  //
  // This guarantees that RM_U == RM only when U is parallel to the measured Q
  // (apart from trivial symmetries of the matrix).  For a general Q direction
  // the displayed U-based matrix is the genuinely rotated resolution matrix.
  const uHat=normalize(Qx), vHat=normalize(Qy), wHat=normalize(Qz);
  const components=a=>[dot(a,eX),dot(a,eY),dot(a,eZ)];
  const cu=components(uHat), cv=components(vHat), cw=components(wHat);
  const Cbasis=[
    [cu[0],cv[0],0,cw[0]],
    [cu[1],cv[1],0,cw[1]],
    [0,0,1,0],
    [cu[2],cv[2],0,cw[2]],
  ];
  const RM_U=matmul(matmul(transpose(Cbasis),RM),Cbasis);

  // Keep the auxiliary matrices for compatibility/debugging.  They represent
  // frames whose first spatial coordinate is V or W respectively.
  const getThetaTilt=axis=>{ const ah=normalize(axis), x=dot(ah,eX),y=dot(ah,eY),z=dot(ah,eZ); return [-Math.atan2(y,x),-Math.atan2(z,Math.hypot(x,y))]; };
  const [tv,pv]=getThetaTilt(Qy), [tw,pw]=getThetaTilt(Qz);
  const transform=R=>matmul(matmul(R,RM),transpose(R));
  const RM_V=transform(rot4(tv,pv)), RM_W=transform(rot4(tw,pw));

  // All displayed U/V/W widths are now taken from the same orthogonal
  // (U,V,E,W) matrix, matching the matrix shown to the user.
  const maxU=findMaxAlongAxis(RM_U,0).max, maxV=findMaxAlongAxis(RM_U,1).max, maxW=findMaxAlongAxis(RM_U,3).max, maxE=findMaxAlongAxis(RM_U,2).max;

  // Coherent widths use one consistent 4D definition in the orthogonal
  // (U, V, E, W) frame: when evaluating one axis, the other three
  // coordinates are fixed to zero.  For a Gaussian resolution function
  // exp(-1/2 x^T RM_U x), this is the FWHM of the corresponding 1D cut
  // through the origin and therefore depends only on RM_U[idx][idx].
  //
  //   Ucoh: V = E = W = 0
  //   Vcoh: U = E = W = 0
  //   Ecoh: U = V = W = 0
  //   Wcoh: U = V = E = 0
  const sliceUEMatrix=submatrix(RM_U,[0,2],[0,2]);
  const sliceVEMatrix=submatrix(RM_U,[1,2],[1,2]);
  const sliceWEMatrix=submatrix(RM_U,[3,2],[3,2]);

  const widths={
    U:2*maxU, V:2*maxV, W:2*maxW, E:2*maxE,
    Ucoh:coherentFwhm(RM_U,0),
    Vcoh:coherentFwhm(RM_U,1),
    Wcoh:coherentFwhm(RM_U,3),
    Ecoh:coherentFwhm(RM_U,2)
  };
  const normU=unitMode==='rlu'?qxNorm:1, normV=unitMode==='rlu'?qyNorm:1, normW=unitMode==='rlu'?qzNorm:1;
  const display={U:widths.U/normU,V:widths.V/normV,W:widths.W/normW,E:widths.E,Ucoh:widths.Ucoh/normU,Vcoh:widths.Vcoh/normV,Wcoh:widths.Wcoh/normW,Ecoh:widths.Ecoh};
  const scale=1.2, lim={U:maxU*scale/normU,V:maxV*scale/normV,W:maxW*scale/normW,E:maxE*scale};
  const projUE=ellipsePoints(schur2(RM_U,[0,2]),normU,1), sliceUE=ellipsePoints(sliceUEMatrix,normU,1);
  const projVE=ellipsePoints(schur2(RM_U,[1,2]),normV,1), sliceVE=ellipsePoints(sliceVEMatrix,normV,1);
  const projWE=ellipsePoints(schur2(RM_U,[3,2]),normW,1), sliceWE=ellipsePoints(sliceWEMatrix,normW,1);
  const projUV=ellipsePoints(schur2(RM_U,[0,1]),normU,normV), sliceUV=ellipsePoints(submatrix(RM_U,[0,1],[0,1]),normU,normV);

  // Lattice frame (U, V, E, W) with the entered, possibly non-orthogonal V.
  // The width along an axis is a property of that direction alone, so it
  // must not depend on which other axis is chosen: every width, slice and
  // U-E / V-E / W-E ellipse is taken in an orthogonal frame whose first axis
  // is that direction (the projection integrates over the hyperplane normal
  // to it; the slice keeps the other orthogonal coordinates at zero).  U, E
  // and W are therefore identical to the U, U⊥in, E, U⊥out frame, and V is
  // evaluated along the entered V.  Only the U-V panel is drawn in the
  // oblique (a U + b V) coordinates, from RM_L = C_L^T RM C_L.
  let lattice=null;
  try{
    const QvLat=qFromUB(UB,lc.sv2), qvLatNorm=norm(QvLat);
    if(qvLatNorm>1e-12){
      const vLatHat=normalize(QvLat), cl=components(vLatHat);
      const CL=[
        [cu[0],cl[0],0,cw[0]],
        [cu[1],cl[1],0,cw[1]],
        [0,0,1,0],
        [cu[2],cl[2],0,cw[2]],
      ];
      const RM_L=symmetrize(matmul(matmul(transpose(CL),RM),CL));
      // Orthogonal frame along V: (V, W × V in plane, E, W).
      const cvp=components(normalize(cross(wHat,vLatHat)));
      const CVF=[
        [cl[0],cvp[0],0,cw[0]],
        [cl[1],cvp[1],0,cw[1]],
        [0,0,1,0],
        [cl[2],cvp[2],0,cw[2]],
      ];
      const RM_VF=symmetrize(matmul(matmul(transpose(CVF),RM),CVF));
      const mV=findMaxAlongAxis(RM_VF,0).max;
      const nU=normU, nV=unitMode==='rlu'?qvLatNorm:1, nW=normW;
      const w={U:widths.U,V:2*mV,W:widths.W,E:widths.E,Ucoh:widths.Ucoh,Vcoh:coherentFwhm(RM_VF,0),Wcoh:widths.Wcoh,Ecoh:widths.Ecoh};
      lattice={
        RM:RM_L, widths:w,
        display:{U:w.U/nU,V:w.V/nV,W:w.W/nW,E:w.E,Ucoh:w.Ucoh/nU,Vcoh:w.Vcoh/nV,Wcoh:w.Wcoh/nW,Ecoh:w.Ecoh},
        // UVU / UVV: ranges of the U-V panel, whose ellipse is drawn in the
        // oblique coefficients (a, b) and is wider than the widths along U, V.
        lim:{U:maxU*scale/nU,V:mV*scale/nV,W:maxW*scale/nW,E:maxE*scale,
          UVU:findMaxAlongAxis(RM_L,0).max*scale/nU,UVV:findMaxAlongAxis(RM_L,1).max*scale/nV},
        ellipses:{
          projUE, sliceUE,
          projVE:ellipsePoints(schur2(RM_VF,[0,2]),nV,1), sliceVE:ellipsePoints(submatrix(RM_VF,[0,2],[0,2]),nV,1),
          projWE, sliceWE,
          projUV:ellipsePoints(schur2(RM_L,[0,1]),nU,nV), sliceUV:ellipsePoints(submatrix(RM_L,[0,1],[0,1]),nU,nV),
          projUW:ellipsePoints(schur2(RM_U,[0,3]),nU,nW), sliceUW:ellipsePoints(submatrix(RM_U,[0,3],[0,3]),nU,nW),
          projVW:ellipsePoints(schur2(RM_VF,[0,3]),nV,nW), sliceVW:ellipsePoints(submatrix(RM_VF,[0,3],[0,3]),nV,nW)
        },
        qNorms:{U:qxNorm,V:qvLatNorm,W:qzNorm},
        displayAxes:{U:lc.sv1.slice(),V:lc.sv2.slice(),W:lc.sv3.slice()},
        // In-plane direction of V relative to U (x) and the orthogonal V (y).
        vDirection:{cos:dot(vLatHat,uHat),sin:dot(vLatHat,vHat)}
      };
    }
  }catch(_e){ lattice=null; }

  // Q frame (Q∥, Q⊥in, E, Q⊥out): Q∥ along the calculation Q, Q⊥ = W × Q∥ in the
  // scattering plane (same handedness as U, U⊥, W), W out of plane.  This is
  // the local TAS matrix RM with W taken along the entered out-of-plane axis.
  let qframe=null;
  try{
    if(qnorm>1e-12){
      const UBinv=inverse(UB), toHKL=q=>matvec(UBinv,q).map(x=>x/(2*PI));
      const qHat=eX, pHat=normalize(cross(wHat,qHat));
      const qAxis=compactDirectionHKL(hkl.map(Number)), pAxis=compactDirectionHKL(toHKL(pHat));
      const nQ=norm(qFromUB(UB,qAxis)), nP=norm(qFromUB(UB,pAxis));
      const cq=components(qHat), cp=components(pHat);
      const CQ=[
        [cq[0],cp[0],0,cw[0]],
        [cq[1],cp[1],0,cw[1]],
        [0,0,1,0],
        [cq[2],cp[2],0,cw[2]],
      ];
      const RM_Q=symmetrize(matmul(matmul(transpose(CQ),RM),CQ));
      const mU=findMaxAlongAxis(RM_Q,0).max, mV=findMaxAlongAxis(RM_Q,1).max, mW=findMaxAlongAxis(RM_Q,3).max, mE=findMaxAlongAxis(RM_Q,2).max;
      const nU=unitMode==='rlu'?nQ:1, nV=unitMode==='rlu'?nP:1, nW=normW;
      const w={U:2*mU,V:2*mV,W:2*mW,E:2*mE,Ucoh:coherentFwhm(RM_Q,0),Vcoh:coherentFwhm(RM_Q,1),Wcoh:coherentFwhm(RM_Q,3),Ecoh:coherentFwhm(RM_Q,2)};
      qframe={
        RM:RM_Q, widths:w,
        display:{U:w.U/nU,V:w.V/nV,W:w.W/nW,E:w.E,Ucoh:w.Ucoh/nU,Vcoh:w.Vcoh/nV,Wcoh:w.Wcoh/nW,Ecoh:w.Ecoh},
        lim:{U:mU*scale/nU,V:mV*scale/nV,W:mW*scale/nW,E:mE*scale},
        ellipses:{
          projUE:ellipsePoints(schur2(RM_Q,[0,2]),nU,1), sliceUE:ellipsePoints(submatrix(RM_Q,[0,2],[0,2]),nU,1),
          projVE:ellipsePoints(schur2(RM_Q,[1,2]),nV,1), sliceVE:ellipsePoints(submatrix(RM_Q,[1,2],[1,2]),nV,1),
          projWE:ellipsePoints(schur2(RM_Q,[3,2]),nW,1), sliceWE:ellipsePoints(submatrix(RM_Q,[3,2],[3,2]),nW,1),
          projUV:ellipsePoints(schur2(RM_Q,[0,1]),nU,nV), sliceUV:ellipsePoints(submatrix(RM_Q,[0,1],[0,1]),nU,nV),
          projUW:ellipsePoints(schur2(RM_Q,[0,3]),nU,nW), sliceUW:ellipsePoints(submatrix(RM_Q,[0,3],[0,3]),nU,nW),
          projVW:ellipsePoints(schur2(RM_Q,[1,3]),nV,nW), sliceVW:ellipsePoints(submatrix(RM_Q,[1,3],[1,3]),nV,nW)
        },
        qNorms:{U:nQ,V:nP,W:qzNorm},
        displayAxes:{U:qAxis,V:pAxis,W:lc.sv3.slice()}
      };
    }
  }catch(_e){ qframe=null; }
  return {RM,RM_U,RM_V,RM_W, widths,display,lim,
    ellipses:{projUE,sliceUE,projVE,sliceVE,projWE,sliceWE,projUV,sliceUV,
      projUW:ellipsePoints(schur2(RM_U,[0,3]),normU,normW), sliceUW:ellipsePoints(submatrix(RM_U,[0,3],[0,3]),normU,normW),
      projVW:ellipsePoints(schur2(RM_U,[1,3]),normV,normW), sliceVW:ellipsePoints(submatrix(RM_U,[1,3],[1,3]),normV,normW)},
    qNorms:{U:qxNorm,V:qyNorm,W:qzNorm},
    displayAxes:{U:lc.sv1.slice(),V:sv2Orth,W:lc.sv3.slice()},
    lattice, qframe};
}


// Two-axis diffractometer (no analyzer), Cooper-Nathans: the elastic
// resolution in Q (Cooper & Nathans 1967, 1968).  The monochromator side is
// that of the TAS calculation (collimators 1st and 2nd, monochromator mosaic);
// the detector takes every final energy, so for elastic scattering
// |kf| = |ki| (Delta kf = Delta ki) and the scattered direction is limited by
// the 3rd (sample-detector) collimator only.  The sample mosaic is added as for
// the TAS.  The returned matrices keep the TAS layout (Q∥, Q⊥, E, Qout) with an
// uncoupled placeholder E row (diffraction:true), so the display frames and
// widths are shared with the TAS calculation; E is not shown.
// 4-circle with the analyzer: the TAS resolution (Cooper-Nathans or
// Popovici) at ħω = 0, in the 4-circle Q frame (Q may be out of the U–V
// plane).
export function calcFourCircleAnalyzerResolution(lc,rl,col,mos,config,approximation,focusing,geom,calc,unitMode='rlu'){
  return calcResolution(lc,rl,col,mos,config,approximation,focusing,geom,{...calc,hw:0},unitMode,{fourCircle:true});
}
export function calcDiffractionResolution(lc,rl,col,mos,config,geom,calc,unitMode='rlu',{fourCircle=false}={}){
  const E=Number(config.energy_mode==='Ef fixed' ? config.Ef : config.Ei);
  if(!(E>0)) throw new Error(`The incident energy must be positive. Ei=${E}`);
  const ub=UB_calc(lc,rl), UB=ub.UB;
  if(det3(ub.U)<=0) throw new Error('Orientation matrix U is not right handed.');
  const hkl=[calc.h,calc.k,calc.l], qRaw=qFromUB(UB,hkl), qnorm=norm(qRaw);
  if(qnorm<1e-12) throw new Error('Q = 0 cannot define the local resolution coordinate system.');
  // 4-circle (bisecting): chi and phi bring any Q into the horizontal
  // scattering plane, so Q may lie out of the U–V plane.
  const qInPlane=Math.hypot(qRaw[0],qRaw[1]);
  const tiltDeg=Math.atan2(Math.abs(qRaw[2]),qInPlane)/D2R;
  if(!fourCircle && tiltDeg>OUT_OF_PLANE_TOLERANCE_DEG+1e-9) throw new Error(`Q is ${tiltDeg.toFixed(2)}° out of the U–V plane (tolerance ${OUT_OF_PLANE_TOLERANCE_DEG}°).`);
  const Qsample=tiltDeg>0 ? [qRaw[0]*qnorm/qInPlane,qRaw[1]*qnorm/qInPlane,0] : qRaw;
  const k=Math.sqrt(E/E2K2);
  if(qnorm>2*k*(1+1e-10)) throw new Error('The requested Q and ħω are kinematically inaccessible.');
  const monoArg=(2*PI/mos.d_mono)/(2*k);
  if(!(Math.abs(monoArg)<=1)) throw new Error('Monochromator/analyzer Bragg condition is inaccessible for the selected energy.');
  const sense=String(config.sign_config||'');
  if(!/^[+-]{3}$/.test(sense)) throw new Error(`Unsupported TAS sign configuration: ${sense}`);
  const [sm,ss]=[...sense].map(c=>c==='-' ? -1 : +1);
  const thetaM=sm*asind(monoArg), twoThetaS=ss*2*asind(Math.min(1,qnorm/(2*k))), thetaS=twoThetaS/2;
  const phi=Math.atan2(-k*sind(2*thetaS),k-k*cosd(2*thetaS))*R2D;

  // Collimators (sigma, rad).  A blank entry: the geometric divergence of the
  // two components it connects, as for the TAS (Cooper-Nathans).
  const isOpen=v=>!(Number(v)>0)||!Number.isFinite(Number(v));
  const toSigma=arcmin=>arcmin/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const {L0,L1,L2,beam_width,beam_height,mono_width,mono_height,det_width,det_height}=geom;
  const sD=geom.sample_shape==='box'
    ? Math.max(Number(geom.sample_u)>0?Number(geom.sample_u):0.01, Number(geom.sample_v)>0?Number(geom.sample_v):0.01)
    : (Number(geom.sample_diameter)>0 ? Number(geom.sample_diameter) : 0.01);
  const sH=Number(geom.sample_height)>0 ? Number(geom.sample_height) : 0.02;
  const mW=mono_width*Math.abs(sind(thetaM)), mH=mono_height;
  const geomSigma=(a,b,L)=>{ const ta=2*Math.atan(a/(2*L)), tb=2*Math.atan(b/(2*L)); return Math.sqrt((ta*ta+tb*tb)/12); };
  const sig=(v,a,b,L)=>isOpen(v) ? geomSigma(a,b,L) : toSigma(v);
  let alpha1, beta1;
  if(col.gm_1st){
    const NA=6.022e23, ro=8.908, MNi=58.69, bc=1.03e-12, lambda=Math.sqrt(81.81/E)*1e-8;
    const thetaC=Math.asin(Math.min(1,lambda*Math.sqrt(NA*ro/MNi*bc/PI)));
    alpha1=col.div_1st_m*thetaC/Math.sqrt(3); beta1=alpha1;
  }else{
    alpha1=sig(col.div_1st_h,beam_width,mW,L0); beta1=sig(col.div_1st_v,beam_height,mH,L0);
  }
  const alpha2=sig(col.div_2nd_h,mW,sD,L1), beta2=sig(col.div_2nd_v,mH,sH,L1);
  const alpha3=sig(col.div_3rd_h,sD,det_width,L2), beta3=sig(col.div_3rd_v,sH,det_height,L2);
  const eta=v=>v/60/180*PI*GAUSS_SIGMA_FROM_FWHM;
  const etaM=eta(mos.mos_mono_h), etaMp=eta(mos.mos_mono_v), etaS=eta(mos.mos_sam_h), etaSp=eta(mos.mos_sam_v);
  if([alpha1,alpha2,alpha3,beta1,beta2,beta3,etaM,etaMp].some(x=>!Number.isFinite(x)||Math.abs(x)<1e-15))
    throw new Error('Collimation and crystal mosaic values must be non-zero for the resolution calculation.');

  // Monochromator side, angles U = (g0, g1, d0, d1): H = G + C^T F C and
  // Y_M = (Delta ki, k g1, k d1) = A U (the TAS matrices, monochromator part).
  const Gm=diag([alpha1,alpha2,beta1,beta2].map(x=>1/(x*x)));
  const Fm=diag([etaM,etaMp].map(x=>1/(x*x)));
  const Cm=[[0.5,0.5,0,0],[0,0,1/(2*sind(thetaM)),-1/(2*sind(thetaM))]];
  const Am=[[k/(2*tand(thetaM)),-k/(2*tand(thetaM)),0,0],[0,k,0,0],[0,0,0,k]];
  const covM=matmul(matmul(Am,inverse(add(Gm,matmul(matmul(transpose(Cm),Fm),Cm)))),transpose(Am));
  // Z = (Delta ki, k g1, k d1, k g2, k d2); Y = (Delta ki, k g1, k d1, Delta kf, k g2, k d2) with Delta kf = Delta ki.
  const covZ=blockDiag(covM,diag([(k*alpha3)**2,(k*beta3)**2]));
  const T=zeros(6,5); T[0][0]=1; T[1][1]=1; T[2][2]=1; T[3][0]=1; T[4][3]=1; T[5][4]=1;
  const B=zeros(3,6);
  B[0][0]=cosd(phi); B[0][1]=sind(phi); B[0][3]=-cosd(phi-2*thetaS); B[0][4]=-sind(phi-2*thetaS);
  B[1][0]=-B[0][1]; B[1][1]=B[0][0]; B[1][3]=-B[0][4]; B[1][4]=B[0][3]; B[2][2]=1; B[2][5]=-1;
  const BT=matmul(B,T);
  const covQ=symmetrize(matmul(matmul(BT,covZ),transpose(BT)));
  covQ[1][1]+=qnorm*qnorm*etaS*etaS; covQ[2][2]+=qnorm*qnorm*etaSp*etaSp;
  const R3=symmetrize(inverse(covQ));
  // TAS layout (Q∥, Q⊥, E, Qout) with an uncoupled E row (1 meV, not shown).
  const RM=[[R3[0][0],R3[0][1],0,R3[0][2]],[R3[1][0],R3[1][1],0,R3[1][2]],[0,0,1,0],[R3[2][0],R3[2][1],0,R3[2][2]]];
  return {...(fourCircle ? fourCircleFrames(RM,lc,rl,UB,qRaw,hkl,unitMode) : resolutionFrames(RM,lc,rl,UB,Qsample,qnorm,hkl,unitMode)),
    diffraction:true, fourCircle,
    scans:scanWidths(RM,{thetaS,phi},{Ei:E,Ef:E},fourCircle),
    angles:{A1:2*thetaM,A2:twoThetaS,A3:null,thetaM,thetaS,thetaA:null,phi}, energies:{Ei:E,Ef:E}, UB,
    collimation3:{radial:false,fwhmArcmin:null}, prefactor:null};
}

// 4-circle: the local matrix is already in the Q frame (Q∥ along Q, Q⊥in
// horizontal, Q⊥out vertical in the laboratory).  With the crystal in the
// bisecting position, Q⊥in is along W × Q and Q⊥out along Q × Q⊥in (W: the
// normal of the U–V plane, vertical at chi = 0), which gives their (h, k, l)
// directions.  The U-based and lattice frames follow from the same basis.
function fourCircleFrames(RM,lc,rl,UB,qRaw,hkl,unitMode){
  const UBinv=inverse(UB), toHKL=q=>matvec(UBinv,q).map(x=>x/(2*PI));
  const qHat=normalize(qRaw), wHat=normalize(qFromUB(UB,lc.sv3));
  let pVec=cross(wHat,qHat);
  if(norm(pVec)<1e-9) pVec=cross(qHat,normalize(qFromUB(UB,lc.sv1)));   // Q along W: any horizontal direction
  const pHat=normalize(pVec), oHat=normalize(cross(qHat,pHat));
  const qAxis=compactDirectionHKL(hkl.map(Number)), pAxis=compactDirectionHKL(toHKL(pHat)), oAxis=compactDirectionHKL(toHKL(oHat));
  const rlu=unitMode==='rlu';
  const nU=rlu?norm(qFromUB(UB,qAxis)):1, nV=rlu?norm(qFromUB(UB,pAxis)):1, nW=rlu?norm(qFromUB(UB,oAxis)):1;
  const R=symmetrize(RM);
  const mU=findMaxAlongAxis(R,0).max, mV=findMaxAlongAxis(R,1).max, mW=findMaxAlongAxis(R,3).max, mE=findMaxAlongAxis(R,2).max;
  const w={U:2*mU,V:2*mV,W:2*mW,E:2*mE,Ucoh:coherentFwhm(R,0),Vcoh:coherentFwhm(R,1),Wcoh:coherentFwhm(R,3),Ecoh:coherentFwhm(R,2)};
  const scale=1.2;
  const frame={
    RM:R, widths:w,
    display:{U:w.U/nU,V:w.V/nV,W:w.W/nW,E:w.E,Ucoh:w.Ucoh/nU,Vcoh:w.Vcoh/nV,Wcoh:w.Wcoh/nW,Ecoh:w.Ecoh},
    lim:{U:mU*scale/nU,V:mV*scale/nV,W:mW*scale/nW,E:mE*scale},
    ellipses:{
      projUE:ellipsePoints(schur2(R,[0,2]),nU,1), sliceUE:ellipsePoints(submatrix(R,[0,2],[0,2]),nU,1),
      projVE:ellipsePoints(schur2(R,[1,2]),nV,1), sliceVE:ellipsePoints(submatrix(R,[1,2],[1,2]),nV,1),
      projWE:ellipsePoints(schur2(R,[3,2]),nW,1), sliceWE:ellipsePoints(submatrix(R,[3,2],[3,2]),nW,1),
      projUV:ellipsePoints(schur2(R,[0,1]),nU,nV), sliceUV:ellipsePoints(submatrix(R,[0,1],[0,1]),nU,nV),
      projUW:ellipsePoints(schur2(R,[0,3]),nU,nW), sliceUW:ellipsePoints(submatrix(R,[0,3],[0,3]),nU,nW),
      projVW:ellipsePoints(schur2(R,[1,3]),nV,nW), sliceVW:ellipsePoints(submatrix(R,[1,3],[1,3]),nV,nW)
    },
    qNorms:{U:nU,V:nV,W:nW},
    displayAxes:{U:qAxis,V:pAxis,W:oAxis}
  };
  // The U-based and lattice (U, V, E, W) frames: the same ellipsoid in the
  // crystal directions of this point (the 4-circle Q frame replaces the TAS
  // one, whose Qout is W).
  const crystal=resolutionFrames(R,lc,rl,UB,qRaw,norm(qRaw),hkl,unitMode,{eX:qHat,eY:pHat,eZ:oHat});
  return {...crystal,qframe:frame};
}
