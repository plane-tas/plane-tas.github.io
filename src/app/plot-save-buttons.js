// "Save figure" of the figures that have no handler of their own: the plot
// as on screen (current zoom, colorbars, its own legend) as a PNG.  Each
// button sits in a save row above its figure, after a file-name entry: the
// Save CSV name where the figure has a CSV ("name .csv/.png"), else its own
// (".png").  The TAS geometry also gets the Angle calculation result above
// the drawing, and the Toolbox plots their conditions.
import {saveQEFigure} from '../qe/qe-save-figure.js';
import {enableWithPlot} from '../core/plot-bound-button.js';
import {pngNameFromEntry, syncCsvNameTemplate, sampleFileBase} from '../core/csv-name.js';

// plot, its button, its name entry, the automatic name, and whether this
// code keeps the automatic name in the entry (false: the Save CSV code does).
const FIGURES=[
  {plot:'geometryPlot',button:'geometrySaveFigure',name:'geometryFigureName',auto:()=>'tas_geometry',sync:true},
  {plot:'reflectionPowderPlot',button:'cifPatternSaveFigure',name:'cifPatternCsvName',auto:()=>`${sampleFileBase('structure')}_powder_pattern`},
  {plot:'magffPlot',button:'magffSaveFigure',name:'magffCsvName',auto:()=>'magnetic_form_factor'},
  {plot:'absorptionPlot',button:'absorptionSaveFigure',name:'absorptionCsvName',auto:()=>'neutron_attenuation'}
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
// Keep an automatic name in a figure-only entry: set again whenever the
// figure is drawn (the automatic name may have changed with it).
export function watchFigureName(nameId,auto,plotIds){
  const input=document.getElementById(nameId);
  if(!input) return;
  let queued=false;
  const sync=()=>{ queued=false; syncCsvNameTemplate(input,auto()); };
  const queue=()=>{ if(!queued){ queued=true; requestAnimationFrame(sync); } };
  sync();
  for(const id of plotIds){
    const plot=document.getElementById(id);
    if(plot) new MutationObserver(queue).observe(plot,{childList:true,subtree:true});
  }
}
export function figureFileName(nameId,auto){ return pngNameFromEntry(document.getElementById(nameId),auto()); }

function bindFigure({plot:id,button:buttonId,name,auto,sync},onError){
  const plot=document.getElementById(id), button=document.getElementById(buttonId);
  if(!plot || !button || button.dataset.figureBound) return;
  button.dataset.figureBound='1';
  if(sync) watchFigureName(name,auto,[id]);
  button.addEventListener('click',()=>{
    if(!plot._fullLayout || !Array.isArray(plot.data)) return;
    saveQEFigure({plotId:id,legendId:null,filename:figureFileName(name,auto),headerLines:headerLinesFor(id)})
      .catch(err=>onError(`Save figure: ${err?.message||err}`));
  });
  enableWithPlot(button,plot);
}

export function initializePlotSaveButtons(onError=()=>{}){
  for(const figure of FIGURES) bindFigure(figure,onError);
}
