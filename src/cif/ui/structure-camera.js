// Structure viewer: displayed range, camera and orientation triads.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installStructureCamera(ctx){
  const {deps:{
    $, getPropagationVectors, parseNumericValue
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    cameraFromRelayoutEvent, copyStructureCamera, currentStructureCamera,
    currentStructureCameraDistance, enabledPropagationVectorsForStructure,
    normalizeStructureRangeInputs, parseStructureRangeEntry, rangeCellBounds,
    startStructureCameraWatch, stopStructureCameraWatch, structureCameraForView, structureRange,
    structureRenderRange, updateStructureOrientationTriads
  });
function enabledPropagationVectorsForStructure(){
  const rows=(typeof getPropagationVectors==="function" ? getPropagationVectors() : []) || [];
  return rows.map((row,index)=>({
    index:index+1,
    h:parseNumericValue(row?.h),
    k:parseNumericValue(row?.k),
    l:parseNumericValue(row?.l),
    enabled:!!row?.enabled
  })).filter(q=>q.enabled && [q.h,q.k,q.l].every(Number.isFinite));
}
function parseStructureRangeEntry(value){
  const parts=String(value??"").trim().split(/[\s,]+/).filter(Boolean);
  let min=Number(parts[0]), max=Number(parts[1]);
  if(!Number.isFinite(min)) min=0;
  if(!Number.isFinite(max)) max=1;
  if(max<min) [min,max]=[max,min];
  if(Math.abs(max-min)<1e-9) max=min+1;
  return {min,max};
}
// The UI range is always expressed in the *selected* cell's fractional
// coordinates. Rendering uses the loaded magnetic-cell fractional coordinates.
function structureRenderRange(uiRange,source,parent){
  if(!source?.structure?.magnetic || cifState.structureUnitCellReference!=='crystallographic' || !parent)return uiRange;
  return Object.fromEntries(['x','y','z'].map((axis,i)=>[
    axis,{min:uiRange[axis].min/parent.rep[i],max:uiRange[axis].max/parent.rep[i]}
  ]));
}
function structureRange(){
  const out={};
  for(const axis of ["x","y","z"]){
    const cap=axis.toUpperCase();
    const legacy=$("cifRange"+cap);
    const minInput=$("cifRange"+cap+"Min");
    const maxInput=$("cifRange"+cap+"Max");
    if(minInput && maxInput){
      let min=Number(minInput.value), max=Number(maxInput.value);
      if(!Number.isFinite(min) || !Number.isFinite(max)){
        const parsed=parseStructureRangeEntry(legacy?.value);
        if(!Number.isFinite(min)) min=parsed.min;
        if(!Number.isFinite(max)) max=parsed.max;
      }
      if(max<min) [min,max]=[max,min];
      if(Math.abs(max-min)<1e-9) max=min+1;
      out[axis]={min,max};
    }else{
      out[axis]=parseStructureRangeEntry(legacy?.value);
    }
  }
  return out;
}
function normalizeStructureRangeInputs(){
  const range=structureRange();
  for(const axis of ["x","y","z"]){
    const cap=axis.toUpperCase();
    const legacy=$("cifRange"+cap);
    const minInput=$("cifRange"+cap+"Min");
    const maxInput=$("cifRange"+cap+"Max");
    if(minInput) minInput.value=String(range[axis].min);
    if(maxInput) maxInput.value=String(range[axis].max);
    // Keep the original combined entry synchronized for backward-compatible
    // localStorage state, but it is hidden once the split controls are built.
    if(legacy) legacy.value=`${range[axis].min} ${range[axis].max}`;
  }
  return range;
}
function rangeCellBounds(rangeAxis){
  return {from:Math.floor(rangeAxis.min),to:Math.ceil(rangeAxis.max)-1};
}
function structureCameraForView(viewMode,basis,distance=2.4){
  const viewVec=fn.vecNormalize(basis?.[viewMode] || basis?.cstar || [0,0,1]);
  const eye=fn.vecScale(viewVec,distance);
  // Fix the camera roll by choosing a crystallographic direction that should
  // lie horizontally on screen.  This is especially important for oblique
  // lattices: a global Cartesian up vector is not a reliable view reference.
  const horizontalAxis={a:"b",b:"a",c:"a",astar:"b",bstar:"a",cstar:"a"}[viewMode] || "a";
  // For b / b*, keep the positive c direction at the top of the view.
  const horizontalSign=(viewMode==="b" || viewMode==="bstar")?-1:1;
  const candidates=[basis?.[horizontalAxis],basis?.a,basis?.b,basis?.c,basis?.astar,basis?.bstar,basis?.cstar].filter(Boolean);
  let right=null;
  for(const candidate of candidates){
    const projected=fn.vecSub(candidate,fn.vecScale(viewVec,fn.vecDot(candidate,viewVec)));
    if(fn.vecNorm(projected)>1e-8){ right=fn.vecScale(fn.vecNormalize(projected),horizontalSign); break; }
  }
  if(!right){
    const fallback=Math.abs(viewVec[2])<0.9?[0,0,1]:[0,1,0];
    right=fn.vecNormalize(fn.vecCross(fallback,viewVec));
  }
  // Camera forward points from eye towards the origin.  up = right × forward.
  const up=fn.vecNormalize(fn.vecCross(right,fn.vecScale(viewVec,-1)));
  return {eye:{x:eye[0],y:eye[1],z:eye[2]},up:{x:up[0],y:up[1],z:up[2]},center:{x:0,y:0,z:0}};
}
function currentStructureCameraDistance(){
  const camera=currentStructureCamera() || $("cifStructurePlot")?._fullLayout?.scene?.camera;
  const eye=camera?.eye;
  const d=Math.hypot(Number(eye?.x)||0,Number(eye?.y)||0,Number(eye?.z)||0);
  return d>0.2 ? d : 2.4;
}
function currentStructureCamera(){
  const scene=$("cifStructurePlot")?._fullLayout?.scene;
  // _fullLayout.scene.camera can remain unchanged throughout a Plotly 3D drag.
  // The live WebGL scene, in contrast, tracks orbit/touch gestures each frame.
  let camera=null;
  try{
    const live=scene?._scene;
    if(live?.glplot && typeof live.getCamera==="function") camera=live.getCamera();
  }catch(_e){ /* fall back to Plotly's committed camera below */ }
  camera ||= scene?.camera;
  if(!camera?.eye) return null;
  const copy={
    eye:{x:Number(camera.eye.x)||0,y:Number(camera.eye.y)||0,z:Number(camera.eye.z)||0},
    up:{x:Number(camera.up?.x)||0,y:Number(camera.up?.y)||0,z:Number(camera.up?.z)||1},
    center:{x:Number(camera.center?.x)||0,y:Number(camera.center?.y)||0,z:Number(camera.center?.z)||0}
  };
  const d=Math.hypot(copy.eye.x,copy.eye.y,copy.eye.z);
  return d>0.2 ? copy : null;
}
function copyStructureCamera(camera){
  if(!camera?.eye) return null;
  const copy={
    eye:{x:Number(camera.eye.x)||0,y:Number(camera.eye.y)||0,z:Number(camera.eye.z)||0},
    up:{x:Number(camera.up?.x)||0,y:Number(camera.up?.y)||0,z:Number(camera.up?.z)||1},
    center:{x:Number(camera.center?.x)||0,y:Number(camera.center?.y)||0,z:Number(camera.center?.z)||0}
  };
  const d=Math.hypot(copy.eye.x,copy.eye.y,copy.eye.z);
  return d>0.2 ? copy : null;
}
function cameraFromRelayoutEvent(ev){
  if(!ev || typeof ev!=="object") return null;
  if(ev["scene.camera"]?.eye) return copyStructureCamera(ev["scene.camera"]);
  const base=copyStructureCamera(cifState.structureCameraState) || currentStructureCamera() || {eye:{x:1.55,y:1.55,z:1.25},up:{x:0,y:0,z:1},center:{x:0,y:0,z:0}};
  let touched=false;
  for(const part of ["eye","up","center"]){
    for(const axis of ["x","y","z"]){
      const key=`scene.camera.${part}.${axis}`;
      if(ev[key]!==undefined){ base[part][axis]=Number(ev[key])||0; touched=true; }
    }
  }
  return touched ? copyStructureCamera(base) : null;
}
function structureCameraForTriad(camera){
  return copyStructureCamera(camera) || cifState.structureCameraState || {eye:{x:1.55,y:1.55,z:1.25},up:{x:0,y:0,z:1},center:{x:0,y:0,z:0}};
}
function projectStructureDirection(v,camera){
  const c=structureCameraForTriad(camera);
  const eye=[c.eye.x,c.eye.y,c.eye.z];
  const forward=fn.vecNormalize(fn.vecScale(eye,-1));
  let up=fn.vecNormalize([c.up.x,c.up.y,c.up.z]);
  let right=fn.vecNormalize(fn.vecCross(forward,up));
  if(fn.vecNorm(right)<1e-9) right=[1,0,0];
  up=fn.vecNormalize(fn.vecCross(right,forward));
  const u=fn.vecNormalize(v);
  return {x:fn.vecDot(u,right),y:fn.vecDot(u,up),depth:fn.vecDot(u,forward)};
}
function renderStructureTriad(svg,names,vectors,camera){
  if(!svg) return;
  const NS="http://www.w3.org/2000/svg";
  const colors=["#d62728","#2ca02c","#1f77b4"];
  const center={x:80,y:80};
  const axisLength=54;
  const labelOffset=22;
  // Build SVG elements only once.  During camera rotation, updating attributes
  // instead of replacing the full SVG on every animation frame reduces jitter.
  const id=names.join("|");
  if(svg.dataset.triadAxes!==id || svg.querySelectorAll("line[data-triad-axis]").length!==3){
    svg.replaceChildren();
    const defs=document.createElementNS(NS,"defs");
    svg.appendChild(defs);
    names.forEach((name,i)=>{
      const marker=document.createElementNS(NS,"marker");
      marker.id=`${svg.id}-arrow-${i}`;
      marker.setAttribute("markerWidth","18");
      marker.setAttribute("markerHeight","18");
      marker.setAttribute("refX","8");
      marker.setAttribute("refY","5");
      marker.setAttribute("orient","auto");
      marker.setAttribute("markerUnits","userSpaceOnUse");
      marker.setAttribute("viewBox","0 0 10 10");
      const head=document.createElementNS(NS,"path");
      head.setAttribute("d","M 0 0 L 10 5 L 0 10 z");
      head.setAttribute("fill",colors[i]);
      marker.appendChild(head);
      defs.appendChild(marker);
      const line=document.createElementNS(NS,"line");
      line.dataset.triadAxis=String(i);
      line.setAttribute("x1",String(center.x));
      line.setAttribute("y1",String(center.y));
      line.setAttribute("stroke",colors[i]);
      line.setAttribute("stroke-width","4");
      line.setAttribute("stroke-linecap","round");
      line.setAttribute("marker-end",`url(#${marker.id})`);
      svg.appendChild(line);
      const text=document.createElementNS(NS,"text");
      text.dataset.triadAxis=String(i);
      text.setAttribute("fill",colors[i]);
      text.setAttribute("font-size","36");
      text.setAttribute("font-weight","700");
      text.setAttribute("text-anchor","middle");
      text.setAttribute("dominant-baseline","central");
      text.textContent=name;
      svg.appendChild(text);
    });
    svg.dataset.triadAxes=id;
  }
  const lines=svg.querySelectorAll("line[data-triad-axis]");
  const labels=svg.querySelectorAll("text[data-triad-axis]");
  vectors.forEach((v,i)=>{
    const p=projectStructureDirection(v,camera);
    const x2=center.x+p.x*axisLength;
    const y2=center.y-p.y*axisLength;
    lines[i].setAttribute("x2",String(x2));
    lines[i].setAttribute("y2",String(y2));
    const n=Math.hypot(p.x,p.y)||1;
    labels[i].setAttribute("x",String(x2+(p.x/n)*labelOffset));
    labels[i].setAttribute("y",String(y2-(p.y/n)*labelOffset));
  });
}
function updateStructureOrientationTriads(basis,camera=null){
  const c=structureCameraForTriad(camera || cifState.structureCameraState || currentStructureCamera());
  renderStructureTriad($("cifDirectTriad"),["a","b","c"],[basis.a,basis.b,basis.c],c);
  renderStructureTriad($("cifReciprocalTriad"),["a*","b*","c*"],[basis.astar,basis.bstar,basis.cstar],c);
}
function structureCameraSignature(camera){
  const c=copyStructureCamera(camera);
  if(!c) return "";
  return [c.eye.x,c.eye.y,c.eye.z,c.up.x,c.up.y,c.up.z,c.center.x,c.center.y,c.center.z]
    .map(v=>Number(v).toFixed(7)).join(",");
}
function stopStructureCameraWatch(){
  if(cifState.structureCameraWatchFrame) cancelAnimationFrame(cifState.structureCameraWatchFrame);
  cifState.structureCameraWatchFrame=0;
  cifState.structureCameraWatchSignature="";
}
function startStructureCameraWatch(){
  stopStructureCameraWatch();
  const tick=()=>{
    if(!fn.isStructurePanelVisible()){ cifState.structureCameraWatchFrame=0; return; }
    if(cifState.structureProgrammaticCameraUpdate){ cifState.structureCameraWatchFrame=requestAnimationFrame(tick); return; }
    const camera=currentStructureCamera();
    const sig=structureCameraSignature(camera);
    if(camera && sig && sig!==cifState.structureCameraWatchSignature){
      cifState.structureCameraWatchSignature=sig;
      cifState.structureCameraState=copyStructureCamera(camera);
      const latest=fn.directLatticeBasis(fn.currentStructureForViewer()?.structure?.lattice);
      if(latest) updateStructureOrientationTriads(latest,cifState.structureCameraState);
    }
    cifState.structureCameraWatchFrame=requestAnimationFrame(tick);
  };
  cifState.structureCameraWatchFrame=requestAnimationFrame(tick);
}
}
