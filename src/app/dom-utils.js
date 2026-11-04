// DOM / form-value helpers shared by app.js and the feature modules.
// Moved out of app.js unchanged (refactor only).
import {normalizeS1Sign, normalizeTasSense} from '../core/tas-conventions.js';

export const $ = id => document.getElementById(id);

export function parseNumericValue(value){
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

export function num(id){
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
export function tasConventionFromLegacyUiSense(value){
  // Backward-compatibility parser for pre-refactor saved settings / instrument
  // files.  Legacy four-state labels are converted once at the input boundary.
  if(value==="+++") return {sense:"+-+",s1sign:"ccw"};
  if(value==="+-+") return {sense:"+-+",s1sign:"cw"};
  if(value==="---") return {sense:"-+-",s1sign:"cw"};
  return {sense:"-+-",s1sign:"ccw"};
}

export function selectedTasSense(){ return normalizeTasSense(checkedValue("sense")); }

export function selectedS1Sign(){ return normalizeS1Sign(checkedValue("s1sign")); }

export function checkedValue(name){
  const direct=$(name);
  if(direct && direct.tagName==="SELECT") return direct.value;
  const el=document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

export function setRadio(name,value){
  const direct=$(name);
  if(direct && direct.tagName==="SELECT") { direct.value=value; return; }
  const el=document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if(el) el.checked=true;
}

export function userFacingTasMessage(value){
  return String(value??'').replace(/\bsv1\b/g,'U').replace(/\bsv2\b/g,'V');
}

export function showError(err){
  const raw=err instanceof Error ? err.message : String(err);
  $("errorBox").textContent = userFacingTasMessage(raw);
  $("errorBox").classList.remove("hidden");
}

export function clearError(){ $("errorBox").classList.add("hidden"); $("errorBox").textContent=""; }

export function setStatus(text){ $("status").textContent=text; }

export function latticeParams(){
  return {
    a:num("a"), b:num("b"), c:num("c"),
    alpha:num("alpha"), beta:num("beta"), gamma:num("gamma")
  };
}
