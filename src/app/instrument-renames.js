// Instrument files that were renamed or split: a saved setting (page state,
// CSV, instrument JSON) that names the old file (and setting) is moved to the
// new one.
//   11_HODACA.json -> 11_C11.json (HER) / 12_C11.json (HODACA, the former
//   "multiplexing" setting of the same file)
const MOVED=[
  {from:'11_HODACA',type:'multiplexing',to:'12_C11'},
  {from:'11_C11',type:'multiplexing',to:'12_C11'},
  {from:'11_HODACA',to:'11_C11'}];
const stem=v=>String(v??'').replace(/\.json$/i,'');
// {key, type} of the new file among `available` (values with or without
// .json), or null when nothing moved or the new file is not loaded.  The
// "multiplexing" setting keeps its type in the new file (HODACA).
export function movedInstrument(key,type,available){
  const m=MOVED.find(r=>r.from===stem(key) && (!r.type || r.type===String(type??'')));
  if(!m) return null;
  const to=[...available].find(v=>stem(v)===m.to);
  return to===undefined ? null : {key:to,type};
}
