// Atoms tab: element legend, palettes and the atom appearance table.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installAtomTable(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    clearAppearanceRowSelection, makeMomentColorPicker, naturalStructureLabelCompare,
    selectedAppearanceContainsAtom, setSpinEnabledForDisplayed, structureElements,
    structureSiteDisplayLabels, syncSpinTableBulkCheckbox, updateStructureAtomColorRows,
    updateStructureAtomLegend
  });
function updateStructureAtomLegend(elements){
  const host=$("cifAtomLegend");
  if(!host) return;
  host.replaceChildren();
  for(const element of elements){
    if(cifState.structureAtomVisibility.get(String(element))===false) continue;
    const item=document.createElement("span"); item.className="structure-atom-legend-item";
    const dot=document.createElement("i"); dot.className="structure-atom-legend-dot"; dot.style.background=fn.elementColor(element);
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
  for(const color of cifState.STRUCTURE_PALETTE){
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
    const cur=fn.currentMomentSettings().get(key);
    if(cur){ cur.color=color; cur.colorCustomized=false; cifState.structureMomentSettings.set(key,cur); }
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
  const selected=cifState.structureSpinTableElement;
  label.textContent=selected==="*" ? "All" : selected;
  checkbox.title=selected==="*" ? "Enable/disable every magnetic site" : `Enable/disable all ${selected} magnetic sites`;
  checkbox.setAttribute("aria-label",checkbox.title);
  let all=candidates;
  if(!all){
    try{ all=fn.spinEditingIsIndividual(structure)?fn.individualSpinCandidates(structure):fn.magneticCandidateSites(structure); }
    catch(_e){all=[];}
  }
  const visible=fn.spinTableFilteredSites(all);
  const live=fn.currentMomentSettings();
  const values=visible.map(site=>{
    const key=site.individualKey||fn.momentKey(site);
    const setting=live.get(key)||cifState.structureMomentSettings.get(key)||
      (site.individualKey?fn.initialIndividualSpin(site,structure):fn.defaultMomentSetting(site,structure));
    return !!setting.enabled;
  });
  checkbox.disabled=!values.length;
  checkbox.checked=values.length>0 && values.every(Boolean);
  checkbox.indeterminate=values.some(Boolean) && !checkbox.checked;
}
function setSpinEnabledForDisplayed(enabled){
  const structure=fn.currentStructureForViewer()?.structure;
  if(!structure)return;
  fn.activateImportedMagneticEditing();
  const live=fn.currentMomentSettings();
  for(const [key,value] of live) cifState.structureMomentSettings.set(key,value);
  const candidates=fn.spinEditingIsIndividual(structure)?fn.individualSpinCandidates(structure):fn.magneticCandidateSites(structure);
  for(const site of fn.spinTableFilteredSites(candidates)){
    const key=site.individualKey||fn.momentKey(site);
    const initial=site.individualKey?fn.initialIndividualSpin(site,structure):fn.defaultMomentSetting(site,structure);
    cifState.structureMomentSettings.set(key,{...initial,...(cifState.structureMomentSettings.get(key)||{}),enabled:!!enabled});
  }
  // updateMagneticMomentRows() snapshots current DOM rows first. Reflect the
  // bulk edit in those rows so it cannot be overwritten by stale checkboxes.
  for(const row of document.querySelectorAll("#cifMagMomentRows .structure-moment-row")){
    const checkbox=row.querySelector('[data-moment-field="enabled"]');
    if(checkbox) checkbox.checked=!!enabled;
  }
  fn.updateMagneticMomentRows(structure);
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
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
cifState.selectedAppearanceRowKeys=new Set();
function clearAppearanceRowSelection(){
  if(!cifState.selectedAppearanceRowKeys.size)return;
  cifState.selectedAppearanceRowKeys.clear();
  document.querySelectorAll('#cifAtomColorRows .atoms-table-row').forEach(row=>row.classList.remove('atoms-row-selected'));
  fn.renderCifStructureIfVisible();
}
function selectedAppearanceContainsAtom(atom){
  return cifState.selectedAppearanceRowKeys.has(`element:${atom.element}`) ||
    (fn.atomSiteKey(atom)!==null && cifState.selectedAppearanceRowKeys.has(fn.atomSiteKey(atom)));
}
function selectAppearanceRow(key,row,event={}){
  if(event.shiftKey || event.ctrlKey || event.metaKey){
    if(cifState.selectedAppearanceRowKeys.has(key))cifState.selectedAppearanceRowKeys.delete(key);
    else cifState.selectedAppearanceRowKeys.add(key);
  }else{
    const selected=cifState.selectedAppearanceRowKeys.has(key);
    cifState.selectedAppearanceRowKeys.clear();if(!selected)cifState.selectedAppearanceRowKeys.add(key);
  }
  document.querySelectorAll('#cifAtomColorRows .atoms-table-row').forEach(item=>
    item.classList.toggle('atoms-row-selected',cifState.selectedAppearanceRowKeys.has(item.dataset.selectionKey)));
  fn.renderCifStructureIfVisible();
}
function updateStructureAtomColorRows(elements,structure=null){
  const host=$("cifAtomColorRows");
  if(!host) return;
  host.replaceChildren();
  const orbits=fn.parentAppearanceOrbits(structure);
  const manual=cifState.structurePositionEditingMode==='individual';
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
    if(!isSite){name.type="button";name.setAttribute("aria-expanded",String(cifState.expandedAtomElements.has(element)));}
    name.textContent=(isSite?"↳ ":cifState.expandedAtomElements.has(element)?"▾ ":"▸ ")+label;
    const visible=document.createElement("input");visible.type="checkbox";visible.className="atoms-visible";
    visible.checked=isSite?cifState.atomSiteVisibility.get(key)!==false:cifState.structureAtomVisibility.get(element)!==false;
    visible.title=`Show ${label}`;
    const color=document.createElement("input");color.type="color";color.className="atoms-color";
    color.value=(isSite?cifState.atomSiteColors.get(key):null)||fn.elementColor(element);
    color.title=`${label} color`;
    const size=document.createElement("input");size.type="number";size.className="atoms-size";size.min="2";size.max="30";size.step="1";
    size.value=String((isSite?cifState.atomSiteSizes.get(key):null)??fn.elementRadius(element));
    size.title=`${label} display size`;
    const commit=()=>{fn.saveStructureViewerState();fn.renderCifStructureIfVisible();};
    color.addEventListener("input",()=>{
      if(isSite) cifState.atomSiteColors.set(key,color.value);
      else {
        cifState.structureAtomColorOverrides.set(element,color.value);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) cifState.atomSiteColors.delete(`site:${index}`);
        syncDefaultMomentColorsForElement(element,color.value);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-color')).filter(Boolean)) child.value=color.value;
      }
      commit();
    });
    size.addEventListener("input",()=>{
      if(size.value===""||!Number.isFinite(Number(size.value)))return;
      const v=Math.max(2,Math.min(30,Number(size.value)));
      if(isSite)cifState.atomSiteSizes.set(key,v);
      else {
        cifState.structureAtomSizeOverrides.set(element,v); cifState.structureAtomSizeCleared.delete(element);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) cifState.atomSiteSizes.delete(`site:${index}`);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-size')).filter(Boolean))child.value=String(v);
      }
      commit();
    });
    visible.addEventListener("change",()=>{
      if(isSite)cifState.atomSiteVisibility.set(key,visible.checked);
      else {
        cifState.structureAtomVisibility.set(element,visible.checked);
        for(const [index,site] of sites.entries()) if(String(site.element)===element) cifState.atomSiteVisibility.delete(`site:${index}`);
        for(const child of [...host.querySelectorAll('.atoms-site-row')].filter(row=>row.dataset.element===element).map(row=>row.querySelector('.atoms-visible')).filter(Boolean))child.checked=visible.checked;
      }
      commit();
    });
    // Twelve directly accessible presets (6 by 2) plus a native RGB picker, per row.
    // All changes use the existing input handler (persistence, site overrides,
    // element-wide propagation, spin default colors, 3D display).
    const colorCell=document.createElement("div");
    colorCell.className="atoms-color-cell";
    const presetColors=cifState.STRUCTURE_PALETTE.slice(0,12);
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
      if(cifState.expandedAtomElements.has(element))cifState.expandedAtomElements.delete(element);else cifState.expandedAtomElements.add(element);
      updateStructureAtomColorRows(elements,structure);
    });
    row.dataset.element=element;
    const selectionKey=isSite?key:`element:${element}`;
    row.dataset.selectionKey=selectionKey;
    row.classList.toggle('atoms-row-selected',cifState.selectedAppearanceRowKeys.has(selectionKey));
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
    if(cifState.expandedAtomElements.has(element)) for(const site of itemSites){
      const key=manual?`manual-site:${site.index}`:`site:${site.index}`;
      const label=manual ? `${element}${itemSites.findIndex(item=>item.index===site.index)+1}`:
        String(displayLabels?.get(String(site.label))||site.label||`${element}${site.index+1}`);
      host.appendChild(makeRow(label,key,element,true));
    }
  }
}
}
