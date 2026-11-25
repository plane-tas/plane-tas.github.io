// Powder Q-E map: background powder peaks/curves and calculatePowder.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {PI, add, clamp, deg2rad, norm, rad2deg, reciprocalVectors, scale} from '../core/tas-core.js';
import {nuclearExtinctionThreshold, nuclearStructureFactorSquared} from '../cif/cif-structure.js';
import {qeMapTitle, qeTitleLayout} from './qe-plot-title.js';
import {PLOT_FONTS} from '../core/plot-fonts.js';
import {magneticRatioText} from './bragg-intensity.js';

export function createPowder(deps){
  const {
    backgroundColor, backgroundMaterials, checkedValue, currentInstrument, currentPlotRanges,
    effectiveS2MaxAtEi, enabledPropagationVectors, formatHKL, hklToQ, isAllowedByCentering,
    latticeParams, num, powderWavevectors, energyTransferRange, energyTransferGrid, renderQEExternalLegend, selectedBackgrounds,
    selectedSampleCentering, validateEffectiveS2Max, getNuclearCifStructure,
    $, getMagneticPeakIntensities, singleColorbarTicks
  }=deps;

function powderS2ForQAtHW(q,hw){
  const wv=powderWavevectors(hw);
  if(!wv) return NaN;
  const {ki,kf}=wv;
  const denom=2*ki*kf;
  if(!(denom>0)) return NaN;
  const c=(ki*ki+kf*kf-q*q)/denom;
  if(c < -1-1e-10 || c > 1+1e-10) return NaN;
  return rad2deg(Math.acos(clamp(c,-1,1)));
}

function powderSfText(sf2){
  if(!Number.isFinite(sf2)) return "N/A";
  const a=Math.abs(sf2);
  const s=(a!==0 && (a>=1e5 || a<1e-3)) ? sf2.toExponential(4) : sf2.toFixed(4).replace(/\.?0+$/,"");
  return `|F<sub>N</sub>|² = ${s} fm²`;
}

function groupPowderReflectionsByQ(entries){
  const groups=new Map();
  for(const e of entries){
    const key=Number(e.q).toFixed(6);
    let g=groups.get(key);
    if(!g){
      g={q:Number(e.q),entries:[]};
      groups.set(key,g);
    }
    g.entries.push(e);
  }
  return [...groups.values()].sort((a,b)=>a.q-b.q);
}

function backgroundPowderCorrectionAtElasticQ(q){
  // Background nuclear Bragg scattering is treated as elastic.  The selected
  // fixed TAS energy therefore sets the constant wavelength with Ei = Ef = E,
  // for both "Ef fixed" and "Ei fixed" UI modes.
  //
  // FullProf constant-wavelength neutron powder (K=0) uses
  //   Lp = 1 / (2 sin^2(theta) cos(theta))
  //      = 1 / (sin(theta) sin(2 theta)).
  //
  // Calculate the elastic powder pattern all the way through S2 = 180 deg
  // (Q = 2k).  The geometrical factor is singular exactly at 180 deg, so only
  // the numerical denominator is protected at machine precision; S2 itself
  // remains exactly 180 deg at the endpoint.
  const E=num("energy");
  if(!(E>0) || !(q>0)) return null;
  const k=Math.sqrt(E/2.072);
  const sinTheta=q/(2*k);
  if(!(sinTheta>0) || sinTheta>1+1e-10) return null;
  const theta=Math.asin(clamp(sinTheta,0,1));
  const s2=2*theta;
  const denomRaw=Math.abs(Math.sin(theta)*Math.sin(s2));
  const denom=Math.max(denomRaw,Number.EPSILON);
  return {
    s2Deg:Math.min(180,rad2deg(s2)),
    lorentzDebye:1/denom
  };
}

// Relative intensities are normalized to the strongest BG line with
// Q <= normLimit (the Q range of the map, like the sample Bragg peaks);
// lines with Q <= qLimit are returned.
function backgroundPowderPeaks(material,qLimit,normLimit=qLimit){
  const structure=material?.structure;
  const lc=structure?.lattice;
  if(!lc) return [];
  const vals=[lc.a,lc.b,lc.c,lc.alpha,lc.beta,lc.gamma].map(Number);
  if(!vals.every(Number.isFinite)) return [];

  // Build the BG powder pattern over the complete elastic backscattering
  // interval S2 = 0..180 deg; it is normalized and clipped to the Q range of
  // the map below.
  const E=num("energy");
  if(!(E>0)) return [];
  const kElastic=Math.sqrt(E/2.072);
  const qCalcLimit=2*kElastic; // S2 = 180 deg.

  const rv=reciprocalVectors(...vals);
  const hmax=Math.max(1,Math.ceil(lc.a*qCalcLimit/(2*PI))+1);
  const kmax=Math.max(1,Math.ceil(lc.b*qCalcLimit/(2*PI))+1);
  const lmax=Math.max(1,Math.ceil(lc.c*qCalcLimit/(2*PI))+1);
  const entries=[];

  for(let h=-hmax;h<=hmax;h++){
    for(let k=-kmax;k<=kmax;k++){
      for(let l=-lmax;l<=lmax;l++){
        if(h===0 && k===0 && l===0) continue;
        const hkl=[h,k,l];
        const G=add(add(scale(rv.astar,h),scale(rv.bstar,k)),scale(rv.cstar,l));
        const q=norm(G);
        if(!(q>1e-8) || q>qCalcLimit+1e-10) continue;
        const sf2=nuclearStructureFactorSquared(structure,hkl,q);
        if(Number.isFinite(sf2)) entries.push({hkl,q,sf2});
      }
    }
  }

  if(!entries.length) return [];
  // Absolute extinction scale: with a low fixed energy (e.g. HODACA, Ef =
  // 3.635 meV, 2k = 2.65 A^-1) Al has no allowed reflection below 2k, and a
  // threshold relative to the list maximum kept forbidden (100) as a ring.
  const extinct=nuclearExtinctionThreshold(structure);
  const surviving=entries.filter(p=>p.sf2>extinct);
  const groups=groupPowderReflectionsByQ(surviving);

  const corrected=[];
  for(const g of groups){
    const correction=backgroundPowderCorrectionAtElasticQ(g.q);
    // A constant-wavelength elastic powder Bragg peak has no real 2theta when
    // q > 2k, so it is not part of the corresponding FullProf-like pattern.
    if(!correction) continue;

    // Coincident powder reflections are summed first, so the represented hkl
    // multiplicity contributes directly.  Then apply the neutron powder
    // Lorentz / Debye-cone correction at the elastic S2.
    g.sf2Sum=g.entries.reduce((sum,p)=>sum+Math.max(0,Number(p.sf2)||0),0);
    g.elasticS2=correction.s2Deg;
    g.lorentzDebye=correction.lorentzDebye;
    g.intensity=g.sf2Sum*g.lorentzDebye;
    corrected.push(g);
  }

  const maxIntensity=Math.max(0,...corrected.filter(g=>g.q<=normLimit+1e-10).map(g=>g.intensity));
  for(const g of corrected){
    g.relativeIntensity=maxIntensity>0 ? Math.min(1,g.intensity/maxIntensity) : 0;
    // Hover lines in the same form as the sample Bragg peaks: |F|², L and
    // the relative intensity (barn per cell of the BG material).
    g.intensityHover=`Mult = ${g.entries.length}, Σ|F<sub>N</sub>|² = ${barnText(g.sf2Sum/100)} barn<br>L = 1/(2 sin²θ cosθ) = ${g.lorentzDebye.toPrecision(4)}<br>Σ|F<sub>N</sub>|²L / max = ${g.relativeIntensity.toFixed(4)}`;
  }

  return corrected.filter(g=>g.q<=qLimit+1e-10);
}

function representativePowderHklText(group){
  const entries=(group?.entries||[]).slice().sort((a,b)=>
    formatHKL(a.hkl).localeCompare(formatHKL(b.hkl))
  );
  if(!entries.length) return "N/A";
  const label=`(${formatHKL(entries[0].hkl)})`;
  return entries.length>1 ? `${label} & equivalent` : label;
}

function powderS2HoverText(q,hw){
  const s2=powderS2ForQAtHW(q,hw);
  return Number.isFinite(s2) ? `${s2.toFixed(3)}°` : "N/A";
}

function appendPowderBackgroundCurve(target,q,hwList,detailHtml){
  let open=false;
  for(const w of hwList){
    const s2=powderS2ForQAtHW(q,w);
    if(!Number.isFinite(s2)){
      if(open){
        target.x.push(null); target.y.push(null); target.customdata.push(null);
        open=false;
      }
      continue;
    }
    target.x.push(q);
    target.y.push(w);
    target.customdata.push([detailHtml,q,`${s2.toFixed(3)}°`]);
    open=true;
  }
  if(open){
    target.x.push(null); target.y.push(null); target.customdata.push(null);
  }
}

function appendPowderBraggLine(target,q,hwList,detailHtml){
  // Draw every Bragg line over the exact same hbar-omega span.  The yellow
  // accessible region shows where the instrument can actually reach the peak;
  // S2 is still evaluated point-by-point for hover and becomes N/A only when
  // no real scattering angle exists at that (Q,hbar-omega).
  for(const w of hwList){
    target.x.push(q);
    target.y.push(w);
    target.customdata.push([detailHtml,q,powderS2HoverText(q,w)]);
  }
  target.x.push(null);
  target.y.push(null);
  target.customdata.push(null);
}

const peakScale=(id,fallback)=>{ const v=Number($?.(id)?.value); return Number.isFinite(v)?v:fallback; };
const powderLorentz=q=>backgroundPowderCorrectionAtElasticQ(q)?.lorentzDebye ?? null;
const lorentzHover=L=>L ? `L = 1/(2 sin²θ cosθ) = ${L.toPrecision(4)}` : 'not reachable elastically';
const barnText=v=>{ const a=Math.abs(v); return (a!==0 && (a>=1e5 || a<1e-3)) ? v.toExponential(4) : String(Number(v.toPrecision(6))); };
// Bragg lines are coloured here from the same scale as their colorbar.  The
// scales start at a light grey / light red (not white) so weak lines stay
// visible.
const NUCLEAR_LINE_SCALE=[[0,[220,220,220]],[0.25,[175,175,175]],[0.5,[125,125,125]],[0.75,[65,65,65]],[1,[0,0,0]]];
const MAGNETIC_LINE_SCALE=[[0,[255,215,215]],[0.25,[250,160,160]],[0.5,[238,100,100]],[0.75,[212,40,40]],[1,[170,0,0]]];
const plotlyScale=scale=>scale.map(([t,c])=>[t,`rgb(${c.join(',')})`]);
// Line colours cannot vary inside one Plotly line trace.  Rounding the
// colour position to LINE_COLOR_LEVELS steps (invisible on screen) lets all
// lines of one colour share a trace, so dense patterns stay light.
const LINE_COLOR_LEVELS=64;
class LineBins{
  constructor(){ this.bins=new Map(); }
  add(color,dash,line){
    const key=`${color}|${dash}`;
    if(!this.bins.has(key)) this.bins.set(key,{color,dash,data:{x:[],y:[],customdata:[]}});
    const d=this.bins.get(key).data;
    // Each line ends with a null point, so lines stay separate.
    for(let i=0;i<line.x.length;i++){ d.x.push(line.x[i]); d.y.push(line.y[i]); d.customdata.push(line.customdata[i]); }
  }
  list(){ return [...this.bins.values()]; }
}
const scaleColor=(scale,value,cmin,cmax)=>{
  const t=Math.round((cmax>cmin ? clamp((value-cmin)/(cmax-cmin),0,1) : 1)*(LINE_COLOR_LEVELS-1))/(LINE_COLOR_LEVELS-1);
  for(let j=1;j<scale.length;j++){
    const [t0,c0]=scale[j-1],[t1,c1]=scale[j];
    if(t<=t1+1e-12){
      const f=t1>t0 ? (t-t0)/(t1-t0) : 0;
      return `rgb(${c0.map((v,k)=>Math.round(v+f*(c1[k]-v))).join(',')})`;
    }
  }
  return `rgb(${scale.at(-1)[1].join(',')})`;
};
const colorbarFor=(title,bar,cmin,cmax)=>({title:{text:title,side:"right",font:{size:PLOT_FONTS.axis}},tickfont:{size:PLOT_FONTS.tick},
  thickness:16,len:bar.len,x:1.01,xanchor:"left",y:bar.y,...singleColorbarTicks(cmin,cmax)});
const braggHover=kind=>`${kind}<br>%{customdata[0]}<br>Q = %{customdata[1]:.4f} Å⁻¹<br>ħω = %{y:.3f} meV<br>S2 = %{customdata[2]}<extra></extra>`;


// Bragg lines, colorbars and the plot from the last calculation.  The F_N /
// F_M scale entries only redraw (no recalculation).
let lastPowderState=null;
function redrawPowder(){
  if(!lastPowderState) return false;
  drawPowder(lastPowderState);
  return true;
}
function drawPowder(state){
  const {hw,Qdraw,hwmin,hwmax,nuclearGroups,magneticGroups,nuclearShaded,magneticShaded,nuclearMax,magneticMax}=state;
  const traces=state.traces.slice();
  const nuclearBar=magneticShaded ? {len:0.34,y:0.74} : {len:0.62,y:0.52};
  const magneticBar={len:0.34,y:0.23};

  if(nuclearGroups.length){
    const cmin=peakScale('sfColorMinEntry',0), cmax=peakScale('sfColorMaxEntry',1);
    traces.push({x:[null],y:[null],mode:"lines",name:"Nuclear Bragg peaks",legendgroup:"powder-nuclear",
      showlegend:true,legendrank:10,line:{color:"black",width:1.25},hoverinfo:"skip"});
    const lines=new LineBins();
    for(const group of nuclearGroups){
      const relative=nuclearMax>0 ? group.intensity/nuclearMax : 0;
      // Line points and hover text are built once per calculation; a scale
      // change only re-colours (re-bins) them.
      if(!group.line){
        // With a CIF: the summed |F_N|² (barn) of the merged reflections.
        let details=`${representativePowderHklText(group)}${nuclearShaded?'':`<br>${powderSfText(group.entries[0]?.sf2)}`}`;
        if(nuclearShaded) details+=`<br>Mult = ${group.entries.length}, Σ|F<sub>N</sub>|² = ${barnText(group.sf2Sum)} barn<br>${lorentzHover(group.lorentz)}<br>Σ|F<sub>N</sub>|²L / max = ${relative.toFixed(4)}`;
        group.line={x:[],y:[],customdata:[]};
        appendPowderBraggLine(group.line,group.q,hw,details);
      }
      lines.add(nuclearShaded?scaleColor(NUCLEAR_LINE_SCALE,relative,cmin,cmax):"black","solid",group.line);
    }
    for(const {color,dash,data} of lines.list()){
      traces.push({...data,mode:"lines",name:"Nuclear Bragg peaks",legendgroup:"powder-nuclear",showlegend:false,
        line:{color,width:1.25,dash},hovertemplate:braggHover('Nuclear Bragg peaks'),zorder:0});
    }
    // Carrier of the colorbar (Plotly drops the colorbar of an empty trace,
    // so it holds one unplotted point).
    if(nuclearShaded) traces.push({x:[null],y:[null],mode:"markers",name:"Nuclear Bragg peaks",legendgroup:"powder-nuclear",
      showlegend:false,hoverinfo:"skip",
      marker:{color:[0],colorscale:plotlyScale(NUCLEAR_LINE_SCALE),cmin,cmax,showscale:true,
        colorbar:colorbarFor('Σ|F<sub>N</sub>|²L / max',nuclearBar,cmin,cmax)}});
  }

  if(magneticGroups.length){
    const cmin=peakScale('mfColorMinEntry',0), cmax=peakScale('mfColorMaxEntry',1);
    traces.push({x:[null],y:[null],mode:"lines",name:"Magnetic Bragg peaks",legendgroup:"powder-magnetic",
      showlegend:true,legendrank:20,line:{color:"red",width:1.25},hoverinfo:"skip"});
    const lines=new LineBins();
    const nuclearQ=new Set(nuclearGroups.map(g=>g.q.toFixed(6)));
    for(const group of magneticGroups){
      const relative=magneticMax>0 ? group.intensity/magneticMax : 0;
      if(!group.line){
        const entries=[...group.entries]
          .sort((a,b)=>a.qIndex-b.qIndex || formatHKL(a.hkl).localeCompare(formatHKL(b.hkl)));
        const rep=entries[0];
        const suffix=entries.length>1 ? " & equivalent" : "";
        let details=rep ? `k${rep.qIndex}: (${formatHKL(rep.hkl)})${suffix}` : "N/A";
        if(magneticShaded) details+=`<br>Mult = ${group.entries.length}, Σ|F<sub>M</sub>|² = ${barnText(group.fm2Sum)} barn<br>${lorentzHover(group.lorentz)}<br>Σ|F<sub>M</sub>|²L / max = ${relative.toFixed(4)}`;
        group.line={x:[],y:[],customdata:[]};
        appendPowderBraggLine(group.line,group.q,hw,details);
      }
      // k = 0 (or any coincidence): a magnetic line on top of a nuclear line
      // is dashed so the nuclear line stays visible.  Both group lists use
      // the same Q rounding (6 decimals), so a key comparison suffices.
      const onNuclear=nuclearQ.has(group.q.toFixed(6));
      lines.add(magneticShaded?scaleColor(MAGNETIC_LINE_SCALE,relative,cmin,cmax):"red",onNuclear?"dash":"solid",group.line);
    }
    for(const {color,dash,data} of lines.list()){
      traces.push({...data,mode:"lines",name:"Magnetic Bragg peaks",legendgroup:"powder-magnetic",showlegend:false,
        line:{color,width:1.25,dash},hovertemplate:braggHover('Magnetic Bragg peaks'),zorder:10});
    }
    if(magneticShaded) traces.push({x:[null],y:[null],mode:"markers",name:"Magnetic Bragg peaks",legendgroup:"powder-magnetic",
      showlegend:false,hoverinfo:"skip",
      marker:{color:[0],colorscale:plotlyScale(MAGNETIC_LINE_SCALE),cmin,cmax,showscale:true,
        colorbar:colorbarFor('Σ|F<sub>M</sub>|²L / max',magneticBar,cmin,cmax)}});
  }

  // Scale row (F_N / F_M min and max, M = x N) under the powder legend (the
  // powder Lorentz factor is fixed; no Sample › Dispersion overlay here).
  const scaleRow=$?.('sfColorbarRange');
  scaleRow?.classList.toggle('hidden',!nuclearShaded);
  scaleRow?.classList.toggle('qe-nuclear-colorbar',nuclearShaded);
  scaleRow?.classList.toggle('qe-magnetic-colorbar',magneticShaded);
  scaleRow?.classList.remove('qe-dispersion-colorbar');

  // Edge of the accessible range, drawn over the Bragg lines: where the
  // lines are dense they would otherwise hide the yellow region.  Same
  // legend item as the region (one toggle for both).
  const region=state.traces[0];
  traces.push({x:region.x.concat(region.x[0]),y:region.y.concat(region.y[0]),mode:"lines",
    name:region.name,showlegend:false,hoverinfo:"skip",
    line:{color:"#b8961e",width:1.6},zorder:20});

  const keptPowderView=currentPlotRanges("powderPlot");

  renderQEExternalLegend('qePowderLegend','powderPlot',traces);
  Plotly.react("powderPlot",traces,{
    uirevision:"powderPlot-q",
    title:qeTitleLayout(state.title),
    showlegend:false,
    xaxis:{
      title:{text:"Q (Å⁻¹)",font:{size:PLOT_FONTS.axis}},
      // Powder Q is non-negative by definition.  Always anchor the displayed
      // x-axis at Q = 0; preserve only a previously zoomed positive upper edge.
      range:[0,(keptPowderView.x && keptPowderView.x[1]>0) ? keptPowderView.x[1] : Qdraw],
      showgrid:true,gridcolor:"lightgray",zeroline:false,tickfont:{size:PLOT_FONTS.tick},
      // Use the same thin frame as the Q vector–E map.
      showline:false,ticks:"outside",automargin:true
    },
    yaxis:{
      title:{text:"ħω (meV)",font:{size:PLOT_FONTS.axis}},
      // Keep the displayed hbar-omega range exactly on the generated
      // accessible-range endpoints; no extra top/bottom padding.
      range:[hwmin,hwmax],
      showgrid:true,gridcolor:"lightgray",zeroline:false,tickfont:{size:PLOT_FONTS.tick},
      // Match the Q vector–E map on all four sides.
      showline:false,ticks:"outside",automargin:true
    },
    // Draw the axes frame at the plot data boundary on all four sides.
    // A paper-coordinate shape is independent of the trace type and survives
    // dense Powder overlays. The redundant exterior CSS plot border is removed.
    shapes:[{
      type:"rect",xref:"paper",yref:"paper",
      x0:0,y0:0,x1:1,y1:1,
      layer:"above",fillcolor:"rgba(0,0,0,0)",
      line:{color:"#555",width:1.2}
    }],
    plot_bgcolor:"white",paper_bgcolor:"white",
    // Room for the colorbars on the right (as in the Constant E map).
    margin:{l:66,r:nuclearShaded?88:34,t:56,b:65},
    hovermode:"closest"
  },{responsive:true,doubleClick:"reset"});
}

function calculatePowder(){
  const inst=currentInstrument();
  const lc=latticeParams();
  const rv=reciprocalVectors(lc.a,lc.b,lc.c,lc.alpha,lc.beta,lc.gamma);
  const energyMode=checkedValue("energyMode");
  const E=num("energy"), S2min=Math.abs(num("S2min"));

  const qmin=[],qmax=[],hw=[],s2minList=[],s2maxList=[];

  // ħω range from the M2 / A2 angle ranges (negative energy transfer included).
  const hwGrid=energyTransferGrid(energyTransferRange(inst,energyMode==="Ef fixed"?{energyMode,Ef:E}:{energyMode,Ei:E}),
    energyMode==="Ef fixed"?{energyMode,Ef:E}:{energyMode,Ei:E});
  if(energyMode==="Ef fixed"){
    const Ef=E;
    for(const Ei of hwGrid.map(w=>Ef+w)){
      const s2max=validateEffectiveS2Max(effectiveS2MaxAtEi(inst,Ei,false),S2min,Ei);
      const ki=0.6947*Math.sqrt(Ei), kf=0.6947*Math.sqrt(Ef);
      const tmin=deg2rad(S2min),tmax=deg2rad(s2max);
      qmin.push(Math.sqrt(ki*ki+kf*kf-2*ki*kf*Math.cos(tmin)));
      qmax.push(Math.sqrt(ki*ki+kf*kf-2*ki*kf*Math.cos(tmax)));
      hw.push(Ei-Ef);
      s2minList.push(S2min);
      s2maxList.push(s2max);
    }
  } else {
    const Ei=E;
    const s2max=validateEffectiveS2Max(effectiveS2MaxAtEi(inst,Ei,false),S2min,Ei);
    const ki=0.6947*Math.sqrt(Ei);
    for(const w of hwGrid){
      const Ef=Ei-w;
      if(Ef<=0) continue;
      const kf=0.6947*Math.sqrt(Ef),tmin=deg2rad(S2min),tmax=deg2rad(s2max);
      qmin.push(Math.sqrt(ki*ki+kf*kf-2*ki*kf*Math.cos(tmin)));
      qmax.push(Math.sqrt(ki*ki+kf*kf-2*ki*kf*Math.cos(tmax)));
      hw.push(w);
      s2minList.push(S2min);
      s2maxList.push(s2max);
    }
  }
  if(!qmax.length) throw new Error("No accessible powder range was generated.");

  const traces=[{
    x:[...qmin,...[...qmax].reverse()],
    y:[...hw,...[...hw].reverse()],
    fill:"toself",
    fillcolor:"rgba(255,215,0,0.20)",
    line:{width:0},
    name:"Accessible QE range",
    legendrank:0,
    hoverinfo:"skip"
  }];

  const Qlim=Math.max(...qmax), hwmin=Math.min(...hw), hwmax=Math.max(...hw);
  // Bragg peaks are drawn out to 1.1 times the largest reachable Q, as in
  // the single-crystal maps (the reflections just beyond the accessible
  // range stay visible); the colour scales are normalized over these lines.
  const Qdraw=1.1*Qlim;
  const latticeCentering=selectedSampleCentering();

  // Enumerate genuine powder reciprocal-lattice reflections rather than only
  // plotting integer multiples of a*, b*, c*.  The exact index bounds follow
  // |h| <= a|Q|/(2π), etc., from h = a·Q/(2π), so non-orthogonal cells are
  // covered without relying on an orthogonal-axis approximation.
  const propagation=enabledPropagationVectors()
    // Every enabled k, k = 0 included (same definition as the single-crystal
    // maps): G ± k from every centering-allowed G.
    .map(kv=>({...kv,K:hklToQ({astar:rv.astar,bstar:rv.bstar,cstar:rv.cstar},kv.hkl)}));
  const maxK=propagation.length ? Math.max(...propagation.map(kv=>norm(kv.K))) : 0;
  const parentQlim=Qdraw+maxK+1e-8;
  const hmax=Math.max(1,Math.ceil(lc.a*parentQlim/(2*PI))+1);
  const kmax=Math.max(1,Math.ceil(lc.b*parentQlim/(2*PI))+1);
  const lmax=Math.max(1,Math.ceil(lc.c*parentQlim/(2*PI))+1);

  // Nuclear intensities use the crystallographic cell (the parent cell of an mCIF).
  const nuclearCifStructure=getNuclearCifStructure();
  const parentCandidates=[];
  for(let h=-hmax;h<=hmax;h++){
    for(let k=-kmax;k<=kmax;k++){
      for(let l=-lmax;l<=lmax;l++){
        const hkl=[h,k,l];
        const isOrigin=h===0&&k===0&&l===0;
        if(!isOrigin && !isAllowedByCentering(hkl,latticeCentering)) continue;
        const G=add(add(scale(rv.astar,h),scale(rv.bstar,k)),scale(rv.cstar,l));
        const q=norm(G);
        if(q>parentQlim+1e-10) continue;
        const sf2=nuclearCifStructure && !isOrigin
          ? nuclearStructureFactorSquared(nuclearCifStructure,hkl,q)
          : null;
        parentCandidates.push({hkl,q,isOrigin,sf2:Number.isFinite(sf2)?sf2:null});
      }
    }
  }

  // Magnetic satellites G +/- k need only the LATTICE-centering condition on G
  // (already applied above). Nuclear extinctions from screw axes, glides or
  // atom positions do NOT extinguish magnetic scattering (e.g. MnF2 (100),
  // k = 0), so satellites are generated from the parents before that filter.
  const magneticParents=parentCandidates.slice();
  // Match the existing Single-crystal CIF extinction handling: remove
  // effectively extinct nuclear parents only when a CIF structure factor is
  // available.  Keep the origin as a valid magnetic-satellite parent.
  if(nuclearCifStructure){
    const extinct=nuclearExtinctionThreshold(nuclearCifStructure);
    for(let i=parentCandidates.length-1;i>=0;i--){
      const p=parentCandidates[i];
      if(!p.isOrigin && Number.isFinite(p.sf2) && p.sf2<=extinct) parentCandidates.splice(i,1);
    }
  }

  // Background powder peaks are calculated directly from BG_material CIFs.
  // Intensity is multiplicity-weighted Σ|F_N|² times the FullProf-like
  // constant-wavelength neutron Lorentz / Debye-cone factor
  // 1 / (sin(theta) sin(2theta)), normalized within each BG material.
  for(const bg of selectedBackgrounds()){
    const material=backgroundMaterials.get(bg.key);
    const visiblePeaks=backgroundPowderPeaks(material,Qdraw);

    // Lines of equal colour (intensity rounded to LINE_COLOR_LEVELS steps,
    // invisible on screen) share one trace: dense patterns stay light.
    const bins=new Map();
    for(const p of visiblePeaks){
      const ratio=p.relativeIntensity;
      const level=Math.round(clamp(ratio,0,1)*(LINE_COLOR_LEVELS-1))/(LINE_COLOR_LEVELS-1);
      if(!bins.has(level)) bins.set(level,{x:[],y:[],customdata:[]});
      appendPowderBackgroundCurve(
        bins.get(level),p.q,hw,
        `BG${bg.index+1}: ${bg.key}<br>${representativePowderHklText(p)}<br>${p.intensityHover}`
      );
    }
    let first=true;
    for(const [level,data] of [...bins.entries()].sort((a,b)=>b[0]-a[0])){
      if(!data.x.length) continue;
      traces.push({
        ...data,
        mode:"lines",
        name:`BG${bg.index+1}: ${bg.key}`,
        legendgroup:`background-scattering-${bg.index}`,
        showlegend:first,
        legendrank:10+bg.index,
        line:{
          color:backgroundColor(bg.slot,0.20+0.75*level),
          width:1.5
        },
        hovertemplate:`%{customdata[0]}<br>Q = %{customdata[1]:.4f} Å⁻¹<br>ħω = %{y:.3f} meV<br>S2 = %{customdata[2]}<extra></extra>`
      });
      first=false;
    }
  }

  // Nuclear Bragg peaks: all lines have the same hbar-omega length.
  // Reflections with the same powder Q are merged into one line, and the
  // hover text lists the representative index.  With a CIF each line is
  // shaded by its powder intensity, as the Reflection graph defines it:
  //   I = sum over the merged reflections of |F|^2 (= Mult·|F|^2)
  //       x L,  L = 1/(sin θ sin 2θ) at the elastic wave vector of the fixed
  // energy (always applied; Q > 2k is not reachable elastically: I = 0),
  // relative to the strongest line, with the Constant E map colour scales
  // (F_N / F_M min and max of the Scale row) and colorbars.
  const nuclearGroups=groupPowderReflectionsByQ(
    parentCandidates.filter(p=>!p.isOrigin && p.q>1e-8 && p.q<=Qdraw+1e-10)
  );
  const nuclearShaded=!!nuclearCifStructure;
  for(const group of nuclearGroups){
    group.lorentz=powderLorentz(group.q);
    group.sf2Sum=group.entries.reduce((sum,p)=>sum+Math.max(0,Number(p.sf2)||0),0)/100; // fm² -> barn
    group.intensity=group.lorentz ? group.sf2Sum*group.lorentz : 0;
  }
  const nuclearMax=Math.max(0,...nuclearGroups.map(g=>g.intensity));

  // Magnetic Bragg peaks: use surviving nuclear parents, exactly as the
  // Single-crystal path does conceptually.  All k1/k2/k3 satellites share one
  // red line style and one compact legend entry.  |F_M|² (same model as the
  // Reflection table) is available for a single-k structure only, as in the
  // single-crystal maps; otherwise the lines stay plain red.
  const magneticUnique=new Map();
  for(const parent of magneticParents){
    for(const kv of propagation){
      for(const sign of [1,-1]){
        const hm=add(parent.hkl,scale(kv.hkl,sign));
        const Gm=hklToQ({astar:rv.astar,bstar:rv.bstar,cstar:rv.cstar},hm);
        const q=norm(Gm);
        if(!(q>1e-8) || q>Qdraw+1e-10) continue;
        const hklKey=hm.map(x=>Number(x).toFixed(8)).join(",");
        const key=`${kv.index}:${hklKey}`;
        if(!magneticUnique.has(key)){
          magneticUnique.set(key,{q,hkl:hm,qIndex:kv.index});
        }
      }
    }
  }
  const magneticGroups=groupPowderReflectionsByQ([...magneticUnique.values()]);
  let magneticShaded=false;
  if(nuclearCifStructure && enabledPropagationVectors().length===1 && magneticGroups.length && typeof getMagneticPeakIntensities==="function"){
    const rows=getMagneticPeakIntensities(Qdraw);
    if(rows?.length){
      // Matched within 0.006 r.l.u., as in the single-crystal maps (covers a
      // decimal k calculated as the nearest fraction, e.g. 0.333 -> 1/3).
      // Hashed on a 0.01 r.l.u. grid (as in the single-crystal maps), so each
      // look-up checks only the neighbouring cells, not every row.
      const cell=v=>Math.round(v*100);
      const grid=new Map();
      for(const row of rows){
        const key=row.hkl.map(cell).join(',');
        if(!grid.has(key)) grid.set(key,[]);
        grid.get(key).push(row);
      }
      const fm2At=hkl=>{
        const base=hkl.map(cell);
        let best=null,bestD=0.006;
        for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++) for(let c=-1;c<=1;c++){
          for(const row of grid.get([base[0]+a,base[1]+b,base[2]+c].join(','))||[]){
            const d=Math.max(...row.hkl.map((v,i)=>Math.abs(v-hkl[i])));
            if(d<=bestD){ bestD=d; best=row; }
          }
        }
        return best ? Math.max(0,Number(best.fm2)||0) : 0;
      };
      for(const group of magneticGroups){
        group.lorentz=powderLorentz(group.q);
        group.fm2Sum=group.entries.reduce((sum,p)=>sum+fm2At(p.hkl),0);
        group.intensity=group.lorentz ? group.fm2Sum*group.lorentz : 0;
      }
      magneticShaded=true;
    }
  }
  const magneticMax=magneticShaded ? Math.max(0,...magneticGroups.map(g=>g.intensity)) : 0;

  // Strongest magnetic line relative to the strongest nuclear line (both in
  // barn per crystallographic cell, same Lorentz factor): M = x N.
  const ratioBox=$?.('mfMaxRatio');
  if(ratioBox) ratioBox.textContent=magneticRatioText(magneticMax,nuclearMax,magneticShaded);
  lastPowderState={title:qeMapTitle({inst,energyMode,Ei:E,Ef:E}),traces,hw,Qlim,Qdraw,hwmin,hwmax,nuclearGroups,magneticGroups,
    nuclearShaded,magneticShaded,nuclearMax,magneticMax};
  drawPowder(lastPowderState);

  return {
    inst,lc,energyMode,
    Ei:energyMode==="Ei fixed" ? E : null,
    Ef:energyMode==="Ef fixed" ? E : null,
    hwList:[0],
    powder:true
  };
}

  return {
    backgroundPowderPeaks, calculatePowder, powderS2ForQAtHW, redrawPowder, representativePowderHklText
  };
}
