// Recalculation scheduling (debounced) and the main recalculate() entry point.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
export function createRecalc(deps){
  const {
    $, calculatePowder, calculateSingleCrystal, checkedValue, clearError, clearResolutionResults,
    doSingleResolution, instrumentIsDiffractometer, renderGeometry, renderSingle, showError, updateAutoW,
    updateEnergyLabel, updateModeVisibility, updateResolutionPlaneWarning, updateS2MaxDisplay,
    getPowderCache, getSingleCache, setPowderCache, setSingleCache
  }=deps;

let timer=null;
function resolutionPanelIsVisible(){
  const panel=$("resolutionPanel");
  return !!panel && !panel.classList.contains("hidden");
}
function markResolutionSingleDirty(){
  if(!resolutionPanelIsVisible() || $("calcMode")?.value!=="single") return;
  $("result")?.classList.add("hidden");
  const btn=$("calcSingleResolution");
  if(btn) btn.classList.add("needs-calc");
}
function markResolutionScanDirty(){
  if(!resolutionPanelIsVisible() || $("calcMode")?.value!=="scan") return;
  $("result")?.classList.add("hidden");
  const btn=$("calcScanResolution");
  if(btn) btn.classList.add("needs-calc");
}
function markCurrentResolutionDirty(){
  if($("calcMode")?.value==="scan") markResolutionScanDirty();
  else markResolutionSingleDirty();
}
function runScheduledRecalc(){
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
    if(instrumentIsDiffractometer()){
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
    else if(el?.tagName==="INPUT" && !["range","checkbox","radio","button"].includes(String(el.type||"").toLowerCase())) delay=180;
    else delay=60;
  }
  clearTimeout(timer);
  timer=setTimeout(runScheduledRecalc,delay);
}
function recalculate(){
  clearError();
  updateEnergyLabel();
  updateS2MaxDisplay();
  updateModeVisibility();
  try{
    if(checkedValue("sampleMode")==="single"){
      setSingleCache(calculateSingleCrystal());
      $("hwSlider").min=0;
      $("hwSlider").max=Math.max(0,getSingleCache().regions.length-1);
      $("hwSlider").step=1;
      const idx=Math.min(Number($("hwSlider").value)||0,getSingleCache().regions.length-1);
      $("hwSlider").value=idx;
      renderSingle(getSingleCache(),idx);
    } else {
      setPowderCache(calculatePowder());
      renderGeometry(getPowderCache(),0);
    }
  }catch(err){
    showError(err);
  }
}

  return {
    markResolutionScanDirty, recalculate, resolutionPanelIsVisible, scheduleRecalc
  };
}
