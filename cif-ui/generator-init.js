// CIF Generator startup (space-group data, restore) and event wiring.
// Part of the CIF/Structure UI (see ../cif-ui.js for how the parts are wired).
export function installGeneratorInit(ctx){
  const {deps:{
    $, getSelectedCifFileName, getSelectedCifStructure, getSelectedCifText, updateModeVisibility
  }, state:cifState, fn}=ctx;
  Object.assign(fn,{
    initializeCifGenerator
  });

async function initializeCifGenerator(){
  const select=$("cifSpaceGroup");
  if(!select) return;
  cifState.restoringCifStartup=true;
  try{
    const response=await fetch("space-groups.json",{cache:"no-store"});
    if(!response.ok) throw new Error(`space-groups.json returned HTTP ${response.status}`);
    const data=await response.json();
    cifState.cifSpaceGroups=Array.isArray(data) ? data : data.space_groups;
    if(!Array.isArray(cifState.cifSpaceGroups) || cifState.cifSpaceGroups.length!==230) throw new Error("space-groups.json does not contain the expected 230 standard space groups.");
    fn.populateSampleSpaceGroupControls();
    if($("cifCrystalSystem")) $("cifCrystalSystem").value="custom";
    fn.populateCifSpaceGroupOptions(1);
    if(!getSelectedCifStructure()) fn.restoreSelectedCifLocal();
    // Keep the editor's own initial cell until a structure is loaded.
    // A bootstrap placeholder must not overwrite a saved editor draft
    // before restoreCifGeneratorAtomsState() has had a chance to read it.
    cifState.restoringCifGeneratorAtoms=true;
    try{fn.addCifAtomRow({element:"",x:0,y:0,z:0,occupancy:1},{invalidate:false});}
    finally{cifState.restoringCifGeneratorAtoms=false;}
    fn.updateCifSpaceGroupInfo();
    fn.syncCifReflectionBeamFromInstrument();
    if(getSelectedCifStructure()){
      const loaded=getSelectedCifStructure(),source=getSelectedCifText();
      fn.loadParsedCifIntoGenerator(fn.crystallographicStructureFromMcif(loaded,source)||loaded,
        getSelectedCifFileName()||"selected_structure.cif",{message:false});
      fn.updateImportedUnitCellPanels(loaded,source);
    }
    // Current, user-edited values win on a normal reload. New-file imports
    // are separately handled by loadCifText(..., {persist:true}).
    fn.restoreCifGeneratorAtomsState();
    fn.restoreMagneticCellDraft();
    fn.initializePositionTableToolbar();
    fn.bindMagneticCellEditor();
    // Keep the generator cell, symmetry choice and title together with atomic
    // rows. Programmatic constraint updates settle before the change handler.
    for(const id of [...Object.values(cifState.CIF_LATTICE_FIELDS),'cifCrystalSystem',
      'cifSpaceGroup','cifSpaceGroupNumber','cifGeneratedName']){
      const field=$(id);
      if(!field || field.dataset.draftSaveBound)continue;
      field.dataset.draftSaveBound='1';
      field.addEventListener('input',()=>fn.saveCifGeneratorAtomsState());
      field.addEventListener('change',()=>fn.saveCifGeneratorAtomsState());
    }

    fn.setCifGeneratedReady(false);
    // Explicit startup synchronization: assigning select.value never fires
    // a change event, and downstream generic persistence must not own it.
    $("cifOutputFormat")?.dispatchEvent(new Event("change"));
    fn.recalculateGeneratedReflections();
    fn.setUnifiedGeneratorOutputTab(fn.readSavedGeneratorOutputTab());
    cifState.generatorOutputTabRestored=true;
    fn.restoreStructureViewerState();
    // The loaded CIF/mCIF is authoritative after ALL editor/viewer restores.
    // The saved sidebar settings may predate the file import, and the editor
    // may initially start in Custom. Align both SG controls to the file.
    const restoredFileGroup=getSelectedCifStructure() &&
      fn.findGeneratorSpaceGroup(fn.crystallographicStructureFromMcif(getSelectedCifStructure(),getSelectedCifText())||getSelectedCifStructure());
    if(restoredFileGroup){
      fn.setSampleSpaceGroup(restoredFileGroup.number,{recalc:false});
      // Leave the restored editor draft authoritative; only synchronize Sample.
      fn.updateCifSpaceGroupInfo();
    }

    select.addEventListener("change",fn.updateCifSpaceGroupInfo);
    $("cifCrystalSystem")?.addEventListener("change",()=>{
      const before=Number(select.value);
      const selected=fn.populateCifSpaceGroupOptions(before);
      fn.updateCifSpaceGroupInfo();
      if(selected?.number!==before){
        // A new System may select a different group. Reuse the existing
        // change listeners for Sample synchronization and recalculation.
        select.dispatchEvent(new Event("change",{bubbles:true}));
        fn.invalidateGeneratedCif("");
      }
    });
    fn.bindSpaceGroupIntegerEntry($("cifSpaceGroupNumber"));
    $("cifSpaceGroupNumber")?.addEventListener("change",fn.jumpToCifSpaceGroupNumber);
    $("cifSpaceGroupNumber")?.addEventListener("keydown",ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); fn.jumpToCifSpaceGroupNumber(); } });
    // Cell synchronization applies constraints on change, not each keystroke.
    $("cifGeneratedName")?.addEventListener("change",()=>{
      $("cifGeneratedName").value=fn.cleanCifBaseName($("cifGeneratedName").value);
      fn.invalidateGeneratedMcif();
    });

    // Any structure-input edit invalidates the reviewed/generated snapshot.
    // Download/Set therefore always operate on exactly what the user last reviewed.
    const inputPane=document.querySelector(".cif-generator-input-pane");
    const outputPane=document.querySelector(".cif-generator-output-pane");

    // Keep the CIF output frame equal to the actual Structure input frame on
    // desktop.  The output content itself remains scrollable; generated CIF
    // text / reflection rows must never grow the outer workspace.
    const syncCifOutputPaneHeight=()=>{
      if(!inputPane || !outputPane) return;
      if(window.matchMedia("(max-width: 1180px)").matches){
        outputPane.style.height="";
        return;
      }
      const h=Math.ceil(inputPane.getBoundingClientRect().height);
      if(h>0) outputPane.style.height=`${h}px`;
    };
    if(typeof ResizeObserver!=="undefined" && inputPane){
      const cifInputResizeObserver=new ResizeObserver(syncCifOutputPaneHeight);
      cifInputResizeObserver.observe(inputPane);
    }
    window.addEventListener("resize",syncCifOutputPaneHeight);
    requestAnimationFrame(syncCifOutputPaneHeight);

    const physicalEditorChanged=ev=>{
      const target=ev.target;
      if(!target) return;
      const physical=target.closest?.('#cifAtomRows, #cifAtomDetailedRows') ||
        ['cifSpaceGroup','cifSpaceGroupNumber','cifA','cifB','cifC','cifAlpha','cifBeta','cifGamma'].includes(target.id);
      if(!physical) return;
      // Crystallographic inputs have their own direct listeners below.  The
      // delegated handler only invalidates the draft / schedules calculations.
      cifState.liveNuclearCellReference="editor";
      fn.updateLiveEditorNuclearSource();
      fn.scheduleLiveReflectionRecalc({nuclear:true,magnetic:true});
    };
    // Directly bind the editable Cell fields.  Delegated change handling alone
    // proved unreliable when the editor is switched/rebuilt or another field
    // contains an incomplete numeric entry.
    const onEditorCellInput=ev=>{
      const id=ev.currentTarget?.id || ev.target?.id || "";
      fn.syncCrystallographicCell("editor",{refresh:true,changedId:id,commit:ev.type==="change"});
    };
    for(const id of ["cifA","cifB","cifC","cifAlpha","cifBeta","cifGamma"]){
      $(id)?.addEventListener("input",onEditorCellInput);
      $(id)?.addEventListener("change",onEditorCellInput);
    }
    for(const id of ["cifSpaceGroup","cifSpaceGroupNumber"]){
      $(id)?.addEventListener("change",onEditorCellInput);
    }
    inputPane?.addEventListener("input",ev=>{
      // Magnetic-cell parameters are a separate draft. Do not switch the
      // nuclear editor/Structure source to a generated CIF when editing them.
      if(ev.target?.id?.startsWith('cifMag') ||
         ['cifPositionEditingMode','cifPositionTableElement'].includes(ev.target?.id))return;
      physicalEditorChanged(ev);
      if(["cifLoadFile","cifReflectionEnergy","cifReflectionWavelength","cifReflectionWavevector"].includes(ev.target?.id)) return;
      if(cifState.cifStructureSourcePreference==="loaded") cifState.cifStructureSourcePreference="generated";
      fn.invalidateGeneratedCif();
      fn.renderCifStructureIfVisible();
    });
    inputPane?.addEventListener("change",ev=>{
      // Magnetic-cell parameters are a separate draft. Do not switch the
      // nuclear editor/Structure source to a generated CIF when editing them.
      if(ev.target?.id?.startsWith('cifMag') ||
         ['cifPositionEditingMode','cifPositionTableElement'].includes(ev.target?.id))return;
      physicalEditorChanged(ev);
      if(["cifLoadFile","cifReflectionEnergy","cifReflectionWavelength","cifReflectionWavevector"].includes(ev.target?.id)) return;
      if(cifState.cifStructureSourcePreference==="loaded") cifState.cifStructureSourcePreference="generated";
      fn.invalidateGeneratedCif();
      fn.renderCifStructureIfVisible();
    });

    $("cifReloadCurrent")?.addEventListener("click",()=>{
      const text=getSelectedCifText(),name=getSelectedCifFileName()||'selected_structure.cif';
      if(!text){fn.setCifGeneratorMessage('No source CIF/mCIF is available to reload.',true);return;}
      try{
        fn.loadCifText(text,name,{persist:true});
        fn.updateImportedUnitCellPanels(getSelectedCifStructure(),getSelectedCifText());
        fn.setCifGeneratorMessage(`Reloaded the original ${name}.`);
      }catch(err){fn.setCifGeneratorMessage(err?.message||String(err),true);}
    });
    $("cifShowCurrent")?.addEventListener("click",()=>{
      const text=getSelectedCifText();
      if(!text){fn.setCifGeneratorMessage("No current CIF/mCIF is selected.",true);return;}
      const fileName=getSelectedCifFileName()||"selected CIF/mCIF";
      fn.showUnifiedCifPreview(text,`Loaded file: ${fileName}`);
      fn.setCifGeneratorMessage(`Showing loaded file: ${fileName}.`);
    });
    $("cifShowGenerated")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const text=mcif?cifState.lastGeneratedMcifText:cifState.lastGeneratedCifText;
      const fileName=mcif?cifState.lastGeneratedMcifName:cifState.lastGeneratedCifName;
      if(!text){fn.setCifGeneratorMessage(`Generate ${mcif?"mCIF":"CIF"} first to show its output.`,true);return;}
      fn.showUnifiedCifPreview(text,`Generated file: ${fileName}`);
      fn.setCifGeneratorMessage(`Showing generated file: ${fileName}.`);
    });
    $("cifCopyAtom")?.addEventListener("click",fn.copySelectedCifAtomRows);
    $("cifRemoveAtom")?.addEventListener("click",fn.removeSelectedCifAtomRows);
    $("cifAddAtom")?.addEventListener("click",()=>fn.addCifAtomRow());
    $("cifLoadExisting")?.addEventListener("click",()=>$("cifLoadFile")?.click());
    // Clear is shared, too: all three filename fields and attenuation reset.
    $("cifGeneratorSourceClear")?.addEventListener("click",fn.clearSelectedCif);
    $("cifLoadFile")?.addEventListener("change",async ev=>{
      const file=ev.target.files?.[0];
      try{ await fn.loadCifIntoGenerator(file); }
      catch(err){ fn.setCifGeneratorMessage(err?.message||String(err),true); }
      finally{ ev.target.value=""; }
    });

    $("cifOutputGenerate")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const nameInput=$("cifGeneratedName");
      const previousName=nameInput?.value ?? "generated_structure";
      if(nameInput) nameInput.value=fn.nextCifGeneratedBaseName(previousName);
      try{ if(mcif) fn.generateP1McifForReview(); else fn.generateCifForReview(); }
      catch(err){
        if(nameInput) nameInput.value=previousName;
        if(mcif) fn.invalidateGeneratedMcif(); else fn.invalidateGeneratedCif("");
        fn.setCifGeneratorMessage(err?.message||String(err),true);
      }
    });
    $("cifOutputDownload")?.addEventListener("click",()=>{
      const mcif=$("cifOutputFormat")?.value==="mcif";
      const text=mcif?cifState.lastGeneratedMcifText:cifState.lastGeneratedCifText;
      const name=mcif?cifState.lastGeneratedMcifName:cifState.lastGeneratedCifName;
      if(!text){ fn.setCifGeneratorMessage("Press Generate before downloading.",true); return; }
      fn.downloadGeneratedCif(text,name);
      fn.setCifGeneratorMessage(`Downloaded ${name}.`);
    });
    $("cifDownloadTable")?.addEventListener("click",()=>{
      try{ fn.downloadCifReflectionTable(); }
      catch(err){ fn.setCifGeneratorMessage(err?.message||String(err),true); }
    });
    $("cifOutputSet")?.addEventListener("click",()=>{
      try{
        const mcif=$("cifOutputFormat")?.value==="mcif";
        const text=mcif?cifState.lastGeneratedMcifText:cifState.lastGeneratedCifText;
        const name=mcif?cifState.lastGeneratedMcifName:cifState.lastGeneratedCifName;
        if(!text) throw new Error(`Press Generate before setting the ${mcif?"mCIF":"CIF"}.`);
        if($("sampleMode")?.value!=="single"){
          $("sampleMode").value="single"; updateModeVisibility();
        }
        const parsed=fn.loadCifText(text,name);
        cifState.cifStructureSourcePreference="selected";
        fn.saveStructureViewerState();
        fn.renderCifStructureIfVisible();
        fn.setCifGeneratorMessage(`Set ${name} as the selected ${mcif?"mCIF":"CIF"}: ${parsed.atoms.length} expanded atom(s).`);
      }catch(err){ fn.setCifGeneratorMessage(err?.message||String(err),true); }
    });

    for(const button of document.querySelectorAll("[data-generator-output-tab]")){
      button.addEventListener("click",()=>fn.setUnifiedGeneratorOutputTab(button.dataset.generatorOutputTab,{persist:true}));
    }
    // Only Nuclear can be selected until magnetic reflections are validated.
    $('generatorReflectionsNuclear')?.addEventListener('click',()=>fn.setGeneratorReflectionMode('nuclear'));
    // Attach the actual Calculate / CSV / BNS buttons. The magnetic pane can
    // be visible without these listeners if only the tab switch is wired.
    fn.initializeMagneticReflections();
    fn.initializeGeneratorTableOutsideClick();
    let savedReflectionMode='nuclear';
    try{savedReflectionMode=localStorage.getItem(cifState.GENERATOR_REFLECTION_MODE_KEY)||'nuclear';}catch(_e){}
    fn.setGeneratorReflectionMode(savedReflectionMode);
    $("tabCifGenerator")?.addEventListener("click",()=>requestAnimationFrame(fn.renderCifStructureIfVisible));
    if($("cifSaveFigure")) $("cifSaveFigure").onclick=()=>fn.saveStructureFigure().catch(err=>{alert(`Save figure failed: ${err?.message||err}`);});
    
    const unitCellSelect=$("cifUnitCellMode");
    if(unitCellSelect){ unitCellSelect.value=cifState.structureUnitCellMode; unitCellSelect.addEventListener("change",()=>{ cifState.structureUnitCellMode=unitCellSelect.value; fn.saveStructureViewerState(); fn.renderCifStructureIfVisible(); }); }
    const cellReferenceSelect=$("cifUnitCellReference");
    if(cellReferenceSelect){ cellReferenceSelect.value=cifState.structureUnitCellReference;
      cellReferenceSelect.addEventListener("change",()=>{
        cifState.structureUnitCellReference=cellReferenceSelect.value==="magnetic"?"magnetic":"crystallographic";
        fn.updateStructureUnitCellReference(fn.currentStructureForViewer());
        fn.saveStructureViewerState();fn.renderCifStructureIfVisible();
      });
    }
    const xyzSelect=$("cifShowXYZ");
    if(xyzSelect){ xyzSelect.value=cifState.structureShowXYZ?"show":"hide"; xyzSelect.addEventListener("change",()=>{ cifState.structureShowXYZ=xyzSelect.value!=="hide"; fn.saveStructureViewerState(); fn.renderCifStructureIfVisible(); }); }
    $("structureCifSelect")?.addEventListener("click",()=>$("cifFileInput")?.click());
    $("structureCifClear")?.addEventListener("click",fn.clearSelectedCif);
    for(const button of document.querySelectorAll("[data-cif-structure-view]")){
      button.addEventListener("click",()=>{
        cifState.cifStructureViewMode=button.dataset.cifStructureView || "a";
        cifState.structureCameraPresetRevision++;
        // Prevent the old WebGL camera from overwriting this preset while the
        // replacement Plotly scene is being prepared.
        fn.stopStructureCameraWatch();
        cifState.structureProgrammaticCameraUpdate=true;
        const source=fn.currentStructureForViewer();
        const basis=fn.directLatticeBasis(source?.structure?.lattice);
        if(basis){
          // IMPORTANT: do not apply a preset view with Plotly.relayout().
          // In Plotly gl3d that can leave the live WebGL camera detached from
          // _fullLayout.scene.camera until the next Plotly.react() (for example
          // after editing x/y/z range).  The coordinate triads then see a stale
          // camera and appear frozen.  Store the requested camera and rebuild the
          // scene through the same Plotly.react() path used by normal viewer
          // redraws so the live camera and layout camera stay synchronized.
          const camera=fn.structureCameraForView(cifState.cifStructureViewMode,basis,fn.currentStructureCameraDistance());
          cifState.structureCameraState=fn.copyStructureCamera(camera);
          cifState.structureCameraWatchSignature="";
          fn.updateStructureOrientationTriads(basis,camera);
        }
        fn.saveStructureViewerState();
        fn.renderCifStructureView();
      });
    }
    fn.prepareStructureViewerControls();
    // Changing display mode must rebuild the geometry immediately.
    fn.syncStructureBondDisplayModeControls();
    for(const input of document.querySelectorAll('input[name="cifStructureStyle"]')){
      if(input.dataset.styleModeBound)continue;
      input.dataset.styleModeBound='1';
      input.addEventListener('change',()=>{
        if(!input.checked)return;
        cifState.structureBondDisplayMode=['bonds','polyhedral','both'].includes(input.value)?input.value:'bonds';
        fn.saveStructureViewerState();
        fn.renderCifStructureIfVisible();
      });
    }
    const styleBulkToggle=$("cifStyleBulkCheckbox");
    if(styleBulkToggle && !styleBulkToggle.dataset.structureBound){
      styleBulkToggle.dataset.structureBound="1";
      styleBulkToggle.addEventListener("change",()=>fn.setAllStructureBondRulesVisible(styleBulkToggle.checked));
    }
    $("cifAddBondRule")?.addEventListener("click",()=>fn.addStructureBondRule());
    $("cifCopyBondRule")?.addEventListener("click",fn.copySelectedStructureBondRules);
    $("cifRemoveBondRule")?.addEventListener("click",fn.removeSelectedStructureBondRules);
    // Split range controls bind themselves in createSplitRangeControls(). The
    // legacy combined inputs stay hidden and synchronized only for saved-state
    // compatibility; do not attach redraw handlers to them.
    const propagationStructureRefresh=()=>{ fn.refreshMomentPropagationVectorSelect(); fn.saveStructureViewerState(); fn.renderCifStructureIfVisible(); };
    $("propagationVectors")?.addEventListener("input",propagationStructureRefresh);
    $("propagationVectors")?.addEventListener("change",()=>{
      if(cifState.structureSpinEditingMode==='individual'){
        for(const [key,value] of fn.currentMomentSettings())cifState.structureMomentSettings.set(key,value);
        $('cifMagMomentRows')?.replaceChildren();
        fn.updateMagneticMomentRows(fn.currentStructureForViewer()?.structure||null);
      }
      propagationStructureRefresh();
    });
    $("propagationVectors")?.addEventListener("click",()=>requestAnimationFrame(propagationStructureRefresh));
    $("addPropagationVector")?.addEventListener("click",()=>requestAnimationFrame(propagationStructureRefresh));
    for(const th of document.querySelectorAll(".cif-sortable-th:not(.magnetic-sortable-th)")){
      const activate=()=>fn.setCifReflectionSort(th.dataset.sortKey);
      th.addEventListener("click",activate);
      th.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();activate();}});
    }
    fn.updateCifReflectionSortHeaders();
    const reflectionFilterIds=[
      "cifReflectionAlongU","cifReflectionAlongV",
      "cifReflectionWithinS2Max","cifReflectionLambdaHalf"
    ];
    for(const id of reflectionFilterIds){
      $(id)?.addEventListener("change",fn.recalculateGeneratedReflections);
    }
    $("cifReflectionEnergy")?.addEventListener("change",()=>fn.syncCifReflectionBeamFrom("energy"));
    $("cifReflectionWavelength")?.addEventListener("change",()=>fn.syncCifReflectionBeamFrom("wavelength"));
    $("cifReflectionWavevector")?.addEventListener("change",()=>fn.syncCifReflectionBeamFrom("wavevector"));
    // Instrument configuration supplies the default Generator beam condition.
    const syncGeneratorBeam=()=>{ fn.syncCifReflectionBeamFromInstrument(); fn.recalculateGeneratedReflections(); };
    $("energy")?.addEventListener("input",syncGeneratorBeam);
    $("energy")?.addEventListener("change",syncGeneratorBeam);
    $("energyMode")?.addEventListener("change",syncGeneratorBeam);
    $("instrument")?.addEventListener("change",syncGeneratorBeam);
    $("S2maxUser")?.addEventListener("change",fn.recalculateGeneratedReflections);
    $("S2maxEffective")?.addEventListener("change",fn.recalculateGeneratedReflections);
    // Synchronize both crystallographic panels, then recompute nuclear peaks.
    const onSampleLatticeInput=ev=>fn.syncCrystallographicCell("sample",{changedId:ev.target?.id||"",commit:ev.type==="change"});
    for(const id of ['a','b','c','alpha','beta','gamma']){
      $(id)?.addEventListener('input',onSampleLatticeInput);
      $(id)?.addEventListener('change',onSampleLatticeInput);
    }
    for(const id of ['sampleSpaceGroup','sampleSpaceGroupNumber']){
      $(id)?.addEventListener('change',onSampleLatticeInput);
    }
    // Positions is a sibling of .cif-generator-input-pane in the unified UI,
    // so inputPane's delegated listeners never receive its input/change events.
    // Bind directly to stable row containers; their child rows are rebuilt on
    // import, paste, copy and deletion.
    const onLivePositionsEdit=event=>{
      if(!event.target?.matches?.('input, select')) return;
      cifState.liveNuclearCellReference="editor";
      fn.updateLiveEditorNuclearSource();
      fn.scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
    };
    for(const id of ["cifAtomRows","cifAtomDetailedRows"]){
      const host=$(id);
      if(host && !host.dataset.nuclearLiveBound){
        host.addEventListener("input",onLivePositionsEdit);
        host.addEventListener("change",onLivePositionsEdit);
        host.dataset.nuclearLiveBound="1";
      }
    }
    // Structural row operations do not necessarily emit an input/change event.
    // Rebuild the calculation snapshot after the click handler mutates rows.
    for(const id of ["cifAddAtom","cifRemoveAtom","cifCopyAtom"]){
      const button=$(id);
      if(button && !button.dataset.nuclearLiveBound){
        button.addEventListener("click",()=>requestAnimationFrame(()=>{
          cifState.liveNuclearCellReference="editor";
          fn.updateLiveEditorNuclearSource();
          fn.scheduleLiveReflectionRecalc({nuclear:true,magnetic:false});
        }));
        button.dataset.nuclearLiveBound="1";
      }
    }
    // Atoms settings can affect displayed structure; keep the nuclear table in
    // step even when controls are rebuilt dynamically. Pure color changes do
    // not alter physical intensities, but are harmlessly coalesced here.
    $("cifAtomColorRows")?.addEventListener("change",()=>fn.scheduleLiveReflectionRecalc({nuclear:true,magnetic:false}));
    // Spins, propagation vector and structure type only affect magnetic peaks.
    // Recalculate automatically only once a magnetic table has been requested.
    const requestMagneticUpdate=()=>fn.scheduleLiveReflectionRecalc({nuclear:false,magnetic:true});
    for(const id of ['cifMagMomentRows','cifMomentStructureType','cifMomentRotationAxis',
      'cifMomentChirality','cifMomentPropagationVector',
      'cifSpinEditingMode','propagationVectors']){
      $(id)?.addEventListener('input',requestMagneticUpdate);
      $(id)?.addEventListener('change',requestMagneticUpdate);
    }
    for(const id of ["Uh","Uk","Ul","Vh","Vk","Vl"]){
      $(id)?.addEventListener("change",fn.recalculateGeneratedReflections);
    }
    requestAnimationFrame(fn.renderCifStructureIfVisible);
  }catch(err){
    select.innerHTML='<option value="">Space-group data unavailable</option>';
    for(const id of ["cifLoadExisting","cifOutputGenerate","cifOutputDownload","cifDownloadTable","cifOutputSet","cifSpaceGroupNumber"]){ if($(id)) $(id).disabled=true; }
    fn.setCifGeneratorMessage(`CIF Generator could not load space-group data: ${err?.message||String(err)}`,true);
  }finally{
    // The whole asynchronous startup is finished: subsequent real edits
    // must be written immediately, whereas initialization writes were barred.
    cifState.restoringCifStartup=false;
  }
}
}
