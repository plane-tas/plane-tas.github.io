// TAS geometry: the Angle-calculation result (motor angles, limit and
// Dark-angle warnings), the scattering-plane warning and which target
// controls (Single crystal or Powder) are shown.
// Part of the TAS geometry view (see ../tas-geometry-view.js for how the parts are wired).
import {displayedMotorAngles} from '../../core/tas-conventions.js';
export function installGeometryResultPanel(ctx){
  const {deps:{
    $, checkedValue, currentInstrument, effectiveS2MaxAtEi, formatAngle, hklToQ, norm, num,
    qeDarkBlockWarningsForHKLE, qeGeometryAngles, qeSpurionWarnings,
    scatteringPlaneWarningMessage, setScatteringPlaneWarning
  }, fn}=ctx;
  Object.assign(fn,{
    geometryPointWarnings, geometryResultSummaryHtml,
    updateGeometryTargetVisibility, updateGeometryPlaneWarning
  });

function geometryDisplayedMotorAngles(target,isPowder,sense,displaySense){
  void sense; void displaySense;
  const a=target.angles;
  const shown=displayedMotorAngles({m1:Number(a.m1),m2:Number(a.m2),s1:Number(a.s1),s2:Number(a.s2),a1:Number(a.a1),a2:Number(a.a2)},isPowder,
    {msign:$('msign')?.value,asign:$('asign')?.value});
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

// Motor-limit warnings (S1, S2 and the four-circle χ / φ) of a target.
function geometryLimitWarnings(target,displayedAngles){
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
  const target=qeGeometryAngles(cache,null,calc);
  const a=geometryDisplayedMotorAngles(target,false);
  const out=geometryLimitWarnings(target,a);
  if(target.angles?.warning) out.push('S1 unavailable (reference Q)');
  return out;
}
function updateGeometryPlaneWarning(){
  if(checkedValue('sampleMode')!=='single'){
    setScatteringPlaneWarning('geometryPlaneWarning','');
    return;
  }
  const hkl=[num('geomH'),num('geomK'),num('geomL')];
  setScatteringPlaneWarning('geometryPlaneWarning',scatteringPlaneWarningMessage(hkl));
}

// Single crystal: h, k, l, ħω target; Powder: the linked S2 / Q target.
function updateGeometryTargetVisibility(){
  const singleSample=checkedValue('sampleMode')==='single';
  $('singleGeometryTarget')?.classList.toggle('hidden',!singleSample);
  $('powderGeometryTarget')?.classList.toggle('hidden',singleSample);
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
  // Keep a dedicated warning row even when there is no current warning, so
  // the result keeps the same height while the target changes.
  const spurionWarnings=!isPowder
    ? qeSpurionWarnings(cache,Number(target.calc.hw)).map(hit=>`Spurion ${hit.label}`)
    : [];
  // Four-circle: chi / phi beyond the cradle limits.
  const cradleWarnings=!isPowder && fourCircle
    ? geometryLimitWarnings(target,shown).filter(w=>/^[χφ]/.test(w))
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
