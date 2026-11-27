// Resolution › Convolution: a dispersion table (h, k, l, E1 … En, I1 … In)
// convolved with the TAS resolution of the current instrument (Instrument
// details) and sample.  2D: a (U, V, ħω) volume in the scattering plane,
// shown as E–U and E–V maps and a constant-ħω U–V map selected by sliders.
// 1D: a scan with each of H, K, L, E given as a value or ini fin bin.
// Every point is multiplied by the intensity prefactor R0 selected in the
// file card (R0/Rmon, normalisation to monitor counts).
// The parts are in convolution-settings / -table / -calc / -maps / -scan /
// -csv.js; they share the object state and find each other's functions in fns.
import {applyWhileTyping} from '../core/live-entry.js';
import {fmt} from './convolution-legend.js';
import {enableWithPlot} from '../core/plot-bound-button.js';
import {installConvolutionSettings} from './convolution-settings.js';
import {installConvolutionTable} from './convolution-table.js';
import {installConvolutionCalc} from './convolution-calc.js';
import {installConvolutionMaps} from './convolution-maps.js';
import {installConvolutionScan} from './convolution-scan.js';
import {installConvolutionCsv} from './convolution-csv.js';

export function createConvolutionUI(deps){
  // State shared by the parts (read and written as state.name).
  const state={
    text:'',
    fileName:'',
    data:null,
    interp:null,
    volume:null,
    scan:null,
    run2D:0,
    run1D:0,
    fileTag:'',
    restoring:false,
    restoringResults:false,
    namedFor:null,
    exampleShown:false,
    fileInfo:'No file loaded.',
    busy2D:false,
    workers:null,
    workersBroken:false,
    tableKey:0,
    cancelJobs:()=>{},
    bench:null,
    estimateTimer:0,
    busy1D:false,
    stopReq1D:false,
    highlighted:null
  };
  // Functions and objects of every part, by name (fns.name).
  const fns={};
  const context={deps,state,fns};
  installConvolutionSettings(context);
  installConvolutionTable(context);
  installConvolutionCalc(context);
  installConvolutionMaps(context);
  installConvolutionScan(context);
  installConvolutionCsv(context);
  const {$}=deps;

  // Colour-scale limits of the three maps (null = automatic).
  // Colour scale of the three 2D maps (one range; null = automatic).
  const zlim={min:null,max:null};
  const kept=[];

  const num=id=>{ const v=Number($(id)?.value); return Number.isFinite(v) ? v : NaN; };
  const vec=v=>`(${v.map(x=>fmt(x)).join(', ')})`;
  const message=(id,t,error=false)=>{ const el=$(id); if(!el) return; el.textContent=t; el.title=t; el.classList.toggle('conv-error',!!error); el.classList.remove('convolution-progress-on'); el.style.setProperty('--conv-progress','0%'); };
  const yieldUI=()=>new Promise(r=>setTimeout(r,0));
  const plotly=()=>typeof Plotly!=='undefined';

  // ------------------------------------------------------------ layout ---
  // Desktop: the convolution pane fills the window height (like the CIF
  // generator); plots and the table take the remaining space.
  function fitHeight(){
    const box=$('convLayout'), pane=$('resolutionConvolutionPane');
    if(!box || !pane || pane.hidden) return;
    if(window.innerWidth<=1100){ box.style.height=''; return; }
    // Position in the scrolled content (the main column scrolls, not the window).
    const top=box.getBoundingClientRect().top+((box.closest('.main-scroll')||box.closest('main'))?.scrollTop||0)+window.scrollY;
    // Never shorter than what the controls plus a usable plot need: on a
    // short window the page scrolls instead of cutting the plots off.
    const d=window.tasUIDensity?.() || 1;
    // The card holds the file row, the note and the tabs: count its parts
    // above the tabs (and its padding).
    const cardEl=box.querySelector('.convolution-file-card');
    const card=cardEl ? [...cardEl.children].filter(el=>!el.classList.contains('convolution-tab-wrap')).reduce((sum,el)=>sum+el.offsetHeight,0)+30 : 0;
    const tabs=box.querySelector('.convolution-tabs')?.offsetHeight||0;
    const active=[...box.querySelectorAll('.convolution-tab-pane')].find(el=>!el.hidden);
    const fixed=active ? [...active.children].filter(el=>!el.matches('.convolution-plots,.convolution-scan-layout,.convolution-table-scroll')).reduce((sum,el)=>sum+el.offsetHeight,0) : 0;
    const need=card+tabs+fixed+Math.round(340*d)+40;
    box.style.height=`${Math.max(560,need,Math.floor(window.innerHeight-top-14))}px`;
  }
  function showConvTab(name){
    const tabs={data:['convTabData','convPaneData'],'2d':['convTab2D','convPane2D'],'1d':['convTab1D','convPane1D']};
    if(!tabs[name]) name='2d';
    // The example is shown only until File preview is left.
    if(name!=='data' && state.exampleShown){ state.exampleShown=false; fns.showPreview(); }
    for(const [key,[tab,pane]] of Object.entries(tabs)){
      const on=key===name;
      $(tab)?.classList.toggle('active',on); $(tab)?.setAttribute('aria-selected',String(on));
      if($(pane)) $(pane).hidden=!on;
    }
    try{ localStorage.setItem('plane-tas-convolution-tab',name); }catch(_e){}
    requestAnimationFrame(()=>{ fitHeight(); resizePlots(); fns.renderTableRows(); });
  }
  // ------------------------------------------------------------ binding --
  function resizePlots(){
    if(!plotly()) return;
    for(const id of ['convMapEU','convMapEV','convMapUV','convScanPlot','plotUE','plotVE','plotUV','plotWE']){
      const el=$(id); if(el?.data && el.offsetParent) try{ Plotly.Plots.resize(el); }catch(_e){}
    }
  }
  function showPane(name){
    const conv=name==='convolution';
    $('resolutionSimulationPane').hidden=conv;
    $('resolutionConvolutionPane').hidden=!conv;
    for(const [id,on] of [['resolutionTabSimulation',!conv],['resolutionTabConvolution',conv]]){
      $(id)?.classList.toggle('active',on); $(id)?.setAttribute('aria-selected',String(on));
    }
    if(conv && $('method')) for(const id of ['convMethod2D','convMethod1D']) if($(id)) $(id).value=$('method').value;
    try{ localStorage.setItem('plane-tas-resolution-pane',name); }catch(_e){}
    requestAnimationFrame(()=>{ fitHeight(); resizePlots(); fns.renderTableRows(); });
  }
  function bindConvolutionUI(){
    $('resolutionTabSimulation')?.addEventListener('click',()=>showPane('simulation'));
    $('resolutionTabConvolution')?.addEventListener('click',()=>showPane('convolution'));
    let saved='simulation'; try{ saved=localStorage.getItem('plane-tas-resolution-pane')||'simulation'; }catch(_e){}
    showPane(saved==='convolution' ? 'convolution' : 'simulation');
    for(const b of document.querySelectorAll('[data-conv-tab]')) b.addEventListener('click',()=>showConvTab(b.dataset.convTab));
    let tab='2d'; try{ tab=localStorage.getItem('plane-tas-convolution-tab')||'2d'; }catch(_e){}
    showConvTab(tab);
    const file=$('convFile');
    $('convSelectFile')?.addEventListener('click',()=>file?.click());
    file?.addEventListener('change',()=>{ const f=file.files?.[0]; file.value=''; fns.loadFile(f); });
    $('convShowExample')?.addEventListener('click',fns.showExample);
    fns.restoreFile();
    // W: 0 (a TAS measures in the scattering plane; the resolution out of
    // it is integrated); its boxes cannot be edited.
    for(const id of ['convWmin','convWmax','convWbin']){ const el=$(id); if(el){ el.value='0'; el.disabled=true; } }
    // Column heads of the 2D ranges follow the lattice and the scattering plane.
    const HEAD_IDS=new Set(['Uh','Uk','Ul','Vh','Vk','Vl','a','b','c','alpha','beta','gamma','instrument','instrumentType']);
    const heads=()=>setTimeout(fns.updateRangeHeads,0);
    for(const ev of ['input','change']) document.addEventListener(ev,e=>{ if(HEAD_IDS.has(e.target?.id) || e.target?.id==='cifFileInput') heads(); });
    $('resolutionTabConvolution')?.addEventListener('click',heads);
    $('cifClearButton')?.addEventListener('click',heads);
    fns.updateRangeHeads();
    $('convResetRanges')?.addEventListener('click',()=>{ if(state.interp){ fns.fillRanges(); fns.saveInputs(); } });
    // Approximation: the same setting as Simulation.
    // Approximation: one setting (Simulation's), shown in the 2D slice and
    // 1D cut rows.
    for(const id of ['convMethod2D','convMethod1D']) $(id)?.addEventListener('change',()=>{ const m=$('method'); if(m){ m.value=$(id).value; m.dispatchEvent(new Event('change',{bubbles:true})); } });
    $('method')?.addEventListener('change',()=>{ for(const id of ['convMethod2D','convMethod1D']) if($(id)) $(id).value=$('method').value; });
    $('convCalculate2D')?.addEventListener('click',fns.calculate2D);
    $('convLoad2D')?.addEventListener('click',()=>$('convLoad2DFile')?.click());
    $('convLoad2DClear')?.addEventListener('click',()=>fns.clearLoaded('2D'));
    $('convLoad1DClear')?.addEventListener('click',()=>fns.clearLoaded('1D'));
    $('convLoad1D')?.addEventListener('click',()=>$('convLoad1DFile')?.click());
    fns.pickFile('convLoad2DFile',async file=>{
      if(state.busy2D) fns.stop2D();
      try{
        const g=fns.load2DText(await file.text());
        state.volume.source=file.name; fns.setLoaded('2D',file.name);
        // One short line in the progress bar; any notes (another
        // dispersion file, an instrument not in the list) on hovering it.
        message('convMessage2D',`Loaded${g.restored ? ' with its settings' : ` ${file.name}`}.`,g.notes.length>0);
        if($('convMessage2D')) $('convMessage2D').title=g.notes.join(' ');
      }
      catch(err){ message('convMessage2D',`${file.name}: ${err.message||err}`,true); }
    });
    fns.pickFile('convLoad1DFile',async file=>{
      try{
        const r=fns.load1DText(await file.text(),file.name);
        fns.setLoaded('1D',file.name);
        message('convStatus1D',`Loaded ${r.n} curve${r.n>1?'s':''}${r.restored ? ' with settings' : ''}`);
        message('convMessage1D',r.notes.join(' '),r.notes.length>0);
      }
      catch(err){ message('convMessage1D',`${file.name}: ${err.message||err}`,true); }
    });
    // Estimated calculation time follows every input that changes it.
    for(const id of ['convSamples2D','convSamples1D','convGrid2D','convGrid1D','convIntegration2D','convIntegration1D','convPoints1D','convH0','convK0','convL0','convE0','convH1','convK1','convL1','convE1',
      ...fns.RANGE_IDS,'convMethod2D','convMethod1D'])
      $(id)?.addEventListener('input',fns.scheduleEstimates), $(id)?.addEventListener('change',fns.scheduleEstimates);
    for(const id of fns.INPUT_IDS){ $(id)?.addEventListener('input',fns.saveInputs); $(id)?.addEventListener('change',fns.saveInputs); }
    for(const dim of ['2D','1D']) $(`convIntegration${dim}`)?.addEventListener('change',fns.showIntegration);
    $('convResetRanges')?.addEventListener('click',fns.scheduleEstimates);
    $('convCalculate1D')?.addEventListener('click',fns.calculate1D);
    $('convDownload')?.addEventListener('click',fns.downloadScan);
    $('convNormalize1D')?.addEventListener('change',()=>{ fns.saveInputs(); fns.drawScan(); });
    $('convLog1D')?.addEventListener('change',()=>{ fns.saveInputs(); fns.drawScan(); });
    $('convSaveFigure1D')?.addEventListener('click',()=>fns.saveScanFigure().catch(err=>message('convMessage1D',`Save figure: ${err.message||err}`,true)));
    $('convClearKept1D')?.addEventListener('click',()=>{ kept.length=0; fns.refreshKept(); });
    // The UI density changed (window width breakpoint): draw the figures
    // again so their fonts and margins follow it.
    window.addEventListener('tas-density-change',()=>{ try{ if(state.volume) fns.drawMaps(); fns.drawScan(); }catch(_e){} });
    // Pressing a button in the curve table must not move focus: focusing it
    // scrolls the table sideways under the pointer and the click is lost.
    $('convCurveList')?.closest('table')?.addEventListener('mousedown',event=>{ if(event.target.closest?.('button')) event.preventDefault(); });
    // Draw the empty panel without overwriting the stored results before
    // restoreFile() has read them back.
    state.restoringResults=true; try{ fns.refreshKept(); }finally{ state.restoringResults=false; }
    $('convDownload2D')?.addEventListener('click',fns.downloadVolume);
    $('convSaveFigure2D')?.addEventListener('click',()=>fns.saveMapsFigure().catch(err=>message('convMessage2D',`Save figure: ${err.message||err}`,true)));
    $('convSetQE2D')?.addEventListener('click',fns.setOnQE);
    // Both act on the maps shown: usable only while they are drawn.
    for(const id of ['convSaveFigure2D','convSetQE2D']) enableWithPlot($(id),$('convMapUV'));
    $('convShowDispersion')?.addEventListener('change',()=>{ fns.saveInputs(); fns.drawMaps(); });
    $('convLog2D')?.addEventListener('change',()=>{ fns.saveInputs(); fns.drawMaps(); });
    for(const id of ['convEllCoh','convEllInc','convLineU','convLineV','convLineE']) $(id)?.addEventListener('change',()=>{ fns.saveInputs(); fns.drawMaps(); });
    for(const end of ['min','max']){
      const el=$(`convZ${end}`);
      const apply=()=>{
        const v=Number.parseFloat(el.value);
        zlim[end]=el.value.trim()==='' || !Number.isFinite(v) ? null : v;
        fns.saveInputs(); fns.drawMaps();
      };
      el?.addEventListener('change',apply);
      el?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); apply(); el.blur(); } });
      applyWhileTyping(el,apply,{allowEmpty:true});
    }
    for(const [key,input,arr] of [['U','convValueU','A'],['V','convValueV','B'],['E','convValueE','E']]){
      $(`convSlider${key}`)?.addEventListener('input',()=>{ if(!state.volume) return; $(input).value=fmt(state.volume[arr][fns.sliderIndex(key)],3); fns.drawMaps(); fns.storeSliders(); });
      $(input)?.addEventListener('change',()=>{
        if(!state.volume) return;
        const i=fns.nearest(state.volume[arr],num(input));
        $(`convSlider${key}`).value=String(i); $(input).value=fmt(state.volume[arr][i],3); fns.drawMaps(); fns.storeSliders();
      });
      // While typing: move the slider to the nearest grid value (the box is
      // tidied when it is left).
      applyWhileTyping($(input),text=>{
        if(!state.volume) return;
        $(`convSlider${key}`).value=String(fns.nearest(state.volume[arr],Number(text))); fns.drawMaps(); fns.storeSliders();
      });
    }
    $('convTableScroll')?.addEventListener('scroll',()=>fns.renderTableRows(),{passive:true});
    window.addEventListener('resize',()=>{ fitHeight(); resizePlots(); });
    document.addEventListener('click',e=>{ if(e.target?.closest?.('.tab-button,#tabResolution')) requestAnimationFrame(fitHeight); });
  }
  Object.assign(fns,{zlim, kept, num, vec, message, yieldUI, plotly, fitHeight, showConvTab, resizePlots, showPane, bindConvolutionUI});
  // For Sample › Dispersion (the Q-E maps): read a 2D Save CSV, and put its
  // settings in (as Load CSV does).
  return {bindConvolutionUI, parse2DText:fns.parse2DText, applyFileSettings:set=>fns.applySettings(set,'2D')};
}
