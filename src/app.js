import {
  PI, deg2rad, rad2deg, clamp,
  add, sub, scale, dot, norm, cross, normalize,
  RL_calc, UB_calc, makeSpiceScatteringPlaneBasis,
  linspace, arange
} from "./core/tas-core.js";
import {RL_calc as RLRes, inferOutOfPlaneHKL, calcResolution} from "./resolution/resolution-core.js";
import {
  parseCifStructure, nuclearStructureFactorSquared, setNeutronData
} from "./cif/cif-structure.js";
import {
  tasConvention,
  wrap180, angleDiffDeg,
  tasPhiLabDegForConvention,
  tasCrystalPhiDegForConvention, tasPlotPhiFromCrystalPhiForConvention,
  calcQ0, fourCircleSignFactors
} from "./core/tas-conventions.js";
import {
  fetchJsonOnce
} from "./app/data-loader.js";
import {
  reciprocalSymmetryMatrices, hklKey, compareHkl,
  canonicalReflectionHkl, reflectionStar
} from "./cif/cif-symmetry.js";
import {createToolboxUI} from "./toolbox/toolbox-ui.js";
import {createScriptUI} from "./script/script-ui.js";
import {createCifUI} from "./cif/cif-ui.js";
import {createTasGeometryView} from "./geometry/tas-geometry-view.js";
import {createResolutionUI} from "./resolution/resolution-ui.js";
import {createUIShell} from "./app/ui-shell.js";
import {createDarkAngle} from "./qe/dark-angle.js";
import {createQESingleCrystal} from "./qe/qe-single-crystal.js";
import {createTasAngleCalculation} from "./core/tas-angle-calculation.js";
import {createBackgroundRows} from './app/background-rows.js';
import {createInstrumentSetup} from './app/instrument-setup.js';
import {createSidebarRows} from './app/sidebar-rows.js';
import {createQEPath} from './qe/qe-path.js';
import {createQESingleMap} from './qe/qe-single-map.js';
import {createPowder} from './qe/powder.js';
import {createQESingleRender} from './qe/qe-single-render.js';
import {createQEVectorMap} from './qe/qe-vector-map.js';
import {createRecalc} from './app/recalc.js';
import {createGeometryTargets} from './geometry/geometry-targets.js';
import {createGeometrySliders} from './geometry/geometry-sliders.js';
import {installGeometryNumericInputs} from './app/numeric-inputs.js';
import {$, checkedValue, clearError, latticeParams, num, parseNumericValue, selectedS1Sign, selectedTasSense, setRadio, setStatus, showError, tasConventionFromLegacyUiSense, userFacingTasMessage} from './app/dom-utils.js';
import {formatHKL, hklToQ, isAllowedByCentering, maxArray} from './core/hkl-utils.js';
import {createAppBootstrap} from './app/bootstrap.js';

const instruments = new Map();
const backgroundMaterials = new Map();
const sampleEnvironments = new Map();
let fixedBeamControls = null;

// Feature modules are wired near the end of this file after their dependencies are defined.
let updateCifUI, syncSfColorMaxControl, selectCifFile, clearSelectedCif, centeringFromSpaceGroup, selectedSampleSpaceGroup, selectedSampleCentering, setCifOutputTab, initializeCifGenerator, nuclearStructureForSelectedCif, refreshCifAfterStateRestore, buildResolutionLattice, updateAutoW, flipScatteringPlaneUV, collectResolutionBase, tasMotorAngles, formatAngle, updateResolutionPlaneWarning, doSingleResolution, doScanResolution, renderResolutionScan, bindResolutionManualCalculation, updatePropagationVectorLabels, powderWavevectors, setPowderLinkDriver, syncPowderLinkedInputs, powderGeometryTarget, geometryCalculationMode, geometryPointWarnings, currentGeometryScanOutputTab, setGeometryScanOutputTab, setGeometryCalculationMode, updateGeometryCalculationModeVisibility, renderGeometry, safeResizePlot, resizeVisiblePlots, scheduleVisiblePlotResize, initializeResponsivePlotResize, setActiveTab, updateCalcMode, saveRightPanelState, restoreRightPanelState, savedActiveTab, restoreGeometrySubTabsFromStorage, enableRightPanelPersistence, saveGlobalUIState, restoreGlobalUIState, enableGlobalUIPersistence, saveLeftPanelState, restoreLeftPanelState, hasScanResults, clearResolutionResults;
let getDarkAssets, directBeamOrientationCorrection, rebuildGeometryMatchedDarkPolygons, qeDarkBlockWarningsForHKLE;
let canonicalOrientationMode, effectiveOrientationReference;
let calculateSingleCrystal;

async function initializeNeutronData(){
  const payload=await fetchJsonOnce("neutron-data.json"); // may already be in flight (prefetch.js)
  setNeutronData(payload);
  return Object.keys(payload?.elements||{}).length;
}

// Feature modules extracted from app.js. They only define functions here;
// dependencies assigned later in this file are passed as late-bound wrappers.
const {
  BACKGROUND_SLOTS, backgroundColor, backgroundRowIndices, backgroundRowValues,
  handleBackgroundSelection, removeBackground, replaceBackgroundRows, selectedBackgrounds,
  setBackgroundCount, updateBackgroundSelectAvailability
}=createBackgroundRows({
  $, backgroundMaterials, refreshBackgroundSelect,
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  scheduleRecalc:(...args)=>scheduleRecalc(...args)
});

const {
  syncS2FieldSigns,
  applyInstrumentCrystalAvailability, applyInstrumentDefaults, applyInstrumentTypeChange, applyInstrumentTypeDefaults, currentInstrument, effectiveS2MaxAtEi,
  fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer, rangeTable, energyTransferRange, energyTransferGrid,
  syncS2DeltaFromEffective, syncSidebarCrystalSelectors, updateS2MaxDisplay,
  updateS2MaxDisplayForQERange, updateSupermirrorUI, validateEffectiveS2Max
}=createInstrumentSetup({
  $, checkedValue, clearResolutionResults:(...args)=>clearResolutionResults(...args), instruments, num,
  setStatus, tasConventionFromLegacyUiSense, updateAutoW:(...args)=>updateAutoW(...args),
  updateEnergyLabel, getFixedBeamControls:()=>fixedBeamControls, getSingleCache:()=>singleCache
});

const {
  applySampleEnvironmentDefaults, bindDynamicSidebarUI, currentDarkRangeCount, darkAssetIds,
  darkAssetSlots, darkAssetValues, enabledPropagationVectors, propagationVectorIndices,
  propagationVectorValues, refreshDarkEnvironmentSelect, replaceDarkAssets, replacePropagationVectors,
  setDarkAssetCount, setDarkRangeCount, setPropagationVectorCount, updateDarkReferenceUI
}=createSidebarRows({
  $, applyDarkAngleSlotColors, backgroundRowValues, checkedValue, handleBackgroundSelection, num,
  parseNumericValue, refreshSelect, removeBackground, replaceBackgroundRows, sampleEnvironments,
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  scheduleRecalc:(...args)=>scheduleRecalc(...args), setRadio, updateGeometryQuickTargetButtons,
  updatePropagationVectorLabels:(...args)=>updatePropagationVectorLabels(...args)
});

const {
  currentQEMapUnit, qeCommitPathText, qeDefaultPathText, qeFormatPathNumber, qePathAxisCoordinateLabel,
  qePathInput, qePathMapLabel, qePathPointXY, qePhysicalRluCoordinates, qePlaneRluBasis,
  qeSelectedPathHKL, qeSpurionWarnings, qeXYForUnit, updateQESpurionWarning, bindQEPathControls,
  syncQEPathSnapDefault
}=createQEPath({
  $, checkedValue, hklToQ, num, parseNumericValue,
  renderQEVectorMap:(...args)=>renderQEVectorMap(...args),
  renderSingle:(...args)=>renderSingle(...args), getSingleCache:()=>singleCache,
  renderGeometry:(...args)=>renderGeometry(...args), rangeTable:(...args)=>rangeTable(...args)
});

const {
  bindSingleZoomPeakScaling, currentPlotRanges, positionSingleColorbarEntries, singleColorbarTicks,
  singleMarkerSizes, singleNuclearLabelStyle
}=createQESingleMap({
  $, currentQEMapUnit, qeXYForUnit
});

const {
  backgroundPowderPeaks, calculatePowder, powderS2ForQAtHW, representativePowderHklText
}=createPowder({
  backgroundColor, backgroundMaterials, checkedValue, currentInstrument, currentPlotRanges,
  effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL, hklToQ, isAllowedByCentering,
  latticeParams, num, powderWavevectors:(...args)=>powderWavevectors(...args), rangeTable, energyTransferRange, energyTransferGrid,
  renderQEExternalLegend:(...args)=>renderQEExternalLegend(...args), selectedBackgrounds,
  selectedSampleCentering:(...args)=>selectedSampleCentering(...args), validateEffectiveS2Max,
  getNuclearCifStructure:()=>nuclearStructureForSelectedCif?.() ?? null
});

const {
  ensureNuclearLabelControl, ensureQESliderControls, nearestHWIndex, renderQEExternalLegend,
  renderSingle, updateGeometryTargetMarker
}=createQESingleRender({
  $, backgroundColor, bindSingleRluGrid:(...args)=>bindSingleRluGrid(...args),
  bindSingleZoomPeakScaling, collectResolutionBase:(...args)=>collectResolutionBase(...args),
  currentPlotRanges, currentQEMapUnit, num, positionSingleColorbarEntries,
  qeObliqueRluGrid:(...args)=>qeObliqueRluGrid(...args), qePathMapLabel, qePathPointXY,
  qePhysicalRluCoordinates, qeSelectedPathHKL, qeXYForUnit,
  renderGeometry:(...args)=>renderGeometry(...args),
  renderQEVectorMap:(...args)=>renderQEVectorMap(...args), selectedBackgrounds, selectedS1Sign,
  selectedTasSense, singleColorbarTicks, singleMarkerSizes, singleNuclearLabelStyle,
  tasMotorAngles:(...args)=>tasMotorAngles(...args), updateQESpurionWarning,
  updateS2MaxDisplayForQERange, hklToQ
});

const {
  bindSingleRluGrid, qeObliqueRluGrid, qePointInPolygon, renderQEVectorMap, setQEMapTab
}=createQEVectorMap({
  $, backgroundColor, backgroundMaterials, backgroundPowderPeaks, checkedValue, currentQEMapUnit,
  powderS2ForQAtHW, qeFormatPathNumber, qePathAxisCoordinateLabel, qePathPointXY,
  qePhysicalRluCoordinates, qePlaneRluBasis, qeSelectedPathHKL, renderQEExternalLegend, renderSingle,
  representativePowderHklText, safeResizePlot:(...args)=>safeResizePlot(...args),
  scatteringPlaneWarningMessage:(...args)=>scatteringPlaneWarningMessage(...args), selectedBackgrounds,
  setScatteringPlaneWarning:(...args)=>setScatteringPlaneWarning(...args),
  getSingleCache:()=>singleCache, getPowderCache:()=>powderCache,
  hklToQ:(...args)=>hklToQ(...args)
});

const {
  markResolutionScanDirty, recalculate, resolutionPanelIsVisible, scheduleRecalc
}=createRecalc({
  $, calculatePowder, calculateSingleCrystal:(...args)=>calculateSingleCrystal(...args), checkedValue,
  clearError, clearResolutionResults:(...args)=>clearResolutionResults(...args),
  doSingleResolution:(...args)=>doSingleResolution(...args), instrumentIsDiffractometer,
  renderGeometry:(...args)=>renderGeometry(...args), renderSingle, showError,
  updateAutoW:(...args)=>updateAutoW(...args), updateEnergyLabel, updateModeVisibility,
  updateResolutionPlaneWarning:(...args)=>updateResolutionPlaneWarning(...args), updateS2MaxDisplay,
  getSingleCache:()=>singleCache, setSingleCache:(value)=>{ singleCache=value; },
  getPowderCache:()=>powderCache, setPowderCache:(value)=>{ powderCache=value; },
  targetHWMapIndex:(...args)=>targetHWMapIndex(...args),
  syncQEPathSnapDefault:(...args)=>syncQEPathSnapDefault(...args)
});

const {
  setGeometryKiParallelU, setGeometryKiParallelV, setGeometryKiPerpU, setGeometryKiPerpV,
  setGeometryTargetFromBragg, setGeometryTargetFromDarkRef, setGeometryTargetFromU,
  setGeometryTargetFromV, setGeometryTargetHKL, syncGeometryTargetToOrientationReference
}=createGeometryTargets({
  $, canonicalOrientationMode:(...args)=>canonicalOrientationMode(...args),
  collectResolutionBase:(...args)=>collectResolutionBase(...args), darkAssetIds,
  effectiveOrientationReference:(...args)=>effectiveOrientationReference(...args), hklToQ, num,
  scheduleRecalc, selectedS1Sign, selectedTasSense, tasMotorAngles:(...args)=>tasMotorAngles(...args)
});
const legacyRangeInstruments = new Map();

let singleCache = null;
let geometrySliders = null;
let powderCache = null;
let selectedCifStructure = null;
let selectedCifFileName = "";
let selectedCifText = "";





function setupTasConventionUI(){
  const senseSelect=$("sense"), senseRow=$("senseRow"), geometryRow=$("geometryRow");
  if(!senseSelect || !senseRow || !geometryRow) return;

  // Preserve the HTML default while migrating the old four-choice selector.
  const initial=tasConventionFromLegacyUiSense(senseSelect.value);
  senseSelect.replaceChildren();
  for(const value of ["+-+","-+-"]){
    const option=document.createElement("option");
    option.value=value; option.textContent=value; senseSelect.appendChild(option);
  }
  senseSelect.value=initial.sense;
  for(const node of senseRow.childNodes){
    if(node.nodeType===Node.TEXT_NODE && node.nodeValue.trim()){ node.nodeValue="Sense"; break; }
  }

  // S1 / phi / chi signs live in the Motor table (index.html).
  const s1Select=$("s1sign");
  if(s1Select) s1Select.value=initial.s1sign;
}
// Geometry applies to TAS only (analyzer side); Sense (scattering side at
// the sample) to every type.  The phi / chi rows of the Motor table are for
// 4-circle only.  Hidden values are kept.
function updateS2SignDisplay(){
  const out=$("s2SignDisplay"); if(!out) return;
  // S2 turns in the same sense as S1 (the scattering side is set by Sense).
  out.textContent=selectedS1Sign()==="cw" ? "CW" : "CCW";
}
function updateInstrumentTypeRows(){
  let type='tas';
  try{ type=currentInstrument()?.instrument_type||'tas'; }catch(_e){}
  const tas=type==='tas', fourCircle=type==='four-circle';
  $("geometryRow")?.classList.toggle("hidden",!tas);
  $("tasConventionRow")?.classList.remove("hidden");
  for(const el of document.querySelectorAll("#motorLimitTable .four-circle-limit")) el.classList.toggle("hidden",!fourCircle);
  updateS2SignDisplay();
  // Dark angles are not available for 4-circle yet: keep the section visible
  // (greyed out, not editable) with its values unchanged for a later update.
  const dark=$("darkSection");
  if(dark){
    dark.classList.toggle("dark-unavailable",fourCircle);
    let content=dark.querySelector(".dark-section-content");
    if(!content){
      content=document.createElement("div");
      content.className="dark-section-content";
      const heading=dark.querySelector("h2");
      for(const node of [...dark.childNodes]) if(node!==heading) content.appendChild(node);
      dark.appendChild(content);
    }
    content.inert=fourCircle;
    let note=$("darkUnavailableNote");
    if(!note){
      note=document.createElement("p");
      note.id="darkUnavailableNote"; note.className="dark-unavailable-note";
      note.textContent="Not yet available for 4-circle.";
      dark.querySelector("h2")?.after(note);
    }
    note.classList.toggle("hidden",!fourCircle);
  }
  updateGeometryQuickTargetButtons?.();
}
setupTasConventionUI();



let prepareToolboxUI, bindToolboxUI, updateAbsorptionCalculator;


// Resolve orientation labels to a canonical physical orientation before any
// TAS / Q-E / Dark-angle calculation. Parallel and perpendicular are NOT
// separate numerical branches: when two labels describe the same directed
// ki axis in the entered scattering plane, they share exactly the same
// downstream calculation.
//
// The perpendicular direction is chosen from the other entered plane vector
// so the U/V handedness fixes the sign unambiguously:
//   ki ⟂ U : V-side component perpendicular to U
//   ki ⟂ V : U-side component perpendicular to V
//
// Therefore, for an orthogonal U/V plane:
//   ki ∥ V == ki ⟂ U
//   ki ∥ U == ki ⟂ V
function updateOrientationReferenceUI(){
  const mode=$('orientationReference')?.value || 'bragg';
  $('braggReferenceInputs')?.classList.toggle('hidden',mode!=='bragg');
  updateBraggOrientationPlaneWarning();
}

// UI-only validation for Sample orientation > Bragg peak position.
// Reuse the same reciprocal-space plane test already used by Time estimate;
// this does not alter TAS/Q-E/Resolution/Dark-angle calculations.
function updateBraggOrientationPlaneWarning(){
  const box=$('braggPlaneWarning');
  if(!box) return;
  const mode=$('orientationReference')?.value || 'bragg';
  if(mode!=='bragg'){
    box.classList.add('hidden');
    box.textContent='';
    return;
  }
  const hkl=[num('refh'),num('refk'),num('refl')];
  const result=hklInCurrentScatteringPlane(hkl);
  if(result.ok){
    box.classList.add('hidden');
    box.textContent='';
    return;
  }
  box.classList.remove('hidden');
  box.textContent=result.error
    ? `Warning: ${result.error}`
    : `Warning: Bragg peak (${hkl.map(v=>Number(v.toPrecision(6))).join(', ')}) is outside the current U-V scattering plane.`;
}

function applyDarkAngleSlotColors(){
  // Dark-angle cards/checkbox labels use one neutral black UI style.
  for(const slot of darkAssetSlots()){
    const label=$(darkAssetIds(slot).enable)?.closest("label");
    const caption=label?.querySelector("span");
    if(caption){ caption.style.color="#111"; caption.style.fontWeight="700"; }
  }
}

function updateGeometryQuickTargetButtons(){
  const mode=$('orientationReference')?.value || 'perpU';
  const bragg=mode==='bragg';
  $('geomPerpU')?.classList.toggle('hidden',mode!=='perpU');
  $('geomPerpV')?.classList.toggle('hidden',mode!=='perpV');
  $('geomParallelU')?.classList.toggle('hidden',mode!=='parallelU');
  $('geomParallelV')?.classList.toggle('hidden',mode!=='parallelV');
  $('geomSetBragg')?.classList.toggle('hidden',!bragg);
  if($('geomPerpU')) $('geomPerpU').textContent='Set ki ⟂ U';
  if($('geomPerpV')) $('geomPerpV').textContent='Set ki ⟂ V';
  if($('geomParallelU')) $('geomParallelU').textContent='Set ki ∥ U';
  if($('geomParallelV')) $('geomParallelV').textContent='Set ki ∥ V';

  const container=document.querySelector(".geometry-target-all-buttons");
  if(!container) return;
  const slots=darkAssetSlots();

  for(const button of [...container.querySelectorAll(".geom-dark-ref-button")]){
    const slot=Number(button.dataset.darkSlot);
    if(!slots.includes(slot)) button.remove();
  }

  let fourCircle=false;
  try{ fourCircle=currentInstrument()?.instrument_type==='four-circle'; }catch(_e){}
  const showDark=!!$('addDark')?.checked && !fourCircle;
  for(const slot of slots){
    let button=$(`geomSetRefQ${slot}`);
    if(!button){
      button=document.createElement("button");
      button.id=`geomSetRefQ${slot}`;
      button.type="button";
      button.className="geom-dark-ref-button hidden";
      button.dataset.darkSlot=String(slot);
      button.textContent=`Set Ref Q${slot}`;
      button.addEventListener("click",()=>setGeometryTargetFromDarkRef(slot));
    }
    // Keep → Resolution at the right end: Ref Q buttons follow the other
    // target buttons (after Set Bragg peak), in slot order.
    const resolutionButton=$('geomToResolution');
    if(resolutionButton?.parentElement===container) container.insertBefore(button,resolutionButton);
    else container.appendChild(button);
    const ids=darkAssetIds(slot);
    const visible=showDark && !!$(ids.enable)?.checked && checkedValue(ids.ref)==='Reference Q';
    button.classList.toggle('hidden',!visible);
  }
}


// Static JSON/CIF directory loading is implemented in data-loader.js.

function refreshBackgroundSelect(select,emptyLabel="None"){
  select.innerHTML="";
  const empty=document.createElement("option");
  empty.value="";
  empty.textContent=emptyLabel;
  select.appendChild(empty);
  [...backgroundMaterials.keys()]
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}))
    .forEach(key=>{
      const op=document.createElement("option");
      op.value=key;
      op.textContent=key;
      select.appendChild(op);
    });
}

function refreshSelect(map,select,emptyLabel){
  select.innerHTML="";
  if(emptyLabel!==null){
    const op=document.createElement("option");
    op.value=""; op.textContent=emptyLabel;
    select.appendChild(op);
  }
  [...map.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"}))
    .forEach(([key,obj])=>{
      const op=document.createElement("option");
      op.value=key;
      op.textContent=obj.name || key;
      select.appendChild(op);
    });
}

function updateEnergyLabel(){
  const mode=checkedValue("energyMode");
  $("energyLabel").childNodes[0].nodeValue = `${mode==="Ef fixed"?"Ef":"Ei"} (meV)`;
}
function updateModeVisibility(){
  const mode=checkedValue("sampleMode");
  const single=mode==="single";
  $("singleCrystalInputs").classList.toggle("hidden",!single);
  $("referenceSection").classList.toggle("hidden",!single);
  $("darkSection").classList.toggle("hidden",!single);

  // Instrument configuration is intentionally identical for Single crystal and
  // Powder. Only sample-specific controls and the left Q-E plot switch modes.
  updateInstrumentTypeRows();
  $("s1minWrap")?.classList.remove("hidden");
  $("s1maxWrap")?.classList.remove("hidden");
  // Powder has no sample-orientation degree of freedom. Keep the common
  // Instrument configuration layout, but make the S1 limits read-only in
  // practice by disabling their entry boxes only while Powder is selected.
  if($("S1min")) $("S1min").disabled=!single;
  if($("S1max")) $("S1max").disabled=!single;
  $("lambdaHalf")?.closest("label")?.classList.remove("hidden");
  if($("s2Label")?.childNodes?.length) $("s2Label").childNodes[0].nodeValue="S2 min (deg)";

  // Q-E Range uses one shared two-column workspace for Single crystal and Powder.
  // Only the left plot and the Angle-calculation target controls change with mode;
  // Time estimate and the TAS-geometry card remain in the same place and size.
  $("singlePlot")?.classList.toggle("hidden",!single);
  $("qeSpurionWarning")?.classList.toggle("hidden",!single);
  $("powderPlot")?.classList.toggle("hidden",single);
  $("qeMapTabVector")?.classList.toggle("hidden",!single);
  // Powder has a single map and no HKL path: hide the map tabs and the
  // HKL path box of the Constant E map.
  document.querySelector('#qePanel .qe-map-tabs')?.classList.toggle("hidden",!single);
  document.querySelector('#qeConstantMapPane .qe-constant-path-input')?.classList.toggle("hidden",!single);
  if(!single && !$('qeVectorMapPane')?.classList.contains('hidden')) setQEMapTab('constant');
  updateGeometryCalculationModeVisibility();
  $("qeRangeControlGrid")?.classList.toggle("hidden",!single);
  document.querySelector('.nuclear-label-control')?.classList.toggle('hidden',!single);
  $('qePlotLegend')?.classList.toggle('hidden',!single);
  // Powder has its own clickable legend below the Q–E plot.
  $('qePowderLegend')?.classList.toggle('hidden',single);
  if(!single) syncPowderLinkedInputs();
  updateCifUI();
  requestAnimationFrame(scheduleVisiblePlotResize);
}


function qeGeometryAngles(cache, senseOverride=null, uiSenseOverride=null, calcOverride=null){
  const calc=calcOverride || {h:num("geomH"),k:num("geomK"),l:num("geomL"),hw:num("geomHW")};
  // Reuse exactly the same motor-angle calculation as Resolution & Angle.
  // Only override the fixed energy when Q-E Range is in lambda/2 mode, because
  // calculateSingleCrystal() uses four times the entered energy in that mode.
  const b=collectResolutionBase();
  if(cache.energyMode==="Ei fixed"){
    b.config.energy_mode="Ei fixed";
    b.config.Ei=cache.Ei;
    b.config.Ef=null;
  }else{
    b.config.energy_mode="Ef fixed";
    b.config.Ef=cache.Ef;
    b.config.Ei=null;
  }
  let convention=tasConvention(selectedTasSense(),selectedS1Sign());
  if(uiSenseOverride && typeof uiSenseOverride==="object" && "sense" in uiSenseOverride){
    convention=tasConvention(uiSenseOverride.sense,uiSenseOverride.s1sign);
  }else if(uiSenseOverride){
    const legacy=tasConventionFromLegacyUiSense(uiSenseOverride);
    convention=tasConvention(legacy.sense,legacy.s1sign);
  }
  b.config.sense=convention.sense;
  b.config.s1sign=convention.s1sign;
  b.config.sign_config=convention.sense;
  void senseOverride; // legacy argument retained for call-site compatibility
  const angles=tasMotorAngles(calc,b);
  const Ei=cache.energyMode==="Ei fixed" ? cache.Ei : cache.Ef+calc.hw;
  const Ef=cache.energyMode==="Ei fixed" ? cache.Ei-calc.hw : cache.Ef;
  return {calc,angles,Ei,Ef,ki:Math.sqrt(Ei/2.072),kf:Math.sqrt(Ef/2.072)};
}



const GEOMETRY_CALC_MODE_STORAGE_KEY='tas-geometry-calc-mode-v1';
const GEOMETRY_SCAN_OUTPUT_STORAGE_KEY='tas-geometry-scan-output-tab-v1';

$("instrument").addEventListener("change",()=>{
  // Do not carry resolution plots or scan points across instruments.
  clearResolutionResults?.();
  applyInstrumentDefaults();
  updateInstrumentTypeRows();
  scheduleRecalc();
});
// TAS / 4-circle / Diffractometer: only the type-dependent settings change.
for(const id of ['phiSign','chiSign','phiMin','phiMax','chiMin','chiMax','S2maxEffective']) $(id)?.addEventListener('change',()=>scheduleRecalc());
$('s1sign')?.addEventListener('change',updateS2SignDisplay);
for(const id of ['sense','s1sign']) $(id)?.addEventListener('change',()=>syncS2FieldSigns());
$("instrumentType")?.addEventListener("change",()=>{
  clearResolutionResults?.();
  applyInstrumentTypeChange();
  updateInstrumentTypeRows();
  scheduleRecalc();
});

// Resolution: Instrument details column as wide as the sidebar cards.
function syncResolutionDetailsWidth(){
  const card=document.querySelector('.sidebar section');
  const w=card?.getBoundingClientRect().width;
  if(w>0) $('resolutionPanel')?.style.setProperty('--resolution-details-width',`${Math.round(w)}px`);
}
try{
  const sidebar=document.querySelector('.sidebar');
  if(sidebar && typeof ResizeObserver==='function') new ResizeObserver(syncResolutionDetailsWidth).observe(sidebar);
  window.addEventListener('resize',syncResolutionDetailsWidth);
  syncResolutionDetailsWidth();
}catch(_e){}

bindDynamicSidebarUI();
installGeometryNumericInputs($,parseNumericValue);


// The Constant E map energy and the Angle calculation hbar-omega are one value.
// The map shows the nearest calculated slice; the Angle calculation keeps the
// exact entered value. Map slider / entry -> geomHW; geomHW (typed or its
// slider) -> map slice.
function targetHWMapIndex(cache){
  const hw=num('geomHW');
  return Number.isFinite(hw) && cache?.hwList?.length ? nearestHWIndex(cache,hw) : null;
}
function setTargetHWFromMap(i){
  const v=singleCache?.hwList?.[i];
  if(Number.isFinite(v) && $('geomHW')) $('geomHW').value=String(Number(v.toFixed(4)));
}
// Returns true when the map (and with it the TAS geometry) was redrawn.
function syncMapHWFromTarget(){
  if(!singleCache || checkedValue('sampleMode')!=='single') return false;
  const i=targetHWMapIndex(singleCache);
  if(i===null || i===Number($('hwSlider')?.value)) return false;
  renderSingle(singleCache,i);
  return true;
}
// Four-circle: the Constant E map follows the W layer of the Angle
// calculation target (deferred: this may be called while the map draws).
let mapWTimer=null;
function syncMapWFromTarget(w){
  if(!singleCache?.fourCircle || checkedValue('sampleMode')!=='single' || !Number.isFinite(w)) return false;
  // While W is being typed on the map, the map is the driver (its change
  // event then moves the target).
  if(document.activeElement===$('qeWEntry')) return false;
  const v=Number(w.toFixed(4));
  if(Math.abs((Number(singleCache.layerW)||0)-v)<1e-9) return false;
  if($('qeWEntry')) $('qeWEntry').value=String(v);
  clearTimeout(mapWTimer);
  mapWTimer=setTimeout(()=>{ mapWTimer=null; recalculate(); },0);
  return true;
}
$("hwSlider").addEventListener("input",()=>{
  if(!singleCache) return;
  const i=Number($("hwSlider").value);
  setTargetHWFromMap(i);
  renderSingle(singleCache,i);
});
$("hwSlider").addEventListener("change",()=>saveRightPanelState());
$('geomHW')?.addEventListener('input',syncMapHWFromTarget);
$('geomHW')?.addEventListener('change',syncMapHWFromTarget);
$('qeMapTabConstant')?.addEventListener('click',()=>setQEMapTab('constant'));
$('qeMapTabVector')?.addEventListener('click',()=>setQEMapTab('vector'));
bindQEPathControls();

// Angle calculation Scan inputs are display-only.  Rebuilding the complete
// single-crystal Q-E cache on every keypress made H/K/L/hw editing sluggish,
// especially when the scan table contains many points.  Reuse the current
// cache and debounce only the Angle/TAS geometry redraw while typing.
let geometryScanInputTimer=null;
const GEOMETRY_SCAN_INPUT_IDS=[
  'geomScanH0','geomScanK0','geomScanL0','geomScanHW0',
  'geomScanH1','geomScanK1','geomScanL1','geomScanHW1','geomScanNpts'
];
function renderGeometryScanFromCurrentCache(){
  clearTimeout(geometryScanInputTimer);
  geometryScanInputTimer=null;
  if(singleCache && checkedValue('sampleMode')==='single' && geometryCalculationMode()==='scan'){
    renderGeometry(singleCache,Number($('hwSlider')?.value)||0);
  }
}
function scheduleGeometryScanRender(delay=180){
  clearTimeout(geometryScanInputTimer);
  geometryScanInputTimer=setTimeout(renderGeometryScanFromCurrentCache,Math.max(0,Number(delay)||0));
}
for(const id of GEOMETRY_SCAN_INPUT_IDS){
  $(id)?.addEventListener('input',()=>scheduleGeometryScanRender(180));
  $(id)?.addEventListener('change',renderGeometryScanFromCurrentCache);
}

$('geometryModeSingle')?.addEventListener('click',()=>{setGeometryCalculationMode('single');saveRightPanelState();});
$('geometryModeScan')?.addEventListener('click',()=>{setGeometryCalculationMode('scan');saveRightPanelState();});
$('geometryScanTabTable')?.addEventListener('click',()=>{setGeometryScanOutputTab('table');saveRightPanelState();});
$('geometryScanTabPlot')?.addEventListener('click',()=>{setGeometryScanOutputTab('plot');saveRightPanelState();});
$('geomScanPointSlider')?.addEventListener('input',()=>{
  if(singleCache && checkedValue('sampleMode')==='single') renderGeometry(singleCache,Number($('hwSlider')?.value)||0);
});

$("geomSetU").addEventListener("click",setGeometryTargetFromU);
$("geomSetV").addEventListener("click",setGeometryTargetFromV);
$("geomPerpU").addEventListener("click",setGeometryKiPerpU);
$("geomPerpV").addEventListener("click",setGeometryKiPerpV);
$("geomParallelU").addEventListener("click",setGeometryKiParallelU);
$("geomParallelV").addEventListener("click",setGeometryKiParallelV);
$("geomSetBragg").addEventListener("click",setGeometryTargetFromBragg);
// Send the Angle calculation point to the Resolution tab (single point) and
// open it there, where the instrument details can be adjusted.
$("geomToResolution")?.addEventListener("click",()=>{
  const mode=$("calcMode");
  if(mode && mode.value!=="single"){ mode.value="single"; mode.dispatchEvent(new Event("change",{bubbles:true})); }
  for(const [from,to] of [["geomH","h"],["geomK","k"],["geomL","l"],["geomHW","hw"]]){
    const src=$(from), dst=$(to);
    if(!src || !dst) continue;
    dst.value=src.value;
    dst.dispatchEvent(new Event("input",{bubbles:true}));
    dst.dispatchEvent(new Event("change",{bubbles:true}));
  }
  setActiveTab("resolution");
  saveRightPanelState?.();
  saveGlobalUIState?.();
  scheduleRecalc();
});
// The reverse: Resolution point (H, K, L, ħω) → Angle calculation & TAS
// geometry (Single mode) in the Q-E tab.
$("resolutionToGeometry")?.addEventListener("click",()=>{
  for(const [from,to] of [["h","geomH"],["k","geomK"],["l","geomL"],["hw","geomHW"]]){
    const src=$(from), dst=$(to);
    if(!src || !dst) continue;
    dst.value=src.value;
    dst.dispatchEvent(new Event("input",{bubbles:true}));
    dst.dispatchEvent(new Event("change",{bubbles:true}));
  }
  setActiveTab("qe");
  if(geometryCalculationMode?.()!=="single") setGeometryCalculationMode?.("single");
  $("geometryTabAngles")?.click();
  saveRightPanelState?.();
  saveGlobalUIState?.();
  scheduleRecalc();
});

// Either S2 control may be used as the user's entry point.  Effective is an
// absolute value; convert it to Delta before the normal recalculation handler
// runs.  Editing Delta needs no conversion because Effective is derived from it.
$('S2maxEffective')?.addEventListener('input',syncS2DeltaFromEffective);
$('S2maxEffective')?.addEventListener('change',syncS2DeltaFromEffective);

document.querySelectorAll("input,select").forEach(el=>{
  if(el.closest?.('.time-estimate-pane')) return;
  if([
    "instrument",
    "seSelect","seSelect2","seSelect3",
    ...BACKGROUND_SLOTS.map(slot=>slot.id),
    "hwSlider",
    "geomScanPointSlider",
    "scanSlider",
    // Display frame of the Resolution results: redraws, no recalculation.
    "resolutionCoordinates","resolutionUVView",
    'qeVectorHKLPath','qePathHKLConstant','qePathSnap',
    ...GEOMETRY_SCAN_INPUT_IDS
  ].includes(el.id)) return;

  el.addEventListener("input",scheduleRecalc);
  el.addEventListener("change",scheduleRecalc);
});



// ==================== Time estimate / Script workspace ====================
// The implementation lives in script-workspace.js. Bindings are assigned once
// all app-level helpers have been initialized, immediately before initialize().
let currentGeometryCardTab;
let hklInCurrentScatteringPlane;
let initializeScriptWorkspaceUI;
let mountTimeEstimateForScript;
let scatteringPlaneWarningMessage;
let setGeometryCardTab;
let setScatteringPlaneWarning;
let validateAllTimeScanRows;

// ==================== Resolution calculator ====================
document.querySelector('.sidebar').addEventListener('input',()=>saveLeftPanelState());
document.querySelector('.sidebar').addEventListener('change',()=>saveLeftPanelState());

// ---- Feature-module wiring -------------------------------------------------
({
  prepareToolboxUI,
  bindToolboxUI,
  updateAbsorptionCalculator
}=createToolboxUI({
  $, num, checkedValue,
  getSelectedCifStructure:()=>selectedCifStructure,
  getSelectedCifFileName:()=>selectedCifFileName,
  selectCifFile:(...args)=>selectCifFile(...args),
  showError
}));

// TAS angle calculation is the shared physics core for Resolution, Q-E and TAS Geometry.
({
  canonicalOrientationMode,
  effectiveOrientationReference,
  tasMotorAngles
}=createTasAngleCalculation({
  $, PI, angleDiffDeg, clamp, dot, hklToQ, makeSpiceScatteringPlaneBasis, norm, normalize, num, rad2deg,
  scale, selectedS1Sign, selectedTasSense, sub, tasConvention, tasConventionFromLegacyUiSense,
  tasCrystalPhiDegForConvention, tasPhiLabDegForConvention, wrap180,
  isFourCircle:()=>{ try{ return currentInstrument()?.instrument_type==='four-circle'; }catch(_e){ return false; } },
  fourCircleSignFactors
}));

// Dark-angle physics and Q-E single-crystal range are isolated first because
// TAS Geometry and Script Workspace consume their public helpers.
({
  getDarkAssets,
  directBeamOrientationCorrection,
  rebuildGeometryMatchedDarkPolygons,
  qeDarkBlockWarningsForHKLE
}=createDarkAngle({
  $, canonicalOrientationMode, checkedValue, clamp, currentDarkRangeCount, darkAssetIds, darkAssetSlots,
  deg2rad, dot, effectiveOrientationReference, hklToQ, linspace, norm, num, qePointInPolygon, rad2deg,
  selectedS1Sign, selectedTasSense, tasConvention
}));

({
  calculateSingleCrystal
}=createQESingleCrystal({
  $, PI, RL_calc, UB_calc, add, arange, backgroundColor, backgroundMaterials, backgroundPowderPeaks,
  calcQ0, centeringFromSpaceGroup:(...args)=>centeringFromSpaceGroup(...args), checkedValue, clamp, currentInstrument,
  deg2rad, dot, effectiveOrientationReference, effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL,
  getDarkAssets, getSelectedCifFileName:()=>selectedCifFileName,
  getNuclearCifStructure:()=>nuclearStructureForSelectedCif?.() ?? null,
  hklToQ, isAllowedByCentering, latticeParams, linspace, makeSpiceScatteringPlaneBasis, maxArray, norm,
  nuclearStructureFactorSquared, num, rad2deg, rangeTable, energyTransferRange, energyTransferGrid, rebuildGeometryMatchedDarkPolygons,
  representativePowderHklText, scale, selectedBackgrounds, selectedS1Sign,
  selectedSampleSpaceGroup:(...args)=>selectedSampleSpaceGroup(...args), selectedTasSense, tasConvention,
  tasPhiLabDegForConvention, tasPlotPhiFromCrystalPhiForConvention, validateEffectiveS2Max, wrap180, fourCircleSignFactors
}));

({
  buildResolutionLattice,
  updateAutoW,
  flipScatteringPlaneUV,
  collectResolutionBase,
  formatAngle,
  updateResolutionPlaneWarning,
  doSingleResolution,
  doScanResolution,
  renderResolutionScan,
  bindResolutionManualCalculation,
  updatePropagationVectorLabels,
  powderWavevectors,
  setPowderLinkDriver,
  syncPowderLinkedInputs,
  powderGeometryTarget,
  hasScanResults,
  clearResolutionResults
}=createResolutionUI({
  $, tasMotorAngles, PI, RLRes, add, calcResolution, checkedValue, clamp, clearError, currentInstrument, deg2rad,
  hklInCurrentScatteringPlane:(...args)=>hklInCurrentScatteringPlane(...args), hklToQ, inferOutOfPlaneHKL, latticeParams,
  linspace, markResolutionScanDirty, norm, num, parseNumericValue, powderS2ForQAtHW,
  propagationVectorIndices, rad2deg, scatteringPlaneWarningMessage:(...args)=>scatteringPlaneWarningMessage(...args),
  scheduleRecalc, selectedS1Sign, selectedTasSense, setScatteringPlaneWarning:(...args)=>setScatteringPlaneWarning(...args),
  showError, tasConvention, tasConventionFromLegacyUiSense, userFacingTasMessage
}));

({
  geometryCalculationMode,
  geometryPointWarnings,
  currentGeometryScanOutputTab,
  setGeometryScanOutputTab,
  setGeometryCalculationMode,
  updateGeometryCalculationModeVisibility,
  renderGeometry
}=createTasGeometryView({
  $, GEOMETRY_CALC_MODE_STORAGE_KEY, GEOMETRY_SCAN_OUTPUT_STORAGE_KEY, PI, add, angleDiffDeg, checkedValue, clamp,
  currentInstrument, deg2rad, directBeamOrientationCorrection, dot, effectiveOrientationReference, effectiveS2MaxAtEi,
  formatAngle, hklInCurrentScatteringPlane:(...args)=>hklInCurrentScatteringPlane(...args), hklToQ, linspace,
  makeSpiceScatteringPlaneBasis, norm, num, parseNumericValue, powderGeometryTarget, qeDarkBlockWarningsForHKLE,
  qeGeometryAngles, rad2deg, scale, scatteringPlaneWarningMessage:(...args)=>scatteringPlaneWarningMessage(...args),
  selectedS1Sign, selectedTasSense, setScatteringPlaneWarning:(...args)=>setScatteringPlaneWarning(...args),
  tasConvention, qeSpurionWarnings, userFacingTasMessage, getSingleCache:()=>singleCache,
  syncGeometrySliders:(...args)=>geometrySliders?.syncGeometrySliders(...args),
  updateGeometryTargetMarker:(...args)=>updateGeometryTargetMarker(...args)
}));
// U / V / hbar-omega sliders of Angle calculation & TAS geometry (Single).
geometrySliders=createGeometrySliders({
  $, checkedValue, collectResolutionBase:(...args)=>collectResolutionBase(...args), getSingleCache:()=>singleCache,
  hklToQ, makeSpiceScatteringPlaneBasis, norm, dot, num,
  geometryCalculationMode:(...args)=>geometryCalculationMode(...args),
  renderGeometryNow:()=>{ if(singleCache && checkedValue('sampleMode')==='single') renderGeometry(singleCache,Number($('hwSlider')?.value)||0); },
  syncMapHWFromTarget:()=>syncMapHWFromTarget(),
  syncMapWFromTarget:(w)=>syncMapWFromTarget(w)
});
geometrySliders.bindGeometrySliders();

({
  currentGeometryCardTab,
  hklInCurrentScatteringPlane,
  initializeScriptWorkspaceUI,
  mountTimeEstimateForScript,
  scatteringPlaneWarningMessage,
  setGeometryCardTab,
  setScatteringPlaneWarning,
  validateAllTimeScanRows
}=createScriptUI({
  $, add, buildResolutionLattice, calculateSingleCrystal, checkedValue, clamp, cross,
  currentInstrument, dot, effectiveS2MaxAtEi, hklToQ, tasConvention, norm, num,
  parseNumericValue, qeDarkBlockWarningsForHKLE, rad2deg, renderGeometry,
  geometryPointWarnings:(...args)=>geometryPointWarnings(...args),
  resizeVisiblePlots:(...args)=>resizeVisiblePlots(...args), safeResizePlot:(...args)=>safeResizePlot(...args), scale, userFacingTasMessage,
  get singleCache(){ return singleCache; },
  get powderCache(){ return powderCache; }
}));

({
  updateCifUI,
  syncSfColorMaxControl,
  selectCifFile,
  clearSelectedCif,
  centeringFromSpaceGroup,
  selectedSampleSpaceGroup,
  selectedSampleCentering,
  setCifOutputTab,
  initializeCifGenerator,
  nuclearStructureForSelectedCif,
  refreshAfterStateRestore:refreshCifAfterStateRestore
}=createCifUI({
  $, PI, RL_calc, add, canonicalReflectionHkl, checkedValue, clamp, clearError, compareHkl, cross,
  currentInstrument, dot, effectiveS2MaxAtEi, hklKey, hklToQ, makeSpiceScatteringPlaneBasis, norm,
  nuclearStructureFactorSquared, num, parseCifStructure, parseNumericValue, rad2deg, reciprocalSymmetryMatrices, reflectionStar,
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args), scheduleRecalc, updateAutoW, updateModeVisibility, updateAbsorptionCalculator,
  getPropagationVectors:()=>propagationVectorValues(),
  setPropagationVectorsFromFile:(values)=>replacePropagationVectors(values,{recalc:false}),
  getSelectedCifStructure:()=>selectedCifStructure, getSelectedCifFileName:()=>selectedCifFileName,
  getSelectedCifText:()=>selectedCifText,
  setSelectedCifState:(structure,fileName,text)=>{ selectedCifStructure=structure; selectedCifFileName=fileName; selectedCifText=text; }
}));

({
  safeResizePlot,
  resizeVisiblePlots,
  scheduleVisiblePlotResize,
  initializeResponsivePlotResize,
  setActiveTab,
  updateCalcMode,
  saveRightPanelState,
  restoreRightPanelState,
  savedActiveTab,
  restoreGeometrySubTabsFromStorage,
  enableRightPanelPersistence,
  saveGlobalUIState,
  restoreGlobalUIState,
  enableGlobalUIPersistence,
  saveLeftPanelState,
  restoreLeftPanelState
}=createUIShell({
  $, BACKGROUND_SLOTS, GEOMETRY_CALC_MODE_STORAGE_KEY,
  GEOMETRY_SCAN_OUTPUT_STORAGE_KEY, add, applyInstrumentDefaults, applyInstrumentTypeChange, applyInstrumentTypeDefaults,
  applySampleEnvironmentDefaults, backgroundRowValues, buildResolutionLattice, checkedValue, currentGeometryCardTab,
  currentGeometryScanOutputTab, darkAssetIds, darkAssetSlots, darkAssetValues, geometryCalculationMode, markResolutionScanDirty,
  mountTimeEstimateForScript, propagationVectorValues, refreshDarkEnvironmentSelect, renderGeometry, renderQEVectorMap,
  renderResolutionScan, renderSingle, replaceBackgroundRows, replaceDarkAssets, replacePropagationVectors,
  resolutionPanelIsVisible, scheduleRecalc, selectedS1Sign, setBackgroundCount, setCifOutputTab, setDarkAssetCount,
  setDarkRangeCount, setGeometryCalculationMode, setGeometryCardTab, setGeometryScanOutputTab, setPropagationVectorCount,
  setQEMapTab, setupTasConventionUI, sub, updateAutoW, updateBackgroundSelectAvailability, updateDarkReferenceUI,
  updateEnergyLabel, updateModeVisibility, updateOrientationReferenceUI, updateResolutionPlaneWarning, updateS2MaxDisplay,
  updateSupermirrorUI, getSingleCache:()=>singleCache, getPowderCache:()=>powderCache,
  getSelectedCifStructure:()=>selectedCifStructure,
  getSelectedCifText:()=>selectedCifText, hasScanResults
}));

// Start-up sequence (src/app/bootstrap.js): load the data directories, restore
// saved state and draw the first view.
const {
  initialize
}=createAppBootstrap({
  applyDarkAngleSlotColors, applyInstrumentCrystalAvailability, applyInstrumentDefaults,
  applySampleEnvironmentDefaults, backgroundMaterials, backgroundRowIndices,
  bindResolutionManualCalculation:(...args)=>bindResolutionManualCalculation(...args),
  bindToolboxUI:(...args)=>bindToolboxUI(...args),
  clearSelectedCif:(...args)=>clearSelectedCif(...args),
  currentGeometryCardTab:(...args)=>currentGeometryCardTab(...args), darkAssetIds, darkAssetSlots,
  doScanResolution:(...args)=>doScanResolution(...args),
  enableGlobalUIPersistence:(...args)=>enableGlobalUIPersistence(...args),
  enableRightPanelPersistence:(...args)=>enableRightPanelPersistence(...args),
  ensureNuclearLabelControl, ensureQESliderControls, fillCrystal,
  flipScatteringPlaneUV:(...args)=>flipScatteringPlaneUV(...args),
  initializeCifGenerator:(...args)=>initializeCifGenerator(...args), initializeNeutronData,
  initializeResponsivePlotResize:(...args)=>initializeResponsivePlotResize(...args),
  initializeScriptWorkspaceUI:(...args)=>initializeScriptWorkspaceUI(...args),
  initializeSidebarCrystalSelectors, instruments, legacyRangeInstruments, nearestHWIndex,
  prepareToolboxUI:(...args)=>prepareToolboxUI(...args), propagationVectorIndices, qeCommitPathText,
  qeDefaultPathText, qePathInput, recalculate,
  refreshCifAfterStateRestore:(...args)=>refreshCifAfterStateRestore(...args),
  refreshDarkEnvironmentSelect, refreshSelect,
  renderResolutionScan:(...args)=>renderResolutionScan(...args), renderSingle,
  restoreGeometrySubTabsFromStorage:(...args)=>restoreGeometrySubTabsFromStorage(...args),
  restoreGlobalUIState:(...args)=>restoreGlobalUIState(...args),
  restoreLeftPanelState:(...args)=>restoreLeftPanelState(...args),
  restoreRightPanelState:(...args)=>restoreRightPanelState(...args), sampleEnvironments,
  savedActiveTab:(...args)=>savedActiveTab(...args),
  saveGlobalUIState:(...args)=>saveGlobalUIState(...args),
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  saveRightPanelState:(...args)=>saveRightPanelState(...args),
  selectCifFile:(...args)=>selectCifFile(...args), setActiveTab:(...args)=>setActiveTab(...args),
  setBackgroundCount, setDarkAssetCount, setGeometryTargetHKL,
  setPowderLinkDriver:(...args)=>setPowderLinkDriver(...args), setPropagationVectorCount, setQEMapTab,
  setTargetHWFromMap, syncGeometryTargetToOrientationReference,
  syncPowderLinkedInputs:(...args)=>syncPowderLinkedInputs(...args), syncQEPathSnapDefault,
  syncSfColorMaxControl:(...args)=>syncSfColorMaxControl(...args), syncSidebarCrystalSelectors,
  updateAutoW:(...args)=>updateAutoW(...args), updateBackgroundSelectAvailability,
  updateBraggOrientationPlaneWarning, updateCalcMode:(...args)=>updateCalcMode(...args),
  updateCifUI:(...args)=>updateCifUI(...args), updateDarkReferenceUI, updateEnergyLabel,
  updateGeometryQuickTargetButtons, updateModeVisibility, updateOrientationReferenceUI,
  updatePropagationVectorLabels:(...args)=>updatePropagationVectorLabels(...args),
  updateResolutionPlaneWarning:(...args)=>updateResolutionPlaneWarning(...args), updateSupermirrorUI,
  validateAllTimeScanRows:(...args)=>validateAllTimeScanRows(...args),
  getFixedBeamControls:()=>fixedBeamControls,
  setFixedBeamControls:(value)=>{ fixedBeamControls=value; }, getSingleCache:()=>singleCache,
  getGeometrySliders:()=>geometrySliders
});

// The initial HTML contains every conditional panel for later use, but only
// reveal them after instrument data, local preferences and active tabs agree.
// On an initialization failure reveal the error box instead of leaving a blank UI.
initialize()
  .catch(err=>{
    showError(err);
    setStatus('Configuration loading failed. Open the project through an HTTP server.');
  })
  .finally(()=>{
    document.documentElement.classList.remove('tas-ui-booting');
    // Deferred plot measurement happens after the real layout is visible.
    requestAnimationFrame(()=>scheduleVisiblePlotResize());
  });
