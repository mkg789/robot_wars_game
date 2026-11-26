
import { create } from "zustand";
import { Euler, Vector3 } from "three";

import type {
  RobotPart,
  TransformMode,
  ComponentType,
  ComponentGeometry,
  RobotConnection,
  FoundationConfig,
  FoundationModelId,
  BuildStage,
  AttachmentInterface,
  CustomCollisionConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  MeshAssetInspection,
  MountingPatternConfig,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  MotorCatalogueId,
  WheelCatalogueId,
  WheelDimensionDraft,
  BatteryCatalogueId,
  BatteryDefinition,
  ControllerCatalogueId,
  ControllerDefinition,
  DrivetrainAssignment,
  DrivetrainConfiguration,
  DrivetrainSide,
  DrivetrainType,
  StructuralCatalogueId,
  StructuralDefinition,
} from "../features/robot-builder/types/robot.types";

import {
  getMotorShaftMountOffset,
  getMotorShaftMountPosition,
} from "../features/robot-builder/logic/mounting";
import { foundationModels } from "../features/robot-builder/data/foundationModels";
import { motorCatalogue } from "../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { batteryCatalogue } from "../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../features/robot-builder/data/controllerCatalogue";
import { structuralCatalogue } from "../features/robot-builder/data/structuralCatalogue";
import { generateMotorMountZones } from "../features/robot-builder/logic/mountingZones";
import { getWheelWorldMountTransform } from "../features/robot-builder/logic/wheelMounting";
import { getBatteryMountingTransform } from "../features/robot-builder/logic/batteryMounting";
import { getControllerMountingTransform } from "../features/robot-builder/logic/controllerMounting";
import {
  computeAttachedChildTransform,
  computeRelativeTransformBetweenParts,
  getFoundationMountingInterfaces,
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "../features/robot-builder/logic/mountingInterfaces";
import {
  clampWheelDimension,
  getWheelDimensionsInMeters,
  wheelDimensionBounds,
} from "../features/robot-builder/logic/wheelDimensions";
import { metersToCm } from "../features/robot-builder/logic/units";
import {
  getDrivetrainSlotCount,
  getPoweredWheelAssemblies,
  resolveMotorMechanicalSupport,
  retainValidDrivetrainAssignments,
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "../features/robot-builder/logic/drivetrain";
import { evaluateComponentReplacementImpact } from "../features/robot-builder/logic/mechanicalCompatibility";
import {
  createDefaultProceduralFoundationConfig,
  generateProceduralFoundationAssembly,
} from "../features/robot-builder/logic/proceduralFoundation";
import { computeTransformedStlExtents } from "../features/robot-builder/logic/stlParser";
import {
  buildCustomCollisionConfig,
  resolveImportedEngineeringProperties,
} from "../features/robot-builder/logic/customCollision";
import { retainMeshAsset, syncActiveAssetRefs } from "../features/robot-builder/logic/meshAssetRegistry";
import type {
  ElectricalComponentSpec,
  ElectricalConnection,
  ElectricalConnectorSpec,
  ElectricalDiagnostic,
  ElectricalValidationReport,
} from "../features/electrical/types/electrical.types";
import { getElectricalCatalogueItem } from "../features/electrical/data/electricalCatalogue";
import { resolvePartElectricalSpec } from "../features/electrical/logic/electricalComponentAdapters";
import { validateElectricalAssembly } from "../features/electrical/logic/electricalValidation";

export type AssemblyHistorySnapshot = {
  parts: RobotPart[];
  connections: RobotConnection[];
  electricalConnections: ElectricalConnection[];
  foundation: FoundationConfig | null;
  foundationId: string | null;
  drivetrain: DrivetrainConfiguration;
  hiddenPartIds: string[];
};

const MAX_ASSEMBLY_HISTORY = 40;

type RobotStore = {
  parts: RobotPart[];
  connections: RobotConnection[];
  electricalConnections: ElectricalConnection[];
  hiddenPartIds: string[];
  selectedId: string | null;
  transformMode: TransformMode;
  historyPast: AssemblyHistorySnapshot[];
  historyFuture: AssemblyHistorySnapshot[];

  setSelectedId: (id: string | null) => void;
  togglePartVisibility: (id: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  deleteSelected: () => void;
  deletePartById: (id: string) => void;
  undo: () => boolean;
  redo: () => boolean;

  updatePartTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  previewPartTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;

  updatePartPosition: (
    id: string,
    position: [number, number, number]
  ) => void;

  updatePartSize: (
    id: string,
    size: [number, number, number]
  ) => void;

  updatePartRotation: (
    id: string,
    rotation: [number, number, number]
  ) => void;

  updatePartGeometry: (
    id: string,
    geometry: ComponentGeometry
  ) => void;

  updatePartMass: (
    id: string,
    massKg: number
  ) => void;

  addPart: (type: ComponentType) => void;

  connectParts: (sourceId: string, targetId: string) => void;
  disconnectParts: (connectionId: string) => void;
  mountWheelToMotor: (motorId: string, wheelId: string) => void;
  unmountPart: (childId: string) => void;
  foundation: FoundationConfig | null;
  foundationId: string | null;
  startNewBuild: () => void;
  selectFoundationModel: (modelId: FoundationModelId) => void;
  updateFoundationDimensions: (
    dimensions: Partial<Pick<FoundationConfig, "length" | "width" | "height">>
  ) => void;
  setFoundationOptions: (
    options: Partial<
      Pick<FoundationConfig, "includeTopPlate" | "includeFrontCover">
    >
  ) => void;
  configureProceduralFoundation: (
    patch: Partial<ProceduralFoundationConfig> & {
      architecture?: ProceduralFoundationArchitectureId;
    }
  ) => void;
  resetProceduralFoundation: (
    architecture?: ProceduralFoundationArchitectureId
  ) => void;
  importFoundationStl: (params: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
  }) => void;
  importStructuralStl: (params: {
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
  updateImportedPartConfiguration: (
    partId: string,
    patch: {
      transform?: Partial<ImportedMeshTransform>;
      engineering?: Partial<ImportedEngineeringProperties>;
      collision?: CustomCollisionConfig;
    }
  ) => void;
  addCustomMountingInterface: (
    partId: string,
    iface: AttachmentInterface
  ) => void;
  updateCustomMountingInterface: (
    partId: string,
    ifaceId: string,
    patch: Partial<AttachmentInterface>
  ) => void;
  removeCustomMountingInterface: (partId: string, ifaceId: string) => void;
  updatePartMountingPattern: (
    partId: string,
    pattern: MountingPatternConfig
  ) => void;
  confirmFoundation: () => void;
  stage: BuildStage;
  drivetrain: DrivetrainConfiguration;
  setDrivetrainType: (
    type: DrivetrainType,
    confirmDiscard?: boolean
  ) => boolean;
  setDrivetrainAssignment: (
    side: DrivetrainSide,
    index: number,
    assignment: DrivetrainAssignment | null
  ) => void;
  applySuggestedDrivetrainMapping: (confirmCustomized?: boolean) => boolean;
  selectedMotorCatalogueId: MotorCatalogueId | null;
  selectedMountZoneId: string | null;
  selectedWheelCatalogueId: WheelCatalogueId | null;
  selectedWheelMotorId: string | null;
  selectedWheelDiameterCm: number;
  selectedWheelWidthCm: number;
  selectedBatteryCatalogueId: BatteryCatalogueId | null;
  selectedControllerCatalogueId: ControllerCatalogueId | null;
  selectedStructuralCatalogueId: StructuralCatalogueId | null;
  lastReplacementWarning: string | null;
  clearReplacementWarning: () => void;
  setStage: (stage: BuildStage) => void;
  selectStructuralCatalogueItem: (structuralId: StructuralCatalogueId) => void;
  addStructuralPart: (
    structuralId: StructuralCatalogueId,
    options?: {
      parentId?: string;
      parentInterfaceId?: string;
      childInterfaceId?: string;
    }
  ) => string | null;
  replaceStructuralPart: (
    partId: string,
    structuralId: StructuralCatalogueId
  ) => void;
  duplicatePart: (partId: string) => string | null;
  attachPart: (
    childId: string,
    parentId: string,
    parentInterfaceId?: string,
    childInterfaceId?: string
  ) => boolean;
  detachPart: (childId: string) => void;
  selectBatteryCatalogueItem: (batteryId: BatteryCatalogueId) => void;
  installBattery: (batteryId: BatteryCatalogueId) => void;
  removeBattery: () => void;
  selectControllerCatalogueItem: (
    controllerId: ControllerCatalogueId
  ) => void;
  installController: (controllerId: ControllerCatalogueId) => void;
  removeController: () => void;
  selectMotorCatalogueItem: (motorId: MotorCatalogueId) => void;
  selectMountZone: (zoneId: string) => void;
  placeMotor: () => void;
  mountMotorToParent: (
    parentId: string,
    parentInterfaceId?: string,
    motorCatalogueId?: MotorCatalogueId
  ) => string | null;
  replaceMotor: (zoneId: string) => void;
  removeMotor: (zoneId: string) => void;
  rotateMotor: (zoneId: string, rotationY?: number) => void;
  selectWheelCatalogueItem: (wheelId: WheelCatalogueId) => void;
  updateSelectedWheelDimensions: (
    dimensions: Partial<WheelDimensionDraft>
  ) => void;
  selectWheelMotor: (motorId: string) => void;
  assignWheel: (motorId: string) => void;
  removeWheel: (motorId: string) => void;
  finishBuild: () => void;
  assignPartElectricalSpec: (
    partId: string,
    spec: ElectricalComponentSpec
  ) => void;
  addElectricalConnection: (
    conn: Omit<ElectricalConnection, "id"> & { id?: string }
  ) => string | null;
  updateElectricalConnection: (
    connectionId: string,
    patch: Partial<ElectricalConnection>
  ) => void;
  removeElectricalConnection: (connectionId: string) => void;
  assignConnectorToInterface: (
    partId: string,
    interfaceId: string,
    connector: ElectricalConnectorSpec
  ) => void;
  assignPinToElectricalConnection: (
    connectionId: string,
    endpoint: "source" | "target",
    pinId: string | undefined
  ) => void;
  updatePartElectricalProperties: (
    partId: string,
    patch: Partial<ElectricalComponentSpec>
  ) => void;
  addElectricalComponent: (input: {
    id?: string;
    name: string;
    partType?: ComponentType;
    electricalSpec: ElectricalComponentSpec;
    position?: [number, number, number];
    size?: [number, number, number];
    color?: string;
    massKg?: number;
  }) => string;
  removeElectricalComponent: (partId: string) => void;
  validateElectricalState: () => ElectricalValidationReport;
  selectedElectricalConnectionId: string | null;
  selectedElectricalPinId: string | null;
  setSelectedElectricalConnection: (connectionId: string | null) => void;
  setSelectedElectricalPin: (partId: string | null, pinId: string | null) => void;
  focusElectricalDiagnostic: (
    diagnostic: Pick<ElectricalDiagnostic, "partId" | "connectionId" | "pinId">
  ) => void;
  installElectricalCatalogueItem: (
    catalogueId: string,
    options?: {
      id?: string;
      name?: string;
      parentId?: string;
      parentInterfaceId?: string;
      position?: [number, number, number];
    }
  ) => string | null;
  replaceElectricalComponent: (partId: string, catalogueId: string) => boolean;
};

function createEmptyDrivetrain(
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

function resizeDrivetrainAssignments(
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

function hasCircularAttachment(
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

function syncAssemblyTransforms(
  parts: RobotPart[],
  connections: RobotConnection[]
): RobotPart[] {
  const synchronized = new Map(parts.map((part) => [part.id, { ...part }]));
  const childrenByParent = new Map<string, RobotConnection[]>();

  for (const connection of connections) {
    const parentId = connection.parentId ?? connection.sourceId;
    const childId = connection.childId ?? connection.targetId;
    if (!synchronized.has(parentId) || !synchronized.has(childId)) continue;
    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      { ...connection, parentId, childId },
    ]);
  }

  const visited = new Set<string>();
  const applyChildren = (parentId: string) => {
    if (visited.has(parentId)) return;
    visited.add(parentId);

    const parent = synchronized.get(parentId);
    if (!parent) return;

    for (const connection of childrenByParent.get(parentId) ?? []) {
      const child = synchronized.get(connection.childId);
      if (!child) continue;

      const relativeOffset = getMotorShaftMountOffset(parent);
      const storedRelative =
        connection.relativePosition ?? relativeOffset;
      const worldOffset = new Vector3(...storedRelative).applyEuler(
        new Euler(...parent.rotation, "XYZ")
      );

      const position: [number, number, number] = [
        parent.position[0] + worldOffset.x,
        parent.position[1] + worldOffset.y,
        parent.position[2] + worldOffset.z,
      ];
      const relativeRotation = connection.relativeRotation ?? [0, 0, 0];
      const rotation: [number, number, number] = [
        parent.rotation[0] + relativeRotation[0],
        parent.rotation[1] + relativeRotation[1],
        parent.rotation[2] + relativeRotation[2],
      ];

      synchronized.set(connection.childId, {
        ...child,
        position,
        rotation,
        parentAttachmentId: connection.id,
      });
      applyChildren(connection.childId);
    }
  };

  for (const part of synchronized.values()) {
    const isChild = connections.some(
      (connection) =>
        (connection.childId ?? connection.targetId) === part.id
    );
    if (!isChild) applyChildren(part.id);
  }

  return parts.map((part) => synchronized.get(part.id) ?? part);
}

function createFoundationPartsAndConnections(config: FoundationConfig): {
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
    const extents = computeTransformedStlExtents({
      rawDimensions: imp.inspection.rawDimensions,
      unit: imp.transform.unit,
      scale: scaleTuple,
      orientationRotation: imp.transform.orientationRotation,
    });
    const L = Math.max(0.05, extents[0]);
    const H = Math.max(0.02, extents[1]);
    const W = Math.max(0.05, extents[2]);
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
      size: [L, H, W],
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
        length: L,
        height: H,
        width: W,
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

function createFoundationParts(config: FoundationConfig): RobotPart[] {
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
    return {
      size,
      ...(part.type === "Wheel" || part.wheelDiameter !== undefined
        ? { wheelDiameter: size[0], wheelWidth: size[1] }
        : {}),
      geometry: {
        shape: "cylinder",
        diameter: size[0],
        axialWidth: size[1],
        axis,
      },
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
    const size: [number, number, number] = [
      geometry.diameter,
      geometry.axialWidth,
      geometry.diameter,
    ];
    return {
      geometry,
      size,
      ...(part.type === "Wheel" || part.wheelDiameter !== undefined
        ? { wheelDiameter: geometry.diameter, wheelWidth: geometry.axialWidth }
        : {}),
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

function retainVisibilityForParts(
  hiddenPartIds: string[],
  parts: RobotPart[]
): string[] {
  const existingPartIds = new Set(parts.map((part) => part.id));
  return hiddenPartIds.filter((id) => existingPartIds.has(id));
}

function createBatteryPart(
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

function createControllerPart(
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

function preserveMountedComponents(
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
  const rebuiltParts = [
    ...patchedFoundationParts,
    ...positionedMotors,
    ...structuralMotors,
    ...wheels,
    ...(positionedBattery ? [positionedBattery] : []),
    ...(positionedController ? [positionedController] : []),
    ...existingCustomStructural,
  ];
  const existingBatteryIds = new Set(existingBatteries.map((part) => part.id));
  const existingControllerIds = new Set(
    existingControllers.map((part) => part.id)
  );
  const connectionsWithoutRemovedComponents = connections.filter(
    (connection) => {
      const touchesBatteryOrController =
        existingBatteryIds.has(connection.parentId) ||
        existingBatteryIds.has(connection.childId) ||
        existingControllerIds.has(connection.parentId) ||
        existingControllerIds.has(connection.childId);
      return (
        !touchesBatteryOrController ||
        (positionedBattery !== null &&
          connection.id === battery?.connection?.id) ||
        (positionedController !== null &&
          connection.id === controller?.connection?.id)
      );
    }
  );
  const rebuiltConnections = remapFoundationConnections(
    connectionsWithoutRemovedComponents,
    rebuiltParts,
    foundation
  );
  return syncAssemblyTransforms(rebuiltParts, rebuiltConnections);
}

function remapFoundationConnections(
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

function captureAssemblySnapshot(state: RobotStore): AssemblyHistorySnapshot {
  return {
    parts: structuredClone(state.parts),
    connections: structuredClone(state.connections),
    electricalConnections: structuredClone(state.electricalConnections ?? []),
    foundation: state.foundation ? structuredClone(state.foundation) : null,
    foundationId: state.foundationId,
    drivetrain: structuredClone(state.drivetrain),
    hiddenPartIds: [...state.hiddenPartIds],
  };
}

function createStructuralPartFromDefinition(
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

export const useRobotStore = create<RobotStore>((rawSet, get) => {
  const set = (
    partialOrUpdater:
      | Partial<RobotStore>
      | ((state: RobotStore) => Partial<RobotStore> | RobotStore)
  ) => {
    if (typeof partialOrUpdater !== "function") {
      rawSet(partialOrUpdater);
      return;
    }

    rawSet((state) => {
      const patch = partialOrUpdater(state);
      if (patch === state) return state;

      const modifiesAssembly =
        "parts" in patch ||
        "connections" in patch ||
        "electricalConnections" in patch ||
        "foundation" in patch ||
        "foundationId" in patch ||
        "drivetrain" in patch;

      if (!modifiesAssembly) return patch;

      return {
        ...patch,
        historyPast: [
          ...(state.historyPast ?? []),
          captureAssemblySnapshot(state),
        ].slice(-MAX_ASSEMBLY_HISTORY),
        historyFuture: [],
      };
    });
  };

  return {
  parts: [],
  connections: [],
  electricalConnections: [],
  hiddenPartIds: [],
  selectedId: null,
  transformMode: "select",
  historyPast: [],
  historyFuture: [],
  foundation: null,
  foundationId: null,
  stage: "foundation",
  drivetrain: createEmptyDrivetrain(),
  selectedMotorCatalogueId: null,
  selectedMountZoneId: null,
  selectedWheelCatalogueId: null,
  selectedWheelMotorId: null,
  selectedWheelDiameterCm: 22,
  selectedWheelWidthCm: 7,
  selectedBatteryCatalogueId: "standard-lipo",
  selectedControllerCatalogueId: "arduino-uno",
  selectedStructuralCatalogueId: "structural-rail",
  selectedElectricalConnectionId: null,
  selectedElectricalPinId: null,
  lastReplacementWarning: null,
  clearReplacementWarning: () => rawSet({ lastReplacementWarning: null }),
  setSelectedElectricalConnection: (connectionId) =>
    rawSet({ selectedElectricalConnectionId: connectionId }),
  setSelectedElectricalPin: (partId, pinId) =>
    rawSet((state) => ({
      selectedId: partId ?? state.selectedId,
      selectedElectricalPinId: pinId,
    })),
  focusElectricalDiagnostic: (diagnostic) =>
    rawSet((state) => ({
      selectedId: diagnostic.partId ?? state.selectedId,
      selectedElectricalConnectionId: diagnostic.connectionId ?? null,
      selectedElectricalPinId: diagnostic.pinId ?? null,
    })),

  undo: () => {
    let restored = false;
    rawSet((state) => {
      const past = state.historyPast ?? [];
      if (past.length === 0) return state;
      const previous = past[past.length - 1];
      const nextPast = past.slice(0, -1);
      const nextFuture = [
        captureAssemblySnapshot(state),
        ...(state.historyFuture ?? []),
      ].slice(0, MAX_ASSEMBLY_HISTORY);
      restored = true;
      const validSelected =
        state.selectedId && previous.parts.some((p) => p.id === state.selectedId)
          ? state.selectedId
          : previous.foundationId;
      return {
        parts: structuredClone(previous.parts),
        connections: structuredClone(previous.connections),
        electricalConnections: structuredClone(previous.electricalConnections ?? []),
        foundation: previous.foundation ? structuredClone(previous.foundation) : null,
        foundationId: previous.foundationId,
        drivetrain: structuredClone(previous.drivetrain),
        hiddenPartIds: [...previous.hiddenPartIds],
        selectedId: validSelected,
        historyPast: nextPast,
        historyFuture: nextFuture,
      };
    });
    return restored;
  },

  redo: () => {
    let restored = false;
    rawSet((state) => {
      const future = state.historyFuture ?? [];
      if (future.length === 0) return state;
      const next = future[0];
      const nextFuture = future.slice(1);
      const nextPast = [
        ...(state.historyPast ?? []),
        captureAssemblySnapshot(state),
      ].slice(-MAX_ASSEMBLY_HISTORY);
      restored = true;
      const validSelected =
        state.selectedId && next.parts.some((p) => p.id === state.selectedId)
          ? state.selectedId
          : next.foundationId;
      return {
        parts: structuredClone(next.parts),
        connections: structuredClone(next.connections),
        electricalConnections: structuredClone(next.electricalConnections ?? []),
        foundation: next.foundation ? structuredClone(next.foundation) : null,
        foundationId: next.foundationId,
        drivetrain: structuredClone(next.drivetrain),
        hiddenPartIds: [...next.hiddenPartIds],
        selectedId: validSelected,
        historyPast: nextPast,
        historyFuture: nextFuture,
      };
    });
    return restored;
  },

  setSelectedId: (id) => set({ selectedId: id }),

  togglePartVisibility: (id) =>
    set((state) => {
      if (!state.parts.some((part) => part.id === id)) return state;
      return {
        hiddenPartIds: state.hiddenPartIds.includes(id)
          ? state.hiddenPartIds.filter((partId) => partId !== id)
          : [...state.hiddenPartIds, id],
      };
    }),

  setTransformMode: (mode) => set({ transformMode: mode }),

  setStage: (stage) =>
    set((state) => {
      if (
        stage === "completed" &&
        !validateDrivetrain(
          state.drivetrain,
          state.parts,
          state.connections,
          state.foundation
        ).isValid
      ) {
        return state;
      }

      return {
        stage,
        ...(stage === "drivetrain" && !state.drivetrain.mappingCustomized
          ? {
              drivetrain: suggestDrivetrainMapping(
                state.drivetrain.type,
                state.parts,
                state.connections,
                state.foundation
              ),
            }
          : {}),
      };
    }),

  setDrivetrainType: (type, confirmDiscard = false) => {
    let updated = false;
    set((state) => {
      if (state.drivetrain.type === type) {
        updated = true;
        return state;
      }
      if (state.drivetrain.mappingCustomized) {
        const nextSlotCount = getDrivetrainSlotCount(type);
        const discardsAssignments = (["left", "right"] as const).some(
          (side) =>
            state.drivetrain[side]
              .slice(nextSlotCount)
              .some((assignment) => assignment !== null)
        );
        if (discardsAssignments && !confirmDiscard) return state;
        updated = true;
        return {
          drivetrain: resizeDrivetrainAssignments(
            state.drivetrain,
            type
          ),
        };
      }

      updated = true;
      return {
        drivetrain: suggestDrivetrainMapping(
          type,
          state.parts,
          state.connections,
          state.foundation
        ),
      };
    });
    return updated;
  },

  setDrivetrainAssignment: (side, index, assignment) =>
    set((state) => {
      if (index < 0 || index >= getDrivetrainSlotCount(state.drivetrain.type)) {
        return state;
      }
      if (assignment) {
        const validAssemblies = getPoweredWheelAssemblies(
          state.parts,
          state.connections,
          state.foundation
        );
        if (
          !validAssemblies.some(
            (item) =>
              item.motorId === assignment.motorId &&
              item.wheelId === assignment.wheelId
          )
        ) {
          return state;
        }
      }

      const nextAssignments = {
        left: [...state.drivetrain.left],
        right: [...state.drivetrain.right],
      };
      if (assignment) {
        for (const otherSide of ["left", "right"] as const) {
          nextAssignments[otherSide] = nextAssignments[otherSide].map(
            (item, itemIndex) =>
              item !== null &&
              !(otherSide === side && itemIndex === index) &&
              (item.motorId === assignment.motorId ||
                item.wheelId === assignment.wheelId)
                ? null
                : item
          );
        }
      }
      nextAssignments[side][index] = assignment ? { ...assignment } : null;
      return {
        drivetrain: {
          ...state.drivetrain,
          ...nextAssignments,
          mappingCustomized: true,
        },
      };
    }),

  applySuggestedDrivetrainMapping: (confirmCustomized = false) => {
    let applied = false;
    set((state) => {
      if (state.drivetrain.mappingCustomized && !confirmCustomized) {
        return state;
      }
      applied = true;
      return {
        drivetrain: suggestDrivetrainMapping(
          state.drivetrain.type,
          state.parts,
          state.connections,
          state.foundation
        ),
      };
    });
    return applied;
  },

  selectMotorCatalogueItem: (motorId) =>
    set({ selectedMotorCatalogueId: motorId }),

  selectMountZone: (zoneId) =>
    set({ selectedMountZoneId: zoneId }),

  selectWheelCatalogueItem: (wheelId) => {
    const definition = wheelCatalogue.find((wheel) => wheel.id === wheelId);
    if (!definition) return;
    set({
      selectedWheelCatalogueId: wheelId,
      selectedWheelDiameterCm: Number(metersToCm(definition.diameter).toFixed(1)),
      selectedWheelWidthCm: Number(metersToCm(definition.width).toFixed(1)),
    });
  },

  selectBatteryCatalogueItem: (batteryId) => {
    if (!batteryCatalogue.some((battery) => battery.id === batteryId)) return;
    set({ selectedBatteryCatalogueId: batteryId });
  },

  installBattery: (batteryId) => {
    const definition = batteryCatalogue.find(
      (battery) => battery.id === batteryId
    );
    if (!definition) return;

    set((state) => {
      if (!state.foundation || !state.foundation.confirmed) return state;

      const currentBatteries = state.parts.filter(
        (part) => part.type === "Battery"
      );
      const existingBattery = currentBatteries[0];
      const existingConnection = existingBattery
        ? state.connections.find(
            (connection) =>
              connection.type === "Mechanical" &&
              connection.parentId === "foundation-chassis" &&
              connection.childId === existingBattery.id
          )
        : undefined;
      const batteryIdForPart = existingBattery?.id ?? crypto.randomUUID();
      const connectionId = existingConnection?.id ?? crypto.randomUUID();
      const mount = getBatteryMountingTransform(definition, state.foundation);
      const part = createBatteryPart(
        definition,
        batteryIdForPart,
        state.foundation,
        connectionId
      );
      const connection: RobotConnection = {
        id: connectionId,
        sourceId: "foundation-chassis",
        targetId: batteryIdForPart,
        type: "Mechanical",
        parentId: "foundation-chassis",
        childId: batteryIdForPart,
        parentMountPointId: "foundation-chassis",
        childMountPointId: `battery-mount:${batteryIdForPart}`,
        relativePosition: mount.relativePosition,
        relativeRotation: [0, 0, 0],
      };
      const currentBatteryIds = new Set(
        currentBatteries.map((battery) => battery.id)
      );
      const parts = [
        ...state.parts.filter((existingPart) => existingPart.type !== "Battery"),
        part,
      ];
      const connections = [
        ...state.connections.filter(
          (existingConnection) =>
            !currentBatteryIds.has(existingConnection.parentId) &&
            !currentBatteryIds.has(existingConnection.childId)
        ),
        connection,
      ];

      return {
        parts: syncAssemblyTransforms(parts, connections),
        connections,
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: batteryIdForPart,
        selectedBatteryCatalogueId: batteryId,
      };
    });
  },

  removeBattery: () =>
    set((state) => {
      const batteryIds = new Set(
        state.parts
          .filter((part) => part.type === "Battery")
          .map((part) => part.id)
      );
      if (batteryIds.size === 0) return state;

      const parts = state.parts.filter((part) => !batteryIds.has(part.id));
      const connections = state.connections.filter(
        (connection) =>
          !batteryIds.has(connection.parentId) &&
          !batteryIds.has(connection.childId)
      );
      const electricalConnections = state.electricalConnections.filter(
        (connection) =>
          !batteryIds.has(connection.sourcePartId) &&
          !batteryIds.has(connection.targetPartId)
      );
      return {
        parts,
        connections,
        electricalConnections,
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: batteryIds.has(state.selectedId ?? "")
          ? state.foundationId
          : state.selectedId,
      };
    }),

  selectControllerCatalogueItem: (controllerId) => {
    if (!controllerCatalogue.some((item) => item.id === controllerId)) return;
    set({ selectedControllerCatalogueId: controllerId });
  },

  installController: (controllerId) => {
    const definition = controllerCatalogue.find(
      (controller) => controller.id === controllerId
    );
    if (!definition) return;

    set((state) => {
      if (!state.foundation || !state.foundation.confirmed) return state;

      const currentControllers = state.parts.filter(
        (part) => part.type === "Controller"
      );
      const existingController = currentControllers[0];
      const existingConnection = existingController
        ? state.connections.find(
            (connection) =>
              connection.type === "Mechanical" &&
              connection.parentId === "foundation-chassis" &&
              connection.childId === existingController.id
          )
        : undefined;
      const controllerPartId = existingController?.id ?? crypto.randomUUID();
      const connectionId = existingConnection?.id ?? crypto.randomUUID();
      const mount = getControllerMountingTransform(definition, state.foundation);
      const part = createControllerPart(
        definition,
        controllerPartId,
        state.foundation,
        connectionId
      );
      const connection: RobotConnection = {
        id: connectionId,
        sourceId: "foundation-chassis",
        targetId: controllerPartId,
        type: "Mechanical",
        parentId: "foundation-chassis",
        childId: controllerPartId,
        parentMountPointId: "foundation-chassis",
        childMountPointId: `controller-mount:${controllerPartId}`,
        relativePosition: mount.relativePosition,
        relativeRotation: [0, 0, 0],
      };
      const currentControllerIds = new Set(
        currentControllers.map((controller) => controller.id)
      );
      const parts = [
        ...state.parts.filter(
          (existingPart) => existingPart.type !== "Controller"
        ),
        part,
      ];
      const connections = [
        ...state.connections.filter(
          (existingConnection) =>
            !currentControllerIds.has(existingConnection.parentId) &&
            !currentControllerIds.has(existingConnection.childId)
        ),
        connection,
      ];

      return {
        parts: syncAssemblyTransforms(parts, connections),
        connections,
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: controllerPartId,
        selectedControllerCatalogueId: controllerId,
      };
    });
  },

  removeController: () =>
    set((state) => {
      const controllerIds = new Set(
        state.parts
          .filter((part) => part.type === "Controller")
          .map((part) => part.id)
      );
      if (controllerIds.size === 0) return state;

      const parts = state.parts.filter((part) => !controllerIds.has(part.id));
      const connections = state.connections.filter(
        (connection) =>
          !controllerIds.has(connection.parentId) &&
          !controllerIds.has(connection.childId)
      );
      const electricalConnections = state.electricalConnections.filter(
        (connection) =>
          !controllerIds.has(connection.sourcePartId) &&
          !controllerIds.has(connection.targetPartId)
      );
      return {
        parts,
        connections,
        electricalConnections,
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: controllerIds.has(state.selectedId ?? "")
          ? state.foundationId
          : state.selectedId,
      };
    }),

  updateSelectedWheelDimensions: (dimensions) =>
    set((state) => {
      const diameterCm = clampWheelDimension(
        dimensions.diameterCm ?? state.selectedWheelDiameterCm,
        state.selectedWheelDiameterCm,
        wheelDimensionBounds.diameterCm
      );
      const widthCm = clampWheelDimension(
        dimensions.widthCm ?? state.selectedWheelWidthCm,
        state.selectedWheelWidthCm,
        wheelDimensionBounds.widthCm
      );
      const nextState = {
        selectedWheelDiameterCm: diameterCm,
        selectedWheelWidthCm: widthCm,
      };
      const selectedMotor = state.parts.find(
        (part) => part.id === state.selectedWheelMotorId && part.type === "Motor"
      );
      const wheelDefinition = wheelCatalogue.find(
        (wheel) => wheel.id === state.selectedWheelCatalogueId
      );
      const mountedWheel = state.parts.find(
        (part) =>
          part.type === "Wheel" &&
          state.connections.some(
            (connection) =>
              connection.type === "Motor-Wheel" &&
              connection.parentId === selectedMotor?.id &&
              connection.childId === part.id
          )
      );
      if (
        !selectedMotor ||
        !wheelDefinition ||
        mountedWheel?.wheelCatalogueId !== wheelDefinition.id
      ) return { ...state, ...nextState };

      const wheelDimensions = getWheelDimensionsInMeters({
        diameterCm,
        widthCm,
      });
      const customDefinition = {
        ...wheelDefinition,
        ...wheelDimensions,
      };
      const mount = getWheelWorldMountTransform(selectedMotor, customDefinition);
      const nextParts = state.parts.map((part) =>
        part.id === mountedWheel.id
          ? {
              ...part,
              wheelDiameter: wheelDimensions.diameter,
              wheelWidth: wheelDimensions.width,
              size: [
                wheelDimensions.diameter,
                wheelDimensions.width,
                wheelDimensions.diameter,
              ] as [number, number, number],
              position: mount.position,
              rotation: mount.rotation,
              geometry: {
                shape: "cylinder" as const,
                diameter: wheelDimensions.diameter,
                axialWidth: wheelDimensions.width,
                axis: "x" as const,
              },
            }
          : part
      );
      const nextConnections = state.connections.map((connection) =>
        connection.type === "Motor-Wheel" &&
        connection.parentId === selectedMotor.id &&
        connection.childId === mountedWheel.id
          ? {
              ...connection,
              relativePosition: mount.relativePosition,
              wheelOffset: getMotorShaftMountOffset(selectedMotor),
            }
          : connection
      );

      return {
        ...nextState,
        parts: syncAssemblyTransforms(nextParts, nextConnections),
        connections: nextConnections,
      };
    }),

  selectWheelMotor: (motorId) =>
    set({ selectedWheelMotorId: motorId, selectedId: motorId }),

  finishBuild: () =>
    set((state) => {
      if (
        state.stage !== "drivetrain" ||
        !validateDrivetrain(
          state.drivetrain,
          state.parts,
          state.connections,
          state.foundation
        ).isValid
      ) {
        return state;
      }
      return { stage: "completed", transformMode: "select" };
    }),

  placeMotor: () =>
    set((state) => {
      if (!state.foundation || !state.selectedMotorCatalogueId ||
          !state.selectedMountZoneId) return state;

      const zones = generateMotorMountZones(state.foundation);
      const zone = zones.find((item) => item.id === state.selectedMountZoneId);
      const definition = motorCatalogue.find(
        (item) => item.id === state.selectedMotorCatalogueId
      );
      if (!zone || !definition) return state;

      const occupied = state.parts.some(
        (part) => part.mountingZoneId === zone.id
      );
      if (occupied) return state;

      const motorCount = state.parts.filter((part) => part.type === "Motor").length;
      if (motorCount >= 4) return state;

      const motor: RobotPart = {
        id: crypto.randomUUID(),
        name: definition.name,
        type: "Motor",
        motorCatalogueId: definition.id,
        mountingZoneId: zone.id,
        position: [...zone.position] as [number, number, number],
        rotation: [...zone.rotation] as [number, number, number],
        size: [...definition.dimensions] as [number, number, number],
        color: definition.color,
        mass: definition.weight,
        geometry: structuredClone(definition.geometry),
        massKg: definition.massKg,
        mechanical: definition.mechanical
          ? structuredClone(definition.mechanical)
          : undefined,
        engineeringSpec: definition.engineeringSpec
          ? structuredClone(definition.engineeringSpec)
          : undefined,
      };

      const mechanicalConnection: RobotConnection = {
        id: crypto.randomUUID(),
        sourceId: "foundation-chassis",
        targetId: motor.id,
        type: "Mechanical",
        parentId: "foundation-chassis",
        childId: motor.id,
        parentMountPointId: "foundation-zone",
        childMountPointId: "motor-mount",
        relativePosition: [
          zone.position[0],
          zone.position[1] - state.foundation.height * 0.5,
          zone.position[2],
        ],
        relativeRotation: zone.rotation,
      };

      return {
        parts: [...state.parts, motor],
        connections: [...state.connections, mechanicalConnection],
        selectedId: motor.id,
      };
    }),

  mountMotorToParent: (parentId, parentInterfaceId, motorCatalogueId) => {
    let createdMotorId: string | null = null;
    set((state) => {
      const catalogueId = motorCatalogueId ?? state.selectedMotorCatalogueId;
      if (!state.foundation || !catalogueId) return state;

      const definition = motorCatalogue.find((item) => item.id === catalogueId);
      const parentPart = state.parts.find((part) => part.id === parentId);
      if (
        !definition ||
        !parentPart ||
        parentPart.type === "Wheel" ||
        parentPart.type === "Motor"
      ) {
        return state;
      }

      const motorCount = state.parts.filter((part) => part.type === "Motor").length;
      if (motorCount >= 4) return state;

      const motorId = crypto.randomUUID();
      const draftMotor: RobotPart = {
        id: motorId,
        name: definition.name,
        type: "Motor",
        motorCatalogueId: definition.id,
        position: [0, 0.25, 0],
        rotation: [0, -Math.PI / 2, 0],
        size: [...definition.dimensions] as [number, number, number],
        color: definition.color,
        mass: definition.weight,
        geometry: structuredClone(definition.geometry),
        massKg: definition.massKg,
        mechanical: definition.mechanical
          ? structuredClone(definition.mechanical)
          : undefined,
        engineeringSpec: definition.engineeringSpec
          ? structuredClone(definition.engineeringSpec)
          : undefined,
      };

      const parentInterfaces = resolvePartMountingInterfaces(
        parentPart,
        state.foundation
      );
      const childInterfaces = resolvePartMountingInterfaces(
        draftMotor,
        state.foundation
      );
      const preferredParentIface =
        parentInterfaces.find((i) => i.id === parentInterfaceId) ??
        parentInterfaces.find((i) => i.compatibleWith.includes("motor-mount")) ??
        parentInterfaces[0];
      const preferredChildIface =
        childInterfaces.find((i) => i.id === "motor-mount") ?? childInterfaces[0];

      if (!preferredParentIface || !preferredChildIface) return state;

      const attached = computeAttachedChildTransform(
        parentPart,
        preferredParentIface,
        draftMotor,
        preferredChildIface
      );

      // Ensure motor output shaft (+X local) faces laterally (±Z) outward for differential drive
      const shaftWorld = new Vector3(1, 0, 0).applyEuler(
        new Euler(...attached.worldRotation, "XYZ")
      );
      let worldRotation = [...attached.worldRotation] as [number, number, number];
      let relativeRotation = [...attached.relativeRotation] as [
        number,
        number,
        number,
      ];
      if (Math.abs(shaftWorld.z) < 0.7) {
        const outwardYaw =
          attached.worldPosition[2] >= 0 ? -Math.PI / 2 : Math.PI / 2;
        worldRotation = [0, outwardYaw, 0];
        relativeRotation = [
          worldRotation[0] - (parentPart.rotation?.[0] ?? 0),
          worldRotation[1] - (parentPart.rotation?.[1] ?? 0),
          worldRotation[2] - (parentPart.rotation?.[2] ?? 0),
        ];
      }

      const attachmentId = crypto.randomUUID();
      const mountedMotor: RobotPart = {
        ...draftMotor,
        position: attached.worldPosition,
        rotation: worldRotation,
        parentAttachmentId: attachmentId,
      };
      const connection: RobotConnection = {
        id: attachmentId,
        sourceId: parentPart.id,
        targetId: motorId,
        parentId: parentPart.id,
        childId: motorId,
        parentMountPointId: preferredParentIface.id,
        childMountPointId: preferredChildIface.id,
        relativePosition: attached.relativePosition,
        relativeRotation,
        type: "Mechanical",
      };

      const nextConnections = [...state.connections, connection];
      const synchronizedParts = syncAssemblyTransforms(
        [...state.parts, mountedMotor],
        nextConnections
      );
      createdMotorId = motorId;

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        selectedId: motorId,
      };
    });
    return createdMotorId;
  },

  replaceMotor: (zoneId) =>
    set((state) => {
      if (!state.foundation || !state.selectedMotorCatalogueId) return state;
      const definition = motorCatalogue.find(
        (item) => item.id === state.selectedMotorCatalogueId
      );
      const zone = generateMotorMountZones(state.foundation).find(
        (item) => item.id === zoneId
      );
      if (!definition || !zone) return state;

      const motorIds = new Set(
        state.parts
          .filter((part) => part.mountingZoneId === zoneId)
          .map((part) => part.id)
      );
      const incompatibleWheelIds = new Set(
        state.connections
          .filter(
            (connection) =>
              connection.type === "Motor-Wheel" &&
              motorIds.has(connection.parentId)
          )
          .filter((connection) => {
            const wheel = state.parts.find(
              (part) => part.id === connection.childId
            );
            const wheelDefinition = wheel?.wheelCatalogueId
              ? wheelCatalogue.find(
                  (item) => item.id === wheel.wheelCatalogueId
                )
              : undefined;
            return Boolean(
              wheelDefinition &&
              !wheelDefinition.compatibleMotorIds.includes(definition.id)
            );
          })
          .map((connection) => connection.childId)
      );
      const nextParts = state.parts
        .filter((part) => !incompatibleWheelIds.has(part.id))
        .map((part) =>
          part.mountingZoneId === zoneId
            ? {
                ...part,
                name: definition.name,
                motorCatalogueId: definition.id,
                position: [...zone.position] as [number, number, number],
                rotation: [...zone.rotation] as [number, number, number],
                size: [...definition.dimensions] as [number, number, number],
                color: definition.color,
                mass: definition.weight,
                geometry: structuredClone(definition.geometry),
                massKg: definition.massKg,
                mechanical: definition.mechanical
                  ? structuredClone(definition.mechanical)
                  : undefined,
                electrical: undefined,
                electricalSpec: undefined,
                wheelDiameter: undefined,
                wheelWidth: undefined,
                wheelCatalogueId: undefined,
                batteryCatalogueId: undefined,
                controllerCatalogueId: undefined,
                foundationModelId: undefined,
                engineeringSpec: definition.engineeringSpec
                  ? structuredClone(definition.engineeringSpec)
                  : undefined,
              }
            : part
        );
      const nextConnections = state.connections
        .filter((connection) => !incompatibleWheelIds.has(connection.childId))
        .map((connection) => {
          const mountedMotor = nextParts.find(
            (part) => part.id === connection.childId && part.type === "Motor"
          );
          if (
            connection.type === "Mechanical" &&
            mountedMotor?.mountingZoneId === zoneId
          ) {
            return {
              ...connection,
              relativeRotation: [
                ...mountedMotor.rotation,
              ] as [number, number, number],
            };
          }
          const attachedWheel = nextParts.find(
            (part) => part.id === connection.childId && part.type === "Wheel"
          );
          const parentMotor = nextParts.find(
            (part) => part.id === connection.parentId && part.type === "Motor"
          );
          const wheelDefinition = attachedWheel?.wheelCatalogueId
            ? wheelCatalogue.find(
                (item) => item.id === attachedWheel.wheelCatalogueId
              )
            : undefined;
          if (
            connection.type !== "Motor-Wheel" ||
            !parentMotor ||
            !wheelDefinition
          ) return connection;
          const canonicalDiameter =
            attachedWheel?.geometry?.shape === "cylinder"
              ? attachedWheel.geometry.diameter
              : undefined;
          const canonicalWidth =
            attachedWheel?.geometry?.shape === "cylinder"
              ? attachedWheel.geometry.axialWidth
              : undefined;

          const instanceDefinition = attachedWheel
            ? {
                ...wheelDefinition,
                diameter:
                  canonicalDiameter ??
                  attachedWheel.wheelDiameter ??
                  attachedWheel.size[0],
                width:
                  canonicalWidth ??
                  attachedWheel.wheelWidth ??
                  attachedWheel.size[1],
              }
            : wheelDefinition;
          return {
            ...connection,
            relativePosition: getWheelWorldMountTransform(
              parentMotor,
              instanceDefinition
            ).relativePosition,
          };
        });

      const synchronizedParts = syncAssemblyTransforms(
        nextParts,
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        electricalConnections: state.electricalConnections.filter(
          (conn) =>
            !incompatibleWheelIds.has(conn.sourcePartId) &&
            !incompatibleWheelIds.has(conn.targetPartId)
        ),
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          synchronizedParts,
          nextConnections,
          state.foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, nextParts),
        selectedMountZoneId: zoneId,
      };
    }),

  removeMotor: (zoneId) =>
    set((state) => {
      const motorIds = new Set(
        state.parts
          .filter((part) => part.mountingZoneId === zoneId)
          .map((part) => part.id)
      );
      const removedIds = new Set(motorIds);
      state.connections.forEach((connection) => {
        if (
          connection.type === "Motor-Wheel" &&
          motorIds.has(connection.parentId)
        ) {
          removedIds.add(connection.childId);
        }
      });
      const nextParts = state.parts.filter(
        (part) => !removedIds.has(part.id)
      );
      const nextConnections = state.connections.filter(
        (connection) =>
          !removedIds.has(connection.childId) &&
          !removedIds.has(connection.parentId)
      );

      return {
        parts: nextParts,
        connections: nextConnections,
        electricalConnections: state.electricalConnections.filter(
          (conn) =>
            !removedIds.has(conn.sourcePartId) &&
            !removedIds.has(conn.targetPartId)
        ),
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          nextParts,
          nextConnections,
          state.foundation
        ),
        hiddenPartIds: retainVisibilityForParts(
          state.hiddenPartIds,
          nextParts
        ),
        selectedMountZoneId:
          state.selectedMountZoneId === zoneId
            ? null
            : state.selectedMountZoneId,
        selectedWheelMotorId:
          state.selectedWheelMotorId &&
          motorIds.has(state.selectedWheelMotorId)
            ? null
            : state.selectedWheelMotorId,
        selectedId:
          state.selectedId && removedIds.has(state.selectedId)
            ? "foundation-chassis"
            : state.selectedId,
      };
    }),

  rotateMotor: (zoneId, rotationY) =>
    set((state) => {
      const motors = state.parts.filter(
        (part) => part.type === "Motor" && part.mountingZoneId === zoneId
      );
      if (motors.length === 0) return state;

      const zone = state.foundation
        ? generateMotorMountZones(state.foundation).find((item) => item.id === zoneId)
        : undefined;
      const baseRotationY = zone?.rotation[1] ?? 0;
      const currentMotor = motors[0];

      let nextRotationY: number;
      if (rotationY !== undefined) {
        nextRotationY = rotationY;
      } else {
        const isBase = Math.abs(currentMotor.rotation[1] - baseRotationY) < 0.001;
        nextRotationY = isBase ? baseRotationY + Math.PI : baseRotationY;
      }

      const rotation: [number, number, number] = [0, nextRotationY, 0];
      const motorIds = new Set(motors.map((motor) => motor.id));
      const nextConnections = state.connections.map((connection) =>
        connection.type === "Mechanical" &&
        motorIds.has(connection.childId)
          ? { ...connection, relativeRotation: rotation }
          : connection
      );
      return {
        parts: syncAssemblyTransforms(
          state.parts.map((part) =>
            motorIds.has(part.id) ? { ...part, rotation } : part
          ),
          nextConnections
        ),
        connections: nextConnections,
      };
    }),

  startNewBuild: () => {
    const model = foundationModels[1];
    const foundation: FoundationConfig = {
      modelId: model.id,
      length: model.length,
      width: model.width,
      height: model.height,
      includeTopPlate: true,
      includeFrontCover: false,
      confirmed: false,
      mode: "procedural",
    };

    set({
      foundation,
      foundationId: "foundation-chassis",
      parts: createFoundationParts(foundation),
      connections: [],
      electricalConnections: [],
      hiddenPartIds: [],
      selectedId: "foundation-chassis",
      transformMode: "select",
      stage: "foundation",
      drivetrain: createEmptyDrivetrain(),
      selectedMotorCatalogueId: null,
      selectedMountZoneId: null,
      selectedWheelCatalogueId: null,
      selectedWheelMotorId: null,
      selectedWheelDiameterCm: 22,
      selectedWheelWidthCm: 7,
      selectedBatteryCatalogueId: "standard-lipo",
      selectedControllerCatalogueId: "arduino-uno",
      selectedStructuralCatalogueId: "structural-rail",
      historyPast: [],
      historyFuture: [],
    });
    syncActiveAssetRefs([]);
  },

  selectFoundationModel: (modelId) => {
    const model = foundationModels.find((item) => item.id === modelId);
    if (!model) return;

    set((state) => {
      const foundation: FoundationConfig = {
        modelId,
        length: model.length,
        width: model.width,
        height: model.height,
        includeTopPlate: state.foundation?.includeTopPlate ?? true,
        includeFrontCover: state.foundation?.includeFrontCover ?? false,
        confirmed: false,
        mode: "procedural",
      };
      const nonMemberConnections = state.connections.filter(
        (c) => !c.id.startsWith("conn-foundation-member-")
      );
      const parts = preserveMountedComponents(
        createFoundationParts(foundation),
        state.parts,
        foundation,
        nonMemberConnections
      );
      const connections = remapFoundationConnections(
        nonMemberConnections,
        parts,
        foundation
      );

      return {
        foundation,
        foundationId: "foundation-chassis",
        parts,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        connections,
        selectedId: "foundation-chassis",
      };
    });
  },

  updateFoundationDimensions: (dimensions) => {
    set((state) => {
      if (!state.foundation) return state;

      const nextLength = Math.max(
        0.35,
        Math.min(6, dimensions.length ?? state.foundation.length)
      );
      const nextWidth = Math.max(
        0.35,
        Math.min(5, dimensions.width ?? state.foundation.width)
      );
      const nextHeight = Math.max(
        0.02,
        Math.min(1.5, dimensions.height ?? state.foundation.height)
      );
      const clampedLength =
        state.foundation.mode === "procedural"
          ? nextLength
          : Math.max(0.8, Math.min(4, nextLength));
      const clampedWidth =
        state.foundation.mode === "procedural"
          ? nextWidth
          : Math.max(0.8, Math.min(3, nextWidth));
      const clampedHeight =
        state.foundation.mode === "procedural"
          ? nextHeight
          : Math.max(0.12, Math.min(1, nextHeight));

      const foundation: FoundationConfig = {
        ...state.foundation,
        length: clampedLength,
        width: clampedWidth,
        height: clampedHeight,
        ...(state.foundation.mode === "procedural" && state.foundation.procedural
          ? {
              procedural: {
                ...state.foundation.procedural,
                length: clampedLength,
                width: clampedWidth,
                height: clampedHeight,
                mountingPattern: {
                  ...state.foundation.procedural.mountingPattern,
                  origin: [
                    state.foundation.procedural.mountingPattern.origin[0],
                    clampedHeight * 0.5,
                    state.foundation.procedural.mountingPattern.origin[2],
                  ],
                  boundsLengthM: Math.max(0.1, clampedLength * 0.85),
                  boundsWidthM: Math.max(0.1, clampedWidth * 0.85),
                },
              },
            }
          : {}),
        confirmed: false,
      };
      const builtFoundation = createFoundationPartsAndConnections(foundation);
      const nonMemberConnections = state.connections.filter(
        (c) => !c.id.startsWith("conn-foundation-member-")
      );
      const mergedConnections = [...builtFoundation.connections, ...nonMemberConnections];
      const parts = preserveMountedComponents(
        builtFoundation.parts,
        state.parts,
        foundation,
        mergedConnections
      );
      const connections = remapFoundationConnections(
        mergedConnections,
        parts,
        foundation
      );

      return {
        foundation,
        parts,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        connections,
        selectedId: "foundation-chassis",
      };
    });
  },

  setFoundationOptions: (options) => {
    set((state) => {
      if (!state.foundation) return state;

      const foundation: FoundationConfig = {
        ...state.foundation,
        ...options,
        confirmed: false,
      };
      const builtFoundation = createFoundationPartsAndConnections(foundation);
      const nonMemberConnections = state.connections.filter(
        (c) => !c.id.startsWith("conn-foundation-member-")
      );
      const mergedConnections = [...builtFoundation.connections, ...nonMemberConnections];
      const parts = preserveMountedComponents(
        builtFoundation.parts,
        state.parts,
        foundation,
        mergedConnections
      );
      const connections = remapFoundationConnections(
        mergedConnections,
        parts,
        foundation
      );

      return {
        foundation,
        parts,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        connections,
        selectedId: "foundation-chassis",
      };
    });
  },

  configureProceduralFoundation: (patch) => {
    set((state) => {
      const current = state.foundation;
      const baseArch =
        patch.architecture ??
        current?.procedural?.architecture ??
        "perimeter-frame";
      const baseProc =
        current?.procedural && current.procedural.architecture === baseArch
          ? current.procedural
          : createDefaultProceduralFoundationConfig(baseArch, {
              length: patch.length ?? current?.length,
              width: patch.width ?? current?.width,
              height: patch.height ?? current?.height,
            });

      const nextLength = patch.length ?? baseProc.length;
      const nextWidth = patch.width ?? baseProc.width;
      const nextHeight = patch.height ?? baseProc.height;

      const nextProcedural: ProceduralFoundationConfig = {
        ...baseProc,
        ...patch,
        architecture: baseArch,
        length: nextLength,
        width: nextWidth,
        height: nextHeight,
        flanges: patch.flanges
          ? { ...baseProc.flanges, ...patch.flanges }
          : baseProc.flanges,
        mountingPattern: patch.mountingPattern
          ? { ...baseProc.mountingPattern, ...patch.mountingPattern }
          : {
              ...baseProc.mountingPattern,
              origin: [
                baseProc.mountingPattern.origin[0],
                nextHeight * 0.5,
                baseProc.mountingPattern.origin[2],
              ],
              boundsLengthM: Math.max(0.1, nextLength * 0.85),
              boundsWidthM: Math.max(0.1, nextWidth * 0.85),
            },
      };

      const foundation: FoundationConfig = {
        modelId: current?.modelId ?? "standard-rectangular",
        length: nextLength,
        width: nextWidth,
        height: nextHeight,
        includeTopPlate:
          baseArch === "flat-plate" || baseArch === "sheet-metal-tray" || baseArch === "hybrid"
            ? false
            : (current?.includeTopPlate ?? false),
        includeFrontCover: current?.includeFrontCover ?? false,
        confirmed: false,
        mode: "procedural",
        procedural: nextProcedural,
      };

      const builtFoundation = createFoundationPartsAndConnections(foundation);
      const nonMemberConnections = state.connections.filter(
        (c) => !c.id.startsWith("conn-foundation-member-")
      );
      const mergedConnections = [...builtFoundation.connections, ...nonMemberConnections];
      const parts = preserveMountedComponents(
        builtFoundation.parts,
        state.parts,
        foundation,
        mergedConnections
      );
      const connections = remapFoundationConnections(
        mergedConnections,
        parts,
        foundation
      );

      return {
        foundation,
        foundationId: "foundation-chassis",
        parts,
        connections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: "foundation-chassis",
      };
    });
  },

  resetProceduralFoundation: (architecture = "perimeter-frame") => {
    const defaults = createDefaultProceduralFoundationConfig(architecture);
    get().configureProceduralFoundation(defaults);
  },

  importFoundationStl: (params) => {
    retainMeshAsset(params.assetId);
    set((state) => {
      const scaleTuple =
        params.transform.scaleMode === "uniform"
          ? ([
              params.transform.uniformScale,
              params.transform.uniformScale,
              params.transform.uniformScale,
            ] as const)
          : params.transform.nonUniformScale;
      const extents = computeTransformedStlExtents({
        rawDimensions: params.inspection.rawDimensions,
        unit: params.transform.unit,
        scale: scaleTuple,
        orientationRotation: params.transform.orientationRotation,
      });
      const length = Math.max(0.05, extents[0]);
      const height = Math.max(0.02, extents[1]);
      const width = Math.max(0.05, extents[2]);

      const foundation: FoundationConfig = {
        modelId: state.foundation?.modelId ?? "standard-rectangular",
        length,
        width,
        height,
        includeTopPlate: false,
        includeFrontCover: false,
        confirmed: false,
        mode: "imported",
        imported: {
          assetId: params.assetId,
          fileName: params.fileName,
          inspection: params.inspection,
          transform: structuredClone(params.transform),
          engineering: structuredClone(params.engineering),
          collision: structuredClone(params.collision),
        },
      };

      const builtFoundation = createFoundationPartsAndConnections(foundation);
      if (params.name && builtFoundation.parts[0]) {
        builtFoundation.parts[0] = {
          ...builtFoundation.parts[0],
          name: params.name,
        };
      }
      const nonMemberConnections = state.connections.filter(
        (c) => !c.id.startsWith("conn-foundation-member-")
      );
      const parts = preserveMountedComponents(
        builtFoundation.parts,
        state.parts,
        foundation,
        nonMemberConnections
      );
      const connections = remapFoundationConnections(
        nonMemberConnections,
        parts,
        foundation
      );

      return {
        foundation,
        foundationId: "foundation-chassis",
        parts,
        connections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          foundation
        ),
        hiddenPartIds: retainVisibilityForParts(state.hiddenPartIds, parts),
        selectedId: "foundation-chassis",
      };
    });
  },

  importStructuralStl: (params) => {
    retainMeshAsset(params.assetId);
    const newId = crypto.randomUUID();
    set((state) => {
      const scaleTuple =
        params.transform.scaleMode === "uniform"
          ? ([
              params.transform.uniformScale,
              params.transform.uniformScale,
              params.transform.uniformScale,
            ] as const)
          : params.transform.nonUniformScale;
      const extents = computeTransformedStlExtents({
        rawDimensions: params.inspection.rawDimensions,
        unit: params.transform.unit,
        scale: scaleTuple,
        orientationRotation: params.transform.orientationRotation,
      });
      const L = Math.max(0.02, extents[0]);
      const H = Math.max(0.02, extents[1]);
      const W = Math.max(0.02, extents[2]);
      const mass =
        params.engineering.massKg !== undefined && params.engineering.massKg > 0
          ? params.engineering.massKg
          : 0;

      const parentPart = params.parentId
        ? state.parts.find((p) => p.id === params.parentId)
        : state.parts.find((p) => p.id === "foundation-chassis");

      let pos: [number, number, number] = [
        params.transform.positionOffset[0],
        (state.foundation?.height ?? 0.3) + H * 0.5 + params.transform.positionOffset[1],
        params.transform.positionOffset[2],
      ];
      let rot: [number, number, number] = [...params.transform.orientationRotation];

      const draft: RobotPart = {
        id: newId,
        name: params.name ?? (params.fileName.replace(/\.stl$/i, "") || "Imported STL Part"),
        type: "Structural Block",
        structuralCategory: "bracket",
        position: pos,
        rotation: rot,
        size: [L, H, W],
        color: "#94a3b8",
        mass,
        massKg: mass,
        meshAssetId: params.assetId,
        meshTransform: structuredClone(params.transform),
        collisionConfig: structuredClone(params.collision),
        importedEngineering: structuredClone(params.engineering),
        customInertiaKgM2: params.engineering.inertiaKgM2
          ? [...params.engineering.inertiaKgM2]
          : undefined,
        geometry: {
          shape: "box",
          length: L,
          height: H,
          width: W,
        },
        engineeringSpec: {
          category: "structural",
          role: "bulkhead",
          generalProvenance: params.engineering.provenance,
        },
      };

      const nextConnections = [...state.connections];
      let attachmentId: string | undefined;

      if (parentPart) {
        const pIfaces = resolvePartMountingInterfaces(parentPart, state.foundation);
        const cIfaces = resolvePartMountingInterfaces(draft, state.foundation);
        const parentIface =
          pIfaces.find((i) => i.id === params.parentInterfaceId) ?? pIfaces[0];
        const childIface = cIfaces[0];
        if (parentIface && childIface) {
          const attached = computeAttachedChildTransform(
            parentPart,
            parentIface,
            draft,
            childIface
          );
          pos = [
            attached.worldPosition[0] + params.transform.positionOffset[0],
            attached.worldPosition[1] + params.transform.positionOffset[1],
            attached.worldPosition[2] + params.transform.positionOffset[2],
          ];
          rot = attached.worldRotation;
          attachmentId = crypto.randomUUID();
          nextConnections.push({
            id: attachmentId,
            sourceId: parentPart.id,
            targetId: newId,
            parentId: parentPart.id,
            childId: newId,
            parentMountPointId: parentIface.id,
            childMountPointId: childIface.id,
            relativePosition: [
              attached.relativePosition[0] + params.transform.positionOffset[0],
              attached.relativePosition[1] + params.transform.positionOffset[1],
              attached.relativePosition[2] + params.transform.positionOffset[2],
            ],
            relativeRotation: attached.relativeRotation,
            type: "Mechanical",
          });
        }
      }

      const finalPart: RobotPart = {
        ...draft,
        position: pos,
        rotation: rot,
        parentAttachmentId: attachmentId,
      };
      const synchronizedParts = syncAssemblyTransforms(
        [...state.parts, finalPart],
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        selectedId: newId,
      };
    });
    return newId;
  },

  updateImportedPartConfiguration: (partId, patch) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target || !target.meshAssetId) return state;

      const inspection =
        state.foundation?.imported?.assetId === target.meshAssetId
          ? state.foundation.imported.inspection
          : undefined;
      const nextTransform: ImportedMeshTransform | undefined = target.meshTransform
        ? {
            ...target.meshTransform,
            ...patch.transform,
          }
        : undefined;

      let nextSize = target.size;
      if (inspection && nextTransform) {
        const scaleTuple =
          nextTransform.scaleMode === "uniform"
            ? ([
                nextTransform.uniformScale,
                nextTransform.uniformScale,
                nextTransform.uniformScale,
              ] as const)
            : nextTransform.nonUniformScale;
        const extents = computeTransformedStlExtents({
          rawDimensions: inspection.rawDimensions,
          unit: nextTransform.unit,
          scale: scaleTuple,
          orientationRotation: nextTransform.orientationRotation,
        });
        nextSize = [
          Math.max(0.02, extents[0]),
          Math.max(0.02, extents[1]),
          Math.max(0.02, extents[2]),
        ];
      }

      const baseEng = target.importedEngineering;
      const nextEngineering: ImportedEngineeringProperties | undefined =
        baseEng || patch.engineering
          ? inspection && nextTransform
            ? resolveImportedEngineeringProperties({
                inspection,
                transform: nextTransform,
                materialId: patch.engineering?.materialId ?? baseEng?.materialId ?? "unknown",
                customDensityKgM3:
                  patch.engineering?.materialDensityKgM3 ?? baseEng?.materialDensityKgM3,
                massMode: patch.engineering?.massMode ?? baseEng?.massMode ?? "unknown",
                userMassKg: patch.engineering?.massKg ?? baseEng?.massKg,
                centerOfMassMode:
                  patch.engineering?.centerOfMassMode ?? baseEng?.centerOfMassMode ?? "unknown",
                userCenterOfMassLocal:
                  patch.engineering?.centerOfMassLocal ?? baseEng?.centerOfMassLocal,
                inertiaMode: patch.engineering?.inertiaMode ?? baseEng?.inertiaMode ?? "unknown",
                userInertiaKgM2:
                  patch.engineering?.inertiaKgM2 ?? baseEng?.inertiaKgM2,
              })
            : ({ ...baseEng, ...patch.engineering } as ImportedEngineeringProperties)
          : undefined;

      const nextCollision =
        patch.collision ??
        (target.collisionConfig
          ? buildCustomCollisionConfig({
              mode: target.collisionConfig.mode,
              extents: nextSize,
              assetId: target.meshAssetId,
            })
          : undefined);

      const resolvedMass =
        nextEngineering?.massKg !== undefined && nextEngineering.massKg > 0
          ? nextEngineering.massKg
          : target.massKg ?? target.mass;

      const updatedPart: RobotPart = {
        ...target,
        size: nextSize,
        rotation: nextTransform
          ? [...nextTransform.orientationRotation]
          : target.rotation,
        mass: resolvedMass,
        massKg: resolvedMass,
        meshTransform: nextTransform,
        importedEngineering: nextEngineering,
        collisionConfig: nextCollision,
        customInertiaKgM2: nextEngineering?.inertiaKgM2
          ? [...nextEngineering.inertiaKgM2]
          : undefined,
        geometry: {
          shape: "box",
          length: nextSize[0],
          height: nextSize[1],
          width: nextSize[2],
        },
        engineeringSpec: {
          category: "structural",
          role: "chassis-frame",
          generalProvenance: nextEngineering?.provenance,
        },
      };

      const nextParts = state.parts.map((p) => (p.id === partId ? updatedPart : p));
      const nextFoundation =
        partId === "foundation-chassis" &&
        state.foundation?.mode === "imported" &&
        state.foundation.imported
          ? {
              ...state.foundation,
              length: nextSize[0],
              height: nextSize[1],
              width: nextSize[2],
              imported: {
                ...state.foundation.imported,
                transform: nextTransform ?? state.foundation.imported.transform,
                engineering:
                  nextEngineering ?? state.foundation.imported.engineering,
                collision: nextCollision ?? state.foundation.imported.collision,
              },
            }
          : state.foundation;

      return {
        parts: nextParts,
        foundation: nextFoundation,
      };
    });
  },

  addCustomMountingInterface: (partId, iface) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;
      const existing = target.customMountingInterfaces ?? [];
      return {
        parts: state.parts.map((p) =>
          p.id === partId
            ? {
                ...p,
                customMountingInterfaces: [
                  ...existing,
                  { ...iface, isCustom: true },
                ],
              }
            : p
        ),
      };
    });
  },

  updateCustomMountingInterface: (partId, ifaceId, patch) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;
      const existing = target.customMountingInterfaces ?? [];
      return {
        parts: state.parts.map((p) =>
          p.id === partId
            ? {
                ...p,
                customMountingInterfaces: existing.map((iface) =>
                  iface.id === ifaceId ? { ...iface, ...patch } : iface
                ),
              }
            : p
        ),
      };
    });
  },

  removeCustomMountingInterface: (partId, ifaceId) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;
      const existing = target.customMountingInterfaces ?? [];
      return {
        parts: state.parts.map((p) =>
          p.id === partId
            ? {
                ...p,
                customMountingInterfaces: existing.filter(
                  (iface) => iface.id !== ifaceId
                ),
              }
            : p
        ),
      };
    });
  },

  updatePartMountingPattern: (partId, pattern) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;
      const patterns = target.mountingPatterns ?? [];
      const hasExisting = patterns.some((p) => p.id === pattern.id);
      const nextPatterns = hasExisting
        ? patterns.map((p) => (p.id === pattern.id ? pattern : p))
        : [...patterns, pattern];
      const nextFoundation =
        partId === "foundation-chassis" &&
        state.foundation?.mode === "procedural" &&
        state.foundation.procedural
          ? {
              ...state.foundation,
              procedural: {
                ...state.foundation.procedural,
                mountingPattern: pattern,
              },
            }
          : state.foundation;
      return {
        parts: state.parts.map((p) =>
          p.id === partId ? { ...p, mountingPatterns: nextPatterns } : p
        ),
        foundation: nextFoundation,
      };
    });
  },

  confirmFoundation: () => {
    set((state) => {
      if (!state.foundation) return state;
      return {
        foundation: {
          ...state.foundation,
          confirmed: true,
        },
        selectedId: "foundation-chassis",
        transformMode: "select",
        stage: "battery",
      };
    });
  },

  deletePartById: (targetId) => {
    if (!targetId) return;

    set((state) => {
      const selectedPart = state.parts.find((part) => part.id === targetId);
      if (!selectedPart) return state;
      const deletingFoundation = targetId === state.foundationId;
      const removedIds = new Set([targetId]);
      if (deletingFoundation) {
        for (const part of state.parts) {
          if (
            part.id === "foundation-top-plate" ||
            part.id === "foundation-front-cover"
          ) {
            removedIds.add(part.id);
          }
        }

        const pendingIds = [...removedIds];
        while (pendingIds.length > 0) {
          const parentId = pendingIds.pop();
          if (!parentId) continue;

          for (const connection of state.connections) {
            const connectionParentId =
              connection.parentId ?? connection.sourceId;
            const childId = connection.childId ?? connection.targetId;
            if (
              connectionParentId === parentId &&
              !removedIds.has(childId)
            ) {
              removedIds.add(childId);
              pendingIds.push(childId);
            }
          }
        }
      } else if (selectedPart.type === "Motor") {
        state.connections.forEach((connection) => {
          if (
            connection.type === "Motor-Wheel" &&
            (connection.parentId ?? connection.sourceId) === targetId
          ) {
            removedIds.add(connection.childId ?? connection.targetId);
          }
        });
      }
      const nextConnections = state.connections.filter(
        (connection) =>
          !removedIds.has(connection.parentId ?? connection.sourceId) &&
          !removedIds.has(connection.childId ?? connection.targetId)
      );
      const detachedChildren = new Set(
        state.connections
          .filter(
            (connection) =>
              removedIds.has(connection.parentId ?? connection.sourceId) &&
              !removedIds.has(connection.childId ?? connection.targetId)
          )
          .map(
            (connection) =>
              connection.childId ?? connection.targetId
          )
      );
      const nextParts = state.parts
        .filter((part) => !removedIds.has(part.id))
        .map((part) =>
          detachedChildren.has(part.id)
            ? { ...part, parentAttachmentId: undefined }
            : part
        );
      const nextDrivetrain = deletingFoundation
        ? createEmptyDrivetrain()
        : retainValidDrivetrainAssignments(
            state.drivetrain,
            nextParts,
            nextConnections,
            state.foundation
          );

      return {
        parts: nextParts,
        connections: nextConnections,
        electricalConnections: state.electricalConnections.filter(
          (connection) =>
            !removedIds.has(connection.sourcePartId) &&
            !removedIds.has(connection.targetPartId)
        ),
        drivetrain: nextDrivetrain,
        hiddenPartIds: state.hiddenPartIds.filter(
          (partId) => !removedIds.has(partId)
        ),
        ...(deletingFoundation
          ? {
              foundation: null,
              foundationId: null,
              stage: "foundation" as const,
              drivetrain: createEmptyDrivetrain(),
              transformMode: "select" as const,
              selectedMotorCatalogueId: null,
              selectedMountZoneId: null,
              selectedWheelCatalogueId: null,
              selectedWheelMotorId: null,
              selectedWheelDiameterCm: 22,
              selectedWheelWidthCm: 7,
              selectedBatteryCatalogueId: "standard-lipo",
              selectedControllerCatalogueId: "arduino-uno",
            }
          : targetId === "foundation-top-plate" && state.foundation
            ? {
                foundation: {
                  ...state.foundation,
                  includeTopPlate: false,
                  confirmed: false,
                },
              }
            : targetId === "foundation-front-cover" && state.foundation
              ? {
                  foundation: {
                    ...state.foundation,
                    includeFrontCover: false,
                    confirmed: false,
                  },
                }
              : {}),
        selectedId:
          state.selectedId && removedIds.has(state.selectedId)
            ? null
            : state.selectedId,
        selectedWheelMotorId: deletingFoundation
          ? null
          : state.selectedWheelMotorId === targetId
            ? null
            : state.selectedWheelMotorId,
      };
    });
  },

  deleteSelected: () => {
    const selectedId = get().selectedId;
    if (!selectedId) return;
    get().deletePartById(selectedId);
  },

  updatePartTransform: (id, position, rotation, size) =>
    set((state) => {
      const targetPart = state.parts.find((p) => p.id === id);
      if (!targetPart) return state;

      const updatedParts = state.parts.map((part) => {
        if (part.id !== id) return part;
        const synced = size ? syncGeometryFromSize(part, size) : {};
        return {
          ...part,
          position,
          rotation,
          ...synced,
        };
      });

      const nextConnections = state.connections.map((conn) => {
        const childId = conn.childId ?? conn.targetId;
        if (childId !== id || conn.type === "Motor-Wheel") return conn;
        const parentPart = updatedParts.find(
          (p) => p.id === (conn.parentId ?? conn.sourceId)
        );
        if (!parentPart) return conn;
        const rel = computeRelativeTransformBetweenParts(
          parentPart,
          position,
          rotation
        );
        return {
          ...conn,
          relativePosition: rel.relativePosition,
          relativeRotation: rel.relativeRotation,
        };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, nextConnections),
        connections: nextConnections,
      };
    }),

  previewPartTransform: (id, position, rotation, size) =>
    rawSet((state) => {
      const targetPart = state.parts.find((p) => p.id === id);
      if (!targetPart) return state;

      const updatedParts = state.parts.map((part) => {
        if (part.id !== id) return part;
        const synced = size ? syncGeometryFromSize(part, size) : {};
        return {
          ...part,
          position,
          rotation,
          ...synced,
        };
      });

      const nextConnections = state.connections.map((conn) => {
        const childId = conn.childId ?? conn.targetId;
        if (childId !== id || conn.type === "Motor-Wheel") return conn;
        const parentPart = updatedParts.find(
          (p) => p.id === (conn.parentId ?? conn.sourceId)
        );
        if (!parentPart) return conn;
        const rel = computeRelativeTransformBetweenParts(
          parentPart,
          position,
          rotation
        );
        return {
          ...conn,
          relativePosition: rel.relativePosition,
          relativeRotation: rel.relativeRotation,
        };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, nextConnections),
        connections: nextConnections,
      };
    }),

  updatePartPosition: (id, position) =>
    set((state) => {
      const targetPart = state.parts.find((p) => p.id === id);
      if (!targetPart) return state;

      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, position } : part
      );

      const nextConnections = state.connections.map((conn) => {
        const childId = conn.childId ?? conn.targetId;
        if (childId !== id || conn.type === "Motor-Wheel") return conn;
        const parentPart = updatedParts.find(
          (p) => p.id === (conn.parentId ?? conn.sourceId)
        );
        if (!parentPart) return conn;
        const rel = computeRelativeTransformBetweenParts(
          parentPart,
          position,
          targetPart.rotation
        );
        return {
          ...conn,
          relativePosition: rel.relativePosition,
        };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, nextConnections),
        connections: nextConnections,
      };
    }),

  updatePartSize: (id, size) =>
    set((state) => {
      const updatedParts = state.parts.map((part) => {
        if (part.id !== id) return part;
        const synced = syncGeometryFromSize(part, size);
        return { ...part, ...synced };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
      };
    }),

  updatePartRotation: (id, rotation) =>
    set((state) => {
      const targetPart = state.parts.find((p) => p.id === id);
      if (!targetPart) return state;

      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, rotation } : part
      );

      const nextConnections = state.connections.map((conn) => {
        const childId = conn.childId ?? conn.targetId;
        if (childId !== id || conn.type === "Motor-Wheel") return conn;
        const parentPart = updatedParts.find(
          (p) => p.id === (conn.parentId ?? conn.sourceId)
        );
        if (!parentPart) return conn;
        const rel = computeRelativeTransformBetweenParts(
          parentPart,
          targetPart.position,
          rotation
        );
        return {
          ...conn,
          relativeRotation: rel.relativeRotation,
        };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, nextConnections),
        connections: nextConnections,
      };
    }),

  updatePartGeometry: (id, geometry) =>
    set((state) => {
      const updatedParts = state.parts.map((part) => {
        if (part.id !== id) return part;
        const synced = syncSizeFromGeometry(part, geometry);
        return { ...part, ...synced };
      });

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
      };
    }),

  updatePartMass: (id, massKg) =>
    set((state) => {
      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, mass: massKg, massKg } : part
      );

      return {
        parts: updatedParts,
      };
    }),

  addPart: (type) => {
    if (type === "Battery" || type === "Controller") return;
    const matchingCount = get().parts.filter(
      (part) => part.type === type
    ).length;

    const findPlacement = (): [number, number, number] => {
      const existing = get().parts;
      const robotCenter = existing.find((part) => part.id === "chassis")?.position ??
        [0, 0.65, 0];
      const ringCandidates: [number, number, number][] = [];

      for (let ring = 0; ring <= 4; ring += 1) {
        for (let xIndex = -ring; xIndex <= ring; xIndex += 1) {
          for (let zIndex = -ring; zIndex <= ring; zIndex += 1) {
            if (ring > 0 && Math.abs(xIndex) !== ring && Math.abs(zIndex) !== ring) {
              continue;
            }

            ringCandidates.push([
              robotCenter[0] + xIndex * 1.35,
              robotCenter[1] + 0.75,
              robotCenter[2] + zIndex * 1.35,
            ]);
          }
        }
      }

      const typeOffset = matchingCount % 4;
      const candidates = [
        ...ringCandidates.slice(typeOffset),
        ...ringCandidates.slice(0, typeOffset),
      ];

      return candidates.find((candidate) =>
        existing.every((part) => {
          const dx = candidate[0] - part.position[0];
          const dy = candidate[1] - part.position[1];
          const dz = candidate[2] - part.position[2];
          return Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.9;
        })
      ) ?? [
        robotCenter[0] + ((matchingCount % 5) - 2) * 1.35,
        robotCenter[1] + 0.75,
        robotCenter[2] + 3.3,
      ];
    };

    const size: [number, number, number] =
      type === "Armor Plate"
        ? [1.5, 0.12, 1]
        : type === "Front Bumper"
          ? [1.8, 0.22, 0.12]
          : type === "Wheel"
            ? [0.38, 0.28, 0.38]
            : type === "Motor"
              ? [0.35, 0.35, 0.6]
              : [0.5, 0.5, 0.5];

    const mass =
      type === "Armor Plate"
        ? 0.4
        : type === "Front Bumper"
          ? 0.3
          : type === "Wheel"
            ? 0.5
            : type === "Motor"
              ? 0.8
              : 0.5;

    const geometry: ComponentGeometry =
      type === "Wheel"
        ? {
            shape: "cylinder",
            diameter: size[0],
            axialWidth: size[1],
            axis: "x",
          }
        : {
            shape: "box",
            length: size[0],
            height: size[1],
            width: size[2],
          };

    const newPart: RobotPart = {
      id: crypto.randomUUID(),
      name: `${type} ${matchingCount + 1}`,
      type,
      position: findPlacement(),
      rotation: [0, 0, 0],
      size,
      color:
        type === "Armor Plate"
          ? "#64748b"
          : type === "Front Bumper"
            ? "#f59e0b"
            : type === "Wheel"
              ? "#171b22"
              : type === "Motor"
                ? "#ef4444"
                : "#38bdf8",
      mass,
      geometry,
      massKg: mass,
    };

    set((state) => ({
      parts: [...state.parts, newPart],
      selectedId: newPart.id,
    }));
  },

  assignWheel: (motorId) =>
    set((state) => {
      const motor = state.parts.find((part) => part.id === motorId);
      const definition = wheelCatalogue.find(
        (wheel) => wheel.id === state.selectedWheelCatalogueId
      );
      if (
        !state.foundation ||
        !motor ||
        motor.type !== "Motor" ||
        !resolveMotorMechanicalSupport(
          motor,
          state.parts,
          state.connections,
          state.foundation
        ).supported ||
        !motor.motorCatalogueId ||
        !definition ||
        !definition.compatibleMotorIds.includes(motor.motorCatalogueId)
      ) return state;

      const existingConnections = state.connections.filter(
        (connection) =>
          connection.type === "Motor-Wheel" &&
          connection.parentId === motorId
      );
      const existingWheelId = existingConnections[0]?.childId;
      const existingWheel = state.parts.find(
        (part) => part.id === existingWheelId && part.type === "Wheel"
      );
      const wheelId = existingWheel?.id ?? crypto.randomUUID();
      const wheelDimensions = getWheelDimensionsInMeters({
        diameterCm: state.selectedWheelDiameterCm,
        widthCm: state.selectedWheelWidthCm,
      });
      const instanceDefinition = {
        ...definition,
        ...wheelDimensions,
      };
      const mount = getWheelWorldMountTransform(motor, instanceDefinition);
      const connection: RobotConnection = {
        id: existingConnections[0]?.id ?? crypto.randomUUID(),
        sourceId: motorId,
        targetId: wheelId,
        type: "Motor-Wheel",
        parentId: motorId,
        childId: wheelId,
        parentMountPointId: "motor-shaft",
        childMountPointId: "wheel-hub",
        relativePosition: mount.relativePosition,
        relativeRotation: [0, 0, 0],
        wheelOffset: getMotorShaftMountOffset(motor),
      };
      const discardedWheelIds = new Set(
        existingConnections
          .map((item) => item.childId)
          .filter((id) => id !== wheelId)
      );
      const wheelPart: RobotPart = {
        id: wheelId,
        name: definition.name,
        type: "Wheel",
        wheelCatalogueId: definition.id,
        wheelDiameter: wheelDimensions.diameter,
        wheelWidth: wheelDimensions.width,
        position: mount.position,
        rotation: mount.rotation,
        size: [
          wheelDimensions.diameter,
          wheelDimensions.width,
          wheelDimensions.diameter,
        ],
        color: definition.color,
        mass: definition.weight,
        parentAttachmentId: connection.id,
        geometry: {
          shape: "cylinder",
          diameter: wheelDimensions.diameter,
          axialWidth: wheelDimensions.width,
          axis: "x",
        },
        massKg: definition.massKg,
        engineeringSpec: definition.engineeringSpec
          ? structuredClone(definition.engineeringSpec)
          : undefined,
      };
      const nextParts = state.parts
        .filter((part) => !discardedWheelIds.has(part.id))
        .filter((part) => part.id !== wheelId);
      const nextConnections = state.connections.filter(
        (item) =>
          !(
            item.type === "Motor-Wheel" &&
            (item.parentId === motorId || discardedWheelIds.has(item.childId))
          )
      );
      nextConnections.push(connection);
      const synchronizedParts = syncAssemblyTransforms(
        [...nextParts, wheelPart],
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          synchronizedParts,
          nextConnections,
          state.foundation
        ),
        hiddenPartIds: retainVisibilityForParts(
          state.hiddenPartIds,
          [...nextParts, wheelPart]
        ),
        selectedWheelMotorId: motorId,
        selectedId: motorId,
      };
    }),

  removeWheel: (motorId) =>
    set((state) => {
      const wheelIds = new Set(
        state.connections
          .filter(
            (connection) =>
              connection.type === "Motor-Wheel" &&
              connection.parentId === motorId
          )
          .map((connection) => connection.childId)
      );
      if (wheelIds.size === 0) return state;
      const nextParts = state.parts.filter((part) => !wheelIds.has(part.id));
      const nextConnections = state.connections.filter(
        (connection) =>
          !wheelIds.has(connection.childId) &&
          !wheelIds.has(connection.parentId)
      );

      return {
        parts: nextParts,
        connections: nextConnections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          nextParts,
          nextConnections,
          state.foundation
        ),
        hiddenPartIds: retainVisibilityForParts(
          state.hiddenPartIds,
          nextParts
        ),
        selectedId: wheelIds.has(state.selectedId ?? "")
          ? motorId
          : state.selectedId,
      };
    }),

  connectParts: (sourceId, targetId) => {
    set((state) => {
      if (sourceId === targetId) return state;

      const source = state.parts.find((part) => part.id === sourceId);
      const target = state.parts.find((part) => part.id === targetId);

      if (!source || !target) return state;

      if (source.type !== "Motor" || target.type !== "Wheel") {
        return state;
      }

      const alreadyConnected = state.connections.some(
        (connection) =>
          (connection.parentId ?? connection.sourceId) === sourceId &&
          (connection.childId ?? connection.targetId) === targetId
      );

      if (alreadyConnected) return state;
      if (hasCircularAttachment(state.connections, sourceId, targetId)) {
        return state;
      }

      const relativePosition: [number, number, number] = [
        target.position[0] - source.position[0],
        target.position[1] - source.position[1],
        target.position[2] - source.position[2],
      ];
      const relativeRotation: [number, number, number] = [
        target.rotation[0] - source.rotation[0],
        target.rotation[1] - source.rotation[1],
        target.rotation[2] - source.rotation[2],
      ];
      const connections = [
        ...state.connections,
        {
          id: crypto.randomUUID(),
          sourceId,
          targetId,
          parentId: sourceId,
          childId: targetId,
          parentMountPointId: "motor-shaft",
          childMountPointId: "wheel-hub",
          relativePosition,
          relativeRotation,
          type: "Motor-Wheel" as const,
        },
      ];

      return {
        connections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          state.parts,
          connections,
          state.foundation
        ),
      };
    });
  },

  disconnectParts: (connectionId) => {
    set((state) => {
      const disconnected = state.connections.find(
        (connection) => connection.id === connectionId
      );
      if (!disconnected) return state;

      const childId = disconnected.childId ?? disconnected.targetId;
      const connections = state.connections.filter(
        (connection) => connection.id !== connectionId
      );
      const child = state.parts.find((part) => part.id === childId);
      if (!child) {
        return {
          connections,
          drivetrain: retainValidDrivetrainAssignments(
            state.drivetrain,
            state.parts,
            connections,
            state.foundation
          ),
        };
      }

      const validAttachments = connections.filter((connection) => {
        const connectionChildId = connection.childId ?? connection.targetId;
        const parentId = connection.parentId ?? connection.sourceId;
        return (
          connectionChildId === childId &&
          state.parts.some((part) => part.id === parentId)
        );
      });
      const attachment =
        validAttachments.find(
          (connection) => connection.id === child.parentAttachmentId
        ) ?? validAttachments[0];
      const parts = state.parts.map((part) =>
        part.id === childId
          ? { ...part, parentAttachmentId: attachment?.id }
          : part
      );

      return {
        connections,
        parts,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          state.foundation
        ),
      };
    });
  },

  mountWheelToMotor: (motorId, wheelId) => {
    set((state) => {
      const motor = state.parts.find((part) => part.id === motorId);
      const wheel = state.parts.find((part) => part.id === wheelId);
      if (!motor || !wheel || motor.type !== "Motor" || wheel.type !== "Wheel") {
        return state;
      }
      if (hasCircularAttachment(state.connections, motorId, wheelId)) {
        return state;
      }

      const wheelOffset = getMotorShaftMountOffset(motor);
      const mountPosition = getMotorShaftMountPosition(motor, wheelOffset);

      const relativePosition = wheelOffset;
      const relativeRotation: [number, number, number] = [0, 0, 0];

      const remainingConnections = state.connections.filter(
        (connection) =>
          (connection.childId ?? connection.targetId) !== wheelId
      );

      const connection: RobotConnection = {
        id: crypto.randomUUID(),
        sourceId: motorId,
        targetId: wheelId,
        parentId: motorId,
        childId: wheelId,
        parentMountPointId: "motor-shaft",
        childMountPointId: "wheel-hub",
        relativePosition,
        relativeRotation,
        type: "Motor-Wheel",
        wheelOffset,
      };

      const mountedParts = state.parts.map((part) =>
        part.id === wheelId
          ? {
              ...part,
              position: mountPosition,
              rotation: [...motor.rotation] as [number, number, number],
              parentAttachmentId: connection.id,
            }
          : part
      );
      const nextConnections = [...remainingConnections, connection];
      const synchronizedParts = syncAssemblyTransforms(
        mountedParts,
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          synchronizedParts,
          nextConnections,
          state.foundation
        ),
      };
    });
  },

  unmountPart: (childId) => {
    set((state) => {
      const child = state.parts.find((part) => part.id === childId);
      if (!child) return state;
      const parts = state.parts.map((part) =>
        part.id === childId
          ? { ...part, parentAttachmentId: undefined }
          : part
      );
      const connections = state.connections.filter(
        (connection) =>
          (connection.childId ?? connection.targetId) !== childId
      );

      return {
        parts,
        connections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          parts,
          connections,
          state.foundation
        ),
      };
    });
  },

  selectStructuralCatalogueItem: (structuralId) => {
    if (!structuralCatalogue.some((item) => item.id === structuralId)) return;
    set({ selectedStructuralCatalogueId: structuralId });
  },

  addStructuralPart: (structuralId, options) => {
    const definition = structuralCatalogue.find(
      (item) => item.id === structuralId
    );
    if (!definition) return null;

    const newId = crypto.randomUUID();
    set((state) => {
      const existingSameCount = state.parts.filter(
        (p) => p.structuralCatalogueId === structuralId
      ).length;
      const parentPart = options?.parentId
        ? state.parts.find((p) => p.id === options.parentId)
        : state.parts.find((p) => p.id === "foundation-chassis");

      let position: [number, number, number] = [0, 0.5, 0];
      let rotation: [number, number, number] = [0, 0, 0];
      const nextConnections = [...state.connections];
      let attachmentId: string | undefined;

      const draftPart = createStructuralPartFromDefinition(
        definition,
        newId,
        position,
        rotation
      );
      draftPart.name =
        existingSameCount > 0
          ? `${definition.name} ${existingSameCount + 1}`
          : definition.name;

      if (parentPart) {
        const parentInterfaces = resolvePartMountingInterfaces(
          parentPart,
          state.foundation
        );
        const childInterfaces = resolvePartMountingInterfaces(
          draftPart,
          state.foundation
        );
        const fallbackParentInterfaceId =
          definition.category === "bumper"
            ? "foundation-front-face"
            : definition.category === "rail"
              ? "foundation-left-rail"
              : "foundation-top-center";
        const parentIface =
          parentInterfaces.find((i) => i.id === options?.parentInterfaceId) ??
          parentInterfaces.find((i) => i.id === fallbackParentInterfaceId) ??
          parentInterfaces[0];
        const childIface =
          childInterfaces.find((i) => i.id === options?.childInterfaceId) ??
          childInterfaces[0];

        if (parentIface && childIface) {
          const attached = computeAttachedChildTransform(
            parentPart,
            parentIface,
            draftPart,
            childIface
          );
          position = attached.worldPosition;
          rotation = attached.worldRotation;
          attachmentId = crypto.randomUUID();
          nextConnections.push({
            id: attachmentId,
            sourceId: parentPart.id,
            targetId: newId,
            parentId: parentPart.id,
            childId: newId,
            parentMountPointId: parentIface.id,
            childMountPointId: childIface.id,
            relativePosition: attached.relativePosition,
            relativeRotation: attached.relativeRotation,
            type: "Mechanical",
          });
        }
      } else {
        const topY = definition.dimensions.height * 0.5 + 0.1;
        position = [(existingSameCount % 4) * 0.25, topY, 0];
      }

      const finalPart: RobotPart = {
        ...draftPart,
        position,
        rotation,
        parentAttachmentId: attachmentId,
      };
      const synchronizedParts = syncAssemblyTransforms(
        [...state.parts, finalPart],
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        selectedId: newId,
        selectedStructuralCatalogueId: structuralId,
      };
    });

    return newId;
  },

  replaceStructuralPart: (partId, structuralId) => {
    const definition = structuralCatalogue.find(
      (item) => item.id === structuralId
    );
    if (!definition) return;

    set((state) => {
      const existing = state.parts.find((p) => p.id === partId);
      if (!existing) return state;

      const candidateReplacement: RobotPart = {
        ...existing,
        name: definition.name,
        type: definition.componentType,
        structuralCatalogueId: definition.id,
        structuralCategory: definition.category,
        structuralVisualShape: definition.visualShape,
        size: [
          definition.dimensions.length,
          definition.dimensions.height,
          definition.dimensions.width,
        ] as [number, number, number],
        color: definition.color,
        mass: definition.massKg,
        massKg: definition.massKg,
        geometry: structuredClone(definition.geometry),
        engineeringSpec: structuredClone(definition.engineeringSpec),
      };

      const replacementImpact = evaluateComponentReplacementImpact({
        originalPart: existing,
        candidateReplacement,
        parts: state.parts,
        connections: state.connections,
        foundation: state.foundation,
      });

      const updatedParts = state.parts.map((part) =>
        part.id === partId ? candidateReplacement : part
      );

      // Re-align child connections whose interfaces exist cleanly on the replacement part
      const replacementInterfaces = resolvePartMountingInterfaces(
        candidateReplacement,
        state.foundation
      );
      const nextConnections = state.connections.map((conn) => {
        const parentId = conn.parentId ?? conn.sourceId;
        const childId = conn.childId ?? conn.targetId;
        if (parentId !== partId || conn.type !== "Mechanical") return conn;
        const childPart = updatedParts.find((p) => p.id === childId);
        if (!childPart) return conn;

        const childInterfaces = resolvePartMountingInterfaces(
          childPart,
          state.foundation
        );
        const matchedParentIface =
          replacementInterfaces.find((i) => i.id === conn.parentMountPointId) ??
          replacementInterfaces[0];
        const matchedChildIface =
          childInterfaces.find((i) => i.id === conn.childMountPointId) ??
          childInterfaces[0];

        if (!matchedParentIface || !matchedChildIface) return conn;

        const childImpact = replacementImpact.affectedChildren.find(
          (item) => item.childId === childId
        );
        // Re-align relative offset cleanly for valid/compatible or warning attachments
        if (childImpact?.evaluation.status !== "incompatible") {
          const attached = computeAttachedChildTransform(
            candidateReplacement,
            matchedParentIface,
            childPart,
            matchedChildIface
          );
          return {
            ...conn,
            parentMountPointId: matchedParentIface.id,
            childMountPointId: matchedChildIface.id,
            relativePosition: attached.relativePosition,
            relativeRotation:
              childPart.type === "Motor"
                ? conn.relativeRotation
                : attached.relativeRotation,
          };
        }
        return {
          ...conn,
          parentMountPointId: matchedParentIface.id,
        };
      });

      let warningMessage: string | null = null;
      if (replacementImpact.brokenCount > 0) {
        const brokenNames = replacementImpact.affectedChildren
          .filter((c) => c.evaluation.status === "incompatible")
          .map((c) => c.childName)
          .join(", ");
        warningMessage = `Replacing ${existing.name} with ${definition.name} breaks mount compatibility for: ${brokenNames}. Inspect attachment diagnostics.`;
      } else if (replacementImpact.warningCount > 0) {
        warningMessage = `Replaced ${existing.name} with ${definition.name}; ${replacementImpact.warningCount} child attachment(s) carry sizing/fit advisories.`;
      }

      const synchronizedParts = syncAssemblyTransforms(
        updatedParts,
        nextConnections
      );

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          synchronizedParts,
          nextConnections,
          state.foundation
        ),
        selectedStructuralCatalogueId: structuralId,
        lastReplacementWarning: warningMessage,
      };
    });
  },

  duplicatePart: (partId) => {
    const source = get().parts.find((p) => p.id === partId);
    if (!source || source.id.startsWith("foundation-")) return null;
    if (source.type === "Battery" || source.type === "Controller") return null;
    if (source.type === "Motor" || source.type === "Wheel") return null;

    const newId = crypto.randomUUID();
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;

      const duplicate: RobotPart = {
        ...structuredClone(target),
        id: newId,
        name: `${target.name} Copy`,
        position: [
          target.position[0] + 0.18,
          target.position[1],
          target.position[2] + 0.18,
        ],
        parentAttachmentId: undefined,
      };

      return {
        parts: [...state.parts, duplicate],
        selectedId: newId,
      };
    });

    return newId;
  },

  attachPart: (childId, parentId, parentInterfaceId, childInterfaceId) => {
    if (!childId || !parentId || childId === parentId) return false;
    if (childId === "foundation-chassis") return false;

    let attached = false;
    set((state) => {
      const childPart = state.parts.find((p) => p.id === childId);
      const parentPart = state.parts.find((p) => p.id === parentId);
      if (!childPart || !parentPart) return state;

      const filteredConnections = state.connections.filter(
        (conn) => (conn.childId ?? conn.targetId) !== childId
      );
      if (hasAttachmentCycle(filteredConnections, parentId, childId)) {
        return state;
      }

      const parentInterfaces = resolvePartMountingInterfaces(
        parentPart,
        state.foundation
      );
      const childInterfaces = resolvePartMountingInterfaces(
        childPart,
        state.foundation
      );
      const parentIface =
        parentInterfaces.find((i) => i.id === parentInterfaceId) ??
        parentInterfaces[0];
      const childIface =
        childInterfaces.find((i) => i.id === childInterfaceId) ??
        childInterfaces[0];

      const isMotorWheel =
        parentPart.type === "Motor" && childPart.type === "Wheel";
      const connectionType: RobotConnection["type"] = isMotorWheel
        ? "Motor-Wheel"
        : "Mechanical";

      const attachmentId = crypto.randomUUID();
      let relPos: [number, number, number];
      let relRot: [number, number, number];

      if (parentIface && childIface) {
        const result = computeAttachedChildTransform(
          parentPart,
          parentIface,
          childPart,
          childIface
        );
        relPos = result.relativePosition;
        relRot = result.relativeRotation;
      } else {
        const rel = computeRelativeTransformBetweenParts(
          parentPart,
          childPart.position,
          childPart.rotation
        );
        relPos = [...rel.relativePosition];
        relRot = [...rel.relativeRotation];
      }

      const newConnection: RobotConnection = {
        id: attachmentId,
        sourceId: parentId,
        targetId: childId,
        parentId,
        childId,
        parentMountPointId: parentIface?.id ?? "generic-mount",
        childMountPointId: childIface?.id ?? "generic-mount",
        relativePosition: relPos,
        relativeRotation: relRot,
        type: connectionType,
      };

      const nextConnections = [...filteredConnections, newConnection];
      const updatedParts = state.parts.map((part) =>
        part.id === childId
          ? { ...part, parentAttachmentId: attachmentId }
          : part
      );
      const synchronizedParts = syncAssemblyTransforms(
        updatedParts,
        nextConnections
      );
      attached = true;

      return {
        parts: synchronizedParts,
        connections: nextConnections,
        drivetrain: retainValidDrivetrainAssignments(
          state.drivetrain,
          synchronizedParts,
          nextConnections,
          state.foundation
        ),
      };
    });

    return attached;
  },

  detachPart: (childId) => {
    get().unmountPart(childId);
  },

  assignPartElectricalSpec: (partId, spec) => {
    set((state) => {
      if (!state.parts.some((p) => p.id === partId)) return state;
      return {
        parts: state.parts.map((part) =>
          part.id === partId
            ? {
                ...part,
                electricalSpec: structuredClone({ ...spec, partId }),
              }
            : part
        ),
      };
    });
  },

  addElectricalConnection: (conn) => {
    const newId = conn.id ?? crypto.randomUUID();
    let created = false;
    set((state) => {
      const srcExists = state.parts.some((p) => p.id === conn.sourcePartId);
      const dstExists = state.parts.some((p) => p.id === conn.targetPartId);
      if (!srcExists || !dstExists) return state;

      const nextConnection: ElectricalConnection = {
        ...structuredClone(conn),
        id: newId,
      };
      created = true;
      return {
        electricalConnections: [...state.electricalConnections, nextConnection],
      };
    });
    return created ? newId : null;
  },

  updateElectricalConnection: (connectionId, patch) => {
    set((state) => {
      if (!state.electricalConnections.some((c) => c.id === connectionId)) {
        return state;
      }
      return {
        electricalConnections: state.electricalConnections.map((conn) =>
          conn.id === connectionId ? { ...conn, ...patch, id: conn.id } : conn
        ),
      };
    });
  },

  removeElectricalConnection: (connectionId) => {
    set((state) => {
      const next = state.electricalConnections.filter((c) => c.id !== connectionId);
      if (next.length === state.electricalConnections.length) return state;
      return {
        electricalConnections: next,
        selectedElectricalConnectionId:
          state.selectedElectricalConnectionId === connectionId
            ? null
            : state.selectedElectricalConnectionId,
      };
    });
  },

  assignConnectorToInterface: (partId, interfaceId, connector) => {
    set((state) => {
      const part = state.parts.find((p) => p.id === partId);
      if (!part) return state;
      const resolved = resolvePartElectricalSpec(part);
      if (!resolved) return state;

      const updatedConnectors = resolved.connectors.some(
        (c) => c.connectorId === connector.connectorId
      )
        ? resolved.connectors.map((c) =>
            c.connectorId === connector.connectorId ? connector : c
          )
        : [...resolved.connectors, connector];

      const updatedInterfaces = resolved.interfaces.map((iface) =>
        iface.interfaceId === interfaceId
          ? { ...iface, connectorId: connector.connectorId }
          : iface
      );

      const nextSpec: ElectricalComponentSpec = {
        ...resolved,
        interfaces: updatedInterfaces,
        connectors: updatedConnectors,
      };

      return {
        parts: state.parts.map((p) =>
          p.id === partId ? { ...p, electricalSpec: nextSpec } : p
        ),
      };
    });
  },

  assignPinToElectricalConnection: (connectionId, endpoint, pinId) => {
    set((state) => {
      const target = state.electricalConnections.find((c) => c.id === connectionId);
      if (!target) return state;
      return {
        electricalConnections: state.electricalConnections.map((conn) =>
          conn.id === connectionId
            ? endpoint === "source"
              ? { ...conn, sourcePinId: pinId }
              : { ...conn, targetPinId: pinId }
            : conn
        ),
      };
    });
  },

  updatePartElectricalProperties: (partId, patch) => {
    set((state) => {
      const target = state.parts.find((p) => p.id === partId);
      if (!target) return state;
      const resolved = resolvePartElectricalSpec(target);
      if (!resolved) return state;

      const clonedPatch = structuredClone(patch);
      const nextSpec: ElectricalComponentSpec = {
        ...resolved,
        ...clonedPatch,
        partId,
        interfaces: clonedPatch.interfaces ?? resolved.interfaces,
        pins: clonedPatch.pins ?? resolved.pins,
        connectors: clonedPatch.connectors ?? resolved.connectors,
        assumptions: clonedPatch.assumptions ?? resolved.assumptions,
        unknownFields: clonedPatch.unknownFields ?? resolved.unknownFields,
      };

      return {
        parts: state.parts.map((part) =>
          part.id === partId ? { ...part, electricalSpec: nextSpec } : part
        ),
      };
    });
  },

  addElectricalComponent: ({
    id,
    name,
    partType,
    electricalSpec,
    position,
    size,
    color,
    massKg,
  }) => {
    const newId = id ?? crypto.randomUUID();
    const pos: [number, number, number] = position ?? [0, 0.08, 0];
    const dims: [number, number, number] = size ?? [0.06, 0.02, 0.04];
    const mass = massKg ?? 0.04;
    const resolvedType: ComponentType =
      partType ??
      (electricalSpec.componentType === "battery"
        ? "Battery"
        : electricalSpec.componentType === "motor"
          ? "Motor"
          : electricalSpec.componentType === "controller"
            ? "Controller"
            : "Structural Block");

    set((state) => {
      const nextPart: RobotPart = {
        id: newId,
        name,
        type: resolvedType,
        position: [...pos] as [number, number, number],
        rotation: [0, 0, 0],
        size: [...dims] as [number, number, number],
        color: color ?? "#3b82f6",
        mass,
        massKg: mass,
        geometry: {
          shape: "box",
          length: dims[0],
          height: dims[1],
          width: dims[2],
        },
        electricalSpec: structuredClone({
          ...electricalSpec,
          partId: newId,
        }),
      };

      const hasFoundationPart = state.parts.some(
        (part) => part.id === "foundation-chassis"
      );
      const nextConnections = hasFoundationPart
        ? [
            ...state.connections,
            {
              id: `conn-${newId}`,
              sourceId: "foundation-chassis",
              targetId: newId,
              type: "Mechanical" as const,
              parentId: "foundation-chassis",
              childId: newId,
              parentMountPointId: "foundation-top",
              childMountPointId: "component-base",
              relativePosition: [...pos] as [number, number, number],
              relativeRotation: [0, 0, 0] as [number, number, number],
            },
          ]
        : state.connections;

      return {
        parts: [...state.parts, nextPart],
        connections: nextConnections,
        selectedId: newId,
      };
    });

    return newId;
  },

  removeElectricalComponent: (partId) => {
    get().deletePartById(partId);
  },

  validateElectricalState: () => {
    const state = get();
    return validateElectricalAssembly({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
    });
  },

  installElectricalCatalogueItem: (catalogueId, options) => {
    const item = getElectricalCatalogueItem(catalogueId);
    if (!item) return null;

    const newId = options?.id ?? crypto.randomUUID();
    const dims: [number, number, number] = [
      item.dimensions.length,
      item.dimensions.height,
      item.dimensions.width,
    ];

    set((state) => {
      const foundationPart = state.parts.find((p) => p.id === "foundation-chassis");
      const preferredParentId =
        options?.parentId ?? (foundationPart ? "foundation-chassis" : undefined);
      const parentPart = preferredParentId
        ? state.parts.find((p) => p.id === preferredParentId)
        : undefined;

      const elecIdx = state.parts.filter(
        (p) => Boolean(p.electricalCatalogueId || p.electricalSpec)
      ).length;
      const offsetCol = (elecIdx % 3) - 1;
      const offsetRow = Math.floor(elecIdx / 3) % 3 - 1;
      const deckBaseY = state.foundation
        ? state.foundation.height + dims[1] * 0.5 + 0.01
        : dims[1] * 0.5 + 0.08;
      const defaultPos: [number, number, number] = options?.position ?? [
        Number((offsetCol * 0.085).toFixed(3)),
        Number(deckBaseY.toFixed(4)),
        Number((offsetRow * 0.075).toFixed(3)),
      ];

      let nextPart: RobotPart = {
        id: newId,
        name: options?.name ?? item.name,
        type: item.partType,
        electricalCatalogueId: item.id,
        position: [...defaultPos] as [number, number, number],
        rotation: [0, 0, 0],
        size: dims,
        color: item.color,
        mass: item.massKg,
        massKg: item.massKg,
        geometry: {
          shape: "box",
          length: item.dimensions.length,
          height: item.dimensions.height,
          width: item.dimensions.width,
        },
        electricalSpec: {
          specId: `elec-${newId}`,
          partId: newId,
          ...structuredClone(item.electricalSpecTemplate),
        },
      };

      let nextConnections = state.connections;
      if (parentPart) {
        const parentIfaces = resolvePartMountingInterfaces(
          parentPart,
          state.foundation
        );
        const childIfaces = resolvePartMountingInterfaces(
          nextPart,
          state.foundation
        );
        const chosenParentIface = options?.parentInterfaceId
          ? parentIfaces.find((i) => i.id === options.parentInterfaceId)
          : parentIfaces.find((i) => i.kind === "foundation-deck") ?? parentIfaces[0];
        const chosenChildIface = childIfaces[0];

        let relPos: [number, number, number] = [...defaultPos];
        let relRot: [number, number, number] = [0, 0, 0];

        if (chosenParentIface && !options?.position && parentPart.id !== "foundation-chassis") {
          const attachedTransform = computeAttachedChildTransform(
            parentPart,
            chosenParentIface,
            nextPart,
            chosenChildIface
          );
          nextPart = {
            ...nextPart,
            position: attachedTransform.worldPosition,
            rotation: attachedTransform.worldRotation,
          };
          relPos = attachedTransform.relativePosition;
          relRot = attachedTransform.relativeRotation;
        } else if (parentPart.id !== "foundation-chassis" || options?.position) {
          const rel = computeRelativeTransformBetweenParts(
            parentPart,
            nextPart.position,
            nextPart.rotation
          );
          relPos = rel.relativePosition;
          relRot = rel.relativeRotation;
        }

        const connectionId = `conn-${newId}`;
        nextPart = {
          ...nextPart,
          parentAttachmentId: connectionId,
        };
        nextConnections = [
          ...state.connections,
          {
            id: connectionId,
            sourceId: parentPart.id,
            targetId: newId,
            type: "Mechanical",
            parentId: parentPart.id,
            childId: newId,
            parentMountPointId: chosenParentIface?.id ?? "foundation-top",
            childMountPointId: chosenChildIface?.id ?? "component-base",
            relativePosition: relPos,
            relativeRotation: relRot,
          },
        ];
      }

      const nextParts = [...state.parts, nextPart];
      const synced = syncAssemblyTransforms(nextParts, nextConnections);
      return {
        parts: synced,
        connections: nextConnections,
        selectedId: newId,
      };
    });

    return newId;
  },

  replaceElectricalComponent: (partId, catalogueId) => {
    const item = getElectricalCatalogueItem(catalogueId);
    if (!item) return false;

    let replaced = false;
    set((state) => {
      const existing = state.parts.find((p) => p.id === partId);
      if (!existing) return state;

      replaced = true;
      const newSpec: ElectricalComponentSpec = {
        specId: `elec-${partId}`,
        partId,
        ...structuredClone(item.electricalSpecTemplate),
      };
      const validIfaceIds = new Set(newSpec.interfaces.map((i) => i.interfaceId));
      const validPinIds = new Set(newSpec.pins.map((p) => p.pinId));

      const nextParts = state.parts.map((part) =>
        part.id === partId
          ? {
              ...part,
              name: item.name,
              type: item.partType,
              electricalCatalogueId: item.id,
              batteryCatalogueId: undefined,
              controllerCatalogueId: undefined,
              motorCatalogueId: undefined,
              size: [
                item.dimensions.length,
                item.dimensions.height,
                item.dimensions.width,
              ] as [number, number, number],
              color: item.color,
              mass: item.massKg,
              massKg: item.massKg,
              geometry: {
                shape: "box" as const,
                length: item.dimensions.length,
                height: item.dimensions.height,
                width: item.dimensions.width,
              },
              electricalSpec: newSpec,
            }
          : part
      );

      let prunedCount = 0;
      const nextElectricalConnections: ElectricalConnection[] = [];
      for (const conn of state.electricalConnections) {
        const touchesSource = conn.sourcePartId === partId;
        const touchesTarget = conn.targetPartId === partId;
        if (!touchesSource && !touchesTarget) {
          nextElectricalConnections.push(conn);
          continue;
        }
        if (touchesSource && !validIfaceIds.has(conn.sourceInterfaceId)) {
          prunedCount += 1;
          continue;
        }
        if (touchesTarget && !validIfaceIds.has(conn.targetInterfaceId)) {
          prunedCount += 1;
          continue;
        }
        nextElectricalConnections.push({
          ...conn,
          sourcePinId:
            touchesSource && conn.sourcePinId && !validPinIds.has(conn.sourcePinId)
              ? undefined
              : conn.sourcePinId,
          targetPinId:
            touchesTarget && conn.targetPinId && !validPinIds.has(conn.targetPinId)
              ? undefined
              : conn.targetPinId,
        });
      }

      return {
        parts: nextParts,
        electricalConnections: nextElectricalConnections,
        selectedElectricalConnectionId: nextElectricalConnections.some(
          (c) => c.id === state.selectedElectricalConnectionId
        )
          ? state.selectedElectricalConnectionId
          : null,
        selectedElectricalPinId: null,
        lastReplacementWarning:
          prunedCount > 0
            ? `Replaced ${existing.name} with ${item.name} and removed ${prunedCount} incompatible wire(s).`
            : null,
      };
    });

    return replaced;
  },
};
});