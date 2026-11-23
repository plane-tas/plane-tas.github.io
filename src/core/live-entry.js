// Entries next to a figure apply while typing: once a complete number has
// been typed and the typing pauses (delay ms), apply(text) runs, as for the
// Angle calculation entries.  Enter and leaving the box still run the box's
// own change handler (which may also tidy the value).  An incomplete number
// ("0.", "1e", "-") is not applied; an empty box only with allowEmpty
// (e.g. back to automatic).  valid(text) can hold back a value that is a
// number but not usable yet (e.g. min above max while editing).
const NUMBER=/^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;
export function applyWhileTyping(el,apply,{delay=500,allowEmpty=false,valid=()=>true}={}){
  if(!el) return;
  let timer=0;
  const stop=()=>{ clearTimeout(timer); timer=0; };
  el.addEventListener('input',()=>{
    stop();
    if(el.validity?.badInput) return;
    const text=String(el.value).trim();
    if(text===''){ if(!allowEmpty) return; }
    else if(!NUMBER.test(text)) return;
    timer=setTimeout(()=>{ timer=0; if(valid(text)) apply(text); },delay);
  });
  el.addEventListener('change',stop);
  el.addEventListener('blur',stop);
}
