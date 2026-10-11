/* Scale the full PLANE-TAS application without CSS zoom.  The former
   changes Plotly hover coordinates; CSS transform preserves SVG/canvas
   pointer hit-testing.  The outer spacer follows the visual (scaled) height
   so document scrolling never leaves a large empty tail. */
(function(){
  'use strict';
  const viewport=document.getElementById('tasUiViewport');
  const stage=document.getElementById('tasUiStage');
  const topBar=document.getElementById('tasTopBar');
  const header=topBar?.querySelector('header');
  if(!viewport || !stage || !header) return;
  let pending=false;
  function applyHeight(){
    pending=false;
    const scale=Number.parseFloat(getComputedStyle(stage).getPropertyValue('--tas-ui-scale'))||1;
    // scrollHeight includes dynamically shown results and script tables.
    const visualHeight=Math.ceil(stage.scrollHeight*scale);
    const headerHeight=Math.ceil(header.getBoundingClientRect().height);
    topBar.style.height=`${headerHeight}px`;
    const minimum=Math.max(0,(window.innerHeight||0)-headerHeight);
    viewport.style.height=`${Math.max(minimum,visualHeight)}px`;
  }
  function schedule(){
    if(pending) return;
    pending=true;
    requestAnimationFrame(applyHeight);
  }
  window.addEventListener('resize',schedule,{passive:true});
  if(typeof ResizeObserver!=='undefined'){
    const ro=new ResizeObserver(schedule);
    ro.observe(stage);
    ro.observe(header);
  }
  schedule();
})();
