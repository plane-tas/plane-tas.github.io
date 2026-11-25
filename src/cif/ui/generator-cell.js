// CIF Generator: messages, space group and lattice constraints.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {applyLatticeConstraints} from '../../core/lattice-constraints.js';

export function installGeneratorCell(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    applyCifLatticeConstraints, clearCifReflectionTable,
    invalidateGeneratedCif, jumpToCifSpaceGroupNumber, populateCifSpaceGroupOptions,
    selectCifSpaceGroup, selectedCifGeneratorSpaceGroup,
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
  cifState.reflectionData=null;
  fn.renderCifReflectionTable?.();
  if($("cifDownloadTable")) $("cifDownloadTable").disabled=true;
  const body=$("cifReflectionRows");
  if(body){
    body.replaceChildren();
    const tr=document.createElement("tr"), td=document.createElement("td");
    td.colSpan=$("cifReflectionHead")?.rows?.[0]?.cells?.length||9; td.className="cif-reflection-empty"; td.textContent=message;
    tr.appendChild(td); body.appendChild(tr);
  }
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
  applyLatticeConstraints(Object.fromEntries(Object.entries(cifState.CIF_LATTICE_FIELDS).map(([key,id])=>[key,$(id)])),sg);
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
