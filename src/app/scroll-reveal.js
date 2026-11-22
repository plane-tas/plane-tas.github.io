// Scrolling helpers shared by the jump bars and the sidebar Add buttons.
export const scrollParent=el=>{
  for(let p=el?.parentElement;p;p=p.parentElement){
    const o=getComputedStyle(p).overflowY;
    if((o==='auto'||o==='scroll') && p.scrollHeight>p.clientHeight+1) return p;
  }
  return document.scrollingElement||document.documentElement;
};
export const viewTop=scroller=>scroller===document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
const viewBottom=scroller=>scroller===document.scrollingElement ? window.innerHeight : scroller.getBoundingClientRect().bottom;

// Whether everything from `first` down to `last` can be in view at once.
export function fitsInView(first,last){
  if(!first || !last) return false;
  const scroller=scrollParent(first);
  const bar=scroller.querySelector?.('.jump-bar');
  const top=Math.max(viewTop(scroller),bar && scroller.contains(bar) ? bar.getBoundingClientRect().bottom : -Infinity)+6;
  return last.getBoundingClientRect().bottom-first.getBoundingClientRect().top<=viewBottom(scroller)-8-top;
}

// After an Add: scroll so that everything from `first` (the new row or
// card) down to `last` (the Add button under it) is in view. If that does
// not fit, the top of `first` stays just below the sticky jump bar.
export function revealRange(first,last=first){
  if(!first) return;
  const scroller=scrollParent(first);
  const bar=scroller.querySelector?.('.jump-bar');
  const top=Math.max(viewTop(scroller),bar && scroller.contains(bar) ? bar.getBoundingClientRect().bottom : -Infinity)+6;
  const bottom=viewBottom(scroller)-8;
  const firstTop=first.getBoundingClientRect().top;
  const lastBottom=(last||first).getBoundingClientRect().bottom;
  let delta=0;
  if(lastBottom>bottom) delta=Math.min(lastBottom-bottom,firstTop-top);
  else if(firstTop<top) delta=firstTop-top;
  if(Math.abs(delta)>0.5) scroller.scrollBy({top:delta,behavior:'smooth'});
}
