// Selected sample CIF: status display, local persistence, loading and clearing CIF/mCIF files.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {CIF_MAGNETIC_CELL_STORAGE_KEY, SELECTED_CIF_STORAGE_KEY} from './constants.js';

export function installSelectedCif(ctx){
  const {deps:{
    $, checkedValue, clearError, getSelectedCifFileName, getSelectedCifStructure, getSelectedCifText,
    parseCifStructure, saveLeftPanelState, scheduleRecalc, setPropagationVectorsFromFile,
    setSelectedCifState, updateAbsorptionCalculator, updateAutoW
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    clearSelectedCif, loadCifText, restoreSelectedCifLocal, selectCifFile, syncSfColorMaxControl,
    updateCifUI, updateImportedUnitCellPanels
  });

function hasSelectedCif(){
  return checkedValue("sampleMode")==="single" && !!getSelectedCifStructure();
}

function updateCifUI(){
  const row=$("cifSelectRow");
  if(row) row.classList.remove("hidden");
  const name=$("cifFileName");
  if(name){
    name.value=getSelectedCifFileName() || "No file selected";
    if(getSelectedCifStructure()){
      const bits=[getSelectedCifStructure().name];
      if(getSelectedCifStructure().spaceGroup) bits.push(`Space group: ${getSelectedCifStructure().spaceGroup}`);
      bits.push(`${getSelectedCifStructure().asymmetricSiteCount} asymmetric site(s)`);
      bits.push(`${getSelectedCifStructure().symmetryOperationCount} symmetry operation(s)`);
      name.title=bits.join(" | ");
    }else name.title="";
  }
  const clearButton=$("cifClearButton");
  if(clearButton) clearButton.disabled=!getSelectedCifStructure();
  // All three file selectors display the same shared, parsed CIF/mCIF state.
  const generatorName=$("cifGeneratorSourceName");
  if(generatorName){
    generatorName.value=getSelectedCifFileName() || "No file selected";
    generatorName.title=getSelectedCifFileName() || "";
  }
  const generatorClear=$("cifGeneratorSourceClear");
  if(generatorClear) generatorClear.disabled=!getSelectedCifStructure();
  const structureName=$("structureCifName");
  if(structureName) structureName.value=getSelectedCifFileName() || "No file selected";
  const structureClear=$("structureCifClear");
  if(structureClear) structureClear.disabled=!getSelectedCifStructure();
  if($("structureMcifShowCurrent")) $("structureMcifShowCurrent").disabled=!getSelectedCifText();
  const showCurrentButton=$("cifShowCurrent");
  if(showCurrentButton) showCurrentButton.disabled=!getSelectedCifText();
  if($("cifReloadCurrent")) $("cifReloadCurrent").disabled=!getSelectedCifText();
  $("sfColorbarRange")?.classList.toggle("hidden",!hasSelectedCif());
  updateAbsorptionCalculator();
}

function syncSfColorMaxControl(source='restore'){
  const minEntry=$("sfColorMinEntry"),maxEntry=$("sfColorMaxEntry");
  if(!minEntry||!maxEntry) return;
  // The intensity scale is |F_N|² relative to its computed maximum (0…1).
  // Preserve the bound the user edited; adjust the other bound only if needed.
  const step=0.0001;
  const parse=(element,fallback)=>element.value.trim()==='' ? fallback : Number(element.value);
  const clamp01=(raw,fallback)=>Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):fallback;
  let min=clamp01(parse(minEntry,0),0),max=clamp01(parse(maxEntry,1),1);
  if(max-min<step){
    if(source==='max') min=Math.max(0,max-step);
    else if(source==='min') max=Math.min(1,min+step);
    else {min=0;max=1;}
  }
  // At the endpoints, move the edited bound back inside the valid range.
  if(max-min<step){
    if(source==='max') max=Math.min(1,min+step);
    else min=Math.max(0,max-step);
  }
  minEntry.value=String(Number(min.toFixed(4)));
  maxEntry.value=String(Number(max.toFixed(4)));
}

function saveSelectedCifLocal(text,fileName){
  try{
    const payload={version:1,fileName:String(fileName||"selected_structure.cif"),text:String(text||"")};
    if(payload.text) localStorage.setItem(SELECTED_CIF_STORAGE_KEY,JSON.stringify(payload));
  }catch(_e){}
}
function restoreSelectedCifLocal(){
  let saved;
  try{ saved=JSON.parse(localStorage.getItem(SELECTED_CIF_STORAGE_KEY)||"null"); }catch(_e){ return false; }
  if(!saved || saved.version!==1 || !saved.text) return false;
  try{
    loadCifText(saved.text,saved.fileName||"selected_structure.cif",{persist:false});
    return true;
  }catch(_e){
    try{ localStorage.removeItem(SELECTED_CIF_STORAGE_KEY); }catch(__e){}
    return false;
  }
}
function updateImportedUnitCellPanels(parsed,text){
  const box=$("cifMagneticCellBox"),notice=$("cifParentCellNotice");
  // Malformed/unsupported multi-q input may have no moments after parsing,
  // but it is still a magnetic file whose limitation must be visible.
  const magneticTags=/(?:_atom_site_moment(?:[._]|\s)|_cell_wave_vector_[xyz]|_space_group_symop_magn_ssg_)/i.test(String(text||''));
  if(box)box.hidden=!(parsed?.magnetic||magneticTags);
  const magneticNotice=$('cifMagneticCellNotice');
  if(notice)notice.hidden=true;
  if(magneticNotice){magneticNotice.hidden=true;magneticNotice.textContent='';}
  if(!parsed?.magnetic && !magneticTags)return;
  if(magneticNotice){
    const alerts=(parsed.warnings||[]).filter(w=>/incommensurate|superspace|single.q|fourier|wave vectors|modulat/i.test(String(w)));
    if(parsed.incommensurateSingleQ || alerts.length){
      magneticNotice.hidden=false;
      magneticNotice.textContent=(parsed.incommensurateSingleQ
        ?'Note: Incommensurate single-q mCIF. No exact finite magnetic supercell; the displayed Fourier modulation is supported only for recognized operations.'
        :'Note: Magnetic modulation/superspace symmetry may be incomplete.')
        +(alerts.length?' '+alerts.join(' '):'');
    }
  }
  // The mCIF has its own time-reversed magnetic symmetry operations. Do not
  // reinterpret its parent IT number as a magnetic space-group selector.
  for(const [key,id] of Object.entries(cifState.CIF_MAG_LATTICE_FIELDS)){
    if($(id))$(id).value=Number.isFinite(Number(parsed.lattice?.[key]))?String(parsed.lattice[key]):'';
  }
  const crystallographic=fn.crystallographicStructureFromMcif(parsed,text);
  if(notice){
    if(crystallographic?.parentCellEstimated){
      notice.hidden=false;
      notice.textContent='Note: Estimated crystallographic unit cell from verified atomic translations and k. Parent space-group setting may be uncertain; nuclear peaks are calculated from an estimated structure.';
    }else if(!crystallographic){
      notice.hidden=false;
      notice.textContent='Note: Crystallographic unit cell could not be determined reliably. BNS alone does not specify the parent cell setting; nuclear peaks are disabled.';
    }
  }
}
function loadCifText(text,fileName="generated_structure.cif",{persist=true}={}){
  cifState.liveEditorNuclearSource=null;
  cifState.liveEditorNuclearInvalid=false;
  const parsed=parseCifStructure(text);
  const cifText=String(text??"");
  const importedQ=fn.propagationVectorsFromMcif(cifText,parsed);
  if(importedQ.length) setPropagationVectorsFromFile?.(importedQ);
  cifState.importedMagneticEditMode=false;
  cifState.structureModifyLocked=false;
  cifState.importedOriginalQ=importedQ.map(q=>({...q}));
  cifState.modifiedMagneticDraft=null;
  if($("mcifPreviewText")) $("mcifPreviewText").textContent=cifText;
  // CIF and mCIF share a single filename entry.
  fn.invalidateGeneratedMcif();
  // An explicit new file replaces the previous editing session. Only startup
  // restoration (persist=false) may recover its saved Atoms/Spins/Bonds.
  if(persist){
    fn.discardStructureEditingSession();
    fn.resetStructureViewerStateToDefaults();
    // A deliberate Load/Set/Reload replaces the draft with the source file.
    // Otherwise a same-file reload could resurrect previously edited XYZ/cell
    // values on the next browser refresh.
    try{localStorage.removeItem(cifState.CIF_GENERATOR_ATOMS_STORAGE_KEY);}catch(_e){}
    try{localStorage.removeItem(CIF_MAGNETIC_CELL_STORAGE_KEY);}catch(_e){}
  }
  setSelectedCifState(parsed,fileName,cifText);
  cifState.cifStructureSourcePreference="selected";
  if(!persist) fn.restoreStructureViewerState();
  // File changes must not navigate Structure editor away from the open tab.
  cifState.structureConfigActiveTab=fn.rememberedStructureEditorTab();
  if(parsed.magnetic){
    cifState.structureModifyLocked=false;
    fn.restoreMagneticDraftFromStorage();
    // New file import: use the file's magnetic moments. Reload of the SAME
    // file: retain the user's last saved checkbox, XYZ and colour settings.
    // The old implementation overwrote all restored spins unconditionally.
    for(const [siteIndex,site] of (parsed.asymmetricSites||[]).entries()){
      const key=fn.momentKey({...site,siteIndex});
      const imported=fn.defaultMomentSetting(site,parsed);
      if(persist || !cifState.structureMomentSettings.has(key)){
        const previous=cifState.structureMomentSettings.get(key)||{};
        cifState.structureMomentSettings.set(key,{...previous,...imported});
      }
    }
    // Clear live inputs before rebuilding or they could overwrite the imported
    // XYZ vectors during updateMagneticMomentRows().
    $("cifMagMomentRows")?.replaceChildren();
    cifState.structureControlSignature="";
  }else{
    // Plain CIF imports must never suggest magnetic order.  This also clears
    // auto-enabled checkboxes saved by earlier versions for the same CIF.
    // A newly imported nonmagnetic CIF has no magnetic moments. Never
    // inherit old nonzero vectors from browser storage or previous structures.
    cifState.structureMomentSettings.clear();
    // Old rows can otherwise override the reset via currentMomentSettings().
    $("cifMagMomentRows")?.replaceChildren();
    cifState.structureControlSignature="";
  }
  fn.prepareStructureViewerControls();
  // Refresh independent of the active right-hand preview/structure tab.
  fn.refreshMomentPropagationVectorSelect();
  cifState.importedMagneticQSignature=fn.propagationSignature();
  if(persist) saveSelectedCifLocal(cifText,fileName);

  // A selected/generated CIF defines the crystallographic unit cell. Keep the
  // existing U/V orientation indices, but synchronize the six lattice fields.
  const parentEditor=fn.crystallographicStructureFromMcif(parsed,cifText);
  const sg=fn.findGeneratorSpaceGroup(parentEditor||parsed);
  if(sg) fn.setSampleSpaceGroup(sg.number,{recalc:false});
  const parentNuclear=parentEditor||fn.parentNuclearStructureFromMcif(parsed,cifText);
  const lattice=parentNuclear?.lattice || parsed?.lattice || {};
  // Sample coordinates follow the parent nuclear cell when a generated
  // commensurate mCIF can be unambiguously mapped back to that cell.
  for(const id of ["a","b","c","alpha","beta","gamma"]){
    const value=Number(lattice[id]);
    if(Number.isFinite(value) && $(id)) $(id).value=String(value);
  }

  // Keep CIF Generator synchronized with the currently selected sample CIF.
  // Only editable generator fields are populated; file inputs are never set
  // programmatically.
  if(cifState.cifSpaceGroups.length){
    fn.loadParsedCifIntoGenerator(fn.crystallographicStructureFromMcif(parsed,cifText)||parsed,fileName,{message:false});
    updateImportedUnitCellPanels(parsed,cifText);
  }
  // Loading a file is the one place where both editors acquire common values.
  // For generated magnetic supercells Sample already refers to the parent cell.
  if(fn.findGeneratorSpaceGroup(parsed)) fn.syncCrystallographicCell("sample",{refresh:false});
  // Importing a file changes Sample programmatically, not through sidebar
  // input/change events. Persist the imported group and cell together so the
  // next reload cannot restore an older Sample space group (often P1).
  if(persist) saveLeftPanelState();
  // The selected CIF/mCIF, not just a newly generated CIF, is a valid source
  // for the nuclear reflection table.  Drop any previous Generate snapshot and
  // recalculate from the newly selected structure (even when the editable CIF
  // Generator cannot import its space-group setting).
  fn.invalidateGeneratedCif("");

  updateAutoW();
  updateCifUI();
  fn.updateStructureUnitCellReference(fn.currentStructureForViewer());
  clearError();
  scheduleRecalc();
  fn.renderCifStructureIfVisible();
  // A different structure can carry spins on different elements.
  fn.refreshMagneticIonSelectors?.();
  return parsed;
}

async function selectCifFile(file){
  if(!file) return;
  return loadCifText(await file.text(),file.name);
}

function clearSelectedCif(){
  cifState.liveEditorNuclearSource=null;
  cifState.liveEditorNuclearInvalid=false;
  fn.discardStructureEditingSession();
  setSelectedCifState(null,"","");
  updateImportedUnitCellPanels(null,"");
  // Clear the separate Generator-only viewer cache as well: a later tab
  // switch must not resurrect a CIF that was explicitly cleared.
  cifState.loadedGeneratorCifStructure=null;
  cifState.loadedGeneratorCifName="";
  fn.resetStructureViewerStateToDefaults();
  try{ localStorage.removeItem(SELECTED_CIF_STORAGE_KEY); }catch(_e){}
  cifState.cifStructureSourcePreference="selected";
  if($("cifFileInput")) $("cifFileInput").value="";
  if($("cifLoadFile")) $("cifLoadFile").value="";
  if($("mcifPreviewText")) $("mcifPreviewText").textContent="Select a CIF/mCIF to preview it.";
  // Do not leave download/Set actions enabled for an obsolete reviewed file.
  fn.invalidateGeneratedCif("");
  fn.invalidateGeneratedMcif();
  if(cifState.cifSpaceGroups.length) fn.setSampleSpaceGroup(1,{recalc:false});
  else{
    if($("sampleSpaceGroup")) $("sampleSpaceGroup").value="1";
    if($("sampleSpaceGroupNumber")) $("sampleSpaceGroupNumber").value="1";
  }
  updateCifUI();
  clearError();
  saveLeftPanelState();
  scheduleRecalc();
  fn.renderCifStructureIfVisible();
}
}
