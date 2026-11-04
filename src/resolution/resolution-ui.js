import {installResolutionInputs} from './ui/inputs.js';
import {installResolutionPlots} from './ui/plots.js';
import {installResolutionCalculation} from './ui/calculation.js';
import {installPowderLink} from './ui/powder-link.js';

// Resolution tab UI.  One closure split into parts under ./ui/; dependencies
// are injected by app.js.

export function createResolutionUI(deps){
  // Each part registers the functions other parts need on `fn` and keeps
  // values shared between parts on `ctx.state` (`shared` in the parts); everything else stays private to its file.
  // Parts are installed in the original top-to-bottom order of the former single closure.
  const ctx={deps, state:{}, fn:{}};
  installResolutionInputs(ctx);
  installResolutionPlots(ctx);
  installResolutionCalculation(ctx);
  installPowderLink(ctx);
  const fn=ctx.fn;

  return {
    buildResolutionLattice:fn.buildResolutionLattice,
    updateAutoW:fn.updateAutoW,
    flipScatteringPlaneUV:fn.flipScatteringPlaneUV,
    collectResolutionBase:fn.collectResolutionBase,
    formatAngle:fn.formatAngle,
    updateResolutionPlaneWarning:fn.updateResolutionPlaneWarning,
    doSingleResolution:fn.doSingleResolution,
    doScanResolution:fn.doScanResolution,
    renderResolutionScan:fn.renderResolutionScan,
    bindResolutionManualCalculation:fn.bindResolutionManualCalculation,
    updatePropagationVectorLabels:fn.updatePropagationVectorLabels,
    powderWavevectors:fn.powderWavevectors,
    setPowderLinkDriver:fn.setPowderLinkDriver,
    syncPowderLinkedInputs:fn.syncPowderLinkedInputs,
    powderGeometryTarget:fn.powderGeometryTarget,
    hasScanResults:()=>ctx.state.scanResults.length>0,
    clearResolutionResults:fn.clearResolutionResults
  };
}
