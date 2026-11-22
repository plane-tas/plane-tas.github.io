import {movedInstrument} from './instrument-renames.js';
import {tasConvention} from '../core/tas-conventions.js';
import {fileTasConvention, s2FileRange} from './s2-range.js';
import {mergeSideRange} from './motor-range.js';
import {downloadText} from '../core/download.js';
// Instrument JSON: Save (current instrument with the sidebar / Resolution
// settings), Load (adds an instrument file to the Instrument list; the last
// loaded one is kept in this browser) and the built-in "Custom" instrument (every type and crystal).

const LOCAL_INSTRUMENTS_STORAGE_KEY='plane-tas-local-instruments-v1';
// Keys sort after the instrument/ files in the Instrument list.
const CUSTOM_KEY='zz_00_Custom';
const LOCAL_KEY_PREFIX='zz_local_';

// Custom: all types and crystals, common component sizes; edit in the UI or
// in a saved JSON file.
function customInstrumentTemplate(crystalNames){
  const all=[...crystalNames];
  return {
    name:'Custom',
    approximation:{method:'Popovici'},
    supermirror:{enabled:false,m_value:2},
    collimator:{'1st_h':40,'1st_v':120,'2nd_h':80,'2nd_v':120,'3rd_h':80,'3rd_v':120,'4th_h':80,'4th_v':120,'3rd_type':'soller'},
    monochromator:{crystal:'PG(002)',mosaic_h:30,mosaic_v:30,width:7,height:2,thickness:0.2,vfocus:true,hfocus:false,blade_h:1,blade_v:7},
    analyzer:{crystal:'PG(002)',mosaic_h:30,mosaic_v:30,width:2,height:2,thickness:0.2,vfocus:true,hfocus:false,blade_h:7,blade_v:9},
    detector:{width:3.2,height:12,type:'single',shape:'cylinder'},
    // Ef 3.635 meV: 2θA = 90° with PG(002) (the usual reference).
    configuration:{energy_mode:'Ef fixed',Ef:3.635,sense:'+-+',m_sign:'ccw',s_sign:'ccw',a_sign:'ccw'},
    distance:{L0:1,L1:1.6,L2:0.8,L3:0.6},
    beam:{width:7,height:14,shape:'rectangle'},
    // Any arrangement and energy: M2 / A2 on either side up to 145 deg (the
    // small-angle end is 10 deg for M2), S1 / S2 over the full turn.
    M2_min:-145,
    M2_max:145,
    A2_min:-145,
    A2_max:145,
    S1_min:-180,
    S1_max:180,
    S2_min:-180,
    S2_max:180,
    instrument_type:'tas',
    instrument_setting:['tas','four-circle','diffractometer'],
    available_crystals:{monochromator:all,analyzer:all},
    four_circle:{
      configuration:{energy_mode:'Ei fixed',Ei:14.7},
      phi_sign:'ccw',chi_sign:'ccw',phi_min:-180,phi_max:180,chi_min:-90,chi_max:90
    },
    diffractometer:{
      configuration:{energy_mode:'Ei fixed',Ei:14.7}
    }
  };
}

function readLocalInstruments(){
  try{
    const saved=JSON.parse(localStorage.getItem(LOCAL_INSTRUMENTS_STORAGE_KEY)||'null');
    return saved && typeof saved==='object' && !Array.isArray(saved) ? saved : {};
  }catch(_e){ return {}; }
}
function writeLocalInstruments(map){
  try{ localStorage.setItem(LOCAL_INSTRUMENTS_STORAGE_KEY,JSON.stringify(map)); return true; }
  catch(_e){ return false; }
}
function withLocalLabel(json){
  return {...json,__label:`${json.name||'Instrument'} (loaded)`,__local:true};
}
function cleanInstrumentJson(json){
  const out=JSON.parse(JSON.stringify(json));
  delete out.__label; delete out.__local;
  return out;
}
function safeFileName(name){
  return String(name||'instrument').replace(/@/g,'_').replace(/[^\w.-]+/g,'_').replace(/^_+|_+$/g,'') || 'instrument';
}
function hasS2Table(json){
  if(json?.S2_min!==undefined && json?.S2_max!==undefined) return true;
  const rows=Array.isArray(json?.S2_limits) ? json.S2_limits : json?.qe_range?.S2_limits;
  return Array.isArray(rows) && rows.length>=2;
}

export function createInstrumentJsonIO(deps){
  const {$, instruments, refreshSelect, currentInstrument, crystalNames, setStatus, showError}=deps;

  // Custom + the instrument loaded last in this browser (after instrument/).
  // Only one loaded instrument is kept: a new Load JSON replaces it.
  function addLocalInstruments(){
    instruments.set(CUSTOM_KEY,customInstrumentTemplate(crystalNames));
    const entries=Object.entries(readLocalInstruments())
      .filter(([key,json])=>key.startsWith(LOCAL_KEY_PREFIX) && json && typeof json==='object');
    if(!entries.length) return;
    const [key,json]=entries[entries.length-1];
    instruments.set(key,withLocalLabel(json));
    if(entries.length>1) writeLocalInstruments({[key]:json});
  }

  const value=id=>{
    const el=$(id); if(!el) return undefined;
    const t=String(el.value??'').trim();
    if(t==='') return null;
    const v=Number(t);
    return Number.isFinite(v) ? v : null;
  };
  const checked=id=>$(id) ? !!$(id).checked : undefined;
  const text=id=>$(id) ? String($(id).value) : undefined;
  // Write defined values into an object section (kept keys are not removed).
  function assign(target,key,entries){
    const old=target[key] && typeof target[key]==='object' && !Array.isArray(target[key]) ? target[key] : {};
    const next={...old};
    for(const [k,v] of Object.entries(entries)) if(v!==undefined) next[k]=v;
    target[key]=next;
  }
  function setOrDelete(target,key,v){
    if(v===null || v===undefined) delete target[key]; else target[key]=v;
  }

  // The selected instrument file with the current settings.  Settings go to
  // the top level for the instrument's default type, otherwise to the
  // section of the selected type ("four_circle", "diffractometer", ...).
  function currentInstrumentJson(){
    const key=$('instrument')?.value;
    const base=instruments.get(key);
    if(!base) throw new Error('Select an instrument first.');
    const inst=currentInstrument();
    const out=cleanInstrumentJson(base);
    const types=Array.isArray(out.instrument_setting) && out.instrument_setting.length ? out.instrument_setting : [out.instrument_type||'tas'];
    const defaultType=types.includes(out.instrument_type) ? out.instrument_type : types[0];
    const mode=inst.instrument_mode||defaultType;
    let target=out;
    if(mode!==defaultType){
      const name=String(mode).replace(/-/g,'_');
      if(!out[name] || typeof out[name]!=='object' || Array.isArray(out[name])) out[name]={};
      target=out[name];
    }
    const tas=inst.instrument_type==='tas';
    const energyMode=text('energyMode')||'Ef fixed';
    const energy=value('energy');
    const config={energy_mode:energyMode,sense:text('sense'),m_sign:text('msign'),s_sign:text('s1sign'),a_sign:text('asign')};
    if(energy!==null) config[energyMode==='Ei fixed' ? 'Ei' : 'Ef']=energy;
    assign(target,'configuration',config);
    if(target.configuration){
      // Keep only the energy of the fixed side so the file is unambiguous.
      if(energyMode==='Ei fixed') delete target.configuration.Ef; else delete target.configuration.Ei;
    }
    if(target.default_energy!==undefined && energy!==null) target.default_energy=energy;
    if(target.energy_mode!==undefined) target.energy_mode=energyMode;
    assign(target,'approximation',{method:text('method')});
    assign(target,'supermirror',{enabled:checked('gm1'),m_value:value('div1m')});
    assign(target,'collimator',{
      '1st_h':value('div1h'),'1st_v':value('div1v'),'2nd_h':value('div2h'),'2nd_v':value('div2v'),
      '3rd_h':value('div3h'),'3rd_v':value('div3v'),'4th_h':value('div4h'),'4th_v':value('div4v'),
      '3rd_type':text('coll3Type')
    });
    assign(target,'monochromator',{
      crystal:text('monoCrystal'),mosaic_h:value('mosMonoH'),mosaic_v:value('mosMonoV'),
      width:value('monoWcm'),height:value('monoHcm'),thickness:value('monoTcm'),
      hfocus:checked('monoHF'),vfocus:checked('monoVF'),blade_h:value('monoHB'),blade_v:value('monoVB')
    });
    if(tas){
      assign(target,'analyzer',{
        crystal:text('anaCrystal'),mosaic_h:value('mosAnaH'),mosaic_v:value('mosAnaV'),
        width:value('anaWcm'),height:value('anaHcm'),thickness:value('anaTcm'),
        hfocus:checked('anaHF'),vfocus:checked('anaVF'),blade_h:value('anaHB'),blade_v:value('anaVB')
      });
    }
    assign(target,'distance',{L0:value('L0'),L1:value('L1'),L2:value('L2'),L3:value('L3'),LSD:value('sampleDetectorDistance')});
    if(target.distance && target.distance.LSD===null) delete target.distance.LSD;
    assign(target,'beam',{width:value('srcWcm'),height:value('srcHcm'),shape:text('sourceShape')});
    assign(target,'detector',{width:value('detWcm'),height:value('detHcm'),type:text('detectorType'),shape:text('detectorShape')});
    // M2 / A2: the file range with the part on the page's side replaced by
    // the fields, as readings for the motor signs written above (null = no
    // limit).
    {
      let c=null;
      try{ c=tasConvention(text('sense'),text('s1sign')); }catch(_e){}
      const enc=v=>String(v||'').toLowerCase()==='cw' ? -1 : 1;
      const cfg=(!Array.isArray(inst?.configuration) && inst?.configuration) ? inst.configuration : {};
      for(const [key,sideOf,signId,fileKey] of [['M2',x=>x.monoSign,'msign','m_sign'],['A2',x=>x.analyzerSign,'asign','a_sign']]){
        if(!c || !$(`${key}min`)) continue;
        const [lo,hi]=mergeSideRange(inst[`${key}_min`],inst[`${key}_max`],enc(cfg[fileKey] ?? inst[fileKey]),sideOf(c),enc(text(signId)),value(`${key}min`),value(`${key}max`))
          .map(v=>v===null ? null : Number(v.toFixed(3)));
        // Either end at the motor's full range is no limit.
        target[`${key}_min`]=lo; target[`${key}_max`]=hi;
        if(target.qe_range && typeof target.qe_range==='object'){ delete target.qe_range[`${key}_min`]; delete target.qe_range[`${key}_max`]; }
      }
    }
    setOrDelete(target,'S1_min',value('S1min'));
    setOrDelete(target,'S1_max',value('S1max'));
    // S2 range: "S2_min" < "S2_max" as readings for the Sense and S1 sign
    // written above (each a number, or the M2 table it came from).  The
    // limits shown for the page's scattering side replace the file values
    // unless read only.
    {
      const {ends}=s2FileRange(inst);
      let k=1, r=1;
      try{
        const page=tasConvention(text('sense'),text('s1sign'));
        k=fileTasConvention(inst).s1EncoderSign*page.s1EncoderSign; r=page.s2EncoderSign<0 ? -1 : 1;
      }catch(_e){}
      const list=ends.map(rows=>rows.map(x=>({...x,S2:k*x.S2})));
      const first=rows=>rows.find(x=>x.S2!==0)?.S2 ?? rows[0]?.S2 ?? 0;
      const field=id=>{ const el=$(id); const v=Math.abs(Number(el?.value)); return el && !el.readOnly && String(el.value).trim()!=='' && Number.isFinite(v) ? v : null; };
      const near=field('S2min'), far=field('S2maxEffective');
      const constant=v=>[{M2:0,S2:v},{M2:180,S2:v}];
      const here=list.map((rows,i)=>[rows,i]).filter(([rows])=>Math.sign(first(rows))===r);
      if(here.length===2){
        here.sort((p,q)=>Math.abs(first(q[0]))-Math.abs(first(p[0])));
        if(far!==null) list[here[0][1]]=constant(r*far);
        if(near!==null) list[here[1][1]]=constant(r*near);
      }else if(here.length===1){
        // The range crosses the beam: the small-angle limit is not kept.
        if(far!==null) list[here[0][1]]=constant(r*far);
      }
      const out=rows=>{
        const vals=rows.map(x=>x.S2);
        if(vals.every(v=>Math.abs(v-vals[0])<1e-10)) return vals[0];
        return rows.map(x=>{ const row={}; if(x.M2!==undefined) row.M2=x.M2; else if(x.Ei!==undefined) row.Ei=x.Ei; row.S2=x.S2; return row; });
      };
      if(list.length===1) list.push(constant(0));
      list.sort((p,q)=>first(p)-first(q));
      for(const key of ['S2_min','S2_max','S2_gap','S2_limits','S2_range']){ delete target[key]; if(target.qe_range && typeof target.qe_range==='object') delete target.qe_range[key]; }
      if(list.length){ target.S2_min=out(list[0]); target.S2_max=out(list[list.length-1]); }
    }
    if(inst.instrument_type==='four-circle'){
      for(const [k,id] of [['phi_min','phiMin'],['phi_max','phiMax'],['chi_min','chiMin'],['chi_max','chiMax']]) setOrDelete(target,k,value(id));
      target.phi_sign=text('phiSign'); target.chi_sign=text('chiSign');
    }
    return out;
  }

  function saveInstrumentJson(){
    try{
      const json=currentInstrumentJson();
      const name=`${safeFileName(json.name)}.json`;
      downloadText(JSON.stringify(json,null,2)+'\n',name,'application/json');
      setStatus?.(`${name} saved`);
    }catch(err){ showError?.(err.message||String(err)); }
  }

  function selectInstrument(key){
    const select=$('instrument');
    refreshSelect(instruments,select,null);
    if(!instruments.has(key)) key=movedInstrument(key,'',instruments.keys())?.key??key;
    if(instruments.has(key)) select.value=key; else select.selectedIndex=0;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  async function loadInstrumentJson(file){
    if(!file) return;
    try{
      let json;
      try{ json=JSON.parse(await file.text()); }
      catch(err){ throw new Error(`${file.name}: not a valid JSON file (${err.message}).`); }
      if(!json || typeof json!=='object' || Array.isArray(json)) throw new Error(`${file.name}: an instrument file must be a JSON object.`);
      if(!hasS2Table(json)) throw new Error(`${file.name}: "S2_min" and "S2_max" are required.`);
      json=cleanInstrumentJson(json);
      if(!json.name) json.name=file.name.replace(/\.json$/i,'');
      const key=LOCAL_KEY_PREFIX+safeFileName(json.name);
      // Replace the previously loaded instrument.
      for(const old of [...instruments.keys()]) if(old.startsWith(LOCAL_KEY_PREFIX)) instruments.delete(old);
      const stored=writeLocalInstruments({[key]:json});
      instruments.set(key,withLocalLabel(json));
      selectInstrument(key);
      setStatus?.(`${json.name} loaded${stored ? '' : ' (not kept: browser storage is unavailable)'}`);
    }catch(err){ showError?.(err.message||String(err)); }
  }

  function bindInstrumentJsonButtons(){
    const file=$('instrumentJsonFile');
    $('instrumentJsonSave')?.addEventListener('click',saveInstrumentJson);
    $('instrumentJsonLoad')?.addEventListener('click',()=>file?.click());
    file?.addEventListener('change',()=>{ const f=file.files?.[0]; file.value=''; loadInstrumentJson(f); });
  }

  return {addLocalInstruments, bindInstrumentJsonButtons};
}
