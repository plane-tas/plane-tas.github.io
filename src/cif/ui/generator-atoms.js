// CIF Generator: atomic positions table (selection, drag-and-drop, anisotropic U).
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installGeneratorAtoms(ctx){
  const {deps:{
    $, parseNumericValue
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    addCifAtomRow, cifAtomRowValues, cifAtomThermalValues, cifPositionInputValue,
    clearCifAtomRowSelection, copySelectedCifAtomRows, initializePositionTableToolbar,
    normalizeCifElement, refreshPositionTableToolbar, removeSelectedCifAtomRows, replaceCifAtomRows,
    selectedPositionContainsAtom, selectedPositionSourceSiteIndices, validateCifAtomNumericInput
  });

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
  if(mode)mode.value=cifState.structurePositionEditingMode;
  if(filter){
    const elements=[...new Set(fn.currentCifGeneratorAtomRows().map(a=>normalizeCifElement(a.element)).filter(Boolean))].sort();
    if(cifState.structurePositionTableElement!=='*'&&!elements.includes(cifState.structurePositionTableElement))cifState.structurePositionTableElement='*';
    filter.replaceChildren();
    for(const [value,label] of [['*','All elements'],...elements.map(el=>[el,el])]){
      const opt=document.createElement('option');opt.value=value;opt.textContent=label;filter.appendChild(opt);
    }
    filter.value=cifState.structurePositionTableElement;
  }
  for(const row of document.querySelectorAll('#cifAtomRows .cif-atom-row')){
    const element=normalizeCifElement(row.querySelector('[data-cif-atom-field="element"]')?.value);
    const visible=cifState.structurePositionTableElement==='*'||element===cifState.structurePositionTableElement;
    row.hidden=!visible; row.style.display=visible?'':'none';
    const paired=document.querySelector(`#cifAtomDetailedRows [data-cif-atom-uid="${row.dataset.cifAtomUid}"]`);
    if(paired){paired.hidden=!visible;paired.style.display=visible?'':'none';}
  }
}
function positionSymmetryDraftSignature(){
  return JSON.stringify({sg:Number($('cifSpaceGroup')?.value),
    cell:Object.values(cifState.CIF_LATTICE_FIELDS).map(id=>$(id)?.value),
    atoms:fn.currentCifGeneratorAtomRows()});
}
function expandPositionDraftToIndividual(){
  // Called while still in Symmetry mode, so buildGeneratedCif() uses the
  // selected space group to create the correct, deduplicated unit-cell orbit.
  const parsed=fn.buildGeneratedCif().parsed;
  const sourceRows=fn.currentCifGeneratorAtomRows();
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
  if(mode===cifState.structurePositionEditingMode)return;
  const sourceMode=cifState.structurePositionEditingMode;
  // Recompute symmetry expansion if the space group, lattice or
  // asymmetric-site draft has changed since the Manual snapshot was made.
  const sourceSignature=mode==='individual'?positionSymmetryDraftSignature():null;
  let next=cifState.positionModeDrafts[mode];
  if(mode==='individual'&&cifState.positionManualSourceSignature!==sourceSignature)next=null;
  if(!next){
    if(mode==='individual'){
      try{next=expandPositionDraftToIndividual();}
      catch(err){const select=$('cifPositionEditingMode');if(select)select.value=sourceMode;
        window.alert(err?.message||String(err));return;}
      cifState.positionManualSourceSignature=sourceSignature;
    }else next=cifState.positionModeDrafts.sites||fn.currentCifGeneratorAtomRows();
  }
  cifState.positionModeDrafts[sourceMode]=fn.currentCifGeneratorAtomRows();
  cifState.structurePositionEditingMode=mode;
  // Do not switch the Structure source to a P1 draft merely by expanding
  // symmetry equivalents in the table. This previously halved the mCIF view.
  const previous=cifState.structurePositionTableElement;
  cifState.restoringCifGeneratorAtoms=true;
  try{replaceCifAtomRows(next);}finally{cifState.restoringCifGeneratorAtoms=false;}
  cifState.structurePositionTableElement=previous;
  clearCifAtomRowSelection();
  refreshPositionTableToolbar();
  fn.saveCifGeneratorAtomsState();
  // Mode only changes editor and appearance grouping, never geometry/reflect.
  const source=fn.currentStructureForViewer();
  if(source?.structure)fn.updateStructureAtomColorRows(fn.structureElements(source.structure),source.structure);
  fn.renderCifStructureIfVisible();
  fn.requestStructureTableHeightSync();
}
function initializePositionTableToolbar(){
  const mode=$('cifPositionEditingMode'),display=$('cifPositionTableElement');
  if(mode&&!mode.dataset.bound){mode.dataset.bound='1';mode.addEventListener('change',()=>changePositionEditingMode(mode.value));}
  if(display&&!display.dataset.bound){display.dataset.bound='1';display.addEventListener('change',()=>{
    cifState.structurePositionTableElement=display.value;
    clearCifAtomRowSelection();refreshPositionTableToolbar();fn.saveCifGeneratorAtomsState();
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
  fn.renderCifStructureIfVisible();
}
function clearCifAtomRowSelection(){
  if(!cifSelectedAtomRows().length) return;
  for(const row of cifSelectedAtomRows()) row.classList.remove('cif-atom-selected');
  cifAtomSelectionAnchor=null;
  refreshCifAtomSelectionUI();
  fn.renderCifStructureIfVisible();
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
  const appearance=fn.parentAppearanceOrbits(structure);
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
    if(cifState.structurePositionEditingMode==='individual'){
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
  fn.saveCifGeneratorAtomsState();
  fn.invalidateGeneratedCif();
  fn.renderCifStructureIfVisible();
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
  fn.invalidateGeneratedCif();
  fn.renderCifStructureIfVisible();
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
  fn.saveCifGeneratorAtomsState();
  fn.invalidateGeneratedCif();
  fn.renderCifStructureIfVisible();
}

let cifAtomDetailedSerial=0;
cifState.CIF_U_FIELDS=["11","22","33","12","13","23"];

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
  for(let i=0;i<cifState.CIF_U_FIELDS.length;i++){
    const cell=document.createElement("div");
    cell.className="cif-thermal-cell";
    const input=document.createElement("input");
    input.type="number";
    input.step="any";
    input.dataset.cifThermalField=`U${cifState.CIF_U_FIELDS[i]}`;
    input.setAttribute("aria-label",`U${cifState.CIF_U_FIELDS[i]} (Å²) for atom`);
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
    fn.saveCifGeneratorAtomsState();
  });
  if(toggle.checked || source) toggle.dataset.initialized="1";
  tableRow.addEventListener("input",fn.saveCifGeneratorAtomsState);
  tableRow.addEventListener("change",fn.saveCifGeneratorAtomsState);
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
    Uij:cifState.CIF_U_FIELDS.map(k=>get(`U${k}`))};
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
    ["element","text",values.element ?? (cifState.structurePositionTableElement==='*'?'':cifState.structurePositionTableElement)],
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
        fn.saveCifGeneratorAtomsState();
      });
    }
    input.addEventListener("input",()=>{
      if(key==="element") {refreshCifAtomDetailedLabels();refreshPositionTableToolbar();}
      fn.saveCifGeneratorAtomsState();
    });
    if(!numeric) input.addEventListener("change",fn.saveCifGeneratorAtomsState);
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
  if(!cifState.restoringCifGeneratorAtoms)refreshPositionTableToolbar();
  fn.saveCifGeneratorAtomsState();
  if(invalidate) fn.invalidateGeneratedCif();
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
  fn.saveCifGeneratorAtomsState();
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
}
