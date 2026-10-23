// Imported magnetic structures: Modify drafts, original/modified moments and Spins row selection.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {atomSiteKey} from '../mcif-export.js';
export function installMagneticEdit(ctx){
  const {deps:{
    $, getPropagationVectors, getSelectedCifStructure, setPropagationVectorsFromFile
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    activateImportedMagneticEditing, clearSpinRowSelection, propagationSignature,
    rememberModifiedMagneticDraft, restoreMagneticDraftFromStorage, selectSpinMomentRow,
    selectedSpinContainsAtom, syncSpinModifyLock
  });
function magneticDraftIdentity(){
  const structure=getSelectedCifStructure();
  return structure?.magnetic ? fn.structureStateFingerprint(structure)+":"+fn.structureSignature(structure) : "";
}
function snapshotMagneticDraft(){
  return {
    propagationVectors:(getPropagationVectors?.()||[]).map(q=>({...q})),
    moments:[...fn.currentMomentSettings()].map(([k,v])=>[k,{...v}]),
    structureType:cifState.structureMomentStructureType,
    rotationAxis:cifState.structureMomentRotationAxis,
    chirality:cifState.structureMomentChirality,
    propagationIndex:cifState.structureMomentPropagationIndex,
    spinEditingMode:cifState.structureSpinEditingMode,
    directionMode:cifState.structureMomentDirectionMode
  };
}
function persistMagneticDraft(){
  const key=magneticDraftIdentity();
  if(!key||!cifState.modifiedMagneticDraft) return;
  try{
    const data=JSON.parse(localStorage.getItem(cifState.MCIF_EDIT_DRAFT_KEY)||"{}");
    data[key]=cifState.modifiedMagneticDraft;
    // Avoid unbounded growth when many structures have been viewed.
    for(const old of Object.keys(data).slice(0,Math.max(0,Object.keys(data).length-16))) delete data[old];
    localStorage.setItem(cifState.MCIF_EDIT_DRAFT_KEY,JSON.stringify(data));
  }catch(_e){}
}
function restoreMagneticDraftFromStorage(){
  cifState.modifiedMagneticDraft=null;
  try{
    const saved=JSON.parse(localStorage.getItem(cifState.MCIF_EDIT_DRAFT_KEY)||"{}")[magneticDraftIdentity()];
    if(saved && Array.isArray(saved.moments) && Array.isArray(saved.propagationVectors)) cifState.modifiedMagneticDraft=saved;
  }catch(_e){}
}
function rememberModifiedMagneticDraft(){
  if(!fn.sourceIsMagneticCif()||cifState.structureModifyLocked||!cifState.importedMagneticEditMode) return;
  cifState.modifiedMagneticDraft=snapshotMagneticDraft();
  persistMagneticDraft();
}
// Moment colors are visual preferences, not part of the protected mCIF spin model.
function captureMomentColors(){
  const colors=new Map();
  for(const [key,value] of fn.currentMomentSettings()){
    if(value?.color) colors.set(key,{color:value.color,colorCustomized:!!value.colorCustomized});
  }
  return colors;
}
function reapplyMomentColors(colors){
  for(const [key,visual] of colors){
    const setting=cifState.structureMomentSettings.get(key);
    if(setting) cifState.structureMomentSettings.set(key,{...setting,...visual});
  }
}
function applyModifiedMagneticDraft(draft){
  if(!draft) return;
  const visualColors=captureMomentColors();
  if(Array.isArray(draft.propagationVectors)) setPropagationVectorsFromFile?.(draft.propagationVectors.map(q=>({...q})));
  cifState.structureMomentSettings.clear();
  for(const [key,value] of (draft.moments||[])) cifState.structureMomentSettings.set(key,{...value});
  reapplyMomentColors(visualColors);
  cifState.structureMomentStructureType=["collinear","helical","sinusoidal"].includes(draft.structureType)?draft.structureType:"collinear";
  cifState.structureMomentRotationAxis=draft.rotationAxis||"c";
  cifState.structureMomentChirality=draft.chirality||"CCW";
  cifState.structureMomentPropagationIndex=Number(draft.propagationIndex)||1;
  cifState.structureSpinEditingMode=draft.spinEditingMode==="individual"?"individual":"sites";
  cifState.structureMomentDirectionMode=draft.directionMode==="polar"?"polar":"cartesian";
  cifState.importedMagneticEditMode=true;
  fn.invalidateGeneratedMcif();
  $("cifMagMomentRows")?.replaceChildren();
  cifState.structureControlSignature="";
}
function restoreOriginalImportedMagnetism(){
  const visualColors=captureMomentColors();
  if(cifState.importedOriginalQ.length) setPropagationVectorsFromFile?.(cifState.importedOriginalQ.map(q=>({...q})));
  const parsed=getSelectedCifStructure();
  cifState.structureMomentSettings.clear();
  for(const [siteIndex,site] of (parsed?.asymmetricSites||[]).entries()){
    const key=fn.momentKey({...site,siteIndex});
    cifState.structureMomentSettings.set(key,fn.defaultMomentSetting(site,parsed));
  }
  reapplyMomentColors(visualColors);
  cifState.importedMagneticEditMode=false;
  cifState.structureMomentPropagationIndex=cifState.importedOriginalQ.length?1:0;
  $("cifMagMomentRows")?.replaceChildren();
  cifState.structureControlSignature="";
  cifState.importedMagneticQSignature=propagationSignature();
}
function setImportedMagneticMode(next){
  if(!fn.sourceIsMagneticCif()) return;
  if(next==="mcif"){
    rememberModifiedMagneticDraft();
    cifState.structureModifyLocked=true;
    restoreOriginalImportedMagnetism();
  }else{
    cifState.structureModifyLocked=false;
    if(cifState.modifiedMagneticDraft) applyModifiedMagneticDraft(cifState.modifiedMagneticDraft);
    else{
      cifState.importedMagneticEditMode=true;
      cifState.modifiedMagneticDraft=snapshotMagneticDraft();
      persistMagneticDraft();
    }
  }
  fn.prepareStructureViewerControls();
  fn.refreshMomentPropagationVectorSelect();
  fn.renderCifStructureIfVisible();
}
function importedKDescription(){
  const q=fn.effectivePropagationVectorForStructure();
  return `(${[q.h,q.k,q.l].map(v=>Number.isFinite(Number(v))?Number(v):0).join(", ")})`;
}
function syncSpinModifyLock(){
  // Spins are always editable. mCIF is an initial-display state, not a lock.
  for(const id of ["cifMomentPropagationVector","cifMomentStructureType",
                   "cifMomentRotationAxis","cifMomentChirality",
                   "cifSpinEditingMode","cifMomentDirectionMode"]){
    const field=$(id); if(field) field.disabled=false;
  }
  const host=$("propagationVectors");
  if(host) for(const field of host.querySelectorAll("input,select,button")) field.disabled=false;
  const addQ=$("addPropagationVector"); if(addQ) addQ.disabled=false;
  for(const id of ["cifMagMomentRows","cifSpinBulkCheckbox"]){
    const host=$(id);
    if(host) for(const field of host.querySelectorAll("input,select,button")) field.disabled=false;
  }
}

cifState.importedMagneticEditMode=false;
cifState.importedMagneticQSignature="";
function propagationSignature(){
  const q=fn.effectivePropagationVectorForStructure();
  return [q.index,q.h,q.k,q.l].join('|');
}
function activateImportedMagneticEditing(){
  if(!fn.sourceIsMagneticCif() || cifState.importedMagneticEditMode || cifState.structureModifyLocked) return;
  for(const [key,value] of fn.currentMomentSettings()) cifState.structureMomentSettings.set(key,value);
  cifState.importedMagneticEditMode=true;
  rememberModifiedMagneticDraft();
  fn.invalidateGeneratedMcif();
  fn.syncImportedMomentStructureType();
  fn.refreshMomentPropagationVectorSelect();
}

cifState.structureMomentRotationAxis="c";
cifState.structureMomentChirality="CCW";
cifState.structureMomentPropagationIndex=0;
cifState.structureMomentDirectionMode="cartesian";
cifState.structureSpinEditingMode="sites";
// Element only filters rows shown in Spins; it never changes moments or mCIF export.
cifState.structureSpinTableElement="*";
// Visual row selection is UI-only: it does not enable/disable moments or
// change any structure-factor or mCIF data. Keys refer to the current editor.
cifState.selectedSpinRowKeys=new Set();
cifState.spinSelectionAnchorKey=null;
cifState.visibleSpinSelectionSites=new Map();
function clearSpinRowSelection({redraw=true}={}){
  if(!cifState.selectedSpinRowKeys.size && !cifState.spinSelectionAnchorKey)return;
  cifState.selectedSpinRowKeys.clear();
  cifState.spinSelectionAnchorKey=null;
  for(const row of document.querySelectorAll('#cifMagMomentRows .structure-moment-row')){
    row.classList.remove('spin-row-selected');
    row.setAttribute('aria-selected','false');
  }
  if(redraw)fn.renderCifStructureIfVisible();
}
function syncSpinRowSelection(){
  for(const row of document.querySelectorAll('#cifMagMomentRows .structure-moment-row')){
    const active=cifState.selectedSpinRowKeys.has(row.dataset.momentKey);
    row.classList.toggle('spin-row-selected',active);
    row.setAttribute('aria-selected',String(active));
  }
}
function selectSpinMomentRow(key,event={}){
  const rows=[...document.querySelectorAll('#cifMagMomentRows .structure-moment-row')];
  const order=rows.map(row=>row.dataset.momentKey);
  if(!order.includes(key))return;
  if(event.shiftKey && cifState.spinSelectionAnchorKey && order.includes(cifState.spinSelectionAnchorKey)){
    if(!event.ctrlKey && !event.metaKey)cifState.selectedSpinRowKeys.clear();
    const a=order.indexOf(cifState.spinSelectionAnchorKey),b=order.indexOf(key);
    for(let i=Math.min(a,b);i<=Math.max(a,b);i++)cifState.selectedSpinRowKeys.add(order[i]);
  }else if(event.ctrlKey || event.metaKey){
    if(cifState.selectedSpinRowKeys.has(key))cifState.selectedSpinRowKeys.delete(key);
    else cifState.selectedSpinRowKeys.add(key);
    cifState.spinSelectionAnchorKey=key;
  }else{
    const wasSelected=cifState.selectedSpinRowKeys.has(key);
    cifState.selectedSpinRowKeys.clear();
    if(!wasSelected){cifState.selectedSpinRowKeys.add(key);cifState.spinSelectionAnchorKey=key;}
    else cifState.spinSelectionAnchorKey=null;
  }
  syncSpinRowSelection();
  fn.renderCifStructureIfVisible();
}
// Manual rows correspond to one expanded atom/cell; symmetry-linked rows
// correspond to the full orbit of the asymmetric source site.
function selectedSpinContainsAtom(atom){
  if(!cifState.selectedSpinRowKeys.size)return false;
  for(const key of cifState.selectedSpinRowKeys){
    const site=cifState.visibleSpinSelectionSites.get(key);
    if(!site)continue;
    if(site.individualKey){
      if(atomSiteKey(atom)!==atomSiteKey(site))continue;
      if(!Array.isArray(atom.cell) || !site.individualCell?.every((v,i)=>v===atom.cell[i]))continue;
      return true;
    }
    if(Number.isInteger(atom.sourceSiteIndex) && atom.sourceSiteIndex===site.siteIndex)return true;
    // For manually specified CIFs without expanded-atom source indices.
    if(!Number.isInteger(atom.sourceSiteIndex) &&
       String(atom.sourceLabel||'')===String(site.label||''))return true;
  }
  return false;
}
}
