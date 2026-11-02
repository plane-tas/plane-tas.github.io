import {nuclearExtinctionThreshold} from '../cif/cif-structure.js';
import {inferOutOfPlaneHKL} from '../resolution/resolution-core.js';

// Four-circle W layer: a peak within this |W - w| (r.l.u.) is shown on the map.
export const W_LAYER_TOLERANCE=0.01+1e-9;

export function createQESingleCrystal(deps){
  const {
    $, PI, RL_calc, UB_calc, add, arange, backgroundColor, backgroundMaterials,
    backgroundPowderPeaks, calcQ0, centeringFromSpaceGroup, checkedValue, clamp,
    currentInstrument, deg2rad, dot, effectiveOrientationReference, effectiveS2MaxAtEi,
    enabledPropagationVectors, formatHKL, getDarkAssets, getSelectedCifFileName,
    getNuclearCifStructure, hklToQ, isAllowedByCentering, latticeParams, linspace,
    makeSpiceScatteringPlaneBasis, maxArray, norm, nuclearStructureFactorSquared, num,
    rad2deg, rangeTable, rebuildGeometryMatchedDarkPolygons, representativePowderHklText,
    scale, selectedBackgrounds, selectedS1Sign, selectedSampleSpaceGroup, selectedTasSense,
    tasConvention, tasPhiLabDegForConvention, tasPlotPhiFromCrystalPhiForConvention,
    validateEffectiveS2Max, wrap180, fourCircleSignFactors
  }=deps;

  function calculateSingleCrystal(){
    const convention=tasConvention(selectedTasSense(),selectedS1Sign());
    return rebuildGeometryMatchedDarkPolygons(calculateSingleCrystalCore(convention),convention);
  }

  function calculateSingleCrystalCore(convention){
    // Nuclear intensities use the crystallographic cell: for an mCIF this is its
    // parent cell, never the (possibly larger) magnetic cell.
    const nuclearCifStructure=getNuclearCifStructure();
    const selectedCifFileName=getSelectedCifFileName();
    const inst=currentInstrument();
    const lc=latticeParams();
    // Lattice centering is derived from the selected Space group; there is no
    // separate manual centering selector in the Sample UI.
    const sampleSpaceGroup=selectedSampleSpaceGroup();
    const latticeCentering=centeringFromSpaceGroup(sampleSpaceGroup);
    const U=[num("Uh"),num("Uk"),num("Ul")];
    const V=[num("Vh"),num("Vk"),num("Vl")];
    const rl=RL_calc({...lc,sv1:U,sv2:V});
    // Keep the same UB construction as the Python implementation, even though
    // plotting below uses the explicit scattering-plane basis.
    UB_calc({...lc,sv1:U,sv2:V},rl);
    const {ex,ey,ez}=makeSpiceScatteringPlaneBasis(rl,U,V);

    // Four-circle instruments: the Constant E map shows the layer
    // Q = a U + b V + w W.  The map coordinates stay the in-plane (U, V)
    // coordinates of a U + b V, so peak labels and the r.l.u. grid are exact;
    // the true |Q| and chi of a point include the W offset.
    const fourCircle=inst?.instrument_type==="four-circle";
    let Whkl=null, layerW=0, wShift=[0,0], wInPlane=[0,0], wZ=0, wzPerRlu=0;
    if(fourCircle){
      try{ Whkl=inferOutOfPlaneHKL(rl,U,V).map(Number); }catch(_e){ Whkl=null; }
      if(Whkl){
        const qW=hklToQ(rl,Whkl);
        wzPerRlu=dot(qW,ez);
        const wEntry=Number($("qeWEntry")?.value);
        layerW=Number.isFinite(wEntry)?wEntry:0;
        wInPlane=[dot(qW,ex),dot(qW,ey)];
        wShift=[layerW*wInPlane[0],layerW*wInPlane[1]];
        wZ=layerW*wzPerRlu;
      }
    }
    // chi = chiFactor * (elevation of Q towards W); see fourCircleSignFactors.
    const chiFactor=fourCircle ? fourCircleSignFactors(convention,$("phiSign")?.value||"ccw",$("chiSign")?.value||"ccw").chiFactor : 1;
    const chiMin=Number.isFinite(Number(inst?.chi_min))?Number(inst.chi_min):-90;
    const chiMax=Number.isFinite(Number(inst?.chi_max))?Number(inst.chi_max):90;

    const energyMode=checkedValue("energyMode");
    const lambdaHalf=$("lambdaHalf").checked;
    const energyInput=num("energy");
    let Ei,Ef;
    if(energyMode==="Ef fixed") Ef=lambdaHalf?4*energyInput:energyInput;
    else Ei=lambdaHalf?4*energyInput:energyInput;

    const fixedReferenceEnergy=(energyMode==="Ef fixed"?Ef:Ei);
    const orientationRef=effectiveOrientationReference(rl,fixedReferenceEnergy);
    const ref=orientationRef.hkl;
    const refS1=orientationRef.s1;
    const Qref=hklToQ(rl,ref);
    const QrefNorm=norm(Qref);
    const QrefXY=[dot(Qref,ex),dot(Qref,ey)];
    const phiRefPlot=QrefNorm>1e-10?rad2deg(Math.atan2(QrefXY[1],QrefXY[0])):0;
    const wavelength=9.044/Math.sqrt(energyMode==="Ef fixed"?Ef:Ei);
    let thetaRef=0;
    if(QrefNorm>1e-10){
      const dRef=2*PI/QrefNorm;
      const arg=wavelength/(2*dRef);
      if(arg>1+1e-12) throw new Error("Reference Q is not accessible at the selected reference energy.");
      thetaRef=rad2deg(Math.asin(clamp(arg,-1,1)));
    }

    const darkAssets=getDarkAssets();
    // Each enabled asset keeps its own reference convention. Existing single-asset
    // formulas are reused independently, then their blocked regions are overlaid.
    const s1Offset=-thetaRef+180-phiRefPlot;

    const S2min=num("S2min"), S1min=num("S1min"), S1max=num("S1max");
    let hwList;
    if(lambdaHalf) hwList=[0];
    else if(energyMode==="Ef fixed"){
      const EiMax=maxArray(rangeTable(inst).map(x=>Number(x.Ei)));
      hwList=arange(0,EiMax-Ef,0.1);
    } else {
      hwList=arange(0,Ei,0.1);
    }
    if(hwList.length===0) hwList=[0];

    const regions=[], S2list=[], QmaxList=[];
    const darkKF=[],darkKI=[],darkFixed=[];
    // Dark angles follow the TAS S1 wedge; they are not mapped for the
    // four-circle (free phi) geometry.
    const addDark=$("addDark").checked && darkAssets.length>0 && !fourCircle;
    const sense=convention.sense;

    // One physical convention drives the S1/Q mapping for both scattering senses.
    // The plot basis remains the entered U/V basis; only the crystal azimuth
    // handedness belongs to the instrument convention.
    const phiRef=tasPlotPhiFromCrystalPhiForConvention(
      phiRefPlot,convention.sense,convention.s1sign
    );

    // Keep the numerical S1 inversion on its original calibration.  S1 is an
    // absolute physical motor value; do not change its calibration sign merely
    // to alter the displayed Q-E arc direction.
    const s1C2Sign=convention.c2ToOmegaSign;
    const kRef=Math.sqrt(fixedReferenceEnergy/2.072);
    let s1RangeCalibration=QrefNorm>1e-10
      ? {
          refS1,
          c2Sign:s1C2Sign,
          omegaRef:wrap180(
            tasPhiLabDegForConvention(kRef,kRef,2*thetaRef,convention.sense,convention.s1sign)-phiRef
          ),
          sense:convention.sense,
          s1sign:convention.s1sign,
          crystalAzimuthHandedness:convention.crystalAzimuthHandedness
        }
      : null;

    // Q-E S1 RANGE:
    // use the exact inverse of Angle calculation directly for BOTH configurations.
    // S1 is an absolute motor value, so no extra display reflection is allowed.
    // The previous -+- reflection about S1=0 reversed an already-correct inverse
    // mapping and could send a point such as (0,0,3) toward the (0,0,-3) side.
    const calcQRangePoint=(s1,s2,ki,kf)=>
      calcQ0(s1,s2,ki,kf,s1Offset,refS1,QrefXY,convention.sense,s1RangeCalibration);

    for(const hw of hwList){
      let EiHw,EfHw;
      if(energyMode==="Ef fixed"){ EiHw=Ef+hw; EfHw=Ef; }
      else { EiHw=Ei; EfHw=Ei-hw; }
      if(EiHw<=0 || EfHw<=0) continue;
      const ki=0.6947*Math.sqrt(EiHw), kf=0.6947*Math.sqrt(EfHw);
      const S2max=validateEffectiveS2Max(effectiveS2MaxAtEi(inst,EiHw,lambdaHalf),S2min,EiHw);

      // S1min/S1max are physical motor limits. The Q-E boundary is generated
      // from the exact inverse of the same S1 calibration used by Angle calculation.
      if(fourCircle){
        // phi rotates freely and S1 follows S2/2 (bisecting), so the reachable
        // in-plane region is an annulus limited by |Q(S2)| and by chi.
        const qAt=s2=>Math.sqrt(Math.max(0,ki*ki+kf*kf-2*ki*kf*Math.cos(deg2rad(s2))));
        const qLo=qAt(S2min), qHi=qAt(S2max);
        let rIn=Math.sqrt(Math.max(0,qLo*qLo-wZ*wZ));
        const rOut=qHi*qHi>wZ*wZ ? Math.sqrt(qHi*qHi-wZ*wZ) : 0;
        // chi = chiFactor * elevation: the largest reachable elevation on
        // the side of the layer (wZ > 0 above the U-V plane) follows from the
        // chi limit of the same sign.
        if(Math.abs(wZ)>1e-12){
          const chiSide=chiFactor*Math.sign(wZ);
          const lim=chiSide>0?chiMax:-chiMin;   // largest reachable elevation
          if(lim<=0) rIn=Infinity;
          else if(lim<90-1e-9) rIn=Math.max(rIn,Math.abs(wZ)/Math.tan(deg2rad(lim)));
        }else if(chiMin>0 || chiMax<0) rIn=Infinity;
        let boundary=[];
        if(rOut>rIn+1e-9){
          const t=linspace(0,2*PI,361);
          const cx=-wShift[0], cy=-wShift[1];
          boundary=t.map(a=>[cx+rOut*Math.cos(a),cy+rOut*Math.sin(a)]);
          if(rIn>1e-9) boundary=boundary.concat([...t].reverse().map(a=>[cx+rIn*Math.cos(a),cy+rIn*Math.sin(a)]));
        }
        regions.push(boundary); S2list.push(S2max);
        QmaxList.push(qHi);
        continue;
      }
      const s1range=linspace(S1min,S1max,200);
      const s2range=linspace(S2min,S2max,200);

      const p1=s1range.map(s1=>calcQRangePoint(s1,S2min,ki,kf));
      const p2=s2range.map(s2=>calcQRangePoint(S1max,s2,ki,kf));
      const p3=[...s1range].reverse().map(s1=>calcQRangePoint(s1,S2max,ki,kf));
      const p4=[...s2range].reverse().map(s2=>calcQRangePoint(S1min,s2,ki,kf));
      const boundary=[...p1,...p2,...p3,...p4];
      regions.push(boundary); S2list.push(S2max);
      QmaxList.push(Math.max(...boundary.map(norm)));

      const hwKF=[],hwKI=[],hwFixed=[];
      if(addDark){
        for(const asset of darkAssets){
          // Sample-attached Dark regions are rebuilt once by the common geometry
          // path after this function.  Only laboratory-fixed obstacles belong here.
          if(asset.ref!=="Fixed") continue;
          {
            // Laboratory-fixed obstacle: compare the SIGNED physical S2 motor angle
            // directly with the fixed angular interval.  Do not use abs(S2): a
            // stopper at +30 deg must not block a -30 deg scattering arm (and vice
            // versa).  The Q-E simulation currently scans the physical S2 branch
            // from S2min to S2max, so a fixed interval on the unused negative branch
            // naturally produces no blocked region.
            for(const rawRange of asset.ranges){
              let [from,to,offset]=rawRange;
              if(from===0 && to===0) continue;
              let a=offset+from, b=offset+to;
              if(b<a) b+=360;

              // Treat the fixed direction periodically, but intersect only with the
              // actually scanned signed S2 interval.  This also handles ranges that
              // cross 0 deg without mirroring the negative side onto the positive side.
              // A laboratory-fixed obstacle can intercept either the outgoing kf
              // arm or the incident ki beam.  The fixed-angle drawing uses the
              // sample as the origin: rotation = 0 deg points along the direct
              // (outgoing) beam, while the incident ki source direction is the
              // opposite ray, 180 deg.  Therefore a range around 0 deg is handled
              // below as an ordinary kf/S2 block; only a range containing 180 deg
              // (modulo 360 deg) blocks ki and makes every Q geometry inaccessible.
              const blocksKi=[-360,0,360].some(shift=>{
                const aa=a+shift, bb=b+shift;
                return aa<=180 && 180<=bb;
              });
              if(blocksKi){
                hwFixed.push(boundary.slice());
                continue;
              }

              // Otherwise the obstacle only blocks the outgoing kf arm. Intersect
              // with the actual signed S2 motor branch selected by Sense + S1 sign.
              const signedA=convention.s2EncoderSign*S2min;
              const signedB=convention.s2EncoderSign*S2max;
              const scannedLo=Math.min(signedA,signedB), scannedHi=Math.max(signedA,signedB);
              for(const shift of [-360,0,360]){
                const lo=Math.max(a+shift,scannedLo);
                const hi=Math.min(b+shift,scannedHi);
                if(!(hi>lo)) continue;
                const qRadius=s2=>Math.sqrt(Math.max(0,ki*ki+kf*kf-2*ki*kf*Math.cos(deg2rad(Math.abs(s2)))));
                const r0=qRadius(lo), r1=qRadius(hi), aa=linspace(0,2*Math.PI,241);
                hwFixed.push([...aa.map(t=>[r1*Math.cos(t),r1*Math.sin(t)]),...[...aa].reverse().map(t=>[r0*Math.cos(t),r0*Math.sin(t)])]);
              }
            }
            continue;
          }
          // Sample-attached Reference-Q / Direct-beam Dark regions are generated
          // once, after the accessible-range calculation, by
          // rebuildGeometryMatchedDarkPolygons().  Keeping one common physical
          // geometry path avoids four-state sign remapping here.
        }
      }
      darkKF.push(hwKF); darkKI.push(hwKI); darkFixed.push(hwFixed);
    }

    if(regions.length===0) throw new Error("No accessible ħω points were generated.");

    // Generate Bragg peaks over the same radial range shown by the Single Crystal plot.
    // Using QmaxList[0] here made the index search depend on the first energy point
    // and could truncate one reciprocal-space direction.  Search out to 1.2 times
    // the instrument's maximum reachable Q over the full calculated energy range.
    const instrumentQmax=Math.max(...QmaxList);
    const QplotLattice=1.2*instrumentQmax;
    const Uq=hklToQ(rl,U), Vq=hklToQ(rl,V);
    const Ulen=norm(Uq), Vlen=norm(Vq);
    const Mmax=Math.ceil(QplotLattice/Ulen)+2, Nmax=Math.ceil(QplotLattice/Vlen)+2;
    const Gpoints=[], magPoints=[];
    // Magnetic satellites are observable in this 2D TAS view only when their
    // propagation vector itself lies in the selected scattering plane.
    // A four-circle instrument reaches out-of-plane satellites too.
    const propagationVectors=enabledPropagationVectors().filter(q=>{
      if(fourCircle && Whkl) return true;
      const qCart=hklToQ(rl,q.hkl);
      const scaleQ=Math.max(norm(qCart),1);
      return Math.abs(dot(qCart,ez)) <= 1e-8*scaleQ;
    });
    // Four-circle: in-plane map coordinates of a vector on the layer W = w,
    // or null if it is not on that layer.  Like the spurion warning (nearest
    // two hbar-omega points), a peak is shown within one W slider step
    // (0.01 r.l.u.), so W = 1/3 appears at both W = 0.33 and 0.34.  Its map
    // position is that of its own U, V part (its own W part is removed).
    const layerXY=G=>{
      if(!(Math.abs(wzPerRlu)>1e-12)) return null;
      const wG=dot(G,ez)/wzPerRlu;
      if(Math.abs(wG-layerW)>W_LAYER_TOLERANCE) return null;
      return [dot(G,ex)-wG*wInPlane[0],dot(G,ey)-wG*wInPlane[1]];
    };
    const allParents=[];
    if(fourCircle && Whkl){
      const hMax=Math.ceil(QplotLattice*Number(lc.a)/(2*PI))+1;
      const kMax=Math.ceil(QplotLattice*Number(lc.b)/(2*PI))+1;
      const lMax=Math.ceil(QplotLattice*Number(lc.c)/(2*PI))+1;
      for(let h=-hMax;h<=hMax;h++) for(let k=-kMax;k<=kMax;k++) for(let l=-lMax;l<=lMax;l++){
        const hkl=[h,k,l];
        const G=hklToQ(rl,hkl);
        if(norm(G)>QplotLattice) continue;
        if(!isAllowedByCentering(hkl,latticeCentering)) continue;
        allParents.push({hkl});
        const xy=layerXY(G);
        if(!xy) continue;
        const isOrigin=h===0&&k===0&&l===0;
        const sf2=nuclearCifStructure && !isOrigin
          ? nuclearStructureFactorSquared(nuclearCifStructure,hkl,norm(G))
          : null;
        Gpoints.push({
          x:xy[0],y:xy[1],hkl,label:isOrigin?"":`(${formatHKL(hkl)})`,
          sf2:Number.isFinite(sf2)?sf2:null,sfNorm:null
        });
      }
    }

    if(!(fourCircle && Whkl)) for(let m=-Mmax;m<=Mmax;m++){
      for(let n=-Nmax;n<=Nmax;n++){
        const hkl=add(scale(U,m),scale(V,n));
        const G=hklToQ(rl,hkl);

        if(norm(G)>QplotLattice) continue;
        if(!isAllowedByCentering(hkl,latticeCentering)) continue;

        const h = Math.round(hkl[0]);
        const k = Math.round(hkl[1]);
        const l = Math.round(hkl[2]);

        const isOrigin=hkl.every(v=>Math.abs(v)<1e-10);
        const sf2=nuclearCifStructure && !isOrigin
          ? nuclearStructureFactorSquared(nuclearCifStructure,hkl,norm(G))
          : null;
        Gpoints.push({
          x:dot(G,ex),y:dot(G,ey),hkl,label:isOrigin?"":`(${formatHKL(hkl)})`,
          sf2:Number.isFinite(sf2)?sf2:null,sfNorm:null
        });
      }
    }

    // Magnetic satellites G +/- k need only the lattice-centering condition
    // (applied above). Screw/glide/atom-position extinctions of the NUCLEAR
    // structure factor do not extinguish magnetic scattering (MnF2 (100) at
    // k = 0), so keep every centering-allowed parent for the satellites.
    const magneticParents=(fourCircle && Whkl) ? allParents : Gpoints.slice();
    if(nuclearCifStructure){
      // Remove systematic extinctions first.  The threshold uses the absolute
      // |F|^2 scale of the structure (not the strongest DISPLAYED reflection),
      // so it still works when the window contains no allowed reflection;
      // genuinely weak peaks (> 1e-10 of the scale) are kept.
      const extinct=nuclearExtinctionThreshold(nuclearCifStructure);
      for(let j=Gpoints.length-1;j>=0;j--){
        const p=Gpoints[j];
        if(p.label && Number.isFinite(p.sf2) && p.sf2<=extinct) Gpoints.splice(j,1);
      }
      const sfMax=Math.max(0,...Gpoints.map(p=>Number.isFinite(p.sf2)?p.sf2:0));
      for(const p of Gpoints) p.sfNorm=(sfMax>0 && Number.isFinite(p.sf2)) ? p.sf2/sfMax : 0;
    }

    // Satellites around every centering-allowed G (including the origin),
    // independent of the nuclear intensity of G.
    for(const parent of magneticParents){
      const hkl=parent.hkl;
      for(const q of propagationVectors){
        const kvec=q.hkl;
        for(const s of [1,-1]){
          const hm=add(hkl,scale(kvec,s));
          const Gm=hklToQ(rl,hm);

          const xyM=(fourCircle && Whkl) ? layerXY(Gm) : [dot(Gm,ex),dot(Gm,ey)];
          if(xyM && norm(Gm)<=QplotLattice){
            magPoints.push({
              x:xyM[0],
              y:xyM[1],
              qIndex:q.index,
              hkl:hm,
              label:`k${q.index}: (${hm.map(x=>x.toFixed(2)).join(",")})`
            });
          }
        }
      }
    }

    const ringData=[];
    const qlimit=Math.max(...QmaxList);
    for(const bg of selectedBackgrounds()){
      const material=backgroundMaterials.get(bg.key);
      const peaks=backgroundPowderPeaks(material,qlimit);
      for(const p of peaks){
        const phi=linspace(0,2*PI,361);
        const ratio=p.relativeIntensity;
        // Four-circle layer W = w: the powder ring |Q| = q cuts it in a circle.
        if(fourCircle && Math.abs(wZ)>=p.q) continue;
        const rr=fourCircle ? Math.sqrt(p.q*p.q-wZ*wZ) : p.q;
        const cx=fourCircle ? -wShift[0] : 0, cy=fourCircle ? -wShift[1] : 0;
        ringData.push({
          x:phi.map(t=>cx+rr*Math.cos(t)), y:phi.map(t=>cy+rr*Math.sin(t)),
          color:backgroundColor(bg.slot,0.20+0.75*ratio),
          hover:`BG${bg.index+1}: ${bg.key}<br>${representativePowderHklText(p)}<br>Q = ${p.q.toFixed(3)} Å⁻¹<br>S2(elastic) = ${p.elasticS2.toFixed(3)}°<br>I/Imax = ${ratio.toFixed(3)}`
        });
      }
    }

    return {
      inst,lc,latticeCentering,sampleSpaceGroup,U,V,rl,ex,ey,ez,
      energyMode,Ei,Ef,lambdaHalf,hwList,
      regions,S2list,QmaxList,darkKF,darkKI,darkFixed,addDark,
      Gpoints,magPoints,ringData,darkAssets,QrefXY,sense,
      fourCircle,Whkl,layerW,wShift,wInPlane,wZ,wzPerRlu,chiMin,chiMax,chiFactor,
      cifStructure:nuclearCifStructure,cifFileName:selectedCifFileName
    };
  }

  return {calculateSingleCrystal,calculateSingleCrystalCore};
}
