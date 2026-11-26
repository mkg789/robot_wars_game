import { isValidElement, type ReactElement } from "react";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomMeshModel from "../../../components/viewport/CustomMeshModel";
import { useRobotStore } from "../../../store/robotStore";
import { buildCustomCollisionConfig } from "./customCollision";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  getOrCreateThreeBufferGeometry,
  getRegisteredAssetCount,
  registerParsedStlAsset,
  releaseMeshAsset,
  restoreMeshAssetRecord,
  retainMeshAsset,
  syncActiveAssetRefs,
} from "./meshAssetRegistry";
import { buildBinaryStlBuffer, parseStlArrayBuffer } from "./stlParser";

function createTestAsset(assetId = "test-stl-asset") {
  const triangles = [
    [
      [-50, -50, -50],
      [50, -50, -50],
      [50, 50, -50],
    ],
    [
      [-50, -50, 50],
      [50, -50, 50],
      [50, 50, 50],
    ],
  ] as const;
  const parsed = parseStlArrayBuffer(buildBinaryStlBuffer(triangles), `${assetId}.stl`);
  return {
    parsed,
    record: registerParsedStlAsset(parsed, assetId),
  };
}

describe("F1: STL GPU resource lifecycle (meshAssetRegistry & CustomMeshModel)", () => {
  beforeEach(() => {
    clearMeshAssets();
    useRobotStore.getState().startNewBuild();
  });

  it("reuses one cached BufferGeometry across callers and ignores accidental external dispose while retained", () => {
    const { record } = createTestAsset("shared-armor");
    retainMeshAsset(record.assetId);
    expect(getMeshAssetRecord(record.assetId)?.refCount).toBe(2);

    const geomA = getOrCreateThreeBufferGeometry(record.assetId);
    const geomB = getOrCreateThreeBufferGeometry(record.assetId);
    expect(geomA).not.toBeNull();
    expect(geomA).toBe(geomB);

    const protoDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const onDispose = vi.fn();
    geomA!.addEventListener("dispose", onDispose);

    // Simulate R3F or external consumer calling .dispose() on an individual mesh unmount
    geomA!.dispose();
    expect(onDispose).not.toHaveBeenCalled();
    expect(protoDisposeSpy).not.toHaveBeenCalled();
    expect(getMeshAssetRecord(record.assetId)?.cachedThreeGeometry).toBe(geomA);
    expect(geomA!.getAttribute("position").count).toBeGreaterThan(0);

    // Releasing one consumer preserves the cached geometry for the remaining holder
    releaseMeshAsset(record.assetId);
    expect(getMeshAssetRecord(record.assetId)?.refCount).toBe(1);
    expect(onDispose).not.toHaveBeenCalled();
    expect(protoDisposeSpy).not.toHaveBeenCalled();
    expect(getOrCreateThreeBufferGeometry(record.assetId)).toBe(geomA);

    // Final release disposes the GPU geometry cleanly via the registry
    releaseMeshAsset(record.assetId);
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(protoDisposeSpy).toHaveBeenCalledTimes(1);
    expect(getMeshAssetRecord(record.assetId)).toBeNull();
    protoDisposeSpy.mockRestore();
  });

  it("intentionally disposes cached BufferGeometry across syncActiveAssetRefs, restoreMeshAssetRecord, and clearMeshAssets", () => {
    const { record: a } = createTestAsset("stl-keep");
    const { record: b } = createTestAsset("stl-drop");

    const geomKeep = getOrCreateThreeBufferGeometry(a.assetId)!;
    const geomDrop = getOrCreateThreeBufferGeometry(b.assetId)!;
    const disposeKeep = vi.fn();
    const disposeDrop = vi.fn();
    geomKeep.addEventListener("dispose", disposeKeep);
    geomDrop.addEventListener("dispose", disposeDrop);

    syncActiveAssetRefs([a.assetId]);
    expect(disposeKeep).not.toHaveBeenCalled();
    expect(disposeDrop).toHaveBeenCalledTimes(1);
    expect(getMeshAssetRecord(b.assetId)).toBeNull();

    // Restoring under the same assetId disposes the previous cached BufferGeometry
    const restored = restoreMeshAssetRecord({
      assetId: a.assetId,
      centeredPositions: a.centeredPositions,
      normals: a.normals,
      inspection: a.inspection,
    });
    expect(disposeKeep).toHaveBeenCalledTimes(1);
    expect(restored.cachedThreeGeometry).toBeNull();

    const geomRestored = getOrCreateThreeBufferGeometry(a.assetId)!;
    expect(geomRestored).not.toBe(geomKeep);
    const disposeRestored = vi.fn();
    geomRestored.addEventListener("dispose", disposeRestored);

    clearMeshAssets();
    expect(disposeRestored).toHaveBeenCalledTimes(1);
    expect(getRegisteredAssetCount()).toBe(0);
  });

  it("preserves shared STL geometry in CustomMeshModel across duplicate part deletion in store", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();

    const { parsed, record } = createTestAsset("dual-wedge");
    const partId1 = store.importStructuralStl({
      assetId: record.assetId,
      fileName: "dual-wedge.stl",
      inspection: parsed.inspection,
      transform: {
        unit: "mm",
        unitConfirmed: true,
        scaleMode: "uniform",
        uniformScale: 1,
        nonUniformScale: [1, 1, 1],
        orientationRotation: [0, 0, 0],
        positionOffset: [0, 0, 0],
      },
      engineering: {
        materialId: "aluminum-6061",
        materialName: "Aluminum 6061",
        massMode: "user",
        massKg: 1.0,
        centerOfMassMode: "calculated",
        inertiaMode: "calculated",
        provenance: { method: "measured", verified: true, source: "test" },
      },
      collision: buildCustomCollisionConfig({
        mode: "bounding-box",
        extents: [0.1, 0.1, 0.1],
        assetId: record.assetId,
      }),
    })!;
    releaseMeshAsset(record.assetId);

    const partId2 = useRobotStore.getState().duplicatePart(partId1)!;
    expect(partId2).toBeTruthy();

    const sharedGeom = getOrCreateThreeBufferGeometry(record.assetId)!;
    const onDispose = vi.fn();
    sharedGeom.addEventListener("dispose", onDispose);

    // Inspect CustomMeshModel element tree for both instances
    const tree = CustomMeshModel({ assetId: record.assetId }) as ReactElement<{
      children: unknown[];
    }>;
    expect(isValidElement(tree)).toBe(true);
    const meshNode = tree.props.children[0] as ReactElement<{
      dispose?: unknown;
      children: ReactElement<{
        object?: unknown;
        attach?: string;
        dispose?: unknown;
      }>[];
    }>;
    // Mesh keeps material auto-disposable while primitive opts cached geometry out of R3F disposal
    expect(meshNode.type).toBe("mesh");
    expect(meshNode.props.dispose).toBeUndefined();
    const primitiveNode = meshNode.props.children[0];
    expect(primitiveNode.type).toBe("primitive");
    expect(primitiveNode.props.object).toBe(sharedGeom);
    expect(primitiveNode.props.attach).toBe("geometry");
    expect(primitiveNode.props.dispose).toBeNull();

    // Delete duplicate instance: shared geometry stays retained & undisposed for remaining part
    useRobotStore.getState().deletePartById(partId2);
    expect(onDispose).not.toHaveBeenCalled();
    expect(getOrCreateThreeBufferGeometry(record.assetId)).toBe(sharedGeom);
  });
});
