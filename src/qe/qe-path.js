// Q-E map units, spurion warnings and the Q-vector path editor (path text, picking, snapping).
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {dot} from '../core/tas-core.js';

export function createQEPath(deps){
  const {
    $, checkedValue, hklToQ, num, parseNumericValue, renderQEVectorMap, renderSingle, getSingleCache
  }=deps;

// Higher-order wavelength contamination warning.
// A label "nki-mkf" denotes an elastic event for the contaminating harmonics,
// n*ki and m*kf.  Since E is proportional to k^2, the condition is
// n^2 Ei = m^2 Ef.  We compare the currently displayed apparent hbar-omega
// (Ei-Ef) with those discrete conditions.
function qeSpurionWarnings(cache, hw){
  if(!Number.isFinite(hw)) return [];
  const list=Array.isArray(cache?.hwList) ? cache.hwList.map(Number).filter(Number.isFinite) : [];
  if(!list.length) return [];

  const fixedEf=Number(cache?.Ef);
  const fixedEi=Number(cache?.Ei);
  const candidates=[];

  // Loop variables: ki/kf = n/m (n > m), i.e. Ei/Ef = (n/m)^2. Physically
  // the m-th order of ki equals the n-th order of kf:  m*ki = n*kf.
  // The warning is therefore labelled "m ki - n kf" (e.g. ki-2kf, 2ki-3kf).
  //
  // Only include an incident higher-order component while its energy
  // m^2 * Ei is <= 100 meV, since the reactor spectrum is negligible above it.
  // The 100-meV test limits the incident order m. The analyzer order n has no
  // such cutoff, so it is capped at 4 (PG(008)); higher orders are negligible
  // and would only flood the warning (ki-5kf ... ki-12kf at fixed Ei).
  for(let n=2;n<=4;n++){
    for(let m=1;m<n;m++){
      let hws, EiAtSpurion, EfAtSpurion;
      const r=(n/m)*(n/m);

      if(cache.energyMode==="Ef fixed"){
        if(!(fixedEf>0)) continue;
        EfAtSpurion=fixedEf;
        EiAtSpurion=fixedEf*r;
        hws=EiAtSpurion-EfAtSpurion;
      }else{
        if(!(fixedEi>0)) continue;
        EiAtSpurion=fixedEi;
        EfAtSpurion=fixedEi/r;
        hws=EiAtSpurion-EfAtSpurion;
      }

      if(!(EiAtSpurion>0) || !(EfAtSpurion>0) || !Number.isFinite(hws)) continue;
      // The incident component is the m-th order of ki (energy m^2 Ei).
      if(m*m*EiAtSpurion > 100 + 1e-9) continue;

      // Reduce duplicate ratios (e.g. 4/2 == 2/1); keep the lowest-order label.
      if(candidates.some(x=>Math.abs(x.hw-hws)<1e-9)) continue;
      const coefficient=c=>c===1?'':String(c);
      candidates.push({label:`${coefficient(m)}ki-${coefficient(n)}kf`,hw:hws});
    }
  }

  // Warn on the two sampled hbar-omega points nearest each theoretical spurion.
  // This makes a 0.1-meV grid show the warning on two adjacent points.
  const hits=[];
  for(const cand of candidates){
    const nearest=list
      .map((v,idx)=>({v,idx,d:Math.abs(v-cand.hw)}))
      .sort((a,b)=>a.d-b.d || a.idx-b.idx)
      .slice(0,Math.min(2,list.length));
    if(nearest.some(p=>Math.abs(p.v-hw)<1e-9)) hits.push(cand);
  }
  return hits;
}

function updateQESpurionWarning(cache,index){
  const box=$("qeSpurionWarning");
  if(!box || !cache?.hwList?.length) return;
  const i=Math.max(0,Math.min(Number(index)||0,cache.hwList.length-1));
  const hw=Number(cache.hwList[i]);
  const hits=qeSpurionWarnings(cache,hw);
  box.textContent=hits.length ? `Spurion warning: ${hits.map(x=>x.label).join(", ")}` : "";
  box.classList.toggle("active",hits.length>0);
}

function currentQEMapUnit(){
  return $('qeMapUnit')?.value==='rlu' ? 'rlu' : 'ainv';
}

function qePlaneRluBasis(cache){
  const uq=hklToQ(cache.rl,cache.U), vq=hklToQ(cache.rl,cache.V);
  return {
    ux:dot(uq,cache.ex), uy:dot(uq,cache.ey),
    vx:dot(vq,cache.ex), vy:dot(vq,cache.ey)
  };
}

function qeXYForUnit(cache,p,unit=currentQEMapUnit()){
  const x=Number(p?.[0]), y=Number(p?.[1]);
  if(unit!=='rlu') return [x,y];
  const b=qePlaneRluBasis(cache);
  const det=b.ux*b.vy-b.uy*b.vx;
  if(Math.abs(det)<1e-12) return [x,y];
  return [(x*b.vy-y*b.vx)/det,(b.ux*y-b.uy*x)/det];
}

// A r.l.u. map is drawn in the *physical* scattering plane, not with U and V
// forced onto perpendicular plot axes.  The reciprocal-space basis determines
// two oblique families of grid lines: u = integer and v = integer.
// This preserves both the true aspect ratio and the sign of the U/V tilt.
function qePhysicalRluCoordinates(cache,p){
  const b=qePlaneRluBasis(cache);
  const det=b.ux*b.vy-b.uy*b.vx;
  if(!Number.isFinite(det) || Math.abs(det)<1e-12) return [NaN,NaN];
  const x=Number(p[0]),y=Number(p[1]);
  return [(x*b.vy-y*b.vx)/det,(b.ux*y-b.uy*x)/det];
}

// The Q-path text field is the single editable source for two or more HKL
// vertices. Clicks on Constant E map append to this same field; edits to the
// field update BOTH plots (without recalculating TAS instrumental geometry).
const qeSelectedPathHKL=[];
const qeSelectedPathLabels=[];
let qeSelectingPath=false;
let qePathWasEdited=false;
let qeVectorInputTimer=null;
function qeParsePathDetails(value){
  const source=String(value??'').trim();
  if(!source) return {points:[],labels:[]};
  // Accept "h k l, h k l" (canonical) and optional "(h,k,l), (h,k,l)".
  let groups;
  if(source.includes('(') || source.includes(')')){
    const matches=[...source.matchAll(/\(([^()]*)\)/g)];
    if(!matches.length || source.replace(/\([^()]*\)/g,'').replace(/[,;\s]/g,'')!=='')
      throw new Error('Enter HKL points as h k l, h k l, …');
    groups=matches.map(match=>match[1]);
  }else {
    // A trailing comma is normal while editing or adding the next point.
    // Ignore empty groups rather than displaying a non-actionable warning.
    groups=source.split(/[,;\n]+/).map(group=>group.trim()).filter(Boolean);
  }
  const labels=[];
  const points=groups.map((group,index)=>{
    const named=group.trim().match(/^([^:,\s]+)\s*:\s*(.*)$/u);
    if(named){labels.push(named[1]);group=named[2];}
    else labels.push('');
    const parts=group.trim().split(/[\s,]+/).filter(Boolean);
    if(parts.length!==3) throw new Error(`P${index+1} must contain H K L (3 numbers).`);
    const hkl=parts.map(parseNumericValue);
    if(!hkl.every(Number.isFinite)) throw new Error(`P${index+1} has an invalid HKL number.`);
    return hkl;
  });
  return {points,labels};
}
function qeParsePathText(value){return qeParsePathDetails(value).points;}
function qePathInput(){return $('qeVectorHKLPath');}
// Only an empty (including restored empty) HKL field gets a default path.
// Build it from the CURRENT U/V rather than assuming a fixed (100)/(010) plane.
function qeDefaultPathText(){
  const coordinates=(ids,fallback)=>{
    const values=ids.map(id=>num(id));
    return values.every(Number.isFinite) ? values : fallback;
  };
  const U=coordinates(['Uh','Uk','Ul'],[1,0,0]);
  const V=coordinates(['Vh','Vk','Vl'],[0,1,0]);
  return [[0,0,0],U,V,[0,0,0]]
    .map(point=>point.map(value=>String(value)).join(' ')).join(', ');
}
// Show HKL values to three decimal places without changing the unrounded
// reciprocal-space coordinates used by the Q-E calculation or 1/12 snapping.
function qeFormatPathNumber(value){
  if(Math.abs(value)<0.0005) return '0';
  return String(Number(value.toFixed(3)));
}
function qeWritePathInput(){
  const field=qePathInput();
  if(field) field.value=qeSelectedPathHKL.map((p,i)=>(qeSelectedPathLabels[i]?`${qeSelectedPathLabels[i]}: `:'')+p.map(qeFormatPathNumber).join(' ')).join(', ');
  field?.removeAttribute('aria-invalid');
}
// Names on the upper edge are reciprocal-space point names, not arbitrary P1/P2.
// On a triangular (60°/120°) primitive U-V plane, recognize Γ/M/K modulo
// reciprocal-lattice translations. In all other cases only explicit names
// are displayed, because M/K cannot safely be inferred from HKL alone.
function qePathSymmetryLabel(index,cache){
  const explicit=qeSelectedPathLabels[index];
  if(explicit) return /^(gamma|γ|Γ)$/iu.test(explicit.trim()) ? 'Γ' : explicit;
  const p=qeSelectedPathHKL[index];
  if(!p || !cache) return '';
  // All reciprocal-lattice translations of Γ fold back to the zone centre.
  const mod1=x=>((x%1)+1)%1;
  const near=(x,y)=>Math.abs(x-y)<0.012 || Math.abs(x-y-1)<0.012 || Math.abs(x-y+1)<0.012;
  const [h,k,l]=p.map(mod1);
  if(near(h,0)&&near(k,0)&&near(l,0)) return 'Γ';
  // Conventional hexagonal cell (a=b, alpha=beta=90°, gamma=120°).
  // Only assign hexagonal BZ symbols when the metric AND the reciprocal
  // setting are unambiguous. Other crystal systems need a full standardized
  // symmetry analysis, so they remain unlabeled unless explicitly named.
  const cell=cache.lc;
  const hexMetric=cell && Number.isFinite(cell.a) && Number.isFinite(cell.b)
    && Math.abs(cell.a-cell.b)/Math.max(cell.a,cell.b)<0.002
    && Math.abs(cell.alpha-90)<0.2 && Math.abs(cell.beta-90)<0.2
    && Math.abs(cell.gamma-120)<0.2;
  if(!hexMetric) return '';
  const isG=near(h,0)&&near(k,0);
  const isM=[[0.5,0],[0,0.5],[0.5,0.5]].some(([a,b])=>near(h,a)&&near(k,b));
  // Standard hexagonal reciprocal basis (direct gamma = 120°): K and K'
  // reduce to (1/3,1/3) and (2/3,2/3) modulo reciprocal translations.
  const isK=[[1/3,1/3],[2/3,2/3]].some(([a,b])=>near(h,a)&&near(k,b));
  if(near(l,0)) return isM?'M':isK?'K':'';
  if(near(l,0.5)) return isG?'A':isM?'L':isK?'H':'';
  return '';
}
function qePathCoordinateLabel(index){
  const p=qeSelectedPathHKL[index];
  return p ? `(${p.map(qeFormatPathNumber).join(', ')})` : '';
}
function qePathMapLabel(index,cache){
  // Vertices are user-defined Q points; do not guess high-symmetry names.
  // Hover still reports the precise HKL coordinates.
  return '';
}
function qePathAxisCoordinateLabel(index){
  const p=qeSelectedPathHKL[index];
  // Keep every HKL triplet on one horizontal line, including on tablets.
  return p ? `(${p.map(qeFormatPathNumber).join(', ')})` : '';
}
function qePathPointXY(cache,hkl){
  const q=hklToQ(cache.rl,hkl);
  return [dot(q,cache.ex),dot(q,cache.ey)];
}
function updateQEPathControls(){
  const button=$('qePathPickToggle'),overlay=$('qePathHitLayer');
  if(button){
    button.classList.toggle('active',qeSelectingPath);
    button.setAttribute('aria-pressed',String(qeSelectingPath));
    button.textContent=qeSelectingPath?'Finish Path':'Select Path';
  }
  overlay?.classList.toggle('active',qeSelectingPath);
  if($('qePathUndo')) $('qePathUndo').disabled=!qeSelectedPathHKL.length;
  if($('qePathClear')) $('qePathClear').disabled=!qeSelectedPathHKL.length;

}
function redrawQEPathDisplay(){
  updateQEPathControls();
  if(!getSingleCache()) return;
  if(!$('qeConstantMapPane')?.classList.contains('hidden'))
    renderSingle(getSingleCache(),Number($('hwSlider')?.value)||0);
  if(!$('qeVectorMapPane')?.classList.contains('hidden')) renderQEVectorMap(getSingleCache());
}
function qeCommitPathText({markEdited=true}={}){
  let points;
  try{var parsed=qeParsePathDetails(qePathInput()?.value);points=parsed.points;}
  catch(error){
    qePathInput()?.setAttribute('aria-invalid','true');
    if($('qeVectorMessage')) $('qeVectorMessage').textContent=error.message;
    return false;
  }
  qePathInput()?.removeAttribute('aria-invalid');
  qePathWasEdited=markEdited;
  qeSelectedPathHKL.splice(0,qeSelectedPathHKL.length,...points);
  qeSelectedPathLabels.splice(0,qeSelectedPathLabels.length,...parsed.labels);
  redrawQEPathDisplay();
  return true;
}
// Common special-point fractions are not all on one equally spaced grid:
// 1/12 covers 1/3 and 1/6 but misses 1/5 and 1/10. The Auto option chooses
// the nearest rational from these denominators independently for each U/V
// component, and the user may opt for a fixed denominator or disable snapping.
function qeSnapReciprocalCoordinate(value,mode='auto'){
  if(!Number.isFinite(value)||mode==='off') return value;
  if(mode!=='auto'){
    const denominator=Number(mode);
    return Number.isInteger(denominator)&&denominator>0
      ? Math.round(value*denominator)/denominator : value;
  }
  const denominators=[2,3,4,5,6,10,12];
  let best=value,smallest=Infinity,prefer=Infinity;
  for(const denominator of denominators){
    const proposed=Math.round(value*denominator)/denominator;
    const error=Math.abs(proposed-value);
    // Exact ties prefer simpler fractions (smaller denominator).
    if(error<smallest-1e-12 || (Math.abs(error-smallest)<1e-12 && denominator<prefer)){
      best=proposed;smallest=error;prefer=denominator;
    }
  }
  return best;
}
function addQEPathPointFromPhysical(x,y){
  if(!qeSelectingPath || !getSingleCache() || checkedValue('sampleMode')!=='single') return;
  // The figure uses orthonormal physical Å⁻¹ coordinates in BOTH Q unit modes.
  const [u,v]=qePhysicalRluCoordinates(getSingleCache(),[x,y]);
  if(!Number.isFinite(u)||!Number.isFinite(v)) return;
  const {U,V}=getSingleCache();
  // The map selection snaps in the U/V scattering-plane basis, not in
  // physical Å⁻¹ coordinates. Auto uses the nearest of common rational
  // fractions (including 1/5 and 1/10); users can choose a fixed step or Off.
  const mode=$('qePathSnap')?.value||'auto';
  const us=qeSnapReciprocalCoordinate(u,mode);
  const vs=qeSnapReciprocalCoordinate(v,mode);
  const hkl=U.map((val,i)=>val*us+V[i]*vs);
  // The generated startup path is visible, but is not a user-picked path.
  // Replace it on the first *valid map click*, not when Select Path is toggled.
  if(!qePathWasEdited){
    qeSelectedPathHKL.length=0;
    qeSelectedPathLabels.length=0;
  }
  const previous=qeSelectedPathHKL.at(-1);
  if(previous){
    const a=qePathPointXY(getSingleCache(),previous),b=qePathPointXY(getSingleCache(),hkl);
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-5) return;
  }
  qeSelectedPathHKL.push(hkl);
  qeSelectedPathLabels.push('');
  qePathWasEdited=true;
  qeWritePathInput();
  redrawQEPathDisplay();
}
function installQEPathOverlay(){
  const hit=$('qePathHitLayer'),plot=$('singlePlot');
  if(!hit||!plot) return;
  let start=null;
  hit.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY};});
  hit.addEventListener('pointercancel',()=>{start=null;});
  hit.addEventListener('pointerup',event=>{
    const origin=start;start=null;
    if(!qeSelectingPath||!origin||Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>12) return;
    const full=plot._fullLayout,xa=full?.xaxis,ya=full?.yaxis;
    if(!xa||!ya) return;
    // The drag rectangle is the *actual plotted area*, including Plotly's
    // margins, responsive resize and any CSS/browser scaling. Using the outer
    // graph div or its _size margins can offset selection substantially.
    const region=plot.querySelector('.nsewdrag');
    if(!region) return;
    const box=region.getBoundingClientRect();
    if(!(box.width>0 && box.height>0)) return;
    const fx=(event.clientX-box.left)/box.width;
    const fy=(event.clientY-box.top)/box.height;
    if(fx<0||fx>1||fy<0||fy>1) return;
    addQEPathPointFromPhysical(xa.p2d(fx*xa._length),ya.p2d(fy*ya._length));
    event.preventDefault();
  });
  updateQEPathControls();
}

// Event wiring moved from app.js; called from app.js at its original position.
function bindQEPathControls(){
installQEPathOverlay();
$('qePathSnap')?.addEventListener('change',()=>{
  try{localStorage.setItem('tas-qe-path-snap-v1',$('qePathSnap').value);}catch(_e){}
});
$('qeMapUnit')?.addEventListener('change',()=>{
  try{localStorage.setItem('tas-qe-map-unit-v1',$('qeMapUnit').value);}catch(_e){}
  if(getSingleCache()){
    renderSingle(getSingleCache(),Number($('hwSlider')?.value)||0);
  }
});
$('qePathPickToggle')?.addEventListener('click',()=>{
  qeSelectingPath=!qeSelectingPath;
  // Keep the default path visible until the first valid map click replaces it.
  // Saved/user-edited paths can still be extended as before.
  updateQEPathControls();
});
$('qePathUndo')?.addEventListener('click',()=>{
  qeSelectedPathHKL.pop();
  qeSelectedPathLabels.pop();
  qePathWasEdited=true;
  qeWritePathInput();
  redrawQEPathDisplay();
});
$('qePathClear')?.addEventListener('click',()=>{
  qeSelectedPathHKL.length=0;
  qeSelectedPathLabels.length=0;
  qePathWasEdited=true;
  qeWritePathInput();
  redrawQEPathDisplay();
});
// Only the Q-vector plot/Constant-E path overlay need refreshing when HKL is
// edited. The full instrument calculation is deliberately left untouched.
const qePathEntry=qePathInput();
qePathEntry?.addEventListener('input',()=>{
  clearTimeout(qeVectorInputTimer);
  qeVectorInputTimer=setTimeout(()=>{qeVectorInputTimer=null;qeCommitPathText();},300);
});
qePathEntry?.addEventListener('change',()=>{
  clearTimeout(qeVectorInputTimer);
  qeVectorInputTimer=null;
  qeCommitPathText();
});
qePathEntry?.addEventListener('keydown',event=>{
  if(event.key==='Enter'){
    clearTimeout(qeVectorInputTimer);
    qeVectorInputTimer=null;
    qeCommitPathText();
  }
});
// Seed the plot/path overlay from the initial, user-editable HKL text.
try{const initial=qeParsePathDetails(qePathInput()?.value);qeSelectedPathHKL.push(...initial.points);qeSelectedPathLabels.push(...initial.labels);}catch(_e){}
updateQEPathControls();
}

  return {
    currentQEMapUnit, qeCommitPathText, qeDefaultPathText, qeFormatPathNumber, qePathAxisCoordinateLabel,
    qePathInput, qePathMapLabel, qePathPointXY, qePhysicalRluCoordinates, qePlaneRluBasis,
    qeSelectedPathHKL, qeSpurionWarnings, qeXYForUnit, updateQESpurionWarning, bindQEPathControls
  };
}
