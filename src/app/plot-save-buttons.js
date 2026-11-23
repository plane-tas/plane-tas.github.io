// "Save figure" at the top left of every figure that has no button of its
// own: the plot as on screen (current zoom, colorbars, its own legend) as a
// PNG.  The Q–E maps and the 1D cut keep their existing buttons (same place);
// the four Resolution ellipses are saved together by the Save figure of
// their results table.  The TAS geometry also gets the Angle calculation
// result above the drawing.
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
function headerLinesFor(id){
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
}

export function initializePlotSaveButtons(onError=()=>{}){
  for(const [id,filename] of FIGURES) attachSaveButton(id,filename,onError);
  // A figure whose content was replaced (e.g. a "nothing to plot" message)
  // gets its button back when it is drawn again (tas-plot-density.js).
  const names=new Map(FIGURES);
  window.__tasEnsurePlotSaveButton=el=>{ if(el?.id && names.has(el.id)) attachSaveButton(el.id,names.get(el.id),onError); };
}
