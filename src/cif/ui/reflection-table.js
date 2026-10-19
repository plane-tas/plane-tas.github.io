// Combined nuclear + magnetic reflections (FullProf-like).
//   Table: one row per hkl (single crystal), I = (|F_N|^2 + |F_M|^2) × L, L = 1/sin2θ (ω scan) or 1
//   Graph: powder pattern, reflections with equal d merged,
//          I = Mult·|F|^2 / (sinθ sin2θ) — the powder Lorentz factor is always applied.
// Unpolarized neutrons: nuclear and magnetic intensities add without interference.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installReflectionTable(ctx){
  const {deps:{$, RL_calc, canonicalReflectionHkl, clamp, compareHkl, getSelectedCifFileName, hklKey, hklToQ, norm, rad2deg},
    state:cifState, fn}=ctx;
  Object.assign(fn,{
    clearCifReflectionRowSelection, downloadCifReflectionTable, initializeReflectionTable,
    renderCifReflectionTable, renderReflectionPowderPlot, setCifReflectionSort, setReflectionData,
    updateCifReflectionSortHeaders
  });

const MAX_RENDERED_ROWS=3000;
const roundKey=hkl=>hkl.map(v=>Number(Number(v).toFixed(6))+0).join(',');
cifState.reflectionData=null;

// ---- Build per-hkl rows from the nuclear families and magnetic peaks ----
function setReflectionData({nuclear=null,magnetic=null,notes=[],wavelength=null,incommensurate=false,plotRange=null}={}){
  const byKey=new Map();
  const nuclearLattice=nuclear?.lattice||null;
  (nuclear?.families||[]).forEach((family,familyIndex)=>{
    const fn2=Number(family.intensity)/100; // fm^2 -> barn
    const star=family.star||[family.hkl];
    for(const hkl of star){
      byKey.set(roundKey(hkl),{hkl:[...hkl],fn2,fm2:0,formFactor:'',formFactorSort:0,
        twoTheta:family.twoTheta,q:family.q,d:family.d,family:familyIndex,familySize:star.length});
    }
  });
  const magneticRows=magnetic?.rows||[];
  // Use the nuclear (Sample) lattice for positions whenever hkl are in the parent cell.
  const rl=nuclearLattice && magnetic?.parentKnown!==false ? RL_calc(nuclearLattice) : null;
  const lambdaForPositions=nuclear?.wavelength||Number(wavelength);
  for(const m of magneticRows){
    const key=roundKey(m.hkl);
    let row=byKey.get(key);
    if(!row){
      row={hkl:[...m.hkl],fn2:0,twoTheta:m.twoTheta,q:m.q,d:m.d};
      if(rl && lambdaForPositions>0){
        const q=norm(hklToQ(rl,m.hkl)),arg=q*lambdaForPositions/(4*Math.PI);
        if(q>0 && arg<=1){ row.q=q; row.d=2*Math.PI/q; row.twoTheta=2*rad2deg(Math.asin(clamp(arg,-1,1))); }
      }
      byKey.set(key,row);
    }
    row.fm2=m.fm2; row.formFactor=m.formFactor; row.formFactorSort=m.formFactorSort;
  }
  const rows=[...byKey.values()].map(r=>({...r,
    fm2:r.fm2||0,formFactor:r.formFactor||'',formFactorSort:r.formFactorSort||0,
    code:r.fn2>0&&r.fm2>0?'N+M':r.fm2>0?'M':'N'}));
  const parentKnown=magnetic?.parentKnown!==false;
  cifState.reflectionData={rows,parentKnown,incommensurate:!!incommensurate,plotRange,wavelength:Number(wavelength)||nuclear?.wavelength||null,
    lattice:parentKnown ? (nuclearLattice||magnetic?.lattice) : magnetic?.lattice,
    notes:notes.filter(Boolean)};
  cifState.lastGeneratedReflections=rows;
  renderCifReflectionTable();
}

// ---- Display options ----
const mode=()=>$('reflectionMode')?.value==='graph'?'graph':'table';
// "within instrument 2θ max": display limit (rows are calculated to 180°).
function displayTwoThetaMax(){
  const max=Number(cifState.reflectionData?.plotRange?.max);
  return fn.currentCifReflectionFilters().withinS2Max && Number.isFinite(max) && max>0 ? Math.min(180,max) : 180;
}
// The powder pattern always includes the powder Lorentz factor.
const lorentzOn=()=>mode()==='graph' || $('reflectionLorentz')?.value!=='off';
const codeFilter=()=>{
  if(cifState.reflectionData?.incommensurate) return 'N';
  const v=$('reflectionCodeFilter')?.value; return v==='N'||v==='M'?v:'all';
};
const sin=deg=>Math.sin(deg*Math.PI/180);
function lorentzFactor(twoTheta){
  if(mode()==='graph') return 1/Math.max(1e-9,sin(twoTheta/2)*sin(twoTheta));
  return lorentzOn() ? 1/Math.max(1e-9,sin(twoTheta)) : 1;
}
function displayRows(){
  const data=cifState.reflectionData;
  if(!data) return [];
  const want=codeFilter();
  const tthMax=displayTwoThetaMax();
  let rows=data.rows.filter(r=>(want==='all' || r.code.includes(want)) && !(r.twoTheta>tthMax+1e-9));
  if(mode()==='table'){
    const filters=fn.currentCifReflectionFilters();
    if(data.lattice && (filters.alongU||filters.alongV)){
      const rl=RL_calc(data.lattice);
      rows=rows.filter(r=>fn.hklPassesDirectionFilter(rl,r.hkl,filters));
    }
    // Nuclear-only reflections of one symmetry family are shown once with their
    // multiplicity (as before). Reflections with a magnetic part are listed
    // individually (Mult 1): magnetic order can lower the symmetry.
    const out=[],families=new Map();
    for(const r of rows){
      if(r.fm2>0 || !Number.isInteger(r.family)){ out.push(r); continue; }
      if(!families.has(r.family)) families.set(r.family,[]);
      families.get(r.family).push(r);
    }
    const single=r=>{ const L=lorentzFactor(r.twoTheta);
      return {...r,key:hklKey(r.hkl),mult:1,lorentz:L,intensity:(r.fn2+r.fm2)*L,members:[r.hkl]}; };
    const result=out.map(single);
    for(const list of families.values()){
      const members=list.map(r=>r.hkl),hkl=canonicalReflectionHkl(members),first=list[0];
      const L=lorentzFactor(first.twoTheta);
      result.push({...first,hkl,key:hklKey(hkl),mult:first.familySize,lorentz:L,
        intensity:first.fn2*L,members});
    }
    return result;
  }
  return powderGroups(rows);
}
// Powder: merge reflections with the same d (symmetry equivalents and accidental overlaps).
// fn2/fm2 are averages per reflection, so Mult·fn2 is the summed nuclear part.
function powderGroups(rows){
  const groups=new Map();
  for(const r of rows){
    const key=r.d.toFixed(5);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(list=>{
    const mult=list.length;
    const fn2=list.reduce((s,r)=>s+r.fn2,0)/mult, fm2=list.reduce((s,r)=>s+r.fm2,0)/mult;
    const members=list.map(r=>r.hkl);
    const hkl=canonicalReflectionHkl(members);
    const first=list[0],withFF=list.find(r=>r.formFactor);
    const L=lorentzFactor(first.twoTheta);
    return {hkl,key:hklKey(hkl),members,mult,fn2,fm2,
      code:fn2>0&&fm2>0?'N+M':fm2>0?'M':'N',
      formFactor:withFF?.formFactor||'',formFactorSort:withFF?.formFactorSort||0,
      twoTheta:first.twoTheta,q:first.q,d:first.d,lorentz:L,intensity:mult*(fn2+fm2)*L};
  });
}

// ---- Columns ----
function columns(){
  const powder=mode()==='graph';
  const cell=cifState.reflectionData?.parentKnown===false?' (magnetic cell)':'';
  const iTitle=lorentzOn()
    ? (powder?'I = Mult·(|F_N|²+|F_M|²)/(sinθ sin2θ)':'I = (|F_N|²+|F_M|²)/sin2θ')
    : (powder?'I = Mult·(|F_N|²+|F_M|²)':'I = |F_N|²+|F_M|²');
  return [
    {key:'hkl',label:`h k l${cell}`,text:r=>`(${r.hkl.map(v=>Number(Number(v).toFixed(6))).join(' ')})`},
    {key:'code',label:'Code',text:r=>r.code},
    {key:'mult',label:'Mult',sort:true,text:r=>String(r.mult)},
    {key:'fn2',label:'|F<sub>N</sub>|² (barn)',sort:true,text:r=>numberText(r.fn2)},
    {key:'fm2',label:'|F<sub>M</sub>|² (barn)',sort:true,text:r=>numberText(r.fm2)},
    {key:'formFactorSort',label:'f(Q)',sort:true,text:r=>r.formFactor||'—'},
    {key:'intensity',label:'I',title:iTitle,sort:true,text:r=>numberText(r.intensity)},
    {key:'twoTheta',label:'2θ (deg)',sort:true,text:r=>numberText(r.twoTheta,4)},
    {key:'q',label:'Q (Å⁻¹)',sort:true,text:r=>numberText(r.q,5)},
    {key:'d',label:'d (Å)',sort:true,text:r=>numberText(r.d,5)}
  ];
}
function numberText(value,digits=5){
  const x=Number(value);
  if(!Number.isFinite(x)) return '—';
  if(x===0) return '0';
  const a=Math.abs(x);
  if(a>=1e5 || a<1e-4) return x.toExponential(4);
  return x.toFixed(digits);
}

// ---- Sorting ----
const SORT_DESC_FIRST=new Set(['intensity','fn2','fm2','mult','q','formFactorSort']);
function sortedRows(rows){
  const {key,direction}=cifState.cifReflectionSort||{key:'intensity',direction:'desc'};
  const dir=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>((Number(a[key])||0)-(Number(b[key])||0))*dir || compareHkl(a.hkl,b.hkl));
}
function setCifReflectionSort(key){
  const cur=cifState.cifReflectionSort;
  cifState.cifReflectionSort=cur?.key===key
    ? {key,direction:cur.direction==='asc'?'desc':'asc'}
    : {key,direction:SORT_DESC_FIRST.has(key)?'desc':'asc'};
  renderCifReflectionTable();
}
function updateCifReflectionSortHeaders(){
  for(const th of document.querySelectorAll('#cifReflectionHead th[data-sort-key]')){
    const active=th.dataset.sortKey===cifState.cifReflectionSort?.key;
    const indicator=th.querySelector('.cif-sort-indicator');
    if(indicator) indicator.textContent=active?(cifState.cifReflectionSort.direction==='asc'?'▲':'▼'):'';
    th.setAttribute('aria-sort',active?(cifState.cifReflectionSort.direction==='asc'?'ascending':'descending'):'none');
  }
}

// ---- Rendering ----
function renderHead(cols){
  const head=$('cifReflectionHead'); if(!head) return;
  const tr=document.createElement('tr');
  for(const c of cols){
    const th=document.createElement('th');
    th.innerHTML=c.label;
    if(c.title) th.title=c.title;
    if(c.sort){
      th.dataset.sortKey=c.key; th.className='cif-sortable-th'; th.tabIndex=0; th.setAttribute('role','button');
      const ind=document.createElement('span'); ind.className='cif-sort-indicator';
      th.append(' ',ind);
    }
    tr.appendChild(th);
  }
  head.replaceChildren(tr);
  updateCifReflectionSortHeaders();
}
function updateOptionLabels(){
  const graph=mode()==='graph';
  const lorentz=$('reflectionLorentz');
  if(lorentz){
    // Table (single crystal, ω scan): L = 1/sin2θ or 1.
    // Graph (powder): L = 1/(2 sin²θ cosθ) = 1/(sinθ sin2θ), always applied.
    lorentz.disabled=graph;
    const on=lorentz.querySelector('option[value="on"]');
    if(on) on.textContent=graph?'1/(2 sin²θ cosθ)':'1/sin 2θ';
    if(graph){ if(lorentz.dataset.tableValue===undefined) lorentz.dataset.tableValue=lorentz.value; lorentz.value='on'; }
    else if(lorentz.dataset.tableValue!==undefined){ lorentz.value=lorentz.dataset.tableValue; delete lorentz.dataset.tableValue; }
    lorentz.title=graph?'Powder: L = 1/(2 sin²θ cosθ), always applied':'Single crystal ω scan: L = 1/sin 2θ (or 1 = none)';
  }
  // along U / V and Download table belong to the single-crystal table only.
  for(const id of ['cifReflectionAlongU','cifReflectionAlongV']){ const el=$(id); if(el) el.closest('label')?.classList.toggle('hidden',graph); }
  $('cifDownloadTable')?.classList.toggle('hidden',graph);
  // Incommensurate mCIF: only nuclear reflections can be calculated.
  const filter=$('reflectionCodeFilter'),inc=!!cifState.reflectionData?.incommensurate;
  if(filter){
    for(const option of filter.options) option.disabled=inc && option.value!=='N';
    if(inc && filter.value!=='N'){ filter.dataset.beforeIncommensurate=filter.value; filter.value='N'; }
    else if(!inc && filter.dataset.beforeIncommensurate){ filter.value=filter.dataset.beforeIncommensurate; delete filter.dataset.beforeIncommensurate; }
  }
  // The graph overlays N + M, N and M, so the Reflections selector is table-only.
  $('reflectionCodeFilter')?.closest('label')?.classList.toggle('hidden',graph);
  $('cifReflectionTableWrap')?.classList.toggle('hidden',graph);
  for(const tab of document.querySelectorAll('#generatorReflectionsPane [data-reflection-view]')){
    const on=tab.dataset.reflectionView===mode();
    tab.classList.toggle('active',on); tab.setAttribute('aria-selected',String(on));
  }
}
function setMessage(text){
  const el=$('cifReflectionMessage'); if(!el) return;
  el.textContent=text||''; el.hidden=!text;
}
function renderCifReflectionTable(){
  const body=$('cifReflectionRows'); if(!body) return;
  updateOptionLabels();
  const cols=columns();
  renderHead(cols);
  const data=cifState.reflectionData;
  const all=sortedRows(displayRows());
  const rows=all.slice(0,MAX_RENDERED_ROWS);
  const notes=[...(data?.notes||[])];
  if(all.length>rows.length) notes.push(`Showing the first ${MAX_RENDERED_ROWS} of ${all.length} reflections (Download table contains all).`);
  setMessage(notes.join(' '));
  if($('cifDownloadTable')) $('cifDownloadTable').disabled=!all.length;
  renderReflectionPowderPlot();
  body.replaceChildren();
  if(!rows.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=cols.length; td.className='cif-reflection-empty';
    td.textContent=data?'No reflections in the selected range.':'No reflections available.';
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  if(cifState.selectedCifReflectionKey && !rows.some(r=>r.key===cifState.selectedCifReflectionKey)) cifState.selectedCifReflectionKey='';
  const frag=document.createDocumentFragment();
  for(const r of rows){
    const tr=document.createElement('tr');
    tr.dataset.reflectionKey=r.key;
    tr.tabIndex=0;
    const selected=r.key===cifState.selectedCifReflectionKey;
    tr.classList.toggle('cif-reflection-selected',selected);
    tr.setAttribute('aria-selected',String(selected));
    if(r.members.length>1) tr.title=r.members.map(h=>`(${h.map(v=>Number(Number(v).toFixed(6))).join(' ')})`).join(' ');
    for(const c of cols){ const td=document.createElement('td'); td.textContent=c.text(r); tr.appendChild(td); }
    frag.appendChild(tr);
  }
  body.appendChild(frag);
}
function toggleRowSelection(tr){
  const key=tr?.dataset.reflectionKey; if(!key) return;
  cifState.selectedCifReflectionKey=cifState.selectedCifReflectionKey===key?'':key;
  for(const row of $('cifReflectionRows')?.querySelectorAll('tr[data-reflection-key]')||[]){
    const on=row.dataset.reflectionKey===cifState.selectedCifReflectionKey;
    row.classList.toggle('cif-reflection-selected',on);
    row.setAttribute('aria-selected',String(on));
  }
}
function clearCifReflectionRowSelection(){
  if(!cifState.selectedCifReflectionKey) return;
  cifState.selectedCifReflectionKey='';
  for(const row of document.querySelectorAll('#cifReflectionRows tr.cif-reflection-selected')){
    row.classList.remove('cif-reflection-selected');
    row.setAttribute('aria-selected','false');
  }
}

// ---- Powder pattern (Gaussian peaks of constant FWHM in 2θ) ----
const plotAxis=()=>{ const v=$('reflectionPlotXAxis')?.value; return v==='q'||v==='d'?v:'twoTheta'; };
const plotLog=()=>!!$('reflectionPlotLog')?.checked;
function renderReflectionPowderPlot(){
  const section=$('reflectionPowderSection'),plot=$('reflectionPowderPlot');
  if(!section||!plot) return;
  const show=mode()==='graph';
  section.hidden=!show;
  if(!show || !window.Plotly || plot.closest('.hidden')) return;
  const data=cifState.reflectionData,lambda=Number(data?.wavelength);
  const incommensurate=!!data?.incommensurate;
  const groups=data&&lambda>0 ? powderGroups(data.rows) : [];
  const peaks=groups.map(g=>{
    const L=lorentzFactor(g.twoTheta);
    const In=g.mult*g.fn2*L, Im=incommensurate?0:g.mult*g.fm2*L;
    return {...g,In,Im,area:In+Im};
  }).filter(g=>g.area>0);
  if(!peaks.length){ window.Plotly.purge(plot); plot.textContent='No powder reflections to plot.'; return; }
  if(plot.textContent && !plot._fullLayout) plot.textContent='';
  let H=Number($('reflectionPlotFwhm')?.value);
  if(!(H>0)) H=0.3;
  // Display range: instrument S2 min to effective S2 max when "within
  // instrument 2θ max" is ticked, otherwise up to 180°.
  const range=data.plotRange, within=fn.currentCifReflectionFilters().withinS2Max;
  const tMaxPeaks=Math.max(...peaks.map(p=>p.twoTheta));
  const t0=within && Number.isFinite(range?.min)&&range.min>0 ? range.min : Math.max(0.2,Math.min(...peaks.map(p=>p.twoTheta))-5*H);
  const t1=within && Number.isFinite(range?.max)&&range.max>t0 ? Math.min(179.9,range.max) : Math.min(179.9,tMaxPeaks+5*H);
  const inRange=p=>p.twoTheta>=t0-1e-9&&p.twoTheta<=t1+1e-9;
  const step=Math.max(H/12,(t1-t0)/20000);
  const tth=[];for(let t=t0;t<=t1+1e-9;t+=step) tth.push(t);
  const c=4*Math.LN2/(H*H),norm=2*Math.sqrt(Math.LN2/Math.PI)/H;
  const pattern=key=>{
    const y=new Array(tth.length).fill(0);
    for(const p of peaks){
      const area=p[key]; if(!(area>0)) continue;
      const i0=Math.max(0,Math.floor((p.twoTheta-5*H-t0)/step)),i1=Math.min(tth.length-1,Math.ceil((p.twoTheta+5*H-t0)/step));
      for(let i=i0;i<=i1;i++){ const dx=tth[i]-p.twoTheta; y[i]+=area*norm*Math.exp(-c*dx*dx); }
    }
    return y;
  };
  const yN=pattern('In'), yM=pattern('Im'), yT=yN.map((v,i)=>v+yM[i]);
  const hasM=yM.some(v=>v>0), hasN=yN.some(v=>v>0);
  const axis=plotAxis();
  const conv=t=>{ const s=Math.sin(t*Math.PI/360); return axis==='q'?4*Math.PI*s/lambda:axis==='d'?lambda/(2*s):t; };
  const xTitle=axis==='q'?'Q (Å⁻¹)':axis==='d'?'d (Å)':'2θ (deg)';
  const yMax=Math.max(...yT)||1;
  // Log axis: zero intensity is drawn on the bottom of the axis (baseline),
  // four decades below the strongest peak.
  const log=plotLog(), floor=yMax*1e-4;
  const shown=y=>log ? y.map(v=>Math.max(v,floor)) : y;
  const xs=tth.map(conv);
  const hkl=h=>`(${h.map(v=>Number(Number(v).toFixed(4))).join(' ')})`;
  const hover=label=>`${xTitle.split(' ')[0]} = %{x:.4f}<br>${label} = %{y:.4g}<extra></extra>`;
  // Patterns: total (N + M), nuclear and magnetic, overlaid.
  const traces=[];
  if(hasN && hasM) traces.push({x:xs,y:shown(yT),type:'scatter',mode:'lines',name:'N + M',line:{width:2,color:'#1f4e8c'},hovertemplate:hover('I')});
  if(hasN) traces.push({x:xs,y:shown(yN),type:'scatter',mode:'lines',name:'N',line:{width:1.4,color:'#2e7d32'},hovertemplate:hover('I_N')});
  if(hasM) traces.push({x:xs,y:shown(yM),type:'scatter',mode:'lines',name:'M',line:{width:1.4,color:'#c62828'},hovertemplate:hover('I_M')});
  // Peak ticks in a strip below the pattern (works for linear and log axes).
  // Hover: indices, multiplicity and the position on the selected x axis.
  const xLabel=axis==='q'?'Q':axis==='d'?'d':'2θ', xUnit=axis==='q'?' Å⁻¹':axis==='d'?' Å':'°';
  const tick=(list,level,name,color)=>({x:list.map(p=>conv(p.twoTheta)),y:list.map(()=>level),yaxis:'y2',
    type:'scatter',mode:'markers',name,showlegend:false,marker:{symbol:'line-ns-open',size:12,color,line:{width:1.5,color}},
    customdata:list.map(p=>[hkl(p.hkl),p.mult]),
    hovertemplate:`${name.split(' ')[0]} %{customdata[0]}<br>Mult %{customdata[1]}<br>${xLabel} = %{x:.4f}${xUnit}<extra></extra>`});
  const tickN=peaks.filter(p=>p.In>0&&inRange(p)), tickM=peaks.filter(p=>p.Im>0&&inRange(p));
  if(tickN.length) traces.push(tick(tickN,tickM.length?0.7:0.5,'Nuclear peaks','#2e7d32'));
  if(tickM.length) traces.push(tick(tickM,tickN.length?0.3:0.5,'Magnetic peaks','#c62828'));
  // View restored by a double-click (the current calculation's range).
  const xView=axis==='d' ? null : [0,conv(t1)];
  const yView=log ? [Math.log10(floor),Math.log10(yMax*1.6)] : [0,1.05*yMax];
  // Copies go into the layout: Plotly mutates layout range arrays when zooming.
  plot.__tasPowderView={x:xView,y:yView};
  // Major grid darker, minor grid lighter (shared look).
  const grid={showgrid:true,gridcolor:'#bcc4cd',gridwidth:1,minor:{showgrid:true,gridcolor:'#e8ebee',gridwidth:1,ticks:''}};
  // Same font size for both axis titles, tick labels and the legend.
  const FONT=18;
  window.Plotly.react(plot,traces,{autosize:true,margin:{l:96,r:16,t:40,b:110},font:{size:FONT},
    // d has no finite value at 2θ = 0: autorange.
    xaxis:{title:{text:xTitle,font:{size:FONT},standoff:10},tickfont:{size:FONT},zeroline:false,showline:true,mirror:true,linecolor:'#586472',linewidth:1,...grid,
      anchor:'y2',...(xView ? {range:xView.slice()} : {autorange:true})},
    yaxis:{domain:[0.13,1],tickfont:{size:FONT},title:{text:'Intensity (arb. units)',font:{size:FONT},standoff:14},automargin:true,zeroline:false,showline:true,mirror:true,linecolor:'#586472',linewidth:1,...grid,
      type:log?'log':'linear',range:yView.slice(),...(log?{exponentformat:'power'}:{})},
    yaxis2:{domain:[0,0.1],range:[0,1],showticklabels:false,showgrid:false,zeroline:false,fixedrange:true,showline:true,mirror:true,linecolor:'#586472',linewidth:1},
    // Legend above the frame (top right); FWHM and Log sit at the same height, top left.
    // Legend below the plot (under the x-axis selector), never over peaks.
    showlegend:true,legend:{orientation:'h',xref:'paper',x:0.5,xanchor:'center',yref:'container',y:0,yanchor:'bottom',
      bgcolor:'rgba(0,0,0,0)',font:{size:FONT}},uirevision:`powder-${axis}-${log}`
  // Double-click returns to the current view (not Plotly's first-draw range
  // or its autorange, which would include the tick strip and the log baseline).
  },{responsive:true,displaylogo:false,doubleClick:false});
  if(!plot.__tasPowderDoubleClick){
    plot.__tasPowderDoubleClick=true;
    // The event fires before Plotly's own handling: apply the view afterwards.
    plot.on('plotly_doubleclick',()=>requestAnimationFrame(()=>{
      const view=plot.__tasPowderView; if(!view || !plot.isConnected) return;
      window.Plotly.relayout(plot,{...(view.x?{'xaxis.range':view.x.slice(),'xaxis.autorange':false}:{'xaxis.autorange':true}),
        'yaxis.range':view.y.slice(),'yaxis.autorange':false});
    }));
  }
}

// ---- CSV ----
function downloadCifReflectionTable(){
  const rows=sortedRows(displayRows());
  if(!rows.length) throw new Error('No reflections are available to download.');
  const powder=mode()==='graph';
  const cell=cifState.reflectionData?.parentKnown===false?'magnetic':'parent';
  const lorentz=lorentzOn()?(powder?'1/(2*sin(theta)^2*cos(theta))':'1/sin(2theta)'):'1';
  const header=['h','k','l','code',...(powder?['multiplicity']:[]),
    `FN2_barn_per_${cell}_cell`,`FM2_barn_per_${cell}_cell`,'form_factor',
    powder?'I=Mult*(FN2+FM2)*L':'I=(FN2+FM2)*L',`L=${lorentz}`,'two_theta_deg','Q_inv_A','d_A',
    ...(powder?['equivalent_hkl']:[])];
  const quote=v=>`"${String(v).replace(/"/g,'""')}"`;
  const lines=[header.map(h=>/[,=*/()]/.test(h)?quote(h):h).join(','),
    ...rows.map(r=>[...r.hkl,r.code,...(powder?[r.mult]:[]),r.fn2,r.fm2,quote(r.formFactor||''),
      r.intensity,r.lorentz,r.twoTheta,r.q,r.d,
      ...(powder?[quote(r.members.map(h=>h.join(' ')).join('; '))]:[])].join(','))];
  const source=fn.nuclearReflectionSource?.();
  const base=fn.cleanCifBaseName(source?.fileName||getSelectedCifFileName?.()||'selected_structure.cif');
  fn.downloadGeneratedCif(lines.join('\n'),`${base}_reflections_${powder?'powder':'single_crystal'}.csv`);
}

function initializeReflectionTable(){
  const head=$('cifReflectionHead');
  if(!head || head.dataset.bound) return;
  head.dataset.bound='1';
  const activate=ev=>{
    const th=ev.target?.closest?.('th[data-sort-key]'); if(!th) return;
    if(ev.type==='keydown'){ if(ev.key!=='Enter'&&ev.key!==' ') return; ev.preventDefault(); }
    setCifReflectionSort(th.dataset.sortKey);
  };
  head.addEventListener('click',activate);
  head.addEventListener('keydown',activate);
  const body=$('cifReflectionRows');
  body?.addEventListener('click',ev=>toggleRowSelection(ev.target?.closest?.('tr')));
  body?.addEventListener('keydown',ev=>{
    if(ev.key!=='Enter'&&ev.key!==' ') return;
    const tr=ev.target?.closest?.('tr'); if(!tr?.dataset.reflectionKey) return;
    ev.preventDefault(); toggleRowSelection(tr);
  });
  for(const id of ['reflectionMode','reflectionLorentz','reflectionCodeFilter']){
    $(id)?.addEventListener('change',renderCifReflectionTable);
  }
  // Plot controls: x axis, FWHM and log intensity.
  $('reflectionPlotXAxis')?.addEventListener('change',renderReflectionPowderPlot);
  $('reflectionPlotLog')?.addEventListener('change',renderReflectionPowderPlot);
  // Table / Graph view tabs drive the (hidden) Mode selector.
  for(const tab of document.querySelectorAll('#generatorReflectionsPane [data-reflection-view]')){
    tab.addEventListener('click',()=>{
      const sel=$('reflectionMode'); if(!sel || sel.value===tab.dataset.reflectionView) return;
      sel.value=tab.dataset.reflectionView;
      sel.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }
  $('reflectionPlotFwhm')?.addEventListener('input',renderReflectionPowderPlot);
  if(!window.Plotly) window.addEventListener('load',()=>renderReflectionPowderPlot(),{once:true});
  renderCifReflectionTable();
}
}
