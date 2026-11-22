// Jump bars of the long panels (sidebar: Instrument / Sample / Dark angle;
// Resolution: Focusing / Collimator / Crystal / Component).  The bar stays
// in view (sidebar: CSS position: sticky inside the panel; Instrument
// details: above the scrolling card); a button scrolls its section to just
// below the bar.
const scrollParent=el=>{
  for(let p=el?.parentElement;p;p=p.parentElement){
    const o=getComputedStyle(p).overflowY;
    if((o==='auto'||o==='scroll') && p.scrollHeight>p.clientHeight+1) return p;
  }
  return document.scrollingElement||document.documentElement;
};
const viewTop=scroller=>scroller===document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
function bindJumpBar(bar){
  for(const b of bar.querySelectorAll('button[data-jump]')){
    b.addEventListener('click',()=>{
      const target=document.getElementById(b.dataset.jump); if(!target) return;
      const scroller=scrollParent(target);
      // Below the bar, or at the top of the scrolling panel when the bar is
      // outside it.
      const rest=Math.max(viewTop(scroller),bar.getBoundingClientRect().bottom)+6;
      const delta=target.getBoundingClientRect().top-rest;
      scroller.scrollTo({top:Math.max(0,scroller.scrollTop+delta),behavior:'smooth'});
    });
  }
}
export function initializeJumpBars(){
  for(const bar of document.querySelectorAll('.jump-bar')){
    if(bar.dataset.bound) continue;
    bar.dataset.bound='1';
    bindJumpBar(bar);
  }
}
