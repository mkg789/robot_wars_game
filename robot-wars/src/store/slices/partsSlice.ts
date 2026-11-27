import type {
  RobotPart,
  ComponentGeometry,
  RobotConnection,
  FoundationConfig,
} from "../../features/robot-builder/types/robot.types";
import {
  getMotorShaftMountOffset,
  getMotorShaftMountPosition,
} from "../../features/robot-builder/logic/mounting";
import { structuralCatalogue } from "../../features/robot-builder/data/structuralCatalogue";
import {
  computeAttachedChildTransform,
  computeRelativeTransformBetweenParts,
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "../../features/robot-builder/logic/mountingInterfaces";
import {
  retainValidDrivetrainAssignments,
} from "../../features/robot-builder/logic/drivetrain";
import { evaluateComponentReplacementImpact } from "../../features/robot-builder/logic/mechanicalCompatibility";
import {
  reanchorMountedChildrenOnParentResize,
  sanitizeAssemblyGraph,
  syncImportedPartFromSize,
} from "../../features/robot-builder/logic/assemblyGraphSanitizer";
import type {
  PartsSliceKeys,
  RobotStore,
  StoreGet,
  StoreRawSet,
  StoreSet,
} from "../robotStore.types";
import {
  captureAssemblySnapshot,
  createEmptyDrivetrain,
  createStructuralPartFromDefinition,
  hasCircularAttachment,
  syncAssemblyTransforms,
  syncGeometryFromSize,
  syncSizeFromGeometry,
  tupleNearlyEqual,
} from "../assemblyStoreHelpers";

function syncImportedFoundationConfig(
  foundation: FoundationConfig | null,
  updatedPart: RobotPart | undefined
): FoundationConfig | null {
  if (
    !foundation ||
    foundation.mode !== "imported" ||
    !foundation.imported ||
    !updatedPart?.meshTransform
  ) {
    return foundation;
  }
  return {
    ...foundation,
    imported: {
      ...foundation.imported,
      transform: structuredClone(updatedPart.meshTransform),
      ...(updatedPart.importedEngineering
        ? { engineering: structuredClone(updatedPart.importedEngineering) }
        : {}),
      ...(updatedPart.collisionConfig
        ? { collision: structuredClone(updatedPart.collisionConfig) }
        : {}),
    },
  };
}

export function createPartsSlice(
  set: StoreSet,
  get: StoreGet,
  trackedRawSet: StoreRawSet
): Pick<RobotStore, PartsSliceKeys> {
  return {
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
              part.id === "foundation-front-cover" ||
              part.foundationMemberRole
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

        const nextParts = state.parts.filter((part) => !removedIds.has(part.id));
        const sanitized = sanitizeAssemblyGraph({
          parts: nextParts,
          connections: state.connections,
          electricalConnections: state.electricalConnections,
          foundation: deletingFoundation
            ? null
            : targetId === "foundation-top-plate" && state.foundation
              ? {
                  ...state.foundation,
                  includeTopPlate: false,
                  confirmed: false,
                }
              : targetId === "foundation-front-cover" && state.foundation
                ? {
                    ...state.foundation,
                    includeFrontCover: false,
                    confirmed: false,
                  }
                : state.foundation,
          foundationId: deletingFoundation ? null : state.foundationId,
          drivetrain: deletingFoundation ? createEmptyDrivetrain() : state.drivetrain,
          hiddenPartIds: state.hiddenPartIds,
          selectedId:
            state.selectedId && removedIds.has(state.selectedId)
              ? null
              : state.selectedId,
          selectedWheelMotorId: deletingFoundation
            ? null
            : state.selectedWheelMotorId === targetId
              ? null
              : state.selectedWheelMotorId,
          selectedElectricalConnectionId: state.selectedElectricalConnectionId,
          selectedElectricalPinId: state.selectedElectricalPinId,
        });

        return {
          ...sanitized,
          ...(deletingFoundation
            ? {
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
            : {}),
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
          const importedSynced =
            size && part.meshAssetId ? syncImportedPartFromSize(part, size) : {};
          const baseMeshTransform =
            importedSynced.meshTransform ?? part.meshTransform;
          return {
            ...part,
            position,
            rotation,
            ...synced,
            ...importedSynced,
            ...(part.meshAssetId && baseMeshTransform
              ? {
                  meshTransform: {
                    ...baseMeshTransform,
                    orientationRotation: [...rotation] as [
                      number,
                      number,
                      number,
                    ],
                  },
                }
              : {}),
          };
        });

        let nextConnections = state.connections.map((conn) => {
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

        if (size) {
          nextConnections = reanchorMountedChildrenOnParentResize({
            prevParts: state.parts,
            nextParts: updatedParts,
            connections: nextConnections,
            resizedPartIds: [id],
            foundation: state.foundation,
          });
        }

        const updatedFoundation =
          id === "foundation-chassis"
            ? syncImportedFoundationConfig(
                state.foundation,
                updatedParts.find((p) => p.id === id)
              )
            : state.foundation;

        return {
          parts: syncAssemblyTransforms(updatedParts, nextConnections),
          connections: nextConnections,
          ...(updatedFoundation !== state.foundation
            ? { foundation: updatedFoundation }
            : {}),
        };
      }),

    previewPartTransform: (id, position, rotation, size) =>
      trackedRawSet((state) => {
        const targetPart = state.parts.find((p) => p.id === id);
        if (!targetPart) return state;

        const activePreview =
          state.activeTransformPreview?.partId === id
            ? state.activeTransformPreview
            : {
                partId: id,
                baselineSnapshot: captureAssemblySnapshot(state),
              };

        const updatedParts = state.parts.map((part) => {
          if (part.id !== id) return part;
          const synced = size ? syncGeometryFromSize(part, size) : {};
          const importedSynced =
            size && part.meshAssetId ? syncImportedPartFromSize(part, size) : {};
          const baseMeshTransform =
            importedSynced.meshTransform ?? part.meshTransform;
          return {
            ...part,
            position,
            rotation,
            ...synced,
            ...importedSynced,
            ...(part.meshAssetId && baseMeshTransform
              ? {
                  meshTransform: {
                    ...baseMeshTransform,
                    orientationRotation: [...rotation] as [
                      number,
                      number,
                      number,
                    ],
                  },
                }
              : {}),
          };
        });

        let nextConnections = state.connections.map((conn) => {
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

        if (size) {
          nextConnections = reanchorMountedChildrenOnParentResize({
            prevParts: state.parts,
            nextParts: updatedParts,
            connections: nextConnections,
            resizedPartIds: [id],
            foundation: state.foundation,
          });
        }

        const nextParts = syncAssemblyTransforms(updatedParts, nextConnections);
        const basePart = activePreview.baselineSnapshot.parts.find(
          (p) => p.id === id
        );
        const previewedPart = nextParts.find((p) => p.id === id);
        const isBackAtBaseline =
          Boolean(basePart && previewedPart) &&
          tupleNearlyEqual(previewedPart!.position, basePart!.position) &&
          tupleNearlyEqual(
            previewedPart!.rotation ?? [0, 0, 0],
            basePart!.rotation ?? [0, 0, 0]
          ) &&
          tupleNearlyEqual(previewedPart!.size, basePart!.size);

        return {
          parts: nextParts,
          connections: nextConnections,
          activeTransformPreview: isBackAtBaseline ? null : activePreview,
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
          const importedSynced = part.meshAssetId
            ? syncImportedPartFromSize(part, size)
            : {};
          return { ...part, ...synced, ...importedSynced };
        });
        const nextConnections = reanchorMountedChildrenOnParentResize({
          prevParts: state.parts,
          nextParts: updatedParts,
          connections: state.connections,
          resizedPartIds: [id],
          foundation: state.foundation,
        });

        return {
          parts: syncAssemblyTransforms(updatedParts, nextConnections),
          connections: nextConnections,
        };
      }),

    updatePartRotation: (id, rotation) =>
      set((state) => {
        const targetPart = state.parts.find((p) => p.id === id);
        if (!targetPart) return state;

        const updatedParts = state.parts.map((part) =>
          part.id === id
            ? {
                ...part,
                rotation,
                ...(part.meshAssetId && part.meshTransform
                  ? {
                      meshTransform: {
                        ...part.meshTransform,
                        orientationRotation: [...rotation] as [
                          number,
                          number,
                          number,
                        ],
                      },
                    }
                  : {}),
              }
            : part
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

        const updatedFoundation =
          id === "foundation-chassis"
            ? syncImportedFoundationConfig(
                state.foundation,
                updatedParts.find((p) => p.id === id)
              )
            : state.foundation;

        return {
          parts: syncAssemblyTransforms(updatedParts, nextConnections),
          connections: nextConnections,
          ...(updatedFoundation !== state.foundation
            ? { foundation: updatedFoundation }
            : {}),
        };
      }),

    updatePartGeometry: (id, geometry) =>
      set((state) => {
        const updatedParts = state.parts.map((part) => {
          if (part.id !== id) return part;
          const synced = syncSizeFromGeometry(part, geometry);
          const importedSynced = part.meshAssetId
            ? syncImportedPartFromSize(part, synced.size)
            : {};
          return { ...part, ...synced, ...importedSynced };
        });
        const nextConnections = reanchorMountedChildrenOnParentResize({
          prevParts: state.parts,
          nextParts: updatedParts,
          connections: state.connections,
          resizedPartIds: [id],
          foundation: state.foundation,
        });

        return {
          parts: syncAssemblyTransforms(updatedParts, nextConnections),
          connections: nextConnections,
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
          meshAssetId: undefined,
          meshTransform: undefined,
          collisionConfig: undefined,
          importedEngineering: undefined,
          customInertiaKgM2: undefined,
          electricalCatalogueId: undefined,
          electrical: undefined,
          electricalSpec: undefined,
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

        const sanitized = sanitizeAssemblyGraph({
          parts: updatedParts,
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
          parts: syncAssemblyTransforms(sanitized.parts, sanitized.connections),
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
  };
}
