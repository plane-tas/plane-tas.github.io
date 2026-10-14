// CIF Generator: messages, space group, lattice constraints and magnetic cell.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {CIF_MAGNETIC_CELL_STORAGE_KEY} from './constants.js';

export function installGeneratorCell(ctx){
  const {deps:{
    $, getSelectedCifStructure
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    applyCifLatticeConstraints, bindMagneticCellEditor, clearCifReflectionTable,
    invalidateGeneratedCif, jumpToCifSpaceGroupNumber, populateCifSpaceGroupOptions,
    restoreMagneticCellDraft, selectCifSpaceGroup, selectedCifGeneratorSpaceGroup,
    setCifGeneratedReady, setCifGeneratorMessage, updateCifSpaceGroupInfo
  });

function setCifGeneratedReady(ready){
  const mcif=$("cifOutputFormat")?.value==="mcif";
  const hasGeneratedText=mcif ? !!cifState.lastGeneratedMcifText : !!cifState.lastGeneratedCifText;
  const canUse=ready && hasGeneratedText;
  if($("cifOutputDownload")) $("cifOutputDownload").disabled=!canUse;
  if($("cifOutputSet")) $("cifOutputSet").disabled=!canUse;
  // Reflection CSV availability is independent of CIF Generate.  A selected
  // CIF/mCIF can provide reflections without generating any new CIF file.
}

function clearCifReflectionTable(message="No reflections available."){
  cifState.lastGeneratedReflections=[];
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
  cifState.lastGeneratedCifText="";
  cifState.lastGeneratedCifParsed=null;
  cifState.lastGeneratedCifSpaceGroup=null;
  fn.invalidateGeneratedMcif();
  setCifGeneratedReady(false);
  if($("cifPreview")) $("cifPreview").textContent="Press Generate to preview the CIF.";
  // Keep Nuclear Reflections tied to the currently loaded CIF/mCIF even while
  // the draft Nuclear editor is being changed.  No Generate is needed.
  fn.recalculateGeneratedReflections();
  if(message) setCifGeneratorMessage(message);
  fn.renderCifStructureIfVisible();
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

cifState.CIF_LATTICE_FIELDS={a:"cifA",b:"cifB",c:"cifC",alpha:"cifAlpha",beta:"cifBeta",gamma:"cifGamma"};

function selectedCifGeneratorSpaceGroup(){
  const n=Number($("cifSpaceGroup")?.value);
  return cifState.cifSpaceGroups.find(x=>x.number===n) || null;
}

// The bundled standard-setting data calls #143–167 trigonal.  For the
// requested System selector, P-centered trigonal groups join the hexagonal
// lattice family; R-centered groups are classified as rhombohedral.
// "Custom" is P1 only: no imposed space-group symmetry (VESTA-style).
function cifSpaceGroupSystem(sg){
  const crystalSystem=String(sg?.crystal_system||"").toLowerCase();
  if(crystalSystem==="trigonal"){
    return fn.centeringFromSpaceGroup(sg)==="R" ? "rhombohedral" : "hexagonal";
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
  if(!select || !cifState.cifSpaceGroups.length) return null;
  const wanted=cifState.cifSpaceGroups.find(sg=>sg.number===Number(requestedNumber));
  let system=systemInput?.value||"custom";
  if(adaptSystem && wanted && !cifSystemIncludesSpaceGroup(system,wanted)){
    system=cifSpaceGroupSystem(wanted);
    if(systemInput) systemInput.value=system;
  }
  const matching=cifState.cifSpaceGroups.filter(sg=>cifSystemIncludesSpaceGroup(system,sg));
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
  const sg=cifState.cifSpaceGroups.find(entry=>entry.number===Number(number));
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
  const n=fn.readSpaceGroupInteger(entry,Number(select.value)||1);
  if(n===null) return;
  const sg=cifState.cifSpaceGroups.find(x=>x.number===n);
  if(!sg){
    setCifGeneratorMessage(`Space group #${n} is not available.`,true);
    return;
  }
  selectCifSpaceGroup(n);
  updateCifSpaceGroupInfo();
}

function applyCifLatticeConstraints(){
  // Only the crystallographic space group can constrain the nuclear cell.
  // Magnetic lattice editing must not silently inherit a 230-group IT setting.
  const sg=selectedCifGeneratorSpaceGroup();
  if(!sg) return;
  const latticeFields=cifState.CIF_LATTICE_FIELDS;
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
cifState.CIF_MAG_LATTICE_FIELDS={a:'cifMagA',b:'cifMagB',c:'cifMagC',alpha:'cifMagAlpha',beta:'cifMagBeta',gamma:'cifMagGamma'};
const CIF_MAG_CELL_DRAFT_IDS=Object.values(cifState.CIF_MAG_LATTICE_FIELDS);
function saveMagneticCellDraft(){
  if(cifState.restoringCifStartup || !getSelectedCifStructure()?.magnetic)return;
  const values={};
  for(const id of CIF_MAG_CELL_DRAFT_IDS) values[id]=$(id)?.value??'';
  try{localStorage.setItem(CIF_MAGNETIC_CELL_STORAGE_KEY,JSON.stringify({version:1,sourceKey:fn.currentEditorSourceKey(),values}));}catch(_e){}
}
function restoreMagneticCellDraft(){
  if(!getSelectedCifStructure()?.magnetic)return false;
  let saved;
  try{saved=JSON.parse(localStorage.getItem(CIF_MAGNETIC_CELL_STORAGE_KEY)||'null');}catch(_e){return false;}
  if(saved?.version!==1 || saved.sourceKey!==fn.currentEditorSourceKey())return false;
  for(const id of CIF_MAG_CELL_DRAFT_IDS){
    if($(id) && Object.hasOwn(saved.values||{},id))$(id).value=String(saved.values[id]);
  }
  // Older drafts may contain the now-removed crystallographic System/No/SG;
  // deliberately ignore them rather than constraining the magnetic cell.
  return true;
}
function bindMagneticCellEditor(){
  // Do not constrain the magnetic metric using a 230-group crystallographic
  // selector: an imported mCIF already carries the magnetic symmetry.
  for(const [key,id] of Object.entries(cifState.CIF_MAG_LATTICE_FIELDS)){
    const field=$(id);
    field?.addEventListener('input',saveMagneticCellDraft);
    field?.addEventListener('change',()=>{
      const value=Number(field.value);
      if(!Number.isFinite(value) || value<=0 || (['alpha','beta','gamma'].includes(key) && value>=180)){
        field.setCustomValidity('Enter a valid positive cell parameter (angles below 180°).');
      }else field.setCustomValidity('');
      saveMagneticCellDraft();fn.renderCifStructureIfVisible();
    });
  }
}

function copyCurrentLatticeToGenerator(){
  // Copy the Sample's space group as well as its metric.  Updating the space
  // group before applying constraints ensures the two sections use the same
  // standard crystal-system setting (a=b, gamma=120, etc.).
  const sg=fn.selectedSampleSpaceGroup();
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
}
