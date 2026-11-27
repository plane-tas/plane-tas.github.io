// Plotly event bindings shared by the plots.
//
// Plotly.purge (an error, an emptied panel) drops a plot's listeners together
// with its event registry (gd._ev), and the next Plotly.react makes a new
// registry.  Bind once per registry, under a key of the caller's choice, so
// the handlers come back with the next drawing and are never bound twice.
export function bindOncePerRegistry(gd,key,bind){
  if(!gd || typeof gd.on!=='function' || gd[key]===gd._ev) return false;
  gd[key]=gd._ev;
  bind(gd);
  return true;
}

// Double-click returns to the plot's own view instead of Plotly's built-in
// reset (the ranges of the first drawing, which look like a random scale
// once the data have changed) or its autorange.  Draw the plot with
// config doubleClick:false and pass reset(gd), which applies the view.
// Plotly emits the event before its own relayout, so reset runs one frame
// later; it is skipped when the plot was removed meanwhile or, with
// drawToken(gd), redrawn.
export function installDoubleClickReset(gd,key,reset,{drawToken=null}={}){
  return bindOncePerRegistry(gd,key,()=>gd.on('plotly_doubleclick',()=>{
    const token=drawToken ? drawToken(gd) : undefined;
    requestAnimationFrame(()=>{
      if(!gd.isConnected || (drawToken && drawToken(gd)!==token)) return;
      reset(gd);
    });
  }));
}
