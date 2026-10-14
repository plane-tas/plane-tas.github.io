// Atom replication, bond traces and coordination polyhedra.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installStructureTraces(ctx){
  const {state:cifState, fn}=ctx;
  Object.assign(fn,{
    bondTraces, coordinationPolyhedralTraces, estimateStructureReplicationTests, replicatedAtoms
  });
function estimateStructureReplicationTests(structure,range){
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length?structure.atoms:structure?.asymmetricSites||[]);
  let tests=base.length;
  for(const axis of ['x','y','z']){
    const bounds=fn.rangeCellBounds(range[axis]);
    const n=bounds.to-bounds.from+5;
    if(!Number.isFinite(n)||n<0)return Infinity;
    tests*=n;
    if(!Number.isFinite(tests)||tests>cifState.STRUCTURE_MAX_REPLICATION_TESTS)return Infinity;
  }
  return tests;
}
function replicatedAtoms(structure,range){
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length?structure.atoms:structure?.asymmetricSites||[]);
  // Final guard even if the caller forgot a preflight check.
  if(estimateStructureReplicationTests(structure,range)>cifState.STRUCTURE_MAX_REPLICATION_TESTS)return [];
  const out=[];
  const appearance=fn.parentAppearanceOrbits(structure);
  const manual=cifState.structurePositionEditingMode==='individual' && !!appearance;
  const appearanceMap=manual?appearance.manualMap:appearance?.siteMap;
  const xb=fn.rangeCellBounds(range.x), yb=fn.rangeCellBounds(range.y), zb=fn.rangeCellBounds(range.z);
  const eps=1e-9;
  for(let ix=xb.from-2;ix<=xb.to+2;ix++) for(let iy=yb.from-2;iy<=yb.to+2;iy++) for(let iz=zb.from-2;iz<=zb.to+2;iz++){
    for(const [expandedAtomIndex,atom] of base.entries()){
      const phaseX=fn.fracWrap01(atom.x)+ix, phaseY=fn.fracWrap01(atom.y)+iy, phaseZ=fn.fracWrap01(atom.z)+iz;
      const x=phaseX, y=phaseY, z=phaseZ;
      if(x<range.x.min-eps||x>range.x.max+eps||y<range.y.min-eps||y>range.y.max+eps||z<range.z.min-eps||z>range.z.max+eps) continue;
      const parentAppearanceIndex=appearanceMap?.get(atom.sourceSiteIndex);
      out.push({...atom,x,y,z,phaseX,phaseY,phaseZ,cell:[ix,iy,iz],expandedAtomIndex,
        ...(Number.isInteger(parentAppearanceIndex)?{appearanceSiteIndex:parentAppearanceIndex}:{}) ,
        ...(typeof parentAppearanceIndex==='string'?{appearanceSiteKey:parentAppearanceIndex}:{}
        ),...(!appearance && cifState.structurePositionEditingMode==='individual'
          ?{appearanceSiteKey:`manual-site:${expandedAtomIndex}`}:{})});
    }
  }
  return out;
}
function bondMatchesPair(rule,a,b){ return (rule.a===a&&rule.b===b)||(rule.a===b&&rule.b===a); }
function bondTraces(atoms,basis,rules){
  const traces=[];
  const warnings=[];
  if(atoms.length>cifState.STYLE_MAX_BOND_ATOMS){
    traces.warning=`Bonds skipped: more than ${cifState.STYLE_MAX_BOND_ATOMS} visible atoms. Reduce the Structure range.`;
    return traces;
  }
  const activeRules=rules.filter(rule=>rule.enabled!==false);
  if(activeRules.length>cifState.STYLE_MAX_BOND_RULES){
    traces.warning=`Bonds skipped: more than ${cifState.STYLE_MAX_BOND_RULES} active Style rows.`;
    return traces;
  }
  // Budget the PAIR SEARCH as well as the output, so many active rows do
  // not freeze the UI even when each distance is crystallographically valid.
  const pairTests=atoms.length*(atoms.length-1)/2*activeRules.length;
  if(pairTests>2400000){
    traces.warning='Bonds skipped: too many atom-pair tests. Reduce repeat ranges or Style rules.';
    return traces;
  }
  const limit=fn.styleCellDiagonalLimit(basis);
  const xyz=atoms.map(atom=>fn.fractionalToCartesian(basis,[atom.x,atom.y,atom.z]));
  let allSegments=0;
  for(const rule of activeRules){
    if(!Number.isFinite(limit) || !fn.safeStyleDistances(Number(rule.minDistance),Number(rule.maxDistance),limit)) {
      warnings.push(`Style ${rule.a}-${rule.b} skipped: Max exceeds the unit-cell diagonal.`);
      continue;
    }
    const x=[],y=[],z=[];
    let budgetReached=false;
    for(let i=0;i<atoms.length&&!budgetReached;i++){
      const ai=atoms[i];
      for(let j=i+1;j<atoms.length;j++){
        const aj=atoms[j];
        if(!bondMatchesPair(rule,String(ai.element),String(aj.element))) continue;
        const pi=xyz[i],pj=xyz[j];
        const d=fn.vecNorm(fn.vecSub(pj,pi));
        if(!(d>1e-6)||d<rule.minDistance-1e-9||d>rule.maxDistance+1e-9) continue;
        if(++allSegments>cifState.STYLE_MAX_BOND_SEGMENTS){budgetReached=true;break;}
        x.push(pi[0],pj[0],null);y.push(pi[1],pj[1],null);z.push(pi[2],pj[2],null);
      }
    }
    // Don't return huge partial geometry with misleading results.
    if(budgetReached){
      // No partial rendering: return an empty, explicitly warned result.
      const skipped=[];
      skipped.warning=`Bonds skipped: more than ${cifState.STYLE_MAX_BOND_SEGMENTS} segments; reduce Max or the display range.`;
      return skipped;
    }
    if(x.length) traces.push({type:"scatter3d",mode:"lines",x,y,z,name:`${rule.a}-${rule.b} ${rule.minDistance}–${rule.maxDistance} Å`,hoverinfo:"skip",showlegend:false,line:{color:rule.color,width:Math.max(1,Number(rule.width)||5)}});
  }
  traces.warning=warnings.join(' ');
  return traces;
}
// Convex hull of a coordination shell. Build each planar face only once,
// including faces with four or more coplanar ligand atoms (e.g. octahedra).
// No external geometry package is required by the CIF Generator.
function coordinationHullTriangles(points){
  if(points.length<4)return [];
  const centre=[0,0,0];
  for(const p of points){centre[0]+=p[0];centre[1]+=p[1];centre[2]+=p[2];}
  for(let a=0;a<3;a++)centre[a]/=points.length;
  const span=Math.max(1,...points.map(p=>fn.vecNorm(fn.vecSub(p,centre))));
  const tolerance=span*1e-6;
  const seenFaces=new Set(),triangles=[];
  const projectedCross=(a,b,c)=> (b.u-a.u)*(c.v-a.v)-(b.v-a.v)*(c.u-a.u);
  for(let i=0;i<points.length-2;i++)for(let j=i+1;j<points.length-1;j++)for(let k=j+1;k<points.length;k++){
    let normal=fn.vecCross(fn.vecSub(points[j],points[i]),fn.vecSub(points[k],points[i]));
    const magnitude=fn.vecNorm(normal);
    if(magnitude<tolerance*tolerance)continue;
    normal=fn.vecScale(normal,1/magnitude);
    let front=false,back=false;
    for(const p of points){
      const d=fn.vecDot(normal,fn.vecSub(p,points[i]));
      if(d>tolerance)front=true;
      if(d< -tolerance)back=true;
      if(front&&back)break;
    }
    if(front&&back)continue; // plane cuts through the point cloud
    if(fn.vecDot(normal,fn.vecSub(centre,points[i]))>0)normal=fn.vecScale(normal,-1);
    const coplanar=[];
    for(let m=0;m<points.length;m++){
      if(Math.abs(fn.vecDot(normal,fn.vecSub(points[m],points[i])))<=tolerance)coplanar.push(m);
    }
    const key=coplanar.join(',');
    if(seenFaces.has(key))continue;
    seenFaces.add(key);
    // Project this face onto an outward-oriented 2D frame, then obtain its
    // perimeter (ignore atoms in the interior of a flat face).
    const u=fn.vecNormalize(fn.vecSub(points[j],points[i]));
    const v=fn.vecCross(normal,u);
    const projected=coplanar.map(idx=>({idx,
      u:fn.vecDot(points[idx],u),v:fn.vecDot(points[idx],v)}))
      .sort((a,b)=>a.u-b.u||a.v-b.v);
    const lower=[],upper=[];
    for(const p of projected){
      while(lower.length>=2 && projectedCross(lower[lower.length-2],lower[lower.length-1],p)<=tolerance)lower.pop();
      lower.push(p);
    }
    for(let m=projected.length-1;m>=0;m--){
      const p=projected[m];
      while(upper.length>=2 && projectedCross(upper[upper.length-2],upper[upper.length-1],p)<=tolerance)upper.pop();
      upper.push(p);
    }
    const outline=lower.slice(0,-1).concat(upper.slice(0,-1));
    for(let t=1;t<outline.length-1;t++)triangles.push([outline[0].idx,outline[t].idx,outline[t+1].idx]);
  }
  // A planar shell is not a 3D polyhedron.
  const volume6=triangles.reduce((sum,[i,j,k])=>sum+fn.vecDot(points[i],fn.vecCross(points[j],points[k])),0);
  return Math.abs(volume6)>tolerance*tolerance*tolerance ? triangles:[];
}
// Polyhedral selection is local to each displayed centre. We NEVER expand
// all atoms across the full Structure view just to find one coordination shell.
// These counts limit CPU/WebGL work, not crystallographic bond distances.
const POLY_MAX_RULES=12;
const POLY_MAX_CENTRES=256;
            // Count actual A1 centres, not all atoms
const POLY_MAX_HULL_VERTICES=12;
const POLY_MAX_TRIANGLES=4800;
const POLY_MAX_PAIR_TESTS=2500000;
     // Shared budget across all local searches
const POLY_MAX_BASE_LIGANDS=20000;
// Find up to 12 nearest A2 periodic images inside [Min, Max]. Increasing the
// search radius in stages means even a large crystallographically valid Max
// usually needs only the first coordination shell. The reciprocal-vector
// bounds are exact for *skew* lattices: any Cartesian displacement shorter
// than R must have |delta_fractional_i| <= R |reciprocal_i|.
function nearestPeriodicPolyhedralLigands(centre,ligandSites,basis,minDistance,maxDistance,budget){
  const origin=fn.fractionalToCartesian(basis,[centre.x,centre.y,centre.z]);
  const reciprocal=[fn.vecNorm(basis.astar),fn.vecNorm(basis.bstar),fn.vecNorm(basis.cstar)];
  const translationBasis=[basis.a,basis.b,basis.c];
  let searchRadius=Math.min(maxDistance,Math.max(2.5,minDistance+1));
  const epsilon=1e-8;
  while(true){
    const nearest=[];
    const radiusSq=searchRadius*searchRadius;
    const minSq=Math.max(1e-12,(minDistance-1e-9)**2);
    for(const site of ligandSites){
      const shift=[];
      for(let a=0;a<3;a++){
        const centreFrac=[centre.x,centre.y,centre.z][a];
        const siteFrac=[site.x,site.y,site.z][a];
        const reach=searchRadius*reciprocal[a]+epsilon;
        const lo=Math.ceil(centreFrac-siteFrac-reach);
        const hi=Math.floor(centreFrac-siteFrac+reach);
        shift.push([lo,hi]);
      }
      // Prevent an accidental Cartesian-product explosion BEFORE the loops.
      const possible=shift.reduce((n,[lo,hi])=>n*Math.max(0,hi-lo+1),1);
      if(!Number.isFinite(possible)||budget.tests+possible>POLY_MAX_PAIR_TESTS)
        return {points:[],warning:'Polyhedra not drawn: local neighbor-search safety budget exceeded. Reduce Max, the Style rules, or the number of centres.'};
      if(!possible)continue;
      const siteCart=fn.fractionalToCartesian(basis,[site.x,site.y,site.z]);
      for(let nx=shift[0][0];nx<=shift[0][1];nx++){
        const dx=fn.vecAdd(fn.vecSub(siteCart,origin),fn.vecScale(translationBasis[0],nx));
        for(let ny=shift[1][0];ny<=shift[1][1];ny++){
          const dxy=fn.vecAdd(dx,fn.vecScale(translationBasis[1],ny));
          for(let nz=shift[2][0];nz<=shift[2][1];nz++){
            budget.tests++;
            const delta=fn.vecAdd(dxy,fn.vecScale(translationBasis[2],nz));
            const d2=fn.vecDot(delta,delta);
            if(d2<minSq||d2>radiusSq+1e-8)continue;
            if(nearest.length===POLY_MAX_HULL_VERTICES && d2>=nearest[nearest.length-1].d2-epsilon)continue;
            const p=fn.vecAdd(origin,delta);
            if(nearest.some(item=>fn.vecDot(fn.vecSub(item.p,p),fn.vecSub(item.p,p))<1e-10))continue;
            const at=nearest.findIndex(item=>d2<item.d2);
            nearest.splice(at<0?nearest.length:at,0,{p,d2});
            if(nearest.length>POLY_MAX_HULL_VERTICES)nearest.pop();
          }
        }
      }
    }
    if(nearest.length>=POLY_MAX_HULL_VERTICES || searchRadius>=maxDistance-1e-8)
      return {points:nearest.map(item=>item.p),warning:''};
    searchRadius=Math.min(maxDistance,Math.max(searchRadius*2,searchRadius+1));
  }
}
function coordinationPolyhedralTraces(centres,structure,basis,rules){
  const traces=[];
  const activeRules=rules.filter(rule=>rule.enabled!==false);
  if(activeRules.length>POLY_MAX_RULES)
    return {traces,warning:`Polyhedra not drawn: more than ${POLY_MAX_RULES} active Style rules.`};
  const maxCutoff=fn.styleCellDiagonalLimit(basis);
  if(!Number.isFinite(maxCutoff) || activeRules.some(r=>
      !fn.safeStyleDistances(Number(r.minDistance),Number(r.maxDistance),maxCutoff)))
    return {traces,warning:'Polyhedra not drawn: invalid Min/Max or Max exceeds the unit-cell diagonal.'};
  const base=(Array.isArray(structure?.atoms)&&structure.atoms.length
    ?structure.atoms:structure?.asymmetricSites||[]);
  if(base.length>POLY_MAX_BASE_LIGANDS)
    return {traces,warning:'Polyhedra not drawn: too many source atoms for local neighbor search.'};
  const byElement=new Map();
  const appearance=fn.parentAppearanceOrbits(structure);
  const appearanceMap=cifState.structurePositionEditingMode==='individual'?appearance?.manualMap:appearance?.siteMap;
  for(const [index,atom] of base.entries()){
    const parentIndex=appearanceMap?.get(atom.sourceSiteIndex);
    const drawn=Number.isInteger(parentIndex)?{...atom,appearanceSiteIndex:parentIndex}
      :typeof parentIndex==='string'?{...atom,appearanceSiteKey:parentIndex}:
      cifState.structurePositionEditingMode==='individual'?{...atom,appearanceSiteKey:`manual-site:${index}`}:atom;
    if(!fn.atomIsVisible(drawn))continue;
    const name=String(atom.element);
    if(!byElement.has(name))byElement.set(name,[]);
    byElement.get(name).push(drawn);
  }
  const budget={tests:0};
  let totalTriangles=0;
  for(const rule of activeRules){
    const sourceCentres=centres.filter(atom=>String(atom.element)===rule.a);
    if(sourceCentres.length>POLY_MAX_CENTRES)
      return {traces:[],warning:`Polyhedra not drawn: more than ${POLY_MAX_CENTRES} centres of ${rule.a} in the Structure view. Reduce repeat ranges.`};
    const ligands=byElement.get(rule.b)||[];
    if(!sourceCentres.length||!ligands.length)continue;
    // One Plotly mesh per Style, not one WebGL trace per centre.
    const mesh={x:[],y:[],z:[],i:[],j:[],k:[]};
    for(const centre of sourceCentres){
      const local=nearestPeriodicPolyhedralLigands(centre,ligands,basis,
        Number(rule.minDistance),Number(rule.maxDistance),budget);
      if(local.warning)return {traces:[],warning:local.warning};
      if(local.points.length<4)continue;
      const faces=coordinationHullTriangles(local.points);
      if(!faces.length)continue;
      totalTriangles+=faces.length;
      if(totalTriangles>POLY_MAX_TRIANGLES)
        return {traces:[],warning:`Polyhedra not drawn: more than ${POLY_MAX_TRIANGLES} triangles. Reduce visible centres or display range.`};
      const offset=mesh.x.length;
      for(const p of local.points){mesh.x.push(p[0]);mesh.y.push(p[1]);mesh.z.push(p[2]);}
      for(const [i,j,k] of faces){mesh.i.push(offset+i);mesh.j.push(offset+j);mesh.k.push(offset+k);}
    }
    if(mesh.i.length)traces.push({type:'mesh3d',name:`${rule.a}-${rule.b} polyhedron`,
      ...mesh,color:rule.color,opacity:0.3,flatshading:true,
      lighting:{ambient:0.74,diffuse:0.65,specular:0.10,roughness:0.9},
      showlegend:false,hoverinfo:'skip'});
  }
  return {traces,warning:''};
}
}
