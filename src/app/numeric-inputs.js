// Numeric entry guard for the Angle calculation & TAS geometry inputs.
// Only characters that can form a number or a simple fraction (e.g. 1/3) can
// be typed; on commit an unparsable entry reverts to the last valid value, and
// decimal entries are kept to at most four decimal places.  The guard runs in
// the capture phase so every other change listener sees the cleaned value.
export const GEOMETRY_NUMERIC_INPUT_IDS=[
  'geomH','geomK','geomL','geomHW','geomComboU','geomComboV',
  'geomScanH0','geomScanK0','geomScanL0','geomScanHW0',
  'geomScanH1','geomScanK1','geomScanL1','geomScanHW1',
  'powderGeomS2','powderGeomQ','powderGeomHW'
];
const ALLOWED=/^[0-9+\-.\/⁄／eE ]*$/;
const MAX_DECIMALS=4;

export function formatDecimalEntry(raw){
  const text=String(raw??'').trim();
  // Fractions stay as typed; plain decimals are limited to four places.
  if(/[\/⁄／]/.test(text)) return text;
  const value=Number(text);
  if(!Number.isFinite(value)) return text;
  const rounded=Number(value.toFixed(MAX_DECIMALS));
  return String(Object.is(rounded,-0)?0:rounded);
}

export function installGeometryNumericInputs($,parseNumericValue,ids=GEOMETRY_NUMERIC_INPUT_IDS){
  const inputs=ids.map(id=>$(id)).filter(Boolean);
  const isValid=text=>Number.isFinite(parseNumericValue(text));
  for(const input of inputs){
    if(input.dataset.numericGuard) continue;
    input.dataset.numericGuard='1';
    if(isValid(input.value)) input.dataset.lastValid=input.value;
    input.addEventListener('focus',()=>{ if(isValid(input.value)) input.dataset.lastValid=input.value; });
    // Block characters that can never be part of a number.
    input.addEventListener('beforeinput',event=>{
      if(event.data!=null && !ALLOWED.test(event.data)) event.preventDefault();
    });
    // Pasted or autofilled text: drop the disallowed characters.
    input.addEventListener('input',()=>{
      if(input.type==='number' || ALLOWED.test(input.value)) return;
      const position=input.selectionStart;
      const before=input.value;
      input.value=before.replace(/[^0-9+\-.\/⁄／eE ]/g,'');
      try{ if(position!=null) input.setSelectionRange(Math.max(0,position-(before.length-input.value.length)),Math.max(0,position-(before.length-input.value.length))); }catch(_e){}
    });
    input.addEventListener('change',()=>{
      const text=String(input.value??'').trim();
      if(!isValid(text)){
        input.value=input.dataset.lastValid??'0';
        input.classList.add('numeric-entry-rejected');
        setTimeout(()=>input.classList.remove('numeric-entry-rejected'),900);
      }else{
        input.value=formatDecimalEntry(text);
      }
      input.dataset.lastValid=input.value;
    },true);
  }
}
