// Structure viewer controls: section defaults, viewport/table sizing and control wiring.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installViewerControls(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    prepareStructureViewerControls, requestGeneratorViewportHeightSync,
    requestStructureTableHeightSync, syncImportedMomentStructureType
  });
function ensureStructureViewerStyle(){
  // Structure Viewer layout is defined in styles/ (mainly 06-structure-viewer.css).  Keeping this hook avoids
  // late runtime CSS overriding the HTML/CSS layout and shrinking entry boxes.
}
function createSplitRangeControls(axis){
  const cap=axis.toUpperCase();
  const legacy=$("cifRange"+cap);
  let minInput=$("cifRange"+cap+"Min");
  let maxInput=$("cifRange"+cap+"Max");
  if(!minInput || !maxInput){
    if(!legacy) return;
    const parsed=fn.parseStructureRangeEntry(legacy.value);
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
    fn.normalizeStructureRangeInputs();
    fn.saveStructureViewerState();
    fn.renderCifStructureIfVisible();
  };
  for(const input of [minInput,maxInput]){
    input.dataset.structureRangeBound="1";
    input.addEventListener("input",()=>{ syncLegacy(); fn.saveStructureViewerState(); });
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
  cifState.structureMomentStructureType="collinear";
  cifState.structureMomentRotationAxis="c";
  cifState.structureMomentChirality="CCW";
  if($("cifMomentStructureType")) $("cifMomentStructureType").value="collinear";
  if($("cifMomentRotationAxis")) $("cifMomentRotationAxis").value="c";
  if($("cifMomentChirality")) $("cifMomentChirality").value="CCW";
  const info=fn.currentStructureForViewer();
  const sites=fn.magneticCandidateSites(info?.structure||null);
  const live=fn.currentMomentSettings();
  for(const site of sites){
    const key=fn.momentKey(site);
    const current=live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(site,info?.structure);
    cifState.structureMomentSettings.set(key,{...current,size:1,width:10,headSize:0.51,color:fn.elementColor(site.element),colorCustomized:false});
  }
  $("cifMagMomentRows")?.replaceChildren();
  cifState.structureControlSignature="";
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
}
function resetAtomDisplayDefaults(){
  cifState.structureAtomColorOverrides.clear();
  cifState.structureAtomSizeOverrides.clear();
  cifState.structureControlSignature="";
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
}
function resetBondDisplayDefaults(){
  for(const row of document.querySelectorAll("#cifBondRows .structure-bond-row")){
    const min=row.querySelector('[data-bond-field="minDistance"]'); if(min) min.value="0";
    const max=row.querySelector('[data-bond-field="maxDistance"]'); if(max) max.value="3";
    const legacy=row.querySelector('[data-bond-field="distanceRange"]'); if(legacy) legacy.value="0 3";
    const width=row.querySelector('[data-bond-field="width"]'); if(width) width.value="5";
    const color=row.querySelector('[data-bond-field="color"]'); if(color) color.value=fn.defaultBondColor(row.querySelector('[data-bond-field="a"]')?.value,row.querySelector('[data-bond-field="b"]')?.value);
  }
  fn.saveStructureViewerState();
  fn.renderCifStructureIfVisible();
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
  const original=fn.sourceIsMagneticCif() && !cifState.importedMagneticEditMode;
  const inputs=[
    ["cifMomentStructureType",cifState.structureMomentStructureType],
    ["cifMomentRotationAxis",cifState.structureMomentRotationAxis],
    ["cifMomentChirality",cifState.structureMomentChirality]
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
  fn.syncSpinModifyLock();
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
    const active=button.dataset.structureConfigTab===cifState.structureConfigActiveTab;
    button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));
  }
  for(const panel of document.querySelectorAll("[data-structure-config-panel]")){
    const active=panel.dataset.structureConfigPanel===cifState.structureConfigActiveTab;
    panel.classList.toggle("active",active);panel.hidden=!active;
  }
  for(const button of document.querySelectorAll("[data-structure-config-tab]")){
    if(button.dataset.structureTabBound) continue;
    button.dataset.structureTabBound="1";
    button.addEventListener("click",()=>{
      const key=button.dataset.structureConfigTab;
      cifState.structureConfigActiveTab=key;
      try{localStorage.setItem(cifState.STRUCTURE_EDITOR_TAB_KEY,key);}catch(_e){}
      fn.saveStructureViewerState();
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
  fn.bindStructureK1Inputs();
  fn.refreshMomentPropagationVectorSelect();
  fn.syncSpinModifyLock();
  const propagationSelect=$("cifMomentPropagationVector");
  if(propagationSelect && !propagationSelect.dataset.structureBound){
    propagationSelect.dataset.structureBound="1";
    propagationSelect.addEventListener("change",()=>{
      if(propagationSelect.value==="mcif") return;
      const n=Number(propagationSelect.value);
      cifState.structureMomentPropagationIndex=Number.isInteger(n)&&n>0?n:0;
      fn.activateImportedMagneticEditing();
      if(cifState.structureSpinEditingMode==='individual'){
        for(const [key,value] of fn.currentMomentSettings())cifState.structureMomentSettings.set(key,value);
        $('cifMagMomentRows')?.replaceChildren();
        fn.updateMagneticMomentRows(fn.currentStructureForViewer()?.structure||null);
      }
      fn.saveStructureViewerState();
      fn.renderCifStructureIfVisible();
    });
  }
  const structureTypeSelect=$("cifMomentStructureType");
  const axisSelect=$("cifMomentRotationAxis");
  const chiralitySelect=$("cifMomentChirality");
  const bulkSpinToggle=$("cifSpinBulkCheckbox");
  if(bulkSpinToggle&&!bulkSpinToggle.dataset.structureBound){
    bulkSpinToggle.dataset.structureBound="1";
    bulkSpinToggle.addEventListener("change",()=>fn.setSpinEnabledForDisplayed(bulkSpinToggle.checked));
  }
  const spinTableElementSelect=$("cifSpinTableElement");
  if(spinTableElementSelect&&!spinTableElementSelect.dataset.structureBound){
    spinTableElementSelect.dataset.structureBound="1";
    spinTableElementSelect.addEventListener("change",()=>{
      cifState.structureSpinTableElement=spinTableElementSelect.value;
      fn.updateMagneticMomentRows(fn.currentStructureForViewer()?.structure||null);
      fn.saveStructureViewerState();
    });
  }
  const editingSelect=$('cifSpinEditingMode');
  if(editingSelect){
    editingSelect.value=cifState.structureSpinEditingMode;
    editingSelect.disabled=false;
    if(!editingSelect.dataset.structureBound){
      editingSelect.dataset.structureBound='1';
      editingSelect.addEventListener('change',()=>{
        for(const [key,value] of fn.currentMomentSettings())cifState.structureMomentSettings.set(key,value);
        cifState.structureSpinEditingMode=editingSelect.value==='individual'?'individual':'sites';
        $('cifMagMomentRows')?.replaceChildren();
        fn.updateMagneticMomentRows(fn.currentStructureForViewer()?.structure||null);
        fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
      });
    }
  }
  const directionSelect=$("cifMomentDirectionMode");
  const lengthInput=$("cifMomentGlobalLength");
  const widthInput=$("cifMomentGlobalWidth");
  const headInput=$("cifMomentGlobalHead");
  if(directionSelect){
    directionSelect.value=cifState.structureMomentDirectionMode;
    if(!directionSelect.dataset.structureBound){
      directionSelect.dataset.structureBound="1";
      directionSelect.addEventListener("change",()=>{
        const live=fn.currentMomentSettings();
        for(const [key,value] of live) cifState.structureMomentSettings.set(key,value);
        cifState.structureMomentDirectionMode=directionSelect.value==="polar"?"polar":"cartesian";
        fn.saveStructureViewerState();
        fn.updateMagneticMomentRows(fn.currentStructureForViewer()?.structure||null);
        fn.renderCifStructureIfVisible();
      });
    }
  }
  if(lengthInput){
    lengthInput.value=String(cifState.structureMomentGlobalLength);
    if(!lengthInput.dataset.structureBound){
      lengthInput.dataset.structureBound="1";
      const commit=()=>{
        const raw=String(lengthInput.value||"").trim(), n=Number(raw);
        cifState.structureMomentGlobalLength=raw && Number.isFinite(n)?Math.max(0,n):1;
        fn.saveStructureViewerState(); fn.renderCifStructureIfVisible();
      };
      lengthInput.addEventListener("input",commit);
      lengthInput.addEventListener("change",commit);
    }
  }
  const bindGlobalArrowInput=(input,kind)=>{
    if(!input) return;
    const isWidth=kind==="width", defaultValue=isWidth?6:0.5;
    const blank=isWidth?cifState.structureMomentGlobalWidthBlank:cifState.structureMomentGlobalHeadBlank;
    input.value=blank?"":String(isWidth?cifState.structureMomentGlobalWidth:cifState.structureMomentGlobalHeadSize);
    input.placeholder=String(defaultValue);
    if(input.dataset.structureBound) return;
    input.dataset.structureBound="1";
    const commit=()=>{
      const raw=String(input.value||"").trim(); const n=Number(raw);
      if(isWidth){ cifState.structureMomentGlobalWidthBlank=!raw; cifState.structureMomentGlobalWidth=raw&&Number.isFinite(n)?Math.max(1,n):6; }
      else{ cifState.structureMomentGlobalHeadBlank=!raw; cifState.structureMomentGlobalHeadSize=raw&&Number.isFinite(n)?Math.max(0.01,n):0.5; }
      fn.saveStructureViewerState(); fn.renderCifStructureIfVisible();
    };
    input.addEventListener("input",commit); input.addEventListener("change",commit);
  };
  bindGlobalArrowInput(widthInput,"width");
  bindGlobalArrowInput(headInput,"head");
  const syncMomentStructureModeControls=()=>{
    const helical=cifState.structureMomentStructureType==="helical";
    if(axisSelect) axisSelect.disabled=false;
    if(chiralitySelect) chiralitySelect.disabled=false;
  };
  if(structureTypeSelect){
    syncImportedMomentStructureType();
    if(!structureTypeSelect.dataset.structureBound){
      structureTypeSelect.dataset.structureBound="1";
      structureTypeSelect.addEventListener("change",()=>{
        const requestedType=structureTypeSelect.value;
        fn.activateImportedMagneticEditing();
        cifState.structureMomentStructureType=["collinear","helical","sinusoidal"].includes(requestedType)?requestedType:"collinear";
        syncMomentStructureModeControls();
        fn.saveStructureViewerState();
        fn.renderCifStructureIfVisible();
      });
    }
  }
  if(axisSelect){
    axisSelect.value=fn.sourceIsMagneticCif() && !cifState.importedMagneticEditMode ? "mcif" : cifState.structureMomentRotationAxis;
    if(!axisSelect.dataset.structureBound){
      axisSelect.dataset.structureBound="1";
      axisSelect.addEventListener("change",()=>{
        const requestedAxis=axisSelect.value;
        fn.activateImportedMagneticEditing();
        cifState.structureMomentRotationAxis=["a","b","c"].includes(requestedAxis)?requestedAxis:"c";
        fn.saveStructureViewerState();
        fn.renderCifStructureIfVisible();
      });
    }
  }
  if(chiralitySelect){
    chiralitySelect.value=fn.sourceIsMagneticCif() && !cifState.importedMagneticEditMode ? "mcif" : cifState.structureMomentChirality;
    if(!chiralitySelect.dataset.structureBound){
      chiralitySelect.dataset.structureBound="1";
      chiralitySelect.addEventListener("change",()=>{
        const requestedChirality=chiralitySelect.value;
        fn.activateImportedMagneticEditing();
        cifState.structureMomentChirality=requestedChirality==="CW"?"CW":"CCW";
        fn.saveStructureViewerState();
        fn.renderCifStructureIfVisible();
      });
    }
  }
  syncMomentStructureModeControls();
}
}
