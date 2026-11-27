// Resolution › Convolution: the dispersion table -- reading it, the default
// ranges, the example file (MnF2) and File preview.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {NOTE, ROW_HEIGHT} from './convolution-constants.js';
import {createDispersionInterpolator, parseDispersionTable} from './convolution-core.js';
import {fmt} from './convolution-legend.js';
import {downloadText} from '../core/download.js';

export function installConvolutionTable(context){
  const {$, collectResolutionBase}=context.deps;
  const {state,fns}=context;
  // Default number of points of the 1D scan: an energy step of about 1/8 of
  // the energy resolution (FWHM of the projection, the finest over a few
  // energies of the scan), 51 to 2001 points.  Without a resolution (the
  // instrument cannot reach the scan) the step of the 2D map is used.
  function defaultScanPoints(hkl,e0,e1,eb){
    const fallback=eb>0 ? Math.max(51,Math.min(2001,Math.round((e1-e0)/eb)+1)) : 51;
    if(!(e1>e0)) return fallback;
    let base; try{ base=collectResolutionBase(); }catch(_e){ return fallback; }
    let fw=Infinity;
    for(let i=0;i<=6;i++){
      const r=fns.resolutionAt(base,hkl,e0+(e1-e0)*i/6,{});
      const w=r?.widths?.E;
      if(Number.isFinite(w) && w>0) fw=Math.min(fw,w);
    }
    if(!Number.isFinite(fw)) return fallback;
    return Math.max(51,Math.min(2001,Math.round((e1-e0)/(fw/8))+1));
  }
  // ------------------------------------------------------------ loading --
  function loadText(){
    if(!state.text) return;
    try{
      state.data=parseDispersionTable(state.text,fns.formatValue());
      state.interp=createDispersionInterpolator(state.data);
      state.tableKey++;
      // A 2D result or 1D scan already shown (calculated or loaded from a CSV)
      // stays, with its sliders: it carries its own settings.  Only the
      // dispersion overlay follows the new table.
      fns.updateKeepButtons();
      // After a reload the saved entries win over the table defaults.
      if(!(state.restoring && fns.savedInputsComplete(fns.RANGE_IDS))) fillRanges();
      $('convResetRanges').disabled=false;
      const kind=state.interp.grid ? 'regular grid, trilinear interpolation' : 'scattered points, nearest point';
      $('convSummary').textContent=NOTE;
      $('convSummary').classList.remove('conv-error');
      state.fileInfo=`${state.fileName}: ${state.data.points.length} Q points, ${state.data.nBranch} branch${state.data.nBranch>1?'es':''} (${kind}); ${state.data.rows.length} rows × ${state.data.rows[0].length} columns.`;
      state.exampleShown=false; showPreview();
      if(state.fileTag!==state.fileName){
        state.fileTag=state.fileName;
        const keep=state.restoring && fns.savedInputsComplete(fns.SCAN_INPUT_IDS);
        if(!keep){
          // Defaults at the table node nearest to the centre of each axis.
          const c=state.interp.axes.map(a=>{
            const mid=(a[0]+a[a.length-1])/2;
            let best=a[0];
            // Ties: prefer the rounder value (7.5 rather than 7.486), then the smaller one.
            const len=x=>fmt(x).length;
            for(const x of a){ const d=Math.abs(x-mid)-Math.abs(best-mid); if(d<-1e-6 || (Math.abs(d)<=1e-6 && (len(x)<len(best) || (len(x)===len(best) && Math.abs(x)<Math.abs(best))))) best=x; }
            return fmt(best);
          });
          ['H','K','L'].forEach((nm,i)=>{ $(`conv${nm}0`).value=c[i]; $(`conv${nm}1`).value=c[i]; });
          // Constant-Q scan over the E range of the table by default.
          const e0=fns.num('convEmin'), e1=fns.num('convEmax'), eb=fns.num('convEbin');
          $('convE0').value=fmt(e0,3); $('convE1').value=fmt(e1,3);
          $('convPoints1D').value=String(defaultScanPoints(c.map(Number),e0,e1,eb));
        }
      }
      fns.message('convMessage2D',''); fns.message('convMessage1D',''); fns.message('convStatus1D','');
      state.bench=null; fns.scheduleEstimates();
      if(state.volume) fns.drawMaps();
      // Save CSV file names: the dispersion file name + _conv_2d / _conv_1d
      // when a new file is read (editable; a name kept from the last visit
      // stays on a reload).
      if(state.fileName!==state.namedFor){
        state.namedFor=state.fileName;
        for(const kind of ['2d','1d']){ const el=fns.nameInput(kind); if(el && !(state.restoring && el.value.trim())) el.value=fns.autoBase(state.fileName,kind); }
      }
      if(!state.restoring) fns.saveInputs();
    }catch(err){
      state.data=null; state.interp=null;
      $('convResetRanges').disabled=true;
      $('convSummary').textContent=err.message||String(err);
      $('convSummary').classList.add('conv-error');
      state.fileInfo='The file does not match the selected columns.';
      state.exampleShown=false; showPreview();
    }
  }
  async function loadFile(file){
    if(!file) return;
    if(!/\.(txt|dat|csv)$/i.test(file.name)){ $('convSummary').textContent='Select a .txt, .dat or .csv file.'; $('convSummary').classList.add('conv-error'); return; }
    state.text=await file.text(); state.fileName=file.name;
    $('convFileName').value=file.name;
    state.exampleShown=false;
    loadText();
    fns.storeFile({name:state.fileName,format:fns.formatValue(),text:state.text});
  }
  // U, V: the extent of the table points in the scattering plane (U, V
  // coefficients), bin from the table steps (the finest of the components
  // of U or V); W: 0 (a TAS measures in the scattering plane; the resolution
  // out of it is integrated); ħω: the branch energies with a margin.
  function fillRanges(){
    let plane=null;
    try{ plane=fns.planeBasis(collectResolutionBase()); }catch(_e){ plane=null; }
    const r6=v=>Number(v.toPrecision(6));
    if(plane){
      const cs=state.data.points.map(p=>plane.coeff3(p.hkl));
      const span=j=>[Math.min(...cs.map(c=>c[j])),Math.max(...cs.map(c=>c[j]))];
      const steps=state.interp.axes.map(ax=>ax.length>1 ? (ax[ax.length-1]-ax[0])/(ax.length-1) : 0);
      const binOf=vec=>{ let b=Infinity; vec.forEach((x,i)=>{ if(Math.abs(x)>1e-9 && steps[i]>0) b=Math.min(b,steps[i]/Math.abs(x)); }); return Number.isFinite(b) ? r6(b) : 0; };
      const [u0,u1]=span(0), [v0,v1]=span(1);
      const put=(n,lo,hi,bin)=>{ $(`conv${n}min`).value=fmt(r6(lo),6); $(`conv${n}max`).value=fmt(r6(hi),6); $(`conv${n}bin`).value=fmt(bin,6); };
      put('U',u0,u1,binOf(plane.U)); put('V',v0,v1,binOf(plane.V)); put('W',0,0,0);
    }
    const e=energyDefaults();
    $('convEmin').value=fmt(e.min,3); $('convEmax').value=fmt(e.max,3); $('convEbin').value=fmt(e.bin,3);
  }
  // ħω range and bin (a guide): from the lowest branch energy − 1.5 FWHM to
  // the highest + 1.5 FWHM (FWHM: energy resolution of the instrument now
  // set, at the Q and ħω of that lowest / highest point), bin FWHM/3 at the
  // lowest point (to three decimals).  min and max are multiples of the bin.
  // Without a resolution there (point out of reach): a margin of 20 % of the
  // energy span (at least 1 meV) and a bin of 0.2 meV.
  function energyDefaults(){
    let lo=null, hi=null;
    for(const p of state.data.points) p.E.forEach(e=>{
      if(!Number.isFinite(e)) return;
      if(!lo || e<lo.E) lo={hkl:p.hkl,E:e};
      if(!hi || e>hi.E) hi={hkl:p.hkl,E:e};
    });
    let fLo=NaN, fHi=NaN;
    try{
      const base=collectResolutionBase();
      fLo=fns.resolutionAt(base,lo.hkl,lo.E,{})?.widths?.E;
      fHi=fns.resolutionAt(base,hi.hkl,hi.E,{})?.widths?.E;
    }catch(_e){}
    const ok=w=>Number.isFinite(w) && w>0;
    const pad=Math.max(1,0.2*(state.data.eMax-state.data.eMin));
    const bin=ok(fLo) ? Math.max(0.001,Number((fLo/3).toFixed(3))) : 0.2;
    const r3=v=>Number(v.toFixed(3));
    const min=r3(Math.floor(((ok(fLo) ? lo.E-1.5*fLo : state.data.eMin-pad))/bin+1e-9)*bin);
    const max=r3(Math.ceil(((ok(fHi) ? hi.E+1.5*fHi : state.data.eMax+pad))/bin-1e-9)*bin);
    return {min,max,bin};
  }
  // Column heads of the 2D ranges: the directions of U, V (the scattering
  // plane) and W (out of it), "U // (1,0,0) (r.l.u.)".
  const vecText=v=>`(${v.map(x=>{ const t=fmt(Number(x.toFixed(4)),4); return t.replace(/^-/,'−'); }).join(',')})`;
  function updateRangeHeads(){
    let plane=null;
    try{ plane=fns.planeBasis(collectResolutionBase()); }catch(_e){ plane=null; }
    for(const n of ['U','V','W']){
      const el=$(`convHead${n}`); if(!el) continue;
      el.textContent=plane ? `${n} // ${vecText(plane[n])} (r.l.u.)` : `${n} (r.l.u.)`;
    }
  }
  // U, V, ħω: a range that the bin does not divide keeps min and bin, and
  // max is moved up to the next multiple of the bin (calculated range; max0:
  // the entry).  W: 0 (a TAS measures in the scattering plane; its boxes are
  // fixed at 0).
  function ranges(){
    const out={W:{min:0,max:0,max0:0,bin:0,value:0}};
    const label={U:'U',V:'V',E:'ħω'};
    for(const n of ['U','V','E']){
      const lo=fns.num(`conv${n}min`), hi=fns.num(`conv${n}max`), bin=fns.num(`conv${n}bin`);
      if(![lo,hi].every(Number.isFinite) || hi<lo) throw new Error(`Check the ${label[n]} min / max.`);
      const steps=bin>0 ? Math.ceil((hi-lo)/bin-1e-6) : 0;
      out[n]={min:lo,max:bin>0 ? Number((lo+steps*bin).toPrecision(12)) : hi,max0:hi,bin:bin>0 ? bin : 0};
    }
    for(const n of ['U','V']) if(!(out[n].bin>0) || !(out[n].max>out[n].min)) throw new Error(`${n} needs max > min and a positive bin.`);
    if(!(out.E.bin>0) || !(out.E.max>out.E.min)) throw new Error('ħω needs max > min and a positive bin.');
    return out;
  }

  // ------------------------------------------------------------ example --
  // Show example: an example dispersion file (MnF2, (H,0,L) plane) in File
  // preview, without the optional index column.  It is only shown; Load example
  // makes it the dispersion file, Save example downloads it.  Leaving File
  // preview (or reading a file) ends it: File preview shows the file again.
  const EXAMPLE_URL='examples/MnF2_disp_H0L.txt', EXAMPLE_NAME='MnF2_disp_H0L.txt';
  const example={comments:null,rows:null,n:0,data:null,format:''};
  // The example text in a format: its comment lines (columns line rewritten)
  // and the rows reordered from blocks (E1 … En, I1 … In) to pairs.
  function exampleText(format){
    const n=example.n, paired=format==='pair';
    const b=Array.from({length:n},(_,i)=>i+1);
    const names=paired ? b.flatMap(i=>[`E${i}`,`I${i}`]) : [...b.map(i=>`E${i}`),...b.map(i=>`I${i}`)];
    const head=example.comments.map(l=>/^#\s*columns:/i.test(l) ? `# columns: h k l ${names.join(' ')}${n>1 ? '  (an index column first is also accepted)' : ''}` : l);
    const body=example.rows.map(r=>{
      const q=r.slice(0,3), E=r.slice(3,3+n), I=r.slice(3+n,3+2*n);
      return [...q,...(paired ? E.flatMap((e,k)=>[e,I[k]]) : [...E,...I])].join('\t');
    });
    return [...head,...body].join('\n')+'\n';
  }
  async function readExample(){
    if(example.rows) return;
    const res=await fetch(EXAMPLE_URL);
    if(!res.ok) throw new Error(`Example not found (${res.status}).`);
    const lines=(await res.text()).split(/\r?\n/);
    example.comments=lines.filter(l=>/^#/.test(l));
    // Kept as the strings of the file (no rounding when reordered).
    example.rows=lines.filter(l=>l.trim() && !/^#/.test(l)).map(l=>l.trim().split(/\s+/));
    example.n=(example.rows[0].length-3)/2;
  }
  function exampleData(){
    const f=fns.formatValue();
    if(example.format!==f){ example.data=parseDispersionTable(exampleText(f),f); example.format=f; }
    return example.data;
  }
  // File preview: the information line and the table of what is shown.
  function showPreview(){
    const info=$('convTableInfo');
    if(!info) return;
    if(state.exampleShown){
      exampleData();
      const line=document.createElement('div');
      line.className='convolution-example-line';
      const say=document.createElement('span');
      say.textContent=`Example ${EXAMPLE_NAME} (not loaded): ${example.rows.length} rows; columns h, k, l, E1 … En, I1 … In.`;
      const load=document.createElement('button'); load.type='button'; load.textContent='Load example';
      load.addEventListener('click',loadExample);
      const save=document.createElement('button'); save.type='button'; save.textContent='Save example';
      save.addEventListener('click',()=>downloadText(exampleText(fns.formatValue()),EXAMPLE_NAME,'text/plain'));
      line.append(say,load,save);
      const notes=document.createElement('div');
      notes.className='convolution-example-notes';
      notes.textContent=exampleText(fns.formatValue()).split('\n').filter(l=>/^#/.test(l)).join('\n');
      info.replaceChildren(line,notes);
    }else{ info.textContent=state.fileInfo; info.removeAttribute('title'); }
    if(shown()){ renderTableHead(); renderTableRows(true); }
    else{ $('convTableHead')?.replaceChildren(); $('convTableBody')?.replaceChildren(); }
  }
  async function showExample(){
    try{ await readExample(); }
    catch(err){ $('convTableInfo').textContent=`Show example: ${err.message||err}`; return; }
    state.exampleShown=true;
    fns.showConvTab('data');
    showPreview();
  }
  // Load example: the example (in the selected format) becomes the
  // dispersion file, as if it had been selected.
  // The sample of the example: MnF2 (P4₂/mnm), scattering plane (H, 0, L).
  const EXAMPLE_SAMPLE={a:4.873,b:4.873,c:3.311,alpha:90,beta:90,gamma:90,Uh:1,Uk:0,Ul:0,Vh:0,Vk:0,Vl:1};
  const EXAMPLE_SPACE_GROUP=136;
  // Load example also sets the Sample to MnF2 (before the table is read, so
  // the ħω defaults use its resolution).  A loaded CIF/mCIF of MnF2 (lattice
  // within 0.1 %, e.g. c = 3.3099 Å) stays with its own lattice and only the
  // scattering plane is set; one with another lattice is cleared.
  function setExampleSample(){
    const LATTICE=['a','b','c','alpha','beta','gamma'], cifUnset=$('cifClearButton');
    const near=LATTICE.every(id=>{ const v=Number($(id)?.value), w=EXAMPLE_SAMPLE[id]; return Number.isFinite(v) && Math.abs(v-w)<=1e-3*w; });
    if(cifUnset && !cifUnset.disabled && near){
      const notes=fns.applySettings({instrument:Object.fromEntries(['Uh','Uk','Ul','Vh','Vk','Vl'].map(k=>[k,EXAMPLE_SAMPLE[k]]))},'2D');
      return {notes,keptCif:true};
    }
    // Another CIF/mCIF is unset there (its lattice differs); the space group
    // goes in before the lattice.
    const notes=fns.applySettings({instrument:{sampleSpaceGroupNumber:EXAMPLE_SPACE_GROUP,...EXAMPLE_SAMPLE}},'2D');
    return {notes,keptCif:false};
  }
  function loadExample(){
    const {notes,keptCif}=setExampleSample();
    state.text=exampleText(fns.formatValue()); state.fileName=EXAMPLE_NAME;
    $('convFileName').value=state.fileName;
    state.exampleShown=false;
    loadText();
    fns.storeFile({name:state.fileName,format:fns.formatValue(),text:state.text});
    // Say what was changed in the Sample (the notes in the hover text).
    state.fileInfo+=keptCif ? ' Scattering plane set to (H, 0, L) (the loaded MnF2 CIF/mCIF kept).'
      : ' Sample set to MnF2 (a = b = 4.873 Å, c = 3.311 Å, P4₂/mnm), scattering plane (H, 0, L).';
    const info=$('convTableInfo');
    if(info){ info.textContent=state.fileInfo; info.title=notes.join(' '); }
  }

  // -------------------------------------------------------- table viewer --
  // File preview: the loaded table, or the example while it is shown.
  const shown=()=>state.exampleShown ? example.data : state.data;
  function columnNames(){
    const d=shown(), n=d.nBranch;
    const b=Array.from({length:n},(_,i)=>i+1);
    const branches=d.paired ? b.flatMap(i=>[`E${i}`,`I${i}`]) : [...b.map(i=>`E${i}`),...b.map(i=>`I${i}`)];
    return [d.offset ? 'index' : '#','H','K','L',...branches];
  }
  function renderTableHead(){
    const tr=document.createElement('tr');
    for(const name of columnNames()){ const th=document.createElement('th'); th.textContent=name; tr.appendChild(th); }
    $('convTableHead').replaceChildren(tr);
  }
  const cell=v=>{ const a=Math.abs(v); return v===0 ? '0' : (a>=1e-3 && a<1e5 ? String(Number(v.toPrecision(6))) : v.toExponential(3)); };
  function renderTableRows(reset=false){
    const body=$('convTableBody'), box=$('convTableScroll'), d=shown();
    if(!d || !body || !box) return;
    if(reset) box.scrollTop=0;
    const total=d.rows.length, cols=columnNames().length;
    const first=Math.max(0,Math.floor(box.scrollTop/ROW_HEIGHT)-10);
    const count=Math.ceil((box.clientHeight||400)/ROW_HEIGHT)+20;
    const last=Math.min(total,first+count);
    const spacer=h=>{ const tr=document.createElement('tr'); tr.className='convolution-spacer'; const td=document.createElement('td'); td.colSpan=cols; td.style.height=`${h}px`; tr.appendChild(td); return tr; };
    const rows=[spacer(first*ROW_HEIGHT)];
    for(let i=first;i<last;i++){
      const r=d.rows[i], tr=document.createElement('tr');
      const values=d.offset ? r : [i+1,...r];
      for(const v of values){ const td=document.createElement('td'); td.textContent=cell(v); tr.appendChild(td); }
      rows.push(tr);
    }
    rows.push(spacer((total-last)*ROW_HEIGHT));
    body.replaceChildren(...rows);
  }
  Object.assign(fns,{updateRangeHeads, defaultScanPoints, loadText, loadFile, fillRanges, energyDefaults, ranges, EXAMPLE_URL, EXAMPLE_NAME, example, exampleText, readExample, exampleData, showPreview, showExample, EXAMPLE_SAMPLE, EXAMPLE_SPACE_GROUP, setExampleSample, loadExample, shown, columnNames, renderTableHead, cell, renderTableRows});
}
