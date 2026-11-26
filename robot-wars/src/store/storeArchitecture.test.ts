import { beforeEach, describe, expect, it } from "vitest";
import { resolvePartElectricalSpec } from "../features/electrical/logic/electricalComponentAdapters";
import { buildCustomCollisionConfig } from "../features/robot-builder/logic/customCollision";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  registerParsedStlAsset,
} from "../features/robot-builder/logic/meshAssetRegistry";
import {
  syncGeometryFromSize,
  syncSizeFromGeometry,
  useRobotStore,
  type AssemblyHistorySnapshot,
} from "./robotStore";

describe("Stage E: Store slice composition & cross-slice invariants", () => {
  beforeEach(() => {
    clearMeshAssets();
    useRobotStore.getState().startNewBuild();
  });

  it("preserves exported store helpers and cross-slice undo/redo integrity", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();

    const beamId = store.addStructuralPart("structural-rail");
    expect(beamId).toBeTruthy();

    useRobotStore.getState().installBattery("standard-lipo");
    useRobotStore.getState().installController("arduino-uno");

    const batteryPart = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Battery");
    const controllerPart = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Controller");
    expect(batteryPart).toBeDefined();
    expect(controllerPart).toBeDefined();

    const batterySpec = resolvePartElectricalSpec(batteryPart!);
    const controllerSpec = resolvePartElectricalSpec(controllerPart!);
    expect(batterySpec?.interfaces.length).toBeGreaterThan(0);
    expect(controllerSpec?.interfaces.length).toBeGreaterThan(0);

    const wireId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: batteryPart!.id,
      sourceInterfaceId: batterySpec!.interfaces[0].interfaceId,
      targetPartId: controllerPart!.id,
      targetInterfaceId: controllerSpec!.interfaces[0].interfaceId,
      connectionType: "power",
      provenance: { method: "user-supplied", source: "test-fixture" },
    });
    expect(wireId).toBeTruthy();
    expect(useRobotStore.getState().electricalConnections).toHaveLength(1);

    // Preview transform creates rollback baseline without inflating undo stack until committed or undone
    useRobotStore
      .getState()
      .previewPartTransform(beamId!, [0.2, 0.5, 0], [0, 0, 0], [0.4, 0.05, 0.05]);
    expect(useRobotStore.getState().activeTransformPreview?.partId).toBe(beamId);

    // Undo restores baseline preview first, then steps cleanly back across slices
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(useRobotStore.getState().activeTransformPreview).toBeNull();
    expect(useRobotStore.getState().undo()).toBe(true); // removes electrical wire
    expect(useRobotStore.getState().electricalConnections).toHaveLength(0);
    expect(useRobotStore.getState().redo()).toBe(true);
    expect(useRobotStore.getState().electricalConnections).toHaveLength(1);

    const snapshotCheck: AssemblyHistorySnapshot | undefined =
      useRobotStore.getState().historyPast[0];
    expect(snapshotCheck).toBeDefined();
    expect(typeof syncGeometryFromSize).toBe("function");
    expect(typeof syncSizeFromGeometry).toBe("function");
  });

  it("tracks mesh asset ref-counting across foundation, parts, undo/redo, and reset slices", () => {
    const inspection = {
      fileName: "bracket.stl",
      format: "ascii" as const,
      triangleCount: 2,
      vertexCount: 6,
      degenerateTriangleCount: 0,
      openEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      isClosedManifold: true,
      isValidGeometry: true,
      rawBoundsMin: [0, 0, 0] as const,
      rawBoundsMax: [0.1, 0.1, 0.1] as const,
      rawDimensions: [0.1, 0.1, 0.1] as const,
      rawCentroid: [0.05, 0.05, 0.05] as const,
      rawSignedVolume: 0.001,
      warnings: [],
      errors: [],
    };
    const assetId = "stage-e-mesh-asset";
    registerParsedStlAsset(
      {
        inspection,
        positions: new Float32Array(18),
        normals: new Float32Array(18),
      },
      assetId
    );
    const initialRecord = getMeshAssetRecord(assetId);
    expect(initialRecord?.refCount).toBe(1);

    const stlPartId = useRobotStore.getState().importStructuralStl({
      assetId,
      fileName: "bracket.stl",
      inspection,
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
        massKg: 0.4,
        centerOfMassMode: "calculated",
        inertiaMode: "calculated",
        provenance: {
          method: "measured",
          verified: true,
          source: "test-fixture",
        },
      },
      collision: buildCustomCollisionConfig({
        mode: "single-box",
        extents: [0.1, 0.1, 0.1],
        assetId,
        customBoxes: [
          {
            id: "box-1",
            center: [0, 0, 0],
            size: [0.1, 0.1, 0.1],
          },
        ],
      }),
    });
    expect(stlPartId).toBeTruthy();
    expect(getMeshAssetRecord(assetId)?.refCount).toBe(2);

    // Deleting part removes it from active parts, while undo history retains store's 1 ref until cleared
    useRobotStore.getState().deletePartById(stlPartId!);
    expect(getMeshAssetRecord(assetId)?.refCount).toBe(2);

    // Undo restores the STL part cleanly from history snapshot
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(useRobotStore.getState().parts.some((p) => p.id === stlPartId)).toBe(
      true
    );
    expect(getMeshAssetRecord(assetId)?.refCount).toBe(2);
  });
});
