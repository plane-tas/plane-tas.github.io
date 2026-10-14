// Style tab: bond/polyhedron rules table (selection, drag, copy, remove).
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installBondRules(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    addStructureBondRule, clearStructureBondSelection, copySelectedStructureBondRules,
    defaultBondColor, readStructureBondRules, removeSelectedStructureBondRules,
    setAllStructureBondRulesVisible, structureSignature, syncStructureBondDisplayModeControls,
    syncStructureControlRows
  });
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
  const first=fn.elementColor(a), second=fn.elementColor(b);
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
    input.checked=input.value===cifState.structureBondDisplayMode;
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
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
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
        fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
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
      fn.saveStructureViewerState();
      fn.renderCifStructureIfVisible();
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
    const limit=fn.styleCellDiagonalForViewer();
    const min=Number(minDistance.value),max=Number(maxDistance.value);
    const valid=Number.isFinite(limit) && fn.safeStyleDistances(min,max,limit);
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
    fn.saveStructureViewerState();
    fn.renderCifStructureIfVisible();
  });
  row.classList.toggle('style-rule-hidden',!enabled.checked);
  row.append(index,cell('enabled',enabled),cell('select',a),cell('select',b),cell('mode',bondsToggle),cell('mode',polyhedralToggle),cell('number',minDistance),cell('number',maxDistance),cell('number',width),cell('color',color));
  // Retain the original default pair-color behavior, unless customized.
  let customized=!!rule.color && rule.color.toLowerCase()!==defaultBondColor(a.value,b.value).toLowerCase();
  color.addEventListener('input',()=>{customized=true;});
  const updatePairColor=()=>{if(!customized)color.value=defaultBondColor(a.value,b.value);};
  a.addEventListener('change',updatePairColor);
  b.addEventListener('change',updatePairColor);
  const commit=()=>{updateStyleDistanceValidity();fn.saveStructureViewerState();fn.renderCifStructureIfVisible();};
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
  const info=fn.currentStructureForViewer();const elements=fn.structureElements(info?.structure||null);
  const host=$('cifBondRows');if(!host||!elements.length)return;
  if(host.firstElementChild?.classList.contains('structure-rows-empty'))host.replaceChildren();
  const newRule=rule&&typeof rule==='object'&&'a' in rule?rule:
    {a:elements[0],b:elements[Math.min(1,elements.length-1)]||elements[0],bonds:true,polyhedral:false,minDistance:0,maxDistance:3,width:5};
  const row=createBondRuleRow(newRule,elements);
  clearStructureBondSelection();host.appendChild(row);
  row.classList.add('style-row-selected');structureBondSelectionAnchor=row.dataset.styleUid;
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
  fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
  return row;
}
function copySelectedStructureBondRules(){
  const selected=selectedStructureBondRows();if(!selected.length)return;
  const elements=fn.structureElements(fn.currentStructureForViewer()?.structure||null);
  const host=$('cifBondRows');
  const copies=selected.map(row=>readBondRuleFromRow(row)).filter(Boolean);
  clearStructureBondSelection();
  for(const rule of copies){
    const row=createBondRuleRow(rule,elements);host.appendChild(row);
    row.classList.add('style-row-selected');structureBondSelectionAnchor=row.dataset.styleUid;
  }
  refreshStructureBondIndices();refreshStructureBondSelection();syncStructureBondBulkCheckbox();
  fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
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
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible(); // Plotly.react with no old bond / mesh traces
}
function structureSignature(structure){
  if(!structure) return "";
  const lattice=structure.lattice||{};
  const sites=(structure.asymmetricSites||[]).map((s,i)=>`${i}:${s.label||""}:${s.element}:${s.x}:${s.y}:${s.z}:${(s.magneticMoment||[]).join(",")}:${s.magneticFourier?JSON.stringify(s.magneticFourier):""}`).join("|");
  return `${lattice.a},${lattice.b},${lattice.c},${lattice.alpha},${lattice.beta},${lattice.gamma}|${sites}`;
}
function syncStructureControlRows(structure){
  const sig=structureSignature(structure);
  if(sig===cifState.structureControlSignature) return;
  const oldBondRules=cifState.restoredStructureBondRules!==null ? cifState.restoredStructureBondRules : readStructureBondRules();
  cifState.restoredStructureBondRules=null;
  cifState.structureControlSignature=sig;
  fn.clearSpinRowSelection({redraw:false});
  cifState.visibleSpinSelectionSites.clear();
  const elements=fn.structureElements(structure);
  fn.assignDistinctElementColors(elements);
  fn.updateStructureAtomColorRows(elements,structure);
  fn.updateMagneticMomentRows(structure);
  updateStructureBondRows(elements,oldBondRules);
  syncStructureBondDisplayModeControls();
}
}
