// Instrument configuration: Q-E range tables, S2 limits, analyzer/monochromator crystals and defaults.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {normalizeS1Sign, readTasSense, tasConvention} from '../core/tas-conventions.js';
import {fileTasConvention, s2FileRange} from './s2-range.js';
import {energyFromWavelength, wavelengthFromEnergy} from '../core/neutron-units.js';
import {sideRange, sideRangeFields} from './motor-range.js';
import {selectedTasSense} from './dom-utils.js';

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
// merged view.  Types: "tas", "multiplexing" (calculated as a TAS),
// "four-circle", "diffractometer" and "larmor-diffractometer" (calculated as
// a diffractometer; the type is kept in instrument_mode).  A section may also set "instrument_type" (the
// calculation type) and "label" for a custom named configuration.
const INSTRUMENT_TYPE_LABELS={tas:'TAS',multiplexing:'Multiplexing','four-circle':'4-circle',diffractometer:'Diffractometer',
  'larmor-diffractometer':'Larmor diffractometer'};
// "multiplexing" (HODACA) is calculated as a TAS; the type is kept in
// instrument_mode.
const INSTRUMENT_CALCULATION_TYPES={'larmor-diffractometer':'diffractometer',multiplexing:'tas'};
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
  if(!key || !instruments.has(key)) throw new Error("Select an instrument.");
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
  'available_crystals','monochromator','analyzer','sense','s1sign','s_sign','m_sign','a_sign','geometry'];  // geometry: older files
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
  try{ return tasConvention(selectedTasSense(),checkedValue('s1sign')).s2EncoderSign<0 ? -1 : 1; }catch(_e){ return 1; }
}
// Flip the shown S2 min / max to the sign of the current Sense / S1 sign.
function syncS2FieldSigns(){
  // A change of scattering side uses the limits of that side.
  const near=$('S2min');
  if(near && near.dataset.side && near.dataset.side!==s2SideKey()){
    try{ updateS2MaxDisplay(null,NaN,null,{reset:true}); }catch(_e){}
    syncM2FieldSigns();
    return;
  }
  orderS2Fields();
  const sign=s2DisplaySign();
  for(const id of ['S2min','S2maxEffective']){
    const el=$(id), v=Number(el?.value);
    if(el && String(el.value).trim()!=='' && Number.isFinite(v)) el.value=formatS2ControlValue(sign*Math.abs(v));
  }
  syncM2FieldSigns();
}
// M2 and A2 ranges: the part of the file range on the side of the page's
// Sense M / Sense A, as readings for the M2 / A2 sign (see motor-range.js),
// in numerical order.  A change of side or motor sign puts back the file
// values; edits are kept otherwise.  Blank = no limit.
const ANGLE_MOTORS={
  M2:{lo:'M2min',hi:'M2max',sign:'msign',fileSign:'m_sign',side:c=>c.monoSign,name:'M2',sense:'Sense M'},
  A2:{lo:'A2min',hi:'A2max',sign:'asign',fileSign:'a_sign',side:c=>c.analyzerSign,name:'A2',sense:'Sense A'}
};
function motorEnc(v){ return normalizeS1Sign(v)==="cw" ? -1 : 1; }
function fileMotorEnc(inst,key){
  const cfg=(!Array.isArray(inst?.configuration) && inst?.configuration) ? inst.configuration : {};
  const f=ANGLE_MOTORS[key].fileSign;
  return motorEnc(cfg[f] ?? inst?.qe_range?.[f] ?? inst?.[f] ?? "ccw");
}
function pageMotorSide(key){
  const m=ANGLE_MOTORS[key];
  let side=1;
  try{ side=m.side(tasConvention(selectedTasSense(),checkedValue('s1sign'))); }catch(_e){}
  return {side,enc:motorEnc($(m.sign)?.value)};
}
function angleSideKey(key){ const p=pageMotorSide(key); return `${p.side},${p.enc}`; }
function fileAngleRange(inst,key){
  const {side,enc}=pageMotorSide(key);
  return sideRange(inst?.[`${key}_min`],inst?.[`${key}_max`],fileMotorEnc(inst,key),side,enc);
}
function applyAngleRangeDefaults(key,inst=currentInstrument()){
  const m=ANGLE_MOTORS[key], lo=$(m.lo), hi=$(m.hi);
  if(!lo || !hi) return;
  const {side,enc}=pageMotorSide(key);
  const range=fileAngleRange(inst,key);
  // M2: no small-angle limit in the file (a range crossing the beam) is
  // shown as MIN_CRYSTAL_TWO_THETA, the value the Ei range uses.
  const r=range && key==='M2' && range.near===0 ? {...range,near:side*enc*MIN_CRYSTAL_TWO_THETA} : range;
  const [a,b]=sideRangeFields(r,side,enc);
  setAngleField(m.lo,a); setAngleField(m.hi,b);
  lo.dataset.side=angleSideKey(key);
  lo.dataset.unreachable=range ? '' : '1';
}
// Error when the range of the instrument file does not reach the side of
// the page (M2 for every type, A2 for TAS).
function checkAngleRangeSides(inst=currentInstrument()){
  for(const key of Object.keys(ANGLE_MOTORS)){
    if(key==='A2' && (inst?.instrument_type||'tas')!=='tas') continue;
    const m=ANGLE_MOTORS[key], lo=$(m.lo);
    if(lo?.dataset.unreachable==='1') throw new Error(`The ${m.name} range of the instrument does not reach this side (${m.sense}).`);
  }
}
function syncM2FieldSigns(){
  let inst=null;
  try{ inst=currentInstrument(); }catch(_e){ return; }
  for(const key of Object.keys(ANGLE_MOTORS)){
    const lo=$(ANGLE_MOTORS[key].lo);
    if(lo && lo.dataset.side!==angleSideKey(key)) applyAngleRangeDefaults(key,inst);
  }
}
function setAngleField(id,value){
  const el=$(id); if(!el) return;
  el.value=value!==undefined && value!==null && value!=='' && Number.isFinite(Number(value)) ? String(Number(value)) : '';
}
// S2 range of the instrument file: "S2_min" and "S2_max" are the two ends
// of the S2 motor (readings for the Sense and S1 sign of the file, min < max).
// Each end is a number or a table of the monochromator angle,
// [{"M2": ..., "S2": ...}, ...] (interpolated at the M2 of the energy, end
// values outside), for a limit set by the monochromator shielding.  The page
// uses the part of the range on its scattering side (from the Sense S and the
// S1 sign): the end on that side is the large-angle limit; the small-angle
// limit is the other end when both ends are on that side, otherwise 0 (to
// be entered on the page).  Older files: "S2_min"
// (small-angle limit) with the table "S2_limits" of (M2, S2limit).
// The S2 limits on the scattering side of the page: rows of the large-angle
// (far) and small-angle (near) limits as magnitudes, or null if the range of
// the file does not reach that side.
function s2SideLimits(inst){
  const {ends}=s2FileRange(inst);
  // Physical side (+ = counter-clockwise) of the sample scattering.
  const fileS1=fileTasConvention(inst).s1EncoderSign;
  let page=1;
  try{ page=tasConvention(selectedTasSense(),checkedValue('s1sign')).sampleScatteringSign; }catch(_e){}
  const phys=rows=>Math.sign(rows.find(r=>r.S2!==0)?.S2 ?? 0)*fileS1;
  const mag=rows=>rows.map(r=>({...r,S2:Math.abs(r.S2)}));
  const size=rows=>Math.max(...rows.map(r=>Math.abs(r.S2)));
  const here=ends.filter(rows=>phys(rows)===page);
  if(!here.length) return null;
  if(here.length===2){
    const [a,b]=size(here[0])>=size(here[1]) ? here : [here[1],here[0]];
    return {far:mag(a),near:mag(b)};
  }
  // The range crosses the beam: no small-angle limit in the file (0; it is
  // entered on the page).
  return {far:mag(here[0]),near:[{M2:0,S2:0},{M2:180,S2:0}]};
}
const S2_SIDE_ERROR='The S2 range of the instrument does not reach this scattering side (Sense S).';
function applyInstrumentTypeDefaults(inst=currentInstrument()){
  // Sample-rotation (S1) limits; instruments without them keep the full turn.
  // Monochromator / analyzer angle ranges (editable; blank = not given).
  applyAngleRangeDefaults('M2',inst); applyAngleRangeDefaults('A2',inst);
  setIf("S1min",inst.S1_min ?? -180);
  setIf("S1max",inst.S1_max ?? 180);
  // Four-circle (bisecting): S1 = S2/2 is fixed, so a Bragg-peak orientation
  // reference is read on phi instead of S1.
  const refS1Name=inst.instrument_type==="four-circle" ? "φ" : "S1";
  if($("braggS1Head")) $("braggS1Head").textContent=`${refS1Name} (deg)`;
  for(const n of [1,2]) $(n===1?"refs1":"refs12")?.setAttribute("aria-label",`Peak ${n} ${refS1Name} (deg)`);
  // Four-circle motor signs (CCW unless the instrument file says otherwise)
  // and the cradle limits (defaults from the instrument file, editable).
  setSelect("phiSign",String(inst.phi_sign||"ccw").toLowerCase());
  setSelect("chiSign",String(inst.chi_sign||"ccw").toLowerCase());
  for(const [id,v] of [['phiMin',inst.phi_min],['phiMax',inst.phi_max],['chiMin',inst.chi_min],['chiMax',inst.chi_max]]){
    if($(id)) $(id).value=Number.isFinite(Number(v)) && v!==null && v!=='' ? String(Number(v)) : '';
  }
  initializeS2MaxControl(inst);
}
// Large-angle S2 limit on the scattering side of the page, as rows of
// (M2 or Ei, S2limit) magnitudes.
function rangeTable(inst){
  const side=s2SideLimits(inst);
  if(!side) throw new Error(S2_SIDE_ERROR);
  return side.far.map(r=>({M2:r.M2,Ei:r.Ei,S2limit:r.S2}));
}
function nearRangeTable(inst){
  const side=s2SideLimits(inst);
  if(!side) throw new Error(S2_SIDE_ERROR);
  return side.near.map(r=>({M2:r.M2,Ei:r.Ei,S2limit:r.S2}));
}
// Energy-transfer range of the Q-E maps from the crystal angle ranges in the
// instrument file:
//   "M2_min" / "M2_max": monochromator 2θ_M range (deg; signed as the motor, e.g.
//                        negative for -+-; magnitudes are used) -> Ei range
//   "A2_min" / "A2_max": analyzer 2θ_A motor range (deg, signed as on the
//                        instrument page; optional, default = M2 range;
//                        set in the instrument file only, not in the UI)
// E = 81.8042 / λ², λ = 2 d sin(2θ/2), with the d of the selected crystal.
//   Ef fixed: ħω = Ei − Ef over the Ei range of M2 (negative ħω included).
//   Ei fixed: ħω = Ei − Ef over the Ef range of the analyzer: the largest
//             |2θ_A| gives the lowest Ef; when the A2 range reaches small
//             angles (it crosses 0°, or only A2_max is given) the high-Ef
//             side has no angular limit and is capped at Ef = 2 Ei
//             (ħω ≥ −Ei).  Without A2, the M2 range is used when it is a range.
// Without these entries, or for analyzer-free types, the previous range is
// used: 0 … (largest Ei of the S2 table − Ef) for Ef fixed, 0 … Ei for Ei fixed.
// The Motor table fields (M2 min, max) hold these values after an
// instrument is selected; the calculation reads the fields when present
// (A2 has no field: always the instrument file).
function angleLimit(inst,key,end){
  const el=$(`${key}${end}`);
  if(el){ const t=String(el.value??'').trim(); return t==='' ? NaN : Number(t); }
  const v=inst?.[`${key}_${end}`];
  return v===undefined || v===null || v==='' ? NaN : Number(v);
}
// 2θ range (magnitudes).  Each end counts on its own: a small-angle end that
// is blank or 0 (a range crossing the beam) is taken as MIN_CRYSTAL_TWO_THETA,
// a large-angle end that is blank or 180 as backscattering (180).  null when
// neither end is given.
const MIN_CRYSTAL_TWO_THETA=10;
function angleRange(inst,key){
  const lo=Math.abs(angleLimit(inst,key,'min')), hi=Math.abs(angleLimit(inst,key,'max'));
  const ends=[lo,hi].filter(Number.isFinite);
  if(!ends.length) return null;
  const given=ends.filter(v=>v>0 && v<180);
  let a=ends.length===2 ? Math.min(lo,hi) : NaN, b=ends.length===2 ? Math.max(lo,hi) : (given[0] ?? NaN);
  if(!(a>0)) a=MIN_CRYSTAL_TWO_THETA;
  if(!(b<180) || !(b>0)) b=180;
  // Smaller angles reach very high energies (and slow maps, e.g. while a
  // value is being typed): the range is used from MIN_CRYSTAL_TWO_THETA.
  a=Math.max(a,MIN_CRYSTAL_TWO_THETA); b=Math.max(b,MIN_CRYSTAL_TWO_THETA);
  if(b<a) a=b;
  return {min:a,max:b};
}
// Analyzer 2θ_A range -> magnitudes.  maxAbs: largest |2θ_A| (lowest Ef);
// minAbs: smallest |2θ_A| on a range that does not reach 0° (null when the
// small-angle side is unlimited).  A2_min = A2_max: fixed analyzer angle.
function analyzerAngleRange(inst){
  const lo=angleLimit(inst,'A2','min'), hi=angleLimit(inst,'A2','max');
  const ends=[lo,hi].filter(Number.isFinite);
  if(!ends.length) return null;
  let maxAbs=Math.max(...ends.map(Math.abs));
  if(!(maxAbs>0)) return null;
  // No large-angle limit: backscattering; nothing below MIN_CRYSTAL_TWO_THETA.
  if(maxAbs>180) maxAbs=180;
  maxAbs=Math.max(maxAbs,MIN_CRYSTAL_TWO_THETA);
  let minAbs=null;
  if(ends.length===2 && Math.sign(lo)===Math.sign(hi) && lo!==0) minAbs=Math.max(MIN_CRYSTAL_TWO_THETA,Math.min(Math.abs(lo),Math.abs(hi)));
  return {maxAbs,minAbs};
}
function energyAtTwoTheta(d,twoTheta){
  const lambda=2*d*Math.sin(twoTheta*Math.PI/360);
  return lambda>0 ? energyFromWavelength(lambda) : NaN;
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
    // Largest Ei of the S2 table: its smallest monochromator angle (older
    // tables: their largest Ei); a table spanning 0-180 deg gives no limit.
    const legacyEi=rangeTable(inst).map(x=>Number(x.Ei)).filter(v=>v>0);
    const m2s=rangeTable(inst).map(x=>Math.abs(Number(x.M2))).filter(v=>v>0 && v<180);
    const EiTable=legacyEi.length ? Math.max(...legacyEi) : (m2s.length ? energyAtTwoTheta(Number($('dMono')?.value),Math.min(...m2s)) : NaN);
    const EiMax=Number.isFinite(EiTable) && EiTable>Ef ? EiTable : 2*Ef;
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
// ħω slices of the Q-E maps: one step over the whole range, the finest of
// 0.1, 0.25, 0.5, 1, 2, 5 ... meV that keeps the slices <= 200 (e.g. CTAX
// 0.1, PTAX 0.25, TAX 1 meV).  The Angle calculation takes any ħω.
const HW_GRID_MAX_SLICES=200;
const HW_GRID_STEPS=[0.1,0.25,0.5,1,2,5,10,20,50,100];
function energyTransferGrid(range,{energyMode,Ei,Ef},step=null){
  if(!(step>0)){
    const span=Math.max(0,range.hwMax-range.hwMin);
    step=HW_GRID_STEPS.find(v=>span/v<=HW_GRID_MAX_SLICES) ?? HW_GRID_STEPS[HW_GRID_STEPS.length-1];
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
// S2 maximum: table "S2_limits" of (M2, S2limit) rows in the instrument file,
// M2 = monochromator 2θ_M (deg, signed as the motor: negative for -+-;
// magnitudes are used), at least two rows; a constant maximum is
// given by two rows with the same S2limit (e.g. M2 = 0 and 180).  The S2
// limit (shielding / guide-wall interference) depends on the monochromator
// angle, so the table holds for any monochromator crystal.  The M2 of an Ei
// uses the d of the selected monochromator and the fundamental wavelength:
// with λ/2 the elastic neutrons have 4 Ei but the monochromator is set for
// the entered energy.  Older tables of (Ei, S2limit) rows are converted with
// the selected d.  Outside the table the end values are used.
function monochromatorTwoTheta(Ei,lambdaHalf=false){
  const d=Number($('dMono')?.value);
  const E=lambdaHalf ? Ei/4 : Ei;
  if(!(d>0) || !(E>0)) return NaN;
  const s=wavelengthFromEnergy(E)/(2*d);
  return s<1 ? 2*Math.asin(s)*180/Math.PI : NaN;
}
function s2LimitRows(inst,table=null){
  return (table||rangeTable(inst)).map(x=>{
    const S2=Math.abs(Number(x.S2limit));
    // M2 may be written signed (negative for a -+- instrument); magnitudes are used.
    const M2=Number.isFinite(Number(x.M2)) && x.M2!==null && x.M2!=='' ? Math.abs(Number(x.M2)) : monochromatorTwoTheta(Number(x.Ei));
    return [M2,S2];
  }).filter(([M2,S2])=>Number.isFinite(M2) && Number.isFinite(S2)).sort((p,q)=>p[0]-q[0]);
}
function instrumentInterp(inst,lambdaHalf=false,table=null){
  const rows=s2LimitRows(inst,table);
  return Ei=>{
    if(!rows.length) return NaN;
    const M2=monochromatorTwoTheta(Ei,lambdaHalf);
    // Beyond the monochromator's reach (λ > 2d): the largest-angle end.
    const x=Number.isFinite(M2) ? M2 : rows[rows.length-1][0];
    if(x<=rows[0][0]) return rows[0][1];
    if(x>=rows[rows.length-1][0]) return rows[rows.length-1][1];
    const j=rows.findIndex(r=>r[0]>=x);
    const [x0,y0]=rows[j-1],[x1,y1]=rows[j];
    return x1>x0 ? y0+(y1-y0)*(x-x0)/(x1-x0) : y1;
  };
}
// A table whose S2limit varies is applied at the current M2 and shown read
// only; a constant one is the editable default of the S2 max field.
function s2DependsOnEi(inst,table=null){
  let values=[];
  try{ values=s2LimitRows(inst,table).map(r=>r[1]); }catch(_e){ return false; }
  return values.some(v=>Math.abs(v-values[0])>1e-10);
}
// Small-angle limit on the page's side at an Ei (magnitude).
function s2NearAtEi(inst,Ei,lambdaHalf=false){
  const table=nearRangeTable(inst);
  return Number.isFinite(Number(Ei)) ? Number(instrumentInterp(inst,lambdaHalf,table)(Ei)) : Math.abs(Number(table[0]?.S2limit));
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
// when the table varies with M2 (CTAX, HODACA): then the value at the
// current monochromator angle is always taken from the file.
function effectiveS2MaxAtEi(inst,Ei,lambdaHalf=false){
  checkAngleRangeSides(inst);
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
  const out=$('S2maxEffective'), nearOut=$('S2min'); if(!out) return;
  orderS2Fields();
  if(reset && nearOut) nearOut.dataset.side=s2SideKey();
  // Small-angle limit: the file value is the default (editable); a limit
  // that varies with M2 is shown read only at the current energy.
  try{
    inst=inst||currentInstrument();
    const ctx=currentS2DisplayContext(inst,EiOverride,lambdaHalfOverride);
    const dep=s2DependsOnEi(inst,nearRangeTable(inst));
    if(nearOut && (dep || reset || String(nearOut.value).trim()==='')) nearOut.value=formatS2ControlValue(s2DisplaySign()*s2NearAtEi(inst,ctx.Ei0,ctx.lambdaHalf));
    if(nearOut) nearOut.readOnly=dep;
  }catch(_e){ if(nearOut && reset) nearOut.value=''; }
  try{
    const ctx=currentS2DisplayContext(inst,EiOverride,lambdaHalfOverride);
    const dep=s2DependsOnEi(ctx.inst);
    if(dep || reset || String(out.value).trim()==='') out.value=formatS2ControlValue(s2DisplaySign()*ctx.base);
    out.readOnly=dep;
    out.title=dep
      ? 'S2 maximum from the instrument file at the current monochromator angle M2 (read only).'
      : 'S2 maximum (default from the instrument file).';
  }catch(_err){
    out.value='';
  }
}
// The scattering side of the page (physical direction of S2).
function s2SideKey(){
  try{ const c=tasConvention(selectedTasSense(),checkedValue('s1sign')); return `${c.sampleScatteringSign},${c.s1EncoderSign}`; }catch(_e){ return '1'; }
}
// S2 min and max in numerical order: on the negative side the large-angle
// limit comes first (-100 ... -5), on the positive side last (5 ... 100).
function orderS2Fields(){
  const near=$('S2min'), far=$('S2maxEffective');
  if(!near || !far || near.parentNode!==far.parentNode) return;
  const negative=s2DisplaySign()<0;
  const farFirst=!!(near.compareDocumentPosition(far) & Node.DOCUMENT_POSITION_PRECEDING);
  if(negative && !farFirst) near.before(far);
  if(!negative && farFirst) far.before(near);
  near.setAttribute('aria-label',negative ? 'S2 max (deg)' : 'S2 min (deg)');
  far.setAttribute('aria-label',negative ? 'S2 min (deg)' : 'S2 max (deg)');
}
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
  $('energy').value=String(Number((energyFromWavelength(lambda)).toPrecision(12)));
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
  $('energy').value=String(Number((energyFromWavelength(lambda)).toPrecision(12)));
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
  // Only the TAS resolution model is implemented: for a diffractometer or a
  // 4-circle the Resolution tab (and the jump to it from Angle calculation) is
  // greyed out, and no previously calculated TAS ellipse or matrix is kept.
  for(const id of ['tabResolution','geomToResolution']){
    const button=$(id); if(!button) continue;
    button.disabled=diffraction;
    button.title=diffraction ? 'Not available for diffractometers and 4-circle mode.' : '';
  }
  if(diffraction){
    clearResolutionResults?.();
    if(!$('resolutionPanel')?.classList.contains('hidden')) $('tabQe')?.click();
  }
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

// Instrument configuration (sidebar) from the instrument file: type, beam,
// Sense, motor limits and crystals.
function applyInstrumentConfigurationDefaults(){
  if(!$("instrument").value) return null;
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
  // Motor signs: "s_sign" (S1 / S2), "m_sign" (M1 / M2), "a_sign" (A1 / A2);
  // "s1sign" in older files.
  const rawS1Sign=cfg.s_sign ?? cfg.s1sign ?? qr.s_sign ?? qr.s1sign ?? inst.s_sign ?? inst.s1sign;
  setSelect("msign",normalizeS1Sign(cfg.m_sign ?? qr.m_sign ?? inst.m_sign ?? "ccw"));
  if($("asign")) $("asign").value=normalizeS1Sign(cfg.a_sign ?? qr.a_sign ?? inst.a_sign ?? "ccw");
  let tasConvention;
  if(rawS1Sign!==undefined){
    tasConvention={sense:readTasSense(rawSense,cfg.geometry),s1sign:normalizeS1Sign(rawS1Sign)};
  }else if(hasNewSense && /^[+-]{3}$/.test(String(rawSense))){
    // New-format Sense without an explicit motor sign defaults to CCW.
    tasConvention={sense:readTasSense(rawSense,cfg.geometry),s1sign:"ccw"};
  }else{
    // Backward compatibility for old JSON files whose `sign` stored one of the
    // pre-refactor combined Sense/S1 labels.
    tasConvention=tasConventionFromLegacyUiSense(rawSense);
  }
  if($("sense")) $("sense").value=tasConvention.sense;
  setSelect("s1sign",tasConvention.s1sign);
  syncS2FieldSigns();
  applyInstrumentCrystalAvailability();
  updateEnergyLabel();
  // Use wavelength by default for incident-fixed diffractometers, while
  // conventional TAS instruments retain meV. User choices are restored later.
  const pref=(inst.instrument_type==='diffractometer' && energyMode==='Ei fixed') ? 'lambda_i' : (energyMode==='Ei fixed'?'Ei':'Ef');
  getFixedBeamControls()?.syncFromCanonical({preferredQuantity:pref});
  return inst;
}
// Resolution instrument details from the instrument file: collimation,
// focusing, mosaic, sizes and distances (crystals are set with the sidebar).
function applyInstrumentDetailDefaults(inst=currentInstrument()){
  setSelect("method",(inst.approximation||{}).method);

  const mono=inst.monochromator||{}, ana=inst.analyzer||{}, col=inst.collimator||{}, sm=inst.supermirror||{}, dist=inst.distance||{}, beam=inst.beam||{}, det=inst.detector||{};
  setBool("gm1",sm.enabled); setIf("div1m",sm.m_value); setColl("div1h",col,'1st_h');setColl("div1v",col,'1st_v');setColl("div2h",col,'2nd_h');setColl("div2v",col,'2nd_v');setColl("div3h",col,'3rd_h');setColl("div3v",col,'3rd_v');setColl("div4h",col,'4th_h');setColl("div4v",col,'4th_v');
  setBool("monoHF",mono.hfocus);setBool("monoVF",mono.vfocus);setBool("anaHF",ana.hfocus);
  // "3rd_type": "radial" / "soller" in the collimator section; default: radial with a horizontally focusing analyzer.
  { const t=String(col['3rd_type']||'').toLowerCase(); const radial=t ? t==='radial' : !!ana.hfocus;
    if($('coll3Type')) $('coll3Type').value=radial?'radial':'soller'; updateCollimator3UI(); }
  setBool("anaVF",ana.vfocus);setIf("monoHB",mono.blade_h);setIf("monoVB",mono.blade_v);setIf("anaHB",ana.blade_h);setIf("anaVB",ana.blade_v);
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
  updateSupermirrorUI();updateAutoW();
}
// Everything from the instrument file (instrument or type change).
function applyInstrumentDefaults(){
  const inst=applyInstrumentConfigurationDefaults();
  if(!inst) return;
  applyInstrumentDetailDefaults(inst);
  setStatus(`${inst.name || $("instrument").value} loaded`);
}

  return {
    CRYSTAL_NAMES:Object.keys(CRYSTALS).filter(k=>CRYSTALS[k]!=null),
    syncS2FieldSigns, syncM2FieldSigns, updateCollimator3UI, syncCollimator3WithAnalyzerFocus,
    applyInstrumentCrystalAvailability, applyInstrumentDefaults, applyInstrumentConfigurationDefaults, applyInstrumentDetailDefaults, applyInstrumentTypeChange, currentInstrument, effectiveS2MaxAtEi,
    fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer,
    energyTransferRange, energyTransferGrid,
    syncSidebarCrystalSelectors, updateS2MaxDisplay,
    updateS2MaxDisplayForQERange, updateSupermirrorUI, validateEffectiveS2Max
  };
}
