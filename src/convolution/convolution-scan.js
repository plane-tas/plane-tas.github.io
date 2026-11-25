// Resolution › Convolution › 1D cut: calculation, the curves, their legend
// table (Keep / Remove) and Save figure.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {AXIS_TITLE_FONT, FONT} from './convolution-constants.js';
import {LEGEND_COLS, fmt, legendLine, legendFields as legendValues, loadLegendColumns, saveLegendColumns} from './convolution-legend.js';

export function installConvolutionScan(context){
  const {$, collectResolutionBase, parseNumericValue}=context.deps;
  const {state,fns}=context;
  // --------------------------------------------------------------- 1D -----
  const parseNum=v=>parseNumericValue ? parseNumericValue(v) : Number(v);
  // Scan from initial to final (H, K, L, ħω) in Points equal steps, as the
  // Simulation scan.  A variable with equal initial and final values is fixed.
  const SCAN_IDS=[['convH0','convH1'],['convK0','convK1'],['convL0','convL1'],['convE0','convE1']];
  function scanPoints(){
    const names=['H','K','L','ħω'];
    const ends=SCAN_IDS.map(([i0,i1],j)=>{
      const v0=parseNum($(i0)?.value), v1=parseNum($(i1)?.value);
      if(!Number.isFinite(v0) || !Number.isFinite(v1)) throw new Error(`${names[j]}: enter the initial and final values.`);
      return [v0,v1];
    });
    const n=Math.round(fns.num('convPoints1D'));
    if(!(n>=2 && n<=2001)) throw new Error('Points must be between 2 and 2001.');
    const moving=ends.map(([a,b],j)=>Math.abs(b-a)>1e-12 ? j : -1).filter(j=>j>=0);
    if(!moving.length) throw new Error('Initial and final points are the same.');
    const pts=Array.from({length:n},(_,k)=>{
      const t=k/(n-1), v=ends.map(([a,b])=>a+(b-a)*t);
      return {hkl:v.slice(0,3),E:v[3]};
    });
    // Horizontal axis: ħω for an energy scan, otherwise the Q component that changes most.
    const qMoving=moving.filter(j=>j<3);
    const axis=qMoving.length ? qMoving.reduce((best,j)=>Math.abs(ends[j][1]-ends[j][0])>Math.abs(ends[best][1]-ends[best][0])?j:best,qMoving[0]) : 3;
    const text=j=>moving.includes(j) ? `${fmt(ends[j][0])} ~ ${fmt(ends[j][1])}` : fmt(ends[j][0]);
    const label=`${names.map((nm,j)=>`${nm} = ${text(j)}`).join(', ')} (${n} points)`;
    const inputs=names.map((_,j)=>text(j).replace(/ ~ /,'~'));
    return {axis,label,pts,inputs};
  }
  async function calculate1D(){
    if(state.busy1D){ state.stopReq1D=true; return; }
    const id=++state.run1D;
    state.stopReq1D=false;
    try{
      if(!state.interp) throw new Error('Load a dispersion file first.');
      const base=collectResolutionBase(), sc=scanPoints(), settings=fns.settingsSnapshot('1D');
      // Q points outside the table: say so plainly instead of a blank plot.
      const off=sc.pts.filter(p=>!fns.inTable(p.hkl));
      if(off.length===sc.pts.length) throw new Error(`${off.length===1 || sc.axis===3 ? fns.vec(off[0].hkl) : 'The scan'} is outside the table (${fns.tableRangeText()}).`);
      fns.message('convMessage1D','');
      state.busy1D=true; fns.setRunning('convCalculate1D',true); fns.setProgress('convStatus1D',0);
      const cache={}, stats={unreachable:0,outside:0}, I=[];
      // Resolution at every point first (the grid size is taken from all of them).
      const RES=[];
      let t1=performance.now();
      for(const p of sc.pts){
        RES.push(fns.resolutionAt(base,p.hkl,p.E,cache));
        if(performance.now()-t1>150){ t1=performance.now(); await fns.yieldUI(); if(id!==state.run1D) return; }
      }
      const integ=fns.integrationFor('1D',sc.pts.map((p,i)=>({...p,res:RES[i]})));
      // Radial 3rd collimator: its equivalent divergence (from the analyzer
      // angle, the same for every point with Ef fixed) for the legend.
      const r0=RES.find(Boolean);
      if(r0?.collimation3?.radial && Number.isFinite(r0.collimation3.fwhmArcmin)) settings.derived={radial3Arcmin:r0.collimation3.fwhmArcmin};
      let t0=performance.now(), stopped=false;
      for(let i=0;i<sc.pts.length;i++){
        I.push(fns.intensityAt(base,sc.pts[i].hkl,sc.pts[i].E,integ,cache,stats,RES[i]));
        if(performance.now()-t0>150){
          t0=performance.now(); fns.setProgress('convStatus1D',i/sc.pts.length);
          await fns.yieldUI(); if(id!==state.run1D) return;
          if(state.stopReq1D){ stopped=true; break; }
        }
      }
      state.busy1D=false; fns.setRunning('convCalculate1D',false);
      // Stop: the points calculated so far become the current scan.
      if(stopped){
        if(!I.length){ clearCurrentScan(); fns.statusEnd('convStatus1D','Stopped',true); return; }
        const total=sc.pts.length;
        sc.pts=sc.pts.slice(0,I.length);
        sc.label+=` (stopped at ${I.length} of ${total} points)`;
      }
      state.scan={...sc,I,method:$('method')?.value||'',settings};
      fns.showConvTab('1d');
      refreshKept();
      const notes=[];
      // Short notes (one line together); the plot shows where.
      if(off.length) notes.push(`${off.length}/${sc.pts.length} points outside the table.`);
      if(stats.unreachable) notes.push(`${stats.unreachable} points unreachable.`);
      if(stats.outside>0.05) notes.push(`Table smaller than the resolution (up to ${Math.round(stats.outside*100)} % outside).`);
      fns.message('convMessage1D',notes.join(' '),stats.outside>0.05 || off.length>0);
      if(stopped) fns.statusEnd('convStatus1D',`Stopped (${I.length} points)`,true);
      else{ fns.message('convStatus1D','Completed'); fns.setFill('convStatus1D',1); $('convStatus1D')?.classList.add('convolution-progress-on'); }
    }catch(err){ if(id===state.run1D){ state.busy1D=false; fns.setRunning('convCalculate1D',false); clearCurrentScan(); fns.message('convStatus1D',''); fns.message('convMessage1D',err.message||String(err),true); } }
  }
  // No 1D result (failed run, or stopped before the first point): the curve
  // of the previous conditions goes; the kept curves stay (Save CSV and Save
  // figure follow the curves left).  A warning still keeps its curve.
  function clearCurrentScan(){ if(!state.scan) return; state.scan=null; refreshKept(); }
  const AXIS_NAMES=['H (r.l.u.)','K (r.l.u.)','L (r.l.u.)','ħω (meV)'];
  const PALETTE=['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#8c564b','#e377c2','#17becf','#7f7f7f','#bcbd22'];
  // Normalize (check box under the 1D plot): every curve divided by its own
  // maximum, for comparing shapes and positions (Save CSV keeps the values).
  const normalized=()=>!!$('convNormalize1D')?.checked;
  const log1D=()=>!!$('convLog1D')?.checked;
  const curveMax=I=>I.reduce((m,v)=>Number.isFinite(v) && v>m ? v : m,0);
  // Highlight (click a row of the curve table): that curve thick on top, the
  // others thin and faint; click it again to show all equally.
  function scanTrace(sc,name,color,current){
    const x=sc.pts.map(p=>sc.axis===3 ? p.E : p.hkl[sc.axis]);
    const top=normalized() ? curveMax(sc.I) : 0;
    const y=top>0 ? sc.I.map(v=>v/top) : sc.I;
    const custom=sc.pts.map(p=>`(${p.hkl.map(v=>fmt(v)).join(', ')}), ${fmt(p.E,3)} meV`);
    // Solid, fairly thick lines so the colours read well in the legend.
    const on=state.highlighted===sc, dim=state.highlighted && !on;
    return {type:'scatter',mode:'lines+markers',name,x,y,customdata:custom,opacity:dim ? 0.3 : 1,
      marker:{size:on ? 7 : dim ? 4 : current?6:5,color},line:{width:on ? 3.4 : dim ? 1.2 : current?2.6:2.2,color},
      hovertemplate:`%{customdata}<br>I = %{y:.4g}<extra></extra>`};
  }
  // Curves of the 1D plot: the kept scans (numbered, coloured) and the
  // current one (all of them go into Save CSV).
  const curveList=()=>[...fns.kept.map((k,i)=>({k,tag:String(i+1),title:`#${i+1}`,color:k.color,current:false})),
    ...(state.scan ? [{k:state.scan,tag:'current',title:'Current',color:state.scan.color||'#111',current:true}] : [])];
  // Legend (convolution-legend.js): the columns shown are chosen in the Show
  // row above the plot and kept in the browser.
  const legendShown=loadLegendColumns();
  const shownCols=()=>LEGEND_COLS.filter(c=>legendShown.has(c.id));
  const optionOf=(id,v)=>[...($(id)?.options||[])].find(o=>o.value===String(v));
  const LEGEND_LOOKUP={
    instrumentName:v=>optionOf('instrument',v)?.textContent?.trim(),
    // The type labels come from the instrument file: only for the selected one.
    instrumentTypeName:(v,t)=>$('instrument')?.value===v ? optionOf('instrumentType',t)?.textContent : '',
    optionText:(id,v)=>optionOf(id,v)?.textContent};
  const legendFields=k=>legendValues(k,LEGEND_LOOKUP);
  const legendText=k=>legendLine(legendFields(k),shownCols());
  // Traces and layout of the 1D plot.  On screen the curve list next to the
  // plot is the legend; Save figure adds it under the plot.
  // log I: from the largest I down to 10⁻⁶ of it at most (as the 2D colour
  // scale), so that the Gaussian tails do not stretch the axis over tens of
  // decades.
  function logRange(traces){
    let lo=Infinity, hi=0;
    for(const t of traces) for(const v of t.y) if(Number.isFinite(v) && v>0){ if(v<lo) lo=v; if(v>hi) hi=v; }
    if(!(hi>0)) return {};
    lo=Math.max(lo,hi*1e-6);
    const a=Math.log10(lo), b=Math.log10(hi), pad=Math.max(0.1,(b-a)*0.05);
    return {range:[a-pad,b+pad],autorange:false};
  }
  function scanFigure(){
    const curves=curveList();
    // The highlighted curve is drawn last (on top).
    const order=[...curves].sort((a,b)=>(a.k===state.highlighted)-(b.k===state.highlighted));
    const traces=order.map(c=>({...scanTrace(c.k,legendText(c.k),c.color,c.current),legendgroup:c.tag,name:legendText(c.k)}));
    // Horizontal axis title: every scanned variable shown (kept scans may differ).
    const axes=[...new Set(curves.map(c=>c.k.axis))];
    const frame={showline:true,ticks:'outside',linecolor:'#444',linewidth:1,zeroline:false,automargin:true};
    // Top margin: room for Save figure above the top y tick label; the
    // x-axis title sits right under the tick labels (fixed bottom margin), so
    // the plot keeps its size.
    const layout={font:FONT,margin:{l:96,r:20,t:55,b:66},showlegend:false,
      xaxis:{...frame,automargin:false,mirror:true,title:{text:axes.map(i=>AXIS_NAMES[i]).join(' / '),font:AXIS_TITLE_FONT}},
      // log I (Show row): logarithmic axis; points with I ≤ 0 are not drawn.
      yaxis:{...frame,mirror:true,title:{text:normalized() ? 'I (normalized)' : 'I (arb.)',font:AXIS_TITLE_FONT},
        ...(log1D() ? {type:'log',exponentformat:'power',...logRange(traces)} : {type:'linear',rangemode:'tozero'})}};
    return {curves,traces,layout};
  }
  function drawScan(){
    if(!fns.plotly()) return;
    const {curves,traces,layout}=scanFigure();
    if(!curves.length){ try{ Plotly.purge('convScanPlot'); }catch(_e){} return; }
    // Double-click: back to the drawn view: autorange, but in log I the
    // intensity range down to 10⁻⁶ of the maximum (Plotly's own autorange
    // would go over every decade of the Gaussian tails).
    const el=$('convScanPlot');
    el.__convLogY=layout.yaxis.type==='log' ? layout.yaxis.range?.slice() : null;
    Plotly.react(el,traces,layout,{responsive:true,displaylogo:false,doubleClick:false});
    if(!el.__convDoubleClick){
      el.__convDoubleClick=true;
      el.on('plotly_doubleclick',()=>requestAnimationFrame(()=>{
        if(!el.isConnected) return;
        const y=el.__convLogY;
        Plotly.relayout(el,{'xaxis.autorange':true,...(y ? {'yaxis.range':y.slice(),'yaxis.autorange':false} : {'yaxis.autorange':true})});
      }));
    }
  }
  // Save figure: the plot as on screen (current zoom) with the legend table
  // (a head row and one row per curve, the columns shown on screen) under it.  The legend is drawn with shapes and
  // annotations in paper coordinates: a Plotly legend outside the plot would
  // push the margins and break the axes when the entries are long.
  async function saveScanFigure(){
    if(!fns.plotly()) return;
    const {curves,traces,layout}=scanFigure();
    if(!curves.length) return;
    const el=$('convScanPlot');
    const fs=FONT?.size||14, line=Math.round(fs*1.5);
    // Columns sized from the text (canvas measure in Plotly's font); a
    // column empty for every curve is left out.
    const rows=curves.map(c=>legendFields(c.k));
    const cols=shownCols().filter(c=>rows.some(r=>r[c.id]));
    const ctx=document.createElement('canvas').getContext('2d');
    const family='"Open Sans", verdana, arial, sans-serif';
    const tw=(t,bold)=>{ ctx.font=`${bold ? 'bold ' : ''}${fs}px ${family}`; return ctx.measureText(t).width; };
    const gap=Math.round(fs*1.1), swatch=34+10;
    const colW=cols.map(c=>Math.ceil(Math.max(tw(c.head,true),...rows.map(r=>tw(r[c.id]||'',false)))));
    const textW=swatch+colW.reduce((a,b)=>a+b,0)+gap*Math.max(0,cols.length-1)+12;
    const w=Math.round(Math.max(640,el?.clientWidth||800,textW+12+layout.margin.r)), h=Math.max(420,Math.round(el?.clientHeight||480));
    const nLines=curves.length+1, extra=nLines*line+16, b=layout.margin.b+extra, H=h+extra;
    const plotW=w-layout.margin.l-layout.margin.r, plotH=H-layout.margin.t-b;
    const keep=k=>el?.layout?.[k]?.range ? {range:[...el.layout[k].range],autorange:false} : {};
    const shapes=[], annotations=[];
    const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const left=-(layout.margin.l-12);   // px from the plot's left edge
    const yAt=i=>-(layout.margin.b+8+(i+0.5)*line)/plotH;
    const colX=[]; { let x=left+swatch; for(const wj of colW){ colX.push(x); x+=wj+gap; } }
    cols.forEach((c,ci)=>annotations.push({xref:'paper',yref:'paper',x:colX[ci]/plotW,y:yAt(0),xanchor:'left',yanchor:'middle',showarrow:false,text:`<b>${esc(c.head)}</b>`,font:FONT,align:'left'}));
    curves.forEach((c,i)=>{
      const y=yAt(i+1), x0=left/plotW, x1=(left+34)/plotW;
      shapes.push({type:'line',xref:'paper',yref:'paper',x0,x1,y0:y,y1:y,line:{color:c.color,width:c.current ? 2.6 : 2.2}});
      cols.forEach((col,ci)=>{ const t=rows[i][col.id]; if(t) annotations.push({xref:'paper',yref:'paper',x:colX[ci]/plotW,y,xanchor:'left',yanchor:'middle',showarrow:false,text:esc(t),font:FONT,align:'left'}); });
    });
    const fig={...layout,width:w,height:H,margin:{...layout.margin,b},showlegend:false,shapes,annotations,
      xaxis:{...layout.xaxis,...keep('xaxis'),automargin:false},yaxis:{...layout.yaxis,...keep('yaxis'),automargin:false}};
    const tmp=document.createElement('div');
    tmp.style.cssText=`position:fixed;left:-10000px;top:0;width:${w}px;height:${H}px`;
    document.body.appendChild(tmp);
    try{
      await Plotly.newPlot(tmp,traces,fig,{staticPlot:true});
      // Named from the entry shared with Save CSV.  Size from the figure's
      // own layout (the page's density scaling applies to it).
      await Plotly.downloadImage(tmp,{format:'png',filename:fns.fileBase(fns.source1D(),'1d'),scale:2});
    }finally{ try{ Plotly.purge(tmp); }catch(_e){} tmp.remove(); }
  }
  function updateKeepButtons(){
    $('convClearKept1D').disabled=!fns.kept.length;
    fns.updateNamePlaceholders();
    $('convDownload').disabled=!curveList().length;
    if($('convSaveFigure1D')) $('convSaveFigure1D').disabled=!curveList().length;
  }
  function keepScan(){
    if(!state.scan) return;
    // The colour chosen for the current curve, else the first palette colour
    // not in use (a colour stays with its curve when others are removed).
    fns.kept.push({...state.scan,method:state.scan.method||$('method')?.value||'',color:state.scan.color||fns.nextColor()});
    state.scan=null;
    refreshKept();
  }
  // #rgb / rgb() / names -> #rrggbb for <input type=color>.
  function hexColor(c){
    const ctx=document.createElement('canvas').getContext('2d'); ctx.fillStyle='#000'; ctx.fillStyle=String(c||'#000');
    const v=ctx.fillStyle; return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
  }
  // Head of the legend columns, and their chooser (in the Show row above the plot).
  function legendHead(){
    const tr=$('convCurveList')?.closest('table')?.querySelector('thead tr');
    if(tr){
      tr.querySelectorAll('th.convolution-legend-head').forEach(th=>th.remove());
      for(const c of shownCols()){ const th=document.createElement('th'); th.className='convolution-legend-head'; th.textContent=c.head; tr.appendChild(th); }
    }
    const box=$('convLegendColumns');
    if(box && !box.childElementCount){
      const t=document.createElement('span'); t.className='convolution-show-title'; t.textContent='Legend:'; box.appendChild(t);
      for(const c of LEGEND_COLS){
        const lab=document.createElement('label'); lab.className='checkbox-label';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=legendShown.has(c.id);
        cb.addEventListener('change',()=>{
          if(cb.checked) legendShown.add(c.id); else legendShown.delete(c.id);
          saveLegendColumns(legendShown);
          refreshKept();
        });
        lab.append(cb,document.createTextNode(c.head));
        box.appendChild(lab);
      }
    }
  }
  // The side panel doubles as the legend and the keep list.
  function refreshKept(){
    const curves=curveList();
    legendHead();
    const body=$('convCurveList');
    if(body){
      body.replaceChildren(...curves.map(c=>{
        const tr=document.createElement('tr');
        tr.className=[c.current ? 'convolution-curve-current' : '',c.k===state.highlighted ? 'selected' : ''].filter(Boolean).join(' ');
        tr.addEventListener('click',event=>{
          if(event.target.closest('button,input')) return;   // buttons and the colour picker
          state.highlighted=state.highlighted===c.k ? null : c.k; refreshKept();
        });
        const td=()=>{ const cell=document.createElement('td'); tr.appendChild(cell); return cell; };
        // Columns: Keep / Remove (under Clear all), colour, then the legend
        // (the first two stay in view when the table scrolls).
        // Keep for the current scan, Remove for kept ones.
        const act=td();
        const btn=document.createElement('button'); btn.type='button';
        if(c.current){ btn.textContent='+ Keep'; btn.addEventListener('click',keepScan); }
        else{ btn.textContent='Remove'; btn.addEventListener('click',()=>{ if(state.highlighted===c.k) state.highlighted=null; fns.kept.splice(Number(c.tag)-1,1); refreshKept(); }); }
        act.appendChild(btn);
        // Colour: a square colour picker (as in the CIF generator).
        const pick=document.createElement('input'); pick.type='color'; pick.value=hexColor(c.color);
        pick.className='convolution-color-pick';
        pick.setAttribute('aria-label','Curve colour');
        pick.addEventListener('input',()=>{ c.k.color=pick.value; drawScan(); });
        pick.addEventListener('change',()=>{ c.k.color=pick.value; refreshKept(); });
        td().appendChild(pick);
        // Legend columns (their heads: legendHead).
        const f=legendFields(c.k);
        for(const col of shownCols()){ const cell=td(); cell.className='convolution-curve-field'; cell.textContent=f[col.id]||''; }
        return tr;
      }));
    }
    $('convCurveEmpty').hidden=curves.length>0;
    if(state.highlighted && !curves.some(c=>c.k===state.highlighted)) state.highlighted=null;
    updateKeepButtons(); drawScan();
    if(!state.restoringResults) fns.store1D();
  }
  Object.assign(fns,{parseNum, SCAN_IDS, scanPoints, calculate1D, clearCurrentScan, AXIS_NAMES, PALETTE, normalized, log1D, curveMax, scanTrace, curveList, legendShown, shownCols, optionOf, LEGEND_LOOKUP, legendFields, legendText, logRange, scanFigure, drawScan, saveScanFigure, updateKeepButtons, keepScan, hexColor, legendHead, refreshKept});
}
