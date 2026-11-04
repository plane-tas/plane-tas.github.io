// Script: SPICE macro generation / parsing and the Script tab UI.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installSpiceScript(ctx){
  const {deps:{
    $, resizeVisiblePlots
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    initializeScriptUI, mountTimeEstimateForScript, scriptMessage, spiceDetailTokens, spiceLoopVar,
    spiceTokenToTime
  });


  // ==================== SPICE macro script ====================
  let timeEstimateHomeParent=null;
  let timeEstimateHomeNextSibling=null;
  const SPICE_SCRIPT_STORAGE_KEY='tas-simulator-spice-script-v1';
  const SPICE_LOOP_VARS=['i','j','k','l','m','n','p','q','r','s','t','u','v','w','x','y','z'];

  function mountTimeEstimateForScript(active){
    const pane=$('geometryTimePane');
    if(!pane) return;
    const infoRow=pane.querySelector('.time-info-row');
    const commandActions=document.querySelector('.script-command-actions');
    const asetToggle=$('scriptToSpice');
    if(!timeEstimateHomeParent){
      timeEstimateHomeParent=pane.parentElement;
      timeEstimateHomeNextSibling=pane.nextSibling;
    }
    if(active){
      const mount=$('scriptTimeMount');
      if(mount && pane.parentElement!==mount) mount.appendChild(pane);
      if(infoRow && commandActions && asetToggle && infoRow.parentElement!==commandActions){
        infoRow.classList.add('time-info-row-inline');
        commandActions.insertBefore(infoRow,asetToggle);
      }
      pane.classList.remove('hidden');
      requestAnimationFrame(()=>{
        fn.updateTimeScanScrollState();
        fn.validateAllTimeScanRows({showMessage:true});
      });
    }else{
      if(infoRow && infoRow.parentElement!==pane){
        infoRow.classList.remove('time-info-row-inline');
        pane.insertBefore(infoRow,pane.firstChild);
      }
      if(timeEstimateHomeParent && pane.parentElement!==timeEstimateHomeParent){
        if(timeEstimateHomeNextSibling && timeEstimateHomeNextSibling.parentNode===timeEstimateHomeParent){
          timeEstimateHomeParent.insertBefore(pane,timeEstimateHomeNextSibling);
        }else timeEstimateHomeParent.appendChild(pane);
      }
      pane.classList.toggle('hidden',fn.currentGeometryCardTab()!=='time');
    }
  }

  function scriptMessage(message,error=false,warning=false){
    const box=$('scriptMessage');
    if(!box) return;
    box.textContent=message||'';
    box.classList.toggle('error-text',!!error);
    box.classList.toggle('warning-text',!error && !!warning);
  }

  function spiceLoopVar(level){
    const index=Math.max(0,Number(level||1)-1);
    return SPICE_LOOP_VARS[index] || `v${level}`;
  }

  function spiceDetailToken(token,row=null){
    const text=String(token??'').trim();
    // Time estimate expressions may contain loop references inside arithmetic,
    // e.g. 4/6+(loop1-1)*1/6.  SPICE expects the active loop variable form
    // (%i, %j, ...), so translate every embedded loopN reference, not only a
    // token that consists solely of loopN.
    return text.replace(/\bloop([1-9]\d*)\b/gi,(match,levelText)=>{
      const level=Number(levelText);
      if(row){
        const ref=fn.parseTimeLoopReferenceToken(`loop${level}`,row);
        if(!ref?.ok) throw new Error(ref?.error||`${match} is not available at this command.`);
        return `%${spiceLoopVar(ref.loopRef)}`;
      }
      return `%${spiceLoopVar(level)}`;
    });
  }

  function spiceDetailTokens(value,row=null){
    return String(value??'').trim().split(/\s+/).filter(Boolean).map(token=>spiceDetailToken(token,row));
  }


  function generateSpiceMacroFromTimeEstimate(){
    const validation=fn.validateAllTimeScanRows({showMessage:true});
    const structure=fn.ensureTimeLoopPairIds();
    const area=$('scriptSpiceText');
    const oldLines=String(area?.value??'').split('\n');
    const oldMap=shared.spiceLineMap.map(item=>item?{...item}:item);
    const lines=[];
    shared.spiceLineMap=[]; shared.spiceErrorLines=new Set(); shared.spiceWarningLines=new Set();
    const commandErrors=new Set((validation.errors||[]).map(fn.commandNumberFromMessage).filter(Number.isFinite));
    const commandWarnings=new Set((validation.warnings||[]).map(fn.commandNumberFromMessage).filter(Number.isFinite));

    for(let i=0;i<structure.rows.length;i++){
      const row=structure.rows[i];
      const result=validation.results[i];
      const info=structure.info.get(row);
      const command=row.querySelector('[data-time-variable]')?.value||result?.command||'drive:s1';
      const start=lines.length+1;
      let rowLines=[];
      if(!result?.ok) rowLines=fn.previousSpiceLinesForCommand(i,oldMap,oldLines);
      if(!rowLines.length){
        try{
          rowLines=fn.spiceLinesForRow(row,info,result?.command?result:{...result,command});
        }catch(err){
          const message=`Command ${i+1}: ${err?.message||String(err)}`;
          if(!validation.errors.includes(message)) validation.errors.push(message);
          commandErrors.add(i+1);
          rowLines=fn.previousSpiceLinesForCommand(i,oldMap,oldLines);
        }
      }
      if(!rowLines.length) rowLines=fn.previousSpiceLinesForCommand(i,oldMap,oldLines);
      if(!rowLines.length) rowLines=[''];
      lines.push(...rowLines);
      const end=lines.length;
      shared.spiceLineMap[i]={start,end};
      if(!result?.ok || commandErrors.has(i+1)) for(let line=start;line<=end;line++) shared.spiceErrorLines.add(line);
      else if(commandWarnings.has(i+1)) for(let line=start;line<=end;line++) shared.spiceWarningLines.add(line);
    }
    validation.ok=validation.errors.length===0;
    shared.lastSpiceValidation=validation;
    return lines.join('\n');
  }

  function spiceTokenToTime(token,loopStack){
    const text=String(token??'').trim();
    return text.replace(/%([A-Za-z][A-Za-z0-9_]*)\b/g,(_match,name)=>{
      const index=loopStack.indexOf(name);
      if(index<0) throw new Error(`Loop variable %${name} is not active here.`);
      return `loop${index+1}`;
    });
  }

  function parseSpiceVariableGroups(tokens,loopStack){
    const names=new Set(['ei','ef','e','q','s1','s2','h','k','l']);
    const groups=[]; let i=0;
    while(i<tokens.length){
      const name=String(tokens[i]||'').toLowerCase();
      if(!names.has(name)) throw new Error(`Unknown scan variable: ${tokens[i]||''}`);
      i++;
      const values=[];
      while(i<tokens.length && !names.has(String(tokens[i]).toLowerCase())) values.push(spiceTokenToTime(tokens[i++],loopStack));
      if(values.length!==1 && values.length!==3) throw new Error(`${name} must have one value or initial final step.`);
      groups.push({name,values});
    }
    return groups;
  }

  function parseSpiceMacroToRows(text){
    const rows=[],loopStack=[];
    const lines=String(text??'').split(/\r?\n/);
    let pendingMcu=null;
    for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
      const raw=lines[lineIndex].trim();
      if(!raw || raw.startsWith('#') || raw.startsWith(';')) continue;
      const asetMatch=fn.matchAsetAtLines(lines,lineIndex,loopStack);
      if(asetMatch){
        const template=fn.asetTemplate(asetMatch.key);
        const commands=fn.templateCommands(template);
        const hasRange=fn.templatePlaceholders(template).some(p=>p.type==='range');
        const operation=commands.some(c=>/^scanrel\b/i.test(c))?'scanrel':(commands.some(c=>/^scan\b/i.test(c))?'scan':(commands.some(c=>/^driverel\b/i.test(c))?'driverel':(hasRange?'scan':'drive')));
        rows.push({command:`${operation}:${asetMatch.key}`,ranges:asetMatch.ranges,mcu:asetMatch.mcu||'0',fixed:!['scan','scanrel'].includes(operation)});
        lineIndex=asetMatch.endIndex;
        continue;
      }
      let match;
      if((match=/^loop\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^,]+),([^,]+),([^,]+)\s*$/i.exec(raw))){
        if(loopStack.includes(match[1])) throw new Error(`Line ${lineIndex+1}: loop variable ${match[1]} is already active.`);
        loopStack.push(match[1]); rows.push({command:'loop',ranges:{loop:`${match[2].trim()} ${match[3].trim()} ${match[4].trim()}`},mcu:'0',fixed:true}); continue;
      }
      if(/^endloop\s*$/i.test(raw)){ if(!loopStack.length) throw new Error(`Line ${lineIndex+1}: endloop has no matching loop.`); loopStack.pop(); rows.push({command:'endloop',ranges:{},mcu:'0',fixed:true}); continue; }
      if((match=/^scantitle\s+(.+?)\s*$/i.exec(raw))){
        let title;
        try{
          const token=String(match[1]||'').trim();
          const unquoted=token.length>=2 && token.startsWith('"') && token.endsWith('"') ? token.slice(1,-1) : token;
          title=spiceTokenToTime(unquoted.replace(/\\"/g,'"'),loopStack);
        }
        catch(err){ throw new Error(`Line ${lineIndex+1}: ${err?.message||String(err)}`); }
        rows.push({command:'scantitle',ranges:{title},mcu:'0',fixed:true}); continue;
      }
      if((match=/^wait\s+(\d+)\s*$/i.exec(raw))){ rows.push({command:'wait',ranges:{},mcu:match[1],fixed:true}); continue; }
      if((match=/^count(?:\s+preset\s+mcu)?\s+(\d+)\s*$/i.exec(raw))){ rows.push({command:'count',ranges:{},mcu:match[1],fixed:true}); continue; }
      if((match=/^br\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i.exec(raw))){ rows.push({command:'drive:br',ranges:{hkl:[match[1],match[2],match[3]].map(v=>spiceTokenToTime(v,loopStack)).join(' ')},mcu:'0',fixed:true}); continue; }
      if((match=/^preset\s+mcu\s+(\d+)\s*$/i.exec(raw))){ pendingMcu=match[1]; continue; }
      if((match=/^(ei|ef)\s+(\S+)\s*$/i.exec(raw))){
        const target=match[1].toLowerCase(); rows.push({command:`drive:${target}`,ranges:{[target]:spiceTokenToTime(match[2],loopStack)},mcu:'0',fixed:true}); continue;
      }
      const parts=raw.split(/\s+/),op=parts[0].toLowerCase();
      if(op==='drive' || op==='driverel' || op==='drel'){
        const canonical=op==='drive'?'drive':'driverel';
        const rest=parts.slice(1);
        if(rest.length===2){
          const device=rest[0].toLowerCase(),value=spiceTokenToTime(rest[1],loopStack);
          if(['ei','ef','e','s1','s2'].includes(device)){
            rows.push({command:`${canonical}:${device}`,ranges:{[device==='e'?'hw':device]:value},mcu:'0',fixed:true}); continue;
          }
        }
        if(canonical==='drive'){
          const groups=parseSpiceVariableGroups(rest,loopStack);
          rows.push(fn.rowsFromGroups('drive',groups,'0')); continue;
        }
        throw new Error(`Line ${lineIndex+1}: unsupported driverel command.`);
      }
      if(op==='scan'){
        const presetIndex=parts.findIndex((token,index)=>index>0&&token.toLowerCase()==='preset');
        if(presetIndex<0 || String(parts[presetIndex+1]||'').toLowerCase()!=='mcu' || !/^\d+$/.test(String(parts[presetIndex+2]||'')) || presetIndex+3!==parts.length) throw new Error(`Line ${lineIndex+1}: scan must end with preset mcu <seconds>.`);
        const groups=parseSpiceVariableGroups(parts.slice(1,presetIndex),loopStack);
        rows.push(fn.rowsFromGroups('scan',groups,parts[presetIndex+2])); continue;
      }
      if(op==='th2th'){
        if(parts.length!==4) throw new Error(`Line ${lineIndex+1}: th2th requires initial final step.`);
        const value=parts.slice(1).map(x=>spiceTokenToTime(x,loopStack)).join(' ');
        rows.push({command:'scan:th2th',ranges:{th2th:value},mcu:'1',fixed:false}); continue;
      }
      if(op==='scanrel'){
        let rest=parts.slice(1),mcu=pendingMcu||'1'; pendingMcu=null;
        const presetIndex=rest.findIndex(token=>token.toLowerCase()==='preset');
        if(presetIndex>=0){
          if(String(rest[presetIndex+1]||'').toLowerCase()!=='mcu'||!/^\d+$/.test(String(rest[presetIndex+2]||''))) throw new Error(`Line ${lineIndex+1}: invalid scanrel preset.`);
          mcu=rest[presetIndex+2]; rest=rest.slice(0,presetIndex);
        }
        if(rest.length!==4) throw new Error(`Line ${lineIndex+1}: scanrel requires target initial final step.`);
        const target=rest[0].toLowerCase(),value=rest.slice(1).map(x=>spiceTokenToTime(x,loopStack)).join(' ');
        if(!['ei','ef','e','s1','s2'].includes(target)) throw new Error(`Line ${lineIndex+1}: unsupported scanrel target ${target}.`);
        rows.push({command:`scanrel:${target}`,ranges:{[target==='e'?'hw':target]:value},mcu,fixed:false}); continue;
      }
      throw new Error(`Line ${lineIndex+1}: unsupported SPICE command.`);
    }
    if(loopStack.length) throw new Error('SPICE macro ends before all loops are closed.');
    if(!rows.length) throw new Error('No supported SPICE commands were found.');
    return rows;
  }

  function replaceTimeEstimateRows(rows){
    const host=$('timeScanRows');
    if(!host) return;
    host.replaceChildren();
    shared.timeScanRowCounter=0;
    shared.timeLoopPairCounter=0;
    for(const values of rows) fn.addTimeScanRow(values,{suppressAutoPair:true});
    fn.ensureTimeLoopPairIds();
    fn.renumberTimeScanRows();
    fn.clearTimeScanSelection();
    fn.saveTimeEstimateState();
    fn.validateAllTimeScanRows({showMessage:true});
  }

  async function copySpiceScript(){
    const text=$('scriptSpiceText')?.value||'';
    if(!text.trim()){ scriptMessage('There is no SPICE macro to copy.',true); return; }
    try{
      await navigator.clipboard.writeText(text);
      scriptMessage('SPICE macro copied to the clipboard.');
    }catch(_err){
      const area=$('scriptSpiceText');
      area?.focus(); area?.select();
      const ok=document.execCommand?.('copy');
      scriptMessage(ok?'SPICE macro copied to the clipboard.':'Clipboard copy was blocked by the browser.',!ok);
    }
  }

  function initializeScriptUI(){
    const area=$('scriptSpiceText'),backdrop=$('scriptSpiceBackdrop'),numbers=$('scriptSpiceLineNumbers');
    fn.loadAset();
    fn.refreshTargetSelects();
    const bindInfoToggle=(buttonId,panelId)=>{
      const button=$(buttonId),panel=$(panelId);
      if(!button || !panel || button.dataset.infoBound==='1') return;
      button.dataset.infoBound='1';
      button.addEventListener('click',()=>{
        const show=panel.classList.contains('hidden');
        panel.classList.toggle('hidden',!show);
        button.setAttribute('aria-expanded',String(show));
      });
    };
    bindInfoToggle('scriptAsetInfoToggle','scriptAsetHelp');
    bindInfoToggle('timeEstimateInfoToggle','timeEstimateInfoPanel');
    const asetHost=$('scriptAsetList');
    const refreshAset=()=>{
      const check=fn.validateAsetRows();
      fn.saveAset(); fn.refreshTargetSelects();
      for(const row of fn.timeScanRows()){ const meta=fn.timeCommandMeta(row.querySelector('[data-time-variable]')?.value||''); if(meta.aset) fn.updateTimeScanRowFields(row); }
      fn.validateAllTimeScanRows({showMessage:true});
      if(!check.ok) scriptMessage(check.message,true);
    };
    asetHost?.addEventListener('input',event=>{
      if(event.target.closest?.('[data-aset-target],[data-aset-template]')) refreshAset();
    });
    asetHost?.addEventListener('change',event=>{
      if(event.target.closest?.('[data-aset-target],[data-aset-template]')) refreshAset();
    });
    asetHost?.addEventListener('click',event=>{
      const remove=event.target.closest?.('.script-aset-remove'); if(!remove) return;
      const row=remove.closest('[data-aset-row]'); const key=fn.asetRowKey(row);
      row?.remove(); fn.renumberAsetRows(); refreshAset(); scriptMessage(`Removed ASET ${key||''}. Commands that used it must choose another Target.`);
    });
    $('scriptAsetAdd')?.addEventListener('click',fn.promptAddAset);
    const applyAsetCollapsedState=collapsed=>{
      const workspace=document.querySelector('#scriptPanel .script-workspace');
      if(!workspace) return;
      workspace.classList.toggle('aset-collapsed',!!collapsed);
      // Sticky-note tab on the open ASET pane; a narrow rail when collapsed.
      $('scriptAsetTab')?.setAttribute('aria-expanded',String(!collapsed));
      $('scriptAsetRail')?.setAttribute('aria-expanded',String(!collapsed));
      updateAsetRailCount();
    };
    function updateAsetRailCount(){
      const out=$('scriptAsetRailCount');
      if(out) out.textContent=String(document.querySelectorAll('#scriptAsetList [data-aset-row]').length);
    }
    if($('scriptAsetList') && typeof MutationObserver==='function')
      new MutationObserver(updateAsetRailCount).observe($('scriptAsetList'),{childList:true});
    let initialAsetCollapsed=false;
    try{ initialAsetCollapsed=localStorage.getItem(shared.ASET_COLLAPSED_STORAGE_KEY)==='1'; }catch(_e){}
    applyAsetCollapsedState(initialAsetCollapsed);
    const toggleAsetPane=()=>{
      const workspace=document.querySelector('#scriptPanel .script-workspace'); if(!workspace) return;
      const collapsed=!workspace.classList.contains('aset-collapsed');
      applyAsetCollapsedState(collapsed);
      try{ localStorage.setItem(shared.ASET_COLLAPSED_STORAGE_KEY,collapsed?'1':'0'); }catch(_e){}
      requestAnimationFrame(resizeVisiblePlots);
    };
    $('scriptAsetTab')?.addEventListener('click',toggleAsetPane);
    $('scriptAsetRail')?.addEventListener('click',toggleAsetPane);
    try{ if(area) area.value=localStorage.getItem(SPICE_SCRIPT_STORAGE_KEY)||''; }catch(_e){}
    area?.addEventListener('scroll',()=>{ if(backdrop){backdrop.scrollTop=area.scrollTop;backdrop.scrollLeft=area.scrollLeft;} if(numbers) numbers.scrollTop=area.scrollTop; });
    area?.addEventListener('input',()=>{
      shared.spiceLineMap=[]; shared.spiceErrorLines=new Set(); shared.spiceWarningLines=new Set(); fn.renderSpiceBackdrop();
      try{localStorage.setItem(SPICE_SCRIPT_STORAGE_KEY,area.value);}catch(_e){} scriptMessage('');
    });
    // Conversion is intentionally one-shot only. Editing either side must not
    // overwrite the other side until the user explicitly presses an arrow button.
    shared.spiceMutationObserver?.disconnect();
    shared.spiceMutationObserver=null;
    $('scriptToSpice')?.addEventListener('click',()=>{
      try{
        const text=generateSpiceMacroFromTimeEstimate(); area.value=text; fn.renderSpiceBackdrop();
        try{localStorage.setItem(SPICE_SCRIPT_STORAGE_KEY,text);}catch(_e){}
        if(shared.lastSpiceValidation?.errors?.length) scriptMessage(fn.spiceValidationSummary(shared.lastSpiceValidation),true);
        else if(shared.lastSpiceValidation?.warnings?.length) scriptMessage(fn.spiceValidationSummary(shared.lastSpiceValidation),false,true);
        else scriptMessage('Converted Time estimate commands to SPICE. ASET placeholders were expanded into their SPICE templates.');
      }catch(err){ scriptMessage(err?.message||String(err),true); }
    });
    $('scriptToCommands')?.addEventListener('click',()=>{
      try{
        const rows=parseSpiceMacroToRows(area?.value||''); replaceTimeEstimateRows(rows);
        fn.renderSpiceBackdrop();
        if(shared.lastSpiceValidation?.errors?.length) scriptMessage(fn.spiceValidationSummary(shared.lastSpiceValidation),true);
        else if(shared.lastSpiceValidation?.warnings?.length) scriptMessage(fn.spiceValidationSummary(shared.lastSpiceValidation),false,true);
        else scriptMessage(`Converted ${rows.length} SPICE command row${rows.length===1?'':'s'} to Time estimate commands.`);
      }catch(err){ fn.highlightSpiceErrorFromMessage(err?.message||String(err)); scriptMessage(err?.message||String(err),true); }
    });
    $('scriptCopySpice')?.addEventListener('click',copySpiceScript);
    fn.renderSpiceBackdrop();
  }
}
