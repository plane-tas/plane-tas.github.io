// Instrument files that were renamed: a saved setting (page state, CSV,
// instrument JSON) that names the old file is moved to the new one.
const RENAMED={'11_HODACA':'11_C11'};
// The key of the new file among `available` (with or without .json), or
// null when `key` was not renamed or the new file is not loaded.
export function renamedInstrument(key,available){
  const stem=String(key??'').replace(/\.json$/i,'');
  const to=RENAMED[stem];
  if(!to) return null;
  return [...available].find(v=>String(v).replace(/\.json$/i,'')===to) ?? null;
}
