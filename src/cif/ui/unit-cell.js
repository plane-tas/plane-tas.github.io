// Unit-cell edges and the crystallographic/magnetic/parent cell reference.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';

export function installUnitCell(ctx){
  const {deps:{
    $, getSelectedCifStructure, getSelectedCifText
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    structureUnitCellFrame, unitCellTraces, updateStructureUnitCellReference
  });
function buildOneCellEdgeTrace(basis,range){
  const x=[],y=[],z=[];
  const append=(p,q)=>{ x.push(p[0],q[0],null); y.push(p[1],q[1],null); z.push(p[2],q[2],null); };
  const ix=Math.floor((range.x.min+range.x.max)*0.5);
  const iy=Math.floor((range.y.min+range.y.max)*0.5);
  const iz=Math.floor((range.z.min+range.z.max)*0.5);
  const p=(fx,fy,fz)=>fn.fractionalToCartesian(basis,[fx,fy,fz]);
  const p000=p(ix,iy,iz), p100=p(ix+1,iy,iz), p010=p(ix,iy+1,iz), p001=p(ix,iy,iz+1);
  const p110=p(ix+1,iy+1,iz), p101=p(ix+1,iy,iz+1), p011=p(ix,iy+1,iz+1), p111=p(ix+1,iy+1,iz+1);
  for(const [a,b] of [[p000,p100],[p000,p010],[p000,p001],[p100,p110],[p100,p101],[p010,p110],[p010,p011],[p001,p101],[p001,p011],[p110,p111],[p101,p111],[p011,p111]]) append(a,b);
  return {type:"scatter3d",mode:"lines",x,y,z,name:"Unit cell",hoverinfo:"skip",showlegend:false,line:{color:"#000",width:3}};
}
function buildAllCellEdgeTrace(basis,range){
  const x=[],y=[],z=[];
  const append=(p,q)=>{ x.push(p[0],q[0],null); y.push(p[1],q[1],null); z.push(p[2],q[2],null); };
  const xb=fn.rangeCellBounds(range.x), yb=fn.rangeCellBounds(range.y), zb=fn.rangeCellBounds(range.z);
  const p=(fx,fy,fz)=>fn.fractionalToCartesian(basis,[fx,fy,fz]);
  for(let ix=xb.from;ix<=xb.to;ix++) for(let iy=yb.from;iy<=yb.to;iy++) for(let iz=zb.from;iz<=zb.to;iz++){
    const p000=p(ix,iy,iz), p100=p(ix+1,iy,iz), p010=p(ix,iy+1,iz), p001=p(ix,iy,iz+1);
    const p110=p(ix+1,iy+1,iz), p101=p(ix+1,iy,iz+1), p011=p(ix,iy+1,iz+1), p111=p(ix+1,iy+1,iz+1);
    for(const [a,b] of [[p000,p100],[p000,p010],[p000,p001],[p100,p110],[p100,p101],[p010,p110],[p010,p011],[p001,p101],[p001,p011],[p110,p111],[p101,p111],[p011,p111]]) append(a,b);
  }
  return {type:"scatter3d",mode:"lines",x,y,z,name:"Unit cells",hoverinfo:"skip",showlegend:false,line:{color:"#000",width:3}};
}
function unitCellTraces(basis,range){
  if(cifState.structureUnitCellMode==="none") return [];
  if(cifState.structureUnitCellMode==="all"){
    // Parent supercells can contain hundreds of thousands of nuclear cells.
    // Do not create unbounded Plotly line arrays for All cells.
    const count=['x','y','z'].reduce((product,axis)=>{
      const bounds=fn.rangeCellBounds(range[axis]);
      return product*Math.max(0,bounds.to-bounds.from+1);
    },1);
    if(!Number.isFinite(count)||count>1200){
      const traces=[];
      traces.warning=' Unit-cell frames hidden: more than 1200 outlines. Reduce the X/Y/Z view range or select One cell.';
      return traces;
    }
  }
  return [cifState.structureUnitCellMode==="all" ? buildAllCellEdgeTrace(basis,range) : buildOneCellEdgeTrace(basis,range)];
}
// A magnetic structure can use an enlarged lattice. Choose ONLY the unit-cell
// FRAME here; do not modify source atoms, magnetic moments, or reflection hkl.
// Without explicit parent/child mapping the magnetic lattice is the only safe
// option. In particular never divide by k heuristically for arbitrary mCIFs.
function resolvedViewerParent(source){
  if(!source?.structure?.magnetic)return null;
  const selected=getSelectedCifStructure();
  // A separately generated preview must not borrow unrelated selected-file metadata.
  if(!selected || source.structure.asymmetricSites!==selected.asymmetricSites)return null;
  const text=getSelectedCifText();
  const q=fn.propagationVectorsFromMcif(text,selected);
  if(q.length>1)return null;
  const parent=parentIndexingFromMcif(text,selected.lattice,q.length?[q[0].h,q[0].k,q[0].l]:null)
    || (q.length===1 ? fn.estimatedParentIndexingFromMcif(selected,text) : null);
  if(q.length===1 && parent?.replication && ![q[0].h,q[0].k,q[0].l].every((v,i)=>
       Math.abs(Number(v)*parent.replication[i]-Math.round(Number(v)*parent.replication[i]))<1e-8))return null;
  if(!parent || !Array.isArray(parent.replication) || parent.replication.length!==3 ||
     !parent.replication.every(n=>Number.isInteger(n)&&n>=1))return null;
  const parentStructure=fn.parentNuclearStructureFromMcif(selected,text);
  if(!parentStructure)return null;
  // The viewer may use edited magnetic-lattice lengths. Derive the *display*
  // frame from that same actual basis so its edges stay registered with atoms.
  const rep=parent.replication;
  const magLattice=source.structure.lattice;
  const lattice={...magLattice,a:Number(magLattice.a)/rep[0],
    b:Number(magLattice.b)/rep[1],c:Number(magLattice.c)/rep[2]};
  if(!fn.directLatticeBasis(lattice))return null;
  return {lattice,rep,structure:parentStructure};
}
function updateStructureUnitCellReference(source){
  const select=$("cifUnitCellReference");
  const magnetic=!!source?.structure?.magnetic;
  const parent=magnetic?resolvedViewerParent(source):null;
  if(!select)return parent;
  const parentOption=select.querySelector('option[value="crystallographic"]');
  const magneticOption=select.querySelector('option[value="magnetic"]');
  if(parentOption){
    parentOption.disabled=magnetic&&!parent;
    parentOption.title=parentOption.disabled?'Parent-cell transformation is absent or unsupported in this mCIF.':'';
  }
  if(magneticOption)magneticOption.disabled=!magnetic;
  // Keep a user-selected reference when possible. Never fabricate a parent.
  if(magnetic&&!parent && cifState.structureUnitCellReference==='crystallographic')
    cifState.structureUnitCellReference='magnetic';
  else if(!magnetic) cifState.structureUnitCellReference='crystallographic';
  select.value=cifState.structureUnitCellReference;
  select.title=magnetic&&!parent?'Crystallographic cell unavailable: explicit parent mapping required.':'';
  return parent;
}
function structureUnitCellFrame(source,basis,range,parent){
  const fallback={basis,range,parent:false};
  if(cifState.structureUnitCellReference!=='crystallographic'||!parent)return fallback;
  const parentBasis=fn.directLatticeBasis(parent.lattice),rep=parent.rep;
  if(!parentBasis)return fallback;
  const parentRange=Object.fromEntries(['x','y','z'].map((axis,i)=>[
    axis,{min:range[axis].min*rep[i],max:range[axis].max*rep[i]}
  ]));
  if(cifState.structureUnitCellMode==='one'){
    for(const axis of ['x','y','z']){
      const bounds=parentRange[axis];
      const first=bounds.min<=0 && bounds.max>=1 ? 0 : Math.floor(bounds.min);
      parentRange[axis]={min:first,max:first+1};
    }
  }
  return {basis:parentBasis,range:parentRange,parent:true};
}
}
