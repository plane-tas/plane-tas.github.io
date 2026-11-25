// Resolution › Convolution: calculation settings (written into Save CSV and
// put back by Load CSV), the entry boxes kept in the browser, and the
// dispersion file kept in IndexedDB.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {readTasSense} from '../core/tas-conventions.js';
import {movedInstrument} from '../app/instrument-renames.js';

export function installConvolutionSettings(context){
  const {$}=context.deps;
  const {state,fns}=context;
   // 1D scans kept for comparison

  // The last dispersion file is kept in IndexedDB (localStorage is too small
  // for typical tables) and loaded again after a reload.
  const DB_NAME='plane-tas-convolution', STORE='files', KEY='dispersion';
  function openDB(){
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){ reject(new Error('no IndexedDB')); return; }
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(STORE);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function idbPut(key,value){
    try{
      const db=await openDB();
      await new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(value,key); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); });
      db.close();
    }catch(_e){}
  }
  async function idbGet(key){
    try{
      const db=await openDB();
      const rec=await new Promise((resolve,reject)=>{ const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
      db.close();
      return rec ?? null;
    }catch(_e){ return null; }
  }
  const storeFile=record=>idbPut(KEY,record);
  // Results are not kept across a reload (a 2D map can be hundreds of MB):
  // Save CSV / Load CSV keep them.  Only the dispersion file and the entry
  // boxes come back.
  const store2D=()=>{ fns.updateNamePlaceholders?.(); };
  const storeSliders=()=>{};
  const store1D=()=>{};
  // The entry boxes of the Convolution pane are saved with every change and
  // put back after a reload (before the table is read, so its defaults do
  // not overwrite them).
  const RANGE_IDS=['H','K','L','E'].flatMap(n=>[`conv${n}min`,`conv${n}max`,`conv${n}bin`]);
  const SCAN_INPUT_IDS=['convH0','convK0','convL0','convE0','convH1','convK1','convL1','convE1','convPoints1D'];
  // One table format: [index] h k l E1 … En I1 … In (blocks); the index
  // column is found from the column count.
  const formatValue=()=>'block';
  const INPUT_IDS=[...RANGE_IDS,...SCAN_INPUT_IDS,'convSamples2D','convSamples1D','convGrid2D','convGrid1D','convIntegration2D','convIntegration1D','convCsvName2D','convCsvName1D'];
  // Calculation settings written into Save CSV and put back by Load CSV:
  // instrument (sidebar and Resolution instrument details), lattice,
  // scattering plane, and the entries of the 2D slice or 1D cut box.
  const INSTRUMENT_SETTING_IDS=['instrument','instrumentType','monoCrystal','anaCrystal',
    'energyMode','energy','fixedBeamQuantity','sense','msign','s1sign','asign','method',
    'coll1Type','monoHType','monoVType','anaHType','anaVType',
    'gm1','div1m','div1h','div1v','div2h','div2v','div3h','div3v','coll3Type','div4h','div4v',
    'dMono','mosMonoH','mosMonoV','monoHF','monoVF','monoHB','monoVB','monoWcm','monoHcm','monoTcm',
    'dAna','mosAnaH','mosAnaV','anaHF','anaVF','anaHB','anaVB','anaWcm','anaHcm','anaTcm',
    'mosSamH','mosSamV','sampleShape','sampleUcm','sampleVcm','sampleDcm','sampleHcm',
    'L0','L1','L2','L3','srcWcm','srcHcm','sourceShape','detWcm','detHcm','detectorShape',
    'sampleSpaceGroupNumber','a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl','unit'];
  const BOX_SETTING_IDS={'2D':[...RANGE_IDS,'convIntegration2D','convSamples2D','convGrid2D'],'1D':[...SCAN_INPUT_IDS,'convIntegration1D','convSamples1D','convGrid1D']};
  const controlValue=el=>el.type==='checkbox' ? !!el.checked : el.value;
  function settingsSnapshot(dim){
    const pick=ids=>Object.fromEntries(ids.filter(id=>$(id)).map(id=>[id,controlValue($(id))]));
    return {instrument:pick(INSTRUMENT_SETTING_IDS),convolution:pick(BOX_SETTING_IDS[dim]),dispersion:{file:state.fileName,format:formatValue()}};
  }
  // Put a snapshot back.  The instrument (and its type) first: selecting it
  // applies its defaults, which the saved values then overwrite.  Returns
  // notes for anything that could not be restored.
  function applySettings(set,dim){
    const notes=[];
    if(!set || typeof set!=='object') return notes;
    const fire=el=>el.dispatchEvent(new Event('change',{bubbles:true}));
    const put=(id,v)=>{
      const el=$(id); if(!el || v===undefined || v===null) return true;
      if(el.type==='checkbox'){ if(el.checked===!!v) return true; el.checked=!!v; fire(el); return true; }
      if(el.tagName==='SELECT' && ![...el.options].some(o=>o.value===String(v))) return false;
      if(el.value===String(v)) return true;
      el.value=String(v); fire(el); return true;
    };
    const inst={...(set.instrument||{})};
    // The loaded CIF/mCIF stays only when its lattice is the one of the file
    // (a, b, c, α, β, γ to three decimals); otherwise it is unset, so its
    // name is not shown with the lattice of the file.  The space group is
    // put before the lattice (its constraints would change the values); a
    // file without one, with another lattice, gets P1.
    const LATTICE=['a','b','c','alpha','beta','gamma'], cifUnset=$('cifClearButton');
    if(LATTICE.every(id=>Number.isFinite(Number(inst[id])))){
      const same=LATTICE.every(id=>Number(inst[id]).toFixed(3)===Number($(id)?.value).toFixed(3));
      if(!same){
        if(cifUnset && !cifUnset.disabled){ cifUnset.click(); notes.push('CIF/mCIF unset: its lattice differs from the file.'); }
        if(inst.sampleSpaceGroupNumber===undefined) inst.sampleSpaceGroupNumber=1;
      }
    }
    // Files saved with a Geometry (W / anti-W): it is part of the Sense now.
    if(inst.sense!==undefined && inst.geometry!==undefined){ inst.sense=readTasSense(inst.sense,inst.geometry); delete inst.geometry; }
    { const m=movedInstrument(inst.instrument,inst.instrumentType,[...($('instrument')?.options||[])].map(o=>o.value)); if(m){ inst.instrument=m.key; inst.instrumentType=m.type; } }
    // An instrument that is not in the list (loaded from a JSON file in
    // another browser): Custom (every type and crystal) takes its settings.
    if(inst.instrument!==undefined && !put('instrument',inst.instrument)){
      const custom=[...($('instrument')?.options||[])].find(o=>/^zz_00_Custom$/.test(o.value));
      if(custom) put('instrument',custom.value);
      notes.push(`Instrument "${inst.instrument}" not in the list: loaded as ${custom ? 'Custom' : ($('instrument')?.selectedOptions?.[0]?.textContent||'the current instrument')}.`);
    }
    put('instrumentType',inst.instrumentType);
    for(const id of INSTRUMENT_SETTING_IDS){
      if(id==='instrument' || id==='instrumentType') continue;
      put(id,inst[id]);
    }
    // The visible comboboxes drive hidden checkboxes (focusing, supermirror):
    // set them too, from the checkboxes for files saved before they were
    // recorded.  The analyzer focusing switches the 3rd collimator to radial,
    // so the saved 3rd-collimator type is put back last.
    const yes=v=>v===true || v==='true';
    for(const [sel,box] of [['monoHType','monoHF'],['monoVType','monoVF'],['anaHType','anaHF'],['anaVType','anaVF']])
      if(inst[box]!==undefined) put(sel,inst[sel]??(yes(inst[box]) ? 'focusing' : 'flat'));
    if(inst.gm1!==undefined) put('coll1Type',inst.coll1Type??(yes(inst.gm1) ? 'supermirror' : 'soller'));
    if(inst.coll3Type!==undefined){ const c3=$('coll3Type'); if(c3 && c3.value!==String(inst.coll3Type)){ c3.value=String(inst.coll3Type); c3.dispatchEvent(new Event('change',{bubbles:true})); } }
    for(const [id,v] of Object.entries(set.convolution||{})) if(BOX_SETTING_IDS[dim].includes(id)) put(id,v);
    fns.fixChoices(); fns.showIntegration(); saveInputs(); state.bench=null; fns.scheduleEstimates();
    const f=set.dispersion?.file;
    if(f && f!==state.fileName) notes.push(`Calculated with ${f}${state.fileName ? ` (loaded: ${state.fileName})` : ''}.`);
    return notes;
  }
  // One comment line of id=value pairs separated by "; " (no commas, so a
  // spreadsheet keeps it in one cell).  A value with ; , = or % is URI-encoded.
  const settingsLine=(set,prefix='settings')=>{
    if(!set) return null;
    const enc=v=>{ const t=String(v); return /[;,=%]/.test(t) ? encodeURIComponent(t) : t; };
    const flat={...set.instrument,...set.convolution,dispersionFile:set.dispersion?.file||'',dispersionFormat:set.dispersion?.format||''};
    // Radial 3rd collimator: its equivalent divergence (arcmin) as calculated.
    const r3=set.derived?.radial3Arcmin; if(Number.isFinite(r3)) flat.radial3Arcmin=Number(r3.toFixed(2));
    return `# ${prefix}: ${Object.entries(flat).map(([k,v])=>`${k}=${enc(v)}`).join('; ')}`;
  };
  const readSettings=(lines,re)=>{
    const l=lines.find(x=>re.test(x));
    if(!l) return null;
    const body=l.slice(l.indexOf(':')+1).trim();
    if(body.startsWith('{')){ try{ return JSON.parse(body); }catch(_e){ return null; } }
    const set={instrument:{},convolution:{},dispersion:{}};
    const all=[...BOX_SETTING_IDS['2D'],...BOX_SETTING_IDS['1D']];
    for(const part of body.split(/;\s*/)){
      const i=part.indexOf('='); if(i<1) continue;
      const k=part.slice(0,i).trim(); let v=part.slice(i+1).trim();
      try{ v=decodeURIComponent(v); }catch(_e){}
      // Checkboxes were written as true / false.
      const el=$(k); if(el?.type==='checkbox') v=v==='true';
      if(k==='dispersionFile') set.dispersion.file=v;
      else if(k==='dispersionFormat') set.dispersion.format=v;
      else if(k==='radial3Arcmin'){ const a=Number(v); if(Number.isFinite(a)) set.derived={radial3Arcmin:a}; }
      else if(INSTRUMENT_SETTING_IDS.includes(k)) set.instrument[k]=v;
      else if(all.includes(k)) set.convolution[k]=v;
    }
    return set;
  };
  const INPUTS_KEY='plane-tas-convolution-inputs-v1';
  const CHECK_IDS=['convShowDispersion','convShowEllipse','convEllCoh','convEllInc','convShowLine','convLineU','convLineV','convLineE','convNormalize1D','convLog1D','convLog2D'];
  const savedInputsComplete=ids=>ids.every(id=>String($(id)?.value??'').trim()!=='');
  function saveInputs(){
    try{ localStorage.setItem(INPUTS_KEY,JSON.stringify({...Object.fromEntries(INPUT_IDS.map(id=>[id,$(id)?.value??''])),zlim:fns.zlim,
      checks:Object.fromEntries(CHECK_IDS.map(id=>[id,!!$(id)?.checked]))})); }catch(_e){}
  }
  function restoreInputs(){
    let saved=null;
    try{ saved=JSON.parse(localStorage.getItem(INPUTS_KEY)||'null'); }catch(_e){}
    if(!saved) return;
    for(const id of INPUT_IDS) if(typeof saved[id]==='string' && $(id)) $(id).value=saved[id];
    fns.fixChoices();
    if(saved.checks) for(const id of CHECK_IDS) if(typeof saved.checks[id]==='boolean' && $(id)) $(id).checked=saved.checks[id];
    fns.showIntegration();
    if(saved.zlim){ fns.zlim.min=Number.isFinite(saved.zlim.min) ? saved.zlim.min : null; fns.zlim.max=Number.isFinite(saved.zlim.max) ? saved.zlim.max : null; }
  }
  async function restoreFile(){
    restoreInputs();
    $('convFileName').value='';
    fns.setLoaded('2D',''); fns.setLoaded('1D','');
    const rec=await idbGet(KEY);
    if(rec && typeof rec.text==='string' && !state.text){
      state.text=rec.text; state.fileName=rec.name||'';
      $('convFileName').value=state.fileName;
      state.restoring=true;
      try{ fns.loadText(); }finally{ state.restoring=false; }
    }
    await restoreResults();
  }
  // Earlier versions stored the results in the browser: free that space.
  async function restoreResults(){
    for(const key of ['results2d','results2d-sliders','results1d']) if(await idbGet(key)) await idbPut(key,null);
  }
  Object.assign(fns,{DB_NAME, STORE, KEY, openDB, idbPut, idbGet, storeFile, store2D, storeSliders, store1D, RANGE_IDS, SCAN_INPUT_IDS, formatValue, INPUT_IDS, INSTRUMENT_SETTING_IDS, BOX_SETTING_IDS, controlValue, settingsSnapshot, applySettings, settingsLine, readSettings, INPUTS_KEY, CHECK_IDS, savedInputsComplete, saveInputs, restoreInputs, restoreFile, restoreResults});
}
