
import { create } from "zustand";
import { Euler, Vector3 } from "three";

import type {
  RobotPart,
  TransformMode,
  ComponentType,
  RobotConnection,
  FoundationConfig,
  FoundationModelId,
  BuildStage,
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
import { generateMotorMountZones } from "../features/robot-builder/logic/mountingZones";
import { getWheelWorldMountTransform } from "../features/robot-builder/logic/wheelMounting";
import { getBatteryMountingTransform } from "../features/robot-builder/logic/batteryMounting";
import { getControllerMountingTransform } from "../features/robot-builder/logic/controllerMounting";
import {
  clampWheelDimension,
  getWheelDimensionsInMeters,
  wheelDimensionBounds,
} from "../features/robot-builder/logic/wheelDimensions";
import { metersToCm } from "../features/robot-builder/logic/units";
import {
  getDrivetrainSlotCount,
  getPoweredWheelAssemblies,
  retainValidDrivetrainAssignments,
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "../features/robot-builder/logic/drivetrain";

type RobotStore = {
  parts: RobotPart[];
  connections: RobotConnection[];
  hiddenPartIds: string[];
  selectedId: string | null;
  transformMode: TransformMode;

  setSelectedId: (id: string | null) => void;
  togglePartVisibility: (id: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  deleteSelected: () => void;

  updatePartTransform: (
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
  setStage: (stage: BuildStage) => void;
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

function createFoundationParts(config: FoundationConfig): RobotPart[] {
  const chassis: RobotPart = {
    id: "foundation-chassis",
    name: foundationModels.find((model) => model.id === config.modelId)?.name ??
      "Robot Foundation",
    type: "Structural Block",
    position: [0, config.height * 0.5, 0],
    rotation: [0, 0, 0],
    size: [config.length, config.height, config.width],
    color: "#475569",
    mass: Math.max(0.5, config.length * config.width * config.height * 3),
  };

  const parts: RobotPart[] = [chassis];

  if (config.includeTopPlate) {
    parts.push({
      id: "foundation-top-plate",
      name: "Top Structural Plate",
      type: "Armor Plate",
      position: [0, config.height + 0.09, 0],
      rotation: [0, 0, 0],
      size: [config.length * 0.82, 0.12, config.width * 0.78],
      color: "#64748b",
      mass: config.length * config.width * 0.18,
    });
  }

  if (config.includeFrontCover) {
    parts.push({
      id: "foundation-front-cover",
      name: "Front Protective Cover",
      type: "Front Bumper",
      position: [config.length * 0.5 + 0.06, config.height * 0.5, 0],
      rotation: [0, 0, 0],
      size: [0.12, config.height * 0.55, config.width * 0.9],
      color: "#f59e0b",
      mass: config.width * config.height * 0.12,
    });
  }

  return parts;
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
  };
}

function preserveMountedComponents(
  foundationParts: RobotPart[],
  existingParts: RobotPart[],
  foundation: FoundationConfig,
  connections: RobotConnection[]
): RobotPart[] {
  const zones = generateMotorMountZones(foundation);
  const motors = existingParts.filter((part) =>
    part.type === "Motor" && part.mountingZoneId
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

  const preservedMotorIds = new Set(positionedMotors.map((motor) => motor.id));
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
  const positionedBattery = battery?.definition && battery.connection
    ? createBatteryPart(
        battery.definition,
        battery.part.id,
        foundation,
        battery.connection.id
      )
    : null;
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
  const positionedController =
    controller?.definition && controller.connection
      ? createControllerPart(
          controller.definition,
          controller.part.id,
          foundation,
          controller.connection.id
        )
      : null;
  const rebuiltParts = [
    ...foundationParts,
    ...positionedMotors,
    ...wheels,
    ...(positionedBattery ? [positionedBattery] : []),
    ...(positionedController ? [positionedController] : []),
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

  return connections.map((connection) => {
    if (connection.type !== "Mechanical") return connection;
    const childId = connection.childId;
    const childPart = parts.find((part) => part.id === childId);
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

export const useRobotStore = create<RobotStore>((set, get) => ({
  parts: [],
  connections: [],
  hiddenPartIds: [],
  selectedId: null,
  transformMode: "select",
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
      return {
        parts,
        connections,
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
      return {
        parts,
        connections,
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
        position: zone.position,
        rotation: zone.rotation,
        size: definition.dimensions,
        color: definition.color,
        mass: definition.weight,
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
                position: zone.position,
                rotation: zone.rotation,
                size: definition.dimensions,
                color: definition.color,
                mass: definition.weight,
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
          const instanceDefinition = attachedWheel
            ? {
                ...wheelDefinition,
                diameter:
                  attachedWheel.wheelDiameter ??
                  attachedWheel.size[0],
                width: attachedWheel.wheelWidth ?? attachedWheel.size[1],
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
    };

    set({
      foundation,
      foundationId: "foundation-chassis",
      parts: createFoundationParts(foundation),
      connections: [],
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
    });
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
      };
      const parts = preserveMountedComponents(
        createFoundationParts(foundation),
        state.parts,
        foundation,
        state.connections
      );
      const connections = remapFoundationConnections(
        state.connections,
        state.parts,
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

      const foundation: FoundationConfig = {
        ...state.foundation,
        length: Math.max(
          0.8,
          Math.min(4, dimensions.length ?? state.foundation.length)
        ),
        width: Math.max(
          0.8,
          Math.min(3, dimensions.width ?? state.foundation.width)
        ),
        height: Math.max(
          0.12,
          Math.min(1, dimensions.height ?? state.foundation.height)
        ),
        confirmed: false,
      };
      const parts = preserveMountedComponents(
        createFoundationParts(foundation),
        state.parts,
        foundation,
        state.connections
      );
      const connections = remapFoundationConnections(
        state.connections,
        state.parts,
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
      const parts = preserveMountedComponents(
        createFoundationParts(foundation),
        state.parts,
        foundation,
        state.connections
      );
      const connections = remapFoundationConnections(
        state.connections,
        state.parts,
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

  deleteSelected: () => {
    const selectedId = get().selectedId;

    if (!selectedId) return;

    set((state) => {
      const selectedPart = state.parts.find((part) => part.id === selectedId);
      const deletingFoundation = selectedId === state.foundationId;
      const removedIds = new Set([selectedId]);
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
      } else if (selectedPart?.type === "Motor") {
        state.connections.forEach((connection) => {
          if (
            connection.type === "Motor-Wheel" &&
            (connection.parentId ?? connection.sourceId) === selectedId
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
              (connection.parentId ?? connection.sourceId) === selectedId &&
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
          : selectedId === "foundation-top-plate" && state.foundation
            ? {
                foundation: {
                  ...state.foundation,
                  includeTopPlate: false,
                  confirmed: false,
                },
              }
            : selectedId === "foundation-front-cover" && state.foundation
              ? {
                  foundation: {
                    ...state.foundation,
                    includeFrontCover: false,
                    confirmed: false,
                  },
                }
              : {}),
        selectedId: null,
        selectedWheelMotorId: deletingFoundation
          ? null
          : state.selectedWheelMotorId === selectedId
            ? null
            : state.selectedWheelMotorId,
      };
    });
  },

  updatePartTransform: (id, position, rotation, size) =>
    set((state) => {
      const updatedParts = state.parts.map((part) =>
        part.id === id
          ? { ...part, position, rotation, ...(size ? { size } : {}) }
          : part
      );

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
      };
    }),

  updatePartPosition: (id, position) =>
    set((state) => {
      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, position } : part
      );

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
      };
    }),

  updatePartSize: (id, size) =>
    set((state) => {
      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, size } : part
      );

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
      };
    }),

  updatePartRotation: (id, rotation) =>
    set((state) => {
      const updatedParts = state.parts.map((part) =>
        part.id === id ? { ...part, rotation } : part
      );

      return {
        parts: syncAssemblyTransforms(updatedParts, state.connections),
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

    const newPart: RobotPart = {
      id: crypto.randomUUID(),
      name: `${type} ${matchingCount + 1}`,
      type,
      position: findPlacement(),
      rotation: [0, 0, 0],

      size:
        type === "Armor Plate"
          ? [1.5, 0.12, 1]
          : type === "Front Bumper"
            ? [1.8, 0.22, 0.12]
            : type === "Wheel"
              ? [0.38, 0.28, 0.38]
              : type === "Motor"
                ? [0.35, 0.35, 0.6]
                : [0.5, 0.5, 0.5],

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

      mass:
        type === "Armor Plate"
          ? 0.4
          : type === "Front Bumper"
            ? 0.3
            : type === "Wheel"
              ? 0.5
              : type === "Motor"
                ? 0.8
                : 0.5,
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
        !motor.mountingZoneId ||
        !generateMotorMountZones(state.foundation).some(
          (zone) => zone.id === motor.mountingZoneId
        ) ||
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
}));