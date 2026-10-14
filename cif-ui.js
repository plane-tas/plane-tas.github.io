import {installSelectedCif} from './cif-ui/selected-cif.js';
import {installMcifParentCell} from './cif-ui/mcif-parent-cell.js';
import {installSampleSpaceGroup} from './cif-ui/sample-space-group.js';
import {installGeneratorAtomsState} from './cif-ui/generator-atoms-state.js';
import {installStructureViewerState} from './cif-ui/structure-viewer-state.js';
import {installMagneticEdit} from './cif-ui/magnetic-edit.js';
import {installStructureMath} from './cif-ui/structure-math.js';
import {installAtomAppearance} from './cif-ui/atom-appearance.js';
import {installStructureRender} from './cif-ui/structure-render.js';
import {installStructureCamera} from './cif-ui/structure-camera.js';
import {installUnitCell} from './cif-ui/unit-cell.js';
import {installAtomTable} from './cif-ui/atom-table.js';
import {installSpinTable} from './cif-ui/spin-table.js';
import {installBondRules} from './cif-ui/bond-rules.js';
import {installStructureTraces} from './cif-ui/structure-traces.js';
import {installMomentTraces} from './cif-ui/moment-traces.js';
import {installViewerControls} from './cif-ui/viewer-controls.js';
import {installGeneratorCell} from './cif-ui/generator-cell.js';
import {installGeneratorAtoms} from './cif-ui/generator-atoms.js';
import {installGeneratorBuild} from './cif-ui/generator-build.js';
import {installNuclearReflections} from './cif-ui/nuclear-reflections.js';
import {installLiveSync} from './cif-ui/live-sync.js';
import {installMagneticReflectionsTable} from './cif-ui/magnetic-reflections-table.js';
import {installGeneratorOutput} from './cif-ui/generator-output.js';
import {installMcifGenerator} from './cif-ui/mcif-generator.js';
import {installGeneratorInit} from './cif-ui/generator-init.js';

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
  installMagneticReflectionsTable(ctx);
  installGeneratorOutput(ctx);
  installMcifGenerator(ctx);
  installGeneratorInit(ctx);
  const fn=ctx.fn;

  fn.initMcifGeneratorActions();
  fn.initializeUnifiedOutputActions();
  // v59: All four output tabs are wired together during initializeCifGenerator.

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
    nuclearStructureForSelectedCif:fn.nuclearStructureForSelectedCif
  };
}
