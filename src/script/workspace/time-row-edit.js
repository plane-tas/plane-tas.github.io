// Time estimate: adding, copying and removing command rows.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installTimeRowEdit(ctx){
  const {deps:{
    $, parseNumericValue
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    addTimeScanAfterSelection, addTimeScanRow, copySelectedOrLastTimeScanRows,
    expandTimeRowsToLoopBlocks, removeSelectedTimeScanRows, selectOnlyTimeScanRow, timeScanRowValues
  });

  function formatTimeMcuValue(value){
    const n=parseNumericValue(value);
    return Number.isFinite(n) ? String(Math.floor(Math.max(0,n))) : String(value??'');
  }

  function addTimeScanRow(values={},options={}){
    const host=$('timeScanRows');
    if(!host) return null;
    const normalized=fn.normalizeStoredRow(values);
    const row=document.createElement('div');
    row.className='time-scan-row';
    row.dataset.timeScanId=String(++shared.timeScanRowCounter);
    const initialMcu=String(values.mcu??values.time??((normalized.operation==='wait'||normalized.operation==='count')?(values.ranges?.wait??values.details?.wait??values.mcu??values.time??'') : '')).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    row.innerHTML=`
      <div class="time-scan-cell time-scan-index" data-time-index></div>
      <div class="time-scan-cell time-command-cell">
        <select data-time-operation aria-label="Command">${fn.operationOptions(normalized.operation)}</select>
        <select data-time-variable class="time-internal-command" aria-hidden="true" tabindex="-1"></select>
      </div>
      <div class="time-scan-cell time-target-cell"><select data-time-target aria-label="Target">${fn.targetOptions(normalized.target,normalized.operation)}</select></div>
      <div class="time-scan-cell"><div class="time-range-inputs" data-time-range-host></div></div>
      <div class="time-scan-cell"><span class="time-mcu-entry"><input type="text" inputmode="numeric" data-time-mcu value="${initialMcu}" placeholder="0"></span></div>
      <div class="time-scan-cell time-fix-cell"><input type="checkbox" data-time-fix aria-label="Fix time for this command"></div>`;
    const before=options?.before;
    if(before && before.parentElement===host) host.insertBefore(row,before); else host.appendChild(row);
    const opSelect=row.querySelector('[data-time-operation]');
    const targetSelect=row.querySelector('[data-time-target]');
    const internal=row.querySelector('[data-time-variable]');
    const fix=row.querySelector('[data-time-fix]');
    if(fix) fix.checked=!!values.fixed;
    if(normalized.migrationWarning) row.dataset.timeMigrationWarning=normalized.migrationWarning;

    const syncControlState=()=>{
      const structural=['scantitle','count','wait','loop','endloop'].includes(opSelect.value);
      const previousTarget=targetSelect.value;
      const allowedTargets=fn.targetsForOperation(opSelect.value);
      targetSelect.innerHTML=fn.targetOptions(previousTarget,opSelect.value);
      targetSelect.disabled=structural;
      if(structural) targetSelect.value='';
      else if(allowedTargets.includes(previousTarget)) targetSelect.value=previousTarget;
      else targetSelect.value=allowedTargets.includes('s1')?'s1':(allowedTargets[0]||'');
      const value=fn.internalCommand(opSelect.value,targetSelect.value);
      fn.setInternalSelect(internal,value);
      return value;
    };
    const initialInternal=syncControlState();
    row.dataset.timeCommand=initialInternal;
    const initialTime=row.querySelector('[data-time-mcu]');
    if(initialTime && String(initialTime.value).trim()!=='' && Number.isFinite(parseNumericValue(initialTime.value))) initialTime.value=formatTimeMcuValue(initialTime.value);
    fn.updateTimeScanRowFields(row,normalized.ranges);

    if(initialInternal==='loop' && !options?.suppressAutoPair){
      const endRow=addTimeScanRow({command:'endloop'},{before:row.nextElementSibling,suppressAutoPair:true});
      const pair=`lp${++shared.timeLoopPairCounter}`;
      row.dataset.timeLoopPair=pair;
      if(endRow) endRow.dataset.timeLoopPair=pair;
    }

    const handleSelectionChange=()=>{
      const previous=row.dataset.timeCommand || 'drive:s1';
      const previousPair=previous==='loop' ? fn.matchingTimeLoopRow(row) : null;
      const next=syncControlState();
      if(previous==='loop' && next!=='loop' && previousPair){ previousPair.remove(); delete row.dataset.timeLoopPair; }
      row.dataset.timeCommand=next;
      delete row.dataset.timeMigrationWarning;
      fn.updateTimeScanRowFields(row);
      if(previous!=='loop' && next==='loop'){
        const endRow=addTimeScanRow({command:'endloop'},{before:row.nextElementSibling,suppressAutoPair:true});
        const pair=`lp${++shared.timeLoopPairCounter}`;
        row.dataset.timeLoopPair=pair;
        if(endRow) endRow.dataset.timeLoopPair=pair;
        selectOnlyTimeScanRow(row);
      }
      fn.renumberTimeScanRows();
      fn.clearTimeEstimateMessage();
      fn.updateTimeFixHeaderState();
      fn.saveTimeEstimateState();
      fn.validateAllTimeScanRows({showMessage:true});
    };
    opSelect.addEventListener('change',handleSelectionChange);
    targetSelect.addEventListener('change',handleSelectionChange);

    const timeInput=row.querySelector('[data-time-mcu]');
    timeInput.addEventListener('input',()=>{
      if(timeInput.readOnly) return;
      const parsed=fn.validateTimeMcuInput(timeInput);
      fn.saveTimeEstimateState();
      if(parsed.ok) fn.clearTimeEstimateMessage(); else fn.setTimeEstimateMessage('MCU must be a non-negative whole number (wait uses seconds).',true);
    });
    timeInput.addEventListener('change',()=>{
      if(timeInput.readOnly) return;
      const parsed=fn.validateTimeMcuInput(timeInput);
      if(parsed.ok){ timeInput.value=formatTimeMcuValue(parsed.value); fn.applyMcuToSelectedTimeScans(row,timeInput.value); }
      fn.saveTimeEstimateState();
      fn.validateAllTimeScanRows({showMessage:true});
    });
    fix?.addEventListener('change',()=>{ fn.updateTimeFixHeaderState(); fn.saveTimeEstimateState(); });
    const indexCell=row.querySelector('[data-time-index]');
    if(indexCell){
      indexCell.draggable=true;
      indexCell.title='Click to select; drag to reorder. Loop/endloop moves the complete loop block; Alt-drag a loop boundary to resize its scope.';
      indexCell.addEventListener('click',event=>{ event.stopPropagation(); fn.selectTimeScanIndex(row,event); });
      indexCell.addEventListener('dragstart',event=>fn.startTimeScanDrag(row,event));
      indexCell.addEventListener('dragend',fn.cancelTimeScanDrag);
    }
    fn.renumberTimeScanRows();
    fn.saveTimeEstimateState();
    return row;
  }

  function timeScanRowValues(row){
    if(!row) return null;
    const command=row.querySelector('[data-time-variable]')?.value || 'drive:s1';
    const {op,target}=fn.commandParts(command);
    const ranges={};
    row.querySelectorAll('[data-time-range-key]').forEach(input=>{ ranges[input.dataset.timeRangeKey]=input.value; });
    return {command,operation:op,target,ranges,mcu:row.querySelector('[data-time-mcu]')?.value??'',fixed:!!row.querySelector('[data-time-fix]')?.checked};
  }

  function timeLoopBlockRows(row){
    if(!row) return [];
    const rows=fn.timeScanRows();
    const command=row.querySelector('[data-time-variable]')?.value || '';
    let loopRow=row, endRow=null;
    if(command==='loop') endRow=fn.matchingTimeLoopRow(row);
    else if(command==='endloop'){ loopRow=fn.matchingTimeLoopRow(row); endRow=row; }
    else return [row];
    if(!loopRow || !endRow) return [row];
    const a=rows.indexOf(loopRow), b=rows.indexOf(endRow);
    if(a<0 || b<a) return [row];
    return rows.slice(a,b+1);
  }

  function expandTimeRowsToLoopBlocks(rows){
    const all=fn.timeScanRows();
    const set=new Set();
    for(const row of rows){
      for(const member of timeLoopBlockRows(row)) set.add(member);
    }
    return all.filter(row=>set.has(row));
  }

  function timeScanInsertionReferenceAfterSelection(){
    const selected=fn.selectedTimeScanRows();
    if(!selected.length) return null;
    // selectedTimeScanRows() follows document order, so the final item is the
    // lowest selected index even when the selection is non-contiguous.
    const last=selected[selected.length-1];
    const command=last.querySelector('[data-time-variable]')?.value || '';
    // Selecting a loop command means “insert inside this loop”, immediately
    // before its automatically paired endloop.
    if(command==='loop'){
      const endRow=fn.matchingTimeLoopRow(last);
      if(endRow) return endRow;
    }
    // Selecting an endloop is also treated as an insertion point inside that
    // loop. This makes it possible to grow a newly-created nested loop simply by
    // selecting either boundary and pressing + Add scan.
    if(command==='endloop') return last;
    return last.nextElementSibling;
  }

  function selectOnlyTimeScanRow(row){
    if(!row) return;
    for(const r of fn.timeScanRows()) r.classList.remove('time-scan-selected');
    row.classList.add('time-scan-selected');
    shared.timeScanSelectionAnchor=row;
    fn.updateTimeFixHeaderState();
  }

  function addTimeScanAfterSelection(){
    const before=timeScanInsertionReferenceAfterSelection();
    const row=addTimeScanRow({}, {before});
    // Continue sequence editing from the row that was just inserted. This is
    // especially important for nested loops: if this row is changed to loop,
    // the next + Add scan goes between that loop and its paired endloop instead
    // of using an older outer-loop selection.
    if(row) selectOnlyTimeScanRow(row);
    fn.clearTimeEstimateMessage();
    fn.saveTimeEstimateState();
  }

  function copySelectedOrLastTimeScanRows(){
    const rows=fn.timeScanRows();
    if(!rows.length){ fn.setTimeEstimateMessage('There is no scan to copy.',true); return; }

    const selected=fn.selectedTimeScanRows();
    let sources;
    if(selected.length){
      sources=expandTimeRowsToLoopBlocks(selected);
    }else{
      const last=rows[rows.length-1];
      sources=(last.querySelector('[data-time-variable]')?.value==='endloop') ? timeLoopBlockRows(last) : [last];
    }
    const copies=sources.map(row=>timeScanRowValues(row)).filter(Boolean);
    const before=selected.length ? sources[sources.length-1]?.nextElementSibling || null : null;
    for(const values of copies) addTimeScanRow(values,{before,suppressAutoPair:true});
    fn.ensureTimeLoopPairIds();
    fn.renumberTimeScanRows();
    fn.clearTimeEstimateMessage();
    fn.saveTimeEstimateState();
  }

  function removeSelectedTimeScanRows(){
    const selected=fn.selectedTimeScanRows();
    if(!selected.length) return;
    fn.ensureTimeLoopPairIds();
    const toRemove=new Set(selected);
    for(const row of selected){
      const command=row.querySelector('[data-time-variable]')?.value || '';
      if(command==='loop' || command==='endloop'){
        const pair=fn.matchingTimeLoopRow(row);
        if(pair) toRemove.add(pair);
      }
    }
    for(const row of toRemove){
      if(shared.timeScanSelectionAnchor===row) shared.timeScanSelectionAnchor=null;
      row.remove();
    }
    fn.clearTimeScanSelection();
    fn.ensureTimeLoopPairIds();
    fn.renumberTimeScanRows();
    fn.clearTimeEstimateMessage();
    fn.saveTimeEstimateState();
  }
}
