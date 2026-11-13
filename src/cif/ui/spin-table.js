// Magnetic moments: spin settings, Fourier/explicit moments and the Spins table.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {atomSiteKey, rationalApprox} from '../mcif-export.js';
import {modulatedMoment, symmetryPhaseShift} from '../../magnetic/magnetic-reflections.js';
import {incommensurateSettingFromMcifAtom} from '../../magnetic/incommensurate.js';

export function installSpinTable(ctx){
  const {deps:{
    $, PI
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    atomCrystalMoment, currentMomentSettings, defaultMomentSetting, individualSettingForAtom,
    individualSpinCandidates, individualSpinDimensions, initialIndividualSpin, magneticCandidateSites,
    mcifCrystalAxisToCartesian, momentKey, resolveIndividualSpin, spinEditingIsIndividual,
    spinTableFilteredSites, updateMagneticMomentRows,
    spinEditingIsIncommensurate, incommensurateSpinCandidates, defaultIncommensurateSetting,
    spinCandidates, initialSpinSetting, incommensurateSettingForAtom, fillIncommensurateHelix
  });

function magneticCandidateSites(structure){
  const sites=Array.isArray(structure?.asymmetricSites) ? structure.asymmetricSites : [];
  // Keep non-magnetic Se/O/etc. in the parsed 3D structure, but avoid
  // synthesising magnetic moments for them in an imported mCIF spin editor.
  const editable=sites.map((site,siteIndex)=>({...site,siteIndex})).filter(site=>
    !structure?.magnetic || Array.isArray(site.magneticMoment) || !!site.magneticFourier);
  const elementOrder=new Map(fn.structureElements(structure).map((element,index)=>[String(element),index]));
  return editable.sort((a,b)=>{
    const ea=elementOrder.get(String(a.element)) ?? Number.MAX_SAFE_INTEGER;
    const eb=elementOrder.get(String(b.element)) ?? Number.MAX_SAFE_INTEGER;
    if(ea!==eb) return ea-eb;
    const byLabel=fn.naturalStructureLabelCompare(a.label||a.element,b.label||b.element);
    return byLabel || a.siteIndex-b.siteIndex;
  });
}
function momentKey(site){ return `${site.siteIndex}:${site.label||site.element}`; }
// The key uses the atom's element and position in the cell, not a label (a CIF
// may have several symmetry-equivalent positions with the same source label)
// and not its index (the selected CIF and the Generator draft may list the
// same atoms in a different order).
const individualSpinKey=(ix,iy,iz,atom)=>`individual:${ix},${iy},${iz}:${atomSiteKey(atom)}`;
function individualSpinDimensions(){
  const q=fn.effectivePropagationVectorForStructure();
  return [q.h,q.k,q.l].map(v=>rationalApprox(v).d);
}
function individualSpinCandidates(structure){
  if(!Array.isArray(structure?.atoms)) return [];
  // mCIF parseCifStructure() ALREADY applied its magnetic operations,
  // centering, and time reversal. Do not expand it again using k denominators.
  const N=structure.magnetic?[1,1,1]:individualSpinDimensions();
  if(N.reduce((a,b)=>a*b,1)*structure.atoms.length>1200)
    throw new Error('Individual spin editor limit: 1200 atoms. Reduce k denominators or use linked sites.');
  const out=[];
  const labelCounts=new Map();
  for(let ix=0;ix<N[0];ix++)for(let iy=0;iy<N[1];iy++)for(let iz=0;iz<N[2];iz++)
    structure.atoms.forEach((atom,atomIndex)=>{
      if(structure.magnetic && !Array.isArray(atom.magneticMoment) && !atom.magneticFourier)return;
      const key=individualSpinKey(ix,iy,iz,atom);
      const parent=structure.asymmetricSites?.[atom.sourceSiteIndex]||atom;
      const pos=[atom.x+ix,atom.y+iy,atom.z+iz];
      const label=String(atom.sourceLabel||atom.element);
      const count=(labelCounts.get(label)||0)+1;
      labelCounts.set(label,count);
      out.push({...atom,siteIndex:atom.sourceSiteIndex,
        label:`${label} #${count}`,
        x:pos[0],y:pos[1],z:pos[2],individualKey:key,
        parentSite:parent,individualIndex:atomIndex,individualCell:[ix,iy,iz]});
    });
  return out;
}
function spinEditingIsIndividual(structure){return cifState.structureSpinEditingMode==='individual' && !!structure && !spinEditingIsIncommensurate(structure);}
// Incommensurate structure type (nuclear CIF only): one row per atom of the
// nuclear cell with M1, M2 (crystal-axis components, mu_B) and a phase (deg),
// as in Fcal-n: M(r) = M1 cos(2 pi q.r - phi) + M2 sin(2 pi q.r - phi).
// Also an incommensurate mCIF once its moments are edited (structure type
// Incommensurate chosen): the rows start from the file's Fourier components.
function spinEditingIsIncommensurate(structure){
  if(cifState.structureMomentStructureType!=='incommensurate' || !structure) return false;
  if(!structure.magnetic) return true;
  return !!structure.incommensurateSingleQ && !!cifState.importedMagneticEditMode;
}
const incommensurateSpinKey=atom=>`icm:${atomSiteKey(atom)}`;
function incommensurateSpinCandidates(structure){
  if(!Array.isArray(structure?.atoms)) return [];
  if(structure.atoms.length>1200) throw new Error('Incommensurate spin editor limit: 1200 atoms in the cell.');
  const labelCounts=new Map();
  // An mCIF lists its magnetic atoms only (as in the other mCIF editors).
  const atoms=structure.magnetic ? structure.atoms.filter(atom=>atom.magneticFourier||Array.isArray(atom.magneticMoment)) : structure.atoms;
  return atoms.map(atom=>{
    const atomIndex=structure.atoms.indexOf(atom);
    const label=String(atom.sourceLabel||atom.element);
    const count=(labelCounts.get(label)||0)+1;
    labelCounts.set(label,count);
    return {...atom,siteIndex:atom.sourceSiteIndex,label:`${label} #${count}`,
      individualKey:incommensurateSpinKey(atom),individualIndex:atomIndex,icm:true};
  });
}
function defaultIncommensurateSetting(site){
  // mCIF atoms start from the file (converted to M1, M2, phi; uniform part M0 kept).
  const fromFile=(site?.magneticFourier||Array.isArray(site?.magneticMoment)) ? {enabled:true,...incommensurateSettingFromMcifAtom(site)} : null;
  return {enabled:false,m1:[0,0,0],m2:[0,0,0],phase:0,...(fromFile||{}),
    size:1,width:10,headSize:0.51,color:fn.elementColor(site.element),colorCustomized:false};
}
// Setting of a nuclear-cell (or displayed) atom in the Incommensurate type.
function incommensurateSettingForAtom(atom,settings=currentMomentSettings()){
  const key=incommensurateSpinKey(atom);
  return settings.get(key)||cifState.structureMomentSettings.get(key)||defaultIncommensurateSetting(atom);
}
// Fill helix (Incommensurate draft): M1 and M2 of equal size, perpendicular to
// the Rotation axis and to each other, turning with the selected Chirality —
// the same sense as the commensurate Helical type (CCW: M2 = -u x M1, CW:
// M2 = +u x M1, u the unit vector of the axis). An existing M1 keeps its
// component perpendicular to the axis; otherwise M1 starts along b (axis a),
// c (axis b) or a (axis c) with the size of the row's moment, or 1 mu_B.
// Reference row: the selected row (the anchor of a multiple selection), else
// the row edited last. With a reference, its helix (M1 perpendicular to the
// axis and the matching M2) is copied to every target row; without one, each
// row keeps its own M1. Targets: the enabled displayed rows, or all displayed
// rows when none is enabled, plus the reference row. Phases are not changed.
function fillIncommensurateHelix(){
  const structure=fn.currentStructureForViewer()?.structure||null;
  if(!spinEditingIsIncommensurate(structure)) return;
  const basis=fn.directLatticeBasis(structure.lattice);
  if(!basis) return;
  const live=currentMomentSettings();
  for(const [key,value] of live) cifState.structureMomentSettings.set(key,value);
  const sites=spinTableFilteredSites(incommensurateSpinCandidates(structure));
  const settingOf=site=>({...defaultIncommensurateSetting(site),...(cifState.structureMomentSettings.get(site.individualKey)||{})});
  let targets=sites.filter(site=>settingOf(site).enabled);
  if(!targets.length) targets=sites;
  const selected=[...cifState.selectedSpinRowKeys];
  const referenceKey=(selected.includes(cifState.spinSelectionAnchorKey)?cifState.spinSelectionAnchorKey:selected[0])
    || cifState.lastEditedIncommensurateKey;
  const reference=sites.find(site=>site.individualKey===referenceKey)||null;
  if(reference && !targets.includes(reference)) targets=[...targets,reference];
  const axisKey=["a","b","c"].includes(cifState.structureMomentRotationAxis)?cifState.structureMomentRotationAxis:"c";
  const u=fn.vecNormalize(basis[axisKey]);
  const start=fn.vecNormalize(basis[{a:"b",b:"c",c:"a"}[axisKey]]);
  const perp=v=>fn.vecSub(v,fn.vecScale(u,fn.vecDot(u,v)));
  const sign=cifState.structureMomentChirality==="CW"?1:-1;
  const referenceSetting=reference?settingOf(reference):null;
  for(const site of targets){
    const setting=settingOf(site);
    const source=referenceSetting||setting;
    const m1=mcifCrystalAxisToCartesian(basis,source.m1||[0,0,0]);
    const m2=mcifCrystalAxisToCartesian(basis,source.m2||[0,0,0]);
    let v=perp(m1);
    if(!(fn.vecNorm(v)>1e-9)){
      const size=Math.max(fn.vecNorm(m1),fn.vecNorm(m2))||1;
      v=fn.vecScale(fn.vecNormalize(perp(start)),size);
    }
    const w=fn.vecScale(fn.vecCross(u,v),sign);
    const crystal=c=>fn.cartesianToMcifCrystalAxis(structure.lattice,c).map(x=>Math.abs(x)<1e-12?0:Number(x.toPrecision(12)));
    cifState.structureMomentSettings.set(site.individualKey,{...setting,enabled:true,m1:crystal(v),m2:crystal(w)});
  }
  $("cifMagMomentRows")?.replaceChildren();
  updateMagneticMomentRows(structure);
  fn.invalidateGeneratedMcif?.();
  fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
}
// Rows of the Spins table for the current mode, and their initial settings.
function spinCandidates(structure){
  if(spinEditingIsIncommensurate(structure)) return incommensurateSpinCandidates(structure);
  return spinEditingIsIndividual(structure)?individualSpinCandidates(structure):magneticCandidateSites(structure);
}
function initialSpinSetting(site,structure){
  if(site.icm) return defaultIncommensurateSetting(site);
  return site.individualKey?initialIndividualSpin(site,structure):defaultMomentSetting(site,structure);
}
function initialIndividualSpin(site,structure){
  // Imported mCIF sites have already been individually transformed by the
  // magnetic symmetry group. Show their *actual* dipoles, not repetitions of
  // the asymmetric site's moment, and do not run synthetic k-phase rotations.
  if(structure?.magnetic){
    return defaultMomentSetting(site,structure);
  }
  const base=site.parentSite||site;
  const key=momentKey({...base,siteIndex:site.siteIndex});
  const parent={...defaultMomentSetting(base,structure),...(cifState.structureMomentSettings.get(key)||{})};
  if(!parent.enabled)return parent;
  const q=fn.effectivePropagationVectorForStructure();
  const approx=[q.h,q.k,q.l].map(v=>rationalApprox(v));
  const vec=[parent.mx,parent.my,parent.mz];
  // Single-k phase of this supercell site (see symmetryPhaseShift).
  const atom=structure.atoms?.[site.individualIndex];
  const T=symmetryPhaseShift(atom);
  const kL=[site.x,site.y,site.z].reduce((sum,v,i)=>sum+(Number(v)+T[i])*approx[i].n/approx[i].d,0);
  const b=fn.directLatticeBasis(structure.lattice);
  const result=modulatedMoment(vec,kL,{mode:cifState.structureMomentStructureType,
    axis:fn.structureMomentRotationAxisVector(b),chirality:cifState.structureMomentChirality});
  return {...parent,mx:result[0],my:result[1],mz:result[2]};
}

function individualSettingForAtom(atom,structure,settings){
  const N=individualSpinDimensions();
  const cell=atom.cell||[0,0,0];
  const component=(v,i)=>((Math.round(v)%N[i])+N[i])%N[i];
  const base=structure.atoms?.[atom.expandedAtomIndex];
  if(!base)return null;
  const key=individualSpinKey(...cell.map(component),base);
  const stored=settings.get(key)||cifState.structureMomentSettings.get(key);
  if(stored)return stored;
  const parent=structure.asymmetricSites?.[base.sourceSiteIndex]||base;
  return initialIndividualSpin({...base,x:atom.phaseX,y:atom.phaseY,z:atom.phaseZ,
    siteIndex:base.sourceSiteIndex,parentSite:parent,individualIndex:atom.expandedAtomIndex},structure);
}

// mCIF crystalaxis values are components along unit crystallographic
// directions, not fractional atomic coordinates. Never multiply moments
// by lattice lengths a, b, c (in Angstrom).
function mcifCrystalAxisToCartesian(basis,m){
  if(!basis || !Array.isArray(m)) return m?.slice()||[0,0,0];
  const ua=fn.vecNormalize(basis.a),ub=fn.vecNormalize(basis.b),uc=fn.vecNormalize(basis.c);
  return fn.vecAdd(fn.vecAdd(fn.vecScale(ua,m[0]),fn.vecScale(ub,m[1])),fn.vecScale(uc,m[2]));
}

function evaluateFourierCrystalMoment(model,phase){
  if(!model) return [0,0,0];
  const cosVec=Array.isArray(model.cos)?model.cos:[0,0,0];
  const sinVec=Array.isArray(model.sin)?model.sin:[0,0,0];
  const arg=2*PI*((Number(model.phaseSign)||1)*phase + (Number(model.phaseShift)||0));
  let out=[0,0,0].map((_,i)=>(Number(cosVec[i])||0)*Math.cos(arg) + (Number(sinVec[i])||0)*Math.sin(arg));
  if(Array.isArray(model.transformR)){
    const factor=Number.isFinite(Number(model.transformFactor)) ? Number(model.transformFactor) : 1;
    out=model.transformR.map(row=>factor*row.reduce((sum,x,j)=>sum+x*out[j],0));
  }
  return out;
}
function representativeCrystalMoment(site){
  const base=Array.isArray(site?.magneticMoment)?site.magneticMoment.slice():[0,0,0];
  if(site?.magneticFourier){
    const mod=evaluateFourierCrystalMoment({...site.magneticFourier,phaseSign:1,phaseShift:0},0);
    return base.map((v,i)=>v+(mod[i]||0));
  }
  return base;
}
function atomCrystalMoment(atom,frac){
  const base=Array.isArray(atom?.magneticMoment)?atom.magneticMoment.slice():[0,0,0];
  if(atom?.magneticFourier){
    const q=atom.magneticFourier.q||[0,0,0];
    const phase=(Number(q[0])||0)*(Number(frac[0])||0) + (Number(q[1])||0)*(Number(frac[1])||0) + (Number(q[2])||0)*(Number(frac[2])||0);
    const mod=evaluateFourierCrystalMoment(atom.magneticFourier,phase);
    return base.map((v,i)=>v+(mod[i]||0));
  }
  return base;
}
function defaultMomentSetting(site,structure=null){
  const hasMoment=Array.isArray(site.magneticMoment);
  const hasFourier=!!site?.magneticFourier;
  // Sunny uses the mCIF cell matrix to turn crystalaxis components into
  // Cartesian magnetic moments; do not show unconverted components as XYZ.
  const basis=fn.directLatticeBasis(structure?.lattice);
  const representative=representativeCrystalMoment(site);
  const cart=(hasMoment||hasFourier)&&basis ? mcifCrystalAxisToCartesian(basis,representative) : null;
  const isMcif=structure?.magnetic===true;
  // All undefined moments begin at zero, independent of element or file type.
  // Preserve physical moments explicitly supplied by an mCIF. Editing the
  // Cartesian or Polar fields can create a nonzero moment later.
  return {enabled:isMcif && (hasMoment || hasFourier),
    mx:cart?.[0]??0,my:cart?.[1]??0,mz:cart?.[2]??0,
    size:1,width:10,headSize:0.51,color:fn.elementColor(site.element),colorCustomized:false};
}
// Spins "a, b, c" direction: Cartesian moment <-> components along unit vectors
// parallel to a, b, c of the displayed structure (as mCIF crystalaxis values).
function viewerLattice(structure){ return (structure||fn.currentStructureForViewer?.()?.structure)?.lattice||null; }
function crystalComponentsOf(cart,structure){
  const lattice=viewerLattice(structure);
  try{ return lattice ? fn.cartesianToMcifCrystalAxis(lattice,cart.map(v=>Number(v)||0)) : cart.slice(); }catch(_e){ return cart.slice(); }
}
function cartesianFromCrystal(crystal){
  const basis=fn.directLatticeBasis(viewerLattice());
  return basis ? mcifCrystalAxisToCartesian(basis,crystal) : crystal.slice();
}
// Four significant digits are for display only; never round stored vectors.
function formatSpinValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return "0";
  if(Math.abs(n)<1e-12) return "0";
  return String(Number(n.toPrecision(4)));
}
function currentMomentSettings(){
  const rows=[...document.querySelectorAll("#cifMagMomentRows .structure-moment-row")];
  const out=new Map();
  for(const row of rows){
    const key=row.dataset.momentKey;
    if(!key) continue;
    const fallback=cifState.structureMomentSettings.get(key)||{};
    let mx=Number(fallback.mx)||0, my=Number(fallback.my)||0, mz=Number(fallback.mz);
    if(!Number.isFinite(mz)) mz=0;
    const readEditedNumber=(field)=>{
      const input=row.querySelector(`[data-moment-field="${field}"]`);
      if(!input) return null;
      const shown=String(input.value);
      const precise=Number(input.dataset.fullPrecision);
      return shown===input.dataset.displayValue && Number.isFinite(precise) ? precise : Number(shown);
    };
    if(row.querySelector('[data-moment-field="m1a"]')){
      const read=(field,fallbackValue)=>{ const v=readEditedNumber(field); return Number.isFinite(v)?v:fallbackValue; };
      const f1=Array.isArray(fallback.m1)?fallback.m1:[0,0,0], f2=Array.isArray(fallback.m2)?fallback.m2:[0,0,0];
      out.set(key,{
        enabled:!!row.querySelector('[data-moment-field="enabled"]')?.checked,
        m1:['a','b','c'].map((axis,i)=>read(`m1${axis}`,Number(f1[i])||0)),
        m2:['a','b','c'].map((axis,i)=>read(`m2${axis}`,Number(f2[i])||0)),
        phase:read('phase',Number(fallback.phase)||0),
        m0:(()=>{ try{ const v=JSON.parse(row.dataset.momentM0||'null'); return Array.isArray(v)?v:(fallback.m0||[0,0,0]); }catch(_e){ return fallback.m0||[0,0,0]; } })(),
        size:cifState.structureMomentGlobalLength,
        width:cifState.structureMomentGlobalWidth,headSize:cifState.structureMomentGlobalHeadSize,
        color:row.querySelector('[data-moment-field="color"]')?.value || row.dataset.momentColor || fn.elementColor(row.dataset.momentElement),
        colorCustomized:row.dataset.momentColorCustom==="1"
      });
      continue;
    }
    const thetaInput=row.querySelector('[data-moment-field="theta"]');
    const phiInput=row.querySelector('[data-moment-field="phi"]');
    if(thetaInput || phiInput){
      const magnitudeInput=row.querySelector('[data-moment-field="moment"]');
      const untouched=[thetaInput,phiInput,magnitudeInput].every(input=>input && input.value===input.dataset.displayValue);
      if(!untouched){
        const theta=readEditedNumber("theta"), phi=readEditedNumber("phi"), magnitude=readEditedNumber("moment");
        if([theta,phi,magnitude].every(Number.isFinite) && magnitude>=0) [mx,my,mz]=fn.vecScale(fn.directionFromPolar(theta,phi),magnitude);
      }
    }else{
      // Inputs are components along a, b, c; unchanged rows keep their stored Cartesian vector.
      const inputs=["mx","my","mz"].map(field=>row.querySelector(`[data-moment-field="${field}"]`));
      if(inputs.every(Boolean) && !inputs.every(input=>input.value===input.dataset.displayValue)){
        const crystal=["mx","my","mz"].map(readEditedNumber);
        if(crystal.every(Number.isFinite)) [mx,my,mz]=cartesianFromCrystal(crystal);
      }
    }
    out.set(key,{
      enabled:!!row.querySelector('[data-moment-field="enabled"]')?.checked,
      mx,my,mz,size:cifState.structureMomentGlobalLength,
      width:cifState.structureMomentGlobalWidth,headSize:cifState.structureMomentGlobalHeadSize,
      color:row.querySelector('[data-moment-field="color"]')?.value || row.dataset.momentColor || fn.elementColor(row.dataset.momentElement),
      colorCustomized:row.dataset.momentColorCustom==="1"
    });
  }
  return out;
}
// Element selection only controls which rows are shown. Hidden rows retain their settings.
function refreshSpinTableToolbar(structure,candidates=null){
  const elements=structure?.magnetic && Array.isArray(candidates)
    ? [...new Set(candidates.map(site=>String(site.element)).filter(Boolean))]
    : fn.structureElements(structure);
  const select=$("cifSpinTableElement");
  if(!elements.includes(cifState.structureSpinTableElement) && cifState.structureSpinTableElement!=="*")
    cifState.structureSpinTableElement="*";
  if(!select)return;
  select.replaceChildren();
  const add=(value,label)=>{
    const option=document.createElement("option");
    option.value=value;option.textContent=label;select.appendChild(option);
  };
  add("*","All elements");
  for(const element of elements)add(element,element);
  select.value=cifState.structureSpinTableElement;
}
function spinTableFilteredSites(sites){
  if(cifState.structureSpinTableElement==="*")return sites;
  return sites.filter(site=>String(site.element)===cifState.structureSpinTableElement);
}
function resolveIndividualSpin(site,structure,live){
  return live.get(site.individualKey)||cifState.structureMomentSettings.get(site.individualKey)||initialIndividualSpin(site,structure);
}
function updateMagneticMomentRows(structure){
  const host=$("cifMagMomentRows");
  if(!host) return;
  const live=currentMomentSettings();
  for(const [key,value] of live) cifState.structureMomentSettings.set(key,value);
  host.replaceChildren();
  // Column headings follow Direction (or the Incommensurate type) even when no structure is loaded.
  const icm=spinEditingIsIncommensurate(structure);
  { const polarMode=cifState.structureMomentDirectionMode==="polar";
    const headings=icm?["M1a","M1b","M1c"]:polarMode?["θ (°)","φ (°)","μ (μB)"]:["Ma (μB)","Mb (μB)","Mc (μB)"];
    const titles=icm?["cos component along a (μB)","cos component along b (μB)","cos component along c (μB)"]
      :polarMode?["Polar angle from z (⊥ ab plane, ∥ c*)","Azimuth in the ab plane from a toward b","Moment size (μB)"]
      :["Component along a (unit vector ∥ a, μB)","Component along b (unit vector ∥ b, μB)","Component along c (unit vector ∥ c, μB)"];
    for(const [i,name] of ["X","Y","Z"].entries()){ const cell=$("cifSpinHeader"+name); if(cell){ cell.textContent=headings[i]; cell.title=titles[i]; } }
    const note=$("cifSpinDirectionNote");
    if(note){
      note.textContent=icm?"":polarMode
        ?"Polar: (θ, φ) = (0, 0) is parallel to c (to c* when α or β ≠ 90°) and (90, 0) to a; φ turns from a toward b."
        :"a, b, c: components along unit vectors parallel to a, b and c (μB), as in mCIF. They are not orthogonal in a non-orthogonal cell.";
      note.hidden=!note.textContent;
    }
    for(const id of ["cifSpinHeaderM2a","cifSpinHeaderM2b","cifSpinHeaderM2c","cifSpinHeaderPhase"]){ const cell=$(id); if(cell) cell.hidden=!icm; }
    $("cifSpinTable")?.classList.toggle("structure-spin-table-icm",icm); }
  cifState.visibleSpinSelectionSites.clear();
  let allSites=[];
  try{allSites=spinCandidates(structure);}
  catch(err){const notice=$("cifSpinIndividualInfo");if(notice){notice.hidden=false;notice.textContent=err.message;}fn.syncSpinTableBulkCheckbox(structure,[]);return;}
  const notice=$("cifSpinIndividualInfo");
  if(notice){notice.hidden=true;notice.textContent="";}
  refreshSpinTableToolbar(structure,allSites);
  const polar=cifState.structureMomentDirectionMode==="polar";
  const sites=spinTableFilteredSites(allSites);
  const displayedKeys=new Set(sites.map(site=>site.individualKey||momentKey(site)));
  for(const key of [...cifState.selectedSpinRowKeys]) if(!displayedKeys.has(key))cifState.selectedSpinRowKeys.delete(key);
  if(cifState.spinSelectionAnchorKey && !displayedKeys.has(cifState.spinSelectionAnchorKey))cifState.spinSelectionAnchorKey=null;
  const siteIndices=new Map(allSites.map((site,index)=>[site.individualKey||momentKey(site),index+1]));
  if(!sites.length){
    const div=document.createElement("div"); div.className="structure-spin-table-empty";
    div.textContent=allSites.length ? "No atoms match the selected element." : "No atomic sites were found.";
    host.appendChild(div);
    fn.syncSpinTableBulkCheckbox(structure,allSites);
    return;
  }
  for(const site of sites){
    const key=site.individualKey||momentKey(site);
    cifState.visibleSpinSelectionSites.set(key,site);
    const saved=cifState.structureMomentSettings.get(key)||{};
    const setting={...initialSpinSetting(site,structure),...saved};
    // mCIF XYZ values are physical Cartesian moments, not fractional positions.
    if(!setting.colorCustomized && !saved.colorCustomized) setting.color=fn.elementColor(site.element);
    const row=document.createElement("div");
    row.className="structure-moment-row";
    row.setAttribute("role","row");
    row.dataset.momentKey=key;
    row.setAttribute("aria-selected",String(cifState.selectedSpinRowKeys.has(key)));
    row.classList.toggle("spin-row-selected",cifState.selectedSpinRowKeys.has(key));
    row.addEventListener("click",event=>fn.selectSpinMomentRow(key,event));
    row.dataset.momentElement=String(site.element||"");
    row.dataset.momentColorCustom=setting.colorCustomized?"1":"0";
    row.dataset.momentColor=setting.color;
    const makeCell=(kind,child)=>{
      const cell=document.createElement("div");
      cell.className=`structure-spin-cell structure-spin-${kind}`;
      cell.setAttribute("role","cell");
      if(child!==undefined){
        if(typeof child==="string") cell.textContent=child;
        else cell.appendChild(child);
      }
      return cell;
    };
    const indexCell=makeCell("index",String(siteIndices.get(key)||""));
    const enabled=document.createElement("input");
    enabled.type="checkbox";
    enabled.checked=!!setting.enabled;
    enabled.dataset.momentField="enabled";
    enabled.title=`Enable spin for ${site.label||site.element}`;
    enabled.setAttribute("aria-label",enabled.title);
    const useCell=makeCell("use",enabled);
    const siteLabel=document.createElement("span");
    siteLabel.className="structure-moment-site";
    siteLabel.textContent=fn.structureSiteDisplayLabels(structure)?.get(String(site.label))||site.label||site.element;
    siteLabel.title=`${site.element} @ (${Number(site.x).toFixed(5)}, ${Number(site.y).toFixed(5)}, ${Number(site.z).toFixed(5)})`;
    const atomCell=makeCell("atom",siteLabel);
    const momentInputs=[];
    const fieldCells=[];
    if(icm){
      const m1=Array.isArray(setting.m1)?setting.m1:[0,0,0], m2=Array.isArray(setting.m2)?setting.m2:[0,0,0];
      if(Array.isArray(setting.m0)) row.dataset.momentM0=JSON.stringify(setting.m0);
      const fields=[...['a','b','c'].map((axis,i)=>[`m1${axis}`,`M1 (cos) component along ${axis} (μB)`,m1[i]]),
        ...['a','b','c'].map((axis,i)=>[`m2${axis}`,`M2 (sin) component along ${axis} (μB)`,m2[i]]),
        ['phase','Phase φ (degrees)',Number(setting.phase)||0]];
      for(const [field,title,value] of fields){
        const input=document.createElement("input");
        input.type="number"; input.step=field==="phase"?"1":"0.01";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(Number(value)||0);
        input.dataset.momentField=field;input.title=title;input.setAttribute("aria-label",`${site.label||site.element}: ${title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }else if(polar){
      const angles=fn.directionToPolar([setting.mx,setting.my,setting.mz]);
      for(const [field,title,value] of [["theta","Polar angle from +z (degrees)",angles.theta],["phi","Azimuth from +x toward +y (degrees)",angles.phi],["moment","Physical magnetic moment magnitude (μB)",fn.vecNorm([setting.mx,setting.my,setting.mz])]]){
        const input=document.createElement("input");
        input.type="number"; input.step=field==="moment"?"0.01":"1"; if(field==="moment") input.min="0";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;input.title=title;input.setAttribute("aria-label",`${site.label||site.element}: ${title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }else{
      // Components along unit vectors parallel to a, b, c (stored as Cartesian).
      const crystal=crystalComponentsOf([setting.mx,setting.my,setting.mz],structure);
      for(const [i,[field,value]] of [["mx",crystal[0]],["my",crystal[1]],["mz",crystal[2]]].entries()){
        const input=document.createElement("input");
        input.type="number";input.step="0.01";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;
        input.title=`Moment component along ${["a","b","c"][i]} (unit vector ∥ ${["a","b","c"][i]}, μB)`;
        input.setAttribute("aria-label",`${site.label||site.element}: ${input.title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }
    const picker=fn.makeMomentColorPicker(setting.color,color=>{
      row.dataset.momentColorCustom="1";
      row.dataset.momentColor=color;
      const cur=currentMomentSettings().get(key)||setting;
      cur.color=color;cur.colorCustomized=true;
      cifState.structureMomentSettings.set(key,cur);
      fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
    });
    picker.title=`Spin color palette for ${site.label||site.element}`;
    picker.setAttribute("aria-label",picker.title);
    const colorCell=makeCell("color",picker);
    const commit=()=>{
      fn.activateImportedMagneticEditing();
      const cur=currentMomentSettings().get(key);
      if(cur) cifState.structureMomentSettings.set(key,cur);
      fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
    };
    enabled.addEventListener("change",()=>{
      commit();fn.syncSpinTableBulkCheckbox(structure,allSites);
    });
    for(const input of momentInputs){
      const autoEnable=()=>{
        if(icm) cifState.lastEditedIncommensurateKey=key;
        if(!enabled.checked) enabled.checked=true;
        commit();fn.syncSpinTableBulkCheckbox(structure,allSites);
      };
      input.addEventListener("input",autoEnable);
      input.addEventListener("change",autoEnable);
    }
    row.append(indexCell,useCell,atomCell,...fieldCells,colorCell);
    host.appendChild(row);
  }
  fn.syncSpinTableBulkCheckbox(structure,allSites);
}
}
