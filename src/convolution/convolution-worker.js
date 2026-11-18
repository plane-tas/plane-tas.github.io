// Convolution worker: one of several that share a 2D map between the CPU
// cores.  It keeps its own copy of the dispersion table and of the
// resolution nodes and answers two jobs:
//   nodes: resolution matrices (and, for Grid, the automatic grid size) at
//          a list of (h, k, l, ħω) nodes;
//   row:   intensities of one row of the map (fixed V), every U and ħω.
import {parseDispersionTable, createDispersionInterpolator, standardNormalSamples, convolvePoint, convolvePointGrid, gaussianGrid, autoGridSize} from './convolution-core.js';
import {calcResolution} from '../resolution/resolution-core.js';
import {inverse} from '../core/matrix.js';

let interp=null, tableKey=null;
let base=null, UBinv=null;
let nodes=[];          // resolution at each node (null: not reachable)
let integ=null;        // {mode:'grid',grid,slope} or {mode:'mc',samples}
let Evals=[];          // ħω of the map

// Only what the convolution and the prefactor use travels between threads.
const slim=r=>r ? {RM:r.RM,UB:r.UB,energies:{Ef:r.energies.Ef},angles:{thetaA:r.angles.thetaA}} : null;
function resolutionAt(hkl,E){
  try{
    const r=calcResolution(base.lc,base.rl,base.col,base.mos,base.config,base.approximation,base.focusing,base.geom,
      {h:hkl[0],k:hkl[1],l:hkl[2],hw:E},'ainv');
    if(!UBinv) UBinv=inverse(r.UB);
    return slim(r);
  }catch(_e){ return null; }
}
const prefactor=r=>{
  const kf=Math.sqrt(r.energies.Ef/2.072), th=Math.abs(r.angles.thetaA)*Math.PI/180;
  return kf*kf*kf/Math.tan(th);
};

self.onmessage=ev=>{
  const msg=ev.data;
  try{
    if(msg.type==='table'){
      if(msg.key!==tableKey){ interp=createDispersionInterpolator(parseDispersionTable(msg.text,msg.format)); tableKey=msg.key; }
      return;
    }
    if(msg.type==='base'){ base=msg.base; UBinv=null; return; }
    if(msg.type==='nodes'){
      // msg.pts: [{hkl,E,size}] (size: also the automatic grid size).
      const out=msg.pts.map(p=>{
        const r=resolutionAt(p.hkl,p.E);
        let n=null, slope=0;
        if(r && p.size){ r.UBinv=UBinv; const a=autoGridSize(p.hkl,p.E,r,interp,{budget:Infinity}); n=a.n; slope=a.slope; delete r.UBinv; }
        return {r,n,slope};
      });
      self.postMessage({type:'nodes',id:msg.id,out});
      return;
    }
    if(msg.type==='setup'){
      UBinv=msg.UBinv; Evals=msg.E;
      nodes=msg.nodes.map(r=>r ? {...r,UBinv} : null);
      integ=msg.integ.mode==='mc'
        ? {mode:'mc',samples:standardNormalSamples(msg.integ.samples)}
        : {mode:'grid',grid:gaussianGrid(msg.integ.n),slope:msg.integ.slope};
      return;
    }
    if(msg.type==='row'){
      // msg.items: [{hkl,res:Int32Array(nE) node index per ħω}]; the reply has
      // the intensities item by item (nE each).
      const E=Evals, nE=E.length;
      const I=new Float64Array(msg.items.length*nE).fill(NaN);
      let outside=0, unreachable=0;
      for(let k=0;k<msg.items.length;k++){
        const it=msg.items[k];
        for(let ie=0;ie<nE;ie++){
          const r=nodes[it.res[ie]];
          if(!r){ unreachable++; continue; }
          const c=integ.mode==='grid'
            ? convolvePointGrid(it.hkl,E[ie],r,interp,integ.grid,{model:'given',slope:integ.slope})
            : convolvePoint(it.hkl,E[ie],r,interp,integ.samples,{model:'given'});
          if(c.outside>outside) outside=c.outside;
          I[k*nE+ie]=c.intensity*prefactor(r);
        }
      }
      self.postMessage({type:'row',id:msg.id,I,outside,unreachable},[I.buffer]);
      return;
    }
  }catch(err){
    self.postMessage({type:'error',id:msg.id,message:err?.message||String(err)});
  }
};
