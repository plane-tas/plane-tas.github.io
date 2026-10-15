// Magnetic Bragg reflections for the combined reflection table, and the
// per-element magnetic-ion (form factor) selectors.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {buildMagneticMotif, explicitMagneticIonFactors, hklInParentCell, magneticBraggPeaks, magneticElementsOfMotif, parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';
import {availableMagneticIons} from '../../magnetic/magnetic-form-factor.js';
import {chargeBalancedOxidationStates, compositionOfSites, preferredOxidationState} from '../../magnetic/oxidation-states.js';

export function installMagneticReflections(ctx){
  const {deps:{$, getSelectedCifStructure, getSelectedCifText}, state:cifState, fn}=ctx;
  Object.assign(fn,{
    computeMagneticReflections, initializeGeneratorTableOutsideClick, refreshMagneticIonSelectors
  });

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
    const options=[[AUTO,auto.ion?`Auto (${ionLabel(auto.ion)})`:'Auto (f = 1)'],['','f(Q) = 1'],...ions.map(ion=>[ion,ionLabel(ion)])];
    select.title=`Magnetic form factor for ${element}. Auto: ${auto.ion?`${ionLabel(auto.ion)} from ${auto.how}`:'oxidation state unknown, f = 1'}.`;
    for(const [value,text] of options){
      const option=document.createElement('option');
      option.value=value; option.textContent=text;
      select.appendChild(option);
    }
    const wanted=magneticIonChoice[element];
    select.value=(wanted==='' || ions.includes(wanted)) ? wanted : AUTO;
    select.addEventListener('change',()=>{
      magneticIonChoice[element]=select.value;
      fn.recalculateGeneratedReflections();
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
  if(!current) return null;
  if(cifState.structureSpinEditingMode==='individual') throw new Error('Magnetic reflections: switch Spins Mode to linked Sites; per-atom manual supercell edits are not yet supported.');
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

// Magnetic Bragg peaks for the current beam. Rows are indexed in the parent
// (crystallographic) cell when it is known, with |F_M|^2 per parent cell in
// barn (comparable with nuclear |F_N|^2); otherwise in the magnetic cell.
// Returns {rows, parentKnown, lattice, message}; rows=[] when no spin is set.
function computeMagneticReflections({wavelength,twoThetaMax=180}){
  const empty=(message='')=>({rows:[],parentKnown:true,lattice:null,message});
  let motif;
  try{ motif=magneticModelFromEditor(); }
  catch(err){ refreshMagneticIonSelectors(null); return empty(err?.message||String(err)); }
  refreshMagneticIonSelectors(motif);
  if(!motif) return empty();
  const spinCount=motif.sites.filter(site=>Math.hypot(...(site.moment||[0,0,0]))>1e-10).length;
  if(!spinCount) return empty();
  try{
    const ionByElement=selectedMagneticIons();
    const raw=magneticBraggPeaks(motif,wavelength,{twoThetaMax,ionByElement});
    let message=motif.ambiguousSites ? `Collinear: ${motif.ambiguousSites} magnetic atom(s) lie on a node of cos(2πk·r) (k·r ≈ 1/4 or 3/4), so their sign is arbitrary for this k. Check the 3-D structure; use Sinusoidal, another k, or Manual spins if it is not the intended structure.` : '';
    if(!raw.length){
      const unrestricted=twoThetaMax<179.999 ? magneticBraggPeaks(motif,wavelength,{twoThetaMax:180,ionByElement}) : [];
      message+=(message?' ':'')+(unrestricted.length
        ? `${unrestricted.length} magnetic reflections exist beyond the instrument 2θ limit (${Number(twoThetaMax).toFixed(2)}°).`
        : 'No magnetic reflections in the selected wavelength range.');
    }
    // Only recover the parent reference for mCIFs written by this generator.
    // All structure factors remain evaluated in the actual magnetic cell.
    const fileText=getSelectedCifText();
    const fileQ=fn.propagationVectorsFromMcif(fileText,getSelectedCifStructure());
    const parentInfo=(motif.source==='mCIF' && fileQ.length<=1)
      ? parentIndexingFromMcif(fileText,motif.lattice,fileQ.length?[fileQ[0].h,fileQ[0].k,fileQ[0].l]:null) : null;
    const replication=parentInfo?.replication || motif.replication;
    const parentKnown=!!parentInfo || motif.source!=='mCIF';
    // |F|^2 is evaluated in the magnetic cell, which contains N parent cells.
    // Bragg intensities scale as |F|^2/V^2, so |F_M|^2/N^2 is directly
    // comparable with the nuclear |F_N|^2 per parent cell.
    const nParent=parentKnown ? replication.reduce((a,b)=>a*b,1) : 1;
    const rows=raw.map(row=>({
      hkl:parentKnown ? hklInParentCell(row.hkl,replication) : row.hkl,
      fm2:row.intensity/(nParent*nParent),formFactor:row.formFactor,formFactorSort:row.formFactorSort,
      twoTheta:row.twoTheta,q:row.q,d:row.d}));
    return {rows,parentKnown,lattice:motif.lattice,message};
  }catch(err){
    return empty(err?.message||String(err));
  }
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
  });
}
}
