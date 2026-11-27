import { create } from "zustand";

import {
  releaseMeshAsset,
  retainMeshAsset,
} from "../features/robot-builder/logic/meshAssetRegistry";
import {
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "../features/robot-builder/logic/drivetrain";
import {
  registerDecodedProjectAssets,
} from "../features/persistence/logic/projectSerialization";
import {
  createStarterPresets,
  replaceSavedVisualPrograms,
} from "../features/programming/logic/programPersistence";
import { SIMULATION_ARENA_PRESETS } from "../features/simulation/logic/simulationWorld";
import {
  captureAssemblySnapshot,
  collectStoreMeshAssetIds,
  createEmptyDrivetrain,
  restoreAssemblySnapshot,
  sanitizeAssemblyGraph,
  syncAssemblyTransforms,
} from "./assemblyStoreHelpers";
import {
  MAX_ASSEMBLY_HISTORY,
  type RobotStore,
  type StoreSet,
} from "./robotStore.types";
import { createDrivetrainSlice } from "./slices/drivetrainSlice";
import { createElectricalSlice } from "./slices/electricalSlice";
import { createFoundationSlice } from "./slices/foundationSlice";
import { createPartsSlice } from "./slices/partsSlice";

export type { AssemblyHistorySnapshot, RobotStore } from "./robotStore.types";
export {
  syncGeometryFromSize,
  syncSizeFromGeometry,
} from "./assemblyStoreHelpers";

export const useRobotStore = create<RobotStore>((rawSet, get) => {
  const storeTrackedMeshAssets = new Set<string>();
  const syncStoreMeshAssetRetentions = (state: RobotStore) => {
    const nextAssetIds = collectStoreMeshAssetIds(state);
    for (const nextId of nextAssetIds) {
      if (!storeTrackedMeshAssets.has(nextId)) {
        retainMeshAsset(nextId);
        storeTrackedMeshAssets.add(nextId);
      }
    }
    for (const prevId of [...storeTrackedMeshAssets]) {
      if (!nextAssetIds.has(prevId)) {
        releaseMeshAsset(prevId);
        storeTrackedMeshAssets.delete(prevId);
      }
    }
  };

  const trackedRawSet: typeof rawSet = (partialOrUpdater, replace) => {
    rawSet((state) => {
      const nextPatch =
        typeof partialOrUpdater === "function"
          ? partialOrUpdater(state)
          : partialOrUpdater;
      if (nextPatch === state) return state;
      const merged = replace
        ? (nextPatch as RobotStore)
        : ({ ...state, ...nextPatch } as RobotStore);
      syncStoreMeshAssetRetentions(merged);
      return nextPatch as RobotStore;
    }, replace as never);
  };

  const set: StoreSet = (partialOrUpdater) => {
    if (typeof partialOrUpdater !== "function") {
      trackedRawSet(partialOrUpdater);
      return;
    }

    trackedRawSet((state) => {
      const patch = partialOrUpdater(state);
      if (patch === state) return state;

      // Explicit history resets or replacements must never capture the discarded build into historyPast.
      if ("historyPast" in patch || "historyFuture" in patch) {
        return patch;
      }

      const modifiesAssembly =
        "parts" in patch ||
        "connections" in patch ||
        "electricalConnections" in patch ||
        "foundation" in patch ||
        "foundationId" in patch ||
        "drivetrain" in patch;

      if (!modifiesAssembly) return patch;

      const baselineSnapshot =
        state.activeTransformPreview?.baselineSnapshot ??
        captureAssemblySnapshot(state);

      return {
        ...patch,
        activeTransformPreview: null,
        historyPast: [
          ...(state.historyPast ?? []),
          baselineSnapshot,
        ].slice(-MAX_ASSEMBLY_HISTORY),
        historyFuture: [],
      };
    });
  };

  return {
    projectName: "Untitled Robot",
    projectCreatedAtIso: new Date().toISOString(),
    selectedArenaId: SIMULATION_ARENA_PRESETS[0].id,
    visualProgram: createStarterPresets()[0],
    projectRevision: 0,
    lastProjectLoadWarnings: [],
    setProjectName: (name) =>
      trackedRawSet({ projectName: name }),
    setSelectedArenaId: (arenaId) =>
      trackedRawSet((state) => ({
        selectedArenaId: SIMULATION_ARENA_PRESETS.some((p) => p.id === arenaId)
          ? arenaId
          : state.selectedArenaId,
      })),
    setVisualProgram: (program) =>
      trackedRawSet({ visualProgram: program }),
    clearProjectLoadWarnings: () =>
      trackedRawSet({ lastProjectLoadWarnings: [] }),
    loadProjectState: (loaded) => {
      if (!loaded.success || !loaded.project) return false;
      const project = loaded.project;
      const sanitizedBuild = sanitizeAssemblyGraph({
        parts: structuredClone(project.build.parts),
        connections: structuredClone(project.build.connections),
        electricalConnections: structuredClone(project.electrical.connections),
        foundation: project.build.foundation
          ? structuredClone(project.build.foundation)
          : null,
        foundationId: project.build.foundationId,
        drivetrain: structuredClone(project.build.drivetrain),
        hiddenPartIds: [...project.build.hiddenPartIds],
        selectedId: project.build.selectedId,
        selectedWheelMotorId: null,
        selectedElectricalConnectionId: null,
        selectedElectricalPinId: null,
        stage: project.build.stage,
      });
      const syncedParts = syncAssemblyTransforms(
        sanitizedBuild.parts,
        sanitizedBuild.connections
      );
      const referencedAssetIds = collectStoreMeshAssetIds({
        parts: syncedParts,
        foundation: sanitizedBuild.foundation,
      });
      registerDecodedProjectAssets(
        loaded.decodedAssets.filter((asset) => referencedAssetIds.has(asset.assetId))
      );
      if (
        project.programming.savedPrograms !== undefined ||
        loaded.migratedFromVersion === undefined
      ) {
        replaceSavedVisualPrograms(project.programming.savedPrograms ?? []);
      }
      trackedRawSet((state) => ({
        projectName: project.metadata.name,
        projectCreatedAtIso: project.metadata.createdAtIso,
        selectedArenaId: project.simulation.selectedArenaId,
        visualProgram: structuredClone(project.programming.activeProgram),
        projectRevision: state.projectRevision + 1,
        lastProjectLoadWarnings: [...loaded.warnings],
        lastReplacementWarning: null,
        stage: sanitizedBuild.stage ?? project.build.stage,
        foundationId: sanitizedBuild.foundationId,
        foundation: sanitizedBuild.foundation,
        parts: syncedParts,
        connections: sanitizedBuild.connections,
        electricalConnections: sanitizedBuild.electricalConnections,
        drivetrain: sanitizedBuild.drivetrain,
        hiddenPartIds: sanitizedBuild.hiddenPartIds,
        selectedId: sanitizedBuild.selectedId,
        transformMode: "select",
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
      return true;
    },

    parts: [],
    connections: [],
    electricalConnections: [],
    hiddenPartIds: [],
    selectedId: null,
    transformMode: "select",
    historyPast: [],
    historyFuture: [],
    activeTransformPreview: null,
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
    clearReplacementWarning: () => trackedRawSet({ lastReplacementWarning: null }),
    setSelectedElectricalConnection: (connectionId) =>
      trackedRawSet({ selectedElectricalConnectionId: connectionId }),
    setSelectedElectricalPin: (partId, pinId) =>
      trackedRawSet((state) => ({
        selectedId: partId ?? state.selectedId,
        selectedElectricalPinId: pinId,
      })),
    focusElectricalDiagnostic: (diagnostic) =>
      trackedRawSet((state) => ({
        selectedId: diagnostic.partId ?? state.selectedId,
        selectedElectricalConnectionId: diagnostic.connectionId ?? null,
        selectedElectricalPinId: diagnostic.pinId ?? null,
      })),

    undo: () => {
      let restored = false;
      trackedRawSet((state) => {
        if (state.activeTransformPreview) {
          const baseline = state.activeTransformPreview.baselineSnapshot;
          restored = true;
          return {
            ...restoreAssemblySnapshot(state, baseline),
            activeTransformPreview: null,
          };
        }
        const past = state.historyPast ?? [];
        if (past.length === 0) return state;
        const previous = past[past.length - 1];
        const nextPast = past.slice(0, -1);
        const nextFuture = [
          captureAssemblySnapshot(state),
          ...(state.historyFuture ?? []),
        ].slice(0, MAX_ASSEMBLY_HISTORY);
        restored = true;
        return {
          ...restoreAssemblySnapshot(state, previous),
          activeTransformPreview: null,
          historyPast: nextPast,
          historyFuture: nextFuture,
        };
      });
      return restored;
    },

    redo: () => {
      let restored = false;
      trackedRawSet((state) => {
        const future = state.historyFuture ?? [];
        if (future.length === 0) return state;
        const next = future[0];
        const nextFuture = future.slice(1);
        const nextPast = [
          ...(state.historyPast ?? []),
          captureAssemblySnapshot(state),
        ].slice(-MAX_ASSEMBLY_HISTORY);
        restored = true;
        return {
          ...restoreAssemblySnapshot(state, next),
          activeTransformPreview: null,
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

    ...createDrivetrainSlice(set),
    ...createFoundationSlice(set, get, trackedRawSet),
    ...createPartsSlice(set, get, trackedRawSet),
    ...createElectricalSlice(set, get),
  };
});
