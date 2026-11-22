// Marker of the magnetic Bragg peaks of each propagation vector k1..k6 (the
// Plotly symbol; the table rows draw the same shape with magneticSymbolSvg).
// Symbols, not colors, tell the vectors apart (colors are left for a future
// color bar). Six: sextuple-Q states have been proposed.
export const MAX_PROPAGATION_VECTORS=6;
export const MAGNETIC_SYMBOLS=[
  {plotly:'circle'},
  {plotly:'triangle-up'},
  {plotly:'square'},
  {plotly:'star'},
  {plotly:'triangle-down'},
  {plotly:'diamond'}
];
export function magneticSymbol(qIndex){
  return MAGNETIC_SYMBOLS[(Math.max(1,qIndex)-1)%MAGNETIC_SYMBOLS.length];
}
// The marker as a small inline SVG (the same shapes as the map legend), for
// the rows of the Propagation vector table.
export function magneticSymbolSvg(qIndex,color='red'){
  const shape={
    circle:`<circle cx="10" cy="10" r="6.7" fill="${color}"/>`,
    'triangle-up':`<polygon points="10,2 18,17 2,17" fill="${color}"/>`,
    square:`<rect x="3" y="3" width="14" height="14" rx="0.5" fill="${color}"/>`,
    'triangle-down':`<polygon points="2,3 18,3 10,18" fill="${color}"/>`,
    diamond:`<polygon points="10,2 18,10 10,18 2,10" fill="${color}"/>`,
    star:`<polygon points="${Array.from({length:10},(_,i)=>{
      const a=-Math.PI/2+i*Math.PI/5, r=i%2?3.7:8;
      return `${(10+r*Math.cos(a)).toFixed(2)},${(10+r*Math.sin(a)).toFixed(2)}`;
    }).join(' ')}" fill="${color}"/>`
  }[magneticSymbol(qIndex).plotly];
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${shape}</svg>`;
}
