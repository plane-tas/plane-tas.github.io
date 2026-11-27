// Resolution matrices of a 2D slice on a lattice of nodes, and the engine
// that computes intensities from it.  Used by the workers and, when they
// cannot start, by the page itself (same code, same numbers).
//
// The resolution matrix changes slowly with Q and ħω, so it is calculated
// at nodes (U, V, ħω) and interpolated in between (trilinear, in each
// point's own local frame).  The lattice starts coarse and is refined
// where the matrix changes by more than LATTICE_TOL between neighbouring
// nodes (within a node budget).  A point whose cell touches an unreachable
// node, or is still rough after refining, gets its own matrix.  Whether a
// point is reachable (scattering triangle, Bragg conditions) is checked at
// the point itself.
import {parseDispersionTable, createDispersionInterpolator, standardNormalSamples, convolvePoint, convolvePointGrid, gaussianGrid, autoGridSize} from './convolution-core.js';
import {inverse, matvec} from '../core/matrix.js';

export const LATTICE_TOL=0.1;        // largest relative change of the covariance between neighbours (about 5 % in FWHM)
export const LATTICE_MAX_NODES=12000; // resolution matrices per map at most
export const LATTICE_ROUGH=0.3;      // a cell still changing more than this after refining: exact matrix per point
const E2K2=2.072, TWO_PI=2*Math.PI;

// Starting lattice: up to 7 values along U and V, ħω every 1 meV or so.
export function initialLattice(A,B,E){
  const even=(lo,hi,n)=>n<=1 ? [lo] : Array.from({length:n},(_,i)=>lo+(hi-lo)*i/(n-1));
  const nA=Math.min(7,A.length), nB=Math.min(7,B.length);
  const span=E[E.length-1]-E[0];
  const nE=E.length<=1 ? 1 : Math.min(E.length,Math.max(2,Math.ceil(span/1.0)+1));
  return {a:even(A[0],A[A.length-1],nA),b:even(B[0],B[B.length-1],nB),e:even(E[0],E[E.length-1],nE)};
}
// The nodes a lattice has that an old one did not (all, when old is null).
export function newNodes(lat,old){
  const has=(arr,v)=>old && arr.some(x=>Math.abs(x-v)<1e-12);
  const out=[];
  lat.a.forEach((a,i)=>lat.b.forEach((b,j)=>lat.e.forEach((e,k)=>{
    if(old && has(old.a,a) && has(old.b,b) && has(old.e,e)) return;
    out.push({i,j,k,a,b,e});
  })));
  return out;
}
const idx=(lat,i,j,k)=>(i*lat.b.length+j)*lat.e.length+k;
// Covariance (inverse of RM) of a node, for the refinement test (null when
// the node cannot be reached).
export const covariance=r=>{ if(!r) return null; try{ return inverse(r.RM); }catch(_e){ return null; } };
// Relative change between two covariances: largest |ΔΣ_ij| / √(Σ_ii Σ_jj).
export function change(s1,s2){
  if(!s1 || !s2) return 0;   // unreachable node: nothing to compare
  let d=0;
  for(let i=0;i<4;i++) for(let j=i;j<4;j++){
    const n=Math.sqrt(Math.abs((s1[i][i]+s2[i][i])/2*(s1[j][j]+s2[j][j])/2));
    if(n>0) d=Math.max(d,Math.abs(s1[i][j]-s2[i][j])/n);
  }
  return d;
}
// One refinement round: midpoints of the intervals along which the matrix
// changes too much (largest change first, within the node budget).  An
// interval is not split below the bin of the map along that axis.
// cov: covariance per node (flat, same order as res).  Returns the new
// lattice, or null when nothing needs refining.
export function refineLattice(lat,cov,bins,budget){
  const cand=[];
  const na=lat.a.length, nb=lat.b.length, ne=lat.e.length;
  const c=(i,j,k)=>cov[(i*nb+j)*ne+k];
  // Largest change across interval s of one axis, over the other two.
  const across={
    a:s=>{ let d=0; for(let j=0;j<nb;j++) for(let k=0;k<ne;k++) d=Math.max(d,change(c(s,j,k),c(s+1,j,k))); return d; },
    b:s=>{ let d=0; for(let i=0;i<na;i++) for(let k=0;k<ne;k++) d=Math.max(d,change(c(i,s,k),c(i,s+1,k))); return d; },
    e:s=>{ let d=0; for(let i=0;i<na;i++) for(let j=0;j<nb;j++) d=Math.max(d,change(c(i,j,s),c(i,j,s+1))); return d; }
  };
  for(const ax of ['a','b','e']){
    const v=lat[ax];
    for(let s=0;s+1<v.length;s++){
      if(v[s+1]-v[s]<2*bins[ax]-1e-12) continue;
      const d=across[ax](s);
      if(d>LATTICE_TOL) cand.push({ax,mid:(v[s]+v[s+1])/2,d});
    }
  }
  if(!cand.length) return null;
  cand.sort((x,y)=>y.d-x.d);
  const add={a:[],b:[],e:[]};
  let total=na*nb*ne;
  for(const q of cand){
    const ma=na+add.a.length, mb=nb+add.b.length, me=ne+add.e.length;
    const more=q.ax==='a' ? mb*me : q.ax==='b' ? ma*me : ma*mb;
    if(total+more>budget) continue;
    add[q.ax].push(q.mid); total+=more;
  }
  if(!add.a.length && !add.b.length && !add.e.length) return null;
  const merge=(x,y)=>[...x,...y].sort((p,q)=>p-q);
  return {a:merge(lat.a,add.a),b:merge(lat.b,add.b),e:merge(lat.e,add.e)};
}

// Cells of the final lattice that are still rough (an edge changes by more
// than LATTICE_ROUGH: the node budget ran out there, typically next to the
// kinematic limit).  Their points get their own resolution matrix.  Flat
// array over cells (i, j, k) < (na−1, nb−1, ne−1), a single-node axis
// counting as one cell.
export function roughCells(lat,cov){
  const na=lat.a.length, nb=lat.b.length, ne=lat.e.length;
  const ca=Math.max(1,na-1), cb=Math.max(1,nb-1), ce=Math.max(1,ne-1);
  const out=new Uint8Array(ca*cb*ce);
  const c=(i,j,k)=>cov[(i*nb+j)*ne+k];
  for(let i=0;i<ca;i++) for(let j=0;j<cb;j++) for(let k=0;k<ce;k++){
    const I=[i,Math.min(i+1,na-1)], J=[j,Math.min(j+1,nb-1)], K=[k,Math.min(k+1,ne-1)];
    let d=0;
    for(const x of I) for(const y of J){ d=Math.max(d,change(c(x,y,K[0]),c(x,y,K[1]))); }
    for(const x of I) for(const z of K){ d=Math.max(d,change(c(x,J[0],z),c(x,J[1],z))); }
    for(const y of J) for(const z of K){ d=Math.max(d,change(c(I[0],y,z),c(I[1],y,z))); }
    if(d>LATTICE_ROUGH) out[(i*cb+j)*ce+k]=1;
  }
  return out;
}

// Can the instrument reach |Q| (Å⁻¹) at ħω?  (Same conditions as the
// resolution calculation: energies, Bragg angles, scattering triangle.)
export function reachable(cfg,qnorm,E){
  const Ei=cfg.energyMode==='Ei fixed' ? cfg.Ei : cfg.Ef+E;
  const Ef=cfg.energyMode==='Ei fixed' ? cfg.Ei-E : cfg.Ef;
  if(!(Ei>0 && Ef>0) || !(qnorm>1e-12)) return false;
  const ki=Math.sqrt(Ei/E2K2), kf=Math.sqrt(Ef/E2K2);
  if(Math.abs(Math.PI/(cfg.dMono*ki))>1 || Math.abs(Math.PI/(cfg.dAna*kf))>1) return false;
  const c=(ki*ki+kf*kf-qnorm*qnorm)/(2*ki*kf);
  return c>=-1-1e-10 && c<=1+1e-10;
}
// kf⁴ cot A1 at ħω (A1: analyzer Bragg angle): the part of the intensity
// prefactor R0/Rmon (calcResolution's prefactor) that changes fast with ħω.
// The lattice keeps the slowly varying rest, prefactor / kf⁴ cot A1, as g.
export function prefactorAt(cfg,E){
  const Ef=cfg.energyMode==='Ei fixed' ? cfg.Ei-E : cfg.Ef;
  const kf=Math.sqrt(Ef/E2K2), th=Math.asin(Math.min(1,Math.PI/(cfg.dAna*kf)));
  return kf*kf*kf*kf/Math.tan(th);
}
export const latticeConfig=base=>({
  energyMode:base.config.energy_mode, Ei:Number(base.config.Ei), Ef:Number(base.config.Ef),
  dMono:Number(base.mos.d_mono), dAna:Number(base.mos.d_ana)
});

// Bracketing interval of v in a sorted array: [lo, hi, weight of hi].
function bracket(arr,v){
  const n=arr.length;
  if(n===1 || v<=arr[0]) return [0,0,0];
  if(v>=arr[n-1]) return [n-1,n-1,0];
  let lo=0, hi=n-1;
  while(hi-lo>1){ const m=(lo+hi)>>1; if(arr[m]<=v) lo=m; else hi=m; }
  return [lo,hi,(v-arr[lo])/(arr[hi]-arr[lo])];
}
// Resolution at (a, b, ħω) from the lattice: weighted mean of the RM of the
// surrounding nodes (a mean of positive-definite matrices stays positive
// definite).  Null when one of them cannot be reached (next to the
// kinematic limit the resolution changes fast) or the cell is rough: the
// point then gets its own matrix.
export function latticeResolution(L,a,b,E){
  const [a0,a1,wa]=bracket(L.a,a), [b0,b1,wb]=bracket(L.b,b), [e0,e1,we]=bracket(L.e,E);
  if(L.rough){
    const cb=Math.max(1,L.b.length-1), ce=Math.max(1,L.e.length-1);
    const ci=Math.min(a0,Math.max(0,L.a.length-2)), cj=Math.min(b0,Math.max(0,L.b.length-2)), ck=Math.min(e0,Math.max(0,L.e.length-2));
    if(L.rough[(ci*cb+cj)*ce+ck]) return null;
  }
  const RM=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  let wsum=0, g=0;
  for(const [i,fa] of [[a0,1-wa],[a1,wa]]) for(const [j,fb] of [[b0,1-wb],[b1,wb]]) for(const [k,fe] of [[e0,1-we],[e1,we]]){
    const w=fa*fb*fe; if(!(w>0)) continue;
    const r=L.res[idx(L,i,j,k)]; if(!r) return null;
    for(let p=0;p<4;p++) for(let q=0;q<4;q++) RM[p][q]+=w*r.RM[p][q];
    g+=w*r.g;
    wsum+=w;
  }
  if(!(wsum>0)) return null;
  for(let p=0;p<4;p++) for(let q=0;q<4;q++) RM[p][q]/=wsum;
  return {RM,UB:L.UB,UBinv:L.UBinv,g:g/wsum};
}

// The calculation engine: messages in, replies out (a worker posts them,
// the page calls handle() directly).
export function createEngine(calcResolution){
  let interp=null, tableKey=null, base=null, UBinv=null, lattice=null, integ=null, cfg=null;
  const slim=(r,E)=>r ? {RM:r.RM,UB:r.UB,g:Number.isFinite(r.prefactor) ? r.prefactor/prefactorAt(cfg,E) : NaN} : null;
  function resolutionAt(hkl,E){
    try{
      const r=calcResolution(base.lc,base.rl,base.col,base.mos,base.config,base.approximation,base.focusing,base.geom,
        {h:hkl[0],k:hkl[1],l:hkl[2],hw:E},'ainv');
      if(!UBinv) UBinv=inverse(r.UB);
      return slim(r,E);
    }catch(_e){ return null; }
  }
  return {
    handle(msg){
      if(msg.type==='table'){
        if(msg.key!==tableKey){ interp=createDispersionInterpolator(parseDispersionTable(msg.text,msg.format)); tableKey=msg.key; }
        return null;
      }
      if(msg.type==='base'){ base=msg.base; UBinv=null; cfg=latticeConfig(base); return null; }
      if(msg.type==='nodes'){
        // msg.pts: [{hkl,E,size}] (size: also the automatic grid size).
        const out=msg.pts.map(p=>{
          const r=resolutionAt(p.hkl,p.E);
          const n=r && p.size ? autoGridSize(p.hkl,p.E,{...r,UBinv},interp,{budget:Infinity}).n : null;
          return {r,n};
        });
        return {type:'nodes',id:msg.id,out};
      }
      if(msg.type==='setup'){
        UBinv=msg.UBinv;
        lattice={...msg.lattice,UB:msg.UB,UBinv};
        integ=msg.integ.mode==='mc'
          ? {mode:'mc',samples:standardNormalSamples(msg.integ.samples)}
          : {mode:'grid',grid:gaussianGrid(msg.integ.n)};
        lattice.E=msg.E;
        return null;
      }
      if(msg.type==='row'){
        // msg.items: [{hkl,a,b}]; the reply has the intensities item by
        // item (one per ħω of the map).
        const E=lattice.E, nE=E.length;
        const I=new Float64Array(msg.items.length*nE).fill(NaN);
        let outside=0, unreachable=0;
        for(let k=0;k<msg.items.length;k++){
          const it=msg.items[k];
          const qn=Math.hypot(...matvec(lattice.UB,it.hkl))*TWO_PI;
          for(let ie=0;ie<nE;ie++){
            if(!reachable(cfg,qn,E[ie])){ unreachable++; continue; }
            const r=latticeResolution(lattice,it.a,it.b,E[ie]) || resolutionAt(it.hkl,E[ie]);
            if(!r){ unreachable++; continue; }
            if(!r.UBinv) r.UBinv=UBinv;
            const c=integ.mode==='grid'
              ? convolvePointGrid(it.hkl,E[ie],r,interp,integ.grid,{model:'given'})
              : convolvePoint(it.hkl,E[ie],r,interp,integ.samples,{model:'given'});
            if(c.outside>outside) outside=c.outside;
            I[k*nE+ie]=c.intensity*prefactorAt(cfg,E[ie])*r.g;
          }
        }
        return {type:'row',id:msg.id,I,outside,unreachable};
      }
      return null;
    }
  };
}
