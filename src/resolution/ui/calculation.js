// Resolution: single / scan calculation, warnings and results.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
import {displayedMotorAngles} from '../../core/tas-conventions.js';
export function installResolutionCalculation(ctx){
  const {deps:{
    $, clearError, hklInCurrentScatteringPlane, linspace, markResolutionScanDirty, num,
    propagationVectorIndices, scatteringPlaneWarningMessage, setScatteringPlaneWarning,
    userFacingTasMessage
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    bindResolutionManualCalculation, doScanResolution, doSingleResolution, renderResolution,
    renderResolutionScan, updatePropagationVectorLabels, updateResolutionPlaneWarning
  });

function renderResolution(entry,indexInfo='',plotLimits=null){
  if(fn.resolutionIsUnavailable()){
    fn.clearResolutionResults();
    return;
  }
  const {result:r,calc,unitMode,lc,angles}=entry;
  const limits=plotLimits || fn.resolutionFrame(r).lim;
  shared.lastResolutionRender={entry,indexInfo,scan:indexInfo.startsWith('| scan')};
  const ax=fn.resolutionDisplayAxes(r,lc), axisNames=fn.resolutionAxisNames(r);
  const fmtAxis=fn.formatResolutionAxis;

  $('result').classList.remove('hidden');

  // Show the motor angles exactly as Angle calculation does (same signs).
  const shown=displayedMotorAngles(angles);

  // Use the energies returned by the resolution calculation itself.  This
  // works for both fixed-Ei and fixed-Ef modes without recomputing energies.
  const {Ei,Ef}=r.energies;
  $('summary').innerHTML=
    `<div><b>Calculation point</b> Ei=${Ei.toFixed(3)} meV, Ef=${Ef.toFixed(3)} meV, `+
    `ħω=${calc.hw.toFixed(3)} meV, (h,k,l)=(${calc.h.toFixed(3)}, ${calc.k.toFixed(3)}, ${calc.l.toFixed(3)}) ${indexInfo}</div>`+
    `<div>${fn.resolutionWidthsHtml(r,unitMode,lc)}</div>`+
    `<div><b>Resolution axes</b> ${axisNames[0]}=${fmtAxis(ax.U)}, ${axisNames[1]}=${fmtAxis(ax.V)}, ${axisNames[2]}=${fmtAxis(ax.W)}</div>`+
    `<div><b>Angles (deg)</b> M1=${fn.formatAngle(shown.m1)}, M2=${fn.formatAngle(shown.m2)}, `+
    `S1=${fn.formatAngle(shown.s1)}, S2=${fn.formatAngle(shown.s2)}, `+
    `A1=${fn.formatAngle(shown.a1)}, A2=${fn.formatAngle(shown.a2)}`+
    `${angles.warning ? ` &nbsp;⚠ ${angles.warning}` : ''}</div>`;

  // RM is the original TAS local matrix (Q_parallel,Q_perp,E,Q_out).
  // RM_U is the same matrix rotated to the U-based orthogonal frame.
  // In this display V denotes the automatically orthogonalized in-plane V.
  $('matrix').textContent=
    `Local matrix order (Q∥, Q⊥, E, Qout)\n${fn.matrixText(r.RM)}\n\n`+
    `U-based matrix order (U, U⊥in, E, U⊥out)\n${fn.matrixText(r.RM_U)}`+
    (r.lattice ? `\n\nLattice matrix order (U, V, E, W), oblique coordinates along unit U, V, W\n${fn.matrixText(r.lattice.RM)}` : '');

  fn.bindResolutionUVView();
  fn.renderResolutionPlots(r,unitMode,lc,limits);
}
function resolutionScanPoints(){
  const nRaw=Math.round(num('npts'));
  const n=Number.isFinite(nRaw)?Math.max(2,nRaw):2;
  const hs=linspace(num('h0'),num('h1'),n), ks=linspace(num('k0'),num('k1'),n), ls=linspace(num('l0'),num('l1'),n);
  return Array.from({length:n},(_,i)=>[hs[i],ks[i],ls[i]]);
}

function updateResolutionPlaneWarning(){
  if(fn.resolutionIsUnavailable()){
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
  fn.clearResolutionResults();
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
  for(const id of Object.values(shared.RESOLUTION_PLOT_IDS)){
    const gd=$(id); if(gd && window.Plotly){ try{ Plotly.purge(gd); }catch(_e){} }
  }
}
function doSingleResolution(){
  if(fn.resolutionIsUnavailable()){
    fn.clearResolutionResults();
    return;
  }
  clearError();
  updateResolutionPlaneWarning();
  try{
    const e=fn.calcOne({hw:num('hw'),h:num('h'),k:num('k'),l:num('l')});
    shared.scanResolutionPlotLimits=null;
    $('scanNav').classList.add('hidden');
    // Single-point Calc: always fit to this calculation's resolution ellipse.
    renderResolution(e,'',fn.resolutionFrame(e.result).lim);
    $('calcSingleResolution')?.classList.remove('needs-calc');
  }catch(e){showResolutionCalculationWarning(e);}
}
function doScanResolution(){
  if(fn.resolutionIsUnavailable()){
    fn.clearResolutionResults();
    return;
  }
  clearError();
  updateResolutionPlaneWarning();
  try{
    const n=Math.max(2,Math.round(num('npts'))),xs=(a,b)=>linspace(a,b,n),hs=xs(num('h0'),num('h1')),ks=xs(num('k0'),num('k1')),ls=xs(num('l0'),num('l1')),ws=xs(num('hw0'),num('hw1'));
    // Every point is calculated on its own: a point outside the accessible
    // range (e.g. kinematically inaccessible) is kept as "not calculable"
    // and does not stop the others.
    shared.scanResults=Array.from({length:n},(_,i)=>{
      const calc={hw:ws[i],h:hs[i],k:ks[i],l:ls[i]};
      try{ return fn.calcOne(calc); }
      catch(err){ return {calc,failed:true,message:userFacingTasMessage(err instanceof Error ? err.message : String(err))}; }
    });
    const valid=shared.scanResults.filter(e=>!e.failed);
    $('calcScanResolution')?.classList.remove('needs-calc');
    if(!valid.length){
      $('scanNav')?.classList.add('hidden');
      shared.scanResolutionPlotLimits=null;
      showResolutionNotCalculable(`No point of this scan can be calculated: ${shared.scanResults[0].message}`);
      return;
    }
    // Use the largest required extent across the complete scan.  This is
    // especially important for constant-E Q scans, where the ellipse shape can
    // change strongly with Q; the slider must not rescale the plot underneath it.
    shared.scanResolutionPlotLimits=fn.resolutionFrameLimits(valid);
    $('scanSlider').min=1;
    $('scanSlider').max=n;
    $('scanNav').classList.remove('hidden');
    // Open on the first point that could be calculated.
    renderResolutionScan(shared.scanResults.indexOf(valid[0])+1);
  }catch(e){
    shared.scanResolutionPlotLimits=null;
    showResolutionCalculationWarning(e);
  }
}
function renderResolutionScan(i){
  if(fn.resolutionIsUnavailable()){
    fn.clearResolutionResults();
    return;
  }
  if(!shared.scanResults.length) return;
  i=Math.max(1,Math.min(shared.scanResults.length,Number(i)));
  $('scanSlider').value=i;
  $('scanIndex').textContent=`${i} / ${shared.scanResults.length}`;
  const failedCount=shared.scanResults.filter(e=>e.failed).length;
  const info=`| scan ${i}/${shared.scanResults.length}${failedCount?` (${failedCount} point${failedCount>1?'s':''} not calculable)`:''}`;
  const entry=shared.scanResults[i-1];
  if(entry.failed){
    shared.lastResolutionRender={entry,indexInfo:info,scan:true};
    showResolutionNotCalculable(`Not calculable: ${entry.message}`,entry.calc,info);
    return;
  }
  renderResolution(entry,info,shared.scanResolutionPlotLimits || fn.resolutionFrame(entry.result).lim);
}

function bindResolutionManualCalculation(){
  const panel=$('resolutionPanel');
  if(!panel || panel.dataset.manualResolutionBound==='1') return;
  panel.dataset.manualResolutionBound='1';
  // Changing the display frame only re-draws the last result.
  $('resolutionCoordinates')?.addEventListener('change',fn.rerenderResolution);
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
}
