// "Save figure" at the top left of every figure that has no button of its
// own: the plot as on screen (current zoom, colorbars, its own legend) as a
// PNG.  The Q–E maps and the 1D cut keep their existing buttons (same place);
// the four Resolution ellipses are saved together by the Save figure of
// their results table.  The TAS geometry also gets the Angle calculation
// result above the drawing, and the Toolbox plots their conditions.
import {saveQEFigure} from '../qe/qe-save-figure.js';

const FIGURES=[
  ['convMapEU','convolution-2d-E-U'],
  ['convMapEV','convolution-2d-E-V'],
  ['convMapUV','convolution-2d-U-V'],
  ['geometryPlot','tas-geometry'],
  ['reflectionPowderPlot','reflection-powder-pattern'],
  ['magffPlot','magnetic-form-factor'],
  ['absorptionPlot','absorption-transmission']
];

// The TAS geometry is saved with the Angle calculation result above it
// ((h,k,l), Ei / Ef / Q, the motor angles and any warning), in its colours.
const fieldValue=id=>String(document.getElementById(id)?.value??'').trim();
const shownLabel=id=>{ const el=document.getElementById(id); return el ? (el.selectedOptions?.[0]?.textContent||el.value||'').trim() : ''; };
const line=text=>({text,color:'#222'});
// Neutron attenuation: the sample (CIF/mCIF or formula and density), the
// beam and the transmissions entered on the left.
function attenuationHeaderLines(){
  const manual=fieldValue('absorptionInputMode')==='manual';
  const sample=manual
    ? `Formula: ${fieldValue('absorptionFormula')||'–'}, density = ${fieldValue('absorptionDensity')||'–'} g/cm³`
    : `Sample: ${fieldValue('absorptionCifStatus')||'–'}`;
  return [line(sample),
    line(`E = ${fieldValue('absorptionEnergy')} meV, λ = ${fieldValue('absorptionLambda')} Å, k = ${fieldValue('absorptionK')} Å⁻¹`),
    line(`SE transmission = ${fieldValue('absorptionSETransmission')} %, sample thickness = ${fieldValue('absorptionThickness')} mm, overall transmission = ${fieldValue('absorptionTransmission')} %`)];
}
// Magnetic form factor: the ion and the j2 weight, and the selected Q.
function formFactorHeaderLines(){
  const config=document.getElementById('magffConfigLabel')?.classList.contains('hidden') ? '' : ` (${shownLabel('magffConfig')})`;
  return [line(`Magnetic ion: ${fieldValue('magffIonSearch')}${config}, j2 contribution: ${shownLabel('magffWeightMode')}, c = ${fieldValue('magffWeight')}`),
    line(`Q = ${fieldValue('magffQPoint')} Å⁻¹, f(Q) = ${fieldValue('magffValue')}, |f(Q)|² = ${fieldValue('magffIntensity')}`)];
}
function headerLinesFor(id){
  if(id==='absorptionPlot') return attenuationHeaderLines();
  if(id==='magffPlot') return formFactorHeaderLines();
  if(id!=='geometryPlot') return [];
  const box=document.getElementById('geometryAngles');
  if(!box || box.closest('.hidden')) return [];
  const lines=[...box.querySelectorAll('.geometry-result-line')];
  const source=lines.length ? lines : [box];
  return source.map(el=>({text:el.textContent.replace(/\s+/g,' ').trim(),color:getComputedStyle(el).color}));
}
function attachSaveButton(id,filename,onError){
  const plot=document.getElementById(id);
  if(!plot || plot.querySelector(':scope > .plot-save-figure')) return;
  plot.classList.add('plot-save-host');
  const button=document.createElement('button');
  button.type='button';
  button.className='plot-save-figure';
  button.textContent='Save figure';
  button.title='Save this figure as a PNG';
  button.addEventListener('click',()=>{
    if(!plot._fullLayout || !Array.isArray(plot.data)) return;
    saveQEFigure({plotId:id,legendId:null,filename:`${filename}.png`,headerLines:headerLinesFor(id)})
      .catch(err=>onError(`Save figure: ${err?.message||err}`));
  });
  // After Plotly's own container, so Plotly never replaces it.
  plot.appendChild(button);
  // Usable only while a figure is drawn (not before a calculation, nor
  // after it failed and the plot was cleared).
  const sync=()=>{ button.disabled=!(plot._fullLayout && Array.isArray(plot.data) && plot.data.length); };
  sync();
  new MutationObserver(()=>{ sync(); requestAnimationFrame(sync); }).observe(plot,{childList:true,subtree:false});
}

export function initializePlotSaveButtons(onError=()=>{}){
  for(const [id,filename] of FIGURES) attachSaveButton(id,filename,onError);
  // A figure whose content was replaced (e.g. a "nothing to plot" message)
  // gets its button back when it is drawn again (tas-plot-density.js).
  const names=new Map(FIGURES);
  window.__tasEnsurePlotSaveButton=el=>{ if(el?.id && names.has(el.id)) attachSaveButton(el.id,names.get(el.id),onError); };
}
