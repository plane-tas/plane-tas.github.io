// "Save figure" at the top left of every figure that has no button of its
// own: the plot as on screen (current zoom, colorbars, its own legend) as a
// PNG.  The Q–E maps and the 1D cut keep their existing buttons (same place);
// the four Resolution ellipses are saved together by the Save figure of
// their results table.
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

export function initializePlotSaveButtons(onError=()=>{}){
  for(const [id,filename] of FIGURES){
    const plot=document.getElementById(id);
    if(!plot || plot.querySelector(':scope > .plot-save-figure')) continue;
    plot.classList.add('plot-save-host');
    const button=document.createElement('button');
    button.type='button';
    button.className='plot-save-figure';
    button.textContent='Save figure';
    button.title='Save this figure as a PNG';
    button.addEventListener('click',()=>{
      if(!plot._fullLayout || !Array.isArray(plot.data)) return;
      saveQEFigure({plotId:id,legendId:null,filename:`${filename}.png`})
        .catch(err=>onError(`Save figure: ${err?.message||err}`));
    });
    // After Plotly's own container, so Plotly never replaces it.
    plot.appendChild(button);
  }
}
