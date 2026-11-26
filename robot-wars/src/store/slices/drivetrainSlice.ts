import type {
  RobotPart,
  RobotConnection,
} from "../../features/robot-builder/types/robot.types";
import {
  getMotorShaftMountOffset,
} from "../../features/robot-builder/logic/mounting";
import { motorCatalogue } from "../../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../features/robot-builder/data/wheelCatalogue";
import { batteryCatalogue } from "../../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../features/robot-builder/data/controllerCatalogue";
import { generateMotorMountZones } from "../../features/robot-builder/logic/mountingZones";
import { getWheelWorldMountTransform } from "../../features/robot-builder/logic/wheelMounting";
import { getBatteryMountingTransform } from "../../features/robot-builder/logic/batteryMounting";
import { getControllerMountingTransform } from "../../features/robot-builder/logic/controllerMounting";
import {
  computeAttachedChildTransform,
  resolvePartMountingInterfaces,
} from "../../features/robot-builder/logic/mountingInterfaces";
import {
  clampWheelDimension,
  getWheelDimensionsInMeters,
  wheelDimensionBounds,
} from "../../features/robot-builder/logic/wheelDimensions";
import { metersToCm } from "../../features/robot-builder/logic/units";
import {
  getDrivetrainSlotCount,
  getPoweredWheelAssemblies,
  resolveMotorMechanicalSupport,
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "../../features/robot-builder/logic/drivetrain";
import {
  sanitizeAssemblyGraph,
} from "../../features/robot-builder/logic/assemblyGraphSanitizer";
import type {
  DrivetrainSliceKeys,
  RobotStore,
  StoreSet,
} from "../robotStore.types";
import {
  createBatteryPart,
  createControllerPart,
  resizeDrivetrainAssignments,
  resolveMotorShaftOutwardRotation,
  syncAssemblyTransforms,
} from "../assemblyStoreHelpers";

export function createDrivetrainSlice(
  set: StoreSet
): Pick<RobotStore, DrivetrainSliceKeys> {
  return {
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

        const sanitized = sanitizeAssemblyGraph({
          parts: syncAssemblyTransforms(parts, connections),
          connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: batteryIdForPart,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return {
          ...sanitized,
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
        return sanitizeAssemblyGraph({
          parts,
          connections: state.connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: batteryIds.has(state.selectedId ?? "")
            ? state.foundationId
            : state.selectedId,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });
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

        const sanitized = sanitizeAssemblyGraph({
          parts: syncAssemblyTransforms(parts, connections),
          connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: controllerPartId,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return {
          ...sanitized,
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
        return sanitizeAssemblyGraph({
          parts,
          connections: state.connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: controllerIds.has(state.selectedId ?? "")
            ? state.foundationId
            : state.selectedId,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });
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

        const { worldRotation, relativeRotation } = resolveMotorShaftOutwardRotation(
          parentPart.rotation ?? [0, 0, 0],
          attached.worldPosition,
          attached.worldRotation,
          attached.relativeRotation
        );

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

        const sanitized = sanitizeAssemblyGraph({
          parts: synchronizedParts,
          connections: nextConnections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: state.selectedId,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return {
          ...sanitized,
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
        const sanitized = sanitizeAssemblyGraph({
          parts: nextParts,
          connections: state.connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId:
            state.selectedId && removedIds.has(state.selectedId)
              ? "foundation-chassis"
              : state.selectedId,
          selectedWheelMotorId:
            state.selectedWheelMotorId &&
            motorIds.has(state.selectedWheelMotorId)
              ? null
              : state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return {
          ...sanitized,
          selectedMountZoneId:
            state.selectedMountZoneId === zoneId
              ? null
              : state.selectedMountZoneId,
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

        const sanitized = sanitizeAssemblyGraph({
          parts: synchronizedParts,
          connections: nextConnections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: motorId,
          selectedWheelMotorId: motorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return sanitized;
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
        return sanitizeAssemblyGraph({
          parts: nextParts,
          connections: state.connections,
          electricalConnections: state.electricalConnections,
          foundation: state.foundation,
          foundationId: state.foundationId,
          drivetrain: state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId: wheelIds.has(state.selectedId ?? "")
            ? motorId
            : state.selectedId,
          selectedWheelMotorId: state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });
      }),
  };
}
