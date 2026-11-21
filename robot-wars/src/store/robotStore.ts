
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
} from "../features/robot-builder/types/robot.types";

import {
  getMotorShaftMountOffset,
  getMotorShaftMountPosition,
} from "../features/robot-builder/logic/mounting";
import { foundationModels } from "../features/robot-builder/data/foundationModels";
import { motorCatalogue } from "../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { generateMotorMountZones } from "../features/robot-builder/logic/mountingZones";
import { getWheelWorldMountTransform } from "../features/robot-builder/logic/wheelMounting";

type RobotStore = {
  parts: RobotPart[];
  connections: RobotConnection[];
  selectedId: string | null;
  transformMode: TransformMode;

  setSelectedId: (id: string | null) => void;
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
  selectedMotorCatalogueId: MotorCatalogueId | null;
  selectedMountZoneId: string | null;
  selectedWheelCatalogueId: WheelCatalogueId | null;
  selectedWheelMotorId: string | null;
  setStage: (stage: BuildStage) => void;
  selectMotorCatalogueItem: (motorId: MotorCatalogueId) => void;
  selectMountZone: (zoneId: string) => void;
  placeMotor: () => void;
  replaceMotor: (zoneId: string) => void;
  removeMotor: (zoneId: string) => void;
  rotateMotor: (zoneId: string, rotationY: number) => void;
  selectWheelCatalogueItem: (wheelId: WheelCatalogueId) => void;
  selectWheelMotor: (motorId: string) => void;
  assignWheel: (motorId: string) => void;
  removeWheel: (motorId: string) => void;
  finishBuild: () => void;
};

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
      position: [0, config.height * 0.5, config.width * 0.5 + 0.06],
      rotation: [0, 0, 0],
      size: [config.length * 0.9, config.height * 0.55, 0.12],
      color: "#f59e0b",
      mass: config.length * config.height * 0.12,
    });
  }

  return parts;
}

function preserveMountedMotors(
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
  const rebuiltParts = [...foundationParts, ...positionedMotors, ...wheels];
  const rebuiltConnections = remapMotorConnections(
    connections,
    rebuiltParts,
    foundation
  );
  return syncAssemblyTransforms(rebuiltParts, rebuiltConnections);
}

function remapMotorConnections(
  connections: RobotConnection[],
  parts: RobotPart[],
  foundation: FoundationConfig
): RobotConnection[] {
  const zones = generateMotorMountZones(foundation);

  return connections.map((connection) => {
    if (connection.type !== "Mechanical") return connection;
    const childMotorId = connection.childId;
    const motor = parts.find((part) => part.id === childMotorId);
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
      childMountPointId: `motor-mount:${childMotorId}`,
    };
  });
}

export const useRobotStore = create<RobotStore>((set, get) => ({
  parts: [],
  connections: [],
  selectedId: null,
  transformMode: "select",
  foundation: null,
  foundationId: null,
  stage: "foundation",
  selectedMotorCatalogueId: null,
  selectedMountZoneId: null,
  selectedWheelCatalogueId: null,
  selectedWheelMotorId: null,

  setSelectedId: (id) => set({ selectedId: id }),

  setTransformMode: (mode) => set({ transformMode: mode }),

  setStage: (stage) => set({ stage }),

  selectMotorCatalogueItem: (motorId) =>
    set({ selectedMotorCatalogueId: motorId }),

  selectMountZone: (zoneId) =>
    set({ selectedMountZoneId: zoneId }),

  selectWheelCatalogueItem: (wheelId) =>
    set({ selectedWheelCatalogueId: wheelId }),

  selectWheelMotor: (motorId) =>
    set({ selectedWheelMotorId: motorId, selectedId: motorId }),

  finishBuild: () => set({ stage: "completed", transformMode: "select" }),

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
          return {
            ...connection,
            relativePosition: getWheelWorldMountTransform(
              parentMotor,
              wheelDefinition
            ).relativePosition,
          };
        });

      return {
        parts: syncAssemblyTransforms(nextParts, nextConnections),
        connections: nextConnections,
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

      return {
        parts: state.parts.filter(
          (part) => !removedIds.has(part.id)
        ),
        connections: state.connections.filter(
          (connection) =>
            !removedIds.has(connection.childId) &&
            !removedIds.has(connection.parentId)
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
      const rotation: [number, number, number] = [0, rotationY, 0];
      const motors = state.parts.filter(
        (part) => part.type === "Motor" && part.mountingZoneId === zoneId
      );
      if (motors.length === 0) return state;
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
      selectedId: "foundation-chassis",
      transformMode: "select",
      stage: "foundation",
      selectedMotorCatalogueId: null,
      selectedMountZoneId: null,
      selectedWheelCatalogueId: null,
      selectedWheelMotorId: null,
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

      return {
        foundation,
        foundationId: "foundation-chassis",
        parts: preserveMountedMotors(
          createFoundationParts(foundation),
          state.parts,
          foundation,
          state.connections
        ),
        connections: remapMotorConnections(
          state.connections,
          state.parts,
          foundation
        ),
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

      return {
        foundation,
        parts: preserveMountedMotors(
          createFoundationParts(foundation),
          state.parts,
          foundation,
          state.connections
        ),
        connections: remapMotorConnections(
          state.connections,
          state.parts,
          foundation
        ),
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

      return {
        foundation,
        parts: preserveMountedMotors(
          createFoundationParts(foundation),
          state.parts,
          foundation,
          state.connections
        ),
        connections: remapMotorConnections(
          state.connections,
          state.parts,
          foundation
        ),
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
        stage: "motors",
      };
    });
  },

  deleteSelected: () => {
    const selectedId = get().selectedId;

    if (!selectedId) return;

    set((state) => {
      const selectedPart = state.parts.find((part) => part.id === selectedId);
      const removedIds = new Set([selectedId]);
      if (selectedPart?.type === "Motor") {
        state.connections.forEach((connection) => {
          if (
            connection.type === "Motor-Wheel" &&
            connection.parentId === selectedId
          ) {
            removedIds.add(connection.childId);
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

      return {
        parts: state.parts
          .filter((part) => !removedIds.has(part.id))
          .map((part) =>
            detachedChildren.has(part.id)
              ? { ...part, parentAttachmentId: undefined }
              : part
          ),
        connections: nextConnections,
        selectedId: null,
        selectedWheelMotorId:
          state.selectedWheelMotorId === selectedId
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
      const mount = getWheelWorldMountTransform(motor, definition);
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
        position: mount.position,
        rotation: mount.rotation,
        size: [definition.diameter / 2, definition.width, definition.diameter / 2],
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

      return {
        parts: syncAssemblyTransforms(
          [...nextParts, wheelPart],
          nextConnections
        ),
        connections: nextConnections,
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

      return {
        parts: state.parts.filter((part) => !wheelIds.has(part.id)),
        connections: state.connections.filter(
          (connection) =>
            !wheelIds.has(connection.childId) &&
            !wheelIds.has(connection.parentId)
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

      return {
        connections: [
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
        ],
      };
    });
  },

  disconnectParts: (connectionId) => {
    set((state) => ({
      connections: state.connections.filter(
        (connection) => connection.id !== connectionId
      ),
    }));
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

      return {
        parts: syncAssemblyTransforms(mountedParts, nextConnections),
        connections: nextConnections,
      };
    });
  },

  unmountPart: (childId) => {
    set((state) => {
      const child = state.parts.find((part) => part.id === childId);
      if (!child) return state;

      return {
        parts: state.parts.map((part) =>
          part.id === childId
            ? { ...part, parentAttachmentId: undefined }
            : part
        ),
        connections: state.connections.filter(
          (connection) =>
            (connection.childId ?? connection.targetId) !== childId
        ),
      };
    });
  },
}));