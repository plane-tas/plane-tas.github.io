// Resolution › Convolution: the resolution and the integration (Grid /
// Monte Carlo) of each point, the worker pool and the time estimate.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {autoGridSize, convolvePoint, convolvePointGrid, gaussianGrid, nearDispersion, standardNormalSamples} from './convolution-core.js';
import {inverse} from '../core/matrix.js';
import {inferOutOfPlaneHKL} from '../resolution/resolution-core.js';
import {fmt} from './convolution-legend.js';
import {LATTICE_MAX_NODES, covariance, createEngine, initialLattice, newNodes, refineLattice, roughCells} from './convolution-lattice.js';

export function installConvolutionCalc(context){
  const {$, calcResolution, collectResolutionBase}=context.deps;
  const {state,fns}=context;
  // ---------------------------------------------------------- resolution --
  function resolutionAt(base,hkl,E,cache){
    try{
      const res=calcResolution(base.lc,base.rl,base.col,base.mos,base.config,base.approximation,base.focusing,base.geom,
        {h:hkl[0],k:hkl[1],l:hkl[2],hw:E},'ainv');
      if(!cache.UBinv) cache.UBinv=inverse(res.UB);
      res.UBinv=cache.UBinv;
      return res;
    }catch(_e){ return null; }
  }
  // integ: {mode:'mc',samples} or {mode:'grid',grid} (see integrationFor).
  function intensityAt(base,hkl,E,integ,cache,stats,resIn){
    const res=resIn===undefined ? resolutionAt(base,hkl,E,cache) : resIn;
    if(!res){ stats.unreachable++; return NaN; }
    const r=integ.mode==='grid'
      ? convolvePointGrid(hkl,E,res,state.interp,integ.grid,{model:'given'})
      : convolvePoint(hkl,E,res,state.interp,integ.samples,{model:'given'});
    stats.outside=Math.max(stats.outside,r.outside);
    return r.intensity*prefactor(res);
  }
  // Intensity prefactor of an S(Q,ω) table: R0/Rmon of the selected
  // approximation, normalisation to monitor counts (calcResolution's prefactor).
  const prefactor=res=>Number.isFinite(res.prefactor) ? res.prefactor : NaN;
  // Is a Q point inside the table?  A single-valued axis is flat (any value).
  const inTable=hkl=>state.interp.ranges.every((r,i)=>state.interp.flat?.[i] || (hkl[i]>=r.min-1e-9 && hkl[i]<=r.max+1e-9));
  const tableRangeText=()=>['H','K','L'].map((n,i)=>state.interp.flat?.[i] ? `${n} any` : `${n} ${fmt(state.interp.ranges[i].min)}…${fmt(state.interp.ranges[i].max)}`).join(', ');
  // Integration over the resolution ellipsoid, chosen from fixed lists (no
  // unbounded memory: a grid holds at most 29³ nodes, Monte Carlo at most
  // 30000 points per worker).
  //  Grid: a Gaussian-weighted grid within ±3.5 σ (±1.5 FWHM) on every axis
  //  of the ellipsoid.  The choice is the number of nodes n on the finest axis
  //  (spacing 7σ/(n−1): 9 → 0.88σ, 15 → σ/2, 21 → σ/3, 29 → σ/4).  The other
  //  axes get fewer in proportion to how steeply the dispersion crosses the
  //  resolution along them (autoGridSize); an axis along which nothing
  //  changes gets one node.
  //  Monte Carlo: the number of random points.
  const GRID_CHOICES=[9,15,21,29], MC_CHOICES=[1000,3000,10000,30000];
  const GRID_DEFAULT={'2D':9,'1D':21}, MC_DEFAULT={'2D':1000,'1D':3000};
  const choice=(id,list,dflt)=>{ const v=Number($(id)?.value); return list.includes(v) ? v : dflt; };
  const mcSamples=dim=>choice(`convSamples${dim}`,MC_CHOICES,MC_DEFAULT[dim]);
  const gridMax=dim=>choice(`convGrid${dim}`,GRID_CHOICES,GRID_DEFAULT[dim]);
  const samplesFrom=dim=>standardNormalSamples(mcSamples(dim));
  // A value restored from an older version that is not in a list: the default.
  function fixChoices(){
    for(const dim of ['2D','1D']){
      for(const [id,list,d] of [[`convSamples${dim}`,MC_CHOICES,MC_DEFAULT[dim]],[`convGrid${dim}`,GRID_CHOICES,GRID_DEFAULT[dim]]]){
        const el=$(id); if(el && !list.includes(Number(el.value))) el.value=String(d);
      }
    }
  }
  const integrationMode=dim=>$(`convIntegration${dim}`)?.value==='mc' ? 'mc' : 'grid';
  function showIntegration(){
    // The slot right of the select: the grid spacing (Grid) or the number of
    // random points (Monte Carlo); its width is fixed so the select stays put.
    for(const dim of ['2D','1D']){
      const mc=integrationMode(dim)==='mc';
      const f=$(`convSamples${dim}Field`); if(f) f.hidden=!mc;
      const g=$(`convGridRange${dim}`); if(g) g.hidden=mc;
    }
  }
  function gridSizeFor(dim,points){
    const n=[1,1,1]; let sized=0;
    for(const {hkl,E,res} of points){
      if(!res) continue;
      const a=autoGridSize(hkl,E,res,state.interp,{budget:Infinity});
      for(let i=0;i<3;i++) n[i]=Math.max(n[i],a.n[i]);
      sized++;
    }
    return sizeGrid(dim,sized ? n : DEFAULT_GRID);
  }
  // Grid size when no resolution point could be checked.
  const DEFAULT_GRID=[11,11,11];
  // The chosen number of nodes on the finest axis; the others scaled in the
  // proportions of the automatic size (odd counts: a node at the centre).
  function sizeGrid(dim,nAuto){
    const N=gridMax(dim), m=Math.max(...nAuto);
    if(!(m>1)) return [1,1,1];
    return nAuto.map(x=>{ if(x<=1) return 1; const k=Math.round(x*N/m); return Math.max(3,k%2 ? k : k+1); });
  }
  function integrationFor(dim,points){
    if(integrationMode(dim)==='mc') return {mode:'mc',samples:samplesFrom(dim)};
    return {mode:'grid',grid:gaussianGrid(gridSizeFor(dim,points))};
  }
  const grid=(lo,hi,step,cap)=>{
    const n=step>0 ? Math.min(cap,Math.max(2,Math.round((hi-lo)/step)+1)) : 1;
    return n===1 ? [lo] : Array.from({length:n},(_,i)=>lo+(hi-lo)*i/(n-1));
  };

  // Slice coordinates: hkl = a U + b V + w W, with W the out-of-plane
  // direction of the scattering plane (as on the Constant E map: U × V in
  // reciprocal space, largest component 1) and w the W value of the slice.
  // coeff: (a, b) of the in-plane part; coeff3: (a, b, w).
  function planeBasis(base,w=0){
    const U=base.lc.sv1.map(Number), V=base.lc.sv2.map(Number);
    let W;
    try{ W=inferOutOfPlaneHKL(base.rl,U,V).map(Number); }catch(_e){ W=[U[1]*V[2]-U[2]*V[1],U[2]*V[0]-U[0]*V[2],U[0]*V[1]-U[1]*V[0]]; }
    const Minv=inverse([0,1,2].map(i=>[U[i],V[i],W[i]]));
    const coeff3=h=>[0,1,2].map(j=>Minv[j][0]*h[0]+Minv[j][1]*h[1]+Minv[j][2]*h[2]);
    const coeff=h=>coeff3(h).slice(0,2);
    const w0=Number.isFinite(w) ? w : 0;
    return {U,V,W,w:w0,coeff,coeff3,hkl:(a,b)=>U.map((x,i)=>a*x+b*V[i]+w0*W[i])};
  }

  // ------------------------------------------------------------ workers --
  // A 2D map is shared between the CPU cores: one worker per core, each
  // with its own copy of the dispersion table.  Jobs go to whichever worker
  // is free.  Stop terminates the workers (new ones start on the next run).
  // Without workers the page runs the same engine itself.
  // Calculation threads: half of the logical cores (hardwareConcurrency), at
  // least one.  With hyper-threading the second half adds little speed, and
  // leaving it free keeps the page and the rest of the computer responsive.
  const workerCount=()=>{
    const n=Math.max(1,Math.round(Number(navigator.hardwareConcurrency)||4));
    return Math.max(1,Math.min(32,Math.floor(n/2)));
  };
  const workersAvailable=()=>!state.workersBroken && typeof Worker!=='undefined';
  function getWorkers(){
    if(state.workers || !workersAvailable()) return state.workers;
    try{
      state.workers=Array.from({length:workerCount()},()=>new Worker(new URL('./convolution-worker.js',import.meta.url),{type:'module'}));
    }catch(_e){ state.workersBroken=true; state.workers=null; }
    return state.workers;
  }
  function killWorkers(){ state.workers?.forEach(w=>w.terminate()); state.workers=null; }
  // Run jobs on the workers; onDone(reply, job) for each.  A worker that
  // fails to load rejects with workerFailed (the caller then runs on the page).
  function runJobs(ws,jobs,onDone){
    return new Promise((resolve,reject)=>{
      let next=0, pending=0, over=false;
      const end=(fn,arg)=>{
        if(over) return;
        over=true; state.cancelJobs=()=>{};
        // After an error the other workers may still be busy: their late
        // replies must not reach the next run.
        if(fn===reject) killWorkers();
        fn(arg);
      };
      state.cancelJobs=()=>end(reject,new Error('Stopped'));
      const give=w=>{
        if(over) return;
        if(next>=jobs.length){ if(!pending) end(resolve); return; }
        const j=jobs[next], idx=next++;
        pending++;
        w.postMessage({...j.msg,id:idx});
      };
      for(const w of ws){
        w.onmessage=ev=>{
          const m=ev.data;
          if(m.type==='error'){ end(reject,new Error(m.message)); return; }
          pending--;
          try{ onDone(m,jobs[m.id]); }catch(err){ end(reject,err); return; }
          give(w);
        };
        w.onerror=ev=>{ ev.preventDefault?.(); const e=new Error('The calculation threads could not start.'); e.workerFailed=true; end(reject,e); };
      }
      if(!jobs.length){ end(resolve); return; }
      ws.forEach(give);
    });
  }
  const workerRunner=ws=>({
    size:ws.length,
    broadcast:msg=>ws.forEach(w=>w.postMessage(msg)),
    run:(jobs,onDone)=>runJobs(ws,jobs,onDone)
  });
  function pageRunner(id){
    const engine=createEngine(calcResolution);
    return {
      size:1,
      broadcast:msg=>engine.handle(msg),
      async run(jobs,onDone){
        let t0=performance.now();
        for(let i=0;i<jobs.length;i++){
          onDone(engine.handle({...jobs[i].msg,id:i}),jobs[i]);
          if(performance.now()-t0>150){ t0=performance.now(); await fns.yieldUI(); if(id!==state.run2D) throw new Error('Stopped'); }
        }
      }
    };
  }
  // A 2D map in two phases.  1: resolution matrices on the lattice of nodes,
  // refined round by round where they change too much (and the automatic
  // grid size from the nodes inside the range).  2: the points, a piece of a
  // row per job (see convolution-lattice.js for how a point gets its matrix).
  async function run2DOn(id,R,P){
    const {base,plane,A,Bv,E}=P, nA=A.length, nE=E.length;
    const gridMode=integrationMode('2D')==='grid';
    R.broadcast({type:'table',key:state.tableKey,text:state.text,format:fns.formatValue()});
    R.broadcast({type:'base',base});
    const items=[];  // per row: [{ia,hkl}] inside the range
    for(let ib=0;ib<Bv.length;ib++){
      const row=[];
      for(let ia=0;ia<nA;ia++) row.push({ia,hkl:plane.hkl(A[ia],Bv[ib])});
      items.push(row);
    }
    const nPts=items.reduce((n,r)=>n+r.length,0)*nE;
    const bins={a:nA>1 ? Math.abs(A[1]-A[0]) : Infinity,b:Bv.length>1 ? Math.abs(Bv[1]-Bv[0]) : Infinity,e:nE>1 ? Math.abs(E[1]-E[0]) : Infinity};
    // Progress: the nodes first (their share from the time per resolution
    // matrix), then the points.
    const b=state.bench, tRes=b?.tRes||2, tPt=b ? (gridMode ? 0.25*999*b.tNode : 300*b.tSample) : 0.2;
    let lat=initialLattice(A,Bv,E), old=null;
    const estNodes=2*lat.a.length*lat.b.length*lat.e.length;
    const shareA=estNodes*tRes/(estNodes*tRes+nPts*tPt);
    let lastShow=0;
    const show=f=>{ const t=performance.now(); if(t-lastShow>150){ lastShow=t; fns.setProgress('convMessage2D',f); } };

    // Phase 1
    const key=(a,b,e)=>`${a},${b},${e}`, store=new Map(), cov=new Map();
    const covOf=L=>newNodes(L,null).map(p=>cov.get(key(p.a,p.b,p.e)));
    let n=[1,1,1], sized=0, doneNodes=0;
    for(let round=0;round<10;round++){
      const fresh=newNodes(lat,old).filter(p=>!store.has(key(p.a,p.b,p.e)));
      const chunk=Math.max(1,Math.min(64,Math.ceil(fresh.length/(4*R.size))));
      const jobs=[];
      for(let k=0;k<fresh.length;k+=chunk){
        const part=fresh.slice(k,k+chunk);
        jobs.push({part,msg:{type:'nodes',pts:part.map(p=>{ const hkl=plane.hkl(p.a,p.b); return {hkl,E:p.e,size:gridMode}; })}});
      }
      await R.run(jobs,(m,job)=>{
        m.out.forEach((o,i)=>{
          const p=job.part[i], k=key(p.a,p.b,p.e);
          store.set(k,o.r);
          cov.set(k,covariance(o.r));
          if(o.n){ for(let d=0;d<3;d++) n[d]=Math.max(n[d],o.n[d]); sized++; }
        });
        doneNodes+=job.part.length;
        show(shareA*Math.min(1,doneNodes/estNodes));
      });
      if(id!==state.run2D) return null;
      const next=refineLattice(lat,covOf(lat),bins,LATTICE_MAX_NODES);
      if(!next) break;
      old=lat; lat=next;
    }
    const covOfFinal=covOf(lat);
    const res=newNodes(lat,null).map(p=>store.get(key(p.a,p.b,p.e))||null);
    const first=res.find(Boolean);
    if(!first) throw new Error('No point of the map is reachable.');
    const integ=gridMode
      ? {mode:'grid',n:sizeGrid('2D',sized ? n : DEFAULT_GRID)}
      : {mode:'mc',samples:mcSamples('2D')};
    R.broadcast({type:'setup',lattice:{a:lat.a,b:lat.b,e:lat.e,res,rough:roughCells(lat,covOfFinal)},UB:first.UB,UBinv:inverse(first.UB),integ,E});

    // Phase 2
    const I=new Float64Array(nA*Bv.length*nE).fill(NaN);
    const per=Math.max(1,Math.ceil(nPts/nE/(8*R.size)));
    const jobs=[];
    items.forEach((row,ib)=>{
      for(let k=0;k<row.length;k+=per){
        const part=row.slice(k,k+per);
        jobs.push({ib,part,msg:{type:'row',items:part.map(it=>({hkl:it.hkl,a:A[it.ia],b:Bv[ib]}))}});
      }
    });
    let donePts=0;
    await R.run(jobs,(m,job)=>{
      job.part.forEach((it,k)=>{
        const o=(job.ib*nA+it.ia)*nE;
        for(let ie=0;ie<nE;ie++) I[o+ie]=m.I[k*nE+ie];
      });
      donePts+=job.part.length*nE;
      show(shareA+(1-shareA)*donePts/nPts);
    });
    if(id!==state.run2D) return null;
    return I;
  }

  // --------------------------------------------------------- time estimate --
  // Time = points × MC samples × (time per sample) + resolution matrices ×
  // (time per matrix).  The two unit times are measured once on this
  // computer with the loaded table and the current approximation.
  // Median time of k runs (single runs of a few ms are noisy: JIT, GC).
  const medianTime=(fn,k)=>{
    const t=[];
    for(let i=0;i<k;i++){ const t0=performance.now(); fn(); t.push(performance.now()-t0); }
    return t.sort((a,b)=>a-b)[Math.floor(k/2)];
  };
  function measureBench(){
    const base=collectResolutionBase();
    const key=`${state.fileName}|${state.data?.nBranch}|${base.approximation?.method}`;
    if(state.bench && state.bench.key===key) return state.bench;
    // A reachable table point: the centre first, then others (a table
    // centred on Q = 0 cannot be reached there).
    const at=(f)=>state.interp.axes.map((a,i)=>a[Math.round(f[i]*(a.length-1))]);
    const fr=[[0.5,0.5,0.5],[0.75,0.5,0.75],[1,0.5,1],[0.75,0.5,0.5],[0.5,0.5,0.75],[1,0.5,0.5],[0.5,0.5,1],[0.25,0.5,0.25],[0,0.5,0]];
    const Es=[state.data.eMin,(state.data.eMin+state.data.eMax)/2,state.data.eMax,1,5,10];
    let res=null, tRes=0, c=null;
    for(const f of fr){
      c=at(f);
      for(const E of Es){
        if(!resolutionAt(base,c,E,{})) continue;
        const t0=performance.now(); let r=null;
        for(let i=0;i<3;i++) r=resolutionAt(base,c,E,{});
        tRes=(performance.now()-t0)/3; res=r; break;
      }
      if(res) break;
    }
    if(!res) return null;
    const S=standardNormalSamples(4000);
    convolvePoint(c,res.energies ? (res.energies.Ei-res.energies.Ef) : 0,res,state.interp,S,{model:'given',skip:false});
    const tMC=medianTime(()=>convolvePoint(c,res.energies.Ei-res.energies.Ef,res,state.interp,S,{model:'given',skip:false}),5);
    // The test point has every sample inside the table; a real map or scan
    // has many outside it (cheaper), so the measured value is scaled down
    // (calibrated against full runs: estimates within about ±30 %).
    const tSample=0.75*tMC/4000;
    // Grid: time per node (two passes, a little more than an MC sample).
    const G=gaussianGrid([11,11,11]), Ec=res.energies.Ei-res.energies.Ef;
    convolvePointGrid(c,Ec,res,state.interp,G,{model:'given',skip:false});
    const tNode=0.75*medianTime(()=>convolvePointGrid(c,Ec,res,state.interp,G,{model:'given',skip:false}),9)/G.weights.length;
    state.bench={key,tRes,tSample,tNode};
    return state.bench;
  }
  const timeText=sec=>{
    if(!Number.isFinite(sec)) return '';
    if(sec<1) return 'Estimated time: < 1 s';
    if(sec<90) return `Estimated time: ~${Math.max(1,Math.round(sec))} s`;
    if(sec<5400) return `Estimated time: ~${(sec/60).toFixed(sec<600 ? 1 : 0)} min`;
    return `Estimated time: ~${(sec/3600).toFixed(1)} h`;
  };
  function updateEstimates(){
    for(const [id,fn] of [['convEstimate2D',estimate2D],['convEstimate1D',estimate1D]]){
      const el=$(id); if(!el) continue;
      let r={t:NaN};
      try{ if(state.interp) r=fn(); }catch(_e){ r={t:NaN}; }
      el.textContent=timeText(r.t);
    }
  }
  // Fraction of the given points that need the full grid (not skipped as
  // far from the dispersion), and the time of the check per point (ms).
  function nearFraction(base,pts){
    let near=0, k=0, dt=0;
    for(const p of pts){
      const res=resolutionAt(base,p.hkl,p.E,{});
      if(!res) continue;
      const t0=performance.now();
      k++; if(nearDispersion(p.hkl,p.E,res,state.interp)) near++;
      dt+=performance.now()-t0;
    }
    return {frac:k ? near/k : 1, tCheck:k ? dt/k : 0};
  }
  // Grid: the size is estimated from a few resolution points (3 × 3 × 3 in
  // the 2D range, 5 along the scan); the real run takes all of them.
  function estimate2D(){
    const b=measureBench(); if(!b) return {t:NaN};
    const g=fns.prepare2D();
    let per, n=null;
    // Points far from the dispersion are skipped after a quick check (Grid
    // and Monte Carlo): the full cost applies to the fraction near it
    // (sampled on a coarse subset of the map).
    const sub=(arr,k)=>arr.length<=k ? arr : Array.from({length:k},(_,i)=>arr[Math.round(i*(arr.length-1)/(k-1))]);
    const near=()=>{
      const sample=[];
      for(const a of sub(g.A,5)) for(const bb of sub(g.Bv,5)){
        const hkl=g.plane.hkl(a,bb);
        for(const e of sub(g.E,9)) sample.push({hkl,E:e});
      }
      return nearFraction(g.base,sample);
    };
    if(integrationMode('2D')==='mc'){
      const {frac,tCheck}=near();
      per=tCheck+frac*mcSamples('2D')*b.tSample;
    }
    else{
      const pick=arr=>[arr[0],arr[Math.floor(arr.length/2)],arr[arr.length-1]];
      const pts=[];
      for(const a of pick(g.A)) for(const bb of pick(g.Bv)) for(const e of pick(g.E)){
        const hkl=g.plane.hkl(a,bb);
        pts.push({hkl,E:e,res:resolutionAt(g.base,hkl,e,{})});
      }
      n=gridSizeFor('2D',pts);
      const {frac,tCheck}=near();
      per=tCheck+0.8*frac*n[0]*n[1]*n[2]*b.tNode;
    }
    // Shared between the cores (measured: 1.75 × on 2 cores).
    const k=workersAvailable() ? workerCount() : 1, speedup=1+0.75*(k-1);
    return {t:(g.nInside*g.E.length*per+g.nRes*b.tRes)/1000/speedup,n};
  }
  function estimate1D(){
    const b=measureBench(); if(!b) return {t:NaN};
    const sc=fns.scanPoints();
    let per, n=null;
    const base=collectResolutionBase(), m=sc.pts.length-1;
    const near=()=>nearFraction(base,[0,0.125,0.25,0.375,0.5,0.625,0.75,0.875,1].map(t=>sc.pts[Math.round(t*m)]));
    if(integrationMode('1D')==='mc'){
      const {frac,tCheck}=near();
      per=tCheck+frac*mcSamples('1D')*b.tSample;
    }
    else{
      const pts=[0,0.25,0.5,0.75,1].map(t=>sc.pts[Math.round(t*m)]).map(p=>({...p,res:resolutionAt(base,p.hkl,p.E,{})}));
      n=gridSizeFor('1D',pts);
      const {frac,tCheck}=near();
      per=tCheck+frac*n[0]*n[1]*n[2]*b.tNode;
    }
    return {t:sc.pts.length*(per+b.tRes)/1000,n};
  }
  const scheduleEstimates=()=>{ clearTimeout(state.estimateTimer); state.estimateTimer=setTimeout(updateEstimates,250); };
  Object.assign(fns,{resolutionAt, intensityAt, prefactor, inTable, tableRangeText, GRID_CHOICES, MC_CHOICES, GRID_DEFAULT, MC_DEFAULT, choice, mcSamples, gridMax, samplesFrom, fixChoices, integrationMode, showIntegration, gridSizeFor, DEFAULT_GRID, sizeGrid, integrationFor, grid, planeBasis, workerCount, workersAvailable, getWorkers, killWorkers, runJobs, workerRunner, pageRunner, run2DOn, medianTime, measureBench, timeText, updateEstimates, nearFraction, estimate2D, estimate1D, scheduleEstimates});
}
