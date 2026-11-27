import {
  Euler,
  Vector3,
} from "three";
import type {
  RobotPart,
  ComponentGeometry,
  RobotConnection,
  FoundationConfig,
  BatteryDefinition,
  ControllerDefinition,
  DrivetrainConfiguration,
  DrivetrainType,
  StructuralDefinition,
} from "../features/robot-builder/types/robot.types";
import { foundationModels } from "../features/robot-builder/data/foundationModels";
import { batteryCatalogue } from "../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../features/robot-builder/data/controllerCatalogue";
import { generateMotorMountZones } from "../features/robot-builder/logic/mountingZones";
import { getBatteryMountingTransform } from "../features/robot-builder/logic/batteryMounting";
import { getControllerMountingTransform } from "../features/robot-builder/logic/controllerMounting";
import {
  computeAttachedChildTransform,
  computeRelativeEulerRotation,
  getFoundationMountingInterfaces,
  resolvePartMountingInterfaces,
} from "../features/robot-builder/logic/mountingInterfaces";
import {
  getDrivetrainSlotCount,
} from "../features/robot-builder/logic/drivetrain";
import {
  generateProceduralFoundationAssembly,
} from "../features/robot-builder/logic/proceduralFoundation";
import {
  computeLocalStlExtents,
  computeTransformedStlExtents,
} from "../features/robot-builder/logic/stlParser";
import {
  collectSnapshotMeshAssetIds,
  sanitizeAssemblyGraph,
  syncAssemblyTransforms,
} from "../features/robot-builder/logic/assemblyGraphSanitizer";
import { toBoundingBoxExtents } from "../features/robot-builder/logic/geometryAdapters";
export {
  collectSnapshotMeshAssetIds,
  sanitizeAssemblyGraph,
  syncAssemblyTransforms,
} from "../features/robot-builder/logic/assemblyGraphSanitizer";
import type {
  AssemblyHistorySnapshot,
  RobotStore,
} from "./robotStore.types";

export function createEmptyDrivetrain(
  type: DrivetrainType = "differential-2"
): DrivetrainConfiguration {
  const slotCount = getDrivetrainSlotCount(type);
  return {
    type,
    left: Array(slotCount).fill(null),
    right: Array(slotCount).fill(null),
    mappingCustomized: false,
  };
}

export function resizeDrivetrainAssignments(
  configuration: DrivetrainConfiguration,
  type: DrivetrainType
): DrivetrainConfiguration {
  const slotCount = getDrivetrainSlotCount(type);
  return {
    ...configuration,
    type,
    left: Array.from(
      { length: slotCount },
      (_, index) => configuration.left[index] ?? null
    ),
    right: Array.from(
      { length: slotCount },
      (_, index) => configuration.right[index] ?? null
    ),
  };
}

export function hasCircularAttachment(
  connections: RobotConnection[],
  parentId: string,
  childId: string
): boolean {
  if (parentId === childId) return true;

  let currentId = childId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    if (currentId === parentId) return true;

    const attachment = connections.find(
      (connection) =>
        (connection.childId ?? connection.targetId) === currentId
    );
    currentId = attachment?.parentId ?? attachment?.sourceId ?? "";
  }

  return false;
}

export function createFoundationPartsAndConnections(config: FoundationConfig): {
  parts: RobotPart[];
  connections: RobotConnection[];
} {
  if (config.mode === "imported" && config.imported) {
    const imp = config.imported;
    const scaleTuple =
      imp.transform.scaleMode === "uniform"
        ? ([
            imp.transform.uniformScale,
            imp.transform.uniformScale,
            imp.transform.uniformScale,
          ] as const)
        : imp.transform.nonUniformScale;
    const localExtents = computeLocalStlExtents({
      rawDimensions: imp.inspection.rawDimensions,
      unit: imp.transform.unit,
      scale: scaleTuple,
    });
    const localL = Math.max(0.05, localExtents[0]);
    const localH = Math.max(0.02, localExtents[1]);
    const localW = Math.max(0.05, localExtents[2]);
    const extents = computeTransformedStlExtents({
      rawDimensions: imp.inspection.rawDimensions,
      unit: imp.transform.unit,
      scale: scaleTuple,
      orientationRotation: imp.transform.orientationRotation,
    });
    const H = Math.max(0.02, extents[1]);
    const resolvedMass =
      imp.engineering.massKg !== undefined && imp.engineering.massKg > 0
        ? imp.engineering.massKg
        : 0;
    const chassis: RobotPart = {
      id: "foundation-chassis",
      name: imp.fileName.replace(/\.stl$/i, "") || "Imported Foundation",
      type: "Structural Block",
      position: [
        imp.transform.positionOffset[0],
        H * 0.5 + imp.transform.positionOffset[1],
        imp.transform.positionOffset[2],
      ],
      rotation: [...imp.transform.orientationRotation],
      size: [localL, localH, localW],
      color: "#64748b",
      mass: resolvedMass,
      massKg: resolvedMass,
      foundationModelId: config.modelId,
      meshAssetId: imp.assetId,
      meshTransform: structuredClone(imp.transform),
      collisionConfig: structuredClone(imp.collision),
      importedEngineering: structuredClone(imp.engineering),
      customInertiaKgM2: imp.engineering.inertiaKgM2
        ? [...imp.engineering.inertiaKgM2]
        : undefined,
      geometry: {
        shape: "box",
        length: localL,
        height: localH,
        width: localW,
      },
      engineeringSpec: {
        category: "structural",
        role: "chassis-frame",
        generalProvenance: imp.engineering.provenance,
      },
    };
    return { parts: [chassis], connections: [] };
  }

  if (config.mode === "procedural" && config.procedural) {
    const generated = generateProceduralFoundationAssembly(config);
    const parts: RobotPart[] = [generated.rootPart, ...generated.memberParts];
    const connections: RobotConnection[] = [...generated.memberConnections];

    if (config.includeTopPlate) {
      const topPlateMass = config.length * config.width * 0.18;
      parts.push({
        id: "foundation-top-plate",
        name: "Top Structural Plate",
        type: "Armor Plate",
        position: [0, config.height + 0.09, 0],
        rotation: [0, 0, 0],
        size: [config.length * 0.82, 0.12, config.width * 0.78],
        color: "#64748b",
        mass: topPlateMass,
        geometry: {
          shape: "box",
          length: config.length * 0.82,
          height: 0.12,
          width: config.width * 0.78,
        },
        massKg: topPlateMass,
      });
    }

    if (config.includeFrontCover) {
      const frontCoverMass = config.width * config.height * 0.12;
      parts.push({
        id: "foundation-front-cover",
        name: "Front Protective Cover",
        type: "Front Bumper",
        position: [config.length * 0.5 + 0.06, config.height * 0.5, 0],
        rotation: [0, 0, 0],
        size: [0.12, config.height * 0.55, config.width * 0.9],
        color: "#f59e0b",
        mass: frontCoverMass,
        geometry: {
          shape: "box",
          length: 0.12,
          height: config.height * 0.55,
          width: config.width * 0.9,
        },
        massKg: frontCoverMass,
      });
    }

    return { parts, connections };
  }

  return { parts: createFoundationParts(config), connections: [] };
}

export function createFoundationParts(config: FoundationConfig): RobotPart[] {
  const model = foundationModels.find((m) => m.id === config.modelId);
  const chassisMass = Math.max(0.5, config.length * config.width * config.height * 3);
  const chassis: RobotPart = {
    id: "foundation-chassis",
    name: model?.name ?? "Robot Foundation",
    type: "Structural Block",
    position: [0, config.height * 0.5, 0],
    rotation: [0, 0, 0],
    size: [config.length, config.height, config.width],
    color: "#475569",
    mass: chassisMass,
    geometry: {
      shape: "box",
      length: config.length,
      height: config.height,
      width: config.width,
    },
    massKg: chassisMass,
    foundationModelId: config.modelId,
    engineeringSpec: model?.engineeringSpec
      ? structuredClone(model.engineeringSpec)
      : undefined,
  };

  const parts: RobotPart[] = [chassis];

  if (config.includeTopPlate) {
    const topPlateMass = config.length * config.width * 0.18;
    parts.push({
      id: "foundation-top-plate",
      name: "Top Structural Plate",
      type: "Armor Plate",
      position: [0, config.height + 0.09, 0],
      rotation: [0, 0, 0],
      size: [config.length * 0.82, 0.12, config.width * 0.78],
      color: "#64748b",
      mass: topPlateMass,
      geometry: {
        shape: "box",
        length: config.length * 0.82,
        height: 0.12,
        width: config.width * 0.78,
      },
      massKg: topPlateMass,
    });
  }

  if (config.includeFrontCover) {
    const frontCoverMass = config.width * config.height * 0.12;
    parts.push({
      id: "foundation-front-cover",
      name: "Front Protective Cover",
      type: "Front Bumper",
      position: [config.length * 0.5 + 0.06, config.height * 0.5, 0],
      rotation: [0, 0, 0],
      size: [0.12, config.height * 0.55, config.width * 0.9],
      color: "#f59e0b",
      mass: frontCoverMass,
      geometry: {
        shape: "box",
        length: 0.12,
        height: config.height * 0.55,
        width: config.width * 0.9,
      },
      massKg: frontCoverMass,
    });
  }

  return parts;
}

export function syncGeometryFromSize(
  part: RobotPart,
  size: [number, number, number]
): Pick<RobotPart, "size" | "geometry"> &
  Partial<Pick<RobotPart, "wheelDiameter" | "wheelWidth" | "engineeringSpec">> {
  const isCylinder =
    part.geometry?.shape === "cylinder" || part.type === "Wheel";

  const syncedEngineeringSpec =
    part.type === "Armor Plate" &&
    part.engineeringSpec?.category === "structural" &&
    part.engineeringSpec.plateThicknessM !== undefined
      ? {
          ...part.engineeringSpec,
          plateThicknessM: Math.min(size[0], size[1], size[2]),
          fieldProvenance: {
            ...(part.engineeringSpec.fieldProvenance ?? {}),
            plateThicknessM: {
              method: "estimated" as const,
              basis: "Synchronized from customized armor plate dimensions",
            },
          },
        }
      : undefined;

  if (isCylinder) {
    const axis =
      part.geometry?.shape === "cylinder" ? part.geometry.axis : "x";
    const prevGeom =
      part.geometry?.shape === "cylinder" ? part.geometry : undefined;
    const pickRadialDiameter = (a: number, b: number) => {
      if (
        prevGeom &&
        Math.abs(a - prevGeom.diameter) < 1e-6 &&
        Math.abs(b - prevGeom.diameter) >= 1e-6
      ) {
        return b;
      }
      return a;
    };

    // Preserve canonical Wheel storage convention ([diameter, width, diameter]),
    // while mapping general structural cylinders by axis to match toBoundingBoxExtents.
    if (part.type === "Wheel" || part.wheelDiameter !== undefined) {
      const diameter = pickRadialDiameter(size[0], size[2]);
      const axialWidth = size[1];
      return {
        size: [diameter, axialWidth, diameter],
        wheelDiameter: diameter,
        wheelWidth: axialWidth,
        geometry: {
          shape: "cylinder",
          diameter,
          axialWidth,
          axis,
        },
        ...(syncedEngineeringSpec ? { engineeringSpec: syncedEngineeringSpec } : {}),
      };
    }

    let diameter: number;
    let axialWidth: number;
    if (axis === "x") {
      axialWidth = size[0];
      diameter = pickRadialDiameter(size[1], size[2]);
    } else if (axis === "z") {
      axialWidth = size[2];
      diameter = pickRadialDiameter(size[0], size[1]);
    } else {
      axialWidth = size[1];
      diameter = pickRadialDiameter(size[0], size[2]);
    }

    const geometry: ComponentGeometry = {
      shape: "cylinder",
      diameter,
      axialWidth,
      axis,
    };

    const syncedExtents = toBoundingBoxExtents(geometry);
    return {
      size: [syncedExtents[0], syncedExtents[1], syncedExtents[2]],
      geometry,
      ...(syncedEngineeringSpec ? { engineeringSpec: syncedEngineeringSpec } : {}),
    };
  }

  return {
    size,
    geometry: {
      shape: "box",
      length: size[0],
      height: size[1],
      width: size[2],
    },
    ...(syncedEngineeringSpec ? { engineeringSpec: syncedEngineeringSpec } : {}),
  };
}

export function syncSizeFromGeometry(
  part: RobotPart,
  geometry: ComponentGeometry
): Pick<RobotPart, "size" | "geometry"> &
  Partial<Pick<RobotPart, "wheelDiameter" | "wheelWidth" | "engineeringSpec">> {
  if (geometry.shape === "cylinder") {
    if (part.type === "Wheel" || part.wheelDiameter !== undefined) {
      const size: [number, number, number] = [
        geometry.diameter,
        geometry.axialWidth,
        geometry.diameter,
      ];
      return {
        geometry,
        size,
        wheelDiameter: geometry.diameter,
        wheelWidth: geometry.axialWidth,
      };
    }
    const syncedExtents = toBoundingBoxExtents(geometry);
    return {
      geometry,
      size: [syncedExtents[0], syncedExtents[1], syncedExtents[2]],
    };
  }

  const syncedEngineeringSpec =
    part.type === "Armor Plate" &&
    part.engineeringSpec?.category === "structural" &&
    part.engineeringSpec.plateThicknessM !== undefined
      ? {
          ...part.engineeringSpec,
          plateThicknessM: Math.min(
            geometry.length,
            geometry.height,
            geometry.width
          ),
          fieldProvenance: {
            ...(part.engineeringSpec.fieldProvenance ?? {}),
            plateThicknessM: {
              method: "estimated" as const,
              basis: "Synchronized from customized armor plate dimensions",
            },
          },
        }
      : undefined;

  return {
    geometry,
    size: [geometry.length, geometry.height, geometry.width],
    ...(syncedEngineeringSpec ? { engineeringSpec: syncedEngineeringSpec } : {}),
  };
}

export function createBatteryPart(
  definition: BatteryDefinition,
  id: string,
  foundation: FoundationConfig,
  connectionId: string
): RobotPart {
  const mount = getBatteryMountingTransform(definition, foundation);
  return {
    id,
    name: definition.name,
    type: "Battery",
    batteryCatalogueId: definition.id,
    position: mount.position,
    rotation: [0, 0, 0],
    size: [
      definition.dimensions.length,
      definition.dimensions.height,
      definition.dimensions.width,
    ],
    color: definition.color,
    mass: definition.weight,
    parentAttachmentId: connectionId,
    geometry: structuredClone(definition.geometry),
    massKg: definition.massKg,
    electrical: definition.electrical
      ? structuredClone(definition.electrical)
      : undefined,
    engineeringSpec: definition.engineeringSpec
      ? structuredClone(definition.engineeringSpec)
      : undefined,
  };
}

export function createControllerPart(
  definition: ControllerDefinition,
  id: string,
  foundation: FoundationConfig,
  connectionId: string
): RobotPart {
  const mount = getControllerMountingTransform(definition, foundation);
  return {
    id,
    name: definition.name,
    type: "Controller",
    controllerCatalogueId: definition.id,
    position: mount.position,
    rotation: [0, 0, 0],
    size: [
      definition.dimensions.length,
      definition.dimensions.height,
      definition.dimensions.width,
    ],
    color: definition.color,
    mass: definition.weight,
    parentAttachmentId: connectionId,
    geometry: structuredClone(definition.geometry),
    massKg: definition.massKg,
    electrical: definition.electrical
      ? structuredClone(definition.electrical)
      : undefined,
    engineeringSpec: definition.engineeringSpec
      ? structuredClone(definition.engineeringSpec)
      : undefined,
  };
}

export function preserveMountedComponents(
  foundationParts: RobotPart[],
  existingParts: RobotPart[],
  foundation: FoundationConfig,
  connections: RobotConnection[]
): RobotPart[] {
  const zones = generateMotorMountZones(foundation);
  const existingRootChassis = existingParts.find((p) => p.id === "foundation-chassis");
  const patchedFoundationParts = foundationParts.map((fp) => {
    if (fp.id !== "foundation-chassis" || !existingRootChassis) return fp;
    return {
      ...fp,
      customMountingInterfaces: existingRootChassis.customMountingInterfaces
        ? structuredClone(existingRootChassis.customMountingInterfaces)
        : fp.customMountingInterfaces,
      mountingPatterns:
        fp.mountingPatterns ??
        (existingRootChassis.mountingPatterns
          ? structuredClone(existingRootChassis.mountingPatterns)
          : undefined),
    };
  });
  const motors = existingParts.filter(
    (part) => part.type === "Motor" && part.mountingZoneId
  );
  const structuralMotors = existingParts.filter(
    (part) => part.type === "Motor" && !part.mountingZoneId
  );

  const positionedMotors = motors.map((motor) => {
    const zone = zones.find((item) => item.id === motor.mountingZoneId);
    if (!zone) return null;
    return {
      ...motor,
      position: zone.position,
      rotation: [...motor.rotation] as [number, number, number],
    };
  }).filter((motor): motor is RobotPart => motor !== null);

  const preservedMotorIds = new Set([
    ...positionedMotors.map((motor) => motor.id),
    ...structuralMotors.map((motor) => motor.id),
  ]);
  const wheels = existingParts.filter((part) =>
    part.type === "Wheel" &&
    connections.some(
      (connection) =>
        connection.type === "Motor-Wheel" &&
        connection.childId === part.id &&
        preservedMotorIds.has(connection.parentId)
    )
  );
  const existingBatteries = existingParts.filter(
    (part) => part.type === "Battery"
  );
  const battery = existingBatteries
    .map((part) => ({
      part,
      definition: batteryCatalogue.find(
        (item) => item.id === part.batteryCatalogueId
      ),
      connection: connections.find(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === part.id
      ),
    }))
    .find((item) => item.definition && item.connection);
  let positionedBattery: RobotPart | null = null;
  if (battery?.definition && battery.connection) {
    const freshPart = createBatteryPart(
      battery.definition,
      battery.part.id,
      foundation,
      battery.connection.id
    );
    positionedBattery = {
      ...freshPart,
      mass: battery.part.mass,
      massKg: battery.part.massKg ?? freshPart.massKg,
      color: battery.part.color,
      electrical: battery.part.electrical
        ? structuredClone(battery.part.electrical)
        : freshPart.electrical,
      engineeringSpec: battery.part.engineeringSpec
        ? structuredClone(battery.part.engineeringSpec)
        : freshPart.engineeringSpec,
    };
  }
  const existingControllers = existingParts.filter(
    (part) => part.type === "Controller"
  );
  const controller = existingControllers
    .map((part) => ({
      part,
      definition: controllerCatalogue.find(
        (item) => item.id === part.controllerCatalogueId
      ),
      connection: connections.find(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === part.id
      ),
    }))
    .find((item) => item.definition && item.connection);
  let positionedController: RobotPart | null = null;
  if (controller?.definition && controller.connection) {
    const freshPart = createControllerPart(
      controller.definition,
      controller.part.id,
      foundation,
      controller.connection.id
    );
    positionedController = {
      ...freshPart,
      mass: controller.part.mass,
      massKg: controller.part.massKg ?? freshPart.massKg,
      color: controller.part.color,
      electrical: controller.part.electrical
        ? structuredClone(controller.part.electrical)
        : freshPart.electrical,
      engineeringSpec: controller.part.engineeringSpec
        ? structuredClone(controller.part.engineeringSpec)
        : freshPart.engineeringSpec,
    };
  }
  const existingCustomStructural = existingParts.filter(
    (part) =>
      !part.id.startsWith("foundation-") &&
      !part.foundationMemberRole &&
      part.type !== "Motor" &&
      part.type !== "Wheel" &&
      part.type !== "Battery" &&
      part.type !== "Controller"
  );
  return [
    ...patchedFoundationParts,
    ...positionedMotors,
    ...structuralMotors,
    ...wheels,
    ...(positionedBattery ? [positionedBattery] : []),
    ...(positionedController ? [positionedController] : []),
    ...existingCustomStructural,
  ];
}

export function remapFoundationConnections(
  connections: RobotConnection[],
  parts: RobotPart[],
  foundation: FoundationConfig
): RobotConnection[] {
  const zones = generateMotorMountZones(foundation);
  const foundationInterfaces = getFoundationMountingInterfaces(foundation);

  return connections.map((connection) => {
    if (connection.type !== "Mechanical") return connection;
    if (connection.id.startsWith("conn-foundation-member-")) return connection;
    const childId = connection.childId;
    const childPart = parts.find((part) => part.id === childId);
    if (
      connection.parentId === "foundation-chassis" &&
      childPart &&
      childPart.type !== "Battery" &&
      childPart.type !== "Controller" &&
      childPart.type !== "Motor"
    ) {
      const foundationPart = parts.find((p) => p.id === "foundation-chassis");
      const matchedFoundationIface = foundationInterfaces.find(
        (iface) => iface.id === connection.parentMountPointId
      );
      if (foundationPart && matchedFoundationIface) {
        const childInterfaces = resolvePartMountingInterfaces(childPart, foundation);
        const matchedChildIface =
          childInterfaces.find((iface) => iface.id === connection.childMountPointId) ??
          childInterfaces[0];
        if (matchedChildIface) {
          const attachedTransform = computeAttachedChildTransform(
            foundationPart,
            matchedFoundationIface,
            childPart,
            matchedChildIface
          );
          return {
            ...connection,
            relativePosition: attachedTransform.relativePosition,
            relativeRotation: attachedTransform.relativeRotation,
          };
        }
      }
    }
    if (childPart?.type === "Battery") {
      const definition = batteryCatalogue.find(
        (battery) => battery.id === childPart.batteryCatalogueId
      );
      if (!definition || connection.parentId !== "foundation-chassis") {
        return connection;
      }
      const mount = getBatteryMountingTransform(definition, foundation);
      return {
        ...connection,
        relativePosition: mount.relativePosition,
        relativeRotation: [0, 0, 0],
        childMountPointId: `battery-mount:${childId}`,
      };
    }
    if (childPart?.type === "Controller") {
      const definition = controllerCatalogue.find(
        (controller) =>
          controller.id === childPart.controllerCatalogueId
      );
      if (!definition || connection.parentId !== "foundation-chassis") {
        return connection;
      }
      const mount = getControllerMountingTransform(definition, foundation);
      return {
        ...connection,
        relativePosition: mount.relativePosition,
        relativeRotation: [0, 0, 0],
        childMountPointId: `controller-mount:${childId}`,
      };
    }
    if (childPart?.type !== "Motor") return connection;
    const motor = childPart;
    const zone = zones.find((item) => item.id === motor?.mountingZoneId);
    if (!zone) return connection;

    return {
      ...connection,
      relativePosition: [
        zone.position[0],
        zone.position[1] - foundation.height * 0.5,
        zone.position[2],
      ],
      relativeRotation: motor?.rotation ?? zone.rotation,
      childMountPointId: `motor-mount:${childId}`,
    };
  });
}

export function captureAssemblySnapshot(state: RobotStore): AssemblyHistorySnapshot {
  return {
    parts: structuredClone(state.parts),
    connections: structuredClone(state.connections),
    electricalConnections: structuredClone(state.electricalConnections ?? []),
    foundation: state.foundation ? structuredClone(state.foundation) : null,
    foundationId: state.foundationId,
    drivetrain: structuredClone(state.drivetrain),
    hiddenPartIds: [...state.hiddenPartIds],
    stage: state.stage,
  };
}

export function finalizeFoundationRebuild(
  state: RobotStore,
  foundation: FoundationConfig,
  foundationParts: RobotPart[],
  builtConnections: RobotConnection[]
): Partial<RobotStore> {
  const nonMemberConnections = state.connections.filter(
    (c) => !c.id.startsWith("conn-foundation-member-")
  );
  const mergedConnections = [...builtConnections, ...nonMemberConnections];
  const preservedParts = preserveMountedComponents(
    foundationParts,
    state.parts,
    foundation,
    mergedConnections
  );
  const remappedConnections = remapFoundationConnections(
    mergedConnections,
    preservedParts,
    foundation
  );
  const sanitized = sanitizeAssemblyGraph({
    parts: preservedParts,
    connections: remappedConnections,
    electricalConnections: state.electricalConnections,
    foundation,
    foundationId: "foundation-chassis",
    drivetrain: state.drivetrain,
    hiddenPartIds: state.hiddenPartIds,
    selectedId: "foundation-chassis",
    selectedWheelMotorId: state.selectedWheelMotorId,
    selectedElectricalConnectionId: state.selectedElectricalConnectionId,
    selectedElectricalPinId: state.selectedElectricalPinId,
  });
  return {
    ...sanitized,
    parts: syncAssemblyTransforms(sanitized.parts, sanitized.connections),
  };
}

export function createStructuralPartFromDefinition(
  definition: StructuralDefinition,
  id: string,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  parentAttachmentId?: string
): RobotPart {
  return {
    id,
    name: definition.name,
    type: definition.componentType,
    structuralCatalogueId: definition.id,
    structuralCategory: definition.category,
    structuralVisualShape: definition.visualShape,
    position,
    rotation,
    size: [
      definition.dimensions.length,
      definition.dimensions.height,
      definition.dimensions.width,
    ],
    color: definition.color,
    mass: definition.massKg,
    massKg: definition.massKg,
    parentAttachmentId,
    geometry: structuredClone(definition.geometry),
    engineeringSpec: structuredClone(definition.engineeringSpec),
  };
}

export function collectStoreMeshAssetIds(state: {
  readonly parts: readonly RobotPart[];
  readonly foundation: FoundationConfig | null;
  readonly historyPast?: readonly AssemblyHistorySnapshot[];
  readonly historyFuture?: readonly AssemblyHistorySnapshot[];
  readonly activeTransformPreview?: {
    readonly baselineSnapshot: AssemblyHistorySnapshot;
  } | null;
}): Set<string> {
  const ids = new Set<string>();
  collectSnapshotMeshAssetIds(state.parts, state.foundation, ids);
  for (const snap of state.historyPast ?? []) {
    collectSnapshotMeshAssetIds(snap.parts, snap.foundation, ids);
  }
  for (const snap of state.historyFuture ?? []) {
    collectSnapshotMeshAssetIds(snap.parts, snap.foundation, ids);
  }
  if (state.activeTransformPreview) {
    collectSnapshotMeshAssetIds(
      state.activeTransformPreview.baselineSnapshot.parts,
      state.activeTransformPreview.baselineSnapshot.foundation,
      ids
    );
  }
  return ids;
}

export function tupleNearlyEqual(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  eps = 1e-6
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= eps &&
    Math.abs(a[1] - b[1]) <= eps &&
    Math.abs(a[2] - b[2]) <= eps
  );
}

/**
 * Restore an assembly history snapshot into sanitized, transform-synchronized store fields.
 */
export function restoreAssemblySnapshot(
  state: RobotStore,
  snapshot: AssemblyHistorySnapshot
) {
  const sanitized = sanitizeAssemblyGraph({
    parts: structuredClone(snapshot.parts),
    connections: structuredClone(snapshot.connections),
    electricalConnections: structuredClone(snapshot.electricalConnections ?? []),
    foundation: snapshot.foundation ? structuredClone(snapshot.foundation) : null,
    foundationId: snapshot.foundationId,
    drivetrain: structuredClone(snapshot.drivetrain),
    hiddenPartIds: [...snapshot.hiddenPartIds],
    selectedId: state.selectedId,
    selectedWheelMotorId: state.selectedWheelMotorId,
    selectedElectricalConnectionId: state.selectedElectricalConnectionId,
    selectedElectricalPinId: state.selectedElectricalPinId,
    stage: snapshot.stage ?? state.stage,
  });
  return {
    ...sanitized,
    parts: syncAssemblyTransforms(sanitized.parts, sanitized.connections),
  };
}

/**
 * Ensures motor output shaft (+X local) faces laterally (±Z) outward for differential drive.
 */
export function resolveMotorShaftOutwardRotation(
  parentRotation: readonly [number, number, number],
  attachedWorldPosition: readonly [number, number, number],
  attachedWorldRotation: readonly [number, number, number],
  attachedRelativeRotation: readonly [number, number, number]
): {
  worldRotation: [number, number, number];
  relativeRotation: [number, number, number];
} {
  const shaftWorld = new Vector3(1, 0, 0).applyEuler(
    new Euler(...attachedWorldRotation, "XYZ")
  );
  let worldRotation = [...attachedWorldRotation] as [number, number, number];
  let relativeRotation = [...attachedRelativeRotation] as [number, number, number];
  if (Math.abs(shaftWorld.z) < 0.7) {
    const outwardYaw =
      attachedWorldPosition[2] >= 0 ? -Math.PI / 2 : Math.PI / 2;
    worldRotation = [0, outwardYaw, 0];
    relativeRotation = computeRelativeEulerRotation(parentRotation, worldRotation);
  }
  return { worldRotation, relativeRotation };
}
