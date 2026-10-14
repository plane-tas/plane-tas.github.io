// Magnetic moments: spin settings, Fourier/explicit moments and the Spins table.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {rationalApprox} from '../mcif-export.js';

export function installSpinTable(ctx){
  const {deps:{
    $, PI
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    atomCrystalMoment, currentMomentSettings, defaultMomentSetting, individualSettingForAtom,
    individualSpinCandidates, initialIndividualSpin, magneticCandidateSites,
    mcifCrystalAxisToCartesian, momentKey, resolveIndividualSpin, spinEditingIsIndividual,
    spinTableFilteredSites, updateMagneticMomentRows
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
// The key uses the expanded atom index, not a crystallographic label: a CIF may
// have multiple symmetry-equivalent positions with the same source label.
const individualSpinKey=(ix,iy,iz,atomIndex)=>`individual:${ix},${iy},${iz}:${atomIndex}`;
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
      const key=individualSpinKey(ix,iy,iz,atomIndex);
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
function spinEditingIsIndividual(structure){return cifState.structureSpinEditingMode==='individual' && !!structure;}
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
  const phase=2*PI*[site.x,site.y,site.z].reduce((sum,v,i)=>sum+v*approx[i].n/approx[i].d,0);
  let result=vec;
  if(cifState.structureMomentStructureType==='helical'){
    const b=fn.directLatticeBasis(structure.lattice);
    result=fn.rotateVectorAroundAxis(vec,fn.structureMomentRotationAxisVector(b),(cifState.structureMomentChirality==='CW'?1:-1)*phase);
  }else if(cifState.structureMomentStructureType==='sinusoidal') result=fn.vecScale(vec,Math.cos(phase));
  else if(Math.cos(phase)<0)result=fn.vecScale(vec,-1);
  return {...parent,mx:result[0],my:result[1],mz:result[2]};
}

function individualSettingForAtom(atom,structure,settings){
  const N=individualSpinDimensions();
  const cell=atom.cell||[0,0,0];
  const component=(v,i)=>((Math.round(v)%N[i])+N[i])%N[i];
  const key=individualSpinKey(...cell.map(component),atom.expandedAtomIndex);
  const stored=settings.get(key)||cifState.structureMomentSettings.get(key);
  if(stored)return stored;
  const base=structure.atoms?.[atom.expandedAtomIndex];
  if(!base)return null;
  const parent=structure.asymmetricSites?.[base.sourceSiteIndex]||base;
  return initialIndividualSpin({...base,x:atom.phaseX,y:atom.phaseY,z:atom.phaseZ,
    siteIndex:base.sourceSiteIndex,parentSite:parent},structure);
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
  const element=String(site.element||"").toUpperCase();
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
      for(const field of ["mx","my","mz"]){
        const value=readEditedNumber(field);
        if(Number.isFinite(value)) {if(field==="mx") mx=value; else if(field==="my") my=value; else mz=value;}
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
  cifState.visibleSpinSelectionSites.clear();
  const individual=spinEditingIsIndividual(structure);
  let allSites=[];
  try{allSites=individual?individualSpinCandidates(structure):magneticCandidateSites(structure);}
  catch(err){const notice=$("cifSpinIndividualInfo");if(notice){notice.hidden=false;notice.textContent=err.message;}fn.syncSpinTableBulkCheckbox(structure,[]);return;}
  const notice=$("cifSpinIndividualInfo");
  if(notice){notice.hidden=true;notice.textContent="";}
  refreshSpinTableToolbar(structure,allSites);
  const polar=cifState.structureMomentDirectionMode==="polar";
  const headings=polar?["θ (°)","φ (°)","μ (μB)"]:["X (μB)","Y (μB)","Z (μB)"];
  for(const [i,name] of ["X","Y","Z"].entries()){
    const cell=$("cifSpinHeader"+name);
    if(cell) cell.textContent=headings[i];
  }
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
    const setting={...(site.individualKey?initialIndividualSpin(site,structure):defaultMomentSetting(site,structure)),...saved};
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
    if(polar){
      const angles=fn.directionToPolar([setting.mx,setting.my,setting.mz]);
      for(const [field,title,value] of [["theta","Polar angle from +z (degrees)",angles.theta],["phi","Azimuth from +x toward +y (degrees)",angles.phi],["moment","Physical magnetic moment magnitude (μB)",fn.vecNorm([setting.mx,setting.my,setting.mz])]]){
        const input=document.createElement("input");
        input.type="number"; input.step="0.01"; if(field==="moment") input.min="0";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;input.title=title;input.setAttribute("aria-label",`${site.label||site.element}: ${title}`);
        momentInputs.push(input);fieldCells.push(makeCell("value",input));
      }
    }else{
      for(const [field,value] of [["mx",setting.mx],["my",setting.my],["mz",setting.mz]]){
        const input=document.createElement("input");
        input.type="number";input.step="0.01";
        input.value=formatSpinValue(value);input.dataset.displayValue=input.value;input.dataset.fullPrecision=String(value);
        input.dataset.momentField=field;
        input.title=`Cartesian magnetic moment component ${field.slice(1)} (μB)`;
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
