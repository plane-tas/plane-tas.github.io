// Time estimate: command metadata, row fields and loop (loop/endloop) structure.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installTimeRows(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    applyMcuToSelectedTimeScans, ensureTimeLoopPairIds, matchingTimeLoopRow,
    normalizeBoundTimeLoopReferences, parseTimeLoopReferenceToken, selectedTimeScanRows,
    setTimeInputInvalid, timeCommandMeta, timeScanRows, updateTimeFixHeaderState,
    updateTimeLoopIndentation, updateTimeScanRowFields
  });

  function timeCommandMeta(command){
    const {op,target}=fn.commandParts(command);
    if(op==='scantitle') return {kind:'scantitle',op,target:'',specs:[{key:'title',label:'Title'}]};
    if(op==='count') return {kind:'count',op,target:'',specs:[]};
    if(op==='wait') return {kind:'wait',op,target:'',specs:[]};
    if(op==='loop') return {kind:'loop',op,target:'',specs:[{key:'loop',label:'Loop'}]};
    if(op==='endloop') return {kind:'endloop',op,target:'',specs:[]};
    const kind=(op==='scan' || op==='scanrel') ? 'scan' : 'drive';
    if(target==='qe') return {kind,op,target,specs:[{key:'q',label:'Q'},{key:'hw',label:'E'}]};
    if(target==='th2th') return {kind,op,target,specs:[{key:'th2th',label:'th2th'}]};
    if(target==='hkle') return {kind,op,target,specs:[{key:'h',label:'H'},{key:'k',label:'K'},{key:'l',label:'L'},{key:'hw',label:'E'}]};
    if(target==='br') return {kind:'drive',op:'drive',target,specs:[{key:'hkl',label:'HKL'}]};
    if(fn.asetKeys().includes(target)){
      const placeholders=fn.templatePlaceholders(fn.asetTemplate(target));
      const specs=placeholders.map(p=>({key:p.key,label:p.label,placeholderType:p.type}));
      return {kind,op,target,aset:true,specs,placeholders};
    }
    const key=(target==='e')?'hw':target;
    const label={ei:'Ei',ef:'Ef',e:'E',s1:'S1',s2:'S2'}[target]||target;
    return {kind,op,target,specs:[{key,label:(op==='driverel'||op==='scanrel')?`rel ${label}`:label}]};
  }

  function timeRangeSpec(command){
    return timeCommandMeta(command).specs;
  }


  function setTimeInputInvalid(input,invalid){
    if(!input) return;
    input.classList.toggle('time-invalid-number',!!invalid);
    input.setAttribute('aria-invalid',invalid?'true':'false');
  }

  function timeRangeInputHtml(spec,value='',command='s1'){
    const meta=timeCommandMeta(command);
    const kind=meta.kind;
    let placeholder='target value or loopN';
    if(meta.target==='br') placeholder='H K L (e.g. 1 0 0)';
    else if(kind==='scantitle') placeholder='e.g. T=loop1';
    else if(kind==='scan') placeholder='fixed, loopN, or initial final step';
    else if(kind==='loop') placeholder='initial final step';
    return `<label class="time-range-field"><span class="time-range-label">${spec.label}</span><input type="text" inputmode="text" data-time-range-key="${spec.key}" value="${String(value??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" placeholder="${placeholder}"></label>`;
  }

  function updateTimeCommandTimeCell(row){
    if(!row) return;
    const command=row.querySelector('[data-time-variable]')?.value || 's1';
    const kind=timeCommandMeta(command).kind;
    const timeInput=row.querySelector('[data-time-mcu]');
    const fix=row.querySelector('[data-time-fix]');
    const detailInputs=[...row.querySelectorAll('[data-time-range-key]')];
    const parsedDetails=detailInputs.map(input=>fn.parseTimeDetail(input.value,command,row));
    const allDetailsValid=parsedDetails.length>0 && parsedDetails.every(parsed=>parsed.ok);
    const allDetailsFixed=allDetailsValid && parsedDetails.every(parsed=>parsed.fixed);
    const structural=(kind==='loop' || kind==='endloop');
    const automaticZero=structural || kind==='scantitle' || (kind==='drive') || (kind==='scan' && allDetailsFixed);

    if(timeInput){
      if(automaticZero){
        timeInput.value='0';
        timeInput.readOnly=true;
        timeInput.classList.add('time-readonly');
        setTimeInputInvalid(timeInput,false);
        timeInput.title='Detail is fixed, so MCU is automatically 0.';
      }else{
        timeInput.readOnly=false;
        timeInput.classList.remove('time-readonly');
        timeInput.title=kind==='wait' ? 'Wait duration (seconds)' : (kind==='count' ? 'Count preset in MCU' : 'MCU per scan point (whole number)');
      }
    }

    if(fix){
      const forced=(kind!=='scan') || automaticZero;
      if(forced){
        if(row.dataset.timeFixBeforeForced===undefined) row.dataset.timeFixBeforeForced=fix.checked?'1':'0';
        fix.checked=true;
        fix.disabled=true;
      }else{
        fix.disabled=false;
        if(row.dataset.timeFixBeforeForced!==undefined){
          fix.checked=row.dataset.timeFixBeforeForced==='1';
          delete row.dataset.timeFixBeforeForced;
        }
      }
      if(kind==='wait') fix.title='Wait time is excluded from Calc MCU.';
      else if(kind==='scantitle') fix.title='scantitle is excluded from Calc MCU.';
      else if(structural) fix.title='Loop structure uses MCU = 0 and is excluded from Calc MCU.';
      else if(automaticZero) fix.title='Fixed Detail automatically uses MCU = 0 and is excluded from Calc MCU.';
      else if(kind==='drive') fix.title='Drive command time is fixed and excluded from Calc MCU.';
      else fix.title='Keep this scan MCU fixed during Calc MCU.';
    }
  }

  function updateTimeScanRowFields(row,values={}){
    if(!row) return;
    const command=row.querySelector('[data-time-variable]')?.value || 's1';
    const host=row.querySelector('[data-time-range-host]');
    if(!host) return;
    const previous={};
    for(const input of host.querySelectorAll('[data-time-range-key]')) previous[input.dataset.timeRangeKey]=input.value;
    const spec=timeRangeSpec(command);
    host.style.setProperty('--time-range-cols',String(spec.length));
    host.innerHTML=spec.map(item=>timeRangeInputHtml(item,values[item.key] ?? previous[item.key] ?? '',command)).join('');
    host.querySelectorAll('input').forEach(input=>{
      input.addEventListener('input',()=>{
        delete input.dataset.timeLoopRefBroken;
        delete input.dataset.timeLoopRefPair;
        const parsed=fn.validateTimeRangeInput(input);
        fn.saveTimeEstimateState();
        if(parsed.ok) fn.clearTimeEstimateMessage();
        else fn.setTimeEstimateMessage(parsed.error,true);
      });
      input.addEventListener('change',()=>{
        const parsed=fn.validateTimeRangeInput(input);
        if(parsed.ok) applyRangeToSelectedTimeScans(row,input);
        updateTimeCommandTimeCell(row);
        fn.saveTimeEstimateState();
        fn.validateAllTimeScanRows({showMessage:true});
      });
    });
    updateTimeCommandTimeCell(row);
    updateTimeLoopIndentation();
  }

  function timeScanRows(){
    return [...document.querySelectorAll('#timeScanRows .time-scan-row')];
  }

  function selectedTimeScanRows(){
    return timeScanRows().filter(row=>row.classList.contains('time-scan-selected'));
  }

  function analyzeTimeLoopStructure(){
    const rows=timeScanRows();
    const stack=[];
    const info=new Map();
    const pairs=[];
    const unmatchedEnd=[];
    for(const row of rows){
      const command=row.querySelector('[data-time-variable]')?.value || 's1';
      if(command==='loop'){
        const level=stack.length+1;
        const entry={row,level,parentLoops:stack.map(x=>x.row)};
        info.set(row,{kind:'loop',level,depth:level-1,parentLoops:entry.parentLoops,pairRow:null});
        stack.push(entry);
        continue;
      }
      if(command==='endloop'){
        const opened=stack.pop();
        if(opened){
          const loopInfo=info.get(opened.row);
          loopInfo.pairRow=row;
          info.set(row,{kind:'endloop',level:opened.level,depth:opened.level-1,parentLoops:stack.map(x=>x.row),pairRow:opened.row});
          pairs.push({loopRow:opened.row,endRow:row,level:opened.level});
        }else{
          info.set(row,{kind:'endloop',level:0,depth:0,parentLoops:[],pairRow:null});
          unmatchedEnd.push(row);
        }
        continue;
      }
      info.set(row,{kind:'command',level:0,depth:stack.length,parentLoops:stack.map(x=>x.row),pairRow:null});
    }
    return {rows,info,pairs,unmatchedLoops:stack.map(x=>x.row),unmatchedEnd};
  }

  function ensureTimeLoopPairIds(){
    const structure=analyzeTimeLoopStructure();
    for(const {loopRow,endRow} of structure.pairs){
      let pair=loopRow.dataset.timeLoopPair || endRow.dataset.timeLoopPair || '';
      if(!pair) pair=`lp${++shared.timeLoopPairCounter}`;
      loopRow.dataset.timeLoopPair=pair;
      endRow.dataset.timeLoopPair=pair;
    }
    return structure;
  }

  function matchingTimeLoopRow(row){
    if(!row) return null;
    const pair=row.dataset.timeLoopPair;
    if(pair){
      return timeScanRows().find(candidate=>candidate!==row && candidate.dataset.timeLoopPair===pair) || null;
    }
    const structure=ensureTimeLoopPairIds();
    return structure.info.get(row)?.pairRow || null;
  }


  function updateTimeLoopCommandLabels(){
    const structure=ensureTimeLoopPairIds();
    for(const row of structure.rows){
      const internal=row.querySelector('[data-time-variable]');
      const opSelect=row.querySelector('[data-time-operation]');
      if(!internal || !opSelect) continue;
      const rowInfo=structure.info.get(row);
      const loopOption=[...opSelect.options].find(option=>option.value==='loop');
      const endOption=[...opSelect.options].find(option=>option.value==='endloop');
      const proposedLevel=(internal.value==='loop' && rowInfo?.level) ? rowInfo.level : Math.max(1,(rowInfo?.depth||0)+1);
      if(loopOption) loopOption.textContent=`loop${proposedLevel}`;
      if(endOption){
        endOption.textContent=(internal.value==='endloop' && rowInfo?.level) ? `endloop${rowInfo.level}` : 'endloop';
        endOption.disabled=internal.value!=='endloop';
        endOption.hidden=internal.value!=='endloop';
      }
      opSelect.disabled=internal.value==='endloop';
      opSelect.title=internal.value==='endloop' ? 'This endloop is paired automatically with its loop command.' : '';
    }
    return structure;
  }

  function updateTimeLoopIndentation(){
    const structure=updateTimeLoopCommandLabels();
    for(const row of structure.rows){
      const rowInfo=structure.info.get(row);
      const depth=Math.max(0,rowInfo?.depth||0);
      row.style.setProperty('--time-loop-depth',String(depth));
      row.dataset.timeLoopDepth=String(depth);
      row.dataset.timeLoopLevel=String(rowInfo?.level||0);
      const commandCell=row.querySelector('.time-command-cell');
      if(commandCell) commandCell.style.paddingLeft=`${5+depth*14}px`;
    }
  }

  function parseTimeLoopReferenceToken(raw,row){
    const token=String(raw??'').trim();
    const match=/^loop([1-9]\d*)$/i.exec(token);
    if(!match) return null;
    const level=Number(match[1]);
    const rowInfo=ensureTimeLoopPairIds().info.get(row);
    const enclosing=rowInfo?.parentLoops||[];
    const loopRow=enclosing[level-1] || null;
    if(!loopRow) return {ok:false,error:`${token} is not available at this command.`,loopRef:level};
    return {ok:true,fixed:true,count:1,value:null,symbolic:true,loopRef:level,loopRow};
  }

  function normalizeBoundTimeLoopReferences(){
    const structure=ensureTimeLoopPairIds();
    for(const input of document.querySelectorAll('#timeScanRows [data-time-range-key]')){
      const commandRow=input.closest('.time-scan-row');
      if(input.dataset.timeLoopTextPairs){
        let refs=[];
        try{ refs=JSON.parse(input.dataset.timeLoopTextPairs)||[]; }catch(_e){ refs=[]; }
        let occurrence=0,broken=false;
        const commandInfo=structure.info.get(commandRow);
        input.value=String(input.value||'').replace(/\bloop([1-9]\d*)\b/gi,token=>{
          const ref=refs[occurrence++];
          if(!ref){ broken=true; return token; }
          const loopRow=structure.rows.find(row=>row.dataset.timeLoopPair===ref.pair && row.querySelector('[data-time-variable]')?.value==='loop');
          const loopInfo=loopRow ? structure.info.get(loopRow) : null;
          const stillEnclosing=!!(loopRow && commandInfo?.parentLoops?.includes(loopRow));
          if(stillEnclosing && loopInfo?.level) return `loop${loopInfo.level}`;
          broken=true; return token;
        });
        if(occurrence!==refs.length) broken=true;
        if(broken) input.dataset.timeLoopRefBroken='1';
        else delete input.dataset.timeLoopRefBroken;
        continue;
      }
      if(input.dataset.timeLoopRefPairs){
        let refs=[];
        try{ refs=JSON.parse(input.dataset.timeLoopRefPairs)||[]; }catch(_e){ refs=[]; }
        const tokens=String(input.value||'').trim().split(/\s+/).filter(Boolean);
        let broken=false;
        for(const ref of refs){
          const loopRow=structure.rows.find(row=>row.dataset.timeLoopPair===ref.pair && row.querySelector('[data-time-variable]')?.value==='loop');
          const commandInfo=structure.info.get(commandRow);
          const loopInfo=loopRow ? structure.info.get(loopRow) : null;
          const stillEnclosing=!!(loopRow && commandInfo?.parentLoops?.includes(loopRow));
          if(stillEnclosing && loopInfo?.level && Number.isInteger(ref.tokenIndex) && ref.tokenIndex>=0 && ref.tokenIndex<tokens.length){
            tokens[ref.tokenIndex]=`loop${loopInfo.level}`;
          }else broken=true;
        }
        if(tokens.length) input.value=tokens.join(' ');
        if(broken) input.dataset.timeLoopRefBroken='1';
        else delete input.dataset.timeLoopRefBroken;
        continue;
      }
      const pair=input.dataset.timeLoopRefPair;
      if(!pair) continue;
      const loopRow=structure.rows.find(row=>row.dataset.timeLoopPair===pair && row.querySelector('[data-time-variable]')?.value==='loop');
      const commandInfo=structure.info.get(commandRow);
      const loopInfo=loopRow ? structure.info.get(loopRow) : null;
      const stillEnclosing=!!(loopRow && commandInfo?.parentLoops?.includes(loopRow));
      if(stillEnclosing && loopInfo?.level){
        input.value=`loop${loopInfo.level}`;
        delete input.dataset.timeLoopRefBroken;
      }else{
        input.dataset.timeLoopRefBroken='1';
      }
    }
  }

  function applyRangeToSelectedTimeScans(sourceRow,sourceInput){
    if(!sourceRow?.classList.contains('time-scan-selected') || !sourceInput) return;
    const selected=selectedTimeScanRows();
    if(selected.length<2) return;
    const variable=sourceRow.querySelector('[data-time-variable]')?.value || '';
    const key=sourceInput.dataset.timeRangeKey;
    if(!key) return;
    const value=sourceInput.value;
    for(const row of selected){
      if((row.querySelector('[data-time-variable]')?.value || '')!==variable) continue;
      const input=row.querySelector(`[data-time-range-key="${key}"]`);
      if(!input || input===sourceInput) continue;
      input.value=value;
      fn.validateTimeRangeInput(input);
      updateTimeCommandTimeCell(row);
    }
  }

  function applyMcuToSelectedTimeScans(sourceRow,value){
    if(!sourceRow?.classList.contains('time-scan-selected')) return;
    const selected=selectedTimeScanRows();
    if(selected.length<2) return;
    for(const row of selected){
      const input=row.querySelector('[data-time-mcu]');
      if(!input || input.readOnly) continue;
      input.value=value;
      setTimeInputInvalid(input,false);
    }
  }

  function updateTimeFixHeaderState(){
    const header=$('timeFixAll');
    const selected=selectedTimeScanRows();
    if(header){
      const base=selected.length ? selected : timeScanRows();
      const targets=base.filter(row=>!row.querySelector('[data-time-fix]')?.disabled);
      const states=targets.map(row=>!!row.querySelector('[data-time-fix]')?.checked);
      header.disabled=!targets.length;
      header.checked=states.length>0 && states.every(Boolean);
      header.indeterminate=states.some(Boolean) && !states.every(Boolean);
      header.title=selected.length ? `Apply Fix to selected scan commands` : 'Apply Fix to all scan commands';
    }
    const remove=$('timeRemoveScan');
    if(remove){
      remove.disabled=selected.length===0;
      remove.title=selected.length ? `Remove ${selected.length} selected command${selected.length===1?'':'s'}` : 'Select one or more indices to remove';
    }
  }
}
