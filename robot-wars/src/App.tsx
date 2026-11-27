import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import ElectricalWorkspaceView from "./components/electrical/ElectricalWorkspaceView";
import SimulationView from "./components/simulation/SimulationView";
import { ConfirmActionDialog } from "./components/workshop/ConfirmActionDialog";
import PartInspectorPanel from "./components/workshop/PartInspectorPanel";
import { WorkshopHeader } from "./components/workshop/WorkshopHeader";
import { WorkshopLeftPanel } from "./components/workshop/WorkshopLeftPanel";
import { WorkshopStageRightPanel } from "./components/workshop/WorkshopStageRightPanel";
import { WorkshopValidationPanel } from "./components/workshop/WorkshopValidationPanel";
import { WorkshopViewport } from "./components/workshop/WorkshopViewport";
import {
  clearProjectAutosave,
  downloadRobotProjectFile,
  hasProjectAutosave,
  loadProjectAutosave,
  readProjectFileText,
  saveProjectAutosave,
  shouldPersistProjectAutosave,
} from "./features/persistence/logic/projectStorage";
import type { MountCandidate } from "./features/robot-builder/logic/mounting";
import {
  assessDestructivePartDelete,
  handleTabListKeyDown,
} from "./features/robot-builder/logic/uiAccessibility";
import type {
  CameraFocusFrame,
  CameraFocusRequest,
} from "./features/robot-builder/logic/viewportFocus";
import { useWorkshopDerivedState } from "./hooks/useWorkshopDerivedState";
import {
  exportProjectFromStore,
  importProjectIntoStore,
} from "./store/projectStoreAdapter";
import { useRobotStore } from "./store/robotStore";
import "./App.css";

const WORKSHOP_RIGHT_TABS = ["stage", "inspector", "validation"] as const;

function App() {
  const [workspaceMode, setWorkspaceMode] = useState<
    "workshop" | "electrical" | "simulation"
  >("workshop");
  const [mountCandidate, setMountCandidate] = useState<MountCandidate | null>(
    null
  );
  const [cameraFocusRequest, setCameraFocusRequest] =
    useState<CameraFocusRequest>({
      key: 0,
      target: [0, 0.175, 0],
      radius: 1,
    });
  const [rightPanelTab, setRightPanelTab] = useState<
    "stage" | "inspector" | "validation"
  >("stage");
  const [electricalRightTab, setElectricalRightTab] = useState<
    "wiring" | "inspector" | "diagnostics"
  >("wiring");
  const [pendingConfirm, setPendingConfirm] = useState<{
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly tone?: "danger" | "warning";
    readonly onConfirm: () => void;
  } | null>(null);
  const [hasRecoverableAutosave, setHasRecoverableAutosave] = useState<boolean>(
    () => useRobotStore.getState().foundation === null && hasProjectAutosave()
  );
  const [projectNotice, setProjectNotice] = useState<{
    readonly tone: "info" | "warning" | "error";
    readonly text: string;
  } | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const store = useRobotStore(
    useShallow((state) => ({
      projectName: state.projectName,
      selectedArenaId: state.selectedArenaId,
      visualProgram: state.visualProgram,
      projectRevision: state.projectRevision,
      lastProjectLoadWarnings: state.lastProjectLoadWarnings,
      setProjectName: state.setProjectName,
      clearProjectLoadWarnings: state.clearProjectLoadWarnings,
      loadProjectState: state.loadProjectState,
      parts: state.parts,
      hiddenPartIds: state.hiddenPartIds,
      selectedId: state.selectedId,
      transformMode: state.transformMode,
      historyPast: state.historyPast,
      historyFuture: state.historyFuture,
      connections: state.connections,
      electricalConnections: state.electricalConnections,
      selectedElectricalConnectionId: state.selectedElectricalConnectionId,
      selectedElectricalPinId: state.selectedElectricalPinId,
      foundation: state.foundation,
      stage: state.stage,
      drivetrain: state.drivetrain,
      selectedMotorCatalogueId: state.selectedMotorCatalogueId,
      selectedMountZoneId: state.selectedMountZoneId,
      selectedWheelCatalogueId: state.selectedWheelCatalogueId,
      selectedWheelMotorId: state.selectedWheelMotorId,
      selectedWheelDiameterCm: state.selectedWheelDiameterCm,
      selectedWheelWidthCm: state.selectedWheelWidthCm,
      selectedBatteryCatalogueId: state.selectedBatteryCatalogueId,
      selectedControllerCatalogueId: state.selectedControllerCatalogueId,
      selectedStructuralCatalogueId: state.selectedStructuralCatalogueId,
      lastReplacementWarning: state.lastReplacementWarning,
      setSelectedId: state.setSelectedId,
      setTransformMode: state.setTransformMode,
      undo: state.undo,
      redo: state.redo,
      deletePartById: state.deletePartById,
      togglePartVisibility: state.togglePartVisibility,
      mountWheelToMotor: state.mountWheelToMotor,
      setSelectedElectricalConnection: state.setSelectedElectricalConnection,
      focusElectricalDiagnostic: state.focusElectricalDiagnostic,
      installElectricalCatalogueItem: state.installElectricalCatalogueItem,
      replaceElectricalComponent: state.replaceElectricalComponent,
      addElectricalConnection: state.addElectricalConnection,
      updateElectricalConnection: state.updateElectricalConnection,
      assignPinToElectricalConnection: state.assignPinToElectricalConnection,
      assignConnectorToInterface: state.assignConnectorToInterface,
      removeElectricalConnection: state.removeElectricalConnection,
      startNewBuild: state.startNewBuild,
      selectFoundationModel: state.selectFoundationModel,
      updateFoundationDimensions: state.updateFoundationDimensions,
      setFoundationOptions: state.setFoundationOptions,
      confirmFoundation: state.confirmFoundation,
      selectBatteryCatalogueItem: state.selectBatteryCatalogueItem,
      installBattery: state.installBattery,
      removeBattery: state.removeBattery,
      selectControllerCatalogueItem: state.selectControllerCatalogueItem,
      installController: state.installController,
      removeController: state.removeController,
      setStage: state.setStage,
      setDrivetrainType: state.setDrivetrainType,
      setDrivetrainAssignment: state.setDrivetrainAssignment,
      applySuggestedDrivetrainMapping: state.applySuggestedDrivetrainMapping,
      selectMotorCatalogueItem: state.selectMotorCatalogueItem,
      selectMountZone: state.selectMountZone,
      placeMotor: state.placeMotor,
      mountMotorToParent: state.mountMotorToParent,
      replaceMotor: state.replaceMotor,
      removeMotor: state.removeMotor,
      rotateMotor: state.rotateMotor,
      clearReplacementWarning: state.clearReplacementWarning,
      selectWheelCatalogueItem: state.selectWheelCatalogueItem,
      updateSelectedWheelDimensions: state.updateSelectedWheelDimensions,
      selectWheelMotor: state.selectWheelMotor,
      assignWheel: state.assignWheel,
      removeWheel: state.removeWheel,
      finishBuild: state.finishBuild,
      selectStructuralCatalogueItem: state.selectStructuralCatalogueItem,
      addStructuralPart: state.addStructuralPart,
      replaceStructuralPart: state.replaceStructuralPart,
      configureProceduralFoundation: state.configureProceduralFoundation,
      resetProceduralFoundation: state.resetProceduralFoundation,
      importFoundationStl: state.importFoundationStl,
      importStructuralStl: state.importStructuralStl,
      updateImportedPartConfiguration: state.updateImportedPartConfiguration,
      addCustomMountingInterface: state.addCustomMountingInterface,
      removeCustomMountingInterface: state.removeCustomMountingInterface,
      duplicatePart: state.duplicatePart,
      attachPart: state.attachPart,
      detachPart: state.detachPart,
      previewPartTransform: state.previewPartTransform,
      updatePartTransform: state.updatePartTransform,
    }))
  );

  const derived = useWorkshopDerivedState({
    parts: store.parts,
    connections: store.connections,
    electricalConnections: store.electricalConnections,
    hiddenPartIds: store.hiddenPartIds,
    selectedId: store.selectedId,
    foundation: store.foundation,
    drivetrain: store.drivetrain,
    selectedMotorCatalogueId: store.selectedMotorCatalogueId,
    selectedWheelCatalogueId: store.selectedWheelCatalogueId,
    selectedWheelMotorId: store.selectedWheelMotorId,
    selectedBatteryCatalogueId: store.selectedBatteryCatalogueId,
    selectedControllerCatalogueId: store.selectedControllerCatalogueId,
  });

  const requestCameraFocus = (frame: CameraFocusFrame | null) => {
    if (!frame) return;
    setCameraFocusRequest((request) => ({
      ...frame,
      key: request.key + 1,
    }));
  };

  const cancelPendingAutosave = () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  useEffect(() => {
    const latest = useRobotStore.getState();
    if (!shouldPersistProjectAutosave(latest)) {
      cancelPendingAutosave();
      return;
    }
    cancelPendingAutosave();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      const snapshotState = useRobotStore.getState();
      if (!shouldPersistProjectAutosave(snapshotState)) return;
      const project = exportProjectFromStore(snapshotState);
      const res = saveProjectAutosave(project);
      setHasRecoverableAutosave(false);
      if (res.warning) {
        setProjectNotice({
          tone: "warning",
          text: res.warning,
        });
      }
    }, 450);
    return () => {
      cancelPendingAutosave();
    };
  }, [
    store.foundation,
    store.parts,
    store.connections,
    store.electricalConnections,
    store.drivetrain,
    store.stage,
    store.projectName,
    store.selectedArenaId,
    store.visualProgram,
    store.historyPast,
  ]);

  // Flush unsaved project changes synchronously before page unload/hide so edits inside
  // the debounce window are not lost across refreshes or browser navigation.
  useEffect(() => {
    const handleBeforeUnload = () => {
      cancelPendingAutosave();
      const latest = useRobotStore.getState();
      if (!shouldPersistProjectAutosave(latest)) return;
      saveProjectAutosave(exportProjectFromStore(latest));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  const handleSaveProject = () => {
    cancelPendingAutosave();
    const project = exportProjectFromStore(useRobotStore.getState());
    downloadRobotProjectFile(project);
    const res = saveProjectAutosave(project);
    setProjectNotice({
      tone: res.warning ? "warning" : "info",
      text: res.warning
        ? `${res.warning} (Downloaded "${project.metadata.name}".)`
        : `Saved project "${project.metadata.name}" (${project.build.parts.length} parts, ${project.assets.length} STL assets).`,
    });
  };

  const applyLoadResult = (
    result: ReturnType<typeof importProjectIntoStore>,
    sourceLabel: string
  ) => {
    if (!result.success || !result.project) {
      setProjectNotice({
        tone: "error",
        text: result.errors[0] ?? `Failed to load ${sourceLabel}.`,
      });
      return;
    }
    setMountCandidate(null);
    setWorkspaceMode("workshop");
    setRightPanelTab("stage");
    setHasRecoverableAutosave(false);
    setProjectNotice({
      tone: result.warnings.length > 0 ? "warning" : "info",
      text:
        result.warnings.length > 0
          ? `Loaded "${result.project.metadata.name}" with ${result.warnings.length} notice(s): ${result.warnings[0]}`
          : `Loaded project "${result.project.metadata.name}".`,
    });
  };

  const handleImportProjectFile = async (file: File) => {
    try {
      cancelPendingAutosave();
      const rawText = await readProjectFileText(file);
      const result = importProjectIntoStore(rawText);
      applyLoadResult(result, file.name);
    } catch (err) {
      setProjectNotice({
        tone: "error",
        text: err instanceof Error ? err.message : `Unable to read "${file.name}".`,
      });
    }
  };

  const handleRecoverAutosave = () => {
    cancelPendingAutosave();
    const autosaved = loadProjectAutosave();
    if (!autosaved || !autosaved.success) {
      setHasRecoverableAutosave(false);
      setProjectNotice({
        tone: "error",
        text: autosaved?.errors[0] ?? "No valid autosaved project found.",
      });
      return;
    }
    store.loadProjectState(autosaved);
    applyLoadResult(autosaved, "browser autosave");
  };

  const performResetBuild = () => {
    cancelPendingAutosave();
    store.startNewBuild();
    clearProjectAutosave();
    setHasRecoverableAutosave(false);
    setProjectNotice(null);
    setPendingConfirm(null);
  };

  const handleRequestResetBuild = () => {
    setPendingConfirm({
      title: "Start a new build?",
      description:
        "Starting a new build resets the current robot, clears undo history, and discards the browser autosave backup.",
      confirmLabel: "Start New Build",
      tone: "danger",
      onConfirm: performResetBuild,
    });
  };

  const handleRequestDeletePart = (partId: string) => {
    const plan = assessDestructivePartDelete(partId, store.parts, store.connections);
    if (plan) {
      setPendingConfirm({
        ...plan,
        tone: "danger",
        onConfirm: () => {
          setPendingConfirm(null);
          store.deletePartById(partId);
        },
      });
      return;
    }
    store.deletePartById(partId);
  };

  const handleOpenValidation = () => {
    if (workspaceMode === "electrical") {
      setElectricalRightTab("diagnostics");
      return;
    }
    setRightPanelTab("validation");
  };

  if (workspaceMode === "simulation") {
    return (
      <SimulationView
        key={store.projectRevision}
        onExitSimulation={() => setWorkspaceMode("workshop")}
      />
    );
  }

  return (
    <div className="workshop">
      <WorkshopHeader
        projectName={store.projectName}
        workspaceMode={workspaceMode}
        historyPastCount={store.historyPast.length}
        historyFutureCount={store.historyFuture.length}
        validationReport={derived.validationReport}
        electricalConnectionCount={store.electricalConnections.length}
        hasRecoverableAutosave={hasRecoverableAutosave}
        onChangeProjectName={store.setProjectName}
        onSaveProject={handleSaveProject}
        onImportProjectFile={(file) => {
          void handleImportProjectFile(file);
        }}
        onRecoverAutosave={handleRecoverAutosave}
        onDismissRecoverAutosave={() => {
          clearProjectAutosave();
          setHasRecoverableAutosave(false);
        }}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onOpenValidation={handleOpenValidation}
        onSetWorkspaceMode={setWorkspaceMode}
        onResetBuild={handleRequestResetBuild}
      />

      {projectNotice && (
        <div
          className={`project-notice-banner ${projectNotice.tone}`}
          role={projectNotice.tone === "error" ? "alert" : "status"}
        >
          <span>{projectNotice.text}</span>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={() => {
              setProjectNotice(null);
              store.clearProjectLoadWarnings();
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {workspaceMode === "electrical" ? (
        <ElectricalWorkspaceView
          parts={store.parts}
          connections={store.connections}
          foundation={store.foundation}
          electricalConnections={store.electricalConnections}
          validationReport={derived.validationReport}
          selectedId={store.selectedId}
          selectedElectricalConnectionId={store.selectedElectricalConnectionId}
          selectedElectricalPinId={store.selectedElectricalPinId}
          onSelectPart={store.setSelectedId}
          onSelectConnection={store.setSelectedElectricalConnection}
          onFocusDiagnostic={store.focusElectricalDiagnostic}
          onInstallCatalogueItem={store.installElectricalCatalogueItem}
          onReplaceElectricalComponent={store.replaceElectricalComponent}
          onDeletePart={handleRequestDeletePart}
          rightTab={electricalRightTab}
          onRightTabChange={setElectricalRightTab}
          onCreateConnection={store.addElectricalConnection}
          onUpdateConnection={store.updateElectricalConnection}
          onAssignPin={store.assignPinToElectricalConnection}
          onAssignConnector={store.assignConnectorToInterface}
          onRemoveConnection={store.removeElectricalConnection}
          onPreviewTransform={store.previewPartTransform}
          onApplyTransform={store.updatePartTransform}
          onReplaceStructuralPart={store.replaceStructuralPart}
          onDuplicatePart={store.duplicatePart}
          onAttachPart={store.attachPart}
          onDetachPart={store.detachPart}
          onUpdateImportedConfig={store.updateImportedPartConfiguration}
          onAddCustomInterface={store.addCustomMountingInterface}
          onRemoveCustomInterface={store.removeCustomMountingInterface}
        />
      ) : (
        <div className="main-layout">
          <WorkshopLeftPanel
            stage={store.stage}
            foundation={store.foundation}
            parts={store.parts}
            connections={store.connections}
            drivetrain={store.drivetrain}
            selectedPart={derived.selectedPart}
            selectedId={store.selectedId}
            hiddenPartIdSet={derived.hiddenPartIdSet}
            childrenByParent={derived.childrenByParent}
            anchoredRootParts={derived.anchoredRootParts}
            unattachedRootParts={derived.unattachedRootParts}
            validationReport={derived.validationReport}
            drivetrainValidation={derived.drivetrainValidation}
            selectedStructuralCatalogueId={store.selectedStructuralCatalogueId}
            selectedBatteryCatalogueId={store.selectedBatteryCatalogueId}
            selectedControllerCatalogueId={store.selectedControllerCatalogueId}
            selectedMotorCatalogueId={store.selectedMotorCatalogueId}
            selectedWheelCatalogueId={store.selectedWheelCatalogueId}
            installedBatteryDefinition={derived.installedBatteryDefinition}
            installedControllerDefinition={derived.installedControllerDefinition}
            onSetStage={store.setStage}
            onResetRightTabToStage={() => setRightPanelTab("stage")}
            onSelectHierarchyPart={(partId) => {
              store.setSelectedId(partId);
              if (partId !== "foundation-chassis") {
                setRightPanelTab("inspector");
              }
            }}
            onTogglePartVisibility={store.togglePartVisibility}
            onDeletePart={handleRequestDeletePart}
            onSelectFoundationModel={store.selectFoundationModel}
            onConfigureProcedural={store.configureProceduralFoundation}
            onResetProcedural={store.resetProceduralFoundation}
            onImportFoundationStl={store.importFoundationStl}
            onSelectStructuralCatalogueItem={store.selectStructuralCatalogueItem}
            onAddStructuralPart={store.addStructuralPart}
            onReplaceStructuralPart={store.replaceStructuralPart}
            onDuplicatePart={store.duplicatePart}
            onImportStructuralStl={store.importStructuralStl}
            onSelectBatteryCatalogueItem={store.selectBatteryCatalogueItem}
            onSelectControllerCatalogueItem={store.selectControllerCatalogueItem}
            onSelectMotorCatalogueItem={store.selectMotorCatalogueItem}
            onSelectWheelCatalogueItem={store.selectWheelCatalogueItem}
          />

          <WorkshopViewport
            parts={store.parts}
            visibleParts={derived.visibleParts}
            foundation={store.foundation}
            selectedId={store.selectedId}
            selectedPart={derived.selectedPart}
            focusableSelectedPart={derived.focusableSelectedPart}
            selectedPartIsHidden={derived.selectedPartIsHidden}
            transformMode={store.transformMode}
            mountCandidate={mountCandidate}
            cameraFocusRequest={cameraFocusRequest}
            onSetSelectedId={store.setSelectedId}
            onSetMountCandidate={setMountCandidate}
            onMountWheelToMotor={store.mountWheelToMotor}
            onRequestCameraFocus={requestCameraFocus}
            onSetTransformMode={store.setTransformMode}
            onStartNewBuild={store.startNewBuild}
          />

          <aside className="right-panel">
            <div className="panel-heading">
              PROPERTIES &amp; DIAGNOSTICS
            </div>

            <div className="workshop-right-tabs" role="tablist" aria-label="Right inspector tabs">
              <button
                id="workshop-tab-stage"
                type="button"
                role="tab"
                aria-selected={rightPanelTab === "stage"}
                aria-controls="workshop-tabpanel-stage"
                tabIndex={rightPanelTab === "stage" ? 0 : -1}
                className={`sim-tab-btn ${rightPanelTab === "stage" ? "active" : ""}`}
                onClick={() => setRightPanelTab("stage")}
                onKeyDown={(event) =>
                  handleTabListKeyDown(event, WORKSHOP_RIGHT_TABS, rightPanelTab, setRightPanelTab)
                }
              >
                Build Step
              </button>
              <button
                id="workshop-tab-inspector"
                type="button"
                role="tab"
                aria-selected={rightPanelTab === "inspector"}
                aria-controls="workshop-tabpanel-inspector"
                tabIndex={rightPanelTab === "inspector" ? 0 : -1}
                className={`sim-tab-btn ${rightPanelTab === "inspector" ? "active" : ""}`}
                onClick={() => setRightPanelTab("inspector")}
                onKeyDown={(event) =>
                  handleTabListKeyDown(event, WORKSHOP_RIGHT_TABS, rightPanelTab, setRightPanelTab)
                }
              >
                Part
              </button>
              <button
                id="workshop-tab-validation"
                type="button"
                role="tab"
                aria-selected={rightPanelTab === "validation"}
                aria-controls="workshop-tabpanel-validation"
                tabIndex={rightPanelTab === "validation" ? 0 : -1}
                className={`sim-tab-btn ${rightPanelTab === "validation" ? "active" : ""}`}
                onClick={() => setRightPanelTab("validation")}
                onKeyDown={(event) =>
                  handleTabListKeyDown(event, WORKSHOP_RIGHT_TABS, rightPanelTab, setRightPanelTab)
                }
              >
                Validate ({derived.validationReport.diagnostics.length})
              </button>
            </div>

            <div
              id={`workshop-tabpanel-${rightPanelTab}`}
              role="tabpanel"
              aria-labelledby={`workshop-tab-${rightPanelTab}`}
              className="panel-content"
            >
              {rightPanelTab === "inspector" ? (
                derived.selectedPart ? (
                  <PartInspectorPanel
                    key={derived.selectedPart.id}
                    part={derived.selectedPart}
                    parts={store.parts}
                    connections={store.connections}
                    foundation={store.foundation}
                    diagnostics={derived.selectedPartDiagnostics}
                    onPreviewTransform={store.previewPartTransform}
                    onApplyTransform={store.updatePartTransform}
                    onReplaceStructuralPart={store.replaceStructuralPart}
                    onDuplicatePart={store.duplicatePart}
                    onAttachPart={store.attachPart}
                    onDetachPart={store.detachPart}
                    onDeletePart={handleRequestDeletePart}
                    onUpdateImportedConfig={store.updateImportedPartConfiguration}
                    onAddCustomInterface={store.addCustomMountingInterface}
                    onRemoveCustomInterface={store.removeCustomMountingInterface}
                    electricalConnections={store.electricalConnections}
                    onRemoveElectricalConnection={store.removeElectricalConnection}
                  />
                ) : (
                  <div className="placeholder-content">
                    <div className="placeholder-icon">⊞</div>
                    <p>Select any installed component in the Assembly Tree or 3D Viewport to adjust Position, Rotation, Dimensions, or Mounting.</p>
                  </div>
                )
              ) : rightPanelTab === "validation" ? (
                <WorkshopValidationPanel
                  validationReport={derived.validationReport}
                  electricalConnectionCount={store.electricalConnections.length}
                  lastReplacementWarning={store.lastReplacementWarning}
                  onClearReplacementWarning={store.clearReplacementWarning}
                  onInspectPart={(partId) => {
                    store.setSelectedId(partId);
                    setRightPanelTab("inspector");
                  }}
                  onFocusElectricalDiagnostic={store.focusElectricalDiagnostic}
                  onOpenElectricalWorkspace={() => setWorkspaceMode("electrical")}
                  onOpenPartInspector={() => setRightPanelTab("inspector")}
                />
              ) : (
                <WorkshopStageRightPanel
                  stage={store.stage}
                  foundation={store.foundation}
                  parts={store.parts}
                  selectedPart={derived.selectedPart}
                  drivetrain={store.drivetrain}
                  drivetrainSlotCount={derived.drivetrainSlotCount}
                  drivetrainValidation={derived.drivetrainValidation}
                  poweredWheelAssemblies={derived.poweredWheelAssemblies}
                  mountedMotors={derived.mountedMotors}
                  mountedWheels={derived.mountedWheels}
                  wheelByMotorId={derived.wheelByMotorId}
                  motorMountZones={derived.motorMountZones}
                  occupiedZoneIds={derived.occupiedZoneIds}
                  structuralMotorCarriers={derived.structuralMotorCarriers}
                  selectedMotorDefinition={derived.selectedMotorDefinition}
                  selectedMountZoneId={store.selectedMountZoneId}
                  selectedWheelDefinition={derived.selectedWheelDefinition}
                  selectedWheelMotor={derived.selectedWheelMotor}
                  selectedWheelMotorId={store.selectedWheelMotorId}
                  selectedWheelMotorDefinition={derived.selectedWheelMotorDefinition}
                  selectedMotorWheel={derived.selectedMotorWheel}
                  selectedWheelDiameterCm={store.selectedWheelDiameterCm}
                  selectedWheelWidthCm={store.selectedWheelWidthCm}
                  selectedBatteryCatalogueId={store.selectedBatteryCatalogueId}
                  selectedBatteryDefinition={derived.selectedBatteryDefinition}
                  installedBattery={derived.installedBattery}
                  installedBatteryDefinition={derived.installedBatteryDefinition}
                  selectedControllerCatalogueId={store.selectedControllerCatalogueId}
                  selectedControllerDefinition={derived.selectedControllerDefinition}
                  installedController={derived.installedController}
                  installedControllerDefinition={derived.installedControllerDefinition}
                  performanceProfile={derived.performanceProfile}
                  stabilityProfile={derived.stabilityProfile}
                  inertiaProfile={derived.inertiaProfile}
                  getMotorLocationLabel={derived.getMotorLocationLabel}
                  onSetStage={store.setStage}
                  onInspectFoundationChassis={() => {
                    store.setSelectedId("foundation-chassis");
                    setRightPanelTab("inspector");
                  }}
                  onOpenPartInspector={() => setRightPanelTab("inspector")}
                  onUpdateFoundationDimensions={store.updateFoundationDimensions}
                  onConfigureProceduralFoundation={store.configureProceduralFoundation}
                  onSetFoundationOptions={store.setFoundationOptions}
                  onConfirmFoundation={store.confirmFoundation}
                  onInstallBattery={store.installBattery}
                  onRemoveBattery={store.removeBattery}
                  onInstallController={store.installController}
                  onRemoveController={store.removeController}
                  onSelectMountZone={store.selectMountZone}
                  onPlaceMotor={store.placeMotor}
                  onMountMotorToParent={store.mountMotorToParent}
                  onReplaceMotor={store.replaceMotor}
                  onRemoveMotor={store.removeMotor}
                  onRotateMotor={store.rotateMotor}
                  onUpdateSelectedWheelDimensions={store.updateSelectedWheelDimensions}
                  onSelectWheelMotor={store.selectWheelMotor}
                  onAssignWheel={store.assignWheel}
                  onRemoveWheel={store.removeWheel}
                  onSetDrivetrainType={store.setDrivetrainType}
                  onSetDrivetrainAssignment={store.setDrivetrainAssignment}
                  onApplySuggestedDrivetrainMapping={
                    store.applySuggestedDrivetrainMapping
                  }
                  onFinishBuild={store.finishBuild}
                />
              )}
            </div>

            <div className="panel-footer">
              <div className="footer-label">
                SYSTEM
              </div>

              <div className="build-status">
                <span className="status-dot" />
                Editor Online
              </div>
            </div>
          </aside>
        </div>
      )}

      <footer className="statusbar">
        <span>
          {workspaceMode === "electrical"
            ? "ROBOT WARS / ELECTRICAL WORKSPACE"
            : "ROBOT WARS / WORKSHOP"}
        </span>
        <span>OBJECTS: {store.parts.length}</span>
        <span>WIRES: {store.electricalConnections.length}</span>
      </footer>

      <ConfirmActionDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        tone={pendingConfirm?.tone ?? "danger"}
        onConfirm={() => pendingConfirm?.onConfirm()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

export default App;
