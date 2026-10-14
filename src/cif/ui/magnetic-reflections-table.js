// Magnetic reflection table (calculation, sorting, CSV/model download).
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {buildMagneticMotif, explicitMagneticIonFactors, hklInParentCell, magneticBraggPeaks, parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';

export function installMagneticReflectionsTable(ctx){
  const {deps:{
    $, compareHkl, currentInstrument, effectiveS2MaxAtEi, getSelectedCifStructure,
    getSelectedCifText, hklKey
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    calculateMagneticReflectionTable, initializeGeneratorTableOutsideClick,
    initializeMagneticReflections
  });
let lastMagneticMotif=null;
let lastMagneticRows=[];
let lastMagneticParentIndexing=null;
let magneticReflectionSort={key:'intensity',direction:'desc'};
function sortedMagneticReflections(rows){
  const {key,direction}=magneticReflectionSort;
  const factor=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const av=Number(key==='formFactor'?a.formFactorSort:a[key]);
    const bv=Number(key==='formFactor'?b.formFactorSort:b[key]);
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
    const values=[`(${indexHkl.map(v=>Number(v.toFixed(8))).join(' ')})`,row.formFactor??'1',Number(row.intensity).toFixed(7),Number(row.twoTheta).toFixed(4),Number(row.q).toFixed(5),Number(row.d).toFixed(5)];
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
  if($('magneticExportBnsInput'))$('magneticExportBnsInput').disabled=true;
  try{
    const motif=magneticModelFromEditor();
    const beam=fn.currentCifReflectionBeam();
    const filters=fn.currentCifReflectionFilters();
    let twoThetaMax=180;
    if(filters.withinS2Max){
      const inst=currentInstrument();
      twoThetaMax=Math.min(180,effectiveS2MaxAtEi(inst,beam.effectiveEnergy,beam.lambdaHalf));
    }
    const ionByElement=explicitMagneticIonFactors(getSelectedCifText());
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
    lastMagneticMotif=motif;lastMagneticRows=rows;
    // Only recover the parent reference for mCIFs written by this generator.
    // All structure factors remain evaluated in the actual magnetic cell.
    const fileText=getSelectedCifText();
    const fileQ=fn.propagationVectorsFromMcif(fileText,getSelectedCifStructure());
    const parentInfo=(motif.source==='mCIF' && fileQ.length===1)
      ? parentIndexingFromMcif(fileText,motif.lattice,[fileQ[0].h,fileQ[0].k,fileQ[0].l]) : null;
    lastMagneticParentIndexing=parentInfo;
    const displayRep=parentInfo?.replication || motif.replication;
    const parentKnown=!!parentInfo || motif.source!=='mCIF';
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
    $('magneticExportBnsInput').disabled=false;
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
  const lines=[`${prefix}_h,${prefix}_k,${prefix}_l,form_factor,FM2_barn,two_theta_deg,Q_inv_A,d_A`,
    ...sortedMagneticReflections(lastMagneticRows).map(r=>[
      ...(known?hklInParentCell(r.hkl,replication):r.hkl),
      `"${String(r.formFactor??'1').replace(/"/g,'""')}"`,r.intensity,r.twoTheta,r.q,r.d].join(','))];
  fn.downloadGeneratedCif(lines.join('\n'),'magnetic_reflections.csv');
}
function downloadBnsModel(){
  if(!lastMagneticMotif)return;
  const json=JSON.stringify({version:1,...lastMagneticMotif},null,2);
  fn.downloadGeneratedCif(json,'magnetic_model_for_bns.json');
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
  $('magneticExportBnsInput')?.addEventListener('click',downloadBnsModel);
  for(const th of document.querySelectorAll('.magnetic-sortable-th')){
    const activate=()=>setMagneticReflectionSort(th.dataset.sortKey);
    th.addEventListener('click',activate);
    th.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  }
  updateMagneticSortHeaders();
}
}
