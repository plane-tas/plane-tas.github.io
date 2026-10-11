// Direct editing of the viewport endpoints shown on Q–E axes.
// Only Plotly layout ranges change: these inputs never modify calculated data.
const plotStates=new Map();
const validRange=r=>Array.isArray(r)&&r.length===2&&r.every(v=>Number.isFinite(Number(v)))&&Number(r[0])<Number(r[1]);
const copyRange=r=>validRange(r)?r.map(Number):null;

export function isQEAxisManualView(id){return !!plotStates.get(id)?.manual;}
export function clearQEAxisManualView(id){
  const state=plotStates.get(id);
  if(state) state.manual=false;
}
function axisRange(gd,axis){return copyRange(gd?._fullLayout?.[`${axis}axis`]?.range);}
function formatRangeValue(n){
  if(!Number.isFinite(n)) return '';
  return String(Number(n.toPrecision(7)));
}

// Reuse the same controls and listeners across Plotly.react() calls.
export function attachQEAxisEditors(id,{frameId,axes,labels={},defaults={},equalAspect=false,nonnegativeX=false}){
  const gd=document.getElementById(id), frame=document.getElementById(frameId);
  if(!gd||!frame||!gd._fullLayout?._size||typeof gd.on!=='function') return;
  let state=plotStates.get(id);
  if(!state){state={manual:false,inputs:new Map()};plotStates.set(id,state);}
  Object.assign(state,{gd,frame,axes:[...axes],labels,defaults:{x:copyRange(defaults.x),y:copyRange(defaults.y)},equalAspect,nonnegativeX});

  let layer=frame.querySelector('.qe-axis-edit-layer');
  if(!layer){
    layer=document.createElement('div');
    layer.className='qe-axis-edit-layer';
    layer.setAttribute('aria-label','Editable plot axis limits');
    frame.appendChild(layer);
  }
  state.layer=layer;

  for(const axis of ['x','y']) for(const end of ['min','max']){
    const key=`${axis}-${end}`;
    if(!axes.includes(axis)){
      const existing=state.inputs.get(key);
      if(existing){existing.remove();state.inputs.delete(key);}
      continue;
    }
    let input=state.inputs.get(key);
    if(!input || !input.isConnected){
      input=document.createElement('input');
      input.type='number';
      input.step='any';
      input.inputMode='decimal';
      input.className=`qe-axis-bound qe-axis-bound-${axis}-${end}`;
      input.dataset.axis=axis;
      input.dataset.end=end;
      layer.appendChild(input);
      state.inputs.set(key,input);
      for(const type of ['pointerdown','mousedown','click','dblclick','touchstart'])
        input.addEventListener(type,e=>e.stopPropagation());
      input.addEventListener('focus',()=>input.select());
      input.addEventListener('keydown',event=>{
        if(event.key==='Enter'){event.preventDefault();event.stopPropagation();input.blur();}
        else if(event.key==='Escape'){
          event.preventDefault();event.stopPropagation();
          const range=axisRange(gd,axis);
          if(range) input.value=formatRangeValue(range[end==='min'?0:1]);
          input.classList.remove('qe-invalid');input.blur();
        }
      });
      input.addEventListener('change',()=>{
        const range=axisRange(gd,axis);
        if(!range) return;
        const old=range[end==='min'?0:1];
        const raw=input.value.trim();
        const value=raw.length?Number(raw):NaN;
        const next=range.slice();
        next[end==='min'?0:1]=value;
        if(!Number.isFinite(value) || !(next[0]<next[1]) ||
          (axis==='x' && state.nonnegativeX && next[0]<0)){
          input.classList.add('qe-invalid');
          input.setCustomValidity(axis==='x'&&state.nonnegativeX&&value<0
            ? 'Q must be non-negative.' : 'Enter finite values with minimum < maximum.');
          input.reportValidity();
          input.setCustomValidity('');
          input.value=formatRangeValue(old);
          return;
        }
        input.classList.remove('qe-invalid');
        state.manual=true;
        const update={
          [`${axis}axis.range`]:next,
          [`${axis}axis.autorange`]:false
        };
        // Default Å⁻¹ view retains its physical 1:1 aspect ratio. When a user
        // explicitly edits bounds, respect the exact requested rectangle.
        if(id==='singlePlot' && state.equalAspect) update['yaxis.scaleanchor']=false;
        Promise.resolve(Plotly.relayout(gd,update)).then(()=>updateInputs(state));
      });
    }
    const text=`${labels[axis]||axis.toUpperCase()} ${end==='min'?'minimum':'maximum'}`;
    input.setAttribute('aria-label',text);
    input.title=`${text}: click to edit, Enter to apply, Esc to cancel. Double-click plot to reset.`;
  }

  if(!state.listenersBound || state.boundEmitter!==gd._ev){
    state.boundEmitter=gd._ev;
    state.listenersBound=true;
    gd.on('plotly_relayout',()=>scheduleUpdate(state));
    gd.on('plotly_afterplot',()=>scheduleUpdate(state));
    gd.on('plotly_doubleclick',()=>{
      // Plotly is configured with doubleClick:'reset' (not reset+autosize).
      // Explicitly restore the *current* data-derived window, so previous
      // redraws do not cause stale or overly wide autosize extents.
      state.manual=false;
      const update={};
      for(const axis of ['x','y']) if(validRange(state.defaults[axis])){
        update[`${axis}axis.range`]=state.defaults[axis].slice();
        update[`${axis}axis.autorange`]=false;
      }
      if(id==='singlePlot') update['yaxis.scaleanchor']=state.equalAspect?'x':false;
      Promise.resolve().then(()=>Plotly.relayout(gd,update)).then(()=>scheduleUpdate(state));
    });
    if(typeof ResizeObserver!=='undefined'){
      state.resizeObserver=new ResizeObserver(()=>scheduleUpdate(state));
      state.resizeObserver.observe(frame);
    }
  }
  scheduleUpdate(state);
}

function scheduleUpdate(state){
  if(state.pending) return;
  state.pending=true;
  requestAnimationFrame(()=>{
    state.pending=false;
    updateInputs(state);
    positionInputs(state);
  });
}
function updateInputs(state){
  for(const axis of state.axes){
    const range=axisRange(state.gd,axis);
    if(!range) continue;
    for(const [end,index] of [['min',0],['max',1]]){
      const input=state.inputs.get(`${axis}-${end}`);
      if(input && document.activeElement!==input) input.value=formatRangeValue(range[index]);
    }
  }
}
function positionInputs(state){
  const {gd,frame,inputs}=state;
  const sz=gd?._fullLayout?._size;
  if(!sz||!frame.clientWidth) return;
  const outer=frame.getBoundingClientRect();
  const plot=gd.getBoundingClientRect();
  const left=plot.left-outer.left+sz.l, top=plot.top-outer.top+sz.t;
  const right=left+sz.w, bottom=top+sz.h;
  const fw=outer.width,fh=outer.height;
  for(const [key,input] of inputs){
    const [axis,end]=key.split('-');
    const width=input.offsetWidth||76,height=input.offsetHeight||24;
    let x,y;
    if(axis==='x'){
      x=(end==='min'?left:right)-width/2;
      y=bottom+5;
    } else {
      x=left-width-7;
      y=(end==='max'?top:bottom)-height/2;
    }
    input.style.left=`${Math.max(0,Math.min(fw-width,x))}px`;
    input.style.top=`${Math.max(0,Math.min(fh-height,y))}px`;
  }
}
