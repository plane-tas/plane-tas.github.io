import {installGeometryResultPanel} from './view/result-panel.js';
import {installGeometryRender} from './view/render.js';

// Angle calculation & TAS geometry view.  One closure split into parts under
// ./view/; dependencies are injected by app.js.

export function createTasGeometryView(deps){
  // Each part registers the functions other parts need on `fn` and keeps
  // values shared between parts on `ctx.state` (`shared` in the parts); everything else stays private to its file.
  // Parts are installed in the original top-to-bottom order of the former single closure.
  const ctx={deps, state:{}, fn:{}};
  installGeometryResultPanel(ctx);
  installGeometryRender(ctx);
  const fn=ctx.fn;

  return {
    geometryPointWarnings:fn.geometryPointWarnings,
    updateGeometryTargetVisibility:fn.updateGeometryTargetVisibility,
    renderGeometry:fn.renderGeometry
  };
}
