import {installGeometryScanPanel} from './view/scan-panel.js';
import {installGeometryRender} from './view/render.js';

// Angle calculation & TAS geometry view.  One closure split into parts under
// ./view/; dependencies are injected by app.js.

export function createTasGeometryView(deps){
  // Each part registers the functions other parts need on `fn` and keeps
  // values shared between parts on `ctx.state` (`shared` in the parts); everything else stays private to its file.
  // Parts are installed in the original top-to-bottom order of the former single closure.
  const ctx={deps, state:{}, fn:{}};
  installGeometryScanPanel(ctx);
  installGeometryRender(ctx);
  const fn=ctx.fn;

  return {
    geometryCalculationMode:fn.geometryCalculationMode,
    geometryPointWarnings:fn.geometryPointWarnings,
    currentGeometryScanOutputTab:fn.currentGeometryScanOutputTab,
    setGeometryScanOutputTab:fn.setGeometryScanOutputTab,
    setGeometryCalculationMode:fn.setGeometryCalculationMode,
    updateGeometryCalculationModeVisibility:fn.updateGeometryCalculationModeVisibility,
    renderGeometry:fn.renderGeometry
  };
}
