// Script: S2 state tracking and motor reachability / range warnings.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installMotionChecks(ctx){
  const {deps:{
    buildResolutionLattice, clamp, hklToQ, norm, num, qeDarkBlockWarningsForHKLE, rad2deg
  }, fn}=ctx;
  const deps=ctx.deps;   // optional helpers read from deps at call time
  Object.assign(fn,{
    timeRowMotionWarnings
  });






  // Script-only S2 state tracking.  This does not change any TAS/Q-E geometry
  // calculation; it only reconstructs the motor position reached by preceding
  // Script commands so relative scans can be validated at their actual positions.
  function timeFinalPointIndex(parsedByKey){
    let count=1;
    for(const parsed of Object.values(parsedByKey||{})){
      if(parsed?.ok && Number.isFinite(parsed.count)) count=Math.max(count,Number(parsed.count));
    }
    return Math.max(0,count-1);
  }

  // Each lookup only walks to earlier rows, so the result for a (row, loop
  // context) pair is fixed within one lookup.  Without this memo, relative
  // commands (th2th, scanrel/driverel S2) inside a loop with no absolute S2
  // before them re-searched every earlier row for every loop context,
  // which grows exponentially with the number of such rows and froze the page.
  const timeS2PassMemo=new WeakMap();
  function timeS2Memo(visiting){
    if(!visiting.memo) visiting.memo=new Map();
    return visiting.memo;
  }
  function timeS2ContextKey(context){
    try{ return JSON.stringify(context??null); }catch(_e){ return null; }
  }

  function timeResolveCandidateS2State(candidate,rowIndex,context,structure,visiting=new Set()){
    if(!candidate || visiting.has(rowIndex)) return null;
    const ctxKey=timeS2ContextKey(context);
    const memo=timeS2Memo(visiting);
    const memoKey=ctxKey===null ? null : `${rowIndex}|${ctxKey}`;
    if(memoKey!==null && memo.has(memoKey)) return memo.get(memoKey);
    const result=timeResolveCandidateS2StateUncached(candidate,rowIndex,context,structure,visiting);
    if(memoKey!==null) memo.set(memoKey,result);
    return result;
  }

  function timeResolveCandidateS2StateUncached(candidate,rowIndex,context,structure,visiting){
    visiting.add(rowIndex);
    try{
      const command=candidate.querySelector('[data-time-variable]')?.value||'';
      const meta=fn.timeCommandMeta(command);
      if(!['s2','th2th','qe','hkle','br'].includes(meta.target)) return null;

      const parsedByKey={};
      for(const input of candidate.querySelectorAll('[data-time-range-key]')){
        const parsed=fn.parseTimeDetail(input.value,command,candidate);
        if(!parsed.ok) return null;
        parsedByKey[input.dataset.timeRangeKey]=parsed;
      }
      const finalPoint=timeFinalPointIndex(parsedByKey);

      const resolveWithContext=(ctx)=>{
        if(meta.target==='s2'){
          const parsed=parsedByKey.s2;
          const value=fn.timeDetailValueAt(parsed,finalPoint,ctx);
          if(!Number.isFinite(value)) return null;
          if(meta.op==='driverel' || meta.op==='scanrel'){
            const base=timeS2StateBeforeIndex(rowIndex,ctx,structure,visiting);
            return base ? {...base,s2:base.s2+value,source:command} : null;
          }
          return {s2:value,Ei:fn.timeElasticIncidentEnergy(),source:command};
        }

        if(meta.target==='th2th'){
          const value=fn.timeDetailValueAt(parsedByKey.th2th,finalPoint,ctx);
          if(!Number.isFinite(value)) return null;
          const base=timeS2StateBeforeIndex(rowIndex,ctx,structure,visiting);
          return base ? {...base,s2:base.s2+value,source:command} : null;
        }

        if(meta.target==='qe'){
          const q=fn.timeDetailValueAt(parsedByKey.q,finalPoint,ctx);
          const hw=fn.timeDetailValueAt(parsedByKey.hw,finalPoint,ctx);
          if(!Number.isFinite(q)||!Number.isFinite(hw)) return null;
          const calc=fn.timeS2MagnitudeFromQ(q,hw);
          return calc ? {s2:fn.timeSignedS2FromMagnitude(calc.s2),Ei:calc.Ei,q,hw,source:command} : null;
        }

        let rl; try{ rl=buildResolutionLattice().rl; }catch(_e){ return null; }
        const hkl=meta.target==='br'
          ? (parsedByKey.hkl?.tuple||[]).map(item=>fn.resolveTimeFixedValue(item,ctx))
          : ['h','k','l'].map(key=>fn.timeDetailValueAt(parsedByKey[key],finalPoint,ctx));
        const hw=meta.target==='br'?0:fn.timeDetailValueAt(parsedByKey.hw,finalPoint,ctx);
        if(hkl.length!==3 || hkl.some(v=>!Number.isFinite(v)) || !Number.isFinite(hw)) return null;
        const q=norm(hklToQ(rl,hkl));
        const calc=fn.timeS2MagnitudeFromQ(q,hw);
        return calc ? {s2:fn.timeSignedS2FromMagnitude(calc.s2),Ei:calc.Ei,hkl,hw,source:command} : null;
      };

      const direct=resolveWithContext(context);
      if(direct) return direct;
      // The fallback does not depend on the caller's context: compute it once
      // per row and pass (it scans every loop context of this row).
      const memo=timeS2Memo(visiting), fallbackKey=`${rowIndex}|fallback`;
      if(memo.has(fallbackKey)) return memo.get(fallbackKey);
      let found=null;
      const contexts=fn.timeLoopContextsForRow(candidate,structure);
      if(contexts.ok){
        for(let j=contexts.contexts.length-1;j>=0;j--){
          const fallback=resolveWithContext(contexts.contexts[j]);
          if(fallback){ found=fallback; break; }
        }
      }
      memo.set(fallbackKey,found);
      return found;
    }finally{
      visiting.delete(rowIndex);
    }
  }

  function timeS2StateBeforeIndex(currentIndex,context,structure,visiting=new Set()){
    const memo=timeS2Memo(visiting), ctxKey=timeS2ContextKey(context);
    const key=ctxKey===null ? null : `before|${currentIndex}|${ctxKey}`;
    if(key!==null && memo.has(key)) return memo.get(key);
    const rows=fn.timeScanRows();
    let found=null;
    for(let i=Math.max(0,Number(currentIndex))-1;i>=0;i--){
      const state=timeResolveCandidateS2State(rows[i],i,context,structure,visiting);
      if(state){ found=state; break; }
    }
    if(key!==null) memo.set(key,found);
    return found;
  }

  function timePreviousS2Position(row,index,context,structure){
    const visiting=new Set();
    // Share the memo across every point and row of one validation pass
    // (the loop structure object is rebuilt for each pass).
    if(structure && typeof structure==='object'){
      let memo=timeS2PassMemo.get(structure);
      if(!memo){ memo=new Map(); timeS2PassMemo.set(structure,memo); }
      visiting.memo=memo;
    }
    return timeS2StateBeforeIndex(Math.max(0,Number(index)-1),context,structure,visiting);
  }


  function timeReachabilityFromQ(q,hw){
    const energy=fn.timeEnergyForTransfer(hw);
    if(!energy) return {ok:false,reason:'the selected ħω makes Ei or Ef non-positive'};
    const Q=Number(q);
    if(!(Q>=0)) return {ok:false,reason:'Q is not a valid non-negative value'};
    const ki=Math.sqrt(energy.Ei/2.072), kf=Math.sqrt(energy.Ef/2.072);
    const denom=2*ki*kf;
    const cosS2=(ki*ki+kf*kf-Q*Q)/denom;
    if(cosS2<-1-1e-10 || cosS2>1+1e-10){
      return {ok:false,reason:'the scattering triangle cannot be formed at this Q and ħω',Ei:energy.Ei,Ef:energy.Ef};
    }
    const s2=Math.abs(rad2deg(Math.acos(clamp(cosS2,-1,1))));
    return {ok:true,s2,Ei:energy.Ei,Ef:energy.Ef};
  }

  function timeS2RangeWarning(s2,Ei,detail,index){
    if(!Number.isFinite(s2)) return null;
    const value=Math.abs(Number(s2));
    const min=Math.abs(Number(num('S2min')));
    const max=fn.timeS2LimitAtEi(Ei);
    if(Number.isFinite(min) && value<min-1e-8){
      return `Command ${index}: S2=${value.toFixed(2)}° is below the instrument min ${min.toFixed(2)}° (${detail}).`;
    }
    if(Number.isFinite(max) && value>max+1e-8){
      return `Command ${index}: S2=${value.toFixed(2)}° exceeds the instrument max ${max.toFixed(2)}° at Ei=${Number(Ei).toFixed(2)} meV (${detail}).`;
    }
    return null;
  }


  function timeRowMotionWarnings(row,result,index,structure,darkCache=null,angleCache=null){
    const meta=fn.timeCommandMeta(result.command);
    if(!['s1','s2','th2th','qe','hkle','br'].includes(meta.target)) return [];
    const contextResult=fn.timeLoopContextsForRow(row,structure);
    if(!contextResult.ok){
      return contextResult.tooMany
        ? [`Command ${index}: reachability check skipped because enclosing loops expand beyond 50,000 combinations.`]
        : [];
    }
    const parsedByKey={};
    for(const input of row.querySelectorAll('[data-time-range-key]')){
      const parsed=fn.parseTimeDetail(input.value,result.command,row);
      if(!parsed.ok) return [];
      parsedByKey[input.dataset.timeRangeKey]=parsed;
    }
    let rl=null;
    if(meta.target==='hkle'||meta.target==='br'){
      try{ rl=buildResolutionLattice().rl; }catch(_e){ return []; }
    }
    // A command can contain hundreds of scan points and loop iterations.
    // Record the problem *type* only once, rather than allocating a long
    // warning string containing an HKLE tuple for every affected point.
    const issues=new Set();
    const add=kind=>{ if(kind) issues.add(kind); };
    const checkS2=(s2,Ei)=>{
      if(timeS2RangeWarning(s2,Ei,'',index)) add('S2 out of range');
    };
    const checkReachability=reach=>{
      if(reach?.ok) return true;
      const reason=reach?.reason||'';
      if(reason.includes('scattering triangle cannot be formed')) add('scattering triangle cannot be formed');
      else if(reason.includes('Ei or Ef non-positive')) add('Ei/Ef out of range');
      else if(reason.includes('Q is not a valid')) add('invalid Q');
      else add('inaccessible Q–E point');
      return false;
    };
    const points=Math.max(1,result.points||1);
    for(const context of contextResult.contexts){
      for(let point=0;point<points;point++){
        if(meta.target==='s1'){
          // Relative S1 is not checked against absolute limits without a
          // known starting encoder position; do not report false positives.
          if(meta.op==='driverel'||meta.op==='scanrel') continue;
          const s1=fn.timeDetailValueAt(parsedByKey.s1,point,context);
          const min=num('S1min'),max=num('S1max');
          if(Number.isFinite(s1) && Number.isFinite(min) && Number.isFinite(max)
            && (s1<Math.min(min,max)-1e-8 || s1>Math.max(min,max)+1e-8)){
            add('S1 out of range');
          }
          continue;
        }
        if(meta.target==='s2' || meta.target==='th2th'){
          const key=meta.target==='th2th'?'th2th':'s2';
          const value=fn.timeDetailValueAt(parsedByKey[key],point,context);
          if(!Number.isFinite(value)) continue;
          if(meta.target==='th2th'){
            // SPICE th2th is a relative scan from the preceding S2 position.
            const base=timePreviousS2Position(row,index,context,structure);
            if(!base){ add('th2th: previous S2 position unavailable'); continue; }
            checkS2(base.s2+value,base.Ei);
          }else if(meta.op==='driverel'||meta.op==='scanrel'){
            const base=timePreviousS2Position(row,index,context,structure);
            if(!base) continue;
            checkS2(base.s2+value,base.Ei);
          }else{
            checkS2(value,fn.timeElasticIncidentEnergy());
          }
          continue;
        }
        if(meta.target==='qe'){
          const q=fn.timeDetailValueAt(parsedByKey.q,point,context);
          const hw=fn.timeDetailValueAt(parsedByKey.hw,point,context);
          if(!Number.isFinite(q)||!Number.isFinite(hw)) continue;
          const reach=timeReachabilityFromQ(q,hw);
          if(!checkReachability(reach)) continue;
          checkS2(reach.s2,reach.Ei);
          continue;
        }
        const hkl=meta.target==='br'
          ? (parsedByKey.hkl?.tuple||[]).map(item=>fn.resolveTimeFixedValue(item,context))
          : ['h','k','l'].map(key=>fn.timeDetailValueAt(parsedByKey[key],point,context));
        const hw=meta.target==='br'?0:fn.timeDetailValueAt(parsedByKey.hw,point,context);
        if(hkl.length!==3 || hkl.some(v=>!Number.isFinite(v)) || !Number.isFinite(hw)) continue;
        const plane=fn.hklInCurrentScatteringPlane(hkl);
        if(!plane.ok){ add('HKL outside U–V scattering plane'); continue; }
        const q=norm(hklToQ(rl,hkl));
        const reach=timeReachabilityFromQ(q,hw);
        if(!checkReachability(reach)) continue;
        checkS2(reach.s2,reach.Ei);
        // S1 limits (and an unusable orientation reference) need the full
        // UB/motor-angle calculation: identical to the Angle calculation.
        if(angleCache && typeof deps.geometryPointWarnings==='function'){
          try{ for(const w of deps.geometryPointWarnings(angleCache,{h:hkl[0],k:hkl[1],l:hkl[2],hw})) add(w); }
          catch(_e){ /* reachability was already reported above */ }
        }
        if(darkCache?.addDark){
          for(const block of qeDarkBlockWarningsForHKLE(darkCache,hkl,hw)) add(block);
        }
      }
    }
    if(!issues.size) return [];
    // Keep the order consistent regardless of which scan point failed first.
    const order=['ki blocked','kf blocked','fixed blocked','S1 out of range',
      'S1 unavailable (reference Q)','S2 out of range','scattering triangle cannot be formed',
      'Ei/Ef out of range','invalid Q','inaccessible Q–E point',
      'HKL outside U–V scattering plane','th2th: previous S2 position unavailable'];
    const sorted=[...issues].sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    return [`Command ${index}: ${sorted.join(', ')}.`];
  }
}
