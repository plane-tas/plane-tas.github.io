// Sample › Dispersion: a dispersion table, or a 2D slice saved with Save CSV
// in Resolution › Convolution, drawn on the single-crystal Q-E maps (not for
// powder, diffractometers or 4-circle).  It is independent of Convolution:
// one file at a time, read here and not kept after a reload.
//   dispersion table ([index] h k l E1 … En I1 … In): each branch as a line
//     coloured by its intensity -- on the Constant E map where it crosses
//     the ħω of the slice, on the Q vector–E map along the path;
//   2D slice: the convolved intensity as a colour map (its settings are put
//     in when it is read; changing the lattice or the scattering plane
//     afterwards unsets it).
// Colours: Viridis, relative to the maximum of the file; I min (at least
// 0.01) is also the threshold below which nothing is drawn.
import {parseDispersionTable, createDispersionInterpolator} from '../convolution/convolution-core.js';
import {hklToQ} from '../core/hkl-utils.js';
import {dot} from '../core/tas-core.js';
import {PLOT_FONTS} from '../core/plot-fonts.js';
import {applyWhileTyping} from '../core/live-entry.js';

const $=id=>document.getElementById(id);
const LEVELS=32;
const MIN_FLOOR=0.01;
// Plotly's Viridis.
const VIRIDIS=[[0,'#440154'],[0.06274509803921569,'#48186a'],[0.12549019607843137,'#472d7b'],[0.18823529411764706,'#424086'],
  [0.25098039215686274,'#3b528b'],[0.3137254901960784,'#33638d'],[0.3764705882352941,'#2c728e'],[0.4392156862745098,'#26828e'],
  [0.5019607843137255,'#21918c'],[0.5647058823529412,'#1fa088'],[0.6274509803921569,'#28ae80'],[0.6901960784313725,'#3fbc73'],
  [0.7529411764705882,'#5ec962'],[0.8156862745098039,'#84d44b'],[0.8784313725490196,'#addc30'],[0.9411764705882353,'#d8e219'],[1,'#fde725']];

const state={kind:null,name:'',interp:null,nBranch:0,iMax:1,volume:null,expected:null,gridCache:null};
let deps={rerender:()=>{},parse2DText:null,applyFileSettings:null};

const hexRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function viridis(t){
  t=Math.max(0,Math.min(1,t));
  for(let i=1;i<VIRIDIS.length;i++){
    const [t1,c1]=VIRIDIS[i];
    if(t<=t1){
      const [t0,c0]=VIRIDIS[i-1], f=(t-t0)/(t1-t0||1), a=hexRgb(c0), b=hexRgb(c1);
      return `rgb(${a.map((v,k)=>Math.round(v+f*(b[k]-v))).join(',')})`;
    }
  }
  return VIRIDIS.at(-1)[1];
}

// level: 'info' (blue note), 'warn' (yellow), 'error' (red).
function message(text,level='info'){
  const box=$('dispersionMessage'); if(!box) return;
  box.textContent=text||''; box.dataset.level=level; box.classList.toggle('hidden',!text);
}
function showName(){
  const box=$('dispersionFileName'); if(box){ box.value=state.name||'No file selected'; box.title=state.name||''; }
  const unset=$('dispersionUnsetButton'); if(unset) unset.disabled=!state.kind;
}

export function overlayActive(){ return !!state.kind; }
export function overlayKind(){ return state.kind; }

// Colour scale of the overlay: I min (threshold, >= 0.01) … I max (<= 1),
// linear or log10.
function scale(){
  const read=(id,d)=>{ const v=Number($(id)?.value); return Number.isFinite(v) ? v : d; };
  const min=Math.max(MIN_FLOOR,Math.min(0.9999,read('dispColorMinEntry',MIN_FLOOR)));
  const max=Math.max(min+1e-4,Math.min(1,read('dispColorMaxEntry',1)));
  const log=!!$('dispColorLog')?.checked;
  const c=v=>log ? Math.log10(v) : v;
  return {min,max,log,c,c0:c(min),c1:c(max)};
}
function colorbar(title,bar,s){
  const base={title:{text:title,side:'right',font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},
    thickness:16,len:bar.len,x:1.01,xanchor:'left',y:bar.y};
  if(!s.log) return base;
  // Ticks at 1, 2 and 5 times the powers of ten inside the range.
  const vals=[];
  for(let n=Math.floor(s.c0)-1;n<=Math.ceil(s.c1);n++) for(const m of [1,2,5]){
    const c=Math.log10(m)+n; if(c>=s.c0-1e-9 && c<=s.c1+1e-9) vals.push(c);
  }
  return {...base,tickmode:'array',tickvals:vals,ticktext:vals.map(c=>String(Number((10**c).toPrecision(2))))};
}
// The trace that carries the colorbar (Plotly drops the colorbar of an
// empty trace: one unplotted point).
function colorbarTrace(title,bar,s){
  return {type:'scatter',mode:'markers',x:[null],y:[null],hoverinfo:'skip',showlegend:false,meta:'dispersion-colorbar',
    marker:{color:[s.c0],colorscale:'Viridis',cmin:s.c0,cmax:s.c1,showscale:true,colorbar:colorbar(title,bar,s),size:0.1}};
}
// Line pieces grouped by colour level: one trace per level (Plotly draws a
// line in one colour).  pieces: [{x0,y0,x1,y1,v}] with v = I / max.
function colouredLineTraces(pieces,s,hoverLabel){
  const groups=new Map();
  for(const p of pieces){
    if(!(p.v>=s.min)) continue;
    const t=(s.c(Math.min(p.v,s.max))-s.c0)/(s.c1-s.c0||1);
    const level=Math.round(Math.max(0,Math.min(1,t))*(LEVELS-1));
    if(!groups.has(level)) groups.set(level,{x:[],y:[],text:[]});
    const g=groups.get(level), label=`${hoverLabel} = ${p.v.toPrecision(3)}`;
    g.x.push(p.x0,p.x1,null); g.y.push(p.y0,p.y1,null); g.text.push(label,label,null);
  }
  return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([level,g])=>({
    type:'scatter',mode:'lines',x:g.x,y:g.y,text:g.text,hovertemplate:'%{text}<extra></extra>',
    line:{color:viridis(level/(LEVELS-1)),width:2.4},showlegend:false,meta:'dispersion-lines',connectgaps:false
  }));
}

// Colorbars on the right of a Q-E map: nuclear, magnetic and this overlay,
// top to bottom, sharing the height.
export function qeColorbarSlots({nuclear=true,magnetic=false,overlay=false}={}){
  const keys=[nuclear&&'nuclear',magnetic&&'magnetic',overlay&&'overlay'].filter(Boolean);
  const layouts={1:[{len:0.62,y:0.52}],2:[{len:0.34,y:0.74},{len:0.34,y:0.23}],3:[{len:0.25,y:0.85},{len:0.25,y:0.5},{len:0.25,y:0.15}]};
  const out={nuclear:{len:0.62,y:0.52},magnetic:{len:0.34,y:0.23},overlay:{len:0.62,y:0.52}};
  (layouts[keys.length]||[]).forEach((slot,i)=>{ out[keys[i]]=slot; });
  return out;
}

// The overlay is drawn on single-crystal TAS maps only (and a 2D slice only
// with the lattice and plane it was calculated with).
export function overlayDrawnFor(cache){
  return !!state.kind && !!cache && !cache.powder && !cache.analyzerFree && !cache.fourCircle && stillValid();
}

// A 2D slice belongs to the lattice and scattering plane it was calculated
// with: when either is changed, it is unset (and the reason said).
const LATTICE_IDS=['a','b','c','alpha','beta','gamma'], PLANE_IDS=['Uh','Uk','Ul','Vh','Vk','Vl'];
const snapshot=()=>[...LATTICE_IDS,...PLANE_IDS].map(id=>Number($(id)?.value));
function stillValid(){
  if(state.kind!=='conv2d' || !state.expected) return true;
  const now=snapshot();
  const same=now.every((v,i)=>Number.isFinite(v) && v.toFixed(3)===state.expected[i].toFixed(3));
  if(same) return true;
  // (Called while a map is drawn: that drawing goes on without it.)
  unset('Unset: lattice or plane changed.',{rerender:false,level:'warn'});
  return false;
}

// Physical plane coordinates of h k l = u U + v V (the Constant E map).
function planeBasis(cache){
  const Qu=hklToQ(cache.rl,cache.U), Qv=hklToQ(cache.rl,cache.V);
  const ux=dot(Qu,cache.ex), uy=dot(Qu,cache.ey), vx=dot(Qv,cache.ex), vy=dot(Qv,cache.ey);
  const det=ux*vy-vx*uy;
  return {ux,uy,vx,vy,det,
    xy:(u,v)=>[u*ux+v*vx,u*uy+v*vy],
    uv:(x,y)=>[(x*vy-y*vx)/det,(ux*y-uy*x)/det]};
}
// h k l -> (a, b) with h k l = a U + b V (least squares) and the distance
// out of the plane.
function planeCoefficients(U,V){
  const uu=dot(U,U), vv=dot(V,V), uvp=dot(U,V), det=uu*vv-uvp*uvp;
  return hkl=>{
    const pu=dot(hkl,U), pv=dot(hkl,V);
    const a=(vv*pu-uvp*pv)/det, b=(uu*pv-uvp*pu)/det;
    const off=Math.hypot(...hkl.map((x,i)=>x-a*U[i]-b*V[i]));
    return {a,b,off};
  };
}
// Bracketing index and fraction on a sorted axis (null outside).
function bracket(axis,x){
  const n=axis.length;
  if(!(x>=axis[0]-1e-9 && x<=axis[n-1]+1e-9)) return null;
  let lo=0, hi=n-1;
  while(hi-lo>1){ const m=(lo+hi)>>1; if(axis[m]<=x) lo=m; else hi=m; }
  const t=axis[hi]>axis[lo] ? (x-axis[lo])/(axis[hi]-axis[lo]) : 0;
  return {lo,hi,t:Math.max(0,Math.min(1,t))};
}
// Convolved intensity / max at (a, b) and the energy index range of the
// volume (bilinear in a, b; linear in E when e is a fraction index).
function volumeAt(a,b,ei,et=0){
  const V=state.volume, nA=V.A.length, nE=V.E.length;
  const ba=bracket(V.A,a), bb=bracket(V.B,b);
  if(!ba || !bb) return NaN;
  const val=(ia,ib,ie)=>V.I[(ib*nA+ia)*nE+ie];
  const plane=ie=>{
    const v00=val(ba.lo,bb.lo,ie), v10=val(ba.hi,bb.lo,ie), v01=val(ba.lo,bb.hi,ie), v11=val(ba.hi,bb.hi,ie);
    return (1-ba.t)*(1-bb.t)*v00+ba.t*(1-bb.t)*v10+(1-ba.t)*bb.t*v01+ba.t*bb.t*v11;
  };
  const v=et>0 ? (1-et)*plane(ei)+et*plane(Math.min(ei+1,nE-1)) : plane(ei);
  return v/state.iMax;
}

// -------------------------------------------------------- Constant E map --
// Branch energies and intensities on a (u, v) grid over the part of the
// table in the plane (kept while the plane and the window are the same).
function dispersionGrid(cache,basis,Q){
  const key=`${cache.U}|${cache.V}|${cache.ex}|${cache.ey}|${Q.toFixed(4)}|${state.name}`;
  if(state.gridCache?.key===key) return state.gridCache;
  // (u, v) of the window corners and of the table box, intersected.
  const win=[[-Q,-Q],[Q,-Q],[-Q,Q],[Q,Q]].map(([x,y])=>basis.uv(x,y));
  const r=state.interp.ranges, box=[];
  for(const h of [r[0].min,r[0].max]) for(const k of [r[1].min,r[1].max]) for(const l of [r[2].min,r[2].max]) box.push([h,k,l]);
  const coef=planeCoefficients(cache.U,cache.V);
  const tb=box.map(p=>{ const c=coef(p); return [c.a,c.b]; });
  const lim=(pts,i)=>[Math.min(...pts.map(p=>p[i])),Math.max(...pts.map(p=>p[i]))];
  const [wu0,wu1]=lim(win,0), [wv0,wv1]=lim(win,1), [tu0,tu1]=lim(tb,0), [tv0,tv1]=lim(tb,1);
  const u0=Math.max(wu0,tu0), u1=Math.min(wu1,tu1), v0=Math.max(wv0,tv0), v1=Math.min(wv1,tv1);
  const N=241, nB=state.nBranch;
  const grid={key,N,u0,u1,v0,v1,E:new Float64Array(N*N*nB).fill(NaN),I:new Float64Array(N*N*nB).fill(NaN),ok:u1>u0 && v1>v0};
  if(grid.ok){
    for(let j=0;j<N;j++){
      const v=v0+(v1-v0)*j/(N-1);
      for(let i=0;i<N;i++){
        const u=u0+(u1-u0)*i/(N-1);
        const hkl=cache.U.map((x,k)=>u*x+v*cache.V[k]);
        const res=state.interp.evaluate(hkl[0],hkl[1],hkl[2]);
        if(!res) continue;
        const base=(j*N+i)*nB;
        for(let b=0;b<nB;b++){ grid.E[base+b]=res.E[b]; grid.I[base+b]=res.I[b]; }
      }
    }
  }
  state.gridCache=grid;
  return grid;
}
// Where each branch crosses ħω: marching squares on E − ħω, each piece
// coloured by the intensity at its middle.
function dispersionContourPieces(cache,hw,Q){
  const basis=planeBasis(cache);
  if(!(Math.abs(basis.det)>1e-12)) return [];
  const g=dispersionGrid(cache,basis,Q);
  if(!g.ok) return [];
  const {N,u0,u1,v0,v1}=g, nB=state.nBranch, pieces=[];
  const du=(u1-u0)/(N-1), dv=(v1-v0)/(N-1);
  for(let b=0;b<nB;b++){
    const f=(i,j)=>g.E[(j*N+i)*nB+b]-hw, w=(i,j)=>g.I[(j*N+i)*nB+b];
    for(let j=0;j<N-1;j++) for(let i=0;i<N-1;i++){
      const c=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
      const fv=c.map(([a,bb])=>f(a,bb));
      if(fv.some(x=>!Number.isFinite(x))) continue;
      const cross=[];
      for(let e=0;e<4;e++){
        const p=c[e], q=c[(e+1)%4], fp=fv[e], fq=fv[(e+1)%4];
        if((fp<0)===(fq<0)) continue;
        const t=fp/(fp-fq);
        const iu=p[0]+t*(q[0]-p[0]), jv=p[1]+t*(q[1]-p[1]);
        const I=w(p[0],p[1])+t*(w(q[0],q[1])-w(p[0],p[1]));
        cross.push({u:u0+iu*du,v:v0+jv*dv,I});
      }
      for(let k=0;k+1<cross.length;k+=2){
        const a=cross[k], z=cross[k+1];
        const [x0,y0]=basis.xy(a.u,a.v), [x1,y1]=basis.xy(z.u,z.v);
        pieces.push({x0,y0,x1,y1,v:0.5*(a.I+z.I)/state.iMax});
      }
    }
  }
  return pieces;
}
// The 2D slice at ħω (linear between its energies) as a colour map on a
// rectangular (x, y) grid over the slice.
function convolutionHeatmap(cache,hw,s,bar){
  const V=state.volume, basis=planeBasis(cache);
  if(!(Math.abs(basis.det)>1e-12)) return [];
  const be=bracket(V.E,hw);
  if(!be) return [];
  const corners=[[V.A[0],V.B[0]],[V.A.at(-1),V.B[0]],[V.A[0],V.B.at(-1)],[V.A.at(-1),V.B.at(-1)]].map(([a,b])=>basis.xy(a,b));
  const x0=Math.min(...corners.map(p=>p[0])), x1=Math.max(...corners.map(p=>p[0]));
  const y0=Math.min(...corners.map(p=>p[1])), y1=Math.max(...corners.map(p=>p[1]));
  const n=Math.min(301,Math.max(81,2*Math.max(V.A.length,V.B.length)));
  const xs=Array.from({length:n},(_,i)=>x0+(x1-x0)*i/(n-1)), ys=Array.from({length:n},(_,j)=>y0+(y1-y0)*j/(n-1));
  const rel=[], z=[];
  for(const y of ys){
    const rr=[], zr=[];
    for(const x of xs){
      const [a,b]=basis.uv(x,y);
      const v=volumeAt(a,b,be.lo,be.t);
      const shown=Number.isFinite(v) && v>=s.min;
      rr.push(Number.isFinite(v) ? v : null);
      zr.push(shown ? s.c(Math.min(v,s.max)) : null);
    }
    rel.push(rr); z.push(zr);
  }
  return [{type:'heatmap',x:xs,y:ys,z,customdata:rel,zauto:false,zmin:s.c0,zmax:s.c1,colorscale:'Viridis',
    showscale:true,colorbar:colorbar('I / max',bar,s),hoverongaps:false,meta:'dispersion-map',
    hovertemplate:'I / max = %{customdata:.3g}<extra></extra>',showlegend:false}];
}
// Traces for the Constant E map at ħω (inserted above Accessible Q).
export function constantEOverlayTraces(cache,hw,Q,bar){
  if(!overlayDrawnFor(cache)) return [];
  const s=scale();
  try{
    if(state.kind==='dispersion'){
      const pieces=dispersionContourPieces(cache,hw,Q);
      return [...colouredLineTraces(pieces,s,'S / max'),colorbarTrace('S / max',bar,s)];
    }
    return convolutionHeatmap(cache,hw,s,bar);
  }catch(err){ console.warn('Dispersion overlay:',err); return []; }
}

// ----------------------------------------------------- Q vector–E map --
// samples: [{x, hkl}] along the path; energies: the ħω axis of the map.
export function vectorOverlayTraces(cache,samples,bar){
  if(!overlayDrawnFor(cache)) return [];
  const s=scale();
  try{
    if(state.kind==='dispersion'){
      const nB=state.nBranch, pieces=[];
      const at=samples.map(p=>{ const r=state.interp.evaluate(p.hkl[0],p.hkl[1],p.hkl[2]); return r ? {E:Array.from(r.E),I:Array.from(r.I)} : null; });
      for(let b=0;b<nB;b++){
        for(let k=0;k+1<samples.length;k++){
          const p=at[k], q=at[k+1];
          if(!p || !q || !Number.isFinite(p.E[b]) || !Number.isFinite(q.E[b])) continue;
          pieces.push({x0:samples[k].x,y0:p.E[b],x1:samples[k+1].x,y1:q.E[b],v:0.5*(p.I[b]+q.I[b])/state.iMax});
        }
      }
      return [...colouredLineTraces(pieces,s,'S / max'),colorbarTrace('S / max',bar,s)];
    }
    const V=state.volume, coef=planeCoefficients(V.U,V.V);
    const ab=samples.map(p=>{ const c=coef(p.hkl); return c.off<1e-3 ? c : null; });
    const rel=[], z=[];
    for(let e=0;e<V.E.length;e++){
      const rr=[], zr=[];
      for(const c of ab){
        const v=c ? volumeAt(c.a,c.b,e) : NaN;
        rr.push(Number.isFinite(v) ? v : null);
        zr.push(Number.isFinite(v) && v>=s.min ? s.c(Math.min(v,s.max)) : null);
      }
      rel.push(rr); z.push(zr);
    }
    return [{type:'heatmap',x:samples.map(p=>p.x),y:Array.from(V.E),z,customdata:rel,zauto:false,zmin:s.c0,zmax:s.c1,
      colorscale:'Viridis',showscale:true,colorbar:colorbar('I / max',bar,s),hoverongaps:false,meta:'dispersion-map',
      hovertemplate:'I / max = %{customdata:.3g}<extra></extra>',showlegend:false}];
  }catch(err){ console.warn('Dispersion overlay:',err); return []; }
}

// ------------------------------------------------------------- loading --
function unset(note='',{rerender=true,level='info'}={}){
  state.kind=null; state.name=''; state.interp=null; state.volume=null; state.expected=null; state.gridCache=null;
  showName(); message(note,level);
  if(rerender) deps.rerender();
}
async function loadFile(file){
  if(!file) return;
  let text;
  try{ text=await file.text(); }catch(err){ message(`${file.name}: ${err.message||err}`,'error'); return; }
  const head=String(text).split(/\r?\n/).find(l=>l.trim())||'';
  try{
    if(/^\s*#\s*PLANE-TAS convolution:\s*1D/i.test(head)) throw new Error('A 1D cut cannot be shown on the Q-E maps; save a 2D slice.');
    if(/^\s*#\s*PLANE-TAS convolution:\s*2D/i.test(head)){
      if(!deps.parse2DText) throw new Error('2D slices cannot be read here.');
      const v=deps.parse2DText(text);
      // The settings of the calculation are put in first (as Load CSV does).
      // (Its notes, except which dispersion file Convolution has.)
      const notes=(v.settings && deps.applyFileSettings ? deps.applyFileSettings(v.settings) : []).filter(n=>!/^Calculated with /.test(n));
      let iMax=0; for(const x of v.I) if(Number.isFinite(x) && x>iMax) iMax=x;
      if(!(iMax>0)) throw new Error('The slice has no intensity.');
      Object.assign(state,{kind:'conv2d',name:file.name,interp:null,nBranch:0,iMax,gridCache:null,
        volume:{A:v.A,B:v.B,E:v.E,I:v.I,U:v.U,V:v.V},expected:snapshot()});
      showName();
      message(v.settings ? `Loaded with its settings.${notes.length?' '+notes.join(' '):''}` : 'No settings in the file: drawn with the current lattice and scattering plane.');
    }else{
      const data=parseDispersionTable(text,'block');
      const interp=createDispersionInterpolator(data);
      let iMax=0; for(const p of data.points) for(const x of p.I) if(Number.isFinite(x) && x>iMax) iMax=x;
      if(!(iMax>0)) throw new Error('The table has no intensity.');
      Object.assign(state,{kind:'dispersion',name:file.name,interp,nBranch:data.nBranch,iMax,volume:null,expected:null,gridCache:null});
      showName();
      message('');
    }
  }catch(err){
    message(`${file.name}: ${err.message||err}`,'error');
    return;
  }
  deps.rerender();
}

// Set on Q-E (Convolution › 2D slice): the 2D slice shown there, copied.
// It must belong to the present lattice and scattering plane (those of its
// settings, else the present ones are assumed).
export function setOverlayVolume({name,volume,settings}){
  if(!volume?.A?.length || !volume?.B?.length || !volume?.E?.length) return false;
  const inst=settings?.instrument||{};
  const ids=[...LATTICE_IDS,...PLANE_IDS];
  const expected=ids.every(id=>Number.isFinite(Number(inst[id]))) ? ids.map(id=>Number(inst[id])) : snapshot();
  const now=snapshot();
  if(!now.every((v,i)=>Number.isFinite(v) && v.toFixed(3)===expected[i].toFixed(3))){
    message('Not set: calculated with another lattice or plane.','warn');
    return false;
  }
  let iMax=0; for(const x of volume.I) if(Number.isFinite(x) && x>iMax) iMax=x;
  if(!(iMax>0)){ message('Not set: the slice has no intensity.','warn'); return false; }
  Object.assign(state,{kind:'conv2d',name:name||'2D slice (Convolution)',interp:null,nBranch:0,iMax,gridCache:null,
    volume:{A:volume.A,B:volume.B,E:volume.E,I:volume.I,U:volume.U,V:volume.V},expected:now});
  showName(); message('Set from Convolution.');
  deps.rerender();
  return true;
}

// Section shown only where a convolution exists: single crystal, TAS.
export function updateDispersionSection(cache){
  const powder=$('sampleMode')?.value==='powder';
  const hide=powder || !!(cache && (cache.analyzerFree || cache.fourCircle));
  $('sampleDispersionSection')?.classList.toggle('hidden',hide);
}

export function initDispersionOverlay(d){
  deps={...deps,...d};
  const input=$('dispersionFileInput');
  $('dispersionSelectButton')?.addEventListener('click',()=>input?.click());
  input?.addEventListener('change',()=>{ const f=input.files?.[0]; input.value=''; loadFile(f); });
  $('dispersionUnsetButton')?.addEventListener('click',()=>unset());
  $('sampleMode')?.addEventListener('change',()=>updateDispersionSection(null));
  // Colour scale: I min (>= 0.01) < I max (<= 1).
  const tidy=source=>{
    const lo=$('dispColorMinEntry'), hi=$('dispColorMaxEntry'); if(!lo||!hi) return;
    const r=(el,d)=>{ const v=Number(el.value); return Number.isFinite(v) && el.value.trim()!=='' ? v : d; };
    let min=Math.max(MIN_FLOOR,Math.min(0.9999,r(lo,MIN_FLOOR))), max=Math.max(MIN_FLOOR+1e-4,Math.min(1,r(hi,1)));
    if(max-min<1e-4){ if(source==='max') min=Math.max(MIN_FLOOR,max-1e-4); else max=Math.min(1,min+1e-4); }
    lo.value=String(Number(min.toFixed(4))); hi.value=String(Number(max.toFixed(4)));
  };
  const usable=()=>{ const lo=Number($('dispColorMinEntry')?.value), hi=Number($('dispColorMaxEntry')?.value);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo>=MIN_FLOOR && hi<=1 && hi-lo>=1e-4; };
  for(const [id,source] of [['dispColorMinEntry','min'],['dispColorMaxEntry','max']]){
    const field=$(id); if(!field) continue;
    field.addEventListener('focus',()=>field.select());
    field.addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); field.blur(); } });
    field.addEventListener('change',()=>{ tidy(source); if(state.kind) deps.rerender(); });
    applyWhileTyping(field,()=>{ if(state.kind) deps.rerender(); },{valid:usable});
  }
  $('dispColorLog')?.addEventListener('change',()=>{ if(state.kind) deps.rerender(); });
  showName();
  updateDispersionSection(null);
}
