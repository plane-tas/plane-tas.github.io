// Numeric entry guard for the Angle calculation & TAS geometry inputs.
// Only characters that can form a number or a simple fraction (e.g. 1/3) can
// be typed; on commit an unparsable entry reverts to the last valid value, and
// decimal entries are kept to at most four decimal places.  The guard runs in
// the capture phase so every other change listener sees the cleaned value.
export const GEOMETRY_NUMERIC_INPUT_IDS=[
  'geomH','geomK','geomL','geomHW','geomComboU','geomComboV',
  'powderGeomS2','powderGeomQ','powderGeomHW'
];
const ALLOWED=/^[0-9+\-.\/⁄／eE ]*$/;
// Full-width digits / signs / separators and typographic minus signs → ASCII.
const WIDE=/[０-９．－＋，；　−–‐ｅＥ]/g;
const toAscii=text=>String(text).replace(WIDE,ch=>{
  const code=ch.charCodeAt(0);
  if(code>=0xFF10 && code<=0xFF19) return String.fromCharCode(code-0xFF10+48);
  return {'．':'.','－':'-','＋':'+','，':',','；':';','　':' ','−':'-','–':'-','‐':'-','ｅ':'e','Ｅ':'E'}[ch]||ch;
});

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
      if(event.data==null || event.isComposing || /Composition/.test(event.inputType||'')) return;
      if(!ALLOWED.test(toAscii(event.data))) event.preventDefault();
    });
    // Pasted, autofilled or IME text: full-width forms to ASCII, then drop
    // the disallowed characters.
    const clean=()=>{
      if(input.type==='number') return;
      const ascii=toAscii(input.value);
      if(ascii===input.value && ALLOWED.test(ascii)) return;
      const position=input.selectionStart;
      const before=input.value;
      input.value=ascii.replace(/[^0-9+\-.\/⁄／eE ]/g,'');
      try{ if(position!=null) input.setSelectionRange(Math.max(0,position-(before.length-input.value.length)),Math.max(0,position-(before.length-input.value.length))); }catch(_e){}
    };
    input.addEventListener('input',ev=>{ if(!ev.isComposing) clean(); });
    input.addEventListener('compositionend',clean);
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

// Page-wide guard for every other numeric entry box, including the rows that
// are added later (propagation vectors, Dark angles, CIF atoms, spins, Script
// rows).  One set of listeners on the document (capture phase, so other
// listeners see the cleaned value) decides from the element what may be typed:
//   type="number"                 digits . + - e E
//   data-fraction / data-numeric="fraction"   the same and / (e.g. 1/3), spaces
//   data-numeric="int"            digits only
//   data-numeric="list"           numbers separated by spaces, commas, semicolons
// Full-width characters from a Japanese input method (１２．５, －) and the
// typographic minus (−) are first turned into their ASCII forms, so a number
// typed with the IME on or pasted from a paper keeps its digits and sign.
// Characters that can never belong are then refused as they are typed (or
// removed from pasted text).  When the entry is committed, an unreadable value goes
// back to the last valid one; an empty box is kept where it has a placeholder
// (it then means "default", "auto" or "free"), otherwise it also goes back.
// Free-text boxes (names, formulas, Q paths, Script ranges) are not touched.
// Boxes that keep their own rules (the Angle-calculation guard above and the
// space-group numbers) are left to them.
const KIND_CHARS={
  number:/^[0-9.eE+\-]*$/,
  fraction:/^[0-9.eE+\-\/⁄／ ]*$/,
  int:/^[0-9]*$/,
  list:/^[0-9.eE+\-\s,;]*$/
};
const KIND_STRIP={
  fraction:/[^0-9.eE+\-\/⁄／ ]/g,
  int:/[^0-9]/g,
  list:/[^0-9.eE+\-\s,;]/g
};
function numericKind(el){
  if(!el || el.tagName!=='INPUT' || el.readOnly || el.disabled) return null;
  if(el.dataset.numericGuard || el.dataset.integerOnlyBound) return null;
  if(el.type==='number') return 'number';
  if(el.type!=='text' && el.type!=='') return null;
  if(el.dataset.numeric) return KIND_CHARS[el.dataset.numeric] ? el.dataset.numeric : null;
  if(el.dataset.fraction!==undefined) return 'fraction';
  return null;
}
export function installNumericInputGuard(parseNumericValue,doc=document){
  if(doc.__numericGuardInstalled) return;
  doc.__numericGuardInstalled=true;
  const readable=(el,kind)=>{
    const text=String(el.value??'').trim();
    if(kind==='number') return !el.validity?.badInput && text!=='' ;
    if(kind==='fraction') return Number.isFinite(parseNumericValue(text));
    if(kind==='int') return /^\d+$/.test(text);
    return true;
  };
  const remember=el=>{
    const kind=numericKind(el);
    if(kind && readable(el,kind)) el.dataset.lastValid=el.value;
  };
  doc.addEventListener('focusin',ev=>remember(ev.target),true);
  doc.addEventListener('beforeinput',ev=>{
    const kind=numericKind(ev.target);
    // IME composition cannot be cancelled; it is converted in 'input' below.
    if(!kind || ev.data==null || ev.isComposing || /Composition/.test(ev.inputType||'')) return;
    if(!KIND_CHARS[kind].test(toAscii(ev.data))) ev.preventDefault();
  },true);
  // Pasted, dropped or autofilled text in text boxes: drop what cannot belong.
  // (A number box exposes no text for invalid input; its commit check below
  // handles that case.)
  doc.addEventListener('input',ev=>{
    const el=ev.target, kind=numericKind(el);
    if(!kind || kind==='number' || ev.isComposing) return;
    const ascii=toAscii(el.value);
    if(ascii===el.value && KIND_CHARS[kind].test(ascii)) return;
    const before=el.value, at=el.selectionStart;
    el.value=ascii.replace(KIND_STRIP[kind],'');
    const back=before.length-el.value.length;
    try{ if(at!=null) el.setSelectionRange(Math.max(0,at-back),Math.max(0,at-back)); }catch(_e){}
  },true);
  doc.addEventListener('compositionend',ev=>{
    const el=ev.target, kind=numericKind(el);
    if(!kind || kind==='number') return;
    const fixed=toAscii(el.value).replace(KIND_STRIP[kind],'');
    if(fixed!==el.value){ el.value=fixed; el.dispatchEvent(new Event('input',{bubbles:true})); }
  },true);
  doc.addEventListener('change',ev=>{
    const el=ev.target, kind=numericKind(el);
    if(!kind || kind==='list') return;
    const text=String(el.value??'').trim();
    const empty=text==='' && !(kind==='number' && el.validity?.badInput);
    if(empty && (el.placeholder || kind==='number')){ return; }
    if(readable(el,kind)){ el.dataset.lastValid=el.value; return; }
    // Unreadable: back to the last valid value (or empty when there is none).
    el.value=el.dataset.lastValid ?? '';
    el.classList.add('numeric-entry-rejected');
    setTimeout(()=>el.classList.remove('numeric-entry-rejected'),900);
  },true);
}

