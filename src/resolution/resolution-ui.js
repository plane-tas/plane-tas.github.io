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
let lastResolutionRender=null;
// Display frame: 'q' (Q∥, Q⊥, E, W), 'orthogonal' (U, U⊥in, E, U⊥out) or
// 'lattice' (U, V, E, W).
function resolutionCoordinates(){
  const v=$('resolutionCoordinates')?.value;
  return v==='lattice'||v==='q' ? v : 'orthogonal';
}
// Results of one calculation in the chosen frame (same fields as the core's
// orthogonal result: display, lim, ellipses, displayAxes, qNorms).
function resolutionFrame(r){
  const c=resolutionCoordinates();
  if(c==='lattice' && r?.lattice) return r.lattice;
  if(c==='q' && r?.qframe) return r.qframe;
  return r;
}
// Names of the three Q axes in the chosen frame.
function resolutionAxisNames(r){
  const c=resolutionCoordinates();
  if(c==='q' && r?.qframe) return ['Q∥','Q⊥','W'];
  if(c==='lattice' && r?.lattice) return ['U','V','W'];
  return ['U','U⊥in','U⊥out'];
}
// Lattice U–V plot: 'shape' keeps the true ellipse shape and tilts the V
// axis; 'coefficients' plots the U and V coefficients on square axes.
const RESOLUTION_UV_VIEW_KEY='tas-resolution-uv-view-v1';
let resolutionUVView=(()=>{ try{ return localStorage.getItem(RESOLUTION_UV_VIEW_KEY)==='coefficients'?'coefficients':'shape'; }catch(_e){ return 'shape'; } })();
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
    sample_shape:$('sampleShapeCylinder')?.checked?'cylinder':'box',
    sample_u:cm('sampleUcm'),sample_v:cm('sampleVcm'),sample_diameter:cm('sampleDcm'),sample_height:cm('sampleHcm'),
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
  // Largest round step within 90 % of the half range (0.05 rather than 0.025
  // for a 0.06 half range), so the labels match the ellipse size.
  const raw=0.9*Number(lim);
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
// Plot limits of the entries in the chosen display frame.
function resolutionFrameLimits(entries){
  const valid=Array.isArray(entries)?entries.filter(Boolean):[];
  return resolutionPlotLimitsFromEntries(valid.map(e=>({result:{lim:resolutionFrame(e.result).lim}})));
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
  return resolutionFrame(r)?.displayAxes || r.displayAxes || {U:lc.sv1,V:lc.sv2,W:lc.sv3};
}
// One-line FWHM summary shared by the Resolution tab and Angle calculation.
// Values in parentheses are the coherent (slice) widths.
function resolutionWidthsHtml(r,unitMode,lc){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹';
  const ax=resolutionDisplayAxes(r,lc), fmtAxis=formatResolutionAxis, d=resolutionFrame(r).display;
  return `<b>Resolution</b> δQ//${fmtAxis(ax.U)}=${d.U.toFixed(4)} (${d.Ucoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.V)}=${d.V.toFixed(4)} (${d.Vcoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.W)}=${d.W.toFixed(4)} (${d.Wcoh.toFixed(4)}) ${qUnit}, `+
    `δħω=${d.E.toFixed(4)} (${d.Ecoh.toFixed(4)}) meV`;
}
// Plotly's built-in double-click "reset" returns to the axis ranges of the
// plot's first draw (an earlier point), which looks like a random scale.
// Disable it and return to the ranges of the current calculation instead.
function reactResolutionPlot(id,traces,layout,after=null){
  const gd=$(id);
  if(!gd) return;
  gd.__tasResolutionView={x:layout.xaxis.range.slice(),y:layout.yaxis.range.slice()};
  Promise.resolve(Plotly.react(gd,traces,layout,{responsive:true,doubleClick:false}))
    .then(()=>{installResolutionDoubleClick(gd); if(after) after(gd);})
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
  const frame=resolutionFrame(r), el=frame.ellipses;
  const qeTitle=v=>`δQ ∥ ${fmtAxis(v)} vs δħω`;
  reactResolutionPlot(
    ids.UE,
    [traceEllipse(el.projUE,'projection'),traceEllipse(el.sliceUE,'slice','dash')],
    baseLayout(qeTitle(ax.U),`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,'δħω (meV)',limits.U,limits.E,false,ids.UE,fonts),
  );

  reactResolutionPlot(
    ids.VE,
    [traceEllipse(el.projVE,'projection'),traceEllipse(el.sliceVE,'slice','dash')],
    baseLayout(qeTitle(ax.V),`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,'δħω (meV)',limits.V,limits.E,false,ids.VE,fonts),
  );

  reactResolutionPlot(
    ids.WE,
    [traceEllipse(el.projWE,'projection'),traceEllipse(el.sliceWE,'slice','dash')],
    baseLayout(qeTitle(ax.W),`δQ ∥ ${fmtAxis(ax.W)} (${qUnit})`,'δħω (meV)',limits.W,limits.E,false,ids.WE,fonts),
  );

  const lattice=resolutionCoordinates()==='lattice' && r.lattice;
  const oblique=!!lattice && Math.abs(r.lattice.vDirection.cos)>1e-6;
  if(ids===RESOLUTION_PLOT_IDS) syncResolutionUVHead(oblique);
  const uvGd=$(ids.UV); if(uvGd) uvGd.__tasObliqueGrid=null;
  if(oblique && resolutionUVView==='shape'){
    renderObliqueUVPlot(r,unitMode,ax,ids.UV,fonts,limits);
    return;
  }
  // Each axis keeps its own resolution range (r.l.u. and Å⁻¹ alike), so the
  // ellipse fills the panel; a forced 1:1 aspect made Plotly widen the U
  // range to fill the wide panel.
  const uvEqual=false;
  const uLim=limits.U, vLim=limits.V;
  const layout=baseLayout(
    `δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,
    `δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,
    `δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,
    uLim,vLim,uvEqual,ids.UV,fonts,true
  );
  reactResolutionPlot(ids.UV,[traceEllipse(el.projUV,'projection'),traceEllipse(el.sliceUV,'slice','dash')],layout);
}
// Round step for resolution axes: the largest 1, 2, 2.5 or 5 x 10^n that
// still fits inside 90 % of the half range, so the labelled ticks sit near
// the ellipse size (e.g. 0.05 rather than 0.025 for a 0.06 half range).
function resolutionNiceStep(halfRange){
  const raw=0.9*Number(halfRange);
  if(!(raw>0) || !Number.isFinite(raw)) return 1;
  const decade=Math.pow(10,Math.floor(Math.log10(raw)));
  const mantissa=[1,2,2.5,5,10].filter(m=>m*decade<=raw*(1+1e-9)).pop()||1;
  return Number((mantissa*decade).toPrecision(6));
}
// Oblique U/V grid for the true-shape U–V plot, built like the Constant E
// map in r.l.u.: the plot is physically orthonormal, the u/v = constant lines
// are drawn as shapes, and the axis ticks are placed where those lines meet
// the bottom (U) and left (V) frame edges, with the axis titles outside.
// basis: physical (x, y) of one unit of U and of V in the selected unit.
function resolutionObliqueGrid(basis,xRange,yRange,uStep,vStep){
  const {ux,uy,vx,vy}=basis, det=ux*vy-uy*vx;
  const out={shapes:[],xTickVals:[],xTickText:[],yTickVals:[],yTickText:[]};
  if(!(Math.abs(det)>1e-15)) return out;
  const xmin=Math.min(...xRange),xmax=Math.max(...xRange),ymin=Math.min(...yRange),ymax=Math.max(...yRange);
  const toUV=(x,y)=>[(x*vy-y*vx)/det,(ux*y-uy*x)/det];
  const toXY=(u,v)=>[ux*u+vx*v,uy*u+vy*v];
  const corners=[[xmin,ymin],[xmin,ymax],[xmax,ymin],[xmax,ymax]].map(p=>toUV(...p));
  const umin=Math.min(...corners.map(p=>p[0])),umax=Math.max(...corners.map(p=>p[0]));
  const vmin=Math.min(...corners.map(p=>p[1])),vmax=Math.max(...corners.map(p=>p[1]));
  // Steps from the visible U and V ranges unless given.
  // (U along x: the horizontal half range; V: the vertical half range over
  // its y component), so the labelled ticks match the frame size.
  if(!(uStep>0)) uStep=resolutionNiceStep((xmax-xmin)/2/Math.max(Math.abs(ux),1e-15));
  if(!(vStep>0)) vStep=resolutionNiceStep((ymax-ymin)/2/Math.max(Math.abs(vy),1e-15));
  const spanU=(umax-umin)+2*uStep, spanV=(vmax-vmin)+2*vStep;
  const fmt=v=>Math.abs(v)<1e-12?'0':String(Number(v.toPrecision(6)));
  const eps=1e-9*Math.max(xmax-xmin,ymax-ymin,1e-12);
  const line=(origin,delta,style)=>({type:'line',xref:'x',yref:'y',layer:'below',
    x0:origin[0]-delta[0],y0:origin[1]-delta[1],x1:origin[0]+delta[0],y1:origin[1]+delta[1],line:style});
  const minorStyle={color:'#e8ebee',width:1}, majorStyle={color:'#bcc4cd',width:1}, zeroStyle={color:'#444',width:1};
  const divisions=step=>{const m=step/Math.pow(10,Math.floor(Math.log10(step)));return Math.abs(m-2)<1e-6?4:5;};
  const onMajor=(value,step)=>Math.abs(value/step-Math.round(value/step))<1e-6;
  const uMinor=uStep/divisions(uStep), vMinor=vStep/divisions(vStep);
  for(let n=Math.ceil(umin/uMinor-1e-9),i=0;n*uMinor<=umax+1e-12&&i<400;n++,i++){
    const u=n*uMinor; if(!onMajor(u,uStep)) out.shapes.push(line(toXY(u,(vmin+vmax)/2),[vx*spanV/2,vy*spanV/2],minorStyle));
  }
  for(let n=Math.ceil(vmin/vMinor-1e-9),i=0;n*vMinor<=vmax+1e-12&&i<400;n++,i++){
    const v=n*vMinor; if(!onMajor(v,vStep)) out.shapes.push(line(toXY((umin+umax)/2,v),[ux*spanU/2,uy*spanU/2],minorStyle));
  }
  for(let n=Math.ceil(umin/uStep-1e-9),i=0;n*uStep<=umax+1e-12&&i<60;n++,i++){
    const u=n*uStep;
    out.shapes.push(line(toXY(u,(vmin+vmax)/2),[vx*spanV/2,vy*spanV/2],n===0?zeroStyle:majorStyle));
    if(Math.abs(vy)>1e-15){
      const v=(ymin-uy*u)/vy, x=ux*u+vx*v;
      if(x>=xmin-eps && x<=xmax+eps){ out.xTickVals.push(Math.max(xmin,Math.min(xmax,x))); out.xTickText.push(fmt(u)); }
    }
  }
  for(let n=Math.ceil(vmin/vStep-1e-9),i=0;n*vStep<=vmax+1e-12&&i<60;n++,i++){
    const v=n*vStep;
    out.shapes.push(line(toXY((umin+umax)/2,v),[ux*spanU/2,uy*spanU/2],n===0?zeroStyle:majorStyle));
    if(Math.abs(ux)>1e-15){
      const u=(xmin-vx*v)/ux, y=uy*u+vy*v;
      if(y>=ymin-eps && y<=ymax+eps){ out.yTickVals.push(Math.max(ymin,Math.min(ymax,y))); out.yTickText.push(fmt(v)); }
    }
  }
  out.shapes.push({type:'rect',xref:'x domain',yref:'y domain',x0:0,x1:1,y0:0,y1:1,line:{color:'#586472',width:1},fillcolor:'rgba(0,0,0,0)',layer:'above'});
  return out;
}
// True-shape U–V plot for non-orthogonal U and V: the ellipse is drawn in
// physical (Å⁻¹) coordinates, x along U and y along the in-plane normal to U,
// with an oblique U/V grid labelled in the selected unit.
function renderObliqueUVPlot(r,unitMode,ax,id,fonts,limits){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹', fmtAxis=formatResolutionAxis;
  const rlu=unitMode==='rlu';
  const nU=rlu?r.qNorms.U:1, nVorth=rlu?r.qNorms.V:1, nV=rlu?r.lattice.qNorms.V:1;
  const {cos,sin}=r.lattice.vDirection;
  const phys=p=>({x:p.x.map(v=>v*nU),y:p.y.map(v=>v*nVorth)});
  const proj=phys(r.ellipses.projUV), slice=phys(r.ellipses.sliceUV);
  const basis={ux:nU,uy:0,vx:nV*cos,vy:nV*sin};
  const toAB=(x,y)=>{const b=y/sin, a=x-b*cos; return [formatResolutionCoordinate(a/nU),formatResolutionCoordinate(b/nV)];};
  const trace=(p,name,dash,color)=>({x:p.x,y:p.y,mode:'lines',name,line:{dash,color},
    customdata:p.x.map((x,i)=>toAB(x,p.y[i])),
    hovertemplate:`U: %{customdata[0]}<br>V: %{customdata[1]} (${qUnit})<extra></extra>`});
  // Same ranges as the U–V view: U over ±limits.U and V over ±limits.V
  // (the V range maps to y through the V component normal to U).  In r.l.u.
  // and Å⁻¹ alike the two axes keep their own scales, as in the U–V
  // view.  The x range is widened only when the tilted ellipse would
  // otherwise be cut off.
  const absMax=(...a)=>Math.max(0,...a.flat().map(Math.abs).filter(Number.isFinite));
  const limU=Number(limits?.U)>0?Number(limits.U):0, limV=Number(limits?.V)>0?Number(limits.V):0;
  const ellX=absMax(proj.x,slice.x), ellY=absMax(proj.y,slice.y);
  const equal=false;
  let halfX=Math.max(limU*nU,1.05*ellX), halfY=Math.max(limV*nV*Math.abs(sin),1.05*ellY);
  if(!(halfX>0)) halfX=1; if(!(halfY>0)) halfY=1;
  const xRange=[-halfX,halfX], yRange=[-halfY,halfY];
  const grid=resolutionObliqueGrid(basis,xRange,yRange);
  const axis=(title,range,vals,text)=>({title:{text:title,standoff:13,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},
    range:range.slice(),tickmode:'array',tickvals:vals,ticktext:text,ticks:'outside',showgrid:false,zeroline:false,showline:false});
  const layout={
    uirevision:`${id}-oblique`,
    title:{text:`δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,font:{size:fonts.title}},
    margin:fonts.margin || {l:88,r:22,t:52,b:94,autoexpand:true},
    xaxis:axis(`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,xRange,grid.xTickVals,grid.xTickText),
    yaxis:{...axis(`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,yRange,grid.yTickVals,grid.yTickText),...(equal?{scaleanchor:'x',scaleratio:1}:{})},
    shapes:grid.shapes,hovermode:'closest',hoverdistance:18,showlegend:false
  };
  const gd=$(id);
  if(gd) gd.__tasObliqueGrid={basis};
  reactResolutionPlot(id,[trace(proj,'projection','solid','#1f77b4'),trace(slice,'slice','dash','#ff7f0e')],layout,refreshObliqueGrid);
  // Re-label the oblique grid after zooming, panning or resizing.
  if(gd && !gd.__tasObliqueRelayout && typeof gd.on==='function'){
    gd.__tasObliqueRelayout=true;
    gd.on('plotly_relayout',event=>{
      if(!Object.keys(event||{}).some(k=>/^([xy]axis\.(range|autorange)|autosize|width|height)/.test(k))) return;
      refreshObliqueGrid(gd);
    });
  }
}
// Rebuild the oblique grid for the axis ranges Plotly actually drew.
function refreshObliqueGrid(gd){
  const g=gd?.__tasObliqueGrid;
  if(!g || gd.__tasObliqueBusy) return;
  const xr=gd._fullLayout?.xaxis?.range, yr=gd._fullLayout?.yaxis?.range;
  if(!Array.isArray(xr)||!Array.isArray(yr)) return;
  const grid=resolutionObliqueGrid(g.basis,xr,yr);
  gd.__tasObliqueBusy=true;
  Promise.resolve(Plotly.relayout(gd,{shapes:grid.shapes,'xaxis.tickvals':grid.xTickVals,'xaxis.ticktext':grid.xTickText,
    'yaxis.tickvals':grid.yTickVals,'yaxis.ticktext':grid.yTickText}))
    .catch(()=>{}).finally(()=>{gd.__tasObliqueBusy=false;});
}
// The U–V view selector (Calculation point toolbar) applies only to the
// lattice frame with non-orthogonal U and V.
function syncResolutionUVHead(show){
  // The selector sits in the Calculation point toolbar, so toggling it never
  // changes the plot sizes; it is enabled only when it has an effect.
  const select=$('resolutionUVView');
  if(!select) return;
  if(select.value!==resolutionUVView) select.value=resolutionUVView;
  select.disabled=!show;
  select.title=show?'':'Only for U, V, E, W with U not perpendicular to V';
}
function bindResolutionUVView(){
  const select=$('resolutionUVView');
  if(!select || select.dataset.bound) return;
  select.dataset.bound='1';
  select.value=resolutionUVView;
  select.addEventListener('change',()=>{
    resolutionUVView=select.value==='coefficients'?'coefficients':'shape';
    try{ localStorage.setItem(RESOLUTION_UV_VIEW_KEY,resolutionUVView); }catch(_e){}
    rerenderResolution();
  });
}
// Re-draw the last result in the current display frame (no recalculation).
function rerenderResolution(){
  if(!lastResolutionRender) return;
  const {entry,indexInfo,scan}=lastResolutionRender;
  if(scan && scanResults.length){
    scanResolutionPlotLimits=resolutionFrameLimits(scanResults.filter(e=>!e.failed));
    renderResolutionScan(Number($('scanSlider')?.value)||1);
  }else renderResolution(entry,indexInfo,resolutionFrame(entry.result).lim);
}

function renderResolution(entry,indexInfo='',plotLimits=null){
  if(resolutionIsUnavailable()){
    clearResolutionResults();
    return;
  }
  const {result:r,calc,unitMode,lc,angles}=entry;
  const limits=plotLimits || resolutionFrame(r).lim;
  lastResolutionRender={entry,indexInfo,scan:indexInfo.startsWith('| scan')};
  const ax=resolutionDisplayAxes(r,lc), axisNames=resolutionAxisNames(r);
  const fmtAxis=formatResolutionAxis;

  $('result').classList.remove('hidden');

  // Show the motor angles exactly as Angle calculation does (same signs).
  const shown=displayedMotorAngles(angles);

  // Use the energies returned by the resolution calculation itself.  This
  // works for both fixed-Ei and fixed-Ef modes without recomputing energies.
  const {Ei,Ef}=r.energies;
  $('summary').innerHTML=
    `<div><b>Calculation point</b> Ei=${Ei.toFixed(3)} meV, Ef=${Ef.toFixed(3)} meV, `+
    `ħω=${calc.hw.toFixed(3)} meV, (h,k,l)=(${calc.h.toFixed(3)}, ${calc.k.toFixed(3)}, ${calc.l.toFixed(3)}) ${indexInfo}</div>`+
    `<div>${resolutionWidthsHtml(r,unitMode,lc)}</div>`+
    `<div><b>Resolution axes</b> ${axisNames[0]}=${fmtAxis(ax.U)}, ${axisNames[1]}=${fmtAxis(ax.V)}, ${axisNames[2]}=${fmtAxis(ax.W)}</div>`+
    `<div><b>Angles (deg)</b> M1=${formatAngle(shown.m1)}, M2=${formatAngle(shown.m2)}, `+
    `S1=${formatAngle(shown.s1)}, S2=${formatAngle(shown.s2)}, `+
    `A1=${formatAngle(shown.a1)}, A2=${formatAngle(shown.a2)}`+
    `${angles.warning ? ` &nbsp;⚠ ${angles.warning}` : ''}</div>`;

  // RM is the original TAS local matrix (Q_parallel,Q_perp,E,Q_out).
  // RM_U is the same matrix rotated to the U-based orthogonal frame.
  // In this display V denotes the automatically orthogonalized in-plane V.
  $('matrix').textContent=
    `Local matrix order (Q∥, Q⊥, E, Qout)\n${matrixText(r.RM)}\n\n`+
    `U-based matrix order (U, U⊥in, E, U⊥out)\n${matrixText(r.RM_U)}`+
    (r.lattice ? `\n\nLattice matrix order (U, V, E, W), oblique coordinates along unit U, V, W\n${matrixText(r.lattice.RM)}` : '');

  bindResolutionUVView();
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

// Results box for a point (or a whole scan) that cannot be calculated: the
// reason replaces the widths, plots and matrices.
function showResolutionNotCalculable(text,calc=null,indexInfo=''){
  $('result')?.classList.remove('hidden');
  const f=v=>Number.isFinite(Number(v))?Number(v).toFixed(3):'';
  const point=calc ? `<div><b>Calculation point</b> ħω=${f(calc.hw)} meV, (h,k,l)=(${f(calc.h)}, ${f(calc.k)}, ${f(calc.l)}) ${indexInfo}</div>` : '';
  const div=document.createElement('div'); div.className='resolution-not-calculable'; div.textContent=text;
  if($('summary')){ $('summary').innerHTML=point; $('summary').appendChild(div); }
  if($('matrix')) $('matrix').textContent='';
  for(const id of Object.values(RESOLUTION_PLOT_IDS)){
    const gd=$(id); if(gd && window.Plotly){ try{ Plotly.purge(gd); }catch(_e){} }
  }
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
    renderResolution(e,'',resolutionFrame(e.result).lim);
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
    // Every point is calculated on its own: a point outside the accessible
    // range (e.g. kinematically inaccessible) is kept as "not calculable"
    // and does not stop the others.
    scanResults=Array.from({length:n},(_,i)=>{
      const calc={hw:ws[i],h:hs[i],k:ks[i],l:ls[i]};
      try{ return calcOne(calc); }
      catch(err){ return {calc,failed:true,message:userFacingTasMessage(err instanceof Error ? err.message : String(err))}; }
    });
    const valid=scanResults.filter(e=>!e.failed);
    $('calcScanResolution')?.classList.remove('needs-calc');
    if(!valid.length){
      $('scanNav')?.classList.add('hidden');
      scanResolutionPlotLimits=null;
      showResolutionNotCalculable(`No point of this scan can be calculated: ${scanResults[0].message}`);
      return;
    }
    // Use the largest required extent across the complete scan.  This is
    // especially important for constant-E Q scans, where the ellipse shape can
    // change strongly with Q; the slider must not rescale the plot underneath it.
    scanResolutionPlotLimits=resolutionFrameLimits(valid);
    $('scanSlider').min=1;
    $('scanSlider').max=n;
    $('scanNav').classList.remove('hidden');
    // Open on the first point that could be calculated.
    renderResolutionScan(scanResults.indexOf(valid[0])+1);
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
  const failedCount=scanResults.filter(e=>e.failed).length;
  const info=`| scan ${i}/${scanResults.length}${failedCount?` (${failedCount} point${failedCount>1?'s':''} not calculable)`:''}`;
  const entry=scanResults[i-1];
  if(entry.failed){
    lastResolutionRender={entry,indexInfo:info,scan:true};
    showResolutionNotCalculable(`Not calculable: ${entry.message}`,entry.calc,info);
    return;
  }
  renderResolution(entry,info,scanResolutionPlotLimits || resolutionFrame(entry.result).lim);
}

function bindResolutionManualCalculation(){
  const panel=$('resolutionPanel');
  if(!panel || panel.dataset.manualResolutionBound==='1') return;
  panel.dataset.manualResolutionBound='1';
  // Changing the display frame only re-draws the last result.
  $('resolutionCoordinates')?.addEventListener('change',rerenderResolution);
  for(const control of panel.querySelectorAll('input, select')){
    // The scan slider and the display frame do not change the calculation.
    if(control.id==='scanSlider' || control.id==='resolutionCoordinates' || control.id==='resolutionUVView') continue;
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
