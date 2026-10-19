// Extracted from app.js without changing calculation/display behavior.
// Dependencies are injected by app.js to keep module boundaries explicit.
export function createUIShell(deps){
  const {
    $,
    BACKGROUND_SLOTS,
    GEOMETRY_CALC_MODE_STORAGE_KEY,
    GEOMETRY_SCAN_OUTPUT_STORAGE_KEY,
    add,
    applyInstrumentDefaults,
    applySampleEnvironmentDefaults,
    backgroundRowValues,
    buildResolutionLattice,
    checkedValue,
    currentGeometryCardTab,
    currentGeometryScanOutputTab,
    darkAssetIds,
    darkAssetSlots,
    darkAssetValues,
    geometryCalculationMode,
    markResolutionScanDirty,
    mountTimeEstimateForScript,
    propagationVectorValues,
    refreshDarkEnvironmentSelect,
    renderGeometry,
    renderQEVectorMap,
    renderResolutionScan,
    renderSingle,
    replaceBackgroundRows,
    replaceDarkAssets,
    replacePropagationVectors,
    resolutionPanelIsVisible,
    scheduleRecalc,
    selectedS1Sign,
    setBackgroundCount,
    setCifOutputTab,
    setDarkAssetCount,
    setDarkRangeCount,
    setGeometryCalculationMode,
    setGeometryCardTab,
    setGeometryScanOutputTab,
    setPropagationVectorCount,
    setQEMapTab,
    setupTasConventionUI,
    sub,
    updateAutoW,
    updateBackgroundSelectAvailability,
    updateDarkReferenceUI,
    updateEnergyLabel,
    updateModeVisibility,
    updateOrientationReferenceUI,
    updateResolutionPlaneWarning,
    updateS2MaxDisplay,
    updateSupermirrorUI,
    getSingleCache,
    getPowderCache,
    getSelectedCifStructure,
    getSelectedCifText,
    hasScanResults
  }=deps;

function safeResizePlot(el){
  if(typeof Plotly === "undefined" || !Plotly.Plots || !el || !el.isConnected) return;
  const style=window.getComputedStyle?.(el);
  if(style && (style.display==='none' || style.visibility==='hidden')) return;
  if(!(el.offsetWidth>0) || !(el.offsetHeight>0)) return;
  try{
    const result=Plotly.Plots.resize(el);
    if(result && typeof result.catch==='function') result.catch(()=>{});
  }catch(_err){}
}

function plotHasLayout(el){
  return !!(el && (el._fullLayout || el.classList?.contains('js-plotly-plot')));
}

function ensureVisiblePrimaryPlots(){
  if(typeof Plotly === "undefined") return;

  const qePanel=$('qePanel');
  if(qePanel && !qePanel.classList.contains('hidden')){
    const vector=!$('qeVectorMapPane')?.classList.contains('hidden');
    if(vector){
      if(getSingleCache()) renderQEVectorMap(getSingleCache());
    }else if(checkedValue('sampleMode')==='single'){
      if(getSingleCache()) renderSingle(getSingleCache(),Number($('hwSlider')?.value)||0);
    }else{
      const powderPlot=$('powderPlot');
      if(plotHasLayout(powderPlot)) safeResizePlot(powderPlot);
      else scheduleRecalc(0);
    }

    // renderSingle() also refreshes geometry.  If Time estimate is selected it
    // intentionally remains hidden; otherwise guarantee the currently selected
    // Single/Scan TAS geometry after the pane is measurable.
    if(currentGeometryCardTab()==='angles'){
      if(checkedValue('sampleMode')==='powder' && getPowderCache()) renderGeometry(getPowderCache(),0);
      else if(getSingleCache()) renderGeometry(getSingleCache(),Number($('hwSlider')?.value)||0);
    }
  }

  const resolutionPanel=$('resolutionPanel');
  if(resolutionPanel && !resolutionPanel.classList.contains('hidden')){
    if($('calcMode')?.value==='single'){
      // Single Resolution is automatic; render only after the panel is visible.
      scheduleRecalc(0);
    }else if(hasScanResults() && !$('result')?.classList.contains('hidden')){
      // Never launch the expensive scan calculation here.  Repaint only an
      // already-calculated result when returning to the tab.
      renderResolutionScan(Number($('scanSlider')?.value)||1);
    }else{
      ['plotUE','plotVE','plotUV','plotWE'].forEach(id=>safeResizePlot($(id)));
    }
  }
}

function scheduleVisiblePrimaryPlotRecovery(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    ensureVisiblePrimaryPlots();
    resizeVisiblePlots();
  }));
}

function resizeVisiblePlots(){
  if(typeof Plotly === "undefined" || !Plotly.Plots) return;
  const panel = [$("qePanel"),$("resolutionPanel"),$("toolboxPanel"),$("structurePanel"),$("scriptPanel")].find(p=>p && !p.classList.contains("hidden"));
  if(!panel) return;
  panel.querySelectorAll(".js-plotly-plot").forEach(el=>{
    safeResizePlot(el);
  });
}

let responsivePlotResizeFrame=0;
function scheduleVisiblePlotResize(){
  if(responsivePlotResizeFrame) cancelAnimationFrame(responsivePlotResizeFrame);
  responsivePlotResizeFrame=requestAnimationFrame(()=>{
    responsivePlotResizeFrame=requestAnimationFrame(()=>{
      responsivePlotResizeFrame=0;
      resizeVisiblePlots();
    });
  });
}

// Q-E Range: like the CIF/mCIF Generator, keep each column within the visible
// part of the main workspace, so the controls below the plots (Select Path,
// Snap, HKL, legend, sliders) are reachable without scrolling on short
// screens. Only the plot heights shrink (never grow beyond the stylesheet
// height). One-column layouts and very short viewports keep normal scrolling.
const QE_FIT_MIN_PLOT=300;
let qeViewportFrame=0;
function requestQEViewportHeightSync(){
  if(qeViewportFrame) return;
  qeViewportFrame=requestAnimationFrame(()=>{ qeViewportFrame=0; syncQEViewportHeight(); syncScriptViewportHeight(); syncResolutionViewportHeight(); });
}
function visibleElement(el){ return !!(el && el.getClientRects().length); }
function syncQEViewportHeight(){
  const panel=$('qePanel'), grid=document.querySelector('#singleMain .chart-grid'), main=panel?.closest('main');
  if(!panel || !grid || !main) return;
  const fitVars=['--qe-fit-left','--qe-fit-right'];
  const prev=fitVars.map(name=>panel.style.getPropertyValue(name)).join('|');
  // Measure the stylesheet (natural) heights first.
  panel.classList.remove('qe-fit-left','qe-fit-right');
  for(const name of fitVars) panel.style.removeProperty(name);
  const twoColumns=getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length>=2;
  if(visibleElement(panel) && twoColumns){
    const mainRect=main.getBoundingClientRect(), ms=getComputedStyle(main);
    const available=main.clientHeight-(parseFloat(ms.paddingBottom)||0);
    // Bottom of the column's own content (the grid stretches the columns).
    const columnOverflow=column=>{
      const cs=getComputedStyle(column);
      let bottom=-Infinity;
      for(const child of column.children) if(visibleElement(child)) bottom=Math.max(bottom,child.getBoundingClientRect().bottom);
      if(!Number.isFinite(bottom)) return 0;
      const end=bottom-mainRect.top+main.scrollTop
        +(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.borderBottomWidth)||0)+(parseFloat(cs.marginBottom)||0);
      return end-available;
    };
    const fit=(column,plots,side)=>{
      const name=`--qe-${side}`;
      const plot=plots.map(id=>$(id)).find(visibleElement);
      if(!column || !plot) return;
      const over=columnOverflow(column);
      if(!(over>1)) return;
      const height=Math.max(QE_FIT_MIN_PLOT,Math.floor(plot.offsetHeight-over));
      if(height<plot.offsetHeight){ panel.style.setProperty(name,`${height}px`); panel.classList.add(`qe-${side}`); }
    };
    fit(grid.querySelector('.qe-main-plot-column'),['singlePlot','powderPlot','qeVectorPlot'],'fit-left');
    fit(grid.querySelector('.geometry-card'),['geometryPlot'],'fit-right');
  }
  const next=fitVars.map(name=>panel.style.getPropertyValue(name)).join('|');
  if(next!==prev) scheduleVisiblePlotResize();
}
function gridColumnCount(el){
  return getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
}
// Resolution tab: the same idea for the four ellipse plots.  Only the plots are
// fitted into the visible height; the matrices below them still scroll.
const RES_FIT_MIN_PLOT=200;
function syncResolutionViewportHeight(){
  const panel=$('resolutionPanel'), plots=document.querySelector('#result .plots'), main=panel?.closest('main');
  const workspace=panel?.querySelector('.resolution-workspace');
  if(!panel || !plots || !main) return;
  const prev=panel.style.getPropertyValue('--res-fit-plot');
  panel.classList.remove('res-fit');
  panel.style.removeProperty('--res-fit-plot');
  const first=plots.firstElementChild;
  if(visibleElement(panel) && visibleElement(first) && (!workspace || gridColumnCount(workspace)>=2)){
    const mainRect=main.getBoundingClientRect(), ms=getComputedStyle(main);
    const available=main.clientHeight-(parseFloat(ms.paddingBottom)||0);
    const bottom=plots.getBoundingClientRect().bottom-mainRect.top+main.scrollTop;
    const over=bottom-available;
    if(over>1){
      const rows=Math.ceil(plots.children.length/Math.max(1,gridColumnCount(plots)));
      const height=Math.max(RES_FIT_MIN_PLOT,Math.floor(first.offsetHeight-over/rows));
      if(height<first.offsetHeight){ panel.style.setProperty('--res-fit-plot',`${height}px`); panel.classList.add('res-fit'); }
    }
  }
  if(panel.style.getPropertyValue('--res-fit-plot')!==prev) scheduleVisiblePlotResize();
}
// Script: the same idea. In the multi-column layout the workspace takes the
// visible height of the main area; ASET list, command list and SPICE editor
// scroll inside their panes instead of the page.
const SCRIPT_FIT_MIN=360;
function syncScriptViewportHeight(){
  const panel=$('scriptPanel'), ws=panel?.querySelector('.script-workspace'), card=panel?.querySelector('.script-card');
  const main=panel?.closest('main');
  if(!panel || !ws || !card || !main) return;
  const prev=panel.style.getPropertyValue('--script-fit-height');
  panel.classList.remove('script-height-limited');
  panel.style.removeProperty('--script-fit-height');
  const columns=getComputedStyle(ws).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  if(visibleElement(panel) && columns>=2){
    const mainRect=main.getBoundingClientRect(), ms=getComputedStyle(main), cs=getComputedStyle(card);
    const available=main.clientHeight-(parseFloat(ms.paddingBottom)||0);
    const wsTop=ws.getBoundingClientRect().top-mainRect.top+main.scrollTop;
    const below=(card.getBoundingClientRect().bottom-ws.getBoundingClientRect().bottom)+(parseFloat(cs.marginBottom)||0);
    const height=Math.floor(available-wsTop-below);
    if(height>=SCRIPT_FIT_MIN){
      panel.style.setProperty('--script-fit-height',`${height}px`);
      panel.classList.add('script-height-limited');
    }
  }
}
function initializeQEViewportHeightSync(){
  window.addEventListener('resize',requestQEViewportHeightSync,{passive:true});
  window.visualViewport?.addEventListener('resize',requestQEViewportHeightSync);
  if(typeof ResizeObserver!=='undefined'){
    // Pane sizes change on tab switches, Single/Powder, warnings and wrapping.
    const observer=new ResizeObserver(requestQEViewportHeightSync);
    for(const el of [document.querySelector('main'),$('qePanel'),$('qeConstantMapPane'),$('qeVectorMapPane'),
      $('geometryAnglesPane'),$('geometryTimePane'),$('scriptPanel'),$('resolutionPanel'),$('result')]) if(el) observer.observe(el);
  }
  requestQEViewportHeightSync();
}

function initializeResponsivePlotResize(){
  initializeQEViewportHeightSync();
  window.addEventListener('resize',scheduleVisiblePlotResize,{passive:true});
  if(typeof ResizeObserver!=="undefined"){
    const main=document.querySelector('main');
    if(main){
      const observer=new ResizeObserver(scheduleVisiblePlotResize);
      observer.observe(main);
    }
  }
}

function setActiveTab(name){
  const isQE=name==='qe', isResolution=name==='resolution', isToolbox=name==='toolbox', isGenerator=name==='cif-generator'||name==='structure', isScript=name==='script';
  mountTimeEstimateForScript(isScript);
  const sampleMode=$('sampleMode');
  if(isResolution){
    if(sampleMode.value!=="single"){
      sampleMode.value="single";
      updateModeVisibility();
      scheduleRecalc();
    }
    sampleMode.disabled=true;
    try{ buildResolutionLattice(true); }catch(_err){}
  }else{
    sampleMode.disabled=false;
  }
  $('qePanel').classList.toggle('hidden',!isQE);
  $('resolutionPanel').classList.toggle('hidden',!isResolution);
  $('toolboxPanel').classList.toggle('hidden',!isToolbox);
  $('structurePanel')?.classList.toggle('hidden',!isGenerator);
  $('scriptPanel')?.classList.toggle('hidden',!isScript);
  for(const [id,on] of [['tabQe',isQE],['tabResolution',isResolution],['tabToolbox',isToolbox],['tabCifGenerator',isGenerator],['tabScript',isScript]]){
    $(id)?.classList.toggle('active',on);
    $(id)?.setAttribute('aria-selected',String(on));
  }
  if(isResolution){
    // Scan remains Calculate-driven.  Single is recovered after the visible
    // panel has completed layout by scheduleVisiblePrimaryPlotRecovery().
    if($("calcMode")?.value==="scan" && !hasScanResults()) markResolutionScanDirty();
  }else if(isQE){
    // Q-E may have been intentionally left stale while the heavy Resolution
    // tab was active; rebuild it only when the user actually returns here.
    scheduleRecalc(0);
  }
  try{ localStorage.setItem(ACTIVE_TAB_STORAGE_KEY,isGenerator?'cif-generator':name); }catch(_e){}
  scheduleVisiblePrimaryPlotRecovery();
}
function updateCalcMode(){
  const scan=$('calcMode').value==='scan';
  $('singleInputs').classList.toggle('hidden',scan);
  $('scanInputs').classList.toggle('hidden',!scan);
  updateResolutionPlaneWarning();
  if(scan) markResolutionScanDirty();
  else if(resolutionPanelIsVisible()) scheduleVisiblePrimaryPlotRecovery();
}

// ==================== App chrome + right-panel persistence ====================
const RIGHT_PANEL_STORAGE_KEY='tas-simulator-right-panel-v1';
const ACTIVE_TAB_STORAGE_KEY='tas-simulator-active-tab-v1';
let restoringRightPanel=false;

function setupAppHeader(){
  document.title='PLANE-TAS';
  const header=document.querySelector('header');
  const h1=header?.querySelector('h1');
  if(h1) h1.textContent='PLANE-TAS';
  if(!header) return;

  // Keep the user manual next to the repository link in the top status bar.
  // Both are ordinary static links so they work on localhost and GitHub Pages.
  if(!document.getElementById('manualLink')){
    const manual=document.createElement('a');
    manual.id='manualLink';
    manual.href='PLANE-TAS_Manual.html';
    manual.target='_blank';
    manual.rel='noopener noreferrer';
    manual.textContent='Manual';
    manual.title='Open the PLANE-TAS user manual';
    Object.assign(manual.style,{whiteSpace:'nowrap',fontWeight:'600'});
    header.appendChild(manual);
  }

  if(!document.getElementById('githubLink')){
    // Project repository: fixed URL so the GitHub link works identically on
    // localhost, GitHub Pages, and custom-domain deployments.
    const repoUrl='https://github.com/plane-tas/plane-tas.github.io';
    const github=document.createElement('a');
    github.id='githubLink';
    github.href=repoUrl;
    github.target='_blank';
    github.rel='noopener noreferrer';
    github.textContent='GitHub';
    github.title='Open this project on GitHub';
    Object.assign(github.style,{whiteSpace:'nowrap',fontWeight:'600'});
    header.appendChild(github);
  }

  // Keep status, Manual, and GitHub together at the right side of the header.
  header.style.display='flex';
  header.style.alignItems='center';
  header.style.gap='14px';
  const status=header.querySelector('#status');
  if(status) status.style.marginLeft='auto';
}

function rightPanelControls(){
  return [...document.querySelectorAll('#qePanel input[id], #qePanel select[id], #resolutionPanel input[id], #resolutionPanel select[id], #toolboxPanel input[id], #toolboxPanel select[id]')]
    .filter(el=>!el.closest?.('.time-estimate-pane') && el.type!=='button' && el.type!=='submit' && el.type!=='file'
      && el.dataset.noPersist===undefined);
}

function saveRightPanelState(){
  if(restoringRightPanel) return;
  try{
    const values={};
    for(const el of rightPanelControls()){
      values[el.id]=(el.type==='checkbox'||el.type==='radio') ? !!el.checked : el.value;
    }
    // Keep the tab state alongside the right-panel values as well as in its
    // dedicated keys.  This makes Single/Scan and Table/TAS geometry survive
    // reloads even if initialization later rebuilds or re-renders the panel.
    values.__geometryCalculationMode=geometryCalculationMode();
    values.__geometryScanOutputTab=currentGeometryScanOutputTab();
    localStorage.setItem(RIGHT_PANEL_STORAGE_KEY,JSON.stringify({version:2,values}));
    localStorage.setItem(GEOMETRY_CALC_MODE_STORAGE_KEY,values.__geometryCalculationMode);
    localStorage.setItem(GEOMETRY_SCAN_OUTPUT_STORAGE_KEY,values.__geometryScanOutputTab);
  }catch(_e){ /* localStorage may be unavailable in a restricted browser context. */ }
}

function restoreRightPanelState(){
  let saved;
  try{saved=JSON.parse(localStorage.getItem(RIGHT_PANEL_STORAGE_KEY)||'null');}catch(_e){return false;}
  if(!saved || !saved.values || typeof saved.values!=='object') return false;
  restoringRightPanel=true;
  try{
    for(const el of rightPanelControls()){
      const value=saved.values[el.id];
      if(value===undefined) continue;
      if(el.type==='checkbox'||el.type==='radio') el.checked=!!value;
      else if(el.tagName==='SELECT'){
        if([...el.options].some(o=>o.value===String(value))) el.value=String(value);
      }else el.value=String(value);
    }
    updateCalcMode();
    // Restore the geometry sub-tabs after every right-panel value has been
    // applied.  Applying this last prevents later UI refreshes from leaving the
    // HTML-default Single/Table tabs selected.
    const savedGeometryMode=saved.values.__geometryCalculationMode;
    const savedGeometryOutput=saved.values.__geometryScanOutputTab;
    if(savedGeometryMode==='single' || savedGeometryMode==='scan') setGeometryCalculationMode(savedGeometryMode);
    if(savedGeometryOutput==='table' || savedGeometryOutput==='plot') setGeometryScanOutputTab(savedGeometryOutput);
    return true;
  }finally{restoringRightPanel=false;}
}

function savedActiveTab(){
  try{
    const name=localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return ['qe','resolution','toolbox','cif-generator','structure','script'].includes(name) ? name : 'qe';
  }catch(_e){ return 'qe'; }
}

function restoreGeometrySubTabsFromStorage(){
  try{
    const mode=localStorage.getItem(GEOMETRY_CALC_MODE_STORAGE_KEY);
    const output=localStorage.getItem(GEOMETRY_SCAN_OUTPUT_STORAGE_KEY);
    setGeometryCalculationMode(mode==='scan'?'scan':'single');
    setGeometryScanOutputTab(output==='plot'?'plot':'table');
  }catch(_e){
    setGeometryCalculationMode('single');
    setGeometryScanOutputTab('table');
  }
}

function enableRightPanelPersistence(){
  for(const panelId of ['qePanel','resolutionPanel','toolboxPanel']){
    const panel=$(panelId); if(!panel) continue;
    panel.addEventListener('input',saveRightPanelState);
    panel.addEventListener('change',saveRightPanelState);
  }
}

// Catch-all UI persistence.  Dedicated serializers above remain authoritative
// for dynamic/complex widgets (Dark angle, BG, Time estimate, Script, etc.),
// while this layer prevents ordinary stable-ID controls or tab choices from
// silently falling through the cracks as the UI evolves.
const APP_UI_STORAGE_KEY='tas-simulator-ui-state-v1';
function currentGlobalCifScope(){
  const raw=String(getSelectedCifText?.()||'');
  if(!raw)return 'generator:empty';
  let hash=0x811c9dc5;
  for(let i=0;i<raw.length;i++){
    hash^=raw.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;
  }
  return `cif:${raw.length}:${hash.toString(16)}`;
}
let restoringGlobalUI=false;
let globalUIPersistenceEnabled=false;

function globalUIPersistentControls(){
  return [...document.querySelectorAll('input[id], select[id], textarea[id]')].filter(el=>{
    const type=String(el.type||'').toLowerCase();
    if(['button','submit','file'].includes(type)) return false;
    if(el.readOnly) return false; // derived outputs are recomputed, not restored
    if(el.dataset.noPersist!==undefined) return false; // per-file choices (magnetic ion)
    return true;
  });
}

function currentCifOutputTab(){
  // Report the actual four-way selection to global UI state, but leave
  // persistence/restoration ownership with cif-ui.js.
  for(const [id,value] of [['mcifTabStructure','structure'],['cifOutputTabReflections','reflections'],['cifOutputTabPreview','cif-preview'],['mcifTabPreview','mcif-preview']]){
    if($(id)?.classList.contains('active')) return value;
  }
  return 'structure';
}

function saveGlobalUIState(){
  if(restoringGlobalUI || !globalUIPersistenceEnabled) return;
  try{
    const controls={};
    for(const el of globalUIPersistentControls()){
      controls[el.id]=(el.type==='checkbox'||el.type==='radio') ? !!el.checked : el.value;
    }
    const tabs={
      main:['qe','resolution','toolbox','cif-generator','structure','script'].find(name=>{
        const id={qe:'tabQe',resolution:'tabResolution',toolbox:'tabToolbox','cif-generator':'tabCifGenerator',structure:'tabStructure',script:'tabScript'}[name];
        return $(id)?.classList.contains('active');
      }) || 'qe',
      qeMap:$('qeMapTabVector')?.classList.contains('active') ? 'vector' : 'constant',
      geometryCard:currentGeometryCardTab(),
      geometryMode:geometryCalculationMode(),
      geometryOutput:currentGeometryScanOutputTab(),
      cifOutput:currentCifOutputTab()
    };
    localStorage.setItem(APP_UI_STORAGE_KEY,JSON.stringify({version:2,
      sourceKey:currentGlobalCifScope(),controls,tabs}));
  }catch(_e){}
}

function restoreGlobalUIState(){
  let saved;
  try{ saved=JSON.parse(localStorage.getItem(APP_UI_STORAGE_KEY)||'null'); }catch(_e){ return false; }
  if(!saved || ![1,2].includes(saved.version) || !saved.controls || typeof saved.controls!=='object') return false;
  restoringGlobalUI=true;
  try{
    // The selected CIF/mCIF is restored by initializeCifGenerator() BEFORE
    // this generic snapshot. Its space group and cell belong to that file,
    // not to an older global UI snapshot (which may still say P1).
    // Do not undo the file import by restoring stale values over either editor.
    const fileOwnsCell=!!getSelectedCifStructure?.();
    const restoringSameSource=saved.version===2 && saved.sourceKey===currentGlobalCifScope();
    const fileCellControls=new Set([
      'sampleSpaceGroup','sampleSpaceGroupNumber',
      'cifCrystalSystem','cifSpaceGroup','cifSpaceGroupNumber',
      'a','b','c','alpha','beta','gamma',
      'cifA','cifB','cifC','cifAlpha','cifBeta','cifGamma'
    ]);
    for(const el of globalUIPersistentControls()){
      // File import wins for a NEW source, but the last edited controls win
      // on ordinary reload of that SAME source. Prevent old P1 settings from
      // a different CIF leaking into a newly loaded structure.
      if(fileOwnsCell && fileCellControls.has(el.id) && !restoringSameSource) continue;
      // The mCIF format and magnetic-cell draft each have dedicated source-
      // aware persistence. Setting them here would skip their change handlers.
      if(el.id==='cifOutputFormat' || el.id.startsWith('cifMag'))continue;
      const value=saved.controls[el.id];
      if(value===undefined) continue;
      if(el.type==='checkbox'||el.type==='radio') el.checked=!!value;
      else if(el.tagName==='SELECT'){
        if([...el.options].some(o=>o.value===String(value))) el.value=String(value);
      }else el.value=String(value);
    }
    const tabs=saved.tabs||{};
    if(['constant','vector'].includes(tabs.qeMap)) setQEMapTab(tabs.qeMap);
    if(['angles','time'].includes(tabs.geometryCard)) setGeometryCardTab(tabs.geometryCard);
    if(['single','scan'].includes(tabs.geometryMode)) setGeometryCalculationMode(tabs.geometryMode);
    if(['table','plot'].includes(tabs.geometryOutput)) setGeometryScanOutputTab(tabs.geometryOutput);
    // CIF/mCIF generator output tabs have their own four-tab persistence in
    // cif-ui.js (tas-simulator-generator-output-tab-v1). Do not restore the
    // legacy two-tab `cifOutput` value here: it runs AFTER that restore and
    // used to force the interface back to CIF Preview on every page reload.
    if(['qe','resolution','toolbox','cif-generator','structure','script'].includes(tabs.main)) setActiveTab(tabs.main);
    updateCalcMode(); updateModeVisibility(); updateOrientationReferenceUI();
    for(const slot of darkAssetSlots()) updateDarkReferenceUI(slot);
    updateBackgroundSelectAvailability();
    return true;
  }finally{ restoringGlobalUI=false; }
}

function enableGlobalUIPersistence(){
  if(globalUIPersistenceEnabled) return;
  globalUIPersistenceEnabled=true;
  document.addEventListener('input',saveGlobalUIState);
  document.addEventListener('change',saveGlobalUIState);
  document.addEventListener('click',event=>{
    if(event.target.closest?.('[role="tab"]')) setTimeout(saveGlobalUIState,0);
  });
}

setupAppHeader();

// ==================== Local left-panel persistence ====================
// Instrument/sample JSON files are the source of available choices and defaults.
// Restore the user's browser-local values only AFTER those JSON files have loaded,
// so saved values never race with or get overwritten by configuration loading.
const LEFT_PANEL_STORAGE_KEY='tas-qe-left-panel-v1';
let restoringLeftPanel=false;

function leftPanelControls(){
  return [...document.querySelectorAll('.sidebar input[id], .sidebar select[id]')].filter(el=>el.type!=='file');
}

function resolutionInstrumentDetailControls(){
  return [...document.querySelectorAll('#resolutionInstrumentDetails input[id], #resolutionInstrumentDetails select[id]')]
    .filter(el=>el.type!=='file');
}

function saveLeftPanelState(){
  if(restoringLeftPanel) return;
  try{
    const values={};
    for(const el of leftPanelControls()){
      values[el.id]=(el.type==='checkbox'||el.type==='radio') ? !!el.checked : el.value;
    }
    // Background-material rows are dynamic.  Persist their ordered selections
    // explicitly so add/remove/rebuild operations cannot lose the user's BG
    // choices even if a dynamic <select> is temporarily absent from the DOM.
    values.__backgroundRows=backgroundRowValues();
    values.backgroundCount=values.__backgroundRows.length;
    // Dynamic sidebar groups need an explicit structural snapshot as well as
    // per-control values. Add/remove operations do not emit input/change events,
    // and recreating the DOM from only fixed IDs can otherwise lose row counts.
    values.__propagationVectors=propagationVectorValues();
    values.propagationCount=values.__propagationVectors.length;
    values.__darkAssets=darkAssetValues();
    values.darkAssetCount=values.__darkAssets.length;
    // S1 sign is dynamically injected by setupTasConventionUI(); keep an explicit
    // snapshot so future layout changes cannot accidentally omit it.
    values.s1sign=selectedS1Sign();
    localStorage.setItem(LEFT_PANEL_STORAGE_KEY,JSON.stringify({version:3,values}));
  }catch(_e){ /* localStorage may be unavailable in a restricted browser context. */ }
}

function setSavedControl(id,value,{dispatchChange=false}={}){
  const el=$(id); if(!el || value===undefined || el.type==='file') return false;
  if(el.type==='checkbox'||el.type==='radio') el.checked=!!value;
  else if(el.tagName==='SELECT'){
    if(![...el.options].some(o=>o.value===String(value))) return false;
    el.value=String(value);
  }else el.value=String(value);
  if(dispatchChange) el.dispatchEvent(new Event('change'));
  return true;
}

function restoreLeftPanelState(){
  let saved;
  try{saved=JSON.parse(localStorage.getItem(LEFT_PANEL_STORAGE_KEY)||'null');}catch(_e){return false;}
  if(!saved || !saved.values || typeof saved.values!=='object') return false;
  const v=saved.values;
  // Migrate HB-3A's former filename without discarding saved user parameters.
  if(v.instrument==='08_HB3A_DEMAND.json' &&
     [...($('instrument')?.options||[])].some(option=>option.value==='08_HB3A.json')){
    v.instrument='08_HB3A.json';
  }
  restoringLeftPanel=true;
  try{
    // 1) The instrument must exist before its dependent defaults can be applied.
    if(setSavedControl('instrument',v.instrument)) applyInstrumentDefaults();

    // Recreate the dynamic Propagation/Dark UI before restoring individual
    // controls.  For legacy fixed-3/fixed-4 saves, only actually used extra
    // slots/ranges are expanded.
    const nonzero=x=>Number.isFinite(Number(x)) && Math.abs(Number(x))>1e-12;
    const savedPropagationVectors=Array.isArray(v.__propagationVectors)
      ? v.__propagationVectors.map(row=>({
          enabled:!!row?.enabled,
          h:String(row?.h ?? "0"), k:String(row?.k ?? "0"), l:String(row?.l ?? "0")
        }))
      : null;
    let propagationCount=savedPropagationVectors?.length || Number(v.propagationCount);
    if(!(propagationCount>=1)){
      propagationCount=1;
      for(let i=2;i<=3;i++){
        if(v[`q_enable${i}`] || ["h","k","l"].some(c=>nonzero(v[`q${i}_${c}`]))) propagationCount=i;
      }
    }
    if(savedPropagationVectors?.length) replacePropagationVectors(savedPropagationVectors,{recalc:false});
    else setPropagationVectorCount(propagationCount);

    const savedBackgroundRows=Array.isArray(v.__backgroundRows)
      ? v.__backgroundRows.map(row=>({key:String(row?.key||"")}))
      : null;
    let backgroundCount=savedBackgroundRows?.length || Number(v.backgroundCount);
    if(!(backgroundCount>=1)){
      backgroundCount=1;
      for(let i=2;i<=BACKGROUND_SLOTS.length;i++) if(v[`backgroundSelect${i}`]) backgroundCount=i;
    }
    if(savedBackgroundRows?.length) replaceBackgroundRows(savedBackgroundRows,{recalc:false});
    else setBackgroundCount(backgroundCount);

    const savedDarkAssets=Array.isArray(v.__darkAssets)
      ? v.__darkAssets.map(card=>({
          enabled:card?.enabled!==undefined ? !!card.enabled : true,
          se:String(card?.se||""), ref:String(card?.ref||"Reference Q"),
          rotation:Number(card?.rotation), refH:String(card?.refH??''), refK:String(card?.refK??''), refL:String(card?.refL??''),
          ranges:Array.isArray(card?.ranges) ? card.ranges.map(r=>({from:Number(r?.from),to:Number(r?.to),offset:Number(r?.offset)})) : [{}]
        }))
      : null;
    if(savedDarkAssets?.length){
      // Exact snapshot: preserve asset count, range count, checkbox state,
      // sample-environment selection and all user-entered values.
      replaceDarkAssets(savedDarkAssets,{recalc:false});
    }else{
      // Backward-compatible restore for pre-v113 localStorage.
      let darkCount=Number(v.darkAssetCount);
      if(!(darkCount>=1)){
        darkCount=1;
        for(let slot=2;slot<=3;slot++){
          const ids=darkAssetIds(slot);
          const used=!!v[ids.enable] || !!v[ids.se] || (v[ids.ref] && v[ids.ref]!=="Reference Q") ||
            nonzero(v[ids.rotation]) || (v[ids.refH]!==undefined && Math.abs(Number(v[ids.refH])-1)>1e-12) || nonzero(v[ids.refK]) || nonzero(v[ids.refL]) ||
            [0,1,2,3].some(i=>nonzero(v[ids.from(i)])||nonzero(v[ids.to(i)])||nonzero(v[ids.offset(i)]));
          if(used) darkCount=slot;
        }
      }
      setDarkAssetCount(darkCount);
      for(const slot of darkAssetSlots()){
        const ids=darkAssetIds(slot);
        let rangeCount=Number(v[ids.rangeCount]);
        if(!(rangeCount>=1)){
          rangeCount=1;
          if(slot<=3){
            for(let i=1;i<4;i++){
              if(nonzero(v[ids.from(i)])||nonzero(v[ids.to(i)])||nonzero(v[ids.offset(i)])) rangeCount=i+1;
            }
          }
        }
        setDarkRangeCount(slot,rangeCount);
        refreshDarkEnvironmentSelect(slot);
      }

      // Legacy saves relied on the selected sample-environment JSON to seed
      // the rest of each dark-angle card before individual controls were restored.
      for(const slot of darkAssetSlots()){ const ids=darkAssetIds(slot); if(setSavedControl(ids.se,v[ids.se])) applySampleEnvironmentDefaults(slot); }
    }

    // Migrate the v57 single background selection into BG1 once, if present.
    if(v.backgroundSelect1===undefined && v.sampleSelect!==undefined) v.backgroundSelect1=v.sampleSelect;

    // Migrate v71/v72 q_h1 naming (and the older single-vector controls)
    // into the q1_h/q1_k/q1_l convention.
    if(v.q_enable1===undefined && v.showK!==undefined) v.q_enable1=!!v.showK;
    for(let i=1;i<=3;i++){
      for(const c of ["h","k","l"]){
        const newId=`q${i}_${c}`, oldId=`q_${c}${i}`;
        if(v[newId]===undefined && v[oldId]!==undefined) v[newId]=v[oldId];
      }
    }
    if(v.q1_h===undefined && v.kh!==undefined) v.q1_h=v.kh;
    if(v.q1_k===undefined && v.kk!==undefined) v.q1_k=v.kk;
    if(v.q1_l===undefined && v.kl!==undefined) v.q1_l=v.kl;

    // 3) Restore every left-side parameter.  For crystal selectors, run their
    //    existing UI handler first; dMono/dAna are restored afterwards in DOM order.
    const darkSeIds=new Set(darkAssetSlots().map(slot=>darkAssetIds(slot).se));
    const explicitBackgroundRows=!!savedBackgroundRows?.length;
    // The Resolution-only instrument details used to live in the permanent
    // sidebar. Include them here only for migration of the old left-panel
    // localStorage values; subsequent edits are persisted by resolutionPanel.
    const legacyRestoreControls=[...leftPanelControls(),...resolutionInstrumentDetailControls()];
    for(const el of legacyRestoreControls){
      if(el.id==='instrument'||darkSeIds.has(el.id)) continue;
      if(explicitBackgroundRows && /^backgroundSelect\d+$/.test(el.id)) continue;
      setSavedControl(el.id,v[el.id],{dispatchChange:el.id==='monoCrystal'||el.id==='anaCrystal'});
    }

    updateModeVisibility(); updateEnergyLabel(); updateS2MaxDisplay(); updateSupermirrorUI(); updateAutoW();
    return true;
  }finally{restoringLeftPanel=false;}
}


  return {
    safeResizePlot,
    plotHasLayout,
    ensureVisiblePrimaryPlots,
    scheduleVisiblePrimaryPlotRecovery,
    resizeVisiblePlots,
    scheduleVisiblePlotResize,
    initializeResponsivePlotResize,
    setActiveTab,
    updateCalcMode,
    setupAppHeader,
    rightPanelControls,
    saveRightPanelState,
    restoreRightPanelState,
    savedActiveTab,
    restoreGeometrySubTabsFromStorage,
    enableRightPanelPersistence,
    globalUIPersistentControls,
    currentCifOutputTab,
    saveGlobalUIState,
    restoreGlobalUIState,
    enableGlobalUIPersistence,
    leftPanelControls,
    resolutionInstrumentDetailControls,
    saveLeftPanelState,
    setSavedControl,
    restoreLeftPanelState
  };
}
