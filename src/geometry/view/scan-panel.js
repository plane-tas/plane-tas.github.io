// TAS geometry: Single/Scan mode, scan points, warnings, scan table and result summary.
// Part of the TAS geometry view (see ../tas-geometry-view.js for how the parts are wired).
import {displayedMotorAngles} from '../../core/tas-conventions.js';
export function installGeometryScanPanel(ctx){
  const {deps:{
    $, GEOMETRY_CALC_MODE_STORAGE_KEY, GEOMETRY_SCAN_OUTPUT_STORAGE_KEY, checkedValue,
    currentInstrument, effectiveS2MaxAtEi, formatAngle, getSingleCache, hklInCurrentScatteringPlane,
    hklToQ, norm, num, qeDarkBlockWarningsForHKLE, qeGeometryAngles, qeSpurionWarnings,
    scatteringPlaneWarningMessage, setScatteringPlaneWarning, userFacingTasMessage
  }, fn}=ctx;
  Object.assign(fn,{
    currentGeometryScanOutputTab, geometryCalculationMode, geometryPointWarnings,
    geometryResultSummaryHtml, geometryScanPoints, renderGeometryScanTable,
    setGeometryCalculationMode, setGeometryScanOutputTab, syncGeometryScanPointSlider,
    updateGeometryCalculationModeVisibility, updateGeometryPlaneWarning
  });

function geometryCalculationMode(){
  return $('geometryModeScan')?.classList.contains('active') ? 'scan' : 'single';
}

function geometryScanPoints(){
  const nRaw=Math.round(Number($('geomScanNpts')?.value));
  const n=Number.isFinite(nRaw) ? Math.max(2,nRaw) : 2;
  const start={h:num('geomScanH0'),k:num('geomScanK0'),l:num('geomScanL0'),hw:num('geomScanHW0')};
  const end={h:num('geomScanH1'),k:num('geomScanK1'),l:num('geomScanL1'),hw:num('geomScanHW1')};
  const keys=['h','k','l','hw'];
  if(keys.some(key=>!Number.isFinite(start[key]) || !Number.isFinite(end[key]))) return [];
  return Array.from({length:n},(_,i)=>{
    const f=n<=1?0:i/(n-1);
    return Object.fromEntries(keys.map(key=>[key,start[key]+(end[key]-start[key])*f]));
  });
}

function syncGeometryScanPointSlider(pointCount){
  const slider=$('geomScanPointSlider'), output=$('geomScanPointValue');
  const n=Math.max(1,Number(pointCount)||1);
  let point=Math.round(Number(slider?.value)||1);
  point=Math.max(1,Math.min(n,point));
  if(slider){ slider.min=1; slider.max=n; slider.step=1; slider.value=point; }
  if(output) output.textContent=`${point} / ${n}`;
  return point-1;
}

function geometryDisplayedMotorAngles(target,isPowder,sense,displaySense){
  void sense; void displaySense;
  const a=target.angles;
  const shown=displayedMotorAngles({m1:Number(a.m1),m2:Number(a.m2),s1:Number(a.s1),s2:Number(a.s2),a1:Number(a.a1),a2:Number(a.a2)},isPowder);
  // Four-circle: S1 is the bisecting omega; chi and phi are added.
  if(!isPowder && a.fourCircle){
    shown.s1=Number(a.fourCircle.s1); shown.chi=Number(a.fourCircle.chi); shown.phi=Number(a.fourCircle.phi);
  }
  return shown;
}

// Angle calculation output only: display motor angles to two decimals.
// Leave the underlying angles and the Resolution formatter unchanged.
function geometryResultMotorAngle(value){
  return formatAngle(value)==='' ? '' : Number(value).toFixed(2);
}

function geometryScanStatusWarnings(target,displayedAngles){
  const warnings=[];
  const s1=Number(displayedAngles?.s1), s2=Math.abs(Number(displayedAngles?.s2));
  const s1min=num("S1min"), s1max=num("S1max"), s2min=Math.abs(num("S2min"));
  if(Number.isFinite(s1) && Number.isFinite(s1min) && Number.isFinite(s1max) && (s1<s1min-1e-8 || s1>s1max+1e-8)) warnings.push('S1 out of range');
  let s2max=NaN;
  try{ s2max=effectiveS2MaxAtEi(currentInstrument(),target?.Ei,false); }catch(_e){}
  if(Number.isFinite(s2) && Number.isFinite(s2min) && s2<s2min-1e-8) warnings.push('S2 out of range');
  if(Number.isFinite(s2) && Number.isFinite(s2max) && s2>s2max+1e-8 && !warnings.includes('S2 out of range')) warnings.push('S2 out of range');
  // Four-circle: chi / phi limits of the Motor table (defaults from the
  // instrument file).
  let inst=null;
  try{ inst=currentInstrument?.(); }catch(_e){}
  const limit=(id,key)=>{ const raw=$(id)?.value; return raw!==undefined && String(raw).trim()!=='' ? Number(raw) : Number(inst?.[key]); };
  for(const key of ['chi','phi']){
    const v=Number(displayedAngles?.[key]), lo=limit(`${key}Min`,`${key}_min`), hi=limit(`${key}Max`,`${key}_max`);
    if(Number.isFinite(v) && ((Number.isFinite(lo) && v<lo-1e-8) || (Number.isFinite(hi) && v>hi+1e-8))) warnings.push(`${key==='chi'?'χ':'φ'} out of range`);
  }
  return warnings;
}

// Motor-limit status of one H, K, L, hbar-omega point, exactly as the Angle
// calculation shows it (used by the Script / Time-estimate validation).
function geometryPointWarnings(cache,calc){
  const target=qeGeometryAngles(cache,null,null,calc);
  const a=geometryDisplayedMotorAngles(target,false);
  const out=geometryScanStatusWarnings(target,a);
  if(target.angles?.warning) out.push('S1 unavailable (reference Q)');
  return out;
}
function geometryScanErrorStatus(err){
  const raw=String(err?.message || err || '');
  if(/kinematically inaccessible|requested Q and (?:energy transfer|ħω)/i.test(raw)) return 'No scattering triangle';
  return userFacingTasMessage(raw);
}

function updateGeometryPlaneWarning(points=null){
  if(checkedValue('sampleMode')!=='single'){
    setScatteringPlaneWarning('geometryPlaneWarning','');
    return;
  }
  const scan=geometryCalculationMode()==='scan';
  if(!scan){
    const hkl=[num('geomH'),num('geomK'),num('geomL')];
    setScatteringPlaneWarning('geometryPlaneWarning',scatteringPlaneWarningMessage(hkl));
    return;
  }
  const list=Array.isArray(points)?points:geometryScanPoints();
  if(!list.length){ setScatteringPlaneWarning('geometryPlaneWarning',''); return; }
  let outside=0, firstError='';
  for(const p of list){
    const result=hklInCurrentScatteringPlane([p.h,p.k,p.l]);
    if(!result.ok){ outside++; if(result.error && !firstError) firstError=result.error; }
  }
  const message=firstError
    ? `Warning: ${firstError}`
    : (outside ? `Warning: ${outside} of ${list.length} scan point(s) are outside the current U-V scattering plane.` : '');
  setScatteringPlaneWarning('geometryPlaneWarning',message);
}

function renderGeometryScanTable(cache,points,sense,displaySense,selectedIndex){
  const box=$('geometryScanTableHost');
  if(!box) return;
  if(!points.length){
    box.classList.add('error-text');
    box.textContent='Angle calculation unavailable: enter valid initial/final H, K, L, ħω values.';
    return;
  }
  box.classList.remove('error-text');
  let fourCircle=false;
  try{ fourCircle=currentInstrument()?.instrument_type==='four-circle'; }catch(_e){}
  const rows=points.map((calc,i)=>{
    try{
      const target=qeGeometryAngles(cache,null,null,calc);
      const a=geometryDisplayedMotorAngles(target,false,sense,displaySense);
      const warnings=[];
      const plane=hklInCurrentScatteringPlane([calc.h,calc.k,calc.l]);
      if(!plane.ok) warnings.push(plane.error || 'Outside scattering plane');
      if(target.angles?.warning) warnings.push(target.angles.warning);
      warnings.push(...geometryScanStatusWarnings(target,a));
      warnings.push(...qeDarkBlockWarningsForHKLE(cache,[calc.h,calc.k,calc.l],calc.hw));
      const f=v=>Number.isFinite(v)?geometryResultMotorAngle(v):'—';
      const status=warnings.length?warnings.join(' / '):'';
      const rowClasses=[];
      if(i===selectedIndex) rowClasses.push('geometry-scan-selected-row');
      if(status) rowClasses.push('geometry-scan-warning-row');
      const rowClass=rowClasses.length?` class="${rowClasses.join(' ')}"`:'';
      return `<tr data-geometry-scan-row="${i}"${rowClass}><td class="geometry-scan-point-cell">${i+1}</td><td class="geometry-scan-hkl-cell">${calc.h.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.k.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.l.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.hw.toFixed(3)}</td><td>${f(a.m1)}</td><td>${f(a.m2)}</td><td>${f(a.s1)}</td><td>${f(a.s2)}</td>${fourCircle?`<td>${f(a.chi)}</td><td>${f(a.phi)}</td>`:''}<td>${f(a.a1)}</td><td>${f(a.a2)}</td><td>${status}</td></tr>`;
    }catch(err){
      const status=geometryScanErrorStatus(err);
      const rowClasses=['geometry-scan-warning-row'];
      if(i===selectedIndex) rowClasses.push('geometry-scan-selected-row');
      const rowClass=` class="${rowClasses.join(' ')}"`;
      return `<tr data-geometry-scan-row="${i}"${rowClass}><td class="geometry-scan-point-cell">${i+1}</td><td class="geometry-scan-hkl-cell">${calc.h.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.k.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.l.toFixed(3)}</td><td class="geometry-scan-hkl-cell">${calc.hw.toFixed(3)}</td><td colspan="${fourCircle?8:6}">—</td><td>${status}</td></tr>`;
    }
  }).join('');
  box.innerHTML=`<div class="geometry-scan-table-wrap"><table class="geometry-scan-table"><thead><tr><th>No.</th><th class="geometry-scan-hkl-head">H</th><th class="geometry-scan-hkl-head">K</th><th class="geometry-scan-hkl-head">L</th><th class="geometry-scan-hkl-head">ħω</th><th>M1</th><th>M2</th><th>S1</th><th>S2</th>${fourCircle?'<th>χ</th><th>φ</th>':''}<th>A1</th><th>A2</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  box.querySelectorAll('tbody tr[data-geometry-scan-row]').forEach(row=>{
    row.addEventListener('click',()=>{
      const i=Number(row.dataset.geometryScanRow);
      const slider=$('geomScanPointSlider');
      if(slider && Number.isInteger(i)) slider.value=String(i+1);
      syncGeometryScanPointSlider(points.length);
      if(getSingleCache() && checkedValue('sampleMode')==='single') fn.renderGeometry(getSingleCache(),Number($('hwSlider')?.value)||0);
    });
  });
}

function currentGeometryScanOutputTab(){
  return $('geometryScanTabPlot')?.classList.contains('active') ? 'plot' : 'table';
}

function setGeometryScanOutputTab(name){
  const plot=name==='plot';
  try{ localStorage.setItem(GEOMETRY_SCAN_OUTPUT_STORAGE_KEY,plot?'plot':'table'); }catch(_e){}
  $('geometryScanTabTable')?.classList.toggle('active',!plot);
  $('geometryScanTabPlot')?.classList.toggle('active',plot);
  $('geometryScanTabTable')?.setAttribute('aria-selected',String(!plot));
  $('geometryScanTabPlot')?.setAttribute('aria-selected',String(plot));
  $('geometryScanTablePane')?.classList.toggle('hidden',plot);
  $('geometryScanPlotPane')?.classList.toggle('hidden',!plot);
  updateGeometryAnglesVisibility();
  if(plot && getSingleCache() && checkedValue('sampleMode')==='single'){
    requestAnimationFrame(()=>requestAnimationFrame(()=>fn.renderGeometry(getSingleCache(),Number($('hwSlider')?.value)||0)));
  }
}

function moveGeometryPlotForMode(scan){
  const plot=$('geometryPlot');
  const mount=$(scan?'geometryScanPlotMount':'geometryDefaultPlotMount');
  if(plot && mount && plot.parentNode!==mount) mount.appendChild(plot);
}

function setGeometryCalculationMode(mode){
  const scan=mode==='scan';
  try{ localStorage.setItem(GEOMETRY_CALC_MODE_STORAGE_KEY,scan?'scan':'single'); }catch(_e){}
  $('geometryModeSingle')?.classList.toggle('active',!scan);
  $('geometryModeScan')?.classList.toggle('active',scan);
  $('geometryModeSingle')?.setAttribute('aria-selected',String(!scan));
  $('geometryModeScan')?.setAttribute('aria-selected',String(scan));
  updateGeometryCalculationModeVisibility();
  if(getSingleCache() && checkedValue('sampleMode')==='single'){
    requestAnimationFrame(()=>requestAnimationFrame(()=>fn.renderGeometry(getSingleCache(),Number($('hwSlider')?.value)||0)));
  }
}

function updateGeometryAnglesVisibility(){
  const singleSample=checkedValue('sampleMode')==='single';
  const scan=singleSample && geometryCalculationMode()==='scan';
  // In Scan mode the compact TAS summary belongs to the TAS geometry view,
  // while the Table tab keeps its existing table-only layout. Single/Powder
  // continue to show the summary exactly where they did before.
  const show=!scan || currentGeometryScanOutputTab()==='plot';
  $('geometryAngles')?.classList.toggle('hidden',!show);
}

function updateGeometryCalculationModeVisibility(){
  const singleSample=checkedValue('sampleMode')==='single';
  const scan=singleSample && geometryCalculationMode()==='scan';
  $('geometryCalcModeTabs')?.classList.toggle('hidden',!singleSample);
  $('singleGeometryTarget')?.classList.toggle('hidden',!singleSample || scan);
  $('scanGeometryTarget')?.classList.toggle('hidden',!scan);
  $('powderGeometryTarget')?.classList.toggle('hidden',singleSample);
  $('geometryScanOutput')?.classList.toggle('hidden',!scan);
  updateGeometryAnglesVisibility();
  $('geometryDefaultPlotMount')?.classList.toggle('hidden',scan);
  moveGeometryPlotForMode(scan);
}

function geometryResultSummaryHtml(cache,target,isPowder,sense,displaySense){
  const a=target.angles;
  const shown=geometryDisplayedMotorAngles(target,isPowder,sense,displaySense);
  const qValue=isPowder
    ? target.q
    : norm(hklToQ(cache.rl,[target.calc.h,target.calc.k,target.calc.l]));
  const hklLine=!isPowder
    ? `<div class="geometry-result-line geometry-hkl-line">(h,k,l)=(${[target.calc.h,target.calc.k,target.calc.l].map(v=>Number(v).toFixed(4)).join(', ')})</div>`
    : '';
  const energyLine=`Ei=${target.Ei.toFixed(3)} meV, Ef=${target.Ef.toFixed(3)} meV, Q=${qValue.toFixed(4)} Å⁻¹`;
  const diffractometer=['diffractometer','four-circle'].includes(currentInstrument()?.instrument_type);   // 4-circle: no analyzer
  const fourCircle=Number.isFinite(shown.chi);
  const angleLine=`M1=${geometryResultMotorAngle(shown.m1)}°, M2=${geometryResultMotorAngle(shown.m2)}°, S1=${geometryResultMotorAngle(shown.s1)}°, S2=${geometryResultMotorAngle(shown.s2)}°${fourCircle?`, χ=${geometryResultMotorAngle(shown.chi)}°, φ=${geometryResultMotorAngle(shown.phi)}°`:''}${diffractometer?'':`, A1=${geometryResultMotorAngle(shown.a1)}°, A2=${geometryResultMotorAngle(shown.a2)}°`}`+
    (!isPowder && a.warning?` &nbsp; | &nbsp; ${a.warning}`:'');
  const darkWarnings=!isPowder
    ? qeDarkBlockWarningsForHKLE(cache,[target.calc.h,target.calc.k,target.calc.l],target.calc.hw)
    : [];
  // Keep a dedicated warning row even when there is no current Dark-angle
  // warning.  Single and Scan TAS geometry therefore keep exactly the same
  // vertical footprint while the selected point changes.
  const spurionWarnings=!isPowder
    ? qeSpurionWarnings(cache,Number(target.calc.hw)).map(hit=>`Spurion ${hit.label}`)
    : [];
  // Four-circle: chi / phi beyond the cradle limits.
  const cradleWarnings=!isPowder && fourCircle
    ? geometryScanStatusWarnings(target,shown).filter(w=>/^[χφ]/.test(w))
    : [];
  const combinedWarnings=[...cradleWarnings,...spurionWarnings,...darkWarnings];
  const darkWarningText=combinedWarnings.length
    ? `Warning: ${combinedWarnings.join(' / ')}`
    : '&nbsp;';
  const darkWarningLine=!isPowder
    ? `<div class="geometry-result-line geometry-warning-line warning-text">${darkWarningText}</div>`
    : '';
  return `${hklLine}<div class="geometry-result-line geometry-energy-line">${energyLine}</div><div class="geometry-result-line geometry-angle-line">${angleLine}</div>${darkWarningLine}`;
}
}
