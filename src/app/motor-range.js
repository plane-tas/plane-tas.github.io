// Range of an angle motor (M2, A2) on one scattering side.
//
// An instrument file gives the motor range as readings "<key>_min" <
// "<key>_max" for its own Sense and motor sign ("m_sign", "a_sign"); null
// (or a missing key) is an open end.  The page uses the part of the range on
// the side where the crystal scatters for its Sense (physical side: + =
// counter-clockwise), read with the page's motor sign.
//
//   lo, hi    file readings (number, or null for an open end)
//   fileEnc   +1 / -1: the file's motor counts CCW / CW
//   side      +1 / -1: physical side used by the page
//   pageEnc   +1 / -1: the page's motor counts CCW / CW
//
// Returns null when the range does not reach that side, otherwise
// {near, far}: page readings of the small- and large-angle ends: near is 0
// when the range crosses the beam, far is null for an open end (no limit).
function finite(v){ return v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v)); }
function physInterval(lo,hi,fileEnc){
  const a=finite(lo) ? Number(lo)*fileEnc : -fileEnc*Infinity;
  const b=finite(hi) ? Number(hi)*fileEnc : fileEnc*Infinity;
  return [Math.min(a,b),Math.max(a,b)];
}
export function sideRange(lo,hi,fileEnc,side,pageEnc){
  const [L,H]=physInterval(lo,hi,fileEnc);
  const read=v=>v===null ? null : v*pageEnc+0;
  if(side>0){
    if(!(H>0)) return null;
    return {near:read(L>0 ? L : 0),far:read(Number.isFinite(H) ? H : null)};
  }
  if(!(L<0)) return null;
  return {near:read(H<0 ? H : 0),far:read(Number.isFinite(L) ? L : null)};
}
// The two fields (min, max) of a side range, in numerical order.
export function sideRangeFields(range,side,pageEnc){
  if(!range) return [null,null];
  return side*pageEnc>0 ? [range.near,range.far] : [range.far,range.near];
}
// The file range with the page's side replaced by the edited ends (page
// readings, null = no limit), as readings for the page's motor sign:
// [min, max] with null for an open end.
export function mergeSideRange(lo,hi,fileEnc,side,pageEnc,near,far){
  let [L,H]=physInterval(lo,hi,fileEnc);
  const phys=v=>finite(v) ? Math.abs(Number(v))*side : null;
  const n=phys(near), f=phys(far);
  if(side>0){
    H=f===null ? Infinity : f;
    if(!(L<0)) L=n===null ? 0 : n;
  }else{
    L=f===null ? -Infinity : f;
    if(!(H>0)) H=n===null ? 0 : n;
  }
  const out=[L,H].map(v=>Number.isFinite(v) ? v*pageEnc+0 : null);
  // Readings in numerical order (an open end stays on its side).
  const key=(v,i)=>v===null ? (([L,H][i]>0) === (pageEnc>0) ? Infinity : -Infinity) : v;
  return [0,1].sort((i,j)=>key(out[i],i)-key(out[j],j)).map(i=>out[i]);
}
