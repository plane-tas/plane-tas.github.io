// Bragg peak shading shared by the Constant E map and the Q vector–E map:
// I = |F|² L with the single-crystal (ω scan) Lorentz factor L = 1/sin 2θ at
// the elastic wave vector of the fixed energy (or L = 1), each relative to
// its maximum over every peak of the map (out to 1.1 times the largest
// reachable Q, as in the Powder map).  |F_N|² is in fm² (/100 → barn),
// |F_M|² in barn per crystallographic cell.  A peak beyond 2k cannot be
// reached elastically: I = 0.
export function braggPeakScale(cache,lorentzOn){
  const magneticIntensity=!!cache.magneticIntensity && !!cache.cifStructure;
  const braggK=Number(cache.braggK);
  const lorentz=p=>{
    if(!lorentzOn) return 1;
    const s=Number(p.q)/(2*braggK);
    if(!(braggK>0) || !Number.isFinite(s) || s>1) return null;
    return 1/Math.max(1e-3,Math.sin(2*Math.asin(s)));
  };
  const nuclearI=p=>{ const L=lorentz(p); return (L && Number.isFinite(p.sf2)) ? p.sf2/100*L : 0; };
  const magneticI=p=>{ const L=lorentz(p); return (L && Number.isFinite(p.fm2)) ? p.fm2*L : 0; };
  const nuclearMax=Math.max(0,...(cache.Gpoints||[]).map(nuclearI));
  const magneticMax=magneticIntensity ? Math.max(0,...(cache.magPoints||[]).map(magneticI)) : 0;
  return {
    magneticIntensity, lorentz, nuclearI, magneticI, nuclearMax, magneticMax,
    nuclearRelative:p=>nuclearMax>0 ? nuclearI(p)/nuclearMax : 0,
    magneticRelative:p=>magneticMax>0 ? magneticI(p)/magneticMax : 0,
    lorentzText:p=>{ if(!lorentzOn) return null; const L=lorentz(p); return L ? `L = 1/sin 2θ = ${L.toPrecision(4)}` : 'not reachable elastically'; },
    iSymbol:lorentzOn ? '²L' : '²'
  };
}
// "M = x N": the strongest magnetic peak relative to the strongest nuclear
// peak (same units and Lorentz factor), shown next to the F_M entries.  Small
// ratios as 2.1×10⁻³.
export function magneticRatioText(magneticMax,nuclearMax,shown){
  const ratio=(shown && nuclearMax>0) ? magneticMax/nuclearMax : NaN;
  if(!Number.isFinite(ratio)) return '';
  const sup=d=>[...d].map(c=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[c]).join('');
  const text=ratio>=0.01 ? String(Number(ratio.toPrecision(2)))
    : ratio.toExponential(1).replace(/e([+-])(\d+)/,(m,sg,d)=>`×10${sg==='-'?'⁻':''}${sup(d)}`);
  return `M = ${text} N`;
}
