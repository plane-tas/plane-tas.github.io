// TAS configuration/sign-convention helpers extracted from app.js.
// This module is intentionally UI-free: it contains only numerical/sign logic.

import {
  deg2rad, rad2deg, dot, norm, normalize, sub, scale
} from "./tas-core.js";


// A Sense is three scattering signs (monochromator, sample, analyzer).  The
// page chooses it as a W Sense (+-+ or -+-: the side of the monochromator)
// and a Geometry:
//   W       sample against the monochromator, analyzer against the sample
//   anti-W  sample against the monochromator, analyzer with the sample
//   U       sample with the monochromator,    analyzer against the sample
//   anti-U  sample with the monochromator,    analyzer with the sample
// ("anti" = the analyzer turns the same way as the sample).
export const TAS_W_SENSES=["+-+","-+-"];
export const TAS_GEOMETRIES=["W","anti-W","U","anti-U"];
export function normalizeTasSense(value){
  const v=String(value??"").trim();
  return /^[+-]{3}$/.test(v) ? v : "+-+";
}
export function composeTasSense(base,geometry="W"){
  const m=normalizeTasSense(base)[0]==="-" ? -1 : +1;
  const g=TAS_GEOMETRIES.includes(geometry) ? geometry : "W";
  const sample=g.endsWith("U") ? m : -m;
  const analyzer=g.startsWith("anti") ? sample : -sample;
  const c=x=>x>0 ? "+" : "-";
  return c(m)+c(sample)+c(analyzer);
}
// A Sense and a Geometry as saved by any version: a W Sense with its Geometry,
// or (briefly) the whole Sense in one value.
export function readTasSense(sense,geometry){
  const s=normalizeTasSense(sense);
  if(geometry!==undefined && geometry!==null && geometry!=="" && TAS_W_SENSES.includes(s)) return composeTasSense(s,geometry);
  return s;
}
// A Sense is three scattering signs, monochromator / sample / analyzer
// ('+' = counter-clockwise, as in Takin): +1 or -1 each.  Every other sign of
// the convention follows from the one of the axis it belongs to.
export function senseSigns(sense){
  const s=normalizeTasSense(sense);
  const sign=c=>c==='-' ? -1 : +1;
  return {mono:sign(s[0]),sample:sign(s[1]),analyzer:sign(s[2])};
}

// The physical Direct-beam Dark-angle zero has opposite handedness in the
// two TAS Sense configurations. Keep this single rule shared by the TAS
// geometry guide and the Q-E blocking polygons (and therefore Script warnings).
// This is a geometric correction, not a sample S1 motor/encoder correction.
export function darkDirectBeamZeroShiftDeg(rawOrientationOffsetDeg,sense){
  const offset=Number(rawOrientationOffsetDeg);
  return senseSigns(sense).sample*offset;
}

export function normalizeS1Sign(value){
  return String(value??"").trim().toLowerCase()==="cw" ? "cw" : "ccw";
}

// One source of truth for TAS scattering sense and sample-axis encoder polarity.
// Physical scattering geometry is selected by `sense`; S1 encoder polarity is
// independent and is selected by `s1sign`.  S2 polarity follows from both:
//   S2 sign = sample-scattering sign (middle sign of Sense) * S1 polarity.
// This gives the validated instrument combinations:
//   +-+ / CCW -> S2 -,  +-+ / CW -> S2 +
//   -+- / CCW -> S2 +,  -+- / CW -> S2 -
export function tasConvention(sense,s1sign="ccw"){
  const physicalSense=normalizeTasSense(sense);
  const motorSign=normalizeS1Sign(s1sign);
  const s1EncoderSign=motorSign==="ccw" ? +1 : -1; // physical CCW -> motor + for CCW-positive
  const signs=senseSigns(physicalSense);
  const monoSign=signs.mono;
  const sampleScatteringSign=signs.sample;
  const analyzerSign=signs.analyzer;
  const s2EncoderSign=sampleScatteringSign*s1EncoderSign;

  // Crystal/Q-space handedness belongs to the scattering at the sample;
  // encoder polarity is handled independently by s1EncoderSign.
  const crystalAzimuthHandedness=sampleScatteringSign;
  const ccwC2ToOmegaSign=sampleScatteringSign;
  const c2ToOmegaSign=ccwC2ToOmegaSign*s1EncoderSign;

  return {
    sense:physicalSense,
    s1sign:motorSign,
    s1EncoderSign,
    monoSign,
    sampleScatteringSign,
    analyzerSign,
    s2EncoderSign,
    crystalAzimuthHandedness,
    ccwC2ToOmegaSign,
    c2ToOmegaSign
  };
}




export function wrap180(x){
  let y=(Number(x)+180)%360;
  if(y<0) y+=360;
  return y-180;
}

// Four-circle motor-sign factors (bisecting mode).
//   phi: positive = CCW seen from above at chi = 0 ("ccw") or CW ("cw").
//        phi_out = phiFactor * (S1_TAS - S1) in S1 encoder units.
//   chi: positive = CCW seen from upstream, looking downstream along the
//        bisector of ki and kf (the chi axis in bisecting mode) ("ccw"),
//        or CW ("cw").  chi_out = chiFactor * e, where e is the elevation
//        of Q towards W = U x V (up at chi = 0).  Scattering to the right
//        (+-+) needs chi = -e for CCW, to the left (-+-) chi = +e.
//   The "ccw"/"ccw" setting reproduces VERITAS (HB-1A, +-+) data.
export function fourCircleSignFactors(convention,phiSign="ccw",chiSign="ccw"){
  const p=String(phiSign).toLowerCase()==="cw" ? -1 : 1;
  const c=String(chiSign).toLowerCase()==="cw" ? -1 : 1;
  return {phiFactor:p*convention.s1EncoderSign, chiFactor:c*convention.sampleScatteringSign};
}

export function angleDiffDeg(a,b){
  return wrap180(Number(a)-Number(b));
}

export function tasPhiLabDeg(ki,kf,s2deg){
  const t=deg2rad(s2deg);
  const qx=-kf*Math.sin(t);
  const qz= ki-kf*Math.cos(t);
  return rad2deg(Math.atan2(qx,qz));
}


// Canonical physical Q_lab convention for the refactored Sense/S1-sign model.
// It intentionally depends on scattering Sense only; changing S1 encoder
// polarity must never mirror reciprocal-space geometry.
export function tasPhiLabDegForConvention(ki,kf,s2deg,sense,s1sign="ccw"){
  void s1sign;
  normalizeTasSense(sense);
  return tasPhiLabDeg(ki,kf,s2deg);
}

// Crystal in-plane azimuth convention used by the sample S1 encoder.

export function tasCrystalPhiDegForConvention(q,ex,ey,sense,s1sign="ccw",{allowZeroProjection=false}={}){
  const handedness=tasConvention(sense,s1sign).crystalAzimuthHandedness;
  const x=dot(q,ex), y=handedness*dot(q,ey);
  if(Math.hypot(x,y)<1e-12){
    if(allowZeroProjection) return 0;
    throw new Error('Calculation Q has no in-plane component and cannot define the TAS sample orientation.');
  }
  return rad2deg(Math.atan2(y,x));
}
export function tasPlotPhiFromCrystalPhiForConvention(phiDeg,sense,s1sign="ccw"){
  return wrap180(tasConvention(sense,s1sign).crystalAzimuthHandedness*Number(phiDeg));
}

export function calcQ0(s1,s2,ki,kf,s1Offset,refS1,QrefXY,sense,s1Calibration=null){
  if(s1Calibration){
    // Exact inverse of tasMotorAngles() S1 calibration.  The calibration carries
    // the physical Sense/S1-sign convention directly; no legacy four-state
    // label participates in this conversion.
    const qMag=Math.sqrt(Math.max(0,ki*ki+kf*kf-2*ki*kf*Math.cos(deg2rad(s2))));
    const omegaTarget=s1Calibration.omegaRef
      + s1Calibration.c2Sign*(s1-s1Calibration.refS1);
    const physicalSense=normalizeTasSense(s1Calibration.sense ?? sense);
    const motorSign=normalizeS1Sign(s1Calibration.s1sign);
    const handedness=Number.isFinite(Number(s1Calibration.crystalAzimuthHandedness))
      ? Number(s1Calibration.crystalAzimuthHandedness)
      : tasConvention(physicalSense,motorSign).crystalAzimuthHandedness;
    const phiCrystal=wrap180(
      tasPhiLabDegForConvention(ki,kf,s2,physicalSense,motorSign)-omegaTarget
    );
    const phiTarget=deg2rad(wrap180(handedness*phiCrystal));
    return [qMag*Math.cos(phiTarget),qMag*Math.sin(phiTarget)];
  }

  // Fallback only when a usable S1 reference calibration is unavailable.
  const kiAngle=deg2rad(-s1+s1Offset+refS1);
  const kfAngle=deg2rad(s2-s1+s1Offset+refS1);
  let q=[ki*Math.sin(kiAngle)-kf*Math.sin(kfAngle),
         ki*Math.cos(kiAngle)-kf*Math.cos(kfAngle)];
  // The old fallback reflection belonged to the physical -+- geometry; express
  // it directly in physical Sense rather than through the swapped calculation key.
  if(senseSigns(sense).sample>0 && norm(QrefXY)>1e-10){
    const eQ=normalize(QrefXY);
    q=sub(scale(eQ,2*dot(q,eQ)),q);
  }
  return q;
}


// User-facing motor angles (Angle calculation, Script/Time-estimate checks and
// the Resolution tab).  tasMotorAngles() gives M1/M2 and A1/A2 counter-
// clockwise positive (negative for -+-, positive for +-+); the motors count
// as their signs say ("m_sign" / "a_sign" of the instrument file: CW turns
// them over).  S1 and S2 are unchanged (already in S1-motor units).  Powder
// has no sample rotation, so its S1 is shown as 0.  Display only: no
// calculation uses these values.
export function displayedMotorAngles(angles,isPowder=false,{msign="ccw",asign="ccw"}={}){
  const a=angles||{};
  const m=normalizeS1Sign(msign)==="cw" ? -1 : 1, an=normalizeS1Sign(asign)==="cw" ? -1 : 1;
  const f=(k,v)=>v===null || v===undefined || !Number.isFinite(Number(v)) ? v : k*Number(v)+0;
  return {
    m1:f(m,a.m1), m2:f(m,a.m2),
    s1:isPowder ? 0 : a.s1, s2:a.s2,
    a1:f(an,a.a1), a2:f(an,a.a2)
  };
}
