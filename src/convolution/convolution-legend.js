import {fixedText} from '../core/number-format.js';
import {readTasSense} from '../core/tas-conventions.js';
// Legend of the 1D cut: one row per curve, in columns chosen by the user.
// Pure text from a curve's points and recorded settings; the page (option
// texts of the instrument and integration selects) is reached only through
// the `lookup` functions passed in.

// Numbers as written in the legend: at most d decimals, no "-0".
export const fmt=fixedText;

// Columns, in display order.  `on`: shown by default.
export const LEGEND_COLS=[
  {id:'pos',head:'(H, K, L)',on:true},{id:'hw',head:'ħω',on:true},
  {id:'inst',head:'Instrument',on:false},{id:'sense',head:'Sense',on:true},
  {id:'fixed',head:'Fixed',on:true},
  {id:'mono',head:'Mono',on:false},{id:'ana',head:'Ana',on:false},
  {id:'focus',head:'Ana HF',on:true},{id:'col',head:'Collimator',on:true},
  {id:'approx',head:'Approx.',on:true},{id:'integ',head:'Integration',on:false}];

// The chosen columns are kept in the browser as {shown, known}: a column
// added later (not in known) starts with its default.  A plain array is the
// first version, which had no ħω column.
const LEGEND_KEY='plane-tas-convolution-legend-columns';
const defaultColumns=()=>new Set(LEGEND_COLS.filter(c=>c.on).map(c=>c.id));
export function loadLegendColumns(){
  try{
    const v=JSON.parse(localStorage.getItem(LEGEND_KEY)||'null');
    const shown=Array.isArray(v) ? v : v?.shown;
    const known=Array.isArray(v) ? LEGEND_COLS.map(c=>c.id).filter(id=>id!=='hw') : v?.known;
    if(Array.isArray(shown) && Array.isArray(known))
      return new Set(LEGEND_COLS.filter(c=>known.includes(c.id) ? shown.includes(c.id) : c.on).map(c=>c.id));
  }catch(_e){}
  return defaultColumns();
}
export function saveLegendColumns(shown){
  try{ localStorage.setItem(LEGEND_KEY,JSON.stringify({shown:[...shown],known:LEGEND_COLS.map(c=>c.id)})); }catch(_e){}
}

const yes=v=>v===true || v==='true';

// Q of a scan: fixed components as numbers, moving ones as r·X + c with X
// the component that moves most, e.g. "(H, H, 1)", "(1.3−H, 0, 2)".
export function qText(pts){
  const names=['H','K','L'], f0=pts[0], f1=pts[pts.length-1];
  const d=[0,1,2].map(j=>f1.hkl[j]-f0.hkl[j]);
  const moving=[0,1,2].filter(j=>Math.abs(d[j])>1e-9);
  if(!moving.length) return `(${f0.hkl.map(v=>fmt(v)).join(', ')})`;
  const p=moving.reduce((a,b)=>Math.abs(d[b])>Math.abs(d[a])+1e-9 ? b : a,moving[0]), X=names[p];
  return `(${[0,1,2].map(j=>{
    if(!moving.includes(j)) return fmt(f0.hkl[j]);
    const r=d[j]/d[p], c=f0.hkl[j]-r*f0.hkl[p];
    const mag=Math.abs(Math.abs(r)-1)<1e-9 ? X : `${fmt(Math.abs(r))}${X}`;
    if(Math.abs(c)<1e-9) return r<0 ? `−${mag}` : mag;
    // 1.3−H rather than −H+1.3.
    return r<0 ? `${fmt(c)}−${mag}` : `${mag}${c<0 ? '−' : '+'}${fmt(Math.abs(c))}`;
  }).join(', ')})`;
}
// ħω of a scan (meV): the value when constant, "e0~e1" when it moves.
export function hwText(pts){
  const e0=pts[0].E, e1=pts[pts.length-1].E;
  return Math.abs(e1-e0)>1e-9 ? `${fmt(e0,3)}~${fmt(e1,3)}` : fmt(e0,3);
}

// Radial 3rd collimator: equivalent Gaussian FWHM (arcmin) of the analyzer
// seen from the sample, as in calcResolution.  Only for files saved before
// the calculated value was recorded; E is ħω (Ef = Ei − ħω with Ei fixed).
export function radialArcmin(si,E){
  const d=Number(si.dAna), w=Number(si.anaWcm)/100, n=Number(si.anaHB), L2=Number(si.L2), e=Number(si.energy);
  const Ef=si.energyMode==='Ei fixed' ? e-E : e;
  if(!(d>0 && w>0 && n>0 && L2>0 && Ef>0)) return NaN;
  const s=Math.PI/(d*Math.sqrt(Ef/2.072));
  if(!(s<=1)) return NaN;
  const af=2*Math.atan(w*n*s/2/L2)*180/Math.PI;
  return af*60*Math.sqrt(8*Math.log(2)/12);
}
// Horizontal collimation "1st-2nd-3rd-4th": blank = open, SM(m) for a
// supermirror guide, the equivalent divergence with (R) for a radial 3rd.
function collimationText(si,settings,E0){
  const col=['div1h','div2h','div3h','div4h'].map(id=>{ const v=String(si[id]??'').trim(); return v==='' ? 'open' : v; });
  if(yes(si.gm1)) col[0]=`SM(${String(si.div1m??'').trim()||'?'})`;
  if(si.coll3Type==='radial'){
    let a=settings?.derived?.radial3Arcmin;
    if(!Number.isFinite(a)) a=radialArcmin(si,E0);
    col[2]=Number.isFinite(a) ? `${Math.round(a)}(R)` : 'radial';
  }
  return col.join('-');
}
// Horizontal focusing of the analyzer: "on (7)" with the number of blades,
// or "off".
function anaHFText(si){
  const n=String(si.anaHB??'').trim();
  return yes(si.anaHF) ? `on${n ? ` (${n})` : ''}` : 'off';
}
// Instrument: the preset name without the site ("HODACA/HER@JRR3" ->
// "HODACA/HER"), with the setting when it is not the plain TAS one.
function instrumentText(si,lookup){
  const v=String(si.instrument??''); if(!v) return '';
  const name=(lookup.instrumentName?.(v) || v.replace(/\.json$/i,'').replace(/^\d+_/,'')).replace(/\s*@.*$/,'');
  const t=String(si.instrumentType??'');
  return t && t!=='tas' ? `${name} (${lookup.instrumentTypeName?.(v,t)||t})` : name;
}
// Integration of a 1D curve: "Grid σ/3 (21³)" or "MC 3000" (the option text
// without its accuracy range).
function integrationText(cv,lookup){
  if(!cv) return '';
  const mode=String(cv.convIntegration1D??'');
  const choice=(id,v)=>(lookup.optionText?.(id,v)||String(v??''))
    .replace(/\s*\(\d+(\.\d+)?[–-][\d.]+%\)\s*$/,'').replace(/\s+\d+(\.\d+)?[–-][\d.]+%$/,'').trim();
  if(mode==='mc') return `MC ${choice('convSamples1D',cv.convSamples1D)}`.trim();
  if(mode==='grid') return `Grid ${choice('convGrid1D',cv.convGrid1D)}`.trim();
  return mode;
}

// Legend values of a curve {pts, label, method, settings}, by column id.
// lookup: {instrumentName(value), instrumentTypeName(value, type),
// optionText(selectId, value)} for names shown on the page.
export function legendFields(k,lookup={}){
  const pts=k.pts||[];
  const pos=pts.length ? qText(pts) : (k.label||'');
  const hw=pts.length ? hwText(pts) : '';
  const si=k.settings?.instrument;
  const approx=si?.method||k.method||'';
  if(!si) return {pos,hw,approx};
  const e=Number(si.energy);
  return {pos,hw,approx,
    // Sense: all three signs (files saved with a Geometry: W / anti-W).
    inst:instrumentText(si,lookup),sense:si.sense===undefined ? '' : readTasSense(si.sense,si.geometry),
    fixed:`${si.energyMode==='Ei fixed' ? 'Ei' : 'Ef'}${Number.isFinite(e) ? ` (${fmt(e,3)})` : ''}`,
    mono:String(si.monoCrystal??''),ana:String(si.anaCrystal??''),focus:anaHFText(si),
    col:collimationText(si,k.settings,pts[0]?.E??0),integ:integrationText(k.settings?.convolution,lookup)};
}
// One line of the chosen columns (plot trace names, labels).
export function legendLine(fields,cols){
  return cols.map(c=>fields[c.id] && c.id==='hw' ? `ħω = ${fields[c.id]}` : fields[c.id]).filter(Boolean).join(', ');
}
