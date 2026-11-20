// Resolution › Convolution: a dispersion table (h, k, l, E1 … En, I1 … In)
// convolved with the TAS resolution of the current instrument (Instrument
// details) and sample.  2D: a (U, V, ħω) volume in the scattering plane,
// shown as E–U and E–V maps and a constant-ħω U–V map selected by sliders.
// 1D: a scan with each of H, K, L, E given as a value or ini fin bin.
// Every point is multiplied by the intensity prefactor R0 selected in the
// file card (R0/Rmon, normalisation to monitor counts).
import {parseDispersionTable, createDispersionInterpolator, standardNormalSamples, convolvePoint, convolvePointGrid, nearDispersion, gaussianGrid, autoGridSize} from './convolution-core.js';
import {inverse, matvec} from '../core/matrix.js';
import {movedInstrument} from '../app/instrument-renames.js';
import {fmt, LEGEND_COLS, loadLegendColumns, saveLegendColumns, legendFields as legendValues, legendLine} from './convolution-legend.js';
import {createEngine, initialLattice, newNodes, refineLattice, roughCells, covariance, LATTICE_MAX_NODES} from './convolution-lattice.js';

const ROW_HEIGHT=22;
const NOTE='Intensities are S(Q,ω); R0/Rmon (normalisation to monitor counts) is applied automatically.';
// Plotly sizes are scaled by the UI density (about 0.67 on a laptop).
const FONT={size:19}, TITLE_FONT={size:21}, AXIS_TITLE_FONT={size:20};
const MAX_TABLE_RANGE_POINTS={ab:101,E:301};

export function createConvolutionUI(deps){
  const {$, collectResolutionBase, calcResolution, parseNumericValue, setStatus}=deps;
  let text='', fileName='', data=null, interp=null;
  let volume=null, scan=null;
  let run2D=0, run1D=0;
  let fileTag='', restoring=false, restoringResults=false, namedFor=null;
  // Colour-scale limits of the three maps (null = automatic).
  // Colour scale of the three 2D maps (one range; null = automatic).
  const zlim={min:null,max:null};
  const kept=[];   // 1D scans kept for comparison

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
  const store2D=()=>{ updateNamePlaceholders?.(); };
  const storeSliders=()=>{};
  const store1D=()=>{};
  // The entry boxes of the Convolution pane are saved with every change and
  // put back after a reload (before the table is read, so its defaults do
  // not overwrite them).
  const RANGE_IDS=['H','K','L','E'].flatMap(n=>[`conv${n}min`,`conv${n}max`,`conv${n}bin`]);
  const SCAN_INPUT_IDS=['convH0','convK0','convL0','convE0','convH1','convK1','convL1','convE1','convPoints1D'];
  const INPUT_IDS=[...RANGE_IDS,...SCAN_INPUT_IDS,'convSamples2D','convSamples1D','convGrid2D','convGrid1D','convIntegration2D','convIntegration1D','convCsvName2D','convCsvName1D'];
  // Calculation settings written into Save CSV and put back by Load CSV:
  // instrument (sidebar and Resolution instrument details), lattice,
  // scattering plane, and the entries of the 2D slice or 1D cut box.
  const INSTRUMENT_SETTING_IDS=['instrument','instrumentType','monoCrystal','anaCrystal',
    'energyMode','energy','fixedBeamQuantity','geometry','sense','s1sign','method',
    'coll1Type','monoHType','monoVType','anaHType','anaVType',
    'gm1','div1m','div1h','div1v','div2h','div2v','div3h','div3v','coll3Type','div4h','div4v',
    'dMono','mosMonoH','mosMonoV','monoHF','monoVF','monoHB','monoVB','monoWcm','monoHcm','monoTcm',
    'dAna','mosAnaH','mosAnaV','anaHF','anaVF','anaHB','anaVB','anaWcm','anaHcm','anaTcm',
    'mosSamH','mosSamV','sampleShape','sampleUcm','sampleVcm','sampleDcm','sampleHcm',
    'L0','L1','L2','L3','srcWcm','srcHcm','sourceShape','detWcm','detHcm','detectorShape',
    'a','b','c','alpha','beta','gamma','Uh','Uk','Ul','Vh','Vk','Vl','unit'];
  const BOX_SETTING_IDS={'2D':[...RANGE_IDS,'convIntegration2D','convSamples2D','convGrid2D'],'1D':[...SCAN_INPUT_IDS,'convIntegration1D','convSamples1D','convGrid1D']};
  const controlValue=el=>el.type==='checkbox' ? !!el.checked : el.value;
  function settingsSnapshot(dim){
    const pick=ids=>Object.fromEntries(ids.filter(id=>$(id)).map(id=>[id,controlValue($(id))]));
    return {instrument:pick(INSTRUMENT_SETTING_IDS),convolution:pick(BOX_SETTING_IDS[dim]),dispersion:{file:fileName,format:$('convFormat')?.value||''}};
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
    fixChoices(); showIntegration(); saveInputs(); bench=null; scheduleEstimates();
    const f=set.dispersion?.file;
    if(f && f!==fileName) notes.push(`Calculated with ${f}${fileName ? ` (loaded: ${fileName})` : ''}.`);
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
  const CHECK_IDS=['convShowDispersion','convShowEllipse','convEllCoh','convEllInc','convShowLine','convLineU','convLineV','convLineE','convNormalize1D'];
  const savedInputsComplete=ids=>ids.every(id=>String($(id)?.value??'').trim()!=='');
  function saveInputs(){
    try{ localStorage.setItem(INPUTS_KEY,JSON.stringify({...Object.fromEntries(INPUT_IDS.map(id=>[id,$(id)?.value??''])),zlim,
      checks:Object.fromEntries(CHECK_IDS.map(id=>[id,!!$(id)?.checked]))})); }catch(_e){}
  }
  function restoreInputs(){
    let saved=null;
    try{ saved=JSON.parse(localStorage.getItem(INPUTS_KEY)||'null'); }catch(_e){}
    if(!saved) return;
    for(const id of INPUT_IDS) if(typeof saved[id]==='string' && $(id)) $(id).value=saved[id];
    fixChoices();
    if(saved.checks) for(const id of CHECK_IDS) if(typeof saved.checks[id]==='boolean' && $(id)) $(id).checked=saved.checks[id];
    showIntegration();
    if(saved.zlim){ zlim.min=Number.isFinite(saved.zlim.min) ? saved.zlim.min : null; zlim.max=Number.isFinite(saved.zlim.max) ? saved.zlim.max : null; }
  }
  async function restoreFile(){
    restoreInputs();
    $('convFileName').value='';
    setLoaded('2D',''); setLoaded('1D','');
    const rec=await idbGet(KEY);
    if(rec && typeof rec.text==='string' && !text){
      text=rec.text; fileName=rec.name||'';
      $('convFileName').value=fileName;
      if(rec.format && [...$('convFormat').options].some(o=>o.value===rec.format)) $('convFormat').value=rec.format;
      restoring=true;
      try{ loadText(); }finally{ restoring=false; }
    }
    await restoreResults();
  }
  // Earlier versions stored the results in the browser: free that space.
  async function restoreResults(){
    for(const key of ['results2d','results2d-sliders','results1d']) if(await idbGet(key)) await idbPut(key,null);
  }

  const num=id=>{ const v=Number($(id)?.value); return Number.isFinite(v) ? v : NaN; };
  const vec=v=>`(${v.map(x=>fmt(x)).join(', ')})`;
  const message=(id,t,error=false)=>{ const el=$(id); if(!el) return; el.textContent=t; el.title=t; el.classList.toggle('conv-error',!!error); el.classList.remove('convolution-progress-on'); el.style.setProperty('--conv-progress','0%'); };
  const yieldUI=()=>new Promise(r=>setTimeout(r,0));
  const plotly=()=>typeof Plotly!=='undefined';

  // Default number of points of the 1D scan: an energy step of about 1/8 of
  // the energy resolution (FWHM of the projection, the finest over a few
  // energies of the scan), 51 to 2001 points.  Without a resolution (the
  // instrument cannot reach the scan) the step of the 2D map is used.
  function defaultScanPoints(hkl,e0,e1,eb){
    const fallback=eb>0 ? Math.max(51,Math.min(2001,Math.round((e1-e0)/eb)+1)) : 51;
    if(!(e1>e0)) return fallback;
    let base; try{ base=collectResolutionBase(); }catch(_e){ return fallback; }
    let fw=Infinity;
    for(let i=0;i<=6;i++){
      const r=resolutionAt(base,hkl,e0+(e1-e0)*i/6,{});
      const w=r?.widths?.E;
      if(Number.isFinite(w) && w>0) fw=Math.min(fw,w);
    }
    if(!Number.isFinite(fw)) return fallback;
    return Math.max(51,Math.min(2001,Math.round((e1-e0)/(fw/8))+1));
  }
  // ------------------------------------------------------------ loading --
  function loadText(){
    if(!text) return;
    try{
      data=parseDispersionTable(text,$('convFormat')?.value||'index');
      interp=createDispersionInterpolator(data);
      tableKey++;
      volume=null; scan=null;
      $('convDownload2D').disabled=true; updateKeepButtons();
      // After a reload the saved entries win over the table defaults.
      if(!(restoring && savedInputsComplete(RANGE_IDS))) fillRanges();
      $('convResetRanges').disabled=false;
      renderTableHead(); renderTableRows(true);
      const kind=interp.grid ? 'regular grid, trilinear interpolation' : 'scattered points, nearest point';
      $('convSummary').textContent=NOTE;
      $('convSummary').classList.remove('conv-error');
      $('convTableInfo').textContent=`${fileName}: ${data.points.length} Q points, ${data.nBranch} branch${data.nBranch>1?'es':''} (${kind}); ${data.rows.length} rows × ${data.rows[0].length} columns.`;
      if(fileTag!==fileName){
        fileTag=fileName;
        const keep=restoring && savedInputsComplete(SCAN_INPUT_IDS);
        if(!keep){
          // Defaults at the table node nearest to the centre of each axis.
          const c=interp.axes.map(a=>{
            const mid=(a[0]+a[a.length-1])/2;
            let best=a[0];
            // Ties: prefer the rounder value (7.5 rather than 7.486), then the smaller one.
            const len=x=>fmt(x).length;
            for(const x of a){ const d=Math.abs(x-mid)-Math.abs(best-mid); if(d<-1e-6 || (Math.abs(d)<=1e-6 && (len(x)<len(best) || (len(x)===len(best) && Math.abs(x)<Math.abs(best))))) best=x; }
            return fmt(best);
          });
          ['H','K','L'].forEach((nm,i)=>{ $(`conv${nm}0`).value=c[i]; $(`conv${nm}1`).value=c[i]; });
          // Constant-Q scan over the E range of the table by default.
          const e0=num('convEmin'), e1=num('convEmax'), eb=num('convEbin');
          $('convE0').value=fmt(e0,3); $('convE1').value=fmt(e1,3);
          $('convPoints1D').value=String(defaultScanPoints(c.map(Number),e0,e1,eb));
        }
      }
      message('convMessage2D',''); message('convMessage1D',''); message('convStatus1D','');
      bench=null; scheduleEstimates();
      // Save CSV file names: the dispersion file name + _conv_2d / _conv_1d
      // when a new file is read (editable; a name kept from the last visit
      // stays on a reload).
      if(fileName!==namedFor){
        namedFor=fileName;
        for(const kind of ['2d','1d']){ const el=nameInput(kind); if(el && !(restoring && el.value.trim())) el.value=autoBase(fileName,kind); }
      }
      if(!restoring) saveInputs();
    }catch(err){
      data=null; interp=null;
      $('convResetRanges').disabled=true;
      $('convSummary').textContent=err.message||String(err);
      $('convSummary').classList.add('conv-error');
      $('convTableHead').replaceChildren(); $('convTableBody').replaceChildren();
      $('convTableInfo').textContent='The file does not match the selected columns.';
    }
  }
  async function loadFile(file){
    if(!file) return;
    if(!/\.(txt|dat|csv)$/i.test(file.name)){ $('convSummary').textContent='Select a .txt, .dat or .csv file.'; $('convSummary').classList.add('conv-error'); return; }
    text=await file.text(); fileName=file.name;
    $('convFileName').value=file.name;
    loadText();
    storeFile({name:fileName,format:$('convFormat')?.value,text});
  }
  // H, K, L: the loaded grid; ħω: the branch energies with a margin.
  function fillRanges(){
    const names=['H','K','L'];
    names.forEach((n,i)=>{
      const ax=interp.axes[i], r=interp.ranges[i];
      const bin=ax.length>1 ? (r.max-r.min)/(ax.length-1) : 0;
      $(`conv${n}min`).value=fmt(r.min,6); $(`conv${n}max`).value=fmt(r.max,6); $(`conv${n}bin`).value=fmt(bin,6);
    });
    const pad=Math.max(1,0.2*(data.eMax-data.eMin));
    $('convEmin').value=fmt(Math.floor((data.eMin-pad)*2)/2,3);
    $('convEmax').value=fmt(Math.ceil((data.eMax+pad)*2)/2,3);
    $('convEbin').value='0.2';
  }
  function ranges(){
    const out={};
    for(const n of ['H','K','L','E']){
      const lo=num(`conv${n}min`), hi=num(`conv${n}max`), bin=num(`conv${n}bin`);
      if(![lo,hi].every(Number.isFinite) || hi<lo) throw new Error(`Check the ${n==='E'?'ħω':n.toLowerCase()} min / max.`);
      out[n]={min:lo,max:hi,bin:bin>0 ? bin : 0};
    }
    if(!(out.E.bin>0) || !(out.E.max>out.E.min)) throw new Error('ħω needs max > min and a positive bin.');
    return out;
  }

  // -------------------------------------------------------- table viewer --
  function columnNames(){
    const n=data.nBranch;
    const b=Array.from({length:n},(_,i)=>i+1);
    const branches=data.paired ? b.flatMap(i=>[`E${i}`,`I${i}`]) : [...b.map(i=>`E${i}`),...b.map(i=>`I${i}`)];
    return [data.offset ? 'index' : '#','H','K','L',...branches];
  }
  function renderTableHead(){
    const tr=document.createElement('tr');
    for(const name of columnNames()){ const th=document.createElement('th'); th.textContent=name; tr.appendChild(th); }
    $('convTableHead').replaceChildren(tr);
  }
  const cell=v=>{ const a=Math.abs(v); return v===0 ? '0' : (a>=1e-3 && a<1e5 ? String(Number(v.toPrecision(6))) : v.toExponential(3)); };
  function renderTableRows(reset=false){
    const body=$('convTableBody'), box=$('convTableScroll');
    if(!data || !body || !box) return;
    if(reset) box.scrollTop=0;
    const total=data.rows.length, cols=columnNames().length;
    const first=Math.max(0,Math.floor(box.scrollTop/ROW_HEIGHT)-10);
    const count=Math.ceil((box.clientHeight||400)/ROW_HEIGHT)+20;
    const last=Math.min(total,first+count);
    const spacer=h=>{ const tr=document.createElement('tr'); tr.className='convolution-spacer'; const td=document.createElement('td'); td.colSpan=cols; td.style.height=`${h}px`; tr.appendChild(td); return tr; };
    const rows=[spacer(first*ROW_HEIGHT)];
    for(let i=first;i<last;i++){
      const r=data.rows[i], tr=document.createElement('tr');
      const values=data.offset ? r : [i+1,...r];
      for(const v of values){ const td=document.createElement('td'); td.textContent=cell(v); tr.appendChild(td); }
      rows.push(tr);
    }
    rows.push(spacer((total-last)*ROW_HEIGHT));
    body.replaceChildren(...rows);
  }

  // ---------------------------------------------------------- resolution --
  function resolutionAt(base,hkl,E,cache){
    try{
      const res=calcResolution(base.lc,base.rl,base.col,base.mos,base.config,base.approximation,base.focusing,base.geom,
        {h:hkl[0],k:hkl[1],l:hkl[2],hw:E},'ainv');
      if(!cache.UBinv) cache.UBinv=inverse(res.UB);
      res.UBinv=cache.UBinv;
      return res;
    }catch(_e){ return null; }
  }
  // integ: {mode:'mc',samples} or {mode:'grid',grid} (see integrationFor).
  function intensityAt(base,hkl,E,integ,cache,stats,resIn){
    const res=resIn===undefined ? resolutionAt(base,hkl,E,cache) : resIn;
    if(!res){ stats.unreachable++; return NaN; }
    const r=integ.mode==='grid'
      ? convolvePointGrid(hkl,E,res,interp,integ.grid,{model:'given'})
      : convolvePoint(hkl,E,res,interp,integ.samples,{model:'given'});
    stats.outside=Math.max(stats.outside,r.outside);
    return r.intensity*prefactor(res);
  }
  // Intensity prefactor of an S(Q,ω) table: R0/Rmon of the selected
  // approximation, normalisation to monitor counts (calcResolution's prefactor).
  const prefactor=res=>Number.isFinite(res.prefactor) ? res.prefactor : NaN;
  // Is a Q point inside the table?  A single-valued axis is flat (any value).
  const inTable=hkl=>interp.ranges.every((r,i)=>interp.flat?.[i] || (hkl[i]>=r.min-1e-9 && hkl[i]<=r.max+1e-9));
  const tableRangeText=()=>['H','K','L'].map((n,i)=>interp.flat?.[i] ? `${n} any` : `${n} ${fmt(interp.ranges[i].min)}…${fmt(interp.ranges[i].max)}`).join(', ');
  // Integration over the resolution ellipsoid, chosen from fixed lists (no
  // unbounded memory: a grid holds at most 29³ nodes, Monte Carlo at most
  // 30000 points per worker).
  //  Grid: a Gaussian-weighted grid within ±3.5 σ (±1.5 FWHM) on every axis
  //  of the ellipsoid.  The choice is the number of nodes n on the finest axis
  //  (spacing 7σ/(n−1): 9 → 0.88σ, 15 → σ/2, 21 → σ/3, 29 → σ/4).  The other
  //  axes get fewer in proportion to how steeply the dispersion crosses the
  //  resolution along them (autoGridSize); an axis along which nothing
  //  changes gets one node.
  //  Monte Carlo: the number of random points.
  const GRID_CHOICES=[9,15,21,29], MC_CHOICES=[1000,3000,10000,30000];
  const GRID_DEFAULT={'2D':9,'1D':21}, MC_DEFAULT={'2D':1000,'1D':3000};
  const choice=(id,list,dflt)=>{ const v=Number($(id)?.value); return list.includes(v) ? v : dflt; };
  const mcSamples=dim=>choice(`convSamples${dim}`,MC_CHOICES,MC_DEFAULT[dim]);
  const gridMax=dim=>choice(`convGrid${dim}`,GRID_CHOICES,GRID_DEFAULT[dim]);
  const samplesFrom=dim=>standardNormalSamples(mcSamples(dim));
  // A value restored from an older version that is not in a list: the default.
  function fixChoices(){
    for(const dim of ['2D','1D']){
      for(const [id,list,d] of [[`convSamples${dim}`,MC_CHOICES,MC_DEFAULT[dim]],[`convGrid${dim}`,GRID_CHOICES,GRID_DEFAULT[dim]]]){
        const el=$(id); if(el && !list.includes(Number(el.value))) el.value=String(d);
      }
    }
  }
  const integrationMode=dim=>$(`convIntegration${dim}`)?.value==='mc' ? 'mc' : 'grid';
  function showIntegration(){
    // The slot right of the select: the grid spacing (Grid) or the number of
    // random points (Monte Carlo); its width is fixed so the select stays put.
    for(const dim of ['2D','1D']){
      const mc=integrationMode(dim)==='mc';
      const f=$(`convSamples${dim}Field`); if(f) f.hidden=!mc;
      const g=$(`convGridRange${dim}`); if(g) g.hidden=mc;
    }
  }
  function gridSizeFor(dim,points){
    const n=[1,1,1]; let sized=0;
    for(const {hkl,E,res} of points){
      if(!res) continue;
      const a=autoGridSize(hkl,E,res,interp,{budget:Infinity});
      for(let i=0;i<3;i++) n[i]=Math.max(n[i],a.n[i]);
      sized++;
    }
    return sizeGrid(dim,sized ? n : DEFAULT_GRID);
  }
  // Grid size when no resolution point could be checked.
  const DEFAULT_GRID=[11,11,11];
  // The chosen number of nodes on the finest axis; the others scaled in the
  // proportions of the automatic size (odd counts: a node at the centre).
  function sizeGrid(dim,nAuto){
    const N=gridMax(dim), m=Math.max(...nAuto);
    if(!(m>1)) return [1,1,1];
    return nAuto.map(x=>{ if(x<=1) return 1; const k=Math.round(x*N/m); return Math.max(3,k%2 ? k : k+1); });
  }
  function integrationFor(dim,points){
    if(integrationMode(dim)==='mc') return {mode:'mc',samples:samplesFrom(dim)};
    return {mode:'grid',grid:gaussianGrid(gridSizeFor(dim,points))};
  }
  const grid=(lo,hi,step,cap)=>{
    const n=step>0 ? Math.min(cap,Math.max(2,Math.round((hi-lo)/step)+1)) : 1;
    return n===1 ? [lo] : Array.from({length:n},(_,i)=>lo+(hi-lo)*i/(n-1));
  };

  // Scattering-plane coordinates: hkl = a U + b V (+ the out-of-plane part 0).
  function planeBasis(base){
    const U=base.lc.sv1.map(Number), V=base.lc.sv2.map(Number);
    const B=[base.rl.astar,base.rl.bstar,base.rl.cstar];
    const cart=h=>[0,1,2].map(j=>h[0]*B[0][j]+h[1]*B[1][j]+h[2]*B[2][j]);
    const qU=cart(U), qV=cart(V);
    const dot=(x,y)=>x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
    const g=[[dot(qU,qU),dot(qU,qV)],[dot(qU,qV),dot(qV,qV)]], det=g[0][0]*g[1][1]-g[0][1]*g[1][0];
    const coeff=h=>{ const q=cart(h), r=[dot(q,qU),dot(q,qV)]; return [(g[1][1]*r[0]-g[0][1]*r[1])/det,(g[0][0]*r[1]-g[0][1]*r[0])/det]; };
    return {U,V,coeff,hkl:(a,b)=>U.map((x,i)=>a*x+b*V[i])};
  }
  function axisRange(rg,plane,which){
    const vecv=which==='a' ? plane.U : plane.V;
    // Coefficient range from the h, k, l box corners; step from the bins.
    const vals=[];
    for(const h of [rg.H.min,rg.H.max]) for(const k of [rg.K.min,rg.K.max]) for(const l of [rg.L.min,rg.L.max]) vals.push(plane.coeff([h,k,l])[which==='a'?0:1]);
    let step=Infinity;
    ['H','K','L'].forEach((n,i)=>{ if(Math.abs(vecv[i])>1e-9 && rg[n].bin>0) step=Math.min(step,rg[n].bin/Math.abs(vecv[i])); });
    return {min:Math.min(...vals),max:Math.max(...vals),step:Number.isFinite(step) ? step : (Math.max(...vals)-Math.min(...vals))/40};
  }
  const insideBox=(hkl,rg)=>['H','K','L'].every((n,i)=>hkl[i]>=rg[n].min-1e-6-rg[n].bin/2 && hkl[i]<=rg[n].max+1e-6+rg[n].bin/2);

  // --------------------------------------------------------------- 2D -----
  // The (U, V, ħω) grid of the 2D calculation and the expected number of
  // resolution matrices (shared with the time estimate).
  function prepare2D(){
    if(!interp) throw new Error('Load a dispersion file first.');
    const base=collectResolutionBase(), rg=ranges(), plane=planeBasis(base);
    const ra=axisRange(rg,plane,'a'), rb=axisRange(rg,plane,'b');
    let A=grid(ra.min,ra.max,ra.step,MAX_TABLE_RANGE_POINTS.ab), Bv=grid(rb.min,rb.max,rb.step,MAX_TABLE_RANGE_POINTS.ab);
    // Keep only the U and V values that reach the h, k, l range (an
    // oblique plane cuts the box corners): the sliders stay inside it.
    const inside=hkl=>['H','K','L'].every((n,i)=>hkl[i]>=rg[n].min-1e-9 && hkl[i]<=rg[n].max+1e-9);
    const hitA=A.map(a=>Bv.some(b=>inside(plane.hkl(a,b)))), hitB=Bv.map(b=>A.some(a=>inside(plane.hkl(a,b))));
    if(!hitA.some(Boolean)) throw new Error('The scattering plane does not cross the h, k, l range.');
    const span=hit=>[hit.indexOf(true),hit.lastIndexOf(true)+1];
    A=A.slice(...span(hitA)); Bv=Bv.slice(...span(hitB));
    if(A.length<2 || Bv.length<2) throw new Error('The h, k, l range is too narrow in the scattering plane.');
    const E=grid(rg.E.min,rg.E.max,rg.E.bin,MAX_TABLE_RANGE_POINTS.E);
    // Resolution matrices: on a lattice of nodes, refined where needed (see
    // convolution-lattice.js); about twice the starting lattice.
    let nInside=0;
    for(const b of Bv) for(const a of A) if(insideBox(plane.hkl(a,b),rg)) nInside++;
    const L0=initialLattice(A,Bv,E);
    return {base,rg,plane,A,Bv,E,nInside,nRes:2*L0.a.length*L0.b.length*L0.e.length};
  }
  let busy2D=false;
  // While calculating, Calculate is the Stop button.  The status next to it
  // is a progress bar: "45 %" over a growing fill, then "Completed" (full) or
  // "Stopped" (the fill where it stopped).  Other messages show without fill.
  function setRunning(id,on){
    const b=$(id); if(!b) return;
    b.textContent=on ? 'Stop' : 'Calculate';
    b.classList.toggle('convolution-stop',on);
    b.title=on ? 'Stop the calculation' : '';
  }
  const setFill=(id,frac)=>{ const el=$(id); if(el) el.style.setProperty('--conv-progress',`${Math.max(0,Math.min(100,Math.round(100*frac)))}%`); };
  function setProgress(id,frac){
    message(id,`${Math.max(0,Math.min(100,Math.round(100*frac)))} %`);
    setFill(id,frac);
    $(id)?.classList.add('convolution-progress-on');
  }
  function statusEnd(id,text,keepFill){
    const el=$(id), fill=el?.style.getPropertyValue('--conv-progress');
    message(id,text);
    if(keepFill && fill){ el.style.setProperty('--conv-progress',fill); el.classList.add('convolution-progress-on'); }
  }
  // Stop: the 2D result is discarded (the previous maps stay).
  function stop2D(){ run2D++; cancelJobs(); busy2D=false; setRunning('convCalculate2D',false); statusEnd('convMessage2D','Stopped',true); }
  async function calculate2D(){
    if(busy2D){ stop2D(); return; }
    const id=++run2D;
    try{
      const P=prepare2D();
      const {A,Bv,E,plane}=P;
      const settings=settingsSnapshot('2D');
      busy2D=true; setRunning('convCalculate2D',true);
      setProgress('convMessage2D',0);
      let out=null;
      const ws=getWorkers();
      if(ws){
        try{ out=await run2DOn(id,workerRunner(ws),P); }
        catch(err){
          if(id!==run2D) return;
          if(!err?.workerFailed) throw err;
          // The workers could not start (old browser, file://): one thread.
          workersBroken=true; killWorkers();
        }
      }
      if(id!==run2D) return;
      if(!out) out=await run2DOn(id,pageRunner(id),P);
      if(id!==run2D || !out) return;
      finish2D(A,Bv,E,out,plane,settings);
    }catch(err){ if(id===run2D){ cancelJobs(); busy2D=false; setRunning('convCalculate2D',false); message('convMessage2D',err.message||String(err),true); } }
  }
  function finish2D(A,Bv,E,I,plane,settings){
    busy2D=false; setRunning('convCalculate2D',false);
    volume={A,B:Bv,E,I,plane,U:plane.U,V:plane.V,settings};
    zlim.min=null; zlim.max=null; saveInputs();
    store2D();
    $('convDownload2D').disabled=false;
    showConvTab('2d');
    setupSliders();
    drawMaps();
    setProgress('convMessage2D',1); message('convMessage2D','Completed'); setFill('convMessage2D',1); $('convMessage2D')?.classList.add('convolution-progress-on');
    setStatus?.('Convolution 2D calculated');
  }

  // ------------------------------------------------------------ workers --
  // A 2D map is shared between the CPU cores: one worker per core, each
  // with its own copy of the dispersion table.  Jobs go to whichever worker
  // is free.  Stop terminates the workers (new ones start on the next run).
  // Without workers the page runs the same engine itself.
  let workers=null, workersBroken=false, tableKey=0, cancelJobs=()=>{};
  // Calculation threads: half of the logical cores (hardwareConcurrency), at
  // least one.  With hyper-threading the second half adds little speed, and
  // leaving it free keeps the page and the rest of the computer responsive.
  const workerCount=()=>{
    const n=Math.max(1,Math.round(Number(navigator.hardwareConcurrency)||4));
    return Math.max(1,Math.min(32,Math.floor(n/2)));
  };
  const workersAvailable=()=>!workersBroken && typeof Worker!=='undefined';
  function getWorkers(){
    if(workers || !workersAvailable()) return workers;
    try{
      workers=Array.from({length:workerCount()},()=>new Worker(new URL('./convolution-worker.js',import.meta.url),{type:'module'}));
    }catch(_e){ workersBroken=true; workers=null; }
    return workers;
  }
  function killWorkers(){ workers?.forEach(w=>w.terminate()); workers=null; }
  // Run jobs on the workers; onDone(reply, job) for each.  A worker that
  // fails to load rejects with workerFailed (the caller then runs on the page).
  function runJobs(ws,jobs,onDone){
    return new Promise((resolve,reject)=>{
      let next=0, pending=0, over=false;
      const end=(fn,arg)=>{
        if(over) return;
        over=true; cancelJobs=()=>{};
        // After an error the other workers may still be busy: their late
        // replies must not reach the next run.
        if(fn===reject) killWorkers();
        fn(arg);
      };
      cancelJobs=()=>end(reject,new Error('Stopped'));
      const give=w=>{
        if(over) return;
        if(next>=jobs.length){ if(!pending) end(resolve); return; }
        const j=jobs[next], idx=next++;
        pending++;
        w.postMessage({...j.msg,id:idx});
      };
      for(const w of ws){
        w.onmessage=ev=>{
          const m=ev.data;
          if(m.type==='error'){ end(reject,new Error(m.message)); return; }
          pending--;
          try{ onDone(m,jobs[m.id]); }catch(err){ end(reject,err); return; }
          give(w);
        };
        w.onerror=ev=>{ ev.preventDefault?.(); const e=new Error('The calculation threads could not start.'); e.workerFailed=true; end(reject,e); };
      }
      if(!jobs.length){ end(resolve); return; }
      ws.forEach(give);
    });
  }
  const workerRunner=ws=>({
    size:ws.length,
    broadcast:msg=>ws.forEach(w=>w.postMessage(msg)),
    run:(jobs,onDone)=>runJobs(ws,jobs,onDone)
  });
  function pageRunner(id){
    const engine=createEngine(calcResolution);
    return {
      size:1,
      broadcast:msg=>engine.handle(msg),
      async run(jobs,onDone){
        let t0=performance.now();
        for(let i=0;i<jobs.length;i++){
          onDone(engine.handle({...jobs[i].msg,id:i}),jobs[i]);
          if(performance.now()-t0>150){ t0=performance.now(); await yieldUI(); if(id!==run2D) throw new Error('Stopped'); }
        }
      }
    };
  }
  // A 2D map in two phases.  1: resolution matrices on the lattice of nodes,
  // refined round by round where they change too much (and the automatic
  // grid size from the nodes inside the range).  2: the points, a piece of a
  // row per job (see convolution-lattice.js for how a point gets its matrix).
  async function run2DOn(id,R,P){
    const {base,rg,plane,A,Bv,E}=P, nA=A.length, nE=E.length;
    const gridMode=integrationMode('2D')==='grid';
    R.broadcast({type:'table',key:tableKey,text,format:$('convFormat')?.value||'index'});
    R.broadcast({type:'base',base});
    const items=[];  // per row: [{ia,hkl}] inside the range
    for(let ib=0;ib<Bv.length;ib++){
      const row=[];
      for(let ia=0;ia<nA;ia++){ const hkl=plane.hkl(A[ia],Bv[ib]); if(insideBox(hkl,rg)) row.push({ia,hkl}); }
      items.push(row);
    }
    const nPts=items.reduce((n,r)=>n+r.length,0)*nE;
    const bins={a:nA>1 ? Math.abs(A[1]-A[0]) : Infinity,b:Bv.length>1 ? Math.abs(Bv[1]-Bv[0]) : Infinity,e:nE>1 ? Math.abs(E[1]-E[0]) : Infinity};
    // Progress: the nodes first (their share from the time per resolution
    // matrix), then the points.
    const b=bench, tRes=b?.tRes||2, tPt=b ? (gridMode ? 0.25*999*b.tNode : 300*b.tSample) : 0.2;
    let lat=initialLattice(A,Bv,E), old=null;
    const estNodes=2*lat.a.length*lat.b.length*lat.e.length;
    const shareA=estNodes*tRes/(estNodes*tRes+nPts*tPt);
    let lastShow=0;
    const show=f=>{ const t=performance.now(); if(t-lastShow>150){ lastShow=t; setProgress('convMessage2D',f); } };

    // Phase 1
    const key=(a,b,e)=>`${a},${b},${e}`, store=new Map(), cov=new Map();
    const covOf=L=>newNodes(L,null).map(p=>cov.get(key(p.a,p.b,p.e)));
    let n=[1,1,1], sized=0, doneNodes=0;
    for(let round=0;round<10;round++){
      const fresh=newNodes(lat,old).filter(p=>!store.has(key(p.a,p.b,p.e)));
      const chunk=Math.max(1,Math.min(64,Math.ceil(fresh.length/(4*R.size))));
      const jobs=[];
      for(let k=0;k<fresh.length;k+=chunk){
        const part=fresh.slice(k,k+chunk);
        jobs.push({part,msg:{type:'nodes',pts:part.map(p=>{ const hkl=plane.hkl(p.a,p.b); return {hkl,E:p.e,size:gridMode && insideBox(hkl,rg)}; })}});
      }
      await R.run(jobs,(m,job)=>{
        m.out.forEach((o,i)=>{
          const p=job.part[i], k=key(p.a,p.b,p.e);
          store.set(k,o.r);
          cov.set(k,covariance(o.r));
          if(o.n){ for(let d=0;d<3;d++) n[d]=Math.max(n[d],o.n[d]); sized++; }
        });
        doneNodes+=job.part.length;
        show(shareA*Math.min(1,doneNodes/estNodes));
      });
      if(id!==run2D) return null;
      const next=refineLattice(lat,covOf(lat),bins,LATTICE_MAX_NODES);
      if(!next) break;
      old=lat; lat=next;
    }
    const covOfFinal=covOf(lat);
    const res=newNodes(lat,null).map(p=>store.get(key(p.a,p.b,p.e))||null);
    const first=res.find(Boolean);
    if(!first) throw new Error('No point of the map is reachable.');
    const integ=gridMode
      ? {mode:'grid',n:sizeGrid('2D',sized ? n : DEFAULT_GRID)}
      : {mode:'mc',samples:mcSamples('2D')};
    R.broadcast({type:'setup',lattice:{a:lat.a,b:lat.b,e:lat.e,res,rough:roughCells(lat,covOfFinal)},UB:first.UB,UBinv:inverse(first.UB),integ,E});

    // Phase 2
    const I=new Float64Array(nA*Bv.length*nE).fill(NaN);
    const per=Math.max(1,Math.ceil(nPts/nE/(8*R.size)));
    const jobs=[];
    items.forEach((row,ib)=>{
      for(let k=0;k<row.length;k+=per){
        const part=row.slice(k,k+per);
        jobs.push({ib,part,msg:{type:'row',items:part.map(it=>({hkl:it.hkl,a:A[it.ia],b:Bv[ib]}))}});
      }
    });
    let donePts=0;
    await R.run(jobs,(m,job)=>{
      job.part.forEach((it,k)=>{
        const o=(job.ib*nA+it.ia)*nE;
        for(let ie=0;ie<nE;ie++) I[o+ie]=m.I[k*nE+ie];
      });
      donePts+=job.part.length*nE;
      show(shareA+(1-shareA)*donePts/nPts);
    });
    if(id!==run2D) return null;
    return I;
  }
  const nearest=(arr,v)=>{ let best=0; arr.forEach((x,i)=>{ if(Math.abs(x-v)<Math.abs(arr[best]-v)) best=i; }); return best; };
  function setupSliders(){
    const conf=[['U',volume.A,'convValueU'],['V',volume.B,'convValueV'],['E',volume.E,'convValueE']];
    for(const [key,arr,input] of conf){
      const s=$(`convSlider${key}`);
      s.min='0'; s.max=String(arr.length-1); s.step='1'; s.disabled=false;
      const want=num(input);
      const mid=key==='E' ? nearest(arr,(arr[0]+arr[arr.length-1])/2) : nearest(arr,(arr[0]+arr[arr.length-1])/2);
      s.value=String(Number.isFinite(want) && want>=Math.min(...arr)-1e-9 && want<=Math.max(...arr)+1e-9 ? nearest(arr,want) : mid);
      $(input).value=fmt(arr[Number(s.value)],3);
    }
    const sym=planeSymbols(volume.U,volume.V);
    $('convSliderULabel').textContent=sym.u;
    $('convSliderVLabel').textContent=sym.v;
    if($('convLineULabel')) $('convLineULabel').textContent=sym.u;
    if($('convLineVLabel')) $('convLineVLabel').textContent=sym.v;
    $('convSliderULabel').title=`U = ${vec(volume.U)}`;
    $('convSliderVLabel').title=`V = ${vec(volume.V)}`;
  }
  // Symbols for the plane coordinates: (H, K, L) = a U + b V.  a takes the
  // name of a component that only U changes, b of one that only V changes
  // (U = (1,0,0), V = (0,0,1): H and L, so (H, 0, 0.5) is the line at
  // b = 0.5).  Without such a component (U = (1,1,0), V = (1,-1,0)) the
  // symbols are ξ and η: (ξ+η, ξ−η, 0).
  function planeSymbols(U,V){
    const names=['H','K','L'], nz=x=>Math.abs(x)>1e-9;
    const iu=U.findIndex((x,i)=>nz(x) && !nz(V[i]));
    const iv=V.findIndex((x,i)=>nz(x) && !nz(U[i]));
    return {u:iu>=0 ? names[iu] : 'ξ', v:iv>=0 ? names[iv] : 'η'};
  }
  // One component as text: cu·u + cv·v + c0 (u, v symbols or numbers).
  function componentText(cu,su,cv,sv){
    const parts=[];
    let c0=0;
    const add=(c,symbol)=>{
      if(Math.abs(c)<1e-9) return;
      if(typeof symbol==='number'){ c0+=c*symbol; return; }
      const mag=Math.abs(c);
      parts.push({neg:c<0,text:`${Math.abs(mag-1)<1e-9 ? '' : fmt(mag)}${symbol}`});
    };
    add(cu,su); add(cv,sv);
    if(Math.abs(c0)>1e-9 || !parts.length) parts.push({neg:c0<0,text:fmt(Math.abs(c0))});
    return parts.map((t,i)=>`${t.neg ? '−' : (i ? '+' : '')}${t.text}`).join('');
  }
  const pointText=(U,V,su,sv)=>`(${[0,1,2].map(i=>componentText(U[i],su,V[i],sv)).join(', ')})`;
  function sliderIndex(key){ return Number($(`convSlider${key}`)?.value)||0; }
  // Fixed axis range of a map: the calculated grid; restored on double-click.
  function keepRange(id,x,y){
    const el=$(id); if(!el) return;
    el._convRange={x:[x[0],x[x.length-1]],y:[y[0],y[y.length-1]]};
    if(el._convRangeBound || typeof el.on!=='function') return;
    el._convRangeBound=true;
    el.on('plotly_relayout',ev=>{
      if(!ev || !(ev['xaxis.autorange'] || ev['yaxis.autorange']) || !el._convRange) return;
      Plotly.relayout(el,{'xaxis.range':el._convRange.x,'yaxis.range':el._convRange.y});
    });
  }
  function drawMaps(){
    if(!volume || !plotly()) return;
    const {A,B,E,I}=volume, nA=A.length, nE=E.length;
    const ia=sliderIndex('U'), ib=sliderIndex('V'), ie=sliderIndex('E');
    const at=(a,b,e)=>I[(b*nA+a)*nE+e];
    const zEU=E.map((_,e)=>A.map((_,a)=>at(a,ib,e)));
    const zEV=E.map((_,e)=>B.map((_,b)=>at(ia,b,e)));
    const zUV=B.map((_,b)=>A.map((_,a)=>at(a,b,ie)));
    const {U,V}=volume, sym=planeSymbols(U,V);
    const lineU=pointText(U,V,sym.u,B[ib]), lineV=pointText(U,V,A[ia],sym.v), planeUV=pointText(U,V,sym.u,sym.v);
    // Colour scale: one range for the three maps, from the whole calculated
    // volume (so it stays the same while the sliders move) unless set in the
    // Show row.
    const auto=volumeRange(I);
    const zmin=zlim.min ?? auto[0], zmax0=zlim.max ?? auto[1];
    const zmax=zmax0>zmin ? zmax0 : zmin+Math.max(1e-12,Math.abs(zmin)*1e-6);
    const heat=(key,x,y,z,xl,yl)=>{
      // Five labelled ticks including both ends (kept in saved images).
      const vals=Array.from({length:5},(_,i)=>zmin+(zmax-zmin)*i/4);
      return {type:'heatmap',x,y,z,colorscale:'Viridis',zauto:false,zmin,zmax,showscale:true,
        colorbar:{thickness:14,len:0.9,outlinewidth:0,tickfont:{size:16},tickmode:'array',tickvals:vals,
          ticktext:vals.map(v=>String(Number(v.toPrecision(3))))},
        hovertemplate:`${xl} = %{x:.4f}<br>${yl} = %{y:.3f}<br>I = %{z:.4g}<extra></extra>`};
    };
    // Slider positions as dashed lines, each switched by the box next to its slider.
    const all=$('convShowLine')?.checked!==false;
    const onU=all && $('convLineU')?.checked!==false, onV=all && $('convLineV')?.checked!==false, onE=all && $('convLineE')?.checked!==false;
    const dash=(x0,x1,y0,y1)=>({type:'line',x0,x1,y0,y1,line:{color:'rgba(255,255,255,0.8)',width:1,dash:'dash'}});
    // Bare dispersion E_b(h, k, l) of every branch, whatever its intensity
    // (only outside the table there is nothing to draw).
    const overlay=(xs,points)=>{
      if(!$('convShowDispersion')?.checked || !interp) return [];
      // evaluate() reuses its output buffers: copy every result.
      const vals=points.map(p=>{ const v=interp.evaluate(...p); return v ? Array.from(v.E) : null; });
      const traces=[];
      for(let b=0;b<interp.nBranch;b++){
        traces.push({type:'scatter',mode:'lines',x:xs,
          y:vals.map(v=>v && Number.isFinite(v[b]) ? v[b] : null),
          line:{color:'rgba(255,255,255,0.7)',width:1,dash:'dot'},hoverinfo:'skip',showlegend:false,connectgaps:false});
      }
      return traces;
    };
    // Constant-energy map: the contour E_b(a, b) = ħω of every branch.  The
    // dispersion on a fine (a, b) grid does not depend on ħω, so it is kept
    // for the volume and only the contour level follows the slider.
    const overlayUV=Ec=>{
      if(!$('convShowDispersion')?.checked || !interp) return [];
      const key=`${A[0]},${A[nA-1]},${B[0]},${B[B.length-1]},${interp.nBranch}`;
      if(!volume._dispUV || volume._dispUV.key!==key || volume._dispUV.interp!==interp){
        const n=121, aG=Array.from({length:n},(_,i)=>A[0]+(A[nA-1]-A[0])*i/(n-1)), bG=Array.from({length:n},(_,i)=>B[0]+(B[B.length-1]-B[0])*i/(n-1));
        const z=Array.from({length:interp.nBranch},()=>bG.map(()=>new Array(n).fill(null)));
        bG.forEach((b,j)=>aG.forEach((a,i)=>{
          const v=interp.evaluate(...volume.plane.hkl(a,b));
          if(v) for(let br=0;br<interp.nBranch;br++) if(Number.isFinite(v.E[br])) z[br][j][i]=v.E[br];
        }));
        volume._dispUV={key,interp,aG,bG,z};
      }
      const {aG,bG,z}=volume._dispUV;
      return z.map(zb=>({type:'contour',x:aG,y:bG,z:zb,showscale:false,hoverinfo:'skip',connectgaps:false,
        contours:{start:Ec,end:Ec,size:1,coloring:'none',showlabels:false},
        line:{color:'rgba(255,255,255,0.7)',width:1,dash:'dot',smoothing:0}}));
    };
    const fine=(arr)=>Array.from({length:201},(_,i)=>arr[0]+(arr[arr.length-1]-arr[0])*i/200);
    const aF=fine(A), bF=fine(B);
    const layout=(title,xl,yl,x,y)=>({font:FONT,title:{text:title,font:TITLE_FONT},margin:{l:84,r:24,t:50,b:70},
      xaxis:{title:{text:xl,font:AXIS_TITLE_FONT},range:[x[0],x[x.length-1]]},yaxis:{title:{text:yl,font:AXIS_TITLE_FONT},range:[y[0],y[y.length-1]]},showlegend:false});
    // Double-click: back to the calculated min–max range (Plotly would
    // otherwise autorange to the heatmap cell edges and the overlays).
    const cfg={responsive:true,displaylogo:false,doubleClick:'autosize'};
    const ell=$('convShowEllipse')?.checked ? ellipseTraces(A,B,E,ia,ib,ie) : {EU:[],EV:[],UV:[]};
    Plotly.react('convMapEU',[heat('EU',A,E,zEU,sym.u,'ħω'),...overlay(aF,aF.map(a=>volume.plane.hkl(a,B[ib]))),...ell.EU],
      {...layout(`ħω–${sym.u} at ${sym.v} = ${fmt(B[ib],3)}`,lineU,'ħω (meV)',A,E),
       shapes:[onE&&dash(A[0],A[nA-1],E[ie],E[ie]),onU&&dash(A[ia],A[ia],E[0],E[nE-1])].filter(Boolean)},cfg);
    Plotly.react('convMapEV',[heat('EV',B,E,zEV,sym.v,'ħω'),...overlay(bF,bF.map(b=>volume.plane.hkl(A[ia],b))),...ell.EV],
      {...layout(`ħω–${sym.v} at ${sym.u} = ${fmt(A[ia],3)}`,lineV,'ħω (meV)',B,E),
       shapes:[onE&&dash(B[0],B[B.length-1],E[ie],E[ie]),onV&&dash(B[ib],B[ib],E[0],E[nE-1])].filter(Boolean)},cfg);
    Plotly.react('convMapUV',[heat('UV',A,B,zUV,sym.u,sym.v),...overlayUV(E[ie]),...ell.UV],
      {...layout(`${planeUV} at ħω = ${fmt(E[ie],3)} meV`,`${sym.u} (r.l.u.)`,`${sym.v} (r.l.u.)`,A,B),
       shapes:[onU&&dash(A[ia],A[ia],B[0],B[B.length-1]),onV&&dash(A[0],A[nA-1],B[ib],B[ib])].filter(Boolean)},cfg);
    for(const [id,x,y] of [['convMapEU',A,E],['convMapEV',B,E],['convMapUV',A,B]]) keepRange(id,x,y);
    // Entries: the range in use (automatic: the whole calculation); a value
    // typed in fixes that end, clearing the box returns to automatic.
    for(const [end,v] of [['min',zmin],['max',zmax]]){
      const el=$(`convZ${end}`); if(!el) continue;
      el.placeholder='auto';
      if(document.activeElement!==el) el.value=String(Number(v.toPrecision(4)));
    }
  }
  function volumeRange(I){
    let lo=Infinity, hi=-Infinity;
    for(const v of I) if(Number.isFinite(v)){ if(v<lo) lo=v; if(v>hi) hi=v; }
    return Number.isFinite(lo) ? [lo,hi] : [0,1];
  }

  // FWHM resolution ellipses (projection onto the plotted plane) on a coarse
  // grid of each map: round steps (0.05 / 0.1 / 0.2 … r.l.u., 0.5 / 1 / 2 …
  // meV) chosen from the plotted range.
  const niceStep=(span,target,steps)=>steps.find(st=>span/st<=target)||steps[steps.length-1];
  const Q_STEPS=[0.01,0.02,0.025,0.05,0.1,0.2,0.25,0.5,1,2,5];
  const E_STEPS=[0.1,0.2,0.25,0.5,1,2,2.5,5,10,20,50];
  const gridIn=(lo,hi,st)=>{ const out=[]; for(let v=Math.ceil((lo+st*0.25)/st)*st; v<=hi-st*0.25+1e-9; v+=st) out.push(Number(v.toFixed(10))); return out; };
  const ellCache=new Map();
  function ellipseCov(base,a,b,E){
    // Covariance of (a, b, ħω) from the resolution matrix at (a U + b V, E).
    const key=`${a},${b},${E}`;
    if(ellCache.has(key)) return ellCache.get(key);
    const {U,V}=volume, hkl=U.map((x,i)=>a*x+b*V[i]);
    const res=resolutionAt(base,hkl,E,{});
    let out=null;
    if(res){
      const UB=res.UB, TP=2*Math.PI;
      const q=h=>matvec(UB,h).map(x=>TP*x);
      const q0=q(hkl), n0=Math.hypot(q0[0],q0[1]);
      if(n0>1e-12){
        const eX=[q0[0]/n0,q0[1]/n0,0], eY=[-eX[1],eX[0],0];
        const qU=q(U), qV=q(V), dot=(x,y)=>x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
        const M=[[dot(eX,qU),dot(eX,qV)],[dot(eY,qU),dot(eY,qV)]], det=M[0][0]*M[1][1]-M[0][1]*M[1][0];
        if(Math.abs(det)>1e-12){
          const Mi=[[M[1][1]/det,-M[0][1]/det],[-M[1][0]/det,M[0][0]/det]];
          const C=inverse(res.RM);   // local (Q∥, Q⊥, E, Qz)
          // Incoherent (projection): covariance of (a, b, ħω), Qz integrated.
          const K=[[Mi[0][0],Mi[0][1],0,0],[Mi[1][0],Mi[1][1],0,0],[0,0,1,0]];
          const inc=K.map(r=>K.map(c=>r.reduce((s,ri,i)=>s+ri*c.reduce((t,cj,j)=>t+C[i][j]*cj,0),0)));
          // Coherent (section): resolution matrix in (a, b, ħω, Qz),
          // P = Tᵀ RM T with (Q∥, Q⊥, E, Qz) = T (a, b, ħω, Qz).
          const T=[[M[0][0],M[0][1],0,0],[M[1][0],M[1][1],0,0],[0,0,1,0],[0,0,0,1]], R=res.RM;
          const coh=[0,1,2,3].map(i=>[0,1,2,3].map(j=>{ let v=0; for(let p=0;p<4;p++) for(let q=0;q<4;q++) v+=T[p][i]*R[p][q]*T[q][j]; return v; }));
          out={inc,coh};
        }
      }
    }
    if(out) ellCache.set(key,out);   // unreachable points are tried again later
    return out;
  }
  function ellipsePath(cx,cy,S){
    const [a,b,c]=[S[0][0],S[0][1],S[1][1]];
    if(!(a>0 && c>0)) return null;
    const l11=Math.sqrt(a), l21=b/l11, l22=Math.sqrt(Math.max(c-l21*l21,0));
    const r=Math.sqrt(2*Math.LN2), x=[], y=[];
    for(let i=0;i<=48;i++){ const t=2*Math.PI*i/48, u=r*Math.cos(t), v=r*Math.sin(t); x.push(cx+l11*u); y.push(cy+l21*u+l22*v); }
    x.push(null); y.push(null);
    return [x,y];
  }
  function ellipseTraces(A,B,E,ia,ib,ie){
    let base; try{ base=collectResolutionBase(); }catch(_e){ return {EU:[],EV:[],UV:[]}; }
    const sig=JSON.stringify([base.config,base.approximation,base.col,base.mos,base.lc?.a,base.lc?.b,base.lc?.c,volume.U,volume.V]);
    if(ellCache.sig!==sig){ ellCache.clear(); ellCache.sig=sig; }
    const span=arr=>arr[arr.length-1]-arr[0];
    const sa=niceStep(span(A),6,Q_STEPS), sb=niceStep(span(B),6,Q_STEPS), se=niceStep(span(E),7,E_STEPS);
    const ga=gridIn(A[0],A[A.length-1],sa), gb=gridIn(B[0],B[B.length-1],sb), ge=gridIn(E[0],E[E.length-1],se);
    const coh=!!$('convEllCoh')?.checked, inc=!!$('convEllInc')?.checked;
    const collect=(pairs,i,j)=>{
      const out=[];
      for(const [kind,on] of [['inc',inc],['coh',coh]]){
        if(!on) continue;
        const X=[], Y=[];
        for(const [a,b,e,cx,cy] of pairs){
          const C=ellipseCov(base,a,b,e); if(!C) continue;
          let S;
          if(kind==='inc') S=[[C.inc[i][i],C.inc[i][j]],[C.inc[j][i],C.inc[j][j]]];
          else{
            // Section: the 2 × 2 block of the resolution matrix, inverted.
            const P=C.coh, d=P[i][i]*P[j][j]-P[i][j]*P[j][i];
            if(!(d>0)) continue;
            S=[[P[j][j]/d,-P[i][j]/d],[-P[j][i]/d,P[i][i]/d]];
          }
          const p=ellipsePath(cx,cy,S); if(!p) continue;
          X.push(...p[0]); Y.push(...p[1]);
        }
        if(X.length) out.push({type:'scatter',mode:'lines',x:X,y:Y,line:{color:'rgba(255,255,255,0.85)',width:1},hoverinfo:'skip',showlegend:false});
      }
      return out;
    };
    return {
      EU:collect(ga.flatMap(a=>ge.map(e=>[a,B[ib],e,a,e])),0,2),
      EV:collect(gb.flatMap(b=>ge.map(e=>[A[ia],b,e,b,e])),1,2),
      UV:collect(ga.flatMap(a=>gb.map(b=>[a,b,E[ie],a,b])),0,1),
    };
  }

  // --------------------------------------------------------- time estimate --
  // Time = points × MC samples × (time per sample) + resolution matrices ×
  // (time per matrix).  The two unit times are measured once on this
  // computer with the loaded table and the current approximation.
  let bench=null;
  // Median time of k runs (single runs of a few ms are noisy: JIT, GC).
  const medianTime=(fn,k)=>{
    const t=[];
    for(let i=0;i<k;i++){ const t0=performance.now(); fn(); t.push(performance.now()-t0); }
    return t.sort((a,b)=>a-b)[Math.floor(k/2)];
  };
  function measureBench(){
    const base=collectResolutionBase();
    const key=`${fileName}|${data?.nBranch}|${base.approximation?.method}`;
    if(bench && bench.key===key) return bench;
    // A reachable table point: the centre first, then others (a table
    // centred on Q = 0 cannot be reached there).
    const at=(f)=>interp.axes.map((a,i)=>a[Math.round(f[i]*(a.length-1))]);
    const fr=[[0.5,0.5,0.5],[0.75,0.5,0.75],[1,0.5,1],[0.75,0.5,0.5],[0.5,0.5,0.75],[1,0.5,0.5],[0.5,0.5,1],[0.25,0.5,0.25],[0,0.5,0]];
    const Es=[data.eMin,(data.eMin+data.eMax)/2,data.eMax,1,5,10];
    let res=null, tRes=0, c=null;
    for(const f of fr){
      c=at(f);
      for(const E of Es){
        if(!resolutionAt(base,c,E,{})) continue;
        const t0=performance.now(); let r=null;
        for(let i=0;i<3;i++) r=resolutionAt(base,c,E,{});
        tRes=(performance.now()-t0)/3; res=r; break;
      }
      if(res) break;
    }
    if(!res) return null;
    const S=standardNormalSamples(4000);
    convolvePoint(c,res.energies ? (res.energies.Ei-res.energies.Ef) : 0,res,interp,S,{model:'given',skip:false});
    const tMC=medianTime(()=>convolvePoint(c,res.energies.Ei-res.energies.Ef,res,interp,S,{model:'given',skip:false}),5);
    // The test point has every sample inside the table; a real map or scan
    // has many outside it (cheaper), so the measured value is scaled down
    // (calibrated against full runs: estimates within about ±30 %).
    const tSample=0.75*tMC/4000;
    // Grid: time per node (two passes, a little more than an MC sample).
    const G=gaussianGrid([11,11,11]), Ec=res.energies.Ei-res.energies.Ef;
    convolvePointGrid(c,Ec,res,interp,G,{model:'given',skip:false});
    const tNode=0.75*medianTime(()=>convolvePointGrid(c,Ec,res,interp,G,{model:'given',skip:false}),9)/G.weights.length;
    bench={key,tRes,tSample,tNode};
    return bench;
  }
  const timeText=sec=>{
    if(!Number.isFinite(sec)) return '';
    if(sec<1) return 'Estimated time: < 1 s';
    if(sec<90) return `Estimated time: ~${Math.max(1,Math.round(sec))} s`;
    if(sec<5400) return `Estimated time: ~${(sec/60).toFixed(sec<600 ? 1 : 0)} min`;
    return `Estimated time: ~${(sec/3600).toFixed(1)} h`;
  };
  function updateEstimates(){
    for(const [id,fn] of [['convEstimate2D',estimate2D],['convEstimate1D',estimate1D]]){
      const el=$(id); if(!el) continue;
      let r={t:NaN};
      try{ if(interp) r=fn(); }catch(_e){ r={t:NaN}; }
      el.textContent=timeText(r.t);
    }
  }
  // Fraction of the given points that need the full grid (not skipped as
  // far from the dispersion), and the time of the check per point (ms).
  function nearFraction(base,pts){
    let near=0, k=0, dt=0;
    for(const p of pts){
      const res=resolutionAt(base,p.hkl,p.E,{});
      if(!res) continue;
      const t0=performance.now();
      k++; if(nearDispersion(p.hkl,p.E,res,interp)) near++;
      dt+=performance.now()-t0;
    }
    return {frac:k ? near/k : 1, tCheck:k ? dt/k : 0};
  }
  // Grid: the size is estimated from a few resolution points (3 × 3 × 3 in
  // the 2D range, 5 along the scan); the real run takes all of them.
  function estimate2D(){
    const b=measureBench(); if(!b) return {t:NaN};
    const g=prepare2D();
    let per, n=null;
    // Points far from the dispersion are skipped after a quick check (Grid
    // and Monte Carlo): the full cost applies to the fraction near it
    // (sampled on a coarse subset of the map).
    const sub=(arr,k)=>arr.length<=k ? arr : Array.from({length:k},(_,i)=>arr[Math.round(i*(arr.length-1)/(k-1))]);
    const near=()=>{
      const sample=[];
      for(const a of sub(g.A,5)) for(const bb of sub(g.Bv,5)){
        const hkl=g.plane.hkl(a,bb);
        if(insideBox(hkl,g.rg)) for(const e of sub(g.E,9)) sample.push({hkl,E:e});
      }
      return nearFraction(g.base,sample);
    };
    if(integrationMode('2D')==='mc'){
      const {frac,tCheck}=near();
      per=tCheck+frac*mcSamples('2D')*b.tSample;
    }
    else{
      const pick=arr=>[arr[0],arr[Math.floor(arr.length/2)],arr[arr.length-1]];
      const pts=[];
      for(const a of pick(g.A)) for(const bb of pick(g.Bv)) for(const e of pick(g.E)){
        const hkl=g.plane.hkl(a,bb);
        if(insideBox(hkl,g.rg)) pts.push({hkl,E:e,res:resolutionAt(g.base,hkl,e,{})});
      }
      n=gridSizeFor('2D',pts);
      const {frac,tCheck}=near();
      per=tCheck+0.8*frac*n[0]*n[1]*n[2]*b.tNode;
    }
    // Shared between the cores (measured: 1.75 × on 2 cores).
    const k=workersAvailable() ? workerCount() : 1, speedup=1+0.75*(k-1);
    return {t:(g.nInside*g.E.length*per+g.nRes*b.tRes)/1000/speedup,n};
  }
  function estimate1D(){
    const b=measureBench(); if(!b) return {t:NaN};
    const sc=scanPoints();
    let per, n=null;
    const base=collectResolutionBase(), m=sc.pts.length-1;
    const near=()=>nearFraction(base,[0,0.125,0.25,0.375,0.5,0.625,0.75,0.875,1].map(t=>sc.pts[Math.round(t*m)]));
    if(integrationMode('1D')==='mc'){
      const {frac,tCheck}=near();
      per=tCheck+frac*mcSamples('1D')*b.tSample;
    }
    else{
      const pts=[0,0.25,0.5,0.75,1].map(t=>sc.pts[Math.round(t*m)]).map(p=>({...p,res:resolutionAt(base,p.hkl,p.E,{})}));
      n=gridSizeFor('1D',pts);
      const {frac,tCheck}=near();
      per=tCheck+frac*n[0]*n[1]*n[2]*b.tNode;
    }
    return {t:sc.pts.length*(per+b.tRes)/1000,n};
  }
  let estimateTimer=0;
  const scheduleEstimates=()=>{ clearTimeout(estimateTimer); estimateTimer=setTimeout(updateEstimates,250); };

  // --------------------------------------------------------------- 1D -----
  const parseNum=v=>parseNumericValue ? parseNumericValue(v) : Number(v);
  // Scan from initial to final (H, K, L, ħω) in Points equal steps, as the
  // Simulation scan.  A variable with equal initial and final values is fixed.
  const SCAN_IDS=[['convH0','convH1'],['convK0','convK1'],['convL0','convL1'],['convE0','convE1']];
  function scanPoints(){
    const names=['H','K','L','ħω'];
    const ends=SCAN_IDS.map(([i0,i1],j)=>{
      const v0=parseNum($(i0)?.value), v1=parseNum($(i1)?.value);
      if(!Number.isFinite(v0) || !Number.isFinite(v1)) throw new Error(`${names[j]}: enter the initial and final values.`);
      return [v0,v1];
    });
    const n=Math.round(num('convPoints1D'));
    if(!(n>=2 && n<=2001)) throw new Error('Points must be between 2 and 2001.');
    const moving=ends.map(([a,b],j)=>Math.abs(b-a)>1e-12 ? j : -1).filter(j=>j>=0);
    if(!moving.length) throw new Error('Initial and final points are the same.');
    const pts=Array.from({length:n},(_,k)=>{
      const t=k/(n-1), v=ends.map(([a,b])=>a+(b-a)*t);
      return {hkl:v.slice(0,3),E:v[3]};
    });
    // Horizontal axis: ħω for an energy scan, otherwise the Q component that changes most.
    const qMoving=moving.filter(j=>j<3);
    const axis=qMoving.length ? qMoving.reduce((best,j)=>Math.abs(ends[j][1]-ends[j][0])>Math.abs(ends[best][1]-ends[best][0])?j:best,qMoving[0]) : 3;
    const text=j=>moving.includes(j) ? `${fmt(ends[j][0])} ~ ${fmt(ends[j][1])}` : fmt(ends[j][0]);
    const label=`${names.map((nm,j)=>`${nm} = ${text(j)}`).join(', ')} (${n} points)`;
    const inputs=names.map((_,j)=>text(j).replace(/ ~ /,'~'));
    return {axis,label,pts,inputs};
  }
  let busy1D=false, stopReq1D=false;
  async function calculate1D(){
    if(busy1D){ stopReq1D=true; return; }
    const id=++run1D;
    stopReq1D=false;
    try{
      if(!interp) throw new Error('Load a dispersion file first.');
      const base=collectResolutionBase(), sc=scanPoints(), settings=settingsSnapshot('1D');
      // Q points outside the table: say so plainly instead of a blank plot.
      const off=sc.pts.filter(p=>!inTable(p.hkl));
      if(off.length===sc.pts.length) throw new Error(`${off.length===1 || sc.axis===3 ? vec(off[0].hkl) : 'The scan'} is outside the table (${tableRangeText()}).`);
      message('convMessage1D','');
      busy1D=true; setRunning('convCalculate1D',true); setProgress('convStatus1D',0);
      const cache={}, stats={unreachable:0,outside:0}, I=[];
      // Resolution at every point first (the grid size is taken from all of them).
      const RES=[];
      let t1=performance.now();
      for(const p of sc.pts){
        RES.push(resolutionAt(base,p.hkl,p.E,cache));
        if(performance.now()-t1>150){ t1=performance.now(); await yieldUI(); if(id!==run1D) return; }
      }
      const integ=integrationFor('1D',sc.pts.map((p,i)=>({...p,res:RES[i]})));
      // Radial 3rd collimator: its equivalent divergence (from the analyzer
      // angle, the same for every point with Ef fixed) for the legend.
      const r0=RES.find(Boolean);
      if(r0?.collimation3?.radial && Number.isFinite(r0.collimation3.fwhmArcmin)) settings.derived={radial3Arcmin:r0.collimation3.fwhmArcmin};
      let t0=performance.now(), stopped=false;
      for(let i=0;i<sc.pts.length;i++){
        I.push(intensityAt(base,sc.pts[i].hkl,sc.pts[i].E,integ,cache,stats,RES[i]));
        if(performance.now()-t0>150){
          t0=performance.now(); setProgress('convStatus1D',i/sc.pts.length);
          await yieldUI(); if(id!==run1D) return;
          if(stopReq1D){ stopped=true; break; }
        }
      }
      busy1D=false; setRunning('convCalculate1D',false);
      // Stop: the points calculated so far become the current scan.
      if(stopped){
        if(!I.length){ statusEnd('convStatus1D','Stopped',true); return; }
        const total=sc.pts.length;
        sc.pts=sc.pts.slice(0,I.length);
        sc.label+=` (stopped at ${I.length} of ${total} points)`;
      }
      scan={...sc,I,method:$('method')?.value||'',settings};
      showConvTab('1d');
      refreshKept();
      const notes=[];
      // Short notes (one line together); the plot shows where.
      if(off.length) notes.push(`${off.length}/${sc.pts.length} points outside the table.`);
      if(stats.unreachable) notes.push(`${stats.unreachable} points unreachable.`);
      if(stats.outside>0.05) notes.push(`Table smaller than the resolution (up to ${Math.round(stats.outside*100)} % outside).`);
      message('convMessage1D',notes.join(' '),stats.outside>0.05 || off.length>0);
      if(stopped) statusEnd('convStatus1D',`Stopped (${I.length} points)`,true);
      else{ message('convStatus1D','Completed'); setFill('convStatus1D',1); $('convStatus1D')?.classList.add('convolution-progress-on'); }
    }catch(err){ if(id===run1D){ busy1D=false; setRunning('convCalculate1D',false); message('convStatus1D',''); message('convMessage1D',err.message||String(err),true); } }
  }
  const AXIS_NAMES=['H (r.l.u.)','K (r.l.u.)','L (r.l.u.)','ħω (meV)'];
  const PALETTE=['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#8c564b','#e377c2','#17becf','#7f7f7f','#bcbd22'];
  // Normalize (check box under the 1D plot): every curve divided by its own
  // maximum, for comparing shapes and positions (Save CSV keeps the values).
  const normalized=()=>!!$('convNormalize1D')?.checked;
  const curveMax=I=>I.reduce((m,v)=>Number.isFinite(v) && v>m ? v : m,0);
  // Highlight (click a row of the curve table): that curve thick on top, the
  // others thin and faint; click it again to show all equally.
  let highlighted=null;
  function scanTrace(sc,name,color,current){
    const x=sc.pts.map(p=>sc.axis===3 ? p.E : p.hkl[sc.axis]);
    const top=normalized() ? curveMax(sc.I) : 0;
    const y=top>0 ? sc.I.map(v=>v/top) : sc.I;
    const custom=sc.pts.map(p=>`(${p.hkl.map(v=>fmt(v)).join(', ')}), ${fmt(p.E,3)} meV`);
    // Solid, fairly thick lines so the colours read well in the legend.
    const on=highlighted===sc, dim=highlighted && !on;
    return {type:'scatter',mode:'lines+markers',name,x,y,customdata:custom,opacity:dim ? 0.3 : 1,
      marker:{size:on ? 7 : dim ? 4 : current?6:5,color},line:{width:on ? 3.4 : dim ? 1.2 : current?2.6:2.2,color},
      hovertemplate:`%{customdata}<br>I = %{y:.4g}<extra></extra>`};
  }
  // Curves of the 1D plot: the kept scans (numbered, coloured) and the
  // current one (all of them go into Save CSV).
  const curveList=()=>[...kept.map((k,i)=>({k,tag:String(i+1),title:`#${i+1}`,color:k.color,current:false})),
    ...(scan ? [{k:scan,tag:'current',title:'Current',color:scan.color||'#111',current:true}] : [])];
  // Legend (convolution-legend.js): the columns shown are chosen in the Show
  // row above the plot and kept in the browser.
  const legendShown=loadLegendColumns();
  const shownCols=()=>LEGEND_COLS.filter(c=>legendShown.has(c.id));
  const optionOf=(id,v)=>[...($(id)?.options||[])].find(o=>o.value===String(v));
  const LEGEND_LOOKUP={
    instrumentName:v=>optionOf('instrument',v)?.textContent?.trim(),
    // The type labels come from the instrument file: only for the selected one.
    instrumentTypeName:(v,t)=>$('instrument')?.value===v ? optionOf('instrumentType',t)?.textContent : '',
    optionText:(id,v)=>optionOf(id,v)?.textContent};
  const legendFields=k=>legendValues(k,LEGEND_LOOKUP);
  const legendText=k=>legendLine(legendFields(k),shownCols());
  // Traces and layout of the 1D plot.  On screen the curve list next to the
  // plot is the legend; Save figure adds it under the plot.
  function scanFigure(){
    const curves=curveList();
    // The highlighted curve is drawn last (on top).
    const order=[...curves].sort((a,b)=>(a.k===highlighted)-(b.k===highlighted));
    const traces=order.map(c=>({...scanTrace(c.k,legendText(c.k),c.color,c.current),legendgroup:c.tag,name:legendText(c.k)}));
    // Horizontal axis title: every scanned variable shown (kept scans may differ).
    const axes=[...new Set(curves.map(c=>c.k.axis))];
    const frame={showline:true,ticks:'outside',linecolor:'#444',linewidth:1,zeroline:false,automargin:true};
    const layout={font:FONT,margin:{l:96,r:20,t:44,b:76},showlegend:false,
      xaxis:{...frame,mirror:true,title:{text:axes.map(i=>AXIS_NAMES[i]).join(' / '),font:AXIS_TITLE_FONT}},
      yaxis:{...frame,mirror:true,title:{text:normalized() ? 'I (normalized)' : 'I (arb.)',font:AXIS_TITLE_FONT},rangemode:'tozero'}};
    return {curves,traces,layout};
  }
  function drawScan(){
    if(!plotly()) return;
    const {curves,traces,layout}=scanFigure();
    if(!curves.length){ try{ Plotly.purge('convScanPlot'); }catch(_e){} return; }
    Plotly.react('convScanPlot',traces,layout,{responsive:true,displaylogo:false});
  }
  // Save figure: the plot as on screen (current zoom) with the legend table
  // (a head row and one row per curve, the columns shown on screen) under it.  The legend is drawn with shapes and
  // annotations in paper coordinates: a Plotly legend outside the plot would
  // push the margins and break the axes when the entries are long.
  async function saveScanFigure(){
    if(!plotly()) return;
    const {curves,traces,layout}=scanFigure();
    if(!curves.length) return;
    const el=$('convScanPlot');
    const fs=FONT?.size||14, line=Math.round(fs*1.5);
    // Columns sized from the text (canvas measure in Plotly's font); a
    // column empty for every curve is left out.
    const rows=curves.map(c=>legendFields(c.k));
    const cols=shownCols().filter(c=>rows.some(r=>r[c.id]));
    const ctx=document.createElement('canvas').getContext('2d');
    const family='"Open Sans", verdana, arial, sans-serif';
    const tw=(t,bold)=>{ ctx.font=`${bold ? 'bold ' : ''}${fs}px ${family}`; return ctx.measureText(t).width; };
    const gap=Math.round(fs*1.1), swatch=34+10;
    const colW=cols.map(c=>Math.ceil(Math.max(tw(c.head,true),...rows.map(r=>tw(r[c.id]||'',false)))));
    const textW=swatch+colW.reduce((a,b)=>a+b,0)+gap*Math.max(0,cols.length-1)+12;
    const w=Math.round(Math.max(640,el?.clientWidth||800,textW+12+layout.margin.r)), h=Math.max(420,Math.round(el?.clientHeight||480));
    const nLines=curves.length+1, extra=nLines*line+16, b=layout.margin.b+extra, H=h+extra;
    const plotW=w-layout.margin.l-layout.margin.r, plotH=H-layout.margin.t-b;
    const keep=k=>el?.layout?.[k]?.range ? {range:[...el.layout[k].range],autorange:false} : {};
    const shapes=[], annotations=[];
    const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const left=-(layout.margin.l-12);   // px from the plot's left edge
    const yAt=i=>-(layout.margin.b+8+(i+0.5)*line)/plotH;
    const colX=[]; { let x=left+swatch; for(const wj of colW){ colX.push(x); x+=wj+gap; } }
    cols.forEach((c,ci)=>annotations.push({xref:'paper',yref:'paper',x:colX[ci]/plotW,y:yAt(0),xanchor:'left',yanchor:'middle',showarrow:false,text:`<b>${esc(c.head)}</b>`,font:FONT,align:'left'}));
    curves.forEach((c,i)=>{
      const y=yAt(i+1), x0=left/plotW, x1=(left+34)/plotW;
      shapes.push({type:'line',xref:'paper',yref:'paper',x0,x1,y0:y,y1:y,line:{color:c.color,width:c.current ? 2.6 : 2.2}});
      cols.forEach((col,ci)=>{ const t=rows[i][col.id]; if(t) annotations.push({xref:'paper',yref:'paper',x:colX[ci]/plotW,y,xanchor:'left',yanchor:'middle',showarrow:false,text:esc(t),font:FONT,align:'left'}); });
    });
    const fig={...layout,width:w,height:H,margin:{...layout.margin,b},showlegend:false,shapes,annotations,
      xaxis:{...layout.xaxis,...keep('xaxis'),automargin:false},yaxis:{...layout.yaxis,...keep('yaxis'),automargin:false}};
    const tmp=document.createElement('div');
    tmp.style.cssText=`position:fixed;left:-10000px;top:0;width:${w}px;height:${H}px`;
    document.body.appendChild(tmp);
    try{
      await Plotly.newPlot(tmp,traces,fig,{staticPlot:true});
      // A fixed name, as structure-figure.png in the CIF generator.  Size
      // from the figure's own layout (the page's density scaling applies to it).
      await Plotly.downloadImage(tmp,{format:'png',filename:'1d-cut-figure',scale:2});
    }finally{ try{ Plotly.purge(tmp); }catch(_e){} tmp.remove(); }
  }


  function updateKeepButtons(){
    $('convClearKept1D').disabled=!kept.length;
    updateNamePlaceholders();
    $('convDownload').disabled=!curveList().length;
    if($('convSaveFigure1D')) $('convSaveFigure1D').disabled=!curveList().length;
  }
  function keepScan(){
    if(!scan) return;
    // The colour chosen for the current curve, else the first palette colour
    // not in use (a colour stays with its curve when others are removed).
    kept.push({...scan,method:scan.method||$('method')?.value||'',color:scan.color||nextColor()});
    scan=null;
    refreshKept();
  }
  // #rgb / rgb() / names -> #rrggbb for <input type=color>.
  function hexColor(c){
    const ctx=document.createElement('canvas').getContext('2d'); ctx.fillStyle='#000'; ctx.fillStyle=String(c||'#000');
    const v=ctx.fillStyle; return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
  }
  // Head of the legend columns, and their chooser (in the Show row above the plot).
  function legendHead(){
    const tr=$('convCurveList')?.closest('table')?.querySelector('thead tr');
    if(tr){
      tr.querySelectorAll('th.convolution-legend-head').forEach(th=>th.remove());
      for(const c of shownCols()){ const th=document.createElement('th'); th.className='convolution-legend-head'; th.textContent=c.head; tr.appendChild(th); }
    }
    const box=$('convLegendColumns');
    if(box && !box.childElementCount){
      const t=document.createElement('span'); t.className='convolution-show-title'; t.textContent='Legend:'; box.appendChild(t);
      for(const c of LEGEND_COLS){
        const lab=document.createElement('label'); lab.className='checkbox-label';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=legendShown.has(c.id);
        cb.addEventListener('change',()=>{
          if(cb.checked) legendShown.add(c.id); else legendShown.delete(c.id);
          saveLegendColumns(legendShown);
          refreshKept();
        });
        lab.append(cb,document.createTextNode(c.head));
        box.appendChild(lab);
      }
    }
  }
  // The side panel doubles as the legend and the keep list.
  function refreshKept(){
    const curves=curveList();
    legendHead();
    const body=$('convCurveList');
    if(body){
      body.replaceChildren(...curves.map(c=>{
        const tr=document.createElement('tr');
        tr.className=[c.current ? 'convolution-curve-current' : '',c.k===highlighted ? 'selected' : ''].filter(Boolean).join(' ');
        tr.addEventListener('click',event=>{
          if(event.target.closest('button,input')) return;   // buttons and the colour picker
          highlighted=highlighted===c.k ? null : c.k; refreshKept();
        });
        const td=()=>{ const cell=document.createElement('td'); tr.appendChild(cell); return cell; };
        // Columns: Keep / Remove (under Clear all), colour, then the legend
        // (the first two stay in view when the table scrolls).
        // Keep for the current scan, Remove for kept ones.
        const act=td();
        const btn=document.createElement('button'); btn.type='button';
        if(c.current){ btn.textContent='+ Keep'; btn.addEventListener('click',keepScan); }
        else{ btn.textContent='Remove'; btn.addEventListener('click',()=>{ if(highlighted===c.k) highlighted=null; kept.splice(Number(c.tag)-1,1); refreshKept(); }); }
        act.appendChild(btn);
        // Colour: a square colour picker (as in the CIF generator).
        const pick=document.createElement('input'); pick.type='color'; pick.value=hexColor(c.color);
        pick.className='convolution-color-pick';
        pick.setAttribute('aria-label','Curve colour');
        pick.addEventListener('input',()=>{ c.k.color=pick.value; drawScan(); });
        pick.addEventListener('change',()=>{ c.k.color=pick.value; refreshKept(); });
        td().appendChild(pick);
        // Legend columns (their heads: legendHead).
        const f=legendFields(c.k);
        for(const col of shownCols()){ const cell=td(); cell.className='convolution-curve-field'; cell.textContent=f[col.id]||''; }
        return tr;
      }));
    }
    $('convCurveEmpty').hidden=curves.length>0;
    if(highlighted && !curves.some(c=>c.k===highlighted)) highlighted=null;
    updateKeepButtons(); drawScan();
    if(!restoringResults) store1D();
  }
  // Save CSV file name: the entry next to Save CSV, or (empty) the dispersion file
  // name + _conv_1d / _conv_2d, shown there as the placeholder.
  const autoBase=(src,kind)=>{
    const base=String(src||'').replace(/\.[^.]*$/,'').replace(/[^\w.+-]+/g,'_').replace(/^_+|_+$/g,'');
    return `${base||'convolution'}_conv_${kind}`;
  };
  const nameInput=kind=>$(kind==='2d' ? 'convCsvName2D' : 'convCsvName1D');
  const csvName=(src,kind)=>{
    const typed=String(nameInput(kind)?.value||'').trim().replace(/\.csv$/i,'').replace(/[\\/:*?"<>|]+/g,'_');
    return `${typed||autoBase(src,kind)}.csv`;
  };
  function updateNamePlaceholders(){
    const n2=nameInput('2d'), n1=nameInput('1d');
    if(n2) n2.placeholder=autoBase(volume?.settings?.dispersion?.file||fileName,'2d');
    if(n1){ const c=curveList().find(c=>c.k.settings?.dispersion?.file); n1.placeholder=autoBase(c?.k.settings.dispersion.file||fileName,'1d'); }
  }
  // CSV: the current scan and every kept scan, one block per curve.
  function downloadScan(){
    // Curve tags are plain numbers (a leading # would read as a comment).
    const curves=curveList().map(c=>({...c.k,tag:c.tag,color:c.color}));
    if(!curves.length) return;
    const lines=['# PLANE-TAS convolution: 1D cut',`# dispersion file: ${fileName}`,'# intensity: S(Q,w) table x R0/Rmon (normalisation to monitor counts; monitor half way between monochromator and sample, taking the whole beam)',
      ...curves.map(c=>`# curve ${c.tag}: ${c.label} (${c.method})`),
      // Colour of each curve (put back by Load CSV).
      ...curves.map(c=>`# color curve ${c.tag}: ${hexColor(c.color)}`),
      ...curves.map(c=>settingsLine(c.settings,`settings curve ${c.tag}`)).filter(Boolean),
      'curve,H,K,L,hw_meV,I_arb,dI'];
    const num6=v=>Number.isFinite(v) ? String(Number(v.toFixed(6))) : '';
    for(const c of curves) c.pts.forEach((p,i)=>lines.push(`${c.tag},${p.hkl.map(num6).join(',')},${num6(p.E)},${Number.isFinite(c.I[i]) ? c.I[i].toPrecision(8) : ''},${c.err && Number.isFinite(c.err[i]) ? c.err[i].toPrecision(6) : ''}`));
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/csv'}));
    a.download=csvName(curves.find(c=>c.settings?.dispersion?.file)?.settings.dispersion.file||fileName,'1d');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // 2D volume: one row per (h, k, l, ħω) point inside the range, with the
  // index column when the selected Format has one.
  function downloadVolume(){
    if(!volume) return;
    const {A,B,E,I,plane}=volume, nA=A.length, nE=E.length;
    const idx=!!data?.offset;
    const lines=['# PLANE-TAS convolution: 2D slice',`# dispersion file: ${volume.settings?.dispersion?.file||fileName}`,'# intensity: S(Q,w) table x R0/Rmon (normalisation to monitor counts; monitor half way between monochromator and sample, taking the whole beam)',
      settingsLine(volume.settings),(idx ? 'index,' : '')+'H,K,L,hw_meV,I_arb'].filter(Boolean);
    let n=0;
    for(let b=0;b<B.length;b++) for(let a=0;a<nA;a++){
      const hkl=plane.hkl(A[a],B[b]).map(v=>Number(v.toFixed(6))).join(',');
      for(let e=0;e<nE;e++){
        const v=I[(b*nA+a)*nE+e];
        if(!Number.isFinite(v)) continue;
        lines.push(`${idx ? `${++n},` : ''}${hkl},${Number(E[e].toFixed(6))},${v.toPrecision(8)}`);
      }
    }
    const el=document.createElement('a');
    el.href=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/csv'}));
    el.download=csvName(volume.settings?.dispersion?.file||fileName,'2d');
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(()=>URL.revokeObjectURL(el.href),1000);
  }

  // ------------------------------------------------------------ CSV input --
  const splitRow=line=>line.trim().split(/[\s,;]+/).filter(Boolean);
  function nextColor(){ const used=new Set(kept.map(k=>k.color)); return PALETTE.find(c=>!used.has(c))||PALETTE[kept.length%PALETTE.length]; }
  // Which variable a scan runs along: the Q component that changes most,
  // otherwise ħω.
  function scanAxis(pts){
    const span=j=>{ const v=pts.map(p=>j===3 ? p.E : p.hkl[j]).filter(Number.isFinite); return v.length ? Math.max(...v)-Math.min(...v) : 0; };
    const q=[0,1,2].filter(j=>span(j)>1e-9);
    return q.length ? q.reduce((a,b)=>span(b)>span(a)?b:a,q[0]) : 3;
  }
  const varText=(pts,j)=>{ const v=pts.map(p=>j===3 ? p.E : p.hkl[j]); const a=v[0], b=v[v.length-1]; return Math.abs(b-a)>1e-9 ? `${fmt(a)}~${fmt(b)}` : fmt(a); };
  // 1D: only a CSV written by Save CSV (curve, H, K, L, hw, I[, dI]); its
  // curves become kept curves.  Other tables (measured data) are not read.
  function load1DText(textIn,name){
    const lines=String(textIn).split(/\r?\n/);
    const comments=lines.filter(l=>/^\s*#/.test(l));
    const rows=lines.filter(l=>l.trim() && !/^\s*[#%!;]/.test(l)).map(splitRow);
    if(!rows.length) throw new Error('No data rows found.');
    const header=rows[0].some(t=>!Number.isFinite(Number(t))) ? rows.shift().map(t=>t.toLowerCase()) : null;
    const added=[];
    // Comment lines of one curve: "# curve 1: …", "# settings curve 1: …",
    // "# color curve 1: #rrggbb".
    const curveLine=(key,tag)=>new RegExp(`^\\s*#\\s*${key}\\s+${tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}:`);
    const curveComment=(key,tag)=>{ const re=curveLine(key,tag); return comments.find(l=>re.test(l))||''; };
    if(header && header[0]==='curve' && header.includes('hw_mev')){
      const col=n=>header.indexOf(n);
      const [cH,cK,cL,cE,cI]=['h','k','l','hw_mev','i_arb'].map(col);
      const groups=new Map();
      for(const r of rows){
        const tag=r[0]; if(!groups.has(tag)) groups.set(tag,[]);
        groups.get(tag).push(r);
      }
      for(const [tag,rs] of groups){
        const meta=curveComment('curve',tag).replace(/^\s*#\s*curve\s+\S+:\s*/,'');
        const val=(r,c)=>c>=0 && r[c]!==undefined && r[c]!=='' ? Number(r[c]) : NaN;
        const pts=rs.map(r=>({hkl:[val(r,cH),val(r,cK),val(r,cL)],E:val(r,cE)}));
        const I=rs.map(r=>val(r,cI));
        if(/^data\s/.test(meta)) continue;
        const m=meta.match(/\((Cooper-Nathans|Popovici)\)\s*$/);
        const axis=scanAxis(pts);
        const settings=readSettings(comments,curveLine('settings curve',tag));
        const cm=curveComment('color curve',tag).match(/#[0-9a-f]{6}\s*$/i);
        added.push({color:cm ? cm[0].trim().toLowerCase() : '',axis,pts,I,label:(meta.replace(/\s*\((Cooper-Nathans|Popovici)\)\s*$/,'')||`${name} ${tag}`),method:m?.[1]||'',inputs:[0,1,2,3].map(j=>varText(pts,j)),settings});
      }
    }else throw new Error('Not a 1D CSV saved with Save CSV.');
    if(!added.length) throw new Error('No curves found in the file.');
    for(const k of added) kept.push({...k,color:k.color||nextColor(),source:name});
    // The settings of the last calculated curve go back into the sidebar,
    // Resolution and the 1D cut box.
    const last=[...added].reverse().find(k=>k.settings);
    const notes=last ? applySettings(last.settings,'1D') : [];
    showConvTab('1d');
    refreshKept();
    return {n:added.length,restored:!!last,notes};
  }
  // 2D: a CSV written by Save CSV ([index,] H, K, L, hw, I).  U and V are
  // read from its first comment line (otherwise the current scattering plane).
  function load2DText(textIn){
    const lines=String(textIn).split(/\r?\n/);
    const uv=lines.find(l=>/U\s*=\s*\(/.test(l) && /V\s*=\s*\(/.test(l));
    const vecOf=(lab)=>{ const mm=uv?.match(new RegExp(`${lab}\\s*=\\s*\\(([^)]*)\\)`)); return mm ? mm[1].split(',').map(Number) : null; };
    let U=vecOf('U'), V=vecOf('V');
    const settings=readSettings(lines,/^\s*#\s*settings:/);
    const si=settings?.instrument;
    if(si && ['Uh','Uk','Ul','Vh','Vk','Vl'].every(k=>Number.isFinite(parseNum(si[k])))){ U=['Uh','Uk','Ul'].map(k=>parseNum(si[k])); V=['Vh','Vk','Vl'].map(k=>parseNum(si[k])); }
    if(!U || !V || U.length!==3 || V.length!==3 || [...U,...V].some(v=>!Number.isFinite(v))){
      const base=collectResolutionBase(); U=base.lc.sv1.map(Number); V=base.lc.sv2.map(Number);
    }
    const rows=lines.filter(l=>l.trim() && !/^\s*[#%!;]/.test(l)).map(splitRow);
    const header=rows.length && rows[0].some(t=>!Number.isFinite(Number(t))) ? rows.shift().map(t=>t.toLowerCase()) : null;
    let cols;
    if(header){ cols=['h','k','l','hw_mev','i_arb'].map(n=>header.indexOf(n)); if(cols[3]<0) cols[3]=header.findIndex(n=>/^(e|hw|energy)$/.test(n)); if(cols[4]<0) cols[4]=header.findIndex(n=>/^(i|intensity)$/.test(n)); }
    else{ const off=rows[0]?.length===6 ? 1 : 0; cols=[0,1,2,3,4].map(i=>i+off); }
    if(cols.some(c=>c<0)) throw new Error('Expected the columns H, K, L, hw_meV and I_arb.');
    // (H, K, L) = a U + b V: least squares in index space.
    const uu=U.reduce((s,x)=>s+x*x,0), vv=V.reduce((s,x)=>s+x*x,0), uvp=U.reduce((s,x,i)=>s+x*V[i],0), det=uu*vv-uvp*uvp;
    if(Math.abs(det)<1e-12) throw new Error('U and V are parallel.');
    const r6=v=>Math.round(v*1e6)/1e6;
    const recs=rows.map(r=>{
      const h=[0,1,2].map(i=>Number(r[cols[i]])), E=Number(r[cols[3]]), I=Number(r[cols[4]]);
      const pu=h.reduce((s,x,i)=>s+x*U[i],0), pv=h.reduce((s,x,i)=>s+x*V[i],0);
      return {a:r6((vv*pu-uvp*pv)/det),b:r6((uu*pv-uvp*pu)/det),E:r6(E),I};
    }).filter(o=>[o.a,o.b,o.E].every(Number.isFinite));
    if(!recs.length) throw new Error('No numeric rows found.');
    const uniq=k=>[...new Set(recs.map(o=>o[k]))].sort((x,y)=>x-y);
    const A=uniq('a'), B=uniq('b'), E=uniq('E');
    if(A.length<2 || B.length<2 || E.length<2) throw new Error('The file is not a 2D (U, V, ħω) grid.');
    if(A.length*B.length*E.length>4e7) throw new Error('The grid in the file is too large.');
    const ia=new Map(A.map((v,i)=>[v,i])), ib=new Map(B.map((v,i)=>[v,i])), ie=new Map(E.map((v,i)=>[v,i]));
    const I=new Float64Array(A.length*B.length*E.length).fill(NaN);
    for(const o of recs) I[(ib.get(o.b)*A.length+ia.get(o.a))*E.length+ie.get(o.E)]=o.I;
    const notes=settings ? applySettings(settings,'2D') : [];
    volume={A,B,E,I,U,V,plane:{U,V,hkl:(a,b)=>U.map((x,i)=>a*x+b*V[i])},settings};
    zlim.min=null; zlim.max=null; saveInputs();
    store2D();
    $('convDownload2D').disabled=false;
    showConvTab('2d');
    setupSliders(); drawMaps();
    return {nA:A.length,nB:B.length,nE:E.length,restored:!!settings,notes};
  }
  // Load CSV row: the loaded file name, and Clear, which removes what that
  // file brought in (the 2D maps if they are still the loaded ones; the
  // curves read from it in 1D) and empties the name.
  function setLoaded(dim,name){
    const box=$(`convLoad${dim}Name`); if(box){ box.value=name||''; box.title=name||''; }
    if($(`convLoad${dim}Clear`)) $(`convLoad${dim}Clear`).disabled=!name;
  }
  function clearLoaded(dim){
    const name=$(`convLoad${dim}Name`)?.title||'';
    if(dim==='2D'){
      if(volume && volume.source===name){
        volume=null;
        for(const id of ['convMapEU','convMapEV','convMapUV']){ try{ if(plotly()) Plotly.purge(id); }catch(_e){} }
        $('convDownload2D').disabled=true;
        message('convMessage2D','');
      }
    }else{
      const n=kept.length;
      kept.splice(0,kept.length,...kept.filter(k=>k.source!==name));
      if(kept.length!==n) refreshKept();
      message('convStatus1D',''); message('convMessage1D','');
    }
    setLoaded(dim,'');
  }
  function pickFile(inputId,handler){
    const f=$(inputId);
    f?.addEventListener('change',async()=>{
      const file=f.files?.[0]; f.value='';
      if(file) await handler(file);
    });
  }

  // ------------------------------------------------------------ layout ---
  // Desktop: the convolution pane fills the window height (like the CIF
  // generator); plots and the table take the remaining space.
  function fitHeight(){
    const box=$('convLayout'), pane=$('resolutionConvolutionPane');
    if(!box || !pane || pane.hidden) return;
    if(window.innerWidth<=1100){ box.style.height=''; return; }
    // Position in the scrolled content (the main column scrolls, not the window).
    const top=box.getBoundingClientRect().top+(box.closest('main')?.scrollTop||0)+window.scrollY;
    // Never shorter than what the controls plus a usable plot need: on a
    // short window the page scrolls instead of cutting the plots off.
    const d=window.tasUIDensity?.() || 1;
    // The card holds the file row, the note and the tabs: count its parts
    // above the tabs (and its padding).
    const cardEl=box.querySelector('.convolution-file-card');
    const card=cardEl ? [...cardEl.children].filter(el=>!el.classList.contains('convolution-tab-wrap')).reduce((sum,el)=>sum+el.offsetHeight,0)+30 : 0;
    const tabs=box.querySelector('.convolution-tabs')?.offsetHeight||0;
    const active=[...box.querySelectorAll('.convolution-tab-pane')].find(el=>!el.hidden);
    const fixed=active ? [...active.children].filter(el=>!el.matches('.convolution-plots,.convolution-scan-layout,.convolution-table-scroll')).reduce((sum,el)=>sum+el.offsetHeight,0) : 0;
    const need=card+tabs+fixed+Math.round(340*d)+40;
    box.style.height=`${Math.max(560,need,Math.floor(window.innerHeight-top-14))}px`;
  }
  function showConvTab(name){
    const tabs={data:['convTabData','convPaneData'],'2d':['convTab2D','convPane2D'],'1d':['convTab1D','convPane1D']};
    if(!tabs[name]) name='2d';
    for(const [key,[tab,pane]] of Object.entries(tabs)){
      const on=key===name;
      $(tab)?.classList.toggle('active',on); $(tab)?.setAttribute('aria-selected',String(on));
      if($(pane)) $(pane).hidden=!on;
    }
    try{ localStorage.setItem('plane-tas-convolution-tab',name); }catch(_e){}
    requestAnimationFrame(()=>{ fitHeight(); resizePlots(); renderTableRows(); });
  }
  // ------------------------------------------------------------ binding --
  function resizePlots(){
    if(!plotly()) return;
    for(const id of ['convMapEU','convMapEV','convMapUV','convScanPlot','plotUE','plotVE','plotUV','plotWE']){
      const el=$(id); if(el?.data && el.offsetParent) try{ Plotly.Plots.resize(el); }catch(_e){}
    }
  }
  function showPane(name){
    const conv=name==='convolution';
    $('resolutionSimulationPane').hidden=conv;
    $('resolutionConvolutionPane').hidden=!conv;
    for(const [id,on] of [['resolutionTabSimulation',!conv],['resolutionTabConvolution',conv]]){
      $(id)?.classList.toggle('active',on); $(id)?.setAttribute('aria-selected',String(on));
    }
    if(conv && $('method')) for(const id of ['convMethod2D','convMethod1D']) if($(id)) $(id).value=$('method').value;
    try{ localStorage.setItem('plane-tas-resolution-pane',name); }catch(_e){}
    requestAnimationFrame(()=>{ fitHeight(); resizePlots(); renderTableRows(); });
  }
  function bindConvolutionUI(){
    $('resolutionTabSimulation')?.addEventListener('click',()=>showPane('simulation'));
    $('resolutionTabConvolution')?.addEventListener('click',()=>showPane('convolution'));
    let saved='simulation'; try{ saved=localStorage.getItem('plane-tas-resolution-pane')||'simulation'; }catch(_e){}
    showPane(saved==='convolution' ? 'convolution' : 'simulation');
    for(const b of document.querySelectorAll('[data-conv-tab]')) b.addEventListener('click',()=>showConvTab(b.dataset.convTab));
    let tab='2d'; try{ tab=localStorage.getItem('plane-tas-convolution-tab')||'2d'; }catch(_e){}
    showConvTab(tab);
    const file=$('convFile');
    $('convSelectFile')?.addEventListener('click',()=>file?.click());
    file?.addEventListener('change',()=>{ const f=file.files?.[0]; file.value=''; loadFile(f); });
    $('convFormat')?.addEventListener('change',()=>{ loadText(); if(text) storeFile({name:fileName,format:$('convFormat').value,text}); });
    restoreFile();
    $('convResetRanges')?.addEventListener('click',()=>{ if(interp){ fillRanges(); saveInputs(); } });
    // Approximation: the same setting as Simulation.
    // Approximation: one setting (Simulation's), shown in the 2D slice and
    // 1D cut rows.
    for(const id of ['convMethod2D','convMethod1D']) $(id)?.addEventListener('change',()=>{ const m=$('method'); if(m){ m.value=$(id).value; m.dispatchEvent(new Event('change',{bubbles:true})); } });
    $('method')?.addEventListener('change',()=>{ for(const id of ['convMethod2D','convMethod1D']) if($(id)) $(id).value=$('method').value; });
    $('convCalculate2D')?.addEventListener('click',calculate2D);
    $('convLoad2D')?.addEventListener('click',()=>$('convLoad2DFile')?.click());
    $('convLoad2DClear')?.addEventListener('click',()=>clearLoaded('2D'));
    $('convLoad1DClear')?.addEventListener('click',()=>clearLoaded('1D'));
    $('convLoad1D')?.addEventListener('click',()=>$('convLoad1DFile')?.click());
    pickFile('convLoad2DFile',async file=>{
      if(busy2D) stop2D();
      try{
        const g=load2DText(await file.text());
        volume.source=file.name; setLoaded('2D',file.name);
        message('convMessage2D',[`Loaded${g.restored ? ' with its settings' : ` ${file.name}`}.`,...g.notes].join(' '),g.notes.length>0);
      }
      catch(err){ message('convMessage2D',`${file.name}: ${err.message||err}`,true); }
    });
    pickFile('convLoad1DFile',async file=>{
      try{
        const r=load1DText(await file.text(),file.name);
        setLoaded('1D',file.name);
        message('convStatus1D',`Loaded ${r.n} curve${r.n>1?'s':''}${r.restored ? ' with settings' : ''}`);
        message('convMessage1D',r.notes.join(' '),r.notes.length>0);
      }
      catch(err){ message('convMessage1D',`${file.name}: ${err.message||err}`,true); }
    });
    // Estimated calculation time follows every input that changes it.
    for(const id of ['convSamples2D','convSamples1D','convGrid2D','convGrid1D','convIntegration2D','convIntegration1D','convPoints1D','convH0','convK0','convL0','convE0','convH1','convK1','convL1','convE1',
      ...['H','K','L','E'].flatMap(n=>[`conv${n}min`,`conv${n}max`,`conv${n}bin`]),'convMethod2D','convMethod1D','convFormat'])
      $(id)?.addEventListener('input',scheduleEstimates), $(id)?.addEventListener('change',scheduleEstimates);
    for(const id of INPUT_IDS){ $(id)?.addEventListener('input',saveInputs); $(id)?.addEventListener('change',saveInputs); }
    for(const dim of ['2D','1D']) $(`convIntegration${dim}`)?.addEventListener('change',showIntegration);
    $('convResetRanges')?.addEventListener('click',scheduleEstimates);
    $('convCalculate1D')?.addEventListener('click',calculate1D);
    $('convDownload')?.addEventListener('click',downloadScan);
    $('convNormalize1D')?.addEventListener('change',()=>{ saveInputs(); drawScan(); });
    $('convSaveFigure1D')?.addEventListener('click',()=>saveScanFigure().catch(err=>message('convMessage1D',`Save figure: ${err.message||err}`,true)));
    $('convClearKept1D')?.addEventListener('click',()=>{ kept.length=0; refreshKept(); });
    // Pressing a button in the curve table must not move focus: focusing it
    // scrolls the table sideways under the pointer and the click is lost.
    $('convCurveList')?.closest('table')?.addEventListener('mousedown',event=>{ if(event.target.closest?.('button')) event.preventDefault(); });
    // Draw the empty panel without overwriting the stored results before
    // restoreFile() has read them back.
    restoringResults=true; try{ refreshKept(); }finally{ restoringResults=false; }
    $('convDownload2D')?.addEventListener('click',downloadVolume);
    $('convShowDispersion')?.addEventListener('change',()=>{ saveInputs(); drawMaps(); });
    for(const id of ['convShowEllipse','convEllCoh','convEllInc','convShowLine','convLineU','convLineV','convLineE']) $(id)?.addEventListener('change',()=>{ saveInputs(); drawMaps(); });
    for(const end of ['min','max']){
      const el=$(`convZ${end}`);
      const apply=()=>{
        const v=Number.parseFloat(el.value);
        zlim[end]=el.value.trim()==='' || !Number.isFinite(v) ? null : v;
        saveInputs(); drawMaps();
      };
      el?.addEventListener('change',apply);
      el?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); apply(); el.blur(); } });
    }
    for(const [key,input,arr] of [['U','convValueU','A'],['V','convValueV','B'],['E','convValueE','E']]){
      $(`convSlider${key}`)?.addEventListener('input',()=>{ if(!volume) return; $(input).value=fmt(volume[arr][sliderIndex(key)],3); drawMaps(); storeSliders(); });
      $(input)?.addEventListener('change',()=>{
        if(!volume) return;
        const i=nearest(volume[arr],num(input));
        $(`convSlider${key}`).value=String(i); $(input).value=fmt(volume[arr][i],3); drawMaps(); storeSliders();
      });
    }
    $('convTableScroll')?.addEventListener('scroll',()=>renderTableRows(),{passive:true});
    window.addEventListener('resize',()=>{ fitHeight(); resizePlots(); });
    document.addEventListener('click',e=>{ if(e.target?.closest?.('.tab-button,#tabResolution')) requestAnimationFrame(fitHeight); });
  }
  return {bindConvolutionUI,resizeConvolutionPlots:resizePlots};
}
