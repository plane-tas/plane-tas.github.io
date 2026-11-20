// Resolution: comparison of kept single-point results.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
//
// In Mode = single, the Comparison tab lists the kept results and the
// current one (last calculated) in a table (instrument, point, monochromator /
// analyzer, collimations, resolution widths) and overlays their ellipses, one
// colour per result, the current one in black (solid: incoherent =
// projection, dashed: coherent = slice).  "+ Keep" in the current row keeps
// it, "Remove" / "Clear all" remove kept ones; clicking a kept row highlights
// it.  Results of different instruments can be compared; the unit and coordinates
// must be the same.  Kept results live for the session.
export function installResolutionComparison(ctx){
  const {deps:{$}, state:shared, fn}=ctx;
  Object.assign(fn,{renderResolutionComparison, updateResolutionKeepState});

  const MAX_KEPT=6;
  const COLORS=['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];
  const PLOT_IDS={UE:'plotCmpUE',VE:'plotCmpVE',UV:'plotCmpUV',WE:'plotCmpWE'};
  shared.keptResolutions=[];
  let selectedId=null, nextId=1, view='calculation';

  const singleMode=()=>$('calcMode')?.value!=='scan';
  // All kept results share the unit and coordinates of the first one; they are
  // shown in that unit / frame whatever the current selection is.
  const COORD_NAMES={q:'Q∥, Q⊥, E, W',orthogonal:'U, U⊥in, E, U⊥out',lattice:'U, V, E, W'};
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
      point:`(${f(calc.h)},${f(calc.k)},${f(calc.l)})\nħω=${f(calc.hw)} meV`,
      mono:`${crystalText('monoCrystal')}, Ei=${energyText(en.Ei)} meV\nH: ${focusText('monoHF','monoHB','mosMonoH')}\nV: ${focusText('monoVF','monoVB','mosMonoV')}`,
      ana:`${crystalText('anaCrystal')}, Ef=${energyText(en.Ef)} meV\nH: ${focusText('anaHF','anaHB','mosAnaH')}\nV: ${focusText('anaVF','anaVB','mosAnaV')}`,
      col:`H: ${[sm||value('div1h'),value('div2h'),c3,value('div4h')].join('-')},\nV: ${[sm||value('div1v'),value('div2v'),value('div3v'),value('div4v')].join('-')}`
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
  const FRAME_CONTROLS=['unit','resolutionCoordinates'];
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
    const uv=$('resolutionUVView');
    if(uv){
      if(locked){ uv.disabled=true; uv.title=LOCK_TITLE; }
      else if(uv.title===LOCK_TITLE){ uv.title=''; fn.rerenderResolution?.(); }
    }
  }
  function updateResolutionKeepState(){
    lockFrame();
    const entry=currentResult();
    if(entry && currentInfo?.entry!==entry)
      currentInfo={entry,condition:currentCondition(entry),detail:conditionDetail(entry),unit:entry.unitMode,coords:fn.resolutionCoordinates(),instrumentName:currentInstrumentName()};
    if(!entry) currentInfo=null;
    // The current result is shown only when it differs from every kept one
    // (a recalculation of the same input, e.g. on a click elsewhere, is not
    // a new result).
    if(currentInfo && shared.keptResolutions.some(k=>k.sig===resultSig(currentInfo))) currentInfo=null;
    // A current point that cannot be calculated: its row carries the reason.
    const last=shared.lastResolutionRender;
    currentFail=singleMode() && last && !last.scan && last.entry?.failed ? last.entry : null;
    const tabs=$('resolutionResultTabs');
    if(tabs) tabs.hidden=!singleMode();
    if(!singleMode() && view!=='calculation') setView('calculation',{store:false});
  }
  // Why the current result cannot be kept ('' when it can).
  function keepBlock(){
    if(!currentInfo) return 'no result';
    if(shared.keptResolutions.length>=MAX_KEPT) return `At most ${MAX_KEPT} results; remove one first.`;
    const setting=keptSetting();
    if(setting && (setting.unit!==currentInfo.unit || setting.coords!==currentInfo.coords))
      return `Different unit or coordinates (kept: ${unitName(setting.unit)}, ${COORD_NAMES[setting.coords]}).`;
    return '';
  }

  function keepCurrent(){
    if(!currentInfo || keepBlock()) return;
    const used=new Set(shared.keptResolutions.map(k=>k.color));
    const color=COLORS.find(c=>!used.has(c)) || COLORS[0];
    shared.keptResolutions.push({id:nextId++,color,...currentInfo,sig:resultSig(currentInfo)});
    currentInfo=null;
    setKeepNote('');
    renderResolutionComparison();
  }

  // The open view (Result / Comparison) is kept in the browser.
  const VIEW_KEY='plane-tas-resolution-result-view';
  function setView(name,{store=true}={}){
    view=name==='comparison' ? 'comparison' : 'calculation';
    if(store) try{ localStorage.setItem(VIEW_KEY,view); }catch(_e){}
    for(const tab of document.querySelectorAll('#resolutionResultTabs [data-resolution-view]')){
      const on=tab.dataset.resolutionView===view;
      tab.classList.toggle('active',on); tab.setAttribute('aria-selected',String(on));
    }
    if($('resolutionCalculationView')) $('resolutionCalculationView').hidden=view!=='calculation';
    if($('resolutionComparisonView')) $('resolutionComparisonView').hidden=view!=='comparison';
    if(view==='comparison') requestAnimationFrame(renderResolutionComparison);
    else requestAnimationFrame(()=>{ for(const id of Object.values(shared.RESOLUTION_PLOT_IDS||{})){ const gd=$(id); if(gd?._fullLayout && window.Plotly) Plotly.Plots.resize(gd); } });
  }

  // Rows shown: the kept results, then the current one (black) when it can be
  // drawn in their frame.
  function shownRows(){
    const rows=shared.keptResolutions.map((k,i)=>({...k,label:`#${i+1}`,current:false}));
    const block=keepBlock();
    if(currentInfo && !/unit or coordinates/.test(block)) rows.push({...currentInfo,id:'current',color:CURRENT_COLOR,label:'current',current:true});
    else if(currentFail) rows.push({id:'current',color:CURRENT_COLOR,label:'current',current:true,failed:true,calc:currentFail.calc,message:currentFail.message,
      instrumentName:currentInstrumentName(),unit:$('unit')?.value||'rlu',coords:fn.resolutionCoordinates(),detail:currentFail.message});
    return rows;
  }
  // Table: one row per result.
  //   Keep / Remove | # | instrument, point, mono, ana, col | widths along the axes
  // The table is rebuilt only when what it shows changed (a rebuild under the
  // pointer would swallow a click).
  let tableSig='';
  function renderTable(rows){
    const head=$('resolutionCompareHead'), body=$('resolutionCompareRows');
    if(!body || !head) return;
    const sig=JSON.stringify([rows.map(k=>[k.id,k.color,k.label,k.current ? (k.failed ? `${k.message}|${pointCell(k.calc)}` : entrySerial(k.entry)) : 0]),selectedId,keepBlock(),shared.keptResolutions.length]);
    if(sig===tableSig && body.childElementCount===rows.length) return;
    tableSig=sig;
    body.replaceChildren(); head.replaceChildren();
    const empty=!rows.length;
    const cell=(tag,text,attrs={})=>{ const c=document.createElement(tag); c.textContent=text; for(const [k,v] of Object.entries(attrs)) c.setAttribute(k,v); return c; };
    if(!empty){
      // Axis names from the first calculated row (none: generic names).
      const ref=rows.find(k=>k.entry), qUnit=unitName((ref||rows[0]).unit);
      const fr=ref ? frameFor(ref.entry.result,ref.coords) : null;
      const ax=ref ? (fr.displayAxes || ref.entry.result.displayAxes || {U:ref.entry.lc.sv1,V:ref.entry.lc.sv2,W:ref.entry.lc.sv3}) : null;
      const axis=(v,name)=>v ? `δQ//(${v.map(x=>{ const y=Number(x); return Math.abs(y-Math.round(y))<1e-10 ? String(Math.round(y)) : Number(y.toPrecision(4)); }).join(',')})` : `δQ ${name}`;
      const r1=document.createElement('tr'), r2=document.createElement('tr');
      // The buttons come first (as in the 1D cut), so they stay in view when
      // the table is wider than the panel.
      const allTh=document.createElement('th'); allTh.className='cmp-action'; allTh.rowSpan=2;
      const all=document.createElement('button'); all.type='button'; all.id='resolutionCompareClear'; all.textContent='Clear all'; all.className='resolution-compare-clear';
      all.disabled=!shared.keptResolutions.length;
      allTh.appendChild(all);
      r1.append(allTh,cell('th','',{rowspan:'2',class:'cmp-index'}),cell('th','condition',{colspan:'5',class:'cmp-group'}),cell('th',`resolution (${qUnit})`,{colspan:'4',class:'cmp-group cmp-res-start'}));
      for(const name of ['instrument','point','monochromator','analyzer','collimator']) r2.appendChild(cell('th',name));
      r2.append(cell('th',axis(ax?.U,'U'),{class:'cmp-res-start'}),cell('th',axis(ax?.V,'V')),cell('th',axis(ax?.W,'W')),cell('th','δħω (meV)'));
      head.append(r1,r2);
    }
    const block=keepBlock();
    for(const k of rows){
      const tr=document.createElement('tr');
      if(!k.current){ tr.dataset.keptId=String(k.id); tr.className=k.id===selectedId ? 'selected' : ''; }
      else tr.className='cmp-current';
      const td=(text,cls='')=>{ const c=document.createElement('td'); c.textContent=text; if(cls) c.className=cls; return c; };
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
      tr.appendChild(td(k.instrumentName,'cmp-cond'));
      if(k.failed){
        // Not calculable: the point, then the reason across the other columns.
        tr.appendChild(td(pointCell(k.calc),'cmp-cond cmp-col'));
        const msg=td(`Not calculable: ${k.message}`,'cmp-fail'); msg.colSpan=7; tr.appendChild(msg);
        body.appendChild(tr);
        continue;
      }
      for(const key of ['point','mono','ana','col']) tr.appendChild(td(k.condition[key],'cmp-cond cmp-col'));
      const d=frameFor(k.entry.result,k.coords).display, w=(a,b)=>`${a.toFixed(4)} (${b.toFixed(4)})`;
      tr.append(td(w(d.U,d.Ucoh),'cmp-num cmp-res cmp-res-start'),td(w(d.V,d.Vcoh),'cmp-num cmp-res'),td(w(d.W,d.Wcoh),'cmp-num cmp-res'),td(w(d.E,d.Ecoh),'cmp-num cmp-res'));
      body.appendChild(tr);
    }
    if($('resolutionCompareEmpty')) $('resolutionCompareEmpty').hidden=!empty;
    const wrap=document.querySelector('#resolutionComparisonView .resolution-compare-table-wrap');
    if(wrap) wrap.hidden=empty;
    const plots=document.querySelector('#resolutionComparisonView .resolution-compare-plots');
    if(plots) plots.hidden=!rows.some(k=>!k.failed);
    if($('resolutionCompareSaveFigure')){
      $('resolutionCompareSaveFigure').disabled=!shared.keptResolutions.length;
    }
    // Why the current result is not in the table / cannot be kept.
    setKeepNote(block && block!=='no result' ? `Current result: ${block}` : '',true);
  }

  function renderResolutionComparison(){
    updateResolutionKeepState();
    const drawn=shownRows();
    renderTable(drawn);
    renderPlots(drawn.filter(k=>!k.failed));
  }
  // The four overlay plots (also on their own while a colour is being picked).
  function renderPlots(drawn=shownRows().filter(k=>!k.failed)){
    const viewEl=$('resolutionComparisonView');
    if(!viewEl || viewEl.hidden || !window.Plotly) return;
    if(!drawn.length){ for(const id of Object.values(PLOT_IDS)){ const gd=$(id); if(gd) try{ Plotly.purge(gd); }catch(_e){} } return; }
    // Plot ranges: the largest of the kept results, in their (common) frame.
    const limits={};
    for(const k of drawn){
      const lim=frameFor(k.entry.result,k.coords).lim||{};
      for(const [key,v] of Object.entries(lim)) if(Number(v)>(limits[key]||0)) limits[key]=Number(v);
    }
    const first=drawn[0].entry, firstFrame=frameFor(first.result,drawn[0].coords);
    const ax=firstFrame.displayAxes || first.result.displayAxes || {U:first.lc.sv1,V:first.lc.sv2,W:first.lc.sv3}, fmtAxis=fn.formatResolutionAxis;
    const qUnit=unitName(drawn[0].unit);
    const fonts=fn.RESOLUTION_PLOT_FONTS();
    const anySelected=drawn.some(k=>k.id===selectedId);
    const style=k=>{
      if(!anySelected) return {width:2,opacity:0.95};
      return k.id===selectedId ? {width:3.4,opacity:1} : {width:1.2,opacity:0.3};
    };
    // The highlighted result is drawn last (on top).
    const order=[...drawn].sort((a,b)=>(a.id===selectedId)-(b.id===selectedId));
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
    const qeTitle=v=>`δQ ∥ ${fmtAxis(v)} vs δħω`;
    const layout=(title,x,y,xl,yl,id,yIsQ=false)=>({...fn.resolutionBaseLayout(title,x,y,xl,yl,false,id,fonts,yIsQ),uirevision:`${id}-cmp`});
    fn.reactResolutionPlot(PLOT_IDS.UE,traces('UE'),layout(qeTitle(ax.U),`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,'δħω (meV)',limits.U,limits.E,PLOT_IDS.UE));
    fn.reactResolutionPlot(PLOT_IDS.VE,traces('VE'),layout(qeTitle(ax.V),`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,'δħω (meV)',limits.V,limits.E,PLOT_IDS.VE));
    fn.reactResolutionPlot(PLOT_IDS.WE,traces('WE'),layout(qeTitle(ax.W),`δQ ∥ ${fmtAxis(ax.W)} (${qUnit})`,'δħω (meV)',limits.W,limits.E,PLOT_IDS.WE));
    fn.reactResolutionPlot(PLOT_IDS.UV,traces('UV'),layout(`δQ ∥ ${fmtAxis(ax.U)} vs δQ ∥ ${fmtAxis(ax.V)}`,`δQ ∥ ${fmtAxis(ax.U)} (${qUnit})`,`δQ ∥ ${fmtAxis(ax.V)} (${qUnit})`,limits.UVU||limits.U,limits.UVV||limits.V,PLOT_IDS.UV,true));
  }

  // Removing kept results (Comparison table).
  const setKeepNote=(text,warn=false)=>{ const note=$('resolutionKeepNote'); if(note){ note.textContent=text; note.classList.toggle('warn',warn); } };
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
  for(const tab of document.querySelectorAll('#resolutionResultTabs [data-resolution-view]'))
    tab.addEventListener('click',()=>setView(tab.dataset.resolutionView));
  // Individual: Figure (the four ellipses) / Matrices, kept in the browser.
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
    const row=event.target.closest?.('tr[data-kept-id]');
    if(!row) return;
    const id=Number(row.dataset.keptId);
    selectedId=selectedId===id ? null : id;
    renderResolutionComparison();
  });
  // Save figure: the kept results only (the current row is a preview), the
  // table as the legend above the four plots, one PNG.
  async function saveComparisonFigure(){
    if(!window.Plotly) return;
    const table=document.querySelector('#resolutionComparisonView .resolution-compare-table');
    const rows=shownRows();
    const bodyRows=[...(table?.tBodies[0]?.rows||[])];
    const head2=[...(table?.tHead?.rows[1]?.cells||[])].map(c=>c.textContent);
    const groups=[...(table?.tHead?.rows[0]?.cells||[])].slice(2).map(c=>({text:c.textContent,span:c.colSpan||1}));
    // Rows: [colour, cell texts (after the button and colour columns)].
    const data=bodyRows.map((tr,i)=>rows[i]?.current ? null : [rows[i]?.color||'#000',[...tr.cells].slice(2).map(c=>c.innerText.replace(/\r/g,''))]).filter(Boolean);
    if(!data.length) return;
    const S=2, fs=13, lh=Math.round(fs*1.35), pad=6, sw=16;
    const cv=document.createElement('canvas'), ctx=cv.getContext('2d');
    const font=b=>`${b ? '600 ' : ''}${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw=(t,b)=>{ ctx.font=font(b); return Math.max(0,...String(t).split('\n').map(l=>ctx.measureText(l).width)); };
    const nCols=head2.length;
    const colW=Array.from({length:nCols},(_,j)=>Math.ceil(Math.max(tw(head2[j],true),...data.map(([,c])=>tw(c[j]??'',false)))+2*pad));
    const lines=t=>String(t).split('\n').length;
    const rowH=data.map(([,c])=>Math.max(1,...c.map(lines))*lh+2*pad);
    const headH=lh+2*pad, tableW=sw+2*pad+colW.reduce((a,b)=>a+b,0);
    const tableH=2*headH+rowH.reduce((a,b)=>a+b,0);
    const plots=Object.values(PLOT_IDS).map(id=>$(id)).filter(gd=>gd?.data);
    const pw0=Math.max(...plots.map(gd=>gd.clientWidth),300), ph0=Math.max(...plots.map(gd=>gd.clientHeight),250);
    // The plots take the width of the table when it is wider (same aspect).
    const gap=10, W=Math.max(tableW,2*pw0+gap)+2*gap, pw=(W-3*gap)/2, ph=ph0*pw/pw0, H=gap+tableH+gap+2*ph+gap+gap;
    cv.width=W*S; cv.height=H*S; ctx.scale(S,S);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
    // Table.
    const x0=gap, y0=gap; ctx.strokeStyle='#c9d2db'; ctx.lineWidth=1; ctx.textBaseline='top';
    const colX=[x0+sw+2*pad]; for(const w of colW) colX.push(colX[colX.length-1]+w);
    const line=(x1,y1,x2,y2)=>{ ctx.beginPath(); ctx.moveTo(x1+.5,y1+.5); ctx.lineTo(x2+.5,y2+.5); ctx.stroke(); };
    ctx.fillStyle='#f3f6f9'; ctx.fillRect(x0,y0,tableW,2*headH);
    ctx.fillStyle='#222'; ctx.font=font(true);
    let gx=colX[0];
    for(const g of groups){ let w=0; for(let k=0;k<g.span;k++) w+=colW[(colX.indexOf(gx))+k]||0; ctx.fillText(g.text,gx+(w-ctx.measureText(g.text).width)/2,y0+pad); line(gx,y0,gx,y0+2*headH); gx+=w; }
    head2.forEach((t,j)=>ctx.fillText(t,colX[j]+pad,y0+headH+pad));
    let y=y0+2*headH;
    data.forEach(([color,cells],i)=>{
      ctx.fillStyle=color; ctx.fillRect(x0+pad,y+pad+2,sw,sw-4);
      ctx.fillStyle='#222'; ctx.font=font(false);
      cells.forEach((t,j)=>{ if(colX[j]===undefined) return; String(t).split('\n').forEach((l,n)=>ctx.fillText(l,colX[j]+pad,y+pad+n*lh)); });
      line(x0,y,x0+tableW,y); y+=rowH[i];
    });
    line(x0,y0,x0+tableW,y0); line(x0,y0+headH,x0+tableW,y0+headH); line(x0,y,x0+tableW,y);
    line(x0,y0,x0,y); for(const x of colX) line(x,y0+headH,x,y);
    // Plots, 2 × 2.
    // The plots are drawn for a moment with the kept results only.
    let imgs;
    try{
      renderPlots(rows.filter(k=>!k.current));
      imgs=await Promise.all(plots.map(gd=>Plotly.toImage(gd,{format:'png',width:gd.clientWidth,height:gd.clientHeight,scale:S*pw/pw0})
        .then(src=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }))));
    }finally{ renderPlots(); }
    imgs.forEach((im,i)=>{ const cx=gap+(i%2)*(pw+gap), cy=gap+tableH+gap+Math.floor(i/2)*(ph+gap); ctx.drawImage(im,cx,cy,pw,ph); });
    const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='comparison-figure.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  $('resolutionCompareSaveFigure')?.addEventListener('click',()=>saveComparisonFigure().catch(err=>setKeepNote(`Save figure: ${err?.message||err}`,true)));
  $('calcMode')?.addEventListener('change',updateResolutionKeepState);
  $('unit')?.addEventListener('change',()=>requestAnimationFrame(renderResolutionComparison));
  updateResolutionKeepState();
  { let saved=null; try{ saved=localStorage.getItem(VIEW_KEY); }catch(_e){}
    if(saved==='comparison' && singleMode()) setView('comparison',{store:false}); }
}
