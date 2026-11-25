// Analyzer in the beam or not (2-axis / 3-axis).
//
// The analyzer selector (Resolution "anaCrystal", mirrored by the sidebar
// "Ana") offers "none" for TAS and 4-circle; a diffractometer (and a Larmor
// diffractometer) has no analyzer ("none", fixed); a multiplexing instrument
// always has its analyzers.  Without an analyzer only elastic scattering is
// measured: the whole application behaves as for a diffractometer (ħω = 0,
// no Q vector–E map, no A1 / A2, 2-axis resolution).  A 4-circle measures
// elastic scattering with or without the analyzer.
export const ANALYZER_NONE='none';

export function analyzerSelectionIsNone(){
  return (typeof document!=='undefined' ? document.getElementById('anaCrystal')?.value : '')===ANALYZER_NONE;
}
// The analyzer selector offers "none" for these calculation types.
export function instrumentTypeAllowsNoAnalyzer(inst){
  const type=inst?.instrument_type||'tas';
  return type!=='multiplexing' && inst?.instrument_mode!=='multiplexing';
}
export function instrumentHasAnalyzer(inst){
  if(inst?.instrument_type==='diffractometer') return false;
  if(!instrumentTypeAllowsNoAnalyzer(inst)) return true;
  return !analyzerSelectionIsNone();
}
// Only ħω = 0: no analyzer, or a 4-circle (no energy scans).
export function instrumentIsElasticOnly(inst){
  return inst?.instrument_type==='four-circle' || !instrumentHasAnalyzer(inst);
}
