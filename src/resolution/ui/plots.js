// Resolution: ellipse plots, axes, U-V oblique view and widths.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
export function installResolutionPlots(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    bindResolutionUVView, formatAngle, formatResolutionAxis, renderResolutionPlots,
    rerenderResolution, resolutionDisplayAxes, resolutionFrameLimits, resolutionWidthsHtml,
    resolutionBaseLayout:(...args)=>baseLayout(...args), reactResolutionPlot:(...args)=>reactResolutionPlot(...args),
    RESOLUTION_PLOT_FONTS:()=>RESOLUTION_PLOT_FONTS
  });

// Resolution plots use explicit symmetric limits around the calculation point.
// A single Calc always resets to the current ellipse size so the ellipse cannot
// remain clipped by a viewport left over from an earlier calculation.  A Scan
// supplies limits precomputed over every scan point; those same limits are then
// reused for every slider position so the apparent ellipse evolution is not
// contaminated by changing plot scales.
// fonts: {title, axis, tick} sizes.  The Resolution tab keeps its large tick
// labels; the compact Angle calculation view passes smaller sizes.
const RESOLUTION_PLOT_FONTS={title:22,axis:20,tick:21};
// Major grid darker, minor grid lighter.
const RESOLUTION_MAJOR_GRID={showgrid:true,gridcolor:'#bcc4cd',gridwidth:1};
const RESOLUTION_MINOR_GRID={showgrid:true,gridcolor:'#e8ebee',gridwidth:1,ticks:''};
// Q axes: only three labelled ticks (-a, 0, a) with a round a, so the small
// δQ numbers are never crowded or rotated.  Minor grid lines subdivide a.
function resolutionQTicks(lim){
  // Largest round step within 90 % of the half range (0.05 rather than 0.025
  // for a 0.06 half range), so the labels match the ellipse size.
  const raw=0.9*Number(lim);
  if(!(raw>0) || !Number.isFinite(raw)) return {minor:{...RESOLUTION_MINOR_GRID}};
  const decade=Math.pow(10,Math.floor(Math.log10(raw)));
  const mantissa=[1,2,2.5,5,10].filter(m=>m*decade<=raw*(1+1e-9)).pop()||1;
  const a=Number((mantissa*decade).toPrecision(6));
  const divisions=Math.abs(mantissa-2)<1e-9 ? 4 : 5;
  return {tickmode:'array',tickvals:[-a,0,a],minor:{...RESOLUTION_MINOR_GRID,tickmode:'linear',tick0:0,dtick:a/divisions}};
}
function baseLayout(title,xlabel,ylabel,xlim,ylim,equal=false,plotId=null,fonts=RESOLUTION_PLOT_FONTS,yIsQ=false){
  const safe=(v,fallback=1)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):fallback;
  const xl=safe(xlim), yl=safe(ylim);
  return {
    uirevision:plotId||'resolutionPlots',
    title:{text:title,font:{size:fonts.title}},
    // Leave space below the x-axis title at native compact density.  An
    // automatic margin also accommodates longer axis names and mobile fonts.
    margin:fonts.margin || {l:88,r:22,t:52,b:94,autoexpand:true},
    // The card border and the plot axes serve different purposes: the plot
    // frame is confined to the data area; the card encloses each full chart.
    xaxis:{title:{text:xlabel,standoff:13,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},range:[-xl,xl],zeroline:true,...RESOLUTION_MAJOR_GRID,...resolutionQTicks(xl),showline:true,mirror:true,linecolor:'#586472',linewidth:1},
    yaxis:{title:{text:ylabel,standoff:12,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},range:[-yl,yl],zeroline:true,...RESOLUTION_MAJOR_GRID,...(yIsQ?resolutionQTicks(yl):{minor:{...RESOLUTION_MINOR_GRID}}),showline:true,mirror:true,linecolor:'#586472',linewidth:1,...(equal?{scaleanchor:'x',scaleratio:1}:{})},
    hovermode:'closest',hoverdistance:18,
    showlegend:false
  };
}

function resolutionPlotLimitsFromEntries(entries){
  const valid=Array.isArray(entries)?entries.filter(Boolean):[];
  if(!valid.length) return null;
  const maxLim=key=>{
    let m=0;
    for(const entry of valid){
      const v=Number(entry?.result?.lim?.[key]);
      if(Number.isFinite(v) && v>m) m=v;
    }
    return m>0?m:null;
  };
  const U=maxLim('U'), V=maxLim('V'), W=maxLim('W'), E=maxLim('E');
  const UVU=maxLim('UVU'), UVV=maxLim('UVV');
  return {U,V,W,E,...(UVU?{UVU}:{}),...(UVV?{UVV}:{})};
}
// Plot limits of the entries in the chosen display frame.
function resolutionFrameLimits(entries){
  const valid=Array.isArray(entries)?entries.filter(Boolean):[];
  return resolutionPlotLimitsFromEntries(valid.map(e=>({result:{lim:fn.resolutionFrame(e.result).lim}})));
}
function formatAngle(value,absolute=false){
  if(value===null || value===undefined || !Number.isFinite(Number(value))) return '';
  const v=absolute ? Math.abs(Number(value)) : Number(value);
  return v.toFixed(3);
}

function formatResolutionAxis(v){
  return `(${v.map(x=>{
    const y=Number(x);
    return Math.abs(y-Math.round(y))<1e-10 ? String(Math.round(y)) : Number(y.toPrecision(6)).toString();
  }).join(', ')})`;
}
function resolutionDisplayAxes(r,lc){
  return fn.resolutionFrame(r)?.displayAxes || r.displayAxes || {U:lc.sv1,V:lc.sv2,W:lc.sv3};
}
// One-line FWHM summary shared by the Resolution tab and Angle calculation.
// Values in parentheses are the coherent (slice) widths.
function resolutionWidthsHtml(r,unitMode,lc){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹';
  const ax=resolutionDisplayAxes(r,lc), fmtAxis=formatResolutionAxis, d=fn.resolutionFrame(r).display;
  return `<b>Resolution</b> δQ//${fmtAxis(ax.U)}=${d.U.toFixed(4)} (${d.Ucoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.V)}=${d.V.toFixed(4)} (${d.Vcoh.toFixed(4)}) ${qUnit}, `+
    `δQ//${fmtAxis(ax.W)}=${d.W.toFixed(4)} (${d.Wcoh.toFixed(4)}) ${qUnit}, `+
    `δħω=${d.E.toFixed(4)} (${d.Ecoh.toFixed(4)}) meV`;
}
// Plotly's built-in double-click "reset" returns to the axis ranges of the
// plot's first draw (an earlier point), which looks like a random scale.
// Disable it and return to the ranges of the current calculation instead.
function reactResolutionPlot(id,traces,layout,after=null){
  const gd=$(id);
  if(!gd) return;
  gd.__tasResolutionView={x:layout.xaxis.range.slice(),y:layout.yaxis.range.slice()};
  Promise.resolve(Plotly.react(gd,traces,layout,{responsive:true,doubleClick:false}))
    .then(()=>{installResolutionDoubleClick(gd); if(after) after(gd);})
    .catch(err=>console.warn('Resolution plot warning:',err));
}
function installResolutionDoubleClick(gd){
  if(!gd || typeof gd.on!=='function' || gd.__tasResolutionDoubleClick) return;
  gd.__tasResolutionDoubleClick=()=>requestAnimationFrame(()=>{
    const view=gd.__tasResolutionView;
    if(!view || !gd.isConnected) return;
    Plotly.relayout(gd,{
      'xaxis.range':view.x.slice(),'yaxis.range':view.y.slice(),
      'xaxis.autorange':false,'yaxis.autorange':false
    }).catch(err=>console.warn('Resolution plot reset:',err));
  });
  gd.on('plotly_doubleclick',gd.__tasResolutionDoubleClick);
}
shared.RESOLUTION_PLOT_IDS={UE:'plotUE',VE:'plotVE',UV:'plotUV',WE:'plotWE'};
// Draw the four projection/slice ellipse plots into the given plot elements.
function renderResolutionPlots(r,unitMode,lc,limits,ids=shared.RESOLUTION_PLOT_IDS,fonts=RESOLUTION_PLOT_FONTS){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹';
  const ax=resolutionDisplayAxes(r,lc), fmtAxis=formatResolutionAxis;
  const frame=fn.resolutionFrame(r), el=frame.ellipses;
  const qeTitle=v=>`δQ ∥ ${fmtAxis(v)} vs δħω`;
  reactResolutionPlot(
    ids.UE,
    [fn.traceEllipse(el.projUE,'projection'),fn.traceEllipse(el.sliceUE,'slice','dash')],
    baseLayout(qeTitle(ax.U),`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,'δħω (meV)',limits.U,limits.E,false,ids.UE,fonts),
  );

  reactResolutionPlot(
    ids.VE,
    [fn.traceEllipse(el.projVE,'projection'),fn.traceEllipse(el.sliceVE,'slice','dash')],
    baseLayout(qeTitle(ax.V),`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,'δħω (meV)',limits.V,limits.E,false,ids.VE,fonts),
  );

  reactResolutionPlot(
    ids.WE,
    [fn.traceEllipse(el.projWE,'projection'),fn.traceEllipse(el.sliceWE,'slice','dash')],
    baseLayout(qeTitle(ax.W),`δQ ∥ ${fmtAxis(ax.W)} (${qUnit})`,'δħω (meV)',limits.W,limits.E,false,ids.WE,fonts),
  );

  const lattice=fn.resolutionCoordinates()==='lattice' && r.lattice;
  const oblique=!!lattice && Math.abs(r.lattice.vDirection.cos)>1e-6;
  if(ids===shared.RESOLUTION_PLOT_IDS) syncResolutionUVHead(oblique);
  const uvGd=$(ids.UV); if(uvGd) uvGd.__tasObliqueGrid=null;
  if(oblique && shared.resolutionUVView==='shape'){
    renderObliqueUVPlot(r,unitMode,ax,ids.UV,fonts,limits);
    return;
  }
  // Each axis keeps its own resolution range (r.l.u. and Å⁻¹ alike), so the
  // ellipse fills the panel; a forced 1:1 aspect made Plotly widen the U
  // range to fill the wide panel.
  const uvEqual=false;
  // U, V, E, W: the U-V ellipse is in the oblique coefficients (UVU/UVV).
  const uLim=(lattice && limits.UVU) || limits.U, vLim=(lattice && limits.UVV) || limits.V;
  const layout=baseLayout(
    `δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,
    `δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,
    `δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,
    uLim,vLim,uvEqual,ids.UV,fonts,true
  );
  reactResolutionPlot(ids.UV,[fn.traceEllipse(el.projUV,'projection'),fn.traceEllipse(el.sliceUV,'slice','dash')],layout);
}
// Round step for resolution axes: the largest 1, 2, 2.5 or 5 x 10^n that
// still fits inside 90 % of the half range, so the labelled ticks sit near
// the ellipse size (e.g. 0.05 rather than 0.025 for a 0.06 half range).
function resolutionNiceStep(halfRange){
  const raw=0.9*Number(halfRange);
  if(!(raw>0) || !Number.isFinite(raw)) return 1;
  const decade=Math.pow(10,Math.floor(Math.log10(raw)));
  const mantissa=[1,2,2.5,5,10].filter(m=>m*decade<=raw*(1+1e-9)).pop()||1;
  return Number((mantissa*decade).toPrecision(6));
}
// Oblique U/V grid for the true-shape U–V plot, built like the Constant E
// map in r.l.u.: the plot is physically orthonormal, the u/v = constant lines
// are drawn as shapes, and the axis ticks are placed where those lines meet
// the bottom (U) and left (V) frame edges, with the axis titles outside.
// basis: physical (x, y) of one unit of U and of V in the selected unit.
function resolutionObliqueGrid(basis,xRange,yRange,uStep,vStep){
  const {ux,uy,vx,vy}=basis, det=ux*vy-uy*vx;
  const out={shapes:[],xTickVals:[],xTickText:[],yTickVals:[],yTickText:[]};
  if(!(Math.abs(det)>1e-15)) return out;
  const xmin=Math.min(...xRange),xmax=Math.max(...xRange),ymin=Math.min(...yRange),ymax=Math.max(...yRange);
  const toUV=(x,y)=>[(x*vy-y*vx)/det,(ux*y-uy*x)/det];
  const toXY=(u,v)=>[ux*u+vx*v,uy*u+vy*v];
  const corners=[[xmin,ymin],[xmin,ymax],[xmax,ymin],[xmax,ymax]].map(p=>toUV(...p));
  const umin=Math.min(...corners.map(p=>p[0])),umax=Math.max(...corners.map(p=>p[0]));
  const vmin=Math.min(...corners.map(p=>p[1])),vmax=Math.max(...corners.map(p=>p[1]));
  // Steps from the visible U and V ranges unless given.
  // (U along x: the horizontal half range; V: the vertical half range over
  // its y component), so the labelled ticks match the frame size.
  if(!(uStep>0)) uStep=resolutionNiceStep((xmax-xmin)/2/Math.max(Math.abs(ux),1e-15));
  if(!(vStep>0)) vStep=resolutionNiceStep((ymax-ymin)/2/Math.max(Math.abs(vy),1e-15));
  const spanU=(umax-umin)+2*uStep, spanV=(vmax-vmin)+2*vStep;
  const fmt=v=>Math.abs(v)<1e-12?'0':String(Number(v.toPrecision(6)));
  const eps=1e-9*Math.max(xmax-xmin,ymax-ymin,1e-12);
  const line=(origin,delta,style)=>({type:'line',xref:'x',yref:'y',layer:'below',
    x0:origin[0]-delta[0],y0:origin[1]-delta[1],x1:origin[0]+delta[0],y1:origin[1]+delta[1],line:style});
  const minorStyle={color:'#e8ebee',width:1}, majorStyle={color:'#bcc4cd',width:1}, zeroStyle={color:'#444',width:1};
  const divisions=step=>{const m=step/Math.pow(10,Math.floor(Math.log10(step)));return Math.abs(m-2)<1e-6?4:5;};
  const onMajor=(value,step)=>Math.abs(value/step-Math.round(value/step))<1e-6;
  const uMinor=uStep/divisions(uStep), vMinor=vStep/divisions(vStep);
  for(let n=Math.ceil(umin/uMinor-1e-9),i=0;n*uMinor<=umax+1e-12&&i<400;n++,i++){
    const u=n*uMinor; if(!onMajor(u,uStep)) out.shapes.push(line(toXY(u,(vmin+vmax)/2),[vx*spanV/2,vy*spanV/2],minorStyle));
  }
  for(let n=Math.ceil(vmin/vMinor-1e-9),i=0;n*vMinor<=vmax+1e-12&&i<400;n++,i++){
    const v=n*vMinor; if(!onMajor(v,vStep)) out.shapes.push(line(toXY((umin+umax)/2,v),[ux*spanU/2,uy*spanU/2],minorStyle));
  }
  for(let n=Math.ceil(umin/uStep-1e-9),i=0;n*uStep<=umax+1e-12&&i<60;n++,i++){
    const u=n*uStep;
    out.shapes.push(line(toXY(u,(vmin+vmax)/2),[vx*spanV/2,vy*spanV/2],n===0?zeroStyle:majorStyle));
    if(Math.abs(vy)>1e-15){
      const v=(ymin-uy*u)/vy, x=ux*u+vx*v;
      if(x>=xmin-eps && x<=xmax+eps){ out.xTickVals.push(Math.max(xmin,Math.min(xmax,x))); out.xTickText.push(fmt(u)); }
    }
  }
  for(let n=Math.ceil(vmin/vStep-1e-9),i=0;n*vStep<=vmax+1e-12&&i<60;n++,i++){
    const v=n*vStep;
    out.shapes.push(line(toXY((umin+umax)/2,v),[ux*spanU/2,uy*spanU/2],n===0?zeroStyle:majorStyle));
    if(Math.abs(ux)>1e-15){
      const u=(xmin-vx*v)/ux, y=uy*u+vy*v;
      if(y>=ymin-eps && y<=ymax+eps){ out.yTickVals.push(Math.max(ymin,Math.min(ymax,y))); out.yTickText.push(fmt(v)); }
    }
  }
  out.shapes.push({type:'rect',xref:'x domain',yref:'y domain',x0:0,x1:1,y0:0,y1:1,line:{color:'#586472',width:1},fillcolor:'rgba(0,0,0,0)',layer:'above'});
  return out;
}
// True-shape U–V plot for non-orthogonal U and V: the ellipse is drawn in
// physical (Å⁻¹) coordinates, x along U and y along the in-plane normal to U,
// with an oblique U/V grid labelled in the selected unit.
function renderObliqueUVPlot(r,unitMode,ax,id,fonts,limits){
  const qUnit=unitMode==='rlu'?'r.l.u.':'Å⁻¹', fmtAxis=formatResolutionAxis;
  const rlu=unitMode==='rlu';
  const nU=rlu?r.qNorms.U:1, nVorth=rlu?r.qNorms.V:1, nV=rlu?r.lattice.qNorms.V:1;
  const {cos,sin}=r.lattice.vDirection;
  const phys=p=>({x:p.x.map(v=>v*nU),y:p.y.map(v=>v*nVorth)});
  const proj=phys(r.ellipses.projUV), slice=phys(r.ellipses.sliceUV);
  const basis={ux:nU,uy:0,vx:nV*cos,vy:nV*sin};
  const toAB=(x,y)=>{const b=y/sin, a=x-b*cos; return [fn.formatResolutionCoordinate(a/nU),fn.formatResolutionCoordinate(b/nV)];};
  const trace=(p,name,dash,color)=>({x:p.x,y:p.y,mode:'lines',name,line:{dash,color},
    customdata:p.x.map((x,i)=>toAB(x,p.y[i])),
    hovertemplate:`U: %{customdata[0]}<br>V: %{customdata[1]} (${qUnit})<extra></extra>`});
  // Same ranges as the U–V view: U over ±limits.U and V over ±limits.V
  // (the V range maps to y through the V component normal to U).  In r.l.u.
  // and Å⁻¹ alike the two axes keep their own scales, as in the U–V
  // view.  The x range is widened only when the tilted ellipse would
  // otherwise be cut off.
  const absMax=(...a)=>Math.max(0,...a.flat().map(Math.abs).filter(Number.isFinite));
  const limU=Number(limits?.U)>0?Number(limits.U):0, limV=Number(limits?.V)>0?Number(limits.V):0;
  const ellX=absMax(proj.x,slice.x), ellY=absMax(proj.y,slice.y);
  const equal=false;
  let halfX=Math.max(limU*nU,1.05*ellX), halfY=Math.max(limV*nV*Math.abs(sin),1.05*ellY);
  if(!(halfX>0)) halfX=1; if(!(halfY>0)) halfY=1;
  const xRange=[-halfX,halfX], yRange=[-halfY,halfY];
  const grid=resolutionObliqueGrid(basis,xRange,yRange);
  const axis=(title,range,vals,text)=>({title:{text:title,standoff:13,font:{size:fonts.axis}},automargin:true,tickfont:{size:fonts.tick},
    range:range.slice(),tickmode:'array',tickvals:vals,ticktext:text,ticks:'outside',showgrid:false,zeroline:false,showline:false});
  const layout={
    uirevision:`${id}-oblique`,
    title:{text:`δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,font:{size:fonts.title}},
    margin:fonts.margin || {l:88,r:22,t:52,b:94,autoexpand:true},
    xaxis:axis(`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,xRange,grid.xTickVals,grid.xTickText),
    yaxis:{...axis(`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,yRange,grid.yTickVals,grid.yTickText),...(equal?{scaleanchor:'x',scaleratio:1}:{})},
    shapes:grid.shapes,hovermode:'closest',hoverdistance:18,showlegend:false
  };
  const gd=$(id);
  if(gd) gd.__tasObliqueGrid={basis};
  reactResolutionPlot(id,[trace(proj,'projection','solid','#1f77b4'),trace(slice,'slice','dash','#ff7f0e')],layout,refreshObliqueGrid);
  // Re-label the oblique grid after zooming, panning or resizing.
  if(gd && !gd.__tasObliqueRelayout && typeof gd.on==='function'){
    gd.__tasObliqueRelayout=true;
    gd.on('plotly_relayout',event=>{
      if(!Object.keys(event||{}).some(k=>/^([xy]axis\.(range|autorange)|autosize|width|height)/.test(k))) return;
      refreshObliqueGrid(gd);
    });
  }
}
// Rebuild the oblique grid for the axis ranges Plotly actually drew.
function refreshObliqueGrid(gd){
  const g=gd?.__tasObliqueGrid;
  if(!g || gd.__tasObliqueBusy) return;
  const xr=gd._fullLayout?.xaxis?.range, yr=gd._fullLayout?.yaxis?.range;
  if(!Array.isArray(xr)||!Array.isArray(yr)) return;
  const grid=resolutionObliqueGrid(g.basis,xr,yr);
  gd.__tasObliqueBusy=true;
  Promise.resolve(Plotly.relayout(gd,{shapes:grid.shapes,'xaxis.tickvals':grid.xTickVals,'xaxis.ticktext':grid.xTickText,
    'yaxis.tickvals':grid.yTickVals,'yaxis.ticktext':grid.yTickText}))
    .catch(()=>{}).finally(()=>{gd.__tasObliqueBusy=false;});
}
// The U–V view selector (Calculation point toolbar) applies only to the
// lattice frame with non-orthogonal U and V.
function syncResolutionUVHead(show){
  // The selector sits in the Calculation point toolbar, so toggling it never
  // changes the plot sizes; it is enabled only when it has an effect.
  const select=$('resolutionUVView');
  if(!select) return;
  if(select.value!==shared.resolutionUVView) select.value=shared.resolutionUVView;
  select.disabled=!show;
  select.title=show?'':'Only for U, V, E, W with U not perpendicular to V';
}
function bindResolutionUVView(){
  const select=$('resolutionUVView');
  if(!select || select.dataset.bound) return;
  select.dataset.bound='1';
  select.value=shared.resolutionUVView;
  select.addEventListener('change',()=>{
    shared.resolutionUVView=select.value==='coefficients'?'coefficients':'shape';
    try{ localStorage.setItem(shared.RESOLUTION_UV_VIEW_KEY,shared.resolutionUVView); }catch(_e){}
    rerenderResolution();
  });
}
// Re-draw the last result in the current display frame (no recalculation).
function rerenderResolution(){
  fn.renderResolutionComparison?.();
  if(!shared.lastResolutionRender) return;
  const {entry,indexInfo,scan}=shared.lastResolutionRender;
  if(scan && shared.scanResults.length){
    shared.scanResolutionPlotLimits=resolutionFrameLimits(shared.scanResults.filter(e=>!e.failed));
    fn.renderResolutionScan(Number($('scanSlider')?.value)||1);
  }else fn.renderResolution(entry,indexInfo,fn.resolutionFrame(entry.result).lim);
}
}
