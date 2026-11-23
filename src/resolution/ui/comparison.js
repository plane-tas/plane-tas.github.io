import {syncCsvNameTemplate} from '../../core/csv-name.js';
import {inferOrthogonalInPlaneHKL} from '../resolution-core.js';
import {selectedTasSense} from '../../app/dom-utils.js';
import {downloadBlob, downloadText} from '../../core/download.js';
// Resolution: comparison of kept single-point results.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
//
// In Mode = single, the result is shown here only: the kept results and the
// current one (last calculated) in a table (Show: condition = instrument,
// point, monochromator / analyzer, collimations; resolution = widths;
// R matrix = the matrix in Q∥, Q⊥in, E, Q⊥out), beside the overlaid
// ellipses, one colour per result, the current one in black (solid:
// incoherent = projection, dashed: coherent = slice).  Mode = scan uses the
// same table and plots with one row per scan point (colours along the scan)
// and Graph: slider (one point, chosen with the slider or a row click) or
// overwrite (all points; a row click highlights one).  "+ Keep" in the current row keeps
// it, "Remove" / "Clear all" remove kept ones; clicking a kept row highlights
// it.  Results of different instruments can be compared; the unit and coordinates
// must be the same.  Kept results live for the session.
export function installResolutionComparison(ctx){
  const {deps:{$}, state:shared, fn}=ctx;
  // Axes of the selected Coordinates before there is a result (from U, V and
  // the lattice): U, U⊥in, W / U, V, W as (h, k, l); Q∥, Q⊥ follow the point
  // ('Q', 'Q⊥'), W is known.
  // Q∥, Q⊥in, Q⊥out are named, not given as (h, k, l) (they follow the point).
  const Q_FRAME_AXES={U:'δQ∥',V:'δQ⊥in',W:'δQ⊥out'};
  function predictedAxes(){
    try{
      const {lc,rl}=fn.buildResolutionLattice(), c=fn.resolutionCoordinates();
      if(c==='q') return Q_FRAME_AXES;
      if(c==='lattice') return {U:lc.sv1,V:lc.sv2,W:lc.sv3};
      return {U:lc.sv1,V:inferOrthogonalInPlaneHKL(rl,lc.sv1,lc.sv2),W:lc.sv3};
    }catch(_e){ return {U:'δQ U',V:'δQ V',W:'δQ W'}; }
  }
  Object.assign(fn,{renderResolutionComparison, updateResolutionKeepState});

  // Colours of kept results: ten distinct ones, then further hues (any number
  // of results can be kept; the table scrolls).
  const COLORS=['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf','#8c564b','#e377c2','#bcbd22','#7f7f7f'];
  const extraColor=n=>{ const h=(n*137.508)%360, l=0.45, a=0.6*Math.min(l,1-l);
    const f=k=>{ const t=(k+h/30)%12; return Math.round(255*(l-a*Math.max(-1,Math.min(t-3,9-t,1)))).toString(16).padStart(2,'0'); };
    return `#${f(0)}${f(8)}${f(4)}`; };
  const PLOT_IDS={UE:'plotCmpUE',VE:'plotCmpVE',UV:'plotCmpUV',WE:'plotCmpWE'};
  shared.keptResolutions=[];
  let selectedId=null, nextId=1, view='';

  const singleMode=()=>$('calcMode')?.value!=='scan';
  // All kept results share the unit and coordinates of the first one; they are
  // shown in that unit / frame whatever the current selection is.
  const COORD_NAMES={q:'Q∥, Q⊥in, E, Q⊥out',lattice:'U, V, E, W'};
  const unitName=u=>u==='rlu'?'r.l.u.':'Å⁻¹';
  const frameFor=(r,c)=>c==='lattice'&&r?.lattice ? r.lattice : c==='q'&&r?.qframe ? r.qframe : r;
  const keptSetting=()=>shared.keptResolutions.length ? {unit:shared.keptResolutions[0].unit,coords:shared.keptResolutions[0].coords} : null;
  const CURRENT_COLOR='#111';
  // Condition of a result, in four compact columns:
  //   point "(1,0,0)\nħω=0 meV"
  //   mono  "PG(002), Ei=4.8 meV\nH: 30′, flat (1)\nV: 30′, focusing (7)" (mosaic, blades), ana (same, with Ef)
  //   col   "H: 40-999-244(R)-999,\nV: 120-120-120-120"
  // ((R): radial 3rd collimator, the value being its equivalent divergence;
  // SM(m): supermirror guide of m-value m).
  // One H or V line: "30′, flat (1)" — mosaic (arcmin), focusing (blades).
  const focusText=(check,blades,mosaic)=>{
    const n=String($(blades)?.value??'').trim()||'?', m=String($(mosaic)?.value??'').trim()||'?';
    return `${m}′, ${$(check)?.checked ? 'focusing' : 'flat'} (${n})`;
  };
  const pointCell=calc=>{ const f=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(4))) : String(v); }; return calc ? `(${f(calc.h)},${f(calc.k)},${f(calc.l)})\nħω=${f(calc.hw)} meV` : ''; };
  // Sense: all three signs (monochromator / sample / analyzer).
  const senseText=()=>selectedTasSense();
  const crystalText=id=>{ const el=$(id); return el?.selectedOptions?.[0]?.text || el?.value || '?'; };
  const energyText=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(3))) : '?'; };
  const currentCondition=(entry)=>{
    const value=id=>{ const raw=String($(id)?.value??'').trim(); return raw==='' ? 'blank' : raw; };
    const sm=$('gm1')?.checked ? `SM(${value('div1m')})` : null;
    const c3=entry?.result?.collimation3?.radial
      ? `${Number.isFinite(entry.result.collimation3.fwhmArcmin) ? Math.round(entry.result.collimation3.fwhmArcmin) : '?'}(R)` : value('div3h');
    const en=entry?.result?.energies||{};
    const f=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(4))) : String(v); };
    const calc=entry?.calc||{};
    return {
      // Inst.: name and Sense (mono / sample / analyzer) on two lines.
      inst:`${currentInstrumentName()}\n${senseText()}`,
      point:`(${f(calc.h)},${f(calc.k)},${f(calc.l)})\nħω=${f(calc.hw)} meV`,
      mono:`${crystalText('monoCrystal')}, Ei=${energyText(en.Ei)} meV\nH: ${focusText('monoHF','monoHB','mosMonoH')}\nV: ${focusText('monoVF','monoVB','mosMonoV')}`,
      ana:`${crystalText('anaCrystal')}, Ef=${energyText(en.Ef)} meV\nH: ${focusText('anaHF','anaHB','mosAnaH')}\nV: ${focusText('anaVF','anaVB','mosAnaV')}`,
      col:`H: ${[sm||value('div1h'),value('div2h'),c3,value('div4h')].join('-')}\nV: ${[sm||value('div1v'),value('div2v'),value('div3v'),value('div4v')].join('-')}`
    };
  };
  // The same condition, one value per field (Save CSV).
  const conditionFields=entry=>{
    const raw=id=>{ const v=String($(id)?.value??'').trim(); return v==='' ? 'blank' : v; };
    const focus=(check,blades,mosaic)=>({mosaic:raw(mosaic),focus:$(check)?.checked ? 'focusing' : 'flat',blades:raw(blades)});
    const sm=$('gm1')?.checked ? `SM(${raw('div1m')})` : null;
    const c3=entry?.result?.collimation3?.radial
      ? `${Number.isFinite(entry.result.collimation3.fwhmArcmin) ? Math.round(entry.result.collimation3.fwhmArcmin) : '?'}(R)` : raw('div3h');
    const en=entry?.result?.energies||{};
    return {
      instrument:currentInstrumentName(), sense:senseText(), approximation:$('method')?.value||'',
      h:entry.calc.h, k:entry.calc.k, l:entry.calc.l, hw:entry.calc.hw, Ei:en.Ei, Ef:en.Ef,
      mono:{crystal:crystalText('monoCrystal'),H:focus('monoHF','monoHB','mosMonoH'),V:focus('monoVF','monoVB','mosMonoV')},
      ana:{crystal:crystalText('anaCrystal'),H:focus('anaHF','anaHB','mosAnaH'),V:focus('anaVF','anaVB','mosAnaV')},
      colH:[sm||raw('div1h'),raw('div2h'),c3,raw('div4h')], colV:[sm||raw('div1v'),raw('div2v'),raw('div3v'),raw('div4v')]
    };
  };
  // Instrument of a result (shown in the table): the preset name without the
  // site after @, with the setting when the instrument has several.
  const currentInstrumentName=()=>{ const sel=$('instrument'); const t=$('instrumentType'); return `${(sel?.selectedOptions?.[0]?.text||sel?.value||'').replace(/\s*@.*$/,'')}${t && t.options.length>1 ? ` (${t.selectedOptions?.[0]?.text||t.value})` : ''}`; };
  const conditionDetail=entry=>{
    const {result:r,calc}=entry, f=v=>Number(v).toFixed(3);
    return `${$('method')?.value||''}; Ei=${f(r.energies.Ei)} meV, Ef=${f(r.energies.Ef)} meV; `+
      `(h,k,l)=(${f(calc.h)}, ${f(calc.k)}, ${f(calc.l)}), ħω=${f(calc.hw)} meV`;
  };

  // The current (last calculated) result, when it can be kept: single mode,
  // not failed, not kept already.
  function currentResult(){
    const last=shared.lastResolutionRender;
    if(!singleMode() || !last || last.scan || !last.entry || last.entry.failed) return null;
    if(shared.keptResolutions.some(k=>k.entry===last.entry)) return null;
    return last.entry;
  }
  // Condition, instrument and frame of the current result, taken when it is
  // calculated (the controls may change afterwards).
  let currentInfo=null, currentFail=null;
  // A serial number per calculated result (to tell a new current result).
  const serials=new WeakMap(); let nextSerial=1;
  const entrySerial=e=>{ if(!e) return 0; if(!serials.has(e)) serials.set(e,nextSerial++); return serials.get(e); };
  // What tells two results apart: instrument, condition (point, crystals,
  // focusing, mosaic, collimation), approximation and energies, frame and
  // the widths.
  function resultSig(info){
    if(!info?.entry) return '';
    if(info.sig) return info.sig;
    const d=frameFor(info.entry.result,info.coords).display||{};
    const w=['U','V','W','E','Ucoh','Vcoh','Wcoh','Ecoh'].map(k=>Number(d[k]).toPrecision(6));
    return JSON.stringify([info.instrumentName,info.condition,info.detail,info.unit,info.coords,w]);
  }
  // Unit, Coordinates and U–V plot are fixed while results are kept: kept
  // results are compared in one frame.  Clear all frees them.
  const FRAME_CONTROLS=['resolutionCoordinates'];
  const LOCK_TITLE='Fixed while results are kept in Comparison (Clear all to change)';
  function lockFrame(){
    const locked=shared.keptResolutions.length>0;
    shared.resolutionFrameLocked=locked;
    for(const id of FRAME_CONTROLS){
      const el=$(id); if(!el) continue;
      if(el.disabled!==locked){
        el.disabled=locked;
        if(locked){ el.dataset.titleFree=el.title||''; el.title=LOCK_TITLE; }
        else{ el.title=el.dataset.titleFree??el.title; }
      }
    }
    // Unit: fixed as well, and Å⁻¹ only for Q∥, Q⊥in, E, Q⊥out.
    const unit=$('unit');
    if(unit){
      unit.disabled=locked || fn.resolutionCoordinates()==='q';
      if(locked) unit.title=LOCK_TITLE; else if(unit.title===LOCK_TITLE) unit.title='';
    }
    const uv=$('resolutionUVView');
    if(uv){
      if(locked){ uv.disabled=true; uv.title=LOCK_TITLE; }
      else if(uv.title===LOCK_TITLE){ uv.title=''; fn.rerenderResolution?.(); }
    }
  }
  function updateResolutionKeepState(){
    // (Settings restored from the browser may pair Q∥ with r.l.u.)
    if(fn.resolutionCoordinates()==='q' && $('unit') && $('unit').value!=='ainv') queueMicrotask(()=>syncUnitForCoordinates());
    lockFrame();
    const entry=currentResult();
    if(entry && currentInfo?.entry!==entry)
      currentInfo={entry,condition:currentCondition(entry),fields:conditionFields(entry),detail:conditionDetail(entry),unit:entry.unitMode,coords:fn.resolutionCoordinates(),instrumentName:currentInstrumentName()};
    if(!entry) currentInfo=null;
    // The current result follows Coordinates (only a redraw; fixed anyway
    // while results are kept).
    if(currentInfo && currentInfo.coords!==fn.resolutionCoordinates()) currentInfo={...currentInfo,coords:fn.resolutionCoordinates()};
    // The current result is shown only when it differs from every kept one
    // (a recalculation of the same input, e.g. on a click elsewhere, is not
    // a new result).
    if(currentInfo && shared.keptResolutions.some(k=>k.sig===resultSig(currentInfo))) currentInfo=null;
    // A current point that cannot be calculated: its row carries the reason.
    const last=shared.lastResolutionRender;
    currentFail=singleMode() && last && !last.scan && last.entry?.failed ? last.entry : null;
    if(view!=='comparison') setView('comparison');
    syncCsvNameTemplate($('resolutionCsvName'),csvDefault());
    if($('resolutionSingleNote')) $('resolutionSingleNote').hidden=!singleMode();
    // Display (slider / overwrite): scan only, shown with the results.
    $('resolutionScanGraphWrap')?.classList.toggle('hidden',singleMode());
    // Scan, Display: slider: the slider is there from the start (disabled
    // until a scan is calculated), so nothing moves when the results come.
    const nav=$('scanNav');
    if(nav){
      nav.classList.toggle('scan-nav-off',singleMode() || scanGraph!=='slider');
      nav.classList.remove('hidden');
      const has=!singleMode() && (shared.scanResults||[]).length>0;
      for(const id of ['prev','next','scanSlider']) if($(id)) $(id).disabled=!has;
      if(!has && $('scanIndex')) $('scanIndex').textContent='– / –';
    }
    renderPointMessage();
  }
  // One line under the point entries (its space is always kept, so nothing
  // moves): why the point cannot be calculated, a warning on its angles, or
  // why it cannot be kept.
  let extraNote='';
  function renderPointMessage(){
    const el=$('resolutionPointMessage'); if(!el) return;
    const last=shared.lastResolutionRender, block=keepBlock();
    let text='', full='';
    if(!singleMode()){
      const res=shared.scanResults||[], failed=res.filter(e=>e.failed).length;
      const cur=res[(shared.scanIndex||1)-1];
      // One reason for all of them: "7 of 11 points not reachable: the
      // scattering triangle does not close."; several: see the table.
      const reasons=[...new Set(res.filter(e=>e.failed).map(e=>fn.resolutionFailText?.(e.message).sentence||''))];
      const one=reasons.length===1 ? reasons[0].match(/^Not (reachable|calculable): (.*)$/) : null;
      if(failed) text=one ? (failed===res.length ? `None of the ${res.length} points is ${one[1]}: ${one[2]}` : `${failed} of ${res.length} points not ${one[1]}: ${one[2]}`) : `${failed} of ${res.length} points not calculable (see the table).`;
      else if(scanGraph==='slider' && cur?.angles?.warning) text=`Warning: ${cur.angles.warning}`;
      el.textContent=text; el.title=text.length>60 ? text : '';
      return;
    }
    if(currentFail){ text=currentFail.message; full=currentFail.fullMessage||text; }
    else if(extraNote) text=extraNote;
    else if(singleMode() && last && !last.scan && last.entry?.angles?.warning) text=`Warning: ${last.entry.angles.warning}`;
    else if(block && block!=='no result') text=`Current result: ${block}`;
    el.textContent=text; el.title=full && full!==text ? full : (text.length>60 ? text : '');
  }
  // Why the current result cannot be kept ('' when it can).
  // Kept results (single): at most MAX_KEPT (the plots are hard to read
  // long before that).
  const MAX_KEPT=51;
  function keepBlock(){
    if(!currentInfo) return 'no result';
    if(shared.keptResolutions.length>=MAX_KEPT) return `Up to ${MAX_KEPT} kept results: remove one to keep this.`;
    const setting=keptSetting();
    if(setting && (setting.unit!==currentInfo.unit || setting.coords!==currentInfo.coords))
      return `Different unit or coordinates (kept: ${unitName(setting.unit)}, ${COORD_NAMES[setting.coords]}).`;
    return '';
  }

  function keepCurrent(){
    if(!currentInfo || keepBlock()) return;
    const used=new Set(shared.keptResolutions.map(k=>k.color));
    let color=COLORS.find(c=>!used.has(c));
    for(let n=0; !color; n++){ const c=extraColor(shared.keptResolutions.length+n); if(!used.has(c)) color=c; }
    shared.keptResolutions.push({id:nextId++,color,...currentInfo,sig:resultSig(currentInfo)});
    currentInfo=null;
    setKeepNote('');
    renderResolutionComparison();
  }

  // Mode = single: this table and plots; Mode = scan: the scan view.
  function setView(name){
    view=name==='comparison' ? 'comparison' : 'calculation';
    if($('resolutionCalculationView')) $('resolutionCalculationView').hidden=view!=='calculation';
    if($('resolutionComparisonView')) $('resolutionComparisonView').hidden=view!=='comparison';
    if(view==='comparison') requestAnimationFrame(renderResolutionComparison);
    else requestAnimationFrame(()=>{ for(const id of Object.values(shared.RESOLUTION_PLOT_IDS||{})){ const gd=$(id); if(gd?._fullLayout && window.Plotly) Plotly.Plots.resize(gd); } });
  }

  // Show: which column groups of the table (and of Save figure), kept in
  // the browser.  The buttons and colours are always there.
  const SHOW_KEY='plane-tas-resolution-compare-show';
  const SHOW_IDS={position:'resolutionShowPosition',condition:'resolutionShowCondition',widths:'resolutionShowWidths',matrix:'resolutionShowMatrix'};
  const shown=()=>Object.fromEntries(Object.entries(SHOW_IDS).map(([k,id])=>[k,!!$(id)?.checked]));
  { let saved=null; try{ saved=JSON.parse(localStorage.getItem(SHOW_KEY)||'null'); }catch(_e){}
    if(saved && typeof saved==='object') for(const [k,id] of Object.entries(SHOW_IDS)) if(typeof saved[k]==='boolean' && $(id)) $(id).checked=saved[k]; }
  for(const id of Object.values(SHOW_IDS)) $(id)?.addEventListener('change',()=>{
    try{ localStorage.setItem(SHOW_KEY,JSON.stringify(shown())); }catch(_e){}
    renderResolutionComparison();
  });

  // Resolution matrix of a result: always in Q∥, Q⊥in, E, Q⊥out (Å⁻¹ and meV, as
  // in ResLib / Takin), whatever the unit and coordinates of the widths.
  const MATRIX_AXES='Q∥, Q⊥in, E, Q⊥out';
  const matrixFor=r=>r.qframe?.RM||r.RM;
  // Four significant digits on screen (Save CSV has all of them); elements
  // that are zero to rounding are shown as 0.
  const matrixCell=M=>{
    const big=Math.max(...M.flat().map(x=>Math.abs(Number(x))||0));
    const f=x=>{ const v=Number(x); return Math.abs(v)<=big*1e-10 ? '0' : v.toExponential(3); };
    return M.map(row=>row.map(x=>f(x).padStart(10)).join('')).join('\n');
  };


  // Mode = scan.  Graph: slider (the point of the slider) or overwrite (all
  // points), kept in the browser.  Colours run along the scan.
  const SCAN_GRAPH_KEY='plane-tas-resolution-scan-graph';
  let scanGraph='slider', scanHighlight=null, scanArray=null;
  try{ if(localStorage.getItem(SCAN_GRAPH_KEY)==='overwrite') scanGraph='overwrite'; }catch(_e){}
  { const sel=$('resolutionScanGraph');
    if(sel){ sel.value=scanGraph;
      sel.addEventListener('change',()=>{ scanGraph=sel.value==='overwrite' ? 'overwrite' : 'slider';
        try{ localStorage.setItem(SCAN_GRAPH_KEY,scanGraph); }catch(_e){}
        renderResolutionComparison(); }); } }
  const SCAN_STOPS=[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[189,223,38]];   // viridis, without the pale end
  const scanColor=(i,n)=>{
    const t=n>1 ? i/(n-1) : 0, x=t*(SCAN_STOPS.length-1), j=Math.min(SCAN_STOPS.length-2,Math.floor(x)), f=x-j;
    return '#'+SCAN_STOPS[j].map((a,c)=>Math.round(a+(SCAN_STOPS[j+1][c]-a)*f).toString(16).padStart(2,'0')).join('');
  };
  // Conditions are read once per calculated point (as the inputs were then).
  const scanInfo=new WeakMap();
  function scanRows(){
    const res=shared.scanResults||[];
    if(res!==scanArray){ scanArray=res; scanHighlight=null; }
    const coords=fn.resolutionCoordinates(), unit=$('unit')?.value||'rlu', inst=currentInstrumentName();
    return res.map((e,i)=>{
      if(!scanInfo.has(e)) scanInfo.set(e,e.failed
        ? {condition:{point:pointCell(e.calc)},message:fn.resolutionFailText?.(e.message).row||e.message,sentence:fn.resolutionFailText?.(e.message).sentence||e.message,instrumentName:inst}
        : {condition:currentCondition(e),fields:conditionFields(e),instrumentName:inst});
      return {...scanInfo.get(e),id:`s${i+1}`,scanIndex:i+1,label:`#${i+1}`,color:scanColor(i,res.length),scan:true,
        failed:!!e.failed,entry:e.failed ? null : e,calc:e.calc,unit:e.unitMode||unit,coords};
    });
  }
  // The highlighted row: single: a clicked kept row; scan: the slider point
  // (slider) or a clicked point (overwrite).
  const scanSelectedIndex=()=>scanGraph==='slider' ? (shared.scanIndex||1) : scanHighlight;
  const highlightId=()=>singleMode() ? selectedId : (scanGraph==='overwrite' && scanHighlight ? `s${scanHighlight}` : null);

  // Rows shown: the kept results, then the current one (black) when it can be
  // drawn in their frame (single); the scan points (scan).
  function shownRows(){
    if(!singleMode()) return scanRows();
    const rows=shared.keptResolutions.map((k,i)=>({...k,label:`#${i+1}`,current:false}));
    const block=keepBlock();
    if(currentInfo && !/unit or coordinates/.test(block)) rows.push({...currentInfo,id:'current',color:CURRENT_COLOR,label:'current',current:true});
    return rows;
  }
  // Table: one row per result.
  //   Keep / Remove | # | instrument, point, mono, ana, col | widths along the axes
  // The table is rebuilt only when what it shows changed (a rebuild under the
  // pointer would swallow a click).
  let tableSig='', tableColumns=[];
  function renderTable(rows){
    const head=$('resolutionCompareHead'), body=$('resolutionCompareRows');
    if(!body || !head) return;
    const scan=!singleMode();
    const sig=JSON.stringify([scan,scan ? [entrySerial(shared.scanResults),scanGraph,scanSelectedIndex()] : 0,rows.map(k=>[k.id,k.color,k.label,k.current ? entrySerial(k.entry) : 0]),selectedId,keepBlock(),shared.keptResolutions.length,shown(),fn.resolutionCoordinates(),rows.length ? 0 : [predictedAxes(),$('unit')?.value]]);
    if(sig===tableSig && body.childElementCount===rows.length) return;
    tableSig=sig;
    body.replaceChildren(); head.replaceChildren();
    body.closest('table')?.classList.toggle('scan',scan);
    const cell=(tag,text,attrs={})=>{ const c=document.createElement(tag); c.textContent=text; for(const [k,v] of Object.entries(attrs)) c.setAttribute(k,v); return c; };
    const show=shown();
    // The position (h, k, l, ħω) is always shown, right of the colour; the
    // groups condition / resolution / R matrix as chosen in Show.
    const nPos=show.position ? 1 : 0, nCond=show.condition ? 4 : 0, nRes=show.widths ? 4 : 0, nMat=show.matrix ? 1 : 0, nData=nCond+nRes+nMat;
    // Columns after the button and colour, for Save figure: [group, label, monospace].
    tableColumns=nPos ? [['','position',false]] : [];
    {
      // Axis names from the first calculated row (none: generic names).  The
      // header is shown before there is any result (as in the Convolution tab).
      const ref=rows.find(k=>k.entry), qUnit=unitName((ref||rows[0])?.unit||$('unit')?.value||'rlu');
      const fr=ref ? frameFor(ref.entry.result,ref.coords) : null;
      const ax=ref?.coords==='q' ? Q_FRAME_AXES : ref ? (fr.displayAxes || ref.entry.result.displayAxes || {U:ref.entry.lc.sv1,V:ref.entry.lc.sv2,W:ref.entry.lc.sv3}) : predictedAxes();
      const axis=(v,name)=>typeof v==='string' ? v : v ? `δQ//(${v.map(x=>{ const y=Number(x); return Math.abs(y-Math.round(y))<1e-10 ? String(Math.round(y)) : Number(y.toPrecision(4)); }).join(',')})` : `δQ ${name}`;
      const r1=document.createElement('tr'), r2=document.createElement('tr');
      const span=nData ? '2' : '1';  // (position spans both header rows)
      // The buttons come first (as in the 1D cut), so they stay in view when
      // the table is wider than the panel.
      // (Scan: no buttons.)
      if(!scan){
        const allTh=document.createElement('th'); allTh.className='cmp-action'; allTh.rowSpan=Number(span);
        const all=document.createElement('button'); all.type='button'; all.id='resolutionCompareClear'; all.textContent='Clear all'; all.className='resolution-compare-clear';
        all.disabled=!shared.keptResolutions.length;
        allTh.appendChild(all); r1.appendChild(allTh);
      }
      r1.appendChild(cell('th','',{rowspan:span,class:'cmp-index'}));
      if(nPos) r1.appendChild(cell('th','position',{rowspan:span,class:'cmp-position'}));
      if(nCond){
        r1.appendChild(cell('th','condition',{colspan:'4',class:'cmp-group'}));
        for(const name of ['Inst.','monochromator','analyzer','collimator']){ r2.appendChild(cell('th',name)); tableColumns.push(['condition',name,false]); }
      }
      if(nRes){
        r1.appendChild(cell('th',`resolution (${qUnit})`,{colspan:'4',class:'cmp-group cmp-res-start'}));
        // U, V, E, W: the order of the R matrix (Q∥, Q⊥in, E, Q⊥out).
        const names=[axis(ax?.U,'U'),axis(ax?.V,'V'),'δħω (meV)',axis(ax?.W,'W')];
        names.forEach((name,i)=>{ r2.appendChild(cell('th',name,i ? {} : {class:'cmp-res-start'})); tableColumns.push([`resolution (${qUnit})`,name,false]); });
      }
      if(nMat){
        r1.appendChild(cell('th','R matrix (Å⁻¹, meV)',{class:'cmp-group cmp-res-start'}));
        r2.appendChild(cell('th',MATRIX_AXES,{class:'cmp-res-start cmp-mat-head'}));
        tableColumns.push(['R matrix (Å⁻¹, meV)',MATRIX_AXES,true]);
      }
      head.appendChild(r1);
      if(nData) head.appendChild(r2);
    }
    const block=keepBlock();
    for(const k of rows){
      const tr=document.createElement('tr');
      const td=(text,cls='')=>{ const c=document.createElement('td'); c.textContent=text; if(cls) c.className=cls; return c; };
      if(scan){
        // A scan point: colour, position, then its values or why it cannot
        // be calculated.
        tr.dataset.scanIndex=String(k.scanIndex);
        tr.className=k.scanIndex===scanSelectedIndex() ? 'selected' : '';
        const idx=document.createElement('td'); idx.className='cmp-index';
        idx.innerHTML=`<span class="resolution-compare-chip" style="background:${k.color}"></span>`;
        tr.appendChild(idx);
        if(nPos) tr.appendChild(td(k.condition.point,'cmp-cond cmp-col cmp-position'));
        if(k.failed){
          // (Without the position column the reason says which point.)
          const msg=td(nPos ? k.message : `${k.condition.point.replace('\n',', ')}: ${k.message}`,'cmp-fail'); msg.colSpan=Math.max(1,nData); tr.appendChild(msg);
          body.appendChild(tr); continue;
        }
      }else{
      if(!k.current){ tr.dataset.keptId=String(k.id); tr.className=k.id===selectedId ? 'selected' : ''; }
      else tr.className='cmp-current';
      const act=document.createElement('td'); act.className='cmp-action';
      const btn=document.createElement('button'); btn.type='button';
      if(k.current){
        btn.className='resolution-compare-keep'; btn.textContent='+ Keep'; btn.dataset.keep='1';
        btn.disabled=!!block || !!k.failed;
      }else{
        btn.className='resolution-compare-remove'; btn.textContent='Remove';
        btn.dataset.removeId=String(k.id);
      }
      act.appendChild(btn); tr.appendChild(act);
      const idx=document.createElement('td'); idx.className='cmp-index';
      // Kept results: a colour picker (as in the 1D cut); the current one is
      // black.  The colour tells the rows apart (no number).
      if(k.current) idx.innerHTML=`<span class="resolution-compare-chip" style="background:${k.color}"></span>`;
      else{
        const pick=document.createElement('input'); pick.type='color'; pick.value=k.color; pick.className='resolution-compare-color';
        pick.setAttribute('aria-label',`Colour of ${k.label}`);
        const kept=shared.keptResolutions.find(x=>x.id===k.id);
        pick.addEventListener('input',()=>{ if(kept) kept.color=pick.value; renderPlots(); });
        pick.addEventListener('change',()=>{ if(kept) kept.color=pick.value; renderResolutionComparison(); });
        idx.append(pick);
      }
      tr.appendChild(idx);
      if(nPos) tr.appendChild(td(k.condition.point,'cmp-cond cmp-col cmp-position'));
      }
      if(nCond){
        tr.appendChild(td(k.condition.inst||k.instrumentName,'cmp-cond cmp-col'));
        for(const key of ['mono','ana','col']) tr.appendChild(td(k.condition[key],'cmp-cond cmp-col'));
      }
      if(nRes){
        const d=frameFor(k.entry.result,k.coords).display, w=(a,b)=>`${a.toFixed(4)} (${b.toFixed(4)})`;
        tr.append(td(w(d.U,d.Ucoh),'cmp-num cmp-res cmp-res-start'),td(w(d.V,d.Vcoh),'cmp-num cmp-res'),td(w(d.E,d.Ecoh),'cmp-num cmp-res'),td(w(d.W,d.Wcoh),'cmp-num cmp-res'));
      }
      if(nMat) tr.appendChild(td(matrixCell(matrixFor(k.entry.result)),'cmp-mat cmp-res-start'));
      body.appendChild(tr);
    }
    const bodyEl=document.querySelector('#resolutionComparisonView .resolution-compare-body');
    // The plot frames and the table header stay, also without a result.
    if(bodyEl) bodyEl.hidden=false;
    const canSave=scan ? rows.some(k=>!k.failed) : shared.keptResolutions.length>0;
    for(const id of ['resolutionCompareSaveFigure','resolutionCompareSaveCsv']) if($(id)) $(id).disabled=!canSave;
  }

  function renderResolutionComparison(){
    updateResolutionKeepState();
    const rows=shownRows();
    renderTable(rows);
    renderPlots(plotRows(rows));
  }
  // What the plots draw: every calculated row, or (scan, Graph: slider) the
  // point of the slider.
  function plotRows(rows=shownRows()){
    const valid=rows.filter(k=>!k.failed);
    return !singleMode() && scanGraph==='slider' ? valid.filter(k=>k.scanIndex===(shared.scanIndex||1)) : valid;
  }
  // The four overlay plots (also on their own while a colour is being picked).
  // Scan: the ranges of the whole scan, so that they stay while the slider moves.
  function renderPlots(drawn=plotRows()){
    const viewEl=$('resolutionComparisonView');
    if(!viewEl || viewEl.hidden || !window.Plotly) return;
    // Plot ranges: the largest of the kept results, in their (common) frame;
    // scan: of the whole scan.  Nothing to draw (no result yet, or a scan
    // point that cannot be calculated): the empty frames.
    const limits={};
    const rangeRows=singleMode() ? drawn : shownRows().filter(k=>!k.failed);
    for(const k of rangeRows){
      const lim=frameFor(k.entry.result,k.coords).lim||{};
      for(const [key,v] of Object.entries(lim)) if(Number(v)>(limits[key]||0)) limits[key]=Number(v);
    }
    const ref=drawn[0]||rangeRows[0]||null, first=ref?.entry;
    const firstFrame=first ? frameFor(first.result,ref.coords) : null;
    const ax=ref?.coords==='q' ? Q_FRAME_AXES : first ? (firstFrame.displayAxes || first.result.displayAxes || {U:first.lc.sv1,V:first.lc.sv2,W:first.lc.sv3}) : predictedAxes();
    // Axis label: "δQ ∥ (1, 0, 0)" for a direction, or the name ("δQ∥").
    const lab=v=>Array.isArray(v) ? `δQ ∥ ${fn.formatResolutionAxis(v)}` : String(v||'');
    const qUnit=unitName(ref?.unit||$('unit')?.value||'rlu');
    const fonts=fn.RESOLUTION_PLOT_FONTS();
    const hid=highlightId();
    // A highlighted row that has nothing drawn (a scan point that cannot be
    // calculated): every ellipse is faint.
    const anySelected=!!hid;
    const style=k=>{
      if(!anySelected) return {width:2,opacity:0.95};
      return k.id===hid ? {width:3.4,opacity:1} : {width:1.2,opacity:0.3};
    };
    // The highlighted result is drawn last (on top).
    const order=[...drawn].sort((a,b)=>(a.id===hid)-(b.id===hid));
    const traces=key=>{
      const out=[];
      for(const k of order){
        const el=frameFor(k.entry.result,k.coords).ellipses, st=style(k);
        const name=k.label;
        for(const [kind,dash] of [['proj','solid'],['slice','dash']]){
          const p=el[`${kind}${key}`]; if(!p) continue;
          const t=fn.traceEllipse(p,`${name} ${kind==='proj'?'incoherent':'coherent'}`,dash);
          t.line={dash,color:k.color,width:st.width}; t.opacity=st.opacity;
          out.push(t);
        }
      }
      return out;
    };
    const qeTitle=v=>`${lab(v)} vs δħω`;
    const layout=(title,x,y,xl,yl,id,yIsQ=false)=>({...fn.resolutionBaseLayout(title,x,y,xl,yl,false,id,fonts,yIsQ),uirevision:`${id}-cmp`});
    fn.reactResolutionPlot(PLOT_IDS.UE,traces('UE'),layout(qeTitle(ax.U),`${lab(ax.U)} (${qUnit})`,'δħω (meV)',limits.U,limits.E,PLOT_IDS.UE));
    fn.reactResolutionPlot(PLOT_IDS.VE,traces('VE'),layout(qeTitle(ax.V),`${lab(ax.V)} (${qUnit})`,'δħω (meV)',limits.V,limits.E,PLOT_IDS.VE));
    fn.reactResolutionPlot(PLOT_IDS.WE,traces('WE'),layout(qeTitle(ax.W),`${lab(ax.W)} (${qUnit})`,'δħω (meV)',limits.W,limits.E,PLOT_IDS.WE));
    fn.reactResolutionPlot(PLOT_IDS.UV,traces('UV'),layout(`${lab(ax.U)} vs ${lab(ax.V)}`,`${lab(ax.U)} (${qUnit})`,`${lab(ax.V)} (${qUnit})`,limits.UVU||limits.U,limits.UVV||limits.V,PLOT_IDS.UV,true));
  }

  // Removing kept results (Comparison table).
  const setKeepNote=text=>{ extraNote=text||''; renderPointMessage(); };
  function clearKept(){
    if(!shared.keptResolutions.length) return;
    shared.keptResolutions=[]; selectedId=null;
    setKeepNote('');
    renderResolutionComparison();
  }
  function removeKept(id){
    shared.keptResolutions=shared.keptResolutions.filter(k=>k.id!==id);
    if(selectedId===id) selectedId=null;
    setKeepNote('');
    renderResolutionComparison();
  }
  // Event wiring (the Results section is static HTML).
  // Scan view: Figure (the four ellipses) / Matrices, kept in the browser.
  const DETAIL_KEY='plane-tas-resolution-detail-view';
  function setDetail(name,{store=true}={}){
    const matrices=name==='matrices';
    for(const tab of document.querySelectorAll('#resolutionDetailTabs [data-resolution-detail]')){
      const on=(tab.dataset.resolutionDetail==='matrices')===matrices;
      tab.classList.toggle('active',on); tab.setAttribute('aria-selected',String(on));
    }
    if($('resolutionFigurePane')) $('resolutionFigurePane').hidden=matrices;
    if($('resolutionMatricesPane')) $('resolutionMatricesPane').hidden=!matrices;
    if(store) try{ localStorage.setItem(DETAIL_KEY,matrices ? 'matrices' : 'figure'); }catch(_e){}
    if(!matrices) requestAnimationFrame(()=>{ for(const id of Object.values(shared.RESOLUTION_PLOT_IDS||{})){ const gd=$(id); if(gd?._fullLayout && window.Plotly) Plotly.Plots.resize(gd); } });
  }
  for(const tab of document.querySelectorAll('#resolutionDetailTabs [data-resolution-detail]'))
    tab.addEventListener('click',()=>setDetail(tab.dataset.resolutionDetail));
  { let saved=null; try{ saved=localStorage.getItem(DETAIL_KEY); }catch(_e){} if(saved==='matrices') setDetail('matrices',{store:false}); }
  $('resolutionCopyMatrix')?.addEventListener('click',async()=>{
    const text=$('matrix')?.textContent||'', status=$('resolutionCopyStatus');
    try{ await navigator.clipboard.writeText(text); if(status) status.textContent=text ? 'Copied' : ''; }
    catch(_e){ if(status) status.textContent='Copy failed: select the text and copy'; }
    if(status) setTimeout(()=>{ status.textContent=''; },2000);
  });
  // Table buttons act on pointer release over the same button: a click is
  // lost when the button moves or is redrawn between press and release, which
  // made + Keep need a second click.  Keyboard activation still comes as a click.
  const table=document.querySelector('#resolutionComparisonView .resolution-compare-table');
  const actionOf=el=>{
    const b=el?.closest?.('button'); if(!b) return null;
    if(b.id==='resolutionCompareClear') return 'clear';
    if(b.dataset.keep) return 'keep';
    if(b.dataset.removeId) return `remove:${b.dataset.removeId}`;
    return null;
  };
  const runAction=key=>{
    if(key==='clear') clearKept();
    else if(key==='keep') keepCurrent();
    else if(key?.startsWith('remove:')) removeKept(Number(key.slice(7)));
  };
  let pressed=null, handledByPointer=false;
  table?.addEventListener('pointerdown',event=>{ pressed=event.button===0 ? actionOf(event.target) : null; });
  // Pressing a table button must not move focus: focusing it scrolls the
  // table sideways under the pointer (and blurs a field, which recalculates).
  table?.addEventListener('mousedown',event=>{ if(actionOf(event.target)) event.preventDefault(); });
  table?.addEventListener('pointerup',event=>{
    const key=actionOf(event.target);
    if(key && key===pressed && !event.target.closest('button')?.disabled){ handledByPointer=true; runAction(key); }
    pressed=null;
  });
  table?.addEventListener('click',event=>{
    if(event.target.closest?.('input[type=color]')) return;   // colour picker, not a row click
    const key=actionOf(event.target);
    if(key){ if(handledByPointer){ handledByPointer=false; return; } runAction(key); return; }
    handledByPointer=false;
    const point=event.target.closest?.('tr[data-scan-index]');
    if(point){
      const i=Number(point.dataset.scanIndex);
      if(scanGraph==='slider') fn.renderResolutionScan?.(i);
      else{ scanHighlight=scanHighlight===i ? null : i; renderResolutionComparison(); }
      return;
    }
    const row=event.target.closest?.('tr[data-kept-id]');
    if(!row) return;
    const id=Number(row.dataset.keptId);
    selectedId=selectedId===id ? null : id;
    renderResolutionComparison();
  });
  // Save figure: the kept results only (the current row is a preview), the
  // four plots on the left and the table (the columns shown) on the right,
  // as on the screen, one PNG.
  async function saveComparisonFigure(){
    if(!window.Plotly) return;
    const table=document.querySelector('#resolutionComparisonView .resolution-compare-table');
    const rows=shownRows();
    const bodyRows=[...(table?.tBodies[0]?.rows||[])];
    const head2=tableColumns.map(c=>c[1]);
    const mono=new Set(tableColumns.map((c,j)=>c[2] ? j : -1).filter(j=>j>=0));
    // Groups: runs of columns with the same group name ('' = no group).
    const groups=[];
    for(const c of tableColumns){ const g=groups[groups.length-1]; if(g && g.text===c[0]) g.span++; else groups.push({text:c[0],span:1}); }
    // Rows: [colour, cell texts (after the button and colour columns)].
    // Single: the kept results; scan: the points drawn (all, or the slider point).
    const scan=!singleMode(), skip=scan ? 1 : 2;
    const drawnIds=new Set(plotRows(rows).map(k=>k.id));
    const data=bodyRows.map((tr,i)=>{
      const r=rows[i]; if(!r) return null;
      if(scan ? !(drawnIds.has(r.id) || (r.failed && scanGraph==='overwrite')) : r.current) return null;
      return [r.color||'#000',[...tr.cells].slice(skip).map(c=>c.innerText.replace(/\r/g,''))];
    }).filter(Boolean);
    if(!data.length) return;
    const S=2, fs=13, lh=Math.round(fs*1.35), pad=6, sw=16;
    const cv=document.createElement('canvas'), ctx=cv.getContext('2d');
    const font=(b,m=false)=>m ? `${fs}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace` : `${b ? '600 ' : ''}${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw=(t,b,m=false)=>{ ctx.font=font(b,m); return Math.max(0,...String(t).split('\n').map(l=>ctx.measureText(l).width)); };
    const nCols=head2.length;
    // A row whose reason spans several columns is measured in the first one
    // only up to the width of the columns it spans (it is drawn there).
    const colW=Array.from({length:nCols},(_,j)=>Math.ceil(Math.max(tw(head2[j],true),...data.map(([,c])=>c.length===nCols ? tw(c[j]??'',false,mono.has(j)) : 0))+2*pad));
    const lines=t=>String(t).split('\n').length;
    const rowH=data.map(([,c])=>Math.max(1,...c.map(lines))*lh+2*pad);
    const headH=lh+2*pad, tableW=sw+2*pad+colW.reduce((a,b)=>a+b,0);
    const tableH=2*headH+rowH.reduce((a,b)=>a+b,0);
    const plots=Object.values(PLOT_IDS).map(id=>$(id)).filter(gd=>gd?.data);
    const pw=Math.max(...plots.map(gd=>gd.clientWidth),260), ph=Math.max(...plots.map(gd=>gd.clientHeight),220);
    // Plots 2 × 2 on the left, the table on the right (top aligned).
    const gap=10, plotsW=2*pw+gap, W=gap+plotsW+2*gap+tableW+gap, H=gap+Math.max(2*ph+gap,tableH)+gap;
    cv.width=W*S; cv.height=H*S; ctx.scale(S,S);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
    // Table.
    const x0=gap+plotsW+2*gap, y0=gap; ctx.strokeStyle='#d8dde3'; ctx.lineWidth=1; ctx.textBaseline='top';
    const colX=[x0+sw+2*pad]; for(const w of colW) colX.push(colX[colX.length-1]+w);
    const line=(x1,y1,x2,y2)=>{ ctx.beginPath(); ctx.moveTo(x1+.5,y1+.5); ctx.lineTo(x2+.5,y2+.5); ctx.stroke(); };
    ctx.fillStyle='#f4f6f8'; ctx.fillRect(x0,y0,tableW,2*headH);
    ctx.fillStyle='#222'; ctx.font=font(true);
    let gx=colX[0];
    for(const g of groups){ let w=0; for(let k=0;k<g.span;k++) w+=colW[(colX.indexOf(gx))+k]||0; ctx.fillText(g.text,gx+(w-ctx.measureText(g.text).width)/2,y0+pad); line(gx,y0,gx,y0+2*headH); gx+=w; }
    head2.forEach((t,j)=>ctx.fillText(t,colX[j]+pad,y0+headH+pad));
    let y=y0+2*headH;
    data.forEach(([color,cells],i)=>{
      ctx.fillStyle=color; ctx.fillRect(x0+pad,y+pad+2,sw,sw-4);
      ctx.fillStyle='#222'; ctx.font=font(false);
      cells.forEach((t,j)=>{ if(colX[j]===undefined) return; ctx.font=font(false,cells.length===nCols && mono.has(j)); String(t).split('\n').forEach((l,n)=>ctx.fillText(l,colX[j]+pad,y+pad+n*lh)); });
      line(x0,y,x0+tableW,y); y+=rowH[i];
    });
    line(x0,y0,x0+tableW,y0); line(x0,y0+headH,x0+tableW,y0+headH); line(x0,y,x0+tableW,y);
    line(x0,y0,x0,y); for(const x of colX) line(x,y0+headH,x,y);
    // Plots, 2 × 2.
    // The plots are drawn for a moment with the kept results only.
    let imgs;
    try{
      if(!scan) renderPlots(rows.filter(k=>!k.current && !k.failed));
      imgs=await Promise.all(plots.map(gd=>Plotly.toImage(gd,{format:'png',width:gd.clientWidth,height:gd.clientHeight,scale:S})
        .then(src=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }))));
    }finally{ if(!scan) renderPlots(); }
    imgs.forEach((im,i)=>{ const cx=gap+(i%2)*(pw+gap), cy=gap+Math.floor(i/2)*(ph+gap); ctx.drawImage(im,cx,cy,pw,ph); });
    const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
    downloadBlob(blob,scan ? 'scan-figure.png' : 'comparison-figure.png');
  }
  // Save CSV: every kept result with all its columns, whatever Show is.
  // Widths in the unit and coordinates of the table (projection = incoherent,
  // slice = coherent); the R matrix in Q∥, Q⊥in, E, Q⊥out, Å⁻¹ and meV.
  const CSV_AXES={q:['Qpar','QperpIn','QperpOut'],orthogonal:['U','UperpIn','UperpOut'],lattice:['U','V','W']};
  function comparisonCsv(){
    const scan=!singleMode();
    // Single: the kept results; scan: every point (a point that cannot be
    // calculated has its position and the reason in note).
    const kept=scan ? shownRows() : shared.keptResolutions; if(!kept.some(k=>!k.failed)) return '';
    const q=v=>{ const t=String(v??''); return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t; };
    const num=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toPrecision(10))) : ''; };
    const k0=kept.find(k=>!k.failed), ax=CSV_AXES[k0.coords]||['U','V','W'];
    const fr=frameFor(k0.entry.result,k0.coords);
    // (Q∥, Q⊥in, Q⊥out follow each point: no directions given.)
    const dirs=k0.coords==='q' ? {} : (fr.displayAxes || k0.entry.result.displayAxes || {});
    const dir=v=>Array.isArray(v) ? `(${v.map(x=>Number(Number(x).toPrecision(4))).join(' ')})` : '';
    const lines=[
      scan ? '# PLANE-TAS resolution scan (all points)' : '# PLANE-TAS resolution comparison (kept results)',
      `# widths: FWHM; unit ${unitName(k0.unit)} (energy meV); coordinates ${COORD_NAMES[k0.coords]}; ${ax[0]} ${dir(dirs.U)}, ${ax[1]} ${dir(dirs.V)}, ${ax[2]} ${dir(dirs.W)}; *_proj = projection (incoherent), *_slice = slice (coherent)`,
      '# R matrix: Q∥, Q⊥in, E, Q⊥out in Å⁻¹ and meV (R11 … R44, row by row); collimations in arcmin, (R) radial 3rd collimator (equivalent divergence), SM(m) supermirror guide; mosaic in arcmin'
    ];
    const head=['no','color','instrument','sense','approximation','h','k','l','hw_meV','Ei_meV','Ef_meV'];
    for(const c of ['mono','ana']) head.push(`${c}_crystal`,`${c}_H_mosaic`,`${c}_H_focus`,`${c}_H_blades`,`${c}_V_mosaic`,`${c}_V_focus`,`${c}_V_blades`);
    head.push('col_H1','col_H2','col_H3','col_H4','col_V1','col_V2','col_V3','col_V4');
    for(const a of [ax[0],ax[1],'E',ax[2]]) head.push(`d${a}_proj`,`d${a}_slice`);
    for(let i=1;i<=4;i++) for(let j=1;j<=4;j++) head.push(`R${i}${j}`);
    head.push('note');
    lines.push(head.join(','));
    kept.forEach((k,n)=>{
      if(k.failed){
        const row=new Array(head.length).fill('');
        row[0]=n+1; row[1]=k.color; row[2]=k.instrumentName; row[5]=num(k.calc?.h); row[6]=num(k.calc?.k); row[7]=num(k.calc?.l); row[8]=num(k.calc?.hw);
        row[head.length-1]=k.sentence||k.message;
        lines.push(row.map(q).join(',')); return;
      }
      const f=k.fields||{}, d=frameFor(k.entry.result,k.coords).display, M=matrixFor(k.entry.result);
      const row=[n+1,k.color,f.instrument??k.instrumentName,f.sense??'',f.approximation,num(f.h),num(f.k),num(f.l),num(f.hw),num(f.Ei),num(f.Ef)];
      for(const c of ['mono','ana']){ const x=f[c]||{}; row.push(x.crystal,x.H?.mosaic,x.H?.focus,x.H?.blades,x.V?.mosaic,x.V?.focus,x.V?.blades); }
      row.push(...(f.colH||['','','','']),...(f.colV||['','','','']));
      row.push(num(d.U),num(d.Ucoh),num(d.V),num(d.Vcoh),num(d.E),num(d.Ecoh),num(d.W),num(d.Wcoh));
      for(const r of M) for(const x of r) row.push(Number(x).toExponential(9));
      row.push('');
      lines.push(row.map(q).join(','));
    });
    return lines.join('\n')+'\n';
  }
  // Save CSV file name: the entry next to it (without .csv), which is filled
  // with the default for the mode (editable), or that default if emptied.
  const csvDefault=()=>singleMode() ? 'comparison-table' : 'scan-table';
  const csvFileName=()=>{
    const typed=String($('resolutionCsvName')?.value||'').trim().replace(/\.csv$/i,'').replace(/[\\/:*?"<>|]+/g,'_');
    return `${typed||csvDefault()}.csv`;
  };
  $('resolutionCompareSaveCsv')?.addEventListener('click',()=>{
    const text=comparisonCsv(); if(!text) return;
    downloadText('\ufeff'+text,csvFileName(),'text/csv');
  });
  $('resolutionCompareSaveFigure')?.addEventListener('click',()=>saveComparisonFigure().catch(err=>setKeepNote(`Save figure: ${err?.message||err}`)));
  $('calcMode')?.addEventListener('change',()=>requestAnimationFrame(renderResolutionComparison));
  $('unit')?.addEventListener('change',()=>requestAnimationFrame(renderResolutionComparison));
  // Q∥, Q⊥in, E, Q⊥out: the widths along Q have no fixed r.l.u. direction, so
  // the unit is Å⁻¹; the unit chosen before comes back with the other frames.
  let unitBeforeQ=null;
  // {silent:true} at start-up: Q∥ is the default frame, so the unit is set to
  // Å⁻¹ before the instruments are loaded, without a change event (that would
  // ask for a calculation with no instrument selected yet).
  function syncUnitForCoordinates({silent=false}={}){
    const unit=$('unit'); if(!unit) return;
    const q=fn.resolutionCoordinates()==='q';
    let changed=false;
    if(q && unit.value!=='ainv'){ unitBeforeQ=unit.value; unit.value='ainv'; changed=true; }
    else if(!q && unitBeforeQ){ unit.value=unitBeforeQ; unitBeforeQ=null; changed=true; }
    lockFrame();
    if(changed && !silent) unit.dispatchEvent(new Event('change',{bubbles:true}));
  }
  $('resolutionCoordinates')?.addEventListener('change',()=>syncUnitForCoordinates());
  syncUnitForCoordinates({silent:true});
  // The plots follow their boxes whenever these change size: also when the
  // window was resized while they were hidden (another tab or the
  // Convolution pane), which the window resize handlers skip.
  if(typeof ResizeObserver==='function'){
    const sizes=new WeakMap(); let frame=0;
    const ro=new ResizeObserver(entries=>{
      let changed=false;
      for(const e of entries){
        const w=Math.round(e.contentRect.width), h=Math.round(e.contentRect.height), was=sizes.get(e.target);
        if(w>0 && h>0 && (!was || was[0]!==w || was[1]!==h)){ sizes.set(e.target,[w,h]); changed=true; }
      }
      if(!changed || frame) return;
      frame=requestAnimationFrame(()=>{ frame=0;
        for(const id of Object.values(PLOT_IDS)){ const gd=$(id); if(gd?._fullLayout && gd.offsetWidth>0 && window.Plotly) try{ Plotly.Plots.resize(gd); }catch(_e){} } });
    });
    for(const id of Object.values(PLOT_IDS)) if($(id)) ro.observe($(id));
  }
  // The results section shown again (e.g. Mode = scan before the first
  // scan): draw the frames now that they have a size.
  { const res=$('result'); let was=res?.classList.contains('hidden');
    if(res) new MutationObserver(()=>{ const now=res.classList.contains('hidden'); if(was && !now) requestAnimationFrame(renderResolutionComparison); was=now; })
      .observe(res,{attributes:true,attributeFilter:['class']}); }
  updateResolutionKeepState();
}
