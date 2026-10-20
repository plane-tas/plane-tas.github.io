// Parent crystallographic cell reconstruction for imported mCIF files.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
import {parentIndexingFromMcif} from '../../magnetic/magnetic-reflections.js';

export function installMcifParentCell(ctx){
  const {deps:{
    parseNumericValue
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    crystallographicStructureFromMcif, estimatedParentIndexingFromMcif,
    parentNuclearStructureFromMcif, propagationVectorsFromMcif
  });

function propagationVectorsFromMcif(text,parsed){
  const lines=String(text||'').replace(/\r/g,'').split('\n');
  const result=[];
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim().toLowerCase()!=='loop_') continue;
    let j=i+1, tags=[];
    while(j<lines.length && lines[j].trim().startsWith('_')){tags.push(lines[j].trim().toLowerCase());j++;}
    const idx=tags.findIndex(tag=>['_parent_propagation_vector.kxkykz','_parent_propagation_vector_kxkykz'].includes(tag));
    if(idx<0) continue;
    while(j<lines.length){
      const row=lines[j].trim();
      if(!row || row.startsWith('#')){j++;continue;}
      if(row==='loop_' || row.startsWith('_') || /^data_/i.test(row)) break;
      const match=row.match(/\[([^\]]+)\]/);
      const components=match ? match[1].split(/[\s,]+/) : row.split(/\s+/).slice(idx,idx+3);
      // mCIF propagation vectors commonly use rational components (e.g. 3/2).
      // Number("3/2") is NaN; use the shared numeric parser instead.
      const nums=components.map(component=>parseNumericValue(component));
      if(nums.length===3 && nums.every(Number.isFinite)) result.push({h:nums[0],k:nums[1],l:nums[2],enabled:true});
      j++;
    }
  }
  // Single (non-loop) form: _parent_propagation_vector.kxkykz "[0 0 0]"
  if(!result.length){
    for(let i=0;i<lines.length;i++){
      const m=lines[i].trim().match(/^_parent_propagation_vector[._]kxkykz(?:\s+(.*))?$/i);
      if(!m) continue;
      let value=(m[1]||'').trim();
      if(!value && i+1<lines.length) value=lines[i+1].trim();
      const bracket=value.match(/\[([^\]]+)\]/);
      const components=(bracket ? bracket[1] : value.replace(/^["']|["']$/g,'')).split(/[\s,]+/).filter(Boolean);
      const nums=components.map(component=>parseNumericValue(component));
      if(nums.length===3 && nums.every(Number.isFinite)) result.push({h:nums[0],k:nums[1],l:nums[2],enabled:true});
    }
  }
  if(!result.length && parsed?.incommensurateSingleQ) for(const q of (parsed.propagationVectors||[])) result.push({h:q.h,k:q.k,l:q.l,enabled:true});
  return result;
}

// An app-generated commensurate mCIF stores its atomic motif in the magnetic
// supercell. The Sample and nuclear reflections must instead use the parent
// crystallographic cell. Generic external mCIF settings are not inferred.
// A *candidate* parent is inferred only when repeated nuclear-site patterns
// independently verify a diagonal translation period. BNS alone does NOT fix
// the conventional parent setting, metric or origin. This path is explicitly
// marked Estimated throughout the editor and nuclear-reflection output.
function estimatedParentIndexingFromMcif(parsed,text){
  if(!parsed?.magnetic || !Array.isArray(parsed.atoms) || !parsed.atoms.length)return null;
  // If the author supplied a transform that we cannot handle, do not
  // silently replace it with a different guessed diagonal transform.
  if(/^\s*_parent_space_group[._](?:child_transform_Pp_abc|transform_Pp_abc)(?=\s|$)/im.test(String(text||'')))return null;
  const q=propagationVectorsFromMcif(text,parsed);
  if(q.length!==1)return null;
  const nums=[q[0].h,q[0].k,q[0].l].map(Number);
  if(!nums.every(Number.isFinite))return null;
  // A finite parent supercell is not a valid construction for incommensurate q.
  const denominator=v=>{
    for(let d=1;d<=12;d++)if(Math.abs(v*d-Math.round(v*d))<1e-8*d)return d;
    return null;
  };
  const replication=nums.map(denominator);
  if(replication.some(n=>n===null)||replication.every(n=>n===1))return null;
  const nCells=replication.reduce((x,y)=>x*y,1);
  if(nCells>128||parsed.atoms.length>4000||parsed.atoms.length%nCells!==0)return null;
  const wrap=v=>((v%1)+1)%1;
  // 1e-4 grid: tolerant of coordinates rounded to ~6 decimals in the file.
  const quant=v=>Math.round(wrap(v)*1e4)%10000;
  const key=atom=>[
    atom.element,Number(atom.occupancy??1).toFixed(6),
    ...['x','y','z'].map((ax,i)=>quant(Number(atom[ax])*replication[i]))
  ].join('|');
  const groups=new Map();
  for(const atom of parsed.atoms){
    if(!['x','y','z'].every(ax=>Number.isFinite(Number(atom[ax]))))return null;
    const k=key(atom);
    const group=groups.get(k)||[];group.push(atom);groups.set(k,group);
  }
  if(groups.size*nCells!==parsed.atoms.length)return null;
  // Check all magnetic images are present, not just their count. Missing
  // centering operations or a misidentified period must fail closed.
  for(const atoms of groups.values()){
    if(atoms.length!==nCells)return null;
    const codes=new Set(atoms.map(a=>['x','y','z'].map((ax,i)=>
      ((Math.floor(wrap(Number(a[ax]))*replication[i]+1e-7)%replication[i])+replication[i])%replication[i]
    ).join(',')));
    if(codes.size!==nCells)return null;
  }
  const lattice={...parsed.lattice};
  for(const [i,axis] of ['a','b','c'].entries()){
    lattice[axis]=Number(lattice[axis])/replication[i];
    if(!Number.isFinite(lattice[axis])||lattice[axis]<=0)return null;
  }
  return {replication,lattice,reference:'Estimated: verified nuclear translation periodicity (diagonal candidate)',estimated:true};
}

function parentNuclearStructureFromMcif(parsed,text){
  if(!parsed?.magnetic || !Array.isArray(parsed.atoms) || !parsed.atoms.length) return null;
  // Some writers (e.g. FullProf) omit the propagation-vector loop. An explicit
  // diagonal child transform still fixes the parent cell without k.
  const q=propagationVectorsFromMcif(text,parsed);
  if(q.length>1) return null;
  const parent=parentIndexingFromMcif(text,parsed.lattice,q.length?[q[0].h,q[0].k,q[0].l]:null)
    || (q.length===1 ? estimatedParentIndexingFromMcif(parsed,text) : null);
  if(!parent) return null;
  const rep=parent.replication;
  // A child supercell must be a translation period of every commensurate k.
  if(q.length===1 && ![q[0].h,q[0].k,q[0].l].every((v,i)=>
       Number.isFinite(Number(v))&&Math.abs(Number(v)*rep[i]-Math.round(Number(v)*rep[i]))<1e-8))return null;
  const wrap=v=>{const w=((v%1)+1)%1;return Math.abs(w-1)<1e-8 || w<1e-8?0:w;};
  // Translated copies must be merged with a tolerance: mCIF coordinates are
  // usually rounded (e.g. 0.111111 / 0.444444), so after scaling to the parent
  // cell two copies of one site can differ by a few 1e-6. Exact-key merging
  // kept every copy and made nuclear |F|^2 N^2 times too large.
  const tol=1e-4;
  const same=(a,b)=>a.every((v,i)=>{const d=v-b[i];return Math.abs(d-Math.round(d))<tol;});
  const merged=[];
  for(const atom of parsed.atoms){
    const position=['x','y','z'].map((key,i)=>wrap(Number(atom[key])*rep[i]));
    if(position.some(v=>!Number.isFinite(v))) return null;
    const occupancy=Number(atom.occupancy??1);
    const hit=merged.some(site=>site.element===atom.element &&
      Math.abs(Number(site.occupancy??1)-occupancy)<1e-5 && same(site.position,position));
    if(!hit){
      // Magnetism does not alter nuclear scattering lengths, occupancies or Biso.
      // Never attach magnetic moments to a nuclear reflection model.
      const {magneticMoment,magneticFourier,...nuclearAtom}=atom;
      merged.push({element:atom.element,occupancy,position,
        atom:{...nuclearAtom,x:position[0],y:position[1],z:position[2]}});
    }
  }
  return {...parsed,lattice:parent.lattice,atoms:merged.map(site=>site.atom),magnetic:false,
    parentCellReference:parent.reference,parentCellEstimated:!!parent.estimated,parentCellKZero:!!parent.kZero,
    parentReplication:parent.replication};
}

// mCIF may contain a magnetic supercell and a distinct parent (nuclear) cell.
// Only convert coordinates if the source explicitly declares an unambiguous
// parent-index mapping (parentNuclearStructureFromMcif enforces this).
function originalParentSpaceGroup(text){
  const scalar=Object.create(null);
  for(const line of String(text||'').split(/\r?\n/)){
    const m=line.trim().match(/^(_parent_space_group(?:\.|_)[^\s]+)\s+(.+?)\s*$/i);
    if(m)scalar[m[1].toLowerCase()]=m[2].split(/\s+#/)[0].replace(/^['"]|['"]$/g,'').trim();
  }
  const value=(...keys)=>keys.map(key=>scalar[key]).find(v=>v!==undefined);
  const raw=value('_parent_space_group.it_number','_parent_space_group_it_number');
  const n=Number(raw);
  return {
    number:Number.isInteger(n)&&n>=1&&n<=230?n:null,
    name:value('_parent_space_group.name_h-m_alt','_parent_space_group_name_h-m_alt')||''
  };
}
// The magnetic P1 export lists *all* sites. Before using parent symmetry in
// the editable nuclear cell, collapse those expanded sites into true orbits.
function parentSiteOrbitRepresentatives(atoms,operations){
  if(!Array.isArray(atoms)||!atoms.length)return [];
  if(atoms.length>3000 || !Array.isArray(operations)||operations.length>192) return null;
  const wrap=v=>((v%1)+1)%1;
  const parseFraction=s=>{const [a,b]=String(s).split('/');return b!==undefined?Number(a)/Number(b):Number(a);};
  const transform=(expression,xyz)=>{
    let result=0;
    for(const term of String(expression).replace(/\s/g,'').replace(/-/g,'+-').split('+').filter(Boolean)){
      const symbol=term.match(/[xyz]/);
      if(!symbol)result+=parseFraction(term);
      else{
        const idx='xyz'.indexOf(symbol[0]);
        const c=term.replace(symbol[0],'');
        result+=parseFraction(!c||c==='+'?'1':c==='-'?'-1':c)*xyz[idx];
      }
    }
    return wrap(result);
  };
  const orbits=[];
  const close=(a,b)=>Math.abs(a-b-Math.round(a-b))<2e-5;
  for(const atom of atoms){
    const xyz=[atom.x,atom.y,atom.z].map(Number);
    if(!xyz.every(Number.isFinite))return null;
    const already=orbits.some(rep=>{
      if(rep.element!==atom.element||Math.abs(Number(rep.occupancy??1)-Number(atom.occupancy??1))>1e-5)return false;
      const r=[rep.x,rep.y,rep.z].map(Number);
      return operations.some(op=>{
        const expressions=String(op).split(',');
        if(expressions.length!==3)return false;
        const transformed=expressions.map(expr=>transform(expr,r));
        return transformed.every((v,i)=>Number.isFinite(v)&&close(v,xyz[i]));
      });
    });
    if(!already)orbits.push({...atom});
  }
  return orbits;
}
function crystallographicStructureFromMcif(parsed,text){
  if(!parsed?.magnetic)return null;
  const nuclear=parentNuclearStructureFromMcif(parsed,text);
  if(!nuclear)return null;
  const parent=originalParentSpaceGroup(text);
  const sg=cifState.cifSpaceGroups.find(g=>g.number===parent.number);
  // When the actual parent setting is not documented, P1 is only an
  // indexing/calculation fallback, NOT a claim that the parent SG is P1.
  // k = 0 without a parent space group: the cell is certain, P1 is the basis.
  if(!sg && !nuclear.parentCellEstimated && !nuclear.parentCellKZero)return null;
  const operations=sg?.operations||['x,y,z'];
  const sites=parentSiteOrbitRepresentatives(nuclear.atoms,operations);
  if(!sites?.length)return null;
  return {...nuclear,spaceGroupNumber:sg?.number||1,spaceGroup:sg?(parent.name||sg.hm):'P1 (calculation basis only)',
    asymmetricSites:sites,asymmetricSiteCount:sites.length,
    symmetryOperationCount:operations.length};
}
}
