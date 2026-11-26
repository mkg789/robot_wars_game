import { useState } from "react";
import { foundationModels } from "../../features/robot-builder/data/foundationModels";
import { motorCatalogue } from "../../features/robot-builder/data/motorCatalogue";
import {
  getDrivetrainAssignmentKey,
  getDrivetrainSlotCount,
  type DrivetrainValidation,
  type PoweredWheelAssembly,
} from "../../features/robot-builder/logic/drivetrain";
import {
  formatDimensions,
  formatLength,
  formatMass,
} from "../../features/robot-builder/logic/formatters";
import { resolvePartMountingInterfaces } from "../../features/robot-builder/logic/mountingInterfaces";
import { PROCEDURAL_ARCHITECTURES } from "../../features/robot-builder/logic/proceduralFoundation";
import type { RobotInertiaProfile } from "../../features/robot-builder/logic/robotInertia";
import type { RobotPerformanceProfile } from "../../features/robot-builder/logic/robotKinematics";
import type { RobotStabilityProfile } from "../../features/robot-builder/logic/robotStability";
import type {
  BatteryCatalogueId,
  BatteryDefinition,
  BuildStage,
  ControllerCatalogueId,
  ControllerDefinition,
  DrivetrainAssignment,
  DrivetrainConfiguration,
  DrivetrainSide,
  DrivetrainType,
  FoundationConfig,
  MotorCatalogueId,
  MotorDefinition,
  MotorMountZone,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  RobotPart,
  WheelDefinition,
  WheelDimensionDraft,
} from "../../features/robot-builder/types/robot.types";
import { CompletedBuildSummary } from "./CompletedBuildSummary";
import { NumericInput } from "./WorkshopSharedControls";

export interface WorkshopStageRightPanelProps {
  readonly stage: BuildStage;
  readonly foundation: FoundationConfig | null;
  readonly parts: RobotPart[];
  readonly selectedPart: RobotPart | null;
  readonly drivetrain: DrivetrainConfiguration;
  readonly drivetrainSlotCount: number;
  readonly drivetrainValidation: DrivetrainValidation;
  readonly poweredWheelAssemblies: PoweredWheelAssembly[];
  readonly mountedMotors: RobotPart[];
  readonly mountedWheels: RobotPart[];
  readonly wheelByMotorId: Map<string, RobotPart>;
  readonly motorMountZones: MotorMountZone[];
  readonly occupiedZoneIds: Set<string | undefined>;
  readonly structuralMotorCarriers: RobotPart[];
  readonly selectedMotorDefinition: MotorDefinition | undefined;
  readonly selectedMountZoneId: string | null;
  readonly selectedWheelDefinition: WheelDefinition | undefined;
  readonly selectedWheelMotor: RobotPart | undefined;
  readonly selectedWheelMotorId: string | null;
  readonly selectedWheelMotorDefinition: MotorDefinition | undefined;
  readonly selectedMotorWheel: RobotPart | undefined;
  readonly selectedWheelDiameterCm: number;
  readonly selectedWheelWidthCm: number;
  readonly selectedBatteryCatalogueId: BatteryCatalogueId | null;
  readonly selectedBatteryDefinition: BatteryDefinition | undefined;
  readonly installedBattery: RobotPart | undefined;
  readonly installedBatteryDefinition: BatteryDefinition | undefined;
  readonly selectedControllerCatalogueId: ControllerCatalogueId | null;
  readonly selectedControllerDefinition: ControllerDefinition | undefined;
  readonly installedController: RobotPart | undefined;
  readonly installedControllerDefinition: ControllerDefinition | undefined;
  readonly performanceProfile: RobotPerformanceProfile;
  readonly stabilityProfile: RobotStabilityProfile;
  readonly inertiaProfile: RobotInertiaProfile;
  readonly getMotorLocationLabel: (motor: RobotPart) => string;
  readonly onSetStage: (stage: BuildStage) => void;
  readonly onInspectFoundationChassis: () => void;
  readonly onOpenPartInspector: () => void;
  readonly onUpdateFoundationDimensions: (
    dimensions: Partial<Pick<FoundationConfig, "length" | "width" | "height">>
  ) => void;
  readonly onConfigureProceduralFoundation: (
    patch: Partial<ProceduralFoundationConfig> & {
      architecture?: ProceduralFoundationArchitectureId;
    }
  ) => void;
  readonly onSetFoundationOptions: (
    options: Partial<Pick<FoundationConfig, "includeTopPlate" | "includeFrontCover">>
  ) => void;
  readonly onConfirmFoundation: () => void;
  readonly onInstallBattery: (id: BatteryCatalogueId) => void;
  readonly onRemoveBattery: () => void;
  readonly onInstallController: (id: ControllerCatalogueId) => void;
  readonly onRemoveController: () => void;
  readonly onSelectMountZone: (zoneId: string) => void;
  readonly onPlaceMotor: () => void;
  readonly onMountMotorToParent: (
    parentId: string,
    parentInterfaceId?: string,
    motorCatalogueId?: MotorCatalogueId
  ) => string | null;
  readonly onReplaceMotor: (zoneId: string) => void;
  readonly onRemoveMotor: (zoneId: string) => void;
  readonly onRotateMotor: (zoneId: string, rotationY?: number) => void;
  readonly onUpdateSelectedWheelDimensions: (
    dimensions: Partial<WheelDimensionDraft>
  ) => void;
  readonly onSelectWheelMotor: (motorId: string) => void;
  readonly onAssignWheel: (motorId: string) => void;
  readonly onRemoveWheel: (motorId: string) => void;
  readonly onSetDrivetrainType: (
    type: DrivetrainType,
    confirmDiscard?: boolean
  ) => boolean;
  readonly onSetDrivetrainAssignment: (
    side: DrivetrainSide,
    index: number,
    assignment: DrivetrainAssignment | null
  ) => void;
  readonly onApplySuggestedDrivetrainMapping: (confirmCustomized?: boolean) => boolean;
  readonly onFinishBuild: () => void;
}

export function WorkshopStageRightPanel({
  stage,
  foundation,
  parts,
  selectedPart,
  drivetrain,
  drivetrainSlotCount,
  drivetrainValidation,
  poweredWheelAssemblies,
  mountedMotors,
  mountedWheels,
  wheelByMotorId,
  motorMountZones,
  occupiedZoneIds,
  structuralMotorCarriers,
  selectedMotorDefinition,
  selectedMountZoneId,
  selectedWheelDefinition,
  selectedWheelMotor,
  selectedWheelMotorId,
  selectedWheelMotorDefinition,
  selectedMotorWheel,
  selectedWheelDiameterCm,
  selectedWheelWidthCm,
  selectedBatteryCatalogueId,
  selectedBatteryDefinition,
  installedBattery,
  installedBatteryDefinition,
  selectedControllerCatalogueId,
  selectedControllerDefinition,
  installedController,
  installedControllerDefinition,
  performanceProfile,
  stabilityProfile,
  inertiaProfile,
  getMotorLocationLabel,
  onSetStage,
  onInspectFoundationChassis,
  onOpenPartInspector,
  onUpdateFoundationDimensions,
  onConfigureProceduralFoundation,
  onSetFoundationOptions,
  onConfirmFoundation,
  onInstallBattery,
  onRemoveBattery,
  onInstallController,
  onRemoveController,
  onSelectMountZone,
  onPlaceMotor,
  onMountMotorToParent,
  onReplaceMotor,
  onRemoveMotor,
  onRotateMotor,
  onUpdateSelectedWheelDimensions,
  onSelectWheelMotor,
  onAssignWheel,
  onRemoveWheel,
  onSetDrivetrainType,
  onSetDrivetrainAssignment,
  onApplySuggestedDrivetrainMapping,
  onFinishBuild,
}: WorkshopStageRightPanelProps) {
  const [confirmAutoMap, setConfirmAutoMap] = useState(false);
  const [pendingDrivetrainType, setPendingDrivetrainType] =
    useState<DrivetrainType | null>(null);
  const [structuralMotorParentId, setStructuralMotorParentId] = useState("");
  const [structuralMotorIfaceId, setStructuralMotorIfaceId] = useState("");

  const activeMotorCarrier =
    structuralMotorCarriers.find((p) => p.id === structuralMotorParentId) ??
    structuralMotorCarriers[0] ??
    null;
  const activeMotorCarrierInterfaces = activeMotorCarrier
    ? resolvePartMountingInterfaces(activeMotorCarrier, foundation).filter((i) =>
        i.compatibleWith.includes("motor-mount")
      )
    : [];
  const activeMotorCarrierIface =
    activeMotorCarrierInterfaces.find((i) => i.id === structuralMotorIfaceId) ??
    activeMotorCarrierInterfaces[0] ??
    null;

  const renderDrivetrainGroup = (side: DrivetrainSide) => {
    const sideLabel = side === "left" ? "Left" : "Right";
    return (
      <div className="drivetrain-group" key={side}>
        <div className="drivetrain-group-title">{sideLabel} drive group</div>
        {Array.from({ length: drivetrainSlotCount }, (_, index) => {
          const currentAssignment = drivetrain[side][index] ?? null;
          const currentKey = currentAssignment
            ? getDrivetrainAssignmentKey(currentAssignment)
            : "";
          const hasDuplicateAssignment = (): boolean =>
            (["left", "right"] as const).some((otherSide) =>
              drivetrain[otherSide].some((assignment, otherIndex) => {
                if (!assignment) return false;
                if (otherSide === side && otherIndex === index) return false;
                return (
                  assignment.motorId === currentAssignment?.motorId ||
                  assignment.wheelId === currentAssignment?.wheelId
                );
              })
            );

          return (
            <label
              className="drivetrain-slot"
              key={`${side}-${index}`}
            >
              <span>
                {sideLabel} wheel {index + 1}
              </span>
              <select
                aria-label={`${sideLabel} drive wheel ${index + 1}`}
                value={currentKey}
                disabled={pendingDrivetrainType !== null}
                onChange={(event) => {
                  const selectedAssembly = poweredWheelAssemblies.find(
                    (assembly) =>
                      getDrivetrainAssignmentKey(assembly) === event.target.value
                  );
                  onSetDrivetrainAssignment(
                    side,
                    index,
                    selectedAssembly
                      ? {
                          motorId: selectedAssembly.motorId,
                          wheelId: selectedAssembly.wheelId,
                        }
                      : null
                  );
                }}
              >
                <option value="">Select powered wheel assembly</option>
                {poweredWheelAssemblies.map((assembly) => (
                  <option
                    key={getDrivetrainAssignmentKey(assembly)}
                    value={getDrivetrainAssignmentKey(assembly)}
                  >
                    {assembly.mountingLocation}: {assembly.motor.name} +{" "}
                    {assembly.wheel.name}
                  </option>
                ))}
              </select>
              {currentAssignment && hasDuplicateAssignment() && (
                <small className="drivetrain-warning">
                  This assembly is already assigned to another drive slot.
                </small>
              )}
            </label>
          );
        })}
      </div>
    );
  };

  if (stage === "structure" && foundation) {
    return (
      <>
        <div className="section-label">STRUCTURAL ASSEMBLY TIPS</div>
        <p className="builder-intro">
          Add brackets, rails, plates, crossbars, beams, standoffs, spacers, or bumpers on the left, then select any component to fine-tune transforms or attach children.
        </p>
        {selectedPart && (
          <button
            type="button"
            className="primary-button foundation-confirm"
            onClick={onOpenPartInspector}
          >
            Edit Selected: {selectedPart.name}
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() => onSetStage("battery")}
        >
          Continue to Battery
        </button>
      </>
    );
  }

  if (stage === "drivetrain" && foundation) {
    return (
      <>
        <div className="section-label">DRIVETRAIN TYPE</div>
        <label className="drivetrain-type-control">
          <span>Drive configuration</span>
          <select
            aria-label="Drivetrain type"
            value={pendingDrivetrainType ?? drivetrain.type}
            onChange={(event) => {
              setConfirmAutoMap(false);
              const nextType = event.target.value as DrivetrainType;
              const nextSlotCount = getDrivetrainSlotCount(nextType);
              const removesCustomAssignments =
                drivetrain.mappingCustomized &&
                (["left", "right"] as const).some((side) =>
                  drivetrain[side]
                    .slice(nextSlotCount)
                    .some((assignment) => assignment !== null)
                );
              if (removesCustomAssignments) {
                setPendingDrivetrainType(nextType);
              } else {
                setPendingDrivetrainType(null);
                onSetDrivetrainType(nextType);
              }
            }}
          >
            <option value="differential-2">
              Differential Drive · 2 wheel
            </option>
            <option value="differential-4">
              4-Wheel Differential Drive
            </option>
          </select>
        </label>
        {pendingDrivetrainType && (
          <div className="drivetrain-confirm" role="group">
            <p>
              Switching to 2-wheel differential drive removes the
              additional custom assignments. Continue?
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onSetDrivetrainType(pendingDrivetrainType, true);
                setPendingDrivetrainType(null);
              }}
            >
              Switch and Remove Extra Assignments
            </button>
            <button
              type="button"
              className="stage-back-button"
              onClick={() => setPendingDrivetrainType(null)}
            >
              Keep Current Type
            </button>
          </div>
        )}
        <p className="builder-intro">
          {drivetrain.type === "differential-2"
            ? "Assign one powered wheel assembly to each side."
            : "Assign two powered wheel assemblies to each side."}
        </p>

        <button
          type="button"
          className="secondary-button drivetrain-suggest-button"
          disabled={pendingDrivetrainType !== null}
          onClick={() => {
            if (drivetrain.mappingCustomized) {
              setConfirmAutoMap(true);
            } else {
              onApplySuggestedDrivetrainMapping();
            }
          }}
        >
          Suggest Mapping
        </button>
        {confirmAutoMap && (
          <div className="drivetrain-confirm" role="group">
            <p>
              Replace the custom mapping with the mounting-position
              suggestion?
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onApplySuggestedDrivetrainMapping(true);
                setConfirmAutoMap(false);
              }}
            >
              Apply Suggestion
            </button>
            <button
              type="button"
              className="stage-back-button"
              onClick={() => setConfirmAutoMap(false)}
            >
              Keep Current Mapping
            </button>
          </div>
        )}

        {renderDrivetrainGroup("left")}
        {renderDrivetrainGroup("right")}

        <div
          className={`drivetrain-status ${
            drivetrainValidation.isValid ? "valid" : "invalid"
          }`}
          role="status"
        >
          {drivetrainValidation.isValid
            ? "Drivetrain configuration valid"
            : "Drivetrain configuration incomplete"}
        </div>
        {!drivetrainValidation.isValid && (
          <ul className="drivetrain-errors" role="alert">
            {drivetrainValidation.errors.map((error: string) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="section-label">CONFIGURATION SUMMARY</div>
        {(["left", "right"] as const).map((side) => (
          <div className="drivetrain-summary-side" key={side}>
            <strong>
              {side === "left" ? "Left" : "Right"} drive group
            </strong>
            {drivetrain[side].every((assignment) => assignment === null) ? (
              <small>Unassigned</small>
            ) : (
              drivetrain[side].map((assignment, index) => {
                if (!assignment) return null;
                const assembly = poweredWheelAssemblies.find(
                  (item) =>
                    item.motorId === assignment.motorId &&
                    item.wheelId === assignment.wheelId
                );
                return (
                  <small key={`${side}-summary-${index}`}>
                    {assembly
                      ? `${assembly.mountingLocation}: ${assembly.motor.name} · ${assembly.wheel.name}`
                      : "Assignment is no longer available"}
                  </small>
                );
              })
            )}
          </div>
        ))}

        <button
          className="primary-button foundation-confirm"
          disabled={!drivetrainValidation.isValid || pendingDrivetrainType !== null}
          onClick={onFinishBuild}
        >
          Complete Build
        </button>
        <button
          className="stage-back-button"
          onClick={() => onSetStage("wheels")}
        >
          ← Back to Wheels
        </button>
      </>
    );
  }

  if (stage === "foundation" && foundation) {
    return (
      <>
        <div className="section-label">FOUNDATION CONFIGURATION</div>

        <div className="object-card">
          <div className="object-icon">▣</div>
          <div>
            <div className="object-name">
              {foundation.mode === "imported" && foundation.imported
                ? foundation.imported.fileName
                : foundation.procedural
                  ? PROCEDURAL_ARCHITECTURES.find(
                      (a) => a.id === foundation.procedural?.architecture
                    )?.name ?? "Procedural Chassis"
                  : foundationModels.find(
                      (model) => model.id === foundation.modelId
                    )?.name}
            </div>
            <div className="object-type">
              {foundation.mode === "imported"
                ? "Imported STL Foundation"
                : foundation.procedural
                  ? `Procedural · ${parts.filter((p) => Boolean(p.foundationMemberRole)).length} structural members`
                  : "Preset Primary Structure"}
            </div>
          </div>
        </div>

        {foundation.mode === "imported" && foundation.imported ? (
          <div className="workshop-mount-target">
            <div className="property-row">
              <span>Dimensions (L × W × H)</span>
              <span>
                {foundation.length.toFixed(2)} × {foundation.width.toFixed(2)} ×{" "}
                {foundation.height.toFixed(2)} m
              </span>
            </div>
            <div className="property-row">
              <span>Mesh / Triangles</span>
              <span>
                {foundation.imported.inspection.format.toUpperCase()} ·{" "}
                {foundation.imported.inspection.triangleCount}
              </span>
            </div>
            <div className="property-row">
              <span>Mass</span>
              <span>
                {foundation.imported.engineering.massKg !== undefined
                  ? `${foundation.imported.engineering.massKg.toFixed(2)} kg (${foundation.imported.engineering.provenance.method})`
                  : "Unknown"}
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              style={{ marginTop: 8 }}
              onClick={onInspectFoundationChassis}
            >
              Edit Imported Properties &amp; Interfaces
            </button>
          </div>
        ) : (
          <>
            <div className="property-row">
              <span>Length</span>
              <NumericInput
                value={foundation.length}
                min={foundation.mode === "procedural" ? 0.35 : 0.8}
                step={0.1}
                onValidChange={(length) => onUpdateFoundationDimensions({ length })}
              />
            </div>
            <div className="property-row">
              <span>Width</span>
              <NumericInput
                value={foundation.width}
                min={foundation.mode === "procedural" ? 0.35 : 0.8}
                step={0.1}
                onValidChange={(width) => onUpdateFoundationDimensions({ width })}
              />
            </div>
            <div className="property-row">
              <span>Height / Envelope</span>
              <NumericInput
                value={foundation.height}
                min={foundation.mode === "procedural" ? 0.04 : 0.12}
                step={0.05}
                onValidChange={(height) => onUpdateFoundationDimensions({ height })}
              />
            </div>

            {foundation.procedural && (
              <div className="workshop-mount-target">
                <div className="section-label">MEMBER OPTIONS</div>
                <div className="property-row">
                  <span>Base Thickness</span>
                  <NumericInput
                    value={foundation.procedural.thickness}
                    min={0.008}
                    step={0.005}
                    onValidChange={(thickness) =>
                      onConfigureProceduralFoundation({ thickness })
                    }
                  />
                </div>
                {(foundation.procedural.architecture === "perimeter-frame" ||
                  foundation.procedural.architecture === "t-slot-frame" ||
                  foundation.procedural.architecture === "patterned-frame" ||
                  foundation.procedural.architecture === "hybrid") && (
                  <>
                    <div className="property-row">
                      <span>Rail Width</span>
                      <NumericInput
                        value={foundation.procedural.railWidth}
                        min={0.02}
                        step={0.01}
                        onValidChange={(railWidth) =>
                          onConfigureProceduralFoundation({ railWidth })
                        }
                      />
                    </div>
                    <div className="property-row">
                      <span>Rail Height</span>
                      <NumericInput
                        value={foundation.procedural.railHeight}
                        min={0.02}
                        step={0.01}
                        onValidChange={(railHeight) =>
                          onConfigureProceduralFoundation({ railHeight })
                        }
                      />
                    </div>
                    <label className="foundation-option">
                      <input
                        type="checkbox"
                        checked={foundation.procedural.includeCornerBrackets}
                        onChange={(e) =>
                          onConfigureProceduralFoundation({
                            includeCornerBrackets: e.target.checked,
                          })
                        }
                      />
                      Corner gusset brackets
                    </label>
                  </>
                )}
                {foundation.procedural.architecture === "sheet-metal-tray" && (
                  <div className="property-row">
                    <span>Flange Height</span>
                    <NumericInput
                      value={foundation.procedural.flanges.heightM}
                      min={0.03}
                      step={0.02}
                      onValidChange={(heightM) =>
                        onConfigureProceduralFoundation({
                          flanges: {
                            ...foundation.procedural!.flanges,
                            heightM,
                          },
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}

            <div className="section-label">STRUCTURAL DETAILS</div>
            <label className="foundation-option">
              <input
                type="checkbox"
                checked={foundation.includeTopPlate}
                onChange={(event) =>
                  onSetFoundationOptions({
                    includeTopPlate: event.target.checked,
                  })
                }
              />
              Top structural plate
            </label>
            <label className="foundation-option">
              <input
                type="checkbox"
                checked={foundation.includeFrontCover}
                onChange={(event) =>
                  onSetFoundationOptions({
                    includeFrontCover: event.target.checked,
                  })
                }
              />
              Front protective cover
            </label>
          </>
        )}

        {foundation.confirmed ? (
          <div className="foundation-confirmed">
            <span>✓</span>
            Foundation confirmed
          </div>
        ) : (
          <button
            className="primary-button foundation-confirm"
            onClick={onConfirmFoundation}
          >
            Confirm Foundation
          </button>
        )}
      </>
    );
  }

  if (stage === "battery" && foundation) {
    return (
      <>
        <div className="section-label">BATTERY SPECIFICATIONS</div>
        {selectedBatteryDefinition ? (
          <div className="motor-spec-card">
            <div className="motor-spec-title">
              <span
                className="motor-card-icon"
                style={{ borderColor: selectedBatteryDefinition.color }}
              >
                ▰
              </span>
              <div>
                <strong>{selectedBatteryDefinition.name}</strong>
                <small>Sample game-catalogue values</small>
              </div>
            </div>
            <div className="property-row">
              <span>Chemistry</span>
              <span>{selectedBatteryDefinition.chemistry}</span>
            </div>
            <div className="property-row">
              <span>Voltage</span>
              <span>{selectedBatteryDefinition.voltage}V</span>
            </div>
            <div className="property-row">
              <span>Capacity</span>
              <span>
                {selectedBatteryDefinition.capacityMah.toLocaleString()} mAh
              </span>
            </div>
            <div className="property-row">
              <span>Dimensions (L × W × H)</span>
              <span>
                {formatDimensions(selectedBatteryDefinition.dimensions, "m", {
                  decimals: [2, 2, 3],
                })}
              </span>
            </div>
            <div className="property-row">
              <span>Weight</span>
              <span>
                {formatMass(selectedBatteryDefinition.weight, "kg", {
                  decimals: 2,
                })}
              </span>
            </div>
          </div>
        ) : (
          <p className="builder-intro">
            Select a battery from the catalogue.
          </p>
        )}

        <div className="battery-install-status" role="status">
          {installedBatteryDefinition
            ? `Installed: ${installedBatteryDefinition.name}`
            : "No battery installed. Battery installation is optional."}
        </div>
        <button
          className="primary-button foundation-confirm"
          disabled={!selectedBatteryDefinition}
          onClick={() => {
            if (selectedBatteryCatalogueId) {
              onInstallBattery(selectedBatteryCatalogueId);
            }
          }}
        >
          {installedBattery ? "Install / Replace Battery" : "Install Battery"}
        </button>
        <button
          className="danger-button battery-remove-button"
          disabled={!installedBattery}
          onClick={onRemoveBattery}
        >
          Remove Battery
        </button>
        <button
          className="primary-button foundation-confirm"
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
    );
  }

  if (stage === "controller" && foundation) {
    return (
      <>
        <div className="section-label">CONTROLLER SPECIFICATIONS</div>
        {selectedControllerDefinition ? (
          <div className="motor-spec-card">
            <div className="motor-spec-title">
              <span
                className="motor-card-icon"
                style={{ borderColor: selectedControllerDefinition.color }}
              >
                ▤
              </span>
              <div>
                <strong>{selectedControllerDefinition.name}</strong>
                <small>{selectedControllerDefinition.controllerType}</small>
              </div>
            </div>
            <div className="property-row">
              <span>Processor</span>
              <span>{selectedControllerDefinition.processor}</span>
            </div>
            <div className="property-row">
              <span>Clock speed</span>
              <span>{selectedControllerDefinition.clockMHz} MHz</span>
            </div>
            <div className="property-row">
              <span>Operating voltage</span>
              <span>{selectedControllerDefinition.operatingVoltage}</span>
            </div>
            <div className="property-row">
              <span>Dimensions (L × W × H)</span>
              <span>
                {formatDimensions(selectedControllerDefinition.dimensions, "mm", {
                  decimals: 1,
                })}
              </span>
            </div>
            <div className="property-row">
              <span>Weight</span>
              <span>
                {formatMass(selectedControllerDefinition.weight, "g", {
                  decimals: 0,
                })}
              </span>
            </div>
          </div>
        ) : (
          <p className="builder-intro">
            Select a controller from the catalogue.
          </p>
        )}

        <div className="controller-install-status" role="status">
          {installedControllerDefinition
            ? `Installed: ${installedControllerDefinition.name}`
            : "No controller installed. Installation is optional."}
        </div>
        <button
          className="primary-button foundation-confirm"
          disabled={!selectedControllerDefinition}
          onClick={() => {
            if (selectedControllerCatalogueId) {
              onInstallController(selectedControllerCatalogueId);
            }
          }}
        >
          {installedController
            ? "Install / Replace Controller"
            : "Install Controller"}
        </button>
        <button
          className="danger-button controller-remove-button"
          disabled={!installedController}
          onClick={onRemoveController}
        >
          Remove Controller
        </button>
        <button
          className="primary-button foundation-confirm"
          onClick={() => onSetStage("motors")}
        >
          Continue to Motors
        </button>
        <button
          className="stage-back-button"
          onClick={() => onSetStage("battery")}
        >
          ← Back to Battery
        </button>
      </>
    );
  }

  if (stage === "motors") {
    return (
      <>
        <div className="section-label">MOUNTING CONFIGURATION</div>
        {selectedMotorDefinition ? (
          <div className="motor-spec-card">
            <div className="motor-spec-title">
              <span
                className="motor-card-icon"
                style={{ borderColor: selectedMotorDefinition.color }}
              >
                ⚙
              </span>
              <div>
                <strong>{selectedMotorDefinition.name}</strong>
                <small>{selectedMotorDefinition.description}</small>
              </div>
            </div>
            <div className="property-row">
              <span>Weight</span>
              <span>{selectedMotorDefinition.weight.toFixed(2)} kg</span>
            </div>
            <div className="property-row">
              <span>RPM</span>
              <span>{selectedMotorDefinition.rpm}</span>
            </div>
            <div className="property-row">
              <span>Torque</span>
              <span>{selectedMotorDefinition.torque.toFixed(1)} N·m</span>
            </div>
            <div className="property-row">
              <span>Footprint</span>
              <span>
                {selectedMotorDefinition.mountingFootprint[0]} ×{" "}
                {selectedMotorDefinition.mountingFootprint[1]} m
              </span>
            </div>
          </div>
        ) : (
          <p className="builder-intro">Select a motor from the catalogue.</p>
        )}

        <div className="section-label">MOUNTING LOCATIONS</div>
        <div className="mount-zone-list">
          {motorMountZones.map((zone) => {
            const occupied = occupiedZoneIds.has(zone.id);
            return (
              <button
                key={zone.id}
                className={`mount-zone-item ${
                  selectedMountZoneId === zone.id ? "selected" : ""
                } ${occupied ? "occupied" : ""}`}
                onClick={() => onSelectMountZone(zone.id)}
              >
                <span>{zone.name}</span>
                <small>{occupied ? "Occupied" : "Available"}</small>
              </button>
            );
          })}
        </div>

        {selectedMountZoneId && (
          <div className="motor-actions">
            {occupiedZoneIds.has(selectedMountZoneId) ? (
              <>
                {selectedMotorDefinition && (
                  <button
                    className="primary-button"
                    onClick={() => onReplaceMotor(selectedMountZoneId)}
                  >
                    Replace Motor
                  </button>
                )}
                <button
                  className="danger-button"
                  onClick={() => onRemoveMotor(selectedMountZoneId)}
                >
                  Remove Motor
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const currentMotor = mountedMotors.find(
                      (motor) => motor.mountingZoneId === selectedMountZoneId
                    );
                    const zone = motorMountZones.find(
                      (item) => item.id === selectedMountZoneId
                    );
                    if (!currentMotor || !zone) return;
                    const isBaseline =
                      Math.abs(currentMotor.rotation[1] - zone.rotation[1]) < 0.001;
                    onRotateMotor(
                      selectedMountZoneId,
                      isBaseline ? zone.rotation[1] + Math.PI : zone.rotation[1]
                    );
                  }}
                >
                  Rotate 180°
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                disabled={!selectedMotorDefinition}
                onClick={onPlaceMotor}
              >
                Add Motor
              </button>
            )}
          </div>
        )}

        {structuralMotorCarriers.length > 0 && (
          <div className="workshop-mount-target">
            <div className="section-label">STRUCTURAL CARRIER MOUNTING</div>
            <label className="sim-select-field">
              <span>Structural Carrier</span>
              <select
                aria-label="Structural motor parent"
                value={activeMotorCarrier?.id ?? ""}
                onChange={(e) => {
                  setStructuralMotorParentId(e.target.value);
                  setStructuralMotorIfaceId("");
                }}
              >
                {structuralMotorCarriers.map((carrier) => (
                  <option key={carrier.id} value={carrier.id}>
                    {carrier.name}
                  </option>
                ))}
              </select>
            </label>
            {activeMotorCarrierInterfaces.length > 0 && (
              <label className="sim-select-field">
                <span>Mount Interface</span>
                <select
                  aria-label="Structural motor interface"
                  value={activeMotorCarrierIface?.id ?? ""}
                  onChange={(e) => setStructuralMotorIfaceId(e.target.value)}
                >
                  {activeMotorCarrierInterfaces.map((iface) => (
                    <option key={iface.id} value={iface.id}>
                      {iface.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={
                !selectedMotorDefinition ||
                !activeMotorCarrier ||
                mountedMotors.length >= 4
              }
              onClick={() => {
                if (!activeMotorCarrier) return;
                onMountMotorToParent(
                  activeMotorCarrier.id,
                  activeMotorCarrierIface?.id
                );
              }}
            >
              Mount {selectedMotorDefinition?.name ?? "Motor"} on Structure
            </button>
          </div>
        )}

        <div className="section-label">
          INSTALLED MOTORS ({mountedMotors.length}/4)
        </div>
        {mountedMotors.length ? (
          mountedMotors.map((motor) => (
            <div className="installed-motor" key={motor.id}>
              <span>{motor.name}</span>
              <small>{getMotorLocationLabel(motor)}</small>
            </div>
          ))
        ) : (
          <p className="builder-intro">No motors installed.</p>
        )}

        <button
          className="primary-button foundation-confirm"
          onClick={() => onSetStage("wheels")}
        >
          Continue to Wheels
        </button>
      </>
    );
  }

  if (stage === "wheels") {
    return (
      <>
        <div className="section-label">WHEEL SPECIFICATIONS</div>
        {selectedWheelDefinition ? (
          <div className="motor-spec-card">
            <div className="motor-spec-title">
              <span className="wheel-card-icon">◉</span>
              <div>
                <strong>{selectedWheelDefinition.name}</strong>
                <small>{selectedWheelDefinition.description}</small>
              </div>
            </div>
            <div className="property-row">
              <span>Category</span>
              <span>{selectedWheelDefinition.category}</span>
            </div>
            <div className="property-row">
              <span>Diameter</span>
              <span>
                {formatLength(selectedWheelDefinition.diameter, "cm", {
                  decimals: 0,
                })}
              </span>
            </div>
            <div className="property-row">
              <span>Width</span>
              <span>
                {formatLength(selectedWheelDefinition.width, "cm", {
                  decimals: 1,
                })}
              </span>
            </div>
            <div className="property-row">
              <span>Weight</span>
              <span>
                {formatMass(selectedWheelDefinition.weight, "kg", {
                  decimals: 2,
                })}
              </span>
            </div>
            <small className="spec-disclaimer">
              Placeholder simulation specifications, not manufacturer verified.
            </small>
          </div>
        ) : (
          <p className="builder-intro">
            Choose a wheel type from the catalogue.
          </p>
        )}

        {selectedWheelDefinition && (
          <>
            <div className="section-label">WHEEL CUSTOMIZATION</div>
            <div className="wheel-dimension-control">
              <div className="wheel-dimension-heading">
                <label htmlFor="wheel-diameter">Diameter</label>
                <span>{selectedWheelDiameterCm.toFixed(1)} cm</span>
              </div>
              <div className="wheel-dimension-inputs">
                <input
                  id="wheel-diameter"
                  aria-label="Wheel diameter in centimeters"
                  type="number"
                  min={8}
                  max={60}
                  step={0.1}
                  value={selectedWheelDiameterCm}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      onUpdateSelectedWheelDimensions({ diameterCm: value });
                    }
                  }}
                />
                <span>cm</span>
              </div>
              <input
                className="wheel-dimension-slider"
                aria-label="Wheel diameter slider"
                type="range"
                min={8}
                max={60}
                step={0.5}
                value={selectedWheelDiameterCm}
                onChange={(event) =>
                  onUpdateSelectedWheelDimensions({
                    diameterCm: Number(event.target.value),
                  })
                }
              />
              <div className="wheel-dimension-limits">
                <span>8 cm</span>
                <span>60 cm</span>
              </div>
            </div>

            <div className="wheel-dimension-control">
              <div className="wheel-dimension-heading">
                <label htmlFor="wheel-width">Width</label>
                <span>{selectedWheelWidthCm.toFixed(1)} cm</span>
              </div>
              <div className="wheel-dimension-inputs">
                <input
                  id="wheel-width"
                  aria-label="Wheel width in centimeters"
                  type="number"
                  min={3}
                  max={20}
                  step={0.1}
                  value={selectedWheelWidthCm}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      onUpdateSelectedWheelDimensions({ widthCm: value });
                    }
                  }}
                />
                <span>cm</span>
              </div>
              <input
                className="wheel-dimension-slider"
                aria-label="Wheel width slider"
                type="range"
                min={3}
                max={20}
                step={0.1}
                value={selectedWheelWidthCm}
                onChange={(event) =>
                  onUpdateSelectedWheelDimensions({
                    widthCm: Number(event.target.value),
                  })
                }
              />
              <div className="wheel-dimension-limits">
                <span>3 cm</span>
                <span>20 cm</span>
              </div>
            </div>
          </>
        )}

        <div className="section-label">
          ASSIGN TO MOTOR ({mountedMotors.length} INSTALLED)
        </div>
        {mountedMotors.length ? (
          <div className="wheel-motor-list">
            {mountedMotors.map((motor) => {
              const assignment = wheelByMotorId.get(motor.id);
              const motorDefinition = motorCatalogue.find(
                (item) => item.id === motor.motorCatalogueId
              );
              const compatible = Boolean(
                selectedWheelDefinition &&
                  motor.motorCatalogueId &&
                  selectedWheelDefinition.compatibleMotorIds.includes(
                    motor.motorCatalogueId
                  )
              );
              return (
                <button
                  key={motor.id}
                  className={`wheel-motor-card ${
                    selectedWheelMotorId === motor.id ? "selected" : ""
                  }`}
                  onClick={() => onSelectWheelMotor(motor.id)}
                >
                  <span>
                    <strong>{motorDefinition?.name ?? motor.name}</strong>
                    <small>{getMotorLocationLabel(motor)}</small>
                  </span>
                  <small className={assignment ? "assignment-installed" : ""}>
                    {assignment
                      ? `${assignment.name} · Replace`
                      : selectedWheelDefinition && !compatible
                        ? "Not compatible"
                        : "Unassigned"}
                  </small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="builder-intro">
            Install at least one motor in the Motors stage before assigning wheels.
          </p>
        )}

        {selectedWheelMotor && (
          <div className="wheel-assignment-actions">
            <div className="assignment-target">
              Selected motor:{" "}
              <strong>
                {selectedWheelMotorDefinition?.name ?? selectedWheelMotor.name}
              </strong>
            </div>
            {selectedWheelDefinition &&
              selectedWheelMotor.motorCatalogueId &&
              !selectedWheelDefinition.compatibleMotorIds.includes(
                selectedWheelMotor.motorCatalogueId
              ) && (
                <p className="compatibility-warning">
                  This wheel is not compatible with the selected motor.
                </p>
              )}
            <button
              className="primary-button"
              disabled={
                !selectedWheelDefinition ||
                !selectedWheelMotor.motorCatalogueId ||
                !selectedWheelDefinition.compatibleMotorIds.includes(
                  selectedWheelMotor.motorCatalogueId
                )
              }
              onClick={() => onAssignWheel(selectedWheelMotor.id)}
            >
              {selectedMotorWheel ? "Replace Wheel" : "Mount Wheel"}
            </button>
            {selectedMotorWheel && (
              <button
                className="danger-button"
                onClick={() => onRemoveWheel(selectedWheelMotor.id)}
              >
                Remove Wheel
              </button>
            )}
          </div>
        )}

        <div className="section-label">
          INSTALLED WHEELS ({mountedWheels.length})
        </div>
        {mountedMotors.map((motor) => {
          const wheel = wheelByMotorId.get(motor.id);
          return (
            <div className="installed-motor" key={motor.id}>
              <span>{wheel?.name ?? "No wheel assigned"}</span>
              <small>{getMotorLocationLabel(motor)}</small>
            </div>
          );
        })}

        <button
          className="primary-button foundation-confirm"
          onClick={() => onSetStage("drivetrain")}
        >
          Continue to Drivetrain
        </button>
        <button
          className="stage-back-button"
          onClick={() => onSetStage("motors")}
        >
          ← Back to Motors
        </button>
      </>
    );
  }

  if (stage === "completed" && foundation) {
    return (
      <CompletedBuildSummary
        foundation={foundation}
        installedBatteryDefinition={installedBatteryDefinition}
        installedControllerDefinition={installedControllerDefinition}
        mountedMotors={mountedMotors}
        mountedWheels={mountedWheels}
        wheelByMotorId={wheelByMotorId}
        drivetrain={drivetrain}
        poweredWheelAssemblies={poweredWheelAssemblies}
        performanceProfile={performanceProfile}
        stabilityProfile={stabilityProfile}
        inertiaProfile={inertiaProfile}
        getMotorLocationLabel={getMotorLocationLabel}
        onSetStage={onSetStage}
      />
    );
  }

  return (
    <div className="placeholder-content">
      <div className="placeholder-icon">▣</div>
      <p>Start a build to configure your foundation.</p>
    </div>
  );
}
