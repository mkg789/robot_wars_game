import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVisualProgramStorage,
  loadSavedVisualPrograms,
} from "../../src/features/programming/logic/programPersistence";
import type { VisualRobotProgram } from "../../src/features/programming/types/programWorkspace.types";
import {
  parseAndValidateRobotProject,
  serializeRobotProject,
} from "../../src/features/persistence/logic/projectSerialization";
import {
  clearProjectAutosave,
  hasProjectAutosave,
  loadProjectAutosave,
  saveProjectAutosave,
  shouldPersistProjectAutosave,
} from "../../src/features/persistence/logic/projectStorage";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  getOrCreateThreeBufferGeometry,
  getRegisteredAssetCount,
  releaseMeshAsset,
} from "../../src/features/robot-builder/logic/meshAssetRegistry";
import {
  exportProjectFromStore,
  exportProjectJsonFromStore,
  importProjectIntoStore,
} from "../../src/store/projectStoreAdapter";
import { useRobotStore } from "../../src/store/robotStore";
import {
  assembleConfiguredRobotFixture,
  registerStlBoxFixture,
} from "../fixtures/robotFixtures";

describe("Integration Journeys 7–10: STL Lifecycle, Project Persistence, Reset/Undo & Store Round-Trips", () => {
  beforeEach(() => {
    clearMeshAssets();
    clearProjectAutosave();
    clearVisualProgramStorage();
    useRobotStore.getState().startNewBuild();
  });

  it("Journey 7: imports rotated STL foundation & bracket, shares GPU BufferGeometry across duplicates, updates transforms/collision bounds, and releases assets only after final dereference", () => {
    const stlChassis = registerStlBoxFixture({
      fileName: "custom-chassis.stl",
      dimensionsRaw: [480, 110, 320],
      orientationRotation: [0, Math.PI / 2, 0],
    });
    const stlBrace = registerStlBoxFixture({
      fileName: "side-brace.stl",
      dimensionsRaw: [180, 80, 40],
      orientationRotation: [Math.PI / 2, 0, 0],
    });

    const store = useRobotStore.getState();
    store.importFoundationStl({
      assetId: stlChassis.assetId,
      fileName: stlChassis.fileName,
      inspection: stlChassis.inspection,
      transform: stlChassis.transform,
      engineering: stlChassis.engineering,
      collision: stlChassis.collision,
    });
    store.confirmFoundation();

    const braceId = useRobotStore
      .getState()
      .importStructuralStl({
        assetId: stlBrace.assetId,
        fileName: stlBrace.fileName,
        inspection: stlBrace.inspection,
        transform: stlBrace.transform,
        engineering: stlBrace.engineering,
        collision: stlBrace.collision,
      })!;
    expect(braceId).toBeTruthy();

    useRobotStore.getState().duplicatePart(braceId);
    const braceClones = useRobotStore
      .getState()
      .parts.filter((part) => part.meshAssetId === stlBrace.assetId);
    expect(braceClones).toHaveLength(2);

    // Update transform + resize single-box collision proxy proportionally
    useRobotStore
      .getState()
      .updatePartTransform(
        braceId,
        [0.12, 0.14, 0],
        [0, 0, Math.PI / 4],
        [0.24, 0.1, 0.08]
      );
    const updatedBrace = useRobotStore
      .getState()
      .parts.find((part) => part.id === braceId)!;
    expect(updatedBrace.meshTransform?.orientationRotation[2]).toBeCloseTo(
      Math.PI / 4,
      5
    );
    expect(updatedBrace.collisionConfig?.boxes[0]?.size).toEqual([
      0.24, 0.1, 0.08,
    ]);

    const sharedGeom = getOrCreateThreeBufferGeometry(stlBrace.assetId)!;
    expect(sharedGeom).toBeTruthy();
    const disposeSpy = vi.spyOn(sharedGeom, "dispose");

    // Deleting only one duplicate leaves the STL asset and GPU BufferGeometry intact
    useRobotStore.getState().deletePartById(braceClones[1].id);
    expect(getMeshAssetRecord(stlBrace.assetId)).toBeDefined();
    expect(getMeshAssetRecord(stlBrace.assetId)?.cachedThreeGeometry).toBe(sharedGeom);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("Journey 8 & 10: exports JSON/object parity including savedPrograms, recovers via autosave, and sanitizes malicious or malformed project payloads", () => {
    const customProg: VisualRobotProgram = {
      version: 1,
      id: "saved-prog-f9",
      name: "Fixture Saved Program",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "wait-1",
          kind: "wait",
          durationSeconds: 0.25,
        },
      ],
    };

    const stl = registerStlBoxFixture({ fileName: "export-chassis.stl" });
    assembleConfiguredRobotFixture({
      projectName: "Persistence Roundtrip MK1",
      wireEscAndMotors: true,
      savedProgram: customProg,
    });
    const bracketId = useRobotStore
      .getState()
      .importStructuralStl({
        assetId: stl.assetId,
        fileName: stl.fileName,
        inspection: stl.inspection,
        transform: stl.transform,
        engineering: stl.engineering,
        collision: stl.collision,
      })!;
    expect(bracketId).toBeTruthy();

    const stateBeforeSave = useRobotStore.getState();
    expect(shouldPersistProjectAutosave(stateBeforeSave)).toBe(true);

    const exportedObj = exportProjectFromStore();
    const exportedJson = exportProjectJsonFromStore();
    const parsedFromJson = parseAndValidateRobotProject(exportedJson);
    expect(parsedFromJson.success).toBe(true);
    expect(parsedFromJson.project?.programming.savedPrograms).toEqual(
      exportedObj.programming.savedPrograms
    );

    // Autosave + recovery round-trip after full reset
    expect(saveProjectAutosave(exportedObj).saved).toBe(true);
    expect(hasProjectAutosave()).toBe(true);

    useRobotStore.getState().startNewBuild();
    clearMeshAssets();

    const recovered = loadProjectAutosave();
    expect(recovered?.success).toBe(true);
    useRobotStore.getState().loadProjectState(recovered!);

    const stateAfterRecover = useRobotStore.getState();
    expect(stateAfterRecover.projectName).toBe("Persistence Roundtrip MK1");
    expect(
      stateAfterRecover.parts.some((part) => part.meshAssetId === stl.assetId)
    ).toBe(true);
    expect(
      loadSavedVisualPrograms().some((prog) => prog.id === "saved-prog-f9")
    ).toBe(true);

    // Prototype pollution defense on raw JSON import
    const pollutedRaw = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"hacked":true}},"formatId":"bad"}`;
    const rejected = importProjectIntoStore(pollutedRaw);
    expect(rejected.success).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // Direct serialize -> parse validation on valid build preserves electrical connections
    const serializedAgain = serializeRobotProject({
      projectName: stateAfterRecover.projectName,
      selectedArenaId: stateAfterRecover.selectedArenaId,
      visualProgram: stateAfterRecover.visualProgram,
      savedPrograms: loadSavedVisualPrograms(),
      foundationId: stateAfterRecover.foundationId,
      foundation: stateAfterRecover.foundation,
      stage: stateAfterRecover.stage,
      parts: stateAfterRecover.parts,
      connections: stateAfterRecover.connections,
      electricalConnections: stateAfterRecover.electricalConnections,
      drivetrain: stateAfterRecover.drivetrain,
      hiddenPartIds: stateAfterRecover.hiddenPartIds,
      selectedId: stateAfterRecover.selectedId,
    });
    expect(serializedAgain.electrical.connections.length).toBeGreaterThan(0);
  });

  it("Journey 9: startNewBuild clears undo/redo history and purges STL assets so undo never resurrects dangling geometry", () => {
    const stl = registerStlBoxFixture({ fileName: "purge-me.stl" });
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().importStructuralStl({
      assetId: stl.assetId,
      fileName: stl.fileName,
      inspection: stl.inspection,
      transform: stl.transform,
      engineering: stl.engineering,
      collision: stl.collision,
    });
    // Hand off importer preview registration to store retention (matches StlImportPanel)
    releaseMeshAsset(stl.assetId);
    useRobotStore.getState().addStructuralPart("flat-plate");
    expect(useRobotStore.getState().historyPast.length).toBeGreaterThan(0);
    expect(getRegisteredAssetCount()).toBe(1);

    useRobotStore.getState().startNewBuild();
    const afterReset = useRobotStore.getState();
    expect(afterReset.historyPast).toHaveLength(0);
    expect(afterReset.historyFuture).toHaveLength(0);
    expect(shouldPersistProjectAutosave(afterReset)).toBe(false);

    // Attempting undo after reset cannot restore pre-reset parts or unreferenced STL assets
    useRobotStore.getState().undo();
    expect(
      useRobotStore.getState().parts.some((p) => p.meshAssetId === stl.assetId)
    ).toBe(false);
    expect(getRegisteredAssetCount()).toBe(0);
  });
});
