// Angle calculation & TAS geometry (Single): U, V and hbar-omega sliders.
// The target Q is written as a*U + b*V (+ any out-of-plane part of the typed
// HKL, kept unchanged). Dragging only redraws the geometry from the current
// Q-E cache; releasing a slider commits through the normal input path.
export function createGeometrySliders(deps){
  const {$, checkedValue, collectResolutionBase, getSingleCache, hklToQ, makeSpiceScatteringPlaneBasis,
    norm, dot, num, renderGeometryNow, geometryCalculationMode, syncMapHWFromTarget}=deps;

  const ids={u:'geomSliderU',v:'geomSliderV',hw:'geomSliderHW',combo:'geomSliderCombo'};
  let syncing=false;
  const fmt=(x,d)=>{const v=Number(x);return Math.abs(v)<0.5*Math.pow(10,-d)?'0':String(Number(v.toFixed(d)));};

  // Plane basis and the decomposition hkl = a*U + b*V + rest.
  function plane(){
    const b=collectResolutionBase();
    const U=[num('Uh'),num('Uk'),num('Ul')], V=[num('Vh'),num('Vk'),num('Vl')];
    const {ex,ey}=makeSpiceScatteringPlaneBasis(b.rl,U,V);
    const qU=hklToQ(b.rl,U), qV=hklToQ(b.rl,V);
    const ux=dot(qU,ex), uy=dot(qU,ey), vx=dot(qV,ex), vy=dot(qV,ey);
    const det=ux*vy-uy*vx;
    if(!(Math.abs(det)>1e-12)) throw new Error('U and V do not span a plane.');
    return {b,U,V,ex,ey,ux,uy,vx,vy,det,qU:norm(qU),qV:norm(qV)};
  }
  function decompose(p,hkl){
    const q=hklToQ(p.b.rl,hkl), qx=dot(q,p.ex), qy=dot(q,p.ey);
    const a=(qx*p.vy-qy*p.vx)/p.det, c=(p.ux*qy-p.uy*qx)/p.det;
    const rest=hkl.map((x,i)=>x-a*p.U[i]-c*p.V[i]);
    return {a,b:c,rest};
  }
  // Slider limits: |Q| up to ki+kf over the hbar-omega range of the Q-E map.
  function limits(p){
    const cache=getSingleCache();
    const list=(cache?.hwList||[]).map(Number).filter(Number.isFinite);
    const r4=x=>Number(x.toFixed(4));
    const hwMin=list.length?r4(Math.min(...list)):-10, hwMax=list.length?r4(Math.max(...list)):10;
    const em=p.b.config.energy_mode, E=em==='Ei fixed'?Number(p.b.config.Ei):Number(p.b.config.Ef);
    let qMax=0;
    for(const hw of [hwMin,0,hwMax]){
      const Ei=em==='Ei fixed'?E:E+hw, Ef=em==='Ei fixed'?E-hw:E;
      if(Ei>0&&Ef>0) qMax=Math.max(qMax,Math.sqrt(Ei/2.072)+Math.sqrt(Ef/2.072));
    }
    const step=list.length>1 ? r4(Math.abs(list[1]-list[0])) : 0.1;
    const rlu=q=>Math.max(0.5,Math.ceil(qMax/Math.max(q,1e-9)*20)/20);
    return {aMax:rlu(p.qU),bMax:rlu(p.qV),hwMin,hwMax,hwStep:step>0?step:0.1,qMax};
  }
  function setRange(el,min,max,step,value){
    if(!el) return;
    el.min=String(min); el.max=String(max); el.step=String(step);
    el.value=String(Math.min(max,Math.max(min,value)));
  }
  function show(id,text){ const o=$(`${id}Value`); if(o) o.textContent=text; }

  // Linear-combination slider: (a, b) = (a0, b0) + t*(c1, c2), i.e. the
  // target moves along c1*U + c2*V from an origin. "Set origin" makes the
  // current target the origin (t = 0); other target changes keep t and move
  // the origin, so the slider always shows the offset along the line.
  const combo={t:0,a0:NaN,b0:NaN};
  const coefficient=id=>{ const v=num(id); return Number.isFinite(v)?v:0; };
  function comboDirection(){ return [coefficient('geomComboU'),coefficient('geomComboV')]; }
  function comboLimit(p,lim){
    const [c1,c2]=comboDirection();
    const q=norm(hklToQ(p.b.rl,p.U.map((x,i)=>c1*x+c2*p.V[i])));
    if(!(q>1e-9)) return 1;
    return Math.max(0.5,Math.ceil(lim.qMax/q*20)/20);
  }

  function visible(){
    return checkedValue('sampleMode')==='single' && geometryCalculationMode()!=='scan';
  }
  // Move the sliders to the current H, K, L, hbar-omega (no events fired).
  function syncGeometrySliders(){
    const box=$('geometrySliders'); if(!box) return;
    box.classList.toggle('hidden',!visible());
    if(!visible() || syncing) return;
    try{
      const p=plane(), lim=limits(p);
      const d=decompose(p,[num('geomH'),num('geomK'),num('geomL')]);
      const hw=num('geomHW');
      if(![d.a,d.b,hw].every(Number.isFinite)) return;
      setRange($(ids.u),-lim.aMax,lim.aMax,0.01,d.a);
      setRange($(ids.v),-lim.bMax,lim.bMax,0.01,d.b);
      setRange($(ids.hw),Math.min(lim.hwMin,hw),Math.max(lim.hwMax,hw),lim.hwStep,hw);
      show(ids.u,fmt(d.a,3)); show(ids.v,fmt(d.b,3)); show(ids.hw,fmt(hw,2));
      // Label each slider with the U / V vectors actually entered.
      const vec=v=>`(${v.map(x=>fmt(x,4)).join(', ')})`;
      if($('geomSliderULabel')) $('geomSliderULabel').textContent=`U ${vec(p.U)}`;
      if($('geomSliderVLabel')) $('geomSliderVLabel').textContent=`V ${vec(p.V)}`;
      box.dataset.rest=JSON.stringify(d.rest);
      // Keep t; the origin follows the target.
      const [c1,c2]=comboDirection();
      combo.a0=d.a-combo.t*c1; combo.b0=d.b-combo.t*c2;
      const tMax=Math.max(comboLimit(p,lim),Math.abs(combo.t));
      setRange($(ids.combo),-tMax,tMax,0.01,combo.t);
      show(ids.combo,fmt(combo.t,3));
    }catch(_e){ /* the Angle output already reports invalid lattice/plane input */ }
  }
  function writeTarget(p,a,c,hw){
    let rest=[0,0,0];
    try{ rest=JSON.parse($('geometrySliders').dataset.rest||'[0,0,0]'); }catch(_e){}
    const hkl=p.U.map((x,i)=>a*x+c*p.V[i]+(Number(rest[i])||0));
    const clean=v=>Math.abs(v)<1e-9?0:Number(v.toFixed(4));
    $('geomH').value=String(clean(hkl[0]));
    $('geomK').value=String(clean(hkl[1]));
    $('geomL').value=String(clean(hkl[2]));
    $('geomHW').value=String(Number(hw.toFixed(4)));
    show(ids.u,fmt(a,3)); show(ids.v,fmt(c,3)); show(ids.hw,fmt(hw,2));
  }
  function applyFromSliders(source){
    const p=plane();
    let a=Number($(ids.u).value), c=Number($(ids.v).value);
    const hw=Number($(ids.hw).value);
    const [c1,c2]=comboDirection();
    if(source==='combo'){
      combo.t=Number($(ids.combo).value);
      if(!Number.isFinite(combo.a0)||!Number.isFinite(combo.b0)){ combo.a0=a-combo.t*c1; combo.b0=c-combo.t*c2; }
      a=combo.a0+combo.t*c1; c=combo.b0+combo.t*c2;
      // The U / V sliders follow (their range may need to grow).
      for(const [id,v] of [[ids.u,a],[ids.v,c]]){
        const el=$(id); if(!el) continue;
        if(v<Number(el.min)) el.min=String(Math.floor(v*20)/20);
        if(v>Number(el.max)) el.max=String(Math.ceil(v*20)/20);
        el.value=String(v);
      }
      show(ids.combo,fmt(combo.t,3));
    }else{
      combo.a0=a-combo.t*c1; combo.b0=c-combo.t*c2;
    }
    writeTarget(p,a,c,hw);
  }
  function setComboOrigin(){
    combo.t=0;
    syncGeometrySliders();
  }
  function bindGeometrySliders(){
    for(const [key,id] of Object.entries(ids)){
      const el=$(id); if(!el || el.dataset.bound) continue;
      el.dataset.bound='1';
      el.addEventListener('input',()=>{
        try{ applyFromSliders(key); }catch(_e){ return; }
        syncing=true;
        // hbar-omega also moves the Constant E map slice (which redraws the
        // TAS geometry too); otherwise redraw only the geometry.
        try{ if(!(key==='hw' && syncMapHWFromTarget?.())) renderGeometryNow(); }finally{ syncing=false; }
      });
      // On release, commit like a typed value (recalculation, persistence).
      el.addEventListener('change',()=>{
        for(const f of ['geomH','geomK','geomL','geomHW'])
          $(f)?.dispatchEvent(new Event('change',{bubbles:true}));
      });
    }
    $('geomComboSetOrigin')?.addEventListener('click',setComboOrigin);
    // A new direction starts from the current target.
    for(const id of ['geomComboU','geomComboV']) $(id)?.addEventListener('change',setComboOrigin);
    for(const id of ['geomH','geomK','geomL','geomHW','Uh','Uk','Ul','Vh','Vk','Vl']){
      $(id)?.addEventListener('change',syncGeometrySliders);
    }
    syncGeometrySliders();
  }
  return {bindGeometrySliders, syncGeometrySliders};
}
