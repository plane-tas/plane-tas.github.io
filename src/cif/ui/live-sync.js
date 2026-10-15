// Live synchronisation of the crystallographic cell and scheduled reflection recalculation.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installLiveSync(ctx){
  const {deps:{
    $, scheduleRecalc
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    scheduleLiveReflectionRecalc, syncCrystallographicCell, updateLiveEditorNuclearSource
  });

// Live calculation state: never overwrite the original CIF/mCIF on edits.
cifState.liveEditorNuclearSource=null;
cifState.liveEditorNuclearInvalid=false;
cifState.liveNuclearCellReference="sample";
let liveReflectionRecalcTimer=0;
let synchronizingLiveCell=false;
const LIVE_REFLECTION_DELAY_MS=250;
// Keep Sample and Structure editor crystallographic cells in step, without
// synthesizing DOM events that could recursively trigger each other.
const SYNCHRONIZED_CELL_IDS={a:"cifA",b:"cifB",c:"cifC",alpha:"cifAlpha",beta:"cifBeta",gamma:"cifGamma"};
function syncCrystallographicCell(origin,{refresh=true,changedId="",commit=false}={}){
  if(synchronizingLiveCell) return;
  synchronizingLiveCell=true;
  try{
    const sampleOrigin=origin==="sample";
    const sgId=sampleOrigin?"sampleSpaceGroup":"cifSpaceGroup";
    const targetSgId=sampleOrigin?"cifSpaceGroup":"sampleSpaceGroup";
    // Number fields are text while the user types: don't normalize half-written
    // decimals (e.g. "5."), don't rewrite the focused field, and don't start
    // a reflection calculation for an incomplete/invalid value.
    const sourceSg=$(sgId);
    const numberEntry=sampleOrigin?"sampleSpaceGroupNumber":"cifSpaceGroupNumber";
    if(changedId===numberEntry){
      const typed=String($(numberEntry)?.value??"");
      if(!/^\d+$/.test(typed) || !fn.sampleSpaceGroupByNumber(Number(typed))) return;
      if(sourceSg) sourceSg.value=typed;
    }
    const n=Number(sourceSg?.value);
    if(!Number.isInteger(n) || !fn.sampleSpaceGroupByNumber(n)) return;
    if(targetSgId==="cifSpaceGroup") fn.selectCifSpaceGroup(n);
    else if($(targetSgId)) $(targetSgId).value=String(n);
    for(const id of ["sampleSpaceGroupNumber","cifSpaceGroupNumber"]){
      if(id!==changedId && $(id)) $(id).value=String(n);
    }
    const changedCellKey=Object.entries(SYNCHRONIZED_CELL_IDS)
      .find(([key,editorId])=>changedId===(sampleOrigin?key:editorId))?.[0];
    // Mirror the edited dimension immediately, without requiring every other
    // dimension to be valid during typing.  Reflection calculation remains
    // guarded by the full-lattice validation below.
    if(changedCellKey){
      const src=$(sampleOrigin?changedCellKey:SYNCHRONIZED_CELL_IDS[changedCellKey]);
      const dst=$(sampleOrigin?SYNCHRONIZED_CELL_IDS[changedCellKey]:changedCellKey);
      if(src && dst) dst.value=src.value;
    }
    const sourceValues={};
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const input=$(sampleOrigin?key:editorId);
      if(!input) return;
      const raw=String(input.value).trim();
      // Preserve unfinished input rather than losing the user's decimal.
      if(raw==="" || raw==="-" || raw==="+" || raw.endsWith(".") ||
         !Number.isFinite(Number(raw)) || Number(raw)<=0 ||
         ((key==="alpha"||key==="beta"||key==="gamma") && Number(raw)>=180)){
        // Still mirror the exact input string for an active field, but defer calculation.
        if(changedCellKey===key){
          const dest=$(sampleOrigin?editorId:key);
          if(dest) dest.value=raw;
        }
        return;
      }
      sourceValues[key]=raw;
    }
    // Copy the edited values first; avoid invoking input/change events recursively.
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const dest=$(sampleOrigin?editorId:key);
      if(dest) dest.value=sourceValues[key];
    }
    // Normalize both sides only after a field is committed or the SG changes;
    // otherwise the active decimal input stays untouched.
    if(commit || changedId===sgId || changedId===numberEntry){
      if(sampleOrigin){
        fn.applySampleLatticeConstraints();
        for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
          if($(editorId) && $(key)) $(editorId).value=$(key).value;
        }
        fn.applyCifLatticeConstraints();
      }else{
        fn.applyCifLatticeConstraints();
        for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
          if($(key) && $(editorId)) $(key).value=$(editorId).value;
        }
        fn.applySampleLatticeConstraints();
      }
    }
    // Final values must agree after applying crystal-system constraints.
    for(const [key,editorId] of Object.entries(SYNCHRONIZED_CELL_IDS)){
      const from=$(sampleOrigin?key:editorId);
      const to=$(sampleOrigin?editorId:key);
      if(from && to) to.value=from.value;
    }
    fn.updateCifSpaceGroupInfo();
    cifState.liveNuclearCellReference="editor";
    if(refresh){
      updateLiveEditorNuclearSource();
      scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
      scheduleRecalc();
    }
  }finally{synchronizingLiveCell=false;}
}

function scheduleLiveReflectionRecalc({nuclear=true,magnetic=false}={}){
  // Coalesce rapid typing; never calculate a half-written numeric value.
  clearTimeout(liveReflectionRecalcTimer);
  liveReflectionRecalcTimer=setTimeout(()=>{
    liveReflectionRecalcTimer=0;
    // Nuclear and magnetic reflections share one table: recalculate both.
    if(nuclear || magnetic) fn.recalculateGeneratedReflections();
  },LIVE_REFLECTION_DELAY_MS);
}
function readLiveEditorNuclearStructure(){
  // Only valid complete snapshots replace the previous reflection source.
  // Build from the real Positions/Uij controls (same validation as Generate CIF).
  const generated=fn.buildGeneratedCif();
  return {structure:generated.parsed,spaceGroup:generated.sg,
    fileName:generated.filename};
}
function updateLiveEditorNuclearSource(){
  try{
    cifState.liveEditorNuclearSource=readLiveEditorNuclearStructure();
    cifState.liveEditorNuclearInvalid=false;
  }catch(_err){
    // Invalid/partial input: show an actionable error instead of stale peaks.
    cifState.liveEditorNuclearSource=null;
    cifState.liveEditorNuclearInvalid=true;
  }
}
}
