import {installSelectedCif} from './ui/selected-cif.js';
import {installMcifParentCell} from './ui/mcif-parent-cell.js';
import {installSampleSpaceGroup} from './ui/sample-space-group.js';
import {installGeneratorAtomsState} from './ui/generator-atoms-state.js';
import {installStructureViewerState} from './ui/structure-viewer-state.js';
import {installMagneticEdit} from './ui/magnetic-edit.js';
import {installStructureMath} from './ui/structure-math.js';
import {installAtomAppearance} from './ui/atom-appearance.js';
import {installStructureRender} from './ui/structure-render.js';
import {installStructureCamera} from './ui/structure-camera.js';
import {installUnitCell} from './ui/unit-cell.js';
import {installAtomTable} from './ui/atom-table.js';
import {installSpinTable} from './ui/spin-table.js';
import {installBondRules} from './ui/bond-rules.js';
import {installStructureTraces} from './ui/structure-traces.js';
import {installMomentTraces} from './ui/moment-traces.js';
import {installViewerControls} from './ui/viewer-controls.js';
import {installGeneratorCell} from './ui/generator-cell.js';
import {installGeneratorAtoms} from './ui/generator-atoms.js';
import {installGeneratorBuild} from './ui/generator-build.js';
import {installNuclearReflections} from './ui/nuclear-reflections.js';
import {installLiveSync} from './ui/live-sync.js';
import {installMagneticReflections} from './ui/magnetic-reflections.js';
import {installReflectionTable} from './ui/reflection-table.js';
import {installGeneratorOutput} from './ui/generator-output.js';
import {installMcifGenerator} from './ui/mcif-generator.js';
import {installGeneratorInit} from './ui/generator-init.js';

// Extracted from app.js without changing calculation/display behavior.
// Dependencies are injected by app.js to keep module boundaries explicit.
// The implementation is split by feature into ./cif-ui/*.js.

export function createCifUI(deps){
  // Each part registers the functions other parts need on `fn` and keeps
  // values shared between parts on `cifState`; everything else stays private to its file.
  // Parts are installed in the original top-to-bottom order of the former single closure.
  const ctx={deps, state:{}, fn:{}};
  installSelectedCif(ctx);
  installMcifParentCell(ctx);
  installSampleSpaceGroup(ctx);
  installGeneratorAtomsState(ctx);
  installStructureViewerState(ctx);
  installMagneticEdit(ctx);
  installStructureMath(ctx);
  installAtomAppearance(ctx);
  installStructureRender(ctx);
  installStructureCamera(ctx);
  installUnitCell(ctx);
  installAtomTable(ctx);
  installSpinTable(ctx);
  installBondRules(ctx);
  installStructureTraces(ctx);
  installMomentTraces(ctx);
  installViewerControls(ctx);
  installGeneratorCell(ctx);
  installGeneratorAtoms(ctx);
  installGeneratorBuild(ctx);
  installNuclearReflections(ctx);
  installLiveSync(ctx);
  installMagneticReflections(ctx);
  installReflectionTable(ctx);
  installGeneratorOutput(ctx);
  installMcifGenerator(ctx);
  installGeneratorInit(ctx);
  const fn=ctx.fn;

  fn.initMcifGeneratorActions();
  fn.initializeUnifiedOutputActions();
  // v59: All four output tabs are wired together during initializeCifGenerator.

  // Saved settings (e.g. λ/2, along U/V, within S2 max, beam) are written back
  // into the controls WITHOUT change events after initializeCifGenerator() has
  // already filled the tables. app.js calls this once every restore is done so
  // the tables always reflect the restored conditions.
  function refreshAfterStateRestore(){
    fn.recalculateGeneratedReflections();
  }

  return {
    updateCifUI:fn.updateCifUI,
    syncSfColorMaxControl:fn.syncSfColorMaxControl,
    selectCifFile:fn.selectCifFile,
    clearSelectedCif:fn.clearSelectedCif,
    centeringFromSpaceGroup:fn.centeringFromSpaceGroup,
    selectedSampleSpaceGroup:fn.selectedSampleSpaceGroup,
    selectedSampleCentering:fn.selectedSampleCentering,
    setCifOutputTab:fn.setCifOutputTab,
    initializeCifGenerator:fn.initializeCifGenerator,
    nuclearStructureForSelectedCif:fn.nuclearStructureForSelectedCif,
    refreshAfterStateRestore
  };
}
