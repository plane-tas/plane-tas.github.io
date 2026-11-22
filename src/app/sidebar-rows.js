// Sidebar dynamic rows: propagation vectors, dark-angle assets and ranges, sample environments.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {MAX_PROPAGATION_VECTORS, magneticSymbolSvg} from '../qe/magnetic-symbols.js';

export function createSidebarRows(deps){
  const {
    $, backgroundMaterials, backgroundRowValues, checkedValue, handleBackgroundSelection, num,
    parseNumericValue, refreshSelect, removeBackground, replaceBackgroundRows, sampleEnvironments,
    saveLeftPanelState, scheduleRecalc, setRadio, updateGeometryQuickTargetButtons,
    updatePropagationVectorLabels
  }=deps;

function propagationVectorIndices(){
  return [...document.querySelectorAll(".propagation-row[data-q-index]")]
    .map(row=>Number(row.dataset.qIndex))
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);
}

function enabledPropagationVectors(){
  const out=[];
  for(const i of propagationVectorIndices()){
    out.push({index:i, hkl:[num(`q${i}_h`),num(`q${i}_k`),num(`q${i}_l`)]});
  }
  return out;
}

// The Custom sample environment of a dark-angle card (not a file).
const DARK_CUSTOM='custom';
function darkAssetIds(slot){
  const suffix=slot===1?"":String(slot);
  const legacyRangeId=(kind,i)=>{
    if(slot<=3 && i<4) return `dark${kind}${suffix}${i}`;
    return `dark${kind}${slot}_${i}`;
  };
  return {
    se:`seSelect${suffix}`, ref:`darkRef${suffix}`, rotation:`darkRotation${suffix}`,
    refH:`darkRefH${slot}`, refK:`darkRefK${slot}`, refL:`darkRefL${slot}`, refRow:`darkRefQRow${slot}`,
    rangeCount:`darkRangeCount${slot}`,
    from:i=>legacyRangeId("From",i), to:i=>legacyRangeId("To",i), offset:i=>legacyRangeId("Offset",i)
  };
}

function darkAssetSlots(){
  return [...document.querySelectorAll(".dark-asset[data-dark-slot]")]
    .map(el=>Number(el.dataset.darkSlot))
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);
}

function currentDarkRangeCount(slot){
  const ids=darkAssetIds(slot);
  const saved=Number($(ids.rangeCount)?.value);
  if(Number.isInteger(saved) && saved>=1) return saved;
  return document.querySelectorAll(`.dark-asset[data-dark-slot="${slot}"] .dark-range-number`).length || 1;
}

// Numbers that come from a file (e.g. 0.3333333333333333) are shown as an
// exact fraction with a small denominator, otherwise with 4 decimals.
// Text the user typed (including fractions such as 1/3) is kept as is.
function formatPropagationComponent(raw){
  const text=String(raw).trim();
  if(typeof raw!=='number' && !/^[+-]?\d*\.\d{5,}(?:e[+-]?\d+)?$/i.test(text)) return text;
  const value=Number(raw);
  if(!Number.isFinite(value)) return text;
  if(Math.abs(value-Math.round(value))<1e-6) return String(Math.round(value));
  for(let d=2;d<=24;d++){
    const n=Math.round(value*d);
    if(Math.abs(value-n/d)<1e-6) return `${n}/${d}`;
  }
  return String(Number(value.toFixed(4)));
}
function createPropagationVectorRow(index,values={}){
  const row=document.createElement("div");
  row.className="propagation-row";
  row.dataset.qIndex=String(index);
  // One row of the table under the No. / h / k / l header: k<n>, its
  // marker on the maps, the components and Remove.
  row.innerHTML=`<span class="propagation-no">k${index}</span>`+
    `<span class="propagation-symbol">${magneticSymbolSvg(index)}</span>`+
    ["h","k","l"].map(c=>`<input id="q${index}_${c}" type="text" inputmode="text" data-fraction="" value="0" aria-label="k${index} ${c}">`).join("")+
    `<button type="button" class="remove-propagation-vector" data-q-index="${index}">Remove</button>`;
  for(const c of ["h","k","l"]){
    const raw=values[c] ?? 0;
    const value=parseNumericValue(raw);
    row.querySelector(`#q${index}_${c}`).value=Number.isFinite(value)?formatPropagationComponent(raw):"0";
  }
  return row;
}

function propagationVectorValues(){
  // Every row is used (Remove deletes a vector); "enabled" is kept for the
  // readers of these values.
  return propagationVectorIndices().map(index=>({
    enabled:true,
    // Preserve the user's exact text (including fractions) when rows are
    // added/removed; numerical calculations parse these values via num().
    h:$(`q${index}_h`)?.value ?? "0",
    k:$(`q${index}_k`)?.value ?? "0",
    l:$(`q${index}_l`)?.value ?? "0"
  }));
}

function replacePropagationVectors(values,{recalc=false}={}){
  const host=$("propagationVectors");
  if(!host) return;
  // The table may be empty (no propagation vector: no magnetic peaks).
  const rows=(Array.isArray(values)?values:[]).slice(0,MAX_PROPAGATION_VECTORS);
  host.replaceChildren();
  rows.forEach((value,i)=>host.appendChild(createPropagationVectorRow(i+1,value)));
  if($("propagationCount")) $("propagationCount").value=String(rows.length);
  const add=$("addPropagationVector");
  if(add) add.disabled=rows.length>=MAX_PROPAGATION_VECTORS;
  updatePropagationVectorLabels();
  if(recalc) scheduleRecalc();
}

function setPropagationVectorCount(count,{recalc=false}={}){
  count=Math.max(0,Math.floor(Number(count)||0));
  const values=propagationVectorValues();
  while(values.length<count) values.push({});
  values.length=count;
  replacePropagationVectors(values,{recalc});
}

function removePropagationVector(index){
  const values=propagationVectorValues();
  const position=propagationVectorIndices().indexOf(Number(index));
  if(position>=0) values.splice(position,1);
  replacePropagationVectors(values,{recalc:true});
  saveLeftPanelState();
}

function makeDarkRangeCells(slot,index,values={}){
  const ids=darkAssetIds(slot);
  const frag=document.createDocumentFragment();
  const no=document.createElement("span");
  no.className="dark-range-number";
  no.dataset.darkRange=String(index);
  no.textContent=String(index+1);
  frag.appendChild(no);
  for(const [idFor,kind] of [[ids.from,"from"],[ids.to,"to"],[ids.offset,"offset"]]){
    const input=document.createElement("input");
    input.id=idFor(index);
    input.dataset.darkRange=String(index);
    input.dataset.darkField=kind;
    input.type="number";
    const value=Number(values[kind]);
    input.value=Number.isFinite(value)?String(value):"0";
    frag.appendChild(input);
  }
  const remove=document.createElement("button");
  remove.type="button";
  remove.className="remove-dark-range";
  remove.dataset.darkSlot=String(slot);
  remove.dataset.darkRange=String(index);
  remove.textContent="Remove";
  frag.appendChild(remove);
  return frag;
}

function darkRangeValues(slot){
  const ids=darkAssetIds(slot);
  const count=currentDarkRangeCount(slot);
  const out=[];
  for(let i=0;i<count;i++){
    out.push({from:num(ids.from(i)),to:num(ids.to(i)),offset:num(ids.offset(i))});
  }
  return out;
}

function replaceDarkRanges(slot,ranges,{recalc=false}={}){
  const asset=document.querySelector(`.dark-asset[data-dark-slot="${slot}"]`);
  const table=asset?.querySelector(".dark-table");
  if(!asset || !table) return;
  const rows=(Array.isArray(ranges)&&ranges.length)?ranges:[{}];
  table.replaceChildren();
  for(const label of ["No.","From","To","Offset",""]){
    const head=document.createElement("div");
    head.textContent=label;
    table.appendChild(head);
  }
  rows.forEach((value,i)=>table.appendChild(makeDarkRangeCells(slot,i,value)));
  const countInput=$(darkAssetIds(slot).rangeCount);
  if(countInput) countInput.value=String(rows.length);
  if(recalc) scheduleRecalc();
}

function setDarkRangeCount(slot,count,{recalc=false}={}){
  count=Math.max(1,Math.floor(Number(count)||1));
  const ranges=darkRangeValues(slot);
  while(ranges.length<count) ranges.push({});
  ranges.length=count;
  replaceDarkRanges(slot,ranges,{recalc});
}

function removeDarkRange(slot,index){
  const ranges=darkRangeValues(slot);
  const i=Math.max(0,Math.min(ranges.length-1,Number(index)||0));
  ranges.splice(i,1);
  replaceDarkRanges(slot,ranges,{recalc:true});
  saveLeftPanelState();
}

function createDarkAsset(slot,values={}){
  const ids=darkAssetIds(slot);
  const asset=document.createElement("div");
  asset.className="dark-asset";
  asset.dataset.darkSlot=String(slot);
  asset.innerHTML=`
    <div class="dark-asset-head">
      <div class="dark-asset-no-cell"><span>No.</span><span class="dark-asset-no">#${slot}</span></div>
      <label>Sample environment<select id="${ids.se}"><option value="${DARK_CUSTOM}">Custom</option></select></label>
      <button type="button" class="remove-dark-asset" data-dark-slot="${slot}">Remove</button>
    </div>
    <div class="grid2">
      <label>Reference<select id="${ids.ref}"><option>Reference Q</option><option>Direct beam</option><option>Fixed</option></select></label>
      <label>Rotation (deg)<input id="${ids.rotation}" type="number" value="0" step="1"></label>
    </div>
    <div id="${ids.refRow}" class="grid3">
      <label>h<input id="${ids.refH}" type="text" inputmode="text" data-fraction="" value="1"></label>
      <label>k<input id="${ids.refK}" type="text" inputmode="text" data-fraction="" value="0"></label>
      <label>l<input id="${ids.refL}" type="text" inputmode="text" data-fraction="" value="0"></label>
    </div>
    <input id="${ids.rangeCount}" type="hidden" value="1">
    <div class="dark-table" data-dark-range-table="${slot}"></div>
    <button type="button" class="add-dark-range dynamic-add-wide" data-dark-slot="${slot}">Add</button>`;
  return asset;
}

// Sample environment of a dark-angle card: Custom (ranges typed by hand;
// the choice of a new card) or a preset from sample_environments/.
function refreshDarkEnvironmentSelect(slot){
  const select=$(darkAssetIds(slot).se);
  if(!select) return;
  const keep=select.value;
  refreshSelect(sampleEnvironments,select,null);
  const custom=document.createElement("option");
  custom.value=DARK_CUSTOM; custom.textContent="Custom";
  select.insertBefore(custom,select.options[0]||null);
  select.value=[...select.options].some(o=>o.value===keep) ? keep : DARK_CUSTOM;
  syncDarkCardMode(slot);
}
// Remember the selection, so that leaving Custom can keep its settings.
function syncDarkCardMode(slot){
  const select=$(darkAssetIds(slot).se);
  if(select) select.dataset.previous=select.value;
}

// The hand-typed settings of Custom are kept while another sample
// environment (or None) is selected, so switching back restores them; they
// are part of the card's snapshot and so of the saved state.
const customDarkSettings=new Map();
function currentDarkSettings(slot){
  const ids=darkAssetIds(slot);
  return {
    ref:checkedValue(ids.ref)||"Reference Q",
    rotation:num(ids.rotation),
    // Keep the typed text (e.g. "1/2") when it is a valid number or fraction.
    refH:rawNumericText(ids.refH), refK:rawNumericText(ids.refK), refL:rawNumericText(ids.refL),
    ranges:darkRangeValues(slot)
  };
}
function applyDarkSettings(slot,values={}){
  const ids=darkAssetIds(slot);
  setRadio(ids.ref,values.ref||"Reference Q");
  if($(ids.rotation)) $(ids.rotation).value=Number.isFinite(Number(values.rotation))?String(values.rotation):"0";
  if($(ids.refH)) $(ids.refH).value=Number.isFinite(parseNumericValue(values.refH))?String(values.refH).trim():"1";
  if($(ids.refK)) $(ids.refK).value=Number.isFinite(parseNumericValue(values.refK))?String(values.refK).trim():"0";
  if($(ids.refL)) $(ids.refL).value=Number.isFinite(parseNumericValue(values.refL))?String(values.refL).trim():"0";
  replaceDarkRanges(slot,values.ranges);
  updateDarkReferenceUI(slot);
}

function rawNumericText(id){
  const raw=String($(id)?.value??"").trim();
  return Number.isFinite(parseNumericValue(raw)) ? raw : num(id);
}
function snapshotDarkAsset(slot){
  const se=$(darkAssetIds(slot).se)?.value||"";
  const current=currentDarkSettings(slot);
  const custom=se===DARK_CUSTOM ? current : customDarkSettings.get(slot);
  return {se,...current,...(custom?{custom}:{})};
}

function applyDarkAssetValues(slot,values={}){
  const ids=darkAssetIds(slot);
  refreshDarkEnvironmentSelect(slot);
  if($(ids.se)){
    const requested=String(values.se||DARK_CUSTOM);
    $(ids.se).value=[...$(ids.se).options].some(o=>o.value===requested)?requested:DARK_CUSTOM;
  }
  if(values.custom) customDarkSettings.set(slot,values.custom);
  else customDarkSettings.delete(slot);
  applyDarkSettings(slot,values);
  syncDarkCardMode(slot);
}

function darkAssetValues(){
  return darkAssetSlots().map(slot=>snapshotDarkAsset(slot));
}

function replaceDarkAssets(values,{recalc=false}={}){
  const host=$("darkAssets");
  if(!host) return;
  // No card at first; Add makes one (Custom).
  const cards=Array.isArray(values)?values:[];
  customDarkSettings.clear();
  host.replaceChildren();
  cards.forEach((value,i)=>{
    const slot=i+1;
    host.appendChild(createDarkAsset(slot,value));
    applyDarkAssetValues(slot,value);
  });
  if($("darkAssetCount")) $("darkAssetCount").value=String(cards.length);
  updateGeometryQuickTargetButtons();
  if(recalc) scheduleRecalc();
}

function setDarkAssetCount(count,{recalc=false}={}){
  count=Math.max(0,Math.floor(Number(count)||0));
  const values=darkAssetValues();
  while(values.length<count) values.push({});
  values.length=count;
  replaceDarkAssets(values,{recalc});
}

function removeDarkAsset(slot){
  const values=darkAssetValues();
  const position=darkAssetSlots().indexOf(Number(slot));
  if(position>=0) values.splice(position,1);
  replaceDarkAssets(values,{recalc:true});
  saveLeftPanelState();
}

function bindDynamicSidebarUI(){
  const propagationHost=$("propagationVectors");
  if(propagationHost && !propagationHost.dataset.bound){
    // The event sets the delay (typing: after a pause; change: at once).
    const recalc=ev=>scheduleRecalc(ev);
    propagationHost.addEventListener("input",recalc);
    propagationHost.addEventListener("change",recalc);
    propagationHost.addEventListener("click",ev=>{
      const remove=ev.target.closest(".remove-propagation-vector");
      if(remove) removePropagationVector(Number(remove.dataset.qIndex));
    });
    propagationHost.dataset.bound="1";
  }

  $("addPropagationVector")?.addEventListener("click",()=>{
    const values=propagationVectorValues();
    if(values.length>=MAX_PROPAGATION_VECTORS) return;
    values.push({});
    replacePropagationVectors(values,{recalc:true});
    saveLeftPanelState();
  });

  const backgroundHost=$("backgroundRows");
  if(backgroundHost && !backgroundHost.dataset.bound){
    backgroundHost.addEventListener("change",ev=>{
      const select=ev.target.closest('select[id^="backgroundSelect"]');
      if(select) handleBackgroundSelection(select.id);
    });
    backgroundHost.addEventListener("click",ev=>{
      const remove=ev.target.closest(".remove-background");
      if(remove) removeBackground(Number(remove.dataset.backgroundIndex));
    });
    backgroundHost.dataset.bound="1";
  }
  $("addBackground")?.addEventListener("click",()=>{
    const values=backgroundRowValues();
    // The new row shows the first material that no other row uses.
    const used=new Set(values.map(v=>v.key));
    const key=[...backgroundMaterials.keys()]
      .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}))
      .find(k=>!used.has(k));
    if(!key) return;
    values.push({key});
    replaceBackgroundRows(values,{recalc:true});
    saveLeftPanelState();
  });

  const darkHost=$("darkAssets");
  if(darkHost && !darkHost.dataset.bound){
    darkHost.addEventListener("input",ev=>{
      if(ev.target.matches("input,select")) scheduleRecalc(ev);
    });
    darkHost.addEventListener("change",ev=>{
      const asset=ev.target.closest(".dark-asset[data-dark-slot]");
      const slot=Number(asset?.dataset.darkSlot);
      if(!Number.isFinite(slot)) return;
      const ids=darkAssetIds(slot);
      if(ev.target.id===ids.se){
        applySampleEnvironmentDefaults(slot);
      }else if(ev.target.id===ids.ref){
        updateDarkReferenceUI(slot);
        scheduleRecalc();
      }else{
        scheduleRecalc();
      }
      // Set Ref Q follows the checkbox, the reference and the ranges.
      updateGeometryQuickTargetButtons();
    });
    darkHost.addEventListener("click",ev=>{
      const add=ev.target.closest(".add-dark-range");
      const removeRange=ev.target.closest(".remove-dark-range");
      const removeAsset=ev.target.closest(".remove-dark-asset");
      if(add){
        const slot=Number(add.dataset.darkSlot);
        const ranges=darkRangeValues(slot);
        ranges.push({});
        replaceDarkRanges(slot,ranges,{recalc:true});
        saveLeftPanelState();
      }else if(removeRange){
        removeDarkRange(Number(removeRange.dataset.darkSlot),Number(removeRange.dataset.darkRange));
      }else if(removeAsset){
        removeDarkAsset(Number(removeAsset.dataset.darkSlot));
      }
    });
    darkHost.dataset.bound="1";
  }

  $("addDarkAsset")?.addEventListener("click",()=>{
    const values=darkAssetValues();
    values.push({se:DARK_CUSTOM});
    replaceDarkAssets(values,{recalc:true});
    saveLeftPanelState();
  });
}

function updateDarkReferenceUI(slot){
  const ids=darkAssetIds(slot);
  const row=$(ids.refRow);
  if(!row) return;
  const show=checkedValue(ids.ref)==="Reference Q";
  // Keep the dedicated h/k/l controls visible whenever Reference Q is selected.
  // Use both the existing CSS class and the native hidden flag so restored/local
  // UI state cannot leave the row in the wrong visibility state.
  row.classList.toggle("hidden",!show);
  row.hidden=!show;
  updateGeometryQuickTargetButtons();
}

function applySampleEnvironmentDefaults(slot=1){
  const ids=darkAssetIds(slot);
  const key=$(ids.se)?.value || "";
  if($(ids.se)?.dataset.previous===DARK_CUSTOM) customDarkSettings.set(slot,currentDarkSettings(slot));
  syncDarkCardMode(slot);
  // Custom: restore the hand-typed settings, if there are any.
  if(key===DARK_CUSTOM){
    if(customDarkSettings.has(slot)) applyDarkSettings(slot,customDarkSettings.get(slot));
    scheduleRecalc();
    return;
  }
  if(!key || !sampleEnvironments.has(key)){
    setRadio(ids.ref,"Reference Q");
    updateDarkReferenceUI(slot);
    setDarkRangeCount(slot,1);
    $(ids.from(0)).value=0; $(ids.to(0)).value=0; $(ids.offset(0)).value=0;
    scheduleRecalc();
    return;
  }
  const se=sampleEnvironments.get(key);
  setRadio(ids.ref,se.dark_angle_reference || "Reference Q");
  const rq=Array.isArray(se.dark_angle_reference_q)?se.dark_angle_reference_q:(Array.isArray(se.reference_q)?se.reference_q:null);
  if(rq&&rq.length>=3){ $(ids.refH).value=rq[0]; $(ids.refK).value=rq[1]; $(ids.refL).value=rq[2]; }
  updateDarkReferenceUI(slot);
  const ranges=Array.isArray(se.dark_angle_ranges)?se.dark_angle_ranges:[];
  setDarkRangeCount(slot,Math.max(1,ranges.length));
  for(let i=0;i<Math.max(1,ranges.length);i++){
    const r=ranges[i] || {from:0,to:0,offset:0};
    $(ids.from(i)).value=Number(r.from||0);
    $(ids.to(i)).value=Number(r.to||0);
    $(ids.offset(i)).value=Number(r.offset||0);
  }
  scheduleRecalc();
}

  return {
    applySampleEnvironmentDefaults, bindDynamicSidebarUI, currentDarkRangeCount, darkAssetIds,
    darkAssetSlots, darkAssetValues, enabledPropagationVectors, propagationVectorIndices,
    propagationVectorValues, refreshDarkEnvironmentSelect, replaceDarkAssets, replacePropagationVectors,
    setDarkAssetCount, setDarkRangeCount, setPropagationVectorCount, updateDarkReferenceUI
  };
}
