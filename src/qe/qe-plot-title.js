import {PLOT_FONTS} from '../core/plot-fonts.js';
// Plot titles of the Q–E maps: instrument, fixed energy and, for the
// Constant E map, the ħω of the slice (and W for 4-circle), e.g.
//   "CTAX, Ef = 4.8 meV, ħω = 0.0 meV".
// The instrument is its name without the facility ("CTAX@HFIR" -> "CTAX").
const num=v=>String(Number(Number(v).toFixed(3)));
// ħω of a map slice: one decimal, two for the 0.25 meV steps.
const hwText=v=>{ const x=Math.round(Number(v)*100)/100; return Math.abs(x*10-Math.round(x*10))<1e-9 ? x.toFixed(1) : x.toFixed(2); };
export function qeMapTitle({inst,energyMode,Ei,Ef,hw=null,W=null}){
  const parts=[];
  const name=String(inst?.name||'').split('@')[0].trim();
  if(name) parts.push(name);
  const ef=energyMode==='Ef fixed';
  const E=ef ? Ef : Ei;
  if(Number.isFinite(Number(E)) && E!==null) parts.push(`${ef?'Ef':'Ei'} = ${num(E)} meV`);
  if(hw!==null && Number.isFinite(Number(hw))) parts.push(`ħω = ${hwText(hw)} meV`);
  if(W!==null && Number.isFinite(Number(W))) parts.push(`W = ${num(W)}`);
  return parts.join(', ');
}
// Title layout shared by the three maps (font as the axis tick labels).
export function qeTitleLayout(text){
  return {text,font:{size:PLOT_FONTS.title},x:0.5,xanchor:'center',y:1,yref:'paper',yanchor:'bottom',pad:{b:10}};
}

// Constant E map: its axes keep a 1:1 aspect (constrain: 'domain'), so the
// plot area is narrower or lower than the frame and a paper title would
// float away from it.  This title is an annotation on the top edge of the
// axes themselves, so it always sits just above the map.
export function qeDomainTitleAnnotation(text){
  return {text,font:{size:PLOT_FONTS.title},xref:'x domain',yref:'y domain',x:0.5,y:1,
    xanchor:'center',yanchor:'bottom',yshift:6,showarrow:false,meta:'qe-map-title'};
}
