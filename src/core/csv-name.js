// File name for Save CSV: the name in the entry (".csv" and characters that
// a file name cannot hold removed), else the automatic name.
export function csvNameFromEntry(input,auto){
  const typed=String(input?.value||'').trim().replace(/\.csv$/i,'').replace(/[\\/:*?"<>|]+/g,'_');
  const base=String(auto||'data').replace(/[\\/:*?"<>|]+/g,'_');
  return `${typed||base}.csv`;
}
// Put the automatic name into the entry as editable text (not a grey
// placeholder) whenever it changes, e.g. for a new file, ion or mode, and
// whenever the entry is empty; an edited name stays until then.
export function syncCsvNameTemplate(input,template){
  if(!input || !template) return;
  const changed=input.dataset.csvTemplate!==template;
  if(changed || !input.value.trim()) input.value=template;
  input.dataset.csvTemplate=template;
}
