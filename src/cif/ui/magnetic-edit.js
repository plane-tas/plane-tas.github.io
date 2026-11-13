// Imported magnetic structures: Modify drafts, original/modified moments and Spins row selection.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {atomSiteKey} from '../mcif-export.js';
export function installMagneticEdit(ctx){
  const {deps:{
    $, getPropagationVectors, getSelectedCifStructure, getSelectedCifText, scheduleRecalc, setPropagationVectorsFromFile
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    activateImportedMagneticEditing, revertImportedMagneticEditing, clearSpinRowSelection, propagationSignature,
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
  fn.syncIncommensurateControls?.();
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
  const incommensurateSource=!!fn.currentStructureForViewer()?.structure?.incommensurateSingleQ;
  cifState.importedMagneticEditMode=true;
  // An incommensurate mCIF is edited first with the Incommensurate type
  // (Collinear, Helical, Sinusoidal use its crystallographic structure).
  // After a reload the saved type is kept.
  const restored=cifState.restoredMomentStructureType;
  cifState.restoredMomentStructureType=null;
  const keep=["collinear","helical","sinusoidal"].includes(restored) && restored===cifState.structureMomentStructureType;
  if(incommensurateSource && !keep) cifState.structureMomentStructureType='incommensurate';
  rememberModifiedMagneticDraft();
  fn.invalidateGeneratedMcif();
  fn.syncImportedMomentStructureType();
  fn.refreshMomentPropagationVectorSelect();
}
// Structure type "mCIF": go back to the moments of the loaded file (the
// edited moments and the saved Modify draft are discarded).
function revertImportedMagneticEditing(){
  if(!fn.sourceIsMagneticCif()) return;
  const viewer=fn.currentStructureForViewer();
  const structure=viewer?.mcifSource||viewer?.structure;
  const key=magneticDraftIdentity();
  // Back to the propagation vector of the file (it may have been changed);
  // set while still editing, so the k change does not start a new edit.
  const fileQ=fn.propagationVectorsFromMcif(getSelectedCifText?.()||"",getSelectedCifStructure());
  if(fileQ.length && setPropagationVectorsFromFile){ setPropagationVectorsFromFile(fileQ); scheduleRecalc?.(); }
  cifState.importedMagneticQSignature=fn.propagationSignature();
  cifState.importedMagneticEditMode=false;
  cifState.restoredMomentStructureType=null;
  cifState.modifiedMagneticDraft=null;
  try{
    const data=JSON.parse(localStorage.getItem(cifState.MCIF_EDIT_DRAFT_KEY)||"{}");
    if(key && data[key]){ delete data[key]; localStorage.setItem(cifState.MCIF_EDIT_DRAFT_KEY,JSON.stringify(data)); }
  }catch(_e){}
  $("cifMagMomentRows")?.replaceChildren();
  for(const k of [...cifState.structureMomentSettings.keys()]) if(/^(icm|individual):/.test(k)) cifState.structureMomentSettings.delete(k);
  for(const [siteIndex,site] of (structure?.asymmetricSites||[]).entries()){
    const k=fn.momentKey({...site,siteIndex});
    const previous=cifState.structureMomentSettings.get(k)||{};
    cifState.structureMomentSettings.set(k,{...previous,...fn.defaultMomentSetting(site,structure),
      color:previous.colorCustomized?previous.color:fn.defaultMomentSetting(site,structure).color,colorCustomized:!!previous.colorCustomized});
  }
  fn.invalidateGeneratedMcif();
  fn.syncImportedMomentStructureType();
  fn.refreshMomentPropagationVectorSelect();
  fn.updateMagneticMomentRows(structure||null);
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
}

cifState.structureMomentRotationAxis="c";
cifState.structureMomentChirality="CCW";
cifState.structureMomentPropagationIndex=0;
// Spin direction entry: Polar unless the user chose Cartesian (a global UI
// preference, kept across structures and reloads).
cifState.MOMENT_DIRECTION_STORAGE_KEY='tas-structure-moment-direction-v1';
cifState.structureMomentDirectionMode=(()=>{try{return localStorage.getItem('tas-structure-moment-direction-v1')==='cartesian'?'cartesian':'polar';}catch(_e){return 'polar';}})();
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
    if(site.icm){ if(atomSiteKey(atom)===atomSiteKey(site)) return true; continue; }
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
