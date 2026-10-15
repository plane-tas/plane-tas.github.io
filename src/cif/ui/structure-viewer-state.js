// Structure viewer state: shared settings, style safety limits, save/restore/reset.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installStructureViewerState(ctx){
  const {deps:{
    $
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    discardStructureEditingSession, readSavedGeneratorOutputTab, rememberedStructureEditorTab,
    resetStructureViewerStateToDefaults, restoreStructureViewerState, safeStyleDistances,
    saveStructureViewerState, sourceIsMagneticCif, structureStateFingerprint,
    styleCellDiagonalForViewer, styleCellDiagonalLimit
  });

cifState.lastGeneratedCifText="";
cifState.lastGeneratedCifName="generated_structure.cif";
cifState.selectedCifReflectionKey="";
cifState.cifReflectionSort={key:"intensity",direction:"desc"};
cifState.lastGeneratedCifParsed=null;
cifState.lastGeneratedCifSpaceGroup=null;
cifState.lastGeneratedReflections=[];
cifState.cifStructureViewMode="a";
cifState.cifStructureSourcePreference="generated";
cifState.loadedGeneratorCifStructure=null;
cifState.loadedGeneratorCifName="";
const STRUCTURE_VIEWER_STORAGE_KEY="tas-simulator-structure-viewer-v2";
// The DISTANCE limit is determined by the actual lattice parallelepiped,
// not a hard-coded value in Å. Mesh/count budgets below are independent
// safety limits: a large crystallographic cell can still contain many atoms.
cifState.STYLE_MAX_BOND_ATOMS=850;
cifState.STYLE_MAX_BOND_SEGMENTS=12000;
cifState.STYLE_MAX_BOND_RULES=24;
cifState.STRUCTURE_MAX_REPLICATION_TESTS=250000;
// Display safety limits (about half of the size that still rendered reliably).
cifState.STRUCTURE_MAX_DISPLAYED_ATOMS=3000;
cifState.STRUCTURE_MAX_SPIN_ATOMS=3000;
// Maximum distance between two points of ONE unit cell. For skew cells the
// longest body diagonal may be a+b-c, a-b+c or -a+b+c, NOT just a+b+c.
function styleCellDiagonalLimit(basis){
  if(!basis?.a || !basis?.b || !basis?.c)return NaN;
  const add=(a,b,c)=>fn.vecAdd(fn.vecAdd(a,b),c);
  const {a,b,c}=basis;
  const candidates=[add(a,b,c),add(a,b,fn.vecScale(c,-1)),
    add(a,fn.vecScale(b,-1),c),add(fn.vecScale(a,-1),b,c)];
  const limit=Math.max(...candidates.map(fn.vecNorm));
  return Number.isFinite(limit) && limit>0 ? limit : NaN;
}
function styleCellDiagonalForViewer(){
  const lattice=fn.currentStructureForViewer()?.structure?.lattice;
  return styleCellDiagonalLimit(fn.directLatticeBasis(lattice));
}
function safeStyleDistances(min,max,limit=Infinity){
  return Number.isFinite(min) && Number.isFinite(max) &&
    min>=0 && max>=min && max>0 && max<=limit+1e-8;
}
function oversizedSavedStyleRule(rule){
  if(!rule || typeof rule!=="object") return false;
  const max=Number(rule.maxDistance ?? rule.distance ?? 3);
  const min=Number(rule.minDistance ?? 0);
  return !safeStyleDistances(min,max);
}
// Repair structurally invalid stored ranges early. Cell-dependent checks run
// again after restoring the actual CIF lattice (see restoreStructureViewerState).
// Keep invalid numbers untouched for editing; turn drawing off instead.
function rescueSavedStyleRules(store){
  let repaired=false;
  for(const state of Object.values(store?.states || {})){
    if(!Array.isArray(state?.bonds)) continue;
    for(const rule of state.bonds){
      if(oversizedSavedStyleRule(rule) && rule.enabled!==false){
        rule.enabled=false;
        repaired=true;
      }
    }
  }
  return repaired;
}
let restoringStructureViewer=false;
cifState.restoredStructureBondRules=null;
cifState.structureBondDisplayMode="bonds";
 // Bonds / Polyhedral / Both
cifState.structureCameraState=null;
cifState.structureProgrammaticCameraUpdate=false;
cifState.structureCameraWatchFrame=0;
cifState.structureCameraWatchSignature="";
cifState.structureCameraPresetRevision=0;
cifState.structureCameraRenderRevision=0;
cifState.structureMomentStructureType="collinear";
// Checked Modify intentionally means protected/read-only (requested UI behavior).
cifState.structureModifyLocked=false;
cifState.GENERATOR_OUTPUT_TAB_STORAGE_KEY="tas-simulator-generator-output-tab-v1";
// Capture the user's selection BEFORE any initialization can change the DOM.
const initialGeneratorOutputTab=(()=>{
  try { return localStorage.getItem(cifState.GENERATOR_OUTPUT_TAB_STORAGE_KEY)||"structure"; }
  catch(_e){ return "structure"; }
})();
cifState.generatorOutputTabRestored=false;
function readSavedGeneratorOutputTab(){return initialGeneratorOutputTab;}
cifState.MCIF_EDIT_DRAFT_KEY="tas-simulator-mcif-modify-drafts-v1";
cifState.importedOriginalQ=[];
cifState.modifiedMagneticDraft=null;

cifState.STRUCTURE_EDITOR_TAB_KEY="tas-simulator-structure-editor-active-tab-v1";
const VALID_STRUCTURE_EDITOR_TABS=["cell","positions","appearance","spins","bonds"];
function rememberedStructureEditorTab(){
  try{
    const value=localStorage.getItem(cifState.STRUCTURE_EDITOR_TAB_KEY);
    return VALID_STRUCTURE_EDITOR_TABS.includes(value)?value:"cell";
  }catch(_e){return "cell";}
}
cifState.structureConfigActiveTab=rememberedStructureEditorTab();
cifState.structureMomentGlobalLength=1;
cifState.structureMomentGlobalWidth=10;
cifState.structureMomentGlobalHeadSize=0.51;
cifState.structureMomentGlobalWidthBlank=false;
cifState.structureMomentGlobalHeadBlank=false;
cifState.structureUnitCellMode="one";
// The chosen frame affects ONLY the Structure outline, not atomic coordinates or reflections.
cifState.structureUnitCellReference="crystallographic";
cifState.structureShowXYZ=true;
// Every CIF asymmetric site is available in the Spins tab.
// Only transition-metal and rare-earth sites start enabled by default;
// all other elements (for example O) remain available but start disabled.
const DEFAULT_SPIN_ELEMENTS=new Set([
  // 3d / 4d / 5d transition metals
  "SC","TI","V","CR","MN","FE","CO","NI","CU","ZN",
  "Y","ZR","NB","MO","TC","RU","RH","PD","AG","CD",
  "HF","TA","W","RE","OS","IR","PT","AU","HG",
  // Rare-earth elements (lanthanides; Sc/Y are already included above)
  "LA","CE","PR","ND","PM","SM","EU","GD","TB","DY","HO","ER","TM","YB","LU"
]);
cifState.structureAtomColorOverrides=new Map();
cifState.structureAtomSizeOverrides=new Map();
cifState.structureAtomSizeCleared=new Set();
cifState.structureAtomVisibility=new Map();
cifState.structureMomentSettings=new Map();
cifState.structureElementDefaultColors=new Map();
cifState.structureControlSignature="";
cifState.STRUCTURE_PALETTE=["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf","#c2185b","#009688"];

function structureStateFingerprint(structure){
  if(!structure) return "";
  const raw=fn.structureSignature(structure);
  // Small deterministic FNV-1a fingerprint.  This is only a localStorage key,
  // not a security hash.  The full structure signature is also stored in the
  // saved entry so an accidental hash collision cannot restore the wrong state.
  let h=0x811c9dc5;
  for(let i=0;i<raw.length;i++){
    h^=raw.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,"0");
}
function currentStructureStateIdentity(){
  // Editing positions changes a generated structureSignature on EVERY keystroke.
  // Key the draft to its source CIF (or to the persistent new-generator session),
  // so live Atoms/Spins/Style settings still match after editing and reload.
  const source=fn.currentStructureForViewer();
  if(!source?.structure) return null;
  // The original CIF text is stored separately. Do not duplicate a possibly
  // multi-megabyte mCIF in the viewer-state signature on every edit.
  const signature=`source:${fn.currentEditorSourceKey()}`;
  let h=0x811c9dc5;
  for(let i=0;i<signature.length;i++){
    h^=signature.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return {fingerprint:`session-${h.toString(16).padStart(8,'0')}`,signature,
    legacy:{fingerprint:structureStateFingerprint(source.structure),signature:fn.structureSignature(source.structure)}};
}
function readStructureViewerStateStore(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STRUCTURE_VIEWER_STORAGE_KEY)||"null");
    if(parsed?.version===2 && parsed.states && typeof parsed.states==="object"){
      if(rescueSavedStyleRules(parsed)){
        try{localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify(parsed));}catch(_e){}
      }
      return parsed;
    }
  }catch(_e){}
  return {version:2,states:{}};
}
// Remove all past structure-specific snapshots when the user switches files
// or presses Clear. Do not touch global Instrument/Sample/tab preferences.
function discardStructureEditingSession(){
  try{localStorage.removeItem(STRUCTURE_VIEWER_STORAGE_KEY);}catch(_e){}
  try{localStorage.removeItem(cifState.MCIF_EDIT_DRAFT_KEY);}catch(_e){}
  cifState.modifiedMagneticDraft=null;
  cifState.importedMagneticEditMode=false;
  cifState.importedMagneticQSignature="";
  // Invalidate existing DOM rows, otherwise they may be harvested as edits
  // when the new structure is first rendered.
  fn.clearSpinRowSelection({redraw:false});
  cifState.selectedAppearanceRowKeys.clear();
  cifState.visibleSpinSelectionSites.clear();
  $("cifMagMomentRows")?.replaceChildren();
  $("cifBondRows")?.replaceChildren();
  $("cifAtomColorRows")?.replaceChildren();
  cifState.structureControlSignature="";
}
function resetStructureViewerStateToDefaults(){
  fn.clearSpinRowSelection({redraw:false});
  cifState.visibleSpinSelectionSites.clear();
  restoringStructureViewer=true;
  try{
    cifState.cifStructureViewMode="a";
    cifState.structureCameraState=null;
    cifState.structureCameraWatchSignature="";
    for(const axis of ["x","y","z"]){
      const cap=axis.toUpperCase();
      if($("cifRange"+cap)) $("cifRange"+cap).value="0 1";
      if($("cifRange"+cap+"Min")) $("cifRange"+cap+"Min").value="0";
      if($("cifRange"+cap+"Max")) $("cifRange"+cap+"Max").value="1";
    }
    cifState.structureAtomColorOverrides.clear();
    cifState.structureElementDefaultColors.clear();
    cifState.structureAtomSizeOverrides.clear();
    cifState.structureAtomSizeCleared.clear();
    cifState.structureAtomVisibility.clear();
    cifState.atomSiteColors.clear(); cifState.atomSiteSizes.clear(); cifState.atomSiteVisibility.clear();
    cifState.structureMomentSettings.clear();
    cifState.structureMomentStructureType="collinear";
    cifState.structureMomentRotationAxis="c";
    cifState.structureMomentChirality="CCW";
    cifState.structureMomentPropagationIndex=0;
    cifState.structureMomentDirectionMode="cartesian";
    cifState.structureSpinEditingMode="sites";
    cifState.structureSpinTableElement="*";
    // Keep the user-selected editor tab when a different structure is loaded.
    cifState.structureConfigActiveTab=rememberedStructureEditorTab();
    cifState.structureMomentGlobalLength=1;
    cifState.structureMomentGlobalWidth=10;
    cifState.structureMomentGlobalHeadSize=0.51;
    cifState.structureMomentGlobalWidthBlank=false;
    cifState.structureMomentGlobalHeadBlank=false;
    cifState.structureUnitCellMode="one";
    cifState.structureUnitCellReference="crystallographic";
    cifState.structureShowXYZ=true;
    cifState.structureBondDisplayMode="bonds";
    cifState.restoredStructureBondRules=[];
    cifState.structureControlSignature="";
    
    const unitCellSelect=$("cifUnitCellMode"); if(unitCellSelect) unitCellSelect.value="one";
    const referenceSelect=$("cifUnitCellReference"); if(referenceSelect) referenceSelect.value="crystallographic";
    const xyzSelect=$("cifShowXYZ"); if(xyzSelect) xyzSelect.value="show";
  }finally{ restoringStructureViewer=false; }
}
function saveStructureViewerState(){
  if(restoringStructureViewer || cifState.restoringCifStartup) return;
  try{
    const identity=currentStructureStateIdentity();
    if(!identity) return;
    const liveMoments=fn.currentMomentSettings();
    for(const [key,value] of liveMoments) cifState.structureMomentSettings.set(key,value);
    const payload={
      signature:identity.signature,
      viewMode:cifState.cifStructureViewMode,
      range:fn.structureRange(),
      atomColors:Object.fromEntries(cifState.structureAtomColorOverrides),
      atomSizes:Object.fromEntries(cifState.structureAtomSizeOverrides),
      atomSizeCleared:[...cifState.structureAtomSizeCleared],
      atomVisible:Object.fromEntries(cifState.structureAtomVisibility),
      atomSiteColors:Object.fromEntries(cifState.atomSiteColors),
      atomSiteSizes:Object.fromEntries(cifState.atomSiteSizes),
      atomSiteVisible:Object.fromEntries(cifState.atomSiteVisibility),
      moments:Object.fromEntries(cifState.structureMomentSettings),
      momentStructureType:cifState.structureMomentStructureType,
      momentRotationAxis:cifState.structureMomentRotationAxis,
      momentChirality:cifState.structureMomentChirality,
      momentPropagationIndex:cifState.structureMomentPropagationIndex,
      momentDirectionMode:cifState.structureMomentDirectionMode,
      spinEditingMode:cifState.structureSpinEditingMode,
      spinTableElement:cifState.structureSpinTableElement,
      configActiveTab:cifState.structureConfigActiveTab,
      momentCoordinatesVersion:3,
      zeroMomentDefaultsVersion:1,
      momentGlobalLength:cifState.structureMomentGlobalLength,
      momentGlobalWidth:cifState.structureMomentGlobalWidth,
      momentGlobalHeadSize:cifState.structureMomentGlobalHeadSize,
      momentGlobalWidthBlank:cifState.structureMomentGlobalWidthBlank,
      momentGlobalHeadBlank:cifState.structureMomentGlobalHeadBlank,
      unitCellMode:cifState.structureUnitCellMode,
      unitCellReference:cifState.structureUnitCellReference,
      showXYZ:cifState.structureShowXYZ,
      structureBondDisplayMode:cifState.structureBondDisplayMode,
      bonds:fn.readStructureBondRules()
    };
    // Retain only the active structure, never an accumulating history.
    localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify({
      version:2,states:{[identity.fingerprint]:payload}
    }));
  }catch(_e){}
}
function sourceIsMagneticCif(){return fn.currentStructureForViewer()?.structure?.magnetic===true;}
function restoreStructureViewerState(){
  fn.clearSpinRowSelection({redraw:false});
  cifState.visibleSpinSelectionSites.clear();
  const identity=currentStructureStateIdentity();
  if(!identity){ resetStructureViewerStateToDefaults(); return false; }
  const store=readStructureViewerStateStore();
  let saved=store.states?.[identity.fingerprint];
  // Migrate matching older (structure-derived) keys once; retain the user's
  // prior settings after a software upgrade, not after loading another CIF.
  if((!saved || saved.signature!==identity.signature) && identity.legacy){
    const old=store.states?.[identity.legacy.fingerprint];
    if(old?.signature===identity.legacy.signature){
      saved={...old,signature:identity.signature};
      try{localStorage.setItem(STRUCTURE_VIEWER_STORAGE_KEY,JSON.stringify({version:2,
        states:{[identity.fingerprint]:saved}}));}catch(_e){}
    }
  }
  // Different CIF/structure: never leak atom colours, spin settings or bonds
  // from the previously displayed structure.
  if(!saved || saved.signature!==identity.signature){
    resetStructureViewerStateToDefaults();
    return false;
  }
  restoringStructureViewer=true;
  try{
    // Always start the Structure viewer from the crystallographic a direction.
    cifState.cifStructureViewMode="a";
    cifState.structureCameraState=null;
    cifState.structureCameraWatchSignature="";
    for(const axis of ["x","y","z"]){
      const cap=axis.toUpperCase();
      const legacy=Number(saved.repeat?.[axis]);
      const minValue=Number(saved.range?.[axis]?.min);
      const maxValue=Number(saved.range?.[axis]?.max);
      const min=Number.isFinite(minValue)?minValue:0;
      const max=Number.isFinite(maxValue)?maxValue:(Number.isFinite(legacy)?legacy:1);
      if($("cifRange"+cap)) $("cifRange"+cap).value=`${min} ${max}`;
      if($("cifRange"+cap+"Min")) $("cifRange"+cap+"Min").value=String(min);
      if($("cifRange"+cap+"Max")) $("cifRange"+cap+"Max").value=String(max);
    }
    cifState.structureAtomColorOverrides.clear();
    for(const [element,color] of Object.entries(saved.atomColors||{})) if(/^#[0-9a-f]{6}$/i.test(String(color))) cifState.structureAtomColorOverrides.set(element,String(color));
    cifState.structureAtomSizeOverrides.clear();
    for(const [element,size] of Object.entries(saved.atomSizes||{})){ const n=Number(size); if(Number.isFinite(n)) cifState.structureAtomSizeOverrides.set(element,n); }
    cifState.structureAtomSizeCleared.clear();
    for(const element of (Array.isArray(saved.atomSizeCleared)?saved.atomSizeCleared:[])) cifState.structureAtomSizeCleared.add(String(element));
    cifState.structureAtomVisibility.clear();
    for(const [element,visible] of Object.entries(saved.atomVisible||{})) cifState.structureAtomVisibility.set(element,visible!==false);
    cifState.atomSiteColors.clear();cifState.atomSiteSizes.clear();cifState.atomSiteVisibility.clear();
    for(const [key,value] of Object.entries(saved.atomSiteColors||{})) if(/^#[0-9a-f]{6}$/i.test(value)) cifState.atomSiteColors.set(key,value);
    for(const [key,value] of Object.entries(saved.atomSiteSizes||{})) if(Number.isFinite(Number(value))) cifState.atomSiteSizes.set(key,Math.max(2,Math.min(30,Number(value))));
    for(const [key,value] of Object.entries(saved.atomSiteVisible||{})) cifState.atomSiteVisibility.set(key,value!==false);
    cifState.structureMomentSettings.clear();
    for(const [key,value] of Object.entries(saved.moments||{})) if(value && typeof value==="object") cifState.structureMomentSettings.set(key,{...value});
    // Old saved UI state can contain implicit +z, 1 μB defaults. Discard those
    // only for nonmagnetic structures. New explicit edits remain persistent.
    if(!sourceIsMagneticCif() && saved.zeroMomentDefaultsVersion!==1) cifState.structureMomentSettings.clear();
    if(sourceIsMagneticCif() && saved.momentCoordinatesVersion!==3) {
      for(const site of (fn.currentStructureForViewer()?.structure?.asymmetricSites||[])) {
        if(!Array.isArray(site.magneticMoment)) continue;
        const key=fn.momentKey({...site,siteIndex:(fn.currentStructureForViewer()?.structure?.asymmetricSites||[]).indexOf(site)});
        const existing=cifState.structureMomentSettings.get(key)||{};
        const canonical=fn.defaultMomentSetting(site,fn.currentStructureForViewer().structure);
        cifState.structureMomentSettings.set(key,{...existing,mx:canonical.mx,my:canonical.my,mz:canonical.mz,size:1});
      }
    }
    if(["collinear","helical","sinusoidal"].includes(String(saved.momentStructureType||""))) cifState.structureMomentStructureType=String(saved.momentStructureType);
    else if(String(saved.momentStructureType||"")==="canted") cifState.structureMomentStructureType="collinear";
    if(["a","b","c"].includes(String(saved.momentRotationAxis||""))) cifState.structureMomentRotationAxis=String(saved.momentRotationAxis);
    if(["CW","CCW"].includes(String(saved.momentChirality||""))) cifState.structureMomentChirality=String(saved.momentChirality);
    { const n=Number(saved.momentPropagationIndex); cifState.structureMomentPropagationIndex=Number.isInteger(n)&&n>0?n:0; }
    if(["cartesian","polar"].includes(String(saved.momentDirectionMode||""))) cifState.structureMomentDirectionMode=String(saved.momentDirectionMode);
    cifState.structureSpinEditingMode=saved.spinEditingMode==="individual"?"individual":"sites";
    cifState.structureSpinTableElement=String(saved.spinTableElement||"*");
    // Editor navigation is a global UI preference, not structure-specific data.
    cifState.structureConfigActiveTab=rememberedStructureEditorTab();
    { const n=Number(saved.momentGlobalLength); if(Number.isFinite(n)&&n>=0) cifState.structureMomentGlobalLength=n; }
    { const n=Number(saved.momentGlobalWidth); if(Number.isFinite(n)&&n>=1) cifState.structureMomentGlobalWidth=n; }
    { const n=Number(saved.momentGlobalHeadSize); if(Number.isFinite(n)&&n>0) cifState.structureMomentGlobalHeadSize=n; }
    cifState.structureMomentGlobalWidthBlank=saved.momentGlobalWidthBlank===true;
    cifState.structureMomentGlobalHeadBlank=saved.momentGlobalHeadBlank===true;
    if(["all","one","none"].includes(String(saved.unitCellMode||""))) cifState.structureUnitCellMode=String(saved.unitCellMode);
    else cifState.structureUnitCellMode="one";
    cifState.structureUnitCellReference=saved.unitCellReference==="magnetic"?"magnetic":"crystallographic";
    cifState.structureShowXYZ=saved.showXYZ!==false;
    cifState.structureBondDisplayMode=["bonds","polyhedral","both"].includes(saved.structureBondDisplayMode) ? saved.structureBondDisplayMode : "bonds";
    // A persisted cutoff such as 1e100 must never trigger a geometry rebuild
    // on the first load. Disable it against the CURRENT unit-cell diagonal,
    // preserving its entered value so it can be corrected later.
    const limit=styleCellDiagonalForViewer();
    cifState.restoredStructureBondRules=Array.isArray(saved.bonds)?saved.bonds.map(x=>{
      const rule={...x};
      // Old saves had one global Bonds/Polyhedral/Both mode. Migrate only
      // fields that are absent; never overwrite a newly saved checkbox.
      const oldMode=cifState.structureBondDisplayMode;
      if(typeof rule.bonds!=='boolean') rule.bonds=oldMode!=='polyhedral';
      if(typeof rule.polyhedral!=='boolean') rule.polyhedral=oldMode==='polyhedral'||oldMode==='both';
      const min=Number(rule.minDistance??0);
      const max=Number(rule.maxDistance??rule.distance??3);
      if(!Number.isFinite(limit) || !safeStyleDistances(min,max,limit))rule.enabled=false;
      return rule;
    }):[];
    cifState.structureControlSignature="";
    
    const unitCellSelect=$("cifUnitCellMode"); if(unitCellSelect) unitCellSelect.value=cifState.structureUnitCellMode;
    const referenceSelect=$("cifUnitCellReference"); if(referenceSelect) referenceSelect.value=cifState.structureUnitCellReference;
    const xyzSelect=$("cifShowXYZ"); if(xyzSelect) xyzSelect.value=cifState.structureShowXYZ?"show":"hide";
    return true;
  }finally{ restoringStructureViewer=false; }
}
}
