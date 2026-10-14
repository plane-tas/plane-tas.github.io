// Atomic-position editing mode and persistence of the CIF Generator atom table.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installGeneratorAtomsState(ctx){
  const {deps:{
    $, getSelectedCifText
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    currentCifGeneratorAtomRows, currentEditorSourceKey, restoreCifGeneratorAtomsState,
    saveCifGeneratorAtomsState
  });

// Symmetry works on independent asymmetric sites; Manual exposes the full
// expanded unit cell and exports a P1 structure when individually edited.
cifState.structurePositionEditingMode='sites';
cifState.structurePositionTableElement='*';
cifState.positionModeDrafts={sites:null,individual:null};
cifState.positionSavedSourcePreference=null;
cifState.positionManualSourceSignature=null;
cifState.CIF_GENERATOR_ATOMS_STORAGE_KEY="tas-simulator-cif-generator-atoms-v1";
cifState.restoringCifGeneratorAtoms=false;
cifState.restoringCifStartup=false;

// Stable, cheap fingerprint for recognizing that a saved draft belongs to
// the currently selected source, without storing a duplicate CIF in the draft.
function currentEditorSourceKey(){
  const text=String(getSelectedCifText()||'');
  if(!text)return 'generator:empty';
  let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;
  }
  return `cif:${text.length}:${hash.toString(16)}`;
}
function generatorCellDraft(){
  const values={};
  for(const id of Object.values(cifState.CIF_LATTICE_FIELDS))values[id]=$(id)?.value??'';
  return values;
}
function currentCifGeneratorAtomRows(){
  return [...document.querySelectorAll("#cifAtomRows .cif-atom-row")].map(fn.cifAtomRowValues).filter(Boolean);
}
function saveCifGeneratorAtomsState(){
  if(cifState.restoringCifGeneratorAtoms || cifState.restoringCifStartup) return;
  cifState.positionModeDrafts[cifState.structurePositionEditingMode]=currentCifGeneratorAtomRows();
  try{ localStorage.setItem(cifState.CIF_GENERATOR_ATOMS_STORAGE_KEY,JSON.stringify({version:3,
    sourceKey:currentEditorSourceKey(),
    mode:cifState.structurePositionEditingMode,element:cifState.structurePositionTableElement,
    drafts:cifState.positionModeDrafts,atoms:currentCifGeneratorAtomRows(),
    cell:generatorCellDraft(),crystalSystem:$('cifCrystalSystem')?.value,
    generatedName:$('cifGeneratedName')?.value,
    sgNumber:Number($('cifSpaceGroup')?.value)||1,
    manualSourceSignature:cifState.positionManualSourceSignature,
    sourcePreference:cifState.cifStructureSourcePreference,
    savedSourcePreference:cifState.positionSavedSourcePreference})); }catch(_e){}
}
function restoreCifGeneratorAtomsState(){
  let saved;
  try{ saved=JSON.parse(localStorage.getItem(cifState.CIF_GENERATOR_ATOMS_STORAGE_KEY)||"null"); }catch(_e){ return false; }
  if(!saved || ![1,2,3].includes(saved.version) || !Array.isArray(saved.atoms) || !saved.atoms.length) return false;
  // Saved edits from an unrelated imported file must never overwrite this CIF.
  if(saved.version===3 && saved.sourceKey!==currentEditorSourceKey()) return false;
  cifState.restoringCifGeneratorAtoms=true;
  try{
    if(saved.version>=2){
      cifState.positionModeDrafts.sites=Array.isArray(saved.drafts?.sites)?saved.drafts.sites:null;
      cifState.positionModeDrafts.individual=Array.isArray(saved.drafts?.individual)?saved.drafts.individual:null;
      cifState.structurePositionEditingMode=saved.mode==='individual'?'individual':'sites';
      cifState.structurePositionTableElement=String(saved.element||'*');
      cifState.positionManualSourceSignature=saved.manualSourceSignature||null;
      if(Number.isInteger(Number(saved.sgNumber)) && Number(saved.sgNumber)>=1 && Number(saved.sgNumber)<=230){
        fn.selectCifSpaceGroup(Number(saved.sgNumber),{syncSystem:true});
      }
    }
    // Always restore the actual editable generator fields AFTER the original
    // CIF has been parsed. These values, not the source file, are the current
    // user draft. Empty/invalid text is retained exactly until corrected.
    if(saved.version===3){
      if(saved.crystalSystem && $('cifCrystalSystem')){
        const el=$('cifCrystalSystem');
        if([...el.options].some(o=>o.value===saved.crystalSystem))el.value=saved.crystalSystem;
      }
      for(const [id,value] of Object.entries(saved.cell||{})) if($(id))$(id).value=String(value);
      if(typeof saved.generatedName==='string' && $('cifGeneratedName')) $('cifGeneratedName').value=saved.generatedName;
      cifState.cifStructureSourcePreference=saved.sourcePreference||cifState.cifStructureSourcePreference;
      cifState.positionSavedSourcePreference=saved.savedSourcePreference||null;
      // Migrate older drafts: Manual used to force a P1-generated preview.
      // Restore its original view source instead of repeating that bug.
      if(cifState.structurePositionEditingMode==='individual' && cifState.positionSavedSourcePreference){
        cifState.cifStructureSourcePreference=cifState.positionSavedSourcePreference;
        cifState.positionSavedSourcePreference=null;
      }
    }
    // Position Mode is an editor-view option. Never replace the selected mCIF
    // Structure (or its parent-cell frame) with a P1 draft on restoration.
    fn.replaceCifAtomRows(saved.atoms);
    fn.refreshPositionTableToolbar();
    return true;
  }finally{ cifState.restoringCifGeneratorAtoms=false; }
}
}
