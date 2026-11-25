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
// placeholder) whenever it changes, e.g. for a new file, ion or mode, and
// whenever the entry is empty; an edited name stays until then.
export function syncCsvNameTemplate(input,template){
  if(!input || !template) return;
  const changed=input.dataset.csvTemplate!==template;
  if(changed || !input.value.trim()) input.value=template;
  input.dataset.csvTemplate=template;
}
// Base of a sample-derived name: the selected CIF/mCIF without extension,
// else the fallback.
export function sampleFileBase(fallback=''){
  const raw=String(document.getElementById('cifFileName')?.value||'').trim();
  if(!raw || /^no file selected$/i.test(raw)) return fallback;
  return raw.replace(/\.[^.]*$/,'').replace(/[^\w.+-]+/g,'_').replace(/^_+|_+$/g,'')||fallback;
}
