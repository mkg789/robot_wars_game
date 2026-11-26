import { useState } from "react";
import { batteryCatalogue } from "../../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../features/robot-builder/data/controllerCatalogue";
import { motorCatalogue } from "../../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../features/robot-builder/data/wheelCatalogue";
import type { AssemblyValidationReport } from "../../features/robot-builder/logic/assemblyValidation";
import type { DrivetrainValidation } from "../../features/robot-builder/logic/drivetrain";
import { formatLength } from "../../features/robot-builder/logic/formatters";
import type {
  BatteryDefinition,
  BuildStage,
  ControllerDefinition,
  DrivetrainConfiguration,
  FoundationConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  MeshAssetInspection,
  CustomCollisionConfig,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  RobotConnection,
  RobotPart,
  BatteryCatalogueId,
  ControllerCatalogueId,
  FoundationModelId,
  MotorCatalogueId,
  StructuralCatalogueId,
  WheelCatalogueId,
} from "../../features/robot-builder/types/robot.types";
import { AssemblyHierarchyTree } from "./AssemblyHierarchyTree";
import FoundationStagePanel from "./FoundationStagePanel";
import StructureStagePanel from "./StructureStagePanel";

export interface WorkshopLeftPanelProps {
  readonly stage: BuildStage;
  readonly foundation: FoundationConfig | null;
  readonly parts: RobotPart[];
  readonly connections: RobotConnection[];
  readonly drivetrain: DrivetrainConfiguration;
  readonly selectedPart: RobotPart | null;
  readonly selectedId: string | null;
  readonly hiddenPartIdSet: Set<string>;
  readonly childrenByParent: Map<string, RobotPart[]>;
  readonly anchoredRootParts: RobotPart[];
  readonly unattachedRootParts: RobotPart[];
  readonly validationReport: AssemblyValidationReport;
  readonly drivetrainValidation: DrivetrainValidation;
  readonly selectedStructuralCatalogueId: StructuralCatalogueId | null;
  readonly selectedBatteryCatalogueId: BatteryCatalogueId | null;
  readonly selectedControllerCatalogueId: ControllerCatalogueId | null;
  readonly selectedMotorCatalogueId: MotorCatalogueId | null;
  readonly selectedWheelCatalogueId: WheelCatalogueId | null;
  readonly installedBatteryDefinition: BatteryDefinition | undefined;
  readonly installedControllerDefinition: ControllerDefinition | undefined;
  readonly onSetStage: (stage: BuildStage) => void;
  readonly onResetRightTabToStage: () => void;
  readonly onSelectHierarchyPart: (partId: string) => void;
  readonly onTogglePartVisibility: (partId: string) => void;
  readonly onDeletePart: (partId: string) => void;
  readonly onSelectFoundationModel: (modelId: FoundationModelId) => void;
  readonly onConfigureProcedural: (
    patch: Partial<ProceduralFoundationConfig> & {
      architecture?: ProceduralFoundationArchitectureId;
    }
  ) => void;
  readonly onResetProcedural: (architecture?: ProceduralFoundationArchitectureId) => void;
  readonly onImportFoundationStl: (params: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
  }) => void;
  readonly onSelectStructuralCatalogueItem: (id: StructuralCatalogueId) => void;
  readonly onAddStructuralPart: (
    id: StructuralCatalogueId,
    options?: {
      parentId?: string;
      parentInterfaceId?: string;
      childInterfaceId?: string;
    }
  ) => string | null;
  readonly onReplaceStructuralPart: (partId: string, id: StructuralCatalogueId) => void;
  readonly onDuplicatePart: (partId: string) => string | null;
  readonly onImportStructuralStl: (params: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
    parentId?: string;
    parentInterfaceId?: string;
  }) => string | null;
  readonly onSelectBatteryCatalogueItem: (id: BatteryCatalogueId) => void;
  readonly onSelectControllerCatalogueItem: (id: ControllerCatalogueId) => void;
  readonly onSelectMotorCatalogueItem: (id: MotorCatalogueId) => void;
  readonly onSelectWheelCatalogueItem: (id: WheelCatalogueId) => void;
}

const BUILD_STEPS = [
  { id: "foundation", label: "Foundation", num: 1 },
  { id: "structure", label: "Structure", num: 2 },
  { id: "battery", label: "Battery", num: 3 },
  { id: "controller", label: "Controller", num: 4 },
  { id: "motors", label: "Motors", num: 5 },
  { id: "wheels", label: "Wheels", num: 6 },
  { id: "drivetrain", label: "Drivetrain", num: 7 },
] as const;

const BUILD_STAGE_ORDER: readonly BuildStage[] = [
  "foundation",
  "structure",
  "battery",
  "controller",
  "motors",
  "wheels",
  "drivetrain",
  "completed",
];

export function WorkshopLeftPanel({
  stage,
  foundation,
  parts,
  connections,
  drivetrain,
  selectedPart,
  selectedId,
  hiddenPartIdSet,
  childrenByParent,
  anchoredRootParts,
  unattachedRootParts,
  validationReport,
  drivetrainValidation,
  selectedStructuralCatalogueId,
  selectedBatteryCatalogueId,
  selectedControllerCatalogueId,
  selectedMotorCatalogueId,
  selectedWheelCatalogueId,
  installedBatteryDefinition,
  installedControllerDefinition,
  onSetStage,
  onResetRightTabToStage,
  onSelectHierarchyPart,
  onTogglePartVisibility,
  onDeletePart,
  onSelectFoundationModel,
  onConfigureProcedural,
  onResetProcedural,
  onImportFoundationStl,
  onSelectStructuralCatalogueItem,
  onAddStructuralPart,
  onReplaceStructuralPart,
  onDuplicatePart,
  onImportStructuralStl,
  onSelectBatteryCatalogueItem,
  onSelectControllerCatalogueItem,
  onSelectMotorCatalogueItem,
  onSelectWheelCatalogueItem,
}: WorkshopLeftPanelProps) {
  const [collapsedPartIds, setCollapsedPartIds] = useState<Set<string>>(
    () => new Set()
  );

  return (
    <aside className="left-panel">
      <div className="panel-content">
        <div className="builder-steps">
          {BUILD_STEPS.map((step) => {
            const currentIdx = BUILD_STAGE_ORDER.indexOf(stage);
            const stepIdx = BUILD_STAGE_ORDER.indexOf(step.id);
            const isComplete = stepIdx < currentIdx;
            const isClickable =
              step.id === "foundation" || Boolean(foundation?.confirmed);
            return (
              <button
                key={step.id}
                type="button"
                disabled={!isClickable}
                className={`builder-step ${stage === step.id ? "active" : isComplete ? "complete" : ""}`}
                onClick={() => {
                  if (isClickable) {
                    onSetStage(step.id);
                    onResetRightTabToStage();
                  }
                }}
              >
                <span>{step.num}</span>
                {step.label}
              </button>
            );
          })}
        </div>

        {stage === "foundation" && foundation ? (
          <FoundationStagePanel
            foundation={foundation}
            onSelectFoundationModel={onSelectFoundationModel}
            onConfigureProcedural={onConfigureProcedural}
            onResetProcedural={onResetProcedural}
            onImportFoundationStl={onImportFoundationStl}
          />
        ) : stage === "structure" ? (
          <StructureStagePanel
            parts={parts}
            foundation={foundation}
            selectedPart={selectedPart}
            selectedCatalogueId={selectedStructuralCatalogueId}
            onSelectCatalogueItem={onSelectStructuralCatalogueItem}
            onAddStructuralPart={onAddStructuralPart}
            onReplaceStructuralPart={onReplaceStructuralPart}
            onDuplicatePart={onDuplicatePart}
            onImportStructuralStl={onImportStructuralStl}
            onContinueToBattery={() => onSetStage("battery")}
            onBackToFoundation={() => onSetStage("foundation")}
          />
        ) : stage === "battery" ? (
          <>
            <div className="section-label">BATTERY CATALOGUE</div>
            <p className="builder-intro">
              Choose an optional battery to install on the foundation.
            </p>
            <div className="motor-list">
              {batteryCatalogue.map((battery) => (
                <button
                  key={battery.id}
                  className={`motor-card ${
                    selectedBatteryCatalogueId === battery.id ? "selected" : ""
                  }`}
                  onClick={() => onSelectBatteryCatalogueItem(battery.id)}
                >
                  <span
                    className="motor-card-icon"
                    style={{ borderColor: battery.color }}
                  >
                    ▰
                  </span>
                  <span>
                    <strong>{battery.name}</strong>
                    <small>
                      {battery.voltage}V · {battery.capacityMah}mAh
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="battery-install-status" role="status">
              {installedBatteryDefinition
                ? `${installedBatteryDefinition.name} installed`
                : "No battery installed"}
            </div>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("controller")}
            >
              Continue to Controller
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("foundation")}
            >
              ← Back to Foundation
            </button>
          </>
        ) : stage === "controller" ? (
          <>
            <div className="section-label">CONTROLLER CATALOGUE</div>
            <p className="builder-intro">
              Choose an optional controller board for the robot.
            </p>
            <div className="motor-list">
              {controllerCatalogue.map((controller) => (
                <button
                  key={controller.id}
                  className={`motor-card ${
                    selectedControllerCatalogueId === controller.id
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => onSelectControllerCatalogueItem(controller.id)}
                >
                  <span
                    className="motor-card-icon"
                    style={{ borderColor: controller.color }}
                  >
                    ▤
                  </span>
                  <span>
                    <strong>{controller.name}</strong>
                    <small>{controller.controllerType}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="controller-install-status" role="status">
              {installedControllerDefinition
                ? `${installedControllerDefinition.name} installed`
                : "No controller installed"}
            </div>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("battery")}
            >
              ← Back to Battery
            </button>
          </>
        ) : stage === "motors" ? (
          <>
            <div className="section-label">MOTOR CATALOGUE</div>
            <div className="motor-list">
              {motorCatalogue.map((motor) => (
                <button
                  key={motor.id}
                  className={`motor-card ${
                    selectedMotorCatalogueId === motor.id ? "selected" : ""
                  }`}
                  onClick={() => onSelectMotorCatalogueItem(motor.id)}
                >
                  <span
                    className="motor-card-icon"
                    style={{ borderColor: motor.color }}
                  >
                    ⚙
                  </span>
                  <span>
                    <strong>{motor.name}</strong>
                    <small>
                      {motor.rpm} RPM · {motor.torque.toFixed(1)} N·m
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("controller")}
            >
              ← Back to Controller
            </button>
          </>
        ) : stage === "wheels" ? (
          <>
            <div className="section-label">WHEEL CATALOGUE</div>
            <div className="wheel-list">
              {wheelCatalogue.map((wheel) => (
                <button
                  key={wheel.id}
                  className={`wheel-card ${
                    selectedWheelCatalogueId === wheel.id ? "selected" : ""
                  }`}
                  onClick={() => onSelectWheelCatalogueItem(wheel.id)}
                >
                  <span className="wheel-card-icon">◉</span>
                  <span>
                    <strong>{wheel.name}</strong>
                    <small>
                      {formatLength(wheel.diameter, "cm", { decimals: 0 })} ×{" "}
                      {formatLength(wheel.width, "cm", { decimals: 1 })} ·{" "}
                      {wheel.category}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("motors")}
            >
              ← Back to Motors
            </button>
          </>
        ) : stage === "drivetrain" ? (
          <>
            <div className="section-label">DRIVETRAIN CONFIGURATION</div>
            <p className="builder-intro">
              Map mounted motor and wheel assemblies to the left and right
              drive groups.
            </p>
            <div
              className={`drivetrain-status ${
                drivetrainValidation.isValid ? "valid" : "invalid"
              }`}
              role="status"
            >
              {drivetrainValidation.isValid
                ? "Configuration ready"
                : "Configuration needs attention"}
            </div>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("wheels")}
            >
              ← Back to Wheels
            </button>
          </>
        ) : stage === "completed" ? (
          <>
            <div className="section-label">BUILD COMPLETE</div>
            <p className="builder-intro">
              Your robot configuration is ready to review.
            </p>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("wheels")}
            >
              ← Edit Wheels
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("motors")}
            >
              ← Edit Motors
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("drivetrain")}
            >
              ← Edit Drivetrain
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("foundation")}
            >
              ← Edit Foundation
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("structure")}
            >
              ← Edit Structure
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("battery")}
            >
              ← Edit Battery
            </button>
            <button
              className="stage-back-button"
              onClick={() => onSetStage("controller")}
            >
              ← Edit Controller
            </button>
          </>
        ) : (
          <div className="placeholder-content">
            <p>Start a new robot build to continue.</p>
          </div>
        )}
        {stage === "foundation" && !foundation && (
          <>
            <div className="section-label">NEW ROBOT</div>
            <p className="builder-intro">
              Choose the foundation that will support your motors and wheels.
            </p>
          </>
        )}
      </div>
      <div className="panel-heading">
        ROBOT STRUCTURE ({parts.length})
      </div>

      <AssemblyHierarchyTree
        parts={parts}
        connections={connections}
        drivetrain={drivetrain}
        childrenByParent={childrenByParent}
        anchoredRootParts={anchoredRootParts}
        unattachedRootParts={unattachedRootParts}
        hiddenPartIdSet={hiddenPartIdSet}
        collapsedPartIds={collapsedPartIds}
        setCollapsedPartIds={setCollapsedPartIds}
        selectedId={selectedId}
        validationReport={validationReport}
        onSelectPart={onSelectHierarchyPart}
        onToggleVisibility={onTogglePartVisibility}
        onDeletePart={onDeletePart}
      />

      <div className="panel-footer">
        <div className="footer-label">
          BUILD STATUS
        </div>

        <div className="build-status">
          <span className="status-dot" />
          Editable Objects
        </div>
      </div>
    </aside>
  );
}
