// Magnetic reflection table (calculation, sorting, CSV download).
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {buildMagneticMotif, explicitMagneticIonFactors, hklInParentCell, magneticBraggPeaks, magneticElementsOfMotif, parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';
import {availableMagneticIons} from '../../magnetic/magnetic-form-factor.js';
import {chargeBalancedOxidationStates, compositionOfSites, preferredOxidationState} from '../../magnetic/oxidation-states.js';

export function installMagneticReflectionsTable(ctx){
  const {deps:{
    $, compareHkl, currentInstrument, effectiveS2MaxAtEi, getSelectedCifStructure,
    getSelectedCifText, hklKey
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    calculateMagneticReflectionTable, initializeGeneratorTableOutsideClick,
    initializeMagneticReflections, refreshMagneticIonSelectors
  });
let lastMagneticMotif=null;
let lastMagneticRows=[];
let lastMagneticParentIndexing=null;
let magneticReflectionSort={key:'intensity',direction:'desc'};
function sortedMagneticReflections(rows){
  const {key,direction}=magneticReflectionSort;
  const factor=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const value=r=>Number(key==='formFactor'?r.formFactorSort:key==='intensity'?displayedIntensity(r):r[key]);
    const av=value(a),bv=value(b);
    return (av-bv)*factor || compareHkl(a.hkl,b.hkl);
  });
}
function updateMagneticSortHeaders(){
  for(const th of document.querySelectorAll('.magnetic-sortable-th')){
    const active=th.dataset.sortKey===magneticReflectionSort.key;
    const indicator=th.querySelector('.cif-sort-indicator');
    if(indicator)indicator.textContent=active?(magneticReflectionSort.direction==='asc'?'▲':'▼'):'';
    th.setAttribute('aria-sort',active?(magneticReflectionSort.direction==='asc'?'ascending':'descending'):'none');
  }
}
function setMagneticReflectionSort(key){
  if(magneticReflectionSort.key===key)magneticReflectionSort.direction=magneticReflectionSort.direction==='asc'?'desc':'asc';
  else magneticReflectionSort={key,direction:(key==='intensity'||key==='q')?'desc':'asc'};
  updateMagneticSortHeaders();
  renderMagneticReflectionRows();
}
let selectedMagneticReflectionKey='';
function clearMagneticReflectionRowSelection(){
  if(!selectedMagneticReflectionKey) return;
  selectedMagneticReflectionKey='';
  for(const row of document.querySelectorAll('#magneticReflectionRows tr.cif-reflection-selected')){
    row.classList.remove('cif-reflection-selected');
    row.setAttribute('aria-selected','false');
  }
}
function renderMagneticReflectionRows(){
  const body=$('magneticReflectionRows');if(!body)return;
  body.replaceChildren();
  const replication=lastMagneticParentIndexing?.replication || lastMagneticMotif?.replication || [1,1,1];
  const known=!!lastMagneticParentIndexing || lastMagneticMotif?.source!=='mCIF';
  const indexHeader=$('magneticReflectionIndexHeader');
  if(indexHeader) indexHeader.textContent=known?'HKL (parent cell)':'HKL (magnetic cell)';
  const rows=sortedMagneticReflections(lastMagneticRows).slice(0,3000);
  const available=new Set(rows.map(row=>hklKey(row.hkl)));
  if(!available.has(selectedMagneticReflectionKey)) selectedMagneticReflectionKey='';
  for(const row of rows){
    const key=hklKey(row.hkl);
    const indexHkl=known?hklInParentCell(row.hkl,replication):row.hkl;
    const tr=document.createElement('tr');
    tr.dataset.reflectionKey=key;
    tr.tabIndex=0;
    tr.classList.toggle('cif-reflection-selected',key===selectedMagneticReflectionKey);
    tr.setAttribute('aria-selected',String(key===selectedMagneticReflectionKey));
    const values=[`(${indexHkl.map(v=>Number(v.toFixed(8))).join(' ')})`,row.formFactor??'1',Number(displayedIntensity(row)).toFixed(7),Number(row.twoTheta).toFixed(4),Number(row.q).toFixed(5),Number(row.d).toFixed(5)];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}
    const toggle=()=>{
      selectedMagneticReflectionKey=selectedMagneticReflectionKey===key?'':key;
      renderMagneticReflectionRows();
      if(selectedMagneticReflectionKey){
        body.querySelector(`tr[data-reflection-key="${CSS.escape(selectedMagneticReflectionKey)}"]`)?.focus({preventScroll:true});
      }
    };
    tr.addEventListener('click',toggle);
    tr.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}
    });
    body.appendChild(tr);
  }
}

cifState.GENERATOR_REFLECTION_MODE_KEY='tas-simulator-generator-reflection-mode-v1';

// ---- Lorentz factor applied to the displayed |F_M|^2 ----
const LORENTZ_MODES={
  none:{label:'|F<sub>M</sub>|²',factor:()=>1},
  single:{label:'|F<sub>M</sub>|² / sin2θ',factor:tth=>1/Math.max(1e-6,Math.sin(tth*Math.PI/180))},
  powder:{label:'|F<sub>M</sub>|² / (sinθ sin2θ)',factor:tth=>1/Math.max(1e-6,Math.sin(tth*Math.PI/360)*Math.sin(tth*Math.PI/180))}
};
function lorentzMode(){ const v=$('magneticLorentzMode')?.value; return LORENTZ_MODES[v]?v:'none'; }
const lorentzFactor=row=>LORENTZ_MODES[lorentzMode()].factor(Number(row.twoTheta));
const displayedIntensity=row=>row.intensity*lorentzFactor(row);
function updateMagneticIntensityHeader(){
  const header=$('magneticIntensityHeader'); if(!header) return;
  const cell=lastMagneticMotif && !(!!lastMagneticParentIndexing || lastMagneticMotif.source!=='mCIF') ? 'magnetic' : 'parent';
  header.innerHTML=`${LORENTZ_MODES[lorentzMode()].label} per ${cell} cell (barn)`;
}

// ---- Magnetic-ion choice (form factor) per element that carries a spin ----
// 'auto' = oxidation state from the CIF, else charge balance, else the most
// common state. Choices are kept per loaded file only (not persisted).
const AUTO='auto';
let magneticIonChoice={},magneticIonChoiceFile='',lastAutoIons={};
const ionLabel=ion=>{ const m=String(ion).match(/^([A-Z][a-z]?)(\d+)$/); return m ? `${m[1]}${m[2]==='0'?' (neutral)':m[2]+'+'}` : ion; };
function ionsForElement(element){ return availableMagneticIons().filter(ion=>ion.replace(/\d+$/,'')===element); }
function autoMagneticIons(motif){
  const fromFile=explicitMagneticIonFactors(getSelectedCifText());
  const balanced=chargeBalancedOxidationStates(compositionOfSites(motif?.sites));
  const out={};
  for(const element of magneticElementsOfMotif(motif)){
    const ions=ionsForElement(element);
    const pick=(ox,how)=>ox!=null && ions.includes(`${element}${ox}`) ? {ion:`${element}${ox}`,how} : null;
    out[element]=(fromFile[element] && ions.includes(fromFile[element]) ? {ion:fromFile[element],how:'CIF'} : null)
      || pick(balanced?.[element],'charge balance')
      || pick(preferredOxidationState(element),'most common')
      || {ion:'',how:'unknown'};
  }
  return out;
}
function currentMagneticMotif(){ try{ return magneticModelFromEditor(); }catch(_e){ return null; } }
function refreshMagneticIonSelectors(motif=currentMagneticMotif()){
  const box=$('magneticIonSelectors'); if(!box) return;
  const text=String(getSelectedCifText()||'');
  const fileKey=`${text.length}:${text.slice(0,256)}:${text.slice(-256)}`;
  if(fileKey!==magneticIonChoiceFile){ magneticIonChoiceFile=fileKey; magneticIonChoice={}; }
  lastAutoIons=autoMagneticIons(motif);
  box.replaceChildren();
  for(const element of Object.keys(lastAutoIons)){
    const ions=ionsForElement(element),auto=lastAutoIons[element];
    const label=document.createElement('label');
    const caption=document.createElement('span');
    caption.textContent=`Form factor (${element})`;
    const select=document.createElement('select');
    select.dataset.element=element;
    select.dataset.noPersist='';
    select.id=`magneticIon-${element}`;
    select.title=`Magnetic form factor used for ${element}`;
    const options=[[AUTO,auto.ion?`Auto: ${ionLabel(auto.ion)} (${auto.how})`:'Auto: f = 1 (unknown)'],['','f(Q) = 1'],...ions.map(ion=>[ion,ionLabel(ion)])];
    for(const [value,text] of options){
      const option=document.createElement('option');
      option.value=value; option.textContent=text;
      select.appendChild(option);
    }
    const wanted=magneticIonChoice[element];
    select.value=(wanted==='' || ions.includes(wanted)) ? wanted : AUTO;
    select.addEventListener('change',()=>{
      magneticIonChoice[element]=select.value;
      if(cifState.magneticTableHasBeenCalculated) calculateMagneticReflectionTable();
    });
    label.append(caption,select);
    box.appendChild(label);
  }
}
function selectedMagneticIons(){
  const out={};
  for(const sel of document.querySelectorAll('#magneticIonSelectors select[data-element]')){
    const ion=sel.value===AUTO ? lastAutoIons[sel.dataset.element]?.ion : sel.value;
    if(ion) out[sel.dataset.element]=ion;
  }
  return out;
}
function magneticModelFromEditor(){
  // The generated CIF draft contains *nuclear* atom sites only and may take
  // precedence in the 3-D viewer. Never let that draft silently replace an
  // explicitly loaded magnetic CIF when computing magnetic intensities.
  const importedStructure=getSelectedCifStructure();
  const current=importedStructure?.magnetic
    ? importedStructure : fn.currentStructureForViewer()?.structure;
  if(!current) throw new Error('Load a CIF/mCIF before calculating magnetic Bragg reflections.');
  if(cifState.structureSpinEditingMode==='individual') throw new Error('Switch Spins Mode to linked Sites; per-atom manual supercell edits are not yet supported in this calculator.');
  const fromFile=!!current.magnetic && !cifState.importedMagneticEditMode;
  const selectedQ=fn.effectivePropagationVectorForStructure();
  const settings=new Map(cifState.structureMomentSettings);
  for(const [key,value] of fn.currentMomentSettings())settings.set(key,value);
  // For Source=mCIF, the parsed expanded atoms carry the actual magnetic
  // moments; the nuclear generator's zero-valued UI rows must not erase them.
  return buildMagneticMotif({structure:current,settings,
    q:[selectedQ.h,selectedQ.k,selectedQ.l],imported:fromFile,
    mode:cifState.structureMomentStructureType,axis:cifState.structureMomentRotationAxis,
    chirality:cifState.structureMomentChirality});
}
function calculateMagneticReflectionTable(){
  cifState.magneticTableHasBeenCalculated=true;
  const message=$('magneticReflectionMessage'),body=$('magneticReflectionRows');
  if(!body)return;
  body.replaceChildren();
  lastMagneticRows=[];lastMagneticMotif=null;lastMagneticParentIndexing=null;
  if($('magneticDownloadTable'))$('magneticDownloadTable').disabled=true;
  try{
    const motif=magneticModelFromEditor();
    const beam=fn.currentCifReflectionBeam();
    const filters=fn.currentCifReflectionFilters();
    let twoThetaMax=180;
    if(filters.withinS2Max){
      const inst=currentInstrument();
      twoThetaMax=Math.min(180,effectiveS2MaxAtEi(inst,beam.effectiveEnergy,beam.lambdaHalf));
    }
    refreshMagneticIonSelectors(motif);
    const ionByElement=selectedMagneticIons();
    const rows=magneticBraggPeaks(motif,beam.wavelength,{twoThetaMax,ionByElement});
    const spinCount=motif.sites.filter(site=>Math.hypot(...(site.moment||[0,0,0]))>1e-10).length;
    let diagnostic='';
    if(!rows.length){
      if(!spinCount) diagnostic=' No nonzero magnetic moments were found. Check Spins → Use and Source (mCIF / Modify).';
      else {
        const unrestricted=twoThetaMax<179.999 ? magneticBraggPeaks(motif,beam.wavelength,{twoThetaMax:180,ionByElement}) : [];
        if(unrestricted.length) diagnostic=` ${unrestricted.length} reflections exist without the instrument 2θ limit (current limit ${Number(twoThetaMax).toFixed(2)}°). Disable Within S2 Max or adjust the beam/instrument range.`;
        else diagnostic=' Nonzero moments exist, but no magnetic peaks pass the wavelength range/intensity threshold. Try shorter wavelength and verify the magnetic motif.';
      }
    }
    lastMagneticMotif=motif;
    // Only recover the parent reference for mCIFs written by this generator.
    // All structure factors remain evaluated in the actual magnetic cell.
    const fileText=getSelectedCifText();
    const fileQ=fn.propagationVectorsFromMcif(fileText,getSelectedCifStructure());
    const parentInfo=(motif.source==='mCIF' && fileQ.length===1)
      ? parentIndexingFromMcif(fileText,motif.lattice,[fileQ[0].h,fileQ[0].k,fileQ[0].l]) : null;
    lastMagneticParentIndexing=parentInfo;
    const displayRep=parentInfo?.replication || motif.replication;
    const parentKnown=!!parentInfo || motif.source!=='mCIF';
    // |F|^2 is evaluated in the magnetic cell, which contains N parent cells.
    // Bragg intensities scale as |F|^2/V^2, so |F_M|^2/N^2 is directly
    // comparable with the nuclear |F_N|^2 per parent cell. Without a known
    // parent cell, report per magnetic cell and say so.
    const nParent=parentKnown ? displayRep.reduce((a,b)=>a*b,1) : 1;
    lastMagneticRows=rows.map(row=>({...row,intensityMagneticCell:row.intensity,intensity:row.intensity/(nParent*nParent)}));
    updateMagneticIntensityHeader();
    renderMagneticReflectionRows();
    const cellDescription=parentInfo
      ? `Magnetic supercell ${displayRep.join('×')} relative to the parent cell (parent c=${Number(parentInfo.lattice.c).toFixed(4)} Å; magnetic c=${Number(motif.lattice.c).toFixed(4)} Å).`
      : motif.source==='mCIF'
        ? 'Magnetic cell is taken directly from the imported mCIF; parent-cell indexing is unknown.'
        : `Magnetic supercell ${displayRep.join('×')} relative to the input CIF cell.`;
    // Keep the validation note in the UI; only show this message for empty results or errors.
    message.textContent=rows.length ? '' : (diagnostic.trim() || 'No magnetic reflections were found in the selected range.');
    message.hidden=!message.textContent;
    $('magneticDownloadTable').disabled=!rows.length;
  }catch(err){
    message.textContent=err?.message||String(err);
    message.hidden=false;
  }
}
function downloadMagneticCsv(){
  if(!lastMagneticRows.length)return;
  const replication=lastMagneticParentIndexing?.replication || lastMagneticMotif?.replication || [1,1,1];
  const known=!!lastMagneticParentIndexing || lastMagneticMotif?.source!=='mCIF';
  const prefix=known?'parent':'magnetic';
  // Per parent cell (comparable with nuclear |F_N|^2) when the parent cell is
  // known, plus the raw per-magnetic-cell value; otherwise only the latter.
  const mode=lorentzMode(),withL=mode!=='none';
  const lCols=withL?`,lorentz_${mode==='single'?'1_over_sin2theta':'1_over_sintheta_sin2theta'},FM2_times_L_barn_per_${known?'parent':'magnetic'}_cell`:'';
  const lines=[`${prefix}_h,${prefix}_k,${prefix}_l,form_factor,${known?'FM2_barn_per_parent_cell,':''}FM2_barn_per_magnetic_cell,two_theta_deg,Q_inv_A,d_A${lCols}`,
    ...sortedMagneticReflections(lastMagneticRows).map(r=>[
      ...(known?hklInParentCell(r.hkl,replication):r.hkl),
      `"${String(r.formFactor??'1').replace(/"/g,'""')}"`,...(known?[r.intensity]:[]),r.intensityMagneticCell,r.twoTheta,r.q,r.d,
      ...(withL?[lorentzFactor(r),displayedIntensity(r)]:[])].join(','))];
  fn.downloadGeneratedCif(lines.join('\n'),'magnetic_reflections.csv');
}
function initializeGeneratorTableOutsideClick(){
  if(document.documentElement.dataset.cifTableOutsideClickBound) return;
  document.documentElement.dataset.cifTableOutsideClickBound='1';
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element ? event.target : event.target?.parentElement;
    if(!target) return;
    // Reflection row click handlers replace their <tr> during rendering. Use
    // the original propagation path, not closest(), so selection is not
    // instantly cleared when the clicked row is detached from the DOM.
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    if(!target.closest('#cifAtomRows .cif-atom-row, #mcifStructurePane, #mcifTabStructure')) fn.clearCifAtomRowSelection();
    if(!target.closest('#cifAtomColorRows .atoms-table-row, #mcifStructurePane, #mcifTabStructure'))fn.clearAppearanceRowSelection();
    if(!target.closest('#cifBondRows .structure-bond-row')) fn.clearStructureBondSelection();
    if(!target.closest('#cifMagMomentRows .structure-moment-row, #mcifStructurePane, #mcifTabStructure')) fn.clearSpinRowSelection();
    if(!path.some(node=>node?.id==='cifReflectionRows')) fn.clearCifReflectionRowSelection();
    if(!path.some(node=>node?.id==='magneticReflectionRows')) clearMagneticReflectionRowSelection();
  });
}
function initializeMagneticReflections(){
  const button=$('magneticCalculateTable');
  if(!button || button.dataset.bound)return;
  button.dataset.bound='1';
  button.addEventListener('click',calculateMagneticReflectionTable);
  $('magneticDownloadTable')?.addEventListener('click',downloadMagneticCsv);
  $('magneticLorentzMode')?.addEventListener('change',()=>{updateMagneticIntensityHeader();renderMagneticReflectionRows();});
  updateMagneticIntensityHeader();
  for(const th of document.querySelectorAll('.magnetic-sortable-th')){
    const activate=()=>setMagneticReflectionSort(th.dataset.sortKey);
    th.addEventListener('click',activate);
    th.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  }
  updateMagneticSortHeaders();
}
}
