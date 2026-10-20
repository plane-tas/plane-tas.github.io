import {displayedMotorAngles} from '../core/tas-conventions.js';

// Extracted from app.js without changing calculation/display behavior.
// Dependencies are injected by app.js to keep module boundaries explicit.
export function createResolutionUI(deps){
  const {
    $,
    tasMotorAngles,
    PI,
    RLRes,
    add,
    calcResolution,
    checkedValue,
    clamp,
    clearError,
    currentInstrument,
    deg2rad,
    hklInCurrentScatteringPlane,
    hklToQ,
    inferOutOfPlaneHKL,
    latticeParams,
    linspace,
    markResolutionScanDirty,
    norm,
    num,
    parseNumericValue,
    powderS2ForQAtHW,
    propagationVectorIndices,
    rad2deg,
    scatteringPlaneWarningMessage,
    scheduleRecalc,
    selectedS1Sign,
    selectedTasSense,
    setScatteringPlaneWarning,
    showError,
    tasConvention,
    tasConventionFromLegacyUiSense,
    userFacingTasMessage,
  }=deps;

let scanResults=[];
let scanResolutionPlotLimits=null;
function resolutionIsUnavailable(){
  // updateCalcMode() calls this during startup before instrument JSON files
  // have been loaded.  An instrument is not selectable at that point.
  // Avoid aborting initialize() while still disabling TAS resolution once a
  // diffractometer has actually been selected.
  try{
    return currentInstrument()?.instrument_type==='diffractometer';
  }catch(_err){
    return false;
  }
}
function clearResolutionResults(){
  scanResults=[];
  scanResolutionPlotLimits=null;
  $('result')?.classList.add('hidden');
  $('scanNav')?.classList.add('hidden');
  if($('summary')) $('summary').textContent='';
  if($('matrix')) $('matrix').textContent='';
  $('calcScanResolution')?.classList.remove('needs-calc');
  $('calcSingleResolution')?.classList.remove('needs-calc');
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
    geometry:$('geometry').value,
    sense:convention.sense,s1sign:convention.s1sign,
    // Retained only for compatibility with untouched peripheral code.
    sign_config:convention.sense
  };
  const approximation={method:$('method').value};
  const focusing={monochromator:{horizontal:{enabled:$('monoHF').checked,blades:num('monoHB')},vertical:{enabled:$('monoVF').checked,blades:num('monoVB')}},analyzer:{horizontal:{enabled:$('anaHF').checked,blades:num('anaHB')},vertical:{enabled:$('anaVF').checked,blades:num('anaVB')}}};
  const col={gm_1st:$('gm1').checked,div_1st_m:num('div1m'),div_1st_h:num('div1h'),div_1st_v:num('div1v'),div_2nd_h:num('div2h'),div_2nd_v:num('div2v'),div_3rd_h:num('div3h'),div_3rd_v:num('div3v'),div_4th_h:num('div4h'),div_4th_v:num('div4v')};
  const mos={d_mono:num('dMono'),mos_mono_h:num('mosMonoH'),mos_mono_v:num('mosMonoV'),mos_sam_h:num('mosSamH'),mos_sam_v:num('mosSamV'),d_ana:num('dAna'),mos_ana_h:num('mosAnaH'),mos_ana_v:num('mosAnaV')};
  // Distances are entered in m, component sizes in cm; the core works in m.
  const cm=id=>num(id)/100;
  const geom={L0:num('L0'),L1:num('L1'),L2:num('L2'),L3:num('L3'),
    beam_width:cm('srcWcm'),beam_height:cm('srcHcm'),beam_shape:$('sourceShapeCircle')?.checked?'circle':'rectangle',
    mono_width:cm('monoWcm'),mono_height:cm('monoHcm'),mono_thickness:cm('monoTcm'),
    sample_diameter:cm('sampleDcm'),sample_height:cm('sampleHcm'),
    ana_width:cm('anaWcm'),ana_height:cm('anaHcm'),ana_thickness:cm('anaTcm'),
    det_width:cm('detWcm'),det_height:cm('detHcm'),det_shape:$('detectorShapeRect')?.checked?'rectangle':'cylinder'};
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
  return {lc,rl,col,mos,config,approximation,focusing,geom,unitMode:$('unit').value};
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
  // JSONs leave unknown values blank, so there a blank stays an error.
  if(currentInstrument()?.instrument_type==='diffractometer' &&
     ['div_1st_h','div_1st_v','div_2nd_h','div_2nd_v','div_3rd_h','div_3rd_v','div_4th_h','div_4th_v'].some(k=>!(b.col[k]>0))) {
    throw new Error('Collimation and crystal mosaic values must be non-zero for the resolution calculation.');
  }

  // Resolution sense convention:
  // The resolution core already defines the physical +-+ / -+- branches.
  // Pass the physical Sense directly. Angle/Q-E/TAS geometry now use the same
  // Sense + S1-sign convention object instead of a legacy calculation label.
  // Resolution depends on physical scattering Sense, not on the sample motor
  // encoder polarity.  Deliberately omit s1sign from the resolution config.
  const {s1sign:_s1signForMotorOnly,...resolutionBaseConfig}=b.config;
  const resolutionConfig={...resolutionBaseConfig,sense:selectedTasSense(),sign_config:selectedTasSense()};
  const result=calcResolution(b.lc,b.rl,b.col,b.mos,resolutionConfig,b.approximation,b.focusing,b.geom,calc,b.unitMode);
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
    hovertemplate:'X: %{customdata[0]}<br>Y: %{customdata[1]}<extra></extra>'
  };
}

// Resolution plots use explicit symmetric limits around the calculation point.
// A single Calc always resets to the current ellipse size so the ellipse cannot
// remain clipped by a viewport left over from an earlier calculation.  A Scan
// supplies limits precomputed over every scan point; those same limits are then
// reused for every slider position so the apparent ellipse evolution is not
// contaminated by changing plot scales.
// fonts: {title, axis, tick} sizes.  The Resolution tab keeps its large tick
// labels; the compact Angle calculation view passes smaller sizes.
const RESOLUTION_PLOT_FONTS={title:22,axis:20,tick:21};
// Major grid darker, minor grid lighter.
const RESOLUTION_MAJOR_GRID={showgrid:true,gridcolor:'#bcc4cd',gridwidth:1};
const RESOLUTION_MINOR_GRID={showgrid:true,gridcolor:'#e8ebee',gridwidth:1,ticks:''};
// Q axes: only three labelled ticks (-a, 0, a) with a round a, so the small
// δQ numbers are never crowded or rotated.  Minor grid lines subdivide a.
function resolutionQTicks(lim){
  const raw=0.8*Number(lim);
  if(!(raw>0) || !Number.isFinite(raw)) return {minor:{...RESOLUTION_MINOR_GRID}};
  const decade=Math.pow(10,Math.floor(Math.log10(raw)));
  const mantissa=[1,2,2.5,5,10].filter(m=>m*decade<=raw*(1+1e-9)).pop()||1;
  const a=Number((mantissa*decade).toPrecision(6));
  const divisions=Math.abs(mantissa-2)<1e-9 ? 4 : 5;
  return {tickmode:'array',tickvals:[-a,0,a],minor:{...RESOLUTION_MINOR_GRID,tickmode:'linear',tick0:0,dtick:a/divisions}};
}
function baseLayout(title,xlabel,ylabel,xlim,ylim,equal=false,plotId=null,fonts=RESOLUTION_PLOT_FONTS,yIsQ=false){
  const safe=(v,fallback=1)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):fallback;
  const xl=safe(xlim), yl=safe(ylim);
  return {
    uirevision:plotId||'resolutionPlots',
    title:{text:title,font:{size:fonts.title}},
    // Leave space below the x-axis title at native compact density.  An
    // automatic margin also accommodates longer axis names and mobile fonts.
    margin:fonts.margin || {l:88,r:22,t:52,b:94,autoexpand:true},
    // The card border and the plot axes serve different purposes: the plot
    // frame is confined to the data area; the card encloses each full chart.
    xaxis:{title:{text:xlabel,standoff:13,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},range:[-xl,xl],zeroline:true,...RESOLUTION_MAJOR_GRID,...resolutionQTicks(xl),showline:true,mirror:true,linecolor:'#586472',linewidth:1},
    yaxis:{title:{text:ylabel,standoff:12,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},range:[-yl,yl],zeroline:true,...RESOLUTION_MAJOR_GRID,...(yIsQ?resolutionQTicks(yl):{minor:{...RESOLUTION_MINOR_GRID}}),showline:true,mirror:true,linecolor:'#586472',linewidth:1,...(equal?{scaleanchor:'x',scaleratio:1}:{})},
    hovermode:'closest',hoverdistance:18,
    showlegend:false
  };
}

function resolutionPlotLimitsFromEntries(entries){
  const valid=Array.isArray(entries)?entries.filter(Boolean):[];
  if(!valid.length) return null;
  const maxLim=key=>{
    let m=0;
    for(const entry of valid){
      const v=Number(entry?.result?.lim?.[key]);
      if(Number.isFinite(v) && v>m) m=v;
    }
    return m>0?m:null;
  };
  const U=maxLim('U'), V=maxLim('V'), W=maxLim('W'), E=maxLim('E');
  return {U,V,W,E};
}
function formatAngle(value,absolute=false){
  if(value===null || value===undefined || !Number.isFinite(Number(value))) return '';
  const v=absolute ? Math.abs(Number(value)) : Number(value);
  return v.toFixed(3);
}

function formatResolutionAxis(v){
  return `(${v.map(x=>{
    const y=Number(x);
    return Math.abs(y-Math.round(y))<1e-10 ? String(Math.round(y)) : Number(y.toPrecision(6)).toString();
  }).join(', ')})`;
}
function resolutionDisplayAxes(r,lc){
  return r.displayAxes || {U:lc.sv1,V:lc.sv2,W:lc.sv3};
}
// One-line FWHM summary shared by the Resolution tab and Angle calculation.
// Values in parentheses are the coherent (slice) widths.
function resolutionWidthsHtml(r,unitMode,lc){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹';
  const ax=resolutionDisplayAxes(r,lc), fmtAxis=formatResolutionAxis;
  return `<b>Resolution</b> δQ//${fmtAxis(ax.U)}=${r.display.U.toFixed(4)} (${r.display.Ucoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.V)}=${r.display.V.toFixed(4)} (${r.display.Vcoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.W)}=${r.display.W.toFixed(4)} (${r.display.Wcoh.toFixed(4)}) ${qUnit}, `+
    `δℏω=${r.display.E.toFixed(4)} (${r.display.Ecoh.toFixed(4)}) meV`;
}
// Plotly's built-in double-click "reset" returns to the axis ranges of the
// plot's first draw (an earlier point), which looks like a random scale.
// Disable it and return to the ranges of the current calculation instead.
function reactResolutionPlot(id,traces,layout){
  const gd=$(id);
  if(!gd) return;
  gd.__tasResolutionView={x:layout.xaxis.range.slice(),y:layout.yaxis.range.slice()};
  Promise.resolve(Plotly.react(gd,traces,layout,{responsive:true,doubleClick:false}))
    .then(()=>installResolutionDoubleClick(gd))
    .catch(err=>console.warn('Resolution plot warning:',err));
}
function installResolutionDoubleClick(gd){
  if(!gd || typeof gd.on!=='function' || gd.__tasResolutionDoubleClick) return;
  gd.__tasResolutionDoubleClick=()=>requestAnimationFrame(()=>{
    const view=gd.__tasResolutionView;
    if(!view || !gd.isConnected) return;
    Plotly.relayout(gd,{
      'xaxis.range':view.x.slice(),'yaxis.range':view.y.slice(),
      'xaxis.autorange':false,'yaxis.autorange':false
    }).catch(err=>console.warn('Resolution plot reset:',err));
  });
  gd.on('plotly_doubleclick',gd.__tasResolutionDoubleClick);
}
const RESOLUTION_PLOT_IDS={UE:'plotUE',VE:'plotVE',UV:'plotUV',WE:'plotWE'};
// Draw the four projection/slice ellipse plots into the given plot elements.
function renderResolutionPlots(r,unitMode,lc,limits,ids=RESOLUTION_PLOT_IDS,fonts=RESOLUTION_PLOT_FONTS){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹';
  const ax=resolutionDisplayAxes(r,lc), fmtAxis=formatResolutionAxis;
  const qeTitle=v=>`δQ ∥ ${fmtAxis(v)} vs δℏω`;
  reactResolutionPlot(
    ids.UE,
    [traceEllipse(r.ellipses.projUE,'projection'),traceEllipse(r.ellipses.sliceUE,'slice','dash')],
    baseLayout(qeTitle(ax.U),`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,'δℏω (meV)',limits.U,limits.E,false,ids.UE,fonts),
  );

  reactResolutionPlot(
    ids.VE,
    [traceEllipse(r.ellipses.projVE,'projection'),traceEllipse(r.ellipses.sliceVE,'slice','dash')],
    baseLayout(qeTitle(ax.V),`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,'δℏω (meV)',limits.V,limits.E,false,ids.VE,fonts),
  );

  reactResolutionPlot(
    ids.WE,
    [traceEllipse(r.ellipses.projWE,'projection'),traceEllipse(r.ellipses.sliceWE,'slice','dash')],
    baseLayout(qeTitle(ax.W),`δQ ∥ ${fmtAxis(ax.W)} (${qUnit})`,'δℏω (meV)',limits.W,limits.E,false,ids.WE,fonts),
  );

  // Scattering-plane display scaling:
  // - r.l.u.: U and V are different reciprocal-lattice coordinates, so give
  //   each axis its own resolution range and do not force a 1:1 plot aspect.
  // - Å^-1: both axes are physical reciprocal-space lengths, so keep a common
  //   range and a 1:1 aspect ratio.
  const uvEqual=(unitMode!=='rlu');
  const uLim=uvEqual ? Math.max(limits.U,limits.V) : limits.U;
  const vLim=uvEqual ? uLim : limits.V;
  reactResolutionPlot(
    ids.UV,
    [traceEllipse(r.ellipses.projUV,'projection'),traceEllipse(r.ellipses.sliceUV,'slice','dash')],
    baseLayout(
      `δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,
      `δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,
      `δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,
      uLim,vLim,uvEqual,ids.UV,fonts,true
    ),
  );
}

function renderResolution(entry,indexInfo='',plotLimits=null){
  if(resolutionIsUnavailable()){
    clearResolutionResults();
    return;
  }
  const {result:r,calc,unitMode,lc,angles}=entry;
  const limits=plotLimits || r.lim;
  const ax=resolutionDisplayAxes(r,lc);
  const fmtAxis=formatResolutionAxis;

  $('result').classList.remove('hidden');

  // Show the motor angles exactly as Angle calculation does (same signs).
  const shown=displayedMotorAngles(angles);

  // Use the energies returned by the resolution calculation itself.  This
  // works for both fixed-Ei and fixed-Ef modes without recomputing energies.
  const {Ei,Ef}=r.energies;
  $('summary').innerHTML=
    `<div><b>Calculation point</b> Ei=${Ei.toFixed(3)} meV, Ef=${Ef.toFixed(3)} meV, `+
    `ℏω=${calc.hw.toFixed(3)} meV, (h,k,l)=(${calc.h.toFixed(3)}, ${calc.k.toFixed(3)}, ${calc.l.toFixed(3)}) ${indexInfo}</div>`+
    `<div>${resolutionWidthsHtml(r,unitMode,lc)}</div>`+
    `<div><b>Resolution axes</b> U=${fmtAxis(ax.U)}, V=${fmtAxis(ax.V)}, W=${fmtAxis(ax.W)}</div>`+
    `<div><b>Angles (deg)</b> M1=${formatAngle(shown.m1)}, M2=${formatAngle(shown.m2)}, `+
    `S1=${formatAngle(shown.s1)}, S2=${formatAngle(shown.s2)}, `+
    `A1=${formatAngle(shown.a1)}, A2=${formatAngle(shown.a2)}`+
    `${angles.warning ? ` &nbsp;⚠ ${angles.warning}` : ''}</div>`;

  // RM is the original TAS local matrix (Q_parallel,Q_perp,E,Q_out).
  // RM_U is the same matrix rotated to the U-based orthogonal frame.
  // In this display V denotes the automatically orthogonalized in-plane V.
  $('matrix').textContent=
    `Local matrix order (Q∥, Q⊥, E, Qout)\n${matrixText(r.RM)}\n\n`+
    `U-based matrix order (U, U⊥ (in-plane), E, U⊥ (out-of-plane))\n${matrixText(r.RM_U)}`;

  renderResolutionPlots(r,unitMode,lc,limits);
}
function resolutionScanPoints(){
  const nRaw=Math.round(num('npts'));
  const n=Number.isFinite(nRaw)?Math.max(2,nRaw):2;
  const hs=linspace(num('h0'),num('h1'),n), ks=linspace(num('k0'),num('k1'),n), ls=linspace(num('l0'),num('l1'),n);
  return Array.from({length:n},(_,i)=>[hs[i],ks[i],ls[i]]);
}

function updateResolutionPlaneWarning(){
  if(resolutionIsUnavailable()){
    setScatteringPlaneWarning('resolutionPlaneWarning','');
    return;
  }
  const scan=$('calcMode')?.value==='scan';
  if(!scan){
    setScatteringPlaneWarning('resolutionPlaneWarning',scatteringPlaneWarningMessage([num('h'),num('k'),num('l')]));
    return;
  }
  const points=resolutionScanPoints();
  let outside=0, firstError='';
  for(const hkl of points){
    const result=hklInCurrentScatteringPlane(hkl);
    if(!result.ok){ outside++; if(result.error && !firstError) firstError=result.error; }
  }
  const message=firstError
    ? `Warning: ${firstError}`
    : (outside ? `Warning: ${outside} of ${points.length} scan point(s) are outside the current U-V scattering plane.` : '');
  setScatteringPlaneWarning('resolutionPlaneWarning',message);
}

// Resolution diagnostics belong to Calculation point, not the global error
// banner above the main tabs.  The live HKL plane warning is already shown
// there; keep that precise message instead of duplicating the core exception.
function showResolutionCalculationWarning(error){
  const message=userFacingTasMessage(error instanceof Error ? error.message : String(error));
  const livePlaneWarning=$('resolutionPlaneWarning')?.textContent?.trim()||'';
  const outOfPlane=/Calculation Q is out of plane/i.test(message);
  setScatteringPlaneWarning('resolutionPlaneWarning',
    outOfPlane && livePlaneWarning ? livePlaneWarning : `Warning: ${message.replace(/^Warning:\s*/i,'')}`);
  clearResolutionResults();
}

function doSingleResolution(){
  if(resolutionIsUnavailable()){
    clearResolutionResults();
    return;
  }
  clearError();
  updateResolutionPlaneWarning();
  try{
    const e=calcOne({hw:num('hw'),h:num('h'),k:num('k'),l:num('l')});
    scanResolutionPlotLimits=null;
    $('scanNav').classList.add('hidden');
    // Single-point Calc: always fit to this calculation's resolution ellipse.
    renderResolution(e,'',e.result.lim);
    $('calcSingleResolution')?.classList.remove('needs-calc');
  }catch(e){showResolutionCalculationWarning(e);}
}
function doScanResolution(){
  if(resolutionIsUnavailable()){
    clearResolutionResults();
    return;
  }
  clearError();
  updateResolutionPlaneWarning();
  try{
    const n=Math.max(2,Math.round(num('npts'))),xs=(a,b)=>linspace(a,b,n),hs=xs(num('h0'),num('h1')),ks=xs(num('k0'),num('k1')),ls=xs(num('l0'),num('l1')),ws=xs(num('hw0'),num('hw1'));
    scanResults=Array.from({length:n},(_,i)=>calcOne({hw:ws[i],h:hs[i],k:ks[i],l:ls[i]}));
    // Use the largest required extent across the complete scan.  This is
    // especially important for constant-E Q scans, where the ellipse shape can
    // change strongly with Q; the slider must not rescale the plot underneath it.
    scanResolutionPlotLimits=resolutionPlotLimitsFromEntries(scanResults);
    $('scanSlider').min=1;
    $('scanSlider').max=n;
    $('scanSlider').value=1;
    $('scanNav').classList.remove('hidden');
    $('calcScanResolution')?.classList.remove('needs-calc');
    renderResolutionScan(1);
  }catch(e){
    scanResolutionPlotLimits=null;
    showResolutionCalculationWarning(e);
  }
}
function renderResolutionScan(i){
  if(resolutionIsUnavailable()){
    clearResolutionResults();
    return;
  }
  if(!scanResults.length) return;
  i=Math.max(1,Math.min(scanResults.length,Number(i)));
  $('scanSlider').value=i;
  $('scanIndex').textContent=`${i} / ${scanResults.length}`;
  renderResolution(scanResults[i-1],`| scan ${i}/${scanResults.length}`,scanResolutionPlotLimits || scanResults[i-1].result.lim);
}

function bindResolutionManualCalculation(){
  const panel=$('resolutionPanel');
  if(!panel || panel.dataset.manualResolutionBound==='1') return;
  panel.dataset.manualResolutionBound='1';
  for(const control of panel.querySelectorAll('input, select')){
    if(control.id==='scanSlider') continue;
    const markCurrent=()=>{
      if($("calcMode")?.value==="scan") markResolutionScanDirty();
    };
    control.addEventListener('input',markCurrent);
    control.addEventListener('change',markCurrent);
  }
}


// Display-only terminology: magnetic propagation vectors are k1, k2, ...
function updatePropagationVectorLabels(){
  const symbols=["●","×","★","◆","+","▲","■","◇","▼","⬟"];
  for(const i of propagationVectorIndices()){
    const enable=$(`q_enable${i}`);
    const row=enable?.closest('.propagation-row');
    if(!row) continue;
    const span=enable.closest('label')?.querySelector('span');
    if(span) span.textContent=`k${i} (${symbols[(i-1)%symbols.length]})`;
    const labels=[...row.querySelectorAll('label')].filter(x=>x!==enable.closest('label'));
    ['h','k','l'].forEach((c,j)=>{
      if(labels[j] && labels[j].firstChild) labels[j].firstChild.nodeValue=`k${i}_${c}`;
    });
  }
}

// Toolbox unit conversion / S2 conversion / attenuation UI is implemented in toolbox.js.

// ==================== Powder Angle calculation helper ====================
function powderWavevectors(hw){
  const E=num('energy');
  const mode=checkedValue('energyMode');
  const Ei=mode==='Ef fixed' ? E+hw : E;
  const Ef=mode==='Ef fixed' ? E : E-hw;
  if(!(Ei>0) || !(Ef>0)) return null;
  return {Ei,Ef,ki:Math.sqrt(Ei/2.072),kf:Math.sqrt(Ef/2.072)};
}

function powderQFromS2AtHW(s2,hw){
  const wv=powderWavevectors(hw);
  if(!wv) return NaN;
  const theta=deg2rad(Math.abs(Number(s2)));
  return Math.sqrt(Math.max(0,wv.ki*wv.ki+wv.kf*wv.kf-2*wv.ki*wv.kf*Math.cos(theta)));
}

function powderSignedS2FromQAtHW(q,hw){
  const s2abs=powderS2ForQAtHW(q,hw);
  if(!Number.isFinite(s2abs)) return NaN;
  const convention=tasConvention(selectedTasSense(),selectedS1Sign());
  return convention.s2EncoderSign*Math.abs(s2abs);
}

function powderLinkDriver(){
  const host=$('powderGeometryTarget');
  return host?.dataset.linkDriver==='s2' ? 's2' : 'q';
}

function setPowderLinkDriver(driver){
  const host=$('powderGeometryTarget');
  if(host) host.dataset.linkDriver=driver==='s2'?'s2':'q';
}

function syncPowderLinkedInputs(driver=powderLinkDriver(),{recalc=false}={}){
  const s2Field=$('powderGeomS2'), qField=$('powderGeomQ'), hwField=$('powderGeomHW');
  if(!s2Field || !qField || !hwField) return;
  const hw=parseNumericValue(hwField.value);
  if(!Number.isFinite(hw)) return;

  if(driver==='s2'){
    const s2=parseNumericValue(s2Field.value);
    if(!Number.isFinite(s2)) return;
    const q=powderQFromS2AtHW(s2,hw);
    if(Number.isFinite(q) && document.activeElement!==qField) qField.value=q.toFixed(6);
  }else{
    const q=parseNumericValue(qField.value);
    if(!Number.isFinite(q)) return;
    const s2=powderSignedS2FromQAtHW(q,hw);
    if(Number.isFinite(s2) && document.activeElement!==s2Field) s2Field.value=s2.toFixed(4);
  }
  if(recalc) scheduleRecalc();
}

function powderGeometryTarget(uiSenseOverride=null,rawSenseForDrawing=false){
  const s2Input=parseNumericValue($('powderGeomS2')?.value);
  const qInput=parseNumericValue($('powderGeomQ')?.value);
  const hw=parseNumericValue($('powderGeomHW')?.value);
  if(!Number.isFinite(s2Input) || !Number.isFinite(qInput) || !Number.isFinite(hw)){
    throw new Error('Enter valid Powder S2, Q and ħω values. Fractions such as 1/2 are accepted.');
  }
  const wv=powderWavevectors(hw);
  if(!wv) throw new Error('This ħω is outside the positive Ei/Ef range.');
  const {Ei,Ef,ki,kf}=wv;

  // The last edited linked field is authoritative. Recalculate the partner once
  // more here so calculations cannot use a stale Q/S2 pair.
  let q,s2abs;
  if(powderLinkDriver()==='s2'){
    s2abs=Math.abs(s2Input);
    if(!(s2abs>=0 && s2abs<=180)) throw new Error('S2 must be between -180° and 180°.');
    q=powderQFromS2AtHW(s2Input,hw);
  }else{
    q=qInput;
    if(!(q>=0)) throw new Error('Q must be non-negative.');
    s2abs=powderS2ForQAtHW(q,hw);
    if(!Number.isFinite(s2abs)) throw new Error('The entered Q is not accessible at this ħω.');
  }

  const braggAngle=(k,d,label)=>{
    const arg=PI/(Number(d)*k);
    if(arg>1+1e-12 || arg<-1-1e-12) throw new Error(`${label} Bragg condition is inaccessible at the selected energy.`);
    return rad2deg(Math.asin(clamp(arg,-1,1)));
  };
  let m1abs=braggAngle(ki,num('dMono'),'Monochromator');
  let a1abs=braggAngle(kf,num('dAna'),'Analyzer');
  if(checkedValue('geometry')==='anti-W') a1abs=-a1abs;

  // Powder has no sample orientation, but its motor signs follow the same
  // Sense/S1-sign convention as Single-crystal Angle calculation.
  let convention=tasConvention(selectedTasSense(),selectedS1Sign());
  if(uiSenseOverride && typeof uiSenseOverride==="object" && "sense" in uiSenseOverride){
    convention=tasConvention(uiSenseOverride.sense,uiSenseOverride.s1sign);
  }else if(uiSenseOverride){
    const legacy=tasConventionFromLegacyUiSense(uiSenseOverride);
    convention=tasConvention(legacy.sense,legacy.s1sign);
  }
  if(rawSenseForDrawing){
    convention=tasConvention(convention.sense,"ccw");
  }

  const angles={
    m1:convention.monoSign*m1abs,
    m2:2*convention.monoSign*m1abs,
    s1:0,
    s2:convention.s2EncoderSign*s2abs,
    a1:convention.analyzerSign*a1abs,
    a2:2*convention.analyzerSign*a1abs,
    warning:''
  };
  return {calc:{q,hw,s2:s2abs},q,s2:s2abs,angles,Ei,Ef,ki,kf};
}


  return {
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
    hasScanResults:()=>scanResults.length>0,
    clearResolutionResults
  };
}
