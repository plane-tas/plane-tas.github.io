// Time estimate: stored state, geometry card tab, row warnings and scattering-plane checks.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
import {OUT_OF_PLANE_TOLERANCE_DEG} from '../../core/tas-core.js';
export function installTimeState(ctx){
  const {deps:{
    $, buildResolutionLattice, checkedValue, cross, currentInstrument, dot, hklToQ, norm, num,
    renderGeometry, safeResizePlot, userFacingTasMessage
  }, state:shared, fn}=ctx;
  const deps=ctx.deps;   // live app state read through getters on deps (singleCache, powderCache)
  Object.assign(fn,{
    currentGeometryCardTab, hklInCurrentScatteringPlane, restoreTimeEstimateState,
    saveTimeEstimateState, scatteringPlaneWarningMessage, setGeometryCardTab,
    setScatteringPlaneWarning, setTimeScanRowWarning, setTimeScanS2LimitWarning, timeHklValueAt,
    validateHkleScanPlane
  });

  // ==================== Time estimate ====================
  shared.timeScanRowCounter=0;
  shared.timeScanSelectionAnchor=null;
  shared.timeScanDragState=null;
  shared.timeLoopPairCounter=0;
  const TIME_ESTIMATE_STORAGE_KEY='tas-simulator-time-estimate-v1';
  let restoringTimeEstimate=false;

  function setGeometryCardTab(name){
    const time=name==='time';
    $('geometryTabAngles')?.classList.toggle('active',!time);
    $('geometryTabTime')?.classList.toggle('active',time);
    $('geometryTabAngles')?.setAttribute('aria-selected',String(!time));
    $('geometryTabTime')?.setAttribute('aria-selected',String(time));
    $('geometryAnglesPane')?.classList.toggle('hidden',time);
    $('geometryTimePane')?.classList.toggle('hidden',!time);
    $('singleMain')?.querySelector('.chart-grid')?.classList.toggle('time-estimate-active',time);
    saveTimeEstimateState();
    if(time && $('timeScanRows')?.children.length){
      requestAnimationFrame(()=>fn.validateAllTimeScanRows({showMessage:true}));
    }
    // Both tabs share the same card width. Resize Plotly after switching panes
    // so it follows any responsive layout change without changing column widths.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const powder=checkedValue('sampleMode')==='powder';
      safeResizePlot($(powder?'powderPlot':'singlePlot'));
      if(!time && (powder ? deps.powderCache : deps.singleCache)){
        // Rebuild the newly visible TAS geometry after layout has settled.
        // This covers both Single and Scan geometry panes.
        if(powder) renderGeometry(deps.powderCache,0);
        else renderGeometry(deps.singleCache,Number($('hwSlider')?.value)||0);
      }
      if(time){
        fn.updateTimeScanScrollState();
      }
    }));
  }

  function currentGeometryCardTab(){
    return $('geometryTabTime')?.classList.contains('active') ? 'time' : 'angles';
  }

  function timeEstimateStoredState(){
    const rows=[...document.querySelectorAll('#timeScanRows .time-scan-row')]
      .map(fn.timeScanRowValues).filter(Boolean);
    const fields={};
    for(const prefix of ['Start','End']){
      const ids=fn.timeEstimateDatePartIds(prefix);
      fields[prefix.toLowerCase()]={
        date:$(ids.date)?.value||'',
        hour:$(ids.hour)?.value||'',
        minute:$(ids.minute)?.value||''
      };
    }
    return {version:5,tab:currentGeometryCardTab(),rows,fields,settings:{
      mcuSecondsPerUnit:String($('timeMcuSecondsPerUnit')?.value||'1'),
      movementPercent:String($('timeMovementPercent')?.value||'1')
    }};
  }

  function saveTimeEstimateState(){
    if(restoringTimeEstimate) return;
    try{ localStorage.setItem(TIME_ESTIMATE_STORAGE_KEY,JSON.stringify(timeEstimateStoredState())); }
    catch(_e){ /* localStorage can be unavailable in restricted browser contexts. */ }
  }

  function restoreTimeEstimateState(){
    let saved;
    try{ saved=JSON.parse(localStorage.getItem(TIME_ESTIMATE_STORAGE_KEY)||'null'); }
    catch(_e){ return false; }
    if(!saved || ![1,2,3,4,5].includes(saved.version) || !Array.isArray(saved.rows)) return false;
    restoringTimeEstimate=true;
    try{
      const host=$('timeScanRows');
      if(host) host.replaceChildren();
      shared.timeScanRowCounter=0;
      shared.timeLoopPairCounter=0;
      for(const values of saved.rows) fn.addTimeScanRow(values||{},{suppressAutoPair:true});
      fn.ensureTimeLoopPairIds();
      if(!saved.rows.length) fn.addTimeScanRow({variable:'s1'});
      for(const prefix of ['Start','End']){
        const ids=fn.timeEstimateDatePartIds(prefix);
        const values=saved.fields?.[prefix.toLowerCase()]||{};
        if($(ids.date)) $(ids.date).value=String(values.date||'');
        if($(ids.hour)) $(ids.hour).value=String(values.hour||'');
        if($(ids.minute)) $(ids.minute).value=String(values.minute||'');
      }
      if($('timeMcuSecondsPerUnit')) $('timeMcuSecondsPerUnit').value=String(saved.settings?.mcuSecondsPerUnit||'1');
      if($('timeMovementPercent')) $('timeMovementPercent').value=String(saved.settings?.movementPercent??'1');
      setGeometryCardTab(saved.tab==='time'?'time':'angles');
      fn.updateTimeScanScrollState();
      fn.updateTimeFixHeaderState();
      return true;
    }finally{ restoringTimeEstimate=false; }
  }

  function setTimeScanRowWarning(row,warning){
    if(!row) return;
    row.classList.toggle('time-scan-warning',!!warning);
    const index=row.querySelector('[data-time-index]');
    if(index) index.setAttribute('aria-invalid',warning?'true':'false');
  }


  function setTimeScanS2LimitWarning(row,warning,message=''){
    if(!row) return;
    row.classList.toggle('time-s2-limit-warning',!!warning);
    if(warning && message) row.dataset.timeS2Warning=message;
    else delete row.dataset.timeS2Warning;
  }

  function timeHklValueAt(parsed,index){
    if(parsed.fixed) return parsed.value;
    const direction=parsed.final>=parsed.initial ? 1 : -1;
    return parsed.initial + direction*parsed.step*index;
  }

  function hklInCurrentScatteringPlane(hkl){
    // Four-circle instruments reach out-of-plane Q by tilting chi.
    let fourCircle=false;
    try{ fourCircle=currentInstrument()?.instrument_type==='four-circle'; }catch(_e){}
    if(fourCircle) return {ok:true,fourCircle:true};
    try{
      const {rl}=buildResolutionLattice();
      const U=[num('Uh'),num('Uk'),num('Ul')], V=[num('Vh'),num('Vk'),num('Vl')];
      const qU=hklToQ(rl,U), qV=hklToQ(rl,V), q=hklToQ(rl,hkl);
      const normal=cross(qU,qV), nn=norm(normal), qn=norm(q);
      if(!(nn>1e-12)) return {ok:false,error:'Current U and V do not define a valid scattering plane.'};
      if(qn<=1e-12) return {ok:true};
      // Up to OUT_OF_PLANE_TOLERANCE_DEG out of the plane counts as in-plane
      // (reached by tilting the sample).
      const relative=Math.abs(dot(normal,q))/(nn*qn);
      const tiltDeg=Math.asin(Math.min(1,relative))*180/Math.PI;
      return {ok:tiltDeg<=OUT_OF_PLANE_TOLERANCE_DEG+1e-9,relative,tiltDeg};
    }catch(err){
      return {ok:false,error:userFacingTasMessage(err?.message||String(err))};
    }
  }

  function setScatteringPlaneWarning(boxId,message){
    const box=$(boxId);
    if(!box) return;
    let text=String(message||'').trim();
    // In the Q-E map and TAS geometry panels, use the concise plane-status
    // message. Retain detailed diagnostics for malformed U/V orientation data.
    if((boxId==='qeVectorPlaneWarning' || boxId==='geometryPlaneWarning') &&
       /outside the current U-V scattering plane/i.test(text)){
      text='Warning: Out of plane';
    }
    box.textContent=text;
    box.classList.toggle('hidden',!text);
  }

  function scatteringPlaneWarningMessage(hkl,label='HKL'){
    const result=hklInCurrentScatteringPlane(hkl);
    if(result.ok) return '';
    if(result.error) return `Warning: ${result.error}`;
    return `Warning: ${label} (${hkl.map(v=>Number(v).toFixed(3)).join(', ')}) is outside the current U-V scattering plane.`;
  }

  function validateHkleScanPlane(parsedByKey,points){
    const last=Math.max(0,points-1);
    for(const i of [...new Set([0,last])]){
      const hkl=['h','k','l'].map(key=>timeHklValueAt(parsedByKey[key],i));
      const result=hklInCurrentScatteringPlane(hkl);
      if(!result.ok) return {ok:false,hkl,error:result.error};
    }
    return {ok:true};
  }
}
