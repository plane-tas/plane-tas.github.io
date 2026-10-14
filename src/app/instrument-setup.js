// Instrument configuration: Q-E range tables, S2 limits, analyzer/monochromator crystals and defaults.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {interpExtrap} from '../core/tas-core.js';
import {normalizeS1Sign, normalizeTasSense} from '../core/tas-conventions.js';

export function createInstrumentSetup(deps){
  const {
    $, checkedValue, clearResolutionResults, instruments, num, setStatus, tasConventionFromLegacyUiSense,
    updateAutoW, updateEnergyLabel, getFixedBeamControls, getSingleCache
  }=deps;

function currentInstrument(){
  const key=$("instrument").value;
  if(!key || !instruments.has(key)) throw new Error("Instrument を選択してください。");
  return instruments.get(key);
}
function rangeTable(inst){
  if(Array.isArray(inst.S2_limits)) return inst.S2_limits;
  if(inst.qe_range && Array.isArray(inst.qe_range.S2_limits)) return inst.qe_range.S2_limits;
  if(inst.qe_range && Array.isArray(inst.qe_range.configuration)) return inst.qe_range.configuration;
  if(Array.isArray(inst.configuration)) return inst.configuration; // legacy QErange JSON
  throw new Error("Selected instrument has no S2-limit table. Add S2_limits to the unified instrument JSON (or keep the legacy instruments/ directory during migration).");
}
function instrumentInterp(inst,lambdaHalf=false){
  const table=rangeTable(inst);
  const pairs=table.map(x=>[Number(x.Ei)*(lambdaHalf?4:1),Number(x.S2limit)]).sort((a,b)=>a[0]-b[0]);
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
  const values=rangeTable(inst).map(x=>Number(x.S2limit)).filter(Number.isFinite);
  return values.some(v=>Math.abs(v-values[0])>1e-10);
}
function configuredConstantS2Max(inst){
  const first=rangeTable(inst).map(x=>Number(x.S2limit)).find(Number.isFinite);
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
function effectiveS2MaxAtEi(inst,Ei,lambdaHalf=false){
  const base=baseS2MaxAtEi(inst,Ei,lambdaHalf);
  const raw=$('S2maxUser')?.value;
  const delta=(raw===undefined||raw===null||String(raw).trim()==='') ? 0 : Number(raw);
  return base+(Number.isFinite(delta)?delta:0);
}
function formatS2ControlValue(x){
  return Number.isFinite(Number(x)) ? String(Number(Number(x).toFixed(3))) : '';
}
function initializeS2MaxControl(inst=currentInstrument()){
  if(!$('S2maxUser')) return;
  // Start from the instrument JSON value for every instrument.  Users can then
  // modify either Delta S2 or Effective S2 max without changing the JSON model.
  $('S2maxUser').value='0';
  updateS2MaxDisplay(inst);
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
function updateS2MaxDisplay(inst=null,EiOverride=NaN,lambdaHalfOverride=null){
  if(!$('S2maxUser') || !$('S2maxBase') || !$('S2maxEffective')) return;
  try{
    const ctx=currentS2DisplayContext(inst,EiOverride,lambdaHalfOverride);
    const deltaRaw=$('S2maxUser').value;
    const delta=(deltaRaw===undefined||deltaRaw===null||String(deltaRaw).trim()==='') ? 0 : Number(deltaRaw);
    const effective=ctx.base+(Number.isFinite(delta)?delta:0);
    $('S2maxBase').value=formatS2ControlValue(ctx.base);
    $('S2maxEffective').value=formatS2ControlValue(effective);

    // JSON S2 max is metadata and stays read-only.  Delta and Effective are
    // deliberately both editable; they are synchronized bidirectionally.
    $('S2maxBase').readOnly=true;
    $('S2maxUser').readOnly=false;
    $('S2maxEffective').readOnly=false;

    if($('s2MaxBaseLabel')?.firstChild) $('s2MaxBaseLabel').firstChild.nodeValue='JSON S2 max (deg)';
    if($('s2MaxControlLabel')?.firstChild) $('s2MaxControlLabel').firstChild.nodeValue='ΔS2 max (deg)';
    if($('s2MaxEffectiveLabel')?.firstChild) $('s2MaxEffectiveLabel').firstChild.nodeValue='Effective S2 max (deg)';
    $('s2MaxEffectiveLabel')?.classList.remove('hidden');

    $('S2maxUser').title='Relative offset added to the JSON S2 maximum.';
    $('S2maxEffective').title=s2DependsOnEi(ctx.inst)
      ? 'Absolute S2 maximum at the currently displayed Ei. Editing this converts the value to ΔS2 and applies that Δ across the Ei-dependent curve.'
      : 'Absolute S2 maximum. Editing this automatically updates ΔS2.';
  }catch(_err){
    $('S2maxBase').value=''; $('S2maxEffective').value='';
  }
}
function syncS2DeltaFromEffective(){
  if(!$('S2maxUser') || !$('S2maxEffective')) return;
  try{
    let inst=currentInstrument(), EiOverride=NaN, lambdaHalfOverride=null;
    if(getSingleCache()?.hwList?.length && $('hwSlider')){
      const i=Math.max(0,Math.min(Number($('hwSlider').value)||0,getSingleCache().hwList.length-1));
      const hw=Number(getSingleCache().hwList[i])||0;
      EiOverride=getSingleCache().energyMode==='Ef fixed' ? getSingleCache().Ef+hw : getSingleCache().Ei;
      inst=getSingleCache().inst||inst;
      lambdaHalfOverride=getSingleCache().lambdaHalf;
    }
    const ctx=currentS2DisplayContext(inst,EiOverride,lambdaHalfOverride);
    const effective=Number($('S2maxEffective').value);
    if(!Number.isFinite(effective)) return;
    $('S2maxUser').value=formatS2ControlValue(effective-ctx.base);
  }catch(_err){}
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
function instrumentIsDiffractometer(inst=currentInstrument()){
  return inst?.instrument_type==='diffractometer';
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
function updateSupermirrorUI(){ const on=$("gm1").checked; $("div1m").disabled=!on; $("div1h").disabled=on; $("div1v").disabled=on; }

function applyInstrumentDefaults(){
  if(!$("instrument").value) return;
  const inst=currentInstrument();
  const cfg=(!Array.isArray(inst.configuration) && inst.configuration) ? inst.configuration : {};
  const qr=inst.qe_range||{};
  const energyMode=cfg.energy_mode || qr.energy_mode || inst.energy_mode || "Ef fixed";
  setSelect("energyMode",energyMode);
  const defaultEnergy=energyMode==="Ei fixed" ? (cfg.Ei ?? cfg.Ef ?? qr.default_energy ?? inst.default_energy ?? 14.7) : (cfg.Ef ?? cfg.Ei ?? qr.default_energy ?? inst.default_energy ?? 14.7);
  setIf("energy",defaultEnergy);
  setIf("S2min",qr.S2_min ?? inst.S2_min ?? inst.default_S2min ?? 8.0);
  initializeS2MaxControl(inst);
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
  setSelect("geometry",cfg.geometry || "W");
  setSelect("method",(inst.approximation||{}).method);

  const mono=inst.monochromator||{}, ana=inst.analyzer||{}, col=inst.collimator||{}, sm=inst.supermirror||{}, dist=inst.distance||{}, beam=inst.beam||{}, det=inst.detector||{};
  setBool("gm1",sm.enabled); setIf("div1m",sm.m_value); setIf("div1h",col['1st_h']);setIf("div1v",col['1st_v']);setIf("div2h",col['2nd_h']);setIf("div2v",col['2nd_v']);setIf("div3h",col['3rd_h']);setIf("div3v",col['3rd_v']);setIf("div4h",col['4th_h']);setIf("div4v",col['4th_v']);
  setBool("monoHF",mono.hfocus);setBool("monoVF",mono.vfocus);setBool("anaHF",ana.hfocus);setBool("anaVF",ana.vfocus);setIf("monoHB",mono.blade_h);setIf("monoVB",mono.blade_v);setIf("anaHB",ana.blade_h);setIf("anaVB",ana.blade_v);
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
  setIf("beamW",beam.width);setIf("beamH",beam.height);setIf("monoW",mono.width);setIf("monoH",mono.height);setIf("monoT",mono.thickness);setIf("anaW",ana.width);setIf("anaH",ana.height);setIf("anaT",ana.thickness);setIf("detW",det.width);setIf("detH",det.height);
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
      ['beamW',beam.width],['beamH',beam.height],
      ['monoW',mono.width],['monoH',mono.height],['monoT',mono.thickness],
      ['anaW',ana.width],['anaH',ana.height],['anaT',ana.thickness],
      ['detW',det.width],['detH',det.height]
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
    applyInstrumentCrystalAvailability, applyInstrumentDefaults, currentInstrument, effectiveS2MaxAtEi,
    fillCrystal, initializeSidebarCrystalSelectors, instrumentIsDiffractometer, rangeTable,
    syncS2DeltaFromEffective, syncSidebarCrystalSelectors, updateS2MaxDisplay,
    updateS2MaxDisplayForQERange, updateSupermirrorUI, validateEffectiveS2Max
  };
}
