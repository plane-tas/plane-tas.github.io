// Resolution: coordinate frames, lattice / W, and the instrument and sample inputs (collectResolutionBase, calcOne).
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
import {calcDiffractionResolution, calcFourCircleAnalyzerResolution} from '../resolution-core.js';
import {instrumentHasAnalyzer, instrumentIsElasticOnly} from '../../app/analyzer-mode.js';
export function installResolutionInputs(ctx){
  const {deps:{
    $, RLRes, calcResolution, currentInstrument, inferOutOfPlaneHKL, latticeParams, num,
    scheduleRecalc, selectedS1Sign, selectedTasSense, tasConvention, tasMotorAngles,
    userFacingTasMessage
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    buildResolutionLattice, calcOne, clearResolutionResults, collectResolutionBase,
    flipScatteringPlaneUV, formatResolutionCoordinate, matrixText,
    resolutionCoordinates, resolutionFrame, resolutionIsDiffraction, resolutionIsFourCircle, resolutionIsTwoAxis, resolutionIsUnavailable, traceEllipse, updateAutoW
  });

shared.scanResults=[];
shared.scanResolutionPlotLimits=null;
shared.lastResolutionRender=null;
// Display frame: 'q' (Q∥, Q⊥in, E, Q⊥out) or 'lattice' (U, V, E, W). The
// core's own U, U⊥in, E, U⊥out frame is not offered as a display frame (it
// remains in Copy matrices); any other saved value falls back to 'q'.
function resolutionCoordinates(){
  // (4-circle: U, V, W are the crystal directions at the point's chi, phi.)
  return $('resolutionCoordinates')?.value==='lattice' ? 'lattice' : 'q';
}
// Results of one calculation in the chosen frame (same fields as the core's
// orthogonal result: display, lim, ellipses, displayAxes, qNorms).
function resolutionFrame(r){
  const c=resolutionCoordinates();
  if(c==='lattice' && r?.lattice) return r.lattice;
  if(c==='q' && r?.qframe) return r.qframe;
  return r;
}
// Lattice U–V plot: 'shape' keeps the true ellipse shape and tilts the V
// axis; 'coefficients' plots the U and V coefficients on square axes.
shared.RESOLUTION_UV_VIEW_KEY='tas-resolution-uv-view-v1';
shared.resolutionUVView=(()=>{ try{ return localStorage.getItem(shared.RESOLUTION_UV_VIEW_KEY)==='coefficients'?'coefficients':'shape'; }catch(_e){ return 'shape'; } })();
function resolutionIsUnavailable(){
  // Every instrument type has a resolution: TAS (Cooper-Nathans / Popovici)
  // and, analyzer-free, the diffractometer and the 4-circle (elastic,
  // Cooper-Nathans).  Kept as a hook for the callers.
  return false;
}
// Q-only resolution (no energy axis): no analyzer (diffractometer, Ana =
// none).  A 4-circle with the analyzer has the TAS (4D) resolution at ħω = 0.
function resolutionIsDiffraction(){
  try{ return !instrumentHasAnalyzer(currentInstrument()); }catch(_err){ return false; }
}
// Only ħω = 0: no analyzer, or 4-circle.
function resolutionIsElasticOnly(){
  try{ return instrumentIsElasticOnly(currentInstrument()); }catch(_err){ return false; }
}
// 2-axis (no analyzer): the detector takes every final energy.
function resolutionIsTwoAxis(){
  try{ return !instrumentHasAnalyzer(currentInstrument()); }catch(_err){ return false; }
}
function resolutionIsFourCircle(){
  try{ return currentInstrument()?.instrument_type==='four-circle'; }catch(_err){ return false; }
}
function clearResolutionResults(){
  shared.scanResults=[];
  shared.scanResolutionPlotLimits=null;
  $('result')?.classList.add('hidden');
  $('scanNav')?.classList.add('hidden');
  if($('summary')) $('summary').textContent='';
  if($('matrix')) $('matrix').textContent='';
  if($('resolutionAngleWarning')) $('resolutionAngleWarning').hidden=true;
  $('calcScanResolution')?.classList.remove('needs-calc');
}
function formatAutoHKL(v){return v.map(x=>{if(Math.abs(x)<1e-10)return '0';const r=Math.round(x);if(Math.abs(x-r)<1e-10)return String(r);return Number(x.toPrecision(6)).toString();}).join(', ');}
function buildResolutionLattice(){
  const lc={...latticeParams(),sv1:[num('Uh'),num('Uk'),num('Ul')],sv2:[num('Vh'),num('Vk'),num('Vl')]};
  const rl=RLRes(lc);
  // Preserve the entered U/V order exactly.  Their order defines the
  // scattering-plane handedness used by W, UB, TAS geometry and resolution.
  lc.sv3=inferOutOfPlaneHKL(rl,lc.sv1,lc.sv2);
  $('Wauto').textContent=`auto: (${formatAutoHKL(lc.sv3)})`;
  return {lc,rl};
}
function updateAutoW(){try{buildResolutionLattice();}catch(_e){if($('Wauto'))$('Wauto').textContent='auto: unavailable';}}
function flipScatteringPlaneUV(){
  const idsU=['Uh','Uk','Ul'], idsV=['Vh','Vk','Vl'];
  const u=idsU.map(id=>$(id).value);
  const v=idsV.map(id=>$(id).value);
  idsU.forEach((id,i)=>{$(id).value=v[i];});
  idsV.forEach((id,i)=>{$(id).value=u[i];});
  updateAutoW();
  scheduleRecalc();
}
function collectResolutionBase(){
  const {lc,rl}=buildResolutionLattice(), em=$('energyMode').value,E=num('energy');
  const convention=tasConvention(selectedTasSense(),selectedS1Sign());
  const config={
    energy_mode:em,Ei:em==='Ei fixed'?E:null,Ef:em==='Ef fixed'?E:null,
    sense:convention.sense,s1sign:convention.s1sign,
    // Retained only for compatibility with untouched peripheral code.
    sign_config:convention.sense
  };
  const approximation={method:$('method').value};
  const focusing={monochromator:{horizontal:{enabled:$('monoHF').checked,blades:num('monoHB')},vertical:{enabled:$('monoVF').checked,blades:num('monoVB')}},analyzer:{horizontal:{enabled:$('anaHF').checked,blades:num('anaHB')},vertical:{enabled:$('anaVF').checked,blades:num('anaVB')}}};
  const col={gm_1st:$('gm1').checked,div_1st_m:num('div1m'),div_1st_h:num('div1h'),div_1st_v:num('div1v'),div_2nd_h:num('div2h'),div_2nd_v:num('div2v'),div_3rd_h:num('div3h'),radial_3rd:$('coll3Type')?.value==='radial',div_3rd_v:num('div3v'),div_4th_h:num('div4h'),div_4th_v:num('div4v')};
  const mos={d_mono:num('dMono'),mos_mono_h:num('mosMonoH'),mos_mono_v:num('mosMonoV'),mos_sam_h:num('mosSamH'),mos_sam_v:num('mosSamV'),d_ana:num('dAna'),mos_ana_h:num('mosAnaH'),mos_ana_v:num('mosAnaV')};
  // Distances are entered in m, component sizes in cm; the core works in m.
  const cm=id=>num(id)/100;
  const geom={L0:num('L0'),L1:num('L1'),L2:num('L2'),L3:num('L3'),
    beam_width:cm('srcWcm'),beam_height:cm('srcHcm'),beam_shape:$('sourceShape')?.value==='circle'?'circle':'rectangle',
    mono_width:cm('monoWcm'),mono_height:cm('monoHcm'),mono_thickness:cm('monoTcm'),
    sample_shape:$('sampleShape')?.value==='cylinder'?'cylinder':'box',
    sample_u:cm('sampleUcm'),sample_v:cm('sampleVcm'),sample_diameter:cm('sampleDcm'),sample_height:cm('sampleHcm'),
    ana_width:cm('anaWcm'),ana_height:cm('anaHcm'),ana_thickness:cm('anaTcm'),
    det_width:cm('detWcm'),det_height:cm('detHcm'),det_shape:$('detectorShape')?.value==='rectangle'?'rectangle':'cylinder'};
  if(currentInstrument()?.instrument_type==='diffractometer'){
    // Analyzer-free diffraction instruments have no PG analyzer.  The existing
    // TAS-only Cooper-Nathans/Popovici model still requires an analyzer slot:
    // use the CURRENT monochromator settings there as a clearly provisional
    // mathematical proxy, including its mosaic, focusing and dimensions.
    // Never read hidden/stale PG analyzer fields for a diffractometer.
    mos.d_ana=mos.d_mono;
    mos.mos_ana_h=mos.mos_mono_h;
    mos.mos_ana_v=mos.mos_mono_v;
    focusing.analyzer={
      horizontal:{...focusing.monochromator.horizontal},
      vertical:{...focusing.monochromator.vertical}
    };
    geom.ana_width=geom.mono_width;
    geom.ana_height=geom.mono_height;
    geom.ana_thickness=geom.mono_thickness;
  }
  // No analyzer: the sample-detector distance (L4) takes the place of L2.
  if(resolutionIsTwoAxis() && num('sampleDetectorDistance')>0) geom.L2=num('sampleDetectorDistance');
  // Four-circle (Eulerian cradle) instruments: the angle calculation adds
  // chi / phi (bisecting mode) and accepts out-of-plane Q.
  let fourCircle=false;
  try{ fourCircle=currentInstrument()?.instrument_type==='four-circle'; }catch(_e){}
  return {lc,rl,col,mos,config,approximation,focusing,geom,unitMode:$('unit').value,fourCircle};
}
// wrap180() / angleDiffDeg() are provided by tas-conventions.js.


function calcOne(calc){
  const b=collectResolutionBase();
  // An unspecified monochromator (e.g. the minimal HB-2D instrument files)
  // must not silently inherit the previous instrument's PG crystal.
  if(currentInstrument()?.instrument_type==='diffractometer' &&
     (!$('monoCrystal')?.value || !(b.mos.d_mono>0))) {
    throw new Error('Resolution unavailable: this diffractometer has no configured monochromator crystal/d-spacing. Specify it in the instrument JSON.');
  }
  // TAS: a blank collimator means "none" (geometry-limited).  Diffractometer
  // JSONs leave unknown values blank, so without an analyzer a blank stays an
  // error.
  if(resolutionIsTwoAxis() &&
     (b.col.gm_1st ? [] : ['div_1st_h','div_1st_v']).concat(['div_2nd_h','div_2nd_v','div_3rd_h','div_3rd_v']).some(k=>!(b.col[k]>0))) {
    throw new Error('Collimation and crystal mosaic values must be non-zero for the resolution calculation.');
  }

  // Resolution sense convention:
  // The resolution core already defines the physical +-+ / -+- branches.
  // Pass the physical Sense directly. Angle/Q-E/TAS geometry now use the same
  // Sense + S1-sign convention object instead of a legacy calculation label.
  // Resolution depends on physical scattering Sense, not on the sample motor
  // encoder polarity.  Deliberately omit s1sign from the resolution config.
  const {...resolutionBaseConfig}=b.config;
  const resolutionConfig={...resolutionBaseConfig,sense:selectedTasSense(),sign_config:selectedTasSense()};
  // Elastic only (ħω = 0).  No analyzer: 2-axis Cooper-Nathans.  4-circle
  // with the analyzer: the TAS resolution at ħω = 0 in the Q frame.
  if(resolutionIsElasticOnly()) calc={...calc,hw:0};
  const result=resolutionIsTwoAxis()
    ? calcDiffractionResolution(b.lc,b.rl,b.col,b.mos,resolutionConfig,b.geom,calc,b.unitMode,{fourCircle:resolutionIsFourCircle()})
    : resolutionIsFourCircle()
      ? calcFourCircleAnalyzerResolution(b.lc,b.rl,b.col,b.mos,resolutionConfig,b.approximation,b.focusing,b.geom,calc,b.unitMode)
      : calcResolution(b.lc,b.rl,b.col,b.mos,resolutionConfig,b.approximation,b.focusing,b.geom,calc,b.unitMode);
  let angles;
  try{
    angles=tasMotorAngles(calc,b);
  }catch(err){
    // Angle calculation is supplemental.  Do not hide a valid resolution
    // result just because motor angles cannot be determined.
    angles={m1:null,m2:null,s1:null,s2:null,a1:null,a2:null,
      warning:`Angle calculation unavailable: ${userFacingTasMessage(err?.message || String(err))}`};
  }
  return {calc,...b,result,angles};
}
function matrixText(M){return M.map(r=>'[ '+r.map(x=>Number(x).toExponential(6).padStart(14)).join('  ')+' ]').join('\n');}
function formatResolutionCoordinate(v){
  if(!Number.isFinite(v)) return '';
  // A trigonometric ellipse often contains -1e-17 at a nominal zero crossing.
  return Math.abs(v)<1e-12?'0':Number(v.toPrecision(5)).toString();
}
function traceEllipse(p,name,dash='solid'){
  return {
    x:p.x,y:p.y,mode:'lines',name,line:{dash},
    // Report the curve's coordinates, with floating-point noise near zero
    // suppressed only in the displayed values, not in the plotted points.
    customdata:p.x.map((x,i)=>[formatResolutionCoordinate(x),formatResolutionCoordinate(p.y[i])]),
    // First hover line: the curve's name (e.g. "#1 coherent").
    hovertemplate:`${name}<br>X: %{customdata[0]}<br>Y: %{customdata[1]}<extra></extra>`
  };
}
}
