import { useMemo } from "react";
import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../features/robot-builder/types/robot.types";
import type { ElectricalConnection } from "../features/electrical/types/electrical.types";
import { batteryCatalogue } from "../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../features/robot-builder/data/controllerCatalogue";
import { motorCatalogue } from "../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { validateRobotAssembly } from "../features/robot-builder/logic/assemblyValidation";
import {
  getDrivetrainSlotCount,
  getPoweredWheelAssemblies,
  resolveMotorMechanicalSupport,
  validateDrivetrain,
} from "../features/robot-builder/logic/drivetrain";
import { generateMotorMountZones } from "../features/robot-builder/logic/mountingZones";
import { compileRobotInertiaProfile } from "../features/robot-builder/logic/robotInertia";
import { compileRobotPerformanceProfile } from "../features/robot-builder/logic/robotKinematics";
import { compileRobotStabilityProfile } from "../features/robot-builder/logic/robotStability";
import { getVisibleSelectedPart } from "../features/robot-builder/logic/viewportFocus";

export interface UseWorkshopDerivedStateInput {
  readonly parts: RobotPart[];
  readonly connections: RobotConnection[];
  readonly electricalConnections: ElectricalConnection[];
  readonly hiddenPartIds: string[];
  readonly selectedId: string | null;
  readonly foundation: FoundationConfig | null;
  readonly drivetrain: DrivetrainConfiguration;
  readonly selectedMotorCatalogueId: string | null;
  readonly selectedWheelCatalogueId: string | null;
  readonly selectedWheelMotorId: string | null;
  readonly selectedBatteryCatalogueId: string | null;
  readonly selectedControllerCatalogueId: string | null;
}

/**
 * Memoizes assembly hierarchy maps, drivetrain validation, and analytical
 * engineering profiles (stability, performance, inertia) for the Workshop shell.
 */
export function useWorkshopDerivedState({
  parts,
  connections,
  electricalConnections,
  hiddenPartIds,
  selectedId,
  foundation,
  drivetrain,
  selectedMotorCatalogueId,
  selectedWheelCatalogueId,
  selectedWheelMotorId,
  selectedBatteryCatalogueId,
  selectedControllerCatalogueId,
}: UseWorkshopDerivedStateInput) {
  const hiddenPartIdSet = useMemo(() => new Set(hiddenPartIds), [hiddenPartIds]);

  const visibleParts = useMemo(
    () => parts.filter((part) => !hiddenPartIdSet.has(part.id)),
    [parts, hiddenPartIdSet]
  );

  const selectedPart = useMemo(
    () => parts.find((part) => part.id === selectedId) ?? null,
    [parts, selectedId]
  );

  const focusableSelectedPart = useMemo(
    () => getVisibleSelectedPart(parts, selectedId, hiddenPartIds),
    [parts, selectedId, hiddenPartIds]
  );

  const selectedPartIsHidden = Boolean(selectedPart && !focusableSelectedPart);

  const { childrenByParent, anchoredRootParts, unattachedRootParts } = useMemo(() => {
    const map = new Map<string, RobotPart[]>();
    const partIds = new Set(parts.map((p) => p.id));
    const partsById = new Map(parts.map((p) => [p.id, p]));
    const attachedChildIds = new Set<string>();

    // Enforce unique parent & ignore self-loops/dangling edges during hierarchy construction
    for (const connection of connections) {
      const parentId = connection.parentId ?? connection.sourceId;
      const childId = connection.childId ?? connection.targetId;
      if (!parentId || !childId || parentId === childId) continue;
      if (childId === "foundation-chassis") continue;
      const child = partsById.get(childId);
      if (!child || !partIds.has(parentId)) continue;
      if (attachedChildIds.has(childId)) continue;
      attachedChildIds.add(childId);
      map.set(parentId, [...(map.get(parentId) ?? []), child]);
    }

    // Track nodes reachable from non-child roots so pure cycles are surfaced rather than hidden
    const reachable = new Set<string>();
    const markReachable = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const child of map.get(id) ?? []) {
        markReachable(child.id);
      }
    };
    const independentParts = parts.filter((part) => !attachedChildIds.has(part.id));
    for (const root of independentParts) {
      markReachable(root.id);
    }
    const cyclicRoots: RobotPart[] = [];
    for (const part of parts) {
      if (!reachable.has(part.id)) {
        cyclicRoots.push(part);
        markReachable(part.id);
      }
    }

    return {
      childrenByParent: map,
      anchoredRootParts: independentParts.filter((part) =>
        part.id.startsWith("foundation-")
      ),
      unattachedRootParts: [
        ...independentParts.filter((part) => !part.id.startsWith("foundation-")),
        ...cyclicRoots,
      ],
    };
  }, [parts, connections]);

  const motorMountZones = useMemo(
    () => (foundation ? generateMotorMountZones(foundation) : []),
    [foundation]
  );

  const mountedMotors = useMemo(
    () =>
      parts.filter(
        (part) =>
          part.type === "Motor" &&
          Boolean(
            part.mountingZoneId ||
              (foundation &&
                resolveMotorMechanicalSupport(part, parts, connections, foundation)
                  .supported)
          )
      ),
    [parts, connections, foundation]
  );

  const structuralMotorCarriers = useMemo(
    () =>
      parts.filter(
        (part) =>
          part.id !== "foundation-chassis" &&
          (part.structuralCategory === "rail" ||
            part.structuralCategory === "bracket" ||
            part.structuralCategory === "beam" ||
            part.structuralCategory === "crossbar" ||
            part.structuralCategory === "plate" ||
            part.type === "Structural Block" ||
            part.type === "Armor Plate")
      ),
    [parts]
  );

  const mountedWheels = useMemo(
    () => parts.filter((part) => part.type === "Wheel"),
    [parts]
  );

  const wheelByMotorId = useMemo(() => {
    const map = new Map<string, RobotPart>();
    for (const connection of connections) {
      if (connection.type !== "Motor-Wheel") continue;
      const wheel = mountedWheels.find((part) => part.id === connection.childId);
      if (wheel) map.set(connection.parentId, wheel);
    }
    return map;
  }, [mountedWheels, connections]);

  const selectedMotorDefinition = useMemo(
    () => motorCatalogue.find((motor) => motor.id === selectedMotorCatalogueId),
    [selectedMotorCatalogueId]
  );
  const selectedWheelDefinition = useMemo(
    () => wheelCatalogue.find((wheel) => wheel.id === selectedWheelCatalogueId),
    [selectedWheelCatalogueId]
  );
  const selectedBatteryDefinition = useMemo(
    () => batteryCatalogue.find((battery) => battery.id === selectedBatteryCatalogueId),
    [selectedBatteryCatalogueId]
  );
  const installedBattery = useMemo(
    () => parts.find((part) => part.type === "Battery"),
    [parts]
  );
  const installedBatteryDefinition = useMemo(
    () =>
      batteryCatalogue.find(
        (battery) => battery.id === installedBattery?.batteryCatalogueId
      ),
    [installedBattery]
  );
  const selectedControllerDefinition = useMemo(
    () =>
      controllerCatalogue.find(
        (controller) => controller.id === selectedControllerCatalogueId
      ),
    [selectedControllerCatalogueId]
  );
  const installedController = useMemo(
    () => parts.find((part) => part.type === "Controller"),
    [parts]
  );
  const installedControllerDefinition = useMemo(
    () =>
      controllerCatalogue.find(
        (controller) => controller.id === installedController?.controllerCatalogueId
      ),
    [installedController]
  );

  const selectedWheelMotor = useMemo(
    () => mountedMotors.find((motor) => motor.id === selectedWheelMotorId),
    [mountedMotors, selectedWheelMotorId]
  );
  const selectedWheelMotorDefinition = useMemo(
    () =>
      motorCatalogue.find(
        (motor) => motor.id === selectedWheelMotor?.motorCatalogueId
      ),
    [selectedWheelMotor]
  );
  const selectedMotorWheel = selectedWheelMotor
    ? wheelByMotorId.get(selectedWheelMotor.id)
    : undefined;

  const occupiedZoneIds = useMemo(
    () => new Set(mountedMotors.map((motor) => motor.mountingZoneId)),
    [mountedMotors]
  );

  const poweredWheelAssemblies = useMemo(
    () => getPoweredWheelAssemblies(parts, connections, foundation),
    [parts, connections, foundation]
  );

  const drivetrainValidation = useMemo(
    () => validateDrivetrain(drivetrain, parts, connections, foundation),
    [drivetrain, parts, connections, foundation]
  );

  const stabilityProfile = useMemo(
    () => compileRobotStabilityProfile(parts, connections, drivetrain),
    [parts, connections, drivetrain]
  );

  const performanceProfile = useMemo(
    () =>
      compileRobotPerformanceProfile(
        parts,
        connections,
        drivetrain,
        stabilityProfile
      ),
    [parts, connections, drivetrain, stabilityProfile]
  );

  const inertiaProfile = useMemo(
    () =>
      compileRobotInertiaProfile(
        parts,
        drivetrain,
        stabilityProfile.centerOfMass
      ),
    [parts, drivetrain, stabilityProfile.centerOfMass]
  );

  const validationReport = useMemo(
    () =>
      validateRobotAssembly({
        parts,
        connections,
        foundation,
        drivetrain,
        electricalConnections,
      }),
    [parts, connections, foundation, drivetrain, electricalConnections]
  );

  const selectedPartDiagnostics = useMemo(
    () =>
      selectedPart
        ? (validationReport.diagnosticsByPartId[selectedPart.id] ?? [])
        : [],
    [selectedPart, validationReport]
  );

  const drivetrainSlotCount = getDrivetrainSlotCount(drivetrain.type);

  const getMotorLocationLabel = (motor: RobotPart): string => {
    const zoneName = motorMountZones.find(
      (zone) => zone.id === motor.mountingZoneId
    )?.name;
    if (zoneName) return zoneName;
    if (!foundation) return "Mounted";
    return resolveMotorMechanicalSupport(motor, parts, connections, foundation)
      .mountingLocation;
  };

  return {
    hiddenPartIdSet,
    visibleParts,
    selectedPart,
    focusableSelectedPart,
    selectedPartIsHidden,
    childrenByParent,
    anchoredRootParts,
    unattachedRootParts,
    mountedMotors,
    mountedWheels,
    motorMountZones,
    structuralMotorCarriers,
    wheelByMotorId,
    selectedMotorDefinition,
    selectedWheelDefinition,
    selectedBatteryDefinition,
    installedBattery,
    installedBatteryDefinition,
    selectedControllerDefinition,
    installedController,
    installedControllerDefinition,
    selectedWheelMotor,
    selectedWheelMotorDefinition,
    selectedMotorWheel,
    occupiedZoneIds,
    poweredWheelAssemblies,
    drivetrainValidation,
    stabilityProfile,
    performanceProfile,
    inertiaProfile,
    validationReport,
    selectedPartDiagnostics,
    drivetrainSlotCount,
    getMotorLocationLabel,
  };
}
