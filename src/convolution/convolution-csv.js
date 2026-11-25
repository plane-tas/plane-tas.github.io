// Resolution › Convolution: Save CSV / Load CSV of the 2D slice and the
// 1D cut, and their file names.
// Part of Resolution › Convolution (see convolution-ui.js for how the parts
// are wired: shared state, functions by name in fns).
import {fmt} from './convolution-legend.js';
import {downloadText} from '../core/download.js';
import {fileBaseFromEntry, syncCsvNameTemplate} from '../core/csv-name.js';

export function installConvolutionCsv(context){
  const {$, collectResolutionBase}=context.deps;
  const {state,fns}=context;
  // Save CSV file name: the entry next to Save CSV, or (empty) the dispersion file
  // name + _conv_1d / _conv_2d, shown there as the placeholder.
  const autoBase=(src,kind)=>{
    const base=String(src||'').replace(/\.[^.]*$/,'').replace(/[^\w.+-]+/g,'_').replace(/^_+|_+$/g,'');
    return `${base||'convolution'}_conv_${kind}`;
  };
  const nameInput=kind=>$(kind==='2d' ? 'convCsvName2D' : 'convCsvName1D');
  // One name for Save CSV and Save figure (".csv/.png").
  const fileBase=(src,kind)=>fileBaseFromEntry(nameInput(kind),autoBase(src,kind));
  const csvName=(src,kind)=>`${fileBase(src,kind)}.csv`;
  const source2D=()=>state.volume?.settings?.dispersion?.file||state.fileName;
  const source1D=()=>fns.curveList().find(c=>c.k.settings?.dispersion?.file)?.k.settings.dispersion.file||state.fileName;
  // The automatic name is put into the entry as editable text.
  function updateNamePlaceholders(){
    syncCsvNameTemplate(nameInput('2d'),autoBase(source2D(),'2d'));
    syncCsvNameTemplate(nameInput('1d'),autoBase(source1D(),'1d'));
  }
  // CSV: the current scan and every kept scan, one block per curve.
  function downloadScan(){
    // Curve tags are plain numbers (a leading # would read as a comment).
    const curves=fns.curveList().map(c=>({...c.k,tag:c.tag,color:c.color}));
    if(!curves.length) return;
    const lines=['# PLANE-TAS convolution: 1D cut',`# dispersion file: ${state.fileName}`,'# intensity: S(Q,w) table x R0/Rmon (normalisation to monitor counts; monitor half way between monochromator and sample, taking the whole beam)',
      ...curves.map(c=>`# curve ${c.tag}: ${c.label} (${c.method})`),
      // Colour of each curve (put back by Load CSV).
      ...curves.map(c=>`# color curve ${c.tag}: ${fns.hexColor(c.color)}`),
      ...curves.map(c=>fns.settingsLine(c.settings,`settings curve ${c.tag}`)).filter(Boolean),
      'curve,H,K,L,hw_meV,I_arb,dI'];
    const num6=v=>Number.isFinite(v) ? String(Number(v.toFixed(6))) : '';
    for(const c of curves) c.pts.forEach((p,i)=>lines.push(`${c.tag},${p.hkl.map(num6).join(',')},${num6(p.E)},${Number.isFinite(c.I[i]) ? c.I[i].toPrecision(8) : ''},${c.err && Number.isFinite(c.err[i]) ? c.err[i].toPrecision(6) : ''}`));
    downloadText(lines.join('\n')+'\n',csvName(curves.find(c=>c.settings?.dispersion?.file)?.settings.dispersion.file||state.fileName,'1d'),'text/csv');
  }

  // 2D volume: one row per (h, k, l, ħω) point inside the range, with an
  // index column when the dispersion file has one.
  function downloadVolume(){
    if(!state.volume) return;
    const {A,B,E,I,plane}=state.volume, nA=A.length, nE=E.length;
    const idx=!!state.data?.offset;
    const lines=['# PLANE-TAS convolution: 2D slice',`# dispersion file: ${state.volume.settings?.dispersion?.file||state.fileName}`,'# intensity: S(Q,w) table x R0/Rmon (normalisation to monitor counts; monitor half way between monochromator and sample, taking the whole beam)',
      fns.settingsLine(state.volume.settings),(idx ? 'index,' : '')+'H,K,L,hw_meV,I_arb'].filter(Boolean);
    let n=0;
    for(let b=0;b<B.length;b++) for(let a=0;a<nA;a++){
      const hkl=plane.hkl(A[a],B[b]).map(v=>Number(v.toFixed(6))).join(',');
      for(let e=0;e<nE;e++){
        const v=I[(b*nA+a)*nE+e];
        if(!Number.isFinite(v)) continue;
        lines.push(`${idx ? `${++n},` : ''}${hkl},${Number(E[e].toFixed(6))},${v.toPrecision(8)}`);
      }
    }
    downloadText(lines.join('\n')+'\n',csvName(state.volume.settings?.dispersion?.file||state.fileName,'2d'),'text/csv');
  }

  // ------------------------------------------------------------ CSV input --
  const splitRow=line=>line.trim().split(/[\s,;]+/).filter(Boolean);
  function nextColor(){ const used=new Set(fns.kept.map(k=>k.color)); return fns.PALETTE.find(c=>!used.has(c))||fns.PALETTE[fns.kept.length%fns.PALETTE.length]; }
  // Which variable a scan runs along: the Q component that changes most,
  // otherwise ħω.
  function scanAxis(pts){
    const span=j=>{ const v=pts.map(p=>j===3 ? p.E : p.hkl[j]).filter(Number.isFinite); return v.length ? Math.max(...v)-Math.min(...v) : 0; };
    const q=[0,1,2].filter(j=>span(j)>1e-9);
    return q.length ? q.reduce((a,b)=>span(b)>span(a)?b:a,q[0]) : 3;
  }
  const varText=(pts,j)=>{ const v=pts.map(p=>j===3 ? p.E : p.hkl[j]); const a=v[0], b=v[v.length-1]; return Math.abs(b-a)>1e-9 ? `${fmt(a)}~${fmt(b)}` : fmt(a); };
  // 1D: only a CSV written by Save CSV (curve, H, K, L, hw, I[, dI]); its
  // curves become kept curves.  Other tables (measured data) are not read.
  function load1DText(textIn,name){
    const lines=String(textIn).split(/\r?\n/);
    const comments=lines.filter(l=>/^\s*#/.test(l));
    const rows=lines.filter(l=>l.trim() && !/^\s*[#%!;]/.test(l)).map(splitRow);
    if(!rows.length) throw new Error('No data rows found.');
    const header=rows[0].some(t=>!Number.isFinite(Number(t))) ? rows.shift().map(t=>t.toLowerCase()) : null;
    const added=[];
    // Comment lines of one curve: "# curve 1: …", "# settings curve 1: …",
    // "# color curve 1: #rrggbb".
    const curveLine=(key,tag)=>new RegExp(`^\\s*#\\s*${key}\\s+${tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}:`);
    const curveComment=(key,tag)=>{ const re=curveLine(key,tag); return comments.find(l=>re.test(l))||''; };
    if(header && header[0]==='curve' && header.includes('hw_mev')){
      const col=n=>header.indexOf(n);
      const [cH,cK,cL,cE,cI]=['h','k','l','hw_mev','i_arb'].map(col);
      const groups=new Map();
      for(const r of rows){
        const tag=r[0]; if(!groups.has(tag)) groups.set(tag,[]);
        groups.get(tag).push(r);
      }
      for(const [tag,rs] of groups){
        const meta=curveComment('curve',tag).replace(/^\s*#\s*curve\s+\S+:\s*/,'');
        const val=(r,c)=>c>=0 && r[c]!==undefined && r[c]!=='' ? Number(r[c]) : NaN;
        const pts=rs.map(r=>({hkl:[val(r,cH),val(r,cK),val(r,cL)],E:val(r,cE)}));
        const I=rs.map(r=>val(r,cI));
        if(/^data\s/.test(meta)) continue;
        const m=meta.match(/\((Cooper-Nathans|Popovici)\)\s*$/);
        const axis=scanAxis(pts);
        const settings=fns.readSettings(comments,curveLine('settings curve',tag));
        const cm=curveComment('color curve',tag).match(/#[0-9a-f]{6}\s*$/i);
        added.push({color:cm ? cm[0].trim().toLowerCase() : '',axis,pts,I,label:(meta.replace(/\s*\((Cooper-Nathans|Popovici)\)\s*$/,'')||`${name} ${tag}`),method:m?.[1]||'',inputs:[0,1,2,3].map(j=>varText(pts,j)),settings});
      }
    }else throw new Error('Not a 1D CSV saved with Save CSV.');
    if(!added.length) throw new Error('No curves found in the file.');
    for(const k of added) fns.kept.push({...k,color:k.color||nextColor(),source:name});
    // The settings of the last calculated curve go back into the sidebar,
    // Resolution and the 1D cut box.
    const last=[...added].reverse().find(k=>k.settings);
    const notes=last ? fns.applySettings(last.settings,'1D') : [];
    fns.showConvTab('1d');
    fns.refreshKept();
    return {n:added.length,restored:!!last,notes};
  }
  // 2D: a CSV written by Save CSV ([index,] H, K, L, hw, I).  U and V are
  // read from its first comment line (otherwise the current scattering plane).
  // parse2DText reads it (also for the Q-E maps, Sample › Dispersion);
  // load2DText also applies its settings and shows it here.
  function parse2DText(textIn){
    const lines=String(textIn).split(/\r?\n/);
    const uv=lines.find(l=>/U\s*=\s*\(/.test(l) && /V\s*=\s*\(/.test(l));
    const vecOf=(lab)=>{ const mm=uv?.match(new RegExp(`${lab}\\s*=\\s*\\(([^)]*)\\)`)); return mm ? mm[1].split(',').map(Number) : null; };
    let U=vecOf('U'), V=vecOf('V');
    const settings=fns.readSettings(lines,/^\s*#\s*settings:/);
    const si=settings?.instrument;
    if(si && ['Uh','Uk','Ul','Vh','Vk','Vl'].every(k=>Number.isFinite(fns.parseNum(si[k])))){ U=['Uh','Uk','Ul'].map(k=>fns.parseNum(si[k])); V=['Vh','Vk','Vl'].map(k=>fns.parseNum(si[k])); }
    if(!U || !V || U.length!==3 || V.length!==3 || [...U,...V].some(v=>!Number.isFinite(v))){
      const base=collectResolutionBase(); U=base.lc.sv1.map(Number); V=base.lc.sv2.map(Number);
    }
    const rows=lines.filter(l=>l.trim() && !/^\s*[#%!;]/.test(l)).map(splitRow);
    const header=rows.length && rows[0].some(t=>!Number.isFinite(Number(t))) ? rows.shift().map(t=>t.toLowerCase()) : null;
    let cols;
    if(header){ cols=['h','k','l','hw_mev','i_arb'].map(n=>header.indexOf(n)); if(cols[3]<0) cols[3]=header.findIndex(n=>/^(e|hw|energy)$/.test(n)); if(cols[4]<0) cols[4]=header.findIndex(n=>/^(i|intensity)$/.test(n)); }
    else{ const off=rows[0]?.length===6 ? 1 : 0; cols=[0,1,2,3,4].map(i=>i+off); }
    if(cols.some(c=>c<0)) throw new Error('Expected the columns H, K, L, hw_meV and I_arb.');
    // (H, K, L) = a U + b V: least squares in index space.
    const uu=U.reduce((s,x)=>s+x*x,0), vv=V.reduce((s,x)=>s+x*x,0), uvp=U.reduce((s,x,i)=>s+x*V[i],0), det=uu*vv-uvp*uvp;
    if(Math.abs(det)<1e-12) throw new Error('U and V are parallel.');
    const r6=v=>Math.round(v*1e6)/1e6;
    const recs=rows.map(r=>{
      const h=[0,1,2].map(i=>Number(r[cols[i]])), E=Number(r[cols[3]]), I=Number(r[cols[4]]);
      const pu=h.reduce((s,x,i)=>s+x*U[i],0), pv=h.reduce((s,x,i)=>s+x*V[i],0);
      return {a:r6((vv*pu-uvp*pv)/det),b:r6((uu*pv-uvp*pu)/det),E:r6(E),I};
    }).filter(o=>[o.a,o.b,o.E].every(Number.isFinite));
    if(!recs.length) throw new Error('No numeric rows found.');
    const uniq=k=>[...new Set(recs.map(o=>o[k]))].sort((x,y)=>x-y);
    const A=uniq('a'), B=uniq('b'), E=uniq('E');
    if(A.length<2 || B.length<2 || E.length<2) throw new Error('The file is not a 2D (U, V, ħω) grid.');
    if(A.length*B.length*E.length>4e7) throw new Error('The grid in the file is too large.');
    const ia=new Map(A.map((v,i)=>[v,i])), ib=new Map(B.map((v,i)=>[v,i])), ie=new Map(E.map((v,i)=>[v,i]));
    const I=new Float64Array(A.length*B.length*E.length).fill(NaN);
    for(const o of recs) I[(ib.get(o.b)*A.length+ia.get(o.a))*E.length+ie.get(o.E)]=o.I;
    return {A,B,E,I,U,V,settings};
  }
  function load2DText(textIn){
    const {A,B,E,I,U,V,settings}=parse2DText(textIn);
    const notes=settings ? fns.applySettings(settings,'2D') : [];
    state.volume={A,B,E,I,U,V,plane:{U,V,hkl:(a,b)=>U.map((x,i)=>a*x+b*V[i])},settings};
    fns.zlim.min=null; fns.zlim.max=null; fns.saveInputs();
    fns.store2D();
    $('convDownload2D').disabled=false;
    fns.showConvTab('2d');
    fns.setupSliders(); fns.drawMaps();
    return {nA:A.length,nB:B.length,nE:E.length,restored:!!settings,notes};
  }
  // Load CSV row: the loaded file name, and Clear, which removes what that
  // file brought in (the 2D maps if they are still the loaded ones; the
  // curves read from it in 1D) and empties the name.
  function setLoaded(dim,name){
    const box=$(`convLoad${dim}Name`); if(box){ box.value=name||''; box.title=name||''; }
    if($(`convLoad${dim}Clear`)) $(`convLoad${dim}Clear`).disabled=!name;
  }
  function clearLoaded(dim){
    const name=$(`convLoad${dim}Name`)?.title||'';
    if(dim==='2D'){
      if(state.volume && state.volume.source===name){
        fns.clear2DResult();
        fns.message('convMessage2D','');
      }
    }else{
      const n=fns.kept.length;
      fns.kept.splice(0,fns.kept.length,...fns.kept.filter(k=>k.source!==name));
      if(fns.kept.length!==n) fns.refreshKept();
      fns.message('convStatus1D',''); fns.message('convMessage1D','');
    }
    setLoaded(dim,'');
  }
  function pickFile(inputId,handler){
    const f=$(inputId);
    f?.addEventListener('change',async()=>{
      const file=f.files?.[0]; f.value='';
      if(file) await handler(file);
    });
  }
  Object.assign(fns,{autoBase, nameInput, fileBase, csvName, source2D, source1D, updateNamePlaceholders, downloadScan, downloadVolume, splitRow, nextColor, scanAxis, varText, load1DText, parse2DText, load2DText, setLoaded, clearLoaded, pickFile});
}
