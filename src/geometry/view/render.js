// TAS geometry: drawing of the instrument (renderGeometry).
// Part of the TAS geometry view (see ../tas-geometry-view.js for how the parts are wired).
import {darkDirectBeamZeroShiftDeg} from '../../core/tas-conventions.js';
export function installGeometryRender(ctx){
  const {deps:{
    $, angleDiffDeg, checkedValue, clamp, currentInstrument, deg2rad,
    directBeamOrientationCorrection, dot, effectiveOrientationReference, hklToQ, linspace,
    makeSpiceScatteringPlaneBasis, norm, num, powderGeometryTarget, qeGeometryAngles, rad2deg,
    selectedS1Sign, selectedTasSense, syncGeometrySliders, tasConvention, updateGeometryTargetMarker,
    userFacingTasMessage
  }, fn}=ctx;
  Object.assign(fn,{
    renderGeometry
  });

function renderGeometry(cache,index=0){
  const isPowder=checkedValue("sampleMode")==="powder" || !!cache?.powder;
  const isDiffractometer=['diffractometer','four-circle'].includes(currentInstrument()?.instrument_type);   // 4-circle: no analyzer
  // Powder has no crystallographic sample orientation, but the TAS scattering
  // sign still determines the displayed motor-angle branch exactly as it does
  // for Single crystal.
  const convention=tasConvention(selectedTasSense(),selectedS1Sign());
  const sense=convention.sense;
  // Schematic placement depends on physical scattering Sense only.
  const displaySense=convention.sense;
  const scanMode=!isPowder && fn.geometryCalculationMode()==='scan';
  // Keep the U / V / hbar-omega sliders and the Constant E map marker on the
  // current target (Single only).
  syncGeometrySliders?.();
  if(!isPowder) updateGeometryTargetMarker?.(cache);
  const scanPoints=scanMode ? fn.geometryScanPoints() : [];
  fn.updateGeometryPlaneWarning(scanPoints);
  const scanIndex=scanMode ? fn.syncGeometryScanPointSlider(scanPoints.length) : 0;
  const scanCalc=scanMode ? (scanPoints[scanIndex] || null) : null;
  const mirror=displaySense==="+-+" ? 1 : -1;

  // A Single-crystal target is h,k,l,hw. Scan mode supplies the selected
  // interpolated point without changing the established single-point inputs.
  // A Powder target is the linked S2/Q pair together with hw.
  let target=null;
  let targetError="";
  try{ target=isPowder ? powderGeometryTarget() : qeGeometryAngles(cache,null,null,scanCalc); }
  catch(err){ targetError=userFacingTasMessage(err?.message || String(err)); }

  const L=2.05;
  // The region around the sample (mono-sample and sample-analyzer legs, the
  // ki/kf/Q/U/V vectors and the Dark-angle guide) is drawn 1.5x larger than
  // the outer legs, so Dark angles and vectors stay readable.
  const SAMPLE_REGION_SCALE=1.5;
  let source,mono,sample,analyzer,detector;
  let thetaKi,thetaKf,thetaOut;
  let monoPlaneAngle,anaPlaneAngle;
  let qAngle;
  // Vector-display lengths are derived from the actual wave-vector magnitudes.
  // The fixed-energy side is the visual scale reference: Ef fixed -> kf fixed,
  // Ei fixed -> ki fixed.  Flight-path leg lengths remain schematic/equal.
  let kiVectorLen=0.50*L*SAMPLE_REGION_SCALE, kfVectorLen=0.50*L*SAMPLE_REGION_SCALE, qVectorLen=1.38*SAMPLE_REGION_SCALE;
  // Longest displayed ki/kf/Q arrow: Q of elastic back-scattering at the
  // fixed-k scale.  Larger (strongly inelastic, e.g. cold TAS) vectors are
  // shrunk together, keeping their ratios, so they never rescale the figure.
  const VECTOR_MAX_LEN=2*0.50*L*SAMPLE_REGION_SCALE;
  // Canonical (+-+) points of the instrument over the whole hbar-omega range
  // of the Q-E map and every S2, used to fix the figure scale (below).
  let envelopeCanonical=[];

  if(target){
    // Build one canonical (+-+) drawing, then make -+- an exact left/right
    // reflection of it.  This prevents the two sign configurations from drifting
    // to different screen positions because of their signed motor angles.
    // The schematic has its own display convention. Always construct the
    // canonical user-facing +-+ geometry from the +-+ motor-angle branch, then
    // apply the existing display mirror below only when the UI selects -+-.
    // Numerical Angle/Q-E results remain on the intentionally swapped branches.
    // Use the exact same canonical raw +-+ motor-angle branch for Powder and
    // Single crystal. Powder's user-facing angle calculation still keeps the
    // established sign-label mapping; only the schematic bypasses that mapping
    // so the drawing mirrors exactly like the Single-crystal schematic.
    // Always build one canonical physical +-+ / CCW-positive geometry here.
    // The selected physical Sense is applied exactly once by the display mirror
    // below.  Previously -+- was already selected inside qeGeometryAngles() and
    // then mirrored again here, so +-+ and -+- collapsed to the same schematic.
    const canonicalConvention=tasConvention("+-+","ccw");
    const drawTarget=isPowder
      ? powderGeometryTarget(canonicalConvention,true)
      : qeGeometryAngles(cache,null,canonicalConvention,scanCalc);
    const {angles,ki,kf}=drawTarget;
    source=[-L,0];
    mono=[0,0];
    thetaKi=deg2rad(angles.m2);
    sample=[mono[0]+SAMPLE_REGION_SCALE*L*Math.cos(thetaKi),mono[1]+SAMPLE_REGION_SCALE*L*Math.sin(thetaKi)];
    // Build the detector arm in the canonical +-+ drawing frame. In that
    // frame the physical S2 arm is clockwise. The -+- schematic is produced
    // by the single display reflection below, which turns this same physical
    // arm into the required counter-clockwise S2 geometry. Do not apply the
    // Sense sign here as well, or -+- is reflected twice and appears clockwise.
    const s2Draw=-Math.abs(Number(angles.s2));
    thetaKf=thetaKi+deg2rad(s2Draw);
    analyzer=[sample[0]+SAMPLE_REGION_SCALE*0.90*L*Math.cos(thetaKf),sample[1]+SAMPLE_REGION_SCALE*0.90*L*Math.sin(thetaKf)];
    thetaOut=thetaKf+deg2rad(angles.a2);
    // Diffractometer: schematic flight paths on either side of the sample
    // must have equal displayed lengths.  This does NOT alter the L1/L2
    // distances in instrument JSON or any scattering-angle calculation.
    detector=isDiffractometer
      ? [sample[0]+SAMPLE_REGION_SCALE*L*Math.cos(thetaKf),sample[1]+SAMPLE_REGION_SCALE*L*Math.sin(thetaKf)]
      : [analyzer[0]+0.80*L*Math.cos(thetaOut),analyzer[1]+0.80*L*Math.sin(thetaOut)];
    monoPlaneAngle=deg2rad(angles.m1);
    anaPlaneAngle=thetaKf+deg2rad(angles.a1);

    // Use the physical ki/kf ratio only to determine Q direction.  The displayed
    // arrow length stays fixed, so cold/thermal settings do not rescale the figure.
    const qx=ki*Math.cos(thetaKi)-kf*Math.cos(thetaKf);
    const qy=ki*Math.sin(thetaKi)-kf*Math.sin(thetaKf);
    const qMag=Math.hypot(qx,qy);
    qAngle=Math.atan2(qy,qx);

    // Encode inelasticity in the vector lengths without changing the instrument
    // flight-path geometry.  The fixed-energy wave vector always has the same
    // displayed length, and the other beam/Q vectors use the identical scale.
    const kFixed=(cache.energyMode==="Ef fixed") ? kf : ki;
    let vectorScale=(Number.isFinite(kFixed) && kFixed>1e-12) ? (SAMPLE_REGION_SCALE*0.50*L/kFixed) : 1;
    const longest=vectorScale*Math.max(ki,kf,qMag);
    if(longest>VECTOR_MAX_LEN) vectorScale*=VECTOR_MAX_LEN/longest;
    kiVectorLen=vectorScale*ki;
    kfVectorLen=vectorScale*kf;
    qVectorLen=vectorScale*qMag;

    // Envelope of the drawing for this instrument and energy setting: the
    // monochromator and analyzer take-off angles for every hbar-omega of the
    // Q-E map (Bragg's law from the present angles) and S2 over the
    // instrument's S2 min to effective S2 max.
    // Fitting the view to this envelope, instead of only to the present
    // target, keeps the scale and the monochromator fixed while sliders move.
    try{
      const tauM=2*ki*Math.sin(Math.abs(deg2rad(angles.m2))/2), sgnM=Math.sign(angles.m2)||1;
      const tauA=2*kf*Math.sin(Math.abs(deg2rad(angles.a2))/2), sgnA=Math.sign(angles.a2)||1;
      const hwValues=(cache.hwList||[]).map(Number).filter(Number.isFinite);
      const hwMin=Math.min(0,...hwValues), hwMax=Math.max(0,...hwValues);
      const E0=cache.energyMode==="Ei fixed" ? Number(cache.Ei) : Number(cache.Ef);
      // S2 limits of the instrument (sidebar), plus the present S2.
      const s2LoIn=Math.abs(Number($("S2min")?.value)), s2HiIn=Math.abs(Number($("S2maxEffective")?.value));
      const s2Lo=Number.isFinite(s2LoIn)?Math.min(180,s2LoIn):0;
      const s2Hi=Number.isFinite(s2HiIn)&&s2HiIn>s2Lo?Math.min(180,s2HiIn):180;
      const s2List=[...Array.from({length:13},(_,j)=>s2Lo+(s2Hi-s2Lo)*j/12),Math.abs(Number(angles.s2))].filter(Number.isFinite);
      for(let i=0;i<=8;i++){
        const w=hwMin+(hwMax-hwMin)*i/8;
        const Ei=cache.energyMode==="Ei fixed" ? E0 : E0+w, Ef=cache.energyMode==="Ei fixed" ? E0-w : E0;
        if(!(Ei>0 && Ef>0)) continue;
        const k1=Math.sqrt(Ei/2.072), k2=Math.sqrt(Ef/2.072);
        if(tauM/(2*k1)>1 || tauA/(2*k2)>1) continue;
        const tKi=deg2rad(sgnM*2*Math.asin(tauM/(2*k1))*180/Math.PI);
        const a2w=sgnA*2*Math.asin(tauA/(2*k2))*180/Math.PI;
        const s=[mono[0]+SAMPLE_REGION_SCALE*L*Math.cos(tKi),mono[1]+SAMPLE_REGION_SCALE*L*Math.sin(tKi)];
        envelopeCanonical.push(s);
        for(const s2 of s2List){
          const tKf=tKi-deg2rad(s2);
          const an=[s[0]+SAMPLE_REGION_SCALE*0.90*L*Math.cos(tKf),s[1]+SAMPLE_REGION_SCALE*0.90*L*Math.sin(tKf)];
          if(isDiffractometer){
            envelopeCanonical.push([s[0]+SAMPLE_REGION_SCALE*L*Math.cos(tKf),s[1]+SAMPLE_REGION_SCALE*L*Math.sin(tKf)]);
          }else{
            const tOut=tKf+deg2rad(a2w);
            envelopeCanonical.push(an,[an[0]+0.80*L*Math.cos(tOut),an[1]+0.80*L*Math.sin(tOut)]);
          }
        }
      }
    }catch(_err){ envelopeCanonical=[]; }

    // Keep the calculated coordinates in one canonical (+-+) frame.
    // For -+-, the Plotly x-axis is reversed below.  Reversing the viewport,
    // rather than recomputing/flipping every coordinate, guarantees a true
    // pixel-for-pixel left/right mirror with the same scale and anchor point.
  }else{
    // Previous idealized fallback.
    sample=[0,0]; mono=[0,L]; source=[-L,L]; analyzer=[-mirror*0.75*L,0]; detector=[-mirror*0.75*L,0.5*L];
    if(isDiffractometer) detector=[-mirror*L,0];
    thetaKi=-Math.PI/2; thetaKf=mirror>0?Math.PI:-0; thetaOut=-Math.PI/2;
    monoPlaneAngle=mirror*deg2rad(45); anaPlaneAngle=mirror*deg2rad(45);
    qAngle=-mirror*Math.PI/4;
  }

  // Display-only transform.  First rotate the canonical TAS drawing so the
  // instrument develops mainly downward from the monochromator.  For -+-,
  // reflect the DRAWING coordinates themselves instead of reversing Plotly's
  // x axis.  This makes subsequent auto-fitting straightforward and keeps all
  // labels / dark-angle guides in the same coordinate system.
  const rotateCCW90=([x,y])=>[y,-x];
  source=rotateCCW90(source);
  mono=rotateCCW90(mono);
  sample=rotateCCW90(sample);
  analyzer=rotateCCW90(analyzer);
  detector=rotateCCW90(detector);
  thetaKi-=Math.PI/2;
  thetaKf-=Math.PI/2;
  thetaOut-=Math.PI/2;
  monoPlaneAngle-=Math.PI/2;
  anaPlaneAngle-=Math.PI/2;
  qAngle-=Math.PI/2;

  let envelope=envelopeCanonical.map(rotateCCW90);
  if(displaySense==="-+-") envelope=envelope.map(([x,y])=>[-x,y]);
  if(displaySense==="-+-") {
    const reflectX=([x,y])=>[-x,y];
    source=reflectX(source); mono=reflectX(mono); sample=reflectX(sample);
    analyzer=reflectX(analyzer); detector=reflectX(detector);
    const reflectAngle=a=>Math.PI-a;
    thetaKi=reflectAngle(thetaKi);
    thetaKf=reflectAngle(thetaKf);
    thetaOut=reflectAngle(thetaOut);
    monoPlaneAngle=reflectAngle(monoPlaneAngle);
    anaPlaneAngle=reflectAngle(anaPlaneAngle);
    qAngle=reflectAngle(qAngle);
  }

  const traces=[];
  const addLine=(a,b,color,width=3,dash="solid")=>traces.push({x:[a[0],b[0]],y:[a[1],b[1]],mode:"lines",line:{color,width,dash},hoverinfo:"skip",showlegend:false});
  const flightColor="#cfcfcf";
  addLine(source,mono,flightColor,4);
  addLine(mono,sample,flightColor,4);
  if(isDiffractometer) addLine(sample,detector,flightColor,4);
  else { addLine(sample,analyzer,flightColor,4); addLine(analyzer,detector,flightColor,4); }

  // Fixed, compact display radius: independent of instrument/angle auto-scaling.
  // The guide circle belongs to the dark-angle overlay, so hide it together
  // with the dark-angle sectors when the left-panel "show" checkbox is off.
  // 4-circle: dark angles are not available yet (the TAS sectors do not apply).
  let fourCircleInstrument=false;
  try{ fourCircleInstrument=currentInstrument()?.instrument_type==='four-circle'; }catch(_e){}
  const showDarkGeometry=!isPowder && !fourCircleInstrument && Boolean($("addDark")?.checked);
  const darkRadius=1.0*SAMPLE_REGION_SCALE;
  if(showDarkGeometry){
    const circle=linspace(0,2*Math.PI,181);
    traces.push({x:circle.map(t=>sample[0]+darkRadius*Math.cos(t)),y:circle.map(t=>sample[1]+darkRadius*Math.sin(t)),mode:"lines",line:{color:"#d9d9d9",width:1},hoverinfo:"skip",showlegend:false});
  }

  // Draw every enabled dark-angle asset independently. Reference-Q assets
  // rotate with the sample about Q; Direct-beam assets use the ki direction at
  // the Reference-Q condition; Fixed assets remain laboratory-fixed.
  let referenceBase=qAngle, deltaS1=0;
  if(target && !isPowder){
    try{
      const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
      const {ex,ey}=makeSpiceScatteringPlaneBasis(cache.rl,U,V);
      const qPlaneAngle=hkl=>{const q=hklToQ(cache.rl,hkl),x=dot(q,ex),y=dot(q,ey);return Math.hypot(x,y)<1e-12?0:Math.atan2(y,x);};
      const phiTarget=qPlaneAngle([target.calc.h,target.calc.k,target.calc.l]);
      const effectiveRef=effectiveOrientationReference(cache.rl,(cache.energyMode==="Ei fixed")?cache.Ei:cache.Ef);
      const phiRef=qPlaneAngle(effectiveRef.hkl);
      const crystalDelta=phiRef-phiTarget;
      // Sample-attached directions follow the physical S1 rotation sense.
      // Sample-attached Dark directions use the same crystallographic azimuth as U/V.
      // Use exactly the same relative crystallographic azimuth as the U/V guides
      // below. qAngle already contains the TAS-sense mirror, so applying another
      // handedness factor here makes the -+- Dark overlay rotate opposite to U/V.
      referenceBase=qAngle+crystalDelta;
      const refS1=effectiveRef.s1;
      if(Number.isFinite(target.angles?.s1)&&Number.isFinite(refS1)) deltaS1=angleDiffDeg(target.angles.s1,refS1);
    }catch(_err){ referenceBase=qAngle; }
  }

  if(showDarkGeometry) for(const asset of (cache.darkAssets||[])){
    let base=referenceBase, darkReferenceOffset=0;
    if(asset.ref==="Reference Q" && target){
      try{
        const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
        const {ex,ey}=makeSpiceScatteringPlaneBasis(cache.rl,U,V);
        const qPlaneAngle=hkl=>{const q=hklToQ(cache.rl,hkl),x=dot(q,ex),y=dot(q,ey);return Math.hypot(x,y)<1e-12?0:Math.atan2(y,x);};
        const phiTarget=qPlaneAngle([target.calc.h,target.calc.k,target.calc.l]);
        const phiDark=qPlaneAngle(asset.refHkl||[1,0,0]);
        const crystalDelta=phiDark-phiTarget;
        // Keep the Reference-Q Dark-angle direction locked to the same
        // crystallographic rotation used by the displayed U/V guides.
        base=qAngle+crystalDelta;
      }catch(_err){}
    }else if(asset.ref==="Direct beam"){
      try{
        const effectiveRef=effectiveOrientationReference(cache.rl,(cache.energyMode==="Ei fixed")?cache.Ei:cache.Ef);
        const qRef=hklToQ(cache.rl,effectiveRef.hkl);
        const qRefNorm=norm(qRef), refEnergy=(cache.energyMode==="Ei fixed")?cache.Ei:cache.Ef;
        if(qRefNorm>1e-12&&Number.isFinite(refEnergy)&&refEnergy>0){
          const kRef=Math.sqrt(refEnergy/2.072), thetaRef=Math.asin(clamp(qRefNorm/(2*kRef),-1,1));
          const qToKi=Math.PI/2-thetaRef;
          // Direct-beam zero must lie on the forward ki extension. Relative
          // to the crystallographic reference direction the two TAS
          // configurations are mirror images:
          //   +-+ : -(90°-theta)
          //   -+- : +(90°-theta)
          base+=(displaySense==="+-+" ? -1 : +1)*qToKi;
          darkReferenceOffset=(displaySense==="+-+"?-1:+1)*rad2deg(qToKi);
        }
      }catch(_err){}
    }else if(asset.ref==="Fixed"){
      base=thetaKi; darkReferenceOffset=0;
    }
    asset.ranges.forEach((r,j)=>{
      const [from,to,offset]=r; if(from===0&&to===0) return;
      const directBeamCorrection=asset.ref==="Direct beam"
        ? directBeamOrientationCorrection(cache.rl,cache.energyMode,cache.Ei,cache.Ef,sense) : 0;

      // Share the same physical Direct-beam zero correction with the Q-E
      // polygon builder; both sense choices must agree with the direct beam.
      // Leave the entered ranges and motor/encoder conventions untouched.
      const geometryDirectBeamCorrection=asset.ref==="Direct beam"
        ? darkDirectBeamZeroShiftDeg(directBeamCorrection,displaySense)
        : directBeamCorrection;

      // Keep the reference zero/calibration exactly where it is, but make the
      // user-entered Rotation/Offset follow the sample S1 sign convention.
      // For -+- that means +dark angle is counter-clockwise, while the existing
      // Direct-beam correction remains on its validated (clockwise) calibration
      // side.  Fixed-reference angles are laboratory-fixed and stay unchanged.
      // Unwrap the entered motor interval *before* applying its sign.  Applying
      // CW polarity first turns [-15,+15] into [+15,-15]; the old a1<a0 rule
      // then interpreted that as an almost-full 360-degree sector.
      let motorFrom=offset+from;
      let motorTo=offset+to;
      if(motorTo<motorFrom) motorTo+=360;

      // Dark-angle input is an S1 motor coordinate.  Use the same encoder polarity
      // as the validated S1-range display.  Sense changes the base geometry, but
      // must not swap CW and CCW here.  Fixed remains laboratory-fixed.
      const inputSign=asset.ref==="Fixed" ? +1 : convention.s1EncoderSign;
      const a0=inputSign*motorFrom+geometryDirectBeamCorrection;
      const a1=inputSign*motorTo+geometryDirectBeamCorrection;
      const aa=linspace(a0,a1,120).map(d=>base+deg2rad(d));
      // Display-only differentiation: every Dark angle is red.  Slots are
      // separated radially (1.0, 1.1, 1.2, ... x radius), so color no longer
      // needs to encode the slot number. Numerical dark-angle calculations are unchanged.
      const slotIndex=Math.max(1,Number(asset.slot)||1);
      const assetRadius=darkRadius*(1+0.1*(slotIndex-1));
      const assetColor="#d62728";
      traces.push({x:aa.map(t=>sample[0]+assetRadius*Math.cos(t)),y:aa.map(t=>sample[1]+assetRadius*Math.sin(t)),mode:"lines",line:{color:assetColor,width:4},name:`Dark ${asset.slot}-${j+1}`,hovertemplate:`Dark angle ${asset.slot}-${j+1}<br>Reference=${asset.ref}<br>ΔS1=${deltaS1.toFixed(2)}°<br>Ref offset=${darkReferenceOffset.toFixed(2)}°<extra></extra>`,showlegend:false});
    });
  }

  const crystal=(c,ang,len=0.58)=>{const dx=.5*len*Math.cos(ang),dy=.5*len*Math.sin(ang);addLine([c[0]-dx,c[1]-dy],[c[0]+dx,c[1]+dy],"black",3);};
  crystal(mono,monoPlaneAngle); if(!isDiffractometer) crystal(analyzer,anaPlaneAngle);
  traces.push({x:[detector[0]],y:[detector[1]],mode:"markers",marker:{size:24,symbol:"circle",color:"orange",line:{color:"black",width:1}},hovertext:["Detector"],hovertemplate:"%{hovertext}<extra></extra>",showlegend:false});
  traces.push({x:[sample[0]],y:[sample[1]],mode:"markers",marker:{size:8,symbol:"circle",color:"black"},hovertext:["Sample"],hovertemplate:"%{hovertext}<extra></extra>",showlegend:false});

  const pointAlong=(a,b,f)=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
  // ki points into the sample; kf points away from it.  Their lengths now carry
  // the actual |ki|/|kf| ratio.  Q uses the same reciprocal-space scale, so its
  // magnitude and direction are consistent with Q = ki - kf.
  const kiArrow={
    tail:[sample[0]-kiVectorLen*Math.cos(thetaKi),sample[1]-kiVectorLen*Math.sin(thetaKi)],
    head:sample.slice()
  };
  const kfArrow={
    tail:sample.slice(),
    head:[sample[0]+kfVectorLen*Math.cos(thetaKf),sample[1]+kfVectorLen*Math.sin(thetaKf)]
  };
  const qEnd=[sample[0]+qVectorLen*Math.cos(qAngle),sample[1]+qVectorLen*Math.sin(qAngle)];

  // Display-only crystallographic U/V guides are meaningful only for a
  // Single-crystal sample. Powder has no sample-orientation axes.
  let uArrowAngle=qAngle, vArrowAngle=qAngle;
  const uvVectorLen=1.5*darkRadius;
  const vectorEnd=ang=>[
    sample[0]+uvVectorLen*Math.cos(ang),
    sample[1]+uvVectorLen*Math.sin(ang)
  ];
  let uEnd=null, vEnd=null;
  const uColor="#f2b6a0", vColor="#e377c2";
  if(!isPowder){
    try{
      const U=[num("Uh"),num("Uk"),num("Ul")], V=[num("Vh"),num("Vk"),num("Vl")];
      const {ex,ey}=makeSpiceScatteringPlaneBasis(cache.rl,U,V);
      const planePhi=hkl=>{const q=hklToQ(cache.rl,hkl),x=dot(q,ex),y=dot(q,ey);return Math.atan2(y,x);};
      const targetHKL=target ? [target.calc.h,target.calc.k,target.calc.l] : U;
      const phiT=planePhi(targetHKL), phiU=planePhi(U), phiV=planePhi(V);
      // qAngle already contains the selected TAS geometry mirror.  Keep the
      // entered reciprocal-space U->V handedness relative to that mirrored Q;
      // reflecting the relative azimuth a second time makes -+- appear
      // left-handed.  The crystallographic plane itself remains right-handed.
      uArrowAngle=qAngle+(phiU-phiT);
      vArrowAngle=qAngle+(phiV-phiT);
    }catch(_err){}
    uEnd=vectorEnd(uArrowAngle);
    vEnd=vectorEnd(vArrowAngle);
  }

  // Presentation only. Anchor equipment labels to their actual components,
  // then use *pixel* shifts to keep spacing consistent when the card resizes.
  // In particular, avoid positioning labels in data units (those apparent gaps
  // changed whenever the geometry's auto-fit range changed).
  const componentFont={family:'Arial, sans-serif',size:20,color:'#243246'};
  const vectorFontSize=21;
  const outward=displaySense==='+-+' ? -1 : 1;
  const equipmentLabel=(point,text,dx,dy,xanchor='center',yanchor='middle')=>({
    x:point[0],y:point[1],xref:'x',yref:'y',text,showarrow:false,
    xshift:dx,yshift:dy,xanchor,yanchor,font:componentFont,
    captureevents:false
  });
  const vectorLabel=(point,text,angle,side,color)=>({
    x:point[0],y:point[1],xref:'x',yref:'y',text,showarrow:false,
    // The perpendicular is measured in display pixels, not plot coordinates.
    // This keeps k_i / k_f / Q away from their arrow shafts at every width.
    xshift:Math.round(-Math.sin(angle)*side*11),
    yshift:Math.round( Math.cos(angle)*side*11),
    xanchor:'center',yanchor:'middle',
    font:{family:'Arial, sans-serif',size:vectorFontSize,color},
    captureevents:false
  });
  // Keep the k_i, k_f and Q captions inside the Dark-angle guide circle,
  // closer to its centre (the sample), instead of near the arrow tips where
  // captions can collide with Dark-angle sector arcs.  This changes only
  // annotation anchors: the physical vector endpoints are untouched.
  const vectorLabelNearSample=(tip,relativeDistance)=>{
    const length=Math.hypot(tip[0]-sample[0],tip[1]-sample[1]);
    if(!Number.isFinite(length) || length<1e-10) return sample.slice();
    const distance=Math.min(relativeDistance*length,0.50*darkRadius);
    return pointAlong(sample,tip,distance/length);
  };
  const kiNearCenter=vectorLabelNearSample(kiArrow.tail,0.52);
  const kfNearCenter=vectorLabelNearSample(kfArrow.head,0.52);
  // Q is slightly closer to the sample than k_f to maintain visual separation
  // in configurations where the vectors point in similar directions.
  const qNearCenter=vectorLabelNearSample(qEnd,0.44);
  // Place k_i on the side away from Q, so bringing both labels closer to
  // the circle centre does not cause them to bunch together.
  const kiLabelSide=Math.sin(qAngle-thetaKi)>=0 ? -1 : 1;
  const qLabelSide=Math.sin(thetaKf-qAngle)>=0 ? -1 : 1;
  const qCenterLabel=vectorLabel(qNearCenter,'<i>Q</i>',qAngle,qLabelSide,'#202020');
  // Component captions sit on the open side of their component, so they do
  // not lie on a flight path, a vector or another caption.
  const unitVec=v=>{const n=Math.hypot(v[0],v[1]);return n>1e-12?[v[0]/n,v[1]/n]:[0,0];};
  const openSideLabel=(point,dir,text,distPx=16)=>{
    const [ax,ay]=dir;
    const xanchor=ax>0.35?'left':ax<-0.35?'right':'center';
    const yanchor=ay>0.35?'bottom':ay<-0.35?'top':'middle';
    return equipmentLabel(point,text,Math.round(ax*distPx),Math.round(ay*distPx),xanchor,yanchor);
  };
  // Analyzer: opposite to the bisector of its sample and detector legs.
  const anaDir=(()=>{
    const a=unitVec([sample[0]-analyzer[0],sample[1]-analyzer[1]]);
    const b=unitVec([detector[0]-analyzer[0],detector[1]-analyzer[1]]);
    let d=unitVec([-(a[0]+b[0]),-(a[1]+b[1])]);
    if(Math.hypot(d[0],d[1])<0.5) d=unitVec([-a[1],a[0]]);
    return d;
  })();
  // Detector: continue its incoming leg beyond the detector.
  const detFrom=isDiffractometer ? sample : analyzer;
  const detDir=unitVec([detector[0]-detFrom[0],detector[1]-detFrom[1]]);
  // Sample: just outside the Dark-angle guide circle, in the direction that is
  // farthest from every line leaving the sample (ki, kf, Q, U, V).
  const sampleDir=(()=>{
    const used=[thetaKi+Math.PI,thetaKf,qAngle];
    if(!isPowder && uEnd && vEnd) used.push(uArrowAngle,vArrowAngle);
    let best=Math.PI/2, bestGap=-1;
    for(let k=0;k<72;k++){
      const t=k*Math.PI/36;
      const gap=Math.min(...used.map(u=>Math.abs(Math.atan2(Math.sin(t-u),Math.cos(t-u)))));
      // Prefer upper directions slightly when gaps are similar.
      const score=gap+0.08*Math.sin(t);
      if(score>bestGap){ bestGap=score; best=t; }
    }
    return [Math.cos(best),Math.sin(best)];
  })();
  // Outside the outermost Dark-angle arc when the guide is shown, otherwise
  // close to the sample.
  const outerDarkSlot=Math.max(1,...(cache.darkAssets||[]).map(a=>Number(a.slot)||1));
  // Single crystal: also beyond the U / V tip labels (uvVectorLen + 0.22).
  const uvLabelRadius=(!isPowder && uEnd && vEnd) ? uvVectorLen+0.22+0.15 : 0;
  const sampleLabelRadius=Math.max(showDarkGeometry ? 1.06*darkRadius*(1+0.1*(outerDarkSlot-1)) : 0.30*darkRadius, uvLabelRadius);
  const sampleLabelAnchor=[sample[0]+sampleLabelRadius*sampleDir[0],sample[1]+sampleLabelRadius*sampleDir[1]];
  const annotations=[];
  if(!isPowder && uEnd && vEnd){
    annotations.push(
      {x:uEnd[0],y:uEnd[1],ax:sample[0],ay:sample[1],xref:'x',yref:'y',axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:3,arrowsize:1.1,arrowwidth:2.4,arrowcolor:uColor},
      {x:vEnd[0],y:vEnd[1],ax:sample[0],ay:sample[1],xref:'x',yref:'y',axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:3,arrowsize:1.1,arrowwidth:2.4,arrowcolor:vColor},
      {x:uEnd[0]+0.22*Math.cos(uArrowAngle),y:uEnd[1]+0.22*Math.sin(uArrowAngle),text:'U',showarrow:false,font:{color:uColor,size:19}},
      {x:vEnd[0]+0.22*Math.cos(vArrowAngle),y:vEnd[1]+0.22*Math.sin(vArrowAngle),text:'V',showarrow:false,font:{color:vColor,size:19}}
    );
  }
  annotations.push(
    equipmentLabel(mono,'Monochromator',outward*16,13,outward<0?'right':'left'),
    // Shift the sample name farther away from the U/V arrows and their tip
    // labels. Keep the placement symmetric for the two scattering senses.
    openSideLabel(sampleLabelAnchor,sampleDir,'Sample',4),
    ...(!isDiffractometer ? [openSideLabel(analyzer,anaDir,'Analyzer')] : []),
    openSideLabel(detector,detDir,'Detector',20),
    {x:kiArrow.head[0],y:kiArrow.head[1],ax:kiArrow.tail[0],ay:kiArrow.tail[1],xref:'x',yref:'y',axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:3,arrowsize:1.1,arrowwidth:2.8,arrowcolor:'#7ac943'},
    {x:kfArrow.head[0],y:kfArrow.head[1],ax:kfArrow.tail[0],ay:kfArrow.tail[1],xref:'x',yref:'y',axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:3,arrowsize:1.1,arrowwidth:2.8,arrowcolor:'#58c7e8'},
    vectorLabel(kiNearCenter,'<i>k</i><sub>i</sub>',thetaKi,kiLabelSide,'#398a12'),
    vectorLabel(kfNearCenter,'<i>k</i><sub>f</sub>',thetaKf,-1,'#1386a9'),
    {x:qEnd[0],y:qEnd[1],ax:sample[0],ay:sample[1],xref:'x',yref:'y',axref:'x',ayref:'y',text:'',showarrow:true,arrowhead:3,arrowsize:1.1,arrowwidth:2.8,arrowcolor:'#000'},
    qCenterLabel
  );

  // Reserve room in the data-space auto-fit for text whose actual offset is
  // specified in pixels above.  These are guard points, NOT physical geometry.
  // They prevent labels at the outside of the drawing from being clipped.
  const monoLabel=[mono[0]+outward*2.2,mono[1]+0.45];
  // Caption guard points (captions are about 1.9 data units wide).
  const captionGuards=(point,dir,extra=0)=>{
    const xs=dir[0]>0.35?[point[0]+1.9]:dir[0]<-0.35?[point[0]-1.9]:[point[0]-1.0,point[0]+1.0];
    return xs.map(x=>[x+dir[0]*extra,point[1]+dir[1]*(0.7+extra)]);
  };
  const sampleLabelPoints=captionGuards(sampleLabelAnchor,sampleDir);
  const detLabelPoints=captionGuards(detector,detDir,0.3);
  const anaLabelPoints=captionGuards(analyzer,anaDir);

  // Auto-fit the full TAS drawing to the geometry card.
  const fitPoints=[source,mono,sample,detector,kiArrow.tail,kiArrow.head,kfArrow.head,qEnd,monoLabel,...sampleLabelPoints,...detLabelPoints];
  if(!isDiffractometer) fitPoints.push(analyzer,...anaLabelPoints);
  if(!isPowder && uEnd && vEnd) fitPoints.push(uEnd,vEnd);
  // Reserve the same orientation-guide envelope for both sample modes. Powder
  // hides U/V, but retaining this fit radius keeps the TAS drawing scale and
  // monochromator anchor consistent with the Single-crystal view.
  // Fixed sample-region radius (not the present vector lengths), so the
  // figure does not rescale with hbar-omega or Q.
  const outerDarkRadius=darkRadius*(1+0.1*(outerDarkSlot-1));
  const radial=Math.max(outerDarkRadius*1.06,uvVectorLen,VECTOR_MAX_LEN,qVectorLen,kiVectorLen,kfVectorLen);
  // Instrument envelope over the hbar-omega range and all S2, with room for
  // the Analyzer / Detector captions around each possible position.
  for(const p of envelope) fitPoints.push(p,[p[0]-1.9,p[1]-0.7],[p[0]+1.9,p[1]+0.7]);
  fitPoints.push(
    [sample[0]-radial,sample[1]],[sample[0]+radial,sample[1]],
    [sample[0],sample[1]-radial],[sample[0],sample[1]+radial]
  );
  // Display layout only.  The first drawing of a context (instrument, energy,
  // scattering plane, plot size, ...) fits the drawing's bounding box into the
  // whole plot area and records where the monochromator sits in it.  While
  // only the target (H, K, L, hbar-omega) changes, the monochromator keeps
  // exactly that place on screen: the scale is kept, and it is reduced (about
  // the monochromator) only when the new drawing would otherwise be clipped.
  const fitPad=0.30*L;
  const need={left:0,right:0,down:0,up:0};
  for(const p of fitPoints){
    const dx=p[0]-mono[0], dy=p[1]-mono[1];
    need.left=Math.max(need.left,-dx); need.right=Math.max(need.right,dx);
    need.down=Math.max(need.down,-dy); need.up=Math.max(need.up,dy);
  }
  for(const key of Object.keys(need)) need[key]+=fitPad;
  const geometryPlotEl=$('geometryPlot');
  // x and y share one scale (scaleanchor): the x range is the y range times
  // the plot-area aspect ratio.
  const plotW=(geometryPlotEl?.clientWidth||0)-20, plotH=(geometryPlotEl?.clientHeight||0)-22;
  const aspect=plotW>50 && plotH>50 ? plotW/plotH : 1;
  const layoutContext=[isPowder,isDiffractometer,displaySense,cache.energyMode,cache.Ei,cache.Ef,
    num('Uh'),num('Uk'),num('Ul'),num('Vh'),num('Vk'),num('Vl'),
    num('a'),num('b'),num('c'),num('alpha'),num('beta'),num('gamma'),
    currentInstrument()?.name||'',(cache.hwList||[]).length,cache.hwList?.[0],cache.hwList?.[(cache.hwList?.length||1)-1],
    aspect.toFixed(2)].join('|');
  const kept=target ? geometryPlotEl?.__tasGeometryLayout : null;
  let fx, fy, ySpan;
  if(kept && kept.key===layoutContext){
    // Same monochromator fractions; grow the span only if something would be clipped.
    ({fx,fy}=kept);
    ySpan=Math.max(kept.ySpan,
      need.left/(fx*aspect),need.right/((1-fx)*aspect),need.down/fy,need.up/(1-fy));
  }else{
    // Anti-overzoom floor for very compact drawings.
    ySpan=Math.max((need.left+need.right)/aspect,need.down+need.up,2.4*L);
    const xSpan0=ySpan*aspect;
    fx=(need.left+(xSpan0-need.left-need.right)/2)/xSpan0;
    fy=(need.down+(ySpan-need.down-need.up)/2)/ySpan;
  }
  if(target && geometryPlotEl) geometryPlotEl.__tasGeometryLayout={key:layoutContext,fx,fy,ySpan};
  const xSpan=ySpan*aspect;
  const xMin=mono[0]-fx*xSpan, xMax=xMin+xSpan;
  const yMin=mono[1]-fy*ySpan, yMax=yMin+ySpan;

  const angleBox=$("geometryAngles");
  if(scanMode){
    fn.renderGeometryScanTable(cache,scanPoints,sense,displaySense,scanIndex);
  }
  if(angleBox){
    if(target){
      angleBox.classList.remove("error-text");
      angleBox.innerHTML=fn.geometryResultSummaryHtml(cache,target,isPowder,sense,displaySense);
    }else{
      angleBox.classList.add("error-text");
      angleBox.textContent=`Angle calculation unavailable: ${targetError}`;
    }
  }

  const geometryPlot=$('geometryPlot');
  const geometryPlotVisible=geometryPlot && !geometryPlot.closest('.hidden');
  // An inaccessible Single-crystal target keeps the last valid drawing (dimmed)
  // instead of switching to a schematic with a different scale and anchor.
  const keepPrevious=!target && !isPowder && geometryPlot?.__tasGeometryValid;
  geometryPlot?.classList.toggle('geometry-plot-stale',!!keepPrevious);
  if(geometryPlotVisible && !keepPrevious){
    if(geometryPlot) geometryPlot.__tasGeometryValid=!!target;
    Plotly.react("geometryPlot",traces,{
      xaxis:{range:[xMin,xMax],showgrid:false,zeroline:false,showticklabels:false,fixedrange:true,constrain:"domain"},
      yaxis:{range:[yMin,yMax],showgrid:false,zeroline:false,showticklabels:false,scaleanchor:"x",scaleratio:1,fixedrange:true,constrain:"domain"},
      annotations,margin:{l:10,r:10,t:12,b:10},showlegend:false
    },{responsive:true,displayModeBar:false});
  }
}
}
