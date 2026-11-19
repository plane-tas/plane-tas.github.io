// Convolution of a dispersion table with the TAS resolution function.
//
// Model: S(Q, E) = sum_b I_b(Q) f(E_b) delta(E - E_b(Q)), the branches b
// (energies E_b and optional intensities I_b) given on (h, k, l) points of a
// table and interpolated between them.  f is 1 ("as given") or the phonon
// factor (n(E) + 1) / E (plus the anti-Stokes peak at -E_b with n(E) / E).
//
// The resolution function R = exp(-x^T M x / 2) (normalised to unit volume)
// with x = (dQ_par, dQ_perp, dE, dQ_out) in the local TAS frame (Å⁻¹, meV) is
// split into the Q marginal (a 3D Gaussian, sampled by Monte Carlo) and the
// conditional energy distribution at fixed dQ (a 1D Gaussian), so each delta
// function is integrated over E exactly:
//   I(Q0, E0) = < sum_b I_b f(E_b) N(E_b - E0; mu(dQ), sigma_E^2) >_dQ .
// The same random numbers are used for every point (smooth scans and maps).
import {inverse, matvec, cross, normalize} from '../core/matrix.js';

const KB_MEV_PER_K=0.08617333262;
const TWO_PI=2*Math.PI;

// ---------------------------------------------------------------- parsing --
// One row per Q point (comment lines start with # % ! ;):
//   'index':      index h k l E1 … En I1 … In
//   'plain':      h k l E1 … En I1 … In
//   'index-pair': index h k l E1 I1 … En In
//   'plain-pair': h k l E1 I1 … En In
// n (the number of branches) follows from the column count.
export function parseDispersionTable(text,format='index'){
  const rows=[];
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(!line || /^[#%!;]/.test(line)) continue;
    const nums=line.split(/[\s,;]+/).filter(Boolean).map(Number);
    if(nums.some(x=>!Number.isFinite(x))){
      if(!rows.length) continue;             // a header line without '#'
      throw new Error(`Non-numeric value in row ${rows.length+1}: "${line.slice(0,60)}".`);
    }
    rows.push(nums);
  }
  if(!rows.length) throw new Error('No numeric rows found.');
  const off=format.startsWith('plain') ? 0 : 1, paired=format.endsWith('-pair');
  const ncol=rows[0].length;
  if(rows.some(r=>r.length!==ncol)) throw new Error('All rows must have the same number of columns.');
  const rest=ncol-off-3;
  const layout=`${off ? 'index, ' : ''}h, k, l, ${paired ? 'E1, I1, … En, In' : 'E1 … En, I1 … In'}`;
  if(rest<2 || rest%2) throw new Error(`${ncol} columns do not match "${layout}" (needs ${off+3} + 2n columns).`);
  const n=rest/2;
  const points=rows.map(r=>({hkl:r.slice(off,off+3),
    E:paired ? Array.from({length:n},(_,b)=>r[off+3+2*b]) : r.slice(off+3,off+3+n),
    I:paired ? Array.from({length:n},(_,b)=>r[off+4+2*b]) : r.slice(off+3+n,off+3+2*n)}));
  let eMin=Infinity, eMax=-Infinity;
  for(const p of points) for(const e of p.E) if(Number.isFinite(e)){ eMin=Math.min(eMin,e); eMax=Math.max(eMax,e); }
  return {format,points,rows,nBranch:n,offset:off,paired,eMin,eMax,hasIntensity:true};
}

// ---------------------------------------------------------- interpolation --
// A full rectilinear grid in h, k, l is interpolated trilinearly; an axis
// with a single value is taken as flat (no dispersion along it).  Other
// tables use the nearest tabulated point.  Points outside the table give null.
export function createDispersionInterpolator(data){
  const pts=data.points, nB=data.nBranch;
  const uniq=i=>[...new Set(pts.map(p=>Number(p.hkl[i].toFixed(6))))].sort((a,b)=>a-b);
  const axes=[uniq(0),uniq(1),uniq(2)];
  const n=axes.map(a=>a.length);
  const ranges=axes.map(a=>({min:a[0],max:a[a.length-1]}));
  const isGrid=n[0]*n[1]*n[2]===pts.length;
  const flat=n.map(x=>x===1);
  if(isGrid){
    const index=axes.map(a=>new Map(a.map((v,i)=>[v,i])));
    const E=new Float64Array(pts.length*nB), I=new Float64Array(pts.length*nB);
    const at=(i,j,k)=>((i*n[1]+j)*n[2]+k)*nB;
    for(const p of pts){
      const ii=index[0].get(Number(p.hkl[0].toFixed(6))), jj=index[1].get(Number(p.hkl[1].toFixed(6))), kk=index[2].get(Number(p.hkl[2].toFixed(6)));
      const base=at(ii,jj,kk);
      for(let b=0;b<nB;b++){ E[base+b]=p.E[b]; I[base+b]=p.I[b]; }
    }
    // Locate x on an axis: index of the lower node and the fraction.
    const locate=(a,x,isFlat)=>{
      if(isFlat) return [0,0];
      const m=a.length, eps=1e-9;
      if(x<a[0]-eps || x>a[m-1]+eps) return null;
      let lo=0, hi=m-1;
      while(hi-lo>1){ const mid=(lo+hi)>>1; if(a[mid]<=x) lo=mid; else hi=mid; }
      const t=Math.min(1,Math.max(0,(x-a[lo])/(a[hi]-a[lo])));
      return [lo,t];
    };
    const outE=new Float64Array(nB), outI=new Float64Array(nB);
    function evaluate(h,k,l){
      const lh=locate(axes[0],h,flat[0]), lk=locate(axes[1],k,flat[1]), ll=locate(axes[2],l,flat[2]);
      if(!lh || !lk || !ll) return null;
      outE.fill(0); outI.fill(0);
      let bad=false;
      for(let di=0;di<2;di++){
        const wi=di?lh[1]:1-lh[1]; if(!wi) continue;
        const i=Math.min(lh[0]+di,n[0]-1);
        for(let dj=0;dj<2;dj++){
          const wj=dj?lk[1]:1-lk[1]; if(!wj) continue;
          const j=Math.min(lk[0]+dj,n[1]-1);
          for(let dk=0;dk<2;dk++){
            const wk=dk?ll[1]:1-ll[1]; if(!wk) continue;
            const k2=Math.min(ll[0]+dk,n[2]-1);
            const w=wi*wj*wk, base=at(i,j,k2);
            for(let b=0;b<nB;b++){
              const e=E[base+b];
              if(!Number.isFinite(e)){ bad=true; continue; }
              outE[b]+=w*e; outI[b]+=w*I[base+b];
            }
          }
        }
      }
      return bad ? null : {E:outE,I:outI};
    }
    return {evaluate,grid:true,axes,n,ranges,flat,nBranch:nB};
  }
  // Nearest neighbour with a bucket hash.
  const span=ranges.map(r=>Math.max(r.max-r.min,1e-6));
  const cell=Math.cbrt(span[0]*span[1]*span[2]/Math.max(1,pts.length))*2 || 0.01;
  const buckets=new Map();
  const bkey=(h,k,l)=>`${Math.floor((h-ranges[0].min)/cell)},${Math.floor((k-ranges[1].min)/cell)},${Math.floor((l-ranges[2].min)/cell)}`;
  for(const p of pts){ const key=bkey(...p.hkl); if(!buckets.has(key)) buckets.set(key,[]); buckets.get(key).push(p); }
  const tol=cell*1.5;
  function evaluate(h,k,l){
    for(let i=0;i<3;i++){ const x=[h,k,l][i]; if(x<ranges[i].min-tol || x>ranges[i].max+tol) return null; }
    const bi=Math.floor((h-ranges[0].min)/cell), bj=Math.floor((k-ranges[1].min)/cell), bk=Math.floor((l-ranges[2].min)/cell);
    let best=null, bestD=Infinity;
    for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++) for(let c=-1;c<=1;c++){
      for(const p of buckets.get(`${bi+a},${bj+b},${bk+c}`)||[]){
        const d=(p.hkl[0]-h)**2+(p.hkl[1]-k)**2+(p.hkl[2]-l)**2;
        if(d<bestD){ bestD=d; best=p; }
      }
    }
    return best ? {E:best.E,I:best.I} : null;
  }
  return {evaluate,grid:false,axes,n,ranges,flat,nBranch:nB};
}

// ---------------------------------------------------------- random samples --
function mulberry32(seed){
  return function(){
    seed|=0; seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
// N standard-normal 3-vectors (antithetic pairs: the mean of the samples is 0).
export function standardNormalSamples(N,seed=12345){
  const rnd=mulberry32(seed), out=new Float64Array(3*N);
  const gauss=()=>{ let u=0; while(u<=1e-12) u=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(TWO_PI*rnd()); };
  for(let s=0;s<N;s+=2){
    for(let i=0;i<3;i++){
      const g=gauss();
      out[3*s+i]=g;
      if(s+1<N) out[3*(s+1)+i]=-g;
    }
  }
  return out;
}

// Phonon factor: Stokes peak (n+1)/E at +E, anti-Stokes n/E at -E.
function bose(E,T){
  if(!(T>0)) return 0;
  const x=E/(KB_MEV_PER_K*T);
  return x>700 ? 0 : 1/Math.expm1(x);
}

// ---------------------------------------------------------- one (Q0, E0) --
// res: calcResolution() result at (hkl0, E0) — its RM (local frame
// Q_par, Q_perp, E, Q_out) and UB.
// Grid integration over Q: a tensor-product grid of the standard-normal
// variables z (|z| ≤ zmax on every axis, n[i] points) with Gaussian weights
// exp(-|z|²/2), normalised to a sum of 1.  The resolution shape (Cholesky
// factor) maps it onto the ellipsoid, so the grid follows its size and tilt.
export function gaussianGrid(n,zmax=3.5){
  const axes=n.map(k=>{ const m=Math.max(1,k|0); return Array.from({length:m},(_,i)=>m===1 ? 0 : -zmax+2*zmax*i/(m-1)); });
  const N=axes[0].length*axes[1].length*axes[2].length;
  const z=new Float64Array(3*N), w=new Float64Array(N);
  let t=0, sum=0;
  for(const a of axes[0]) for(const b of axes[1]) for(const c of axes[2]){
    z[3*t]=a; z[3*t+1]=b; z[3*t+2]=c;
    w[t]=Math.exp(-(a*a+b*b+c*c)/2); sum+=w[t]; t++;
  }
  for(let i=0;i<N;i++) w[i]/=sum;
  return {samples:z,weights:w,n:axes.map(a=>a.length)};
}

// Monte Carlo integration over the resolution ellipsoid: samples are
// standard-normal points z (3 per point), each with weight 1/N.  The energy
// Gaussian is integrated analytically at every point.
export function convolvePoint(hkl0,E0,res,interp,samples,opts={}){
  const {L,m,mEE,varE,col}=localFrame(hkl0,res,opts);
  const norm=1/Math.sqrt(TWO_PI*varE);
  const phonon=opts.model==='phonon', T=Number(opts.temperature)||0, eCut=Number(opts.minEnergy)||0.05;
  const N=samples.length/3;
  let sum=0, outside=0;
  for(let s=0;s<N;s++){
    const z0=samples[3*s], z1=samples[3*s+1], z2=samples[3*s+2];
    const d0=L[0][0]*z0, d1=L[1][0]*z0+L[1][1]*z1, d2=L[2][0]*z0+L[2][1]*z1+L[2][2]*z2;
    const mu=-(m[0]*d0+m[1]*d1+m[2]*d2)/mEE;
    const v=interp.evaluate(hkl0[0]+col[0][0]*d0+col[1][0]*d1+col[2][0]*d2,
                            hkl0[1]+col[0][1]*d0+col[1][1]*d1+col[2][1]*d2,
                            hkl0[2]+col[0][2]*d0+col[1][2]*d1+col[2][2]*d2);
    if(!v){ outside++; continue; }
    for(let b=0;b<v.E.length;b++){
      const e=v.E[b], w=v.I[b];
      if(!Number.isFinite(e) || !w) continue;
      if(phonon){
        const ea=Math.abs(e);
        if(ea<eCut) continue;
        const n=bose(ea,T);
        const xs=ea-E0-mu, xa=-ea-E0-mu;
        sum+=w*((n+1)/ea*Math.exp(-xs*xs/(2*varE))+n/ea*Math.exp(-xa*xa/(2*varE)));
      }else{
        const x=e-E0-mu;
        sum+=w*Math.exp(-x*x/(2*varE));
      }
    }
  }
  return {intensity:sum*norm/N,outside:outside/N};
}

// Standard normal cumulative distribution (erf: Abramowitz & Stegun 7.1.26,
// |error| < 1.5e-7).
function normalCdf(z){
  const x=Math.abs(z)/Math.SQRT2, t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
  return z>=0 ? 0.5*(1+y) : 0.5*(1-y);
}
// Local frame of a resolution point: Cholesky factor L of the Q covariance
// (at fixed E), the E–Q coupling m / mEE (μ = −m·d / mEE), the energy
// variance, and the columns that turn local Å⁻¹ into h, k, l.
function localFrame(hkl0,res,opts){
  const RM=res.RM, UB=res.UB;
  const qi=[0,1,3];
  const MQQ=qi.map(i=>qi.map(j=>RM[i][j]));
  const m=qi.map(i=>RM[i][2]), mEE=RM[2][2];
  if(!(mEE>0)) throw new Error('Invalid resolution matrix.');
  const P=MQQ.map((row,i)=>row.map((x,j)=>x-m[i]*m[j]/mEE));
  const L=cholesky3(inverse(P));
  if(!L) throw new Error('The resolution Q covariance is not positive definite.');
  const sigInt=(Number(opts.intrinsicFwhm)||0)/2.354820045;
  const varE=1/mEE+sigInt*sigInt;
  const q0=matvec(UB,hkl0).map(x=>TWO_PI*x);
  const eX=normalize([q0[0],q0[1],0]), eZ=[0,0,1], eY=cross(eZ,eX);
  const UBinv=res.UBinv || inverse(UB);
  const col=[eX,eY,eZ].map(e=>matvec(UBinv,e).map(x=>x/TWO_PI));
  return {L,m,mEE,varE,col};
}
// Is (hkl0, E0) so far from every branch that its intensity is negligible?
// At the centre and at ±1, ±2 σ along each axis of the ellipsoid,
// x = E_b − μ; a quadratic through those values bounds how far x moves out
// to the grid edge (3.5 σ) along that axis.  The point is far when, for
// every branch with intensity, |x − E0| at the centre exceeds that reach
// plus 6 σ_E (about 2.5 FWHM in energy).  Not for the phonon model.
function farFromDispersion(hkl0,E0,F,interp){
  const {L,m,mEE,varE,col}=F, nB=interp.nBranch, sd=Math.sqrt(varE);
  const at=z=>{
    const d0=L[0][0]*z[0], d1=L[1][0]*z[0]+L[1][1]*z[1], d2=L[2][0]*z[0]+L[2][1]*z[1]+L[2][2]*z[2];
    const v=interp.evaluate(hkl0[0]+col[0][0]*d0+col[1][0]*d1+col[2][0]*d2,
                            hkl0[1]+col[0][1]*d0+col[1][1]*d1+col[2][1]*d2,
                            hkl0[2]+col[0][2]*d0+col[1][2]*d1+col[2][2]*d2);
    // evaluate() reuses its arrays: copy.
    return v ? {E:Float64Array.from(v.E),I:Float64Array.from(v.I),mu:-(m[0]*d0+m[1]*d1+m[2]*d2)/mEE} : null;
  };
  const c=at([0,0,0]);
  if(!c) return false;
  // Cheap first test at the centre only.
  for(let b=0;b<nB;b++) if(c.I[b] && !(Math.abs(c.E[b]-E0)>6*sd)) return false;
  const side=[];
  for(let a=0;a<3;a++) for(const t of [1,-1,2,-2]){
    const z=[0,0,0]; z[a]=t; const p=at(z);
    if(!p) return false;
    side.push(p);
  }
  for(let b=0;b<nB;b++){
    const all=[c,...side];
    if(!all.some(p=>p.I[b])) continue;               // no intensity on this branch here
    const x=all.map(p=>p.E[b]-p.mu);
    if(!x.every(Number.isFinite)) return false;
    const x0=x[0];
    let r2=0;
    for(let a=0;a<3;a++){
      const [p1,m1,p2,m2]=x.slice(1+4*a,5+4*a);
      const g=Math.max(Math.abs(p1-m1)/2,Math.abs(p2-m2)/4);
      const k=Math.max(Math.abs(p1+m1-2*x0)/2,Math.abs(p2+m2-2*x0)/8);
      const reach=3.5*g+12.25*k;
      r2+=reach*reach;
    }
    if(!(Math.abs(x0-E0)>Math.sqrt(r2)+6*sd)) return false;
  }
  return true;
}
// Is the point worth the full grid?  (False: its intensity is negligible.)
export function nearDispersion(hkl0,E0,res,interp,opts={}){
  try{ return !farFromDispersion(hkl0,E0,localFrame(hkl0,res,opts),interp); }catch(_e){ return true; }
}

// Grid integration: a Gaussian-weighted tensor grid of z within ±3.5 σ (see
// gaussianGrid), with cell smoothing in pass 2 so that a sharp dispersion
// surface is integrated without ripples from few nodes.
export function convolvePointGrid(hkl0,E0,res,interp,grid,opts={}){
  const F=localFrame(hkl0,res,opts);
  const {L,m,mEE,varE,col}=F;
  const phonon=opts.model==='phonon', T=Number(opts.temperature)||0, eCut=Number(opts.minEnergy)||0.05;
  const {samples,weights,n}=grid, N=weights.length, nB=interp.nBranch;
  // Quick exit: no branch comes near E0 inside the ellipsoid.
  if(!phonon && opts.skip!==false && farFromDispersion(hkl0,E0,F,interp)) return {intensity:0,outside:0};
  // Pass 1: E_b − μ (and I_b) at every node.
  const X=new Float64Array(N*nB).fill(NaN), Iw=new Float64Array(N*nB), MU=new Float64Array(N);
  let outside=0;
  for(let s=0;s<N;s++){
    const z0=samples[3*s], z1=samples[3*s+1], z2=samples[3*s+2];
    const d0=L[0][0]*z0, d1=L[1][0]*z0+L[1][1]*z1, d2=L[2][0]*z0+L[2][1]*z1+L[2][2]*z2;
    MU[s]=-(m[0]*d0+m[1]*d1+m[2]*d2)/mEE;
    const v=interp.evaluate(hkl0[0]+col[0][0]*d0+col[1][0]*d1+col[2][0]*d2,
                            hkl0[1]+col[0][1]*d0+col[1][1]*d1+col[2][1]*d2,
                            hkl0[2]+col[0][2]*d0+col[1][2]*d1+col[2][2]*d2);
    if(!v){ outside+=weights[s]; continue; }
    for(let b=0;b<nB;b++){ const e=v.E[b]; if(Number.isFinite(e)){ X[s*nB+b]=e; Iw[s*nB+b]=v.I[b]; } }
  }
  // Pass 2: smoothed peak at every node.  Across its cell, x = sgn·E_b − μ
  // changes by D_a along each grid axis a (sgn = −1: the anti-Stokes peak of
  // the phonon model).  Along the axis with the largest change the node
  // stands for a box of width D (boxes of neighbouring nodes then tile a
  // sloping dispersion without gaps or ripples); the other axes add D²/12 to
  // the variance.  The peak is that box convolved with the Gaussian.
  const stride=[n[1]*n[2],n[2],1];
  const val=(t,b,sgn)=>{ const v=X[t*nB+b]; return Number.isFinite(v) ? sgn*(phonon ? Math.abs(v) : v)-MU[t] : NaN; };
  const spread={box:0,rest:0};
  const spreadAt=(s,idx,b,sgn)=>{
    const c=val(s,b,sgn);
    let big=0, sum2=0;
    for(let a=0;a<3;a++){
      if(n[a]<2) continue;
      const fu=idx[a]+1<n[a] ? val(s+stride[a],b,sgn) : NaN, fd=idx[a]>0 ? val(s-stride[a],b,sgn) : NaN;
      // One-sided differences to both neighbours (mean of their squares):
      // the central slope on a straight line, still nonzero at the bottom
      // of a bowl, where the central difference cancels.
      const du=Number.isFinite(fu) ? fu-c : NaN, dd=Number.isFinite(fd) ? c-fd : NaN;
      const D2=Number.isFinite(du) && Number.isFinite(dd) ? (du*du+dd*dd)/2 : Number.isFinite(du) ? du*du : Number.isFinite(dd) ? dd*dd : 0;
      sum2+=D2; if(D2>big) big=D2;
    }
    spread.box=Math.sqrt(big); spread.rest=(sum2-big)/12;
    return spread;
  };
  // Box of width W convolved with a Gaussian of variance v, at x.
  const peak=(x,W,v)=>{
    const sg=Math.sqrt(v);
    if(W<0.5*sg) return Math.exp(-x*x/(2*(v+W*W/12)))/Math.sqrt(TWO_PI*(v+W*W/12));
    if(Math.abs(x)-W/2>12*sg) return 0;
    return (normalCdf((x+W/2)/sg)-normalCdf((x-W/2)/sg))/W;
  };
  const at=(x,s,idx,b,sgn)=>{
    // Far tails: skip the spread (the peak is negligible anyway).
    if(x*x>200*varE){ const sp=spreadAt(s,idx,b,sgn); if(Math.abs(x)-sp.box/2>12*Math.sqrt(varE+sp.rest)) return 0; return peak(x,sp.box,varE+sp.rest); }
    const sp=spreadAt(s,idx,b,sgn);
    return peak(x,sp.box,varE+sp.rest);
  };
  const idx=[0,0,0];
  let sum=0;
  for(let s=0;s<N;s++){
    idx[0]=Math.floor(s/stride[0]); idx[1]=Math.floor(s/stride[1])%n[1]; idx[2]=s%n[2];
    const ws=weights[s];
    for(let b=0;b<nB;b++){
      const e=X[s*nB+b], w=Iw[s*nB+b];
      if(!Number.isFinite(e) || !w) continue;
      if(phonon){
        const ea=Math.abs(e);
        if(ea<eCut) continue;
        const nb=bose(ea,T);
        sum+=ws*w*((nb+1)/ea*at(ea-E0-MU[s],s,idx,b,1)+(nb>0 ? nb/ea*at(-ea-E0-MU[s],s,idx,b,-1) : 0));
      }else{
        sum+=ws*w*at(e-E0-MU[s],s,idx,b,1);
      }
    }
  }
  return {intensity:sum,outside};
}

// Automatic grid size.  The change of E_b − μ along each z axis from the
// centre (largest over the branches, in units of σ_E) sets how finely that
// axis is sampled: an axis along which nothing changes gets 1 node, the
// others nMin, steep ones up to nMax.  The total stays within budget.
export function autoGridSize(hkl0,E0,res,interp,opts={}){
  const nMin=opts.nMin||9, nMax=opts.nMax||21, budget=opts.budget||3000;
  let F;
  try{ F=localFrame(hkl0,res,opts); }catch(_e){ return {n:[11,11,11]}; }
  const {L,m,mEE,varE,col}=F, sigE=Math.sqrt(varE);
  const at=z=>{
    const d=[L[0][0]*z[0], L[1][0]*z[0]+L[1][1]*z[1], L[2][0]*z[0]+L[2][1]*z[1]+L[2][2]*z[2]];
    const v=interp.evaluate(...[0,1,2].map(i=>hkl0[i]+col[0][i]*d[0]+col[1][i]*d[1]+col[2][i]*d[2]));
    return {E:v ? Array.from(v.E) : null, mu:-(m[0]*d[0]+m[1]*d[1]+m[2]*d[2])/mEE};
  };
  const c=at([0,0,0]);
  const n=[0,0,0];
  for(let a=0;a<3;a++){
    let r=0;
    // Change of E_b − μ from the centre to ±1 and ±2 σ, per σ (one-sided, so a
    // band minimum or maximum at the centre is caught too).
    for(const t of [1,-1,2,-2]){
      const z=[0,0,0]; z[a]=t;
      const p=at(z), dmu=p.mu-c.mu;
      if(p.E && c.E) for(let b=0;b<p.E.length;b++){
        if(!Number.isFinite(p.E[b]) || !Number.isFinite(c.E[b])) continue;
        r=Math.max(r,Math.abs(p.E[b]-c.E[b]-dmu)/Math.abs(t)/sigE);
      }
      else r=Math.max(r,Math.abs(dmu)/Math.abs(t)/sigE);
    }
    n[a]=r<0.02 ? 1 : Math.max(nMin,Math.min(nMax,2*Math.round((5+3*Math.log2(1+r))/2)+1));
  }
  while(n[0]*n[1]*n[2]>budget){
    const a=n.indexOf(Math.max(...n));
    if(n[a]<=nMin) break;
    n[a]-=2;
  }
  return {n};
}

function cholesky3(A){
  const L=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++) for(let j=0;j<=i;j++){
    let s=(A[i][j]+A[j][i])/2;
    for(let k=0;k<j;k++) s-=L[i][k]*L[j][k];
    if(i===j){ if(!(s>0)) return null; L[i][i]=Math.sqrt(s); }
    else L[i][j]=s/L[j][j];
  }
  return L;
}

// The bare dispersion along a line (for overlays): branch energies at points.
export function dispersionAlong(interp,points){
  return points.map(p=>{ const v=interp.evaluate(...p); return v ? Array.from(v.E) : null; });
}
