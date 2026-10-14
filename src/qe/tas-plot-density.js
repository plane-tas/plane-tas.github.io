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

  const density=()=>{
    const n=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tas-density'));
    return Number.isFinite(n)&&n>0 ? n : 1;
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
  for(const method of ['newPlot','react']){
    if(typeof plotly[method]!=='function') continue;
    const old=plotly[method].bind(plotly);
    plotly[method]=function(gd,data,layout,config){
      const factor=density();
      const compactLayout=paintOptions(layout,factor,'layout');
      if(compactLayout && typeof compactLayout==='object'){
        // Axis fonts without explicit sizes inherit this Plotly default.
        compactLayout.font={...compactLayout.font,size:(compactLayout.font?.size??12*factor)};
        readableAxisTitles(compactLayout,factor);
      }
      return old(gd,adaptTraces(data,factor),compactLayout,config);
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
