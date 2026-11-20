// Resolution: single / scan calculation, warnings and results.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
export function installResolutionCalculation(ctx){
  const {deps:{
    $, clearError, linspace, markResolutionScanDirty, num,
    propagationVectorIndices, userFacingTasMessage
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

  $('result').classList.remove('hidden');
  $('resolutionCalculationView')?.classList.remove('resolution-failed');
  if($('resolutionFailNote')) $('resolutionFailNote').hidden=true;

  // Use the energies returned by the resolution calculation itself.  This
  // works for both fixed-Ei and fixed-Ef modes without recomputing energies.
  // Numbers without trailing zeros: "(0, 1, 0), ħω=3 meV, Ei=7.5 meV".
  const {Ei,Ef}=r.energies;
  const g=v=>{ const x=Number(Number(v).toFixed(3)); return String(Object.is(x,-0)?0:x); };
  $('summary').innerHTML=
    `<div><b>Calculation point</b> (${g(calc.h)}, ${g(calc.k)}, ${g(calc.l)}), ħω=${g(calc.hw)} meV, `+
    `Ei=${g(Ei)} meV, Ef=${g(Ef)} meV ${indexInfo}</div>`+
    `<div>${fn.resolutionWidthsHtml(r,unitMode,lc)}</div>`;
  // Motor angles are in the Angle calculation; only a failure is shown here.
  const angleWarning=$('resolutionAngleWarning');
  if(angleWarning){ angleWarning.textContent=angles.warning ? `Warning: ${angles.warning}` : ''; angleWarning.hidden=!angles.warning; }

  // RM is the original TAS local matrix (Q_parallel,Q_perp,E,Q_out).
  // RM_U is the same matrix rotated to the U-based orthogonal frame.
  // In this display V denotes the automatically orthogonalized in-plane V.
  $('matrix').textContent=
    `Local matrix order (Q∥, Q⊥, E, Qout)\n${fn.matrixText(r.RM)}\n\n`+
    `U-based matrix order (U, U⊥in, E, U⊥out)\n${fn.matrixText(r.RM_U)}`+
    (r.lattice ? `\n\nLattice matrix order (U, V, E, W), oblique coordinates along unit U, V, W\n${fn.matrixText(r.lattice.RM)}` : '');

  // Radial 3rd collimator: show its equivalent divergence (read-only) in place of the Soller value.
  { const radial=!!r.collimation3?.radial, shown=$('div3hRadial'), soller=$('div3h');
    if(soller){ soller.hidden=radial; soller.disabled=radial; }
    if(shown){ shown.hidden=!radial;
      shown.value=radial && Number.isFinite(r.collimation3.fwhmArcmin) ? `${Math.round(r.collimation3.fwhmArcmin)}′ (radial)` : 'radial'; } }
  fn.bindResolutionUVView();
  fn.renderResolutionPlots(r,unitMode,lc,limits);
  // The Comparison table shows the new result as its current row.
  fn.renderResolutionComparison?.();
}

// Calculation point shows no warnings: a point outside the scattering plane
// (or otherwise not calculable) is reported in Individual and Comparison.
// Kept as a no-op for the callers that refresh it on input changes.
function updateResolutionPlaneWarning(){}

// Why a point cannot be calculated, in a few words (the full text is the
// note's tooltip).
function shortResolutionReason(message){
  const m=String(message||'').replace(/^Warning:\s*/i,'');
  const known=[
    [/out of plane/i,'Q is outside the scattering plane.'],
    [/kinematically inaccessible/i,'Q and ħω cannot be reached (the scattering triangle does not close).'],
    [/Bragg condition is inaccessible/i,'Bragg angle not reachable at this energy.'],
    [/Ei and Ef must be positive/i,'Ei or Ef is not positive.'],
    [/Q = 0/i,'Q = 0.'],
    [/must be non-zero|positive definite/i,'Collimation or mosaic values are zero.']];
  for(const [re,text] of known) if(re.test(m)) return text;
  const first=m.split(/(?<=\.)\s/)[0]||m;
  return first.length>90 ? `${first.slice(0,87)}…` : first;
}
const pointText=calc=>{
  const g=v=>{ const x=Number(Number(v).toFixed(3)); return String(Object.is(x,-0)?0:x); };
  return calc ? `(${g(calc.h)}, ${g(calc.k)}, ${g(calc.l)}), ħω=${g(calc.hw)} meV` : '';
};
// A point that cannot be calculated: the reason goes into a yellow note in
// Individual (the point, widths, Figure and Matrices are hidden) and into the
// current row of Comparison; kept results stay.
function showResolutionCalculationWarning(error,calc=null){
  const message=userFacingTasMessage(error instanceof Error ? error.message : String(error));
  if(!calc && $('calcMode')?.value!=='scan') calc={hw:num('hw'),h:num('h'),k:num('k'),l:num('l')};
  if($('calcMode')?.value!=='scan') shared.lastResolutionRender={entry:{calc,failed:true,message:shortResolutionReason(message)},indexInfo:'',scan:false};
  showResolutionNotCalculable(message,calc);
}
function showResolutionNotCalculable(message,calc=null,indexInfo=''){
  $('result')?.classList.remove('hidden');
  $('resolutionCalculationView')?.classList.add('resolution-failed');
  const note=$('resolutionFailNote');
  if(note){
    const point=pointText(calc);
    note.textContent=`${point ? `${point} ${indexInfo ? `${indexInfo} ` : ''}— ` : ''}Not calculable: ${shortResolutionReason(message)}`;
    note.title=String(message||'');
    note.hidden=false;
  }
  if($('summary')) $('summary').textContent='';
  if($('matrix')) $('matrix').textContent='';
  if($('resolutionAngleWarning')) $('resolutionAngleWarning').hidden=true;
  for(const id of Object.values(shared.RESOLUTION_PLOT_IDS)){
    const gd=$(id); if(gd && window.Plotly){ try{ Plotly.purge(gd); }catch(_e){} }
  }
  fn.renderResolutionComparison?.();
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
  }catch(e){showResolutionCalculationWarning(e,{hw:num('hw'),h:num('h'),k:num('k'),l:num('l')});}
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
      showResolutionNotCalculable(`No point of this scan can be calculated: ${shared.scanResults[0].message}`,shared.scanResults[0].calc,'(no point of the scan)');
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
    showResolutionNotCalculable(entry.message,entry.calc,info);
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
