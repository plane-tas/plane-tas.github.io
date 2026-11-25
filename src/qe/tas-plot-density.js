/* PLANE-TAS compact Plotly presentation adapter.
 * Plotly's geometry and pointer coordinates remain native CSS pixels.
 * Scale only presentational pixel sizes when supplying a trace/layout;
 * never modify axes, data coordinates, intensity values, or source objects.
 *
 * This central adapter prevents future Plotly panels from needing one-off
 * CSS transform corrections. Loaded after Plotly and before app.js modules.
 */
(function () {
  'use strict';
  const plotly=window.Plotly;
  if(!plotly || plotly.__tasNativeCompact) return;
  plotly.__tasNativeCompact=true;

  // getComputedStyle() forces a style recalculation whenever Plotly has just
  // changed the DOM, and this is called for every Plotly call. Reuse the value
  // for the rest of the current task; --tas-density only changes with the
  // window size, which is always handled in a later task.
  let cachedDensity=null;
  const density=()=>{
    if(cachedDensity!==null) return cachedDensity;
    const n=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tas-density'));
    cachedDensity=Number.isFinite(n)&&n>0 ? n : 1;
    setTimeout(()=>{ cachedDensity=null; },0);
    return cachedDensity;
  };
  window.tasUIDensity=density;

  const sized=(value,factor)=>Array.isArray(value)
    ? value.map(v=>Array.isArray(v)?sized(v,factor):typeof v==='number'?v*factor:v)
    : typeof value==='number'?value*factor:value;

  // Clone only presentational branches; expensive data arrays (x/y/z,
  // image data and customdata) are shared without changes.
  function paintOptions(source,factor,context=''){
    if(!source || typeof source!=='object') return source;
    if(Array.isArray(source)){
      // Annotation, shape, transform and gradient lists may contain styles.
      return source.map(item=>item && !Array.isArray(item) && typeof item==='object'
        ? paintOptions(item,factor,context):item);
    }
    const out={...source};
    for(const [name,val] of Object.entries(source)){
      const key=String(name).toLowerCase();
      // Only typographic and graphical dimensions are pixel values.
      const scalable=(key==='size' && /(?:^|\.)(?:font|textfont|tickfont|titlefont|hoverlabel|marker)$/.test(context))
        || (key==='width' && /(?:^|\.)(?:line|border|marker\.line)$/.test(context))
        || (key==='thickness' && context.endsWith('colorbar'))
        || ((key==='l'||key==='r'||key==='t'||key==='b'||key==='pad') && context.endsWith('margin'))
        || (key==='height' || key==='width') && context==='layout';
      if(scalable && (typeof val==='number'||Array.isArray(val))) out[name]=sized(val,factor);
      else if(val && typeof val==='object' && !ArrayBuffer.isView(val)){
        const childCtx=context?`${context}.${key}`:key;
        if(Array.isArray(val)){
          // Data arrays remain untouched; only graphical option collections recurse.
          if(['annotations','shapes','images','transforms','updatemenus','sliders','steps','buttons'].includes(key))
            out[name]=paintOptions(val,factor,childCtx);
        }else{
          out[name]=paintOptions(val,factor,childCtx);
        }
      }
    }
    return out;
  }

  // Axis titles are measurement labels and must remain legible even in the
  // compact (0.67) layout.  Plotly's default axis title inherits a font which
  // became ~8px after density scaling; enforce a CSS-pixel minimum without
  // changing the axis coordinates, ticks, margins or event positions.
  // Cover Cartesian axes, secondary axes, and scene axes on 3-D plots.
  function readableAxisTitles(layout,factor){
    if(!layout || typeof layout!=='object') return;
    const minSize=factor<0.85 ? 13.5 : 16;
    const walk=(parent)=>{
      if(!parent || typeof parent!=='object') return;
      for(const [name,axis] of Object.entries(parent)){
        if(!/^[xyz]axis(?:[2-9]\d*)?$/.test(name) || !axis || typeof axis!=='object') continue;
        const title=axis.title;
        if(typeof title==='string'){
          if(title.trim()) axis.title={text:title,font:{size:minSize}};
        }else if(title && typeof title==='object' && typeof title.text==='string' && title.text.trim()){
          const old=Number(title.font?.size);
          axis.title={...title,font:{...(title.font||{}),size:Math.max(minSize,Number.isFinite(old)?old:0)}};
        }
      }
      for(const [name,child] of Object.entries(parent)){
        if(/^scene(?:[2-9]\d*)?$/.test(name)) walk(child);
      }
    };
    walk(layout);
  }

  // Annotations use font, markers use marker.size, and Plotly colorbars use
  // title.font and tickfont. All are handled by the same branch traversal.
  function adaptTraces(data,factor){
    if(!Array.isArray(data)) return data;
    return data.map(trace=>paintOptions(trace,factor,''));
  }
  // Every figure follows the size of its own box: a ResizeObserver on each
  // plotted element calls Plots.resize when the box changes size (window,
  // side panels, tabs, wrapped controls), not only on window resize events.
  // The figure's own size changes (Plotly redrawing inside) do not change
  // the box, so this cannot loop.
  const pendingResize=new Set();
  let resizeFrame=0;
  const flushResize=()=>{
    resizeFrame=0;
    for(const gd of pendingResize){
      pendingResize.delete(gd);
      if(!gd.isConnected || !gd._fullLayout || !(gd.offsetWidth>0) || !(gd.offsetHeight>0)) continue;
      try{ const r=plotly.Plots?.resize?.(gd); if(r && typeof r.catch==='function') r.catch(()=>{}); }catch(_e){}
    }
  };
  const sizeObserver=typeof ResizeObserver==='function' ? new ResizeObserver(entries=>{
    for(const entry of entries){
      const gd=entry.target, fl=gd._fullLayout;
      const w=entry.contentRect.width, h=entry.contentRect.height;
      if(!fl || !(w>0) || !(h>0)) continue;
      // Hidden when the density changed: draw it again now that it shows.
      if(gd.__tasDensityDirty){ redrawFromSource(gd); continue; }
      // Already drawn at this size (or a fixed-size export figure).
      if(Math.abs((fl.width||0)-w)<1 && Math.abs((fl.height||0)-h)<1) continue;
      pendingResize.add(gd);
    }
    if(pendingResize.size && !resizeFrame) resizeFrame=requestAnimationFrame(flushResize);
  }) : null;
  const tracked=new Set();
  const observeSize=gd=>{
    const el=typeof gd==='string' ? document.getElementById(gd) : gd;
    if(!el) return;
    tracked.add(el);
    if(!sizeObserver || el.__tasSizeObserved) return;
    el.__tasSizeObserved=true;
    sizeObserver.observe(el);
  };
  // Every figure is drawn again from the arguments of its last
  // newPlot/react (kept unscaled) when the density changes, so its fonts,
  // markers and margins follow.  A uirevision in the layout keeps the
  // user's zoom; a 3-D scene keeps its current camera.  The app's own
  // redraws ('tas-density-change') follow for figures with extra state.
  function redrawFromSource(el){
    el.__tasDensityDirty=false;
    const src=el.__tasSource;
    if(!src || !el.isConnected) return;
    let layout=src.layout;
    const camera=el._fullLayout?.scene?.camera;
    if(camera && layout && typeof layout==='object' && layout.scene)
      layout={...layout,scene:{...layout.scene,camera}};
    try{
      const r=plotly.react(el,src.data,layout,src.config);
      if(r && typeof r.catch==='function') r.catch(()=>{});
    }catch(_e){}
  }
  function redrawAllForDensity(){
    for(const el of [...tracked]){
      if(!el.isConnected){ tracked.delete(el); continue; }
      if(!el._fullLayout || !el.__tasSource) continue;
      if(el.offsetWidth>0 && el.offsetHeight>0) redrawFromSource(el);
      else el.__tasDensityDirty=true;
    }
  }
  // The UI density changes with the window width (a CSS breakpoint).  Fonts
  // and margins are scaled when a figure is drawn, so tell the app to draw
  // the visible figures again ('tas-density-change').
  let drawnDensity=null;
  window.addEventListener('resize',()=>{
    cachedDensity=null;
    const d=density();
    if(drawnDensity!==null && Math.abs(d-drawnDensity)>1e-6){
      drawnDensity=d;
      redrawAllForDensity();
      window.dispatchEvent(new CustomEvent('tas-density-change',{detail:{density:d}}));
    }
  },{passive:true});
  for(const method of ['newPlot','react']){
    if(typeof plotly[method]!=='function') continue;
    const old=plotly[method].bind(plotly);
    plotly[method]=function(gd,data,layout,config){
      const factor=density();
      drawnDensity=factor;
      const compactLayout=paintOptions(layout,factor,'layout');
      if(compactLayout && typeof compactLayout==='object'){
        // Axis fonts without explicit sizes inherit this Plotly default.
        compactLayout.font={...compactLayout.font,size:(compactLayout.font?.size??12*factor)};
        readableAxisTitles(compactLayout,factor);
      }
      const result=old(gd,adaptTraces(data,factor),compactLayout,config);
      const el=typeof gd==='string' ? document.getElementById(gd) : gd;
      if(el){ el.__tasSource={data,layout,config}; el.__tasDensityDirty=false; }
      observeSize(gd);
      return result;
    };
  }
  if(typeof plotly.restyle==='function'){
    const old=plotly.restyle.bind(plotly);
    plotly.restyle=function(gd,update,traces){
      if(!update || typeof update!=='object') return old(gd,update,traces);
      const factor=density();
      const adjusted={...update};
      for(const [key,value] of Object.entries(update)){
        if(['marker.size','textfont.size','marker.line.width','line.width'].includes(key))
          adjusted[key]=sized(value,factor);
      }
      return old(gd,adjusted,traces);
    };
  }
})();
