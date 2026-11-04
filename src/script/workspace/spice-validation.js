// Script: SPICE line mapping, highlighting and validation messages.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installSpiceValidation(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    baseValidateTimeRangeInput, commandNumberFromMessage, highlightSpiceErrorFromMessage,
    matchAsetAtLines, previousSpiceLinesForCommand, readTimeSettings, renderSpiceBackdrop,
    rowsFromGroups, spiceLinesForRow, spiceValidationSummary, timeMcuSecondsPerUnit
  });


  function detailItems(row){
    return [...row.querySelectorAll('[data-time-range-key]')].map(input=>({key:input.dataset.timeRangeKey,tokens:fn.spiceDetailTokens(input.value,row)}));
  }
  function spiceLinesForRow(row,info,result){
    const meta=fn.timeCommandMeta(result.command);
    if(meta.kind==='loop'){
      const values=fn.spiceDetailTokens(row.querySelector('[data-time-range-key="loop"]')?.value);
      return [`loop ${fn.spiceLoopVar(info?.level||1)}=${values.join(',')}`];
    }
    if(meta.kind==='endloop') return ['endloop'];
    if(meta.kind==='scantitle'){
      const raw=String(row.querySelector('[data-time-range-key="title"]')?.value||'').trim();
      const unquoted=raw.length>=2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1,-1).trim() : raw;
      const title=unquoted.replace(/\bloop([1-9]\d*)\b/gi,token=>{
        const ref=fn.parseTimeLoopReferenceToken(token,row);
        if(!ref?.ok) throw new Error(ref?.error||`${token} is not available at this command.`);
        return `%${fn.spiceLoopVar(ref.loopRef)}`;
      });
      const escaped=title.replace(/"/g,'\\"');
      return [`scantitle "${escaped}"`];
    }
    if(meta.kind==='count') return [`count preset mcu ${row.querySelector('[data-time-mcu]')?.value||'0'}`];
    if(meta.kind==='wait') return [`wait ${row.querySelector('[data-time-mcu]')?.value||'0'}`];
    const details=detailItems(row);
    const byKey=Object.fromEntries(details.map(item=>[item.key,item.tokens]));
    const t=row.querySelector('[data-time-mcu]')?.value||'0';
    const target=meta.target, op=meta.op;

    if(meta.aset){
      const template=fn.asetTemplate(target);
      const commands=fn.templateCommands(template);
      if(!commands.length) throw new Error(`${target} ASET has no SPICE template.`);
      const inputs=[...row.querySelectorAll('[data-time-range-key]')];
      const values=inputs.map(input=>String(input.value||'').trim());
      let valueIndex=0;
      return commands.map(command=>{
        let expanded=command.replace(/<(value|range)>/gi,(_m,type)=>{
          const kind=String(type).toLowerCase();
          const raw=values[valueIndex++]??'';
          if(!raw) throw new Error(`${target} ASET requires a ${kind} entry.`);
          return fn.spiceDetailTokens(raw,row).join(' ');
        });
        // Every ASET scan/scanrel consumes the row MCU automatically. This
        // keeps the template focused on motion syntax while Time estimate owns
        // counting time, e.g. "scan sgu <range>" -> "... preset mcu 300".
        if(/^scan(?:rel)?\b/i.test(expanded) && !/\bpreset\s+mcu\b/i.test(expanded)){
          expanded=`${expanded} preset mcu ${t}`;
        }
        return expanded;
      });
    }
    if(op==='drive'){
      if(target==='hkle') return [`drive h ${byKey.h[0]} k ${byKey.k[0]} l ${byKey.l[0]} e ${byKey.hw[0]}`];
      if(target==='br') return [`br ${byKey.hkl.join(' ')}`];
      const token=details[0]?.tokens?.[0];
      if(target==='ei'||target==='ef') return [`${target} ${token}`];
      return [`drive ${target} ${token}`];
    }
    if(op==='driverel'){
      const token=details[0]?.tokens?.[0];
      return [`driverel ${target} ${token}`];
    }
    if(op==='scan'){
      if(target==='th2th') return [`preset mcu ${t}`,`th2th ${details[0].tokens.join(' ')}`];
      const pieces=['scan'];
      if(target==='hkle'){
        for(const [key,name] of [['h','h'],['k','k'],['l','l'],['hw','e']]) pieces.push(name,...byKey[key]);
      }else if(target==='qe'){
        pieces.push('q',...byKey.q,'e',...byKey.hw);
      }else pieces.push(target,...details[0].tokens);
      pieces.push('preset','mcu',String(t));
      return [pieces.join(' ')];
    }
    if(op==='scanrel') return [`preset mcu ${t}`,`scanrel ${target} ${details[0].tokens.join(' ')}`];
    throw new Error(`Unsupported command ${op}.`);
  }
  function templateRegex(command){
    const text=String(command||'');
    const re=/<(value|range)>/gi;
    const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
    let source='^',last=0,m; const types=[];
    while((m=re.exec(text))){ source+=esc(text.slice(last,m.index))+'(.+?)'; types.push(m[1].toLowerCase()); last=m.index+m[0].length; }
    source+=esc(text.slice(last))+'$';
    return {regex:new RegExp(source,'i'),types};
  }

  function matchAsetAtLines(lines,startIndex,loopStack){
    const nextSignificant=(from)=>{ for(let j=from;j<lines.length;j++){ const raw=lines[j].trim(); if(raw && !raw.startsWith('#') && !raw.startsWith(';')) return {index:j,raw}; } return null; };
    for(const key of fn.asetKeys()){
      const templates=fn.templateCommands(fn.asetTemplate(key));
      if(!templates.length) continue;
      let cursor=startIndex-1,last=startIndex-1,ok=true; const captures=[]; let timeValue='0';
      for(const template of templates){
        const next=nextSignificant(cursor+1); if(!next){ok=false;break;}
        let candidate=next.raw;
        if(/^scan(?:rel)?\b/i.test(template)){
          const timed=/^(.*?)\s+preset\s+mcu\s+(\d+)\s*$/i.exec(candidate);
          if(!timed){ok=false;break;}
          candidate=timed[1].trim();
          const scanTime=timed[2];
          if(timeValue!=='0' && timeValue!==scanTime){ok=false;break;}
          timeValue=scanTime;
        }
        const {regex,types}=templateRegex(template),m=regex.exec(candidate);
        if(!m){ok=false;break;}
        for(let g=1;g<m.length;g++){
          const type=types[g-1];
          const rawValue=String(m[g]).trim();
          captures.push({type,value:rawValue.split(/\s+/).map(token=>fn.spiceTokenToTime(token,loopStack)).join(' ')});
        }
        cursor=next.index; last=next.index;
      }
      if(ok){
        const ranges={}; let occurrence=0;
        for(const item of captures) ranges[`aset_${item.type}_${++occurrence}`]=item.value;
        return {key,ranges,mcu:timeValue,endIndex:last};
      }
    }
    return null;
  }

  function renderSpiceBackdrop(){
    const area=$('scriptSpiceText'),backdrop=$('scriptSpiceBackdrop'),numbers=$('scriptSpiceLineNumbers');
    if(!area||!backdrop) return;
    const lines=String(area.value??'').split('\n');
    backdrop.innerHTML=lines.map((line,i)=>{
      const n=i+1;
      const cls=shared.spiceErrorLines.has(n)?' spice-line-error':(shared.spiceWarningLines.has(n)?' spice-line-warning':'');
      return `<span class="spice-backdrop-line${cls}">${fn.escapeHtml(line)||' '}</span>`;
    }).join('');
    if(numbers) numbers.innerHTML=lines.map((_line,i)=>{
      const n=i+1;
      const cls=shared.spiceErrorLines.has(n)?' spice-line-error':(shared.spiceWarningLines.has(n)?' spice-line-warning':'');
      return `<span class="spice-line-number${cls}">${n}</span>`;
    }).join('');
    backdrop.scrollTop=area.scrollTop; backdrop.scrollLeft=area.scrollLeft; if(numbers) numbers.scrollTop=area.scrollTop;
  }
  function highlightSpiceErrorFromMessage(message){
    shared.spiceErrorLines=new Set(); shared.spiceWarningLines=new Set();
    const match=/\bLine\s+(\d+)\s*:/i.exec(String(message||''));
    if(match) shared.spiceErrorLines.add(Number(match[1]));
    renderSpiceBackdrop();
  }


  function rowsFromGroups(op,groups,t='0'){
    const byName=Object.fromEntries(groups.map(g=>[g.name,g.values.join(' ')]));
    const names=groups.map(g=>g.name);
    if(['h','k','l','e'].every(name=>names.includes(name))){
      return {command:`${op}:hkle`,ranges:{h:byName.h,k:byName.k,l:byName.l,hw:byName.e},mcu:t,fixed:op!=='scan'};
    }
    if(op==='scan' && groups.length===2 && names.includes('q') && names.includes('e')){
      return {command:'scan:qe',ranges:{q:byName.q,hw:byName.e},mcu:t,fixed:false};
    }
    if(groups.length===1 && ['ei','ef','e','s1','s2'].includes(groups[0].name)){
      const target=groups[0].name;
      return {command:`${op}:${target}`,ranges:{[target==='e'?'hw':target]:groups[0].values.join(' ')},mcu:t,fixed:op!=='scan'};
    }
    throw new Error(`Unsupported ${op} target combination.`);
  }



  // ASET placeholder-specific validation. <value> remains scalar-only, while
  // <range> accepts either one fixed value / loopN reference or initial final step.
  // This lets one ASET template mix fixed and scanned axes without requiring a
  // separate template. Scan timing still comes from the row MCU.
  function baseValidateTimeRangeInput(input){
    const row=input?.closest?.('.time-scan-row') || null;
    const command=row?.querySelector('[data-time-variable]')?.value || 's1';
    if(input?.dataset.timeLoopRefBroken==='1'){
      const broken={ok:false,error:'The referenced loop is no longer an enclosing loop. Re-enter loop1, loop2, ... for the new nesting.'};
      fn.setTimeInputInvalid(input,true);
      return broken;
    }
    const parsed=fn.parseTimeDetail(input?.value,command,row);
    if(input){
      if(parsed.ok && Array.isArray(parsed.textRefs) && parsed.textRefs.length){
        input.dataset.timeLoopTextPairs=JSON.stringify(parsed.textRefs.map(ref=>({pair:ref.pair,level:ref.level})));
        delete input.dataset.timeLoopRefPair;
        delete input.dataset.timeLoopRefPairs;
      }else if(fn.timeCommandMeta(command).target==='br' && parsed.ok && Array.isArray(parsed.tuple)){
        const refs=parsed.tuple.map((item,tokenIndex)=>item.symbolic && item.loopRow?.dataset.timeLoopPair ? {tokenIndex,pair:item.loopRow.dataset.timeLoopPair} : null).filter(Boolean);
        if(refs.length) input.dataset.timeLoopRefPairs=JSON.stringify(refs);
        else delete input.dataset.timeLoopRefPairs;
        delete input.dataset.timeLoopRefPair;
      }else if(parsed.ok && parsed.symbolic && parsed.loopRow?.dataset.timeLoopPair){
        input.dataset.timeLoopRefPair=parsed.loopRow.dataset.timeLoopPair;
        delete input.dataset.timeLoopRefPairs;
      }else if(!parsed.symbolic){
        delete input.dataset.timeLoopRefPair;
        delete input.dataset.timeLoopRefPairs;
        delete input.dataset.timeLoopTextPairs;
      }
    }
    fn.setTimeInputInvalid(input,!parsed.ok);
    return parsed;
  }




  // ==================== MCU timing / SPICE diagnostics ====================
  function readTimeSettings({mark=true}={}){
    const mcuInput=$('timeMcuSecondsPerUnit');
    const movementInput=$('timeMovementPercent');
    const mcuText=String(mcuInput?.value??'1').trim();
    const movementText=String(movementInput?.value??'1').trim();
    const secondsPerMcu=Number(mcuText);
    const movementPercent=Number(movementText);
    const mcuOk=mcuText!=='' && Number.isFinite(secondsPerMcu) && secondsPerMcu>0;
    const movementOk=movementText!=='' && Number.isFinite(movementPercent) && movementPercent>=0;
    if(mark){
      fn.setTimeInputInvalid(mcuInput,!mcuOk);
      fn.setTimeInputInvalid(movementInput,!movementOk);
    }
    if(!mcuOk) return {ok:false,error:'1 MCU must correspond to a positive number of seconds.'};
    if(!movementOk) return {ok:false,error:'Movement time must be a non-negative percentage.'};
    return {ok:true,secondsPerMcu,movementPercent,movementFactor:1+movementPercent/100};
  }
  function timeMcuSecondsPerUnit(){
    const settings=readTimeSettings({mark:false});
    return settings.ok?settings.secondsPerMcu:1;
  }




  function previousSpiceLinesForCommand(commandIndex,oldMap,oldLines){
    const map=oldMap?.[commandIndex];
    if(!map || !(map.start>=1) || !(map.end>=map.start)) return [];
    return oldLines.slice(map.start-1,map.end);
  }
  function commandNumberFromMessage(message){
    const match=/\bCommand\s+(\d+)\s*:/i.exec(String(message||''));
    return match?Number(match[1]):null;
  }
  function spiceValidationSummary(validation){
    const messages=[];
    for(const error of validation?.errors||[]){
      const command=commandNumberFromMessage(error);
      const line=command?shared.spiceLineMap[command-1]?.start:null;
      const detail=String(error).replace(/^Command\s+\d+\s*:\s*/i,'');
      messages.push(line?`Line ${line} (Command ${command}): ${detail}`:(command?`Command ${command}: ${detail}`:`Error: ${detail}`));
    }
    for(const warning of validation?.warnings||[]){
      const command=commandNumberFromMessage(warning);
      const line=command?shared.spiceLineMap[command-1]?.start:null;
      const detail=String(warning).replace(/^Command\s+\d+\s*:\s*/i,'');
      messages.push(line?`Warning — Line ${line} (Command ${command}): ${detail}`:(command?`Warning — Command ${command}: ${detail}`:`Warning: ${detail}`));
    }
    return messages.join('\n');
  }
}
