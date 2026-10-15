// Per-site atom colours, sizes and visibility, and the structure passed to the viewer.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';

export function installAtomAppearance(ctx){
  const {deps:{
    $, getSelectedCifFileName, getSelectedCifStructure, getSelectedCifText
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    atomDisplayColor, atomDisplaySize, atomIsVisible, atomSiteKey, complementaryAtomOutlineColor,
    currentStructureForViewer, elementRadius, parentAppearanceOrbits
  });
// Site-level presentation overrides are separate from crystallographic data.
// Using sourceSiteIndex keeps symmetry-generated mates together with their site.
cifState.atomSiteColors=new Map(); cifState.atomSiteSizes=new Map(); cifState.atomSiteVisibility=new Map();
cifState.expandedAtomElements=new Set();
// Appearance in an mCIF is grouped by PARENT crystallographic orbits;
// magnetic moments and their sourceSiteIndex remain in the original magnetic
// supercell. This makes Ni(1) refer to all symmetry-equivalent Ni positions.
const appearanceOrbitCache=new WeakMap();
function applyParentSymmetryOperation(operation,xyz){
  const parts=String(operation).split(',');
  if(parts.length!==3)return null;
  const fraction=t=>{
    if(t==='-'||t==='+')return t==='-'?-1:1;
    if(!t)return 1;
    const bits=t.split('/');
    const result=bits.length===2?Number(bits[0])/Number(bits[1]):Number(t);
    return Number.isFinite(result)?result:NaN;
  };
  return parts.map(expr=>{
    let value=0;
    for(const term of String(expr).replace(/\s/g,'').replace(/-/g,'+-').split('+').filter(Boolean)){
      const m=term.match(/[xyz]/i);
      if(m) value+=fraction(term.replace(m[0],''))*xyz['xyz'.indexOf(m[0].toLowerCase())];
      else value+=fraction(term);
    }
    return ((value%1)+1)%1;
  });
}
function parentAppearanceOrbits(structure){
  const selected=getSelectedCifStructure();
  if(!structure?.magnetic || !selected ||
      structure.asymmetricSites!==selected.asymmetricSites)return null;
  if(appearanceOrbitCache.has(selected))return appearanceOrbitCache.get(selected);
  const text=getSelectedCifText();
  const parent=fn.crystallographicStructureFromMcif(selected,text);
  const qs=fn.propagationVectorsFromMcif(text,selected);
  const relation=qs.length<=1 ? parentIndexingFromMcif(text,selected.lattice,
    qs.length?[qs[0].h,qs[0].k,qs[0].l]:null) : null;
  if(!parent?.asymmetricSites?.length || !relation?.replication){
    appearanceOrbitCache.set(selected,null);return null;
  }
  const ops=fn.findGeneratorSpaceGroup(parent)?.operations||['x,y,z'];
  const equiv=(a,b)=>a.every((x,i)=>Math.abs(x-b[i]-Math.round(x-b[i]))<2e-4);
  const orbitPoints=parent.asymmetricSites.map(site=>ops.map(op=>
    applyParentSymmetryOperation(op,[site.x,site.y,site.z]).map(v=>v)));
  const siteMap=new Map();
  for(const [index,site] of selected.asymmetricSites.entries()){
    const xyz=['x','y','z'].map((key,i)=>((Number(site[key])*relation.replication[i])%1+1)%1);
    const which=parent.asymmetricSites.findIndex((p,j)=>p.element===site.element &&
      orbitPoints[j].some(point=>equiv(point,xyz)));
    if(which>=0)siteMap.set(index,which);
  }
  const expanded=fn.parentNuclearStructureFromMcif(selected,text)?.atoms||[];
  const manualMap=new Map();
  const fracMatch=(a,b)=>a.every((v,i)=>Math.abs(v-b[i]-Math.round(v-b[i]))<2e-4);
  for(const [index,site] of selected.asymmetricSites.entries()){
    const xyz=['x','y','z'].map((key,i)=>((Number(site[key])*relation.replication[i])%1+1)%1);
    const target=expanded.findIndex(atom=>atom.element===site.element &&
      fracMatch(xyz,[atom.x,atom.y,atom.z].map(Number)));
    if(target>=0) manualMap.set(index,`manual-site:${target}`);
  }
  const counts=new Map();
  const manualSites=expanded.map(atom=>{
    const el=String(atom.element),n=(counts.get(el)||0)+1;counts.set(el,n);
    return {...atom,label:`${el}${n}`};
  });
  const metadata={sites:parent.asymmetricSites,siteMap,replication:relation.replication,
    orbitPoints,manualSites,manualMap};
  appearanceOrbitCache.set(selected,metadata);
  return metadata;
}
function atomSiteKey(atom){
  const index=Number(atom?.appearanceSiteIndex??atom?.sourceSiteIndex);
  if(typeof atom?.appearanceSiteKey==='string') return atom.appearanceSiteKey;
  return Number.isInteger(index)&&index>=0 ? `site:${index}` : null;
}
function atomDisplayColor(atom){
  const key=atomSiteKey(atom);
  return (key&&cifState.atomSiteColors.get(key)) || fn.elementColor(atom.element);
}
// Complementary hue for the selection ring, calculated from the SAME displayed
// atom color (including an individual site's override in the Atoms table).
// Keep the existing selection ring size, gap and stroke independent of color.
function complementaryAtomOutlineColor(color){
  const value=String(color||'').trim();
  const hex=value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if(!hex)return '#000000';
  const full=hex[1].length===3 ? [...hex[1]].map(ch=>ch+ch).join('') : hex[1];
  const rgb=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255);
  const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;
  const lightness=(max+min)/2;
  // Grey and near-grey atoms have no well-defined hue: use brightness contrast.
  if(delta<0.015)return lightness>0.55?'#252525':'#dedede';
  let hue;
  if(max===rgb[0])hue=((rgb[1]-rgb[2])/delta)%6;
  else if(max===rgb[1])hue=(rgb[2]-rgb[0])/delta+2;
  else hue=(rgb[0]-rgb[1])/delta+4;
  hue=((hue*60+180)%360+360)%360;
  const saturation=delta/(1-Math.abs(2*lightness-1));
  return fn.hslToHex(hue,saturation*100,lightness*100);
}
function atomDisplaySize(atom){
  const key=atomSiteKey(atom);
  return key&&cifState.atomSiteSizes.has(key) ? cifState.atomSiteSizes.get(key) : elementRadius(atom.element);
}
function atomIsVisible(atom){
  const key=atomSiteKey(atom);
  return cifState.structureAtomVisibility.get(String(atom.element))!==false && !(key&&cifState.atomSiteVisibility.get(key)===false);
}
function defaultElementRadius(_element){
  return 10;
}
function elementRadius(element){
  const override=Number(cifState.structureAtomSizeOverrides.get(String(element||"")));
  return Number.isFinite(override) ? Math.max(2,Math.min(30,override)) : defaultElementRadius(element);
}
function withEditedMagneticCell(source){
  if(!source?.structure?.magnetic || $("cifMagneticCellBox")?.hidden)return source;
  const lattice={};
  for(const [key,id] of Object.entries(cifState.CIF_MAG_LATTICE_FIELDS)){
    const raw=$(id)?.value;
    const value=Number(raw);
    if(raw==='' || !Number.isFinite(value) || value<=0)return source;
    if(['alpha','beta','gamma'].includes(key) && value>=180)return source;
    lattice[key]=value;
  }
  return {...source,structure:{...source.structure,lattice}};
}
function currentStructureForViewer(){
  // Symmetry/Manual only changes the Atomic Positions editor representation.
  // Preview sources and crystallographic-cell framing must not change on a
  // Mode toggle. An explicitly generated/Set CIF can still become the source.
  if(cifState.cifStructureSourcePreference==="loaded" && cifState.loadedGeneratorCifStructure)
    return withEditedMagneticCell({structure:cifState.loadedGeneratorCifStructure,label:cifState.loadedGeneratorCifName||"loaded mCIF",kind:"loaded"});
  const preferSelected=cifState.cifStructureSourcePreference==="selected";
  if(preferSelected && getSelectedCifStructure())
    return withEditedMagneticCell({structure:getSelectedCifStructure(), label:getSelectedCifFileName()||"selected CIF", kind:"selected"});
  try{
    const generated=fn.buildGeneratedCif();
    return {structure:generated.parsed, label:generated.filename, kind:"draft"};
  }catch(_err){ /* fall back below */ }
  if(cifState.lastGeneratedCifParsed) return {structure:cifState.lastGeneratedCifParsed, label:cifState.lastGeneratedCifName, kind:"generated"};
  if(getSelectedCifStructure())
    return withEditedMagneticCell({structure:getSelectedCifStructure(), label:getSelectedCifFileName()||"selected CIF", kind:"selected"});
  return null;
}
}
