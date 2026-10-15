// Magnetic moment arrows and propagation-vector selection for the viewer.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {collinearSignAmbiguous, modulatedMoment} from '../../magnetic/magnetic-reflections.js';
export function installMomentTraces(ctx){
  const {deps:{
    $, PI
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    bindStructureK1Inputs, effectivePropagationVectorForStructure, magneticStructureTraces,
    refreshMomentPropagationVectorSelect, rotateVectorAroundAxis, structureMomentRotationAxisVector
  });
function atomMomentSetting(atom,settings,structure){
  if(fn.spinEditingIsIndividual(structure)) return fn.individualSettingForAtom(atom,structure,settings);
  const sourceIndex=Number.isInteger(atom.sourceSiteIndex)?atom.sourceSiteIndex:null;
  if(sourceIndex!==null){
    const site=(structure?.asymmetricSites||[])[sourceIndex];
    if(site) return settings.get(fn.momentKey({...site,siteIndex:sourceIndex}))||null;
  }
  const candidates=[...settings.entries()];
  const label=String(atom.sourceLabel||"");
  if(label){ const hit=candidates.find(([key])=>key.endsWith(`:${label}`)); if(hit) return hit[1]; }
  return null;
}
function appendSolidArrowHead(mesh,tip,dir,headLength,color){
  const length=Math.max(0.01,Number(headLength)||0.5);
  const radius=length*0.42;
  const baseCenter=fn.vecSub(tip,fn.vecScale(dir,length));
  const helper=Math.abs(dir[2])<0.9?[0,0,1]:[0,1,0];
  const p1=fn.vecNormalize(fn.vecCross(dir,helper));
  const p2=fn.vecNormalize(fn.vecCross(dir,p1));
  const segments=10;
  const baseStart=mesh.x.length;
  for(let n=0;n<segments;n++){
    const a=2*PI*n/segments;
    const p=fn.vecAdd(baseCenter,fn.vecAdd(fn.vecScale(p1,radius*Math.cos(a)),fn.vecScale(p2,radius*Math.sin(a))));
    mesh.x.push(p[0]); mesh.y.push(p[1]); mesh.z.push(p[2]);
  }
  const tipIndex=mesh.x.length;
  mesh.x.push(tip[0]); mesh.y.push(tip[1]); mesh.z.push(tip[2]);
  const centerIndex=mesh.x.length;
  mesh.x.push(baseCenter[0]); mesh.y.push(baseCenter[1]); mesh.z.push(baseCenter[2]);
  for(let n=0;n<segments;n++){
    const a=baseStart+n, b=baseStart+((n+1)%segments);
    mesh.i.push(a); mesh.j.push(b); mesh.k.push(tipIndex);
    mesh.i.push(centerIndex); mesh.j.push(b); mesh.k.push(a);
  }
  mesh.color=color;
  return baseCenter;
}
function structureMomentRotationAxisVector(basis){
  const key=["a","b","c"].includes(String(cifState.structureMomentRotationAxis||"")) ? String(cifState.structureMomentRotationAxis) : "c";
  return fn.vecNormalize(basis?.[key]||basis?.c||[0,0,1]);
}
function rotateVectorAroundAxis(v,axis,angle){
  const n=fn.vecNormalize(axis);
  const c=Math.cos(angle), s=Math.sin(angle);
  return fn.vecAdd(fn.vecAdd(fn.vecScale(v,c),fn.vecScale(fn.vecCross(n,v),s)),fn.vecScale(n,fn.vecDot(n,v)*(1-c)));
}
function effectivePropagationVectorForStructure(){
  const qs=fn.enabledPropagationVectorsForStructure();
  if(!qs.length) return {h:0,k:0,l:0,index:0,count:0};
  let q=qs.find(item=>item.index===cifState.structureMomentPropagationIndex);
  if(!q){
    q=qs[0];
    cifState.structureMomentPropagationIndex=q.index;
  }
  return {h:q.h,k:q.k,l:q.l,index:q.index,count:qs.length};
}
// Sidebar k1 is the single source of truth. Structure input fields mirror it
// in both directions; the sidebar's existing listeners handle calculations and
// its localStorage persistence, so no competing draft is introduced.
const STRUCTURE_K1_SIDES={h:'cifMomentK1H',k:'cifMomentK1K',l:'cifMomentK1L'};
function syncStructureK1FromSidebar(){
  for(const [axis,id] of Object.entries(STRUCTURE_K1_SIDES)){
    const target=$(id),sidebar=$(`q1_${axis}`);
    if(target && sidebar && target!==document.activeElement && target.value!==sidebar.value)
      target.value=sidebar.value;
  }
}
function bindStructureK1Inputs(){
  for(const [axis,id] of Object.entries(STRUCTURE_K1_SIDES)){
    const target=$(id);
    if(!target || target.dataset.k1Bound)continue;
    target.dataset.k1Bound='1';
    const commit=event=>{
      const sidebar=$(`q1_${axis}`);
      if(!sidebar)return;
      sidebar.value=target.value;
      // Delegate to the existing propagation-vector handlers, including the
      // input/change persistence and magnetic/Structure recalculation paths.
      sidebar.dispatchEvent(new Event(event.type,{bubbles:true}));
    };
    target.addEventListener('input',commit);
    target.addEventListener('change',commit);
  }
  const host=$('propagationVectors');
  if(host && !host.dataset.structureK1Bound){
    host.dataset.structureK1Bound='1';
    host.addEventListener('input',syncStructureK1FromSidebar);
    host.addEventListener('change',syncStructureK1FromSidebar);
    // The sidebar rebuilds q1 on file import and saved-state restoration.
    if(typeof MutationObserver==='function') new MutationObserver(syncStructureK1FromSidebar)
      .observe(host,{childList:true,subtree:true});
  }
  syncStructureK1FromSidebar();
}
function refreshMomentPropagationVectorSelect(){
  syncStructureK1FromSidebar();
  const select=$("cifMomentPropagationVector");
  if(!select) return;
  const qs=fn.enabledPropagationVectorsForStructure();
  const previous=cifState.structureMomentPropagationIndex;
  select.replaceChildren();
  if(!qs.length){
    const option=document.createElement("option");
    option.value="0"; option.textContent="None (k = 0, 0, 0)";
    select.appendChild(option);
    select.value="0"; select.disabled=true;
    cifState.structureMomentPropagationIndex=0;
    return;
  }
  select.disabled=false;
  for(const q of qs){
    const option=document.createElement("option");
    option.value=String(q.index);
    option.textContent=`k${q.index}`;
    select.appendChild(option);
  }
  const chosen=qs.some(q=>q.index===previous)?previous:qs[0].index;
  cifState.structureMomentPropagationIndex=chosen;
  if(fn.sourceIsMagneticCif() && !cifState.importedMagneticEditMode){
    const imported=document.createElement("option");
    imported.value="mcif"; imported.textContent="mCIF";
    select.prepend(imported);
    select.value="mcif";
  }else select.value=String(chosen);
}
function magneticStructureTraces(atoms,basis,structure){
  cifState.collinearAmbiguousDisplayed=0;
  const q=effectivePropagationVectorForStructure();
  const settings=fn.currentMomentSettings();
  if(!settings.size) return [];
  const rotationAxis=structureMomentRotationAxisVector(basis);
  const groups=new Map();
  for(const atom of atoms){
    const setting=atomMomentSetting(atom,settings,structure);
    if(!setting?.enabled) continue;
    // mCIF supplies the site-resolved magnetic moment. Preserve its canting.
    // mCIF crystalaxis components must be transformed with the actual
    // magnetic cell vectors (as in Sunny), not reinterpreted as UI XYZ values.
    // mCIF moments are axial crystalaxis vectors, NOT fractional positions.
    // Their symmetry-transformed components are mapped to physical Cartesian
    // coordinates with the magnetic unit-cell basis exactly once (Sunny).
    // Never synthesize a spin along c for sites missing an mCIF moment.
    if(structure?.magnetic && !cifState.importedMagneticEditMode &&
       !Array.isArray(atom.magneticMoment) && !atom.magneticFourier) continue;
    const frac=[Number.isFinite(atom.phaseX)?atom.phaseX:atom.x,Number.isFinite(atom.phaseY)?atom.phaseY:atom.y,Number.isFinite(atom.phaseZ)?atom.phaseZ:atom.z];
    const crystalMoment=(Array.isArray(atom.magneticMoment)||atom.magneticFourier)
      ? fn.atomCrystalMoment(atom,frac) : null;
    // After an edit, user-controlled site moments and the selected model take
    // precedence over source magnetic symmetry. Do not reuse old symmetry.
    const moment=(!cifState.importedMagneticEditMode && crystalMoment)
      ? fn.mcifCrystalAxisToCartesian(basis,crystalMoment)
      : [Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0];
    const mnorm=fn.vecNorm(moment);
    if(!(mnorm>1e-12)) continue;
    let dir=fn.vecNormalize(moment);
    let amplitude=1;
    if(!cifState.importedMagneticEditMode && (Array.isArray(atom.magneticMoment) || atom.magneticFourier)){
      // Before editing, display the original symmetry/Fourier moments.
    }else if(fn.spinEditingIsIndividual(structure)){
      // The user supplies each supercell vector; do not synthesize k modulation.
    }else{
      // Same single-k model as the magnetic-reflection calculator and the
      // mCIF export (modulatedMoment): phase 2*pi*k.r of the atom position r.
      const kr=q.h*frac[0]+q.k*frac[1]+q.l*frac[2];
      if(cifState.structureMomentStructureType==='collinear' && collinearSignAmbiguous(kr)) cifState.collinearAmbiguousDisplayed=(cifState.collinearAmbiguousDisplayed||0)+1;
      const modulated=modulatedMoment(moment,kr,{mode:cifState.structureMomentStructureType,
        axis:rotationAxis,chirality:cifState.structureMomentChirality});
      const mod=fn.vecNorm(modulated);
      if(cifState.structureMomentStructureType==="sinusoidal" && mod<1e-5*mnorm) continue;
      dir=fn.vecNormalize(modulated);
      amplitude=mod/mnorm;
    }
    // Length is only a display multiplier. The original Cartesian moment
    // (including its magnitude in mu_B) stays unchanged for mCIF export.
    // Using the norm here preserves relative arrow lengths between distinct
    // magnetic ions: e.g. 2 mu_B and 1 mu_B display at a 2:1 ratio.
    const displayMultiplier=Number(cifState.structureMomentGlobalLength);
    const length=(Number.isFinite(displayMultiplier) ? Math.max(0.05,displayMultiplier) : 1)*mnorm*amplitude;
    if(!(length>1e-12)) continue;
    const width=Math.max(1,Number(cifState.structureMomentGlobalWidth)||10);
    // Avoid a fixed arrowhead minimum that could dwarf small moments.
    const headLength=Math.min(Math.max(0.01,Number(cifState.structureMomentGlobalHeadSize)||0.51),2*length*0.95);
    const center=fn.fractionalToCartesian(basis,frac);
    // Length is the center-to-end (half-length) setting.  The displayed arrow
    // is symmetric about the atom position: tail = center - L*dir,
    // tip = center + L*dir, so the atom sits at the arrow midpoint.
    const start=fn.vecSub(center,fn.vecScale(dir,length));
    const tip=fn.vecAdd(center,fn.vecScale(dir,length));
    const color=setting.color||fn.elementColor(atom.element);
    const key=`${color}|${width}`;
    if(!groups.has(key)) groups.set(key,{color,width,x:[],y:[],z:[],mesh:{x:[],y:[],z:[],i:[],j:[],k:[],color}});
    const g=groups.get(key);
    const shaftEnd=appendSolidArrowHead(g.mesh,tip,dir,headLength,color);
    g.x.push(start[0],shaftEnd[0],null);
    g.y.push(start[1],shaftEnd[1],null);
    g.z.push(start[2],shaftEnd[2],null);
  }
  const traces=[];
  for(const g of groups.values()){
    if(g.x.length) traces.push({type:"scatter3d",mode:"lines",x:g.x,y:g.y,z:g.z,name:"Magnetic moments",hoverinfo:"skip",showlegend:false,line:{color:g.color,width:g.width}});
    if(g.mesh.x.length) traces.push({type:"mesh3d",x:g.mesh.x,y:g.mesh.y,z:g.mesh.z,i:g.mesh.i,j:g.mesh.j,k:g.mesh.k,color:g.color,flatshading:true,opacity:1,hoverinfo:"skip",showscale:false,showlegend:false,name:"Magnetic moment heads"});
  }
  return traces;
}
}
