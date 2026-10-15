// mCIF generation: P1 single-k export and modified imported mCIF.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {CIF_OUTPUT_FORMAT_STORAGE_KEY} from './constants.js';
import {exportCommensurateMcif, rationalApprox} from '../mcif-export.js';

export function installMcifGenerator(ctx){
  const {deps:{
    $, getSelectedCifFileName, getSelectedCifStructure, getSelectedCifText, parseCifStructure,
    updateModeVisibility
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    generateP1McifForReview, initMcifGeneratorActions, initializeUnifiedOutputActions,
    invalidateGeneratedMcif
  });

// mCIF Generator: preserve the complete source symmetry/orbit specification.
cifState.lastGeneratedMcifText=""; cifState.lastGeneratedMcifName="";
function cleanMcifBaseName(name){
  return fn.cleanStructureBaseName(name);
}
function nextMcifGeneratedBaseName(raw){
  const current=cleanMcifBaseName(raw), matched=current.match(/^(.*)_generate(\d+)$/i);
  return matched?`${matched[1]}_generate${String(Number(matched[2])+1).padStart(2,"0")}`:`${current}_generate01`;
}
function invalidateGeneratedMcif(){
  cifState.lastGeneratedMcifText=""; cifState.lastGeneratedMcifName="";
  for(const id of ["structureMcifDownload","structureMcifSet"]) if($(id)) $(id).disabled=true;
  if($("cifOutputFormat")?.value==="mcif") fn.setCifGeneratedReady(false);
}
function mcifMessage(message,error=false){
  const el=$("structureMcifMessage"); if(!el) return;
  el.textContent=message; el.classList.toggle("error",error);
}
function mcifPreview(text){
  if($("mcifPreviewText")) $("mcifPreviewText").textContent=text;
  fn.showUnifiedCifPreview(text,`Generated file: ${cifState.lastGeneratedMcifName||"mCIF"}`);
}
function crystalComponents(lattice,cart){
  const basis=fn.directLatticeBasis(lattice);
  if(!basis) throw new Error("Invalid unit cell for magnetic vector conversion.");
  const a=fn.vecNormalize(basis.a),b=fn.vecNormalize(basis.b),c=fn.vecNormalize(basis.c);
  const det=fn.vecDot(a,fn.vecCross(b,c));
  if(Math.abs(det)<1e-12) throw new Error("Singular crystallographic axes.");
  return [fn.vecDot(cart,fn.vecCross(b,c))/det,fn.vecDot(cart,fn.vecCross(c,a))/det,fn.vecDot(cart,fn.vecCross(a,b))/det];
}
// The original mCIF is retained to preserve the BNS setting, time reversal,
// atomic site labels, and all magnetic symmetry loops. Replace only the moment loop.
function replaceMcifMoments(source,rows){
  const lines=String(source).replace(/\r\n?/g,"\n").split("\n");
  let start=-1,end=-1;
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().toLowerCase()!=="loop_") continue;
    let j=i+1, tags=[];
    while(j<lines.length && lines[j].trim().startsWith("_")) tags.push(lines[j++].trim().toLowerCase().split(/\s+/)[0]);
    if(!tags.some(x=>x==="_atom_site_moment.label"||x==="_atom_site_moment_label")) continue;
    start=i;end=j;
    while(end<lines.length){
      const line=lines[end].trim();
      if(/^(loop_|data_|save_|stop_|_)/i.test(line)) break;
      end++;
    }
    break;
  }
  const block=["loop_","_atom_site_moment.label","_atom_site_moment.crystalaxis_x","_atom_site_moment.crystalaxis_y","_atom_site_moment.crystalaxis_z","_atom_site_moment.symmform",...rows,""];
  if(start>=0) lines.splice(start,end-start,...block);
  else lines.push("",...block);
  return lines.join("\n");
}
function generateMcifForReview(){
  const source=getSelectedCifText();
  if(!source) throw new Error("Select a CIF/mCIF before generating.");
  if(fn.selectedCifIsIncommensurate()) throw new Error("Incommensurate mCIF: mCIF export is not available (magnetic structure is not exported).");
  if(fn.sourceIsMagneticCif() && cifState.importedMagneticEditMode) throw new Error(
    "This imported mCIF has been modified. Export with the original magnetic symmetry is disabled because it may no longer be valid."
  );
  const structure=getSelectedCifStructure();
  if(!structure) throw new Error("Selected structure is unavailable.");
  if(!structure.magnetic){
    const live=fn.currentMomentSettings();
    const settings=(structure.asymmetricSites||[]).map((site,siteIndex)=>{
      const key=fn.momentKey({...site,siteIndex});
      return live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(site,structure);
    });
    const isIndividual=fn.spinEditingIsIndividual(structure);
    const allIndividualSites=isIndividual?fn.individualSpinCandidates(structure):[];
    const individualSettings=isIndividual ? Object.fromEntries(allIndividualSites.map(site=>[
      site.individualKey.replace(/^individual:/,''),fn.resolveIndividualSpin(site,structure,live)
    ])) : null;
    if(!(individualSettings ? Object.values(individualSettings).some(s=>s.enabled) : settings.some(s=>s.enabled)))
      throw new Error('Enable at least one magnetic site to generate an mCIF.');
    const q=fn.effectivePropagationVectorForStructure();
    const basis=fn.directLatticeBasis(structure.lattice);
    const result=exportCommensurateMcif({source,structure,settings,q:[q.h,q.k,q.l],mode:cifState.structureMomentStructureType,
      axis:fn.structureMomentRotationAxisVector(basis),chirality:cifState.structureMomentChirality,
      fallbackOperations:fn.findGeneratorSpaceGroup(structure)?.operations||[],
      individualSettings});
    const base=cleanMcifBaseName($('cifGeneratedName')?.value);
    cifState.lastGeneratedMcifText=result.text;cifState.lastGeneratedMcifName=`${base}.mcif`;
    for(const id of ['structureMcifDownload','structureMcifSet']) if($(id)) $(id).disabled=false;
    mcifPreview(result.text);
    mcifMessage(`Generated ${cifState.lastGeneratedMcifName}: ${result.atomCount} atoms in ${result.supercell.join('×')} supercell, ${result.operationCount} magnetic operations, ${result.representatives} independent sites. k ≈ (${result.approximatedQ.join(', ')}).`);
    return;
  }
  const hasMagOps=/_space_group_symop_magn_operation[._]/i.test(source);
  if(!hasMagOps) throw new Error("This generator currently requires an mCIF with magnetic symmetry operations. A nonmagnetic CIF cannot be converted without choosing a magnetic space group.");
  const live=fn.currentMomentSettings();
  const records=[];
  (structure.asymmetricSites||[]).forEach((site,siteIndex)=>{
    const key=fn.momentKey({...site,siteIndex});
    const setting=live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(site,structure);
    if(!setting.enabled) return;
    const cart=[Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0];
    if(cart.some(x=>!Number.isFinite(x))) throw new Error(`Invalid spin components for ${site.label}`);
    const v=crystalComponents(structure.lattice,cart);
    records.push(`${site.label} ${v.map(x=>Number(x.toFixed(8))).join(" ")} mx,my,mz`);
  });
  if(!records.length) throw new Error("No spin sites enabled. Enable at least one spin.");
  const text=replaceMcifMoments(source,records);
  // Reparse and verify symmetry consistency before allowing Set or Download.
  const check=parseCifStructure(text);
  if(!check.magnetic) throw new Error("Generated file lost magnetic structure information.");
  for(const site of check.asymmetricSites){
    const expected=structure.asymmetricSites.find(x=>x.label===site.label);
    if(!expected) throw new Error(`Magnetic site ${site.label} was lost.`);
  }
  const base=cleanMcifBaseName($("cifGeneratedName")?.value);
  cifState.lastGeneratedMcifText=text; cifState.lastGeneratedMcifName=`${base}.mcif`;
  for(const id of ["structureMcifDownload","structureMcifSet"]) if($(id)) $(id).disabled=false;
  mcifPreview(text);
  mcifMessage(`Generated ${cifState.lastGeneratedMcifName}; magnetic symmetry checked (${check.atoms.filter(a=>Array.isArray(a.magneticMoment)).length} magnetic atoms).`);
}
// ---- Imported mCIF -> magnetic P1: transfer the ACTUAL magnetic structure ----
// The moments of an imported mCIF are generated by its magnetic space group
// (rotations act on axial vectors, time reversal, anti-translations). They
// must not be re-derived from the nuclear CIF (k-phase only) and must be
// matched to the exported atoms by POSITION, never by atom index (the mCIF
// and the generated CIF list symmetry-equivalent atoms in different orders).
function importedMagneticModel(){
  const source=getSelectedCifStructure();
  if(!source?.magnetic || !Array.isArray(source.atoms)) return null;
  if(source.incommensurateSingleQ || source.atoms.some(atom=>atom.magneticFourier))
    throw new Error("Incommensurate mCIF: mCIF export is not available (magnetic structure is not exported).");
  const live=fn.currentMomentSettings();
  if(fn.spinEditingIsIndividual(source)){
    // Manual spins: one setting per expanded mCIF atom (Cartesian, mCIF cell).
    return {lattice:source.lattice,atoms:source.atoms.map((atom,i)=>{
      const key=`individual:0,0,0:${i}`;
      return {atom,setting:live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(atom,source)};
    })};
  }
  let model=source;
  if(cifState.importedMagneticEditMode){
    // Modify (linked sites): apply the edited site moments through the
    // file's magnetic symmetry by rewriting the moment loop and re-parsing.
    const records=[];
    (source.asymmetricSites||[]).forEach((site,siteIndex)=>{
      const key=fn.momentKey({...site,siteIndex});
      const setting=live.get(key)||cifState.structureMomentSettings.get(key)||fn.defaultMomentSetting(site,source);
      if(!setting.enabled) return;
      const v=crystalComponents(source.lattice,[Number(setting.mx)||0,Number(setting.my)||0,Number(setting.mz)||0]);
      records.push(`${site.label} ${v.map(x=>Number(x.toFixed(8))).join(" ")} mx,my,mz`);
    });
    if(!records.length) throw new Error("No spin sites enabled. Enable at least one spin.");
    model=parseCifStructure(replaceMcifMoments(getSelectedCifText(),records));
  }
  return {lattice:model.lattice,atoms:model.atoms.map(atom=>({atom,setting:fn.defaultMomentSetting(atom,model)}))};
}
function individualSettingsFromMagneticModel(structure,model){
  const L=structure.lattice,M=model.lattice;
  const R=['a','b','c'].map(k=>Number(M[k])/Number(L[k]));
  if(R.some(r=>!(Math.abs(r-Math.round(r))<1e-3 && Math.round(r)>=1)) ||
     ['alpha','beta','gamma'].some(k=>Math.abs(Number(M[k])-Number(L[k]))>1e-3))
    throw new Error("The mCIF cell is not an integer supercell of the CIF cell; magnetic moments cannot be transferred.");
  const Ri=R.map(Math.round);
  const q=fn.effectivePropagationVectorForStructure();
  const N=[q.h,q.k,q.l].map(v=>rationalApprox(v).d);
  if(N.some((n,i)=>n%Ri[i]!==0 && Ri[i]%n!==0) || Ri.some((r,i)=>r>N[i]))
    throw new Error(`The magnetic cell (${Ri.join('×')}) does not match the propagation-vector supercell (${N.join('×')}).`);
  const basis=fn.directLatticeBasis(M);
  const cart=f=>fn.vecAdd(fn.vecAdd(fn.vecScale(basis.a,f[0]),fn.vecScale(basis.b,f[1])),fn.vecScale(basis.c,f[2]));
  const wrapd=v=>v-Math.round(v);
  const used=new Set(),out={};
  for(let ix=0;ix<N[0];ix++)for(let iy=0;iy<N[1];iy++)for(let iz=0;iz<N[2];iz++){
    structure.atoms.forEach((atom,i)=>{
      const f=[atom.x+ix,atom.y+iy,atom.z+iz].map((v,j)=>v/Ri[j]);
      let best=-1,bestDist=0.5; // Å: tolerates small edits of atomic positions
      model.atoms.forEach((m,j)=>{
        if(m.atom.element!==atom.element) return;
        const d=Math.hypot(...cart([m.atom.x-f[0],m.atom.y-f[1],m.atom.z-f[2]].map(wrapd)));
        if(d<bestDist){bestDist=d;best=j;}
      });
      const setting=best>=0?model.atoms[best].setting:null;
      if(best>=0) used.add(best);
      out[`${ix},${iy},${iz}:${i}`]=setting?{...setting}:{enabled:false,mx:0,my:0,mz:0};
    });
  }
  const lost=model.atoms.filter((m,j)=>m.setting.enabled && !used.has(j));
  if(lost.length) throw new Error(`${lost.length} magnetic atom(s) of the mCIF have no matching atom in the CIF (moved by more than 0.5 Å?).`);
  return out;
}

// The public CIF/mCIF Generator exports all decorated atoms in magnetic P1.
// BNS group classification is NOT inferred; the existing notice stays visible.
function generateP1McifForReview(){
  if(fn.selectedCifIsIncommensurate()) throw new Error("Incommensurate mCIF: mCIF export is not available (magnetic structure is not exported).");
  const generated=fn.buildGeneratedCif();
  const structure=generated.parsed;
  const displayed=fn.currentStructureForViewer()?.structure;
  const sameSites=!!displayed && displayed.asymmetricSites?.length===structure.asymmetricSites?.length &&
    structure.asymmetricSites.every((site,i)=>{
      const other=displayed.asymmetricSites[i];
      return other && site.element===other.element &&
        ["x","y","z"].every(key=>Math.abs(((Number(site[key])-Number(other[key])+0.5)%1+1)%1-0.5)<1e-5);
    });
  const live=fn.currentMomentSettings();
  const settings=(structure.asymmetricSites||[]).map((site,siteIndex)=>{
    const generatedKey=fn.momentKey({...site,siteIndex});
    const displayKey=sameSites?fn.momentKey({...displayed.asymmetricSites[siteIndex],siteIndex}):null;
    return live.get(generatedKey) || (displayKey && live.get(displayKey)) ||
      cifState.structureMomentSettings.get(generatedKey) || (displayKey && cifState.structureMomentSettings.get(displayKey)) ||
      fn.defaultMomentSetting(site,structure);
  });
  const magneticModel=importedMagneticModel();
  const manual=!magneticModel && fn.spinEditingIsIndividual(structure);
  const candidates=manual?fn.individualSpinCandidates(structure):[];
  const individualSettings=magneticModel ? individualSettingsFromMagneticModel(structure,magneticModel) :
    manual?Object.fromEntries(candidates.map(site=>[
    site.individualKey.replace(/^individual:/,""),fn.resolveIndividualSpin(site,structure,live)
  ])):null;
  const hasSpin=individualSettings ? Object.values(individualSettings).some(setting=>setting.enabled) :
    settings.some(setting=>setting.enabled);
  if(!hasSpin) throw new Error("Enable at least one magnetic site in Structure editor → Spins before generating an mCIF.");
  const q=fn.effectivePropagationVectorForStructure();
  const basis=fn.directLatticeBasis(structure.lattice);
  const output=exportCommensurateMcif({
    source:generated.text,structure,settings,individualSettings,
    q:[q.h,q.k,q.l],mode:cifState.structureMomentStructureType,
    axis:fn.structureMomentRotationAxisVector(basis),chirality:cifState.structureMomentChirality,
    p1Only:true
  });
  cifState.lastGeneratedMcifText=output.text;
  cifState.lastGeneratedMcifName=`${fn.cleanCifBaseName($("cifGeneratedName")?.value)}.mcif`;
  if($("cifPreview")) $("cifPreview").textContent=output.text;
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=`Generated file: ${cifState.lastGeneratedMcifName} (magnetic P1)`;
  fn.setCifGeneratedReady(true);
  fn.setCifGeneratorMessage(`Generated ${cifState.lastGeneratedMcifName}: magnetic P1, ${output.atomCount} atoms. Review before Download or Set.`);
  return output;
}

function initializeUnifiedOutputActions(){
  const format=$("cifOutputFormat"),generate=$("cifOutputGenerate");
  if(!format || !generate || format.dataset.outputBound) return;
  format.dataset.outputBound="1";
  try{
    const saved=localStorage.getItem(CIF_OUTPUT_FORMAT_STORAGE_KEY);
    if(saved==='cif'||saved==='mcif')format.value=saved;
  }catch(_e){}
  const update=()=>{
    const mcif=format.value==="mcif";
    const word=mcif?"mCIF":"CIF";
    const notice=$("cifMcifBnsNotice");
    if(notice) notice.hidden=!mcif;
    generate.textContent=`Generate ${word}`;
    if($("cifOutputDownload")) $("cifOutputDownload").textContent=`Download ${word}`;
    if($("cifOutputSet")) $("cifOutputSet").textContent=`Set ${word}`;
    const suffix=$("cifUnifiedFileSuffix");
    if(suffix) suffix.textContent=mcif?".mcif":".cif";
    generate.disabled=!cifState.cifSpaceGroups.length;
    fn.setCifGeneratedReady(mcif ? !!cifState.lastGeneratedMcifText : !!cifState.lastGeneratedCifText);
  };
  format.addEventListener("change",()=>{
    try{localStorage.setItem(CIF_OUTPUT_FORMAT_STORAGE_KEY,format.value);}catch(_e){}
    update();
  });
  update();
}
function initMcifGeneratorActions(){
  // mCIF Generate is available; Download/Set remain disabled until generation.
  if($("structureMcifGenerate")) $("structureMcifGenerate").disabled=false;
  invalidateGeneratedMcif();
  $("structureMcifShowCurrent")?.addEventListener("click",()=>{
    if(!getSelectedCifText()){mcifMessage("No current CIF/mCIF selected.",true);return;}
    mcifPreview(getSelectedCifText());mcifMessage(`Showing ${getSelectedCifFileName()}.`);
  });
  $("structureMcifGenerate")?.addEventListener("click",()=>{
    const el=$("cifGeneratedName"),previous=el?.value;
    if(el) el.value=nextMcifGeneratedBaseName(previous);
    try{ generateMcifForReview(); }
    catch(err){if(el)el.value=previous;invalidateGeneratedMcif();mcifMessage(err.message||String(err),true);}
  });
  $("structureMcifDownload")?.addEventListener("click",()=>{
    if(!cifState.lastGeneratedMcifText)return;
    fn.downloadGeneratedCif(cifState.lastGeneratedMcifText,cifState.lastGeneratedMcifName);
    mcifMessage(`Downloaded ${cifState.lastGeneratedMcifName}.`);
  });
  $("structureMcifSet")?.addEventListener("click",()=>{
    try{
      if(!cifState.lastGeneratedMcifText)throw new Error("Generate mCIF first.");
      if($("sampleMode")?.value!=="single"){
        $("sampleMode").value="single";updateModeVisibility();
      }
      fn.loadCifText(cifState.lastGeneratedMcifText,cifState.lastGeneratedMcifName);
      $("mcifTabStructure")?.click();fn.renderCifStructureIfVisible();
      mcifMessage(`Set ${cifState.lastGeneratedMcifName} as the current mCIF.`);
    }catch(err){mcifMessage(err.message||String(err),true);}
  });
  // Any change to the source cell, atomic positions, or magnetic model makes
  // the previously reviewed mCIF stale (not just editing an XYZ spin field).
  const magneticSourceChanged=ev=>{
    const target=ev.target;
    if(target?.closest?.('#cifAtomRows, #cifAtomDetailedRows, #cifMagMomentRows, #cifSpinBulkCheckbox') ||
       ['cifA','cifB','cifC','cifAlpha','cifBeta','cifGamma',
        'cifSpaceGroup','cifSpaceGroupNumber','cifCrystalSystem',
        'cifMomentPropagationVector','cifMomentStructureType','cifMomentRotationAxis',
        'cifMomentChirality','cifSpinEditingMode'].includes(target?.id)){
      invalidateGeneratedMcif();
    }
  };
  document.querySelector('.structure-control-section')?.addEventListener('input',magneticSourceChanged);
  document.querySelector('.structure-control-section')?.addEventListener('change',magneticSourceChanged);
  $('propagationVectors')?.addEventListener('input',invalidateGeneratedMcif);
  $('propagationVectors')?.addEventListener('change',invalidateGeneratedMcif);
}
}
