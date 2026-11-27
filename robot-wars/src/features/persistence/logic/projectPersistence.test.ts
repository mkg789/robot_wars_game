import { beforeEach, describe, expect, it } from "vitest";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import {
  clearVisualProgramStorage,
  createEmptyVisualProgram,
  loadSavedVisualPrograms,
  saveVisualProgram,
} from "../../programming/logic/programPersistence";
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
  shouldPersistProjectAutosave,
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

  it("F5: sanitizes cyclic, duplicate-parent, and malformed graphs BEFORE transform synchronization on load, autosave recovery, and undo/redo", () => {
    const projectWithCycleAndBadLinks = {
      format: PROJECT_FORMAT_ID,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      metadata: {
        name: "Sanitization Order Bot",
        createdAtIso: "2026-01-01T00:00:00.000Z",
        updatedAtIso: "2026-01-01T00:00:00.000Z",
        appName: "Robot Wars",
      },
      build: {
        stage: "structure",
        foundationId: "foundation-chassis",
        foundation: {
          modelId: "standard-rectangular",
          length: 1.5,
          width: 1.0,
          height: 0.2,
          includeTopPlate: true,
          includeFrontCover: false,
          confirmed: true,
          mode: "procedural",
        },
        parts: [
          {
            id: "foundation-chassis",
            name: "Chassis",
            type: "Structural Block",
            position: [0, 0.1, 0],
            rotation: [0, 0, 0],
            size: [1.5, 0.2, 1.0],
            color: "#475569",
            mass: 2.0,
          },
          {
            id: "node-a",
            name: "Node A",
            type: "Structural Block",
            parentAttachmentId: "cyc-b-to-a",
            position: [0.3, 0.5, 0],
            rotation: [0, 0, 0],
            size: [0.2, 0.2, 0.2],
            color: "#94a3b8",
            mass: 0.5,
          },
          {
            id: "node-b",
            name: "Node B",
            type: "Structural Block",
            parentAttachmentId: "cyc-a-to-b",
            // Drifted stale position: must be synced AFTER breaking B -> A cycle!
            position: [99, 99, 99],
            rotation: [0, 0, 0],
            size: [0.2, 0.2, 0.2],
            color: "#94a3b8",
            mass: 0.5,
          },
        ],
        connections: [
          null,
          {
            id: "cyc-a-to-b",
            sourceId: "node-a",
            targetId: "node-b",
            parentId: "node-a",
            childId: "node-b",
            parentMountPointId: "mount-top",
            childMountPointId: "mount-bottom",
            relativePosition: [0, 0.25, 0],
            relativeRotation: [0, 0, 0],
            type: "Mechanical",
          },
          // Multi-node cycle closure: before F5, running syncAssemblyTransforms BEFORE sanitize
          // skipped BOTH node-a and node-b (leaving node-b at [99, 99, 99])!
          {
            id: "cyc-b-to-a",
            sourceId: "node-b",
            targetId: "node-a",
            parentId: "node-b",
            childId: "node-a",
            parentMountPointId: "mount-top",
            childMountPointId: "mount-bottom",
            relativePosition: [0, -0.25, 0],
            relativeRotation: [0, 0, 0],
            type: "Mechanical",
          },
        ],
        drivetrain: {
          type: "differential-2",
          left: [null],
          right: [null],
          mappingCustomized: false,
        },
        hiddenPartIds: [],
        selectedId: "node-a",
      },
      electrical: { connections: [] },
      simulation: { selectedArenaId: SIMULATION_ARENA_PRESETS[0].id },
      programming: { activeProgram: createEmptyVisualProgram("Test") },
      assets: [],
    };

    const loadRes = importProjectIntoStore(projectWithCycleAndBadLinks);
    expect(loadRes.success).toBe(true);
    expect(loadRes.warnings.some((w) => w.includes("malformed mechanical connection"))).toBe(true);
    expect(loadRes.warnings.some((w) => w.includes("invalid or cyclic mechanical"))).toBe(true);

    const loadedState = useRobotStore.getState();
    expect(loadedState.connections.map((c) => c.id)).toEqual(["cyc-a-to-b"]);
    expect(loadedState.foundation?.includeTopPlate).toBe(false);
    const loadedA = loadedState.parts.find((p) => p.id === "node-a")!;
    const loadedB = loadedState.parts.find((p) => p.id === "node-b")!;
    expect(loadedA.parentAttachmentId).toBeUndefined();
    expect(loadedB.parentAttachmentId).toBe("cyc-a-to-b");
    expect(loadedB.position[0]).toBeCloseTo(0.3, 4);
    expect(loadedB.position[1]).toBeCloseTo(0.75, 4);
    expect(loadedB.position[2]).toBeCloseTo(0, 4);

    // Autosave recovery uses parseAndValidateRobotProject -> sanitized and synced identically
    saveProjectAutosave(loadRes.project!);
    const recovered = loadProjectAutosave();
    expect(recovered?.success).toBe(true);
    const recoveredB = recovered!.project!.build.parts.find((p) => p.id === "node-b")!;
    expect(recoveredB.position[1]).toBeCloseTo(0.75, 4);

    // Undo / redo path: mutate node-a, then inject drifted relative snapshot -> undo restores synced graph
    useRobotStore.getState().updatePartPosition("node-a", [0.8, 0.5, 0]);
    expect(
      useRobotStore.getState().parts.find((p) => p.id === "node-b")!.position[0]
    ).toBeCloseTo(0.8, 4);
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(
      useRobotStore.getState().parts.find((p) => p.id === "node-b")!.position[0]
    ).toBeCloseTo(0.3, 4);
    expect(useRobotStore.getState().redo()).toBe(true);
    expect(
      useRobotStore.getState().parts.find((p) => p.id === "node-b")!.position[0]
    ).toBeCloseTo(0.8, 4);
  });

  it("F7: strips dangerous prototype-pollution keys and rejects invalid dimensions, transforms, geometry, connections, and visual program instructions/references", () => {
    const rawMaliciousJson = `{
      "format": "${PROJECT_FORMAT_ID}",
      "schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION},
      "__proto__": { "pollutedRoot": true },
      "constructor": { "prototype": { "pollutedNested": true } },
      "metadata": { "name": "Hardened Bot" },
      "build": {
        "stage": "structure",
        "foundationId": "foundation-chassis",
        "foundation": {
          "modelId": "standard-rectangular",
          "length": -1.2,
          "width": 0.9,
          "height": 0.25,
          "includeTopPlate": false,
          "includeFrontCover": false,
          "confirmed": true
        },
        "parts": [
          {
            "id": "valid-part",
            "name": "Valid Plate",
            "type": "Armor Plate",
            "position": [0, 0.2, 0],
            "rotation": [0, 0, 0],
            "size": [0.4, 0.05, 0.4],
            "mass": 0.8,
            "__proto__": { "pollutedPart": true }
          },
          {
            "id": "bad-dim-part",
            "name": "Zero Size",
            "type": "Structural Block",
            "position": [0, 0.2, 0],
            "rotation": [0, 0, 0],
            "size": [0, 0.2, 0.2],
            "mass": 0.5
          },
          {
            "id": "bad-geom-part",
            "name": "Bad Cylinder",
            "type": "Wheel",
            "position": [0, 0.2, 0],
            "rotation": [0, 0, 0],
            "size": [0.2, 0.05, 0.2],
            "mass": 0.2,
            "geometry": { "shape": "cylinder", "diameter": -0.2, "axialWidth": 0.05, "axis": "x" }
          },
          {
            "id": "bad-transform-part",
            "name": "Bad STL Transform",
            "type": "Structural Block",
            "position": [0, 0.2, 0],
            "rotation": [0, 0, 0],
            "size": [0.2, 0.2, 0.2],
            "mass": 0.5,
            "meshTransform": {
              "unit": "parsec",
              "unitConfirmed": true,
              "scaleMode": "uniform",
              "uniformScale": 1,
              "nonUniformScale": [1, 1, 1],
              "orientationRotation": [0, 0, 0],
              "positionOffset": [0, 0, 0]
            }
          }
        ],
        "connections": [
          {
            "id": "bad-conn-type",
            "sourceId": "valid-part",
            "targetId": "valid-part",
            "parentId": "valid-part",
            "childId": "valid-part",
            "type": "Explosive"
          }
        ],
        "drivetrain": { "type": "differential-2", "left": [null], "right": [null], "mappingCustomized": false },
        "hiddenPartIds": [],
        "selectedId": null
      },
      "electrical": { "connections": [] },
      "simulation": { "selectedArenaId": "${SIMULATION_ARENA_PRESETS[0].id}" },
      "programming": {
        "activeProgram": {
          "version": 1,
          "id": "bad-prog",
          "name": "Bad Sensor Ref",
          "updatedAtIso": "2026-01-01T00:00:00.000Z",
          "instructions": [
            {
              "id": "if-bad",
              "kind": "if-ultrasonic",
              "operator": "below",
              "thresholdMeters": 1.0,
              "sensorId": "non-existent-sonar",
              "thenInstructions": [
                { "id": "bad-wait", "kind": "wait", "durationSeconds": -2 }
              ],
              "elseInstructions": []
            }
          ]
        }
      },
      "assets": []
    }`;

    const parsed = parseAndValidateRobotProject(rawMaliciousJson);
    expect(parsed.success).toBe(true);
    expect(({} as Record<string, unknown>).pollutedRoot).toBeUndefined();
    expect(({} as Record<string, unknown>).pollutedNested).toBeUndefined();
    expect(({} as Record<string, unknown>).pollutedPart).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed.project!, "__proto__")).toBe(false);
    expect(parsed.project!.build.parts.map((p) => p.id)).toEqual(["valid-part"]);
    expect(parsed.project!.build.foundation).toBeNull();
    expect(parsed.project!.build.connections).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes("corrupted component"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("foundation"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("malformed mechanical connection"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("Saved visual program failed validation"))).toBe(true);
  });

  it("F7: preserves savedPrograms parity across JSON export, import, and autosave recovery, and preserves active STL BufferGeometry across reload", () => {
    clearVisualProgramStorage();
    const store = useRobotStore.getState();
    store.confirmFoundation();

    const savedOne = {
      ...createEmptyVisualProgram("Saved Patrol A"),
      instructions: [
        {
          id: "sp-drv",
          kind: "drive" as const,
          direction: "forward" as const,
          power: 0.6,
          durationSeconds: 1.0,
        },
      ],
    };
    saveVisualProgram(savedOne);

    const stl = createTestStlAsset("f7-retained-stl");
    store.importStructuralStl({
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
        extents: [0.3, 0.2, 0.2],
        assetId: stl.assetId,
      }),
    });
    const geomBeforeReload = getOrCreateThreeBufferGeometry(stl.assetId);
    expect(geomBeforeReload).not.toBeNull();

    // JSON export includes savedPrograms just like exportProjectFromStore
    const json = exportProjectJsonFromStore();
    expect(JSON.parse(json).programming.savedPrograms).toHaveLength(1);

    // Clear saved programs storage and import JSON -> savedPrograms restored cleanly & matching live GPU geometry is not disposed prematurely
    clearVisualProgramStorage();
    expect(loadSavedVisualPrograms()).toHaveLength(0);
    const importRes = importProjectIntoStore(json);
    expect(importRes.success).toBe(true);
    expect(loadSavedVisualPrograms().map((p) => p.name)).toEqual(["Saved Patrol A"]);
    expect(getOrCreateThreeBufferGeometry(stl.assetId)).toBe(geomBeforeReload);

    // Pristine post-reset build is skipped by shouldPersistProjectAutosave so blank builds never clobber recoverable autosave
    saveProjectAutosave(importRes.project!);
    useRobotStore.getState().startNewBuild();
    expect(shouldPersistProjectAutosave(useRobotStore.getState())).toBe(false);
    expect(loadProjectAutosave()?.project?.programming.savedPrograms).toHaveLength(1);

    // QuotaExceededError compact fallback saves structure/programs to localStorage while keeping session fallback usable
    const storageMap = new Map<string, string>();
    let setCalls = 0;
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => {
          setCalls += 1;
          if (setCalls === 1) {
            const quotaErr = new Error("QuotaExceededError");
            quotaErr.name = "QuotaExceededError";
            throw quotaErr;
          }
          storageMap.set(key, value);
        },
        removeItem: (key: string) => {
          storageMap.delete(key);
        },
      },
    };
    try {
      const quotaRes = saveProjectAutosave(importRes.project!);
      expect(quotaRes.saved).toBe(true);
      expect(quotaRes.quotaExceeded).toBe(true);
      expect(quotaRes.usedCompactFallback).toBe(true);
      expect(quotaRes.warning).toContain("storage quota");
      const compactRecovered = loadProjectAutosave();
      expect(compactRecovered?.success).toBe(true);
      expect(compactRecovered?.project?.programming.savedPrograms).toHaveLength(1);
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prevWindow;
      }
    }
    clearVisualProgramStorage();
  });
});
