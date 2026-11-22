// A number as written in entry boxes and legends: at most d decimals, without
// trailing zeros and never "-0" (NaN stays "NaN").
export function fixedText(x,d=4){
  const v=Number(Number(x).toFixed(d));
  return String(Object.is(v,-0) ? 0 : v);
}
