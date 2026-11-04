// Time estimate: start date, duration and MCU estimates, UI initialisation.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installTimeEstimate(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    initializeTimeEstimateUI, timeEstimateDatePartIds
  });

  function pad2(v){ return String(v).padStart(2,'0'); }
  function ceilDateToMinute(date){
    const d=new Date(date.getTime());
    if(d.getSeconds()!==0 || d.getMilliseconds()!==0) d.setMinutes(d.getMinutes()+1);
    d.setSeconds(0,0);
    return d;
  }
  function timeEstimateDatePartIds(prefix){
    return {
      date:`timeEstimate${prefix}Date`,
      hour:`timeEstimate${prefix}Hour`,
      minute:`timeEstimate${prefix}Minute`
    };
  }
  function writeTimeEstimateDate(prefix,date){
    const ids=timeEstimateDatePartIds(prefix);
    const dateInput=$(ids.date), hourInput=$(ids.hour), minuteInput=$(ids.minute);
    if(dateInput) dateInput.value=`${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
    if(hourInput) hourInput.value=pad2(date.getHours());
    if(minuteInput) minuteInput.value=pad2(date.getMinutes());
    for(const input of [dateInput,hourInput,minuteInput]) fn.setTimeInputInvalid(input,false);
    fn.saveTimeEstimateState();
  }
  function normalizeTimeDigits(input,max){
    if(!input) return;
    let value=String(input.value||'').replace(/\D/g,'').slice(0,2);
    input.value=value;
    if(value==='') return;
    const n=Number(value);
    if(Number.isInteger(n) && n>=0 && n<=max) fn.setTimeInputInvalid(input,false);
  }
  function readTimeEstimateDate(prefix,label){
    const ids=timeEstimateDatePartIds(prefix);
    const dateInput=$(ids.date), hourInput=$(ids.hour), minuteInput=$(ids.minute);
    const dateText=String(dateInput?.value||'').trim();
    const hourText=String(hourInput?.value||'').trim();
    const minuteText=String(minuteInput?.value||'').trim();
    const dateMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    const hour=Number(hourText), minute=Number(minuteText);
    const dateOk=!!dateMatch;
    const hourOk=/^\d{1,2}$/.test(hourText) && Number.isInteger(hour) && hour>=0 && hour<=23;
    const minuteOk=/^\d{1,2}$/.test(minuteText) && Number.isInteger(minute) && minute>=0 && minute<=59;
    fn.setTimeInputInvalid(dateInput,!dateOk);
    fn.setTimeInputInvalid(hourInput,!hourOk);
    fn.setTimeInputInvalid(minuteInput,!minuteOk);
    if(!dateOk || !hourOk || !minuteOk) return {ok:false,error:`Enter a valid ${label} (24-hour HH:MM).`};
    const year=Number(dateMatch[1]), month=Number(dateMatch[2]), day=Number(dateMatch[3]);
    const date=new Date(year,month-1,day,hour,minute,0,0);
    const exact=date.getFullYear()===year && date.getMonth()===month-1 && date.getDate()===day && date.getHours()===hour && date.getMinutes()===minute;
    if(!exact){
      fn.setTimeInputInvalid(dateInput,true);
      return {ok:false,error:`Enter a valid ${label}.`};
    }
    return {ok:true,date,dateInput,hourInput,minuteInput};
  }
  function setTimeEstimateStartToNow(){
    writeTimeEstimateDate('Start',ceilDateToMinute(new Date()));
    fn.clearTimeEstimateMessage();
  }
  function formatEstimatedDuration(seconds){
    const s=Math.max(0,Math.ceil(seconds));
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
    const parts=[];
    if(h) parts.push(`${h} h`);
    if(m || h) parts.push(`${m} min`);
    parts.push(`${sec} s`);
    return parts.join(' ');
  }

  function calculateTimeEstimate(){
    fn.clearTimeEstimateMessage();
    const scanData=readAllTimeScans();
    if(!scanData.ok){ fn.setTimeEstimateMessage(scanData.error,true); return; }
    const startResult=readTimeEstimateDate('Start','scan start time');
    if(!startResult.ok){ fn.setTimeEstimateMessage(startResult.error,true); return; }
    const endExact=new Date(startResult.date.getTime()+scanData.totalSeconds*1000);
    writeTimeEstimateDate('End',ceilDateToMinute(endExact));
    fn.saveTimeEstimateState();
    const movement=scanData.settings.movementPercent>0
      ? ` (base ${formatEstimatedDuration(scanData.baseSeconds)} + movement ${formatEstimatedDuration(scanData.movementSeconds)} at ${scanData.settings.movementPercent}%)`
      : '';
    fn.setTimeEstimateMessage(`Estimated duration: ${formatEstimatedDuration(scanData.totalSeconds)}${movement} / ${scanData.totalPoints} execution step${scanData.totalPoints===1?'':'s'} in ${scanData.rows.length} command${scanData.rows.length===1?'':'s'}.`);
  }

  function readAllTimeScans(){
    const settings=fn.readTimeSettings();
    if(!settings.ok) return settings;
    const rows=[...document.querySelectorAll('#timeScanRows .time-scan-row')];
    if(!rows.length) return {ok:false,error:'Add at least one command.'};
    const validation=fn.validateAllTimeScanRows();
    if(!validation.ok) return {ok:false,error:validation.errors.join(' / ')};

    const scans=[];
    const stack=[];
    let multiplier=1,baseSeconds=0,totalPoints=0;
    for(let i=0;i<rows.length;i++){
      const result=validation.results[i];
      if(result.kind==='loop'){
        const iterations=result.loopIterations||1;
        stack.push({rowIndex:i+1,iterations,previousMultiplier:multiplier});
        multiplier*=iterations;
        if(!Number.isFinite(multiplier) || multiplier>Number.MAX_SAFE_INTEGER){
          fn.setTimeScanRowWarning(rows[i],true);
          return {ok:false,error:`Command ${i+1}: loop nesting produces too many repetitions.`};
        }
        continue;
      }
      if(result.kind==='endloop'){
        const opened=stack.pop();
        if(!opened){
          fn.setTimeScanRowWarning(rows[i],true);
          return {ok:false,error:`Command ${i+1}: endloop has no matching loop.`};
        }
        multiplier=opened.previousMultiplier;
        continue;
      }
      const effectiveSeconds=result.seconds*multiplier;
      const effectivePoints=result.points*multiplier;
      scans.push({row:rows[i],...result,loopMultiplier:multiplier,effectiveSeconds,effectivePoints});
      baseSeconds+=effectiveSeconds;
      totalPoints+=effectivePoints;
    }
    if(stack.length){
      const opened=stack[stack.length-1];
      fn.setTimeScanRowWarning(rows[opened.rowIndex-1],true);
      return {ok:false,error:`Command ${opened.rowIndex}: loop has no matching endloop.`};
    }
    const movementSeconds=baseSeconds*settings.movementPercent/100;
    const totalSeconds=baseSeconds+movementSeconds;
    return {ok:true,rows,scans,baseSeconds,movementSeconds,totalSeconds,totalPoints,settings};
  }

  function validTimeEstimateDateInput(prefix,label){
    return readTimeEstimateDate(prefix,label);
  }

  function formatScaledMcu(value){
    if(!Number.isFinite(value)) return '';
    // Calc MCU must never round upward past the available time.  Display the
    // rescaled scan time as an integer number of seconds by truncating downward.
    return String(Math.floor(Math.max(0,value)));
  }

  function calculateTimeEstimateMcu(){
    fn.clearTimeEstimateMessage();
    const scanData=readAllTimeScans();
    if(!scanData.ok){ fn.setTimeEstimateMessage(scanData.error,true); return; }
    const startResult=validTimeEstimateDateInput('Start','scan start time');
    if(!startResult.ok){ fn.setTimeEstimateMessage(startResult.error,true); return; }
    const endResult=validTimeEstimateDateInput('End','scan finish time');
    if(!endResult.ok){ fn.setTimeEstimateMessage(endResult.error,true); return; }
    const targetSeconds=(endResult.date.getTime()-startResult.date.getTime())/1000;
    if(!(targetSeconds>0)){
      for(const input of [endResult.dateInput,endResult.hourInput,endResult.minuteInput]) fn.setTimeInputInvalid(input,true);
      fn.setTimeEstimateMessage('Scan finish must be later than scan start.',true);
      return;
    }

    const factor=scanData.settings.movementFactor;
    const targetBaseSeconds=targetSeconds/factor;
    const fixedScans=scanData.scans.filter(scan=>scan.fixed);
    const adjustableScans=scanData.scans.filter(scan=>!scan.fixed);
    const fixedSeconds=fixedScans.reduce((sum,scan)=>sum+scan.effectiveSeconds,0);
    const adjustableSeconds=adjustableScans.reduce((sum,scan)=>sum+scan.effectiveSeconds,0);
    const remainingBaseSeconds=targetBaseSeconds-fixedSeconds;
    const eps=1e-9;

    if(remainingBaseSeconds < -eps){
      const fixedWithMovement=fixedSeconds*factor;
      fn.setTimeEstimateMessage(`Fixed commands plus movement overhead already require ${formatEstimatedDuration(fixedWithMovement)}, which exceeds the available ${formatEstimatedDuration(targetSeconds)}.`,true);
      return;
    }
    if(!adjustableScans.length){
      const difference=Math.abs(targetSeconds-scanData.totalSeconds);
      if(difference<=0.01) fn.setTimeEstimateMessage('All adjustable scan MCU values are fixed. The current settings already match the requested finish time.');
      else fn.setTimeEstimateMessage('There are no unfixed scan MCU values available to adjust.',true);
      return;
    }
    if(!(adjustableSeconds>0)){
      if(remainingBaseSeconds<=eps){
        for(const scan of adjustableScans){
          const input=scan.row.querySelector('[data-time-mcu]');
          if(input) input.value='0';
        }
        fn.saveTimeEstimateState();
        fn.setTimeEstimateMessage('Unfixed scan MCU values set to 0; fixed commands and movement overhead use the full available time.');
        return;
      }
      fn.setTimeEstimateMessage('At least one unfixed scan MCU value must be greater than zero to use the entered MCU values as relative weights.',true);
      return;
    }

    const scale=Math.max(0,remainingBaseSeconds)/adjustableSeconds;
    for(const scan of adjustableScans){
      const input=scan.row.querySelector('[data-time-mcu]');
      if(!input) continue;
      input.value=formatScaledMcu((scan.mcuValue??scan.mcuSeconds)*scale);
      fn.setTimeInputInvalid(input,false);
    }
    fn.saveTimeEstimateState();
    const updated=readAllTimeScans();
    const actual=updated.ok?updated.totalSeconds:targetSeconds;
    const movementText=scanData.settings.movementPercent>0?` Movement overhead: ${scanData.settings.movementPercent}%.`:'';
    fn.setTimeEstimateMessage(`Unfixed scan MCU values scaled by ×${Number(scale.toPrecision(6))}; ${fixedScans.length} fixed command${fixedScans.length===1?'':'s'} unchanged.${movementText} Target duration: ${formatEstimatedDuration(targetSeconds)}; calculated duration: ${formatEstimatedDuration(actual)}.`);
  }

  function initializeTimeEstimateUI(){
    $('geometryTabAngles')?.addEventListener('click',()=>fn.setGeometryCardTab('angles'));
    $('geometryTabTime')?.addEventListener('click',()=>fn.setGeometryCardTab('time'));
    $('timeAddScan')?.addEventListener('click',event=>{ event.stopPropagation(); fn.addTimeScanAfterSelection(); });
    $('timeCopyScan')?.addEventListener('click',event=>{ event.stopPropagation(); fn.copySelectedOrLastTimeScanRows(); });
    $('timeRemoveScan')?.addEventListener('click',event=>{ event.stopPropagation(); fn.removeSelectedTimeScanRows(); });
    $('timeEstimateCalc')?.addEventListener('click',calculateTimeEstimate);
    $('timeEstimateCalcMcu')?.addEventListener('click',calculateTimeEstimateMcu);
    $('timeEstimateNow')?.addEventListener('click',setTimeEstimateStartToNow);
    for(const id of ['timeMcuSecondsPerUnit','timeMovementPercent']){
      $(id)?.addEventListener('input',()=>{ fn.saveTimeEstimateState(); fn.clearTimeEstimateMessage(); });
      $(id)?.addEventListener('change',()=>{
        fn.saveTimeEstimateState();
        const settings=fn.readTimeSettings();
        if(!settings.ok) fn.setTimeEstimateMessage(settings.error,true);
        else fn.validateAllTimeScanRows({showMessage:true});
      });
    }
    window.addEventListener('resize',()=>{if(fn.currentGeometryCardTab()==='time'){fn.updateTimeScanScrollState();}});
    $('timeFixAll')?.addEventListener('click',event=>event.stopPropagation());
    $('timeFixAll')?.addEventListener('change',fn.applyTimeFixHeader);
    const scanWrap=document.querySelector('#geometryTimePane .time-scan-table-wrap');
    scanWrap?.addEventListener('dragover',fn.updateTimeScanDragTarget);
    scanWrap?.addEventListener('drop',fn.finishTimeScanDrop);
    scanWrap?.addEventListener('dragleave',event=>{
      if(!shared.timeScanDragState) return;
      if(event.relatedTarget && scanWrap.contains(event.relatedTarget)) return;
      fn.clearTimeScanDragMarkers();
      shared.timeScanDragState.rows.forEach(r=>r.classList.add('time-drag-source'));
      shared.timeScanDragState.target=null;
    });
    document.addEventListener('click',event=>{
      if(!fn.selectedTimeScanRows().length) return;
      if(event.target.closest?.('.time-scan-table-wrap')) return;
      fn.clearTimeScanSelection();
    });
    for(const id of ['a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl','instrument','energy','energyMode','S2min']){
      $(id)?.addEventListener('change',()=>{
        const scriptActive=$('tabScript')?.classList.contains('active');
        if(fn.currentGeometryCardTab()==='time' || scriptActive) fn.validateAllTimeScanRows({showMessage:true});
      });
    }
    for(const prefix of ['Start','End']){
      const ids=timeEstimateDatePartIds(prefix);
      $(ids.date)?.addEventListener('input',()=>{ fn.setTimeInputInvalid($(ids.date),false); fn.clearTimeEstimateMessage(); fn.saveTimeEstimateState(); });
      $(ids.hour)?.addEventListener('input',()=>{ normalizeTimeDigits($(ids.hour),23); fn.clearTimeEstimateMessage(); fn.saveTimeEstimateState(); });
      $(ids.minute)?.addEventListener('input',()=>{ normalizeTimeDigits($(ids.minute),59); fn.clearTimeEstimateMessage(); fn.saveTimeEstimateState(); });
      $(ids.hour)?.addEventListener('blur',()=>{ const input=$(ids.hour); if(input?.value!=='') input.value=pad2(Number(input.value)); readTimeEstimateDate(prefix,`${prefix.toLowerCase()} time`); fn.saveTimeEstimateState(); });
      $(ids.minute)?.addEventListener('blur',()=>{ const input=$(ids.minute); if(input?.value!=='') input.value=pad2(Number(input.value)); readTimeEstimateDate(prefix,`${prefix.toLowerCase()} time`); fn.saveTimeEstimateState(); });
      $(ids.date)?.addEventListener('change',()=>{ readTimeEstimateDate(prefix,`${prefix.toLowerCase()} time`); fn.saveTimeEstimateState(); });
    }
    const restored=fn.restoreTimeEstimateState();
    if(!restored){
      if(!$('timeScanRows')?.children.length) fn.addTimeScanRow({variable:'s1'});
      if(!$('timeEstimateStartDate')?.value) setTimeEstimateStartToNow();
      fn.setGeometryCardTab('angles');
      fn.saveTimeEstimateState();
    }
  }
}
