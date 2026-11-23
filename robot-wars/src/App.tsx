import { Canvas } from "@react-three/fiber";
import { useState, type ReactNode } from "react";
import { useRobotStore } from "./store/robotStore";

import RobotScene from "./components/viewport/RobotScene";
import type { MountCandidate } from "./features/robot-builder/logic/mounting";
import { foundationModels } from "./features/robot-builder/data/foundationModels";
import { motorCatalogue } from "./features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "./features/robot-builder/data/wheelCatalogue";
import { batteryCatalogue } from "./features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "./features/robot-builder/data/controllerCatalogue";
import { generateMotorMountZones } from "./features/robot-builder/logic/mountingZones";
import {
  getDrivetrainAssignmentKey,
  getDrivetrainSlotCount,
  getPoweredWheelAssemblies,
  validateDrivetrain,
} from "./features/robot-builder/logic/drivetrain";
import type {
  DrivetrainSide,
  DrivetrainType,
} from "./features/robot-builder/types/robot.types";
import {
  getAssemblyFocusFrame,
  getComponentFocusFrame,
  getVisibleSelectedPart,
  type CameraFocusFrame,
  type CameraFocusRequest,
} from "./features/robot-builder/logic/viewportFocus";
import {
  kgToGrams,
  metersToCm,
  metersToMm,
} from "./features/robot-builder/logic/units";

import "./App.css";

type NumericInputProps = {
  value: number;
  onValidChange: (value: number) => void;
  min?: number;
  step?: number;
};

function NumericInput({
  value,
  onValidChange,
  min,
  step = 0.1,
}: NumericInputProps) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(event) => {
        const nextDraft = event.target.value;

        if (nextDraft.trim() === "") return;

        const nextValue = Number(nextDraft);
        if (!Number.isFinite(nextValue)) return;
        if (min !== undefined && nextValue < min) return;

        onValidChange(nextValue);
      }}
      onBlur={(event) => {
        const nextValue = Number(event.currentTarget.value);

        if (
          event.currentTarget.value.trim() === "" ||
          !Number.isFinite(nextValue) ||
          (min !== undefined && nextValue < min)
        ) {
          event.currentTarget.value = String(value);
        }
      }}
    />
  );
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {visible ? (
        <>
          <path d="M1.5 8s2.2-4.5 6.5-4.5S14.5 8 14.5 8 12.3 12.5 8 12.5 1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="1.8" />
        </>
      ) : (
        <>
          <path d="M2 5.2C1.7 5.6 1.5 6 1.5 6s2.2 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7M5.2 3.8A6.2 6.2 0 0 1 8 3.2c4.3 0 6.5 4.5 6.5 4.5s-.5 1-1.6 2" />
          <path d="m2 2 12 12" />
        </>
      )}
    </svg>
  );
}

// --------------------------------------------------
// APPLICATION
// --------------------------------------------------

function App() {
  const [mountCandidate, setMountCandidate] =
    useState<MountCandidate | null>(null);
  const [collapsedPartIds, setCollapsedPartIds] = useState<Set<string>>(
    () => new Set()
  );
  const [cameraFocusRequest, setCameraFocusRequest] =
    useState<CameraFocusRequest>({
      key: 0,
      target: [0, 0.175, 0],
      radius: 1,
    });
  const [confirmAutoMap, setConfirmAutoMap] = useState(false);
  const [pendingDrivetrainType, setPendingDrivetrainType] =
    useState<DrivetrainType | null>(null);
  const parts = useRobotStore((state) => state.parts);
  const hiddenPartIds = useRobotStore((state) => state.hiddenPartIds);
  const selectedId = useRobotStore((state) => state.selectedId);
  const transformMode = useRobotStore((state) => state.transformMode);

  const setSelectedId = useRobotStore((state) => state.setSelectedId);
  const togglePartVisibility = useRobotStore(
    (state) => state.togglePartVisibility
  );
  const mountWheelToMotor = useRobotStore(
    (state) => state.mountWheelToMotor
  );
  const connections = useRobotStore((state) => state.connections);
  const foundation = useRobotStore((state) => state.foundation);
  const startNewBuild = useRobotStore((state) => state.startNewBuild);
  const selectFoundationModel = useRobotStore(
    (state) => state.selectFoundationModel
  );
  const updateFoundationDimensions = useRobotStore(
    (state) => state.updateFoundationDimensions
  );
  const setFoundationOptions = useRobotStore(
    (state) => state.setFoundationOptions
  );
  const confirmFoundation = useRobotStore(
    (state) => state.confirmFoundation
  );
  const selectedBatteryCatalogueId = useRobotStore(
    (state) => state.selectedBatteryCatalogueId
  );
  const selectBatteryCatalogueItem = useRobotStore(
    (state) => state.selectBatteryCatalogueItem
  );
  const installBattery = useRobotStore((state) => state.installBattery);
  const removeBattery = useRobotStore((state) => state.removeBattery);
  const selectedControllerCatalogueId = useRobotStore(
    (state) => state.selectedControllerCatalogueId
  );
  const selectControllerCatalogueItem = useRobotStore(
    (state) => state.selectControllerCatalogueItem
  );
  const installController = useRobotStore(
    (state) => state.installController
  );
  const removeController = useRobotStore((state) => state.removeController);
  const stage = useRobotStore((state) => state.stage);
  const setStage = useRobotStore((state) => state.setStage);
  const drivetrain = useRobotStore((state) => state.drivetrain);
  const setDrivetrainType = useRobotStore(
    (state) => state.setDrivetrainType
  );
  const setDrivetrainAssignment = useRobotStore(
    (state) => state.setDrivetrainAssignment
  );
  const applySuggestedDrivetrainMapping = useRobotStore(
    (state) => state.applySuggestedDrivetrainMapping
  );
  const selectedMotorCatalogueId = useRobotStore(
    (state) => state.selectedMotorCatalogueId
  );
  const selectedMountZoneId = useRobotStore(
    (state) => state.selectedMountZoneId
  );
  const selectMotorCatalogueItem = useRobotStore(
    (state) => state.selectMotorCatalogueItem
  );
  const selectMountZone = useRobotStore(
    (state) => state.selectMountZone
  );
  const placeMotor = useRobotStore((state) => state.placeMotor);
  const replaceMotor = useRobotStore((state) => state.replaceMotor);
  const removeMotor = useRobotStore((state) => state.removeMotor);
  const rotateMotor = useRobotStore((state) => state.rotateMotor);
  const selectedWheelCatalogueId = useRobotStore(
    (state) => state.selectedWheelCatalogueId
  );
  const selectedWheelMotorId = useRobotStore(
    (state) => state.selectedWheelMotorId
  );
  const selectedWheelDiameterCm = useRobotStore(
    (state) => state.selectedWheelDiameterCm
  );
  const selectedWheelWidthCm = useRobotStore(
    (state) => state.selectedWheelWidthCm
  );
  const selectWheelCatalogueItem = useRobotStore(
    (state) => state.selectWheelCatalogueItem
  );
  const updateSelectedWheelDimensions = useRobotStore(
    (state) => state.updateSelectedWheelDimensions
  );
  const selectWheelMotor = useRobotStore((state) => state.selectWheelMotor);
  const assignWheel = useRobotStore((state) => state.assignWheel);
  const removeWheel = useRobotStore((state) => state.removeWheel);
  const finishBuild = useRobotStore((state) => state.finishBuild);

  const hiddenPartIdSet = new Set(hiddenPartIds);
  const visibleParts = parts.filter((part) => !hiddenPartIdSet.has(part.id));
  const selectedPart = parts.find((part) => part.id === selectedId) ?? null;
  const focusableSelectedPart = getVisibleSelectedPart(
    parts,
    selectedId,
    hiddenPartIds
  );
  const selectedPartIsHidden = Boolean(
    selectedPart && !focusableSelectedPart
  );
  const requestCameraFocus = (frame: CameraFocusFrame | null) => {
    if (!frame) return;
    setCameraFocusRequest((request) => ({
      ...frame,
      key: request.key + 1,
    }));
  };
  const childrenByParent = new Map<string, typeof parts>();
  for (const connection of connections) {
    const parentId = connection.parentId ?? connection.sourceId;
    const childId = connection.childId ?? connection.targetId;
    const child = parts.find((part) => part.id === childId);
    if (!child || !parts.some((part) => part.id === parentId)) continue;

    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      child,
    ]);
  }
  const renderHierarchy = (partId: string, depth = 0): ReactNode => {
    const part = parts.find((item) => item.id === partId);
    if (!part) return null;
    const children = childrenByParent.get(part.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = hasChildren && !collapsedPartIds.has(part.id);
    const visible = !hiddenPartIdSet.has(part.id);

    return (
      <div key={part.id}>
        <div
          className={`tree-item ${
            selectedId === part.id ? "selected" : ""
          }`}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="tree-expand"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${part.name}`}
              aria-expanded={expanded}
              onClick={() =>
                setCollapsedPartIds((current) => {
                  const next = new Set(current);
                  if (next.has(part.id)) next.delete(part.id);
                  else next.add(part.id);
                  return next;
                })
              }
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="tree-expand-spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className="tree-select"
            aria-label={`Select ${part.name}`}
            aria-pressed={selectedId === part.id}
            onClick={() => setSelectedId(part.id)}
          >
            <span className="tree-icon" aria-hidden="true">▣</span>
            <span className="tree-label">{part.name}</span>
          </button>
          <button
            type="button"
            className={`tree-visibility ${visible ? "visible" : "hidden"}`}
            aria-label={`${visible ? "Hide" : "Show"} ${part.name}`}
            aria-pressed={!visible}
            title={`${visible ? "Hide" : "Show"} ${part.name}`}
            onClick={() => togglePartVisibility(part.id)}
          >
            <VisibilityIcon visible={visible} />
          </button>
        </div>
        {expanded &&
          children.map((child) => renderHierarchy(child.id, depth + 1))}
      </div>
    );
  };

  const attachedChildIds = new Set<string>();
  for (const children of childrenByParent.values()) {
    children.forEach((child) => attachedChildIds.add(child.id));
  }
  const independentParts = parts.filter(
    (part) => !attachedChildIds.has(part.id)
  );
  const mountedMotors = parts.filter(
    (part) => part.type === "Motor" && part.mountingZoneId
  );
  const motorMountZones = foundation
    ? generateMotorMountZones(foundation)
    : [];
  const selectedMotorDefinition = motorCatalogue.find(
    (motor) => motor.id === selectedMotorCatalogueId
  );
  const selectedWheelDefinition = wheelCatalogue.find(
    (wheel) => wheel.id === selectedWheelCatalogueId
  );
  const selectedBatteryDefinition = batteryCatalogue.find(
    (battery) => battery.id === selectedBatteryCatalogueId
  );
  const installedBattery = parts.find((part) => part.type === "Battery");
  const installedBatteryDefinition = batteryCatalogue.find(
    (battery) => battery.id === installedBattery?.batteryCatalogueId
  );
  const selectedControllerDefinition = controllerCatalogue.find(
    (controller) => controller.id === selectedControllerCatalogueId
  );
  const installedController = parts.find((part) => part.type === "Controller");
  const installedControllerDefinition = controllerCatalogue.find(
    (controller) => controller.id === installedController?.controllerCatalogueId
  );
  const mountedWheels = parts.filter((part) => part.type === "Wheel");
  const wheelByMotorId = new Map<
    string,
    (typeof mountedWheels)[number]
  >();
  connections
    .filter((connection) => connection.type === "Motor-Wheel")
    .forEach((connection) => {
      const wheel = mountedWheels.find(
        (part) => part.id === connection.childId
      );
      if (wheel) wheelByMotorId.set(connection.parentId, wheel);
    });
  const selectedWheelMotor = mountedMotors.find(
    (motor) => motor.id === selectedWheelMotorId
  );
  const selectedWheelMotorDefinition = motorCatalogue.find(
    (motor) => motor.id === selectedWheelMotor?.motorCatalogueId
  );
  const selectedMotorWheel = selectedWheelMotor
    ? wheelByMotorId.get(selectedWheelMotor.id)
    : undefined;
  const occupiedZoneIds = new Set(
    mountedMotors.map((motor) => motor.mountingZoneId)
  );
  const poweredWheelAssemblies = getPoweredWheelAssemblies(
    parts,
    connections,
    foundation
  );
  const drivetrainValidation = validateDrivetrain(
    drivetrain,
    parts,
    connections,
    foundation
  );
  const drivetrainSlotCount = getDrivetrainSlotCount(drivetrain.type);

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
                      getDrivetrainAssignmentKey(assembly) ===
                      event.target.value
                  );
                  setDrivetrainAssignment(
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
                {poweredWheelAssemblies.map((assembly) => {
                  return (
                    <option
                      key={getDrivetrainAssignmentKey(assembly)}
                      value={getDrivetrainAssignmentKey(assembly)}
                    >
                      {assembly.mountingLocation}: {assembly.motor.name} +{" "}
                      {assembly.wheel.name}
                    </option>
                  );
                })}
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

  return (
    <div className="workshop">

      {/* HEADER */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">R</div>

          <div>
            <div className="brand-name">ROBOT WARS</div>
            <div className="brand-subtitle">
              ENGINEERING WORKSHOP
            </div>
          </div>
        </div>

        <div className="project-name">
          <span className="status-dot" />
          Untitled Robot
        </div>

        <div className="topbar-actions">
          <button className="top-button">Save</button>
          <button className="top-button">Export</button>
          <button className="primary-button">Test Robot</button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="main-layout">

        {/* LEFT PANEL */}
        <aside className="left-panel">
          <div className="panel-content">
            <div className="builder-steps">
              <div className={`builder-step ${
                stage === "foundation" ? "active" : "complete"
              }`}>
                <span>1</span>
                Foundation
              </div>
              <div className={`builder-step ${
                stage === "battery"
                  ? "active"
                  : stage === "controller" ||
                      stage === "motors" ||
                      stage === "wheels" ||
                      stage === "drivetrain" ||
                      stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>2</span>
                Battery
              </div>
              <div className={`builder-step ${
                stage === "controller"
                  ? "active"
                  : stage === "motors" ||
                      stage === "wheels" ||
                      stage === "drivetrain" ||
                      stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>3</span>
                Controller
              </div>
              <div className={`builder-step ${
                stage === "motors"
                  ? "active"
                  : stage === "wheels" ||
                      stage === "drivetrain" ||
                      stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>4</span>
                Motors
              </div>
              <div className={`builder-step ${
                stage === "wheels"
                  ? "active"
                  : stage === "drivetrain" || stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>5</span>
                Wheels
              </div>
              <div className={`builder-step ${
                stage === "drivetrain"
                  ? "active"
                  : stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>6</span>
                Drivetrain
              </div>
            </div>

            {stage === "foundation" && foundation ? (
              <>
                <div className="section-label">FOUNDATION MODEL</div>
                <div className="foundation-list">
                  {foundationModels.map((model) => (
                    <button
                      key={model.id}
                      className={`foundation-card ${
                        foundation.modelId === model.id ? "selected" : ""
                      }`}
                      onClick={() => selectFoundationModel(model.id)}
                    >
                      <span className="foundation-card-icon">
                        {model.icon}
                      </span>
                      <span>
                        <strong>{model.name}</strong>
                        <small>{model.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
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
                        selectedBatteryCatalogueId === battery.id
                          ? "selected"
                          : ""
                      }`}
                      onClick={() => selectBatteryCatalogueItem(battery.id)}
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
                  onClick={() => setStage("controller")}
                >
                  Continue to Controller
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
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
                      onClick={() =>
                        selectControllerCatalogueItem(controller.id)
                      }
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
                  onClick={() => setStage("battery")}
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
                      onClick={() => selectMotorCatalogueItem(motor.id)}
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
                  onClick={() => setStage("controller")}
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
                      onClick={() => selectWheelCatalogueItem(wheel.id)}
                    >
                      <span className="wheel-card-icon">◉</span>
                      <span>
                        <strong>{wheel.name}</strong>
                        <small>
                          {metersToCm(wheel.diameter).toFixed(0)} cm ×{" "}
                          {metersToCm(wheel.width).toFixed(1)} cm ·{" "}
                          {wheel.category}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
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
                  onClick={() => setStage("wheels")}
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
                  onClick={() => setStage("wheels")}
                >
                  ← Edit Wheels
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  ← Edit Motors
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("drivetrain")}
                >
                  ← Edit Drivetrain
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  ← Edit Foundation
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("battery")}
                >
                  ← Edit Battery
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("controller")}
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
            ROBOT STRUCTURE
          </div>

          <div className="panel-content">
            <div className="section-label">
              ASSEMBLY
            </div>

            {independentParts.map((part) => renderHierarchy(part.id))}
          </div>

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

        {/* 3D VIEWPORT */}
        <main className="viewport">
          <Canvas
            shadows
            camera={{ position: [4.5, 4.2, 6], fov: 44 }}
            gl={{ antialias: true }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <color attach="background" args={["#10151d"]} />

            <RobotScene
              parts={parts}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              transformMode={transformMode}
              mountCandidate={mountCandidate}
              onMountCandidateChange={setMountCandidate}
              cameraFocusRequest={cameraFocusRequest}
            />
          </Canvas>

          {/* VIEWPORT OVERLAY */}
          <div className="viewport-overlay viewport-top-left">
            <div className="overlay-title">
              3D WORKSPACE
            </div>

            <div className="overlay-subtitle">
              Interactive Construction Mode
            </div>
          </div>

          <div className="viewport-overlay viewport-bottom">
            <span>Orbit: Left Mouse</span>
            <span>Zoom: Scroll</span>
            <span>Pan: Right Mouse</span>
          </div>

          <div className="viewport-focus">
            <div className="viewport-focus-actions">
              <button
                type="button"
                onClick={() =>
                  requestCameraFocus(getAssemblyFocusFrame(visibleParts))
                }
                disabled={!foundation || visibleParts.length === 0}
                title="Center and frame the visible robot"
              >
                Focus Robot
              </button>
              <button
                type="button"
                onClick={() => {
                  if (focusableSelectedPart) {
                    requestCameraFocus(
                      getComponentFocusFrame(focusableSelectedPart)
                    );
                  }
                }}
                disabled={!focusableSelectedPart}
                title={
                  selectedPartIsHidden
                    ? "Show this component in the Assembly tree before focusing"
                    : selectedPart
                      ? "Center and frame the selected component"
                      : "Select a component before focusing"
                }
              >
                Focus Component
              </button>
            </div>
            {selectedPartIsHidden && selectedPart && (
              <div className="viewport-focus-note" role="status">
                {selectedPart.name} is hidden. Show it in the Assembly tree before focusing.
              </div>
            )}
            {foundation &&
              visibleParts.length === 0 &&
              !selectedPartIsHidden && (
                <div className="viewport-focus-note" role="status">
                  Show a component to focus the robot.
                </div>
              )}
          </div>

          {!foundation && (
            <div className="foundation-start">
              <span className="foundation-start-icon">▣</span>
              <h2>Start a new robot</h2>
              <p>Step 1 begins with choosing and configuring your foundation.</p>
              <button onClick={startNewBuild}>Start Foundation Build</button>
            </div>
          )}

          {mountCandidate && (
            <div className="mount-confirmation" role="dialog">
              <div>Mount this wheel to the motor?</div>
              <div className="mount-actions">
                <button
                  onClick={() => {
                    mountWheelToMotor(
                      mountCandidate.motorId,
                      mountCandidate.wheelId
                    );
                    setMountCandidate(null);
                  }}
                >
                  Mount
                </button>
                <button
                  className="mount-cancel"
                  onClick={() => setMountCandidate(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </main>

        {/* RIGHT PANEL */}
        <aside className="right-panel">
          <div className="panel-heading">
            PROPERTIES
          </div>

          <div className="panel-content">
            {stage === "drivetrain" && foundation ? (
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
                      const nextSlotCount =
                        getDrivetrainSlotCount(nextType);
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
                        setDrivetrainType(nextType);
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
                        setDrivetrainType(pendingDrivetrainType, true);
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
                      applySuggestedDrivetrainMapping();
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
                        applySuggestedDrivetrainMapping(true);
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
                    {drivetrainValidation.errors.map((error) => (
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
                    {drivetrain[side].every(
                      (assignment) => assignment === null
                    ) ? (
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
                  disabled={
                    !drivetrainValidation.isValid ||
                    pendingDrivetrainType !== null
                  }
                  onClick={finishBuild}
                >
                  Complete Build
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("wheels")}
                >
                  ← Back to Wheels
                </button>
              </>
            ) : stage === "foundation" && foundation ? (
              <>
                <div className="section-label">FOUNDATION CONFIGURATION</div>

                <div className="object-card">
                  <div className="object-icon">▣</div>
                  <div>
                    <div className="object-name">
                      {foundationModels.find(
                        (model) => model.id === foundation.modelId
                      )?.name}
                    </div>
                    <div className="object-type">Primary robot structure</div>
                  </div>
                </div>

                <div className="property-row">
                  <span>Length</span>
                  <NumericInput
                    value={foundation.length}
                    min={0.8}
                    step={0.1}
                    onValidChange={(length) =>
                      updateFoundationDimensions({ length })
                    }
                  />
                </div>
                <div className="property-row">
                  <span>Width</span>
                  <NumericInput
                    value={foundation.width}
                    min={0.8}
                    step={0.1}
                    onValidChange={(width) =>
                      updateFoundationDimensions({ width })
                    }
                  />
                </div>
                <div className="property-row">
                  <span>Thickness</span>
                  <NumericInput
                    value={foundation.height}
                    min={0.12}
                    step={0.05}
                    onValidChange={(height) =>
                      updateFoundationDimensions({ height })
                    }
                  />
                </div>

                <div className="section-label">STRUCTURAL DETAILS</div>
                <label className="foundation-option">
                  <input
                    type="checkbox"
                    checked={foundation.includeTopPlate}
                    onChange={(event) =>
                      setFoundationOptions({
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
                      setFoundationOptions({
                        includeFrontCover: event.target.checked,
                      })
                    }
                  />
                  Front protective cover
                </label>

                {foundation.confirmed ? (
                  <div className="foundation-confirmed">
                    <span>✓</span>
                    Foundation confirmed
                  </div>
                ) : (
                  <button
                    className="primary-button foundation-confirm"
                    onClick={confirmFoundation}
                  >
                    Confirm Foundation
                  </button>
                )}
              </>
            ) : stage === "battery" && foundation ? (
              <>
                <div className="section-label">BATTERY SPECIFICATIONS</div>
                {selectedBatteryDefinition ? (
                  <div className="motor-spec-card">
                    <div className="motor-spec-title">
                      <span
                        className="motor-card-icon"
                        style={{
                          borderColor: selectedBatteryDefinition.color,
                        }}
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
                        {selectedBatteryDefinition.capacityMah.toLocaleString()}{" "}
                        mAh
                      </span>
                    </div>
                    <div className="property-row">
                      <span>Dimensions (L × W × H)</span>
                      <span>
                        {selectedBatteryDefinition.dimensions.length.toFixed(2)}{" "}
                        × {selectedBatteryDefinition.dimensions.width.toFixed(2)}{" "}
                        × {selectedBatteryDefinition.dimensions.height.toFixed(3)}{" "}
                        m
                      </span>
                    </div>
                    <div className="property-row">
                      <span>Weight</span>
                      <span>{selectedBatteryDefinition.weight.toFixed(2)} kg</span>
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
                      installBattery(selectedBatteryCatalogueId);
                    }
                  }}
                >
                  {installedBattery ? "Install / Replace Battery" : "Install Battery"}
                </button>
                <button
                  className="danger-button battery-remove-button"
                  disabled={!installedBattery}
                  onClick={removeBattery}
                >
                  Remove Battery
                </button>
                <button
                  className="primary-button foundation-confirm"
                  onClick={() => setStage("controller")}
                >
                  Continue to Controller
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  ← Back to Foundation
                </button>
              </>
            ) : stage === "controller" && foundation ? (
              <>
                <div className="section-label">CONTROLLER SPECIFICATIONS</div>
                {selectedControllerDefinition ? (
                  <div className="motor-spec-card">
                    <div className="motor-spec-title">
                      <span
                        className="motor-card-icon"
                        style={{
                          borderColor: selectedControllerDefinition.color,
                        }}
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
                        {metersToMm(selectedControllerDefinition.dimensions.length).toFixed(1)} ×{" "}
                        {metersToMm(selectedControllerDefinition.dimensions.width).toFixed(1)} ×{" "}
                        {metersToMm(selectedControllerDefinition.dimensions.height).toFixed(1)} mm
                      </span>
                    </div>
                    <div className="property-row">
                      <span>Weight</span>
                      <span>
                        {kgToGrams(selectedControllerDefinition.weight).toFixed(0)} g
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
                      installController(selectedControllerCatalogueId);
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
                  onClick={removeController}
                >
                  Remove Controller
                </button>
                <button
                  className="primary-button foundation-confirm"
                  onClick={() => setStage("motors")}
                >
                  Continue to Motors
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("battery")}
                >
                  ← Back to Battery
                </button>
              </>
            ) : stage === "motors" ? (
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
                        onClick={() => selectMountZone(zone.id)}
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
                            onClick={() => replaceMotor(selectedMountZoneId)}
                          >
                            Replace Motor
                          </button>
                        )}
                        <button
                          className="danger-button"
                          onClick={() => removeMotor(selectedMountZoneId)}
                        >
                          Remove Motor
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            const currentMotor = mountedMotors.find(
                              (motor) =>
                                motor.mountingZoneId === selectedMountZoneId
                            );
                            const zone = motorMountZones.find(
                              (item) => item.id === selectedMountZoneId
                            );
                            if (!currentMotor || !zone) return;
                            const isBaseline =
                              Math.abs(currentMotor.rotation[1] - zone.rotation[1]) < 0.001;
                            rotateMotor(
                              selectedMountZoneId,
                              isBaseline
                                ? zone.rotation[1] + Math.PI
                                : zone.rotation[1]
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
                        onClick={placeMotor}
                      >
                        Add Motor
                      </button>
                    )}
                  </div>
                )}

                <div className="section-label">
                  INSTALLED MOTORS ({mountedMotors.length}/4)
                </div>
                {mountedMotors.length ? (
                  mountedMotors.map((motor) => (
                    <div className="installed-motor" key={motor.id}>
                      <span>{motor.name}</span>
                      <small>
                        {motorMountZones.find(
                          (zone) => zone.id === motor.mountingZoneId
                        )?.name}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="builder-intro">No motors installed.</p>
                )}

                <button
                  className="primary-button foundation-confirm"
                  onClick={() => setStage("wheels")}
                >
                  Continue to Wheels
                </button>
              </>
            ) : stage === "wheels" ? (
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
                      <span>{metersToCm(selectedWheelDefinition.diameter).toFixed(0)} cm</span>
                    </div>
                    <div className="property-row">
                      <span>Width</span>
                      <span>{metersToCm(selectedWheelDefinition.width).toFixed(1)} cm</span>
                    </div>
                    <div className="property-row">
                      <span>Weight</span>
                      <span>{selectedWheelDefinition.weight.toFixed(2)} kg</span>
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
                              updateSelectedWheelDimensions({
                                diameterCm: value,
                              });
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
                          updateSelectedWheelDimensions({
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
                              updateSelectedWheelDimensions({
                                widthCm: value,
                              });
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
                          updateSelectedWheelDimensions({
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
                          onClick={() => selectWheelMotor(motor.id)}
                        >
                          <span>
                            <strong>{motorDefinition?.name ?? motor.name}</strong>
                            <small>
                              {motorMountZones.find(
                                (zone) => zone.id === motor.mountingZoneId
                              )?.name}
                            </small>
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
                      onClick={() => assignWheel(selectedWheelMotor.id)}
                    >
                      {selectedMotorWheel ? "Replace Wheel" : "Mount Wheel"}
                    </button>
                    {selectedMotorWheel && (
                      <button
                        className="danger-button"
                        onClick={() => removeWheel(selectedWheelMotor.id)}
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
                      <small>
                        {motorMountZones.find(
                          (zone) => zone.id === motor.mountingZoneId
                        )?.name}
                      </small>
                    </div>
                  );
                })}

                <button
                  className="primary-button foundation-confirm"
                  onClick={() => setStage("drivetrain")}
                >
                  Continue to Drivetrain
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  ← Back to Motors
                </button>
              </>
            ) : stage === "completed" && foundation ? (
              <>
                <div className="section-label">ROBOT BUILD SUMMARY</div>
                <div className="motor-spec-card">
                  <strong>
                    {foundationModels.find(
                      (model) => model.id === foundation.modelId
                    )?.name}
                  </strong>
                  <div className="property-row">
                    <span>Foundation</span>
                    <span>
                      {foundation.length.toFixed(2)} × {foundation.width.toFixed(2)} ×{" "}
                      {foundation.height.toFixed(2)} m
                    </span>
                  </div>
                  <div className="property-row">
                    <span>Battery</span>
                    <span>
                      {installedBatteryDefinition?.name ?? "None installed"}
                    </span>
                  </div>
                  <div className="property-row">
                    <span>Controller</span>
                    <span>
                      {installedControllerDefinition?.name ?? "None installed"}
                    </span>
                  </div>
                  <div className="property-row">
                    <span>Installed motors</span>
                    <span>{mountedMotors.length}</span>
                  </div>
                  <div className="property-row">
                    <span>Installed wheels</span>
                    <span>{mountedWheels.length}</span>
                  </div>
                </div>
                <div className="section-label">MOTORS & WHEELS</div>
                {mountedMotors.map((motor) => (
                  <div className="installed-motor" key={motor.id}>
                    <span>{motor.name}</span>
                    <small>
                      {motorMountZones.find(
                        (zone) => zone.id === motor.mountingZoneId
                      )?.name}
                      {" · "}
                      {wheelByMotorId.get(motor.id)?.name ?? "No wheel"}
                    </small>
                  </div>
                ))}
                <div className="section-label">DRIVETRAIN</div>
                <div className="drivetrain-summary-card">
                  <strong>
                    {drivetrain.type === "differential-2"
                      ? "Differential Drive · 2 wheel"
                      : "4-Wheel Differential Drive"}
                  </strong>
                  <span className="drivetrain-status valid">
                    Configuration valid
                  </span>
                  {(["left", "right"] as const).map((side) => (
                    <div className="drivetrain-summary-side" key={side}>
                      <strong>
                        {side === "left" ? "Left" : "Right"} drive group
                      </strong>
                      {drivetrain[side].map((assignment, index) => {
                        if (!assignment) return null;
                        const assembly = poweredWheelAssemblies.find(
                          (item) =>
                            item.motorId === assignment.motorId &&
                            item.wheelId === assignment.wheelId
                        );
                        return assembly ? (
                          <small key={`${side}-complete-${index}`}>
                            {assembly.mountingLocation}: {assembly.motor.name} ·{" "}
                            {assembly.wheel.name}
                          </small>
                        ) : null;
                      })}
                    </div>
                  ))}
                </div>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("drivetrain")}
                >
                  Edit Drivetrain
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  Edit Foundation
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("battery")}
                >
                  Edit Battery
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("controller")}
                >
                  Edit Controller
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  Edit Motors
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("wheels")}
                >
                  Edit Wheels
                </button>
              </>
            ) : (
              <div className="placeholder-content">
                <div className="placeholder-icon">▣</div>
                <p>Start a build to configure your foundation.</p>
              </div>
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

      {/* FOOTER */}
      <footer className="statusbar">
        <span>ROBOT WARS / WORKSHOP</span>
        <span>OBJECTS: {parts.length}</span>
        <span>ENGINE: THREE.JS</span>
      </footer>
    </div>
  );
}

export default App;
