// Magnetic form factors ported from FormFactor.jl (Sunny dipole approximation).
// Q is |momentum transfer| in Å^-1; the plot shows f(Q) and |f(Q)|², not full magnetic intensity.
import { MAGNETIC_ION_DATA } from './magnetic-form-factor-data.js';

const FOUR_PI=4*Math.PI;
const ORBITALS='SPDFGHIKLMNOQRTUVWXYZ';
const PERIODIC_SYMBOLS='H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
const atomicNumber=new Map(PERIODIC_SYMBOLS.map((symbol,i)=>[symbol,i+1]));
const ionNames=Object.keys(MAGNETIC_ION_DATA).sort((a,b)=>{
  const element=s=>s.replace(/\d+$/,'');
  return (atomicNumber.get(element(a))??999)-(atomicNumber.get(element(b))??999) ||
    Number(a.match(/\d+$/)?.[0])-Number(b.match(/\d+$/)?.[0]);
});
const GRAPH_Q_MAX=10;

export function availableMagneticIons(){return ionNames.slice();}
export function magneticIonConfigurations(label){return (MAGNETIC_ION_DATA[label]||[]).map(v=>v[0]);}
export function freeIonJ2Weight(term){
  const m=String(term).match(/^(\d+)([A-Z])(\d+(?:\/\d+)?)$/);
  if(!m) throw new Error('Cannot determine the free-ion Landé factor for '+term);
  const S=(Number(m[1])-1)/2;
  const L=ORBITALS.indexOf(m[2]);
  const J=m[3].includes('/')?Number(m[3].split('/')[0])/Number(m[3].split('/')[1]):Number(m[3]);
  if(L<0 || !Number.isFinite(J) || J===0) throw new Error('Free-ion Landé factor undefined for '+term+' (J=0). Choose another j2 setting.');
  const g=1+(J*(J+1)+S*(S+1)-L*(L+1))/(2*J*(J+1));
  if(!Number.isFinite(g) || Math.abs(g)<1e-12) throw new Error('Undefined free-ion j2 weight.');
  return (2-g)/g;
}
function gaussian(coeff,s2){
  return coeff[0]*Math.exp(-coeff[1]*s2)+coeff[2]*Math.exp(-coeff[3]*s2)+
    coeff[4]*Math.exp(-coeff[5]*s2)+coeff[6]*Math.exp(-coeff[7]*s2)+coeff[8];
}
export function computeMagneticFormFactor(label,Q,{config=null,j2Weight=0}={}){
  const variants=MAGNETIC_ION_DATA[label];
  if(!variants) throw new Error('Unknown magnetic ion: '+label);
  const entry=config==null?(variants.length===1?variants[0]:null):variants.find(v=>v[0]===config);
  if(!entry) throw new Error('Specify an electronic configuration for '+label);
  const q=Number(Q), c=Number(j2Weight);
  if(!Number.isFinite(q) || q<0) throw new Error('Q must be nonnegative.');
  if(!Number.isFinite(c)) throw new Error('j2 weight must be finite.');
  const s2=q*q/(FOUR_PI*FOUR_PI);
  const j0=gaussian(entry[2],s2);
  const j2=gaussian(entry[3],s2)*s2;
  const f=j0+c*j2;
  return {f,fSquared:f*f,j0,j2,config:entry[0],term:entry[1]};
}

// Planning-friendly defaults: largely quenched 3d/4d/5d orbital moments -> c=0;
// localized 4f/5f moments -> free-ion Landé coefficient when J != 0.
// This is a default approximation, NOT a determination of a material's electronic state.
export function automaticMagneticFormFactorWeight(config,term){
  if(/^\s*[45]f/.test(config)){
    try{return freeIonJ2Weight(term);}catch{return 0;}
  }
  return 0;
}

// Q values in [0, maxQ] where f(Q) (which='f') or |f(Q)|² (which='fSquared')
// equals target.  f can be negative at large Q (e.g. a large c<j2>).
export function magneticFormFactorRoots(label,target,opts={},maxQ=GRAPH_Q_MAX,which='fSquared'){
  if(!Number.isFinite(target)||!Number.isFinite(maxQ)||maxQ<=0)return [];
  if(which!=='f' && target<0)return [];
  const value=q=>computeMagneticFormFactor(label,q,opts)[which==='f'?'f':'fSquared'];
  const steps=1000, eps=1e-9;
  const roots=[];
  let lo=0, flo=value(0)-target;
  if(Math.abs(flo)<eps)roots.push(0);
  for(let i=1;i<=steps;i++){
    const hi=maxQ*i/steps;
    const fhi=value(hi)-target;
    if(Math.abs(fhi)<eps)roots.push(hi);
    else if(flo*fhi<0){
      let l=lo,r=hi,a=flo;
      for(let iter=0;iter<42;iter++){
        const mid=(l+r)/2, fm=value(mid)-target;
        if(a*fm<=0)r=mid; else{l=mid;a=fm;}
      }
      roots.push((l+r)/2);
    }
    lo=hi;flo=fhi;
  }
  return roots.filter((v,i)=>roots.findIndex(r=>Math.abs(v-r)<1e-5)===i);
}
export function magneticFormFactorIntensityRoots(label,target,opts={},maxQ=GRAPH_Q_MAX){
  return magneticFormFactorRoots(label,target,opts,maxQ,'fSquared');
}

function displayIon(label){
  const m=label.match(/^([A-Za-z]+)(\d+)$/);
  return m?`${m[1]}${m[2]}${Number(m[2])===0?'':'+'}`:label;
}

export function initializeMagneticFormFactorUI(){
  const $=id=>document.getElementById(id);
  const ion=$('magffIon');
  if(!ion || ion.dataset.initialized==='true') return ()=>{};
  ion.dataset.initialized='true';
  const config=$('magffConfig'),configLabel=$('magffConfigLabel');
  const mode=$('magffWeightMode'),weight=$('magffWeight');
  const qField=$('magffQPoint'),qSlider=$('magffQSlider');
  const intensityField=$('magffIntensity'),fField=$('magffValue');
  const info=$('magffInfo'),plot=$('magffPlot'),download=$('magffDownload');
  for(const label of ionNames)ion.add(new Option(displayIon(label),label));
  ion.value='Fe3';
  let exportRows=[];
  const fmt=n=>Number(n).toFixed(5).replace(/0+$/,'').replace(/\.$/,'');
  const curvePoints=301;
  const grid=Array.from({length:curvePoints},(_,i)=>GRAPH_Q_MAX*i/(curvePoints-1));

  let syncedConfigIon=null;
  function syncConfig(preferredConfig=null){
    const variants=MAGNETIC_ION_DATA[ion.value]||[];
    config.replaceChildren();
    for(const entry of variants)config.add(new Option(entry[0],entry[0]));
    configLabel.classList.toggle('hidden',variants.length<=1);
    const chosen=variants.some(entry=>entry[0]===preferredConfig)
      ? preferredConfig : variants[0]?.[0];
    if(chosen!==undefined)config.value=chosen;
    syncedConfigIon=ion.value;
    syncFreeIonAvailability();
  }
  function ensureConfigMatchesIon(){
    const variants=MAGNETIC_ION_DATA[ion.value]||[];
    const optionsMatch=syncedConfigIon===ion.value &&
      config.options.length===variants.length &&
      variants.every((entry,index)=>config.options[index]?.value===entry[0]);
    if(optionsMatch && variants.some(entry=>entry[0]===config.value))return;

    // Right-panel persistence restores select values programmatically without
    // firing a change event. Rebuild the electronic configurations for the
    // restored ion before the first plot render, preserving its saved choice.
    let preferred=config.value;
    try{
      const saved=JSON.parse(localStorage.getItem('tas-simulator-right-panel-v1')||'null')?.values;
      if(saved?.magffIon===ion.value && variants.some(entry=>entry[0]===saved.magffConfig))
        preferred=saved.magffConfig;
    }catch(_err){}
    syncConfig(preferred);
  }
  function syncFreeIonAvailability(){
    const selected=MAGNETIC_ION_DATA[ion.value]?.find(v=>v[0]===config.value);
    const freeOption=mode.querySelector('option[value="free"]');
    let supported=false;
    if(selected){
      try{supported=Number.isFinite(freeIonJ2Weight(selected[1]));}catch(_e){supported=false;}
    }
    if(freeOption){
      freeOption.disabled=!supported;
      freeOption.title=supported?'':'Free-ion Landé factor is undefined for this electronic state.';
    }
    // Free-ion c is mathematically undefined for J=0 (and some other terms).
    // Avoid leaving the calculator in a broken state when the ion changes.
    if(!supported && mode.value==='free'){
      mode.value='auto';
    }
  }
  function currentOptions(){
    const chosen=MAGNETIC_ION_DATA[ion.value]?.find(v=>v[0]===config.value);
    if(!chosen)throw new Error('Select an ion and electronic configuration.');
    let c=0;
    if(mode.value==='auto')c=automaticMagneticFormFactorWeight(chosen[0],chosen[1]);
    if(mode.value==='free')c=freeIonJ2Weight(chosen[1]);
    if(mode.value==='custom'){
      if(weight.value.trim()==='')throw new Error('Enter a custom j2 weight.');
      c=Number(weight.value);
    }
    if(!Number.isFinite(c))throw new Error('Invalid j2 weight.');
    return {config:config.value,j2Weight:c};
  }
  // The c box always shows the weight in use; it is editable only in Custom.
  function syncWeightField(c){
    const custom=mode.value==='custom';
    weight.readOnly=!custom;
    weight.setAttribute('aria-readonly',String(!custom));
    if(!custom)weight.value=String(Number(Number(c).toFixed(4)));
  }
  // One-line statement of how <j0> and <j2> enter f(Q) at the current Q.
  function showModel(opts,point){
    const box=$('magffModel'); if(!box) return;
    const n3=x=>Number(x).toFixed(3);
    box.textContent=`f(Q) = ⟨j0⟩ + c⟨j2⟩, c = ${Number(Number(opts.j2Weight).toFixed(4))}, ⟨j0⟩ = ${n3(point.j0)}, ⟨j2⟩ = ${n3(point.j2)}.`;
  }
  function setError(error){
    $('magffModel')?.replaceChildren();
    info.textContent=String(error?.message||error);
    info.classList.add('error');
  }
  function clearError(){info.textContent='';info.classList.remove('error');}
  function render(){
    clearError();download.disabled=true;
    syncIonSearchText();
    try{
      ensureConfigMatchesIon();
      const opts=currentOptions();
      const q=Number(qField.value);
      if(qField.value.trim()===''||!Number.isFinite(q)||q<0||q>GRAPH_Q_MAX)
        throw new Error(`Q must be between 0 and ${GRAPH_Q_MAX} Å⁻¹.`);
      const curve=grid.map(x=>computeMagneticFormFactor(ion.value,x,opts));
      const values=curve.map(point=>point.fSquared);
      if(values.some(v=>!Number.isFinite(v)))throw new Error('Cannot calculate form factor for this ion.');
      const {f,fSquared,j0,j2}=computeMagneticFormFactor(ion.value,q,opts);
      syncWeightField(opts.j2Weight);
      showModel(opts,{q,f,j0,j2});
      qSlider.value=String(q);
      intensityField.value=fmt(fSquared);
      if(fField)fField.value=fmt(f);
      exportRows=grid.map((x,i)=>[x,curve[i].f,values[i]]);
      download.disabled=false;
      if(window.Plotly && plot && !plot.closest('.hidden')){
        // f(Q) can turn negative at large Q; extend the axis below 0 only then.
        const fValues=curve.map(point=>point.f);
        const fMin=Math.min(0,...fValues);
        const yLow=fMin<-1e-6 ? Math.floor((fMin-0.02)*10)/10 : 0;
        const hover='Q = %{x:.3f} Å⁻¹<br>f(Q) = %{customdata[0]:.5f}<br>|f(Q)|² = %{customdata[1]:.5f}<extra></extra>';
        const both=curve.map(point=>[point.f,point.fSquared]);
        window.Plotly.react(plot,[
          {x:grid,y:values,customdata:both,type:'scatter',mode:'lines',name:'|f(Q)|²',
           line:{color:'#1f77b4',width:2.5},hovertemplate:hover},
          {x:grid,y:fValues,customdata:both,type:'scatter',mode:'lines',name:'f(Q)',
           line:{color:'#000000',width:2.5},hovertemplate:hover},
          {x:[q,q],y:[fSquared,f],customdata:[[f,fSquared],[f,fSquared]],type:'scatter',mode:'markers',name:'Selected Q',
           marker:{size:10,color:['#1f77b4','#000000']},hovertemplate:hover,showlegend:false}
        ],{autosize:true,margin:{l:65,r:22,t:18,b:57},
            xaxis:{title:'Q (Å⁻¹)',range:[0,GRAPH_Q_MAX],zeroline:false,showline:true,mirror:true,linecolor:'#586472',linewidth:1,tickfont:{size:20}},
            yaxis:{title:'f(Q), |f(Q)|²',range:[yLow,1],autorange:false,zeroline:yLow<0,zerolinecolor:'#b8c0c8',showline:true,mirror:true,linecolor:'#586472',linewidth:1,tickfont:{size:20}},
            showlegend:true,legend:{x:0.99,y:0.99,xanchor:'right',yanchor:'top',bgcolor:'rgba(255,255,255,0.85)',bordercolor:'#d5dde5',borderwidth:1,font:{size:18}},
            uirevision:`magff-v42-${yLow}`
        },{responsive:true,displaylogo:false});
      }
    }catch(error){
      exportRows=[];setError(error);
      if(window.Plotly&&plot&&!plot.closest('.hidden'))window.Plotly.purge(plot);
    }
  }
  // Find Q from an entered f(Q) (which='f') or |f(Q)|² (which='fSquared').
  function setQFromValue(raw,which){
    clearError();
    const name=which==='f'?'f(Q)':'|f(Q)|²';
    try{
      if(String(raw).trim()==='')throw new Error(`Enter ${name}.`);
      const target=Number(raw),opts=currentOptions();
      if(!Number.isFinite(target))throw new Error(`${name} must be a number.`);
      if(which!=='f'&&target<0)throw new Error('|f(Q)|² must be nonnegative.');
      const roots=magneticFormFactorRoots(ion.value,target,opts,GRAPH_Q_MAX,which);
      if(!roots.length)throw new Error('No Q in 0–10 Å⁻¹ gives that value.');
      // Empirical fits need not be monotonic: choose the Q closest to the current one.
      const previous=Number(qField.value);
      roots.sort((a,b)=>Math.abs(a-previous)-Math.abs(b-previous));
      qField.value=Number(roots[0].toFixed(4)).toString();
      render();
    }catch(error){setError(error);}
  }
  ion.addEventListener('change',()=>{syncConfig();render();});
  installIonSearch();
  // Searchable ion field.  Typing filters the list by the start of the ion
  // name ("N" -> Ni, Nb, Nd, Np; "ni2" -> Ni2+), kept in atomic-number order.
  function installIonSearch(){
    const search=$('magffIonSearch'),list=$('magffIonList');
    if(!search||!list)return;
    const norm=t=>String(t).replace(/\s+/g,'').toLowerCase();
    let items=[],active=-1;
    const isOpen=()=>!list.classList.contains('hidden');
    function close(){
      list.classList.add('hidden');search.setAttribute('aria-expanded','false');
      search.removeAttribute('aria-activedescendant');
    }
    function paint(){
      list.replaceChildren();
      if(!items.length){
        const empty=document.createElement('span');
        empty.className='magff-ion-empty';empty.textContent='No matching ion';
        list.append(empty);return;
      }
      items.forEach((label,i)=>{
        const option=document.createElement('span');
        option.className='magff-ion-option';option.id=`magffIonOpt-${i}`;
        option.setAttribute('role','option');
        option.setAttribute('aria-selected',String(i===active));
        option.textContent=displayIon(label);
        option.addEventListener('mousedown',event=>{event.preventDefault();choose(label);});
        list.append(option);
      });
      if(active>=0){
        search.setAttribute('aria-activedescendant',`magffIonOpt-${active}`);
        list.children[active]?.scrollIntoView({block:'nearest'});
      }
    }
    function open(query){
      const q=norm(query);
      items=q?ionNames.filter(label=>norm(displayIon(label)).startsWith(q)||norm(label).startsWith(q)):ionNames.slice();
      active=q?(items.length?0:-1):Math.max(0,items.indexOf(ion.value));
      list.classList.remove('hidden');search.setAttribute('aria-expanded','true');
      paint();
    }
    function choose(label){
      if(label && label!==ion.value){
        ion.value=label;
        ion.dispatchEvent(new Event('change',{bubbles:true}));
      }
      search.value=displayIon(ion.value);
      close();
      // Typing right after a choice starts a new search.
      if(document.activeElement===search)search.select();
    }
    search.addEventListener('focus',()=>{search.select();open('');});
    // Re-clicking the field after a choice: select its text (after the
    // browser has placed the caret) so typing starts a new search.
    search.addEventListener('click',()=>{if(!isOpen()){open('');setTimeout(()=>search.select(),0);}});
    search.addEventListener('input',()=>open(search.value));
    search.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        if(!isOpen()){open(search.value);return;}
        if(!items.length)return;
        active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
        paint();
      }else if(event.key==='Enter'){
        event.preventDefault();
        if(isOpen()&&items.length)choose(items[Math.max(0,active)]);
      }else if(event.key==='Escape'){
        if(isOpen()){event.preventDefault();close();search.value=displayIon(ion.value);}
      }
    });
    search.addEventListener('blur',()=>{close();search.value=displayIon(ion.value);});
    search.value=displayIon(ion.value);
  }
  function syncIonSearchText(){
    const search=$('magffIonSearch');
    if(search && document.activeElement!==search)search.value=displayIon(ion.value);
  }
  config.addEventListener('change',()=>{syncFreeIonAvailability();render();});
  // Switching to Custom keeps the value in use as the starting point.
  mode.addEventListener('change',()=>{syncFreeIonAvailability();render();});
  weight.addEventListener('input',render);
  qField.addEventListener('input',render);
  qSlider.addEventListener('input',()=>{qField.value=qSlider.value;render();});
  for(const [field,which] of [[intensityField,'fSquared'],[fField,'f']]){
    if(!field)continue;
    field.addEventListener('change',()=>setQFromValue(field.value,which));
    field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();field.blur();}});
  }
  download.addEventListener('click',()=>{
    if(!exportRows.length)return;
    const rows=['Q_A^-1,f(Q),abs_f(Q)^2',...exportRows.map(row=>row.map(v=>v.toPrecision(12)).join(','))];
    const blob=new Blob([rows.join('\n')+'\n'],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`magnetic_form_factor_${ion.value}.csv`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  syncConfig();render();
  // Restore the selected plot on the first visible frame after a page reload.
  // The Toolbox main tab is often initially hidden while saved UI state loads.
  const panel=$('toolboxPanel'),pane=$('toolboxFormFactorPane');
  let visibilityRedrawQueued=false;
  const redrawOnReveal=()=>{
    if(visibilityRedrawQueued || !panel || panel.classList.contains('hidden') || pane?.classList.contains('hidden'))return;
    visibilityRedrawQueued=true;
    requestAnimationFrame(()=>{visibilityRedrawQueued=false;render();});
  };
  if(panel && pane){
    const observer=new MutationObserver(redrawOnReveal);
    observer.observe(panel,{attributes:true,attributeFilter:['class']});
    observer.observe(pane,{attributes:true,attributeFilter:['class']});
  }
  return render;
}
