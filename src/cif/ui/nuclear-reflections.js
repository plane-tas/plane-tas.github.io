// Nuclear reflection table: beam/filters, calculation, sorting and rendering.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installNuclearReflections(ctx){
  const {deps:{
    $, RL_calc, canonicalReflectionHkl, checkedValue, clamp, compareHkl, cross, dot,
    getSelectedCifFileName, getSelectedCifStructure, getSelectedCifText, hklKey, hklToQ,
    makeSpiceScatteringPlaneBasis, norm, nuclearStructureFactorSquared, num, rad2deg,
    reciprocalSymmetryMatrices, reflectionStar
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    buildCifReflectionTable, clearCifReflectionRowSelection, currentCifReflectionBeam,
    currentCifReflectionFilters, nuclearReflectionSource, nuclearReflectionWithSampleLattice,
    nuclearStructureForSelectedCif,
    renderCifReflectionTable, setCifReflectionSort, sortedCifReflections, syncCifReflectionBeamFrom,
    syncCifReflectionBeamFromInstrument, updateCifReflectionSortHeaders
  });


// CIF reciprocal-space symmetry helpers are implemented in cif-symmetry.js.

function syncCifReflectionBeamFromInstrument(){
  const e=Number($("energy")?.value);
  if(!(e>0)) return;
  const wavelength=9.044/Math.sqrt(e);
  const wavevector=2*Math.PI/wavelength;
  if($("cifReflectionEnergy")) $("cifReflectionEnergy").value=e.toFixed(4);
  if($("cifReflectionWavelength")) $("cifReflectionWavelength").value=wavelength.toFixed(5);
  if($("cifReflectionWavevector")) $("cifReflectionWavevector").value=wavevector.toFixed(5);
}
function syncCifReflectionBeamFrom(source){
  let e,lambda,k;
  if(source==="wavelength"){
    lambda=Number($("cifReflectionWavelength")?.value);
    if(!(lambda>0)) return;
    e=(9.044/lambda)**2;
    k=2*Math.PI/lambda;
  }else if(source==="wavevector"){
    k=Number($("cifReflectionWavevector")?.value);
    if(!(k>0)) return;
    lambda=2*Math.PI/k;
    e=(9.044/lambda)**2;
  }else{
    e=Number($("cifReflectionEnergy")?.value);
    if(!(e>0)) return;
    lambda=9.044/Math.sqrt(e);
    k=2*Math.PI/lambda;
  }
  if($("cifReflectionEnergy")) $("cifReflectionEnergy").value=e.toFixed(5);
  if($("cifReflectionWavelength")) $("cifReflectionWavelength").value=lambda.toFixed(5);
  if($("cifReflectionWavevector")) $("cifReflectionWavevector").value=k.toFixed(5);
  // Reflect edits into the Instrument's active fixed Ei or Ef energy.
  const fixedEnergy=$("energy");
  if(fixedEnergy && Number(fixedEnergy.value)!==e){
    fixedEnergy.value=String(Number(e.toPrecision(12)));
    fixedEnergy.dispatchEvent(new Event("input",{bubbles:true}));
    fixedEnergy.dispatchEvent(new Event("change",{bubbles:true}));
  }
  fn.recalculateGeneratedReflections();
}
function currentCifReflectionBeam(){
  // The Generator starts from Instrument configuration, but Energy/Wavelength/
  // wavevector can be changed locally without changing the Instrument setup.
  const energyMode=checkedValue("energyMode") || $("energyMode")?.value;
  let enteredEnergy=Number($("cifReflectionEnergy")?.value);
  let wavelength=Number($("cifReflectionWavelength")?.value);
  let wavevector=Number($("cifReflectionWavevector")?.value);
  if(!(wavelength>0) && wavevector>0) wavelength=2*Math.PI/wavevector;
  if(!(enteredEnergy>0) && wavelength>0) enteredEnergy=(9.044/wavelength)**2;
  if(!(wavelength>0) && enteredEnergy>0) wavelength=9.044/Math.sqrt(enteredEnergy);
  if(!(wavevector>0) && wavelength>0) wavevector=2*Math.PI/wavelength;
  if(!(enteredEnergy>0) || !(wavelength>0) || !(wavevector>0)) throw new Error("Energy, wavelength, and wavevector must be greater than zero to calculate reflections.");
  const lambdaHalf=!!$("cifReflectionLambdaHalf")?.checked;
  const effectiveEnergy=lambdaHalf ? 4*enteredEnergy : enteredEnergy;
  const effectiveWavelength=lambdaHalf ? wavelength/2 : wavelength;
  return {energyMode,enteredEnergy,effectiveEnergy,lambdaHalf,wavelength:effectiveWavelength,baseWavelength:wavelength,wavevector};
}

function currentCifReflectionFilters(){
  return {
    alongU:!!$("cifReflectionAlongU")?.checked,
    alongV:!!$("cifReflectionAlongV")?.checked,
    withinS2Max:$("cifReflectionWithinS2Max")?.checked !== false
  };
}

function reflectionInCurrentScatteringPlane(rl,hkl){
  const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
  const {ez}=makeSpiceScatteringPlaneBasis(rl,U,V);
  const q=hklToQ(rl,hkl), qn=norm(q);
  return qn>1e-12 && Math.abs(dot(q,ez)) <= 1e-9*Math.max(1,qn);
}

function reflectionAlongCurrentAxis(rl,hkl,axisHkl){
  const q=hklToQ(rl,hkl), axis=hklToQ(rl,axisHkl);
  const qn=norm(q), an=norm(axis);
  if(!(qn>1e-12) || !(an>1e-12)) return false;
  return norm(cross(q,axis)) <= 1e-9*Math.max(1,qn*an);
}

function buildCifReflectionTable(structure,sg,wavelength,filters={alongU:true,alongV:true,withinS2Max:true},twoThetaMax=180){
  if(!structure?.lattice) throw new Error("Generated CIF has no valid lattice.");
  const lambda=Number(wavelength);
  if(!(lambda>0)) throw new Error("Reflection wavelength must be greater than zero.");
  const lattice=structure.lattice;
  const rl=RL_calc(lattice);
  const qMax=4*Math.PI/lambda;
  const hMax=Math.ceil(qMax*Number(lattice.a)/(2*Math.PI))+1;
  const kMax=Math.ceil(qMax*Number(lattice.b)/(2*Math.PI))+1;
  const lMax=Math.ceil(qMax*Number(lattice.c)/(2*Math.PI))+1;
  const candidateCount=(2*hMax+1)*(2*kMax+1)*(2*lMax+1)-1;
  if(candidateCount>3000000){
    throw new Error(`Reflection search is too large (${candidateCount.toLocaleString()} candidate hkl). Increase wavelength or use a smaller unit cell.`);
  }

  const reciprocalOps=reciprocalSymmetryMatrices(sg);
  const rows=[];
  const seenFamilies=new Set();
  const tol=1e-9;
  for(let h=-hMax;h<=hMax;h++) for(let k=-kMax;k<=kMax;k++) for(let l=-lMax;l<=lMax;l++){
    if(h===0&&k===0&&l===0) continue;
    const hkl=[h,k,l];
    const qVec=hklToQ(rl,hkl), q=norm(qVec);
    if(!(q>1e-12) || q>qMax+tol) continue;
    const star=reflectionStar(hkl,reciprocalOps);
    const familyKey=star.map(hklKey).sort().join("|");
    if(seenFamilies.has(familyKey)) continue;
    seenFamilies.add(familyKey);
    const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
    // Direction filters are intentionally compact:
    //   U only  -> reflections along U
    //   V only  -> reflections along V
    //   U + V   -> every reflection in the U-V scattering plane
    //   neither -> all reflections
    let visibleStar=star;
    if(filters?.alongU && filters?.alongV){
      visibleStar=star.filter(x=>reflectionInCurrentScatteringPlane(rl,x));
    }else if(filters?.alongU){
      visibleStar=star.filter(x=>reflectionAlongCurrentAxis(rl,x,U));
    }else if(filters?.alongV){
      visibleStar=star.filter(x=>reflectionAlongCurrentAxis(rl,x,V));
    }
    if(!visibleStar.length) continue;
    // Show one representative satisfying the active direction rule.
    // Multiplicity remains the full crystallographic star size.
    const rep=canonicalReflectionHkl(visibleStar);
    const qRep=norm(hklToQ(rl,rep));
    const arg=qRep*lambda/(4*Math.PI);
    if(arg>1+1e-10) continue;
    const twoTheta=2*rad2deg(Math.asin(clamp(arg,-1,1)));
    if(filters?.withinS2Max && Number.isFinite(twoThetaMax) && twoTheta>twoThetaMax+1e-9) continue;
    const d=2*Math.PI/qRep;
    let intensity=nuclearStructureFactorSquared(structure,rep,qRep);
    if(!Number.isFinite(intensity)) intensity=0;
    const multiplicity=star.length;
    rows.push({hkl:rep,intensity,multiplicity,totalIntensity:intensity*multiplicity,twoTheta,q:qRep,d});
  }

  // Do not show systematic/motif extinctions.  Exact extinctions can leave tiny
  // floating-point residues after symmetry expansion, so use a very small
  // relative tolerance rather than testing intensity === 0.
  const maxI=Math.max(0,...rows.map(r=>Math.abs(Number(r.intensity)||0)));
  const extinctTol=Math.max(1e-12,maxI*1e-12);
  return rows.filter(r=>Number(r.intensity)>extinctTol);
}

function sortedCifReflections(rows,sortState=cifState.cifReflectionSort){
  const out=[...(rows||[])];
  const key=sortState?.key||"intensity";
  const dir=sortState?.direction==="asc" ? 1 : -1;
  return out.sort((a,b)=>{
    const av=Number(a[key]), bv=Number(b[key]);
    const d=(av-bv)*dir;
    return d || compareHkl(a.hkl,b.hkl);
  });
}

function updateCifReflectionSortHeaders(){
  for(const th of document.querySelectorAll(".cif-sortable-th:not(.magnetic-sortable-th)")){
    const active=th.dataset.sortKey===cifState.cifReflectionSort.key;
    const direction=active ? cifState.cifReflectionSort.direction : null;
    const indicator=th.querySelector(".cif-sort-indicator");
    if(indicator) indicator.textContent=active ? (direction==="asc" ? "▲" : "▼") : "";
    th.setAttribute("aria-sort",active ? (direction==="asc" ? "ascending" : "descending") : "none");
  }
}

function setCifReflectionSort(key){
  if(cifState.cifReflectionSort.key===key){
    cifState.cifReflectionSort={key,direction:cifState.cifReflectionSort.direction==="asc"?"desc":"asc"};
  }else{
    // Intensity-like columns are most useful descending; angular/spacing columns
    // start ascending on first click.
    const direction=(key==="intensity"||key==="totalIntensity"||key==="q") ? "desc" : "asc";
    cifState.cifReflectionSort={key,direction};
  }
  updateCifReflectionSortHeaders();
  renderCifReflectionTable();
}

function reflectionNumberText(value,digits=5){
  const x=Number(value);
  if(!Number.isFinite(x)) return "—";
  const a=Math.abs(x);
  if(a!==0 && (a>=1e5 || a<1e-4)) return x.toExponential(4);
  return x.toFixed(digits);
}

function renderCifReflectionTable(){
  const body=$("cifReflectionRows");
  if(!body) return;
  body.replaceChildren();
  if(!cifState.lastGeneratedReflections.length){
    cifState.selectedCifReflectionKey="";
    const tr=document.createElement("tr"), td=document.createElement("td");
    td.colSpan=7; td.className="cif-reflection-empty"; td.textContent="No reflections in the selected wavelength range.";
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  const rows=sortedCifReflections(cifState.lastGeneratedReflections,cifState.cifReflectionSort);
  const availableKeys=new Set(rows.map(r=>hklKey(r.hkl)));
  if(cifState.selectedCifReflectionKey && !availableKeys.has(cifState.selectedCifReflectionKey)) cifState.selectedCifReflectionKey="";
  for(const r of rows){
    const key=hklKey(r.hkl);
    const tr=document.createElement("tr");
    tr.dataset.reflectionKey=key;
    tr.tabIndex=0;
    tr.setAttribute("aria-selected",String(key===cifState.selectedCifReflectionKey));
    tr.classList.toggle("cif-reflection-selected",key===cifState.selectedCifReflectionKey);
    const values=[
      `(${r.hkl.join(" ")})`,
      reflectionNumberText(r.intensity/100,4),
      String(r.multiplicity),
      reflectionNumberText(r.totalIntensity/100,4),
      reflectionNumberText(r.twoTheta,4),
      reflectionNumberText(r.q,5),
      reflectionNumberText(r.d,5)
    ];
    values.forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
    const toggle=()=>{
      cifState.selectedCifReflectionKey=(cifState.selectedCifReflectionKey===key)?"":key;
      renderCifReflectionTable();
      if(cifState.selectedCifReflectionKey){
        body.querySelector(`tr[data-reflection-key="${CSS.escape(cifState.selectedCifReflectionKey)}"]`)?.focus({preventScroll:true});
      }
    };
    tr.addEventListener("click",toggle);
    tr.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();toggle();}});
    body.appendChild(tr);
  }
}

function clearCifReflectionRowSelection(){
  if(!cifState.selectedCifReflectionKey) return;
  cifState.selectedCifReflectionKey='';
  for(const row of document.querySelectorAll('#cifReflectionRows tr.cif-reflection-selected')){
    row.classList.remove('cif-reflection-selected');
    row.setAttribute('aria-selected','false');
  }
}

// A reflection table describes the selected nuclear crystal, regardless of
// whether the user has opened Nuclear or Magnetic or pressed Generate CIF.
// A freshly generated (but not yet Set) CIF takes precedence so its preview
// and calculated reflections stay consistent with one another.
// Structure to use for NUCLEAR structure factors of the selected sample CIF.
// A (generated or imported) mCIF describes the magnetic cell, which can be a
// supercell of the crystallographic cell: nuclear hkl are indexed in the
// crystallographic (parent) cell, so return that parent structure instead.
// Returns null when no CIF is selected, or when the parent cell of an mCIF
// cannot be determined: never compute nuclear intensities in the magnetic cell.
// Shared by the reflection table and the Q-E maps so both always agree.
let nuclearStructureCache={selected:null,text:null,groups:0,structure:null};
function nuclearStructureForSelectedCif(){
  const selected=getSelectedCifStructure();
  if(!selected?.lattice || !selected?.atoms?.length) return null;
  const text=getSelectedCifText();
  const groups=cifState.cifSpaceGroups?.length||0;
  const c=nuclearStructureCache;
  if(c.selected===selected && c.text===text && c.groups===groups) return c.structure;
  // A generated mCIF uses a supercell: deduplicate translated atoms into
  // the parent nuclear cell before calculating peaks and indexing hkl.
  const hasMagneticTags=/_space_group_symop_magn_|_cell_wave_vector_[xyz]|_atom_site_moment(?:[._]|\s)/i.test(String(text||''));
  const structure=(selected.magnetic||hasMagneticTags)
    ? fn.crystallographicStructureFromMcif(selected,text)
    : selected;
  nuclearStructureCache={selected,text,groups,structure:structure||null};
  return structure||null;
}
function nuclearReflectionSource(){
  // Live Structure editor overrides the loaded snapshot only after an edit.
  if(cifState.liveEditorNuclearSource) return cifState.liveEditorNuclearSource;
  if(cifState.lastGeneratedCifParsed && cifState.lastGeneratedCifSpaceGroup){
    return {structure:cifState.lastGeneratedCifParsed,spaceGroup:cifState.lastGeneratedCifSpaceGroup,
      fileName:cifState.lastGeneratedCifName};
  }
  const structure=nuclearStructureForSelectedCif();
  if(!structure)return null;
  // Use the known nuclear space group for reflection-star multiplicities.
  // For unfamiliar groups fall back to Friedel-pair grouping instead of
  // preventing the structure-factor calculation altogether.
  const spaceGroup=structure.parentCellEstimated
    ? {number:1,hm:'P1 calculation basis',operations:['x,y,z']}
    : (fn.findGeneratorSpaceGroup(structure) || {operations:['x,y,z']});
  return {structure,spaceGroup,fileName:getSelectedCifFileName()||'selected_structure.cif',
    estimatedParent:!!structure.parentCellEstimated};
}

// Sample lattice parameters are a live calculation override. The CIF/mCIF
// source and all fractional atom coordinates remain untouched.
function nuclearReflectionWithSampleLattice(source){
  if(!source?.structure?.lattice) return source;
  const lattice={...source.structure.lattice};
  for(const id of ["a","b","c","alpha","beta","gamma"]){
    const raw=$(id)?.value;
    if(raw===undefined || String(raw).trim()==="") throw new Error(`Sample ${id} is required for nuclear reflections.`);
    const value=Number(raw);
    if(!Number.isFinite(value) || (['a','b','c'].includes(id) && value<=0)
       || (!['a','b','c'].includes(id) && (value<=0 || value>=180))){
      throw new Error(`Invalid Sample ${id}: ${raw}`);
    }
    lattice[id]=value;
  }
  return {...source,structure:{...source.structure,lattice}};
}
}
