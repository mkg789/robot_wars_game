import { beforeEach, describe, expect, it } from "vitest";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import { createEmptyVisualProgram } from "../../programming/logic/programPersistence";
import { buildCustomCollisionConfig } from "../../robot-builder/logic/customCollision";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  getOrCreateThreeBufferGeometry,
  getRegisteredAssetCount,
  registerParsedStlAsset,
} from "../../robot-builder/logic/meshAssetRegistry";
import { inspectStlGeometry } from "../../robot-builder/logic/stlParser";
import { SIMULATION_ARENA_PRESETS } from "../../simulation/logic/simulationWorld";
import {
  exportProjectFromStore,
  exportProjectJsonFromStore,
  importProjectIntoStore,
} from "../../../store/projectStoreAdapter";
import { useRobotStore } from "../../../store/robotStore";
import {
  PROJECT_FORMAT_ID,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "../types/project.types";
import { parseAndValidateRobotProject } from "./projectSerialization";
import {
  clearProjectAutosave,
  hasProjectAutosave,
  loadProjectAutosave,
  saveProjectAutosave,
} from "./projectStorage";

function createTestStlAsset(assetId: string) {
  // Single non-origin-centered triangle to detect any accidental double-centering on reload
  const rawPositions = new Float32Array([
    2.0, 1.0, 0.0,
    2.4, 1.0, 0.0,
    2.0, 1.4, 0.2,
  ]);
  const { normals, inspection } = inspectStlGeometry(
    rawPositions,
    "offset-bracket.stl",
    "ascii"
  );
  return registerParsedStlAsset(
    {
      positions: rawPositions,
      normals,
      inspection,
    },
    assetId
  );
}

describe("Stage F: Unified Project Persistence", () => {
  beforeEach(() => {
    clearMeshAssets();
    clearProjectAutosave();
    useRobotStore.getState().startNewBuild();
  });

  it("serializes and restores complete project fidelity (foundation, parts, wiring, drivetrain, arena, visual program, and deduplicated STL)", () => {
    const store = useRobotStore.getState();
    store.setProjectName("Arena Wedge Mk4");
    store.confirmFoundation();

    // Install electronics + powertrain
    store.installBattery("standard-lipo");
    store.installController("arduino-uno");
    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    store.selectMountZone("front-right");
    store.placeMotor();

    const motors = useRobotStore
      .getState()
      .parts.filter((p) => p.type === "Motor");
    store.selectWheelCatalogueItem("standard-rubber");
    for (const m of motors) {
      store.assignWheel(m.id);
    }
    store.applySuggestedDrivetrainMapping(true);

    // Wire battery -> controller
    const battery = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Battery")!;
    const controller = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Controller")!;
    const batSpec = resolvePartElectricalSpec(battery)!;
    const ctrlSpec = resolvePartElectricalSpec(controller)!;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: battery.id,
      sourceInterfaceId: batSpec.interfaces[0].interfaceId,
      targetPartId: controller.id,
      targetInterfaceId: ctrlSpec.interfaces[0].interfaceId,
      connectionType: "power",
      provenance: { method: "user-supplied", source: "test" },
    });

    // Register 1 STL asset and reference it across TWO parts to verify asset deduplication
    const stlRecord = createTestStlAsset("stl-shared-bracket");
    const expectedCenteredCopy = new Float32Array(stlRecord.centeredPositions);
    const stlParams = {
      assetId: stlRecord.assetId,
      fileName: "offset-bracket.stl",
      inspection: stlRecord.inspection,
      transform: {
        unit: "m" as const,
        unitConfirmed: true,
        scaleMode: "uniform" as const,
        uniformScale: 1,
        nonUniformScale: [1, 1, 1] as const,
        orientationRotation: [0, 0, 0] as const,
        positionOffset: [0, 0, 0] as const,
      },
      engineering: {
        materialId: "aluminum-6061" as const,
        materialName: "Aluminum 6061",
        massMode: "user" as const,
        massKg: 0.75,
        centerOfMassMode: "calculated" as const,
        inertiaMode: "calculated" as const,
        provenance: {
          method: "measured" as const,
          verified: true,
          source: "scale",
        },
      },
      collision: buildCustomCollisionConfig({
        mode: "single-box",
        extents: [0.4, 0.4, 0.2],
        assetId: stlRecord.assetId,
      }),
    };
    const stlId1 = useRobotStore.getState().importStructuralStl(stlParams)!;
    const stlId2 = useRobotStore.getState().importStructuralStl(stlParams)!;
    expect(stlId1).toBeTruthy();
    expect(stlId2).toBeTruthy();

    // Custom arena & visual program
    const customArenaId = SIMULATION_ARENA_PRESETS[1].id;
    useRobotStore.getState().setSelectedArenaId(customArenaId);
    const customProgram = {
      ...createEmptyVisualProgram("Charge & Guard"),
      instructions: [
        {
          id: "inst-drive-1",
          kind: "drive" as const,
          direction: "forward" as const,
          power: 0.85,
          durationSeconds: 1.5,
        },
        {
          id: "inst-if-1",
          kind: "if-ultrasonic" as const,
          operator: "below" as const,
          thresholdMeters: 0.9,
          thenInstructions: [
            { id: "inst-stop-1", kind: "stop" as const, target: "robot" as const },
          ],
          elseInstructions: [
            { id: "inst-wait-1", kind: "wait" as const, durationSeconds: 0.25 },
          ],
        },
      ],
    };
    useRobotStore.getState().setVisualProgram(customProgram);

    const exportedJson = exportProjectJsonFromStore();
    const rawObj = JSON.parse(exportedJson);
    expect(rawObj.format).toBe(PROJECT_FORMAT_ID);
    expect(rawObj.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(rawObj.assets).toHaveLength(1); // deduplicated despite 2 parts referencing it

    // Wipe runtime state completely (simulating browser reload)
    const prevRevision = useRobotStore.getState().projectRevision;
    useRobotStore.getState().startNewBuild();
    clearMeshAssets();
    expect(getRegisteredAssetCount()).toBe(0);
    expect(useRobotStore.getState().electricalConnections).toHaveLength(0);

    // Import exported project JSON
    const loadResult = importProjectIntoStore(exportedJson);
    expect(loadResult.success).toBe(true);
    expect(loadResult.errors).toEqual([]);
    expect(loadResult.restoredAssetIds).toEqual(["stl-shared-bracket"]);
    expect(loadResult.orphanedAssetIds).toEqual([]);

    const restored = useRobotStore.getState();
    expect(restored.projectName).toBe("Arena Wedge Mk4");
    expect(restored.selectedArenaId).toBe(customArenaId);
    expect(restored.visualProgram.name).toBe("Charge & Guard");
    expect(restored.visualProgram.instructions).toHaveLength(2);
    expect(restored.electricalConnections).toHaveLength(1);
    expect(restored.drivetrain.left[0]).not.toBeNull();
    expect(restored.drivetrain.right[0]).not.toBeNull();
    expect(restored.parts.some((p) => p.id === stlId1)).toBe(true);
    expect(restored.parts.some((p) => p.id === stlId2)).toBe(true);

    // History cleared & projectRevision bumped to reset SimulationView / controller cleanly
    expect(restored.historyPast).toEqual([]);
    expect(restored.historyFuture).toEqual([]);
    expect(restored.activeTransformPreview).toBeNull();
    expect(restored.projectRevision).toBeGreaterThan(prevRevision + 1);

    // Bit-exact centered vertex preservation (no double centroid shift) + refCount
    const restoredAsset = getMeshAssetRecord("stl-shared-bracket");
    expect(restoredAsset).not.toBeNull();
    expect(restoredAsset!.refCount).toBe(1);
    expect(Array.from(restoredAsset!.centeredPositions)).toEqual(
      Array.from(expectedCenteredCopy)
    );
    expect(getOrCreateThreeBufferGeometry("stl-shared-bracket")).not.toBeNull();
  });

  it("releases STL assets cleanly when loading a different project that does not reference them", () => {
    const stl = createTestStlAsset("old-project-stl");
    useRobotStore.getState().importStructuralStl({
      assetId: stl.assetId,
      fileName: "offset-bracket.stl",
      inspection: stl.inspection,
      transform: {
        unit: "m",
        unitConfirmed: true,
        scaleMode: "uniform",
        uniformScale: 1,
        nonUniformScale: [1, 1, 1],
        orientationRotation: [0, 0, 0],
        positionOffset: [0, 0, 0],
      },
      engineering: {
        materialId: "unknown",
        materialName: "Unknown",
        massMode: "user",
        massKg: 0.5,
        centerOfMassMode: "calculated",
        inertiaMode: "calculated",
        provenance: { method: "measured", verified: true, source: "scale" },
      },
      collision: buildCustomCollisionConfig({
        mode: "single-box",
        extents: [0.2, 0.2, 0.2],
        assetId: stl.assetId,
      }),
    });
    expect(getMeshAssetRecord("old-project-stl")).not.toBeNull();

    // Load empty clean v2 project without STL
    useRobotStore.getState().startNewBuild();
    const cleanJson = exportProjectJsonFromStore();
    // Put STL back in current store then overwrite via load
    const stl2 = createTestStlAsset("temp-stl-for-overwrite");
    useRobotStore.getState().importStructuralStl({
      assetId: stl2.assetId,
      fileName: "offset-bracket.stl",
      inspection: stl2.inspection,
      transform: {
        unit: "m",
        unitConfirmed: true,
        scaleMode: "uniform",
        uniformScale: 1,
        nonUniformScale: [1, 1, 1],
        orientationRotation: [0, 0, 0],
        positionOffset: [0, 0, 0],
      },
      engineering: {
        materialId: "unknown",
        materialName: "Unknown",
        massMode: "user",
        massKg: 0.5,
        centerOfMassMode: "calculated",
        inertiaMode: "calculated",
        provenance: { method: "measured", verified: true, source: "scale" },
      },
      collision: buildCustomCollisionConfig({
        mode: "single-box",
        extents: [0.2, 0.2, 0.2],
        assetId: stl2.assetId,
      }),
    });
    expect(getMeshAssetRecord(stl2.assetId)?.refCount).toBe(2);

    const res = importProjectIntoStore(cleanJson);
    expect(res.success).toBe(true);
    // Store release decrements refCount from 2 -> 1 (initial createTestStlAsset registration + 0 store refs)
    expect(getMeshAssetRecord(stl2.assetId)?.refCount).toBe(1);
  });

  it("rejects malformed JSON and future schema versions without mutating store or asset registry", () => {
    useRobotStore.getState().setProjectName("Protected Project");

    const badJson = parseAndValidateRobotProject("{ not valid json ");
    expect(badJson.success).toBe(false);
    expect(badJson.errors[0]).toContain("Invalid JSON");

    const futureVersion = parseAndValidateRobotProject({
      format: PROJECT_FORMAT_ID,
      schemaVersion: 99,
      build: { parts: [] },
    });
    expect(futureVersion.success).toBe(false);
    expect(futureVersion.errors[0]).toContain("Unsupported project schemaVersion 99");

    const wrongFormat = parseAndValidateRobotProject({
      format: "some-other-app",
      schemaVersion: 2,
      build: { parts: [] },
    });
    expect(wrongFormat.success).toBe(false);

    expect(useRobotStore.getState().projectName).toBe("Protected Project");
  });

  it("migrates legacy schemaVersion 1 projects and sanitizes broken graph links, wires, and orphaned STL references", () => {
    const legacyV1 = {
      schemaVersion: 1,
      name: "Legacy Bot v1",
      stage: "structure",
      foundationId: "foundation-chassis",
      foundation: {
        modelId: "standard-rectangular",
        length: 1.2,
        width: 0.9,
        height: 0.25,
        includeTopPlate: false,
        includeFrontCover: false,
        confirmed: true,
        mode: "procedural",
      },
      parts: [
        {
          id: "foundation-chassis",
          name: "Chassis",
          type: "Structural Block",
          position: [0, 0.125, 0],
          rotation: [0, 0, 0],
          size: [1.2, 0.25, 0.9],
          color: "#475569",
          mass: 2.0,
          geometry: { shape: "box", length: 1.2, height: 0.25, width: 0.9 },
        },
        {
          id: "stl-orphan-part",
          name: "Missing Mesh Part",
          type: "Structural Block",
          meshAssetId: "non-existent-stl-id",
          position: [0, 0.3, 0],
          rotation: [0, 0, 0],
          size: [0.2, 0.1, 0.2],
          color: "#94a3b8",
          mass: 0.5,
        },
      ],
      connections: [
        // Self-loop / broken connection should be stripped by sanitizer
        {
          id: "bad-conn",
          sourceId: "stl-orphan-part",
          targetId: "stl-orphan-part",
          parentId: "stl-orphan-part",
          childId: "stl-orphan-part",
          type: "Mechanical",
          relativePosition: [0, 0, 0],
          relativeRotation: [0, 0, 0],
        },
        // Valid connection to foundation
        {
          id: "good-conn",
          sourceId: "foundation-chassis",
          targetId: "stl-orphan-part",
          parentId: "foundation-chassis",
          childId: "stl-orphan-part",
          type: "Mechanical",
          relativePosition: [0, 0.175, 0],
          relativeRotation: [0, 0, 0],
        },
      ],
      electricalConnections: [
        // Dangling wire pointing to non-existent part
        {
          id: "dangling-wire",
          sourcePartId: "missing-part-1",
          sourceInterfaceId: "out",
          targetPartId: "foundation-chassis",
          targetInterfaceId: "in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        },
      ],
      selectedArenaId: "deleted-custom-arena",
      visualProgram: { corrupted: true },
    };

    const result = importProjectIntoStore(legacyV1);
    expect(result.success).toBe(true);
    expect(result.migratedFromVersion).toBe(1);
    expect(result.orphanedAssetIds).toEqual(["non-existent-stl-id"]);
    expect(result.warnings.some((w) => w.includes("Migrated legacy v1"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("invalid or cyclic mechanical"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("dangling electrical"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("non-existent-stl-id"))).toBe(true);

    const state = useRobotStore.getState();
    expect(state.projectName).toBe("Legacy Bot v1");
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].id).toBe("good-conn");
    expect(state.electricalConnections).toHaveLength(0);
    expect(state.selectedArenaId).toBe(SIMULATION_ARENA_PRESETS[0].id);
    expect(state.visualProgram.version).toBe(1);
  });

  it("supports browser autosave write, read, and clear round-trip", () => {
    useRobotStore.getState().setProjectName("Autosaved Wedge");
    useRobotStore.getState().confirmFoundation();
    const project = exportProjectFromStore();

    expect(hasProjectAutosave()).toBe(false);
    expect(saveProjectAutosave(project).saved).toBe(true);
    expect(hasProjectAutosave()).toBe(true);

    const loaded = loadProjectAutosave();
    expect(loaded?.success).toBe(true);
    expect(loaded?.project?.metadata.name).toBe("Autosaved Wedge");

    clearProjectAutosave();
    expect(hasProjectAutosave()).toBe(false);
  });
});
