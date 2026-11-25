// Recalculation scheduling (debounced) and the main recalculate() entry point.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
export function createRecalc(deps){
  const {
    $, calculatePowder, calculateSingleCrystal, checkedValue, clearError, clearResolutionResults,
    doSingleResolution, renderGeometry, renderSingle, showError, updateAutoW,
    updateEnergyLabel, updateModeVisibility, updateResolutionPlaneWarning, updateS2MaxDisplay,
    getPowderCache, getSingleCache, setPowderCache, setSingleCache, targetHWMapIndex, syncQEPathSnapDefault,
    updateBraggPeakCheck
  }=deps;

let timer=null;
// Every instrument type has a resolution (diffractometer and 4-circle:
// elastic, without an analyzer).
const resolutionUnavailable=()=>false;
function resolutionPanelIsVisible(){
  const panel=$("resolutionPanel");
  return !!panel && !panel.classList.contains("hidden");
}
// Scan inputs changed: the last scan stays shown (or, before the first one,
// the empty table and plots), and Calculate is marked.
function markResolutionScanDirty(){
  if(!resolutionPanelIsVisible() || $("calcMode")?.value!=="scan") return;
  if(!resolutionUnavailable()) $("result")?.classList.remove("hidden");
  const btn=$("calcScanResolution");
  if(btn) btn.classList.add("needs-calc");
}
function runScheduledRecalc(){
  try{ runScheduledRecalcNow(); }
  // Energy, instrument and convention changes also move the peak-2 S1:
  // checked after the recalculation, with its energies.
  finally{ try{ updateBraggPeakCheck?.(); }catch(_e){} }
}
function runScheduledRecalcNow(){
  timer=null;
  // Resolution Single is inexpensive enough to update automatically, but only
  // while its panel is actually visible.  Resolution Scan stays explicit via
  // Calculate so common edits never trigger the heavy multi-point calculation.
  if(resolutionPanelIsVisible()){
    clearError();
    updateEnergyLabel();
    updateS2MaxDisplay();
    updateModeVisibility();
    updateAutoW();
    updateResolutionPlaneWarning();
    if(resolutionUnavailable()){
      clearResolutionResults?.();
      return;
    }
    if($("calcMode")?.value==="single") doSingleResolution();
    else markResolutionScanDirty();
    return;
  }
  recalculate();
}
function scheduleRecalc(delayOrEvent=50){
  let delay=50;
  if(typeof delayOrEvent==="number"){
    delay=Math.max(0,delayOrEvent);
  }else if(delayOrEvent?.type){
    const el=delayOrEvent.target;
    if(delayOrEvent.type==="change") delay=0;
    // Typed values: wait until typing pauses (a partial number, e.g. "1" of
    // "120", is not calculated).
    else if(el?.tagName==="INPUT" && !["range","checkbox","radio","button"].includes(String(el.type||"").toLowerCase())) delay=500;
    else delay=60;
  }
  clearTimeout(timer);
  timer=setTimeout(runScheduledRecalc,delay);
}
function recalculate(){
  // A recalculation queued before this one (for example by the input events
  // of the saved-settings restore at start-up) would only repeat it: drop it.
  // While the Resolution tab is shown the queued job is the resolution
  // update, so it is kept.
  if(timer && !resolutionPanelIsVisible()){ clearTimeout(timer); timer=null; }
  clearError();
  updateEnergyLabel();
  updateS2MaxDisplay();
  updateModeVisibility();
  try{
    if(checkedValue("sampleMode")==="single"){
      setSingleCache(calculateSingleCrystal());
      // The Snap default follows the lattice (hexagonal / trigonal: 1/6).
      syncQEPathSnapDefault?.();
      $("hwSlider").min=0;
      $("hwSlider").max=Math.max(0,getSingleCache().regions.length-1);
      $("hwSlider").step=1;
      // The map slice follows the Angle calculation hbar-omega.
      const targetIndex=targetHWMapIndex?.(getSingleCache());
      const idx=Math.min(targetIndex ?? (Number($("hwSlider").value)||0),getSingleCache().regions.length-1);
      $("hwSlider").value=idx;
      renderSingle(getSingleCache(),idx);
    } else {
      setPowderCache(calculatePowder());
      renderGeometry(getPowderCache(),0);
    }
  }catch(err){
    showError(err);
    // No stale angles or drawing from the previous settings.
    const angles=$("geometryAngles");
    if(angles) angles.textContent="Enter a target Q and ħω to calculate TAS angles.";
    try{ if(window.Plotly && $("geometryPlot")) window.Plotly.purge($("geometryPlot")); }catch(_e){}
  }
}

  return {
    markResolutionScanDirty, recalculate, resolutionPanelIsVisible, scheduleRecalc
  };
}
