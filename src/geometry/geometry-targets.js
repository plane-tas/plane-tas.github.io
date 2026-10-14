// TAS Geometry quick targets: target HKL from U/V/Bragg/dark reference and ki orientation conditions.
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
import {clamp, deg2rad, dot, makeSpiceScatteringPlaneBasis, norm, rad2deg} from '../core/tas-core.js';
import {angleDiffDeg, tasConvention, tasCrystalPhiDegForConvention, tasPlotPhiFromCrystalPhiForConvention, wrap180} from '../core/tas-conventions.js';

export function createGeometryTargets(deps){
  const {
    $, canonicalOrientationMode, collectResolutionBase, darkAssetIds, effectiveOrientationReference,
    hklToQ, num, scheduleRecalc, selectedS1Sign, selectedTasSense, tasMotorAngles
  }=deps;

function setGeometryTargetHKL(hkl){
  const values=hkl.map(Number);
  if(values.length!==3 || values.some(v=>!Number.isFinite(v))) return;
  $("geomH").value=values[0];
  $("geomK").value=values[1];
  $("geomL").value=values[2];
  // Quick-target buttons and the initial Reference-Q target change HKL only.
  // Keep the current geometry energy transfer (geomHW / slider) untouched.
  scheduleRecalc();
}
function setGeometryTargetFromU(){ setGeometryTargetHKL([num("Uh"),num("Uk"),num("Ul")]); }
function setGeometryTargetFromV(){ setGeometryTargetHKL([num("Vh"),num("Vk"),num("Vl")]); }
function setGeometryKiOrientationCondition(mode){
  try{
    const b=collectResolutionBase();
    // Geometry target selection uses the same canonical physical orientation as
    // Angle / Q-E / Dark-angle, so equivalent labels execute the same path.
    mode=canonicalOrientationMode(b.rl,mode);
    const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
    const {ex,ey}=makeSpiceScatteringPlaneBasis(b.rl,U,V);
    const qU=hklToQ(b.rl,U), qV=hklToQ(b.rl,V);
    const ux=dot(qU,ex), uy=dot(qU,ey), vx=dot(qV,ex), vy=dot(qV,ey);
    const phiU=rad2deg(Math.atan2(uy,ux)), phiV=rad2deg(Math.atan2(vy,vx));
    const usesV=mode==="perpV" || mode==="parallelV";
    const isParallel=mode==="parallelU" || mode==="parallelV";
    const phiAxis=usesV?phiV:phiU;

    // Perpendicular-condition buttons are absolute quick targets, not operations
    // on the previously entered Q.  Start from the corresponding fundamental
    // U/V Bragg position at elastic transfer so a previous high-Q target cannot
    // select a higher-|Q| solution.
    const currentHKL=(usesV?V:U).slice();
    const hw=0;
    $("geomH").value=currentHKL[0];
    $("geomK").value=currentHKL[1];
    $("geomL").value=currentHKL[2];
    $("geomHW").value=0;
    const qCurrent=hklToQ(b.rl,currentHKL), qNorm=norm(qCurrent);
    if(!(qNorm>1e-12)) throw new Error(`${usesV?"V":"U"} must be non-zero.`);
    const em=b.config.energy_mode;
    const Ei=em==="Ei fixed"?Number(b.config.Ei):Number(b.config.Ef)+hw;
    const Ef=em==="Ei fixed"?Number(b.config.Ei)-hw:Number(b.config.Ef);
    if(!(Ei>0) || !(Ef>0)) throw new Error("Ei and Ef must be positive.");
    const ki=Math.sqrt(Ei/2.072), kf=Math.sqrt(Ef/2.072);
    const cosS2=(ki*ki+kf*kf-qNorm*qNorm)/(2*ki*kf);
    if(cosS2<-1-1e-10||cosS2>1+1e-10) throw new Error("Current |Q| is not accessible at this energy transfer.");
    const s2Geom=rad2deg(Math.acos(clamp(cosS2,-1,1))), t=deg2rad(s2Geom);
    const phiQlab=rad2deg(Math.atan2(-kf*Math.sin(t),ki-kf*Math.cos(t)));
    const orient=canonicalOrientationMode(
      b.rl,$('orientationReference')?.value||'perpU'
    );
    let s1Perp;
    if(orient==='perpU') s1Perp=wrap180(-(phiAxis-phiU));
    else if(orient==='perpV') s1Perp=wrap180(-(phiAxis-phiV));
    else{
      const tx=dot(qCurrent,ex),ty=dot(qCurrent,ey),phi0=rad2deg(Math.atan2(ty,tx));
      const a0=tasMotorAngles({h:currentHKL[0],k:currentHKL[1],l:currentHKL[2],hw},b);
      const phiTargetPerp=wrap180(phiQlab+phiAxis-90);
      s1Perp=wrap180(a0.s1-angleDiffDeg(phiTargetPerp,phi0));
    }
    let phiTargetDeg;
    // For a matching ki-perpendicular Orientation reference, derive the
    // quick-target azimuth from the same calibrated S1 relation used by
    // tasMotorAngles().  At elastic transfer and equal |Q|:
    //
    //   S1 = S1_ref + (phi_ref - phi_target)/c2Sign
    //
    // Requiring S1=0 gives:
    //
    //   phi_target = phi_ref + c2Sign*S1_ref
    //
    // This is especially important for user-facing -+-, whose perpendicular
    // virtual Bragg reference is +S2/2 rather than -S2/2.
    if(orient===mode && ['perpU','perpV','parallelU','parallelV'].includes(mode)){
      const fixedE=em==="Ei fixed" ? Number(b.config.Ei) : Number(b.config.Ef);
      const convention=tasConvention(b.config.sense ?? selectedTasSense(),b.config.s1sign ?? selectedS1Sign());
      const orientationRef=effectiveOrientationReference(b.rl,fixedE,convention);
      const c2Sign=convention.c2ToOmegaSign;

      if(convention.sense==="+-+"){
        // The physical Sense selects the crystal-azimuth handedness.
        // Solve the S1=0 condition in crystal-azimuth space first, then map
        // it back to the displayed U/V reciprocal-space coordinates.  Using
        // phiAxis directly here mirrors the generated HKL to the wrong side.
        const qAxis=usesV ? qV : qU;
        const phiAxisCrystal=tasCrystalPhiDegForConvention(qAxis,ex,ey,convention.sense,convention.s1sign);
        const phiTargetCrystal=wrap180(phiAxisCrystal+c2Sign*orientationRef.s1);
        phiTargetDeg=tasPlotPhiFromCrystalPhiForConvention(phiTargetCrystal,convention.sense,convention.s1sign);
      }else{
        phiTargetDeg=wrap180(phiAxis+c2Sign*orientationRef.s1);
      }
    }else if(orient==='perpU') phiTargetDeg=wrap180(-90+phiU-phiQlab-s1Perp);
    else if(orient==='perpV') phiTargetDeg=wrap180(-90+phiV-phiQlab-s1Perp);
    else{
      const tx=dot(qCurrent,ex),ty=dot(qCurrent,ey),phi0=rad2deg(Math.atan2(ty,tx));
      const a0=tasMotorAngles({h:currentHKL[0],k:currentHKL[1],l:currentHKL[2],hw},b);
      phiTargetDeg=wrap180(phi0-angleDiffDeg(s1Perp,a0.s1));
    }
    const phiTarget=deg2rad(phiTargetDeg), qx=qNorm*Math.cos(phiTarget), qy=qNorm*Math.sin(phiTarget);
    const det=ux*vy-uy*vx; if(Math.abs(det)<=1e-12) throw new Error("U and V do not define an independent scattering plane.");
    const aa=(qx*vy-qy*vx)/det, bb=(ux*qy-uy*qx)/det;
    const exactTargetHKL=[
      aa*U[0]+bb*V[0],
      aa*U[1]+bb*V[1],
      aa*U[2]+bb*V[2]
    ];

    // Some encoder/sense combinations need extra HKL precision to round-trip to S1=0.
    // Rounding their generated HKL to three decimals before Angle calculation
    // can move the target slightly away from that condition (typically a few
    // hundredths of a degree).  Keep the shortest HKL precision that still
    // round-trips through the *same* tasMotorAngles() path to S1=0.000 deg.
    // This changes only the quick-target HKL written by Set; orientation
    // calibration and all Dark-angle zero/reference calculations are untouched.
    const setConvention=tasConvention(
      b.config.sense ?? selectedTasSense(),
      b.config.s1sign ?? selectedS1Sign()
    );
    let targetHKL;
    if(setConvention.s2EncoderSign<0){
      targetHKL=exactTargetHKL.slice();
      for(let digits=3;digits<=10;digits++){
        const candidate=exactTargetHKL.map(x=>Number(x.toFixed(digits)));
        targetHKL=candidate;
        try{
          const check=tasMotorAngles({h:candidate[0],k:candidate[1],l:candidate[2],hw:0},b);
          if(Number.isFinite(check.s1) && Math.abs(Number(check.s1))<5e-4) break;
        }catch(_err){
          // Keep increasing precision; the normal recalculation path will
          // surface any genuine accessibility/configuration error afterwards.
        }
      }
    }else{
      // Preserve the already-validated +-+ / -+- quick-target behavior exactly.
      targetHKL=exactTargetHKL.map(x=>Number(x.toFixed(3)));
    }
    setGeometryTargetHKL(targetHKL);
  }catch(err){ console.error(err); alert(err?.message||String(err)); }
}
function setGeometryKiPerpU(){ setGeometryKiOrientationCondition("perpU"); }
function setGeometryKiPerpV(){ setGeometryKiOrientationCondition("perpV"); }
function setGeometryKiParallelU(){ setGeometryKiOrientationCondition("parallelU"); }
function setGeometryKiParallelV(){ setGeometryKiOrientationCondition("parallelV"); }
function setGeometryTargetFromBragg(){ setGeometryTargetHKL([num("refh"),num("refk"),num("refl")]); }

// Keep the Angle calculation & TAS geometry target synchronized with the
// selected Sample orientation reference.  This intentionally reuses the exact
// same functions as the visible quick-target buttons, so changing the
// orientation reference is equivalent to clicking the corresponding
// Set ki ⟂ U/V, Set ki ∥ U/V, or Set Bragg peak button.
function syncGeometryTargetToOrientationReference(){
  const mode=$('orientationReference')?.value || 'perpU';
  if(mode==='perpU') return setGeometryKiPerpU();
  if(mode==='perpV') return setGeometryKiPerpV();
  if(mode==='parallelU') return setGeometryKiParallelU();
  if(mode==='parallelV') return setGeometryKiParallelV();
  if(mode==='bragg') return setGeometryTargetFromBragg();
}
function setGeometryTargetFromDarkRef(slot){
  const ids=darkAssetIds(slot);
  setGeometryTargetHKL([num(ids.refH),num(ids.refK),num(ids.refL)]);
}

  return {
    setGeometryKiParallelU, setGeometryKiParallelV, setGeometryKiPerpU, setGeometryKiPerpV,
    setGeometryTargetFromBragg, setGeometryTargetFromDarkRef, setGeometryTargetFromU,
    setGeometryTargetFromV, setGeometryTargetHKL, syncGeometryTargetToOrientationReference
  };
}
