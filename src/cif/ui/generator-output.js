// Generator output tabs, CIF generation/download and loading CIF files into the generator.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installGeneratorOutput(ctx){
  const {deps:{
    $, currentInstrument, effectiveS2MaxAtEi, getSelectedCifStructure, getSelectedCifText
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    downloadGeneratedCif, findGeneratorSpaceGroup, generateCifForReview,
    loadCifIntoGenerator, loadParsedCifIntoGenerator, recalculateGeneratedReflections,
    setCifOutputTab, setUnifiedGeneratorOutputTab, showUnifiedCifPreview
  });

function recalculateGeneratedReflections(){
  const estimateNotice=$('cifReflectionEstimateNotice');
  if(estimateNotice){estimateNotice.hidden=true;estimateNotice.textContent='';}
  if(cifState.liveEditorNuclearInvalid){
    fn.clearCifReflectionTable('Complete valid Unit Cell / Positions values to calculate nuclear reflections.');
    return;
  }
  // Reflections are always calculated up to 2θ = 180°; "within instrument
  // 2θ max" only limits what the table and the graph show.
  const twoThetaMax=180;
  let beam,filters;
  try{
    beam=fn.currentCifReflectionBeam();
    filters=fn.currentCifReflectionFilters();
  }catch(err){ fn.clearCifReflectionTable(err?.message||String(err)); return; }
  const notes=[];
  // Powder graph range: instrument S2 min to effective S2 max at this energy.
  let plotRange=null;
  try{
    const inst=currentInstrument();
    plotRange={min:Number($('S2min')?.value),max:Math.min(180,effectiveS2MaxAtEi(inst,beam.effectiveEnergy,beam.lambdaHalf))};
  }catch(_e){ plotRange=null; }
  // Nuclear: all reflection families (direction filters are applied at display time).
  let nuclear=null;
  const source=fn.nuclearReflectionSource();
  if(source){
    try{
      const liveSource=cifState.liveEditorNuclearSource || fn.nuclearReflectionWithSampleLattice(source);
      const families=fn.buildCifReflectionTable(liveSource.structure,liveSource.spaceGroup,beam.wavelength,
        {...filters,alongU:false,alongV:false},twoThetaMax);
      nuclear={families,lattice:liveSource.structure.lattice,wavelength:beam.wavelength};
    }catch(err){ notes.push(`Nuclear: ${err?.message||String(err)}`); }
  }else if(getSelectedCifStructure()?.magnetic && !fn.crystallographicStructureFromMcif(getSelectedCifStructure(),getSelectedCifText())){
    notes.push('This mCIF does not define a safely convertible parent cell; nuclear reflections are not calculated (hkl in the magnetic cell).');
  }
  // Magnetic: only when a spin is set; errors are reported without hiding nuclear peaks.
  // Incommensurate mCIF: magnetic satellite intensities are not implemented.
  const incommensurate=fn.selectedCifIsIncommensurate();
  const magnetic=incommensurate ? {rows:[],parentKnown:true,lattice:null,message:''}
    : fn.computeMagneticReflections({wavelength:beam.wavelength,twoThetaMax});
  if(incommensurate){
    fn.refreshMagneticIonSelectors?.(null);
    notes.push('Incommensurate mCIF: only nuclear reflections are calculated; magnetic intensities and mCIF export are not available.');
  }
  if(magnetic.message) notes.push(magnetic.message);
  if(!nuclear && !magnetic.rows.length){
    fn.clearCifReflectionTable(notes.join(' ') || 'Select a CIF/mCIF or Generate CIF to calculate reflections.');
    return;
  }
  fn.setReflectionData({nuclear,magnetic,notes,wavelength:beam.wavelength,incommensurate,plotRange});
  if(estimateNotice && source?.estimatedParent){
    estimateNotice.hidden=false;
    estimateNotice.textContent='Note: Nuclear reflections use an estimated crystallographic cell; verify the parent space group and cell transformation before quantitative use.';
  }
}

// v59: Nuclear/magnetic editors and all four results share one output workspace.
// Retain setCifOutputTab for legacy callers and restore logic.
function showUnifiedCifPreview(text,label){
  if($("cifPreview")) $("cifPreview").textContent=String(text||"");
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=String(label||"CIF/mCIF Preview");
  setUnifiedGeneratorOutputTab('preview',{persist:true});
}
const GENERATOR_OUTPUT_TABS={
  structure:['mcifTabStructure','mcifStructurePane'],
  reflections:['cifOutputTabReflections','generatorReflectionsPane'],
  preview:['cifOutputTabPreview','cifPreviewPanel']
};
function setUnifiedGeneratorOutputTab(name,{persist=false}={}){
  if(name==='cif-preview'||name==='mcif-preview') name='preview';
  if(!GENERATOR_OUTPUT_TABS[name]) name='structure';
  for(const [key,[tabId,paneId]] of Object.entries(GENERATOR_OUTPUT_TABS)){
    const selected=key===name;
    $(tabId)?.classList.toggle('active',selected);
    $(tabId)?.setAttribute('aria-selected',String(selected));
    $(tabId)?.setAttribute('tabindex',selected?'0':'-1');
    $(paneId)?.classList.toggle('hidden',!selected);
  }
  if(persist && cifState.generatorOutputTabRestored) try{ localStorage.setItem(cifState.GENERATOR_OUTPUT_TAB_STORAGE_KEY,name); }catch(_e){}
  fn.requestGeneratorViewportHeightSync();
  if(name==='structure') requestAnimationFrame(fn.renderCifStructureIfVisible);
  if(name==='reflections') requestAnimationFrame(()=>fn.renderReflectionPowderPlot?.());
}
function setCifOutputTab(tab){
  setUnifiedGeneratorOutputTab(tab==='reflections'?'reflections':'preview');
}
function setGeneratorMode(name){
  if(name!=='magnetic') name='nuclear';
  for(const [mode,tabId,paneId] of [['nuclear','generatorModeNuclear','generatorNuclearPane'],['magnetic','generatorModeMagnetic','generatorMagneticPane']]){
    const on=mode===name;
    $(tabId)?.classList.toggle('active',on);
    $(tabId)?.setAttribute('aria-selected',String(on));
    $(tabId)?.setAttribute('tabindex',on?'0':'-1');
    $(paneId)?.classList.toggle('hidden',!on);
  }
  try{localStorage.setItem('tas-simulator-generator-mode-v1',name);}catch(_e){}
}
function generateCifForReview(){
  const generated=fn.buildGeneratedCif();
  cifState.lastGeneratedCifText=generated.text;
  cifState.lastGeneratedCifName=generated.filename;
  cifState.lastGeneratedCifParsed=generated.parsed;
  cifState.lastGeneratedCifSpaceGroup=generated.sg;
  cifState.cifStructureSourcePreference="generated";
  fn.saveStructureViewerState();
  if($("cifPreview")) $("cifPreview").textContent=generated.text;
  if($("cifPreviewContext")) $("cifPreviewContext").textContent=`Generated file: ${generated.filename}`;
  fn.setCifGeneratedReady(true);
  recalculateGeneratedReflections();
  fn.renderCifStructureIfVisible();
  fn.setCifGeneratorMessage(`Generated ${generated.filename}: ${generated.sg.hm}, ${generated.atoms.length} asymmetric site(s), ${generated.parsed.atoms.length} expanded atom(s). Review the CIF, structure, and reflections, then Download CIF or Set CIF.`);
  return generated;
}

function downloadGeneratedCif(text,filename){
  const blob=new Blob([text],{type:"chemical/x-cif;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function normalizedSpaceGroupSymbol(value){
  return String(value||"").toLowerCase().replace(/[\s_'".]/g,"");
}

function findGeneratorSpaceGroup(parsed){
  const n=Number(parsed?.spaceGroupNumber);
  if(Number.isFinite(n)){
    const byNumber=cifState.cifSpaceGroups.find(x=>x.number===n);
    if(byNumber) return byNumber;
  }
  const sym=normalizedSpaceGroupSymbol(parsed?.spaceGroup);
  if(!sym) return null;
  return cifState.cifSpaceGroups.find(x=>normalizedSpaceGroupSymbol(x.hm)===sym || normalizedSpaceGroupSymbol(x.hall)===sym) || null;
}

function loadParsedCifIntoGenerator(parsed,fileName="selected_structure.cif",{message=true}={}){
  if(!parsed) return false;
  const sg=findGeneratorSpaceGroup(parsed);
  if(!sg) return false;
  const lattice=parsed.lattice || {};
  for(const key of ["a","b","c","alpha","beta","gamma"]){
    if(!Number.isFinite(Number(lattice[key]))) return false;
  }
  if(!Array.isArray(parsed.asymmetricSites) || !parsed.asymmetricSites.length) return false;
  if(!$("cifSpaceGroup") || !$("cifAtomRows")) return false;
  if(message){ cifState.cifStructureSourcePreference="loaded"; fn.saveStructureViewerState(); }
  fn.selectCifSpaceGroup(sg.number,{syncSystem:true});
  for(const [key,id] of Object.entries(cifState.CIF_LATTICE_FIELDS)) if($(id)) $(id).value=String(lattice[key]);
  cifState.structurePositionEditingMode='sites';
  cifState.structurePositionTableElement='*';
  cifState.positionModeDrafts.sites=null;cifState.positionModeDrafts.individual=null;
  cifState.positionManualSourceSignature=null;
  cifState.positionSavedSourcePreference=null;
  fn.replaceCifAtomRows(parsed.asymmetricSites.map(a=>({element:a.element,x:a.x,y:a.y,z:a.z,occupancy:a.occupancy,Biso:a.Biso ?? 0,Uaniso:a.Uaniso ?? null})));
  fn.refreshPositionTableToolbar();
  if($("cifGeneratedName")) $("cifGeneratedName").value=fn.cleanCifBaseName(fileName);
  fn.updateCifSpaceGroupInfo();
  if(parsed.magnetic) for(const [key,id] of Object.entries(cifState.CIF_LATTICE_FIELDS)) if($(id)) $(id).value=String(lattice[key]);
  fn.invalidateGeneratedCif("");
  if(message) fn.setCifGeneratorMessage(`Loaded ${fileName} for editing: #${sg.number} ${sg.hm}, ${parsed.asymmetricSites.length} asymmetric site(s). Open Structure to view it immediately, or press Generate to review the regenerated CIF and reflection table.`);
  fn.renderCifStructureIfVisible();
  return true;
}

async function loadCifIntoGenerator(file){
  if(!file) return;
  const text=await file.text();
  // The Generator used to keep its own private file snapshot.  As a result,
  // Sample, Neutron Attenuation, mCIF Generator and the file-name display
  // continued to reference a different CIF.  Import through the SAME shared
  // loader used by the Sample and mCIF Set actions, preserving the original
  // CIF/mCIF text (magnetic loops, propagation vectors, etc.).
  const parsed=fn.loadCifText(text,file.name);
  const nuclearEditor=fn.crystallographicStructureFromMcif(parsed,text)||parsed;
  const sg=findGeneratorSpaceGroup(nuclearEditor);
  const lattice=nuclearEditor?.lattice||{};
  const validLattice=["a","b","c","alpha","beta","gamma"]
    .every(key=>Number.isFinite(Number(lattice[key])));
  const editable=!!sg && validLattice &&
    Array.isArray(nuclearEditor.asymmetricSites) && nuclearEditor.asymmetricSites.length>0;
  if(editable){
    // loadCifText already filled the editable Generator fields.  Preserve the
    // previous "loaded" viewer behavior until an input is edited.
    cifState.loadedGeneratorCifStructure=parsed;
    cifState.loadedGeneratorCifName=file.name;
    cifState.cifStructureSourcePreference="loaded";
    fn.setCifGeneratorMessage(`Selected ${file.name} for Sample, CIF Generator, mCIF Generator and Neutron Attenuation. Loaded #${sg.number} ${sg.hm} for editing.`);
  }else{
    // A CIF with an unusual space group can still be a valid shared source,
    // even if the standard-setting CIF Generator cannot edit it automatically.
    cifState.loadedGeneratorCifStructure=null;
    cifState.loadedGeneratorCifName="";
    cifState.cifStructureSourcePreference="selected";
    fn.setCifGeneratorMessage(`Selected ${file.name} for all CIF/mCIF tools. Its space group or atomic sites cannot be imported into the editable CIF Generator; the original file remains available in Show current file.`,true);
  }
  fn.renderCifStructureIfVisible();
}
}
