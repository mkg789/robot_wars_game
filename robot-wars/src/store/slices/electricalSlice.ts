import type {
  RobotPart,
  ComponentType,
} from "../../features/robot-builder/types/robot.types";
import {
  computeAttachedChildTransform,
  computeRelativeTransformBetweenParts,
  resolvePartMountingInterfaces,
} from "../../features/robot-builder/logic/mountingInterfaces";
import type {
  ElectricalComponentSpec,
  ElectricalConnection,
} from "../../features/electrical/types/electrical.types";
import { getElectricalCatalogueItem } from "../../features/electrical/data/electricalCatalogue";
import { resolvePartElectricalSpec } from "../../features/electrical/logic/electricalComponentAdapters";
import { validateElectricalAssembly } from "../../features/electrical/logic/electricalValidation";
import type {
  ElectricalSliceKeys,
  RobotStore,
  StoreGet,
  StoreSet,
} from "../robotStore.types";
import { syncAssemblyTransforms } from "../assemblyStoreHelpers";

export function createElectricalSlice(
  set: StoreSet,
  get: StoreGet
): Pick<RobotStore, ElectricalSliceKeys> {
  return {
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

    setElectricalSwitchState: (partId, switchClosed) => {
      set((state) => {
        const target = state.parts.find((p) => p.id === partId);
        if (!target) return state;
        return {
          parts: state.parts.map((part) =>
            part.id === partId
              ? {
                  ...part,
                  electricalState: {
                    ...part.electricalState,
                    switchClosed,
                  },
                }
              : part
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
}
