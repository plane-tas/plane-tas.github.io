// Constant-E single-crystal map: peak marker sizes/labels, zoom-dependent scaling and colorbar.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
export function createQESingleMap(deps){
  const {
    $, currentQEMapUnit, qeXYForUnit
  }=deps;

// Dark-angle Rotation/Offset follows the sample S1 sign convention for
// sample-attached references.  The validated legacy -+- dark-polygon mapping
// was historically parameterized with the opposite angular sign, so convert
// only its user-entered angular interval before using that mapping.  This keeps
// the zero/reference calibration unchanged while making +Rotation/+Offset mean
// the same physical (CCW-positive) rotation as +S1 for -+-.
//
// Fixed-reference dark angles are laboratory-fixed directions compared against
// signed S2, not sample rotations, and therefore must not be transformed here.

// TAS S1/Q sign-convention math is implemented in tas-conventions.js.


// Direct-beam dark-angle zero is tied to the currently selected
// ki-perpendicular orientation reference.  For perpU use U; for perpV use V.
// The elastic Bragg condition for that reference lies theta=S2/2 away from the
// ki-perpendicular condition, so the same +theta correction must be used by
// both the Q-E dark-angle calculation and the TAS geometry overlay.
//
// The Direct-beam geometric axis is mirrored separately in the TAS drawing.
// The orientation-reference calibration itself uses the same +theta=S2/2
// correction for both user-facing configurations.






// Rebuild every sample-attached Q-E Dark-angle polygon from the same physical
// geometry used by TAS Geometry.  Sense and S1 polarity enter only as fields of
// one convention object; there is no four-state calculation branch.





function singleMarkerSizes(fullSpan,visibleSpan,peakCount){
  // Keep dense thermal maps readable at the full view, then grow markers smoothly
  // as the user zooms in. Sizes remain bounded so neither view becomes extreme.
  const density=Math.max(0.50,Math.min(1,Math.sqrt(90/Math.max(90,peakCount||0))));
  const zoom=Math.max(1,Math.sqrt(Math.max(1,fullSpan/Math.max(visibleSpan,1e-9))));
  const scale=Math.min(1.55,density*zoom);
  return {nuclear:Math.max(5,12*scale),magnetic:Math.max(3.0,7*scale),star:Math.max(3.5,9*scale)};
}

function singleNuclearLabelStyle(fullSpan,visibleSpan){
  // Pixel-based labels: their distance from the peak must not depend on
  // r.l.u. axis values or on a highly anisotropic reciprocal lattice.
  const zoom=Math.max(1,fullSpan/Math.max(visibleSpan,1e-9));
  return {fontSize:Math.min(22,14+2.5*Math.log2(zoom))};
}

// Unified Q-E Range calculation.

// Use independent x/y viewport spans for zoom sizing. A change of units
// cannot change the markers' initial pixel sizes or their relative spacing.
function singleMapZoomGeometry(gd,fullX,fullY){
  const xr=gd?._fullLayout?.xaxis?.range, yr=gd?._fullLayout?.yaxis?.range;
  const w=Array.isArray(xr)&&xr.length===2 ? Math.abs(xr[1]-xr[0]) : fullX;
  const h=Array.isArray(yr)&&yr.length===2 ? Math.abs(yr[1]-yr[0]) : fullY;
  const fraction=Math.max(1e-7,Math.min(1,Math.sqrt((w/fullX)*(h/fullY))));
  return {fullSpan:fullX,visibleSpan:fullX*fraction};
}

function refreshSinglePeakAppearance(cache,fullX,fullY){
  const gd=$("singlePlot");
  const axes=gd?._fullLayout;
  if(!axes?.xaxis || !axes?.yaxis || !gd?.data?.length) return;
  const zoom=singleMapZoomGeometry(gd,fullX,fullY);
  const peakCount=cache.Gpoints.length+cache.magPoints.length;
  const sourceSizes=singleMarkerSizes(zoom.fullSpan,zoom.visibleSpan,peakCount);
  const sourceLabelStyle=singleNuclearLabelStyle(zoom.fullSpan,zoom.visibleSpan);
  const density=window.tasUIDensity?.() || 1;
  // Plotly marker and text sizes are density-adjusted by tas-plot-density.js.
  // Pixel-based collision/position calculations must use those actual sizes.
  const sizes=Object.fromEntries(Object.entries(sourceSizes).map(([k,v])=>[k,v*density]));
  const labelStyle={fontSize:sourceLabelStyle.fontSize*density};
  const markerIndices=[],markerSizes=[];
  for(let j=0;j<gd.data.length;j++){
    const tr=gd.data[j];
    if(tr.meta==='nuclear-data' || tr.meta==='nuclear-legend'){
      markerIndices.push(j);markerSizes.push(sourceSizes.nuclear);
    }else if(/^Magnetic Bragg peaks: k\d+$/.test(tr.name||'')){
      const symbol=tr.marker?.symbol;
      markerIndices.push(j);markerSizes.push(symbol==='star'?sourceSizes.star:sourceSizes.magnetic);
    }
  }
  if(markerIndices.length) Plotly.restyle(gd,{'marker.size':markerSizes},markerIndices);

  const labelIndex=gd.data.findIndex(tr=>tr.meta==='nuclear-labels');
  if(labelIndex<0) return;
  const pts=cache.Gpoints.filter(p=>p.label!=='');
  const unit=currentQEMapUnit();
  const xaxis=axes.xaxis,yaxis=axes.yaxis;
  const labelPts=pts.map(p=>{
    const q=unit==='rlu' ? [p.x,p.y] : qeXYForUnit(cache,[p.x,p.y],unit);
    return {x:q[0],y:q[1],label:String(p.label||'')};
  });
  // Plotly axis l2p/p2l work in *screen pixels*, not Q coordinates.
  // Each candidate stays the same physical distance from its marker, even
  // for very elongated crystals or after a zoom/pan/resize.
  const plotted=labelPts.map(p=>({
    px:xaxis.l2p(p.x),py:yaxis.l2p(p.y),label:p.label
  }));
  const xSpan=axes._size?.w || gd._fullLayout?._size?.w || 650;
  const ySpan=axes._size?.h || gd._fullLayout?._size?.h || 600;
  const gap=sizes.nuclear/2+labelStyle.fontSize/2+3;
  const boxes=[];
  const positions=plotted.map((point,index)=>{
    const halfWidth=Math.max(8,point.label.length*labelStyle.fontSize*0.29);
    const halfHeight=labelStyle.fontSize*0.6;
    const options=[[0,-gap], [0,gap], [-(halfWidth+sizes.nuclear/2+5),0], [halfWidth+sizes.nuclear/2+5,0],
      [-(halfWidth+sizes.nuclear/2+2),-gap], [halfWidth+sizes.nuclear/2+2,-gap]];
    let best=options[0],bestScore=Infinity,bestBox=null;
    for(const [dx,dy] of options){
      const cx=point.px+dx,cy=point.py+dy;
      const rect={left:cx-halfWidth-2,right:cx+halfWidth+2,top:cy-halfHeight-2,bottom:cy+halfHeight+2};
      let score=0;
      if(rect.left<2 || rect.right>xSpan-2 || rect.top<2 || rect.bottom>ySpan-2) score+=500;
      for(const r of boxes){
        const ix=Math.min(rect.right,r.right)-Math.max(rect.left,r.left);
        const iy=Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top);
        if(ix>0&&iy>0) score+=ix*iy;
      }
      // Favor the traditional position above the marker when space allows.
      score+=options.findIndex(item=>item[0]===dx&&item[1]===dy)*0.2;
      if(score<bestScore){bestScore=score;best=[dx,dy];bestBox=rect;}
      if(score<0.1) break;
    }
    // Do not reserve screen space for points outside the visible viewport.
    if(point.px>=0&&point.px<=xSpan&&point.py>=0&&point.py<=ySpan) boxes.push(bestBox);
    return {x:xaxis.p2l(point.px+best[0]),y:yaxis.p2l(point.py+best[1])};
  });
  Plotly.restyle(gd,{
    x:[positions.map(p=>p.x)],y:[positions.map(p=>p.y)],
    'textfont.size':sourceLabelStyle.fontSize
  },[labelIndex]);
}

function bindSingleZoomPeakScaling(cache,fullX,fullY){
  const gd=$("singlePlot");
  if(!gd || typeof gd.on!=='function') return;
  if(gd.__tasPeakRelayoutHandler && typeof gd.removeListener==='function')
    gd.removeListener('plotly_relayout',gd.__tasPeakRelayoutHandler);
  // Relayout may report new ranges before the SVG has finished updating.
  let scheduled=false;
  const handler=()=>{
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      refreshSinglePeakAppearance(cache,fullX,fullY);
      positionSingleColorbarEntries();
    });
  };
  gd.__tasPeakRelayoutHandler=handler;
  gd.on('plotly_relayout',handler);
  // Plotly's built-in reset can restore stale axis ranges after the panel
  // changes width, especially when the plot has different r.l.u. X/Y spans.
  // Disable that implicit reset and restore the latest *data-derived* ranges
  // ourselves on every double-click. Both units now use physical Q coordinates.
  if(gd.__tasSingleMapDoubleClickHandler && typeof gd.removeListener==='function')
    gd.removeListener('plotly_doubleclick',gd.__tasSingleMapDoubleClickHandler);
  const resetHandler=()=>{
    const drawToken=gd.__tasMapDrawToken;
    // Plotly's doubleclick event is emitted before its internal relayout.
    // Defer our replacement relayout until the native event has completed.
    requestAnimationFrame(()=>{
      if(gd.__tasMapDrawToken!==drawToken || !gd.isConnected) return;
      const view=gd.__tasSingleMapDefaultView;
      if(!view || view.x?.length!==2 || view.y?.length!==2) return;
      Plotly.relayout(gd,{
        'xaxis.range':view.x.slice(),
        'yaxis.range':view.y.slice(),
        'xaxis.autorange':false,
        'yaxis.autorange':false,
        'yaxis.scaleanchor':'x',
        'yaxis.scaleratio':1
      }).catch(err=>console.warn('Constant E map reset warning:',err));
    });
  };
  gd.__tasSingleMapDoubleClickHandler=resetHandler;
  gd.on('plotly_doubleclick',resetHandler);
  if(!gd.__tasPeakResizeObserver && typeof ResizeObserver!=='undefined'){
    gd.__tasPeakResizeObserver=new ResizeObserver(()=>{
      requestAnimationFrame(()=>{
        // Refer to the latest cache and spans, not the closure from the first render.
        if(gd.__tasLatestPeakRefresh) gd.__tasLatestPeakRefresh();
        positionSingleColorbarEntries();
      });
    });
    gd.__tasPeakResizeObserver.observe(gd);
  }
  gd.__tasLatestPeakRefresh=()=>refreshSinglePeakAppearance(cache,fullX,fullY);
  handler();
}

function positionSingleColorbarEntries(){
  const frame=$('singlePlotFrame'),gd=$('singlePlot'),controls=$('sfColorbarRange');
  if(!frame || !gd || !controls || controls.classList.contains('hidden')) return;
  // Place editable text at the exact endpoints of Plotly's colorbar. The
  // corresponding native endpoint labels are omitted via colorbar.ticktext.
  const bar=gd.querySelector('.colorbar .cbfill') || gd.querySelector('.cbfill');
  const rect=bar?.getBoundingClientRect();
  const outer=frame.getBoundingClientRect();
  if(!rect || rect.height<1 || !outer.width) return;
  // Native layout: Plotly and overlay inputs now use the same CSS-pixel
  // coordinate system. No inverse-transform correction is required.
  const max=$('sfColorMaxEntry'),min=$('sfColorMinEntry');
  const density=window.tasUIDensity?.() || 1;
  const entryWidth=58*density;
  const width=outer.width, height=outer.height;
  const x=Math.max(0,Math.min(width-entryWidth,rect.right-outer.left+7*density));
  const topY=rect.top-outer.top, bottomY=rect.bottom-outer.top;
  for(const [entry,cy] of [[max,topY],[min,bottomY]]){
    if(!entry) continue;
    entry.style.left=`${x}px`;
    const entryHeight=entry.getBoundingClientRect().height;
    entry.style.top=`${Math.max(0,Math.min(height-entryHeight,cy-entryHeight/2))}px`;
  }
}

// Intermediate tick marks remain Plotly-native; only the end labels become
// editable HTML numbers directly over the position of those tick labels.
function singleColorbarTicks(min,max){
  const values=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
  const text=values.map((v,i)=>i===0||i===4?'':String(Number(v.toPrecision(3))));
  return {tickmode:'array',tickvals:values,ticktext:text};
}

// Preserve the actual Plotly viewport across data recalculations.
// uirevision alone is not sufficient here because these layouts explicitly
// provide fresh axis ranges on every Plotly.react() call.
function currentPlotRanges(id){
  const gd=$(id);
  const xr=gd?._fullLayout?.xaxis?.range;
  const yr=gd?._fullLayout?.yaxis?.range;
  const valid=r=>Array.isArray(r)&&r.length===2&&r.every(v=>Number.isFinite(Number(v)));
  return {
    x:valid(xr)?xr.map(Number):null,
    y:valid(yr)?yr.map(Number):null
  };
}

  return {
    bindSingleZoomPeakScaling, currentPlotRanges, positionSingleColorbarEntries, singleColorbarTicks,
    singleMarkerSizes, singleNuclearLabelStyle
  };
}
