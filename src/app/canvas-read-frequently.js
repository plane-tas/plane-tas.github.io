/* Loaded as a classic script BEFORE Plotly.

   Plotly's 3D text rendering (vectorize-text, used by the Structure viewer
   for axis ticks and labels) draws each label on an off-screen 2D canvas and
   reads it back with getImageData(), but creates that context without
   `willReadFrequently`. Chrome then logs
   "Canvas2D: Multiple readback operations using getImageData are faster with
   the willReadFrequently attribute set to true."

   For 2D contexts created on canvases that are NOT in the document
   (off-screen work canvases), default `willReadFrequently` to true. Such
   canvases are only used for drawing-then-reading, so a CPU-backed canvas is
   the faster choice. Canvases shown on the page, and any caller that sets
   `willReadFrequently` explicitly, are left untouched. */
(function(){
  'use strict';
  const proto=typeof HTMLCanvasElement!=='undefined' && HTMLCanvasElement.prototype;
  if(!proto || proto.getContext.__tasWillReadFrequently) return;
  const original=proto.getContext;
  function getContext(type,options){
    if(type==='2d' && !this.isConnected &&
       (options==null || (typeof options==='object' && options.willReadFrequently===undefined))){
      options=Object.assign({},options,{willReadFrequently:true});
    }
    return original.call(this,type,options);
  }
  getContext.__tasWillReadFrequently=true;
  proto.getContext=getContext;
})();
