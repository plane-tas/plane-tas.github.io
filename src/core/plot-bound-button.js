// A button that only works on a drawn figure (Save figure) is disabled while
// its plot is empty: before the first calculation, and after a failure
// cleared the plot (Plotly.purge).  Drawing, redrawing (Plotly.react from an
// empty figure to one with data) and purging all change nodes inside the
// plot, which is what is watched; the check itself is cheap.
export function enableWithPlot(button,plot){
  if(!button || !plot) return;
  const sync=()=>{ button.disabled=!(plot._fullLayout && Array.isArray(plot.data) && plot.data.length); };
  sync();
  new MutationObserver(()=>{ sync(); requestAnimationFrame(sync); }).observe(plot,{childList:true,subtree:true});
}
