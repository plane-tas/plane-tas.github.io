// S2 range of an instrument file (see instrument-setup.js for how the page
// uses it): ends as rows of (M2 or Ei, S2) readings for the file's Sense
// and S1 sign.
import {readTasSense, tasConvention} from '../core/tas-conventions.js';

export function s2EndRows(v){
  if(Array.isArray(v)) return v.map(r=>({M2:r.M2,Ei:r.Ei,S2:Number(r.S2 ?? r.S2limit)})).filter(r=>Number.isFinite(r.S2));
  const x=Number(v);
  return v!==undefined && v!==null && v!=='' && Number.isFinite(x) ? [{M2:0,S2:x},{M2:180,S2:x}] : [];
}
export function fileTasConvention(inst){
  const cfg=(!Array.isArray(inst?.configuration) && inst?.configuration) ? inst.configuration : {};
  try{ return tasConvention(readTasSense(cfg.sense ?? inst?.sense ?? "-+-",cfg.geometry ?? inst?.geometry),cfg.s_sign ?? cfg.s1sign ?? inst?.s_sign ?? inst?.s1sign ?? "ccw"); }
  catch(_e){ return tasConvention("-+-","ccw"); }
}
export function s2FileRange(inst){
  const qr=inst?.qe_range||{};
  if(inst?.S2_max!==undefined || qr.S2_max!==undefined){
    const lo=s2EndRows(qr.S2_min ?? inst.S2_min), hi=s2EndRows(qr.S2_max ?? inst.S2_max);
    return {ends:[lo,hi].filter(r=>r.length)};
  }
  // Older files: the side of the file's Sense, from |S2_min| to the table.
  const table=Array.isArray(inst?.S2_limits) ? inst.S2_limits : Array.isArray(qr.S2_limits) ? qr.S2_limits
    : Array.isArray(qr.configuration) ? qr.configuration : Array.isArray(inst?.configuration) ? inst.configuration : null;
  if(!table) return {ends:[]};
  const side=fileTasConvention(inst).s2EncoderSign<0 ? -1 : 1;
  const far=s2EndRows(table).map(r=>({...r,S2:side*Math.abs(r.S2)}));
  const nearValue=Number(qr.S2_min ?? inst.S2_min ?? inst.default_S2min ?? 8);
  const near=s2EndRows(side*Math.abs(Number.isFinite(nearValue) ? nearValue : 8));
  return {ends:[near,far]};
}
