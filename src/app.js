import {
  PI, deg2rad, rad2deg, clamp,
  add, sub, scale, dot, norm, cross, normalize,
  RL_calc, UB_calc, makeSpiceScatteringPlaneBasis,
  linspace
} from "./core/tas-core.js";
import {RL_calc as RLRes, inferOutOfPlaneHKL, calcResolution} from "./resolution/resolution-core.js";
import {
  parseCifStructure, nuclearStructureFactorSquared, setNeutronData
} from "./cif/cif-structure.js";
import {
  normalizeTasSense, tasConvention,
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
import {createInstrumentJsonIO} from './app/instrument-json-io.js';
import {createSidebarRows} from './app/sidebar-rows.js';
import {createQEPath} from './qe/qe-path.js';
import {createQESingleMap} from './qe/qe-single-map.js';
import {createPowder} from './qe/powder.js';
import {createQESingleRender} from './qe/qe-single-render.js';
import {createQEVectorMap} from './qe/qe-vector-map.js';
import {createRecalc} from './app/recalc.js';
import {createGeometryTargets} from './geometry/geometry-targets.js';
import {createGeometrySliders} from './geometry/geometry-sliders.js';
import {createPowderGeometrySliders} from './geometry/powder-sliders.js';
import {createConvolutionUI} from './convolution/convolution-ui.js';
import {initDispersionOverlay} from './qe/qe-dispersion-overlay.js';
import {installGeometryNumericInputs, installNumericInputGuard} from './app/numeric-inputs.js';
import {$, checkedValue, clearError, latticeParams, num, parseNumericValue, selectedS1Sign, selectedTasSense, setRadio, setStatus, showError, tasConventionFromLegacyUiSense, userFacingTasMessage} from './app/dom-utils.js';
import {formatHKL, hklToQ, isAllowedByCentering} from './core/hkl-utils.js';
import {createAppBootstrap} from './app/bootstrap.js';
import {instrumentHasAnalyzer, instrumentIsElasticOnly} from './app/analyzer-mode.js';

const instruments = new Map();
const backgroundMaterials = new Map();
const sampleEnvironments = new Map();
let fixedBeamControls = null;

// Feature modules are wired near the end of this file after their dependencies are defined.
let magneticPeakIntensities, updateCifUI, syncSfColorMaxControl, selectCifFile, clearSelectedCif, centeringFromSpaceGroup, selectedSampleSpaceGroup, selectedSampleCentering, initializeCifGenerator, nuclearStructureForSelectedCif, refreshCifAfterStateRestore, buildResolutionLattice, updateAutoW, flipScatteringPlaneUV, collectResolutionBase, tasMotorAngles, formatAngle, updateResolutionPlaneWarning, doSingleResolution, doScanResolution, renderResolutionScan, bindResolutionManualCalculation, updatePropagationVectorLabels, powderWavevectors, setPowderLinkDriver, syncPowderLinkedInputs, powderGeometryTarget, geometryPointWarnings, updateGeometryTargetVisibility, renderGeometry, safeResizePlot, resizeVisiblePlots, scheduleVisiblePlotResize, initializeResponsivePlotResize, setActiveTab, updateCalcMode, saveRightPanelState, restoreRightPanelState, savedActiveTab, enableRightPanelPersistence, saveGlobalUIState, restoreGlobalUIState, enableGlobalUIPersistence, saveLeftPanelState, restoreLeftPanelState, hasScanResults, clearResolutionResults;
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
  BACKGROUND_SLOTS, backgroundColor, backgroundRowValues,
  handleBackgroundSelection, removeBackground, replaceBackgroundRows, selectedBackgrounds,
  setBackgroundCount, updateBackgroundSelectAvailability
}=createBackgroundRows({
  $, backgroundMaterials, refreshBackgroundSelect,
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  scheduleRecalc:(...args)=>scheduleRecalc(...args)
});

const {
  CRYSTAL_NAMES,
  syncS2FieldSigns, syncM2FieldSigns, updateCollimator3UI, syncCollimator3WithAnalyzerFocus,
  applyInstrumentCrystalAvailability, applyInstrumentDefaults, applyInstrumentConfigurationDefaults, applyInstrumentDetailDefaults, applyInstrumentTypeChange, currentInstrument, effectiveS2MaxAtEi,
  fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer, syncAnalyzerMode, energyTransferRange, energyTransferGrid,
  syncSidebarCrystalSelectors, updateS2MaxDisplay,
  updateS2MaxDisplayForQERange, updateSupermirrorUI, validateEffectiveS2Max
}=createInstrumentSetup({
  $, checkedValue, clearResolutionResults:(...args)=>clearResolutionResults(...args), instruments, num,
  setStatus, tasConventionFromLegacyUiSense, updateAutoW:(...args)=>updateAutoW(...args),
  updateEnergyLabel, getFixedBeamControls:()=>fixedBeamControls
});
// Instrument JSON Save / Load and the built-in Custom instrument.
const {addLocalInstruments, bindInstrumentJsonButtons}=createInstrumentJsonIO({
  $, instruments, refreshSelect:(...args)=>refreshSelect(...args), currentInstrument, crystalNames:CRYSTAL_NAMES,
  setStatus, showError
});
bindInstrumentJsonButtons();
// 3rd collimator Soller / radial; the analyzer horizontal focusing selects radial.
$('anaHF')?.addEventListener('change',syncCollimator3WithAnalyzerFocus);
$('coll3Type')?.addEventListener('change',updateCollimator3UI);
// Focusing comboboxes drive the (hidden) focusing checkboxes.
for(const [sel,box] of [['monoHType','monoHF'],['monoVType','monoVF'],['anaHType','anaHF'],['anaVType','anaVF']]){
  $(sel)?.addEventListener('change',()=>{ const cb=$(box); if(!cb) return; cb.checked=$(sel).value==='focusing'; cb.dispatchEvent(new Event('change',{bubbles:true})); });
}
// 1st collimator combobox drives the (hidden) supermirror checkbox.
$('coll1Type')?.addEventListener('change',()=>{ const gm=$('gm1'); if(!gm) return; gm.checked=$('coll1Type').value==='supermirror'; gm.dispatchEvent(new Event('change',{bubbles:true})); });
updateCollimator3UI();

const {
  applySampleEnvironmentDefaults, bindDynamicSidebarUI, currentDarkRangeCount, darkAssetIds,
  darkAssetSlots, darkAssetValues, darkCustomSettings, restoreDarkCustomSettings, enabledPropagationVectors, propagationVectorIndices,
  propagationVectorValues, refreshDarkEnvironmentSelect, replaceDarkAssets, replacePropagationVectors,
  setDarkAssetCount, setDarkRangeCount, setPropagationVectorCount, updateDarkReferenceUI
}=createSidebarRows({
  $, backgroundMaterials, backgroundRowValues, checkedValue, handleBackgroundSelection, num,
  parseNumericValue, refreshSelect, removeBackground, replaceBackgroundRows, sampleEnvironments,
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  scheduleRecalc:(...args)=>scheduleRecalc(...args), setRadio, updateGeometryQuickTargetButtons,
  updatePropagationVectorLabels:(...args)=>updatePropagationVectorLabels(...args)
});

const {
  currentQEMapUnit, qeCommitPathText, qeDefaultPathText, qeFormatPathNumber, qePathAxisCoordinateLabel,
  qePathInput, qePathMapLabel, qePathPointXY, qePhysicalRluCoordinates, qePlaneRluBasis,
  qeSelectedPathHKL, qeSpurionWarnings, qeXYForUnit, updateQESpurionWarning, bindQEPathControls, setQEPathAvailable,
  syncQEPathSnapDefault
}=createQEPath({
  $, checkedValue, hklToQ, num, parseNumericValue,
  renderQEVectorMap:(...args)=>renderQEVectorMap(...args),
  renderSingle:(...args)=>renderSingle(...args), getSingleCache:()=>singleCache,
  renderGeometry:(...args)=>renderGeometry(...args)
});

const {
  bindSingleZoomPeakScaling, currentPlotRanges, positionSingleColorbarEntries, singleColorbarTicks,
  singleMarkerSizes, singleNuclearLabelStyle
}=createQESingleMap({
  $, currentQEMapUnit, qeXYForUnit
});

const {
  backgroundPowderPeaks, calculatePowder, powderS2ForQAtHW, redrawPowder, representativePowderHklText
}=createPowder({
  backgroundColor, backgroundMaterials, checkedValue, currentInstrument, currentPlotRanges,
  effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL, hklToQ, isAllowedByCentering,
  latticeParams, num, powderWavevectors:(...args)=>powderWavevectors(...args), energyTransferRange, energyTransferGrid,
  renderQEExternalLegend:(...args)=>renderQEExternalLegend(...args), selectedBackgrounds,
  selectedSampleCentering:(...args)=>selectedSampleCentering(...args), validateEffectiveS2Max,
  getNuclearCifStructure:()=>nuclearStructureForSelectedCif?.() ?? null,
  $, getMagneticPeakIntensities:qMax=>magneticPeakIntensities?.(qMax) ?? null, singleColorbarTicks
});

const {
  nearestHWIndex, renderQEExternalLegend,
  renderSingle, singleMapBraggHoverAngles, updateGeometryTargetMarker
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
  singleColorbarTicks, singleMapBraggHoverAngles
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
  syncQEPathSnapDefault:(...args)=>syncQEPathSnapDefault(...args),
  updateBraggPeakCheck:()=>updateBraggPeakCheck()
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
let powderSliders = null;
let powderCache = null;
let selectedCifStructure = null;
let selectedCifFileName = "";
let selectedCifText = "";





function setupTasConventionUI(){
  const sense=$("sense"), senseRow=$("senseRow");
  if(!sense || !senseRow) return;
  const initial=tasConventionFromLegacyUiSense(sense.value);
  // #sense holds the whole Sense (e.g. "-+-"); the Sense M / S / A selects
  // show and set its three signs.  Writing #sense (restore, instrument
  // files) updates the selects.
  const parts=[...senseRow.querySelectorAll("select[data-sense-part]")];
  const showParts=()=>{
    const s=normalizeTasSense(sense.value);
    parts.forEach(p=>{ p.value=s[Number(p.dataset.sensePart)]; });
  };
  const proto=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  Object.defineProperty(sense,"value",{configurable:true,
    get(){ return proto.get.call(this); },
    set(v){ proto.set.call(this,normalizeTasSense(v)); showParts(); }});
  for(const p of parts) p.addEventListener("change",ev=>{
    ev.stopPropagation();
    const s=[...normalizeTasSense(sense.value)]; s[Number(p.dataset.sensePart)]=p.value;
    sense.value=s.join("");
    sense.dispatchEvent(new Event("change",{bubbles:true}));
  });
  sense.value=initial.sense;

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
  let type='tas', inst=null;
  try{ inst=currentInstrument(); type=inst?.instrument_type||'tas'; }catch(_e){}
  const fourCircle=type==='four-circle', analyzer=instrumentHasAnalyzer(inst);
  // Analyzer sign and A2 limits: only with the analyzer (kept when hidden).
  $("senseAnalyzerPart")?.classList.toggle("hidden",!analyzer);
  $("tasConventionRow")?.classList.remove("hidden");
  for(const el of document.querySelectorAll("#motorLimitTable .four-circle-limit")) el.classList.toggle("hidden",!fourCircle);
  for(const el of document.querySelectorAll("#motorLimitTable .tas-only-limit")) el.classList.toggle("hidden",!analyzer);
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
  syncAnalyzerFreeUI();
}
// Without an analyzer (diffractometer, Analyzer = none) and for 4-circle only
// elastic scattering (ħω = 0) is measured.  Their ħω controls (Constant E map, Angle
// calculation, Powder target), the λ/2 option and the Q vector–E map are not
// shown, and ħω is set to 0.  The control row above the map keeps Save
// figure (a 4-circle also its W slider).
// λ/2 (only elastic) fixes ħω at 0: meanwhile its slider and entry are
// greyed out, and so is the Q vector–E map tab (it needs an energy axis);
// an open Q vector–E map goes back to the Constant E map.
function syncLambdaHalfSlider(){
  const on=!!$('lambdaHalf')?.checked;
  for(const id of ['hwSlider','hwEntry']){ const el=$(id); if(el) el.disabled=on; }
  let analyzerFree=false;
  try{ analyzerFree=instrumentIsElasticOnly(currentInstrument()); }catch(_e){}
  const vectorTab=$('qeMapTabVector');
  if(vectorTab){
    vectorTab.disabled=analyzerFree || on;
    vectorTab.title=analyzerFree ? 'Not available without an analyzer or for 4-circle.' : on ? 'Not available with λ/2 (only elastic).' : '';
  }
  if(on && !$('qeVectorMapPane')?.classList.contains('hidden')) setQEMapTab('constant');
}
$('lambdaHalf')?.addEventListener('change',syncLambdaHalfSlider);
function syncAnalyzerFreeUI(){
  let analyzerFree=false;
  try{ analyzerFree=instrumentIsElasticOnly(currentInstrument()); }catch(_e){}
  const single=checkedValue("sampleMode")==="single";
  // Control row: Save figure always; the ħω card for TAS single crystal,
  // the W card (syncQEWControl) and the spurion warning for single crystal
  // with energy transfer (no spurion at ħω = 0: the W slider takes the row).
  $('hwEntry')?.closest('.qe-range-control')?.classList.toggle('hidden',analyzerFree || !single);
  if(!single) $('qeWCard')?.classList.add('hidden');
  document.querySelector('#qeRangeControlGrid .qe-spurion-cell')?.classList.toggle('hidden',!single || analyzerFree);
  $('qeRangeControlGrid')?.classList.toggle('qe-no-spurion',!single || analyzerFree);
  for(const id of ['geomHW','powderGeomHW']) $(id)?.closest('label')?.classList.toggle('hidden',analyzerFree);
  for(const id of ['geomSliderHW','powderSliderHW']) $(id)?.closest('.geometry-slider-row')?.classList.toggle('hidden',analyzerFree);
  $('geomHW')?.closest('.grid4')?.classList.toggle('geometry-target-no-hw',analyzerFree);
  $('powderGeometryTarget')?.classList.toggle('powder-target-no-hw',analyzerFree);
  // Without an analyzer the Q vector–E map tab stays in place, greyed out,
  // and so do the path tools (the path is kept but not drawn).
  setQEPathAvailable(!analyzerFree);
  const vectorTab=$('qeMapTabVector');
  if(vectorTab){
    vectorTab.classList.toggle('hidden',!single);
    vectorTab.disabled=analyzerFree;
    vectorTab.title=analyzerFree ? 'Not available without an analyzer or for 4-circle.' : '';
  }
  if((!single || analyzerFree) && !$('qeVectorMapPane')?.classList.contains('hidden')) setQEMapTab('constant');
  syncLambdaHalfSlider();
  if(!analyzerFree) return;
  const lambdaHalf=$('lambdaHalf');
  if(lambdaHalf?.checked){ lambdaHalf.checked=false; lambdaHalf.dispatchEvent(new Event('change',{bubbles:true})); }
  for(const id of ['geomHW','powderGeomHW']){
    const el=$(id);
    if(el && Number(el.value)!==0){ el.value='0'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
  }
  const hwEntry=$('hwEntry');
  if(hwEntry && Number(hwEntry.value)!==0){ hwEntry.value='0'; hwEntry.dispatchEvent(new Event('change',{bubbles:true})); }
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
const orientationMode=fallback=>$('orientationReference')?.value || fallback;
function updateOrientationReferenceUI(){
  const mode=orientationMode('bragg');
  $('braggReferenceInputs')?.classList.toggle('hidden',mode!=='bragg');
  updateBraggOrientationPlaneWarning();
}

// UI-only validation for Sample orientation > Bragg peak position.
// Reuse the same reciprocal-space plane test already used by Time estimate;
// this does not alter TAS/Q-E/Resolution/Dark-angle calculations.
function updateBraggOrientationPlaneWarning(){
  updateBraggPeakCheck();
  const box=$('braggPlaneWarning');
  if(!box) return;
  const mode=orientationMode('bragg');
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

// Sample orientation > Bragg peak position: peak 1 sets the orientation;
// peak 2 (shown with Add, hidden with Remove) is only checked.  Its S1 calculated with the current U, V (elastic,
// as Angle calculation shows it; φ on a four-circle instrument) is compared
// with the observed one.  About 180° apart means the U-V plane is mirrored
// (e.g. (0,-1,0) was used as (0,1,0) when the UB matrix was made): swapping
// U and V fixes it.  Nothing is changed automatically.
const BRAGG_CHECK_TOL=5;   // deg: "agrees" and "about 180° apart"
function updateBraggPeakCheck(){
  const box=$('braggCheckMessage');
  if(!box) return;
  const show=(text,state='')=>{ box.textContent=text; if(state) box.dataset.state=state; else delete box.dataset.state; };
  const s1Box=$('refs1');
  if(s1Box) s1Box.placeholder='';
  if(orientationMode('bragg')!=='bragg' || checkedValue('sampleMode')!=='single') return show('');
  const elasticAngles=hkl=>{
    const energyMode=$('energyMode')?.value, E=num('energy');
    const cache=singleCache || {energyMode,Ei:E,Ef:E};
    return qeGeometryAngles(cache,null,{h:hkl[0],k:hkl[1],l:hkl[2],hw:0}).angles;
  };
  if(String(s1Box?.value??'').trim()===''){
    // Show (in grey) the S1 at which peak 1 sits with ki ⟂ U, the
    // orientation used while the box is empty.
    try{
      const a=elasticAngles([num('refh'),num('refk'),num('refl')]);
      const v=Number(currentInstrument()?.instrument_type==='four-circle' && a.fourCircle ? a.fourCircle.phi : a.s1);
      if(Number.isFinite(v)) s1Box.placeholder=v.toFixed(2);
    }catch(_e){}
    return show('Peak 1 S1 empty: ki ⟂ U used','info');
  }
  // Peak 2 is optional; until it is complete the line keeps its place (in grey).
  const pending=()=>show('Peak 2 off by –°','pending');
  const raw=['refh2','refk2','refl2','refs12'].map(id=>String($(id)?.value??'').trim());
  if(raw.some(v=>v==='')) return pending();
  const hkl=[num('refh2'),num('refk2'),num('refl2')], observed=num('refs12');
  if(![...hkl,observed].every(Number.isFinite)) return pending();
  const plane=hklInCurrentScatteringPlane(hkl);
  if(!plane.ok) return show('Peak 2 is out of the U-V plane','warn');
  let predicted=NaN;
  try{
    const a=elasticAngles(hkl);
    const fourCircle=currentInstrument()?.instrument_type==='four-circle' && !!a.fourCircle;
    predicted=Number(fourCircle ? a.fourCircle.phi : a.s1);
  }catch(_e){}
  if(!Number.isFinite(predicted)) return show('Peak 2 cannot be reached','warn');
  const off=Math.abs(((observed-predicted)%360+540)%360-180);
  const by=`Peak 2 off by ${off.toFixed(1)}°`;
  if(off<=BRAGG_CHECK_TOL) return show(`${by}: OK`);
  if(off>=180-BRAGG_CHECK_TOL) return show(`${by}: flip U and V`,'warn');
  return show(`${by}: check hkl or lattice`,'warn');
}

// Reset for a new experiment: peak 1 = U, peak 2 = V, both S1 empty (the
// orientation is ki ⟂ U until the S1 of peak 1 is entered).
function resetBraggPeaks(){
  const U=['Uh','Uk','Ul'].map(id=>$(id)?.value??'0'), V=['Vh','Vk','Vl'].map(id=>$(id)?.value??'0');
  const values={refh:U[0],refk:U[1],refl:U[2],refs1:'',refh2:V[0],refk2:V[1],refl2:V[2],refs12:''};
  for(const [id,value] of Object.entries(values)){
    const el=$(id); if(!el) continue;
    el.value=value; el.dataset.lastValid=value;
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  updateBraggOrientationPlaneWarning();
}

function updateGeometryQuickTargetButtons(){
  const mode=orientationMode('perpU');
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
  const showDark=!fourCircle;
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
    const visible=showDark && !!$(ids.se)?.value && checkedValue(ids.ref)==='Reference Q';
    button.classList.toggle('hidden',!visible);
  }
}


// Static JSON/CIF directory loading is implemented in data-loader.js.

// The materials of a Background materials row (no empty choice: Remove
// deletes the row).
function refreshBackgroundSelect(select){
  select.innerHTML="";
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
      op.textContent=obj.__label || obj.name || key;
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
  // Powder has no sample-orientation degree of freedom. Keep the common
  // Instrument configuration layout, but make the S1 limits read-only in
  // practice by disabling their entry boxes only while Powder is selected.
  if($("S1min")) $("S1min").disabled=!single;
  if($("S1max")) $("S1max").disabled=!single;
  $("lambdaHalf")?.closest("label")?.classList.remove("hidden");

  // Q-E Range uses one shared two-column workspace for Single crystal and Powder.
  // Only the left plot and the Angle-calculation target controls change with mode;
  // Time estimate and the TAS-geometry card remain in the same place and size.
  $("singlePlot")?.classList.toggle("hidden",!single);
  $("powderPlot")?.classList.toggle("hidden",single);
  $("qeMapTabVector")?.classList.toggle("hidden",!single);
  // Powder has a single map and no HKL path: hide the map tabs and the
  // HKL path box of the Constant E map.
  document.querySelector('#qePanel .qe-map-tabs')?.classList.toggle("hidden",!single);
  document.querySelector('#qeConstantMapPane .qe-constant-path-input')?.classList.toggle("hidden",!single);
  if(!single && !$('qeVectorMapPane')?.classList.contains('hidden')) setQEMapTab('constant');
  updateGeometryTargetVisibility();
  // Control row, map tabs, ħω controls: also by instrument type.
  syncAnalyzerFreeUI();
  document.querySelector('.nuclear-label-control')?.classList.toggle('hidden',!single);
  $('qePlotLegend')?.classList.toggle('hidden',!single);
  // The F_N / F_M scale row serves both maps (visibility follows the CIF).
  // Powder has its own clickable legend below the Q–E plot.
  $('qePowderLegend')?.classList.toggle('hidden',single);
  if(!single) syncPowderLinkedInputs();
  updateCifUI();
  requestAnimationFrame(scheduleVisiblePlotResize);
}


function qeGeometryAngles(cache, uiSenseOverride=null, calcOverride=null){
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
  const angles=tasMotorAngles(calc,b);
  const Ei=cache.energyMode==="Ei fixed" ? cache.Ei : cache.Ef+calc.hw;
  const Ef=cache.energyMode==="Ei fixed" ? cache.Ei-calc.hw : cache.Ef;
  return {calc,angles,Ei,Ef,ki:Math.sqrt(Ei/2.072),kf:Math.sqrt(Ef/2.072)};
}



// Instrument, Type and Set default keep the Resolution scan shown (the table
// gives the conditions of each point); Calculate is marked for the new
// settings.  A diffractometer has no Resolution: its results are cleared
// when the Resolution panel recalculates.
function markResolutionScanStale(){ $("calcScanResolution")?.classList.add("needs-calc"); }
$("instrument").addEventListener("change",()=>{
  markResolutionScanStale();
  applyInstrumentDefaults();
  updateInstrumentTypeRows();
  scheduleRecalc();
});
// Set default (the selected type is kept):
//   Instrument configuration -> the sidebar settings (beam, Sense, crystals,
//   motor limits); Instrument details -> the Resolution instrument parameters.
function saveAfterInstrumentReset(){
  saveLeftPanelState?.();
  saveRightPanelState?.();
  saveGlobalUIState?.();
  scheduleRecalc();
}
$("instrumentSetDefault")?.addEventListener("click",()=>{
  markResolutionScanStale();
  applyInstrumentConfigurationDefaults();
  updateInstrumentTypeRows();
  saveAfterInstrumentReset();
});
$("instrumentDetailsSetDefault")?.addEventListener("click",()=>{
  markResolutionScanStale();
  applyInstrumentDetailDefaults();
  saveAfterInstrumentReset();
});
// TAS / 4-circle / Diffractometer: only the type-dependent settings change.
for(const id of ['phiSign','chiSign','phiMin','phiMax','chiMin','chiMax','S2maxEffective','M2min','M2max','A2min','A2max','msign','asign']) $(id)?.addEventListener('change',()=>scheduleRecalc());
$('s1sign')?.addEventListener('change',updateS2SignDisplay);
for(const id of ['sense','s1sign']) $(id)?.addEventListener('change',()=>syncS2FieldSigns());
for(const id of ['msign','asign']) $(id)?.addEventListener('change',()=>syncM2FieldSigns());
$("instrumentType")?.addEventListener("change",()=>{
  markResolutionScanStale();
  applyInstrumentTypeChange();
  updateInstrumentTypeRows();
  scheduleRecalc();
});
// Analyzer "none" / a crystal (sidebar Ana, linked): 2-axis or 3-axis.
$("anaCrystal")?.addEventListener("change",()=>{
  markResolutionScanStale();
  syncAnalyzerMode();
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
installNumericInputGuard(parseNumericValue);


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
  $("geometryTabAngles")?.click();
  saveRightPanelState?.();
  saveGlobalUIState?.();
  scheduleRecalc();
});

document.querySelectorAll("input,select").forEach(el=>{
  if(el.closest?.('.time-estimate-pane')) return;
  // Display controls of the Resolution results (Show, Graph, colours, the
  // scan slider): they redraw, no recalculation.
  if(el.closest?.('#result')) return;
  if([
    "instrument",
    "seSelect","seSelect2","seSelect3",
    ...BACKGROUND_SLOTS.map(slot=>slot.id),
    "hwSlider",
    "scanSlider",
    // Display frame of the Resolution results: redraws, no recalculation.
    "resolutionCoordinates","resolutionUVView","resolutionScanGraph",
    'qeVectorHKLPath','qePathHKLConstant','qePathSnap',
    // Peak 2 of the Bragg-peak orientation is only checked (no recalculation).
    'refh2','refk2','refl2','refs12'
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
  $, PI, RL_calc, UB_calc, add, backgroundColor, backgroundMaterials, backgroundPowderPeaks,
  calcQ0, centeringFromSpaceGroup:(...args)=>centeringFromSpaceGroup(...args), checkedValue, clamp, currentInstrument,
  deg2rad, dot, effectiveOrientationReference, effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL,
  getDarkAssets, getSelectedCifFileName:()=>selectedCifFileName,
  getNuclearCifStructure:()=>nuclearStructureForSelectedCif?.() ?? null,
  getMagneticPeakIntensities:qMax=>magneticPeakIntensities?.(qMax) ?? null,
  hklToQ, isAllowedByCentering, latticeParams, linspace, makeSpiceScatteringPlaneBasis, norm,
  nuclearStructureFactorSquared, num, rad2deg, energyTransferRange, energyTransferGrid, rebuildGeometryMatchedDarkPolygons,
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
  inferOutOfPlaneHKL, latticeParams,
  linspace, markResolutionScanDirty, norm, num, parseNumericValue, powderS2ForQAtHW,
  propagationVectorIndices, rad2deg,
  scheduleRecalc, selectedS1Sign, selectedTasSense, tasConvention, tasConventionFromLegacyUiSense, userFacingTasMessage
}));

({
  geometryPointWarnings,
  updateGeometryTargetVisibility,
  renderGeometry
}=createTasGeometryView({
  $, angleDiffDeg, checkedValue, clamp,
  currentInstrument, deg2rad, directBeamOrientationCorrection, dot, effectiveOrientationReference, effectiveS2MaxAtEi,
  formatAngle, hklToQ, linspace,
  makeSpiceScatteringPlaneBasis, norm, num, powderGeometryTarget, qeDarkBlockWarningsForHKLE,
  qeGeometryAngles, rad2deg, scatteringPlaneWarningMessage:(...args)=>scatteringPlaneWarningMessage(...args),
  selectedS1Sign, selectedTasSense, setScatteringPlaneWarning:(...args)=>setScatteringPlaneWarning(...args),
  tasConvention, qeSpurionWarnings, userFacingTasMessage,
  syncGeometrySliders:(...args)=>{ geometrySliders?.syncGeometrySliders(...args); powderSliders?.syncPowderSliders(); },
  updateGeometryTargetMarker:(...args)=>updateGeometryTargetMarker(...args)
}));
// U / V / hbar-omega sliders of Angle calculation & TAS geometry (Single).
geometrySliders=createGeometrySliders({
  $, checkedValue, collectResolutionBase:(...args)=>collectResolutionBase(...args), getSingleCache:()=>singleCache,
  hklToQ, makeSpiceScatteringPlaneBasis, norm, dot, num,
  renderGeometryNow:()=>{ if(singleCache && checkedValue('sampleMode')==='single') renderGeometry(singleCache,Number($('hwSlider')?.value)||0); },
  syncMapHWFromTarget:()=>syncMapHWFromTarget(),
  syncMapWFromTarget:(w)=>syncMapWFromTarget(w)
});
geometrySliders.bindGeometrySliders();
// hbar-omega / Q / S2 sliders of Angle calculation & TAS geometry (Powder).
powderSliders=createPowderGeometrySliders({
  $, checkedValue, parseNumericValue,
  powderWavevectors:(...args)=>powderWavevectors(...args),
  setPowderLinkDriver:(...args)=>setPowderLinkDriver(...args),
  syncPowderLinkedInputs:(...args)=>syncPowderLinkedInputs(...args),
  hwRange:()=>{
    const energyMode=$('energyMode').value, E=num('energy');
    return energyTransferRange(currentInstrument(),energyMode==='Ef fixed'?{energyMode,Ef:E}:{energyMode,Ei:E});
  },
  renderGeometryNow:()=>{ if(powderCache && checkedValue('sampleMode')==='powder') renderGeometry(powderCache,0); }
});
powderSliders.bindPowderSliders();
// Resolution › Convolution: dispersion table convolved with the TAS resolution.
const convolutionUI=createConvolutionUI({
  $, calcResolution, setStatus, parseNumericValue,
  collectResolutionBase:(...args)=>collectResolutionBase(...args)
});
convolutionUI.bindConvolutionUI();
// Sample › Dispersion: a dispersion table or a 2D slice on the Q-E maps.
initDispersionOverlay({
  parse2DText:convolutionUI.parse2DText,
  applyFileSettings:convolutionUI.applyFileSettings,
  rerender:()=>{ if(singleCache && checkedValue('sampleMode')==='single') renderSingle(singleCache,Number($('hwSlider')?.value)||0); }
});

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
  initializeCifGenerator,
  nuclearStructureForSelectedCif,
  magneticPeakIntensities,
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
  enableRightPanelPersistence,
  saveGlobalUIState,
  restoreGlobalUIState,
  enableGlobalUIPersistence,
  saveLeftPanelState,
  restoreLeftPanelState
}=createUIShell({
  $, BACKGROUND_SLOTS, add, applyInstrumentDefaults, applyInstrumentTypeChange,
  applySampleEnvironmentDefaults, backgroundRowValues, buildResolutionLattice, checkedValue, currentGeometryCardTab,
  darkAssetIds, darkAssetSlots, darkAssetValues, darkCustomSettings, restoreDarkCustomSettings, markResolutionScanDirty,
  mountTimeEstimateForScript, propagationVectorValues, refreshDarkEnvironmentSelect, renderGeometry, renderQEVectorMap,
  renderResolutionScan, renderSingle, replaceBackgroundRows, replaceDarkAssets, replacePropagationVectors,
  resolutionPanelIsVisible, scheduleRecalc, selectedS1Sign, setBackgroundCount, setDarkAssetCount,
  setDarkRangeCount, setGeometryCardTab, setPropagationVectorCount,
  setQEMapTab, updateAutoW, updateBackgroundSelectAvailability, updateDarkReferenceUI,
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
  redrawPowder,
  applyInstrumentCrystalAvailability, applyInstrumentDefaults,
  backgroundMaterials, bindResolutionManualCalculation:(...args)=>bindResolutionManualCalculation(...args),
  bindToolboxUI:(...args)=>bindToolboxUI(...args),
  clearSelectedCif:(...args)=>clearSelectedCif(...args),
  currentGeometryCardTab:(...args)=>currentGeometryCardTab(...args), darkAssetSlots,
  doScanResolution:(...args)=>doScanResolution(...args),
  enableGlobalUIPersistence:(...args)=>enableGlobalUIPersistence(...args),
  enableRightPanelPersistence:(...args)=>enableRightPanelPersistence(...args),
  fillCrystal,
  flipScatteringPlaneUV:(...args)=>flipScatteringPlaneUV(...args),
  initializeCifGenerator:(...args)=>initializeCifGenerator(...args), initializeNeutronData,
  initializeResponsivePlotResize:(...args)=>initializeResponsivePlotResize(...args),
  initializeScriptWorkspaceUI:(...args)=>initializeScriptWorkspaceUI(...args),
  initializeSidebarCrystalSelectors, instruments, legacyRangeInstruments, nearestHWIndex,
  addLocalInstruments,
  prepareToolboxUI:(...args)=>prepareToolboxUI(...args), qeCommitPathText,
  qeDefaultPathText, qePathInput, recalculate,
  refreshCifAfterStateRestore:(...args)=>refreshCifAfterStateRestore(...args),
  refreshSelect,
  renderResolutionScan:(...args)=>renderResolutionScan(...args), renderSingle,
  restoreGlobalUIState:(...args)=>restoreGlobalUIState(...args),
  restoreLeftPanelState:(...args)=>restoreLeftPanelState(...args),
  restoreRightPanelState:(...args)=>restoreRightPanelState(...args), sampleEnvironments,
  savedActiveTab:(...args)=>savedActiveTab(...args),
  saveGlobalUIState:(...args)=>saveGlobalUIState(...args),
  saveLeftPanelState:(...args)=>saveLeftPanelState(...args),
  saveRightPanelState:(...args)=>saveRightPanelState(...args),
  selectCifFile:(...args)=>selectCifFile(...args), setActiveTab:(...args)=>setActiveTab(...args),
  setGeometryTargetHKL,
  setPowderLinkDriver:(...args)=>setPowderLinkDriver(...args), setQEMapTab,
  setTargetHWFromMap, syncGeometryTargetToOrientationReference,
  syncPowderLinkedInputs:(...args)=>syncPowderLinkedInputs(...args), syncQEPathSnapDefault,
  syncSfColorMaxControl:(...args)=>syncSfColorMaxControl(...args), syncSidebarCrystalSelectors,
  updateAutoW:(...args)=>updateAutoW(...args), updateBraggOrientationPlaneWarning, resetBraggPeaks, updateCalcMode:(...args)=>updateCalcMode(...args),
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
