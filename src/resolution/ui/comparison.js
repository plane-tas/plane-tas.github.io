// Resolution: comparison of kept single-point results.
// Part of the Resolution tab UI (see ../resolution-ui.js for how the parts are wired).
//
// In Mode = single, "+ Keep this result" stores the current result; the
// Comparison tab lists the kept results in a table (monochromator / analyzer
// focusing, 1st-4th collimations, resolution widths) and overlays their
// ellipses, one colour per result (solid: projection, dashed: slice).
// Clicking a row highlights that result.  Kept results live for the session.
export function installResolutionComparison(ctx){
  const {deps:{$}, state:shared, fn}=ctx;
  Object.assign(fn,{renderResolutionComparison, updateResolutionKeepState});

  const MAX_KEPT=6;
  const COLORS=['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf'];
  const PLOT_IDS={UE:'plotCmpUE',VE:'plotCmpVE',UV:'plotCmpUV',WE:'plotCmpWE'};
  shared.keptResolutions=[];
  let selectedId=null, nextId=1, view='calculation';

  const singleMode=()=>$('calcMode')?.value!=='scan';
  // All kept results share the unit and Q axes of the first one; they are
  // shown in that unit / frame whatever the current selection is.
  const COORD_NAMES={q:'Q∥, Q⊥, E, W',orthogonal:'U, U⊥in, E, U⊥out',lattice:'U, V, E, W'};
  const unitName=u=>u==='rlu'?'r.l.u.':'Å⁻¹';
  const frameFor=(r,c)=>c==='lattice'&&r?.lattice ? r.lattice : c==='q'&&r?.qframe ? r.qframe : r;
  const keptSetting=()=>shared.keptResolutions.length ? {unit:shared.keptResolutions[0].unit,coords:shared.keptResolutions[0].coords,instrument:shared.keptResolutions[0].instrument,instrumentName:shared.keptResolutions[0].instrumentName} : null;
  // Condition of a result, in four compact columns:
  //   point "(1,0,0) ħω=0 meV"
  //   mono  "PG(002), Ei=4.8 meV\nH: flat (1 blade)\nV: focusing (7 blades)", ana (same, with Ef)
  //   col   "H: 40-999-244(R)-999,\nV: 120-120-120-120"
  // ((R): radial 3rd collimator, the value being its equivalent divergence;
  // SM(m=…): supermirror guide).
  const focusText=(check,blades)=>{
    const n=String($(blades)?.value??'').trim()||'?';
    return `${$(check)?.checked ? 'focusing' : 'flat'} (${n} ${Number(n)===1 ? 'blade' : 'blades'})`;
  };
  const crystalText=id=>{ const el=$(id); return el?.selectedOptions?.[0]?.text || el?.value || '?'; };
  const energyText=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(3))) : '?'; };
  const currentCondition=(entry)=>{
    const value=id=>{ const raw=String($(id)?.value??'').trim(); return raw==='' ? '–' : raw; };
    const sm=$('gm1')?.checked ? `SM(m=${value('div1m')})` : null;
    const c3=entry?.result?.collimation3?.radial
      ? `${Number.isFinite(entry.result.collimation3.fwhmArcmin) ? Math.round(entry.result.collimation3.fwhmArcmin) : '?'}(R)` : value('div3h');
    const en=entry?.result?.energies||{};
    const f=v=>{ const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(4))) : String(v); };
    const calc=entry?.calc||{};
    return {
      point:`(${f(calc.h)},${f(calc.k)},${f(calc.l)}) ħω=${f(calc.hw)} meV`,
      mono:`${crystalText('monoCrystal')}, Ei=${energyText(en.Ei)} meV\nH: ${focusText('monoHF','monoHB')}\nV: ${focusText('monoVF','monoVB')}`,
      ana:`${crystalText('anaCrystal')}, Ef=${energyText(en.Ef)} meV\nH: ${focusText('anaHF','anaHB')}\nV: ${focusText('anaVF','anaVB')}`,
      col:`H: ${[sm||value('div1h'),value('div2h'),c3,value('div4h')].join('-')},\nV: ${[sm||value('div1v'),value('div2v'),value('div3v'),value('div4v')].join('-')}`
    };
  };
  // Instrument (and type) of a result: results of different instruments are not compared.
  const currentInstrumentKey=()=>`${$('instrument')?.value||''}|${$('instrumentType')?.value||''}`;
  const currentInstrumentName=()=>{ const sel=$('instrument'); const t=$('instrumentType'); return `${sel?.selectedOptions?.[0]?.text||sel?.value||''}${t && t.options.length>1 ? ` (${t.selectedOptions?.[0]?.text||t.value})` : ''}`; };
  const conditionDetail=entry=>{
    const {result:r,calc}=entry, f=v=>Number(v).toFixed(3);
    return `${$('method')?.value||''}; Ei=${f(r.energies.Ei)} meV, Ef=${f(r.energies.Ef)} meV; `+
      `(h,k,l)=(${f(calc.h)}, ${f(calc.k)}, ${f(calc.l)}), ħω=${f(calc.hw)} meV`;
  };

  function updateResolutionKeepState(){
    const row=$('resolutionKeepRow'), btn=$('resolutionKeepResult');
    const last=shared.lastResolutionRender;
    const usable=singleMode() && last && !last.scan && last.entry && !last.entry.failed;
    if(row) row.hidden=!singleMode();
    if(btn){
      btn.disabled=!usable || shared.keptResolutions.length>=MAX_KEPT;
      btn.title=shared.keptResolutions.length>=MAX_KEPT ? `At most ${MAX_KEPT} results can be kept; remove one in the Comparison tab.` : 'Add this result to the Comparison tab';
    }
    const tabs=$('resolutionResultTabs');
    if(tabs) tabs.hidden=!singleMode();
    if(!singleMode() && view!=='calculation') setView('calculation');
    const count=$('resolutionCompareCount');
    if(count) count.textContent=shared.keptResolutions.length ? `(${shared.keptResolutions.length})` : '';
  }

  function keepCurrent(){
    const last=shared.lastResolutionRender;
    if(!last || last.scan || !last.entry || last.entry.failed) return;
    if(shared.keptResolutions.length>=MAX_KEPT) return;
    const used=new Set(shared.keptResolutions.map(k=>k.color));
    const color=COLORS.find(c=>!used.has(c)) || COLORS[0];
    const entry=last.entry, coords=fn.resolutionCoordinates(), setting=keptSetting();
    const note=$('resolutionKeepNote');
    if(setting && setting.instrument!==currentInstrumentKey()){
      if(note){ note.textContent=`Not kept: the kept results are for ${setting.instrumentName}. Results of different instruments cannot be compared; clear the Comparison first.`; note.classList.add('warn'); }
      return;
    }
    if(setting && (setting.unit!==entry.unitMode || setting.coords!==coords)){
      if(note){
        note.textContent=`Not kept: the kept results use ${unitName(setting.unit)} and Q axes ${COORD_NAMES[setting.coords]}. `+
          `A result with a different unit or Q axes cannot be compared; switch back, or clear the Comparison first.`;
        note.classList.add('warn');
      }
      return;
    }
    const kept={id:nextId++,color,condition:currentCondition(entry),entry,detail:'',unit:entry.unitMode,coords,instrument:currentInstrumentKey(),instrumentName:currentInstrumentName()};
    kept.detail=conditionDetail(entry);
    shared.keptResolutions.push(kept);
    if(note){ note.textContent=`Kept as #${shared.keptResolutions.length} (see Comparison).`; note.classList.remove('warn'); }
    updateResolutionKeepState();
    renderResolutionComparison();
  }

  function setView(name){
    view=name==='comparison' ? 'comparison' : 'calculation';
    for(const tab of document.querySelectorAll('#resolutionResultTabs [data-resolution-view]')){
      const on=tab.dataset.resolutionView===view;
      tab.classList.toggle('active',on); tab.setAttribute('aria-selected',String(on));
    }
    if($('resolutionCalculationView')) $('resolutionCalculationView').hidden=view!=='calculation';
    if($('resolutionComparisonView')) $('resolutionComparisonView').hidden=view!=='comparison';
    if(view==='comparison') requestAnimationFrame(renderResolutionComparison);
    else requestAnimationFrame(()=>{ for(const id of Object.values(shared.RESOLUTION_PLOT_IDS||{})){ const gd=$(id); if(gd?._fullLayout && window.Plotly) Plotly.Plots.resize(gd); } });
  }

  // Table: one row per kept result.
  //   # | point, mono, ana, col | widths along the axes | clear
  function renderTable(){
    const head=$('resolutionCompareHead'), body=$('resolutionCompareRows');
    if(!body || !head) return;
    body.replaceChildren(); head.replaceChildren();
    const setting=keptSetting(), qUnit=unitName(setting?.unit||$('unit')?.value||'rlu');
    const empty=!shared.keptResolutions.length;
    if(!empty){
      const first=shared.keptResolutions[0].entry;
      const fr=frameFor(first.result,setting.coords), ax=fr.displayAxes || first.result.displayAxes || {U:first.lc.sv1,V:first.lc.sv2,W:first.lc.sv3};
      const axis=v=>`δQ//(${v.map(x=>{ const y=Number(x); return Math.abs(y-Math.round(y))<1e-10 ? String(Math.round(y)) : Number(y.toPrecision(4)); }).join(',')})`;
      const cell=(tag,text,attrs={})=>{ const c=document.createElement(tag); c.textContent=text; for(const [k,v] of Object.entries(attrs)) c.setAttribute(k,v); return c; };
      const r1=document.createElement('tr'), r2=document.createElement('tr');
      r1.append(cell('th','',{rowspan:'2',class:'cmp-index'}),cell('th',`condition — ${setting.instrumentName}`,{colspan:'4',class:'cmp-group'}),cell('th',`resolution (${qUnit})`,{colspan:'4',class:'cmp-group cmp-res-start'}));
      const allTh=document.createElement('th'); allTh.className='cmp-action';
      const all=document.createElement('button'); all.type='button'; all.id='resolutionCompareClear'; all.textContent='clear all'; all.className='resolution-compare-clear';
      allTh.appendChild(all); r1.appendChild(allTh);
      for(const name of ['point','mono','ana','col']) r2.appendChild(cell('th',name));
      r2.append(cell('th',axis(ax.U),{class:'cmp-res-start'}),cell('th',axis(ax.V)),cell('th',axis(ax.W)),cell('th','δħω (meV)'),cell('th','',{class:'cmp-action'}));
      head.append(r1,r2);
    }
    for(const [i,k] of shared.keptResolutions.entries()){
      const tr=document.createElement('tr');
      tr.dataset.keptId=String(k.id);
      tr.className=k.id===selectedId ? 'selected' : '';
      tr.title=k.detail;
      const td=(text,cls='')=>{ const c=document.createElement('td'); c.textContent=text; if(cls) c.className=cls; return c; };
      const idx=document.createElement('td'); idx.className='cmp-index';
      idx.innerHTML=`<span class="resolution-compare-chip" style="background:${k.color}"></span>${i+1}`;
      tr.appendChild(idx);
      for(const key of ['point','mono','ana','col']) tr.appendChild(td(k.condition[key],key==='point' ? 'cmp-cond' : 'cmp-cond cmp-col'));
      const d=frameFor(k.entry.result,k.coords).display, w=(a,b)=>`${a.toFixed(4)} (${b.toFixed(4)})`;
      tr.append(td(w(d.U,d.Ucoh),'cmp-num cmp-res cmp-res-start'),td(w(d.V,d.Vcoh),'cmp-num cmp-res'),td(w(d.W,d.Wcoh),'cmp-num cmp-res'),td(w(d.E,d.Ecoh),'cmp-num cmp-res'));
      const act=document.createElement('td'); act.className='cmp-action';
      const btn=document.createElement('button'); btn.type='button'; btn.className='resolution-compare-remove'; btn.textContent='clear';
      btn.title='Remove this result'; btn.dataset.removeId=String(k.id);
      act.appendChild(btn); tr.appendChild(act);
      body.appendChild(tr);
    }
    if($('resolutionCompareEmpty')) $('resolutionCompareEmpty').hidden=!empty;
    const wrap=document.querySelector('#resolutionComparisonView .resolution-compare-table-wrap');
    if(wrap) wrap.hidden=empty;
    const plots=document.querySelector('#resolutionComparisonView .resolution-compare-plots');
    if(plots) plots.hidden=empty;
  }

  function renderResolutionComparison(){
    updateResolutionKeepState();
    renderTable();
    const viewEl=$('resolutionComparisonView');
    if(!viewEl || viewEl.hidden || !window.Plotly) return;
    const drawn=shared.keptResolutions, setting=keptSetting();
    if(!drawn.length){ for(const id of Object.values(PLOT_IDS)){ const gd=$(id); if(gd) try{ Plotly.purge(gd); }catch(_e){} } return; }
    // Plot ranges: the largest of the kept results, in their (common) frame.
    const limits={};
    for(const k of drawn){
      const lim=frameFor(k.entry.result,k.coords).lim||{};
      for(const [key,v] of Object.entries(lim)) if(Number(v)>(limits[key]||0)) limits[key]=Number(v);
    }
    const first=drawn[0].entry, firstFrame=frameFor(first.result,setting.coords);
    const ax=firstFrame.displayAxes || first.result.displayAxes || {U:first.lc.sv1,V:first.lc.sv2,W:first.lc.sv3}, fmtAxis=fn.formatResolutionAxis;
    const qUnit=unitName(setting.unit);
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
        const name=`#${shared.keptResolutions.indexOf(k)+1}`;
        for(const [kind,dash] of [['proj','solid'],['slice','dash']]){
          const p=el[`${kind}${key}`]; if(!p) continue;
          const t=fn.traceEllipse(p,`${name} ${kind==='proj'?'projection':'slice'}`,dash);
          t.line={dash,color:k.color,width:st.width}; t.opacity=st.opacity;
          t.hovertemplate=`${name}<br>`+t.hovertemplate;
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

  // Event wiring (the Results section is static HTML).
  $('resolutionKeepResult')?.addEventListener('click',keepCurrent);
  for(const tab of document.querySelectorAll('#resolutionResultTabs [data-resolution-view]'))
    tab.addEventListener('click',()=>setView(tab.dataset.resolutionView));
  document.querySelector('#resolutionComparisonView .resolution-compare-table')?.addEventListener('click',event=>{
    if(event.target.closest?.('#resolutionCompareClear')){
      shared.keptResolutions=[]; selectedId=null;
      const note=$('resolutionKeepNote'); if(note){ note.textContent=''; note.classList.remove('warn'); }
      renderResolutionComparison();
      return;
    }
    const remove=event.target.closest?.('[data-remove-id]');
    if(remove){
      const id=Number(remove.dataset.removeId);
      shared.keptResolutions=shared.keptResolutions.filter(k=>k.id!==id);
      if(selectedId===id) selectedId=null;
      renderResolutionComparison();
      return;
    }
    const row=event.target.closest?.('tr[data-kept-id]');
    if(!row) return;
    const id=Number(row.dataset.keptId);
    selectedId=selectedId===id ? null : id;
    renderResolutionComparison();
  });
  $('calcMode')?.addEventListener('change',updateResolutionKeepState);
  $('unit')?.addEventListener('change',()=>requestAnimationFrame(renderResolutionComparison));
  updateResolutionKeepState();
}
