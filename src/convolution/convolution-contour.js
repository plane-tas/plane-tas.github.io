// Contour lines z = level on a grid (marching squares), as polylines for one
// Plotly scatter trace.  Used for the dispersion on the constant-energy map:
// a scatter line is redrawn at once on zoom, a Plotly contour trace is
// traced again on every zoom and slider step.
//   xs, ys: grid coordinates; z[j][i] the value at (xs[i], ys[j]); a cell
//   with a missing corner (null or not finite) has no line.
// Returns {x, y}: the polylines, separated by null.
export function isoLines(xs,ys,z,level){
  const nx=xs.length, ny=ys.length, out={x:[],y:[]};
  if(nx<2 || ny<2 || !Number.isFinite(level)) return out;
  const ok=v=>v!==null && v!==undefined && Number.isFinite(v);
  // Crossing points on the cell edges, by edge: h i_j from (i, j) to
  // (i+1, j), v i_j from (i, j) to (i, j+1).  Shared by the two cells.
  const pt=new Map();
  const edge=(k,x0,y0,v0,x1,y1,v1)=>{
    if(!pt.has(k)){ const t=(level-v0)/(v1-v0); pt.set(k,[x0+(x1-x0)*t,y0+(y1-y0)*t]); }
    return k;
  };
  const segs=[];
  for(let j=0;j<ny-1;j++){
    const r0=z[j], r1=z[j+1]; if(!r0 || !r1) continue;
    for(let i=0;i<nx-1;i++){
      // a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1)
      const a=r0[i], b=r0[i+1], c=r1[i+1], d=r1[i];
      if(!ok(a) || !ok(b) || !ok(c) || !ok(d)) continue;
      const A=a>level, B=b>level, C=c>level, D=d>level;
      if(A===B && B===C && C===D) continue;
      const x0=xs[i], x1=xs[i+1], y0=ys[j], y1=ys[j+1];
      const bot=A!==B ? edge(`h${i}_${j}`,x0,y0,a,x1,y0,b) : null;
      const rgt=B!==C ? edge(`v${i+1}_${j}`,x1,y0,b,x1,y1,c) : null;
      const top=D!==C ? edge(`h${i}_${j+1}`,x0,y1,d,x1,y1,c) : null;
      const lft=A!==D ? edge(`v${i}_${j}`,x0,y0,a,x0,y1,d) : null;
      const cut=[bot,rgt,top,lft].filter(Boolean);
      if(cut.length===2){ segs.push(cut); continue; }
      // Saddle (a, c on one side, b, d on the other): the cell centre
      // decides which pair of corners the lines cut off.
      const high=(a+b+c+d)/4>level;
      if(A===high){ segs.push([bot,rgt],[top,lft]); }   // b and d cut off
      else{ segs.push([lft,bot],[rgt,top]); }            // a and c cut off
    }
  }
  // Join the segments into polylines through their shared edge points.
  const adj=new Map();
  segs.forEach(([p,q],s)=>{ for(const k of [p,q]){ const l=adj.get(k); if(l) l.push(s); else adj.set(k,[s]); } });
  const used=new Uint8Array(segs.length);
  const extend=k=>{
    const keys=[];
    for(;;){
      const n=(adj.get(k)||[]).find(t=>!used[t]);
      if(n===undefined) return keys;
      used[n]=1; const [p,q]=segs[n]; k=p===k ? q : p; keys.push(k);
    }
  };
  for(let s=0;s<segs.length;s++){
    if(used[s]) continue;
    used[s]=1;
    const [p,q]=segs[s];
    const line=[...extend(p).reverse(),p,q,...extend(q)];
    if(out.x.length){ out.x.push(null); out.y.push(null); }
    for(const k of line){ const [x,y]=pt.get(k); out.x.push(x); out.y.push(y); }
  }
  return out;
}
