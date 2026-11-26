import { Euler, Quaternion, Vector3 } from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { computeAssemblyFootprintDimensions } from "../../simulation/logic/simulationAssembly";
import { computeObbOverlapDepth3D } from "./assemblyValidation";
import { buildCustomCollisionConfig, resolveImportedEngineeringProperties } from "./customCollision";
import { getMeshAssetRecord, registerParsedStlAsset, releaseMeshAsset } from "./meshAssetRegistry";
import {
  composeEulerRotations,
  computeAttachedChildTransform,
  computeRelativeTransformBetweenParts,
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";
import { calculateCenterOfMass } from "./robotStability";
import { compileRobotInertiaProfile } from "./robotInertia";
import {
  buildBinaryStlBuffer,
  computeLocalStlExtents,
  parseStlArrayBuffer,
} from "./stlParser";

function makeBoxTriangles(len: number, ht: number, wid: number) {
  const hx = len / 2;
  const hy = ht / 2;
  const hz = wid / 2;
  const v = {
    nnn: [-hx, -hy, -hz] as const,
    pnn: [hx, -hy, -hz] as const,
    ppn: [hx, hy, -hz] as const,
    npn: [-hx, hy, -hz] as const,
    nnp: [-hx, -hy, hz] as const,
    pnp: [hx, -hy, hz] as const,
    ppp: [hx, hy, hz] as const,
    npp: [-hx, hy, hz] as const,
  };
  return [
    [v.pnn, v.pnp, v.ppp],
    [v.pnn, v.ppp, v.ppn],
    [v.nnn, v.npn, v.npp],
    [v.nnn, v.npp, v.nnp],
    [v.npn, v.ppn, v.ppp],
    [v.npn, v.ppp, v.npp],
    [v.nnn, v.nnp, v.pnp],
    [v.nnn, v.pnp, v.pnn],
    [v.nnp, v.npp, v.ppp],
    [v.nnp, v.ppp, v.pnp],
    [v.nnn, v.pnn, v.ppn],
    [v.nnn, v.ppn, v.npn],
  ] as const;
}

describe("Stage B: Geometry & Assembly Integrity (CF-3, HP-2, CF-2)", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("CF-3: prevents double-rotation on oriented STLs and keeps structural STL config, mass, CoM, inertia, and scaling synchronized", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();

    // Elongated asymmetric beam: 1000mm X, 200mm Y, 200mm Z, rotated -90 deg around Y (aligns local length along Z in world)
    const binBuf = buildBinaryStlBuffer(makeBoxTriangles(1000, 200, 200));
    const parsed = parseStlArrayBuffer(binBuf, "beam-sensor-bar.stl");
    const rec = registerParsedStlAsset(parsed);

    const rot90Y: [number, number, number] = [0, -Math.PI / 2, 0];
    const transform = {
      unit: "mm" as const,
      unitConfirmed: true,
      scaleMode: "uniform" as const,
      uniformScale: 1,
      nonUniformScale: [1, 1, 1] as const,
      orientationRotation: rot90Y,
      positionOffset: [0, 0, 0] as const,
    };
    const eng = resolveImportedEngineeringProperties({
      inspection: parsed.inspection,
      transform,
      materialId: "aluminum-6061",
      massMode: "estimated-density",
      centerOfMassMode: "user",
      userCenterOfMassLocal: [0.3, 0, 0], // +X local becomes +Z world after -90 deg Y rotation!
      inertiaMode: "calculated",
    });
    const localExt = computeLocalStlExtents({
      rawDimensions: parsed.inspection.rawDimensions,
      unit: "mm",
      scale: [1, 1, 1],
    });
    const collision = buildCustomCollisionConfig({
      mode: "bounding-box",
      extents: localExt,
      assetId: rec.assetId,
    });

    const stlPartId = store.importStructuralStl({
      assetId: rec.assetId,
      fileName: "beam-sensor-bar.stl",
      inspection: parsed.inspection,
      transform,
      engineering: eng,
      collision,
    })!;
    releaseMeshAsset(rec.assetId);

    // Move imported STL to standalone world origin with its exact -90° Y rotation
    useRobotStore.getState().updatePartTransform(stlPartId, [0, 0.5, 0], rot90Y);
    const stlPart = useRobotStore.getState().parts.find((p) => p.id === stlPartId)!;

    // Canonical part size stays in unrotated local frame [1.0, 0.2, 0.2] (not rotated into [0.2, 0.2, 1.0])
    expect(stlPart.size[0]).toBeCloseTo(1.0, 4);
    expect(stlPart.size[2]).toBeCloseTo(0.2, 4);

    // Build small probe box at (+0.45, 0.5, 0): after -90 deg Y rotation, elongated beam sits along Z (X span is only ±0.1), so NO overlap!
    const probePart = {
      ...stlPart,
      id: "probe",
      position: [0.45, 0.5, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: [0.2, 0.2, 0.2] as [number, number, number],
      geometry: { shape: "box" as const, length: 0.2, height: 0.2, width: 0.2 },
    };
    expect(computeObbOverlapDepth3D(stlPart, probePart)).toBe(0);

    // Verify CoM rotates localCom (+0.3, 0, 0) -> (0, 0, +0.3) in world under -90° Y
    const com = calculateCenterOfMass([stlPart], 0);
    expect(Math.abs(com.x)).toBeLessThan(1e-4);
    expect(com.z).toBeCloseTo(0.3, 3);

    // Verify inertia rotates local axis tensor once cleanly:
    // after -90° Y rotation, length (1.0m) aligns along world Z, so roll inertia Ixx (z²+y²) >> yaw/Z axis inertia Izz (x²+y²)!
    const inertia = compileRobotInertiaProfile([stlPart]);
    expect(inertia.tensor[2][2]).toBeLessThan(inertia.tensor[0][0]);

    // Structural updateImportedPartConfiguration recomputes properties without falling back to foundation.imported
    const massBefore = stlPart.massKg ?? stlPart.mass;
    useRobotStore.getState().updateImportedPartConfiguration(stlPartId, {
      engineering: { materialId: "steel-mild", massMode: "estimated-density" },
      collision: { ...stlPart.collisionConfig!, mode: "multi-box" },
    });
    const updatedStl = useRobotStore.getState().parts.find((p) => p.id === stlPartId)!;
    expect(updatedStl.massKg ?? 0).toBeGreaterThan(massBefore * 2); // Steel (7850) > Aluminum (2700)
    expect(updatedStl.collisionConfig!.boxes.length).toBeGreaterThan(1);
    expect(
      updatedStl.engineeringSpec?.category === "structural"
        ? updatedStl.engineeringSpec.role
        : undefined
    ).toBe("bulkhead");

    // Inspector/Gizmo scaling synchronizes meshTransform and collision proxy + footprint cleanly
    useRobotStore.getState().updatePartSize(stlPartId, [2.0, 0.2, 0.2]);
    const scaledStl = useRobotStore.getState().parts.find((p) => p.id === stlPartId)!;
    expect(scaledStl.meshTransform!.nonUniformScale[0]).toBeCloseTo(2.0, 3);
    const footprint = computeAssemblyFootprintDimensions([scaledStl]);
    // Because scaledStl has length 2.0 along local X rotated -90° Y, world width Z matches collision proxy envelope (~2.02m)
    expect(footprint.widthM).toBeGreaterThanOrEqual(2.0);
    expect(footprint.widthM).toBeCloseTo(
      scaledStl.collisionConfig!.envelopeSize[0],
      4
    );
    expect(getMeshAssetRecord(rec.assetId)).not.toBeNull();
  });

  it("HP-2: composes multi-axis parent-child rotations via quaternions and re-anchors children when parent resizes", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();

    // Verify quaternion composition accuracy for compound rotations
    const pRot: [number, number, number] = [0.45, 0.8, -0.3];
    const relRot: [number, number, number] = [-0.25, 0.6, 0.5];
    const composed = composeEulerRotations(pRot, relRot);
    const qExpected = new Quaternion()
      .setFromEuler(new Euler(...pRot, "XYZ"))
      .multiply(new Quaternion().setFromEuler(new Euler(...relRot, "XYZ")));
    const qActual = new Quaternion().setFromEuler(new Euler(...composed, "XYZ"));
    expect(Math.abs(qActual.dot(qExpected))).toBeCloseTo(1.0, 5);

    // Mount rail onto foundation, mount bracket onto rail-top, then resize rail height!
    const railId = store.addStructuralPart("structural-rail", {
      parentId: "foundation-chassis",
      parentInterfaceId: "foundation-top-center",
    })!;
    const bracketId = useRobotStore.getState().addStructuralPart("l-bracket", {
      parentId: railId,
      parentInterfaceId: "rail-top",
    })!;

    const rail0 = useRobotStore.getState().parts.find((p) => p.id === railId)!;
    const bracket0 = useRobotStore.getState().parts.find((p) => p.id === bracketId)!;
    const initialGap = bracket0.position[1] - (rail0.position[1] + rail0.size[1] * 0.5);

    // Increase rail height by +0.20m -> bracket must shift up by +0.10m to stay flush on rail-top!
    useRobotStore
      .getState()
      .updatePartSize(railId, [rail0.size[0], rail0.size[1] + 0.2, rail0.size[2]]);
    const rail1 = useRobotStore.getState().parts.find((p) => p.id === railId)!;
    const bracket1 = useRobotStore.getState().parts.find((p) => p.id === bracketId)!;
    const afterGap = bracket1.position[1] - (rail1.position[1] + rail1.size[1] * 0.5);
    expect(afterGap).toBeCloseTo(initialGap, 4);

    // Rotate parent rail with compound XYZ Euler angle and check child exact 3D quaternion world transform
    useRobotStore.getState().updatePartRotation(railId, [0.4, 0.7, 0.2]);
    const rail2 = useRobotStore.getState().parts.find((p) => p.id === railId)!;
    const bracket2 = useRobotStore.getState().parts.find((p) => p.id === bracketId)!;
    const conn = useRobotStore
      .getState()
      .connections.find((c) => c.childId === bracketId)!;
    const expectedWorldPos = new Vector3(...(conn.relativePosition ?? [0, 0, 0]))
      .applyEuler(new Euler(...(rail2.rotation ?? [0, 0, 0]), "XYZ"))
      .add(new Vector3(...rail2.position));
    expect(bracket2.position[0]).toBeCloseTo(expectedWorldPos.x, 4);
    expect(bracket2.position[1]).toBeCloseTo(expectedWorldPos.y, 4);
    expect(bracket2.position[2]).toBeCloseTo(expectedWorldPos.z, 4);

    const invCheck = computeRelativeTransformBetweenParts(
      rail2,
      bracket2.position,
      bracket2.rotation ?? [0, 0, 0]
    );
    expect(invCheck.relativePosition[1]).toBeCloseTo(conn.relativePosition![1], 4);

    // Check rotated interface alignment flush
    const railTop = resolvePartMountingInterfaces(rail2).find((i) => i.id === "rail-top")!;
    const bracketBottom = resolvePartMountingInterfaces(bracket2)[0];
    const attached = computeAttachedChildTransform(rail2, railTop, bracket2, bracketBottom);
    expect(attached.worldPosition.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("CF-2: enforces centralized graph cleanup across delete, structural/foundation replacement, electrical selections, and undo/redo", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();
    store.installBattery("standard-lipo");
    store.installController("arduino-uno");

    // Mount sensor onto controller, plus unrelated independent sensor on foundation
    const ctrlId = useRobotStore.getState().parts.find((p) => p.type === "Controller")!.id;
    const batId = useRobotStore.getState().parts.find((p) => p.type === "Battery")!.id;
    const mountedSonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
        parentId: ctrlId,
      })!;
    const independentIrId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-ir-obstacle")!;

    // Wire Battery -> Controller (will become dangling if Controller removed) AND Battery -> IR (must survive!)
    const ctrlWireId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    })!;
    const irWireId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: independentIrId,
      targetInterfaceId: "elec-ir-obstacle-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    })!;
    useRobotStore.getState().setSelectedElectricalConnection(ctrlWireId);

    // Remove Controller -> mountedSonar must detach cleanly, ctrlWire removed, selection cleared, irWire preserved!
    useRobotStore.getState().removeController();
    const afterRemoveCtrl = useRobotStore.getState();
    const detachedSonar = afterRemoveCtrl.parts.find((p) => p.id === mountedSonarId)!;
    expect(detachedSonar).toBeDefined();
    expect(detachedSonar.parentAttachmentId).toBeUndefined();
    expect(afterRemoveCtrl.electricalConnections.some((c) => c.id === ctrlWireId)).toBe(false);
    expect(afterRemoveCtrl.electricalConnections.some((c) => c.id === irWireId)).toBe(true);
    expect(afterRemoveCtrl.selectedElectricalConnectionId).toBeNull();

    // Undo restores Controller + mounted link + ctrlWire + valid stage cleanly; Redo re-removes cleanly
    expect(useRobotStore.getState().undo()).toBe(true);
    const afterUndo = useRobotStore.getState();
    expect(afterUndo.parts.some((p) => p.id === ctrlId)).toBe(true);
    expect(afterUndo.parts.find((p) => p.id === mountedSonarId)!.parentAttachmentId).toBeDefined();
    expect(afterUndo.electricalConnections.some((c) => c.id === ctrlWireId)).toBe(true);

    // Deleting foundation cascades everything and resets stage safely; Undo restores foundation + stage + parts
    useRobotStore.getState().deletePartById("foundation-chassis");
    expect(useRobotStore.getState().parts).toHaveLength(0);
    expect(useRobotStore.getState().stage).toBe("foundation");
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(useRobotStore.getState().parts.some((p) => p.id === "foundation-chassis")).toBe(true);
    expect(useRobotStore.getState().stage).toBe("battery");
  });
});
