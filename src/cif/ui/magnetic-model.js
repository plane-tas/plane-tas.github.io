// The ONE magnetic model of the current Structure editor state.
// The 3-D spin arrows, the magnetic reflections and the P1 mCIF export all
// read moments from here, so they can never describe different structures.
//
// Sources and their rules:
//   mCIF (as loaded)        moments of the expanded mCIF atoms (magnetic cell).
//   mCIF, Modify (linked)   edited asymmetric-site moments propagated through the
//                           FILE'S magnetic symmetry (moment loop rewritten and
//                           re-parsed). k / structure type do not apply: the mCIF
//                           already defines the magnetic cell and its symmetry.
//   mCIF, Manual            one moment per expanded mCIF atom (magnetic cell).
//   CIF + k (linked)        site moment x modulation(2*pi*k.r) in the k supercell.
//   CIF, Manual             one moment per atom of the k supercell.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {buildMagneticMotif, cartesianMoment, parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';

export function installMagneticModel(ctx){
  const {deps:{
    getSelectedCifStructure, getSelectedCifText, parseCifStructure
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{currentMagneticModel, editedMcifStructure, magneticMomentLookup});

const MAX_MODEL_ATOMS=3000;
const wrap=v=>{const w=v-Math.floor(v);return w>1-1e-9?0:w;};

// Rewrite the moment loop of the selected mCIF with the edited asymmetric-site
// moments and re-parse it, so the file's magnetic symmetry propagates them.
let editedCache={key:'',structure:null};
function editedMcifStructure(source,live=fn.currentMomentSettings()){
  const records=[];
  (source.asymmetricSites||[]).forEach((site,siteIndex)=>{
    if(!Array.isArray(site.magneticMoment) && !site.magneticFourier) return;
    const key=fn.momentKey({...site,siteIndex});
    const setting=live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(site,source);
    if(!setting.enabled) return;
    const v=fn.cartesianToMcifCrystalAxis(source.lattice,[Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0]);
    records.push(`${site.label} ${v.map(x=>Number(x.toFixed(8))).join(" ")} mx,my,mz`);
  });
  const text=getSelectedCifText();
  const key=`${text.length}:${text.slice(0,200)}|${records.join(';')}`;
  if(editedCache.key===key) return editedCache.structure;
  const structure=records.length ? parseCifStructure(fn.replaceMcifMoments(text,records)) : null;
  editedCache={key,structure};
  return structure;
}

// Parent (crystallographic) cell of the selected mCIF relative to its magnetic
// cell, or null when it is not explicitly known.
function mcifParentReplication(selected){
  const text=getSelectedCifText();
  const q=fn.propagationVectorsFromMcif(text,selected);
  if(q.length>1) return null;
  return parentIndexingFromMcif(text,selected.lattice,q.length?[q[0].h,q[0].k,q[0].l]:null)?.replication||null;
}

function siteFromAtom(atom,fract,moment){
  return {element:atom.element,occupancy:Number(atom.occupancy??1),
    Biso:Number(atom.Biso)||0,Uaniso:atom.Uaniso||null,
    fract:fract.map(wrap),moment,sourceLabel:atom.sourceLabel,sourceSiteIndex:atom.sourceSiteIndex};
}

function mcifModel(structure,selected){
  if(selected.incommensurateSingleQ || selected.atoms.some(atom=>atom.magneticFourier))
    throw new Error('Fourier-modulated mCIF requires a dedicated satellite structure-factor calculation (not implemented).');
  if(structure.atoms.length>MAX_MODEL_ATOMS) throw new Error(`Magnetic cell contains ${structure.atoms.length} atoms (limit ${MAX_MODEL_ATOMS}).`);
  const lattice=structure.lattice;
  let sites, source;
  if(fn.spinEditingIsIndividual(structure)){
    const live=fn.currentMomentSettings();
    sites=structure.atoms.map((atom,i)=>{
      const key=`individual:0,0,0:${i}`;
      const setting=live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(atom,structure);
      const moment=setting?.enabled ? [setting.mx,setting.my,setting.mz].map(v=>Number(v)||0) : [0,0,0];
      return siteFromAtom(atom,[atom.x,atom.y,atom.z],moment);
    });
    source='mCIF (manual spins)';
  }else{
    const model=cifState.importedMagneticEditMode ? editedMcifStructure(structure) : structure;
    // Same atom order as the file: match the re-parsed moments by position.
    const lookup=new Map();
    for(const atom of model?.atoms||[]) lookup.set(positionKey(atom.element,[atom.x,atom.y,atom.z]),atom.magneticMoment);
    sites=structure.atoms.map(atom=>{
      const m=cifState.importedMagneticEditMode ? lookup.get(positionKey(atom.element,[atom.x,atom.y,atom.z])) : atom.magneticMoment;
      return siteFromAtom(atom,[atom.x,atom.y,atom.z],Array.isArray(m)?cartesianMoment(m,lattice):[0,0,0]);
    });
    source=cifState.importedMagneticEditMode ? 'mCIF (modified site moments)' : 'mCIF';
  }
  const parentReplication=mcifParentReplication(selected);
  return {lattice,sites,replication:[1,1,1],parentReplication,source,ambiguousSites:0};
}

function nuclearCifModel(structure){
  const q=fn.effectivePropagationVectorForStructure();
  if(fn.spinEditingIsIndividual(structure)){
    const live=fn.currentMomentSettings();
    const candidates=fn.individualSpinCandidates(structure);
    const N=fn.individualSpinDimensions();
    if(candidates.length>MAX_MODEL_ATOMS) throw new Error(`Magnetic supercell would contain ${candidates.length} atoms (limit ${MAX_MODEL_ATOMS}).`);
    const sites=candidates.map(site=>{
      const setting=fn.resolveIndividualSpin(site,structure,live);
      const moment=setting?.enabled ? [setting.mx,setting.my,setting.mz].map(v=>Number(v)||0) : [0,0,0];
      return siteFromAtom(site,[site.x/N[0],site.y/N[1],site.z/N[2]],moment);
    });
    const lattice={...structure.lattice,a:structure.lattice.a*N[0],b:structure.lattice.b*N[1],c:structure.lattice.c*N[2]};
    return {lattice,sites,replication:N,parentReplication:N,source:'CIF (manual spins)',ambiguousSites:0};
  }
  const settings=new Map(cifState.structureMomentSettings);
  for(const [key,value] of fn.currentMomentSettings()) settings.set(key,value);
  const motif=buildMagneticMotif({structure,settings,q:[q.h,q.k,q.l],
    mode:cifState.structureMomentStructureType,axis:cifState.structureMomentRotationAxis,
    chirality:cifState.structureMomentChirality,maxAtoms:MAX_MODEL_ATOMS});
  return {...motif,sites:motif.sites.map(s=>({...s,fract:s.fract.map(wrap)})),
    parentReplication:motif.replication,source:'CIF + k'};
}

// Returns the model, or throws with a user-facing message.
function currentMagneticModel(){
  const selected=getSelectedCifStructure();
  const viewer=fn.currentStructureForViewer()?.structure||null;
  if(selected?.magnetic){
    // The viewer may carry an edited magnetic-cell metric for the same atoms.
    const structure=(viewer?.magnetic && viewer.asymmetricSites===selected.asymmetricSites) ? viewer : selected;
    return mcifModel(structure,selected);
  }
  if(!viewer?.atoms?.length) return null;
  return nuclearCifModel(viewer);
}

// Moment lookup by position for atoms of the displayed structure. Display
// coordinates are in the cell of the source structure (parent cell for a CIF,
// magnetic cell for an mCIF): divide by the model replication to reach the
// magnetic-cell coordinates of the model sites.
function positionKey(element,p,G=2000){
  return `${element}|${p.map(v=>Math.round(wrap(v)*G)%G).join(',')}`;
}
function magneticMomentLookup(model){
  const exact=new Map();
  for(const s of model?.sites||[]) exact.set(positionKey(s.element,s.fract),s.moment);
  const rep=model?.replication||[1,1,1];
  return (element,frac)=>{
    const f=frac.map((v,i)=>Number(v)/rep[i]);
    const hit=exact.get(positionKey(element,f));
    if(hit) return hit;
    // Rounding at a grid boundary: fall back to a tolerant search.
    const tol=2e-3/Math.max(...rep);
    const s=(model.sites||[]).find(site=>site.element===element &&
      site.fract.every((v,i)=>{const d=v-f[i];return Math.abs(d-Math.round(d))<tol;}));
    return s?.moment||null;
  };
}
}
