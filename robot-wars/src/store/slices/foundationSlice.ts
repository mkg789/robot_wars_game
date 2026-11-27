import type {
  RobotPart,
  FoundationConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  ProceduralFoundationConfig,
} from "../../features/robot-builder/types/robot.types";
import { foundationModels } from "../../features/robot-builder/data/foundationModels";
import {
  composeEulerRotations,
  computeAttachedChildTransform,
  computeRelativeEulerRotation,
  resolvePartMountingInterfaces,
} from "../../features/robot-builder/logic/mountingInterfaces";
import {
  createDefaultProceduralFoundationConfig,
} from "../../features/robot-builder/logic/proceduralFoundation";
import {
  computeLocalStlExtents,
  computeTransformedStlExtents,
} from "../../features/robot-builder/logic/stlParser";
import {
  buildCustomCollisionConfig,
  resolveImportedEngineeringProperties,
} from "../../features/robot-builder/logic/customCollision";
import {
  getMeshAssetRecord,
} from "../../features/robot-builder/logic/meshAssetRegistry";
import {
  reanchorMountedChildrenOnParentResize,
} from "../../features/robot-builder/logic/assemblyGraphSanitizer";
import { createStarterPresets } from "../../features/programming/logic/programPersistence";
import { SIMULATION_ARENA_PRESETS } from "../../features/simulation/logic/simulationWorld";
import type {
  FoundationSliceKeys,
  RobotStore,
  StoreGet,
  StoreRawSet,
  StoreSet,
} from "../robotStore.types";
import {
  createEmptyDrivetrain,
  createFoundationParts,
  createFoundationPartsAndConnections,
  finalizeFoundationRebuild,
  syncAssemblyTransforms,
} from "../assemblyStoreHelpers";

export function createFoundationSlice(
  set: StoreSet,
  get: StoreGet,
  trackedRawSet: StoreRawSet
): Pick<RobotStore, FoundationSliceKeys> {
  void get;
  return {
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

      trackedRawSet((state) => ({
        projectName: "Untitled Robot",
        projectCreatedAtIso: new Date().toISOString(),
        selectedArenaId: SIMULATION_ARENA_PRESETS[0].id,
        visualProgram: createStarterPresets()[0],
        projectRevision: state.projectRevision + 1,
        lastProjectLoadWarnings: [],
        lastReplacementWarning: null,
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
        selectedElectricalConnectionId: null,
        selectedElectricalPinId: null,
        historyPast: [],
        historyFuture: [],
        activeTransformPreview: null,
      }));
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
        return finalizeFoundationRebuild(
          state,
          foundation,
          createFoundationParts(foundation),
          []
        );
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
        return finalizeFoundationRebuild(
          state,
          foundation,
          builtFoundation.parts,
          builtFoundation.connections
        );
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
        return finalizeFoundationRebuild(
          state,
          foundation,
          builtFoundation.parts,
          builtFoundation.connections
        );
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
        return finalizeFoundationRebuild(
          state,
          foundation,
          builtFoundation.parts,
          builtFoundation.connections
        );
      });
    },

    resetProceduralFoundation: (architecture = "perimeter-frame") => {
      const defaults = createDefaultProceduralFoundationConfig(architecture);
      get().configureProceduralFoundation(defaults);
    },

    importFoundationStl: (params) => {
      set((state) => {
        const scaleTuple =
          params.transform.scaleMode === "uniform"
            ? ([
                params.transform.uniformScale,
                params.transform.uniformScale,
                params.transform.uniformScale,
              ] as const)
            : params.transform.nonUniformScale;
        const localExtents = computeLocalStlExtents({
          rawDimensions: params.inspection.rawDimensions,
          unit: params.transform.unit,
          scale: scaleTuple,
        });
        const extents = computeTransformedStlExtents({
          rawDimensions: params.inspection.rawDimensions,
          unit: params.transform.unit,
          scale: scaleTuple,
          orientationRotation: params.transform.orientationRotation,
        });
        const length = Math.max(0.05, extents[0]);
        const height = Math.max(0.02, extents[1]);
        const width = Math.max(0.05, extents[2]);

        const rebuiltCollision = buildCustomCollisionConfig({
          mode: params.collision.mode,
          extents: [
            Math.max(0.05, localExtents[0]),
            Math.max(0.02, localExtents[1]),
            Math.max(0.05, localExtents[2]),
          ],
          assetId: params.assetId,
          customBoxes:
            params.collision.mode === "single-box"
              ? params.collision.boxes
              : undefined,
        });

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
            collision: rebuiltCollision,
          },
        };

        const builtFoundation = createFoundationPartsAndConnections(foundation);
        if (params.name && builtFoundation.parts[0]) {
          builtFoundation.parts[0] = {
            ...builtFoundation.parts[0],
            name: params.name,
          };
        }
        return finalizeFoundationRebuild(
          state,
          foundation,
          builtFoundation.parts,
          builtFoundation.connections
        );
      });
    },

    importStructuralStl: (params) => {
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
        const localExtents = computeLocalStlExtents({
          rawDimensions: params.inspection.rawDimensions,
          unit: params.transform.unit,
          scale: scaleTuple,
        });
        const L = Math.max(0.02, localExtents[0]);
        const H = Math.max(0.02, localExtents[1]);
        const W = Math.max(0.02, localExtents[2]);
        const worldExtents = computeTransformedStlExtents({
          rawDimensions: params.inspection.rawDimensions,
          unit: params.transform.unit,
          scale: scaleTuple,
          orientationRotation: params.transform.orientationRotation,
        });
        const mass =
          params.engineering.massKg !== undefined && params.engineering.massKg > 0
            ? params.engineering.massKg
            : 0;

        const parentPart = params.parentId
          ? state.parts.find((p) => p.id === params.parentId)
          : state.parts.find((p) => p.id === "foundation-chassis");

        let pos: [number, number, number] = [
          params.transform.positionOffset[0],
          (state.foundation?.height ?? 0.3) + worldExtents[1] * 0.5 + params.transform.positionOffset[1],
          params.transform.positionOffset[2],
        ];
        let rot: [number, number, number] = [...params.transform.orientationRotation];

        const rebuiltCollision = buildCustomCollisionConfig({
          mode: params.collision.mode,
          extents: [L, H, W],
          assetId: params.assetId,
          customBoxes:
            params.collision.mode === "single-box"
              ? params.collision.boxes
              : undefined,
        });

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
          collisionConfig: rebuiltCollision,
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
          // Compute flush surface attachment using post-orientation world bounds so Z-up -> Y-up
          // imported STLs seat cleanly on parent interfaces instead of floating/sinking by (H - W)/2.
          const orientedDraft: RobotPart = {
            ...draft,
            size: [
              Math.max(0.02, worldExtents[0]),
              Math.max(0.02, worldExtents[1]),
              Math.max(0.02, worldExtents[2]),
            ],
            geometry: {
              shape: "box",
              length: Math.max(0.02, worldExtents[0]),
              height: Math.max(0.02, worldExtents[1]),
              width: Math.max(0.02, worldExtents[2]),
            },
          };
          const cIfaces = resolvePartMountingInterfaces(orientedDraft, state.foundation);
          const parentIface =
            pIfaces.find((i) => i.id === params.parentInterfaceId) ?? pIfaces[0];
          const childIface = cIfaces[0];
          if (parentIface && childIface) {
            const attached = computeAttachedChildTransform(
              parentPart,
              parentIface,
              orientedDraft,
              childIface
            );
            pos = [
              attached.worldPosition[0] + params.transform.positionOffset[0],
              attached.worldPosition[1] + params.transform.positionOffset[1],
              attached.worldPosition[2] + params.transform.positionOffset[2],
            ];
            rot = composeEulerRotations(
              attached.worldRotation,
              params.transform.orientationRotation
            );
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
              relativeRotation: composeEulerRotations(
                attached.relativeRotation,
                params.transform.orientationRotation
              ),
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
          (state.foundation?.imported?.assetId === target.meshAssetId
            ? state.foundation.imported.inspection
            : undefined) ?? getMeshAssetRecord(target.meshAssetId)?.inspection;
        const nextTransform: ImportedMeshTransform | undefined = target.meshTransform
          ? {
              ...target.meshTransform,
              ...patch.transform,
            }
          : undefined;

        let nextLocalSize = target.size;
        let nextWorldExtents: readonly [number, number, number] = target.size;
        if (inspection && nextTransform) {
          const scaleTuple =
            nextTransform.scaleMode === "uniform"
              ? ([
                  nextTransform.uniformScale,
                  nextTransform.uniformScale,
                  nextTransform.uniformScale,
                ] as const)
              : nextTransform.nonUniformScale;
          const localExtents = computeLocalStlExtents({
            rawDimensions: inspection.rawDimensions,
            unit: nextTransform.unit,
            scale: scaleTuple,
          });
          const minClamp = partId === "foundation-chassis" ? 0.05 : 0.02;
          nextLocalSize = [
            Math.max(minClamp, localExtents[0]),
            Math.max(0.02, localExtents[1]),
            Math.max(minClamp, localExtents[2]),
          ];
          const worldRaw = computeTransformedStlExtents({
            rawDimensions: inspection.rawDimensions,
            unit: nextTransform.unit,
            scale: scaleTuple,
            orientationRotation: nextTransform.orientationRotation,
          });
          nextWorldExtents = [
            Math.max(minClamp, worldRaw[0]),
            Math.max(0.02, worldRaw[1]),
            Math.max(minClamp, worldRaw[2]),
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

        const requestedMode =
          patch.collision?.mode ?? target.collisionConfig?.mode;
        const prevMode = target.collisionConfig?.mode;
        const sameMode = !patch.collision?.mode || patch.collision.mode === prevMode;
        const suppliedCustomBoxes = Boolean(
          patch.collision?.boxes &&
            patch.collision.boxes !== target.collisionConfig?.boxes &&
            sameMode
        );

        let singleBoxOverrides =
          requestedMode === "single-box" && suppliedCustomBoxes
            ? patch.collision?.boxes
            : undefined;
        if (
          requestedMode === "single-box" &&
          !suppliedCustomBoxes &&
          prevMode === "single-box" &&
          target.collisionConfig?.boxes.length === 1 &&
          !target.collisionConfig.boxes[0].id.startsWith("proxy-primary") &&
          !target.collisionConfig.boxes[0].id.startsWith("proxy-quad-")
        ) {
          const sx = nextLocalSize[0] / Math.max(1e-5, target.size[0]);
          const sy = nextLocalSize[1] / Math.max(1e-5, target.size[1]);
          const sz = nextLocalSize[2] / Math.max(1e-5, target.size[2]);
          const prevBox = target.collisionConfig.boxes[0];
          singleBoxOverrides = [
            {
              ...prevBox,
              center: [
                prevBox.center[0] * sx,
                prevBox.center[1] * sy,
                prevBox.center[2] * sz,
              ],
              size: [
                Math.max(0.01, prevBox.size[0] * sx),
                Math.max(0.01, prevBox.size[1] * sy),
                Math.max(0.01, prevBox.size[2] * sz),
              ],
            },
          ];
        }

        const nextCollision = requestedMode
          ? buildCustomCollisionConfig({
              mode: requestedMode,
              extents: nextLocalSize,
              assetId: target.meshAssetId,
              customBoxes:
                requestedMode === "single-box"
                  ? singleBoxOverrides
                  : suppliedCustomBoxes
                    ? patch.collision?.boxes
                    : undefined,
            })
          : undefined;

        const resolvedMass =
          nextEngineering?.massKg !== undefined && nextEngineering.massKg > 0
            ? nextEngineering.massKg
            : target.massKg ?? target.mass;

        const hasExplicitOrientation =
          patch.transform?.orientationRotation !== undefined;
        const nextRotation: [number, number, number] = hasExplicitOrientation
          ? [...nextTransform!.orientationRotation]
          : [...(target.rotation ?? nextTransform?.orientationRotation ?? [0, 0, 0])];
        const syncedTransform = nextTransform
          ? {
              ...nextTransform,
              orientationRotation: [...nextRotation] as [number, number, number],
            }
          : undefined;

        const prevOffset = target.meshTransform?.positionOffset ?? [0, 0, 0];
        const nextOffset = syncedTransform?.positionOffset ?? prevOffset;
        const offsetDelta: [number, number, number] = [
          nextOffset[0] - prevOffset[0],
          nextOffset[1] - prevOffset[1],
          nextOffset[2] - prevOffset[2],
        ];
        const nextPosition: [number, number, number] =
          partId === "foundation-chassis" &&
          state.foundation?.mode === "imported"
            ? [
                nextOffset[0],
                nextWorldExtents[1] * 0.5 + nextOffset[1],
                nextOffset[2],
              ]
            : [
                target.position[0] + offsetDelta[0],
                target.position[1] + offsetDelta[1],
                target.position[2] + offsetDelta[2],
              ];

        const updatedPart: RobotPart = {
          ...target,
          position: nextPosition,
          size: nextLocalSize,
          rotation: nextRotation,
          mass: resolvedMass,
          massKg: resolvedMass,
          meshTransform: syncedTransform,
          importedEngineering: nextEngineering,
          collisionConfig: nextCollision,
          customInertiaKgM2: nextEngineering?.inertiaKgM2
            ? [...nextEngineering.inertiaKgM2]
            : undefined,
          geometry: {
            shape: "box",
            length: nextLocalSize[0],
            height: nextLocalSize[1],
            width: nextLocalSize[2],
          },
          engineeringSpec:
            partId === "foundation-chassis"
              ? {
                  category: "structural",
                  role: "chassis-frame",
                  generalProvenance: nextEngineering?.provenance,
                }
              : target.engineeringSpec
                ? {
                    ...target.engineeringSpec,
                    generalProvenance: nextEngineering?.provenance,
                  }
                : {
                    category: "structural",
                    role: "bulkhead",
                    generalProvenance: nextEngineering?.provenance,
                  },
        };

        const nextFoundation =
          partId === "foundation-chassis" &&
          state.foundation?.mode === "imported" &&
          state.foundation.imported
            ? {
                ...state.foundation,
                length: nextWorldExtents[0],
                height: nextWorldExtents[1],
                width: nextWorldExtents[2],
                imported: {
                  ...state.foundation.imported,
                  transform:
                    syncedTransform ?? state.foundation.imported.transform,
                  engineering:
                    nextEngineering ?? state.foundation.imported.engineering,
                  collision: nextCollision ?? state.foundation.imported.collision,
                },
              }
            : state.foundation;

        const replacedParts = state.parts.map((p) => (p.id === partId ? updatedPart : p));
        let nextConnections = reanchorMountedChildrenOnParentResize({
          prevParts: state.parts,
          nextParts: replacedParts,
          connections: state.connections,
          resizedPartIds: [partId],
          foundation: nextFoundation,
        });

        // Keep parent-relative rotation and positionOffset delta synced if this structural STL is mounted to a parent
        nextConnections = nextConnections.map((conn) => {
          if ((conn.childId ?? conn.targetId) !== partId || conn.type === "Motor-Wheel") {
            return conn;
          }
          const parentPart = replacedParts.find(
            (p) => p.id === (conn.parentId ?? conn.sourceId)
          );
          if (!parentPart) return conn;
          const prevRelPos = conn.relativePosition ?? [0, 0, 0];
          const updatedRelPos: [number, number, number] = [
            prevRelPos[0] + offsetDelta[0],
            prevRelPos[1] + offsetDelta[1],
            prevRelPos[2] + offsetDelta[2],
          ];
          return {
            ...conn,
            relativePosition: updatedRelPos,
            relativeRotation: computeRelativeEulerRotation(
              parentPart.rotation ?? [0, 0, 0],
              nextRotation
            ),
          };
        });

        const syncedParts = syncAssemblyTransforms(replacedParts, nextConnections);

        return {
          parts: syncedParts,
          connections: nextConnections,
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
  };
}
