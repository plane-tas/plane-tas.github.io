// Structure rendering (Plotly 3D) and figure export.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installStructureRender(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    isStructurePanelVisible, renderCifStructureIfVisible, renderCifStructureView,
    saveStructureFigure
  });
function isStructurePanelVisible(){
  const panel=$("structurePanel");
  return !!panel && !panel.classList.contains("hidden");
}
function renderCifStructureIfVisible(){
  // Keep the shared Structure editor up to date regardless of which output
  // preview is selected. Updating Atoms/Spins/Bonds must not depend on Plotly
  // or on the visibility of the 3D Structure tab.
  const source=fn.currentStructureForViewer();
  if(source?.structure?.magnetic && !cifState.importedMagneticEditMode &&
     !cifState.structureModifyLocked && cifState.importedMagneticQSignature && fn.propagationSignature()!==cifState.importedMagneticQSignature){
    fn.activateImportedMagneticEditing();
  }
  fn.syncImportedMomentStructureType();
  if(source?.structure) fn.syncStructureControlRows(source.structure);
  fn.syncSpinModifyLock();
  fn.rememberModifiedMagneticDraft();
  if(isStructurePanelVisible() && $("mcifStructurePane") && !$("mcifStructurePane").classList.contains("hidden")) renderCifStructureView();
}

function loadFigureOverlayImage(url){
  return new Promise((resolve,reject)=>{const img=new Image(); img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("Could not render figure overlay"));img.src=url;});
}
async function saveStructureFigure(){
  const plot=$("cifStructurePlot"), wrap=plot?.closest(".structure-plot-wrap");
  if(!plot || !wrap || !plot._fullLayout || typeof Plotly?.toImage!=="function") throw new Error("Draw the structure before saving a figure.");
  // Layout and screen dimensions match because the UI is not transformed.
  const layoutRect=element=>element.getBoundingClientRect();
  const bounds=layoutRect(wrap), pb=layoutRect(plot);
  if(bounds.width<1 || bounds.height<1) throw new Error("The structure is not visible.");
  const scale=1,canvas=document.createElement("canvas");
  canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
  const ctx=canvas.getContext("2d");ctx.scale(scale,scale);
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,bounds.width,bounds.height);
  // Plotly export sometimes uses a stale view camera; snapshot the live scene first.
  // Export at display resolution, avoiding the expensive 2x WebGL re-render.
  const camera=fn.currentStructureCamera();
  const previousCamera=plot.layout?.scene?.camera;
  if(camera && plot.layout?.scene) plot.layout.scene.camera=fn.copyStructureCamera(camera);
  let data;
  try{ data=await Plotly.toImage(plot,{format:"png",width:Math.max(2,Math.round(pb.width)),height:Math.max(2,Math.round(pb.height)),scale:1}); }
  finally{if(plot.layout?.scene) plot.layout.scene.camera=previousCamera;}
  const base=await loadFigureOverlayImage(data);
  ctx.drawImage(base,pb.left-bounds.left,pb.top-bounds.top,pb.width,pb.height);
  // Render the element legend using computed CSS and its current DOM positions.
  const legend=$("cifAtomLegend");
  if(legend && !legend.classList.contains("hidden")){
    const r=layoutRect(legend),style=getComputedStyle(legend);
    ctx.fillStyle=style.backgroundColor==="rgba(0, 0, 0, 0)"?"rgba(255,255,255,0.90)":style.backgroundColor;
    ctx.fillRect(r.left-bounds.left,r.top-bounds.top,r.width,r.height);
    for(const item of legend.querySelectorAll(".structure-atom-legend-item")){
      const ir=layoutRect(item),dot=item.querySelector(".structure-atom-legend-dot"),dr=dot?layoutRect(dot):null;
      if(dr){ctx.fillStyle=getComputedStyle(dot).backgroundColor;ctx.beginPath();ctx.arc(dr.left-bounds.left+dr.width/2,dr.top-bounds.top+dr.height/2,Math.min(dr.width,dr.height)/2,0,Math.PI*2);ctx.fill();}
      ctx.font=getComputedStyle(item).font||"18px sans-serif";ctx.fillStyle=getComputedStyle(item).color||"#222";
      const text=item.querySelector("span")?.textContent||item.textContent;
      ctx.textBaseline="middle";ctx.fillText(text,(dr?.right||ir.left)-bounds.left+7,ir.top-bounds.top+ir.height/2);
    }
  }
  // Both SVG triads are live camera-synchronized overlays. Serialize them at the
  // last displayed orientation, without resetting or changing the 3D camera.
  for(const id of ["cifDirectTriad","cifReciprocalTriad"]){
    const el=$(id);if(!el) continue;
    const r=layoutRect(el);if(!r.width||!r.height)continue;
    const bg=getComputedStyle(el).backgroundColor;
    if(bg && bg!=="rgba(0, 0, 0, 0)"){ctx.fillStyle=bg;ctx.fillRect(r.left-bounds.left,r.top-bounds.top,r.width,r.height);}
    const clone=el.cloneNode(true);
    clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width",String(r.width));clone.setAttribute("height",String(r.height));
    const source=new XMLSerializer().serializeToString(clone);
    const url=URL.createObjectURL(new Blob([source],{type:"image/svg+xml;charset=utf-8"}));
    try{const img=await loadFigureOverlayImage(url);ctx.drawImage(img,r.left-bounds.left,r.top-bounds.top,r.width,r.height);}finally{URL.revokeObjectURL(url);}
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(!blob) throw new Error("Could not encode PNG image.");
  const href=URL.createObjectURL(blob),link=document.createElement("a");
  link.download="structure-figure.png";link.href=href;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1500);
}
function renderCifStructureView(){
  const plot=$("cifStructurePlot"),status=$("cifStructureStatus");
  if(!plot||!status) return;
  if(typeof Plotly==="undefined"){ status.textContent="Plotly is unavailable, so the structure view cannot be drawn."; return; }
  const source=fn.currentStructureForViewer();
  fn.syncImportedMomentStructureType();
  if(!source?.structure){ status.textContent="No CIF structure is available yet. Load/select a CIF or enter a valid CIF Generator structure."; Plotly.purge(plot); return; }
  const basis=fn.directLatticeBasis(source.structure.lattice);
  if(!basis){ status.textContent="The CIF lattice parameters are invalid, so the structure view cannot be drawn."; Plotly.purge(plot); return; }
  // A browser OOM can kill JS without running an error handler. Leave an
  // in-progress marker until this Plotly render completes successfully.
  window.__tasStructureCrashGuard?.begin();
  fn.syncStructureControlRows(source.structure);
  const parentFrame=fn.updateStructureUnitCellReference(source);
  const range=fn.structureRenderRange(fn.structureRange(),source,parentFrame);
  if(fn.estimateStructureReplicationTests(source.structure,range)>cifState.STRUCTURE_MAX_REPLICATION_TESTS){
    status.textContent='Structure not drawn: display range is too large. Reduce X/Y/Z repeat ranges.';
    Plotly.purge(plot);window.__tasStructureCrashGuard?.complete();return;
  }
  const atoms=fn.replicatedAtoms(source.structure,range);
  if(atoms.length>cifState.STRUCTURE_MAX_DISPLAYED_ATOMS){
    status.textContent=`Structure not drawn: more than ${cifState.STRUCTURE_MAX_DISPLAYED_ATOMS} displayed atoms. Reduce X/Y/Z repeat ranges.`;
    Plotly.purge(plot);window.__tasStructureCrashGuard?.complete();return;
  }
  if(!atoms.length){ status.textContent="The current CIF contains no atoms to display."; Plotly.purge(plot);window.__tasStructureCrashGuard?.complete(); return; }
  const displayedAtoms=atoms.filter(fn.atomIsVisible);
  const selectedPositionSites=fn.selectedPositionSourceSiteIndices(source.structure);
  let highlighted=displayedAtoms.filter(atom=>
    fn.selectedSpinContainsAtom(atom) || fn.selectedPositionContainsAtom(atom,selectedPositionSites) ||
    fn.selectedAppearanceContainsAtom(atom));
  if(!selectedPositionSites.size && cifState.structureSpinEditingMode==='individual' && !fn.spinEditingIsIndividual(source.structure)){
    // The unmodified imported mCIF uses linked source rows even when Manual
    // is selected. Highlight just one representative of each chosen site.
    const seen=new Set();
    highlighted=highlighted.filter(atom=>{
      const id=Number.isInteger(atom.sourceSiteIndex)?`site:${atom.sourceSiteIndex}`
        : `label:${atom.sourceLabel||atom.element}`;
      if(seen.has(id))return false;
      seen.add(id);return true;
    });
  }

  const highlightedAtomSet=new Set(highlighted);
  const grouped=new Map();
  for(const atom of displayedAtoms){
    const key=JSON.stringify([atom.element,fn.atomDisplayColor(atom),fn.atomDisplaySize(atom)]);
    if(!grouped.has(key))grouped.set(key,{element:String(atom.element),color:fn.atomDisplayColor(atom),size:fn.atomDisplaySize(atom),atoms:[]});
    grouped.get(key).atoms.push(atom);
  }
  const bondRules=fn.readStructureBondRules();
  const maxCellDistance=fn.styleCellDiagonalLimit(basis);
  const validRule=rule=>fn.safeStyleDistances(rule.minDistance,rule.maxDistance,maxCellDistance);
  const oversizedRules=bondRules.filter(rule=>!validRule(rule));
  const drawableBondRules=bondRules.filter(validRule);
  const styleCutoffWarning=oversizedRules.length
    ?` ${oversizedRules.length} Style rule(s) not drawn: Max must not exceed the unit-cell diagonal (${maxCellDistance.toFixed(3)} Å). Edit Max; values are saved.`
    :'';
  const cellFrame=fn.structureUnitCellFrame(source,basis,range,parentFrame);
  const cellTraces=fn.unitCellTraces(cellFrame.basis,cellFrame.range);
  if(cellFrame.parent) for(const trace of cellTraces) trace.name='Parent unit cell';
  // The Style radio buttons used to be cosmetic: only bonds were drawn.
  // Always rebuild from current DOM rules so deleting the last ON row really
  // removes ALL stale line/mesh geometry from the next Plotly.react call.
  const traces=[...cellTraces];
  let polyhedralWarning='';
  let bondWarning='';
  const bondRulesForDraw=drawableBondRules.filter(rule=>rule.enabled!==false&&rule.bonds!==false);
  const polyhedralRulesForDraw=drawableBondRules.filter(rule=>rule.enabled!==false&&rule.polyhedral===true);
  if(bondRulesForDraw.length){
    const bondLines=fn.bondTraces(displayedAtoms,basis,bondRulesForDraw);
    bondWarning=bondLines.warning||'';
    traces.push(...bondLines);
  }
  if(polyhedralRulesForDraw.length){
    const activeRules=polyhedralRulesForDraw;
    if(activeRules.length){
      // The local-search implementation visits only periodic images around
      // each actual A1 centre, independently of the size of the displayed cell.
      const mesh=fn.coordinationPolyhedralTraces(displayedAtoms,source.structure,basis,activeRules);
      polyhedralWarning=mesh.warning;
      traces.push(...mesh.traces);
    }
  }
  const orderedElements=fn.structureElements(source.structure);
  const shownElements=new Set();
  for(const group of grouped.values()){
    const {element,color,size,atoms:list}=group;
    const xs=[],ys=[],zs=[],texts=[];
    for(const atom of list){
      const cart=fn.fractionalToCartesian(basis,[atom.x,atom.y,atom.z]);
      xs.push(cart[0]);ys.push(cart[1]);zs.push(cart[2]);
      // Put the selection status on the ORIGINAL atom hover label, not on the
      // outline trace. The ring should never hide the site coordinates.
      const selectionSuffix=highlightedAtomSet.has(atom)?' (selected)':'';
      texts.push(`${atom.sourceLabel||element}${selectionSuffix}<br>frac=(${atom.x.toFixed(3)}, ${atom.y.toFixed(3)}, ${atom.z.toFixed(3)})`);
    }
    traces.push({type:"scatter3d",mode:"markers",name:element,showlegend:!shownElements.has(element),x:xs,y:ys,z:zs,text:texts,hovertemplate:"%{text}<extra></extra>",marker:{size,color,line:{color:"#333",width:0.8},opacity:0.92}});
    shownElements.add(element);
  }
  fn.updateStructureAtomLegend(orderedElements.filter(element=>shownElements.has(element)));
  // Selection outlines belong only to the viewer, never to magnetic calculations.
  // Draw a complementary-color ring around each selected atom, retaining the
  // original stroke width and small gap around the atom's surface.
  const magneticOverlays=fn.magneticStructureTraces(displayedAtoms,basis,source.structure); traces.push(...magneticOverlays);
  const magneticSummary=fn.enabledPropagationVectorsForStructure();
  const effectiveK=fn.effectivePropagationVectorForStructure();
  const enabledMoments=[...fn.currentMomentSettings().values()].filter(x=>x.enabled).length;
  const uiRange=fn.structureRange();
  status.textContent=`${source.label}: x ${uiRange.x.min}–${uiRange.x.max}, y ${uiRange.y.min}–${uiRange.y.max}, z ${uiRange.z.min}–${uiRange.z.max} (${cifState.structureUnitCellReference} fractions); ${displayedAtoms.length} displayed atoms.`+
    (cifState.structureUnitCellMode!=='none' && source.structure.magnetic && !parentFrame ?
      ' Parent-cell setting unavailable: showing magnetic cell.':
      cellFrame.parent && cifState.structureUnitCellMode!=='none' ? ' Crystallographic unit cell shown.':
      source.structure.magnetic && cifState.structureUnitCellMode!=='none' ? ' Magnetic unit cell shown.':'')+
    (bondRules.length?` ${bondRules.length} bond rule${bondRules.length===1?"":"s"}.`:"")+
    (source.structure.magnetic?" mCIF moments from magnetic symmetry/Fourier modulation.":enabledMoments?` ${enabledMoments} magnetic site setting${enabledMoments===1?"":"s"}; ${cifState.structureMomentStructureType}${cifState.structureMomentStructureType==="helical"?` about ${cifState.structureMomentRotationAxis} (${cifState.structureMomentChirality})`:""}, k${effectiveK.index||1}=(${effectiveK.h}, ${effectiveK.k}, ${effectiveK.l})${effectiveK.count>1?" (selected propagation vector)":""}.`:"")+ (polyhedralWarning ? ` ${polyhedralWarning}` : "")+
    (bondWarning ? ` ${bondWarning}` : "")+(cellTraces.warning||'')+styleCutoffWarning;
  // Keep an explicit camera state independent of Plotly.react.  This prevents
  // later redraws (including range edits) from restoring the view-button camera
  // after the user has already rotated or zoomed the structure.
  const liveCamera=fn.currentStructureCamera();
  const mainCamera=fn.copyStructureCamera(cifState.structureCameraState) || liveCamera || fn.structureCameraForView(cifState.cifStructureViewMode,basis,fn.currentStructureCameraDistance());
  cifState.structureCameraState=fn.copyStructureCamera(mainCamera);
  // A thicker complementary-color ring, with its INNER edge at about 1.5x
  // the displayed atom radius (i.e. a visible gap even with the thicker line).
  // Plotly marker.size specifies diameter, so add the ring stroke once to the
  // target inner diameter. This tracks site-specific changes in atom size.
  if(highlighted.length){
    const selectionOutlineWidth=9;
    const x=[],y=[],z=[],sizes=[],outlineColors=[];
    for(const atom of highlighted){
      const cart=fn.fractionalToCartesian(basis,[atom.x,atom.y,atom.z]);
      x.push(cart[0]);y.push(cart[1]);z.push(cart[2]);
      const atomDiameter=Math.max(2,Number(fn.atomDisplaySize(atom))||10);
      sizes.push(1.5*atomDiameter+selectionOutlineWidth);
      outlineColors.push(fn.complementaryAtomOutlineColor(fn.atomDisplayColor(atom)));
    }
    traces.push({type:'scatter3d',mode:'markers',name:'Selected atomic sites',showlegend:false,
      x,y,z,hoverinfo:'skip',
      marker:{size:sizes,symbol:'circle-open',color:outlineColors,
        line:{color:outlineColors,width:selectionOutlineWidth},opacity:1}});
  }
  // Plotly's compact presentation adapter scales font sizes by the UI density.
  // Keep the Structure 3D-axis tick numerals legible in actual screen pixels
  // (desktop/tablet compact layout and the unscaled mobile layout alike).
  const structureTickDensity=(typeof window.tasUIDensity==='function' ? window.tasUIDensity() : 1);
  const structureTickFontSize=Math.max(15,13/Math.max(0.1,structureTickDensity));
  const layout={
    margin:{l:0,r:0,t:8,b:0},paper_bgcolor:"#fff",plot_bgcolor:"#fff",showlegend:false,
    scene:{aspectmode:"data",dragmode:"orbit",xaxis:{visible:cifState.structureShowXYZ,title:{text:"x (Å)",font:{size:18,color:"#222"}},showticklabels:cifState.structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},yaxis:{visible:cifState.structureShowXYZ,title:{text:"y (Å)",font:{size:18,color:"#222"}},showticklabels:cifState.structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},zaxis:{visible:cifState.structureShowXYZ,title:{text:"z (Å)",font:{size:18,color:"#222"}},showticklabels:cifState.structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},camera:mainCamera},
    // Changing a view preset must supersede Plotly's saved interactive camera.
    // Other redraws keep the revision and preserve the current manual rotation.
    uirevision:`cif-structure-interactive-${cifState.structureCameraPresetRevision}`
  };
  fn.stopStructureCameraWatch();
  cifState.structureProgrammaticCameraUpdate=true;
  const renderRevision=++cifState.structureCameraRenderRevision;
  const renderResult=Plotly.react(plot,traces,layout,{displaylogo:false,responsive:true,scrollZoom:true});
  if(plot._context) plot._context.scrollZoom=true;
  fn.updateStructureOrientationTriads(basis,mainCamera);
  Promise.resolve(renderResult).then(()=>{
    if(renderRevision!==cifState.structureCameraRenderRevision) return;
    window.__tasStructureCrashGuard?.complete();
    cifState.structureProgrammaticCameraUpdate=false;
    const camera=fn.currentStructureCamera() || mainCamera;
    cifState.structureCameraState=fn.copyStructureCamera(camera);
    fn.updateStructureOrientationTriads(basis,camera);
    fn.startStructureCameraWatch();
  }).catch(()=>{
    if(renderRevision===cifState.structureCameraRenderRevision) cifState.structureProgrammaticCameraUpdate=false;
  });
  if(!plot._structureCameraBound && typeof plot.on==="function"){
    plot._structureCameraBound=true;
    const syncTriadsFromCamera=camera=>{
      const copied=fn.copyStructureCamera(camera);
      if(!copied) return;
      cifState.structureCameraState=copied;
      const latest=fn.directLatticeBasis(fn.currentStructureForViewer()?.structure?.lattice) || basis;
      fn.updateStructureOrientationTriads(latest,copied);
    };
    const syncTriadsFromLiveCamera=()=>{
      const copied=fn.currentStructureCamera();
      if(copied) syncTriadsFromCamera(copied);
    };
    const onCameraMotion=ev=>{
      if(cifState.structureProgrammaticCameraUpdate) return;
      // Prefer the live camera over relayout payloads, which can lag one frame.
      const live=fn.currentStructureCamera();
      const eventCamera=fn.cameraFromRelayoutEvent(ev);
      if(live) syncTriadsFromCamera(live);
      else if(eventCamera) syncTriadsFromCamera(eventCamera);
      else requestAnimationFrame(syncTriadsFromLiveCamera);
    };
    let trackingPointer=false, trackingFrame=0;
    const trackWhilePointerDown=()=>{
      if(!trackingPointer) return;
      syncTriadsFromLiveCamera();
      trackingFrame=requestAnimationFrame(trackWhilePointerDown);
    };
    plot.on("plotly_relayouting",onCameraMotion);
    plot.on("plotly_relayout",onCameraMotion);
    plot.addEventListener("pointerdown",()=>{
      trackingPointer=true;
      cancelAnimationFrame(trackingFrame);
      trackingFrame=requestAnimationFrame(trackWhilePointerDown);
    });
    const stopTracking=()=>{
      trackingPointer=false;
      cancelAnimationFrame(trackingFrame);
      requestAnimationFrame(syncTriadsFromLiveCamera);
    };
    plot.addEventListener("pointerup",stopTracking);
    plot.addEventListener("pointercancel",stopTracking);
    plot.addEventListener("mouseleave",()=>{ if(trackingPointer) stopTracking(); });
    plot.addEventListener("wheel",()=>{
      requestAnimationFrame(syncTriadsFromLiveCamera);
      setTimeout(syncTriadsFromLiveCamera,60);
      setTimeout(syncTriadsFromLiveCamera,140);
    },{passive:true});
  }

}
}
