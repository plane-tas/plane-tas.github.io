// Q-vector map: oblique RLU grid, point-in-polygon tests and renderQEVectorMap.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
export function createQEVectorMap(deps){
  const {
    $, backgroundColor, backgroundMaterials, backgroundPowderPeaks, checkedValue, currentQEMapUnit,
    powderS2ForQAtHW, qeFormatPathNumber, qePathAxisCoordinateLabel, qePathPointXY,
    qePhysicalRluCoordinates, qePlaneRluBasis, qeSelectedPathHKL, renderQEExternalLegend, renderSingle,
    representativePowderHklText, safeResizePlot, scatteringPlaneWarningMessage, selectedBackgrounds,
    setScatteringPlaneWarning, getPowderCache, getSingleCache
  }=deps;

let qeVectorMeasureCanvas=null;
function qeRluNiceStep(span){
  const raw=Math.max(1e-12,Math.abs(span)/9);
  const decade=Math.pow(10,Math.floor(Math.log10(raw)));
  return [1,2,5,10].map(v=>v*decade).find(v=>v>=raw) || 10*decade;
}

// Number of minor intervals per major grid step: 1-2-5 steps are split into
// 0.2-0.5-1 minor steps (a "2" mantissa uses four 0.5 intervals).
function qeMinorDivisions(step){
  const mantissa=Math.abs(step)/Math.pow(10,Math.floor(Math.log10(Math.abs(step))));
  return Math.abs(mantissa-2)<1e-6 ? 4 : 5;
}

// Plot frame of the Constant E map (the oblique r.l.u. grid replaces the
// axis lines, so draw the frame as a shape on the constrained axis domain).
const QE_MAP_FRAME={type:'rect',xref:'x domain',yref:'y domain',x0:0,x1:1,y0:0,y1:1,
  line:{color:'#555',width:1.2},fillcolor:'rgba(0,0,0,0)',layer:'above'};
function qeObliqueRluGrid(cache,xRange,yRange){
  const grid=qeObliqueRluGridLines(cache,xRange,yRange);
  return {...grid,shapes:[...grid.shapes,{...QE_MAP_FRAME}]};
}
function qeObliqueRluGridLines(cache,xRange,yRange){
  const b=qePlaneRluBasis(cache);
  const det=b.ux*b.vy-b.uy*b.vx;
  const empty={shapes:[],annotations:[],xTickVals:[],xTickText:[],yTickVals:[],yTickText:[]};
  if(!Number.isFinite(det) || Math.abs(det)<1e-12) return empty;
  const xmin=Math.min(...xRange),xmax=Math.max(...xRange);
  const ymin=Math.min(...yRange),ymax=Math.max(...yRange);
  const corners=[[xmin,ymin],[xmin,ymax],[xmax,ymin],[xmax,ymax]].map(p=>qePhysicalRluCoordinates(cache,p));
  const umin=Math.min(...corners.map(p=>p[0])),umax=Math.max(...corners.map(p=>p[0]));
  const vmin=Math.min(...corners.map(p=>p[1])),vmax=Math.max(...corners.map(p=>p[1]));
  const ustep=qeRluNiceStep(umax-umin),vstep=qeRluNiceStep(vmax-vmin);
  const shapes=[],xTickVals=[],xTickText=[],yTickVals=[],yTickText=[];
  const gridLine=(origin,delta,zero)=>({
    type:'line',xref:'x',yref:'y',
    x0:origin[0]-delta[0],y0:origin[1]-delta[1],
    x1:origin[0]+delta[0],y1:origin[1]+delta[1],
    layer:'above',line:{color:zero?'rgba(70,80,95,0.75)':'rgba(90,100,115,0.48)',width:zero?1.8:1.3}
  });
  const toXY=(u,v)=>[b.ux*u+b.vx*v,b.uy*u+b.vy*v];
  const fmt=v=>Math.abs(v)<1e-9?'0':String(Number(v.toPrecision(6)));
  const spanU=(umax-umin)+2*ustep,spanV=(vmax-vmin)+2*vstep;
  const nU0=Math.ceil(umin/ustep-1e-9),nU1=Math.floor(umax/ustep+1e-9);
  const nV0=Math.ceil(vmin/vstep-1e-9),nV1=Math.floor(vmax/vstep+1e-9);
  const eps=1e-8*Math.max(xmax-xmin,ymax-ymin,1);
  // Minor grid: lighter u/v=constant lines between the major lines.  They are
  // pushed first so the major lines are drawn on top of them.
  const minorLine=(origin,delta)=>({
    type:'line',xref:'x',yref:'y',
    x0:origin[0]-delta[0],y0:origin[1]-delta[1],
    x1:origin[0]+delta[0],y1:origin[1]+delta[1],
    layer:'above',line:{color:'rgba(105,115,130,0.20)',width:0.9}
  });
  const umStep=ustep/qeMinorDivisions(ustep),vmStep=vstep/qeMinorDivisions(vstep);
  const mU0=Math.ceil(umin/umStep-1e-9),mU1=Math.floor(umax/umStep+1e-9);
  const mV0=Math.ceil(vmin/vmStep-1e-9),mV1=Math.floor(vmax/vmStep+1e-9);
  const onMajor=(value,step)=>Math.abs(value/step-Math.round(value/step))<1e-6;
  for(let n=mU0;n<=mU1 && n<mU0+400;n++){
    const u=n*umStep;
    if(!onMajor(u,ustep)) shapes.push(minorLine(toXY(u,(vmin+vmax)/2),[b.vx*spanV/2,b.vy*spanV/2]));
  }
  for(let n=mV0;n<=mV1 && n<mV0+400;n++){
    const v=n*vmStep;
    if(!onMajor(v,vstep)) shapes.push(minorLine(toXY((umin+umax)/2,v),[b.ux*spanU/2,b.uy*spanU/2]));
  }
  // In r.l.u. mode the graph is still physically orthonormal (Å^-1), but
  // u/v=constant grid lines are oblique.  Place Plotly's axis ticks exactly
  // where those same grid lines intersect the BOTTOM and LEFT frame edges.
  // This leaves both tick labels and axis titles outside the plot, like Å^-1.
  for(let n=nU0;n<=nU1 && n<nU0+40;n++){
    const u=n*ustep,zero=n===0;
    shapes.push(gridLine(toXY(u,(vmin+vmax)/2),[b.vx*spanV/2,b.vy*spanV/2],zero));
    if(Math.abs(b.vy)>1e-12){
      const vAtBottom=(ymin-b.uy*u)/b.vy;
      const xAtBottom=b.ux*u+b.vx*vAtBottom;
      if(Number.isFinite(xAtBottom) && xAtBottom>=xmin-eps && xAtBottom<=xmax+eps){
        xTickVals.push(Math.max(xmin,Math.min(xmax,xAtBottom)));
        xTickText.push(fmt(u));
      }
    }
  }
  for(let n=nV0;n<=nV1 && n<nV0+40;n++){
    const v=n*vstep,zero=n===0;
    shapes.push(gridLine(toXY((umin+umax)/2,v),[b.ux*spanU/2,b.uy*spanU/2],zero));
    if(Math.abs(b.ux)>1e-12){
      const uAtLeft=(xmin-b.vx*v)/b.ux;
      const yAtLeft=b.uy*uAtLeft+b.vy*v;
      if(Number.isFinite(yAtLeft) && yAtLeft>=ymin-eps && yAtLeft<=ymax+eps){
        yTickVals.push(Math.max(ymin,Math.min(ymax,yAtLeft)));
        yTickText.push(fmt(v));
      }
    }
  }
  return {shapes,annotations:[],xTickVals,xTickText,yTickVals,yTickText};
}

function bindSingleRluGrid(cache){
  const gd=$('singlePlot');
  if(!gd || typeof gd.on!=='function') return;
  if(gd.__tasRluGridHandler && typeof gd.removeListener==='function')
    gd.removeListener('plotly_relayout',gd.__tasRluGridHandler);
  gd.__tasRluGridHandler=null;
  if(currentQEMapUnit()!=='rlu') return;
  let scheduled=false,updating=false;
  const handler=event=>{
    if(updating || scheduled) return;
    // Plotly.relayout(shapes/annotations) also fires plotly_relayout; do not
    // recursively rebuild the grid in response to our own updates.
    const keys=Object.keys(event||{});
    if(!keys.some(k=>/^([xy]axis\.(range|autorange)|[xy]axis\.range\[)/.test(k))) return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      if(!gd.isConnected || currentQEMapUnit()!=='rlu') return;
      const xr=gd._fullLayout?.xaxis?.range,yr=gd._fullLayout?.yaxis?.range;
      if(!Array.isArray(xr)||!Array.isArray(yr)) return;
      updating=true;
      const grid=qeObliqueRluGrid(cache,xr,yr);
      Promise.resolve(Plotly.relayout(gd,{
        shapes:grid.shapes,annotations:grid.annotations,
        'xaxis.tickvals':grid.xTickVals,'xaxis.ticktext':grid.xTickText,
        'yaxis.tickvals':grid.yTickVals,'yaxis.ticktext':grid.yTickText
      })).catch(err=>console.warn('Oblique RLU grid refresh warning:',err))
        .finally(()=>{updating=false;});
    });
  };
  gd.__tasRluGridHandler=handler;
  gd.on('plotly_relayout',handler);
}

function qePointInPolygon(point,polygon){
  const x=point[0], y=point[1];
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const xi=polygon[i][0], yi=polygon[i][1], xj=polygon[j][0], yj=polygon[j][1];
    const cross=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-30)+xi);
    if(cross) inside=!inside;
  }
  return inside;
}

function qeMapHeaderTitle(cache){
  const energyText=cache.energyMode==="Ef fixed"?`Ef=${cache.Ef.toFixed(2)} meV`:`Ei=${cache.Ei.toFixed(2)} meV`;
  const lam=cache.lambdaHalf?" | λ/2":"";
  const plane=`(${cache.U.join(",")})-(${cache.V.join(",")})`;
  const spaceGroup=`#${cache.sampleSpaceGroup?.number ?? 1} ${cache.sampleSpaceGroup?.hm ?? "P1"}`;
  const lattice=`a=${cache.lc.a.toFixed(3)}, b=${cache.lc.b.toFixed(3)}, c=${cache.lc.c.toFixed(3)} Å, `+
    `α=${cache.lc.alpha.toFixed(1)}, β=${cache.lc.beta.toFixed(1)}, γ=${cache.lc.gamma.toFixed(1)}°`;
  return `${cache.inst.name||"Instrument"} | ${energyText}${lam} | Scattering plane: ${plane}<br>`+
    `${spaceGroup} | ${lattice}`;
}

// Plotly's native double-click reset can restore a stale viewport after a
// Q-path edit. Disable that built-in reset on this plot and always return to
// the current path's calculated axes instead (without affecting Constant E).
function installQEVectorDoubleClickReset(plot){
  if(!plot || typeof plot.on!=='function' || plot.__tasQEVectorResetHandler) return;
  const handler=()=>{
    const view=plot.__tasQEVectorDefaultView;
    if(!view || !plot.isConnected) return;
    Plotly.relayout(plot,{
      'xaxis.range':view.x.slice(),
      'yaxis.range':view.y.slice(),
      'xaxis.autorange':false,
      'yaxis.autorange':false
    }).catch(err=>console.warn('Q vector–E map reset:',err));
  };
  plot.__tasQEVectorResetHandler=handler;
  plot.on('plotly_doubleclick',handler);
}

function renderQEVectorMap(cache){
  const plot=$('qeVectorPlot'), msg=$('qeVectorMessage');
  if(!plot || !cache || cache.powder) return;
  try{
    const pathPoints=qeSelectedPathHKL.map(point=>point.slice());
    if(pathPoints.length<2){
      // An empty path is a normal editing state, not a warning.
      if(msg) msg.textContent='';
      setScatteringPlaneWarning('qeVectorPlaneWarning','');
      $('qeVectorLegend')?.replaceChildren();
      try{Plotly.purge(plot);}catch(_e){}
      plot.__tasQEVectorPathKey=null;
      plot.__tasQEVectorDefaultView=null;
      plot.__tasQEVectorResetHandler=null;
      return;
    }
    const multiple=pathPoints.length>2;
    const planeWarnings=[];
    pathPoints.forEach((point,index)=>{
      const warning=scatteringPlaneWarningMessage(point,`P${index+1}`);
      if(warning) planeWarnings.push(warning.replace(/^Warning:\s*/,''));
    });
    setScatteringPlaneWarning('qeVectorPlaneWarning',planeWarnings.length?`Warning: ${planeWarnings.join(' / ')}`:'');
    // Piecewise-linear path in physical scattering-plane coordinates.
    const paths=[]; let totalDistance=0;
    for(let j=0;j<pathPoints.length-1;j++){
      const startHKL=pathPoints[j],endHKL=pathPoints[j+1];
      const startXY=qePathPointXY(cache,startHKL),endXY=qePathPointXY(cache,endHKL);
      const dx=endXY[0]-startXY[0],dy=endXY[1]-startXY[1],length=Math.hypot(dx,dy);
      if(!(length>1e-10)) throw new Error(`P${j+1} and P${j+2} must be distinct in the scattering plane.`);
      paths.push({a:startHKL,b:endHKL,p0:startXY,p1:endXY,ux:dx/length,uy:dy/length,length,start:totalDistance});
      totalDistance+=length;
    }
    const currentPathKey=pathPoints.map(p=>p.join(',')).join(';');
    const pathChanged=plot.__tasQEVectorPathKey!==currentPathKey;
    // A new path must get its own viewport, even if Plotly has a cached zoom
    // from the old path. Recalculation with an unchanged path may keep zoom.
    plot.__tasQEVectorPathKey=currentPathKey;
    const renderToken=(plot.__tasQEVectorRenderToken||0)+1;
    plot.__tasQEVectorRenderToken=renderToken;
    const first=pathPoints[0],last=pathPoints.at(-1),dh=last.map((v,i)=>v-first[i]);
    // Two points retain the h/k/l axis convention. For 3+ vertices, use
    // accumulated physical path length and mark the bends P1..Pn.
    const variableLength=Math.max(...dh.map(Math.abs));
    const xScale=multiple?1:variableLength/totalDistance;
    const axisNumber=value=>qeFormatPathNumber(value);
    let axisTitle='HKL path';
    // Two points: when the path can be written with one index as the
    // variable -- only one of h, k, l changes, or the changing ones are equal
    // or opposite to it, e.g. (h, h, 0) or (h, -h, 1) -- the x axis is
    // labelled with the actual value of that index (l from 3 to -3, say).
    // Otherwise (e.g. (0,0,0) -> (0,1,2)) no single number describes a point:
    // the ticks carry no numbers and the end points are given as HKL.
    const varyingIndices=dh.map((d,i)=>Math.abs(d)>1e-10?i:-1).filter(i=>i>=0);
    let singleIndex=-1;
    const ratios=[0,0,0];
    if(!multiple && varyingIndices.length){
      const i0=varyingIndices[0];
      const ok=varyingIndices.every(j=>{
        const r=dh[j]/dh[i0];
        if(!(Math.abs(Math.abs(r)-1)<1e-9)) return false;
        ratios[j]=Math.sign(r);
        return Math.abs(first[j]-ratios[j]*first[i0])<1e-9;
      });
      if(ok) singleIndex=i0;
    }
    const singleSign=singleIndex>=0 ? Math.sign(dh[singleIndex]) : 1;
    if(singleIndex>=0){
      const symbol=['h','k','l'][singleIndex];
      axisTitle=`(${first.map((v,i)=>ratios[i]===1?symbol:ratios[i]===-1?`-${symbol}`:axisNumber(v)).join(', ')})`;
    }
    // Allocate samples proportional to each segment's length and include
    // its two endpoints; deduplicate shared vertices for a monotonic x axis.
    const samples=[];
    for(const [j,path] of paths.entries()){
      const steps=Math.max(3,Math.round(260*path.length/totalDistance));
      for(let n=j===0?0:1;n<=steps;n++){
        const t=n/steps;
        samples.push({x:(path.start+t*path.length)*xScale,
          xy:[path.p0[0]+t*path.length*path.ux,path.p0[1]+t*path.length*path.uy],
          hkl:path.a.map((v,k)=>v+t*(path.b[k]-v))});
      }
    }
    const xVals=samples.map(p=>p.x),hMin=0,hMax=totalDistance*xScale;
    const knots=[0,...paths.map(p=>(p.start+p.length)*xScale)];
    const tickVals=[];
    // Minor x grid positions (path coordinate).  A single segment subdivides
    // its regular tick step; a multi-vertex path subdivides each segment at
    // round r.l.u. increments of its dominant varying index.
    const xMinorVals=[];
    if(multiple){
      tickVals.push(...knots);
      for(const path of paths){
        const variable=Math.max(...path.a.map((v,k)=>Math.abs(path.b[k]-v)));
        if(!(variable>1e-9) || !(path.length>0)) continue;
        const raw=variable/5,decade=Math.pow(10,Math.floor(Math.log10(raw)));
        const step=([1,2,5,10].find(m=>m*decade>=raw*(1-1e-9))||10)*decade;
        for(let n=1;n<50;n++){
          const t=n*step/variable;
          if(t>1-1e-9) break;
          xMinorVals.push((path.start+t*path.length)*xScale);
        }
      }
    }else{
      const roughStep=hMax/8,base10=Math.pow(10,Math.floor(Math.log10(roughStep)));
      const tickStep=([1,2,2.5,5,10].find(s=>s*base10>=roughStep)||10)*base10;
      const minorStep=tickStep/qeMinorDivisions(tickStep);
      // Grid in the varying index itself (x = |change of that index|), so the
      // ticks fall on round h/k/l values; otherwise on round path lengths.
      const origin=singleIndex>=0 ? first[singleIndex] : 0;
      const sign=singleIndex>=0 ? singleSign : 1;
      const lo=Math.min(origin,origin+sign*hMax), hi=Math.max(origin,origin+sign*hMax);
      const toX=value=>(value-origin)*sign;
      for(let n=Math.ceil(lo/minorStep-1e-9);n*minorStep<=hi+minorStep*1e-9;n++){
        const value=n*minorStep;
        if(Math.abs(value/tickStep-Math.round(value/tickStep))>1e-6) xMinorVals.push(toX(value));
      }
      for(let n=Math.ceil(lo/tickStep-1e-9);n*tickStep<=hi+tickStep*1e-9;n++){
        tickVals.push(Number(toX(n*tickStep).toPrecision(12)));
      }
      tickVals.sort((a,b)=>a-b);
    }
    // Keep every vertex as an x-axis tick, but draw the HKL coordinates as
    // horizontal annotations.  Plotly's native tickangle rotates *all* labels;
    // stagger individual labels into rows when their bounding boxes overlap.
    const tickText=multiple
      ?pathPoints.map((_,i)=>qePathAxisCoordinateLabel(i))
      :singleIndex>=0
        ?tickVals.map(x=>axisNumber(first[singleIndex]+singleSign*x))
        :tickVals.map(()=>'');
    // Measure the real rendered width (canvas, same font as the annotations).
    // A per-character estimate overstates labels such as "(0.5, 0, 1)".
    // tas-plot-density.js scales every Plotly font (and margin) by the UI
    // density, so the labels are 17*density px wide on screen, not 17 px.
    const uiDensity=(()=>{const d=Number(window.tasUIDensity?.());return d>0?d:1;})();
    const labelPixelWidth=text=>{
      const t=String(text);
      try{
        const ctx=(qeVectorMeasureCanvas||(qeVectorMeasureCanvas=document.createElement('canvas'))).getContext('2d');
        ctx.font=`${17*uiDensity}px ${plot._fullLayout?.font?.family||'"Open Sans", verdana, arial, sans-serif'}`;
        const w=ctx.measureText(t).width;
        if(w>0) return w;
      }catch(_e){}
      return Math.max(0,t.length*17*uiDensity*0.56);
    };
    const longestVertexLabel=Math.max(...pathPoints.map((_,i)=>labelPixelWidth(qePathAxisCoordinateLabel(i))));
    const sideMargin=Math.ceil(Math.max(88,longestVertexLabel/2+24));
    const plotPixelWidth=plot.getBoundingClientRect().width||plot.clientWidth||540;
    // Rows are assigned from the ACTUAL plot-area width and the CURRENT x range
    // (after zoom). Labels outside the range are not drawn and never force a row.
    const staggeredPathLabels=(width=plotPixelWidth,{areaWidth=null,range=null}={})=>{
      if(!multiple) return {annotations:[],rowCount:0};
      const usableWidth=Math.max(60,Number(areaWidth)>0?Number(areaWidth):width-2*sideMargin*uiDensity);
      const [r0,r1]=Array.isArray(range)&&range.length===2&&Number(range[1])>Number(range[0]) ? range.map(Number) : [hMin,hMax];
      const span=Math.max(r1-r0,1e-9);
      const lastRight=[];
      const annotations=knots.map((x,i)=>{
        const width=labelPixelWidth(tickText[i]);
        const center=(x-r0)/span*usableWidth;
        const visible=x>=r0-span*1e-6 && x<=r1+span*1e-6;
        if(!visible) return {x,xref:'x',y:0,yref:'paper',yshift:-11,
          text:tickText[i],showarrow:false,xanchor:'center',yanchor:'top',font:{size:17}};
        const left=center-width/2;
        let row=lastRight.findIndex(right=>left>=right+9*uiDensity);
        if(row<0){row=lastRight.length;lastRight.push(-Infinity);}
        lastRight[row]=center+width/2;
        return {x,xref:'x',y:0,yref:'paper',yshift:-11-21*row,
          text:tickText[i],showarrow:false,xanchor:'center',yanchor:'top',
          font:{size:17}};
      });
      return {annotations,rowCount:lastRight.length};
    };
    const pathLabelLayout=staggeredPathLabels();
    const z=[], darkKiZ=[], darkKfZ=[], darkFixedZ=[], hover=[];
    for(let i=0;i<cache.hwList.length;i++){
      const row=[], kiRow=[], kfRow=[], fixedRow=[], hrow=[];
      const region=cache.regions[i];
      const darkKi=cache.darkKI[i]||[], darkKf=cache.darkKF[i]||[], darkFixed=cache.darkFixed[i]||[];
      for(const sample of samples){
        const pt=sample.xy;
        const geometric=qePointInPolygon(pt,region);
        // Dark-angle geometry is an independent display layer.  Do not clip it
        // to the Accessible-Q polygon: a blocked motor geometry can lie outside
        // the currently reachable S1 envelope and should still be visible on
        // the Q-vector–E map when it falls inside the displayed axes.
        const inKi=darkKi.some(poly=>qePointInPolygon(pt,poly));
        const inKf=darkKf.some(poly=>qePointInPolygon(pt,poly));
        const inFixed=darkFixed.some(poly=>qePointInPolygon(pt,poly));
        // Keep the underlying accessible region yellow and draw dark-angle
        // regions as explicit colored overlays, including outside Accessible Q.
        row.push(geometric?1:0);
        kiRow.push(inKi?1:null);
        kfRow.push(inKf?1:null);
        fixedRow.push(inFixed?1:null);
        const hkl=sample.hkl;
        let status='';
        if(inKi || inKf || inFixed){
          const labels=[];
          if(inKi) labels.push('dark angle: ki side');
          if(inKf) labels.push('dark angle: kf side');
          if(inFixed) labels.push('dark angle: fixed');
          status=`<br>${labels.join(', ')}`;
        }
        hrow.push(`HKL = (${hkl.map(v=>v.toFixed(3)).join(', ')})<br>ℏω = ${cache.hwList[i].toFixed(2)} meV${status}`);
      }
      z.push(row); darkKiZ.push(kiRow); darkKfZ.push(kfRow); darkFixedZ.push(fixedRow); hover.push(hrow);
    }
    const endX=hMax;
    const traces=[{
      type:'heatmap',x:xVals,y:cache.hwList,z,
      zmin:0,zmax:1,showscale:false,hoverinfo:'text',text:hover,
      colorscale:[[0,'rgba(255,255,255,0)'],[0.499,'rgba(255,255,255,0)'],[0.5,'rgba(255,222,105,0.72)'],[1,'rgba(255,222,105,0.72)']],
      name:'Accessible Q–E',showlegend:false
    },{
      type:'scatter',mode:'markers',x:[null],y:[null],hoverinfo:'skip',
      marker:{size:11,symbol:'square',color:'rgba(255,222,105,0.90)',line:{color:'#c7a62c',width:1}},
      name:'Accessible Q',showlegend:true,legendrank:0
    }];
    const addDarkOverlay=(mask,name,color,legendrank)=>{
      if(!mask.some(row=>row.some(v=>v===1))) return;
      traces.push({type:'heatmap',x:xVals,y:cache.hwList,z:mask,zmin:0,zmax:1,showscale:false,hoverinfo:'skip',
        colorscale:[[0,color],[1,color]],name,showlegend:true,legendrank});
    };
    // Keep legend ordering consistent with the Constant E map: Accessible Q,
    // background materials, then dark-angle overlays.

    // Overlay background-powder |Q| spheres intersecting EVERY path leg.
    // Each intersection is a vertical line at its cumulative path distance.
    const qVectorLimit=Math.max(...paths.flatMap(p=>[Math.hypot(...p.p0),Math.hypot(...p.p1)]));
    for(const bg of selectedBackgrounds()){
      const material=backgroundMaterials.get(bg.key);
      const visiblePeaks=backgroundPowderPeaks(material,qVectorLimit);
      let bgLegendShown=false;
      for(const peak of visiblePeaks){
        for(const path of paths){
          const proj=path.p0[0]*path.ux+path.p0[1]*path.uy;
          const perp2=Math.max(0,Math.hypot(...path.p0)**2-proj*proj);
          const discriminant=peak.q*peak.q-perp2;
          if(discriminant<-1e-10) continue;
          const root=Math.sqrt(Math.max(0,discriminant));
          const seen=[];
          for(const sv of [-proj-root,-proj+root]){
            if(sv<-1e-9 || sv>path.length+1e-9 || seen.some(v=>Math.abs(v-sv)<1e-8)) continue;
            seen.push(sv);
            const t=Math.min(1,Math.max(0,sv/path.length));
            const x=[],y=[],customdata=[];
            let open=false;
            for(const w of cache.hwList){
              const s2=powderS2ForQAtHW(peak.q,w);
              if(!Number.isFinite(s2)){
                if(open){x.push(null);y.push(null);customdata.push(null);open=false;}
                continue;
              }
              const hkl=path.a.map((v,k)=>v+t*(path.b[k]-v));
              x.push((path.start+sv)*xScale);y.push(w);
              customdata.push([
                `BG${bg.index+1}: ${bg.key}<br>${representativePowderHklText(peak)}<br>I/Imax = ${peak.relativeIntensity.toFixed(3)}<br>HKL path = (${hkl.map(v=>v.toFixed(3)).join(', ')})`,
                peak.q,`${s2.toFixed(3)}°`
              ]);
              open=true;
            }
            if(open){x.push(null);y.push(null);customdata.push(null);}
            if(!x.length) continue;
            traces.push({type:'scatter',mode:'lines',x,y,customdata,
              name:`BG${bg.index+1}: ${bg.key}`,
              legendgroup:`background-scattering-${bg.index}`,
              showlegend:!bgLegendShown,legendrank:10+bg.index,
              line:{color:backgroundColor(bg.slot,0.20+0.75*peak.relativeIntensity),width:1.5},
              hovertemplate:`%{customdata[0]}<br>Q = %{customdata[1]:.4f} Å⁻¹<br>ħω = %{y:.3f} meV<br>S2 = %{customdata[2]}<extra></extra>`
            });
            bgLegendShown=true;
          }
        }
      }
    }

    addDarkOverlay(darkKiZ,'Dark angle (ki side)','rgba(75,190,105,0.55)',20);
    addDarkOverlay(darkKfZ,'Dark angle (kf side)','rgba(75,170,235,0.55)',21);
    addDarkOverlay(darkFixedZ,'Dark angle (fixed)','rgba(95,105,220,0.50)',22);

    // Plotly's native axis grid is rendered behind data traces, so colored
    // heatmap overlays can obscure it.  Build a matching set of grid lines as
    // top-layer shapes so the grid stays readable over Accessible-Q, BG and
    // dark-angle colors as well as the white background.
    const hwMax=Math.max(0,...cache.hwList);
    const niceGridStep=max=>{
      if(!(max>0)) return 1;
      const raw=max/8, power=Math.pow(10,Math.floor(Math.log10(raw)));
      const scaled=raw/power;
      const candidates=[1,2,5,10];
      const nice=candidates.reduce((best,value)=>
        Math.abs(value-scaled)<Math.abs(best-scaled)?value:best
      ,candidates[0]);
      return nice*power;
    };
    const yGridStep=niceGridStep(hwMax);
    const yGridVals=[];
    for(let y=0;y<=hwMax+1e-9;y+=yGridStep) yGridVals.push(Number(y.toFixed(12)));
    if(hwMax>0 && !yGridVals.some(y=>Math.abs(y-hwMax)<1e-9)) yGridVals.push(hwMax);
    const yMinorStep=yGridStep/qeMinorDivisions(yGridStep);
    const yMinorVals=[];
    for(let n=1;n<200;n++){
      const y=n*yMinorStep;
      if(y>hwMax+yMinorStep*1e-9) break;
      if(Math.abs(y/yGridStep-Math.round(y/yGridStep))>1e-6) yMinorVals.push(y);
    }
    const minorGridLine={color:'rgba(105,115,125,0.20)',width:0.9};
    const frontGridShapes=[
      ...xMinorVals.map(x=>({type:'line',xref:'x',yref:'paper',x0:x,x1:x,y0:0,y1:1,layer:'above',line:minorGridLine})),
      ...yMinorVals.map(y=>({type:'line',xref:'paper',yref:'y',x0:0,x1:1,y0:y,y1:y,layer:'above',line:minorGridLine})),
      ...tickVals.map(x=>({type:'line',xref:'x',yref:'paper',x0:x,x1:x,y0:0,y1:1,layer:'above',line:{color:'rgba(105,115,125,0.58)',width:1.3}})),
      ...yGridVals.map(y=>({type:'line',xref:'paper',yref:'y',x0:0,x1:1,y0:y,y1:y,layer:'above',line:{color:'rgba(105,115,125,0.58)',width:1.3}}))
    ];

    renderQEExternalLegend('qeVectorLegend','qeVectorPlot',traces);
    const defaultView={x:[hMin,hMax],y:[0,hwMax]};
    plot.__tasQEVectorDefaultView=defaultView;
    const renderPromise=Plotly.react(plot,traces,{
      uirevision:`qeVector-${currentPathKey}`, 
      plot_bgcolor:'#fff',paper_bgcolor:'#fff',
      showlegend:false,
      xaxis:{title:{text:''},tickfont:{size:17},tickmode:'array',tickvals:tickVals,
        ticktext:multiple?tickVals.map(()=>''):tickText,
        range:[hMin,hMax],tickangle:0,automargin:false,zeroline:false,
        ticks:multiple?'outside':'',showgrid:false,showline:true,linecolor:'#555',linewidth:1.2,mirror:true},
      yaxis:{title:{text:'ℏω (meV)',font:{size:15}},tickfont:{size:17},range:[0,hwMax],tickmode:'array',tickvals:yGridVals,zeroline:false,showgrid:false,showline:true,linecolor:'#555',linewidth:1.2,mirror:true},
      shapes:[
        ...frontGridShapes,
        ...knots.map(x=>({type:'line',x0:x,x1:x,y0:0,y1:1,yref:'paper',layer:'above',line:{color:'black',width:1,dash:'dot'}}))
      ],
      annotations:[
        {x:0.5,xref:'paper',y:0,yref:'paper',
          yshift:multiple?-(48+21*pathLabelLayout.rowCount):-123,
          text:axisTitle,showarrow:false,xanchor:'center',yanchor:'top',font:{size:15}},
        ...pathLabelLayout.annotations,
        ...multiple?[]:[
          {x:hMin,xref:'x',y:0,yref:'paper',yshift:-60,
            text:qePathAxisCoordinateLabel(0),showarrow:false,
            xanchor:'center',yanchor:'top',font:{size:17}},
          {x:hMax,xref:'x',y:0,yref:'paper',yshift:-60,
            text:qePathAxisCoordinateLabel(pathPoints.length-1),showarrow:false,
            xanchor:'center',yanchor:'top',font:{size:17}}
        ]
      ],
      margin:{l:sideMargin,r:sideMargin,t:multiple?52:45,
        b:multiple?80+21*pathLabelLayout.rowCount:158}
    },{responsive:true,doubleClick:false});
    Promise.resolve(renderPromise).then(()=>{
      if(!plot.isConnected || plot.__tasQEVectorRenderToken!==renderToken) return;
      installQEVectorDoubleClickReset(plot);
      plot.__tasPathRefreshAxisLabels?.();
      // Force the current path's axes when a vertex is added/removed/edited.
      // Otherwise Plotly may reuse the last double-click/zoom state.
      if(pathChanged) return Plotly.relayout(plot,{
        'xaxis.range':defaultView.x.slice(),
        'yaxis.range':defaultView.y.slice(),
        'xaxis.autorange':false,
        'yaxis.autorange':false
      });
    }).catch(err=>console.warn('Q vector–E map viewport:',err));
    // A responsive Plotly resize does not re-run the label row selection.
    // Recalculate the horizontal-label rows when the parent pane changes width
    // (for example when a tablet rotates or the browser becomes narrower).
    let appliedRows=pathLabelLayout.annotations.map(a=>a.yshift).join(',');
    plot.__tasPathUpdateAxisLabels=width=>{
      if(!multiple || !plot.isConnected || $('qeVectorMapPane')?.classList.contains('hidden')) return;
      const size=plot._fullLayout?._size;
      const fresh=staggeredPathLabels(width,{
        // The plot-area width is unaffected by the bottom margin we change here.
        areaWidth:size?.w,range:plot._fullLayout?.xaxis?.range});
      const rows=fresh.annotations.map(a=>a.yshift).join(',');
      if(rows===appliedRows) return;
      appliedRows=rows;
      const axisAnnotations=[
        {x:0.5,xref:'paper',y:0,yref:'paper',
          yshift:-(48+21*fresh.rowCount),text:axisTitle,showarrow:false,
          xanchor:'center',yanchor:'top',font:{size:15}},
        ...fresh.annotations
      ];
      // Plotly.relayout bypasses the density adapter (tas-plot-density.js
      // wraps newPlot/react only): scale fonts and the margin here, otherwise
      // a resize/zoom would enlarge the labels and the bottom margin.
      const d=(()=>{const v=Number(window.tasUIDensity?.());return v>0?v:1;})();
      Plotly.relayout(plot,{
        annotations:axisAnnotations.map(a=>({...a,font:{...a.font,size:a.font.size*d}})),
        'margin.b':(80+21*fresh.rowCount)*d
      }).catch(err=>console.warn('Q path label resize:',err));
    };
    plot.__tasPathRefreshAxisLabels=()=>{
      const width=plot.getBoundingClientRect().width;
      if(width>0) plot.__tasPathUpdateAxisLabels?.(width);
    };
    // Zoom/pan changes which labels are visible and how far apart they are.
    if(!plot.__tasPathRelayoutBound && typeof plot.on==='function'){
      plot.__tasPathRelayoutBound=true;
      plot.on('plotly_relayout',ev=>{
        if(ev && Object.keys(ev).some(k=>k.startsWith('xaxis.'))) plot.__tasPathRefreshAxisLabels?.();
      });
    }
    if(typeof ResizeObserver!=='undefined' && !plot.__tasPathResizeObserver){
      plot.__tasPathLastWidth=plotPixelWidth;
      plot.__tasPathResizeObserver=new ResizeObserver(entries=>{
        const width=entries[0]?.contentRect?.width;
        if(!(width>0) || Math.abs(width-plot.__tasPathLastWidth)<3) return;
        plot.__tasPathLastWidth=width;
        clearTimeout(plot.__tasPathResizeTimer);
        plot.__tasPathResizeTimer=setTimeout(()=>plot.__tasPathUpdateAxisLabels?.(width),120);
      });
      plot.__tasPathResizeObserver.observe(plot);
    }
    plot.__tasPathLastWidth=plotPixelWidth;
    if(msg) msg.textContent='';
  }catch(err){
    if(msg) msg.textContent=err?.message||String(err);
    $('qeVectorLegend')?.replaceChildren();
    try{Plotly.purge(plot);}catch(_e){}
    plot.__tasQEVectorPathKey=null;
    plot.__tasQEVectorDefaultView=null;
    plot.__tasQEVectorResetHandler=null;
  }
}

function setQEMapTab(name){
  const vector=name==='vector';
  $('qeMapTabConstant')?.classList.toggle('active',!vector);
  $('qeMapTabVector')?.classList.toggle('active',vector);
  $('qeMapTabConstant')?.setAttribute('aria-selected',String(!vector));
  $('qeMapTabVector')?.setAttribute('aria-selected',String(vector));
  $('qeConstantMapPane')?.classList.toggle('hidden',vector);
  $('qeVectorMapPane')?.classList.toggle('hidden',!vector);
  try{localStorage.setItem('tas-qe-map-tab-v1',vector?'vector':'constant');}catch(_e){}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    // Re-render the newly visible Q-E plot rather than relying on resize.
    // Plotly cannot resize a graph that was intentionally skipped while its
    // pane was hidden.  Reusing the current cache keeps this display-only.
    if(vector){
      if(getSingleCache()) renderQEVectorMap(getSingleCache());
    }else if(checkedValue('sampleMode')==='single'){
      if(getSingleCache()) renderSingle(getSingleCache(),Number($('hwSlider')?.value)||0);
    }else if(getPowderCache()){
      // Powder Constant-E has no separate render-only function; its cached plot
      // should already exist, so resize it once visible.  If it does not, the
      // common visible-plot recovery below will request one recalculation.
      safeResizePlot($('powderPlot'));
    }
  }));
}

  return {
    bindSingleRluGrid, qeObliqueRluGrid, qePointInPolygon, renderQEVectorMap, setQEMapTab
  };
}
