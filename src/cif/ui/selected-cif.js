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
    clearSelectedCif, clearStructureEditor, loadCifText, restoreSelectedCifLocal, selectCifFile, syncSfColorMaxControl,
    updateCifUI, updateImportedUnitCellPanels
  });

function hasSelectedCif(){
  return checkedValue("sampleMode")==="single" && !!getSelectedCifStructure();
}

// Show a file name in a read-only box so that its extension stays visible.
const fileNameCanvas=document.createElement("canvas").getContext("2d");
function showFileName(el,name){
  if(!el) return;
  el.dataset.fullName=name||"";
  el.title=name||"";
  if(!name){ el.value="No file selected"; return; }
  const cs=getComputedStyle(el);
  fileNameCanvas.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const room=el.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0)-2;
  const fits=t=>fileNameCanvas.measureText(t).width<=room;
  if(!(room>0) || fits(name)){ el.value=name; return; }
  const dot=name.lastIndexOf("."), ext=dot>0 ? name.slice(dot) : "", stem=dot>0 ? name.slice(0,dot) : name;
  // Keep the extension and the last few characters before it.
  const tail=stem.slice(-3)+ext;
  let lo=0, hi=stem.length-3;
  while(lo<hi){ const mid=(lo+hi+1)>>1; if(fits(stem.slice(0,mid)+"…"+tail)) lo=mid; else hi=mid-1; }
  el.value=lo>0 ? stem.slice(0,lo)+"…"+tail : "…"+ext;
}
// Re-fit when the boxes change width.
if(typeof ResizeObserver==="function"){
  const ro=new ResizeObserver(entries=>{ for(const e of entries){ const el=e.target; if(el.dataset.fullName) showFileName(el,el.dataset.fullName); } });
  queueMicrotask(()=>{ for(const id of ["cifFileName","cifGeneratorSourceName"]){ const el=document.getElementById(id); if(el) ro.observe(el); } });
}

function updateCifUI(){
  const row=$("cifSelectRow");
  if(row) row.classList.remove("hidden");
  // File name boxes: the whole name when it fits, otherwise the start, "…"
  // and the end with the extension (.cif / .mcif stays visible); the hover
  // text is the full file name.
  const fileName=getSelectedCifFileName();
  for(const id of ["cifFileName","cifGeneratorSourceName"]) showFileName($(id),fileName);
  const clearButton=$("cifClearButton");
  if(clearButton) clearButton.disabled=!getSelectedCifStructure();
  const showCurrentButton=$("cifShowCurrent");
  if(showCurrentButton) showCurrentButton.disabled=!getSelectedCifText();
  if($("cifReloadCurrent")) $("cifReloadCurrent").disabled=!getSelectedCifText();
  // CIF/mCIF Preview follows the loaded file unless it shows a generated one.
  fn.syncPreviewWithLoadedFile?.();
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
  const box=$("cifMagneticCellBox");
  // Malformed/unsupported multi-q input may have no moments after parsing,
  // but it is still a magnetic file whose limitation must be visible.
  const magneticTags=/(?:_atom_site_moment(?:[._]|\s)|_cell_wave_vector_[xyz]|_space_group_symop_magn_ssg_)/i.test(String(text||''));
  if(box)box.hidden=!(parsed?.magnetic||magneticTags);
  const magneticNotice=$('cifMagneticCellNotice');
  if(magneticNotice){magneticNotice.hidden=true;magneticNotice.textContent='';}
  if(!parsed?.magnetic && !magneticTags)return;
  // Incommensurate / superspace input: one short note (the parser's own
  // remarks follow it).
  if(magneticNotice){
    const alerts=(parsed.warnings||[]).filter(w=>/incommensurate|superspace|single.q|fourier|wave vectors|modulat/i.test(String(w)));
    if(parsed.incommensurateSingleQ || alerts.length){
      magneticNotice.hidden=false;
      magneticNotice.textContent=(parsed.incommensurateSingleQ
        ?'Note: Incommensurate single-k mCIF: no finite magnetic supercell; the Fourier modulation is shown.'
        :'Note: Magnetic modulation/superspace symmetry may be incomplete.')
        +(alerts.length?' '+alerts.join(' '):'');
    }
  }
  // The mCIF has its own time-reversed magnetic symmetry operations. Do not
  // reinterpret its parent IT number as a magnetic space-group selector.
  for(const [key,id] of Object.entries(cifState.CIF_MAG_LATTICE_FIELDS)){
    if($(id))$(id).value=Number.isFinite(Number(parsed.lattice?.[key]))?String(Number(Number(parsed.lattice[key]).toPrecision(10))):'';
  }
}
function loadCifText(text,fileName="generated_structure.cif",{persist=true,newFile=false}={}){
  cifState.liveEditorNuclearSource=null;
  cifState.liveEditorNuclearInvalid=false;
  const parsed=parseCifStructure(text);
  const cifText=String(text??"");
  const importedQ=fn.propagationVectorsFromMcif(cifText,parsed);
  // A file selected from disk is a new sample: its propagation vectors (an
  // mCIF's) or none (a CIF) replace those entered for the previous one.
  // Set CIF, Reload and the restore on start keep the entered ones unless
  // the file has its own.
  if(newFile || importedQ.length) setPropagationVectorsFromFile?.(importedQ);
  cifState.importedMagneticEditMode=false;
  cifState.restoredMomentStructureType=null;
  cifState.structureModifyLocked=false;
  cifState.importedOriginalQ=importedQ.map(q=>({...q}));
  cifState.modifiedMagneticDraft=null;
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
    // Startup restoration of the SAME file (persist=false) keeps the spins
    // the user set; restoreStructureViewerState() already rejected saves of
    // other structures.
    if(persist) cifState.structureMomentSettings.clear();
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
    // toPrecision(10) drops floating-point noise such as 7.617999999999999.
    if(Number.isFinite(value) && $(id)) $(id).value=String(Number(value.toPrecision(10)));
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
  return loadCifText(await file.text(),file.name,{newFile:true});
}

// Unset (Sample, next to Select CIF/mCIF): the file is no longer used --
// as if none had been loaded.  The Q-E maps lose their |F|² shading and the
// Reflections their file; everything entered stays: the lattice and space
// group (extinctions) of the Sample and the Structure editor (Cell,
// Positions, Atoms, Spins, Bonds), which the Generator keeps showing.
function clearSelectedCif(){
  setSelectedCifState(null,"","");
  updateImportedUnitCellPanels(null,"");
  // The separate Generator-only cache of the file as well: a later tab
  // switch must not bring back a file that was unset.
  cifState.loadedGeneratorCifStructure=null;
  cifState.loadedGeneratorCifName="";
  cifState.importedMagneticEditMode=false;
  try{ localStorage.removeItem(SELECTED_CIF_STORAGE_KEY); }catch(_e){}
  cifState.cifStructureSourcePreference="selected";
  if($("cifFileInput")) $("cifFileInput").value="";
  if($("cifLoadFile")) $("cifLoadFile").value="";
  // The Generator calculates from the editor from now on.
  cifState.liveNuclearCellReference="editor";
  fn.updateLiveEditorNuclearSource?.();
  updateCifUI();
  clearError();
  saveLeftPanelState();
  scheduleRecalc();
  fn.recalculateGeneratedReflections?.();
  fn.renderCifStructureIfVisible();
}
// Clear all (Structure editor): a new, empty structure.  Positions, Atoms,
// Spins and Bonds are emptied and the moments entered are forgotten; the
// Cell and the propagation vectors stay (they are the Sample's).  The file
// is unset too, so it is not used in place of the empty editor.
function clearStructureEditor(){
  if(getSelectedCifStructure()) clearSelectedCif();
  fn.discardStructureEditingSession();
  fn.resetStructureViewerStateToDefaults();
  cifState.positionModeDrafts={sites:null,individual:null};
  cifState.structurePositionEditingMode="sites";
  cifState.structurePositionTableElement="*";
  cifState.positionManualSourceSignature=null;
  cifState.positionSavedSourcePreference=null;
  fn.replaceCifAtomRows([]);
  // Rebuild the (empty) Atoms / Spins / Bonds tables with their headers.
  cifState.structureControlSignature=null;
  fn.syncStructureControlRows?.(null);
  cifState.structureMomentSettings?.clear?.();
  // Output generated from the old content is no longer valid.
  fn.invalidateGeneratedCif("");
  fn.invalidateGeneratedMcif();
  cifState.liveEditorNuclearSource=null;
  cifState.liveEditorNuclearInvalid=false;
  fn.refreshPositionTableToolbar?.();
  fn.saveCifGeneratorAtomsState?.();
  updateCifUI();
  clearError();
  scheduleRecalc();
  fn.recalculateGeneratedReflections?.();
  fn.renderCifStructureIfVisible();
}
}
