import {installTimeState} from './workspace/time-state.js';
import {installTimeRows} from './workspace/time-rows.js';
import {installTimeDrag} from './workspace/time-drag.js';
import {installTimeRowEdit} from './workspace/time-row-edit.js';
import {installTimeParse} from './workspace/time-parse.js';
import {installTimeEstimate} from './workspace/time-estimate.js';
import {installSpiceScript} from './workspace/spice-script.js';
import {installAset} from './workspace/aset.js';
import {installMotionChecks} from './workspace/motion-checks.js';
import {installSpiceValidation} from './workspace/spice-validation.js';

// Time-estimate / SPICE / ASET workspace.  The workspace is one closure split
// into parts under ./workspace/; app-owned geometry/data helpers are injected
// at startup (deps) to avoid duplicating state.

export function createScriptWorkspace(deps){
  // Each part registers the functions other parts need on `fn` and keeps
  // values shared between parts on `ctx.state` (`shared` in the parts); everything else stays private to its file.
  // Parts are installed in the original top-to-bottom order of the former single closure.
  const ctx={deps, state:{}, fn:{}};
  installTimeState(ctx);
  installTimeRows(ctx);
  installTimeDrag(ctx);
  installTimeRowEdit(ctx);
  installTimeParse(ctx);
  installTimeEstimate(ctx);
  installSpiceScript(ctx);
  installAset(ctx);
  installMotionChecks(ctx);
  installSpiceValidation(ctx);
  const fn=ctx.fn;

  return {
    currentGeometryCardTab:fn.currentGeometryCardTab,
    hklInCurrentScatteringPlane:fn.hklInCurrentScatteringPlane,
    initializeScriptUI:fn.initializeScriptUI,
    initializeTimeEstimateUI:fn.initializeTimeEstimateUI,
    mountTimeEstimateForScript:fn.mountTimeEstimateForScript,
    scatteringPlaneWarningMessage:fn.scatteringPlaneWarningMessage,
    setGeometryCardTab:fn.setGeometryCardTab,
    setScatteringPlaneWarning:fn.setScatteringPlaneWarning,
    validateAllTimeScanRows:fn.validateAllTimeScanRows,
  };
}
