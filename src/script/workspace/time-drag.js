// Time estimate: row selection, drag and drop, fix header and numbering.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installTimeDrag(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    applyTimeFixHeader, cancelTimeScanDrag, clearTimeScanDragMarkers, clearTimeScanSelection,
    finishTimeScanDrop, renumberTimeScanRows, selectTimeScanIndex, startTimeScanDrag,
    updateTimeScanDragTarget, updateTimeScanScrollState
  });

  function clearTimeScanSelection(){
    for(const row of fn.timeScanRows()) row.classList.remove('time-scan-selected');
    shared.timeScanSelectionAnchor=null;
    fn.updateTimeFixHeaderState();
  }

  function selectTimeScanIndex(row,event){
    const rows=fn.timeScanRows();
    const index=rows.indexOf(row);
    if(index<0) return;
    const anchorIndex=shared.timeScanSelectionAnchor ? rows.indexOf(shared.timeScanSelectionAnchor) : -1;
    if(event.shiftKey && anchorIndex>=0){
      for(const r of rows) r.classList.remove('time-scan-selected');
      const a=Math.min(anchorIndex,index), b=Math.max(anchorIndex,index);
      for(let i=a;i<=b;i++) rows[i].classList.add('time-scan-selected');
    }else if(event.ctrlKey || event.metaKey){
      row.classList.toggle('time-scan-selected');
      shared.timeScanSelectionAnchor=row;
    }else{
      for(const r of rows) r.classList.remove('time-scan-selected');
      row.classList.add('time-scan-selected');
      shared.timeScanSelectionAnchor=row;
    }
    fn.updateTimeFixHeaderState();
  }

  function clearTimeScanDragMarkers(){
    for(const row of fn.timeScanRows()) row.classList.remove('time-drag-before','time-drag-after','time-drag-source');
    document.querySelectorAll('#timeScanRows .time-loop-empty-dropzone, #timeScanRows .time-edge-dropzone').forEach(zone=>zone.classList.remove('time-drop-active'));
  }

  function startTimeScanDrag(row,event){
    if(!row || !event?.dataTransfer) return;
    fn.ensureTimeLoopPairIds();
    if(!row.classList.contains('time-scan-selected')){
      for(const r of fn.timeScanRows()) r.classList.remove('time-scan-selected');
      row.classList.add('time-scan-selected');
      shared.timeScanSelectionAnchor=row;
      fn.updateTimeFixHeaderState();
    }
    let rows=fn.selectedTimeScanRows();
    if(!rows.length) return;

    const command=row.querySelector('[data-time-variable]')?.value || '';
    // Normal index dragging always reorders a complete loop block.  This keeps
    // nested loops freely movable as units (loop1 may contain loop2, and loop2
    // can still be moved before/after other commands without tearing its pair
    // apart).  Alt-drag retains the older boundary-resize gesture for users who
    // explicitly want to slide only loopN/endloopN.
    const boundaryDrag=rows.length===1 && (command==='loop' || command==='endloop') && !!event.altKey;
    if(boundaryDrag){
      rows=[row];
      shared.timeScanDragState={
        rows,
        target:null,
        mode:null,
        boundary:true,
        boundaryType:command==='loop'?'start':'end',
        pairRow:fn.matchingTimeLoopRow(row)
      };
    }else{
      rows=fn.expandTimeRowsToLoopBlocks(rows);
      shared.timeScanDragState={rows,target:null,after:false,boundary:false};
    }
    rows.forEach(r=>r.classList.add('time-drag-source'));
    document.querySelector('#geometryTimePane .time-scan-table-wrap')?.classList.add('time-dragging');
    refreshEmptyTimeLoopDropzones();
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',rows.map(r=>r.dataset.timeScanId||'').join(','));
  }

  function updateTimeScanDragTarget(event){
    if(!shared.timeScanDragState) return;

    const edgeZone=event.target.closest?.('.time-edge-dropzone');
    if(edgeZone){
      event.preventDefault();
      clearTimeScanDragMarkers();
      shared.timeScanDragState.rows.forEach(r=>r.classList.add('time-drag-source'));
      edgeZone.classList.add('time-drop-active');
      shared.timeScanDragState.target=edgeZone;
      shared.timeScanDragState.mode=edgeZone.dataset.timeEdge==='start'?'edge-start':'edge-end';
      if(event.dataTransfer) event.dataTransfer.dropEffect='move';
      return;
    }

    // A loop/endloop boundary drag is different from an ordinary command drag:
    // it slides just that boundary so commands can be included/excluded without
    // first creating a row inside the loop.
    if(shared.timeScanDragState.boundary){
      const target=event.target.closest?.('.time-scan-row');
      if(!target || shared.timeScanDragState.rows.includes(target)) return;
      event.preventDefault();
      const indexCell=target.querySelector('[data-time-index]');
      const rect=(indexCell||target).getBoundingClientRect();
      const mode=event.clientY>rect.top+rect.height/2 ? 'after' : 'before';
      clearTimeScanDragMarkers();
      shared.timeScanDragState.rows.forEach(r=>r.classList.add('time-drag-source'));
      target.classList.add(mode==='after'?'time-drag-after':'time-drag-before');
      shared.timeScanDragState.target=target;
      shared.timeScanDragState.mode=mode;
      if(event.dataTransfer) event.dataTransfer.dropEffect='move';
      return;
    }

    const emptyZone=event.target.closest?.('.time-loop-empty-dropzone');
    if(emptyZone){
      event.preventDefault();
      clearTimeScanDragMarkers();
      shared.timeScanDragState.rows.forEach(r=>r.classList.add('time-drag-source'));
      emptyZone.classList.add('time-drop-active');
      shared.timeScanDragState.target=emptyZone;
      shared.timeScanDragState.mode='empty-loop';
      if(event.dataTransfer) event.dataTransfer.dropEffect='move';
      return;
    }

    const target=event.target.closest?.('.time-scan-row');
    if(!target || shared.timeScanDragState.rows.includes(target)) return;
    event.preventDefault();

    const command=target.querySelector('[data-time-variable]')?.value || '';
    let mode='before';
    if(command==='loop'){
      // Dropping on a loop boundary always means “put this inside the loop”.
      mode='inside-start';
    }else if(command==='endloop'){
      // Dropping on endloop means insert immediately before it (still inside).
      mode='inside-end';
    }else{
      const indexCell=target.querySelector('[data-time-index]');
      const rect=(indexCell||target).getBoundingClientRect();
      mode=event.clientY>rect.top+rect.height/2 ? 'after' : 'before';
    }

    clearTimeScanDragMarkers();
    shared.timeScanDragState.rows.forEach(r=>r.classList.add('time-drag-source'));
    target.classList.add((mode==='after' || mode==='inside-start')?'time-drag-after':'time-drag-before');
    shared.timeScanDragState.target=target;
    shared.timeScanDragState.mode=mode;
    if(event.dataTransfer) event.dataTransfer.dropEffect='move';
  }

  function timeLoopPairOrderIsValid(rows){
    const stack=[];
    for(const row of rows){
      const command=row.querySelector('[data-time-variable]')?.value || '';
      if(command==='loop'){
        const pair=row.dataset.timeLoopPair || '';
        if(!pair) return false;
        stack.push(pair);
      }else if(command==='endloop'){
        const pair=row.dataset.timeLoopPair || '';
        if(!pair || !stack.length || stack[stack.length-1]!==pair) return false;
        stack.pop();
      }
    }
    return stack.length===0;
  }

  function finishTimeLoopBoundaryDrop(event){
    const state=shared.timeScanDragState;
    if(!state?.boundary) return false;
    event.preventDefault();
    const boundaryRow=state.rows?.[0] || null;
    const target=state.target;
    const mode=state.mode || 'before';
    if(!boundaryRow || !target || boundaryRow===target) return true;

    const all=fn.timeScanRows();
    const remaining=all.filter(row=>row!==boundaryRow);
    let insertIndex;
    if(mode==='edge-start') insertIndex=0;
    else if(mode==='edge-end') insertIndex=remaining.length;
    else{
      const targetIndex=remaining.indexOf(target);
      if(targetIndex<0) return true;
      insertIndex=targetIndex+(mode==='after'?1:0);
    }
    const candidate=remaining.slice();
    candidate.splice(insertIndex,0,boundaryRow);

    if(!timeLoopPairOrderIsValid(candidate)){
      fn.setTimeEstimateMessage('Loop boundary cannot cross its paired boundary or break nested-loop structure.',true);
      return true;
    }

    const host=$('timeScanRows');
    let reference=null;
    if(insertIndex<candidate.length-1) reference=candidate[insertIndex+1];
    host.insertBefore(boundaryRow,reference);
    fn.selectOnlyTimeScanRow(boundaryRow);
    fn.ensureTimeLoopPairIds();
    renumberTimeScanRows();
    fn.normalizeBoundTimeLoopReferences();
    refreshEmptyTimeLoopDropzones();
    fn.saveTimeEstimateState();
    fn.validateAllTimeScanRows({showMessage:true});
    return true;
  }

  function finishTimeScanDrop(event){
    if(!shared.timeScanDragState) return;
    if(shared.timeScanDragState.boundary){
      finishTimeLoopBoundaryDrop(event);
      clearTimeScanDragMarkers();
      document.querySelector('#geometryTimePane .time-scan-table-wrap')?.classList.remove('time-dragging');
      shared.timeScanDragState=null;
      refreshEmptyTimeLoopDropzones();
      return;
    }
    event.preventDefault();
    const {rows,target}=shared.timeScanDragState;
    const mode=shared.timeScanDragState.mode || (shared.timeScanDragState.after?'after':'before');
    if(target && !rows.includes(target)){
      const host=$('timeScanRows');
      let reference=target;

      if(mode==='edge-start'){
        reference=fn.timeScanRows().find(row=>!rows.includes(row)) || null;
      }else if(mode==='edge-end'){
        reference=null;
      }else if(mode==='empty-loop'){
        const pair=target.dataset.timeLoopPair || '';
        reference=fn.timeScanRows().find(row=>row.dataset.timeLoopPair===pair && row.querySelector('[data-time-variable]')?.value==='endloop') || null;
      }else if(mode==='after' || mode==='inside-start'){
        reference=target.nextSibling;
        // The immediate next sibling can itself be one of the dragged rows.
        // Skip dragged rows so the reference remains attached after they move.
        while(reference && rows.includes(reference)) reference=reference.nextSibling;
      }else if(mode==='inside-end' || mode==='before'){
        reference=target;
      }

      const fragment=document.createDocumentFragment();
      rows.forEach(row=>fragment.appendChild(row));
      host.insertBefore(fragment,reference);

      shared.timeScanSelectionAnchor=rows[0]||null;
      fn.ensureTimeLoopPairIds();
      renumberTimeScanRows();
      fn.normalizeBoundTimeLoopReferences();
      refreshEmptyTimeLoopDropzones();
      fn.saveTimeEstimateState();
      fn.validateAllTimeScanRows({showMessage:true});
    }
    clearTimeScanDragMarkers();
    document.querySelector('#geometryTimePane .time-scan-table-wrap')?.classList.remove('time-dragging');
    shared.timeScanDragState=null;
    refreshEmptyTimeLoopDropzones();
  }

  function cancelTimeScanDrag(){
    clearTimeScanDragMarkers();
    document.querySelector('#geometryTimePane .time-scan-table-wrap')?.classList.remove('time-dragging');
    shared.timeScanDragState=null;
    refreshEmptyTimeLoopDropzones();
  }

  function applyTimeFixHeader(){
    const header=$('timeFixAll');
    if(!header) return;
    const selected=fn.selectedTimeScanRows();
    const targets=selected.length ? selected : fn.timeScanRows();
    for(const row of targets){
      const input=row.querySelector('[data-time-fix]');
      if(input && !input.disabled) input.checked=header.checked;
    }
    fn.updateTimeFixHeaderState();
    fn.saveTimeEstimateState();
  }

  function refreshEmptyTimeLoopDropzones(){
    const host=$('timeScanRows');
    if(!host) return;
    host.querySelectorAll('.time-loop-empty-dropzone,.time-edge-dropzone').forEach(zone=>zone.remove());

    const startZone=document.createElement('div');
    startZone.className='time-edge-dropzone'; startZone.dataset.timeEdge='start';
    startZone.title='Drop here to move selected command(s) before Index 1';
    host.insertBefore(startZone,host.firstChild);

    const structure=fn.ensureTimeLoopPairIds();
    const rows=structure.rows;
    for(const loopRow of rows){
      if(loopRow.querySelector('[data-time-variable]')?.value!=='loop') continue;
      const endRow=fn.matchingTimeLoopRow(loopRow);
      if(!endRow) continue;
      const startIndex=rows.indexOf(loopRow), endIndex=rows.indexOf(endRow);
      if(startIndex<0 || endIndex!==startIndex+1) continue; // only truly empty loops

      const zone=document.createElement('div');
      zone.className='time-loop-empty-dropzone';
      zone.dataset.timeLoopPair=loopRow.dataset.timeLoopPair||'';
      const level=Math.max(1,structure.info.get(loopRow)?.level||1);
      zone.dataset.timeLoopDepth=String(level);
      zone.style.setProperty('--time-empty-loop-depth',String(level-1));
      zone.title='Drop a command here to place it inside this loop';
      host.insertBefore(zone,endRow);
    }
    const endZone=document.createElement('div');
    endZone.className='time-edge-dropzone'; endZone.dataset.timeEdge='end';
    endZone.title='Drop here to move selected command(s) after the last Index';
    host.appendChild(endZone);
  }

  function updateTimeScanScrollState(){
    const wrap=document.querySelector('#geometryTimePane .time-scan-table-wrap');
    if(!wrap) return;
    // Keep the table geometry deterministic: show up to 10 scan rows, then scroll.
    // Do not derive this height from the Q-E plot or message/footer content.
    wrap.style.maxHeight='';
    wrap.classList.toggle('time-scan-scroll',fn.timeScanRows().length>10);
  }

  function renumberTimeScanRows(){
    fn.ensureTimeLoopPairIds();
    fn.timeScanRows().forEach((row,i)=>{
      const cell=row.querySelector('[data-time-index]');
      if(cell) cell.textContent=String(i+1);
    });
    fn.updateTimeLoopIndentation();
    fn.normalizeBoundTimeLoopReferences();
    refreshEmptyTimeLoopDropzones();
    updateTimeScanScrollState();
    fn.updateTimeFixHeaderState();
  }
}
