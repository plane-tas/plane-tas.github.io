// Time estimate: expression / range / detail parsing, row reading and validation.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installTimeParse(ctx){
  const {deps:{
    $, calculateSingleCrystal, checkedValue, clamp, currentInstrument, effectiveS2MaxAtEi, num,
    rad2deg, tasConvention
  }, fn}=ctx;
  const deps=ctx.deps;   // live app state read through getters on deps (singleCache, powderCache)
  Object.assign(fn,{
    clearTimeEstimateMessage, parseTimeDetail, resolveTimeFixedValue, setTimeEstimateMessage,
    timeDetailValueAt, timeElasticIncidentEnergy, timeEnergyForTransfer, timeLoopContextsForRow,
    timeS2LimitAtEi, timeS2MagnitudeFromQ, timeSignedS2FromMagnitude, validateAllTimeScanRows,
    validateTimeMcuInput, validateTimeRangeInput
  });

  function parseTimeMathExpression(raw,row=null,{allowLoopReference=true}={}){
    const text=String(raw??'').trim();
    if(!text) return {ok:false,error:'Enter a numeric expression.'};
    let pos=0;
    const refs=[];
    const skip=()=>{ while(/\s/.test(text[pos]||'')) pos++; };
    const parsePrimary=()=>{
      skip();
      if(text[pos]==='('){
        pos++;
        const node=parseAddSub();
        skip();
        if(text[pos]!==')') throw new Error('Missing closing parenthesis.');
        pos++;
        return node;
      }
      const rest=text.slice(pos);
      const loop=/^loop([1-9]\d*)\b/i.exec(rest);
      if(loop){
        if(!allowLoopReference || !row) throw new Error(`${loop[0]} is not allowed here.`);
        const ref=fn.parseTimeLoopReferenceToken(loop[0],row);
        if(!ref?.ok) throw new Error(ref?.error||`${loop[0]} is not available at this command.`);
        pos+=loop[0].length;
        refs.push({pair:ref.loopRow?.dataset?.timeLoopPair||'',level:ref.loopRef});
        return {type:'loop',level:ref.loopRef};
      }
      const num=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      if(!num) throw new Error(`Unexpected token near "${rest.slice(0,12)}".`);
      pos+=num[0].length;
      return {type:'number',value:Number(num[0])};
    };
    const parseUnary=()=>{
      skip();
      if(text[pos]==='+' || text[pos]==='-'){
        const op=text[pos++];
        return {type:'unary',op,node:parseUnary()};
      }
      return parsePrimary();
    };
    const parseMulDiv=()=>{
      let node=parseUnary();
      while(true){
        skip();
        const op=text[pos];
        if(op!=='*' && op!=='/') break;
        pos++;
        node={type:'binary',op,left:node,right:parseUnary()};
      }
      return node;
    };
    const parseAddSub=()=>{
      let node=parseMulDiv();
      while(true){
        skip();
        const op=text[pos];
        if(op!=='+' && op!=='-') break;
        pos++;
        node={type:'binary',op,left:node,right:parseMulDiv()};
      }
      return node;
    };
    const evaluate=(node,context={})=>{
      if(node.type==='number') return node.value;
      if(node.type==='loop') return Number(context?.[node.level]);
      if(node.type==='unary'){
        const v=evaluate(node.node,context);
        return node.op==='-' ? -v : v;
      }
      const a=evaluate(node.left,context), b=evaluate(node.right,context);
      if(node.op==='+') return a+b;
      if(node.op==='-') return a-b;
      if(node.op==='*') return a*b;
      if(node.op==='/') return b===0 ? NaN : a/b;
      return NaN;
    };
    try{
      const ast=parseAddSub();
      skip();
      if(pos!==text.length) throw new Error(`Unexpected token near "${text.slice(pos,pos+12)}".`);
      const constant=refs.length===0 ? evaluate(ast,{}) : NaN;
      if(refs.length===0 && !Number.isFinite(constant)) throw new Error('Expression does not evaluate to a finite number.');
      return {ok:true,ast,refs,value:constant,evaluate:(context)=>evaluate(ast,context)};
    }catch(err){
      return {ok:false,error:err?.message||String(err)};
    }
  }

  function parseTimeRange(raw,row=null,{allowLoopReference=true}={}){
    const text=String(raw??'').trim();
    if(!text) return {ok:false,error:'Enter one fixed value or initial final step.'};
    if(text.includes(',')) return {ok:false,error:'Commas are not allowed. Separate Detail values with spaces.'};

    // A complete arithmetic expression is a fixed value. This allows SPICE forms
    // such as 4/6+(loop1-1)*1/6 while preserving the existing three-value scan
    // syntax (initial final step).
    const whole=parseTimeMathExpression(text,row,{allowLoopReference});
    if(whole.ok){
      return {
        ok:true,fixed:true,count:1,value:whole.refs.length?null:whole.value,
        expression:whole,expressionText:text,symbolic:whole.refs.length>0,
        textRefs:whole.refs
      };
    }

    const parts=text.split(/\s+/).filter(Boolean);
    if(parts.length!==3) return {ok:false,error:'Use one arithmetic expression or three space-separated values: initial final step.'};
    const expressions=parts.map(part=>parseTimeMathExpression(part,row,{allowLoopReference:false}));
    const invalid=expressions.find(x=>!x.ok);
    if(invalid) return {ok:false,error:`Every scan range value must be numeric arithmetic without loop references. ${invalid.error||''}`.trim()};
    const [initial,final,enteredStep]=expressions.map(x=>x.value);
    const step=Math.abs(enteredStep);
    if(!(step>0)) return {ok:false,error:'Step must be non-zero.'};
    const distance=Math.abs(final-initial);
    const count=distance<1e-12 ? 1 : Math.floor(distance/step+1e-10)+1;
    if(!(count>=1) || !Number.isFinite(count)) return {ok:false,error:'Could not determine the number of scan points.'};
    return {ok:true,fixed:false,count,initial,final,step};
  }

  function parseBrHklDetail(raw,row=null){
    const text=String(raw??'').trim();
    if(!text) return {ok:false,error:'Enter H K L as three space-separated values.'};
    if(text.includes(',')) return {ok:false,error:'Commas are not allowed. Enter H K L with spaces.'};
    const parts=text.split(/\s+/).filter(Boolean);
    if(parts.length!==3) return {ok:false,error:'br requires exactly three space-separated values: H K L.'};
    const components=[], textRefs=[];
    for(const token of parts){
      const expr=parseTimeMathExpression(token,row,{allowLoopReference:true});
      if(!expr.ok) return {ok:false,error:`Each br HKL value must be a numeric expression. ${expr.error||''}`.trim()};
      components.push({
        ok:true,fixed:true,count:1,value:expr.refs.length?null:expr.value,token,
        expression:expr,symbolic:expr.refs.length>0,textRefs:expr.refs
      });
      textRefs.push(...expr.refs);
    }
    return {ok:true,fixed:true,count:1,tuple:components,textRefs};
  }

  function parseTimeDetail(raw,command,row=null){
    const meta=fn.timeCommandMeta(command);
    if(meta.kind==='scantitle') return fn.parseScantitleDetail(raw,row);
    if(meta.target==='br') return parseBrHklDetail(raw,row);
    if(meta.kind==='loop'){
      const parsed=parseTimeRange(raw,row,{allowLoopReference:false});
      if(!parsed.ok) return parsed;
      if(parsed.fixed) return {ok:false,error:'loop requires three space-separated values: initial final step.'};
      return parsed;
    }
    if(meta.kind==='endloop' || meta.kind==='wait' || meta.kind==='count') return {ok:true,fixed:true,count:1,value:null};
    if(meta.kind==='scan') return parseTimeRange(raw,row,{allowLoopReference:true});
    const text=String(raw??'').trim();
    const expr=parseTimeMathExpression(text,row,{allowLoopReference:true});
    if(!expr.ok) return {ok:false,error:`Enter one numeric expression${row?' using loopN if needed':''}. ${expr.error||''}`.trim()};
    return {
      ok:true,fixed:true,count:1,value:expr.refs.length?null:expr.value,
      expression:expr,expressionText:text,symbolic:expr.refs.length>0,textRefs:expr.refs
    };
  }

  function validateTimeRangeInput(input){
    const key=String(input?.dataset?.timeRangeKey||'');
    const row=input?.closest?.('.time-scan-row')||null;
    const command=row?.querySelector('[data-time-variable]')?.value||'';
    const meta=fn.timeCommandMeta(command);
    if(meta.kind==='scantitle'){
      if(input?.dataset.timeLoopRefBroken==='1'){
        const broken={ok:false,error:'A loop reference in the scan title is no longer inside that loop.'};
        fn.setTimeInputInvalid(input,true); return broken;
      }
      const result=fn.parseScantitleDetail(input?.value,row);
      if(result.ok && input){
        const refs=(result.textRefs||[]).filter(ref=>ref.pair);
        if(refs.length) input.dataset.timeLoopTextPairs=JSON.stringify(refs);
        else delete input.dataset.timeLoopTextPairs;
        delete input.dataset.timeLoopRefPair;
        delete input.dataset.timeLoopRefPairs;
      }
      fn.setTimeInputInvalid(input,!result.ok); return result;
    }
    if(!key.startsWith('aset_')) return fn.baseValidateTimeRangeInput(input);
    if(key.startsWith('aset_range_')){
      const result=parseTimeRange(input?.value,row,{allowLoopReference:true});
      fn.setTimeInputInvalid(input,!result.ok); return result;
    }
    const text=String(input?.value??'').trim();
    // ASET <value> is scalar-only, but the scalar may be an arithmetic expression
    // using enclosing loop variables, e.g. loop1-1 or (loop2+1)/6.  Use the same
    // expression parser as the normal Time estimate command fields so validation,
    // loop binding, reordering, and SPICE round-tripping stay consistent.
    const expr=parseTimeMathExpression(text,row,{allowLoopReference:true});
    if(expr.ok && input){
      if(Array.isArray(expr.refs) && expr.refs.length){
        input.dataset.timeLoopTextPairs=JSON.stringify(expr.refs.map(ref=>({pair:ref.pair,level:ref.level})));
      }else{
        delete input.dataset.timeLoopTextPairs;
      }
      delete input.dataset.timeLoopRefPair;
      delete input.dataset.timeLoopRefPairs;
    }
    const result=expr.ok
      ? {ok:true,fixed:true,count:1,value:expr.refs.length?null:expr.value,expression:expr,expressionText:text,symbolic:expr.refs.length>0,textRefs:expr.refs}
      : {ok:false,error:`Enter one numeric expression using loopN if needed. ${expr.error||''}`.trim()};
    fn.setTimeInputInvalid(input,!result.ok); return result;
  }

  function validateTimeMcuInput(input){
    const raw=String(input?.value??'').trim();
    const value=Number(raw);
    const ok=raw!=='' && /^\d+$/.test(raw) && Number.isSafeInteger(value) && value>=0;
    fn.setTimeInputInvalid(input,!ok);
    return {ok,value};
  }

  function clearTimeEstimateMessage(){
    const box=$('timeEstimateMessage');
    if(!box) return;
    box.textContent='';
    box.classList.remove('error-text','warning-text');
    if(fn.currentGeometryCardTab()==='time') requestAnimationFrame(fn.updateTimeScanScrollState);
  }

  function setTimeEstimateMessage(message,error=false,warning=false){
    const box=$('timeEstimateMessage');
    if(!box) return;
    box.textContent=message;
    box.classList.toggle('error-text',!!error);
    box.classList.toggle('warning-text',!error && !!warning);
    if(fn.currentGeometryCardTab()==='time') requestAnimationFrame(fn.updateTimeScanScrollState);
  }

  function readTimeScanRow(row,index){
    fn.setTimeScanRowWarning(row,false);
    if(row.dataset.timeMigrationWarning){
      fn.setTimeScanRowWarning(row,true);
      return {ok:false,error:`Command ${index}: ${row.dataset.timeMigrationWarning}`};
    }
    const command=row.querySelector('[data-time-variable]')?.value || 'drive:s1';
    const meta=fn.timeCommandMeta(command);
    const rangeInputs=[...row.querySelectorAll('[data-time-range-key]')];
    const parsed=rangeInputs.map(input=>({input,key:input.dataset.timeRangeKey,parsed:validateTimeRangeInput(input)}));
    const invalidRange=parsed.find(x=>!x.parsed.ok);
    if(invalidRange){ fn.setTimeScanRowWarning(row,true); return {ok:false,error:`Command ${index}: ${invalidRange.parsed.error}`}; }
    const timeInput=row.querySelector('[data-time-mcu]');
    const time=validateTimeMcuInput(timeInput);
    if(!time.ok){ fn.setTimeScanRowWarning(row,true); return {ok:false,error:`Command ${index}: ${meta.kind==='wait'?'wait time (s)':'MCU'} must be a non-negative whole number.`}; }

    if((meta.target==='qe'||meta.target==='th2th') && meta.op!=='scan'){
      fn.setTimeScanRowWarning(row,true);
      return {ok:false,error:`Command ${index}: ${meta.target==='qe'?'QE':'th2th'} is available with scan only.`};
    }
    if((meta.op==='driverel'||meta.op==='scanrel') && meta.target==='hkle'){
      fn.setTimeScanRowWarning(row,true);
      return {ok:false,error:`Command ${index}: relative HKLE is not supported; use absolute drive/scan HKLE.`};
    }

    const movingCounts=meta.kind==='scan' ? parsed.map(x=>x.parsed.count).filter(n=>n>1) : [];
    const unique=[...new Set(movingCounts)];
    if(unique.length>1){
      for(const x of parsed) if(x.parsed.count>1) fn.setTimeInputInvalid(x.input,true);
      fn.setTimeScanRowWarning(row,true);
      return {ok:false,error:`Command ${index}: ranged Detail values do not contain the same number of scan points.`};
    }
    if(meta.kind==='scan' && unique.length===0){
      for(const x of parsed) fn.setTimeInputInvalid(x.input,true);
      fn.setTimeScanRowWarning(row,true);
      return {ok:false,error:`Command ${index}: ${meta.op} requires initial final step in at least one Detail field.`};
    }
    const points=meta.kind==='scan' ? unique[0] : ((meta.kind==='loop'||meta.kind==='endloop')?0:1);
    const loopIterations=meta.kind==='loop' ? (parsed[0]?.parsed?.count||1) : 1;
    if(meta.target==='hkle' && (meta.op==='drive'||meta.op==='scan') && !parsed.some(x=>x.parsed.symbolic)){
      const parsedByKey=Object.fromEntries(parsed.map(x=>[x.key,x.parsed]));
      const plane=fn.validateHkleScanPlane(parsedByKey,Math.max(1,points));
      if(!plane.ok){
        fn.setTimeScanRowWarning(row,true);
        const where=plane.hkl?` (${plane.hkl.map(v=>Number(v.toPrecision(6))).join(', ')})`:'';
        const detail=plane.error?` ${plane.error}`:'';
        return {ok:false,error:`Command ${index}: HKLE is outside the current U-V scattering plane${where}.${detail}`};
      }
    }
    const secondsPerMcu=fn.timeMcuSecondsPerUnit();
    const baseSeconds=meta.kind==='wait' ? time.value
      : (meta.kind==='count' ? time.value*secondsPerMcu
      : (meta.kind==='scan' ? points*time.value*secondsPerMcu : 0));
    return {
      ok:true,command,operation:meta.op,target:meta.target,kind:meta.kind,points,loopIterations,
      loopLevel:Number(row.dataset.timeLoopLevel||0),mcuValue:time.value,mcuSeconds:time.value,
      seconds:baseSeconds,
      fixed:meta.kind!=='scan' || !!row.querySelector('[data-time-fix]')?.checked
    };
  }

  function timeRangeValues(parsed){
    if(!parsed?.ok) return [];
    if(parsed.fixed) return [parsed.value];
    const values=[];
    const direction=parsed.final>=parsed.initial ? 1 : -1;
    for(let i=0;i<parsed.count;i++) values.push(parsed.initial+direction*parsed.step*i);
    return values;
  }

  function timeLoopContextsForRow(row,structure,maxContexts=50000){
    const parentLoops=structure.info.get(row)?.parentLoops||[];
    let contexts=[{}];
    for(const loopRow of parentLoops){
      const level=structure.info.get(loopRow)?.level||0;
      const input=loopRow.querySelector('[data-time-range-key="loop"]');
      const parsed=parseTimeDetail(input?.value,'loop',loopRow);
      if(!parsed.ok) return {ok:false,contexts:[]};
      const values=timeRangeValues(parsed);
      const next=[];
      for(const context of contexts){
        for(const value of values){
          next.push({...context,[level]:value});
          if(next.length>maxContexts) return {ok:false,contexts:[],tooMany:true};
        }
      }
      contexts=next;
    }
    return {ok:true,contexts};
  }

  function resolveTimeFixedValue(parsed,context){
    if(!parsed?.ok) return NaN;
    if(parsed.expression?.ok){
      const value=parsed.expression.evaluate(context||{});
      return Number.isFinite(value) ? value : NaN;
    }
    if(parsed.symbolic) return Number(context?.[parsed.loopRef]);
    return Number(parsed.value);
  }

  function timeDetailValueAt(parsed,index,context){
    if(parsed?.fixed) return resolveTimeFixedValue(parsed,context);
    return fn.timeHklValueAt(parsed,index);
  }

  function timeEnergyForTransfer(hw){
    const transfer=Number(hw);
    const fixed=num('energy');
    const mode=$('energyMode')?.value || 'Ef fixed';
    if(!(fixed>0) || !Number.isFinite(transfer)) return null;
    const Ei=mode==='Ei fixed' ? fixed : fixed+transfer;
    const Ef=mode==='Ef fixed' ? fixed : fixed-transfer;
    if(!(Ei>0) || !(Ef>0)) return null;
    return {Ei,Ef};
  }

  function timeElasticIncidentEnergy(){
    const E=num('energy');
    return E>0 ? E : NaN;
  }

  function timeS2MagnitudeFromQ(q,hw){
    const energy=timeEnergyForTransfer(hw);
    if(!energy || !(Number(q)>=0)) return null;
    const ki=Math.sqrt(energy.Ei/2.072), kf=Math.sqrt(energy.Ef/2.072);
    const cosS2=(ki*ki+kf*kf-Number(q)*Number(q))/(2*ki*kf);
    if(cosS2<-1-1e-10 || cosS2>1+1e-10) return null;
    return {s2:Math.abs(rad2deg(Math.acos(clamp(cosS2,-1,1)))),Ei:energy.Ei};
  }

  function timeS2LimitAtEi(Ei){
    try{
      const inst=currentInstrument();
      const s2max=effectiveS2MaxAtEi(inst,Ei,false);
      return Number.isFinite(s2max) ? s2max : null;
    }catch(_e){ return null; }
  }

  function timeSignedS2FromMagnitude(s2){
    const mag=Math.abs(Number(s2));
    if(!Number.isFinite(mag)) return NaN;
    const convention=tasConvention(checkedValue('sense'),checkedValue('s1sign'));
    return convention.s2EncoderSign*mag;
  }



  function validateAllTimeScanRows({showMessage=false}={}){
    const rows=[...document.querySelectorAll('#timeScanRows .time-scan-row')];
    const results=[],errors=[],warnings=[];
    for(const row of rows) fn.setTimeScanS2LimitWarning(row,false);
    const loopStack=[];
    for(let i=0;i<rows.length;i++){
      const result=readTimeScanRow(rows[i],i+1);
      results.push(result);
      if(!result.ok){ errors.push(result.error); continue; }
      if(result.kind==='loop') loopStack.push(i);
      else if(result.kind==='endloop'){
        if(!loopStack.length){
          fn.setTimeScanRowWarning(rows[i],true);
          errors.push(`Command ${i+1}: endloop has no matching loop.`);
        }else loopStack.pop();
      }
    }
    for(const i of loopStack){
      fn.setTimeScanRowWarning(rows[i],true);
      errors.push(`Command ${i+1}: loop has no matching endloop.`);
    }
    fn.updateTimeLoopIndentation();
    if(!errors.length){
      const structure=fn.ensureTimeLoopPairIds();
      let darkCache=null, angleCache=null;
      if(checkedValue('sampleMode')==='single'){
        try{ angleCache=deps.singleCache || calculateSingleCrystal(); }catch(_e){ angleCache=null; }
        if($('addDark')?.checked) darkCache=angleCache;
      }
      for(let i=0;i<rows.length;i++){
        const result=results[i];
        if(!result?.ok || result.kind==='loop' || result.kind==='endloop') continue;
        const rowWarnings=fn.timeRowMotionWarnings(rows[i],result,i+1,structure,darkCache,angleCache);
        if(rowWarnings.length){
          warnings.push(...rowWarnings);
          fn.setTimeScanS2LimitWarning(rows[i],true,rowWarnings.join(' / '));
        }
      }
    }
    if(showMessage){
      if(errors.length) setTimeEstimateMessage(errors.join('\n'),true);
      else if(warnings.length) setTimeEstimateMessage(`Warning:\n${warnings.join('\n')}`,false,true);
      else clearTimeEstimateMessage();
    }
    return {ok:errors.length===0,rows,results,errors,warnings};
  }
}
