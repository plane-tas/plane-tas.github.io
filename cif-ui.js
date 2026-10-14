import {buildMagneticMotif, magneticBraggPeaks, parentIndexingFromMcif, hklInParentCell, explicitMagneticIonFactors} from './magnetic-reflections.js';
import {exportCommensurateMcif,rationalApprox} from './mcif-export.js';
// Extracted from app.js without changing calculation/display behavior.
// Dependencies are injected by app.js to keep module boundaries explicit.
const LEFT_PANEL_STORAGE_KEY='tas-qe-left-panel-v1';
const SELECTED_CIF_STORAGE_KEY='tas-simulator-selected-cif-v1';
const CIF_OUTPUT_FORMAT_STORAGE_KEY='tas-simulator-generator-output-format-v1';
const CIF_MAGNETIC_CELL_STORAGE_KEY='tas-simulator-cif-magnetic-cell-draft-v1';

export function createCifUI(deps){
  const {
    $,
    PI,
    RL_calc,
    add,
    canonicalReflectionHkl,
    checkedValue,
    clamp,
    clearError,
    compareHkl,
    cross,
    currentInstrument,
    dot,
    effectiveS2MaxAtEi,
    hklKey,
    hklToQ,
    makeSpiceScatteringPlaneBasis,
    norm,
    nuclearStructureFactorSquared,
    num,
    parseCifStructure,
    parseNumericValue,
    rad2deg,
    reciprocalSymmetryMatrices,
    reflectionStar,
    saveLeftPanelState,
    scheduleRecalc,
    updateAutoW,
    updateModeVisibility,
    updateAbsorptionCalculator,
    getPropagationVectors,
    setPropagationVectorsFromFile,
    getSelectedCifStructure,
    getSelectedCifFileName,
    getSelectedCifText,
    setSelectedCifState
  }=deps;

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

function propagationVectorsFromMcif(text,parsed){
  const lines=String(text||'').replace(/\r/g,'').split('\n');
  const result=[];
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().toLowerCase()!=='loop_') continue;
    let j=i+1, tags=[];
    while(j<lines.length && lines[j].trim().startsWith('_')){tags.push(lines[j].trim().toLowerCase());j++;}
    const idx=tags.findIndex(tag=>['_parent_propagation_vector.kxkykz','_parent_propagation_vector_kxkykz'].includes(tag));
    if(idx<0) continue;
    while(j<lines.length){
      const row=lines[j].trim();
      if(!row || row.startsWith('#')){j++;continue;}
      if(row==='loop_' || row.startsWith('_') || /^data_/i.test(row)) break;
      const match=row.match(/\[([^\]]+)\]/);
      const components=match ? match[1].split(/[\s,]+/) : row.split(/\s+/).slice(idx,idx+3);
      // mCIF propagation vectors commonly use rational components (e.g. 3/2).
      // Number("3/2") is NaN; use the shared numeric parser instead.
      const nums=components.map(component=>parseNumericValue(component));
      if(nums.length===3 && nums.every(Number.isFinite)) result.push({h:nums[0],k:nums[1],l:nums[2],enabled:true});
      j++;
    }
  }
  if(!result.length && parsed?.incommensurateSingleQ) for(const q of (parsed.propagationVectors||[])) result.push({h:q.h,k:q.k,l:q.l,enabled:true});
  return result;
}

// An app-generated commensurate mCIF stores its atomic motif in the magnetic
// supercell. The Sample and nuclear reflections must instead use the parent
// crystallographic cell. Generic external mCIF settings are not inferred.
function parentNuclearStructureFromMcif(parsed,text){
  if(!parsed?.magnetic || !Array.isArray(parsed.atoms) || !parsed.atoms.length) return null;
  const q=propagationVectorsFromMcif(text,parsed);
  if(q.length!==1) return null;
  const parent=parentIndexingFromMcif(text,parsed.lattice,[q[0].h,q[0].k,q[0].l]);
  if(!parent) return null;
  const rep=parent.replication;
  const wrap=v=>{const w=((v%1)+1)%1;return Math.abs(w-1)<1e-8 || w<1e-8?0:w;};
  const dedup=new Map();
  for(const atom of parsed.atoms){
    const position=['x','y','z'].map((key,i)=>wrap(Number(atom[key])*rep[i]));
    if(position.some(v=>!Number.isFinite(v))) return null;
    const key=[atom.element,...position.map(v=>Math.round(v*1e7)),Math.round(Number(atom.occupancy??1)*1e7)].join('|');
    if(!dedup.has(key)){
      // Magnetism does not alter nuclear scattering lengths, occupancies or Biso.
      // Never attach magnetic moments to a nuclear reflection model.
      const {magneticMoment,magneticFourier,...nuclearAtom}=atom;
      dedup.set(key,{...nuclearAtom,x:position[0],y:position[1],z:position[2]});
    }
  }
  return {...parsed,lattice:parent.lattice,atoms:[...dedup.values()],magnetic:false,
    parentCellReference:parent.reference};
}

// mCIF may contain a magnetic supercell and a distinct parent (nuclear) cell.
// Only convert coordinates if the source explicitly declares an unambiguous
// parent-index mapping (parentNuclearStructureFromMcif enforces this).
function originalParentSpaceGroup(text){
  const scalar=Object.create(null);
  for(const line of String(text||'').split(/\r?\n/)){
    const m=line.trim().match(/^(_parent_space_group(?:\.|_)[^\s]+)\s+(.+?)\s*$/i);
    if(m)scalar[m[1].toLowerCase()]=m[2].split(/\s+#/)[0].replace(/^['"]|['"]$/g,'').trim();
  }
  const value=(...keys)=>keys.map(key=>scalar[key]).find(v=>v!==undefined);
  const raw=value('_parent_space_group.it_number','_parent_space_group_it_number');
  const n=Number(raw);
  return {
    number:Number.isInteger(n)&&n>=1&&n<=230?n:null,
    name:value('_parent_space_group.name_h-m_alt','_parent_space_group_name_h-m_alt')||''
  };
}
// The magnetic P1 export lists *all* sites. Before using parent symmetry in
// the editable nuclear cell, collapse those expanded sites into true orbits.
function parentSiteOrbitRepresentatives(atoms,operations){
  if(!Array.isArray(atoms)||!atoms.length)return [];
  if(atoms.length>3000 || !Array.isArray(operations)||operations.length>192) return null;
  const wrap=v=>((v%1)+1)%1;
  const parseFraction=s=>{const [a,b]=String(s).split('/');return b!==undefined?Number(a)/Number(b):Number(a);};
  const transform=(expression,xyz)=>{
    let result=0;
    for(const term of String(expression).replace(/\s/g,'').replace(/-/g,'+-').split('+').filter(Boolean)){
      const symbol=term.match(/[xyz]/);
      if(!symbol)result+=parseFraction(term);
      else{
        const idx='xyz'.indexOf(symbol[0]);
        const c=term.replace(symbol[0],'');
        result+=parseFraction(!c||c==='+'?'1':c==='-'?'-1':c)*xyz[idx];
      }
    }
    return wrap(result);
  };
  const orbits=[];
  const close=(a,b)=>Math.abs(a-b-Math.round(a-b))<2e-5;
  for(const atom of atoms){
    const xyz=[atom.x,atom.y,atom.z].map(Number);
    if(!xyz.every(Number.isFinite))return null;
    const already=orbits.some(rep=>{
      if(rep.element!==atom.element||Math.abs(Number(rep.occupancy??1)-Number(atom.occupancy??1))>1e-5)return false;
      const r=[rep.x,rep.y,rep.z].map(Number);
      return operations.some(op=>{
        const expressions=String(op).split(',');
        if(expressions.length!==3)return false;
        const transformed=expressions.map(expr=>transform(expr,r));
        return transformed.every((v,i)=>Number.isFinite(v)&&close(v,xyz[i]));
      });
    });
    if(!already)orbits.push({...atom});
  }
  return orbits;
}
function crystallographicStructureFromMcif(parsed,text){
  if(!parsed?.magnetic)return null;
  const nuclear=parentNuclearStructureFromMcif(parsed,text);
  if(!nuclear)return null;
  const parent=originalParentSpaceGroup(text);
  const sg=cifSpaceGroups.find(g=>g.number===parent.number);
  if(!sg)return null;
  const sites=parentSiteOrbitRepresentatives(nuclear.atoms,sg.operations);
  if(!sites?.length)return null;
  return {...nuclear,spaceGroupNumber:sg.number,spaceGroup:parent.name||sg.hm,
    asymmetricSites:sites,asymmetricSiteCount:sites.length,
    symmetryOperationCount:sg.operations.length};
}
function updateImportedUnitCellPanels(parsed,text){
  const box=$("cifMagneticCellBox"),notice=$("cifParentCellNotice");
  if(box)box.hidden=!parsed?.magnetic;
  if(notice)notice.hidden=true;
  if(!parsed?.magnetic)return;
  const requestedNumber=Number(parsed.spaceGroupNumber);
  const sg=cifSpaceGroups.find(g=>g.number===requestedNumber);
  // This selector is the standard IT space group of the magnetic unit-cell
  // setting, not a substitute for a BNS magnetic space-group classification.
  selectMagneticCellSpaceGroup(sg?.number||1,{syncSystem:true});
  for(const [key,id] of Object.entries(CIF_MAG_LATTICE_FIELDS)){
    if($(id))$(id).value=Number.isFinite(Number(parsed.lattice?.[key]))?String(parsed.lattice[key]):'';
  }
  applyCifLatticeConstraints(true);
  if(!crystallographicStructureFromMcif(parsed,text) && notice){
    notice.hidden=false;
    notice.textContent='Parent-cell conversion is not defined in this mCIF. Nuclear-cell editing requires an explicit parent setting; no conversion was guessed.';
  }
}
function loadCifText(text,fileName="generated_structure.cif",{persist=true}={}){
  liveEditorNuclearSource=null;
  liveEditorNuclearInvalid=false;
  magneticTableHasBeenCalculated=false;
  const parsed=parseCifStructure(text);
  const cifText=String(text??"");
  const importedQ=propagationVectorsFromMcif(cifText,parsed);
  if(importedQ.length) setPropagationVectorsFromFile?.(importedQ);
  importedMagneticEditMode=false;
  structureModifyLocked=false;
  importedOriginalQ=importedQ.map(q=>({...q}));
  modifiedMagneticDraft=null;
  if($("mcifPreviewText")) $("mcifPreviewText").textContent=cifText;
  // CIF and mCIF share a single filename entry.
  invalidateGeneratedMcif();
  // An explicit new file replaces the previous editing session. Only startup
  // restoration (persist=false) may recover its saved Atoms/Spins/Bonds.
  if(persist){
    discardStructureEditingSession();
    resetStructureViewerStateToDefaults();
    // A deliberate Load/Set/Reload replaces the draft with the source file.
    // Otherwise a same-file reload could resurrect previously edited XYZ/cell
    // values on the next browser refresh.
    try{localStorage.removeItem(CIF_GENERATOR_ATOMS_STORAGE_KEY);}catch(_e){}
    try{localStorage.removeItem(CIF_MAGNETIC_CELL_STORAGE_KEY);}catch(_e){}
  }
  setSelectedCifState(parsed,fileName,cifText);
  cifStructureSourcePreference="selected";
  if(!persist) restoreStructureViewerState();
  // File changes must not navigate Structure editor away from the open tab.
  structureConfigActiveTab=rememberedStructureEditorTab();
  if(parsed.magnetic){
    structureModifyLocked=false;
    restoreMagneticDraftFromStorage();
    // New file import: use the file's magnetic moments. Reload of the SAME
    // file: retain the user's last saved checkbox, XYZ and colour settings.
    // The old implementation overwrote all restored spins unconditionally.
    for(const [siteIndex,site] of (parsed.asymmetricSites||[]).entries()){
      const key=momentKey({...site,siteIndex});
      const imported=defaultMomentSetting(site,parsed);
      if(persist || !structureMomentSettings.has(key)){
        const previous=structureMomentSettings.get(key)||{};
        structureMomentSettings.set(key,{...previous,...imported});
      }
    }
    // Clear live inputs before rebuilding or they could overwrite the imported
    // XYZ vectors during updateMagneticMomentRows().
    $("cifMagMomentRows")?.replaceChildren();
    structureControlSignature="";
  }else{
    // Plain CIF imports must never suggest magnetic order.  This also clears
    // auto-enabled checkboxes saved by earlier versions for the same CIF.
    // A newly imported nonmagnetic CIF has no magnetic moments. Never
    // inherit old nonzero vectors from browser storage or previous structures.
    structureMomentSettings.clear();
    // Old rows can otherwise override the reset via currentMomentSettings().
    $("cifMagMomentRows")?.replaceChildren();
    structureControlSignature="";
  }
  prepareStructureViewerControls();
  // Refresh independent of the active right-hand preview/structure tab.
  refreshMomentPropagationVectorSelect();
  importedMagneticQSignature=propagationSignature();
  if(persist) saveSelectedCifLocal(cifText,fileName);

  // A selected/generated CIF defines the crystallographic unit cell. Keep the
  // existing U/V orientation indices, but synchronize the six lattice fields.
  const parentEditor=crystallographicStructureFromMcif(parsed,cifText);
  const sg=findGeneratorSpaceGroup(parentEditor||parsed);
  if(sg) setSampleSpaceGroup(sg.number,{recalc:false});
  const parentNuclear=parentEditor||parentNuclearStructureFromMcif(parsed,cifText);
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
  if(cifSpaceGroups.length){
    loadParsedCifIntoGenerator(crystallographicStructureFromMcif(parsed,cifText)||parsed,fileName,{message:false});
    updateImportedUnitCellPanels(parsed,cifText);
  }
  // Loading a file is the one place where both editors acquire common values.
  // For generated magnetic supercells Sample already refers to the parent cell.
  if(findGeneratorSpaceGroup(parsed)) syncCrystallographicCell("sample",{refresh:false});
  // Importing a file changes Sample programmatically, not through sidebar
  // input/change events. Persist the imported group and cell together so the
  // next reload cannot restore an older Sample space group (often P1).
  if(persist) saveLeftPanelState();
  // The selected CIF/mCIF, not just a newly generated CIF, is a valid source
  // for the nuclear reflection table.  Drop any previous Generate snapshot and
  // recalculate from the newly selected structure (even when the editable CIF
  // Generator cannot import its space-group setting).
  invalidateGeneratedCif("");

  updateAutoW();
  updateCifUI();
  updateStructureUnitCellReference(currentStructureForViewer());
  clearError();
  scheduleRecalc();
  renderCifStructureIfVisible();
  return parsed;
}

async function selectCifFile(file){
  if(!file) return;
  return loadCifText(await file.text(),file.name);
}

function clearSelectedCif(){
  liveEditorNuclearSource=null;
  liveEditorNuclearInvalid=false;
  magneticTableHasBeenCalculated=false;
  discardStructureEditingSession();
  setSelectedCifState(null,"","");
  updateImportedUnitCellPanels(null,"");
  // Clear the separate Generator-only viewer cache as well: a later tab
  // switch must not resurrect a CIF that was explicitly cleared.
  loadedGeneratorCifStructure=null;
  loadedGeneratorCifName="";
  resetStructureViewerStateToDefaults();
  try{ localStorage.removeItem(SELECTED_CIF_STORAGE_KEY); }catch(_e){}
  cifStructureSourcePreference="selected";
  if($("cifFileInput")) $("cifFileInput").value="";
  if($("cifLoadFile")) $("cifLoadFile").value="";
  if($("mcifPreviewText")) $("mcifPreviewText").textContent="Select a CIF/mCIF to preview it.";
  // Do not leave download/Set actions enabled for an obsolete reviewed file.
  invalidateGeneratedCif("");
  invalidateGeneratedMcif();
  if(cifSpaceGroups.length) setSampleSpaceGroup(1,{recalc:false});
  else{
    if($("sampleSpaceGroup")) $("sampleSpaceGroup").value="1";
    if($("sampleSpaceGroupNumber")) $("sampleSpaceGroupNumber").value="1";
  }
  updateCifUI();
  clearError();
  saveLeftPanelState();
  scheduleRecalc();
  renderCifStructureIfVisible();
}

// ==================== CIF Generator ====================
let cifSpaceGroups=[];

function sampleSpaceGroupByNumber(number){
  const n=Math.round(Number(number));
  return cifSpaceGroups.find(sg=>sg.number===n) || null;
}

function centeringFromSpaceGroup(sg){
  const symbol=String(sg?.hm || "").trim().toUpperCase();
  const first=symbol.charAt(0);
  // The bundled standard settings use conventional P/A/B/C/I/F/R lattice
  // symbols. H, if ever encountered in imported metadata, is equivalent to
  // rhombohedral centering in hexagonal axes for this extinction filter.
  if(["P","A","B","C","I","F","R"].includes(first)) return first;
  if(first==="H") return "R";
  return "P";
}

function selectedSampleSpaceGroup(){
  const n=Number($("sampleSpaceGroup")?.value || $("sampleSpaceGroupNumber")?.value || 1);
  return sampleSpaceGroupByNumber(n) || sampleSpaceGroupByNumber(1);
}

function selectedSampleCentering(){
  return centeringFromSpaceGroup(selectedSampleSpaceGroup());
}

const SAMPLE_LATTICE_FIELDS={a:"a",b:"b",c:"c",alpha:"alpha",beta:"beta",gamma:"gamma"};

function applySampleLatticeConstraints(){
  const sg=selectedSampleSpaceGroup();
  if(!sg) return;
  const inputs=Object.fromEntries(Object.entries(SAMPLE_LATTICE_FIELDS).map(([key,id])=>[key,$(id)]));
  for(const input of Object.values(inputs)){
    if(!input) continue;
    input.readOnly=false;
    input.removeAttribute("aria-readonly");
    input.title="";
  }
  const lockValue=(key,value,reason)=>{
    const input=inputs[key]; if(!input) return;
    input.value=String(value);
    input.readOnly=true;
    input.setAttribute("aria-readonly","true");
    input.title=reason;
  };
  const lockEqual=(key,sourceKey,reason)=>{
    const source=Number(inputs[sourceKey]?.value);
    if(Number.isFinite(source)) lockValue(key,source,reason);
  };

  // Keep the Sample lattice convention identical to the CIF Generator:
  // standard monoclinic b setting, hexagonal axes for trigonal groups.
  const cs=String(sg.crystal_system||"").toLowerCase();
  if(cs==="monoclinic"){
    lockValue("alpha",90,"Fixed by the standard monoclinic setting.");
    lockValue("gamma",90,"Fixed by the standard monoclinic setting.");
  }else if(cs==="orthorhombic"){
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by orthorhombic symmetry.");
  }else if(cs==="tetragonal"){
    lockEqual("b","a","b = a by tetragonal symmetry.");
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by tetragonal symmetry.");
  }else if(cs==="trigonal" || cs==="hexagonal"){
    lockEqual("b","a",`${cs==="trigonal"?"Trigonal (hexagonal setting)":"Hexagonal"} symmetry requires b = a.`);
    lockValue("alpha",90,"Fixed by the standard hexagonal-axis setting.");
    lockValue("beta",90,"Fixed by the standard hexagonal-axis setting.");
    lockValue("gamma",120,"Fixed by the standard hexagonal-axis setting.");
  }else if(cs==="cubic"){
    lockEqual("b","a","b = a by cubic symmetry.");
    lockEqual("c","a","c = a by cubic symmetry.");
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by cubic symmetry.");
  }
}

function setSampleSpaceGroup(number,{recalc=true}={}){
  const sg=sampleSpaceGroupByNumber(number);
  if(!sg) return false;
  const select=$("sampleSpaceGroup"), entry=$("sampleSpaceGroupNumber");
  if(select) select.value=String(sg.number);
  if(entry) entry.value=String(sg.number);
  applySampleLatticeConstraints();
  updateAutoW();
  if(recalc) scheduleRecalc();
  return true;
}

// Space-group numbers are integers (International Tables Nos. 1–230).
// The HTML step=1 attribute does not prevent typing a fraction, so also
// reject non-digits and incomplete numeric syntax while the field is edited.
function bindSpaceGroupIntegerEntry(entry){
  if(!entry || entry.dataset.integerOnlyBound) return;
  entry.dataset.integerOnlyBound="1";
  let previous=entry.value;
  entry.addEventListener("focus",()=>{ previous=entry.value; });
  entry.addEventListener("beforeinput",ev=>{
    if(ev.data && /\D/.test(ev.data)) ev.preventDefault();
  });
  entry.addEventListener("paste",ev=>{
    const pasted=ev.clipboardData?.getData("text");
    if(pasted != null && !/^\d{1,3}$/.test(pasted)) ev.preventDefault();
  });
  entry.addEventListener("input",()=>{
    if(!entry.validity.badInput && (entry.value==="" || /^\d{1,3}$/.test(entry.value))){
      previous=entry.value;
    }else{
      entry.value=previous;
    }
  },true);
}
function readSpaceGroupInteger(entry,fallback){
  const raw=String(entry?.value??"");
  const number=/^\d{1,3}$/.test(raw)?Number(raw):NaN;
  if(!Number.isInteger(number) || !sampleSpaceGroupByNumber(number)){
    if(entry) entry.value=String(fallback||1);
    return null;
  }
  if(entry) entry.value=String(number);
  return number;
}

function jumpToSampleSpaceGroupNumber(){
  const entry=$("sampleSpaceGroupNumber");
  if(!entry) return;
  const n=readSpaceGroupInteger(entry,Number($("sampleSpaceGroup")?.value)||1);
  if(n!==null && !setSampleSpaceGroup(n)) entry.value=String(Number($("sampleSpaceGroup")?.value)||1);
}

function syncSampleSpaceGroupNumberFromSelect(){
  const n=Number($("sampleSpaceGroup")?.value);
  if(Number.isInteger(n) && $("sampleSpaceGroupNumber")) $("sampleSpaceGroupNumber").value=String(n);
  applySampleLatticeConstraints();
  updateAutoW();
  scheduleRecalc();
}

function restoreSampleSpaceGroupSelection(){
  let saved=null;
  try{ saved=JSON.parse(localStorage.getItem(LEFT_PANEL_STORAGE_KEY)||"null"); }catch(_e){}
  const n=Number(saved?.values?.sampleSpaceGroup || saved?.values?.sampleSpaceGroupNumber);
  if(Number.isInteger(n) && sampleSpaceGroupByNumber(n)) setSampleSpaceGroup(n,{recalc:false});
  else setSampleSpaceGroup(1,{recalc:false});
}

function populateSampleSpaceGroupControls(){
  const select=$("sampleSpaceGroup");
  if(!select) return;
  select.replaceChildren();
  for(const sg of cifSpaceGroups){
    const opt=document.createElement("option");
    opt.value=String(sg.number);
    opt.textContent=`${sg.number} — ${sg.hm}`;
    select.appendChild(opt);
  }
  restoreSampleSpaceGroupSelection();
  if(!select.dataset.bound){
    select.addEventListener("change",syncSampleSpaceGroupNumberFromSelect);
    bindSpaceGroupIntegerEntry($("sampleSpaceGroupNumber"));
    $("sampleSpaceGroupNumber")?.addEventListener("change",jumpToSampleSpaceGroupNumber);
    $("sampleSpaceGroupNumber")?.addEventListener("keydown",ev=>{
      if(ev.key==="Enter"){ ev.preventDefault(); jumpToSampleSpaceGroupNumber(); }
    });
    // For tetragonal / trigonal / hexagonal / cubic cells, b (and cubic c)
    // follows the independent a field immediately while the user edits it.
    // Cell synchronization applies constraints on change, not each keystroke.
    select.dataset.bound="1";
  }
}

// Symmetry works on independent asymmetric sites; Manual exposes the full
// expanded unit cell and exports a P1 structure when individually edited.
let structurePositionEditingMode='sites';
let structurePositionTableElement='*';
const positionModeDrafts={sites:null,individual:null};
let positionSavedSourcePreference=null;
let positionManualSourceSignature=null;
const CIF_GENERATOR_ATOMS_STORAGE_KEY="tas-simulator-cif-generator-atoms-v1";
let restoringCifGeneratorAtoms=false;
let restoringCifStartup=false;

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
  for(const id of Object.values(CIF_LATTICE_FIELDS))values[id]=$(id)?.value??'';
  return values;
}
function currentCifGeneratorAtomRows(){
  return [...document.querySelectorAll("#cifAtomRows .cif-atom-row")].map(cifAtomRowValues).filter(Boolean);
}
function saveCifGeneratorAtomsState(){
  if(restoringCifGeneratorAtoms || restoringCifStartup) return;
  positionModeDrafts[structurePositionEditingMode]=currentCifGeneratorAtomRows();
  try{ localStorage.setItem(CIF_GENERATOR_ATOMS_STORAGE_KEY,JSON.stringify({version:3,
    sourceKey:currentEditorSourceKey(),
    mode:structurePositionEditingMode,element:structurePositionTableElement,
    drafts:positionModeDrafts,atoms:currentCifGeneratorAtomRows(),
    cell:generatorCellDraft(),crystalSystem:$('cifCrystalSystem')?.value,
    generatedName:$('cifGeneratedName')?.value,
    sgNumber:Number($('cifSpaceGroup')?.value)||1,
    manualSourceSignature:positionManualSourceSignature,
    sourcePreference:cifStructureSourcePreference,
    savedSourcePreference:positionSavedSourcePreference})); }catch(_e){}
}
function restoreCifGeneratorAtomsState(){
  let saved;
  try{ saved=JSON.parse(localStorage.getItem(CIF_GENERATOR_ATOMS_STORAGE_KEY)||"null"); }catch(_e){ return false; }
  if(!saved || ![1,2,3].includes(saved.version) || !Array.isArray(saved.atoms) || !saved.atoms.length) return false;
  // Saved edits from an unrelated imported file must never overwrite this CIF.
  if(saved.version===3 && saved.sourceKey!==currentEditorSourceKey()) return false;
  restoringCifGeneratorAtoms=true;
  try{
    if(saved.version>=2){
      positionModeDrafts.sites=Array.isArray(saved.drafts?.sites)?saved.drafts.sites:null;
      positionModeDrafts.individual=Array.isArray(saved.drafts?.individual)?saved.drafts.individual:null;
      structurePositionEditingMode=saved.mode==='individual'?'individual':'sites';
      structurePositionTableElement=String(saved.element||'*');
      positionManualSourceSignature=saved.manualSourceSignature||null;
      if(Number.isInteger(Number(saved.sgNumber)) && Number(saved.sgNumber)>=1 && Number(saved.sgNumber)<=230){
        selectCifSpaceGroup(Number(saved.sgNumber),{syncSystem:true});
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
      cifStructureSourcePreference=saved.sourcePreference||cifStructureSourcePreference;
      positionSavedSourcePreference=saved.savedSourcePreference||null;
      // Migrate older drafts: Manual used to force a P1-generated preview.
      // Restore its original view source instead of repeating that bug.
      if(structurePositionEditingMode==='individual' && positionSavedSourcePreference){
        cifStructureSourcePreference=positionSavedSourcePreference;
        positionSavedSourcePreference=null;
      }
    }
    // Position Mode is an editor-view option. Never replace the selected mCIF
    // Structure (or its parent-cell frame) with a P1 draft on restoration.
    replaceCifAtomRows(saved.atoms);
    refreshPositionTableToolbar();
    return true;
  }finally{ restoringCifGeneratorAtoms=false; }
}

let lastGeneratedCifText="";
let lastGeneratedCifName="generated_structure.cif";
let selectedCifReflectionKey="";
let cifReflectionSort={key:"intensity",direction:"desc"};
let lastGeneratedCifParsed=null;
let lastGeneratedCifSpaceGroup=null;
let lastGeneratedReflections=[];
let cifStructureViewMode="a";
let cifStructureSourcePreference="generated";
let loadedGeneratorCifStructure=null;
let loadedGeneratorCifName="";
const STRUCTURE_VIEWER_STORAGE_KEY="tas-simulator-structure-viewer-v2";
// The DISTANCE limit is determined by the actual lattice parallelepiped,
// not a hard-coded value in Å. Mesh/count budgets below are independent
// safety limits: a large crystallographic cell can still contain many atoms.
const STYLE_MAX_BOND_ATOMS=850;
const STYLE_MAX_BOND_SEGMENTS=12000;
const STYLE_MAX_BOND_RULES=24;
const STRUCTURE_MAX_REPLICATION_TESTS=250000;
const STRUCTURE_MAX_DISPLAYED_ATOMS=6000;
// Maximum distance between two points of ONE unit cell. For skew cells the
// longest body diagonal may be a+b-c, a-b+c or -a+b+c, NOT just a+b+c.
function styleCellDiagonalLimit(basis){
  if(!basis?.a || !basis?.b || !basis?.c)return NaN;
  const add=(a,b,c)=>vecAdd(vecAdd(a,b),c);
  const {a,b,c}=basis;
  const candidates=[add(a,b,c),add(a,b,vecScale(c,-1)),
    add(a,vecScale(b,-1),c),add(vecScale(a,-1),b,c)];
  const limit=Math.max(...candidates.map(vecNorm));
  return Number.isFinite(limit) && limit>0 ? limit : NaN;
}
function styleCellDiagonalForViewer(){
  const lattice=currentStructureForViewer()?.structure?.lattice;
  return styleCellDiagonalLimit(directLatticeBasis(lattice));
}
function safeStyleDistances(min,max,limit=Infinity){
  return Number.isFinite(min) && Number.isFinite(max) &&
    min>=0 && max>=min && max>0 && max<=limit+1e-8;
}
function oversizedSavedStyleRule(rule){
  if(!rule || typeof rule!=="object") return false;
  const max=Number(rule.maxDistance ?? rule.distance ?? 3);
  const min=Number(rule.minDistance ?? 0);
  return !safeStyleDistances(min,max);
}
// Repair structurally invalid stored ranges early. Cell-dependent checks run
// again after restoring the actual CIF lattice (see restoreStructureViewerState).
// Keep invalid numbers untouched for editing; turn drawing off instead.
function rescueSavedStyleRules(store){
  let repaired=false;
  for(const state of Object.values(store?.states || {})){
    if(!Array.isArray(state?.bonds)) continue;
    for(const rule of state.bonds){
      if(oversizedSavedStyleRule(rule) && rule.enabled!==false){
        rule.enabled=false;
        repaired=true;
      }
    }
  }
  return repaired;
}
let restoringStructureViewer=false;
let restoredStructureBondRules=null;
let structureBondDisplayMode="bonds"; // Bonds / Polyhedral / Both
let structureCameraState=null;
let structureProgrammaticCameraUpdate=false;
let structureCameraWatchFrame=0;
let structureCameraWatchSignature="";
let structureCameraPresetRevision=0;
let structureCameraRenderRevision=0;
let structureMomentStructureType="collinear";
// Checked Modify intentionally means protected/read-only (requested UI behavior).
let structureModifyLocked=false;
const GENERATOR_OUTPUT_TAB_STORAGE_KEY="tas-simulator-generator-output-tab-v1";
// Capture the user's selection BEFORE any initialization can change the DOM.
const initialGeneratorOutputTab=(()=>{
  try { return localStorage.getItem(GENERATOR_OUTPUT_TAB_STORAGE_KEY)||"structure"; }
  catch(_e){ return "structure"; }
})();
let generatorOutputTabRestored=false;
function readSavedGeneratorOutputTab(){return initialGeneratorOutputTab;}
const MCIF_EDIT_DRAFT_KEY="tas-simulator-mcif-modify-drafts-v1";
let importedOriginalQ=[];
let modifiedMagneticDraft=null;
function magneticDraftIdentity(){
  const structure=getSelectedCifStructure();
  return structure?.magnetic ? structureStateFingerprint(structure)+":"+structureSignature(structure) : "";
}
function snapshotMagneticDraft(){
  return {
    propagationVectors:(getPropagationVectors?.()||[]).map(q=>({...q})),
    moments:[...currentMomentSettings()].map(([k,v])=>[k,{...v}]),
    structureType:structureMomentStructureType,
    rotationAxis:structureMomentRotationAxis,
    chirality:structureMomentChirality,
    propagationIndex:structureMomentPropagationIndex,
    spinEditingMode:structureSpinEditingMode,
    directionMode:structureMomentDirectionMode
  };
}
function persistMagneticDraft(){
  const key=magneticDraftIdentity();
  if(!key||!modifiedMagneticDraft) return;
  try{
    const data=JSON.parse(localStorage.getItem(MCIF_EDIT_DRAFT_KEY)||"{}");
    data[key]=modifiedMagneticDraft;
    // Avoid unbounded growth when many structures have been viewed.
    for(const old of Object.keys(data).slice(0,Math.max(0,Object.keys(data).length-16))) delete data[old];
    localStorage.setItem(MCIF_EDIT_DRAFT_KEY,JSON.stringify(data));
  }catch(_e){}
}
function restoreMagneticDraftFromStorage(){
  modifiedMagneticDraft=null;
  try{
    const saved=JSON.parse(localStorage.getItem(MCIF_EDIT_DRAFT_KEY)||"{}")[magneticDraftIdentity()];
    if(saved && Array.isArray(saved.moments) && Array.isArray(saved.propagationVectors)) modifiedMagneticDraft=saved;
  }catch(_e){}
}
function rememberModifiedMagneticDraft(){
  if(!sourceIsMagneticCif()||structureModifyLocked||!importedMagneticEditMode) return;
  modifiedMagneticDraft=snapshotMagneticDraft();
  persistMagneticDraft();
}
// Moment colors are visual preferences, not part of the protected mCIF spin model.
function captureMomentColors(){
  const colors=new Map();
  for(const [key,value] of currentMomentSettings()){
    if(value?.color) colors.set(key,{color:value.color,colorCustomized:!!value.colorCustomized});
  }
  return colors;
}
function reapplyMomentColors(colors){
  for(const [key,visual] of colors){
    const setting=structureMomentSettings.get(key);
    if(setting) structureMomentSettings.set(key,{...setting,...visual});
  }
}
function applyModifiedMagneticDraft(draft){
  if(!draft) return;
  const visualColors=captureMomentColors();
  if(Array.isArray(draft.propagationVectors)) setPropagationVectorsFromFile?.(draft.propagationVectors.map(q=>({...q})));
  structureMomentSettings.clear();
  for(const [key,value] of (draft.moments||[])) structureMomentSettings.set(key,{...value});
  reapplyMomentColors(visualColors);
  structureMomentStructureType=["collinear","helical","sinusoidal"].includes(draft.structureType)?draft.structureType:"collinear";
  structureMomentRotationAxis=draft.rotationAxis||"c";
  structureMomentChirality=draft.chirality||"CCW";
  structureMomentPropagationIndex=Number(draft.propagationIndex)||1;
  structureSpinEditingMode=draft.spinEditingMode==="individual"?"individual":"sites";
  structureMomentDirectionMode=draft.directionMode==="polar"?"polar":"cartesian";
  importedMagneticEditMode=true;
  invalidateGeneratedMcif();
  $("cifMagMomentRows")?.replaceChildren();
  structureControlSignature="";
}
function restoreOriginalImportedMagnetism(){
  const visualColors=captureMomentColors();
  if(importedOriginalQ.length) setPropagationVectorsFromFile?.(importedOriginalQ.map(q=>({...q})));
  const parsed=getSelectedCifStructure();
  structureMomentSettings.clear();
  for(const [siteIndex,site] of (parsed?.asymmetricSites||[]).entries()){
    const key=momentKey({...site,siteIndex});
    structureMomentSettings.set(key,defaultMomentSetting(site,parsed));
  }
  reapplyMomentColors(visualColors);
  importedMagneticEditMode=false;
  structureMomentPropagationIndex=importedOriginalQ.length?1:0;
  $("cifMagMomentRows")?.replaceChildren();
  structureControlSignature="";
  importedMagneticQSignature=propagationSignature();
}
function setImportedMagneticMode(next){
  if(!sourceIsMagneticCif()) return;
  if(next==="mcif"){
    rememberModifiedMagneticDraft();
    structureModifyLocked=true;
    restoreOriginalImportedMagnetism();
  }else{
    structureModifyLocked=false;
    if(modifiedMagneticDraft) applyModifiedMagneticDraft(modifiedMagneticDraft);
    else{
      importedMagneticEditMode=true;
      modifiedMagneticDraft=snapshotMagneticDraft();
      persistMagneticDraft();
    }
  }
  prepareStructureViewerControls();
  refreshMomentPropagationVectorSelect();
  renderCifStructureIfVisible();
}
function importedKDescription(){
  const q=effectivePropagationVectorForStructure();
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

let importedMagneticEditMode=false;
let importedMagneticQSignature="";
function propagationSignature(){
  const q=effectivePropagationVectorForStructure();
  return [q.index,q.h,q.k,q.l].join('|');
}
function activateImportedMagneticEditing(){
  if(!sourceIsMagneticCif() || importedMagneticEditMode || structureModifyLocked) return;
  for(const [key,value] of currentMomentSettings()) structureMomentSettings.set(key,value);
  importedMagneticEditMode=true;
  rememberModifiedMagneticDraft();
  invalidateGeneratedMcif();
  syncImportedMomentStructureType();
  refreshMomentPropagationVectorSelect();
}

let structureMomentRotationAxis="c";
let structureMomentChirality="CCW";
let structureMomentPropagationIndex=0;
let structureMomentDirectionMode="cartesian";
let structureSpinEditingMode="sites";
// Element only filters rows shown in Spins; it never changes moments or mCIF export.
let structureSpinTableElement="*";
// Visual row selection is UI-only: it does not enable/disable moments or
// change any structure-factor or mCIF data. Keys refer to the current editor.
const selectedSpinRowKeys=new Set();
let spinSelectionAnchorKey=null;
let visibleSpinSelectionSites=new Map();
function clearSpinRowSelection({redraw=true}={}){
  if(!selectedSpinRowKeys.size && !spinSelectionAnchorKey)return;
  selectedSpinRowKeys.clear();
  spinSelectionAnchorKey=null;
  for(const row of document.querySelectorAll('#cifMagMomentRows .structure-moment-row')){
    row.classList.remove('spin-row-selected');
    row.setAttribute('aria-selected','false');
  }
  if(redraw)renderCifStructureIfVisible();
}
function syncSpinRowSelection(){
  for(const row of document.querySelectorAll('#cifMagMomentRows .structure-moment-row')){
    const active=selectedSpinRowKeys.has(row.dataset.momentKey);
    row.classList.toggle('spin-row-selected',active);
    row.setAttribute('aria-selected',String(active));
  }
}
function selectSpinMomentRow(key,event={}){
  const rows=[...document.querySelectorAll('#cifMagMomentRows .structure-moment-row')];
  const order=rows.map(row=>row.dataset.momentKey);
  if(!order.includes(key))return;
  if(event.shiftKey && spinSelectionAnchorKey && order.includes(spinSelectionAnchorKey)){
    if(!event.ctrlKey && !event.metaKey)selectedSpinRowKeys.clear();
    const a=order.indexOf(spinSelectionAnchorKey),b=order.indexOf(key);
    for(let i=Math.min(a,b);i<=Math.max(a,b);i++)selectedSpinRowKeys.add(order[i]);
  }else if(event.ctrlKey || event.metaKey){
    if(selectedSpinRowKeys.has(key))selectedSpinRowKeys.delete(key);
    else selectedSpinRowKeys.add(key);
    spinSelectionAnchorKey=key;
  }else{
    const wasSelected=selectedSpinRowKeys.has(key);
    selectedSpinRowKeys.clear();
    if(!wasSelected){selectedSpinRowKeys.add(key);spinSelectionAnchorKey=key;}
    else spinSelectionAnchorKey=null;
  }
  syncSpinRowSelection();
  renderCifStructureIfVisible();
}
// Manual rows correspond to one expanded atom/cell; symmetry-linked rows
// correspond to the full orbit of the asymmetric source site.
function selectedSpinContainsAtom(atom){
  if(!selectedSpinRowKeys.size)return false;
  for(const key of selectedSpinRowKeys){
    const site=visibleSpinSelectionSites.get(key);
    if(!site)continue;
    if(site.individualKey){
      if(atom.expandedAtomIndex!==site.individualIndex)continue;
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

const STRUCTURE_EDITOR_TAB_KEY="tas-simulator-structure-editor-active-tab-v1";
const VALID_STRUCTURE_EDITOR_TABS=["cell","positions","appearance","spins","bonds"];
function rememberedStructureEditorTab(){
  try{
    const value=localStorage.getItem(STRUCTURE_EDITOR_TAB_KEY);
    return VALID_STRUCTURE_EDITOR_TABS.includes(value)?value:"cell";
  }catch(_e){return "cell";}
}
let structureConfigActiveTab=rememberedStructureEditorTab();
let structureMomentGlobalLength=1;
let structureMomentGlobalWidth=10;
let structureMomentGlobalHeadSize=0.51;
let structureMomentGlobalWidthBlank=false;
let structureMomentGlobalHeadBlank=false;
let structureUnitCellMode="one";
// The chosen frame affects ONLY the Structure outline, not atomic coordinates or reflections.
let structureUnitCellReference="crystallographic";
let structureShowXYZ=true;
// Every CIF asymmetric site is available in the Spins tab.
// Only transition-metal and rare-earth sites start enabled by default;
// all other elements (for example O) remain available but start disabled.
const DEFAULT_SPIN_ELEMENTS=new Set([
  // 3d / 4d / 5d transition metals
  "SC","TI","V","CR","MN","FE","CO","NI","CU","ZN",
  "Y","ZR","NB","MO","TC","RU","RH","PD","AG","CD",
  "HF","TA","W","RE","OS","IR","PT","AU","HG",
  // Rare-earth elements (lanthanides; Sc/Y are already included above)
  "LA","CE","PR","ND","PM","SM","EU","GD","TB","DY","HO","ER","TM","YB","LU"
]);
const structureAtomColorOverrides=new Map();
const structureAtomSizeOverrides=new Map();
const structureAtomSizeCleared=new Set();
const structureAtomVisibility=new Map();
const structureMomentSettings=new Map();
const structureElementDefaultColors=new Map();
let structureControlSignature="";
const STRUCTURE_PALETTE=["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf","#c2185b","#009688"];

function structureStateFingerprint(structure){
  if(!structure) return "";
  const raw=structureSignature(structure);
  // Small deterministic FNV-1a fingerprint.  This is only a localStorage key,
  // not a security hash.  The full structure signature is also stored in the
  // saved entry so an accidental hash collision cannot restore the wrong state.
  let h=0x811c9dc5;
  for(let i=0;i<raw.length;i++){
    h^=raw.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,"0");
}
function currentStructureStateIdentity(){
  // Editing positions changes a generated structureSignature on EVERY keystroke.
  // Key the draft to its source CIF (or to the persistent new-generator session),
  // so live Atoms/Spins/Style settings still match after editing and reload.
  const source=currentStructureForViewer();
  if(!source?.structure) return null;
  // The original CIF text is stored separately. Do not duplicate a possibly
  // multi-megabyte mCIF in the viewer-state signature on every edit.
  const signature=`source:${currentEditorSourceKey()}`;
  let h=0x811c9dc5;
  for(let i=0;i<signature.length;i++){
    h^=signature.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return {fingerprint:`session-${h.toString(16).padStart(8,'0')}`,signature,
    legacy:{fingerprint:structureStateFingerprint(source.structure),signature:structureSignature(source.structure)}};
}
function readStructureViewerStateStore(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STRUCTURE_VIEWER_STORAGE_KEY)||"null");
    if(parsed?.version===2 && parsed.states && typeof parsed.states==="object"){
      if(rescueSavedStyleRules(parsed)){
        try{localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify(parsed));}catch(_e){}
      }
      return parsed;
    }
  }catch(_e){}
  return {version:2,states:{}};
}
// Remove all past structure-specific snapshots when the user switches files
// or presses Clear. Do not touch global Instrument/Sample/tab preferences.
function discardStructureEditingSession(){
  try{localStorage.removeItem(STRUCTURE_VIEWER_STORAGE_KEY);}catch(_e){}
  try{localStorage.removeItem(MCIF_EDIT_DRAFT_KEY);}catch(_e){}
  modifiedMagneticDraft=null;
  importedMagneticEditMode=false;
  importedMagneticQSignature="";
  // Invalidate existing DOM rows, otherwise they may be harvested as edits
  // when the new structure is first rendered.
  clearSpinRowSelection({redraw:false});
  selectedAppearanceRowKeys.clear();
  visibleSpinSelectionSites.clear();
  $("cifMagMomentRows")?.replaceChildren();
  $("cifBondRows")?.replaceChildren();
  $("cifAtomColorRows")?.replaceChildren();
  structureControlSignature="";
}
function resetStructureViewerStateToDefaults(){
  clearSpinRowSelection({redraw:false});
  visibleSpinSelectionSites.clear();
  restoringStructureViewer=true;
  try{
    cifStructureViewMode="a";
    structureCameraState=null;
    structureCameraWatchSignature="";
    for(const axis of ["x","y","z"]){
      const cap=axis.toUpperCase();
      if($("cifRange"+cap)) $("cifRange"+cap).value="0 1";
      if($("cifRange"+cap+"Min")) $("cifRange"+cap+"Min").value="0";
      if($("cifRange"+cap+"Max")) $("cifRange"+cap+"Max").value="1";
    }
    structureAtomColorOverrides.clear();
    structureElementDefaultColors.clear();
    structureAtomSizeOverrides.clear();
    structureAtomSizeCleared.clear();
    structureAtomVisibility.clear();
    atomSiteColors.clear(); atomSiteSizes.clear(); atomSiteVisibility.clear();
    structureMomentSettings.clear();
    structureMomentStructureType="collinear";
    structureMomentRotationAxis="c";
    structureMomentChirality="CCW";
    structureMomentPropagationIndex=0;
    structureMomentDirectionMode="cartesian";
    structureSpinEditingMode="sites";
    structureSpinTableElement="*";
    // Keep the user-selected editor tab when a different structure is loaded.
    structureConfigActiveTab=rememberedStructureEditorTab();
    structureMomentGlobalLength=1;
    structureMomentGlobalWidth=10;
    structureMomentGlobalHeadSize=0.51;
    structureMomentGlobalWidthBlank=false;
    structureMomentGlobalHeadBlank=false;
    structureUnitCellMode="one";
    structureUnitCellReference="crystallographic";
    structureShowXYZ=true;
    structureBondDisplayMode="bonds";
    restoredStructureBondRules=[];
    structureControlSignature="";
    
    const unitCellSelect=$("cifUnitCellMode"); if(unitCellSelect) unitCellSelect.value="one";
    const referenceSelect=$("cifUnitCellReference"); if(referenceSelect) referenceSelect.value="crystallographic";
    const xyzSelect=$("cifShowXYZ"); if(xyzSelect) xyzSelect.value="show";
  }finally{ restoringStructureViewer=false; }
}
function saveStructureViewerState(){
  if(restoringStructureViewer || restoringCifStartup) return;
  try{
    const identity=currentStructureStateIdentity();
    if(!identity) return;
    const liveMoments=currentMomentSettings();
    for(const [key,value] of liveMoments) structureMomentSettings.set(key,value);
    const payload={
      signature:identity.signature,
      viewMode:cifStructureViewMode,
      range:structureRange(),
      atomColors:Object.fromEntries(structureAtomColorOverrides),
      atomSizes:Object.fromEntries(structureAtomSizeOverrides),
      atomSizeCleared:[...structureAtomSizeCleared],
      atomVisible:Object.fromEntries(structureAtomVisibility),
      atomSiteColors:Object.fromEntries(atomSiteColors),
      atomSiteSizes:Object.fromEntries(atomSiteSizes),
      atomSiteVisible:Object.fromEntries(atomSiteVisibility),
      moments:Object.fromEntries(structureMomentSettings),
      momentStructureType:structureMomentStructureType,
      momentRotationAxis:structureMomentRotationAxis,
      momentChirality:structureMomentChirality,
      momentPropagationIndex:structureMomentPropagationIndex,
      momentDirectionMode:structureMomentDirectionMode,
      spinEditingMode:structureSpinEditingMode,
      spinTableElement:structureSpinTableElement,
      configActiveTab:structureConfigActiveTab,
      momentCoordinatesVersion:3,
      zeroMomentDefaultsVersion:1,
      momentGlobalLength:structureMomentGlobalLength,
      momentGlobalWidth:structureMomentGlobalWidth,
      momentGlobalHeadSize:structureMomentGlobalHeadSize,
      momentGlobalWidthBlank:structureMomentGlobalWidthBlank,
      momentGlobalHeadBlank:structureMomentGlobalHeadBlank,
      unitCellMode:structureUnitCellMode,
      unitCellReference:structureUnitCellReference,
      showXYZ:structureShowXYZ,
      structureBondDisplayMode,
      bonds:readStructureBondRules()
    };
    // Retain only the active structure, never an accumulating history.
    localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify({
      version:2,states:{[identity.fingerprint]:payload}
    }));
  }catch(_e){}
}
function sourceIsMagneticCif(){return currentStructureForViewer()?.structure?.magnetic===true;}
function restoreStructureViewerState(){
  clearSpinRowSelection({redraw:false});
  visibleSpinSelectionSites.clear();
  const identity=currentStructureStateIdentity();
  if(!identity){ resetStructureViewerStateToDefaults(); return false; }
  const store=readStructureViewerStateStore();
  let saved=store.states?.[identity.fingerprint];
  // Migrate matching older (structure-derived) keys once; retain the user's
  // prior settings after a software upgrade, not after loading another CIF.
  if((!saved || saved.signature!==identity.signature) && identity.legacy){
    const old=store.states?.[identity.legacy.fingerprint];
    if(old?.signature===identity.legacy.signature){
      saved={...old,signature:identity.signature};
      try{localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify({version:2,
        states:{[identity.fingerprint]:saved}}));}catch(_e){}
    }
  }
  // Different CIF/structure: never leak atom colours, spin settings or bonds
  // from the previously displayed structure.
  if(!saved || saved.signature!==identity.signature){
    resetStructureViewerStateToDefaults();
    return false;
  }
  restoringStructureViewer=true;
  try{
    // Always start the Structure viewer from the crystallographic a direction.
    cifStructureViewMode="a";
    structureCameraState=null;
    structureCameraWatchSignature="";
    for(const axis of ["x","y","z"]){
      const cap=axis.toUpperCase();
      const legacy=Number(saved.repeat?.[axis]);
      const minValue=Number(saved.range?.[axis]?.min);
      const maxValue=Number(saved.range?.[axis]?.max);
      const min=Number.isFinite(minValue)?minValue:0;
      const max=Number.isFinite(maxValue)?maxValue:(Number.isFinite(legacy)?legacy:1);
      if($("cifRange"+cap)) $("cifRange"+cap).value=`${min} ${max}`;
      if($("cifRange"+cap+"Min")) $("cifRange"+cap+"Min").value=String(min);
      if($("cifRange"+cap+"Max")) $("cifRange"+cap+"Max").value=String(max);
    }
    structureAtomColorOverrides.clear();
    for(const [element,color] of Object.entries(saved.atomColors||{})) if(/^#[0-9a-f]{6}$/i.test(String(color))) structureAtomColorOverrides.set(element,String(color));
    structureAtomSizeOverrides.clear();
    for(const [element,size] of Object.entries(saved.atomSizes||{})){ const n=Number(size); if(Number.isFinite(n)) structureAtomSizeOverrides.set(element,n); }
    structureAtomSizeCleared.clear();
    for(const element of (Array.isArray(saved.atomSizeCleared)?saved.atomSizeCleared:[])) structureAtomSizeCleared.add(String(element));
    structureAtomVisibility.clear();
    for(const [element,visible] of Object.entries(saved.atomVisible||{})) structureAtomVisibility.set(element,visible!==false);
    atomSiteColors.clear();atomSiteSizes.clear();atomSiteVisibility.clear();
    for(const [key,value] of Object.entries(saved.atomSiteColors||{})) if(/^#[0-9a-f]{6}$/i.test(value)) atomSiteColors.set(key,value);
    for(const [key,value] of Object.entries(saved.atomSiteSizes||{})) if(Number.isFinite(Number(value))) atomSiteSizes.set(key,Math.max(2,Math.min(30,Number(value))));
    for(const [key,value] of Object.entries(saved.atomSiteVisible||{})) atomSiteVisibility.set(key,value!==false);
    structureMomentSettings.clear();
    for(const [key,value] of Object.entries(saved.moments||{})) if(value && typeof value==="object") structureMomentSettings.set(key,{...value});
    // Old saved UI state can contain implicit +z, 1 μB defaults. Discard those
    // only for nonmagnetic structures. New explicit edits remain persistent.
    if(!sourceIsMagneticCif() && saved.zeroMomentDefaultsVersion!==1) structureMomentSettings.clear();
    if(sourceIsMagneticCif() && saved.momentCoordinatesVersion!==3) {
      for(const site of (currentStructureForViewer()?.structure?.asymmetricSites||[])) {
        if(!Array.isArray(site.magneticMoment)) continue;
        const key=momentKey({...site,siteIndex:(currentStructureForViewer()?.structure?.asymmetricSites||[]).indexOf(site)});
        const existing=structureMomentSettings.get(key)||{};
        const canonical=defaultMomentSetting(site,currentStructureForViewer().structure);
        structureMomentSettings.set(key,{...existing,mx:canonical.mx,my:canonical.my,mz:canonical.mz,size:1});
      }
    }
    if(["collinear","helical","sinusoidal"].includes(String(saved.momentStructureType||""))) structureMomentStructureType=String(saved.momentStructureType);
    else if(String(saved.momentStructureType||"")==="canted") structureMomentStructureType="collinear";
    if(["a","b","c"].includes(String(saved.momentRotationAxis||""))) structureMomentRotationAxis=String(saved.momentRotationAxis);
    if(["CW","CCW"].includes(String(saved.momentChirality||""))) structureMomentChirality=String(saved.momentChirality);
    { const n=Number(saved.momentPropagationIndex); structureMomentPropagationIndex=Number.isInteger(n)&&n>0?n:0; }
    if(["cartesian","polar"].includes(String(saved.momentDirectionMode||""))) structureMomentDirectionMode=String(saved.momentDirectionMode);
    structureSpinEditingMode=saved.spinEditingMode==="individual"?"individual":"sites";
    structureSpinTableElement=String(saved.spinTableElement||"*");
    // Editor navigation is a global UI preference, not structure-specific data.
    structureConfigActiveTab=rememberedStructureEditorTab();
    { const n=Number(saved.momentGlobalLength); if(Number.isFinite(n)&&n>=0) structureMomentGlobalLength=n; }
    { const n=Number(saved.momentGlobalWidth); if(Number.isFinite(n)&&n>=1) structureMomentGlobalWidth=n; }
    { const n=Number(saved.momentGlobalHeadSize); if(Number.isFinite(n)&&n>0) structureMomentGlobalHeadSize=n; }
    structureMomentGlobalWidthBlank=saved.momentGlobalWidthBlank===true;
    structureMomentGlobalHeadBlank=saved.momentGlobalHeadBlank===true;
    if(["all","one","none"].includes(String(saved.unitCellMode||""))) structureUnitCellMode=String(saved.unitCellMode);
    else structureUnitCellMode="one";
    structureUnitCellReference=saved.unitCellReference==="magnetic"?"magnetic":"crystallographic";
    structureShowXYZ=saved.showXYZ!==false;
    structureBondDisplayMode=["bonds","polyhedral","both"].includes(saved.structureBondDisplayMode) ? saved.structureBondDisplayMode : "bonds";
    // A persisted cutoff such as 1e100 must never trigger a geometry rebuild
    // on the first load. Disable it against the CURRENT unit-cell diagonal,
    // preserving its entered value so it can be corrected later.
    const limit=styleCellDiagonalForViewer();
    restoredStructureBondRules=Array.isArray(saved.bonds)?saved.bonds.map(x=>{
      const rule={...x};
      // Old saves had one global Bonds/Polyhedral/Both mode. Migrate only
      // fields that are absent; never overwrite a newly saved checkbox.
      const oldMode=structureBondDisplayMode;
      if(typeof rule.bonds!=='boolean') rule.bonds=oldMode!=='polyhedral';
      if(typeof rule.polyhedral!=='boolean') rule.polyhedral=oldMode==='polyhedral'||oldMode==='both';
      const min=Number(rule.minDistance??0);
      const max=Number(rule.maxDistance??rule.distance??3);
      if(!Number.isFinite(limit) || !safeStyleDistances(min,max,limit))rule.enabled=false;
      return rule;
    }):[];
    structureControlSignature="";
    
    const unitCellSelect=$("cifUnitCellMode"); if(unitCellSelect) unitCellSelect.value=structureUnitCellMode;
    const referenceSelect=$("cifUnitCellReference"); if(referenceSelect) referenceSelect.value=structureUnitCellReference;
    const xyzSelect=$("cifShowXYZ"); if(xyzSelect) xyzSelect.value=structureShowXYZ?"show":"hide";
    return true;
  }finally{ restoringStructureViewer=false; }
}

function vecAdd(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function vecSub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function vecScale(v,s){ return [v[0]*s,v[1]*s,v[2]*s]; }
function vecDot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function vecCross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function vecNorm(v){ return Math.hypot(v[0],v[1],v[2]); }
function vecNormalize(v){ const n=vecNorm(v); return n>1e-12 ? [v[0]/n,v[1]/n,v[2]/n] : [0,0,1]; }
function directionToPolar(v){
  if(vecNorm(v)<1e-12) return {theta:0,phi:0};
  const n=vecNormalize(v);
  const theta=Math.acos(Math.max(-1,Math.min(1,n[2])))*180/PI;
  let phi=Math.atan2(n[1],n[0])*180/PI;
  if(phi<0) phi+=360;
  return {theta,phi};
}
function directionFromPolar(thetaDeg,phiDeg){
  const theta=Number(thetaDeg)*PI/180, phi=Number(phiDeg)*PI/180;
  if(!Number.isFinite(theta)||!Number.isFinite(phi)) return [0,0,1];
  return [Math.sin(theta)*Math.cos(phi),Math.sin(theta)*Math.sin(phi),Math.cos(theta)];
}
function fracWrap01(x){ return ((x%1)+1)%1; }
function clampInt(value,min,max,fallback=1){
  const n=Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
}
function directLatticeBasis(lattice){
  const a=Number(lattice?.a), b=Number(lattice?.b), c=Number(lattice?.c);
  const al=Number(lattice?.alpha||90)*PI/180;
  const be=Number(lattice?.beta||90)*PI/180;
  const ga=Number(lattice?.gamma||90)*PI/180;
  if(![a,b,c,al,be,ga].every(Number.isFinite) || !(a>0&&b>0&&c>0)) return null;
  const ca=Math.cos(al), cb=Math.cos(be), cg=Math.cos(ga), sg=Math.sin(ga);
  if(Math.abs(sg)<1e-12) return null;
  const avec=[a,0,0];
  const bvec=[b*cg,b*sg,0];
  const cx=c*cb;
  const cy=c*(ca-cb*cg)/sg;
  const cz2=Math.max(0,c*c-cx*cx-cy*cy);
  const cvec=[cx,cy,Math.sqrt(cz2)];
  const V=vecDot(avec,vecCross(bvec,cvec));
  if(!(Math.abs(V)>1e-12)) return null;
  const astar=vecScale(vecCross(bvec,cvec),1/V);
  const bstar=vecScale(vecCross(cvec,avec),1/V);
  const cstar=vecScale(vecCross(avec,bvec),1/V);
  return {a:avec,b:bvec,c:cvec,astar,bstar,cstar,volume:Math.abs(V)};
}
function fractionalToCartesian(basis,frac){
  return vecAdd(vecAdd(vecScale(basis.a,frac[0]),vecScale(basis.b,frac[1])),vecScale(basis.c,frac[2]));
}
function supercellCenter(basis,repeats){
  return vecScale(vecAdd(vecAdd(vecScale(basis.a,repeats.x),vecScale(basis.b,repeats.y)),vecScale(basis.c,repeats.z)),0.5);
}
function hashString(str){
  let h=0;
  const s=String(str||"");
  for(let i=0;i<s.length;i++) h=((h<<5)-h+s.charCodeAt(i))|0;
  return Math.abs(h);
}
function hslToHex(h,s,l){
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;} else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
  const hex=v=>Math.round((v+m)*255).toString(16).padStart(2,"0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
function assignDistinctElementColors(elements){
  structureElementDefaultColors.clear();
  elements.forEach((element,index)=>{
    const color=index<STRUCTURE_PALETTE.length ? STRUCTURE_PALETTE[index] : hslToHex((index*137.508)%360,68,50);
    structureElementDefaultColors.set(String(element),color);
  });
}
function defaultElementColor(element){
  return structureElementDefaultColors.get(String(element||"")) || STRUCTURE_PALETTE[hashString(element)%STRUCTURE_PALETTE.length];
}
function elementColor(element){
  return structureAtomColorOverrides.get(String(element||"")) || defaultElementColor(element);
}
// Site-level presentation overrides are separate from crystallographic data.
// Using sourceSiteIndex keeps symmetry-generated mates together with their site.
const atomSiteColors=new Map(), atomSiteSizes=new Map(), atomSiteVisibility=new Map();
const expandedAtomElements=new Set();
// Appearance in an mCIF is grouped by PARENT crystallographic orbits;
// magnetic moments and their sourceSiteIndex remain in the original magnetic
// supercell. This makes Ni(1) refer to all symmetry-equivalent Ni positions.
const appearanceOrbitCache=new WeakMap();
function applyParentSymmetryOperation(operation,xyz){
  const parts=String(operation).split(',');
  if(parts.length!==3)return null;
  const fraction=t=>{
    if(t==='-'||t==='+')return t==='-'?-1:1;
    if(!t)return 1;
    const bits=t.split('/');
    const result=bits.length===2?Number(bits[0])/Number(bits[1]):Number(t);
    return Number.isFinite(result)?result:NaN;
  };
  return parts.map(expr=>{
    let value=0;
    for(const term of String(expr).replace(/\s/g,'').replace(/-/g,'+-').split('+').filter(Boolean)){
      const m=term.match(/[xyz]/i);
      if(m) value+=fraction(term.replace(m[0],''))*xyz['xyz'.indexOf(m[0].toLowerCase())];
      else value+=fraction(term);
    }
    return ((value%1)+1)%1;
  });
}
function parentAppearanceOrbits(structure){
  const selected=getSelectedCifStructure();
  if(!structure?.magnetic || !selected ||
      structure.asymmetricSites!==selected.asymmetricSites)return null;
  if(appearanceOrbitCache.has(selected))return appearanceOrbitCache.get(selected);
  const text=getSelectedCifText();
  const parent=crystallographicStructureFromMcif(selected,text);
  const qs=propagationVectorsFromMcif(text,selected);
  const relation=qs.length===1 ? parentIndexingFromMcif(text,selected.lattice,
    [qs[0].h,qs[0].k,qs[0].l]) : null;
  if(!parent?.asymmetricSites?.length || !relation?.replication){
    appearanceOrbitCache.set(selected,null);return null;
  }
  const ops=findGeneratorSpaceGroup(parent)?.operations||['x,y,z'];
  const equiv=(a,b)=>a.every((x,i)=>Math.abs(x-b[i]-Math.round(x-b[i]))<2e-4);
  const orbitPoints=parent.asymmetricSites.map(site=>ops.map(op=>
    applyParentSymmetryOperation(op,[site.x,site.y,site.z]).map(v=>v)));
  const siteMap=new Map();
  for(const [index,site] of selected.asymmetricSites.entries()){
    const xyz=['x','y','z'].map((key,i)=>((Number(site[key])*relation.replication[i])%1+1)%1);
    const which=parent.asymmetricSites.findIndex((p,j)=>p.element===site.element &&
      orbitPoints[j].some(point=>equiv(point,xyz)));
    if(which>=0)siteMap.set(index,which);
  }
  const expanded=parentNuclearStructureFromMcif(selected,text)?.atoms||[];
  const manualMap=new Map();
  const fracMatch=(a,b)=>a.every((v,i)=>Math.abs(v-b[i]-Math.round(v-b[i]))<2e-4);
  for(const [index,site] of selected.asymmetricSites.entries()){
    const xyz=['x','y','z'].map((key,i)=>((Number(site[key])*relation.replication[i])%1+1)%1);
    const target=expanded.findIndex(atom=>atom.element===site.element &&
      fracMatch(xyz,[atom.x,atom.y,atom.z].map(Number)));
    if(target>=0) manualMap.set(index,`manual-site:${target}`);
  }
  const counts=new Map();
  const manualSites=expanded.map(atom=>{
    const el=String(atom.element),n=(counts.get(el)||0)+1;counts.set(el,n);
    return {...atom,label:`${el}${n}`};
  });
  const metadata={sites:parent.asymmetricSites,siteMap,replication:relation.replication,
    orbitPoints,manualSites,manualMap};
  appearanceOrbitCache.set(selected,metadata);
  return metadata;
}
function atomSiteKey(atom){
  const index=Number(atom?.appearanceSiteIndex??atom?.sourceSiteIndex);
  if(typeof atom?.appearanceSiteKey==='string') return atom.appearanceSiteKey;
  return Number.isInteger(index)&&index>=0 ? `site:${index}` : null;
}
function atomDisplayColor(atom){
  const key=atomSiteKey(atom);
  return (key&&atomSiteColors.get(key)) || elementColor(atom.element);
}
// Complementary hue for the selection ring, calculated from the SAME displayed
// atom color (including an individual site's override in the Atoms table).
// Keep the existing selection ring size, gap and stroke independent of color.
function complementaryAtomOutlineColor(color){
  const value=String(color||'').trim();
  const hex=value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if(!hex)return '#000000';
  const full=hex[1].length===3 ? [...hex[1]].map(ch=>ch+ch).join('') : hex[1];
  const rgb=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255);
  const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;
  const lightness=(max+min)/2;
  // Grey and near-grey atoms have no well-defined hue: use brightness contrast.
  if(delta<0.015)return lightness>0.55?'#252525':'#dedede';
  let hue;
  if(max===rgb[0])hue=((rgb[1]-rgb[2])/delta)%6;
  else if(max===rgb[1])hue=(rgb[2]-rgb[0])/delta+2;
  else hue=(rgb[0]-rgb[1])/delta+4;
  hue=((hue*60+180)%360+360)%360;
  const saturation=delta/(1-Math.abs(2*lightness-1));
  return hslToHex(hue,saturation*100,lightness*100);
}
function atomDisplaySize(atom){
  const key=atomSiteKey(atom);
  return key&&atomSiteSizes.has(key) ? atomSiteSizes.get(key) : elementRadius(atom.element);
}
function atomIsVisible(atom){
  const key=atomSiteKey(atom);
  return structureAtomVisibility.get(String(atom.element))!==false && !(key&&atomSiteVisibility.get(key)===false);
}
function defaultElementRadius(_element){
  return 10;
}
function elementRadius(element){
  const override=Number(structureAtomSizeOverrides.get(String(element||"")));
  return Number.isFinite(override) ? Math.max(2,Math.min(30,override)) : defaultElementRadius(element);
}
function withEditedMagneticCell(source){
  if(!source?.structure?.magnetic || $("cifMagneticCellBox")?.hidden)return source;
  const lattice={};
  for(const [key,id] of Object.entries(CIF_MAG_LATTICE_FIELDS)){
    const raw=$(id)?.value;
    const value=Number(raw);
    if(raw==='' || !Number.isFinite(value) || value<=0)return source;
    if(['alpha','beta','gamma'].includes(key) && value>=180)return source;
    lattice[key]=value;
  }
  return {...source,structure:{...source.structure,lattice}};
}
function currentStructureForViewer(){
  // Symmetry/Manual only changes the Atomic Positions editor representation.
  // Preview sources and crystallographic-cell framing must not change on a
  // Mode toggle. An explicitly generated/Set CIF can still become the source.
  if(cifStructureSourcePreference==="loaded" && loadedGeneratorCifStructure)
    return withEditedMagneticCell({structure:loadedGeneratorCifStructure,label:loadedGeneratorCifName||"loaded mCIF",kind:"loaded"});
  const preferSelected=cifStructureSourcePreference==="selected";
  if(preferSelected && getSelectedCifStructure())
    return withEditedMagneticCell({structure:getSelectedCifStructure(), label:getSelectedCifFileName()||"selected CIF", kind:"selected"});
  try{
    const generated=buildGeneratedCif();
    return {structure:generated.parsed, label:generated.filename, kind:"draft"};
  }catch(_err){ /* fall back below */ }
  if(lastGeneratedCifParsed) return {structure:lastGeneratedCifParsed, label:lastGeneratedCifName, kind:"generated"};
  if(getSelectedCifStructure())
    return withEditedMagneticCell({structure:getSelectedCifStructure(), label:getSelectedCifFileName()||"selected CIF", kind:"selected"});
  return null;
}
function isStructurePanelVisible(){
  const panel=$("structurePanel");
  return !!panel && !panel.classList.contains("hidden");
}
function renderCifStructureIfVisible(){
  // Keep the shared Structure editor up to date regardless of which output
  // preview is selected. Updating Atoms/Spins/Bonds must not depend on Plotly
  // or on the visibility of the 3D Structure tab.
  const source=currentStructureForViewer();
  if(source?.structure?.magnetic && !importedMagneticEditMode &&
     !structureModifyLocked && importedMagneticQSignature && propagationSignature()!==importedMagneticQSignature){
    activateImportedMagneticEditing();
  }
  syncImportedMomentStructureType();
  if(source?.structure) syncStructureControlRows(source.structure);
  syncSpinModifyLock();
  rememberModifiedMagneticDraft();
  if(isStructurePanelVisible() && $("mcifStructurePane") && !$("mcifStructurePane").classList.contains("hidden")) renderCifStructureView();
}
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
  const viewVec=vecNormalize(basis?.[viewMode] || basis?.cstar || [0,0,1]);
  const eye=vecScale(viewVec,distance);
  // Fix the camera roll by choosing a crystallographic direction that should
  // lie horizontally on screen.  This is especially important for oblique
  // lattices: a global Cartesian up vector is not a reliable view reference.
  const horizontalAxis={a:"b",b:"a",c:"a",astar:"b",bstar:"a",cstar:"a"}[viewMode] || "a";
  // For b / b*, keep the positive c direction at the top of the view.
  const horizontalSign=(viewMode==="b" || viewMode==="bstar")?-1:1;
  const candidates=[basis?.[horizontalAxis],basis?.a,basis?.b,basis?.c,basis?.astar,basis?.bstar,basis?.cstar].filter(Boolean);
  let right=null;
  for(const candidate of candidates){
    const projected=vecSub(candidate,vecScale(viewVec,vecDot(candidate,viewVec)));
    if(vecNorm(projected)>1e-8){ right=vecScale(vecNormalize(projected),horizontalSign); break; }
  }
  if(!right){
    const fallback=Math.abs(viewVec[2])<0.9?[0,0,1]:[0,1,0];
    right=vecNormalize(vecCross(fallback,viewVec));
  }
  // Camera forward points from eye towards the origin.  up = right × forward.
  const up=vecNormalize(vecCross(right,vecScale(viewVec,-1)));
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
  const base=copyStructureCamera(structureCameraState) || currentStructureCamera() || {eye:{x:1.55,y:1.55,z:1.25},up:{x:0,y:0,z:1},center:{x:0,y:0,z:0}};
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
  return copyStructureCamera(camera) || structureCameraState || {eye:{x:1.55,y:1.55,z:1.25},up:{x:0,y:0,z:1},center:{x:0,y:0,z:0}};
}
function projectStructureDirection(v,camera){
  const c=structureCameraForTriad(camera);
  const eye=[c.eye.x,c.eye.y,c.eye.z];
  const forward=vecNormalize(vecScale(eye,-1));
  let up=vecNormalize([c.up.x,c.up.y,c.up.z]);
  let right=vecNormalize(vecCross(forward,up));
  if(vecNorm(right)<1e-9) right=[1,0,0];
  up=vecNormalize(vecCross(right,forward));
  const u=vecNormalize(v);
  return {x:vecDot(u,right),y:vecDot(u,up),depth:vecDot(u,forward)};
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
  const c=structureCameraForTriad(camera || structureCameraState || currentStructureCamera());
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
  if(structureCameraWatchFrame) cancelAnimationFrame(structureCameraWatchFrame);
  structureCameraWatchFrame=0;
  structureCameraWatchSignature="";
}
function startStructureCameraWatch(){
  stopStructureCameraWatch();
  const tick=()=>{
    if(!isStructurePanelVisible()){ structureCameraWatchFrame=0; return; }
    if(structureProgrammaticCameraUpdate){ structureCameraWatchFrame=requestAnimationFrame(tick); return; }
    const camera=currentStructureCamera();
    const sig=structureCameraSignature(camera);
    if(camera && sig && sig!==structureCameraWatchSignature){
      structureCameraWatchSignature=sig;
      structureCameraState=copyStructureCamera(camera);
      const latest=directLatticeBasis(currentStructureForViewer()?.structure?.lattice);
      if(latest) updateStructureOrientationTriads(latest,structureCameraState);
    }
    structureCameraWatchFrame=requestAnimationFrame(tick);
  };
  structureCameraWatchFrame=requestAnimationFrame(tick);
}
function buildOneCellEdgeTrace(basis,range){
  const x=[],y=[],z=[];
  const append=(p,q)=>{ x.push(p[0],q[0],null); y.push(p[1],q[1],null); z.push(p[2],q[2],null); };
  const ix=Math.floor((range.x.min+range.x.max)*0.5);
  const iy=Math.floor((range.y.min+range.y.max)*0.5);
  const iz=Math.floor((range.z.min+range.z.max)*0.5);
  const p=(fx,fy,fz)=>fractionalToCartesian(basis,[fx,fy,fz]);
  const p000=p(ix,iy,iz), p100=p(ix+1,iy,iz), p010=p(ix,iy+1,iz), p001=p(ix,iy,iz+1);
  const p110=p(ix+1,iy+1,iz), p101=p(ix+1,iy,iz+1), p011=p(ix,iy+1,iz+1), p111=p(ix+1,iy+1,iz+1);
  for(const [a,b] of [[p000,p100],[p000,p010],[p000,p001],[p100,p110],[p100,p101],[p010,p110],[p010,p011],[p001,p101],[p001,p011],[p110,p111],[p101,p111],[p011,p111]]) append(a,b);
  return {type:"scatter3d",mode:"lines",x,y,z,name:"Unit cell",hoverinfo:"skip",showlegend:false,line:{color:"#000",width:3}};
}
function buildAllCellEdgeTrace(basis,range){
  const x=[],y=[],z=[];
  const append=(p,q)=>{ x.push(p[0],q[0],null); y.push(p[1],q[1],null); z.push(p[2],q[2],null); };
  const xb=rangeCellBounds(range.x), yb=rangeCellBounds(range.y), zb=rangeCellBounds(range.z);
  const p=(fx,fy,fz)=>fractionalToCartesian(basis,[fx,fy,fz]);
  for(let ix=xb.from;ix<=xb.to;ix++) for(let iy=yb.from;iy<=yb.to;iy++) for(let iz=zb.from;iz<=zb.to;iz++){
    const p000=p(ix,iy,iz), p100=p(ix+1,iy,iz), p010=p(ix,iy+1,iz), p001=p(ix,iy,iz+1);
    const p110=p(ix+1,iy+1,iz), p101=p(ix+1,iy,iz+1), p011=p(ix,iy+1,iz+1), p111=p(ix+1,iy+1,iz+1);
    for(const [a,b] of [[p000,p100],[p000,p010],[p000,p001],[p100,p110],[p100,p101],[p010,p110],[p010,p011],[p001,p101],[p001,p011],[p110,p111],[p101,p111],[p011,p111]]) append(a,b);
  }
  return {type:"scatter3d",mode:"lines",x,y,z,name:"Unit cells",hoverinfo:"skip",showlegend:false,line:{color:"#000",width:3}};
}
function unitCellTraces(basis,range){
  if(structureUnitCellMode==="none") return [];
  if(structureUnitCellMode==="all"){
    // Parent supercells can contain hundreds of thousands of nuclear cells.
    // Do not create unbounded Plotly line arrays for All cells.
    const count=['x','y','z'].reduce((product,axis)=>{
      const bounds=rangeCellBounds(range[axis]);
      return product*Math.max(0,bounds.to-bounds.from+1);
    },1);
    if(!Number.isFinite(count)||count>1200){
      const traces=[];
      traces.warning=' Unit-cell frames hidden: more than 1200 outlines. Reduce the X/Y/Z view range or select One cell.';
      return traces;
    }
  }
  return [structureUnitCellMode==="all" ? buildAllCellEdgeTrace(basis,range) : buildOneCellEdgeTrace(basis,range)];
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
  const q=propagationVectorsFromMcif(text,selected);
  if(q.length!==1)return null;
  const parent=parentIndexingFromMcif(text,selected.lattice,[q[0].h,q[0].k,q[0].l]);
  if(!parent || !Array.isArray(parent.replication) || parent.replication.length!==3 ||
     !parent.replication.every(n=>Number.isInteger(n)&&n>=1))return null;
  const parentStructure=parentNuclearStructureFromMcif(selected,text);
  if(!parentStructure)return null;
  // The viewer may use edited magnetic-lattice lengths. Derive the *display*
  // frame from that same actual basis so its edges stay registered with atoms.
  const rep=parent.replication;
  const magLattice=source.structure.lattice;
  const lattice={...magLattice,a:Number(magLattice.a)/rep[0],
    b:Number(magLattice.b)/rep[1],c:Number(magLattice.c)/rep[2]};
  if(!directLatticeBasis(lattice))return null;
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
  if(magnetic&&!parent && structureUnitCellReference==='crystallographic')
    structureUnitCellReference='magnetic';
  else if(!magnetic) structureUnitCellReference='crystallographic';
  select.value=structureUnitCellReference;
  select.title=magnetic&&!parent?'Crystallographic cell unavailable: explicit parent mapping required.':'';
  return parent;
}
function structureUnitCellFrame(source,basis,range,parent){
  const fallback={basis,range,parent:false};
  if(structureUnitCellReference!=='crystallographic'||!parent)return fallback;
  const parentBasis=directLatticeBasis(parent.lattice),rep=parent.rep;
  if(!parentBasis)return fallback;
  const parentRange=Object.fromEntries(['x','y','z'].map((axis,i)=>[
    axis,{min:range[axis].min*rep[i],max:range[axis].max*rep[i]}
  ]));
  if(structureUnitCellMode==='one'){
    for(const axis of ['x','y','z']){
      const bounds=parentRange[axis];
      const first=bounds.min<=0 && bounds.max>=1 ? 0 : Math.floor(bounds.min);
      parentRange[axis]={min:first,max:first+1};
    }
  }
  return {basis:parentBasis,range:parentRange,parent:true};
}
function updateStructureAtomLegend(elements){
  const host=$("cifAtomLegend");
  if(!host) return;
  host.replaceChildren();
  for(const element of elements){
    if(structureAtomVisibility.get(String(element))===false) continue;
    const item=document.createElement("span"); item.className="structure-atom-legend-item";
    const dot=document.createElement("i"); dot.className="structure-atom-legend-dot"; dot.style.background=elementColor(element);
    const text=document.createElement("span"); text.textContent=element;
    item.append(dot,text); host.appendChild(item);
  }
  host.classList.toggle("hidden",!host.children.length);
}
function structureElements(structure){
  // One shared ordering rule for Atoms, Spins, Bonds and the in-plot legend:
  // preserve the order in which each element first appears in the CIF.
  const atoms=(Array.isArray(structure?.asymmetricSites) && structure.asymmetricSites.length ? structure.asymmetricSites : (structure?.atoms || []));
  const seen=new Set(), out=[];
  for(const atom of atoms){
    const element=String(atom?.element||"").trim();
    if(!element || seen.has(element)) continue;
    seen.add(element); out.push(element);
  }
  return out;
}
function naturalStructureLabelCompare(a,b){
  return String(a||"").localeCompare(String(b||""),undefined,{numeric:true,sensitivity:"base"});
}
function makePaletteButtons(current,onPick){
  const host=document.createElement("div");
  host.className="structure-color-palette";
  for(const color of STRUCTURE_PALETTE){
    const button=document.createElement("button");
    button.type="button";
    button.className="structure-color-chip";
    button.style.background=color;
    button.title=color;
    button.setAttribute("aria-label",`Set color ${color}`);
    if(color.toLowerCase()===String(current||"").toLowerCase()) button.classList.add("selected");
    button.addEventListener("click",()=>{
      host.querySelectorAll(".structure-color-chip").forEach(b=>b.classList.toggle("selected",b===button));
      onPick(color);
    });
    host.appendChild(button);
  }
  return host;
}
function makeMomentColorPicker(current,onPick){
  const custom=document.createElement("input");
  custom.type="color";
  custom.className="structure-moment-color-swatch";
  custom.value=current;
  custom.dataset.momentField="color";
  custom.title="Arrow color";
  custom.addEventListener("input",()=>onPick(custom.value));
  return custom;
}
function syncDefaultMomentColorsForElement(element,color){
  for(const row of document.querySelectorAll("#cifMagMomentRows .structure-moment-row")){
    if(row.dataset.momentElement!==String(element)) continue;
    if(row.dataset.momentColorCustom==="1") continue;
    const key=row.dataset.momentKey;
    const cur=currentMomentSettings().get(key);
    if(cur){ cur.color=color; cur.colorCustomized=false; structureMomentSettings.set(key,cur); }
    row.dataset.momentColor=color;
    const input=row.querySelector('[data-moment-field="color"]');
    if(input) input.value=color;
  }
}
function compressStructureSiteLabels(labels,element=""){
  const cleaned=[...new Set((labels||[]).map(x=>String(x||"").trim()).filter(Boolean))];
  if(cleaned.length<=1) return cleaned.join("");
  const parsed=cleaned.map(label=>{
    const m=label.match(/^(.*?)(\d+)$/);
    return m ? {label,prefix:m[1],n:Number(m[2])} : null;
  });
  if(parsed.every(Boolean)){
    const prefix=parsed[0].prefix;
    const nums=parsed.map(x=>x.n).sort((a,b)=>a-b);
    const samePrefix=parsed.every(x=>x.prefix===prefix);
    const consecutive=nums.every((n,i)=>i===0 || n===nums[i-1]+1);
    if(samePrefix && consecutive && nums.length>2) return `${prefix}${nums[0]}–${nums[nums.length-1]}`;
  }
  if(cleaned.length>5){
    const first=cleaned[0], last=cleaned[cleaned.length-1];
    return `${first}…${last}`;
  }
  return cleaned.join(", ");
}

// The table header is the single bulk Use control. Its scope follows Display:
// an element filters and edits ALL of that element's sites, not only mounted rows.
function syncSpinTableBulkCheckbox(structure,candidates=null){
  const checkbox=$("cifSpinBulkCheckbox");
  const label=$("cifSpinBulkElement");
  if(!checkbox || !label) return;
  const selected=structureSpinTableElement;
  label.textContent=selected==="*" ? "All" : selected;
  checkbox.title=selected==="*" ? "Enable/disable every magnetic site" : `Enable/disable all ${selected} magnetic sites`;
  checkbox.setAttribute("aria-label",checkbox.title);
  let all=candidates;
  if(!all){
    try{ all=spinEditingIsIndividual(structure)?individualSpinCandidates(structure):magneticCandidateSites(structure); }
    catch(_e){all=[];}
  }
  const visible=spinTableFilteredSites(all);
  const live=currentMomentSettings();
  const values=visible.map(site=>{
    const key=site.individualKey||momentKey(site);
    const setting=live.get(key)||structureMomentSettings.get(key)||
      (site.individualKey?initialIndividualSpin(site,structure):defaultMomentSetting(site,structure));
    return !!setting.enabled;
  });
  checkbox.disabled=!values.length;
  checkbox.checked=values.length>0 && values.every(Boolean);
  checkbox.indeterminate=values.some(Boolean) && !checkbox.checked;
}
function setSpinEnabledForDisplayed(enabled){
  const structure=currentStructureForViewer()?.structure;
  if(!structure)return;
  activateImportedMagneticEditing();
  const live=currentMomentSettings();
  for(const [key,value] of live) structureMomentSettings.set(key,value);
  const candidates=spinEditingIsIndividual(structure)?individualSpinCandidates(structure):magneticCandidateSites(structure);
  for(const site of spinTableFilteredSites(candidates)){
    const key=site.individualKey||momentKey(site);
    const initial=site.individualKey?initialIndividualSpin(site,structure):defaultMomentSetting(site,structure);
    structureMomentSettings.set(key,{...initial,...(structureMomentSettings.get(key)||{}),enabled:!!enabled});
  }
  // updateMagneticMomentRows() snapshots current DOM rows first. Reflect the
  // bulk edit in those rows so it cannot be overwritten by stale checkboxes.
  for(const row of document.querySelectorAll("#cifMagMomentRows .structure-moment-row")){
    const checkbox=row.querySelector('[data-moment-field="enabled"]');
    if(checkbox) checkbox.checked=!!enabled;
  }
  updateMagneticMomentRows(structure);
  saveStructureViewerState();
  renderCifStructureIfVisible();
}
// Backward-compatible *display-only* labels for mCIF files emitted by older
// versions (A1, A2, ...).  Never rewrite the parsed source labels: magnetic
// moment references, state keys and re-export must remain tied to the file.
function structureSiteDisplayLabels(structure){
  const sites=structure?.asymmetricSites||[];
  const generated=String(structure?.name||'').toLowerCase()==='generated_magnetic_structure';
  if(!generated || !structure?.magnetic || !sites.length ||
     !sites.every((s,i)=>/^A\d+$/i.test(String(s.label||'')))) return null;
  const counts=new Map(),labels=new Map();
  for(const site of sites){
    const element=String(site.element||'X');
    const number=(counts.get(element)||0)+1;
    counts.set(element,number);
    labels.set(String(site.label),`${element}${number}`);
  }
  return labels;
}
const selectedAppearanceRowKeys=new Set();
function clearAppearanceRowSelection(){
  if(!selectedAppearanceRowKeys.size)return;
  selectedAppearanceRowKeys.clear();
  document.querySelectorAll('#cifAtomColorRows .atoms-table-row').forEach(row=>row.classList.remove('atoms-row-selected'));
  renderCifStructureIfVisible();
}
function selectedAppearanceContainsAtom(atom){
  return selectedAppearanceRowKeys.has(`element:${atom.element}`) ||
    (atomSiteKey(atom)!==null && selectedAppearanceRowKeys.has(atomSiteKey(atom)));
}
function selectAppearanceRow(key,row,event={}){
  if(event.shiftKey || event.ctrlKey || event.metaKey){
    if(selectedAppearanceRowKeys.has(key))selectedAppearanceRowKeys.delete(key);
    else selectedAppearanceRowKeys.add(key);
  }else{
    const selected=selectedAppearanceRowKeys.has(key);
    selectedAppearanceRowKeys.clear();if(!selected)selectedAppearanceRowKeys.add(key);
  }
  document.querySelectorAll('#cifAtomColorRows .atoms-table-row').forEach(item=>
    item.classList.toggle('atoms-row-selected',selectedAppearanceRowKeys.has(item.dataset.selectionKey)));
  renderCifStructureIfVisible();
}
function updateStructureAtomColorRows(elements,structure=null){
  const host=$("cifAtomColorRows");
  if(!host) return;
  host.replaceChildren();
  const orbits=parentAppearanceOrbits(structure);
  const manual=structurePositionEditingMode==='individual';
  const explicitManualSites=!orbits && manual && Array.isArray(structure?.atoms)
    ? structure.atoms.map((atom,index)=>({...atom,manualIndex:index})) : null;
  const sites=manual?(orbits?.manualSites||explicitManualSites||structure?.asymmetricSites||[]):
    (orbits?.sites||structure?.asymmetricSites||[]);
  const displayLabels=orbits?null:structureSiteDisplayLabels(structure);
  const header=document.createElement("div");
  header.className="atoms-table-head";
  for(const text of ["Element / Site","Visible","Color","Size"]){const cell=document.createElement("span");cell.textContent=text;header.appendChild(cell);}
  host.appendChild(header);
  if(!elements.length){const empty=document.createElement("div");empty.className="structure-rows-empty";empty.textContent="No atoms available.";host.appendChild(empty);return;}
  function makeRow(label,key,element,isSite){
    const row=document.createElement("div");row.className="atoms-table-row"+(isSite?" atoms-site-row":" atoms-element-row");
    const name=document.createElement(isSite?"span":"button");name.className="atoms-row-name";
    if(!isSite){name.type="button";name.setAttribute("aria-expanded",String(expandedAtomElements.has(element)));}
    name.textContent=(isSite?"↳ ":expandedAtomElements.has(element)?"▾ ":"▸ ")+label;
    const visible=document.createElement("input");visible.type="checkbox";visible.className="atoms-visible";
    visible.checked=isSite?atomSiteVisibility.get(key)!==false:structureAtomVisibility.get(element)!==false;
    visible.title=`Show ${label}`;
    const color=document.createElement("input");color.type="color";color.className="atoms-color";
    color.value=(isSite?atomSiteColors.get(key):null)||elementColor(element);
    color.title=`${label} color`;
    const size=document.createElement("input");size.type="number";size.className="atoms-size";size.min="2";size.max="30";size.step="1";
    size.value=String((isSite?atomSiteSizes.get(key):null)??elementRadius(element));
    size.title=`${label} display size`;
    const commit=()=>{saveStructureViewerState();renderCifStructureIfVisible();};
    color.addEventListener("input",()=>{
      if(isSite) atomSiteColors.set(key,color.value);
      else {
        structureAtomColorOverrides.set(element,color.value);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) atomSiteColors.delete(`site:${index}`);
        syncDefaultMomentColorsForElement(element,color.value);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-color')).filter(Boolean)) child.value=color.value;
      }
      commit();
    });
    size.addEventListener("input",()=>{
      if(size.value===""||!Number.isFinite(Number(size.value)))return;
      const v=Math.max(2,Math.min(30,Number(size.value)));
      if(isSite)atomSiteSizes.set(key,v);
      else {
        structureAtomSizeOverrides.set(element,v); structureAtomSizeCleared.delete(element);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) atomSiteSizes.delete(`site:${index}`);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-size')).filter(Boolean))child.value=String(v);
      }
      commit();
    });
    visible.addEventListener("change",()=>{
      if(isSite)atomSiteVisibility.set(key,visible.checked);
      else {
        structureAtomVisibility.set(element,visible.checked);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) atomSiteVisibility.delete(`site:${index}`);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-visible')).filter(Boolean))child.checked=visible.checked;
      }
      commit();
    });
    // Twelve directly accessible presets (6 by 2) plus a native RGB picker, per row.
    // All changes use the existing input handler (persistence, site overrides,
    // element-wide propagation, spin default colors, 3D display).
    const colorCell=document.createElement("div");
    colorCell.className="atoms-color-cell";
    const presetColors=STRUCTURE_PALETTE.slice(0,12);
    const presetGrid=document.createElement("div");
    presetGrid.className="atoms-preset-grid";
    const presetButtons=presetColors.map(hex=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="atoms-preset-color";
      button.style.backgroundColor=hex;
      button.title=`Set ${label} color to ${hex}`;
      button.setAttribute("aria-label",`Set ${label} color to ${hex}`);
      button.dataset.color=hex;
      button.addEventListener("click",()=>{
        color.value=hex;
        color.dispatchEvent(new Event("input",{bubbles:true}));
      });
      presetGrid.appendChild(button);
      return button;
    });
    const syncPresetSelection=()=>{
      for(const button of presetButtons){
        const selected=button.dataset.color===color.value.toLowerCase();
        button.classList.toggle("selected",selected);
        button.setAttribute("aria-pressed",String(selected));
      }
    };
    colorCell.appendChild(presetGrid);
    color.addEventListener("input",syncPresetSelection);
    color.classList.add("atoms-rgb-picker");
    color.title=`${label}: custom RGB color`;
    color.setAttribute("aria-label",`${label}: custom RGB color`);
    colorCell.appendChild(color);
    syncPresetSelection();
    if(!isSite)name.addEventListener("click",()=>{
      if(expandedAtomElements.has(element))expandedAtomElements.delete(element);else expandedAtomElements.add(element);
      updateStructureAtomColorRows(elements,structure);
    });
    row.dataset.element=element;
    const selectionKey=isSite?key:`element:${element}`;
    row.dataset.selectionKey=selectionKey;
    row.classList.toggle('atoms-row-selected',selectedAppearanceRowKeys.has(selectionKey));
    row.addEventListener('click',event=>{
      if(event.target.closest('input,.atoms-color-cell,.atoms-size'))return;
      selectAppearanceRow(selectionKey,row,event);
    });
    row.append(name,visible,colorCell,size);
    return row;
  }
  for(const element of elements){
    const itemSites=sites.map((site,index)=>({...site,index})).filter(site=>String(site.element)===element);
    host.appendChild(makeRow(`${element} (${itemSites.length})`,null,element,false));
    if(expandedAtomElements.has(element)) for(const site of itemSites){
      const key=manual?`manual-site:${site.index}`:`site:${site.index}`;
      const label=manual ? `${element}${itemSites.findIndex(item=>item.index===site.index)+1}`:
        String(displayLabels?.get(String(site.label))||site.label||`${element}${site.index+1}`);
      host.appendChild(makeRow(label,key,element,true));
    }
  }
}

function magneticCandidateSites(structure){
  const sites=Array.isArray(structure?.asymmetricSites) ? structure.asymmetricSites : [];
  const elementOrder=new Map(structureElements(structure).map((element,index)=>[String(element),index]));
  return sites.map((site,index)=>({...site,siteIndex:index})).sort((a,b)=>{
    const ea=elementOrder.get(String(a.element)) ?? Number.MAX_SAFE_INTEGER;
    const eb=elementOrder.get(String(b.element)) ?? Number.MAX_SAFE_INTEGER;
    if(ea!==eb) return ea-eb;
    const byLabel=naturalStructureLabelCompare(a.label||a.element,b.label||b.element);
    return byLabel || a.siteIndex-b.siteIndex;
  });
}
function momentKey(site){ return `${site.siteIndex}:${site.label||site.element}`; }
// The key uses the expanded atom index, not a crystallographic label: a CIF may
// have multiple symmetry-equivalent positions with the same source label.
const individualSpinKey=(ix,iy,iz,atomIndex)=>`individual:${ix},${iy},${iz}:${atomIndex}`;
function individualSpinDimensions(){
  const q=effectivePropagationVectorForStructure();
  return [q.h,q.k,q.l].map(v=>rationalApprox(v).d);
}
function individualSpinCandidates(structure){
  if(!Array.isArray(structure?.atoms)) return [];
  const N=individualSpinDimensions();
  if(N.reduce((a,b)=>a*b,1)*structure.atoms.length>1200)
    throw new Error('Individual spin editor limit: 1200 atoms. Reduce k denominators or use linked sites.');
  const out=[];
  const labelCounts=new Map();
  for(let ix=0;ix<N[0];ix++)for(let iy=0;iy<N[1];iy++)for(let iz=0;iz<N[2];iz++)
    structure.atoms.forEach((atom,atomIndex)=>{
      const key=individualSpinKey(ix,iy,iz,atomIndex);
      const parent=structure.asymmetricSites?.[atom.sourceSiteIndex]||atom;
      const pos=[atom.x+ix,atom.y+iy,atom.z+iz];
      const label=String(atom.sourceLabel||atom.element);
      const count=(labelCounts.get(label)||0)+1;
      labelCounts.set(label,count);
      out.push({...atom,siteIndex:atom.sourceSiteIndex,
        label:`${label} #${count}`,
        x:pos[0],y:pos[1],z:pos[2],individualKey:key,
        parentSite:parent,individualIndex:atomIndex,individualCell:[ix,iy,iz]});
    });
  return out;
}
function spinEditingIsIndividual(structure){return structureSpinEditingMode==='individual' && !!structure && (!structure.magnetic || importedMagneticEditMode);}
function initialIndividualSpin(site,structure){
  const base=site.parentSite||site;
  const key=momentKey({...base,siteIndex:site.siteIndex});
  const parent={...defaultMomentSetting(base,structure),...(structureMomentSettings.get(key)||{})};
  if(!parent.enabled)return parent;
  const q=effectivePropagationVectorForStructure();
  const approx=[q.h,q.k,q.l].map(v=>rationalApprox(v));
  const vec=[parent.mx,parent.my,parent.mz];
  const phase=2*PI*[site.x,site.y,site.z].reduce((sum,v,i)=>sum+v*approx[i].n/approx[i].d,0);
  let result=vec;
  if(structureMomentStructureType==='helical'){
    const b=directLatticeBasis(structure.lattice);
    result=rotateVectorAroundAxis(vec,structureMomentRotationAxisVector(b),(structureMomentChirality==='CW'?1:-1)*phase);
  }else if(structureMomentStructureType==='sinusoidal') result=vecScale(vec,Math.cos(phase));
  else if(Math.cos(phase)<0)result=vecScale(vec,-1);
  return {...parent,mx:result[0],my:result[1],mz:result[2]};
}

function individualSettingForAtom(atom,structure,settings){
  const N=individualSpinDimensions();
  const cell=atom.cell||[0,0,0];
  const component=(v,i)=>((Math.round(v)%N[i])+N[i])%N[i];
  const key=individualSpinKey(...cell.map(component),atom.expandedAtomIndex);
  const stored=settings.get(key)||structureMomentSettings.get(key);
  if(stored)return stored;
  const base=structure.atoms?.[atom.expandedAtomIndex];
  if(!base)return null;
  const parent=structure.asymmetricSites?.[base.sourceSiteIndex]||base;
  return initialIndividualSpin({...base,x:atom.phaseX,y:atom.phaseY,z:atom.phaseZ,
    siteIndex:base.sourceSiteIndex,parentSite:parent},structure);
}

// mCIF crystalaxis values are components along unit crystallographic
// directions, not fractional atomic coordinates. Never multiply moments
// by lattice lengths a, b, c (in Angstrom).
function mcifCrystalAxisToCartesian(basis,m){
  if(!basis || !Array.isArray(m)) return m?.slice()||[0,0,0];
  const ua=vecNormalize(basis.a),ub=vecNormalize(basis.b),uc=vecNormalize(basis.c);
  return vecAdd(vecAdd(vecScale(ua,m[0]),vecScale(ub,m[1])),vecScale(uc,m[2]));
}

function evaluateFourierCrystalMoment(model,phase){
  if(!model) return [0,0,0];
  const cosVec=Array.isArray(model.cos)?model.cos:[0,0,0];
  const sinVec=Array.isArray(model.sin)?model.sin:[0,0,0];
  const arg=2*PI*((Number(model.phaseSign)||1)*phase + (Number(model.phaseShift)||0));
  let out=[0,0,0].map((_,i)=>(Number(cosVec[i])||0)*Math.cos(arg) + (Number(sinVec[i])||0)*Math.sin(arg));
  if(Array.isArray(model.transformR)){
    const factor=Number.isFinite(Number(model.transformFactor)) ? Number(model.transformFactor) : 1;
    out=model.transformR.map(row=>factor*row.reduce((sum,x,j)=>sum+x*out[j],0));
  }
  return out;
}
function representativeCrystalMoment(site){
  const base=Array.isArray(site?.magneticMoment)?site.magneticMoment.slice():[0,0,0];
  if(site?.magneticFourier){
    const mod=evaluateFourierCrystalMoment({...site.magneticFourier,phaseSign:1,phaseShift:0},0);
    return base.map((v,i)=>v+(mod[i]||0));
  }
  return base;
}
function atomCrystalMoment(atom,frac){
  const base=Array.isArray(atom?.magneticMoment)?atom.magneticMoment.slice():[0,0,0];
  if(atom?.magneticFourier){
    const q=atom.magneticFourier.q||[0,0,0];
    const phase=(Number(q[0])||0)*(Number(frac[0])||0) + (Number(q[1])||0)*(Number(frac[1])||0) + (Number(q[2])||0)*(Number(frac[2])||0);
    const mod=evaluateFourierCrystalMoment(atom.magneticFourier,phase);
    return base.map((v,i)=>v+(mod[i]||0));
  }
  return base;
}
function defaultMomentSetting(site,structure=null){
  const element=String(site.element||"").toUpperCase();
  const hasMoment=Array.isArray(site.magneticMoment);
  const hasFourier=!!site?.magneticFourier;
  // Sunny uses the mCIF cell matrix to turn crystalaxis components into
  // Cartesian magnetic moments; do not show unconverted components as XYZ.
  const basis=directLatticeBasis(structure?.lattice);
  const representative=representativeCrystalMoment(site);
  const cart=(hasMoment||hasFourier)&&basis ? mcifCrystalAxisToCartesian(basis,representative) : null;
  const isMcif=structure?.magnetic===true;
  // All undefined moments begin at zero, independent of element or file type.
  // Preserve physical moments explicitly supplied by an mCIF. Editing the
  // Cartesian or Polar fields can create a nonzero moment later.
  return {enabled:isMcif && (hasMoment || hasFourier),
    mx:cart?.[0]??0,my:cart?.[1]??0,mz:cart?.[2]??0,
    size:1,width:10,headSize:0.51,color:elementColor(site.element),colorCustomized:false};
}
// Four significant digits are for display only; never round stored vectors.
function formatSpinValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return "0";
  if(Math.abs(n)<1e-12) return "0";
  return String(Number(n.toPrecision(4)));
}
function currentMomentSettings(){
  const rows=[...document.querySelectorAll("#cifMagMomentRows .structure-moment-row")];
  const out=new Map();
  for(const row of rows){
    const key=row.dataset.momentKey;
    if(!key) continue;
    const fallback=structureMomentSettings.get(key)||{};
    let mx=Number(fallback.mx)||0, my=Number(fallback.my)||0, mz=Number(fallback.mz);
    if(!Number.isFinite(mz)) mz=0;
    const readEditedNumber=(field)=>{
      const input=row.querySelector(`[data-moment-field="${field}"]`);
      if(!input) return null;
      const shown=String(input.value);
      const precise=Number(input.dataset.fullPrecision);
      return shown===input.dataset.displayValue && Number.isFinite(precise) ? precise : Number(shown);
    };
    const thetaInput=row.querySelector('[data-moment-field="theta"]');
    const phiInput=row.querySelector('[data-moment-field="phi"]');
    if(thetaInput || phiInput){
      const magnitudeInput=row.querySelector('[data-moment-field="moment"]');
      const untouched=[thetaInput,phiInput,magnitudeInput].every(input=>input && input.value===input.dataset.displayValue);
      if(!untouched){
        const theta=readEditedNumber("theta"), phi=readEditedNumber("phi"), magnitude=readEditedNumber("moment");
        if([theta,phi,magnitude].every(Number.isFinite) && magnitude>=0) [mx,my,mz]=vecScale(directionFromPolar(theta,phi),magnitude);
      }
    }else{
      for(const field of ["mx","my","mz"]){
        const value=readEditedNumber(field);
        if(Number.isFinite(value)) {if(field==="mx") mx=value; else if(field==="my") my=value; else mz=value;}
      }
    }
    out.set(key,{
      enabled:!!row.querySelector('[data-moment-field="enabled"]')?.checked,
      mx,my,mz,size:structureMomentGlobalLength,
      width:structureMomentGlobalWidth,headSize:structureMomentGlobalHeadSize,
      color:row.querySelector('[data-moment-field="color"]')?.value || row.dataset.momentColor || elementColor(row.dataset.momentElement),
      colorCustomized:row.dataset.momentColorCustom==="1"
    });
  }
  return out;
}
// Element selection only controls which rows are shown. Hidden rows retain their settings.
function refreshSpinTableToolbar(structure){
  const elements=structureElements(structure);
  const select=$("cifSpinTableElement");
  if(!elements.includes(structureSpinTableElement) && structureSpinTableElement!=="*")
    structureSpinTableElement="*";
  if(!select)return;
  select.replaceChildren();
  const add=(value,label)=>{
    const option=document.createElement("option");
    option.value=value;option.textContent=label;select.appendChild(option);
  };
  add("*","All elements");
  for(const element of elements)add(element,element);
  select.value=structureSpinTableElement;
}
function spinTableFilteredSites(sites){
  if(structureSpinTableElement==="*")return sites;
  return sites.filter(site=>String(site.element)===structureSpinTableElement);
}
function resolveIndividualSpin(site,structure,live){
  return live.get(site.individualKey)||structureMomentSettings.get(site.individualKey)||initialIndividualSpin(site,structure);
}
function updateMagneticMomentRows(structure){
  const host=$("cifMagMomentRows");
  if(!host) return;
  const live=currentMomentSettings();
  for(const [key,value] of live) structureMomentSettings.set(key,value);
  host.replaceChildren();
  visibleSpinSelectionSites.clear();
  const individual=spinEditingIsIndividual(structure);
  let allSites=[];
  try{allSites=individual?individualSpinCandidates(structure):magneticCandidateSites(structure);}
  catch(err){const notice=$("cifSpinIndividualInfo");if(notice){notice.hidden=false;notice.textContent=err.message;}syncSpinTableBulkCheckbox(structure,[]);return;}
  const notice=$("cifSpinIndividualInfo");
  if(notice){notice.hidden=true;notice.textContent="";}
  refreshSpinTableToolbar(structure);
  const polar=structureMomentDirectionMode==="polar";
  const headings=polar?["θ (°)","φ (°)","μ (μB)"]:["X (μB)","Y (μB)","Z (μB)"];
  for(const [i,name] of ["X","Y","Z"].entries()){
    const cell=$("cifSpinHeader"+name);
    if(cell) cell.textContent=headings[i];
  }
  const sites=spinTableFilteredSites(allSites);
  const displayedKeys=new Set(sites.map(site=>site.individualKey||momentKey(site)));
  for(const key of [...selectedSpinRowKeys]) if(!displayedKeys.has(key))selectedSpinRowKeys.delete(key);
  if(spinSelectionAnchorKey && !displayedKeys.has(spinSelectionAnchorKey))spinSelectionAnchorKey=null;
  const siteIndices=new Map(allSites.map((site,index)=>[site.individualKey||momentKey(site),index+1]));
  if(!sites.length){
    const div=document.createElement("div"); div.className="structure-spin-table-empty";
    div.textContent=allSites.length ? "No atoms match the selected element." : "No atomic sites were found.";
    host.appendChild(div);
    syncSpinTableBulkCheckbox(structure,allSites);
    return;
  }
  for(const site of sites){
    const key=site.individualKey||momentKey(site);
    visibleSpinSelectionSites.set(key,site);
    const saved=structureMomentSettings.get(key)||{};
    const setting={...(site.individualKey?initialIndividualSpin(site,structure):defaultMomentSetting(site,structure)),...saved};
    // mCIF XYZ values are physical Cartesian moments, not fractional positions.
    if(!setting.colorCustomized && !saved.colorCustomized) setting.color=elementColor(site.element);
    const row=document.createElement("div");
    row.className="structure-moment-row";
    row.setAttribute("role","row");
    row.dataset.momentKey=key;
    row.setAttribute("aria-selected",String(selectedSpinRowKeys.has(key)));
    row.classList.toggle("spin-row-selected",selectedSpinRowKeys.has(key));
    row.addEventListener("click",event=>selectSpinMomentRow(key,event));
    row.dataset.momentElement=String(site.element||"");
    row.dataset.momentColorCustom=setting.colorCustomized?"1":"0";
    row.dataset.momentColor=setting.color;
    const makeCell=(kind,child)=>{
      const cell=document.createElement("div");
      cell.className=`structure-spin-cell structure-spin-${kind}`;
      cell.setAttribute("role","cell");
      if(child!==undefined){
        if(typeof child==="string") cell.textContent=child;
        else cell.appendChild(child);
      }
      return cell;
    };
    const indexCell=makeCell("index",String(siteIndices.get(key)||""));
    const enabled=document.createElement("input");
    enabled.type="checkbox";
    enabled.checked=!!setting.enabled;
    enabled.dataset.momentField="enabled";
    enabled.title=`Enable spin for ${site.label||site.element}`;
    enabled.setAttribute("aria-label",enabled.title);
    const useCell=makeCell("use",enabled);
    const siteLabel=document.createElement("span");
    siteLabel.className="structure-moment-site";
    siteLabel.textContent=structureSiteDisplayLabels(structure)?.get(String(site.label))||site.label||site.element;
    siteLabel.title=`${site.element} @ (${Number(site.x).toFixed(5)}, ${Number(site.y).toFixed(5)}, ${Number(site.z).toFixed(5)})`;
    const atomCell=makeCell("atom",siteLabel);
    const momentInputs=[];
    const fieldCells=[];
    if(polar){
      const angles=directionToPolar([setting.mx,setting.my,setting.mz]);
      for(const [field,title,value] of [["theta","Polar angle from +z (degrees)",angles.theta],["phi","Azimuth from +x toward +y (degrees)",angles.phi],["moment","Physical magnetic moment magnitude (μB)",vecNorm([setting.mx,setting.my,setting.mz])]]){
        const input=document.createElement("input");
        input.type="number"; input.step="0.01"; if(field==="moment") input.min="0";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;input.title=title;input.setAttribute("aria-label",`${site.label||site.element}: ${title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }else{
      for(const [field,value] of [["mx",setting.mx],["my",setting.my],["mz",setting.mz]]){
        const input=document.createElement("input");
        input.type="number";input.step="0.01";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;
        input.title=`Cartesian magnetic moment component ${field.slice(1)} (μB)`;
        input.setAttribute("aria-label",`${site.label||site.element}: ${input.title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }
    const picker=makeMomentColorPicker(setting.color,color=>{
      row.dataset.momentColorCustom="1";
      row.dataset.momentColor=color;
      const cur=currentMomentSettings().get(key)||setting;
      cur.color=color;cur.colorCustomized=true;
      structureMomentSettings.set(key,cur);
      saveStructureViewerState();renderCifStructureIfVisible();
    });
    picker.title=`Spin color palette for ${site.label||site.element}`;
    picker.setAttribute("aria-label",picker.title);
    const colorCell=makeCell("color",picker);
    const commit=()=>{
      activateImportedMagneticEditing();
      const cur=currentMomentSettings().get(key);
      if(cur) structureMomentSettings.set(key,cur);
      saveStructureViewerState();renderCifStructureIfVisible();
    };
    enabled.addEventListener("change",()=>{
      commit();syncSpinTableBulkCheckbox(structure,allSites);
    });
    for(const input of momentInputs){
      const autoEnable=()=>{
        if(!enabled.checked) enabled.checked=true;
        commit();syncSpinTableBulkCheckbox(structure,allSites);
      };
      input.addEventListener("input",autoEnable);
      input.addEventListener("change",autoEnable);
    }
    row.append(indexCell,useCell,atomCell,...fieldCells,colorCell);
    host.appendChild(row);
  }
  syncSpinTableBulkCheckbox(structure,allSites);
}
function parseBondRange(value,fallbackMin=0,fallbackMax=3){
  const parts=String(value??"").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  let min=Number.isFinite(parts[0])?parts[0]:fallbackMin;
  let max=Number.isFinite(parts[1])?parts[1]:fallbackMax;
  min=Math.max(0,min); max=Math.max(0,max);
  if(max<min) [min,max]=[max,min];
  return {min,max};
}
function readStructureBondRules(){
  const rows=[...document.querySelectorAll("#cifBondRows .structure-bond-row")];
  return rows.map(row=>{
    const legacy=row.querySelector('[data-bond-field="distanceRange"]');
    const legacyParsed=parseBondRange(legacy?.value,0,3);
    let min=Number(row.querySelector('[data-bond-field="minDistance"]')?.value);
    let max=Number(row.querySelector('[data-bond-field="maxDistance"]')?.value);
    if(!Number.isFinite(min)) min=legacyParsed.min;
    if(!Number.isFinite(max)) max=legacyParsed.max;
    min=Math.max(0,min); max=Math.max(0,max);
    if(max<min) [min,max]=[max,min];
    return {
      // Visibility is presentation only: keep disabled rules for editing, copy
      // and restoring the structure-specific Style state.
      enabled:row.querySelector('[data-bond-field="enabled"]')?.checked !== false,
      bonds:row.querySelector('[data-bond-field="bonds"]')?.checked !== false,
      polyhedral:row.querySelector('[data-bond-field="polyhedral"]')?.checked === true,
      a:String(row.querySelector('[data-bond-field="a"]')?.value || "").trim(),
      b:String(row.querySelector('[data-bond-field="b"]')?.value || "").trim(),
      minDistance:min,
      maxDistance:max,
      width:Math.max(1,Number(row.querySelector('[data-bond-field="width"]')?.value)||3),
      widthBlank:String(row.querySelector('[data-bond-field="width"]')?.value??"").trim()==="",
      color:row.querySelector('[data-bond-field="color"]')?.value || "#888888"
    };
  }).filter(rule=>rule.a && rule.b && Number.isFinite(rule.minDistance) && Number.isFinite(rule.maxDistance));
}
function populateBondSelect(select,elements,value){
  if(!select) return;
  const keep=value || select.value || elements[0] || "";
  select.replaceChildren();
  const values=[...elements];
  if(keep && !values.includes(keep)) values.push(keep);
  for(const element of values){ const opt=document.createElement("option"); opt.value=element; opt.textContent=element; select.appendChild(opt); }
  select.value=keep;
}
function defaultBondColor(a,b){
  const first=elementColor(a), second=elementColor(b);
  const rgb=color=>{ const hex=String(color||"").trim().replace(/^#/,""); return /^[0-9a-fA-F]{6}$/.test(hex)?[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)):null; };
  const x=rgb(first),y=rgb(second);
  if(!x||!y) return first||"#888888";
  // Keep same-element bonds identical to the atom color. For different
  // elements, use the RGB complement of the mean atom color.
  if(String(a)===String(b)) return first;
  return "#"+x.map((v,i)=>{
    const mixed=Math.round((v+y[i])/2);
    return (255-mixed).toString(16).padStart(2,"0");
  }).join("");
}
// Synchronize radio buttons after loading/restoring a structure. These modes
// control geometry only; the Style rules remain unchanged.
function syncStructureBondDisplayModeControls(){
  for(const input of document.querySelectorAll('input[name="cifStructureStyle"]')){
    input.checked=input.value===structureBondDisplayMode;
  }
}
// Style uses the same select/copy/add/remove/drag semantics as Positions.
let structureBondSelectionAnchor=null;
let structureBondRowSerial=0;
let structureBondDraggedRows=null;
const selectedStructureBondRows=()=>[...document.querySelectorAll('#cifBondRows .structure-bond-row.style-row-selected')];
// Style's All header follows the same checked / mixed / unchecked rules as
// Spins, without affecting the selected rows or deleting hidden rules.
function syncStructureBondBulkCheckbox(){
  const checkbox=$("cifStyleBulkCheckbox");
  if(!checkbox)return;
  const toggles=[...document.querySelectorAll('#cifBondRows [data-bond-field="enabled"]')];
  const enabled=toggles.filter(toggle=>toggle.checked).length;
  checkbox.disabled=toggles.length===0;
  checkbox.checked=toggles.length>0 && enabled===toggles.length;
  checkbox.indeterminate=enabled>0 && enabled<toggles.length;
}
function setAllStructureBondRulesVisible(visible){
  for(const toggle of document.querySelectorAll('#cifBondRows [data-bond-field="enabled"]')){
    toggle.checked=!!visible;
    toggle.closest('.structure-bond-row')?.classList.toggle('style-rule-hidden',!visible);
  }
  syncStructureBondBulkCheckbox();
  saveStructureViewerState();
  renderCifStructureIfVisible();
}

function refreshStructureBondSelection(){
  const hasSelection=selectedStructureBondRows().length>0;
  for(const id of ['cifCopyBondRule','cifRemoveBondRule']){
    const button=$(id);if(button)button.disabled=!hasSelection;
  }
}
function clearStructureBondSelection(){
  selectedStructureBondRows().forEach(row=>row.classList.remove('style-row-selected'));
  structureBondSelectionAnchor=null;
  refreshStructureBondSelection();
}
function selectStructureBondRow(row,event={}){
  const rows=[...document.querySelectorAll('#cifBondRows .structure-bond-row')];
  const idx=rows.indexOf(row);if(idx<0)return;
  const multi=!!(event.ctrlKey||event.metaKey);
  if(event.shiftKey){
    const from=rows.findIndex(r=>r.dataset.styleUid===structureBondSelectionAnchor);
    if(!multi)rows.forEach(r=>r.classList.remove('style-row-selected'));
    for(let i=Math.min(from<0?idx:from,idx);i<=Math.max(from<0?idx:from,idx);i++)rows[i].classList.add('style-row-selected');
  }else if(multi){
    row.classList.toggle('style-row-selected');
    structureBondSelectionAnchor=row.dataset.styleUid;
  }else{
    const wasSelected=row.classList.contains('style-row-selected');
    rows.forEach(r=>r.classList.remove('style-row-selected'));
    if(!wasSelected){row.classList.add('style-row-selected');structureBondSelectionAnchor=row.dataset.styleUid;}
    else structureBondSelectionAnchor=null;
  }
  refreshStructureBondSelection();
}
function refreshStructureBondIndices(){
  document.querySelectorAll('#cifBondRows .structure-bond-row').forEach((row,i)=>{
    const cell=row.querySelector('.structure-style-index');if(cell)cell.textContent=String(i+1);
  });
}
function clearStructureBondDropMarkers(){
  document.querySelectorAll('#cifBondRows .style-drop-before,.style-drop-after').forEach(row=>row.classList.remove('style-drop-before','style-drop-after'));
}
function finishStructureBondDrag(){
  clearStructureBondDropMarkers();
  document.querySelectorAll('#cifBondRows .style-row-dragging').forEach(row=>row.classList.remove('style-row-dragging'));
  structureBondDraggedRows=null;
}
function initializeStructureBondDrag(row){
  const index=row.querySelector('.structure-style-index');if(!index)return;
  index.draggable=true;index.title='Drag to reorder selected style rules';
  index.addEventListener('dragstart',ev=>{
    if(!row.classList.contains('style-row-selected'))selectStructureBondRow(row);
    structureBondDraggedRows=selectedStructureBondRows();
    if(!structureBondDraggedRows.length){ev.preventDefault();return;}
    structureBondDraggedRows.forEach(r=>r.classList.add('style-row-dragging'));
    ev.dataTransfer.effectAllowed='move';
    ev.dataTransfer.setData('text/plain',row.dataset.styleUid);
  });
  index.addEventListener('dragend',finishStructureBondDrag);
  for(const cell of row.querySelectorAll('.structure-style-cell')){
    cell.addEventListener('dragover',ev=>{
      if(!structureBondDraggedRows?.length)return;
      ev.preventDefault();ev.dataTransfer.dropEffect='move';
      clearStructureBondDropMarkers();
      if(structureBondDraggedRows.includes(row))return;
      const r=cell.getBoundingClientRect();
      row.classList.add(ev.clientY>=r.top+r.height/2?'style-drop-after':'style-drop-before');
    });
    cell.addEventListener('drop',ev=>{
      if(!structureBondDraggedRows?.length)return;
      ev.preventDefault();
      const host=$('cifBondRows');
      const original=[...host.querySelectorAll('.structure-bond-row')];
      const moving=new Set(structureBondDraggedRows);
      const remaining=original.filter(r=>!moving.has(r));
      const idx=remaining.indexOf(row);
      if(idx>=0){
        const bounds=cell.getBoundingClientRect();
        const after=ev.clientY>=bounds.top+bounds.height/2;
        const insertion=idx+(after?1:0);
        host.append(...remaining.slice(0,insertion),...structureBondDraggedRows,...remaining.slice(insertion));
        refreshStructureBondIndices();
        saveStructureViewerState();renderCifStructureIfVisible();
      }
      finishStructureBondDrag();
    });
  }
}
function createBondRuleRow(rule={},elements=[]){
  const row=document.createElement('div');row.className='structure-bond-row';
  row.setAttribute('role','row');row.dataset.styleUid=String(++structureBondRowSerial);
  const cell=(kind,contents)=>{
    const el=document.createElement('div');el.className=`structure-style-cell structure-style-${kind}`;
    el.setAttribute('role','cell');
    if(typeof contents==='string')el.textContent=contents;
    else if(contents)el.appendChild(contents);
    // Select from any cell without stealing focus from its editable content.
    el.addEventListener('click',ev=>selectStructureBondRow(row,ev));
    return el;
  };
  const a=document.createElement('select');a.dataset.bondField='a';a.title='First atom';
  const b=document.createElement('select');b.dataset.bondField='b';b.title='Second atom';
  populateBondSelect(a,elements,rule.a||elements[0]||'');
  populateBondSelect(b,elements,rule.b||elements[1]||elements[0]||'');
  const styleModeCheckbox=(key,checked,label)=>{
    const input=document.createElement('input');
    input.type='checkbox';input.dataset.bondField=key;
    input.checked=checked;input.title=label;
    input.setAttribute('aria-label',label);
    // Changing drawing mode is independent of row selection.
    input.addEventListener('click',event=>event.stopPropagation());
    input.addEventListener('change',()=>{
      saveStructureViewerState();
      renderCifStructureIfVisible();
    });
    return input;
  };
  const bondsToggle=styleModeCheckbox('bonds',rule.bonds!==false,'Draw bonds for this Style row');
  const polyhedralToggle=styleModeCheckbox('polyhedral',rule.polyhedral===true,'Draw coordination polyhedra for this Style row');
  const legacyMax=Number.isFinite(Number(rule.maxDistance))?Number(rule.maxDistance):Number(rule.distance);
  const minValue=Number.isFinite(Number(rule.minDistance))?Number(rule.minDistance):0;
  const maxValue=Number.isFinite(legacyMax)?legacyMax:3;
  const number=(key,value,min,step,title)=>{
    const el=document.createElement('input');el.type='number';el.min=String(min);el.step=String(step);
    el.value=String(value);el.dataset.bondField=key;el.title=title;return el;
  };
  const minDistance=number('minDistance',minValue,0,.1,'Minimum bond distance (Å)');
  const maxDistance=number('maxDistance',maxValue,0,.1,'Maximum bond/polyhedral distance (Å)');
  const updateStyleDistanceValidity=()=>{
    const limit=styleCellDiagonalForViewer();
    const min=Number(minDistance.value),max=Number(maxDistance.value);
    const valid=Number.isFinite(limit) && safeStyleDistances(min,max,limit);
    maxDistance.max=Number.isFinite(limit)?String(limit):'';
    maxDistance.setAttribute('aria-invalid',String(!valid));
    maxDistance.style.outline=valid?'':'2px solid #cf3c3c';
    const limitText=Number.isFinite(limit)?`${limit.toFixed(3)} Å (unit-cell diagonal)`:'a valid unit cell';
    maxDistance.title=valid
      ?`Maximum distance (Å); lattice-dependent ceiling ${limitText}`
      :`This Style is not drawn: set 0 ≤ Min ≤ Max ≤ ${limitText}. Values are retained.`;
    return valid;
  };
  updateStyleDistanceValidity();
  const width=number('width',Number.isFinite(Number(rule.width))?rule.width:5,1,1,'Bond width (pixels; blank = default)');
  width.max='30';width.placeholder='5';if(rule.widthBlank===true)width.value='';
  const color=document.createElement('input');color.type='color';color.dataset.bondField='color';
  color.value=rule.color||defaultBondColor(a.value,b.value);color.title='Bond color';
  const index=cell('index','');index.setAttribute('aria-label','Style rule index');
  // Explicit on/off flag; unrelated to row selection and never removes a rule.
  // Legacy saved Style rules have no `enabled` field and remain visible.
  const enabled=document.createElement('input');
  enabled.type='checkbox';enabled.dataset.bondField='enabled';
  enabled.checked=rule.enabled!==false;
  enabled.title='Show or hide this Style rule';
  enabled.setAttribute('aria-label','Show Style rule');
  enabled.addEventListener('click',event=>event.stopPropagation());
  enabled.addEventListener('change',()=>{
    row.classList.toggle('style-rule-hidden',!enabled.checked);
    syncStructureBondBulkCheckbox();
    saveStructureViewerState();
    renderCifStructureIfVisible();
  });
  row.classList.toggle('style-rule-hidden',!enabled.checked);
  row.append(index,cell('enabled',enabled),cell('select',a),cell('select',b),cell('mode',bondsToggle),cell('mode',polyhedralToggle),cell('number',minDistance),cell('number',maxDistance),cell('number',width),cell('color',color));
  // Retain the original default pair-color behavior, unless customized.
  let customized=!!rule.color && rule.color.toLowerCase()!==defaultBondColor(a.value,b.value).toLowerCase();
  color.addEventListener('input',()=>{customized=true;});
  const updatePairColor=()=>{if(!customized)color.value=defaultBondColor(a.value,b.value);};
  a.addEventListener('change',updatePairColor);
  b.addEventListener('change',updatePairColor);
  const commit=()=>{updateStyleDistanceValidity();saveStructureViewerState();renderCifStructureIfVisible();};
  for(const el of [a,b,minDistance,maxDistance,width,color]){
    // Input processing is safe even if a user pastes 1e100 into Max: the
    // renderer rejects it before allocating any periodic atoms or bond lines.
    el.addEventListener('input',commit);
    el.addEventListener('change',()=>{
      if(el===minDistance||el===maxDistance){
        let min=Number(minDistance.value),max=Number(maxDistance.value);
        if(!Number.isFinite(min))min=0;if(!Number.isFinite(max))max=3;
        min=Math.max(0,min);max=Math.max(0,max);
        // Do not swap/clip an invalid maximum into a plausible calculation.
        minDistance.value=String(min);maxDistance.value=String(max);
      }
      commit();
    });
  }
  initializeStructureBondDrag(row);
  return row;
}
function updateStructureBondRows(elements,seedRules=null){
  const host=$('cifBondRows');if(!host)return;
  const rules=Array.isArray(seedRules)?seedRules:readStructureBondRules();
  host.replaceChildren();
  structureBondSelectionAnchor=null;
  if(!elements.length){
    const div=document.createElement('div');div.className='structure-rows-empty';
    div.textContent='No atoms available.';host.appendChild(div);refreshStructureBondSelection();syncStructureBondBulkCheckbox();return;
  }
  for(const rule of rules)host.appendChild(createBondRuleRow(rule,elements));
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
}
function addStructureBondRule(rule=null){
  const info=currentStructureForViewer();const elements=structureElements(info?.structure||null);
  const host=$('cifBondRows');if(!host||!elements.length)return;
  if(host.firstElementChild?.classList.contains('structure-rows-empty'))host.replaceChildren();
  const newRule=rule&&typeof rule==='object'&&'a' in rule?rule:
    {a:elements[0],b:elements[Math.min(1,elements.length-1)]||elements[0],bonds:true,polyhedral:false,minDistance:0,maxDistance:3,width:5};
  const row=createBondRuleRow(newRule,elements);
  clearStructureBondSelection();host.appendChild(row);
  row.classList.add('style-row-selected');structureBondSelectionAnchor=row.dataset.styleUid;
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
  saveStructureViewerState();renderCifStructureIfVisible();
  return row;
}
function copySelectedStructureBondRules(){
  const selected=selectedStructureBondRows();if(!selected.length)return;
  const elements=structureElements(currentStructureForViewer()?.structure||null);
  const host=$('cifBondRows');
  const copies=selected.map(row=>readBondRuleFromRow(row)).filter(Boolean);
  clearStructureBondSelection();
  for(const rule of copies){
    const row=createBondRuleRow(rule,elements);host.appendChild(row);
    row.classList.add('style-row-selected');structureBondSelectionAnchor=row.dataset.styleUid;
  }
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
  saveStructureViewerState();renderCifStructureIfVisible();
}
function readBondRuleFromRow(row){
  // This reuses readStructureBondRules so copies retain all edits and the
  // precise same data shape as saved viewer rules.
  const rows=[...document.querySelectorAll('#cifBondRows .structure-bond-row')];
  const rules=readStructureBondRules();
  return rules[rows.indexOf(row)]||null;
}
function removeSelectedStructureBondRules(){
  const doomed=selectedStructureBondRows();
  if(!doomed.length)return;
  // Remove first, then snapshot the new rule list. This must also work when
  // the last visible rule is removed (an empty list is meaningful).
  for(const row of doomed)row.remove();
  structureBondSelectionAnchor=null;
  finishStructureBondDrag();
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
  saveStructureViewerState();
  renderCifStructureIfVisible(); // Plotly.react with no old bond / mesh traces
}
function structureSignature(structure){
  if(!structure) return "";
  const lattice=structure.lattice||{};
  const sites=(structure.asymmetricSites||[]).map((s,i)=>`${i}:${s.label||""}:${s.element}:${s.x}:${s.y}:${s.z}:${(s.magneticMoment||[]).join(",")}:${s.magneticFourier?JSON.stringify(s.magneticFourier):""}`).join("|");
  return `${lattice.a},${lattice.b},${lattice.c},${lattice.alpha},${lattice.beta},${lattice.gamma}|${sites}`;
}
function syncStructureControlRows(structure){
  const sig=structureSignature(structure);
  if(sig===structureControlSignature) return;
  const oldBondRules=restoredStructureBondRules!==null ? restoredStructureBondRules : readStructureBondRules();
  restoredStructureBondRules=null;
  structureControlSignature=sig;
  clearSpinRowSelection({redraw:false});
  visibleSpinSelectionSites.clear();
  const elements=structureElements(structure);
  assignDistinctElementColors(elements);
  updateStructureAtomColorRows(elements,structure);
  updateMagneticMomentRows(structure);
  updateStructureBondRows(elements,oldBondRules);
  syncStructureBondDisplayModeControls();
}
function estimateStructureReplicationTests(structure,range){
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length?structure.atoms:structure?.asymmetricSites||[]);
  let tests=base.length;
  for(const axis of ['x','y','z']){
    const bounds=rangeCellBounds(range[axis]);
    const n=bounds.to-bounds.from+5;
    if(!Number.isFinite(n)||n<0)return Infinity;
    tests*=n;
    if(!Number.isFinite(tests)||tests>STRUCTURE_MAX_REPLICATION_TESTS)return Infinity;
  }
  return tests;
}
function replicatedAtoms(structure,range){
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length?structure.atoms:structure?.asymmetricSites||[]);
  // Final guard even if the caller forgot a preflight check.
  if(estimateStructureReplicationTests(structure,range)>STRUCTURE_MAX_REPLICATION_TESTS)return [];
  const out=[];
  const appearance=parentAppearanceOrbits(structure);
  const manual=structurePositionEditingMode==='individual' && !!appearance;
  const appearanceMap=manual?appearance.manualMap:appearance?.siteMap;
  const xb=rangeCellBounds(range.x), yb=rangeCellBounds(range.y), zb=rangeCellBounds(range.z);
  const eps=1e-9;
  for(let ix=xb.from-2;ix<=xb.to+2;ix++) for(let iy=yb.from-2;iy<=yb.to+2;iy++) for(let iz=zb.from-2;iz<=zb.to+2;iz++){
    for(const [expandedAtomIndex,atom] of base.entries()){
      const phaseX=fracWrap01(atom.x)+ix, phaseY=fracWrap01(atom.y)+iy, phaseZ=fracWrap01(atom.z)+iz;
      const x=phaseX, y=phaseY, z=phaseZ;
      if(x<range.x.min-eps||x>range.x.max+eps||y<range.y.min-eps||y>range.y.max+eps||z<range.z.min-eps||z>range.z.max+eps) continue;
      const parentAppearanceIndex=appearanceMap?.get(atom.sourceSiteIndex);
      out.push({...atom,x,y,z,phaseX,phaseY,phaseZ,cell:[ix,iy,iz],expandedAtomIndex,
        ...(Number.isInteger(parentAppearanceIndex)?{appearanceSiteIndex:parentAppearanceIndex}:{}) ,
        ...(typeof parentAppearanceIndex==='string'?{appearanceSiteKey:parentAppearanceIndex}:{}
        ),...(!appearance && structurePositionEditingMode==='individual'
          ?{appearanceSiteKey:`manual-site:${expandedAtomIndex}`}:{})});
    }
  }
  return out;
}
function bondMatchesPair(rule,a,b){ return (rule.a===a&&rule.b===b)||(rule.a===b&&rule.b===a); }
function bondTraces(atoms,basis,rules){
  const traces=[];
  const warnings=[];
  if(atoms.length>STYLE_MAX_BOND_ATOMS){
    traces.warning=`Bonds skipped: more than ${STYLE_MAX_BOND_ATOMS} visible atoms. Reduce the Structure range.`;
    return traces;
  }
  const activeRules=rules.filter(rule=>rule.enabled!==false);
  if(activeRules.length>STYLE_MAX_BOND_RULES){
    traces.warning=`Bonds skipped: more than ${STYLE_MAX_BOND_RULES} active Style rows.`;
    return traces;
  }
  // Budget the PAIR SEARCH as well as the output, so many active rows do
  // not freeze the UI even when each distance is crystallographically valid.
  const pairTests=atoms.length*(atoms.length-1)/2*activeRules.length;
  if(pairTests>2400000){
    traces.warning='Bonds skipped: too many atom-pair tests. Reduce repeat ranges or Style rules.';
    return traces;
  }
  const limit=styleCellDiagonalLimit(basis);
  const xyz=atoms.map(atom=>fractionalToCartesian(basis,[atom.x,atom.y,atom.z]));
  let allSegments=0;
  for(const rule of activeRules){
    if(!Number.isFinite(limit) || !safeStyleDistances(Number(rule.minDistance),Number(rule.maxDistance),limit)) {
      warnings.push(`Style ${rule.a}-${rule.b} skipped: Max exceeds the unit-cell diagonal.`);
      continue;
    }
    const x=[],y=[],z=[];
    let budgetReached=false;
    for(let i=0;i<atoms.length&&!budgetReached;i++){
      const ai=atoms[i];
      for(let j=i+1;j<atoms.length;j++){
        const aj=atoms[j];
        if(!bondMatchesPair(rule,String(ai.element),String(aj.element))) continue;
        const pi=xyz[i],pj=xyz[j];
        const d=vecNorm(vecSub(pj,pi));
        if(!(d>1e-6)||d<rule.minDistance-1e-9||d>rule.maxDistance+1e-9) continue;
        if(++allSegments>STYLE_MAX_BOND_SEGMENTS){budgetReached=true;break;}
        x.push(pi[0],pj[0],null);y.push(pi[1],pj[1],null);z.push(pi[2],pj[2],null);
      }
    }
    // Don't return huge partial geometry with misleading results.
    if(budgetReached){
      // No partial rendering: return an empty, explicitly warned result.
      const skipped=[];
      skipped.warning=`Bonds skipped: more than ${STYLE_MAX_BOND_SEGMENTS} segments; reduce Max or the display range.`;
      return skipped;
    }
    if(x.length) traces.push({type:"scatter3d",mode:"lines",x,y,z,name:`${rule.a}-${rule.b} ${rule.minDistance}–${rule.maxDistance} Å`,hoverinfo:"skip",showlegend:false,line:{color:rule.color,width:Math.max(1,Number(rule.width)||5)}});
  }
  traces.warning=warnings.join(' ');
  return traces;
}
// Convex hull of a coordination shell. Build each planar face only once,
// including faces with four or more coplanar ligand atoms (e.g. octahedra).
// No external geometry package is required by the CIF Generator.
function coordinationHullTriangles(points){
  if(points.length<4)return [];
  const centre=[0,0,0];
  for(const p of points){centre[0]+=p[0];centre[1]+=p[1];centre[2]+=p[2];}
  for(let a=0;a<3;a++)centre[a]/=points.length;
  const span=Math.max(1,...points.map(p=>vecNorm(vecSub(p,centre))));
  const tolerance=span*1e-6;
  const seenFaces=new Set(),triangles=[];
  const projectedCross=(a,b,c)=> (b.u-a.u)*(c.v-a.v)-(b.v-a.v)*(c.u-a.u);
  for(let i=0;i<points.length-2;i++)for(let j=i+1;j<points.length-1;j++)for(let k=j+1;k<points.length;k++){
    let normal=vecCross(vecSub(points[j],points[i]),vecSub(points[k],points[i]));
    const magnitude=vecNorm(normal);
    if(magnitude<tolerance*tolerance)continue;
    normal=vecScale(normal,1/magnitude);
    let front=false,back=false;
    for(const p of points){
      const d=vecDot(normal,vecSub(p,points[i]));
      if(d>tolerance)front=true;
      if(d< -tolerance)back=true;
      if(front&&back)break;
    }
    if(front&&back)continue; // plane cuts through the point cloud
    if(vecDot(normal,vecSub(centre,points[i]))>0)normal=vecScale(normal,-1);
    const coplanar=[];
    for(let m=0;m<points.length;m++){
      if(Math.abs(vecDot(normal,vecSub(points[m],points[i])))<=tolerance)coplanar.push(m);
    }
    const key=coplanar.join(',');
    if(seenFaces.has(key))continue;
    seenFaces.add(key);
    // Project this face onto an outward-oriented 2D frame, then obtain its
    // perimeter (ignore atoms in the interior of a flat face).
    const u=vecNormalize(vecSub(points[j],points[i]));
    const v=vecCross(normal,u);
    const projected=coplanar.map(idx=>({idx,
      u:vecDot(points[idx],u),v:vecDot(points[idx],v)}))
      .sort((a,b)=>a.u-b.u||a.v-b.v);
    const lower=[],upper=[];
    for(const p of projected){
      while(lower.length>=2 && projectedCross(lower[lower.length-2],lower[lower.length-1],p)<=tolerance)lower.pop();
      lower.push(p);
    }
    for(let m=projected.length-1;m>=0;m--){
      const p=projected[m];
      while(upper.length>=2 && projectedCross(upper[upper.length-2],upper[upper.length-1],p)<=tolerance)upper.pop();
      upper.push(p);
    }
    const outline=lower.slice(0,-1).concat(upper.slice(0,-1));
    for(let t=1;t<outline.length-1;t++)triangles.push([outline[0].idx,outline[t].idx,outline[t+1].idx]);
  }
  // A planar shell is not a 3D polyhedron.
  const volume6=triangles.reduce((sum,[i,j,k])=>sum+vecDot(points[i],vecCross(points[j],points[k])),0);
  return Math.abs(volume6)>tolerance*tolerance*tolerance ? triangles:[];
}
// Polyhedral selection is local to each displayed centre. We NEVER expand
// all atoms across the full Structure view just to find one coordination shell.
// These counts limit CPU/WebGL work, not crystallographic bond distances.
const POLY_MAX_RULES=12;
const POLY_MAX_CENTRES=256;            // Count actual A1 centres, not all atoms
const POLY_MAX_HULL_VERTICES=12;
const POLY_MAX_TRIANGLES=4800;
const POLY_MAX_PAIR_TESTS=2500000;     // Shared budget across all local searches
const POLY_MAX_BASE_LIGANDS=20000;
// Find up to 12 nearest A2 periodic images inside [Min, Max]. Increasing the
// search radius in stages means even a large crystallographically valid Max
// usually needs only the first coordination shell. The reciprocal-vector
// bounds are exact for *skew* lattices: any Cartesian displacement shorter
// than R must have |delta_fractional_i| <= R |reciprocal_i|.
function nearestPeriodicPolyhedralLigands(centre,ligandSites,basis,minDistance,maxDistance,budget){
  const origin=fractionalToCartesian(basis,[centre.x,centre.y,centre.z]);
  const reciprocal=[vecNorm(basis.astar),vecNorm(basis.bstar),vecNorm(basis.cstar)];
  const translationBasis=[basis.a,basis.b,basis.c];
  let searchRadius=Math.min(maxDistance,Math.max(2.5,minDistance+1));
  const epsilon=1e-8;
  while(true){
    const nearest=[];
    const radiusSq=searchRadius*searchRadius;
    const minSq=Math.max(1e-12,(minDistance-1e-9)**2);
    for(const site of ligandSites){
      const shift=[];
      for(let a=0;a<3;a++){
        const centreFrac=[centre.x,centre.y,centre.z][a];
        const siteFrac=[site.x,site.y,site.z][a];
        const reach=searchRadius*reciprocal[a]+epsilon;
        const lo=Math.ceil(centreFrac-siteFrac-reach);
        const hi=Math.floor(centreFrac-siteFrac+reach);
        shift.push([lo,hi]);
      }
      // Prevent an accidental Cartesian-product explosion BEFORE the loops.
      const possible=shift.reduce((n,[lo,hi])=>n*Math.max(0,hi-lo+1),1);
      if(!Number.isFinite(possible)||budget.tests+possible>POLY_MAX_PAIR_TESTS)
        return {points:[],warning:'Polyhedra not drawn: local neighbor-search safety budget exceeded. Reduce Max, the Style rules, or the number of centres.'};
      if(!possible)continue;
      const siteCart=fractionalToCartesian(basis,[site.x,site.y,site.z]);
      for(let nx=shift[0][0];nx<=shift[0][1];nx++){
        const dx=vecAdd(vecSub(siteCart,origin),vecScale(translationBasis[0],nx));
        for(let ny=shift[1][0];ny<=shift[1][1];ny++){
          const dxy=vecAdd(dx,vecScale(translationBasis[1],ny));
          for(let nz=shift[2][0];nz<=shift[2][1];nz++){
            budget.tests++;
            const delta=vecAdd(dxy,vecScale(translationBasis[2],nz));
            const d2=vecDot(delta,delta);
            if(d2<minSq||d2>radiusSq+1e-8)continue;
            if(nearest.length===POLY_MAX_HULL_VERTICES && d2>=nearest[nearest.length-1].d2-epsilon)continue;
            const p=vecAdd(origin,delta);
            if(nearest.some(item=>vecDot(vecSub(item.p,p),vecSub(item.p,p))<1e-10))continue;
            const at=nearest.findIndex(item=>d2<item.d2);
            nearest.splice(at<0?nearest.length:at,0,{p,d2});
            if(nearest.length>POLY_MAX_HULL_VERTICES)nearest.pop();
          }
        }
      }
    }
    if(nearest.length>=POLY_MAX_HULL_VERTICES || searchRadius>=maxDistance-1e-8)
      return {points:nearest.map(item=>item.p),warning:''};
    searchRadius=Math.min(maxDistance,Math.max(searchRadius*2,searchRadius+1));
  }
}
function coordinationPolyhedralTraces(centres,structure,basis,rules){
  const traces=[];
  const activeRules=rules.filter(rule=>rule.enabled!==false);
  if(activeRules.length>POLY_MAX_RULES)
    return {traces,warning:`Polyhedra not drawn: more than ${POLY_MAX_RULES} active Style rules.`};
  const maxCutoff=styleCellDiagonalLimit(basis);
  if(!Number.isFinite(maxCutoff) || activeRules.some(r=>
      !safeStyleDistances(Number(r.minDistance),Number(r.maxDistance),maxCutoff)))
    return {traces,warning:'Polyhedra not drawn: invalid Min/Max or Max exceeds the unit-cell diagonal.'};
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length
    ?structure.atoms:structure?.asymmetricSites||[]);
  if(base.length>POLY_MAX_BASE_LIGANDS)
    return {traces,warning:'Polyhedra not drawn: too many source atoms for local neighbor search.'};
  const byElement=new Map();
  const appearance=parentAppearanceOrbits(structure);
  const appearanceMap=structurePositionEditingMode==='individual'?appearance?.manualMap:appearance?.siteMap;
  for(const [index,atom] of base.entries()){
    const parentIndex=appearanceMap?.get(atom.sourceSiteIndex);
    const drawn=Number.isInteger(parentIndex)?{...atom,appearanceSiteIndex:parentIndex}
      :typeof parentIndex==='string'?{...atom,appearanceSiteKey:parentIndex}:
      structurePositionEditingMode==='individual'?{...atom,appearanceSiteKey:`manual-site:${index}`}:atom;
    if(!atomIsVisible(drawn))continue;
    const name=String(atom.element);
    if(!byElement.has(name))byElement.set(name,[]);
    byElement.get(name).push(drawn);
  }
  const budget={tests:0};
  let totalTriangles=0;
  for(const rule of activeRules){
    const sourceCentres=centres.filter(atom=>String(atom.element)===rule.a);
    if(sourceCentres.length>POLY_MAX_CENTRES)
      return {traces:[],warning:`Polyhedra not drawn: more than ${POLY_MAX_CENTRES} centres of ${rule.a} in the Structure view. Reduce repeat ranges.`};
    const ligands=byElement.get(rule.b)||[];
    if(!sourceCentres.length||!ligands.length)continue;
    // One Plotly mesh per Style, not one WebGL trace per centre.
    const mesh={x:[],y:[],z:[],i:[],j:[],k:[]};
    for(const centre of sourceCentres){
      const local=nearestPeriodicPolyhedralLigands(centre,ligands,basis,
        Number(rule.minDistance),Number(rule.maxDistance),budget);
      if(local.warning)return {traces:[],warning:local.warning};
      if(local.points.length<4)continue;
      const faces=coordinationHullTriangles(local.points);
      if(!faces.length)continue;
      totalTriangles+=faces.length;
      if(totalTriangles>POLY_MAX_TRIANGLES)
        return {traces:[],warning:`Polyhedra not drawn: more than ${POLY_MAX_TRIANGLES} triangles. Reduce visible centres or display range.`};
      const offset=mesh.x.length;
      for(const p of local.points){mesh.x.push(p[0]);mesh.y.push(p[1]);mesh.z.push(p[2]);}
      for(const [i,j,k] of faces){mesh.i.push(offset+i);mesh.j.push(offset+j);mesh.k.push(offset+k);}
    }
    if(mesh.i.length)traces.push({type:'mesh3d',name:`${rule.a}-${rule.b} polyhedron`,
      ...mesh,color:rule.color,opacity:0.3,flatshading:true,
      lighting:{ambient:0.74,diffuse:0.65,specular:0.10,roughness:0.9},
      showlegend:false,hoverinfo:'skip'});
  }
  return {traces,warning:''};
}
function atomMomentSetting(atom,settings,structure){
  if(spinEditingIsIndividual(structure)) return individualSettingForAtom(atom,structure,settings);
  const sourceIndex=Number.isInteger(atom.sourceSiteIndex)?atom.sourceSiteIndex:null;
  if(sourceIndex!==null){
    const site=(structure?.asymmetricSites||[])[sourceIndex];
    if(site) return settings.get(momentKey({...site,siteIndex:sourceIndex}))||null;
  }
  const candidates=[...settings.entries()];
  const label=String(atom.sourceLabel||"");
  if(label){ const hit=candidates.find(([key])=>key.endsWith(`:${label}`)); if(hit) return hit[1]; }
  return null;
}
function appendSolidArrowHead(mesh,tip,dir,headLength,color){
  const length=Math.max(0.01,Number(headLength)||0.5);
  const radius=length*0.42;
  const baseCenter=vecSub(tip,vecScale(dir,length));
  const helper=Math.abs(dir[2])<0.9?[0,0,1]:[0,1,0];
  const p1=vecNormalize(vecCross(dir,helper));
  const p2=vecNormalize(vecCross(dir,p1));
  const segments=10;
  const baseStart=mesh.x.length;
  for(let n=0;n<segments;n++){
    const a=2*PI*n/segments;
    const p=vecAdd(baseCenter,vecAdd(vecScale(p1,radius*Math.cos(a)),vecScale(p2,radius*Math.sin(a))));
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
  const key=["a","b","c"].includes(String(structureMomentRotationAxis||"")) ? String(structureMomentRotationAxis) : "c";
  return vecNormalize(basis?.[key]||basis?.c||[0,0,1]);
}
function rotateVectorAroundAxis(v,axis,angle){
  const n=vecNormalize(axis);
  const c=Math.cos(angle), s=Math.sin(angle);
  return vecAdd(vecAdd(vecScale(v,c),vecScale(vecCross(n,v),s)),vecScale(n,vecDot(n,v)*(1-c)));
}
function effectivePropagationVectorForStructure(){
  const qs=enabledPropagationVectorsForStructure();
  if(!qs.length) return {h:0,k:0,l:0,index:0,count:0};
  let q=qs.find(item=>item.index===structureMomentPropagationIndex);
  if(!q){
    q=qs[0];
    structureMomentPropagationIndex=q.index;
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
  const qs=enabledPropagationVectorsForStructure();
  const previous=structureMomentPropagationIndex;
  select.replaceChildren();
  if(!qs.length){
    const option=document.createElement("option");
    option.value="0"; option.textContent="None (k = 0, 0, 0)";
    select.appendChild(option);
    select.value="0"; select.disabled=true;
    structureMomentPropagationIndex=0;
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
  structureMomentPropagationIndex=chosen;
  if(sourceIsMagneticCif() && !importedMagneticEditMode){
    const imported=document.createElement("option");
    imported.value="mcif"; imported.textContent="mCIF";
    select.prepend(imported);
    select.value="mcif";
  }else select.value=String(chosen);
}
function magneticStructureTraces(atoms,basis,structure){
  const q=effectivePropagationVectorForStructure();
  const settings=currentMomentSettings();
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
    if(structure?.magnetic && !importedMagneticEditMode &&
       !Array.isArray(atom.magneticMoment) && !atom.magneticFourier) continue;
    const frac=[Number.isFinite(atom.phaseX)?atom.phaseX:atom.x,Number.isFinite(atom.phaseY)?atom.phaseY:atom.y,Number.isFinite(atom.phaseZ)?atom.phaseZ:atom.z];
    const crystalMoment=(Array.isArray(atom.magneticMoment)||atom.magneticFourier)
      ? atomCrystalMoment(atom,frac) : null;
    // After an edit, user-controlled site moments and the selected model take
    // precedence over source magnetic symmetry. Do not reuse old symmetry.
    const moment=(!importedMagneticEditMode && crystalMoment)
      ? mcifCrystalAxisToCartesian(basis,crystalMoment)
      : [Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0];
    const mnorm=vecNorm(moment);
    if(!(mnorm>1e-12)) continue;
    const basePhase=2*PI*(q.h*frac[0]+q.k*frac[1]+q.l*frac[2]);
    let dir=vecNormalize(moment);
    let amplitude=1;
    if(!importedMagneticEditMode && (Array.isArray(atom.magneticMoment) || atom.magneticFourier)){
      // Before editing, display the original symmetry/Fourier moments.
    }else if(spinEditingIsIndividual(structure)){
      // The user supplies each supercell vector; do not synthesize k modulation.
    }else if(structureMomentStructureType==="helical"){
      const chiralitySign=structureMomentChirality==="CW" ? 1 : -1;
      dir=vecNormalize(rotateVectorAroundAxis(moment,rotationAxis,chiralitySign*basePhase));
    }else if(structureMomentStructureType==="sinusoidal"){
      amplitude=Math.cos(basePhase);
      if(Math.abs(amplitude)<1e-5) continue;
      if(amplitude<0) dir=vecScale(dir,-1);
      amplitude=Math.abs(amplitude);
    }else{
      // Collinear includes the former Uniform mode: k = 0 gives the same
      // moment in every cell, while half-integer propagation components give
      // the usual parallel/antiparallel AFM alternation.
      const phaseAmplitude=Math.cos(basePhase);
      if(phaseAmplitude<0) dir=vecScale(dir,-1);
    }
    // Length is only a display multiplier. The original Cartesian moment
    // (including its magnitude in mu_B) stays unchanged for mCIF export.
    // Using the norm here preserves relative arrow lengths between distinct
    // magnetic ions: e.g. 2 mu_B and 1 mu_B display at a 2:1 ratio.
    const displayMultiplier=Number(structureMomentGlobalLength);
    const length=(Number.isFinite(displayMultiplier) ? Math.max(0.05,displayMultiplier) : 1)*mnorm*amplitude;
    if(!(length>1e-12)) continue;
    const width=Math.max(1,Number(structureMomentGlobalWidth)||10);
    // Avoid a fixed arrowhead minimum that could dwarf small moments.
    const headLength=Math.min(Math.max(0.01,Number(structureMomentGlobalHeadSize)||0.51),2*length*0.95);
    const center=fractionalToCartesian(basis,frac);
    // Length is the center-to-end (half-length) setting.  The displayed arrow
    // is symmetric about the atom position: tail = center - L*dir,
    // tip = center + L*dir, so the atom sits at the arrow midpoint.
    const start=vecSub(center,vecScale(dir,length));
    const tip=vecAdd(center,vecScale(dir,length));
    const color=setting.color||elementColor(atom.element);
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
function ensureStructureViewerStyle(){
  // Structure Viewer layout is defined in styles.css.  Keeping this hook avoids
  // late runtime CSS overriding the HTML/CSS layout and shrinking entry boxes.
}
function createSplitRangeControls(axis){
  const cap=axis.toUpperCase();
  const legacy=$("cifRange"+cap);
  let minInput=$("cifRange"+cap+"Min");
  let maxInput=$("cifRange"+cap+"Max");
  if(!minInput || !maxInput){
    if(!legacy) return;
    const parsed=parseStructureRangeEntry(legacy.value);
    const parent=legacy.parentElement || legacy.parentNode;
    const field=(suffix,labelText,value)=>{
      const label=document.createElement("label"); label.className="structure-entry-field";
      const caption=document.createElement("span"); caption.className="structure-entry-label"; caption.textContent=labelText;
      const input=document.createElement("input"); input.id=`cifRange${cap}${suffix}`; input.type="number"; input.step="0.1"; input.value=String(value);
      label.append(caption,input); return {label,input};
    };
    const minField=field("Min",`${axis} min`,parsed.min), maxField=field("Max",`${axis} max`,parsed.max);
    if(parent){ parent.insertBefore(minField.label,legacy); parent.insertBefore(maxField.label,legacy); }
    legacy.type="hidden";
    minInput=minField.input; maxInput=maxField.input;
  }
  if(!minInput || !maxInput || minInput.dataset.structureRangeBound==="1") return;
  const syncLegacy=()=>{
    let min=Number(minInput.value), max=Number(maxInput.value);
    if(Number.isFinite(min) && Number.isFinite(max) && legacy) legacy.value=`${min} ${max}`;
  };
  const commit=()=>{
    normalizeStructureRangeInputs();
    saveStructureViewerState();
    renderCifStructureIfVisible();
  };
  for(const input of [minInput,maxInput]){
    input.dataset.structureRangeBound="1";
    input.addEventListener("input",()=>{ syncLegacy(); saveStructureViewerState(); });
    input.addEventListener("change",commit);
    input.addEventListener("keydown",ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); input.blur(); } });
  }
}
function hideLegacyStructureColumnHeaders(hostId,requiredWords){
  const host=$(hostId); if(!host) return;
  const words=requiredWords.map(x=>String(x).toLowerCase());
  const candidates=[];
  let node=host.previousElementSibling;
  for(let i=0;node && i<5;i++,node=node.previousElementSibling) candidates.push(node);
  for(const child of host.parentElement?.children||[]) if(child!==host) candidates.push(child);
  for(const el of [...new Set(candidates)]){
    if(!el || el.querySelector?.("input,select,textarea")) continue;
    const text=String(el.textContent||"").replace(/\s+/g," ").trim().toLowerCase();
    if(text && words.every(word=>text.includes(word))){
      el.classList.add("structure-legacy-column-header");
      break;
    }
  }
}
function findStructureSectionHeading(host,titleWords){
  if(!host) return null;
  const words=titleWords.map(x=>String(x).toLowerCase());
  const matches=el=>{
    const text=String(el?.textContent||"").replace(/\s+/g," ").trim().toLowerCase();
    return text && words.every(word=>text.includes(word));
  };
  let node=host.previousElementSibling;
  for(let i=0;node && i<8;i++,node=node.previousElementSibling){
    if(matches(node) && !node.querySelector?.("input,select,textarea")) return node;
  }
  const parent=host.parentElement;
  if(parent){
    const selectors="h1,h2,h3,h4,h5,h6,.section-title,.panel-title,.card-title,.structure-section-title,strong";
    const list=[...parent.querySelectorAll(selectors)];
    const before=list.filter(el=>matches(el) && (el.compareDocumentPosition(host)&Node.DOCUMENT_POSITION_FOLLOWING));
    if(before.length) return before[before.length-1];
  }
  return null;
}
function resetMomentDisplayDefaults(){
  structureMomentStructureType="collinear";
  structureMomentRotationAxis="c";
  structureMomentChirality="CCW";
  if($("cifMomentStructureType")) $("cifMomentStructureType").value="collinear";
  if($("cifMomentRotationAxis")) $("cifMomentRotationAxis").value="c";
  if($("cifMomentChirality")) $("cifMomentChirality").value="CCW";
  const info=currentStructureForViewer();
  const sites=magneticCandidateSites(info?.structure||null);
  const live=currentMomentSettings();
  for(const site of sites){
    const key=momentKey(site);
    const current=live.get(key)||structureMomentSettings.get(key)||defaultMomentSetting(site,info?.structure);
    structureMomentSettings.set(key,{...current,size:1,width:10,headSize:0.51,color:elementColor(site.element),colorCustomized:false});
  }
  $("cifMagMomentRows")?.replaceChildren();
  structureControlSignature="";
  saveStructureViewerState();
  renderCifStructureIfVisible();
}
function resetAtomDisplayDefaults(){
  structureAtomColorOverrides.clear();
  structureAtomSizeOverrides.clear();
  structureControlSignature="";
  saveStructureViewerState();
  renderCifStructureIfVisible();
}
function resetBondDisplayDefaults(){
  for(const row of document.querySelectorAll("#cifBondRows .structure-bond-row")){
    const min=row.querySelector('[data-bond-field="minDistance"]'); if(min) min.value="0";
    const max=row.querySelector('[data-bond-field="maxDistance"]'); if(max) max.value="3";
    const legacy=row.querySelector('[data-bond-field="distanceRange"]'); if(legacy) legacy.value="0 3";
    const width=row.querySelector('[data-bond-field="width"]'); if(width) width.value="5";
    const color=row.querySelector('[data-bond-field="color"]'); if(color) color.value=defaultBondColor(row.querySelector('[data-bond-field="a"]')?.value,row.querySelector('[data-bond-field="b"]')?.value);
  }
  saveStructureViewerState();
  renderCifStructureIfVisible();
}
function ensureSectionDefaultButton(hostId,buttonId,handler,titleWords,existingButton=null){
  const host=$(hostId); if(!host) return null;
  document.getElementById(buttonId+"Row")?.remove();
  let button=existingButton || document.getElementById(buttonId);
  if(!button){ button=document.createElement("button"); button.type="button"; button.id=buttonId; button.textContent="Default"; }
  button.textContent="Default";
  if(button._structureDefaultHandler) button.removeEventListener("click",button._structureDefaultHandler);
  button._structureDefaultHandler=handler;
  button.addEventListener("click",handler);
  // The updated HTML already places each Default button next to its section title.
  // Keep that exact placement instead of moving the button into the <h3> element.
  if(button.parentElement?.classList.contains("structure-section-heading")) return button;
  const title=findStructureSectionHeading(host,titleWords);
  const headingRow=title?.closest?.(".structure-section-heading");
  if(headingRow){ headingRow.appendChild(button); return button; }
  if(title){
    const row=document.createElement("div"); row.className="structure-section-heading";
    title.parentElement?.insertBefore(row,title); row.append(title,button); return button;
  }
  host.parentElement?.insertBefore(button,host);
  return button;
}
// mCIF determines the magnetic arrangement itself, independent of the manual
// Collinear/Helical/Sinusoidal generator mode. Keep the latter preference.
function syncImportedMomentStructureType(){
  const original=sourceIsMagneticCif() && !importedMagneticEditMode;
  const inputs=[
    ["cifMomentStructureType",structureMomentStructureType],
    ["cifMomentRotationAxis",structureMomentRotationAxis],
    ["cifMomentChirality",structureMomentChirality]
  ];
  for(const [id,value] of inputs){
    const select=$(id); if(!select) continue;
    let option=select.querySelector('option[value="mcif"]');
    if(original){
      if(!option){ option=document.createElement("option"); option.value="mcif"; option.textContent="mCIF";select.prepend(option); }
      select.value="mcif";
    }else{
      option?.remove();
      select.value=value;
    }
    select.title=original ? "Original imported mCIF arrangement. Choose a setting to edit it." : "Editable magnetic structure setting.";
  }
  syncSpinModifyLock();
}

// Confine the CIF Generator to the portion of the main workspace that is
// actually visible. Width-based (square) Structure sizing must not force a
// second, page-level scroll on wide/short monitors. Single-column layouts
// keep their natural height so small screens do not hide essential controls.
let generatorViewportFrame=0;
function requestGeneratorViewportHeightSync(){
  if(generatorViewportFrame) return;
  generatorViewportFrame=requestAnimationFrame(()=>{
    generatorViewportFrame=0;
    const card=document.querySelector('#structurePanel .generator-unified-card');
    const grid=$('cifGeneratorPanel');
    if(!card || !grid) return;
    const active=!!card.getClientRects().length;
    const columns=getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean);
    const desktop=active && columns.length>=2;
    // Extremely short viewports cannot safely contain the editor controls;
    // preserve ordinary scrolling in that exceptional case.
    const main=card.closest('main');
    const viewportBottom=Math.min(window.innerHeight,main?.getBoundingClientRect().bottom||window.innerHeight);
    const freeHeight=Math.floor(viewportBottom-card.getBoundingClientRect().top-12);
    const fit=desktop && freeHeight>=330;
    const prevHeight=card.style.getPropertyValue('--generator-visible-height');
    const wasFit=card.classList.contains('generator-height-limited');
    if(!fit){
      card.classList.remove('generator-height-limited');
      card.style.removeProperty('--generator-visible-height');
    }else{
      if(prevHeight!==`${freeHeight}px`) card.style.setProperty('--generator-visible-height',`${freeHeight}px`);
      card.classList.add('generator-height-limited');
    }
    if(wasFit!==fit || (fit && prevHeight!==`${freeHeight}px`)) requestStructureTableHeightSync();
  });
}
function prepareGeneratorViewportHeightSync(){
  if(document.documentElement.dataset.generatorViewportBound) return;
  document.documentElement.dataset.generatorViewportBound='1';
  window.addEventListener('resize',requestGeneratorViewportHeightSync);
  window.visualViewport?.addEventListener('resize',requestGeneratorViewportHeightSync);
  const panel=$('structurePanel');
  if(typeof MutationObserver==='function' && panel){
    new MutationObserver(requestGeneratorViewportHeightSync).observe(panel,{attributes:true,attributeFilter:['class','hidden']});
  }
  if(typeof ResizeObserver==='function'){
    const card=document.querySelector('#structurePanel .generator-unified-card');
    const main=card?.closest('main');
    const observer=new ResizeObserver(requestGeneratorViewportHeightSync);
    if(main) observer.observe(main);
    if(card) observer.observe(card);
    // The plot will be resized when its actual container dimensions change.
    const wrap=panel?.querySelector('#mcifStructurePane .structure-plot-wrap');
    if(wrap){
      let plotResizeFrame=0;
      new ResizeObserver(()=>{
        if(plotResizeFrame) return;
        plotResizeFrame=requestAnimationFrame(()=>{
          plotResizeFrame=0;
          const plot=$('cifStructurePlot');
          if(plot?._fullLayout && typeof Plotly!=='undefined' && typeof Plotly.Plots?.resize==='function'){
            Promise.resolve(Plotly.Plots.resize(plot)).catch(()=>{});
          }
        });
      }).observe(wrap);
    }
  }
  requestGeneratorViewportHeightSync();
}
// The right-hand Structure plot sets the available height of the editor.
// Only the TABLE scrolls; output format, mode controls, and action buttons stay visible.
let structureTableHeightFrame=0;
function requestStructureTableHeightSync(){
  if(structureTableHeightFrame)return;
  structureTableHeightFrame=requestAnimationFrame(()=>{
    structureTableHeightFrame=0;
    const generator=$('cifGeneratorPanel');
    const reference=document.querySelector('#mcifStructurePane .structure-plot-wrap');
    if(!generator||!reference)return;
    const twoColumns=getComputedStyle(generator).gridTemplateColumns.split(' ').length>1;
    const rightBottom=reference.getBoundingClientRect().bottom;
    for(const [panelKey,selector] of [
      ['positions','.cif-atom-table-wrap'],
      ['appearance','#cifAtomColorRows'],
      ['spins','.structure-spin-table-wrap'],
      ['bonds','.structure-style-table-wrap']
    ]){
      const panel=document.querySelector(`#structurePanel [data-structure-config-panel="${panelKey}"]`);
      const table=panel?.querySelector(selector);
      if(!table)continue;
      const detailed=panelKey==='positions' ? $('cifAtomDetailed') : null;
      const thermal=detailed?.querySelector('.cif-thermal-table-wrap');
      // When Uij is expanded, both atom tables share the vertical space.
      // Their natural height is used for few rows, and both scroll at the
      // same cap when many rows are present.  Collapsing restores the full
      // original Positions height, without changing the source atom data.
      if(!twoColumns||panel.hidden||!generator.getClientRects().length){
        table.style.removeProperty('--editor-table-height');
        if(thermal){
          thermal.style.removeProperty('--thermal-editor-table-height');
          if(detailed.open){
            const compact='calc(232px * var(--tas-density))';
            table.style.setProperty('--editor-table-height',compact);
            thermal.style.setProperty('--thermal-editor-table-height',compact);
          }
        }
        continue;
      }
      const rect=table.getBoundingClientRect();
      if(detailed?.open && thermal){
        const thermalRect=thermal.getBoundingClientRect();
        // All fixed vertical elements excluding the two scrolling tables:
        // Positions title, action buttons, Uij summary, gaps, etc.
        const fixed=panel.getBoundingClientRect().bottom-rect.top-rect.height-thermalRect.height;
        const budget=Math.floor(rightBottom-rect.top-fixed-10);
        const shared=Math.max(96,Math.floor(budget/2));
        table.style.setProperty('--editor-table-height',`${shared}px`);
        thermal.style.setProperty('--thermal-editor-table-height',`${shared}px`);
      }else{
        if(thermal)thermal.style.removeProperty('--thermal-editor-table-height');
        // The original full-height Positions calculation when Uij is closed.
        const remaining=Math.max(0,panel.getBoundingClientRect().bottom-rect.bottom);
        const available=Math.floor(rightBottom-rect.top-remaining-10);
        table.style.setProperty('--editor-table-height',`${Math.max(132,available)}px`);
      }
    }
  });
}
function prepareStructureTableHeightSync(){
  if(document.documentElement.dataset.structureTableHeightBound)return;
  document.documentElement.dataset.structureTableHeightBound='1';
  window.addEventListener('resize',requestStructureTableHeightSync);
  $('cifAtomDetailed')?.addEventListener('toggle',requestStructureTableHeightSync);
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(requestStructureTableHeightSync);
    for(const el of ['mcifStructurePane','cifGeneratorPanel'].map($).filter(Boolean))observer.observe(el);
  }
  requestStructureTableHeightSync();
}
function prepareStructureViewerControls(){
  ensureStructureViewerStyle();
  const viewButtons=[...document.querySelectorAll("[data-cif-structure-view]")];
  const viewButtonParents=[...new Set(viewButtons.map(button=>button.parentElement).filter(Boolean))];
  if(viewButtons.length===6 && viewButtonParents.length===1) viewButtonParents[0].classList.add("structure-view-buttons-six");
  for(const axis of ["x","y","z"]) createSplitRangeControls(axis);
  const rangeWrappers=[...document.querySelectorAll(".structure-view-range-axis")];
  const rangeParents=[...new Set(rangeWrappers.map(wrapper=>wrapper.parentElement).filter(Boolean))];
  if(rangeWrappers.length===3 && rangeParents.length===1) rangeParents[0].classList.add("structure-view-range-grid");
  hideLegacyStructureColumnHeaders("cifAtomColorRows",["show","atom","marker","color"]);
  hideLegacyStructureColumnHeaders("cifBondRows",["atom1","atom2","range","width","color"]);
  for(const button of document.querySelectorAll("[data-structure-config-tab]")){
    const active=button.dataset.structureConfigTab===structureConfigActiveTab;
    button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));
  }
  for(const panel of document.querySelectorAll("[data-structure-config-panel]")){
    const active=panel.dataset.structureConfigPanel===structureConfigActiveTab;
    panel.classList.toggle("active",active);panel.hidden=!active;
  }
  for(const button of document.querySelectorAll("[data-structure-config-tab]")){
    if(button.dataset.structureTabBound) continue;
    button.dataset.structureTabBound="1";
    button.addEventListener("click",()=>{
      const key=button.dataset.structureConfigTab;
      structureConfigActiveTab=key;
      try{localStorage.setItem(STRUCTURE_EDITOR_TAB_KEY,key);}catch(_e){}
      saveStructureViewerState();
      for(const tab of document.querySelectorAll("[data-structure-config-tab]")){
        const active=tab===button; tab.classList.toggle("active",active); tab.setAttribute("aria-selected",active?"true":"false");
      }
      for(const panel of document.querySelectorAll("[data-structure-config-panel]")){
        const active=panel.dataset.structureConfigPanel===key; panel.classList.toggle("active",active); panel.hidden=!active;
      }
      requestStructureTableHeightSync();
    });
  }
  prepareStructureTableHeightSync();
  prepareGeneratorViewportHeightSync();
  bindStructureK1Inputs();
  refreshMomentPropagationVectorSelect();
  syncSpinModifyLock();
  const propagationSelect=$("cifMomentPropagationVector");
  if(propagationSelect && !propagationSelect.dataset.structureBound){
    propagationSelect.dataset.structureBound="1";
    propagationSelect.addEventListener("change",()=>{
      if(propagationSelect.value==="mcif") return;
      const n=Number(propagationSelect.value);
      structureMomentPropagationIndex=Number.isInteger(n)&&n>0?n:0;
      activateImportedMagneticEditing();
      if(structureSpinEditingMode==='individual'){
        for(const [key,value] of currentMomentSettings())structureMomentSettings.set(key,value);
        $('cifMagMomentRows')?.replaceChildren();
        updateMagneticMomentRows(currentStructureForViewer()?.structure||null);
      }
      saveStructureViewerState();
      renderCifStructureIfVisible();
    });
  }
  const structureTypeSelect=$("cifMomentStructureType");
  const axisSelect=$("cifMomentRotationAxis");
  const chiralitySelect=$("cifMomentChirality");
  const bulkSpinToggle=$("cifSpinBulkCheckbox");
  if(bulkSpinToggle&&!bulkSpinToggle.dataset.structureBound){
    bulkSpinToggle.dataset.structureBound="1";
    bulkSpinToggle.addEventListener("change",()=>setSpinEnabledForDisplayed(bulkSpinToggle.checked));
  }
  const spinTableElementSelect=$("cifSpinTableElement");
  if(spinTableElementSelect&&!spinTableElementSelect.dataset.structureBound){
    spinTableElementSelect.dataset.structureBound="1";
    spinTableElementSelect.addEventListener("change",()=>{
      structureSpinTableElement=spinTableElementSelect.value;
      updateMagneticMomentRows(currentStructureForViewer()?.structure||null);
      saveStructureViewerState();
    });
  }
  const editingSelect=$('cifSpinEditingMode');
  if(editingSelect){
    editingSelect.value=structureSpinEditingMode;
    editingSelect.disabled=false;
    if(!editingSelect.dataset.structureBound){
      editingSelect.dataset.structureBound='1';
      editingSelect.addEventListener('change',()=>{
        for(const [key,value] of currentMomentSettings())structureMomentSettings.set(key,value);
        structureSpinEditingMode=editingSelect.value==='individual'?'individual':'sites';
        if(structureSpinEditingMode==='individual' && structureSpinTableElement==='*'){
          const info=currentStructureForViewer()?.structure;
          structureSpinTableElement=structureElements(info).find(el=>DEFAULT_SPIN_ELEMENTS.has(String(el).toUpperCase()))||'*';
        }
        $('cifMagMomentRows')?.replaceChildren();
        updateMagneticMomentRows(currentStructureForViewer()?.structure||null);
        saveStructureViewerState();renderCifStructureIfVisible();
      });
    }
  }
  const directionSelect=$("cifMomentDirectionMode");
  const lengthInput=$("cifMomentGlobalLength");
  const widthInput=$("cifMomentGlobalWidth");
  const headInput=$("cifMomentGlobalHead");
  if(directionSelect){
    directionSelect.value=structureMomentDirectionMode;
    if(!directionSelect.dataset.structureBound){
      directionSelect.dataset.structureBound="1";
      directionSelect.addEventListener("change",()=>{
        const live=currentMomentSettings();
        for(const [key,value] of live) structureMomentSettings.set(key,value);
        structureMomentDirectionMode=directionSelect.value==="polar"?"polar":"cartesian";
        saveStructureViewerState();
        updateMagneticMomentRows(currentStructureForViewer()?.structure||null);
        renderCifStructureIfVisible();
      });
    }
  }
  if(lengthInput){
    lengthInput.value=String(structureMomentGlobalLength);
    if(!lengthInput.dataset.structureBound){
      lengthInput.dataset.structureBound="1";
      const commit=()=>{
        const raw=String(lengthInput.value||"").trim(), n=Number(raw);
        structureMomentGlobalLength=raw && Number.isFinite(n)?Math.max(0,n):1;
        saveStructureViewerState(); renderCifStructureIfVisible();
      };
      lengthInput.addEventListener("input",commit);
      lengthInput.addEventListener("change",commit);
    }
  }
  const bindGlobalArrowInput=(input,kind)=>{
    if(!input) return;
    const isWidth=kind==="width", defaultValue=isWidth?6:0.5;
    const blank=isWidth?structureMomentGlobalWidthBlank:structureMomentGlobalHeadBlank;
    input.value=blank?"":String(isWidth?structureMomentGlobalWidth:structureMomentGlobalHeadSize);
    input.placeholder=String(defaultValue);
    if(input.dataset.structureBound) return;
    input.dataset.structureBound="1";
    const commit=()=>{
      const raw=String(input.value||"").trim(); const n=Number(raw);
      if(isWidth){ structureMomentGlobalWidthBlank=!raw; structureMomentGlobalWidth=raw&&Number.isFinite(n)?Math.max(1,n):6; }
      else{ structureMomentGlobalHeadBlank=!raw; structureMomentGlobalHeadSize=raw&&Number.isFinite(n)?Math.max(0.01,n):0.5; }
      saveStructureViewerState(); renderCifStructureIfVisible();
    };
    input.addEventListener("input",commit); input.addEventListener("change",commit);
  };
  bindGlobalArrowInput(widthInput,"width");
  bindGlobalArrowInput(headInput,"head");
  const syncMomentStructureModeControls=()=>{
    const helical=structureMomentStructureType==="helical";
    if(axisSelect) axisSelect.disabled=false;
    if(chiralitySelect) chiralitySelect.disabled=false;
  };
  if(structureTypeSelect){
    syncImportedMomentStructureType();
    if(!structureTypeSelect.dataset.structureBound){
      structureTypeSelect.dataset.structureBound="1";
      structureTypeSelect.addEventListener("change",()=>{
        const requestedType=structureTypeSelect.value;
        activateImportedMagneticEditing();
        structureMomentStructureType=["collinear","helical","sinusoidal"].includes(requestedType)?requestedType:"collinear";
        syncMomentStructureModeControls();
        saveStructureViewerState();
        renderCifStructureIfVisible();
      });
    }
  }
  if(axisSelect){
    axisSelect.value=sourceIsMagneticCif() && !importedMagneticEditMode ? "mcif" : structureMomentRotationAxis;
    if(!axisSelect.dataset.structureBound){
      axisSelect.dataset.structureBound="1";
      axisSelect.addEventListener("change",()=>{
        const requestedAxis=axisSelect.value;
        activateImportedMagneticEditing();
        structureMomentRotationAxis=["a","b","c"].includes(requestedAxis)?requestedAxis:"c";
        saveStructureViewerState();
        renderCifStructureIfVisible();
      });
    }
  }
  if(chiralitySelect){
    chiralitySelect.value=sourceIsMagneticCif() && !importedMagneticEditMode ? "mcif" : structureMomentChirality;
    if(!chiralitySelect.dataset.structureBound){
      chiralitySelect.dataset.structureBound="1";
      chiralitySelect.addEventListener("change",()=>{
        const requestedChirality=chiralitySelect.value;
        activateImportedMagneticEditing();
        structureMomentChirality=requestedChirality==="CW"?"CW":"CCW";
        saveStructureViewerState();
        renderCifStructureIfVisible();
      });
    }
  }
  syncMomentStructureModeControls();
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
  const camera=currentStructureCamera();
  const previousCamera=plot.layout?.scene?.camera;
  if(camera && plot.layout?.scene) plot.layout.scene.camera=copyStructureCamera(camera);
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
  const source=currentStructureForViewer();
  syncImportedMomentStructureType();
  if(!source?.structure){ status.textContent="No CIF structure is available yet. Load/select a CIF or enter a valid CIF Generator structure."; Plotly.purge(plot); return; }
  const basis=directLatticeBasis(source.structure.lattice);
  if(!basis){ status.textContent="The CIF lattice parameters are invalid, so the structure view cannot be drawn."; Plotly.purge(plot); return; }
  // A browser OOM can kill JS without running an error handler. Leave an
  // in-progress marker until this Plotly render completes successfully.
  window.__tasStructureCrashGuard?.begin();
  syncStructureControlRows(source.structure);
  const range=structureRange();
  if(estimateStructureReplicationTests(source.structure,range)>STRUCTURE_MAX_REPLICATION_TESTS){
    status.textContent='Structure not drawn: display range is too large. Reduce X/Y/Z repeat ranges.';
    Plotly.purge(plot);window.__tasStructureCrashGuard?.complete();return;
  }
  const atoms=replicatedAtoms(source.structure,range);
  if(atoms.length>STRUCTURE_MAX_DISPLAYED_ATOMS){
    status.textContent=`Structure not drawn: more than ${STRUCTURE_MAX_DISPLAYED_ATOMS} displayed atoms. Reduce X/Y/Z repeat ranges.`;
    Plotly.purge(plot);window.__tasStructureCrashGuard?.complete();return;
  }
  if(!atoms.length){ status.textContent="The current CIF contains no atoms to display."; Plotly.purge(plot);window.__tasStructureCrashGuard?.complete(); return; }
  const displayedAtoms=atoms.filter(atomIsVisible);
  const selectedPositionSites=selectedPositionSourceSiteIndices(source.structure);
  let highlighted=displayedAtoms.filter(atom=>
    selectedSpinContainsAtom(atom) || selectedPositionContainsAtom(atom,selectedPositionSites) ||
    selectedAppearanceContainsAtom(atom));
  if(!selectedPositionSites.size && structureSpinEditingMode==='individual' && !spinEditingIsIndividual(source.structure)){
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
    const key=JSON.stringify([atom.element,atomDisplayColor(atom),atomDisplaySize(atom)]);
    if(!grouped.has(key))grouped.set(key,{element:String(atom.element),color:atomDisplayColor(atom),size:atomDisplaySize(atom),atoms:[]});
    grouped.get(key).atoms.push(atom);
  }
  const bondRules=readStructureBondRules();
  const maxCellDistance=styleCellDiagonalLimit(basis);
  const validRule=rule=>safeStyleDistances(rule.minDistance,rule.maxDistance,maxCellDistance);
  const oversizedRules=bondRules.filter(rule=>!validRule(rule));
  const drawableBondRules=bondRules.filter(validRule);
  const styleCutoffWarning=oversizedRules.length
    ?` ${oversizedRules.length} Style rule(s) not drawn: Max must not exceed the unit-cell diagonal (${maxCellDistance.toFixed(3)} Å). Edit Max; values are saved.`
    :'';
  const parentFrame=updateStructureUnitCellReference(source);
  const cellFrame=structureUnitCellFrame(source,basis,range,parentFrame);
  const cellTraces=unitCellTraces(cellFrame.basis,cellFrame.range);
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
    const bondLines=bondTraces(displayedAtoms,basis,bondRulesForDraw);
    bondWarning=bondLines.warning||'';
    traces.push(...bondLines);
  }
  if(polyhedralRulesForDraw.length){
    const activeRules=polyhedralRulesForDraw;
    if(activeRules.length){
      // The local-search implementation visits only periodic images around
      // each actual A1 centre, independently of the size of the displayed cell.
      const mesh=coordinationPolyhedralTraces(displayedAtoms,source.structure,basis,activeRules);
      polyhedralWarning=mesh.warning;
      traces.push(...mesh.traces);
    }
  }
  const orderedElements=structureElements(source.structure);
  const shownElements=new Set();
  for(const group of grouped.values()){
    const {element,color,size,atoms:list}=group;
    const xs=[],ys=[],zs=[],texts=[];
    for(const atom of list){
      const cart=fractionalToCartesian(basis,[atom.x,atom.y,atom.z]);
      xs.push(cart[0]);ys.push(cart[1]);zs.push(cart[2]);
      // Put the selection status on the ORIGINAL atom hover label, not on the
      // outline trace. The ring should never hide the site coordinates.
      const selectionSuffix=highlightedAtomSet.has(atom)?' (selected)':'';
      texts.push(`${atom.sourceLabel||element}${selectionSuffix}<br>frac=(${atom.x.toFixed(3)}, ${atom.y.toFixed(3)}, ${atom.z.toFixed(3)})`);
    }
    traces.push({type:"scatter3d",mode:"markers",name:element,showlegend:!shownElements.has(element),x:xs,y:ys,z:zs,text:texts,hovertemplate:"%{text}<extra></extra>",marker:{size,color,line:{color:"#333",width:0.8},opacity:0.92}});
    shownElements.add(element);
  }
  updateStructureAtomLegend(orderedElements.filter(element=>shownElements.has(element)));
  // Selection outlines belong only to the viewer, never to magnetic calculations.
  // Draw a complementary-color ring around each selected atom, retaining the
  // original stroke width and small gap around the atom's surface.
  const magneticOverlays=magneticStructureTraces(displayedAtoms,basis,source.structure); traces.push(...magneticOverlays);
  const magneticSummary=enabledPropagationVectorsForStructure();
  const effectiveK=effectivePropagationVectorForStructure();
  const enabledMoments=[...currentMomentSettings().values()].filter(x=>x.enabled).length;
  status.textContent=`${source.label}: x ${range.x.min}–${range.x.max}, y ${range.y.min}–${range.y.max}, z ${range.z.min}–${range.z.max}; ${displayedAtoms.length} displayed atoms.`+
    (structureUnitCellMode!=='none' && source.structure.magnetic && !parentFrame ?
      ' Parent-cell setting unavailable: showing magnetic cell.':
      cellFrame.parent && structureUnitCellMode!=='none' ? ' Crystallographic unit cell shown.':
      source.structure.magnetic && structureUnitCellMode!=='none' ? ' Magnetic unit cell shown.':'')+
    (bondRules.length?` ${bondRules.length} bond rule${bondRules.length===1?"":"s"}.`:"")+
    (source.structure.magnetic?" mCIF moments from magnetic symmetry/Fourier modulation.":enabledMoments?` ${enabledMoments} magnetic site setting${enabledMoments===1?"":"s"}; ${structureMomentStructureType}${structureMomentStructureType==="helical"?` about ${structureMomentRotationAxis} (${structureMomentChirality})`:""}, k${effectiveK.index||1}=(${effectiveK.h}, ${effectiveK.k}, ${effectiveK.l})${effectiveK.count>1?" (selected propagation vector)":""}.`:"")+ (polyhedralWarning ? ` ${polyhedralWarning}` : "")+
    (bondWarning ? ` ${bondWarning}` : "")+(cellTraces.warning||'')+styleCutoffWarning;
  // Keep an explicit camera state independent of Plotly.react.  This prevents
  // later redraws (including range edits) from restoring the view-button camera
  // after the user has already rotated or zoomed the structure.
  const liveCamera=currentStructureCamera();
  const mainCamera=copyStructureCamera(structureCameraState) || liveCamera || structureCameraForView(cifStructureViewMode,basis,currentStructureCameraDistance());
  structureCameraState=copyStructureCamera(mainCamera);
  // A thicker complementary-color ring, with its INNER edge at about 1.5x
  // the displayed atom radius (i.e. a visible gap even with the thicker line).
  // Plotly marker.size specifies diameter, so add the ring stroke once to the
  // target inner diameter. This tracks site-specific changes in atom size.
  if(highlighted.length){
    const selectionOutlineWidth=9;
    const x=[],y=[],z=[],sizes=[],outlineColors=[];
    for(const atom of highlighted){
      const cart=fractionalToCartesian(basis,[atom.x,atom.y,atom.z]);
      x.push(cart[0]);y.push(cart[1]);z.push(cart[2]);
      const atomDiameter=Math.max(2,Number(atomDisplaySize(atom))||10);
      sizes.push(1.5*atomDiameter+selectionOutlineWidth);
      outlineColors.push(complementaryAtomOutlineColor(atomDisplayColor(atom)));
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
    scene:{aspectmode:"data",dragmode:"orbit",xaxis:{visible:structureShowXYZ,title:{text:"x (Å)",font:{size:18,color:"#222"}},showticklabels:structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},yaxis:{visible:structureShowXYZ,title:{text:"y (Å)",font:{size:18,color:"#222"}},showticklabels:structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},zaxis:{visible:structureShowXYZ,title:{text:"z (Å)",font:{size:18,color:"#222"}},showticklabels:structureShowXYZ,tickfont:{size:structureTickFontSize},ticks:"outside",showline:true,linecolor:"#666",backgroundcolor:"#fafafa",gridcolor:"#e5e5e5",zerolinecolor:"#ccc"},camera:mainCamera},
    // Changing a view preset must supersede Plotly's saved interactive camera.
    // Other redraws keep the revision and preserve the current manual rotation.
    uirevision:`cif-structure-interactive-${structureCameraPresetRevision}`
  };
  stopStructureCameraWatch();
  structureProgrammaticCameraUpdate=true;
  const renderRevision=++structureCameraRenderRevision;
  const renderResult=Plotly.react(plot,traces,layout,{displaylogo:false,responsive:true,scrollZoom:true});
  if(plot._context) plot._context.scrollZoom=true;
  updateStructureOrientationTriads(basis,mainCamera);
  Promise.resolve(renderResult).then(()=>{
    if(renderRevision!==structureCameraRenderRevision) return;
    window.__tasStructureCrashGuard?.complete();
    structureProgrammaticCameraUpdate=false;
    const camera=currentStructureCamera() || mainCamera;
    structureCameraState=copyStructureCamera(camera);
    updateStructureOrientationTriads(basis,camera);
    startStructureCameraWatch();
  }).catch(()=>{
    if(renderRevision===structureCameraRenderRevision) structureProgrammaticCameraUpdate=false;
  });
  if(!plot._structureCameraBound && typeof plot.on==="function"){
    plot._structureCameraBound=true;
    const syncTriadsFromCamera=camera=>{
      const copied=copyStructureCamera(camera);
      if(!copied) return;
      structureCameraState=copied;
      const latest=directLatticeBasis(currentStructureForViewer()?.structure?.lattice) || basis;
      updateStructureOrientationTriads(latest,copied);
    };
    const syncTriadsFromLiveCamera=()=>{
      const copied=currentStructureCamera();
      if(copied) syncTriadsFromCamera(copied);
    };
    const onCameraMotion=ev=>{
      if(structureProgrammaticCameraUpdate) return;
      // Prefer the live camera over relayout payloads, which can lag one frame.
      const live=currentStructureCamera();
      const eventCamera=cameraFromRelayoutEvent(ev);
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

function setCifGeneratedReady(ready){
  const mcif=$("cifOutputFormat")?.value==="mcif";
  const hasGeneratedText=mcif ? !!lastGeneratedMcifText : !!lastGeneratedCifText;
  const canUse=ready && hasGeneratedText;
  if($("cifOutputDownload")) $("cifOutputDownload").disabled=!canUse;
  if($("cifOutputSet")) $("cifOutputSet").disabled=!canUse;
  // Reflection CSV availability is independent of CIF Generate.  A selected
  // CIF/mCIF can provide reflections without generating any new CIF file.
}

function clearCifReflectionTable(message="No reflections available."){
  lastGeneratedReflections=[];
  if($("cifDownloadTable")) $("cifDownloadTable").disabled=true;
  const body=$("cifReflectionRows");
  if(body){
    body.replaceChildren();
    const tr=document.createElement("tr"), td=document.createElement("td");
    td.colSpan=7; td.className="cif-reflection-empty"; td.textContent=message;
    tr.appendChild(td); body.appendChild(tr);
  }
  if($("cifReflectionSummary")) $("cifReflectionSummary").textContent=message;
}

function invalidateGeneratedCif(message="Inputs changed — press Generate to refresh the CIF."){
  lastGeneratedCifText="";
  lastGeneratedCifParsed=null;
  lastGeneratedCifSpaceGroup=null;
  invalidateGeneratedMcif();
  setCifGeneratedReady(false);
  if($("cifPreview")) $("cifPreview").textContent="Press Generate to preview the CIF.";
  // Keep Nuclear Reflections tied to the currently loaded CIF/mCIF even while
  // the draft Nuclear editor is being changed.  No Generate is needed.
  recalculateGeneratedReflections();
  if(message) setCifGeneratorMessage(message);
  renderCifStructureIfVisible();
}

function setCifGeneratorMessage(text,isError=false){
  const box=$("cifGeneratorMessage");
  if(!box) return;
  // Routine load/generate notifications must not fill space under Atomic
  // positions. Keep actionable errors near the Generate/Download controls.
  box.textContent=isError ? (text || "") : "";
  box.classList.toggle("error-text",!!isError);
  box.classList.toggle("hidden",!(isError && text));
}

const CIF_LATTICE_FIELDS={a:"cifA",b:"cifB",c:"cifC",alpha:"cifAlpha",beta:"cifBeta",gamma:"cifGamma"};

function selectedCifGeneratorSpaceGroup(){
  const n=Number($("cifSpaceGroup")?.value);
  return cifSpaceGroups.find(x=>x.number===n) || null;
}

// The bundled standard-setting data calls #143–167 trigonal.  For the
// requested System selector, P-centered trigonal groups join the hexagonal
// lattice family; R-centered groups are classified as rhombohedral.
// "Custom" is P1 only: no imposed space-group symmetry (VESTA-style).
function cifSpaceGroupSystem(sg){
  const crystalSystem=String(sg?.crystal_system||"").toLowerCase();
  if(crystalSystem==="trigonal"){
    return centeringFromSpaceGroup(sg)==="R" ? "rhombohedral" : "hexagonal";
  }
  return crystalSystem;
}

function cifSystemIncludesSpaceGroup(system,sg){
  return system==="custom" ? sg.number===1 : cifSpaceGroupSystem(sg)===system;
}

// Rebuild the list rather than hiding <option> nodes, which do not filter
// consistently in native <select> controls on all browsers.
function populateCifSpaceGroupOptions(requestedNumber,{adaptSystem=false}={}){
  const select=$("cifSpaceGroup"),systemInput=$("cifCrystalSystem");
  if(!select || !cifSpaceGroups.length) return null;
  const wanted=cifSpaceGroups.find(sg=>sg.number===Number(requestedNumber));
  let system=systemInput?.value||"custom";
  if(adaptSystem && wanted && !cifSystemIncludesSpaceGroup(system,wanted)){
    system=cifSpaceGroupSystem(wanted);
    if(systemInput) systemInput.value=system;
  }
  const matching=cifSpaceGroups.filter(sg=>cifSystemIncludesSpaceGroup(system,sg));
  select.replaceChildren();
  for(const sg of matching){
    const option=document.createElement("option");
    option.value=String(sg.number);
    option.textContent=`${sg.number} — ${sg.hm}`;
    select.appendChild(option);
  }
  const selected=wanted && cifSystemIncludesSpaceGroup(system,wanted) ? wanted : matching[0];
  if(selected) select.value=String(selected.number);
  syncCifSpaceGroupNumberFromSelect();
  return selected||null;
}

function selectCifSpaceGroup(number,{syncSystem=false}={}){
  const sg=cifSpaceGroups.find(entry=>entry.number===Number(number));
  const select=$("cifSpaceGroup"),systemInput=$("cifCrystalSystem");
  if(!sg || !select) return null;
  // A loaded CIF/mCIF defines its own crystal system, even when the picker
  // currently shows Custom (which is restricted to P1).
  // Rebuild the filtered options as well as updating the System label.
  if(syncSystem){
    if(systemInput) systemInput.value=cifSpaceGroupSystem(sg);
    return populateCifSpaceGroupOptions(sg.number);
  }
  const system=systemInput?.value||"custom";
  // Sample-cell edits synchronize continuously; avoid rebuilding hundreds of
  // options unless the selected group is actually outside the current filter.
  if(cifSystemIncludesSpaceGroup(system,sg) &&
     [...select.options].some(option=>option.value===String(sg.number))){
    select.value=String(sg.number);
    syncCifSpaceGroupNumberFromSelect();
    return sg;
  }
  return populateCifSpaceGroupOptions(number,{adaptSystem:true});
}

function syncCifSpaceGroupNumberFromSelect(){
  const n=Number($("cifSpaceGroup")?.value);
  const entry=$("cifSpaceGroupNumber");
  if(entry && Number.isInteger(n)) entry.value=String(n);
}

function jumpToCifSpaceGroupNumber(){
  const entry=$("cifSpaceGroupNumber");
  const select=$("cifSpaceGroup");
  if(!entry || !select) return;
  const n=readSpaceGroupInteger(entry,Number(select.value)||1);
  if(n===null) return;
  const sg=cifSpaceGroups.find(x=>x.number===n);
  if(!sg){
    setCifGeneratorMessage(`Space group #${n} is not available.`,true);
    return;
  }
  selectCifSpaceGroup(n);
  updateCifSpaceGroupInfo();
}

function applyCifLatticeConstraints(magnetic=false){
  const sg=magnetic ? selectedMagneticCellSpaceGroup() : selectedCifGeneratorSpaceGroup();
  if(!sg) return;
  const latticeFields=magnetic ? CIF_MAG_LATTICE_FIELDS : CIF_LATTICE_FIELDS;
  const inputs=Object.fromEntries(Object.entries(latticeFields).map(([key,id])=>[key,$(id)]));
  for(const input of Object.values(inputs)){
    if(!input) continue;
    input.readOnly=false;
    input.removeAttribute("aria-readonly");
    input.title="";
  }
  const lockValue=(key,value,reason)=>{
    const input=inputs[key]; if(!input) return;
    input.value=String(value); input.readOnly=true; input.setAttribute("aria-readonly","true"); input.title=reason;
  };
  const lockEqual=(key,sourceKey,reason)=>{
    const source=Number(inputs[sourceKey]?.value);
    if(Number.isFinite(source)) lockValue(key,source,reason);
  };
  const cs=String(sg.crystal_system||"").toLowerCase();
  if(cs==="monoclinic"){
    lockValue("alpha",90,"Fixed by the standard monoclinic setting.");
    lockValue("gamma",90,"Fixed by the standard monoclinic setting.");
  }else if(cs==="orthorhombic"){
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by orthorhombic symmetry.");
  }else if(cs==="tetragonal"){
    lockEqual("b","a","b = a by tetragonal symmetry.");
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by tetragonal symmetry.");
  }else if(cs==="trigonal" || cs==="hexagonal"){
    // The bundled standard settings use hexagonal axes for trigonal groups.
    lockEqual("b","a",`${cs==="trigonal"?"Trigonal (hexagonal setting)":"Hexagonal"} symmetry requires b = a.`);
    lockValue("alpha",90,"Fixed by the standard hexagonal-axis setting.");
    lockValue("beta",90,"Fixed by the standard hexagonal-axis setting.");
    lockValue("gamma",120,"Fixed by the standard hexagonal-axis setting.");
  }else if(cs==="cubic"){
    lockEqual("b","a","b = a by cubic symmetry.");
    lockEqual("c","a","c = a by cubic symmetry.");
    for(const k of ["alpha","beta","gamma"]) lockValue(k,90,"Fixed by cubic symmetry.");
  }
}

// Magnetic-cell controls are independent from the crystallographic cell.
// No change here is allowed to rewrite Sample or nuclear-reflection indices.
const CIF_MAG_LATTICE_FIELDS={a:'cifMagA',b:'cifMagB',c:'cifMagC',alpha:'cifMagAlpha',beta:'cifMagBeta',gamma:'cifMagGamma'};
const CIF_MAG_CELL_DRAFT_IDS=['cifMagCrystalSystem','cifMagSpaceGroupNumber','cifMagSpaceGroup',...Object.values(CIF_MAG_LATTICE_FIELDS)];
function selectedMagneticCellSpaceGroup(){
  return cifSpaceGroups.find(sg=>sg.number===Number($("cifMagSpaceGroup")?.value))||null;
}
function populateMagneticSpaceGroupOptions(requestedNumber,{adaptSystem=false}={}){
  const select=$("cifMagSpaceGroup"),systemInput=$("cifMagCrystalSystem");
  if(!select || !cifSpaceGroups.length)return null;
  const wanted=cifSpaceGroups.find(sg=>sg.number===Number(requestedNumber));
  let system=systemInput?.value||'custom';
  if(adaptSystem && wanted && !cifSystemIncludesSpaceGroup(system,wanted)){
    system=cifSpaceGroupSystem(wanted);
    if(systemInput)systemInput.value=system;
  }
  const matching=cifSpaceGroups.filter(sg=>cifSystemIncludesSpaceGroup(system,sg));
  select.replaceChildren();
  for(const sg of matching){
    const option=document.createElement('option');option.value=String(sg.number);
    option.textContent=`${sg.number} — ${sg.hm}`;select.appendChild(option);
  }
  const selected=wanted && cifSystemIncludesSpaceGroup(system,wanted)?wanted:matching[0];
  if(selected)select.value=String(selected.number);
  if($("cifMagSpaceGroupNumber") && selected)$("cifMagSpaceGroupNumber").value=String(selected.number);
  return selected||null;
}
function selectMagneticCellSpaceGroup(number,{syncSystem=false}={}){
  const sg=cifSpaceGroups.find(item=>item.number===Number(number));
  if(!sg)return null;
  const system=$("cifMagCrystalSystem");
  if(syncSystem && system)system.value=cifSpaceGroupSystem(sg);
  return populateMagneticSpaceGroupOptions(sg.number,{adaptSystem:!syncSystem});
}
function updateMagneticCellGroupInfo(){
  const sg=selectedMagneticCellSpaceGroup();
  if(!sg)return;
  if($("cifMagSpaceGroupNumber"))$("cifMagSpaceGroupNumber").value=String(sg.number);
  applyCifLatticeConstraints(true);
}
function saveMagneticCellDraft(){
  if(restoringCifStartup || !getSelectedCifStructure()?.magnetic)return;
  const values={};
  for(const id of CIF_MAG_CELL_DRAFT_IDS)values[id]=$(id)?.value??'';
  try{localStorage.setItem(CIF_MAGNETIC_CELL_STORAGE_KEY,JSON.stringify({version:1,sourceKey:currentEditorSourceKey(),values}));}catch(_e){}
}
function restoreMagneticCellDraft(){
  if(!getSelectedCifStructure()?.magnetic)return false;
  let saved;
  try{saved=JSON.parse(localStorage.getItem(CIF_MAGNETIC_CELL_STORAGE_KEY)||'null');}catch(_e){return false;}
  if(saved?.version!==1 || saved.sourceKey!==currentEditorSourceKey())return false;
  const values=saved.values||{};
  const n=Number(values.cifMagSpaceGroup);
  if(Number.isInteger(n)&&n>=1&&n<=230)selectMagneticCellSpaceGroup(n,{syncSystem:true});
  for(const id of Object.values(CIF_MAG_LATTICE_FIELDS)){
    if($(id) && Object.hasOwn(values,id))$(id).value=String(values[id]);
  }
  // Restore an editing draft without forcing a new cell constraint that
  // could silently overwrite the user's last typed lattice values.
  return true;
}
function bindMagneticCellEditor(){
  const system=$("cifMagCrystalSystem"),number=$("cifMagSpaceGroupNumber");
  system?.addEventListener('change',()=>{
    populateMagneticSpaceGroupOptions(Number($("cifMagSpaceGroup")?.value)||1);
    updateMagneticCellGroupInfo();saveMagneticCellDraft();renderCifStructureIfVisible();
  });
  $("cifMagSpaceGroup")?.addEventListener('change',()=>{
    updateMagneticCellGroupInfo();saveMagneticCellDraft();renderCifStructureIfVisible();
  });
  bindSpaceGroupIntegerEntry(number);
  const selectByNumber=()=>{
    const n=readSpaceGroupInteger(number,Number($("cifMagSpaceGroup")?.value)||1);
    if(n===null)return;
    if(!selectMagneticCellSpaceGroup(n,{syncSystem:true})){
      setCifGeneratorMessage(`Magnetic space group #${n} is not available.`,true);return;
    }
    updateMagneticCellGroupInfo();saveMagneticCellDraft();renderCifStructureIfVisible();
  };
  number?.addEventListener('change',selectByNumber);
  number?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();selectByNumber();}});
  for(const id of Object.values(CIF_MAG_LATTICE_FIELDS)){
    const field=$(id);
    field?.addEventListener('input',saveMagneticCellDraft);
    field?.addEventListener('change',()=>{
      updateMagneticCellGroupInfo();saveMagneticCellDraft();renderCifStructureIfVisible();
    });
  }
}

function copyCurrentLatticeToGenerator(){
  // Copy the Sample's space group as well as its metric.  Updating the space
  // group before applying constraints ensures the two sections use the same
  // standard crystal-system setting (a=b, gamma=120, etc.).
  const sg=selectedSampleSpaceGroup();
  if(sg) selectCifSpaceGroup(sg.number);
  const map={cifA:"a",cifB:"b",cifC:"c",cifAlpha:"alpha",cifBeta:"beta",cifGamma:"gamma"};
  for(const [dst,src] of Object.entries(map)){
    const source=$(src);
    if(!source || !String(source.value).trim()) continue;
    const v=Number(source.value);
    if(Number.isFinite(v) && $(dst)) $(dst).value=String(v);
  }
  updateCifSpaceGroupInfo();
}

function updateCifSpaceGroupInfo(){
  // The redundant text description was removed from the UI. Keep the number
  // field and metric constraints synchronized with the selected group.
  const sg=selectedCifGeneratorSpaceGroup();
  if(!sg) return;
  syncCifSpaceGroupNumberFromSelect();
  applyCifLatticeConstraints();
}

function refreshCifAtomRowIndices(){
  const host=$("cifAtomRows");
  if(!host) return;
  [...host.querySelectorAll(".cif-atom-row")].forEach((row,i)=>{
    const cell=row.querySelector(".cif-atom-index");
    if(cell) cell.textContent=String(i+1);
  });
}

// Atomic Positions displays at most five decimal places, but the full
// numeric value remains available to CIF generation and local draft storage.
// A user edit replaces the original value immediately; merely focusing or
// changing the display precision must never round the source coordinates.
function cifPositionInputValue(input){
  if(!input) return "";
  if(input.dataset.cifDisplayedValue===input.value &&
     input.dataset.cifPreciseValue!==undefined) return input.dataset.cifPreciseValue;
  return input.value;
}
function formatCifPositionInput(input,raw=cifPositionInputValue(input)){
  if(!input) return;
  const parsed=parseNumericValue(raw);
  if(!Number.isFinite(parsed)) return;
  const precise=String(parsed);
  const formatted=String(Number(parsed.toFixed(5)));
  input.dataset.cifPreciseValue=precise;
  input.value=formatted;
  input.dataset.cifDisplayedValue=input.value;
}

function validateCifAtomNumericInput(input){
  if(!input || !["x","y","z","occupancy","Biso"].includes(input.dataset.cifAtomField)) return true;
  const raw=String(cifPositionInputValue(input)??"").trim();
  const n=parseNumericValue(raw);
  const valid=raw!=="" && Number.isFinite(n) &&
    (input.dataset.cifAtomField!=="occupancy" || (n>=0 && n<=1)) &&
    (input.dataset.cifAtomField!=="Biso" || n>=0);
  input.classList.toggle("cif-invalid-number",!valid);
  input.setAttribute("aria-invalid",valid?"false":"true");
  return valid;
}

// Position Display filters only the visible editor rows, never atom data.
function refreshPositionTableToolbar(){
  const mode=$('cifPositionEditingMode'),filter=$('cifPositionTableElement');
  if(mode)mode.value=structurePositionEditingMode;
  if(filter){
    const elements=[...new Set(currentCifGeneratorAtomRows().map(a=>normalizeCifElement(a.element)).filter(Boolean))].sort();
    if(structurePositionTableElement!=='*'&&!elements.includes(structurePositionTableElement))structurePositionTableElement='*';
    filter.replaceChildren();
    for(const [value,label] of [['*','All elements'],...elements.map(el=>[el,el])]){
      const opt=document.createElement('option');opt.value=value;opt.textContent=label;filter.appendChild(opt);
    }
    filter.value=structurePositionTableElement;
  }
  for(const row of document.querySelectorAll('#cifAtomRows .cif-atom-row')){
    const element=normalizeCifElement(row.querySelector('[data-cif-atom-field="element"]')?.value);
    const visible=structurePositionTableElement==='*'||element===structurePositionTableElement;
    row.hidden=!visible; row.style.display=visible?'':'none';
    const paired=document.querySelector(`#cifAtomDetailedRows [data-cif-atom-uid="${row.dataset.cifAtomUid}"]`);
    if(paired){paired.hidden=!visible;paired.style.display=visible?'':'none';}
  }
}
function positionSymmetryDraftSignature(){
  return JSON.stringify({sg:Number($('cifSpaceGroup')?.value),
    cell:Object.values(CIF_LATTICE_FIELDS).map(id=>$(id)?.value),
    atoms:currentCifGeneratorAtomRows()});
}
function expandPositionDraftToIndividual(){
  // Called while still in Symmetry mode, so buildGeneratedCif() uses the
  // selected space group to create the correct, deduplicated unit-cell orbit.
  const parsed=buildGeneratedCif().parsed;
  const sourceRows=currentCifGeneratorAtomRows();
  const atoms=parsed?.atoms||[];
  if(!atoms.length)throw new Error('No symmetry-expanded atomic positions are available.');
  if(atoms.length>1500)throw new Error('Manual editor limit: 1500 atoms. Reduce the sites or use Symmetry operations.');
  return atoms.map(atom=>{
    const parent=sourceRows[atom.sourceSiteIndex]||{};
    return {element:atom.element,x:atom.x,y:atom.y,z:atom.z,
      occupancy:atom.occupancy??parent.occupancy??1,Biso:atom.Biso??parent.Biso??0,
      // The displayed per-atom Uij starts from the source. The original
      // independent site's Uij remains untouched in Symmetry mode.
      Uaniso:atom.Uaniso??parent.Uaniso??null};
  });
}
function changePositionEditingMode(mode){
  mode=mode==='individual'?'individual':'sites';
  if(mode===structurePositionEditingMode)return;
  const sourceMode=structurePositionEditingMode;
  // Recompute symmetry expansion if the space group, lattice or
  // asymmetric-site draft has changed since the Manual snapshot was made.
  const sourceSignature=mode==='individual'?positionSymmetryDraftSignature():null;
  let next=positionModeDrafts[mode];
  if(mode==='individual'&&positionManualSourceSignature!==sourceSignature)next=null;
  if(!next){
    if(mode==='individual'){
      try{next=expandPositionDraftToIndividual();}
      catch(err){const select=$('cifPositionEditingMode');if(select)select.value=sourceMode;
        window.alert(err?.message||String(err));return;}
      positionManualSourceSignature=sourceSignature;
    }else next=positionModeDrafts.sites||currentCifGeneratorAtomRows();
  }
  positionModeDrafts[sourceMode]=currentCifGeneratorAtomRows();
  structurePositionEditingMode=mode;
  // Do not switch the Structure source to a P1 draft merely by expanding
  // symmetry equivalents in the table. This previously halved the mCIF view.
  const previous=structurePositionTableElement;
  restoringCifGeneratorAtoms=true;
  try{replaceCifAtomRows(next);}finally{restoringCifGeneratorAtoms=false;}
  structurePositionTableElement=previous;
  clearCifAtomRowSelection();
  refreshPositionTableToolbar();
  saveCifGeneratorAtomsState();
  // Mode only changes editor and appearance grouping, never geometry/reflect.
  const source=currentStructureForViewer();
  if(source?.structure)updateStructureAtomColorRows(structureElements(source.structure),source.structure);
  renderCifStructureIfVisible();
  requestStructureTableHeightSync();
}
function initializePositionTableToolbar(){
  const mode=$('cifPositionEditingMode'),display=$('cifPositionTableElement');
  if(mode&&!mode.dataset.bound){mode.dataset.bound='1';mode.addEventListener('change',()=>changePositionEditingMode(mode.value));}
  if(display&&!display.dataset.bound){display.dataset.bound='1';display.addEventListener('change',()=>{
    structurePositionTableElement=display.value;
    clearCifAtomRowSelection();refreshPositionTableToolbar();saveCifGeneratorAtomsState();
  });}
  refreshPositionTableToolbar();
}

// Script-style atom-row selection. The selection lives only in the UI;
// stable row IDs keep the paired Uij data with each atom.
let cifAtomSelectionAnchor=null;
function cifSelectedAtomRows(){
  return [...document.querySelectorAll("#cifAtomRows .cif-atom-row.cif-atom-selected")];
}
function setCifAtomRowSelection(row, event={}){
  const rows=[...document.querySelectorAll("#cifAtomRows .cif-atom-row")];
  const idx=rows.indexOf(row);
  if(idx<0) return;
  const multi=!!(event.ctrlKey||event.metaKey);
  if(event.shiftKey){
    const anchorIndex=rows.findIndex(r=>r.dataset.cifAtomUid===cifAtomSelectionAnchor);
    const start=anchorIndex>=0?anchorIndex:idx;
    if(!multi) rows.forEach(r=>r.classList.remove("cif-atom-selected"));
    for(let i=Math.min(start,idx);i<=Math.max(start,idx);i++) rows[i].classList.add("cif-atom-selected");
  }else if(multi){
    row.classList.toggle("cif-atom-selected");
    cifAtomSelectionAnchor=row.dataset.cifAtomUid;
  }else{
    const wasSelected=row.classList.contains('cif-atom-selected');
    rows.forEach(r=>r.classList.remove('cif-atom-selected'));
    if(!wasSelected){row.classList.add('cif-atom-selected');cifAtomSelectionAnchor=row.dataset.cifAtomUid;}
    else cifAtomSelectionAnchor=null;
  }
  refreshCifAtomSelectionUI();
  renderCifStructureIfVisible();
}
function clearCifAtomRowSelection(){
  if(!cifSelectedAtomRows().length) return;
  for(const row of cifSelectedAtomRows()) row.classList.remove('cif-atom-selected');
  cifAtomSelectionAnchor=null;
  refreshCifAtomSelectionUI();
  renderCifStructureIfVisible();
}
function refreshCifAtomSelectionUI(){
  const selected=new Set(cifSelectedAtomRows().map(r=>r.dataset.cifAtomUid));
  document.querySelectorAll("#cifAtomDetailedRows .cif-thermal-row").forEach(r=>{
    r.classList.toggle("cif-atom-selected",selected.has(r.dataset.cifAtomUid));
  });
  const count=selected.size;
  for(const id of ["cifCopyAtom","cifRemoveAtom"]){
    const btn=$(id); if(btn) btn.disabled=count===0;
  }

}
// Positions selections refer to asymmetric-site rows, not already expanded
// atoms. Resolve against the actual Structure source before highlighting so a
// loaded CIF, an mCIF, and an edited generator draft use the same rules.
function selectedPositionSourceSiteIndices(structure){
  const selected=cifSelectedAtomRows();
  const appearance=parentAppearanceOrbits(structure);
  const sites=appearance?.sites||structure?.asymmetricSites||[];
  if(!selected.length || !sites.length)return new Set();
  const matches=(row,site)=>{
    const get=field=>cifPositionInputValue(row.querySelector(`[data-cif-atom-field="${field}"]`));
    if(normalizeCifElement(get('element'))!==normalizeCifElement(site.element))return false;
    for(const coordinate of ['x','y','z']){
      const a=parseNumericValue(get(coordinate)),b=Number(site[coordinate]);
      if(!Number.isFinite(a)||!Number.isFinite(b))return false;
      const delta=Math.abs(a-b);
      if(Math.min(delta,Math.abs(delta-Math.round(delta)))>2e-4)return false;
    }
    return true;
  };
  const rows=[...document.querySelectorAll('#cifAtomRows .cif-atom-row')];
  const indices=new Set();
  for(const row of selected){
    const index=rows.indexOf(row);
    if(index>=0 && sites[index] && matches(row,sites[index])){
      indices.add(index);
      continue;
    }
    // A loaded structure can reorder its asymmetric sites. Prefer a unique
    // coordinate/element match instead of highlighting an unrelated atom.
    const equivalent=sites.map((site,i)=>matches(row,site)?i:-1).filter(i=>i>=0);
    if(equivalent.length===1) indices.add(equivalent[0]);
  }
  if(appearance){
    const source=new Set();
    const exact=(a,b)=>a.every((x,i)=>Math.abs(x-b[i]-Math.round(x-b[i]))<2e-4);
    if(structurePositionEditingMode==='individual'){
      // In Manual, highlight the chosen expanded atom rather than its whole
      // crystallographic orbit (including translated magnetic-cell images).
      for(const row of selected){
        const field=k=>parseNumericValue(cifPositionInputValue(row.querySelector(`[data-cif-atom-field="${k}"]`)));
        const coords=['x','y','z'].map(field);
        const el=normalizeCifElement(row.querySelector('[data-cif-atom-field="element"]')?.value);
        if(!coords.every(Number.isFinite))continue;
        for(const [index,site] of (structure.asymmetricSites||[]).entries()){
          const xyz=['x','y','z'].map((k,i)=>Number(site[k])*appearance.replication[i]);
          if(el===normalizeCifElement(site.element) && exact(coords,xyz))source.add(index);
        }
      }
    }else for(const [index,orbit] of appearance.siteMap)if(indices.has(orbit))source.add(index);
    return source;
  }
  return indices;
}
function selectedPositionContainsAtom(atom,sourceIndices){
  if(!sourceIndices?.size)return false;
  return Number.isInteger(atom.sourceSiteIndex) && sourceIndices.has(atom.sourceSiteIndex);
}

// Drag from an index cell, as in Script. One selected row or a Ctrl/Shift
// selection moves together; the target can be above the first or below the last.
let cifAtomDragRows=null;
let cifAtomDropTarget=null;
function clearCifAtomDropMarker(){
  if(cifAtomDropTarget){
    cifAtomDropTarget.row.classList.remove("cif-atom-drop-before","cif-atom-drop-after");
    cifAtomDropTarget=null;
  }
}
function finishCifAtomDrag(){
  clearCifAtomDropMarker();
  document.querySelectorAll("#cifAtomRows .cif-atom-dragging").forEach(r=>r.classList.remove("cif-atom-dragging"));
  cifAtomDragRows=null;
}
function cifAtomDropPosition(event,row){
  const cell=row.querySelector(".cif-atom-index");
  const rect=cell?.getBoundingClientRect();
  return rect && event.clientY>=rect.top+rect.height/2 ? "after":"before";
}
function moveDraggedCifAtomRows(target,position){
  const host=$("cifAtomRows");
  if(!host || !cifAtomDragRows?.length || !target) return;
  const original=[...host.querySelectorAll(".cif-atom-row")];
  const moving=new Set(cifAtomDragRows);
  const rest=original.filter(row=>!moving.has(row));
  const targetIndex=rest.indexOf(target);
  if(targetIndex<0) return; // Dropping onto the selection is a no-op.
  const insertion=targetIndex+(position==="after"?1:0);
  const ordered=[...rest.slice(0,insertion),...cifAtomDragRows,...rest.slice(insertion)];
  if(ordered.every((row,i)=>row===original[i])) return;
  host.append(...ordered);
  const thermalHost=$("cifAtomDetailedRows");
  if(thermalHost){
    const thermalRows=new Map([...thermalHost.children].map(r=>[r.dataset.cifAtomUid,r]));
    for(const row of ordered){
      const paired=thermalRows.get(row.dataset.cifAtomUid);
      if(paired) thermalHost.appendChild(paired);
    }
  }
  refreshCifAtomRowIndices();
  refreshCifAtomDetailedLabels();
  refreshCifAtomSelectionUI();
  saveCifGeneratorAtomsState();
  invalidateGeneratedCif();
  renderCifStructureIfVisible();
}
function initializeCifAtomDragRow(row){
  const handle=row.querySelector(".cif-atom-index");
  if(!handle) return;
  handle.draggable=true;
  handle.title="Drag to reorder selected atoms";
  handle.addEventListener("dragstart",ev=>{
    if(!row.classList.contains("cif-atom-selected")) setCifAtomRowSelection(row);
    cifAtomDragRows=cifSelectedAtomRows();
    if(!cifAtomDragRows.length){ev.preventDefault();return;}
    cifAtomDragRows.forEach(r=>r.classList.add("cif-atom-dragging"));
    ev.dataTransfer.effectAllowed="move";
    ev.dataTransfer.setData("text/plain",row.dataset.cifAtomUid);
  });
  handle.addEventListener("dragend",finishCifAtomDrag);
  // All cells are valid targets so the entire row can receive the drop.
  row.querySelectorAll(".cif-atom-cell").forEach(cell=>{
    cell.addEventListener("dragover",ev=>{
      if(!cifAtomDragRows?.length) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect="move";
      const position=cifAtomDropPosition(ev,row);
      if(cifAtomDropTarget?.row===row && cifAtomDropTarget?.position===position) return;
      clearCifAtomDropMarker();
      if(cifAtomDragRows.includes(row)) return;
      row.classList.add(position==="before"?"cif-atom-drop-before":"cif-atom-drop-after");
      cifAtomDropTarget={row,position};
    });
    cell.addEventListener("drop",ev=>{
      if(!cifAtomDragRows?.length) return;
      ev.preventDefault();
      const position=cifAtomDropPosition(ev,row);
      moveDraggedCifAtomRows(row,position);
      finishCifAtomDrag();
    });
  });
}

function copySelectedCifAtomRows(){
  const selected=cifSelectedAtomRows();
  if(!selected.length) return;
  const values=selected.map(cifAtomRowValues);
  // Copy the original selection snapshot once, in source-row order.
  document.querySelectorAll("#cifAtomRows .cif-atom-selected").forEach(r=>r.classList.remove("cif-atom-selected"));
  for(const atom of values){
    addCifAtomRow(atom,{invalidate:false});
    $("cifAtomRows").lastElementChild.classList.add("cif-atom-selected");
  }
  cifAtomSelectionAnchor=$("cifAtomRows")?.lastElementChild?.dataset.cifAtomUid??null;
  refreshCifAtomSelectionUI();
  invalidateGeneratedCif();
  renderCifStructureIfVisible();
}
function removeSelectedCifAtomRows(){
  const selected=cifSelectedAtomRows();
  if(!selected.length) return;
  for(const row of selected){
    document.querySelector(`#cifAtomDetailedRows [data-cif-atom-uid="${row.dataset.cifAtomUid}"]`)?.remove();
    row.remove();
  }
  cifAtomSelectionAnchor=null;
  if(!$("cifAtomRows")?.querySelector(".cif-atom-row")) addCifAtomRow({}, {invalidate:false});
  refreshCifAtomRowIndices();
  refreshCifAtomDetailedLabels();
  refreshCifAtomSelectionUI();
  saveCifGeneratorAtomsState();
  invalidateGeneratedCif();
  renderCifStructureIfVisible();
}

let cifAtomDetailedSerial=0;
const CIF_U_FIELDS=["11","22","33","12","13","23"];

// Detailed rows are paired with atomic-position rows by a stable DOM key,
// rather than by a mutable row number. This preserves ADPs on add/copy/delete.
// Anisotropic Uij is an optional compact table paired to the Atomic positions
// table by stable DOM keys. Biso itself is edited in Atomic positions.
function addCifAtomDetailedRow(atomRow,values={}){
  const host=$("cifAtomDetailedRows");
  if(!host) return;
  const uid=atomRow.dataset.cifAtomUid;
  const tableRow=document.createElement("div");
  tableRow.className="cif-thermal-row";
  tableRow.dataset.cifAtomUid=uid;
  // Separate Index / Use / Atom columns, exactly as in Spins.  The Uij
  // values stay associated with the source atom by their stable UID.
  const indexCell=document.createElement("div");
  indexCell.className="cif-thermal-cell cif-thermal-index";
  tableRow.appendChild(indexCell);
  const useCell=document.createElement("div");
  useCell.className="cif-thermal-cell cif-thermal-use";
  const toggleLabel=document.createElement("label");
  toggleLabel.className="cif-thermal-toggle";
  const toggle=document.createElement("input");
  toggle.type="checkbox";
  toggle.dataset.cifThermalField="useUij";
  toggle.checked=!!values.useUij || (Array.isArray(values.Uaniso) && values.Uaniso.length===3);
  toggle.setAttribute("aria-label","Use anisotropic Uij for this atom");
  toggleLabel.appendChild(toggle);
  useCell.appendChild(toggleLabel);
  tableRow.appendChild(useCell);
  const atomCell=document.createElement("div");
  atomCell.className="cif-thermal-cell cif-thermal-atom";
  const atomName=document.createElement("span");
  atomName.className="cif-thermal-atom-name";
  atomName.textContent="Atom";
  atomCell.appendChild(atomName);
  tableRow.appendChild(atomCell);
  const source=Array.isArray(values.Uij) ? values.Uij :
    (Array.isArray(values.Uaniso) ? [values.Uaniso[0]?.[0],values.Uaniso[1]?.[1],values.Uaniso[2]?.[2],values.Uaniso[0]?.[1],values.Uaniso[0]?.[2],values.Uaniso[1]?.[2]] : null);
  const fields=[];
  for(let i=0;i<CIF_U_FIELDS.length;i++){
    const cell=document.createElement("div");
    cell.className="cif-thermal-cell";
    const input=document.createElement("input");
    input.type="number";
    input.step="any";
    input.dataset.cifThermalField=`U${CIF_U_FIELDS[i]}`;
    input.setAttribute("aria-label",`U${CIF_U_FIELDS[i]} (Å²) for atom`);
    input.value=String(source?.[i] ?? 0);
    fields.push(input);
    cell.appendChild(input);
    tableRow.appendChild(cell);
  }
  host.appendChild(tableRow);
  const bInput=atomRow.querySelector('[data-cif-atom-field="Biso"]');
  function setUijEnabled(){
    fields.forEach(input=>{input.disabled=!toggle.checked;});
    // Biso stays editable even while Uij takes precedence in calculations.
    // Retaining both values lets users switch between isotropic and anisotropic ADPs.
  }
  toggle.addEventListener("change",()=>{
    if(toggle.checked && !toggle.dataset.initialized){
      // Initialize newly enabled Uij from the current Biso (isotropic U).
      const b=Number(bInput?.value ?? 0);
      const u=Number.isFinite(b) && b>=0 ? b/(8*Math.PI*Math.PI) : 0;
      for(let i=0;i<3;i++) if(Number(fields[i].value)===0) fields[i].value=String(Number(u.toPrecision(8)));
      toggle.dataset.initialized="1";
    }
    setUijEnabled();
    saveCifGeneratorAtomsState();
  });
  if(toggle.checked || source) toggle.dataset.initialized="1";
  tableRow.addEventListener("input",saveCifGeneratorAtomsState);
  tableRow.addEventListener("change",saveCifGeneratorAtomsState);
  setUijEnabled();
  return tableRow;
}

function refreshCifAtomDetailedLabels(){
  const rows=[...document.querySelectorAll("#cifAtomRows .cif-atom-row")];
  for(let i=0;i<rows.length;i++){
    const card=document.querySelector(`#cifAtomDetailedRows [data-cif-atom-uid="${rows[i].dataset.cifAtomUid}"]`);
    const label=rows[i].querySelector('[data-cif-atom-field="element"]')?.value.trim()||"Atom";
    if(card){
      const index=card.querySelector(".cif-thermal-index");
      if(index) index.textContent=String(i+1);
      const name=card.querySelector(".cif-thermal-atom-name");
      if(name){name.textContent=label;name.title=label;}
      const checkbox=card.querySelector('[data-cif-thermal-field="useUij"]');
      if(checkbox) checkbox.setAttribute("aria-label",`Use anisotropic Uij for atom ${i+1}, ${label}`);
    }
  }
}

function cifAtomThermalValues(row){
  const card=document.querySelector(`#cifAtomDetailedRows [data-cif-atom-uid="${row.dataset.cifAtomUid}"]`);
  const get=k=>card?.querySelector(`[data-cif-thermal-field="${k}"]`)?.value ?? "0";
  const bisoInput=row.querySelector('[data-cif-atom-field="Biso"]');
  const biso=bisoInput ? cifPositionInputValue(bisoInput) : "0";
  return {Biso:biso,useUij:!!card?.querySelector('[data-cif-thermal-field="useUij"]')?.checked,
    Uij:CIF_U_FIELDS.map(k=>get(`U${k}`))};
}

function addCifAtomRow(values={}, {invalidate=true}={}){
  const host=$("cifAtomRows");
  if(!host) return;
  const row=document.createElement("div");
  row.className="cif-atom-row";
  row.dataset.cifAtomUid=String(++cifAtomDetailedSerial);
  const indexCell=document.createElement("div");
  indexCell.className="cif-atom-cell cif-atom-index";
  indexCell.setAttribute("aria-label","Atom row index");
  row.appendChild(indexCell);
  const specs=[
    ["element","text",values.element ?? (structurePositionTableElement==='*'?'':structurePositionTableElement)],
    ["x","fraction",values.x ?? 0],
    ["y","fraction",values.y ?? 0],
    ["z","fraction",values.z ?? 0],
    ["occupancy","fraction",values.occupancy ?? 1],
    ["Biso","biso",values.Biso ?? 0]
  ];
  for(const [key,type,value] of specs){
    const cell=document.createElement("div"); cell.className="cif-atom-cell";
    const input=document.createElement("input");
    const numeric=type!=="text";
    input.type=numeric ? "number" : "text";
    if(numeric){
      input.step="any";
      input.inputMode="decimal";
      if(key==="occupancy"){input.min="0";input.max="1";}
      if(key==="Biso") input.min="0";
    }
    input.dataset.cifAtomField=key;
    input.value=String(value);
    if(key==="element") input.placeholder="e.g. Cu";
    if(numeric){
      // CIF fractional syntax such as 1/3 is accepted when loading a file;
      // editing uses native numeric fields instead of unrestricted text.
      formatCifPositionInput(input,String(value));
      input.addEventListener("input",()=>{
        delete input.dataset.cifPreciseValue;
        delete input.dataset.cifDisplayedValue;
        validateCifAtomNumericInput(input);
      });
      input.addEventListener("change",()=>{
        if(validateCifAtomNumericInput(input)) formatCifPositionInput(input);
        saveCifGeneratorAtomsState();
      });
    }
    input.addEventListener("input",()=>{
      if(key==="element") {refreshCifAtomDetailedLabels();refreshPositionTableToolbar();}
      saveCifGeneratorAtomsState();
    });
    if(!numeric) input.addEventListener("change",saveCifGeneratorAtomsState);
    cell.appendChild(input); row.appendChild(cell);
    if(type==="fraction" || type==="biso") validateCifAtomNumericInput(input);
  }
  // Click cells to select. Shift selects a range; Ctrl/Cmd toggles rows.
  // The click does not prevent text inputs from receiving focus.
  row.querySelectorAll(".cif-atom-cell").forEach(cell=>{
    cell.addEventListener("click",event=>setCifAtomRowSelection(row,event));
  });
  host.appendChild(row);
  initializeCifAtomDragRow(row);
  addCifAtomDetailedRow(row,values);
  refreshCifAtomRowIndices();
  refreshCifAtomDetailedLabels();
  refreshCifAtomSelectionUI();
  if(!restoringCifGeneratorAtoms)refreshPositionTableToolbar();
  saveCifGeneratorAtomsState();
  if(invalidate) invalidateGeneratedCif();
}

function cifAtomRowValues(row){
  if(!row) return null;
  const get=key=>cifPositionInputValue(row.querySelector(`[data-cif-atom-field="${key}"]`));
  return {
    element:get("element"),
    x:get("x"),
    y:get("y"),
    z:get("z"),
    occupancy:get("occupancy"),
    ...cifAtomThermalValues(row)
  };
}

function copyLastCifAtomRow(){
  const rows=[...document.querySelectorAll("#cifAtomRows .cif-atom-row")];
  if(!rows.length){
    addCifAtomRow();
    return;
  }
  const values=cifAtomRowValues(rows[rows.length-1]);
  addCifAtomRow(values||{});
}

function replaceCifAtomRows(atoms){
  const host=$("cifAtomRows");
  if(!host) return;
  host.replaceChildren();
  cifAtomSelectionAnchor=null;
  $("cifAtomDetailedRows")?.replaceChildren();
  for(const atom of atoms) addCifAtomRow(atom,{invalidate:false});
  if(!atoms.length) addCifAtomRow({}, {invalidate:false});
  refreshCifAtomRowIndices();
  refreshCifAtomSelectionUI();
  saveCifGeneratorAtomsState();
}

function normalizeCifElement(raw){
  const s=String(raw||"").trim();
  if(/^D$/i.test(s)) return "D";
  const iso=s.match(/^(\d+)([A-Za-z]{1,2})$/);
  if(iso) return `${iso[1]}${iso[2][0].toUpperCase()+iso[2].slice(1).toLowerCase()}`;
  const m=s.match(/^([A-Za-z]{1,2})/);
  if(!m) return "";
  return m[1][0].toUpperCase()+m[1].slice(1).toLowerCase();
}

function readCifGeneratorAtoms(){
  const host=$("cifAtomRows");
  const rows=host ? [...host.querySelectorAll(".cif-atom-row")] : [];
  const atoms=[];
  for(let i=0;i<rows.length;i++){
    const get=key=>cifPositionInputValue(rows[i].querySelector(`[data-cif-atom-field="${key}"]`));
    const element=normalizeCifElement(get("element"));
    if(!element) throw new Error(`Atom ${i+1}: enter a valid element symbol.`);
    const xInput=rows[i].querySelector('[data-cif-atom-field="x"]');
    const yInput=rows[i].querySelector('[data-cif-atom-field="y"]');
    const zInput=rows[i].querySelector('[data-cif-atom-field="z"]');
    const occInput=rows[i].querySelector('[data-cif-atom-field="occupancy"]');
    const xyzValid=[xInput,yInput,zInput].map(validateCifAtomNumericInput);
    const occValid=validateCifAtomNumericInput(occInput);
    const x=parseNumericValue(get("x")), y=parseNumericValue(get("y")), z=parseNumericValue(get("z")), occupancy=parseNumericValue(get("occupancy"));
    if(!xyzValid.every(Boolean)) throw new Error(`Atom ${i+1}: x, y, and z must be finite fractional coordinates.`);
    if(!occValid) throw new Error(`Atom ${i+1}: occupancy must be between 0 and 1.`);
    const thermal=cifAtomThermalValues(rows[i]);
    const Biso=Number(thermal.Biso);
    if(!String(thermal.Biso).trim() || !Number.isFinite(Biso) || Biso<0)
      throw new Error(`Atom ${i+1}: Biso must be a non-negative finite value.`);
    let Uaniso=null;
    if(thermal.useUij){
      const u=thermal.Uij.map((s,j)=>{
        if(!String(s).trim() || !Number.isFinite(Number(s)))
          throw new Error(`Atom ${i+1}: U${CIF_U_FIELDS[j]} must be a finite number.`);
        return Number(s);
      });
      // A physically meaningful displacement tensor must be positive semidefinite.
      const [a,b,c,d,e,f]=u;
      const det=a*b*c+2*d*e*f-a*f*f-b*e*e-c*d*d;
      const tol=1e-10*Math.max(1,...u.map(v=>Math.abs(v)))**3;
      if(a < -1e-10 || b < -1e-10 || c < -1e-10 ||
         a*b-d*d < -tol || a*c-e*e < -tol || b*c-f*f < -tol || det < -tol)
        throw new Error(`Atom ${i+1}: Uij must be a positive-semidefinite tensor.`);
      Uaniso=[[a,d,e],[d,b,f],[e,f,c]];
    }
    atoms.push({element,x,y,z,occupancy,Biso,Uaniso});
  }
  if(!atoms.length) throw new Error("Add at least one asymmetric-unit atom.");
  return atoms;
}

function cifGeneratorNumber(id,label,{positive=false,angle=false}={}){
  const v=Number($(id)?.value);
  if(!Number.isFinite(v)) throw new Error(`${label} must be a number.`);
  if(positive && !(v>0)) throw new Error(`${label} must be greater than zero.`);
  if(angle && !(v>0 && v<180)) throw new Error(`${label} must be between 0 and 180 degrees.`);
  return v;
}

// Shared naming rules for both generators: strip only the source file's
// terminal .cif/.mcif extension; preserve dots in sample names (e.g. "1.2").
function cleanStructureBaseName(raw){
  let name=String(raw||"generated_structure").trim().replace(/[\\/:*?"<>|]+/g,"_");
  // Also repair names generated by older versions (e.g. "sample.mcif_generate01").
  name=name.replace(/\.(?:cif|mcif)(?=_generate\d+$)/i,"");
  name=name.replace(/\.(?:cif|mcif)$/i,"").trim();
  return name || "generated_structure";
}
function cleanCifBaseName(raw){
  return cleanStructureBaseName(raw);
}
function cleanCifFileName(raw){
  return `${cleanCifBaseName(raw)}.cif`;
}
function nextCifGeneratedBaseName(raw){
  const current=cleanCifBaseName(raw);
  const numbered=current.match(/^(.*)_generate(\d+)$/i);
  if(numbered){
    const n=Math.max(0,Number(numbered[2])||0)+1;
    return `${numbered[1]}_generate${String(n).padStart(2,"0")}`;
  }
  const base=current.replace(/_generate$/i,"");
  return `${base}_generate01`;
}

function buildGeneratedCif(){
  applyCifLatticeConstraints();
  // Editing symmetry-equivalent atoms separately removes their symmetry
  // constraint. Export a mathematically consistent P1 rather than applying
  // the original operations to each explicit atom a second time.
  const sg=structurePositionEditingMode==='individual'
    ? cifSpaceGroups.find(item=>item.number===1) : selectedCifGeneratorSpaceGroup();
  if(!sg) throw new Error("Select a space group.");
  const lattice={
    a:cifGeneratorNumber("cifA","a",{positive:true}),
    b:cifGeneratorNumber("cifB","b",{positive:true}),
    c:cifGeneratorNumber("cifC","c",{positive:true}),
    alpha:cifGeneratorNumber("cifAlpha","alpha",{angle:true}),
    beta:cifGeneratorNumber("cifBeta","beta",{angle:true}),
    gamma:cifGeneratorNumber("cifGamma","gamma",{angle:true})
  };
  const atoms=readCifGeneratorAtoms();
  const filename=cleanCifFileName($("cifGeneratedName")?.value);
  const dataName=filename.replace(/\.cif$/i,"").replace(/[^A-Za-z0-9_\-]/g,"_") || "generated_structure";
  const lines=[
    `data_${dataName}`,
    "_audit_creation_method 'TAS Simulator CIF Generator'",
    `_space_group_name_H-M_alt '${sg.hm}'`,
    `_space_group_name_Hall '${sg.hall}'`,
    `_space_group_IT_number ${sg.number}`,
    `_cell_length_a ${lattice.a}`,
    `_cell_length_b ${lattice.b}`,
    `_cell_length_c ${lattice.c}`,
    `_cell_angle_alpha ${lattice.alpha}`,
    `_cell_angle_beta ${lattice.beta}`,
    `_cell_angle_gamma ${lattice.gamma}`,
    "",
    "loop_",
    "_space_group_symop_id",
    "_space_group_symop_operation_xyz"
  ];
  sg.operations.forEach((op,i)=>lines.push(`${i+1} '${op}'`));
  lines.push("","loop_","_atom_site_label","_atom_site_type_symbol","_atom_site_fract_x","_atom_site_fract_y","_atom_site_fract_z","_atom_site_occupancy","_atom_site_B_iso_or_equiv");
  const counts=new Map(),aniso=[];
  for(const atom of atoms){
    const n=(counts.get(atom.element)||0)+1; counts.set(atom.element,n);
    const label=`${atom.element}${n}`;
    lines.push(`${label} ${atom.element} ${atom.x} ${atom.y} ${atom.z} ${atom.occupancy} ${atom.Biso}`);
    if(atom.Uaniso) aniso.push({label,U:atom.Uaniso});
  }
  if(aniso.length){
    lines.push("","loop_","_atom_site_aniso_label","_atom_site_aniso_U_11","_atom_site_aniso_U_22","_atom_site_aniso_U_33","_atom_site_aniso_U_12","_atom_site_aniso_U_13","_atom_site_aniso_U_23");
    for(const {label,U} of aniso)
      lines.push(`${label} ${U[0][0]} ${U[1][1]} ${U[2][2]} ${U[0][1]} ${U[0][2]} ${U[1][2]}`);
  }
  lines.push("");
  const text=lines.join("\n");
  // Validate with the same parser used by the simulator. This catches unknown
  // atom types and any atom/site that cannot be expanded before download/apply.
  const parsed=parseCifStructure(text);
  return {text,filename,sg,atoms,parsed};
}


// CIF reciprocal-space symmetry helpers are implemented in cif-symmetry.js.

function syncCifReflectionBeamFromInstrument(){
  const e=Number($("energy")?.value);
  if(!(e>0)) return;
  const wavelength=9.044/Math.sqrt(e);
  const wavevector=2*Math.PI/wavelength;
  if($("cifReflectionEnergy")) $("cifReflectionEnergy").value=e.toFixed(4);
  if($("cifReflectionWavelength")) $("cifReflectionWavelength").value=wavelength.toFixed(5);
  if($("cifReflectionWavevector")) $("cifReflectionWavevector").value=wavevector.toFixed(5);
}
function syncCifReflectionBeamFrom(source){
  let e,lambda,k;
  if(source==="wavelength"){
    lambda=Number($("cifReflectionWavelength")?.value);
    if(!(lambda>0)) return;
    e=(9.044/lambda)**2;
    k=2*Math.PI/lambda;
  }else if(source==="wavevector"){
    k=Number($("cifReflectionWavevector")?.value);
    if(!(k>0)) return;
    lambda=2*Math.PI/k;
    e=(9.044/lambda)**2;
  }else{
    e=Number($("cifReflectionEnergy")?.value);
    if(!(e>0)) return;
    lambda=9.044/Math.sqrt(e);
    k=2*Math.PI/lambda;
  }
  if($("cifReflectionEnergy")) $("cifReflectionEnergy").value=e.toFixed(5);
  if($("cifReflectionWavelength")) $("cifReflectionWavelength").value=lambda.toFixed(5);
  if($("cifReflectionWavevector")) $("cifReflectionWavevector").value=k.toFixed(5);
  // Reflect edits into the Instrument's active fixed Ei or Ef energy.
  const fixedEnergy=$("energy");
  if(fixedEnergy && Number(fixedEnergy.value)!==e){
    fixedEnergy.value=String(Number(e.toPrecision(12)));
    fixedEnergy.dispatchEvent(new Event("input",{bubbles:true}));
    fixedEnergy.dispatchEvent(new Event("change",{bubbles:true}));
  }
  recalculateGeneratedReflections();
}
function currentCifReflectionBeam(){
  // The Generator starts from Instrument configuration, but Energy/Wavelength/
  // wavevector can be changed locally without changing the Instrument setup.
  const energyMode=checkedValue("energyMode") || $("energyMode")?.value;
  let enteredEnergy=Number($("cifReflectionEnergy")?.value);
  let wavelength=Number($("cifReflectionWavelength")?.value);
  let wavevector=Number($("cifReflectionWavevector")?.value);
  if(!(wavelength>0) && wavevector>0) wavelength=2*Math.PI/wavevector;
  if(!(enteredEnergy>0) && wavelength>0) enteredEnergy=(9.044/wavelength)**2;
  if(!(wavelength>0) && enteredEnergy>0) wavelength=9.044/Math.sqrt(enteredEnergy);
  if(!(wavevector>0) && wavelength>0) wavevector=2*Math.PI/wavelength;
  if(!(enteredEnergy>0) || !(wavelength>0) || !(wavevector>0)) throw new Error("Energy, wavelength, and wavevector must be greater than zero to calculate reflections.");
  const lambdaHalf=!!$("cifReflectionLambdaHalf")?.checked;
  const effectiveEnergy=lambdaHalf ? 4*enteredEnergy : enteredEnergy;
  const effectiveWavelength=lambdaHalf ? wavelength/2 : wavelength;
  return {energyMode,enteredEnergy,effectiveEnergy,lambdaHalf,wavelength:effectiveWavelength,baseWavelength:wavelength,wavevector};
}

function currentCifReflectionFilters(){
  return {
    alongU:!!$("cifReflectionAlongU")?.checked,
    alongV:!!$("cifReflectionAlongV")?.checked,
    withinS2Max:$("cifReflectionWithinS2Max")?.checked !== false
  };
}

function reflectionInCurrentScatteringPlane(rl,hkl){
  const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
  const {ez}=makeSpiceScatteringPlaneBasis(rl,U,V);
  const q=hklToQ(rl,hkl), qn=norm(q);
  return qn>1e-12 && Math.abs(dot(q,ez)) <= 1e-9*Math.max(1,qn);
}

function reflectionAlongCurrentAxis(rl,hkl,axisHkl){
  const q=hklToQ(rl,hkl), axis=hklToQ(rl,axisHkl);
  const qn=norm(q), an=norm(axis);
  if(!(qn>1e-12) || !(an>1e-12)) return false;
  return norm(cross(q,axis)) <= 1e-9*Math.max(1,qn*an);
}

function buildCifReflectionTable(structure,sg,wavelength,filters={alongU:true,alongV:true,withinS2Max:true},twoThetaMax=180){
  if(!structure?.lattice) throw new Error("Generated CIF has no valid lattice.");
  const lambda=Number(wavelength);
  if(!(lambda>0)) throw new Error("Reflection wavelength must be greater than zero.");
  const lattice=structure.lattice;
  const rl=RL_calc(lattice);
  const qMax=4*Math.PI/lambda;
  const hMax=Math.ceil(qMax*Number(lattice.a)/(2*Math.PI))+1;
  const kMax=Math.ceil(qMax*Number(lattice.b)/(2*Math.PI))+1;
  const lMax=Math.ceil(qMax*Number(lattice.c)/(2*Math.PI))+1;
  const candidateCount=(2*hMax+1)*(2*kMax+1)*(2*lMax+1)-1;
  if(candidateCount>3000000){
    throw new Error(`Reflection search is too large (${candidateCount.toLocaleString()} candidate hkl). Increase wavelength or use a smaller unit cell.`);
  }

  const reciprocalOps=reciprocalSymmetryMatrices(sg);
  const rows=[];
  const seenFamilies=new Set();
  const tol=1e-9;
  for(let h=-hMax;h<=hMax;h++) for(let k=-kMax;k<=kMax;k++) for(let l=-lMax;l<=lMax;l++){
    if(h===0&&k===0&&l===0) continue;
    const hkl=[h,k,l];
    const qVec=hklToQ(rl,hkl), q=norm(qVec);
    if(!(q>1e-12) || q>qMax+tol) continue;
    const star=reflectionStar(hkl,reciprocalOps);
    const familyKey=star.map(hklKey).sort().join("|");
    if(seenFamilies.has(familyKey)) continue;
    seenFamilies.add(familyKey);
    const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
    // Direction filters are intentionally compact:
    //   U only  -> reflections along U
    //   V only  -> reflections along V
    //   U + V   -> every reflection in the U-V scattering plane
    //   neither -> all reflections
    let visibleStar=star;
    if(filters?.alongU && filters?.alongV){
      visibleStar=star.filter(x=>reflectionInCurrentScatteringPlane(rl,x));
    }else if(filters?.alongU){
      visibleStar=star.filter(x=>reflectionAlongCurrentAxis(rl,x,U));
    }else if(filters?.alongV){
      visibleStar=star.filter(x=>reflectionAlongCurrentAxis(rl,x,V));
    }
    if(!visibleStar.length) continue;
    // Show one representative satisfying the active direction rule.
    // Multiplicity remains the full crystallographic star size.
    const rep=canonicalReflectionHkl(visibleStar);
    const qRep=norm(hklToQ(rl,rep));
    const arg=qRep*lambda/(4*Math.PI);
    if(arg>1+1e-10) continue;
    const twoTheta=2*rad2deg(Math.asin(clamp(arg,-1,1)));
    if(filters?.withinS2Max && Number.isFinite(twoThetaMax) && twoTheta>twoThetaMax+1e-9) continue;
    const d=2*Math.PI/qRep;
    let intensity=nuclearStructureFactorSquared(structure,rep,qRep);
    if(!Number.isFinite(intensity)) intensity=0;
    const multiplicity=star.length;
    rows.push({hkl:rep,intensity,multiplicity,totalIntensity:intensity*multiplicity,twoTheta,q:qRep,d});
  }

  // Do not show systematic/motif extinctions.  Exact extinctions can leave tiny
  // floating-point residues after symmetry expansion, so use a very small
  // relative tolerance rather than testing intensity === 0.
  const maxI=Math.max(0,...rows.map(r=>Math.abs(Number(r.intensity)||0)));
  const extinctTol=Math.max(1e-12,maxI*1e-12);
  return rows.filter(r=>Number(r.intensity)>extinctTol);
}

function sortedCifReflections(rows,sortState=cifReflectionSort){
  const out=[...(rows||[])];
  const key=sortState?.key||"intensity";
  const dir=sortState?.direction==="asc" ? 1 : -1;
  return out.sort((a,b)=>{
    const av=Number(a[key]), bv=Number(b[key]);
    const d=(av-bv)*dir;
    return d || compareHkl(a.hkl,b.hkl);
  });
}

function updateCifReflectionSortHeaders(){
  for(const th of document.querySelectorAll(".cif-sortable-th:not(.magnetic-sortable-th)")){
    const active=th.dataset.sortKey===cifReflectionSort.key;
    const direction=active ? cifReflectionSort.direction : null;
    const indicator=th.querySelector(".cif-sort-indicator");
    if(indicator) indicator.textContent=active ? (direction==="asc" ? "▲" : "▼") : "";
    th.setAttribute("aria-sort",active ? (direction==="asc" ? "ascending" : "descending") : "none");
  }
}

function setCifReflectionSort(key){
  if(cifReflectionSort.key===key){
    cifReflectionSort={key,direction:cifReflectionSort.direction==="asc"?"desc":"asc"};
  }else{
    // Intensity-like columns are most useful descending; angular/spacing columns
    // start ascending on first click.
    const direction=(key==="intensity"||key==="totalIntensity"||key==="q") ? "desc" : "asc";
    cifReflectionSort={key,direction};
  }
  updateCifReflectionSortHeaders();
  renderCifReflectionTable();
}

function reflectionNumberText(value,digits=5){
  const x=Number(value);
  if(!Number.isFinite(x)) return "—";
  const a=Math.abs(x);
  if(a!==0 && (a>=1e5 || a<1e-4)) return x.toExponential(4);
  return x.toFixed(digits);
}

function renderCifReflectionTable(){
  const body=$("cifReflectionRows");
  if(!body) return;
  body.replaceChildren();
  if(!lastGeneratedReflections.length){
    selectedCifReflectionKey="";
    const tr=document.createElement("tr"), td=document.createElement("td");
    td.colSpan=7; td.className="cif-reflection-empty"; td.textContent="No reflections in the selected wavelength range.";
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  const rows=sortedCifReflections(lastGeneratedReflections,cifReflectionSort);
  const availableKeys=new Set(rows.map(r=>hklKey(r.hkl)));
  if(selectedCifReflectionKey && !availableKeys.has(selectedCifReflectionKey)) selectedCifReflectionKey="";
  for(const r of rows){
    const key=hklKey(r.hkl);
    const tr=document.createElement("tr");
    tr.dataset.reflectionKey=key;
    tr.tabIndex=0;
    tr.setAttribute("aria-selected",String(key===selectedCifReflectionKey));
    tr.classList.toggle("cif-reflection-selected",key===selectedCifReflectionKey);
    const values=[
      `(${r.hkl.join(" ")})`,
      reflectionNumberText(r.intensity/100,4),
      String(r.multiplicity),
      reflectionNumberText(r.totalIntensity/100,4),
      reflectionNumberText(r.twoTheta,4),
      reflectionNumberText(r.q,5),
      reflectionNumberText(r.d,5)
    ];
    values.forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
    const toggle=()=>{
      selectedCifReflectionKey=(selectedCifReflectionKey===key)?"":key;
      renderCifReflectionTable();
      if(selectedCifReflectionKey){
        body.querySelector(`tr[data-reflection-key="${CSS.escape(selectedCifReflectionKey)}"]`)?.focus({preventScroll:true});
      }
    };
    tr.addEventListener("click",toggle);
    tr.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();toggle();}});
    body.appendChild(tr);
  }
}

function clearCifReflectionRowSelection(){
  if(!selectedCifReflectionKey) return;
  selectedCifReflectionKey='';
  for(const row of document.querySelectorAll('#cifReflectionRows tr.cif-reflection-selected')){
    row.classList.remove('cif-reflection-selected');
    row.setAttribute('aria-selected','false');
  }
}

// A reflection table describes the selected nuclear crystal, regardless of
// whether the user has opened Nuclear or Magnetic or pressed Generate CIF.
// A freshly generated (but not yet Set) CIF takes precedence so its preview
// and calculated reflections stay consistent with one another.
function nuclearReflectionSource(){
  // Live Structure editor overrides the loaded snapshot only after an edit.
  if(liveEditorNuclearSource) return liveEditorNuclearSource;
  if(lastGeneratedCifParsed && lastGeneratedCifSpaceGroup){
    return {structure:lastGeneratedCifParsed,spaceGroup:lastGeneratedCifSpaceGroup,
      fileName:lastGeneratedCifName};
  }
  const selected=getSelectedCifStructure();
  if(!selected?.lattice || !selected?.atoms?.length) return null;
  // A generated mCIF uses a supercell: deduplicate translated atoms into
  // the parent nuclear cell before calculating peaks and indexing hkl.
  const structure=selected.magnetic
    ? crystallographicStructureFromMcif(selected,getSelectedCifText())
    : selected;
  // Never silently compute nuclear reflections in the magnetic supercell.
  if(!structure)return null;
  // Use the known nuclear space group for reflection-star multiplicities.
  // For unfamiliar groups fall back to Friedel-pair grouping instead of
  // preventing the structure-factor calculation altogether.
  const spaceGroup=findGeneratorSpaceGroup(structure) || {operations:["x,y,z"]};
  return {structure,spaceGroup,fileName:getSelectedCifFileName()||"selected_structure.cif"};
}

// Sample lattice parameters are a live calculation override. The CIF/mCIF
// source and all fractional atom coordinates remain untouched.
function nuclearReflectionWithSampleLattice(source){
  if(!source?.structure?.lattice) return source;
  const lattice={...source.structure.lattice};
  for(const id of ["a","b","c","alpha","beta","gamma"]){
    const raw=$(id)?.value;
    if(raw===undefined || String(raw).trim()==="") throw new Error(`Sample ${id} is required for nuclear reflections.`);
    const value=Number(raw);
    if(!Number.isFinite(value) || (['a','b','c'].includes(id) && value<=0)
       || (!['a','b','c'].includes(id) && (value<=0 || value>=180))){
      throw new Error(`Invalid Sample ${id}: ${raw}`);
    }
    lattice[id]=value;
  }
  return {...source,structure:{...source.structure,lattice}};
}

// Live calculation state: never overwrite the original CIF/mCIF on edits.
let liveEditorNuclearSource=null;
let liveEditorNuclearInvalid=false;
let liveNuclearCellReference="sample";
let magneticTableHasBeenCalculated=false;
let liveReflectionRecalcTimer=0;
let synchronizingLiveCell=false;
const LIVE_REFLECTION_DELAY_MS=250;
// Keep Sample and Structure editor crystallographic cells in step, without
// synthesizing DOM events that could recursively trigger each other.
const SYNCHRONIZED_CELL_IDS={a:"cifA",b:"cifB",c:"cifC",alpha:"cifAlpha",beta:"cifBeta",gamma:"cifGamma"};
function syncCrystallographicCell(origin,{refresh=true,changedId="",commit=false}={}){
  if(synchronizingLiveCell) return;
  synchronizingLiveCell=true;
  try{
    const sampleOrigin=origin==="sample";
    const sgId=sampleOrigin?"sampleSpaceGroup":"cifSpaceGroup";
    const targetSgId=sampleOrigin?"cifSpaceGroup":"sampleSpaceGroup";
    // Number fields are text while the user types: don't normalize half-written
    // decimals (e.g. "5."), don't rewrite the focused field, and don't start
    // a reflection calculation for an incomplete/invalid value.
    const sourceSg=$(sgId);
    const numberEntry=sampleOrigin?"sampleSpaceGroupNumber":"cifSpaceGroupNumber";
    if(changedId===numberEntry){
      const typed=String($(numberEntry)?.value??"");
      if(!/^\d+$/.test(typed) || !sampleSpaceGroupByNumber(Number(typed))) return;
      if(sourceSg) sourceSg.value=typed;
    }
    const n=Number(sourceSg?.value);
    if(!Number.isInteger(n) || !sampleSpaceGroupByNumber(n)) return;
    if(targetSgId==="cifSpaceGroup") selectCifSpaceGroup(n);
    else if($(targetSgId)) $(targetSgId).value=String(n);
    for(const id of ["sampleSpaceGroupNumber","cifSpaceGroupNumber"]){
      if(id!==changedId && $(id)) $(id).value=String(n);
    }
    const changedCellKey=Object.entries(SYNCHRONIZED_CELL_IDS)
      .find(([key,editorId])=>changedId===(sampleOrigin?key:editorId))?.[0];
    // Mirror the edited dimension immediately, without requiring every other
    // dimension to be valid during typing.  Reflection calculation remains
    // guarded by the full-lattice validation below.
    if(changedCellKey){
      const src=$(sampleOrigin?changedCellKey:SYNCHRONIZED_CELL_IDS[changedCellKey]);
      const dst=$(sampleOrigin?SYNCHRONIZED_CELL_IDS[changedCellKey]:changedCellKey);
      if(src && dst) dst.value=src.value;
    }
    const sourceValues={};
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const input=$(sampleOrigin?key:editorId);
      if(!input) return;
      const raw=String(input.value).trim();
      // Preserve unfinished input rather than losing the user's decimal.
      if(raw==="" || raw==="-" || raw==="+" || raw.endsWith(".") ||
         !Number.isFinite(Number(raw)) || Number(raw)<=0 ||
         ((key==="alpha"||key==="beta"||key==="gamma") && Number(raw)>=180)){
        // Still mirror the exact input string for an active field, but defer calculation.
        if(changedCellKey===key){
          const dest=$(sampleOrigin?editorId:key);
          if(dest) dest.value=raw;
        }
        return;
      }
      sourceValues[key]=raw;
    }
    // Copy the edited values first; avoid invoking input/change events recursively.
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const dest=$(sampleOrigin?editorId:key);
      if(dest) dest.value=sourceValues[key];
    }
    // Normalize both sides only after a field is committed or the SG changes;
    // otherwise the active decimal input stays untouched.
    if(commit || changedId===sgId || changedId===numberEntry){
      if(sampleOrigin){
        applySampleLatticeConstraints();
        for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
          if($(editorId) && $(key)) $(editorId).value=$(key).value;
        }
        applyCifLatticeConstraints();
      }else{
        applyCifLatticeConstraints();
        for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
          if($(key) && $(editorId)) $(key).value=$(editorId).value;
        }
        applySampleLatticeConstraints();
      }
    }
    // Final values must agree after applying crystal-system constraints.
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const from=$(sampleOrigin?key:editorId);
      const to=$(sampleOrigin?editorId:key);
      if(from && to) to.value=from.value;
    }
    updateCifSpaceGroupInfo();
    liveNuclearCellReference="editor";
    if(refresh){
      updateLiveEditorNuclearSource();
      scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
      scheduleRecalc();
    }
  }finally{synchronizingLiveCell=false;}
}

function scheduleLiveReflectionRecalc({nuclear=true,magnetic=false}={}){
  // Coalesce rapid typing; never calculate a half-written numeric value.
  clearTimeout(liveReflectionRecalcTimer);
  liveReflectionRecalcTimer=setTimeout(()=>{
    liveReflectionRecalcTimer=0;
    if(nuclear) recalculateGeneratedReflections();
    if(magnetic && magneticTableHasBeenCalculated) calculateMagneticReflectionTable();
  },LIVE_REFLECTION_DELAY_MS);
}
function readLiveEditorNuclearStructure(){
  // Only valid complete snapshots replace the previous reflection source.
  // Build from the real Positions/Uij controls (same validation as Generate CIF).
  const generated=buildGeneratedCif();
  return {structure:generated.parsed,spaceGroup:generated.sg,
    fileName:generated.filename};
}
function updateLiveEditorNuclearSource(){
  try{
    liveEditorNuclearSource=readLiveEditorNuclearStructure();
    liveEditorNuclearInvalid=false;
  }catch(_err){
    // Invalid/partial input: show an actionable error instead of stale peaks.
    liveEditorNuclearSource=null;
    liveEditorNuclearInvalid=true;
  }
}
let lastMagneticMotif=null;
let lastMagneticRows=[];
let lastMagneticParentIndexing=null;
let magneticReflectionSort={key:'intensity',direction:'desc'};
function sortedMagneticReflections(rows){
  const {key,direction}=magneticReflectionSort;
  const factor=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const av=Number(key==='formFactor'?a.formFactorSort:a[key]);
    const bv=Number(key==='formFactor'?b.formFactorSort:b[key]);
    return (av-bv)*factor || compareHkl(a.hkl,b.hkl);
  });
}
function updateMagneticSortHeaders(){
  for(const th of document.querySelectorAll('.magnetic-sortable-th')){
    const active=th.dataset.sortKey===magneticReflectionSort.key;
    const indicator=th.querySelector('.cif-sort-indicator');
    if(indicator)indicator.textContent=active?(magneticReflectionSort.direction==='asc'?'▲':'▼'):'';
    th.setAttribute('aria-sort',active?(magneticReflectionSort.direction==='asc'?'ascending':'descending'):'none');
  }
}
function setMagneticReflectionSort(key){
  if(magneticReflectionSort.key===key)magneticReflectionSort.direction=magneticReflectionSort.direction==='asc'?'desc':'asc';
  else magneticReflectionSort={key,direction:(key==='intensity'||key==='q')?'desc':'asc'};
  updateMagneticSortHeaders();
  renderMagneticReflectionRows();
}
let selectedMagneticReflectionKey='';
function clearMagneticReflectionRowSelection(){
  if(!selectedMagneticReflectionKey) return;
  selectedMagneticReflectionKey='';
  for(const row of document.querySelectorAll('#magneticReflectionRows tr.cif-reflection-selected')){
    row.classList.remove('cif-reflection-selected');
    row.setAttribute('aria-selected','false');
  }
}
function renderMagneticReflectionRows(){
  const body=$('magneticReflectionRows');if(!body)return;
  body.replaceChildren();
  const replication=lastMagneticParentIndexing?.replication || lastMagneticMotif?.replication || [1,1,1];
  const known=!!lastMagneticParentIndexing || lastMagneticMotif?.source!=='mCIF';
  const indexHeader=$('magneticReflectionIndexHeader');
  if(indexHeader) indexHeader.textContent=known?'HKL (parent cell)':'HKL (magnetic cell)';
  const rows=sortedMagneticReflections(lastMagneticRows).slice(0,3000);
  const available=new Set(rows.map(row=>hklKey(row.hkl)));
  if(!available.has(selectedMagneticReflectionKey)) selectedMagneticReflectionKey='';
  for(const row of rows){
    const key=hklKey(row.hkl);
    const indexHkl=known?hklInParentCell(row.hkl,replication):row.hkl;
    const tr=document.createElement('tr');
    tr.dataset.reflectionKey=key;
    tr.tabIndex=0;
    tr.classList.toggle('cif-reflection-selected',key===selectedMagneticReflectionKey);
    tr.setAttribute('aria-selected',String(key===selectedMagneticReflectionKey));
    const values=[`(${indexHkl.map(v=>Number(v.toFixed(8))).join(' ')})`,row.formFactor??'1',Number(row.intensity).toFixed(7),Number(row.twoTheta).toFixed(4),Number(row.q).toFixed(5),Number(row.d).toFixed(5)];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}
    const toggle=()=>{
      selectedMagneticReflectionKey=selectedMagneticReflectionKey===key?'':key;
      renderMagneticReflectionRows();
      if(selectedMagneticReflectionKey){
        body.querySelector(`tr[data-reflection-key="${CSS.escape(selectedMagneticReflectionKey)}"]`)?.focus({preventScroll:true});
      }
    };
    tr.addEventListener('click',toggle);
    tr.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}
    });
    body.appendChild(tr);
  }
}

const GENERATOR_REFLECTION_MODE_KEY='tas-simulator-generator-reflection-mode-v1';
function magneticModelFromEditor(){
  // The generated CIF draft contains *nuclear* atom sites only and may take
  // precedence in the 3-D viewer. Never let that draft silently replace an
  // explicitly loaded magnetic CIF when computing magnetic intensities.
  const importedStructure=getSelectedCifStructure();
  const current=importedStructure?.magnetic
    ? importedStructure : currentStructureForViewer()?.structure;
  if(!current) throw new Error('Load a CIF/mCIF before calculating magnetic Bragg reflections.');
  if(structureSpinEditingMode==='individual') throw new Error('Switch Spins Mode to linked Sites; per-atom manual supercell edits are not yet supported in this calculator.');
  const fromFile=!!current.magnetic && !importedMagneticEditMode;
  const selectedQ=effectivePropagationVectorForStructure();
  const settings=new Map(structureMomentSettings);
  for(const [key,value] of currentMomentSettings())settings.set(key,value);
  // For Source=mCIF, the parsed expanded atoms carry the actual magnetic
  // moments; the nuclear generator's zero-valued UI rows must not erase them.
  return buildMagneticMotif({structure:current,settings,
    q:[selectedQ.h,selectedQ.k,selectedQ.l],imported:fromFile,
    mode:structureMomentStructureType,axis:structureMomentRotationAxis,
    chirality:structureMomentChirality});
}
function calculateMagneticReflectionTable(){
  magneticTableHasBeenCalculated=true;
  const message=$('magneticReflectionMessage'),body=$('magneticReflectionRows');
  if(!body)return;
  body.replaceChildren();
  lastMagneticRows=[];lastMagneticMotif=null;lastMagneticParentIndexing=null;
  if($('magneticDownloadTable'))$('magneticDownloadTable').disabled=true;
  if($('magneticExportBnsInput'))$('magneticExportBnsInput').disabled=true;
  try{
    const motif=magneticModelFromEditor();
    const beam=currentCifReflectionBeam();
    const filters=currentCifReflectionFilters();
    let twoThetaMax=180;
    if(filters.withinS2Max){
      const inst=currentInstrument();
      twoThetaMax=Math.min(180,effectiveS2MaxAtEi(inst,beam.effectiveEnergy,beam.lambdaHalf));
    }
    const ionByElement=explicitMagneticIonFactors(getSelectedCifText());
    const rows=magneticBraggPeaks(motif,beam.wavelength,{twoThetaMax,ionByElement});
    const spinCount=motif.sites.filter(site=>Math.hypot(...(site.moment||[0,0,0]))>1e-10).length;
    let diagnostic='';
    if(!rows.length){
      if(!spinCount) diagnostic=' No nonzero magnetic moments were found. Check Spins → Use and Source (mCIF / Modify).';
      else {
        const unrestricted=twoThetaMax<179.999 ? magneticBraggPeaks(motif,beam.wavelength,{twoThetaMax:180,ionByElement}) : [];
        if(unrestricted.length) diagnostic=` ${unrestricted.length} reflections exist without the instrument 2θ limit (current limit ${Number(twoThetaMax).toFixed(2)}°). Disable Within S2 Max or adjust the beam/instrument range.`;
        else diagnostic=' Nonzero moments exist, but no magnetic peaks pass the wavelength range/intensity threshold. Try shorter wavelength and verify the magnetic motif.';
      }
    }
    lastMagneticMotif=motif;lastMagneticRows=rows;
    // Only recover the parent reference for mCIFs written by this generator.
    // All structure factors remain evaluated in the actual magnetic cell.
    const fileText=getSelectedCifText();
    const fileQ=propagationVectorsFromMcif(fileText,getSelectedCifStructure());
    const parentInfo=(motif.source==='mCIF' && fileQ.length===1)
      ? parentIndexingFromMcif(fileText,motif.lattice,[fileQ[0].h,fileQ[0].k,fileQ[0].l]) : null;
    lastMagneticParentIndexing=parentInfo;
    const displayRep=parentInfo?.replication || motif.replication;
    const parentKnown=!!parentInfo || motif.source!=='mCIF';
    renderMagneticReflectionRows();
    const cellDescription=parentInfo
      ? `Magnetic supercell ${displayRep.join('×')} relative to the parent cell (parent c=${Number(parentInfo.lattice.c).toFixed(4)} Å; magnetic c=${Number(motif.lattice.c).toFixed(4)} Å).`
      : motif.source==='mCIF'
        ? 'Magnetic cell is taken directly from the imported mCIF; parent-cell indexing is unknown.'
        : `Magnetic supercell ${displayRep.join('×')} relative to the input CIF cell.`;
    // Keep the validation note in the UI; only show this message for empty results or errors.
    message.textContent=rows.length ? '' : (diagnostic.trim() || 'No magnetic reflections were found in the selected range.');
    message.hidden=!message.textContent;
    $('magneticDownloadTable').disabled=!rows.length;
    $('magneticExportBnsInput').disabled=false;
  }catch(err){
    message.textContent=err?.message||String(err);
    message.hidden=false;
  }
}
function downloadMagneticCsv(){
  if(!lastMagneticRows.length)return;
  const replication=lastMagneticParentIndexing?.replication || lastMagneticMotif?.replication || [1,1,1];
  const known=!!lastMagneticParentIndexing || lastMagneticMotif?.source!=='mCIF';
  const prefix=known?'parent':'magnetic';
  const lines=[`${prefix}_h,${prefix}_k,${prefix}_l,form_factor,FM2_barn,two_theta_deg,Q_inv_A,d_A`,
    ...sortedMagneticReflections(lastMagneticRows).map(r=>[
      ...(known?hklInParentCell(r.hkl,replication):r.hkl),
      `"${String(r.formFactor??'1').replace(/"/g,'""')}"`,r.intensity,r.twoTheta,r.q,r.d].join(','))];
  downloadGeneratedCif(lines.join('\n'),'magnetic_reflections.csv');
}
function downloadBnsModel(){
  if(!lastMagneticMotif)return;
  const json=JSON.stringify({version:1,...lastMagneticMotif},null,2);
  downloadGeneratedCif(json,'magnetic_model_for_bns.json');
}
function initializeGeneratorTableOutsideClick(){
  if(document.documentElement.dataset.cifTableOutsideClickBound) return;
  document.documentElement.dataset.cifTableOutsideClickBound='1';
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element ? event.target : event.target?.parentElement;
    if(!target) return;
    // Reflection row click handlers replace their <tr> during rendering. Use
    // the original propagation path, not closest(), so selection is not
    // instantly cleared when the clicked row is detached from the DOM.
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    if(!target.closest('#cifAtomRows .cif-atom-row, #mcifStructurePane, #mcifTabStructure')) clearCifAtomRowSelection();
    if(!target.closest('#cifAtomColorRows .atoms-table-row, #mcifStructurePane, #mcifTabStructure'))clearAppearanceRowSelection();
    if(!target.closest('#cifBondRows .structure-bond-row')) clearStructureBondSelection();
    if(!target.closest('#cifMagMomentRows .structure-moment-row, #mcifStructurePane, #mcifTabStructure')) clearSpinRowSelection();
    if(!path.some(node=>node?.id==='cifReflectionRows')) clearCifReflectionRowSelection();
    if(!path.some(node=>node?.id==='magneticReflectionRows')) clearMagneticReflectionRowSelection();
  });
}
function initializeMagneticReflections(){
  const button=$('magneticCalculateTable');
  if(!button || button.dataset.bound)return;
  button.dataset.bound='1';
  button.addEventListener('click',calculateMagneticReflectionTable);
  $('magneticDownloadTable')?.addEventListener('click',downloadMagneticCsv);
  $('magneticExportBnsInput')?.addEventListener('click',downloadBnsModel);
  for(const th of document.querySelectorAll('.magnetic-sortable-th')){
    const activate=()=>setMagneticReflectionSort(th.dataset.sortKey);
    th.addEventListener('click',activate);
    th.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  }
  updateMagneticSortHeaders();
}

function recalculateGeneratedReflections(){
  if(liveEditorNuclearInvalid){
    clearCifReflectionTable('Complete valid Unit Cell / Positions values to calculate nuclear reflections.');
    return;
  }
  const source=nuclearReflectionSource();
  if(!source){
    const unsupportedParent=!!getSelectedCifStructure()?.magnetic &&
      !crystallographicStructureFromMcif(getSelectedCifStructure(),getSelectedCifText());
    clearCifReflectionTable(unsupportedParent
      ? 'This mCIF does not define a safely convertible parent cell; nuclear reflections were not calculated in the magnetic cell.'
      : 'Select a CIF/mCIF or Generate CIF to calculate nuclear reflections.');
    return;
  }
  try{
    const beam=currentCifReflectionBeam();
    const filters=currentCifReflectionFilters();
    let twoThetaMax=180;
    if(filters.withinS2Max){
      const inst=currentInstrument();
      twoThetaMax=Math.min(180,effectiveS2MaxAtEi(inst,beam.effectiveEnergy,beam.lambdaHalf));
      if(!Number.isFinite(twoThetaMax)) throw new Error("Instrument 2θ maximum is unavailable.");
    }
    const liveSource=liveEditorNuclearSource || nuclearReflectionWithSampleLattice(source);
    lastGeneratedReflections=buildCifReflectionTable(liveSource.structure,liveSource.spaceGroup,beam.wavelength,filters,twoThetaMax);
    renderCifReflectionTable();
    if($("cifDownloadTable")) $("cifDownloadTable").disabled=!lastGeneratedReflections.length;
  }catch(err){
    clearCifReflectionTable(err?.message||String(err));
  }
}

// v59: Nuclear/magnetic editors and all four results share one output workspace.
// Retain setCifOutputTab for legacy callers and restore logic.
function showUnifiedCifPreview(text,label){
  if($("cifPreview")) $("cifPreview").textContent=String(text||"");
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=String(label||"CIF/mCIF Preview");
  setUnifiedGeneratorOutputTab('preview',{persist:true});
}
const GENERATOR_OUTPUT_TABS={
  structure:['mcifTabStructure','mcifStructurePane'],
  reflections:['cifOutputTabReflections','generatorReflectionsPane'],
  preview:['cifOutputTabPreview','cifPreviewPanel']
};
function setUnifiedGeneratorOutputTab(name,{persist=false}={}){
  if(name==='cif-preview'||name==='mcif-preview') name='preview';
  if(!GENERATOR_OUTPUT_TABS[name]) name='structure';
  for(const [key,[tabId,paneId]] of Object.entries(GENERATOR_OUTPUT_TABS)){
    const selected=key===name;
    $(tabId)?.classList.toggle('active',selected);
    $(tabId)?.setAttribute('aria-selected',String(selected));
    $(tabId)?.setAttribute('tabindex',selected?'0':'-1');
    $(paneId)?.classList.toggle('hidden',!selected);
  }
  if(persist && generatorOutputTabRestored) try{ localStorage.setItem(GENERATOR_OUTPUT_TAB_STORAGE_KEY,name); }catch(_e){}
  requestGeneratorViewportHeightSync();
  if(name==='structure') requestAnimationFrame(renderCifStructureIfVisible);
  if(name==='reflections' && $('generatorReflectionsMagnetic')?.classList.contains('active'))
    calculateMagneticReflectionTable();
}
function setCifOutputTab(tab){
  setUnifiedGeneratorOutputTab(tab==='reflections'?'reflections':'preview');
}
function setGeneratorMode(name){
  if(name!=='magnetic') name='nuclear';
  for(const [mode,tabId,paneId] of [['nuclear','generatorModeNuclear','generatorNuclearPane'],['magnetic','generatorModeMagnetic','generatorMagneticPane']]){
    const on=mode===name;
    $(tabId)?.classList.toggle('active',on);
    $(tabId)?.setAttribute('aria-selected',String(on));
    $(tabId)?.setAttribute('tabindex',on?'0':'-1');
    $(paneId)?.classList.toggle('hidden',!on);
  }
  try{localStorage.setItem('tas-simulator-generator-mode-v1',name);}catch(_e){}
}
function setGeneratorReflectionMode(_requestedMode){
  // Magnetic reflection intensity remains under validation. Disable the tab
  // at the navigation layer, including persisted "magnetic" selections from
  // older builds, without deleting any of the calculation implementation.
  const name='nuclear';
  const magneticTab=$('generatorReflectionsMagnetic');
  if(magneticTab){
    magneticTab.disabled=true;
    magneticTab.setAttribute('aria-disabled','true');
    magneticTab.tabIndex=-1;
  }
  for(const [mode,tabId,paneId] of [['nuclear','generatorReflectionsNuclear','generatorNuclearReflectionsPane'],['magnetic','generatorReflectionsMagnetic','generatorMagneticReflectionsPane']]){
    const on=mode===name;
    $(tabId)?.classList.toggle('active',on);
    $(tabId)?.setAttribute('aria-selected',String(on));
    $(tabId)?.setAttribute('tabindex',on?'0':'-1');
    $(paneId)?.classList.toggle('hidden',!on);
  }
  try{localStorage.setItem(GENERATOR_REFLECTION_MODE_KEY,name);}catch(_e){}
}

function generateCifForReview(){
  const generated=buildGeneratedCif();
  lastGeneratedCifText=generated.text;
  lastGeneratedCifName=generated.filename;
  lastGeneratedCifParsed=generated.parsed;
  lastGeneratedCifSpaceGroup=generated.sg;
  cifStructureSourcePreference="generated";
  saveStructureViewerState();
  if($("cifPreview")) $("cifPreview").textContent=generated.text;
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=`Generated file: ${generated.filename}`;
  setCifGeneratedReady(true);
  recalculateGeneratedReflections();
  renderCifStructureIfVisible();
  setCifGeneratorMessage(`Generated ${generated.filename}: ${generated.sg.hm}, ${generated.atoms.length} asymmetric site(s), ${generated.parsed.atoms.length} expanded atom(s). Review the CIF, structure, and reflections, then Download CIF or Set CIF.`);
  return generated;
}

function downloadGeneratedCif(text,filename){
  const blob=new Blob([text],{type:"chemical/x-cif;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function downloadCifReflectionTable(){
  if(!lastGeneratedReflections.length) throw new Error("No reflections are available to download.");
  const rows=sortedCifReflections(lastGeneratedReflections,cifReflectionSort);
  const csv=[
    ["h","k","l","|F|^2 (barn)","Multiplicity","Total |F|^2 (barn)","2theta (deg)","Q (A^-1)","d (A)"].join(","),
    ...rows.map(r=>[r.hkl[0],r.hkl[1],r.hkl[2],r.intensity/100,r.multiplicity,r.totalIntensity/100,r.twoTheta,r.q,r.d].join(","))
  ].join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const source=nuclearReflectionSource();
  a.href=url; a.download=`${cleanCifBaseName(source?.fileName||"selected_structure.cif")}_reflection_table.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function normalizedSpaceGroupSymbol(value){
  return String(value||"").toLowerCase().replace(/[\s_'".]/g,"");
}

function findGeneratorSpaceGroup(parsed){
  const n=Number(parsed?.spaceGroupNumber);
  if(Number.isFinite(n)){
    const byNumber=cifSpaceGroups.find(x=>x.number===n);
    if(byNumber) return byNumber;
  }
  const sym=normalizedSpaceGroupSymbol(parsed?.spaceGroup);
  if(!sym) return null;
  return cifSpaceGroups.find(x=>normalizedSpaceGroupSymbol(x.hm)===sym || normalizedSpaceGroupSymbol(x.hall)===sym) || null;
}

function loadParsedCifIntoGenerator(parsed,fileName="selected_structure.cif",{message=true}={}){
  if(!parsed) return false;
  const sg=findGeneratorSpaceGroup(parsed);
  if(!sg) return false;
  const lattice=parsed.lattice || {};
  for(const key of ["a","b","c","alpha","beta","gamma"]){
    if(!Number.isFinite(Number(lattice[key]))) return false;
  }
  if(!Array.isArray(parsed.asymmetricSites) || !parsed.asymmetricSites.length) return false;
  if(!$("cifSpaceGroup") || !$("cifAtomRows")) return false;
  if(message){ cifStructureSourcePreference="loaded"; saveStructureViewerState(); }
  selectCifSpaceGroup(sg.number,{syncSystem:true});
  for(const [key,id] of Object.entries(CIF_LATTICE_FIELDS)) if($(id)) $(id).value=String(lattice[key]);
  structurePositionEditingMode='sites';
  structurePositionTableElement='*';
  positionModeDrafts.sites=null;positionModeDrafts.individual=null;
  positionManualSourceSignature=null;
  positionSavedSourcePreference=null;
  replaceCifAtomRows(parsed.asymmetricSites.map(a=>({element:a.element,x:a.x,y:a.y,z:a.z,occupancy:a.occupancy,Biso:a.Biso ?? 0,Uaniso:a.Uaniso ?? null})));
  refreshPositionTableToolbar();
  if($("cifGeneratedName")) $("cifGeneratedName").value=cleanCifBaseName(fileName);
  updateCifSpaceGroupInfo();
  if(parsed.magnetic) for(const [key,id] of Object.entries(CIF_LATTICE_FIELDS)) if($(id)) $(id).value=String(lattice[key]);
  invalidateGeneratedCif("");
  if(message) setCifGeneratorMessage(`Loaded ${fileName} for editing: #${sg.number} ${sg.hm}, ${parsed.asymmetricSites.length} asymmetric site(s). Open Structure to view it immediately, or press Generate to review the regenerated CIF and reflection table.`);
  renderCifStructureIfVisible();
  return true;
}

async function loadCifIntoGenerator(file){
  if(!file) return;
  const text=await file.text();
  // The Generator used to keep its own private file snapshot.  As a result,
  // Sample, Neutron Attenuation, mCIF Generator and the file-name display
  // continued to reference a different CIF.  Import through the SAME shared
  // loader used by the Sample and mCIF Set actions, preserving the original
  // CIF/mCIF text (magnetic loops, propagation vectors, etc.).
  const parsed=loadCifText(text,file.name);
  const nuclearEditor=crystallographicStructureFromMcif(parsed,text)||parsed;
  const sg=findGeneratorSpaceGroup(nuclearEditor);
  const lattice=nuclearEditor?.lattice||{};
  const validLattice=["a","b","c","alpha","beta","gamma"]
    .every(key=>Number.isFinite(Number(lattice[key])));
  const editable=!!sg && validLattice &&
    Array.isArray(nuclearEditor.asymmetricSites) && nuclearEditor.asymmetricSites.length>0;
  if(editable){
    // loadCifText already filled the editable Generator fields.  Preserve the
    // previous "loaded" viewer behavior until an input is edited.
    loadedGeneratorCifStructure=parsed;
    loadedGeneratorCifName=file.name;
    cifStructureSourcePreference="loaded";
    setCifGeneratorMessage(`Selected ${file.name} for Sample, CIF Generator, mCIF Generator and Neutron Attenuation. Loaded #${sg.number} ${sg.hm} for editing.`);
  }else{
    // A CIF with an unusual space group can still be a valid shared source,
    // even if the standard-setting CIF Generator cannot edit it automatically.
    loadedGeneratorCifStructure=null;
    loadedGeneratorCifName="";
    cifStructureSourcePreference="selected";
    setCifGeneratorMessage(`Selected ${file.name} for all CIF/mCIF tools. Its space group or atomic sites cannot be imported into the editable CIF Generator; the original file remains available in Show current file.`,true);
  }
  renderCifStructureIfVisible();
}

// mCIF Generator: preserve the complete source symmetry/orbit specification.
let lastGeneratedMcifText="", lastGeneratedMcifName="";
function cleanMcifBaseName(name){
  return cleanStructureBaseName(name);
}
function nextMcifGeneratedBaseName(raw){
  const current=cleanMcifBaseName(raw), matched=current.match(/^(.*)_generate(\d+)$/i);
  return matched?`${matched[1]}_generate${String(Number(matched[2])+1).padStart(2,"0")}`:`${current}_generate01`;
}
function invalidateGeneratedMcif(){
  lastGeneratedMcifText=""; lastGeneratedMcifName="";
  for(const id of ["structureMcifDownload","structureMcifSet"]) if($(id)) $(id).disabled=true;
  if($("cifOutputFormat")?.value==="mcif") setCifGeneratedReady(false);
}
function mcifMessage(message,error=false){
  const el=$("structureMcifMessage"); if(!el) return;
  el.textContent=message; el.classList.toggle("error",error);
}
function mcifPreview(text){
  if($("mcifPreviewText")) $("mcifPreviewText").textContent=text;
  showUnifiedCifPreview(text,`Generated file: ${lastGeneratedMcifName||"mCIF"}`);
}
function crystalComponents(lattice,cart){
  const basis=directLatticeBasis(lattice);
  if(!basis) throw new Error("Invalid unit cell for magnetic vector conversion.");
  const a=vecNormalize(basis.a),b=vecNormalize(basis.b),c=vecNormalize(basis.c);
  const det=vecDot(a,vecCross(b,c));
  if(Math.abs(det)<1e-12) throw new Error("Singular crystallographic axes.");
  return [vecDot(cart,vecCross(b,c))/det,vecDot(cart,vecCross(c,a))/det,vecDot(cart,vecCross(a,b))/det];
}
// The original mCIF is retained to preserve the BNS setting, time reversal,
// atomic site labels, and all magnetic symmetry loops. Replace only the moment loop.
function replaceMcifMoments(source,rows){
  const lines=String(source).replace(/\r\n?/g,"\n").split("\n");
  let start=-1,end=-1;
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().toLowerCase()!=="loop_") continue;
    let j=i+1, tags=[];
    while(j<lines.length && lines[j].trim().startsWith("_")) tags.push(lines[j++].trim().toLowerCase().split(/\s+/)[0]);
    if(!tags.some(x=>x==="_atom_site_moment.label"||x==="_atom_site_moment_label")) continue;
    start=i;end=j;
    while(end<lines.length){
      const line=lines[end].trim();
      if(/^(loop_|data_|save_|stop_|_)/i.test(line)) break;
      end++;
    }
    break;
  }
  const block=["loop_","_atom_site_moment.label","_atom_site_moment.crystalaxis_x","_atom_site_moment.crystalaxis_y","_atom_site_moment.crystalaxis_z","_atom_site_moment.symmform",...rows,""];
  if(start>=0) lines.splice(start,end-start,...block);
  else lines.push("",...block);
  return lines.join("\n");
}
function generateMcifForReview(){
  const source=getSelectedCifText();
  if(!source) throw new Error("Select a CIF/mCIF before generating.");
  if(sourceIsMagneticCif() && importedMagneticEditMode) throw new Error(
    "This imported mCIF has been modified. Export with the original magnetic symmetry is disabled because it may no longer be valid."
  );
  const structure=getSelectedCifStructure();
  if(!structure) throw new Error("Selected structure is unavailable.");
  if(!structure.magnetic){
    const live=currentMomentSettings();
    const settings=(structure.asymmetricSites||[]).map((site,siteIndex)=>{
      const key=momentKey({...site,siteIndex});
      return live.get(key)||structureMomentSettings.get(key)||defaultMomentSetting(site,structure);
    });
    const isIndividual=spinEditingIsIndividual(structure);
    const allIndividualSites=isIndividual?individualSpinCandidates(structure):[];
    const individualSettings=isIndividual ? Object.fromEntries(allIndividualSites.map(site=>[
      site.individualKey.replace(/^individual:/,''),resolveIndividualSpin(site,structure,live)
    ])) : null;
    if(!(individualSettings ? Object.values(individualSettings).some(s=>s.enabled) : settings.some(s=>s.enabled)))
      throw new Error('Enable at least one magnetic site to generate an mCIF.');
    const q=effectivePropagationVectorForStructure();
    const basis=directLatticeBasis(structure.lattice);
    const result=exportCommensurateMcif({source,structure,settings,q:[q.h,q.k,q.l],mode:structureMomentStructureType,
      axis:structureMomentRotationAxisVector(basis),chirality:structureMomentChirality,
      fallbackOperations:findGeneratorSpaceGroup(structure)?.operations||[],
      individualSettings});
    const base=cleanMcifBaseName($('cifGeneratedName')?.value);
    lastGeneratedMcifText=result.text;lastGeneratedMcifName=`${base}.mcif`;
    for(const id of ['structureMcifDownload','structureMcifSet']) if($(id)) $(id).disabled=false;
    mcifPreview(result.text);
    mcifMessage(`Generated ${lastGeneratedMcifName}: ${result.atomCount} atoms in ${result.supercell.join('×')} supercell, ${result.operationCount} magnetic operations, ${result.representatives} independent sites. k ≈ (${result.approximatedQ.join(', ')}).`);
    return;
  }
  const hasMagOps=/_space_group_symop_magn_operation[._]/i.test(source);
  if(!hasMagOps) throw new Error("This generator currently requires an mCIF with magnetic symmetry operations. A nonmagnetic CIF cannot be converted without choosing a magnetic space group.");
  const live=currentMomentSettings();
  const records=[];
  (structure.asymmetricSites||[]).forEach((site,siteIndex)=>{
    const key=momentKey({...site,siteIndex});
    const setting=live.get(key)||structureMomentSettings.get(key)||defaultMomentSetting(site,structure);
    if(!setting.enabled) return;
    const cart=[Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0];
    if(cart.some(x=>!Number.isFinite(x))) throw new Error(`Invalid spin components for ${site.label}`);
    const v=crystalComponents(structure.lattice,cart);
    records.push(`${site.label} ${v.map(x=>Number(x.toFixed(8))).join(" ")} mx,my,mz`);
  });
  if(!records.length) throw new Error("No spin sites enabled. Enable at least one spin.");
  const text=replaceMcifMoments(source,records);
  // Reparse and verify symmetry consistency before allowing Set or Download.
  const check=parseCifStructure(text);
  if(!check.magnetic) throw new Error("Generated file lost magnetic structure information.");
  for(const site of check.asymmetricSites){
    const expected=structure.asymmetricSites.find(x=>x.label===site.label);
    if(!expected) throw new Error(`Magnetic site ${site.label} was lost.`);
  }
  const base=cleanMcifBaseName($("cifGeneratedName")?.value);
  lastGeneratedMcifText=text; lastGeneratedMcifName=`${base}.mcif`;
  for(const id of ["structureMcifDownload","structureMcifSet"]) if($(id)) $(id).disabled=false;
  mcifPreview(text);
  mcifMessage(`Generated ${lastGeneratedMcifName}; magnetic symmetry checked (${check.atoms.filter(a=>Array.isArray(a.magneticMoment)).length} magnetic atoms).`);
}
// The public CIF/mCIF Generator exports all decorated atoms in magnetic P1.
// BNS group classification is NOT inferred; the existing notice stays visible.
function generateP1McifForReview(){
  const generated=buildGeneratedCif();
  const structure=generated.parsed;
  const displayed=currentStructureForViewer()?.structure;
  const sameSites=!!displayed && displayed.asymmetricSites?.length===structure.asymmetricSites?.length &&
    structure.asymmetricSites.every((site,i)=>{
      const other=displayed.asymmetricSites[i];
      return other && site.element===other.element &&
        ["x","y","z"].every(key=>Math.abs(((Number(site[key])-Number(other[key])+0.5)%1+1)%1-0.5)<1e-5);
    });
  const live=currentMomentSettings();
  const settings=(structure.asymmetricSites||[]).map((site,siteIndex)=>{
    const generatedKey=momentKey({...site,siteIndex});
    const displayKey=sameSites?momentKey({...displayed.asymmetricSites[siteIndex],siteIndex}):null;
    return live.get(generatedKey) || (displayKey && live.get(displayKey)) ||
      structureMomentSettings.get(generatedKey) || (displayKey && structureMomentSettings.get(displayKey)) ||
      defaultMomentSetting(site,structure);
  });
  const manual=spinEditingIsIndividual(structure);
  const candidates=manual?individualSpinCandidates(structure):[];
  const individualSettings=manual?Object.fromEntries(candidates.map(site=>[
    site.individualKey.replace(/^individual:/,""),resolveIndividualSpin(site,structure,live)
  ])):null;
  const hasSpin=individualSettings ? Object.values(individualSettings).some(setting=>setting.enabled) :
    settings.some(setting=>setting.enabled);
  if(!hasSpin) throw new Error("Enable at least one magnetic site in Structure editor → Spins before generating an mCIF.");
  const q=effectivePropagationVectorForStructure();
  const basis=directLatticeBasis(structure.lattice);
  const output=exportCommensurateMcif({
    source:generated.text,structure,settings,individualSettings,
    q:[q.h,q.k,q.l],mode:structureMomentStructureType,
    axis:structureMomentRotationAxisVector(basis),chirality:structureMomentChirality,
    p1Only:true
  });
  lastGeneratedMcifText=output.text;
  lastGeneratedMcifName=`${cleanCifBaseName($("cifGeneratedName")?.value)}.mcif`;
  if($("cifPreview")) $("cifPreview").textContent=output.text;
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=`Generated file: ${lastGeneratedMcifName} (magnetic P1)`;
  setCifGeneratedReady(true);
  setCifGeneratorMessage(`Generated ${lastGeneratedMcifName}: magnetic P1, ${output.atomCount} atoms. Review before Download or Set.`);
  return output;
}

function initializeUnifiedOutputActions(){
  const format=$("cifOutputFormat"),generate=$("cifOutputGenerate");
  if(!format || !generate || format.dataset.outputBound) return;
  format.dataset.outputBound="1";
  try{
    const saved=localStorage.getItem(CIF_OUTPUT_FORMAT_STORAGE_KEY);
    if(saved==='cif'||saved==='mcif')format.value=saved;
  }catch(_e){}
  const update=()=>{
    const mcif=format.value==="mcif";
    const word=mcif?"mCIF":"CIF";
    const notice=$("cifMcifBnsNotice");
    if(notice) notice.hidden=!mcif;
    generate.textContent=`Generate ${word}`;
    if($("cifOutputDownload")) $("cifOutputDownload").textContent=`Download ${word}`;
    if($("cifOutputSet")) $("cifOutputSet").textContent=`Set ${word}`;
    const suffix=$("cifUnifiedFileSuffix");
    if(suffix) suffix.textContent=mcif?".mcif":".cif";
    generate.disabled=!cifSpaceGroups.length;
    setCifGeneratedReady(mcif ? !!lastGeneratedMcifText : !!lastGeneratedCifText);
  };
  format.addEventListener("change",()=>{
    try{localStorage.setItem(CIF_OUTPUT_FORMAT_STORAGE_KEY,format.value);}catch(_e){}
    update();
  });
  update();
}
function initMcifGeneratorActions(){
  // mCIF Generate is available; Download/Set remain disabled until generation.
  if($("structureMcifGenerate")) $("structureMcifGenerate").disabled=false;
  invalidateGeneratedMcif();
  $("structureMcifShowCurrent")?.addEventListener("click",()=>{
    if(!getSelectedCifText()){mcifMessage("No current CIF/mCIF selected.",true);return;}
    mcifPreview(getSelectedCifText());mcifMessage(`Showing ${getSelectedCifFileName()}.`);
  });
  $("structureMcifGenerate")?.addEventListener("click",()=>{
    const el=$("cifGeneratedName"),previous=el?.value;
    if(el) el.value=nextMcifGeneratedBaseName(previous);
    try{ generateMcifForReview(); }
    catch(err){if(el)el.value=previous;invalidateGeneratedMcif();mcifMessage(err.message||String(err),true);}
  });
  $("structureMcifDownload")?.addEventListener("click",()=>{
    if(!lastGeneratedMcifText)return;
    downloadGeneratedCif(lastGeneratedMcifText,lastGeneratedMcifName);
    mcifMessage(`Downloaded ${lastGeneratedMcifName}.`);
  });
  $("structureMcifSet")?.addEventListener("click",()=>{
    try{
      if(!lastGeneratedMcifText)throw new Error("Generate mCIF first.");
      if($("sampleMode")?.value!=="single"){
        $("sampleMode").value="single";updateModeVisibility();
      }
      loadCifText(lastGeneratedMcifText,lastGeneratedMcifName);
      $("mcifTabStructure")?.click();renderCifStructureIfVisible();
      mcifMessage(`Set ${lastGeneratedMcifName} as the current mCIF.`);
    }catch(err){mcifMessage(err.message||String(err),true);}
  });
  // Any change to the source cell, atomic positions, or magnetic model makes
  // the previously reviewed mCIF stale (not just editing an XYZ spin field).
  const magneticSourceChanged=ev=>{
    const target=ev.target;
    if(target?.closest?.('#cifAtomRows, #cifAtomDetailedRows, #cifMagMomentRows, #cifSpinBulkCheckbox') ||
       ['cifA','cifB','cifC','cifAlpha','cifBeta','cifGamma',
        'cifSpaceGroup','cifSpaceGroupNumber','cifCrystalSystem',
        'cifMomentPropagationVector','cifMomentStructureType','cifMomentRotationAxis',
        'cifMomentChirality','cifSpinEditingMode'].includes(target?.id)){
      invalidateGeneratedMcif();
    }
  };
  document.querySelector('.structure-control-section')?.addEventListener('input',magneticSourceChanged);
  document.querySelector('.structure-control-section')?.addEventListener('change',magneticSourceChanged);
  $('propagationVectors')?.addEventListener('input',invalidateGeneratedMcif);
  $('propagationVectors')?.addEventListener('change',invalidateGeneratedMcif);
}

async function initializeCifGenerator(){
  const select=$("cifSpaceGroup");
  if(!select) return;
  restoringCifStartup=true;
  try{
    const response=await fetch("space-groups.json",{cache:"no-store"});
    if(!response.ok) throw new Error(`space-groups.json returned HTTP ${response.status}`);
    const data=await response.json();
    cifSpaceGroups=Array.isArray(data) ? data : data.space_groups;
    if(!Array.isArray(cifSpaceGroups) || cifSpaceGroups.length!==230) throw new Error("space-groups.json does not contain the expected 230 standard space groups.");
    populateSampleSpaceGroupControls();
    if($("cifCrystalSystem")) $("cifCrystalSystem").value="custom";
    populateCifSpaceGroupOptions(1);
    if(!getSelectedCifStructure()) restoreSelectedCifLocal();
    // Keep the editor's own initial cell until a structure is loaded.
    // A bootstrap placeholder must not overwrite a saved editor draft
    // before restoreCifGeneratorAtomsState() has had a chance to read it.
    restoringCifGeneratorAtoms=true;
    try{addCifAtomRow({element:"",x:0,y:0,z:0,occupancy:1},{invalidate:false});}
    finally{restoringCifGeneratorAtoms=false;}
    updateCifSpaceGroupInfo();
    syncCifReflectionBeamFromInstrument();
    if(getSelectedCifStructure()){
      const loaded=getSelectedCifStructure(),source=getSelectedCifText();
      loadParsedCifIntoGenerator(crystallographicStructureFromMcif(loaded,source)||loaded,
        getSelectedCifFileName()||"selected_structure.cif",{message:false});
      updateImportedUnitCellPanels(loaded,source);
    }
    // Current, user-edited values win on a normal reload. New-file imports
    // are separately handled by loadCifText(..., {persist:true}).
    restoreCifGeneratorAtomsState();
    restoreMagneticCellDraft();
    initializePositionTableToolbar();
    bindMagneticCellEditor();
    // Keep the generator cell, symmetry choice and title together with atomic
    // rows. Programmatic constraint updates settle before the change handler.
    for(const id of [...Object.values(CIF_LATTICE_FIELDS),'cifCrystalSystem',
      'cifSpaceGroup','cifSpaceGroupNumber','cifGeneratedName']){
      const field=$(id);
      if(!field || field.dataset.draftSaveBound)continue;
      field.dataset.draftSaveBound='1';
      field.addEventListener('input',()=>saveCifGeneratorAtomsState());
      field.addEventListener('change',()=>saveCifGeneratorAtomsState());
    }

    setCifGeneratedReady(false);
    // Explicit startup synchronization: assigning select.value never fires
    // a change event, and downstream generic persistence must not own it.
    $("cifOutputFormat")?.dispatchEvent(new Event("change"));
    recalculateGeneratedReflections();
    setUnifiedGeneratorOutputTab(readSavedGeneratorOutputTab());
    generatorOutputTabRestored=true;
    restoreStructureViewerState();
    // The loaded CIF/mCIF is authoritative after ALL editor/viewer restores.
    // The saved sidebar settings may predate the file import, and the editor
    // may initially start in Custom. Align both SG controls to the file.
    const restoredFileGroup=getSelectedCifStructure() &&
      findGeneratorSpaceGroup(crystallographicStructureFromMcif(getSelectedCifStructure(),getSelectedCifText())||getSelectedCifStructure());
    if(restoredFileGroup){
      setSampleSpaceGroup(restoredFileGroup.number,{recalc:false});
      // Leave the restored editor draft authoritative; only synchronize Sample.
      updateCifSpaceGroupInfo();
    }

    select.addEventListener("change",updateCifSpaceGroupInfo);
    $("cifCrystalSystem")?.addEventListener("change",()=>{
      const before=Number(select.value);
      const selected=populateCifSpaceGroupOptions(before);
      updateCifSpaceGroupInfo();
      if(selected?.number!==before){
        // A new System may select a different group. Reuse the existing
        // change listeners for Sample synchronization and recalculation.
        select.dispatchEvent(new Event("change",{bubbles:true}));
        invalidateGeneratedCif("");
      }
    });
    bindSpaceGroupIntegerEntry($("cifSpaceGroupNumber"));
    $("cifSpaceGroupNumber")?.addEventListener("change",jumpToCifSpaceGroupNumber);
    $("cifSpaceGroupNumber")?.addEventListener("keydown",ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); jumpToCifSpaceGroupNumber(); } });
    // Cell synchronization applies constraints on change, not each keystroke.
    $("cifGeneratedName")?.addEventListener("change",()=>{
      $("cifGeneratedName").value=cleanCifBaseName($("cifGeneratedName").value);
      invalidateGeneratedMcif();
    });

    // Any structure-input edit invalidates the reviewed/generated snapshot.
    // Download/Set therefore always operate on exactly what the user last reviewed.
    const inputPane=document.querySelector(".cif-generator-input-pane");
    const outputPane=document.querySelector(".cif-generator-output-pane");

    // Keep the CIF output frame equal to the actual Structure input frame on
    // desktop.  The output content itself remains scrollable; generated CIF
    // text / reflection rows must never grow the outer workspace.
    const syncCifOutputPaneHeight=()=>{
      if(!inputPane || !outputPane) return;
      if(window.matchMedia("(max-width: 1180px)").matches){
        outputPane.style.height="";
        return;
      }
      const h=Math.ceil(inputPane.getBoundingClientRect().height);
      if(h>0) outputPane.style.height=`${h}px`;
    };
    if(typeof ResizeObserver!=="undefined" && inputPane){
      const cifInputResizeObserver=new ResizeObserver(syncCifOutputPaneHeight);
      cifInputResizeObserver.observe(inputPane);
    }
    window.addEventListener("resize",syncCifOutputPaneHeight);
    requestAnimationFrame(syncCifOutputPaneHeight);

    const physicalEditorChanged=ev=>{
      const target=ev.target;
      if(!target) return;
      const physical=target.closest?.('#cifAtomRows, #cifAtomDetailedRows') ||
        ['cifSpaceGroup','cifSpaceGroupNumber','cifA','cifB','cifC','cifAlpha','cifBeta','cifGamma'].includes(target.id);
      if(!physical) return;
      // Crystallographic inputs have their own direct listeners below.  The
      // delegated handler only invalidates the draft / schedules calculations.
      liveNuclearCellReference="editor";
      updateLiveEditorNuclearSource();
      scheduleLiveReflectionRecalc({nuclear:true,magnetic:true});
    };
    // Directly bind the editable Cell fields.  Delegated change handling alone
    // proved unreliable when the editor is switched/rebuilt or another field
    // contains an incomplete numeric entry.
    const onEditorCellInput=ev=>{
      const id=ev.currentTarget?.id || ev.target?.id || "";
      syncCrystallographicCell("editor",{refresh:true,changedId:id,commit:ev.type==="change"});
    };
    for(const id of ["cifA","cifB","cifC","cifAlpha","cifBeta","cifGamma"]){
      $(id)?.addEventListener("input",onEditorCellInput);
      $(id)?.addEventListener("change",onEditorCellInput);
    }
    for(const id of ["cifSpaceGroup","cifSpaceGroupNumber"]){
      $(id)?.addEventListener("change",onEditorCellInput);
    }
    inputPane?.addEventListener("input",ev=>{
      // Magnetic-cell parameters are a separate draft. Do not switch the
      // nuclear editor/Structure source to a generated CIF when editing them.
      if(ev.target?.id?.startsWith('cifMag') ||
         ['cifPositionEditingMode','cifPositionTableElement'].includes(ev.target?.id))return;
      physicalEditorChanged(ev);
      if(["cifLoadFile","cifReflectionEnergy","cifReflectionWavelength","cifReflectionWavevector"].includes(ev.target?.id)) return;
      if(cifStructureSourcePreference==="loaded") cifStructureSourcePreference="generated";
      invalidateGeneratedCif();
      renderCifStructureIfVisible();
    });
    inputPane?.addEventListener("change",ev=>{
      // Magnetic-cell parameters are a separate draft. Do not switch the
      // nuclear editor/Structure source to a generated CIF when editing them.
      if(ev.target?.id?.startsWith('cifMag') ||
         ['cifPositionEditingMode','cifPositionTableElement'].includes(ev.target?.id))return;
      physicalEditorChanged(ev);
      if(["cifLoadFile","cifReflectionEnergy","cifReflectionWavelength","cifReflectionWavevector"].includes(ev.target?.id)) return;
      if(cifStructureSourcePreference==="loaded") cifStructureSourcePreference="generated";
      invalidateGeneratedCif();
      renderCifStructureIfVisible();
    });

    $("cifReloadCurrent")?.addEventListener("click",()=>{
      const text=getSelectedCifText(),name=getSelectedCifFileName()||'selected_structure.cif';
      if(!text){setCifGeneratorMessage('No source CIF/mCIF is available to reload.',true);return;}
      try{
        loadCifText(text,name,{persist:true});
        updateImportedUnitCellPanels(getSelectedCifStructure(),getSelectedCifText());
        setCifGeneratorMessage(`Reloaded the original ${name}.`);
      }catch(err){setCifGeneratorMessage(err?.message||String(err),true);}
    });
    $("cifShowCurrent")?.addEventListener("click",()=>{
      const text=getSelectedCifText();
      if(!text){setCifGeneratorMessage("No current CIF/mCIF is selected.",true);return;}
      const fileName=getSelectedCifFileName()||"selected CIF/mCIF";
      showUnifiedCifPreview(text,`Loaded file: ${fileName}`);
      setCifGeneratorMessage(`Showing loaded file: ${fileName}.`);
    });
    $("cifShowGenerated")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const text=mcif?lastGeneratedMcifText:lastGeneratedCifText;
      const fileName=mcif?lastGeneratedMcifName:lastGeneratedCifName;
      if(!text){setCifGeneratorMessage(`Generate ${mcif?"mCIF":"CIF"} first to show its output.`,true);return;}
      showUnifiedCifPreview(text,`Generated file: ${fileName}`);
      setCifGeneratorMessage(`Showing generated file: ${fileName}.`);
    });
    $("cifCopyAtom")?.addEventListener("click",copySelectedCifAtomRows);
    $("cifRemoveAtom")?.addEventListener("click",removeSelectedCifAtomRows);
    $("cifAddAtom")?.addEventListener("click",()=>addCifAtomRow());
    $("cifLoadExisting")?.addEventListener("click",()=>$("cifLoadFile")?.click());
    // Clear is shared, too: all three filename fields and attenuation reset.
    $("cifGeneratorSourceClear")?.addEventListener("click",clearSelectedCif);
    $("cifLoadFile")?.addEventListener("change",async ev=>{
      const file=ev.target.files?.[0];
      try{ await loadCifIntoGenerator(file); }
      catch(err){ setCifGeneratorMessage(err?.message||String(err),true); }
      finally{ ev.target.value=""; }
    });

    $("cifOutputGenerate")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const nameInput=$("cifGeneratedName");
      const previousName=nameInput?.value ?? "generated_structure";
      if(nameInput) nameInput.value=nextCifGeneratedBaseName(previousName);
      try{ if(mcif) generateP1McifForReview(); else generateCifForReview(); }
      catch(err){
        if(nameInput) nameInput.value=previousName;
        if(mcif) invalidateGeneratedMcif(); else invalidateGeneratedCif("");
        setCifGeneratorMessage(err?.message||String(err),true);
      }
    });
    $("cifOutputDownload")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const text=mcif?lastGeneratedMcifText:lastGeneratedCifText;
      const name=mcif?lastGeneratedMcifName:lastGeneratedCifName;
      if(!text){ setCifGeneratorMessage("Press Generate before downloading.",true); return; }
      downloadGeneratedCif(text,name);
      setCifGeneratorMessage(`Downloaded ${name}.`);
    });
    $("cifDownloadTable")?.addEventListener("click",()=>{
      try{ downloadCifReflectionTable(); }
      catch(err){ setCifGeneratorMessage(err?.message||String(err),true); }
    });
    $("cifOutputSet")?.addEventListener("click",()=>{
      try{
        const mcif=$("cifOutputFormat")?.value==="mcif";
        const text=mcif?lastGeneratedMcifText:lastGeneratedCifText;
        const name=mcif?lastGeneratedMcifName:lastGeneratedCifName;
        if(!text) throw new Error(`Press Generate before setting the ${mcif?"mCIF":"CIF"}.`);
        if($("sampleMode")?.value!=="single"){
          $("sampleMode").value="single"; updateModeVisibility();
        }
        const parsed=loadCifText(text,name);
        cifStructureSourcePreference="selected";
        saveStructureViewerState();
        renderCifStructureIfVisible();
        setCifGeneratorMessage(`Set ${name} as the selected ${mcif?"mCIF":"CIF"}: ${parsed.atoms.length} expanded atom(s).`);
      }catch(err){ setCifGeneratorMessage(err?.message||String(err),true); }
    });

    for(const button of document.querySelectorAll("[data-generator-output-tab]")){
      button.addEventListener("click",()=>setUnifiedGeneratorOutputTab(button.dataset.generatorOutputTab,{persist:true}));
    }
    // Only Nuclear can be selected until magnetic reflections are validated.
    $('generatorReflectionsNuclear')?.addEventListener('click',()=>setGeneratorReflectionMode('nuclear'));
    // Attach the actual Calculate / CSV / BNS buttons. The magnetic pane can
    // be visible without these listeners if only the tab switch is wired.
    initializeMagneticReflections();
    initializeGeneratorTableOutsideClick();
    let savedReflectionMode='nuclear';
    try{savedReflectionMode=localStorage.getItem(GENERATOR_REFLECTION_MODE_KEY)||'nuclear';}catch(_e){}
    setGeneratorReflectionMode(savedReflectionMode);
    $("tabCifGenerator")?.addEventListener("click",()=>requestAnimationFrame(renderCifStructureIfVisible));
    if($("cifSaveFigure")) $("cifSaveFigure").onclick=()=>saveStructureFigure().catch(err=>{alert(`Save figure failed: ${err?.message||err}`);});
    
    const unitCellSelect=$("cifUnitCellMode");
    if(unitCellSelect){ unitCellSelect.value=structureUnitCellMode; unitCellSelect.addEventListener("change",()=>{ structureUnitCellMode=unitCellSelect.value; saveStructureViewerState(); renderCifStructureIfVisible(); }); }
    const cellReferenceSelect=$("cifUnitCellReference");
    if(cellReferenceSelect){ cellReferenceSelect.value=structureUnitCellReference;
      cellReferenceSelect.addEventListener("change",()=>{
        structureUnitCellReference=cellReferenceSelect.value==="magnetic"?"magnetic":"crystallographic";
        updateStructureUnitCellReference(currentStructureForViewer());
        saveStructureViewerState();renderCifStructureIfVisible();
      });
    }
    const xyzSelect=$("cifShowXYZ");
    if(xyzSelect){ xyzSelect.value=structureShowXYZ?"show":"hide"; xyzSelect.addEventListener("change",()=>{ structureShowXYZ=xyzSelect.value!=="hide"; saveStructureViewerState(); renderCifStructureIfVisible(); }); }
    $("structureCifSelect")?.addEventListener("click",()=>$("cifFileInput")?.click());
    $("structureCifClear")?.addEventListener("click",clearSelectedCif);
    for(const button of document.querySelectorAll("[data-cif-structure-view]")){
      button.addEventListener("click",()=>{
        cifStructureViewMode=button.dataset.cifStructureView || "a";
        structureCameraPresetRevision++;
        // Prevent the old WebGL camera from overwriting this preset while the
        // replacement Plotly scene is being prepared.
        stopStructureCameraWatch();
        structureProgrammaticCameraUpdate=true;
        const source=currentStructureForViewer();
        const basis=directLatticeBasis(source?.structure?.lattice);
        if(basis){
          // IMPORTANT: do not apply a preset view with Plotly.relayout().
          // In Plotly gl3d that can leave the live WebGL camera detached from
          // _fullLayout.scene.camera until the next Plotly.react() (for example
          // after editing x/y/z range).  The coordinate triads then see a stale
          // camera and appear frozen.  Store the requested camera and rebuild the
          // scene through the same Plotly.react() path used by normal viewer
          // redraws so the live camera and layout camera stay synchronized.
          const camera=structureCameraForView(cifStructureViewMode,basis,currentStructureCameraDistance());
          structureCameraState=copyStructureCamera(camera);
          structureCameraWatchSignature="";
          updateStructureOrientationTriads(basis,camera);
        }
        saveStructureViewerState();
        renderCifStructureView();
      });
    }
    prepareStructureViewerControls();
    // Changing display mode must rebuild the geometry immediately.
    syncStructureBondDisplayModeControls();
    for(const input of document.querySelectorAll('input[name="cifStructureStyle"]')){
      if(input.dataset.styleModeBound)continue;
      input.dataset.styleModeBound='1';
      input.addEventListener('change',()=>{
        if(!input.checked)return;
        structureBondDisplayMode=['bonds','polyhedral','both'].includes(input.value)?input.value:'bonds';
        saveStructureViewerState();
        renderCifStructureIfVisible();
      });
    }
    const styleBulkToggle=$("cifStyleBulkCheckbox");
    if(styleBulkToggle && !styleBulkToggle.dataset.structureBound){
      styleBulkToggle.dataset.structureBound="1";
      styleBulkToggle.addEventListener("change",()=>setAllStructureBondRulesVisible(styleBulkToggle.checked));
    }
    $("cifAddBondRule")?.addEventListener("click",()=>addStructureBondRule());
    $("cifCopyBondRule")?.addEventListener("click",copySelectedStructureBondRules);
    $("cifRemoveBondRule")?.addEventListener("click",removeSelectedStructureBondRules);
    // Split range controls bind themselves in createSplitRangeControls(). The
    // legacy combined inputs stay hidden and synchronized only for saved-state
    // compatibility; do not attach redraw handlers to them.
    const propagationStructureRefresh=()=>{ refreshMomentPropagationVectorSelect(); saveStructureViewerState(); renderCifStructureIfVisible(); };
    $("propagationVectors")?.addEventListener("input",propagationStructureRefresh);
    $("propagationVectors")?.addEventListener("change",()=>{
      if(structureSpinEditingMode==='individual'){
        for(const [key,value] of currentMomentSettings())structureMomentSettings.set(key,value);
        $('cifMagMomentRows')?.replaceChildren();
        updateMagneticMomentRows(currentStructureForViewer()?.structure||null);
      }
      propagationStructureRefresh();
    });
    $("propagationVectors")?.addEventListener("click",()=>requestAnimationFrame(propagationStructureRefresh));
    $("addPropagationVector")?.addEventListener("click",()=>requestAnimationFrame(propagationStructureRefresh));
    for(const th of document.querySelectorAll(".cif-sortable-th:not(.magnetic-sortable-th)")){
      const activate=()=>setCifReflectionSort(th.dataset.sortKey);
      th.addEventListener("click",activate);
      th.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();activate();}});
    }
    updateCifReflectionSortHeaders();
    const reflectionFilterIds=[
      "cifReflectionAlongU","cifReflectionAlongV",
      "cifReflectionWithinS2Max","cifReflectionLambdaHalf"
    ];
    for(const id of reflectionFilterIds){
      $(id)?.addEventListener("change",recalculateGeneratedReflections);
    }
    $("cifReflectionEnergy")?.addEventListener("change",()=>syncCifReflectionBeamFrom("energy"));
    $("cifReflectionWavelength")?.addEventListener("change",()=>syncCifReflectionBeamFrom("wavelength"));
    $("cifReflectionWavevector")?.addEventListener("change",()=>syncCifReflectionBeamFrom("wavevector"));
    // Instrument configuration supplies the default Generator beam condition.
    const syncGeneratorBeam=()=>{ syncCifReflectionBeamFromInstrument(); recalculateGeneratedReflections(); };
    $("energy")?.addEventListener("input",syncGeneratorBeam);
    $("energy")?.addEventListener("change",syncGeneratorBeam);
    $("energyMode")?.addEventListener("change",syncGeneratorBeam);
    $("instrument")?.addEventListener("change",syncGeneratorBeam);
    $("S2maxUser")?.addEventListener("change",recalculateGeneratedReflections);
    $("S2maxEffective")?.addEventListener("change",recalculateGeneratedReflections);
    // Synchronize both crystallographic panels, then recompute nuclear peaks.
    const onSampleLatticeInput=ev=>syncCrystallographicCell("sample",{changedId:ev.target?.id||"",commit:ev.type==="change"});
    for(const id of ['a','b','c','alpha','beta','gamma']){
      $(id)?.addEventListener('input',onSampleLatticeInput);
      $(id)?.addEventListener('change',onSampleLatticeInput);
    }
    for(const id of ['sampleSpaceGroup','sampleSpaceGroupNumber']){
      $(id)?.addEventListener('change',onSampleLatticeInput);
    }
    // Positions is a sibling of .cif-generator-input-pane in the unified UI,
    // so inputPane's delegated listeners never receive its input/change events.
    // Bind directly to stable row containers; their child rows are rebuilt on
    // import, paste, copy and deletion.
    const onLivePositionsEdit=event=>{
      if(!event.target?.matches?.('input, select')) return;
      liveNuclearCellReference="editor";
      updateLiveEditorNuclearSource();
      scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
    };
    for(const id of ["cifAtomRows","cifAtomDetailedRows"]){
      const host=$(id);
      if(host && !host.dataset.nuclearLiveBound){
        host.addEventListener("input",onLivePositionsEdit);
        host.addEventListener("change",onLivePositionsEdit);
        host.dataset.nuclearLiveBound="1";
      }
    }
    // Structural row operations do not necessarily emit an input/change event.
    // Rebuild the calculation snapshot after the click handler mutates rows.
    for(const id of ["cifAddAtom","cifRemoveAtom","cifCopyAtom"]){
      const button=$(id);
      if(button && !button.dataset.nuclearLiveBound){
        button.addEventListener("click",()=>requestAnimationFrame(()=>{
          liveNuclearCellReference="editor";
          updateLiveEditorNuclearSource();
          scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
        }));
        button.dataset.nuclearLiveBound="1";
      }
    }
    // Atoms settings can affect displayed structure; keep the nuclear table in
    // step even when controls are rebuilt dynamically. Pure color changes do
    // not alter physical intensities, but are harmlessly coalesced here.
    $("cifAtomColorRows")?.addEventListener("change",()=>scheduleLiveReflectionRecalc({nuclear:true,magnetic:false}));
    // Spins, propagation vector and structure type only affect magnetic peaks.
    // Recalculate automatically only once a magnetic table has been requested.
    const requestMagneticUpdate=()=>scheduleLiveReflectionRecalc({nuclear:false,magnetic:true});
    for(const id of ['cifMagMomentRows','cifMomentStructureType','cifMomentRotationAxis',
      'cifMomentChirality','cifMomentPropagationVector',
      'cifSpinEditingMode','propagationVectors']){
      $(id)?.addEventListener('input',requestMagneticUpdate);
      $(id)?.addEventListener('change',requestMagneticUpdate);
    }
    for(const id of ["Uh","Uk","Ul","Vh","Vk","Vl"]){
      $(id)?.addEventListener("change",recalculateGeneratedReflections);
    }
    requestAnimationFrame(renderCifStructureIfVisible);
  }catch(err){
    select.innerHTML='<option value="">Space-group data unavailable</option>';
    for(const id of ["cifLoadExisting","cifOutputGenerate","cifOutputDownload","cifDownloadTable","cifOutputSet","cifSpaceGroupNumber"]){ if($(id)) $(id).disabled=true; }
    setCifGeneratorMessage(`CIF Generator could not load space-group data: ${err?.message||String(err)}`,true);
  }finally{
    // The whole asynchronous startup is finished: subsequent real edits
    // must be written immediately, whereas initialization writes were barred.
    restoringCifStartup=false;
  }
}

  initMcifGeneratorActions();
  initializeUnifiedOutputActions();
  // v59: All four output tabs are wired together during initializeCifGenerator.

  return {
    updateCifUI,
    syncSfColorMaxControl,
    selectCifFile,
    clearSelectedCif,
    centeringFromSpaceGroup,
    selectedSampleSpaceGroup,
    selectedSampleCentering,
    setCifOutputTab,
    initializeCifGenerator
  };
}
