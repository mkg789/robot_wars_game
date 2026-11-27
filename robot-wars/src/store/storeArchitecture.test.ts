import { beforeEach, describe, expect, it } from "vitest";
import { resolvePartElectricalSpec } from "../features/electrical/logic/electricalComponentAdapters";
import {
  clearProjectAutosave,
  loadProjectAutosave,
  saveProjectAutosave,
} from "../features/persistence/logic/projectStorage";
import { parseAndValidateRobotProject } from "../features/persistence/logic/projectSerialization";
import { buildCustomCollisionConfig } from "../features/robot-builder/logic/customCollision";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  getOrCreateThreeBufferGeometry,
  getRegisteredAssetCount,
  registerParsedStlAsset,
  releaseMeshAsset,
} from "../features/robot-builder/logic/meshAssetRegistry";
import {
  exportProjectFromStore,
  exportProjectJsonFromStore,
  importProjectIntoStore,
} from "./projectStoreAdapter";
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

  it("F2: startNewBuild clears history, preview, selection, warnings, and store-owned STL assets without resurrecting or wiping external previews", () => {
    const createStlFixture = (assetId: string) => {
      const inspection = {
        fileName: `${assetId}.stl`,
        format: "ascii" as const,
        triangleCount: 2,
        vertexCount: 6,
        degenerateTriangleCount: 0,
        openEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        isClosedManifold: true,
        isValidGeometry: true,
        rawBoundsMin: [0, 0, 0] as const,
        rawBoundsMax: [0.2, 0.1, 0.2] as const,
        rawDimensions: [0.2, 0.1, 0.2] as const,
        rawCentroid: [0.1, 0.05, 0.1] as const,
        rawSignedVolume: 0.004,
        warnings: [],
        errors: [],
      };
      const record = registerParsedStlAsset(
        {
          inspection,
          positions: new Float32Array(18),
          normals: new Float32Array(18),
        },
        assetId
      );
      return {
        assetId: record.assetId,
        fileName: inspection.fileName,
        inspection,
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
          materialId: "unknown" as const,
          materialName: "Unknown",
          massMode: "user" as const,
          massKg: 0.5,
          centerOfMassMode: "calculated" as const,
          inertiaMode: "calculated" as const,
          provenance: {
            method: "measured" as const,
            verified: true,
            source: "f2-test",
          },
        },
        collision: buildCustomCollisionConfig({
          mode: "bounding-box",
          extents: [0.2, 0.1, 0.2],
          assetId: record.assetId,
        }),
      };
    };

    const store = useRobotStore.getState();
    store.confirmFoundation();

    const activeAsset = createStlFixture("f2-active-stl");
    const activeStlId = useRobotStore.getState().importStructuralStl(activeAsset)!;
    releaseMeshAsset(activeAsset.assetId); // transfer ownership strictly to store (refCount === 1)

    const futureAsset = createStlFixture("f2-future-stl");
    const futureStlId = useRobotStore.getState().importStructuralStl(futureAsset)!;
    releaseMeshAsset(futureAsset.assetId);
    // Undo removes futureStlId from active parts while retaining it inside historyFuture
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(getMeshAssetRecord(futureAsset.assetId)?.refCount).toBe(1);

    // Activate transform preview, part hiding, transform mode, and selection on activeStlId
    useRobotStore.getState().togglePartVisibility(activeStlId);
    useRobotStore.getState().setSelectedId(activeStlId);
    useRobotStore.getState().setTransformMode("translate");
    useRobotStore
      .getState()
      .previewPartTransform(activeStlId, [0.4, 0.3, 0], [0, 0, 0]);
    expect(useRobotStore.getState().activeTransformPreview?.partId).toBe(activeStlId);

    // Simulate an unrelated open StlImportPanel preview not yet committed into store
    const unconfirmedPreview = createStlFixture("f2-unconfirmed-preview");
    expect(getMeshAssetRecord(unconfirmedPreview.assetId)?.refCount).toBe(1);

    const prevRevision = useRobotStore.getState().projectRevision;
    useRobotStore.getState().startNewBuild();

    const reset = useRobotStore.getState();
    expect(reset.historyPast).toEqual([]);
    expect(reset.historyFuture).toEqual([]);
    expect(reset.activeTransformPreview).toBeNull();
    expect(reset.selectedId).toBe("foundation-chassis");
    expect(reset.hiddenPartIds).toEqual([]);
    expect(reset.transformMode).toBe("select");
    expect(reset.stage).toBe("foundation");
    expect(reset.lastProjectLoadWarnings).toEqual([]);
    expect(reset.lastReplacementWarning).toBeNull();
    expect(reset.projectRevision).toBe(prevRevision + 1);
    expect(reset.parts.some((p) => p.id === activeStlId || p.id === futureStlId)).toBe(false);

    // Undo and Redo cannot resurrect the reset build or STL parts
    expect(reset.undo()).toBe(false);
    expect(reset.redo()).toBe(false);
    expect(useRobotStore.getState().parts.some((p) => p.id === activeStlId)).toBe(false);

    // Store-owned STL assets were released to 0 & disposed, while external preview ref remains intact
    expect(getMeshAssetRecord(activeAsset.assetId)).toBeNull();
    expect(getMeshAssetRecord(futureAsset.assetId)).toBeNull();
    expect(getMeshAssetRecord(unconfirmedPreview.assetId)?.refCount).toBe(1);

    releaseMeshAsset(unconfirmedPreview.assetId);
    expect(getRegisteredAssetCount()).toBe(0);
  });

  it("F2: loadProjectState avoids unreferenced decoded asset leaks and maintains accurate STL retention across replacement and autosave recovery", () => {
    clearProjectAutosave();
    const createValidStl = (assetId: string) => {
      const inspection = {
        fileName: `${assetId}.stl`,
        format: "ascii" as const,
        triangleCount: 1,
        vertexCount: 3,
        degenerateTriangleCount: 0,
        openEdgeCount: 3,
        nonManifoldEdgeCount: 0,
        isClosedManifold: false,
        isValidGeometry: true,
        rawBoundsMin: [0, 0, 0] as const,
        rawBoundsMax: [0.3, 0.2, 0.1] as const,
        rawDimensions: [0.3, 0.2, 0.1] as const,
        rawCentroid: [0.15, 0.1, 0.05] as const,
        rawSignedVolume: 0,
        warnings: [],
        errors: [],
      };
      const centeredPositions = new Float32Array([
        0, 0, 0,
        0.3, 0, 0,
        0, 0.2, 0,
      ]);
      const normals = new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ]);
      registerParsedStlAsset(
        { inspection, positions: centeredPositions, normals },
        assetId
      );
      return {
        assetId,
        fileName: inspection.fileName,
        inspection,
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
          materialId: "unknown" as const,
          materialName: "Unknown",
          massMode: "user" as const,
          massKg: 0.6,
          centerOfMassMode: "calculated" as const,
          inertiaMode: "calculated" as const,
          provenance: {
            method: "measured" as const,
            verified: true,
            source: "f2-load-test",
          },
        },
        collision: buildCustomCollisionConfig({
          mode: "bounding-box",
          extents: [0.3, 0.2, 0.1],
          assetId,
        }),
      };
    };

    // Build project A with stl-a and export it (+ save autosave)
    useRobotStore.getState().confirmFoundation();
    const stlA = createValidStl("f2-project-a-stl");
    useRobotStore.getState().importStructuralStl(stlA);
    releaseMeshAsset(stlA.assetId);
    const projectAJson = exportProjectJsonFromStore();
    saveProjectAutosave(exportProjectFromStore());

    // Start project B with stl-b + history snapshot referencing stl-b-hist
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    const stlB = createValidStl("f2-project-b-stl");
    const stlBPartId = useRobotStore.getState().importStructuralStl(stlB)!;
    releaseMeshAsset(stlB.assetId);
    useRobotStore.getState().deletePartById(stlBPartId); // only retained via historyPast
    expect(getMeshAssetRecord(stlB.assetId)?.refCount).toBe(1);

    // Inject an unreferenced decoded asset entry to ensure loadProjectState never leaks refCount=0 assets
    const parsedA = parseAndValidateRobotProject(projectAJson);
    expect(parsedA.success).toBe(true);
    const parsedWithUnusedAsset = {
      ...parsedA,
      decodedAssets: [
        ...parsedA.decodedAssets,
        {
          assetId: "f2-unreferenced-decoded-garbage",
          centeredPositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          inspection: stlA.inspection,
        },
      ],
    };

    expect(useRobotStore.getState().loadProjectState(parsedWithUnusedAsset)).toBe(true);
    expect(getMeshAssetRecord("f2-unreferenced-decoded-garbage")).toBeNull();
    expect(getMeshAssetRecord(stlB.assetId)).toBeNull();
    expect(getMeshAssetRecord(stlA.assetId)?.refCount).toBe(1);
    expect(useRobotStore.getState().historyPast).toEqual([]);
    expect(useRobotStore.getState().historyFuture).toEqual([]);

    // Reset releases stl-a cleanly, then autosave recovery restores stl-a cleanly with usable geometry
    useRobotStore.getState().startNewBuild();
    expect(getMeshAssetRecord(stlA.assetId)).toBeNull();

    const recovered = loadProjectAutosave();
    expect(recovered?.success).toBe(true);
    expect(useRobotStore.getState().loadProjectState(recovered!)).toBe(true);
    expect(getMeshAssetRecord(stlA.assetId)?.refCount).toBe(1);
    expect(getOrCreateThreeBufferGeometry(stlA.assetId)).not.toBeNull();

    // Clean up project replacement with blank project
    const blankStore = useRobotStore.getState();
    blankStore.startNewBuild();
    expect(getRegisteredAssetCount()).toBe(0);
    expect(importProjectIntoStore(projectAJson).success).toBe(true);
    expect(getMeshAssetRecord(stlA.assetId)?.refCount).toBe(1);
    clearProjectAutosave();
  });
});
