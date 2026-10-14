// Constant-E map rendering (renderSingle), external legends, hw slider and navigation controls.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {PI, deg2rad, linspace} from '../tas-core.js';
import {tasConvention} from '../tas-conventions.js';

export function createQESingleRender(deps){
  const {
    $, backgroundColor, bindSingleRluGrid, bindSingleZoomPeakScaling, collectResolutionBase,
    currentPlotRanges, currentQEMapUnit, num, positionSingleColorbarEntries, qeObliqueRluGrid,
    qePathMapLabel, qePathPointXY, qePhysicalRluCoordinates, qeSelectedPathHKL, qeXYForUnit,
    renderGeometry, renderQEVectorMap, selectedBackgrounds, selectedS1Sign, selectedTasSense,
    singleColorbarTicks, singleMarkerSizes, singleNuclearLabelStyle, tasMotorAngles,
    updateQESpurionWarning, updateS2MaxDisplayForQERange
  }=deps;

// Shared legend UI for Constant E, Q-vector–E and Powder. Keep independent
// show/hide states for each plot, and group dummy and data traces together.
const qeLegendVisibilityByPlot=new Map();
function qeLegendKey(trace){
  if(['nuclear-data','nuclear-labels','nuclear-legend'].includes(trace.meta)) return 'Nuclear Bragg peaks';
  if(trace.name==='Accessible Q–E') return 'Accessible Q';
  return trace.legendgroup || trace.name || '';
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
    for(const [x1,y1,x2,y2] of lines) add('line',{x1,y1,x2,y2,stroke:color,'stroke-width':2.6,'stroke-linecap':'round'});
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
function renderQEExternalLegend(hostId,plotId,traces){
  const host=$(hostId);
  if(!host) return;
  host.replaceChildren();
  let visibility=qeLegendVisibilityByPlot.get(plotId);
  if(!visibility){visibility=new Map();qeLegendVisibilityByPlot.set(plotId,visibility);}
  const keys=[];
  for(const trace of traces){
    const key=qeLegendKey(trace);
    if(key && trace.showlegend!==false && !keys.includes(key)) keys.push(key);
  }
  const setVisibility=()=>{
    const indices=traces.map((tr,i)=>keys.includes(qeLegendKey(tr))?i:-1).filter(i=>i>=0);
    if(indices.length){
      Plotly.restyle(plotId,{visible:indices.map(i=>visibility.get(qeLegendKey(traces[i]))===false?'legendonly':true)},indices);
    }
    host.querySelectorAll('.qe-legend-item').forEach(el=>{
      el.setAttribute('aria-pressed',String(visibility.get(el.dataset.legendKey)!==false));
    });
  };
  for(const key of keys){
    const exemplar=traces.find(tr=>qeLegendKey(tr)===key && tr.showlegend!==false);
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
  }
  // Respect the selected legend visibility across recalculations.
  for(const trace of traces){
    if(visibility.get(qeLegendKey(trace))===false) trace.visible='legendonly';
  }
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
      angleResult=`S1=${showAngle(angles?.s1)}, S2=${showAngle(angles?.s2)}`;
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
  const qMax = Math.max(0, ...allViewPoints.map(p => Math.hypot(p[0], p[1])));

  const s2Min = num("S2min");
  const s2Max = cache.S2list[i];
  const Qplot=Math.max(1e-6,1.15*Math.max(...allViewPoints.map(p=>Math.max(Math.abs(p[0]),Math.abs(p[1]))),1));
  // Identical physical ranges preserve circular Q contours and oblique U/V angles.
  const QplotX=Qplot, QplotY=Qplot;
  const initialXRange=keptView.x||[-Qplot,Qplot];
  const initialYRange=keptView.y||[-Qplot,Qplot];
  const rluGrid=unit==='rlu' ? qeObliqueRluGrid(cache,initialXRange,initialYRange) : null;
  const initialMarkerSizes=singleMarkerSizes(2*QplotX,2*QplotX,cache.Gpoints.length+cache.magPoints.length);

  // Show every calculated nuclear peak. The unused intensity-threshold filter was removed.
  const visibleGpoints=transformedG;
  const peakHoverAngles=singleMapBraggHoverAngles(cache,cache.hwList[i]);

  const traces=[
    {
      x:boundary.map(p=>p[0]),
      y:boundary.map(p=>p[1]),
      fill:"toself",
      name:`Accessible Q (${s2Min.toFixed(0)}° ≤ S2 ≤ ${s2Max.toFixed(0)}°)`,
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
      x:visibleGpoints.map(p=>p.x),
      y:visibleGpoints.map(p=>p.y),
      mode:"markers",
      name:"Nuclear Bragg peaks",
      showlegend:false,
      meta:"nuclear-data",
      zorder:0,
      marker:cache.cifStructure ? {
        color:visibleGpoints.map(p=>Number.isFinite(p.sfNorm)?p.sfNorm:0),
        colorscale:[[0,"rgb(245,245,245)"],[0.25,"rgb(205,205,205)"],[0.5,"rgb(150,150,150)"],[0.75,"rgb(85,85,85)"],[1,"rgb(0,0,0)"]],
        cmin:Number($("sfColorMinEntry")?.value ?? 0),cmax:Number($("sfColorMaxEntry")?.value ?? 1),
        showscale:true,
        colorbar:{title:{text:"|F_N|² / max",side:"right",font:{size:18}},tickfont:{size:17},thickness:16,len:0.62,x:1.01,xanchor:"left",y:0.52,
          ...singleColorbarTicks(Number($("sfColorMinEntry")?.value ?? 0),Number($("sfColorMaxEntry")?.value ?? 1))},
        size:initialMarkerSizes.nuclear,
        line:{color:"rgba(80,80,80,0.55)",width:0.4}
      } : {color:"black",size:initialMarkerSizes.nuclear},
      hovertext:visibleGpoints.map(p=>{
        if(!p.label) return p.label;
        const lines=[p.label,peakHoverAngles(p)];
        if(cache.cifStructure){
          const raw=Number.isFinite(p.sf2)?p.sf2:0, rel=Number.isFinite(p.sfNorm)?p.sfNorm:0;
          lines.push(`|F<sub>N</sub>|² = ${(raw/100).toPrecision(6)} barn`,`|F<sub>N</sub>|² / max = ${rel.toFixed(4)}`);
        }
        return lines.join('<br>');
      }),
      hovertemplate:"%{hovertext}<extra></extra>"
    },
  ];
  if($("displayNuclearLabels")?.checked){
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
  // Keep propagation vectors visually distinct by marker shape while retaining
  // one magnetic-peak color.  The symbol sequence cycles only if many k vectors
  // are added; the propagation-vector index remains explicit in the legend.
  const magneticSymbols=["circle","x","star","diamond","cross","triangle-up","square","diamond-open","triangle-down","pentagon"];
  const magneticIndices=[...new Set(transformedMag.map(p=>Number(p.qIndex)).filter(Number.isFinite))].sort((a,b)=>a-b);
  for(const qIndex of magneticIndices){
    const pts=transformedMag.filter(p=>p.qIndex===qIndex);
    if(!pts.length) continue;
    const symbol=magneticSymbols[(qIndex-1)%magneticSymbols.length];
    traces.push({
      x:pts.map(p=>p.x),y:pts.map(p=>p.y),mode:"markers",name:`Magnetic Bragg peaks: k${qIndex}`,
      marker:{color:"red",size:symbol==="star"?initialMarkerSizes.star:initialMarkerSizes.magnetic,symbol},
      hovertext:pts.map(p=>p.label ? `${p.label}<br>${peakHoverAngles(p)}` : p.label),
      hovertemplate:"%{hovertext}<extra></extra>",
      zorder:10
    });
  }
  const selectedS2=syncSingleNavigation(cache,i);
  const selectedQ=selectedQAtS2(cache,i,selectedS2);
  if($('displayS2Ring')?.checked && Number.isFinite(selectedQ)){
    const phi=linspace(0,2*PI,361);
    const ringPts=phi.map(t=>T([selectedQ*Math.cos(t),selectedQ*Math.sin(t)]));
    traces.push({x:ringPts.map(p=>p[0]),y:ringPts.map(p=>p[1]),mode:"lines",name:`S2 = ${selectedS2.toFixed(1)}°`,showlegend:false,line:{color:"black",width:1.2,dash:"solid"},hovertemplate:`S2 = ${selectedS2.toFixed(1)}°<br>Q = ${selectedQ.toFixed(3)} Å⁻¹<extra></extra>`});
  }
  for(const ring of cache.ringData){
    const pts=ring.x.map((x,j)=>T([x,ring.y[j]]));
    traces.push({
      x:pts.map(p=>p[0]),y:pts.map(p=>p[1]),mode:"lines",showlegend:false,
      line:{color:ring.color,width:1.5},hovertemplate:ring.hover+"<extra></extra>"
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
    traces.push({type:'scatter',mode:'lines+markers+text',showlegend:false,meta:'qe-selected-path',zorder:100,
      x:points.map(p=>p[0]),y:points.map(p=>p[1]),text:points.map((_,j)=>qePathMapLabel(j,cache)),
      textposition:'top center',textfont:{size:14,color:'#7e22ce'},
      marker:{size:13,color:'#9333ea',line:{color:'#fff',width:2}},
      line:{color:'#9333ea',width:2.5,dash:'dash'},
      // Match the nuclear/magnetic peak hover: use the shared TAS motor-angle
      // calculation at the currently selected energy, sense and S1 sign.
      customdata:qeSelectedPathHKL.map(hkl=>[
        hkl.map(v=>Number(v).toFixed(3)).join(', '),
        peakHoverAngles({label:'HKL',hkl})
      ]),
      hovertemplate:'HKL = (%{customdata[0]})<br>%{customdata[1]}<extra></extra>'});
  }
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
  const singleDraw=Plotly.react("singlePlot",traces,{
    // Preserve user zoom/pan when controls trigger a recalculation.
    uirevision:`singlePlot-${unit}`,
    showlegend:false,
    xaxis:{title:{text:unit==='rlu'?'U (r.l.u.)':'Qx (Å⁻¹)',font:{size:16}},tickfont:{size:17},range:keptView.x||[-QplotX,QplotX],tickmode:unit==='rlu'?'array':'auto',tickvals:unit==='rlu'?rluGrid.xTickVals:undefined,ticktext:unit==='rlu'?rluGrid.xTickText:undefined,nticks:10,showgrid:unit!=='rlu',showticklabels:true,ticks:unit==='rlu'?'outside':'',gridcolor:'#c3c9cf',gridwidth:1,zeroline:unit!=='rlu',zerolinecolor:'#777',showline:true,linecolor:'#555',linewidth:1.2,mirror:true,constrain:'domain'},
    yaxis:{title:{text:unit==='rlu'?'V (r.l.u.)':'Qy (Å⁻¹)',font:{size:16}},tickfont:{size:17},range:keptView.y||[-QplotY,QplotY],tickmode:unit==='rlu'?'array':'auto',tickvals:unit==='rlu'?rluGrid.yTickVals:undefined,ticktext:unit==='rlu'?rluGrid.yTickText:undefined,nticks:10,showgrid:unit!=='rlu',showticklabels:true,ticks:unit==='rlu'?'outside':'',gridcolor:'#c3c9cf',gridwidth:1,zeroline:unit!=='rlu',zerolinecolor:'#777',showline:true,linecolor:'#555',linewidth:1.2,mirror:true,scaleanchor:'x',scaleratio:1,constrain:'domain'},
    ...(rluGrid?{shapes:rluGrid.shapes,annotations:rluGrid.annotations}:{}),
    // The legend now lives below the display controls, outside this Plotly canvas.
    margin:{l:60,r:cache.cifStructure?88:20,t:28,b:67}
  },{responsive:true,doubleClick:false});
  if(plotNode) plotNode.dataset.qeUnit=unit;
  Promise.resolve(singleDraw).then(()=>{
    if(plotNode?.__tasMapDrawToken!==drawToken) return;
    bindSingleZoomPeakScaling(cache,2*QplotX,2*QplotY);
    bindSingleRluGrid(cache);
    $('sfColorbarRange')?.classList.toggle('hidden',!cache.cifStructure);
    positionSingleColorbarEntries();
  }).catch(err=>console.warn('Constant E map drawing warning:',err));

  const hwDisplay=$("hwValue");
  if(hwDisplay) hwDisplay.textContent=`${cache.hwList[i].toFixed(1)} meV`;
  const hwEntry=$("hwEntry");
  if(hwEntry && document.activeElement!==hwEntry) hwEntry.value=cache.hwList[i].toFixed(1);
  updateQESpurionWarning(cache,i);
  updateS2MaxDisplayForQERange(cache,i);
  renderGeometry(cache,i);
  if(!$('qeVectorMapPane')?.classList.contains('hidden')) renderQEVectorMap(cache);
}


function ensureNuclearLabelControl(){
  if($("displayNuclearLabels")) return;
  const plot=$("singlePlot");
  const sliderRow=$("hwSlider")?.closest(".energy-slider-row");
  if(!plot || !sliderRow) return;
  const row=document.createElement("div");
  row.className="nuclear-label-control";
  row.innerHTML='<label class="checkbox-label"><input id="displayNuclearLabels" type="checkbox" checked><span>Display labels of nuclear Bragg peaks</span></label>';
  const toolbar=document.querySelector('.qe-map-toolbar');
  if(toolbar) row.insertBefore(toolbar,row.firstChild);
  sliderRow.parentNode.insertBefore(row,sliderRow);
}

function ensureQESliderControls(){
  if(!$('hwEntry')){
    const row=$('hwSlider')?.closest('.energy-slider-row');
    if(row){
      const parent=row.parentNode;
      const grid=document.createElement('div');
      grid.id='qeRangeControlGrid';
      grid.className='qe-range-control-grid';

      const hwCard=document.createElement('div');
      hwCard.className='qe-range-control';
      hwCard.innerHTML='<div class="qe-control-entry qe-hw-control-entry"><span>ħω (meV)</span><input id="hwEntry" type="number" step="0.1" value="0.0"></div>';
      hwCard.appendChild($('hwSlider'));
      const hwOut=$('hwValue'); if(hwOut) hwOut.classList.add('hidden');

      const s2Card=document.createElement('div');
      s2Card.className='qe-range-control';
      s2Card.innerHTML='<div class="qe-control-entry qe-s2-control-entry"><span>S2 (deg)</span><label class="checkbox-label qe-s2-ring-toggle" title="Show S2 ring on Constant E map"><input id="displayS2Ring" type="checkbox"><span>Show S2 ring</span></label><input id="s2Entry" aria-label="S2 (deg)" type="number" step="0.1" value="0.0"></div><input id="s2Slider" type="range" min="0" max="180" step="0.1" value="0">';

      grid.append(hwCard,s2Card);
      parent.insertBefore(grid,row);
      row.remove();
    }
  }
  // Always enforce the actual DOM order, including if the ħω entry already
  // existed. The checkbox itself is moved (not cloned) to keep its ID, state,
  // event listeners and local-storage behavior intact.
  const hwEntry=$('hwEntry');
  const hwControl=hwEntry?.closest('.qe-hw-control-entry');
  const lambdaLabel=$('lambdaHalf')?.closest('label');
  if(hwControl && lambdaLabel){
    const formerRow=lambdaLabel.parentElement;
    const caption=hwControl.querySelector(':scope > span');
    lambdaLabel.classList.add('qe-lambda-half-toggle', 'qe-s2-ring-toggle');
    if(caption) caption.after(lambdaLabel);
    else hwControl.insertBefore(lambdaLabel,hwEntry);
    lambdaLabel.after(hwEntry);
    // Remove only the emptied wrapper from the old sidebar location.
    if(formerRow!==hwControl && formerRow?.classList.contains('grid2') &&
       !formerRow.querySelector('input,select,button')) formerRow.remove();
  }
}
function nearestHWIndex(cache,value){
  let best=0, d=Infinity; cache.hwList.forEach((x,i)=>{const di=Math.abs(x-value); if(di<d){d=di;best=i;}}); return best;
}
function syncSingleNavigation(cache,index){
  const i=Math.max(0,Math.min(index,cache.hwList.length-1));
  if($('hwSlider')) $('hwSlider').value=i;
  if($('hwEntry')) $('hwEntry').value=cache.hwList[i].toFixed(1);
  if($('hwValue')) $('hwValue').textContent=`${cache.hwList[i].toFixed(1)} meV`;
  const lo=0, hi=180;
  const slider=$('s2Slider'), entry=$('s2Entry');
  if(slider){ slider.min=lo; slider.max=hi; slider.step=0.1; }
  let v=Number(entry?.value); if(!Number.isFinite(v)) v=Math.max(0,num('S2min')); v=Math.max(lo,Math.min(hi,v));
  if(slider) slider.value=v; if(entry) entry.value=v.toFixed(1); if($('s2Value')) $('s2Value').textContent=`${v.toFixed(1)}°`;
  return v;
}
function selectedQAtS2(cache,index,s2){
  const hw=cache.hwList[index]; let Ei,Ef;
  if(cache.energyMode==='Ef fixed'){Ef=cache.Ef;Ei=Ef+hw;} else {Ei=cache.Ei;Ef=Ei-hw;}
  if(!(Ei>0&&Ef>0)) return NaN;
  const ki=0.6947*Math.sqrt(Ei), kf=0.6947*Math.sqrt(Ef);
  return Math.sqrt(Math.max(0,ki*ki+kf*kf-2*ki*kf*Math.cos(deg2rad(s2))));
}

  return {
    ensureNuclearLabelControl, ensureQESliderControls, nearestHWIndex, renderQEExternalLegend,
    renderSingle
  };
}
