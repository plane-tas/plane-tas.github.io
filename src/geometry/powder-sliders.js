// Angle calculation & TAS geometry (Powder): hbar-omega, Q and S2 sliders.
// They drive the linked Powder S2 / Q / hbar-omega entries: Q and S2 set the
// link driver like typing in that field.  Dragging redraws only the TAS
// geometry; releasing a slider commits through the normal input path.
import {fixedText} from '../core/number-format.js';
export function createPowderGeometrySliders(deps){
  const {$, checkedValue, parseNumericValue, powderWavevectors, setPowderLinkDriver, syncPowderLinkedInputs,
    hwRange, renderGeometryNow}=deps;

  const ids={hw:'powderSliderHW',q:'powderSliderQ',s2:'powderSliderS2'};
  const fields={hw:'powderGeomHW',q:'powderGeomQ',s2:'powderGeomS2'};
  let dragging=false;
  const fmt=fixedText, clean=fixedText;
  const value=id=>parseNumericValue($(id)?.value);
  function setRange(el,min,max,step,v){
    if(!el) return;
    el.min=String(min); el.max=String(max); el.step=String(step);
    el.value=String(Math.min(max,Math.max(min,v)));
  }
  function show(key,text){ const o=$(`${ids[key]}Value`); if(o) o.textContent=text; }
  function visible(){
    return checkedValue('sampleMode')==='powder' && !$('powderGeometryTarget')?.classList.contains('hidden');
  }
  // The S2 slider keeps the sign of the S2 motor (from Sense and S1 sign, as
  // in the S2 entry) and spans the S2 min ... max of the Motor table.
  function s2Range(s2){
    const lo=Math.abs(Number($('S2min')?.value)), hi=Math.abs(Number($('S2maxEffective')?.value));
    const sign=Number($('S2maxEffective')?.value)<0 || (!Number.isFinite(hi) && s2<0) ? -1 : 1;
    let a=Number.isFinite(lo) ? lo : 0, b=Number.isFinite(hi) && hi>0 ? hi : 180;
    if(a>b) [a,b]=[b,a];
    const ends=[sign*a,sign*b];
    let min=Math.min(...ends), max=Math.max(...ends);
    if(Number.isFinite(s2)){ min=Math.min(min,s2); max=Math.max(max,s2); }
    return {min:Math.floor(min),max:Math.ceil(max)};
  }

  // Move the sliders to the current Powder entries (no events fired).
  function syncPowderSliders(){
    const box=$('powderGeometrySliders'); if(!box) return;
    box.classList.toggle('hidden',!visible());
    if(!visible() || dragging) return;
    const hw=value(fields.hw), q=value(fields.q), s2=value(fields.s2);
    if(![hw,q,s2].every(Number.isFinite)) return;
    let r=null;
    try{ r=hwRange(); }catch(_e){}
    // Slider positions on multiples of 0.1 meV (0 included).
    const hwMin=Math.floor(Math.min(Number.isFinite(r?.hwMin) ? r.hwMin : -10,hw)*10+1e-9)/10;
    const hwMax=Math.ceil(Math.max(Number.isFinite(r?.hwMax) ? r.hwMax : 10,hw)*10-1e-9)/10;
    setRange($(ids.hw),hwMin,hwMax,0.1,hw);
    // |Q| up to ki + kf over the hbar-omega range.
    let qMax=0;
    for(const w of [hwMin,0,hwMax,hw]){
      const wv=powderWavevectors(w);
      if(wv) qMax=Math.max(qMax,wv.ki+wv.kf);
    }
    qMax=Math.max(Math.ceil(qMax*20)/20,q,0.5);
    setRange($(ids.q),0,qMax,0.001,q);
    const sr=s2Range(s2);
    setRange($(ids.s2),sr.min,sr.max,0.1,s2);
    show('hw',fmt(hw,2)); show('q',fmt(q,3)); show('s2',fmt(s2,2));
  }

  function applyFromSlider(key){
    const v=Number($(ids[key]).value);
    if(!Number.isFinite(v)) return;
    if(key==='q') setPowderLinkDriver('q');
    if(key==='s2') setPowderLinkDriver('s2');
    $(fields[key]).value=clean(v);
    syncPowderLinkedInputs(key==='hw' ? undefined : key);
    // The partner entries (Q <-> S2) follow; show their slider positions.
    for(const k of Object.keys(ids)){
      const x=value(fields[k]);
      if(!Number.isFinite(x)) continue;
      if(k!==key){
        const el=$(ids[k]);
        if(el){
          if(x<Number(el.min)) el.min=String(Math.floor(x));
          if(x>Number(el.max)) el.max=String(Math.ceil(x));
          el.value=String(x);
        }
      }
      show(k,fmt(x,k==='q'?3:2));
    }
  }

  function bindPowderSliders(){
    for(const [key,id] of Object.entries(ids)){
      const el=$(id); if(!el || el.dataset.bound) continue;
      el.dataset.bound='1';
      el.addEventListener('input',()=>{
        applyFromSlider(key);
        dragging=true;
        try{ renderGeometryNow(); }finally{ dragging=false; }
      });
      // On release, commit like a typed value (recalculation, persistence).
      el.addEventListener('change',()=>{
        for(const f of Object.values(fields)) $(f)?.dispatchEvent(new Event('change',{bubbles:true}));
      });
    }
    for(const id of [...Object.values(fields),'energy','energyMode','sense','s1sign','S2min','S2maxEffective'])
      $(id)?.addEventListener('change',()=>syncPowderSliders());
    syncPowderSliders();
  }
  return {bindPowderSliders, syncPowderSliders};
}
