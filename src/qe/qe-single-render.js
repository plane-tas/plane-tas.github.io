// Constant-E map rendering (renderSingle), external legends, hw slider and navigation controls.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {dot} from '../core/tas-core.js';
import {tasConvention} from '../core/tas-conventions.js';
import {magneticSymbol} from './magnetic-symbols.js';
import {qeMapTitle, qeDomainTitleAnnotation} from './qe-plot-title.js';
import {braggPeakScale, magneticRatioText} from './bragg-intensity.js';
import {PLOT_FONTS} from '../core/plot-fonts.js';

export function createQESingleRender(deps){
  const {
    $, backgroundColor, bindSingleRluGrid, bindSingleZoomPeakScaling, collectResolutionBase,
    currentPlotRanges, currentQEMapUnit, num, positionSingleColorbarEntries, qeObliqueRluGrid,
    qePathMapLabel, qePathPointXY, qePhysicalRluCoordinates, qeSelectedPathHKL, qeXYForUnit,
    renderGeometry, renderQEVectorMap, selectedBackgrounds, selectedS1Sign, selectedTasSense,
    singleColorbarTicks, singleMarkerSizes, singleNuclearLabelStyle, tasMotorAngles,
    updateQESpurionWarning, updateS2MaxDisplayForQERange, hklToQ
  }=deps;

// Shared legend UI for Constant E, Q-vector–E and Powder. Keep independent
// show/hide states for each plot, and group dummy and data traces together.
const qeLegendVisibilityByPlot=new Map();
// "labels" checkbox next to the Nuclear Bragg peaks legend entry: hkl labels
// of the nuclear peaks on/off (kept across reloads).
const QE_NUCLEAR_LABELS_KEY='tas-qe-nuclear-labels-v1';
let qeNuclearLabelsOn=(()=>{ try{ return localStorage.getItem(QE_NUCLEAR_LABELS_KEY)!=='off'; }catch(_e){ return true; } })();
// Plotly visibility of one trace from its legend entry (and, for the nuclear
// hkl labels, the labels checkbox).
// ħω of a map slice: one decimal, two for the 0.25 meV steps (12.25, 12.75).
function formatHwSlice(v){
  const x=Math.round(Number(v)*100)/100;
  return Math.abs(x*10-Math.round(x*10))<1e-9 ? x.toFixed(1) : x.toFixed(2);
}
function qeTraceVisible(trace,visibility){
  if(visibility.get(qeLegendKey(trace))===false) return 'legendonly';
  if(trace.meta==='nuclear-labels' && !qeNuclearLabelsOn) return 'legendonly';
  return true;
}
function qeLegendKey(trace){
  if(['nuclear-data','nuclear-labels','nuclear-legend'].includes(trace.meta)) return 'Nuclear Bragg peaks';
  const name=String(trace.name||'');
  // The same item must have the same key in the Constant E and the Q vector–E
  // map, so one shared legend entry toggles it in both.
  if(name.startsWith('Accessible Q')) return 'Accessible Q';
  const bg=name.match(/^(BG\d+):/); if(bg) return bg[1];
  if(/^Dark angle \((ki side|kf side|fixed)\)$/.test(name)) return name;
  return trace.legendgroup || name || '';
}
function qeLegendSymbol(symbol,color){
  // Use the same marker shapes as the corresponding magnetic peaks in the map.
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 20 20');
  svg.setAttribute('width','19'); svg.setAttribute('height','19');
  svg.classList.add('qe-legend-marker');
  svg.setAttribute('aria-hidden','true');
  const add=(tag,attrs)=>{
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([key,value])=>el.setAttribute(key,String(value)));
    svg.appendChild(el);
  };
  if(symbol==='x' || symbol==='cross'){
    const lines=symbol==='x' ? [[4,4,16,16],[16,4,4,16]] : [[10,2.5,10,17.5],[2.5,10,17.5,10]];
    for(const [x1,y1,x2,y2] of lines) add('line',{x1,y1,x2,y2,stroke:color,'stroke-width':3.6,'stroke-linecap':'round'});
  }else if(symbol==='star' || symbol==='pentagon'){
    const n=symbol==='star'?10:5;
    const points=Array.from({length:n},(_,i)=>{
      const angle=-Math.PI/2+i*Math.PI*2/n;
      const radius=symbol==='star' && i%2 ? 3.7 : 8;
      return `${10+radius*Math.cos(angle)},${10+radius*Math.sin(angle)}`;
    }).join(' ');
    add('polygon',{points,fill:color});
  }else if(symbol==='diamond' || symbol==='diamond-open'){
    add('polygon',{points:'10,2 18,10 10,18 2,10',fill:symbol==='diamond-open'?'none':color,stroke:color,'stroke-width':symbol==='diamond-open'?2:0});
  }else if(symbol==='triangle-up' || symbol==='triangle-down'){
    add('polygon',{points:symbol==='triangle-up'?'10,2 18,17 2,17':'2,3 18,3 10,18',fill:color});
  }else if(symbol==='square'){
    add('rect',{x:3,y:3,width:14,height:14,rx:0.5,fill:color});
  }else{
    add('circle',{cx:10,cy:10,r:6.7,fill:color});
  }
  return svg;
}
// Legend of a Q-E map, below the plot (each map has its own).
function renderQEExternalLegend(hostId,plotId,traces){
  return renderLegendInto(hostId,plotId,[[plotId,traces]]);
}
function renderLegendInto(hostId,visibilityId,plotTraces){
  const host=$(hostId);
  if(!host) return;
  host.replaceChildren();
  let visibility=qeLegendVisibilityByPlot.get(visibilityId);
  if(!visibility){visibility=new Map();qeLegendVisibilityByPlot.set(visibilityId,visibility);}
  const allTraces=plotTraces.flatMap(([,traces])=>traces);
  const keys=[];
  for(const trace of allTraces){
    const key=qeLegendKey(trace);
    if(key && trace.showlegend!==false && !keys.includes(key)) keys.push(key);
  }
  const setVisibility=()=>{
    for(const [plotId] of plotTraces){
      const gd=$(plotId);
      const data=Array.isArray(gd?.data) ? gd.data : [];
      const indices=data.map((tr,i)=>keys.includes(qeLegendKey(tr))?i:-1).filter(i=>i>=0);
      if(indices.length){
        Plotly.restyle(plotId,{visible:indices.map(i=>qeTraceVisible(data[i],visibility))},indices);
      }
    }
    host.querySelectorAll('.qe-legend-item').forEach(el=>{
      el.setAttribute('aria-pressed',String(visibility.get(el.dataset.legendKey)!==false));
    });
  };
  for(const key of keys){
    const exemplar=allTraces.find(tr=>qeLegendKey(tr)===key && tr.showlegend!==false);
    const button=document.createElement('button');
    button.type='button';button.className='qe-legend-item';button.dataset.legendKey=key;
    button.title='Click to show/hide; double-click to isolate';
    button.setAttribute('aria-pressed',String(visibility.get(key)!==false));
    const color=exemplar?.meta==='nuclear-legend' ? '#111'
      : (typeof exemplar?.marker?.color==='string' ? exemplar.marker.color
      : exemplar?.line?.color || exemplar?.fillcolor
      || exemplar?.colorscale?.[exemplar.colorscale.length-1]?.[1]
      || (key.startsWith('Accessible Q') ? '#e4be12' : '#667085'));
    let swatch;
    const isPoint=exemplar?.meta==='nuclear-legend' ||
      (exemplar?.mode?.includes('markers') && !key.startsWith('Accessible Q'));
    if(isPoint){
      swatch=qeLegendSymbol(exemplar?.meta==='nuclear-legend'?'circle':(exemplar?.marker?.symbol||'circle'),color);
    }else{
      swatch=document.createElement('span');swatch.className='qe-legend-swatch';
      swatch.style.setProperty('--legend-color',color);
      if(exemplar?.mode?.includes('lines') && !exemplar?.fill && !key.startsWith('Accessible Q')) swatch.classList.add('qe-legend-line');
    }
    const label=document.createElement('span');label.textContent=exemplar?.name || key;
    button.append(swatch,label);
    button.addEventListener('click',event=>{
      if(event.detail>1) return;
      visibility.set(key,visibility.get(key)!==false?false:true);
      setVisibility();
    });
    button.addEventListener('dblclick',event=>{
      event.preventDefault();
      const alreadyIsolated=keys.every(k=>k===key || visibility.get(k)===false);
      for(const k of keys) visibility.set(k,alreadyIsolated?true:k===key);
      setVisibility();
    });
    host.appendChild(button);
    // hkl labels of the nuclear peaks: a checkbox right after their entry.
    if(key==='Nuclear Bragg peaks' && allTraces.some(tr=>tr.meta==='nuclear-labels')){
      // A span, not a <label>: generic label styles (column layout, sizes)
      // must not apply; clicking the text toggles the box.
      const box=document.createElement('span');
      box.className='qe-legend-labels';
      box.title='Show the (h,k,l) labels of the nuclear Bragg peaks';
      const input=document.createElement('input');
      input.type='checkbox'; input.checked=qeNuclearLabelsOn;
      input.dataset.qeNuclearLabels='1';
      input.addEventListener('change',()=>{
        qeNuclearLabelsOn=input.checked;
        try{ localStorage.setItem(QE_NUCLEAR_LABELS_KEY,qeNuclearLabelsOn?'on':'off'); }catch(_e){}
        setVisibility();
      });
      const text=document.createElement('span'); text.textContent='labels';
      text.addEventListener('click',()=>{ input.checked=!input.checked; input.dispatchEvent(new Event('change')); });
      box.append(input,text);
      host.appendChild(box);
      // Same text size as the legend entries, whatever rule sizes them.
      try{ box.style.fontSize=getComputedStyle(button).fontSize; }catch(_e){}
    }
  }
  // Respect the selected legend visibility across recalculations.
  for(const trace of allTraces){
    if(qeTraceVisible(trace,visibility)!==true) trace.visible='legendonly';
  }
}
// Axis titles show the entered scattering-plane vectors, e.g. U (1, 1, 0).
function planeVectorText(v){
  if(!Array.isArray(v) || v.length!==3 || !v.every(x=>Number.isFinite(Number(x)))) return '';
  const f=x=>{const n=Number(x);return Math.abs(n)<5e-4?'0':String(Number(n.toFixed(3)));};
  return `(${v.map(f).join(', ')})`;
}
// Angle-calculation target on the Constant E map (physical plot coordinates).
function geometryTargetHKL(){ return [num('geomH'),num('geomK'),num('geomL')]; }
function geometryTargetMarkerXY(cache){
  const hkl=geometryTargetHKL();
  if(!cache || !hkl.every(Number.isFinite)) return null;
  try{
    if(cache.fourCircle && cache.Whkl){
      // Four-circle: show the target only when it lies on the displayed W layer.
      // Same W tolerance as the peaks (one W slider step).
      const q=hklToQ(cache.rl,hkl);
      if(!(Math.abs(cache.wzPerRlu)>1e-12)) return null;
      const wT=dot(q,cache.ez)/cache.wzPerRlu;
      if(Math.abs(wT-cache.layerW)>0.01+1e-9) return null;
      const p=[dot(q,cache.ex)-wT*cache.wInPlane[0],dot(q,cache.ey)-wT*cache.wInPlane[1]];
      return p.every(Number.isFinite)?p:null;
    }
    const p=qePathPointXY(cache,hkl); return p.every(Number.isFinite)?p:null;
  }catch(_e){ return null; }
}
// Same label style as the nuclear/magnetic peaks: "(h,k,l)".
function qeHKLLabel(hkl){
  return `(${hkl.map(x=>{const v=Number(x);return Math.abs(v-Math.round(v))<1e-10?String(Math.round(v)):String(Number(v.toFixed(3)));}).join(',')})`;
}
// Hover: (h,k,l) and S1/S2 of the Angle calculation (at ITS hbar-omega).
function geometryTargetHoverText(cache){
  const hkl=geometryTargetHKL();
  if(!hkl.every(Number.isFinite)) return '';
  const hw=Number.isFinite(num('geomHW'))?num('geomHW'):0;
  const angles=cache ? singleMapBraggHoverAngles(cache,hw)({label:'target',hkl}) : '';
  return angles ? `${qeHKLLabel(hkl)}<br>${angles}` : qeHKLLabel(hkl);
}
// Move the marker without redrawing the whole map (sliders, typing, drag).
function updateGeometryTargetMarker(cache){
  const plot=$('singlePlot');
  if(!plot || !Array.isArray(plot.data)) return;
  const index=plot.data.findIndex(tr=>tr.meta==='qe-geometry-target');
  if(index<0) return;
  const p=geometryTargetMarkerXY(cache);
  Plotly.restyle(plot,{x:[[p?p[0]:null]],y:[[p?p[1]:null]],customdata:[[geometryTargetHoverText(cache)]]},[index]);
}
function renderSingleExternalLegend(traces){
  renderQEExternalLegend('qePlotLegend','singlePlot',traces);
}

// Bragg-peak hover angles must follow the *same* reference calibration,
// scattering sense and motor-sign conventions as Angle calculation.  Evaluate
// at the currently selected constant-energy slice (not at elastic energy).
// Prepare the shared resolution/instrument inputs only once per map draw.
function singleMapBraggHoverAngles(cache,hw){
  let base=null;
  try{
    base=collectResolutionBase();
    base.config.energy_mode=cache.energyMode;
    base.config.Ei=cache.energyMode==='Ei fixed' ? cache.Ei : null;
    base.config.Ef=cache.energyMode==='Ef fixed' ? cache.Ef : null;
    const convention=tasConvention(selectedTasSense(),selectedS1Sign());
    base.config.sense=convention.sense;
    base.config.s1sign=convention.s1sign;
  }catch(_err){
    // A peak can still be plotted if the motor-angle inputs are incomplete.
  }
  const resultCache=new Map();
  const showAngle=angle=>Number.isFinite(angle)
    ? `${(Math.abs(angle)<0.005?0:angle).toFixed(2)}°` : '—';
  return peak=>{
    if(!peak?.label || !Array.isArray(peak.hkl) || peak.hkl.length!==3)
      return '';
    const key=peak.hkl.map(v=>Number(v).toPrecision(14)).join(',');
    let angleResult=resultCache.get(key);
    if(!angleResult){
      let angles=null;
      if(base){
        try{
          angles=tasMotorAngles({h:peak.hkl[0],k:peak.hkl[1],l:peak.hkl[2],hw},base);
        }catch(_err){ /* Outside the scattering triangle or invalid motor setting. */ }
      }
      let qText='';
      try{
        const q=base ? hklToQ(base.rl,peak.hkl) : null;
        const qn=q ? Math.hypot(...q) : NaN;
        if(Number.isFinite(qn)) qText=`|Q| = ${qn.toFixed(3)} Å⁻¹<br>`;
      }catch(_err){}
      const fc=angles?.fourCircle;
      angleResult=fc
        ? `${qText}S1=${showAngle(fc.s1)}, S2=${showAngle(angles?.s2)}<br>χ=${showAngle(fc.chi)}, φ=${showAngle(fc.phi)}`
        : `${qText}S1=${showAngle(angles?.s1)}, S2=${showAngle(angles?.s2)}`;
      resultCache.set(key,angleResult);
    }
    return angleResult;
  };
}

function renderSingle(cache,index=0){
  const unit=currentQEMapUnit();
  const plotNode=$("singlePlot");
  const drawToken=plotNode ? (plotNode.__tasMapDrawToken=(plotNode.__tasMapDrawToken||0)+1) : 0;
  const keptView=plotNode?.dataset?.qeUnit===unit ? currentPlotRanges("singlePlot") : {x:null,y:null};
  const i=Math.max(0,Math.min(index,cache.regions.length-1));
  const rawBoundary=cache.regions[i];
  // Even in r.l.u. mode the drawing plane remains physical Qx/Qy (Å⁻¹).
  // Lattice indices are conveyed by the oblique U/V grid, not by a distortion.
  const T=p=>unit==='rlu' ? [Number(p[0]),Number(p[1])] : qeXYForUnit(cache,p,unit);
  const boundary=rawBoundary.map(T);
  const transformedG=cache.Gpoints.map(p=>({...p,...(()=>{const q=T([p.x,p.y]);return {x:q[0],y:q[1]};})()}));
  const transformedMag=cache.magPoints.map(p=>({...p,...(()=>{const q=T([p.x,p.y]);return {x:q[0],y:q[1]};})()}));
  const allViewPoints=[...boundary,...transformedG.map(p=>[p.x,p.y]),...transformedMag.map(p=>[p.x,p.y])];

  const Qplot=Math.max(1e-6,1.15*Math.max(...allViewPoints.map(p=>Math.max(Math.abs(p[0]),Math.abs(p[1]))),1));
  // Identical physical ranges preserve circular Q contours and oblique U/V angles.
  const QplotX=Qplot, QplotY=Qplot;
  const initialXRange=keptView.x||[-Qplot,Qplot];
  const initialYRange=keptView.y||[-Qplot,Qplot];
  const rluGrid=unit==='rlu' ? qeObliqueRluGrid(cache,initialXRange,initialYRange) : null;
  const initialMarkerSizes=singleMarkerSizes(2*QplotX,2*QplotX,cache.Gpoints.length+cache.magPoints.length);

  // Show every calculated nuclear peak. The unused intensity-threshold filter was removed.
  const visibleGpoints=transformedG;
  // Keep the |F_N|² colorbar (and its min/max entries) even when the current
  // slice has no nuclear peak, e.g. a four-circle W layer between lattice planes.
  // Plotly drops the colorbar of an empty trace, so carry one unplotted point.
  const colorbarOnly=!!cache.cifStructure && visibleGpoints.length===0;
  // Peak shading (bragg-intensity.js): I = |F|² L, each colorbar relative to
  // its own maximum.
  const {magneticIntensity,nuclearMax,magneticMax,nuclearRelative,magneticRelative,lorentzText,iSymbol}=
    braggPeakScale(cache,$('qeLorentz')?.value!=='off');
  const ratioBox=$('mfMaxRatio');
  if(ratioBox) ratioBox.textContent=magneticRatioText(magneticMax,nuclearMax,magneticIntensity);
  // Colorbars on the right: nuclear above, magnetic below (single k only).
  const nuclearBar=magneticIntensity ? {len:0.34,y:0.74} : {len:0.62,y:0.52};
  const magneticBar={len:0.34,y:0.23};
  const peakHoverAngles=singleMapBraggHoverAngles(cache,cache.hwList[i]);

  const traces=[
    {
      x:boundary.map(p=>p[0]),
      y:boundary.map(p=>p[1]),
      fill:"toself",
      // The S2 / chi limits are shown in the Motor table of the sidebar.
      name:"Accessible Q",
      mode:"lines",
      line:{width:0},
      fillcolor:"rgba(255,215,0,0.20)",
      // Do not show Plotly's primary/secondary "Accessible Q" hover labels.
      // Keep the fill visible and preserve clicks for Select Path.
      hoverinfo:'skip',
      ...(unit==='rlu'?{
        customdata:boundary.map(p=>qePhysicalRluCoordinates(cache,p))
      }:{})
    },
    {
      x:[null], y:[null], mode:"markers", name:"Nuclear Bragg peaks",
      marker:{color:"black",size:initialMarkerSizes.nuclear},
      hoverinfo:"skip",
      meta:"nuclear-legend",
      zorder:0
    },
    {
      x:colorbarOnly?[null]:visibleGpoints.map(p=>p.x),
      y:colorbarOnly?[null]:visibleGpoints.map(p=>p.y),
      mode:"markers",
      name:"Nuclear Bragg peaks",
      showlegend:false,
      meta:"nuclear-data",
      zorder:0,
      marker:cache.cifStructure ? {
        color:colorbarOnly?[0]:visibleGpoints.map(nuclearRelative),
        colorscale:[[0,"rgb(255,255,255)"],[0.25,"rgb(205,205,205)"],[0.5,"rgb(150,150,150)"],[0.75,"rgb(85,85,85)"],[1,"rgb(0,0,0)"]],
        cmin:Number($("sfColorMinEntry")?.value ?? 0),cmax:Number($("sfColorMaxEntry")?.value ?? 1),
        showscale:true,
        colorbar:{title:{text:`|F_N|${iSymbol} / max`,side:"right",font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},thickness:16,len:nuclearBar.len,x:1.01,xanchor:"left",y:nuclearBar.y,
          ...singleColorbarTicks(Number($("sfColorMinEntry")?.value ?? 0),Number($("sfColorMaxEntry")?.value ?? 1))},
        size:initialMarkerSizes.nuclear,
        // A dark rim keeps weak (near-white) peaks visible on any background
        // while the fill still encodes |F_N|².
        line:{color:"rgb(25,25,25)",width:1.3}
      } : {color:"black",size:initialMarkerSizes.nuclear},
      hovertext:colorbarOnly?['']:visibleGpoints.map(p=>{
        if(!p.label) return p.label;
        const lines=[p.label,peakHoverAngles(p)];
        if(cache.cifStructure){
          const raw=Number.isFinite(p.sf2)?p.sf2:0;
          lines.push(`|F<sub>N</sub>|² = ${(raw/100).toPrecision(6)} barn`,lorentzText(p),`|F<sub>N</sub>|${iSymbol} / max = ${nuclearRelative(p).toFixed(4)}`);
        }
        return lines.filter(Boolean).join('<br>');
      }),
      hovertemplate:"%{hovertext}<extra></extra>"
    },
  ];
  // Nuclear Bragg labels are always shown (automatic placement and size).
  {
    const labelPts=visibleGpoints.filter(p=>p.label!=="");
    const labelStyle=singleNuclearLabelStyle(2*QplotX,2*QplotX);
    traces.push({
      x:labelPts.map(p=>p.x),
      y:labelPts.map(p=>p.y), // positioned in screen pixels after Plotly renders
      mode:"text",
      text:labelPts.map(p=>p.label),
      textposition:"middle center",
      textfont:{color:"black",size:labelStyle.fontSize},
      showlegend:false,
      hoverinfo:"skip",
      meta:"nuclear-labels",
      zorder:0
    });
  }
  // Keep propagation vectors visually distinct by marker shape (circle,
  // triangle, square, star for k1..k4) while retaining one magnetic-peak color.
  const magneticIndices=[...new Set(transformedMag.map(p=>Number(p.qIndex)).filter(Number.isFinite))].sort((a,b)=>a-b);
  for(const qIndex of magneticIndices){
    const pts=transformedMag.filter(p=>p.qIndex===qIndex);
    if(!pts.length) continue;
    const symbol=magneticSymbol(qIndex).plotly;
    const name=`Magnetic Bragg peaks: k${qIndex}`;
    if(magneticIntensity){
      // Single k: white-to-red |F_M|^2 colorbar below the nuclear one; the
      // legend keeps a plain red entry.
      traces.push({x:[null],y:[null],mode:"markers",name,marker:{color:"red",size:initialMarkerSizes.magnetic,symbol},
        hoverinfo:"skip",meta:"magnetic-legend",zorder:10});
      traces.push({
        x:pts.map(p=>p.x),y:pts.map(p=>p.y),mode:"markers",name,showlegend:false,meta:"magnetic-data",
        marker:{color:pts.map(magneticRelative),
          colorscale:[[0,"rgb(255,255,255)"],[0.25,"rgb(255,200,200)"],[0.5,"rgb(250,130,130)"],[0.75,"rgb(225,55,55)"],[1,"rgb(180,0,0)"]],
          cmin:Number($("mfColorMinEntry")?.value ?? 0),cmax:Number($("mfColorMaxEntry")?.value ?? 1),showscale:true,
          colorbar:{title:{text:`|F_M|${iSymbol} / max`,side:"right",font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},thickness:16,len:magneticBar.len,x:1.01,xanchor:"left",y:magneticBar.y,
            ...singleColorbarTicks(Number($("mfColorMinEntry")?.value ?? 0),Number($("mfColorMaxEntry")?.value ?? 1))},
          size:symbol==="star"?initialMarkerSizes.star:initialMarkerSizes.magnetic,symbol,
          line:{color:"rgb(110,0,0)",width:1.3}},
        hovertext:pts.map(p=>p.label ? [p.label,peakHoverAngles(p),
          `|F<sub>M</sub>|² = ${(Number(p.fm2)||0).toPrecision(6)} barn`,lorentzText(p),`|F<sub>M</sub>|${iSymbol} / max = ${magneticRelative(p).toFixed(4)}`].filter(Boolean).join('<br>') : p.label),
        hovertemplate:"%{hovertext}<extra></extra>",
        zorder:10
      });
      continue;
    }
    traces.push({
      x:pts.map(p=>p.x),y:pts.map(p=>p.y),mode:"markers",name,
      marker:{color:"red",size:symbol==="star"?initialMarkerSizes.star:initialMarkerSizes.magnetic,symbol},
      hovertext:pts.map(p=>p.label ? `${p.label}<br>${peakHoverAngles(p)}` : p.label),
      hovertemplate:"%{hovertext}<extra></extra>",
      zorder:10
    });
  }
  syncSingleNavigation(cache,i);
  syncQEWControl(cache);
  // BG rings: S2 of the ring |Q| at the ħω of this slice (like the S2 of the
  // Bragg peaks), with the same sign convention as the Angle calculation.
  const ringS2Text=(()=>{
    const hw=cache.hwList[i];
    const Ei=cache.energyMode==='Ef fixed' ? cache.Ef+hw : cache.Ei;
    const Ef=cache.energyMode==='Ef fixed' ? cache.Ef : cache.Ei-hw;
    let sign=1;
    try{ sign=tasConvention(selectedTasSense(),selectedS1Sign()).s2EncoderSign||1; }catch(_e){}
    return q=>{
      if(!(Ei>0 && Ef>0)) return 'S2 = —';
      const ki=0.6947*Math.sqrt(Ei), kf=0.6947*Math.sqrt(Ef);
      const c=(ki*ki+kf*kf-q*q)/(2*ki*kf);
      if(!(c>=-1-1e-10 && c<=1+1e-10)) return 'S2 = —';
      const s2=sign*Math.acos(Math.max(-1,Math.min(1,c)))*180/Math.PI;
      return `S2 = ${(Math.abs(s2)<0.005?0:s2).toFixed(2)}°`;
    };
  })();
  for(const ring of cache.ringData){
    const pts=ring.x.map((x,j)=>T([x,ring.y[j]]));
    const hover=`${ring.hoverHead}<br>${ringS2Text(ring.q)}<br>${ring.hoverTail}`;
    traces.push({
      x:pts.map(p=>p[0]),y:pts.map(p=>p[1]),mode:"lines",showlegend:false,
      name:ring.name||undefined,
      line:{color:ring.color,width:1.5},hovertemplate:hover+"<extra></extra>"
    });
  }
  // Match the Powder view: show one legend entry for each selected BG slot
  // without duplicating a legend item for every individual powder ring.
  for(const bg of selectedBackgrounds()){
    traces.push({
      x:[null],y:[null],mode:"lines",
      name:`BG${bg.index+1}: ${bg.key}`,
      line:{color:backgroundColor(bg.slot,1),width:1.5},
      hoverinfo:"skip",showlegend:true
    });
  }
  if(cache.addDark){
    let fixedLegend=false, kfLegend=false, kiLegend=false;
    for(const r of (cache.darkKI[i]||[])){
      traces.push({x:r.map(p=>T(p)[0]),y:r.map(p=>T(p)[1]),fill:"toself",name:"Dark angle (ki side)",showlegend:!kiLegend,legendgroup:"dark-ki",mode:"lines",line:{width:0},fillcolor:"rgba(0,255,0,0.15)",hoverinfo:"skip"});
      kiLegend=true;
    }
    for(const r of (cache.darkKF[i]||[])){
      traces.push({x:r.map(p=>T(p)[0]),y:r.map(p=>T(p)[1]),fill:"toself",name:"Dark angle (kf side)",showlegend:!kfLegend,legendgroup:"dark-kf",mode:"lines",line:{width:0},fillcolor:"rgba(80,190,255,0.25)",hoverinfo:"skip"});
      kfLegend=true;
    }
    for(const r of (cache.darkFixed[i]||[])){
      traces.push({x:r.map(p=>T(p)[0]),y:r.map(p=>T(p)[1]),fill:"toself",name:"Dark angle (fixed)",showlegend:!fixedLegend,legendgroup:"dark-fixed",mode:"lines",line:{width:0},fillcolor:"rgba(0,0,255,0.15)",hoverinfo:"skip"});
      fixedLegend=true;
    }
  }

  // Path is drawn over the physical Q map, even when Q unit is r.l.u.;
  // selections remain visible while the energy slider or Q unit changes.
  if(qeSelectedPathHKL.length){
    const points=qeSelectedPathHKL.map(hkl=>qePathPointXY(cache,hkl));
    traces.push({type:'scatter',mode:'lines+markers+text',showlegend:true,name:'Selected path',meta:'qe-selected-path',zorder:100,
      x:points.map(p=>p[0]),y:points.map(p=>p[1]),text:points.map((_,j)=>qePathMapLabel(j,cache)),
      textposition:'top center',textfont:{size:14,color:'#7e22ce'},
      marker:{size:13,color:'#9333ea',line:{color:'#fff',width:2}},
      line:{color:'#9333ea',width:2.5,dash:'dash'},
      // Match the nuclear/magnetic peak hover: use the shared TAS motor-angle
      // calculation at the currently selected energy, sense and S1 sign.
      customdata:qeSelectedPathHKL.map(hkl=>[qeHKLLabel(hkl),peakHoverAngles({label:'HKL',hkl})]),
      hovertemplate:'%{customdata[0]}<br>%{customdata[1]}<extra></extra>'});
  }
  // Angle calculation & TAS geometry target: (h, k, l) only. Its hbar-omega is
  // independent of this map's energy slice. Drag it to move H, K, L.
  const geometryTarget=geometryTargetMarkerXY(cache);
  // Magenta: distinct from the accessible-Q yellow, the dark-angle green/blue,
  // the red magnetic and black nuclear peaks, the purple path and BG colours.
  traces.push({type:'scatter',mode:'markers',showlegend:true,meta:'qe-geometry-target',zorder:110,
    name:'Angle calculation point',
    x:geometryTarget?[geometryTarget[0]]:[null],y:geometryTarget?[geometryTarget[1]]:[null],
    marker:{size:17,symbol:'x',color:'#d6007a',line:{color:'#fff',width:2}},
    customdata:[geometryTargetHoverText(cache)],
    hovertemplate:'%{customdata}<extra></extra>'});
  // Plotly draws later traces on top. Keep the nuclear legend entry where it is,
  // but render the actual nuclear markers/labels last so BG1-BG4 and other
  // line traces cannot cover them.
  const nuclearTop=traces.filter(tr=>tr.meta==="nuclear-data" || tr.meta==="nuclear-labels");
  if(nuclearTop.length){
    for(let j=traces.length-1;j>=0;j--){
      if(traces[j].meta==="nuclear-data" || traces[j].meta==="nuclear-labels") traces.splice(j,1);
    }
    traces.push(...nuclearTop);
  }
  const selectedTrace=traces.find(tr=>tr.meta==='qe-selected-path');
  if(selectedTrace){
    traces.splice(traces.indexOf(selectedTrace),1);
    traces.push(selectedTrace);
  }

  renderSingleExternalLegend(traces);
  // The canonical reset window must be calculated from the latest map, not
  // recovered from Plotly's prior auto-range or its pre-resize dimensions.
  if(plotNode) plotNode.__tasSingleMapDefaultView={
    unit,x:[-QplotX,QplotX],y:[-QplotY,QplotY]
  };
  const titleAnnotation=qeDomainTitleAnnotation(qeMapTitle({inst:cache.inst,energyMode:cache.energyMode,Ei:cache.Ei,Ef:cache.Ef,
    // Diffractometer / 4-circle: elastic only, no ħω in the title.
    hw:['diffractometer','four-circle'].includes(cache.inst?.instrument_type) ? null : cache.hwList[i],
    W:(cache.fourCircle && cache.Whkl) ? cache.layerW : null}));
  const singleDraw=Plotly.react("singlePlot",traces,{
    // Preserve user zoom/pan when controls trigger a recalculation.
    uirevision:`singlePlot-${unit}`,

    showlegend:false,
    xaxis:{title:{text:unit==='rlu'?`U ${planeVectorText(cache.U)} (r.l.u.)`:'Qx (Å⁻¹)',font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},range:keptView.x||[-QplotX,QplotX],tickmode:unit==='rlu'?'array':'auto',tickvals:unit==='rlu'?rluGrid.xTickVals:undefined,ticktext:unit==='rlu'?rluGrid.xTickText:undefined,nticks:10,showgrid:unit!=='rlu',minor:{showgrid:unit!=='rlu',gridcolor:'#e8ebee',gridwidth:1,ticks:''},showticklabels:true,ticks:unit==='rlu'?'outside':'',gridcolor:'#c3c9cf',gridwidth:1,zeroline:unit!=='rlu',zerolinecolor:'#777',showline:true,linecolor:'#555',linewidth:1.2,mirror:true,constrain:'domain'},
    yaxis:{title:{text:unit==='rlu'?`V ${planeVectorText(cache.V)} (r.l.u.)`:'Qy (Å⁻¹)',font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},range:keptView.y||[-QplotY,QplotY],tickmode:unit==='rlu'?'array':'auto',tickvals:unit==='rlu'?rluGrid.yTickVals:undefined,ticktext:unit==='rlu'?rluGrid.yTickText:undefined,nticks:10,showgrid:unit!=='rlu',minor:{showgrid:unit!=='rlu',gridcolor:'#e8ebee',gridwidth:1,ticks:''},showticklabels:true,ticks:unit==='rlu'?'outside':'',gridcolor:'#c3c9cf',gridwidth:1,zeroline:unit!=='rlu',zerolinecolor:'#777',showline:true,linecolor:'#555',linewidth:1.2,mirror:true,scaleanchor:'x',scaleratio:1,constrain:'domain'},
    ...(rluGrid?{shapes:rluGrid.shapes}:{}),
    annotations:[...(rluGrid?rluGrid.annotations:[]),titleAnnotation],
    // The legend now lives below the display controls, outside this Plotly canvas.
    margin:{l:66,r:cache.cifStructure?92:20,t:38,b:72}
  // Plotly's download button saves the plot without the legend and scales:
  // Save figure (top left) replaces it.
  },{responsive:true,doubleClick:false,modeBarButtonsToRemove:['toImage']});
  if(plotNode) plotNode.dataset.qeUnit=unit;
  Promise.resolve(singleDraw).then(()=>{
    if(plotNode?.__tasMapDrawToken!==drawToken) return;
    bindSingleZoomPeakScaling(cache,2*QplotX,2*QplotY);
    bindSingleRluGrid(cache);
    $('sfColorbarRange')?.classList.toggle('hidden',!cache.cifStructure);
    $('sfColorbarRange')?.classList.toggle('qe-magnetic-colorbar',magneticIntensity);
    positionSingleColorbarEntries();
  }).catch(err=>console.warn('Constant E map drawing warning:',err));

  const hwEntry=$("hwEntry");
  if(hwEntry && document.activeElement!==hwEntry) hwEntry.value=formatHwSlice(cache.hwList[i]);
  updateQESpurionWarning(cache,i);
  updateS2MaxDisplayForQERange(cache,i);
  renderGeometry(cache,i);
  if(!$('qeVectorMapPane')?.classList.contains('hidden')) renderQEVectorMap(cache);
}


function nearestHWIndex(cache,value){
  let best=0, d=Infinity; cache.hwList.forEach((x,i)=>{const di=Math.abs(x-value); if(di<d){d=di;best=i;}}); return best;
}
function syncSingleNavigation(cache,index){
  const i=Math.max(0,Math.min(index,cache.hwList.length-1));
  if($('hwSlider')) $('hwSlider').value=i;
  if($('hwEntry')) $('hwEntry').value=formatHwSlice(cache.hwList[i]);
}
function qeWVectorText(v){
  return v.map(x=>{const n=Number(x);return Math.abs(n-Math.round(n))<1e-9?String(Math.round(n)):String(Number(n.toFixed(3)));}).join(', ');
}
function syncQEWControl(cache){
  const fc=!!(cache.fourCircle && cache.Whkl);
  $('qeWCard')?.classList.toggle('hidden',!fc);
  if(!fc) return;
  const label=$('qeWLabel');
  if(label) label.textContent=`W (${qeWVectorText(cache.Whkl)}) (r.l.u.)`;
  const qMax=Math.max(0,...cache.QmaxList.filter(Number.isFinite));
  const wz=Math.abs(cache.wzPerRlu);
  const hi=wz>1e-12 ? Math.max(0.01,Math.floor(100*qMax/wz)/100) : 0;
  const slider=$('qeWSlider'), entry=$('qeWEntry');
  if(slider){ slider.min=-hi; slider.max=hi; slider.step=0.01; slider.value=cache.layerW; }
  if(entry && document.activeElement!==entry) entry.value=String(Number(Number(cache.layerW).toFixed(4)));
}

  return {
    nearestHWIndex, renderQEExternalLegend,
    renderSingle, singleMapBraggHoverAngles, updateGeometryTargetMarker
  };
}
