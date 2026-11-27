// Resolution › Convolution › 2D slice: calculation, the three maps with
// their sliders and ellipses, Save figure and Set on Q-E.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {AXIS_TITLE_FONT, CONV_TITLE_SIZE, FONT, MAX_TABLE_RANGE_POINTS} from './convolution-constants.js';
import {inverse, matvec} from '../core/matrix.js';
import {fmt} from './convolution-legend.js';
import {initialLattice} from './convolution-lattice.js';
import {PLOT_FONTS} from '../core/plot-fonts.js';
import {qeMapTitle} from '../qe/qe-plot-title.js';
import {downloadBlob} from '../core/download.js';
import {setOverlayVolume} from '../qe/qe-dispersion-overlay.js';
import {isoLines} from './convolution-contour.js';
import {bindOncePerRegistry} from '../core/plot-events.js';

export function installConvolutionMaps(context){
  const {$, collectResolutionBase, setStatus}=context.deps;
  const {state,fns}=context;
  // --------------------------------------------------------------- 2D -----
  // The (U, V, ħω) grid of the 2D calculation and the expected number of
  // resolution matrices (shared with the time estimate).
  function prepare2D(){
    if(!state.interp) throw new Error('Load a dispersion file first.');
    const base=collectResolutionBase(), rg=fns.ranges(), plane=fns.planeBasis(base,rg.W.value);
    const A=fns.grid(rg.U.min,rg.U.max,rg.U.bin,MAX_TABLE_RANGE_POINTS.ab), Bv=fns.grid(rg.V.min,rg.V.max,rg.V.bin,MAX_TABLE_RANGE_POINTS.ab);
    const E=fns.grid(rg.E.min,rg.E.max,rg.E.bin,MAX_TABLE_RANGE_POINTS.E);
    // Resolution matrices: on a lattice of nodes, refined where needed (see
    // convolution-lattice.js); about twice the starting lattice.
    const nInside=A.length*Bv.length;
    const L0=initialLattice(A,Bv,E);
    return {base,rg,plane,A,Bv,E,nInside,nRes:2*L0.a.length*L0.b.length*L0.e.length};
  }
  // While calculating, Calculate is the Stop button.  The status next to it
  // is a progress bar: "45 %" over a growing fill, then "Completed" (full) or
  // "Stopped" (the fill where it stopped).  Other messages show without fill.
  function setRunning(id,on){
    const b=$(id); if(!b) return;
    b.textContent=on ? 'Stop' : 'Calculate';
    b.classList.toggle('convolution-stop',on);
    b.title=on ? 'Stop the calculation' : '';
  }
  const setFill=(id,frac)=>{ const el=$(id); if(el) el.style.setProperty('--conv-progress',`${Math.max(0,Math.min(100,Math.round(100*frac)))}%`); };
  function setProgress(id,frac){
    fns.message(id,`${Math.max(0,Math.min(100,Math.round(100*frac)))} %`);
    setFill(id,frac);
    $(id)?.classList.add('convolution-progress-on');
  }
  function statusEnd(id,text,keepFill){
    const el=$(id), fill=el?.style.getPropertyValue('--conv-progress');
    fns.message(id,text);
    if(keepFill && fill){ el.style.setProperty('--conv-progress',fill); el.classList.add('convolution-progress-on'); }
  }
  // No 2D result (failed or stopped run): the maps of the previous
  // conditions are not left on screen, and Save CSV and the slice sliders
  // go off with them.  A warning (part of the map out of reach, ...) still
  // keeps its result.
  function clear2DResult(){
    state.volume=null;
    // Purged only after a drawing in progress (a large map draws for a
    // while; purging under it breaks Plotly), unless a new result came.
    // (Purge also drops the range handler of keepRange: bound again
    // with the next maps.)
    const purge=()=>{ if(state.volume) return; for(const id of ['convMapEU','convMapEV','convMapUV']){ try{ if(fns.plotly()) Plotly.purge(id); }catch(_e){} } };
    if(state.mapsDrawing) state.mapsDrawing.then(purge); else purge();
    $('convDownload2D').disabled=true;
    for(const key of ['U','V','E']){ const s=$(`convSlider${key}`); if(s) s.disabled=true; }
    // No result: the colour-scale boxes show the provisional range.
    state.zInUse=null; showZRange();
  }
  // Colour-scale entries: the value in use is always written in the box,
  // ready to be edited (a value typed in fixes that end; clearing the box
  // returns it to automatic, and the automatic value is written back).
  // Automatic: the whole calculation; before there is a result, 0 to 1
  // (log I: 1e-4 to 1).
  function showZRange(){
    const log=!!$('convLog2D')?.checked, def=log ? ['1e-4','1'] : ['0','1'];
    ['min','max'].forEach((end,i)=>{
      const el=$(`convZ${end}`); if(!el || document.activeElement===el) return;
      const v=state.zInUse ? state.zInUse[end] : fns.zlim[end];
      el.value=v===null || v===undefined || !Number.isFinite(v) || (log && !(v>0)) ? def[i] : String(Number(v.toPrecision(3)));
    });
  }
  // Stop: the 2D result is discarded, and so are the previous maps.
  function stop2D(){ state.run2D++; state.cancelJobs(); state.busy2D=false; setRunning('convCalculate2D',false); clear2DResult(); statusEnd('convMessage2D','Stopped',true); }
  async function calculate2D(){
    if(state.busy2D){ stop2D(); return; }
    const id=++state.run2D;
    try{
      const P=prepare2D();
      // A max moved up to a multiple of the bin is shown in its entry.
      for(const n of ['U','V','E']) if(P.rg[n].max!==P.rg[n].max0){ const el=$(`conv${n}max`); if(el) el.value=fmt(P.rg[n].max,6); }
      fns.saveInputs();
      const {A,Bv,E,plane}=P;
      const settings=fns.settingsSnapshot('2D');
      state.busy2D=true; setRunning('convCalculate2D',true);
      setProgress('convMessage2D',0);
      let out=null;
      const ws=fns.getWorkers();
      if(ws){
        try{ out=await fns.run2DOn(id,fns.workerRunner(ws),P); }
        catch(err){
          if(id!==state.run2D) return;
          if(!err?.workerFailed) throw err;
          // The workers could not start (old browser, file://): one thread.
          state.workersBroken=true; fns.killWorkers();
        }
      }
      if(id!==state.run2D) return;
      if(!out) out=await fns.run2DOn(id,fns.pageRunner(id),P);
      if(id!==state.run2D || !out) return;
      finish2D(A,Bv,E,out,plane,settings);
    }catch(err){ if(id===state.run2D){ state.cancelJobs(); state.busy2D=false; setRunning('convCalculate2D',false); clear2DResult(); fns.message('convMessage2D',err.message||String(err),true); if(err?.detail && $('convMessage2D')) $('convMessage2D').title=err.detail; } }
  }
  function finish2D(A,Bv,E,I,plane,settings){
    state.busy2D=false; setRunning('convCalculate2D',false);
    state.volume={A,B:Bv,E,I,plane,U:plane.U,V:plane.V,settings};
    fns.zlim.min=null; fns.zlim.max=null; fns.saveInputs();
    fns.store2D();
    $('convDownload2D').disabled=false;
    fns.showConvTab('2d');
    setupSliders();
    drawMaps();
    setProgress('convMessage2D',1); fns.message('convMessage2D','Completed'); setFill('convMessage2D',1); $('convMessage2D')?.classList.add('convolution-progress-on');
    setStatus?.('Convolution 2D calculated');
  }
  let mapRevision=0;
  const nearest=(arr,v)=>{ let best=0; arr.forEach((x,i)=>{ if(Math.abs(x-v)<Math.abs(arr[best]-v)) best=i; }); return best; };
  function setupSliders(){
    const conf=[['U',state.volume.A,'convValueU'],['V',state.volume.B,'convValueV'],['E',state.volume.E,'convValueE']];
    for(const [key,arr,input] of conf){
      const s=$(`convSlider${key}`);
      s.min='0'; s.max=String(arr.length-1); s.step='1'; s.disabled=false;
      const want=fns.num(input);
      const mid=key==='E' ? nearest(arr,(arr[0]+arr[arr.length-1])/2) : nearest(arr,(arr[0]+arr[arr.length-1])/2);
      s.value=String(Number.isFinite(want) && want>=Math.min(...arr)-1e-9 && want<=Math.max(...arr)+1e-9 ? nearest(arr,want) : mid);
      $(input).value=fmt(arr[Number(s.value)],3);
    }
    const sym=planeSymbols(state.volume.U,state.volume.V);
    $('convSliderULabel').textContent=sym.u;
    $('convSliderVLabel').textContent=sym.v;
    if($('convLineULabel')) $('convLineULabel').textContent=sym.u;
    if($('convLineVLabel')) $('convLineVLabel').textContent=sym.v;
    $('convSliderULabel').title=`U = ${fns.vec(state.volume.U)}`;
    $('convSliderVLabel').title=`V = ${fns.vec(state.volume.V)}`;
  }
  // Symbols for the plane coordinates: (H, K, L) = a U + b V.  a takes the
  // name of a component that only U changes, b of one that only V changes
  // (U = (1,0,0), V = (0,0,1): H and L, so (H, 0, 0.5) is the line at
  // b = 0.5; U = (1,1,0), V = (0,0,1): (H, H, L)).  When either has no such
  // component (U = (1,-1,0), V = (1,1,-2)), both are Greek, ξ and η:
  // (ξ+η, −ξ+η, −2η).
  function planeSymbols(U,V){
    const names=['H','K','L'], nz=x=>Math.abs(x)>1e-9;
    const iu=U.findIndex((x,i)=>nz(x) && !nz(V[i]));
    const iv=V.findIndex((x,i)=>nz(x) && !nz(U[i]));
    return iu>=0 && iv>=0 ? {u:names[iu],v:names[iv]} : {u:'ξ',v:'η'};
  }
  // One component as text: Σ c·s + c0 over [c, s] pairs (s a symbol or a
  // number).
  function termsText(pairs,c00=0){
    const parts=[];
    let c0=c00;
    for(const [c,symbol] of pairs){
      if(Math.abs(c)<1e-9) continue;
      if(typeof symbol==='number'){ c0+=c*symbol; continue; }
      const mag=Math.abs(c);
      parts.push({neg:c<0,text:`${Math.abs(mag-1)<1e-9 ? '' : fmt(mag)}${symbol}`});
    }
    if(Math.abs(c0)>1e-9 || !parts.length) parts.push({neg:c0<-1e-9,text:fmt(Math.abs(c0))});
    return parts.map((t,i)=>`${t.neg ? '−' : (i ? '+' : '')}${t.text}`).join('');
  }
  const componentText=(cu,su,cv,sv,cw=0)=>termsText([[cu,su],[cv,sv]],cw);
  // A point (h, k, l) = Σ vec · s, e.g. [[U,'ξ'],[V,1]] → (ξ+1, −ξ+1, −2).
  const vecText=terms=>`(${[0,1,2].map(i=>termsText(terms.map(([v,sy])=>[v[i],sy]))).join(', ')})`;
  // off: the W part of the slice (w W).
  const pointText=(U,V,su,sv,off=[0,0,0])=>`(${[0,1,2].map(i=>componentText(U[i],su,V[i],sv,off[i])).join(', ')})`;
  const sliceOffset=vol=>vol?.plane?.W && Number.isFinite(vol.plane.w) && vol.plane.w!==0 ? vol.plane.W.map(x=>x*vol.plane.w) : [0,0,0];
  function sliderIndex(key){ return Number($(`convSlider${key}`)?.value)||0; }
  // Fixed axis range of a map: the calculated grid; restored on double-click.
  function keepRange(id,x,y){
    const el=$(id); if(!el) return;
    el._convRange={x:[x[0],x[x.length-1]],y:[y[0],y[y.length-1]]};
    bindOncePerRegistry(el,'_convRangeBound',()=>el.on('plotly_relayout',ev=>{
      if(!ev || !(ev['xaxis.autorange'] || ev['yaxis.autorange']) || !el._convRange) return;
      // Copies: Plotly keeps the arrays it is given as the axis ranges and
      // the next zoom writes into them.
      Plotly.relayout(el,{'xaxis.range':el._convRange.x.slice(),'yaxis.range':el._convRange.y.slice()});
    }));
  }
  // Oblique U and V (their angle in reciprocal space is not 90°): the U–V
  // map is drawn in its true shape.  x = a|U| + b|V|cos θ, y = b|V|sin θ
  // (Å⁻¹); the display grid samples the (a, b) map (nearest point).
  // Labels: U values where the U grid lines meet the bottom edge, V values
  // on the left (V lines are horizontal); the lines are drawn faintly over
  // the map.
  function obliqueView(A,B){
    const vol=state.volume;
    if(vol._oblBasis===undefined){
      vol._oblBasis=null;
      try{
        const base=collectResolutionBase(), st=[base.rl.astar,base.rl.bstar,base.rl.cstar];
        const q=h=>[0,1,2].map(j=>h[0]*st[0][j]+h[1]*st[1][j]+h[2]*st[2][j]);
        const qU=q(vol.U), qV=q(vol.V), nu=Math.hypot(...qU), nv=Math.hypot(...qV);
        const c=(qU[0]*qV[0]+qU[1]*qV[1]+qU[2]*qV[2])/(nu*nv);
        if(Math.abs(c)>1e-6 && Math.abs(c)<1-1e-9) vol._oblBasis={ux:nu,vx:nv*c,vy:nv*Math.sqrt(1-c*c)};
      }catch(_e){ vol._oblBasis=null; }
    }
    const bs=vol._oblBasis; if(!bs) return null;
    const {ux,vx,vy}=bs;
    const toXY=(a,b)=>[ux*a+vx*b,vy*b], toAB=(x,y)=>[(x-vx*y/vy)/ux,y/vy];
    // Shown range: the points with a value in some slice (the reachable
    // part; the corners of the (a, b) parallelogram are mostly out of
    // reach), found once per result.
    if(!vol._oblBox){
      const {I,E}=vol, nA=A.length, nE=E.length;
      let bx0=Infinity, bx1=-Infinity, by0=Infinity, by1=-Infinity;
      for(let jb=0;jb<B.length;jb++) for(let ja=0;ja<nA;ja++){
        const o=(jb*nA+ja)*nE;
        let any=false; for(let e=0;e<nE;e++) if(Number.isFinite(I[o+e])){ any=true; break; }
        if(!any) continue;
        const [x,y]=toXY(A[ja],B[jb]);
        if(x<bx0) bx0=x; if(x>bx1) bx1=x; if(y<by0) by0=y; if(y>by1) by1=y;
      }
      if(!(bx1>bx0) || !(by1>by0)){
        const cs=[[A[0],B[0]],[A[nA-1],B[0]],[A[0],B[B.length-1]],[A[nA-1],B[B.length-1]]].map(p=>toXY(...p));
        bx0=Math.min(...cs.map(p=>p[0])); bx1=Math.max(...cs.map(p=>p[0])); by0=Math.min(...cs.map(p=>p[1])); by1=Math.max(...cs.map(p=>p[1]));
      }
      vol._oblBox={x0:bx0,x1:bx1,y0:by0,y1:by1};
    }
    const {x0,x1,y0,y1}=vol._oblBox;
    const d=Math.min(A.length>1 ? Math.abs(A[1]-A[0])*ux : Infinity, B.length>1 ? Math.abs(B[1]-B[0])*vy : Infinity);
    const nx=Math.max(2,Math.min(1200,Math.ceil((x1-x0)/d)+1)), ny=Math.max(2,Math.min(1200,Math.ceil((y1-y0)/d)+1));
    const xs=Array.from({length:nx},(_,i)=>x0+(x1-x0)*i/(nx-1)), ys=Array.from({length:ny},(_,j)=>y0+(y1-y0)*j/(ny-1));
    const nice=h=>{ const raw=0.9*h; if(!(raw>0)) return 1; const e=10**Math.floor(Math.log10(raw)); return ([1,2,2.5,5,10].filter(m=>m*e<=raw*(1+1e-9)).pop()||1)*e; };
    const grid=()=>{
      const out={shapes:[],xTickVals:[],xTickText:[],yTickVals:[],yTickText:[]};
      const us=nice((x1-x0)/2/ux), vs=nice((y1-y0)/2/vy), f=v=>Math.abs(v)<1e-12 ? '0' : String(Number(v.toPrecision(6)));
      // Grey: seen over the map and on the white outside it, up to the labels.
      const style={color:'rgba(150,150,150,0.55)',width:1};
      const cAB=[[x0,y0],[x0,y1],[x1,y0],[x1,y1]].map(p=>toAB(...p));
      const uLo=Math.min(...cAB.map(p=>p[0])), uHi=Math.max(...cAB.map(p=>p[0]));
      for(let n=Math.ceil(uLo/us-1e-9);n*us<=uHi+1e-9;n++){
        const u=n*us, [xa,ya]=toXY(u,y0/vy), [xb,yb]=toXY(u,y1/vy);
        out.shapes.push({type:'line',x0:xa,y0:ya,x1:xb,y1:yb,line:style,layer:'above'});
        const xBottom=ux*u+vx*(y0/vy);
        if(xBottom>=x0-1e-9 && xBottom<=x1+1e-9){ out.xTickVals.push(xBottom); out.xTickText.push(f(u)); }
      }
      for(let n=Math.ceil((y0/vy)/vs-1e-9);n*vs<=y1/vy+1e-9;n++){
        const v=n*vs, [xa,ya]=toXY((x0-vx*v)/ux,v), [xb,yb]=toXY((x1-vx*v)/ux,v);
        out.shapes.push({type:'line',x0:xa,y0:ya,x1:xb,y1:yb,line:style,layer:'above'});
        // (V lines are horizontal: y = v|V| sin θ.)
        const y=vy*v;
        if(y>=y0-1e-9 && y<=y1+1e-9){ out.yTickVals.push(y); out.yTickText.push(f(v)); }
      }
      return out;
    };
    return {x0,x1,y0,y1,nx,ny,xs,ys,toXY,toAB,grid};
  }
  function drawMaps(){
    if(!state.volume || !fns.plotly()) return;
    const {A,B,E,I}=state.volume, nA=A.length, nE=E.length;
    const ia=sliderIndex('U'), ib=sliderIndex('V'), ie=sliderIndex('E');
    const at=(a,b,e)=>I[(b*nA+a)*nE+e];
    const zEU=E.map((_,e)=>A.map((_,a)=>at(a,ib,e)));
    const zEV=E.map((_,e)=>B.map((_,b)=>at(ia,b,e)));
    const zUV=B.map((_,b)=>A.map((_,a)=>at(a,b,ie)));
    const {U,V}=state.volume, sym=planeSymbols(U,V);
    // Axis titles are the (h, k, l) of the map points: (ξ+1, −ξ+1, −2).
    const off=sliceOffset(state.volume);
    const lineU=pointText(U,V,sym.u,B[ib],off), lineV=pointText(U,V,A[ia],sym.v,off), planeUV=pointText(U,V,sym.u,sym.v,off);
    const e3='ħω', e3axis='ħω (meV)', e3at=v=>`ħω = ${fmt(v,3)} meV`;
    const axisU=vecText([[U,sym.u]]), axisV=vecText([[V,sym.v]]);
    const obl=obliqueView(A,B);
    // Colour scale: one range for the three maps, from the whole calculated
    // volume (so it stays the same while the sliders move) unless set in the
    // Show row.
    // log I (Show row): the colour follows log10 I; the range and the
    // colour-bar labels stay in I.  Automatic lower end: the smallest
    // positive I, but not below 10⁻⁶ of the maximum; values at or below the
    // lower end (0 included) take the lowest colour, points without a value
    // stay blank.
    const log=!!$('convLog2D')?.checked;
    const auto=log ? volumeRangeLog(I) : volumeRange(I);
    let zmin=fns.zlim.min ?? auto[0], zmax0=fns.zlim.max ?? auto[1];
    if(log && !(zmin>0)) zmin=auto[0];
    if(log && !(zmax0>0)) zmax0=auto[1];
    const zmax=zmax0>zmin ? zmax0 : (log ? zmin*10 : zmin+Math.max(1e-12,Math.abs(zmin)*1e-6));
    const lo=log ? Math.log10(zmin) : zmin, hi=log ? Math.log10(zmax) : zmax;
    // Unreachable points (scattering triangle not closed) have no value and
    // stay blank (white), also in log I.
    const toColor=log ? (v=>!Number.isFinite(v) ? null : v>zmin ? Math.log10(v) : lo) : (v=>v);
    // Colour-bar labels: three significant digits; in log I, powers of ten
    // below 10⁻³ as 1e-6 (short enough for the bar).
    const tickLabel=v=>{
      const p=Number(v.toPrecision(3));
      return log && p>0 && (p<1e-3 || p>=1e5) ? p.toExponential().replace('e+','e') : String(p);
    };
    // Hover: the I line only where there is a value (a blank point shows
    // its coordinates only).  Four significant digits, as Plotly's .4g.
    const hoverI=v=>Number.isFinite(v) ? `<br>I = ${v.toPrecision(4)}` : '';
    const heat=(key,x,y,z,xl,yl,cd=null)=>{
      // Five labelled ticks including both ends (kept in saved images); in
      // log I, whole decades when the range spans two or more.
      let vals=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4);
      if(log && hi-lo>=2){
        vals=[]; for(let d=Math.ceil(lo-1e-9); d<=hi+1e-9; d++) vals.push(d);
      }
      return {type:'heatmap',x,y,z:log ? z.map(r=>r.map(toColor)) : z,customdata:cd || z.map(r=>r.map(hoverI)),colorscale:'Viridis',zauto:false,zmin:lo,zmax:hi,showscale:true,
        colorbar:{thickness:14,len:0.9,outlinewidth:0,tickfont:{size:PLOT_FONTS.tick},tickmode:'array',tickvals:vals,
          ticktext:vals.map(v=>tickLabel(log ? 10**v : v))},
        hovertemplate:`${xl} = %{x:.4f}<br>${yl} = %{y:.3f}%{customdata}<extra></extra>`};
    };
    // Slider positions as dashed lines, each switched by the box next to its slider.
    const all=true;
    const onU=all && $('convLineU')?.checked!==false, onV=all && $('convLineV')?.checked!==false, onE=all && $('convLineE')?.checked!==false;
    const dash=(x0,x1,y0,y1)=>({type:'line',x0,x1,y0,y1,line:{color:'rgba(255,255,255,0.8)',width:1,dash:'dash'}});
    // Bare dispersion E_b(h, k, l) of every branch, whatever its intensity
    // (only outside the table there is nothing to draw).
    const overlay=(xs,points)=>{
      if(!$('convShowDispersion')?.checked || !state.interp) return [];
      // evaluate() reuses its output buffers: copy every result.
      const vals=points.map(p=>{ const v=state.interp.evaluate(...p); return v ? Array.from(v.E) : null; });
      const traces=[];
      for(let b=0;b<state.interp.nBranch;b++){
        traces.push({type:'scatter',mode:'lines',x:xs,
          y:vals.map(v=>v && Number.isFinite(v[b]) ? v[b] : null),
          line:{color:'rgba(255,255,255,0.7)',width:1,dash:'dot'},hoverinfo:'skip',showlegend:false,connectgaps:false});
      }
      return traces;
    };
    // Constant-energy map: the contour E_b(a, b) = ħω of every branch.  The
    // dispersion on a fine (a, b) grid does not depend on ħω, so it is kept
    // for the volume and only the contour level follows the slider.  The
    // lines are traced here (isoLines) and drawn as scatter lines, which
    // Plotly redraws at once on zoom (oblique U and V: mapped to the
    // true-shape x, y).
    const overlayUV=Ec=>{
      if(!$('convShowDispersion')?.checked || !state.interp) return [];
      const key=`${A[0]},${A[nA-1]},${B[0]},${B[B.length-1]},${state.interp.nBranch}`;
      if(!state.volume._dispUV || state.volume._dispUV.key!==key || state.volume._dispUV.interp!==state.interp){
        const n=121;
        const aG=Array.from({length:n},(_,i)=>A[0]+(A[nA-1]-A[0])*i/(n-1));
        const bG=Array.from({length:n},(_,i)=>B[0]+(B[B.length-1]-B[0])*i/(n-1));
        const z=Array.from({length:state.interp.nBranch},()=>bG.map(()=>new Array(n).fill(null)));
        bG.forEach((b,j)=>aG.forEach((a,i)=>{
          const v=state.interp.evaluate(...state.volume.plane.hkl(a,b));
          if(v) for(let br=0;br<state.interp.nBranch;br++) if(Number.isFinite(v.E[br])) z[br][j][i]=v.E[br];
        }));
        state.volume._dispUV={key,interp:state.interp,aG,bG,z};
      }
      const {aG,bG,z}=state.volume._dispUV;
      return z.map(zb=>{
        const l=isoLines(aG,bG,zb,Ec);
        const x=obl ? l.x.map((a,k)=>a===null ? null : obl.toXY(a,l.y[k])[0]) : l.x;
        const y=obl ? l.y.map((b,k)=>b===null ? null : obl.toXY(l.x[k],b)[1]) : l.y;
        return {type:'scatter',mode:'lines',x,y,hoverinfo:'skip',showlegend:false,connectgaps:false,
          line:{color:'rgba(255,255,255,0.7)',width:1,dash:'dot'}};
      });
    };
    const fine=(arr)=>Array.from({length:201},(_,i)=>arr[0]+(arr[arr.length-1]-arr[0])*i/200);
    const aF=fine(A), bF=fine(B);
    // Titles on two lines: the instrument and fixed energy of the calculation
    // (as in the Q-E map titles), then the slice:
    //   "CTAX, Ef = 4.8 meV" / "ħω–H at K = 0".
    // One fixed size (CONV_TITLE_SIZE) for every condition.
    const head=(()=>{
      const ins=state.volume.settings?.instrument||{};
      const key=ins.instrument ?? $('instrument')?.value;
      const name=[...($('instrument')?.options||[])].find(o=>o.value===key)?.textContent||key||'';
      const mode=ins.energyMode ?? $('energyMode')?.value, E=Number(ins.energy ?? $('energy')?.value);
      return qeMapTitle({inst:{name},energyMode:mode,Ei:E,Ef:E});
    })();
    const withHead=t=>head ? `${head}<br>${t}` : t;
    // A frame on all four sides (as on the Q-E maps).
    const frameAxis={showline:true,mirror:true,linecolor:'#555',linewidth:1.2,ticks:'outside'};
    // Zoom and pan stay while the Show row, sliders or colour scale redraw
    // the maps (uirevision: one per result; a new result starts unzoomed).
    if(!state.volume.rev) state.volume.rev=++mapRevision;
    const layout=(title,xl,yl,x,y,id)=>{
      const text=withHead(title);
      return {font:FONT,uirevision:`${id}-${state.volume.rev}`,
        // Plotly places a two-line title in the middle of the top margin.
        title:{text,font:{size:CONV_TITLE_SIZE},x:0.5,xanchor:'center'},
        margin:{l:70,r:10,t:head?62:40,b:60},
        xaxis:{...frameAxis,title:{text:xl,font:AXIS_TITLE_FONT},range:[x[0],x[x.length-1]]},
        yaxis:{...frameAxis,title:{text:yl,font:AXIS_TITLE_FONT},range:[y[0],y[y.length-1]]},showlegend:false};
    };
    // Double-click: back to the calculated min–max range (Plotly would
    // otherwise autorange to the heatmap cell edges and the overlays).
    const cfg={responsive:true,displaylogo:false,doubleClick:'autosize'};
    // Ellipses when coherent or incoherent is ticked.
    const ell=($('convEllCoh')?.checked || $('convEllInc')?.checked) ? ellipseTraces(A,B,E,ia,ib,ie) : {EU:[],EV:[],UV:[]};
    const drawn=[];
    drawn.push(Plotly.react('convMapEU',[heat('EU',A,E,zEU,sym.u,e3),...overlay(aF,aF.map(a=>state.volume.plane.hkl(a,B[ib]))),...ell.EU],
      {...layout(`${e3}–${sym.u} at ${sym.v} = ${fmt(B[ib],3)}`,lineU,e3axis,A,E,'convMapEU'),
       shapes:[onE&&dash(A[0],A[nA-1],E[ie],E[ie]),onU&&dash(A[ia],A[ia],E[0],E[nE-1])].filter(Boolean)},cfg));
    drawn.push(Plotly.react('convMapEV',[heat('EV',B,E,zEV,sym.v,e3),...overlay(bF,bF.map(b=>state.volume.plane.hkl(A[ia],b))),...ell.EV],
      {...layout(`${e3}–${sym.v} at ${sym.u} = ${fmt(A[ia],3)}`,lineV,e3axis,B,E,'convMapEV'),
       shapes:[onE&&dash(B[0],B[B.length-1],E[ie],E[ie]),onV&&dash(B[ib],B[ib],E[0],E[nE-1])].filter(Boolean)},cfg));
    if(!obl){
      drawn.push(Plotly.react('convMapUV',[heat('UV',A,B,zUV,sym.u,sym.v),...overlayUV(E[ie]),...ell.UV],
        {...layout(`${planeUV} at ${e3at(E[ie])}`,axisU,axisV,A,B,'convMapUV'),
         shapes:[onU&&dash(A[ia],A[ia],B[0],B[B.length-1]),onV&&dash(A[0],A[nA-1],B[ib],B[ib])].filter(Boolean)},cfg));
    }else{
      // Oblique U and V (e.g. (1,0,0), (0,1,0) of a hexagonal lattice): the
      // map in its true shape, x along U and y normal to it in the plane
      // (Å⁻¹, equal scales), labelled with an oblique U, V grid, as the
      // true-shape U–V panel of Simulation.
      const {nx,xs,ys,toAB,toXY}=obl, da=nA>1 ? A[1]-A[0] : 1, db=B.length>1 ? B[1]-B[0] : 1;
      const zD=[], cd=[];
      for(const y of ys){
        const zr=new Array(nx).fill(null), cr=new Array(nx).fill(null);
        for(let i=0;i<nx;i++){
          const [a,b]=toAB(xs[i],y), ja=Math.round((a-A[0])/da), jb=Math.round((b-B[0])/db);
          cr[i]=['',a,b];
          if(ja<0 || ja>=nA || jb<0 || jb>=B.length) continue;
          const v=at(ja,jb,ie); zr[i]=Number.isFinite(v) ? v : null; cr[i][0]=hoverI(v);
        }
        zD.push(zr); cd.push(cr);
      }
      const tr=heat('UV',xs,ys,zD,sym.u,sym.v,cd);
      tr.hovertemplate=`${sym.u} = %{customdata[1]:.4f}<br>${sym.v} = %{customdata[2]:.4f}%{customdata[0]}<extra></extra>`;
      const mapXY=t=>({...t,x:t.x.map((x,k)=>x===null||t.y[k]===null ? null : toXY(x,t.y[k])[0]),y:t.y.map((y,k)=>y===null||t.x[k]===null ? null : toXY(t.x[k],y)[1])});
      const g=obl.grid(), seg=(a0,b0,a1,b1)=>{ const [x0,y0]=toXY(a0,b0), [x1,y1]=toXY(a1,b1); return dash(x0,x1,y0,y1); };
      const lay=layout(`${planeUV} at ${e3at(E[ie])}`,axisU,axisV,[obl.x0,obl.x1],[obl.y0,obl.y1],'convMapUV');
      lay.xaxis={...lay.xaxis,tickmode:'array',tickvals:g.xTickVals,ticktext:g.xTickText,zeroline:false,showgrid:false};
      lay.yaxis={...lay.yaxis,tickmode:'array',tickvals:g.yTickVals,ticktext:g.yTickText,scaleanchor:'x',scaleratio:1,constrain:'domain',zeroline:false,showgrid:false};
      lay.xaxis.constrain='domain';
      lay.shapes=[...g.shapes,onU&&seg(A[ia],B[0],A[ia],B[B.length-1]),onV&&seg(A[0],B[ib],A[nA-1],B[ib])].filter(Boolean);
      drawn.push(Plotly.react('convMapUV',[tr,...overlayUV(E[ie]),...ell.UV.map(mapXY)],lay,cfg));
    }
    const pending=Promise.allSettled(drawn);
    state.mapsDrawing=pending;
    pending.then(()=>{ if(state.mapsDrawing===pending) state.mapsDrawing=null; });
    for(const [id,x,y] of [['convMapEU',A,E],['convMapEV',B,E],['convMapUV',obl ? [obl.x0,obl.x1] : A,obl ? [obl.y0,obl.y1] : B]]) keepRange(id,x,y);
    state.zInUse={min:zmin,max:zmax}; showZRange();
  }
  // log I: [smallest positive I (not below 10⁻⁶ of the maximum), maximum].
  function volumeRangeLog(I){
    let lo=Infinity, hi=0;
    for(const v of I) if(Number.isFinite(v) && v>0){ if(v<lo) lo=v; if(v>hi) hi=v; }
    if(!(hi>0)) return [1e-3,1];
    lo=Math.max(lo,hi*1e-6);
    return lo<hi ? [lo,hi] : [hi/10,hi];
  }
  function volumeRange(I){
    let lo=Infinity, hi=-Infinity;
    for(const v of I) if(Number.isFinite(v)){ if(v<lo) lo=v; if(v>hi) hi=v; }
    return Number.isFinite(lo) ? [lo,hi] : [0,1];
  }

  // FWHM resolution ellipses (projection onto the plotted plane) on a coarse
  // grid of each map: round steps (0.05 / 0.1 / 0.2 … r.l.u., 0.5 / 1 / 2 …
  // meV) chosen from the plotted range.
  const niceStep=(span,target,steps)=>steps.find(st=>span/st<=target)||steps[steps.length-1];
  const Q_STEPS=[0.01,0.02,0.025,0.05,0.1,0.2,0.25,0.5,1,2,5];
  const E_STEPS=[0.1,0.2,0.25,0.5,1,2,2.5,5,10,20,50];
  const gridIn=(lo,hi,st)=>{ const out=[]; for(let v=Math.ceil((lo+st*0.25)/st)*st; v<=hi-st*0.25+1e-9; v+=st) out.push(Number(v.toFixed(10))); return out; };
  const ellCache=new Map();
  function ellipseCov(base,a,b,E){
    // Covariance of (a, b, ħω) from the resolution matrix at (a U + b V + w W, E).
    const key=`${a},${b},${E}`;
    if(ellCache.has(key)) return ellCache.get(key);
    const {U,V}=state.volume, off=sliceOffset(state.volume), hkl=U.map((x,i)=>a*x+b*V[i]+off[i]);
    const res=fns.resolutionAt(base,hkl,E,{});
    let out=null;
    if(res){
      const UB=res.UB, TP=2*Math.PI;
      const q=h=>matvec(UB,h).map(x=>TP*x);
      const q0=q(hkl), n0=Math.hypot(q0[0],q0[1]);
      if(n0>1e-12){
        const eX=[q0[0]/n0,q0[1]/n0,0], eY=[-eX[1],eX[0],0];
        const qU=q(U), qV=q(V), dot=(x,y)=>x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
        const M=[[dot(eX,qU),dot(eX,qV)],[dot(eY,qU),dot(eY,qV)]], det=M[0][0]*M[1][1]-M[0][1]*M[1][0];
        if(Math.abs(det)>1e-12){
          const Mi=[[M[1][1]/det,-M[0][1]/det],[-M[1][0]/det,M[0][0]/det]];
          const C=inverse(res.RM);   // local (Q∥, Q⊥, E, Qz)
          // Incoherent (projection): covariance of (a, b, ħω), Qz integrated.
          const K=[[Mi[0][0],Mi[0][1],0,0],[Mi[1][0],Mi[1][1],0,0],[0,0,1,0]];
          const inc=K.map(r=>K.map(c=>r.reduce((s,ri,i)=>s+ri*c.reduce((t,cj,j)=>t+C[i][j]*cj,0),0)));
          // Coherent (section): resolution matrix in (a, b, ħω, Qz),
          // P = Tᵀ RM T with (Q∥, Q⊥, E, Qz) = T (a, b, ħω, Qz).
          const T=[[M[0][0],M[0][1],0,0],[M[1][0],M[1][1],0,0],[0,0,1,0],[0,0,0,1]], R=res.RM;
          const coh=[0,1,2,3].map(i=>[0,1,2,3].map(j=>{ let v=0; for(let p=0;p<4;p++) for(let q=0;q<4;q++) v+=T[p][i]*R[p][q]*T[q][j]; return v; }));
          out={inc,coh};
        }
      }
    }
    if(out) ellCache.set(key,out);   // unreachable points are tried again later
    return out;
  }
  function ellipsePath(cx,cy,S){
    const [a,b,c]=[S[0][0],S[0][1],S[1][1]];
    if(!(a>0 && c>0)) return null;
    const l11=Math.sqrt(a), l21=b/l11, l22=Math.sqrt(Math.max(c-l21*l21,0));
    const r=Math.sqrt(2*Math.LN2), x=[], y=[];
    for(let i=0;i<=48;i++){ const t=2*Math.PI*i/48, u=r*Math.cos(t), v=r*Math.sin(t); x.push(cx+l11*u); y.push(cy+l21*u+l22*v); }
    x.push(null); y.push(null);
    return [x,y];
  }
  function ellipseTraces(A,B,E,ia,ib,ie){
    let base; try{ base=collectResolutionBase(); }catch(_e){ return {EU:[],EV:[],UV:[]}; }
    const sig=JSON.stringify([base.config,base.approximation,base.col,base.mos,base.lc?.a,base.lc?.b,base.lc?.c,state.volume.U,state.volume.V,sliceOffset(state.volume)]);
    if(ellCache.sig!==sig){ ellCache.clear(); ellCache.sig=sig; }
    const span=arr=>arr[arr.length-1]-arr[0];
    const sa=niceStep(span(A),6,Q_STEPS), sb=niceStep(span(B),6,Q_STEPS), se=niceStep(span(E),7,E_STEPS);
    const ga=gridIn(A[0],A[A.length-1],sa), gb=gridIn(B[0],B[B.length-1],sb), ge=gridIn(E[0],E[E.length-1],se);
    const coh=!!$('convEllCoh')?.checked, inc=!!$('convEllInc')?.checked;
    const collect=(pairs,i,j)=>{
      const out=[];
      for(const [kind,on] of [['inc',inc],['coh',coh]]){
        if(!on) continue;
        const X=[], Y=[];
        for(const [a,b,e,cx,cy] of pairs){
          const C=ellipseCov(base,a,b,e); if(!C) continue;
          let S;
          if(kind==='inc') S=[[C.inc[i][i],C.inc[i][j]],[C.inc[j][i],C.inc[j][j]]];
          else{
            // Section: the 2 × 2 block of the resolution matrix, inverted.
            const P=C.coh, d=P[i][i]*P[j][j]-P[i][j]*P[j][i];
            if(!(d>0)) continue;
            S=[[P[j][j]/d,-P[i][j]/d],[-P[j][i]/d,P[i][i]/d]];
          }
          const p=ellipsePath(cx,cy,S); if(!p) continue;
          X.push(...p[0]); Y.push(...p[1]);
        }
        if(X.length) out.push({type:'scatter',mode:'lines',x:X,y:Y,line:{color:'rgba(255,255,255,0.85)',width:1},hoverinfo:'skip',showlegend:false});
      }
      return out;
    };
    return {
      EU:collect(ga.flatMap(a=>ge.map(e=>[a,B[ib],e,a,e])),0,2),
      EV:collect(gb.flatMap(b=>ge.map(e=>[A[ia],b,e,b,e])),1,2),
      UV:collect(ga.flatMap(a=>gb.map(b=>[a,b,E[ie],a,b])),0,1),
    };
  }


  // 2D Save figure: the three maps (E–U, E–V, U–V) in one PNG, placed as
  // on screen (side by side, or stacked on a narrow screen).
  async function saveMapsFigure(){
    if(!fns.plotly() || !state.volume) return;
    // (Elastic only: the two maps left of the U–V map are hidden, not saved.)
    const plots=['convMapEU','convMapEV','convMapUV'].map(id=>$(id)).filter(el=>el?._fullLayout && el.offsetParent!==null && getComputedStyle(el).visibility!=='hidden');
    if(!plots.length) return;
    const S=2, rects=plots.map(el=>el.getBoundingClientRect());
    const x0=Math.min(...rects.map(r=>r.left)), y0=Math.min(...rects.map(r=>r.top));
    const W=Math.ceil(Math.max(...rects.map(r=>r.right))-x0), H=Math.ceil(Math.max(...rects.map(r=>r.bottom))-y0);
    const cv=document.createElement('canvas'); cv.width=W*S; cv.height=H*S;
    const ctx=cv.getContext('2d'); ctx.scale(S,S); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
    const load=src=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; });
    for(let i=0;i<plots.length;i++){
      const r=rects[i], url=await Plotly.toImage(plots[i],{format:'png',width:Math.round(r.width),height:Math.round(r.height),scale:S});
      ctx.drawImage(await load(url),r.left-x0,r.top-y0,r.width,r.height);
    }
    const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
    if(blob) downloadBlob(blob,`${fns.fileBase(fns.source2D(),'2d')}.png`);
  }
  // Set on Q-E: the 2D slice shown (calculated, or read with Load CSV) is
  // copied to Sample › Dispersion and drawn on the Q-E maps.
  function setOnQE(){
    if(!state.volume) return;
    setOverlayVolume({name:state.volume.source||'2D slice (Convolution)',volume:state.volume,settings:state.volume.settings});
  }
  Object.assign(fns,{showZRange, prepare2D, setRunning, setFill, setProgress, statusEnd, clear2DResult, stop2D, calculate2D, finish2D, nearest, setupSliders, planeSymbols, componentText, pointText, sliderIndex, keepRange, drawMaps, volumeRangeLog, volumeRange, niceStep, Q_STEPS, E_STEPS, gridIn, ellCache, ellipseCov, ellipsePath, ellipseTraces, saveMapsFigure, setOnQE});
}
