// File names for Save CSV and Save figure. One name entry serves both (its
// suffix reads ".csv/.png"): the name in the entry (".csv" / ".png" and
// characters that a file name cannot hold removed), else the automatic name.
const ILLEGAL=/[\\/:*?"<>|]+/g;
export function fileBaseFromEntry(input,auto){
  const typed=String(input?.value||'').trim().replace(/\.(csv|png)$/i,'').replace(ILLEGAL,'_');
  const base=String(auto||'data').replace(ILLEGAL,'_');
  return typed||base;
}
export function csvNameFromEntry(input,auto){ return `${fileBaseFromEntry(input,auto)}.csv`; }
export function pngNameFromEntry(input,auto){ return `${fileBaseFromEntry(input,auto)}.png`; }
// Put the automatic name into the entry as editable text (not a grey
// placeholder) whenever it changes, e.g. for a new file, ion or mode; an
// edited name stays until then.  An entry left empty gets the automatic
// name back at once when it is left (blur, or Enter); while the entry is
// being edited nothing is put into it.
export function syncCsvNameTemplate(input,template){
  if(!input || !template) return;
  refillWhenLeftEmpty(input);
  if(document.activeElement===input) return;
  const changed=input.dataset.csvTemplate!==template;
  if(changed || !input.value.trim()) input.value=template;
  input.dataset.csvTemplate=template;
}
function refillWhenLeftEmpty(input){
  if(input.dataset.csvRefill) return;
  input.dataset.csvRefill='1';
  const refill=()=>{
    if(input.value.trim() || !input.dataset.csvTemplate) return;
    input.value=input.dataset.csvTemplate;
  };
  input.addEventListener('blur',refill);
  input.addEventListener('change',refill);
}
// Base of a sample-derived name: the selected CIF/mCIF without extension,
// else the fallback.
export function sampleFileBase(fallback=''){
  const raw=String(document.getElementById('cifFileName')?.value||'').trim();
  if(!raw || /^no file selected$/i.test(raw)) return fallback;
  return raw.replace(/\.[^.]*$/,'').replace(/[^\w.+-]+/g,'_').replace(/^_+|_+$/g,'')||fallback;
}
