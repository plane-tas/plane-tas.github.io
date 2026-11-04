// Script: ASET (command templates) storage, table and validation.
// Part of the Script / Time estimate workspace (see ../script-workspace.js for how the parts are wired).
export function installAset(ctx){
  const {deps:{
    $
  }, state:shared, fn}=ctx;
  Object.assign(fn,{
    asetKeys, asetRowKey, asetTemplate, commandParts, escapeHtml, internalCommand, loadAset,
    normalizeStoredRow, operationOptions, parseScantitleDetail, promptAddAset, refreshTargetSelects,
    renumberAsetRows, saveAset, setInternalSelect, targetOptions, targetsForOperation,
    templateCommands, templatePlaceholders, validateAsetRows
  });


  const MOTOR_TARGETS=['ei','ef','e','s1','s2','hkle','br','qe','th2th'];
  const ASET_STORAGE_KEY='tas-simulator-spice-aset-v4';
  shared.ASET_COLLAPSED_STORAGE_KEY='tas-simulator-script-aset-collapsed-v1';
  const ASET_DEFAULTS={
    temperature:'drive vti <value>, drive sample <value>',
    field:'drive field <value>, drive ramp 1',
    field0:'drive zero 1'
  };
  shared.spiceLineMap=[];
  shared.spiceErrorLines=new Set();
  shared.spiceWarningLines=new Set();
  shared.lastSpiceValidation=null;
  shared.spiceMutationObserver=null;

  function escapeHtml(value){
    return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function escapeAttr(value){
    return escapeHtml(value).replace(/"/g,'&quot;');
  }
  function internalCommand(operation,target){
    const op=String(operation||'drive').toLowerCase();
    if(op==='scantitle' || op==='count' || op==='wait' || op==='loop' || op==='endloop') return op;
    const raw=String(target||'').trim();
    const t=canonicalMotorTarget(raw);
    const allowed=allTargets();
    return `${op}:${allowed.includes(t)?t:'s1'}`;
  }
  function commandParts(command){
    const raw=String(command||'drive:s1').trim();
    const lower=raw.toLowerCase();
    if(lower==='scantitle' || lower==='count' || lower==='wait' || lower==='loop' || lower==='endloop') return {op:lower,target:''};
    const colon=raw.indexOf(':');
    if(colon>0){
      const op=raw.slice(0,colon).toLowerCase(), target=canonicalMotorTarget(raw.slice(colon+1));
      if(['drive','driverel','scan','scanrel'].includes(op) && allTargets().includes(target)) return {op,target};
    }
    return {op:'drive',target:'s1'};
  }
  function detailsLookRanged(ranges){
    return Object.values(ranges||{}).some(value=>String(value??'').trim().split(/\s+/).filter(Boolean).length===3);
  }
  function normalizeStoredRow(values={}){
    let ranges={...(values.ranges||values.details||{})};
    const requestedRaw=String(values.command??values.variable??'s1').trim();
    const requested=requestedRaw.toLowerCase();
    if(/^(drive|driverel|scan|scanrel):/i.test(requestedRaw)){
      const parts=commandParts(requestedRaw);
      if(parts.op==='drive' && parts.target==='br' && ranges.hkl===undefined){
        const compact=[ranges.h,ranges.k,ranges.l].filter(value=>value!==undefined).join(' ').trim();
        if(compact) ranges={hkl:compact};
      }
      return {operation:values.operation||parts.op,target:values.target||parts.target,ranges,migrationWarning:values.migrationWarning||''};
    }
    if(requested==='scantitle' || requested==='count' || requested==='wait' || requested==='loop' || requested==='endloop') return {operation:requested,target:'',ranges};
    const ranged=detailsLookRanged(ranges);
    if(requested==='s1' || requested==='s2') return {operation:ranged?'scan':'drive',target:requested,ranges};
    if(requested==='rels1' || requested==='rels2') return {operation:ranged?'scanrel':'driverel',target:requested.endsWith('1')?'s1':'s2',ranges};
    if(requested==='hkle') return {operation:ranged?'scan':'drive',target:'hkle',ranges};
    if(requested==='temp') return {operation:'drive',target:'temperature',ranges:{target:ranges.target??ranges.temperature??''}};
    if(requested==='field') return {operation:'drive',target:'field',ranges:{target:ranges.target??ranges.field??''}};
    if(requested==='br'){
      let compact=String(ranges.hkl??ranges.target??'').trim();
      if(!compact) compact=[ranges.h,ranges.k,ranges.l].filter(value=>value!==undefined).join(' ').trim();
      return {operation:'drive',target:'br',ranges:{hkl:compact}};
    }
    if(requested==='th2th') return {operation:ranged?'scan':'drive',target:'s2',ranges:{s2:ranges.th2th??ranges.s2??''},migrationWarning:'Legacy th2th was migrated to S2. Verify the intended motor before running.'};
    if(requested==='qe') return {operation:ranged?'scan':'drive',target:'e',ranges:{hw:ranges.hw??ranges.e??''},migrationWarning:'Legacy QE cannot be represented by the new target list because Q is not a selectable target. Recreate this command as HKLE before use.'};
    return {operation:'drive',target:'s1',ranges};
  }
  function setInternalSelect(select,value){
    if(!select) return;
    select.innerHTML=`<option value="${escapeAttr(value)}">${escapeHtml(value)}</option><option value="loop">loop</option><option value="endloop">endloop</option><option value="wait">wait</option>`;
    select.value=value;
  }
  function operationOptions(selected){
    const operations=['drive','driverel','scan','scanrel','scantitle','count','wait','loop'];
    const options=operations.map(op=>`<option value="${op}"${selected===op?' selected':''}>${op}</option>`).join('');
    const end=`<option value="endloop"${selected==='endloop'?' selected':' hidden disabled'}>endloop</option>`;
    return options+end;
  }
  function normalizeTemplateSyntax(template){
    // ASET templates use only <value> and <range>. Scan/scanrel timing is
    // supplied automatically from the Time estimate row's MCU. Migrate the
    // former count preset mcu <time> helper out of saved templates.
    return String(template??'')
      .replace(/count\s+preset\s+mcu\s*(?:<time>|\btime\b)/gi,'')
      .replace(/(?<!<)\b(value|range)\b(?!>)/gi,'<$1>');
  }
  function templateCommands(template){
    return normalizeTemplateSyntax(template).split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
  }
  function templatePlaceholders(template){
    const commands=templateCommands(template), out=[];
    let occurrence=0;
    for(const command of commands){
      const re=/<(value|range)>/gi; let m;
      while((m=re.exec(command))){
        const type=m[1].toLowerCase();
        const before=command.slice(0,m.index).trim();
        const words=before.match(/[A-Za-z][A-Za-z0-9_]*/g)||[];
        let label=words.length?words[words.length-1]:type;
        if(['drive','driverel','scan','scanrel','preset','mcu','count'].includes(label.toLowerCase())) label=type;
        out.push({type,label,key:`aset_${type}_${++occurrence}`});
      }
    }
    return out;
  }

  function storedAsetEntries(){
    try{
      const saved=JSON.parse(localStorage.getItem(ASET_STORAGE_KEY)||'null');
      if(Array.isArray(saved?.entries)) return saved.entries;
    }catch(_e){}
    // Migrate the editable-template v3 list as a complete list.
    try{
      const old=JSON.parse(localStorage.getItem('tas-simulator-spice-aset-v3')||'null');
      if(Array.isArray(old?.entries) && old.entries.length) return old.entries;
    }catch(_e){}
    // Migrate v2 device-list ASETs into command templates.
    try{
      const old=JSON.parse(localStorage.getItem('tas-simulator-spice-aset-v2')||'null');
      if(Array.isArray(old?.entries)) return old.entries.map(item=>({
        key:item?.key,
        template:Array.isArray(item?.devices)?item.devices.map(d=>`drive ${d} <value>`).join(', '):''
      }));
    }catch(_e){}
    try{
      const old=JSON.parse(localStorage.getItem('tas-simulator-spice-aset-v1')||'null');
      if(old && typeof old==='object') return Object.entries(old).map(([key,devices])=>({
        key,template:Array.isArray(devices)?devices.map(d=>`drive ${d} <value>`).join(', '):''
      }));
    }catch(_e){}
    return [];
  }
  function asetRowKey(row){
    return String(row?.querySelector?.('[data-aset-target]')?.value??row?.dataset?.asetKey??'').trim();
  }
  function canonicalMotorTarget(value){
    const raw=String(value??'').trim();
    const lower=raw.toLowerCase();
    return MOTOR_TARGETS.includes(lower)?lower:raw;
  }

  function asetKeys(){
    const keys=new Set();
    for(const row of document.querySelectorAll('#scriptAsetList [data-aset-row]')){
      const key=asetRowKey(row);
      if(/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !MOTOR_TARGETS.includes(key.toLowerCase())) keys.add(key);
    }
    if(!keys.size){
      for(const item of storedAsetEntries()){
        const key=String(item?.key||'').trim();
        if(/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !MOTOR_TARGETS.includes(key.toLowerCase())) keys.add(key);
      }
    }
    if(!keys.size) for(const key of Object.keys(ASET_DEFAULTS)) keys.add(key);
    return [...keys];
  }
  function allTargets(){ return [...MOTOR_TARGETS,...asetKeys()]; }
  function targetsForOperation(operation){
    const op=String(operation||'drive').toLowerCase();
    if(['scantitle','count','wait','loop','endloop'].includes(op)) return [];
    const scanOnly=new Set(['qe','th2th']);
    return allTargets().filter(t=>{
      // QE and th2th are dedicated scan targets. br is a positioning-only command.
      if(scanOnly.has(t)) return op==='scan';
      if(t==='br') return op==='drive';
      // Relative HKLE is not a supported SPICE operation, so do not offer it.
      if(t==='hkle' && (op==='driverel' || op==='scanrel')) return false;
      return true;
    });
  }
  function targetOptions(selected,operation='drive'){
    const labels={ei:'Ei',ef:'Ef',e:'E',s1:'S1',s2:'S2',hkle:'HKLE',br:'br',qe:'QE',th2th:'th2th'};
    const targets=targetsForOperation(operation);
    return `<option value="">—</option>`+targets.map(t=>`<option value="${escapeAttr(t)}"${selected===t?' selected':''}>${escapeHtml(labels[t]||t)}</option>`).join('');
  }
  function asetTemplate(key){
    const target=String(key||'').trim();
    const row=[...document.querySelectorAll('#scriptAsetList [data-aset-row]')].find(r=>asetRowKey(r)===target);
    const input=row?.querySelector('[data-aset-template]');
    if(input) return normalizeTemplateSyntax(String(input.value||'').trim());
    const stored=storedAsetEntries().find(item=>String(item?.key||'').trim()===target);
    if(stored?.template!==undefined) return normalizeTemplateSyntax(String(stored.template||'').trim());
    const defaultKey=Object.prototype.hasOwnProperty.call(ASET_DEFAULTS,target)?target:null;
    return normalizeTemplateSyntax(String(defaultKey?ASET_DEFAULTS[defaultKey]:'').trim());
  }
  function asetEntries(){
    return [...document.querySelectorAll('#scriptAsetList [data-aset-row]')].map(row=>({
      key:asetRowKey(row),
      template:normalizeTemplateSyntax(String(row.querySelector('[data-aset-template]')?.value||'').trim())
    })).filter(item=>/^[A-Za-z][A-Za-z0-9_]*$/.test(item.key) && !MOTOR_TARGETS.includes(item.key.toLowerCase()));
  }
  function renumberAsetRows(){
    [...document.querySelectorAll('#scriptAsetList [data-aset-row]')].forEach((row,i)=>{
      const cell=row.querySelector('[data-aset-index]'); if(cell) cell.textContent=String(i+1);
    });
  }
  function refreshTargetSelects(){
    document.querySelectorAll('#timeScanRows [data-time-target]').forEach(select=>{
      const row=select.closest('.time-scan-row');
      const operation=row?.querySelector('[data-time-operation]')?.value||'drive';
      const previous=select.value;
      const allowed=targetsForOperation(operation);
      select.innerHTML=targetOptions(previous,operation);
      if(allowed.includes(previous)) select.value=previous;
      else if(!select.disabled){ select.value=allowed.includes('s1')?'s1':(allowed[0]||''); }
      else select.value='';
    });
  }
  function createAsetRow(key='',template='',{removable=true}={}){
    const host=$('scriptAsetList'); if(!host) return null;
    const row=document.createElement('div');
    row.className='script-aset-item'; row.dataset.asetRow='1';
    row.innerHTML=`<span class="script-aset-index" data-aset-index></span>`+
      `<input type="text" data-aset-target value="${escapeAttr(String(key||''))}" placeholder="target" spellcheck="false" aria-label="ASET target">`+
      `<textarea data-aset-template rows="2" placeholder="drive device <value>\nscan device <range>" spellcheck="false" aria-label="ASET SPICE template">${escapeHtml(String(template||''))}</textarea>`+
      `${removable?'<button type="button" class="script-aset-remove" title="Remove ASET" aria-label="Remove ASET">×</button>':'<span></span>'}`;
    host.appendChild(row); renumberAsetRows(); return row;
  }
  function saveAset(){
    const payload={entries:asetEntries()};
    try{ localStorage.setItem(ASET_STORAGE_KEY,JSON.stringify(payload)); }catch(_e){}
  }
  function loadAset(){
    const host=$('scriptAsetList'); if(!host) return;
    const entries=storedAsetEntries();
    host.replaceChildren();
    if(entries.length){
      entries.forEach((item,index)=>{
        const key=String(item?.key||'').trim();
        if(!key || MOTOR_TARGETS.includes(key.toLowerCase())) return;
        createAsetRow(key,normalizeTemplateSyntax(String(item?.template||'')),{removable:true});
      });
    }else{
      for(const [key,template] of Object.entries(ASET_DEFAULTS)) createAsetRow(key,template,{removable:true});
    }
    renumberAsetRows();
  }
  function promptAddAset(){
    const row=createAsetRow('','',{removable:true});
    row?.querySelector('[data-aset-target]')?.focus();
    fn.scriptMessage('Added an empty ASET row. Enter Target and SPICE template directly in the list.');
  }
  function validateAsetRows(){
    const seen=new Set(); let ok=true, message='';
    for(const row of document.querySelectorAll('#scriptAsetList [data-aset-row]')){
      const key=asetRowKey(row), target=row.querySelector('[data-aset-target]'), template=row.querySelector('[data-aset-template]');
      const validKey=/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !MOTOR_TARGETS.includes(key.toLowerCase()) && !seen.has(key);
      target?.classList.toggle('invalid',!validKey);
      if(validKey) seen.add(key); else if(!message) message=key?`ASET Target "${key}" is invalid or duplicated.`:'Enter an ASET Target name.';
      const validTemplate=templateCommands(template?.value).length>0;
      template?.classList.toggle('invalid',!validTemplate);
      if(!validTemplate && !message) message=`ASET ${key||'?'} needs at least one SPICE template command.`;
      ok=ok&&validKey&&validTemplate;
    }
    return {ok,message};
  }


  function parseScantitleDetail(raw,row=null){
    const text=String(raw??'').trim();
    if(!text) return {ok:false,error:'Enter a scan title.'};
    const refs=[];
    const re=/\bloop([1-9]\d*)\b/gi;
    let match;
    while((match=re.exec(text))){
      if(!row) continue;
      const ref=fn.parseTimeLoopReferenceToken(match[0],row);
      if(!ref?.ok) return ref || {ok:false,error:`${match[0]} is not available at this command.`};
      refs.push({pair:ref.loopRow?.dataset?.timeLoopPair||'',level:ref.loopRef});
    }
    return {ok:true,fixed:true,count:1,value:text,textRefs:refs};
  }
}
