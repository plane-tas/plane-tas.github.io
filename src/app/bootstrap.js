// Start-up: load the data directories, restore saved state and draw the first view.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {fetchJsonOnce, isGitHubPages, isLocalDirectoryListingHost, loadCifDirectory, loadJsonDirectory, manifestWarnings} from './data-loader.js';
import {createFixedBeamControls} from './fixed-beam-units.js';
import {saveQEFigure} from '../qe/qe-save-figure.js';
import {initializePlotSaveButtons} from './plot-save-buttons.js';
import {initializeJumpBars} from './jump-bar.js';
import {$, checkedValue, clearError, num, setStatus, showError} from './dom-utils.js';
export function createAppBootstrap(deps){
  const {
    applyInstrumentCrystalAvailability, applyInstrumentDefaults,
    applySampleEnvironmentDefaults, backgroundMaterials, backgroundRowIndices,
    bindResolutionManualCalculation, bindToolboxUI, clearSelectedCif, currentGeometryCardTab,
    darkAssetIds, darkAssetSlots, doScanResolution, enableGlobalUIPersistence,
    enableRightPanelPersistence, fillCrystal,
    flipScatteringPlaneUV, initializeCifGenerator, initializeNeutronData, initializeResponsivePlotResize,
    initializeScriptWorkspaceUI, initializeSidebarCrystalSelectors, instruments, legacyRangeInstruments,
    nearestHWIndex, prepareToolboxUI, propagationVectorIndices, qeCommitPathText, qeDefaultPathText,
    qePathInput, recalculate, refreshCifAfterStateRestore, refreshDarkEnvironmentSelect, refreshSelect,
    renderResolutionScan, renderSingle, restoreGlobalUIState,
    restoreLeftPanelState, restoreRightPanelState, sampleEnvironments, saveGlobalUIState,
    saveLeftPanelState, saveRightPanelState, savedActiveTab, selectCifFile, setActiveTab,
    setBackgroundCount, setDarkAssetCount, setGeometryTargetHKL, setPowderLinkDriver,
    setPropagationVectorCount, setQEMapTab, setTargetHWFromMap, syncGeometryTargetToOrientationReference,
    syncPowderLinkedInputs, syncQEPathSnapDefault, syncSfColorMaxControl, syncSidebarCrystalSelectors,
    updateAutoW, updateBackgroundSelectAvailability, updateBraggOrientationPlaneWarning, resetBraggPeaks, updateCalcMode,
    updateCifUI, updateDarkReferenceUI, updateEnergyLabel, updateGeometryQuickTargetButtons,
    updateModeVisibility, updateOrientationReferenceUI, updatePropagationVectorLabels,
    updateResolutionPlaneWarning, updateSupermirrorUI, validateAllTimeScanRows, getFixedBeamControls,
    getGeometrySliders, getSingleCache, setFixedBeamControls, addLocalInstruments, redrawPowder
  }=deps;

async function tryLoadDir(directory,map,{skipGitHubPages=false}={}){
  if(skipGitHubPages && isGitHubPages()){ map.clear(); return 0; }
  try{return await loadJsonDirectory(directory,map);}catch(_e){map.clear();return 0;}
}
async function tryLoadCifDir(directory,map,{skipGitHubPages=false,beforeParse=null}={}){
  if(skipGitHubPages && isGitHubPages()){ map.clear(); return 0; }
  try{return await loadCifDirectory(directory,map,{beforeParse});}catch(_e){map.clear();return 0;}
}
function mergeLegacyRangeData(){
  for(const [key,inst] of instruments){
    if(Array.isArray(inst.S2_limits)||inst.S2_max!==undefined||(inst.qe_range&&(Array.isArray(inst.qe_range.S2_limits)||Array.isArray(inst.qe_range.configuration)))) continue;
    let legacy=legacyRangeInstruments.get(key);
    if(!legacy){const target=(inst.name||key).toLowerCase();legacy=[...legacyRangeInstruments.values()].find(x=>(x.name||'').toLowerCase()===target);}
    if(legacy) inst.qe_range=legacy;
  }
}
async function initialize(){
  setFixedBeamControls(createFixedBeamControls());
  clearError(); fillCrystal('monoCrystal','dMono');fillCrystal('anaCrystal','dAna');initializeSidebarCrystalSelectors();updateModeVisibility();updateEnergyLabel();updateCalcMode();updateSupermirrorUI();updateAutoW();
  initializeScriptWorkspaceUI();
  try{
    // Snap 1/n: the user's explicit choice, else the lattice default.
    syncQEPathSnapDefault();
    const savedMapTab=localStorage.getItem('tas-qe-map-tab-v1');
    setQEMapTab(savedMapTab==='vector'?'vector':'constant');
  }catch(_e){ setQEMapTab('constant'); }

  // Register the main tabs before any optional async data source is loaded.
  // A missing optional directory or CIF-generator asset must never leave the
  // application stuck with only the initially visible Q-E panel.
  $('tabQe')?.addEventListener('click',()=>setActiveTab('qe'));
  $('tabResolution')?.addEventListener('click',()=>setActiveTab('resolution'));
  $('tabToolbox')?.addEventListener('click',()=>setActiveTab('toolbox'));
  $('tabCifGenerator')?.addEventListener('click',()=>setActiveTab('cif-generator'));
  $('tabScript')?.addEventListener('click',()=>setActiveTab('script'));

  setStatus('neutron data / instrument / BG_material / sample_environments loading...');
  // Start every independent download now instead of one after another.
  // The space-group table is only needed later by the CIF generator, which
  // awaits this same request (fetchJsonOnce).
  fetchJsonOnce('space-groups.json');
  const neutronLoad=initializeNeutronData();
  const instrumentLoad=loadJsonDirectory('instrument',instruments);
  instrumentLoad.catch(()=>{}); // awaited (and reported) below
  const optionalLoads=Promise.all([
    // Optional data directories are loaded on every host.  GitHub Pages uses
    // the repository contents API, so no directory/index.json probe is needed.
    // BG CIFs download in parallel but are parsed only after the neutron
    // scattering lengths are in place (parsing reads them).
    tryLoadCifDir('BG_material',backgroundMaterials,{beforeParse:neutronLoad}),
    tryLoadDir('sample_environments',sampleEnvironments)
  ]);
  let nNeutron=0;
  try{ nNeutron=await neutronLoad; }
  catch(err){ console.warn('Neutron data load warning:',err); }
  await instrumentLoad;
  // Migration: avoid listing DEMAND twice when the old HB-3A filename from
  // earlier releases coexists with the newly supplied 08_HB3A.json.
  if(instruments.has('08_HB3A.json') && instruments.has('08_HB3A_DEMAND.json')){
    instruments.delete('08_HB3A_DEMAND.json');
  }
  await optionalLoads;
  // The unified instrument/ directory is the preferred source. On localhost,
  // do not probe a possibly absent legacy instruments/ directory at startup;
  // that failed compatibility probe only creates noisy 404s. Static/GitHub
  // deployments retain the legacy fallback during migration.
  const needsLegacy=[...instruments.values()].some(inst=>!(Array.isArray(inst.S2_limits)||inst.S2_max!==undefined||(inst.qe_range&&(Array.isArray(inst.qe_range.S2_limits)||Array.isArray(inst.qe_range.configuration)))));
  if(needsLegacy && !isLocalDirectoryListingHost() && !isGitHubPages()){
    // `instruments/` is only a legacy compatibility source.  On GitHub Pages
    // the unified `instrument/` directory is authoritative; probing a removed
    // legacy directory causes a visible 404 and can also hit a stale repo URL.
    await tryLoadDir('instruments',legacyRangeInstruments);
  }
  mergeLegacyRangeData();
  // Custom and the instruments loaded from JSON files in this browser.
  addLocalInstruments?.();
  refreshSelect(instruments,$('instrument'),null);setBackgroundCount(Number($('backgroundCount')?.value)||0);for(const slot of darkAssetSlots()) refreshDarkEnvironmentSelect(slot);
  if(!instruments.size) throw new Error('instrument directory has no JSON files.');
  $('instrument').selectedIndex=0;for(const i of backgroundRowIndices()) $(`backgroundSelect${i}`).value='';for(const slot of darkAssetSlots()) $(darkAssetIds(slot).se).value='';applyInstrumentDefaults();for(const slot of darkAssetSlots()) applySampleEnvironmentDefaults(slot);updateBackgroundSelectAvailability();
  // JSON configuration is now fully loaded.  Only at this point is it safe to
  // overlay browser-local user parameters (including the selected instrument).
  const restoredLocalState=restoreLeftPanelState();
  // Restored energyMode/energy (meV) are authoritative. The new visible unit
  // selection is remembered, while legacy saves default to the matching E unit.
  getFixedBeamControls()?.syncFromCanonical({preferredQuantity:$('fixedBeamQuantity')?.value});
  applyInstrumentCrystalAvailability({preserveCurrent:true});
  syncSidebarCrystalSelectors();
  if(currentGeometryCardTab()==='time') validateAllTimeScanRows({showMessage:true});
  // Restoring sidebar values can change Dark-angle Reference after the sample-
  // environment defaults were applied.  Re-sync the h/k/l row explicitly.
  for(const slot of darkAssetSlots()) updateDarkReferenceUI(slot);
  // Geometry starts at the current Reference Q HKL while preserving the current energy transfer.
  setGeometryTargetHKL([num("refh"),num("refk"),num("refl")]);
  setPropagationVectorCount(propagationVectorIndices().length); setDarkAssetCount(darkAssetSlots().length); updatePropagationVectorLabels(); prepareToolboxUI(); updateCifUI();
  try{ await initializeCifGenerator(); }
  catch(err){ console.warn('CIF Generator initialization warning:',err); }
  // Right-side controls are restored only after dynamic Toolbox controls exist and
  // after the default geometry target has been initialized, so saved values win.
  const restoredRightState=restoreRightPanelState();
  applyInstrumentCrystalAvailability({preserveCurrent:true});
  syncSidebarCrystalSelectors();
  syncSfColorMaxControl("restore");
  enableRightPanelPersistence();
  bindToolboxUI();
  $('powderGeomS2')?.addEventListener('input',()=>{ setPowderLinkDriver('s2'); syncPowderLinkedInputs('s2'); });
  $('powderGeomQ')?.addEventListener('input',()=>{ setPowderLinkDriver('q'); syncPowderLinkedInputs('q'); });
  $('powderGeomHW')?.addEventListener('input',()=>syncPowderLinkedInputs());
  for(const id of ['energy','energyMode','sense','s1sign']) $(id)?.addEventListener('change',()=>{
    if(checkedValue('sampleMode')==='powder') syncPowderLinkedInputs();
  });
  $('hwEntry').addEventListener('change',()=>{if(getSingleCache()){const i=nearestHWIndex(getSingleCache(),Number($('hwEntry').value));setTargetHWFromMap(i);renderSingle(getSingleCache(),i);saveRightPanelState();}});
  // Four-circle: W layer of the Constant E map (recalculates the map).
  // The Angle calculation target follows the map's W layer (and vice versa).
  const applyMapW=w=>{ getGeometrySliders()?.setTargetW(w); recalculate(); };
  $('qeWSlider')?.addEventListener('input',()=>{const w=Number($('qeWSlider').value);$('qeWEntry').value=String(Number(w.toFixed(4)));applyMapW(w);});
  $('qeWEntry')?.addEventListener('change',()=>applyMapW(Number($('qeWEntry').value)));
  // Constant E map: Save figure (plot with its colour bars, and the legend).
  // The UI density changed: the Powder map is drawn again from its last
  // calculation (keeps its legend choices; ui-shell redraws the others).
  window.addEventListener('tas-density-change',()=>{ if($('sampleMode')?.value==='powder') redrawPowder?.(); });
  // Save figure (top left) of the other figures.
  initializePlotSaveButtons(msg=>showError?.(msg));
  // Powder: the same button saves the powder Q–E map and its legend.
  $('qeSaveFigure')?.addEventListener('click',()=>saveQEFigure($('sampleMode')?.value==='powder'
      ? {plotId:'powderPlot',legendId:'qePowderLegend',filename:'powder-qe-map.png'}
      : {plotId:'singlePlot',legendId:'qePlotLegend',filename:'constant-e-map.png'})
    .catch(err=>showError?.(`Save figure: ${err?.message||err}`)));
  // Q vector–E map: the same (plot and its legend).
  $('qeVectorSaveFigure')?.addEventListener('click',()=>saveQEFigure({plotId:'qeVectorPlot',legendId:'qeVectorLegend',filename:'q-vector-e-map.png'})
    .catch(err=>showError?.(`Save figure: ${err?.message||err}`)));
  // F_N / F_M scale entries: redraw the open map from its last calculation.
  const refreshPeakScale=()=>{
    if($('sampleMode')?.value==='powder'){ if(!redrawPowder?.()) recalculate(); return; }
    if(getSingleCache()) renderSingle(getSingleCache(),Number($('hwSlider').value));
  };
  // Escape restores the value of the colorbar now drawn (either map).
  const drawnColorbar=meta=>{
    const powder=$('sampleMode')?.value==='powder';
    const data=$(powder?'powderPlot':'singlePlot')?.data||[];
    return powder ? data.find(t=>t.marker?.showscale && t.legendgroup===(meta==='nuclear-data'?'powder-nuclear':'powder-magnetic'))
      : data.find(t=>t.meta===meta);
  };
  for(const [id,source] of [['sfColorMaxEntry','max'],['sfColorMinEntry','min']]){
    const field=$(id);
    field?.addEventListener('focus',()=>field.select());
    field?.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        field.blur(); // the change event applies the scale
      } else if(event.key==='Escape'){
        event.preventDefault();
        const tr=drawnColorbar('nuclear-data');
        field.value=String(source==='max'?(tr?.marker?.cmax ?? 1):(tr?.marker?.cmin ?? 0));
        field.blur();
      }
    });
    field?.addEventListener('change',()=>{
      syncSfColorMaxControl(source);
      refreshPeakScale();
      saveRightPanelState();
    });
  }
  // Magnetic colorbar endpoints (single-k magnetic structure): 0...1, max > min.
  const syncMagneticColorbar=source=>{
    const minEntry=$('mfColorMinEntry'),maxEntry=$('mfColorMaxEntry');
    if(!minEntry||!maxEntry) return;
    const read=(el,fallback)=>{ const v=el.value.trim()===''?fallback:Number(el.value); return Number.isFinite(v)?Math.max(0,Math.min(1,v)):fallback; };
    let min=read(minEntry,0),max=read(maxEntry,1);
    if(max-min<1e-4){ if(source==='max') min=Math.max(0,max-1e-4); else max=Math.min(1,min+1e-4); }
    if(max-min<1e-4){ if(source==='max') max=Math.min(1,min+1e-4); else min=Math.max(0,max-1e-4); }
    minEntry.value=String(Number(min.toFixed(4))); maxEntry.value=String(Number(max.toFixed(4)));
  };
  for(const [id,source] of [['mfColorMaxEntry','max'],['mfColorMinEntry','min']]){
    const field=$(id);
    field?.addEventListener('focus',()=>field.select());
    field?.addEventListener('keydown',event=>{
      if(event.key==='Enter'){ event.preventDefault(); field.blur(); }
      else if(event.key==='Escape'){
        event.preventDefault();
        const tr=drawnColorbar('magnetic-data');
        field.value=String(source==='max'?(tr?.marker?.cmax ?? 1):(tr?.marker?.cmin ?? 0));
        field.blur();
      }
    });
    field?.addEventListener('change',()=>{
      syncMagneticColorbar(source);
      refreshPeakScale();
      saveRightPanelState();
    });
  }
  // Lorentz factor of the Q-E peak shading (1/sin 2θ or none).
  const qeLorentz=$('qeLorentz');
  if(qeLorentz){
    // In Powder the selector shows the fixed powder factor: keep the saved
    // single-crystal choice for the return to Single crystal.
    try{ const saved=localStorage.getItem('tas-qe-lorentz');
      if(saved==='on'||saved==='off'){ if(qeLorentz.disabled) qeLorentz.dataset.singleValue=saved; else qeLorentz.value=saved; } }catch(_e){}
    qeLorentz.addEventListener('change',()=>{
      try{ localStorage.setItem('tas-qe-lorentz',qeLorentz.value); }catch(_e){}
      if(getSingleCache()) renderSingle(getSingleCache(),Number($('hwSlider').value));
    });
  }
  $('cifSelectButton').addEventListener('click',()=>$('cifFileInput').click());
  $('cifClearButton')?.addEventListener('click',clearSelectedCif);
  $('cifFileInput').addEventListener('change',async()=>{
    const file=$('cifFileInput').files?.[0];
    if(!file) return;
    try{ await selectCifFile(file); }catch(err){ showError(err); }
    finally{ $('cifFileInput').value=''; }
  });
  syncPowderLinkedInputs();
  initializeResponsivePlotResize();
  initializeJumpBars();
  setActiveTab(savedActiveTab());
  $('gm1').addEventListener('change',updateSupermirrorUI);$('calcMode').addEventListener('change',updateCalcMode);bindResolutionManualCalculation();$('calcScanResolution')?.addEventListener('click',doScanResolution);$('scanSlider').addEventListener('input',()=>renderResolutionScan(num('scanSlider')));$('prev').addEventListener('click',()=>renderResolutionScan(num('scanSlider')-1));$('next').addEventListener('click',()=>renderResolutionScan(num('scanSlider')+1));
  for(const id of ['h','k','l','h0','k0','l0','h1','k1','l1','npts','Uh','Uk','Ul','Vh','Vk','Vl','a','b','c','alpha','beta','gamma']){
    $(id)?.addEventListener('input',updateResolutionPlaneWarning);
    $(id)?.addEventListener('change',updateResolutionPlaneWarning);
  }
  updateResolutionPlaneWarning();
  for(const id of ['a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl']) $(id).addEventListener('input',updateAutoW);
  // Keep the Bragg-reference plane warning live as lattice/plane/HKL inputs change.
  for(const id of ['a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl','refh','refk','refl','refs1','refh2','refk2','refl2','refs12']){
    $(id)?.addEventListener('input',updateBraggOrientationPlaneWarning);
    $(id)?.addEventListener('change',updateBraggOrientationPlaneWarning);
  }
  $('braggReset')?.addEventListener('click',resetBraggPeaks);
  $('flipUV')?.addEventListener('click',flipScatteringPlaneUV);
  updateOrientationReferenceUI(); updateGeometryQuickTargetButtons();
  $('orientationReference')?.addEventListener('change',()=>{
    updateOrientationReferenceUI();
    updateGeometryQuickTargetButtons();

    // Changing the sample orientation reference defines an elastic
    // configuration.  Reset only the TAS-geometry energy transfer here; the
    // visible quick-target button functions themselves keep their existing
    // behavior.
    if($('geomHW')) $('geomHW').value='0';

    syncGeometryTargetToOrientationReference();
  });
  // Restore any ordinary controls/tabs that are not owned by a specialized
  // serializer, then start the catch-all listener only after initialization so
  // defaults cannot overwrite the user's previous browser-local state.
  const restoredGlobalState=restoreGlobalUIState();
  // Right/global persistence restores input.value without dispatching events.
  // After BOTH restores, seed empty HKL (including a saved empty path) from
  // the current sample U/V. Leave all nonempty saved paths untouched.
  const restoredHKLIsEmpty=!(qePathInput()?.value||'').trim();
  if(restoredHKLIsEmpty && qePathInput()) qePathInput().value=qeDefaultPathText();
  // The generated startup path is an example, not a user-picked path: the
  // first Select Path action should replace it rather than append to it.
  qeCommitPathText({markEdited:!restoredHKLIsEmpty});
  // Every saved setting is now back in place. Outputs computed earlier during
  // start-up (the Generator reflection tables) used the HTML defaults, so
  // compute them again with the restored conditions. The Q-E calculation
  // below (recalculate) already runs after this point.
  refreshCifAfterStateRestore();
  enableGlobalUIPersistence();
  saveLeftPanelState();
  saveRightPanelState();
  saveGlobalUIState();
  setStatus(`Configuration loaded${(restoredLocalState||restoredRightState||restoredGlobalState) ? ' · Saved settings restored' : ''}${nNeutron ? '' : ' · Neutron data unavailable'}${manifestWarnings.length ? ` · ${manifestWarnings.join('; ')} (run tools/update_data_index.py)` : ''}`);recalculate();
}

  return {
    initialize
  };
}
