// Save figure for the Q–E maps: the plot as on screen (current zoom, with its
// colour bars and their min / max labels) and, under it, the legend items
// that are shown (hidden ones are left out), as one PNG.  Plotly's own
// download button saves the plot only, without the legend outside it.

const loadImage=src=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; });

// One legend item: its swatch drawn into the canvas (an SVG marker as an
// image, a coloured box or a line), then its text.
async function legendItems(legend){
  const items=[];
  for(const button of legend?.querySelectorAll('.qe-legend-item') || []){
    if(button.getAttribute('aria-pressed')==='false' || button.offsetParent===null) continue;
    const svg=button.querySelector('svg');
    const swatch=button.querySelector('.qe-legend-swatch');
    const text=[...button.querySelectorAll('span')].filter(s=>!s.classList.contains('qe-legend-swatch')).map(s=>s.textContent).join(' ').trim();
    let draw;
    if(svg){
      const copy=svg.cloneNode(true); copy.setAttribute('xmlns','http://www.w3.org/2000/svg'); copy.setAttribute('width','20'); copy.setAttribute('height','20');
      const im=await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`);
      draw=(ctx,x,y)=>ctx.drawImage(im,x,y-10,20,20);
    }else if(swatch){
      const color=getComputedStyle(swatch).getPropertyValue('--legend-color').trim() || '#667085';
      const line=swatch.classList.contains('qe-legend-line');
      draw=(ctx,x,y)=>{
        ctx.save();
        if(line){ ctx.strokeStyle=color; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+20,y); ctx.stroke(); }
        else{ ctx.fillStyle=color; ctx.fillRect(x+2,y-6,16,12); ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.strokeRect(x+2.5,y-5.5,15,11); }
        ctx.restore();
      };
    }else draw=()=>{};
    items.push({text,draw});
  }
  return items;
}

// An optional title is drawn in a band above the plot, so the plot keeps
// its on-screen size.
export async function saveQEFigure({plotId,legendId,filename,title=''}){
  const gd=document.getElementById(plotId);
  if(!gd?.data || !window.Plotly) return;
  const S=2, w=Math.round(gd.clientWidth), h=Math.round(gd.clientHeight);
  const plot=await loadImage(await Plotly.toImage(gd,{format:'png',width:w,height:h,scale:S}));
  const items=await legendItems(document.getElementById(legendId));
  // Legend rows: items wrapped to the plot width, centred.
  const fs=15, font=`${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const measure=document.createElement('canvas').getContext('2d'); measure.font=font;
  const gap=18, sw=24, lineH=Math.round(fs*1.9), padX=16;
  const rows=[]; let row=[], rowW=0;
  for(const it of items){
    const iw=sw+measure.measureText(it.text).width;
    if(row.length && rowW+gap+iw>w-2*padX){ rows.push({row,rowW}); row=[]; rowW=0; }
    rowW+=(row.length ? gap : 0)+iw; row.push({...it,iw});
  }
  if(row.length) rows.push({row,rowW});
  const legendH=rows.length ? rows.length*lineH+12 : 0;
  const titleH=title ? Math.round(fs*2.4) : 0;
  const cv=document.createElement('canvas'); cv.width=w*S; cv.height=(titleH+h+legendH)*S;
  const ctx=cv.getContext('2d'); ctx.scale(S,S);
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,titleH+h+legendH);
  if(title){
    ctx.font=`600 ${fs+2}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline='middle'; ctx.textAlign='center'; ctx.fillStyle='#222';
    ctx.fillText(title,w/2,titleH/2+2);
    ctx.textAlign='left';
  }
  ctx.drawImage(plot,0,titleH,w,h);
  ctx.font=font; ctx.textBaseline='middle'; ctx.fillStyle='#222';
  rows.forEach(({row,rowW},r)=>{
    let x=(w-rowW)/2; const y=titleH+h+6+r*lineH+lineH/2;
    for(const it of row){ it.draw(ctx,x,y); ctx.fillStyle='#222'; ctx.fillText(it.text,x+sw,y); x+=it.iw+gap; }
  });
  const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
