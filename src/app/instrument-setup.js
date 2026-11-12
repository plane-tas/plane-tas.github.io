// Instrument configuration: Q-E range tables, S2 limits, analyzer/monochromator crystals and defaults.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {interpExtrap} from '../core/tas-core.js';
import {normalizeS1Sign, normalizeTasSense, tasConvention} from '../core/tas-conventions.js';

export function createInstrumentSetup(deps){
  const {
    $, checkedValue, clearResolutionResults, instruments, num, setStatus, tasConventionFromLegacyUiSense,
    updateAutoW, updateEnergyLabel, getFixedBeamControls
  }=deps;

// Instrument type (mode).  An instrument file lists the types it supports in
// "instrument_setting" (default: its "instrument_type" only); the Type selector
// next to Instrument picks one.  Settings that differ by type live in a
// section named after it ("four_circle", "tas", "standard", "larmor", ...)
// and override the top-level values.  currentInstrument() returns that
// merged view.  Types: "tas", "four-circle", "diffractometer" and
// "larmor-diffractometer" (calculated as a diffractometer; the type is kept
// in instrument_mode).  A section may also set "instrument_type" (the
// calculation type) and "label" for a custom named configuration.
const INSTRUMENT_TYPE_LABELS={tas:'TAS','four-circle':'4-circle',diffractometer:'Diffractometer',
  'larmor-diffractometer':'Larmor diffractometer'};
const INSTRUMENT_CALCULATION_TYPES={'larmor-diffractometer':'diffractometer'};
function instrumentTypes(inst){
  // "instrument_setting" (older files: "instrument_types").
  const listed=Array.isArray(inst?.instrument_setting) ? inst.instrument_setting : inst?.instrument_types;
  const raw=Array.isArray(listed) && listed.length ? listed : [inst?.instrument_type || 'tas'];
  return [...new Set(raw.map(String))];
}
function defaultInstrumentType(inst){
  const list=instrumentTypes(inst);
  return list.includes(inst?.instrument_type) ? inst.instrument_type : list[0];
}
function selectedInstrumentType(inst){
  const list=instrumentTypes(inst);
  const v=$("instrumentType")?.value;
  return list.includes(v) ? v : defaultInstrumentType(inst);
}
function instrumentTypeSection(base,type){
  const section=base?.[String(type).replace(/-/g,'_')];
  return section && typeof section==='object' && !Array.isArray(section) ? section : {};
}
function instrumentTypeLabel(base,type){
  return instrumentTypeSection(base,type).label || INSTRUMENT_TYPE_LABELS[type] ||
    String(type).replace(/^./,c=>c.toUpperCase());
}
const effectiveInstrumentCache=new WeakMap();
function instrumentForType(base,type){
  let byType=effectiveInstrumentCache.get(base);
  if(!byType){ byType=new Map(); effectiveInstrumentCache.set(base,byType); }
  if(!byType.has(type)){
    const section=instrumentTypeSection(base,type);
    // A section overrides values; an object value is merged one level deep,
    // so "four_circle": {"configuration": {"Ei": 14.45}} changes only Ei.
    const merged={...base};
    for(const [k,v] of Object.entries(section)){
      const old=base[k];
      merged[k]=(v && typeof v==='object' && !Array.isArray(v) && old && typeof old==='object' && !Array.isArray(old))
        ? {...old,...v} : v;
    }
    byType.set(type,{...merged,instrument_mode:type,
      instrument_type:section.instrument_type||INSTRUMENT_CALCULATION_TYPES[type]||type});
  }
  return byType.get(type);
}
function currentInstrument(){
  const key=$("instrument").value;
  if(!key || !instruments.has(key)) throw new Error("Instrument を選択してください。");
  const base=instruments.get(key);
  return instrumentForType(base,selectedInstrumentType(base));
}
// Fill the Type selector for the selected instrument.  The current choice is
// kept while the instrument stays the same; a new instrument starts from its
// default type.
function populateInstrumentTypeSelect(){
  const select=$("instrumentType"), key=$("instrument")?.value;
  if(!select || !key || !instruments.has(key)) return;
  const base=instruments.get(key), list=instrumentTypes(base);
  const keep=select.dataset.instrument===key && list.includes(select.value) ? select.value : null;
  select.replaceChildren(...list.map(t=>{
    const o=document.createElement('option'); o.value=t; o.textContent=instrumentTypeLabel(base,t); return o;
  }));
  select.value=keep || defaultInstrumentType(base);
  select.dataset.instrument=key;
  select.disabled=list.length<2;
}
// When the types of an instrument differ in beam or crystals (Poplar,
// VERITAS energies), a type change re-applies all instrument defaults;
// otherwise only the type-dependent limits and labels change.
const FULL_DEFAULT_KEYS=['default_energy','energy_mode','configuration','qe_range',
  'available_crystals','monochromator','analyzer','sense','s1sign','geometry'];
function applyInstrumentTypeChange(){
  const key=$("instrument")?.value;
  if(!key || !instruments.has(key)) return;
  const base=instruments.get(key);
  // Re-apply everything when ANY type of this instrument sets its own beam or
  // crystals: switching back to a type without such a section must also
  // restore the top-level values (VERITAS TAS Ei = 14.5 after 4-circle 14.45).
  const anyFull=instrumentTypes(base).some(t=>FULL_DEFAULT_KEYS.some(k=>k in instrumentTypeSection(base,t)));
  if(anyFull) applyInstrumentDefaults();
  else{
    applyInstrumentTypeDefaults();
    applyInstrumentCrystalAvailability({preserveCurrent:true});
  }
}
// Settings that depend on the instrument type (limits, labels).
// S2 min / max fields show SIGNED values (the sign of the S2 motor for the
// selected Sense and S1 sign); every calculation uses their magnitudes.
function s2DisplaySign(){
  try{ return tasConvention(checkedValue('sense'),checkedValue('s1sign')).s2EncoderSign<0 ? -1 : 1; }catch(_e){ return 1; }
}
// Flip the shown S2 min / max to the sign of the current Sense / S1 sign.
function syncS2FieldSigns(){
  const sign=s2DisplaySign();
  for(const id of ['S2min','S2maxEffective']){
    const el=$(id), v=Number(el?.value);
    if(el && String(el.value).trim()!=='' && Number.isFinite(v)) el.value=formatS2ControlValue(sign*Math.abs(v));
  }
}
function applyInstrumentTypeDefaults(inst=currentInstrument()){
  const qr=inst.qe_range||{};
  const s2MinJson=Number(qr.S2_min ?? inst.S2_min ?? inst.default_S2min ?? 8.0);
  if($("S2min") && Number.isFinite(s2MinJson)) $("S2min").value=formatS2ControlValue(s2DisplaySign()*Math.abs(s2MinJson));
  // Sample-rotation (S1) limits; instruments without them keep the full turn.
  setIf("S1min",inst.S1_min ?? -180);
  setIf("S1max",inst.S1_max ?? 180);
  // Four-circle (bisecting): S1 = S2/2 is fixed, so a Bragg-peak orientation
  // reference is read on phi instead of S1.
  const refS1Text=$("refs1")?.closest("label")?.firstChild;
  if(refS1Text?.nodeType===3) refS1Text.nodeValue=inst.instrument_type==="four-circle" ? "φ (deg)" : "S1 (deg)";
  // Four-circle motor signs (CCW unless the instrument file says otherwise)
  // and the cradle limits (defaults from the instrument file, editable).
  setSelect("phiSign",String(inst.phi_sign||"ccw").toLowerCase());
  setSelect("chiSign",String(inst.chi_sign||"ccw").toLowerCase());
  for(const [id,v] of [['phiMin',inst.phi_min],['phiMax',inst.phi_max],['chiMin',inst.chi_min],['chiMax',inst.chi_max]]){
    if($(id)) $(id).value=Number.isFinite(Number(v)) && v!==null && v!=='' ? String(Number(v)) : '';
  }
  initializeS2MaxControl(inst);
}
function rangeTable(inst){
  if(Array.isArray(inst.S2_limits)) return inst.S2_limits;
  if(inst.qe_range && Array.isArray(inst.qe_range.S2_limits)) return inst.qe_range.S2_limits;
  if(inst.qe_range && Array.isArray(inst.qe_range.configuration)) return inst.qe_range.configuration;
  if(Array.isArray(inst.configuration)) return inst.configuration; // legacy QErange JSON
  throw new Error("Selected instrument has no S2-limit table. Add S2_limits to the unified instrument JSON (or keep the legacy instruments/ directory during migration).");
}
// Energy-transfer range of the Q-E maps from the crystal angle ranges in the
// instrument file:
//   "M2_min" / "M2_max": monochromator 2θ_M range (deg, magnitudes) -> Ei range
//   "A2_min" / "A2_max": analyzer 2θ_A motor range (deg, signed as on the
//                        instrument page; optional, default = M2 range)
// E = 81.8042 / λ², λ = 2 d sin(2θ/2), with the d of the selected crystal.
//   Ef fixed: ħω = Ei − Ef over the Ei range of M2 (negative ħω included).
//   Ei fixed: ħω = Ei − Ef over the Ef range of the analyzer: the largest
//             |2θ_A| gives the lowest Ef; when the A2 range reaches small
//             angles (it crosses 0°, or only A2_max is given) the high-Ef
//             side has no angular limit and is capped at Ef = 2 Ei
//             (ħω ≥ −Ei).  Without A2, the M2 range is used when it is a range.
// Without these entries, or for analyzer-free types, the previous range is
// used: 0 … (largest Ei of the S2 table − Ef) for Ef fixed, 0 … Ei for Ei fixed.
function angleRange(inst,key){
  const lo=Math.abs(Number(inst?.[`${key}_min`])), hi=Math.abs(Number(inst?.[`${key}_max`]));
  if(!Number.isFinite(lo) || !Number.isFinite(hi) || lo<=0 || hi<=0 || lo>=180 || hi>=180) return null;
  return {min:Math.min(lo,hi),max:Math.max(lo,hi)};
}
// Analyzer 2θ_A range -> magnitudes.  maxAbs: largest |2θ_A| (lowest Ef);
// minAbs: smallest |2θ_A| on a range that does not reach 0° (null when the
// small-angle side is unlimited).  A2_min = A2_max: fixed analyzer angle.
function analyzerAngleRange(inst){
  const lo=Number(inst?.A2_min), hi=Number(inst?.A2_max);
  const ends=[lo,hi].filter(Number.isFinite);
  if(!ends.length) return null;
  const maxAbs=Math.max(...ends.map(Math.abs));
  if(!(maxAbs>0 && maxAbs<180)) return null;
  let minAbs=null;
  if(ends.length===2 && Math.sign(lo)===Math.sign(hi) && lo!==0) minAbs=Math.min(Math.abs(lo),Math.abs(hi));
  return {maxAbs,minAbs};
}
function energyAtTwoTheta(d,twoTheta){
  const lambda=2*d*Math.sin(twoTheta*Math.PI/360);
  return lambda>0 ? 81.8042/(lambda*lambda) : NaN;
}
function energyRangeFromAngles(range,d){
  if(!range || !(d>0)) return null;
  const a=energyAtTwoTheta(d,range.min), b=energyAtTwoTheta(d,range.max);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return {min:Math.min(a,b),max:Math.max(a,b)};
}
function energyTransferRange(inst,{energyMode,Ei,Ef}){
  const analyzerFree=inst?.instrument_type==='diffractometer' || inst?.instrument_type==='four-circle';
  if(energyMode==='Ef fixed'){
    const m2=analyzerFree ? null : energyRangeFromAngles(angleRange(inst,'M2'),Number($('dMono')?.value));
    if(m2 && Ef>0) return {hwMin:m2.min-Ef,hwMax:m2.max-Ef,EiRange:m2,source:'M2'};
    const EiMax=Math.max(...rangeTable(inst).map(x=>Number(x.Ei)));
    return {hwMin:0,hwMax:EiMax-Ef,source:'S2 table'};
  }
  if(!analyzerFree && Ei>0){
    const dAna=Number($('dAna')?.value);
    const a2=analyzerAngleRange(inst);
    if(a2 && dAna>0){
      const efMin=energyAtTwoTheta(dAna,a2.maxAbs);
      const efMax=a2.minAbs ? energyAtTwoTheta(dAna,a2.minAbs) : 2*Ei;
      if(Number.isFinite(efMin) && Number.isFinite(efMax))
        return {hwMin:Ei-Math.max(efMin,efMax),hwMax:Ei-Math.min(efMin,efMax),EfRange:{min:Math.min(efMin,efMax),max:Math.max(efMin,efMax)},source:'A2'};
    }
    const m2=angleRange(inst,'M2');
    const ef=m2 && m2.max-m2.min>1e-9 ? energyRangeFromAngles(m2,dAna) : null;
    if(ef) return {hwMin:Ei-ef.max,hwMax:Ei-ef.min,EfRange:ef,source:'M2'};
  }
  return {hwMin:0,hwMax:Ei,source:'Ei'};
}
// ħω grid on multiples of `step` (0 included when inside the range); both
// Ei and Ef stay positive.  The step is 0.1 meV, coarsened for wide ranges
// (TAX, PTAX: 0.25-0.5 meV) so that a map has at most ~500 energy slices;
// every slice costs start-up and recalculation time.
const HW_GRID_MAX_SLICES=500;
function energyTransferGrid(range,{energyMode,Ei,Ef},step=null){
  if(!(step>0)){
    const span=Math.max(0,range.hwMax-range.hwMin);
    step=[0.1,0.2,0.25,0.5,1,2,5].find(v=>span/v<=HW_GRID_MAX_SLICES) ?? 5;
  }
  const out=[];
  const n0=Math.ceil(range.hwMin/step-1e-9), n1=Math.floor(range.hwMax/step+1e-9);
  for(let n=n0;n<=n1;n++){
    const hw=Number((n*step).toFixed(10));
    const EiHw=energyMode==='Ef fixed'?Ef+hw:Ei, EfHw=energyMode==='Ef fixed'?Ef:Ei-hw;
    if(EiHw>1e-6 && EfHw>1e-6) out.push(hw);
  }
  return out;
}
function instrumentInterp(inst,lambdaHalf=false){
  const table=rangeTable(inst);
  // S2 limits may be written signed (negative for an S2 < 0 instrument);
  // the calculation uses their magnitudes.
  const pairs=table.map(x=>[Number(x.Ei)*(lambdaHalf?4:1),Math.abs(Number(x.S2limit))]).sort((a,b)=>a[0]-b[0]);
  const xp=pairs.map(x=>x[0]), yp=pairs.map(x=>x[1]);
  return x=>interpExtrap(xp,yp,x);
}

// S2-limit policy is explicit in the instrument JSON.
//   s2_dep_ei = "yes": the JSON S2 maximum is evaluated from the Ei-dependent
//                      curve.  The user may edit either Delta S2 or the current
//                      Effective S2 max; editing Effective converts it back to a
//                      single Delta that is then applied to the full Ei curve.
//   s2_dep_ei = "no" : the JSON S2 maximum is constant, but the same two-way
//                      Delta/Effective controls are retained for a uniform UI.
// Legacy files without the flag keep backward-compatible behavior: if the
// table actually varies in S2limit, it is treated as Ei-dependent.
function s2DependsOnEi(inst){
  const raw=inst?.s2_dep_ei ?? inst?.qe_range?.s2_dep_ei;
  if(typeof raw==='string'){
    const v=raw.trim().toLowerCase();
    if(v==='yes') return true;
    if(v==='no') return false;
  }
  if(typeof raw==='boolean') return raw;
  const values=rangeTable(inst).map(x=>Math.abs(Number(x.S2limit))).filter(Number.isFinite);
  return values.some(v=>Math.abs(v-values[0])>1e-10);
}
function configuredConstantS2Max(inst){
  const first=rangeTable(inst).map(x=>Math.abs(Number(x.S2limit))).find(Number.isFinite);
  if(!Number.isFinite(first)) throw new Error('Selected instrument has no valid S2 maximum.');
  return first;
}
function s2ElasticIncidentEnergy(){
  const entered=num('energy');
  if(!(entered>0)) return NaN;
  return $('lambdaHalf')?.checked ? 4*entered : entered;
}
function baseS2MaxAtEi(inst,Ei,lambdaHalf=false){
  return s2DependsOnEi(inst) ? Number(instrumentInterp(inst,lambdaHalf)(Ei)) : configuredConstantS2Max(inst);
}
// S2 max: the instrument file gives the default.  It is editable, except
// for s2_dep_ei = "yes" instruments (CTAX, HODACA), whose Ei-dependent
// maximum is always taken from the file.
function effectiveS2MaxAtEi(inst,Ei,lambdaHalf=false){
  const base=baseS2MaxAtEi(inst,Ei,lambdaHalf);
  if(s2DependsOnEi(inst)) return base;
  const entered=Math.abs(Number($('S2maxEffective')?.value));
  return String($('S2maxEffective')?.value??'').trim()!=='' && Number.isFinite(entered) ? entered : base;
}
function formatS2ControlValue(x){
  return Number.isFinite(Number(x)) ? String(Number(Number(x).toFixed(3))) : '';
}
function initializeS2MaxControl(inst=currentInstrument()){
  updateS2MaxDisplay(inst,NaN,null,{reset:true});
}
function currentS2DisplayContext(inst=null,EiOverride=NaN,lambdaHalfOverride=null){
  inst=inst||currentInstrument();
  const lambdaHalf=lambdaHalfOverride===null
    ? (checkedValue('sampleMode')==='single' && !!$('lambdaHalf')?.checked)
    : !!lambdaHalfOverride;
  const Ei0=Number.isFinite(Number(EiOverride)) ? Number(EiOverride) : s2ElasticIncidentEnergy();
  const base=Number.isFinite(Ei0) ? baseS2MaxAtEi(inst,Ei0,lambdaHalf) : configuredConstantS2Max(inst);
  return {inst,lambdaHalf,Ei0,base};
}
// Ei-dependent instruments: always show the file value at the displayed Ei
// (read only).  Others: write the file value only on reset (instrument /
// type defaults) or when the field is empty, so a user edit is kept.
function updateS2MaxDisplay(inst=null,EiOverride=NaN,lambdaHalfOverride=null,{reset=false}={}){
  const out=$('S2maxEffective'); if(!out) return;
  try{
    const ctx=currentS2DisplayContext(inst,EiOverride,lambdaHalfOverride);
    const dep=s2DependsOnEi(ctx.inst);
    if(dep || reset || String(out.value).trim()==='') out.value=formatS2ControlValue(s2DisplaySign()*ctx.base);
    out.readOnly=dep;
    out.title=dep
      ? 'S2 maximum from the instrument file at the displayed Ei (read only: s2_dep_ei = "yes").'
      : 'S2 maximum (default from the instrument file).';
  }catch(_err){
    out.value='';
  }
}
// Kept for callers of the former editable S2 max; nothing to synchronise now.
function syncS2DeltaFromEffective(){}
function updateS2MaxDisplayForQERange(cache,index){
  if(!cache?.hwList?.length) return;
  const i=Math.max(0,Math.min(Number(index)||0,cache.hwList.length-1));
  const hw=Number(cache.hwList[i])||0;
  const Ei=cache.energyMode==='Ef fixed' ? cache.Ef+hw : cache.Ei;
  updateS2MaxDisplay(cache.inst,Ei,cache.lambdaHalf);
}
function validateEffectiveS2Max(S2max,S2min,Ei){
  if(!Number.isFinite(S2max)) throw new Error('S2 maximum is not a finite number.');
  if(S2max>180) throw new Error(`Effective S2 maximum (${S2max.toFixed(2)}°) exceeds 180°${Number.isFinite(Ei)?` at Ei=${Ei.toFixed(2)} meV`:''}.`);
  if(S2max<=S2min) throw new Error(`Effective S2 maximum (${S2max.toFixed(2)}°) must be greater than S2 minimum (${S2min.toFixed(2)}°)${Number.isFinite(Ei)?` at Ei=${Ei.toFixed(2)} meV`:''}.`);
  return S2max;
}

function normalizeCrystalName(name){ const aliases={PG002:"PG(002)",PG004:"PG(004)",Be002:"Be(002)",Si111:"Si(111)"}; return aliases[name]||name; }
function setIf(id,x){ if($(id)&&x!==undefined&&x!==null&&Number.isFinite(Number(x))) $(id).value=x; }
// Collimator: a key present with null / "" means "no collimator" (blank field).
function setColl(id,col,key){ if(!$(id)) return; if(key in col && (col[key]===null||col[key]==='')) $(id).value=''; else setIf(id,col[key]); }
function setBool(id,x){ if($(id)&&x!==undefined&&x!==null) $(id).checked=!!x; }
function setSelect(id,x){ if(!$(id)||x===undefined||x===null) return; if([...$(id).options].some(o=>o.value===String(x))) $(id).value=String(x); }
const CRYSTALS={'PG(002)':3.355,'PG(004)':1.677,'Be(002)':1.792,'Heusler':3.437,'CoFe':1.771,'Ge(111)':3.266,'Ge(113)':1.705923,'Ge(115)':1.088865,'Ge(311)':1.714,'Ge(511)':1.089,'Ge(533)':0.863,'Si(111)':3.135,'Si(220)':1.920,'Si(400)':1.358,'Si(331)':1.246,'Si(333)':1.045,'Si(440)':0.960,'Cu(111)':2.087,'Cu(002)':1.807,'Cu(220)':1.278,'Other':null};
// DEMAND (HB-3A) operates at fixed monochromator angle, so a Si reflection
// change selects one of its nominal incident wavelengths. Preserve the existing
// TAS convention internally (Ei fixed, meV) and reflect it in the chosen UI unit.
const DEMAND_MONO_WAVELENGTHS={'Si(331)':1.005,'Si(220)':1.546,'Si(111)':2.541,'Si(440)':1.546/2,'Si(333)':2.541/3};
function syncDEMANDIncidentEnergy(crystal){
  const inst=currentInstrument();
  if(!/DEMAND|HB[- ]?3A/i.test(String(inst?.name||''))) return;
  const lambda=DEMAND_MONO_WAVELENGTHS[crystal];
  if(!(lambda>0)) return;
  $('energyMode').value='Ei fixed';
  $('energy').value=String(Number((81.8042/(lambda*lambda)).toPrecision(12)));
  getFixedBeamControls()?.syncFromCanonical({preferredQuantity:'lambda_i'});
  $('energyMode').dispatchEvent(new Event('change',{bubbles:true}));
  $('energy').dispatchEvent(new Event('change',{bubbles:true}));
}

// WAND² has a fixed monochromator take-off angle.  Switching between its
// documented Ge(113)/Ge(115) settings must update the fixed incident wavelength.
// This is a nominal wavelength change, not an energy-resolved WAND² analysis.
const WAND2_MONO_WAVELENGTHS={'Ge(113)':1.486,'Ge(115)':0.95};
function syncWAND2IncidentEnergy(crystal){
  const inst=currentInstrument();
  if(!/WAND\s*(?:²|2)|HB[- ]?2C/i.test(String(inst?.name||''))) return;
  const lambda=WAND2_MONO_WAVELENGTHS[crystal];
  if(!(lambda>0)) return;
  $('energyMode').value='Ei fixed';
  $('energy').value=String(Number((81.8042/(lambda*lambda)).toPrecision(12)));
  getFixedBeamControls()?.syncFromCanonical({preferredQuantity:'lambda_i'});
  $('energyMode').dispatchEvent(new Event('change',{bubbles:true}));
  $('energy').dispatchEvent(new Event('change',{bubbles:true}));
}
function fillCrystal(selectId,dId){ const s=$(selectId); s.innerHTML=''; for(const k of Object.keys(CRYSTALS)){const o=document.createElement('option');o.value=k;o.textContent=k;s.appendChild(o);} s.value='PG(002)'; s.addEventListener('change',()=>{const d=CRYSTALS[s.value];if(d!=null) $(dId).value=d; $(dId).readOnly=false; $(dId).disabled=false; if(selectId==='monoCrystal'){syncDEMANDIncidentEnergy(s.value);syncWAND2IncidentEnergy(s.value);}}); $(dId).readOnly=false;$(dId).disabled=false; }

// The sidebar and Resolution use the same underlying selectors/d-spacing.
// Resolution's selector remains authoritative so all existing calculations,
// persistence and instrument JSON defaults continue to use the same state.
function initializeSidebarCrystalSelectors(){
  for(const [sidebarId,resolutionId] of [
    ['sidebarMonoCrystal','monoCrystal'],['sidebarAnaCrystal','anaCrystal']
  ]){
    const sidebar=$(sidebarId), resolution=$(resolutionId);
    if(!sidebar||!resolution) continue;
    sidebar.replaceChildren(...[...resolution.options].map(option=>option.cloneNode(true)));
    sidebar.value=resolution.value;
    sidebar.addEventListener('change',()=>{
      if(resolution.value===sidebar.value) return;
      resolution.value=sidebar.value;
      // Keep the original d-spacing, resolution plot, cache and persistence
      // updates in the established handler path.
      resolution.dispatchEvent(new Event('change',{bubbles:true}));
    });
    resolution.addEventListener('change',()=>{
      if(sidebar.value!==resolution.value) sidebar.value=resolution.value;
    });
  }
}
function syncSidebarCrystalSelectors(){
  for(const [sidebarId,resolutionId] of [
    ['sidebarMonoCrystal','monoCrystal'],['sidebarAnaCrystal','anaCrystal']
  ]){
    const sidebar=$(sidebarId), resolution=$(resolutionId);
    if(sidebar&&resolution&&sidebar.value!==resolution.value) sidebar.value=resolution.value;
  }
}
// Restrict both linked crystal selectors to the installed crystals listed in
// each instrument JSON. Unknown/missing crystal data is NOT inferred.
// Analyzer-free diffraction: diffractometers and the 4-circle mode (a
// diffractometer with an Eulerian cradle).  No analyzer selector, no TAS
// resolution, no analyzer in the TAS geometry drawing.
function instrumentIsDiffractometer(inst=currentInstrument()){
  return inst?.instrument_type==='diffractometer' || inst?.instrument_type==='four-circle';
}
function installedCrystalNames(inst,part){
  const raw=inst?.available_crystals?.[part] ?? inst?.[part]?.available_crystals ??
    (inst?.[part]?.crystal ? [inst[part].crystal] : []);
  return [...new Set((Array.isArray(raw)?raw:[raw]).map(normalizeCrystalName))]
    .filter(name=>Object.prototype.hasOwnProperty.call(CRYSTALS,name) && CRYSTALS[name]!=null);
}
function setCrystalOptions(part,inst,{preserveCurrent=false}={}){
  const mono=part==='monochromator';
  const main=$(mono?'monoCrystal':'anaCrystal');
  const sidebar=$(mono?'sidebarMonoCrystal':'sidebarAnaCrystal');
  const dInput=$(mono?'dMono':'dAna');
  const allowed=installedCrystalNames(inst,part);
  const old=main?.value;
  const preferred=normalizeCrystalName(inst?.[part]?.crystal);
  const selected=(preserveCurrent && allowed.includes(old) ? old :
    (allowed.includes(preferred) ? preferred : (allowed[0]||'')));
  const options=allowed.length ? allowed : [''];
  for(const select of [main,sidebar]){
    if(!select) continue;
    select.replaceChildren(...options.map(name=>{
      const option=document.createElement('option');
      option.value=name;
      option.textContent=name || 'Not specified in instrument JSON';
      return option;
    }));
    select.value=selected;
    select.disabled=!allowed.length;
  }
  if(dInput){
    // Manual d-spacing overrides are allowed for both monochromator and
    // analyzer.  Preserve an edited value across a UI refresh, but reload the
    // new instrument's JSON default when the instrument itself changes.
    const jsonD=Number(inst?.[part]?.d);
    const defaultD=(inst?.[part]?.d!=null && Number.isFinite(jsonD) && jsonD>0)
      ? jsonD : (selected ? CRYSTALS[selected] : null);
    if(!preserveCurrent || old!==selected || dInput.value===''){
      dInput.value=defaultD!=null?String(defaultD):'';
    }
    dInput.readOnly=false;
    dInput.disabled=false;
  }
}
function applyInstrumentCrystalAvailability({preserveCurrent=false}={}){
  if(!$('instrument')?.value || !instruments.has($('instrument').value)) return;
  const inst=currentInstrument();
  const diffraction=instrumentIsDiffractometer(inst);
  for(const id of ['sidebarAnalyzerCrystalWrap','resolutionAnalyzerFocusing',
    'resolutionAnalyzerCrystalSection','resolutionAnalyzerSizeSection']){
    $(id)?.classList.toggle('hidden',diffraction);
  }
  $('diffractometerResolutionNote')?.classList.toggle('hidden',!diffraction);
  // Only the TAS resolution model is implemented. Diffractometers must not
  // display even a previously calculated TAS ellipse or matrix.
  $('resolutionCalculation')?.classList.toggle('resolution-unavailable',diffraction);
  if(diffraction) clearResolutionResults?.();
  $('resolutionFocusingGrid')?.classList.toggle('resolution-is-diffractometer',diffraction);
  $('resolutionDistanceGrid')?.classList.toggle('resolution-is-diffractometer',diffraction);
  for(const el of document.querySelectorAll('#resolutionDistanceGrid .resolution-tas-distance'))
    el.classList.toggle('hidden',diffraction);
  $('resolutionSampleDetectorDistanceLabel')?.classList.toggle('hidden',!diffraction);
  // Detector type is editable. Only reset it from JSON on instrument change;
  // never overwrite a user's choice during a layout or local-state refresh.
  const detectorType=$('detectorType');
  if(detectorType && !preserveCurrent){
    detectorType.value=String(inst.detector?.type||'single').toLowerCase()==='anger'?'anger':'single';
  }
  setCrystalOptions('monochromator',inst,{preserveCurrent});
  if(!diffraction) setCrystalOptions('analyzer',inst,{preserveCurrent});
  else {
    // Keep hidden legacy Resolution parameters for compatibility; no physical analyzer selection.
    const sidebar=$('sidebarAnaCrystal');
    if(sidebar){ sidebar.replaceChildren(); sidebar.disabled=true; }
    if($('anaCrystal')) $('anaCrystal').disabled=true;
  }
}
// 3rd horizontal collimator: Soller or radial (combobox).  With radial the
// calculation uses the angular size of the analyzer seen from the sample; the
// entry box is replaced by that equivalent divergence (read-only, set after each
// resolution calculation).  The Soller value is kept for switching back.
function updateCollimator3UI(){
  const radial=$('coll3Type')?.value==='radial';
  const soller=$('div3h'), shown=$('div3hRadial');
  if(soller){ soller.hidden=radial; soller.disabled=radial; }
  if(shown) shown.hidden=!radial;
}
// The analyzer horizontal focusing selects the radial collimator by default.
function syncCollimator3WithAnalyzerFocus(){
  const hf=!!$('anaHF')?.checked;
  if($('coll3Type')) $('coll3Type').value=hf ? 'radial' : 'soller';
  updateCollimator3UI();
}
// 1st collimator: Soller (H / V divergence) or supermirror guide (m-value).
// The hidden #gm1 checkbox keeps the saved-settings key and the calculation input.
function updateSupermirrorUI(){
  const on=$("gm1").checked;
  if($('coll1Type')) $('coll1Type').value=on?'supermirror':'soller';
  $("div1m").disabled=!on; $("div1h").disabled=on; $("div1v").disabled=on;
  for(const el of document.querySelectorAll('.res-coll1-soller')) el.hidden=on;
  for(const el of document.querySelectorAll('.res-coll1-guide')) el.hidden=!on;
  updateFocusingTypeUI();
}
// Focusing: Flat / Focusing comboboxes mirror the hidden #monoHF, #monoVF,
// #anaHF and #anaVF checkboxes (saved-settings keys and calculation inputs).
const FOCUSING_TYPES=[['monoHType','monoHF'],['monoVType','monoVF'],['anaHType','anaHF'],['anaVType','anaVF']];
function updateFocusingTypeUI(){
  for(const [sel,box] of FOCUSING_TYPES) if($(sel) && $(box)) $(sel).value=$(box).checked ? 'focusing' : 'flat';
}

function applyInstrumentDefaults(){
  if(!$("instrument").value) return;
  populateInstrumentTypeSelect();
  const inst=currentInstrument();
  const cfg=(!Array.isArray(inst.configuration) && inst.configuration) ? inst.configuration : {};
  const qr=inst.qe_range||{};
  const energyMode=cfg.energy_mode || qr.energy_mode || inst.energy_mode || "Ef fixed";
  setSelect("energyMode",energyMode);
  const defaultEnergy=energyMode==="Ei fixed" ? (cfg.Ei ?? cfg.Ef ?? qr.default_energy ?? inst.default_energy ?? 14.7) : (cfg.Ef ?? cfg.Ei ?? qr.default_energy ?? inst.default_energy ?? 14.7);
  setIf("energy",defaultEnergy);
  applyInstrumentTypeDefaults(inst);
  const hasNewSense=cfg.sense!==undefined || (cfg.sign===undefined && (qr.sense!==undefined || inst.sense!==undefined));
  const rawSense=cfg.sense ?? cfg.sign ?? qr.sense ?? inst.sense ?? "-+-";
  const rawS1Sign=cfg.s1sign ?? qr.s1sign ?? inst.s1sign;
  let tasConvention;
  if(rawS1Sign!==undefined){
    tasConvention={sense:normalizeTasSense(rawSense),s1sign:normalizeS1Sign(rawS1Sign)};
  }else if(hasNewSense && (rawSense==="+-+" || rawSense==="-+-")){
    // New-format Sense without an explicit motor sign defaults to CCW.
    tasConvention={sense:normalizeTasSense(rawSense),s1sign:"ccw"};
  }else{
    // Backward compatibility for old JSON files whose `sign` stored one of the
    // pre-refactor combined Sense/S1 labels.
    tasConvention=tasConventionFromLegacyUiSense(rawSense);
  }
  setSelect("sense",tasConvention.sense);
  setSelect("s1sign",tasConvention.s1sign);
  syncS2FieldSigns();
  setSelect("geometry",cfg.geometry || "W");
  setSelect("method",(inst.approximation||{}).method);

  const mono=inst.monochromator||{}, ana=inst.analyzer||{}, col=inst.collimator||{}, sm=inst.supermirror||{}, dist=inst.distance||{}, beam=inst.beam||{}, det=inst.detector||{};
  setBool("gm1",sm.enabled); setIf("div1m",sm.m_value); setColl("div1h",col,'1st_h');setColl("div1v",col,'1st_v');setColl("div2h",col,'2nd_h');setColl("div2v",col,'2nd_v');setColl("div3h",col,'3rd_h');setColl("div3v",col,'3rd_v');setColl("div4h",col,'4th_h');setColl("div4v",col,'4th_v');
  setBool("monoHF",mono.hfocus);setBool("monoVF",mono.vfocus);setBool("anaHF",ana.hfocus);
  // "3rd_type": "radial" / "soller" in the collimator section; default: radial with a horizontally focusing analyzer.
  { const t=String(col['3rd_type']||'').toLowerCase(); const radial=t ? t==='radial' : !!ana.hfocus;
    if($('coll3Type')) $('coll3Type').value=radial?'radial':'soller'; updateCollimator3UI(); }
  setBool("anaVF",ana.vfocus);setIf("monoHB",mono.blade_h);setIf("monoVB",mono.blade_v);setIf("anaHB",ana.blade_h);setIf("anaVB",ana.blade_v);
  applyInstrumentCrystalAvailability();
  setIf("mosMonoH",mono.mosaic_h);setIf("mosMonoV",mono.mosaic_v);setIf("mosAnaH",ana.mosaic_h);setIf("mosAnaV",ana.mosaic_v);
  setIf("L0",dist.L0);setIf("L1",dist.L1);setIf("L2",dist.L2);setIf("L3",dist.L3);
  const sampleDetector=$('sampleDetectorDistance');
  if(sampleDetector) {
    // LSD is an independent distance. Never substitute L2 when it is unspecified.
    const lsd=dist.LSD;
    sampleDetector.value=lsd!=null && String(lsd).trim()!=='' && Number.isFinite(Number(lsd))
      ? String(lsd) : '';
  }
  if($('detectorType')) $('detectorType').value=String(det.type||'single').toLowerCase()==='anger'?'anger':'single';
  // Component sizes in instrument JSON are full dimensions in cm.
  setIf("srcWcm",beam.width);setIf("srcHcm",beam.height);setIf("monoWcm",mono.width);setIf("monoHcm",mono.height);setIf("monoTcm",mono.thickness);setIf("anaWcm",ana.width);setIf("anaHcm",ana.height);setIf("anaTcm",ana.thickness);setIf("detWcm",det.width);setIf("detHcm",det.height);
  const sourceCircle=String(beam.shape||'rectangle').toLowerCase()==='circle';
  if($('sourceShape')) $('sourceShape').value=sourceCircle ? 'circle' : 'rectangle';
  const detectorRect=String(det.shape||'cylinder').toLowerCase()==='rectangle';
  if($('detectorShape')) $('detectorShape').value=detectorRect ? 'rectangle' : 'cylinder';
  if(instrumentIsDiffractometer(inst)){
    // A missing JSON value means "not specified", NOT a value inherited from
    // the previous instrument or from static HTML defaults. This is critical
    // for WAND² and DEMAND: their TAS-style resolution data are incomplete.
    const optionalFields=[
      ['div1m',sm.m_value],
      ['div1h',col['1st_h']],['div1v',col['1st_v']],
      ['div2h',col['2nd_h']],['div2v',col['2nd_v']],
      ['div3h',col['3rd_h']],['div3v',col['3rd_v']],
      ['div4h',col['4th_h']],['div4v',col['4th_v']],
      ['monoHB',mono.blade_h],['monoVB',mono.blade_v],
      ['anaHB',ana.blade_h],['anaVB',ana.blade_v],
      ['mosMonoH',mono.mosaic_h],['mosMonoV',mono.mosaic_v],
      ['mosAnaH',ana.mosaic_h],['mosAnaV',ana.mosaic_v],
      ['L0',dist.L0],['L1',dist.L1],['L2',dist.L2],['L3',dist.L3],
      ['srcWcm',beam.width],['srcHcm',beam.height],
      ['monoWcm',mono.width],['monoHcm',mono.height],['monoTcm',mono.thickness],
      ['anaWcm',ana.width],['anaHcm',ana.height],['anaTcm',ana.thickness],
      ['detWcm',det.width],['detHcm',det.height]
    ];
    for(const [id,value] of optionalFields){
      if(value===undefined || value===null || !Number.isFinite(Number(value))){
        const input=$(id);
        if(input) input.value='';
      }
    }
    // Avoid inheriting a previous monochromator's focusing checkboxes when
    // this diffractometer's JSON does not specify the corresponding setting.
    for(const [id,value] of [['monoHF',mono.hfocus],['monoVF',mono.vfocus]]){
      if(value===undefined || value===null){const control=$(id);if(control) control.checked=false;}
    }
  }
  updateEnergyLabel();
  // Use wavelength by default for incident-fixed diffractometers, while
  // conventional TAS instruments retain meV. User choices are restored later.
  const pref=(inst.instrument_type==='diffractometer' && energyMode==='Ei fixed') ? 'lambda_i' : (energyMode==='Ei fixed'?'Ei':'Ef');
  getFixedBeamControls()?.syncFromCanonical({preferredQuantity:pref});
  updateSupermirrorUI();updateAutoW();setStatus(`${inst.name || $("instrument").value} loaded`);
}

  return {
    syncS2FieldSigns, updateCollimator3UI, syncCollimator3WithAnalyzerFocus,
    applyInstrumentCrystalAvailability, applyInstrumentDefaults, applyInstrumentTypeChange, applyInstrumentTypeDefaults, currentInstrument, effectiveS2MaxAtEi,
    fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer, rangeTable,
    energyTransferRange, energyTransferGrid,
    syncS2DeltaFromEffective, syncSidebarCrystalSelectors, updateS2MaxDisplay,
    updateS2MaxDisplayForQERange, updateSupermirrorUI, updateFocusingTypeUI, validateEffectiveS2Max
  };
}
