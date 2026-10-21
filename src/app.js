import {
  PI, EPS, deg2rad, rad2deg, clamp,
  add, sub, scale, dot, norm, cross, normalize,
  RL_calc, UB_calc, makeSpiceScatteringPlaneBasis,
  linspace, arange
} from "./core/tas-core.js";
import {RL_calc as RLRes, inferOutOfPlaneHKL, calcResolution} from "./resolution/resolution-core.js";
import {
  parseCifStructure, nuclearStructureFactorSquared, setNeutronData
} from "./cif/cif-structure.js";
import {
  normalizeTasSense, normalizeS1Sign, tasConvention,
  wrap180, angleDiffDeg,
  tasPhiLabDegForConvention,
  tasCrystalPhiDegForConvention, tasPlotPhiFromCrystalPhiForConvention,
  calcQ0
} from "./core/tas-conventions.js";
import {
  isGitHubPages, isLocalDirectoryListingHost,
  loadJsonDirectory, loadCifDirectory, fetchJsonOnce
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
import {createFixedBeamControls} from "./app/fixed-beam-units.js";
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

const $ = id => document.getElementById(id);
const instruments = new Map();
const backgroundMaterials = new Map();
const sampleEnvironments = new Map();
let fixedBeamControls = null;

// Feature modules are wired near the end of this file after their dependencies are defined.
let updateCifUI, syncSfColorMaxControl, selectCifFile, clearSelectedCif, centeringFromSpaceGroup, selectedSampleSpaceGroup, selectedSampleCentering, setCifOutputTab, initializeCifGenerator, nuclearStructureForSelectedCif, refreshCifAfterStateRestore, formatAutoHKL, buildResolutionLattice, updateAutoW, flipScatteringPlaneUV, collectResolutionBase, tasMotorAngles, calcOne, matrixText, traceEllipse, baseLayout, resolutionPlotLimitsFromEntries, formatAngle, renderResolution, resolutionScanPoints, updateResolutionPlaneWarning, doSingleResolution, doScanResolution, renderResolutionScan, bindResolutionManualCalculation, updatePropagationVectorLabels, powderWavevectors, powderQFromS2AtHW, powderSignedS2FromQAtHW, powderLinkDriver, setPowderLinkDriver, syncPowderLinkedInputs, powderGeometryTarget, geometryCalculationMode, geometryScanPoints, syncGeometryScanPointSlider, geometryDisplayedMotorAngles, geometryScanStatusWarnings, geometryScanErrorStatus, geometryPointWarnings, updateGeometryPlaneWarning, renderGeometryScanTable, currentGeometryScanOutputTab, setGeometryScanOutputTab, moveGeometryPlotForMode, setGeometryCalculationMode, updateGeometryAnglesVisibility, updateGeometryCalculationModeVisibility, geometryResultSummaryHtml, renderGeometry, safeResizePlot, plotHasLayout, ensureVisiblePrimaryPlots, scheduleVisiblePrimaryPlotRecovery, resizeVisiblePlots, scheduleVisiblePlotResize, initializeResponsivePlotResize, setActiveTab, updateCalcMode, setupAppHeader, rightPanelControls, saveRightPanelState, restoreRightPanelState, savedActiveTab, restoreGeometrySubTabsFromStorage, enableRightPanelPersistence, globalUIPersistentControls, currentCifOutputTab, saveGlobalUIState, restoreGlobalUIState, enableGlobalUIPersistence, leftPanelControls, resolutionInstrumentDetailControls, saveLeftPanelState, setSavedControl, restoreLeftPanelState, hasScanResults, clearResolutionResults;
let getDarkAssets, darkSampleRangeForConvention, directBeamOrientationCorrection, rebuildGeometryMatchedDarkPolygons, qeDarkBlockWarningsForHKLE;
let canonicalOrientationMode, effectiveOrientationReference;
let calculateSingleCrystal, calculateSingleCrystalCore;

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
  applyInstrumentCrystalAvailability, applyInstrumentDefaults, currentInstrument, effectiveS2MaxAtEi,
  fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer, rangeTable,
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
  latticeParams, num, powderWavevectors:(...args)=>powderWavevectors(...args), rangeTable,
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
  getSingleCache:()=>singleCache, getPowderCache:()=>powderCache
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


function parseNumericValue(value){
  const raw=String(value??"").trim();
  if(!raw) return NaN;
  const normalized=raw.replace(/[⁄／]/g,"/");
  const direct=Number(normalized);
  if(Number.isFinite(direct)) return direct;
  const numberPart='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const match=normalized.match(new RegExp(`^\\s*(${numberPart})\\s*/\\s*(${numberPart})\\s*$`));
  if(!match) return NaN;
  const numerator=Number(match[1]);
  const denominator=Number(match[2]);
  if(!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator===0) return NaN;
  return numerator/denominator;
}

function num(id){
  const raw=String($(id)?.value??"");
  return raw.trim()==="" ? Number(raw) : parseNumericValue(raw);
}

// TAS convention routing.
//
// SPICE scattering Sense and the sample-axis motor sign are independent
// instrument properties.  The UI therefore exposes them separately:
//
// Legacy four-state values are accepted only while importing older settings.
//
// The legacy four-state branch remains internal only so the already-validated
// Q-E, Angle calculation, TAS geometry and Dark-angle paths can be reused
// without changing their numerical behavior.  Resolution receives only the
// physical SPICE Sense and is intentionally independent of S1 motor polarity.
function tasConventionFromLegacyUiSense(value){
  // Backward-compatibility parser for pre-refactor saved settings / instrument
  // files.  Legacy four-state labels are converted once at the input boundary.
  if(value==="+++") return {sense:"+-+",s1sign:"ccw"};
  if(value==="+-+") return {sense:"+-+",s1sign:"cw"};
  if(value==="---") return {sense:"-+-",s1sign:"cw"};
  return {sense:"-+-",s1sign:"ccw"};
}
function selectedTasSense(){ return normalizeTasSense(checkedValue("sense")); }
function selectedS1Sign(){ return normalizeS1Sign(checkedValue("s1sign")); }

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

  let s1Select=$("s1sign");
  let s1Row=$("s1SignRow");
  if(!s1Select){
    s1Row=document.createElement("label");
    s1Row.id="s1SignRow";
    s1Row.append("S1 sign");
    s1Select=document.createElement("select");
    s1Select.id="s1sign";
    for(const [value,label] of [["ccw","CCW"],["cw","CW"]]){
      const option=document.createElement("option");
      option.value=value; option.textContent=label; s1Select.appendChild(option);
    }
    s1Select.value=initial.s1sign;
    s1Row.appendChild(s1Select);
  }

  // Put Geometry / Sense / S1 sign on one dedicated three-column row.
  let row=$("tasConventionRow");
  if(!row){
    row=document.createElement("div");
    row.id="tasConventionRow"; row.className="grid3";
    const oldParent=senseRow.parentElement;
    oldParent?.after(row);
  }
  row.appendChild(geometryRow);
  row.appendChild(senseRow);
  row.appendChild(s1Row);
}
setupTasConventionUI();

function checkedValue(name){
  const direct=$(name);
  if(direct && direct.tagName==="SELECT") return direct.value;
  const el=document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}
function setRadio(name,value){
  const direct=$(name);
  if(direct && direct.tagName==="SELECT") { direct.value=value; return; }
  const el=document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if(el) el.checked=true;
}
function userFacingTasMessage(value){
  return String(value??'').replace(/\bsv1\b/g,'U').replace(/\bsv2\b/g,'V');
}
function showError(err){
  const raw=err instanceof Error ? err.message : String(err);
  $("errorBox").textContent = userFacingTasMessage(raw);
  $("errorBox").classList.remove("hidden");
}
function clearError(){ $("errorBox").classList.add("hidden"); $("errorBox").textContent=""; }
function setStatus(text){ $("status").textContent=text; }


let prepareToolboxUI, bindToolboxUI, updateAbsorptionCalculator;

function hklToQ(rl,hkl){
  return add(add(scale(rl.astar,hkl[0]),scale(rl.bstar,hkl[1])),scale(rl.cstar,hkl[2]));
}

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

  const showDark=!!$('addDark')?.checked;
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
      container.appendChild(button);
    }
    const ids=darkAssetIds(slot);
    const visible=showDark && !!$(ids.enable)?.checked && checkedValue(ids.ref)==='Reference Q';
    button.classList.toggle('hidden',!visible);
  }
}
function formatHKL(v){
  return v.map(x=>Math.abs(x-Math.round(x))<1e-10?String(Math.round(x)):x.toFixed(3)).join(",");
}

function isAllowedByCentering(hkl, centering){
  const rounded=hkl.map(x=>Math.round(x));

  // Centering extinction rules are defined for integer Miller indices.
  // If a generated point is not integer-valued, leave it unchanged.
  if(hkl.some((x,i)=>Math.abs(x-rounded[i])>1e-10)) return true;

  const [h,k,l]=rounded;
  const even = x => Math.abs(x)%2===0;

  switch(centering){
    case "I":
      return even(h+k+l);
    case "F":
      return (even(h) && even(k) && even(l)) ||
             (!even(h) && !even(k) && !even(l));
    case "A":
      return even(k+l);
    case "B":
      return even(h+l);
    case "C":
      return even(h+k);
    case "R":
      return ((-h+k+l)%3+3)%3===0;
    case "P":
    default:
      return true;
  }
}
function maxArray(a){ return Math.max(...a); }

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
  $("geometryRow")?.classList.remove("hidden");
  $("senseRow")?.classList.remove("hidden");
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

function latticeParams(){
  return {
    a:num("a"), b:num("b"), c:num("c"),
    alpha:num("alpha"), beta:num("beta"), gamma:num("gamma")
  };
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
  scheduleRecalc();
});

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
    if(Array.isArray(inst.S2_limits)||(inst.qe_range&&(Array.isArray(inst.qe_range.S2_limits)||Array.isArray(inst.qe_range.configuration)))) continue;
    let legacy=legacyRangeInstruments.get(key);
    if(!legacy){const target=(inst.name||key).toLowerCase();legacy=[...legacyRangeInstruments.values()].find(x=>(x.name||'').toLowerCase()===target);}
    if(legacy) inst.qe_range=legacy;
  }
}
async function initialize(){
  fixedBeamControls = createFixedBeamControls();
  clearError(); fillCrystal('monoCrystal','dMono');fillCrystal('anaCrystal','dAna');initializeSidebarCrystalSelectors();updateModeVisibility();updateEnergyLabel();updateCalcMode();updateSupermirrorUI();updateAutoW();
  initializeScriptWorkspaceUI();
  try{
    // Snap 1/n: the user's explicit choice, else the lattice default.
    syncQEPathSnapDefault();
    const savedMapTab=localStorage.getItem('tas-qe-map-tab-v1');
    setQEMapTab(savedMapTab==='vector'?'vector':'constant');
  }catch(_e){ setQEMapTab('constant'); }
  restoreGeometrySubTabsFromStorage();

  // Register the main tabs before any optional async data source is loaded.
  // A missing optional directory or CIF-generator asset must never leave the
  // application stuck with only the initially visible Q-E panel.
  $('tabQe')?.addEventListener('click',()=>setActiveTab('qe'));
  $('tabResolution')?.addEventListener('click',()=>setActiveTab('resolution'));
  $('tabToolbox')?.addEventListener('click',()=>setActiveTab('toolbox'));
  $('tabCifGenerator')?.addEventListener('click',()=>setActiveTab('cif-generator'));
  $('tabStructure')?.addEventListener('click',()=>setActiveTab('structure'));
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
  const nInstrument=await instrumentLoad;
  // Migration: avoid listing DEMAND twice when the old HB-3A filename from
  // earlier releases coexists with the newly supplied 08_HB3A.json.
  if(instruments.has('08_HB3A.json') && instruments.has('08_HB3A_DEMAND.json')){
    instruments.delete('08_HB3A_DEMAND.json');
  }
  const [nBG,nSE]=await optionalLoads;
  // The unified instrument/ directory is the preferred source. On localhost,
  // do not probe a possibly absent legacy instruments/ directory at startup;
  // that failed compatibility probe only creates noisy 404s. Static/GitHub
  // deployments retain the legacy fallback during migration.
  const needsLegacy=[...instruments.values()].some(inst=>!(Array.isArray(inst.S2_limits)||(inst.qe_range&&(Array.isArray(inst.qe_range.S2_limits)||Array.isArray(inst.qe_range.configuration)))));
  if(needsLegacy && !isLocalDirectoryListingHost() && !isGitHubPages()){
    // `instruments/` is only a legacy compatibility source.  On GitHub Pages
    // the unified `instrument/` directory is authoritative; probing a removed
    // legacy directory causes a visible 404 and can also hit a stale repo URL.
    await tryLoadDir('instruments',legacyRangeInstruments);
  }
  mergeLegacyRangeData();
  refreshSelect(instruments,$('instrument'),null);setBackgroundCount(Number($('backgroundCount')?.value)||1);for(const slot of darkAssetSlots()) refreshDarkEnvironmentSelect(slot);
  if(!instruments.size) throw new Error('instrument directory has no JSON files.');
  $('instrument').selectedIndex=0;for(const i of backgroundRowIndices()) $(`backgroundSelect${i}`).value='';for(const slot of darkAssetSlots()) $(darkAssetIds(slot).se).value='';applyInstrumentDefaults();for(const slot of darkAssetSlots()) applySampleEnvironmentDefaults(slot);updateBackgroundSelectAvailability();
  // JSON configuration is now fully loaded.  Only at this point is it safe to
  // overlay browser-local user parameters (including the selected instrument).
  const restoredLocalState=restoreLeftPanelState();
  // Restored energyMode/energy (meV) are authoritative. The new visible unit
  // selection is remembered, while legacy saves default to the matching E unit.
  fixedBeamControls?.syncFromCanonical({preferredQuantity:$('fixedBeamQuantity')?.value});
  applyInstrumentCrystalAvailability({preserveCurrent:true});
  syncSidebarCrystalSelectors();
  if(currentGeometryCardTab()==='time') validateAllTimeScanRows({showMessage:true});
  // Restoring sidebar values can change Dark-angle Reference after the sample-
  // environment defaults were applied.  Re-sync the h/k/l row explicitly.
  for(const slot of darkAssetSlots()) updateDarkReferenceUI(slot);
  // Geometry starts at the current Reference Q HKL while preserving the current energy transfer.
  setGeometryTargetHKL([num("refh"),num("refk"),num("refl")]);
  setPropagationVectorCount(propagationVectorIndices().length); setDarkAssetCount(darkAssetSlots().length); updatePropagationVectorLabels(); prepareToolboxUI(); ensureNuclearLabelControl(); ensureQESliderControls(); updateCifUI();
  try{ await initializeCifGenerator(); }
  catch(err){ console.warn('CIF Generator initialization warning:',err); }
  // Right-side controls are restored only after dynamic Toolbox controls exist and
  // after the default geometry target has been initialized, so saved values win.
  const restoredRightState=restoreRightPanelState();
  applyInstrumentCrystalAvailability({preserveCurrent:true});
  syncSidebarCrystalSelectors();
  // Re-apply the geometry tab state at the end of right-panel restoration.
  // This is deliberately late: dynamic controls and saved numeric values are
  // already in place, so no subsequent initialization step can overwrite the
  // selected Single/Scan or Table/TAS geometry tab.
  restoreGeometrySubTabsFromStorage();
  syncSfColorMaxControl("restore");
  enableRightPanelPersistence();
  bindToolboxUI();
  $('powderGeomS2')?.addEventListener('input',()=>{ setPowderLinkDriver('s2'); syncPowderLinkedInputs('s2'); });
  $('powderGeomQ')?.addEventListener('input',()=>{ setPowderLinkDriver('q'); syncPowderLinkedInputs('q'); });
  $('powderGeomHW')?.addEventListener('input',()=>syncPowderLinkedInputs());
  for(const id of ['energy','energyMode','sense','s1sign']) $(id)?.addEventListener('change',()=>{
    if(checkedValue('sampleMode')==='powder') syncPowderLinkedInputs();
  });
  $('hwEntry').addEventListener('change',()=>{if(singleCache){const i=nearestHWIndex(singleCache,Number($('hwEntry').value));setTargetHWFromMap(i);renderSingle(singleCache,i);saveRightPanelState();}});
  $('s2Slider').addEventListener('input',()=>{$('s2Entry').value=Number($('s2Slider').value).toFixed(1);if(singleCache)renderSingle(singleCache,Number($('hwSlider').value));});
  $('s2Entry').addEventListener('change',()=>{if(singleCache)renderSingle(singleCache,Number($('hwSlider').value));});
  $('displayS2Ring').addEventListener('change',()=>{if(singleCache)renderSingle(singleCache,Number($('hwSlider').value));saveRightPanelState();});
  for(const [id,source] of [['sfColorMaxEntry','max'],['sfColorMinEntry','min']]){
    const field=$(id);
    field?.addEventListener('focus',()=>field.select());
    field?.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        field.blur(); // the change event applies the scale
      } else if(event.key==='Escape'){
        event.preventDefault();
        const tr=$('singlePlot')?.data?.find(t=>t.meta==='nuclear-data');
        field.value=String(source==='max'?(tr?.marker?.cmax ?? 1):(tr?.marker?.cmin ?? 0));
        field.blur();
      }
    });
    field?.addEventListener('change',()=>{
      syncSfColorMaxControl(source);
      if(singleCache) renderSingle(singleCache,Number($('hwSlider').value));
      saveRightPanelState();
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
  setActiveTab(savedActiveTab());
  $('gm1').addEventListener('change',updateSupermirrorUI);$('calcMode').addEventListener('change',updateCalcMode);bindResolutionManualCalculation();$('calcScanResolution')?.addEventListener('click',doScanResolution);$('scanSlider').addEventListener('input',()=>renderResolutionScan(num('scanSlider')));$('prev').addEventListener('click',()=>renderResolutionScan(num('scanSlider')-1));$('next').addEventListener('click',()=>renderResolutionScan(num('scanSlider')+1));
  for(const id of ['h','k','l','h0','k0','l0','h1','k1','l1','npts','Uh','Uk','Ul','Vh','Vk','Vl','a','b','c','alpha','beta','gamma']){
    $(id)?.addEventListener('input',updateResolutionPlaneWarning);
    $(id)?.addEventListener('change',updateResolutionPlaneWarning);
  }
  updateResolutionPlaneWarning();
  for(const id of ['a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl']) $(id).addEventListener('input',updateAutoW);
  // Keep the Bragg-reference plane warning live as lattice/plane/HKL inputs change.
  for(const id of ['a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl','refh','refk','refl']){
    $(id)?.addEventListener('input',updateBraggOrientationPlaneWarning);
    $(id)?.addEventListener('change',updateBraggOrientationPlaneWarning);
  }
  $('flipUV')?.addEventListener('click',flipScatteringPlaneUV);
  updateOrientationReferenceUI(); applyDarkAngleSlotColors(); updateGeometryQuickTargetButtons();
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
  $('addDark')?.addEventListener('change',updateGeometryQuickTargetButtons);
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
  setStatus(`Configuration loaded${(restoredLocalState||restoredRightState||restoredGlobalState) ? ' · Saved settings restored' : ''}${nNeutron ? '' : ' · Neutron data unavailable'}`);recalculate();
}

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
  tasCrystalPhiDegForConvention, tasPhiLabDegForConvention, wrap180
}));

// Dark-angle physics and Q-E single-crystal range are isolated first because
// TAS Geometry and Script Workspace consume their public helpers.
({
  getDarkAssets,
  darkSampleRangeForConvention,
  directBeamOrientationCorrection,
  rebuildGeometryMatchedDarkPolygons,
  qeDarkBlockWarningsForHKLE
}=createDarkAngle({
  $, canonicalOrientationMode, checkedValue, clamp, currentDarkRangeCount, darkAssetIds, darkAssetSlots,
  deg2rad, dot, effectiveOrientationReference, hklToQ, linspace, norm, num, qePointInPolygon, rad2deg,
  selectedS1Sign, selectedTasSense, tasConvention
}));

({
  calculateSingleCrystal,
  calculateSingleCrystalCore
}=createQESingleCrystal({
  $, PI, RL_calc, UB_calc, add, arange, backgroundColor, backgroundMaterials, backgroundPowderPeaks,
  calcQ0, centeringFromSpaceGroup:(...args)=>centeringFromSpaceGroup(...args), checkedValue, clamp, currentInstrument,
  deg2rad, dot, effectiveOrientationReference, effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL,
  getDarkAssets, getSelectedCifFileName:()=>selectedCifFileName,
  getNuclearCifStructure:()=>nuclearStructureForSelectedCif?.() ?? null,
  hklToQ, isAllowedByCentering, latticeParams, linspace, makeSpiceScatteringPlaneBasis, maxArray, norm,
  nuclearStructureFactorSquared, num, rad2deg, rangeTable, rebuildGeometryMatchedDarkPolygons,
  representativePowderHklText, scale, selectedBackgrounds, selectedS1Sign,
  selectedSampleSpaceGroup:(...args)=>selectedSampleSpaceGroup(...args), selectedTasSense, tasConvention,
  tasPhiLabDegForConvention, tasPlotPhiFromCrystalPhiForConvention, validateEffectiveS2Max, wrap180
}));

({
  formatAutoHKL,
  buildResolutionLattice,
  updateAutoW,
  flipScatteringPlaneUV,
  collectResolutionBase,
  calcOne,
  matrixText,
  traceEllipse,
  baseLayout,
  resolutionPlotLimitsFromEntries,
  formatAngle,
  renderResolution,
  resolutionScanPoints,
  updateResolutionPlaneWarning,
  doSingleResolution,
  doScanResolution,
  renderResolutionScan,
  bindResolutionManualCalculation,
  updatePropagationVectorLabels,
  powderWavevectors,
  powderQFromS2AtHW,
  powderSignedS2FromQAtHW,
  powderLinkDriver,
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
  geometryScanPoints,
  syncGeometryScanPointSlider,
  geometryDisplayedMotorAngles,
  geometryScanStatusWarnings,
  geometryScanErrorStatus,
  geometryPointWarnings,
  updateGeometryPlaneWarning,
  renderGeometryScanTable,
  currentGeometryScanOutputTab,
  setGeometryScanOutputTab,
  moveGeometryPlotForMode,
  setGeometryCalculationMode,
  updateGeometryAnglesVisibility,
  updateGeometryCalculationModeVisibility,
  geometryResultSummaryHtml,
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
  syncMapHWFromTarget:()=>syncMapHWFromTarget()
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
}=createUIShell({
  $, BACKGROUND_SLOTS, GEOMETRY_CALC_MODE_STORAGE_KEY,
  GEOMETRY_SCAN_OUTPUT_STORAGE_KEY, add, applyInstrumentDefaults,
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
